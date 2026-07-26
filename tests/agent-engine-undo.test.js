// tests/agent-engine-undo.test.js
// Edge case tests for the undoLastAction function in background/agent-engine.js
// NOTE: Full undo testing requires integration tests that run the agent loop
// to populate the undoStack. These tests cover the directly testable paths.

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
    query: jest.fn(async () => [{ id: 1 }]),
    goBack: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    sendMessage: jest.fn(async () => {}),
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

// ── Mock dependencies ──
jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
  parseVisionResponse: jest.fn((raw) => { try { return JSON.parse(raw); } catch { return null; } }),
  generatePlan: jest.fn(async () => ['Step 1', 'Step 2']),
  supportsVision: jest.fn(() => true),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []),
  estimateCostUsd: jest.fn(() => 0),
  isSimpleStep: jest.fn(() => false),
  selectModelForStep: jest.fn(() => null),
  getCostTracker: jest.fn(() => ({ totalCalls: 0, byTier: { light: 0, default: 0, heavy: 0 }, estimatedCost: '0.0000' }))
}));

jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: jest.fn(() => null),
}));

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}),
  waitForPageReady: jest.fn(async () => {}),
  injectContentScript: jest.fn(async () => {}),
  sendMessageWithRetry: jest.fn(async () => 'JS Result: ok'),
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
  sendPlanPreview: jest.fn(),
  sendClientKnowledgePreview: jest.fn(),
  sendCostUpdate: jest.fn(),
}));

jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: jest.fn(async () => '## Report'),
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => ({ endpoint: 'https://api.test.com', apiKey: 'key', model: 'test' })),
  getTextProvider: jest.fn(async () => null),
  migrateLegacySettings: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/shared-state.js', () => ({
  onAgentCompletion: jest.fn(() => () => {}),
  emitAgentCompletion: jest.fn(),
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
  getClientStartupContext: jest.fn(async () => ({ client: null, relevantEntries: [], promptSection: '' })),
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

// Import the module under test
import * as agentEngine from '../background/agent-engine.js';

const {
  undoLastAction,
  resetAgentState,
} = agentEngine;

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  jest.clearAllMocks();
  resetAgentState();
});

// ──────────────────────────────────────────────────────────────────────
describe('undoLastAction', () => {
  test('returns error when undo stack is empty', async () => {
    const result = await undoLastAction();
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Nothing to undo');
    // No Chrome APIs should be called when stack is empty
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.goBack).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  test('handles empty stack gracefully after reset', async () => {
    resetAgentState();
    const result = await undoLastAction();
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Nothing to undo');
  });

  test('handles navigate undo with previousUrl', async () => {
    // Manually populate undoStack with a navigate entry
    const { pushUndoStack } = agentEngine;
    pushUndoStack({ type: 'navigate', tabId: 1, previousUrl: 'https://example.com/previous' });

    const result = await undoLastAction();
    expect(result.success).toBe(true);
    expect(result.description).toContain('Navigated back to');
    expect(result.description).toContain('https://example.com/previous');
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'https://example.com/previous' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'undo_stack_updated', size: 0 });
  });

  test('handles navigate undo without previousUrl (goBack)', async () => {
    const { pushUndoStack } = agentEngine;
    pushUndoStack({ type: 'navigate', tabId: 1, previousUrl: null });

    const result = await undoLastAction();
    expect(result.success).toBe(true);
    expect(result.description).toContain('Navigated back');
    expect(chrome.tabs.goBack).toHaveBeenCalledWith(1);
  });

  test('handles type undo with selector', async () => {
    const { pushUndoStack } = agentEngine;
    pushUndoStack({
      type: 'type',
      tabId: 1,
      selector: '#username',
      previousValue: 'olduser'
    });

    const result = await undoLastAction();
    expect(result.success).toBe(true);
    expect(result.description).toContain('Restored field');
    expect(result.description).toContain('#username');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'undo_stack_updated', size: 0 });
  });

  test('handles type undo with empty previousValue', async () => {
    const { pushUndoStack } = agentEngine;
    pushUndoStack({
      type: 'type',
      tabId: 1,
      selector: '#search',
      previousValue: ''
    });

    const result = await undoLastAction();
    expect(result.success).toBe(true);
    expect(result.description).toContain('Restored field');
  });

  test('handles type undo without selector', async () => {
    const { pushUndoStack } = agentEngine;
    pushUndoStack({
      type: 'type',
      tabId: 1,
      selector: null,
      previousValue: 'oldvalue'
    });

    const result = await undoLastAction();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('no selector recorded');
  });

  test('handles unknown undo entry type', async () => {
    const { pushUndoStack } = agentEngine;
    pushUndoStack({ type: 'unknown_action', tabId: 1 });

    const result = await undoLastAction();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Unknown undo entry type');
  });

  test('handles malformed undo entry (missing type)', async () => {
    const { pushUndoStack } = agentEngine;
    pushUndoStack({ tabId: 1 }); // Missing type field

    const result = await undoLastAction();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Unknown undo entry type');
  });

  test('handles sendMessageWithRetry failure during type undo', async () => {
    const { pushUndoStack } = agentEngine;

    // Mock chrome.tabs.sendMessage to throw for this test
    chrome.tabs.sendMessage.mockImplementationOnce(async () => {
      throw new Error('Tab not found');
    });

    pushUndoStack({
      type: 'type',
      tabId: 1,
      selector: '#field',
      previousValue: 'old'
    });

    const result = await undoLastAction();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Could not restore field');
  });

  test('handles multiple undo operations in sequence', async () => {
    const { pushUndoStack } = agentEngine;
    pushUndoStack({ type: 'navigate', tabId: 1, previousUrl: 'https://first.com' });
    pushUndoStack({ type: 'navigate', tabId: 1, previousUrl: 'https://second.com' });

    // First undo
    let result = await undoLastAction();
    expect(result.success).toBe(true);
    expect(chrome.tabs.update).toHaveBeenLastCalledWith(1, { url: 'https://second.com' });

    // Second undo
    result = await undoLastAction();
    expect(result.success).toBe(true);
    expect(chrome.tabs.update).toHaveBeenLastCalledWith(1, { url: 'https://first.com' });

    // Third undo (empty stack)
    result = await undoLastAction();
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Nothing to undo');
  });
});
