// background/settings-persistence.js
// Single settings write path (OVERRIDE-22 Phase 2, SET-01..05).
//
// ALL user-facing settings writes go through persistSettings(); reads go
// through readSettings(). Domain caches (telemetry, session-manager, novelty
// history...) are NOT settings and keep their own storage keys.
//
// - Schema-versioned (SETTINGS_SCHEMA_VERSION) with pure migrations
// - Per-key validation (fail-closed: an invalid value is rejected, never written)
// - exportSettings()/importSettings() for JSON backup/restore

export const SETTINGS_SCHEMA_VERSION = 2;

// The settings namespace this module owns. Anything else in chrome.storage.local
// belongs to a domain module and is intentionally untouched.
export const MANAGED_KEYS = [
  'active_provider', 'providers', 'api_endpoint', 'api_key', 'model',
  'export_format', 'agent_context',
  'quickAssist', 'brainEnabled', 'brainBaseUrl',
  'brainProducerEnabled', 'brainProducerLastConfirmedAt',
  'settings_schema_version',
];

const VALIDATORS = {
  active_provider: v => typeof v === 'string' && v.length > 0,
  providers: v => v === null || (typeof v === 'object' && !Array.isArray(v)),
  api_endpoint: v => typeof v === 'string',
  api_key: v => typeof v === 'string',
  model: v => typeof v === 'string',
  export_format: v => ['markdown', 'html', 'json', 'pdf', ''].includes(v),
  agent_context: v => typeof v === 'string' && v.length <= 20000,
  quickAssist: v => typeof v === 'boolean',
  brainEnabled: v => typeof v === 'boolean',
  brainBaseUrl: v => typeof v === 'string' && (v === '' || /^https?:\/\//.test(v)),
  brainProducerEnabled: v => typeof v === 'boolean',
  brainProducerLastConfirmedAt: v => v === null || typeof v === 'string',
  settings_schema_version: v => typeof v === 'number' && Number.isFinite(v),
};

function _storageArea() {
  // chrome.storage.local in extension contexts; tests inject a mock via
  // globalThis.chrome. Fail loudly when neither exists.
  const area = globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local;
  if (!area || typeof area.get !== 'function' || typeof area.set !== 'function') {
    throw new Error('settings-persistence: chrome.storage.local unavailable');
  }
  return area;
}

/**
 * Validate a changes object against MANAGED_KEYS + validators.
 * Pure — exported for tests. Returns array of error strings ([] = valid).
 */
export function validateSettingsChanges(changes) {
  const errors = [];
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return ['changes must be an object'];
  }
  for (const key of Object.keys(changes)) {
    if (!MANAGED_KEYS.includes(key)) {
      errors.push(`unknown settings key "${key}" (not in MANAGED_KEYS)`);
      continue;
    }
    const fn = VALIDATORS[key];
    if (fn && !fn(changes[key])) {
      errors.push(`invalid value for "${key}"`);
    }
  }
  return errors;
}

/**
 * THE single settings write path. Rejects unknown keys and invalid values;
 * never partially writes (validation happens before any storage call).
 * Resolves to the written changes object.
 */
export async function persistSettings(changes) {
  const errors = validateSettingsChanges(changes);
  if (errors.length > 0) {
    throw new Error(`persistSettings rejected: ${errors.join('; ')}`);
  }
  const area = _storageArea();
  await new Promise((resolve, reject) => {
    area.set(changes, () => {
      const le = globalThis.chrome.runtime && globalThis.chrome.runtime.lastError;
      if (le) reject(new Error(`persistSettings failed: ${le.message || String(le)}`));
      else resolve();
    });
  });
  // Stamp the schema version once so migrations have an anchor.
  const existing = await readSettings(['settings_schema_version']);
  if (!existing.settings_schema_version) {
    await new Promise(resolve => area.set({ settings_schema_version: SETTINGS_SCHEMA_VERSION }, resolve));
  }
  return changes;
}

/** Settings read path for the managed namespace. */
export async function readSettings(keys) {
  const area = _storageArea();
  const wanted = Array.isArray(keys) ? keys : MANAGED_KEYS;
  return new Promise((resolve, reject) => {
    area.get(wanted, result => {
      const le = globalThis.chrome.runtime && globalThis.chrome.runtime.lastError;
      if (le) reject(new Error(`readSettings failed: ${le.message || String(le)}`));
      else resolve(result || {});
    });
  });
}

/**
 * Pure migration v1 → v2: fold legacy flat provider keys (api_endpoint/api_key/
 * model) into the providers structure. Returns { settings, changed } — the
 * caller persists only when changed is true.
 */
export function migrateSettings(stored) {
  const s = Object.assign({}, stored);
  let changed = false;
  if (!s.providers && (s.api_endpoint || s.api_key || s.model)) {
    const isAnthropic = String(s.api_endpoint || '').includes('api.anthropic.com');
    s.providers = {
      anthropic: { api_key: '', model: 'claude-haiku-4-5-20251001', endpoint: 'https://api.anthropic.com/v1/messages', max_tokens: 8000, temperature: 0.3 },
      openai: { api_key: s.api_key || '', model: s.model || 'gpt-4o', endpoint: s.api_endpoint || 'https://api.openai.com/v1/chat/completions', max_tokens: 8000, temperature: 0.3 },
    };
    s.active_provider = isAnthropic ? 'anthropic' : 'openai';
    changed = true;
  }
  if (s.settings_schema_version !== SETTINGS_SCHEMA_VERSION) {
    s.settings_schema_version = SETTINGS_SCHEMA_VERSION;
    changed = true;
  }
  return { settings: s, changed };
}

/**
 * Run migrations over the stored managed settings and persist if needed.
 * Resolves to the migrated settings object.
 */
export async function ensureMigrated() {
  const stored = await readSettings();
  const { settings, changed } = migrateSettings(stored);
  if (changed) {
    const toWrite = {};
    for (const k of MANAGED_KEYS) {
      if (settings[k] !== undefined) toWrite[k] = settings[k];
    }
    await persistSettings(toWrite);
  }
  return settings;
}

/** Export the managed settings namespace as a JSON backup string. */
export async function exportSettings() {
  const stored = await readSettings();
  const payload = { type: 'sentinel-override-settings', schema_version: SETTINGS_SCHEMA_VERSION, exported_at: new Date().toISOString(), settings: {} };
  for (const k of MANAGED_KEYS) {
    if (stored[k] !== undefined) payload.settings[k] = stored[k];
  }
  return JSON.stringify(payload, null, 2);
}

/**
 * Import settings from a backup JSON string. Only managed keys are taken;
 * the payload must be a settings export of the right type. Runs migrations
 * for older schema versions, then persists atomically.
 */
export async function importSettings(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`importSettings: not valid JSON (${e.message})`);
  }
  if (!parsed || parsed.type !== 'sentinel-override-settings' || typeof parsed.settings !== 'object') {
    throw new Error('importSettings: not a Sentinel Override settings export');
  }
  const { settings } = migrateSettings(parsed.settings);
  const toWrite = {};
  for (const k of MANAGED_KEYS) {
    if (settings[k] !== undefined) toWrite[k] = settings[k];
  }
  return persistSettings(toWrite);
}
