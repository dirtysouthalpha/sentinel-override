// Sentinel Override v3 -- Unit tests for content/shadow-dom.js
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createEl, createShadowHost } from '../helpers/dom-fixture.js';

describe('shadow-dom', () => {
  let shadow;

  beforeAll(async () => {
    window.__sentinelUtils = window.__sentinelUtils || {};
    await import('../../content/shadow-dom.js');
    shadow = window.__sentinelUtils.shadow;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    window.__sentinelCapturedRoots = undefined;
  });

  it('exports shadow from window.__sentinelUtils.shadow', () => {
    expect(shadow).toBeDefined();
    expect(shadow.getShadowRoot).toBeInstanceOf(Function);
    expect(shadow.isInShadowDOM).toBeInstanceOf(Function);
    expect(shadow.walkShadowTree).toBeInstanceOf(Function);
    expect(shadow.queryDeep).toBeInstanceOf(Function);
    expect(shadow.queryDeepFirst).toBeInstanceOf(Function);
  });

  describe('getShadowRoot', () => {
    it('returns null for null element', () => {
      expect(shadow.getShadowRoot(null)).toBeNull();
    });

    it('returns null for element without shadow root', () => {
      const el = document.createElement('div');
      expect(shadow.getShadowRoot(el)).toBeNull();
    });

    it('returns open shadow root', () => {
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' });
      const sr = shadow.getShadowRoot(host);
      expect(sr).toBeDefined();
      expect(sr.nodeType).toBe(11); // DocumentFragment
    });

    it('returns null for closed shadow root not in captured roots', () => {
      const host = document.createElement('div');
      host.attachShadow({ mode: 'closed' });
      window.__sentinelCapturedRoots = undefined;
      expect(shadow.getShadowRoot(host)).toBeNull();
    });

    it('returns captured root for closed shadow root', () => {
      const host = document.createElement('div');
      const sr = host.attachShadow({ mode: 'closed' });
      const capturedMap = new Map();
      capturedMap.set(host, sr);
      window.__sentinelCapturedRoots = capturedMap;
      expect(shadow.getShadowRoot(host)).toBe(sr);
      window.__sentinelCapturedRoots = undefined;
    });
  });

  describe('isInShadowDOM', () => {
    it('returns false for null', () => {
      expect(shadow.isInShadowDOM(null)).toBe(false);
    });

    it('returns false for regular DOM element', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      expect(shadow.isInShadowDOM(el)).toBe(false);
    });

    it('returns true for element inside shadow root', () => {
      const host = createShadowHost([]);
      document.body.appendChild(host);
      const inner = document.createElement('span');
      host.shadowRoot.appendChild(inner);
      expect(shadow.isInShadowDOM(inner)).toBe(true);
    });
  });

  describe('walkShadowTree', () => {
    it('calls callback for each element in the tree', () => {
      const container = document.createElement('div');
      container.appendChild(createEl('span'));
      container.appendChild(createEl('button'));

      const visited = [];
      shadow.walkShadowTree(container, (el) => {
        visited.push(el.tagName);
      });

      expect(visited).toContain('DIV');
      expect(visited).toContain('SPAN');
      expect(visited).toContain('BUTTON');
    });

    it('walks into shadow roots', () => {
      const inner = createEl('span', {}, 'Shadow Content');
      const host = createShadowHost([inner]);
      document.body.appendChild(host);

      const visited = [];
      shadow.walkShadowTree(host, (el) => {
        visited.push(el.tagName + ':' + (el.textContent || ''));
      });

      expect(visited).toContain('SPAN:Shadow Content');
    });

    it('handles null root gracefully', () => {
      const visited = [];
      shadow.walkShadowTree(null, (el) => visited.push(el));
      expect(visited).toHaveLength(0);
    });
  });

  describe('queryDeep', () => {
    it('finds elements in light DOM', () => {
      document.body.innerHTML = '<div class="target">Found</div>';
      const results = shadow.queryDeep(document, '.target');
      expect(results.length).toBe(1);
      expect(results[0].textContent).toBe('Found');
    });

    it('finds elements inside shadow roots', () => {
      const inner = createEl('div', { class: 'shadow-target' }, 'Shadow Found');
      const host = createShadowHost([inner]);
      document.body.appendChild(host);

      const results = shadow.queryDeep(document, '.shadow-target');
      expect(results.length).toBe(1);
      expect(results[0].textContent).toBe('Shadow Found');
    });

    it('returns empty array for no matches', () => {
      const results = shadow.queryDeep(document, '.nonexistent');
      expect(results).toHaveLength(0);
    });

    it('handles null root', () => {
      expect(shadow.queryDeep(null, '.test')).toEqual([]);
    });
  });

  describe('queryDeepFirst', () => {
    it('returns first matching element', () => {
      document.body.innerHTML = '<div class="target">First</div><div class="target">Second</div>';
      const result = shadow.queryDeepFirst(document, '.target');
      expect(result).toBeDefined();
      expect(result.textContent).toBe('First');
    });

    it('returns null for no match', () => {
      expect(shadow.queryDeepFirst(document, '.nonexistent')).toBeNull();
    });

    it('handles null root', () => {
      expect(shadow.queryDeepFirst(null, '.test')).toBeNull();
    });
  });
});
