// background/self-healing-dom.js
// Self-healing DOM navigation with fallback strategies.
//
// When the agent's chosen selector or ref fails to resolve (SPA re-render,
// lazy-loaded panel, async DOM mutation), this module provides a ladder of
// fallback strategies to recover the intended target without an LLM round-trip.
//
// The strategies are ordered from cheapest/most-reliable to most-expensive:
//   1. Ref re-resolution via WeakRef lookup
//   2. Selector normalization (strip positional pseudo-classes)
//   3. Attribute-based fuzzy match (aria-label, data-testid, placeholder)
//   4. Text-content match against interactive elements
//   5. Structural sibling match (same tag + position in parent)
//   6. Visual proximity match (nearest bbox to last known coords)
//
// Each strategy returns either an element descriptor or null. The caller
// (agent-engine) uses the first non-null result.

import { getErrorMessage } from './error-utils.js';
import { wrapError, ERROR_CODES } from './agent-errors.js';

// ---------------------------------------------------------------------------
// Strategy registry
// ---------------------------------------------------------------------------

/**
 * A single fallback strategy. Each strategy is a plain object with:
 *   - id: string identifier (for telemetry)
 *   - description: human-readable explanation
 *   - attempt: async function(ctx) => elementDescriptor | null
 *
 * The ctx object passed to each strategy contains:
 *   - lastCommand: the action that failed (with selector, ref, type)
 *   - lastResult: the error string from the failed action
 *   - allElements: current observed element list (post re-scan)
 *   - pageText: visible page text
 *   - currentUrl: current page URL
 *   - consecutiveFailures: number of consecutive failures
 *   - stepCount: current step count
 */
const STRATEGIES = [
  {
    id: 'ref-resolve',
    description: 'Re-resolve the ref via WeakRef lookup (handles DOM shuffle)',
    attempt: _strategyRefResolve,
  },
  {
    id: 'selector-normalize',
    description: 'Strip positional pseudo-classes from selector and retry',
    attempt: _strategySelectorNormalize,
  },
  {
    id: 'attribute-fuzzy',
    description: 'Fuzzy match on aria-label / data-testid / placeholder',
    attempt: _strategyAttributeFuzzy,
  },
  {
    id: 'text-content',
    description: 'Match interactive elements by visible text content',
    attempt: _strategyTextContent,
  },
  {
    id: 'structural-sibling',
    description: 'Match by tag + structural position in parent',
    attempt: _strategyStructuralSibling,
  },
  {
    id: 'visual-proximity',
    description: 'Find nearest element to last known bounding box',
    attempt: _strategyVisualProximity,
  },
];

// ---------------------------------------------------------------------------
// Strategy 1: ref-resolve
async function _strategyRefResolve(ctx) {
  try {
    if (!ctx || typeof ctx.lastCommand !== 'object' || ctx.lastCommand === null) return null;
    const ref = ctx.lastCommand.ref;
    if (!ref || typeof ref !== 'string') return null;
    // The content script maintains a WeakRef lookup; we can't access it
    // directly from the background, but we can check if the ref appears in
    // the current element list (which was just re-scanned).
    if (!Array.isArray(ctx.allElements)) return null;
    const match = ctx.allElements.find(e => e && e.ref === ref);
    if (match) return match;
    return null;
  } catch (error) {
    console.warn('[Sentinel/self-healing] ref-resolve failed:', getErrorMessage(error));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: selector-normalize
async function _strategySelectorNormalize(ctx) {
  try {
    if (!ctx || typeof ctx.lastCommand !== 'object' || ctx.lastCommand === null) return null;
    const selector = ctx.lastCommand.selector;
    if (!selector || typeof selector !== 'string') return null;
    // Strip positional pseudo-classes that break on SPA re-renders.
    const stripped = selector
      .replace(/:nth-child\(\d+\)|:nth-of-type\(\d+\)|:first-child|:last-child|:first-of-type|:last-of-type|:only-child|:only-of-type/g, '')
      .trim();
    if (!stripped || stripped === selector) return null;
    if (!Array.isArray(ctx.allElements)) return null;
    // Try exact match on stripped selector.
    const exact = ctx.allElements.find(e => e && e.selector === stripped);
    if (exact) return exact;
    // Try prefix match (stripped is a suffix of a longer path).
    const leaf = stripped.split(/[\s>+~]+/).pop() || '';
    if (leaf && leaf !== stripped) {
      const leafMatch = ctx.allElements.find(e => e && e.selector && e.selector.endsWith(leaf));
      if (leafMatch) return leafMatch;
    }
    return null;
  } catch (error) {
    console.warn('[Sentinel/self-healing] selector-normalize failed:', getErrorMessage(error));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: attribute-fuzzy
async function _strategyAttributeFuzzy(ctx) {
  try {
    if (!ctx || typeof ctx.lastCommand !== 'object' || ctx.lastCommand === null) return null;
    if (!Array.isArray(ctx.allElements)) return null;
    const selector = ctx.lastCommand.selector || '';
    // Extract aria-label from the failed selector.
    const ariaMatch = selector.match(/\[aria-label="([^"]+)"\]/i);
    if (ariaMatch) {
      const lc = ariaMatch[1].trim().toLowerCase();
      const match = ctx.allElements.find(e => {
        if (!e || !e.ariaLabel) return false;
        return e.ariaLabel.toLowerCase() === lc || e.ariaLabel.toLowerCase().includes(lc);
      });
      if (match) return match;
    }
    // Extract data-testid.
    const testIdMatch = selector.match(/\[data-testid="([^"]+)"\]/);
    if (testIdMatch) {
      const base = testIdMatch[1];
      const match = ctx.allElements.find(e => {
        if (!e || !e.selector) return false;
        return e.selector.includes(base);
      });
      if (match) return match;
    }
    // Extract placeholder.
    const phMatch = selector.match(/\[placeholder="([^"]+)"\]/i);
    if (phMatch) {
      const ph = phMatch[1].trim().toLowerCase();
      const match = ctx.allElements.find(e => {
        if (!e || !e.text) return false;
        return e.text.toLowerCase().includes(ph);
      });
      if (match) return match;
    }
    return null;
  } catch (error) {
    console.warn('[Sentinel/self-healing] attribute-fuzzy failed:', getErrorMessage(error));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 4: text-content
async function _strategyTextContent(ctx) {
  try {
    if (!ctx || typeof ctx.lastCommand !== 'object' || ctx.lastCommand === null) return null;
    if (!Array.isArray(ctx.allElements)) return null;
    // Derive a text hint from the failed command's selector or ref context.
    const selector = ctx.lastCommand.selector || '';
    let textHint = null;
    // Try aria-label chunk.
    const ariaChunk = selector.match(/\[aria-label="([^"]+)"\]/i);
    if (ariaChunk) textHint = ariaChunk[1];
    // Try data-testid chunk.
    if (!textHint) {
      const testIdChunk = selector.match(/\[data-testid="([^"]+)"\]/);
      if (testIdChunk) textHint = testIdChunk[1];
    }
    if (!textHint || textHint.length < 2) return null;
    const lc = textHint.trim().toLowerCase();
    const match = ctx.allElements.find(e => {
      if (!e || !e.text) return false;
      const elText = e.text.toLowerCase();
      return elText === lc || elText.includes(lc) || lc.includes(elText);
    });
    return match || null;
  } catch (error) {
    console.warn('[Sentinel/self-healing] text-content failed:', getErrorMessage(error));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 5: structural-sibling
async function _strategyStructuralSibling(ctx) {
  try {
    if (!ctx || typeof ctx.lastCommand !== 'object' || ctx.lastCommand === null) return null;
    if (!Array.isArray(ctx.allElements)) return null;
    const selector = ctx.lastCommand.selector || '';
    // Extract tag name from selector (first segment).
    const tagMatch = selector.match(/^([a-z]+)/i);
    if (!tagMatch) return null;
    const tag = tagMatch[1].toUpperCase();
    // Find elements with the same tag, preferring those near the same position.
    const sameTag = ctx.allElements.filter(e => e && e.tag === tag);
    if (sameTag.length === 0) return null;
    // If there's only one, return it.
    if (sameTag.length === 1) return sameTag[0];
    // Otherwise pick the one with the shortest selector (most stable).
    sameTag.sort((a, b) => (a.selector || '').length - (b.selector || '').length);
    return sameTag[0];
  } catch (error) {
    console.warn('[Sentinel/self-healing] structural-sibling failed:', getErrorMessage(error));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 6: visual-proximity
async function _strategyVisualProximity(ctx) {
  try {
    if (!ctx || typeof ctx.lastCommand !== 'object' || ctx.lastCommand === null) return null;
    if (!Array.isArray(ctx.allElements)) return null;
    // Use the last known bbox from the failed command's context.
    const lastBbox = ctx.lastCommand._lastBbox || ctx._lastBbox;
    if (!lastBbox || typeof lastBbox.x !== 'number' || typeof lastBbox.y !== 'number') return null;
    let best = null;
    let bestDist = Infinity;
    for (const e of ctx.allElements) {
      if (!e || !e.bbox || typeof e.bbox.x !== 'number') continue;
      const dx = (e.bbox.x + (e.bbox.w || 0) / 2) - lastBbox.x;
      const dy = (e.bbox.y + (e.bbox.h || 0) / 2) - lastBbox.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    // Only return if within a reasonable distance (200px).
    if (best && bestDist < 200) return best;
    return null;
  } catch (error) {
    console.warn('[Sentinel/self-healing] visual-proximity failed:', getErrorMessage(error));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to recover a failed DOM target using the fallback strategy ladder.
 *
 * Runs each strategy in order until one returns a non-null element descriptor.
 * Returns an object describing the recovery outcome, including which strategy
 * succeeded (for telemetry) and the recovered element.
 *
 * @param {object} ctx - Agent context (see strategy ctx documentation above).
 * @returns {Promise<{recovered: boolean, strategy: string|null, element: object|null, attempts: number}>}
 */
export async function recoverDomTarget(ctx) {
  const result = { recovered: false, strategy: null, element: null, attempts: 0 };
  if (!ctx || typeof ctx !== 'object') return result;

  for (const strat of STRATEGIES) {
    result.attempts++;
    try {
      const element = await strat.attempt(ctx);
      if (element && typeof element === 'object') {
        result.recovered = true;
        result.strategy = strat.id;
        result.element = element;
        try {
          console.info(`[Sentinel/self-healing] Recovered via ${strat.id}:`, element.ref || element.selector || '(no-id)');
        } catch (_) { /* console unavailable */ }
        return result;
      }
    } catch (error) {
      console.warn(`[Sentinel/self-healing] Strategy ${strat.id} threw:`, getErrorMessage(error));
      // Continue to next strategy — a throwing strategy is not fatal.
    }
  }
  return result;
}

/**
 * List all registered self-healing strategies (for diagnostics/telemetry).
 * @returns {Array<{id: string, description: string}>}
 */
export function listSelfHealingStrategies() {
  return STRATEGIES.map(s => ({ id: s.id, description: s.description }));
}

/**
 * Classify a DOM failure into a coarse category for telemetry.
 * @param {string} errorText - The error string from the failed action.
 * @returns {'stale-ref'|'selector-miss'|'detached'|'not-visible'|'unknown'}
 */
export function classifyDomFailure(errorText) {
  if (typeof errorText !== 'string') return 'unknown';
  const lower = errorText.toLowerCase();
  if (/stale|garbage.collected|weakref/.test(lower)) return 'stale-ref';
  if (/element not found|no element|not in element list|selector/.test(lower)) return 'selector-miss';
  if (/detached|not connected|disconnected/.test(lower)) return 'detached';
  if (/not visible|hidden|display.*none|opacity.*0/.test(lower)) return 'not-visible';
  return 'unknown';
}
