// tests/plugin-registry.test.js
// Unit tests for the plugin registry system (PLG-01-06).

// Setup global mocks before any imports
const _storage = {};
globalThis.chrome = {
  storage: { local: {
    get(keys, cb) { const r = {}; (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (_storage[k] !== undefined) r[k] = _storage[k]; }); if (cb) cb(r); },
    set(data, cb) { Object.assign(_storage, data); if (cb) cb(); }
  }},
  runtime: { lastError: null }
};

const _mockFetch = {};
globalThis.fetch = (url) => {
  if (_mockFetch[url]) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(_mockFetch[url]) });
  return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
};

describe('Plugin Registry', () => {
  let mod;
  beforeAll(async () => {
    mod = await import('../background/plugin-registry.js');
  });

  beforeEach(() => {
    for (const k of Object.keys(_storage)) delete _storage[k];
    for (const k of Object.keys(_mockFetch)) delete _mockFetch[k];
  });

  test('getRegistryUrl returns default when not set', async () => {
    const url = await mod.getRegistryUrl();
    expect(url).toBe('https://registry.sentinel.dev/plugins.json');
  });

  test('setRegistryUrl persists custom URL', async () => {
    await mod.setRegistryUrl('https://custom.example.com/plugins.json');
    const url = await mod.getRegistryUrl();
    expect(url).toBe('https://custom.example.com/plugins.json');
  });

  test('installPlugin stores plugin manifest', async () => {
    _mockFetch['https://example.com/plugin.json'] = {
      id: 'test-plugin', name: 'Test Plugin', version: '1.0.0', entryUrl: 'https://example.com/main.js'
    };
    const id = await mod.installPlugin('https://example.com/plugin.json');
    expect(id).toBe('test-plugin');
    const plugins = await mod.getInstalledPlugins();
    expect(plugins['test-plugin']).toBeDefined();
    expect(plugins['test-plugin'].name).toBe('Test Plugin');
    expect(plugins['test-plugin'].active).toBe(false);
  });

  test('uninstallPlugin removes plugin', async () => {
    _mockFetch['https://example.com/plugin.json'] = {
      id: 'test-plugin', name: 'Test', version: '1.0.0', entryUrl: 'https://example.com/main.js'
    };
    await mod.installPlugin('https://example.com/plugin.json');
    await mod.uninstallPlugin('test-plugin');
    const plugins = await mod.getInstalledPlugins();
    expect(plugins['test-plugin']).toBeUndefined();
  });

  test('togglePlugin switches active state', async () => {
    _mockFetch['https://example.com/plugin.json'] = {
      id: 'test-plugin', name: 'Test', version: '1.0.0', entryUrl: 'https://example.com/main.js'
    };
    await mod.installPlugin('https://example.com/plugin.json');
    const active = await mod.togglePlugin('test-plugin');
    expect(active).toBe(true);
    const plugins = await mod.getInstalledPlugins();
    expect(plugins['test-plugin'].active).toBe(true);
  });

  test('detectConflicts finds platform overlaps', async () => {
    _mockFetch['https://a.com/p.json'] = {
      id: 'plug-a', name: 'A', version: '1.0.0', entryUrl: 'https://a.com/main.js', platforms: ['sonicwall']
    };
    _mockFetch['https://b.com/p.json'] = {
      id: 'plug-b', name: 'B', version: '1.0.0', entryUrl: 'https://b.com/main.js', platforms: ['sonicwall']
    };
    await mod.installPlugin('https://a.com/p.json');
    await mod.togglePlugin('plug-a');
    await mod.installPlugin('https://b.com/p.json');
    const conflicts = await mod.detectConflicts('plug-b');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].type).toBe('platform_overlap');
  });

  test('detectConflicts returns empty array when plugin not found', async () => {
    const conflicts = await mod.detectConflicts('nonexistent-plugin');
    expect(conflicts).toEqual([]);
  });

  test('detectConflicts finds action overlaps', async () => {
    _mockFetch['https://a.com/p.json'] = {
      id: 'plug-a', name: 'A', version: '1.0.0', entryUrl: 'https://a.com/main.js',
      platforms: [], actions: { 'run_report': {} }
    };
    _mockFetch['https://b.com/p.json'] = {
      id: 'plug-b', name: 'B', version: '1.0.0', entryUrl: 'https://b.com/main.js',
      platforms: [], actions: { 'run_report': {} }
    };
    await mod.installPlugin('https://a.com/p.json');
    await mod.togglePlugin('plug-a');
    await mod.installPlugin('https://b.com/p.json');
    const conflicts = await mod.detectConflicts('plug-b');
    expect(conflicts.some(c => c.type === 'action_overlap')).toBe(true);
  });

  test('activatePlugin sets plugin to active', async () => {
    _mockFetch['https://example.com/plugin.json'] = {
      id: 'test-plugin', name: 'Test', version: '1.0.0', entryUrl: 'https://example.com/main.js'
    };
    await mod.installPlugin('https://example.com/plugin.json');
    await mod.activatePlugin('test-plugin');
    const plugins = await mod.getInstalledPlugins();
    expect(plugins['test-plugin'].active).toBe(true);
  });

  test('activatePlugin throws for unknown plugin', async () => {
    await expect(mod.activatePlugin('no-such-plugin')).rejects.toThrow('Plugin not found');
  });

  test('deactivatePlugin sets plugin to inactive', async () => {
    _mockFetch['https://example.com/plugin.json'] = {
      id: 'test-plugin', name: 'Test', version: '1.0.0', entryUrl: 'https://example.com/main.js'
    };
    await mod.installPlugin('https://example.com/plugin.json');
    await mod.activatePlugin('test-plugin');
    await mod.deactivatePlugin('test-plugin');
    const plugins = await mod.getInstalledPlugins();
    expect(plugins['test-plugin'].active).toBe(false);
  });

  test('deactivatePlugin throws for unknown plugin', async () => {
    await expect(mod.deactivatePlugin('no-such-plugin')).rejects.toThrow('Plugin not found');
  });

  test('getActivePlugins returns only active plugins', async () => {
    _mockFetch['https://a.com/p.json'] = {
      id: 'plug-a', name: 'A', version: '1.0.0', entryUrl: 'https://a.com/main.js'
    };
    _mockFetch['https://b.com/p.json'] = {
      id: 'plug-b', name: 'B', version: '1.0.0', entryUrl: 'https://b.com/main.js'
    };
    await mod.installPlugin('https://a.com/p.json');
    await mod.installPlugin('https://b.com/p.json');
    await mod.activatePlugin('plug-a');
    const active = await mod.getActivePlugins();
    expect(active['plug-a']).toBeDefined();
    expect(active['plug-b']).toBeUndefined();
  });

  test('getActivePlugins returns empty object when no plugins installed', async () => {
    const active = await mod.getActivePlugins();
    expect(active).toEqual({});
  });

  test('togglePlugin throws for unknown plugin', async () => {
    await expect(mod.togglePlugin('no-such-plugin')).rejects.toThrow('Plugin not found');
  });
});
