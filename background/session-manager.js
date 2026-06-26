// ========== (v21.6) Session/Cookie Persistence ==========
// Saves and restores cookies per-client so the agent can log in once
// and run unlimited tasks without re-authenticating.

/**
 * Save all cookies for a domain, scoped to a client/tenant identifier.
 * @param {string} clientId - Tenant or client identifier
 * @param {string} domain - Cookie domain (e.g., '.microsoft.com')
 */
export async function saveSession(clientId, domain) {
  if (!clientId || !domain) return { ok: false, error: 'Missing clientId or domain' };
  try {
    const cookies = await chrome.cookies.getAll({ domain });
    const key = `session_${clientId}`;
    const data = {
      clientId,
      domain,
      cookies,
      savedAt: Date.now()
    };
    await chrome.storage.local.set({ [key]: data });
    return { ok: true, count: cookies.length };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Restore cookies for a client/tenant. Must be called BEFORE navigating
 * to the target URL so cookies are set before the page loads.
 * @param {string} clientId - Tenant or client identifier
 */
export async function restoreSession(clientId) {
  if (!clientId) return { ok: false, error: 'Missing clientId' };
  try {
    const key = `session_${clientId}`;
    const result = await chrome.storage.local.get(key);
    const data = result[key];
    if (!data || !Array.isArray(data.cookies)) {
      return { ok: false, error: 'No saved session for this client' };
    }
    const ageHours = (Date.now() - (data.savedAt || 0)) / 3600000;
    if (ageHours > 24) {
      return { ok: false, error: 'Session expired (>24h old)' };
    }
    let restored = 0;
    for (const cookie of data.cookies) {
      try {
        await chrome.cookies.set({
          url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite || 'unspecified'
        });
        restored++;
      } catch (_) { /* individual cookie failures are non-fatal */ }
    }
    return { ok: true, count: restored, domain: data.domain };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * List all saved sessions.
 */
export async function listSessions() {
  try {
    const all = await chrome.storage.local.get(null);
    const sessions = [];
    for (const [key, val] of Object.entries(all)) {
      if (key.startsWith('session_') && val && val.clientId) {
        sessions.push({
          clientId: val.clientId,
          domain: val.domain,
          cookieCount: Array.isArray(val.cookies) ? val.cookies.length : 0,
          savedAt: val.savedAt,
          ageHours: Math.round((Date.now() - (val.savedAt || 0)) / 3600000)
        });
      }
    }
    return sessions;
  } catch (e) {
    return [];
  }
}

/**
 * Delete a saved session.
 */
export async function deleteSession(clientId) {
  try {
    const key = `session_${clientId}`;
    await chrome.storage.local.remove(key);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
