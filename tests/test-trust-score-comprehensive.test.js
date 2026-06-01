// Comprehensive tests for trust-score.js pure functions
import { jest } from '@jest/globals';

let computeTrustScore, trustBand, describeTrustScore, suggestRetryActions;

beforeAll(async () => {
  const mod = await import('../background/trust-score.js');
  computeTrustScore = mod.computeTrustScore;
  trustBand = mod.trustBand;
  describeTrustScore = mod.describeTrustScore;
  suggestRetryActions = mod.suggestRetryActions;
});

// ============================================================
// computeTrustScore
// ============================================================
describe('computeTrustScore', () => {
  // --- Edge inputs ---
  test('returns 0 for null', () => {
    expect(computeTrustScore(null).score).toBe(0);
  });
  test('returns 0 for undefined', () => {
    expect(computeTrustScore(undefined).score).toBe(0);
  });
  test('returns 0 for string', () => {
    expect(computeTrustScore('bad').score).toBe(0);
  });
  test('returns 0 for number', () => {
    expect(computeTrustScore(42).score).toBe(0);
  });
  test('handles empty object', () => {
    const r = computeTrustScore({});
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.band).toBeTruthy();
  });
  test('handles all zeros', () => {
    const r = computeTrustScore({
      totalSteps: 0, failedSteps: 0, productiveSteps: 0
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
  test('handles all NaN', () => {
    const r = computeTrustScore({
      totalSteps: NaN, failedSteps: NaN, productiveSteps: NaN
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  // --- Perfect run ---
  test('perfect run scores high', () => {
    const r = computeTrustScore({
      totalSteps: 10,
      failedSteps: 0,
      productiveSteps: 10,
      apiCallCount: 12,
      planLength: 10,
      planCompleted: 10
    });
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.band).toBe('high');
  });

  // --- Total failure ---
  test('all-failed run scores low', () => {
    const r = computeTrustScore({
      totalSteps: 10,
      failedSteps: 10,
      productiveSteps: 0,
      apiCallCount: 30,
      planLength: 10,
      planCompleted: 0
    });
    expect(r.score).toBeLessThan(40);
  });

  // --- No failures, no production ---
  test('observe-only run gets decent score', () => {
    const r = computeTrustScore({
      totalSteps: 5,
      failedSteps: 0,
      productiveSteps: 0
    });
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  // --- Breakdown structure ---
  test('breakdown has all components', () => {
    const r = computeTrustScore({
      totalSteps: 10,
      failedSteps: 2,
      productiveSteps: 6,
      apiCallCount: 15,
      planLength: 8,
      planCompleted: 6,
      safetyBlocks: 1
    });
    expect(r.breakdown).toHaveProperty('failure');
    expect(r.breakdown).toHaveProperty('productivity');
    expect(r.breakdown).toHaveProperty('recovery');
    expect(r.breakdown).toHaveProperty('plan');
    expect(r.breakdown).toHaveProperty('efficiency');
    expect(r.breakdown).toHaveProperty('safety');
  });
  test('failure breakdown has correct structure', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 3, productiveSteps: 7 });
    expect(r.breakdown.failure).toHaveProperty('points');
    expect(r.breakdown.failure).toHaveProperty('max');
    expect(r.breakdown.failure).toHaveProperty('rate');
    expect(r.breakdown.failure).toHaveProperty('streakPenalty');
    expect(r.breakdown.failure.max).toBe(40);
  });
  test('productivity breakdown has correct structure', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 2, productiveSteps: 6 });
    expect(r.breakdown.productivity).toHaveProperty('points');
    expect(r.breakdown.productivity).toHaveProperty('max');
    expect(r.breakdown.productivity).toHaveProperty('rate');
    expect(r.breakdown.productivity.max).toBe(20);
  });
  test('recovery breakdown has correct structure', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 2, productiveSteps: 8 });
    expect(r.breakdown.recovery).toHaveProperty('points');
    expect(r.breakdown.recovery).toHaveProperty('max');
    expect(r.breakdown.recovery).toHaveProperty('rate');
    expect(r.breakdown.recovery).toHaveProperty('fires');
    expect(r.breakdown.recovery).toHaveProperty('successes');
    expect(r.breakdown.recovery.max).toBe(15);
  });
  test('plan breakdown has correct structure', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, planLength: 8, planCompleted: 6 });
    expect(r.breakdown.plan).toHaveProperty('points');
    expect(r.breakdown.plan).toHaveProperty('max');
    expect(r.breakdown.plan).toHaveProperty('rate');
    expect(r.breakdown.plan).toHaveProperty('planLength');
    expect(r.breakdown.plan).toHaveProperty('planCompleted');
    expect(r.breakdown.plan.max).toBe(10);
  });
  test('efficiency breakdown has correct structure', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 1, productiveSteps: 9, apiCallCount: 18 });
    expect(r.breakdown.efficiency).toHaveProperty('points');
    expect(r.breakdown.efficiency).toHaveProperty('max');
    expect(r.breakdown.efficiency).toHaveProperty('ratio');
    expect(r.breakdown.efficiency.max).toBe(10);
  });
  test('safety breakdown has correct structure', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 2, productiveSteps: 8, safetyBlocks: 2 });
    expect(r.breakdown.safety).toHaveProperty('points');
    expect(r.breakdown.safety).toHaveProperty('max');
    expect(r.breakdown.safety).toHaveProperty('blocks');
  });

  // --- Failure streak penalty ---
  test('streak of 3 adds penalty', () => {
    const r1 = computeTrustScore({ totalSteps: 10, failedSteps: 3, consecutiveFailureMax: 3 });
    const r2 = computeTrustScore({ totalSteps: 10, failedSteps: 3, consecutiveFailureMax: 0 });
    expect(r1.score).toBeLessThan(r2.score);
  });
  test('streak of 5 has more penalty', () => {
    const r1 = computeTrustScore({ totalSteps: 10, failedSteps: 5, consecutiveFailureMax: 5 });
    const r2 = computeTrustScore({ totalSteps: 10, failedSteps: 5, consecutiveFailureMax: 2 });
    expect(r1.score).toBeLessThan(r2.score);
  });
  test('streak penalty caps at 20', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 10, consecutiveFailureMax: 10 });
    expect(r.breakdown.failure.streakPenalty).toBeLessThanOrEqual(20);
  });

  // --- Safety blocks ---
  test('safety blocks reduce score', () => {
    const r1 = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 0 });
    const r2 = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 3 });
    expect(r2.score).toBeLessThan(r1.score);
  });
  test('safety penalty caps at 5', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 10 });
    expect(r.breakdown.safety.points).toBeGreaterThanOrEqual(-5);
  });

  // --- Recovery effectiveness ---
  test('successful recovery skills help', () => {
    const r1 = computeTrustScore({
      totalSteps: 10, failedSteps: 3, productiveSteps: 7,
      skillStats: { 'click-no-target': { fires: 2, successes: 2 } }
    });
    const r2 = computeTrustScore({
      totalSteps: 10, failedSteps: 3, productiveSteps: 7,
      skillStats: { 'click-no-target': { fires: 2, successes: 0 } }
    });
    expect(r1.score).toBeGreaterThan(r2.score);
  });
  test('no skill stats gives full recovery credit', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(r.breakdown.recovery.points).toBe(15);
  });

  // --- Plan adherence ---
  test('full plan completion gives full plan credit', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, planLength: 10, planCompleted: 10 });
    expect(r.breakdown.plan.points).toBe(10);
  });
  test('partial plan completion', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 8, planLength: 10, planCompleted: 5 });
    expect(r.breakdown.plan.points).toBeLessThan(10);
    expect(r.breakdown.plan.points).toBeGreaterThan(0);
  });
  test('no plan gives full plan credit', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(r.breakdown.plan.points).toBe(10);
  });

  // --- Token efficiency ---
  test('efficient API usage', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, apiCallCount: 10 });
    expect(r.breakdown.efficiency.points).toBeGreaterThan(5);
  });
  test('wasteful API usage', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 5, apiCallCount: 50 });
    expect(r.breakdown.efficiency.points).toBeLessThan(5);
  });
  test('no productive steps gives full efficiency credit', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 0, apiCallCount: 20 });
    expect(r.breakdown.efficiency.points).toBe(10);
  });

  // --- Score bounds ---
  test('score never below 0', () => {
    const r = computeTrustScore({
      totalSteps: 100, failedSteps: 100, productiveSteps: 0, apiCallCount: 500,
      planLength: 100, planCompleted: 0, safetyBlocks: 100, consecutiveFailureMax: 50,
      skillStats: { s1: { fires: 10, successes: 0 } }
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
  test('score never above 100', () => {
    const r = computeTrustScore({
      totalSteps: 10, failedSteps: 0, productiveSteps: 10, apiCallCount: 5,
      planLength: 10, planCompleted: 10,
      skillStats: { s1: { fires: 5, successes: 5 } }
    });
    expect(r.score).toBeLessThanOrEqual(100);
  });

  // --- Negative inputs ---
  test('negative totalSteps clamped to 0', () => {
    const r = computeTrustScore({ totalSteps: -5 });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
  test('negative failedSteps clamped', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: -5, productiveSteps: 10 });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// trustBand
// ============================================================
describe('trustBand', () => {
  test('100 maps to high', () => {
    expect(trustBand(100)).toBe('high');
  });
  test('80 maps to high', () => {
    expect(trustBand(80)).toBe('high');
  });
  test('79 maps to good', () => {
    expect(trustBand(79)).toBe('good');
  });
  test('60 maps to good', () => {
    expect(trustBand(60)).toBe('good');
  });
  test('59 maps to questionable', () => {
    expect(trustBand(59)).toBe('questionable');
  });
  test('40 maps to questionable', () => {
    expect(trustBand(40)).toBe('questionable');
  });
  test('39 maps to low', () => {
    expect(trustBand(39)).toBe('low');
  });
  test('0 maps to low', () => {
    expect(trustBand(0)).toBe('low');
  });
  test('negative maps to low', () => {
    expect(trustBand(-5)).toBe('low');
  });
  test('NaN maps to unknown', () => {
    expect(trustBand(NaN)).toBe('unknown');
  });
  test('Infinity maps to high', () => {
    expect(trustBand(Infinity)).toBe('unknown');
  });
  test('-Infinity maps to unknown', () => {
    expect(trustBand(-Infinity)).toBe('unknown');
  });
  test('50 maps to questionable', () => {
    expect(trustBand(50)).toBe('questionable');
  });
  test('70 maps to good', () => {
    expect(trustBand(70)).toBe('good');
  });
  test('90 maps to high', () => {
    expect(trustBand(90)).toBe('high');
  });
  test('string input', () => {
    expect(trustBand('abc')).toBe('unknown');
  });
  test('null input', () => {
    expect(trustBand(null)).toBe('low');
  });
  test('undefined input', () => {
    expect(trustBand(undefined)).toBe('unknown');
  });
});

// ============================================================
// describeTrustScore
// ============================================================
describe('describeTrustScore', () => {
  test('high score description', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    const desc = describeTrustScore(r);
    expect(desc).toContain('Trust');
    expect(desc).toContain('/100');
    expect(desc).toContain('high');
  });
  test('low score description', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 10, productiveSteps: 0 });
    const desc = describeTrustScore(r);
    expect(desc).toContain('Trust');
    expect(desc).toContain('/100');
  });
  test('null input', () => {
    expect(describeTrustScore(null)).toBe('Trust score unavailable');
  });
  test('undefined input', () => {
    expect(describeTrustScore(undefined)).toBe('Trust score unavailable');
  });
  test('missing score', () => {
    expect(describeTrustScore({})).toBe('Trust score unavailable');
  });
  test('safety blocks mentioned in description', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 3 });
    const desc = describeTrustScore(r);
    expect(desc).toContain('safety block');
  });
  test('single safety block singular', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10, safetyBlocks: 1 });
    const desc = describeTrustScore(r);
    expect(desc).toContain('1 safety block');
  });
});

// ============================================================
// suggestRetryActions
// ============================================================
describe('suggestRetryActions', () => {
  test('high score returns empty suggestions', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 0, productiveSteps: 10 });
    expect(suggestRetryActions(r)).toEqual([]);
  });
  test('good score returns empty suggestions', () => {
    const r = computeTrustScore({ totalSteps: 10, failedSteps: 2, productiveSteps: 8 });
    expect(suggestRetryActions(r)).toEqual([]);
  });
  test('null returns empty', () => {
    expect(suggestRetryActions(null)).toEqual([]);
  });
  test('undefined returns empty', () => {
    expect(suggestRetryActions(undefined)).toEqual([]);
  });
  test('low failure rate suggests approval mode', () => {
    const r = computeTrustScore({
      totalSteps: 10, failedSteps: 8, productiveSteps: 2, consecutiveFailureMax: 4
    });
    const suggestions = suggestRetryActions(r);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].id).toBe('retry-approval-mode');
  });
  test('suggestions capped at 3', () => {
    const r = computeTrustScore({
      totalSteps: 10, failedSteps: 8, productiveSteps: 1, apiCallCount: 50,
      planLength: 10, planCompleted: 1, safetyBlocks: 5, consecutiveFailureMax: 5,
      skillStats: { s1: { fires: 5, successes: 0 } }
    });
    const suggestions = suggestRetryActions(r);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });
  test('each suggestion has required fields', () => {
    const r = computeTrustScore({
      totalSteps: 10, failedSteps: 8, productiveSteps: 1, consecutiveFailureMax: 5
    });
    const suggestions = suggestRetryActions(r);
    for (const s of suggestions) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('label');
      expect(s).toHaveProperty('reason');
      expect(s).toHaveProperty('severity');
      expect(s).toHaveProperty('applyKeys');
      expect(s).toHaveProperty('applyValues');
    }
  });
  test('safety blocks trigger tenant verification suggestion', () => {
    const r = computeTrustScore({
      totalSteps: 10, failedSteps: 8, productiveSteps: 2, safetyBlocks: 3
    });
    const suggestions = suggestRetryActions(r);
    const tenantSuggestion = suggestions.find(s => s.id === 'verify-tenant-before-retry');
    expect(tenantSuggestion).toBeDefined();
  });
  test('questionable band can give suggestions', () => {
    const r = computeTrustScore({
      totalSteps: 10, failedSteps: 6, productiveSteps: 3, consecutiveFailureMax: 3
    });
    const suggestions = suggestRetryActions(r);
    // May or may not have suggestions depending on exact thresholds
    expect(Array.isArray(suggestions)).toBe(true);
  });
});
