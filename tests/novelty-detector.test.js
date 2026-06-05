/**
 * Tests for background/novelty-detector.js
 */

import { jest } from '@jest/globals';
import {
  analyzeForNovelty,
  storeNoveltyResult,
  getNoveltyHistory,
  getNoveltyStatistics,
  clearNoveltyHistory
} from '../background/novelty-detector.js';

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

describe('analyzeForNovelty', () => {
  test('marks content as novel when no history exists', async () => {
    const result = await analyzeForNovelty('run1', { type: 'action', content: 'Click the submit button', context: {} });
    expect(result).toHaveProperty('isNovel');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reasons');
    expect(result.isNovel).toBe(true);
  });

  test('returns not novel for empty content', async () => {
    const result = await analyzeForNovelty('run1', { type: 'action', content: '', context: {} });
    expect(result.isNovel).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test('returns not novel for null content', async () => {
    const result = await analyzeForNovelty('run1', { type: 'action', content: null, context: {} });
    expect(result.isNovel).toBe(false);
  });

  test('returns not novel for non-string content', async () => {
    const result = await analyzeForNovelty('run1', { type: 'action', content: 42, context: {} });
    expect(result.isNovel).toBe(false);
  });

  test('marks repeated content as less novel than first occurrence', async () => {
    const runId = 'run_repeat';
    const data = { type: 'action', content: 'Click the submit button on the form', context: { page: 'login' } };

    const result1 = await analyzeForNovelty(runId, data);
    await storeNoveltyResult(runId, data, result1);

    // Same content again
    const result2 = await analyzeForNovelty(runId, data);
    expect(result2.isNovel).toBe(false);
  });

  test('includes reasons when novel', async () => {
    const result = await analyzeForNovelty('run1', {
      type: 'action',
      content: 'Navigate to completely new unique unexplored destination',
      context: { url: 'https://novel.site.example.com' }
    });
    if (result.isNovel) {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  test('handles action type with behavioral novelty check', async () => {
    const result = await analyzeForNovelty('run1', {
      type: 'action',
      content: 'click on the login button',
      context: { stepCount: 1 }
    });
    expect(typeof result.isNovel).toBe('boolean');
    expect(typeof result.noveltyScore).toBe('number');
  });

  test('handles decision type with behavioral novelty check', async () => {
    const result = await analyzeForNovelty('run1', {
      type: 'decision',
      content: 'choose the fastest route',
      context: {}
    });
    expect(typeof result.isNovel).toBe('boolean');
  });
});

describe('storeNoveltyResult and getNoveltyHistory', () => {
  test('stores and retrieves novelty result', async () => {
    const runId = 'run_store';
    const data = { type: 'action', content: 'click button', context: {} };
    const result = { isNovel: true, confidence: 0.8, reasons: [] };
    await storeNoveltyResult(runId, data, result);

    const history = await getNoveltyHistory(runId);
    expect(history).toHaveLength(1);
    expect(history[0].isNovel).toBe(true);
    expect(history[0].confidence).toBe(0.8);
    expect(history[0].type).toBe('action');
    expect(history[0].content).toBe('click button');
  });

  test('returns empty array when no history', async () => {
    const history = await getNoveltyHistory('nonexistent_run');
    expect(history).toEqual([]);
  });

  test('accumulates multiple results', async () => {
    const runId = 'run_accumulate';
    const data1 = { type: 'action', content: 'click button', context: {} };
    const data2 = { type: 'observation', content: 'form visible', context: {} };
    const result = { isNovel: true, confidence: 0.9, reasons: [] };
    await storeNoveltyResult(runId, data1, result);
    await storeNoveltyResult(runId, data2, result);

    const history = await getNoveltyHistory(runId);
    expect(history).toHaveLength(2);
  });

  test('handles storage error in storeNoveltyResult gracefully', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage error'));
    await expect(storeNoveltyResult('run1', { type: 'action', content: 'test', context: {} }, { isNovel: true })).resolves.not.toThrow();
  });

  test('handles storage error in getNoveltyHistory gracefully', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('get error'));
    const history = await getNoveltyHistory('run1');
    expect(history).toEqual([]);
  });
});

describe('getNoveltyStatistics', () => {
  test('returns zero stats when empty', async () => {
    const stats = await getNoveltyStatistics('empty_run');
    expect(stats.totalItems).toBe(0);
    expect(stats.novelItems).toBe(0);
    expect(stats.noveltyRatio).toBe(0);
    expect(stats.avgConfidence).toBe(0);
  });

  test('calculates correct statistics', async () => {
    const runId = 'run_stats';
    await storeNoveltyResult(runId, { type: 'action', content: 'a', context: {} }, { isNovel: true, confidence: 0.9, reasons: [] });
    await storeNoveltyResult(runId, { type: 'action', content: 'b', context: {} }, { isNovel: false, confidence: 0.3, reasons: [] });
    await storeNoveltyResult(runId, { type: 'observation', content: 'c', context: {} }, { isNovel: true, confidence: 0.8, reasons: [] });

    const stats = await getNoveltyStatistics(runId);
    expect(stats.totalItems).toBe(3);
    expect(stats.novelItems).toBe(2);
    expect(stats.noveltyRatio).toBeCloseTo(2 / 3);
    expect(stats.byType.action).toBe(2);
    expect(stats.byType.observation).toBe(1);
    expect(stats.avgConfidence).toBeCloseTo((0.9 + 0.3 + 0.8) / 3);
  });

  test('uses currentRunId when no runId provided (after storeNoveltyResult)', async () => {
    const runId = 'run_current';
    await storeNoveltyResult(runId, { type: 'action', content: 'test', context: {} }, { isNovel: true, confidence: 0.5, reasons: [] });
    const stats = await getNoveltyStatistics(); // no runId — should use _currentRunId
    expect(stats.totalItems).toBe(1);
  });
});

describe('clearNoveltyHistory', () => {
  test('clears history for a run', async () => {
    const runId = 'run_clear';
    await storeNoveltyResult(runId, { type: 'action', content: 'test', context: {} }, { isNovel: true, confidence: 0.5, reasons: [] });
    await clearNoveltyHistory(runId);
    const history = await getNoveltyHistory(runId);
    expect(history).toEqual([]);
  });

  test('does nothing when no runId and no currentRunId', async () => {
    await expect(clearNoveltyHistory()).resolves.not.toThrow();
  });

  test('clears using currentRunId when no arg passed', async () => {
    const runId = 'run_clear_current';
    await storeNoveltyResult(runId, { type: 'action', content: 'x', context: {} }, { isNovel: true, confidence: 0.5, reasons: [] });
    await clearNoveltyHistory(); // uses _currentRunId set above
    const history = await getNoveltyHistory(runId);
    expect(history).toEqual([]);
  });

  test('handles storage error gracefully', async () => {
    const runId = 'run_clear_err';
    await storeNoveltyResult(runId, { type: 'action', content: 'x', context: {} }, { isNovel: true, confidence: 0.5, reasons: [] });
    chrome.storage.local.remove.mockRejectedValueOnce(new Error('remove error'));
    await expect(clearNoveltyHistory(runId)).resolves.not.toThrow();
  });
});
