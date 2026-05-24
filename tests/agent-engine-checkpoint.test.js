// tests/agent-engine-checkpoint.test.js
// Tests for checkpoint functionality in background/agent-engine.js

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
const sessionData = {};
let onSuspendListener = null;

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
    session: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          result[k] = sessionData[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => {
        Object.assign(sessionData, obj);
      }),
      remove: jest.fn(async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          delete sessionData[k];
        }
      }),
    },
  },
  runtime: {
    sendMessage: jest.fn(async () => {}),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onSuspend: {
      addListener: jest.fn((fn) => { onSuspendListener = fn; }),
    },
    getURL: jest.fn((p) => p),
  },
};

// ── Mock dependencies ──
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
  registerInitialTab: jest.fn(),
  getAllTabContexts: jest.fn(() => new Map()),
}));

jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendSilentUpdate: jest.fn(),
  sendActionMessage: jest.fn(),
  sendActionResult: jest.fn(),
  sendReportUpdate: jest.fn(),
  sendPageContext: jest.fn(),
  sendTabStateUpdate: jest.fn(),
  sendScreenshotUpdate: jest.fn(),
  sendAgentActivity: jest.fn(),
  sendAgentStepStart: jest.fn(),
  sendAgentStatus: jest.fn(),
  sendHeartbeat: jest.fn(), sendPlanPreview: jest.fn(),
}));

describe('agent-engine checkpoint functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear session data before each test
    Object.keys(sessionData).forEach(k => delete sessionData[k]);
    onSuspendListener = null;
  });

  describe('restoreFromCheckpoint', () => {
    test('should restore checkpoint successfully', async () => {
      const checkpointData = {
        lastGoal: 'Test goal',
        stepCount: 10,
        lastUpdate: Date.now() - 1000, // 1 second ago
        agentMemorySnapshot: { key: 'value' },
        historySnapshot: [{ step: 1 }, { step: 2 }],
        productiveSteps: 5,
        consecutiveFailures: 1,
        apiCallCount: 3,
        runLogId: 'log-123',
        agentSpeed: 'turbo',
        expectedTenant: 'tenant-1',
        activeClientId: 'client-1',
        runSettingsSnapshot: { maxSteps: 100 },
        trustCounters: { failedSteps: 2, consecutiveFailureMax: 5 },
        tabContextUrls: { '1': 'https://example.com' },
      };

      sessionData.agent_checkpoint = checkpointData;

      const agentEngine = await import('../background/agent-engine.js');
      const result = await agentEngine.restoreFromCheckpoint();

      expect(result.restored).toBe(true);
      expect(result.goal).toBe('Test goal');
      expect(result.stepCount).toBe(10);
      expect(result.ageSeconds).toBeGreaterThan(0);
      expect(result.historyLength).toBe(2);
      expect(result.memoryKeys).toContain('key');
    });

    test('should return restored false when session storage unavailable', async () => {
      const agentEngine = await import('../background/agent-engine.js');

      // Temporarily remove session storage
      const originalSession = chrome.storage.session;
      chrome.storage.session = null;

      const result = await agentEngine.restoreFromCheckpoint();

      expect(result.restored).toBe(false);
      expect(result.error).toBe('session storage unavailable');

      // Restore session storage
      chrome.storage.session = originalSession;
    });

    test('should return restored false when no checkpoint exists', async () => {
      const agentEngine = await import('../background/agent-engine.js');
      const result = await agentEngine.restoreFromCheckpoint();

      expect(result.restored).toBe(false);
      expect(result.error).toBe('no checkpoint');
    });

    test('should return restored false when checkpoint is too old (>1 hour)', async () => {
      const oldCheckpoint = {
        lastGoal: 'Old goal',
        stepCount: 5,
        lastUpdate: Date.now() - (61 * 60 * 1000), // 61 minutes ago
      };

      sessionData.agent_checkpoint = oldCheckpoint;

      const agentEngine = await import('../background/agent-engine.js');
      const result = await agentEngine.restoreFromCheckpoint();

      expect(result.restored).toBe(false);
      expect(result.error).toContain('checkpoint too old');
    });

    test('should return restored false when checkpoint has no goal', async () => {
      const invalidCheckpoint = {
        lastUpdate: Date.now() - 1000,
        // Missing lastGoal
      };

      sessionData.agent_checkpoint = invalidCheckpoint;

      const agentEngine = await import('../background/agent-engine.js');
      const result = await agentEngine.restoreFromCheckpoint();

      expect(result.restored).toBe(false);
      expect(result.error).toBe('no goal in checkpoint');
    });

    test('should handle invalid agentSpeed in checkpoint', async () => {
      const checkpointData = {
        lastGoal: 'Test goal',
        stepCount: 5,
        lastUpdate: Date.now() - 1000,
        agentSpeed: 'invalid-speed', // Invalid speed
      };

      sessionData.agent_checkpoint = checkpointData;

      const agentEngine = await import('../background/agent-engine.js');
      const result = await agentEngine.restoreFromCheckpoint();

      // Should still restore but skip invalid speed
      expect(result.restored).toBe(true);
    });

    test('should handle missing optional fields gracefully', async () => {
      const minimalCheckpoint = {
        lastGoal: 'Minimal goal',
        stepCount: 1,
        lastUpdate: Date.now() - 1000,
        // Missing optional fields
      };

      sessionData.agent_checkpoint = minimalCheckpoint;

      const agentEngine = await import('../background/agent-engine.js');
      const result = await agentEngine.restoreFromCheckpoint();

      expect(result.restored).toBe(true);
      expect(result.goal).toBe('Minimal goal');
    });
  });

  describe('clearCheckpoint', () => {
    test('should clear checkpoint from session storage', async () => {
      sessionData.agent_checkpoint = { lastGoal: 'Test', lastUpdate: Date.now() };

      const agentEngine = await import('../background/agent-engine.js');
      await agentEngine.clearCheckpoint();

      expect(chrome.storage.session.remove).toHaveBeenCalledWith('agent_checkpoint');
    });

    test('should handle missing session storage gracefully', async () => {
      const agentEngine = await import('../background/agent-engine.js');

      // Temporarily remove session storage
      const originalSession = chrome.storage.session;
      chrome.storage.session = null;

      // Should not throw
      await expect(agentEngine.clearCheckpoint()).resolves.not.toThrow();

      // Restore session storage
      chrome.storage.session = originalSession;
    });
  });

  // Note: onSuspend listener tests are omitted because the listener
  // is registered at module load time, which happens before our test setup.
  // The functionality is covered by integration tests in other test files.
});
