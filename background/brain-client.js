import { tryScrubForEgress } from './egress-scrub.js';
// Sentinel Override v3 -- Neuralis Brain READ client (sub-project B)
//
// Thin HTTP read client for the Neuralis brain (sub-project A exposes it over
// MCP; this is the in-extension HTTP consumer). At run start we make ONE recall
// call and turn the matches into a pre-formatted system-prompt section that is
// injected ALONGSIDE (not replacing) the existing local Client Knowledge section.
//
// Naming mirrors background/client-knowledge.js on purpose: same role
// (start-of-run knowledge injection), parallel path. The two sections render
// adjacently in the prompt but stay DISTINCT and LABELED — distinct trust tiers
// deserve distinct framing.
//
// ---------------------------------------------------------------------------
// DISCOVERED NEURON SHAPE (live probe of GET /recall?context=premier):
//   {
//     "context": "...",
//     "direct":    [ { id, content: "[src] the fact...", region, fire_count, ... } ],
//     "associated":[ { id, content: "[src] ...", region, ...,
//                      synapse_strength, connected_to } ]
//   }
// IMPORTANT: /recall does NOT return a standalone `source` field. The source
// is embedded as the LEADING "[tag]" prefix on `content` (e.g. "[zcode] ...",
// "[premierbot-seed] ..."). formatBrainSection parses that leading tag so each
// rendered line can carry an [src:<source>] provenance chip; a neuron with no
// leading tag renders as [src:unknown]. This matches how Sentinel reasons about
// provenance elsewhere (the [src:memory_key] audit-chip pattern).
// ---------------------------------------------------------------------------
//
// Public API:
//   recallNeurons(context, { baseUrl?, timeout? }) -> { direct:[], associated:[] } | throws
//   formatBrainSection(direct, associated)         -> string (the section, or '')
//   getBrainStartupContext(context)                -> { ok, section, directCount,
//                                                       associatedCount, error? }
//     THIS IS THE ONLY PUBLIC ENTRY POINT agent-engine calls. FAILS OPEN: any
//     error -> { ok:false, section:'' }. A down brain must not break an MSP run.
//
// Config (chrome.storage.local keys):
//   brainEnabled  (boolean, default false) -- opt-in gate, read by agent-engine
//   brainBaseUrl  (string,  default http://localhost:8000)
//   brainTimeout  (number,  default 10000 ms)

const DEFAULT_BASE_URL = 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 10000;

// (hardening 1B) One-warn-per-run signal. When the brain is unreachable we
// surface a single console.warn so the user has a signal (the hermes-agent/:8000
// port-conflict case otherwise fails open silently). This flag guarantees ONE
// warn per process/run — not one per recall — so a noisy multi-call path never
// spams. Reset by resetBrainRunSignals() at run start.
let _brainUnreachableWarnedThisRun = false;

/**
 * Emit exactly one "brain unreachable" warning per run. Distinguishes the two
 * failure modes the user cares about:
 *   - UNREACHABLE (network/timeout/non-200/brain down): warned once.
 *   - EMPTY (brain responded, no matches): NOT warned — that's healthy, the
 *     brain just had nothing for this platform. Don't cry wolf.
 */
function _warnUnreachable(detail) {
  if (_brainUnreachableWarnedThisRun) return;
  _brainUnreachableWarnedThisRun = true;
  try {
    console.warn('[Sentinel/Brain] Brain UNREACHABLE at recall time — run will proceed without shared knowledge. ' + (detail || ''));
  } catch (_e) { /* console may be unavailable in some contexts */ }
}

/**
 * Reset the one-warn-per-run flags. agent-engine should call this at run start
 * so each run gets a fresh single warning (not one ever). Exported for tests.
 */
export function resetBrainRunSignals() {
  _brainUnreachableWarnedThisRun = false;
}

// ========== Config ==========

async function _readConfig() {
  try {
    const obj = await chrome.storage.local.get({
      brainBaseUrl: DEFAULT_BASE_URL,
      brainTimeout: DEFAULT_TIMEOUT_MS,
    });
    let baseUrl = (typeof obj.brainBaseUrl === 'string' && obj.brainBaseUrl.trim())
      ? obj.brainBaseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_BASE_URL;
    let timeout = Number(obj.brainTimeout);
    if (!Number.isFinite(timeout) || timeout <= 0) timeout = DEFAULT_TIMEOUT_MS;
    return { baseUrl, timeout };
  } catch (_e) {
    return { baseUrl: DEFAULT_BASE_URL, timeout: DEFAULT_TIMEOUT_MS };
  }
}

// ========== Source extraction ==========

// Parse the leading "[tag]" off neuron content. Returns { source, display }.
// `source` is the tag text without brackets (lowercased), or 'unknown'.
// `display` is the content with the leading tag stripped, trimmed.
function _splitSource(content) {
  const raw = typeof content === 'string' ? content : String(content || '');
  const m = raw.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (m) {
    const tag = m[1].trim().toLowerCase();
    return { source: tag || 'unknown', display: m[2].trim() || raw };
  }
  return { source: 'unknown', display: raw.trim() };
}

// ========== Formatting ==========

/**
 * Render recalled neurons as the "## BRAIN KNOWLEDGE" prompt section.
 * Each line carries an [src:<source>] provenance chip. Returns '' for empty
 * input so the caller can skip injection entirely.
 * @param {Array} direct - Direct content matches from /recall.
 * @param {Array} associated - Synapse-linked associates from /recall.
 * @returns {string}
 */
export function formatBrainSection(direct, associated) {
  const d = Array.isArray(direct) ? direct : [];
  const a = Array.isArray(associated) ? associated : [];
  if (!d.length && !a.length) return '';

  const lines = [];
  if (d.length) {
    lines.push('Direct matches (strongly relevant):');
    for (const n of d) {
      const { source, display } = _splitSource(n && n.content);
      lines.push(`- [src:${source}] ${display}`);
    }
  }
  if (a.length) {
    if (d.length) lines.push('');
    lines.push('Associated (linked via synapses — contextual hints):');
    for (const n of a) {
      const { source, display } = _splitSource(n && n.content);
      lines.push(`- [src:${source}] ${display}`);
    }
  }

  return `\n## BRAIN KNOWLEDGE (shared, cross-installation)\nShared wisdom from the wider community, surfaced via the Neuralis brain. Treat as helpful hints, NOT authoritative — verify against the live page. Each line is tagged with its provenance:\n\n${lines.join('\n')}\n`;
}

// ========== HTTP ==========

/**
 * GET /recall?context=<ctx> against Neuralis.
 * @param {string} context - The recall key (platform id or host, per leak-zero rule).
 * @param {{baseUrl?: string, timeout?: number}} [opts]
 * @returns {Promise<{direct: Array, associated: Array}>}
 * @throws on non-200, network error, timeout, or malformed JSON.
 */
export async function recallNeurons(context, opts = {}) {
  const baseUrl = (opts && typeof opts.baseUrl === 'string' && opts.baseUrl.trim())
    ? opts.baseUrl.trim().replace(/\/+$/, '')
    : DEFAULT_BASE_URL;
  const timeout = (opts && Number.isFinite(opts.timeout) && opts.timeout > 0)
    ? opts.timeout
    : DEFAULT_TIMEOUT_MS;

  // The recall context is page/goal derived and rides in the query string —
  // which also means it lands in the brain server's access log. baseUrl is
  // configurable, so this is not guaranteed to stay on-box. Non-critical path,
  // so degrade rather than throw: on a scrub fault send nothing rather than raw.
  const _ctxScrub = await tryScrubForEgress(String(context || ''), { endpoint: baseUrl, kind: 'brain-recall' });
  if (!_ctxScrub.ok) {
    console.warn('[Sentinel/brain] recall context scrub failed; skipping recall:', _ctxScrub.error);
    return { ok: false, error: 'context scrub failed' };
  }
  const url = `${baseUrl}/recall?context=${encodeURIComponent(_ctxScrub.value)}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeout),
      headers: { 'Accept': 'application/json' },
    });
  } catch (e) {
    // AbortSignal.timeout throws a TimeoutError; fetch throws TypeError on
    // network failure. Re-throw so the orchestrator can fail open.
    throw new Error(`Brain recall fetch failed: ${(e && e.message) ? e.message : String(e)}`);
  }

  if (!resp || !resp.ok) {
    const status = resp ? resp.status : 0;
    const statusText = resp && resp.statusText ? resp.statusText : '';
    throw new Error(`Brain recall non-200: ${status} ${statusText}`.trim());
  }

  let parsed;
  try {
    parsed = await resp.json();
  } catch (e) {
    throw new Error(`Brain recall malformed JSON: ${(e && e.message) ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Brain recall malformed JSON: not an object');
  }
  return {
    direct: Array.isArray(parsed.direct) ? parsed.direct : [],
    associated: Array.isArray(parsed.associated) ? parsed.associated : [],
  };
}

// ========== Orchestrator (the ONLY public entry point agent-engine calls) ==========

/**
 * Run-start recall + formatting. FAILS OPEN by construction: any error returns
 * { ok:false, section:'' } so a down/broken brain never breaks an MSP's run.
 *
 * The brainEnabled gate is intentionally read HERE (not by the caller) so the
 * fails-open boundary is one place; agent-engine just calls this and uses the
 * section. When the toggle is off, returns empty WITHOUT hitting the network.
 *
 * @param {string} context - The recall key (platform id preferred, start-URL host fallback).
 *   Per the leak-zero rule this MUST be platform id / host only — never client
 *   name, tenant, or raw goal text. agent-engine enforces that at the call site.
 * @returns {Promise<{ok: boolean, section: string, directCount: number, associatedCount: number, error?: string}>}
 */
export async function getBrainStartupContext(context) {
  // Gate: opt-in toggle, default OFF.
  let enabled = false;
  try {
    const obj = await chrome.storage.local.get({ brainEnabled: false });
    enabled = obj.brainEnabled === true;
  } catch (_e) {
    enabled = false;
  }
  if (!enabled) {
    return { ok: false, section: '', directCount: 0, associatedCount: 0 };
  }

  // No usable key -> nothing to recall (still ok, just empty).
  if (!context || !String(context).trim()) {
    return { ok: false, section: '', directCount: 0, associatedCount: 0 };
  }

  let cfg;
  try {
    cfg = await _readConfig();
  } catch (_e) {
    cfg = { baseUrl: DEFAULT_BASE_URL, timeout: DEFAULT_TIMEOUT_MS };
  }

  let result;
  try {
    result = await recallNeurons(context, cfg);
  } catch (e) {
    // FAILS OPEN: never throw into the run path. But DO signal the user once
    // per run that the brain was unreachable (distinct from "brain returned
    // empty", which is healthy and stays quiet).
    const detail = (e && e.message) ? e.message : String(e);
    _warnUnreachable(detail);
    return {
      ok: false, section: '', directCount: 0, associatedCount: 0,
      error: detail,
    };
  }

  const directCount = result.direct.length;
  const associatedCount = result.associated.length;
  const section = formatBrainSection(result.direct, result.associated);
  // ok reflects that we got a healthy response; section may still be '' when
  // the brain had no matches for this key (that is NOT an error, NOT a warn).
  return { ok: true, section, directCount, associatedCount };
}
