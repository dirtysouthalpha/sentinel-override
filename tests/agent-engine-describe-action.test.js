// tests/agent-engine-describe-action.test.js
// Deep coverage of describeAction() and _describeTarget() pure functions.

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
  generatePlan: jest.fn(async () => ['Step 1']),
  supportsVision: jest.fn(() => true),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []), estimateCostUsd: jest.fn(() => 0), isSimpleStep: jest.fn(() => false),
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
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })),
  suggestRetryActions: jest.fn(() => []),
}));

const { describeAction, _describeTarget } = await import('../background/agent-engine.js');

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
describe('_describeTarget', () => {
  test('null cmd returns (no target)', () => {
    expect(_describeTarget(null)).toBe('(no target)');
  });

  test('undefined cmd returns (no target)', () => {
    expect(_describeTarget(undefined)).toBe('(no target)');
  });

  test('empty object returns (no target)', () => {
    expect(_describeTarget({})).toBe('(no target)');
  });

  test('ariaLabel takes priority', () => {
    expect(_describeTarget({ ariaLabel: 'Submit', elementText: 'Go', label: 'btn', selector: '#s', ref: 'r1' }))
      .toBe('"Submit"');
  });

  test('elementText is used when no ariaLabel', () => {
    expect(_describeTarget({ elementText: 'Go', label: 'btn', selector: '#s', ref: 'r1' }))
      .toBe('"Go"');
  });

  test('label is used when no ariaLabel/elementText', () => {
    expect(_describeTarget({ label: 'btn', selector: '#s', ref: 'r1' }))
      .toBe('"btn"');
  });

  test('selector is used when no labels', () => {
    expect(_describeTarget({ selector: '#submit-btn', ref: 'r1' }))
      .toBe('#submit-btn');
  });

  test('ref is used when nothing else', () => {
    expect(_describeTarget({ ref: 'ref_42' }))
      .toBe('ref:ref_42');
  });

  test('x,y coordinates are used', () => {
    expect(_describeTarget({ x: 100, y: 200 }))
      .toBe('(100,200)');
  });

  test('x,y with strings does not match', () => {
    expect(_describeTarget({ x: '100', y: '200' }))
      .toBe('(no target)');
  });

  test('ariaLabel is truncated to 80 chars', () => {
    const long = 'A'.repeat(120);
    const result = _describeTarget({ ariaLabel: long });
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('"');
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('describeAction — all action types', () => {
  test('navigate_back', () => {
    expect(describeAction({ type: 'navigate_back' })).toBe('Navigate back');
  });

  test('navigate_forward', () => {
    expect(describeAction({ type: 'navigate_forward' })).toBe('Navigate forward');
  });

  test('click with selector', () => {
    const result = describeAction({ type: 'click', selector: '#btn' });
    expect(result).toContain('Click:');
    expect(result).toContain('#btn');
  });

  test('click with ariaLabel', () => {
    const result = describeAction({ type: 'click', ariaLabel: 'Submit' });
    expect(result).toContain('Click:');
    expect(result).toContain('Submit');
  });

  test('right_click', () => {
    const result = describeAction({ type: 'right_click', selector: '#menu' });
    expect(result).toContain('Right-click:');
  });

  test('double_click', () => {
    const result = describeAction({ type: 'double_click', selector: '#item' });
    expect(result).toContain('Double-click:');
  });

  test('drag_and_drop with source and target', () => {
    const result = describeAction({
      type: 'drag_and_drop',
      source_ref: 'src1',
      target_ref: 'tgt1',
      source_selector: '#src',
      target_selector: '#tgt',
    });
    expect(result).toContain('Drag');
    expect(result).toContain('→');
  });

  test('click_at with x,y', () => {
    const result = describeAction({ type: 'click_at', x: 150, y: 250 });
    expect(result).toContain('Click at:');
    expect(result).toContain('150');
  });

  test('type with text', () => {
    const result = describeAction({ type: 'type', selector: '#input', text: 'hello world' });
    expect(result).toContain('Type into');
    expect(result).toContain('hello world');
  });

  test('type truncates long text to 80 chars', () => {
    const long = 'A'.repeat(200);
    const result = describeAction({ type: 'type', selector: '#q', text: long });
    expect(result.length).toBeLessThan(long.length + 30);
  });

  test('type with no text', () => {
    const result = describeAction({ type: 'type', selector: '#q' });
    expect(result).toContain("''");
  });

  test('navigate with url', () => {
    const result = describeAction({ type: 'navigate', url: 'https://example.com' });
    expect(result).toContain('Navigate to https://example.com');
  });

  test('navigate with no url', () => {
    const result = describeAction({ type: 'navigate' });
    expect(result).toContain('(no url)');
  });

  test('scroll down', () => {
    expect(describeAction({ type: 'scroll', amount: 300 })).toContain('down');
  });

  test('scroll up', () => {
    expect(describeAction({ type: 'scroll', amount: -200 })).toContain('up');
  });

  test('scroll with zero amount', () => {
    // 0 >= 0 so it's "down"
    expect(describeAction({ type: 'scroll', amount: 0 })).toContain('down');
  });

  test('scroll default amount', () => {
    expect(describeAction({ type: 'scroll' })).toContain('down');
  });

  test('scroll_to', () => {
    const result = describeAction({ type: 'scroll_to', selector: '#section' });
    expect(result).toContain('Scroll to');
    expect(result).toContain('#section');
  });

  test('select with value', () => {
    const result = describeAction({ type: 'select', value: 'option1', selector: '#dd' });
    expect(result).toContain('Select "option1"');
  });

  test('hover', () => {
    const result = describeAction({ type: 'hover', selector: '#item' });
    expect(result).toContain('Hover:');
  });

  test('check', () => {
    const result = describeAction({ type: 'check', selector: '#cb' });
    expect(result).toContain('Check:');
  });

  test('check_all', () => {
    const result = describeAction({ type: 'check_all', selector: '.checkbox' });
    expect(result).toContain('Check all matching');
  });

  test('press_key', () => {
    const result = describeAction({ type: 'press_key', key: 'Enter' });
    expect(result).toContain('Press: Enter');
  });

  test('press_key with no key', () => {
    const result = describeAction({ type: 'press_key' });
    expect(result).toContain('(no key)');
  });

  test('execute_js with code', () => {
    const result = describeAction({ type: 'execute_js', code: 'document.querySelectorAll(".item")' });
    expect(result).toContain('Run JS:');
    expect(result).toContain('document.querySelectorAll');
  });

  test('execute_js with key', () => {
    const result = describeAction({ type: 'execute_js', code: 'return x', key: 'result' });
    expect(result).toContain('→ result');
  });

  test('extract with key', () => {
    const result = describeAction({ type: 'extract', key: 'prices', selector: '.price' });
    expect(result).toContain('Extract "prices"');
  });

  test('extract_list', () => {
    const result = describeAction({ type: 'extract_list', key: 'items', selector: '.item' });
    expect(result).toContain('Extract list "items"');
  });

  test('open_tab with label', () => {
    const result = describeAction({ type: 'open_tab', label: 'Search Results' });
    expect(result).toContain('Open tab: Search Results');
  });

  test('open_tab with url only', () => {
    const result = describeAction({ type: 'open_tab', url: 'https://example.com' });
    expect(result).toContain('Open tab: https://example.com');
  });

  test('open_tab with nothing', () => {
    const result = describeAction({ type: 'open_tab' });
    expect(result).toContain('(no url)');
  });

  test('switch_tab with label', () => {
    const result = describeAction({ type: 'switch_tab', label: 'Tab 2' });
    expect(result).toContain('Switch to: Tab 2');
  });

  test('switch_tab with tab_id', () => {
    const result = describeAction({ type: 'switch_tab', tab_id: 42 });
    expect(result).toContain('Switch to: 42');
  });

  test('close_tab', () => {
    const result = describeAction({ type: 'close_tab', label: 'Extra' });
    expect(result).toContain('Close tab: Extra');
  });

  test('note with text', () => {
    const result = describeAction({ type: 'note', text: 'Found an interesting pattern' });
    expect(result).toContain('Note:');
    expect(result).toContain('Found an interesting pattern');
  });

  test('note with summary', () => {
    const result = describeAction({ type: 'note', summary: 'Summarized findings' });
    expect(result).toContain('Note:');
    expect(result).toContain('Summarized findings');
  });

  test('finish with summary', () => {
    const result = describeAction({ type: 'finish', summary: 'Task completed successfully' });
    expect(result).toContain('Finish:');
    expect(result).toContain('Task completed successfully');
  });

  test('wait_for_text', () => {
    const result = describeAction({ type: 'wait_for_text', text: 'Loading complete' });
    expect(result).toContain('Wait for text: "Loading complete"');
  });

  test('wait_for_element', () => {
    const result = describeAction({ type: 'wait_for_element', selector: '.result' });
    expect(result).toContain('Wait for element:');
  });

  test('wait_for_navigation', () => {
    expect(describeAction({ type: 'wait_for_navigation' })).toBe('Wait for navigation');
  });

  test('read_page', () => {
    expect(describeAction({ type: 'read_page' })).toBe('Read page');
  });

  test('dismiss_overlay', () => {
    expect(describeAction({ type: 'dismiss_overlay' })).toBe('Dismiss overlay');
  });

  test('lookup with domain', () => {
    const result = describeAction({ type: 'lookup', domain: 'example.com', record_type: 'MX' });
    expect(result).toContain('DNS lookup: example.com');
    expect(result).toContain('MX');
  });

  test('lookup defaults to A record', () => {
    const result = describeAction({ type: 'lookup', domain: 'example.com' });
    expect(result).toContain('(A)');
  });

  test('run_remote_command', () => {
    const result = describeAction({ type: 'run_remote_command', command_type: 'bash', command: 'ls -la /var/log' });
    expect(result).toContain('Remote cmd (bash)');
    expect(result).toContain('ls -la');
  });

  test('run_remote_command defaults to powershell', () => {
    const result = describeAction({ type: 'run_remote_command', command: 'Get-Process' });
    expect(result).toContain('powershell');
  });

  test('unknown type falls through to default', () => {
    const result = describeAction({ type: 'custom_foo', value: 42 });
    expect(result).toContain('custom_foo:');
    expect(result).toContain('"value":42');
  });
});
