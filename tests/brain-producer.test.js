// tests/brain-producer.test.js
// Tests for background/brain-producer.js — the Neuralis brain WRITE path.
//
// THE REDACTION GATE IS THE PRIMARY TEST TARGET. This is the trust-critical
// sub-project: the whole job is to prove client-identifying data can NEVER
// reach the shared brain. Per the design spec
// (docs/superpowers/specs/2026-06-19-sentinel-producer-brain-design.md):
//   1. PII scrub (reuse _scrubPii from agent-reporting.js)
//   2. Client-entity denylist — if scrubbed content still contains the active
//      client's name / tenant / any known client id, DROP the whole candidate.
//      Fail-closed.
//   3. Length/sanity — cap 1000 chars, drop empties.
//
// Recovery-event data structure discovered in agent-engine.js (recorded in
// brain-producer.js too):
//   - healingHistory (line 686): array of RuntimeProfiler.heal() results pushed
//     only when healingResult.healed === true. Shape: { id, status:'healed',
//     attempts, successStrategy, endTime }. successStrategy = the recovery that
//     worked — highest-value procedural knowledge.
//   - _learnedPatterns (line 679): { "type:selector": {uses,successes,lastUsed} }.
//   - runRecoverySkills result: { appliedSkillIds, autoApply, promptInjection }.
// A "failed-then-recovered" action = a healingHistory entry (status 'healed') OR
// a recovery skill that auto-applied (autoApply present).

import { jest } from '@jest/globals';

// ── Chrome storage mock ──
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const defs = (typeof keys === 'object' && !Array.isArray(keys)) ? keys : {};
        const list = Array.isArray(keys) ? keys : Object.keys(defs);
        for (const k of list) result[k] = (k in storageData) ? storageData[k] : defs[k];
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
    },
  },
};

globalThis.fetch = jest.fn();
let producer;

async function loadProducer() {
  producer = await import('../background/brain-producer.js');
  return producer;
}

beforeEach(async () => {
  Object.keys(storageData).forEach((k) => delete storageData[k]);
  jest.clearAllMocks();
  globalThis.fetch = jest.fn();
  producer = await loadProducer();
});

// Sample client identity the denylist must catch.
const ACME = { displayName: 'Acme Corp', tenant: 'acme.onmicrosoft.com' };
const ACME_CLIENTS = {
  'acme-corp': { id: 'acme-corp', displayName: 'Acme Corp', tenant: 'acme.onmicrosoft.com' },
  'globex': { id: 'globex', displayName: 'Globex Inc', tenant: 'globex.onmicrosoft.com' },
};

// ──────────────────────────────────────────────────────────────────────
// redactCandidate — THE TRUST GATE
// ──────────────────────────────────────────────────────────────────────
describe('redactCandidate — the redaction gate (primary target)', () => {
  test('content with an IP -> IP redacted, candidate SURVIVES', async () => {
    const out = await producer.redactCandidate('Server at 192.168.1.50 responded slowly', {});
    expect(out).not.toBeNull();
    expect(out).toContain('[REDACTED:ip]');
    expect(out).not.toContain('192.168.1.50');
  });

  test('content with the client name -> returns null (denylist fires)', async () => {
    const out = await producer.redactCandidate('Acme Corp uses a SAML proxy for login', ACME);
    expect(out).toBeNull();
  });

  test('content with the tenant -> returns null', async () => {
    const out = await producer.redactCandidate('Tenant acme.onmicrosoft.com requires MFA', ACME);
    expect(out).toBeNull();
  });

  test('content with a known client id from storage -> returns null', async () => {
    storageData.sentinelClientKnowledge = { activeClientId: 'globex', clients: ACME_CLIENTS };
    // "Globex Inc" is a known client display name in storage
    const out = await producer.redactCandidate('Globex Inc portal loads slowly on Mondays', ACME);
    expect(out).toBeNull();
  });

  test('clean procedural content -> passes through unchanged', async () => {
    const clean = 'The Advanced toggle must be enabled before the PSK field appears';
    const out = await producer.redactCandidate(clean, {});
    expect(out).toBe(clean);
  });

  test('quoted client string -> redacted, candidate survives if no client name', async () => {
    // "M365 Admin" is a quoted string but NOT the active client name -> scrubbed
    const out = await producer.redactCandidate('Page title was "M365 Admin" center', ACME);
    expect(out).not.toBeNull();
    expect(out).toContain('[REDACTED:client]');
    expect(out).not.toContain('"M365 Admin"');
  });

  test('email redacted, candidate survives if not client-identifying', async () => {
    const out = await producer.redactCandidate('Contact admin@example.com for access', ACME);
    expect(out).not.toBeNull();
    expect(out).toContain('[REDACTED:email]');
  });

  test('content over 1000 chars -> dropped (length gate)', async () => {
    const long = 'x'.repeat(1200);
    expect(await producer.redactCandidate(long, {})).toBeNull();
  });

  test('empty/whitespace content -> dropped', async () => {
    expect(await producer.redactCandidate('', {})).toBeNull();
    expect(await producer.redactCandidate('   ', {})).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// buildCandidates
// ──────────────────────────────────────────────────────────────────────
describe('buildCandidates', () => {
  test('run with a successful self-heal -> hippocampus candidate', () => {
    const ctx = {
      platformId: 'm365_admin',
      healingHistory: [{ id: 'h1', status: 'healed', attempts: 2, successStrategy: 'retry_with_xpath', endTime: Date.now() }],
      recoveryEvents: [],
      notes: [],
    };
    const cands = producer.buildCandidates(ctx);
    expect(cands.length).toBeGreaterThanOrEqual(1);
    const healCand = cands.find(c => c.region === 'hippocampus');
    expect(healCand).toBeDefined();
    expect(healCand.tags).toContain('m365_admin');
    expect(healCand.content).toContain('retry_with_xpath');
  });

  test('run with no recoveries -> fewer (or zero) candidates', () => {
    const ctx = { platformId: 'm365_admin', healingHistory: [], recoveryEvents: [], notes: [] };
    const cands = producer.buildCandidates(ctx);
    // No self-heals and no notes -> at most a platform-tag-only candidate,
    // but platform id is a TAG never content, so no real content candidate.
    const contentCandidates = cands.filter(c => c.content && c.content.trim());
    expect(contentCandidates.length).toBe(0);
  });

  test('UI-structure note -> parietal_left candidate', () => {
    const ctx = {
      platformId: 'sonicwall_nsm',
      healingHistory: [],
      recoveryEvents: [],
      notes: ['The VPN policy form hides the PSK field behind the Advanced toggle'],
    };
    const cands = producer.buildCandidates(ctx);
    const noteCand = cands.find(c => c.region === 'parietal_left');
    expect(noteCand).toBeDefined();
    expect(noteCand.content).toContain('Advanced toggle');
  });
});

// ──────────────────────────────────────────────────────────────────────
// publishRunLearning — orchestrator (fails-open, consent-gated)
// ──────────────────────────────────────────────────────────────────────
describe('publishRunLearning — consent + fail-open/fail-closed', () => {
  const goodCtx = () => ({
    platformId: 'm365_admin',
    healingHistory: [{ id: 'h1', status: 'healed', attempts: 1, successStrategy: 'fallback_selector', endTime: Date.now() }],
    recoveryEvents: [],
    notes: ['The form requires Advanced toggle first'],
    clientIdentity: { displayName: 'Unrelated Co', tenant: 'unrelated.onmicrosoft.com' },
  });

  test('toggle OFF -> NO fetch calls', async () => {
    storageData.brainProducerEnabled = false;
    const res = await producer.publishRunLearning(goodCtx());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  test('toggle ON but NOT confirmed (no lastConfirmedAt) -> NO fetch calls', async () => {
    storageData.brainProducerEnabled = true;
    // brainProducerLastConfirmedAt absent -> not confirmed
    const res = await producer.publishRunLearning(goodCtx());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  test('toggle ON, confirmed, but ALL candidates fail the gate -> NO fetch (fail-closed)', async () => {
    storageData.brainProducerEnabled = true;
    storageData.brainProducerLastConfirmedAt = new Date().toISOString();
    // The ONLY candidate references the active client name UNQUOTED, so the PII
    // scrub (which catches *quoted* strings) leaves "acme corp" intact and the
    // client denylist must drop it. No healing event (which would quote-wrap its
    // strategy name and survive). Proves the denylist fires when the scrub can't.
    const ctx = {
      platformId: 'm365_admin',
      healingHistory: [],
      recoveryEvents: [],
      notes: ['Acme Corp custom flow requires a special flag'],
      clientIdentity: ACME,
    };
    const res = await producer.publishRunLearning(ctx);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(res.shipped).toBe(0);
  });

  test('toggle ON + confirmed + survivors -> POST /neurons/think with source sentinel-override', async () => {
    storageData.brainProducerEnabled = true;
    storageData.brainProducerLastConfirmedAt = new Date().toISOString();
    storageData.brainBaseUrl = 'http://localhost:8000';
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ neuron: { id: 999 } }) });
    const res = await producer.publishRunLearning(goodCtx());
    expect(globalThis.fetch).toHaveBeenCalled();
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toBe('http://localhost:8000/neurons/think');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.source).toBe('sentinel-override');
    expect(body.content).not.toContain('Unrelated'); // client name must not survive
    expect(res.shipped).toBeGreaterThan(0);
    expect(res.ok).toBe(true);
  });

  test('confirmation older than 7 days -> re-prompt required, NO fetch', async () => {
    storageData.brainProducerEnabled = true;
    // 10 days ago
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    storageData.brainProducerLastConfirmedAt = old;
    const res = await producer.publishRunLearning(goodCtx());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.needsReconfirm).toBe(true);
  });

  test('ANY fetch error -> caught, run-finish path unaffected (fails-open)', async () => {
    storageData.brainProducerEnabled = true;
    storageData.brainProducerLastConfirmedAt = new Date().toISOString();
    globalThis.fetch.mockRejectedValue(new Error('Connection refused'));
    const res = await producer.publishRunLearning(goodCtx());
    // Must NOT throw; returns a result with ok:false
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  test('non-200 response -> caught, fails-open (no throw)', async () => {
    storageData.brainProducerEnabled = true;
    storageData.brainProducerLastConfirmedAt = new Date().toISOString();
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) });
    const res = await producer.publishRunLearning(goodCtx());
    expect(res.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// (hardening 1B) One-warn-per-run signal for the WRITE path
// ──────────────────────────────────────────────────────────────────────
describe('publishRunLearning — one-warn-per-run signal (1B)', () => {
  const goodCtx = () => ({
    platformId: 'm365_admin',
    healingHistory: [{ id: 'h1', status: 'healed', attempts: 1, successStrategy: 'fallback_selector', endTime: Date.now() }],
    recoveryEvents: [],
    notes: [],
    clientIdentity: { displayName: 'Unrelated Co', tenant: 'unrelated.onmicrosoft.com' },
  });

  beforeEach(() => { producer.resetBrainProducerRunSignals(); });

  test('network failure -> exactly ONE console.warn (unreachable)', async () => {
    storageData.brainProducerEnabled = true;
    storageData.brainProducerLastConfirmedAt = new Date().toISOString();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch.mockRejectedValue(new Error('Connection refused'));
    await producer.publishRunLearning(goodCtx());
    // Second ship attempt in the same run -> still one warn.
    await producer.publishRunLearning(goodCtx());
    const warns = warnSpy.mock.calls.filter((a) => String(a[0]).includes('BrainProducer') && String(a[0]).includes('UNREACHABLE'));
    expect(warns).toHaveLength(1);
    warnSpy.mockRestore();
  });

  test('success -> ZERO warns', async () => {
    storageData.brainProducerEnabled = true;
    storageData.brainProducerLastConfirmedAt = new Date().toISOString();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ neuron: { id: 1 } }) });
    await producer.publishRunLearning(goodCtx());
    expect(warnSpy.mock.calls.filter((a) => String(a[0]).includes('BrainProducer'))).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test('gate-rejected candidates -> ZERO warns (NOT an outage, the trust gate worked)', async () => {
    storageData.brainProducerEnabled = true;
    storageData.brainProducerLastConfirmedAt = new Date().toISOString();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // ONLY candidate references the client name -> denylist drops it; never
    // reaches fetch, never warns. (No healing survivor, which would ship.)
    const ctx = {
      platformId: 'm365_admin',
      healingHistory: [],
      recoveryEvents: [],
      notes: ['Acme Corp custom flow'],
      clientIdentity: ACME,
    };
    await producer.publishRunLearning(ctx);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.filter((a) => String(a[0]).includes('BrainProducer'))).toHaveLength(0);
    warnSpy.mockRestore();
  });
});
