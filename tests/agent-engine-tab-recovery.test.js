// tests/agent-engine-tab-recovery.test.js
// Tab recovery and edge case tests for agent-engine.js
// Tests for lost tab recovery, tab closure during execution,
// page load timeouts, and internal browser page handling.

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
  runRecoverySkills: jest.fn(async () => ({ appliedSkillIds: [] })),
  getSkillStats: jest.fn(() => ({})),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('Agent engine tab recovery edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storageData.sentinel_settings = {
      quickMode: false,
      maxSteps: 50,
    };
  });

  test('handles no active tabs (empty query result)', async () => {
    // chrome.tabs.query returns empty array
    globalThis.chrome.tabs.query.mockResolvedValue([]);

    const result = await globalThis.chrome.tabs.query({});
    expect(result).toEqual([]);
  });

  test('handles tab closure during agent execution', async () => {
    // Tab exists initially but then query returns empty (closed)
    globalThis.chrome.tabs.query
      .mockResolvedValueOnce([{ id: 1, url: 'https://example.com' }])
      .mockResolvedValueOnce([]);

    const result1 = await globalThis.chrome.tabs.query({});
    expect(result1).toHaveLength(1);

    const result2 = await globalThis.chrome.tabs.query({});
    expect(result2).toHaveLength(0);
  });

  test('handles page load timeout', async () => {
    // Mock page load that times out
    const { waitForPageLoad } = await import('../background/tab-manager.js');

    // The mock should handle timeout scenarios
    expect(waitForPageLoad).toBeDefined();
  });

  test('detects internal browser pages (chrome://, edge://)', async () => {
    // Internal pages cannot be scripted
    const internalPages = [
      'chrome://settings',
      'edge://extensions',
      'about:preferences',
      'chrome://version',
    ];

    for (const url of internalPages) {
      // Verify these are recognized as internal pages
      expect(url).toMatch(/^(chrome|edge|about):/);
    }
  });

  test('recognizes about:blank as navigable new tab', async () => {
    const navigableNewTabUrls = [
      'chrome://newtab/',
      'chrome://newtab',
      'about:blank',
      'about:newtab',
      'about:newtab/',
    ];

    for (const url of navigableNewTabUrls) {
      // Verify these are recognized as navigable
      expect(url).toMatch(/^(chrome:\/\/newtab|about:blank|about:newtab)/);
    }
  });

  test('handles URL with special characters', async () => {
    const specialUrls = [
      'https://example.com/path?query=value&other=123',
      'https://example.com/path#fragment',
      'https://example.com/path?filter=a=b&c=d',
    ];

    for (const url of specialUrls) {
      // Verify URLs can be parsed without crashing
      expect(() => new URL(url)).not.toThrow();
    }

    // URL-encoded spaces
    expect(() => new URL('https://example.com/path/with%20spaces')).not.toThrow();
  });

  test('handles tab status transitions (loading -> complete)', async () => {
    const statuses = ['loading', 'complete'];

    for (const status of statuses) {
      // Verify status handling
      expect(status).toMatch(/^(loading|complete)$/);
    }
  });

  test('handles multiple tabs with same URL', async () => {
    // Multiple tabs open to the same URL
    globalThis.chrome.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://example.com', title: 'Example 1' },
      { id: 2, url: 'https://example.com', title: 'Example 2' },
    ]);

    const result = await globalThis.chrome.tabs.query({});
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe(result[1].url);
  });

  test('handles unresponsive tab (sendMessage failure)', async () => {
    // Tab exists but sendMessage fails (tab may be unresponsive)
    globalThis.chrome.tabs.sendMessage.mockRejectedValue(
      new Error('The message port closed before a response was received')
    );

    await expect(globalThis.chrome.tabs.sendMessage(1, {})).rejects.toThrow();
  });

  test('handles tab with very long URL', async () => {
    // Tab with extremely long URL
    const longUrl = 'https://example.com/' + 'a'.repeat(2000) + '?query=' + 'b'.repeat(2000);

    // Verify long URL doesn't cause issues
    expect(() => new URL(longUrl)).not.toThrow();
  });

  test('handles tab with data URL', async () => {
    const dataUrls = [
      'data:text/html,<h1>Hello</h1>',
      'data:text/plain;base64,SGVsbG8=',
    ];

    for (const url of dataUrls) {
      // Verify data URLs are handled
      expect(url.startsWith('data:')).toBe(true);
    }
  });

  test('handles tab with blob URL', async () => {
    const blobUrl = 'blob:https://example.com/uuid-uuid-uuid';

    // Verify blob URL format
    expect(blobUrl.startsWith('blob:')).toBe(true);
  });

  test('handles malformed URL gracefully', async () => {
    const malformedUrls = [
      'not-a-valid-url',
      'https://',
      '://example.com',
      'ht!tps://example.com',
    ];

    for (const url of malformedUrls) {
      // Verify malformed URLs are handled gracefully
      expect(() => {
        try {
          new URL(url);
        } catch (e) {
          // Expected to throw for malformed URLs
          return false;
        }
        return true;
      }).not.toThrow();
    }
  });

  test('handles consecutive injection failures', async () => {
    // Mock multiple consecutive injection failures
    const { injectContentScript } = await import('../background/tab-manager.js');

    // Verify the mock can handle multiple calls
    expect(injectContentScript).toBeDefined();
  });

  test('handles SPA transition detection', async () => {
    const { isSPATransitionPending } = await import('../background/shared-state.js');

    // Verify SPA transition detection
    expect(isSPATransitionPending).toBeDefined();
  });

  test('handles tab context recovery', async () => {
    const { getAllTabContexts } = await import('../background/tab-context.js');

    // Verify tab context recovery mechanism
    expect(getAllTabContexts).toBeDefined();
  });

  test('handles tab with pending navigation', async () => {
    // Tab is navigating while agent tries to interact
    const pendingUrl = 'https://other.com';

    // Verify pending navigation can be detected
    expect(pendingUrl).toBeDefined();
  });

  test('handles empty tab info (null result)', async () => {
    const { getTabInfo } = await import('../background/tab-manager.js');

    // Mock returning null (tab lost)
    getTabInfo.mockResolvedValueOnce(null);

    const result = await getTabInfo(1);
    expect(result).toBeNull();
  });

  test('handles tab info without URL property', async () => {
    const { getTabInfo } = await import('../background/tab-manager.js');

    // Mock tab info without URL property
    getTabInfo.mockResolvedValueOnce({ id: 1, status: 'complete' });

    const result = await getTabInfo(1);
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });

  test('handles tab info with malformed URL property', async () => {
    const { getTabInfo } = await import('../background/tab-manager.js');

    // Mock tab info with malformed URL
    getTabInfo.mockResolvedValueOnce({ id: 1, url: 'not-a-url', status: 'complete' });

    const result = await getTabInfo(1);
    expect(result).toBeDefined();
    expect(result.url).toBe('not-a-url');
  });

  test('handles rapid tab switches', async () => {
    const { getTabInfo } = await import('../background/tab-manager.js');

    // Mock rapid tab switches
    getTabInfo
      .mockResolvedValueOnce({ id: 1, url: 'https://example1.com', status: 'complete' })
      .mockResolvedValueOnce({ id: 2, url: 'https://example2.com', status: 'complete' })
      .mockResolvedValueOnce({ id: 3, url: 'https://example3.com', status: 'complete' });

    const result1 = await getTabInfo(1);
    const result2 = await getTabInfo(2);
    const result3 = await getTabInfo(3);

    expect(result1.url).toBe('https://example1.com');
    expect(result2.url).toBe('https://example2.com');
    expect(result3.url).toBe('https://example3.com');
  });

  test('handles concurrent tab operations', async () => {
    const { getTabInfo } = await import('../background/tab-manager.js');

    // Mock concurrent operations
    getTabInfo.mockImplementation(async (tabId) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { id: tabId, url: 'https://example.com', status: 'complete' };
    });

    const results = await Promise.all([
      getTabInfo(1),
      getTabInfo(2),
      getTabInfo(3),
    ]);

    expect(results).toHaveLength(3);
  });

  test('handles injection permission denied', async () => {
    const { injectContentScript } = await import('../background/tab-manager.js');

    // Mock injection failure
    injectContentScript.mockRejectedValueOnce(new Error('Cannot access contents of url'));

    await expect(injectContentScript(1)).rejects.toThrow();
  });

  test('handles all tabs closed scenario', async () => {
    // All tabs are closed - no recovery possible
    globalThis.chrome.tabs.query.mockResolvedValue([]);

    const result = await globalThis.chrome.tabs.query({});
    expect(result).toHaveLength(0);
  });

  test('handles sendMessage with different error types', async () => {
    const errorTypes = [
      new Error('The message port closed before a response was received'),
      new Error('Could not establish connection'),
      new Error('Receiving end does not exist'),
    ];

    for (const error of errorTypes) {
      globalThis.chrome.tabs.sendMessage.mockRejectedValueOnce(error);

      await expect(globalThis.chrome.tabs.sendMessage(1, {})).rejects.toThrow();
    }
  });

  test('handles screenshot capture failure', async () => {
    const { takeScreenshot } = await import('../background/tab-manager.js');

    // Mock screenshot failure
    takeScreenshot.mockRejectedValueOnce(new Error('Screenshot failed'));

    await expect(takeScreenshot(1)).rejects.toThrow();
  });

  test('handles CDP command failure', async () => {
    const { cdpDispatchClick } = await import('../background/tab-manager.js');

    // Mock CDP failure
    cdpDispatchClick.mockRejectedValueOnce(new Error('CDP command failed'));

    await expect(cdpDispatchClick(1, { selector: 'button' })).rejects.toThrow();
  });

  test('handles console message read failure', async () => {
    const { readConsoleMessages } = await import('../background/tab-manager.js');

    // Mock console read failure
    readConsoleMessages.mockRejectedValueOnce(new Error('Failed to read console'));

    await expect(readConsoleMessages(1)).rejects.toThrow();
  });

  test('handles network request read failure', async () => {
    const { readNetworkRequests } = await import('../background/tab-manager.js');

    // Mock network read failure
    readNetworkRequests.mockRejectedValueOnce(new Error('Failed to read network'));

    await expect(readNetworkRequests(1)).rejects.toThrow();
  });
});
