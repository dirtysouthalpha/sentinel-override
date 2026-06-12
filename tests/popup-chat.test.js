// tests/popup-chat.test.js
// Unit tests for popup-modules/chat.js — renderTenantChip, describeActionPlain,
// RISKY_ACTION_PATTERN, updateActiveTabPage, updateActiveTabStep.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    classList: {
      _classes: [],
      add(c) { if (!this._classes.includes(c)) this._classes.push(c); },
      remove(c) { this._classes = this._classes.filter(x => x !== c); },
      toggle(c, force) {
        if (force === true) this.add(c);
        else if (force === false) this.remove(c);
        else if (this.contains(c)) this.remove(c);
        else this.add(c);
      },
      contains(c) { return this._classes.includes(c); }
    },
    dataset: {},
    _attrs: {},
    _children: [],
    _parent: null,
    _innerHTML: '',
    _textContent: '',
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = v || ''; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v || ''; },
    get value() { return this._attrs.value || ''; },
    set value(v) { this._attrs.value = v; },
    setAttribute(n, v) { this._attrs[n] = v; },
    getAttribute(n) { return this._attrs[n]; },
    removeAttribute(n) { delete this._attrs[n]; },
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { this._children.push(c); c._parent = this; return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); },
    insertBefore(newNode, refNode) {
      const idx = refNode ? this._children.indexOf(refNode) : this._children.length;
      if (idx >= 0) this._children.splice(idx, 0, newNode);
      else this._children.push(newNode);
      newNode._parent = this;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    remove() {
      if (this._parent) this._parent.removeChild(this);
    },
    click() {},
    scrollIntoView() {},
    dispatchEvent() { return true; }
  };
  return el;
}

function createSandbox() {
  const elements = {};
  const elCache = {};

  function getOrCreate(id) {
    if (!elCache[id]) elCache[id] = makeElement('div');
    return elCache[id];
  }

  const sandbox = {
    window: {},
    getErrorMessage(err) {
      if (typeof err === 'string') return err;
      if (typeof err === 'object' && err !== null && typeof err.message === 'string') return err.message;
      return String(err || '');
    },
    console,
    JSON,
    Error,
    TypeError,
    RangeError,
    RegExp,
    Object,
    Array,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Promise: { resolve: () => ({ then: (fn) => fn(), catch: () => {} }) },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    URL: { prototype: {} },
    navigator: { clipboard: { writeText: () => ({ then: (fn) => fn(), catch: () => {} }) } },
    Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    fetch: () => Promise.resolve({ ok: true, status: 200 }),
    AbortController: class { abort() {} },
    chrome: {
      runtime: {
        sendMessage: (msg, cb) => { if (cb) cb({ ok: true }); },
        lastError: null,
        onMessage: { addListener() {} },
      },
      storage: {
        local: {
          get(keys, cb) { if (cb) cb({}); },
          set(data, cb) { if (cb) cb(); },
        },
        onChanged: { addListener() {} },
      },
      tabs: { query: () => Promise.resolve([]), update: () => Promise.resolve(), get: () => Promise.resolve() },
      windows: { update: () => Promise.resolve() },
    },
    document: {
      createElement(tag) { return makeElement(tag); },
      body: makeElement('body'),
      head: makeElement('head'),
      documentElement: { style: { setProperty() {} } },
      getElementById(id) { return getOrCreate(id); },
      querySelector(sel) {
        if (sel === '.welcome-message') return null;
        return null;
      },
      querySelectorAll(sel) { return []; },
      addEventListener() {},
      readyState: 'complete',
    },
    sanitizeHtml: (s) => s,
    escapeHtml: (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    isValidUrl: () => true,
    showToast: () => {},
    getState: () => ({
      conversationHistory: [],
      selectedAttachments: [],
      pendingStepLogs: {},
    }),
    marked: { parse: (s) => s },
    window: {
      matchMedia: () => ({ matches: false }),
      confirm: () => true,
      SpeechRecognition: null,
      webkitSpeechRecognition: null,
    },
  };
  sandbox.window = sandbox.window || {};
  Object.assign(sandbox.window, sandbox);
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/chat.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'chat.js' });
  script.runInContext(sandbox);
  return sandbox;
}

describe('chat.js — describeActionPlain', () => {
  let sandbox;
  beforeAll(() => { sandbox = createSandbox(); loadModule(sandbox); });

  test('returns empty string for null payload', () => {
    expect(sandbox.describeActionPlain(null)).toBe('');
  });

  test('returns empty string for undefined payload', () => {
    expect(sandbox.describeActionPlain(undefined)).toBe('');
  });

  test('click action with targetText', () => {
    expect(sandbox.describeActionPlain({ type: 'click', targetText: 'Submit button' }))
      .toBe('Clicking "Submit button"');
  });

  test('click action without targetText uses description', () => {
    expect(sandbox.describeActionPlain({ type: 'click', description: 'the button' }))
      .toBe('Clicking the button');
  });

  test('click action truncates long targetText', () => {
    const long = 'A'.repeat(60);
    const result = sandbox.describeActionPlain({ type: 'click', targetText: long });
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(80);
  });

  test('click_at action with coordinates', () => {
    expect(sandbox.describeActionPlain({ type: 'click_at', x: 100, y: 200 }))
      .toContain('100');
    expect(sandbox.describeActionPlain({ type: 'click_at', x: 100, y: 200 }))
      .toContain('200');
  });

  test('type action with text', () => {
    expect(sandbox.describeActionPlain({ type: 'type', text: 'hello' }))
      .toBe('Typing "hello"');
  });

  test('type action with sensitive flag', () => {
    expect(sandbox.describeActionPlain({ type: 'type', text: 'password123', sensitive: true }))
      .toBe('Typing "[sensitive — blocked]"');
  });

  test('type action truncates long text', () => {
    const long = 'A'.repeat(80);
    const result = sandbox.describeActionPlain({ type: 'type', text: long });
    expect(result).toContain('…');
  });

  test('navigate action with url', () => {
    expect(sandbox.describeActionPlain({ type: 'navigate', url: 'https://example.com' }))
      .toBe('Navigating to https://example.com');
  });

  test('scroll action down', () => {
    expect(sandbox.describeActionPlain({ type: 'scroll', amount: 300 }))
      .toBe('Scrolling down');
  });

  test('scroll action up', () => {
    expect(sandbox.describeActionPlain({ type: 'scroll', amount: -200 }))
      .toBe('Scrolling up');
  });

  test('select action', () => {
    expect(sandbox.describeActionPlain({ type: 'select', value: 'option1', targetText: 'Dropdown' }))
      .toBe('Selecting "option1" in "Dropdown"');
  });

  test('check action checked', () => {
    expect(sandbox.describeActionPlain({ type: 'check', checked: true, targetText: 'Checkbox' }))
      .toBe('Checking "Checkbox"');
  });

  test('check action unchecked', () => {
    expect(sandbox.describeActionPlain({ type: 'check', checked: false, targetText: 'Box' }))
      .toBe('Unchecking "Box"');
  });

  test('hover action', () => {
    expect(sandbox.describeActionPlain({ type: 'hover', targetText: 'Menu item' }))
      .toBe('Hovering over "Menu item"');
  });

  test('press_key action', () => {
    expect(sandbox.describeActionPlain({ type: 'press_key', key: 'Enter' }))
      .toBe('Pressing Enter');
  });

  test('execute_js action', () => {
    expect(sandbox.describeActionPlain({ type: 'execute_js', key: 'result' }))
      .toBe('Running JavaScript → memory["result"]');
  });

  test('extract action', () => {
    expect(sandbox.describeActionPlain({ type: 'extract', attribute: 'href', description: 'link' }))
      .toBe('Extracting href from link');
  });

  test('extract_list action with fields', () => {
    expect(sandbox.describeActionPlain({ type: 'extract_list', fields: { name: 1, email: 1 } }))
      .toBe('Extracting list of items (name, email)');
  });

  test('read_page action', () => {
    expect(sandbox.describeActionPlain({ type: 'read_page' }))
      .toBe('Reading page content');
  });

  test('wait_for_text action', () => {
    expect(sandbox.describeActionPlain({ type: 'wait_for_text', text: 'Loading complete' }))
      .toBe('Waiting for text "Loading complete"');
  });

  test('wait_for_element action', () => {
    expect(sandbox.describeActionPlain({ type: 'wait_for_element', selector: '.result' }))
      .toBe('Waiting for element .result');
  });

  test('wait_for_navigation action', () => {
    expect(sandbox.describeActionPlain({ type: 'wait_for_navigation' }))
      .toBe('Waiting for navigation');
  });

  test('open_tab action with label', () => {
    expect(sandbox.describeActionPlain({ type: 'open_tab', label: 'New Tab' }))
      .toBe('Opening new tab "New Tab"');
  });

  test('switch_tab action', () => {
    expect(sandbox.describeActionPlain({ type: 'switch_tab', label: 'Tab 2' }))
      .toBe('Switching to tab Tab 2');
  });

  test('close_tab action', () => {
    expect(sandbox.describeActionPlain({ type: 'close_tab', label: 'Tab 1' }))
      .toBe('Closing tab Tab 1');
  });

  test('finish action', () => {
    expect(sandbox.describeActionPlain({ type: 'finish' }))
      .toBe('Finishing task');
  });

  test('note action', () => {
    expect(sandbox.describeActionPlain({ type: 'note' }))
      .toBe('Recording note');
  });

  test('dismiss_overlay action', () => {
    expect(sandbox.describeActionPlain({ type: 'dismiss_overlay' }))
      .toBe('Dismissing overlay');
  });

  test('default fallback with description', () => {
    expect(sandbox.describeActionPlain({ type: 'custom_action', description: 'do something' }))
      .toBe('custom_action: do something');
  });

  test('default fallback without description', () => {
    expect(sandbox.describeActionPlain({ type: 'custom_action' }))
      .toBe('custom_action');
  });
});

describe('chat.js — renderTenantChip', () => {
  let sandbox;
  let chipEl;

  beforeEach(() => {
    sandbox = createSandbox();
    chipEl = makeElement('div');
    chipEl.id = 'tenantChip';
    const origGetById = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => {
      if (id === 'tenantChip') return chipEl;
      return origGetById.call(sandbox.document, id);
    };
    loadModule(sandbox);
  });

  test('hides chip when tenant is null', () => {
    sandbox.renderTenantChip(null, '');
    expect(chipEl.style.display).toBe('none');
  });

  test('hides chip when tenant has no valid fields', () => {
    sandbox.renderTenantChip({}, '');
    expect(chipEl.style.display).toBe('none');
  });

  test('shows chip with onmicrosoft field', () => {
    sandbox.renderTenantChip({ onmicrosoft: 'contoso.onmicrosoft.com' }, '');
    expect(chipEl.textContent).toBe('contoso.onmicrosoft.com');
    expect(chipEl.style.display).toBe('inline-flex');
  });

  test('shows chip with chipText field (highest priority)', () => {
    sandbox.renderTenantChip({ chipText: 'Contoso', onmicrosoft: 'contoso.onmicrosoft.com', tid: 'abc123' }, '');
    expect(chipEl.textContent).toBe('Contoso');
  });

  test('shows chip with truncated tid', () => {
    sandbox.renderTenantChip({ tid: '12345678-90ab-cdef' }, '');
    expect(chipEl.textContent).toContain('tid:');
    expect(chipEl.textContent).toContain('…');
  });

  test('match adds match class when expected matches', () => {
    sandbox.renderTenantChip({ onmicrosoft: 'contoso.onmicrosoft.com' }, 'contoso');
    expect(chipEl.classList.contains('match')).toBe(true);
    expect(chipEl.classList.contains('mismatch')).toBe(false);
  });

  test('mismatch adds mismatch class when expected does not match', () => {
    sandbox.renderTenantChip({ onmicrosoft: 'fabrikam.onmicrosoft.com' }, 'contoso');
    expect(chipEl.classList.contains('mismatch')).toBe(true);
    expect(chipEl.classList.contains('match')).toBe(false);
  });

  test('no match classes when expected is empty', () => {
    sandbox.renderTenantChip({ onmicrosoft: 'contoso.onmicrosoft.com' }, '');
    expect(chipEl.classList.contains('match')).toBe(false);
    expect(chipEl.classList.contains('mismatch')).toBe(false);
  });
});

describe('chat.js — updateActiveTabPage', () => {
  let sandbox;
  let hostEl, titleEl, favEl, stripEl;

  beforeEach(() => {
    sandbox = createSandbox();
    hostEl = makeElement('span');
    titleEl = makeElement('span');
    favEl = makeElement('img');
    stripEl = makeElement('div');
    stripEl.style.display = 'none';
    const origGetById = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => {
      if (id === 'ats-host') return hostEl;
      if (id === 'ats-title') return titleEl;
      if (id === 'ats-favicon') return favEl;
      if (id === 'active-tab-strip') return stripEl;
      return origGetById.call(sandbox.document, id);
    };
    loadModule(sandbox);
  });

  test('sets hostname and shows strip', () => {
    sandbox.updateActiveTabPage('https://example.com/page', 'Example Page');
    // URL constructor is mocked, falls back to raw url string
    expect(hostEl.textContent).toBe('https://example.com/page');
    expect(titleEl.textContent).toBe('Example Page');
    expect(stripEl.style.display).toBe('flex');
  });

  test('handles malformed URL gracefully', () => {
    sandbox.updateActiveTabPage('not-a-url', '');
    expect(hostEl.textContent).toBe('not-a-url');
  });

  test('does nothing when url is empty', () => {
    sandbox.updateActiveTabPage('', 'Title');
    expect(stripEl.style.display).toBe('none');
  });

  test('does nothing when url is null', () => {
    sandbox.updateActiveTabPage(null, 'Title');
    expect(stripEl.style.display).toBe('none');
  });

  test('sets favicon src to Google service', () => {
    sandbox.updateActiveTabPage('https://portal.contoso.com/admin', 'Admin');
    expect(favEl.src).toContain('google.com/s2/favicons');
    expect(favEl.src).toContain('portal.contoso.com');
  });
});

describe('chat.js — updateActiveTabStep', () => {
  let sandbox;
  let stepEl;

  beforeEach(() => {
    sandbox = createSandbox();
    stepEl = makeElement('span');
    const origGetById = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => {
      if (id === 'ats-step') return stepEl;
      return origGetById.call(sandbox.document, id);
    };
    loadModule(sandbox);
  });

  test('shows step number with total', () => {
    sandbox.updateActiveTabStep(3, 10);
    expect(stepEl.textContent).toBe('STEP 3/10');
  });

  test('shows step number without total', () => {
    sandbox.updateActiveTabStep(5);
    expect(stepEl.textContent).toBe('STEP 5');
  });

  test('shows empty when step is 0 and no total', () => {
    sandbox.updateActiveTabStep(0);
    expect(stepEl.textContent).toBe('');
  });

  test('shows empty when step is null', () => {
    sandbox.updateActiveTabStep(null);
    expect(stepEl.textContent).toBe('');
  });
});

describe('chat.js — updateActiveTabAction', () => {
  let sandbox;
  let actionEl;

  beforeEach(() => {
    sandbox = createSandbox();
    actionEl = makeElement('span');
    const origGetById = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => {
      if (id === 'ats-action') return actionEl;
      return origGetById.call(sandbox.document, id);
    };
    loadModule(sandbox);
  });

  test('sets click action text and class', () => {
    sandbox.updateActiveTabAction({ type: 'click', targetText: 'Submit' });
    expect(actionEl.textContent).toContain('Submit');
    expect(actionEl.classList.contains('is-clicking')).toBe(true);
  });

  test('sets type action text and class', () => {
    sandbox.updateActiveTabAction({ type: 'type', text: 'hello' });
    expect(actionEl.textContent).toContain('hello');
    expect(actionEl.classList.contains('is-typing')).toBe(true);
  });

  test('clears click/type classes for other actions', () => {
    actionEl.classList.add('is-clicking', 'is-typing');
    sandbox.updateActiveTabAction({ type: 'navigate', url: 'https://example.com' });
    expect(actionEl.classList.contains('is-clicking')).toBe(false);
    expect(actionEl.classList.contains('is-typing')).toBe(false);
  });

  test('handles null payload', () => {
    sandbox.updateActiveTabAction(null);
    expect(actionEl.textContent).toBe('');
  });

  test('handles undefined payload', () => {
    sandbox.updateActiveTabAction(undefined);
    expect(actionEl.textContent).toBe('');
  });
});

// ── Pure utility functions ──────────────────────────────────────────────────

describe('chat.js — friendlyError', () => {
  let sandbox;
  beforeAll(() => { sandbox = createSandbox(); loadModule(sandbox); });

  test('returns generic fallback for null', () => {
    expect(sandbox.friendlyError(null)).toBe('Something went wrong. Try again or check Settings.');
  });

  test('returns generic fallback for non-string', () => {
    expect(sandbox.friendlyError(42)).toBe('Something went wrong. Try again or check Settings.');
  });

  test('detects api_key in message', () => {
    expect(sandbox.friendlyError('Invalid api_key provided')).toContain('API key issue');
  });

  test('detects 401 in message', () => {
    expect(sandbox.friendlyError('Request failed with status 401')).toContain('API key issue');
  });

  test('detects forbidden/403', () => {
    expect(sandbox.friendlyError('403 forbidden')).toContain('Access denied');
  });

  test('detects network error', () => {
    expect(sandbox.friendlyError('Failed to fetch from endpoint')).toContain('Network error');
  });

  test('detects timeout', () => {
    expect(sandbox.friendlyError('Request timed out after 30s')).toContain('timed out');
  });

  test('detects 429 rate limit', () => {
    expect(sandbox.friendlyError('429 Too Many Requests')).toContain('Rate limited');
  });

  test('detects 502 bad gateway', () => {
    expect(sandbox.friendlyError('502 Bad Gateway')).toContain('502');
  });

  test('detects 503 service unavailable', () => {
    expect(sandbox.friendlyError('503 Service Unavailable')).toContain('503');
  });

  test('detects vision 400 rejection', () => {
    expect(sandbox.friendlyError('400 vision model rejected')).toContain('Vision');
  });

  test('detects context_length_exceeded', () => {
    expect(sandbox.friendlyError('context_length_exceeded')).toContain('too large');
  });

  test('detects max_tokens error', () => {
    expect(sandbox.friendlyError('max_tokens limit reached')).toContain('too large');
  });

  test('detects disconnected port', () => {
    expect(sandbox.friendlyError('disconnected port error')).toContain('connection lost');
  });

  test('truncates long unknown errors at 200 chars', () => {
    const long = 'x'.repeat(250);
    const result = sandbox.friendlyError(long);
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(250);
  });

  test('returns short unknown error as-is', () => {
    const msg = 'Some other error';
    expect(sandbox.friendlyError(msg)).toBe(msg);
  });
});

describe('chat.js — _dedupHistory', () => {
  let sandbox;
  beforeAll(() => { sandbox = createSandbox(); loadModule(sandbox); });

  test('returns non-array input as-is', () => {
    expect(sandbox._dedupHistory(null)).toBeNull();
    expect(sandbox._dedupHistory(undefined)).toBeUndefined();
  });

  test('returns empty array as-is', () => {
    expect(sandbox._dedupHistory([])).toEqual([]);
  });

  test('returns single-element array unchanged', () => {
    const h = [{ role: 'user', text: 'hello' }];
    expect(sandbox._dedupHistory(h)).toEqual(h);
  });

  test('removes consecutive duplicate entries', () => {
    const h = [
      { role: 'user', text: 'hello' },
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi' },
    ];
    const result = sandbox._dedupHistory(h);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('hello');
    expect(result[1].text).toBe('hi');
  });

  test('keeps non-consecutive identical entries', () => {
    const h = [
      { role: 'user', text: 'ping' },
      { role: 'assistant', text: 'pong' },
      { role: 'user', text: 'ping' },
    ];
    expect(sandbox._dedupHistory(h)).toHaveLength(3);
  });

  test('keeps entries with same text but different roles', () => {
    const h = [
      { role: 'user', text: 'same' },
      { role: 'assistant', text: 'same' },
    ];
    expect(sandbox._dedupHistory(h)).toHaveLength(2);
  });
});

describe('chat.js — _activityIcon', () => {
  let sandbox;
  beforeAll(() => { sandbox = createSandbox(); loadModule(sandbox); });

  test('returns check SVG for done', () => {
    const icon = sandbox._activityIcon('done');
    expect(icon).toContain('polyline');
    expect(icon).toContain('svg');
  });

  test('returns X SVG for failed', () => {
    const icon = sandbox._activityIcon('failed');
    expect(icon).toContain('line x1');
    expect(icon).toContain('svg');
  });

  test('returns spinner SVG for in_progress', () => {
    const icon = sandbox._activityIcon('in_progress');
    expect(icon).toContain('activity-spinner');
  });

  test('returns pending SVG for any other status', () => {
    const icon = sandbox._activityIcon('pending');
    expect(icon).toContain('circle');
    expect(icon).toContain('opacity:0.4');
  });

  test('returns pending SVG for unknown status', () => {
    const icon = sandbox._activityIcon('unknown-status');
    expect(icon).toContain('opacity:0.4');
  });
});

describe('chat.js — _formatDuration', () => {
  let sandbox;
  beforeAll(() => { sandbox = createSandbox(); loadModule(sandbox); });

  test('returns empty string for null', () => {
    expect(sandbox._formatDuration(null)).toBe('');
  });

  test('returns empty string for 0', () => {
    expect(sandbox._formatDuration(0)).toBe('');
  });

  test('returns empty string for negative', () => {
    expect(sandbox._formatDuration(-100)).toBe('');
  });

  test('returns ms format for sub-second duration', () => {
    expect(sandbox._formatDuration(500)).toBe('500ms');
  });

  test('returns seconds format for 1-60 seconds', () => {
    expect(sandbox._formatDuration(2500)).toBe('2.5s');
  });

  test('returns minutes format for durations over 60 seconds', () => {
    const result = sandbox._formatDuration(90000); // 1m 30s
    expect(result).toBe('1m 30s');
  });

  test('returns 0m 0s for exactly 60000ms', () => {
    const result = sandbox._formatDuration(60000);
    expect(result).toBe('1m 0s');
  });
});
