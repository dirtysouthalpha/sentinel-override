/**
 * The HTML-injection gate (scripts/check-html-injection.cjs) is itself code
 * that can rot. These tests prove both directions: it PASSES the escaping
 * idioms the dashboards actually use, and it FAILS the exact regression class
 * it exists to block — an interpolation reaching an HTML sink unescaped.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-html-injection.cjs');

function runOn(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inj-gate-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    try {
      execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
      return { code: 0 };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}\n${e.stderr}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-html-injection gate', () => {
  test('passes the escaping idioms the dashboards use', () => {
    const res = runOn({
      'ok.js': `
        el.innerHTML = '';
        el.innerHTML = '<div class="empty">static</div>';
        el.innerHTML = \`<b>\${escHtml(user.name)}</b>\`;
        el.innerHTML = \`<i title="\${escAttr(p)}">\${x ? escHtml(x) : ''}</i>\`;
        el.innerHTML = \`<span>\${n ? ' · ' + escHtml(n) + ' steps' : ''}</span>\`;
        const cell = escHtml(String(r.goal || '').substring(0, 60));
        const badge = ok ? '<span class="g">Done</span>' : '<span class="o">Running</span>';
        el.innerHTML = rows.map((r) => \`<tr><td>\${cell}</td><td>\${badge}</td><td>\${Math.round(v * 100)}%</td></tr>\`).join('');
      `,
    });
    expect(res.code).toBe(0);
  });

  test('fails a raw interpolation into innerHTML', () => {
    const res = runOn({ 'bad.js': 'el.innerHTML = `<b>${user.name}</b>`;' });
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/innerHTML assignment/);
  });

  test('fails string concatenation of untrusted data', () => {
    const res = runOn({ 'bad.js': "el.innerHTML = '<b>' + userName + '</b>';" });
    expect(res.code).toBe(1);
  });

  test('fails insertAdjacentHTML with an unescaped value', () => {
    const res = runOn({ 'bad.js': "el.insertAdjacentHTML('beforeend', `<i>${x}</i>`);" });
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/insertAdjacentHTML/);
  });

  test('fails a const laundered through a name whose initializer is unsafe', () => {
    const res = runOn({
      'bad.js': 'const s = api.title; el.innerHTML = `<b>${s}</b>`;',
    });
    expect(res.code).toBe(1);
  });

  test('fails a reassigned variable even if first bound safely', () => {
    const res = runOn({
      'bad.js': 'let s = escHtml(t); s = api.title; el.innerHTML = `<b>${s}</b>`;',
    });
    expect(res.code).toBe(1);
  });

  test('checks inline scripts inside HTML pages', () => {
    const res = runOn({
      'bad.html': '<html><body><script>document.getElementById("x").innerHTML = `<b>${data.name}</b>`;</script></body></html>',
    });
    expect(res.code).toBe(1);
  });

  test('escHtml inside inline HTML script passes', () => {
    const res = runOn({
      'ok.html': '<html><body><script>document.getElementById("x").innerHTML = `<b>${escHtml(data.name)}</b>`;</script></body></html>',
    });
    expect(res.code).toBe(0);
  });
});
