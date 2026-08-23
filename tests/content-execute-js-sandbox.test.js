// tests/content-execute-js-sandbox.test.js
//
// These tests do what no test did before: they take the exact source string
// that content/index.js injects into the page for `execute_js` and RUN it,
// against a stand-in window/document, then assert on what the sandboxed code
// could and could not reach.
//
// Three shipped defects are pinned here. Each one is a "fails first" test:
// reverting the corresponding line in content/execute-js-sandbox.js turns the
// matching test red.
//
//   1. PARSE — the wrapper opened with `"use strict";` and contained a `with`
//      statement. `with` is a SyntaxError in strict mode, so the whole injected
//      script failed to parse, nothing ran, nothing posted back, and every
//      sandboxed execute_js returned "Code execution timed out (8000ms)".
//
//   2. HAS TRAP — both proxies returned FALSE from `has` for blocked names.
//      Inside `with`, false means "not in this scope", so the engine walked out
//      to the real global and handed back the real fetch / localStorage / chrome.
//      The deny-list made the APIs *more* reachable than doing nothing.
//
//   3. BARE `document` — resolved through the WINDOW proxy (`'document' in
//      window` is true), returning the real document, so `document.cookie` was
//      never blocked despite being the headline example in the code comments.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load the content-script module (window-global style, like its siblings) ──
globalThis.window = globalThis.window || globalThis;
globalThis.window.__sentinelUtils = {};
await import('../content/execute-js-sandbox.js');
const execjs = globalThis.window.__sentinelUtils.execjs;

const SRC = readFileSync(join(__dirname, '../content/execute-js-sandbox.js'), 'utf8');

// ── Fake page environment ────────────────────────────────────────────────────
// Runs the generated wrapper with stand-ins for window and document and
// resolves with whatever the wrapper posts back.
function runWrapper(src, { docExtras = {}, winExtras = {} } = {}) {
  return new Promise((resolve, reject) => {
    const posted = [];

    const fakeDoc = {
      cookie: 'session=SUPERSECRET',
      domain: 'victim.example',
      referrer: 'https://referrer.example',
      title: 'Fake Page',
      write() { posted.push('DOCUMENT_WRITE_CALLED'); },
      writeln() {},
      querySelector: (sel) => ({ tagName: 'DIV', textContent: 'hit:' + sel }),
      getElementById: (id) => ({ id, textContent: 'byid:' + id }),
      body: { innerText: 'BODY TEXT' },
      ...docExtras,
    };

    const fakeWin = {
      location: { origin: 'https://victim.example', href: 'https://victim.example/p' },
      document: fakeDoc,
      fetch: () => 'REAL_FETCH_REACHED',
      localStorage: { getItem: () => 'REAL_LOCALSTORAGE_REACHED' },
      chrome: { runtime: { id: 'REAL_CHROME_REACHED' } },
      navigator: { userAgent: 'REAL_NAVIGATOR_REACHED' },
      crypto: { randomUUID: () => 'REAL_CRYPTO' },
      atob: (s) => s,
      safeGlobal: 'SAFE_VALUE',
      ...winExtras,
    };
    fakeWin.window = fakeWin;
    fakeWin.self = fakeWin;
    fakeWin.top = fakeWin;
    fakeWin.parent = fakeWin;
    fakeWin.frames = fakeWin;
    fakeDoc.defaultView = fakeWin;

    const timer = setTimeout(() => reject(new Error('wrapper never posted back')), 4000);
    fakeWin.postMessage = (msg) => {
      clearTimeout(timer);
      resolve({ msg, posted, fakeWin, fakeDoc });
    };

    let fn;
    try {
      // Throws SyntaxError if the wrapper does not parse — defect (1).
      fn = new Function('window', 'document', src);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    try {
      fn(fakeWin, fakeDoc);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

const build = (code) => execjs.buildSandboxedScript(code, '__sentinel_1_abc');

// ═══════════════════════════════════════════════════════════════════════════
describe('module surface', () => {
  test('exposes builders and the deny lists on window.__sentinelUtils.execjs', () => {
    expect(typeof execjs.buildSandboxedScript).toBe('function');
    expect(typeof execjs.buildUnsandboxedScript).toBe('function');
    expect(execjs.BLOCKED_APIS).toBeInstanceOf(Set);
    expect(execjs.BLOCKED_DOC_PROPS).toBeInstanceOf(Set);
  });

  test('deny list still covers the window self-references and privileged APIs', () => {
    for (const k of ['fetch', 'XMLHttpRequest', 'localStorage', 'chrome', 'eval',
      'Function', 'navigator', 'location', 'self', 'top', 'parent', 'frames',
      'globalThis', 'window']) {
      expect(execjs.BLOCKED_APIS.has(k)).toBe(true);
    }
    for (const k of ['cookie', 'domain', 'referrer', 'write', 'writeln', 'defaultView']) {
      expect(execjs.BLOCKED_DOC_PROPS.has(k)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('defect 1 — the wrapper must parse', () => {
  test('sandboxed wrapper is syntactically valid JavaScript', () => {
    expect(() => new Function('window', 'document', build('return 1;'))).not.toThrow();
  });

  test('unsandboxed wrapper is syntactically valid JavaScript', () => {
    expect(() => new Function('window', 'document',
      execjs.buildUnsandboxedScript('return 1;', 'e1'))).not.toThrow();
  });

  test('the source never puts a strict-mode directive around the `with` blocks', () => {
    // The regression, stated directly: a top-level "use strict" in the emitted
    // wrapper makes `with` a SyntaxError. Strictness belongs on the inner
    // user-code function only.
    const out = build('return 1;');
    expect(out).toContain('with(__wp)');
    expect(out.indexOf('"use strict"')).toBeGreaterThan(out.indexOf('with(__wp)'));
    expect(out.trimStart().startsWith('"use strict"')).toBe(false);
  });

  test('a sandboxed run actually reaches the postback', async () => {
    const { msg } = await runWrapper(build('return 2 + 3;'));
    expect(msg.__sentinelEventId).toBe('__sentinel_1_abc');
    expect(msg.__value).toBe('5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('defect 2 — blocked globals must not fall through to the real global', () => {
  const cases = [
    ['fetch', 'return typeof fetch;'],
    ['localStorage', 'return localStorage.getItem("x");'],
    ['chrome', 'return chrome.runtime.id;'],
    ['navigator', 'return navigator.userAgent;'],
    ['XMLHttpRequest', 'return new XMLHttpRequest();'],
    ['eval', 'return eval("1+1");'],
    ['Function', 'return Function("return 1")();'],
    ['crypto', 'return crypto.randomUUID();'],
  ];

  test.each(cases)('bare %s is blocked, not resolved from the real global', async (name, code) => {
    const { msg } = await runWrapper(build(code));
    expect(msg.__error).toMatch(/Sentinel Sandbox: blocked window\./);
    expect(msg.__error).toContain(name);
    expect(msg.__value).toBeUndefined();
  });

  test('window / self / top / parent / frames / globalThis are all blocked', async () => {
    for (const name of ['window', 'self', 'top', 'parent', 'frames', 'globalThis']) {
      const { msg } = await runWrapper(build(`return ${name};`));
      expect(msg.__error).toBe(`Sentinel Sandbox: blocked window.${name}`);
    }
  });

  test('assigning to a blocked global is blocked too', async () => {
    const { msg } = await runWrapper(build('fetch = 1; return "assigned";'));
    expect(msg.__error).toMatch(/blocked write window\.fetch/);
  });

  test('`in` checks see blocked names as present (has trap returns true)', async () => {
    // Belt and braces on the trap direction: `has` returning false is what let
    // the lookup escape, so assert the observable consequence directly.
    const { msg } = await runWrapper(build('return 1;'));
    expect(msg.__value).toBe('1');
    expect(build('x').includes('__blk.has(p) ? true : (p in t)')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('defect 3 — document must resolve to the document proxy', () => {
  test('document.cookie is blocked', async () => {
    const { msg } = await runWrapper(build('return document.cookie;'));
    expect(msg.__error).toBe('Sentinel Sandbox: blocked document.cookie');
    expect(msg.__value).toBeUndefined();
  });

  test('document.domain / referrer / defaultView are blocked', async () => {
    for (const prop of ['domain', 'referrer', 'defaultView']) {
      const { msg } = await runWrapper(build(`return document.${prop};`));
      expect(msg.__error).toBe(`Sentinel Sandbox: blocked document.${prop}`);
    }
  });

  test('document.write is blocked and never invoked', async () => {
    const { msg, posted } = await runWrapper(build('document.write("x"); return "wrote";'));
    expect(msg.__error).toMatch(/blocked document\.write/);
    expect(posted).not.toContain('DOCUMENT_WRITE_CALLED');
  });

  test('writing document.cookie is blocked', async () => {
    const { msg, fakeDoc } = await runWrapper(build('document.cookie = "evil=1"; return "set";'));
    expect(msg.__error).toMatch(/blocked write document\.cookie/);
    expect(fakeDoc.cookie).toBe('session=SUPERSECRET');
  });

  test('bare cookie (no `document.` prefix) is blocked via the document with-scope', async () => {
    const { msg } = await runWrapper(build('return cookie;'));
    expect(msg.__error).toBe('Sentinel Sandbox: blocked document.cookie');
  });

  test('deleting a blocked document prop is blocked', async () => {
    const { msg } = await runWrapper(build('delete document.cookie; return "deleted";'));
    expect(msg.__error).toMatch(/blocked delete document\.cookie/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('legitimate DOM work still succeeds', () => {
  test('document.querySelector works through the proxy', async () => {
    const { msg } = await runWrapper(build('return document.querySelector("h1").textContent;'));
    expect(msg.__error).toBeUndefined();
    expect(msg.__value).toBe('hit:h1');
  });

  test('bare querySelector works through the document with-scope', async () => {
    const { msg } = await runWrapper(build('return querySelector("#a").textContent;'));
    expect(msg.__value).toBe('hit:#a');
  });

  test('document.body.innerText works', async () => {
    const { msg } = await runWrapper(build('return document.body.innerText;'));
    expect(msg.__value).toBe('BODY TEXT');
  });

  test('methods keep their receiver (proxy get binds functions)', async () => {
    const { msg } = await runWrapper(build('const q = document.getElementById; return q("z").textContent;'));
    expect(msg.__value).toBe('byid:z');
  });

  test('non-blocked window globals still resolve', async () => {
    const { msg } = await runWrapper(build('return safeGlobal;'));
    expect(msg.__value).toBe('SAFE_VALUE');
  });

  test('objects are JSON-serialised and capped at 3000 chars', async () => {
    const { msg } = await runWrapper(build('return { a: 1, b: "two" };'));
    expect(msg.__value).toBe('{"a":1,"b":"two"}');

    const { msg: big } = await runWrapper(build('return "x".repeat(5000);'));
    expect(big.__value.length).toBe(3000);
  });

  test('null and undefined results post back as an empty string', async () => {
    expect((await runWrapper(build('return null;'))).msg.__value).toBe('');
    expect((await runWrapper(build('return undefined;'))).msg.__value).toBe('');
  });

  test('await works inside user code', async () => {
    const { msg } = await runWrapper(build('const v = await Promise.resolve(7); return v * 2;'));
    expect(msg.__value).toBe('14');
  });

  test('a throw in user code is reported, not swallowed', async () => {
    const { msg } = await runWrapper(build('throw new Error("boom");'));
    expect(msg.__error).toBe('boom');
  });

  test('a non-Error throw is stringified', async () => {
    const { msg } = await runWrapper(build('throw "plain string";'));
    expect(msg.__error).toBe('plain string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('this-binding and code embedding', () => {
  test('`this` is undefined inside user code, so this.fetch is not a route out', async () => {
    const { msg } = await runWrapper(build('return typeof this;'));
    expect(msg.__value).toBe('undefined');
  });

  test('backticks and ${} in user code cannot break out of the wrapper', async () => {
    const evil = 'return `a${1 + 1}b`;';
    const { msg } = await runWrapper(build(evil));
    expect(msg.__value).toBe('a2b');
  });

  test('</script> in user code is escaped', () => {
    const out = build('return "</script><script>alert(1)</script>";');
    expect(out).not.toMatch(/<\/script>/i);
    expect(out).toContain('<\\/script>');
  });

  test('escapeForScriptTag handles null/undefined without throwing', () => {
    expect(execjs.escapeForScriptTag(null)).toBe('');
    expect(execjs.escapeForScriptTag(undefined)).toBe('');
  });

  test('the inner function name is derived from the eventId so a page global cannot shadow it', () => {
    const out = execjs.buildSandboxedScript('return 1;', '__sentinel_123_xyz');
    expect(out).toContain('__sfn___sentinel_123_xyz');
    // and it is a legal identifier even when the id has hostile characters
    const weird = execjs.buildSandboxedScript('return 1;', 'a-b.c d');
    expect(weird).toContain('__sfn_a_b_c_d');
    expect(() => new Function('window', 'document', weird)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('unsandboxed path (explicitly operator-approved code)', () => {
  test('reaches privileged APIs, as approved code is meant to', async () => {
    const src = execjs.buildUnsandboxedScript('return window.fetch();', 'e9');
    const { msg } = await runWrapper(src);
    expect(msg.__value).toBe('REAL_FETCH_REACHED');
  });

  test('still posts back with the right event id', async () => {
    const src = execjs.buildUnsandboxedScript('return document.cookie;', 'e10');
    const { msg } = await runWrapper(src);
    expect(msg.__sentinelEventId).toBe('e10');
    expect(msg.__value).toBe('session=SUPERSECRET');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('source-level guard rails', () => {
  test('the module documents that this is not a boundary against hostile code', () => {
    expect(SRC).toMatch(/THREAT MODEL/);
    expect(SRC.replace(/\n\s*\/\/\s*/g, ' ')).toMatch(/not a security boundary/i);
  });

  test('content/index.js injects the module before it and fails closed without it', () => {
    const idx = readFileSync(join(__dirname, '../content/index.js'), 'utf8');
    expect(idx).toContain('window.__sentinelUtils.execjs');
    expect(idx).toContain('execute_js sandbox module unavailable');
    const tm = readFileSync(join(__dirname, '../background/tab-manager.js'), 'utf8');
    const files = tm.slice(tm.indexOf('CONTENT_SCRIPT_FILES'));
    expect(files.indexOf("'content/execute-js-sandbox.js'"))
      .toBeLessThan(files.indexOf("'content/index.js'"));
  });
});
