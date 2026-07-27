// Tests for the shared web-dashboard escaping helpers.
//
// These guard the v9 XSS fixes. The pre-v9 sanitizer was
//   `d.textContent = str; return d.innerHTML`
// which escapes only & < >, and it was used inside double-quoted HTML
// attributes and single-quoted JS string literals — contexts where it
// neutralised nothing. Every payload below defeated it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

// dash-escape.js has no import/export statements on purpose (it must also load
// as a browser classic script), so importing it for its side effect and reading
// globalThis is the contract.
import '../web/lib/dash-escape.js';

const { escHtml, escAttr, isSafeImageDataUri, MAX_IMAGE_DATA_URI_LENGTH } = globalThis.DashEscape;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const MODULE_PATH = path.join(REPO_ROOT, 'web', 'lib', 'dash-escape.js');
const PRIME_PATH = path.join(REPO_ROOT, 'web', 'dashboard-prime.html');

// Real-world breakout payloads.
const PAYLOADS = {
  attrDouble: 'x" onerror="alert(1)',
  attrDoubleShort: 'x" onerror=1',
  attrSingle: "x' onerror='alert(1)",
  jsString: "'); alert(1);//",
  tag: '<img src=x onerror=1>',
  backtick: '`${alert(1)}`',
  backslash: 'C:\\evil\\path\\\\" onerror="alert(1)',
  ampersand: 'Tom & Jerry',
  closeScript: '</script><script>alert(1)</script>',
  winFilenameQuote: "it's a report.txt",
};

describe('escHtml', () => {
  it('escapes all six dangerous characters', () => {
    expect(escHtml('&')).toBe('&amp;');
    expect(escHtml('<')).toBe('&lt;');
    expect(escHtml('>')).toBe('&gt;');
    expect(escHtml('"')).toBe('&quot;');
    expect(escHtml("'")).toBe('&#39;');
    expect(escHtml('`')).toBe('&#96;');
  });

  it('escapes & first so escapes are not double-encoded into wrong entities', () => {
    // A naive ordering that escapes < before & turns "<" into "&amp;lt;".
    expect(escHtml('<')).toBe('&lt;');
    expect(escHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves no raw quote, angle bracket or backtick in any payload', () => {
    for (const [name, payload] of Object.entries(PAYLOADS)) {
      const out = escHtml(payload);
      expect(out).not.toMatch(/["'`<>]/);
      expect(name && out.length).toBeGreaterThan(0);
    }
  });

  it('is what the old sanitizer was not: the old one left quotes intact', () => {
    // Documents the actual bug. `textContent`-based escaping only had to handle
    // & < > per the HTML serialisation spec.
    const oldEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(oldEsc(PAYLOADS.attrDoubleShort)).toContain('"');   // vulnerable
    expect(escHtml(PAYLOADS.attrDoubleShort)).not.toContain('"'); // fixed
  });

  it('returns empty string for null and undefined rather than "null"/"undefined"', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('stringifies non-strings', () => {
    expect(escHtml(0)).toBe('0');
    expect(escHtml(42)).toBe('42');
    expect(escHtml(false)).toBe('false');
  });

  it('escAttr is the same function (one code path to audit)', () => {
    expect(escAttr).toBe(escHtml);
  });
});

// The strongest assertion: hand the escaped output to a real HTML parser inside
// a quoted attribute and confirm no attribute breakout occurred.
describe('escHtml in a real attribute context', () => {
  for (const [name, payload] of Object.entries(PAYLOADS)) {
    it(`does not break out of a double-quoted attribute: ${name}`, () => {
      const { document } = parseHTML(
        `<body><div id="t" data-path="${escHtml(payload)}">x</div></body>`
      );
      const el = document.getElementById('t');
      expect(el).not.toBeNull();
      // Value survives intact...
      expect(el.getAttribute('data-path')).toBe(payload);
      // ...and no handler attribute was smuggled in.
      const attrs = el.getAttributeNames().map((a) => a.toLowerCase());
      expect(attrs.sort()).toEqual(['data-path', 'id']);
      expect(attrs.some((a) => a.startsWith('on'))).toBe(false);
      expect(document.querySelectorAll('img,script').length).toBe(0);
    });

    it(`does not break out of a single-quoted attribute: ${name}`, () => {
      const { document } = parseHTML(
        `<body><div id="t" title='${escHtml(payload)}'>x</div></body>`
      );
      const el = document.getElementById('t');
      expect(el.getAttribute('title')).toBe(payload);
      expect(el.getAttributeNames().some((a) => a.toLowerCase().startsWith('on'))).toBe(false);
    });
  }

  it('does not inject elements when used in text position', () => {
    const { document } = parseHTML(`<body><div id="t">${escHtml(PAYLOADS.tag)}</div></body>`);
    expect(document.querySelectorAll('img').length).toBe(0);
    expect(document.getElementById('t').textContent).toBe(PAYLOADS.tag);
  });

  it('cannot terminate the surrounding script element', () => {
    const { document } = parseHTML(`<body><div id="t">${escHtml(PAYLOADS.closeScript)}</div></body>`);
    expect(document.querySelectorAll('script').length).toBe(0);
    expect(document.getElementById('t').textContent).toBe(PAYLOADS.closeScript);
  });
});

describe('isSafeImageDataUri', () => {
  const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('accepts base64 raster image data URIs', () => {
    expect(isSafeImageDataUri(validPng)).toBe(true);
    expect(isSafeImageDataUri('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(isSafeImageDataUri('data:image/gif;base64,R0lGODlhAQABAA==')).toBe(true);
    expect(isSafeImageDataUri('data:image/webp;base64,UklGRh4AAABXRUJQ')).toBe(true);
    expect(isSafeImageDataUri('DATA:IMAGE/PNG;BASE64,iVBORw0KGgo=')).toBe(true);
  });

  it('tolerates newlines inside the base64 payload', () => {
    expect(isSafeImageDataUri('data:image/png;base64,iVBORw0KGgo\nAAAANSUhEUg==')).toBe(true);
  });

  it('rejects the attribute-breakout payload that reached <img src> in v8', () => {
    // This is the exact shape of the v8 bug: data_uri went into
    // `<img src="${data.data_uri}">` with no escaping and no validation.
    expect(isSafeImageDataUri('x" onerror="alert(1)')).toBe(false);
    expect(isSafeImageDataUri('data:image/png;base64,AAAA" onerror="alert(1)')).toBe(false);
    expect(isSafeImageDataUri('data:image/png;base64,AAAA\' onerror=\'alert(1)')).toBe(false);
  });

  it('rejects SVG, which can carry script even as a valid image type', () => {
    expect(isSafeImageDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isSafeImageDataUri('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
  });

  it('rejects the non-base64 data: form, whose payload is unencoded', () => {
    expect(isSafeImageDataUri('data:image/png,<script>alert(1)</script>')).toBe(false);
    expect(isSafeImageDataUri('data:image/png;charset=utf-8,abc')).toBe(false);
  });

  it('rejects other schemes entirely', () => {
    expect(isSafeImageDataUri('javascript:alert(1)')).toBe(false);
    expect(isSafeImageDataUri('http://evil/x.png')).toBe(false);
    expect(isSafeImageDataUri('data:text/html;base64,PGgxPmhpPC9oMT4=')).toBe(false);
    expect(isSafeImageDataUri('  data:image/png;base64,iVBORw0KGgo=')).toBe(false);
  });

  it('rejects non-strings and empty input', () => {
    for (const v of [null, undefined, 0, 1, {}, [], true, () => {}]) {
      expect(isSafeImageDataUri(v)).toBe(false);
    }
    expect(isSafeImageDataUri('')).toBe(false);
  });

  it('rejects an oversized payload so a hostile response cannot wedge the renderer', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_DATA_URI_LENGTH + 1);
    expect(isSafeImageDataUri(huge)).toBe(false);
  });
});

// dashboard-prime.html must stay a single self-contained file, so it carries a
// verbatim copy of the shared block instead of importing it. This test is what
// makes that copy safe: if the two ever diverge, CI fails here.
describe('dashboard-prime.html mirror of the shared block', () => {
  const BEGIN = '─── BEGIN dash-escape shared block ───';
  const END = '─── END dash-escape shared block ───';

  function extractBlock(text, label) {
    const norm = text.replace(/\r\n/g, '\n');
    const start = norm.indexOf(BEGIN);
    const end = norm.indexOf(END);
    if (start === -1) throw new Error(`${label}: BEGIN marker not found`);
    if (end === -1) throw new Error(`${label}: END marker not found`);
    if (end < start) throw new Error(`${label}: markers out of order`);
    return norm
      .slice(start + BEGIN.length, end)
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')
      .trim();
  }

  it('is byte-identical (modulo line endings and trailing space) to lib/dash-escape.js', () => {
    const moduleBlock = extractBlock(fs.readFileSync(MODULE_PATH, 'utf8'), 'dash-escape.js');
    const inlineBlock = extractBlock(fs.readFileSync(PRIME_PATH, 'utf8'), 'dashboard-prime.html');
    expect(inlineBlock.length).toBeGreaterThan(200);
    expect(inlineBlock).toBe(moduleBlock);
  });

  it('defines the helpers the dashboard actually calls', () => {
    const block = extractBlock(fs.readFileSync(MODULE_PATH, 'utf8'), 'dash-escape.js');
    expect(block).toContain('function escHtml');
    expect(block).toContain('const escAttr = escHtml');
    expect(block).toContain('function isSafeImageDataUri');
  });
});

// Regression guards on the fixed files themselves.
describe('dashboard-prime.html v9 regressions', () => {
  const html = fs.readFileSync(PRIME_PATH, 'utf8');
  // Strip comments so the explanatory notes about the old bugs don't trip the
  // pattern checks below.
  const code = html.replace(/^\s*\/\/.*$/gm, '');

  it('no longer contains the unsafe textContent/innerHTML sanitizer', () => {
    expect(code).not.toMatch(/d\.textContent\s*=\s*str/);
  });

  it('has no inline event handler that interpolates a template expression', () => {
    // i.e. no `onclick="fn('${...}')"` — the pattern that put untrusted
    // filenames into a JavaScript code context.
    const matches = code.match(/on[a-z]+\s*=\s*"[^"]*\$\{/g) || [];
    expect(matches).toEqual([]);
  });

  it('never assigns data_uri into an HTML string', () => {
    expect(code).not.toMatch(/src="\$\{[^}]*data_uri/);
  });

  it('targets the brain on :8001, never :8000', () => {
    expect(code).toContain("http://localhost:8001");
    expect(code).not.toMatch(/localhost:8000/);
  });

  it('bounds the message transcript', () => {
    expect(code).toMatch(/MAX_MESSAGES/);
  });

  it('gives errors their own message role', () => {
    expect(html).toContain('.msg.e');
  });
});

describe('dashboard.js v9 regressions', () => {
  const js = fs.readFileSync(path.join(REPO_ROOT, 'web', 'dashboard.js'), 'utf8');
  const code = js.replace(/^\s*\/\/.*$/gm, '');

  it('escapes the agent-supplied goal before rendering it', () => {
    expect(code).not.toMatch(/\$\{\(r\.goal/);
    expect(code).toMatch(/escHtml\(String\(r\.goal/);
  });

  it('escapes playbook platform and goalKey', () => {
    expect(code).toMatch(/escHtml\(p\.platform/);
    expect(code).toMatch(/escHtml\(String\(p\.goalKey/);
  });

  it('checks res.ok and 503 before parsing JSON', () => {
    expect(code).toMatch(/res\.status === 503/);
    expect(code).toMatch(/if \(!res\.ok\)/);
  });

  it('puts a timeout on the fetch fallback', () => {
    expect(code).toMatch(/AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  });

  it('guards against overlapping refresh cycles and can stop the interval', () => {
    expect(code).toMatch(/if \(refreshing\) return/);
    expect(code).toMatch(/clearInterval/);
  });

  it('no longer uses a blocking alert()', () => {
    expect(code).not.toMatch(/\balert\(/);
  });
});
