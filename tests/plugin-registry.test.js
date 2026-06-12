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

  test('setRegistryUrl throws for null', async () => {
    await expect(mod.setRegistryUrl(null)).rejects.toThrow('Registry URL must be a non-empty string');
  });

  test('setRegistryUrl throws for non-string', async () => {
    await expect(mod.setRegistryUrl(42)).rejects.toThrow('Registry URL must be a non-empty string');
  });

  test('fetchRegistry throws on HTTP error', async () => {
    // Default registry URL is not in _mockFetch, so fetch returns 404
    await expect(mod.fetchRegistry()).rejects.toThrow('Registry fetch failed');
  });

  test('fetchRegistry throws when response is not an array', async () => {
    _mockFetch['https://registry.sentinel.dev/plugins.json'] = { not: 'an array' };
    await expect(mod.fetchRegistry()).rejects.toThrow('Registry must return an array');
  });

  test('installPlugin throws on manifest fetch HTTP error', async () => {
    await expect(mod.installPlugin('https://no-such-host.invalid/plugin.json')).rejects.toThrow('Failed to fetch manifest');
  });

  test('installPlugin throws on non-object manifest', async () => {
    _mockFetch['https://bad-manifest.example.com/plugin.json'] = 'not an object';
    await expect(mod.installPlugin('https://bad-manifest.example.com/plugin.json')).rejects.toThrow('Invalid manifest: must be an object');
  });

  test('installPlugin throws on manifest missing required fields', async () => {
    _mockFetch['https://missing-fields.example.com/plugin.json'] = { id: 'test' }; // missing name, version, entryUrl
    await expect(mod.installPlugin('https://missing-fields.example.com/plugin.json')).rejects.toThrow('Invalid manifest: missing required field');
  });

  test('installPlugin throws on version mismatch', async () => {
    _mockFetch['https://new-version.example.com/plugin.json'] = {
      id: 'future-plugin', name: 'Future', version: '1.0.0', entryUrl: 'https://x.com/main.js',
      minSentinelVersion: '99.0.0'
    };
    await expect(mod.installPlugin('https://new-version.example.com/plugin.json')).rejects.toThrow('Plugin requires Sentinel v');
  });

  test('installPlugin succeeds when minSentinelVersion uses lower major (semver regression)', async () => {
    // String comparison bug: '2.0.0' > '15.0.0' is true (wrong), numeric must be false
    _mockFetch['https://compat.example.com/plugin.json'] = {
      id: 'compat-plugin', name: 'Compat', version: '1.0.0', entryUrl: 'https://x.com/main.js',
      minSentinelVersion: '2.0.0'
    };
    const id = await mod.installPlugin('https://compat.example.com/plugin.json');
    expect(id).toBe('compat-plugin');
  });

  test('installPlugin error message includes quoted field name', async () => {
    _mockFetch['https://quoted-field.example.com/plugin.json'] = { id: 'test' };
    await expect(mod.installPlugin('https://quoted-field.example.com/plugin.json'))
      .rejects.toThrow('"name"');
  });

  // ========== Uncovered branch coverage ==========

  test('storageGet rejects when chrome.runtime.lastError is set', async () => {
    const orig = globalThis.chrome.storage.local.get;
    globalThis.chrome.storage.local.get = (keys, cb) => {
      globalThis.chrome.runtime.lastError = { message: 'storage get error' };
      cb({});
      globalThis.chrome.runtime.lastError = null;
    };
    await expect(mod.getRegistryUrl()).rejects.toThrow('storage get error');
    globalThis.chrome.storage.local.get = orig;
  });

  test('storageSet rejects when chrome.runtime.lastError is set', async () => {
    const orig = globalThis.chrome.storage.local.set;
    globalThis.chrome.storage.local.set = (data, cb) => {
      globalThis.chrome.runtime.lastError = { message: 'storage set error' };
      cb();
      globalThis.chrome.runtime.lastError = null;
    };
    await expect(mod.setRegistryUrl('https://example.com/r.json')).rejects.toThrow('storage set error');
    globalThis.chrome.storage.local.set = orig;
  });

  test('fetchRegistry returns plugin array on success', async () => {
    _mockFetch['https://registry.sentinel.dev/plugins.json'] = [
      { id: 'plug-x', name: 'X', version: '1.0.0', entryUrl: 'https://x.com/main.js' },
    ];
    const data = await mod.fetchRegistry();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBe('plug-x');
  });

  test('installPlugin warns when plugin is already installed', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => warnings.push(a);
    _mockFetch['https://dup.example.com/plugin.json'] = {
      id: 'dup-plugin', name: 'Dup', version: '1.0.0', entryUrl: 'https://dup.com/main.js',
    };
    await mod.installPlugin('https://dup.example.com/plugin.json');
    await mod.installPlugin('https://dup.example.com/plugin.json');
    console.warn = origWarn;
    expect(warnings.some(w => w[0] === '[PLUGIN-REGISTRY] Plugin already installed, updating:' && w[1] === 'dup-plugin')).toBe(true);
  });

  test('uninstallPlugin warns when plugin is not found', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => warnings.push(a);
    await mod.uninstallPlugin('does-not-exist');
    console.warn = origWarn;
    expect(warnings.some(w => w[0] === '[PLUGIN-REGISTRY] Plugin not found:' && w[1] === 'does-not-exist')).toBe(true);
  });

  test('getInstalledPlugins returns empty object when storage key is absent', async () => {
    // Covers binary-expr line 229: result[STORAGE_KEY] || {} — storage returns no key
    const plugins = await mod.getInstalledPlugins();
    expect(plugins).toEqual({});
  });

  test('detectConflicts — existing plugin has no platforms property (covers || [] fallback line 186)', async () => {
    _mockFetch['https://noplat.example.com/plugin.json'] = {
      id: 'no-plat', name: 'No Platforms', version: '1.0.0', entryUrl: 'https://noplat.com/main.js',
      // no platforms property
    };
    _mockFetch['https://new.example.com/plugin.json'] = {
      id: 'new-plug', name: 'New', version: '1.0.0', entryUrl: 'https://new.com/main.js',
      platforms: ['cisco'],
    };
    await mod.installPlugin('https://noplat.example.com/plugin.json');
    await mod.togglePlugin('no-plat'); // activate it
    await mod.installPlugin('https://new.example.com/plugin.json');
    const conflicts = await mod.detectConflicts('new-plug');
    // no-plat has no platforms, so no platform overlap — conflicts should be empty or only action-based
    expect(Array.isArray(conflicts)).toBe(true);
    expect(conflicts.filter(c => c.type === 'platform_overlap')).toHaveLength(0);
  });

  test('detectConflicts — existing plugin has no actions property (covers cond-expr line 193)', async () => {
    _mockFetch['https://noact.example.com/plugin.json'] = {
      id: 'no-act', name: 'No Actions', version: '1.0.0', entryUrl: 'https://noact.com/main.js',
      platforms: [],
      // no actions property
    };
    _mockFetch['https://new2.example.com/plugin.json'] = {
      id: 'new-plug2', name: 'New2', version: '1.0.0', entryUrl: 'https://new2.com/main.js',
      platforms: [], actions: { 'some_action': {} },
    };
    await mod.installPlugin('https://noact.example.com/plugin.json');
    await mod.togglePlugin('no-act');
    await mod.installPlugin('https://new2.example.com/plugin.json');
    const conflicts = await mod.detectConflicts('new-plug2');
    expect(conflicts.filter(c => c.type === 'action_overlap')).toHaveLength(0);
  });

  test('compareSemver returns 0 for equal minSentinelVersion (does not throw)', async () => {
    _mockFetch['https://exact-version.example.com/plugin.json'] = {
      id: 'exact-plugin', name: 'Exact', version: '1.0.0', entryUrl: 'https://x.com/main.js',
      minSentinelVersion: '15.0.0', // equal to MIN_SENTINEL_VERSION — compareSemver returns 0
    };
    const id = await mod.installPlugin('https://exact-version.example.com/plugin.json');
    expect(id).toBe('exact-plugin');
  });
});
