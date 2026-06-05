/**
 * Tests for background/predictive-engine.js
 */

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
  PredictiveEngine
} from '../background/predictive-engine.js';

describe('simpleMovingAverage', () => {
  test('forecasts using recent average', () => {
    const data = [10, 10, 10, 10, 10];
    const forecasts = simpleMovingAverage(data, 3);
    expect(forecasts).toHaveLength(3);
    expect(forecasts[0]).toBeCloseTo(10);
  });

  test('handles short data (< 3 points) by repeating last value', () => {
    const forecasts = simpleMovingAverage([5, 8], 2);
    expect(forecasts).toHaveLength(2);
    expect(forecasts[0]).toBe(8);
  });

  test('produces forecast near recent average for increasing data', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const forecasts = simpleMovingAverage([...data], 1);
    expect(forecasts[0]).toBeGreaterThanOrEqual(8);
  });

  test('default periods is 5', () => {
    const forecasts = simpleMovingAverage([1, 2, 3, 4, 5]);
    expect(forecasts).toHaveLength(5);
  });
});

describe('exponentialSmoothing', () => {
  test('returns zeros for empty data', () => {
    const forecasts = exponentialSmoothing([], 3);
    expect(forecasts).toHaveLength(3);
    expect(forecasts[0]).toBe(0);
  });

  test('forecasts constant series as constant', () => {
    const forecasts = exponentialSmoothing([5, 5, 5, 5], 3);
    expect(forecasts[0]).toBeCloseTo(5);
  });

  test('all forecast values are the same (flat smoothed projection)', () => {
    const forecasts = exponentialSmoothing([1, 2, 3, 4, 5], 4);
    expect(forecasts).toHaveLength(4);
    // All should be equal (same smoothed value projected forward)
    expect(forecasts[0]).toBe(forecasts[1]);
    expect(forecasts[1]).toBe(forecasts[2]);
  });

  test('alpha closer to 1 weights recent data more', () => {
    const data = [1, 1, 1, 1, 10]; // spike at end
    const highAlpha = exponentialSmoothing([...data], 1, 0.9);
    const lowAlpha = exponentialSmoothing([...data], 1, 0.1);
    expect(highAlpha[0]).toBeGreaterThan(lowAlpha[0]);
  });
});

describe('linearTrendForecast', () => {
  test('returns last value for single-element data', () => {
    const forecasts = linearTrendForecast([7], 2);
    expect(forecasts).toHaveLength(2);
    expect(forecasts[0]).toBe(7);
  });

  test('forecasts upward trend correctly', () => {
    const data = [1, 2, 3, 4, 5];
    const forecasts = linearTrendForecast(data, 3);
    expect(forecasts[0]).toBeGreaterThan(5);
    expect(forecasts[1]).toBeGreaterThan(forecasts[0]);
  });

  test('forecasts flat trend as approximately flat', () => {
    const data = [10, 10, 10, 10, 10];
    const forecasts = linearTrendForecast(data, 2);
    expect(forecasts[0]).toBeCloseTo(10);
  });

  test('returns correct number of periods', () => {
    expect(linearTrendForecast([1, 2, 3], 7)).toHaveLength(7);
  });
});

describe('predictNextFailure', () => {
  test('returns null prediction for < 2 intervals', () => {
    const result = predictNextFailure([100]);
    expect(result.predicted).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test('returns empty result for zero intervals', () => {
    const result = predictNextFailure([]);
    expect(result.predicted).toBeNull();
  });

  test('predicts mean interval for stable series', () => {
    const result = predictNextFailure([100, 100, 100, 100]);
    expect(result.predicted).toBe(100);
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('includes trend detection', () => {
    const result = predictNextFailure([10, 20, 30, 40, 50, 60]);
    expect(['increasing', 'decreasing', 'stable']).toContain(result.trend);
  });

  test('higher confidence with more data', () => {
    const small = predictNextFailure([100, 200]);
    const large = predictNextFailure([100, 110, 105, 95, 102, 98, 108, 103, 99, 101]);
    expect(large.confidence).toBeGreaterThan(small.confidence);
  });
});

describe('analyzeFailurePatterns', () => {
  test('returns empty object for no failures', () => {
    expect(analyzeFailurePatterns([])).toEqual({});
  });

  test('skips types with only one occurrence', () => {
    const failures = [{ type: 'network', timestamp: 1000 }];
    const result = analyzeFailurePatterns(failures);
    expect(result.network).toBeUndefined();
  });

  test('analyzes patterns by type', () => {
    const failures = [
      { type: 'timeout', timestamp: 1000 },
      { type: 'timeout', timestamp: 3000 },
      { type: 'network', timestamp: 2000 },
      { type: 'network', timestamp: 5000 }
    ];
    const result = analyzeFailurePatterns(failures);
    expect(result.timeout).toBeDefined();
    expect(result.timeout.count).toBe(2);
    expect(result.network).toBeDefined();
    expect(result.network.avgInterval).toBe(3000);
  });
});

describe('calculateRiskScore', () => {
  test('returns 0 risk for zero factors', () => {
    const result = calculateRiskScore({ complexity: 0, novelty: 0, instability: 0 });
    expect(result.score).toBe(0);
    expect(result.level).toBeDefined();
  });

  test('returns high risk for high factors', () => {
    const result = calculateRiskScore({ complexity: 1, novelty: 1, instability: 1, dependencies: 1, impact: 1 });
    expect(result.score).toBeGreaterThan(50);
  });

  test('returns breakdown of each factor', () => {
    const result = calculateRiskScore({ complexity: 0.5 });
    expect(result.breakdown.complexity).toBeDefined();
    expect(result.breakdown.complexity.value).toBe(0.5);
  });

  test('caps score at 100', () => {
    const result = calculateRiskScore({ complexity: 10, novelty: 10, impact: 10 });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('includes recommendation', () => {
    const result = calculateRiskScore({ complexity: 0.3 });
    expect(typeof result.recommendation).toBe('string');
  });
});

describe('monteCarloSimulation', () => {
  test('returns statistical results', () => {
    const result = monteCarloSimulation({
      tasks: [
        { min: 10, mostLikely: 15, max: 20 },
        { min: 5, mostLikely: 8, max: 12 }
      ],
      iterations: 100
    });
    expect(result.mean).toBeGreaterThan(0);
    expect(result.median).toBeGreaterThan(0);
    expect(result.percentiles).toHaveProperty('p50');
    expect(result.percentiles).toHaveProperty('p95');
    expect(result.iterations).toBe(100);
  });

  test('mean is within expected range', () => {
    const result = monteCarloSimulation({
      tasks: [{ min: 10, mostLikely: 10, max: 10 }],
      iterations: 50
    });
    expect(result.mean).toBeCloseTo(10, 0);
  });
});

describe('whatIfAnalysis', () => {
  test('analyzes scenario variations', () => {
    const metric = (s) => s.x * 2;
    const result = whatIfAnalysis({
      baseline: { x: 5 },
      changes: { variations: [{ x: 10 }, { x: 2 }] },
      metric
    });
    expect(result.baseline).toBe(10); // 5 * 2
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].value).toBeDefined();
    expect(typeof result.mostSensitive).toBe('object');
  });

  test('sorts by absolute impact descending', () => {
    const metric = (s) => s.val;
    const result = whatIfAnalysis({
      baseline: { val: 100 },
      changes: { variations: [{ val: 110 }, { val: 200 }] },
      metric
    });
    expect(Math.abs(result.scenarios[0].percentChange)).toBeGreaterThanOrEqual(
      Math.abs(result.scenarios[1].percentChange)
    );
  });

  test('classifies high impact correctly', () => {
    const metric = (s) => s.val;
    const result = whatIfAnalysis({
      baseline: { val: 100 },
      changes: { variations: [{ val: 200 }] }, // 100% change
      metric
    });
    expect(result.scenarios[0].impact).toBe('high');
  });
});

describe('generateOptimizedPlan', () => {
  test('produces execution order', () => {
    const tasks = [
      { id: 'a', duration: 5, dependencies: [] },
      { id: 'b', duration: 3, dependencies: ['a'] },
      { id: 'c', duration: 4, dependencies: ['a'] }
    ];
    const result = generateOptimizedPlan(tasks);
    expect(result.executionOrder[0]).toBe('a');
    expect(result.projectDuration).toBe(9); // a(5) + b(3) or a(5) + c(4) = 9
    expect(result.criticalPath).toContain('a');
  });

  test('handles single task with no dependencies', () => {
    const result = generateOptimizedPlan([{ id: 'x', duration: 7, dependencies: [] }]);
    expect(result.executionOrder).toEqual(['x']);
    expect(result.projectDuration).toBe(7);
    expect(result.criticalPath).toEqual(['x']);
  });

  test('includes slack and isCritical for each task', () => {
    const result = generateOptimizedPlan([
      { id: 't1', duration: 3, dependencies: [] },
      { id: 't2', duration: 2, dependencies: ['t1'] }
    ]);
    const taskDetails = result.tasks;
    expect(taskDetails.every(t => t.slack !== undefined)).toBe(true);
    expect(taskDetails.every(t => typeof t.isCritical === 'boolean')).toBe(true);
  });
});

describe('analyzePredictively', () => {
  test('handles empty data gracefully', () => {
    const result = analyzePredictively({});
    expect(result).toHaveProperty('durationForecast');
    expect(result).toHaveProperty('failurePrediction');
    expect(result).toHaveProperty('riskAssessment');
    expect(result).toHaveProperty('recommendations');
  });

  test('processes run history', () => {
    const data = {
      runHistory: [
        { duration: 5000, url: 'https://a.com' },
        { duration: 6000, url: 'https://b.com' },
        { duration: 7000, url: 'https://c.com' }
      ]
    };
    const result = analyzePredictively(data);
    expect(result.durationForecast.next).toBeGreaterThan(0);
  });

  test('generates recommendations array', () => {
    const result = analyzePredictively({ history: [{ failed: true }, { failed: true }, { failed: true }] });
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  test('accepts both runHistory and history aliases', () => {
    const r1 = analyzePredictively({ runHistory: [{ duration: 100 }] });
    const r2 = analyzePredictively({ history: [{ duration: 100 }] });
    expect(r1.durationForecast.next).toEqual(r2.durationForecast.next);
  });
});

describe('PredictiveEngine facade', () => {
  test('exposes all expected methods', () => {
    expect(typeof PredictiveEngine.forecast).toBe('function');
    expect(typeof PredictiveEngine.exponentialSmoothing).toBe('function');
    expect(typeof PredictiveEngine.linearTrend).toBe('function');
    expect(typeof PredictiveEngine.predictNextFailure).toBe('function');
    expect(typeof PredictiveEngine.analyzePatterns).toBe('function');
    expect(typeof PredictiveEngine.assessRisk).toBe('function');
    expect(typeof PredictiveEngine.monteCarlo).toBe('function');
    expect(typeof PredictiveEngine.whatIf).toBe('function');
    expect(typeof PredictiveEngine.optimizePlan).toBe('function');
    expect(typeof PredictiveEngine.analyze).toBe('function');
  });

  test('analyze returns expected shape', () => {
    const result = PredictiveEngine.analyze({ history: [] });
    expect(result).toHaveProperty('durationForecast');
    expect(result).toHaveProperty('riskAssessment');
  });
});
