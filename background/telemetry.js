// background/telemetry.js
// Live Telemetry — v3.25.0
//
// Solves the "agent black box" problem: when something hangs or behaves
// oddly, the user has no visibility into what's happening internally. This
// module exposes a single emit() API that fans out to:
//   1. chrome.runtime.sendMessage — the popup's telemetry panel subscribes
//      and renders a live stream.
//   2. console.log/warn/error — visible in chrome://extensions service
//      worker DevTools for deep debugging.
//   3. (Future) Forensic run log integration — append-only durable record.
//
// Verbosity is controlled by chrome.storage.local.telemetryLevel:
//   'quiet'   — error only
//   'normal'  — error + warn + info (DEFAULT)
//   'verbose' — error + warn + info + debug
//   'debug'   — all levels including trace
//
// Categories (passed as the first arg) classify events for filtering in
// the panel UI. Keep them stable — the panel's filter chips use them.

const LEVELS = { error: 4, warn: 3, info: 2, debug: 1, trace: 0 };

const KNOWN_CATEGORIES = [
  'llm',          // LLM API calls
  'skill',        // Recovery skill consultations + applications
  'platform',     // Platform profile detection / context injection
  'memory',       // Agent memory writes / rejections
  'cdp',          // Chrome DevTools Protocol attach/detach/eval
  'page',         // Page observation / read_page / dismiss_overlay
  'sleep',        // Human-like delays between steps
  'storage',      // chrome.storage writes (run log, history, settings)
  'network',      // read_network_requests captures
  'lifecycle',    // Agent start/finish/pause/resume/step transitions
  'error',        // Errors in any path (always shown regardless of level)
];

let _currentLevel = 'normal';
let _seq = 0;

const MAX_PERSISTED_RUNS = 5;
const PERSIST_FLUSH_INTERVAL_MS = 5000;
const PERSIST_MAX_EVENTS_PER_RUN = 1000;
let _currentRunId = null;
let _currentRunGoal = '';
let _currentRunStartedAt = 0;
let _runBuffer = [];
let _persistEnabled = false;
let _persistFlushTimer = null;
let _pendingPersistFlush = false;

(function loadLevel() {
  try {
    chrome.storage.local.get(['telemetryLevel', 'telemetryPersist'], (r) => {
      if (r && typeof r.telemetryLevel === 'string') _currentLevel = r.telemetryLevel;
      if (r && typeof r.telemetryPersist === 'boolean') _persistEnabled = r.telemetryPersist;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.telemetryLevel) {
        _currentLevel = changes.telemetryLevel.newValue || 'normal';
      }
      if (changes.telemetryPersist) {
        _persistEnabled = !!changes.telemetryPersist.newValue;
        if (!_persistEnabled) {
          _runBuffer = [];
          if (_persistFlushTimer) { clearInterval(_persistFlushTimer); _persistFlushTimer = null; }
        } else if (_persistEnabled && _currentRunId && !_persistFlushTimer) {
          _scheduleFlush();
        }
      }
    });
  } catch (e) {}
})();

function _scheduleFlush() {
  if (_persistFlushTimer) return;
  _persistFlushTimer = setInterval(() => {
    if (_pendingPersistFlush) _flushRunBuffer().catch(() => {});
  }, PERSIST_FLUSH_INTERVAL_MS);
}

async function _flushRunBuffer() {
  if (!_persistEnabled || !_currentRunId || _runBuffer.length === 0) return;
  _pendingPersistFlush = false;
  const key = 'telemetry_run_' + _currentRunId;
  try {
    const stored = await chrome.storage.local.get(key);
    const existing = Array.isArray(stored[key]) ? stored[key] : [];
    const merged = existing.concat(_runBuffer);
    _runBuffer = [];
    const capped = merged.length > PERSIST_MAX_EVENTS_PER_RUN
      ? merged.slice(-PERSIST_MAX_EVENTS_PER_RUN)
      : merged;
    await chrome.storage.local.set({ [key]: capped });
  } catch (e) {
    _runBuffer = [];
  }
}

export async function startRun(runId, goal) {
  _currentRunId = runId || null;
  _currentRunGoal = (goal || '').substring(0, 200);
  _currentRunStartedAt = Date.now();
  _runBuffer = [];
  if (!_persistEnabled || !_currentRunId) return;
  try {
    const stored = await chrome.storage.local.get('telemetry_runs_index');
    const index = Array.isArray(stored.telemetry_runs_index) ? stored.telemetry_runs_index : [];
    index.unshift({
      runId: _currentRunId,
      goal: _currentRunGoal,
      startedAt: _currentRunStartedAt,
      finishedAt: null,
      count: 0
    });
    const toEvict = index.splice(MAX_PERSISTED_RUNS);
    for (const old of toEvict) {
      try { await chrome.storage.local.remove('telemetry_run_' + old.runId); } catch (e) {}
    }
    await chrome.storage.local.set({ telemetry_runs_index: index });
    _scheduleFlush();
  } catch (e) {}
}

export async function endRun(runId) {
  if (_persistFlushTimer) { clearInterval(_persistFlushTimer); _persistFlushTimer = null; }
  const id = runId || _currentRunId;
  if (!_persistEnabled || !id) {
    _currentRunId = null;
    _runBuffer = [];
    return;
  }
  try {
    await _flushRunBuffer();
    const stored = await chrome.storage.local.get(['telemetry_runs_index', 'telemetry_run_' + id]);
    const index = Array.isArray(stored.telemetry_runs_index) ? stored.telemetry_runs_index : [];
    const events = Array.isArray(stored['telemetry_run_' + id]) ? stored['telemetry_run_' + id] : [];
    const entry = index.find(e => e.runId === id);
    if (entry) {
      entry.finishedAt = Date.now();
      entry.count = events.length;
      await chrome.storage.local.set({ telemetry_runs_index: index });
    }
  } catch (e) {}
  _currentRunId = null;
  _runBuffer = [];
}

export async function listPersistedRuns() {
  try {
    const stored = await chrome.storage.local.get('telemetry_runs_index');
    return Array.isArray(stored.telemetry_runs_index) ? stored.telemetry_runs_index : [];
  } catch (e) { return []; }
}

export async function loadPersistedRun(runId) {
  if (!runId) return [];
  try {
    const stored = await chrome.storage.local.get('telemetry_run_' + runId);
    return Array.isArray(stored['telemetry_run_' + runId]) ? stored['telemetry_run_' + runId] : [];
  } catch (e) { return []; }
}

export async function deletePersistedRun(runId) {
  if (!runId) return;
  try {
    const stored = await chrome.storage.local.get('telemetry_runs_index');
    const index = Array.isArray(stored.telemetry_runs_index) ? stored.telemetry_runs_index : [];
    const filtered = index.filter(e => e.runId !== runId);
    await chrome.storage.local.set({ telemetry_runs_index: filtered });
    await chrome.storage.local.remove('telemetry_run_' + runId);
  } catch (e) {}
}

function _shouldEmit(level) {
  const lvl = LEVELS[level] != null ? LEVELS[level] : LEVELS.info;
  const threshold = _currentLevel === 'debug' ? LEVELS.trace
    : _currentLevel === 'verbose' ? LEVELS.debug
    : _currentLevel === 'quiet' ? LEVELS.error
    : LEVELS.info;
  return lvl >= threshold;
}

export function emit(category, level, message, payload) {
  if (level !== 'error' && !_shouldEmit(level)) return;
  _seq++;
  const event = {
    action: 'telemetry_event',
    ts: Date.now(),
    seq: _seq,
    category: String(category || 'misc'),
    level: String(level || 'info'),
    message: String(message || '').substring(0, 500),
    payload: payload || null
  };
  try {
    const consoleArgs = ['[Sentinel/' + event.category + ']', event.message];
    if (payload) consoleArgs.push(payload);
    if (level === 'error') console.error.apply(console, consoleArgs);
    else if (level === 'warn') console.warn.apply(console, consoleArgs);
    else if (level === 'debug' || level === 'trace') console.debug.apply(console, consoleArgs);
    else console.log.apply(console, consoleArgs);
  } catch (e) {}
  try {
    chrome.runtime.sendMessage(event).catch(() => {});
  } catch (e) {}
  if (_currentRunId && _persistEnabled) {
    try {
      _runBuffer.push(event);
      _pendingPersistFlush = true;
      if (_runBuffer.length >= 200) {
        _flushRunBuffer().catch(() => {});
      }
    } catch (e) {}
  }
}

export const tel = {
  error: (cat, msg, pl) => emit(cat, 'error', msg, pl),
  warn:  (cat, msg, pl) => emit(cat, 'warn',  msg, pl),
  info:  (cat, msg, pl) => emit(cat, 'info',  msg, pl),
  debug: (cat, msg, pl) => emit(cat, 'debug', msg, pl),
  trace: (cat, msg, pl) => emit(cat, 'trace', msg, pl),
};

export function listCategories() {
  return KNOWN_CATEGORIES.slice();
}

export function getLevel() {
  return _currentLevel;
}
