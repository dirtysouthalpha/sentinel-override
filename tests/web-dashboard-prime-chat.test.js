// The v12 chat layer: markdown rendering and the live-agent protocol.
//
// Two things this pins that were broken for the whole life of the dashboard:
//
//   * `renderMessageBody` builds through the DOM only. There is no HTML string
//     in it, so there is no parser to trick — model output is untrusted, and
//     the v8 lesson (esc() used inside attributes and onclick strings, where it
//     neutralised nothing) is not being relearned.
//   * The WebSocket protocol. The server requires an auth handshake as its
//     first message and broadcasts `step` / `done` / `error`. v10 sent no
//     handshake and listened only for `message`, a type the server has never
//     emitted — so the chat could not display a reply even in principle.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, '..', 'web', 'dashboard-prime.html'), 'utf8');

function inlineScript(source) {
  const { document } = parseHTML(source);
  return [...document.querySelectorAll('script')]
    .filter((s) => !s.getAttribute('src'))
    .map((s) => s.textContent || '')
    .join('\n');
}

/** Boot the page with a stubbed network and a recording WebSocket. */
async function boot() {
  const { document, window } = parseHTML(html);
  const sent = [];
  const sockets = [];
  const store = new Map([['sentinel-api-token', 'tok']]);

  // A real socket fires onopen asynchronously, after the caller has had a
  // chance to assign the handler. Firing it here is what exercises the auth
  // handshake — the thing v10 never sent.
  function WebSocketStub(url) {
    this.url = url;
    this.readyState = 1;
    this.send = (d) => sent.push(JSON.parse(d));
    this.close = () => {};
    sockets.push(this);
    Promise.resolve().then(() => { if (this.onopen) this.onopen(); });
  }

  const sandbox = {
    document,
    location: { protocol: 'http:', host: 'localhost:8091', origin: 'http://localhost:8091',
                href: 'http://localhost:8091/prime/dashboard-prime.html' },
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
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
    WebSocket: WebSocketStub,
    navigator: { clipboard: { writeText: async () => {} } },
    URL,
    Promise, Object, Array, String, Number, Math, JSON, Date, Error, RegExp, isFinite, parseInt,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.window.innerWidth = 1400;

  vm.createContext(sandbox);
  vm.runInContext(inlineScript(html), sandbox, { filename: 'prime inline' });
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  return { document, sandbox, sent, sockets };
}

/** Render markdown into a detached node and return it. */
async function render(md) {
  const { document, sandbox } = await boot();
  const el = document.createElement('div');
  sandbox.renderMessageBody(el, md);
  return el;
}

describe('markdown rendering', () => {
  it('renders a fenced code block with a language label and a copy button', async () => {
    const el = await render('here:\n```python\nprint("hi")\n```');
    expect(el.querySelector('.md-code')).not.toBeNull();
    expect(el.querySelector('.md-code-lang').textContent).toBe('python');
    expect(el.querySelector('.md-code pre code').textContent).toBe('print("hi")');
    expect(el.querySelector('.md-copy')).not.toBeNull();
  });

  it('labels an unfenced-language block as text rather than blank', async () => {
    const el = await render('```\nplain\n```');
    expect(el.querySelector('.md-code-lang').textContent).toBe('text');
  });

  it('keeps markup inside a code block as literal text', async () => {
    const el = await render('```html\n<img src=x onerror=alert(1)>\n```');
    const code = el.querySelector('pre code');
    expect(code.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
  });

  it('never creates an element from model-supplied markup', async () => {
    const el = await render('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('carries no event-handler attributes anywhere in the output', async () => {
    const el = await render('**a** `b` [c](https://x.test)\n- d\n> e\n# f');
    for (const node of el.querySelectorAll('*')) {
      const handlers = node.getAttributeNames().filter((a) => a.toLowerCase().startsWith('on'));
      expect(handlers).toEqual([]);
    }
  });

  it('renders a safe link with noopener', async () => {
    const el = await render('[docs](https://example.test/a)');
    const a = el.querySelector('a');
    expect(a.getAttribute('href')).toBe('https://example.test/a');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('refuses the %s scheme and leaves it as text', async (href) => {
    const el = await render(`[click](${href})`);
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('click');
  });

  it('renders headings, lists, quotes and inline spans', async () => {
    const el = await render('# Title\n- one\n- two\n\n1. first\n\n> quoted\n\n**b** and *i* and `c`');
    expect(el.querySelector('.md-h1').textContent).toBe('Title');
    expect(el.querySelectorAll('ul li').length).toBe(2);
    expect(el.querySelectorAll('ol li').length).toBe(1);
    expect(el.querySelector('.md-quote').textContent).toBe('quoted');
    expect(el.querySelector('strong').textContent).toBe('b');
    expect(el.querySelector('em').textContent).toBe('i');
    expect(el.querySelector('.md-inline-code').textContent).toBe('c');
  });

  it('survives an unterminated code fence', async () => {
    const el = await render('```js\nnever closed');
    expect(el.querySelector('pre code').textContent).toBe('never closed');
  });

  it('replaces previous content rather than appending', async () => {
    const { document, sandbox } = await boot();
    const el = document.createElement('div');
    sandbox.renderMessageBody(el, 'first');
    sandbox.renderMessageBody(el, 'second');
    expect(el.textContent).toBe('second');
  });
});

describe('live agent protocol', () => {
  it('sends the auth handshake as its first socket message', async () => {
    const { sent } = await boot();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toEqual({ type: 'auth', token: 'tok' });
  });

  it('connects to the API host, not to a hostless ws:/// URL', async () => {
    const { sockets } = await boot();
    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets[0].url).toBe('ws://localhost:8091/ws');
    expect(sockets[0].url).not.toContain(':///');
  });

  it('renders a step event into the transcript', async () => {
    const { document, sandbox } = await boot();
    sandbox.handleAgentEvent({ type: 'step', thought: 'opening the file' });
    expect(document.getElementById('msgs').textContent).toContain('opening the file');
  });

  it('renders the done summary — the answer v10 discarded', async () => {
    const { document, sandbox } = await boot();
    sandbox.handleAgentEvent({ type: 'step', thought: 'working' });
    sandbox.handleAgentEvent({ type: 'done', result: { steps: 3, summary: 'All set: **done**' } });
    const msgs = document.getElementById('msgs');
    expect(msgs.textContent).toContain('All set');
    expect(msgs.querySelector('strong').textContent).toBe('done');
    expect(msgs.textContent).toContain('3 steps');
  });

  it('renders an error event as an error, not as an assistant reply', async () => {
    const { document, sandbox } = await boot();
    sandbox.handleAgentEvent({ type: 'error', message: 'engine crashed' });
    const err = document.querySelector('.msg.e');
    expect(err).not.toBeNull();
    expect(err.textContent).toContain('engine crashed');
  });

  it('drops a rejected socket token so it re-prompts', async () => {
    const { sandbox, document } = await boot();
    sandbox.handleAgentEvent({ type: 'auth_error', message: 'Invalid token' });
    expect(sandbox.localStorage.getItem('sentinel-api-token')).toBeNull();
    expect(document.querySelector('.msg.e')).not.toBeNull();
  });

  it('ignores an unknown event type without throwing', async () => {
    const { sandbox } = await boot();
    expect(() => sandbox.handleAgentEvent({ type: 'something-new' })).not.toThrow();
    expect(() => sandbox.handleAgentEvent({})).not.toThrow();
  });
});

describe('storage keys are reachable from init()', () => {
  // This bit the same way twice: PANEL_KEY and then WIDTH_KEY were each declared
  // with `const` NEXT TO the functions that use them, which sit below init() in
  // the file. init() therefore read them from the temporal dead zone, threw
  // ReferenceError, and the surrounding catch swallowed it — so the collapse
  // state and then the rail widths both saved correctly and silently never
  // restored. A structural test is the only thing that catches this, because
  // the runtime symptom is "nothing happens".
  const script = inlineScript(html);

  it.each(['PANEL_KEY', 'GROUP_KEY', 'THEME_KEY', 'WIDTH_KEY'])(
    '%s is declared before init() runs',
    (name) => {
      const decl = script.indexOf(`const ${name} =`);
      const init = script.indexOf('async function init()');
      expect(decl).toBeGreaterThan(-1);
      expect(init).toBeGreaterThan(-1);
      expect(decl).toBeLessThan(init);
    },
  );

  it('restores persisted panel and width state on boot', async () => {
    const { document, sandbox } = await boot();
    sandbox.localStorage.setItem('dash11-panels', JSON.stringify({ sidebar: true, right: false }));
    sandbox.localStorage.setItem('dash12-widths', JSON.stringify({ sidebar: 240, right: 400 }));
    sandbox.loadPanelState();
    sandbox.loadRailWidths();
    expect(document.getElementById('app').className).toContain('sidebar-collapsed');
    expect(document.documentElement.style.getPropertyValue('--right-w')).toBe('400px');
  });
});

describe('message actions', () => {
  it('gives every message a copy button', async () => {
    const { document, sandbox } = await boot();
    sandbox.appendMsg('a', 'hello');
    const msg = [...document.querySelectorAll('.msg')].pop();
    expect(msg.querySelector('.msg-act')).not.toBeNull();
    expect(msg.querySelector('.msg-stamp')).not.toBeNull();
  });

  it('round-trips a code block back to fenced markdown when copied', async () => {
    const { document, sandbox } = await boot();
    sandbox.appendMsg('a', 'try:\n```js\nlet x = 1\n```');
    const msg = [...document.querySelectorAll('.msg')].pop();
    const text = sandbox.messageText(msg);
    expect(text).toContain('```js');
    expect(text).toContain('let x = 1');
  });

  it('shows user text verbatim rather than reinterpreting it as markdown', async () => {
    const { document, sandbox } = await boot();
    sandbox.appendMsg('u', 'use **literal** asterisks');
    const msg = [...document.querySelectorAll('.msg.u')].pop();
    expect(msg.querySelector('.mb').textContent).toBe('use **literal** asterisks');
    expect(msg.querySelector('strong')).toBeNull();
  });

  it('still bounds the transcript', async () => {
    const { document, sandbox } = await boot();
    for (let i = 0; i < 320; i += 1) sandbox.appendMsg('a', 'm' + i);
    expect(document.getElementById('msgs').childElementCount).toBeLessThanOrEqual(300);
  });
});
