// Sentinel Override v3 -- Neuralis Brain WRITE producer (sub-project C)
//
// The trust-critical half of the Neuralis integration. At run end, ships
// REDACTED PROCEDURAL learning to the brain as neurons (source:
// "sentinel-override"). The whole job is to make that exfiltration safe enough
// that it can never leak client-identifying data to a shared brain.
//
// Architecture mirrors background/brain-client.js (the read sibling, sub-project
// B): one public orchestrator, fails-open, all errors contained. The difference
// is the MANDATORY REDACTION GATE that gates every candidate before it ships.
//
// ---------------------------------------------------------------------------
// RECOVERY-EVENT DATA STRUCTURE (discovered in agent-engine.js, do not
// duplicate — read it from the runContext passed in by agent-engine):
//   - healingHistory (agent-engine.js:686): array of RuntimeProfiler.heal()
//     results pushed ONLY when healingResult.healed === true. Shape:
//       { id, status:'healed', attempts, successStrategy, endTime }
//     successStrategy = the recovery strategy that worked. This is the
//     highest-value procedural knowledge: literally "how to operate this UI
//     when the obvious thing breaks." -> region hippocampus.
//   - recoveryEvents (from runRecoverySkills results): entries carrying an
//     autoApply that fired a deterministic recovery. Also hippocampus.
//   - notes: the agent's `note`/UI-structure observations. -> region
//     parietal_left (spatial/structural sense of the UI).
//   - _learnedPatterns (agent-engine.js:679): { "type:selector": {uses,
//     successes, lastUsed} }. Used to enrich candidate tags, NOT as content
//     (too selector-specific, low standalone value).
// A "failed-then-recovered" action = a healingHistory entry with status
// 'healed', or a recovery skill that auto-applied. Plain failures (no
// recovery) are NOT candidates — they teach nothing procedural.
//
// ---------------------------------------------------------------------------
// CONCURRENCY / DEDUPE BEHAVIOR (live API probe, 2026-06-19):
// POST /neurons/think does NOT dedupe. Probed by POSTing the same content
// twice (identical content+region+source) then GET /neurons/search?q=... —
// the brain created TWO distinct neurons (ids 301, 302), each fire_count 1.
// So under concurrent writes from many installs, identical learnings WILL
// accumulate as duplicate neurons; the API offers no collision/coordination
// today. To be forward-compatible with a future server-side dedupe layer,
// shipNeuron attaches a client-side SHA-256 `content_hash` (hex) computed
// over (source + region + redacted content) on every neuron. If the API
// ignores the field today this is harmless; the moment a dedupe layer keys
// on it, duplicate writes from many installs collapse to one. (Web Crypto
// crypto.subtle.digest, available in MV3 service workers — no npm dep.)
// ---------------------------------------------------------------------------
//
// THE GATE (mandatory, in this order) — redactCandidate:
//   1. PII scrub via the production-tested _scrubPii (reused from
//      agent-reporting.js — never reinvented).
//   2. Client-entity DENYLIST: if scrubbed content still contains the active
//      client's name, tenant, or any known client identifier from
//      chrome.storage.local, DROP the whole candidate. FAIL-CLOSED.
//   3. Length/sanity: cap 1000 chars (matches client-knowledge.js); drop empties.
//
// Public API:
//   redactCandidate(content, clientIdentity) -> string | null
//   buildCandidates(runContext) -> [{ content, tags, region }]
//   shipNeuron(neuron) -> POST /neurons/think { content, region, source }
//   publishRunLearning(runContext) -> orchestrator (ONLY public entry point)
//     FAILS OPEN: never throws into the run-finish path.
//
// Config (chrome.storage.local, shared with B):
//   brainProducerEnabled (bool, default false)
//   brainProducerLastConfirmedAt (ISO string or null)
//   brainBaseUrl (string, default http://localhost:8000)
//   brainTimeout (number, default 10000)
//
// NO OFFLINE QUEUE: if the brain is down at run end, the learning is dropped.

import { _scrubPii } from './agent-reporting.js';

const DEFAULT_BASE_URL = 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_CONTENT_CHARS = 1000;
const SOURCE = 'sentinel-override';
// Consent staleness: re-prompt if the last confirmation is older than this.
const CONFIRM_STALE_MS = 7 * 24 * 3600 * 1000; // 7 days

// (hardening 1B) One-warn-per-run signal for the WRITE path. Distinct from the
// read path's signal (different user concern). Fires ONCE per run when the
// brain is UNREACHABLE at ship time (network/timeout/non-200) — never when
// candidates were rejected by the redaction gate (that's the trust gate doing
// its job, not an outage). resetBrainProducerRunSignals() resets at run start.
let _producerUnreachableWarnedThisRun = false;

function _warnProducerUnreachable(detail) {
  if (_producerUnreachableWarnedThisRun) return;
  _producerUnreachableWarnedThisRun = true;
  try {
    console.warn('[Sentinel/BrainProducer] Brain UNREACHABLE at run end — this run\'s redacted notes were dropped (no offline queue). ' + (detail || ''));
  } catch (_e) { /* console may be unavailable in some contexts */ }
}

/**
 * Reset the producer one-warn-per-run flag. agent-engine calls this at run start.
 * Exported for tests.
 */
export function resetBrainProducerRunSignals() {
  _producerUnreachableWarnedThisRun = false;
}

// Region mapping (kept to two, both sensible):
const REGION_HEAL = 'hippocampus';       // successful self-heal/recovery
const REGION_UI = 'parietal_left';       // UI-structure/timing observation
const REGION_FALLBACK = 'hippocampus';   // anything else

// ========== Config ==========

async function _readConfig() {
  try {
    const obj = await chrome.storage.local.get({
      brainBaseUrl: DEFAULT_BASE_URL,
      brainTimeout: DEFAULT_TIMEOUT_MS,
    });
    const baseUrl = (typeof obj.brainBaseUrl === 'string' && obj.brainBaseUrl.trim())
      ? obj.brainBaseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_BASE_URL;
    let timeout = Number(obj.brainTimeout);
    if (!Number.isFinite(timeout) || timeout <= 0) timeout = DEFAULT_TIMEOUT_MS;
    return { baseUrl, timeout };
  } catch (_e) {
    return { baseUrl: DEFAULT_BASE_URL, timeout: DEFAULT_TIMEOUT_MS };
  }
}

// ========== Client denylist ==========

/**
 * Gather all known client-identifying strings the denylist must reject:
 * the active client's name + tenant, plus every known client's name/tenant/id
 * from chrome.storage.local.sentinelClientKnowledge. Lowercased for matching.
 * @returns {Promise<string[]>}
 */
async function _loadDenylist(clientIdentity) {
  const deny = new Set();
  // Active client identity (passed in by agent-engine from the active client).
  if (clientIdentity && typeof clientIdentity === 'object') {
    for (const v of [clientIdentity.displayName, clientIdentity.tenant, clientIdentity.id]) {
      if (typeof v === 'string' && v.trim()) deny.add(v.trim().toLowerCase());
    }
  }
  // All known clients from storage — a candidate may reference a DIFFERENT
  // client than the active one; the denylist covers all of them.
  try {
    const obj = await chrome.storage.local.get({ sentinelClientKnowledge: null });
    const state = obj.sentinelClientKnowledge;
    if (state && state.clients && typeof state.clients === 'object') {
      for (const c of Object.values(state.clients)) {
        if (!c || typeof c !== 'object') continue;
        for (const v of [c.displayName, c.tenant, c.id]) {
          if (typeof v === 'string' && v.trim()) deny.add(v.trim().toLowerCase());
        }
      }
    }
  } catch (_e) { /* storage read failed — denylist is just the active client */ }
  // Drop very short tokens (1-2 chars) to avoid false-positive substring hits
  // like a client named "Co" matching every "co" in "config".
  return [...deny].filter((s) => s.length >= 3);
}

// Case-insensitive substring check against the denylist.
function _containsDenied(scrubbed, denylist) {
  const hay = String(scrubbed).toLowerCase();
  for (const term of denylist) {
    if (term && hay.includes(term)) return true;
  }
  return false;
}

// ========== The gate ==========

/**
 * The redaction gate. PII-scrubs, then applies the client denylist, then
 * length/sanity. Returns the safe content string, or NULL if the candidate
 * fails any gate (fail-closed). PURE with respect to the network; reads client
 * identity only from the argument + storage for the denylist.
 *
 * @param {string} content - Raw candidate content.
 * @param {{displayName?:string, tenant?:string, id?:string}} clientIdentity
 * @returns {Promise<string|null>} Redacted content, or null to drop.
 */
export async function redactCandidate(content, clientIdentity = {}) {
  if (typeof content !== 'string' || !content.trim()) return null;

  // 1. PII scrub (production-tested pass, reused verbatim).
  let scrubbed = _scrubPii(content);

  // 2. Client-entity denylist (fail-closed safety net).
  let denylist = [];
  try {
    denylist = await _loadDenylist(clientIdentity);
  } catch (_e) {
    // Couldn't build a denylist — be conservative: if there IS an active
    // client identity, drop the candidate rather than risk a leak. No active
    // client identity -> nothing to deny against, proceed.
    if (clientIdentity && (clientIdentity.displayName || clientIdentity.tenant)) return null;
  }
  if (_containsDenied(scrubbed, denylist)) return null;

  // 3. Length/sanity.
  scrubbed = scrubbed.trim();
  if (!scrubbed) return null;
  if (scrubbed.length > MAX_CONTENT_CHARS) return null;
  return scrubbed;
}

// Synchronous variant for buildCandidates where the denylist is preloaded
// (avoids an await per candidate). Internal only.
function _redactWithDenylist(content, denylist) {
  if (typeof content !== 'string' || !content.trim()) return null;
  let scrubbed = _scrubPii(content);
  if (_containsDenied(scrubbed, denylist)) return null;
  scrubbed = scrubbed.trim();
  if (!scrubbed || scrubbed.length > MAX_CONTENT_CHARS) return null;
  return scrubbed;
}

// ========== Candidate building ==========

/**
 * Pull SAFE sources into raw candidates (content NOT yet redacted). Platform id
 * is a TAG, never content. Self-heals -> hippocampus. Notes -> parietal_left.
 * @param {object} runContext
 * @returns {Array<{content:string, tags:string[], region:string}>}
 */
export function buildCandidates(runContext = {}) {
  const ctx = runContext || {};
  const tags = [];
  if (typeof ctx.platformId === 'string' && ctx.platformId.trim()) {
    tags.push(ctx.platformId.trim());
  }

  const out = [];

  // 1. Successful self-heals / recovery events -> hippocampus (highest value).
  const heals = Array.isArray(ctx.healingHistory) ? ctx.healingHistory : [];
  for (const h of heals) {
    if (!h || h.status !== 'healed') continue;
    const strat = typeof h.successStrategy === 'string' ? h.successStrategy.trim() : '';
    if (!strat) continue;
    out.push({
      content: `After ${h.attempts || 1} failed attempt(s), recovery strategy "${strat}" succeeded.`,
      tags: [...tags],
      region: REGION_HEAL,
    });
  }
  const recEvents = Array.isArray(ctx.recoveryEvents) ? ctx.recoveryEvents : [];
  for (const r of recEvents) {
    if (!r || !r.autoApply) continue;
    const t = (r.autoApply.type || 'recovery').toString();
    const detail = typeof r.autoApply.text === 'string' ? r.autoApply.text.trim() : '';
    out.push({
      content: `Recovery skill auto-applied: ${t}${detail ? ' — ' + detail : ''}.`,
      tags: [...tags],
      region: REGION_HEAL,
    });
  }

  // 2. UI-structure / timing notes -> parietal_left.
  const notes = Array.isArray(ctx.notes) ? ctx.notes : [];
  for (const n of notes) {
    const text = typeof n === 'string' ? n.trim() : (n && typeof n.text === 'string' ? n.text.trim() : '');
    if (!text) continue;
    out.push({ content: text, tags: [...tags], region: REGION_UI });
  }

  return out;
}

// ========== Content hash (concurrency / forward-compat dedupe) ==========

/**
 * SHA-256 hex hash over (source + region + redacted content). Computed
 * client-side so a future server-side dedupe layer can collapse duplicate
 * writes from many installs. The live API does not dedupe today (see the
 * CONCURRENCY/DEDUPE note at the top of this file), so this field is currently
 * ignored by the server — harmless until it isn't.
 * @param {string} content
 * @param {string} region
 * @returns {Promise<string>} 64-char hex digest, or '' if Web Crypto is absent.
 */
async function _contentHash(content, region) {
  try {
    const data = `${SOURCE}\u0000${region}\u0000${String(content || '')}`;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (_e) {
    return ''; // Web Crypto unavailable -> ship without a hash (still valid).
  }
}

// ========== Shipping ==========

/**
 * POST one neuron to Neuralis /neurons/think. Throws on failure so the
 * orchestrator can fail open.
 * @param {{content:string, region:string}} neuron
 * @param {{baseUrl?:string, timeout?:number}} [opts]
 */
export async function shipNeuron(neuron, opts = {}) {
  const baseUrl = (opts && typeof opts.baseUrl === 'string' && opts.baseUrl.trim())
    ? opts.baseUrl.trim().replace(/\/+$/, '')
    : DEFAULT_BASE_URL;
  const timeout = (opts && Number.isFinite(opts.timeout) && opts.timeout > 0)
    ? opts.timeout
    : DEFAULT_TIMEOUT_MS;
  const region = (neuron && typeof neuron.region === 'string' && neuron.region.trim())
    ? neuron.region.trim()
    : REGION_FALLBACK;
  const content = String((neuron && neuron.content) || '');

  // Forward-compat dedupe key: client-side SHA-256 over source+region+content.
  const content_hash = await _contentHash(content, region);

  const body = JSON.stringify({
    content,
    region,
    source: SOURCE,
    // Ignored by the live API today; present so a future dedupe layer can use it.
    content_hash,
  });

  let resp;
  try {
    resp = await fetch(`${baseUrl}/neurons/think`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(`Brain producer POST failed: ${(e && e.message) ? e.message : String(e)}`);
  }
  if (!resp || !resp.ok) {
    const status = resp ? resp.status : 0;
    throw new Error(`Brain producer non-200: ${status}`);
  }
  try {
    return await resp.json();
  } catch (_e) {
    return { ok: true };
  }
}

// ========== Consent ==========

/**
 * Read consent state. Returns { enabled, confirmed } where confirmed means the
 * toggle is on AND the last confirmation is within CONFIRM_STALE_MS.
 * @returns {Promise<{enabled:boolean, confirmed:boolean, needsReconfirm:boolean}>}
 */
async function _readConsent() {
  try {
    const obj = await chrome.storage.local.get({
      brainProducerEnabled: false,
      brainProducerLastConfirmedAt: null,
    });
    const enabled = obj.brainProducerEnabled === true;
    if (!enabled) return { enabled: false, confirmed: false, needsReconfirm: false };
    const ts = obj.brainProducerLastConfirmedAt;
    let ageOk = false;
    if (typeof ts === 'string' && ts) {
      const t = Date.parse(ts);
      if (Number.isFinite(t) && (Date.now() - t) <= CONFIRM_STALE_MS) ageOk = true;
    }
    return { enabled: true, confirmed: ageOk, needsReconfirm: !ageOk };
  } catch (_e) {
    return { enabled: false, confirmed: false, needsReconfirm: false };
  }
}

// ========== Orchestrator (ONLY public entry point agent-engine calls) ==========

/**
 * Run-end orchestrator: consent-gate, build candidates, redact each, ship
 * survivors. FAILS OPEN by construction — any error returns a result, never
 * throws into the run-finish path.
 *
 * @param {object} runContext - { platformId, healingHistory, recoveryEvents, notes, clientIdentity }
 * @returns {Promise<{ok:boolean, shipped:number, dropped:number, needsReconfirm?:boolean, error?:string}>}
 */
export async function publishRunLearning(runContext = {}) {
  // Consent gate (master toggle + freshness).
  let consent;
  try {
    consent = await _readConsent();
  } catch (_e) {
    consent = { enabled: false, confirmed: false, needsReconfirm: false };
  }
  if (!consent.enabled || !consent.confirmed) {
    return { ok: false, shipped: 0, dropped: 0, needsReconfirm: consent.needsReconfirm };
  }

  // Build raw candidates, then preload the denylist once and redact each.
  let raw = [];
  try {
    raw = buildCandidates(runContext);
  } catch (_e) {
    raw = [];
  }
  if (!raw.length) return { ok: true, shipped: 0, dropped: 0 };

  const clientIdentity = (runContext && runContext.clientIdentity) || {};
  let denylist = [];
  try {
    denylist = await _loadDenylist(clientIdentity);
  } catch (_e) {
    // Conservative: if we can't build a denylist and there's an active client,
    // drop everything rather than risk a leak.
    if (clientIdentity && (clientIdentity.displayName || clientIdentity.tenant)) {
      return { ok: false, shipped: 0, dropped: raw.length };
    }
  }

  const survivors = [];
  let dropped = 0;
  for (const c of raw) {
    const safe = _redactWithDenylist(c.content, denylist);
    if (safe) survivors.push({ content: safe, region: c.region });
    else dropped++;
  }
  if (!survivors.length) {
    // Fail-closed: nothing cleared the gate. No fetch.
    return { ok: false, shipped: 0, dropped };
  }

  // Ship survivors. NO OFFLINE QUEUE — a down brain drops the learning.
  let cfg;
  try {
    cfg = await _readConfig();
  } catch (_e) {
    cfg = { baseUrl: DEFAULT_BASE_URL, timeout: DEFAULT_TIMEOUT_MS };
  }
  let shipped = 0;
  let lastError = null;
  for (const n of survivors) {
    try {
      await shipNeuron(n, cfg);
      shipped++;
    } catch (e) {
      // Brain down / non-200 — drop this one and the rest (no queue), but keep
      // the run-finish path unaffected. Signal the user once per run that the
      // brain was unreachable (distinct from gate-rejected candidates, which
      // never reach here and are NOT an outage).
      lastError = (e && e.message) ? e.message : String(e);
      _warnProducerUnreachable(lastError);
      break;
    }
  }
  return {
    ok: shipped > 0,
    shipped,
    dropped,
    error: lastError || undefined,
  };
}
