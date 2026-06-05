/**
 * Tests for background/error-utils.js
 */

import { jest } from '@jest/globals';
import { getErrorMessage, sleep } from '../background/error-utils.js';

describe('getErrorMessage', () => {
  test('returns string errors as-is', () => {
    expect(getErrorMessage('something went wrong')).toBe('something went wrong');
  });

  test('extracts message from Error objects', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  test('extracts message from plain objects with message property', () => {
    expect(getErrorMessage({ message: 'oops' })).toBe('oops');
  });

  test('stringifies numbers', () => {
    expect(getErrorMessage(42)).toBe('42');
  });

  test('stringifies booleans', () => {
    expect(getErrorMessage(false)).toBe('false');
  });

  test('handles null', () => {
    expect(getErrorMessage(null)).toBe('');
  });

  test('handles undefined', () => {
    expect(getErrorMessage(undefined)).toBe('');
  });

  test('handles objects without message property', () => {
    expect(getErrorMessage({ code: 500 })).toBe('[object Object]');
  });

  test('handles empty string', () => {
    expect(getErrorMessage('')).toBe('');
  });

  test('handles Error with empty message', () => {
    expect(getErrorMessage(new Error(''))).toBe('');
  });

  test('ignores non-string message property', () => {
    expect(getErrorMessage({ message: 42 })).toBe('[object Object]');
  });
});

describe('sleep', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('returns a promise', () => {
    expect(sleep(100)).toBeInstanceOf(Promise);
  });

  test('resolves after the specified delay', async () => {
    const p = sleep(500);
    jest.advanceTimersByTime(499);
    let resolved = false;
    p.then(() => { resolved = true; });
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  test('resolves immediately for 0ms', async () => {
    const p = sleep(0);
    jest.runAllTimers();
    await expect(p).resolves.toBeUndefined();
  });
});
