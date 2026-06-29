// ========== (v21.6) Per-Client Proxy Routing ==========
// Allows routing agent traffic through client-specific proxies for
// IP allowlisting and network isolation.

let _activeProxyConfig = null;

/**
 * Set proxy configuration for a specific client.
 * @param {string} clientId - Client/tenant identifier
 * @param {object} proxyConfig - { host, port, scheme, username?, password? }
 */
export async function setClientProxy(clientId, proxyConfig) {
  if (!clientId || !proxyConfig || !proxyConfig.host) {
    return { ok: false, error: 'Missing clientId or proxy host' };
  }
  try {
    const scheme = proxyConfig.scheme || 'http';
    const port = proxyConfig.port || 8080;
    // NOTE: Chrome MV3 chrome.proxy.settings does NOT support inline auth.
    // For authenticated proxies, a separate chrome.webRequest.onAuthRequired
    // listener is needed. Unauthenticated proxies work directly here.
    const config = {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: scheme,
          host: proxyConfig.host,
          port: port
        }
      }
    };
    await chrome.proxy.settings.set({
      value: config,
      scope: 'regular'
    });
    _activeProxyConfig = { clientId, ...proxyConfig, setAt: Date.now() };
    // Persist the config
    try { await chrome.storage.local.set({ [`proxy_${clientId}`]: _activeProxyConfig }); } catch (_) { /* storage quota — non-fatal */ }
    return { ok: true, message: `Proxy set to ${proxyConfig.host}:${port} for ${clientId}` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Clear proxy configuration (revert to direct connection).
 */
export async function clearProxy() {
  try {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    _activeProxyConfig = null;
    return { ok: true, message: 'Proxy cleared' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Get the active proxy configuration.
 */
export function getActiveProxy() {
  return _activeProxyConfig;
}

/**
 * List all saved proxy configs.
 */
export async function listProxyConfigs() {
  try {
    const all = await chrome.storage.local.get(null);
    const configs = [];
    for (const [key, val] of Object.entries(all)) {
      if (key.startsWith('proxy_') && val && val.clientId) {
        configs.push({
          clientId: val.clientId,
          host: val.host,
          port: val.port,
          scheme: val.scheme,
          setAt: val.setAt
        });
      }
    }
    return configs;
  } catch (e) {
    return [];
  }
}
