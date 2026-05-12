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

// Cached level — re-read from storage on settings change. Avoids per-emit
// async storage.get which would tank perf.
let _currentLevel = 'normal';
let _seq = 0;  // monotonic event sequence so the panel can detect drops

(function loadLevel() {
  try {
    chrome.storage.local.get(['telemetryLevel'], (r) => {
      if (r && typeof r.telemetryLevel === 'string') _currentLevel = r.telemetryLevel;
    });
    // React to settings changes immediately
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.telemetryLevel) {
        _currentLevel = changes.telemetryLevel.newValue || 'normal';
      }
    });
  } catch (e) { /* non-fatal */ }
})();

function _shouldEmit(level) {
  const lvl = LEVELS[level] != null ? LEVELS[level] : LEVELS.info;
  const threshold = _currentLevel === 'debug' ? LEVELS.trace
    : _currentLevel === 'verbose' ? LEVELS.debug
    : _currentLevel === 'quiet' ? LEVELS.error
    : LEVELS.info;  // 'normal' default
  return lvl >= threshold;
}

/**
 * Emit a telemetry event. Always returns synchronously; broadcast is
 * fire-and-forget. Safe to call from anywhere in the background context.
 *
 * @param {string} category One of KNOWN_CATEGORIES (any string is allowed; unknown ones still emit).
 * @param {string} level 'error' | 'warn' | 'info' | 'debug' | 'trace'
 * @param {string} message Human-readable one-liner. Keep under ~200 chars for clean panel display.
 * @param {object} [payload] Optional structured detail (truncated in the panel; full payload in console).
 */
export function emit(category, level, message, payload) {
  // Errors always pass through level gate
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

  // Console mirror — visible in SW DevTools
  try {
    const consoleArgs = ['[Sentinel/' + event.category + ']', event.message];
    if (payload) consoleArgs.push(payload);
    if (level === 'error') console.error.apply(console, consoleArgs);
    else if (level === 'warn') console.warn.apply(console, consoleArgs);
    else if (level === 'debug' || level === 'trace') console.debug.apply(console, consoleArgs);
    else console.log.apply(console, consoleArgs);
  } catch (e) {}

  // Popup broadcast — non-blocking
  try {
    chrome.runtime.sendMessage(event).catch(() => {});
  } catch (e) {
    // chrome.runtime may not exist in test contexts
  }
}

/** Convenience wrappers for less typing at call sites. */
export const tel = {
  error: (cat, msg, pl) => emit(cat, 'error', msg, pl),
  warn:  (cat, msg, pl) => emit(cat, 'warn',  msg, pl),
  info:  (cat, msg, pl) => emit(cat, 'info',  msg, pl),
  debug: (cat, msg, pl) => emit(cat, 'debug', msg, pl),
  trace: (cat, msg, pl) => emit(cat, 'trace', msg, pl),
};

/** Listing for the panel's filter-chip UI. */
export function listCategories() {
  return KNOWN_CATEGORIES.slice();
}

/** Read the current level for the settings UI. */
export function getLevel() {
  return _currentLevel;
}
