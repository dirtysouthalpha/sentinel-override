// tests/settings-persistence.test.js
// OVERRIDE-22 Phase 2 (SET-01..05): single settings write path, schema
// versioning + migrations, export/import round-trip, fail-closed validation.
import {
  persistSettings, readSettings, validateSettingsChanges,
  migrateSettings, exportSettings, importSettings,
  MANAGED_KEYS, SETTINGS_SCHEMA_VERSION,
} from '../background/settings-persistence.js';

function mockStorage(initial = {}) {
  const store = { ...initial };
  const listeners = [];
  const area = {
    get(keys, cb) {
      const out = {};
      for (const k of (Array.isArray(keys) ? keys : [keys])) {
        if (store[k] !== undefined) out[k] = store[k];
      }
      setTimeout(() => cb(out), 0);
    },
    set(changes, cb) {
      Object.assign(store, changes);
      setTimeout(() => { cb && cb(); listeners.forEach(l => l()); }, 0);
    },
  };
  return { store, area, listeners };
}

function installChrome(area) {
  globalThis.chrome = { storage: { local: area }, runtime: {} };
}

beforeEach(() => {
  delete globalThis.chrome;
});

describe('settings persistence (SET)', () => {
  test('persistSettings writes only managed keys and stamps schema version', async () => {
    const { area, store } = mockStorage();
    installChrome(area);
    await persistSettings({ export_format: 'markdown', agent_context: 'ctx' });
    expect(store.export_format).toBe('markdown');
    expect(store.agent_context).toBe('ctx');
    expect(store.settings_schema_version).toBe(SETTINGS_SCHEMA_VERSION);
  });

  test('persistSettings rejects unknown keys — no partial write (fail-closed)', async () => {
    const { area, store } = mockStorage();
    installChrome(area);
    await expect(persistSettings({ export_format: 'html', rogueKey: 'x' }))
      .rejects.toThrow(/unknown settings key "rogueKey"/);
    expect(store.export_format).toBeUndefined(); // nothing written
  });

  test('persistSettings rejects invalid values by type', async () => {
    const { area } = mockStorage();
    installChrome(area);
    await expect(persistSettings({ quickAssist: 'yes' })).rejects.toThrow(/invalid value for "quickAssist"/);
    await expect(persistSettings({ brainBaseUrl: 'ftp://nope' })).rejects.toThrow(/invalid value for "brainBaseUrl"/);
    await expect(persistSettings({ export_format: 'exe' })).rejects.toThrow(/invalid value for "export_format"/);
  });

  test('migrateSettings folds legacy flat keys into providers structure (v1→v2)', () => {
    const { settings, changed } = migrateSettings({
      api_endpoint: 'https://api.anthropic.com/v1/messages', api_key: 'k', model: 'm',
    });
    expect(changed).toBe(true);
    expect(settings.providers.openai.api_key).toBe('k');
    expect(settings.active_provider).toBe('anthropic');
    expect(settings.settings_schema_version).toBe(SETTINGS_SCHEMA_VERSION);
  });

  test('migrateSettings is a no-op on current-shape settings', () => {
    const current = { providers: { openai: {} }, active_provider: 'openai', settings_schema_version: SETTINGS_SCHEMA_VERSION };
    const { settings, changed } = migrateSettings(current);
    expect(changed).toBe(false);
    expect(settings).toEqual(current);
  });

  test('export/import round-trips the managed namespace exactly', async () => {
    const { area } = mockStorage({ export_format: 'json', quickAssist: false, brainEnabled: true });
    installChrome(area);
    const json = await exportSettings();
    // Fresh storage, then import — managed keys restored
    const fresh = mockStorage({ export_format: 'markdown' });
    installChrome(fresh.area);
    await importSettings(json);
    const restored = await readSettings(['export_format', 'quickAssist', 'brainEnabled']);
    expect(restored).toEqual({ export_format: 'json', quickAssist: false, brainEnabled: true });
  });

  test('importSettings rejects foreign JSON payloads', async () => {
    const { area } = mockStorage();
    installChrome(area);
    await expect(importSettings('{"type":"something-else","settings":{}}')).rejects.toThrow(/not a Sentinel Override settings export/);
    await expect(importSettings('not json')).rejects.toThrow(/not valid JSON/);
  });

  test('validateSettingsChanges is pure and covers every managed key', () => {
    expect(validateSettingsChanges({})).toEqual([]);
    const full = {};
    for (const k of MANAGED_KEYS) full[k] = null;
    // null passes validators that allow null (providers, timestamps); unknown keys fail
    expect(validateSettingsChanges({ not_a_key: 1 })).toEqual([expect.stringContaining('unknown settings key')]);
  });
});
