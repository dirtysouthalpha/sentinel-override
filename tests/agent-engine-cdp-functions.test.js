// tests/agent-engine-cdp-functions.test.js
// Tests for zero-coverage exported CDP functions:
// recoverFromCaptcha, _cdpObservePage, _cdpDismissOverlays, _universalCdpFallback

import { jest } from '@jest/globals';

const storageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => { const r = {}; const kl = Array.isArray(keys) ? keys : Object.keys(keys || {}); for (const k of kl) r[k] = storageData[k]; return r; }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
    session: { set: jest.fn(async () => {}), get: jest.fn(async () => ({})) },
  },
  tabs: {
    query: jest.fn(async () => []),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    goBack: jest.fn(async () => {}),
  },
  tabGroups: { update: jest.fn(async () => {}) },
  sidePanel: { setOptions: jest.fn(async () => {}) },
  runtime: {
    sendMessage: jest.fn(async () => {}),
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
  debugger: {
    attach: jest.fn(async () => {}),
    detach: jest.fn(async () => {}),
    sendCommand: jest.fn(async () => ({})),
  },
};

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
  generatePlan: jest.fn(async () => ['Step 1']),
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
  sendMessageWithRetry: jest.fn(async () => ({})),
  takeScreenshot: jest.fn(async () => 'data:image/png;base64,abc'),
  isValidUrl: jest.fn(() => true),
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
  detachAllDebuggees: jest.fn(async () => {}),
  cdpDispatchClick: jest.fn(async () => {}),
  cdpDispatchType: jest.fn(async () => {}),
  cdpDispatchKey: jest.fn(async () => {}),
  cdpExecuteJs: jest.fn(async () => ({ ok: true, value: null })),
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
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn(), debug: jest.fn() },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })),
  suggestRetryActions: jest.fn(() => []),
}));

const mod = await import('../background/agent-engine.js');
const { recoverFromCaptcha } = mod;
const tabManager = await import('../background/tab-manager.js');

describe('recoverFromCaptcha', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns "solved" when reCAPTCHA checkbox is clicked', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: 'recaptcha_clicked' });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url', url: 'https://example.com/captcha' },
      'https://example.com/captcha',
      'test goal',
      5
    );
    expect(result).toBe('solved');
  });

  test('returns "solved" when hCaptcha checkbox is clicked', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: 'hcaptcha_clicked' });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://example.com/captcha',
      'test'
    );
    expect(result).toBe('solved');
  });

  test('returns "solved" when turnstile is clicked', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: 'turnstile_clicked' });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://example.com/captcha',
      'test'
    );
    expect(result).toBe('solved');
  });

  test('returns "solved" when generic checkbox clicked', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: 'generic_checkbox' });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://example.com/captcha',
      'test'
    );
    expect(result).toBe('solved');
  });

  test('returns "bypassed" for Amazon with search query', async () => {
    // CDP returns null (no auto-solve)
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: null });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url', url: 'https://www.amazon.com/errors/validateCaptcha' },
      'https://www.amazon.com/errors/validateCaptcha',
      'search for "wireless keyboard" on Amazon'
    );
    expect(result).toBe('bypassed');
    expect(globalThis.chrome.tabs.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ url: expect.stringContaining('amazon.com/s?k=') })
    );
  });

  test('returns "bypassed" for Amazon without search query', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: null });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://www.amazon.com/errors/validateCaptcha',
      'go to Amazon'
    );
    expect(result).toBe('bypassed');
    expect(globalThis.chrome.tabs.update).toHaveBeenCalledWith(
      1,
      { url: 'https://www.amazon.com' }
    );
  });

  test('returns "bypassed" for Google with search query', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: null });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://www.google.com/sorry?continue=...',
      'search for "test query" on Google'
    );
    expect(result).toBe('bypassed');
    expect(globalThis.chrome.tabs.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ url: expect.stringContaining('google.com/search?q=') })
    );
  });

  test('returns "bypassed" for Reddit', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: null });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://www.reddit.com/blocked',
      'browse reddit'
    );
    expect(result).toBe('bypassed');
  });

  test('returns "went_back" when no known host match', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: null });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://unknown-site.com/captcha',
      'do something'
    );
    expect(result).toBe('went_back');
    expect(globalThis.chrome.tabs.goBack).toHaveBeenCalledWith(1);
  });

  test('returns "needs_user" when goBack also fails', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: null });
    globalThis.chrome.tabs.goBack.mockRejectedValueOnce(new Error('Cannot go back'));
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://unknown-site.com/captcha',
      'do something'
    );
    expect(result).toBe('needs_user');
  });

  test('handles CDP execute error gracefully', async () => {
    tabManager.cdpExecuteJs.mockRejectedValueOnce(new Error('CDP failed'));
    // Falls through to strategy 2, then 3, then 4
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://unknown-site.com/captcha',
      'test'
    );
    // Should go to "went_back" or "needs_user" depending on goBack
    expect(['went_back', 'needs_user']).toContain(result);
  });

  test('handles amazon_captcha_needs_input result (does not solve)', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: 'amazon_captcha_needs_input' });
    // This should NOT return 'solved' — it needs user input
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://www.amazon.com/errors/validateCaptcha',
      'search for something on Amazon'
    );
    // Should bypass since it's Amazon
    expect(result).toBe('bypassed');
  });

  test('handles null CDP result value', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: false, value: null });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://unknown-site.com/captcha',
      'test'
    );
    expect(result).toBe('went_back');
  });

  test('handles string "null" CDP result value', async () => {
    tabManager.cdpExecuteJs.mockResolvedValueOnce({ ok: true, value: 'null' });
    const result = await recoverFromCaptcha(
      { id: 1 },
      { type: 'captcha_url' },
      'https://unknown-site.com/captcha',
      'test'
    );
    expect(result).toBe('went_back');
  });
});
