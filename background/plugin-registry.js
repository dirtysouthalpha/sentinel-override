// Plugin Registry — v15 Platform
// Manages community-contributed platform profiles, playbooks, and action packs.

const PLUGINS_KEY = 'sentinel_plugins';
const REGISTRY_URL = 'https://raw.githubusercontent.com/dirtysouthalpha/sentinel-override-plugins/main/registry.json';

let _installed = [];
let _available = [];

/**
 * Initialize plugin registry.
 */
export async function initPlugins() {
  try {
    const stored = await chrome.storage.local.get([PLUGINS_KEY]);
    _installed = stored[PLUGINS_KEY] || [];
  } catch (e) {
    console.warn('[Sentinel/Plugin] Init failed:', e.message);
  }
}

/**
 * Fetch available plugins from the registry.
 */
export async function fetchRegistry() {
  try {
    const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Registry returned ${response.status}`);
    _available = await response.json();
    return _available;
  } catch (e) {
    console.warn('[Sentinel/Plugin] Registry fetch failed:', e.message);
    return _available;
  }
}

/**
 * Install a plugin by ID.
 */
export async function installPlugin(pluginId) {
  const plugin = _available.find(p => p.id === pluginId);
  if (!plugin) throw new Error(`Plugin ${pluginId} not found in registry`);

  // Download plugin content
  try {
    const response = await fetch(plugin.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const content = await response.text();

    const installed = {
      ...plugin,
      installedAt: Date.now(),
      content,
      enabled: true
    };

    _installed.push(installed);
    await _persist();

    return installed;
  } catch (e) {
    throw new Error(`Install failed: ${e.message}`);
  }
}

/**
 * Uninstall a plugin by ID.
 */
export async function uninstallPlugin(pluginId) {
  const idx = _installed.findIndex(p => p.id === pluginId);
  if (idx === -1) return false;
  _installed.splice(idx, 1);
  await _persist();
  return true;
}

/**
 * Toggle a plugin enabled/disabled.
 */
export async function togglePlugin(pluginId, enabled) {
  const plugin = _installed.find(p => p.id === pluginId);
  if (!plugin) return false;
  plugin.enabled = enabled;
  await _persist();
  return true;
}

/**
 * Get all installed plugins.
 */
export function getInstalledPlugins() {
  return [..._installed];
}

/**
 * Get available plugins from registry.
 */
export function getAvailablePlugins() {
  return [..._available];
}

/**
 * Get enabled plugins of a specific type.
 */
export function getEnabledPlugins(type) {
  return _installed.filter(p => p.enabled && (!type || p.type === type));
}

async function _persist() {
  try {
    await chrome.storage.local.set({ [PLUGINS_KEY]: _installed });
  } catch (e) {
    console.warn('[Sentinel/Plugin] Persist failed:', e.message);
  }
}
