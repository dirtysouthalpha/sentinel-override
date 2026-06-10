// tests/error-utils.test.js
// Tests for error-utils.js pure functions.

import { getErrorMessage, sleep } from '../background/error-utils.js';

describe('getErrorMessage', () => {
  test('extracts message from Error objects', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error');
  });

  test('returns string directly', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
  });

  test('returns empty string for null', () => {
    expect(getErrorMessage(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('');
  });

  test('converts numbers to string', () => {
    expect(getErrorMessage(42)).toBe('42');
  });

  test('extracts message from object with message property', () => {
    expect(getErrorMessage({ message: 'obj error' })).toBe('obj error');
  });

  test('converts boolean to string', () => {
    expect(getErrorMessage(false)).toBe('false');
  });

  test('converts array to string', () => {
    expect(getErrorMessage([1, 2, 3])).toBe('1,2,3');
  });
});

describe('sleep', () => {
  test('resolves after specified delay', async () => {
    const start = Date.now();
    await sleep(10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5);
  });

  test('resolves with no value', async () => {
    const result = await sleep(1);
    expect(result).toBeUndefined();
  });
});
