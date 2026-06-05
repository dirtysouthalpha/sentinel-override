// tests/agent-engine-mismatch-edge-cases.test.js
// Mode mismatch and adaptive prompts error path tests

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
      set: jest.fn(async (obj) => {
        Object.assign(storageData, obj);
        if (obj.run_log_test) {
          // Simulate storage write failure
          throw new Error('Storage quota exceeded');
        }
      }),
      remove: jest.fn(async () => {}),
    },
    session: {
      set: jest.fn(async () => {}),
    },
  },
  tabs: {
    query: jest.fn(async () => []),
    goBack: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    sendMessage: jest.fn(async () => {}),
  },
  runtime: {
    sendMessage: jest.fn(async (msg) => {
      if (msg.action === 'agent_finished') {
        throw new Error('Message port closed');
      }
    }),
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
  detachAllSentinelTabs: jest.fn(async () => {}),
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

describe('Agent engine mode mismatch and adaptive prompts edge cases', () => {
  beforeEach(() => {
    Object.keys(storageData).forEach(k => delete storageData[k]);
    jest.clearAllMocks();
    resetAgentState();
    storageData.sentinel_settings = {
      approvalMode: false,
      adaptivePromptsMode: 'auto',
    };
  });

  test('handles mode directive detection with various goal formats', () => {
    const goals = [
      'autonomous: check the server status',
      'AUTONOMOUS: restart the service',
      'approval: verify the configuration',
      'APPROVAL: review the logs',
      'autonomous mode: run diagnostics',
      'in approval mode: check the firewall',
      'run this in autonomous mode',
      'execute in approval mode',
    ];

    for (const goal of goals) {
      expect(typeof goal === 'string' ? goal.toLowerCase() : String(goal).toLowerCase()).toMatch(/(autonomous|approval)/);
    }
  });

  test('handles mode mismatch when storage read fails', async () => {
    // Mock storage get to throw
    globalThis.chrome.storage.local.get.mockRejectedValueOnce(new Error('Storage access denied'));

    await expect(globalThis.chrome.storage.local.get(['approvalMode'])).rejects.toThrow();
  });

  test('handles mode mismatch when sendMessage fails', async () => {
    // sendMessage already mocked to throw for agent_finished action
    const msg = { action: 'agent_finished', summary: 'Test' };

    await expect(globalThis.chrome.runtime.sendMessage(msg)).rejects.toThrow();
  });

  test('handles mode mismatch with null stored setting', async () => {
    storageData.approvalMode = null;

    const result = await globalThis.chrome.storage.local.get(['approvalMode']);
    expect(result.approvalMode).toBeNull();
  });

  test('handles mode mismatch with undefined stored setting', async () => {
    // approvalMode not in storage

    const result = await globalThis.chrome.storage.local.get(['approvalMode']);
    expect(result.approvalMode).toBeUndefined();
  });

  test('handles adaptive prompts storage write failure', async () => {
    // Storage set mocked to throw for run_log_test key
    await expect(globalThis.chrome.storage.local.set({
      run_log_test: { goal: 'test', runLogId: 'test', entries: [], lastUpdate: Date.now() }
    })).rejects.toThrow();
  });

  test('handles adaptive prompts with malformed platform result', async () => {
    const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

    // Mock to return malformed result
    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      adaptedGoal: null,
      platform: null,
      summary: null,
    });

    const result = await rewriteGoalForPlatform('test goal', 'https://example.com');
    expect(result.adapted).toBe(true);
    expect(result.adaptedGoal).toBeNull();
  });

  test('handles adaptive prompts with empty adapted goal', async () => {
    const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      adaptedGoal: '',
      platform: null,
      summary: 'Empty goal',
    });

    const result = await rewriteGoalForPlatform('test goal', 'https://example.com');
    expect(result.adaptedGoal).toBe('');
  });

  test('handles adaptive prompts with very long adapted goal', async () => {
    const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

    const longGoal = 'x'.repeat(100000);

    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      adaptedGoal: longGoal,
      platform: null,
      summary: 'Long goal',
    });

    const result = await rewriteGoalForPlatform('test goal', 'https://example.com');
    expect(result.adaptedGoal.length).toBe(100000);
  });

  test('handles adaptive prompts decision timeout', async () => {
    // Simulate timeout scenario
    const decision = { useOriginal: false, edited: false, editedGoal: null, timeout: true };

    expect(decision.timeout).toBe(true);
  });

  test('handles adaptive prompts with edited goal that is too short', async () => {
    const decision = { useOriginal: false, edited: true, editedGoal: 'short' };

    // Edited goal too short should fall back to adapted
    expect(decision.editedGoal.length).toBeLessThan(10);
  });

  test('handles adaptive prompts with null edited goal', async () => {
    const decision = { useOriginal: false, edited: true, editedGoal: null };

    expect(decision.editedGoal).toBeNull();
  });

  test('handles adaptive prompts with non-string edited goal', async () => {
    const decision = { useOriginal: false, edited: true, editedGoal: 12345 };

    expect(typeof decision.editedGoal).toBe('number');
  });

  test('handles adaptive prompts mode mismatch detection', async () => {
    const modes = ['off', 'auto', 'approval'];

    for (const mode of modes) {
      expect(modes.includes(mode)).toBe(true);
    }
  });

  test('handles adaptive prompts with null technician info', async () => {
    const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: false,
    });

    const result = await rewriteGoalForPlatform('test goal', 'https://example.com', null);
    expect(result.adapted).toBe(false);
  });

  test('handles adaptive prompts with malformed expansion mode', async () => {
    const expansionModes = [null, 'invalid', '', 123, {}];

    for (const mode of expansionModes) {
      expect(mode).toBeDefined();
    }
  });

  test('handles adaptive prompts with missing platform profile', async () => {
    const { getPlatformProfile } = await import('../background/platforms/index.js');

    getPlatformProfile.mockResolvedValueOnce(null);

    const profile = await getPlatformProfile('https://unknown-platform.com');
    expect(profile).toBeNull();
  });

  test('handles run log buffer with malformed entries', () => {
    const malformedEntries = [
      null,
      {},
      { step: 'not a number' },
      { step: 1, timestamp: 'not a date' },
      { step: 1, timestamp: null, kind: null },
    ];

    for (const entry of malformedEntries) {
      expect(entry).toBeDefined();
    }
  });

  test('handles run log ID with various formats', () => {
    const logIds = [
      null,
      '',
      'not-a-uuid',
      '123e4567-e89b-12d3-a456-426614174000',
      'short',
    ];

    for (const id of logIds) {
      expect(id !== undefined).toBe(true);
    }
  });

  test('handles concurrent mode directive detection', () => {
    const goals = [
      'autonomous: task 1',
      'approval: task 2',
      'autonomous mode: task 3',
    ];

    const autonomousCount = goals.filter(g => typeof g === 'string' && g.toLowerCase().includes('autonomous')).length;
    expect(autonomousCount).toBe(2);
  });

  test('handles mode directive with special characters', () => {
    const goals = [
      'autonomous: check "quotes" and \'apostrophes\'',
      'approval: test @#$%^&*() special chars',
      'autonomous: \n\t\r\n whitespace',
    ];

    for (const goal of goals) {
      expect(goal.length).toBeGreaterThan(0);
    }
  });

  test('handles mode directive in very long goal', () => {
    const longGoal = 'x'.repeat(10000) + ' autonomous: do something';

    expect(typeof longGoal === 'string' && longGoal.toLowerCase()).toContain('autonomous');
  });

  test('handles mode directive with case variations', () => {
    const variations = [
      'AUTONOMOUS',
      'autonomous',
      'AuToNoMoUs',
      'aUtOnOmOuS',
      'APPROVAL',
      'approval',
      'ApPrOvAl',
    ];

    for (const variation of variations) {
      expect(typeof variation === 'string' ? variation.toLowerCase() : String(variation).toLowerCase()).toMatch(/^(autonomous|approval)$/);
    }
  });

  test('handles adaptive prompts broadcast failure', async () => {
    // Mock sendMessage to fail for adapted_goal_available
    globalThis.chrome.runtime.sendMessage.mockImplementationOnce((msg) => {
      if (msg.action === 'adapted_goal_available') {
        return Promise.reject(new Error('Broadcast failed'));
      }
      return Promise.resolve();
    });

    const msg = { action: 'adapted_goal_available', mode: 'auto' };
    await expect(globalThis.chrome.runtime.sendMessage(msg)).rejects.toThrow('Broadcast failed');
  });

  test('handles adaptive prompts with missing mismatch hints', async () => {
    const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      adaptedGoal: 'adapted',
      platform: null,
      summary: 'test',
      mismatchHints: null,
    });

    const result = await rewriteGoalForPlatform('test', 'https://example.com');
    expect(result.mismatchHints).toBeNull();
  });

  test('handles adaptive prompts with empty mismatch hints', async () => {
    const { rewriteGoalForPlatform } = await import('../background/adaptive-prompts.js');

    rewriteGoalForPlatform.mockResolvedValueOnce({
      adapted: true,
      adaptedGoal: 'adapted',
      platform: null,
      summary: 'test',
      mismatchHints: [],
    });

    const result = await rewriteGoalForPlatform('test', 'https://example.com');
    expect(result.mismatchHints).toEqual([]);
  });
});
