// tests/agent-engine-deep-branches.test.js
// Additional branch coverage for _checkPreFinishCompleteness, _shouldAcceptMemoryWrite,
// _detectActionTypeLoop, _isUnproductiveJsResult

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
  tabs: { query: jest.fn(async () => []), group: jest.fn(async () => 42), ungroup: jest.fn(async () => {}), update: jest.fn(async () => {}), goBack: jest.fn(async () => {}) },
  tabGroups: { update: jest.fn(async () => {}) },
  sidePanel: { setOptions: jest.fn(async () => {}) },
  runtime: {
    sendMessage: jest.fn(async () => {}), onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    onSuspend: { addListener: jest.fn() }, getURL: jest.fn((p) => p),
  },
};

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: jest.fn(async () => ({ type: 'finish', summary: 'done' })),
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
  migrateLegacySettings: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../background/shared-state.js', () => ({
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

const mod = await import('../background/agent-engine.js');
const {
  _shouldAcceptMemoryWrite,
  _checkPreFinishCompleteness,
  _detectActionTypeLoop,
  _isUnproductiveJsResult,
} = mod;

describe('_shouldAcceptMemoryWrite additional branches', () => {
  test('rejects array value', () => {
    expect(_shouldAcceptMemoryWrite('key', [], {}).ok).toBe(false);
  });

  test('rejects empty object value', () => {
    expect(_shouldAcceptMemoryWrite('key', {}, {}).ok).toBe(false);
  });

  test('accepts array with content', () => {
    expect(_shouldAcceptMemoryWrite('key', ['item1', 'item2'], {}).ok).toBe(true);
  });

  test('accepts object with properties', () => {
    expect(_shouldAcceptMemoryWrite('key', { data: 'some useful value here' }, {}).ok).toBe(true);
  });

  test('rejects number value that is too short when stringified', () => {
    expect(_shouldAcceptMemoryWrite('key', 42, {}).ok).toBe(false);
  });

  test('accepts number value stringified > 10 chars', () => {
    expect(_shouldAcceptMemoryWrite('key', 1234567890123, {}).ok).toBe(true);
  });

  test('rejects duplicate value in different key', () => {
    const mem = { other: 'duplicate value string here' };
    expect(_shouldAcceptMemoryWrite('newkey', 'duplicate value string here', mem).ok).toBe(false);
    expect(_shouldAcceptMemoryWrite('newkey', 'duplicate value string here', mem).reason).toContain('duplicates');
  });

  test('allows same value in same key (overwrite)', () => {
    const mem = { key: 'duplicate value string here' };
    expect(_shouldAcceptMemoryWrite('key', 'duplicate value string here', mem).ok).toBe(true);
  });

  test('rejects [object HTMLElement]', () => {
    expect(_shouldAcceptMemoryWrite('key', '[object HTMLElement]', {}).ok).toBe(false);
    expect(_shouldAcceptMemoryWrite('key', '[object HTMLElement]', {}).reason).toBe('non-serialized object');
  });

  test('rejects JS Error prefix', () => {
    expect(_shouldAcceptMemoryWrite('key', 'JS Error: something went wrong in the code', {}).ok).toBe(false);
    expect(_shouldAcceptMemoryWrite('key', 'JS Error: something', {}).reason).toBe('error-shaped value');
  });

  test('rejects Execution error prefix', () => {
    expect(_shouldAcceptMemoryWrite('key', 'Execution error: timeout exceeded', {}).ok).toBe(false);
  });

  test('rejects Code execution timed out prefix', () => {
    expect(_shouldAcceptMemoryWrite('key', 'Code execution timed out after 5s', {}).ok).toBe(false);
  });

  test('rejects Element not found prefix', () => {
    expect(_shouldAcceptMemoryWrite('key', 'Element not found on the page', {}).ok).toBe(false);
  });

  test('rejects JS execution failed prefix', () => {
    expect(_shouldAcceptMemoryWrite('key', 'JS execution failed on selector', {}).ok).toBe(false);
  });

  test('accepts normal valid string', () => {
    expect(_shouldAcceptMemoryWrite('mykey', 'This is a valid result with useful data', {}).ok).toBe(true);
  });

  test('rejects non-string key', () => {
    expect(_shouldAcceptMemoryWrite(123, 'valid value string here', {}).ok).toBe(false);
  });

  test('rejects empty string key', () => {
    expect(_shouldAcceptMemoryWrite('', 'valid value string here', {}).ok).toBe(false);
  });

  test('handles null agentMemory', () => {
    expect(_shouldAcceptMemoryWrite('key', 'valid value string here', null).ok).toBe(true);
  });

  test('handles undefined candidateValue', () => {
    expect(_shouldAcceptMemoryWrite('key', undefined, {}).ok).toBe(false);
  });
});

describe('_checkPreFinishCompleteness additional branches', () => {
  test('returns null for non-string goal', () => {
    expect(_checkPreFinishCompleteness(123, {}, [])).toBeNull();
  });

  test('returns null for empty goal', () => {
    expect(_checkPreFinishCompleteness('', {}, [])).toBeNull();
  });

  test('returns null for null agentMemory', () => {
    expect(_checkPreFinishCompleteness('extract: name, address', null, [])).toBeNull();
  });

  test('returns null when no field list pattern matches', () => {
    expect(_checkPreFinishCompleteness('just do something', { data: 'value' }, [])).toBeNull();
  });

  test('returns null when field list has only 1 field', () => {
    expect(_checkPreFinishCompleteness('extract: name only', { name: 'test value here' }, [])).toBeNull();
  });

  test('detects missing fields when >50% missing', () => {
    const result = _checkPreFinishCompleteness(
      'extract: username, department, location, phone, manager',
      {},  // empty memory
      []
    );
    expect(result).not.toBeNull();
    expect(result).toContain('missing token-evidence');
  });

  test('returns null when <50% fields missing', () => {
    const result = _checkPreFinishCompleteness(
      'extract: username, department, location, phone, manager',
      { username: 'john doe value here', department: 'engineering dept here', location: 'office building here' },  // 3 of 5 found
      []
    );
    expect(result).toBeNull();
  });

  test('finds evidence in note actions', () => {
    const history = [
      { action: { type: 'note', text: 'Found username is john doe and department is engineering and location is NYC' } },
    ];
    const result = _checkPreFinishCompleteness(
      'extract: username, department, location, phone, manager',
      {},  // memory is empty
      history
    );
    // username, department, location found in notes; phone, manager missing (40% missing < 50%)
    expect(result).toBeNull();
  });

  test('ignores history entries without note type', () => {
    const history = [
      { action: { type: 'click', text: 'clicking a button' } },
      { action: { type: 'navigate', text: 'going somewhere' } },
    ];
    const result = _checkPreFinishCompleteness(
      'extract: username, department, location, phone, manager',
      {},
      history
    );
    expect(result).not.toBeNull();
  });

  test('splits field list on "and"', () => {
    const result = _checkPreFinishCompleteness(
      'extract: the CVE ID and CVSS score and FortiOS versions and affected devices',
      {},
      []
    );
    expect(result).not.toBeNull();
  });

  test('splits field list on "&"', () => {
    const result = _checkPreFinishCompleteness(
      'extract: hostname & IP address & serial number & firmware',
      {},
      []
    );
    expect(result).not.toBeNull();
  });

  test('skips filler words in field names', () => {
    // "the" is a filler word and gets stripped
    const result = _checkPreFinishCompleteness(
      'extract: the CVE identifier, the affected versions, the patch status, the severity score',
      {},
      []
    );
    // These should still be detected as missing
    expect(result).not.toBeNull();
  });

  test('filters out too-short field names (<4 chars)', () => {
    // Single short fields get filtered out
    const result = _checkPreFinishCompleteness(
      'extract: a, b, c',  // all < 4 chars
      {},
      []
    );
    // rawFields would be empty after filtering, so < 2, returns null
    expect(result).toBeNull();
  });
});

describe('_detectActionTypeLoop additional branches', () => {
  test('returns isLoop for 3+ non-productive same-type actions', () => {
    const history = [
      { action: { type: 'navigate' } },
      { action: { type: 'navigate' } },
      { action: { type: 'navigate' } },
      { action: { type: 'navigate' } },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(true);
    expect(result.type).toBe('navigate');
  });

  test('returns not-loop when productive action present', () => {
    const history = [
      { action: { type: 'navigate' } },
      { action: { type: 'navigate' } },
      { action: { type: 'navigate' } },
      { action: { type: 'note' } },  // productive
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(false);
  });

  test('returns not-loop for extract with key', () => {
    const history = [
      { action: { type: 'click' } },
      { action: { type: 'click' } },
      { action: { type: 'click' } },
      { action: { type: 'extract', key: 'data' } },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(false);
  });

  test('returns not-loop for execute_js with key', () => {
    const history = [
      { action: { type: 'scroll' } },
      { action: { type: 'scroll' } },
      { action: { type: 'scroll' } },
      { action: { type: 'execute_js', key: 'result' } },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(false);
  });

  test('returns not-loop when dominant type is productive', () => {
    const history = [
      { action: { type: 'extract', key: 'd1' } },
      { action: { type: 'extract', key: 'd2' } },
      { action: { type: 'extract', key: 'd3' } },
      { action: { type: 'extract', key: 'd4' } },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(false);
  });

  test('returns not-loop for too-short history', () => {
    expect(_detectActionTypeLoop([{ action: { type: 'navigate' } }], {}).isLoop).toBe(false);
  });

  test('returns not-loop for null history', () => {
    expect(_detectActionTypeLoop(null, {}).isLoop).toBe(false);
  });

  test('returns not-loop for empty history', () => {
    expect(_detectActionTypeLoop([], {}).isLoop).toBe(false);
  });

  test('handles history entries with missing action', () => {
    const history = [
      { action: { type: 'click' } },
      { action: { type: 'click' } },
      null,
      { action: { type: 'click' } },
    ];
    const result = _detectActionTypeLoop(history, {});
    expect(result.isLoop).toBe(true);
  });

  test('handles entries without type', () => {
    const history = [
      { action: {} },
      { action: {} },
      { action: {} },
      { action: {} },
    ];
    const result = _detectActionTypeLoop(history, {});
    // Empty string type would be dominant, but empty string is in NON_PRODUCTIVE
    expect(result.isLoop).toBe(false); // dominantCount < 3 because type '' isn't in NON_PRODUCTIVE
  });
});

describe('_isUnproductiveJsResult additional branches', () => {
  test('returns true for boolean true', () => {
    expect(_isUnproductiveJsResult(true)).toBe(true);
  });

  test('returns false for boolean false (not null)', () => {
    // false is not null, gets stringified to "false" which is 5 chars, still < 5 minimum but not "Done" or error
    // Actually String(false) = "false" which is 5 chars, so trim.length < 5 is false, and it's not any special string
    expect(_isUnproductiveJsResult(false)).toBe(false);
  });

  test('returns true for number', () => {
    expect(_isUnproductiveJsResult(42)).toBe(true);
  });

  test('returns true for empty string', () => {
    expect(_isUnproductiveJsResult('')).toBe(true);
  });

  test('returns true for "Done"', () => {
    expect(_isUnproductiveJsResult('Done')).toBe(true);
  });

  test('returns true for "JS Error:"', () => {
    expect(_isUnproductiveJsResult('JS Error: null reference')).toBe(true);
  });

  test('returns true for "Execution error:"', () => {
    expect(_isUnproductiveJsResult('Execution error: timeout')).toBe(true);
  });

  test('returns true for "Code execution timed out"', () => {
    expect(_isUnproductiveJsResult('Code execution timed out after 5000ms')).toBe(true);
  });

  test('returns true for "undefined"', () => {
    expect(_isUnproductiveJsResult('undefined')).toBe(true);
  });

  test('returns true for "null"', () => {
    expect(_isUnproductiveJsResult('null')).toBe(true);
  });

  test('returns true for "[object Object]"', () => {
    expect(_isUnproductiveJsResult('[object Object]')).toBe(true);
  });

  test('returns true for parsed null', () => {
    expect(_isUnproductiveJsResult('JS Result: null')).toBe(true);
  });

  test('returns true for parsed empty array', () => {
    expect(_isUnproductiveJsResult('JS Result: []')).toBe(true);
  });

  test('returns true for parsed empty object', () => {
    expect(_isUnproductiveJsResult('JS Result: {}')).toBe(true);
  });

  test('returns false for valid result string', () => {
    expect(_isUnproductiveJsResult('JS Result: found 42 devices')).toBe(false);
  });

  test('returns true for short result', () => {
    expect(_isUnproductiveJsResult('abc')).toBe(true);
  });

  test('returns false for long enough result', () => {
    expect(_isUnproductiveJsResult('This is a valid result with enough characters')).toBe(false);
  });

  test('returns false for valid JSON array with data', () => {
    expect(_isUnproductiveJsResult('JS Result: [{"name":"test","value":"data"}]')).toBe(false);
  });

  test('returns false for valid JSON object with data', () => {
    expect(_isUnproductiveJsResult('JS Result: {"count":5}')).toBe(false);
  });
});
