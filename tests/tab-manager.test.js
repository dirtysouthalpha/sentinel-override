// tests/tab-manager.test.js
// Tests for tab-manager.js pure functions.

// Minimal chrome stub for module import (tab-manager uses chrome only in async functions)
globalThis.chrome = {
  tabs: { get: () => {}, onUpdated: { addListener: () => {}, removeListener: () => {} } },
  runtime: { lastError: null, onMessage: { addListener: () => {}, removeListener: () => {} } },
  scripting: { executeScript: () => Promise.resolve() },
  debugger: { onDetach: { addListener: () => {} } }
};

import {
  isValidUrl,
  setPageLoadConfig,
  readConsoleMessages,
  readNetworkRequests,
  clearObservabilityBuffers
} from '../background/tab-manager.js';

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

describe('setPageLoadConfig', () => {
  test('does not throw with valid config', () => {
    expect(() => setPageLoadConfig({ pageLoadTimeout: 10000 })).not.toThrow();
  });

  test('does not throw with empty config', () => {
    expect(() => setPageLoadConfig({})).not.toThrow();
  });
});

describe('readConsoleMessages', () => {
  test('returns empty array when no buffer exists for tabId', () => {
    expect(readConsoleMessages(99999)).toEqual([]);
  });

  test('returns empty array for negative limit', () => {
    expect(readConsoleMessages(99999, { limit: -1 })).toEqual([]);
  });

  test('returns empty array for NaN limit', () => {
    expect(readConsoleMessages(99999, { limit: NaN })).toEqual([]);
  });

  test('returns empty array with no options and unknown tabId', () => {
    expect(readConsoleMessages(99998)).toEqual([]);
  });

  test('returns empty array with filter=errors and no buffer', () => {
    expect(readConsoleMessages(99997, { filter: 'errors' })).toEqual([]);
  });

  test('returns empty array with filter=warnings and no buffer', () => {
    expect(readConsoleMessages(99996, { filter: 'warnings' })).toEqual([]);
  });
});

describe('readNetworkRequests', () => {
  test('returns empty array when no buffer exists for tabId', () => {
    expect(readNetworkRequests(99999)).toEqual([]);
  });

  test('returns empty array with filter options and no buffer', () => {
    expect(readNetworkRequests(99999, { filter: 'failed' })).toEqual([]);
    expect(readNetworkRequests(99999, { filter: '4xx' })).toEqual([]);
    expect(readNetworkRequests(99999, { filter: '5xx' })).toEqual([]);
  });

  test('returns empty array with url_includes filter and no buffer', () => {
    expect(readNetworkRequests(99999, { url_includes: '/api/' })).toEqual([]);
  });
});

describe('clearObservabilityBuffers', () => {
  test('does not throw for unknown tabId', () => {
    expect(() => clearObservabilityBuffers(99999)).not.toThrow();
  });

  test('can be called multiple times on same tabId without error', () => {
    expect(() => {
      clearObservabilityBuffers(88888);
      clearObservabilityBuffers(88888);
    }).not.toThrow();
  });
});
