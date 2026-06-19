// tests/brain-client-agent-engine-integration.test.js
// Agent-engine integration test for sub-project B (TESTING deliverable): with
// brainEnabled ON and getBrainStartupContext mocked to return a populated
// section, drive the agent-engine run-start path (startAgent) and verify the
// brain READ wiring executed: getBrainStartupContext was called with a
// platform-id key (leak-zero) and the section it returned is the one that gets
// assigned to brainKnowledgeText (which flows into agentState.brainKnowledgeText).
//
// Why we assert the contract at the run-start boundary rather than by capturing
// agentState from callLLMWithRetry: startAgent sets the module-level
// brainKnowledgeText SYNCHRONOUSLY during run-start (the recall block runs
// before the fire-and-forget runAgentLoop). agentState.brainKnowledgeText is
// literally that same identifier (see the agentState object literal in
// runAgentLoop). So proving the run-start block called getBrainStartupContext
// with a leak-zero key and got the populated section back is the deterministic
// half of the contract; the section->agentState assignment is a plain property
// copy that can't diverge. Driving the async loop to its first LLM call would
// test the loop, not the brain wiring, and is fragile under mocked observation.

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
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[k]);
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
    onMessage: { addListener: jest.fn((fn) => { onMessageListeners.push(fn); }), removeListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
  notifications: { create: jest.fn(), clear: jest.fn() },
};

// Capture agentState from the legacy callLLMWithRetry path. agentState is the
// 11th argument (index 10): see the call site in runAgentLoop.
let capturedAgentState = null;
const mockCallLLMWithRetry = jest.fn(async (...args) => {
  capturedAgentState = args[10] || null;
  // Return a finish command so the loop stops cleanly after the first consult.
  return { type: 'finish', summary: 'done' };
});
jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: mockCallLLMWithRetry,
  parseVisionResponse: jest.fn((raw) => { try { return JSON.parse(raw); } catch { return null; } }),
  generatePlan: jest.fn(async () => ['Step 1']),
  supportsVision: jest.fn(() => true),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []),
  selectModelForStep: jest.fn(() => null),
  getCostTracker: jest.fn(() => ({ totalCalls: 0, byTier: { light: 0, default: 0, heavy: 0 }, estimatedCost: '0.0000' })),
}));

// Mock getPlatformProfile -> a platform id, so the recall key is the platform
// id (leak-zero), never client name / tenant / raw goal text.
const mockGetPlatformProfile = jest.fn(() => ({ id: 'm365_admin', label: 'M365 Admin' }));
jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: mockGetPlatformProfile,
}));

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}),
  waitForPageReady: jest.fn(async () => {}),
  injectContentScript: jest.fn(async () => {}),
  sendMessageWithRetry: jest.fn(async () => ({})),
  takeScreenshot: jest.fn(async () => 'data:image/png;base64,abc'),
  isValidUrl: jest.fn(() => true),
  getTabInfo: jest.fn(async () => ({ url: 'https://admin.microsoft.com', title: 'M365 Admin' })),
  detachAllDebuggees: jest.fn(async () => {}),
  cdpDispatchClick: jest.fn(async () => {}),
  cdpDispatchType: jest.fn(async () => {}),
  cdpDispatchKey: jest.fn(async () => {}),
  cdpExecuteJs: jest.fn(async () => ({ ok: true, value: 'test' })),
  readConsoleMessages: jest.fn(async () => []),
  readNetworkRequests: jest.fn(async () => []),
}));

jest.unstable_mockModule('../background/message-protocol.js', () => ({
  sendSilentUpdate: jest.fn(), sendActionMessage: jest.fn(), sendActionResult: jest.fn(),
  sendReportUpdate: jest.fn(), sendPageContext: jest.fn(), sendTabStateUpdate: jest.fn(),
  sendScreenshotUpdate: jest.fn(), sendAgentActivity: jest.fn(), sendAgentStepStart: jest.fn(),
  sendAgentStatus: jest.fn(), sendHeartbeat: jest.fn(), sendCostUpdate: jest.fn(),
  sendClientKnowledgePreview: jest.fn(), sendPlanPreview: jest.fn(),
}));

jest.unstable_mockModule('../background/report-generator.js', () => ({
  generateReport: jest.fn(async () => '## Report'),
  buildFallbackReport: jest.fn(() => 'Fallback'),
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
  // getActiveTabId must return a tab so the loop doesn't exit at its
  // "No active tab -- stopping" guard before reaching the LLM consult.
  getActiveTabId: jest.fn(() => 1), setActiveTab: jest.fn(), getTabContext: jest.fn(() => null),
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
  // Return a fully-formed recovery result so the consult block doesn't deref null.
  runRecoverySkills: jest.fn(() => ({ appliedSkillIds: [], autoApply: null, promptInjection: null })),
  getSkillStats: jest.fn(() => ({})),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(), endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 95, grade: 'A' })), suggestRetryActions: jest.fn(() => []),
}));

// ── Mock brain-client.js: getBrainStartupContext returns a populated section ──
const POPULATED_SECTION = `\n## BRAIN KNOWLEDGE (shared, cross-installation)\nShared wisdom from the wider community.\n\nDirect matches (strongly relevant):\n- [src:zcode] M365 admin sync takes ~5 min\n`;
const mockGetBrainStartupContext = jest.fn(async () => ({
  ok: true,
  section: POPULATED_SECTION,
  directCount: 1,
  associatedCount: 0,
}));
jest.unstable_mockModule('../background/brain-client.js', () => ({
  getBrainStartupContext: mockGetBrainStartupContext,
  resetBrainRunSignals: jest.fn(), // (1B) no-op in tests; agent-engine calls it at run start
}));

const { startAgent, stopAgent, resetAgentState } = await import('../background/agent-engine.js');

beforeEach(async () => {
  Object.keys(storageData).forEach((k) => delete storageData[k]);
  Object.keys(sessionData).forEach((k) => delete sessionData[k]);
  onMessageListeners = [];
  jest.clearAllMocks();
  capturedAgentState = null;
  try { await stopAgent(); } catch (_e) { /* not running */ }
  resetAgentState();
});

afterEach(async () => { try { await stopAgent(); } catch (_e) { /* ignore */ } });

// Poll until the fire-and-forget runAgentLoop reaches its first legacy
// callLLMWithRetry consult (which captures agentState), or time out. The loop
// runs several awaits (vision observe, screenshot, observation) before the
// consult; a fixed sleep is flaky, so we poll for the capture instead.
async function waitForAgentStateCapture(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (capturedAgentState !== null) return capturedAgentState;
    await new Promise((r) => setTimeout(r, 25));
  }
  return capturedAgentState;
}

// ──────────────────────────────────────────────────────────────────────
describe('agent-engine <-> brain-client integration (sub-project B)', () => {
  test('toggle ON + mock returns data -> section lands in agentState.brainKnowledgeText', async () => {
    storageData.brainEnabled = true; // toggle ON
    const sender = { tab: { id: 1 } };
    const result = await startAgent('add a user in M365 admin', sender);

    // Run started successfully — the brain path did not break the run.
    expect(result).toContain('Agent started');

    // The run-start block invoked getBrainStartupContext.
    expect(mockGetBrainStartupContext).toHaveBeenCalled();
    const recallKey = mockGetBrainStartupContext.mock.calls[0][0];
    expect(typeof recallKey).toBe('string');
    expect(recallKey.length).toBeGreaterThan(0);

    // Leak-zero: the recall key is the platform id produced by
    // getPlatformProfile (m365_admin) — NOT client name, tenant, or goal text.
    expect(mockGetPlatformProfile).toHaveBeenCalled();
    expect(recallKey).toBe('m365_admin');

    // Let the fire-and-forget loop reach its first callLLMWithRetry consult so
    // the agentState it builds (carrying brainKnowledgeText) is captured.
    const agentState = await waitForAgentStateCapture();
    expect(agentState).not.toBeNull();
    // Direct assertion: the populated BRAIN KNOWLEDGE section landed in
    // agentState.brainKnowledgeText (the field llm-client renders).
    expect(agentState.brainKnowledgeText).toContain('## BRAIN KNOWLEDGE (shared, cross-installation)');
    expect(agentState.brainKnowledgeText).toContain('[src:zcode]');

    // The two knowledge sections stay distinct: clientKnowledgeText is the
    // local one (empty here), brainKnowledgeText is the brain one (populated).
    expect(agentState.clientKnowledgeText).toBe('');
    expect(agentState.brainKnowledgeText).not.toBe('');
  }, 20000);

  test('toggle OFF -> brain wiring still called but client returns empty (fails open)', async () => {
    // With brainEnabled OFF, getBrainStartupContext reads the toggle internally
    // and returns {ok:false, section:''} without fetching.
    storageData.brainEnabled = false;
    mockGetBrainStartupContext.mockResolvedValueOnce({
      ok: false, section: '', directCount: 0, associatedCount: 0,
    });
    const sender = { tab: { id: 1 } };
    const result = await startAgent('add a user', sender);
    expect(result).toContain('Agent started');
    // The wiring ran; the client short-circuited to empty.
    expect(mockGetBrainStartupContext).toHaveBeenCalled();
    const returned = await mockGetBrainStartupContext.mock.results[0].value;
    expect(returned.ok).toBe(false);
    expect(returned.section).toBe('');
  }, 15000);
});
