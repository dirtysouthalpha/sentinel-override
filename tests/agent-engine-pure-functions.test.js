// tests/agent-engine-pure-functions.test.js
// Tests for pure functions in agent-engine.js:
// detectCaptcha, describeAction, _describeTarget, _hostnameOf, _tenantsMatch

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
  detectCaptcha,
  describeAction,
  _describeTarget,
  _hostnameOf,
  _tenantsMatch,
  detectMfaInText,
  detectSignInWall,
  evaluateHallucinationRisk,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags,
  _generateSmartRecovery,
} = await import('../background/agent-engine.js');

// ══════════════════════════════════════════════════════════════════
// detectCaptcha
// ══════════════════════════════════════════════════════════════════
describe('detectCaptcha', () => {
  test('null URL returns null', () => {
    expect(detectCaptcha(null, '', 0)).toBeNull();
  });

  test('empty URL returns null', () => {
    expect(detectCaptcha('', '', 0)).toBeNull();
  });

  test('undefined URL returns null', () => {
    expect(detectCaptcha(undefined, '', 0)).toBeNull();
  });

  test('URL matching CAPTCHA pattern returns captcha_url type', () => {
    const result = detectCaptcha('https://example.com/captcha/check', '', 10);
    expect(result).toBeTruthy();
    expect(result.matched).toBe(true);
    expect(result.type).toBe('captcha_url');
  });

  test('recaptcha in URL matches', () => {
    const result = detectCaptcha('https://example.com/recaptcha/verify', '', 0);
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_url');
  });

  test('hcaptcha in URL matches', () => {
    const result = detectCaptcha('https://hcaptcha.com/siteverify', '', 0);
    expect(result).toBeTruthy();
  });

  test('URL with text confirmation gets 0.9 confidence', () => {
    const result = detectCaptcha(
      'https://example.com/captcha/check',
      'Please verify you are not a robot',
      10
    );
    expect(result).toBeTruthy();
    expect(result.textConfirm).toBe(true);
    expect(result.confidence).toBe(0.9);
  });

  test('URL with text + low elements gets 1.0 confidence', () => {
    const result = detectCaptcha(
      'https://example.com/captcha/check',
      'Please complete the security check',
      3
    );
    expect(result.textConfirm).toBe(true);
    expect(result.lowElements).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  test('URL with no text and no low elements gets 0.0 confidence', () => {
    const result = detectCaptcha(
      'https://example.com/recaptcha/v2',
      '',
      20
    );
    expect(result.textConfirm).toBe(false);
    expect(result.lowElements).toBe(false);
    expect(result.confidence).toBe(0.0);
  });

  test('low elements means <= 5 elements', () => {
    const low = detectCaptcha('https://example.com/captcha/', '', 5);
    expect(low.lowElements).toBe(true);
    const high = detectCaptcha('https://example.com/captcha/', '', 6);
    expect(high.lowElements).toBe(false);
  });

  test('content-based detection when no URL match', () => {
    const result = detectCaptcha(
      'https://example.com/verify-this',
      'verify that you are human to continue',
      8
    );
    // /verify[/?#]/i does NOT match because '-' is not in [/?#]
    // so this falls through to content-based (captcha_text) detection
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_text');
  });

  test('text-based detection without URL match needs <= 10 elements', () => {
    const result = detectCaptcha(
      'https://some-random-site.com/page',
      'Please prove you are not a robot',
      10
    );
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_text');
    expect(result.confidence).toBe(0.85);
  });

  test('text match with > 10 elements returns null', () => {
    const result = detectCaptcha(
      'https://some-random-site.com/page',
      'Please prove you are not a robot',
      11
    );
    expect(result).toBeNull();
  });

  test('unusual traffic text matches', () => {
    const result = detectCaptcha(
      'https://some-site.com/page',
      'Our systems have detected unusual traffic from your computer',
      5
    );
    expect(result).toBeTruthy();
  });

  test('completely clean URL and text returns null', () => {
    expect(detectCaptcha(
      'https://example.com/dashboard',
      'Welcome to the dashboard. You have 5 new notifications.',
      50
    )).toBeNull();
  });

  test('blocked in URL matches', () => {
    const result = detectCaptcha('https://www.amazon.com/blocked', '', 3);
    expect(result).toBeTruthy();
    expect(result.type).toBe('captcha_url');
  });

  test('access denied in URL matches', () => {
    const result = detectCaptcha('https://example.com/access-denied', '', 5);
    expect(result).toBeTruthy();
  });

  test('security check in URL matches', () => {
    const result = detectCaptcha('https://example.com/security-check', '', 5);
    expect(result).toBeTruthy();
  });

  test('cf-chl in URL matches Cloudflare challenge', () => {
    const result = detectCaptcha('https://example.com/cf-chl-bypass', '', 3);
    expect(result).toBeTruthy();
  });

  test('turnstile in URL matches', () => {
    const result = detectCaptcha('https://example.com/turnstile/verify', '', 5);
    expect(result).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// _describeTarget
// ══════════════════════════════════════════════════════════════════
describe('_describeTarget', () => {
  test('null returns (no target)', () => {
    expect(_describeTarget(null)).toBe('(no target)');
  });

  test('undefined returns (no target)', () => {
    expect(_describeTarget(undefined)).toBe('(no target)');
  });

  test('empty object returns (no target)', () => {
    expect(_describeTarget({})).toBe('(no target)');
  });

  test('ariaLabel takes priority', () => {
    expect(_describeTarget({ ariaLabel: 'Submit form', selector: '#btn', ref: 'ref1' })).toBe('"Submit form"');
  });

  test('elementText is second priority', () => {
    expect(_describeTarget({ elementText: 'Click me', selector: '#btn', ref: 'ref1' })).toBe('"Click me"');
  });

  test('label is third priority', () => {
    expect(_describeTarget({ label: 'Submit', selector: '#btn', ref: 'ref1' })).toBe('"Submit"');
  });

  test('selector is fourth priority', () => {
    expect(_describeTarget({ selector: '#my-button', ref: 'ref1' })).toBe('#my-button');
  });

  test('ref is fifth priority', () => {
    expect(_describeTarget({ ref: 'ref42' })).toBe('ref:ref42');
  });

  test('x,y coordinates as last resort', () => {
    expect(_describeTarget({ x: 150, y: 300 })).toBe('(150,300)');
  });

  test('ariaLabel is truncated to 80 chars', () => {
    const long = 'A'.repeat(200);
    const result = _describeTarget({ ariaLabel: long });
    expect(result.length).toBeLessThanOrEqual(82); // " + 80 + "
    expect(result).toContain('"');
  });
});

// ══════════════════════════════════════════════════════════════════
// describeAction
// ══════════════════════════════════════════════════════════════════
describe('describeAction', () => {
  test('click action', () => {
    const result = describeAction({ type: 'click', selector: '#btn' });
    expect(result).toContain('Click');
    expect(result).toContain('#btn');
  });

  test('type action with text', () => {
    const result = describeAction({ type: 'type', selector: 'input', text: 'hello world' });
    expect(result).toContain('Type');
    expect(result).toContain('hello world');
  });

  test('type action with long text is truncated', () => {
    const result = describeAction({ type: 'type', selector: 'input', text: 'A'.repeat(200) });
    expect(result.length).toBeLessThan(200);
  });

  test('navigate action', () => {
    expect(describeAction({ type: 'navigate', url: 'https://example.com' })).toContain('Navigate');
  });

  test('navigate action with no url', () => {
    expect(describeAction({ type: 'navigate' })).toContain('(no url)');
  });

  test('scroll action positive amount', () => {
    expect(describeAction({ type: 'scroll', amount: 100 })).toContain('down');
  });

  test('scroll action negative amount', () => {
    expect(describeAction({ type: 'scroll', amount: -100 })).toContain('up');
  });

  test('navigate_back action', () => {
    expect(describeAction({ type: 'navigate_back' })).toBe('Navigate back');
  });

  test('navigate_forward action', () => {
    expect(describeAction({ type: 'navigate_forward' })).toBe('Navigate forward');
  });

  test('press_key action', () => {
    expect(describeAction({ type: 'press_key', key: 'Enter' })).toContain('Enter');
  });

  test('execute_js action', () => {
    const result = describeAction({ type: 'execute_js', code: 'return document.title' });
    expect(result).toContain('Run JS');
    expect(result).toContain('return document.title');
  });

  test('extract action', () => {
    const result = describeAction({ type: 'extract', key: 'prices', selector: '.price' });
    expect(result).toContain('Extract');
    expect(result).toContain('prices');
  });

  test('extract_list action', () => {
    const result = describeAction({ type: 'extract_list', key: 'rows', selector: 'tr' });
    expect(result).toContain('Extract list');
    expect(result).toContain('rows');
  });

  test('note action', () => {
    const result = describeAction({ type: 'note', text: 'Found the button' });
    expect(result).toContain('Note');
    expect(result).toContain('Found the button');
  });

  test('finish action', () => {
    const result = describeAction({ type: 'finish', summary: 'All done' });
    expect(result).toContain('Finish');
    expect(result).toContain('All done');
  });

  test('open_tab action', () => {
    expect(describeAction({ type: 'open_tab', label: 'Portal' })).toContain('Open tab');
    expect(describeAction({ type: 'open_tab', label: 'Portal' })).toContain('Portal');
  });

  test('switch_tab action', () => {
    expect(describeAction({ type: 'switch_tab', label: 'Tab2' })).toContain('Switch to');
  });

  test('close_tab action', () => {
    expect(describeAction({ type: 'close_tab', tab_id: '5' })).toContain('Close tab');
  });

  test('read_page action', () => {
    expect(describeAction({ type: 'read_page' })).toBe('Read page');
  });

  test('dismiss_overlay action', () => {
    expect(describeAction({ type: 'dismiss_overlay' })).toBe('Dismiss overlay');
  });

  test('wait_for_text action', () => {
    const result = describeAction({ type: 'wait_for_text', text: 'Loading complete' });
    expect(result).toContain('Wait for text');
    expect(result).toContain('Loading complete');
  });

  test('wait_for_element action', () => {
    expect(describeAction({ type: 'wait_for_element', selector: '.loaded' })).toContain('Wait for element');
  });

  test('wait_for_navigation action', () => {
    expect(describeAction({ type: 'wait_for_navigation' })).toBe('Wait for navigation');
  });

  test('select action', () => {
    const result = describeAction({ type: 'select', value: 'Option A', selector: 'select' });
    expect(result).toContain('Select');
    expect(result).toContain('Option A');
  });

  test('hover action', () => {
    expect(describeAction({ type: 'hover', selector: '.menu' })).toContain('Hover');
  });

  test('check action', () => {
    expect(describeAction({ type: 'check', selector: '.checkbox' })).toContain('Check');
  });

  test('right_click action', () => {
    expect(describeAction({ type: 'right_click', selector: '#ctx' })).toContain('Right-click');
  });

  test('double_click action', () => {
    expect(describeAction({ type: 'double_click', selector: '#item' })).toContain('Double-click');
  });

  test('lookup action', () => {
    const result = describeAction({ type: 'lookup', domain: 'example.com', record_type: 'MX' });
    expect(result).toContain('DNS lookup');
    expect(result).toContain('example.com');
  });

  test('run_remote_command action', () => {
    const result = describeAction({ type: 'run_remote_command', command: 'Get-Process', command_type: 'powershell' });
    expect(result).toContain('Remote cmd');
    expect(result).toContain('Get-Process');
  });

  test('unknown type falls back to JSON preview', () => {
    const result = describeAction({ type: 'custom_unknown', foo: 'bar' });
    expect(result).toContain('custom_unknown');
  });

  test('open_tab with no label or url shows (no url)', () => {
    expect(describeAction({ type: 'open_tab' })).toContain('(no url)');
  });

  test('press_key with no key shows (no key)', () => {
    expect(describeAction({ type: 'press_key' })).toContain('(no key)');
  });

  test('lookup with no domain shows (no domain)', () => {
    expect(describeAction({ type: 'lookup', record_type: 'A' })).toContain('(no domain)');
  });

  test('type with no text shows empty quotes', () => {
    const result = describeAction({ type: 'type', selector: 'input' });
    expect(result).toContain("''");
  });
});

// ══════════════════════════════════════════════════════════════════
// _hostnameOf
// ══════════════════════════════════════════════════════════════════
describe('_hostnameOf', () => {
  test('valid URL returns hostname', () => {
    expect(_hostnameOf('https://login.microsoftonline.com/tenant/login')).toBe('login.microsoftonline.com');
  });

  test('invalid URL returns empty string', () => {
    expect(_hostnameOf('not-a-url')).toBe('');
  });

  test('null returns empty string', () => {
    expect(_hostnameOf(null)).toBe('');
  });

  test('empty string returns empty string', () => {
    expect(_hostnameOf('')).toBe('');
  });

  test('URL with port returns hostname without port', () => {
    expect(_hostnameOf('https://example.com:8080/path')).toBe('example.com');
  });
});

// ══════════════════════════════════════════════════════════════════
// _tenantsMatch
// ══════════════════════════════════════════════════════════════════
describe('_tenantsMatch', () => {
  test('empty expected returns true (no lock)', () => {
    expect(_tenantsMatch({ chipText: 'Contoso' }, '')).toBe(true);
  });

  test('null expected returns true (no lock)', () => {
    expect(_tenantsMatch({ chipText: 'Contoso' }, null)).toBe(true);
  });

  test('whitespace expected returns true (no lock)', () => {
    expect(_tenantsMatch({ chipText: 'Contoso' }, '   ')).toBe(true);
  });

  test('null detected with expected returns false', () => {
    expect(_tenantsMatch(null, 'Contoso')).toBe(false);
  });

  test('chipText matches expected', () => {
    expect(_tenantsMatch({ chipText: 'Contoso Ltd' }, 'contoso')).toBe(true);
  });

  test('onmicrosoft matches expected', () => {
    expect(_tenantsMatch({ onmicrosoft: 'contoso.onmicrosoft.com' }, 'contoso')).toBe(true);
  });

  test('tid matches expected', () => {
    expect(_tenantsMatch({ tid: 'abc-123-def' }, 'abc-123')).toBe(true);
  });

  test('expected includes detected value', () => {
    expect(_tenantsMatch({ chipText: 'con' }, 'contoso')).toBe(true);
  });

  test('case insensitive matching', () => {
    expect(_tenantsMatch({ chipText: 'CONTOSO' }, 'Contoso')).toBe(true);
  });

  test('no match returns false', () => {
    expect(_tenantsMatch({ chipText: 'Fabrikam', onmicrosoft: 'fabrikam.onmicrosoft.com', tid: 'xyz-789' }, 'contoso')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// _countSummaryClaims — deep edge cases
// ══════════════════════════════════════════════════════════════════
describe('_countSummaryClaims deep', () => {
  test('null returns 0', () => {
    expect(_countSummaryClaims(null)).toBe(0);
  });

  test('number input returns 0', () => {
    expect(_countSummaryClaims(12345)).toBe(0);
  });

  test('empty string returns 0', () => {
    expect(_countSummaryClaims('')).toBe(0);
  });

  test('numbered list with hash prefix', () => {
    expect(_countSummaryClaims('## 1. First\n## 2. Second\n## 3. Third')).toBe(3);
  });

  test('table rows subtracts header + separator', () => {
    const table = '| Name | Value |\n|------|-------|\n| A | 1 |\n| B | 2 |\n| C | 3 |';
    expect(_countSummaryClaims(table)).toBe(3); // 5 rows - 2 = 3
  });

  test('table with no data rows returns 0 (negative clamped)', () => {
    const table = '| Name | Value |\n|------|-------|';
    expect(_countSummaryClaims(table)).toBe(0);
  });

  test('bullet list', () => {
    expect(_countSummaryClaims('- item one\n- item two\n- item three')).toBe(3);
  });

  test('asterisk bullets', () => {
    expect(_countSummaryClaims('* first\n* second')).toBe(2);
  });

  test('returns max of numbered, tableRows, bullets', () => {
    const text = '1. One\n2. Two\n- A\n- B\n- C\n- D';
    // numbered = 2, bullets = 4, so should return 4
    expect(_countSummaryClaims(text)).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════
// _countSpecificClaims — deep edge cases
// ══════════════════════════════════════════════════════════════════
describe('_countSpecificClaims deep', () => {
  test('null returns 0', () => {
    expect(_countSpecificClaims(null)).toBe(0);
  });

  test('empty string returns 0', () => {
    expect(_countSpecificClaims('')).toBe(0);
  });

  test('numbers with commas', () => {
    expect(_countSpecificClaims('Found 1,234 and 56,789 items')).toBe(2);
  });

  test('percentages', () => {
    expect(_countSpecificClaims('47% increase and 15.5% decrease')).toBe(2);
  });

  test('dollar amounts', () => {
    expect(_countSpecificClaims('$5M budget and $12,345 spent')).toBeGreaterThanOrEqual(2);
  });

  test('ISO dates', () => {
    // 2024 matches \d[\d,]{3,} (4+ digit number) AND the ISO date regex
    // so each date gets counted multiple times across regex patterns
    expect(_countSpecificClaims('From 2024-01-15 to 2024-06-30')).toBeGreaterThanOrEqual(2);
  });

  test('written-out dates', () => {
    // 2024 triggers the 4+ digit number pattern too
    expect(_countSpecificClaims('Between January 5, 2024 and March 15')).toBeGreaterThanOrEqual(2);
  });

  test('no specific claims in prose', () => {
    expect(_countSpecificClaims('The server is running fine and everything looks good')).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// _countSourceTags — deep edge cases
// ══════════════════════════════════════════════════════════════════
describe('_countSourceTags deep', () => {
  test('null returns 0', () => {
    expect(_countSourceTags(null)).toBe(0);
  });

  test('empty string returns 0', () => {
    expect(_countSourceTags('')).toBe(0);
  });

  test('src tags counted', () => {
    expect(_countSourceTags('Data from [src:entra_log] and [src:exchange_rules]')).toBe(2);
  });

  test('unverified tags counted', () => {
    expect(_countSourceTags('This is [unverified] and that is [unverified]')).toBe(2);
  });

  test('mixed src and unverified', () => {
    expect(_countSourceTags('[src:key1] data and [unverified] claim')).toBe(2);
  });

  test('case insensitive src tag', () => {
    expect(_countSourceTags('[SRC:DATA]')).toBe(1);
  });

  test('no tags returns 0', () => {
    expect(_countSourceTags('Just some plain text with no tags')).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// evaluateHallucinationRisk — additional edge cases
// ══════════════════════════════════════════════════════════════════
describe('evaluateHallucinationRisk — additional edge cases', () => {
  test('risky: specificClaims >= 5, sourceTags === 0', () => {
    const summary = 'Found 1,234 records with 47% failing, $5M loss, 2024-01-15 incident, 56,789 affected, 110,000 total';
    const result = evaluateHallucinationRisk(summary, {}, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('specific claims');
    expect(result.reason).toContain('citations');
  });

  test('risky: specificClaims >= 8 with too few sourceTags (ratio)', () => {
    const summary = 'Data shows 1,234 issues, 56% affected, $10M cost, 2024-01-01 start, 2024-06-30 end, 99,999 tickets, 42,000 resolved, $3.5M remaining [src:key1]';
    const result = evaluateHallucinationRisk(summary, { key1: 'val' }, []);
    expect(result.risky).toBe(true);
    expect(result.reason).toContain('source tags');
  });

  test('not risky with many source tags', () => {
    const summary = '1. Found A [src:data1]\n2. Found B [src:data2]\n3. Found C [src:data3]';
    const result = evaluateHallucinationRisk(summary, { data1: 'a', data2: 'b', data3: 'c' }, []);
    expect(result.risky).toBe(false);
  });

  test('not risky: 2 claims, 0 evidence (below threshold)', () => {
    const summary = '1. Found A\n2. Found B';
    expect(evaluateHallucinationRisk(summary, {}, []).risky).toBe(false);
  });

  test('null summary returns not risky', () => {
    expect(evaluateHallucinationRisk(null, {}, []).risky).toBe(false);
  });

  test('claims with unverified caveat bypass ratio check', () => {
    const summary = '1. A\n2. B\n3. C\n4. D\n5. E (unverified)';
    const result = evaluateHallucinationRisk(summary, { key1: 'val' }, []);
    expect(result.risky).toBe(false);
    expect(result.hasCaveats).toBe(true);
  });

  test('returns evidence count from memory keys + note actions', () => {
    const history = [
      { action: { type: 'note', text: 'test' }, result: 'ok' },
      { action: { type: 'click' }, result: 'ok' },
      { action: { type: 'note', text: 'test2' }, result: 'ok' },
    ];
    const result = evaluateHallucinationRisk('1. A\n2. B', { key1: 'v', key2: 'v' }, history);
    expect(result.evidence).toBe(4); // 2 memory keys + 2 note actions
    expect(result.risky).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// _generateSmartRecovery — URL-based strategies
// ══════════════════════════════════════════════════════════════════
describe('_generateSmartRecovery', () => {
  test('amazon search URL gets sort strategies', () => {
    const result = _generateSmartRecovery('find top 5', 'https://amazon.com/s?k=laptop', '', '', [], 0);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(s => s.includes('review-rank'))).toBe(true);
    expect(result.some(s => s.includes('price-asc-rank'))).toBe(true);
  });

  test('amazon product page gets extract strategy', () => {
    const result = _generateSmartRecovery('get price', 'https://amazon.com/dp/B08N5WRWNW', '', '', [], 0);
    expect(result.some(s => s.includes('execute_js'))).toBe(true);
  });

  test('reddit gets extract strategy', () => {
    const result = _generateSmartRecovery('find posts', 'https://www.reddit.com/r/technology', '', '', [], 0);
    expect(result.some(s => s.includes('post-container'))).toBe(true);
  });

  test('reddit search gets sort strategy', () => {
    const result = _generateSmartRecovery('find posts', 'https://www.reddit.com/search/?q=ai', '', '', [], 0);
    expect(result.some(s => s.includes('sort=top'))).toBe(true);
  });

  test('google search gets extract strategy', () => {
    const result = _generateSmartRecovery('find results', 'https://www.google.com/search?q=test', '', '', [], 0);
    expect(result.some(s => s.includes('.g'))).toBe(true);
  });

  test('youtube gets extract strategy', () => {
    const result = _generateSmartRecovery('find videos', 'https://www.youtube.com/results?search_query=test', '', '', [], 0);
    expect(result.some(s => s.includes('ytd-video-renderer'))).toBe(true);
  });

  test('news site gets article extract strategy', () => {
    const result = _generateSmartRecovery('find articles', 'https://www.cnn.com/world', '', '', [], 0);
    expect(result.some(s => s.includes('article'))).toBe(true);
  });

  test('generic site with top N goal', () => {
    const result = _generateSmartRecovery('find the top 10 items', 'https://shop.example.com', '', '', [], 0);
    expect(result.some(s => s.includes('execute_js'))).toBe(true);
  });

  test('multi-site goal gets navigate strategy', () => {
    const result = _generateSmartRecovery('check this then go to other site', 'https://example.com', '', '', [], 0);
    expect(result.some(s => s.includes('navigate with direct URL'))).toBe(true);
  });

  test('empty inputs still get generic strategies', () => {
    const result = _generateSmartRecovery('', '', '', '', [], 0);
    // The function always adds generic fallback strategies
    expect(result.length).toBeGreaterThan(0);
  });
});
