/**
 * Tests for background/runtime-profiler.js
 */

import { jest } from '@jest/globals';
import {
  startProfiling,
  stopProfiling,
  takeProfilingSample,
  getProfilingStatus,
  analyzeArchitecture,
  proposeMutations,
  rankMutations,
  attemptHealing,
  getHealingHistory,
  getActiveHealings,
  startCanaryDeployment,
  monitorCanary,
  stopCanaryDeployment,
  runGeneticAlgorithm,
  RuntimeProfiler
} from '../background/runtime-profiler.js';

beforeEach(() => {
  // Reset profiler state between tests by stopping if active
  stopProfiling();
});

describe('startProfiling and stopProfiling', () => {
  test('starts profiling and records start time', () => {
    startProfiling();
    const status = getProfilingStatus();
    expect(status.enabled).toBe(true);
    expect(status.duration).toBeGreaterThanOrEqual(0);
  });

  test('stopProfiling returns summary with no samples', () => {
    startProfiling();
    const summary = stopProfiling();
    expect(summary).toHaveProperty('error'); // no samples collected immediately
  });

  test('stopProfiling with samples returns statistics', () => {
    startProfiling();
    takeProfilingSample();
    takeProfilingSample();
    const summary = stopProfiling();
    expect(summary.sampleCount).toBe(2);
    expect(summary).toHaveProperty('memory');
    expect(summary).toHaveProperty('timing');
    expect(summary).toHaveProperty('recommendations');
  });

  test('stopProfiling with 6+ samples covers detectTrend and detectPerformanceTrend', () => {
    startProfiling();
    for (let i = 0; i < 6; i++) {
      takeProfilingSample();
    }
    const summary = stopProfiling();
    expect(summary.sampleCount).toBe(6);
    expect(summary).toHaveProperty('memory');
    expect(Array.isArray(summary.recommendations)).toBe(true);
  });

  test('profiling is disabled after stop', () => {
    startProfiling();
    stopProfiling();
    expect(getProfilingStatus().enabled).toBe(false);
  });
});

describe('takeProfilingSample', () => {
  test('returns null when profiling is not enabled', () => {
    expect(takeProfilingSample()).toBeNull();
  });

  test('returns sample when profiling is enabled', () => {
    startProfiling();
    const sample = takeProfilingSample();
    expect(sample).not.toBeNull();
    expect(sample).toHaveProperty('timestamp');
    expect(sample).toHaveProperty('memory');
    expect(sample).toHaveProperty('timing');
    expect(sample).toHaveProperty('agent');
  });

  test('sample includes memory usage percent', () => {
    startProfiling();
    const sample = takeProfilingSample();
    expect(typeof sample.memory.usagePercent).toBe('number');
  });

  test('sample includes timing since start', () => {
    startProfiling();
    const sample = takeProfilingSample();
    expect(sample.timing.sinceStart).toBeGreaterThanOrEqual(0);
  });

  test('accumulates multiple samples', () => {
    startProfiling();
    takeProfilingSample();
    takeProfilingSample();
    takeProfilingSample();
    const status = getProfilingStatus();
    expect(status.sampleCount).toBe(3);
  });
});

describe('getProfilingStatus', () => {
  test('returns disabled status when not started', () => {
    const status = getProfilingStatus();
    expect(status.enabled).toBe(false);
    expect(typeof status.duration).toBe('number');
  });

  test('returns correct sample count', () => {
    startProfiling();
    takeProfilingSample();
    takeProfilingSample();
    const status = getProfilingStatus();
    expect(status.sampleCount).toBe(2);
  });

  test('includes recentSample when samples exist', () => {
    startProfiling();
    takeProfilingSample();
    const status = getProfilingStatus();
    expect(status.recentSample).not.toBeNull();
    expect(status.recentSample).toHaveProperty('timestamp');
  });

  test('recentSample is null when no samples', () => {
    startProfiling();
    const status = getProfilingStatus();
    expect(status.recentSample).toBeNull();
  });
});

describe('analyzeArchitecture', () => {
  test('returns analysis with expected shape', () => {
    const result = analyzeArchitecture({
      stepCount: 20,
      apiCallCount: 15,
      modules: ['a', 'b', 'c']
    });
    expect(result).toHaveProperty('bottlenecks');
    expect(result).toHaveProperty('complexity');
    expect(result).toHaveProperty('coupling');
    expect(result).toHaveProperty('cohesion');
    expect(result).toHaveProperty('recommendations');
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  test('handles empty system state', () => {
    const result = analyzeArchitecture({});
    expect(result).toHaveProperty('bottlenecks');
  });

  test('generates non-empty recommendations', () => {
    const result = analyzeArchitecture({ stepCount: 100, apiCallCount: 90 });
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

describe('proposeMutations', () => {
  test('always includes safe mutations', () => {
    const proposals = proposeMutations({ stepCount: 5, apiCallCount: 5 });
    expect(proposals.safe.length).toBeGreaterThan(0);
    expect(Array.isArray(proposals.moderate)).toBe(true);
    expect(Array.isArray(proposals.experimental)).toBe(true);
  });

  test('includes plan_optimization for high step count', () => {
    const proposals = proposeMutations({ stepCount: 50, apiCallCount: 5 });
    const types = proposals.moderate.map(m => m.type);
    expect(types).toContain('plan_optimization');
  });

  test('includes batch_processing for high api call count', () => {
    const proposals = proposeMutations({ stepCount: 5, apiCallCount: 60 });
    const types = proposals.moderate.map(m => m.type);
    expect(types).toContain('batch_processing');
  });

  test('always includes experimental mutations', () => {
    const proposals = proposeMutations({ stepCount: 1, apiCallCount: 1 });
    expect(proposals.experimental.length).toBeGreaterThan(0);
  });
});

describe('rankMutations', () => {
  test('ranks safe > moderate > experimental', () => {
    const proposals = proposeMutations({ stepCount: 50, apiCallCount: 60 });
    const ranked = rankMutations(proposals);
    expect(ranked.length).toBeGreaterThan(0);
    const firstCategory = ranked[0].category;
    expect(firstCategory).toBe('safe');
  });

  test('returns all mutations in single list', () => {
    const proposals = {
      safe: [{ type: 's1' }],
      moderate: [{ type: 'm1' }],
      experimental: [{ type: 'e1' }]
    };
    const ranked = rankMutations(proposals);
    expect(ranked.length).toBe(3);
  });

  test('includes category in each ranked item', () => {
    const proposals = proposeMutations({ stepCount: 5, apiCallCount: 5 });
    const ranked = rankMutations(proposals);
    expect(ranked.every(m => m.category !== undefined)).toBe(true);
  });
});

describe('attemptHealing', () => {
  test('returns healing result with status', () => {
    const result = attemptHealing({ type: 'memory_leak', severity: 'high' });
    expect(result).toHaveProperty('healingId');
    expect(result).toHaveProperty('status');
    expect(['healed', 'failed']).toContain(result.status);
    expect(result.attempts).toBeGreaterThan(0);
  });

  test('handles memory_leak type', () => {
    const result = attemptHealing({ type: 'memory_leak' });
    expect(['healed', 'failed']).toContain(result.status);
  });

  test('handles performance_degradation type', () => {
    const result = attemptHealing({ type: 'performance_degradation' });
    expect(['healed', 'failed']).toContain(result.status);
  });

  test('handles high_failure_rate type', () => {
    const result = attemptHealing({ type: 'high_failure_rate' });
    expect(['healed', 'failed']).toContain(result.status);
  });

  test('handles stuck_loop type', () => {
    const result = attemptHealing({ type: 'stuck_loop' });
    expect(['healed', 'failed']).toContain(result.status);
  });

  test('handles unknown issue type with generic strategy', () => {
    const result = attemptHealing({ type: 'unknown_issue' });
    expect(['healed', 'failed']).toContain(result.status);
  });

  test('adds to healing history', () => {
    const historyBefore = getHealingHistory().length;
    attemptHealing({ type: 'memory_leak' });
    const historyAfter = getHealingHistory().length;
    expect(historyAfter).toBe(historyBefore + 1);
  });

  test('successful healing has successStrategy', () => {
    // Run multiple times to get at least one success (random success probability)
    let healed = null;
    for (let i = 0; i < 20; i++) {
      const r = attemptHealing({ type: 'memory_leak' });
      if (r.status === 'healed') { healed = r; break; }
    }
    if (healed) {
      expect(healed.successStrategy).not.toBeNull();
    }
  });

  test('removes healing from activeHealings after completion', () => {
    attemptHealing({ type: 'stuck_loop' });
    const active = getActiveHealings();
    // All healings should be resolved by the time we check
    // (since healings complete synchronously in this implementation)
    expect(active.length).toBe(0);
  });

  test('all strategies fail → status set to failed (lines 906-909)', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const result = attemptHealing({ type: 'unknown_exhausted' }); // 1 strategy (generic_recovery)
    spy.mockRestore();
    expect(result.status).toBe('failed');
    expect(result.successStrategy).toBeNull();
  });
});

describe('getHealingHistory and getActiveHealings', () => {
  test('getHealingHistory returns array', () => {
    expect(Array.isArray(getHealingHistory())).toBe(true);
  });

  test('getActiveHealings returns array', () => {
    expect(Array.isArray(getActiveHealings())).toBe(true);
  });
});

describe('rankMutations — null safety', () => {
  test('returns empty array when proposals is undefined', () => {
    const result = rankMutations(undefined);
    expect(result).toEqual([]);
  });

  test('returns empty array when categories are missing', () => {
    const result = rankMutations({});
    expect(result).toEqual([]);
  });

  test('handles partial proposals with only safe mutations', () => {
    const result = rankMutations({ safe: [{ type: 'x' }] });
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('safe');
  });
});

describe('startCanaryDeployment', () => {
  afterEach(() => {
    stopCanaryDeployment(false); // clean up state
  });

  test('returns started status with mutation info', () => {
    const mutation = { type: 'reduce_timeout', value: 3000 };
    const result = startCanaryDeployment(mutation);
    expect(result.status).toBe('started');
    expect(result.mutation).toBe(mutation);
    expect(typeof result.startTime).toBe('number');
  });
});

describe('monitorCanary', () => {
  afterEach(() => {
    stopCanaryDeployment(false);
  });

  test('returns inactive when no canary is running', () => {
    stopCanaryDeployment(false);
    const result = monitorCanary({ failures: 0, stepCount: 10, totalTime: 100, memoryUsage: 50 });
    expect(result.status).toBe('inactive');
  });

  test('returns active status after canary started', () => {
    startCanaryDeployment({ type: 'test_mutation' });
    const metrics = { failures: 1, stepCount: 10, totalTime: 1000, memoryUsage: 60 };
    const result = monitorCanary(metrics);
    expect(['active', 'rolled_back']).toContain(result.status);
    expect(typeof result.totalSamples).toBe('number');
  });

  test('triggers rollback when error rate spikes after baseline', () => {
    startCanaryDeployment({ type: 'risky_mutation' });
    const goodMetrics = { failures: 1, stepCount: 100, totalTime: 1000, memoryUsage: 50 };
    // Build a baseline (5+ samples)
    for (let i = 0; i < 6; i++) {
      monitorCanary(goodMetrics);
    }
    // Now spike the error rate far above baseline
    const badMetrics = { failures: 90, stepCount: 100, totalTime: 1000, memoryUsage: 50 };
    const result = monitorCanary(badMetrics);
    expect(result.status).toBe('rolled_back');
  });
});

describe('stopCanaryDeployment', () => {
  test('returns not_active when no canary running', () => {
    stopCanaryDeployment(false);
    const result = stopCanaryDeployment();
    expect(result.status).toBe('not_active');
  });

  test('returns success summary when stopping active canary', () => {
    startCanaryDeployment({ type: 'stop_test' });
    const result = stopCanaryDeployment(true);
    expect(result.status).toBe('success');
    expect(result.mutation).toEqual({ type: 'stop_test' });
  });

  test('returns cancelled summary when stopping with failure', () => {
    startCanaryDeployment({ type: 'cancel_test' });
    const result = stopCanaryDeployment(false);
    expect(result.status).toBe('cancelled');
  });
});

describe('runGeneticAlgorithm', () => {
  test('returns best individual after optimization', () => {
    const result = runGeneticAlgorithm({
      populationSize: 5,
      generations: 3,
      mutationRate: 0.1,
      crossoverRate: 0.7,
      fitnessFunction: (ind) => -(ind.x ** 2 + ind.y ** 2), // minimize distance from origin
      geneSpace: {
        x: { min: -10, max: 10 },
        y: { min: -10, max: 10 }
      }
    });
    expect(result.bestIndividual).toHaveProperty('x');
    expect(result.bestIndividual).toHaveProperty('y');
    expect(typeof result.bestFitness).toBe('number');
    expect(result.history).toHaveLength(3);
  });

  test('uses provided initial population', () => {
    const initial = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: -1, y: -1 }];
    const result = runGeneticAlgorithm({
      populationSize: 3,
      generations: 2,
      mutationRate: 0,
      crossoverRate: 0,
      fitnessFunction: (ind) => -Math.abs(ind.x) - Math.abs(ind.y),
      geneSpace: { x: { min: -5, max: 5 }, y: { min: -5, max: 5 } },
      initialPopulation: initial,
    });
    expect(result.bestIndividual).toBeDefined();
    expect(result.history).toHaveLength(2);
  });
});

describe('RuntimeProfiler facade', () => {
  test('exposes all expected methods', () => {
    expect(typeof RuntimeProfiler.start).toBe('function');
    expect(typeof RuntimeProfiler.stop).toBe('function');
    expect(typeof RuntimeProfiler.sample).toBe('function');
    expect(typeof RuntimeProfiler.getStatus).toBe('function');
    expect(typeof RuntimeProfiler.analyzeArchitecture).toBe('function');
    expect(typeof RuntimeProfiler.proposeMutations).toBe('function');
    expect(typeof RuntimeProfiler.rankMutations).toBe('function');
    expect(typeof RuntimeProfiler.heal).toBe('function');
    expect(typeof RuntimeProfiler.getHealingHistory).toBe('function');
    expect(typeof RuntimeProfiler.getActiveHealings).toBe('function');
  });

  test('heal returns result', () => {
    const result = RuntimeProfiler.heal({ type: 'memory_leak' });
    expect(['healed', 'failed']).toContain(result.status);
  });
});

// ========== Branch coverage gap tests ==========

describe('takeProfilingSample - memory usagePercent (line 90)', () => {
  let origPerf;
  beforeEach(() => { origPerf = global.performance; });
  afterEach(() => { global.performance = origPerf; });

  test('calculates usagePercent when memory limit > 0', () => {
    global.performance = { memory: { jsHeapSizeLimit: 1000, usedJSHeapSize: 800, totalJSHeapSize: 900 } };
    startProfiling();
    const sample = takeProfilingSample();
    expect(sample.memory.usagePercent).toBeCloseTo(80, 1);
  });
});

describe('circular buffer overflow (lines 55, 98-99)', () => {
  test('wraps around after maxSamples reached and _getSamples returns rotated array', () => {
    startProfiling();
    // Fill buffer to 3600 (maxSamples), then take one more to trigger overwrite path
    for (let i = 0; i < 3601; i++) takeProfilingSample();
    const summary = stopProfiling();
    // _getSamples returned the rotated array (line 55); buffer is at capacity
    expect(summary.sampleCount).toBeGreaterThanOrEqual(3600);
  });
});

describe('generateProfilingSummary recommendations', () => {
  let origPerf;
  beforeEach(() => { origPerf = global.performance; });
  afterEach(() => { global.performance = origPerf; });

  test('high memory recommendation when avgMemory > 70 (line 201)', () => {
    global.performance = { memory: { jsHeapSizeLimit: 1000, usedJSHeapSize: 800, totalJSHeapSize: 900 } };
    startProfiling();
    for (let i = 0; i < 5; i++) takeProfilingSample();
    const summary = stopProfiling();
    expect(summary.recommendations).toContain('High memory usage detected - consider reducing history cache size');
  });

  test('memory trend increasing recommendation (line 205)', () => {
    // 10 samples at 40% memory, then 1 at 52% → last > first * 1.1 → increasing trend
    global.performance = { memory: { jsHeapSizeLimit: 1000, usedJSHeapSize: 400, totalJSHeapSize: 500 } };
    startProfiling();
    for (let i = 0; i < 10; i++) takeProfilingSample();
    global.performance = { memory: { jsHeapSizeLimit: 1000, usedJSHeapSize: 520, totalJSHeapSize: 600 } };
    takeProfilingSample();
    const summary = stopProfiling();
    expect(summary.recommendations).toContain('Memory usage trending upward - investigate potential memory leaks');
  });
});

describe('performance degrading recommendation (line 209)', () => {
  let dateSpy;
  afterEach(() => dateSpy?.mockRestore());

  test('degrading recommendation when second-half intervals 20% slower', () => {
    let call = 0;
    // startProfiling calls Date.now() twice, then each sample once
    const times = [1000, 1000, 1010, 1020, 1030, 1040, 1050, 1065, 1080, 1095, 1110, 1125];
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => times[Math.min(call++, times.length - 1)]);
    startProfiling();
    for (let i = 0; i < 10; i++) takeProfilingSample();
    const summary = stopProfiling();
    expect(summary.recommendations).toContain('Performance degrading - review recent code changes and optimize hot paths');
  });
});

describe('analyzeArchitecture branch coverage', () => {
  test('identifies memory bottleneck when memoryUsage > 80 (line 290)', () => {
    const analysis = analyzeArchitecture({ memoryUsage: 85, apiCallCount: 0, stepCount: 1, failures: 0 });
    const b = analysis.bottlenecks.find(b => b.type === 'memory');
    expect(b).toBeDefined();
    expect(b.severity).toBe('critical');
  });

  test('identifies failure rate bottleneck when rate > 0.3 (line 302)', () => {
    const analysis = analyzeArchitecture({ memoryUsage: 0, apiCallCount: 0, stepCount: 10, failures: 4 });
    expect(analysis.bottlenecks.find(b => b.type === 'failure_rate')).toBeDefined();
  });

  test('calculates plan complexity from steps array (line 330)', () => {
    const analysis = analyzeArchitecture({
      plan: { steps: [1, 2, 3, 4, 5] }, history: null, memory: null,
      memoryUsage: 0, apiCallCount: 0, stepCount: 0, failures: 0
    });
    expect(analysis.complexity.planComplexity).toBe(5);
  });

  test('calculates history complexity from unique action types (lines 337-338)', () => {
    const analysis = analyzeArchitecture({
      plan: null,
      history: [{ action: 'click' }, { action: 'type' }, { action: 'click' }],
      memory: null,
      memoryUsage: 0, apiCallCount: 0, stepCount: 0, failures: 0
    });
    expect(analysis.complexity.historyComplexity).toBe(2);
  });

  test('calculates memory complexity from object key count (line 343)', () => {
    const analysis = analyzeArchitecture({
      plan: null, history: null,
      memory: { key1: 1, key2: 2, key3: 3 },
      memoryUsage: 0, apiCallCount: 0, stepCount: 0, failures: 0
    });
    expect(analysis.complexity.memoryComplexity).toBe(3);
  });

  test('generates complexity recommendation when overallScore > 70 (line 433)', () => {
    const analysis = analyzeArchitecture({
      plan: { steps: Array(100).fill({}) },
      history: Array.from({ length: 25 }, (_, i) => ({ action: `act_${i}` })),
      memory: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`k${i}`, i])),
      memoryUsage: 0, apiCallCount: 0, stepCount: 0, failures: 0
    });
    const rec = analysis.recommendations.find(r => r.category === 'complexity');
    expect(rec).toBeDefined();
    expect(rec.recommendation).toContain('simplifying');
  });
});

describe('monitorCanary rollback branches', () => {
  beforeEach(() => stopCanaryDeployment(false));

  const runBaseline = () => {
    const m = { stepCount: 1, failures: 0, totalTime: 1000, memoryUsage: 50 };
    for (let i = 0; i < 5; i++) monitorCanary(m);
  };

  test('triggers rollback on performance degradation (lines 642-643)', () => {
    startCanaryDeployment({ type: 'perf_test' });
    runBaseline();
    // avgStepTime 2000 > 1000 * 1.5 threshold
    const result = monitorCanary({ stepCount: 1, failures: 0, totalTime: 2000, memoryUsage: 50 });
    expect(result.status).toBe('rolled_back');
  });

  test('triggers rollback on memory increase (lines 648-649)', () => {
    startCanaryDeployment({ type: 'mem_test' });
    runBaseline();
    // memoryUsage 70 > 50 * 1.3 = 65 threshold
    const result = monitorCanary({ stepCount: 1, failures: 0, totalTime: 1000, memoryUsage: 70 });
    expect(result.status).toBe('rolled_back');
  });

  test('calls window.__sentinelRollbackHandler on rollback (line 671)', () => {
    const handler = jest.fn();
    globalThis.window = { __sentinelRollbackHandler: handler };
    startCanaryDeployment({ type: 'handler_test' });
    runBaseline();
    // errorRate 0.5 > baseline 0 + threshold 0.1 → rollback
    monitorCanary({ stepCount: 2, failures: 1, totalTime: 1000, memoryUsage: 50 });
    expect(handler).toHaveBeenCalledWith({ type: 'handler_test' }, expect.any(String));
    delete globalThis.window;
  });
});
