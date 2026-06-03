// tests/template-manager.test.js
// Unit tests for background/template-manager.js — full coverage of CRUD,
// parameter extraction, goal resolution, usage tracking, and storage helpers.

import { jest } from '@jest/globals';

// ---------- chrome mock ----------
let storageData = {};
const storageListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys && typeof keys === 'object' ? keys : {});
        const result = {};
        for (const k of keyList) {
          if (storageData[k] !== undefined) result[k] = storageData[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => {
        Object.assign(storageData, obj);
        for (const fn of storageListeners) {
          try { fn({ sentinel_templates: { newValue: obj.sentinel_templates } }, 'local'); } catch (e) {
            // Listener errors are expected in tests
          }
        }
      }),
      remove: jest.fn(async (key) => {
        delete storageData[key];
      }),
      onChanged: {
        addListener: jest.fn((fn) => { storageListeners.push(fn); }),
      },
    },
  },
};

// crypto.randomUUID mock
globalThis.crypto = {
  randomUUID: jest.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 8)),
};

const {
  extractParameters,
  loadTemplates,
  saveTemplates,
  listTemplates,
  getTemplate,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
  resolveTemplateGoal,
  updateTemplateUsage,
  clearTemplateCache,
} = await import('../background/template-manager.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
  clearTemplateCache();
});

// ========== extractParameters ==========

describe('extractParameters', () => {
  test('returns empty array for non-string input', () => {
    expect(extractParameters(null)).toEqual([]);
    expect(extractParameters(undefined)).toEqual([]);
    expect(extractParameters(123)).toEqual([]);
    expect(extractParameters({})).toEqual([]);
  });

  test('returns empty array for string with no placeholders', () => {
    expect(extractParameters('Check the firewall status')).toEqual([]);
    expect(extractParameters('')).toEqual([]);
  });

  test('extracts a single ::key:: placeholder', () => {
    const result = extractParameters('Check firewall ::firewall_name:: status');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: 'firewall_name', label: 'Firewall Name', defaultValue: '' });
  });

  test('extracts multiple distinct placeholders', () => {
    const result = extractParameters('Check ::firewall_name:: policy for ::client_name::');
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('firewall_name');
    expect(result[1].key).toBe('client_name');
  });

  test('deduplicates repeated placeholders', () => {
    const result = extractParameters('Find ::device:: and check ::device:: config');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('device');
  });

  test('title-cases labels with underscores', () => {
    const result = extractParameters('Check ::vpn_tunnel_name::');
    expect(result[0].label).toBe('Vpn Tunnel Name');
  });

  test('handles placeholders adjacent to text', () => {
    const result = extractParameters('Navigate to https://::host_name::/admin');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('host_name');
  });

  test('handles multiple placeholders in sequence', () => {
    const result = extractParameters('::a::::b::::c::');
    expect(result).toHaveLength(3);
    expect(result.map(p => p.key)).toEqual(['a', 'b', 'c']);
  });
});

// ========== loadTemplates / saveTemplates ==========

describe('loadTemplates', () => {
  test('returns empty object when no templates stored', async () => {
    const result = await loadTemplates();
    expect(result).toEqual({});
  });

  test('returns stored templates', async () => {
    const tpl = { id: 'abc', name: 'Test', goal: 'Do thing' };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await loadTemplates();
    expect(result.abc).toEqual(tpl);
  });

  test('returns empty object on storage error', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('fail'));
    const result = await loadTemplates();
    expect(result).toEqual({});
  });
});

describe('saveTemplates', () => {
  test('persists templates to storage', async () => {
    const templates = { abc: { id: 'abc', name: 'Test' } };
    await saveTemplates(templates);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sentinel_templates: templates });
  });

  test('throws on storage failure', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota'));
    await expect(saveTemplates({})).rejects.toThrow('Failed to save templates');
  });
});

// ========== saveTemplate (create) ==========

describe('saveTemplate', () => {
  test('creates a template with auto-generated id and timestamps', async () => {
    const result = await saveTemplate({ name: 'Test Template', goal: 'Check ::firewall::' });
    expect(result.name).toBe('Test Template');
    expect(result.goal).toBe('Check ::firewall::');
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.updatedAt).toBe(result.createdAt);
    expect(result.runCount).toBe(0);
    expect(result.lastUsedAt).toBeNull();
  });

  test('auto-extracts params from goal when not provided', async () => {
    const result = await saveTemplate({ name: 'T', goal: 'Check ::firewall_name:: on ::device::' });
    expect(result.params).toHaveLength(2);
    expect(result.params[0].key).toBe('firewall_name');
  });

  test('uses provided params when given', async () => {
    const params = [{ key: 'custom', label: 'Custom', defaultValue: 'x' }];
    const result = await saveTemplate({ name: 'T', goal: 'Do stuff', params });
    expect(result.params).toEqual(params);
  });

  test('trims name whitespace', async () => {
    const result = await saveTemplate({ name: '  Spaced Name  ', goal: 'Do stuff' });
    expect(result.name).toBe('Spaced Name');
  });

  test('throws when name is missing', async () => {
    await expect(saveTemplate({ goal: 'Do stuff' })).rejects.toThrow('name is required');
  });

  test('throws when name is empty', async () => {
    await expect(saveTemplate({ name: '   ', goal: 'Do stuff' })).rejects.toThrow('name is required');
  });

  test('throws when goal is missing', async () => {
    await expect(saveTemplate({ name: 'Test' })).rejects.toThrow('goal is required');
  });

  test('throws when data is not an object', async () => {
    await expect(saveTemplate(null)).rejects.toThrow('must be an object');
  });

  test('accepts tags array', async () => {
    const result = await saveTemplate({ name: 'T', goal: 'G', tags: ['firewall', 'security'] });
    expect(result.tags).toEqual(['firewall', 'security']);
  });

  test('defaults tags to empty array when not provided', async () => {
    const result = await saveTemplate({ name: 'T', goal: 'G' });
    expect(result.tags).toEqual([]);
  });
});

// ========== getTemplate ==========

describe('getTemplate', () => {
  test('returns template by id', async () => {
    const tpl = { id: 'abc', name: 'Test' };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await getTemplate('abc');
    expect(result).toEqual(tpl);
  });

  test('returns null for unknown id', async () => {
    storageData['sentinel_templates'] = {};
    const result = await getTemplate('xyz');
    expect(result).toBeNull();
  });

  test('returns null for falsy id', async () => {
    expect(await getTemplate(null)).toBeNull();
    expect(await getTemplate('')).toBeNull();
  });
});

// ========== listTemplates ==========

describe('listTemplates', () => {
  test('returns templates sorted by updatedAt descending', async () => {
    const templates = {
      a: { id: 'a', name: 'Old', updatedAt: 100 },
      b: { id: 'b', name: 'New', updatedAt: 200 },
    };
    storageData['sentinel_templates'] = templates;
    const result = await listTemplates();
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
  });

  test('returns empty array when no templates', async () => {
    const result = await listTemplates();
    expect(result).toEqual([]);
  });
});

// ========== updateTemplate ==========

describe('updateTemplate', () => {
  test('updates name', async () => {
    const tpl = { id: 'abc', name: 'Old', goal: 'G', updatedAt: 100 };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await updateTemplate('abc', { name: 'New' });
    expect(result.name).toBe('New');
    expect(result.updatedAt).toBeGreaterThanOrEqual(100);
  });

  test('re-extracts params when goal changes without explicit params', async () => {
    const tpl = { id: 'abc', name: 'T', goal: 'Old goal', params: [], updatedAt: 100 };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await updateTemplate('abc', { goal: 'Check ::device:: status' });
    expect(result.goal).toBe('Check ::device:: status');
    expect(result.params).toHaveLength(1);
    expect(result.params[0].key).toBe('device');
  });

  test('keeps explicit params when goal changes with params provided', async () => {
    const tpl = { id: 'abc', name: 'T', goal: 'Old', params: [], updatedAt: 100 };
    storageData['sentinel_templates'] = { abc: tpl };
    const newParams = [{ key: 'x', label: 'X', defaultValue: '' }];
    const result = await updateTemplate('abc', { goal: 'Check ::device::', params: newParams });
    expect(result.params).toEqual(newParams);
  });

  test('updates tags', async () => {
    const tpl = { id: 'abc', name: 'T', goal: 'G', updatedAt: 100 };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await updateTemplate('abc', { tags: ['new-tag'] });
    expect(result.tags).toEqual(['new-tag']);
  });

  test('throws for missing id', async () => {
    await expect(updateTemplate(null, { name: 'X' })).rejects.toThrow('ID is required');
  });

  test('throws for non-existent template', async () => {
    storageData['sentinel_templates'] = {};
    await expect(updateTemplate('xyz', { name: 'X' })).rejects.toThrow('not found');
  });

  test('throws for empty name update', async () => {
    storageData['sentinel_templates'] = { abc: { id: 'abc', name: 'T', goal: 'G' } };
    await expect(updateTemplate('abc', { name: '  ' })).rejects.toThrow('non-empty string');
  });

  test('throws for empty goal update', async () => {
    storageData['sentinel_templates'] = { abc: { id: 'abc', name: 'T', goal: 'G' } };
    await expect(updateTemplate('abc', { goal: '' })).rejects.toThrow('non-empty string');
  });

  test('throws when params is not an array', async () => {
    storageData['sentinel_templates'] = { abc: { id: 'abc', name: 'T', goal: 'G' } };
    await expect(updateTemplate('abc', { params: 'bad' })).rejects.toThrow('must be an array');
  });

  test('throws when updates is not an object', async () => {
    await expect(updateTemplate('abc', null)).rejects.toThrow('must be an object');
  });
});

// ========== deleteTemplate ==========

describe('deleteTemplate', () => {
  test('removes template from storage', async () => {
    storageData['sentinel_templates'] = { abc: { id: 'abc', name: 'T' }, def: { id: 'def', name: 'D' } };
    await deleteTemplate('abc');
    expect(storageData['sentinel_templates'].abc).toBeUndefined();
    expect(storageData['sentinel_templates'].def).toBeDefined();
  });

  test('throws for missing id', async () => {
    await expect(deleteTemplate(null)).rejects.toThrow('ID is required');
  });

  test('throws for non-existent template', async () => {
    storageData['sentinel_templates'] = {};
    await expect(deleteTemplate('xyz')).rejects.toThrow('not found');
  });
});

// ========== resolveTemplateGoal ==========

describe('resolveTemplateGoal', () => {
  test('substitutes parameters in goal text', async () => {
    const tpl = {
      id: 'abc', name: 'T', goal: 'Check firewall ::firewall:: for client ::client::',
      params: [
        { key: 'firewall', label: 'Firewall', defaultValue: '' },
        { key: 'client', label: 'Client', defaultValue: '' },
      ],
    };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await resolveTemplateGoal('abc', { firewall: 'FW-01', client: 'Acme' });
    expect(result).toBe('Check firewall FW-01 for client Acme');
  });

  test('uses default values when param not provided', async () => {
    const tpl = {
      id: 'abc', name: 'T', goal: 'Check ::device::',
      params: [{ key: 'device', label: 'Device', defaultValue: 'default-device' }],
    };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await resolveTemplateGoal('abc', {});
    expect(result).toBe('Check default-device');
  });

  test('leaves placeholder when no value or default', async () => {
    const tpl = {
      id: 'abc', name: 'T', goal: 'Check ::device::',
      params: [{ key: 'device', label: 'Device', defaultValue: '' }],
    };
    storageData['sentinel_templates'] = { abc: tpl };
    const result = await resolveTemplateGoal('abc', {});
    expect(result).toBe('Check ::device::');
  });

  test('updates usage tracking (runCount, lastUsedAt)', async () => {
    const tpl = {
      id: 'abc', name: 'T', goal: 'Do ::thing::',
      params: [{ key: 'thing', label: 'Thing', defaultValue: 'x' }],
      runCount: 3,
      lastUsedAt: 100,
    };
    storageData['sentinel_templates'] = { abc: tpl };
    await resolveTemplateGoal('abc', { thing: 'test' });
    expect(storageData['sentinel_templates'].abc.runCount).toBe(4);
    expect(storageData['sentinel_templates'].abc.lastUsedAt).toBeGreaterThanOrEqual(100);
  });

  test('throws for missing templateId', async () => {
    await expect(resolveTemplateGoal(null, {})).rejects.toThrow('ID is required');
  });

  test('throws for non-existent template', async () => {
    storageData['sentinel_templates'] = {};
    await expect(resolveTemplateGoal('xyz', {})).rejects.toThrow('not found');
  });
});

// ========== updateTemplateUsage ==========

describe('updateTemplateUsage', () => {
  test('increments runCount and sets lastUsedAt', async () => {
    const tpl = { id: 'abc', name: 'T', goal: 'G', runCount: 5, lastUsedAt: 100 };
    storageData['sentinel_templates'] = { abc: tpl };
    await updateTemplateUsage('abc');
    expect(storageData['sentinel_templates'].abc.runCount).toBe(6);
    expect(storageData['sentinel_templates'].abc.lastUsedAt).toBeGreaterThanOrEqual(100);
  });

  test('no-ops for missing id', async () => {
    await expect(updateTemplateUsage(null)).resolves.toBeUndefined();
  });

  test('no-ops for non-existent template', async () => {
    storageData['sentinel_templates'] = {};
    await expect(updateTemplateUsage('xyz')).resolves.toBeUndefined();
  });

  test('handles runCount starting from undefined', async () => {
    const tpl = { id: 'abc', name: 'T', goal: 'G' };
    storageData['sentinel_templates'] = { abc: tpl };
    await updateTemplateUsage('abc');
    expect(storageData['sentinel_templates'].abc.runCount).toBe(1);
  });
});

// ========== Edge cases — additional coverage ==========

describe('template-manager edge cases', () => {
  test('extractParameters handles underscore-only keys', () => {
    const result = extractParameters('Check ::___::');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('___');
  });

  test('extractParameters handles keys with numbers', () => {
    const result = extractParameters('Step ::step1:: then ::step2::');
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('step1');
    expect(result[1].key).toBe('step2');
  });

  test('loadTemplates returns non-object stored value as-is (caller beware)', async () => {
    storageData['sentinel_templates'] = 'not-an-object';
    const result = await loadTemplates();
    // Source code: result[STORAGE_KEY] || {} — a truthy string passes through
    expect(typeof result).toBe('string');
  });

  test('listTemplates handles templates without updatedAt', async () => {
    storageData['sentinel_templates'] = {
      a: { id: 'a', name: 'A' },
      b: { id: 'b', name: 'B', updatedAt: 100 },
    };
    const result = await listTemplates();
    expect(result).toHaveLength(2);
  });

  test('saveTemplate with goal containing only placeholders', async () => {
    const result = await saveTemplate({ name: 'All Params', goal: '::a::::b::::c::' });
    expect(result.params).toHaveLength(3);
  });

  test('updateTemplate preserves existing fields not updated', async () => {
    storageData['sentinel_templates'] = {
      abc: { id: 'abc', name: 'T', goal: 'Old', tags: ['keep'], createdAt: 100, updatedAt: 100 },
    };
    const result = await updateTemplate('abc', { name: 'New' });
    expect(result.tags).toEqual(['keep']);
    expect(result.createdAt).toBe(100);
    expect(result.goal).toBe('Old');
  });

  test('deleteTemplate removes only the target template', async () => {
    storageData['sentinel_templates'] = {
      a: { id: 'a', name: 'A' },
      b: { id: 'b', name: 'B' },
      c: { id: 'c', name: 'C' },
    };
    await deleteTemplate('b');
    expect(Object.keys(storageData['sentinel_templates'])).toEqual(['a', 'c']);
  });

  test('resolveTemplateGoal with empty paramValues uses defaults', async () => {
    storageData['sentinel_templates'] = {
      abc: {
        id: 'abc', name: 'T', goal: '::host::/::path::',
        params: [
          { key: 'host', label: 'Host', defaultValue: 'localhost' },
          { key: 'path', label: 'Path', defaultValue: 'admin' },
        ],
      },
    };
    const result = await resolveTemplateGoal('abc', {});
    expect(result).toBe('localhost/admin');
  });

  test('resolveTemplateGoal with non-object paramValues', async () => {
    storageData['sentinel_templates'] = {
      abc: {
        id: 'abc', name: 'T', goal: 'No params',
        params: [],
      },
    };
    const result = await resolveTemplateGoal('abc', null);
    expect(result).toBe('No params');
  });

  test('saveTemplates throws descriptive error on storage failure', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(saveTemplates({ x: 1 })).rejects.toThrow('Failed to save templates');
  });

  test('getTemplate returns null for non-string id', async () => {
    expect(await getTemplate(123)).toBeNull();
  });

  test('updateTemplate with tags as non-array defaults to empty array', async () => {
    storageData['sentinel_templates'] = { abc: { id: 'abc', name: 'T', goal: 'G', tags: ['old'] } };
    const result = await updateTemplate('abc', { tags: 'not-array' });
    expect(result.tags).toEqual([]);
  });
});
