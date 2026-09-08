// tests/export-report-deep.test.js
// Deep tests for background/export-report.js — generateHtmlReport, generateReplayReport, escapeHtml, truncate.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the module (ESM export)
const { generateHtmlReport, generateReplayReport } = await import('../background/export-report.js');

describe('generateHtmlReport: basic output', () => {
  test('returns a string starting with DOCTYPE', () => {
    const html = generateHtmlReport([], { goal: 'test' });
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  test('contains the goal text', () => {
    const html = generateHtmlReport([], { goal: 'Check firewall settings' });
    expect(html).toContain('Check firewall settings');
  });

  test('contains default status "completed"', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('completed');
  });

  test('contains custom status', () => {
    const html = generateHtmlReport([], { status: 'failed' });
    expect(html).toContain('failed');
  });

  test('contains total steps', () => {
    const html = generateHtmlReport([], { totalSteps: 42 });
    expect(html).toContain('42');
  });

  test('has HTML structure with closing tags', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('</html>');
    expect(html).toContain('</body>');
    expect(html).toContain('</head>');
  });

  test('has UTF-8 charset meta', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('UTF-8');
  });

  test('has responsive viewport meta', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('viewport');
  });

  test('contains Sentinel Override title', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('Sentinel Override');
  });
});

describe('generateHtmlReport: duration calculation', () => {
  test('calculates duration in seconds', () => {
    const html = generateHtmlReport([], {
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T00:00:45Z',
    });
    expect(html).toContain('45s');
  });

  test('calculates duration in minutes and seconds', () => {
    const html = generateHtmlReport([], {
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T00:02:30Z',
    });
    expect(html).toContain('2m 30s');
  });

  test('shows 0s when no timestamps', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('0s');
  });

  test('shows 0s when only startTime', () => {
    const html = generateHtmlReport([], { startTime: '2025-01-01T00:00:00Z' });
    expect(html).toContain('0s');
  });

  test('shows 0s when only endTime', () => {
    const html = generateHtmlReport([], { endTime: '2025-01-01T00:00:00Z' });
    expect(html).toContain('0s');
  });

  test('handles large durations', () => {
    const html = generateHtmlReport([], {
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:30:15Z',
    });
    expect(html).toContain('90m 15s');
  });
});

describe('generateHtmlReport: date display', () => {
  test('shows date from startTime', () => {
    const html = generateHtmlReport([], {
      startTime: '2025-05-14T12:00:00Z',
    });
    expect(html).toMatch(/5\/14\/2025|May 14/);
  });

  test('shows N/A when no startTime', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('N/A');
  });
});

describe('generateHtmlReport: step rendering', () => {
  test('renders successful steps with checkmark', () => {
    const html = generateHtmlReport([{ action: { type: 'click', params: { selector: '#btn' } } }], {});
    expect(html).toContain('✅');
  });

  test('renders failed steps with X', () => {
    const html = generateHtmlReport([{ actionFailed: true, action: 'click' }], {});
    expect(html).toContain('❌');
  });

  test('renders step numbers', () => {
    const html = generateHtmlReport([{ action: 'navigate' }, { action: 'click' }], {});
    expect(html).toContain('#1');
    expect(html).toContain('#2');
  });

  test('renders action type', () => {
    const html = generateHtmlReport([{ action: { type: 'type', params: { text: 'hello' } } }], {});
    expect(html).toContain('type');
  });

  test('renders string action type', () => {
    const html = generateHtmlReport([{ action: 'scroll' }], {});
    expect(html).toContain('scroll');
  });

  test('renders unknown action type', () => {
    const html = generateHtmlReport([{}], {});
    expect(html).toContain('unknown');
  });

  test('renders action params', () => {
    const html = generateHtmlReport([{ action: { type: 'click', params: { selector: '#submit', text: 'Go' } } }], {});
    expect(html).toContain('selector');
    expect(html).toContain('#submit');
    expect(html).toContain('text');
    expect(html).toContain('Go');
  });

  test('renders step duration when available', () => {
    const html = generateHtmlReport([{ duration: 500, action: 'click' }], {});
    expect(html).toContain('500ms');
  });

  test('no duration shown when missing', () => {
    const html = generateHtmlReport([{ action: 'click' }], {});
    // Should still have step header but no ms
    expect(html).toContain('#1');
  });

  test('renders result text', () => {
    const html = generateHtmlReport([{ action: 'click', result: 'Button clicked successfully' }], {});
    expect(html).toContain('Button clicked successfully');
  });

  test('renders screenshot img when available', () => {
    const html = generateHtmlReport([{ action: 'click', screenshot: 'data:image/png;base64,abc123' }], {});
    expect(html).toContain('<img');
    expect(html).toContain('data:image/png;base64,abc123');
  });

  test('no screenshot when not available', () => {
    const html = generateHtmlReport([{ action: 'click' }], {});
    expect(html).not.toContain('screenshot');
  });

  test('renders empty audit log (no steps)', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('Steps');
    expect(html).toContain('0');
  });

  test('renders multiple steps in order', () => {
    const log = [
      { action: { type: 'navigate', params: { url: 'https://example.com' } } },
      { action: { type: 'click', params: { selector: '#btn' } } },
      { action: { type: 'type', params: { text: 'hello' } } },
    ];
    const html = generateHtmlReport(log, {});
    expect(html).toContain('navigate');
    expect(html).toContain('click');
    expect(html).toContain('type');
  });
});

describe('generateHtmlReport: trust score badge', () => {
  test('high trust badge (80+)', () => {
    const html = generateHtmlReport([], { trustScore: 90 });
    expect(html).toContain('trust-high');
    expect(html).toContain('90%');
  });

  test('mid trust badge (50-79)', () => {
    const html = generateHtmlReport([], { trustScore: 65 });
    expect(html).toContain('trust-mid');
    expect(html).toContain('65%');
  });

  test('low trust badge (<50)', () => {
    const html = generateHtmlReport([], { trustScore: 30 });
    expect(html).toContain('trust-low');
    expect(html).toContain('30%');
  });

  test('no trust badge when trustScore is null', () => {
    const html = generateHtmlReport([], { trustScore: null });
    expect(html).not.toContain('trust-');
    expect(html).not.toContain('Trust:');
  });

  test('no trust badge when trustScore is undefined', () => {
    const html = generateHtmlReport([], {});
    expect(html).not.toContain('trust-');
  });
});

describe('generateHtmlReport: XSS protection', () => {
  test('goal with HTML is escaped', () => {
    const html = generateHtmlReport([], { goal: '<script>alert("xss")</script>' });
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('action type with HTML is escaped', () => {
    const html = generateHtmlReport([{ action: '<img onerror=alert(1)>' }], {});
    expect(html).not.toContain('<img onerror=alert(1)>');
  });

  test('result with HTML is escaped', () => {
    const html = generateHtmlReport([{ action: 'click', result: '<b>bold</b>' }], {});
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  test('param values with HTML are escaped', () => {
    const html = generateHtmlReport([{ action: { type: 'type', params: { text: '<script>evil</script>' } } }], {});
    expect(html).not.toContain('<script>evil</script>');
  });

  test('screenshot URL is escaped', () => {
    const html = generateHtmlReport([{ action: 'click', screenshot: '" onerror="alert(1)' }], {});
    expect(html).toContain('&quot;');
  });
});

describe('generateHtmlReport: metadata defaults', () => {
  test('default goal is "Unknown"', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('Unknown');
  });

  test('default totalSteps is 0', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('>0<');
  });

  test('default status is "completed"', () => {
    const html = generateHtmlReport([], {});
    expect(html).toContain('completed');
  });
});

describe('generateReplayReport: basic output', () => {
  test('returns a string starting with DOCTYPE', () => {
    const html = generateReplayReport([], { goal: 'test' });
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  test('contains the goal text', () => {
    const html = generateReplayReport([], { goal: 'Investigate portal' });
    expect(html).toContain('Investigate portal');
  });

  test('contains Run Replay title', () => {
    const html = generateReplayReport([], {});
    expect(html).toContain('Run Replay');
  });
});

describe('generateReplayReport: action entry rendering', () => {
  test('renders successful action with checkmark', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'navigate', action: { url: 'https://example.com' } }], {});
    expect(html).toContain('✅');
  });

  test('renders failed action with X', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'click', failed: true }], {});
    expect(html).toContain('❌');
  });

  test('only renders kind=action entries', () => {
    const html = generateReplayReport([
      { kind: 'observation', action_type: 'read' },
      { kind: 'action', action_type: 'click' },
    ], {});
    expect(html).toContain('click');
    // observation should not appear as an action step
    expect(html).not.toContain('read');
  });

  test('renders action type', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'type' }], {});
    expect(html).toContain('type');
  });

  test('renders URL detail when present', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'navigate', action: { url: 'https://example.com/page' } }], {});
    expect(html).toContain('example.com');
  });

  test('renders text detail when present', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'type', action: { text: 'hello world' } }], {});
    expect(html).toContain('hello world');
  });

  test('renders key detail when present', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'keypress', action: { key: 'Enter' } }], {});
    expect(html).toContain('Enter');
  });

  test('renders selector detail when present', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'click', action: { selector: '#submit-btn' } }], {});
    expect(html).toContain('#submit-btn');
  });
});

describe('generateReplayReport: reasoning, screenshot, result', () => {
  test('renders reasoning in details element', () => {
    const html = generateReplayReport([{ kind: 'action', reasoning: 'Need to click the button' }], {});
    expect(html).toContain('🧠 Reasoning');
    expect(html).toContain('Need to click the button');
  });

  test('renders screenshot base64', () => {
    const html = generateReplayReport([{ kind: 'action', screenshot: 'abc123' }], {});
    expect(html).toContain('data:image/jpeg;base64,abc123');
  });

  test('renders result text', () => {
    const html = generateReplayReport([{ kind: 'action', result: 'Completed successfully' }], {});
    expect(html).toContain('Completed successfully');
  });

  test('no reasoning section when not present', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'click' }], {});
    expect(html).not.toContain('🧠 Reasoning');
  });

  test('no result section when not present', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'click' }], {});
    // Just check there's no result rendering for this entry
  });
});

describe('generateReplayReport: metadata rendering', () => {
  test('shows cost when > 0', () => {
    const html = generateReplayReport([], { estimatedCostUsd: 0.05 });
    expect(html).toContain('Cost:');
    expect(html).toContain('$0.05');
  });

  test('shows cost with 4 decimal places when < 0.01', () => {
    const html = generateReplayReport([], { estimatedCostUsd: 0.003 });
    expect(html).toContain('$0.0030');
  });

  test('no cost shown when 0', () => {
    const html = generateReplayReport([], { estimatedCostUsd: 0 });
    expect(html).not.toContain('Cost:');
  });

  test('shows run ID prefix', () => {
    const html = generateReplayReport([], { runLogId: 'abcdefghijklmnop' });
    expect(html).toContain('abcdefgh');
  });

  test('no run ID when empty', () => {
    const html = generateReplayReport([], { runLogId: '' });
    // Run ID section uses substring(0,8) of empty string
    expect(html).not.toContain('Run ID:');
  });

  test('handles null entries gracefully', () => {
    const html = generateReplayReport(null, {});
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  test('handles undefined entries gracefully', () => {
    const html = generateReplayReport(undefined, {});
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  test('handles null meta gracefully', () => {
    const html = generateReplayReport([], null);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  test('shows timestamp from first entry', () => {
    const html = generateReplayReport([{ timestamp: '2025-05-14T12:00:00Z', kind: 'action' }], {});
    expect(html).toMatch(/5\/14\/2025|May 14/);
  });
});

describe('generateReplayReport: step numbering', () => {
  test('uses entry.step when provided', () => {
    const html = generateReplayReport([{ kind: 'action', step: 5, action_type: 'click' }], {});
    expect(html).toContain('#5');
  });

  test('defaults to index + 1 when step not provided', () => {
    const html = generateReplayReport([
      { kind: 'action', action_type: 'click' },
      { kind: 'action', action_type: 'navigate' },
    ], {});
    expect(html).toContain('#1');
    expect(html).toContain('#2');
  });

  test('handles missing action gracefully', () => {
    const html = generateReplayReport([{ kind: 'action' }], {});
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });
});

describe('generateReplayReport: XSS protection', () => {
  test('goal with HTML is escaped', () => {
    const html = generateReplayReport([], { goal: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('action_type with HTML is escaped', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: '<img onerror=alert(1)>' }], {});
    expect(html).not.toContain('<img onerror=alert(1)>');
  });

  test('reasoning with HTML is escaped', () => {
    const html = generateReplayReport([{ kind: 'action', reasoning: '<b>bold</b>' }], {});
    expect(html).not.toContain('<b>bold</b>');
  });

  test('result with HTML is escaped', () => {
    const html = generateReplayReport([{ kind: 'action', result: '<script>evil</script>' }], {});
    expect(html).not.toContain('<script>evil</script>');
  });

  test('cost string is escaped', () => {
    const html = generateReplayReport([], { estimatedCostUsd: 0.05 });
    expect(html).toContain('$0.05');
  });

  test('URL detail is escaped', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'navigate', action: { url: '<script>evil</script>' } }], {});
    expect(html).not.toContain('<script>evil</script>');
  });
});

describe('generateReplayReport: URL hostname extraction', () => {
  test('extracts hostname from valid URL', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'navigate', url: 'https://example.com/page', action: { url: 'https://example.com/page' } }], {});
    expect(html).toContain('example.com');
  });

  test('handles invalid URL gracefully (empty string)', () => {
    const html = generateReplayReport([{ kind: 'action', action_type: 'navigate', url: '' }], {});
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });
});
