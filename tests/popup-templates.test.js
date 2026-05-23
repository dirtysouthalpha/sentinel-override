// tests/popup-templates.test.js
// Unit tests for popup-modules/templates.js — filterTemplates, parseTags.
// These are the pure/testable functions from the module.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createSandbox() {
  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    setTimeout: () => {},
    clearTimeout: () => {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    chrome: {
      runtime: {
        sendMessage: (msg, cb) => { cb({ ok: true, data: [] }); },
        lastError: null,
      },
    },
    showToast: () => {},
    sanitizeHtml: (s) => s,
    escapeHtml: (s) => s,
    relativeTime: () => 'never',
    confirm: () => false,
  };
  sandbox.window = sandbox;
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/templates.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'templates.js' });
  script.runInContext(sandbox);
  return sandbox;
}

describe('parseTags', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('splits comma-separated tags', () => {
    expect(sandbox.parseTags('one, two, three')).toEqual(['one', 'two', 'three']);
  });

  test('trims whitespace from each tag', () => {
    expect(sandbox.parseTags('  a ,  b  , c ')).toEqual(['a', 'b', 'c']);
  });

  test('filters out empty strings', () => {
    expect(sandbox.parseTags('a,,b, ,c')).toEqual(['a', 'b', 'c']);
  });

  test('returns empty array for null', () => {
    expect(sandbox.parseTags(null)).toEqual([]);
  });

  test('returns empty array for undefined', () => {
    expect(sandbox.parseTags(undefined)).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(sandbox.parseTags('')).toEqual([]);
  });

  test('returns empty array for whitespace-only string', () => {
    expect(sandbox.parseTags('   ')).toEqual([]);
  });

  test('handles single tag', () => {
    expect(sandbox.parseTags('solo')).toEqual(['solo']);
  });
});

describe('filterTemplates', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  const templates = [
    { name: 'Network Scan', goal: 'Scan network', tags: ['network', 'scan'], updatedAt: 300 },
    { name: 'Disk Check', goal: 'Check disk space', tags: ['disk', 'maintenance'], updatedAt: 100 },
    { name: 'Network Alert', goal: 'Send alerts', tags: ['network', 'alert'], updatedAt: 200 },
    { name: 'Backup Runner', goal: 'Run backups', tags: ['backup'], updatedAt: 400 },
  ];

  test('returns all templates when no filters', () => {
    const result = sandbox.filterTemplates(templates, '', '');
    expect(result).toHaveLength(4);
  });

  test('filters by search term (name)', () => {
    const result = sandbox.filterTemplates(templates, 'network', '');
    expect(result).toHaveLength(2);
    expect(result.every(t => t.name.toLowerCase().includes('network'))).toBe(true);
  });

  test('filters by tag', () => {
    const result = sandbox.filterTemplates(templates, '', 'network');
    expect(result).toHaveLength(2);
  });

  test('combines search and tag filter', () => {
    const result = sandbox.filterTemplates(templates, 'scan', 'network');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Network Scan');
  });

  test('sorts by updatedAt descending', () => {
    const result = sandbox.filterTemplates(templates, '', '');
    expect(result[0].updatedAt).toBe(400);
    expect(result[1].updatedAt).toBe(300);
    expect(result[2].updatedAt).toBe(200);
    expect(result[3].updatedAt).toBe(100);
  });

  test('handles templates with missing updatedAt', () => {
    const noDate = [
      { name: 'A', tags: [] },
      { name: 'B', tags: [], updatedAt: 50 },
    ];
    const result = sandbox.filterTemplates(noDate, '', '');
    expect(result).toHaveLength(2);
  });

  test('handles templates without tags', () => {
    const noTags = [
      { name: 'A' },
      { name: 'B', tags: ['x'] },
    ];
    const result = sandbox.filterTemplates(noTags, '', 'x');
    expect(result).toHaveLength(1);
  });

  test('returns empty array for empty input', () => {
    const result = sandbox.filterTemplates([], '', '');
    expect(result).toHaveLength(0);
  });

  test('handles templates with null or undefined names', () => {
    const badNames = [
      { name: null, goal: 'test', tags: ['x'] },
      { name: undefined, goal: 'test', tags: ['y'] },
      { name: 'Valid Name', goal: 'test', tags: ['z'] },
    ];
    const result = sandbox.filterTemplates(badNames, '', '');
    // Should not crash, should handle null/undefined gracefully
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  test('search is case-insensitive ( searchTerm is pre-lowercased by loadTemplates)', () => {
    const templates = [
      { name: 'Network Scan', goal: 'test', tags: [], updatedAt: 100 },
      { name: 'network scan', goal: 'test', tags: [], updatedAt: 100 },
      { name: 'NETWORK SCAN', goal: 'test', tags: [], updatedAt: 100 },
    ];
    // searchTerm is already lowercased when passed to filterTemplates (see loadTemplates line 46)
    const result = sandbox.filterTemplates(templates, 'network', '');
    expect(result).toHaveLength(3);
  });

  test('handles special characters in search term', () => {
    const templates = [
      { name: 'Test: Special/Chars', goal: 'test', tags: [], updatedAt: 100 },
      { name: 'Test@Home', goal: 'test', tags: [], updatedAt: 100 },
    ];
    const result = sandbox.filterTemplates(templates, '@', '');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test@Home');
  });

  test('handles templates with missing tags property', () => {
    const noTagsProp = [
      { name: 'A', tags: ['x'] },
      { name: 'B' }, // no tags property
      { name: 'C', tags: null },
    ];
    const result = sandbox.filterTemplates(noTagsProp, '', 'x');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('A');
  });

  test('handles empty tag array', () => {
    const emptyTags = [
      { name: 'A', tags: [] },
      { name: 'B', tags: [] },
    ];
    const result = sandbox.filterTemplates(emptyTags, '', 'anything');
    expect(result).toHaveLength(0);
  });
});

describe('parseTags — edge cases', () => {
  let sandbox;
  beforeAll(() => { sandbox = loadModule(createSandbox()); });

  test('handles unicode tags', () => {
    expect(sandbox.parseTags('日本語, 🚀, test')).toEqual(['日本語', '🚀', 'test']);
  });

  test('handles tags with special characters', () => {
    expect(sandbox.parseTags('test@home, user-name, #tag')).toEqual(['test@home', 'user-name', '#tag']);
  });

  test('handles mixed separators (comma only)', () => {
    // Only commas are separators, not other delimiters
    expect(sandbox.parseTags('one,two;three:four')).toEqual(['one', 'two;three:four']);
  });

  test('handles trailing comma', () => {
    expect(sandbox.parseTags('a,b,c,')).toEqual(['a', 'b', 'c']);
  });

  test('handles leading comma', () => {
    expect(sandbox.parseTags(',a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('handles multiple consecutive commas', () => {
    expect(sandbox.parseTags('a,,,b,,,,c')).toEqual(['a', 'b', 'c']);
  });

  test('handles tags with numbers', () => {
    expect(sandbox.parseTags('test123, 456test, 789')).toEqual(['test123', '456test', '789']);
  });

  test('preserves tag casing', () => {
    expect(sandbox.parseTags('TEST, Test, test')).toEqual(['TEST', 'Test', 'test']);
  });

  test('handles very long single tag', () => {
    const longTag = 'a'.repeat(1000);
    expect(sandbox.parseTags(longTag)).toEqual([longTag]);
  });

  test('handles newlines in input', () => {
    expect(sandbox.parseTags('a\nb,c')).toEqual(['a\nb', 'c']);
  });

  test('handles tabs in input', () => {
    expect(sandbox.parseTags('a\tb,c')).toEqual(['a\tb', 'c']);
  });
});
