// tests/ws-bridge.test.js
// Tests for ws-bridge.js pure functions (COV-02).

import { validateMessage, computeChallengeResponse, setAuthTokenForTest } from '../background/ws-bridge.js';

// Set a known token so challenge-response tests are deterministic
setAuthTokenForTest('test-token-for-unit-tests');

describe('validateMessage', () => {
  test('rejects null', () => {
    expect(validateMessage(null)).toBe(false);
  });

  test('rejects undefined', () => {
    expect(validateMessage(undefined)).toBe(false);
  });

  test('rejects non-object', () => {
    expect(validateMessage('string')).toBe(false);
    expect(validateMessage(42)).toBe(false);
  });

  test('rejects object without type', () => {
    expect(validateMessage({})).toBe(false);
  });

  test('rejects unknown message type', () => {
    expect(validateMessage({ type: 'unknown_type' })).toBe(false);
  });

  test('accepts auth type', () => {
    expect(validateMessage({ type: 'auth' })).toBe(true);
  });

  test('accepts task type', () => {
    expect(validateMessage({ type: 'task', goal: 'test' })).toBe(true);
  });

  test('accepts query type', () => {
    expect(validateMessage({ type: 'query', message: 'hello' })).toBe(true);
  });

  test('accepts cancel type', () => {
    expect(validateMessage({ type: 'cancel', request_id: '123' })).toBe(true);
  });

  test('accepts status type', () => {
    expect(validateMessage({ type: 'status' })).toBe(true);
  });

  test('accepts auth_challenge type', () => {
    expect(validateMessage({ type: 'auth_challenge', nonce: 'abc' })).toBe(true);
  });
});

describe('computeChallengeResponse', () => {
  test('returns a string', () => {
    const result = computeChallengeResponse('test-nonce');
    expect(typeof result).toBe('string');
  });

  test('returns different results for different nonces', () => {
    const a = computeChallengeResponse('nonce-a');
    const b = computeChallengeResponse('nonce-b');
    expect(a).not.toBe(b);
  });

  test('returns same result for same nonce', () => {
    const a = computeChallengeResponse('test-nonce');
    const b = computeChallengeResponse('test-nonce');
    expect(a).toBe(b);
  });
});
