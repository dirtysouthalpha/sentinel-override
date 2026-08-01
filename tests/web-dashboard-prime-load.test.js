// Runtime load test for web/dashboard-prime.html.
//
// The syntax gate in scripts/check-web-dashboards.cjs proves the inline script
// *parses*. This proves it *runs*: it executes the real inline script against a
// linkedom DOM with the network stubbed, so a dangling reference to a deleted
// helper (or an init path that throws) fails CI instead of silently blanking
// the page in a browser.
//
// It also asserts the v9 promise that the UI degrades to a legible state rather
// than staying blank or frozen, in both failure modes:
//   * nothing listening at all      -> "offline"
//   * listening but answering 503   -> "degraded"  (fleet convention)

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIME_PATH = path.join(HERE, '..', 'web', 'dashboard-prime.html');
const html = fs.readFileSync(PRIME_PATH, 'utf8');

function inlineScript(source) {
  const { document } = parseHTML(source);
  const scripts = [...document.querySelectorAll('script')].filter((s) => !s.getAttribute('src'));
  const code = scripts.map((s) => s.textContent || '').join('\n');
  if (!code.trim()) throw new Error('no inline script found in dashboard-prime.html');
  return code;
}

/**
 * Boot the dashboard in a sandbox.
 * @param {(url: string) => Promise<object>} fetchImpl stubbed fetch
 */
async function boot(fetchImpl) {
  const { document, window, location } = parseHTML(html);
  const errors = [];
  const store = new Map();

  const sandbox = {
    document,
    window,
    location: location || { protocol: 'http:', host: 'localhost:8091' },
    console: { log() {}, warn() {}, error(...a) { errors.push(a.join(' ')); } },
    fetch: fetchImpl,
    // Never-firing signal: keeps real timers out of the test process.
    AbortSignal: { timeout: () => new AbortController().signal, any: (sigs) => sigs[0] },
    AbortController,
    // Swallow scheduled work (ping retries, WS reconnect, toast teardown).
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
  sandbox.document = document;

  vm.createContext(sandbox);
  vm.runInContext(inlineScript(html), sandbox, { filename: 'dashboard-prime.html inline' });

  // Let the async init() IIFE settle.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  return { document, errors, sandbox };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => body,
});

describe('dashboard-prime.html runs', () => {
  it('boots without throwing when every backend is unreachable', async () => {
    const { document } = await boot(async () => {
      throw new Error('ECONNREFUSED');
    });

    // Chat scaffold intact.
    expect(document.getElementById('msgs')).not.toBeNull();
    // The desktop health pill (Part 3 replaced the 8px #sdot) shows the
    // offline state, not a blank or "connected" lie — and says so in text.
    const pill = document.getElementById('pill-desktop');
    expect(pill.className).toBe('pill err');
    expect(pill.title).toMatch(/offline/);
    // File explorer says what went wrong instead of spinning on "Loading…".
    expect(document.getElementById('fe-tree').textContent).toMatch(/Cannot list directory/);
    // Brain panel degrades to offline.
    expect(document.getElementById('brain-badge').textContent).toBe('offline');
    expect(document.getElementById('sv-n').textContent).toBe('—');
    // Model select degrades.
    expect(document.getElementById('model-sel').textContent).toMatch(/Unavailable/);
  });

  it('distinguishes a 503 (reachable but unhealthy) from unreachable', async () => {
    const { document } = await boot(async () =>
      jsonResponse({ status: 'unhealthy', detail: 'embedding server down' }, 503)
    );

    expect(document.getElementById('brain-badge').textContent).toBe('degraded');
    expect(document.getElementById('model-sel').textContent).toMatch(/Degraded/);
    expect(document.getElementById('fe-tree').textContent).toMatch(/degraded/i);
    expect(document.getElementById('fe-tree').textContent).toMatch(/embedding server down/);
    // A degraded service is NOT reported as offline.
    const pill = document.getElementById('pill-desktop');
    expect(pill.className).toBe('pill warn');
    expect(pill.title).toMatch(/degraded/);
  });

  it('renders live brain numbers from the real :8001 response shape', async () => {
    // Field names and nesting copied from actual curl output of the brain API.
    const routes = {
      '/brain/stats': {
        version: '20.0.0',
        active_pack: 'sentinel',
        totals: { neurons: 5629, synapses: 19641, regions: 12 },
        neurons_per_region: [
          { region: 'knowledge', count: 1344 },
          { region: 'hippocampus', count: 349 },
        ],
      },
      '/health': { status: 'ok', version: '20.0.0', storage: 'SQLiteStorage', pack: 'sentinel' },
      '/brain/diagnostics': {
        uptime_seconds: 1256.2,
        write_contention: { lock_retries: 0, lock_drops: 0 },
        db: { path: 'C:\\AgentLink\\neuralis\\data\\neuralis.db', size_bytes: 333303808, wal_bytes: 4165352 },
        embeddings: { total_vectors: 50419, model: 'BAAI/bge-small-en-v1.5' },
      },
    };

    const { document } = await boot(async (url) => {
      const hit = Object.keys(routes).find((k) => url.includes(k));
      if (hit) return jsonResponse(routes[hit]);
      throw new Error('ECONNREFUSED');
    });

    expect(document.getElementById('sv-n').textContent).toBe('5,629');
    expect(document.getElementById('sv-s').textContent).toBe('19,641');
    expect(document.getElementById('sv-r').textContent).toBe('12');
    expect(document.getElementById('sv-v').textContent).toBe('v20.0.0');
    expect(document.getElementById('bl-status').textContent).toBe('ok');
    expect(document.getElementById('bl-pack').textContent).toBe('sentinel');
    expect(document.getElementById('bl-storage').textContent).toBe('SQLiteStorage');
    expect(document.getElementById('bl-uptime').textContent).toBe('20m 56s');
    expect(document.getElementById('bl-db').textContent).toBe('317.9 MB');
    expect(document.getElementById('bl-embmodel').textContent).toBe('BAAI/bge-small-en-v1.5');
    expect(document.getElementById('bl-vectors').textContent).toBe('50,419');
    expect(document.getElementById('bl-locks').textContent).toBe('0 / 0');
    expect(document.getElementById('bl-topregion').textContent).toBe('knowledge (1,344)');
    expect(document.getElementById('brain-badge').textContent).toBe('online');
  });

  it('escapes a hostile filename from the file-listing API', async () => {
    // A Windows filename may legally contain an apostrophe, and this name is the
    // exact payload that defeated v8's esc() in both the data-path attribute and
    // the onclick handler.
    const hostile = `x'); alert(1);//" onerror="alert(2)`;
    const { document } = await boot(async (url) => {
      if (url.includes('/api/files')) {
        return jsonResponse({ entries: [{ name: hostile, path: 'C:\\tmp\\' + hostile, type: 'file', size: 10 }] });
      }
      throw new Error('ECONNREFUSED');
    });

    const entry = document.querySelector('#fe-tree .fe-entry');
    expect(entry).not.toBeNull();
    // The raw name round-trips as data, with no smuggled handler attribute.
    expect(entry.getAttribute('data-name')).toBe(hostile);
    expect(entry.getAttribute('data-path')).toBe('C:\\tmp\\' + hostile);
    const handlerAttrs = entry.getAttributeNames().filter((a) => a.toLowerCase().startsWith('on'));
    expect(handlerAttrs).toEqual([]);
    // No action button carries an inline handler any more.
    for (const btn of document.querySelectorAll('#fe-tree .fe-action-btn')) {
      expect(btn.getAttributeNames().filter((a) => a.toLowerCase().startsWith('on'))).toEqual([]);
    }
    expect(document.querySelectorAll('#fe-tree img, #fe-tree script').length).toBe(0);
  });
});
