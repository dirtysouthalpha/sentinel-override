// tests/collaboration.test.js
// Unit tests for background/collaboration.js — validateImport, exportReportAsMarkdown, parseVersion.

import { jest } from '@jest/globals';

const mockStorage = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({ sentinel_templates: { ...mockStorage } })),
      set: jest.fn(async (obj) => Object.assign(mockStorage, obj)),
    },
  },
  runtime: { sendMessage: jest.fn(async () => {}) },
};

jest.unstable_mockModule('../background/template-manager.js', () => ({
  listTemplates: jest.fn(async () => Object.values(mockStorage)),
  getTemplate: jest.fn(async (id) => mockStorage[id] || null),
  saveTemplate: jest.fn(async (id, t) => { mockStorage[id] = t; }),
  loadTemplates: jest.fn(async () => ({ ...mockStorage })),
  saveTemplates: jest.fn(async (t) => Object.assign(mockStorage, t)),
  extractParameters: jest.fn((goal) => {
    const matches = typeof goal === 'string' ? goal.match(/\{\{(\w+)\}\}/g) : null;
    return matches ? matches.map(m => typeof m === 'string' ? m.replace(/[{}]/g, '') : String(m)) : [];
  }),
}));

const {
  validateImport,
  exportReportAsMarkdown,
  exportTemplate,
  exportAllTemplates,
  importTemplates,
} = await import('../background/collaboration.js');

beforeEach(() => {
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  jest.clearAllMocks();
});

describe('validateImport', () => {
  test('rejects non-object input', () => {
    const result = validateImport(null);
    expect(result.safe).toBe(false);
    expect(result.errors).toContain('Invalid file: not a JSON object');
  });

  test('rejects invalid format field', () => {
    const result = validateImport({ format: 'wrong', version: '1.0.0' });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid format');
  });

  test('rejects missing version', () => {
    const result = validateImport({ format: 'sentinel-template' });
    expect(result.safe).toBe(false);
    expect(result.errors).toContain('Missing format version');
  });

  test('rejects version too old', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '0.0.9',
      template: { name: 'Test', goal: 'Do something useful' },
    });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('too old');
  });

  test('warns on newer major version', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '2.0.0',
      template: { name: 'Test', goal: 'Do something useful' },
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('newer');
  });

  test('rejects empty templates array in batch', () => {
    const result = validateImport({
      format: 'sentinel-template-batch',
      version: '1.0.0',
      templates: [],
    });
    expect(result.safe).toBe(false);
    expect(result.errors).toContain('No templates found in file');
  });

  test('rejects template with missing name', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { goal: 'Do something useful' },
    });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('missing name');
  });

  test('rejects template with missing goal', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { name: 'Test' },
    });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('missing goal');
  });

  test('rejects dangerous execute_js pattern', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { name: 'Evil', goal: 'Use execute_js to do something bad' },
    });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('execute_js');
  });

  test('rejects dangerous eval() pattern', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { name: 'Evil', goal: 'Call eval("alert(1)") on the page' },
    });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('eval()');
  });

  test('rejects dangerous document.cookie pattern', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { name: 'Evil', goal: 'Steal document.cookie for analysis' },
    });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('cookie');
  });

  test('accepts valid single template', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { name: 'Good Template', goal: 'Navigate to dashboard and extract data' },
    });
    expect(result.safe).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].name).toBe('Good Template');
  });

  test('accepts valid batch template', () => {
    const result = validateImport({
      format: 'sentinel-template-batch',
      version: '1.0.0',
      templates: [
        { name: 'Template A', goal: 'Do task A' },
        { name: 'Template B', goal: 'Do task B' },
      ],
    });
    expect(result.safe).toBe(true);
    expect(result.templates).toHaveLength(2);
  });

  test('extracts params from goal when not provided', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { name: 'Param Template', goal: 'Check {{device}} for {{issue}}' },
    });
    expect(result.safe).toBe(true);
    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.templates[0].params).toEqual(['device', 'issue']);
  });

  test('scans tag values for dangerous patterns', () => {
    const result = validateImport({
      format: 'sentinel-template',
      version: '1.0.0',
      template: { name: 'Tagged', goal: 'Normal task', tags: ['safe', 'document.cookie'] },
    });
    expect(result.safe).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('cookie');
  });
});

describe('exportReportAsMarkdown', () => {
  test('produces markdown with YAML frontmatter', () => {
    const report = {
      summary: 'Short summary',
      fullReport: '# Full Report\n\nDetailed content here.',
      goal: 'Test goal',
      timestamp: '2026-05-14T10:00:00.000Z',
    };
    const md = exportReportAsMarkdown(report);
    expect(md).toContain('---');
    expect(md).toContain('generator: sentinel-override');
    expect(md).toContain('goal: "Test goal"');
    expect(md).toContain('# Full Report');
  });

  test('escapes double quotes in YAML values', () => {
    const report = {
      summary: 'He said "hello"',
      fullReport: 'Content',
      goal: 'Test "quotes"',
      timestamp: '',
    };
    const md = exportReportAsMarkdown(report);
    expect(md).toContain('\\"hello\\"');
    expect(md).toContain('\\"quotes\\"');
  });

  test('throws on missing report', () => {
    expect(() => exportReportAsMarkdown(null)).toThrow('No report data provided');
    expect(() => exportReportAsMarkdown({})).toThrow('No report data provided');
  });

  test('uses defaults for missing optional fields', () => {
    const report = { fullReport: 'Content' };
    const md = exportReportAsMarkdown(report);
    expect(md).toContain('goal: "Unknown"');
    expect(md).toContain('Content');
  });
});

describe('exportTemplate', () => {
  test('exports a template by id', async () => {
    mockStorage['t1'] = { id: 't1', name: 'My Template', goal: 'Do something', params: [], tags: ['test'], createdAt: Date.now() };
    const result = await exportTemplate('t1');
    expect(result.format).toBe('sentinel-template');
    expect(result.template.name).toBe('My Template');
    expect(result.template.goal).toBe('Do something');
    expect(result.version).toBe('1.0.0');
  });

  test('throws on missing id', async () => {
    await expect(exportTemplate('')).rejects.toThrow('Template ID is required');
  });

  test('throws on not-found template', async () => {
    await expect(exportTemplate('nonexistent')).rejects.toThrow('Template not found');
  });
});

describe('exportAllTemplates', () => {
  test('exports all templates as batch', async () => {
    mockStorage['t1'] = { id: 't1', name: 'A', goal: 'G1', params: [], tags: [] };
    mockStorage['t2'] = { id: 't2', name: 'B', goal: 'G2', params: [], tags: [] };
    const result = await exportAllTemplates();
    expect(result.format).toBe('sentinel-template-batch');
    expect(result.count).toBe(2);
    expect(result.templates).toHaveLength(2);
  });

  test('returns empty batch when no templates', async () => {
    const result = await exportAllTemplates();
    expect(result.count).toBe(0);
    expect(result.templates).toHaveLength(0);
  });
});

describe('importTemplates', () => {
  test('imports new templates', async () => {
    const templates = [{ name: 'New', goal: 'New goal', params: [], tags: [] }];
    const result = await importTemplates(templates, 'skip');
    expect(result.imported).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.action).toBe('imported');
  });

  test('skips existing templates in skip mode', async () => {
    mockStorage['t1'] = { id: 't1', name: 'existing', goal: 'G', params: [], tags: [], createdAt: 1, updatedAt: 1, lastUsedAt: null, runCount: 0 };
    const templates = [{ name: 'existing', goal: 'New goal', params: [], tags: [] }];
    const result = await importTemplates(templates, 'skip');
    expect(result.skipped).toBe(1);
  });

  test('renames conflicting templates in rename mode', async () => {
    mockStorage['t1'] = { id: 't1', name: 'existing', goal: 'G', params: [], tags: [], createdAt: 1, updatedAt: 1, lastUsedAt: null, runCount: 0 };
    const templates = [{ name: 'existing', goal: 'New goal', params: [], tags: [] }];
    const result = await importTemplates(templates, 'rename');
    expect(result.renamed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.name).toContain('existing (1)');
  });

  test('overwrites conflicting templates in overwrite mode', async () => {
    mockStorage['t1'] = { id: 't1', name: 'existing', goal: 'G', params: [], tags: [], createdAt: 1, updatedAt: 1, lastUsedAt: null, runCount: 0 };
    const templates = [{ name: 'existing', goal: 'Updated goal', params: [], tags: ['new'] }];
    const result = await importTemplates(templates, 'overwrite');
    expect(result.overwritten).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.action).toBe('overwritten');
  });

  test('returns empty result for null input', async () => {
    const result = await importTemplates(null);
    expect(result).toEqual({ imported: 0, skipped: 0, renamed: 0, overwritten: 0, results: [] });
  });

  test('returns empty result for undefined input', async () => {
    const result = await importTemplates(undefined);
    expect(result).toEqual({ imported: 0, skipped: 0, renamed: 0, overwritten: 0, results: [] });
  });

  test('returns empty result for non-array input', async () => {
    const result = await importTemplates('not an array');
    expect(result).toEqual({ imported: 0, skipped: 0, renamed: 0, overwritten: 0, results: [] });
  });

  test('skips null element in array with "Invalid template" reason (covers L197-199)', async () => {
    const result = await importTemplates([null]);
    expect(result.skipped).toBe(1);
    expect(result.results[0].action).toBe('skipped');
    expect(result.results[0].reason).toContain('Invalid template');
    expect(result.results[0].name).toBe('(unknown)');
  });

  test('skips template with missing name field (covers L197-199)', async () => {
    const result = await importTemplates([{ goal: 'some goal', params: [] }]);
    expect(result.skipped).toBe(1);
    expect(result.results[0].action).toBe('skipped');
    expect(result.results[0].reason).toContain('Invalid template');
  });

  test('skips template with non-string name (covers L197-199)', async () => {
    const result = await importTemplates([{ name: 42, goal: 'some goal' }]);
    expect(result.skipped).toBe(1);
    expect(result.results[0].action).toBe('skipped');
    expect(result.results[0].reason).toContain('Invalid template');
  });
});
