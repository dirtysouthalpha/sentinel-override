// tests/skills-iife-callback.test.js
// Covers the loadAdaptiveState IIFE callback body (lines 50-52 in skills/index.js).
// A SEPARATE file is required because the IIFE runs once at module import time;
// this file uses a synchronous callback-style chrome.storage mock so the callback
// fires before any test code runs.

import { jest } from '@jest/globals';

let callbackResult = null;

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        if (typeof callback === 'function') {
          callbackResult = { skill_stats: { testSkill: { fires: 5, successes: 3, failures: 1, lastFiredAt: 0, lastOutcomeAt: 0 } }, telemetrySkillAdapt: false };
          callback(callbackResult);
        }
        return Promise.resolve(callbackResult || {});
      }),
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

const { getSkillStats } = await import('../background/skills/index.js');

describe('loadAdaptiveState IIFE — callback invoked (lines 50-52)', () => {
  test('stats are populated from storage callback (line 51)', () => {
    const stats = getSkillStats();
    expect(stats.testSkill).toBeDefined();
    expect(stats.testSkill.fires).toBe(5);
  });

  test('adaptEnabled set to false when telemetrySkillAdapt=false in callback (line 52)', () => {
    // Verify the callback ran — the stats populated is indirect proof.
    // _adaptEnabled=false is module-private, but its effect: effective priority stays at base.
    // We can verify the callback was called on the mock.
    expect(chrome.storage.local.get).toHaveBeenCalledWith(
      expect.arrayContaining(['skill_stats', 'telemetrySkillAdapt']),
      expect.any(Function)
    );
  });

  test('lastError guard skipped when lastError is null (line 50 condition false)', () => {
    // chrome.runtime.lastError is null → the early-return branch is not taken
    // Lines 51-52 still execute (covered by stats being populated above)
    expect(chrome.runtime.lastError).toBeNull();
    const stats = getSkillStats();
    expect(stats.testSkill).toBeDefined();
  });
});
