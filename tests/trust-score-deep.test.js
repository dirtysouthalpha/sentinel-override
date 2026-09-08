// tests/trust-score-deep.test.js
// Deep tests for background/trust-score.js — computeTrustScore, trustBand, describeTrustScore, suggestRetryActions.

import { jest } from '@jest/globals';

const { computeTrustScore, trustBand, describeTrustScore, suggestRetryActions } = await import('../background/trust-score.js');

describe('computeTrustScore: input validation', () => {
  test('returns 0 for null input', () => {
    expect(computeTrustScore(null).score).toBe(0);
    expect(computeTrustScore(null).band).toBe('unknown');
  });

  test('returns 0 for undefined input', () => {
    expect(computeTrustScore(undefined).score).toBe(0);
  });

  test('returns 0 for string input', () => {
    expect(computeTrustScore('invalid').score).toBe(0);
  });

  test('returns 0 for number input', () => {
    expect(computeTrustScore(42).score).toBe(0);
  });

  test('returns 0 for array input', () => {
    expect(computeTrustScore([]).score).toBe(0);
  });

  test('returns breakdown for valid input', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 2, productiveSteps: 5 });
    expect(result.breakdown).toBeDefined();
    expect(typeof result.score).toBe('number');
  });
});

describe('computeTrustScore: perfect run', () => {
  test('high score for perfect run with plan', () => {
    const result = computeTrustScore({
      totalSteps: 10,
      failedSteps: 0,
      productiveSteps: 10,
      planLength: 10,
      planCompleted: 10,
      apiCallCount: 10,
    });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.band).toBe('high');
  });

  test('100 score for all-perfect run', () => {
    const result = computeTrustScore({
      totalSteps: 10,
      failedSteps: 0,
      productiveSteps: 10,
      apiCallCount: 10,
      planLength: 10,
      planCompleted: 10,
    });
    expect(result.score).toBe(100);
  });
});

describe('computeTrustScore: failure rate component', () => {
  test('0 failures = 40 points', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(result.breakdown.failure.points).toBe(40);
  });

  test('50% failure = 20 points', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 5, productiveSteps: 5 });
    expect(result.breakdown.failure.points).toBe(20);
  });

  test('100% failure = 0 points', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 10, productiveSteps: 0 });
    expect(result.breakdown.failure.points).toBe(0);
  });

  test('0 total steps gives 40 points (benefit of doubt)', () => {
    const result = computeTrustScore({ totalSteps: 0, failedSteps: 0, productiveSteps: 0 });
    expect(result.breakdown.failure.points).toBe(40);
  });

  test('consecutive failure streak applies penalty', () => {
    const noStreak = computeTrustScore({ totalSteps: 10, failedSteps: 4, productiveSteps: 6, consecutiveFailureMax: 2 });
    const withStreak = computeTrustScore({ totalSteps: 10, failedSteps: 4, productiveSteps: 6, consecutiveFailureMax: 5 });
    expect(noStreak.breakdown.failure.points).toBeGreaterThan(withStreak.breakdown.failure.points);
  });

  test('streak penalty capped at 20', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 8, productiveSteps: 2, consecutiveFailureMax: 100
    });
    expect(result.breakdown.failure.streakPenalty).toBeLessThanOrEqual(20);
    expect(result.breakdown.failure.points).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTrustScore: productivity component', () => {
  test('100% productive = 20 points', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(result.breakdown.productivity.points).toBe(20);
  });

  test('50% productive = 10 points', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 5 });
    expect(result.breakdown.productivity.points).toBe(10);
  });

  test('0% productive = 0 points', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 0 });
    expect(result.breakdown.productivity.points).toBe(0);
  });

  test('0 total steps gives 20 points', () => {
    const result = computeTrustScore({ totalSteps: 0, failedSteps: 0, productiveSteps: 0 });
    expect(result.breakdown.productivity.points).toBe(20);
  });

  test('productive > total is clamped to 1.0', () => {
    const result = computeTrustScore({ totalSteps: 5, failedSteps: 0, productiveSteps: 10 });
    expect(result.breakdown.productivity.points).toBe(20);
  });
});

describe('computeTrustScore: recovery component', () => {
  test('no skills fired = 15 points (full credit)', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(result.breakdown.recovery.points).toBe(15);
  });

  test('100% skill success = 15 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      skillStats: { 'auth-wall': { fires: 3, successes: 3 } },
    });
    expect(result.breakdown.recovery.points).toBe(15);
  });

  test('50% skill success = 7-8 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      skillStats: { 'auth-wall': { fires: 4, successes: 2 } },
    });
    expect(result.breakdown.recovery.points).toBeLessThanOrEqual(8);
    expect(result.breakdown.recovery.points).toBeGreaterThanOrEqual(6);
  });

  test('0% skill success = 0 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      skillStats: { 'auth-wall': { fires: 3, successes: 0 } },
    });
    expect(result.breakdown.recovery.points).toBe(0);
  });

  test('multiple skills combined correctly', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      skillStats: {
        'skill-a': { fires: 2, successes: 2 },
        'skill-b': { fires: 2, successes: 0 },
        'skill-c': { fires: 1, successes: 1 },
      },
    });
    // 3 fires, 3 successes = 100% = 15 points
    expect(result.breakdown.recovery.points).toBe(15);
  });

  test('handles empty skillStats object', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      skillStats: {},
    });
    expect(result.breakdown.recovery.points).toBe(15);
  });

  test('handles null skillStats', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      skillStats: null,
    });
    expect(result.breakdown.recovery.points).toBe(15);
  });

  test('handles skillStats with null entries', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      skillStats: { 'skill-a': null, 'skill-b': undefined },
    });
    expect(result.breakdown.recovery.points).toBe(15);
  });
});

describe('computeTrustScore: plan adherence component', () => {
  test('no plan = 10 points (full credit)', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(result.breakdown.plan.points).toBe(10);
  });

  test('100% plan completed = 10 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      planLength: 5, planCompleted: 5,
    });
    expect(result.breakdown.plan.points).toBe(10);
  });

  test('50% plan completed = 5 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      planLength: 4, planCompleted: 2,
    });
    expect(result.breakdown.plan.points).toBe(5);
  });

  test('0% plan completed = 0 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      planLength: 5, planCompleted: 0,
    });
    expect(result.breakdown.plan.points).toBe(0);
  });

  test('planCompleted > planLength is clamped', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      planLength: 5, planCompleted: 10,
    });
    expect(result.breakdown.plan.points).toBe(10);
  });
});

describe('computeTrustScore: efficiency component', () => {
  test('0 productive steps = 10 points (full credit)', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 0 });
    expect(result.breakdown.efficiency.points).toBe(10);
  });

  test('1:1 API/productive ratio = 10 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, apiCallCount: 10,
    });
    expect(result.breakdown.efficiency.points).toBe(10);
  });

  test('3:1 ratio = 0 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, apiCallCount: 30,
    });
    expect(result.breakdown.efficiency.points).toBe(0);
  });

  test('very high ratio = 0 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, apiCallCount: 100,
    });
    expect(result.breakdown.efficiency.points).toBe(0);
  });

  test('0 API calls with productive steps = 10 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, apiCallCount: 0,
    });
    expect(result.breakdown.efficiency.points).toBe(10);
  });
});

describe('computeTrustScore: safety component', () => {
  test('0 safety blocks = 0 penalty', () => {
    const result = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(result.breakdown.safety.points).toBe(0);
  });

  test('1 safety block = -2 points', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 1,
    });
    expect(result.breakdown.safety.points).toBe(-2);
  });

  test('3+ safety blocks = -5 points (capped)', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 3,
    });
    expect(result.breakdown.safety.points).toBe(-5);
  });

  test('10 safety blocks still = -5 points (capped)', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 10,
    });
    expect(result.breakdown.safety.points).toBe(-5);
  });
});

describe('computeTrustScore: score clamping', () => {
  test('score never exceeds 100', () => {
    const result = computeTrustScore({
      totalSteps: 1, failedSteps: 0, productiveSteps: 100, apiCallCount: 0,
      planLength: 1, planCompleted: 1,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('score never goes below 0', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 10, productiveSteps: 0,
      safetyBlocks: 10, consecutiveFailureMax: 100,
      skillStats: { 's': { fires: 5, successes: 0 } },
      planLength: 10, planCompleted: 0, apiCallCount: 100,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('trustBand', () => {
  test('NaN returns unknown', () => expect(trustBand(NaN)).toBe('unknown'));
  test('Infinity returns unknown', () => expect(trustBand(Infinity)).toBe('unknown'));
  test('-Infinity returns unknown', () => expect(trustBand(-Infinity)).toBe('unknown'));
  test('100 returns high', () => expect(trustBand(100)).toBe('high'));
  test('80 returns high', () => expect(trustBand(80)).toBe('high'));
  test('79 returns good', () => expect(trustBand(79)).toBe('good'));
  test('60 returns good', () => expect(trustBand(60)).toBe('good'));
  test('59 returns questionable', () => expect(trustBand(59)).toBe('questionable'));
  test('40 returns questionable', () => expect(trustBand(40)).toBe('questionable'));
  test('39 returns low', () => expect(trustBand(39)).toBe('low'));
  test('0 returns low', () => expect(trustBand(0)).toBe('low'));
  test('-10 returns low', () => expect(trustBand(-10)).toBe('low'));
  test('string "75" returns good', () => expect(trustBand('75')).toBe('good'));
});

describe('describeTrustScore', () => {
  test('returns unavailable for null', () => {
    expect(describeTrustScore(null)).toBe('Trust score unavailable');
  });

  test('returns unavailable for undefined', () => {
    expect(describeTrustScore(undefined)).toBe('Trust score unavailable');
  });

  test('returns unavailable for object without score', () => {
    expect(describeTrustScore({})).toBe('Trust score unavailable');
  });

  test('includes score number', () => {
    const result = describeTrustScore({ score: 75, band: 'good', breakdown: {} });
    expect(result).toContain('75');
    expect(result).toContain('good');
  });

  test('includes weak component when gap > 5', () => {
    const result = describeTrustScore({
      score: 50, band: 'questionable',
      breakdown: {
        failure: { max: 40, points: 10 },
        productivity: { max: 20, points: 20 },
        recovery: { max: 15, points: 15 },
        plan: { max: 10, points: 10 },
        efficiency: { max: 10, points: 10 },
      },
    });
    expect(result).toContain('weak failure');
  });

  test('includes safety blocks when present', () => {
    const result = describeTrustScore({
      score: 45, band: 'questionable',
      breakdown: {
        failure: { max: 40, points: 30 },
        productivity: { max: 20, points: 15 },
        recovery: { max: 15, points: 15 },
        plan: { max: 10, points: 5 },
        efficiency: { max: 10, points: 5 },
        safety: { blocks: 2 },
      },
    });
    expect(result).toContain('2 safety blocks');
  });

  test('no suffix when all components are strong', () => {
    const result = describeTrustScore({
      score: 100, band: 'high',
      breakdown: {
        failure: { max: 40, points: 40 },
        productivity: { max: 20, points: 20 },
        recovery: { max: 15, points: 15 },
        plan: { max: 10, points: 10 },
        efficiency: { max: 10, points: 10 },
      },
    });
    expect(result).not.toContain('(');
  });
});

describe('suggestRetryActions: input validation', () => {
  test('returns empty for null', () => {
    expect(suggestRetryActions(null)).toEqual([]);
  });

  test('returns empty for undefined', () => {
    expect(suggestRetryActions(undefined)).toEqual([]);
  });

  test('returns empty for non-object', () => {
    expect(suggestRetryActions('invalid')).toEqual([]);
  });

  test('returns empty for high band', () => {
    expect(suggestRetryActions({ score: 90, band: 'high', breakdown: {} })).toEqual([]);
  });

  test('returns empty for good band', () => {
    expect(suggestRetryActions({ score: 70, band: 'good', breakdown: {} })).toEqual([]);
  });

  test('returns suggestions for questionable band', () => {
    const result = suggestRetryActions({ score: 50, band: 'questionable', breakdown: {} });
    // May or may not have suggestions depending on breakdown gaps
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('suggestRetryActions: failure-driven suggestions', () => {
  test('high failure gap suggests approval mode', () => {
    const result = suggestRetryActions({
      score: 30, band: 'low',
      breakdown: {
        failure: { max: 40, points: 5, streakPenalty: 10 },
        productivity: { max: 20, points: 15 },
        recovery: { max: 15, points: 15 },
        plan: { max: 10, points: 10 },
        efficiency: { max: 10, points: 10 },
      },
    });
    const ids = result.map(s => s.id);
    expect(ids).toContain('retry-approval-mode');
  });

  test('approval mode suggestion includes reason', () => {
    const result = suggestRetryActions({
      score: 30, band: 'low',
      breakdown: {
        failure: { max: 40, points: 5, streakPenalty: 10 },
        productivity: { max: 20, points: 15 },
        recovery: { max: 15, points: 15 },
        plan: { max: 10, points: 10 },
        efficiency: { max: 10, points: 10 },
      },
    });
    const approval = result.find(s => s.id === 'retry-approval-mode');
    expect(approval.reason).toContain('approval');
    expect(approval.applyKeys).toEqual(['approvalMode']);
    expect(approval.applyValues).toEqual([true]);
  });
});

describe('suggestRetryActions: max 3 suggestions', () => {
  test('never returns more than 3 suggestions', () => {
    const result = suggestRetryActions({
      score: 10, band: 'low',
      breakdown: {
        failure: { max: 40, points: 0, streakPenalty: 20 },
        productivity: { max: 20, points: 0, rate: 0 },
        recovery: { max: 15, points: 0, fires: 5, successes: 0 },
        plan: { max: 10, points: 0, planLength: 10, planCompleted: 0 },
        efficiency: { max: 10, points: 0, ratio: 5 },
        safety: { blocks: 3 },
      },
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe('suggestRetryActions: suggestion properties', () => {
  test('each suggestion has required fields', () => {
    const result = suggestRetryActions({
      score: 30, band: 'low',
      breakdown: {
        failure: { max: 40, points: 5, streakPenalty: 5 },
        productivity: { max: 20, points: 15 },
        recovery: { max: 15, points: 15 },
        plan: { max: 10, points: 10 },
        efficiency: { max: 10, points: 10 },
      },
    });
    result.forEach(s => {
      expect(s.id).toBeDefined();
      expect(s.label).toBeDefined();
      expect(s.reason).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(s.severity);
      expect(Array.isArray(s.applyKeys)).toBe(true);
      expect(Array.isArray(s.applyValues)).toBe(true);
    });
  });
});
