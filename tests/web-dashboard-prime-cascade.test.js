// Regression net for the Part-4 cascade bugs (PRIME-FIX-PLAN.md §4), all
// measured live 2026-08-01:
//
//   * #btabs had never rendered at ANY width. Its `display:block` lived in the
//     767px media section ~30 lines BEFORE the base `#btabs{display:none}` —
//     same specificity, later source order wins, so the bottom tab bar was
//     `none` everywhere since v11 shipped.
//   * `@media (max-width:1199px)` had no min-width floor, so the tablet
//     icon-rail rules (hide logo text, nav labels, conv titles, #sb-footer)
//     also applied at 375px INSIDE the 280px drawer — the drawer opened as a
//     blank black panel, and the v11 check "passed" because it asserted the
//     `mob-open` class, not content.
//   * #sb-search carried an inline `style="display:flex"` that beat its own
//     media query at every width.
//
// linkedom does not run the CSS cascade, so this file asserts the *stylesheet
// structure* that produced the bugs: source order, media bounds, and the
// absence of inline style. The computed-style equivalents (e.g. "#btabs is
// not `none` at 767px in a real browser") belong to the audit harness.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIME_PATH = path.join(HERE, '..', 'web', 'dashboard-prime.html');
const html = fs.readFileSync(PRIME_PATH, 'utf8');

const { document } = parseHTML(html);
const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');

/** Index of the last regex match in `css`, or -1. */
function lastMatchIndex(re) {
  let idx = -1;
  for (const m of css.matchAll(re)) idx = m.index;
  return idx;
}

/**
 * Brace-matched spans of every top-level @media block: [{query, start, end}].
 * A nearest-`@media`-lookbehind is not enough — a rule that merely appears
 * after an already-CLOSED media block would false-positive.
 */
function mediaBlocks() {
  const blocks = [];
  for (const m of css.matchAll(/@media ([^{]*)\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ query: m[1].trim(), start: m.index, end: i });
  }
  return blocks;
}

/** The @media query enclosing index `idx`, or null if it is a base rule. */
function enclosingMediaQuery(idx) {
  const hit = mediaBlocks().find((b) => idx > b.start && idx < b.end);
  return hit ? hit.query : null;
}

describe('dashboard-prime cascade structure (Part 4)', () => {
  test('#btabs show rule comes AFTER its base display:none — source order is the fix', () => {
    const lastNone = lastMatchIndex(/#btabs\s*\{[^}]*display:\s*none/g);
    const lastBlock = lastMatchIndex(/#btabs\s*\{[^}]*display:\s*block/g);
    expect(lastNone).toBeGreaterThan(-1);
    expect(lastBlock).toBeGreaterThan(-1);
    // Equal specificity: whichever is later in source wins. The show rule must
    // be last or the bar is invisible at every width again.
    expect(lastBlock).toBeGreaterThan(lastNone);
  });

  test('#btabs is shown by a dedicated mobile media block', () => {
    // The show rule must be scoped to phones; a bare `#btabs{display:block}`
    // would put a tab bar on desktop.
    expect(css).toMatch(/@media \(max-width:\s*767px\)\s*\{\s*#btabs\s*\{\s*display:\s*block/);
  });

  test('tablet icon-rail block is floored at 768px so it cannot reach into the drawer', () => {
    expect(css).toMatch(/@media \(min-width:\s*768px\) and \(max-width:\s*1199px\)/);
    // Every 1199px upper bound must carry the floor. An unfloored tablet block
    // is exactly how the drawer went blank.
    for (const m of css.matchAll(/@media ([^{]*1199px[^{]*)\{/g)) {
      expect(m[1]).toMatch(/min-width/);
    }
  });

  test('#sb-footer is only hidden inside the floored tablet block', () => {
    for (const m of css.matchAll(/#sb-footer\b/g)) {
      const query = enclosingMediaQuery(m.index);
      if (query === null) continue; // base rule outside any media query — fine
      // Inside a media query, any #sb-footer rule must be in the floored
      // tablet range — never in the phone range where it is drawer content.
      expect(query).toMatch(/min-width:\s*768px/);
    }
  });

  test('the hamburger is shown at phone width, not only in the tablet block', () => {
    // Regression, found by the real-cascade probe at 375px and NOT by any
    // structural check here: `#hbg { display: block }` existed only inside
    // the tablet block, so flooring that block at 768px (the drawer fix)
    // left phones with no touch affordance for the drawer at all — #btabs'
    // Files tab opens the file explorer, and Ctrl+B is not a phone gesture.
    // There is more than one phone-width block in this sheet, so assert
    // across all of them rather than the first one found.
    const phoneBlocks = mediaBlocks().filter(
      (b) => /max-width:\s*767px/.test(b.query) && !/min-width/.test(b.query));
    expect(phoneBlocks.length).toBeGreaterThan(0);
    const shown = phoneBlocks.some(
      (b) => /#hbg\s*\{[^}]*display:\s*block/.test(css.slice(b.start, b.end)));
    expect(shown).toBe(true);
  });

  test('#sb-search has no inline style attribute', () => {
    // An inline display beats every media query — this is how a 22px input
    // rendered inside the 50px rail.
    const el = document.querySelector('#sb-search');
    expect(el).not.toBeNull();
    expect(el.getAttribute('style')).toBeNull();
  });

  test('Part 3: every top-bar control is a real element with a mouse affordance', () => {
    // The v11 bar shipped four controls whose only trigger was display:none at
    // every width. The replacement must keep each control as an actual button
    // in the header — labels may shed responsively, controls may not.
    const top = document.querySelector('#top');
    expect(top.querySelector('#omni-wrap #omni')).not.toBeNull();
    for (const name of ['brain', 'desktop', 'fleet']) {
      const pill = top.querySelector('button#pill-' + name);
      expect(pill).not.toBeNull();
    }
    expect(top.querySelector('button#settings-btn')).not.toBeNull();
    // The overflow that hid four controls is gone, not restyled.
    expect(document.querySelector('#top-overflow')).toBeNull();
    expect(document.querySelector('#cmd-palette')).toBeNull();
  });

  test('Part 3: the ⚙ popover carries the sub-1200px surface for model + auto-route', () => {
    const pop = document.querySelector('#settings-pop');
    expect(pop).not.toBeNull();
    expect(pop.querySelector('#model-sel-top')).not.toBeNull();
    expect(pop.querySelector('#ar-tog-top')).not.toBeNull();
    expect(pop.querySelector('#theme-grid')).not.toBeNull();
  });

  test('Part 3: container queries shed labels, never whole controls', () => {
    // Inside the topbar container queries, display:none may only target
    // label-tier elements. Hiding a .pill, #omni or #settings-btn would
    // recreate the unreachable-control bug this file exists to prevent.
    for (const m of css.matchAll(/@container topbar[^{]*\{([\s\S]*?)\n\}/g)) {
      const body = m[1];
      for (const rule of body.matchAll(/([^{}]+)\{[^}]*display:\s*none/g)) {
        expect(rule[1]).toMatch(/\.pill-name|\.btn-label|#omni-key|#omni-glyph/);
      }
    }
  });

  test('the drawer has content, not just a class: model picker lives inside #sidebar', () => {
    // At 375px the drawer IS #sidebar. Assert the controls the drawer must
    // surface actually exist inside it — the v11 mistake was asserting
    // `mob-open` and never looking inside.
    const sidebar = document.querySelector('#sidebar');
    expect(sidebar).not.toBeNull();
    expect(sidebar.querySelector('#sb-footer #model-sel')).not.toBeNull();
    expect(sidebar.querySelector('#sb-footer #ar-tog')).not.toBeNull();
    expect(sidebar.querySelector('#sb-search')).not.toBeNull();
  });
});
