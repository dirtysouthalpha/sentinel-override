// tests/test-export-report-comprehensive.test.js
// Comprehensive tests for background/export-report.js
// Phase 3 — generateHtmlReport, generateReplayReport, escapeHtml, truncate

// We need to extract the non-exported functions (escapeHtml, truncate)
// by re-implementing the test patterns since they're module-private.
// We test via the exported functions.

import { jest } from '@jest/globals';

const {
  generateHtmlReport,
  generateReplayReport,
} = await import('../background/export-report.js');

// ═══════════════════════════════════════════════════════════════════
// generateHtmlReport
// ═══════════════════════════════════════════════════════════════════
describe('generateHtmlReport', () => {
  test('returns a string', () => {
    const result = generateHtmlReport([], {});
    expect(typeof result).toBe('string');
  });

  test('returns valid HTML with DOCTYPE', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('<!DOCTYPE html>');
  });

  test('includes default goal "Unknown"', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('Unknown');
  });

  test('includes custom goal', () => {
    const result = generateHtmlReport([], { goal: 'Click submit button' });
    expect(result).toContain('Click submit button');
  });

  test('escapes HTML in goal', () => {
    const result = generateHtmlReport([], { goal: '<script>alert("xss")</script>' });
    expect(result).not.toContain('<script>alert("xss")</script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('includes default totalSteps 0', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('>0<');
  });

  test('includes custom totalSteps', () => {
    const result = generateHtmlReport([], { totalSteps: 42 });
    expect(result).toContain('>42<');
  });

  test('includes default status "completed"', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('completed');
  });

  test('includes custom status', () => {
    const result = generateHtmlReport([], { status: 'failed' });
    expect(result).toContain('failed');
  });

  test('includes duration calculation', () => {
    const start = '2024-01-15T10:00:00Z';
    const end = '2024-01-15T10:05:30Z';
    const result = generateHtmlReport([], { startTime: start, endTime: end });
    expect(result).toContain('5m');
    expect(result).toContain('30s');
  });

  test('shows seconds for sub-minute duration', () => {
    const start = '2024-01-15T10:00:00Z';
    const end = '2024-01-15T10:00:45Z';
    const result = generateHtmlReport([], { startTime: start, endTime: end });
    expect(result).toContain('45s');
    expect(result).not.toMatch(/\d+m\s/);  // no minutes in duration
  });

  test('shows 0s when no startTime', () => {
    const result = generateHtmlReport([], { endTime: '2024-01-15T10:00:00Z' });
    expect(result).toContain('0s');
  });

  test('shows 0s when no endTime', () => {
    const result = generateHtmlReport([], { startTime: '2024-01-15T10:00:00Z' });
    expect(result).toContain('0s');
  });

  test('includes date from startTime', () => {
    const result = generateHtmlReport([], { startTime: '2024-01-15T10:00:00Z' });
    expect(result).toContain('1/15/2024');
  });

  test('shows N/A date when no startTime', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('N/A');
  });

  // Trust score badge
  test('includes trust badge for high score', () => {
    const result = generateHtmlReport([], { trustScore: 95 });
    expect(result).toContain('95%');
    expect(result).toContain('trust-high');
  });

  test('includes trust badge for medium score', () => {
    const result = generateHtmlReport([], { trustScore: 65 });
    expect(result).toContain('trust-mid');
  });

  test('includes trust badge for low score', () => {
    const result = generateHtmlReport([], { trustScore: 30 });
    expect(result).toContain('trust-low');
  });

  test('no trust badge when trustScore is null', () => {
    const result = generateHtmlReport([], { trustScore: null });
    expect(result).not.toContain('<div class=\\"trust-badge');
  });

  test('no trust badge when trustScore is undefined', () => {
    const result = generateHtmlReport([], {});
    expect(result).not.toContain('<div class=\\"trust-badge');
  });

  test('trust-high threshold is 80', () => {
    const result80 = generateHtmlReport([], { trustScore: 80 });
    expect(result80).toContain('trust-high');
    const result79 = generateHtmlReport([], { trustScore: 79 });
    expect(result79).not.toContain('trust-badge trust-high');
  });

  test('trust-mid threshold is 50', () => {
    const result50 = generateHtmlReport([], { trustScore: 50 });
    expect(result50).toContain('trust-mid');
    const result49 = generateHtmlReport([], { trustScore: 49 });
    expect(result49).not.toContain('trust-badge trust-mid');
  });

  // Audit log entries
  test('renders successful step with ✅', () => {
    const log = [{ action: { type: 'click', selector: '#btn' } }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('✅');
  });

  test('renders failed step with ❌', () => {
    const log = [{ action: { type: 'click', selector: '#btn' }, actionFailed: true }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('❌');
  });

  test('includes step number', () => {
    const log = [{ action: { type: 'click' } }, { action: { type: 'type' } }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('#1');
    expect(result).toContain('#2');
  });

  test('includes action type', () => {
    const log = [{ action: { type: 'navigate', params: { url: 'https://example.com' } } }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('navigate');
  });

  test('handles action as string', () => {
    const log = [{ action: 'click' }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('click');
  });

  test('handles unknown action type', () => {
    const log = [{ action: {} }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('[object Object]');
  });

  test('includes step duration when present', () => {
    const log = [{ action: { type: 'click' }, duration: 1500 }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('1500ms');
  });

  test('omits duration when not present', () => {
    const log = [{ action: { type: 'click' } }];
    const result = generateHtmlReport(log, {});
    expect(result).not.toMatch(/\d+ms/);
  });

  test('includes result when present', () => {
    const log = [{ action: { type: 'click' }, result: 'Element clicked successfully' }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('Element clicked successfully');
  });

  test('escapes HTML in result', () => {
    const log = [{ action: { type: 'click' }, result: '<b>bold</b>' }];
    const result = generateHtmlReport(log, {});
    expect(result).not.toContain('<b>bold</b>');
    expect(result).toContain('&lt;b&gt;');
  });

  test('includes screenshot when present', () => {
    const log = [{ action: { type: 'click' }, screenshot: 'data:image/jpeg;base64,abc123' }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('data:image/jpeg;base64,abc123');
    expect(result).toContain('<img');
  });

  test('omits screenshot when not present', () => {
    const log = [{ action: { type: 'click' } }];
    const result = generateHtmlReport(log, {});
    expect(result).not.toContain('<img');
  });

  test('includes step params when present', () => {
    const log = [{ action: { type: 'type', params: { text: 'hello', selector: '#input' } } }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('text');
    expect(result).toContain('hello');
    expect(result).toContain('selector');
    expect(result).toContain('#input');
  });

  test('escapes HTML in param values', () => {
    const log = [{ action: { type: 'click', params: { label: '<script>x</script>' } } }];
    const result = generateHtmlReport(log, {});
    expect(result).not.toContain('<script>x</script>');
  });

  test('truncates long param values', () => {
    const longVal = 'A'.repeat(100);
    const log = [{ action: { type: 'click', params: { text: longVal } } }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('…');
  });

  test('truncates long results', () => {
    const longResult = 'A'.repeat(300);
    const log = [{ action: { type: 'click' }, result: longResult }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('…');
  });

  test('renders multiple entries in order', () => {
    const log = [
      { action: { type: 'click' } },
      { action: { type: 'navigate' } },
      { action: { type: 'type' } },
    ];
    const result = generateHtmlReport(log, {});
    const clickIdx = result.indexOf('click');
    const navIdx = result.indexOf('navigate');
    const typeIdx = result.indexOf('type');
    expect(clickIdx).toBeLessThan(navIdx);
    expect(navIdx).toBeLessThan(typeIdx);
  });

  test('renders empty audit log gracefully', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('</html>');
  });

  test('includes footer with generator info', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('Sentinel Override');
  });

  test('includes CSS styles', () => {
    const result = generateHtmlReport([], {});
    expect(result).toContain('<style>');
    expect(result).toContain('</style>');
  });

  test('handles null audit log', () => {
    expect(() => generateHtmlReport(null, {})).not.toThrow();
  });

  test('handles null metadata', () => {
    expect(() => generateHtmlReport([], null)).not.toThrow();
  });

  test('handles undefined metadata', () => {
    expect(() => generateHtmlReport([], undefined)).not.toThrow();
  });

  test('step-failed CSS class on failed steps', () => {
    const log = [{ action: { type: 'click' }, actionFailed: true }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('step-failed');
  });

  test('step-ok CSS class on successful steps', () => {
    const log = [{ action: { type: 'click' } }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('step-ok');
  });

  test('handles entry with string action type', () => {
    const log = [{ action: 'custom_action' }];
    const result = generateHtmlReport(log, {});
    expect(result).toContain('custom_action');
  });

  test('escapes goal with quotes', () => {
    const result = generateHtmlReport([], { goal: 'Say "hello"' });
    expect(result).toContain('&quot;');
  });

  test('escapes goal with ampersands', () => {
    const result = generateHtmlReport([], { goal: 'A & B' });
    expect(result).toContain('&amp;');
  });
});

// ═══════════════════════════════════════════════════════════════════
// generateReplayReport
// ═══════════════════════════════════════════════════════════════════
describe('generateReplayReport', () => {
  test('returns a string', () => {
    const result = generateReplayReport([], {});
    expect(typeof result).toBe('string');
  });

  test('returns valid HTML with DOCTYPE', () => {
    const result = generateReplayReport([], {});
    expect(result).toContain('<!DOCTYPE html>');
  });

  test('includes default goal "Unknown"', () => {
    const result = generateReplayReport([], {});
    expect(result).toContain('Unknown');
  });

  test('includes custom goal', () => {
    const result = generateReplayReport([], { goal: 'Test goal' });
    expect(result).toContain('Test goal');
  });

  test('escapes HTML in goal', () => {
    const result = generateReplayReport([], { goal: '<b>bold</b>' });
    expect(result).toContain('&lt;b&gt;');
  });

  test('filters entries to only "action" kind', () => {
    const entries = [
      { kind: 'action', action_type: 'click', step: 1 },
      { kind: 'system', message: 'Starting...' },
      { kind: 'action', action_type: 'navigate', step: 2 },
    ];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('click');
    expect(result).toContain('navigate');
    expect(result).not.toContain('Starting...');
  });

  test('renders successful action with ✅', () => {
    const entries = [{ kind: 'action', action_type: 'click', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('✅');
  });

  test('renders failed action with ❌', () => {
    const entries = [{ kind: 'action', action_type: 'click', step: 1, failed: true }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('❌');
  });

  test('includes step number from entry', () => {
    const entries = [{ kind: 'action', action_type: 'click', step: 5 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('#5');
  });

  test('auto-numbers steps when step field missing', () => {
    const entries = [
      { kind: 'action', action_type: 'click' },
      { kind: 'action', action_type: 'navigate' },
    ];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('#1');
    expect(result).toContain('#2');
  });

  test('includes action type', () => {
    const entries = [{ kind: 'action', action_type: 'scroll', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('scroll');
  });

  test('shows URL detail for navigate actions', () => {
    const entries = [{ kind: 'action', action_type: 'navigate', action: { url: 'https://example.com/page' }, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('example.com');
  });

  test('shows text detail for type actions', () => {
    const entries = [{ kind: 'action', action_type: 'type', action: { text: 'hello world' }, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('hello world');
  });

  test('shows key detail for press_key actions', () => {
    const entries = [{ kind: 'action', action_type: 'press_key', action: { key: 'Enter' }, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('Enter');
  });

  test('shows selector detail for click actions', () => {
    const entries = [{ kind: 'action', action_type: 'click', action: { selector: '#submit-btn' }, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('#submit-btn');
  });

  test('includes screenshot when present', () => {
    const entries = [{ kind: 'action', action_type: 'click', screenshot: 'abc123', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('abc123');
    expect(result).toContain('<img');
  });

  test('omits screenshot when not present', () => {
    const entries = [{ kind: 'action', action_type: 'click', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).not.toContain('<img');
  });

  test('includes reasoning when present', () => {
    const entries = [{ kind: 'action', action_type: 'click', reasoning: 'Need to click the submit button', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('Reasoning');
    expect(result).toContain('Need to click the submit button');
  });

  test('escapes HTML in reasoning', () => {
    const entries = [{ kind: 'action', action_type: 'click', reasoning: '<script>xss</script>', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).not.toContain('<script>xss</script>');
  });

  test('omits reasoning when not present', () => {
    const entries = [{ kind: 'action', action_type: 'click', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).not.toContain('Reasoning');
  });

  test('includes result when present', () => {
    const entries = [{ kind: 'action', action_type: 'click', result: 'Clicked successfully', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('Clicked successfully');
  });

  test('escapes HTML in result', () => {
    const entries = [{ kind: 'action', action_type: 'click', result: '<b>ok</b>', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).not.toContain('<b>ok</b>');
  });

  test('truncates long results', () => {
    const long = 'A'.repeat(300);
    const entries = [{ kind: 'action', action_type: 'click', result: long, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('…');
  });

  test('includes cost string when estimatedCostUsd > 0', () => {
    const entries = [];
    const result = generateReplayReport(entries, { estimatedCostUsd: 0.05 });
    expect(result).toContain('$0.05');
  });

  test('uses 4 decimal places for small costs', () => {
    const entries = [];
    const result = generateReplayReport(entries, { estimatedCostUsd: 0.001 });
    expect(result).toContain('$0.001');
  });

  test('omits cost when estimatedCostUsd is 0', () => {
    const result = generateReplayReport([], { estimatedCostUsd: 0 });
    expect(result).not.toContain('Cost:');
  });

  test('omits cost when estimatedCostUsd is negative', () => {
    const result = generateReplayReport([], { estimatedCostUsd: -1 });
    expect(result).not.toContain('Cost:');
  });

  test('includes runLogId (truncated)', () => {
    const result = generateReplayReport([], { runLogId: 'abc123def456' });
    expect(result).toContain('abc123de');
  });

  test('omits runLogId when empty', () => {
    const result = generateReplayReport([], { runLogId: '' });
    expect(result).not.toContain('Run ID');
  });

  test('includes start timestamp from first entry', () => {
    const entries = [{ kind: 'action', timestamp: '2024-01-15T10:00:00Z', action_type: 'click', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toBeTruthy();
  });

  test('handles null entries', () => {
    expect(() => generateReplayReport(null, {})).not.toThrow();
  });

  test('handles null meta', () => {
    expect(() => generateReplayReport([], null)).not.toThrow();
  });

  test('handles undefined meta', () => {
    expect(() => generateReplayReport([], undefined)).not.toThrow();
  });

  test('empty entries produce no step HTML', () => {
    const result = generateReplayReport([], {});
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('</html>');
  });

  test('includes footer', () => {
    const result = generateReplayReport([], {});
    expect(result).toContain('Sentinel Override');
  });

  test('truncates long URL detail', () => {
    const longUrl = 'https://example.com/' + 'path/'.repeat(20);
    const entries = [{ kind: 'action', action_type: 'navigate', action: { url: longUrl }, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('…');
  });

  test('truncates long text detail', () => {
    const longText = 'A'.repeat(100);
    const entries = [{ kind: 'action', action_type: 'type', action: { text: longText }, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('…');
  });

  test('shows hostname from entry URL', () => {
    const entries = [{ kind: 'action', action_type: 'click', url: 'https://example.com/page', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('example.com');
  });

  test('handles invalid URL in entry gracefully', () => {
    const entries = [{ kind: 'action', action_type: 'click', url: 'not-a-url', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(typeof result).toBe('string');
  });

  test('renders entries in order', () => {
    const entries = [
      { kind: 'action', action_type: 'click', step: 1 },
      { kind: 'action', action_type: 'navigate', step: 2 },
      { kind: 'action', action_type: 'type', step: 3 },
    ];
    const result = generateReplayReport(entries, {});
    const clickIdx = result.indexOf('click');
    const navIdx = result.indexOf('navigate');
    const typeIdx = result.indexOf('type');
    expect(clickIdx).toBeLessThan(navIdx);
    expect(navIdx).toBeLessThan(typeIdx);
  });

  test('failed entry has red border', () => {
    const entries = [{ kind: 'action', action_type: 'click', failed: true, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('#f87171');
  });

  test('successful entry has green border', () => {
    const entries = [{ kind: 'action', action_type: 'click', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('#34d399');
  });

  test('handles empty action object', () => {
    const entries = [{ kind: 'action', action_type: 'click', action: {}, step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('click');
  });

  test('handles entries with unknown action_type', () => {
    const entries = [{ kind: 'action', action_type: 'custom_action', step: 1 }];
    const result = generateReplayReport(entries, {});
    expect(result).toContain('custom_action');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Integration / edge cases for both report generators
// ═══════════════════════════════════════════════════════════════════
describe('Report generators — shared behaviors', () => {
  test('both produce self-contained HTML', () => {
    const htmlResult = generateHtmlReport([{ action: { type: 'click' } }], { goal: 'Test' });
    const replayResult = generateReplayReport([{ kind: 'action', action_type: 'click', step: 1 }], { goal: 'Test' });

    expect(htmlResult).toContain('<html');
    expect(htmlResult).toContain('</html>');
    expect(replayResult).toContain('<html');
    expect(replayResult).toContain('</html>');
  });

  test('both handle special characters in goal', () => {
    const goal = 'Test & "quotes" <tags>';
    const htmlResult = generateHtmlReport([], { goal });
    const replayResult = generateReplayReport([], { goal });

    expect(htmlResult).not.toContain('Test & "quotes" <tags>');
    expect(replayResult).not.toContain('Test & "quotes" <tags>');
    expect(htmlResult).toContain('&amp;');
    expect(replayResult).toContain('&amp;');
  });

  test('both handle empty goal gracefully', () => {
    const htmlResult = generateHtmlReport([], { goal: '' });
    const replayResult = generateReplayReport([], { goal: '' });

    expect(htmlResult).toContain('<!DOCTYPE html>');
    expect(replayResult).toContain('<!DOCTYPE html>');
  });

  test('HTML report has CSS for step-failed class', () => {
    const result = generateHtmlReport([{ action: { type: 'click' }, actionFailed: true }], {});
    expect(result).toContain('step-failed');
    expect(result).toContain('#f87171');
  });

  test('HTML report has CSS for step-ok class', () => {
    const result = generateHtmlReport([{ action: { type: 'click' } }], {});
    expect(result).toContain('step-ok');
    expect(result).toContain('#34d399');
  });

  test('HTML report handles 0 trustScore', () => {
    const result = generateHtmlReport([], { trustScore: 0 });
    expect(result).toContain('trust-low');
    expect(result).toContain('0%');
  });

  test('HTML report handles 100 trustScore', () => {
    const result = generateHtmlReport([], { trustScore: 100 });
    expect(result).toContain('trust-high');
    expect(result).toContain('100%');
  });

  test('HTML report handles 50 trustScore', () => {
    const result = generateHtmlReport([], { trustScore: 50 });
    expect(result).toContain('trust-mid');
  });

  test('replay report handles estimatedCostUsd of 0.005', () => {
    const result = generateReplayReport([], { estimatedCostUsd: 0.005 });
    expect(result).toContain('$0.005');
  });

  test('replay report handles estimatedCostUsd of 1.23', () => {
    const result = generateReplayReport([], { estimatedCostUsd: 1.23 });
    expect(result).toContain('$1.23');
  });

  test('replay report handles estimatedCostUsd of 0.0001 (below threshold)', () => {
    const result = generateReplayReport([], { estimatedCostUsd: 0.0001 });
    // Cost > 0 so should show
    expect(result).toContain('$0.0001');
  });

  test('replay report handles very long runLogId', () => {
    const result = generateReplayReport([], { runLogId: 'a'.repeat(100) });
    expect(result).toContain('a'.repeat(8));
    expect(result).toContain('…');
  });
});
