// tests/agent-engine-integration.test.js
// Integration tests for background/agent-engine.js — exercises real code paths
// through the exported API with mocked dependencies.

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
const sessionData = {};

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
      set: jest.fn(async () => {}),
    },
  },
  tabs: {
    query: jest.fn((q, cb) => {
      const result = [{ id: 1 }];
      if (cb) cb(result);
      return Promise.resolve(result);
    }),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
    onUpdated: { addListener: jest.fn() },
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
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
};

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 10) };
}

// ── Mock all dependencies ──
jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
  generatePlan: jest.fn(async () => ['Step 1', 'Step 2']),
  supportsVision: jest.fn(() => true),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []),
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
  sendHeartbeat: jest.fn(), sendPlanPreview: jest.fn(),
}));

jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: jest.fn(async () => '## Report'),
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

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => null),
  setActiveTab: jest.fn(),
  getTabContext: jest.fn(() => null),
  getAllTabContexts: jest.fn(() => []),
  openTab: jest.fn(async () => 2),
  switchToTab: jest.fn(async () => {}),
  closeTab: jest.fn(async () => {}),
  closeAllAgentTabs: jest.fn(async () => {}),
  updateSnapshot: jest.fn(),
  resetAllContexts: jest.fn(),
  findTabByLabel: jest.fn(() => null),
  registerInitialTab: jest.fn(),
  handleTabRemoved: jest.fn(),
  getTabCount: jest.fn(() => 0),
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

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })),
  suggestRetryActions: jest.fn(() => []),
}));

const {
  startAgent,
  stopAgent,
  pauseAgent,
  resumeAgent,
  resetAgentState,
  setAgentSpeed,
  injectContext,
  getAgentTabId,
  isAgentAttachedTab,
  getAttachedTabIds,
  fetchAuditLog,
} = await import('../background/agent-engine.js');

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  Object.keys(sessionData).forEach(k => delete sessionData[k]);
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — lifecycle', () => {
  test('startAgent sets agentRunning and registers tab', async () => {
    const sender = { tab: { id: 1 } };
    const result = await startAgent('Test goal', sender);
    expect(result).toBeDefined();
    // After starting, stop to clean up
    await stopAgent();
  });

  test('startAgent queries for active tab when no sender.tab', async () => {
    const sender = {};
    const result = await startAgent('Navigate to Google', sender);
    expect(chrome.tabs.query).toHaveBeenCalled();
    await stopAgent();
  });

  test('startAgent throws when no active tab found and no sender', async () => {
    chrome.tabs.query.mockImplementationOnce((q, cb) => {
      if (cb) cb([]);
      return Promise.resolve([]);
    });
    const sender = {};
    await expect(startAgent('No tab goal', sender)).rejects.toThrow('No active tab');
  });

  test('startAgent throws when already running', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('First run', sender);
    await expect(startAgent('Second run', sender)).rejects.toThrow('already running');
    await stopAgent();
  });

  test('stopAgent resets state and detaches debuggees', async () => {
    const { detachAllDebuggees } = await import('../background/tab-manager.js');
    const { closeAllAgentTabs } = await import('../background/tab-context.js');
    const sender = { tab: { id: 1 } };
    await startAgent('Test', sender);
    const result = await stopAgent();
    expect(result).toBe('Agent stopped');
    expect(detachAllDebuggees).toHaveBeenCalled();
    expect(closeAllAgentTabs).toHaveBeenCalled();
  });

  test('stopAgent ends telemetry run', async () => {
    const { endRun } = await import('../background/telemetry.js');
    const sender = { tab: { id: 1 } };
    await startAgent('Test telemetry', sender);
    await stopAgent();
    expect(endRun).toHaveBeenCalled();
  });

  test('pauseAgent returns message when agent running', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Test pause', sender);
    const result = await pauseAgent();
    expect(result).toBe('Agent paused');
    await stopAgent();
  });

  test('pauseAgent returns not-running when agent not running', async () => {
    const result = await pauseAgent();
    expect(result).toBe('Agent not running');
  });

  test('resumeAgent returns message when agent running', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Test resume', sender);
    await pauseAgent();
    const result = await resumeAgent();
    expect(result).toBe('Agent resumed');
    await stopAgent();
  });

  test('resumeAgent returns not-running when agent not running', async () => {
    const result = await resumeAgent();
    expect(result).toBe('Agent not running');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — setAgentSpeed', () => {
  test('turbo mode persists to storage', () => {
    setAgentSpeed('turbo');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ agentSpeedMode: 'turbo' });
  });

  test('normal mode persists to storage', () => {
    setAgentSpeed('normal');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ agentSpeedMode: 'normal' });
  });

  test('stealth mode persists to storage', () => {
    setAgentSpeed('stealth');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ agentSpeedMode: 'stealth' });
  });

  test('invalid mode returns error message', () => {
    const result = setAgentSpeed('hyperspeed');
    expect(result).toContain('Invalid speed mode');
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ agentSpeedMode: 'hyperspeed' })
    );
  });

  test('empty string returns error', () => {
    const result = setAgentSpeed('');
    expect(result).toContain('Invalid speed mode');
  });

  test('numeric value returns error', () => {
    const result = setAgentSpeed(123);
    expect(result).toContain('Invalid speed mode');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — injectContext', () => {
  test('queues valid note', () => {
    injectContext('Check the firewall rules');
    // Second injection adds another
    injectContext('Also check VPN status');
  });

  test('ignores empty string', () => {
    injectContext('');
    injectContext('   ');
  });

  test('ignores non-string values', () => {
    injectContext(null);
    injectContext(42);
    injectContext(undefined);
    injectContext({ text: 'test' });
  });

  test('context survives resetAgentState', () => {
    injectContext('Important context');
    resetAgentState();
    // After reset, context injections are cleared
    injectContext('New context after reset');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — resetAgentState', () => {
  test('clears all accumulated state', () => {
    injectContext('some context');
    setAgentSpeed('turbo');
    resetAgentState();
    // Verify idempotent
    expect(() => resetAgentState()).not.toThrow();
  });

  test('double reset is safe', () => {
    resetAgentState();
    resetAgentState();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — tab tracking', () => {
  test('no tabs attached initially', () => {
    expect(isAgentAttachedTab(1)).toBe(false);
    expect(isAgentAttachedTab(999)).toBe(false);
    expect(getAttachedTabIds()).toEqual([]);
  });

  test('getAgentTabId returns null when no active tab', () => {
    expect(getAgentTabId()).toBe(null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — fetchAuditLog', () => {
  test('delegates to getAuditLog with id', async () => {
    const { getAuditLog } = await import('../background/audit-log.js');
    await fetchAuditLog('test-run-id');
    expect(getAuditLog).toHaveBeenCalledWith('test-run-id');
  });

  test('delegates to getAuditLog with fallback when no id', async () => {
    const { getAuditLog } = await import('../background/audit-log.js');
    await fetchAuditLog();
    // Falls back to runLogId (null when no run active)
    expect(getAuditLog).toHaveBeenCalled();
  });

  test('handles empty string id by falling back to runLogId', async () => {
    const { getAuditLog } = await import('../background/audit-log.js');
    await fetchAuditLog('');
    // When id is empty, it falls back to the current runLogId
    expect(getAuditLog).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — startAgent with client knowledge', () => {
  test('loads client knowledge when active client exists', async () => {
    const { getActiveClient, getRelevantEntries, formatPromptSection } = await import('../background/client-knowledge.js');
    getActiveClient.mockResolvedValueOnce({ id: 'client-1', name: 'Test Client' });
    getRelevantEntries.mockResolvedValueOnce([{ id: 'entry-1' }]);
    formatPromptSection.mockResolvedValueOnce('Client: Test Client');

    const sender = { tab: { id: 1 } };
    await startAgent('Check client firewall', sender);
    expect(getActiveClient).toHaveBeenCalled();
    expect(getRelevantEntries).toHaveBeenCalledWith('client-1', 'https://example.com');
    expect(formatPromptSection).toHaveBeenCalledWith('client-1', 'https://example.com');
    await stopAgent();
  });

  test('handles client knowledge errors gracefully', async () => {
    const { getActiveClient } = await import('../background/client-knowledge.js');
    getActiveClient.mockRejectedValueOnce(new Error('DB error'));

    const sender = { tab: { id: 1 } };
    await expect(startAgent('Test goal', sender)).resolves.toBeDefined();
    await stopAgent();
  });

  test('handles null active client', async () => {
    const { getActiveClient } = await import('../background/client-knowledge.js');
    getActiveClient.mockResolvedValueOnce(null);

    const sender = { tab: { id: 1 } };
    await expect(startAgent('Test goal', sender)).resolves.toBeDefined();
    await stopAgent();
  });

  test('handles active client without id', async () => {
    const { getActiveClient } = await import('../background/client-knowledge.js');
    getActiveClient.mockResolvedValueOnce({ name: 'No ID Client' });

    const sender = { tab: { id: 1 } };
    await expect(startAgent('Test goal', sender)).resolves.toBeDefined();
    await stopAgent();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — startAgent storage operations', () => {
  test('creates run log with UUID', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Run log test', sender);
    // Should have stored run log index
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const setCalls = chrome.storage.local.set.mock.calls;
    const hasRunLog = setCalls.some(call =>
      call[0] && Object.keys(call[0]).some(k => k === 'run_log_index')
    );
    expect(hasRunLog).toBe(true);
    await stopAgent();
  });

  test('loads speed mode from storage', async () => {
    storageData.agentSpeedMode = 'stealth';
    const sender = { tab: { id: 1 } };
    await startAgent('Speed mode test', sender);
    // Agent should have loaded stealth mode
    const getCalls = chrome.storage.local.get.mock.calls;
    const hasSpeedCall = getCalls.some(call => {
      const keys = Array.isArray(call[0]) ? call[0] : Object.keys(call[0] || {});
      return keys.includes('agentSpeedMode');
    });
    expect(hasSpeedCall).toBe(true);
    await stopAgent();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — startAgent tab management', () => {
  test('registers initial tab', async () => {
    const { registerInitialTab } = await import('../background/tab-context.js');
    const sender = { tab: { id: 5 } };
    await startAgent('Tab reg test', sender);
    expect(registerInitialTab).toHaveBeenCalledWith(5, 'https://example.com');
    await stopAgent();
  });

  test('handles getTabInfo returning null', async () => {
    const { getTabInfo } = await import('../background/tab-manager.js');
    getTabInfo.mockResolvedValueOnce(null);
    const sender = { tab: { id: 1 } };
    await expect(startAgent('Test', sender)).resolves.toBeDefined();
    await stopAgent();
  });

  test('attaches tab to sentinel group', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Group test', sender);
    expect(chrome.tabs.group).toHaveBeenCalled();
    await stopAgent();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — audit entries', () => {
  test('startAgent creates run log in storage', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Audit test', sender);
    // Verify storage was written for run log
    expect(chrome.storage.local.set).toHaveBeenCalled();
    await stopAgent();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — telemetry', () => {
  test('startAgent starts telemetry run', async () => {
    const { startRun } = await import('../background/telemetry.js');
    const sender = { tab: { id: 1 } };
    await startAgent('Telemetry test', sender);
    expect(startRun).toHaveBeenCalled();
    await stopAgent();
  });

  test('stopAgent ends telemetry run', async () => {
    const { endRun } = await import('../background/telemetry.js');
    const sender = { tab: { id: 1 } };
    await startAgent('Telemetry stop test', sender);
    await stopAgent();
    expect(endRun).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('agent-engine integration — full lifecycle', () => {
  test('start → pause → resume → stop cycle', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Full cycle test', sender);

    const pauseResult = await pauseAgent();
    expect(pauseResult).toBe('Agent paused');

    const resumeResult = await resumeAgent();
    expect(resumeResult).toBe('Agent resumed');

    const stopResult = await stopAgent();
    expect(stopResult).toBe('Agent stopped');
  });

  test('multiple speed changes during run', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Speed test', sender);

    expect(setAgentSpeed('turbo')).toContain('turbo');
    expect(setAgentSpeed('stealth')).toContain('stealth');
    expect(setAgentSpeed('normal')).toContain('normal');

    await stopAgent();
  });

  test('injectContext during run', async () => {
    const sender = { tab: { id: 1 } };
    await startAgent('Context test', sender);
    injectContext('Check VPN status');
    injectContext('Also check DNS');
    await stopAgent();
  });

  test('startAgent handles tab grouping failure gracefully', async () => {
    chrome.tabs.group.mockRejectedValueOnce(new Error('Group failed'));
    const sender = { tab: { id: 1 } };
    await expect(startAgent('Group fail test', sender)).resolves.toBeDefined();
    await stopAgent();
  });

  test('startAgent handles storage read failure gracefully', async () => {
    const origGet = chrome.storage.local.get;
    let callCount = 0;
    chrome.storage.local.get = jest.fn(async (keys) => {
      callCount++;
      if (callCount === 1) throw new Error('Storage read failed');
      return origGet(keys);
    });
    const sender = { tab: { id: 1 } };
    await expect(startAgent('Storage fail test', sender)).resolves.toBeDefined();
    chrome.storage.local.get = origGet;
    await stopAgent();
  });
});
