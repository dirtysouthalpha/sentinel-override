// tests/popup-settings.test.js
// Unit tests for popup-modules/settings.js — applyThemePreset, _renderSkillStatsModal,
// _renderLearnedPatterns, switchProviderCard, loadThemePreference.

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
    get placeholder() { return this._attrs.placeholder || ''; },
    set placeholder(v) { this._attrs.placeholder = v; },
    get checked() { return this._attrs.checked || false; },
    set checked(v) { this._attrs.checked = v; },
    setAttribute(n, v) { this._attrs[n] = v; },
    getAttribute(n) { return this._attrs[n]; },
    removeAttribute(n) { delete this._attrs[n]; },
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { this._children.push(c); c._parent = this; return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); },
    remove() { if (this._parent) this._parent.removeChild(this); },
    querySelector() { return null; },
    querySelectorAll(sel) { return []; },
    click() {},
    dispatchEvent() { return true; },
    insertBefore(newNode, refNode) {
      const idx = refNode ? this._children.indexOf(refNode) : -1;
      if (idx >= 0) this._children.splice(idx, 0, newNode);
      else this._children.push(newNode);
      newNode._parent = this;
    }
  };
  return el;
}

function createSandbox() {
  const elCache = {};
  const setProps = {};
  const localStorageData = {};

  function getOrCreate(id) {
    if (!elCache[id]) elCache[id] = makeElement('div');
    return elCache[id];
  }

  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    Object,
    Array,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Promise: { resolve: () => ({ then: (fn) => fn && fn(), catch: () => {} }) },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    URL: { prototype: {} },
    navigator: {},
    Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    fetch: () => Promise.resolve({ ok: true }),
    AbortController: class { abort() {} },
    confirm: () => true,
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
      },
    },
    document: {
      createElement(tag) { return makeElement(tag); },
      body: Object.assign(makeElement('body'), { className: '' }),
      head: makeElement('head'),
      documentElement: {
        style: {
          setProperty(prop, val) { setProps[prop] = val; }
        }
      },
      getElementById(id) { return getOrCreate(id); },
      querySelector(sel) { return null; },
      querySelectorAll(sel) { return []; },
      addEventListener() {},
      removeEventListener() {},
      readyState: 'complete',
    },
    localStorage: {
      getItem(key) { return localStorageData[key] || null; },
      setItem(key, val) { localStorageData[key] = val; },
      removeItem(key) { delete localStorageData[key]; },
    },
    sanitizeHtml: (s) => s,
    escapeHtml: (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    isValidUrl: () => true,
    showToast: () => {},
    getState: () => ({
      providerConfigs: { openai: {}, anthropic: {} },
      activeProviderId: 'openai',
    }),
    _setProps: setProps,
    _elCache: elCache,
    _localStorageData: localStorageData,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/settings.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'settings.js' });
  script.runInContext(sandbox);
  return sandbox;
}

describe('settings.js — applyThemePreset', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
    loadModule(sandbox);
  });

  test('applies light theme properties', () => {
    sandbox.applyThemePreset('light');
    expect(sandbox._setProps['--bg-primary']).toBe('#ffffff');
    expect(sandbox._setProps['--text-primary']).toBe('#0d0d0d');
  });

  test('applies dark theme properties', () => {
    sandbox.applyThemePreset('dark');
    expect(sandbox._setProps['--bg-primary']).toBe('#0d0d0d');
    expect(sandbox._setProps['--text-primary']).toBe('#ffffff');
  });

  test('applies matrix theme with green colors', () => {
    sandbox.applyThemePreset('matrix');
    expect(sandbox._setProps['--bg-primary']).toBe('#0a0a0a');
    expect(sandbox._setProps['--text-primary']).toBe('#00ff41');
    expect(sandbox._setProps['--accent-primary']).toBe('#00ff41');
  });

  test('applies tron theme with cyan colors', () => {
    sandbox.applyThemePreset('tron');
    expect(sandbox._setProps['--bg-primary']).toBe('#000000');
    expect(sandbox._setProps['--text-primary']).toBe('#00d4ff');
    expect(sandbox._setProps['--accent-primary']).toBe('#00d4ff');
  });

  test('applies cyberpunk theme with pink colors', () => {
    sandbox.applyThemePreset('cyberpunk');
    expect(sandbox._setProps['--bg-primary']).toBe('#0d0221');
    expect(sandbox._setProps['--text-primary']).toBe('#ff2a6d');
  });

  test('applies neon theme with purple colors', () => {
    sandbox.applyThemePreset('neon');
    expect(sandbox._setProps['--bg-primary']).toBe('#0a0014');
    expect(sandbox._setProps['--text-primary']).toBe('#e040fb');
  });

  test('applies terminal theme', () => {
    sandbox.applyThemePreset('terminal');
    expect(sandbox._setProps['--bg-primary']).toBe('#1a1a1a');
    expect(sandbox._setProps['--text-primary']).toBe('#33ff33');
  });

  test('applies blood theme', () => {
    sandbox.applyThemePreset('blood');
    expect(sandbox._setProps['--bg-primary']).toBe('#0a0000');
    expect(sandbox._setProps['--text-primary']).toBe('#ff1a1a');
  });

  test('saves theme name to localStorage', () => {
    sandbox.applyThemePreset('matrix');
    expect(sandbox._localStorageData['theme-named']).toBe('matrix');
  });

  test('adds dark-mode class for dark themes', () => {
    sandbox.applyThemePreset('matrix');
    expect(sandbox.document.body.classList.contains('dark-mode')).toBe(true);
  });

  test('removes dark-mode class for light theme', () => {
    sandbox.document.body.classList.add('dark-mode');
    sandbox.applyThemePreset('light');
    expect(sandbox.document.body.classList.contains('dark-mode')).toBe(false);
  });

  test('adds theme-{name} class for non-standard themes', () => {
    sandbox.applyThemePreset('tron');
    expect(sandbox.document.body.classList.contains('theme-tron')).toBe(true);
  });

  test('does not add theme class for light/dark', () => {
    sandbox.applyThemePreset('light');
    expect(sandbox.document.body.classList.contains('theme-light')).toBe(false);
  });

  test('does nothing for unknown theme', () => {
    sandbox.applyThemePreset('nonexistent');
    expect(sandbox._setProps['--bg-primary']).toBeUndefined();
  });
});

describe('settings.js — _renderSkillStatsModal', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
    loadModule(sandbox);
  });

  test('creates modal element with no skills', () => {
    sandbox._renderSkillStatsModal([]);
    const modal = sandbox.document.getElementById('skillStatsModal');
    // Modal should have been appended to body
    expect(sandbox.document.body._children.length).toBeGreaterThan(0);
  });

  test('handles second call without crashing (strip-and-recreate)', () => {
    sandbox._renderSkillStatsModal([]);
    // Second call should not throw — the code strips existing modal then re-creates
    expect(() => {
      sandbox._renderSkillStatsModal([{ id: 'test', description: 'desc', priority: 5, effectivePriority: 7, stats: { fires: 10, successes: 8, failures: 2 } }]);
    }).not.toThrow();
  });

  test('renders skill with correct data', () => {
    const skills = [{
      id: 'test-skill',
      description: 'A test skill',
      priority: 5,
      effectivePriority: 7,
      stats: { fires: 10, successes: 8, failures: 2 }
    }];
    sandbox._renderSkillStatsModal(skills);
    const modal = sandbox.document.body._children.find(c => c.id === 'skillStatsModal');
    expect(modal).toBeDefined();
    // Should contain table with skill data
    const body = modal._children.find(c => c.tagName === 'DIV');
    expect(body).toBeDefined();
  });
});

describe('settings.js — _renderLearnedPatterns', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
    loadModule(sandbox);
  });

  test('handles null patterns gracefully', () => {
    const list = sandbox._elCache['learnedPatternsList'];
    sandbox._renderLearnedPatterns(null);
    // Should not throw
  });

  test('handles empty patterns array', () => {
    sandbox._renderLearnedPatterns([]);
  });

  test('renders patterns with goals', () => {
    const patterns = [
      { goal: 'Login to portal', steps: ['step1', 'step2'], timestamp: Date.now() },
      { goal: 'Check firewall', steps: ['step1'], timestamp: Date.now() }
    ];
    sandbox._renderLearnedPatterns(patterns);
    const list = sandbox._elCache['learnedPatternsList'];
    expect(list._innerHTML).toContain('Login to portal');
    expect(list._innerHTML).toContain('Check firewall');
  });
});

describe('settings.js — switchProviderCard', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
    loadModule(sandbox);
  });

  test('populates fields from saved anthropic config', () => {
    // Override getState to return config with saved values
    const origGetState = sandbox.getState;
    sandbox.getState = () => ({
      providerConfigs: {
        anthropic: { api_key: 'sk-test', model: 'claude-sonnet-4-6', endpoint: 'https://api.anthropic.com/v1/messages' },
        openai: {}
      },
      activeProviderId: 'anthropic',
    });
    sandbox.switchProviderCard('anthropic');
    sandbox.getState = origGetState;
    const ep = sandbox._elCache['set-provider-endpoint'];
    const model = sandbox._elCache['set-provider-model'];
    expect(ep._attrs.value).toContain('anthropic.com');
    expect(model._attrs.value).toContain('claude');
  });

  test('populates fields from saved openai config', () => {
    const origGetState = sandbox.getState;
    sandbox.getState = () => ({
      providerConfigs: {
        openai: { api_key: 'sk-test', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1/chat/completions' },
        anthropic: {}
      },
      activeProviderId: 'openai',
    });
    sandbox.switchProviderCard('openai');
    sandbox.getState = origGetState;
    const ep = sandbox._elCache['set-provider-endpoint'];
    const model = sandbox._elCache['set-provider-model'];
    expect(ep._attrs.value).toContain('openai.com');
    expect(model._attrs.value).toContain('gpt-4o');
  });
});

describe('settings.js — settingsModal null guard', () => {
  test('settingsBtn click handler does not throw when settings-modal element is absent', async () => {
    const sb = createSandbox();
    sb.Promise = Promise; // real Promise so await works in the async handler

    // Capture the click handler registered on settingsBtn
    let clickHandler = null;
    const fakeBtnEl = makeElement('button');
    fakeBtnEl.addEventListener = (event, handler) => {
      if (event === 'click') clickHandler = handler;
    };

    // Return null for settings-modal to exercise the null guard
    sb.document.getElementById = (id) => {
      if (id === 'settingsBtn') return fakeBtnEl;
      if (id === 'settings-modal') return null;
      return makeElement('div');
    };

    // Mock storage.get to return a real Promise (handler uses await)
    sb.chrome.storage.local.get = (keys, cb) => {
      const result = {};
      if (cb) cb(result);
      return Promise.resolve(result);
    };

    loadModule(sb);
    expect(clickHandler).not.toBeNull();
    // Must not throw TypeError from settingsModal.classList.add
    await expect(clickHandler()).resolves.toBeUndefined();
  });
});
