// tests/agent-recovery-enhanced.test.js
// Tests for the enhanced agent-recovery module: jitter, classification, stats.

import { jest } from '@jest/globals';
import { withRecovery, resetRetries, getRetryCount, getFailureClassStats } from '../background/agent-recovery.js';
import { AgentError, ERROR_CODES } from '../background/agent-errors.js';

// Mock chrome.runtime.sendMessage so emitErrorCard doesn't throw in Node.
global.chrome = global.chrome || {
  runtime: {
    sendMessage: jest.fn(() => Promise.resolve()),
  },
};

// Instant sleep for deterministic tests — bypasses exponential backoff.
const instantSleep = async () => { /* resolves immediately */ };

describe('withRecovery', () => {
  beforeEach(() => {
    // Reset all retry counts before each test.
    resetRetries('test-op');
    resetRetries('non-retryable-op');
    resetRetries('multi-retry-op');
  });

  test('returns result on success without retry', async () => {
    const result = await withRecovery(async () => 'ok', {}, 'test-op', { sleepFn: instantSleep });
    expect(result).toBe('ok');
    expect(getRetryCount('test-op')).toBe(0);
  });

  test('retries retryable errors and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRecovery(async () => {
      calls++;
      if (calls < 3) {
        throw new AgentError({
          code: ERROR_CODES.NETWORK_ERROR,
          message: 'transient',
          retryable: true,
        });
      }
      return 'recovered';
    }, {}, 'multi-retry-op', { sleepFn: instantSleep });
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  test('throws after max retries for retryable error', async () => {
    await expect(withRecovery(async () => {
      throw new AgentError({
        code: ERROR_CODES.NETWORK_ERROR,
        message: 'persistent network error',
        retryable: true,
      });
    }, {}, 'multi-retry-op', { sleepFn: instantSleep })).rejects.toMatchObject({
      code: ERROR_CODES.MAX_RETRIES_EXCEEDED,
    });
  });

  test('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(withRecovery(async () => {
      calls++;
      throw new AgentError({
        code: ERROR_CODES.SELECTOR_MISS,
        message: 'bad selector',
        retryable: false,
      });
    }, {}, 'non-retryable-op', { sleepFn: instantSleep })).rejects.toMatchObject({
      code: ERROR_CODES.SELECTOR_MISS,
    });
    expect(calls).toBe(1);
  });

  test('wraps non-AgentError errors', async () => {
    let calls = 0;
    await expect(withRecovery(async () => {
      calls++;
      throw new Error('plain error');
    }, {}, 'test-op', { sleepFn: instantSleep })).rejects.toBeDefined();
    expect(calls).toBe(1); // non-retryable (UNKNOWN defaults to retryable=false)
  });
});

describe('getFailureClassStats', () => {
  test('returns an object', () => {
    const stats = getFailureClassStats();
    expect(typeof stats).toBe('object');
  });

  test('records failure classifications after retries', async () => {
    await withRecovery(async () => {
      throw new AgentError({
        code: ERROR_CODES.NETWORK_ERROR,
        message: 'rate limited',
        retryable: true,
      });
    }, {}, 'classify-op', { sleepFn: instantSleep }).catch(() => { /* expected */ });
    const stats = getFailureClassStats();
    // The error was classified and recorded.
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });
});

describe('resetRetries', () => {
  test('clears retry count', async () => {
    await withRecovery(async () => {
      throw new AgentError({
        code: ERROR_CODES.NETWORK_ERROR,
        message: 'x',
        retryable: true,
      });
    }, {}, 'reset-op', { sleepFn: instantSleep }).catch(() => { /* expected */ });
    resetRetries('reset-op');
    expect(getRetryCount('reset-op')).toBe(0);
  });
});
