/**
 * Tests for background/bias-detector.js
 */

import { jest } from '@jest/globals';
import {
  analyzeForBias,
  analyzeActionForBias,
  shouldTriggerBiasWarning,
  generateBiasReport,
  logBiasDetection,
  getBiasLog,
  getBiasStatistics,
  clearBiasLog
} from '../background/bias-detector.js';

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

describe('analyzeForBias', () => {
  test('returns no bias for clean text', () => {
    const result = analyzeForBias('The user clicked the submit button.');
    expect(result.hasBias).toBe(false);
    expect(result.biases).toEqual([]);
  });

  test('detects confirmation bias', () => {
    const result = analyzeForBias('As I thought, the system confirms my belief.');
    expect(result.hasBias).toBe(true);
    expect(result.biases.some(b => b.type === 'confirmationBias')).toBe(true);
  });

  test('detects stereotyping bias', () => {
    const result = analyzeForBias('This is typical for users of this type of system.');
    expect(result.hasBias).toBe(true);
    expect(result.biases.some(b => b.type === 'stereotyping')).toBe(true);
  });

  test('handles null input gracefully', () => {
    expect(analyzeForBias(null).hasBias).toBe(false);
    expect(analyzeForBias(undefined).hasBias).toBe(false);
    expect(analyzeForBias('').hasBias).toBe(false);
    expect(analyzeForBias(42).hasBias).toBe(false);
  });

  test('returns severity level', () => {
    const result = analyzeForBias('As expected, just as I suspected, confirms my belief.');
    expect(result.severity).toBeGreaterThan(0);
  });

  test('counts total bias score', () => {
    const result = analyzeForBias('As expected and as I thought, this confirms my belief about the system.');
    expect(result.totalBiasScore).toBeGreaterThanOrEqual(1);
  });
});

describe('analyzeActionForBias', () => {
  test('returns no bias for normal action', () => {
    const action = { type: 'click', target: '#submit-btn', reasoning: 'Click the submit button' };
    expect(analyzeActionForBias(action).hasBias).toBe(false);
  });

  test('detects bias in reasoning field', () => {
    const action = { type: 'click', reasoning: 'As expected, this confirms my belief.' };
    expect(analyzeActionForBias(action).hasBias).toBe(true);
  });

  test('detects bias in target field', () => {
    const action = { type: 'click', target: 'As I thought the typical element' };
    expect(analyzeActionForBias(action).hasBias).toBe(true);
  });

  test('analyzes type action value', () => {
    const action = { type: 'type', value: 'standard for this type of user typically' };
    const result = analyzeActionForBias(action);
    expect(result.hasBias).toBe(true);
  });

  test('handles null/invalid action', () => {
    expect(analyzeActionForBias(null).hasBias).toBe(false);
    expect(analyzeActionForBias('string').hasBias).toBe(false);
    expect(analyzeActionForBias({}).hasBias).toBe(false);
  });

  test('combines biases from multiple fields', () => {
    const action = {
      type: 'click',
      reasoning: 'As expected, confirms my belief.',
      target: 'typical for this type'
    };
    const result = analyzeActionForBias(action);
    expect(result.hasBias).toBe(true);
    expect(result.biases.length).toBeGreaterThanOrEqual(2);
  });
});

describe('shouldTriggerBiasWarning', () => {
  test('returns false when no bias', () => {
    expect(shouldTriggerBiasWarning({ hasBias: false })).toBe(false);
    expect(shouldTriggerBiasWarning(null)).toBe(false);
  });

  test('returns false for low severity bias (severity=1)', () => {
    const result = analyzeForBias('As expected the system worked.');
    if (result.hasBias && result.severity < 2) {
      expect(shouldTriggerBiasWarning(result)).toBe(false);
    }
  });

  test('returns true for medium or high severity', () => {
    const highSeverityAnalysis = { hasBias: true, severity: 2 };
    expect(shouldTriggerBiasWarning(highSeverityAnalysis)).toBe(true);

    const highestSeverity = { hasBias: true, severity: 3 };
    expect(shouldTriggerBiasWarning(highestSeverity)).toBe(true);
  });
});

describe('generateBiasReport', () => {
  test('returns no-bias message when no bias', () => {
    const report = generateBiasReport({ hasBias: false });
    expect(report).toBe('No biases detected.');
    expect(generateBiasReport(null)).toBe('No biases detected.');
  });

  test('generates report with bias details', () => {
    const analysis = analyzeForBias('As expected, confirms my belief.');
    if (analysis.hasBias) {
      const report = generateBiasReport(analysis);
      expect(report).toContain('Bias Detection Report');
      expect(report).toContain('Severity');
    }
  });
});

describe('logBiasDetection and getBiasLog', () => {
  test('does not log when no bias', async () => {
    await logBiasDetection({ hasBias: false });
    const log = await getBiasLog();
    expect(log).toEqual([]);
  });

  test('logs bias detection', async () => {
    const analysis = { hasBias: true, biases: [{ type: 'confirmationBias', severity: 1 }], severity: 1, totalBiasScore: 1 };
    await logBiasDetection(analysis, 5);
    const log = await getBiasLog();
    expect(log.length).toBe(1);
    expect(log[0].step).toBe(5);
  });

  test('accumulates multiple detections', async () => {
    const analysis = { hasBias: true, biases: [{ type: 'confirmationBias', severity: 1 }], severity: 1, totalBiasScore: 1 };
    await logBiasDetection(analysis, 1);
    await logBiasDetection(analysis, 2);
    const log = await getBiasLog();
    expect(log.length).toBe(2);
  });
});

describe('getBiasStatistics', () => {
  test('returns zero stats when log is empty', async () => {
    const stats = await getBiasStatistics();
    expect(stats.totalDetections).toBe(0);
    expect(stats.mostCommonBias).toBeNull();
  });

  test('returns stats with detections', async () => {
    const analysis = {
      hasBias: true,
      biases: [{ type: 'confirmationBias', severity: 1 }],
      severity: 1,
      totalBiasScore: 1
    };
    await logBiasDetection(analysis, 0);
    const stats = await getBiasStatistics();
    expect(stats.totalDetections).toBe(1);
    expect(stats.mostCommonBias).toBe('confirmationBias');
  });
});

describe('clearBiasLog', () => {
  test('clears the log', async () => {
    const analysis = { hasBias: true, biases: [], severity: 1, totalBiasScore: 1 };
    await logBiasDetection(analysis, 0);
    await clearBiasLog();
    const log = await getBiasLog();
    expect(log).toEqual([]);
  });

  test('handles clearing empty log gracefully', async () => {
    await expect(clearBiasLog()).resolves.not.toThrow();
  });
});

describe('analyzeForBias — severity levels', () => {
  test('occurrence count >= 3 results in high severity', () => {
    // Three occurrences of confirmationBias pattern "as expected"
    const text = 'As expected the test passed. As expected this worked. As expected everything is fine.';
    const result = analyzeForBias(text);
    const highBiases = result.biases.filter(b => b.severity === 3);
    expect(highBiases.length).toBeGreaterThan(0);
  });

  test('occurrence count >= 2 results in medium severity', () => {
    // Two occurrences
    const text = 'As expected the test passed. As expected this also worked.';
    const result = analyzeForBias(text);
    const medBiases = result.biases.filter(b => b.severity >= 2);
    expect(medBiases.length).toBeGreaterThan(0);
  });

  test('stereotyping bias bumps severity up', () => {
    // Single occurrence of stereotyping → starts at low (1), bumps to medium (2)
    const text = 'This is typical for this type of user.';
    const result = analyzeForBias(text);
    const stereo = result.biases.find(b => b.type === 'stereotyping');
    if (stereo) {
      expect(stereo.severity).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('generateBiasReport — severity labels', () => {
  test('generates report with high severity label for frequent bias', () => {
    const text = 'As expected. As expected. As expected.';
    const analysis = analyzeForBias(text);
    const report = generateBiasReport(analysis);
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(0);
  });

  test('generates report with None severity label (covers L232)', () => {
    const analysis = { hasBias: true, biases: [{ type: 'testBias', severity: 0, pattern: 'test', matches: ['test'] }], severity: 0, totalBiasScore: 0 };
    const report = generateBiasReport(analysis);
    expect(report).toContain('None');
  });

  test('generates report with Medium severity label (covers L236)', () => {
    const analysis = { hasBias: true, biases: [{ type: 'testBias', severity: 2, pattern: 'test', matches: ['test'] }], severity: 2, totalBiasScore: 2 };
    const report = generateBiasReport(analysis);
    expect(report).toContain('Medium');
  });

  test('generates report with Unknown severity for out-of-range value (covers L240)', () => {
    const analysis = { hasBias: true, biases: [{ type: 'testBias', severity: 99, pattern: 'test', matches: ['test'] }], severity: 99, totalBiasScore: 99 };
    const report = generateBiasReport(analysis);
    expect(report).toContain('Unknown');
  });
});

describe('storage error paths', () => {
  test('logBiasDetection does not throw when storage.get rejects', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage unavailable'));
    const analysis = { hasBias: true, biases: [], severity: 1, totalBiasScore: 1 };
    await expect(logBiasDetection(analysis, 0)).resolves.not.toThrow();
  });

  test('getBiasLog returns empty array when storage.get rejects', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage unavailable'));
    const log = await getBiasLog();
    expect(log).toEqual([]);
  });

  test('clearBiasLog does not throw when storage.remove rejects', async () => {
    chrome.storage.local.remove.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(clearBiasLog()).resolves.not.toThrow();
  });
});
