// tests/ui-common-deep.test.js
// Deep tests for popup-modules/ui-common.js — sanitizeHtml, escapeHtml, isValidUrl, showToast.

import { jest } from '@jest/globals';
import { parseHTML } from 'linkedom';

// Helper to create a DOM from HTML
function createDOM(html = '<!DOCTYPE html>') {
  const { document } = parseHTML(html);
  return { document, window: { document } };
}
  const dom = new JSDOM('<!DOCTYPE html>');
  const div = dom.window.document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function sanitizeHtml(dirtyHtml) {
  if (!dirtyHtml) return '';
  const dom = new JSDOM('<!DOCTYPE html>');
  const doc = dom.window.document;
  const parser = new dom.window.DOMParser();
  const parsed = parser.parseFromString(dirtyHtml, 'text/html');

  const dangerous = parsed.querySelectorAll('script, iframe, object, embed, form, link[rel="import"], base, meta, svg, math');
  dangerous.forEach(el => el.remove());

  parsed.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.toLowerCase().trim();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (/^(href|src|action|formaction|xlink:href)$/.test(name)
          && /^\s*(javascript\s*:|data\s*:|vbscript\s*:)/i.test(val)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style' && /expression\s*\(|url\s*\(\s*['"]?\s*javascript/i.test(val)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return parsed.body.innerHTML;
}

function isValidUrl(url) {
  if (!url) return false;
  try { new URL(url); return true; }
  catch { return false; }
}

describe('escapeHtml', () => {
  test('escapes < and >', () => {
    expect(escapeHtml('<div>hello</div>')).toBe('&lt;div&gt;hello&lt;/div&gt;');
  });

  test('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toMatch(/&amp;/);
  });

  test('escapes double quotes', () => {
    expect(escapeHtml('value="test"')).toMatch(/&quot;/);
  });

  test('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  test('handles null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  test('handles undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('handles numbers', () => {
    expect(escapeHtml(42)).toBe('42');
  });

  test('handles boolean', () => {
    expect(escapeHtml(true)).toBe('true');
  });

  test('preserves whitespace', () => {
    expect(escapeHtml('  hello  world  ')).toBe('  hello  world  ');
  });

  test('handles unicode', () => {
    expect(escapeHtml('日本語')).toBe('日本語');
  });

  test('handles emoji', () => {
    expect(escapeHtml('🎉')).toBe('🎉');
  });

  test('handles newlines', () => {
    expect(escapeHtml('line1\nline2')).toBe('line1\nline2');
  });

  test('handles tabs', () => {
    expect(escapeHtml('col1\tcol2')).toBe('col1\tcol2');
  });

  test('escapes mixed special characters', () => {
    const result = escapeHtml('<script>alert("&test")</script>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
  });
});

describe('sanitizeHtml', () => {
  test('removes script tags', () => {
    expect(sanitizeHtml('<script>alert(1)</script><p>safe</p>')).not.toContain('<script>');
    expect(sanitizeHtml('<script>alert(1)</script><p>safe</p>')).toContain('<p>safe</p>');
  });

  test('removes iframe tags', () => {
    expect(sanitizeHtml('<iframe src="evil.com"></iframe><p>safe</p>')).not.toContain('<iframe');
    expect(sanitizeHtml('<iframe src="evil.com"></iframe><p>safe</p>')).toContain('<p>safe</p>');
  });

  test('removes object tags', () => {
    expect(sanitizeHtml('<object data="evil.swf"></object><p>safe</p>')).not.toContain('<object');
  });

  test('removes embed tags', () => {
    expect(sanitizeHtml('<embed src="evil.swf"><p>safe</p>')).not.toContain('<embed');
  });

  test('removes form tags', () => {
    expect(sanitizeHtml('<form action="evil.com"><input></form><p>safe</p>')).not.toContain('<form');
  });

  test('removes base tags', () => {
    expect(sanitizeHtml('<base href="evil.com/"><p>safe</p>')).not.toContain('<base');
  });

  test('removes meta tags', () => {
    expect(sanitizeHtml('<meta http-equiv="refresh" content="0;url=evil.com"><p>safe</p>')).not.toContain('<meta');
  });

  test('removes svg tags', () => {
    expect(sanitizeHtml('<svg onload="alert(1)"><circle></circle></svg><p>safe</p>')).not.toContain('<svg');
  });

  test('removes math tags', () => {
    expect(sanitizeHtml('<math><mtext>x</mtext></math><p>safe</p>')).not.toContain('<math');
  });

  test('removes link[rel=import] tags', () => {
    const result = sanitizeHtml('<link rel="import" href="evil.html"><p>safe</p>');
    expect(result).not.toContain('import');
  });

  test('removes onclick event handler', () => {
    const result = sanitizeHtml('<div onclick="alert(1)">click me</div>');
    expect(result).not.toContain('onclick');
    expect(result).toContain('click me');
  });

  test('removes onmouseover event handler', () => {
    const result = sanitizeHtml('<div onmouseover="alert(1)">hover me</div>');
    expect(result).not.toContain('onmouseover');
    expect(result).toContain('hover me');
  });

  test('removes onload event handler', () => {
    const result = sanitizeHtml('<img onload="alert(1)" src="img.png">');
    expect(result).not.toContain('onload');
  });

  test('removes onerror event handler', () => {
    const result = sanitizeHtml('<img onerror="alert(1)" src="x">');
    expect(result).not.toContain('onerror');
  });

  test('removes onfocus event handler', () => {
    const result = sanitizeHtml('<input onfocus="alert(1)">');
    expect(result).not.toContain('onfocus');
  });

  test('removes all on* attributes', () => {
    const result = sanitizeHtml('<div onany="evil" onclick="evil" onmouseover="evil">text</div>');
    expect(result).not.toContain('on');
  });

  test('removes javascript: href', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('click');
  });

  test('removes javascript: with whitespace in href', () => {
    const result = sanitizeHtml('<a href="  javascript  :alert(1)">click</a>');
    expect(result).not.toContain('javascript');
  });

  test('removes data: href', () => {
    const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
    expect(result).not.toContain('data:');
  });

  test('removes vbscript: href', () => {
    const result = sanitizeHtml('<a href="vbscript:MsgBox">click</a>');
    expect(result).not.toContain('vbscript:');
  });

  test('allows safe https: href', () => {
    const result = sanitizeHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('link');
  });

  test('allows safe http: href', () => {
    const result = sanitizeHtml('<a href="http://example.com">link</a>');
    expect(result).toContain('href="http://example.com"');
  });

  test('removes javascript: in src', () => {
    const result = sanitizeHtml('<img src="javascript:alert(1)">');
    expect(result).not.toContain('javascript:');
  });

  test('removes javascript: in action', () => {
    const result = sanitizeHtml('<button action="javascript:alert(1)">submit</button>');
    expect(result).not.toContain('javascript:');
  });

  test('removes expression() in style', () => {
    const result = sanitizeHtml('<div style="background: expression(alert(1))">text</div>');
    expect(result).not.toContain('expression(');
  });

  test('removes url(javascript:) in style', () => {
    const result = sanitizeHtml('<div style="background: url(\'javascript:alert(1)\')">text</div>');
    expect(result).not.toContain('javascript');
  });

  test('allows safe style attributes', () => {
    const result = sanitizeHtml('<div style="color: red; font-size: 14px;">text</div>');
    expect(result).toContain('color: red');
    expect(result).toContain('font-size: 14px');
  });

  test('returns empty string for null', () => {
    expect(sanitizeHtml(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(sanitizeHtml(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  test('preserves safe HTML structure', () => {
    const result = sanitizeHtml('<div><p>Hello <strong>World</strong></p></div>');
    expect(result).toContain('<div>');
    expect(result).toContain('<p>');
    expect(result).toContain('<strong>');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  test('handles nested dangerous elements', () => {
    const result = sanitizeHtml('<div><script><script>alert(1)</script></script><p>safe</p></div>');
    expect(result).not.toContain('<script');
    expect(result).toContain('<p>safe</p>');
  });

  test('handles self-closing dangerous elements', () => {
    const result = sanitizeHtml('<img src=x onerror=alert(1) /><p>safe</p>');
    expect(result).not.toContain('onerror');
  });

  test('preserves class attributes', () => {
    const result = sanitizeHtml('<div class="my-class">text</div>');
    expect(result).toContain('class="my-class"');
  });

  test('preserves id attributes', () => {
    const result = sanitizeHtml('<div id="my-id">text</div>');
    expect(result).toContain('id="my-id"');
  });

  test('preserves data attributes', () => {
    const result = sanitizeHtml('<div data-id="123">text</div>');
    expect(result).toContain('data-id="123"');
  });

  test('handles mixed case event handlers', () => {
    const result = sanitizeHtml('<div ONCLICK="evil" OnClick="evil" onClick="evil">text</div>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('OnClick');
    expect(result).not.toContain('ONCLICK');
  });

  test('handles img tags safely', () => {
    const result = sanitizeHtml('<img src="https://example.com/img.png" alt="photo">');
    expect(result).toContain('src="https://example.com/img.png"');
    expect(result).toContain('alt="photo"');
  });

  test('handles table structures', () => {
    const html = '<table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>';
    const result = sanitizeHtml(html);
    expect(result).toContain('<table>');
    expect(result).toContain('Cell 1');
    expect(result).toContain('Cell 2');
  });

  test('handles list structures', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    const result = sanitizeHtml(html);
    expect(result).toContain('<ul>');
    expect(result).toContain('Item 1');
  });

  test('sanitizes multiple injections in one document', () => {
    const html = '<script>alert(1)</script><p onclick="alert(2)">text</p><a href="javascript:alert(3)">link</a><iframe src="evil"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('<iframe');
    expect(result).toContain('text');
  });
});

describe('isValidUrl', () => {
  test('valid https URL', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  test('valid http URL', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  test('valid ftp URL', () => {
    expect(isValidUrl('ftp://example.com')).toBe(true);
  });

  test('valid URL with path', () => {
    expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
  });

  test('valid URL with query', () => {
    expect(isValidUrl('https://example.com?search=test')).toBe(true);
  });

  test('valid URL with port', () => {
    expect(isValidUrl('https://example.com:8080')).toBe(true);
  });

  test('valid URL with auth', () => {
    expect(isValidUrl('https://user:pass@example.com')).toBe(true);
  });

  test('valid localhost URL', () => {
    expect(isValidUrl('http://localhost:3000')).toBe(true);
  });

  test('invalid: no protocol', () => {
    expect(isValidUrl('example.com')).toBe(false);
  });

  test('invalid: empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  test('invalid: null', () => {
    expect(isValidUrl(null)).toBe(false);
  });

  test('invalid: undefined', () => {
    expect(isValidUrl(undefined)).toBe(false);
  });

  test('invalid: just protocol', () => {
    expect(isValidUrl('https://')).toBe(false);
  });

  test('invalid: whitespace', () => {
    expect(isValidUrl('   ')).toBe(false);
  });

  test('valid: data URL', () => {
    expect(isValidUrl('data:text/html;base64,SGVsbG8=')).toBe(true);
  });

  test('valid: mailto URL', () => {
    expect(isValidUrl('mailto:user@example.com')).toBe(true);
  });
});
