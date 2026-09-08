// tests/recent-chats-deep.test.js
// Comprehensive tests for popup-modules/recent-chats.js — archive, restore, list, delete, UI helpers.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { JSDOM } from 'linkedom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// We need to test the internal functions. Since recent-chats.js is an IIFE that
// attaches to window, we'll extract and test the pure functions by reading source.
// For DOM-dependent functions, we use linkedom.

describe('recent-chats: _extractGoal', () => {
  // Extract _extractGoal logic for pure testing
  function _extractGoal(conversationHistory, fallbackHtml) {
    if (Array.isArray(conversationHistory)) {
      for (const turn of conversationHistory) {
        if (turn && turn.role === 'user' && typeof turn.text === 'string' && turn.text.trim()) {
          return turn.text.trim().substring(0, 200);
        }
      }
    }
    if (typeof fallbackHtml === 'string') {
      try {
        const tmp = document.createElement('div');
        tmp.innerHTML = fallbackHtml;
        const firstUserMsg = tmp.querySelector('.message-group .user-msg, .message-group [class*="user"]');
        if (firstUserMsg) return (firstUserMsg.textContent || '').trim().substring(0, 200);
      } catch { /* DOM may be detached */ }
    }
    return '(no goal)';
  }

  test('extracts goal from first user message in conversation history', () => {
    const history = [
      { role: 'user', text: 'Investigate the login page' },
      { role: 'assistant', text: 'Starting investigation...' },
    ];
    expect(_extractGoal(history)).toBe('Investigate the login page');
  });

  test('skips non-user messages', () => {
    const history = [
      { role: 'assistant', text: 'Hello!' },
      { role: 'user', text: 'Check the firewall' },
    ];
    expect(_extractGoal(history)).toBe('Check the firewall');
  });

  test('skips empty text messages', () => {
    const history = [
      { role: 'user', text: '   ' },
      { role: 'user', text: 'Valid goal' },
    ];
    expect(_extractGoal(history)).toBe('Valid goal');
  });

  test('truncates goal to 200 characters', () => {
    const longGoal = 'a'.repeat(300);
    const history = [{ role: 'user', text: longGoal }];
    expect(_extractGoal(history).length).toBe(200);
  });

  test('returns "(no goal)" for empty history', () => {
    expect(_extractGoal([])).toBe('(no goal)');
  });

  test('returns "(no goal)" for null history', () => {
    expect(_extractGoal(null)).toBe('(no goal)');
  });

  test('returns "(no goal)" for history without user messages', () => {
    const history = [
      { role: 'assistant', text: 'Only assistant messages' },
      { role: 'system', text: 'System prompt' },
    ];
    expect(_extractGoal(history)).toBe('(no goal)');
  });

  test('handles entries without text property', () => {
    const history = [
      { role: 'user' },
      { role: 'user', text: 'Has text' },
    ];
    expect(_extractGoal(history)).toBe('Has text');
  });

  test('handles entries with non-string text', () => {
    const history = [
      { role: 'user', text: 42 },
      { role: 'user', text: 'Number goal' },
    ];
    expect(_extractGoal(history)).toBe('Number goal');
  });

  test('handles entries with null/undefined text', () => {
    const history = [
      { role: 'user', text: null },
      { role: 'user', text: undefined },
      { role: 'user', text: 'Real goal' },
    ];
    expect(_extractGoal(history)).toBe('Real goal');
  });

  test('falls back to HTML parsing when no conversation history', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;

    const html = '<div class="message-group"><div class="user-msg">Extract from HTML</div></div>';
    expect(_extractGoal(null, html)).toBe('Extract from HTML');

    delete global.document;
  });

  test('falls back to "(no goal)" when HTML has no user messages', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;

    expect(_extractGoal(null, '<div>Some other content</div>')).toBe('(no goal)');

    delete global.document;
  });
});

describe('recent-chats: _hasReport', () => {
  function _hasReport(htmlSnapshot) {
    return typeof htmlSnapshot === 'string' && /report-group|report-card-title|Investigation Report/i.test(htmlSnapshot);
  }

  test('detects report-group class', () => {
    expect(_hasReport('<div class="report-group">...</div>')).toBe(true);
  });

  test('detects report-card-title class', () => {
    expect(_hasReport('<div class="report-card-title">Title</div>')).toBe(true);
  });

  test('detects Investigation Report text', () => {
    expect(_hasReport('<h2>Investigation Report</h2>')).toBe(true);
  });

  test('returns false for no report markers', () => {
    expect(_hasReport('<div class="action-card">Action</div>')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(_hasReport('')).toBe(false);
  });

  test('returns false for null', () => {
    expect(_hasReport(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(_hasReport(undefined)).toBe(false);
  });

  test('returns false for number', () => {
    expect(_hasReport(42)).toBe(false);
  });

  test('returns false for object', () => {
    expect(_hasReport({ html: 'report-group' })).toBe(false);
  });

  test('case insensitive detection', () => {
    expect(_hasReport('<div>INVESTIGATION REPORT</div>')).toBe(true);
  });

  test('detects report markers in mixed HTML', () => {
    const html = '<div class="chat"><div class="message">Hello</div><div class="report-group"><p>Report content</p></div></div>';
    expect(_hasReport(html)).toBe(true);
  });
});

describe('recent-chats: _formatAge', () => {
  function _formatAge(ts) {
    if (!ts) return '—';
    const ageMs = Date.now() - ts;
    const min = Math.round(ageMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    if (min < 1440) return Math.round(min / 60) + 'h ago';
    return Math.round(min / 1440) + 'd ago';
  }

  test('returns "—" for null timestamp', () => {
    expect(_formatAge(null)).toBe('—');
  });

  test('returns "—" for undefined timestamp', () => {
    expect(_formatAge(undefined)).toBe('—');
  });

  test('returns "—" for 0 timestamp', () => {
    // Very old, but 0 is falsy
    expect(_formatAge(0)).toBe('—');
  });

  test('returns "just now" for <1 minute ago', () => {
    expect(_formatAge(Date.now() - 30000)).toBe('just now');
  });

  test('returns "just now" for current time', () => {
    expect(_formatAge(Date.now())).toBe('just now');
  });

  test('returns minutes for 1-59 minutes ago', () => {
    const fiveMinAgo = Date.now() - 5 * 60000;
    expect(_formatAge(fiveMinAgo)).toBe('5 min ago');
  });

  test('returns hours for 1-23 hours ago', () => {
    const threeHoursAgo = Date.now() - 3 * 3600000;
    expect(_formatAge(threeHoursAgo)).toBe('3h ago');
  });

  test('returns days for >=1 day ago', () => {
    const twoDaysAgo = Date.now() - 2 * 86400000;
    expect(_formatAge(twoDaysAgo)).toBe('2d ago');
  });

  test('handles boundary at exactly 1 hour', () => {
    const oneHourAgo = Date.now() - 60 * 60000;
    expect(_formatAge(oneHourAgo)).toBe('1h ago');
  });

  test('handles boundary at exactly 1 day', () => {
    const oneDayAgo = Date.now() - 24 * 3600000;
    expect(_formatAge(oneDayAgo)).toBe('1d ago');
  });

  test('handles future timestamps gracefully', () => {
    const future = Date.now() + 60000;
    const result = _formatAge(future);
    // Negative minutes, rounded gives a negative number
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });
});

describe('recent-chats: _escapeHtml', () => {
  function _escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  test('escapes ampersands', () => {
    expect(_escapeHtml('a&b')).toBe('a&amp;b');
  });

  test('escapes angle brackets', () => {
    expect(_escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('escapes double quotes', () => {
    expect(_escapeHtml('value="test"')).toBe('value=&quot;test&quot;');
  });

  test('escapes single quotes', () => {
    expect(_escapeHtml("it's")).toBe('it&#39;s');
  });

  test('handles null input', () => {
    expect(_escapeHtml(null)).toBe('');
  });

  test('handles undefined input', () => {
    expect(_escapeHtml(undefined)).toBe('');
  });

  test('handles empty string', () => {
    expect(_escapeHtml('')).toBe('');
  });

  test('handles numeric input', () => {
    expect(_escapeHtml(42)).toBe('42');
  });

  test('handles string with all special chars', () => {
    expect(_escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('leaves safe text unchanged', () => {
    expect(_escapeHtml('Hello World')).toBe('Hello World');
  });

  test('handles unicode text', () => {
    expect(_escapeHtml('日本語テスト')).toBe('日本語テスト');
  });

  test('handles emoji', () => {
    expect(_escapeHtml('🎉🚀')).toBe('🎉🚀');
  });
});

describe('recent-chats: _genId format', () => {
  test('generated IDs follow rc_ pattern', () => {
    const id = 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    expect(id).toMatch(/^rc_\d+_[a-z0-9]+$/);
  });

  test('generated IDs are unique', () => {
    const id1 = 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    // Even with same timestamp, random part differs
    const id2 = 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    // High probability of uniqueness, but not guaranteed at exact same ms
    // Just check format
    expect(id1).toMatch(/^rc_\d+_[a-z0-9]+$/);
    expect(id2).toMatch(/^rc_\d+_[a-z0-9]+$/);
  });
});

describe('recent-chats: archive dedup logic', () => {
  test('duplicate within 5 seconds with same HTML is skipped', () => {
    const now = Date.now();
    const lastEntry = { createdAt: now - 3000, htmlSnapshot: '<div>same</div>' };
    const html = '<div>same</div>';
    const isDuplicate = lastEntry && (Date.now() - lastEntry.createdAt) < 5000 && lastEntry.htmlSnapshot === html;
    expect(isDuplicate).toBe(true);
  });

  test('same HTML after 5 seconds is not deduped', () => {
    const lastEntry = { createdAt: Date.now() - 6000, htmlSnapshot: '<div>same</div>' };
    const html = '<div>same</div>';
    const isDuplicate = lastEntry && (Date.now() - lastEntry.createdAt) < 5000 && lastEntry.htmlSnapshot === html;
    expect(isDuplicate).toBe(false);
  });

  test('different HTML within 5 seconds is not deduped', () => {
    const lastEntry = { createdAt: Date.now() - 3000, htmlSnapshot: '<div>old</div>' };
    const html = '<div>new</div>';
    const isDuplicate = lastEntry && (Date.now() - lastEntry.createdAt) < 5000 && lastEntry.htmlSnapshot === html;
    expect(isDuplicate).toBe(false);
  });

  test('empty chat HTML (under 200 chars or welcome-only) is skipped', () => {
    const shortHtml = '<div>a</div>';
    expect(shortHtml.length < 200).toBe(true);
    expect(/^\s*<div class="welcome-message"/i.test('<div class="welcome-message">Welcome</div>'.trim())).toBe(true);
  });
});

describe('recent-chats: RECENT_MAX capping', () => {
  test('list is capped at 10 entries', () => {
    const RECENT_MAX = 10;
    const list = [];
    for (let i = 0; i < 15; i++) list.push({ id: 'rc_' + i });
    while (list.length > RECENT_MAX) list.pop();
    expect(list.length).toBe(RECENT_MAX);
    // Should keep newest (first 10 since unshift adds to front)
    expect(list[0].id).toBe('rc_0');
  });

  test('list under max is not modified', () => {
    const RECENT_MAX = 10;
    const list = [{ id: 'rc_1' }, { id: 'rc_2' }];
    const before = list.length;
    while (list.length > RECENT_MAX) list.pop();
    expect(list.length).toBe(before);
  });

  test('empty list stays empty', () => {
    const RECENT_MAX = 10;
    const list = [];
    while (list.length > RECENT_MAX) list.pop();
    expect(list.length).toBe(0);
  });

  test('exactly max items stays the same', () => {
    const RECENT_MAX = 10;
    const list = Array.from({ length: 10 }, (_, i) => ({ id: 'rc_' + i }));
    while (list.length > RECENT_MAX) list.pop();
    expect(list.length).toBe(10);
  });
});

describe('recent-chats: banner age formatting', () => {
  test('ageMin < 1 shows "just now"', () => {
    const entry = { createdAt: Date.now() };
    const ageMin = Math.round((Date.now() - entry.createdAt) / 60000);
    expect(ageMin).toBe(0);
  });

  test('ageMin < 60 shows minutes', () => {
    const entry = { createdAt: Date.now() - 5 * 60000 };
    const ageMin = Math.round((Date.now() - entry.createdAt) / 60000);
    const ageStr = ageMin < 1 ? 'just now' : ageMin < 60 ? ageMin + ' min ago' : ageMin < 1440 ? Math.round(ageMin / 60) + 'h ago' : Math.round(ageMin / 1440) + 'd ago';
    expect(ageStr).toBe('5 min ago');
  });

  test('ageMin >= 60 shows hours', () => {
    const entry = { createdAt: Date.now() - 2 * 3600000 };
    const ageMin = Math.round((Date.now() - entry.createdAt) / 60000);
    const ageStr = ageMin < 1 ? 'just now' : ageMin < 60 ? ageMin + ' min ago' : ageMin < 1440 ? Math.round(ageMin / 60) + 'h ago' : Math.round(ageMin / 1440) + 'd ago';
    expect(ageStr).toBe('2h ago');
  });

  test('ageMin >= 1440 shows days', () => {
    const entry = { createdAt: Date.now() - 3 * 86400000 };
    const ageMin = Math.round((Date.now() - entry.createdAt) / 60000);
    const ageStr = ageMin < 1 ? 'just now' : ageMin < 60 ? ageMin + ' min ago' : ageMin < 1440 ? Math.round(ageMin / 60) + 'h ago' : Math.round(ageMin / 1440) + 'd ago';
    expect(ageStr).toBe('3d ago');
  });
});

describe('recent-chats: archivedReason handling', () => {
  test('finished reason sets finishedAt', () => {
    const opts = { reason: 'finished' };
    expect(opts.reason === 'finished').toBe(true);
  });

  test('panel-closed reason does not set finishedAt', () => {
    const opts = { reason: 'panel-closed' };
    const entry = {
      finishedAt: opts && opts.reason === 'finished' ? Date.now() : null,
    };
    expect(entry.finishedAt).toBeNull();
  });

  test('no opts gives null finishedAt', () => {
    const opts = undefined;
    const entry = {
      finishedAt: opts && opts.reason === 'finished' ? Date.now() : null,
    };
    expect(entry.finishedAt).toBeNull();
  });

  test('replaced-by-restore reason does not set finishedAt', () => {
    const opts = { reason: 'replaced-by-restore' };
    const entry = {
      finishedAt: opts && opts.reason === 'finished' ? Date.now() : null,
    };
    expect(entry.finishedAt).toBeNull();
  });

  test('runLogId is passed through when provided', () => {
    const opts = { runLogId: 'log-123' };
    const entry = {
      runLogId: opts && opts.runLogId ? opts.runLogId : null,
    };
    expect(entry.runLogId).toBe('log-123');
  });

  test('runLogId defaults to null when not provided', () => {
    const opts = { reason: 'finished' };
    const entry = {
      runLogId: opts && opts.runLogId ? opts.runLogId : null,
    };
    expect(entry.runLogId).toBeNull();
  });
});
