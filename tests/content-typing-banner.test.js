/**
 * Regression tests for the typing banner in content/index.js.
 *
 * (2026-08-23) The banner used to escape its preview TWICE — once when the
 * `preview` const was built and again at the interpolation — so special
 * characters in typed text displayed as entity text ("&lt;" instead of "<").
 * It also interpolated `position`/`total` from the runtime message without
 * coercion. Both functions are extracted from the shipped source so these
 * tests can never drift onto a hand-copied version.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __testDir = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__testDir, '..', 'content', 'index.js'), 'utf-8');

function extractFn(name) {
  const at = SRC.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} not found in content/index.js`);
  let i = SRC.indexOf('{', at);
  let depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (!depth) break; }
  }
  return SRC.slice(at, i + 1);
}

function makeBanner() {
  const overlay = { innerHTML: '', style: {} };
  // eslint-disable-next-line no-new-func
  const showTypingBanner = new Function(
    'getOrCreateOverlay', 'getErrorMessage', 'console',
    `${extractFn('escapeHtml')}\n${extractFn('showTypingBanner')}\nreturn showTypingBanner;`
  )(() => overlay, (e) => String(e), console);
  return { overlay, showTypingBanner };
}

describe('content/index.js showTypingBanner', () => {
  test('escapes exactly once — special characters render as single entities', () => {
    const { overlay, showTypingBanner } = makeBanner();
    showTypingBanner('a < b & c', 1, 5);
    expect(overlay.innerHTML).toContain('a &lt; b &amp; c');
    expect(overlay.innerHTML).not.toContain('&amp;lt;');
    expect(overlay.innerHTML).not.toContain('&amp;amp;');
  });

  test('markup in the typed text never survives raw', () => {
    const { overlay, showTypingBanner } = makeBanner();
    showTypingBanner('<img src=x onerror=alert(1)>', 1, 2);
    expect(overlay.innerHTML).toContain('&lt;img');
    // The only raw tags are the banner's own two spans.
    expect(overlay.innerHTML).not.toContain('<img');
  });

  test('progress counters are numerically coerced', () => {
    const { overlay, showTypingBanner } = makeBanner();
    showTypingBanner('hello', '"><b>', '"><i>');
    expect(overlay.innerHTML).toContain('(NaN/NaN)');
    expect(overlay.innerHTML).not.toContain('<b>');
    expect(overlay.innerHTML).not.toContain('<i>');
  });

  test('long text truncates at 40 characters with ellipsis', () => {
    const { overlay, showTypingBanner } = makeBanner();
    showTypingBanner('x'.repeat(60));
    expect(overlay.innerHTML).toContain('x'.repeat(40) + '...');
    expect(overlay.innerHTML).not.toContain('x'.repeat(41));
  });
});
