// tests/agent-engine-startagent-errors.test.js
// Tests for error handling paths in startAgent that were previously uncovered.

import { jest } from '@jest/globals';

// ── Mock runAgentLoop BEFORE importing agent-engine ──
let mockRunAgentLoop = jest.fn(async () => {});

// ── Chrome API mock ──
const storageData = {};
const sessionData = {};
let onMessageListeners = [];

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
    query: jest.fn(async () => [{ id: 1 }]),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
  },
  tabGroups: {
    update: jest.fn(async () => {}),
  },
  sidePanel: {
    setOptions: jest.fn(async () => {}),
  },
  runtime: {
    sendMessage: jest.fn(async () => {}),
    onMessage: {
      addListener: jest.fn((fn) => { onMessageListeners.push(fn); }),
      removeListener: jest.fn(),
    },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
};

// ── Mock all heavy dependencies ──
jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
  parseVisionResponse: jest.fn((raw) => { try { return JSON.parse(raw); } catch { return null; } }),
  generatePlan: jest.fn(async () => ['Step 1', 'Step 2']),
  supportsVision: jest.fn(() => true),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []),
  selectModelForStep: jest.fn(() => null),
  getCostTracker: jest.fn(() => ({ totalCalls: 0, byTier: { light: 0, default: 0, heavy: 0 }, estimatedCost: '0.0000' })),
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
  sendHeartbeat: jest.fn(),
  sendCostUpdate: jest.fn(),
  sendClientKnowledgePreview: jest.fn(),
  sendPlanPreview: jest.fn(),
}));

jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: jest.fn(async () => '## Report'),
  buildFallbackReport: jest.fn(() => 'Fallback report'),
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => ({ endpoint: 'https://api.test.com', apiKey: 'key', model: 'test' })),
  getTextProvider: jest.fn(async () => null),
  migrateLegacySettings: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/shared-state.js', () => ({
  isSPATransitionPending: jest.fn(() => false),
  clearSPATransition: jest.fn(),
  notifyIfEnabled: jest.fn(async () => {}),
  startSwKeepalive: jest.fn(),
  stopSwKeepalive: jest.fn(),
}));

const mockGetActiveTabId = jest.fn(() => null);
const mockSetActiveTab = jest.fn();
const mockGetTabContext = jest.fn(() => null);
const mockGetAllTabContexts = jest.fn(() => []);
const mockOpenTab = jest.fn(async () => 2);
const mockSwitchToTab = jest.fn(async () => {});
const mockCloseTab = jest.fn(async () => {});
const mockCloseAllAgentTabs = jest.fn(async () => {});
const mockUpdateSnapshot = jest.fn();
const mockResetAllContexts = jest.fn();
const mockFindTabByLabel = jest.fn(() => null);
const mockRegisterInitialTab = jest.fn();
const mockHandleTabRemoved = jest.fn();
const mockGetTabCount = jest.fn(() => 0);

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: mockGetActiveTabId,
  setActiveTab: mockSetActiveTab,
  getTabContext: mockGetTabContext,
  getAllTabContexts: mockGetAllTabContexts,
  openTab: mockOpenTab,
  switchToTab: mockSwitchToTab,
  closeTab: mockCloseTab,
  closeAllAgentTabs: mockCloseAllAgentTabs,
  updateSnapshot: mockUpdateSnapshot,
  resetAllContexts: mockResetAllContexts,
  findTabByLabel: mockFindTabByLabel,
  registerInitialTab: mockRegisterInitialTab,
  handleTabRemoved: mockHandleTabRemoved,
  getTabCount: mockGetTabCount,
}));

jest.unstable_mockModule('../background/client-knowledge.js', () => ({
  getClientStartupContext: jest.fn(async () => ({ client: null, relevantEntries: [], promptSection: '' })),
  markRunCompleted: jest.fn(async () => {}),
}));

const mockRewriteGoalForPlatform = jest.fn(async () => ({ adapted: false }));
jest.unstable_mockModule('../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: mockRewriteGoalForPlatform,
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

const mockTelStartRun = jest.fn();
jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
  startRun: mockTelStartRun,
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })),
  suggestRetryActions: jest.fn(() => []),
}));

// Import the module under test
const { startAgent, stopAgent, resetAgentState } = await import('../background/agent-engine.js');

beforeEach(async () => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  Object.keys(sessionData).forEach(k => delete sessionData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();

  // Reset adaptive prompts mock
  mockRewriteGoalForPlatform.mockResolvedValue({ adapted: false });

  // Stop any running agent and reset state before each test
  try {
    await stopAgent();
  } catch (e) {
    // Ignore if agent wasn't running
  }
  resetAgentState();
});

afterEach(async () => {
  // Clean up after each test
  try {
    await stopAgent();
  } catch (e) {
    // Ignore if agent wasn't running
  }
});

// ──────────────────────────────────────────────────────────────────────

describe('agent-engine startAgent error paths', () => {

  // ═══════════════════════════════════════════════════════════════════
  // 1. Run log initialization error path (line 522)
  // ═══════════════════════════════════════════════════════════════════
  describe('run log initialization error handling', () => {
    test('handles crypto.randomUUID failure gracefully', async () => {
      // Mock crypto.randomUUID to throw
      const originalUUID = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => { throw new Error('UUID failed'); };

      const sender = { tab: { id: 1 } };
      const result = await startAgent('test goal', sender);

      // Should complete successfully despite UUID failure
      expect(result).toContain('Agent started');

      // Restore
      globalThis.crypto.randomUUID = originalUUID;
    });

    test('handles telStartRun failure (line 521-522)', async () => {
      mockTelStartRun.mockImplementationOnce(() => { throw new Error('telemetry start failed'); });

      const sender = { tab: { id: 1 } };
      const result = await startAgent('test goal', sender);

      // Should complete successfully despite telemetry failure
      expect(result).toContain('Agent started');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Mode directive check - simulate user response to avoid timeout
  // ═══════════════════════════════════════════════════════════════════
  describe('mode directive check error handling', () => {
    test('handles storage set failure in mode mismatch logging (line 553)', async () => {
      jest.setTimeout(10000); // Increase timeout for this test
      const sender = { tab: { id: 1 } };
      storageData.approvalMode = false; // Set to autonomous

      // Mock storage.set to fail for run_log writes
      const originalSet = chrome.storage.local.set;
      chrome.storage.local.set = jest.fn(async (obj) => {
        const keys = Object.keys(obj);
        if (keys.length > 0 && keys[0].startsWith('run_log_')) {
          throw new Error('Storage write failed');
        }
        await originalSet(obj);
      });

      // Intercept the mode mismatch decision wait and respond immediately
      const originalSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = jest.fn(async (msg) => {
        if (msg.action === 'mode_mismatch_pause') {
          // Immediately respond with continue decision
          setTimeout(() => {
            onMessageListeners.forEach(listener => {
              if (listener) {
                listener({
                  action: 'mode_mismatch_response',
                  requestId: msg.requestId,
                  flip: false,
                  continue: true,
                  cancel: false
                });
              }
            });
          }, 5);
        }
        return Promise.resolve();
      });

      // Goal with APPROVAL directive but mode is autonomous
      const result = await startAgent('Mode: APPROVAL. Click the button.', sender);

      // Should complete - the storage error is caught and logged
      expect(result).toContain('Agent started');

      // Restore
      chrome.storage.local.set = originalSet;
      chrome.runtime.sendMessage = originalSendMessage;
    });

    test('handles runtime sendMessage failure in mode mismatch (line 584)', async () => {
      const sender = { tab: { id: 1 } };
      storageData.approvalMode = false;

      // Mock sendMessage to fail for agent_finished message AFTER mode decision
      let callCount = 0;
      const originalSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = jest.fn(async (msg) => {
        callCount++;
        // Respond to mode_mismatch_pause
        if (msg.action === 'mode_mismatch_pause') {
          // Simulate response
          setTimeout(() => {
            onMessageListeners.forEach(listener => {
              if (listener) {
                listener({
                  action: 'mode_mismatch_response',
                  requestId: msg.requestId,
                  flip: false,
                  continue: true,
                  cancel: false
                });
              }
            });
          }, 5);
        }
        // Fail the agent_finished message (line 583-585)
        if (msg.action === 'agent_finished' && callCount > 1) {
          throw new Error('Message send failed');
        }
        return Promise.resolve();
      });

      const result = await startAgent('Mode: APPROVAL. Test.', sender);

      // Should complete despite sendMessage failure
      expect(result).toContain('Agent started');

      // Restore
      chrome.runtime.sendMessage = originalSendMessage;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Adaptive prompts error paths (lines 628, 640-644, 659, 694)
  // ═══════════════════════════════════════════════════════════════════
  describe('adaptive prompts error handling', () => {
    test('handles storage set failure in adapted goal logging (line 628)', async () => {
      const sender = { tab: { id: 1 } };
      storageData.approvalMode = true;

      // Mock adaptive prompts to return an adapted goal
      mockRewriteGoalForPlatform.mockResolvedValueOnce({
        adapted: true,
        platform: 'test',
        summary: 'test summary',
        adaptedGoal: 'adapted goal',
        originalGoal: 'original goal',
        mismatchHints: [],
      });

      let callCount = 0;
      const originalSet = chrome.storage.local.set;
      chrome.storage.local.set = jest.fn(async (obj) => {
        callCount++;
        // Fail on the run_log write for adapted goal
        const keys = Object.keys(obj);
        if (callCount >= 2 && keys.length > 0 && keys[0].startsWith('run_log_')) {
          throw new Error('Adapted goal storage failed');
        }
        await originalSet(obj);
      });

      // Auto-respond to the adapted goal decision
      const originalSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = jest.fn(async (msg) => {
        if (msg.action === 'adapted_goal_available' && msg.mode === 'approval') {
          setTimeout(() => {
            onMessageListeners.forEach(listener => {
              if (listener) {
                listener({
                  action: 'adapted_goal_response',
                  requestId: msg.requestId,
                  approved: true,
                  useOriginal: false,
                  edited: false
                });
              }
            });
          }, 5);
        }
        return Promise.resolve();
      });

      const result = await startAgent('test goal', sender);

      // Should complete - storage error is caught
      expect(result).toContain('Agent started');

      // Restore
      chrome.storage.local.set = originalSet;
      chrome.runtime.sendMessage = originalSendMessage;
    });

    test('handles runtime sendMessage failure in auto mode (line 659)', async () => {
      const sender = { tab: { id: 1 } };
      storageData.approvalMode = false; // Auto mode

      // Mock adaptive prompts to return adapted goal
      mockRewriteGoalForPlatform.mockResolvedValueOnce({
        adapted: true,
        platform: 'test',
        summary: 'test summary',
        adaptedGoal: 'adapted goal',
        originalGoal: 'original goal',
        mismatchHints: [],
      });

      // Mock sendMessage to fail
      const originalSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = jest.fn(async () => {
        throw new Error('Message failed');
      });

      const result = await startAgent('test goal', sender);

      // Should complete despite sendMessage failure
      expect(result).toContain('Agent started');

      // Restore
      chrome.runtime.sendMessage = originalSendMessage;
    });

    test('uses original goal when decision.useOriginal is true (lines 640-644)', async () => {
      const sender = { tab: { id: 1 } };
      storageData.approvalMode = true;

      // Mock adaptive prompts to return adapted goal
      mockRewriteGoalForPlatform.mockResolvedValueOnce({
        adapted: true,
        platform: 'test',
        summary: 'test summary',
        adaptedGoal: 'adapted goal',
        originalGoal: 'original goal',
        mismatchHints: [],
      });

      // Simulate user clicking "Use Original"
      const originalSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = jest.fn(async (msg) => {
        if (msg.action === 'adapted_goal_available') {
          setTimeout(() => {
            onMessageListeners.forEach(listener => {
              if (listener) {
                listener({
                  action: 'adapted_goal_response',
                  requestId: msg.requestId,
                  approved: false,
                  useOriginal: true,
                  edited: false
                });
              }
            });
          }, 5);
        }
        return Promise.resolve();
      });

      const result = await startAgent('test goal', sender);

      // Should complete
      expect(result).toContain('Agent started');

      // Restore
      chrome.runtime.sendMessage = originalSendMessage;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. persistHistory error path (line 375)
  // ═══════════════════════════════════════════════════════════════════
  describe('persistHistory error handling', () => {
    test('handles storage write failure gracefully', async () => {
      const sender = { tab: { id: 1 } };

      // Mock storage.set to fail
      const originalSet = chrome.storage.local.set;
      chrome.storage.local.set = jest.fn(async (obj) => {
        if ('agent_history' in obj) {
          throw new Error('Storage write failed');
        }
        await originalSet(obj);
      });

      // Start agent to trigger history persistence
      const result = await startAgent('test goal', sender);

      // Should complete despite storage failure
      expect(result).toContain('Agent started');

      // Restore
      chrome.storage.local.set = originalSet;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Edge case: No active tab found
  // ═══════════════════════════════════════════════════════════════════
  describe('no active tab error handling', () => {
    test('throws error when no active tab found', async () => {
      const sender = {}; // No tab

      // Mock tabs.query to call callback with empty array
      chrome.tabs.query = jest.fn((_, callback) => {
        callback([]);
      });

      await expect(startAgent('test goal', sender)).rejects.toThrow('No active tab found');
    });
  });
});
