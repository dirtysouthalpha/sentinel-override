// Sentinel Override v3 -- Client Knowledge (3.12.0)
//
// Per-client persistent knowledge that compounds across runs. Solves:
// "every run starts cold and forgets what it learned about Acme last time".
//
// Schema (chrome.storage.local key: sentinelClientKnowledge):
// {
//   activeClientId: "acme-corp" | null,
//   clients: {
//     "acme-corp": {
//       id: "acme-corp",
//       displayName: "Acme Corp",
//       tenant: "acme.onmicrosoft.com",     // optional
//       createdAt: "2026-05-10T...",
//       lastUsedAt: "2026-05-10T...",
//       runCount: 12,
//       entries: [
//         {
//           id: "entry_<rand>",
//           scope: "global" | "url",
//           urlPattern: "*.entra.microsoft.com",  // only if scope === "url"
//           wisdom: "Their Entra has a custom auth proxy that redirects...",
//           tags: ["entra", "timing"],
//           capturedAt: "2026-05-10T...",
//           useCount: 3
//         }
//       ]
//     }
//   }
// }
//
// Public API used by:
//   - agent-engine.js (start-of-run prompt injection)
//   - background/index.js (popup message handlers)
//   - popup-modules/* (client picker + management modal)

const STORAGE_KEY = 'sentinelClientKnowledge';

const DEFAULT_STATE = {
  activeClientId: null,
  clients: {}
};

// ========== Storage helpers ==========

async function _read() {
  try {
    const obj = await chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_STATE });
    const state = obj[STORAGE_KEY];
    if (!state || typeof state !== 'object') return { ...DEFAULT_STATE };
    if (!state.clients || typeof state.clients !== 'object') state.clients = {};
    if (typeof state.activeClientId !== 'string' && state.activeClientId !== null) state.activeClientId = null;
    return state;
  } catch (e) {
    return { ...DEFAULT_STATE };
  }
}

async function _write(state) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } catch (e) { /* storage unavailable -- non-fatal */ }
}

function _slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) || 'client-' + Date.now();
}

function _genEntryId() {
  return 'entry_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
}

// ========== Client CRUD ==========

export async function listClients() {
  const state = await _read();
  return Object.values(state.clients).sort((a, b) =>
    (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '')
  );
}

export async function getClient(id) {
  if (!id) return null;
  const state = await _read();
  return state.clients[id] || null;
}

export async function getActiveClient() {
  const state = await _read();
  if (!state.activeClientId) return null;
  return state.clients[state.activeClientId] || null;
}

export async function setActiveClient(id) {
  const state = await _read();
  if (id && !state.clients[id]) return { ok: false, error: 'Unknown client id' };
  state.activeClientId = id || null;
  await _write(state);
  return { ok: true };
}

export async function createClient({ displayName, tenant }) {
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return { ok: false, error: 'Display name is required' };
  }
  const state = await _read();
  let id = _slugify(displayName);
  // Avoid collision
  let suffix = 1;
  const baseId = id;
  while (state.clients[id]) {
    suffix += 1;
    id = `${baseId}-${suffix}`;
  }
  const now = new Date().toISOString();
  state.clients[id] = {
    id,
    displayName: displayName.trim(),
    tenant: typeof tenant === 'string' ? tenant.trim() : '',
    createdAt: now,
    lastUsedAt: now,
    runCount: 0,
    entries: []
  };
  await _write(state);
  return { ok: true, client: state.clients[id] };
}

export async function updateClient(id, updates) {
  if (!id) return { ok: false, error: 'Client id required' };
  const state = await _read();
  const c = state.clients[id];
  if (!c) return { ok: false, error: 'Client not found' };
  if (typeof updates.displayName === 'string') c.displayName = updates.displayName.trim();
  if (typeof updates.tenant === 'string') c.tenant = updates.tenant.trim();
  await _write(state);
  return { ok: true, client: c };
}

export async function deleteClient(id) {
  if (!id) return { ok: false, error: 'Client id required' };
  const state = await _read();
  if (!state.clients[id]) return { ok: false, error: 'Client not found' };
  delete state.clients[id];
  if (state.activeClientId === id) state.activeClientId = null;
  await _write(state);
  return { ok: true };
}

// ========== Entry CRUD ==========

export async function addEntry(clientId, { scope, urlPattern, wisdom, tags }) {
  if (!clientId) return { ok: false, error: 'Client id required' };
  if (!wisdom || typeof wisdom !== 'string' || !wisdom.trim()) {
    return { ok: false, error: 'Wisdom text is required' };
  }
  const state = await _read();
  const c = state.clients[clientId];
  if (!c) return { ok: false, error: 'Client not found' };
  const entry = {
    id: _genEntryId(),
    scope: scope === 'url' ? 'url' : 'global',
    urlPattern: scope === 'url' && typeof urlPattern === 'string' ? urlPattern.trim() : '',
    wisdom: wisdom.trim().substring(0, 1000),
    tags: Array.isArray(tags) ? tags.slice(0, 8).map(t => String(t).trim()).filter(Boolean) : [],
    capturedAt: new Date().toISOString(),
    useCount: 0
  };
  c.entries.push(entry);
  await _write(state);
  return { ok: true, entry };
}

export async function updateEntry(clientId, entryId, updates) {
  const state = await _read();
  const c = state.clients[clientId];
  if (!c) return { ok: false, error: 'Client not found' };
  const e = c.entries.find(x => x.id === entryId);
  if (!e) return { ok: false, error: 'Entry not found' };
  if (typeof updates.wisdom === 'string') e.wisdom = updates.wisdom.trim().substring(0, 1000);
  if (updates.scope === 'global' || updates.scope === 'url') e.scope = updates.scope;
  if (typeof updates.urlPattern === 'string') e.urlPattern = updates.urlPattern.trim();
  if (Array.isArray(updates.tags)) e.tags = updates.tags.slice(0, 8).map(t => String(t).trim()).filter(Boolean);
  await _write(state);
  return { ok: true, entry: e };
}

export async function deleteEntry(clientId, entryId) {
  const state = await _read();
  const c = state.clients[clientId];
  if (!c) return { ok: false, error: 'Client not found' };
  const before = c.entries.length;
  c.entries = c.entries.filter(x => x.id !== entryId);
  if (c.entries.length === before) return { ok: false, error: 'Entry not found' };
  await _write(state);
  return { ok: true };
}

// ========== Run-time helpers (used by agent-engine) ==========

// Match a urlPattern (glob with *) against a URL. Simple substring + wildcard.
function _urlMatches(pattern, url) {
  if (!pattern || !url) return false;
  if (!pattern.includes('*')) return url.toLowerCase().includes(pattern.toLowerCase());
  const re = new RegExp(
    '^' + pattern
      .toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') + '$'
  );
  return re.test(url.toLowerCase());
}

/**
 * Get knowledge entries relevant to the current run.
 * Returns global entries always, plus url-scoped entries that match currentUrl.
 * Does NOT increment useCount (call markEntriesUsed after the run if you want).
 */
export async function getRelevantEntries(clientId, currentUrl) {
  if (!clientId) return [];
  const state = await _read();
  const c = state.clients[clientId];
  if (!c) return [];
  const url = (currentUrl || '').toLowerCase();
  return c.entries.filter(e => {
    if (e.scope === 'global') return true;
    if (e.scope === 'url' && e.urlPattern) return _urlMatches(e.urlPattern, url);
    return false;
  });
}

/**
 * Format relevant entries as a system-prompt section.
 * Returns an empty string when there's no client / no relevant entries.
 */
export async function formatPromptSection(clientId, currentUrl) {
  if (!clientId) return '';
  const state = await _read();
  const c = state.clients[clientId];
  if (!c) return '';
  const relevant = await getRelevantEntries(clientId, currentUrl);
  if (relevant.length === 0) return '';
  const lines = relevant.map((e, i) => `${i + 1}. ${e.wisdom}`).join('\n');
  return `\n## CLIENT-SPECIFIC KNOWLEDGE for ${c.displayName}\nThese are facts learned from previous runs for this specific client. Treat as authoritative for THIS run unless the page actively contradicts them:\n\n${lines}\n`;
}

/**
 * After a successful run, increment runCount and useCount for entries
 * that were marked relevant at the start of the run. Call from agent-engine.js
 * end-of-run path.
 */
export async function markRunCompleted(clientId, usedEntryIds) {
  if (!clientId) return;
  const state = await _read();
  const c = state.clients[clientId];
  if (!c) return;
  c.runCount = (c.runCount || 0) + 1;
  c.lastUsedAt = new Date().toISOString();
  const ids = new Set(Array.isArray(usedEntryIds) ? usedEntryIds : []);
  if (ids.size > 0) {
    for (const e of c.entries) {
      if (ids.has(e.id)) e.useCount = (e.useCount || 0) + 1;
    }
  }
  await _write(state);
}

// ========== Export / Import (team sharing) ==========

export async function exportClient(clientId) {
  const state = await _read();
  const c = state.clients[clientId];
  if (!c) return null;
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    client: c
  };
}

export async function importClient(payload, { rename } = {}) {
  if (!payload || typeof payload !== 'object' || !payload.client) {
    return { ok: false, error: 'Invalid import payload' };
  }
  const incoming = payload.client;
  if (!incoming.displayName) return { ok: false, error: 'Import missing displayName' };
  const state = await _read();
  let id = _slugify(rename || incoming.displayName);
  let suffix = 1;
  const baseId = id;
  while (state.clients[id]) {
    suffix += 1;
    id = `${baseId}-${suffix}`;
  }
  const now = new Date().toISOString();
  state.clients[id] = {
    id,
    displayName: rename || incoming.displayName,
    tenant: incoming.tenant || '',
    createdAt: incoming.createdAt || now,
    lastUsedAt: now,
    runCount: 0,
    entries: Array.isArray(incoming.entries)
      ? incoming.entries.map(e => ({
          id: _genEntryId(),
          scope: e.scope === 'url' ? 'url' : 'global',
          urlPattern: typeof e.urlPattern === 'string' ? e.urlPattern : '',
          wisdom: typeof e.wisdom === 'string' ? e.wisdom.substring(0, 1000) : '',
          tags: Array.isArray(e.tags) ? e.tags.slice(0, 8) : [],
          capturedAt: e.capturedAt || now,
          useCount: 0
        })).filter(e => e.wisdom)
      : []
  };
  await _write(state);
  return { ok: true, client: state.clients[id] };
}
