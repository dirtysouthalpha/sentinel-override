// tests/tab-manager.test.js
// Tests for tab-manager.js pure functions.

import { isValidUrl } from '../background/tab-manager.js';

describe('isValidUrl', () => {
  test('accepts https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  test('accepts http URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  test('accepts IP-based URLs', () => {
    expect(isValidUrl('https://192.168.1.1/admin')).toBe(true);
  });

  test('rejects empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  test('rejects null', () => {
    expect(isValidUrl(null)).toBe(false);
  });

  test('rejects plain text', () => {
    expect(isValidUrl('not a url')).toBe(false);
  });

  test('rejects javascript: URLs', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  test('accepts URLs with ports', () => {
    expect(isValidUrl('https://localhost:8080')).toBe(true);
  });

  test('accepts URLs with paths', () => {
    expect(isValidUrl('https://example.com/path/to/page?q=1')).toBe(true);
  });
});
