// tests/agent-reporting.test.js
// Tests for agent-reporting.js pure functions (COV-04).

import { scoreActionConfidence } from '../background/agent-reporting.js';

describe('scoreActionConfidence', () => {
  test('returns 0 for null command', () => {
    expect(scoreActionConfidence(null, {})).toBe(0);
  });

  test('returns 95 for note type', () => {
    expect(scoreActionConfidence({ type: 'note' }, {})).toBe(95);
  });

  test('returns 95 for finish type', () => {
    expect(scoreActionConfidence({ type: 'finish' }, {})).toBe(95);
  });

  test('returns 80 for navigate type', () => {
    expect(scoreActionConfidence({ type: 'navigate' }, {})).toBe(80);
  });

  test('boosts for ID selector', () => {
    const score = scoreActionConfidence({ type: 'click', selector: '#submit-btn' }, {});
    expect(score).toBeGreaterThan(60);
  });

  test('penalizes XPath selector', () => {
    const score = scoreActionConfidence({ type: 'click', selector: '//div[@class=\"btn\"]' }, {});
    expect(score).toBeLessThan(60);
  });

  test('boosts for text value', () => {
    const base = scoreActionConfidence({ type: 'type' }, {});
    const withText = scoreActionConfidence({ type: 'type', text: 'hello' }, {});
    expect(withText).toBeGreaterThan(base);
  });

  test('boosts when selector found in pageContext', () => {
    const ctx = { elements: [{ selector: '#btn', id: '#btn' }] };
    const score = scoreActionConfidence({ type: 'click', selector: '#btn' }, ctx);
    expect(score).toBeGreaterThan(70);
  });

  test('penalizes when selector not found', () => {
    const ctx = { elements: [{ selector: '#other' }] };
    const score = scoreActionConfidence({ type: 'click', selector: '#btn' }, ctx);
    expect(score).toBeLessThanOrEqual(55);
  });

  test('clamps to 0-100 range', () => {
    const high = scoreActionConfidence({ type: 'click', selector: '#a', text: 'x' }, { elements: [{ selector: '#a', id: '#a' }] });
    expect(high).toBeLessThanOrEqual(100);
    expect(high).toBeGreaterThanOrEqual(0);
  });
});
