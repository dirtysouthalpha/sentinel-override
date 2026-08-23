/**
 * Tests for the shared report sanitizer (lib/report-sanitize.js).
 *
 * The report body is untrusted LLM/page-derived markdown rendered by marked
 * into HTML and inserted with innerHTML in BOTH report pages. Until 2026-08-23
 * each page carried its own hand-copied sanitizer; these tests pin the single
 * shared copy's behavior and fail if either page ever grows a private fork
 * again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';

// The lib is a browser classic script; in Node it needs a DOMParser global
// before sanitizeReportHtml is CALLED (not before import — usage is lazy).
// Browsers' parseFromString(x, 'text/html') always builds html/head/body and
// puts fragment content in body; linkedom does not wrap, leaving doc.body
// empty for fragments. The shim reproduces the browser behavior so the lib's
// real call path (raw fragment in, doc.body.innerHTML out) is what's tested.
class BrowserlikeDOMParser extends DOMParser {
  parseFromString(str, type) {
    if (type === 'text/html' && !/<html[\s>]/i.test(str)) {
      return super.parseFromString('<html><head></head><body>' + str + '</body></html>', type);
    }
    return super.parseFromString(str, type);
  }
}
globalThis.DOMParser = BrowserlikeDOMParser;
await import('../lib/report-sanitize.js');
const { sanitizeReportHtml, escapeHtml } = globalThis.ReportSanitize;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');

describe('sanitizeReportHtml', () => {
  test('empty and nullish input come back as empty string', () => {
    expect(sanitizeReportHtml('')).toBe('');
    expect(sanitizeReportHtml(null)).toBe('');
    expect(sanitizeReportHtml(undefined)).toBe('');
  });

  test('keeps benign report markup', () => {
    const out = sanitizeReportHtml('<h2>Findings</h2><p>All <strong>good</strong>.</p><ul><li>one</li></ul>');
    expect(out).toContain('<h2>Findings</h2>');
    expect(out).toContain('<strong>good</strong>');
    expect(out).toContain('<li>one</li>');
  });

  test('strips code-executing and resource-loading elements', () => {
    const dirty = '<p>hi</p><script>alert(1)</scr' + 'ipt><iframe src="//evil"></iframe>'
      + '<img src="//evil/x.png"><svg onload="alert(1)"></svg><style>*{}</style>'
      + '<form action="//evil"><input></form><video src="//evil"></video>';
    const out = sanitizeReportHtml(dirty);
    expect(out).toContain('<p>hi</p>');
    for (const tag of ['<script', '<iframe', '<img', '<svg', '<style', '<form', '<input', '<video']) {
      expect(out).not.toContain(tag);
    }
  });

  test('removes on* handlers and style attributes from surviving elements', () => {
    const out = sanitizeReportHtml('<p onclick="alert(1)" onmouseover="x()" style="background:url(//evil)">t</p>');
    expect(out).not.toMatch(/onclick|onmouseover|style=/i);
    expect(out).toContain('>t</p>');
  });

  test('removes javascript:, data: and vbscript: URLs but keeps https links', () => {
    const out = sanitizeReportHtml(
      '<a href="javascript:alert(1)">a</a>'
      + '<a href=" DATA:text/html,x">b</a>'
      + '<a href="vbscript:x">c</a>'
      + '<a href="https://example.com/report">d</a>');
    expect(out).not.toMatch(/javascript:|data:|vbscript:/i);
    expect(out).toContain('href="https://example.com/report"');
  });

  test('marked-style output with the src-chip decoration passes through', () => {
    const out = sanitizeReportHtml('<p>fact <span class="src-chip" title="Source: page-3">page-3</span></p>');
    expect(out).toContain('class="src-chip"');
  });

  // ── shared escaper ────────────────────────────────────────────────────────
  test('escapeHtml escapes all five significant characters', () => {
    expect(escapeHtml('<b a="x" c=\'y\'>&'))
      .toBe('&lt;b a=&quot;x&quot; c=&#39;y&#39;&gt;&amp;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  // ── drift guards ──────────────────────────────────────────────────────────
  test('neither report page defines a private sanitizer or escaper fork', () => {
    for (const file of ['report-view.js', 'report-print.js']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(src).not.toMatch(/function\s+sanitizeReportHtml/);
      expect(src).not.toMatch(/function\s+escapeHtml/);
    }
  });

  test('both report pages load the shared lib before their page script', () => {
    for (const [page, script] of [['report-view.html', 'report-view.js'], ['report-print.html', 'report-print.js']]) {
      const html = fs.readFileSync(path.join(REPO_ROOT, page), 'utf8');
      const libAt = html.indexOf('lib/report-sanitize.js');
      const pageAt = html.indexOf(`"${script}"`);
      expect(libAt).toBeGreaterThan(-1);
      expect(pageAt).toBeGreaterThan(-1);
      expect(libAt).toBeLessThan(pageAt);
    }
  });
});
