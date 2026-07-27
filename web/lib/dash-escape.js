'use strict';
// ════════════════════════════════════════════════════════════════════════════
// Shared escaping + validation helpers for the Sentinel web dashboards.
//
// Deliberately contains NO `import` / `export` statements, so the exact same
// bytes load three different ways:
//
//   1. Browser classic script — <script src="lib/dash-escape.js"></script>
//      (used by web/dashboard.html, which is not a module page)
//   2. Node / Jest — `await import('.../dash-escape.js')`, then read
//      `globalThis.DashEscape`
//   3. Verbatim mirror — the region between the BEGIN/END markers below is
//      duplicated into the inline <script> of web/dashboard-prime.html, which
//      has to remain a single self-contained file that works from file://.
//      tests/web-dash-escape.test.js FAILS if the two copies drift apart, so
//      the mirror can never silently rot.
//
// Threat model: every value these guard is attacker-influenced —
//   * file / directory names from the Desktop API file listing (`'`, `"` and
//     backtick are all legal in Windows filenames)
//   * `data_uri` blobs from the file-content API
//   * agent-run `goal` strings and playbook `platform` / `goalKey` values
//     learned from browsed third-party web pages
// ════════════════════════════════════════════════════════════════════════════

// ─── BEGIN dash-escape shared block ───

// Escape a value for interpolation into HTML text OR into a QUOTED HTML
// attribute value (single- or double-quoted).
//
// The pre-v9 helper was `d.textContent = str; return d.innerHTML`, which the
// HTML spec only requires to escape `&`, `<` and `>`. That is safe for text
// nodes and unsafe for attributes: `x" onerror=alert(1) y="` survived it
// untouched and broke straight out of `<img alt="...">`.
//
// INVARIANT: callers must always place the result inside quotes. This helper
// does not escape `=` or whitespace, so an UNQUOTED attribute is still
// exploitable. Never write `<div data-x=${escHtml(v)}>`.
//
// This is NOT sufficient for a JavaScript code context. Do not interpolate the
// result into `onclick="fn('...')"` — attach listeners with addEventListener
// and close over the raw value instead, so untrusted text never becomes code.
function escHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

// Alias that documents intent at attribute call sites. Same implementation:
// the six-character escape set is simultaneously correct for text and for
// quoted attributes, and one shared code path means one thing to audit.
const escAttr = escHtml;

// Only base64 raster images. `image/svg+xml` is deliberately absent: an SVG can
// carry <script> and event handlers, so a "valid" SVG data URI is still an XSS
// vector when handed to <img> in some contexts and to navigation in others.
// The non-base64 `data:image/png,<payload>` form is also rejected, because its
// payload is unencoded and can contain quotes.
const SAFE_IMAGE_DATA_URI_RE =
  /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif|x-icon);base64,[A-Za-z0-9+/=\s]+$/i;

// 8 MiB of base64 — comfortably above any real screenshot, low enough that a
// hostile response cannot wedge the renderer.
const MAX_IMAGE_DATA_URI_LENGTH = 8 * 1024 * 1024;

function isSafeImageDataUri(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_IMAGE_DATA_URI_LENGTH) return false;
  return SAFE_IMAGE_DATA_URI_RE.test(value);
}

// ─── END dash-escape shared block ───

globalThis.DashEscape = Object.freeze({
  escHtml,
  escAttr,
  isSafeImageDataUri,
  SAFE_IMAGE_DATA_URI_RE,
  MAX_IMAGE_DATA_URI_LENGTH,
});
