// background/audit-log.js
// Per-run audit trail for MSP compliance — v3.40.0
//
// Stores a circular buffer of the last MAX_ENTRIES_PER_RUN entries per runId
// in chrome.storage.local under the key 'audit_<runId>'. The popup can request
// the log via { action: 'get_audit_log', runId } and download it as CSV.
//
// Each entry: { ts, step, type, target, outcome }
//
// Performance: an in-memory cache eliminates the read-before-write that was
// happening on every appendAuditEntry call. The cache is populated on first
// access and kept in sync; clearAuditLog evicts the cache entry.

const MAX_ENTRIES_PER_RUN = 500;
const STORAGE_KEY_PREFIX = 'audit_';

const _cache = new Map(); // runId → log array (single source of truth during a run)

function _storageKey(runId) {
  return STORAGE_KEY_PREFIX + String(runId).replace(/[^a-z0-9_-]/gi, '_');
}

/**
 * Append a single entry to the audit log for the given runId.
 * Fire-and-forget — never throws.
 */
export async function appendAuditEntry(runId, entry) {
  if (!runId) return;
  try {
    const key = _storageKey(runId);
    let log = _cache.get(runId);
    if (!log) {
      // Cold start: load from storage once, then keep in cache
      const stored = await chrome.storage.local.get(key).catch(() => ({}));
      log = Array.isArray(stored[key]) ? stored[key] : [];
      _cache.set(runId, log);
    }
    log.push({
      ts:      entry.ts      || Date.now(),
      step:    entry.step    ?? null,
      type:    String(entry.type    || ''),
      target:  String(entry.target  || '').slice(0, 120),
      outcome: String(entry.outcome || '').slice(0, 200),
    });
    if (log.length > MAX_ENTRIES_PER_RUN) log.splice(0, log.length - MAX_ENTRIES_PER_RUN);
    await chrome.storage.local.set({ [key]: log }).catch((e) => {
      console.error('[audit-log] Error:', e);
    });
  } catch (e) { console.warn('[Sentinel/audit-log] appendAuditEntry failed:', e && e.message); }
}

/**
 * Retrieve the full audit log for a runId.
 * Returns the in-memory cache when available; falls back to storage.
 * @returns {Promise<Array>} Array of entry objects (may be empty).
 */
export async function getAuditLog(runId) {
  if (!runId) return [];
  if (_cache.has(runId)) return _cache.get(runId).slice();
  try {
    const key = _storageKey(runId);
    const stored = await chrome.storage.local.get(key).catch(() => ({}));
    return Array.isArray(stored[key]) ? stored[key] : [];
  } catch {
    /* storage read failed — return empty log rather than crashing */
    return [];
  }
}

/**
 * Convert an audit log array to a CSV string.
 */
export function auditLogToCsv(log) {
  const header = 'timestamp,step,type,target,outcome';
  const rows = (log || []).map(e => {
    const ts = new Date(e.ts || 0).toISOString();
    return [ts, e.step ?? '', e.type, e.target, e.outcome]
      .map(v => '"' + String(v).replace(/"/g, '""') + '"')
      .join(',');
  });
  return [header, ...rows].join('\r\n');
}

/**
 * Delete the audit log for a runId from storage and evict the in-memory cache.
 */
export async function clearAuditLog(runId) {
  if (!runId) return;
  _cache.delete(runId);
  try {
    const key = _storageKey(runId);
    await chrome.storage.local.remove(key).catch((e) => {
      console.error('[audit-log] remove failed:', e);
    });
  } catch (e) { console.warn('[Sentinel/audit-log] clearAuditLog failed:', e && e.message); }
}

/**
 * Evict the in-memory cache for a runId (e.g. at end of run so the next read
 * comes from storage and reflects any cross-process writes).
 * @param {string} runId
 */
export function evictAuditCache(runId) {
  if (runId) _cache.delete(runId);
}

/** Clear the entire in-memory cache (test isolation only). */
export function _resetAuditCacheForTesting() {
  _cache.clear();
}
