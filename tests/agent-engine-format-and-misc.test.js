// tests/agent-engine-format-and-misc.test.js
// Branch-coverage tests for ticket formatters, progress update,
// heuristic plan, pre-finish completeness, and misc pure functions.

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

// ── Import real exports ──
const {
  formatItGlueKb,
  formatClientEmail,
  formatWaitingOnClient,
  formatWaitingOnVendor,
  formatTicketOutput,
  formatTicketFinalNotes,
  formatTicketKickoff,
  generateHeuristicPlan,
  _checkPreFinishCompleteness,
  _autoPickFormat,
  extractTicketNumber,
  isTicketInvestigationGoal,
  getTechnicianInfo,
  captureReportData,
  _detectGoalModeDirective,
} = await import('../background/agent-engine.js');

const mockTech = {
  name: 'John Smith',
  title: 'IT Support Technician',
  company: 'Acme IT',
  phone: '555-000-0000',
  email: 'support@example.com',
};

// ══════════════════════════════════════════════════════════════════
// formatItGlueKb — environment detection branches
// ══════════════════════════════════════════════════════════════════
describe('formatItGlueKb — environment detection branches', () => {
  test('M365/Entra environment detected', () => {
    const result = formatItGlueKb('Fixed it', 'Investigate Entra login issue #12345', mockTech);
    expect(result).toContain('Microsoft 365');
  });

  test('Firewall environment detected', () => {
    const result = formatItGlueKb('Fixed it', 'Check SonicWall firewall rules #555', mockTech);
    expect(result).toContain('Firewall');
  });

  test('EDR environment detected', () => {
    const result = formatItGlueKb('Resolved threat', 'Investigate SentinelOne threat #789', mockTech);
    expect(result).toContain('EDR');
  });

  test('RMM/PSA environment detected', () => {
    const result = formatItGlueKb('Done', 'Check ConnectWise manage ticket #444', mockTech);
    expect(result).toContain('RMM/PSA');
  });

  test('No environment match defaults to General', () => {
    const result = formatItGlueKb('Fixed printer', 'Fix HP printer jam', mockTech);
    expect(result).toContain('General');
  });

  test('Ticket number in goal creates Ref in title', () => {
    const result = formatItGlueKb('Steps taken', 'Investigate ticket #99999 alert', mockTech);
    expect(result).toContain('Ticket #99999');
  });

  test('No ticket number omits Ref', () => {
    const result = formatItGlueKb('Steps taken', 'Fix the printer', mockTech);
    expect(result).not.toContain('Ref:');
  });

  test('Numbered/bulleted lines become steps', () => {
    const summary = '1. First step done\n2. Second step done\n3. Third step done';
    const result = formatItGlueKb(summary, 'Fix things #12345', mockTech);
    expect(result).toContain('1. First step done');
  });

  test('Empty summary gets fallback steps', () => {
    const result = formatItGlueKb('', 'Fix things', mockTech);
    expect(result).toContain('IT Glue');
  });

  test('Null summary handled', () => {
    const result = formatItGlueKb(null, 'Fix things', mockTech);
    expect(result).toContain('(no summary)');
  });
});

// ══════════════════════════════════════════════════════════════════
// formatClientEmail — branches
// ══════════════════════════════════════════════════════════════════
describe('formatClientEmail — branches', () => {
  test('with ticket number', () => {
    const result = formatClientEmail('Resolved the issue', 'Investigate ticket #12345', mockTech);
    expect(result).toContain('Ticket #12345');
  });

  test('without ticket number', () => {
    const result = formatClientEmail('Resolved', 'Fix the thing', mockTech);
    expect(result).toContain('your recent ticket');
  });

  test('null summary handled', () => {
    const result = formatClientEmail(null, 'Fix things', mockTech);
    expect(result).toBeTruthy();
  });

  test('summary with long text gets truncated', () => {
    const longSummary = 'A'.repeat(500);
    const result = formatClientEmail(longSummary, 'Fix ticket #12345', mockTech);
    expect(result).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// formatWaitingOnClient — branches
// ══════════════════════════════════════════════════════════════════
describe('formatWaitingOnClient — branches', () => {
  test('with ticket number', () => {
    const result = formatWaitingOnClient('Need more info', 'Check ticket #55555', mockTech);
    expect(result).toContain('Ticket #55555');
  });

  test('without ticket number', () => {
    const result = formatWaitingOnClient('Need info', 'Help the client', mockTech);
    expect(result).toBeTruthy();
  });

  test('null summary', () => {
    const result = formatWaitingOnClient(null, 'Need more info', mockTech);
    expect(result).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// formatWaitingOnVendor — branches
// ══════════════════════════════════════════════════════════════════
describe('formatWaitingOnVendor — branches', () => {
  test('with ticket number', () => {
    const result = formatWaitingOnVendor('Sent to vendor', 'Escalate ticket #77777', mockTech);
    expect(result).toContain('Ticket #77777');
  });

  test('without ticket number', () => {
    const result = formatWaitingOnVendor('Sent to vendor', 'Escalate issue', mockTech);
    expect(result).toBeTruthy();
  });

  test('null summary', () => {
    const result = formatWaitingOnVendor(null, 'Escalate issue', mockTech);
    expect(result).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
// formatTicketOutput — dispatch routing
// ══════════════════════════════════════════════════════════════════
describe('formatTicketOutput — dispatch routing', () => {
  const tech = mockTech;
  const summary = 'Found the issue and fixed it';
  const goal = 'Investigate ticket #12345';

  test('TICKET_KICKOFF format', () => {
    const result = formatTicketOutput('TICKET_KICKOFF', summary, goal, tech);
    expect(result).toContain('Ticket Kickoff');
  });

  test('FINAL_NOTES format', () => {
    const result = formatTicketOutput('FINAL_NOTES', summary, goal, tech);
    expect(result).toContain('Final Notes');
  });

  test('WAITING_ON_CLIENT format', () => {
    const result = formatTicketOutput('WAITING_ON_CLIENT', summary, goal, tech);
    expect(result).toContain('Waiting on Client');
  });

  test('WAITING_ON_VENDOR format', () => {
    const result = formatTicketOutput('WAITING_ON_VENDOR', summary, goal, tech);
    expect(result).toContain('Waiting on Vendor');
  });

  test('IT_GLUE_KB format', () => {
    const result = formatTicketOutput('IT_GLUE_KB', summary, goal, tech);
    expect(result).toContain('IT Glue');
  });

  test('CLIENT_EMAIL format', () => {
    const result = formatTicketOutput('CLIENT_EMAIL', summary, goal, tech);
    expect(result).toContain('Client');
  });

  test('unknown format falls back to FINAL_NOTES', () => {
    const result = formatTicketOutput('UNKNOWN_FORMAT', summary, goal, tech);
    expect(result).toContain('Final Notes');
  });
});

// ══════════════════════════════════════════════════════════════════
// _checkPreFinishCompleteness — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('_checkPreFinishCompleteness — branch coverage', () => {
  test('null goal returns null', () => {
    expect(_checkPreFinishCompleteness(null, {}, [])).toBeNull();
  });

  test('null memory returns null', () => {
    expect(_checkPreFinishCompleteness('extract stuff', null, [])).toBeNull();
  });

  test('no field list pattern returns null', () => {
    expect(_checkPreFinishCompleteness('Just fix the thing', {}, [])).toBeNull();
  });

  test('single field returns null (fewer than 2 rawFields)', () => {
    expect(_checkPreFinishCompleteness('extract: something', {}, [])).toBeNull();
  });

  test('all fields present in memory returns null', () => {
    const mem = { cve_id: 'CVE-2024-1234', cvss_score: '9.8' };
    expect(_checkPreFinishCompleteness(
      'For each CVE, extract: the CVE ID, CVSS v3 base score',
      mem, []
    )).toBeNull();
  });

  test('more than half fields missing returns gap string', () => {
    const mem = {};
    const result = _checkPreFinishCompleteness(
      'For each vulnerability, extract: the CVE ID, CVSS v3 base score, affected versions',
      mem, []
    );
    expect(result).toBeTruthy();
    expect(result).toContain('Memory is missing');
  });

  test('fewer than half fields missing returns null', () => {
    const mem = { cve_id: 'CVE-2024-1234', cvss_base: '9.8', affected_versions: 'all versions' };
    const result = _checkPreFinishCompleteness(
      'For each CVE, extract: the CVE ID, CVSS base score, affected versions, patch date',
      mem, []
    );
    // 1 out of 4 missing = 0.25, which is < 0.5 → returns null
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// generateHeuristicPlan — bare site partial match (line 2988)
// ══════════════════════════════════════════════════════════════════
describe('generateHeuristicPlan — bare site partial match', () => {
  test('bare site name "hacker news" maps correctly', () => {
    const plan = generateHeuristicPlan('go to hacker news and find articles', '');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('news.ycombinator.com'))).toBe(true);
  });

  test('bare site name "HN" maps correctly', () => {
    const plan = generateHeuristicPlan('go to HN', '');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('news.ycombinator.com'))).toBe(true);
  });

  test('bare site name "stack overflow" maps correctly', () => {
    const plan = generateHeuristicPlan('check stack overflow for solutions', '');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('stackoverflow.com'))).toBe(true);
  });

  test('partial bare site match via substring (line 2988)', () => {
    const plan = generateHeuristicPlan('go to amaz and search', '');
    // "amaz" should partial-match "amazon"
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('amazon.com'))).toBe(true);
  });

  test('unknown bare site falls through to generic plan', () => {
    const plan = generateHeuristicPlan('go to mysite', '');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('current page') || s.includes('key information'))).toBe(true);
  });

  test('URL already matched site skips navigation', () => {
    const plan = generateHeuristicPlan('go to amazon', 'https://www.amazon.com');
    expect(plan).toBeTruthy();
    // Should NOT navigate since already there
    expect(plan.some(s => s.includes('Navigate to'))).toBe(false);
  });

  test('multi-page research pattern with search query', () => {
    const plan = generateHeuristicPlan('find the top 5 articles about cybersecurity', '');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('execute_js'))).toBe(true);
  });

  test('multi-page research with URL target', () => {
    const plan = generateHeuristicPlan('visit https://example.com and find top 3 sources', '');
    expect(plan).toBeTruthy();
    expect(plan.some(s => s.includes('example.com'))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// _autoPickFormat — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('_autoPickFormat', () => {
  test('kickoff keywords return TICKET_KICKOFF', () => {
    expect(_autoPickFormat('', 'investigate this ticket #123')).toBe('TICKET_KICKOFF');
  });

  test('waiting on client returns WAITING_ON_CLIENT', () => {
    expect(_autoPickFormat('', 'waiting on client callback')).toBe('WAITING_ON_CLIENT');
  });

  test('vendor escalation returns WAITING_ON_VENDOR', () => {
    expect(_autoPickFormat('', 'waiting on the vendor case')).toBe('WAITING_ON_VENDOR');
  });

  test('email draft returns CLIENT_EMAIL', () => {
    expect(_autoPickFormat('', 'draft an email to the client')).toBe('CLIENT_EMAIL');
  });

  test('kb keyword returns IT_GLUE_KB', () => {
    expect(_autoPickFormat('', 'create a knowledge base entry in IT Glue')).toBe('IT_GLUE_KB');
  });

  test('no keyword match returns FINAL_NOTES', () => {
    expect(_autoPickFormat('done', 'fixed the thing')).toBe('FINAL_NOTES');
  });
});

// ══════════════════════════════════════════════════════════════════
// _detectGoalModeDirective — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('_detectGoalModeDirective', () => {
  test('null goal returns detected:false', () => {
    expect(_detectGoalModeDirective(null).detected).toBe(false);
  });

  test('empty string returns detected:false', () => {
    expect(_detectGoalModeDirective('').detected).toBe(false);
  });

  test('approval mode explicit detected', () => {
    const result = _detectGoalModeDirective('Mode: APPROVAL — investigate the alert');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
    expect(result.confidence).toBe('high');
  });

  test('autonomous mode explicit detected', () => {
    const result = _detectGoalModeDirective('Mode: AUTONOMOUS — fix the thing');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('YOLO mode maps to autonomous', () => {
    const result = _detectGoalModeDirective('run in YOLO mode');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('approval mode phrasing detected (tier 2)', () => {
    const result = _detectGoalModeDirective('switch to approval mode');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
  });

  test('autonomous mode phrasing detected (tier 2)', () => {
    const result = _detectGoalModeDirective('run in autonomous mode');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
  });

  test('tier 3: agent pauses for approval phrase', () => {
    const result = _detectGoalModeDirective('sentinel pauses for technician approval before each step');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('approval');
    expect(result.confidence).toBe('medium');
  });

  test('tier 4: no approvals required', () => {
    const result = _detectGoalModeDirective('execute all steps autonomously without pausing');
    expect(result.detected).toBe(true);
    expect(result.wants).toBe('autonomous');
    expect(result.confidence).toBe('medium');
  });

  test('no mode directive returns detected:false', () => {
    expect(_detectGoalModeDirective('just fix the thing').detected).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// extractTicketNumber — edge cases
// ══════════════════════════════════════════════════════════════════
describe('extractTicketNumber — edge cases', () => {
  test('null returns empty', () => {
    expect(extractTicketNumber(null)).toBe('');
  });

  test('incident number pattern', () => {
    expect(extractTicketNumber('check incident #5678')).toBe('5678');
  });

  test('alert number pattern', () => {
    expect(extractTicketNumber('review alert #9999')).toBe('9999');
  });

  test('hash-only pattern', () => {
    expect(extractTicketNumber('look at #1234')).toBe('1234');
  });

  test('no match returns empty', () => {
    expect(extractTicketNumber('fix the printer')).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════
// getTechnicianInfo — async function
// ══════════════════════════════════════════════════════════════════
describe('getTechnicianInfo', () => {
  test('returns defaults when storage is empty', async () => {
    storageData.technicianInfo = undefined;
    const info = await getTechnicianInfo();
    expect(info.name).toBe('John Smith');
    expect(info.company).toBe('Acme IT');
  });

  test('merges stored info with defaults', async () => {
    storageData.technicianInfo = { name: 'Test Tech', phone: '555-1234' };
    const info = await getTechnicianInfo();
    expect(info.name).toBe('Test Tech');
    expect(info.phone).toBe('555-1234');
    expect(info.company).toBe('Acme IT');
  });
});

// ══════════════════════════════════════════════════════════════════
// captureReportData — branch coverage
// ══════════════════════════════════════════════════════════════════
describe('captureReportData', () => {
  test('returns report data object', () => {
    const result = captureReportData(
      'test goal',
      [{ step: 1, action: { type: 'click' }, result: 'ok' }],
      { key1: 'val1' },
      ['step 1'],
      5,
      3
    );
    expect(result).toBeTruthy();
    expect(result.goal).toBe('test goal');
  });

  test('empty history handled', () => {
    const result = captureReportData('goal', [], {}, [], 0, 0);
    expect(result).toBeTruthy();
    expect(result.goal).toBe('goal');
    expect(result.stepCount).toBe(0);
  });
});
