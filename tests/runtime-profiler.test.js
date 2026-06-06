/**
 * Tests for background/runtime-profiler.js
 */

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
