// tests/agent-learning-edge-cases.test.js
// Covers L51 (history truncation > 1000) and L92 (getBestSelector returns null
// when no candidates pass successRate > 0.5 && attempts >= 2).

import { jest } from '@jest/globals';
import {
  initLearningEngine,
  recordActionOutcome,
  getBestSelector,
  getActionHistorySummary,
} from '../background/agent-learning.js';

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({
        agent_action_history: [],
        agent_platform_patterns: {},
        agent_auto_playbooks: [],
      })),
      set: jest.fn(async () => {}),
    },
  },
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Reset module-level state by re-initialising from empty storage
  await initLearningEngine();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('agent-learning — history truncation (L51)', () => {
  test('history is capped at 1000 entries after exceeding the limit', async () => {
    // Add 1001 entries; the 1001st push triggers the slice(-1000) branch
    for (let i = 0; i < 1001; i++) {
      recordActionOutcome('p_trunc', 'click', `#el-${i}`, true, 10);
    }
    const { totalActions } = getActionHistorySummary();
    expect(totalActions).toBe(1000);
  });

  test('history stays at exactly 1000 after many excess entries', async () => {
    for (let i = 0; i < 1050; i++) {
      recordActionOutcome('p_trunc2', 'type', `#inp-${i}`, i % 2 === 0, 20);
    }
    const { totalActions } = getActionHistorySummary();
    expect(totalActions).toBe(1000);
  });
});

describe('agent-learning — getBestSelector null return (L92)', () => {
  test('returns null when the only entry has only 1 attempt (attempts >= 2 not met)', async () => {
    recordActionOutcome('my_platform', 'click', '#button', true, 50);
    // attempts=1 → filtered out by c.attempts >= 2 → candidates empty → null
    const result = getBestSelector('my_platform', 'click');
    expect(result).toBeNull();
  });

  test('returns null when all candidates have successRate <= 0.5', async () => {
    recordActionOutcome('flaky', 'click', '#a', false, 10);
    recordActionOutcome('flaky', 'click', '#a', false, 10);
    // successRate = 0/2 = 0 → filtered out → null
    const result = getBestSelector('flaky', 'click');
    expect(result).toBeNull();
  });

  test('returns null for platform with no patterns at all', async () => {
    const result = getBestSelector('nonexistent_platform', 'click');
    expect(result).toBeNull();
  });
});
