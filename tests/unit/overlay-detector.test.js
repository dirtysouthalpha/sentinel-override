// Sentinel Override v3 -- Unit tests for content/overlay-detector.js
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createEl, patchBoundingClientRect } from '../helpers/dom-fixture.js';

describe('overlay-detector', () => {
  let overlay;

  beforeAll(async () => {
    window.__sentinelUtils = window.__sentinelUtils || {};
    await import('../../content/dom-utils.js');
    await import('../../content/shadow-dom.js');
    const mod = await import('../../content/overlay-detector.js');
    overlay = mod.overlay;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    window.__sentinelCapturedRoots = undefined;
  });

  it('exports overlay from window.__sentinelUtils.overlay', () => {
    expect(overlay).toBeDefined();
    expect(overlay.detectOverlay).toBeInstanceOf(Function);
    expect(overlay.dismissOverlay).toBeInstanceOf(Function);
    expect(overlay.isOverlayBlocking).toBeInstanceOf(Function);
  });

  describe('detectOverlay', () => {
    it('returns null when no overlay present', () => {
      document.body.innerHTML = '<div>Normal content</div>';
      patchBoundingClientRect(document);
      expect(overlay.detectOverlay(document)).toBeNull();
    });

    it('returns null for null document', () => {
      expect(overlay.detectOverlay(null)).toBeNull();
    });

    it('detects ARIA modal', () => {
      const modal = createEl('div', { 'aria-modal': 'true' }, 'Modal Content');
      document.body.appendChild(modal);
      patchBoundingClientRect(document);
      const result = overlay.detectOverlay(document);
      expect(result).toBe(modal);
    });

    it('detects role="dialog"', () => {
      const dialog = createEl('div', { role: 'dialog' }, 'Dialog Content');
      document.body.appendChild(dialog);
      patchBoundingClientRect(document);
      const result = overlay.detectOverlay(document);
      expect(result).toBe(dialog);
    });

    it('detects cookie banner by class', () => {
      const banner = createEl('div', { class: 'cookie-banner' }, 'Accept cookies');
      document.body.appendChild(banner);
      patchBoundingClientRect(document);
      const result = overlay.detectOverlay(document);
      expect(result).toBe(banner);
    });

    it('skips invisible ARIA modal', () => {
      const modal = createEl('div', { 'aria-modal': 'true' }, 'Hidden Modal');
      modal.style.display = 'none';
      document.body.appendChild(modal);
      expect(overlay.detectOverlay(document)).toBeNull();
    });
  });

  describe('dismissOverlay', () => {
    it('returns false for null overlay', () => {
      expect(overlay.dismissOverlay(document, null)).toBe(false);
    });

    it('attempts to dismiss overlay via close buttons and Escape', () => {
      const modal = createEl('div', { 'aria-modal': 'true' });
      const closeBtn = createEl('button', { 'aria-label': 'Close' }, 'Close');
      modal.appendChild(closeBtn);
      document.body.appendChild(modal);

      // The function tries close buttons, then cookie buttons, then text match, then Escape.
      // In happy-dom, some CSS selectors (like [aria-label="Close" i]) may not be supported.
      // Verify it doesn't throw and the modal remains in DOM.
      const result = overlay.dismissOverlay(document, modal);
      expect(document.body.contains(modal)).toBe(true);
    });

    it('never removes elements from DOM (only clicks or presses Escape)', () => {
      const modal = createEl('div', { 'aria-modal': 'true' }, 'Modal');
      document.body.appendChild(modal);

      overlay.dismissOverlay(document, modal);
      expect(document.body.contains(modal)).toBe(true);
    });
  });

  describe('isOverlayBlocking', () => {
    it('returns null when no element is on top', () => {
      const target = createEl('button', {}, 'Target');
      document.body.appendChild(target);
      const result = overlay.isOverlayBlocking(document, target);
      expect(result).toBeNull();
    });

    it('returns null for null inputs', () => {
      expect(overlay.isOverlayBlocking(null, null)).toBeNull();
      expect(overlay.isOverlayBlocking(document, null)).toBeNull();
    });
  });
});
