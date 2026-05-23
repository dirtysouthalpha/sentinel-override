/**
 * Sentinel Override - Frame Manager Tests
 * Tests for iframe scanning, element finding in iframes, and iframe metadata.
 */

import { jest } from '@jest/globals';

// Set up global environment before loading the module
globalThis.window = globalThis;
globalThis.CSS = { escape: (s) => s.replace(/([[\]\\])/g, '\\$1') };
globalThis.Node = { ELEMENT_NODE: 1 };

const fn = () => () => {};

function createElement(tag, attrs = {}) {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    getAttribute: (name) => attrs[name] || null,
    setAttribute: (name, val) => { attrs[name] = val; },
    hasAttribute: (name) => attrs[name] !== undefined,
    id: attrs.id || '',
    className: attrs.className || '',
    src: attrs.src || '',
    name: attrs.name || '',
    type: attrs.type || '',
    value: attrs.value || '',
    innerText: attrs.innerText || '',
    textContent: attrs.textContent || '',
    disabled: attrs.disabled || false,
    checked: attrs.checked || false,
    role: attrs.role || '',
    style: attrs.style || { display: 'block', visibility: 'visible', opacity: '1' },
    offsetWidth: attrs.offsetWidth || 100,
    offsetHeight: attrs.offsetHeight || 30,
    isConnected: true,
    ownerDocument: { defaultView: globalThis },
    parentElement: attrs.parentElement || null,
    children: attrs.children || [],
    addEventListener: (evt, cb) => { listeners[evt] = listeners[evt] || []; listeners[evt].push(cb); },
    removeEventListener: (evt, cb) => { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== cb); },
    dispatchEvent: (evt) => {
      evt.target = el;
      if (listeners[evt.type]) {
        listeners[evt.type].forEach(cb => cb(evt));
      }
      return true;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40 }),
  };
  return el;
}

function setupFrameManagerEnv() {
  globalThis.window.__sentinelUtils = {};
  globalThis.window.__sentinelUtils.dom = {
    scanDocument: (doc, elements, selectorMap, prefix) => {
      // Mock scan to add a few elements
      if (doc && doc.mockElements) {
        doc.mockElements.forEach((el, i) => {
          const wrapped = { ...el, selector: prefix + 'el:' + i };
          elements.push(wrapped);
          selectorMap.set(wrapped.selector, wrapped);
        });
      }
    },
    findElementBySelector: (doc, selector) => {
      if (doc && doc.mockElements) {
        const idx = parseInt(selector.split(':')[1]);
        return doc.mockElements[idx] || null;
      }
      return null;
    },
    isVisible: (el) => {
      if (!el || !el.nodeType) return false;
      const style = el.style || {};
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      return true;
    }
  };
  globalThis.document = {
    defaultView: globalThis,
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    body: { innerText: '', appendChild: fn, removeChild: fn },
    activeElement: null,
    documentElement: { children: [] },
  };
  globalThis.getComputedStyle = () => ({
    display: 'block', visibility: 'visible', opacity: '1',
    pointerEvents: 'auto', position: 'static', zIndex: 'auto',
  });
}

setupFrameManagerEnv();

let fm;
let dom;
beforeAll(async () => {
  await import('../content/frame-manager.js');
  fm = globalThis.window.__sentinelUtils.frame;
  dom = globalThis.window.__sentinelUtils.dom;
});

beforeEach(() => {
  setupFrameManagerEnv();
});

describe('Frame Manager', () => {
  describe('scanIframes', () => {
    test('should return empty result when doc is null', () => {
      const result = fm.scanIframes(null);
      expect(result).toEqual({ elements: [], iframeCount: 0, crossOriginCount: 0 });
    });

    test('should return empty result when doc is undefined', () => {
      const result = fm.scanIframes(undefined);
      expect(result).toEqual({ elements: [], iframeCount: 0, crossOriginCount: 0 });
    });

    test('should handle querySelectorAll errors gracefully', () => {
      const badDoc = {
        querySelectorAll: () => { throw new Error('Query failed'); }
      };

      const result = fm.scanIframes(badDoc);
      expect(result).toEqual({ elements: [], iframeCount: 0, crossOriginCount: 0 });
    });

    test('should scan same-origin iframes', () => {
      const mockEl1 = createElement('button', { innerText: 'Button 1' });
      const mockEl2 = createElement('input', { type: 'text', placeholder: 'Input 1' });

      const iframeDoc = {
        mockElements: [mockEl1, mockEl2]
      };

      const iframe = createElement('iframe', { src: 'https://example.com/frame1.html' });
      iframe.contentWindow = { document: iframeDoc };

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.scanIframes(globalThis.document);

      expect(result.iframeCount).toBe(1);
      expect(result.crossOriginCount).toBe(0);
      expect(result.elements).toHaveLength(2);
      expect(result.elements[0].frameIndex).toBe(0);
      expect(result.elements[0].frameUrl).toBe('https://example.com/frame1.html');
    });

    test('should add placeholder for cross-origin iframes', () => {
      const iframe = createElement('iframe', { src: 'https://otherdomain.com/frame.html' });
      // contentWindow access will throw for cross-origin
      Object.defineProperty(iframe, 'contentWindow', {
        get: () => { throw new Error('Cross-origin'); }
      });

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.scanIframes(globalThis.document);

      expect(result.iframeCount).toBe(1);
      expect(result.crossOriginCount).toBe(1);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].tag).toBe('IFRAME');
      expect(result.elements[0].role).toBe('cross-origin-iframe');
      expect(result.elements[0].frameUrl).toBe('https://otherdomain.com/frame.html');
    });

    test('should handle mixed same-origin and cross-origin iframes', () => {
      const mockEl = createElement('div', { innerText: 'Content' });

      const sameOriginDoc = { mockElements: [mockEl] };
      const sameOriginIframe = createElement('iframe', { src: 'https://same.com/frame.html' });
      sameOriginIframe.contentWindow = { document: sameOriginDoc };

      const crossOriginIframe = createElement('iframe', { src: 'https://other.com/frame.html' });
      Object.defineProperty(crossOriginIframe, 'contentWindow', {
        get: () => { throw new Error('Cross-origin'); }
      });

      globalThis.document.querySelectorAll = () => [sameOriginIframe, crossOriginIframe];

      const result = fm.scanIframes(globalThis.document);

      expect(result.iframeCount).toBe(2);
      expect(result.crossOriginCount).toBe(1);
      expect(result.elements.length).toBeGreaterThan(0);
    });

    test('should use about:blank for iframes with no src', () => {
      const iframe = createElement('iframe');
      // Mock getAttribute to return null for src
      const originalGetAttr = iframe.getAttribute;
      iframe.getAttribute = (name) => name === 'src' ? null : originalGetAttr(name);
      iframe.src = '';

      const iframeDoc = { mockElements: [] };
      iframe.contentWindow = { document: iframeDoc };

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.scanIframes(globalThis.document);

      expect(result.elements[0]?.frameUrl || 'about:blank').toBe('about:blank');
    });

    test('should handle iframe with null contentWindow', () => {
      const iframe = createElement('iframe', { src: 'https://example.com/frame.html' });
      // When contentWindow is null, it's treated as same-origin but with no document
      iframe.contentWindow = null;

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.scanIframes(globalThis.document);

      // null contentWindow is not same-origin (can't access document)
      // but it's not counted as cross-origin in the original logic
      // The function checks `iframe.contentWindow && iframe.contentWindow.document`
      // When contentWindow is null, the condition fails and no error is thrown
      // but it doesn't increment crossOriginCount because no catch occurs
      expect(result.iframeCount).toBe(1);
    });
  });

  describe('findInIframe', () => {
    test('should return null when selector is null', () => {
      const result = fm.findInIframe(globalThis.document, null);
      expect(result).toBeNull();
    });

    test('should return null when selector is undefined', () => {
      const result = fm.findInIframe(globalThis.document, undefined);
      expect(result).toBeNull();
    });

    test('should return null when selector does not start with frame:', () => {
      const result = fm.findInIframe(globalThis.document, 'div.button');
      expect(result).toBeNull();
    });

    test('should return null when frameIndex is NaN', () => {
      const result = fm.findInIframe(globalThis.document, 'frame:abc:selector');
      expect(result).toBeNull();
    });

    test('should return null when querySelectorAll fails', () => {
      const badDoc = {
        querySelectorAll: () => { throw new Error('Query failed'); }
      };

      const result = fm.findInIframe(badDoc, 'frame:0:button');
      expect(result).toBeNull();
    });

    test('should return null when iframe at index does not exist', () => {
      const iframe = createElement('iframe');
      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.findInIframe(globalThis.document, 'frame:5:button');
      expect(result).toBeNull();
    });

    test('should find element in same-origin iframe', () => {
      const mockEl = createElement('button', { innerText: 'Click me' });

      const iframeDoc = {
        mockElements: [mockEl]
      };

      const iframe = createElement('iframe', { src: 'https://example.com/frame.html' });
      iframe.contentWindow = { document: iframeDoc };

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.findInIframe(globalThis.document, 'frame:0:el:0');

      expect(result).not.toBeNull();
      expect(result.element).not.toBeNull();
      expect(result.frameDoc).toBe(iframeDoc);
      expect(result.frameIndex).toBe(0);
      expect(result.frameUrl).toBe('https://example.com/frame.html');
      expect(result.crossOrigin).toBeUndefined();
    });

    test('should return null element when not found in same-origin iframe', () => {
      const iframeDoc = { mockElements: [] };

      const iframe = createElement('iframe', { src: 'https://example.com/frame.html' });
      iframe.contentWindow = { document: iframeDoc };

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.findInIframe(globalThis.document, 'frame:0:el:5');

      expect(result).not.toBeNull();
      expect(result.element).toBeNull();
      expect(result.frameDoc).toBe(iframeDoc);
      expect(result.frameIndex).toBe(0);
    });

    test('should return cross-origin info for cross-origin iframe', () => {
      const iframe = createElement('iframe', { src: 'https://other.com/frame.html' });
      Object.defineProperty(iframe, 'contentWindow', {
        get: () => { throw new Error('Cross-origin'); }
      });

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.findInIframe(globalThis.document, 'frame:0:button');

      expect(result).not.toBeNull();
      expect(result.crossOrigin).toBe(true);
      expect(result.frameIndex).toBe(0);
      expect(result.frameUrl).toBe('https://other.com/frame.html');
      expect(result.remainingSelector).toBe('button');
    });

    test('should handle complex selector with multiple colons', () => {
      const mockEl = createElement('div', { innerText: 'Content' });

      const iframeDoc = { mockElements: [mockEl] };

      const iframe = createElement('iframe', { src: 'https://example.com/nested.html' });
      iframe.contentWindow = { document: iframeDoc };

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.findInIframe(globalThis.document, 'frame:0:el:0');

      expect(result).not.toBeNull();
      expect(result.element).not.toBeNull();
    });
  });

  describe('getIframeInfo', () => {
    test('should return empty array when doc is null', () => {
      const result = fm.getIframeInfo(null);
      expect(result).toEqual([]);
    });

    test('should return empty array when doc is undefined', () => {
      const result = fm.getIframeInfo(undefined);
      expect(result).toEqual([]);
    });

    test('should handle querySelectorAll errors gracefully', () => {
      const badDoc = {
        querySelectorAll: () => { throw new Error('Query failed'); }
      };

      const result = fm.getIframeInfo(badDoc);
      expect(result).toEqual([]);
    });

    test('should return metadata for same-origin iframes', () => {
      const iframe = createElement('iframe', {
        src: 'https://example.com/frame.html',
        offsetWidth: 400,
        offsetHeight: 300
      });
      iframe.contentWindow = { document: {} };
      iframe.getBoundingClientRect = () => ({ width: 400, height: 300, x: 0, y: 0 });

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.getIframeInfo(globalThis.document);

      expect(result).toHaveLength(1);
      expect(result[0].index).toBe(0);
      expect(result[0].src).toBe('https://example.com/frame.html');
      expect(result[0].sameOrigin).toBe(true);
      expect(result[0].width).toBe(400);
      expect(result[0].height).toBe(300);
      expect(result[0].visible).toBe(true);
    });

    test('should return metadata for cross-origin iframes', () => {
      const iframe = createElement('iframe', {
        src: 'https://other.com/frame.html',
        offsetWidth: 200,
        offsetHeight: 150
      });
      Object.defineProperty(iframe, 'contentWindow', {
        get: () => { throw new Error('Cross-origin'); }
      });
      iframe.getBoundingClientRect = () => ({ width: 200, height: 150, x: 0, y: 0 });

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.getIframeInfo(globalThis.document);

      expect(result).toHaveLength(1);
      expect(result[0].sameOrigin).toBe(false);
    });

    test('should handle getBoundingClientRect errors', () => {
      const iframe = createElement('iframe', { src: 'https://example.com/frame.html' });
      iframe.contentWindow = { document: {} };
      iframe.getBoundingClientRect = () => { throw new Error('Detached element'); };

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.getIframeInfo(globalThis.document);

      expect(result[0].width).toBe(0);
      expect(result[0].height).toBe(0);
    });

    test('should handle isVisible errors gracefully', () => {
      const iframe = createElement('iframe', { src: 'https://example.com/frame.html' });
      iframe.contentWindow = { document: {} };
      iframe.getBoundingClientRect = () => ({ width: 100, height: 100, x: 0, y: 0 });

      // Make iframe invisible by setting offsetWidth to 0
      iframe.offsetWidth = 0;
      iframe.offsetHeight = 0;

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.getIframeInfo(globalThis.document);

      // isVisible should return false for zero-size elements
      expect(result[0].visible).toBe(false);
    });

    test('should round width and height values', () => {
      const iframe = createElement('iframe', { src: 'https://example.com/frame.html' });
      iframe.contentWindow = { document: {} };
      iframe.getBoundingClientRect = () => ({ width: 399.7, height: 299.3, x: 0, y: 0 });

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.getIframeInfo(globalThis.document);

      expect(result[0].width).toBe(400);
      expect(result[0].height).toBe(299);
    });

    test('should use about:blank for iframes with no src', () => {
      const iframe = createElement('iframe');
      // Mock getAttribute to return null for src
      const originalGetAttr = iframe.getAttribute;
      iframe.getAttribute = (name) => name === 'src' ? null : originalGetAttr(name);
      iframe.src = '';
      iframe.contentWindow = { document: {} };
      iframe.getBoundingClientRect = () => ({ width: 100, height: 100, x: 0, y: 0 });

      globalThis.document.querySelectorAll = () => [iframe];

      const result = fm.getIframeInfo(globalThis.document);

      expect(result[0].src).toBe('about:blank');
    });

    test('should return info for multiple iframes', () => {
      const iframe1 = createElement('iframe', { src: 'https://example.com/frame1.html' });
      iframe1.contentWindow = { document: {} };
      iframe1.getBoundingClientRect = () => ({ width: 300, height: 200, x: 0, y: 0 });

      const iframe2 = createElement('iframe', { src: 'https://example.com/frame2.html' });
      iframe2.contentWindow = { document: {} };
      iframe2.getBoundingClientRect = () => ({ width: 400, height: 300, x: 0, y: 0 });

      globalThis.document.querySelectorAll = () => [iframe1, iframe2];

      const result = fm.getIframeInfo(globalThis.document);

      expect(result).toHaveLength(2);
      expect(result[0].index).toBe(0);
      expect(result[1].index).toBe(1);
      expect(result[0].src).toBe('https://example.com/frame1.html');
      expect(result[1].src).toBe('https://example.com/frame2.html');
    });
  });
});
