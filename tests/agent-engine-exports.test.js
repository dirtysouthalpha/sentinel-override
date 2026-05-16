// tests/agent-engine-exports.test.js
// Tests for the ACTUAL exported functions from background/agent-engine.js.
// Uses jest.unstable_mockModule for all heavy dependencies so we import the
// real module code but with mocked side effects.

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
const sessionData = {};
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
    session: {
      set: jest.fn(async () => {}),
    },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
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
      addListener: jest.fn((fn) => { onMessageListeners.push(fn); }),
      removeListener: jest.fn(),
    },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
};

// ── Mock all heavy dependencies ──
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

// ── Import the real exports ──
const {
  detectMfaInText,
  detectSignInWall,
  shouldLockoutCrossTenantAction,
  evaluateHallucinationRisk,
  _isUnproductiveJsResult,
  _shouldAcceptMemoryWrite,
  _checkPreFinishCompleteness,
  _detectActionTypeLoop,
  generateHeuristicPlan,
  formatTicketOutput,
  formatTicketFinalNotes,
  formatTicketKickoff,
  formatWaitingOnClient,
  formatWaitingOnVendor,
  formatItGlueKb,
  formatClientEmail,
  summarizeHistoryBatch,
  maybeRollupHistory,
  detectStall,
  isConfigChangeGoal,
  hasRecentCommitClick,
  hasPostCommitVerification,
  _detectGoalModeDirective,
  _autoPickFormat,
  extractTicketNumber,
  isTicketInvestigationGoal,
  captureReportData,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags,
  _tenantsMatch,
  resetAgentState,
} = await import('../background/agent-engine.js');

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  Object.keys(sessionData).forEach(k => delete sessionData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
describe('detectMfaInText', () => {
  test('tier-1: "approve sign in request" triggers MFA', () => {
    expect(detectMfaInText('Please approve your sign in request on your phone')).toBeTruthy();
  });

  test('tier-1: "authenticator app" triggers MFA', () => {
    expect(detectMfaInText('Open your authenticator app and enter the code')).toBeTruthy();
  });

  test('tier-1: "duo push" triggers MFA', () => {
    expect(detectMfaInText('Waiting for Duo push to your device')).toBeTruthy();
  });

  test('tier-1: "verification code sent to" triggers MFA', () => {
    expect(detectMfaInText("We've sent a verification code to your email")).toBeTruthy();
  });

  test('tier-1: "tap the number you see" triggers MFA', () => {
    expect(detectMfaInText('Tap the number you see on your screen to approve')).toBeTruthy();
  });

  test('tier-2 + auth URL triggers MFA', () => {
    const result = detectMfaInText(
      'Please verify your identity to continue',
      'https://login.microsoftonline.com/tenant/oauth2/authorize'
    );
    expect(result).toBeTruthy();
  });

  test('2+ tier-2 cues without auth URL triggers MFA', () => {
    const text = 'Verify your identity using two-factor authentication on your authenticator app';
    expect(detectMfaInText(text)).toBeTruthy();
  });

  test('excluded domain: amazon returns null', () => {
    expect(detectMfaInText('Enter your verification code', 'https://www.amazon.com/gp/cart/')).toBeNull();
  });

  test('excluded domain: youtube returns null', () => {
    expect(detectMfaInText('Verify your identity', 'https://www.youtube.com/watch?v=abc')).toBeNull();
  });

  test('excluded domain: blog returns null', () => {
    expect(detectMfaInText('two-factor authentication is important', 'https://example.com/blog/post')).toBeNull();
  });

  test('null input returns null', () => {
    expect(detectMfaInText(null)).toBeNull();
  });

  test('empty string input returns null', () => {
    expect(detectMfaInText('')).toBeNull();
  });

  test('non-string input returns null', () => {
    expect(detectMfaInText(12345)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('detectSignInWall', () => {
  test('password field on Microsoft login triggers wall', () => {
    const elements = [{ type: 'password', selector: '#passwordInput' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/tenant/login', '');
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain('password input');
  });

  test('email field + text cue on Google triggers wall', () => {
    const elements = [{ type: 'email', selector: '#loginfmt' }];
    const result = detectSignInWall(elements, 'https://accounts.google.com/signin', 'Use your Microsoft account to sign in');
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain('email/username input');
  });

  test('non-auth URL returns null', () => {
    const elements = [{ type: 'password', selector: '#pw' }];
    expect(detectSignInWall(elements, 'https://example.com/login', '')).toBeNull();
  });

  test('null URL returns null', () => {
    expect(detectSignInWall([], null, '')).toBeNull();
  });

  test('auth URL with no matching elements returns null', () => {
    expect(detectSignInWall([], 'https://login.microsoftonline.com/tenant', '')).toBeNull();
  });

  test('password field via selector containing "password" triggers wall', () => {
    const elements = [{ type: 'text', selector: '#passwordField' }];
    const result = detectSignInWall(elements, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('shouldLockoutCrossTenantAction', () => {
  test('non-modifying action returns null', () => {
    expect(shouldLockoutCrossTenantAction({ type: 'read_page' }, 'https://admin.microsoft.com', {}, 'contoso')).toBeNull();
  });

  test('no expected tenant returns null', () => {
    expect(shouldLockoutCrossTenantAction({ type: 'click' }, 'https://admin.microsoft.com', {}, '')).toBeNull();
  });

  test('non-Microsoft URL returns null', () => {
    expect(shouldLockoutCrossTenantAction({ type: 'click' }, 'https://example.com', {}, 'contoso')).toBeNull();
  });

  test('tenant mismatch returns lockout info', () => {
    const result = shouldLockoutCrossTenantAction(
      { type: 'click' },
      'https://admin.microsoft.com/adminportal',
      { chipText: 'fabrikam', onmicrosoft: 'fabrikam.onmicrosoft.com', tid: 'aaa' },
      'contoso'
    );
    expect(result).toBeTruthy();
    expect(result.expected).toBe('contoso');
    expect(result.host).toContain('microsoft.com');
    expect(result.actionType).toBe('click');
  });

  test('tenant match returns null', () => {
    const result = shouldLockoutCrossTenantAction(
      { type: 'click' },
      'https://admin.microsoft.com/adminportal',
      { chipText: 'Contoso Ltd', onmicrosoft: 'contoso.onmicrosoft.com', tid: '123' },
      'contoso'
    );
    expect(result).toBeNull();
  });

  test('null command returns null', () => {
    expect(shouldLockoutCrossTenantAction(null, 'https://admin.microsoft.com', {}, 'contoso')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('evaluateHallucinationRisk', () => {
  test('risky: 3+ claims, 0 evidence', () => {
    const summary = '1. Found A\n2. Found B\n3. Found C';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('3');
  });

  test('risky: claims > 2x evidence, no caveats', () => {
    const summary = '1. A\n2. B\n3. C\n4. D\n5. E';
    const result = evaluateHallucinationRisk(summary, { key1: 'val' }, []);
    expect(result.risky).toBe(true);
  });

  test('not risky: few claims with evidence', () => {
    const summary = '1. Found issue\n2. Fixed issue';
    const result = evaluateHallucinationRisk(summary, { data: 'x' }, []);
    expect(result.risky).toBe(false);
    expect(result.claims).toBe(2);
  });

  test('not risky with caveats', () => {
    const summary = '1. Found A (headline only)\n2. Found B (not read in this run)\n3. Found C (unverified)\n4. Found D\n5. Found E';
    const result = evaluateHallucinationRisk(summary, { key1: 'val' }, []);
    // With caveats, the claims > 2x evidence check is bypassed
    expect(result.risky).toBe(false);
    expect(result.hasCaveats).toBe(true);
  });

  test('risky: many specific claims with no source tags', () => {
    const summary = 'Found 1,234 issues, cost $5M, dates 2024-01-15, 47% increase, 110,000 records, $12,345 loss';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('specific claims');
  });

  test('empty summary is not risky', () => {
    expect(evaluateHallucinationRisk('', {}, []).risky).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_isUnproductiveJsResult', () => {
  test('null returns true', () => {
    expect(_isUnproductiveJsResult(null)).toBe(true);
  });

  test('undefined returns true', () => {
    expect(_isUnproductiveJsResult(undefined)).toBe(true);
  });

  test('empty string returns true', () => {
    expect(_isUnproductiveJsResult('')).toBe(true);
  });

  test('"Done" returns true', () => {
    expect(_isUnproductiveJsResult('Done')).toBe(true);
  });

  test('JS Error returns true', () => {
    expect(_isUnproductiveJsResult('JS Error: something broke')).toBe(true);
  });

  test('"[object Object]" returns true', () => {
    expect(_isUnproductiveJsResult('[object Object]')).toBe(true);
  });

  test('"undefined" returns true', () => {
    expect(_isUnproductiveJsResult('undefined')).toBe(true);
  });

  test('"null" returns true', () => {
    expect(_isUnproductiveJsResult('null')).toBe(true);
  });

  test('empty array JSON returns true', () => {
    expect(_isUnproductiveJsResult('[]')).toBe(true);
  });

  test('empty object JSON returns true', () => {
    expect(_isUnproductiveJsResult('{}')).toBe(true);
  });

  test('short string under 5 chars returns true', () => {
    expect(_isUnproductiveJsResult('abc')).toBe(true);
  });

  test('productive result returns false', () => {
    expect(_isUnproductiveJsResult('The page shows a login form with two fields')).toBe(false);
  });

  test('JS Result prefix with productive value returns false', () => {
    expect(_isUnproductiveJsResult('JS Result: Successfully extracted data')).toBe(false);
  });

  test('Code execution timed out returns true', () => {
    expect(_isUnproductiveJsResult('Code execution timed out after 5s')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_shouldAcceptMemoryWrite', () => {
  test('empty key is rejected', () => {
    expect(_shouldAcceptMemoryWrite('', 'some value', {}).ok).toBe(false);
    expect(_shouldAcceptMemoryWrite(null, 'value', {}).ok).toBe(false);
  });

  test('null value is rejected', () => {
    expect(_shouldAcceptMemoryWrite('key1', null, {}).ok).toBe(false);
  });

  test('short value is rejected', () => {
    expect(_shouldAcceptMemoryWrite('key1', 'short', {}).ok).toBe(false);
  });

  test('error-shaped value is rejected', () => {
    expect(_shouldAcceptMemoryWrite('key1', 'JS Error: something went wrong in the extraction', {}).ok).toBe(false);
  });

  test('[object Object] value is rejected', () => {
    expect(_shouldAcceptMemoryWrite('key1', '[object Object] with more text here', {}).ok).toBe(false);
  });

  test('duplicate value is rejected', () => {
    const mem = { existingKey: 'this is a long enough value for testing' };
    expect(_shouldAcceptMemoryWrite('newKey', 'this is a long enough value for testing', mem).ok).toBe(false);
  });

  test('good value is accepted', () => {
    const result = _shouldAcceptMemoryWrite('key1', 'This is a sufficiently long and useful value', {});
    expect(result.ok).toBe(true);
  });

  test('accepts array value', () => {
    const result = _shouldAcceptMemoryWrite('key1', ['item1', 'item2', 'item3', 'item4', 'item5'], {});
    expect(result.ok).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_checkPreFinishCompleteness', () => {
  test('null goal returns null', () => {
    expect(_checkPreFinishCompleteness(null, { key: 'val' }, [])).toBeNull();
  });

  test('no memory returns null', () => {
    expect(_checkPreFinishCompleteness('extract CVE ID and CVSS score', null, [])).toBeNull();
  });

  test('goal with field list, missing evidence returns gap description', () => {
    const goal = 'extract the CVE ID, CVSS v3 base score, affected FortiOS versions for each entry';
    const result = _checkPreFinishCompleteness(goal, { otherStuff: 'yes' }, []);
    // More than half of the fields should be missing
    expect(result).not.toBeNull();
    expect(result).toContain('missing');
  });

  test('all fields present returns null', () => {
    const goal = 'extract the CVE identifier, CVSS v3 base score for each entry';
    const memory = { cve_data: 'CVE-2024-1234 CVSS 9.8 score base' };
    const result = _checkPreFinishCompleteness(goal, memory, []);
    expect(result).toBeNull();
  });

  test('less than half missing returns null', () => {
    const goal = 'extract the CVE identifier, CVSS v3 base score, affected versions for each entry';
    const memory = { cve: 'CVE-2024-1234', score: 'CVSS 9.8', versions: 'FortiOS 7.6' };
    const result = _checkPreFinishCompleteness(goal, memory, []);
    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_detectActionTypeLoop', () => {
  test('empty history returns isLoop false', () => {
    const result = _detectActionTypeLoop([], {});
    expect(result.isLoop).toBe(false);
  });

  test('short history returns isLoop false', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(false);
  });

  test('3+ same non-productive type with no productive actions is a loop', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'not found' },
      { action: { type: 'navigate' }, result: 'not found' },
      { action: { type: 'navigate' }, result: 'not found' },
      { action: { type: 'navigate' }, result: 'not found' },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(true);
    expect(result.type).toBe('navigate');
    expect(result.count).toBe(4);
  });

  test('productive actions present returns isLoop false', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'note', text: 'found it', key: 'data' }, result: 'ok' },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(false);
  });

  test('click type can be a loop', () => {
    const history = [
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(true);
    expect(result.type).toBe('click');
  });

  test('productive extract with key breaks loop detection', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'extract', key: 'data' }, result: 'ok' },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('generateHeuristicPlan', () => {
  test('null goal returns null', () => {
    expect(generateHeuristicPlan(null)).toBeNull();
  });

  test('URL in goal produces navigate-based plan', () => {
    const plan = generateHeuristicPlan('Go to https://example.com and extract data');
    expect(plan).toBeTruthy();
    expect(Array.isArray(plan)).toBe(true);
    expect(plan[0]).toContain('Navigate to https://example.com');
  });

  test('search query produces search-based plan', () => {
    const plan = generateHeuristicPlan('Search for "best practices for network security in 2024"');
    expect(plan).toBeTruthy();
    expect(plan[0]).toContain('Search Google for');
  });

  test('multi-page pattern produces multi-step plan', () => {
    const plan = generateHeuristicPlan('Summarize all the top 5 articles about cybersecurity');
    expect(plan).toBeTruthy();
    expect(plan.length).toBeGreaterThan(4);
    expect(plan.some(s => s.includes('article'))).toBe(true);
  });

  test('generic goal produces fallback plan', () => {
    const plan = generateHeuristicPlan('Just figure out what is going on with this thing');
    expect(plan).toBeTruthy();
    expect(plan.length).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('detectStall', () => {
  const stallConfig = { similarityWindow: 3, maxConsecutiveFailures: 5 };

  test('no stall with varied successful actions', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'click' }, result: 'clicked' },
      { action: { type: 'extract' }, result: 'extracted data' },
    ];
    const result = detectStall(history, 0, []);
    expect(result.stalled).toBe(false);
  });

  test('repeated same failures triggers stall', () => {
    const history = [
      { action: { type: 'click', selector: '#btn' }, result: 'Element not found' },
      { action: { type: 'click', selector: '#btn' }, result: 'Element not found' },
      { action: { type: 'click', selector: '#btn' }, result: 'Element not found' },
    ];
    const result = detectStall(history, 3, []);
    expect(result.stalled).toBe(true);
    expect(result.recoveryAction).toBe('RESCAN_AND_REPLAN');
  });

  test('high consecutive failures triggers stall', () => {
    const history = [
      { action: { type: 'click' }, result: 'Error: timeout' },
    ];
    const result = detectStall(history, 5, []);
    expect(result.stalled).toBe(true);
    expect(result.recoveryAction).toBe('FORCE_STRATEGY_SHIFT');
  });

  test('short history does not trigger repeated-failure stall', () => {
    const history = [
      { action: { type: 'click' }, result: 'Element not found' },
    ];
    const result = detectStall(history, 0, []);
    expect(result.stalled).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('isConfigChangeGoal', () => {
  test('config change goal on platform URL returns true', () => {
    expect(isConfigChangeGoal('Update the firewall rule on SonicWall', 'https://192.168.1.1/sonicos')).toBe(true);
  });

  test('config change goal with platform in goal text returns true', () => {
    expect(isConfigChangeGoal('Create a new policy in SonicWall NSv', 'https://example.com')).toBe(true);
  });

  test('no change verb returns false', () => {
    expect(isConfigChangeGoal('Check the firewall status on SonicWall', 'https://192.168.1.1/sonicos')).toBe(false);
  });

  test('no platform returns false', () => {
    expect(isConfigChangeGoal('Update the configuration on my router', 'https://example.com')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('hasRecentCommitClick', () => {
  test('commit click by selector returns true', () => {
    const history = [
      { action: { type: 'click', selector: '#save-btn' }, result: 'ok' },
    ];
    expect(hasRecentCommitClick(history)).toBe(true);
  });

  test('commit click by result text returns true', () => {
    const history = [
      { action: { type: 'click', selector: '#foo' }, result: 'changes saved successfully' },
    ];
    expect(hasRecentCommitClick(history)).toBe(true);
  });

  test('no commit click returns false', () => {
    const history = [
      { action: { type: 'click', selector: '#cancel' }, result: 'cancelled' },
      { action: { type: 'navigate' }, result: 'ok' },
    ];
    expect(hasRecentCommitClick(history)).toBe(false);
  });

  test('empty history returns false', () => {
    expect(hasRecentCommitClick([])).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('hasPostCommitVerification', () => {
  test('verification after commit returns true', () => {
    const history = [
      { action: { type: 'click', selector: '#save-btn' }, result: 'saved' },
      { action: { type: 'read_page' }, result: 'page content' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });

  test('no verification after commit returns false', () => {
    const history = [
      { action: { type: 'click', selector: '#save-btn' }, result: 'saved' },
      { action: { type: 'click', selector: '#next' }, result: 'ok' },
    ];
    expect(hasPostCommitVerification(history)).toBe(false);
  });

  test('commit but no subsequent actions returns false', () => {
    const history = [
      { action: { type: 'click', selector: '#apply' }, result: 'ok' },
    ];
    expect(hasPostCommitVerification(history)).toBe(false);
  });

  test('note action after commit counts as verification', () => {
    const history = [
      { action: { type: 'click', selector: '#submit' }, result: 'submitted' },
      { action: { type: 'note', text: 'Verified change applied' }, result: 'ok' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });

  test('extract action after commit counts as verification', () => {
    const history = [
      { action: { type: 'click', selector: '#deploy' }, result: 'deployed' },
      { action: { type: 'extract', key: 'status' }, result: 'extracted' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_detectGoalModeDirective', () => {
  test('"Mode: APPROVAL" detected with high confidence', () => {
    const result = _detectGoalModeDirective('Mode: APPROVAL\nInvestigate ticket #123');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
    expect(result.confidence).toBe('high');
  });

  test('"Mode: AUTONOMOUS" detected with high confidence', () => {
    const result = _detectGoalModeDirective('Mode: AUTONOMOUS\nRun all steps without pausing');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
    expect(result.confidence).toBe('high');
  });

  test('"Mode: YOLO" detected as autonomous', () => {
    const result = _detectGoalModeDirective('Mode: YOLO\ndo everything');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('"approval mode" phrasing detected', () => {
    const result = _detectGoalModeDirective('Run this in approval mode please');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
    expect(result.confidence).toBe('high');
  });

  test('"autonomous mode" phrasing detected', () => {
    const result = _detectGoalModeDirective('Execute this in autonomous mode');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('"agent pauses for approval" phrasing detected', () => {
    const result = _detectGoalModeDirective('The agent pauses for approval before making changes');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
  });

  test('null goal returns not detected', () => {
    expect(_detectGoalModeDirective(null).detected).toBe(false);
  });

  test('no directive returns not detected', () => {
    expect(_detectGoalModeDirective('Investigate ticket #123 and report findings').detected).toBe(false);
  });

  test('"no approvals required" implies autonomous', () => {
    const result = _detectGoalModeDirective('Execute all steps autonomously, no approvals required');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_autoPickFormat', () => {
  test('vendor text picks WAITING_ON_VENDOR', () => {
    expect(_autoPickFormat('Waiting on vendor response', '')).toBe('WAITING_ON_VENDOR');
  });

  test('client text picks WAITING_ON_CLIENT', () => {
    expect(_autoPickFormat('Waiting on client to respond', '')).toBe('WAITING_ON_CLIENT');
  });

  test('KB text picks IT_GLUE_KB', () => {
    expect(_autoPickFormat('Creating a KB article', 'Document this in IT Glue')).toBe('IT_GLUE_KB');
  });

  test('email text picks CLIENT_EMAIL', () => {
    expect(_autoPickFormat('Draft an email to the client', '')).toBe('CLIENT_EMAIL');
  });

  test('kickoff text picks TICKET_KICKOFF', () => {
    expect(_autoPickFormat('Investigate this ticket kickoff', '')).toBe('TICKET_KICKOFF');
  });

  test('default picks FINAL_NOTES', () => {
    expect(_autoPickFormat('The investigation found several issues.', '')).toBe('FINAL_NOTES');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('extractTicketNumber', () => {
  test('with hash: "ticket #12345" returns 12345', () => {
    expect(extractTicketNumber('Investigate ticket #12345')).toBe('12345');
  });

  test('without hash: "ticket 67890" returns 67890', () => {
    expect(extractTicketNumber('Investigate ticket 67890')).toBe('67890');
  });

  test('bare hash: "#45678" returns 45678', () => {
    expect(extractTicketNumber('#45678')).toBe('45678');
  });

  test('no number returns empty string', () => {
    expect(extractTicketNumber('Investigate this issue')).toBe('');
  });

  test('null returns empty string', () => {
    expect(extractTicketNumber(null)).toBe('');
  });

  test('incident number: "incident #12345" returns 12345', () => {
    expect(extractTicketNumber('Resolve incident #12345')).toBe('12345');
  });

  test('too short number (2 digits) returns empty', () => {
    expect(extractTicketNumber('ticket #12')).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('isTicketInvestigationGoal', () => {
  test('ticket goal returns true', () => {
    expect(isTicketInvestigationGoal('Investigate ticket #12345')).toBe(true);
  });

  test('incident goal returns true', () => {
    expect(isTicketInvestigationGoal('Resolve incident #67890')).toBe(true);
  });

  test('threat hunt goal returns true', () => {
    expect(isTicketInvestigationGoal('Threat hunt for suspicious activity')).toBe(true);
  });

  test('SentinelOne goal returns true', () => {
    expect(isTicketInvestigationGoal('Check SentinelOne alerts')).toBe(true);
  });

  test('non-ticket goal returns false', () => {
    expect(isTicketInvestigationGoal('Find the best pizza nearby')).toBe(false);
  });

  test('null returns false', () => {
    expect(isTicketInvestigationGoal(null)).toBe(false);
  });

  test('non-string returns false', () => {
    expect(isTicketInvestigationGoal(42)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSummaryClaims', () => {
  test('numbered list counts correctly', () => {
    expect(_countSummaryClaims('1. First\n2. Second\n3. Third')).toBe(3);
  });

  test('bulleted list counts correctly', () => {
    expect(_countSummaryClaims('- First\n- Second\n- Third')).toBe(3);
  });

  test('table rows count correctly', () => {
    const table = '| Header |\n| --- |\n| Row1 |\n| Row2 |';
    const result = _countSummaryClaims(table);
    expect(result).toBeGreaterThan(0);
  });

  test('empty string returns 0', () => {
    expect(_countSummaryClaims('')).toBe(0);
  });

  test('null returns 0', () => {
    expect(_countSummaryClaims(null)).toBe(0);
  });

  test('plain text with no list returns 0', () => {
    expect(_countSummaryClaims('Just a plain paragraph with no lists.')).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSpecificClaims', () => {
  test('counts numbers with commas', () => {
    expect(_countSpecificClaims('Found 1,234 issues and 5,678 alerts')).toBeGreaterThanOrEqual(2);
  });

  test('counts percentages', () => {
    expect(_countSpecificClaims('Increased by 47% and 15.5%')).toBeGreaterThanOrEqual(2);
  });

  test('counts dollar amounts', () => {
    expect(_countSpecificClaims('Cost $5M and $12,345 total')).toBeGreaterThanOrEqual(2);
  });

  test('counts ISO dates', () => {
    expect(_countSpecificClaims('Dates 2024-01-15 and 2024-06-30')).toBeGreaterThanOrEqual(2);
  });

  test('empty string returns 0', () => {
    expect(_countSpecificClaims('')).toBe(0);
  });

  test('null returns 0', () => {
    expect(_countSpecificClaims(null)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSourceTags', () => {
  test('counts [src:*] tags', () => {
    expect(_countSourceTags('[src:alert_data] and [src:log_entries]')).toBe(2);
  });

  test('counts [unverified] tags', () => {
    expect(_countSourceTags('[unverified] claim and [unverified] other')).toBe(2);
  });

  test('mixed tags count correctly', () => {
    expect(_countSourceTags('[src:data] [unverified] [src:logs]')).toBe(3);
  });

  test('no tags returns 0', () => {
    expect(_countSourceTags('No tags here')).toBe(0);
  });

  test('null returns 0', () => {
    expect(_countSourceTags(null)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_tenantsMatch', () => {
  test('matching tenants returns true', () => {
    const detected = { chipText: 'Contoso Ltd', onmicrosoft: 'contoso.onmicrosoft.com', tid: '123' };
    expect(_tenantsMatch(detected, 'contoso')).toBe(true);
  });

  test('mismatching tenants returns false', () => {
    const detected = { chipText: 'Fabrikam Inc', onmicrosoft: 'fabrikam.onmicrosoft.com', tid: '456' };
    expect(_tenantsMatch(detected, 'contoso')).toBe(false);
  });

  test('empty expected returns true (no lock)', () => {
    expect(_tenantsMatch({ chipText: 'Test' }, '')).toBe(true);
  });

  test('null expected returns true', () => {
    expect(_tenantsMatch({ chipText: 'Test' }, null)).toBe(true);
  });

  test('no detected tenant returns false', () => {
    expect(_tenantsMatch(null, 'contoso')).toBe(false);
  });

  test('partial match via includes returns true', () => {
    const detected = { chipText: 'Contoso Subsidiary', onmicrosoft: 'sub.contoso.com', tid: '' };
    expect(_tenantsMatch(detected, 'contoso')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('captureReportData', () => {
  test('returns expected structure', () => {
    const history = [{ step: 1, action: { type: 'click' }, result: 'ok' }];
    const memory = { key1: 'value1' };
    const plan = ['Step 1', 'Step 2'];
    const data = captureReportData('my goal', history, memory, plan, 5, 10);
    expect(data.goal).toBe('my goal');
    expect(data.stepCount).toBe(5);
    expect(data.apiCallCount).toBe(10);
    expect(data.history).toHaveLength(1);
    expect(data.agentMemory).toEqual({ key1: 'value1' });
    expect(data.agentPlan).toEqual(['Step 1', 'Step 2']);
  });

  test('null plan yields null agentPlan', () => {
    const data = captureReportData('goal', [], {}, null, 0, 0);
    expect(data.agentPlan).toBeNull();
  });

  test('history is a copy (not the same reference)', () => {
    const history = [{ step: 1 }];
    const data = captureReportData('g', history, {}, null, 0, 0);
    expect(data.history).not.toBe(history);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('summarizeHistoryBatch', () => {
  test('empty history returns null', () => {
    expect(summarizeHistoryBatch([])).toBeNull();
  });

  test('null input returns null', () => {
    expect(summarizeHistoryBatch(null)).toBeNull();
  });

  test('mixed actions produce summary with action counts', () => {
    const batch = [
      { step: 1, action: { type: 'navigate', url: 'https://example.com' }, result: 'ok' },
      { step: 2, action: { type: 'click' }, result: 'ok' },
      { step: 3, action: { type: 'extract', key: 'data' }, result: 'ok' },
      { step: 4, action: { type: 'note', text: 'Important finding about the issue' }, result: 'ok' },
    ];
    const summary = summarizeHistoryBatch(batch);
    expect(summary).toBeTruthy();
    expect(summary.action.type).toBe('history_summary');
    expect(summary.result).toContain('navigate');
    expect(summary.result).toContain('extract');
    expect(summary.step).toBe('1-4');
  });

  test('entries with failures include failure info', () => {
    const batch = [
      { step: 1, action: { type: 'click' }, result: 'Error: element not found' },
      { step: 2, action: { type: 'click' }, result: 'Error: timed out again' },
    ];
    const summary = summarizeHistoryBatch(batch);
    expect(summary.result).toContain('Failures');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('maybeRollupHistory', () => {
  test('short history does not roll up', () => {
    const history = [];
    for (let i = 0; i < 10; i++) {
      history.push({ step: i, action: { type: 'navigate' }, result: 'ok' });
    }
    const lenBefore = history.length;
    maybeRollupHistory(history);
    expect(history.length).toBe(lenBefore);
  });

  test('long history triggers rollup', () => {
    const history = [];
    for (let i = 0; i < 50; i++) {
      history.push({ step: i, action: { type: 'navigate' }, result: 'ok' });
    }
    maybeRollupHistory(history);
    // After rollup, history should be shorter than the original 50
    expect(history.length).toBeLessThan(50);
    // First entry should be a summary
    expect(history[0].action.type).toBe('history_summary');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('ticket formatting functions', () => {
  const tech = {
    name: 'Brandon Goolsby',
    title: 'IT Support Technician',
    company: 'Premier Networx',
    phone: '706-426-6313',
    email: 'support@augustaitguys.com',
  };

  describe('formatTicketFinalNotes', () => {
    test('produces formatted output with tech info', () => {
      const result = formatTicketFinalNotes('Found the root cause. DNS was misconfigured.', 'Ticket #12345', tech);
      expect(result).toContain('Brandon Goolsby');
      expect(result).toContain('Premier Networx');
      expect(result).toContain('Ticket #12345');
      expect(result).toContain('Action Taken');
      expect(result).toContain('Next Step');
    });

    test('partial summary triggers investigation-in-progress framing', () => {
      const result = formatTicketFinalNotes('Extraction failed, data is incomplete.', 'Ticket #99999', tech);
      expect(result).toContain('Investigation Notes (partial)');
      expect(result).toContain('Manual review required');
    });

    test('empty summary uses default action taken', () => {
      const result = formatTicketFinalNotes('', 'Ticket #11111', tech);
      expect(result).toContain('Investigation completed via Sentinel Override agent');
    });
  });

  describe('formatTicketKickoff', () => {
    test('produces kickoff format with MAIN ISSUE', () => {
      const result = formatTicketKickoff('Ran diagnostics on the server.', 'Investigate ticket #55555', tech);
      expect(result).toContain('MAIN ISSUE');
      expect(result).toContain('WHAT HAS BEEN TRIED');
      expect(result).toContain('FASTEST SAFE RESOLUTION PATH');
      expect(result).toContain('Ticket #55555');
    });

    test('empty summary provides placeholder tried steps', () => {
      const result = formatTicketKickoff('', 'ticket #44444', tech);
      expect(result).toContain('Pending technician input');
    });
  });

  describe('formatWaitingOnClient', () => {
    test('produces waiting on client format', () => {
      const result = formatWaitingOnClient('Sent email to client.', 'Ticket #33333', tech);
      expect(result).toContain('Waiting on Client');
      expect(result).toContain('Action Taken');
      expect(result).toContain('Follow up by');
      expect(result).toContain('Brandon Goolsby');
    });
  });

  describe('formatWaitingOnVendor', () => {
    test('produces waiting on vendor format', () => {
      const result = formatWaitingOnVendor('Opened vendor case for RMA.', 'Ticket #22222', tech);
      expect(result).toContain('Waiting on Vendor');
      expect(result).toContain('Vendor case opened');
      expect(result).toContain('Brandon Goolsby');
    });
  });

  describe('formatItGlueKb', () => {
    test('produces KB format with environment detection', () => {
      const result = formatItGlueKb(
        '1. Reset the password\n2. Verified login works',
        'Reset M365 password for user in Microsoft Entra',
        tech
      );
      expect(result).toContain('IT Glue Knowledge Base Entry');
      expect(result).toContain('Title');
      expect(result).toContain('Environment');
      expect(result).toContain('Microsoft 365 / Entra ID');
      expect(result).toContain('Resolution Steps');
    });

    test('detects SonicWall environment', () => {
      const result = formatItGlueKb('Did a thing.', 'Configure SonicWall firewall rules', tech);
      expect(result).toContain('Firewall');
    });
  });

  describe('formatClientEmail', () => {
    test('produces email format with subject and body', () => {
      const result = formatClientEmail('The issue has been fully resolved.', 'Ticket #12345 - VPN not connecting', tech);
      expect(result).toContain('Client Email');
      expect(result).toContain('Subject:');
      expect(result).toContain('Resolved:');
      expect(result).toContain('Hello [Client Name]');
      expect(result).toContain('706-426-6313');
    });
  });

  describe('formatTicketOutput', () => {
    test('auto format picks the right template', () => {
      const result = formatTicketOutput('auto', 'Waiting on vendor response.', 'Ticket #111', tech);
      // auto should pick WAITING_ON_VENDOR based on the summary
      expect(result).toContain('Waiting on Vendor');
    });

    test('explicit TICKET_KICKOFF format', () => {
      const result = formatTicketOutput('TICKET_KICKOFF', 'summary text', 'ticket #222', tech);
      expect(result).toContain('Ticket Kickoff');
    });

    test('FINAL_NOTES format as default', () => {
      const result = formatTicketOutput('FINAL_NOTES', 'Fixed it.', 'ticket #333', tech);
      expect(result).toContain('Final Notes');
    });

    test('CLIENT_EMAIL format', () => {
      const result = formatTicketOutput('CLIENT_EMAIL', 'Done.', 'ticket #444', tech);
      expect(result).toContain('Client Email');
    });

    test('IT_GLUE_KB format', () => {
      const result = formatTicketOutput('IT_GLUE_KB', 'Step 1. Did thing', 'Create KB', tech);
      expect(result).toContain('IT Glue Knowledge Base Entry');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('resetAgentState (smoke test)', () => {
  test('does not throw', () => {
    expect(() => resetAgentState()).not.toThrow();
  });

  test('is idempotent', () => {
    resetAgentState();
    expect(() => resetAgentState()).not.toThrow();
  });
});
