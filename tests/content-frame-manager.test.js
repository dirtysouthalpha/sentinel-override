// tests/content-frame-manager.test.js
// Unit tests for content/frame-manager.js — scanIframes, findInIframe, getIframeInfo.
// Uses VM sandbox with mocked DOM (iframes, querySelectorAll, getBoundingClientRect).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createMockDom() {
  return {
    scanDocument(doc, elements, selectorMap, prefix) {
      elements.push({ tag: 'INPUT', text: 'scanned', selector: prefix + 'input' });
    },
    findElementBySelector(doc, selector) {
      if (selector === 'input') return { tagName: 'INPUT', value: 'found' };
      return null;
    },
    isVisible(el) {
      return el && el._visible !== false;
    },
  };
}

function createSandbox() {
  const mockDom = createMockDom();
  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    Map,
    Set,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Math,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
  };
  sandbox.window = sandbox;
  sandbox.window.__sentinelUtils = {
    dom: mockDom,
    frame: {},
  };
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../content/frame-manager.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'frame-manager.js' });
  script.runInContext(sandbox);
  return sandbox;
}

function getFm(sandbox) {
  return sandbox.window.__sentinelUtils.frame;
}

describe('frame-manager', () => {
  describe('scanIframes', () => {
    test('returns empty results for null doc', () => {
      const fm = getFm(loadModule(createSandbox()));
      const result = fm.scanIframes(null);
      expect(result.elements).toEqual([]);
      expect(result.iframeCount).toBe(0);
      expect(result.crossOriginCount).toBe(0);
    });

    test('returns empty results for doc with no iframes', () => {
      const fm = getFm(loadModule(createSandbox()));
      const result = fm.scanIframes({ querySelectorAll: () => [] });
      expect(result.elements).toEqual([]);
      expect(result.iframeCount).toBe(0);
    });

    test('scans same-origin iframes', () => {
      const iframeDoc = { querySelectorAll: () => [] };
      const iframes = [{
        src: 'https://example.com/embed',
        getAttribute() { return 'https://example.com/embed'; },
        contentWindow: { document: iframeDoc },
      }];
      const fm = getFm(loadModule(createSandbox()));
      const result = fm.scanIframes({ querySelectorAll: (sel) => sel === 'iframe' ? iframes : [] });
      expect(result.iframeCount).toBe(1);
      expect(result.crossOriginCount).toBe(0);
      expect(result.elements.length).toBeGreaterThanOrEqual(1);
      expect(result.elements[0].tag).toBe('INPUT');
      expect(result.elements[0].frameIndex).toBe(0);
    });

    test('reports cross-origin iframes as placeholders', () => {
      const iframes = [{
        src: 'https://other-domain.com/frame',
        getAttribute() { return 'https://other-domain.com/frame'; },
        get contentWindow() { throw new Error('Blocked a frame with origin'); },
      }];
      const fm = getFm(loadModule(createSandbox()));
      const result = fm.scanIframes({ querySelectorAll: (sel) => sel === 'iframe' ? iframes : [] });
      expect(result.iframeCount).toBe(1);
      expect(result.crossOriginCount).toBe(1);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].tag).toBe('IFRAME');
      expect(result.elements[0].role).toBe('cross-origin-iframe');
    });

    test('handles querySelectorAll throwing', () => {
      const fm = getFm(loadModule(createSandbox()));
      const result = fm.scanIframes({ querySelectorAll: () => { throw new Error('bad'); } });
      expect(result.iframeCount).toBe(0);
      expect(result.crossOriginCount).toBe(0);
    });
  });

  describe('findInIframe', () => {
    test('returns null for empty selector', () => {
      const fm = getFm(loadModule(createSandbox()));
      expect(fm.findInIframe({}, '')).toBeNull();
      expect(fm.findInIframe({}, null)).toBeNull();
    });

    test('returns null for non-frame selector', () => {
      const fm = getFm(loadModule(createSandbox()));
      expect(fm.findInIframe({}, 'div#main')).toBeNull();
    });

    test('returns null for invalid frame index', () => {
      const fm = getFm(loadModule(createSandbox()));
      expect(fm.findInIframe({}, 'frame:abc:div')).toBeNull();
    });

    test('returns null for out-of-range frame index', () => {
      const fm = getFm(loadModule(createSandbox()));
      expect(fm.findInIframe({ querySelectorAll: () => [] }, 'frame:5:div')).toBeNull();
    });

    test('finds element in same-origin iframe', () => {
      const iframeDoc = { querySelectorAll: () => [] };
      const iframeEl = {
        src: 'https://example.com/embed',
        getAttribute() { return 'https://example.com/embed'; },
        contentWindow: { document: iframeDoc },
      };
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const result = fm.findInIframe(doc, 'frame:0:input');
      expect(result).not.toBeNull();
      expect(result.frameIndex).toBe(0);
      expect(result.frameUrl).toBe('https://example.com/embed');
    });

    test('returns null when element not found in same-origin iframe', () => {
      const iframeDoc = { querySelectorAll: () => [] };
      const iframeEl = {
        src: 'https://example.com/embed',
        getAttribute() { return 'https://example.com/embed'; },
        contentWindow: { document: iframeDoc },
      };
      const dom = createMockDom();
      dom.findElementBySelector = () => null;
      const sandbox = createSandbox();
      sandbox.window.__sentinelUtils.dom = dom;
      const fm = getFm(loadModule(sandbox));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const result = fm.findInIframe(doc, 'frame:0:missing');
      expect(result.element).toBeNull();
      expect(result.frameDoc).toBe(iframeDoc);
    });

    test('returns cross-origin result for blocked iframe', () => {
      const iframeEl = {
        src: 'https://cross.com/page',
        getAttribute() { return 'https://cross.com/page'; },
        contentWindow: {
          get document() { throw new Error('cross-origin'); },
        },
      };
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const result = fm.findInIframe(doc, 'frame:0:div');
      expect(result.crossOrigin).toBe(true);
      expect(result.frameIndex).toBe(0);
      expect(result.remainingSelector).toBe('div');
    });

    test('handles querySelectorAll throwing', () => {
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: () => { throw new Error('bad'); } };
      expect(fm.findInIframe(doc, 'frame:0:div')).toBeNull();
    });
  });

  describe('getIframeInfo', () => {
    test('returns empty array for null doc', () => {
      const fm = getFm(loadModule(createSandbox()));
      expect(fm.getIframeInfo(null)).toEqual([]);
    });

    test('returns info for same-origin iframe', () => {
      const iframeEl = {
        src: 'https://example.com/embed',
        getAttribute() { return 'https://example.com/embed'; },
        contentWindow: { document: {} },
        _visible: true,
        getBoundingClientRect() { return { width: 600, height: 400 }; },
      };
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const info = fm.getIframeInfo(doc);
      expect(info).toHaveLength(1);
      expect(info[0].index).toBe(0);
      expect(info[0].src).toBe('https://example.com/embed');
      expect(info[0].sameOrigin).toBe(true);
      expect(info[0].width).toBe(600);
      expect(info[0].height).toBe(400);
    });

    test('returns info for cross-origin iframe', () => {
      const iframeEl = {
        src: 'https://other.com',
        getAttribute() { return 'https://other.com'; },
        contentWindow: {
          get document() { throw new Error('blocked'); },
        },
        _visible: true,
        getBoundingClientRect() { return { width: 300, height: 200 }; },
      };
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const info = fm.getIframeInfo(doc);
      expect(info).toHaveLength(1);
      expect(info[0].sameOrigin).toBe(false);
    });

    test('handles getBoundingClientRect throwing', () => {
      const iframeEl = {
        src: 'about:blank',
        getAttribute() { return 'about:blank'; },
        contentWindow: null,
        _visible: true,
        getBoundingClientRect() { throw new Error('detached'); },
      };
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const info = fm.getIframeInfo(doc);
      expect(info).toHaveLength(1);
      expect(info[0].width).toBe(0);
      expect(info[0].height).toBe(0);
    });

    test('handles querySelectorAll throwing', () => {
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: () => { throw new Error('bad'); } };
      expect(fm.getIframeInfo(doc)).toEqual([]);
    });

    test('returns multiple iframes', () => {
      const iframes = [
        { src: 'https://a.com', getAttribute() { return 'https://a.com'; }, contentWindow: { document: {} }, _visible: true, getBoundingClientRect() { return { width: 100, height: 50 }; } },
        { src: 'https://b.com', getAttribute() { return 'https://b.com'; }, contentWindow: null, _visible: true, getBoundingClientRect() { return { width: 200, height: 100 }; } },
      ];
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? iframes : [] };
      const info = fm.getIframeInfo(doc);
      expect(info).toHaveLength(2);
    });

    test('defaults src to about:blank when src is empty', () => {
      const iframeEl = {
        src: '',
        getAttribute() { return ''; },
        contentWindow: null,
        _visible: true,
        getBoundingClientRect() { return { width: 0, height: 0 }; },
      };
      const fm = getFm(loadModule(createSandbox()));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const info = fm.getIframeInfo(doc);
      expect(info[0].src).toBe('about:blank');
    });

    test('handles isVisible throwing a string error (line 181 catch, line 11 String path)', () => {
      const sandbox = createSandbox();
      sandbox.window.__sentinelUtils.dom.isVisible = () => { throw 'visibility failed'; };
      const iframeEl = {
        src: 'https://x.com/frame',
        getBoundingClientRect() { return { width: 100, height: 50 }; },
        contentDocument: null,
      };
      const fm = getFm(loadModule(sandbox));
      const doc = { querySelectorAll: (sel) => sel === 'iframe' ? [iframeEl] : [] };
      const info = fm.getIframeInfo(doc);
      expect(info[0].visible).toBe(false);
    });
  });
});
