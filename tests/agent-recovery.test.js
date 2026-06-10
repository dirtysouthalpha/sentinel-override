// tests/agent-recovery.test.js
// Tests for agent-recovery.js (COV-01).

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
