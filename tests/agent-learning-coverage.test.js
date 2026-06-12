/**
 * agent-learning error path coverage — tests catch blocks in initLearningEngine
 * and _persist (the debounced storage flush).
 */

import { jest } from '@jest/globals';
import {
  initLearningEngine,
  recordActionOutcome,
  getBestSelector,
  getFailedSelectors,
  findOneShotPlaybook,
  maybeGeneratePlaybook,
} from '../background/agent-learning.js';

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('agent-learning — branch coverage', () => {
  beforeEach(async () => {
    // No _initialized guard: every call resets module state
    await initLearningEngine();
  });

  test('recordActionOutcome: null selector evaluates || "" right side (line 58[1])', () => {
    recordActionOutcome('p58', 'click', null, true, 50);
  });

  test('getBestSelector: attempts>0 (line 87[0]) and avgDuration truthy (line 88[0])', () => {
    recordActionOutcome('p88a', 'click', '#a', true, 100);
    recordActionOutcome('p88a', 'click', '#a', true, 80);
    const r = getBestSelector('p88a', 'click');
    expect(r).not.toBeNull();
    expect(r.avgDuration).toBe(90);
  });

  describe('getBestSelector: attempts=0 (line 87[1]) and avgDuration=0 (line 88[1])', () => {
    beforeEach(async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        agent_platform_patterns: {
          p87: { 'click:#z': { attempts: 0, successes: 0, totalDuration: 0, avgDuration: 0 } }
        }
      });
      await initLearningEngine();
    });
    test('ternary false (attempts=0) and avgDuration 0||0 right side taken', () => {
      expect(getBestSelector('p87', 'click')).toBeNull();
    });
  });

  test('getFailedSelectors: 3 failures → attempts>0 true branch (line 108[0])', () => {
    recordActionOutcome('p108', 'click', '#f', false, 200);
    recordActionOutcome('p108', 'click', '#f', false, 200);
    recordActionOutcome('p108', 'click', '#f', false, 200);
    expect(getFailedSelectors('p108', 'click')).toContain('#f');
  });

  describe('getFailedSelectors: attempts=0 (line 108[1])', () => {
    beforeEach(async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        agent_platform_patterns: {
          p108b: { 'click:#z2': { attempts: 0, successes: 0, totalDuration: 0, avgDuration: 0 } }
        }
      });
      await initLearningEngine();
    });
    test('ternary false (attempts=0) → successRate=0; not a failure', () => {
      expect(getFailedSelectors('p108b', 'click')).toEqual([]);
    });
  });

  test('findOneShotPlaybook: null goal evaluates || "" right side (line 136[1])', () => {
    expect(findOneShotPlaybook(null, 'pany')).toBeNull();
  });

  test('findOneShotPlaybook: runCount=3 sr=1.0 returns playbook (line 141 true)', () => {
    const goal = 'log into admin panel now';
    const plat = 'p141';
    const steps = [{ type: 'click', selector: '#login' }];
    maybeGeneratePlaybook(goal, plat, steps);
    maybeGeneratePlaybook(goal, plat, steps);
    maybeGeneratePlaybook(goal, plat, steps);
    expect(findOneShotPlaybook(goal, plat)).not.toBeNull();
  });

  test('findOneShotPlaybook: runCount=1 not returned (line 141 false)', () => {
    const goal = 'run the daily report job';
    const plat = 'p141b';
    maybeGeneratePlaybook(goal, plat, [{ type: 'click', selector: '#r' }]);
    expect(findOneShotPlaybook(goal, plat)).toBeNull();
  });

  test('maybeGeneratePlaybook: null goal evaluates || "" right side (line 153[1])', () => {
    expect(maybeGeneratePlaybook(null, 'p153', [])).toBeNull();
  });

  test('maybeGeneratePlaybook: second call with steps updates runCount (line 162 true)', () => {
    const goal = 'open status dashboard view';
    const plat = 'p162';
    const steps = [{ type: 'navigate', selector: '#status' }];
    maybeGeneratePlaybook(goal, plat, steps);
    const updated = maybeGeneratePlaybook(goal, plat, steps);
    expect(updated.runCount).toBe(2);
  });

  test('maybeGeneratePlaybook: second call with empty steps skips sr update (line 162 false)', () => {
    const goal = 'check system health status';
    const plat = 'p162b';
    maybeGeneratePlaybook(goal, plat, [{ type: 'click', selector: '#health' }]);
    const updated = maybeGeneratePlaybook(goal, plat, []);
    expect(updated.runCount).toBe(2);
    expect(updated.successRate).toBe(1.0);
  });

  test('maybeGeneratePlaybook: step with no type uses "unknown" (line 178[1])', () => {
    const r = maybeGeneratePlaybook('press a button now', 'p178', [{ selector: '#x' }]);
    expect(r.steps[0].type).toBe('unknown');
  });

  test('maybeGeneratePlaybook: step with no selector uses "" (line 179[1])', () => {
    const r = maybeGeneratePlaybook('click unknown element now', 'p179', [{ type: 'click' }]);
    expect(r.steps[0].selector).toBe('');
  });

  test('maybeGeneratePlaybook: truthy type+selector hit left-side branches (lines 178[0], 179[0])', () => {
    const r = maybeGeneratePlaybook('submit the contact form here', 'p178t', [{ type: 'click', selector: '#submit' }]);
    expect(r.steps[0].type).toBe('click');
    expect(r.steps[0].selector).toBe('#submit');
  });
});

describe('agent-learning — error path coverage', () => {
  test('initLearningEngine catch: storage.get rejection logs warning and does not throw', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(initLearningEngine()).resolves.toBeUndefined();

    console.warn = origWarn;
    expect(warns.some(m => m.includes('Init failed'))).toBe(true);
  });

  test('_persist catch: storage.set rejection logs warning and does not throw', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));

    // Trigger a debounced persist
    recordActionOutcome('test_platform', 'click', '#btn', true, 100);

    // Advance the debounce timer (5000ms in the module)
    jest.runAllTimers();
    // Flush microtasks from the async _persist
    await Promise.resolve();
    await Promise.resolve();

    console.warn = origWarn;
    expect(warns.some(m => m.includes('Persist failed'))).toBe(true);
  });
});
