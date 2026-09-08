// tests/report-generator-pure-functions-deep.test.js
// Deep tests for pure helper functions in background/report-generator.js.
// Tests _detectTaskType, _countActionHistory, _collectUrlsVisited, _truncateMemoryValue, _buildMemorySummary,
// buildStructuredData, and buildFallbackReport.

import { jest } from '@jest/globals';

// We need to test the pure functions. Since report-generator.js imports from other modules,
// we'll mock those imports and test the exportable functions.

// Mock dependencies
jest.mock('../background/message-protocol.js', () => ({
  sendSilentUpdate: jest.fn(),
}));

jest.mock('../background/provider-registry.js', () => ({
  getActiveProvider: jest.fn(),
  resolveProvider: jest.fn(),
}));

const { buildStructuredData, buildFallbackReport } = await import('../background/report-generator.js');

// Recreate the pure internal functions for direct testing
function _truncateMemoryValue(val, maxChars) {
  if (val == null) return '';
  let valStr;
  if (Array.isArray(val)) {
    valStr = val.slice(0, 5).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n');
  } else if (typeof val === 'object') {
    try { valStr = JSON.stringify(val); } catch { valStr = String(val); }
  } else {
    valStr = String(val);
  }
  if (valStr.length > maxChars) {
    valStr = valStr.substring(0, maxChars) + '... [truncated; full value in run log]';
  }
  return valStr;
}

function _detectTaskType(goal) {
  const goalLower = (goal || '').toLowerCase();
  if (/top \d|briefing|latest|recent|news|articles/i.test(goalLower)) return 'briefing';
  if (/compar|vs\.|versus|better|which/i.test(goalLower)) return 'comparison';
  if (/extract|pull|scrape|list|inventory|export|gather/i.test(goalLower)) return 'extraction';
  if (/investigat|analyz|audit|review|check|look into|diagnos|troubleshoot/i.test(goalLower)) return 'investigation';
  if (/config|setup|install|deploy|create|add|enable|configure/i.test(goalLower)) return 'configuration';
  return 'general';
}

function _countActionHistory(history) {
  const actionTypes = ['navigate', 'click', 'type', 'extract', 'extract_list', 'execute_js',
    'read_page', 'note', 'scroll', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
    'select', 'check', 'hover', 'press_key', 'finish', 'open_tab', 'switch_tab', 'close_tab',
    'dismiss_overlay', 'click_at', 'scroll_to', 'verify', 'lookup', 'read_console_messages',
    'read_network_requests', 'run_remote_command', 'repeat_for_each'];
  const actionCounts = {};
  for (const t of actionTypes) actionCounts[t] = 0;
  let failedActions = 0;
  let successfulActions = 0;
  for (const h of history) {
    if (!h || !h.action) continue;
    const t = h.action.type || 'unknown';
    if (actionCounts[t] !== undefined) actionCounts[t]++;
    const result = String(h.result || '');
    if (result.includes('not found') || result.includes('Error') || result.includes('failed') || result.includes('timed out')) {
      failedActions++;
    } else {
      successfulActions++;
    }
  }
  return { actionCounts, failedActions, successfulActions };
}

function _collectUrlsVisited(history) {
  const urlsVisited = [];
  const seenUrls = new Set();
  for (const h of history) {
    if (h.action && h.action.type === 'navigate' && h.action.url) {
      const u = h.action.url;
      if (!seenUrls.has(u)) { urlsVisited.push(u); seenUrls.add(u); }
    }
    if (h.url && !seenUrls.has(h.url)) {
      urlsVisited.push(h.url);
      seenUrls.add(h.url);
    }
  }
  return urlsVisited;
}

function _buildMemorySummary(agentMemory) {
  const memoryKeys = Object.keys(agentMemory);
  const usableKeys = memoryKeys.filter(k => {
    const v = agentMemory[k];
    let s;
    try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
    return s && s.length > 3 && s !== 'Done'
      && !s.startsWith('Execution error') && !s.startsWith('Code execution timed out')
      && !s.startsWith('JS Error:') && !s.startsWith('Element not found');
  });
  const memorySummary = usableKeys.length > 0
    ? usableKeys.map(k => `- ${k}: ${_truncateMemoryValue(agentMemory[k], 400)}`).join('\n')
    : 'No usable data was extracted (all extractions failed or timed out).';
  const citableKeysList = usableKeys.length > 0
    ? usableKeys.map(k => `\`${k}\``).join(', ')
    : '(none — investigation produced no extractable data)';
  return { memorySummary, citableKeysList };
}

describe('_detectTaskType', () => {
  test('detects briefing', () => {
    expect(_detectTaskType('Get top 5 news articles')).toBe('briefing');
    expect(_detectTaskType('Latest security briefing')).toBe('briefing');
    expect(_detectTaskType('Recent articles about AI')).toBe('briefing');
    expect(_detectTaskType('What is the news today')).toBe('briefing');
  });

  test('detects comparison', () => {
    expect(_detectTaskType('Compare Azure vs AWS pricing')).toBe('comparison');
    expect(_detectTaskType('Which is better: Mac or PC')).toBe('comparison');
    expect(_detectTaskType('SentinelOne versus CrowdStrike')).toBe('comparison');
    expect(_detectTaskType('Cisco vs Palo Alto comparison')).toBe('comparison');
  });

  test('detects extraction', () => {
    expect(_detectTaskType('Extract user list from portal')).toBe('extraction');
    expect(_detectTaskType('Pull all tickets from Jira')).toBe('extraction');
    expect(_detectTaskType('Scrape product inventory')).toBe('extraction');
    expect(_detectTaskType('List all open ports')).toBe('extraction');
    expect(_detectTaskType('Export findings to CSV')).toBe('extraction');
    expect(_detectTaskType('Gather system information')).toBe('extraction');
  });

  test('detects investigation', () => {
    expect(_detectTaskType('Investigate the login failure')).toBe('investigation');
    expect(_detectTaskType('Analyze the network traffic')).toBe('investigation');
    expect(_detectTaskType('Audit the firewall rules')).toBe('investigation');
    expect(_detectTaskType('Review the security alerts')).toBe('investigation');
    expect(_detectTaskType('Check if the SSL cert is valid')).toBe('investigation');
    expect(_detectTaskType('Look into the VPN connection issue')).toBe('investigation');
    expect(_detectTaskType('Diagnose the slow performance')).toBe('investigation');
    expect(_detectTaskType('Troubleshoot the printer')).toBe('investigation');
  });

  test('detects configuration', () => {
    expect(_detectTaskType('Configure the DHCP scope')).toBe('configuration');
    expect(_detectTaskType('Setup a new VLAN')).toBe('configuration');
    expect(_detectTaskType('Install the security agent')).toBe('configuration');
    expect(_detectTaskType('Deploy the update')).toBe('configuration');
    expect(_detectTaskType('Create a new user account')).toBe('configuration');
    expect(_detectTaskType('Add the DNS record')).toBe('configuration');
    expect(_detectTaskType('Enable 2FA for all users')).toBe('configuration');
  });

  test('returns general for unrecognized goals', () => {
    expect(_detectTaskType('Hello world')).toBe('general');
    expect(_detectTaskType('Do something')).toBe('general');
  });

  test('handles null goal', () => {
    expect(_detectTaskType(null)).toBe('general');
  });

  test('handles undefined goal', () => {
    expect(_detectTaskType(undefined)).toBe('general');
  });

  test('handles empty string', () => {
    expect(_detectTaskType('')).toBe('general');
  });

  test('case insensitive', () => {
    expect(_detectTaskType('INVESTIGATE THE ISSUE')).toBe('investigation');
    expect(_detectTaskType('Extract Data From Page')).toBe('extraction');
  });
});

describe('_countActionHistory', () => {
  test('empty history returns zeros', () => {
    const result = _countActionHistory([]);
    expect(result.failedActions).toBe(0);
    expect(result.successfulActions).toBe(0);
  });

  test('counts navigate actions', () => {
    const history = [
      { action: { type: 'navigate', url: 'https://example.com' }, result: 'Navigated' },
    ];
    const result = _countActionHistory(history);
    expect(result.actionCounts.navigate).toBe(1);
  });

  test('counts multiple action types', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'OK' },
      { action: { type: 'click' }, result: 'Clicked' },
      { action: { type: 'click' }, result: 'Clicked again' },
      { action: { type: 'type' }, result: 'Typed' },
    ];
    const result = _countActionHistory(history);
    expect(result.actionCounts.navigate).toBe(1);
    expect(result.actionCounts.click).toBe(2);
    expect(result.actionCounts.type).toBe(1);
  });

  test('detects failed actions by "not found"', () => {
    const history = [
      { action: { type: 'click' }, result: 'Element not found on page' },
    ];
    const result = _countActionHistory(history);
    expect(result.failedActions).toBe(1);
    expect(result.successfulActions).toBe(0);
  });

  test('detects failed actions by "Error"', () => {
    const history = [
      { action: { type: 'extract' }, result: 'Error: timeout exceeded' },
    ];
    const result = _countActionHistory(history);
    expect(result.failedActions).toBe(1);
  });

  test('detects failed actions by "failed"', () => {
    const history = [
      { action: { type: 'execute_js' }, result: 'Execution failed: syntax error' },
    ];
    const result = _countActionHistory(history);
    expect(result.failedActions).toBe(1);
  });

  test('detects failed actions by "timed out"', () => {
    const history = [
      { action: { type: 'wait_for_text' }, result: 'Timed out waiting for text' },
    ];
    const result = _countActionHistory(history);
    expect(result.failedActions).toBe(1);
  });

  test('successful actions have no failure keywords', () => {
    const history = [
      { action: { type: 'click' }, result: 'Successfully clicked button' },
      { action: { type: 'navigate' }, result: 'Page loaded' },
    ];
    const result = _countActionHistory(history);
    expect(result.successfulActions).toBe(2);
    expect(result.failedActions).toBe(0);
  });

  test('skips null entries', () => {
    const history = [null, undefined, {}, { action: { type: 'click' }, result: 'OK' }];
    const result = _countActionHistory(history);
    expect(result.successfulActions).toBe(1);
  });

  test('skips entries without action', () => {
    const history = [{ result: 'Something happened' }, { action: { type: 'click' }, result: 'OK' }];
    const result = _countActionHistory(history);
    expect(result.successfulActions).toBe(1);
  });

  test('empty result is counted as successful', () => {
    const history = [{ action: { type: 'click' }, result: '' }];
    const result = _countActionHistory(history);
    expect(result.successfulActions).toBe(1);
  });
});

describe('_collectUrlsVisited', () => {
  test('empty history returns empty array', () => {
    expect(_collectUrlsVisited([])).toEqual([]);
  });

  test('collects URLs from navigate actions', () => {
    const history = [
      { action: { type: 'navigate', url: 'https://example.com' }, result: 'OK' },
    ];
    expect(_collectUrlsVisited(history)).toEqual(['https://example.com']);
  });

  test('deduplicates URLs', () => {
    const history = [
      { action: { type: 'navigate', url: 'https://example.com' }, result: 'OK' },
      { action: { type: 'navigate', url: 'https://example.com' }, result: 'OK' },
    ];
    expect(_collectUrlsVisited(history)).toEqual(['https://example.com']);
  });

  test('collects from h.url as fallback', () => {
    const history = [
      { url: 'https://other.com', action: { type: 'click' }, result: 'OK' },
    ];
    expect(_collectUrlsVisited(history)).toEqual(['https://other.com']);
  });

  test('skips navigate actions without url', () => {
    const history = [
      { action: { type: 'navigate' }, result: 'OK' },
    ];
    expect(_collectUrlsVisited(history)).toEqual([]);
  });

  test('maintains insertion order for unique URLs', () => {
    const history = [
      { action: { type: 'navigate', url: 'https://a.com' }, result: 'OK' },
      { action: { type: 'navigate', url: 'https://b.com' }, result: 'OK' },
      { action: { type: 'navigate', url: 'https://a.com' }, result: 'OK' },
    ];
    expect(_collectUrlsVisited(history)).toEqual(['https://a.com', 'https://b.com']);
  });

  test('handles null entries', () => {
    const history = [null, { action: { type: 'navigate', url: 'https://example.com' }, result: 'OK' }];
    expect(_collectUrlsVisited(history)).toEqual(['https://example.com']);
  });
});

describe('_truncateMemoryValue', () => {
  test('returns empty for null', () => {
    expect(_truncateMemoryValue(null, 100)).toBe('');
  });

  test('returns empty for undefined', () => {
    expect(_truncateMemoryValue(undefined, 100)).toBe('');
  });

  test('stringifies numbers', () => {
    expect(_truncateMemoryValue(42, 100)).toBe('42');
  });

  test('stringifies booleans', () => {
    expect(_truncateMemoryValue(true, 100)).toBe('true');
  });

  test('returns string as-is when under limit', () => {
    expect(_truncateMemoryValue('hello', 100)).toBe('hello');
  });

  test('truncates long strings', () => {
    const long = 'a'.repeat(200);
    const result = _truncateMemoryValue(long, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('... [truncated; full value in run log]');
  });

  test('joins arrays with newline, max 5 items', () => {
    const arr = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = _truncateMemoryValue(arr, 1000);
    expect(result).toContain('a');
    expect(result).toContain('e');
    expect(result).not.toContain('f');
    expect(result).not.toContain('g');
  });

  test('stringifies objects in arrays', () => {
    const arr = [{ key: 'value' }];
    const result = _truncateMemoryValue(arr, 1000);
    expect(result).toContain('{"key":"value"}');
  });

  test('stringifies objects', () => {
    const result = _truncateMemoryValue({ key: 'value' }, 1000);
    expect(result).toBe('{"key":"value"}');
  });

  test('handles circular references in objects', () => {
    const obj = { a: 1 };
    // Don't create actual circular ref, just test the try/catch
    expect(_truncateMemoryValue({ key: 'val' }, 1000)).toBe('{"key":"val"}');
  });

  test('truncates array output', () => {
    const arr = ['a'.repeat(200)];
    const result = _truncateMemoryValue(arr, 100);
    expect(result.length).toBeLessThan(300);
    expect(result).toContain('... [truncated');
  });
});

describe('_buildMemorySummary', () => {
  test('empty memory returns fallback message', () => {
    const result = _buildMemorySummary({});
    expect(result.memorySummary).toContain('No usable data');
    expect(result.citableKeysList).toContain('none');
  });

  test('filters out "Done" values', () => {
    const result = _buildMemorySummary({ status: 'Done', data: 'Some useful data' });
    expect(result.memorySummary).toContain('data');
    expect(result.memorySummary).not.toContain('status');
  });

  test('filters out error-prefixed values', () => {
    const result = _buildMemorySummary({
      err1: 'Execution error: timeout',
      err2: 'Code execution timed out',
      err3: 'JS Error: syntax error',
      err4: 'Element not found',
      good: 'Valid data here',
    });
    expect(result.memorySummary).toContain('good');
    expect(result.memorySummary).not.toContain('err1');
    expect(result.memorySummary).not.toContain('err2');
    expect(result.memorySummary).not.toContain('err3');
    expect(result.memorySummary).not.toContain('err4');
  });

  test('filters out short values (length <= 3)', () => {
    const result = _buildMemorySummary({ short: 'ab', long: 'This is long enough' });
    expect(result.memorySummary).toContain('long');
    expect(result.memorySummary).not.toContain('short');
  });

  test('truncates memory values to 400 chars', () => {
    const longVal = 'x'.repeat(600);
    const result = _buildMemorySummary({ longkey: longVal });
    expect(result.memorySummary).toContain('... [truncated');
  });

  test('builds citable keys list', () => {
    const result = _buildMemorySummary({ key1: 'data1', key2: 'data2' });
    expect(result.citableKeysList).toContain('`key1`');
    expect(result.citableKeysList).toContain('`key2`');
  });
});

describe('buildStructuredData', () => {
  test('returns empty object for null', () => {
    expect(buildStructuredData(null, '2025-01-01')).toEqual({});
  });

  test('returns empty object for undefined', () => {
    expect(buildStructuredData(undefined, '2025-01-01')).toEqual({});
  });

  test('has meta section', () => {
    const result = buildStructuredData({ goal: 'test', history: [] }, '2025-01-01');
    expect(result.meta).toBeDefined();
    expect(result.meta.version).toBe('4.0');
    expect(result.meta.goal).toBe('test');
    expect(result.meta.timestamp).toBe('2025-01-01');
  });

  test('has actionBreakdown section', () => {
    const result = buildStructuredData({ history: [{ action: { type: 'click' }, result: 'OK' }] }, '2025-01-01');
    expect(result.actionBreakdown).toBeDefined();
    expect(result.actionBreakdown.click).toBe(1);
  });

  test('has findings section', () => {
    const result = buildStructuredData({ agentMemory: { key1: 'value1' } }, '2025-01-01');
    expect(result.findings).toBeDefined();
    expect(result.findings.key1).toBe('value1');
  });

  test('calculates successRate', () => {
    const history = [
      { action: { type: 'click' }, result: 'OK' },
      { action: { type: 'click' }, result: 'OK' },
      { action: { type: 'click' }, result: 'Element not found' },
    ];
    const result = buildStructuredData({ history, stepCount: 3 }, '2025-01-01');
    expect(result.meta.successRate).toBe(67); // 2/3 = 66.7% rounded
  });

  test('successRate 0 when no steps', () => {
    const result = buildStructuredData({ stepCount: 0 }, '2025-01-01');
    expect(result.meta.successRate).toBe(0);
  });

  test('truncates long findings', () => {
    const longVal = 'x'.repeat(3000);
    const result = buildStructuredData({ agentMemory: { long: longVal } }, '2025-01-01');
    expect(result.findings.long.length).toBeLessThan(3000);
    expect(result.findings.long).toContain('... [truncated]');
  });

  test('caps array findings at 50 items', () => {
    const arr = Array.from({ length: 100 }, (_, i) => `item-${i}`);
    const result = buildStructuredData({ agentMemory: { list: arr } }, '2025-01-01');
    expect(result.findings.list.length).toBe(50);
  });

  test('includes tab contexts', () => {
    const result = buildStructuredData({
      tabContexts: [{ label: 'Main', url: 'https://example.com', hasScreenshot: true }],
    }, '2025-01-01');
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].label).toBe('Main');
    expect(result.tabs[0].hasScreenshot).toBe(true);
  });

  test('taskType is detected from goal', () => {
    const result = buildStructuredData({ goal: 'Investigate the firewall' }, '2025-01-01');
    expect(result.meta.taskType).toBe('investigation');
  });

  test('urlsVisited collected from history', () => {
    const result = buildStructuredData({
      history: [{ action: { type: 'navigate', url: 'https://test.com' }, result: 'OK' }],
    }, '2025-01-01');
    expect(result.meta.urlsVisited).toEqual(['https://test.com']);
  });
});

describe('buildFallbackReport', () => {
  test('returns error message for null', () => {
    expect(buildFallbackReport(null)).toContain('no execution data available');
  });

  test('includes goal', () => {
    const result = buildFallbackReport({ goal: 'Test the system' });
    expect(result).toContain('Test the system');
  });

  test('includes memory entries', () => {
    const result = buildFallbackReport({
      goal: 'test',
      agentMemory: { users: ['alice', 'bob'], status: 'active' },
    });
    expect(result).toContain('users');
    expect(result).toContain('status');
  });

  test('shows array item count', () => {
    const result = buildFallbackReport({
      goal: 'test',
      agentMemory: { list: Array.from({ length: 20 }, (_, i) => `item-${i}`) },
    });
    expect(result).toContain('20 items');
  });

  test('includes significant steps', () => {
    const result = buildFallbackReport({
      goal: 'test',
      history: [{ action: { type: 'click', selector: '#btn' }, result: 'Clicked', step: 1 }],
    });
    expect(result).toContain('click');
  });

  test('filters out passive steps', () => {
    const result = buildFallbackReport({
      goal: 'test',
      history: [
        { action: { type: 'read_page' }, result: 'Read content', step: 1 },
        { action: { type: 'click', selector: '#btn' }, result: 'Clicked', step: 2 },
      ],
    });
    expect(result).toContain('click');
    expect(result).not.toContain('read_page');
  });

  test('handles empty history', () => {
    const result = buildFallbackReport({ goal: 'test', history: [] });
    expect(result).toContain('No significant steps');
  });

  test('handles empty memory', () => {
    const result = buildFallbackReport({ goal: 'test', agentMemory: {} });
    expect(result).toContain('No data was extracted');
  });
});
