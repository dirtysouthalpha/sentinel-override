/**
 * Tests for popup-modules/activity-feed.js
 * Uses linkedom to provide a real DOM environment.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { parseHTML } from 'linkedom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FEED_SOURCE = readFileSync(
  join(__dirname, '..', 'popup-modules', 'activity-feed.js'),
  'utf-8'
);

/**
 * Create a linkedom-based DOM context with activity-feed.js loaded.
 */
function createFeedContext(extraBodyHtml) {
  const bodyHtml = extraBodyHtml || '<div id="input-area"></div>';
  const { window } = parseHTML(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);

  const sandbox = {
    window,
    document: window.document,
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
    setTimeout: () => {},
    clearTimeout: () => {},
  };

  vm.createContext(sandbox);
  vm.runInContext(FEED_SOURCE, sandbox);

  return {
    sandbox,
    window,
    document: window.document,
    initActivityFeed: sandbox.window.initActivityFeed,
    addFeedEvent: sandbox.window.addFeedEvent,
    clearFeed: sandbox.window.clearFeed,
    setFeedVisible: sandbox.window.setFeedVisible,
    toggleFeedCollapse: sandbox.window.toggleFeedCollapse,
    getFeedEntryCount: sandbox.window.getFeedEntryCount,
    escapeHtml: sandbox.window.escapeHtml,
    FEED_ICONS: sandbox.window.FEED_ICONS,
    FEED_COLORS: sandbox.window.FEED_COLORS,
  };
}

describe('activity-feed.js', () => {
  describe('initActivityFeed', () => {
    it('should create the feed container if it does not exist', () => {
      const ctx = createFeedContext();
      const feed = ctx.initActivityFeed();
      expect(feed).toBeTruthy();
      expect(feed.id).toBe('activity-feed');
      expect(feed.className).toContain('activity-feed');
    });

    it('should return existing feed on subsequent calls (idempotent)', () => {
      const ctx = createFeedContext();
      const feed1 = ctx.initActivityFeed();
      const feed2 = ctx.initActivityFeed();
      expect(feed1).toBe(feed2);
    });

    it('should insert before input-area when present', () => {
      const ctx = createFeedContext();
      const feed = ctx.initActivityFeed();
      const inputArea = ctx.document.getElementById('input-area');
      // The feed should be the previousSibling of input-area
      expect(feed.nextSibling).toBe(inputArea);
    });

    it('should create a header and list container', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      const feed = ctx.document.getElementById('activity-feed');
      const header = feed.querySelector('.activity-feed-header');
      const list = feed.querySelector('.activity-feed-list');
      expect(header).toBeTruthy();
      expect(list).toBeTruthy();
    });
  });

  describe('addFeedEvent', () => {
    it('should create a feed entry with correct category icon', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('observe', 'Test observation');
      const entries = ctx.document.querySelectorAll('.feed-entry');
      expect(entries.length).toBe(1);
      const icon = entries[0].querySelector('.feed-icon');
      expect(icon.innerHTML).toContain('\u{1F50D}'); // observe icon
    });

    it('should include a timestamp in the entry', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('thinking', 'Analyzing');
      const timeEl = ctx.document.querySelector('.feed-time');
      expect(timeEl).toBeTruthy();
      // Timestamp should match HH:MM:SS format
      expect(timeEl.innerHTML).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should escape HTML in labels to prevent XSS', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('note', '<script>alert(1)</script>');
      const labelEl = ctx.document.querySelector('.feed-label');
      expect(labelEl.innerHTML).not.toContain('<script>');
      expect(labelEl.innerHTML).toContain('&lt;script&gt;');
    });

    it('should render detail when provided', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('acting', 'Clicking button', 'Button text: Submit');
      const detailEl = ctx.document.querySelector('.feed-detail');
      expect(detailEl).toBeTruthy();
      expect(detailEl.textContent).toContain('Button text: Submit');
    });

    it('should stringify object details (truncated to 200 chars)', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      const obj = { type: 'navigate', url: 'https://example.com' };
      ctx.addFeedEvent('navigate', 'Navigating', obj);
      const detailEl = ctx.document.querySelector('.feed-detail');
      expect(detailEl).toBeTruthy();
      expect(detailEl.textContent).toContain('navigate');
      expect(detailEl.textContent).toContain('example.com');
    });

    it('should not render detail element when detail is null', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('result', 'Done');
      const detailEl = ctx.document.querySelector('.feed-detail');
      expect(detailEl).toBeFalsy();
    });

    it('should apply error color for error category', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('error', 'Something broke');
      const labelEl = ctx.document.querySelector('.feed-label');
      expect(labelEl.getAttribute('style') || labelEl.style.cssText || '').toContain('#f44336');
    });

    it('should use bullet for unknown category', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('unknown_cat', 'Mystery event');
      const icon = ctx.document.querySelector('.feed-icon');
      expect(icon.innerHTML).toBe('\u2022'); // bullet
    });
  });

  describe('max entry limit', () => {
    it('should keep at most 50 entries', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      // Add 60 entries
      for (let i = 0; i < 60; i++) {
        ctx.addFeedEvent('note', `Entry ${i}`);
      }
      const entries = ctx.document.querySelectorAll('.feed-entry');
      expect(entries.length).toBe(50);
    });

    it('should remove oldest entries when over limit', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      for (let i = 0; i < 55; i++) {
        ctx.addFeedEvent('note', `Entry ${i}`);
      }
      const entries = ctx.document.querySelectorAll('.feed-entry');
      // First visible should be Entry 5 (entries 0-4 removed)
      const firstLabel = entries[0].querySelector('.feed-label');
      expect(firstLabel.innerHTML).toContain('Entry 5');
      // Last should be Entry 54
      const lastLabel = entries[entries.length - 1].querySelector('.feed-label');
      expect(lastLabel.innerHTML).toContain('Entry 54');
    });
  });

  describe('clearFeed', () => {
    it('should remove all entries from the feed', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('note', 'A');
      ctx.addFeedEvent('note', 'B');
      ctx.addFeedEvent('note', 'C');
      expect(ctx.getFeedEntryCount()).toBe(3);
      ctx.clearFeed();
      expect(ctx.getFeedEntryCount()).toBe(0);
      const entries = ctx.document.querySelectorAll('.feed-entry');
      expect(entries.length).toBe(0);
    });

    it('should be safe to call when feed does not exist', () => {
      const ctx = createFeedContext();
      expect(() => ctx.clearFeed()).not.toThrow();
    });
  });

  describe('setFeedVisible', () => {
    it('should show feed when visible=true', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.setFeedVisible(true);
      const feed = ctx.document.getElementById('activity-feed');
      expect(feed.classList.contains('visible')).toBe(true);
    });

    it('should hide feed when visible=false', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.setFeedVisible(true);
      ctx.setFeedVisible(false);
      const feed = ctx.document.getElementById('activity-feed');
      expect(feed.classList.contains('visible')).toBe(false);
    });

    it('should be safe to call when feed does not exist', () => {
      const ctx = createFeedContext();
      expect(() => ctx.setFeedVisible(true)).not.toThrow();
    });
  });

  describe('toggleFeedCollapse', () => {
    it('should toggle collapsed class on feed', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      const feed = ctx.document.getElementById('activity-feed');
      expect(feed.classList.contains('collapsed')).toBe(false);
      ctx.toggleFeedCollapse();
      expect(feed.classList.contains('collapsed')).toBe(true);
      ctx.toggleFeedCollapse();
      expect(feed.classList.contains('collapsed')).toBe(false);
    });
  });

  describe('getFeedEntryCount', () => {
    it('should return 0 when no entries exist', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      expect(ctx.getFeedEntryCount()).toBe(0);
    });

    it('should return correct count after adding entries', () => {
      const ctx = createFeedContext();
      ctx.initActivityFeed();
      ctx.addFeedEvent('note', 'One');
      ctx.addFeedEvent('note', 'Two');
      expect(ctx.getFeedEntryCount()).toBe(2);
    });

    it('should return 0 when feed element does not exist', () => {
      const ctx = createFeedContext();
      expect(ctx.getFeedEntryCount()).toBe(0);
    });
  });

  describe('FEED_ICONS mapping', () => {
    it('should have all expected categories', () => {
      const ctx = createFeedContext();
      const icons = ctx.FEED_ICONS;
      const expected = [
        'observe', 'thinking', 'acting', 'result', 'error',
        'navigate', 'click', 'type', 'scroll', 'extract',
        'note', 'finish', 'wait',
      ];
      for (const cat of expected) {
        expect(icons[cat]).toBeTruthy();
        expect(typeof icons[cat]).toBe('string');
      }
    });
  });

  describe('FEED_COLORS mapping', () => {
    it('should have color values for main categories', () => {
      const ctx = createFeedContext();
      const colors = ctx.FEED_COLORS;
      expect(colors.observe).toBe('#4a9eff');
      expect(colors.thinking).toBe('#9b59b6');
      expect(colors.acting).toBe('#ff6b00');
      expect(colors.result).toBe('#4caf50');
      expect(colors.error).toBe('#f44336');
    });
  });

  describe('escapeHtml', () => {
    it('should escape ampersands', () => {
      const ctx = createFeedContext();
      expect(ctx.escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('should escape angle brackets', () => {
      const ctx = createFeedContext();
      expect(ctx.escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('should escape quotes', () => {
      const ctx = createFeedContext();
      expect(ctx.escapeHtml('"hello"')).toBe('&quot;hello&quot;');
      expect(ctx.escapeHtml("it's")).toBe('it&#039;s');
    });

    it('should return empty string for non-string input', () => {
      const ctx = createFeedContext();
      expect(ctx.escapeHtml(null)).toBe('');
      expect(ctx.escapeHtml(undefined)).toBe('');
      expect(ctx.escapeHtml(123)).toBe('');
    });
  });
});
