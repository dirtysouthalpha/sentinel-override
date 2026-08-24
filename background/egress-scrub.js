// Sentinel Override — Outbound Egress Scrubber
//
// WHY THIS EXISTS
// This is an MSP tool. It reads whole pages — a client's ticket system, billing
// portal, RMM or admin console — and ships that text to a cloud model. Before
// this module the LLM path was completely unprotected: `_sanitizeHistory()` in
// llm-client.js only strips screenshot blobs and truncates, and the redaction in
// telemetry.js (`_redactString`) is module-private and only ever ran on
// telemetry payloads. So a page containing an API key, a session token or a
// client's personal details went to OpenAI/Anthropic/Z.AI verbatim.
//
// The data at risk is not the operator's — it is their clients'. That is a
// liability problem, not just a hygiene one.
//
// DESIGN: PLACEHOLDER-AND-RESTORE, NOT DESTRUCTION
// Masking to `[[EMAIL-1]]` rather than deleting keeps the model able to reason
// ("reply to the email in the ticket"), and the real value is restored locally
// when the model's action comes back. Tokens are stable for the whole run, so
// `[[EMAIL-1]]` means the same address on step 1 and step 9.
//
// DESIGN: OVER-MASKING IS AN OUTAGE, NOT A SAFETY WIN
// Masking too eagerly breaks the product in a way that is harder to notice than
// leaking. Every pattern here is deliberately narrow:
//   - credit-card candidates must pass a Luhn check
//   - phone candidates are rejected if they look like a date, version, port,
//     hex digest or are embedded in a longer alphanumeric token
//   - bare hex is NEVER masked (git SHAs, UUIDs, hashes and content addresses
//     are the lifeblood of the text this tool reads)
// tests/egress-scrub.test.js asserts BOTH directions: nothing sensitive escapes,
// and normal technical text survives byte-identical.

/** Categories, in the order they are applied. Specific before general. */
export const SCRUB_KIND = {
  PRIVATE_KEY: 'KEY',
  AUTH: 'AUTH',
  SECRET: 'SECRET',
  JWT: 'JWT',
  PASSWORD: 'PASSWORD',
  CARD: 'CARD',
  SSN: 'SSN',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
};

/** How aggressively to scrub, by destination. */
export const SCRUB_MODE = {
  /** Mask for cloud endpoints, send raw to local/self-hosted. Default. */
  CLOUD: 'cloud',
  /** Mask for every endpoint including local. */
  ALWAYS: 'always',
  /** Never mask. Operator opt-out; the UI must make the risk explicit. */
  OFF: 'off',
};

// ── Credential patterns ─────────────────────────────────────────────────────
// Each entry masks capture group 1 when present, else the whole match.
const CREDENTIAL_PATTERNS = [
  // PEM private key blocks — whole block, any type.
  { kind: SCRUB_KIND.PRIVATE_KEY, re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g },

  // Anthropic — must precede the broader OpenAI sk- pattern.
  { kind: SCRUB_KIND.SECRET, re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI (sk-proj-…, sk-…) — long enough not to catch prose.
  { kind: SCRUB_KIND.SECRET, re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  // AWS access key id.
  { kind: SCRUB_KIND.SECRET, re: /\bAKIA[0-9A-Z]{16}\b/g },
  // Google API key.
  { kind: SCRUB_KIND.SECRET, re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  // GitHub tokens (classic + fine-grained).
  { kind: SCRUB_KIND.SECRET, re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { kind: SCRUB_KIND.SECRET, re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  // Slack.
  { kind: SCRUB_KIND.SECRET, re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // Stripe.
  { kind: SCRUB_KIND.SECRET, re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // JWTs — three base64url segments, header starts with the {"alg" marker.
  { kind: SCRUB_KIND.JWT, re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },

  // Authorization headers / bearer tokens — keep the scheme, mask the credential.
  { kind: SCRUB_KIND.AUTH, re: /\b(?:Authorization\s*[:=]\s*)?\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{12,})/gi, group: 1 },

  // Cookie headers, whole value.
  { kind: SCRUB_KIND.AUTH, re: /\b(?:Set-)?Cookie\s*:\s*([^\n\r]{8,})/gi, group: 1 },

  // key/value assignments for secret-shaped names. Quoted or bare, = or :.
  {
    kind: SCRUB_KIND.PASSWORD,
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|session[_-]?id)\b["']?\s*[:=]\s*["']?([^\s"',;}\]&]{4,})/gi,
    group: 1,
  },
];

// ── PII patterns ────────────────────────────────────────────────────────────
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SSN_RE = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
// Card candidates: 13-19 digits, optionally in groups of 4. Luhn-validated below.
const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
// Phone candidates. Requires a separator pattern or a leading +, so that bare
// digit runs (ports, ids, byte counts) are not candidates at all.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b|\+\d{10,15}\b/g;

// Shapes that must never be treated as a phone or a card, checked against the
// ORIGINAL matched text. This is the git-SHA lesson: a false positive here takes
// the product down in a way nobody notices until a customer complains.
// Shared by both: a date or a clock is never a phone or a card.
const NOT_PII_SHAPES = [
  /\d{4}-\d{2}-\d{2}/,          // ISO date
  /\d{1,2}:\d{2}(:\d{2})?/,     // clock time
];
// Card-only guard. Requires at least one a-f letter, so a *hex digest* is
// excluded but a pure-decimal card number is not — "4111111111111111" is all
// [0-9a-f] characters, and a naive /^[0-9a-f]{7,}$/ guard silently let every
// separator-free card straight through.
const HEX_DIGEST_RE = /^(?=[0-9a-f]*[a-f])[0-9a-f]{7,}$/i;
// Semver deliberately is NOT in the shared list: "617.555.0142" matches
// \d+\.\d+\.\d+ just as well as "21.6.76" does. The 10-15 digit requirement
// already rejects every real version string (21.6.76 is five digits), so the
// shape check would only ever have cost us true positives.
const VERSION_RE = /^v?\d{1,4}(\.\d{1,4}){1,3}$/;

/** Luhn check — the only thing standing between a card and a masked order id. */
function luhnValid(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Is this match embedded in a longer alphanumeric token (a hash, an id, a
 * filename)? If so it is not PII, it is part of something else.
 */
function embeddedInToken(text, index, length) {
  const before = index > 0 ? text[index - 1] : '';
  const after = index + length < text.length ? text[index + length] : '';
  return /[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after);
}

const LOCAL_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|[\w-]+\.local|host\.docker\.internal)$/;

// Model families that are hosted by a third party no matter what address the
// request is addressed to. A local HOST is not evidence of a local MODEL.
const CLOUD_MODEL_RE = /\b(gpt-|o[134]-|chatgpt|claude-|anthropic|gemini|palm-|glm-|zai|longcat|deepseek|grok-|command-r|sonar|kimi|moonshot|ernie|doubao|qwen-(max|plus|turbo|long))\b/i;

// A proxy path that names a provider is a strong signal too: /u/zai/, /openai/v1,
// /anthropic/v1 are all this fleet's own egress-proxy conventions.
const CLOUD_PATH_RE = /\/(zai|z-ai|openai|anthropic|claude|gemini|google|openrouter|groq|mistral|together|fireworks|deepseek|perplexity)(\/|$)/i;

/**
 * Should traffic to this endpoint be scrubbed?
 *
 * CLOUD mode exempts a model genuinely running on the operator's own hardware.
 * It must NOT exempt a cloud model that merely happens to be addressed through
 * a local egress proxy — which is exactly how this product's own author routes
 * every cloud request (127.0.0.1:8901 → z.ai, 127.0.0.1:8798 → Anthropic).
 * A host-only rule silently disabled masking on that setup while the settings
 * UI claimed "Cloud providers only (recommended)". Found by checking the real
 * fleet endpoints before trusting the unit tests.
 *
 * So: exempt only when the host is local AND nothing about the model or the
 * path says the bytes are leaving the machine.
 *
 * @param {string} endpoint
 * @param {string} [mode=SCRUB_MODE.CLOUD]
 * @param {string} [model] - Active model id; a cloud family defeats the local exemption.
 * @returns {boolean}
 */
export function shouldScrub(endpoint, mode = SCRUB_MODE.CLOUD, model = '') {
  if (mode === SCRUB_MODE.OFF) return false;
  if (mode === SCRUB_MODE.ALWAYS) return true;
  if (!endpoint) return true; // unknown destination — fail safe, scrub

  let url;
  try { url = new URL(endpoint); } catch { return true; }

  if (!LOCAL_HOST_RE.test(url.hostname.toLowerCase())) return true; // off-box
  if (CLOUD_PATH_RE.test(url.pathname)) return true;                // proxy to a provider
  if (model && CLOUD_MODEL_RE.test(String(model))) return true;     // cloud model, local address

  return false;
}

/**
 * Create a scrubber. Token numbering and the value→token map live for the
 * lifetime of the instance, which the engine ties to one agent run.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.pii=true] - Mask emails/phones/cards/SSNs.
 * @param {boolean} [opts.credentials=true] - Mask keys/tokens/passwords.
 * @returns {object} scrubber
 */
export function createScrubber(opts = {}) {
  const wantPii = opts.pii !== false;
  const wantCreds = opts.credentials !== false;

  /** token → original value */
  const byToken = new Map();
  /** original value → token (so the same secret gets the same token all run) */
  const byValue = new Map();
  /** kind → next ordinal */
  const counters = new Map();

  function tokenFor(kind, value) {
    if (byValue.has(value)) return byValue.get(value);
    const n = (counters.get(kind) || 0) + 1;
    counters.set(kind, n);
    const token = `[[${kind}-${n}]]`;
    byValue.set(value, token);
    byToken.set(token, value);
    return token;
  }

  /**
   * Mask sensitive values in a string.
   *
   * @param {string} input
   * @returns {string}
   */
  function scrub(input) {
    if (typeof input !== 'string' || !input) return input;
    let out = input;

    if (wantCreds) {
      for (const { kind, re, group } of CREDENTIAL_PATTERNS) {
        out = out.replace(new RegExp(re.source, re.flags), (match, ...rest) => {
          const captured = group ? rest[group - 1] : match;
          if (!captured) return match;
          const token = tokenFor(kind, captured);
          return match.replace(captured, token);
        });
      }
    }

    if (wantPii) {
      out = out.replace(EMAIL_RE, (m) => tokenFor(SCRUB_KIND.EMAIL, m));
      out = out.replace(SSN_RE, (m) => tokenFor(SCRUB_KIND.SSN, m));

      out = out.replace(CARD_RE, (m, idx, whole) => {
        if (NOT_PII_SHAPES.some(re => re.test(m))) return m;
        if (HEX_DIGEST_RE.test(m.trim())) return m;
        if (VERSION_RE.test(m.trim())) return m;
        if (embeddedInToken(whole, idx, m.length)) return m;
        const digits = m.replace(/\D/g, '');
        if (!luhnValid(digits)) return m; // an order id, not a card
        return tokenFor(SCRUB_KIND.CARD, m);
      });

      out = out.replace(PHONE_RE, (m, idx, whole) => {
        if (NOT_PII_SHAPES.some(re => re.test(m))) return m;
        if (embeddedInToken(whole, idx, m.length)) return m;
        // No version/hex guard here: the 10-15 digit rule below already
        // excludes every version string, and a phone is never hex.
        const digits = m.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) return m;
        return tokenFor(SCRUB_KIND.PHONE, m);
      });
    }

    return out;
  }

  /**
   * Restore real values in text coming back from the model, so the action the
   * agent executes uses the true value. Without this the agent would type
   * "[[EMAIL-1]]" into a form.
   *
   * @param {string} input
   * @returns {string}
   */
  function restore(input) {
    if (typeof input !== 'string' || !input) return input;
    let out = input;
    for (const [token, value] of byToken) {
      if (out.includes(token)) out = out.split(token).join(value);
    }
    return out;
  }

  /** Apply a string transform across a nested structure, non-mutating. */
  function deep(value, fn, depth = 0) {
    if (depth > 12) return value;
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map(v => deep(v, fn, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = deep(v, fn, depth + 1);
      return out;
    }
    return value;
  }

  return {
    scrub,
    restore,
    scrubDeep: (v) => deep(v, scrub),
    restoreDeep: (v) => deep(v, restore),
    /** Token list for audit/telemetry. Never exposes the raw values. */
    entries: () => [...byToken.keys()],
    count: () => byToken.size,
    /** Per-kind counts, for a user-visible "what was masked" summary. */
    summary: () => {
      const out = {};
      for (const token of byToken.keys()) {
        const kind = token.slice(2, token.lastIndexOf('-'));
        out[kind] = (out[kind] || 0) + 1;
      }
      return out;
    },
    reset: () => { byToken.clear(); byValue.clear(); counters.clear(); },
  };
}

// ── Run-scoped singleton ────────────────────────────────────────────────────
// One scrubber per agent run keeps tokens stable across steps. The engine calls
// resetEgressScrubber() when a run starts.
let _runScrubber = null;

/** @returns {object} the current run's scrubber, creating it if needed. */
export function getEgressScrubber(opts) {
  if (!_runScrubber) _runScrubber = createScrubber(opts);
  return _runScrubber;
}

/** Drop all mappings. Called at run start so tokens never cross runs. */
export function resetEgressScrubber() {
  if (_runScrubber) _runScrubber.reset();
  _runScrubber = null;
}
