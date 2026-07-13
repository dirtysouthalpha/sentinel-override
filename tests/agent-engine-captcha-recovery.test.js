// tests/agent-engine-captcha-recovery.test.js
// Tests for detectCaptcha and _generateSmartRecovery — pure functions with no external deps.

import { jest } from '@jest/globals';

// ── Chrome API mock (minimal) ──
const storageData = {};
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
    },
    session: { set: jest.fn(async () => {}) },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    goBack: jest.fn(async () => {}),
    onUpdated: { addListener: jest.fn() },
  },
  tabGroups: { update: jest.fn(async () => {}) },
  sidePanel: { setOptions: jest.fn(async () => {}) },
  runtime: {
    sendMessage: jest.fn(async () => {}),
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
  debugger: { detach: jest.fn(async () => {}) },
  notifications: { create: jest.fn(async () => 'notif-1') },
};

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 10) };
}

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
  sendMessageWithRetry: jest.fn(async () => ({})),
  takeScreenshot: jest.fn(async () => 'data:image/png;base64,abc'),
  isValidUrl: jest.fn(() => true),
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
  detachAllDebuggees: jest.fn(async () => {}),
  cdpDispatchClick: jest.fn(async () => ({ ok: true })),
  cdpDispatchType: jest.fn(async () => ({})),
  cdpDispatchKey: jest.fn(async () => ({})),
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
  generateReport: jest.fn(async () => ({ summary: 'ok', fullReport: 'report' })),
  buildFallbackReport: jest.fn(() => 'fallback'),
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

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => 1),
  getTabContext: jest.fn(() => ({ label: 'test', url: 'https://example.com' })),
  getAllTabContexts: jest.fn(() => [{ label: 'test', url: 'https://example.com', snapshot: null }]),
  openTab: jest.fn(async () => 2),
  switchToTab: jest.fn(async () => {}),
  closeTab: jest.fn(async () => {}),
  closeAllAgentTabs: jest.fn(async () => {}),
  updateSnapshot: jest.fn(async () => {}),
  resetAllContexts: jest.fn(),
  findTabByLabel: jest.fn(() => null),
  registerInitialTab: jest.fn(),
  getTabCount: jest.fn(() => 1),
}));

jest.unstable_mockModule('../background/client-knowledge.js', () => ({
  getClientStartupContext: jest.fn(async () => ({ client: null, relevantEntries: [], promptSection: '' })),
  markRunCompleted: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: jest.fn(async (goal) => goal),
}));

jest.unstable_mockModule('../background/audit-log.js', () => ({
  appendAuditEntry: jest.fn(async () => {}),
  getAuditLog: jest.fn(async () => []),
  auditLogToCsv: jest.fn(() => ''),
}));

jest.unstable_mockModule('../background/skills/index.js', () => ({
  runRecoverySkills: jest.fn(async () => ({ handled: false })),
  getSkillStats: jest.fn(() => ({})),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { trace: jest.fn(), event: jest.fn(), error: jest.fn() },
  startRun: jest.fn(),
  endRun: jest.fn(),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 85, breakdown: {} })),
  suggestRetryActions: jest.fn(() => []),
}));

// ── Import the module under test ──
const agentEngine = await import('../background/agent-engine.js');
const { detectCaptcha, _generateSmartRecovery } = agentEngine;

// ═══════════════════════════════════════════════════════════════════
// detectCaptcha — pure function tests
// ═══════════════════════════════════════════════════════════════════
describe('detectCaptcha', () => {
  test('returns null when currentUrl is falsy', () => {
    expect(detectCaptcha(null, '', 10)).toBeNull();
    expect(detectCaptcha('', 'text', 10)).toBeNull();
    expect(detectCaptcha(undefined, 'text', 10)).toBeNull();
  });

  test('returns null when no captcha patterns match', () => {
    expect(detectCaptcha('https://example.com/page', 'Hello world', 50)).toBeNull();
  });

  test('detects captcha via URL pattern — validateCaptcha', () => {
    const result = detectCaptcha('https://site.com/validateCaptcha?token=abc', '', 10);
    expect(result).not.toBeNull();
    expect(result.matched).toBe(true);
    expect(result.type).toBe('captcha_url');
    expect(result.url).toBe('https://site.com/validateCaptcha?token=abc');
    expect(typeof result.pattern).toBe('string');
  });

  test('detects captcha via URL pattern — /captcha/', () => {
    const result = detectCaptcha('https://example.com/captcha/?id=123', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — recaptcha', () => {
    const result = detectCaptcha('https://google.com/recaptcha/api2/anchor', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — hcaptcha', () => {
    const result = detectCaptcha('https://hcaptcha.com/challenge', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — turnstile', () => {
    const result = detectCaptcha('https://site.com/turnstile/verify', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — cf-chl', () => {
    const result = detectCaptcha('https://site.com/cf-chl-5', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — /errors/', () => {
    const result = detectCaptcha('https://amazon.com/errors/404', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — blocked', () => {
    const result = detectCaptcha('https://site.com/blocked', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — /access.denied', () => {
    const result = detectCaptcha('https://site.com/access.denied', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('detects captcha via URL pattern — /security.check', () => {
    const result = detectCaptcha('https://site.com/security.check', '', 50);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_url');
  });

  test('textConfirm is true when page text also matches', () => {
    const result = detectCaptcha('https://site.com/captcha/', 'Please verify you are human', 10);
    expect(result.textConfirm).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('textConfirm is false when page text does not match', () => {
    const result = detectCaptcha('https://site.com/captcha/', 'Welcome to our site', 10);
    expect(result.textConfirm).toBe(false);
  });

  test('lowElements true when elementsCount <= 5', () => {
    const result = detectCaptcha('https://site.com/captcha/', '', 3);
    expect(result.lowElements).toBe(true);
  });

  test('lowElements false when elementsCount > 5', () => {
    const result = detectCaptcha('https://site.com/captcha/', '', 20);
    expect(result.lowElements).toBe(false);
  });

  test('lowElements false when elementsCount is undefined', () => {
    const result = detectCaptcha('https://site.com/captcha/', '', undefined);
    expect(result.lowElements).toBe(false);
  });

  test('confidence calculation: textConfirm + lowElements = 1.0', () => {
    const result = detectCaptcha('https://site.com/captcha/', 'not a robot', 3);
    expect(result.textConfirm).toBe(true);
    expect(result.lowElements).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  test('confidence calculation: textConfirm only = 0.9', () => {
    const result = detectCaptcha('https://site.com/captcha/', 'not a robot', 20);
    expect(result.confidence).toBe(0.9);
  });

  test('confidence calculation: lowElements only = 0.1', () => {
    const result = detectCaptcha('https://site.com/captcha/', '', 3);
    expect(result.confidence).toBe(0.1);
  });

  test('confidence calculation: neither = 0.0', () => {
    const result = detectCaptcha('https://site.com/captcha/', '', 20);
    expect(result.confidence).toBe(0.0);
  });

  // Content-based detection
  test('content-based detection: text match + low elements = captcha_text', () => {
    const result = detectCaptcha('https://example.com/page', 'Please verify you are human', 8);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_text');
    expect(result.matched).toBe(true);
    expect(result.textConfirm).toBe(true);
    expect(result.confidence).toBe(0.85);
  });

  test('content-based detection: lowElements true when <= 5', () => {
    const result = detectCaptcha('https://example.com/page', 'not a robot', 5);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_text');
    expect(result.lowElements).toBe(true);
  });

  test('content-based detection: lowElements false when > 5', () => {
    const result = detectCaptcha('https://example.com/page', 'not a robot', 8);
    expect(result).not.toBeNull();
    expect(result.type).toBe('captcha_text');
    expect(result.lowElements).toBe(false);
  });

  test('content-based detection: no match when elementsCount > 10', () => {
    const result = detectCaptcha('https://example.com/page', 'not a robot', 15);
    expect(result).toBeNull();
  });

  test('content-based detection: no match when no text pattern matches', () => {
    const result = detectCaptcha('https://example.com/page', 'Welcome to our site', 5);
    expect(result).toBeNull();
  });

  test('content-based detection: no match when pageText is empty', () => {
    const result = detectCaptcha('https://example.com/page', '', 5);
    expect(result).toBeNull();
  });

  test('content-based detection: various text patterns', () => {
    expect(detectCaptcha('https://example.com', 'Please complete the security check', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Enter the characters you see', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Solve this puzzle', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Sorry for the interruption', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Automated access detected', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Unusual traffic detected', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Our systems have detected unusual', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Checking your browser', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Human verification required', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Are you human?', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Before we proceed', 5)).not.toBeNull();
    // Note: "sorry.we.just.need" regex doesn't match "Sorry, we just need to verify" — the regex is /sorry.{0,20}interrupt/i
    // Instead test with the actual matching pattern:
    expect(detectCaptcha('https://example.com', 'Sorry for the constant interruptions', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Please complete this form', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'Type the characters', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'prove that you are human', 5)).not.toBeNull();
    expect(detectCaptcha('https://example.com', 'are you a robot', 5)).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// _generateSmartRecovery — pure function tests
// ═══════════════════════════════════════════════════════════════════
describe('_generateSmartRecovery', () => {
  test('returns fallback strategies when nothing matches', () => {
    const strategies = _generateSmartRecovery('do something', 'https://example.com', '', null, [], 1);
    expect(strategies.length).toBeGreaterThanOrEqual(3);
    expect(strategies.some(s => /execute_js|inspect DOM/i.test(s))).toBe(true);
    expect(strategies.some(s => /read_page/i.test(s))).toBe(true);
    expect(strategies.some(s => /navigate_back/i.test(s))).toBe(true);
  });

  test('amazon search URL adds sort strategies', () => {
    const strategies = _generateSmartRecovery(
      'find best products',
      'https://www.amazon.com/s?k=laptop',
      '', null, [], 1
    );
    expect(strategies.some(s => /s=review-rank/.test(s))).toBe(true);
    expect(strategies.some(s => /s=price-asc-rank/.test(s))).toBe(true);
    expect(strategies.some(s => /s=date-desc-rank/.test(s))).toBe(true);
    expect(strategies.some(s => /s-result-item/.test(s))).toBe(true);
  });

  test('amazon non-search URL adds extract strategy only', () => {
    const strategies = _generateSmartRecovery(
      'check laptop prices',
      'https://www.amazon.com/dp/B08N5WRWNW',
      '', null, [], 1
    );
    expect(strategies.some(s => /s-result-item/.test(s))).toBe(true);
    expect(strategies.some(s => /s=review-rank/.test(s))).toBe(false);
  });

  test('amazon search URL already sorted by rating skips that strategy', () => {
    const strategies = _generateSmartRecovery(
      'find products',
      'https://www.amazon.com/s?k=laptop&s=review-rank',
      '', null, [], 1
    );
    expect(strategies.some(s => /s=review-rank/.test(s))).toBe(false);
    expect(strategies.some(s => /s=price-asc-rank/.test(s))).toBe(true);
  });

  test('reddit URL adds extract and search sort strategies', () => {
    const strategies = _generateSmartRecovery(
      'find top posts',
      'https://www.reddit.com/search/?q=javascript',
      '', null, [], 1
    );
    expect(strategies.some(s => /post-container/.test(s))).toBe(true);
    expect(strategies.some(s => /sort=top/.test(s))).toBe(true);
  });

  test('reddit non-search URL adds extract only', () => {
    const strategies = _generateSmartRecovery(
      'read subreddit',
      'https://www.reddit.com/r/javascript',
      '', null, [], 1
    );
    expect(strategies.some(s => /post-container/.test(s))).toBe(true);
    expect(strategies.some(s => /sort=top/.test(s))).toBe(false);
  });

  test('google search URL adds extract strategy', () => {
    const strategies = _generateSmartRecovery(
      'search for results',
      'https://www.google.com/search?q=test',
      '', null, [], 1
    );
    expect(strategies.some(s => /\.g/.test(s))).toBe(true);
  });

  test('youtube URL adds extract strategy', () => {
    const strategies = _generateSmartRecovery(
      'find videos',
      'https://www.youtube.com/results?search_query=test',
      '', null, [], 1
    );
    expect(strategies.some(s => /ytd-video-renderer/.test(s))).toBe(true);
  });

  test('news site URLs add article extraction strategy', () => {
    for (const site of ['cnn.com', 'bbc.com', 'nytimes.com', 'reuters.com']) {
      const strategies = _generateSmartRecovery(
        'read news',
        `https://www.${site}/article`,
        '', null, [], 1
      );
      expect(strategies.some(s => /article|headline/.test(s))).toBe(true);
    }
  });

  test('goal with "top N" adds extraction strategy', () => {
    const strategies = _generateSmartRecovery(
      'find top 10 laptops',
      'https://example.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /extract all matching/i.test(s))).toBe(true);
  });

  test('goal with "best" adds extraction strategy', () => {
    const strategies = _generateSmartRecovery(
      'find the best laptop',
      'https://example.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /extract all matching/i.test(s))).toBe(true);
  });

  test('goal with "then go to" adds direct navigation strategy', () => {
    const strategies = _generateSmartRecovery(
      'search on amazon then go to reddit',
      'https://www.amazon.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /direct URL/i.test(s))).toBe(true);
  });

  test('goal with "also check" adds direct navigation strategy', () => {
    const strategies = _generateSmartRecovery(
      'check amazon also check reddit',
      'https://www.amazon.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /direct URL/i.test(s))).toBe(true);
  });

  test('goal mentioning site not in current URL constructs search URL', () => {
    const strategies = _generateSmartRecovery(
      'search for laptop on amazon',
      'https://www.example.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /amazon\.com\/s\?k=laptop/i.test(s))).toBe(true);
  });

  test('goal mentioning reddit not on reddit constructs search URL', () => {
    const strategies = _generateSmartRecovery(
      'find JS on reddit',
      'https://www.example.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /reddit\.com/i.test(s))).toBe(true);
  });

  test('goal mentioning youtube constructs search URL', () => {
    const strategies = _generateSmartRecovery(
      'look for tutorials on youtube',
      'https://www.example.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /youtube\.com/i.test(s))).toBe(true);
  });

  test('goal mentioning google constructs search URL', () => {
    const strategies = _generateSmartRecovery(
      'search for news on google',
      'https://www.example.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /google\.com/i.test(s))).toBe(true);
  });

  test('long page text adds "already have data" strategy', () => {
    const longText = 'x'.repeat(2000);
    const strategies = _generateSmartRecovery(
      'do something',
      'https://example.com',
      longText, null, [], 1
    );
    expect(strategies.some(s => /already have enough data/i.test(s))).toBe(true);
  });

  test('short page text does not add "already have data" strategy', () => {
    const strategies = _generateSmartRecovery(
      'do something',
      'https://example.com',
      'short text', null, [], 1
    );
    expect(strategies.some(s => /already have enough data/i.test(s))).toBe(false);
  });

  test('handles null currentUrl gracefully', () => {
    const strategies = _generateSmartRecovery('do something', null, '', null, [], 1);
    expect(Array.isArray(strategies)).toBe(true);
    expect(strategies.length).toBeGreaterThan(0);
  });

  test('handles null pageText gracefully', () => {
    const strategies = _generateSmartRecovery('do something', 'https://example.com', null, null, [], 1);
    expect(Array.isArray(strategies)).toBe(true);
  });

  test('site already in URL does not construct duplicate URL', () => {
    const strategies = _generateSmartRecovery(
      'search for laptop on amazon',
      'https://www.amazon.com/s?k=phone',
      '', null, [], 1
    );
    // Should NOT have a navigate directly to amazon strategy because we're already on amazon
    expect(strategies.some(s => /Navigate directly to https:\/\/www\.amazon\.com/i.test(s))).toBe(false);
  });

  test('goal with no search/find/look verb for a site does not construct URL', () => {
    const strategies = _generateSmartRecovery(
      'I like amazon',
      'https://www.example.com',
      '', null, [], 1
    );
    expect(strategies.some(s => /Navigate directly to.*amazon/i.test(s))).toBe(false);
  });
});
