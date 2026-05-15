// background/audit-log.js
// Per-run audit trail for MSP compliance — v3.40.0
//
// Stores a circular buffer of the last MAX_ENTRIES_PER_RUN entries per runId
// in chrome.storage.local under the key 'audit_<runId>'. The popup can request
// the log via { action: 'get_audit_log', runId } and download it as CSV.
//
// Each entry: { ts, step, type, target, outcome }

const MAX_ENTRIES_PER_RUN = 500;
const STORAGE_KEY_PREFIX = 'audit_';

/**
 * Append a single entry to the audit log for the given runId.
 * Fire-and-forget — never throws.
 */
export async function appendAuditEntry(runId, entry) {
  if (!runId) return;
  try {
    const key = STORAGE_KEY_PREFIX + String(runId).replace(/[^a-z0-9_-]/gi, '_');
    const stored = await chrome.storage.local.get(key).catch(() => ({}));
    const log = Array.isArray(stored[key]) ? stored[key] : [];
    log.push({
      ts:      entry.ts      || Date.now(),
      step:    entry.step    ?? null,
      type:    String(entry.type    || ''),
      target:  String(entry.target  || '').slice(0, 120),
      outcome: String(entry.outcome || '').slice(0, 200),
    });
    if (log.length > MAX_ENTRIES_PER_RUN) log.splice(0, log.length - MAX_ENTRIES_PER_RUN);
    await chrome.storage.local.set({ [key]: log }).catch(() => { /* storage write failed — fire-and-forget */ });
  } catch (e) { /* audit log append failed — never block the agent loop */ }
}

/**
 * Retrieve the full audit log for a runId.
 * @returns {Promise<Array>} Array of entry objects (may be empty).
 */
export async function getAuditLog(runId) {
  if (!runId) return [];
  try {
    const key = STORAGE_KEY_PREFIX + String(runId).replace(/[^a-z0-9_-]/gi, '_');
    const stored = await chrome.storage.local.get(key).catch(() => ({}));
    return Array.isArray(stored[key]) ? stored[key] : [];
  } catch (e) {
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
 * Delete the audit log for a runId from storage.
 */
export async function clearAuditLog(runId) {
  if (!runId) return;
  try {
    const key = STORAGE_KEY_PREFIX + String(runId).replace(/[^a-z0-9_-]/gi, '_');
    await chrome.storage.local.remove(key).catch(() => { /* remove failed — non-fatal */ });
  } catch (e) { /* clear audit log failed — non-fatal */ }
}
