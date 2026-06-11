/**
 * Branch coverage for template-manager.js lines 19-25:
 * The chrome.storage.onChanged listener body that resets templatesCache
 * when 'sentinel_templates' changes in 'local' storage.
 *
 * Requires a fresh module import where chrome.storage.onChanged is at the
 * top level (the existing template-manager.test.js places it under local).
 */

import { jest } from '@jest/globals';

let capturedOnChangedListener = null;
const storageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const result = {};
        for (const k of keyList) {
          if (storageData[k] !== undefined) result[k] = storageData[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async (key) => { delete storageData[key]; }),
    },
    onChanged: {
      addListener: jest.fn((fn) => { capturedOnChangedListener = fn; }),
    },
  },
};

globalThis.crypto = {
  randomUUID: jest.fn(() => 'uuid-onchan-test'),
};

const { loadTemplates, saveTemplate, clearTemplateCache } =
  await import('../background/template-manager.js');

describe('template-manager — chrome.storage.onChanged listener (lines 19-25)', () => {
  beforeEach(() => {
    for (const k of Object.keys(storageData)) delete storageData[k];
    clearTemplateCache();
    jest.clearAllMocks();
    chrome.storage.local.get.mockImplementation(async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const k of keyList) {
        if (storageData[k] !== undefined) result[k] = storageData[k];
      }
      return result;
    });
  });

  test('listener was registered on chrome.storage.onChanged', () => {
    expect(capturedOnChangedListener).not.toBeNull();
  });

  test('fires with areaName=local and matching key — resets cache (lines 20-23)', async () => {
    // Pre-warm the cache with a template
    storageData['sentinel_templates'] = { 'tpl-1': { id: 'tpl-1', name: 'T1', goal: 'G1' } };
    const first = await loadTemplates();
    expect(first['tpl-1']).toBeDefined();

    // Simulate an external storage change that should bust the cache
    capturedOnChangedListener({ sentinel_templates: { newValue: {} } }, 'local');

    // After cache bust, loadTemplates re-reads from storage
    storageData['sentinel_templates'] = { 'tpl-2': { id: 'tpl-2', name: 'T2', goal: 'G2' } };
    const second = await loadTemplates();
    expect(second['tpl-2']).toBeDefined();
    expect(second['tpl-1']).toBeUndefined();
  });

  test('no-ops when areaName is not local (line 20 branch)', async () => {
    storageData['sentinel_templates'] = { 'tpl-a': { id: 'tpl-a', name: 'A', goal: 'G' } };
    const first = await loadTemplates();
    expect(first['tpl-a']).toBeDefined();

    // 'sync' area — should NOT bust the cache
    capturedOnChangedListener({ sentinel_templates: { newValue: {} } }, 'sync');

    // Cache should still be valid — no new storage read needed
    storageData['sentinel_templates'] = { 'tpl-b': { id: 'tpl-b', name: 'B', goal: 'G2' } };
    const second = await loadTemplates();
    // tpl-a still returned from cache (not re-read)
    expect(second['tpl-a']).toBeDefined();
  });

  test('no-ops when sentinel_templates key not in changes (line 20 branch)', async () => {
    storageData['sentinel_templates'] = { 'tpl-c': { id: 'tpl-c', name: 'C', goal: 'G' } };
    await loadTemplates();

    // Fire with a different key — should NOT bust the cache
    capturedOnChangedListener({ other_key: { newValue: {} } }, 'local');

    storageData['sentinel_templates'] = { 'tpl-d': { id: 'tpl-d', name: 'D', goal: 'G2' } };
    const result = await loadTemplates();
    // tpl-c still returned from cache
    expect(result['tpl-c']).toBeDefined();
  });
});
