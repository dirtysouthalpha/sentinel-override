// tests/skills-error-catch-blocks.test.js
// Tests specifically targeting the catch blocks in skill modules.
// These lines are covered by forcing exceptions within try blocks.

import { jest } from '@jest/globals';

import { clickNoTarget } from '../background/skills/click-no-target.js';
import { consecutiveFailures } from '../background/skills/consecutive-failures.js';
import { cspBlocked } from '../background/skills/csp-blocked.js';
import { emptyObservation } from '../background/skills/empty-observation.js';
import { navigateLoop } from '../background/skills/navigate-loop.js';
import { slowLlmCall } from '../background/skills/slow-llm-call.js';

// ── Navigate Loop catch blocks ──────────────────────────────────
describe('navigateLoop catch block coverage', () => {
  test('matches returns false when ctx throws on property access', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'lastResult', {
      get() { throw new Error('property access error'); }
    });
    expect(navigateLoop.matches(evilCtx)).toBe(false);
  });

  test('autoApply returns null for null ctx (error path)', () => {
    // null ctx hits the `if (!ctx) return null` path
    expect(navigateLoop.autoApply(null)).toBeNull();
  });

  test('promptInjection returns empty string for null ctx (error path)', () => {
    expect(navigateLoop.promptInjection(null)).toBe('');
  });

  test('promptInjection returns template for truthy ctx', () => {
    // The evil object IS truthy, so the try block succeeds with empty string template
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'bar', {
      get() { throw new Error('property access error'); }
    });
    // navigateLoop.promptInjection doesn't access any properties of ctx — just checks truthiness
    const result = navigateLoop.promptInjection(evilCtx);
    expect(typeof result).toBe('string');
    expect(result).toContain('SPA');
  });
});

// ── Click No Target catch blocks ─────────────────────────────────
describe('clickNoTarget catch block coverage', () => {
  test('matches returns false when ctx.lastResult throws', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'lastResult', {
      get() { throw new Error('access error'); }
    });
    evilCtx.lastActionFailed = true;
    evilCtx.lastCommand = { type: 'click' };
    expect(clickNoTarget.matches(evilCtx)).toBe(false);
  });

  test('promptInjection returns fallback string when ctx.lastCommand throws', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'lastCommand', {
      get() { throw new Error('access error'); }
    });
    const result = clickNoTarget.promptInjection(evilCtx);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── CSP Blocked catch blocks ─────────────────────────────────────
describe('cspBlocked catch block coverage', () => {
  test('matches returns false when ctx throws on property access', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'lastResult', {
      get() { throw new Error('access error'); }
    });
    expect(cspBlocked.matches(evilCtx)).toBe(false);
  });

  test('promptInjection returns fallback when ctx throws', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'lastCommand', {
      get() { throw new Error('access error'); }
    });
    const result = cspBlocked.promptInjection(evilCtx);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Consecutive Failures catch blocks ────────────────────────────
describe('consecutiveFailures catch block coverage', () => {
  test('matches returns false when ctx throws on property access', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'consecutiveFailures', {
      get() { throw new Error('access error'); }
    });
    expect(consecutiveFailures.matches(evilCtx)).toBe(false);
  });

  test('promptInjection returns error fallback when ctx throws', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'consecutiveFailures', {
      get() { throw new Error('access error'); }
    });
    const result = consecutiveFailures.promptInjection(evilCtx);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('autoApply always returns null', () => {
    expect(consecutiveFailures.autoApply({})).toBeNull();
    expect(consecutiveFailures.autoApply(null)).toBeNull();
    expect(consecutiveFailures.autoApply({ consecutiveFailures: 10 })).toBeNull();
  });
});

// ── Slow LLM Call catch block ────────────────────────────────────
describe('slowLlmCall catch block coverage', () => {
  test('promptInjection returns fallback when ctx throws', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'lastAiCallMs', {
      get() { throw new Error('access error'); }
    });
    const result = slowLlmCall.promptInjection(evilCtx);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('matches returns false for non-number lastAiCallMs', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 'slow' })).toBe(false);
  });

  test('matches returns false for missing lastAiCallMs', () => {
    expect(slowLlmCall.matches({})).toBe(false);
  });

  test('matches returns true for >= 25000ms', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 25000 })).toBe(true);
    expect(slowLlmCall.matches({ lastAiCallMs: 30000 })).toBe(true);
  });

  test('matches returns false for < 25000ms', () => {
    expect(slowLlmCall.matches({ lastAiCallMs: 24999 })).toBe(false);
  });

  test('autoApply always returns null', () => {
    expect(slowLlmCall.autoApply({})).toBeNull();
    expect(slowLlmCall.autoApply(null)).toBeNull();
  });
});

// ── Empty Observation catch block ────────────────────────────────
describe('emptyObservation catch block coverage', () => {
  test('matches returns false when ctx throws', () => {
    const evilCtx = {};
    Object.defineProperty(evilCtx, 'allElements', {
      get() { throw new Error('access error'); }
    });
    evilCtx.lastCommand = { type: 'read_page' };
    evilCtx.lastActionFailed = true;
    evilCtx.currentUrl = 'https://example.com';
    expect(emptyObservation.matches(evilCtx)).toBe(false);
  });
});

// ── Positive path coverage for navigateLoop ──────────────────────
describe('navigateLoop positive paths', () => {
  test('matches true for BLOCKED: already navigated', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: Already navigated to https://example.com',
      lastActionFailed: true
    })).toBe(true);
  });

  test('matches false for non-BLOCKED result', () => {
    expect(navigateLoop.matches({
      lastResult: 'Success',
      lastActionFailed: true
    })).toBe(false);
  });

  test('matches false when lastActionFailed is false', () => {
    expect(navigateLoop.matches({
      lastResult: 'BLOCKED: Already navigated to https://example.com',
      lastActionFailed: false
    })).toBe(false);
  });

  test('matches false when ctx is null', () => {
    expect(navigateLoop.matches(null)).toBe(false);
  });

  test('autoApply returns read_page action', () => {
    const result = navigateLoop.autoApply({ lastResult: 'test' });
    expect(result).toEqual({ type: 'read_page', _autoAppliedBy: 'navigate-loop' });
  });
});

// ── Positive path coverage for clickNoTarget ─────────────────────
describe('clickNoTarget positive paths', () => {
  test('matches true for BLOCKED: click command has no target', () => {
    expect(clickNoTarget.matches({
      lastResult: 'BLOCKED: Click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: true
    })).toBe(true);
  });

  test('matches false when lastActionFailed is false', () => {
    expect(clickNoTarget.matches({
      lastResult: 'BLOCKED: Click command has no target',
      lastCommand: { type: 'click' },
      lastActionFailed: false
    })).toBe(false);
  });

  test('matches false for non-BLOCKED result', () => {
    expect(clickNoTarget.matches({
      lastResult: 'Success',
      lastCommand: { type: 'click' },
      lastActionFailed: true
    })).toBe(false);
  });

  test('autoApply returns read_page', () => {
    expect(clickNoTarget.autoApply({})).toEqual({ type: 'read_page', _autoAppliedBy: 'click-no-target' });
  });
});

// ── Positive path coverage for cspBlocked ────────────────────────
describe('cspBlocked positive paths', () => {
  test('matches true for CSP_BLOCKED result', () => {
    expect(cspBlocked.matches({ lastResult: 'CSP_BLOCKED: page denies inline scripts' })).toBe(true);
  });

  test('matches false for non-CSP result', () => {
    expect(cspBlocked.matches({ lastResult: 'Success' })).toBe(false);
  });

  test('matches false when ctx is null', () => {
    expect(cspBlocked.matches(null)).toBe(false);
  });

  test('autoApply returns read_page', () => {
    expect(cspBlocked.autoApply({})).toEqual({ type: 'read_page', _autoAppliedBy: 'csp-blocked' });
  });
});

// ── Positive path coverage for consecutiveFailures ──────────────
describe('consecutiveFailures positive paths', () => {
  test('matches true when consecutiveFailures >= 3', () => {
    expect(consecutiveFailures.matches({ consecutiveFailures: 3 })).toBe(true);
    expect(consecutiveFailures.matches({ consecutiveFailures: 5 })).toBe(true);
  });

  test('matches false when consecutiveFailures < 3', () => {
    expect(consecutiveFailures.matches({ consecutiveFailures: 2 })).toBe(false);
    expect(consecutiveFailures.matches({ consecutiveFailures: 0 })).toBe(false);
  });

  test('matches false when ctx is null', () => {
    expect(consecutiveFailures.matches(null)).toBe(false);
  });

  test('promptInjection includes step info', () => {
    const result = consecutiveFailures.promptInjection({
      consecutiveFailures: 4,
      stepCount: 10,
      dynamicMaxSteps: 100,
    });
    expect(result).toContain('4');
    expect(result).toContain('90');
    expect(result).toContain('execute_js');
  });
});
