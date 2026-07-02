/**
 * UAP Server coverage — second batch:
 *   233-235  executeGoal onStep callback (broadcastStep + sendWebhook per step)
 *   248-250  executeGoal run status/endTime/result set on success
 *   253-271  completionMessage construction + broadcastToClient
 *   273-274  sendWebhook called on completion when webhook present
 *   278      logAudit('goal_complete') call
 *   700-701  chrome.runtime.onStartup listener body + catch
 *   707-708  chrome.runtime.onInstalled listener body + catch
 */

import { jest } from '@jest/globals';

// ── Mock agent-engine.js before any import of uap-server.js ──────────────────
jest.unstable_mockModule('../background/agent-engine.js', () => ({
  executeGoal: jest.fn(),
  startAgent: jest.fn(async () => {}),}));

// ── Chrome API mock ───────────────────────────────────────────────────────────
const _startupListeners = [];
const _installedListeners = [];
const _externalListeners = [];
const storageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys)
          ? keys
          : typeof keys === 'string'
          ? [keys]
          : Object.keys(keys || {});
        for (const k of keyList) result[k] = storageData[k];
        if (callback) process.nextTick(() => callback(result));
        return Promise.resolve(result);
      }),
      set: jest.fn((obj, callback) => {
        Object.assign(storageData, obj);
        if (callback) process.nextTick(() => callback());
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    lastError: null,
    onMessageExternal: {
      addListener: jest.fn((fn) => _externalListeners.push(fn)),
    },
    onStartup: {
      addListener: jest.fn((fn) => _startupListeners.push(fn)),
    },
    onInstalled: {
      addListener: jest.fn((fn) => _installedListeners.push(fn)),
    },
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
};

// ── Import module and mock after mocks are set up ─────────────────────────────
const { uapServer } = await import('../background/uap-server.js');
const { startAgent: mockExecuteGoal } = await import('../background/agent-engine.js');

beforeEach(() => {
  jest.clearAllMocks();
  uapServer.auditLog = [];
  uapServer.clients.clear();
  uapServer.activeRuns.clear();
  uapServer.rateLimits.clear();
  uapServer.peerTrust.clear();
  uapServer.config.enabled = false;
  chrome.storage.local.get.mockImplementation((keys, callback) => {
    const result = {};
    const keyList = Array.isArray(keys)
      ? keys
      : typeof keys === 'string'
      ? [keys]
      : Object.keys(keys || {});
    for (const k of keyList) result[k] = storageData[k];
    if (callback) process.nextTick(() => callback(result));
    return Promise.resolve(result);
  });
});

// ── executeGoal() success path with webhook ───────────────────────────────────

describe('executeGoal() — success path (lines 233-278)', () => {
  test('covers onStep, run update, broadcast, webhook, and audit when goal succeeds', async () => {
    const runId = 'run-success-1';
    const webhook = 'https://webhook.example.com/uap';
    const startTime = Date.now() - 500;

    uapServer.activeRuns.set(runId, {
      clientId: 'client-abc',
      goal: 'search for invoices',
      context: {},
      startTime,
      status: 'running',
    });

    // Mock agent-engine.executeGoal to call onStep and return a result
    mockExecuteGoal.mockImplementationOnce(async (_goal, opts) => {
      if (opts && opts.onStep) {
        opts.onStep({ type: 'navigate', url: 'https://app.example.com' });
      }
      return {
        summary: 'Found 3 invoices',
        findings: [{ id: 1, type: 'invoice', value: '$100' }],
        evidence: { screenshot: 'base64data' },
        trustScore: 0.91,
        stepCount: 4,
        tokensUsed: 800,
        failureCount: 0,
      };
    });

    const broadcastStepSpy = jest.spyOn(uapServer, 'broadcastStep').mockImplementation(() => {});
    const broadcastToClientSpy = jest.spyOn(uapServer, 'broadcastToClient').mockImplementation(() => {});
    const sendWebhookSpy = jest.spyOn(uapServer, 'sendWebhook').mockResolvedValue(undefined);

    await uapServer.executeGoal(runId, 'search for invoices', {}, webhook);

    // Lines 248-250: run updated
    const run = uapServer.activeRuns.get(runId);
    expect(run.status).toBe('completed');
    expect(typeof run.endTime).toBe('number');
    expect(run.result.summary).toBe('Found 3 invoices');

    // Line 233: broadcastStep called by onStep
    expect(broadcastStepSpy).toHaveBeenCalledWith(
      runId,
      { type: 'navigate', url: 'https://app.example.com' }
    );

    // Line 235: sendWebhook called for step
    expect(sendWebhookSpy).toHaveBeenCalledWith(
      webhook,
      expect.objectContaining({ type: 'step', runId })
    );

    // Line 271: broadcastToClient with completion message (lines 253-269 build it)
    expect(broadcastToClientSpy).toHaveBeenCalledWith(
      'client-abc',
      expect.objectContaining({
        type: 'goal_complete',
        status: 'success',
        result: expect.objectContaining({ summary: 'Found 3 invoices' }),
        metrics: expect.objectContaining({ steps: 4 }),
      })
    );

    // Lines 273-274: sendWebhook for completion
    expect(sendWebhookSpy).toHaveBeenCalledWith(
      webhook,
      expect.objectContaining({ type: 'goal_complete' })
    );

    // Line 278: logAudit records goal_complete
    expect(uapServer.auditLog.some((e) => e.event === 'goal_complete' && e.runId === runId)).toBe(true);
  });

  test('skips webhook calls when no webhook URL is provided (lines 234, 273 false branch)', async () => {
    const runId = 'run-no-webhook';

    uapServer.activeRuns.set(runId, {
      clientId: 'client-xyz',
      goal: 'find reports',
      context: {},
      startTime: Date.now(),
      status: 'running',
    });

    mockExecuteGoal.mockResolvedValueOnce({
      summary: 'Done',
      findings: [],
      evidence: {},
      trustScore: 0.8,
      stepCount: 2,
      tokensUsed: 300,
      failureCount: 0,
    });

    const broadcastToClientSpy = jest.spyOn(uapServer, 'broadcastToClient').mockImplementation(() => {});
    const sendWebhookSpy = jest.spyOn(uapServer, 'sendWebhook').mockResolvedValue(undefined);

    await uapServer.executeGoal(runId, 'find reports', {}, null);

    expect(broadcastToClientSpy).toHaveBeenCalled();
    expect(sendWebhookSpy).not.toHaveBeenCalled();
  });
});

// ── chrome.runtime.onStartup listener body ────────────────────────────────────

describe('onStartup listener — body and catch (lines 700-701)', () => {
  test('fires listener and init() succeeds — covers line 700', async () => {
    expect(_startupListeners.length).toBeGreaterThan(0);

    const initSpy = jest.spyOn(uapServer, 'init').mockResolvedValueOnce(undefined);
    _startupListeners[0]();
    await new Promise((r) => process.nextTick(r));

    expect(initSpy).toHaveBeenCalled();
    initSpy.mockRestore();
  });

  test('fires listener and init() rejects — covers catch line 701', async () => {
    const errors = [];
    const origConsoleError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    const initSpy = jest.spyOn(uapServer, 'init').mockRejectedValueOnce(new Error('startup failed'));
    _startupListeners[0]();
    await new Promise((r) => setTimeout(r, 20));

    console.error = origConsoleError;
    expect(errors.some((m) => m.includes('Failed to start'))).toBe(true);
    initSpy.mockRestore();
  });
});

// ── chrome.runtime.onInstalled listener body ──────────────────────────────────

describe('onInstalled listener — body and catch (lines 707-708)', () => {
  test('fires listener and init() succeeds — covers line 707', async () => {
    expect(_installedListeners.length).toBeGreaterThan(0);

    const initSpy = jest.spyOn(uapServer, 'init').mockResolvedValueOnce(undefined);
    _installedListeners[0]();
    await new Promise((r) => process.nextTick(r));

    expect(initSpy).toHaveBeenCalled();
    initSpy.mockRestore();
  });

  test('fires listener and init() rejects — covers catch line 708', async () => {
    const errors = [];
    const origConsoleError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    const initSpy = jest.spyOn(uapServer, 'init').mockRejectedValueOnce(new Error('install failed'));
    _installedListeners[0]();
    await new Promise((r) => setTimeout(r, 20));

    console.error = origConsoleError;
    expect(errors.some((m) => m.includes('Failed to start'))).toBe(true);
    initSpy.mockRestore();
  });
});
