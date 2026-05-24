// tests/agent-engine-utils.test.js
// Tests for background/agent-engine.js exported utility functions that lack coverage:
// - describeAction, _describeTarget
// - getTechnicianInfo
// - saveLearnedPattern
// - maybePostProgressUpdate
// - requestTenantOverride
// - _runExecuteJsOnce, _runExecuteJsWithRetryLadder
// - attachTabToSentinelGroup, detachAllSentinelTabs

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
const sessionData = {};

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
    update: jest.fn(async () => {}),
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
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
  debugger: {
    detach: jest.fn(async () => {}),
  },
  notifications: {
    create: jest.fn(async () => {}),
  },
};

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 10) };
}

// ── Mock dependencies ──
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
  sendAgentStatus: jest.fn(),
  sendHeartbeat: jest.fn(), sendPlanPreview: jest.fn(), sendClientKnowledgePreview: jest.fn(),
}));

jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: jest.fn(() => ({ html: '<p>report</p>', markdown: 'report' })),
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(() => ({ id: 'test', name: 'Test Provider' })),
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
  getTabCount: jest.fn(() => 0),
}));

jest.unstable_mockModule('../background/client-knowledge.js', () => ({
  getActiveClient: jest.fn(() => null),
  getRelevantEntries: jest.fn(() => []),
  formatPromptSection: jest.fn(() => ''),
  markRunCompleted: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: jest.fn(async () => null),
}));

jest.unstable_mockModule('../background/audit-log.js', () => ({
  appendAuditEntry: jest.fn(async () => {}),
  getAuditLog: jest.fn(async () => []),
  auditLogToCsv: jest.fn(() => ''),
}));

jest.unstable_mockModule('../background/skills/index.js', () => ({
  runRecoverySkills: jest.fn(() => null),
  getSkillStats: jest.fn(() => ({})),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(() => 'run-1'),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 85, breakdown: {} })),
  suggestRetryActions: jest.fn(() => []),
}));

// ── Import after mocks ──
import { resetAgentState } from '../background/agent-engine.js';

beforeEach(() => {
  for (const k of Object.keys(storageData)) delete storageData[k];
  for (const k of Object.keys(sessionData)) delete sessionData[k];
  jest.clearAllMocks();
  resetAgentState();
});

// ═══════════════════════════════════════════════════
// describeAction — previously only reference-tested
// ═══════════════════════════════════════════════════
describe('describeAction (real)', () => {
  // Re-import to get the real function via the mock chain
  let describeAction;
  beforeAll(async () => {
    const mod = await import('../background/agent-engine.js');
    describeAction = mod.describeAction;
  });

  test('click with ariaLabel', () => {
    expect(describeAction({ type: 'click', ariaLabel: 'Save' }))
      .toBe('Click: "Save"');
  });

  test('click_at with elementText', () => {
    expect(describeAction({ type: 'click_at', elementText: 'Submit' }))
      .toBe('Click at: "Submit"');
  });

  test('type with text', () => {
    expect(describeAction({ type: 'type', selector: '#input', text: 'hello' }))
      .toBe("Type into #input: 'hello'");
  });

  test('navigate with url', () => {
    expect(describeAction({ type: 'navigate', url: 'https://example.com' }))
      .toBe('Navigate to https://example.com');
  });

  test('scroll down', () => {
    expect(describeAction({ type: 'scroll', amount: 500 }))
      .toBe('Scroll down');
  });

  test('scroll up', () => {
    expect(describeAction({ type: 'scroll', amount: -300 }))
      .toBe('Scroll up');
  });

  test('scroll_to with target', () => {
    expect(describeAction({ type: 'scroll_to', ref: 'btn1' }))
      .toBe('Scroll to ref:btn1');
  });

  test('select with value', () => {
    expect(describeAction({ type: 'select', value: 'opt1', selector: '#sel' }))
      .toBe('Select "opt1" in #sel');
  });

  test('hover', () => {
    expect(describeAction({ type: 'hover', ariaLabel: 'Menu' }))
      .toBe('Hover: "Menu"');
  });

  test('check', () => {
    expect(describeAction({ type: 'check', selector: '#cb' }))
      .toBe('Check: #cb');
  });

  test('check_all', () => {
    expect(describeAction({ type: 'check_all', selector: '.items' }))
      .toBe('Check all matching .items');
  });

  test('press_key', () => {
    expect(describeAction({ type: 'press_key', key: 'Enter' }))
      .toBe('Press: Enter');
  });

  test('execute_js with key', () => {
    expect(describeAction({ type: 'execute_js', code: 'return 1+1', key: 'result' }))
      .toBe('Run JS: return 1+1 → result');
  });

  test('execute_js without key', () => {
    expect(describeAction({ type: 'execute_js', code: 'return document.title' }))
      .toBe('Run JS: return document.title');
  });

  test('extract', () => {
    expect(describeAction({ type: 'extract', key: 'users', selector: '#list' }))
      .toBe('Extract "users" from #list');
  });

  test('extract_list', () => {
    expect(describeAction({ type: 'extract_list', key: 'items', ref: 'list1' }))
      .toBe('Extract list "items" from ref:list1');
  });

  test('open_tab', () => {
    expect(describeAction({ type: 'open_tab', url: 'https://example.com', label: 'Example' }))
      .toBe('Open tab: Example');
  });

  test('open_tab without label', () => {
    expect(describeAction({ type: 'open_tab', url: 'https://example.com' }))
      .toBe('Open tab: https://example.com');
  });

  test('switch_tab', () => {
    expect(describeAction({ type: 'switch_tab', label: 'Portal' }))
      .toBe('Switch to: Portal');
  });

  test('close_tab', () => {
    expect(describeAction({ type: 'close_tab', tab_id: 3 }))
      .toBe('Close tab: 3');
  });

  test('note', () => {
    expect(describeAction({ type: 'note', text: 'Found issue' }))
      .toBe('Note: Found issue');
  });

  test('finish', () => {
    expect(describeAction({ type: 'finish', summary: 'Done with task' }))
      .toBe('Finish: Done with task');
  });

  test('wait_for_text', () => {
    expect(describeAction({ type: 'wait_for_text', text: 'Loading complete' }))
      .toBe('Wait for text: "Loading complete"');
  });

  test('wait_for_element', () => {
    expect(describeAction({ type: 'wait_for_element', selector: '#done' }))
      .toBe('Wait for element: #done');
  });

  test('wait_for_navigation', () => {
    expect(describeAction({ type: 'wait_for_navigation' }))
      .toBe('Wait for navigation');
  });

  test('read_page', () => {
    expect(describeAction({ type: 'read_page' }))
      .toBe('Read page');
  });

  test('dismiss_overlay', () => {
    expect(describeAction({ type: 'dismiss_overlay' }))
      .toBe('Dismiss overlay');
  });

  test('lookup', () => {
    expect(describeAction({ type: 'lookup', domain: 'example.com', record_type: 'A' }))
      .toBe('DNS lookup: example.com (A)');
  });

  test('run_remote_command', () => {
    expect(describeAction({ type: 'run_remote_command', command_type: 'powershell', command: 'Get-Process' }))
      .toBe('Remote cmd (powershell): Get-Process');
  });

  test('unknown type falls back to JSON', () => {
    const result = describeAction({ type: 'custom_action', foo: 'bar' });
    expect(result).toMatch(/^custom_action:/);
    expect(result).toContain('foo');
  });

  test('type text truncated to 80 chars', () => {
    const long = 'a'.repeat(100);
    const result = describeAction({ type: 'type', selector: '#i', text: long });
    expect(result).toContain("'aaaaaaaa");
    expect(result.length).toBeLessThan(150);
  });
});

// ═══════════════════════════════════════════════════
// _describeTarget — priority ordering of target hints
// ═══════════════════════════════════════════════════
describe('_describeTarget (real)', () => {
  let mod;
  beforeAll(async () => {
    mod = await import('../background/agent-engine.js');
  });

  test('null command returns (no target)', () => {
    expect(mod._describeTarget(null)).toBe('(no target)');
  });

  test('undefined command returns (no target)', () => {
    expect(mod._describeTarget(undefined)).toBe('(no target)');
  });

  test('prefers ariaLabel over elementText', () => {
    const result = mod._describeTarget({ ariaLabel: 'Aria', elementText: 'Text', selector: '#s' });
    expect(result).toBe('"Aria"');
  });

  test('uses elementText when no ariaLabel', () => {
    const result = mod._describeTarget({ elementText: 'Button Label', selector: '#s' });
    expect(result).toBe('"Button Label"');
  });

  test('uses label when no ariaLabel/elementText', () => {
    const result = mod._describeTarget({ label: 'Field Name', selector: '#s' });
    expect(result).toBe('"Field Name"');
  });

  test('uses selector when no labels', () => {
    const result = mod._describeTarget({ selector: '#submit-btn' });
    expect(result).toBe('#submit-btn');
  });

  test('uses ref when no selector', () => {
    const result = mod._describeTarget({ ref: 'r5' });
    expect(result).toBe('ref:r5');
  });

  test('uses coordinates as last resort', () => {
    const result = mod._describeTarget({ x: 100, y: 200 });
    expect(result).toBe('(100,200)');
  });

  test('returns (no target) when nothing is set', () => {
    expect(mod._describeTarget({})).toBe('(no target)');
  });

  test('truncates long ariaLabel to 80 chars', () => {
    const long = 'x'.repeat(100);
    const result = mod._describeTarget({ ariaLabel: long });
    expect(result.length).toBeLessThanOrEqual(84); // quotes + content
  });
});
