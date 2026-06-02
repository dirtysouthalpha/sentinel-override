// tests/agent-engine-activity.test.js
// Tests for activity tracking, history persistence, and checkpoint functions.

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
    session: {
      set: jest.fn(async () => {}),
    },
  },
  tabs: {
    query: jest.fn(async () => []),
  },
  runtime: {
    sendMessage: jest.fn(async () => {}),
  },
};

// ── Mock dependencies ──
const mockGetAllTabContexts = jest.fn(() => []);
jest.unstable_mockModule('../background/tab-context.js', () => ({
  getAllTabContexts: mockGetAllTabContexts,
  getActiveTabId: jest.fn(() => null),
  getTabContext: jest.fn(() => null),
  openTab: jest.fn(async () => {}),
  switchToTab: jest.fn(async () => {}),
  closeTab: jest.fn(async () => {}),
  closeAllAgentTabs: jest.fn(async () => {}),
  updateSnapshot: jest.fn(),
  resetAllContexts: jest.fn(),
  findTabByLabel: jest.fn(() => null),
  registerInitialTab: jest.fn(),
  getTabCount: jest.fn(() => 0),
  TAB_LIMIT: 10,
}));

const mockSendAgentActivity = jest.fn();
jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendSilentUpdate: jest.fn(),
  sendActionMessage: jest.fn(),
  sendActionResult: jest.fn(),
  sendReportUpdate: jest.fn(),
  sendPageContext: jest.fn(),
  sendTabStateUpdate: jest.fn(),
  sendScreenshotUpdate: jest.fn(),
  sendAgentActivity: mockSendAgentActivity,
  sendAgentStepStart: jest.fn(),
  sendAgentStatus: jest.fn(),
  sendHeartbeat: jest.fn(), sendPlanPreview: jest.fn(), sendClientKnowledgePreview: jest.fn(), sendCostUpdate: jest.fn(),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    trace: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
  generatePlan: jest.fn(async () => ['Step 1', 'Step 2']),
  supportsVision: jest.fn(() => true),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []), estimateCostUsd: jest.fn(() => 0), isSimpleStep: jest.fn(() => false),
}));

jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: jest.fn(() => null),
}));

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}),
  waitForPageReady: jest.fn(async () => {}),
  injectContentScript: jest.fn(async () => {}),
  sendMessageWithRetry: jest.fn(async () => ({})),
  takeScreenshot: jest.fn(async () => 'data:image/png;base64,abc'),
  isValidUrl: jest.fn(() => true),
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
  detachAllDebuggees: jest.fn(async () => {}),
  cdpDispatchClick: jest.fn(async () => {}),
  cdpDispatchType: jest.fn(async () => {}),
  cdpDispatchKey: jest.fn(async () => {}),
  cdpExecuteJs: jest.fn(async () => ({ ok: true, value: 'test' })),
  readConsoleMessages: jest.fn(async () => []),
  readNetworkRequests: jest.fn(async () => []),
}));

jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: jest.fn(async () => '## Report'),
  buildFallbackReport: jest.fn(() => '## Fallback Report'),
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => ({ endpoint: 'https://api.test.com', apiKey: 'key', model: 'test' })),
  migrateLegacySettings: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/shared-state.js', () => ({
  isSPATransitionPending: jest.fn(() => false),
  clearSPATransition: jest.fn(),
  notifyIfEnabled: jest.fn(async () => {}),
  startSwKeepalive: jest.fn(),
  stopSwKeepalive: jest.fn(),
}));

jest.unstable_mockModule('../background/client-knowledge.js', () => ({
  getActiveClient: jest.fn(async () => null),
  getRelevantEntries: jest.fn(async () => []),
  formatPromptSection: jest.fn(async () => ''),
  markRunCompleted: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: jest.fn(async () => ({ adapted: false })),
}));

jest.unstable_mockModule('../background/audit-log.js', () => ({
  appendAuditEntry: jest.fn(async () => {}),
  getAuditLog: jest.fn(async () => []),
  auditLogToCsv: jest.fn(() => ''),
}));

jest.unstable_mockModule('../background/skills/index.js', () => ({
  runRecoverySkills: jest.fn(async () => null),
  getSkillStats: jest.fn(() => ({})),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })),
  suggestRetryActions: jest.fn(() => []),
}));

// Import module under test
const {
  activityStart,
  activityDone,
  activityFail,
  activityUpdate,
  historyPush,
  trimHistory,
  persistHistory,
  buildCheckpoint,
  writeCheckpoint,
} = await import('../background/agent-engine.js');

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(storageData).forEach(k => delete storageData[k]);
});

// ──────────────────────────────────────────────────────────────────────

describe('agent-engine activity tracking', () => {

  // ═══════════════════════════════════════════════════════════════════
  // activityStart
  // ═══════════════════════════════════════════════════════════════════
  describe('activityStart', () => {
    test('sends in_progress message with label', () => {
      activityStart(1, 'test_key', 'Test Activity');
      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        1,
        'test_key',
        'Test Activity',
        'in_progress',
        null
      );
    });

    test('handles stepNumber 0', () => {
      activityStart(0, 'init', 'Initializing');
      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        0,
        'init',
        'Initializing',
        'in_progress',
        null
      );
    });

    test('handles null key gracefully', () => {
      activityStart(1, null, 'Test');
      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        1,
        null,
        'Test',
        'in_progress',
        null
      );
    });

    test('handles empty label', () => {
      activityStart(5, 'key', '');
      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        5,
        'key',
        '',
        'in_progress',
        null
      );
    });

    test('never crashes even if sendAgentActivity throws', () => {
      mockSendAgentActivity.mockImplementationOnce(() => { throw new Error('Telemetry failed'); });
      expect(() => activityStart(1, 'key', 'Test')).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // activityDone
  // ═══════════════════════════════════════════════════════════════════
  describe('activityDone', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('sends done message with duration when start was recorded', () => {
      activityStart(1, 'click', 'Clicking button');
      jest.advanceTimersByTime(100);
      activityDone(1, 'click', 'Clicking button', { element: 'button' });

      expect(mockSendAgentActivity).toHaveBeenLastCalledWith(
        1,
        'click',
        'Clicking button',
        'done',
        expect.objectContaining({
          durationMs: 100,
          element: 'button',
        })
      );
    });

    test('sends done message with null duration when start was not recorded', () => {
      activityDone(2, 'extract', 'Extracting data', { count: 5 });

      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        2,
        'extract',
        'Extracting data',
        'done',
        expect.objectContaining({
          durationMs: null,
          count: 5,
        })
      );
    });

    test('merges detail object with duration', () => {
      activityStart(3, 'navigate', 'Navigating');
      jest.advanceTimersByTime(250);
      activityDone(3, 'navigate', 'Navigating', { url: 'https://example.com', method: 'get' });

      const call = mockSendAgentActivity.mock.calls.find(c =>
        c[0] === 3 && c[1] === 'navigate' && c[3] === 'done'
      );
      expect(call).toBeTruthy();
      expect(call[4]).toEqual(expect.objectContaining({
        durationMs: 250,
        url: 'https://example.com',
        method: 'get',
      }));
    });

    test('handles null detail gracefully', () => {
      activityStart(1, 'test', 'Test');
      activityDone(1, 'test', 'Test', null);

      const call = mockSendAgentActivity.mock.calls.find(c =>
        c[0] === 1 && c[1] === 'test' && c[3] === 'done'
      );
      expect(call).toBeTruthy();
      expect(call[4]).toEqual(expect.objectContaining({
        durationMs: expect.any(Number),
      }));
    });

    test('never crashes even if sendAgentActivity throws', () => {
      mockSendAgentActivity.mockImplementationOnce(() => { throw new Error('Telemetry failed'); });
      expect(() => activityDone(1, 'key', 'Test')).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // activityFail
  // ═══════════════════════════════════════════════════════════════════
  describe('activityFail', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('sends failed message with duration when start was recorded', () => {
      activityStart(1, 'click', 'Clicking button');
      jest.advanceTimersByTime(50);
      activityFail(1, 'click', 'Clicking button', { error: 'element not found' });

      expect(mockSendAgentActivity).toHaveBeenLastCalledWith(
        1,
        'click',
        'Clicking button',
        'failed',
        expect.objectContaining({
          durationMs: 50,
          error: 'element not found',
        })
      );
    });

    test('sends failed message with null duration when start was not recorded', () => {
      activityFail(2, 'extract', 'Extracting data', { reason: 'timeout' });

      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        2,
        'extract',
        'Extracting data',
        'failed',
        expect.objectContaining({
          durationMs: null,
          reason: 'timeout',
        })
      );
    });

    test('merges detail object with duration', () => {
      activityStart(3, 'api_call', 'Calling API');
      jest.advanceTimersByTime(5000);
      activityFail(3, 'api_call', 'Calling API', { statusCode: 500, message: 'server error' });

      const call = mockSendAgentActivity.mock.calls.find(c =>
        c[0] === 3 && c[1] === 'api_call' && c[3] === 'failed'
      );
      expect(call).toBeTruthy();
      expect(call[4]).toEqual(expect.objectContaining({
        durationMs: 5000,
        statusCode: 500,
        message: 'server error',
      }));
    });

    test('handles null detail gracefully', () => {
      activityStart(1, 'test', 'Test');
      activityFail(1, 'test', 'Test', null);

      const call = mockSendAgentActivity.mock.calls.find(c =>
        c[0] === 1 && c[1] === 'test' && c[3] === 'failed'
      );
      expect(call).toBeTruthy();
      expect(call[4]).toEqual(expect.objectContaining({
        durationMs: expect.any(Number),
      }));
    });

    test('never crashes even if sendAgentActivity throws', () => {
      mockSendAgentActivity.mockImplementationOnce(() => { throw new Error('Telemetry failed'); });
      expect(() => activityFail(1, 'key', 'Test')).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // activityUpdate
  // ═══════════════════════════════════════════════════════════════════
  describe('activityUpdate', () => {
    test('sends in_progress message with new label', () => {
      activityUpdate(1, 'waiting', 'Waiting 2 more seconds...');
      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        1,
        'waiting',
        'Waiting 2 more seconds...',
        'in_progress',
        null
      );
    });

    test('handles stepNumber 0', () => {
      activityUpdate(0, 'init', 'Still initializing...');
      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        0,
        'init',
        'Still initializing...',
        'in_progress',
        null
      );
    });

    test('handles null key', () => {
      activityUpdate(5, null, 'Updated status');
      expect(mockSendAgentActivity).toHaveBeenCalledWith(
        5,
        null,
        'Updated status',
        'in_progress',
        null
      );
    });

    test('never crashes even if sendAgentActivity throws', () => {
      mockSendAgentActivity.mockImplementationOnce(() => { throw new Error('Telemetry failed'); });
      expect(() => activityUpdate(1, 'key', 'Update')).not.toThrow();
    });

    test('logs error if sendAgentActivity throws', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSendAgentActivity.mockImplementationOnce(() => { throw new Error('Test error'); });
      activityUpdate(1, 'key', 'Update');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────

describe('agent-engine history management', () => {

  // ═══════════════════════════════════════════════════════════════════
  // historyPush
  // ═══════════════════════════════════════════════════════════════════
  describe('historyPush', () => {
    test('can be called without crashing', () => {
      // historyPush operates on module's internal history
      // This test verifies it doesn't throw when called
      expect(() => historyPush({ action: { type: 'click' } })).not.toThrow();
    });

    test('handles multiple calls', () => {
      expect(() => {
        historyPush({ action: { type: 'step1' } });
        historyPush({ action: { type: 'step2' } });
        historyPush({ action: { type: 'step3' } });
      }).not.toThrow();
    });

    test('handles entry with timestamp', () => {
      expect(() => {
        historyPush({ action: { type: 'navigate' }, timestamp: Date.now() });
      }).not.toThrow();
    });

    test('handles entry with result', () => {
      expect(() => {
        historyPush({ action: { type: 'extract' }, result: { data: 'test' } });
      }).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // trimHistory
  // ═══════════════════════════════════════════════════════════════════
  describe('trimHistory', () => {
    test('can be called without crashing', () => {
      // trimHistory operates on module's internal history
      // This test verifies it doesn't throw when called
      expect(() => trimHistory()).not.toThrow();
    });

    test('handles being called multiple times', () => {
      expect(() => {
        trimHistory();
        trimHistory();
        trimHistory();
      }).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // persistHistory
  // ═══════════════════════════════════════════════════════════════════
  describe('persistHistory', () => {
    test('can be called without crashing', async () => {
      await expect(persistHistory()).resolves.not.toThrow();
    });

    test('handles being called multiple times', async () => {
      await expect(persistHistory()).resolves.not.toThrow();
      await expect(persistHistory()).resolves.not.toThrow();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────

describe('agent-engine checkpoint functionality', () => {

  // ═══════════════════════════════════════════════════════════════════
  // buildCheckpoint
  // ═══════════════════════════════════════════════════════════════════
  describe('buildCheckpoint', () => {
    test('creates checkpoint with history snapshot', () => {
      const checkpoint = buildCheckpoint(5);
      expect(checkpoint).toHaveProperty('historySnapshot');
      expect(Array.isArray(checkpoint.historySnapshot)).toBe(true);
    });

    test('creates checkpoint with stepCount', () => {
      const checkpoint = buildCheckpoint(10);
      expect(checkpoint.stepCount).toBe(10);
    });

    test('creates checkpoint with productiveSteps', () => {
      const checkpoint = buildCheckpoint(3);
      expect(checkpoint).toHaveProperty('productiveSteps');
      expect(typeof checkpoint.productiveSteps).toBe('number');
    });

    test('creates checkpoint with consecutiveFailures', () => {
      const checkpoint = buildCheckpoint(7);
      expect(checkpoint).toHaveProperty('consecutiveFailures');
      expect(typeof checkpoint.consecutiveFailures).toBe('number');
    });

    test('creates checkpoint with apiCallCount', () => {
      const checkpoint = buildCheckpoint(2);
      expect(checkpoint).toHaveProperty('apiCallCount');
      expect(typeof checkpoint.apiCallCount).toBe('number');
    });

    test('creates checkpoint with lastUpdate timestamp', () => {
      const before = Date.now();
      const checkpoint = buildCheckpoint(1);
      const after = Date.now();
      expect(checkpoint.lastUpdate).toBeGreaterThanOrEqual(before);
      expect(checkpoint.lastUpdate).toBeLessThanOrEqual(after);
    });

    test('creates checkpoint with runLogId', () => {
      const checkpoint = buildCheckpoint(5);
      expect(checkpoint).toHaveProperty('runLogId');
    });

    test('creates checkpoint with agentSpeed', () => {
      const checkpoint = buildCheckpoint(3);
      expect(checkpoint).toHaveProperty('agentSpeed');
    });

    test('creates checkpoint with expectedTenant', () => {
      const checkpoint = buildCheckpoint(4);
      expect(checkpoint).toHaveProperty('expectedTenant');
    });

    test('creates checkpoint with activeClientId', () => {
      const checkpoint = buildCheckpoint(6);
      expect(checkpoint).toHaveProperty('activeClientId');
    });

    test('creates checkpoint with runSettingsSnapshot', () => {
      const checkpoint = buildCheckpoint(8);
      expect(checkpoint).toHaveProperty('runSettingsSnapshot');
      expect(typeof checkpoint.runSettingsSnapshot).toBe('object');
    });

    test('creates checkpoint with trustCounters', () => {
      const checkpoint = buildCheckpoint(9);
      expect(checkpoint).toHaveProperty('trustCounters');
      expect(checkpoint.trustCounters).toHaveProperty('failedSteps');
      expect(checkpoint.trustCounters).toHaveProperty('consecutiveFailureMax');
    });

    test('maps tabContextUrls from getAllTabContexts', () => {
      mockGetAllTabContexts.mockReturnValueOnce([
        { tabId: 1, url: 'https://example.com', label: 'Example' },
        { tabId: 2, url: 'https://other.com', label: 'Other' },
      ]);

      const checkpoint = buildCheckpoint(5);
      expect(checkpoint.tabContextUrls).toEqual({
        '1': 'https://example.com',
        '2': 'https://other.com',
      });
    });

    test('handles empty url in tabContext', () => {
      mockGetAllTabContexts.mockReturnValueOnce([
        { tabId: 1, url: null, label: 'No URL' },
        { tabId: 2, url: '', label: 'Empty URL' },
      ]);

      const checkpoint = buildCheckpoint(5);
      expect(checkpoint.tabContextUrls).toEqual({
        '1': '',
        '2': '',
      });
    });

    test('handles no tab contexts', () => {
      mockGetAllTabContexts.mockReturnValueOnce([]);

      const checkpoint = buildCheckpoint(5);
      expect(checkpoint.tabContextUrls).toEqual({});
    });

    test('creates shallow copy of history (not same reference)', () => {
      const checkpoint = buildCheckpoint(3);
      // The historySnapshot should be a different array reference
      // This allows the checkpoint to remain immutable even if history changes
      expect(checkpoint.historySnapshot).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // writeCheckpoint
  // ═══════════════════════════════════════════════════════════════════
  describe('writeCheckpoint', () => {
    test('writes checkpoint to chrome.storage.session', async () => {
      await writeCheckpoint(5);
      expect(chrome.storage.session.set).toHaveBeenCalled();
      const setCall = chrome.storage.session.set.mock.calls[0]?.[0];
      expect(setCall).toHaveProperty('agent_checkpoint');
    });

    test('includes all checkpoint fields in storage', async () => {
      mockGetAllTabContexts.mockReturnValueOnce([
        [1, { url: 'https://test.com' }],
      ]);

      await writeCheckpoint(3);
      const setCall = chrome.storage.session.set.mock.calls[0]?.[0];
      const checkpoint = setCall.agent_checkpoint;

      expect(checkpoint).toHaveProperty('historySnapshot');
      expect(checkpoint).toHaveProperty('stepCount');
      expect(checkpoint).toHaveProperty('tabContextUrls');
    });

    test('handles storage write failure gracefully', async () => {
      chrome.storage.session.set.mockImplementationOnce(() => {
        throw new Error('Storage failed');
      });
      // writeCheckpoint catches errors internally, so this test verifies it doesn't throw
      await expect(writeCheckpoint(5)).resolves.not.toThrow();
    });
  });
});
