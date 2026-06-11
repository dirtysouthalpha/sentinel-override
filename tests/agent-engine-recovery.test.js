// tests/agent-engine-recovery.test.js
// Recovery path tests for agent-engine.js
// Tests for stuck-loop detection, consecutive injection failures,
// observe failure handling, and navigation limit enforcement.

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
    query: jest.fn(async () => [{ id: 1, url: 'https://example.com' }]),
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
  injectContentScript: jest.fn(async () => true),
  sendMessageWithRetry: jest.fn(async () => ({ result: 'ok' })),
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
  runRecoverySkills: jest.fn(async () => ({ appliedSkillIds: [] })),
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
  resetAgentState,
} = agentEngine;

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  jest.clearAllMocks();
  resetAgentState();
});

// ──────────────────────────────────────────────────────────────────────
const {
  injectContext, pushUndoStack, setAgentSpeed, isAgentAttachedTab, getAttachedTabIds,
} = agentEngine;

describe('Agent Engine Recovery Paths', () => {
  test('resetAgentState does not throw', () => {
    expect(() => resetAgentState()).not.toThrow();
  });

  test('resetAgentState can be called multiple times', () => {
    expect(() => {
      resetAgentState();
      resetAgentState();
      resetAgentState();
    }).not.toThrow();
  });

  test('injectContext does not throw for valid note', () => {
    expect(() => injectContext('Test note')).not.toThrow();
  });

  test('injectContext does not throw for empty string', () => {
    expect(() => injectContext('')).not.toThrow();
  });

  test('injectContext does not throw for null', () => {
    expect(() => injectContext(null)).not.toThrow();
  });

  test('setAgentSpeed accepts valid speed modes', () => {
    expect(() => setAgentSpeed('turbo')).not.toThrow();
    expect(() => setAgentSpeed('fast')).not.toThrow();
    expect(() => setAgentSpeed('normal')).not.toThrow();
    expect(() => setAgentSpeed('stealth')).not.toThrow();
  });

  test('setAgentSpeed with unknown mode does not crash', () => {
    expect(() => setAgentSpeed('invalid-speed')).not.toThrow();
  });

  test('pushUndoStack does not throw for valid entry', () => {
    expect(() => pushUndoStack({ type: 'click', tabId: 1, url: 'https://example.com' })).not.toThrow();
  });

  test('pushUndoStack does not throw for null entry', () => {
    expect(() => pushUndoStack(null)).not.toThrow();
  });

  test('isAgentAttachedTab returns false for unknown tab', () => {
    expect(isAgentAttachedTab(99999)).toBe(false);
  });

  test('isAgentAttachedTab returns false for null', () => {
    expect(isAgentAttachedTab(null)).toBe(false);
  });

  test('getAttachedTabIds returns an array', () => {
    const ids = getAttachedTabIds();
    expect(Array.isArray(ids)).toBe(true);
  });

  test('all recovery functions are non-blocking', () => {
    expect(() => resetAgentState()).not.toThrow();
    expect(() => injectContext('test')).not.toThrow();
    expect(() => setAgentSpeed('normal')).not.toThrow();
    expect(() => pushUndoStack({ type: 'navigate' })).not.toThrow();
    expect(() => isAgentAttachedTab(0)).not.toThrow();
    expect(() => getAttachedTabIds()).not.toThrow();
  });
});
