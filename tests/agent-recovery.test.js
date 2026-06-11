// tests/agent-recovery.test.js
// Tests for agent-recovery.js (COV-01).

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

globalThis.chrome = {
  runtime: { sendMessage: () => Promise.resolve(), lastError: null }
};

import { withRecovery, resetRetries, getRetryCount } from '../background/agent-recovery.js';
import { AgentError, ERROR_CODES } from '../background/agent-errors.js';

describe('withRecovery', () => {
  beforeEach(() => {
    resetRetries('test-op');
  });

  test('returns result on first success', async () => {
    const result = await withRecovery(() => Promise.resolve(42), {}, 'test-op');
    expect(result).toBe(42);
  });

  test('throws non-retryable error immediately', async () => {
    const fn = () => {
      throw new AgentError({ code: ERROR_CODES.AUTH_REQUIRED, message: 'no key', retryable: false });
    };
    await expect(withRecovery(fn, {}, 'test-op')).rejects.toThrow('no key');
  });

  test('throws on null function', async () => {
    await expect(withRecovery(null, {}, 'test-op')).rejects.toThrow();
  });

  test('wraps plain Error in AgentError with UNKNOWN code', async () => {
    const fn = () => { throw new Error('plain error'); };
    const err = await withRecovery(fn, { tabId: 5 }, 'wrap-op').catch(e => e);
    expect(err instanceof AgentError).toBe(true);
    expect(err.code).toBe(ERROR_CODES.UNKNOWN);
  });
});

describe('withRecovery — retry paths', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetRetries('retry-op');
    resetRetries('max-op');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('retries a retryable error and succeeds on second attempt', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls === 1) throw new AgentError({ code: ERROR_CODES.LLM_ERROR, message: 'transient', retryable: true });
      return 'recovered';
    };
    const promise = withRecovery(fn, {}, 'retry-op');
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  test('throws MAX_RETRIES_EXCEEDED after exhausting all retries', async () => {
    const fn = () => { throw new AgentError({ code: ERROR_CODES.LLM_ERROR, message: 'always fails', retryable: true }); };
    const promise = withRecovery(fn, {}, 'max-op');
    const rejection = expect(promise).rejects.toMatchObject({ code: ERROR_CODES.MAX_RETRIES_EXCEEDED, message: expect.stringMatching(/attempts/) });
    await jest.runAllTimersAsync();
    await rejection;
  });

  test('MAX_RETRIES_EXCEEDED error preserves originalCode in context', async () => {
    const fn = () => { throw new AgentError({ code: ERROR_CODES.NETWORK_ERROR, message: 'net fail', retryable: true }); };
    const promise = withRecovery(fn, {}, 'max-op');
    let caughtErr = null;
    const handled = promise.catch(e => { caughtErr = e; });
    await jest.runAllTimersAsync();
    await handled;
    expect(caughtErr.context.originalCode).toBe(ERROR_CODES.NETWORK_ERROR);
    expect(caughtErr.context.attempts).toBe(3);
  });
});

describe('resetRetries / getRetryCount', () => {
  test('count starts at 0', () => {
    expect(getRetryCount('nonexistent')).toBe(0);
  });

  test('reset clears count', () => {
    resetRetries('foo');
    expect(getRetryCount('foo')).toBe(0);
  });
});
