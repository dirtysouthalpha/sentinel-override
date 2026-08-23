// Sentinel Override — Report Grounding Auditor
//
// WHY THIS EXISTS
// The MSP ticket templates in agent-ticket-format.js produce text that a
// technician pastes into a PSA ticket or sends to a paying client. Two classes
// of fabrication were shipping in that text:
//
//   1. INVENTED IDENTITY. getTechnicianInfo() fell back to hardcoded
//      placeholders — "John Smith", "IT Support Technician", "Acme IT",
//      "555-000-0000", "support@example.com" — whenever chrome.storage
//      technicianInfo was unset, which is the state of every fresh install.
//      The settings UI only persists non-empty fields, so a tech who filled in
//      just their name still got the fake phone and the fake email. Those went
//      into the Ownership Statement and into the body of a client-facing email.
//
//   2. INVENTED STATUS. The templates asserted outcomes the agent has no way
//      to know: "Ticket closed pending client confirmation", "has been
//      resolved", "Everything is now working as expected", "Vendor case opened
//      at <timestamp>". The agent performs read-only investigation; it does not
//      remediate, close tickets, or contact vendors.
//
// Neither was a model hallucination — both were deterministic, in our own
// string templates, on every run. This module is the structural guard: it takes
// the finished report plus the corpus of everything the agent ACTUALLY observed
// and reports any specific, checkable detail that is not backed by that corpus.
//
// It is deliberately conservative. It only flags categories where a false claim
// is materially harmful to an MSP — contact details, identity, and outcome
// assertions — and it treats operator-configured values as legitimate evidence
// (a technician's own phone number is not on the page, and should not be).

/** Claim categories this module recognises. */
export const CLAIM_KIND = {
  EMAIL: 'email',
  PHONE: 'phone',
  STATUS: 'status',
  PLACEHOLDER: 'placeholder',
};

// Well-known fake/example values that must never reach a client. These are the
// exact placeholder identities that used to ship, plus the RFC 2606 / RFC 5735
// reservations they were drawn from. Flagged regardless of corpus, because a
// page echoing "example.com" still does not make it a real support address.
const KNOWN_PLACEHOLDERS = [
  'john smith',
  'acme it',
  '555-000-0000',
  '5550000000',
  'support@example.com',
  'example.com',
  'example.org',
  'test@test.com',
  '[client name]',
  'your-company-here',
];

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Deliberately narrow: 10+ digits with common separators. Avoids matching
// timestamps, byte counts, and step numbers.
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;

/**
 * Outcome assertions the agent cannot substantiate on its own.
 *
 * Each entry pairs a pattern with the evidence tokens that would legitimise it.
 * If ANY evidence token appears in the corpus the claim is considered grounded —
 * e.g. a ticket page that literally reads "Status: Resolved" makes "resolved" a
 * fair thing to repeat. Otherwise it is an invention.
 */
const STATUS_CLAIMS = [
  { re: /\bticket\s+closed\b/i, evidence: ['ticket closed', 'status: closed', 'state: closed'] },
  { re: /\bhas been resolved\b/i, evidence: ['resolved', 'resolution:', 'status: resolved'] },
  { re: /\bissue (?:is|was) (?:fixed|resolved)\b/i, evidence: ['resolved', 'fixed', 'status: resolved'] },
  { re: /\beverything is now working\b/i, evidence: ['working as expected', 'status: resolved', 'healthy'] },
  { re: /\bno further action (?:is )?required\b/i, evidence: ['no further action', 'status: closed'] },
  { re: /\bvendor case (?:opened|created)\b/i, evidence: ['vendor case', 'case #', 'case id', 'support case'] },
  { re: /\bcontacted the client\b/i, evidence: ['contacted', 'call log', 'emailed the client'] },
  { re: /\bremediat(?:ed|ion complete)\b/i, evidence: ['remediated', 'remediation'] },
];

/**
 * Normalise text for substring matching: lowercase, collapse whitespace.
 *
 * @param {*} v
 * @returns {string}
 */
function norm(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : (() => {
    try { return JSON.stringify(v); } catch { return String(v); }
  })();
  return s.toLowerCase().replace(/\s+/g, ' ');
}

/** Digits only — so "555 000 0000", "(555) 000-0000" and "5550000000" compare equal. */
function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Build the corpus of everything the agent actually observed this run.
 *
 * Evidence is anything the agent read (page text, extracted values, action
 * results), plus anything the OPERATOR configured (their own name, phone and
 * email are legitimately not on the page). The goal text counts too — a ticket
 * number the user typed is not an invention.
 *
 * @param {object} input
 * @param {string} [input.goal]
 * @param {object} [input.agentMemory] - key → extracted value.
 * @param {Array}  [input.history] - loop history entries ({action, result}).
 * @param {string[]} [input.pageTexts] - raw page text observed.
 * @param {object} [input.technicianInfo] - operator-configured identity.
 * @returns {string} A single normalised haystack.
 */
export function buildEvidenceCorpus(input) {
  const src = input || {};
  const parts = [];

  if (src.goal) parts.push(norm(src.goal));

  if (src.agentMemory && typeof src.agentMemory === 'object') {
    for (const [k, v] of Object.entries(src.agentMemory)) {
      parts.push(norm(k));
      parts.push(norm(v));
    }
  }

  if (Array.isArray(src.history)) {
    for (const h of src.history) {
      if (!h) continue;
      if (h.result !== undefined) parts.push(norm(h.result));
      if (h.action) {
        // The code the agent ran and the text it typed are things it did, not
        // things it claims — both are legitimate evidence for the report.
        if (h.action.text) parts.push(norm(h.action.text));
        if (h.action.code) parts.push(norm(h.action.code));
        if (h.action.summary) parts.push(norm(h.action.summary));
      }
    }
  }

  if (Array.isArray(src.pageTexts)) {
    for (const t of src.pageTexts) parts.push(norm(t));
  }

  if (src.technicianInfo && typeof src.technicianInfo === 'object') {
    for (const v of Object.values(src.technicianInfo)) {
      if (v) parts.push(norm(v));
    }
  }

  return parts.join(' \n ');
}

/**
 * Is this value a known placeholder identity?
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isKnownPlaceholder(value) {
  const v = norm(value);
  if (!v) return false;
  return KNOWN_PLACEHOLDERS.some(p => v.includes(p))
    || KNOWN_PLACEHOLDERS.some(p => digitsOnly(p).length >= 10 && digitsOnly(v) === digitsOnly(p));
}

/**
 * Audit a rendered report against the evidence corpus.
 *
 * @param {string} report - The rendered report text.
 * @param {string} corpus - Output of buildEvidenceCorpus().
 * @returns {{ok: boolean, claims: Array<{kind: string, value: string, reason: string}>}}
 */
export function findUngroundedClaims(report, corpus) {
  const text = typeof report === 'string' ? report : '';
  const hay = norm(corpus);
  const claims = [];
  const seen = new Set();

  const push = (kind, value, reason) => {
    const key = `${kind}:${norm(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, value: String(value), reason });
  };

  // Placeholder identities — never acceptable, corpus or not.
  for (const p of KNOWN_PLACEHOLDERS) {
    if (norm(text).includes(p)) {
      push(CLAIM_KIND.PLACEHOLDER, p,
        'known placeholder/example value — would ship a fake identity to a client');
    }
  }

  // Email addresses.
  for (const m of text.match(EMAIL_RE) || []) {
    if (isKnownPlaceholder(m)) continue; // already reported above
    if (!hay.includes(norm(m))) {
      push(CLAIM_KIND.EMAIL, m, 'email address does not appear in anything the agent observed or the operator configured');
    }
  }

  // Phone numbers, compared digits-only.
  const hayDigits = digitsOnly(hay);
  for (const m of text.match(PHONE_RE) || []) {
    const d = digitsOnly(m);
    if (d.length < 10) continue;
    if (isKnownPlaceholder(m)) continue;
    if (!hayDigits.includes(d)) {
      push(CLAIM_KIND.PHONE, m.trim(), 'phone number does not appear in anything the agent observed or the operator configured');
    }
  }

  // Outcome assertions.
  for (const { re, evidence } of STATUS_CLAIMS) {
    const m = text.match(re);
    if (!m) continue;
    const grounded = evidence.some(e => hay.includes(norm(e)));
    if (!grounded) {
      push(CLAIM_KIND.STATUS, m[0],
        'outcome assertion with no supporting evidence — the agent performs read-only investigation and cannot confirm this');
    }
  }

  return { ok: claims.length === 0, claims };
}

/**
 * Append a visible audit block when the report makes claims we could not
 * ground. Deliberately loud: the whole point is that a technician sees this
 * BEFORE pasting into a client-facing ticket, rather than a silent pass.
 *
 * @param {string} report
 * @param {Array<{kind: string, value: string, reason: string}>} claims
 * @returns {string} The report, annotated when needed.
 */
export function annotateUngroundedClaims(report, claims) {
  const text = typeof report === 'string' ? report : '';
  if (!Array.isArray(claims) || claims.length === 0) return text;

  const lines = [
    '',
    '---',
    '',
    '> ⚠️ **UNVERIFIED DETAILS — review before sending.**',
    '> The agent could not find evidence for the following in the pages it read,',
    '> the data it extracted, or your configured technician details.',
    '>',
  ];
  for (const c of claims.slice(0, 12)) {
    lines.push(`> - \`${String(c.value).slice(0, 120)}\` (${c.kind}) — ${c.reason}`);
  }
  if (claims.length > 12) lines.push(`> - …and ${claims.length - 12} more.`);

  return text + '\n' + lines.join('\n');
}

/**
 * One-call convenience: audit and annotate.
 *
 * @param {string} report
 * @param {object} evidenceInput - Passed to buildEvidenceCorpus().
 * @returns {{report: string, claims: Array, ok: boolean}}
 */
export function auditReport(report, evidenceInput) {
  const corpus = buildEvidenceCorpus(evidenceInput);
  const { ok, claims } = findUngroundedClaims(report, corpus);
  return { report: ok ? report : annotateUngroundedClaims(report, claims), claims, ok };
}
