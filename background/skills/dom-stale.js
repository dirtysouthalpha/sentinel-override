// background/skills/dom-stale.js
// Fires when a ref or selector fails because the DOM element is no longer
// connected or the WeakRef has been garbage-collected. Common after SPA
// re-renders, route transitions, or lazy-loaded panel swaps.
// Recovery: trigger a re-scan (read_page) so the element list is fresh,
// then consult the self-healing ladder to find the intended target.

import { getErrorMessage } from '../error-utils.js';

const STALE_RE = /stale|detached|not connected|garbage.collected|weakref|no longer in dom|element is detached/i;

export const domStale = {
  id: 'dom-stale',
  description: 'Recovery when a ref or selector fails due to a stale/detached DOM element',
  priority: 88,

  matches(ctx) {
    try {
      if (!ctx || !ctx.lastResult || !ctx.lastActionFailed) return false;
      const r = (typeof ctx.lastResult === 'string' ? ctx.lastResult : String(ctx.lastResult));
      return STALE_RE.test(r);
    } catch (error) {
      console.error('Error in domStale matches:', getErrorMessage(error));
      return false;
    }
  },

  autoApply(_ctx) {
    // Force a fresh re-scan. The self-healing ladder runs after the re-scan
    // completes to correlate the failed selector against the new element list.
    return { type: 'read_page', _autoAppliedBy: 'dom-stale' };
  },

  promptInjection(ctx) {
    const lastSel = (typeof ctx.lastCommand === 'object' && ctx.lastCommand !== null &&
      (ctx.lastCommand.selector || ctx.lastCommand.ref)) || '(unknown)';
    return `The element you targeted (\`${lastSel}\`) is stale — the DOM was re-rendered under you (SPA route change, lazy panel swap, async mutation). Strategies:
1. Re-read the page (auto-applied this step) and pick a NEW target from the fresh element list. Do NOT re-emit the same ref or selector.
2. If you see the element you wanted but with a different ref, use the new ref from the observation — refs survive DOM shuffles better than CSS selectors.
3. If the element doesn't appear in the fresh list, it may need: a scroll to bring it into view, a wait_for_text for a known loading signal, or a click on a parent menu/tab to reveal it.
4. If the same element type exists nearby (same tag, similar text), the page likely re-rendered — use the closest match from the new observation.`;
  }
};
