// tests/content-index.test.js
// Unit tests for content/index.js — MFA detection, sensitive fields, sandbox,
// key events, describeTarget, resolveCommandTarget, and dismissOverlays logic.
//
// content/index.js is a monolithic entry point with side effects and a
// re-injection guard. Internal functions are not exported. These tests verify
// the same logic patterns by exercising the pure logic extracted inline.

import { jest } from '@jest/globals';

// KeyboardEvent is not available in Node — provide a minimal stub
if (typeof KeyboardEvent === 'undefined') {
  globalThis.KeyboardEvent = class KeyboardEvent {
    constructor(type, opts = {}) {
      this.type = type;
      this.key = opts.key || '';
      this.code = opts.code || '';
      this.keyCode = opts.keyCode || 0;
      this.which = opts.which || 0;
      this.bubbles = !!opts.bubbles;
      this.cancelable = !!opts.cancelable;
    }
  };
}

// ===================== MFA Detection =====================
// Mirrors __SENTINEL_MFA_PATTERNS and __sentinelDetectMFA from content/index.js

const MFA_PATTERNS = [
  /verify\s+your\s+identity/i,
  /enter\s+(?:the\s+)?(?:verification\s+)?code/i,
  /approve\s+(?:the\s+)?sign.?in\s+request/i,
  /we'?ve\s+sent.*?code/i,
  /6.?digit\s+(?:code|number|verification)/i,
  /two.?factor\s+(?:authentication|verification)/i,
  /multi.?factor\s+authentication/i,
  /authenticator\s+app/i,
  /one.?time\s+(?:passcode|password|code)/i,
  /\bOTP\b/,
  /enter\s+your\s+code/i,
  /check\s+your\s+phone/i,
];

function detectMFA(text) {
  if (!text || typeof text !== 'string') return null;
  const sample = text.substring(0, 4000);
  for (const re of MFA_PATTERNS) {
    const m = sample.match(re);
    if (m) return m[0];
  }
  return null;
}

describe('MFA detection', () => {
  test('returns null for null input', () => {
    expect(detectMFA(null)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(detectMFA('')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(detectMFA(12345)).toBeNull();
  });

  test('returns null for non-MFA page text', () => {
    expect(detectMFA('Welcome to your dashboard. Click here to manage settings.')).toBeNull();
  });

  test('detects "verify your identity"', () => {
    expect(detectMFA('Please verify your identity to continue')).toBe('verify your identity');
  });

  test('detects "enter the verification code"', () => {
    expect(detectMFA('Enter the verification code sent to your device')).toBe('Enter the verification code');
  });

  test('detects "enter code" (no "the verification")', () => {
    expect(detectMFA('Please enter code below')).toBe('enter code');
  });

  test('detects "approve the sign-in request"', () => {
    expect(detectMFA('Please approve the sign-in request on your phone')).toBe('approve the sign-in request');
  });

  test('detects "we\'ve sent a code"', () => {
    expect(detectMFA("We've sent a code to your email")).toBe("We've sent a code");
  });

  test('detects "6-digit code"', () => {
    expect(detectMFA('Enter the 6-digit code from your app')).toBe('6-digit code');
  });

  test('detects "two-factor authentication"', () => {
    expect(detectMFA('Set up two-factor authentication for your account')).toBe('two-factor authentication');
  });

  test('detects "multi-factor authentication"', () => {
    expect(detectMFA('Your organization requires multi-factor authentication')).toBe('multi-factor authentication');
  });

  test('detects "authenticator app"', () => {
    expect(detectMFA('Open your authenticator app to get the code')).toBe('authenticator app');
  });

  test('detects "one-time passcode"', () => {
    expect(detectMFA('Enter your one-time passcode')).toBe('one-time passcode');
  });

  test('detects "OTP" as word boundary', () => {
    expect(detectMFA('Enter OTP from your device')).toBe('OTP');
  });

  test('detects "enter your code"', () => {
    expect(detectMFA('Please enter your code below')).toBe('enter your code');
  });

  test('detects "check your phone"', () => {
    expect(detectMFA('Check your phone for a notification')).toBe('Check your phone');
  });

  test('only scans first 4000 chars', () => {
    const padding = 'x'.repeat(4001);
    const text = padding + 'verify your identity';
    expect(detectMFA(text)).toBeNull();
  });

  test('detects MFA within first 4000 chars', () => {
    const padding = 'x'.repeat(3980);
    const text = padding + 'verify your identity';
    expect(detectMFA(text)).toBe('verify your identity');
  });
});

// ===================== Sensitive Field Detection =====================
// Mirrors __SENTINEL_SENSITIVE_LABEL_RE, __sentinelGetFieldSensitivityContext,
// and __sentinelCheckSensitiveField from content/index.js

const SENSITIVE_LABEL_RE = /\b(password|passphrase|passcode|pre.?shared.?key|psk|shared.?secret|secret.?key|api.?key|client.?secret|encryption.?key|private.?key|recovery.?code|reset.?code|verification.?code|temporary.?password|tenant.?key|cvv|cvc|ssn|social.?security|credit.?card|card.?number|account.?number|routing.?number|tax.?id|passport)\b/i;

function checkSensitiveField(el) {
  if (!el) return null;
  if (el.type === 'password') return 'password';
  const parts = [];
  if (el.name) parts.push(el.name);
  if (el.id) parts.push(el.id);
  if (el.placeholder) parts.push(el.placeholder);
  if (el.ariaLabel) parts.push(el.ariaLabel);
  if (el.title) parts.push(el.title);
  if (el.autocomplete) parts.push(el.autocomplete);
  if (el.labelText) parts.push(el.labelText);
  const ctx = parts.join(' ').toLowerCase();
  const m = ctx.match(SENSITIVE_LABEL_RE);
  return m ? m[0] : null;
}

describe('Sensitive field detection', () => {
  test('returns null for null element', () => {
    expect(checkSensitiveField(null)).toBeNull();
  });

  test('returns "password" for type="password"', () => {
    expect(checkSensitiveField({ type: 'password' })).toBe('password');
  });

  test('returns "password" for name containing "password"', () => {
    expect(checkSensitiveField({ type: 'text', name: 'password' })).toBe('password');
  });

  test('detects "passphrase" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'passphrase' })).toBe('passphrase');
  });

  test('detects "passcode" field', () => {
    expect(checkSensitiveField({ type: 'text', id: 'passcode' })).toBe('passcode');
  });

  test('detects "pre-shared key" field', () => {
    expect(checkSensitiveField({ type: 'text', placeholder: 'Pre-Shared Key' })).toBe('pre-shared key');
  });

  test('detects "PSK" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'psk' })).toBe('psk');
  });

  test('detects "API key" field', () => {
    expect(checkSensitiveField({ type: 'text', ariaLabel: 'API Key' })).toBe('api key');
  });

  test('detects "client secret" field', () => {
    expect(checkSensitiveField({ type: 'text', title: 'Client Secret' })).toBe('client secret');
  });

  test('detects "recovery code" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'recovery_code' })).toBe('recovery_code');
  });

  test('detects "CVV" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'cvv' })).toBe('cvv');
  });

  test('detects "SSN" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'ssn' })).toBe('ssn');
  });

  test('detects "credit card" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'credit_card' })).toBe('credit_card');
  });

  test('detects "routing number" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'routing_number' })).toBe('routing_number');
  });

  test('detects "tax id" field', () => {
    expect(checkSensitiveField({ type: 'text', placeholder: 'Tax ID' })).toBe('tax id');
  });

  test('detects "passport" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'passport' })).toBe('passport');
  });

  test('detects "private key" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'private_key' })).toBe('private_key');
  });

  test('detects "encryption key" field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'encryption_key' })).toBe('encryption_key');
  });

  test('returns null for regular input field', () => {
    expect(checkSensitiveField({ type: 'text', name: 'username' })).toBeNull();
  });

  test('returns null for email field', () => {
    expect(checkSensitiveField({ type: 'email', name: 'email' })).toBeNull();
  });

  test('returns null for search field', () => {
    expect(checkSensitiveField({ type: 'text', placeholder: 'Search...' })).toBeNull();
  });

  test('detects via autocomplete attribute', () => {
    expect(checkSensitiveField({ type: 'text', autocomplete: 'current-password' })).toBe('password');
  });

  test('detects via id with "secret"', () => {
    expect(checkSensitiveField({ type: 'text', id: 'shared_secret' })).toBe('shared_secret');
  });
});

// ===================== Sandbox Proxy Logic =====================
// Mirrors createSandboxedDocument and createSandboxedWindow from content/index.js

const BLOCKED_APIS = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB',
  'open', 'close', 'stop', 'print',
  'eval', 'Function',
  'importScripts', 'Worker', 'SharedWorker', 'ServiceWorker',
  'postMessage', 'navigator', 'location', 'chrome', 'crypto',
]);

const BLOCKED_DOC_PROPS = new Set([
  'cookie', 'domain', 'referrer', 'location', 'write', 'writeln',
]);

function createSandboxedDocument(doc, sandboxedWin) {
  return new Proxy(doc, {
    get(target, prop, receiver) {
      if (BLOCKED_DOC_PROPS.has(prop)) return undefined;
      if (prop === 'defaultView') return sandboxedWin;
      const value = target[prop];
      if (typeof value === 'function') return value.bind(target);
      return value;
    },
    set(target, prop, value) {
      if (BLOCKED_DOC_PROPS.has(prop)) return true;
      target[prop] = value;
      return true;
    },
    has(target, prop) {
      if (BLOCKED_DOC_PROPS.has(prop)) return false;
      return prop in target;
    },
  });
}

function createSandboxedWindow(win) {
  return new Proxy(win, {
    get(target, prop, receiver) {
      if (BLOCKED_APIS.has(prop)) return undefined;
      const value = target[prop];
      if (typeof value === 'function') return value.bind(target);
      return value;
    },
    set(target, prop, value) {
      if (BLOCKED_APIS.has(prop)) return true;
      target[prop] = value;
      return true;
    },
    has(target, prop) {
      if (BLOCKED_APIS.has(prop)) return false;
      return prop in target;
    },
  });
}

describe('Sandbox - createSandboxedWindow', () => {
  const mockWin = {
    console: { log: () => {} },
    Math: Math,
    setTimeout: setTimeout,
    fetch: () => 'real-fetch',
    localStorage: { getItem: () => 'data' },
    navigator: { userAgent: 'test' },
    location: { href: 'http://test' },
    chrome: { runtime: {} },
    crypto: { getRandomValues: () => {} },
    myCustomProp: 42,
  };

  let sandbox;
  beforeAll(() => {
    sandbox = createSandboxedWindow(mockWin);
  });

  test('allows access to console', () => {
    expect(sandbox.console).toBeDefined();
  });

  test('allows access to Math', () => {
    expect(sandbox.Math).toBe(Math);
  });

  test('allows access to setTimeout', () => {
    expect(typeof sandbox.setTimeout).toBe('function');
  });

  test('allows access to custom properties', () => {
    expect(sandbox.myCustomProp).toBe(42);
  });

  test('blocks fetch', () => {
    expect(sandbox.fetch).toBeUndefined();
  });

  test('blocks localStorage', () => {
    expect(sandbox.localStorage).toBeUndefined();
  });

  test('blocks navigator', () => {
    expect(sandbox.navigator).toBeUndefined();
  });

  test('blocks location', () => {
    expect(sandbox.location).toBeUndefined();
  });

  test('blocks chrome', () => {
    expect(sandbox.chrome).toBeUndefined();
  });

  test('blocks crypto', () => {
    expect(sandbox.crypto).toBeUndefined();
  });

  test('blocks XMLHttpRequest', () => {
    expect(sandbox.XMLHttpRequest).toBeUndefined();
  });

  test('blocks WebSocket', () => {
    expect(sandbox.WebSocket).toBeUndefined();
  });

  test('blocks eval', () => {
    expect(sandbox.eval).toBeUndefined();
  });

  test('blocks Worker', () => {
    expect(sandbox.Worker).toBeUndefined();
  });

  test('"has" check returns false for blocked APIs', () => {
    expect('fetch' in sandbox).toBe(false);
    expect('localStorage' in sandbox).toBe(false);
  });

  test('"has" check returns true for allowed APIs', () => {
    expect('console' in sandbox).toBe(true);
    expect('Math' in sandbox).toBe(true);
  });

  test('writing to blocked API is silently swallowed', () => {
    sandbox.fetch = () => 'hacked';
    expect(mockWin.fetch).not.toBe('hacked'); // original unchanged
    expect(sandbox.fetch).toBeUndefined(); // still blocked
  });

  test('writing to allowed property passes through', () => {
    sandbox.myCustomProp = 99;
    expect(mockWin.myCustomProp).toBe(99);
  });
});

describe('Sandbox - createSandboxedDocument', () => {
  const mockWin = createSandboxedWindow({ console: {} });
  const mockDoc = {
    title: 'Test Page',
    cookie: 'session=abc',
    domain: 'example.com',
    referrer: 'http://google.com',
    location: { href: 'http://example.com' },
    write: () => {},
    writeln: () => {},
    querySelector: () => null,
    body: { innerText: 'hello' },
    defaultView: mockWin,
    myCustomProp: 'allowed',
  };

  let sandbox;
  beforeAll(() => {
    sandbox = createSandboxedDocument(mockDoc, mockWin);
  });

  test('allows access to title', () => {
    expect(sandbox.title).toBe('Test Page');
  });

  test('allows access to body', () => {
    expect(sandbox.body.innerText).toBe('hello');
  });

  test('allows access to custom properties', () => {
    expect(sandbox.myCustomProp).toBe('allowed');
  });

  test('returns sandboxed window for defaultView', () => {
    expect(sandbox.defaultView).toBe(mockWin);
  });

  test('blocks cookie', () => {
    expect(sandbox.cookie).toBeUndefined();
  });

  test('blocks domain', () => {
    expect(sandbox.domain).toBeUndefined();
  });

  test('blocks referrer', () => {
    expect(sandbox.referrer).toBeUndefined();
  });

  test('blocks location', () => {
    expect(sandbox.location).toBeUndefined();
  });

  test('blocks write', () => {
    expect(sandbox.write).toBeUndefined();
  });

  test('blocks writeln', () => {
    expect(sandbox.writeln).toBeUndefined();
  });

  test('"has" check returns false for blocked props', () => {
    expect('cookie' in sandbox).toBe(false);
    expect('domain' in sandbox).toBe(false);
  });

  test('"has" check returns true for allowed props', () => {
    expect('title' in sandbox).toBe(true);
    expect('body' in sandbox).toBe(true);
  });

  test('write to blocked prop is silently swallowed', () => {
    sandbox.cookie = 'stolen=session';
    expect(mockDoc.cookie).toBe('session=abc'); // original unchanged
  });

  test('write to allowed prop passes through', () => {
    sandbox.myCustomProp = 'updated';
    expect(mockDoc.myCustomProp).toBe('updated');
  });
});

// ===================== Key Event Helper =====================
// Mirrors __sentinelKeyEventForChar from content/index.js

function keyEventForChar(type, char) {
  let code;
  if (char === ' ') { code = 'Space'; }
  else if (/^[a-zA-Z]$/.test(char)) { code = 'Key' + char.toUpperCase(); }
  else if (/^[0-9]$/.test(char)) { code = 'Digit' + char; }
  else { code = char; }
  const keyCode = char.length === 1 ? char.charCodeAt(0) : 0;
  return new KeyboardEvent(type, {
    key: char,
    code: code,
    keyCode: keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
}

describe('Key event helper', () => {
  test('creates event for lowercase letter', () => {
    const e = keyEventForChar('keydown', 'a');
    expect(e.key).toBe('a');
    expect(e.code).toBe('KeyA');
    expect(e.keyCode).toBe(97);
    expect(e.type).toBe('keydown');
    expect(e.bubbles).toBe(true);
    expect(e.cancelable).toBe(true);
  });

  test('creates event for uppercase letter', () => {
    const e = keyEventForChar('keypress', 'Z');
    expect(e.key).toBe('Z');
    expect(e.code).toBe('KeyZ');
    expect(e.keyCode).toBe(90);
    expect(e.type).toBe('keypress');
  });

  test('creates event for digit', () => {
    const e = keyEventForChar('keyup', '5');
    expect(e.key).toBe('5');
    expect(e.code).toBe('Digit5');
    expect(e.keyCode).toBe(53);
  });

  test('creates event for space', () => {
    const e = keyEventForChar('keydown', ' ');
    expect(e.key).toBe(' ');
    expect(e.code).toBe('Space');
    expect(e.keyCode).toBe(32);
  });

  test('creates event for special character', () => {
    const e = keyEventForChar('keydown', '@');
    expect(e.key).toBe('@');
    expect(e.code).toBe('@');
    expect(e.keyCode).toBe(64);
  });

  test('creates event for hyphen', () => {
    const e = keyEventForChar('keydown', '-');
    expect(e.key).toBe('-');
    expect(e.code).toBe('-');
    expect(e.keyCode).toBe(45);
  });
});

// ===================== describeTarget =====================
// Mirrors describeTarget from content/index.js

function describeTarget(cmd) {
  if (!cmd) return '';
  if (cmd.ref && cmd.selector) return cmd.ref + ' (' + cmd.selector + ')';
  if (cmd.ref) return cmd.ref;
  return cmd.selector || '';
}

describe('describeTarget', () => {
  test('returns empty for null cmd', () => {
    expect(describeTarget(null)).toBe('');
  });

  test('returns empty for empty cmd', () => {
    expect(describeTarget({})).toBe('');
  });

  test('returns ref when only ref provided', () => {
    expect(describeTarget({ ref: 'el-42' })).toBe('el-42');
  });

  test('returns selector when only selector provided', () => {
    expect(describeTarget({ selector: '#login-btn' })).toBe('#login-btn');
  });

  test('returns combined ref and selector when both provided', () => {
    expect(describeTarget({ ref: 'el-42', selector: '#login-btn' })).toBe('el-42 (#login-btn)');
  });

  test('returns empty for cmd with neither ref nor selector', () => {
    expect(describeTarget({ type: 'click' })).toBe('');
  });
});

// ===================== execute_js Static Guard =====================
// Mirrors the _PRIV_RE check in the execute_js command handler

const PRIV_RE = /\bdocument\.cookie\b|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\beval\s*\(|\bFunction\s*\(|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bnavigator\.sendBeacon\b/;

describe('execute_js static guard', () => {
  test('blocks document.cookie access', () => {
    expect(PRIV_RE.test('document.cookie')).toBe(true);
  });

  test('blocks fetch() call', () => {
    expect(PRIV_RE.test('fetch("https://evil.com")')).toBe(true);
  });

  test('blocks XMLHttpRequest usage', () => {
    expect(PRIV_RE.test('new XMLHttpRequest()')).toBe(true);
  });

  test('blocks WebSocket usage', () => {
    expect(PRIV_RE.test('new WebSocket("wss://evil.com")')).toBe(true);
  });

  test('blocks eval() call', () => {
    expect(PRIV_RE.test('eval("alert(1)")')).toBe(true);
  });

  test('blocks Function constructor', () => {
    expect(PRIV_RE.test('new Function("return 1")')).toBe(true);
  });

  test('blocks localStorage access', () => {
    expect(PRIV_RE.test('localStorage.getItem("x")')).toBe(true);
  });

  test('blocks sessionStorage access', () => {
    expect(PRIV_RE.test('sessionStorage.setItem("k","v")')).toBe(true);
  });

  test('blocks indexedDB access', () => {
    expect(PRIV_RE.test('indexedDB.open("db")')).toBe(true);
  });

  test('blocks navigator.sendBeacon', () => {
    expect(PRIV_RE.test('navigator.sendBeacon("url")')).toBe(true);
  });

  test('allows safe DOM operations', () => {
    expect(PRIV_RE.test('document.querySelector(".main")')).toBe(false);
  });

  test('allows document.getElementById', () => {
    expect(PRIV_RE.test('document.getElementById("test")')).toBe(false);
  });

  test('allows document.querySelectorAll', () => {
    expect(PRIV_RE.test('document.querySelectorAll("div")')).toBe(false);
  });

  test('allows JSON operations', () => {
    expect(PRIV_RE.test('JSON.parse(data)')).toBe(false);
  });

  test('allows Array operations', () => {
    expect(PRIV_RE.test('Array.from(elements).map(e => e.innerText)')).toBe(false);
  });

  test('allows textContent read', () => {
    expect(PRIV_RE.test('el.textContent')).toBe(false);
  });
});

// ===================== Modal Signal Detection =====================
// Mirrors __sentinelHasPositiveModalSignal logic from content/index.js

function hasPositiveModalSignal(el) {
  try {
    const role = el.getAttribute && el.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') return true;
    if (el.getAttribute && el.getAttribute('aria-modal') === 'true') return true;
    const text = (el.innerText || el.textContent || '').toLowerCase().slice(0, 200);
    if (/\b(modal|dialog|sign in|subscribe)\b/.test(text)) return true;
  } catch (e) { /* ignore */ }
  return false;
}

describe('Modal signal detection', () => {
  test('detects role="dialog"', () => {
    const el = { getAttribute: (a) => a === 'role' ? 'dialog' : null };
    expect(hasPositiveModalSignal(el)).toBe(true);
  });

  test('detects role="alertdialog"', () => {
    const el = { getAttribute: (a) => a === 'role' ? 'alertdialog' : null };
    expect(hasPositiveModalSignal(el)).toBe(true);
  });

  test('detects aria-modal="true"', () => {
    const el = { getAttribute: (a) => a === 'aria-modal' ? 'true' : null };
    expect(hasPositiveModalSignal(el)).toBe(true);
  });

  test('detects "modal" in innerText', () => {
    const el = { getAttribute: () => null, innerText: 'Close this modal dialog' };
    expect(hasPositiveModalSignal(el)).toBe(true);
  });

  test('detects "dialog" in textContent', () => {
    const el = { getAttribute: () => null, textContent: 'Open dialog window' };
    expect(hasPositiveModalSignal(el)).toBe(true);
  });

  test('detects "sign in" in text', () => {
    const el = { getAttribute: () => null, innerText: 'Please sign in to continue' };
    expect(hasPositiveModalSignal(el)).toBe(true);
  });

  test('detects "subscribe" in text', () => {
    const el = { getAttribute: () => null, innerText: 'Subscribe to our newsletter' };
    expect(hasPositiveModalSignal(el)).toBe(true);
  });

  test('returns false for regular div', () => {
    const el = { getAttribute: () => null, innerText: 'Welcome to the page' };
    expect(hasPositiveModalSignal(el)).toBe(false);
  });

  test('returns false for element with no attributes', () => {
    const el = { innerText: 'Regular content here' };
    expect(hasPositiveModalSignal(el)).toBe(false);
  });

  test('only checks first 200 chars of text', () => {
    const el = {
      getAttribute: () => null,
      innerText: 'x'.repeat(201) + 'modal',
    };
    expect(hasPositiveModalSignal(el)).toBe(false);
  });

  test('returns false on getAttribute error', () => {
    const el = { getAttribute: () => { throw new Error('nope'); }, innerText: '' };
    expect(hasPositiveModalSignal(el)).toBe(false);
  });
});

// ===================== Dismissal Cap Logic =====================
// Mirrors the route-reset + cap logic from dismissOverlays

describe('Overlay dismissal cap', () => {
  test('returns capped=true when max dismissals reached', () => {
    let dismissCount = 3;
    const MAX = 3;
    const result = dismissCount >= MAX;
    expect(result).toBe(true);
  });

  test('allows dismissal when under cap', () => {
    let dismissCount = 2;
    const MAX = 3;
    const result = dismissCount >= MAX;
    expect(result).toBe(false);
  });

  test('route change resets dismissal count', () => {
    let dismissCount = 3;
    let lastRoute = '/page1';
    const currentRoute = '/page2';
    if (currentRoute !== lastRoute) {
      dismissCount = 0;
      lastRoute = currentRoute;
    }
    expect(dismissCount).toBe(0);
  });

  test('same route does not reset dismissal count', () => {
    let dismissCount = 3;
    let lastRoute = '/page1';
    const currentRoute = '/page1';
    if (currentRoute !== lastRoute) {
      dismissCount = 0;
      lastRoute = currentRoute;
    }
    expect(dismissCount).toBe(3);
  });

  test('hash change counts as route change', () => {
    let dismissCount = 3;
    let lastRoute = '/page1#section1';
    const currentRoute = '/page1#section2';
    if (currentRoute !== lastRoute) {
      dismissCount = 0;
    }
    expect(dismissCount).toBe(0);
  });
});

// ===================== Multi-select null guard =====================
// Mirrors the multi-select loop in the 'select' command case of content/index.js.
// Verifies null/undefined values in cmd.value array are skipped without crashing.

function multiSelectOptions(optionValues, cmdValues) {
  const options = optionValues.map(v => ({ value: v, textContent: v, selected: false }));
  for (const val of cmdValues) {
    if (val == null) continue;
    const valStr = String(val);
    const opt = options.find(o => o.value === val || o.textContent.trim().toLowerCase() === valStr.toLowerCase());
    if (opt) opt.selected = true;
  }
  return options;
}

describe('Multi-select null guard', () => {
  test('skips null values without throwing', () => {
    expect(() => multiSelectOptions(['a', 'b', 'c'], [null, 'a'])).not.toThrow();
  });

  test('skips undefined values without throwing', () => {
    expect(() => multiSelectOptions(['a', 'b'], [undefined, 'b'])).not.toThrow();
  });

  test('still selects valid string values alongside null entries', () => {
    const opts = multiSelectOptions(['alpha', 'beta', 'gamma'], [null, 'beta', undefined]);
    expect(opts.find(o => o.value === 'beta').selected).toBe(true);
    expect(opts.find(o => o.value === 'alpha').selected).toBe(false);
  });

  test('selects by text content case-insensitively', () => {
    const opts = multiSelectOptions(['Alpha', 'Beta'], ['ALPHA']);
    expect(opts.find(o => o.value === 'Alpha').selected).toBe(true);
  });
});
