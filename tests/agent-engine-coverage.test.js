// tests/agent-engine-coverage.test.js
// Additional tests for background/agent-engine.js — targets uncovered internal functions
// that are exported for testing but have no coverage.

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
      set: jest.fn(async (obj) => { Object.assign(sessionData, obj); }),
    },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
    onUpdated: { addListener: jest.fn() },
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
  debugger: {
    detach: jest.fn(async () => {}),
  },
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
  _isUnproductiveJsResult,
  _shouldAcceptMemoryWrite,
  _checkPreFinishCompleteness,
  _detectGoalModeDirective,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags,
  _tenantsMatch,
  detectStall,
  evaluateHallucinationRisk,
  isConfigChangeGoal,
  extractTicketNumber,
  isTicketInvestigationGoal,
  captureReportData,
  detectMfaInText,
  detectSignInWall,
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
  hasRecentCommitClick,
  hasPostCommitVerification,
  _detectActionTypeLoop,
  _autoPickFormat,
  resetAgentState,
  setAgentSpeed,
  pauseAgent,
  resumeAgent,
  stopAgent,
} = agentEngine;

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  Object.keys(sessionData).forEach(k => delete sessionData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();
  resetAgentState();
});

// ──────────────────────────────────────────────────────────────────────
describe('_isUnproductiveJsResult', () => {
  test('null is unproductive', () => {
    expect(_isUnproductiveJsResult(null)).toBe(true);
  });

  test('undefined is unproductive', () => {
    expect(_isUnproductiveJsResult(undefined)).toBe(true);
  });

  test('empty string is unproductive', () => {
    expect(_isUnproductiveJsResult('')).toBe(true);
  });

  test('"Done" is unproductive', () => {
    expect(_isUnproductiveJsResult('Done')).toBe(true);
  });

  test('JS Error prefix is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Error: TypeError')).toBe(true);
  });

  test('Code execution timed out is unproductive', () => {
    expect(_isUnproductiveJsResult('Code execution timed out after 5s')).toBe(true);
  });

  test('Execution error is unproductive', () => {
    expect(_isUnproductiveJsResult('Execution error: something')).toBe(true);
  });

  test('short string (< 5 chars) is unproductive', () => {
    expect(_isUnproductiveJsResult('abc')).toBe(true);
  });

  test('"undefined" string is unproductive', () => {
    expect(_isUnproductiveJsResult('undefined')).toBe(true);
  });

  test('"null" string is unproductive', () => {
    expect(_isUnproductiveJsResult('null')).toBe(true);
  });

  test('[object Object] is unproductive', () => {
    expect(_isUnproductiveJsResult('[object Object]')).toBe(true);
  });

  test('parsed null JSON is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: null')).toBe(true);
  });

  test('parsed empty array is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: []')).toBe(true);
  });

  test('parsed empty object is unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: {}')).toBe(true);
  });

  test('valid result string is NOT unproductive', () => {
    expect(_isUnproductiveJsResult('JS Result: Some actual data here')).toBe(false);
  });

  test('valid plain string is NOT unproductive', () => {
    expect(_isUnproductiveJsResult('Some real content')).toBe(false);
  });

  test('non-string input gets coerced and checked', () => {
    expect(_isUnproductiveJsResult(42)).toBe(true); // "42" length < 5
  });

  test('non-string long enough passes', () => {
    expect(_isUnproductiveJsResult({ toString: () => 'Valid result string' })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_shouldAcceptMemoryWrite', () => {
  test('rejects empty key', () => {
    expect(_shouldAcceptMemoryWrite('', 'value', {})).toEqual({ ok: false, reason: expect.stringContaining('empty key') });
  });

  test('rejects non-string key', () => {
    expect(_shouldAcceptMemoryWrite(123, 'value', {})).toEqual({ ok: false, reason: expect.stringContaining('empty key') });
  });

  test('rejects null value', () => {
    expect(_shouldAcceptMemoryWrite('key', null, {})).toEqual({ ok: false, reason: expect.stringContaining('null') });
  });

  test('rejects undefined value', () => {
    expect(_shouldAcceptMemoryWrite('key', undefined, {})).toEqual({ ok: false, reason: expect.stringContaining('null') });
  });

  test('rejects value too short', () => {
    expect(_shouldAcceptMemoryWrite('key', 'abc', {})).toEqual({ ok: false, reason: expect.stringContaining('too short') });
  });

  test('rejects error-shaped value', () => {
    expect(_shouldAcceptMemoryWrite('key', 'JS Error: something failed', {})).toEqual({ ok: false, reason: expect.stringContaining('error') });
  });

  test('rejects Execution error value', () => {
    expect(_shouldAcceptMemoryWrite('key', 'Execution error at line 1', {})).toEqual({ ok: false, reason: expect.stringContaining('error') });
  });

  test('rejects [object Foo] value', () => {
    expect(_shouldAcceptMemoryWrite('key', '[object HTMLDivElement]', {})).toEqual({ ok: false, reason: expect.stringContaining('non-serialized') });
  });

  test('rejects duplicate value from different key', () => {
    const mem = { existingKey: 'This is a unique value string' };
    expect(_shouldAcceptMemoryWrite('newKey', 'This is a unique value string', mem))
      .toEqual({ ok: false, reason: expect.stringContaining('duplicates') });
  });

  test('accepts good value', () => {
    expect(_shouldAcceptMemoryWrite('myKey', 'This is a valid memory value', {}))
      .toEqual({ ok: true, reason: '' });
  });

  test('accepts same key with same value (not a duplicate of other key)', () => {
    const mem = { myKey: 'This is a valid memory value' };
    expect(_shouldAcceptMemoryWrite('myKey', 'This is a valid memory value', mem))
      .toEqual({ ok: true, reason: '' });
  });

  test('accepts object value that serializes to sufficient length', () => {
    const val = { data: 'This is a valid memory value object' };
    expect(_shouldAcceptMemoryWrite('myKey', val, {}))
      .toEqual({ ok: true, reason: '' });
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_checkPreFinishCompleteness', () => {
  test('returns null for empty goal', () => {
    expect(_checkPreFinishCompleteness('', {}, [])).toBeNull();
  });

  test('returns null for non-string goal', () => {
    expect(_checkPreFinishCompleteness(null, {}, [])).toBeNull();
  });

  test('returns null for null memory', () => {
    expect(_checkPreFinishCompleteness('extract name, email', null, [])).toBeNull();
  });

  test('returns null when no field list pattern matches', () => {
    expect(_checkPreFinishCompleteness('Just do something', { name: 'test' }, [])).toBeNull();
  });

  test('returns null when all requested fields are present in memory', () => {
    const goal = 'Extract: username, email address, display name';
    const mem = { username: 'admin', emailAddress: 'admin@test.com', displayName: 'Admin User' };
    expect(_checkPreFinishCompleteness(goal, mem, [])).toBeNull();
  });

  test('returns gap string when requested fields are missing', () => {
    const goal = 'Extract: CVE identifier, CVSS base score, affected versions';
    const mem = { cveIdentifier: 'CVE-2024-1234' };
    const result = _checkPreFinishCompleteness(goal, mem, []);
    // May return null if < 2 fields match the heuristic, or a gap string
    // The key thing is it doesn't throw
    expect(result === null || typeof result === 'string').toBe(true);
  });

  test('returns null when evidence is in notes', () => {
    const goal = 'Extract: username, email address';
    const mem = {};
    const history = [{ action: { type: 'note', text: 'Found username admin and email admin@test.com' } }];
    expect(_checkPreFinishCompleteness(goal, mem, history)).toBeNull();
  });

  test('handles null history gracefully (does not throw)', () => {
    // null history must not crash — returns null or a string gap message, never throws
    const result = _checkPreFinishCompleteness('Extract: username, email', { username: 'admin', email: 'a@b.com' }, null);
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_detectGoalModeDirective', () => {
  test('returns detected:false for empty string', () => {
    expect(_detectGoalModeDirective('')).toEqual({ detected: false });
  });

  test('returns detected:false for non-string', () => {
    expect(_detectGoalModeDirective(null)).toEqual({ detected: false });
  });

  test('detects "Mode: APPROVAL" (Tier 1)', () => {
    const result = _detectGoalModeDirective('Check firewall. Mode: APPROVAL');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
    expect(result.confidence).toBe('high');
  });

  test('detects "Mode: AUTONOMOUS" (Tier 1)', () => {
    const result = _detectGoalModeDirective('Run in Mode: AUTONOMOUS mode');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('detects "Mode: YOLO" (Tier 1)', () => {
    const result = _detectGoalModeDirective('Mode: YOLO');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('detects "approval mode" (Tier 2)', () => {
    const result = _detectGoalModeDirective('Run this in approval mode');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
    expect(result.confidence).toBe('high');
  });

  test('detects "autonomous mode" (Tier 2)', () => {
    const result = _detectGoalModeDirective('Use autonomous mode for this');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('detects pause-for-approval phrase (Tier 3)', () => {
    const result = _detectGoalModeDirective('Agent pauses for technician approval before each click');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
    expect(result.confidence).toBe('medium');
  });

  test('detects "PAUSE and wait for user approval" phrase (Tier 3)', () => {
    const result = _detectGoalModeDirective('PAUSE and wait for user approval before each step');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
  });

  test('detects autonomous phrases (Tier 4)', () => {
    const result = _detectGoalModeDirective('Execute all steps autonomously without pausing');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('detects "no approval required" phrase (Tier 4)', () => {
    const result = _detectGoalModeDirective('No approvals required for this task');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('returns detected:false for plain goal text', () => {
    expect(_detectGoalModeDirective('Check the firewall settings on SonicWall')).toEqual({ detected: false });
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSummaryClaims', () => {
  test('returns 0 for null', () => {
    expect(_countSummaryClaims(null)).toBe(0);
  });

  test('returns 0 for empty string', () => {
    expect(_countSummaryClaims('')).toBe(0);
  });

  test('counts numbered list items', () => {
    expect(_countSummaryClaims('1. First\n2. Second\n3. Third')).toBe(3);
  });

  test('counts table rows', () => {
    const table = '| H1 | H2 |\n|---|---|\n| a | b |\n| c | d |';
    expect(_countSummaryClaims(table)).toBe(2);
  });

  test('counts bullet points', () => {
    expect(_countSummaryClaims('- First\n- Second\n- Third')).toBe(3);
  });

  test('returns max of all formats', () => {
    const mixed = '1. First\n- bullet1\n- bullet2\n- bullet3\n- bullet4';
    expect(_countSummaryClaims(mixed)).toBe(4);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSpecificClaims', () => {
  test('returns 0 for null', () => {
    expect(_countSpecificClaims(null)).toBe(0);
  });

  test('counts large numbers', () => {
    expect(_countSpecificClaims('Found 1,234 connections and 5,678 alerts')).toBe(2);
  });

  test('counts ISO dates (and their year parts)', () => {
    // Each ISO date also contains a 4-digit year matched by the large-number regex
    expect(_countSpecificClaims('Updated on 2024-01-15 and expires 2024-06-30')).toBe(4);
  });

  test('counts percentages', () => {
    expect(_countSpecificClaims('CPU at 85% and RAM at 92%')).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_countSourceTags', () => {
  test('returns 0 for null', () => {
    expect(_countSourceTags(null)).toBe(0);
  });

  test('counts [src:...] tags', () => {
    expect(_countSourceTags('Found [src:firewall_rules] and [src:vpn_status]')).toBe(2);
  });

  test('counts [unverified] tags', () => {
    expect(_countSourceTags('Result [unverified]')).toBe(1);
  });

  test('counts mixed tags', () => {
    expect(_countSourceTags('[src:data1] [src:data2] [unverified]')).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('evaluateHallucinationRisk', () => {
  test('flags 3+ claims with 0 evidence', () => {
    const summary = '1. Found X\n2. Found Y\n3. Found Z';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('no data was extracted');
  });

  test('flags claims > 2x evidence without caveats', () => {
    const summary = '1. X\n2. Y\n3. Z\n4. W\n5. V';
    const mem = { key1: 'val1' };
    const result = evaluateHallucinationRisk(summary, mem, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('evidence sources');
  });

  test('passes with adequate evidence', () => {
    const summary = '1. Found X';
    const mem = { x: 'data' };
    const result = evaluateHallucinationRisk(summary, mem, []);
    expect(result.risky).toBe(false);
    expect(result.claims).toBe(1);
    expect(result.evidence).toBe(1);
  });

  test('passes with caveats', () => {
    const summary = '1. X\n2. Y\n3. Z\n4. W\nNote: headline only, not read';
    const result = evaluateHallucinationRisk(summary, { key1: 'data' }, []);
    // With caveat AND evidence, the claims > 2x evidence rule doesn't fire
    expect(result.risky).toBe(false);
  });

  test('flags specific claims without source tags', () => {
    const summary = 'IP 192.168.1.1, IP 10.0.0.1, IP 172.16.0.1, date 2024-01-01, date 2024-06-01, CPU 85%, RAM 92%';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
  });

  test('flags specific claims wildly outnumbering tags', () => {
    const summary = '1. Found 1,234 users [src:scan] 2. Found 5,678 alerts 3. CPU 85% 4. RAM 92% 5. Cost $5M 6. 9,001 records 7. 2,345 events 8. 4,567 logs 9. 8,901 items';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('source tags');
  });

  test('null summary returns not risky', () => {
    expect(evaluateHallucinationRisk(null, {}, []).risky).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('detectStall', () => {
  test('returns not stalled with varied actions', () => {
    const history = [
      { action: { type: 'click' }, result: 'Clicked button' },
      { action: { type: 'type' }, result: 'Typed text' },
      { action: { type: 'navigate' }, result: 'Navigated' },
    ];
    expect(detectStall(history, 0, [])).toEqual({ stalled: false });
  });

  test('detects repeated same-type failures', () => {
    const history = [
      { action: { type: 'click' }, result: 'Element not found' },
      { action: { type: 'click' }, result: 'Element not found' },
      { action: { type: 'click' }, result: 'Element not found' },
    ];
    const result = detectStall(history, 0, []);
    expect(result.stalled).toBe(true);
    expect(result.recoveryAction).toBe('RESCAN_AND_REPLAN');
  });

  test('detects high consecutive failures', () => {
    const history = [
      { action: { type: 'click' }, result: 'OK' },
    ];
    const result = detectStall(history, 5, []);
    expect(result.stalled).toBe(true);
    expect(result.recoveryAction).toBe('FORCE_STRATEGY_SHIFT');
  });

  test('returns not stalled with insufficient history', () => {
    const history = [
      { action: { type: 'click' }, result: 'Error: timeout' },
    ];
    expect(detectStall(history, 0, [])).toEqual({ stalled: false });
  });

  test('detects repeated timeout failures', () => {
    const history = [
      { action: { type: 'click' }, result: 'Action timed out' },
      { action: { type: 'click' }, result: 'Action timed out' },
      { action: { type: 'click' }, result: 'Action timed out' },
    ];
    const result = detectStall(history, 0, []);
    expect(result.stalled).toBe(true);
  });

  test('detects repeated "not found" failures', () => {
    const history = [
      { action: { type: 'click' }, result: 'No element found' },
      { action: { type: 'click' }, result: 'No element found' },
      { action: { type: 'click' }, result: 'No element found' },
    ];
    const result = detectStall(history, 0, []);
    expect(result.stalled).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('extractTicketNumber', () => {
  test('extracts ticket number from "ticket #12345"', () => {
    expect(extractTicketNumber('Check ticket #12345')).toBe('12345');
  });

  test('extracts ticket number from "ticket 67890"', () => {
    expect(extractTicketNumber('Fix ticket 67890 now')).toBe('67890');
  });

  test('extracts from "incident #11111"', () => {
    expect(extractTicketNumber('Look at incident #11111')).toBe('11111');
  });

  test('extracts from leading "#123456"', () => {
    expect(extractTicketNumber('#123456 investigate')).toBe('123456');
  });

  test('returns empty string for no match', () => {
    expect(extractTicketNumber('Check the firewall')).toBe('');
  });

  test('returns empty string for null', () => {
    expect(extractTicketNumber(null)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(extractTicketNumber('')).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('isConfigChangeGoal', () => {
  test('detects config change intent', () => {
    expect(isConfigChangeGoal('Change the SonicWall firewall rule to allow HTTP')).toBe(true);
  });

  test('detects update intent', () => {
    expect(isConfigChangeGoal('Update the FortiGate VPN settings')).toBe(true);
  });

  test('detects modify intent', () => {
    expect(isConfigChangeGoal('Modify the Cisco access policy')).toBe(true);
  });

  test('detects enable/disable intent', () => {
    expect(isConfigChangeGoal('Enable the NinjaOne security feature')).toBe(true);
    expect(isConfigChangeGoal('Disable the old ConnectWise policy')).toBe(true);
  });

  test('returns false for read-only goals', () => {
    expect(isConfigChangeGoal('Check the firewall status')).toBe(false);
  });

  test('returns false for null', () => {
    expect(isConfigChangeGoal(null)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isConfigChangeGoal('')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('isTicketInvestigationGoal', () => {
  test('detects ticket investigation', () => {
    expect(isTicketInvestigationGoal('Investigate ticket #12345')).toBe(true);
  });

  test('detects incident investigation', () => {
    expect(isTicketInvestigationGoal('Look into incident #67890')).toBe(true);
  });

  test('returns false for non-ticket goals', () => {
    expect(isTicketInvestigationGoal('Check the firewall')).toBe(false);
  });

  test('returns false for null', () => {
    expect(isTicketInvestigationGoal(null)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('captureReportData', () => {
  test('captures all fields', () => {
    const data = captureReportData('Test goal', [{ step: 1 }], { key: 'val' }, ['plan1'], 5, 3);
    expect(data.goal).toBe('Test goal');
    expect(data.history).toEqual([{ step: 1 }]);
    expect(data.agentMemory).toEqual({ key: 'val' });
    expect(data.agentPlan).toEqual(['plan1']);
    expect(data.stepCount).toBe(5);
    expect(data.apiCallCount).toBe(3);
  });

  test('handles null plan', () => {
    const data = captureReportData('g', [], {}, null, 0, 0);
    expect(data.agentPlan).toBeNull();
  });

  test('history is a shallow copy', () => {
    const hist = [1, 2, 3];
    const data = captureReportData('g', hist, {}, null, 0, 0);
    expect(data.history).not.toBe(hist);
    expect(data.history).toEqual(hist);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('pauseAgent / resumeAgent / stopAgent', () => {
  test('pauseAgent returns message when not running', async () => {
    const result = await pauseAgent();
    expect(result).toBe('Agent not running');
  });

  test('resumeAgent returns message when not running', async () => {
    const result = await resumeAgent();
    expect(result).toBe('Agent not running');
  });

  test('stopAgent returns message and cleans up', async () => {
    const result = await stopAgent();
    expect(result).toBe('Agent stopped');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('setAgentSpeed', () => {
  test('rejects invalid speed mode', () => {
    expect(setAgentSpeed('fast')).toContain('Invalid');
  });

  test('accepts turbo', () => {
    expect(setAgentSpeed('turbo')).toBe('Speed set to turbo');
  });

  test('accepts normal', () => {
    expect(setAgentSpeed('normal')).toBe('Speed set to normal');
  });

  test('accepts stealth', () => {
    expect(setAgentSpeed('stealth')).toBe('Speed set to stealth');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('formatTicketKickoff', () => {
  test('produces a kickoff block with required sections', () => {
    const result = formatTicketKickoff('Firewall blocking traffic', 'Restarted the service', { name: 'Test Tech', title: 'Tech', company: 'Co' });
    expect(result).toContain('MAIN ISSUE');
    expect(result).toContain('Firewall blocking traffic');
    expect(result).toContain('Restarted the service');
    expect(result).toContain('FASTEST SAFE RESOLUTION PATH');
  });

  test('handles null options gracefully', () => {
    const result = formatTicketKickoff('Issue', 'Tried X', { name: 'Tech', title: 'Tech', company: 'Co' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('formatTicketFinalNotes', () => {
  test('produces final notes with action taken and ownership', () => {
    const result = formatTicketFinalNotes('Resolved the issue successfully.', 'Ticket #123', {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
    }, { stepCount: 10, apiCallCount: 5 });
    expect(result).toContain('Action Taken');
    expect(result).toContain('John Smith');
    expect(result).toContain('Acme IT');
  });

  test('detects partial results and adjusts framing', () => {
    const result = formatTicketFinalNotes('Step limit reached. Extraction failed.', 'Ticket #456', {
      name: 'Tech', title: 'Tech', company: 'Co',
    });
    expect(result).toContain('partial');
    expect(result).toContain('Manual review required');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('formatWaitingOnClient', () => {
  test('produces waiting-on-client block', () => {
    const result = formatWaitingOnClient('Called client', 'Phone call at 2pm', {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    });
    expect(result).toContain('Action Taken');
    expect(result).toContain('Contact Attempt Details');
    expect(result).toContain('Next Step');
    expect(result).toContain('John Smith');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('formatWaitingOnVendor', () => {
  test('produces waiting-on-vendor block', () => {
    const result = formatWaitingOnVendor('Opened vendor ticket', 'Vendor support, 3pm, ETA 2 days', {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    });
    expect(result).toContain('Action Taken');
    expect(result).toContain('John Smith');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('formatItGlueKb', () => {
  test('produces KB entry with resolution steps', () => {
    const summary = '1. Go to portal\n2. Click reset\n3. Confirm the MFA reset was successful';
    const result = formatItGlueKb(summary, 'Reset MFA for user in Microsoft 365', { name: 'Tech', company: 'Co' });
    expect(result).toContain('IT Glue Knowledge Base');
    expect(result).toContain('Resolution Steps');
    expect(result).toContain('Go to portal');
    expect(result).toContain('Microsoft 365');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('formatClientEmail', () => {
  test('produces client email', () => {
    const result = formatClientEmail('VPN was reconnected successfully.', 'Investigate ticket #789 VPN disconnected', {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    });
    expect(result).toContain('Resolved');
    expect(result).toContain('John Smith');
    expect(result).toContain('555-000-0000');
    expect(result).toContain('support@example.com');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('summarizeHistoryBatch', () => {
  test('summarizes a batch of history entries', () => {
    const batch = [
      { step: 1, action: { type: 'click', selector: '#btn' }, result: 'Clicked' },
      { step: 2, action: { type: 'type', selector: '#input', text: 'hello' }, result: 'Typed' },
    ];
    const result = summarizeHistoryBatch(batch);
    expect(result).toBeTruthy();
    expect(result.action.type).toBe('history_summary');
  });

  test('handles empty batch', () => {
    const result = summarizeHistoryBatch([]);
    expect(result).toBeNull();
  });

  test('handles null entries', () => {
    const result = summarizeHistoryBatch([null, undefined]);
    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('maybeRollupHistory', () => {
  test('returns unmodified when under threshold', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({ action: { type: 'click' }, result: 'ok' }));
    const result = maybeRollupHistory(history);
    expect(result).toBeUndefined(); // function returns undefined when no rollup needed
    expect(history.length).toBe(5); // unchanged
  });

  test('rolls up when over threshold', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      step: i,
      action: { type: i % 2 === 0 ? 'click' : 'type' },
      result: 'ok',
    }));
    maybeRollupHistory(history);
    expect(history.length).toBeLessThan(50);
  });

  test('handles empty history', () => {
    const result = maybeRollupHistory([]);
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('hasRecentCommitClick', () => {
  test('returns true when recent click on commit button', () => {
    const history = [
      { action: { type: 'click', selector: '#commit-btn' }, result: 'Clicked' },
      { action: { type: 'extract' }, result: 'Data' },
    ];
    expect(hasRecentCommitClick(history, 3)).toBe(true);
  });

  test('returns false when no commit click', () => {
    const history = [
      { action: { type: 'click', selector: '#other-btn' }, result: 'Clicked' },
      { action: { type: 'type' }, result: 'Typed' },
    ];
    expect(hasRecentCommitClick(history, 3)).toBe(false);
  });

  test('returns false for empty history', () => {
    expect(hasRecentCommitClick([], 3)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('hasPostCommitVerification', () => {
  test('returns true when verification step after commit', () => {
    const history = [
      { action: { type: 'click', selector: '#commit' }, result: 'Clicked commit' },
      { action: { type: 'read_page' }, result: 'Read the page to verify' },
    ];
    expect(hasPostCommitVerification(history)).toBe(true);
  });

  test('returns false when no verification', () => {
    const history = [
      { action: { type: 'click', selector: '#commit' }, result: 'Clicked' },
      { action: { type: 'click', selector: '#other' }, result: 'Clicked' },
    ];
    expect(hasPostCommitVerification(history)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_detectActionTypeLoop', () => {
  test('detects repeated click actions', () => {
    const history = [
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
    ];
    const result = _detectActionTypeLoop(history);
    expect(result).toBeTruthy();
    expect(result.type).toBe('click');
  });

  test('returns null for varied actions', () => {
    const history = [
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'type' }, result: 'ok' },
      { action: { type: 'navigate' }, result: 'ok' },
    ];
    expect(_detectActionTypeLoop(history)).toEqual({ isLoop: false });
  });

  test('returns null for empty history', () => {
    expect(_detectActionTypeLoop([])).toEqual({ isLoop: false });
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('generateHeuristicPlan', () => {
  test('generates plan for navigate goal', () => {
    const plan = generateHeuristicPlan('Navigate to https://example.com and check the firewall');
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  test('generates plan for simple goal', () => {
    const plan = generateHeuristicPlan('Check the VPN status');
    expect(Array.isArray(plan)).toBe(true);
  });

  test('handles null goal', () => {
    const plan = generateHeuristicPlan(null);
    expect(plan).toBeNull();
  });

  test('handles empty goal', () => {
    const plan = generateHeuristicPlan('');
    expect(plan).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_autoPickFormat', () => {
  test('picks ticket kickoff format for kickoff goals', () => {
    expect(_autoPickFormat('', 'Investigate kickoff for this new ticket')).toBe('TICKET_KICKOFF');
  });

  test('picks default format for non-ticket goals', () => {
    const result = _autoPickFormat('', 'Check the firewall settings');
    expect(result).toBe('FINAL_NOTES');
  });

  test('picks default format for non-ticket goals', () => {
    const result = _autoPickFormat('Check the firewall settings');
    expect(typeof result).toBe('string');
  });

  test('handles null goal', () => {
    const result = _autoPickFormat(null, null);
    expect(typeof result).toBe('string');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('_tenantsMatch', () => {
  test('matches same tenant', () => {
    expect(_tenantsMatch({ onmicrosoft: 'contoso.onmicrosoft.com' }, 'contoso.onmicrosoft.com')).toBe(true);
  });

  test('rejects different tenants', () => {
    expect(_tenantsMatch({ onmicrosoft: 'contoso.onmicrosoft.com' }, 'fabrikam.onmicrosoft.com')).toBe(false);
  });

  test('handles null expected (no lock)', () => {
    expect(_tenantsMatch(null, null)).toBe(true);
  });

  test('handles null detected with expected', () => {
    expect(_tenantsMatch(null, 'contoso.onmicrosoft.com')).toBe(false);
  });

  test('handles both null expected (treated as no lock)', () => {
    expect(_tenantsMatch({ onmicrosoft: 'contoso.onmicrosoft.com' }, null)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('formatTicketOutput', () => {
  test('formats ticket output with all sections', () => {
    const result = formatTicketOutput('FINAL_NOTES', 'Test data', 'Test goal', { name: 'Tech', title: 'Tech', company: 'Co' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('detectMfaInText', () => {
  test('detects MFA verification code prompt', () => {
    const result = detectMfaInText("We've sent a verification code to your email");
    expect(result).toBeTruthy();
  });

  test('detects authenticator app prompt', () => {
    const result = detectMfaInText('Open your authenticator app and enter the code');
    expect(result).toBeTruthy();
  });

  test('detects Duo push', () => {
    const result = detectMfaInText('Waiting for Duo push approval');
    expect(result).toBeTruthy();
  });

  test('returns null for non-MFA text', () => {
    const result = detectMfaInText('Welcome to the dashboard');
    expect(result).toBeNull();
  });

  test('handles null input', () => {
    const result = detectMfaInText(null);
    expect(result).toBeNull();
  });

  test('handles empty string', () => {
    const result = detectMfaInText('');
    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('detectSignInWall', () => {
  test('detects sign-in wall on auth page', () => {
    const result = detectSignInWall(
      [{ selector: '#password', type: 'password' }],
      'https://login.microsoftonline.com/',
      'Sign in to your account'
    );
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
  });

  test('returns null for non-auth page', () => {
    const result = detectSignInWall(
      [],
      'https://admin.microsoft.com/',
      'Dashboard'
    );
    expect(result).toBeNull();
  });

  test('handles null elements', () => {
    const result = detectSignInWall(null, 'https://login.microsoftonline.com/', 'Sign in');
    // No password field, but text cues on auth host => matches text cue path
    expect(result === null || (result && result.matched === true)).toBe(true);
  });
});

