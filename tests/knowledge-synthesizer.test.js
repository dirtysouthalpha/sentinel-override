/**
 * Tests for background/knowledge-synthesizer.js
 */

import { jest } from '@jest/globals';
import {
  synthesizeKnowledge,
  storeSynthesis,
  getSynthesis,
  getSynthesisStatistics,
  clearSynthesis
} from '../background/knowledge-synthesizer.js';

const storageMock = {};
globalThis.chrome = {
  storage: {
    local: {
      set: jest.fn(async (obj) => { Object.assign(storageMock, obj); }),
      get: jest.fn(async (keys) => {
        const r = {};
        for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) r[k] = storageMock[k];
        return r;
      }),
      remove: jest.fn(async (key) => { delete storageMock[key]; })
    }
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(storageMock).forEach(k => delete storageMock[k]);
});

describe('synthesizeKnowledge - run summary form', () => {
  test('accepts run summary object and returns synthesis', async () => {
    const result = await synthesizeKnowledge({
      goal: 'Submit the form',
      history: [1, 2, 3],
      biasStats: { totalDetections: 2 },
      contradictionStats: { totalDetections: 1 },
      reasoningTrace: { totalSteps: 5 }
    });
    expect(result).toHaveProperty('synthesized');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toContain('Submit the form');
    expect(result.summary).toContain('Steps: 3');
  });

  test('handles missing fields in run summary', async () => {
    const result = await synthesizeKnowledge({});
    expect(result.summary).toContain('(none)');
    expect(result.summary).toContain('Steps: 0');
  });

  test('stores result to chrome storage', async () => {
    await synthesizeKnowledge({ goal: 'test' });
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });
});

describe('synthesizeKnowledge - array sources form', () => {
  test('returns empty result for empty array', async () => {
    const result = await synthesizeKnowledge([]);
    expect(result.synthesized).toEqual([]);
    expect(result.summary).toBe('No sources provided.');
  });

  test('returns empty result for null', async () => {
    const result = await synthesizeKnowledge(null);
    expect(result.synthesized).toEqual([]);
    expect(result.summary).toBe('No sources provided.');
  });

  test('synthesizes array of sources', async () => {
    const sources = [
      { type: 'action', content: 'Click the submit button', confidence: 0.9, source: 'llm' },
      { type: 'action', content: 'Click the cancel button', confidence: 0.8, source: 'llm' }
    ];
    const result = await synthesizeKnowledge(sources);
    expect(result).toHaveProperty('synthesized');
    expect(result).toHaveProperty('conflicts');
    expect(result).toHaveProperty('gaps');
    expect(typeof result.summary).toBe('string');
  });

  test('merges similar sources', async () => {
    const sources = [
      { type: 'observation', content: 'The page has a login form with fields', confidence: 0.8, source: 'llm' },
      { type: 'observation', content: 'The page has a login form with inputs', confidence: 0.7, source: 'llm' }
    ];
    const result = await synthesizeKnowledge(sources);
    expect(result.synthesized.length).toBeGreaterThan(0);
  });

  test('groups sources by type and identifies gaps', async () => {
    const sources = [
      { type: 'decision', content: 'Choose action A over B', confidence: 0.9, source: 'llm' }
    ];
    const result = await synthesizeKnowledge(sources);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  test('identifies conflicts across types', async () => {
    const sources = [
      { type: 'action', content: 'The form is valid and submitted', confidence: 0.9, source: 'src1' },
      { type: 'observation', content: 'The form is not valid and submitted', confidence: 0.8, source: 'src2' }
    ];
    const result = await synthesizeKnowledge(sources);
    expect(result).toHaveProperty('conflicts');
    expect(Array.isArray(result.conflicts)).toBe(true);
  });
});

describe('storeSynthesis and getSynthesis', () => {
  test('stores and retrieves synthesis', async () => {
    const synthesis = { synthesized: [{ type: 'test', content: 'data' }], conflicts: [], gaps: [], summary: 'test' };
    await storeSynthesis(synthesis);
    const stored = await getSynthesis();
    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0].summary).toBe('test');
  });

  test('returns empty entries when nothing stored', async () => {
    const stored = await getSynthesis();
    expect(stored.entries).toEqual([]);
  });

  test('accumulates multiple syntheses', async () => {
    await storeSynthesis({ synthesized: [], conflicts: [], gaps: [], summary: 'first' });
    await storeSynthesis({ synthesized: [], conflicts: [], gaps: [], summary: 'second' });
    const stored = await getSynthesis();
    expect(stored.entries).toHaveLength(2);
  });

  test('handles storage error gracefully', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage error'));
    const stored = await getSynthesis();
    expect(stored).toEqual({ entries: [] });
  });

  test('handles store error gracefully', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('store error'));
    await expect(storeSynthesis({ synthesized: [], conflicts: [], gaps: [] })).resolves.not.toThrow();
  });
});

describe('getSynthesisStatistics', () => {
  test('returns zero stats when empty', async () => {
    const stats = await getSynthesisStatistics();
    expect(stats.totalSyntheses).toBe(0);
    expect(stats.totalSynthesized).toBe(0);
    expect(stats.totalConflicts).toBe(0);
    expect(stats.totalGaps).toBe(0);
  });

  test('counts synthesized items and conflicts', async () => {
    const synthesis = {
      synthesized: [{ type: 'action' }, { type: 'action' }],
      conflicts: [{ type: 'cross_type' }],
      gaps: [{ type: 'action', gap: 'error_handling' }],
      summary: 'test'
    };
    await storeSynthesis(synthesis);
    const stats = await getSynthesisStatistics();
    expect(stats.totalSyntheses).toBe(1);
    expect(stats.totalSynthesized).toBe(2);
    expect(stats.totalConflicts).toBe(1);
    expect(stats.totalGaps).toBe(1);
    expect(stats.byType.action).toBe(2);
  });
});

describe('clearSynthesis', () => {
  test('clears stored synthesis', async () => {
    await storeSynthesis({ synthesized: [{ type: 'test' }], conflicts: [], gaps: [], summary: 'test' });
    await clearSynthesis();
    const stored = await getSynthesis();
    expect(stored.entries).toEqual([]);
  });

  test('handles clearing empty storage gracefully', async () => {
    await expect(clearSynthesis()).resolves.not.toThrow();
  });

  test('handles storage error on clear gracefully', async () => {
    chrome.storage.local.remove.mockRejectedValueOnce(new Error('remove error'));
    await expect(clearSynthesis()).resolves.not.toThrow();
  });
});
