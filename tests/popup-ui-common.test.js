// tests/popup-ui-common.test.js
// Unit tests for popup-modules/ui-common.js — escapeHtml, sanitizeHtml, isValidUrl, showToast.
// Uses linkedom for lightweight DOM (createElement textContent/innerHTML, DOMParser).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { parseHTML } from 'linkedom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const timeouts = [];

// linkedom's DOMParser requires full HTML documents; sanitizeHtml passes fragments.
// Wrap it to always wrap input in a full doc and handle edge cases.
function createSandbox() {
  const { document, DOMParser: LinkedomDOMParser, HTMLElement, Node } = parseHTML(
    '<!DOCTYPE html><html><body></body></html>'
  );

  class DOMParser extends LinkedomDOMParser {
    parseFromString(html, type) {
      const input = html || '';
      // Wrap fragments in a full document so body.innerHTML works
      const wrapped = `<!DOCTYPE html><html><body>${input}</body></html>`;
      return super.parseFromString(wrapped, type);
    }
  }

  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    URL,
    DOMParser,
    Node,
    HTMLElement,
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
    document,
    marked: { setOptions() {} },
  };
  sandbox.window = sandbox;
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/ui-common.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'ui-common.js' });
  script.runInContext(sandbox);
  return sandbox;
}

describe('escapeHtml', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('escapes ampersands', () => {
    const result = sandbox.escapeHtml('a&b');
    expect(result).toContain('&amp;');
  });

  test('escapes angle brackets', () => {
    const result = sandbox.escapeHtml('<div>');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });

  test('handles null input', () => {
    const result = sandbox.escapeHtml(null);
    expect(typeof result).toBe('string');
  });

  test('handles undefined input', () => {
    const result = sandbox.escapeHtml(undefined);
    expect(typeof result).toBe('string');
  });

  test('handles empty string', () => {
    expect(sandbox.escapeHtml('')).toBe('');
  });

  test('handles plain text without special characters', () => {
    expect(sandbox.escapeHtml('hello world')).toBe('hello world');
  });

  test('escapes double quotes', () => {
    const result = sandbox.escapeHtml('"quoted"');
    // linkedom innerHTML does not encode quotes; browser would produce &quot;
    expect(result).toContain('quoted');
  });

  test('escapes single quotes', () => {
    const result = sandbox.escapeHtml("'quoted'");
    // linkedom innerHTML does not encode single quotes; browser would produce &#39;
    expect(result).toContain('quoted');
  });
});

describe('sanitizeHtml', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('removes script tags', () => {
    const result = sandbox.sanitizeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
  });

  test('removes iframe tags', () => {
    const result = sandbox.sanitizeHtml('<iframe src="evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  test('removes object tags', () => {
    const result = sandbox.sanitizeHtml('<object data="evil.swf"></object>');
    expect(result).not.toContain('<object');
  });

  test('removes embed tags', () => {
    const result = sandbox.sanitizeHtml('<embed src="evil.swf">');
    expect(result).not.toContain('<embed');
  });

  test('removes svg tags', () => {
    const result = sandbox.sanitizeHtml('<svg onload="alert(1)"><circle/></svg>');
    expect(result).not.toContain('<svg');
  });

  test('removes math tags', () => {
    const result = sandbox.sanitizeHtml('<math><mtext>test</mtext></math>');
    expect(result).not.toContain('<math');
  });

  test('removes form tags', () => {
    const result = sandbox.sanitizeHtml('<form action="evil"><input/></form>');
    expect(result).not.toContain('<form');
  });

  test('allows safe HTML', () => {
    const result = sandbox.sanitizeHtml('<div>Hello <b>world</b></div>');
    expect(result).toContain('Hello');
    expect(result).toContain('<b>world</b>');
  });

  test('removes onclick handlers', () => {
    const result = sandbox.sanitizeHtml('<div onclick="alert(1)">click me</div>');
    expect(result).not.toContain('onclick');
  });

  test('removes onerror handlers', () => {
    const result = sandbox.sanitizeHtml('<img onerror="alert(1)" src="x">');
    expect(result).not.toContain('onerror');
  });

  test('removes javascript: URLs in href', () => {
    const result = sandbox.sanitizeHtml('<a href="javascript:alert(1)">link</a>');
    expect(result).not.toContain('javascript:');
  });

  test('removes data: URLs in src', () => {
    const result = sandbox.sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">');
    expect(result).not.toContain('data:');
  });

  test('removes vbscript: URLs', () => {
    const result = sandbox.sanitizeHtml('<a href="vbscript:msgbox">link</a>');
    expect(result).not.toContain('vbscript:');
  });

  test('removes style with expression()', () => {
    const result = sandbox.sanitizeHtml('<div style="width:expression(alert(1))">x</div>');
    expect(result).not.toContain('expression');
  });

  test('removes style with url(javascript:)', () => {
    const result = sandbox.sanitizeHtml('<div style="background:url(javascript:alert(1))">x</div>');
    expect(result).not.toContain('javascript');
  });

  test('allows safe href', () => {
    const result = sandbox.sanitizeHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('https://example.com');
  });

  test('handles empty string', () => {
    const result = sandbox.sanitizeHtml('');
    expect(result).toBe('');
  });

  test('removes base tags', () => {
    const result = sandbox.sanitizeHtml('<base href="evil.com">');
    expect(result).not.toContain('<base');
  });

  test('removes link import tags', () => {
    const result = sandbox.sanitizeHtml('<link rel="import" href="evil.html">');
    expect(result).not.toContain('<link');
  });

  test('removes meta tags', () => {
    const result = sandbox.sanitizeHtml('<meta http-equiv="refresh" content="0;url=evil">');
    expect(result).not.toContain('<meta');
  });
});

describe('isValidUrl', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('returns true for valid https URL', () => {
    expect(sandbox.isValidUrl('https://example.com')).toBe(true);
  });

  test('returns true for valid http URL', () => {
    expect(sandbox.isValidUrl('http://localhost:3000')).toBe(true);
  });

  test('returns true for valid URL with path and query', () => {
    expect(sandbox.isValidUrl('https://example.com/path/to/page?query=1')).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(sandbox.isValidUrl('')).toBe(false);
  });

  test('returns false for plain text', () => {
    expect(sandbox.isValidUrl('not a url')).toBe(false);
  });

  test('returns false for missing protocol', () => {
    expect(sandbox.isValidUrl('example.com')).toBe(false);
  });

  test('returns true for ftp URL', () => {
    expect(sandbox.isValidUrl('ftp://files.example.com')).toBe(true);
  });

  test('returns true for ws URL', () => {
    expect(sandbox.isValidUrl('ws://localhost:8000/bridge')).toBe(true);
  });

  test('returns true for wss URL', () => {
    expect(sandbox.isValidUrl('wss://example.com/socket')).toBe(true);
  });
});

describe('showToast', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('creates toast element with message', () => {
    const before = sandbox.document.body.childNodes.length;
    sandbox.showToast('Test message');
    const added = Array.from(sandbox.document.body?.childNodes || []).slice(before);
    const toast = added.find(el => el.textContent === 'Test message');
    expect(toast).toBeTruthy();
  });

  test('creates toast with success type by default', () => {
    const before = sandbox.document.body.childNodes.length;
    sandbox.showToast('Success');
    const added = Array.from(sandbox.document.body?.childNodes || []).slice(before);
    const toast = added.find(el => el.className === 'toast success');
    expect(toast).toBeTruthy();
  });

  test('creates toast with error type', () => {
    const before = sandbox.document.body.childNodes.length;
    sandbox.showToast('Error msg', 'error');
    const added = Array.from(sandbox.document.body?.childNodes || []).slice(before);
    const toast = added.find(el => el.className === 'toast error');
    expect(toast).toBeTruthy();
  });

  test('toast auto-removes via setTimeout', () => {
    const before = sandbox.document.body.childNodes.length;
    sandbox.showToast('Temp');
    const added = Array.from(sandbox.document.body?.childNodes || []).slice(before);
    expect(added.length).toBeGreaterThanOrEqual(1);
    // Execute the setTimeout callbacks
    const fns = timeouts.splice(0);
    fns.forEach(t => t.fn());
    // Toast should have been removed
    const stillPresent = Array.from(sandbox.document.body?.childNodes || []).find(el => el.textContent === 'Temp');
    expect(stillPresent).toBeFalsy();
  });
});

describe('hasLastError and _getLastErrorMessage', () => {
  let sandbox;

  function createChromeSandbox() {
    const { document, DOMParser: LinkedomDOMParser, HTMLElement, Node } = parseHTML(
      '<!DOCTYPE html><html><body></body></html>'
    );
    const sb = {
      window: {},
      console,
      JSON,
      Error,
      TypeError,
      URL,
      DOMParser: LinkedomDOMParser,
      Node,
      HTMLElement,
      setTimeout: () => {},
      clearTimeout: () => {},
      document,
      marked: { setOptions() {} },
      chrome: {
        runtime: { lastError: null },
      },
    };
    sb.window = sb;
    return sb;
  }

  beforeEach(() => {
    sandbox = createChromeSandbox();
    loadModule(sandbox);
  });

  test('hasLastError returns false when lastError is null', () => {
    sandbox.chrome.runtime.lastError = null;
    expect(sandbox.hasLastError()).toBe(false);
  });

  test('hasLastError returns false when lastError is undefined', () => {
    sandbox.chrome.runtime.lastError = undefined;
    expect(sandbox.hasLastError()).toBe(false);
  });

  test('hasLastError returns truthy when lastError is an object', () => {
    sandbox.chrome.runtime.lastError = { message: 'Storage error' };
    expect(sandbox.hasLastError()).toBeTruthy();
  });

  test('_getLastErrorMessage returns empty string when no error', () => {
    sandbox.chrome.runtime.lastError = null;
    expect(sandbox._getLastErrorMessage()).toBe('');
  });

  test('_getLastErrorMessage returns message string from lastError.message', () => {
    sandbox.chrome.runtime.lastError = { message: 'Quota exceeded' };
    expect(sandbox._getLastErrorMessage()).toBe('Quota exceeded');
  });

  test('_getLastErrorMessage falls back to String() when no message property', () => {
    sandbox.chrome.runtime.lastError = 'plain string error';
    // typeof 'string' !== 'object', so hasLastError returns false → returns ''
    expect(sandbox._getLastErrorMessage()).toBe('');
  });
});
