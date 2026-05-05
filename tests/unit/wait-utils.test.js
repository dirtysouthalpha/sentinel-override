// Sentinel Override v3 -- Unit tests for content/wait-utils.js
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

describe('wait-utils', () => {
  let wait;

  beforeAll(async () => {
    window.__sentinelUtils = window.__sentinelUtils || {};
    await import('../../content/wait-utils.js');
    wait = window.__sentinelUtils.wait;
  });

  it('exports wait from window.__sentinelUtils.wait', () => {
    expect(wait).toBeDefined();
    expect(wait.sleep).toBeInstanceOf(Function);
    expect(wait.checkCondition).toBeInstanceOf(Function);
    expect(wait.handleWaitFor).toBeInstanceOf(Function);
  });

  describe('sleep', () => {
    it('resolves after the specified time', async () => {
      vi.useFakeTimers();
      const promise = wait.sleep(1000);
      await vi.advanceTimersByTimeAsync(999);
      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('checkCondition', () => {
    it('returns true for wait_for_text when text is present', () => {
      document.body.innerHTML = '<div>Hello World</div>';
      expect(wait.checkCondition({ type: 'wait_for_text', text: 'Hello World' })).toBe(true);
    });

    it('returns false for wait_for_text when text is absent', () => {
      document.body.innerHTML = '<div>Goodbye</div>';
      expect(wait.checkCondition({ type: 'wait_for_text', text: 'Hello' })).toBe(false);
    });

    it('returns true for wait_for_element when selector exists', () => {
      document.body.innerHTML = '<div id="target">Found</div>';
      expect(wait.checkCondition({ type: 'wait_for_element', selector: '#target' })).toBe(true);
    });

    it('returns false for wait_for_element when selector does not exist', () => {
      document.body.innerHTML = '<div>Empty</div>';
      expect(wait.checkCondition({ type: 'wait_for_element', selector: '#missing' })).toBe(false);
    });

    it('returns false for wait_for_navigation when URL unchanged', () => {
      expect(wait.checkCondition({
        type: 'wait_for_navigation',
        currentUrl: window.location.href,
      })).toBe(false);
    });

    it('returns false for unknown condition type', () => {
      expect(wait.checkCondition({ type: 'unknown' })).toBe(false);
    });
  });

  describe('handleWaitFor', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('resolves immediately when condition is met', async () => {
      document.body.innerHTML = '<div>Target text</div>';
      const result = await wait.handleWaitFor({ type: 'wait_for_text', text: 'Target text' });
      expect(result).toContain('immediately');
    });

    it('resolves with timeout message when condition is never met', async () => {
      vi.useFakeTimers();
      document.body.innerHTML = '<div>Wrong text</div>';
      const promise = wait.handleWaitFor({ type: 'wait_for_text', text: 'Missing', timeout: 1000 });
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;
      expect(result).toContain('Timeout');
      vi.useRealTimers();
    });
  });
});
