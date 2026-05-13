// tests/trust-score.test.js
// Unit tests for background/trust-score.js pure functions.
// These have zero chrome.* or DOM dependencies — safe to run in Node.

import { computeTrustScore, trustBand, describeTrustScore } from '../background/trust-score.js';

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
});

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
});
