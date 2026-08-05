// tests/agent-loop-characterisation.test.js
//
// CHARACTERISATION tests for runAgentLoop (background/agent-engine.js).
//
// Written BEFORE the #45 state-machine refactor, deliberately asserting on the
// CURRENT observable behaviour of the loop rather than on any internal shape.
// Everything here is pinned through the public surface (startAgent + the
// chrome.runtime messages the loop emits), so the same assertions must hold
// after the loop body is restructured.
//
// Why this file exists: before this suite, `agent-engine.js` sat at ~21% branch
// coverage and NO test drove a single full iteration of runAgentLoop — the
// existing loop-path tests mock getActiveTabId() to null, so the loop exits at
// "No active tab" before the step body ever runs. These tests drive real steps
// and pin the ugly exits: step-budget exhaustion, the no-LLM-call abort, the
// prose announce-loop guard (PR #61), circuit-breaker hard stops, click_at
// force-finish, tab loss, stop-mid-run, and the finish gates.

import { jest } from '@jest/globals';

// ── Chrome API mock ──────────────────────────────────────────────────────────
const storageData = {};
const sessionData = {};
/** Every chrome.runtime.sendMessage payload the loop emitted this test. */
let sentMessages = [];

const chromeMock = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        if (keys === null || keys === undefined) return { ...storageData };
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined
            ? storageData[k]
            : (Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
    session: {
      set: jest.fn(async (obj) => { Object.assign(sessionData, obj); }),
      get: jest.fn(async () => ({ ...sessionData })),
      remove: jest.fn(async () => {}),
    },
  },
  tabs: {
    query: jest.fn((q, cb) => {
      const result = tabsQueryResult();
      if (typeof q === 'function') { q(result); return Promise.resolve(result); }
      if (cb) cb(result);
      return Promise.resolve(result);
    }),
    get: jest.fn(async (id) => ({ id, url: 'https://example.com', title: 'Test', windowId: 1 })),
    update: jest.fn(async () => ({})),
    create: jest.fn(async () => ({ id: 99 })),
    sendMessage: jest.fn(async () => ({})),
    captureVisibleTab: jest.fn((winId, opts, cb) => { if (cb) cb('data:image/jpeg;base64,shot'); }),
    group: jest.fn(async () => 42),
    ungroup: jest.fn(async () => {}),
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  tabGroups: { update: jest.fn(async () => {}) },
  sidePanel: { setOptions: jest.fn(async () => {}) },
  scripting: { executeScript: jest.fn(async () => [{ result: scriptingResult() }]) },
  runtime: {
    lastError: null,
    sendMessage: jest.fn(async (msg) => { sentMessages.push(msg); return undefined; }),
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
    getURL: jest.fn((p) => p),
  },
  debugger: {
    attach: jest.fn(async () => {}),
    detach: jest.fn(async () => {}),
    sendCommand: jest.fn(async () => ({})),
    onEvent: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: { create: jest.fn(), onAlarm: { addListener: jest.fn() } },
  notifications: { create: jest.fn(async () => 'n1') },
  webNavigation: { getAllFrames: jest.fn(async () => []) },
};
globalThis.chrome = chromeMock;
global.chrome = chromeMock;
globalThis.crypto = { randomUUID: () => 'run-' + Math.random().toString(36).slice(2, 10) };

// Test-controlled knobs consulted by the chrome mock above.
let _tabsQueryResult = [{ id: 1, url: 'https://example.com', title: 'Test', windowId: 1 }];
function tabsQueryResult() { return _tabsQueryResult; }
let _scriptingResult = 'x'.repeat(200);
function scriptingResult() { return _scriptingResult; }

// ── sleep is neutered so a 60-step run finishes in milliseconds ──────────────
jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: (err) => {
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && err !== null && typeof err.message === 'string') return err.message;
    if (err === null || err === undefined) return '';
    return String(err);
  },
  sleep: () => Promise.resolve(),
}));

// ── LLM: a programmable script of commands, one per consult ──────────────────
/** Each entry is a command object or a (callNumber, args) => command function. */
let llmScript = [{ type: 'finish', summary: 'done' }];
let llmCalls = 0;
/** When false the mock does NOT bump agentState.apiCallCount (simulates a dead provider). */
let llmCountsApiCalls = true;

/**
 * Deep snapshots of the prompt history + agent state AS THEY WERE at each
 * consult. The loop hands the LLM live objects that it keeps mutating after the
 * call returns (the prose-loop guard pushes onto promptHistory, agentState
 * accumulates token counts), so reading jest's stored references would show a
 * later state and silently invent behaviour that never reached the model.
 */
let llmPromptSnapshots = [];
let llmStateSnapshots = [];

const mockCallLLMWithRetry = jest.fn(async (...args) => {
  const agentState = args[10];
  llmPromptSnapshots.push(JSON.parse(JSON.stringify(args[5] || [])));
  llmStateSnapshots.push({
    loopDirective: agentState ? String(agentState.loopDirective || '') : '',
    budgetHint: agentState ? String(agentState.budgetHint || '') : '',
  });
  if (llmCountsApiCalls && agentState && typeof agentState.apiCallCount === 'number') {
    agentState.apiCallCount++;
  }
  const idx = Math.min(llmCalls, llmScript.length - 1);
  const entry = llmScript[idx];
  llmCalls++;
  const value = typeof entry === 'function' ? await entry(llmCalls, args) : entry;
  if (value instanceof Error) throw value;
  return value;
});

/** JSON of the prompt history the model actually saw on consult `n` (1-based). */
function promptSeen(n) { return JSON.stringify(llmPromptSnapshots[n - 1] || []); }
/** JSON of every prompt history the model ever saw this run. */
function allPromptsSeen() { return llmPromptSnapshots.map(h => JSON.stringify(h)).join('|'); }

jest.unstable_mockModule('../background/llm-client.js', () => ({
  callLLMWithRetry: mockCallLLMWithRetry,
  callLLMSimple: jest.fn(async () => ''),
  generatePlan: jest.fn(async () => null),
  supportsVision: jest.fn(() => false),
  getPlatformContext: jest.fn(() => ''),
  getRelevantPatterns: jest.fn(async () => []),
  selectModelForStep: jest.fn(() => null),
  estimateCostUsd: jest.fn(() => 0),
  isSimpleStep: jest.fn(() => false),
  getCostTracker: jest.fn(() => ({ totalCalls: 0, byTier: {}, estimatedCost: '0.0000' })),
  parseVisionResponse: jest.fn(() => null),
}));

jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: jest.fn(() => null),
}));

// ── Page / tab plumbing ─────────────────────────────────────────────────────
const HEALTHY_PAGE_TEXT = 'Widget dashboard. '.repeat(30);
const HEALTHY_ELEMENTS = [
  { selector: '#a', ref: 'r1', tag: 'button', text: 'Alpha' },
  { selector: '#b', ref: 'r2', tag: 'input', text: 'Beta' },
  { selector: '#c', ref: 'r3', tag: 'a', text: 'Gamma' },
  { selector: '#d', ref: 'r4', tag: 'select', text: 'Delta' },
];

/** Test hook: override the reply for a content-script round trip. */
let contentScriptRouter = null;
let _tabInfo = { url: 'https://example.com', title: 'Test', status: 'complete', windowId: 1 };

const mockGetTabInfo = jest.fn(async () => _tabInfo);
const mockSendMessageWithRetry = jest.fn(async (tabId, msg) => {
  if (contentScriptRouter) {
    const override = await contentScriptRouter(msg);
    if (override !== undefined) return override;
  }
  const action = msg && msg.action;
  if (action === 'observe_page') return { elements: HEALTHY_ELEMENTS.slice() };
  if (action === 'read_page') return { content: HEALTHY_PAGE_TEXT };
  if (action === 'dismiss_overlays') return { count: 0 };
  if (action === 'detect_tenant') return null;
  if (action === 'wait_for') return 'Wait satisfied';
  if (action === 'execute_command' || action === 'dispatch_command') return 'Done';
  return {};
});

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}),
  waitForPageReady: jest.fn(async () => {}),
  injectContentScript: jest.fn(async () => true),
  sendMessageWithRetry: mockSendMessageWithRetry,
  takeScreenshot: jest.fn(async () => ({ base64Image: 'abc', width: 800, height: 600, dpr: 1, scrollX: 0, scrollY: 0 })),
  isValidUrl: jest.fn((u) => typeof u === 'string' && /^https?:\/\//.test(u)),
  getTabInfo: mockGetTabInfo,
  detachAllDebuggees: jest.fn(async () => {}),
  cdpDispatchClick: jest.fn(async () => ({ ok: true })),
  cdpDispatchType: jest.fn(async () => ({ ok: true })),
  cdpDispatchKey: jest.fn(async () => ({ ok: true })),
  // Returns a non-JSON string so _visionObserve finds no indexed elements and
  // the loop stays on the legacy (non-vision) LLM path.
  cdpExecuteJs: jest.fn(async () => ({ ok: true, value: 'noop' })),
  readConsoleMessages: jest.fn(() => []),
  readNetworkRequests: jest.fn(() => []),
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
  generateReport: jest.fn(async () => ({ summary: 'r', fullReport: 'full report', structuredData: {} })),
  buildFallbackReport: jest.fn(() => 'fallback'),
}));

jest.unstable_mockModule('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(async () => ({ endpoint: 'https://api.test.com', apiKey: 'k', model: 'm' })),
  getTextProvider: jest.fn(async () => null),
  migrateLegacySettings: jest.fn(async () => {}),
}));

// emitAgentCompletion is the last thing runAgentLoop does — use it as the
// "loop is fully finished" signal so tests never race the finalize block.
let _completionResolvers = [];
jest.unstable_mockModule('../background/shared-state.js', () => ({
  onAgentCompletion: jest.fn(() => () => {}),
  emitAgentCompletion: jest.fn(() => {
    const rs = _completionResolvers;
    _completionResolvers = [];
    for (const r of rs) r();
  }),
  isSPATransitionPending: jest.fn(() => false),
  clearSPATransition: jest.fn(),
  notifyIfEnabled: jest.fn(async () => {}),
  startSwKeepalive: jest.fn(),
  stopSwKeepalive: jest.fn(),
}));

let _activeTabId = 1;
let _allTabContexts = [{ tabId: 1, label: 'main', url: 'https://example.com', snapshot: null }];
jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => _activeTabId),
  getTabContext: jest.fn((id) => ({ tabId: id, label: 'main', url: 'https://example.com', screenshotCache: {} })),
  getAllTabContexts: jest.fn(() => _allTabContexts),
  openTab: jest.fn(async () => ({ tabId: 2 })),
  switchToTab: jest.fn(async () => {}),
  closeTab: jest.fn(async () => {}),
  closeAllAgentTabs: jest.fn(async () => {}),
  updateSnapshot: jest.fn(),
  resetAllContexts: jest.fn(),
  findTabByLabel: jest.fn(() => null),
  registerInitialTab: jest.fn(),
  getTabCount: jest.fn(() => 1),
}));

jest.unstable_mockModule('../background/client-knowledge.js', () => ({
  getClientStartupContext: jest.fn(async () => ({ client: null, relevantEntries: [], promptSection: '' })),
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
  runRecoverySkills: jest.fn(() => ({ appliedSkillIds: [], autoApply: null, promptInjection: '' })),
  getSkillStats: jest.fn(() => ({ total: 0 })),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 70, band: 'ok', breakdown: {} })),
  suggestRetryActions: jest.fn(() => []),
}));

jest.unstable_mockModule('../background/brain-client.js', () => ({
  getBrainStartupContext: jest.fn(async () => ({ ok: false, section: '' })),
  resetBrainRunSignals: jest.fn(),
}));

jest.unstable_mockModule('../background/brain-producer.js', () => ({
  publishRunLearning: jest.fn(async () => ({ ok: false })),
  resetBrainProducerRunSignals: jest.fn(),
}));

// ── Import after mocks ──────────────────────────────────────────────────────
const { startAgent, stopAgent, resetAgentState, getLoopMachineSnapshot } =
  await import('../background/agent-engine.js');
const { LOOP_PHASE, LOOP_EXIT, isLegalTransition } =
  await import('../background/agent-loop-machine.js');

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeSender(tabId = 1) {
  return { tab: { id: tabId, url: 'https://example.com', windowId: 1 } };
}

/** Resolves once runAgentLoop has fully finalised (emitAgentCompletion fired). */
function loopSettled(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('runAgentLoop did not settle in time')), timeoutMs);
    _completionResolvers.push(() => { clearTimeout(timer); resolve(); });
  });
}

/** Start a run and wait for it to finish. Returns the emitted messages. */
async function runAgent(goal) {
  const settled = loopSettled();
  await startAgent(goal, makeSender());
  await settled;
  // Let any trailing microtasks (report write, cleanup) drain.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return sentMessages;
}

/** The summary string from the (single) agent_finished message, or ''. */
function finishSummary() {
  const msg = sentMessages.filter(m => m && m.action === 'agent_finished').pop();
  return msg ? String(msg.summary || '') : '';
}

function finishMessageCount() {
  return sentMessages.filter(m => m && m.action === 'agent_finished').length;
}

/** A goal that skips plan generation (`_isSimpleTask`) and has no structured-report keywords. */
const SIMPLE_GOAL = 'extract the widget name';

beforeEach(() => {
  for (const k of Object.keys(storageData)) delete storageData[k];
  for (const k of Object.keys(sessionData)) delete sessionData[k];
  sentMessages = [];
  llmCalls = 0;
  llmPromptSnapshots = [];
  llmStateSnapshots = [];
  llmCountsApiCalls = true;
  llmScript = [{ type: 'finish', summary: 'done' }];
  contentScriptRouter = null;
  _tabInfo = { url: 'https://example.com', title: 'Test', status: 'complete', windowId: 1 };
  _activeTabId = 1;
  _allTabContexts = [{ tabId: 1, label: 'main', url: 'https://example.com', snapshot: null }];
  _tabsQueryResult = [{ id: 1, url: 'https://example.com', title: 'Test', windowId: 1 }];
  _scriptingResult = 'x'.repeat(200);
  _completionResolvers = [];
  jest.clearAllMocks();
  resetAgentState();
});

afterEach(async () => {
  try { await stopAgent(); } catch (_) { /* ignore */ }
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. The happy path and the finish gates
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: finish', () => {
  test('a finish on step 1 with empty memory is blocked exactly once, then allowed', async () => {
    llmScript = [{ type: 'finish', summary: 'all done' }];
    await runAgent(SIMPLE_GOAL);
    // Step 1 finish is blocked (no data extracted, stepCount < 4, first block).
    // Step 2 finish passes because a BLOCKED entry now exists in history.
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(2);
    expect(finishSummary()).toContain('all done');
    expect(finishMessageCount()).toBe(1);
  });

  test('finish is not blocked once the agent has memory', async () => {
    llmScript = [
      { type: 'execute_js', code: 'return "payload"', key: 'widget' },
      { type: 'finish', summary: 'captured the widget' },
    ];
    contentScriptRouter = null;
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toContain('captured the widget');
    // Exactly two consults: extract, then finish (no block round-trip).
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(2);
  });

  test('the finish summary reports how many data points were collected', async () => {
    llmScript = [
      { type: 'execute_js', code: 'return "a-long-enough-payload-value"', key: 'widget' },
      { type: 'finish', summary: 'summary text' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toMatch(/data points collected/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Hard exits — the paths that terminate the run
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: hard exits', () => {
  test('aborts when the loop runs past step 3 without a single recorded LLM call', async () => {
    llmCountsApiCalls = false;               // provider never increments apiCallCount
    llmScript = [{ type: 'note', text: 'thinking' }];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toContain('ABORTED: Agent looped 5+ steps without making any LLM calls');
    // The guard fires at the top of step 4, so exactly 3 consults happened.
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(3);
  });

  test('stops with "No active tab" when there is no tab and no recoverable context', async () => {
    _activeTabId = null;
    _allTabContexts = [];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toBe('No active tab. Task interrupted.');
    expect(mockCallLLMWithRetry).not.toHaveBeenCalled();
  });

  test('stops with "Agent tab closed" when getTabInfo and tabs.query both lose the tab', async () => {
    mockGetTabInfo.mockImplementation(async () => null);
    _tabsQueryResult = [];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toBe('Agent tab closed. Task interrupted.');
  });

  test('stopAgent mid-run breaks the loop without emitting a finish summary', async () => {
    llmScript = [
      async () => { await stopAgent(); return { type: 'note', text: 'too late' }; },
      { type: 'finish', summary: 'never reached' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(finishMessageCount()).toBe(0);
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. The prose announce-loop guard (PR #61 — LongCat-2.0 failure mode)
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: no-action prose loop guard', () => {
  const ANNOUNCE = 'Parse error (will retry) — captured model output: Let me update the domain config:';

  test('three identical no-action prose replies stop the run early', async () => {
    llmScript = [{ type: 'note', text: ANNOUNCE }];
    await runAgent(SIMPLE_GOAL);
    const summary = finishSummary();
    expect(summary).toContain('Stopped early: the model repeated the same no-action reply 3 times');
    expect(summary).toContain('announcing instead of acting');
    // Exactly three consults: first capture, nudge, abort.
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(3);
  });

  // PRE-EXISTING BEHAVIOUR, NOT A DESIGN CHOICE:
  // proseLoopVerdict()'s 'nudge' branch pushes the corrective SYSTEM note onto
  // `promptHistory` — but the guard runs AFTER this step's LLM call, and
  // `promptHistory` is rebuilt from scratch at the top of every iteration. So
  // the nudge is written to an array nothing ever reads again and never reaches
  // the model; only the third-reply abort has any effect. Pinned here so the
  // refactor cannot silently change it in either direction. Compare the vision
  // fallback note, which is pushed BEFORE callLLMWithRetry and does reach the
  // model (see 'a null LLM response is synthesised…' below).
  test('the nudge branch is a no-op: the corrective note never reaches the model', async () => {
    llmScript = [{ type: 'note', text: ANNOUNCE }];
    await runAgent(SIMPLE_GOAL);
    expect(allPromptsSeen()).not.toContain('IDENTICAL prose with no action JSON');
    // ...and the run still aborts on the third identical reply.
    expect(finishSummary()).toContain('Stopped early');
  });

  test('a real action between identical prose resets the streak (no early abort)', async () => {
    llmScript = [
      { type: 'note', text: ANNOUNCE },
      { type: 'note', text: ANNOUNCE },
      { type: 'execute_js', code: 'return "some real payload here"', key: 'data' },
      { type: 'note', text: ANNOUNCE },
      { type: 'finish', summary: 'recovered' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toContain('recovered');
    expect(finishSummary()).not.toContain('Stopped early');
  });

  test('an unrelated note between identical prose neither resets nor hides the loop', async () => {
    llmScript = [
      { type: 'note', text: ANNOUNCE },
      { type: 'note', text: 'API call failed: 429' },
      { type: 'note', text: ANNOUNCE },
      { type: 'note', text: ANNOUNCE },
      { type: 'finish', summary: 'unreachable' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toContain('Stopped early: the model repeated the same no-action reply');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. LLM failure handling
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: LLM failure handling', () => {
  test('a thrown LLM error becomes a note, and the run continues', async () => {
    llmScript = [
      new Error('provider exploded'),
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'survived the error' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toContain('survived the error');
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(3);
  });

  test('a null LLM response is synthesised into the missing-API-key note', async () => {
    llmScript = [
      null,
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'ok' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(promptSeen(2)).toContain('No response from AI');
  });

  test('a vision-unsupported error in the previous result hard-stops the run', async () => {
    llmScript = [
      { type: 'note', text: 'No endpoints found that support image input' },
      { type: 'finish', summary: 'never reached' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toContain('Model does not support vision');
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Action dispatch: the non-page commands
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: action dispatch', () => {
  test('wait sleeps for the clamped duration and records it in history', async () => {
    llmScript = [
      { type: 'wait', ms: 5 },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'waited' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(promptSeen(2)).toContain('Waited 100ms');   // clamped to the 100ms floor
  });

  test('note records the text verbatim in history', async () => {
    llmScript = [
      { type: 'note', text: 'the widget is red' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'noted' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(promptSeen(2)).toContain('Note recorded: the widget is red');
  });

  test('navigate to the URL the agent is already on is blocked as a loop', async () => {
    llmScript = [
      { type: 'navigate', url: 'https://example.com' },
      { type: 'navigate', url: 'https://example.com' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(promptSeen(3)).toContain('BLOCKED: already on https://example.com');
  });

  test('a targetable action with no selector/ref/coords is blocked with guidance', async () => {
    llmScript = [
      { type: 'type', text: 'hello' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(promptSeen(2)).toContain('has no target');
  });

  test('repeat_for_each queues its sub-actions and drains them without extra LLM calls', async () => {
    llmScript = [
      { type: 'execute_js', code: 'return ["one","two"]', key: 'items' },
      { type: 'repeat_for_each', items: ['one', 'two'], item_var: 'i', do: [{ type: 'note', text: 'saw {{i}}' }] },
      { type: 'finish', summary: 'iterated' },
    ];
    await runAgent(SIMPLE_GOAL);
    // 3 scripted consults + the queued sub-commands consume steps without consulting.
    expect(finishSummary()).toContain('iterated');
    expect(allPromptsSeen()).toContain('saw one');
    expect(allPromptsSeen()).toContain('saw two');
  });

  test('lookup without a domain reports the validation error', async () => {
    llmScript = [
      { type: 'lookup' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(promptSeen(2)).toContain('lookup: domain is required');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. click_at guards (the GLM coordinate-less-click failure mode)
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: click_at guards', () => {
  test('the first coordinate-less click_at auto-extracts page text instead of clicking', async () => {
    _scriptingResult = 'y'.repeat(200);
    llmScript = [
      { type: 'click_at' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(promptSeen(2)).toContain('AUTO-EXTRACTED');
  });

  test('a second coordinate-less click_at force-finishes the run', async () => {
    _scriptingResult = 'y'.repeat(200);
    llmScript = [{ type: 'click_at' }];
    await runAgent(SIMPLE_GOAL);
    // Step 1 auto-extracts (200 chars — under the 500-char "data already in
    // memory" threshold), step 2 trips the second-block force-finish.
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(2);
    expect(finishMessageCount()).toBe(0);   // force-finish breaks without a summary message
  });

  test('a coordinate-less click_at with >500 chars already in memory finishes immediately', async () => {
    llmScript = [
      { type: 'extract', key: 'page_content', selector: '#a' },
      { type: 'click_at' },
      { type: 'finish', summary: 'never reached' },
    ];
    contentScriptRouter = (msg) => {
      if (msg && msg.action === 'execute_command' && msg.command && msg.command.type === 'extract') {
        return JSON.stringify({ key: 'page_content', value: 'q'.repeat(900) });
      }
      return undefined;
    };
    await runAgent(SIMPLE_GOAL);
    // Step 2 short-circuits: "data already in memory, no need to click".
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(2);
    expect(finishMessageCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Loop detectors
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: loop detectors', () => {
  test('three consecutive scrolls are blocked with an extract-instead directive', async () => {
    llmScript = [
      { type: 'scroll', direction: 'down' },
      { type: 'scroll', direction: 'down' },
      { type: 'scroll', direction: 'down' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(allPromptsSeen()).toContain('BLOCKED: Scrolled 3 times without extracting data');
  });

  test('two consecutive read_page actions inject the READ_PAGE LOOP directive', async () => {
    llmScript = [
      { type: 'read_page' },
      { type: 'read_page' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    // loopDirective travels to the LLM inside agentState (argument 11).
    expect(llmStateSnapshots[2].loopDirective).toContain('READ_PAGE LOOP DETECTED');
  });

  test('a same-command streak injects the recovery note into history', async () => {
    llmScript = [
      { type: 'select', selector: '#d', value: 'x' },
      { type: 'select', selector: '#d', value: 'x' },
      { type: 'select', selector: '#d', value: 'x' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(allPromptsSeen()).toContain('select loop detected!');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Step budget
// ═════════════════════════════════════════════════════════════════════════════
describe('characterisation: step budget', () => {
  test('the run stops at the dynamic step ceiling (60) with a step-limit summary', async () => {
    // Alternate two non-productive action types so neither the circuit breaker's
    // identical-action check nor the same-command detector fires, and the run
    // survives all the way to the step ceiling. Distinct text each step keeps
    // the prose-loop guard out of it too.
    llmScript = [(n) => (n % 2 ? { type: 'note', text: `observation number ${n}` } : { type: 'wait', ms: 1 })];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toMatch(/Reached step limit of 60/);
    expect(mockCallLLMWithRetry).toHaveBeenCalledTimes(60);
  }, 120000);

  test('five identical non-productive actions trip the circuit breaker before the ceiling', async () => {
    // The complement of the test above: when the action fingerprint does NOT
    // change, the circuit breaker force-finishes long before step 60.
    llmScript = [(n) => ({ type: 'note', text: `observation number ${n}` })];
    await runAgent(SIMPLE_GOAL);
    expect(finishSummary()).toContain('Task force-finished by circuit breaker');
    expect(mockCallLLMWithRetry.mock.calls.length).toBeLessThan(15);
  });

  test('the budget hint tells the model how many steps remain', async () => {
    llmScript = [
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(llmStateSnapshots[0].budgetHint.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. The state machine (#45) — does the declared machine match the real loop?
//
// These are the tests that make the refactor worth doing. Everything above pins
// behaviour; these check that the phase sequence and terminal alphabet declared
// in agent-loop-machine.js are an accurate description of what runAgentLoop
// actually does, rather than a comment that drifts out of date.
// ═════════════════════════════════════════════════════════════════════════════
describe('loop state machine', () => {
  test('a real run makes no illegal phase transitions', async () => {
    llmScript = [
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'note', text: 'thinking about it' },
      { type: 'scroll', direction: 'down' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    expect(getLoopMachineSnapshot().illegalTransitions).toBe(0);
  });

  test('every recorded transition is legal under isLegalTransition', async () => {
    llmScript = [
      { type: 'read_page' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    const { trace } = getLoopMachineSnapshot();
    expect(trace.length).toBeGreaterThan(0);
    for (const step of trace) {
      expect(isLegalTransition(null, step.phases[0])).toBe(true);
      for (let i = 0; i < step.phases.length - 1; i++) {
        expect(isLegalTransition(step.phases[i], step.phases[i + 1])).toBe(true);
      }
    }
  });

  test('a note short-circuits at DISPATCH and never reaches ACT', async () => {
    llmScript = [
      { type: 'note', text: 'just observing' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    const first = getLoopMachineSnapshot().trace[0].phases;
    expect(first).toEqual([
      LOOP_PHASE.PREFLIGHT, LOOP_PHASE.ACQUIRE_TAB, LOOP_PHASE.OBSERVE,
      LOOP_PHASE.INTERRUPT, LOOP_PHASE.DIRECTIVES, LOOP_PHASE.THINK,
      LOOP_PHASE.PREPROCESS, LOOP_PHASE.DISPATCH,
    ]);
    expect(first).not.toContain(LOOP_PHASE.ACT);
  });

  test('a page-affecting action runs the full phase sequence through CHECKPOINT', async () => {
    llmScript = [
      { type: 'click', selector: '#a' },
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    const first = getLoopMachineSnapshot().trace[0].phases;
    expect(first).toContain(LOOP_PHASE.ACT);
    expect(first).toContain(LOOP_PHASE.VERIFY);
    expect(first).toContain(LOOP_PHASE.CHECKPOINT);
    expect(first[first.length - 1]).toBe(LOOP_PHASE.CHECKPOINT);
  });

  test('the machine ends in FINALIZE with the step trace intact', async () => {
    llmScript = [
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'done' },
    ];
    await runAgent(SIMPLE_GOAL);
    const snap = getLoopMachineSnapshot();
    expect(snap.phase).toBe(LOOP_PHASE.FINALIZE);
    expect(snap.trace.map(t => t.step)).toEqual([1, 2]);
  });

  // One case per terminal this harness can actually reach. The remaining
  // LOOP_EXIT values are covered by tests/agent-loop-machine.test.js.
  const terminalCases = [
    ['FINISH', LOOP_EXIT.FINISH, () => {
      llmScript = [
        { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
        { type: 'finish', summary: 'done' },
      ];
    }],
    ['NO_LLM_CALLS', LOOP_EXIT.NO_LLM_CALLS, () => {
      llmCountsApiCalls = false;
      llmScript = [{ type: 'note', text: 'thinking' }];
    }],
    ['NO_ACTIVE_TAB', LOOP_EXIT.NO_ACTIVE_TAB, () => {
      _activeTabId = null;
      _allTabContexts = [];
    }],
    ['TAB_CLOSED', LOOP_EXIT.TAB_CLOSED, () => {
      mockGetTabInfo.mockImplementation(async () => null);
      _tabsQueryResult = [];
    }],
    // Stopping while the page is being observed means the run is still inside
    // the step when it reaches the explicit pre-dispatch guard, so the terminal
    // is named. (A `note` would short-circuit at DISPATCH before that guard, so
    // this case needs a page-affecting action.)
    ['STOPPED', LOOP_EXIT.STOPPED, () => {
      llmScript = [{ type: 'click', selector: '#a' }];
      contentScriptRouter = async (msg) => {
        if (msg && msg.action === 'read_page') await stopAgent();
        return undefined;
      };
    }],
    // Stopping during the LLM call instead lands after the step's last
    // `continue`, so the `while (!finished && agentRunning)` condition ends the
    // run before any explicit guard is reached. That is a distinct terminal and
    // the machine reports it as such rather than mislabelling it STOPPED.
    ['LOOP_CONDITION', LOOP_EXIT.LOOP_CONDITION, () => {
      llmScript = [async () => { await stopAgent(); return { type: 'note', text: 'late' }; }];
    }],
    ['PROSE_LOOP', LOOP_EXIT.PROSE_LOOP, () => {
      llmScript = [{ type: 'note', text: 'Parse error (will retry) — captured model output: Let me update the config:' }];
    }],
    ['HARD_STOP', LOOP_EXIT.HARD_STOP, () => {
      llmScript = [{ type: 'note', text: 'No endpoints found that support image input' }];
    }],
    ['CIRCUIT_BREAKER_FORCE_FINISH', LOOP_EXIT.CIRCUIT_BREAKER_FORCE_FINISH, () => {
      llmScript = [(n) => ({ type: 'note', text: 'observation number ' + n })];
    }],
    ['CLICK_AT_BLOCK_LIMIT', LOOP_EXIT.CLICK_AT_BLOCK_LIMIT, () => {
      _scriptingResult = 'y'.repeat(200);
      llmScript = [{ type: 'click_at' }];
    }],
    ['CLICK_AT_DATA_IN_MEMORY', LOOP_EXIT.CLICK_AT_DATA_IN_MEMORY, () => {
      llmScript = [{ type: 'extract', key: 'page_content', selector: '#a' }, { type: 'click_at' }];
      contentScriptRouter = (msg) => {
        if (msg && msg.action === 'execute_command' && msg.command && msg.command.type === 'extract') {
          return JSON.stringify({ key: 'page_content', value: 'q'.repeat(900) });
        }
        return undefined;
      };
    }],
  ];

  test.each(terminalCases)('records the %s terminal', async (_name, expected, setup) => {
    setup();
    await runAgent(SIMPLE_GOAL);
    expect(getLoopMachineSnapshot().exitReason).toBe(expected);
  });

  test('the step-limit terminal carries the ceiling that was hit', async () => {
    llmScript = [(n) => (n % 2 ? { type: 'note', text: 'observation number ' + n } : { type: 'wait', ms: 1 })];
    await runAgent(SIMPLE_GOAL);
    const snap = getLoopMachineSnapshot();
    expect(snap.exitReason).toBe(LOOP_EXIT.STEP_LIMIT);
    expect(snap.exitDetail).toBe('cap 60');
    // ...and the trace stays ring-capped even on the longest possible run.
    expect(snap.trace.length).toBeLessThanOrEqual(200);
  }, 120000);

  test('each run starts from a clean machine', async () => {
    llmScript = [{ type: 'note', text: 'Parse error (will retry) — captured model output: looping' }];
    await runAgent(SIMPLE_GOAL);
    expect(getLoopMachineSnapshot().exitReason).toBe(LOOP_EXIT.PROSE_LOOP);

    sentMessages = [];
    llmCalls = 0;
    llmPromptSnapshots = [];
    llmScript = [
      { type: 'execute_js', code: 'return "payload data here"', key: 'k' },
      { type: 'finish', summary: 'clean run' },
    ];
    await runAgent(SIMPLE_GOAL);
    const snap = getLoopMachineSnapshot();
    expect(snap.exitReason).toBe(LOOP_EXIT.FINISH);
    expect(snap.trace.map(t => t.step)).toEqual([1, 2]);
  });
});
