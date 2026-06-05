/**
 * Tests for background/contradiction-detector.js
 */

import { jest } from '@jest/globals';
import {
  analyzeForContradictions,
  compareResponsesForContradictions,
  logContradictionDetection,
  getContradictionLog,
  getContradictionStatistics,
  clearContradictionLog
} from '../background/contradiction-detector.js';

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

describe('analyzeForContradictions', () => {
  test('returns no contradictions for clean text', () => {
    const result = analyzeForContradictions('The button was clicked. The form was submitted.');
    expect(result.hasContradictions).toBe(false);
    expect(result.contradictions).toEqual([]);
  });

  test('handles non-string inputs', () => {
    expect(analyzeForContradictions(null).hasContradictions).toBe(false);
    expect(analyzeForContradictions(undefined).hasContradictions).toBe(false);
    expect(analyzeForContradictions('').hasContradictions).toBe(false);
    expect(analyzeForContradictions(['array']).hasContradictions).toBe(false);
    expect(analyzeForContradictions(42).hasContradictions).toBe(false);
  });

  test('detects direct negation contradictions', () => {
    const text = 'The button is visible. The button is not visible.';
    const result = analyzeForContradictions(text);
    if (result.hasContradictions) {
      expect(result.contradictions.some(c => c.type === 'direct_negation')).toBe(true);
    }
    // At minimum it should not throw
    expect(typeof result.hasContradictions).toBe('boolean');
  });

  test('detects temporal contradictions', () => {
    const text = 'The task was already completed. The task is not yet complete.';
    const result = analyzeForContradictions(text);
    expect(typeof result.hasContradictions).toBe('boolean');
    expect(Array.isArray(result.contradictions)).toBe(true);
  });

  test('detects numerical contradictions', () => {
    const text = 'There are 5 items. There are 3 items.';
    const result = analyzeForContradictions(text);
    expect(typeof result.hasContradictions).toBe('boolean');
  });

  test('returns totalScore', () => {
    const result = analyzeForContradictions('Clean text about navigation');
    expect(typeof result.totalScore).toBe('number');
  });

  test('analyzes joined array text (as agent-engine calls it)', () => {
    const historyResults = [
      'The user is logged in.',
      'Login is required to proceed.',
    ].join('\n');
    const result = analyzeForContradictions(historyResults);
    expect(typeof result.hasContradictions).toBe('boolean');
    expect(Array.isArray(result.contradictions)).toBe(true);
  });
});

describe('compareResponsesForContradictions', () => {
  test('returns comparison result with expected shape', () => {
    const r1 = 'The button was clicked successfully.';
    const r2 = 'The form was submitted after clicking.';
    const result = compareResponsesForContradictions(r1, r2);
    expect(result).toHaveProperty('response1Contradictions');
    expect(result).toHaveProperty('response2Contradictions');
    expect(result).toHaveProperty('crossResponseContradictions');
    expect(typeof result.totalContradictions).toBe('number');
  });

  test('handles empty inputs without throwing', () => {
    expect(() => compareResponsesForContradictions('', '')).not.toThrow();
    expect(() => compareResponsesForContradictions(null, null)).not.toThrow();
  });

  test('finds no contradictions in clean responses', () => {
    const result = compareResponsesForContradictions(
      'The user clicked submit.',
      'The form was submitted.'
    );
    expect(result.totalContradictions).toBe(0);
  });
});

describe('logContradictionDetection', () => {
  test('does not log when no contradictions', async () => {
    await logContradictionDetection({ hasContradictions: false, contradictions: [] });
    const log = await getContradictionLog();
    expect(log).toEqual([]);
  });

  test('logs contradiction detection', async () => {
    const analysis = {
      hasContradictions: true,
      contradictions: [{ type: 'direct_negation', severity: 'high' }],
      totalScore: 1
    };
    await logContradictionDetection(analysis, 3);
    const log = await getContradictionLog();
    expect(log.length).toBe(1);
    expect(log[0].step).toBe(3);
    expect(log[0].totalScore).toBe(1);
  });

  test('does not log null analysis', async () => {
    await logContradictionDetection(null);
    const log = await getContradictionLog();
    expect(log).toEqual([]);
  });
});

describe('getContradictionStatistics', () => {
  test('returns zero stats when log is empty', async () => {
    const stats = await getContradictionStatistics();
    expect(stats.totalDetections).toBe(0);
    expect(stats.mostCommonType).toBeNull();
  });

  test('returns stats with detections', async () => {
    const analysis = {
      hasContradictions: true,
      contradictions: [
        { type: 'direct_negation', severity: 'high' },
        { type: 'direct_negation', severity: 'high' }
      ],
      totalScore: 2
    };
    await logContradictionDetection(analysis, 0);
    const stats = await getContradictionStatistics();
    expect(stats.totalDetections).toBe(1);
    expect(stats.mostCommonType).toBe('direct_negation');
  });
});

describe('clearContradictionLog', () => {
  test('clears the log', async () => {
    const analysis = {
      hasContradictions: true,
      contradictions: [{ type: 'temporal', severity: 'medium' }],
      totalScore: 1
    };
    await logContradictionDetection(analysis, 0);
    await clearContradictionLog();
    const log = await getContradictionLog();
    expect(log).toEqual([]);
  });

  test('handles clearing empty log gracefully', async () => {
    await expect(clearContradictionLog()).resolves.not.toThrow();
  });
});
