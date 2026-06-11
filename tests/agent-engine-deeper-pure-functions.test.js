// tests/agent-engine-deeper-pure-functions.test.js
// Branch-coverage targeting for pure functions in agent-engine.js
// Focuses on uncovered branches in:
//   detectSignInWall, _isUnproductiveJsResult, _shouldAcceptMemoryWrite,
//   _detectActionTypeLoop, summarizeHistoryBatch, maybeRollupHistory,
//   hasRecentCommitClick, hasPostCommitVerification, detectStall

import { jest } from '@jest/globals';

// ── Chrome API mock ──
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
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
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

// ── Import the real exports ──
const {
  detectSignInWall,
  _isUnproductiveJsResult,
  _shouldAcceptMemoryWrite,
  _detectActionTypeLoop,
  summarizeHistoryBatch,
  maybeRollupHistory,
  hasRecentCommitClick,
  hasPostCommitVerification,
  detectStall,
} = await import('../background/agent-engine.js');

// ══════════════════════════════════════════════════════════════════
// detectSignInWall — branch coverage for element iteration
// ══════════════════════════════════════════════════════════════════
describe('detectSignInWall — branch coverage', () => {
  test('null element in array is skipped (line 2655)', () => {
    const els = [null, { type: 'password', selector: '#pw' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
  });

  test('password type matches directly (line 2656)', () => {
    const els = [{ type: 'text' }, { type: 'password', selector: '#pass' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
    expect(result.evidence).toContain('password input');
  });

  test('selector containing "passwd" matches (line 2658)', () => {
    const els = [{ selector: '#userPasswd' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
  });

  test('selector containing "passwordinput" matches (line 2658)', () => {
    const els = [{ selector: '#passwordInput123' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', '');
    expect(result).toBeTruthy();
  });

  test('email field match path (line 2674-2680)', () => {
    const els = [{ type: 'email', selector: '#loginfmt' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', 'sign in to continue');
    expect(result).toBeTruthy();
    expect(result.evidence).toContain('email/username input');
  });

  test('null element skipped in email field iteration (line 2674)', () => {
    const els = [null, { type: 'email', selector: '#loginfmt' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', 'sign in to continue');
    expect(result).toBeTruthy();
  });

  test('username selector matches in email fallback (line 2677)', () => {
    const els = [{ selector: '#user_name', type: 'text' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', 'log in to your account');
    expect(result).toBeTruthy();
  });

  test('loginfmt selector matches (line 2677)', () => {
    const els = [{ selector: 'input[name="loginfmt"]', type: 'text' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', 'enter your email to sign in');
    expect(result).toBeTruthy();
  });

  test('signin in selector matches (line 2677)', () => {
    const els = [{ selector: '#signin-button', type: 'text' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', 'sign in');
    expect(result).toBeTruthy();
  });

  test('no password AND no email with sign-in text = null', () => {
    const els = [{ type: 'text', selector: '#search' }];
    const result = detectSignInWall(els, 'https://login.microsoftonline.com/tenant', 'sign in to continue');
    expect(result).toBeNull();
  });

  test('email text present but non-auth URL = null', () => {
    const els = [{ type: 'email', selector: '#email' }];
    const result = detectSignInWall(els, 'https://example.com/contact', 'sign in');
    expect(result).toBeNull();
  });

  test('allElements is not array with auth URL + text = null', () => {
    const result = detectSignInWall(null, 'https://login.microsoftonline.com/tenant', 'sign in to continue');
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// _isUnproductiveJsResult — JSON parsed-but-empty branches
// ══════════════════════════════════════════════════════════════════
describe('_isUnproductiveJsResult — JSON empty branches', () => {
  test('null JSON literal is unproductive (line 2719)', () => {
    expect(_isUnproductiveJsResult('JS Result: null')).toBe(true);
  });

  test('empty array is unproductive (line 2720)', () => {
    expect(_isUnproductiveJsResult('JS Result: []')).toBe(true);
  });

  test('empty object is unproductive (line 2721)', () => {
    expect(_isUnproductiveJsResult('JS Result: {}')).toBe(true);
  });

  test('populated array is productive', () => {
    expect(_isUnproductiveJsResult('JS Result: [1,2,3]')).toBe(false);
  });

  test('populated object is productive', () => {
    expect(_isUnproductiveJsResult('JS Result: {"key":"value"}')).toBe(false);
  });

  test('non-string input converts to string', () => {
    // 12345 → "12345" has length 5 which is NOT < 5, so it's productive
    expect(_isUnproductiveJsResult(12345)).toBe(false);
    // but 12 → "12" has length 2 which IS < 5
    expect(_isUnproductiveJsResult(12)).toBe(true);
  });

  test('[object HTMLDivElement] is unproductive', () => {
    expect(_isUnproductiveJsResult('[object HTMLDivElement]')).toBe(true);
  });

  test('[object Object] is unproductive', () => {
    expect(_isUnproductiveJsResult('[object Object]')).toBe(true);
  });

  test('Code execution timed out is unproductive', () => {
    expect(_isUnproductiveJsResult('Code execution timed out after 5000ms')).toBe(true);
  });

  test('Execution error is unproductive', () => {
    expect(_isUnproductiveJsResult('Execution error: Cannot read property of null')).toBe(true);
  });

  test('Done is unproductive', () => {
    expect(_isUnproductiveJsResult('Done')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// _shouldAcceptMemoryWrite — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('_shouldAcceptMemoryWrite — branch coverage', () => {
  test('array value gets serialized via JSON.stringify (line 2817 branch)', () => {
    const result = _shouldAcceptMemoryWrite('test_key', ['item1', 'item2', 'item3'], {});
    expect(result.ok).toBe(true);
  });

  test('object value gets serialized via JSON.stringify (line 2817 branch)', () => {
    const result = _shouldAcceptMemoryWrite('test_key', { nested: 'value', count: 5 }, {});
    expect(result.ok).toBe(true);
  });

  test('duplicate value in different key is rejected (line 2835-2841)', () => {
    const mem = { existing_key: 'some long value text here' };
    const result = _shouldAcceptMemoryWrite('new_key', 'some long value text here', mem);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('duplicates existing key');
  });

  test('same key overwrite is allowed (line 2835 continue branch)', () => {
    const mem = { my_key: 'old long value' };
    const result = _shouldAcceptMemoryWrite('my_key', 'new long value data', mem);
    expect(result.ok).toBe(true);
  });

  test('non-string existing value gets JSON.stringify (line 2838 branch)', () => {
    const mem = { existing_key: { complex: 'object', with: [1, 2, 3] } };
    const result = _shouldAcceptMemoryWrite('new_key', JSON.stringify({ complex: 'object', with: [1, 2, 3] }), mem);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('duplicates');
  });

  test('JS Error shaped value is rejected', () => {
    const result = _shouldAcceptMemoryWrite('key', 'JS Error: Cannot read property', {});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error-shaped value');
  });

  test('Element not found shaped value is rejected', () => {
    const result = _shouldAcceptMemoryWrite('key', 'Element not found: #selector', {});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error-shaped value');
  });

  test('JS execution failed shaped value is rejected', () => {
    const result = _shouldAcceptMemoryWrite('key', 'JS execution failed: CSP blocked', {});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error-shaped value');
  });

  test('empty key returns false', () => {
    expect(_shouldAcceptMemoryWrite('', 'some value', {}).ok).toBe(false);
  });

  test('null key returns false', () => {
    expect(_shouldAcceptMemoryWrite(null, 'some value', {}).ok).toBe(false);
  });

  test('undefined value returns false', () => {
    expect(_shouldAcceptMemoryWrite('key', undefined, {}).ok).toBe(false);
  });

  test('short value returns false', () => {
    expect(_shouldAcceptMemoryWrite('key', 'hi', {}).ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// _detectActionTypeLoop — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('_detectActionTypeLoop — branch coverage', () => {
  test('non-array history returns no loop (line 2919)', () => {
    expect(_detectActionTypeLoop(null).isLoop).toBe(false);
    expect(_detectActionTypeLoop('not an array').isLoop).toBe(false);
  });

  test('fewer than 4 entries returns no loop (line 2919)', () => {
    expect(_detectActionTypeLoop([{}, {}, {}]).isLoop).toBe(false);
  });

  test('entries with missing action produce empty type (line 2921)', () => {
    const history = [
      { action: { type: 'click' } },
      { action: null },
      { action: { type: 'click' } },
      null,
    ];
    // 2 clicks + 2 empty = dominantCount = 2 (below threshold)
    expect(_detectActionTypeLoop(history).isLoop).toBe(false);
  });

  test('dominant count < 3 returns no loop (line 2929)', () => {
    const history = [
      { action: { type: 'click' } },
      { action: { type: 'navigate' } },
      { action: { type: 'click' } },
      { action: { type: 'extract' } },
    ];
    expect(_detectActionTypeLoop(history).isLoop).toBe(false);
  });

  test('dominant type is not in NON_PRODUCTIVE set returns no loop (line 2940)', () => {
    const history = [
      { action: { type: 'note' } },
      { action: { type: 'note' } },
      { action: { type: 'note' } },
      { action: { type: 'note' } },
    ];
    expect(_detectActionTypeLoop(history).isLoop).toBe(false);
  });

  test('entries with null action skipped in productive check (line 2944)', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      null, // null entry -> no productive action
    ];
    // 3 navigates, dominant type is 'navigate' which is NON_PRODUCTIVE
    // null entry skipped in productive check, no productive actions
    const result = _detectActionTypeLoop(history);
    expect(result.isLoop).toBe(true);
    expect(result.type).toBe('navigate');
  });

  test('productive extract with key prevents loop (line 2947)', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'extract', key: 'prices' }, result: 'data' },
    ];
    expect(_detectActionTypeLoop(history).isLoop).toBe(false);
  });

  test('productive execute_js with key prevents loop (line 2948)', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'execute_js', key: 'page_struct', code: '...' }, result: 'ok' },
    ];
    expect(_detectActionTypeLoop(history).isLoop).toBe(false);
  });

  test('4 identical navigate actions = loop (line 2952)', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
    ];
    const result = _detectActionTypeLoop(history);
    expect(result.isLoop).toBe(true);
    expect(result.type).toBe('navigate');
    expect(result.count).toBe(4);
  });

  test('4 identical scroll actions = loop', () => {
    const history = [
      { action: { type: 'scroll' }, result: 'ok' },
      { action: { type: 'scroll' }, result: 'ok' },
      { action: { type: 'scroll' }, result: 'ok' },
      { action: { type: 'scroll' }, result: 'ok' },
    ];
    expect(_detectActionTypeLoop(history).isLoop).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// summarizeHistoryBatch — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('summarizeHistoryBatch — branch coverage', () => {
  test('null batch returns null', () => {
    expect(summarizeHistoryBatch(null)).toBeNull();
  });

  test('empty batch returns null', () => {
    expect(summarizeHistoryBatch([])).toBeNull();
  });

  test('batch with no valid step entries returns null (line 1040)', () => {
    expect(summarizeHistoryBatch([{ action: { type: 'click' }, result: 'ok' }])).toBeNull();
  });

  test('null entry in batch is skipped (line 1047)', () => {
    const batch = [
      { step: 1, action: { type: 'click' }, result: 'ok' },
      null,
      { step: 2, action: { type: 'navigate', url: 'https://example.com' }, result: 'ok' },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result).toBeTruthy();
    expect(result.step).toBe('1-2');
  });

  test('execute_js with key captured in extractedKeys (line 1052)', () => {
    const batch = [
      { step: 1, action: { type: 'execute_js', key: 'page_struct', code: '...' }, result: 'JS Result: 3' },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result).toBeTruthy();
    expect(result.result).toContain('page_struct');
  });

  test('note with text captured (line 1053)', () => {
    const batch = [
      { step: 1, action: { type: 'note', text: 'Found the button at top right' }, result: 'ok' },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result.result).toContain('Found the button');
  });

  test('non-string result handled (line 1054)', () => {
    const batch = [
      { step: 1, action: { type: 'click' }, result: 42 },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result).toBeTruthy();
  });

  test('error result captured as failure (line 1055)', () => {
    const batch = [
      { step: 1, action: { type: 'click' }, result: 'Error: element not found' },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result.result).toContain('Failures');
  });

  test('navigate URL captured', () => {
    const batch = [
      { step: 1, action: { type: 'navigate', url: 'https://portal.example.com' }, result: 'ok' },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result.result).toContain('portal.example.com');
  });

  test('extract key captured', () => {
    const batch = [
      { step: 1, action: { type: 'extract', key: 'ticket_details' }, result: 'extracted' },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result.result).toContain('ticket_details');
  });
});

// ══════════════════════════════════════════════════════════════════
// maybeRollupHistory — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('maybeRollupHistory — branch coverage', () => {
  test('history below threshold is unchanged', () => {
    const history = [
      { step: 1, action: { type: 'click' }, result: 'ok' },
      { step: 2, action: { type: 'navigate' }, result: 'ok' },
    ];
    maybeRollupHistory(history);
    expect(history.length).toBe(2);
  });

  test('history of all summary entries returns unchanged (line 1076)', () => {
    const history = [];
    for (let i = 0; i < 100; i++) {
      history.push({ step: i, action: { type: 'history_summary' }, result: 'summary ' + i });
    }
    maybeRollupHistory(history);
    expect(history.length).toBe(100);
  });

  test('detailed entries below threshold after summary entries returns unchanged (line 1078)', () => {
    const history = [
      { step: 0, action: { type: 'history_summary' }, result: 'rolled up' },
      { step: 1, action: { type: 'click' }, result: 'ok' },
      { step: 2, action: { type: 'navigate' }, result: 'ok' },
    ];
    const originalLength = history.length;
    maybeRollupHistory(history);
    expect(history.length).toBe(originalLength);
  });

  test('summarizeHistoryBatch returning null skips splice (line 1081)', () => {
    // batch with no valid step entries → summarizeHistoryBatch returns null
    const history = [
      { step: 0, action: { type: 'history_summary' }, result: 'rolled up' },
    ];
    for (let i = 1; i <= 60; i++) {
      history.push({ action: { type: 'click' }, result: 'ok' }); // no step
    }
    const originalLength = history.length;
    maybeRollupHistory(history);
    // Should be unchanged since summarizeHistoryBatch returned null
    expect(history.length).toBe(originalLength);
  });
});

// ══════════════════════════════════════════════════════════════════
// hasRecentCommitClick — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('hasRecentCommitClick — branch coverage', () => {
  test('empty history returns false', () => {
    expect(hasRecentCommitClick([])).toBe(false);
  });

  test('null entry is skipped (line 1565)', () => {
    expect(hasRecentCommitClick([null, null, null])).toBe(false);
  });

  test('entry with null action is skipped', () => {
    expect(hasRecentCommitClick([{ action: null }])).toBe(false);
  });

  test('non-click action is skipped', () => {
    expect(hasRecentCommitClick([{ action: { type: 'navigate', url: 'https://save.example.com' } }])).toBe(false);
  });

  test('click_at with commit text detected', () => {
    const history = [
      { action: { type: 'click_at', text: 'Save changes' }, result: 'ok' },
    ];
    expect(hasRecentCommitClick(history)).toBe(true);
  });

  test('click with selector containing save/commit', () => {
    const history = [
      { action: { type: 'click', selector: '#btn-save' }, result: 'ok' },
    ];
    expect(hasRecentCommitClick(history)).toBe(true);
  });

  test('click with description containing commit', () => {
    const history = [
      { action: { type: 'click', description: 'Clicked apply changes button' }, result: 'ok' },
    ];
    expect(hasRecentCommitClick(history)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// hasPostCommitVerification — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('hasPostCommitVerification — branch coverage', () => {
  test('empty history returns false', () => {
    expect(hasPostCommitVerification([])).toBe(false);
  });

  test('null entry is skipped (line 1586)', () => {
    expect(hasPostCommitVerification([null])).toBe(false);
  });

  test('null action entry is skipped', () => {
    expect(hasPostCommitVerification([{ action: null }])).toBe(false);
  });

  test('commit click then read_page = true', () => {
    const history = [
      { action: { type: 'click', text: 'Save' }, result: 'ok' },
      { action: { type: 'read_page' }, result: 'content' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });

  test('commit click then extract = true', () => {
    const history = [
      { action: { type: 'click', text: 'Commit' }, result: 'ok' },
      { action: { type: 'extract', key: 'status' }, result: 'data' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });

  test('commit click then extract_list = true', () => {
    const history = [
      { action: { type: 'click', selector: '#save-btn' }, result: 'ok' },
      { action: { type: 'extract_list', key: 'rows' }, result: 'data' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });

  test('commit click then note = true', () => {
    const history = [
      { action: { type: 'click', text: 'Apply' }, result: 'ok' },
      { action: { type: 'note', text: 'Verified save succeeded' }, result: 'ok' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });

  test('commit click then navigate (not verification) = false', () => {
    const history = [
      { action: { type: 'click', text: 'Save' }, result: 'ok' },
      { action: { type: 'navigate', url: 'https://other.com' }, result: 'ok' },
    ];
    expect(hasPostCommitVerification(history)).toBe(false);
  });

  test('no commit click at all = false', () => {
    const history = [
      { action: { type: 'navigate', url: 'https://example.com' }, result: 'ok' },
      { action: { type: 'read_page' }, result: 'content' },
    ];
    expect(hasPostCommitVerification(history)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// detectStall — additional branches
// ══════════════════════════════════════════════════════════════════
describe('detectStall — branch coverage', () => {
  test('history with mixed actions does not stall on type check', () => {
    const history = [
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
      { action: { type: 'extract' }, result: 'data' },
    ];
    const result = detectStall(history, 0, []);
    expect(result.stalled).toBe(false);
  });

  test('high consecutive failures triggers stall regardless of type', () => {
    const history = [
      { action: { type: 'click' }, result: 'ok' },
    ];
    // Using a high consecutiveFailures value
    const result = detectStall(history, 20, []);
    expect(result.stalled).toBe(true);
    expect(result.reason).toContain('consecutive');
  });
});
