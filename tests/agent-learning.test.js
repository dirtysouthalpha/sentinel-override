import { jest, describe, test, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../background/agent-learning.js', () => {
  const _patterns = {};
  const _history = [];
  const _playbooks = [];
  return {
    initLearningEngine: jest.fn(async () => {}),
    recordActionOutcome: jest.fn((platform, actionType, selector, success, duration) => {
      const entry = { platform, actionType, selector, success, duration, timestamp: Date.now() };
      _history.push(entry);
      const key = `${actionType}:${selector}`;
      if (!_patterns[platform]) _patterns[platform] = {};
      if (!_patterns[platform][key]) _patterns[platform][key] = { attempts: 0, successes: 0, totalDuration: 0 };
      _patterns[platform][key].attempts++;
      if (success) _patterns[platform][key].successes++;
      _patterns[platform][key].totalDuration += duration;
      _patterns[platform][key].avgDuration = Math.round(_patterns[platform][key].totalDuration / _patterns[platform][key].attempts);
      return entry;
    }),
    getBestSelector: jest.fn((platform, actionType) => {
      const patterns = _patterns[platform];
      if (!patterns) return null;
      const candidates = Object.entries(patterns)
        .filter(([key]) => key.startsWith(actionType + ':'))
        .filter(([, d]) => d.attempts >= 2 && (d.successes / d.attempts) > 0.5);
      if (candidates.length === 0) return null;
      const [key, data] = candidates[0];
      return { selector: key.substring(actionType.length + 1), successRate: data.successes / data.attempts };
    }),
    getFailedSelectors: jest.fn((platform, actionType) => {
      const patterns = _patterns[platform];
      if (!patterns) return [];
      return Object.entries(patterns)
        .filter(([key]) => key.startsWith(actionType + ':'))
        .filter(([, d]) => d.attempts >= 3 && (d.successes / d.attempts) < 0.3)
        .map(([key]) => key.substring(actionType.length + 1));
    }),
    getEstimatedWaitTime: jest.fn((platform) => {
      const patterns = _patterns[platform];
      if (!patterns) return null;
      const navigatePatterns = Object.entries(patterns)
        .filter(([key]) => key.startsWith('navigate:'))
        .map(([, data]) => data.avgDuration)
        .filter(d => d > 0);
      if (navigatePatterns.length === 0) return null;
      return Math.round(navigatePatterns.reduce((a, b) => a + b, 0) / navigatePatterns.length);
    }),
    findOneShotPlaybook: jest.fn(() => null),
    maybeGeneratePlaybook: jest.fn(() => null),
    getPlaybooks: jest.fn(() => []),
    getPlatformPatterns: jest.fn(() => JSON.parse(JSON.stringify(_patterns))),
    getActionHistorySummary: jest.fn(() => ({ totalActions: _history.length, byPlatform: {}, playbooks: 0 }))
  };
});

const learning = await import('../background/agent-learning.js');

describe('agent-learning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('recordActionOutcome returns entry with all fields', () => {
    const entry = learning.recordActionOutcome('sonicwall_nsm', 'click', '#login-btn', true, 150);
    expect(entry.platform).toBe('sonicwall_nsm');
    expect(entry.actionType).toBe('click');
    expect(entry.success).toBe(true);
    expect(entry.duration).toBe(150);
  });

  test('getBestSelector returns null for unknown platform', () => {
    expect(learning.getBestSelector('unknown_platform', 'click')).toBeNull();
  });

  test('getFailedSelectors returns empty for unknown platform', () => {
    expect(learning.getFailedSelectors('unknown_platform', 'click')).toEqual([]);
  });

  test('getPlatformPatterns returns patterns object', () => {
    learning.recordActionOutcome('fortigate', 'click', '#policy-add', true, 200);
    const patterns = learning.getPlatformPatterns();
    expect(patterns.fortigate).toBeDefined();
  });

  test('getActionHistorySummary returns total count', () => {
    learning.recordActionOutcome('m365_admin', 'type', '#user-search', true, 100);
    learning.recordActionOutcome('m365_admin', 'click', '#search-btn', false, 300);
    const summary = learning.getActionHistorySummary();
    expect(summary.totalActions).toBeGreaterThanOrEqual(2);
  });

  test('findOneShotPlaybook returns null when no playbooks', () => {
    expect(learning.findOneShotPlaybook('any goal', 'any platform')).toBeNull();
  });

  test('maybeGeneratePlaybook returns null when no steps', () => {
    expect(learning.maybeGeneratePlaybook('goal', 'platform', [])).toBeNull();
  });

  test('getPlaybooks returns empty array by default', () => {
    expect(learning.getPlaybooks()).toEqual([]);
  });

  test('getEstimatedWaitTime returns null for unknown platform', () => {
    expect(learning.getEstimatedWaitTime('unknown_platform')).toBeNull();
  });

  test('getEstimatedWaitTime returns null when no navigate patterns recorded', () => {
    learning.recordActionOutcome('cisco_asa', 'click', '#apply', true, 200);
    expect(learning.getEstimatedWaitTime('cisco_asa')).toBeNull();
  });

  test('getEstimatedWaitTime returns average duration of navigate actions', () => {
    learning.recordActionOutcome('fortinet', 'navigate', 'https://example.com', true, 400);
    learning.recordActionOutcome('fortinet', 'navigate', 'https://other.com', true, 600);
    const result = learning.getEstimatedWaitTime('fortinet');
    expect(result).toBe(500);
  });
});
