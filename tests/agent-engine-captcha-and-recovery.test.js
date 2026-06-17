// tests/agent-engine-captcha-and-recovery.test.js
// Deep coverage of detectCaptcha() and _generateSmartRecovery() pure functions.

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
let onMessageListeners = [];

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
    session: { set: jest.fn(async () => {}) },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
  },
  tabGroups: { update: jest.fn(async () => {}) },
  sidePanel: { setOptions: jest.fn(async () => {}) },
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

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
  parseVisionResponse: jest.fn((raw) => { try { return JSON.parse(raw); } catch { return null; } }),
  generatePlan: jest.fn(async () => ['Step 1']),
  supportsVision: jest.fn(() => true),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []), estimateCostUsd: jest.fn(() => 0), isSimpleStep: jest.fn(() => false),
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
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })),
  suggestRetryActions: jest.fn(() => []),
}));

const { detectCaptcha, _generateSmartRecovery } = await import('../background/agent-engine.js');

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
describe('detectCaptcha', () => {
  test('null URL returns null', () => {
    expect(detectCaptcha(null)).toBeNull();
  });

  test('undefined URL returns null', () => {
    expect(detectCaptcha(undefined)).toBeNull();
  });

  test('empty string URL returns null', () => {
    expect(detectCaptcha('')).toBeNull();
  });

  test('normal URL returns null', () => {
    expect(detectCaptcha('https://example.com/page')).toBeNull();
  });

  test('URL with /captcha/ pattern is detected', () => {
    const result = detectCaptcha('https://example.com/captcha/challenge');
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
    expect(result.type).toBe('captcha_url');
  });

  test('URL with validateCaptcha pattern is detected', () => {
    const result = detectCaptcha('https://example.com/validateCaptcha');
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_url');
  });

  test('URL with /challenge/ pattern is detected', () => {
    const result = detectCaptcha('https://example.com/challenge?k=abc');
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_url');
  });

  test('URL with recaptcha pattern is detected', () => {
    const result = detectCaptcha('https://example.com/recaptcha/verify');
    expect(result).toBeTruthy();
  });

  test('URL with hcaptcha pattern is detected', () => {
    const result = detectCaptcha('https://example.com/hcaptcha/check');
    expect(result).toBeTruthy();
  });

  test('URL with turnstile pattern is detected', () => {
    const result = detectCaptcha('https://example.com/turnstile');
    expect(result).toBeTruthy();
  });

  test('URL with blocked pattern is detected', () => {
    const result = detectCaptcha('https://example.com/blocked');
    expect(result).toBeTruthy();
  });

  test('URL with /access.denied pattern is detected', () => {
    const result = detectCaptcha('https://example.com/access.denied');
    expect(result).toBeTruthy();
  });

  test('URL with /security.check pattern is detected', () => {
    const result = detectCaptcha('https://example.com/security.check');
    expect(result).toBeTruthy();
  });

  test('URL with /errors/ pattern is detected', () => {
    const result = detectCaptcha('https://www.amazon.com/errors/?errorId=123');
    expect(result).toBeTruthy();
  });

  test('URL hit with text confirmation has higher confidence', () => {
    const result = detectCaptcha(
      'https://example.com/captcha/',
      'Please verify you are human by completing the puzzle',
    );
    expect(result).toBeTruthy();
    expect(result.textConfirm).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('URL hit without text confirmation has lower confidence', () => {
    const result = detectCaptcha('https://example.com/captcha/', 'Some random text');
    expect(result).toBeTruthy();
    expect(result.textConfirm).toBe(false);
    expect(result.confidence).toBeLessThan(0.9);
  });

  test('URL hit with low element count sets lowElements flag', () => {
    const result = detectCaptcha('https://example.com/captcha/', null, 3);
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(true);
  });

  test('URL hit with high element count does not set lowElements', () => {
    const result = detectCaptcha('https://example.com/captcha/', null, 50);
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(false);
  });

  test('URL hit with no elementsCount has lowElements false', () => {
    const result = detectCaptcha('https://example.com/captcha/');
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(false);
  });

  test('URL hit with elementsCount=5 is lowElements', () => {
    const result = detectCaptcha('https://example.com/captcha/', null, 5);
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(true);
  });

  test('URL hit with elementsCount=6 is not lowElements', () => {
    const result = detectCaptcha('https://example.com/captcha/', null, 6);
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(false);
  });

  test('confidence calculation: text + low elements', () => {
    const result = detectCaptcha(
      'https://example.com/captcha/',
      'Verify you are human',
      3,
    );
    expect(result.confidence).toBeCloseTo(1.0);
  });

  // Content-based detection
  test('text-based captcha with low elements is detected', () => {
    const result = detectCaptcha(
      'https://example.com/normal-page',
      'Please verify you are a human and not a robot',
      8,
    );
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_text');
    expect(result.confidence).toBe(0.85);
  });

  test('text-based captcha with elements > 10 is NOT detected', () => {
    const result = detectCaptcha(
      'https://example.com/normal-page',
      'Please verify you are a human',
      15,
    );
    expect(result).toBeNull();
  });

  test('text-based captcha with no pageText is not detected', () => {
    const result = detectCaptcha('https://example.com/normal-page', null, 3);
    expect(result).toBeNull();
  });

  test('text-based captcha with undefined elements is not detected', () => {
    const result = detectCaptcha(
      'https://example.com/normal-page',
      'Please verify you are a human',
    );
    expect(result).toBeNull();
  });

  test('text "not a robot" pattern is detected', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'Please confirm you are not a robot',
      3,
    );
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_text');
  });

  test('text "checking your browser" pattern is detected', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'Checking your browser before we proceed',
      5,
    );
    expect(result).toBeTruthy();
  });

  test('text "unusual traffic" pattern is detected', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'Our systems have detected unusual traffic from your network',
      4,
    );
    expect(result).toBeTruthy();
  });

  test('text "automated access" pattern is detected', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'This site protects against automated access',
      2,
    );
    expect(result).toBeTruthy();
  });

  test('text "are you human" pattern is detected', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'Are you human? Prove it.',
      3,
    );
    expect(result).toBeTruthy();
  });

  test('normal text on normal page returns null', () => {
    const result = detectCaptcha(
      'https://example.com/article',
      'This is a normal page with lots of content about technology',
      100,
    );
    expect(result).toBeNull();
  });

  test('returns URL in result', () => {
    const url = 'https://example.com/captcha/test';
    const result = detectCaptcha(url);
    expect(result.url).toBe(url);
  });

  test('returns pattern source in URL-based detection', () => {
    const result = detectCaptcha('https://example.com/captcha/');
    expect(result.pattern).toBeTruthy();
    expect(typeof result.pattern).toBe('string');
  });

  test('text-based detection returns pattern source', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'are you human?',
      3,
    );
    expect(result.pattern).toBeTruthy();
  });

  test('text-based detection lowElements threshold at 5', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'are you human?',
      5,
    );
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(true);
  });

  test('text-based detection lowElements false at 6-10', () => {
    const result = detectCaptcha(
      'https://example.com/page',
      'are you human?',
      8,
    );
    expect(result).toBeTruthy();
    expect(result.lowElements).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_generateSmartRecovery', () => {
  test('returns array of strategies', () => {
    const result = _generateSmartRecovery('find products', 'https://www.amazon.com/s?k=laptop', '', {}, [], 5);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('Amazon URL generates sort strategies', () => {
    const result = _generateSmartRecovery('find laptops', 'https://www.amazon.com/s?k=laptop', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('review-rank');
    expect(joined).toContain('price-asc-rank');
    expect(joined).toContain('date-desc-rank');
  });

  test('Amazon URL with sort already applied omits that strategy', () => {
    const result = _generateSmartRecovery('find laptops', 'https://www.amazon.com/s?k=laptop&s=review-rank', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).not.toContain('review-rank');
    expect(joined).toContain('price-asc-rank');
  });

  test('Amazon always has extract strategy', () => {
    const result = _generateSmartRecovery('find stuff', 'https://www.amazon.com/product/abc', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('execute_js');
    expect(joined).toContain('s-result-item');
  });

  test('Reddit URL generates extract strategy', () => {
    const result = _generateSmartRecovery('find posts', 'https://www.reddit.com/r/test', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('post-container');
  });

  test('Reddit search URL generates sort strategy', () => {
    const result = _generateSmartRecovery('search reddit', 'https://www.reddit.com/search?q=test', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('sort=top');
  });

  test('Google search URL generates extract strategy', () => {
    const result = _generateSmartRecovery('search google', 'https://www.google.com/search?q=test', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('document.querySelectorAll');
  });

  test('YouTube URL generates extract strategy', () => {
    const result = _generateSmartRecovery('find videos', 'https://www.youtube.com/results?q=test', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('ytd-video-renderer');
  });

  test('News site generates extract strategy', () => {
    const result = _generateSmartRecovery('read news', 'https://www.cnn.com/article', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('headline');
  });

  test('BBC generates extract strategy', () => {
    const result = _generateSmartRecovery('read news', 'https://www.bbc.com/news', '', {}, [], 5);
    expect(result.join(' ')).toContain('headline');
  });

  test('Goal with "top N" generates batch extract strategy', () => {
    const result = _generateSmartRecovery('find top 10 laptops', 'https://example.com', '', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('extract all matching');
  });

  test('Goal with "find 5" generates batch strategy', () => {
    const result = _generateSmartRecovery('find 5 products', 'https://example.com', '', {}, [], 5);
    expect(result.join(' ')).toContain('extract all matching');
  });

  test('Goal with "compare" generates direct URL strategy', () => {
    const result = _generateSmartRecovery('compare amazon prices', 'https://example.com', '', {}, [], 5);
    expect(result.join(' ')).toContain('direct URL');
  });

  test('Goal with "also check" generates navigate strategy', () => {
    const result = _generateSmartRecovery('check amazon then also check reddit', 'https://example.com', '', {}, [], 5);
    expect(result.join(' ')).toContain('navigate');
  });

  test('Goal mentioning amazon constructs URL', () => {
    const result = _generateSmartRecovery(
      'search for laptops on amazon',
      'https://example.com',
      '',
      {},
      [],
      5,
    );
    const joined = result.join(' ');
    expect(joined).toContain('amazon.com');
  });

  test('Goal mentioning reddit constructs URL', () => {
    const result = _generateSmartRecovery(
      'search for posts about tech on reddit',
      'https://example.com',
      '',
      {},
      [],
      5,
    );
    const joined = result.join(' ');
    expect(joined).toContain('reddit.com');
  });

  test('Goal mentioning youtube with search query constructs URL', () => {
    const result = _generateSmartRecovery(
      'search for coding tutorials on youtube',
      'https://example.com',
      '',
      {},
      [],
      5,
    );
    const joined = result.join(' ');
    expect(joined).toContain('youtube.com');
  });

  test('Long page text generates "read the page" strategy', () => {
    const longText = 'A'.repeat(1500);
    const result = _generateSmartRecovery('some goal', 'https://example.com', longText, {}, [], 5);
    expect(result.join(' ')).toContain('Read the page text');
  });

  test('Short page text with no matches generates fallback strategies', () => {
    const result = _generateSmartRecovery('some goal', 'https://example.com', 'short', {}, [], 5);
    const joined = result.join(' ');
    expect(joined).toContain('execute_js');
    expect(joined).toContain('read_page');
    expect(joined).toContain('navigate_back');
  });

  test('No URL still returns fallback strategies', () => {
    const result = _generateSmartRecovery('some goal', '', '', {}, [], 5);
    expect(result.length).toBeGreaterThan(0);
  });

  test('Null/undefined inputs return fallback strategies', () => {
    const result = _generateSmartRecovery(null, null, null, null, null, null);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
