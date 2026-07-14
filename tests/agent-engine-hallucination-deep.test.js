// tests/agent-engine-hallucination-deep.test.js
// Deep coverage of evaluateHallucinationRisk, _countSummaryClaims, _countSpecificClaims,
// _countSourceTags, detectSignInWall, and detectMfaInText edge cases.

import { jest } from '@jest/globals';

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
  tabs: { query: jest.fn(async () => [{ id: 1 }]), group: jest.fn(async () => 42), ungroup: jest.fn(async () => {}) },
  tabGroups: { update: jest.fn(async () => {}) },
  sidePanel: { setOptions: jest.fn(async () => {}) },
  runtime: {
    sendMessage: jest.fn(async () => {}),
    onMessage: { addListener: jest.fn((fn) => { onMessageListeners.push(fn); }), removeListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
};

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
  parseVisionResponse: jest.fn((raw) => { try { return JSON.parse(raw); } catch { return null; } }),
  generatePlan: jest.fn(async () => ['Step 1']),
  supportsVision: jest.fn(() => true), getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []), estimateCostUsd: jest.fn(() => 0), isSimpleStep: jest.fn(() => false),
  selectModelForStep: jest.fn(() => null),
  getCostTracker: jest.fn(() => ({ totalCalls: 0, byTier: { light: 0, default: 0, heavy: 0 }, estimatedCost: '0.0000' }))
}));
jest.unstable_mockModule('../background/platforms/index.js', () => ({ getPlatformProfile: jest.fn(() => null) }));
jest.unstable_mockModule('../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}), waitForPageReady: jest.fn(async () => {}),
  injectContentScript: jest.fn(async () => {}), sendMessageWithRetry: jest.fn(async () => ({})),
  takeScreenshot: jest.fn(async () => 'data:image/png;base64,abc'), isValidUrl: jest.fn(() => true),
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
  detachAllDebuggees: jest.fn(async () => {}), cdpDispatchClick: jest.fn(async () => {}),
  cdpDispatchType: jest.fn(async () => {}), cdpDispatchKey: jest.fn(async () => {}),
  cdpExecuteJs: jest.fn(async () => ({ ok: true, value: 'test' })),
  readConsoleMessages: jest.fn(async () => []), readNetworkRequests: jest.fn(async () => []),
}));
jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendSilentUpdate: jest.fn(), sendActionMessage: jest.fn(), sendActionResult: jest.fn(),
  sendReportUpdate: jest.fn(), sendPageContext: jest.fn(), sendTabStateUpdate: jest.fn(),
  sendScreenshotUpdate: jest.fn(), sendAgentActivity: jest.fn(), sendAgentStepStart: jest.fn(),
  sendAgentStatus: jest.fn(), sendHeartbeat: jest.fn(), sendPlanPreview: jest.fn(),
  sendClientKnowledgePreview: jest.fn(), sendCostUpdate: jest.fn(),
}));
jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: jest.fn(async () => '## Report'), buildFallbackReport: jest.fn(() => '## Fallback Report'),
}));
jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => ({ endpoint: 'https://api.test.com', apiKey: 'key', model: 'test' })),
  getTextProvider: jest.fn(async () => null),
  migrateLegacySettings: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../background/shared-state.js', () => ({
  onAgentCompletion: jest.fn(() => () => {}),
  emitAgentCompletion: jest.fn(),
  isSPATransitionPending: jest.fn(() => false), clearSPATransition: jest.fn(),
  notifyIfEnabled: jest.fn(async () => {}), startSwKeepalive: jest.fn(), stopSwKeepalive: jest.fn(),
}));
jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => null), setActiveTab: jest.fn(), getTabContext: jest.fn(() => null),
  getAllTabContexts: jest.fn(() => []), openTab: jest.fn(async () => 2), switchToTab: jest.fn(async () => {}),
  closeTab: jest.fn(async () => {}), closeAllAgentTabs: jest.fn(async () => {}), updateSnapshot: jest.fn(),
  resetAllContexts: jest.fn(), findTabByLabel: jest.fn(() => null), registerInitialTab: jest.fn(),
  handleTabRemoved: jest.fn(), getTabCount: jest.fn(() => 0),
}));
jest.unstable_mockModule('../background/client-knowledge.js', () => ({
  getClientStartupContext: jest.fn(async () => ({ client: null, relevantEntries: [], promptSection: '' })),
  markRunCompleted: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: jest.fn(async () => ({ adapted: false })),
}));
jest.unstable_mockModule('../background/audit-log.js', () => ({
  appendAuditEntry: jest.fn(async () => {}), getAuditLog: jest.fn(async () => []), auditLogToCsv: jest.fn(() => ''),
}));
jest.unstable_mockModule('../background/skills/index.js', () => ({
  runRecoverySkills: jest.fn(async () => null), getSkillStats: jest.fn(() => ({})),
}));
jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(), endRun: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })), suggestRetryActions: jest.fn(() => []),
}));

const {
  evaluateHallucinationRisk,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags,
  detectSignInWall,
  detectMfaInText,
} = await import('../background/agent-engine.js');

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSummaryClaims', () => {
  test('null returns 0', () => {
    expect(_countSummaryClaims(null)).toBe(0);
  });

  test('undefined returns 0', () => {
    expect(_countSummaryClaims(undefined)).toBe(0);
  });

  test('non-string returns 0', () => {
    expect(_countSummaryClaims(12345)).toBe(0);
  });

  test('empty string returns 0', () => {
    expect(_countSummaryClaims('')).toBe(0);
  });

  test('single numbered item', () => {
    expect(_countSummaryClaims('1. First item')).toBe(1);
  });

  test('multiple numbered items', () => {
    expect(_countSummaryClaims('1. First\n2. Second\n3. Third')).toBe(3);
  });

  test('numbered items with parentheses', () => {
    expect(_countSummaryClaims('1) First\n2) Second')).toBe(2);
  });

  test('markdown heading numbered items', () => {
    expect(_countSummaryClaims('## 1. First\n## 2. Second')).toBe(2);
  });

  test('bullet items with dash', () => {
    expect(_countSummaryClaims('- Item A\n- Item B\n- Item C')).toBe(3);
  });

  test('bullet items with asterisk', () => {
    expect(_countSummaryClaims('* Item A\n* Item B')).toBe(2);
  });

  test('table rows counted minus header and separator', () => {
    const table = '| Header 1 | Header 2 |\n|---|---|\n| Data 1 | Data 2 |\n| Data 3 | Data 4 |';
    expect(_countSummaryClaims(table)).toBe(2);
  });

  test('table with only header rows returns 0', () => {
    const table = '| Header 1 | Header 2 |\n|---|---|';
    expect(_countSummaryClaims(table)).toBe(0);
  });

  test('returns max of numbered/bullets/table', () => {
    // 3 numbered > 1 bullet
    expect(_countSummaryClaims('1. A\n2. B\n3. C\n- One bullet')).toBe(3);
  });

  test('no recognizable patterns returns 0', () => {
    expect(_countSummaryClaims('Just some plain text without lists')).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSpecificClaims', () => {
  test('null returns 0', () => {
    expect(_countSpecificClaims(null)).toBe(0);
  });

  test('undefined returns 0', () => {
    expect(_countSpecificClaims(undefined)).toBe(0);
  });

  test('empty string returns 0', () => {
    expect(_countSpecificClaims('')).toBe(0);
  });

  test('number with comma: 1,234', () => {
    expect(_countSpecificClaims('Revenue was 1,234 units')).toBe(1);
  });

  test('large number: 110,000', () => {
    expect(_countSpecificClaims('Over 110,000 records')).toBe(1);
  });

  test('percentage: 47%', () => {
    expect(_countSpecificClaims('Growth of 47%')).toBe(1);
  });

  test('decimal percentage: 15.5%', () => {
    expect(_countSpecificClaims('Rate is 15.5%')).toBe(1);
  });

  test('dollar amount: $5M', () => {
    expect(_countSpecificClaims('Cost: $5M')).toBe(1);
  });

  test('dollar amount: $12,345 matches dollar + number patterns', () => {
    // $12,345 matches dollar pattern AND 12,345 matches number-comma pattern
    expect(_countSpecificClaims('Total of $12,345')).toBeGreaterThanOrEqual(2);
  });

  test('ISO date: 2024-01-15 matches date + number', () => {
    // 2024-01-15 matches ISO date pattern, AND 2024 matches large-number pattern
    expect(_countSpecificClaims('Date: 2024-01-15')).toBeGreaterThanOrEqual(2);
  });

  test('Month date: January 15, 2024 matches', () => {
    const count = _countSpecificClaims('Published January 15, 2024');
    // Matches month-date pattern AND 2024 matches the comma-number pattern
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('Month date without year: March 3', () => {
    expect(_countSpecificClaims('Updated March 3')).toBe(1);
  });

  test('multiple specific claims in one text', () => {
    const text = 'Revenue of $5M, 47% growth, 1,234 users, dates 2024-01-15';
    const count = _countSpecificClaims(text);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('no specific claims returns 0', () => {
    expect(_countSpecificClaims('Just a normal sentence without numbers')).toBe(0);
  });

  test('dollar billion', () => {
    expect(_countSpecificClaims('Valued at $1.5 billion')).toBe(1);
  });

  test('dollar thousand', () => {
    expect(_countSpecificClaims('Cost of $500 thousand')).toBe(1);
  });

  test('dollar K', () => {
    expect(_countSpecificClaims('$25K budget')).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSourceTags', () => {
  test('null returns 0', () => {
    expect(_countSourceTags(null)).toBe(0);
  });

  test('undefined returns 0', () => {
    expect(_countSourceTags(undefined)).toBe(0);
  });

  test('empty string returns 0', () => {
    expect(_countSourceTags('')).toBe(0);
  });

  test('single src tag', () => {
    expect(_countSourceTags('Result [src:memory_key] here')).toBe(1);
  });

  test('multiple src tags', () => {
    expect(_countSourceTags('[src:key1] and [src:key2] and [src:key3]')).toBe(3);
  });

  test('src tag with hyphen', () => {
    expect(_countSourceTags('[src:my-key_name]')).toBe(1);
  });

  test('src tag case insensitive', () => {
    expect(_countSourceTags('[SRC:KEY]')).toBe(1);
  });

  test('unverified tag', () => {
    expect(_countSourceTags('Data [unverified] here')).toBe(1);
  });

  test('unverified case insensitive', () => {
    expect(_countSourceTags('Data [UNVERIFIED] here')).toBe(1);
  });

  test('mixed src and unverified tags', () => {
    expect(_countSourceTags('[src:k1] [unverified] [src:k2]')).toBe(3);
  });

  test('no tags returns 0', () => {
    expect(_countSourceTags('No tags in this text')).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('evaluateHallucinationRisk — edge cases', () => {
  test('null summary is not risky', () => {
    const result = evaluateHallucinationRisk(null, {}, []);
    expect(result.risky).toBe(false);
  });

  test('undefined summary is not risky', () => {
    const result = evaluateHallucinationRisk(undefined, {}, []);
    expect(result.risky).toBe(false);
  });

  test('risky: 5+ specific claims, 0 source tags', () => {
    const summary = 'Revenue $5M, growth 47%, users 110,000, date 2024-01-15, loss $12,345';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('specific claims');
    expect(result.reason).toContain('[src:memory_key]');
  });

  test('risky: 8+ specific claims with too few source tags', () => {
    const summary = 'Revenue $5M, cost $2B, growth 47%, users 1,234, date 2024-01-15, loss $12K, March 5 2024, rate 15.5% [src:one]';
    const result = evaluateHallucinationRisk(summary, { key: 'val' }, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('specific claims');
    expect(result.reason).toContain('source tags');
  });

  test('not risky: specific claims with enough source tags', () => {
    const summary = 'Revenue $5M [src:rev], growth 47% [src:growth], users 1,234 [src:users]';
    const result = evaluateHallucinationRisk(summary, { rev: 'data' }, []);
    expect(result.risky).toBe(false);
    expect(result.specificClaims).toBeGreaterThanOrEqual(3);
    expect(result.sourceTags).toBeGreaterThanOrEqual(3);
  });

  test('risky: claims > 2x evidence no caveats (exactly 4 claims, 1 evidence)', () => {
    const summary = '1. A\n2. B\n3. C\n4. D';
    const result = evaluateHallucinationRisk(summary, { k: 'v' }, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('4 items but only 1 evidence');
  });

  test('not risky: claims > 2x evidence but WITH caveats', () => {
    const summary = '1. A\n2. B\n3. C\n4. D\n5. E (headline only)';
    const result = evaluateHallucinationRisk(summary, { k: 'v' }, []);
    expect(result.risky).toBe(false);
    expect(result.hasCaveats).toBe(true);
  });

  test('returns claims count on non-risky result', () => {
    const result = evaluateHallucinationRisk('1. Item', { k: 'v' }, []);
    expect(result.claims).toBe(1);
    expect(result.evidence).toBe(1);
  });

  test('history notes count as evidence', () => {
    const history = [
      { action: { type: 'note' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'note' }, result: 'ok' },
    ];
    const result = evaluateHallucinationRisk('1. A\n2. B', { k: 'v' }, history);
    expect(result.evidence).toBe(3); // 1 memory key + 2 notes
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('detectSignInWall — edge cases', () => {
  test('invalid URL returns null', () => {
    const result = detectSignInWall([], 'not-a-url', '');
    expect(result).toBeNull();
  });

  test('password field via selector containing "passwd"', () => {
    const elements = [{ type: 'text', selector: '#passwdField' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
  });

  test('password field via selector containing "passwordinput"', () => {
    const elements = [{ type: 'text', selector: '#passwordinput' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
  });

  test('null element in array is skipped', () => {
    const elements = [null, { type: 'password', selector: '#pw' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
  });

  test('empty selector on password type still matches', () => {
    const elements = [{ type: 'password', selector: '' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
  });

  test('non-array elements does not crash', () => {
    const result = detectSignInWall('not-array', 'https://login.microsoftonline.com/tenant', 'sign in');
    expect(result).toBeNull();
  });

  test('Google sign-in URL matches', () => {
    const elements = [{ type: 'password', selector: '#pass' }];
    const result = detectSignInWall(elements, 'https://accounts.google.com/signin', '');
    expect(result).toBeTruthy();
    expect(result.host).toContain('accounts.google.com');
  });

  test('Okta sign-in URL matches', () => {
    const elements = [{ type: 'password', selector: '#okta-password' }];
    const result = detectSignInWall(elements, 'https://example.okta.com/signin', '');
    expect(result).toBeTruthy();
  });

  test('GitHub login URL matches', () => {
    const elements = [{ type: 'password', selector: '#password' }];
    const result = detectSignInWall(elements, 'https://github.com/login', '');
    expect(result).toBeTruthy();
  });

  test('Salesforce login URL matches', () => {
    const elements = [{ type: 'password', selector: '#pw' }];
    const result = detectSignInWall(elements, 'https://login.salesforce.com/', '');
    expect(result).toBeTruthy();
  });

  test('email field with sign-in text cue on auth host', () => {
    const elements = [{ type: 'email', selector: '#email' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Please sign in');
    expect(result).toBeTruthy();
    expect(result.evidence).toContain('email/username input');
  });

  test('username field via selector containing "username"', () => {
    const elements = [{ type: 'text', selector: '#username-input' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'sign in to continue');
    expect(result).toBeTruthy();
  });

  test('selector with "signin" triggers email path', () => {
    const elements = [{ type: 'text', selector: '#signin-email' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Sign in');
    expect(result).toBeTruthy();
  });

  test('text cue without matching elements returns null', () => {
    const elements = [{ type: 'text', selector: '#search' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Please sign in to continue');
    expect(result).toBeNull();
  });

  test('empty URL returns null', () => {
    expect(detectSignInWall([], '', '')).toBeNull();
  });

  test('selector matching "loginfmt" triggers email path', () => {
    const elements = [{ type: 'text', selector: '#loginfmt' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/', 'Sign in');
    expect(result).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('detectMfaInText — edge cases', () => {
  test('text longer than 5000 chars still works (only samples first 5000)', () => {
    const longText = 'A'.repeat(4000) + ' We\'ve sent a verification code to your device';
    expect(detectMfaInText(longText)).toBeTruthy();
  });

  test('MFA cue past 5000 char boundary may be missed', () => {
    // Tier-1 cue at position > 5000 — function only samples first 5000 chars
    const longText = 'A'.repeat(5100) + 'approve the sign in request';
    // This should be null since it's past the 5000 sample
    expect(detectMfaInText(longText)).toBeNull();
  });

  test('push notification sent triggers MFA', () => {
    expect(detectMfaInText('Push notification sent to your device')).toBeTruthy();
  });

  test('security key plugged in triggers MFA', () => {
    expect(detectMfaInText('security key plugged in to your device')).toBeTruthy();
  });

  test('waiting for approval triggers MFA', () => {
    expect(detectMfaInText('Status: waiting for approval')).toBeTruthy();
  });

  test('6-digit code verification triggers MFA (tier-2)', () => {
    // This is tier-2, need 2+ or auth URL
    expect(detectMfaInText('Enter the 6-digit code from your authenticator app', 'https://login.okta.com/verify')).toBeTruthy();
  });

  test('check your phone triggers MFA (tier-2 + auth URL)', () => {
    expect(detectMfaInText('Please check your phone for the code', 'https://accounts.google.com/signin')).toBeTruthy();
  });

  test('OTP triggers MFA (tier-2 + auth URL)', () => {
    expect(detectMfaInText('Enter your OTP to continue', 'https://login.microsoftonline.com/')).toBeTruthy();
  });

  test('excluded domain: eBay', () => {
    expect(detectMfaInText('Verify your identity', 'https://www.ebay.com/itm/12345')).toBeNull();
  });

  test('excluded domain: Reddit', () => {
    expect(detectMfaInText('Two-factor authentication settings', 'https://www.reddit.com/r/test')).toBeNull();
  });

  test('excluded domain: LinkedIn', () => {
    expect(detectMfaInText('Verify your identity', 'https://www.linkedin.com/in/someone')).toBeNull();
  });

  test('excluded domain: product page', () => {
    expect(detectMfaInText('Security verification needed', 'https://www.walmart.com/ip/product')).toBeNull();
  });

  test('excluded domain: news article', () => {
    expect(detectMfaInText('Two-factor authentication recommended', 'https://example.com/news/article')).toBeNull();
  });

  test('excluded domain: blog', () => {
    expect(detectMfaInText('Authenticator app review', 'https://example.com/blog/post')).toBeNull();
  });

  test('single tier-2 cue without auth URL returns null', () => {
    // Only one tier-2 match, no auth URL -> not enough to fire
    expect(detectMfaInText('Please verify your identity to continue')).toBeNull();
  });

  test('verification code sent triggers MFA (tier-2)', () => {
    expect(detectMfaInText('Verification code was sent to your email', 'https://login.microsoftonline.com/')).toBeTruthy();
  });

  test('enter verification code (tier-2 + auth URL)', () => {
    expect(detectMfaInText('Enter the verification code below', 'https://login.microsoftonline.com/')).toBeTruthy();
  });
});
