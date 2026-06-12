// tests/predictive-engine-branch-coverage.test.js
// Covers uncovered branches in background/predictive-engine.js.
// Branch IDs and line numbers reference coverage_test/coverage-final.json.

import {
  simpleMovingAverage,
  exponentialSmoothing,
  linearTrendForecast,
  predictNextFailure,
  analyzeFailurePatterns,
  calculateRiskScore,
  monteCarloSimulation,
  whatIfAnalysis,
  generateOptimizedPlan,
  analyzePredictively,
} from '../background/predictive-engine.js';

// ─── simpleMovingAverage / exponentialSmoothing / linearTrendForecast ─────────

describe('predictive-engine — time series branch coverage', () => {
  test('b2[1] L15: empty data fires data[data.length-1]||0 fallback', () => {
    // data.length < 3 with empty array → data[-1] is undefined → || 0 fires
    const result = simpleMovingAverage([], 3);
    expect(result).toEqual([0, 0, 0]);
  });

  test('b2[1] L15: single zero element fires data[data.length-1]||0 fallback', () => {
    // data[0] = 0 → falsy → || 0 fires
    const result = simpleMovingAverage([0], 2);
    expect(result).toEqual([0, 0]);
  });

  test('b3 L37: default periods arg fires for exponentialSmoothing', () => {
    // Call without periods → default 5 branch taken
    const result = exponentialSmoothing([10, 20, 30]);
    expect(result).toHaveLength(5);
  });

  test('b6 L62: default periods arg fires for linearTrendForecast', () => {
    // Call without periods → default 5 branch taken
    const result = linearTrendForecast([10, 20]);
    expect(result).toHaveLength(5);
  });
});

// ─── detectTrend increasing path (b13) ───────────────────────────────────────

describe('predictive-engine — detectTrend increasing branch (b13[0])', () => {
  test('b13[0] L143: trend=increasing when second half avg > first half by >10%', () => {
    // predictNextFailure calls detectTrend when len > 2
    // intervals=[10,20,30,40]: firstHalf=[10,20] avg=15, secondHalf=[30,40] avg=35
    // percentChange=(35-15)/15*100 ≈ 133% > 10 → 'increasing'
    const result = predictNextFailure([10, 20, 30, 40]);
    expect(result.trend).toBe('increasing');
  });
});

// ─── calculateRiskScore unknown factor (b16) ─────────────────────────────────

describe('predictive-engine — calculateRiskScore unknown factor (b16[1])', () => {
  test('b16[1] L209: unknown factor key uses 0.1 fallback weight', () => {
    // 'custom_factor' not in weights → weights['custom_factor'] is undefined → || 0.1 fires
    const result = calculateRiskScore({ custom_factor: 1.0 });
    expect(result.breakdown.custom_factor.weight).toBe(0.1);
  });
});

// ─── getRiskLevel / getRiskRecommendation score tiers ─────────────────────────

describe('predictive-engine — getRiskLevel and getRiskRecommendation score tiers', () => {
  test('b18[0] L232: score>=70 returns critical level', () => {
    // All max factors: (0.2+0.25+0.2+0.15+0.2)*100 = 100 → critical
    const result = calculateRiskScore({ complexity: 1, novelty: 1, instability: 1, dependencies: 1, impact: 1 });
    expect(result.score).toBe(100);
    expect(result.level).toBe('critical');
    expect(result.recommendation).toBe('Require explicit approval and rollback plan');
  });

  test('b19[0] L233: score in [50,70) returns high level', () => {
    // complexity=1(0.2) + novelty=1(0.25) + instability=1(0.2) → total=0.65 → score=65
    const result = calculateRiskScore({ complexity: 1, novelty: 1, instability: 1 });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(70);
    expect(result.level).toBe('high');
  });

  test('b22[0] L240 getRiskRecommendation: score in [50,70) returns approval message', () => {
    const result = calculateRiskScore({ complexity: 1, novelty: 1, instability: 1 });
    expect(result.recommendation).toBe('Require approval and detailed testing');
  });

  test('b23[0] L241 getRiskRecommendation: score in [30,50) returns testing message', () => {
    // novelty=1(0.25) + complexity=1(0.2) → total=0.45 → score=45
    const result = calculateRiskScore({ novelty: 1, complexity: 1 });
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThan(50);
    expect(result.level).toBe('moderate');
    expect(result.recommendation).toBe('Recommended testing before deployment');
  });
});

// ─── monteCarloSimulation default iterations (b25) ───────────────────────────

describe('predictive-engine — monteCarloSimulation default iterations (b25)', () => {
  test('b25 L256: call without iterations arg fires default 1000', () => {
    const result = monteCarloSimulation({ tasks: [{ min: 1, mostLikely: 3, max: 5 }] });
    expect(result.iterations).toBe(1000);
    expect(result.mean).toBeGreaterThan(0);
  });
});

// ─── whatIfAnalysis branch coverage ──────────────────────────────────────────

describe('predictive-engine — whatIfAnalysis branch coverage', () => {
  test('b27[1] L327: baselineValue===0 fires zero-division fallback (returns 0%)', () => {
    // metric always returns 0 → baselineValue=0 → ternary false → percentChange=0
    const result = whatIfAnalysis({
      baseline: { val: 0 },
      changes: { variations: [{ val: 5 }] },
      metric: s => s.val,
    });
    expect(result.scenarios[0].percentChange).toBe(0);
  });

  test('b29[0] L334: Math.abs(percentChange)>20 fires high impact', () => {
    // val goes 10 → 15 → percentChange=50% > 20 → impact='high'
    const result = whatIfAnalysis({
      baseline: { val: 10 },
      changes: { variations: [{ val: 15 }] },
      metric: s => s.val,
    });
    expect(result.scenarios[0].impact).toBe('high');
  });

  test('b30[1] L344: empty variations → results[0] undefined → mostSensitive=null', () => {
    // No variations → results=[] → results[0]?.variation = undefined → || null fires
    const result = whatIfAnalysis({
      baseline: {},
      changes: { variations: [] },
      metric: () => 1,
    });
    expect(result.mostSensitive).toBeNull();
  });

  test('b31[1] L351: all low-impact variations → getWhatIfRecommendation returns fallback', () => {
    // percentChange < 10 → impact='low' for all → highImpact.length=0 → else branch fires
    const result = whatIfAnalysis({
      baseline: { val: 100 },
      changes: { variations: [{ val: 101 }, { val: 102 }] },
      metric: s => s.val,
    });
    expect(result.recommendation).toBe('All variables show acceptable impact levels');
  });
});

// ─── generateOptimizedPlan branch coverage ────────────────────────────────────

describe('predictive-engine — generateOptimizedPlan branch coverage', () => {
  test('b32/b37[1]+b39[1]: tasks without dependencies field fire || [] and ternary false', () => {
    // b32 L378: task.dependencies undefined → || [] fires
    // b37 L415: same
    // b39 L417: deps.length=0 → ternary false → maxDepFinish=0
    const result = generateOptimizedPlan([
      { id: 'a', duration: 3 },
      { id: 'b', duration: 2 },
    ]);
    expect(result.executionOrder).toContain('a');
    expect(result.executionOrder).toContain('b');
    // parallel tasks — projectDuration = max(3, 2) = 3
    expect(result.projectDuration).toBe(3);
  });

  test('b36[1] L403: task with two deps — first dep processed does not reduce inDegree to 0', () => {
    // c depends on both a and b; when a completes, c.inDegree=2-1=1 ≠ 0 → b36[1] fires
    // when b completes, c.inDegree=1-1=0 → b36[0] fires
    const result = generateOptimizedPlan([
      { id: 'a', duration: 1, dependencies: [] },
      { id: 'b', duration: 1, dependencies: [] },
      { id: 'c', duration: 1, dependencies: ['a', 'b'] },
    ]);
    expect(result.executionOrder[result.executionOrder.length - 1]).toBe('c');
  });

  test('b41[1] L436: zero-duration task makes latestStart=0 → || projectDuration fires', () => {
    // latestStart(b) = projectDuration - b.duration = 5 - 5 = 0 (falsy)
    // When computing latestFinish(a): min(latestStart(b) || projectDuration) = min(0 || 5) = 5
    const result = generateOptimizedPlan([
      { id: 'a', duration: 0, dependencies: [] },
      { id: 'b', duration: 5, dependencies: ['a'] },
    ]);
    expect(result.projectDuration).toBe(5);
    // 'b' has slack=0 (critical), 'a' has slack=5 (not critical)
    const taskB = result.tasks.find(t => t.id === 'b');
    expect(taskB.isCritical).toBe(true);
  });
});

// ─── analyzePredictively — non-array runHistory fires b50/b52 ─────────────────

describe('predictive-engine — analyzePredictively non-array runHistory (b50/b52)', () => {
  test('b50[1]/b52[1]: string runHistory fires calculateNovelty/InstabilityRisk else branch', () => {
    // data.runHistory='string' (truthy) → runHistory='string' (not array)
    // calculateNoveltyRisk: Array.isArray('string')=false → b50[1] fires, uses []
    // calculateInstabilityRisk: same → b52[1] fires
    const result = analyzePredictively({ runHistory: 'not-an-array' });
    expect(result).toBeDefined();
    // complexityRisk uses default avgSteps=10 → score is non-zero but small
    expect(result.riskAssessment.score).toBeGreaterThanOrEqual(0);
  });
});

// ─── generatePredictiveRecommendations score-tier and pattern branches ─────────

describe('predictive-engine — generatePredictiveRecommendations branches (b58/b59/b60/b61)', () => {
  test('b59[0]+b61[1]: score in [50,70) adds canary recommendation (non-empty)', () => {
    // avgSteps=50→complexity=1, platforms=5→dep=1, modifyingActions=20→impact=1
    // 10 unique urls → novelty=0.5, no failures → instability=0
    // score = (0.2+0.125+0+0.15+0.2)*100 = 67.5 → 68, in [50,70)
    const runHistory = Array.from({ length: 10 }, (_, i) => ({ url: `u${i}`, duration: 100 }));
    const result = analyzePredictively({
      performanceMetrics: { avgSteps: 50, platforms: 5, modifyingActions: 20 },
      runHistory,
    });
    expect(result.riskAssessment.score).toBeGreaterThanOrEqual(50);
    expect(result.riskAssessment.score).toBeLessThan(70);
    expect(result.recommendations).toContain(
      'Implement canary deployment with automatic rollback'
    );
  });

  test('b58[0]+b61[1]: score>=70 adds manual-approval recommendation (non-empty)', () => {
    // All max + all runs failing → instability=1
    // score = (0.2+0.125+0.2+0.15+0.2)*100 = 87.5 → 88 >= 70
    const runHistory = Array.from({ length: 10 }, (_, i) => ({
      url: `u${i}`, duration: 100, failed: true,
    }));
    const result = analyzePredictively({
      performanceMetrics: { avgSteps: 50, platforms: 5, modifyingActions: 20 },
      runHistory,
    });
    expect(result.riskAssessment.score).toBeGreaterThanOrEqual(70);
    expect(result.recommendations).toContain(
      'High-risk scenario detected - implement manual approval gates'
    );
  });

  test('b60[0]+b61[1]: failure pattern with confidence>70 adds pattern recommendation', () => {
    // 9 failures same type → intervals.length=8, confidence=min(95,80)=80 > 70 → b60[0] fires
    // confidence=80>70 adds watch recommendation → recommendations not empty → b61[1] fires
    const failures = Array.from({ length: 9 }, (_, i) => ({
      type: 'network',
      timestamp: i * 100,
    }));
    const result = analyzePredictively({ failureHistory: failures, runHistory: [] });
    const hasPatternRec = result.recommendations.some(r => r.includes('Watch for'));
    expect(hasPatternRec).toBe(true);
  });

  test('b60[1]+b61[0]: low-confidence pattern and low risk → standard execution', () => {
    // 5 failures → intervals.length=4, confidence=min(95,40)=40 ≤ 70 → b60[1] fires
    // score=0 < 50 → b58[1] and b59[1] fire
    // no recommendations added → recommendations.length=0 → b61[0] fires → 'Standard execution'
    const failures = Array.from({ length: 5 }, (_, i) => ({
      type: 'timeout',
      timestamp: i * 100,
    }));
    const result = analyzePredictively({ failureHistory: failures, runHistory: [] });
    expect(result.recommendations).toContain(
      'Standard execution - no significant risks detected'
    );
  });
});
