// Sentinel Override v3 -- Unit tests for content/dom-utils.js
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createEl, createTestPage, cleanupTestPage, patchBoundingClientRect } from '../helpers/dom-fixture.js';

describe('dom-utils', () => {
  let dom;

  // Import once -- IIFE runs on first import, module is cached after that
  beforeAll(async () => {
    window.__sentinelUtils = window.__sentinelUtils || {};
    const mod = await import('../../content/dom-utils.js');
    dom = mod.dom;
  });

  it('exports dom from window.__sentinelUtils.dom', () => {
    expect(dom).toBeDefined();
    expect(dom.isVisible).toBeInstanceOf(Function);
    expect(dom.getLabel).toBeInstanceOf(Function);
    expect(dom.getUniqueSelector).toBeInstanceOf(Function);
    expect(dom.scanDocument).toBeInstanceOf(Function);
  });

  describe('isVisible', () => {
    let page;

    beforeEach(() => {
      page = createTestPage();
    });

    afterEach(() => {
      if (page) cleanupTestPage(page.container);
    });

    it('returns true for visible element', () => {
      expect(dom.isVisible(page.button)).toBe(true);
    });

    it('returns false for display:none element', () => {
      expect(dom.isVisible(page.hidden)).toBe(false);
    });

    it('returns false for visibility:hidden element', () => {
      page.button.style.visibility = 'hidden';
      expect(dom.isVisible(page.button)).toBe(false);
    });

    it('returns false for opacity:0 element', () => {
      page.button.style.opacity = '0';
      expect(dom.isVisible(page.button)).toBe(false);
    });

    it('returns false for zero-width/height element', () => {
      page.button.style.width = '0';
      page.button.style.height = '0';
      page.button.style.overflow = 'hidden';
      // Re-patch BCR to reflect new dimensions
      page.button.getBoundingClientRect = () => ({
        x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
      });
      expect(dom.isVisible(page.button)).toBe(false);
    });
  });

  describe('getLabel', () => {
    let page;

    beforeEach(() => {
      page = createTestPage();
    });

    afterEach(() => {
      if (page) cleanupTestPage(page.container);
    });

    it('returns innerText for element with text', () => {
      expect(dom.getLabel(page.button)).toBe('Submit Form');
    });

    it('returns placeholder for input with placeholder', () => {
      expect(dom.getLabel(page.input)).toBe('Enter email');
    });

    it('returns aria-label for element with aria-label', () => {
      const el = createEl('div', { 'aria-label': 'My Label' });
      expect(dom.getLabel(el)).toBe('My Label');
    });

    it('returns title for element with title', () => {
      const el = createEl('span', { title: 'My Title' });
      expect(dom.getLabel(el)).toBe('My Title');
    });

    it('returns name for element with name attribute', () => {
      const el = createEl('input', { type: 'hidden', name: 'csrf_token' });
      expect(dom.getLabel(el)).toBe('csrf_token');
    });

    it('returns "No label" for element with no label attributes', () => {
      const el = document.createElement('div');
      expect(dom.getLabel(el)).toBe('No label');
    });
  });

  describe('getUniqueSelector', () => {
    it('returns [data-testid] for element with data-testid', () => {
      const el = createEl('button', { 'data-testid': 'submit' });
      expect(dom.getUniqueSelector(el)).toBe('[data-testid="submit"]');
    });

    it('returns [aria-label] for element with aria-label', () => {
      const el = createEl('button', { 'aria-label': 'Close' });
      expect(dom.getUniqueSelector(el)).toBe('[aria-label="Close"]');
    });

    it('returns #id for element with non-generic id', () => {
      const el = createEl('div', { id: 'unique-id-123' });
      expect(dom.getUniqueSelector(el)).toBe('#unique-id-123');
    });

    it('skips generic ids', () => {
      const el = createEl('div', { id: 'container' });
      const selector = dom.getUniqueSelector(el);
      expect(selector).not.toBe('#container');
    });

    it('returns input[name] for input with name', () => {
      const el = createEl('input', { type: 'text', name: 'username' });
      expect(dom.getUniqueSelector(el)).toBe('input[name="username"]');
    });
  });

  describe('scanDocument', () => {
    let page;

    beforeEach(() => {
      page = createTestPage();
    });

    afterEach(() => {
      if (page) cleanupTestPage(page.container);
    });

    it('finds interactive elements in the DOM', () => {
      const elements = [];
      const selectorMap = new Map();
      dom.scanDocument(document, elements, selectorMap, '');

      const types = elements.map(e => e.tag);
      expect(types).toContain('BUTTON');
      expect(types).toContain('INPUT');
      expect(types).toContain('A');
      expect(types).toContain('SELECT');
    });

    it('skips hidden elements', () => {
      const elements = [];
      const selectorMap = new Map();
      dom.scanDocument(document, elements, selectorMap, '');

      const hiddenBtn = elements.find(e => e.selector.includes('hidden-btn'));
      expect(hiddenBtn).toBeUndefined();
    });

    it('produces selectors for each element', () => {
      const elements = [];
      const selectorMap = new Map();
      dom.scanDocument(document, elements, selectorMap, '');

      elements.forEach(el => {
        expect(el.selector).toBeDefined();
        expect(el.selector.length).toBeGreaterThan(0);
        expect(el.index).toBeDefined();
        expect(el.text).toBeDefined();
      });
    });
  });
});
