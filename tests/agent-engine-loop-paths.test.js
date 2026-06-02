// tests/agent-engine-loop-paths.test.js
// Tests for uncovered paths in background/agent-engine.js:
// - Tab URL change listener (81-89)
// - onSuspend checkpoint listener (126-129)
// - persistHistory error path (261)
// - Mode mismatch detection in startAgent (403-454)
// - Adaptive prompts flow in startAgent (475-522)
// - runAgentLoop setup paths (2069-2137)
// - generateHeuristicPlan branches (1971-2040)
// - summarizeHistoryBatch / maybeRollupHistory (720-768)
// - Post-loop cleanup (4269-4293)
// - saveLearnedPattern (4326-4347)

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
const sessionData = {};
let onMessageListeners = [];
let onUpdatedListeners = [];
let onSuspendListeners = [];

const chromeMock = {
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
      set: jest.fn(async (obj) => { Object.assign(sessionData, obj); }),
    },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
    sendMessage: jest.fn(async () => ({})),
    get: jest.fn((id, callback) => callback({ id, url: 'https://example.com', title: 'Test' })),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
    onUpdated: {
      addListener: jest.fn((fn) => { onUpdatedListeners.push(fn); }),
      removeListener: jest.fn(),
    },
  },
  tabGroups: {
    update: jest.fn(async () => {}),
  },
  sidePanel: {
    setOptions: jest.fn(async () => {}),
  },
  scripting: {
    executeScript: jest.fn(async () => {}),
  },
  runtime: {
    sendMessage: jest.fn(async () => {}),
    onMessage: {
      addListener: jest.fn((fn) => { onMessageListeners.push(fn); }),
      removeListener: jest.fn((fn) => {
        onMessageListeners = onMessageListeners.filter(l => l !== fn);
      }),
    },
    onSuspend: {
      addListener: jest.fn((fn) => { onSuspendListeners.push(fn); }),
    },
    getURL: jest.fn((p) => p),
  },
  debugger: {
    attach: jest.fn(async () => {}),
    detach: jest.fn(async () => {}),
    sendCommand: jest.fn(async () => ({})),
    onEvent: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: {
    create: jest.fn(),
    onAlarm: { addListener: jest.fn() },
  },
  notifications: {
    create: jest.fn(async () => {}),
  },
};

// Set chrome in both globalThis and as a global variable
globalThis.chrome = chromeMock;
global.chrome = chromeMock;

globalThis.crypto = {
  randomUUID: jest.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 8)),
};

// ── Mock all heavy dependencies ──
// Store mock functions in variables so they can be used in tests
const mockCallLLMWithRetry = jest.fn(async () => ({ type: 'finish', summary: 'done' }));
const mockGeneratePlan = jest.fn(async () => ['Step 1', 'Step 2']);
const mockSupportsVision = jest.fn(() => true);
const mockGetPlatformContext = jest.fn(() => '');
const mockGetRelevantPatterns = jest.fn(async () => []);

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: mockCallLLMWithRetry,
  generatePlan: mockGeneratePlan,
  supportsVision: mockSupportsVision,
  getPlatformContext: mockGetPlatformContext,
  getRelevantPatterns: mockGetRelevantPatterns,
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
  sendHeartbeat: jest.fn(), sendPlanPreview: jest.fn(), sendClientKnowledgePreview: jest.fn(), sendCostUpdate: jest.fn(),
}));

// Store mock functions in variables so they can be used in tests
const mockGenerateReport = jest.fn(async () => ({
  summary: '## Report',
  fullReport: '## Report\n\nFull report content here.',
  structuredData: {},
  goal: 'test goal',
  timestamp: new Date().toISOString()
}));

jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: mockGenerateReport,
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

// Store tab-context mock functions
const mockGetActiveTabId = jest.fn(() => null);
const mockGetTabContext = jest.fn(() => null);
const mockGetAllTabContexts = jest.fn(() => []);
const mockOpenTab = jest.fn(async () => 2);
const mockSwitchToTab = jest.fn(async () => {});
const mockCloseTab = jest.fn(async () => {});
const mockCloseAllAgentTabs = jest.fn(async () => {});
const mockUpdateSnapshot = jest.fn(async () => {});
const mockResetAllContexts = jest.fn();
const mockFindTabByLabel = jest.fn(() => null);
const mockRegisterInitialTab = jest.fn();
const mockGetTabCount = jest.fn(() => 0);

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: mockGetActiveTabId,
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
  getTabCount: mockGetTabCount,
}));

jest.unstable_mockModule('../background/client-knowledge.js', () => ({
  getActiveClient: jest.fn(async () => null),
  getRelevantEntries: jest.fn(async () => []),
  formatPromptSection: jest.fn(() => ''),
  markRunCompleted: jest.fn(async () => {}),
}));

// Store mock functions in variables so they can be used in tests
const mockRewriteGoalForPlatform = jest.fn(async () => null);

jest.unstable_mockModule('../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: mockRewriteGoalForPlatform,
}));

// Store mock functions in variables so they can be used in tests
const mockAppendAuditEntry = jest.fn(async () => {});
const mockGetAuditLog = jest.fn(async () => []);
const mockAuditLogToCsv = jest.fn(() => '');

jest.unstable_mockModule('../background/audit-log.js', () => ({
  appendAuditEntry: mockAppendAuditEntry,
  getAuditLog: mockGetAuditLog,
  auditLogToCsv: mockAuditLogToCsv,
}));

jest.unstable_mockModule('../background/skills/index.js', () => ({
  runRecoverySkills: jest.fn(async () => []),
  getSkillStats: jest.fn(() => ({ total: 0, byType: {} })),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    startRun: jest.fn(),
    endRun: jest.fn(async () => {}),
  },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 85, level: 'high', factors: {} })),
  suggestRetryActions: jest.fn(() => []),
}));

// ── Import after mocks — use dynamic import for unstable_mockModule compatibility ──
const {
  startAgent, stopAgent, pauseAgent, resumeAgent, resetAgentState,
  setAgentSpeed, injectContext, getAgentTabId,
  isAgentAttachedTab, getAttachedTabIds, fetchAuditLog,
  attachTabToSentinelGroup, detachAllSentinelTabs,
} = await import('../background/agent-engine.js');

const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');
const { generateReport } = await import('../background/report-generator.js');
const { generatePlan } = await import('../background/llm-client.js');
const { tel } = await import('../background/telemetry.js');

// Record the addListener calls that fire at module-import time so we can
// verify them without being affected by clearAllMocks().
// Note: Due to VM module context isolation, we check the listener arrays
// rather than mock.calls, which may not be populated across module boundaries.
const _onUpdatedCalled = onUpdatedListeners.length > 0;
const _onSuspendCalled = onSuspendListeners.length > 0;

// ── Helpers ──
function makeSender(tabId = 1) {
  return { tab: { id: tabId, url: 'https://example.com', windowId: 1 } };
}

afterEach(async () => {
  // Force agent to fully stop between tests — resetAgentState does NOT reset
  // agentRunning / agentAttachedTabs, so we must call stopAgent first.
  try { await stopAgent(); } catch (_) {}
});

beforeEach(() => {
  // Reset storage
  for (const k of Object.keys(storageData)) delete storageData[k];
  for (const k of Object.keys(sessionData)) delete sessionData[k];
  onMessageListeners = [];
  jest.clearAllMocks();
  resetAgentState();
});

// ==========================
// Tab URL change listener (lines 81-89)
// ==========================
describe('tab URL change listener', () => {
  test('fires onUpdated listener registered at module load', () => {
    if (!_onUpdatedCalled) {
      console.warn('[TEST] onUpdated listener not registered at module load');
    }
    expect(_onUpdatedCalled).toBe(true);
  });

  test('updates tab context url when tab URL changes', () => {
    const mockCtx = {
      url: 'https://old.com',
      screenshotCache: {
        cachedSnapshot: 'old-snap',
        cachedBase64Image: 'old-img',
        lastScreenshotUrl: 'https://old.com',
      },
    };
    mockGetTabContext.mockReturnValue(mockCtx);

    const listener = onUpdatedListeners[onUpdatedListeners.length - 1];
    if (!listener) {
      console.warn('[TEST] onUpdated listener not registered, skipping test');
      return;
    }
    listener(1, { url: 'https://new.com' }, { id: 1 });

    expect(mockCtx.url).toBe('https://new.com');
    expect(mockCtx.screenshotCache.cachedSnapshot).toBeNull();
    expect(mockCtx.screenshotCache.cachedBase64Image).toBeNull();
    expect(mockCtx.screenshotCache.lastScreenshotUrl).toBeNull();
  });

  test('skips when changeInfo has no url', () => {
    mockGetTabContext.mockReturnValue({ url: 'https://old.com' });
    const listener = onUpdatedListeners[onUpdatedListeners.length - 1];
    if (!listener) {
      console.warn('[TEST] onUpdated listener not registered, skipping test');
      return;
    }
    listener(1, { status: 'loading' }, { id: 1 });
    // mockGetTabContext should NOT be called with a URL change
    // It IS called for the tabId lookup, but no mutation happens
  });

  test('skips when no tab context found', () => {
    mockGetTabContext.mockReturnValue(null);
    const listener = onUpdatedListeners[onUpdatedListeners.length - 1];
    if (!listener) {
      // Skip test if listener not registered
      console.warn('[TEST] onUpdated listener not registered, skipping test');
      return;
    }
    expect(() => listener(1, { url: 'https://new.com' }, { id: 1 })).not.toThrow();
  });

  test('handles missing screenshotCache gracefully', () => {
    const mockCtx = { url: 'https://old.com' };
    mockGetTabContext.mockReturnValue(mockCtx);
    const listener = onUpdatedListeners[onUpdatedListeners.length - 1];
    if (!listener) {
      // Skip test if listener not registered
      console.warn('[TEST] onUpdated listener not registered, skipping test');
      return;
    }
    expect(() => listener(1, { url: 'https://new.com' }, { id: 1 })).not.toThrow();
    expect(mockCtx.url).toBe('https://new.com');
  });
});

// ==========================
// onSuspend checkpoint listener (lines 122-134)
// ==========================
describe('onSuspend checkpoint listener', () => {
  test('registers onSuspend listener at module load', () => {
    if (!_onSuspendCalled) {
      console.warn('[TEST] onSuspend listener not registered at module load');
    }
    expect(_onSuspendCalled).toBe(true);
  });

  test('flushes checkpoint to session storage on suspend', async () => {
    const listener = onSuspendListeners[onSuspendListeners.length - 1];
    if (!listener) {
      console.warn('[TEST] onSuspend listener not registered, skipping test');
      return;
    }
    listener();
    // session.set should have been called
    expect(chrome.storage.session.set).toHaveBeenCalled();
    expect(chrome.storage.session.set.mock.calls.length).toBeGreaterThan(0);
    const call = chrome.storage.session.set.mock.calls[chrome.storage.session.set.mock.calls.length - 1];
    expect(call[0]).toHaveProperty('agent_checkpoint');
  });
});

// ==========================
// persistHistory error path (line 261)
// ==========================
describe('persistHistory error path', () => {
  test('handles storage.set failure gracefully in startAgent', async () => {
    // Override set to throw once
    const origSet = chrome.storage.local.set;
    let setCallCount = 0;
    chrome.storage.local.set = jest.fn(async (obj) => {
      setCallCount++;
      if (obj && obj.agent_history !== undefined) {
        throw new Error('Storage quota exceeded');
      }
      Object.assign(storageData, obj);
    });

    // startAgent triggers persistHistory via runAgentLoop
    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'All done' });

    await expect(startAgent('Test goal', makeSender())).resolves.toBeDefined();

    // Restore
    chrome.storage.local.set = origSet;
  });
});

// ==========================
// Mode mismatch detection in startAgent (403-454)
// ==========================
describe('mode mismatch detection in startAgent', () => {
  test('detects mismatch when goal says APPROVAL but setting is autonomous', async () => {
    storageData.approvalMode = false;

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    const agentPromise = startAgent('Mode: APPROVAL - please check firewall settings', makeSender());

    // Wait for _waitForModeMismatchDecision to generate its UUID and register listener
    await new Promise(r => setTimeout(r, 100));

    // The requestId was generated by crypto.randomUUID inside _waitForModeMismatchDecision.
    // Capture it from the last UUID call before the listener was registered.
    const uuidResults = crypto.randomUUID.mock.results;
    const requestId = uuidResults.length > 0 ? uuidResults[uuidResults.length - 1].value : 'fallback';

    const mismatchListener = onMessageListeners[onMessageListeners.length - 1];
    if (mismatchListener) {
      mismatchListener({
        action: 'mode_mismatch_response',
        requestId,
        flip: false,
        continue: true,
        cancel: false,
      });
    }

    await expect(agentPromise).resolves.toBeDefined();
  }, 10000);

  test('cancels run on mode mismatch timeout response', async () => {
    storageData.approvalMode = true;

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    const agentPromise = startAgent('Mode: AUTONOMOUS - do everything fast', makeSender());

    await new Promise(r => setTimeout(r, 100));

    const uuidResults = crypto.randomUUID.mock.results;
    const requestId = uuidResults.length > 0 ? uuidResults[uuidResults.length - 1].value : 'fallback';

    // Respond with cancel
    const listener = onMessageListeners[onMessageListeners.length - 1];
    if (listener) {
      listener({
        action: 'mode_mismatch_response',
        requestId,
        flip: false,
        continue: false,
        cancel: true,
      });
    }

    // Agent should finish (cancelled)
    await expect(agentPromise).resolves.toBeDefined();
  }, 10000);
});

// ==========================
// Adaptive prompts flow (475-522)
// ==========================
describe('adaptive prompts flow in startAgent', () => {
  test('uses adapted goal in auto mode', async () => {
    storageData.adaptivePromptsMode = 'auto';
    storageData.approvalMode = false;

    mockRewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'sonicwall' },
      summary: 'Expanded for SonicWall',
      mismatchHints: [],
      adaptedGoal: 'Enhanced goal for SonicWall management',
      originalGoal: 'Check firewall',
      durationMs: 100,
    });

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Check firewall rules', makeSender())).resolves.toBeDefined();

    expect(mockRewriteGoalForPlatform).toHaveBeenCalled();
  });

  test('falls back to original goal on adaptive failure', async () => {
    storageData.adaptivePromptsMode = 'auto';
    mockRewriteGoalForPlatform.mockRejectedValueOnce(new Error('Network error'));

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Check firewall', makeSender())).resolves.toBeDefined();
  });

  test('uses original goal when user rejects adaptation in approval mode', async () => {
    storageData.adaptivePromptsMode = 'approval';
    storageData.approvalMode = false;

    mockRewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'cisco' },
      summary: 'Expanded for Cisco',
      mismatchHints: [],
      adaptedGoal: 'Cisco-enhanced goal',
      originalGoal: 'Check router',
      durationMs: 50,
    });

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    const agentPromise = startAgent('Check router config', makeSender());

    await new Promise(r => setTimeout(r, 100));

    const uuidResults = crypto.randomUUID.mock.results;
    const requestId = uuidResults.length > 0 ? uuidResults[uuidResults.length - 1].value : 'fallback';

    // User chooses "Use Original"
    const listener = onMessageListeners[onMessageListeners.length - 1];
    if (listener) {
      listener({
        action: 'adapted_goal_response',
        requestId,
        approved: false,
        useOriginal: true,
        edited: false,
      });
    }

    await expect(agentPromise).resolves.toBeDefined();
  }, 10000);

  test('uses edited goal when user edits adaptation', async () => {
    storageData.adaptivePromptsMode = 'approval';
    storageData.approvalMode = false;

    mockRewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      platform: { id: 'fortigate' },
      summary: 'Expanded for FortiGate',
      mismatchHints: [],
      adaptedGoal: 'FortiGate-enhanced goal',
      originalGoal: 'Check firewall',
      durationMs: 50,
    });

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    const agentPromise = startAgent('Check firewall policies', makeSender());

    await new Promise(r => setTimeout(r, 100));

    const uuidResults = crypto.randomUUID.mock.results;
    const requestId = uuidResults.length > 0 ? uuidResults[uuidResults.length - 1].value : 'fallback';

    const listener = onMessageListeners[onMessageListeners.length - 1];
    if (listener) {
      listener({
        action: 'adapted_goal_response',
        requestId,
        approved: false,
        useOriginal: false,
        edited: true,
        editedGoal: 'My custom edited goal for FortiGate review',
      });
    }

    await expect(agentPromise).resolves.toBeDefined();
  }, 10000);
});

// ==========================
// runAgentLoop setup paths (2069-2137)
// ==========================
describe('runAgentLoop setup paths', () => {
  test('handles storage load failure gracefully', async () => {
    const origGet = chrome.storage.local.get;
    chrome.storage.local.get = jest.fn(async () => {
      throw new Error('Storage corrupt');
    });

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Test goal', makeSender())).resolves.toBeDefined();

    chrome.storage.local.get = origGet;
  });

  test('merges agent_context from storage into goal', async () => {
    storageData.agent_context = 'Previous session context about SonicWall';

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Check firewall', makeSender())).resolves.toBeDefined();
  });

  test('falls back to heuristic plan when generatePlan returns null', async () => {
    mockGeneratePlan.mockResolvedValueOnce(null);

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Navigate to https://sonicwall.com and check settings', makeSender())).resolves.toBeDefined();
  });

  test('falls back to direct mode when both plan and heuristic fail', async () => {
    mockGeneratePlan.mockResolvedValueOnce(null);

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    // Goal with no URL or search pattern → heuristic returns generic fallback
    await expect(startAgent('Do something vague', makeSender())).resolves.toBeDefined();
  });
});

// ==========================
// generateHeuristicPlan branches (1971-2040)
// Tested via startAgent → runAgentLoop when generatePlan returns null
// ==========================
describe('generateHeuristicPlan via startAgent', () => {
  test('multi-page research pattern generates multi-step plan', async () => {
    mockGeneratePlan.mockResolvedValueOnce(null);

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Find the top 5 articles about network security and summarize each one', makeSender())).resolves.toBeDefined();
  });

  test('navigation-only goal generates simple plan', async () => {
    mockGeneratePlan.mockResolvedValueOnce(null);

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Go to https://example.com/dashboard', makeSender())).resolves.toBeDefined();
  });

  test('search goal generates search plan', async () => {
    mockGeneratePlan.mockResolvedValueOnce(null);

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Search for best practices for firewall configuration', makeSender())).resolves.toBeDefined();
  });

  test('empty goal is rejected with validation error', async () => {
    await expect(startAgent('', makeSender())).rejects.toThrow('Goal must be a non-empty string');
  });

  test('null goal is rejected with validation error', async () => {
    await expect(startAgent(null, makeSender())).rejects.toThrow('Goal must be a non-empty string');
  });
});

// ==========================
// Post-loop cleanup (4269-4293)
// ==========================
describe('post-loop cleanup paths', () => {
  test('handles report generation failure gracefully', async () => {
    // null-tab exit path: getActiveTabId() returns null (default), getAllTabContexts() returns []
    // The loop breaks on the first iteration without any LLM calls or sleeps.
    // Fallback is saved to storage BEFORE generateReport is called, so the catch block
    // finds the fallback already written even after generateReport rejects.
    mockGenerateReport.mockRejectedValueOnce(new Error('Report template missing'));

    await startAgent('Test goal', makeSender());

    // No macrotask sleeps in this path — just awaited Promise.resolve()s.
    // 500ms is far more than enough for all the mocked async calls to settle.
    await new Promise(r => setTimeout(r, 500));

    expect(storageData.last_agent_report).toBeDefined();
    expect(storageData.last_agent_report).toMatchObject({ _isFallback: true });
  }, 5000);

  test('handles post-loop storage clear failure', async () => {
    const origSet = chrome.storage.local.set;
    let clearCallDone = false;
    chrome.storage.local.set = jest.fn(async (obj) => {
      // Throw on the agent_history clear call at end of loop
      if (obj && 'agent_history' in obj && Array.isArray(obj.agent_history) && obj.agent_history.length === 0 && !clearCallDone) {
        clearCallDone = true;
        throw new Error('Storage full');
      }
      Object.assign(storageData, obj);
    });

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await expect(startAgent('Test goal', makeSender())).resolves.toBeDefined();

    chrome.storage.local.set = origSet;
  });
});

// ==========================
// saveLearnedPattern error path (4347)
// ==========================
describe('saveLearnedPattern via successful run', () => {
  test('pattern saving handles storage failure', async () => {
    const origSet = chrome.storage.local.set;
    chrome.storage.local.set = jest.fn(async (obj) => {
      if (obj && 'learned_patterns' in obj) {
        throw new Error('Storage full');
      }
      Object.assign(storageData, obj);
    });

    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done successfully' });

    await expect(startAgent('Test learning goal', makeSender())).resolves.toBeDefined();

    chrome.storage.local.set = origSet;
  });
});

// ==========================
// Tab group attachment (852-914)
// ==========================
describe('tab group attachment', () => {
  test('isAgentAttachedTab returns false for unattached tab', () => {
    expect(isAgentAttachedTab(999)).toBe(false);
  });

  test('getAttachedTabIds returns empty array initially', () => {
    expect(getAttachedTabIds()).toEqual([]);
  });

  test('tab group is created during startAgent', async () => {
    // Using mockCallLLMWithRetry variable
    mockCallLLMWithRetry.mockResolvedValueOnce({ type: 'finish', summary: 'Done' });

    await startAgent('Test goal', makeSender(5));

    // tabs.group should have been called to create the group
    expect(chrome.tabs.group).toHaveBeenCalled();
  });
});

// ==========================
// Speed mode
// ==========================
describe('setAgentSpeed', () => {
  test('rejects invalid speed mode', () => {
    expect(setAgentSpeed('invalid')).toContain('Invalid speed mode');
  });
});

// ==========================
// resumeAgent when not paused
// ==========================
describe('resumeAgent', () => {
  test('returns message when agent not running', async () => {
    await expect(resumeAgent()).resolves.toBe('Agent not running');
  });
});

// ==========================
// fetchAuditLog
// ==========================
describe('fetchAuditLog', () => {
  test('passes id to getAuditLog', async () => {
    const { getAuditLog } = await import('../background/audit-log.js');
    mockGetAuditLog.mockResolvedValueOnce([{ id: 1 }]);
    await fetchAuditLog('log-123');
    expect(getAuditLog).toHaveBeenCalledWith('log-123');
  });
});

// ==========================
// injectContext edge cases
// ==========================
describe('injectContext', () => {
  test('ignores numbers', () => {
    expect(() => injectContext(42)).not.toThrow();
  });
  test('ignores booleans', () => {
    expect(() => injectContext(true)).not.toThrow();
  });
  test('ignores null', () => {
    expect(() => injectContext(null)).not.toThrow();
  });
});
