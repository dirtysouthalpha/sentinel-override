// tests/skills-iife-throw.test.js
// Covers the loadAdaptiveState IIFE catch block (line 65 in skills/index.js).
// chrome.storage.local.get throws synchronously, triggering the catch on line 65.
// A separate file is required because the IIFE runs once at module import time.

import { jest } from '@jest/globals';

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(() => { throw new Error('storage unavailable'); }),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: jest.fn() },
  },
  runtime: { lastError: null },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { runRecoverySkills } = await import('../background/skills/index.js');

afterAll(() => {
  warnSpy.mockRestore();
});

describe('loadAdaptiveState IIFE — catch block (line 65)', () => {
  test('logs warning when chrome.storage.local.get throws at init', () => {
    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/skills] init error:',
      expect.any(String)
    );
  });

  test('module still exports runRecoverySkills despite init error', () => {
    expect(typeof runRecoverySkills).toBe('function');
    const result = runRecoverySkills({});
    expect(result.autoApply).toBeNull();
    expect(result.promptInjection).toBe('');
  });
});
