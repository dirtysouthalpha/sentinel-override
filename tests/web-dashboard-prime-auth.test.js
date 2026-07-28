// API-token handling for web/dashboard-prime.html.
//
// Sentinel Desktop v31 gates every route behind a bearer token - including
// /status, which used to be open. Without this the dashboard silently 401s on
// every panel. These tests prove the token is actually attached, that a rejected
// token is discarded rather than retried forever, and - most importantly - that
// no credential is ever hardcoded into this version-controlled page.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIME_PATH = path.join(HERE, '..', 'web', 'dashboard-prime.html');
const html = fs.readFileSync(PRIME_PATH, 'utf8');
const TOKEN_KEY = 'sentinel-api-token';

function inlineScript(source) {
  const { document } = parseHTML(source);
  const scripts = [...document.querySelectorAll('script')].filter((s) => !s.getAttribute('src'));
  return scripts.map((s) => s.textContent || '').join('\n');
}

/** Boot the dashboard with a caller-controlled localStorage and fetch spy. */
async function boot({ seedToken = null, respond } = {}) {
  const { document, window, location } = parseHTML(html);
  const store = new Map();
  if (seedToken) store.set(TOKEN_KEY, seedToken);
  const calls = [];

  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return respond(String(url), init || {});
  };

  const sandbox = {
    document,
    window,
    location: location || { protocol: 'http:', host: 'localhost:8091' },
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchImpl,
    AbortSignal: { timeout: () => new AbortController().signal, any: (s) => s[0] },
    AbortController,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    WebSocket: function WebSocketStub() { this.close = () => {}; },
    navigator: { clipboard: { writeText: async () => {} } },
    Promise, Object, Array, String, Number, Math, JSON, Date, Error, RegExp, isFinite, parseInt,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.window.innerWidth = 1400;
  // No window.prompt in the sandbox: the code must cope with prompting being
  // unavailable rather than throwing.

  vm.createContext(sandbox);
  vm.runInContext(inlineScript(html), sandbox, { filename: 'dashboard-prime.html inline' });
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  return { document, calls, store };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => body,
});

describe('dashboard-prime API token', () => {
  it('sends the stored token as a bearer header on API requests', async () => {
    const { calls } = await boot({
      seedToken: 'test-token-abc123',
      respond: async () => jsonResponse({ status: 'ok' }),
    });

    const apiCalls = calls.filter((c) => c.url.startsWith('http://localhost:8091'));
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const c of apiCalls) {
      const headers = c.init.headers || {};
      expect(headers.Authorization).toBe('Bearer test-token-abc123');
    }
  });

  it('does not leak the token to hosts other than the API', async () => {
    const { calls } = await boot({
      seedToken: 'test-token-abc123',
      respond: async () => jsonResponse({ status: 'ok' }),
    });

    for (const c of calls) {
      if (!c.url.startsWith('http://localhost:8091')) {
        const headers = c.init.headers || {};
        expect(headers.Authorization).toBeUndefined();
      }
    }
  });

  it('discards a token the server rejects, so it re-prompts instead of failing forever', async () => {
    const { store } = await boot({
      seedToken: 'stale-token',
      respond: async () => jsonResponse({ detail: 'unauthorized' }, 401),
    });

    expect(store.has(TOKEN_KEY)).toBe(false);
  });

  it('boots without throwing when no token is stored and prompting is unavailable', async () => {
    const { document } = await boot({
      seedToken: null,
      respond: async () => jsonResponse({ detail: 'unauthorized' }, 401),
    });

    // Still renders its shell rather than dying on a missing credential.
    expect(document.getElementById('msgs')).not.toBeNull();
  });

  it('labels an auth failure distinctly from offline/degraded', () => {
    // errLabel is the shared classifier the degraded-state UI renders.
    expect(html).toMatch(/kind === 'unauthorized'/);
    expect(html).toMatch(/auth required/);
  });

  it('contains no hardcoded credential', () => {
    // This page is committed to git. A token literal here is a leaked
    // credential, which is exactly why the value lives in localStorage.
    const suspicious = [
      // TOKEN-ish identifier assigned a long opaque literal
      /(?:TOKEN|SECRET|APIKEY|API_KEY)\w*\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i,
      /Bearer\s+[A-Za-z0-9_\-]{20,}/,
    ];
    for (const re of suspicious) {
      const m = html.match(re);
      expect(m === null || /test-token|example|your-token|<token>/i.test(m[0])).toBe(true);
    }
  });

  it('reads the token from localStorage under a stable key', () => {
    expect(html).toContain(TOKEN_KEY);
  });
});
