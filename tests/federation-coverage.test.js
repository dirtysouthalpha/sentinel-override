/**
 * Coverage for federation.js uncovered paths:
 *   163-202  distributeGoal()
 *   343-365  waitForCompletion() — timeout callback + setInterval polling
 *   574      startRebalanceLoop() callback
 *   694-702  chrome.runtime.onStartup/onInstalled auto-init listeners
 *
 * Uses dynamic import so globalThis.chrome is fully set up before the module
 * evaluates its top-level auto-init block (lines 693-705).
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: jest.fn((e) => (e && e.message) || String(e)),
}));

// Capture module-level listener callbacks before federation.js loads
let onStartupCb = null;
let onInstalledCb = null;

const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys
          : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) { result[k] = storageData[k]; }
        if (callback) process.nextTick(() => callback(result));
        return Promise.resolve(result);
      }),
      set: jest.fn((obj, callback) => {
        Object.assign(storageData, obj);
        if (callback) process.nextTick(() => callback());
        return Promise.resolve();
      }),
      remove: jest.fn(() => Promise.resolve()),
    },
  },
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve()),
    onStartup: { addListener: jest.fn((fn) => { onStartupCb = fn; }) },
    onInstalled: { addListener: jest.fn((fn) => { onInstalledCb = fn; }) },
  },
};

// Dynamic import runs AFTER globalThis.chrome is initialized,
// so the module-level if-block at lines 693-705 executes and registers listeners.
const { federation } = await import('../background/federation.js');

beforeEach(async () => {
  await federation.init(); // returns early (config.enabled=false)
});

afterEach(async () => {
  await federation.shutdown();
  jest.restoreAllMocks();
});

// ── chrome.runtime.onStartup/onInstalled auto-init (lines 694-702) ───────────

describe('auto-init — onStartup/onInstalled listeners (lines 694-702)', () => {
  test('onStartup.addListener called with a function', () => {
    expect(typeof onStartupCb).toBe('function');
  });

  test('onInstalled.addListener called with a function', () => {
    expect(typeof onInstalledCb).toBe('function');
  });

  test('onStartup callback calls federation.init() (line 695)', async () => {
    const initSpy = jest.spyOn(federation, 'init').mockResolvedValue();
    onStartupCb();
    await Promise.resolve();
    expect(initSpy).toHaveBeenCalled();
  });

  test('onInstalled callback calls federation.init() (line 701)', async () => {
    const initSpy = jest.spyOn(federation, 'init').mockResolvedValue();
    onInstalledCb();
    await Promise.resolve();
    expect(initSpy).toHaveBeenCalled();
  });

  test('onStartup logs error when init() rejects (line 696)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(federation, 'init').mockRejectedValue(new Error('startup fail'));
    onStartupCb();
    await new Promise(r => process.nextTick(r));
    expect(errSpy).toHaveBeenCalledWith('[Federation] Failed to start:', expect.any(String));
  });

  test('onInstalled logs error when init() rejects (line 702)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(federation, 'init').mockRejectedValue(new Error('install fail'));
    onInstalledCb();
    await new Promise(r => process.nextTick(r));
    expect(errSpy).toHaveBeenCalledWith('[Federation] Failed to start:', expect.any(String));
  });
});

// ── distributeGoal (lines 163-202) ───────────────────────────────────────────

describe('distributeGoal (lines 163-202)', () => {
  test('orchestrates decompose → assign → wait → reconcile and returns result', async () => {
    jest.spyOn(federation, 'decomposeGoal').mockResolvedValue([
      { description: 'sub 1', requirements: [] },
      { description: 'sub 2', requirements: ['network'] },
    ]);
    jest.spyOn(federation, 'assignSubGoal').mockResolvedValue();
    jest.spyOn(federation, 'waitForCompletion').mockResolvedValue();
    jest.spyOn(federation, 'reconcileResults').mockResolvedValue('final');

    const result = await federation.distributeGoal('deploy firewall', { env: 'prod' });

    expect(federation.decomposeGoal).toHaveBeenCalledWith('deploy firewall', { env: 'prod' });
    expect(federation.assignSubGoal).toHaveBeenCalledTimes(2);
    expect(federation.waitForCompletion).toHaveBeenCalled();
    expect(federation.reconcileResults).toHaveBeenCalled();
    expect(result).toBe('final');
  });

  test('marks job status complete and stores finalResult (lines 199-201)', async () => {
    jest.spyOn(federation, 'decomposeGoal').mockResolvedValue([
      { description: 'only sub-goal', requirements: [] },
    ]);
    jest.spyOn(federation, 'assignSubGoal').mockResolvedValue();
    jest.spyOn(federation, 'waitForCompletion').mockResolvedValue();
    jest.spyOn(federation, 'reconcileResults').mockResolvedValue('done');

    await federation.distributeGoal('configure vlan');
    const jobs = [...federation.activeJobs.values()];
    expect(jobs.some(j => j.status === 'complete' && j.finalResult === 'done')).toBe(true);
  });

  test('uses default empty context when called with one argument (line 162)', async () => {
    jest.spyOn(federation, 'decomposeGoal').mockResolvedValue([]);
    jest.spyOn(federation, 'assignSubGoal').mockResolvedValue();
    jest.spyOn(federation, 'waitForCompletion').mockResolvedValue();
    jest.spyOn(federation, 'reconcileResults').mockResolvedValue(null);

    await expect(federation.distributeGoal('solo goal')).resolves.toBeNull();
    expect(federation.decomposeGoal).toHaveBeenCalledWith('solo goal', {});
  });
});

// ── waitForCompletion — early return (line 344) ───────────────────────────────

describe('waitForCompletion — unknown jobId early return (line 344)', () => {
  test('returns undefined when jobId not in activeJobs', async () => {
    await expect(federation.waitForCompletion('nonexistent-xyz')).resolves.toBeUndefined();
  });
});

// ── waitForCompletion — setInterval polling (lines 356-367) ──────────────────

describe('waitForCompletion — setInterval polling resolves (lines 356-367)', () => {
  test('resolves on first tick when all sub-goals are already terminal', async () => {
    const jobId = 'wfc-all-done';
    federation.activeJobs.set(jobId, {
      id: jobId,
      subGoals: [{ status: 'complete' }, { status: 'failed' }, { status: 'timeout' }],
      status: 'distributing',
    });

    let checkFn = null;
    const orig = globalThis.setInterval;
    globalThis.setInterval = (cb, delay) => { checkFn = cb; return orig(cb, delay); };
    const p = federation.waitForCompletion(jobId);
    globalThis.setInterval = orig;

    checkFn(); // all sub-goals terminal → clears timers, resolves
    await p;
    federation.activeJobs.delete(jobId);
  });

  test('resolves when job.status becomes timeout (line 362 second condition)', async () => {
    const jobId = 'wfc-status-timeout';
    const job = { id: jobId, subGoals: [{ status: 'running' }], status: 'distributing' };
    federation.activeJobs.set(jobId, job);

    let checkFn = null;
    const orig = globalThis.setInterval;
    globalThis.setInterval = (cb, delay) => { checkFn = cb; return orig(cb, delay); };
    const p = federation.waitForCompletion(jobId);
    globalThis.setInterval = orig;

    job.status = 'timeout';
    checkFn(); // job.status in ['timeout','failed'] → resolves
    await p;
    federation.activeJobs.delete(jobId);
  });

  test('resolves when job.status becomes failed', async () => {
    const jobId = 'wfc-status-failed';
    const job = { id: jobId, subGoals: [{ status: 'pending' }], status: 'distributing' };
    federation.activeJobs.set(jobId, job);

    let checkFn = null;
    const orig = globalThis.setInterval;
    globalThis.setInterval = (cb, delay) => { checkFn = cb; return orig(cb, delay); };
    const p = federation.waitForCompletion(jobId);
    globalThis.setInterval = orig;

    job.status = 'failed';
    checkFn(); // job.status === 'failed' → resolves
    await p;
    federation.activeJobs.delete(jobId);
  });
});

// ── waitForCompletion — timeout callback body (lines 347-352) ────────────────

describe('waitForCompletion — timeout callback marks sub-goals (lines 347-352)', () => {
  test('marks assigned/running sub-goals as timeout, sets job.status=timeout', async () => {
    const jobId = 'wfc-timeout-body';
    const job = {
      id: jobId,
      subGoals: [
        { status: 'assigned' },
        { status: 'running' },
        { status: 'complete' },
        { status: 'failed' },
      ],
      status: 'distributing',
    };
    federation.activeJobs.set(jobId, job);

    let timeoutFn = null;
    let checkFn = null;
    const origST = globalThis.setTimeout;
    const origSI = globalThis.setInterval;
    globalThis.setTimeout = (cb, delay) => { timeoutFn = cb; return origST(cb, delay); };
    globalThis.setInterval = (cb, delay) => { checkFn = cb; return origSI(cb, delay); };

    const p = federation.waitForCompletion(jobId);
    globalThis.setTimeout = origST;
    globalThis.setInterval = origSI;

    expect(timeoutFn).not.toBeNull();
    timeoutFn(); // executes lines 347-352

    expect(job.status).toBe('timeout');
    expect(job.subGoals[0].status).toBe('timeout'); // was assigned
    expect(job.subGoals[1].status).toBe('timeout'); // was running
    expect(job.subGoals[2].status).toBe('complete'); // unchanged
    expect(job.subGoals[3].status).toBe('failed');   // unchanged

    checkFn(); // job.status='timeout' → resolves promise
    await p;
    federation.activeJobs.delete(jobId);
  });
});

// ── startRebalanceLoop — callback calls rebalance (line 574) ─────────────────

describe('startRebalanceLoop — setInterval callback calls rebalance (line 574)', () => {
  test('fires this.rebalance() when the interval ticks', () => {
    let intervalFn = null;
    const orig = globalThis.setInterval;
    globalThis.setInterval = (cb, delay) => { intervalFn = cb; return orig(cb, delay); };
    federation.startRebalanceLoop();
    globalThis.setInterval = orig;

    expect(intervalFn).not.toBeNull();
    jest.spyOn(federation, 'rebalance').mockImplementation(() => {});
    intervalFn(); // line 574: this.rebalance()
    expect(federation.rebalance).toHaveBeenCalled();
    // shutdown() in afterEach clears federation.rebalanceTimer
  });
});
