// tests/llm-client-platform-error.test.js
// Covers L922 in llm-client.js: getPlatformContext catch block when
// getPlatformProfile throws. Requires mocking platforms/index.js so the
// import is in place before llm-client.js loads.

import { jest } from '@jest/globals';

jest.unstable_mockModule('../background/platforms/index.js', () => ({
  getPlatformProfile: () => { throw new Error('profile lookup test error'); },
  findMismatchHints: jest.fn(() => []),
  listAllProfiles: jest.fn(() => []),
}));

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
    },
  },
  runtime: { getURL: () => '', sendMessage: () => Promise.resolve() },
  tabs: { query: () => Promise.resolve([]) },
};

const { getPlatformContext } = await import('../background/llm-client.js');

describe('getPlatformContext — profile lookup failure (covers L922)', () => {
  test('warns and returns string when getPlatformProfile throws', () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warns.push(args.join(' ')); };
    let result;
    try {
      result = getPlatformContext('https://example.com/path', 'test goal');
    } finally {
      console.warn = origWarn;
    }
    expect(typeof result).toBe('string');
    expect(warns.some(w => w.includes('[Sentinel/llm] Profile lookup failed:'))).toBe(true);
  });
});
