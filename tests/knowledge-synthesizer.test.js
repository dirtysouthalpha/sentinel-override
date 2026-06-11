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

describe('synthesizeKnowledge - conflict detection (line 149)', () => {
  test('flags conflict when similar items have confidence range > 0.3', async () => {
    // Two items with nearly identical content but very different confidences → merge triggers hasConflicts
    const result = await synthesizeKnowledge([
      { type: 'action', content: 'the server is running normally without errors', confidence: 0.1, source: 'a' },
      { type: 'action', content: 'the server is running normally without errors', confidence: 0.9, source: 'b' }
    ]);
    expect(result.conflicts.length).toBeGreaterThan(0);
    const conflict = result.conflicts[0];
    expect(conflict.severity).toBe('medium');
    expect(conflict.type).toBe('action');
  });
});

describe('synthesizeKnowledge - areContradictory returns false (line 458)', () => {
  test('no conflict when items share words but both have negation', async () => {
    // Both contain "not" → hasNegation1 === hasNegation2 → areContradictory returns false
    const result = await synthesizeKnowledge([
      { type: 'observation', content: 'the button is not visible on page', confidence: 0.5, source: 'a' },
      { type: 'form',        content: 'the form is not visible on page', confidence: 0.5, source: 'b' }
    ]);
    // Cross-type conflict detection runs but finds no actual contradiction
    const crossConflicts = result.conflicts.filter(c => c.type === 'cross_type');
    expect(crossConflicts.length).toBe(0);
  });
});

describe('storeSynthesis - entry trimming (line 473)', () => {
  test('trims to MAX_SYNTHESIS_ENTRIES when storage has 1000+ entries', async () => {
    const STORAGE_KEY = 'synthesized_knowledge_current';
    const existingEntries = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    chrome.storage.local.get.mockImplementationOnce(async () => ({
      [STORAGE_KEY]: { entries: existingEntries }
    }));
    const synthesis = { synthesized: [], conflicts: [], gaps: [], summary: 'overflow' };
    await storeSynthesis(synthesis);
    const saved = storageMock[STORAGE_KEY];
    expect(saved.entries.length).toBeLessThanOrEqual(1000);
    expect(saved.entries[saved.entries.length - 1].summary).toBe('overflow');
  });
});

describe('knowledge-synthesizer — uncovered branch paths', () => {
  test('storeSynthesis handles storage.set error gracefully', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('disk full'));
    await expect(storeSynthesis({ synthesized: [], conflicts: [], gaps: [], summary: 'x' }))
      .resolves.not.toThrow();
  });

  test('identifyKnowledgeGaps skips gap when source content covers it', async () => {
    // "error handling" appears in content → gap "error_handling" is filled → not reported
    const result = await synthesizeKnowledge([
      { type: 'action', content: 'with proper error handling implemented', confidence: 0.8, source: 'llm' }
    ]);
    const filledGap = result.gaps.find(g => g.gap === 'error_handling');
    expect(filledGap).toBeUndefined();
  });

  test('groupByType uses generic fallback for source without type', async () => {
    // source.type is falsy → grouped under 'generic'
    const result = await synthesizeKnowledge([
      { content: 'some content with no type field', confidence: 0.7, source: 'test' }
    ]);
    expect(result.synthesized.length).toBeGreaterThan(0);
  });

  test('areSemanticallySimilar returns false when words have no 4-char terms', async () => {
    // All words are < 4 chars → filter returns empty arrays → early return false
    // → no cross-type synthesis items generated
    const result = await synthesizeKnowledge([
      { type: 'action', content: 'a bc de', confidence: 0.5, source: 's1' },
      { type: 'observation', content: 'a bc de', confidence: 0.5, source: 's2' }
    ]);
    const crossItems = result.synthesized.filter(i => i.type === 'cross_type');
    expect(crossItems.length).toBe(0);
  });

  test('groupBySemanticSimilarity skips already-assigned items (outer continue)', async () => {
    // 3 sources of different types with identical long-word content → all 3 synthesized items
    // are semantically similar → items[1] and items[2] assigned at i=0 → outer continue fires
    const content = 'clicking login button form screen';
    const result = await synthesizeKnowledge([
      { type: 'action', content, confidence: 0.8, source: 's1' },
      { type: 'observation', content, confidence: 0.7, source: 's2' },
      { type: 'decision', content, confidence: 0.6, source: 's3' }
    ]);
    const crossItems = result.synthesized.filter(i => i.type === 'cross_type');
    expect(crossItems.length).toBeGreaterThan(0);
    expect(crossItems.length).toBe(1); // 3 items → 1 group, not 2
  });

  test('getSynthesisStatistics accumulates items without a type key', async () => {
    await storeSynthesis({
      synthesized: [{ content: 'no type here' }],
      conflicts: [],
      gaps: [],
      summary: 'test'
    });
    const stats = await getSynthesisStatistics();
    expect(stats.totalSynthesized).toBe(1);
  });
});
