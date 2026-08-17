// tests/self-healing-dom.test.js
// Unit tests for the self-healing DOM navigation module.

import { recoverDomTarget, listSelfHealingStrategies, classifyDomFailure } from '../background/self-healing-dom.js';

// ========== classifyDomFailure ==========

describe('classifyDomFailure', () => {
  test('classifies stale-ref errors', () => {
    expect(classifyDomFailure('stale ref')).toBe('stale-ref');
    expect(classifyDomFailure('WeakRef garbage-collected')).toBe('stale-ref');
  });

  test('classifies selector-miss errors', () => {
    expect(classifyDomFailure('Element not found')).toBe('selector-miss');
    expect(classifyDomFailure('no element matches')).toBe('selector-miss');
  });

  test('classifies detached errors', () => {
    expect(classifyDomFailure('Element is detached from DOM')).toBe('detached');
    expect(classifyDomFailure('not connected')).toBe('detached');
  });

  test('classifies not-visible errors', () => {
    expect(classifyDomFailure('Element is not visible')).toBe('not-visible');
    expect(classifyDomFailure('display:none')).toBe('not-visible');
  });

  test('returns unknown for unrecognised input', () => {
    expect(classifyDomFailure('something random')).toBe('unknown');
    expect(classifyDomFailure(null)).toBe('unknown');
    expect(classifyDomFailure(123)).toBe('unknown');
  });
});

// ========== listSelfHealingStrategies ==========

describe('listSelfHealingStrategies', () => {
  test('returns an array of strategy descriptors', () => {
    const strategies = listSelfHealingStrategies();
    expect(Array.isArray(strategies)).toBe(true);
    expect(strategies.length).toBeGreaterThan(0);
    for (const s of strategies) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.description).toBe('string');
    }
  });

  test('includes expected strategy ids', () => {
    const ids = listSelfHealingStrategies().map(s => s.id);
    expect(ids).toContain('ref-resolve');
    expect(ids).toContain('selector-normalize');
    expect(ids).toContain('attribute-fuzzy');
    expect(ids).toContain('text-content');
    expect(ids).toContain('structural-sibling');
    expect(ids).toContain('visual-proximity');
  });
});

// ========== recoverDomTarget ==========

describe('recoverDomTarget', () => {
  test('returns not-recovered for null context', async () => {
    const result = await recoverDomTarget(null);
    expect(result.recovered).toBe(false);
    expect(result.strategy).toBeNull();
    expect(result.element).toBeNull();
  });

  test('returns not-recovered for empty context', async () => {
    const result = await recoverDomTarget({});
    expect(result.recovered).toBe(false);
  });

  test('ref-resolve strategy matches by ref', async () => {
    const ctx = {
      lastCommand: { type: 'click', ref: 'ref_5' },
      allElements: [
        { ref: 'ref_1', selector: '#a', tag: 'BUTTON' },
        { ref: 'ref_5', selector: '#b', tag: 'BUTTON' },
      ],
    };
    const result = await recoverDomTarget(ctx);
    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe('ref-resolve');
    expect(result.element.ref).toBe('ref_5');
  });

  test('selector-normalize strips positional pseudo-classes', async () => {
    const ctx = {
      lastCommand: { type: 'click', selector: 'div:nth-child(3) > button.save' },
      allElements: [
        { ref: 'ref_1', selector: 'button.save', tag: 'BUTTON' },
      ],
    };
    const result = await recoverDomTarget(ctx);
    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe('selector-normalize');
  });

  test('attribute-fuzzy matches aria-label case-insensitively', async () => {
    const ctx = {
      lastCommand: { type: 'click', selector: '[aria-label="Submit Form"]' },
      allElements: [
        { ref: 'ref_1', selector: '[aria-label="submit form"]', tag: 'BUTTON', ariaLabel: 'submit form' },
      ],
    };
    const result = await recoverDomTarget(ctx);
    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe('attribute-fuzzy');
  });

  test('text-content matches by visible text', async () => {
    const ctx = {
      lastCommand: { type: 'click', selector: '[data-testid="Save Button"]' },
      allElements: [
        { ref: 'ref_1', selector: '[data-testid="save-btn"]', tag: 'BUTTON', text: 'Save Button' },
      ],
    };
    const result = await recoverDomTarget(ctx);
    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe('text-content');
  });

  test('structural-sibling matches by tag name', async () => {
    const ctx = {
      lastCommand: { type: 'click', selector: 'button.save' },
      allElements: [
        { ref: 'ref_1', selector: 'button.primary', tag: 'BUTTON' },
        { ref: 'ref_2', selector: 'a.link', tag: 'A' },
      ],
    };
    const result = await recoverDomTarget(ctx);
    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe('structural-sibling');
    expect(result.element.tag).toBe('BUTTON');
  });

  test('visual-proximity matches nearest bbox', async () => {
    const ctx = {
      lastCommand: { type: 'click', selector: '#x', _lastBbox: { x: 100, y: 100 } },
      allElements: [
        { ref: 'ref_1', selector: '#a', tag: 'BUTTON', bbox: { x: 105, y: 105, w: 50, h: 30 } },
        { ref: 'ref_2', selector: '#b', tag: 'BUTTON', bbox: { x: 500, y: 500, w: 50, h: 30 } },
      ],
    };
    const result = await recoverDomTarget(ctx);
    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe('visual-proximity');
    expect(result.element.ref).toBe('ref_1');
  });

  test('returns attempts count even when not recovered', async () => {
    const ctx = {
      lastCommand: { type: 'click', selector: 'nonexistent' },
      allElements: [],
    };
    const result = await recoverDomTarget(ctx);
    expect(result.recovered).toBe(false);
    expect(result.attempts).toBeGreaterThan(0);
  });
});
