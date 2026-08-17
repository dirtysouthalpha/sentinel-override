// tests/skills-dom-stale.test.js
// Unit tests for the dom-stale recovery skill.

import { domStale } from '../background/skills/dom-stale.js';

describe('domStale skill', () => {
  test('has required interface', () => {
    expect(typeof domStale.id).toBe('string');
    expect(typeof domStale.description).toBe('string');
    expect(typeof domStale.priority).toBe('number');
    expect(typeof domStale.matches).toBe('function');
    expect(typeof domStale.autoApply).toBe('function');
    expect(typeof domStale.promptInjection).toBe('function');
  });

  test('matches stale ref error', () => {
    const ctx = { lastResult: 'Error: stale ref', lastActionFailed: true };
    expect(domStale.matches(ctx)).toBe(true);
  });

  test('matches detached element error', () => {
    const ctx = { lastResult: 'Element is detached from DOM', lastActionFailed: true };
    expect(domStale.matches(ctx)).toBe(true);
  });

  test('matches garbage-collected error', () => {
    const ctx = { lastResult: 'WeakRef garbage-collected', lastActionFailed: true };
    expect(domStale.matches(ctx)).toBe(true);
  });

  test('does not match when action succeeded', () => {
    const ctx = { lastResult: 'Error: stale ref', lastActionFailed: false };
    expect(domStale.matches(ctx)).toBe(false);
  });

  test('does not match when lastResult is empty', () => {
    const ctx = { lastResult: '', lastActionFailed: true };
    expect(domStale.matches(ctx)).toBe(false);
  });

  test('does not match null context', () => {
    expect(domStale.matches(null)).toBe(false);
  });

  test('autoApply returns read_page command', () => {
    const cmd = domStale.autoApply({});
    expect(cmd).toEqual({ type: 'read_page', _autoAppliedBy: 'dom-stale' });
  });

  test('promptInjection mentions the selector', () => {
    const ctx = { lastCommand: { selector: '#save-btn', type: 'click' } };
    const text = domStale.promptInjection(ctx);
    expect(text).toContain('#save-btn');
  });

  test('promptInjection handles unknown selector', () => {
    const ctx = { lastCommand: {} };
    const text = domStale.promptInjection(ctx);
    expect(text).toContain('stale');
  });
});
