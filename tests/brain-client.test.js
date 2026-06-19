// tests/brain-client.test.js
// Tests for background/brain-client.js — the Neuralis brain READ client.
//
// Two layers, per the design spec
// (docs/superpowers/specs/2026-06-19-sentinel-consumer-brain-design.md):
//   1. formatBrainSection / recallNeurons — pure formatting + HTTP translation.
//   2. getBrainStartupContext — the orchestrator. The fails-open guarantee is
//      itself a test target: EVERY error path returns { ok:false, section:'' }.
//
// Discovered neuron shape (live probe of GET /recall?context=premier):
//   {
//     "context": "...",
//     "direct":   [ { id, content: "[src] the fact...", region, fire_count, ... } ],
//     "associated":[ { id, content: "[src] ...", region, ..., synapse_strength, connected_to } ]
//   }
// IMPORTANT: /recall does NOT return a standalone `source` field. The source
// is embedded as the LEADING "[tag]" prefix on `content` (e.g. "[zcode] ...",
// "[premierbot-seed] ..."). formatBrainSection parses that tag; absent tag =>
// [src:unknown]. This is recorded in a comment in brain-client.js too.

import { jest } from '@jest/globals';

// ── Chrome storage mock (config keys: brainBaseUrl, brainTimeout, brainEnabled) ──
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
    },
  },
};

// fetch is mocked per-test via globalThis.fetch / jest.fn().
let brainClient;

async function loadBrainClient() {
  // Dynamic import after mocks are in place.
  brainClient = await import('../background/brain-client.js');
  return brainClient;
}

function directNeuron(content, overrides = {}) {
  return { id: 1, content, region: 'hippocampus', fire_count: 1, ...overrides };
}
function associatedNeuron(content, overrides = {}) {
  return { id: 51, content, region: 'prefrontal_left', fire_count: 1,
    synapse_strength: 0.1, connected_to: 1, ...overrides };
}

beforeEach(async () => {
  Object.keys(storageData).forEach((k) => delete storageData[k]);
  jest.clearAllMocks();
  globalThis.fetch = jest.fn();
  brainClient = await loadBrainClient();
});

// ──────────────────────────────────────────────────────────────────────
describe('formatBrainSection', () => {
  test('empty input -> empty string', () => {
    expect(brainClient.formatBrainSection([], [])).toBe('');
    expect(brainClient.formatBrainSection(undefined, undefined)).toBe('');
  });

  test('direct + associated -> distinct labeled section with [src:] tags', () => {
    const direct = [directNeuron('[zcode] M365 admin sync takes ~5 min')];
    const associated = [associatedNeuron('[premierbot-seed] Check Entra audit logs')];
    const out = brainClient.formatBrainSection(direct, associated);

    expect(out).toContain('## BRAIN KNOWLEDGE (shared, cross-installation)');
    expect(out).toContain('[src:zcode]');
    expect(out).toContain('M365 admin sync takes ~5 min');
    expect(out).toContain('[src:premierbot-seed]');
    expect(out).toContain('Check Entra audit logs');
  });

  test('parses the leading [tag] source from content; absent tag -> [src:unknown]', () => {
    const direct = [
      directNeuron('[sentinel-override] fact one'),
      directNeuron('no leading tag here'),
    ];
    const out = brainClient.formatBrainSection(direct, []);
    expect(out).toContain('[src:sentinel-override]');
    expect(out).toContain('[src:unknown]');
    expect(out).not.toContain('[no leading tag here]'); // tag stripped from display line
  });

  test('only associated neurons still renders the section', () => {
    const out = brainClient.formatBrainSection([], [associatedNeuron('[zcode] assoc fact')]);
    expect(out).toContain('## BRAIN KNOWLEDGE');
    expect(out).toContain('[src:zcode]');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('recallNeurons', () => {
  test('success -> parsed { direct, associated }', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ direct: [directNeuron('[zcode] x')], associated: [] }),
    });
    const res = await brainClient.recallNeurons('m365_admin', { baseUrl: 'http://localhost:8000' });
    expect(res.direct).toHaveLength(1);
    expect(res.associated).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('builds the correct GET URL', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ direct: [], associated: [] }) });
    await brainClient.recallNeurons('m365 admin', { baseUrl: 'http://localhost:8000' });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    // encodeURIComponent encodes a space as %20 (the safe form for a query
    // string; '+' is only valid in application/x-www-form-urlencoded bodies).
    expect(String(url)).toBe('http://localhost:8000/recall?context=m365%20admin');
    expect(opts.method).toBe('GET');
  });

  test('non-200 -> throws', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({ detail: 'boom' }) });
    await expect(brainClient.recallNeurons('x')).rejects.toThrow();
  });

  test('network error -> throws', async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(brainClient.recallNeurons('x')).rejects.toThrow();
  });

  test('malformed JSON -> throws', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
    await expect(brainClient.recallNeurons('x')).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getBrainStartupContext — fails-open guarantee', () => {
  test('toggle OFF -> returns empty WITHOUT calling fetch', async () => {
    storageData.brainEnabled = false;
    const res = await brainClient.getBrainStartupContext('m365_admin');
    expect(res).toEqual({ ok: false, section: '', directCount: 0, associatedCount: 0 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('toggle ON + success -> ok:true with section + counts', async () => {
    storageData.brainEnabled = true;
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ direct: [directNeuron('[zcode] a'), directNeuron('[zcode] b')], associated: [associatedNeuron('[zcode] c')] }),
    });
    const res = await brainClient.getBrainStartupContext('m365_admin');
    expect(res.ok).toBe(true);
    expect(res.directCount).toBe(2);
    expect(res.associatedCount).toBe(1);
    expect(res.section).toContain('## BRAIN KNOWLEDGE');
  });

  test('toggle ON + empty results -> ok:true, empty section', async () => {
    storageData.brainEnabled = true;
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ direct: [], associated: [] }) });
    const res = await brainClient.getBrainStartupContext('m365_admin');
    expect(res.ok).toBe(true);
    expect(res.section).toBe('');
    expect(res.directCount).toBe(0);
  });

  test('network error -> { ok:false, section:"" } (never throws into run path)', async () => {
    storageData.brainEnabled = true;
    globalThis.fetch.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await brainClient.getBrainStartupContext('m365_admin');
    expect(res).toEqual({ ok: false, section: '', directCount: 0, associatedCount: 0, error: expect.any(String) });
  });

  test('non-200 -> { ok:false, section:"" }', async () => {
    storageData.brainEnabled = true;
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Down', json: async () => ({}) });
    const res = await brainClient.getBrainStartupContext('m365_admin');
    expect(res.ok).toBe(false);
    expect(res.section).toBe('');
  });

  test('malformed JSON -> { ok:false, section:"" }', async () => {
    storageData.brainEnabled = true;
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
    const res = await brainClient.getBrainStartupContext('m365_admin');
    expect(res.ok).toBe(false);
    expect(res.section).toBe('');
  });

  test('respects brainBaseUrl storage override', async () => {
    storageData.brainEnabled = true;
    storageData.brainBaseUrl = 'http://192.168.1.10:9000';
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ direct: [], associated: [] }) });
    await brainClient.getBrainStartupContext('x');
    const [url] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toContain('192.168.1.10:9000');
  });
});
