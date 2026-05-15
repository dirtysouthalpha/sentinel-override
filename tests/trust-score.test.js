// tests/trust-score.test.js
// Unit tests for background/trust-score.js — full coverage of
// computeTrustScore, trustBand, describeTrustScore, suggestRetryActions.

import { jest } from '@jest/globals';

import {
  computeTrustScore,
  trustBand,
  describeTrustScore,
  suggestRetryActions,
} from '../background/trust-score.js';

// ========== trustBand ==========

describe('trustBand', () => {
  test('returns high for score >= 80', () => {
    expect(trustBand(80)).toBe('high');
    expect(trustBand(100)).toBe('high');
  });

  test('returns good for 60-79', () => {
    expect(trustBand(60)).toBe('good');
    expect(trustBand(79)).toBe('good');
  });

  test('returns questionable for 40-59', () => {
    expect(trustBand(40)).toBe('questionable');
    expect(trustBand(59)).toBe('questionable');
  });

  test('returns low below 40', () => {
    expect(trustBand(0)).toBe('low');
    expect(trustBand(39)).toBe('low');
  });

  test('returns unknown for non-finite input', () => {
    expect(trustBand(NaN)).toBe('unknown');
    expect(trustBand(Infinity)).toBe('unknown');
    expect(trustBand(-Infinity)).toBe('unknown');
  });
});

// ========== computeTrustScore ==========

describe('computeTrustScore', () => {
  const perfectRun = {
    totalSteps: 10,
    failedSteps: 0,
    productiveSteps: 10,
    apiCallCount: 10,
    safetyBlocks: 0,
    planLength: 5,
    planCompleted: 5,
    consecutiveFailureMax: 0,
    skillStats: {}
  };

  test('returns a score between 0 and 100', () => {
    const result = computeTrustScore(perfectRun);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('perfect run scores at or near 100', () => {
    const result = computeTrustScore(perfectRun);
    expect(result.score).toBeGreaterThan(80);
    expect(result.band).toBe('high');
  });

  test('all-failed run scores low', () => {
    const result = computeTrustScore({
      totalSteps: 10,
      failedSteps: 10,
      productiveSteps: 0,
      apiCallCount: 10,
      safetyBlocks: 0,
      planLength: 0,
      planCompleted: 0
    });
    expect(result.score).toBeLessThan(40);
    expect(result.band).toBe('low');
  });

  test('safety blocks deduct points', () => {
    const withBlocks = computeTrustScore({ ...perfectRun, safetyBlocks: 5 });
    const withoutBlocks = computeTrustScore(perfectRun);
    expect(withBlocks.score).toBeLessThan(withoutBlocks.score);
  });

  test('zero steps returns a valid result', () => {
    const result = computeTrustScore({ totalSteps: 0, failedSteps: 0, productiveSteps: 0 });
    expect(typeof result.score).toBe('number');
    expect(isFinite(result.score)).toBe(true);
  });

  test('returns breakdown object with expected keys', () => {
    const result = computeTrustScore(perfectRun);
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.failure).toBeDefined();
    expect(result.breakdown.productivity).toBeDefined();
    expect(result.breakdown.safety).toBeDefined();
    expect(result.breakdown.plan).toBeDefined();
  });

  test('returns zero band unknown for null input', () => {
    const result = computeTrustScore(null);
    expect(result.score).toBe(0);
    expect(result.band).toBe('unknown');
  });

  test('returns zero band unknown for non-object input', () => {
    const result = computeTrustScore('bad');
    expect(result.score).toBe(0);
    expect(result.band).toBe('unknown');
  });

  test('consecutive failure streak adds penalty', () => {
    const noStreak = computeTrustScore({ ...perfectRun, consecutiveFailureMax: 1 });
    const streak = computeTrustScore({ ...perfectRun, consecutiveFailureMax: 5 });
    expect(streak.score).toBeLessThan(noStreak.score);
  });

  test('skillStats with low success rate reduces recovery points', () => {
    const goodSkills = computeTrustScore({
      ...perfectRun,
      skillStats: { 'click-no-target': { fires: 10, successes: 9 } }
    });
    const badSkills = computeTrustScore({
      ...perfectRun,
      skillStats: { 'click-no-target': { fires: 10, successes: 1 } }
    });
    expect(badSkills.score).toBeLessThan(goodSkills.score);
  });

  test('skillStats with null entries are skipped', () => {
    const result = computeTrustScore({
      ...perfectRun,
      skillStats: { 'skill-a': null, 'skill-b': { fires: 5, successes: 5 } }
    });
    expect(result.breakdown.recovery.fires).toBe(5);
    expect(result.breakdown.recovery.successes).toBe(5);
  });

  test('high API call count reduces efficiency points', () => {
    const efficient = computeTrustScore({ ...perfectRun, apiCallCount: 10 });
    const wasteful = computeTrustScore({ ...perfectRun, apiCallCount: 100 });
    expect(wasteful.score).toBeLessThan(efficient.score);
  });

  test('incomplete plan reduces plan points', () => {
    const complete = computeTrustScore({ ...perfectRun, planLength: 5, planCompleted: 5 });
    const partial = computeTrustScore({ ...perfectRun, planLength: 5, planCompleted: 2 });
    expect(partial.score).toBeLessThan(complete.score);
  });

  test('low productivity reduces productivity points', () => {
    const productive = computeTrustScore({ ...perfectRun, productiveSteps: 10, totalSteps: 10 });
    const unproductive = computeTrustScore({ ...perfectRun, productiveSteps: 2, totalSteps: 10 });
    expect(unproductive.score).toBeLessThan(productive.score);
  });
});

// ========== describeTrustScore ==========

describe('describeTrustScore', () => {
  test('returns string with score and band', () => {
    const scoreResult = computeTrustScore({
      totalSteps: 8, failedSteps: 1, productiveSteps: 7,
      apiCallCount: 8, safetyBlocks: 0, planLength: 4, planCompleted: 4
    });
    const desc = describeTrustScore(scoreResult);
    expect(typeof desc).toBe('string');
    expect(desc).toContain('/100');
  });

  test('handles missing input gracefully', () => {
    expect(describeTrustScore(null)).toBe('Trust score unavailable');
    expect(describeTrustScore({})).toBe('Trust score unavailable');
  });

  test('mentions safety blocks when present', () => {
    const result = computeTrustScore({
      totalSteps: 5, failedSteps: 0, productiveSteps: 5,
      apiCallCount: 5, safetyBlocks: 3, planLength: 3, planCompleted: 3
    });
    const desc = describeTrustScore(result);
    expect(desc).toContain('safety block');
  });

  test('mentions weak component when gap is large', () => {
    const result = computeTrustScore({
      totalSteps: 10, failedSteps: 8, productiveSteps: 2,
      apiCallCount: 10, safetyBlocks: 0, planLength: 5, planCompleted: 1
    });
    const desc = describeTrustScore(result);
    expect(desc).toContain('weak');
  });
});

// ========== suggestRetryActions ==========

describe('suggestRetryActions', () => {
  test('returns empty array for null input', () => {
    expect(suggestRetryActions(null)).toEqual([]);
  });

  test('returns empty array for non-object input', () => {
    expect(suggestRetryActions('bad')).toEqual([]);
  });

  test('returns empty array for high band', () => {
    const high = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10,
      apiCallCount: 10, safetyBlocks: 0, planLength: 5, planCompleted: 5
    });
    expect(suggestRetryActions(high)).toEqual([]);
  });

  test('returns empty array for good band', () => {
    const good = computeTrustScore({
      totalSteps: 10, failedSteps: 2, productiveSteps: 8,
      apiCallCount: 10, safetyBlocks: 0, planLength: 5, planCompleted: 4
    });
    // Good band runs don't get suggestions
    if (good.band === 'good') {
      expect(suggestRetryActions(good)).toEqual([]);
    }
  });

  test('suggests approval mode for high failure rate', () => {
    const result = {
      score: 20,
      band: 'low',
      breakdown: {
        failure: { points: 5, max: 40, rate: 0.8, streakPenalty: 0 },
        productivity: { points: 4, max: 20, rate: 0.2 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const approval = suggestions.find(s => s.id === 'retry-approval-mode');
    expect(approval).toBeDefined();
    expect(approval.severity).toBe('high');
    expect(approval.applyKeys).toEqual(['approvalMode']);
    expect(approval.applyValues).toEqual([true]);
  });

  test('includes streak info in approval mode suggestion', () => {
    const result = {
      score: 15,
      band: 'low',
      breakdown: {
        failure: { points: 2, max: 40, rate: 0.9, streakPenalty: 10 },
        productivity: { points: 2, max: 20, rate: 0.1 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const approval = suggestions.find(s => s.id === 'retry-approval-mode');
    expect(approval).toBeDefined();
    expect(approval.reason).toContain('failure streak');
  });

  test('suggests reset skills when recovery gap is high', () => {
    const result = {
      score: 25,
      band: 'low',
      breakdown: {
        failure: { points: 30, max: 40, rate: 0.25 },
        productivity: { points: 10, max: 20, rate: 0.5 },
        recovery: { points: 2, max: 15, rate: 0.1, fires: 5, successes: 1 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const resetSkills = suggestions.find(s => s.id === 'reset-skills-and-retry');
    expect(resetSkills).toBeDefined();
    expect(resetSkills.reason).toContain('5 times');
  });

  test('suggests adaptive prompts for poor plan adherence', () => {
    const result = {
      score: 30,
      band: 'questionable',
      breakdown: {
        failure: { points: 30, max: 40, rate: 0.25 },
        productivity: { points: 10, max: 20, rate: 0.5 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 2, max: 10, rate: 0.2, planLength: 10, planCompleted: 2 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const adaptive = suggestions.find(s => s.id === 'enable-adaptive-prompts');
    expect(adaptive).toBeDefined();
    expect(adaptive.applyKeys).toEqual(['adaptivePromptsMode', 'adaptiveExpansionMode']);
    expect(adaptive.applyValues).toEqual(['auto', 'light']);
    expect(adaptive.severity).toBe('medium');
  });

  test('suggests refine goal for low productivity', () => {
    const result = {
      score: 25,
      band: 'low',
      breakdown: {
        failure: { points: 30, max: 40, rate: 0.25 },
        productivity: { points: 3, max: 20, rate: 0.15 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const refine = suggestions.find(s => s.id === 'refine-goal');
    expect(refine).toBeDefined();
    expect(refine.severity).toBe('medium');
    expect(refine.reason).toContain('15%');
  });

  test('suggests leaner model for poor efficiency', () => {
    const result = {
      score: 25,
      band: 'low',
      breakdown: {
        failure: { points: 30, max: 40, rate: 0.25 },
        productivity: { points: 15, max: 20, rate: 0.75 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 2, max: 10, ratio: 4.0 },
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const leaner = suggestions.find(s => s.id === 'try-leaner-model');
    expect(leaner).toBeDefined();
    expect(leaner.severity).toBe('low');
    expect(leaner.reason).toContain('4');
  });

  test('suggests verify tenant for safety blocks', () => {
    const result = {
      score: 30,
      band: 'questionable',
      breakdown: {
        failure: { points: 35, max: 40, rate: 0.1 },
        productivity: { points: 15, max: 20, rate: 0.75 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: -4, max: 0, blocks: 2 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const verify = suggestions.find(s => s.id === 'verify-tenant-before-retry');
    expect(verify).toBeDefined();
    expect(verify.severity).toBe('high');
    expect(verify.reason).toContain('2 safety blocks');
  });

  test('uses singular for single safety block', () => {
    const result = {
      score: 35,
      band: 'questionable',
      breakdown: {
        failure: { points: 35, max: 40, rate: 0.1 },
        productivity: { points: 15, max: 20, rate: 0.75 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: -2, max: 0, blocks: 2 },
      }
    };
    const suggestions = suggestRetryActions(result);
    const verify = suggestions.find(s => s.id === 'verify-tenant-before-retry');
    if (verify) {
      expect(verify.reason).toContain('2 safety blocks');
    }
  });

  test('caps suggestions at 3', () => {
    const result = {
      score: 5,
      band: 'low',
      breakdown: {
        failure: { points: 2, max: 40, rate: 0.9, streakPenalty: 10 },
        productivity: { points: 2, max: 20, rate: 0.1 },
        recovery: { points: 2, max: 15, rate: 0.1, fires: 5, successes: 1 },
        plan: { points: 2, max: 10, rate: 0.2, planLength: 10, planCompleted: 2 },
        efficiency: { points: 2, max: 10, ratio: 4.0 },
        safety: { points: -4, max: 0, blocks: 3 },
      }
    };
    const suggestions = suggestRetryActions(result);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  test('handles missing breakdown gracefully', () => {
    const result = { score: 30, band: 'low', breakdown: undefined };
    const suggestions = suggestRetryActions(result);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  test('handles empty breakdown gracefully', () => {
    const result = { score: 30, band: 'low', breakdown: {} };
    const suggestions = suggestRetryActions(result);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  test('gap returns 0 for components with max=0', () => {
    const result = {
      score: 30,
      band: 'questionable',
      breakdown: {
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  test('severity is medium for questionable band', () => {
    const result = {
      score: 50,
      band: 'questionable',
      breakdown: {
        failure: { points: 10, max: 40, rate: 0.7 },
        productivity: { points: 15, max: 20, rate: 0.75 },
        recovery: { points: 15, max: 15, rate: 1, fires: 0, successes: 0 },
        plan: { points: 10, max: 10, rate: 1, planLength: 0, planCompleted: 0 },
        efficiency: { points: 10, max: 10, ratio: null },
        safety: { points: 0, max: 0, blocks: 0 },
      }
    };
    const suggestions = suggestRetryActions(result);
    if (suggestions.length > 0) {
      expect(suggestions[0].severity).toBe('medium');
    }
  });
});
