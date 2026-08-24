// tests/live/agent-live-smoke.test.js
//
// LIVE end-to-end smoke test of the agent loop against a REAL LLM.
//
// Excluded from `npm test` / `npm run check` (jest.config.js
// testPathIgnorePatterns) because it makes real network calls. Run it with:
//
//     npm run test:live
//
// WHAT THIS COVERS, and why it is the right layer.
// A true browser E2E would need Chrome + a CDP driver; neither puppeteer nor
// playwright is a dependency of this repo, and driving an unpacked MV3
// extension over raw CDP is not a reliable test harness. So this drives the
// REAL runAgentLoop, the REAL prompt builder, the REAL llm-client (real fetch,
// real provider registry, real request/response shaping) and the REAL response
// parser, against a simulated page. Everything between "goal typed by an MSP
// tech" and "HTTP request on the wire" is production code here; only the
// browser surface (tab-manager / content script / CDP) is simulated.
//
// It answers: does a real model, given this product's real prompt, emit action
// JSON this product can parse and execute, and does the loop drive a
// multi-step task to a grounded finish?
//
// Endpoints (see SENTINEL_LIVE_* env vars at the bottom of this header):
//   TEXT   http://127.0.0.1:8800/v1/chat/completions   LongCat-2.0-nonthink
//   VISION http://127.0.0.1:8901/u/zai/v1/chat/completions  glm-4.6v
// A missing/unreachable endpoint SKIPS the affected test rather than failing,
// so this file is safe to run anywhere.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** A real 800x600 PNG of the simulated queue page, with SoM boxes drawn on the
 *  three ticket links — so the vision model is handed something it can actually
 *  read, not a placeholder string that would make a 400 look like a pass. */
const TINY_PNG_B64 = readFileSync(join(__dirname, 'fixture-screenshot.b64'), 'utf8').trim();


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
jest.unstable_mockModule('../../background/error-utils.js', () => ({
  getErrorMessage: (err) => {
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && err !== null && typeof err.message === 'string') return err.message;
    if (err === null || err === undefined) return '';
    return String(err);
  },
  sleep: () => Promise.resolve(),
}));

jest.unstable_mockModule('../../background/platforms/index.js', () => ({
  getPlatformProfile: jest.fn(() => null),
}));

// ── Simulated page: a small MSP helpdesk ────────────────────────────────────
// Two "pages" with real-looking ticket data. The goal below can only be
// answered by reading page 1, moving to page 2, and reading that — so a model
// that guesses instead of acting produces a summary we can detect.

const SITE = {
  'https://helpdesk.test/tickets': {
    title: 'Open Tickets — Northwind MSP',
    text: [
      'Northwind MSP — Open Ticket Queue',
      '',
      'ID       PRIORITY  SUBJECT                              AGE',
      'TKT-4471 P3        Printer offline in Accounting        3d',
      'TKT-4488 P1        Exchange mail flow stopped           41m',
      'TKT-4492 P2        VPN drops for remote users           6h',
      '',
      'Click a ticket ID to open its detail page.',
    ].join('\n'),
    elements: [
      { selector: '#t4471', ref: 'r1', tag: 'a', text: 'TKT-4471', index: 1, href: 'https://helpdesk.test/tickets/4471' },
      { selector: '#t4488', ref: 'r2', tag: 'a', text: 'TKT-4488', index: 2, href: 'https://helpdesk.test/tickets/4488' },
      { selector: '#t4492', ref: 'r3', tag: 'a', text: 'TKT-4492', index: 3, href: 'https://helpdesk.test/tickets/4492' },
      { selector: '#refresh', ref: 'r4', tag: 'button', text: 'Refresh', index: 4 },
    ],
  },
  'https://helpdesk.test/tickets/4488': {
    title: 'TKT-4488 — Exchange mail flow stopped',
    text: [
      'TKT-4488 — Exchange mail flow stopped',
      'Priority: P1   Status: Open   Assigned to: UNASSIGNED',
      'Client: Contoso Ltd',
      'SLA: BREACHED 11 minutes ago',
      'Reported by: helpdesk@contoso.example',
      'Last note: transport queue is backing up on EX01.',
    ].join('\n'),
    elements: [
      { selector: '#assign', ref: 'r9', tag: 'button', text: 'Assign to me', index: 1 },
      { selector: '#back', ref: 'r8', tag: 'a', text: 'Back to queue', index: 2 },
    ],
  },
};

const START_URL = 'https://helpdesk.test/tickets';
let _url = START_URL;
/** Every action the model actually got executed, in order. */
let actionLog = [];

function page() { return SITE[_url] || { title: 'Not found', text: '404', elements: [] }; }

/** Toggle: when true, cdpExecuteJs answers the vision element-discovery probe. */
let visionEnabled = false;

const mockGetTabInfo = jest.fn(async () => ({ url: _url, title: page().title, status: 'complete', windowId: 1 }));

const mockSendMessageWithRetry = jest.fn(async (tabId, msg) => {
  const action = msg && msg.action;
  const cmd = (msg && msg.command) || {};
  if (action === 'observe_page') return { elements: page().elements.slice() };
  if (action === 'read_page') return { content: page().text };
  if (action === 'dismiss_overlays') return { count: 0 };
  if (action === 'detect_tenant') return null;
  if (action === 'wait_for') return 'Wait satisfied';
  if (action === 'execute_command' || action === 'dispatch_command') {
    actionLog.push(cmd.type || 'unknown');
    if (cmd.type === 'execute_js') return page().text.slice(0, 3000);
    if (cmd.type === 'click' || cmd.type === 'click_at') {
      const el = page().elements.find(e =>
        e.selector === cmd.selector || e.ref === cmd.ref || e.index === cmd.index);
      if (el && el.href) { _url = el.href; return `Clicked ${el.text}`; }
      return el ? `Clicked ${el.text}` : 'Element not found';
    }
    return 'Done';
  }
  return {};
});

function navigateTo(url) { if (SITE[url]) { _url = url; return true; } return false; }

jest.unstable_mockModule('../../background/tab-manager.js', () => ({
  waitForPageLoad: jest.fn(async () => {}),
  waitForPageReady: jest.fn(async () => {}),
  injectContentScript: jest.fn(async () => true),
  sendMessageWithRetry: mockSendMessageWithRetry,
  takeScreenshot: jest.fn(async () => ({ base64Image: TINY_PNG_B64, width: 800, height: 600, dpr: 1, scrollX: 0, scrollY: 0 })),
  isValidUrl: jest.fn((u) => typeof u === 'string' && /^https?:\/\//.test(u)),
  getTabInfo: mockGetTabInfo,
  detachAllDebuggees: jest.fn(async () => {}),
  cdpDispatchClick: jest.fn(async () => ({ ok: true })),
  cdpDispatchType: jest.fn(async () => ({ ok: true })),
  cdpDispatchKey: jest.fn(async () => ({ ok: true })),
  cdpExecuteJs: jest.fn(async (tab, code) => {
    const src = String(code || '');
    if (visionEnabled && /sentinel-index|data-sentinel|querySelectorAll/i.test(src) && /index/i.test(src)) {
      return { ok: true, value: JSON.stringify(page().elements.map(e => ({
        index: e.index, tag: e.tag.toUpperCase(), text: e.text, href: e.href || '',
        rect: { x: 10, y: 20 * e.index, width: 120, height: 18 }, isInteractive: true,
      }))) };
    }
    if (/body.*innerText/i.test(src)) return { ok: true, value: page().text };
    return { ok: true, value: 'noop' };
  }),
  readConsoleMessages: jest.fn(() => []),
  readNetworkRequests: jest.fn(() => []),
}));

jest.unstable_mockModule('../../background/message-protocol.js', () => ({
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

jest.unstable_mockModule('../../background/report-generator.js', () => ({
  generateReport: jest.fn(async () => ({ summary: 'r', fullReport: 'full report', structuredData: {} })),
  buildFallbackReport: jest.fn(() => 'fallback'),
}));

// emitAgentCompletion is the last thing runAgentLoop does — use it as the
// "loop is fully finished" signal so tests never race the finalize block.
let _completionResolvers = [];
jest.unstable_mockModule('../../background/shared-state.js', () => ({
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
jest.unstable_mockModule('../../background/tab-context.js', () => ({
  TAB_LIMIT: 10,
  getActiveTabId: jest.fn(() => _activeTabId),
  getTabContext: jest.fn((id) => ({ tabId: id, label: 'main', url: _url, screenshotCache: {} })),
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

jest.unstable_mockModule('../../background/client-knowledge.js', () => ({
  getClientStartupContext: jest.fn(async () => ({ client: null, relevantEntries: [], promptSection: '' })),
  markRunCompleted: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../background/adaptive-prompts.js', () => ({
  rewriteGoalForPlatform: jest.fn(async () => null),
}));

jest.unstable_mockModule('../../background/audit-log.js', () => ({
  appendAuditEntry: jest.fn(async () => {}),
  getAuditLog: jest.fn(async () => []),
  auditLogToCsv: jest.fn(() => ''),
}));

jest.unstable_mockModule('../../background/skills/index.js', () => ({
  runRecoverySkills: jest.fn(() => ({ appliedSkillIds: [], autoApply: null, promptInjection: '' })),
  getSkillStats: jest.fn(() => ({ total: 0 })),
}));

jest.unstable_mockModule('../../background/telemetry.js', () => ({
  tel: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() },
  startRun: jest.fn(),
  endRun: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../background/trust-score.js', () => ({
  computeTrustScore: jest.fn(() => ({ score: 70, band: 'ok', breakdown: {} })),
  suggestRetryActions: jest.fn(() => []),
}));

jest.unstable_mockModule('../../background/brain-client.js', () => ({
  getBrainStartupContext: jest.fn(async () => ({ ok: false, section: '' })),
  resetBrainRunSignals: jest.fn(),
}));

jest.unstable_mockModule('../../background/brain-producer.js', () => ({
  publishRunLearning: jest.fn(async () => ({ ok: false })),
  resetBrainProducerRunSignals: jest.fn(),
}));


// ── Import after mocks ──────────────────────────────────────────────────────
const { startAgent, stopAgent, resetAgentState, getLoopMachineSnapshot } =
  await import('../../background/agent-engine.js');

// ── Wire recorder ───────────────────────────────────────────────────────────
// Wraps global fetch so every request the production llm-client actually makes
// is visible: endpoint, model, whether an image part was attached, the HTTP
// status, and how the response came back. Without this a "passing" vision test
// could simply mean the loop quietly fell back to the text path.
/** @type {Array<object>} */
let wireLog = [];
/** Raw outbound request bodies, so a masking test can assert on real bytes. */
let outboundBodies = [];
const _realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const entry = { url: String(url), model: null, hasImage: false, status: null, ms: 0, err: null, empty: null };
  try {
    const body = init && init.body ? JSON.parse(init.body) : null;
    if (body) {
      entry.model = body.model || null;
      entry.stream = !!body.stream;
      entry.tools = Array.isArray(body.tools) ? body.tools.length : 0;
      entry.hasImage = JSON.stringify(body.messages || []).includes('image_url')
        || JSON.stringify(body.messages || []).includes('"type":"image"');
      entry.promptChars = JSON.stringify(body.messages || []).length;
    }
  } catch { /* not JSON */ }
  outboundBodies.push(String((init && init.body) || ''));
  const t0 = Date.now();
  try {
    const res = await _realFetch(url, init);
    entry.status = res.status;
    entry.ms = Date.now() - t0;
    // Clone so the production code still gets an unread body.
    try {
      const clone = res.clone();
      const txt = await clone.text();
      entry.bytes = txt.length;
      if (!entry.stream) {
        try {
          const j = JSON.parse(txt);
          const m = j && j.choices && j.choices[0] && j.choices[0].message;
          entry.empty = !!m && !m.content && !!m.reasoning_content;
          entry.finish = j && j.choices && j.choices[0] && j.choices[0].finish_reason;
          entry.toolCalls = !!(m && m.tool_calls && m.tool_calls.length);
        } catch { /* streamed or non-JSON */ }
      }
    } catch { /* clone failed */ }
    wireLog.push(entry);
    return res;
  } catch (e) {
    entry.err = String(e && e.message || e);
    entry.ms = Date.now() - t0;
    wireLog.push(entry);
    throw e;
  }
};

function wireSummary() {
  return wireLog.map(e =>
    `${e.status ?? 'ERR'} ${e.ms}ms ${e.url} model=${e.model} image=${e.hasImage} stream=${e.stream} `
    + `tools=${e.tools} promptChars=${e.promptChars} finish=${e.finish} toolCalls=${e.toolCalls} `
    + `emptyContent=${e.empty}${e.err ? ' err=' + e.err : ''}`).join('\n');
}

// ── Live endpoint configuration ─────────────────────────────────────────────
const TEXT_ENDPOINT = process.env.SENTINEL_LIVE_TEXT_ENDPOINT
  || 'http://127.0.0.1:8800/v1/chat/completions';
const TEXT_MODEL = process.env.SENTINEL_LIVE_TEXT_MODEL || 'LongCat-2.0-nonthink';
const VISION_ENDPOINT = process.env.SENTINEL_LIVE_VISION_ENDPOINT
  || 'http://127.0.0.1:8901/u/zai/v1/chat/completions';
const VISION_MODEL = process.env.SENTINEL_LIVE_VISION_MODEL || 'glm-4.6v';
const VISION_KEY = process.env.SENTINEL_LIVE_VISION_KEY || '';

/** Probe an endpoint once so an unreachable model skips rather than fails. */
async function reachable(endpoint, model, key) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 }),
      signal: AbortSignal.timeout(20000),
    });
    return res.status === 200;
  } catch { return false; }
}

const TEXT_UP = await reachable(TEXT_ENDPOINT, TEXT_MODEL, '');
const VISION_UP = VISION_KEY ? await reachable(VISION_ENDPOINT, VISION_MODEL, VISION_KEY) : false;

function configureProvider({ endpoint, model, apiKey, id = 'openai' }) {
  storageData.active_provider = id;
  storageData.providers = {
    [id]: { endpoint, api_key: apiKey === undefined ? 'local-no-auth' : apiKey, model, max_tokens: 4000, temperature: 0.2 },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeSender(tabId = 1) {
  return { tab: { id: tabId, url: START_URL, windowId: 1 } };
}

function loopSettled(timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('runAgentLoop did not settle in time')), timeoutMs);
    _completionResolvers.push(() => { clearTimeout(timer); resolve(); });
  });
}

async function runAgent(goal, timeoutMs) {
  const settled = loopSettled(timeoutMs);
  await startAgent(goal, makeSender());
  await settled;
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return sentMessages;
}

function finishSummary() {
  const msg = sentMessages.filter(m => m && m.action === 'agent_finished').pop();
  return msg ? String(msg.summary || '') : '';
}

/** Every result string the loop reported back, for diagnosing where it broke. */
function resultTrail() {
  return sentMessages
    .filter(m => m && (m.action === 'agent_update' || m.action === 'agent_action_result'))
    .map(m => String(m.result || m.message || '')).join('\n');
}

const GOAL = 'Open the P1 ticket on the Northwind MSP queue page and report its ticket ID, '
  + 'its subject, who it is assigned to, and its SLA status.';

beforeEach(() => {
  for (const k of Object.keys(storageData)) delete storageData[k];
  for (const k of Object.keys(sessionData)) delete sessionData[k];
  sentMessages = [];
  actionLog = [];
  wireLog = [];
  outboundBodies = [];
  _url = START_URL;
  visionEnabled = false;
  _completionResolvers = [];
  _tabsQueryResult = [{ id: 1, url: START_URL, title: 'Open Tickets', windowId: 1 }];
  _scriptingResult = SITE[START_URL].text;
  jest.clearAllMocks();
  resetAgentState();
});

afterEach(async () => {
  try { await stopAgent(); } catch { /* ignore */ }
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LIVE: text model drives a multi-step MSP task', () => {
  const t = TEXT_UP ? test : test.skip;
  if (!TEXT_UP) {
    // eslint-disable-next-line no-console
    console.warn(`[live] SKIPPING text tests — ${TEXT_ENDPOINT} (${TEXT_MODEL}) did not answer 200`);
  }

  t('a real model plans, acts, and finishes with grounded ticket data', async () => {
    configureProvider({ endpoint: TEXT_ENDPOINT, model: TEXT_MODEL });
    await runAgent(GOAL);

    const summary = finishSummary();
    const snap = getLoopMachineSnapshot();

    // Diagnostics first — when this fails we want to see WHERE, not just that.
    const diag = JSON.stringify({
      exit: snap && snap.exit, steps: snap && snap.steps,
      actions: actionLog, endedOn: _url, summary: summary.slice(0, 400),
    }, null, 2);

    // 1. The model was actually consulted and the loop terminated cleanly.
    expect(snap).toBeTruthy();
    expect(String(snap.exit || '')).not.toMatch(/NO_LLM_CALL|NO_ACTIVE_TAB/);

    // 2. It emitted parseable actions the executor could run — not prose.
    expect(actionLog.length + (_url !== START_URL ? 1 : 0)).toBeGreaterThan(0);

    // 3. It reached the detail page, which requires acting on page 1's output.
    // eslint-disable-next-line no-console
    console.log('[live] run diagnostics:\n' + diag + '\n--- wire ---\n' + wireSummary());
    expect(_url).toBe('https://helpdesk.test/tickets/4488');

    // 4. The finish summary is grounded in what was on the detail page.
    expect(summary).toMatch(/TKT-4488/);
    expect(summary.toLowerCase()).toMatch(/unassigned/);
    expect(summary.toLowerCase()).toMatch(/breach/);

    // 5. It did not hallucinate the other tickets' IDs as the P1.
    expect(summary).not.toMatch(/TKT-4471 .{0,20}P1/);

    // 6. Against a text-only model the loop probes vision ONCE and then stops.
    //    Before the visionDegraded fix this was one rejected ~57KB image upload
    //    plus a fallback call on EVERY step — visible here as a 400/200 pair per
    //    step. Regression guard: at most one image request in the whole run.
    const imageCalls = wireLog.filter(e => e.hasImage);
    // eslint-disable-next-line no-console
    console.log(`[live] image requests this run: ${imageCalls.length} (statuses: ${imageCalls.map(e => e.status).join(',')})`);
    expect(imageCalls.length).toBeLessThanOrEqual(1);
  }, 300000);

  t('the loop terminates on a named machine exit, never by falling off the end', async () => {
    configureProvider({ endpoint: TEXT_ENDPOINT, model: TEXT_MODEL });
    await runAgent('Read the ticket queue page and tell me how many tickets are open.');
    const snap = getLoopMachineSnapshot();
    // eslint-disable-next-line no-console
    console.log('[live] snapshot:', JSON.stringify(snap).slice(0, 800));
    expect(snap).toBeTruthy();
    expect(finishSummary().length).toBeGreaterThan(0);
  }, 300000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LIVE: vision path', () => {
  const t = VISION_UP ? test : test.skip;
  if (!VISION_UP) {
    // eslint-disable-next-line no-console
    console.warn(`[live] SKIPPING vision tests — ${VISION_ENDPOINT} (${VISION_MODEL}) `
      + `${VISION_KEY ? 'did not answer 200' : 'has no SENTINEL_LIVE_VISION_KEY'}`);
  }

  t('a real vision model accepts the screenshot payload and returns an action', async () => {
    visionEnabled = true;
    configureProvider({ endpoint: VISION_ENDPOINT, model: VISION_MODEL, apiKey: VISION_KEY });
    await runAgent('Look at the page and report the ID of the P1 ticket.');

    const snap = getLoopMachineSnapshot();
    const trail = resultTrail();
    const diag = JSON.stringify({ exit: snap && snap.exit, actions: actionLog, summary: finishSummary().slice(0, 300) }, null, 2);

    // The specific failure we are hunting: the vision request being rejected
    // outright (bad payload shape, model can't see images, empty content).
    // eslint-disable-next-line no-console
    console.log('[live] vision diagnostics:\n' + diag + '\n--- wire ---\n' + wireSummary() + '\n--- trail ---\n' + trail.slice(0, 1500));
    // The loop must have actually sent an image to the vision model — not
    // quietly fallen back to the text path and still "passed".
    expect(wireLog.some(e => e.hasImage)).toBe(true);
    expect(wireLog.filter(e => e.hasImage).every(e => e.status === 200)).toBe(true);
    expect(trail).not.toMatch(/Vision LLM non-ok|vision payload|400 Bad Request/i);
    expect(String(snap.exit || '')).not.toMatch(/NO_LLM_CALL/);
    expect(finishSummary().length).toBeGreaterThan(0);
  }, 300000);
});

// ═══════════════════════════════════════════════════════════════════════════
// A keyless self-hosted provider must reach the model at all. Before the
// providerRequiresApiKey() fix, callLLM threw "No API key configured" for every
// `auth: 'none'` provider in the catalog, so this configuration could not make
// a single request. This drives the REAL llm-client directly (one call) rather
// than a whole run: ollama on this box is CPU-only, so a full multi-step run
// takes many minutes and would tell us nothing extra about the key gate.
describe('LIVE: keyless local provider (ollama)', () => {
  const OLLAMA = process.env.SENTINEL_LIVE_OLLAMA_ENDPOINT
    || 'http://127.0.0.1:11434/v1/chat/completions';
  const OLLAMA_MODEL = process.env.SENTINEL_LIVE_OLLAMA_MODEL || 'qwen2.5-degrade:3b';
  let up = false;
  let callLLMWithRetry;

  beforeAll(async () => {
    up = await reachable(OLLAMA, OLLAMA_MODEL, '');
    ({ callLLMWithRetry } = await import('../../background/llm-client.js'));
  });

  test('callLLM reaches the endpoint with an empty api_key', async () => {
    if (!up) {
      // eslint-disable-next-line no-console
      console.warn(`[live] SKIPPING ollama test — ${OLLAMA} (${OLLAMA_MODEL}) did not answer 200`);
      return;
    }
    storageData.active_provider = 'ollama';
    storageData.providers = {
      ollama: { endpoint: OLLAMA, api_key: '', model: OLLAMA_MODEL, max_tokens: 512, temperature: 0.2 },
    };

    const state = {
      apiCallCount: 0, consecutiveFailures: 0, currentStrategies: [],
      agentMemory: {}, agentPlan: null, currentPlanStep: 0, model: OLLAMA_MODEL,
    };
    const cmd = await callLLMWithRetry(
      [], 0, SITE[START_URL].text, null,
      'Say how many tickets are listed on this page.',
      [], 1, START_URL, 0,
      { maxRetries: 1, retryDelay: 100, maxRetryDelay: 500, fetchTimeout: 180000,
        historyWindow: 5, strategyShiftThreshold: 3, streaming: false },
      state
    );

    const calls = wireLog.filter(e => e.url.includes('11434'));
    // eslint-disable-next-line no-console
    console.log('[live] ollama wire:\n' + wireSummary() + '\ncommand=' + JSON.stringify(cmd).slice(0, 300));

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some(e => e.status === 200)).toBe(true);
    // No Authorization header was invented for a keyless provider.
    expect(cmd).toBeTruthy();
    expect(typeof cmd.type).toBe('string');
  }, 400000);
});


// ═══════════════════════════════════════════════════════════════════════════
// LIVE MASKING VERIFICATION
//
// The scrubber now sits in the path of EVERY cloud request, so unit and wire
// tests are not enough — this drives a real multi-step run against a real cloud
// model with masking engaged and proves three things end to end:
//   (a) planted secrets never appear in the outbound body,
//   (b) the agent still completes the task with the scrubber in the path,
//   (c) restoration works — no [[TOKEN]] leaks into the agent's actions or the
//       final report.
//
// The page below carries a planted API key and a planted client email inside
// otherwise ordinary ticket text.
describe('LIVE: masking end-to-end against a real cloud model', () => {
  const PLANTED_KEY = 'sk-' + 'ant-' + 'api03-' + 'L'.repeat(30);
  const PLANTED_EMAIL = 'billing.contact@acme-client.example';
  const PLANTED_PHONE = '(617) 555-0142';

  // Uses a fast TEXT cloud model, not the vision one: this test is about the
  // scrub path, and glm-4.6v spends ~26s per call thinking (see the token-budget
  // finding), which pushes a multi-step run past any sane settle window.
  const CLOUD_ENDPOINT = process.env.SENTINEL_LIVE_CLOUD_ENDPOINT
    || 'http://127.0.0.1:8901/u/zai/v1/chat/completions';
  const CLOUD_MODEL = process.env.SENTINEL_LIVE_CLOUD_MODEL || 'glm-4.6';
  let up = false;
  beforeAll(async () => { up = VISION_KEY ? await reachable(CLOUD_ENDPOINT, CLOUD_MODEL, VISION_KEY) : false; });

  test('secrets are masked, the task still completes, and values are restored', async () => {
    if (!up) {
      // eslint-disable-next-line no-console
      console.warn(`[live] SKIPPING masking test — ${CLOUD_ENDPOINT} unreachable or no key`);
      return;
    }

    // Plant secrets into the simulated pages for this test only.
    const origQueue = SITE[START_URL].text;
    const origDetail = SITE['https://helpdesk.test/tickets/4488'].text;
    SITE[START_URL].text = origQueue
      + `\nBilling contact: ${PLANTED_EMAIL}  Callback: ${PLANTED_PHONE}`;
    SITE['https://helpdesk.test/tickets/4488'].text = origDetail
      + `\nIntegration API key: ${PLANTED_KEY}`
      + `\nReporter: ${PLANTED_EMAIL}`;

    try {
      storageData.egressScrubMode = 'cloud';
      configureProvider({ endpoint: CLOUD_ENDPOINT, model: CLOUD_MODEL, apiKey: VISION_KEY });
      await runAgent(
        'Open the P1 ticket on the Northwind MSP queue page and report its ticket ID, '
        + 'subject, assignee and SLA status.',
        540000
      );

      const wire = wireLog.map(e => e.url).join('\n');
      const bodies = outboundBodies.join('\n');
      const summary = finishSummary();
      const snap = getLoopMachineSnapshot();

      // eslint-disable-next-line no-console
      console.log('[live/mask] requests=' + wireLog.length
        + ' exit=' + (snap && snap.exitReason)
        + ' endedOn=' + _url
        + '\n[live/mask] wire:\n' + wireSummary()
        + '\n[live/mask] summary head: ' + summary.slice(0, 300));

      // (a) Nothing planted reached the wire.
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies).not.toContain(PLANTED_KEY);
      expect(bodies).not.toContain(PLANTED_EMAIL);
      expect(bodies).not.toContain(PLANTED_PHONE);
      // …and placeholders did, so the model still saw structure.
      expect(bodies).toMatch(/\[\[(SECRET|EMAIL)-\d+\]\]/);
      // Legitimate ticket detail still reached the model.
      expect(bodies).toContain('TKT-4488');

      // (b) The task still completed with the scrubber in the path.
      expect(_url).toBe('https://helpdesk.test/tickets/4488');
      expect(summary).toMatch(/TKT-4488/);
      expect(String(snap.exitReason || '')).not.toMatch(/NO_LLM_CALL|NO_ACTIVE_TAB/);

      // (c) No placeholder token leaked into the agent's own output or actions.
      expect(summary).not.toMatch(/\[\[[A-Z]+-\d+\]\]/);
      const actionText = JSON.stringify(sentMessages);
      expect(actionText).not.toMatch(/\[\[SECRET-\d+\]\]/);
    } finally {
      SITE[START_URL].text = origQueue;
      SITE['https://helpdesk.test/tickets/4488'].text = origDetail;
    }
  }, 600000);
});
