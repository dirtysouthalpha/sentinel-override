// Sentinel Override -- execute_js Sandbox Script Builder
//
// Builds the source text of the inline <script> that content/index.js injects
// into the page's MAIN world for the `execute_js` action.
//
// Lives in its own file (rather than inline in content/index.js) so the
// generated source can be unit-tested by actually RUNNING it against a fake
// window/document. It previously sat inline, was never executed by any test,
// and shipped for months in a state where the sandboxed branch was a hard
// SyntaxError (see the "use strict" note in buildSandboxedScript).
//
// THREAT MODEL — read before relying on this.
// This is a guard-rail against a *mistaken or over-eager LLM*, not a security
// boundary against hostile code. The script runs in the page's own MAIN world,
// so anything the page can do, code that escapes this wrapper can also do.
// Reflective escapes such as `({}).constructor.constructor('return this')()`
// are NOT blocked here — they are caught (if at all) by the static
// privileged-API regex and the operator approval gate in content/index.js.
// The layers in front of this one are the real controls:
//   1. agent-engine approval gate
//   2. content-side approval round-trip
//   3. static privileged-API regex
//   4. this runtime wrapper

window.__sentinelUtils = window.__sentinelUtils || {};
window.__sentinelUtils.execjs = window.__sentinelUtils.execjs || {};

(function () {
  const api = window.__sentinelUtils.execjs;

  // Bare globals that must not be reachable from sandboxed code.
  const BLOCKED_APIS = new Set([
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'localStorage', 'sessionStorage', 'indexedDB',
    'open', 'close', 'stop', 'print',
    'eval', 'Function',
    'importScripts', 'Worker', 'SharedWorker', 'ServiceWorker',
    'postMessage',
    'navigator', 'location',
    'chrome',
    'crypto',
    // Window self-references — each one hands back the real window and would
    // otherwise route around the proxy entirely.
    'self', 'top', 'parent', 'frames', 'globalThis', 'window'
  ]);

  // Document properties blocked in addition to the window-level set above.
  const BLOCKED_DOC_PROPS = new Set([
    'cookie', 'domain', 'referrer', 'location', 'write', 'writeln',
    'defaultView' // returns the real window, bypassing the proxy
  ]);

  /**
   * Escape a code string so it can be embedded in a <script> element without
   * terminating it early. Defensive: we assign via textContent (which does not
   * HTML-reparse), but a future path that serialises the element would.
   *
   * @param {string} code
   * @returns {string}
   */
  function escapeForScriptTag(code) {
    return String(code == null ? '' : code).replace(/<\/script>/gi, '<\\/script>');
  }

  /**
   * Tail shared by both wrappers: serialise the result and post it back to the
   * content script, capped at 3000 chars.
   *
   * @param {string} eventIdJson - JSON.stringify'd event id.
   * @param {string} resultVar - name of the variable holding the result.
   * @returns {string}
   */
  function buildPostBack(eventIdJson, resultVar) {
    return (
      'var __s = typeof ' + resultVar + ' === "object" && ' + resultVar + ' !== null' +
        ' ? JSON.stringify(' + resultVar + ').substring(0, 3000)' +
        ' : (' + resultVar + ' === null || ' + resultVar + ' === undefined ? "" : String(' + resultVar + ')).substring(0, 3000);' +
      'window.postMessage({ __sentinelEventId: ' + eventIdJson + ', __value: __s }, window.location.origin);'
    );
  }

  /**
   * Error branch shared by both wrappers.
   *
   * @param {string} eventIdJson
   * @returns {string}
   */
  function buildCatch(eventIdJson) {
    return (
      'catch(e) {' +
        'window.postMessage({ __sentinelEventId: ' + eventIdJson + ', __error: ' +
          '(typeof e === "object" && e !== null && typeof e.message === "string" ? e.message : String(e)) }, window.location.origin);' +
      '}'
    );
  }

  /**
   * Build the SANDBOXED wrapper: user code runs behind Proxy guards on window
   * and document.
   *
   * Three defects this shape fixes, all of which shipped:
   *
   * 1. `"use strict";` at the top of the script. `with` is a SyntaxError in
   *    strict mode, so the WHOLE injected script failed to parse, never ran,
   *    never posted back, and every sandboxed execute_js call sat until the
   *    8s timeout and returned "Code execution timed out". Strictness now sits
   *    on the inner user-code function instead, where it still denies user code
   *    a `this` of globalThis but leaves the enclosing `with` legal. (A strict
   *    function nested inside `with` still resolves free names through the
   *    with-scope — verified in tests/content-execute-js-sandbox.test.js.)
   *
   * 2. The `has` traps returned FALSE for blocked names. In a `with` block that
   *    means "this scope does not have it", so the engine walked on to the next
   *    scope — the real global object — and handed back the real `fetch`,
   *    `localStorage`, `chrome`, and so on. The trap must return TRUE so the
   *    lookup is captured here and the `get` trap can throw.
   *
   * 3. Bare `document` resolved through the WINDOW proxy (`'document' in window`
   *    is true) and so returned the REAL document — `document.cookie` was never
   *    blocked. The window proxy now returns the document proxy for that key.
   *    The old `var document = __dp;` could not work: inside `with(__wp)` the
   *    assignment targeted `window.document`, an accessor with no setter, and
   *    was silently discarded.
   *
   * @param {string} code - user JavaScript to run.
   * @param {string} eventId - correlation id posted back with the result.
   * @param {Iterable<string>} [blockedApis=BLOCKED_APIS]
   * @param {Iterable<string>} [blockedDocProps=BLOCKED_DOC_PROPS]
   * @returns {string} script source
   */
  function buildSandboxedScript(code, eventId, blockedApis, blockedDocProps) {
    const safeCode = escapeForScriptTag(code);
    const eventIdJson = JSON.stringify(eventId);
    const blkArr = JSON.stringify([...(blockedApis || BLOCKED_APIS)]);
    const blkDocArr = JSON.stringify([...(blockedDocProps || BLOCKED_DOC_PROPS)]);

    // Names assigned INSIDE the `with` blocks must not collide with anything on
    // the page, or the page's property would shadow ours. eventId carries a
    // timestamp plus Math.random, so deriving from it makes collision a
    // non-issue. Sanitised to a bare identifier.
    const fnVar = '__sfn_' + String(eventId).replace(/[^A-Za-z0-9_$]/g, '_');

    return (
      '(async () => {' +
        'try {' +
          'var __blk = new Set(' + blkArr + ');' +
          'var __blkDoc = new Set(' + blkDocArr + ');' +
          'var __bind = function (t, v) { return typeof v === "function" ? v.bind(t) : v; };' +
          // Document proxy first — the window proxy hands it back for `document`.
          'var __dp = new Proxy(document, {' +
            'get(t,p) {' +
              'if(__blkDoc.has(p)) throw new Error("Sentinel Sandbox: blocked document." + String(p));' +
              'return __bind(t, t[p]);' +
            '},' +
            'set(t,p,v) {' +
              'if(__blkDoc.has(p)) throw new Error("Sentinel Sandbox: blocked write document." + String(p));' +
              't[p]=v; return true;' +
            '},' +
            // TRUE, not false: in a `with` scope false means "look further out",
            // which lands on the real global.
            'has(t,p) { return __blkDoc.has(p) ? true : (p in t); },' +
            'deleteProperty(t,p) {' +
              'if(__blkDoc.has(p)) throw new Error("Sentinel Sandbox: blocked delete document." + String(p));' +
              'delete t[p]; return true;' +
            '}' +
          '});' +
          'var __wp = new Proxy(window, {' +
            'get(t,p) {' +
              'if(p === "document") return __dp;' +
              'if(__blk.has(p)) throw new Error("Sentinel Sandbox: blocked window." + String(p));' +
              'return __bind(t, t[p]);' +
            '},' +
            'set(t,p,v) {' +
              'if(__blk.has(p)) throw new Error("Sentinel Sandbox: blocked write window." + String(p));' +
              't[p]=v; return true;' +
            '},' +
            'has(t,p) { return __blk.has(p) ? true : (p in t); },' +
            'deleteProperty(t,p) {' +
              'if(__blk.has(p)) throw new Error("Sentinel Sandbox: blocked delete window." + String(p));' +
              'delete t[p]; return true;' +
            '}' +
          '});' +
          'var ' + fnVar + ';' +
          // The function is DEFINED inside the `with` blocks (so its free names
          // resolve through the proxies) but CALLED outside them, so nothing but
          // the definition happens in scope we do not control. `.call(undefined)`
          // plus the inner "use strict" leaves `this` undefined in user code,
          // closing the `this.fetch` / `this.window` route.
          'with(__wp) { with(__dp) {' +
            fnVar + ' = async function () { "use strict";\n' + safeCode + '\n };' +
          '}}' +
          'var __r = await ' + fnVar + '.call(undefined);' +
          buildPostBack(eventIdJson, '__r') +
        '} ' + buildCatch(eventIdJson) +
      '})();'
    );
  }

  /**
   * Build the UNSANDBOXED wrapper, used when an operator has explicitly
   * approved this exact code. Full page privileges, as before the sandbox
   * existed.
   *
   * @param {string} code
   * @param {string} eventId
   * @returns {string} script source
   */
  function buildUnsandboxedScript(code, eventId) {
    const safeCode = escapeForScriptTag(code);
    const eventIdJson = JSON.stringify(eventId);
    return (
      '(async () => {' +
        'try {' +
          'const __r = await (async () => { ' + safeCode + '\n })();' +
          buildPostBack(eventIdJson, '__r') +
        '} ' + buildCatch(eventIdJson) +
      '})();'
    );
  }

  api.BLOCKED_APIS = BLOCKED_APIS;
  api.BLOCKED_DOC_PROPS = BLOCKED_DOC_PROPS;
  api.escapeForScriptTag = escapeForScriptTag;
  api.buildSandboxedScript = buildSandboxedScript;
  api.buildUnsandboxedScript = buildUnsandboxedScript;
})();
