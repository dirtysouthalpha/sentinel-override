// Tests for agent-circuit-breaker.js
// Validates identical-action detection, hard step ceiling, and loop patterns.

import {
  ABSOLUTE_MAX_STEPS,
  MAX_IDENTICAL_ACTIONS,
  MAX_SAME_TARGET_CLICKS,
  fingerprintCommand,
  checkCircuitBreaker,
  checkPageStaleness,
} from '../background/agent-circuit-breaker.js';

describe('agent-circuit-breaker', () => {
  describe('constants', () => {
    test('ABSOLUTE_MAX_STEPS is 150', () => {
      expect(ABSOLUTE_MAX_STEPS).toBe(150);
    });
    test('MAX_IDENTICAL_ACTIONS is 3', () => {
      expect(MAX_IDENTICAL_ACTIONS).toBe(3);
    });
    test('MAX_SAME_TARGET_CLICKS is 3', () => {
      expect(MAX_SAME_TARGET_CLICKS).toBe(3);
    });
  });

  describe('fingerprintCommand', () => {
    test('fingerprints click by selector', () => {
      const fp = fingerprintCommand({ type: 'click', selector: '#submit-btn' });
      expect(fp).toBe('click:#submit-btn');
    });
    test('fingerprints click_at by vision index', () => {
      const fp = fingerprintCommand({ type: 'click_at', _visionIndex: 5 });
      expect(fp).toBe('click_at:idx:5');
    });
    test('fingerprints click_at by coordinates', () => {
      const fp = fingerprintCommand({ type: 'click_at', x: 100, y: 200 });
      expect(fp).toBe('click_at:x:100,y:200');
    });
    test('fingerprints type by selector + text', () => {
      const fp = fingerprintCommand({ type: 'type', selector: '#search', text: 'hello world this is long' });
      expect(fp).toContain('type:#search:hello world this is');
    });
    test('fingerprints execute_js by code', () => {
      const fp = fingerprintCommand({ type: 'execute_js', code: 'return document.title' });
      expect(fp).toContain('execute_js:return document.title');
    });
    test('returns null for null input', () => {
      expect(fingerprintCommand(null)).toBe('null');
    });
    test('different selectors produce different fingerprints', () => {
      const fp1 = fingerprintCommand({ type: 'click', selector: '#btn1' });
      const fp2 = fingerprintCommand({ type: 'click', selector: '#btn2' });
      expect(fp1).not.toBe(fp2);
    });
  });

  describe('checkCircuitBreaker', () => {
    test('returns no action for empty history', () => {
      const result = checkCircuitBreaker([], 1, 100);
      expect(result.shouldBreak).toBe(false);
      expect(result.shouldHardStop).toBe(false);
    });

    test('detects identical action repeated 3+ times', () => {
      const history = [
        { action: { type: 'click', selector: '#submit' }, result: 'clicked' },
        { action: { type: 'click', selector: '#submit' }, result: 'clicked' },
        { action: { type: 'click', selector: '#submit' }, result: 'clicked' },
      ];
      const result = checkCircuitBreaker(history, 10, 100);
      expect(result.shouldBreak).toBe(true);
      expect(result.severity).toBe('critical');
      expect(result.reason).toContain('IDENTICAL ACTION LOOP');
      expect(result.directive).toContain('CIRCUIT BREAKER');
    });

    test('does not trigger on 2 identical actions', () => {
      const history = [
        { action: { type: 'click', selector: '#submit' }, result: 'clicked' },
        { action: { type: 'click', selector: '#submit' }, result: 'clicked' },
      ];
      const result = checkCircuitBreaker(history, 5, 100);
      expect(result.shouldBreak).toBe(false);
    });

    test('detects same target clicked 3+ times in window (non-consecutive)', () => {
      const history = [
        { action: { type: 'click', selector: '#btn' }, result: 'ok' },
        { action: { type: 'scroll', direction: 'down' }, result: 'scrolled' },
        { action: { type: 'click', selector: '#btn' }, result: 'ok' },
        { action: { type: 'read_page' }, result: 'read' },
        { action: { type: 'click', selector: '#btn' }, result: 'ok' },
      ];
      const result = checkCircuitBreaker(history, 10, 100);
      expect(result.shouldBreak).toBe(true);
      expect(result.reason).toContain('REPEATED TARGET');
    });

    test('hard stops at ABSOLUTE_MAX_STEPS', () => {
      const result = checkCircuitBreaker([], 151, 100);
      expect(result.shouldHardStop).toBe(true);
      expect(result.severity).toBe('critical');
      expect(result.reason).toContain('ABSOLUTE STEP CEILING');
    });

    test('warns when approaching absolute cap', () => {
      const result = checkCircuitBreaker([], ABSOLUTE_MAX_STEPS - 5, 100);
      expect(result.severity).toBe('warning');
      expect(result.directive).toContain('FINAL STEPS');
    });

    test('detects high failure rate', () => {
      const history = [
        { action: { type: 'click', selector: '#btn' }, result: 'Element not found' },
        { action: { type: 'click', selector: '#btn2' }, result: 'BLOCKED: not visible' },
        { action: { type: 'click', selector: '#btn3' }, result: 'Error: timeout' },
        { action: { type: 'click', selector: '#btn4' }, result: 'Element not found' },
        { action: { type: 'click', selector: '#btn5' }, result: 'failed' },
        { action: { type: 'click', selector: '#btn6' }, result: 'failed' },
      ];
      const result = checkCircuitBreaker(history, 15, 100);
      expect(result.shouldBreak).toBe(true);
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('HIGH FAILURE RATE');
    });

    test('does not trigger on normal varied history', () => {
      const history = [
        { action: { type: 'navigate', url: 'https://example.com' }, result: 'navigated' },
        { action: { type: 'read_page' }, result: 'read content' },
        { action: { type: 'click', selector: '#search' }, result: 'clicked' },
        { action: { type: 'type', selector: '#search', text: 'query' }, result: 'typed' },
      ];
      const result = checkCircuitBreaker(history, 5, 100);
      expect(result.shouldBreak).toBe(false);
      expect(result.shouldHardStop).toBe(false);
    });
  });

  describe('checkPageStaleness', () => {
    test('detects stale page after 4 unchanged steps', () => {
      const result = checkPageStaleness('hash123', 'hash123', 4);
      expect(result.isStale).toBe(true);
      expect(result.directive).toContain('STALE PAGE');
    });

    test('does not trigger for 3 unchanged steps', () => {
      const result = checkPageStaleness('hash123', 'hash123', 3);
      expect(result.isStale).toBe(false);
    });

    test('does not trigger when page changed', () => {
      const result = checkPageStaleness('hash456', 'hash123', 5);
      expect(result.isStale).toBe(false);
    });
  });
});
