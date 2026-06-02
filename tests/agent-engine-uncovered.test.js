// tests/agent-engine-uncovered.test.js
// Tests for previously uncovered code paths in background/agent-engine.js.

import { jest } from '@jest/globals';

// ── Chrome API mock (same pattern as agent-engine.test.js) ──
const storageData = {};
const sessionData = {};
let onMessageListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[k]);
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

// Store message-protocol mock functions
const mockSendSilentUpdate = jest.fn();
const mockSendActionMessage = jest.fn();
const mockSendActionResult = jest.fn();
const mockSendReportUpdate = jest.fn();
const mockSendPageContext = jest.fn();
const mockSendTabStateUpdate = jest.fn();
const mockSendScreenshotUpdate = jest.fn();
const mockSendAgentActivity = jest.fn();
const mockSendAgentStepStart = jest.fn();

jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendSilentUpdate: mockSendSilentUpdate,
  sendActionMessage: mockSendActionMessage,
  sendActionResult: mockSendActionResult,
  sendReportUpdate: mockSendReportUpdate,
  sendPageContext: mockSendPageContext,
  sendTabStateUpdate: mockSendTabStateUpdate,
  sendScreenshotUpdate: mockSendScreenshotUpdate,
  sendAgentActivity: mockSendAgentActivity,
  sendAgentStepStart: mockSendAgentStepStart,
  sendAgentStatus: jest.fn(),
  sendHeartbeat: jest.fn(),
  sendPlanPreview: jest.fn(), sendClientKnowledgePreview: jest.fn(), sendCostUpdate: jest.fn(),
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

// Store tab-context mock functions
const mockGetActiveTabId = jest.fn(() => null);
const mockSetActiveTab = jest.fn();
const mockGetTabContext = jest.fn(() => null);
const mockGetAllTabContexts = jest.fn(() => []);
const mockOpenTab = jest.fn(async () => 2);
const mockSwitchToTab = jest.fn(async () => {});
const mockCloseTab = jest.fn(async () => {});
const mockCloseAllAgentTabs = jest.fn(async () => {});
const mockUpdateSnapshot = jest.fn();
const mockResetAllContexts = jest.fn();
const mockFindTabByLabel = jest.fn(() => null);
const mockRegisterInitialTab = jest.fn();
const mockHandleTabRemoved = jest.fn();
const mockGetTabCount = jest.fn(() => 0);

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: mockGetActiveTabId,
  setActiveTab: mockSetActiveTab,
  getTabContext: mockGetTabContext,
  getAllTabContexts: mockGetAllTabContexts,
  openTab: mockOpenTab,
  switchToTab: mockSwitchToTab,
  closeTab: mockCloseTab,
  closeAllAgentTabs: mockCloseAllAgentTabs,
  updateSnapshot: mockUpdateSnapshot,
  resetAllContexts: mockResetAllContexts,
  findTabByLabel: mockFindTabByLabel,
  registerInitialTab: mockRegisterInitialTab,
  handleTabRemoved: mockHandleTabRemoved,
  getTabCount: mockGetTabCount,
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

// Import the module under test — all test-only exports are available
const {
  captureReportData,
  maybePostProgressUpdate,
  _countSummaryClaims,
  _tenantsMatch,
  _hostnameOf,
  _autoPickFormat,
  formatTicketOutput,
  formatTicketKickoff,
  formatTicketFinalNotes,
  formatWaitingOnClient,
  formatWaitingOnVendor,
  formatItGlueKb,
  formatClientEmail,
  generateHeuristicPlan,
  _updateRunLogIndex,
} = await import('../background/agent-engine.js');

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  Object.keys(sessionData).forEach(k => delete sessionData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────

describe('agent-engine uncovered paths', () => {

  // ═══════════════════════════════════════════════════════════════════
  // 1. captureReportData
  // ═══════════════════════════════════════════════════════════════════
  describe('captureReportData', () => {
    test('maps tabContexts with label, url, hasScreenshot', () => {
      mockGetAllTabContexts.mockReturnValueOnce([
        { label: 'tab1', url: 'https://example.com', snapshot: 'data:image/png;base64,abc' },
        { label: 'tab2', url: 'https://other.com', snapshot: null },
        { label: 'tab3', url: 'https://third.com' },
      ]);
      const data = captureReportData('my goal', [{ step: 1 }], { key1: 'val1' }, ['plan step'], 5, 3);
      expect(data.goal).toBe('my goal');
      expect(data.history).toEqual([{ step: 1 }]);
      expect(data.agentMemory).toEqual({ key1: 'val1' });
      expect(data.agentPlan).toEqual(['plan step']);
      expect(data.stepCount).toBe(5);
      expect(data.apiCallCount).toBe(3);
      expect(data.tabContexts).toEqual([
        { label: 'tab1', url: 'https://example.com', hasScreenshot: true },
        { label: 'tab2', url: 'https://other.com', hasScreenshot: false },
        { label: 'tab3', url: 'https://third.com', hasScreenshot: false },
      ]);
    });

    test('handles null plan', () => {
      mockGetAllTabContexts.mockReturnValueOnce([]);
      const data = captureReportData('goal', [], {}, null, 0, 0);
      expect(data.agentPlan).toBeNull();
    });

    test('returns a shallow copy of history (not the same array ref)', () => {
      const hist = [{ step: 1 }, { step: 2 }];
      mockGetAllTabContexts.mockReturnValueOnce([]);
      const data = captureReportData('goal', hist, {}, null, 0, 0);
      expect(data.history).toEqual(hist);
      expect(data.history).not.toBe(hist);
    });

    test('returns a shallow copy of agentMemory (not the same object ref)', () => {
      const mem = { a: 'b' };
      mockGetAllTabContexts.mockReturnValueOnce([]);
      const data = captureReportData('goal', [], mem, null, 0, 0);
      expect(data.agentMemory).toEqual(mem);
      expect(data.agentMemory).not.toBe(mem);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. maybePostProgressUpdate
  // ═══════════════════════════════════════════════════════════════════
  describe('maybePostProgressUpdate', () => {
    test('fires at interval 25', () => {
      const hist = [
        { action: { type: 'navigate', url: 'https://entra.microsoft.com' } },
        { action: { type: 'extract', url: '' } },
      ];
      maybePostProgressUpdate(25, hist, { key1: 'val1' });
      expect(mockSendSilentUpdate).toHaveBeenCalledTimes(1);
      const call = mockSendSilentUpdate.mock.calls[0];
      if (!call || !call[0]) {
        throw new Error('mock not called with arguments');
      }
      expect(call[1]).toBe(25);
      expect(call[0]).toContain('PROGRESS UPDATE');
      expect(call[0]).toContain('step 25');
      expect(call[0]).toContain('Entra');
      expect(call[0]).toContain('Data points in memory: 1');
    });

    test('fires at interval 50', () => {
      maybePostProgressUpdate(50, [], {});
      expect(mockSendSilentUpdate).toHaveBeenCalledTimes(1);
    });

    test('skips at non-interval step', () => {
      maybePostProgressUpdate(10, [], {});
      expect(mockSendSilentUpdate).not.toHaveBeenCalled();
    });

    test('skips at step 0', () => {
      maybePostProgressUpdate(0, [], {});
      expect(mockSendSilentUpdate).not.toHaveBeenCalled();
    });

    test('detects multiple portal types', () => {
      const hist = [
        { action: { type: 'navigate', url: 'https://admin.exchange.microsoft.com' } },
        { action: { type: 'navigate', url: 'https://purview.microsoft.com' } },
        { action: { type: 'navigate', url: 'https://security.microsoft.com' } },
      ];
      maybePostProgressUpdate(25, hist, {});
      expect(mockSendSilentUpdate).toHaveBeenCalledTimes(1);
      const msg = mockSendSilentUpdate.mock.calls[0]?.[0];
      expect(msg).toContain('Exchange');
      expect(msg).toContain('Purview');
      expect(msg).toContain('Defender');
    });

    test('handles empty history gracefully', () => {
      maybePostProgressUpdate(25, [], {});
      expect(mockSendSilentUpdate).toHaveBeenCalledTimes(1);
      const msg = mockSendSilentUpdate.mock.calls[0]?.[0];
      expect(msg).toContain('(none yet)');
      expect(msg).toContain('(none)');
    });

    test('handles null entries in history', () => {
      maybePostProgressUpdate(25, [null, { action: null }, { action: { type: 'click' } }], {});
      expect(mockSendSilentUpdate).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. _countSummaryClaims
  // ═══════════════════════════════════════════════════════════════════
  describe('_countSummaryClaims', () => {
    test('counts numbered list entries', () => {
      const summary = '1. First item\n2. Second item\n3. Third item';
      expect(_countSummaryClaims(summary)).toBe(3);
    });

    test('counts bullet list entries', () => {
      const summary = '- Bullet one\n- Bullet two\n- Bullet three\n- Bullet four';
      expect(_countSummaryClaims(summary)).toBe(4);
    });

    test('counts markdown table rows (minus header + separator)', () => {
      const summary = '| Header 1 | Header 2 |\n|---|---|\n| Row 1 | Data |\n| Row 2 | Data |';
      // 4 table row matches - 2 = 2
      expect(_countSummaryClaims(summary)).toBe(2);
    });

    test('returns 0 for null', () => {
      expect(_countSummaryClaims(null)).toBe(0);
    });

    test('returns 0 for empty string', () => {
      expect(_countSummaryClaims('')).toBe(0);
    });

    test('returns 0 for non-string', () => {
      expect(_countSummaryClaims(123)).toBe(0);
    });

    test('returns 0 for plain text without lists', () => {
      expect(_countSummaryClaims('Just a regular paragraph of text.')).toBe(0);
    });

    test('picks the densest signal', () => {
      // Numbered: 2, Bullets: 5 -> should return 5
      const summary = '1. First\n2. Second\n- A\n- B\n- C\n- D\n- E';
      expect(_countSummaryClaims(summary)).toBe(5);
    });

    test('handles ##-prefixed numbered list entries', () => {
      const summary = '## 1. Item one\n## 2. Item two';
      expect(_countSummaryClaims(summary)).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. _tenantsMatch
  // ═══════════════════════════════════════════════════════════════════
  describe('_tenantsMatch', () => {
    test('returns true when expected is empty', () => {
      expect(_tenantsMatch(null, '')).toBe(true);
    });

    test('returns true when expected is whitespace', () => {
      expect(_tenantsMatch(null, '   ')).toBe(true);
    });

    test('returns false when expected is set but detected is null', () => {
      expect(_tenantsMatch(null, 'expected')).toBe(false);
    });

    test('matches via chipText', () => {
      const detected = { chipText: 'MyTenant', onmicrosoft: 'other.onmicrosoft.com', tid: 'tid-123' };
      expect(_tenantsMatch(detected, 'MyTenant')).toBe(true);
    });

    test('matches via onmicrosoft', () => {
      const detected = { chipText: 'Other', onmicrosoft: 'expected.onmicrosoft.com', tid: 'tid-123' };
      expect(_tenantsMatch(detected, 'expected.onmicrosoft.com')).toBe(true);
    });

    test('matches via tid', () => {
      const detected = { chipText: 'Other', onmicrosoft: 'other.onmicrosoft.com', tid: 'abc-123-def' };
      expect(_tenantsMatch(detected, 'abc-123-def')).toBe(true);
    });

    test('case-insensitive match', () => {
      const detected = { chipText: 'MYTENANT', onmicrosoft: '', tid: '' };
      expect(_tenantsMatch(detected, 'mytenant')).toBe(true);
    });

    test('returns false when no signals match', () => {
      const detected = { chipText: 'Completely Different', onmicrosoft: 'other.onmicrosoft.com', tid: 'tid-999' };
      expect(_tenantsMatch(detected, 'expected')).toBe(false);
    });

    test('substring match works bidirectionally', () => {
      // expected includes detected signal
      const detected1 = { chipText: 'contoso', onmicrosoft: '', tid: '' };
      expect(_tenantsMatch(detected1, 'contoso.onmicrosoft.com')).toBe(true);

      // detected signal includes expected
      const detected2 = { chipText: 'contoso.onmicrosoft.com', onmicrosoft: '', tid: '' };
      expect(_tenantsMatch(detected2, 'contoso')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. _hostnameOf
  // ═══════════════════════════════════════════════════════════════════
  describe('_hostnameOf', () => {
    test('extracts hostname from valid URL', () => {
      expect(_hostnameOf('https://admin.microsoft.com/some/path')).toBe('admin.microsoft.com');
    });

    test('extracts hostname without port (URL.hostname omits port)', () => {
      expect(_hostnameOf('https://example.com:8080/path')).toBe('example.com');
    });

    test('returns empty string for invalid URL', () => {
      expect(_hostnameOf('not-a-url')).toBe('');
    });

    test('returns empty string for empty string', () => {
      expect(_hostnameOf('')).toBe('');
    });

    test('handles subdomain correctly', () => {
      expect(_hostnameOf('https://tenant.sharepoint.com/sites/site')).toBe('tenant.sharepoint.com');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. _autoPickFormat
  // ═══════════════════════════════════════════════════════════════════
  describe('_autoPickFormat', () => {
    test('detects WAITING_ON_VENDOR from goal', () => {
      expect(_autoPickFormat('', 'waiting on the vendor to fix the issue')).toBe('WAITING_ON_VENDOR');
    });

    test('detects WAITING_ON_VENDOR from summary', () => {
      expect(_autoPickFormat('vendor case has been opened', '')).toBe('WAITING_ON_VENDOR');
    });

    test('detects WAITING_ON_CLIENT from goal', () => {
      expect(_autoPickFormat('', 'awaiting client to respond')).toBe('WAITING_ON_CLIENT');
    });

    test('detects WAITING_ON_CLIENT from summary', () => {
      expect(_autoPickFormat('waiting on the client for callback', '')).toBe('WAITING_ON_CLIENT');
    });

    test('detects IT_GLUE_KB from goal', () => {
      expect(_autoPickFormat('', 'create a KB entry in IT Glue')).toBe('IT_GLUE_KB');
    });

    test('detects IT_GLUE_KB from summary', () => {
      expect(_autoPickFormat('document this in the knowledge base', '')).toBe('IT_GLUE_KB');
    });

    test('detects CLIENT_EMAIL from goal', () => {
      expect(_autoPickFormat('', 'draft an email to the client')).toBe('CLIENT_EMAIL');
    });

    test('detects CLIENT_EMAIL from summary', () => {
      expect(_autoPickFormat('send the email to the client about resolution', '')).toBe('CLIENT_EMAIL');
    });

    test('detects TICKET_KICKOFF from goal', () => {
      expect(_autoPickFormat('', 'kickoff investigation for this ticket')).toBe('TICKET_KICKOFF');
    });

    test('detects TICKET_KICKOFF from summary', () => {
      expect(_autoPickFormat('new ticket just opened for investigation', '')).toBe('TICKET_KICKOFF');
    });

    test('defaults to FINAL_NOTES', () => {
      expect(_autoPickFormat('issue was resolved', 'some goal without keywords')).toBe('FINAL_NOTES');
    });

    test('priority: vendor > client > kb > email > kickoff > default', () => {
      // WAITING_ON_VENDOR should beat WAITING_ON_CLIENT when both are present
      expect(_autoPickFormat('waiting on the vendor', 'waiting on the client')).toBe('WAITING_ON_VENDOR');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. formatTicketOutput
  // ═══════════════════════════════════════════════════════════════════
  describe('formatTicketOutput', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('TICKET_KICKOFF format produces kickoff template', () => {
      const result = formatTicketOutput('TICKET_KICKOFF', 'Investigated the issue.', 'Ticket #12345: Fix the VPN', tech);
      expect(result).toContain('Ticket Kickoff');
      expect(result).toContain('MAIN ISSUE');
      expect(result).toContain('WHAT HAS BEEN TRIED');
      expect(result).toContain('FASTEST SAFE RESOLUTION PATH');
    });

    test('FINAL_NOTES format produces final notes template', () => {
      const result = formatTicketOutput('FINAL_NOTES', 'The issue was resolved by restarting the service.', 'Ticket #12345: VPN down', tech);
      expect(result).toContain('Final Notes');
      expect(result).toContain('Action Taken');
      expect(result).toContain('John Smith');
    });

    test('WAITING_ON_CLIENT format', () => {
      const result = formatTicketOutput('WAITING_ON_CLIENT', 'Waiting for client callback.', 'Ticket #12345', tech);
      expect(result).toContain('Waiting on Client');
      expect(result).toContain('Action Taken');
    });

    test('WAITING_ON_VENDOR format', () => {
      const result = formatTicketOutput('WAITING_ON_VENDOR', 'Vendor case opened.', 'Ticket #12345', tech);
      expect(result).toContain('Waiting on Vendor');
      expect(result).toContain('Action Taken');
    });

    test('IT_GLUE_KB format', () => {
      const result = formatTicketOutput('IT_GLUE_KB', 'Step by step resolution.', 'How to configure SonicWall', tech);
      expect(result).toContain('IT Glue Knowledge Base Entry');
      expect(result).toContain('Title');
      expect(result).toContain('Resolution Steps');
    });

    test('CLIENT_EMAIL format', () => {
      const result = formatTicketOutput('CLIENT_EMAIL', 'Issue resolved.', 'Ticket #12345', tech);
      expect(result).toContain('Client Email');
      expect(result).toContain('Subject');
      expect(result).toContain('Hello [Client Name]');
    });

    test('auto format delegates to _autoPickFormat', () => {
      const result = formatTicketOutput('auto', 'Vendor case opened.', 'some goal', tech);
      // Should pick WAITING_ON_VENDOR since summary says "vendor case"
      expect(result).toContain('Waiting on Vendor');
    });

    test('case-insensitive format parameter', () => {
      const result = formatTicketOutput('ticket_kickoff', 'summary', 'goal', tech);
      expect(result).toContain('Ticket Kickoff');
    });

    test('default/null format falls to FINAL_NOTES', () => {
      const result = formatTicketOutput(null, 'Summary of work.', 'goal', tech);
      expect(result).toContain('Final Notes');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. generateHeuristicPlan
  // ═══════════════════════════════════════════════════════════════════
  describe('generateHeuristicPlan', () => {
    test('returns null for empty goal', () => {
      expect(generateHeuristicPlan('', 'https://example.com')).toBeNull();
    });

    test('returns null for null goal', () => {
      expect(generateHeuristicPlan(null, 'https://example.com')).toBeNull();
    });

    test('multi-page pattern with target URL produces multi-step plan', () => {
      const plan = generateHeuristicPlan(
        'Summarize the top 3 articles about cybersecurity from https://blog.example.com',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
      expect(Array.isArray(plan)).toBe(true);
      expect(plan.length).toBeGreaterThan(3);
      expect(plan[0]).toContain('blog.example.com');
    });

    test('multi-page pattern already on target skips navigate', () => {
      const plan = generateHeuristicPlan(
        'Summarize all articles on this page',
        'https://blog.example.com'
      );
      expect(plan).not.toBeNull();
      // Should not contain a navigate step since already there
      const hasNavigate = plan.some(s => /Navigate to/.test(s));
      expect(hasNavigate).toBe(false);
    });

    test('multi-page pattern with search query produces search step', () => {
      const plan = generateHeuristicPlan(
        'Search for and summarize the top 5 articles about network security threats and remediation',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
      const hasSearch = plan.some(s => /Search Google/.test(s));
      expect(hasSearch).toBe(true);
    });

    test('single-page with target URL produces navigate plan', () => {
      const plan = generateHeuristicPlan(
        'Go to https://admin.microsoft.com and check the users list',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
      expect(plan[0]).toContain('admin.microsoft.com');
      expect(plan.some(s => /Read the page/.test(s))).toBe(true);
    });

    test('single-page already on target produces read plan', () => {
      const plan = generateHeuristicPlan(
        'Go to https://admin.microsoft.com and check settings',
        'https://admin.microsoft.com'
      );
      expect(plan).not.toBeNull();
      // Already there — first step should be reading, not navigating
      expect(plan[0]).not.toContain('Navigate to');
    });

    test('search query without multi-page pattern produces search plan', () => {
      const plan = generateHeuristicPlan(
        'Search for "how to configure FortiGate firewall policies" and summarize findings',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
      expect(plan[0]).toContain('Search Google');
    });

    test('generic fallback for simple goals', () => {
      const plan = generateHeuristicPlan(
        'Check the current page settings',
        'https://example.com'
      );
      expect(plan).not.toBeNull();
      expect(plan[0]).toContain('Read the current page');
    });

    test('extracts count from goal', () => {
      const plan = generateHeuristicPlan(
        'Find the top 5 pages about VPN configuration',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
      // The plan should reference 5 items
      expect(plan.some(s => /5 most relevant/.test(s))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. _updateRunLogIndex
  // ═══════════════════════════════════════════════════════════════════
  describe('_updateRunLogIndex', () => {
    test('returns early when runLogId is null', async () => {
      await _updateRunLogIndex(null, { goal: 'test' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('returns early when runLogId is empty', async () => {
      await _updateRunLogIndex('', { goal: 'test' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('adds new entry to empty index', async () => {
      await _updateRunLogIndex('run-001', { goal: 'test goal', stepCount: 5 });
      expect(chrome.storage.local.set).toHaveBeenCalled();
      const setCall = chrome.storage.local.set.mock.calls[0]?.[0];
      const list = setCall?.run_log_index;
      expect(list).toHaveLength(1);
      expect(list[0].runLogId).toBe('run-001');
      expect(list[0].goal).toBe('test goal');
      expect(list[0].stepCount).toBe(5);
    });

    test('updates existing entry in index', async () => {
      // Pre-populate storage with an existing entry
      storageData.run_log_index = [{ runLogId: 'run-001', goal: 'test goal', stepCount: 5 }];
      await _updateRunLogIndex('run-001', { stepCount: 10, completed: true });
      expect(chrome.storage.local.set).toHaveBeenCalled();
      const setCall = chrome.storage.local.set.mock.calls[0]?.[0];
      const list = setCall?.run_log_index;
      expect(list).toHaveLength(1);
      expect(list[0].stepCount).toBe(10);
      expect(list[0].completed).toBe(true);
      expect(list[0].goal).toBe('test goal'); // preserved
    });

    test('evicts overflow entries beyond 20', async () => {
      // Pre-populate 20 entries
      const existing = [];
      for (let i = 1; i <= 20; i++) {
        existing.push({ runLogId: `run-${String(i).padStart(3, '0')}` });
      }
      storageData.run_log_index = existing;
      // Add a new one
      await _updateRunLogIndex('run-new', { goal: 'new run' });
      expect(chrome.storage.local.set).toHaveBeenCalled();
      const setCall = chrome.storage.local.set.mock.calls[0]?.[0];
      const list = setCall?.run_log_index;
      expect(list).toHaveLength(20);
      expect(list[0].runLogId).toBe('run-new');
      // Should have evicted the oldest entry
      expect(chrome.storage.local.remove).toHaveBeenCalled();
      const removeCall = chrome.storage.local.remove.mock.calls[0]?.[0];
      expect(removeCall).toBeDefined();
      expect(removeCall).toContain('run_log_run-020');
    });

    test('prepends new entry to front of list', async () => {
      storageData.run_log_index = [{ runLogId: 'run-old', goal: 'old' }];
      await _updateRunLogIndex('run-new', { goal: 'new' });
      expect(chrome.storage.local.set).toHaveBeenCalled();
      const setCall = chrome.storage.local.set.mock.calls[0]?.[0];
      const list = setCall?.run_log_index;
      expect(list).toHaveLength(2);
      expect(list[0].runLogId).toBe('run-new');
      expect(list[1].runLogId).toBe('run-old');
    });

    test('handles corrupted storage gracefully', async () => {
      storageData.run_log_index = 'not an array';
      await _updateRunLogIndex('run-001', { goal: 'test' });
      const setCall = chrome.storage.local.set.mock.calls[0]?.[0];
      const list = setCall?.run_log_index;
      expect(list).toHaveLength(1);
      expect(list[0].runLogId).toBe('run-001');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // formatTicketKickoff (individual function coverage)
  // ═══════════════════════════════════════════════════════════════════
  describe('formatTicketKickoff', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('renders kickoff template with ticket number from goal', () => {
      const result = formatTicketKickoff('Checked the firewall.', 'Ticket #55432: VPN tunnel is down', tech);
      expect(result).toContain('Ticket #55432');
      expect(result).toContain('Ticket Kickoff');
      expect(result).toContain('MAIN ISSUE');
      expect(result).toContain('VPN tunnel is down');
    });

    test('renders kickoff template without ticket number', () => {
      const result = formatTicketKickoff('Checked settings.', 'Investigate the login issue', tech);
      expect(result).toContain('Ticket Kickoff');
      expect(result).toContain('Investigate the login issue');
    });

    test('renders default resolution path when summary is empty', () => {
      const result = formatTicketKickoff('', 'Some goal', tech);
      expect(result).toContain('Low-risk check');
      expect(result).toContain('Escalation/fix');
    });

    test('includes technician info in footer', () => {
      const result = formatTicketKickoff('summary', 'goal', tech);
      expect(result).toContain('John Smith');
      expect(result).toContain('Acme IT');
      expect(result).toContain('555-000-0000');
    });

  });

  // ═══════════════════════════════════════════════════════════════════
  // formatTicketFinalNotes (individual function coverage)
  // ═══════════════════════════════════════════════════════════════════
  describe('formatTicketFinalNotes', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('renders final notes template', () => {
      const result = formatTicketFinalNotes('Issue resolved by restarting VPN service.', 'Ticket #12345', tech);
      expect(result).toContain('Final Notes');
      expect(result).toContain('Action Taken');
      expect(result).toContain('investigation completed and findings documented');
      expect(result).toContain('Ticket #12345');
    });

    test('handles empty ticket number', () => {
      const result = formatTicketFinalNotes('Fixed it.', '', tech);
      expect(result).toContain('Final Notes');
      expect(result).toContain('Fixed it');
    });

    test('truncates long action summaries', () => {
      const longSummary = 'A'.repeat(500);
      const result = formatTicketFinalNotes(longSummary, 'Ticket #123', tech);
      // Should not be excessively long
      expect(result.length).toBeLessThan(2000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // formatWaitingOnClient (individual function coverage)
  // ═══════════════════════════════════════════════════════════════════
  describe('formatWaitingOnClient', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('renders waiting on client template', () => {
      const result = formatWaitingOnClient('Requested client to restart their router.', 'Ticket #12345', tech);
      expect(result).toContain('Waiting on Client');
      expect(result).toContain('Action Taken');
      expect(result).toContain('Requested client to restart their router');
      expect(result).toContain('will re-engage once client responds');
    });

    test('includes follow-up time when specified', () => {
      const result = formatWaitingOnClient('Called client, no answer.', 'Ticket #123', tech, '2-3 business days');
      expect(result).toContain('Waiting on Client');
      expect(result).toContain('Follow up by');
    });

    test('handles missing follow-up time', () => {
      const result = formatWaitingOnClient('Emailed client.', 'Ticket #123', tech);
      expect(result).toContain('will re-engage once client responds');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // formatWaitingOnVendor (individual function coverage)
  // ═══════════════════════════════════════════════════════════════════
  describe('formatWaitingOnVendor', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('renders waiting on vendor template', () => {
      const result = formatWaitingOnVendor('Opened SonicWall case #123456.', 'Ticket #789', tech, 'SonicWall Support', '2024-05-25');
      expect(result).toContain('Waiting on Vendor');
      expect(result).toContain('will follow up with vendor and update ticket');
      expect(result).toContain('John Smith');
    });

    test('handles missing vendor name', () => {
      const result = formatWaitingOnVendor('Case opened with vendor.', 'Ticket #123', tech, '', '2024-05-25');
      expect(result).toContain('Waiting on Vendor');
      expect(result).toContain('John Smith');
    });

    test('handles missing follow-up date', () => {
      const result = formatWaitingOnVendor('Vendor ticket opened.', 'Ticket #123', tech, 'Fortinet Support', '');
      expect(result).toContain('Waiting on Vendor');
      expect(result).toContain('will follow up with vendor and update ticket');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // formatItGlueKb (individual function coverage)
  // ═══════════════════════════════════════════════════════════════════
  describe('formatItGlueKb', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('renders IT Glue KB template', () => {
      const result = formatItGlueKb('How to configure SonicWall VPN', 'Step 1: Log in to SonicWall\nStep 2: Go to VPN settings\nStep 3: Configure tunnel', tech);
      expect(result).toContain('IT Glue Knowledge Base Entry');
      expect(result).toContain('How to configure SonicWall VPN');
      expect(result).toContain('Resolution Steps');
      expect(result).toContain('Step 1: Log in to SonicWall');
    });

    test('handles basic inputs', () => {
      const result = formatItGlueKb('Title', 'Steps here', tech);
      expect(result).toContain('IT Glue Knowledge Base Entry');
      expect(result).toContain('Resolution Steps');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // formatClientEmail (individual function coverage)
  // ═══════════════════════════════════════════════════════════════════
  describe('formatClientEmail', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('renders client email template', () => {
      const result = formatClientEmail('The VPN issue has been resolved.', 'Ticket #12345: VPN tunnel down', tech);
      expect(result).toContain('**Subject:**');
      expect(result).toContain('Hello [Client Name]');
      expect(result).toContain('Ticket #12345');
      expect(result).toContain('555-000-0000');
      expect(result).toContain('support@example.com');
    });

    test('handles missing ticket number', () => {
      const result = formatClientEmail('Fixed the issue.', 'Investigate issue', tech);
      expect(result).toContain('**Subject:**');
      expect(result).toContain('Hello [Client Name]');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Error handling edge cases
  // ═══════════════════════════════════════════════════════════════════
  describe('error handling edge cases', () => {
    test('captureReportData handles getAllTabContexts errors', () => {
      mockGetAllTabContexts.mockImplementationOnce(() => {
        throw new Error('Tab context error');
      });
      const data = captureReportData('goal', [], {}, null, 0, 0);
      expect(data.tabContexts).toEqual([]);
    });

    test('captureReportData handles null snapshot gracefully', () => {
      mockGetAllTabContexts.mockReturnValueOnce([
        { label: 'tab1', url: 'https://example.com', snapshot: null },
        { label: 'tab2', url: 'https://other.com' }, // no snapshot property
      ]);
      const data = captureReportData('goal', [], {}, null, 0, 0);
      expect(data.tabContexts).toEqual([
        { label: 'tab1', url: 'https://example.com', hasScreenshot: false },
        { label: 'tab2', url: 'https://other.com', hasScreenshot: false },
      ]);
    });

    test('maybePostProgressUpdate handles sendSilentUpdate errors', () => {
      mockSendSilentUpdate.mockImplementationOnce(() => {
        throw new Error('Send error');
      });
      // Should not throw
      expect(() => {
        maybePostProgressUpdate(25, [], {});
      }).not.toThrow();
    });

    test('_updateRunLogIndex handles storage.get errors', async () => {
      chrome.storage.local.get.mockImplementationOnce(() => {
        throw new Error('Storage get error');
      });
      // Should not throw
      await expect(_updateRunLogIndex('run-001', { goal: 'test' })).resolves.toBeUndefined();
    });

    test('_updateRunLogIndex handles storage.set errors', async () => {
      chrome.storage.local.set.mockImplementationOnce(() => {
        throw new Error('Storage set error');
      });
      // Should not throw
      await expect(_updateRunLogIndex('run-001', { goal: 'test' })).resolves.toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // formatTicketOutput edge cases
  // ═══════════════════════════════════════════════════════════════════
  describe('formatTicketOutput edge cases', () => {
    const tech = {
      name: 'John Smith',
      title: 'IT Support Technician',
      company: 'Acme IT',
      phone: '555-000-0000',
      email: 'support@example.com',
    };

    test('handles null summary', () => {
      const result = formatTicketOutput('FINAL_NOTES', null, 'Ticket #123', tech);
      expect(result).toContain('Final Notes');
    });

    test('handles empty goal', () => {
      const result = formatTicketOutput('TICKET_KICKOFF', 'Summary', '', tech);
      expect(result).toContain('Ticket Kickoff');
    });

    test('handles very long goal text', () => {
      const longGoal = 'A'.repeat(1000);
      const result = formatTicketOutput('FINAL_NOTES', 'Done', longGoal, tech);
      expect(result).toContain('Final Notes');
    });

    test('handles special characters in summary', () => {
      const summary = 'Issue with <script>alert("XSS")</script> & "quotes"';
      const result = formatTicketOutput('FINAL_NOTES', summary, 'Ticket #123', tech);
      expect(result).toContain('Final Notes');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // generateHeuristicPlan edge cases
  // ═══════════════════════════════════════════════════════════════════
  describe('generateHeuristicPlan edge cases', () => {
    test('handles goal with multiple URLs', () => {
      const plan = generateHeuristicPlan(
        'Compare https://site1.com and https://site2.com',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
    });

    test('handles goal with no clear pattern', () => {
      const plan = generateHeuristicPlan(
        'Just do something',
        'https://example.com'
      );
      expect(plan).not.toBeNull();
    });

    test('handles URL with path and query params', () => {
      const plan = generateHeuristicPlan(
        'Check https://admin.microsoft.com/?page=users&filter=active',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
      expect(plan[0]).toContain('admin.microsoft.com');
    });

    test('handles URL with port number', () => {
      const plan = generateHeuristicPlan(
        'Go to https://router.local:8080 and check settings',
        'https://google.com'
      );
      expect(plan).not.toBeNull();
    });
  });
});
