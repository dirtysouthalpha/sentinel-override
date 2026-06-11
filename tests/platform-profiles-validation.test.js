// tests/platform-profiles-validation.test.js
// Schema validation and smoke tests for all registered platform profiles (PLT-01-04).

import { jest } from '@jest/globals';
import { getPlatformProfile, listAllProfiles, findMismatchHints } from '../background/platforms/index.js';

const PROFILE_IDS = [
  'sonicwall_nsm', 'sonicwall_onbox', 'm365_admin', 'fortigate', 'itglue',
  'aruba', 'ambio_viewlinc', 'screenconnect', 'ninjarmm', 'connectwise_manage',
  'datto_rmm', 'cisco', 'paloalto', 'sentinelone', 'nvd', 'virustotal',
  'huntress', 'network_device'
];

const SAMPLE_URLS = [
  'https://nsm.sonicwall.com/dashboard',
  'https://192.168.1.1/main.html',
  'https://admin.microsoft.com/',
  'https://10.0.0.1/',
  'https://example.com/',
  '',
];

describe('Platform profile registry - schema validation', () => {
  const profiles = listAllProfiles();
  const allIds = profiles.map(p => p.id);

  test('all 18 expected profiles are registered', () => {
    expect(allIds.length).toBeGreaterThanOrEqual(18);
    for (const id of PROFILE_IDS) {
      expect(allIds).toContain(id);
    }
  });

  test('no duplicate profile IDs', () => {
    const idSet = new Set(allIds);
    expect(idSet.size).toBe(allIds.length);
  });
});

describe('Platform profile registry - detect() smoke tests', () => {
  const profiles = listAllProfiles();

  test('every profile has a working detect function', () => {
    for (const meta of profiles) {
      for (const url of SAMPLE_URLS) {
        const profile = getPlatformProfile(url, meta.id);
      }
    }
  });

  test('getPlatformProfile returns null for empty inputs', () => {
    expect(getPlatformProfile('', '')).toBeNull();
  });

  test('getPlatformProfile returns null for unrelated URL and goal', () => {
    expect(getPlatformProfile('https://www.google.com/', 'search for cats')).toBeNull();
  });

  test('network_device is the catch-all and is registered last', () => {
    expect(profiles[profiles.length - 1].id).toBe('network_device');
  });
});

describe('Platform profile registry - findMismatchHints', () => {
  test('returns empty array for null profile', () => {
    expect(findMismatchHints(null, 'test')).toEqual([]);
  });

  test('returns empty array for profile without mismatchHints', () => {
    expect(findMismatchHints({ id: 'test' }, 'System > Licenses')).toEqual([]);
  });

  test('returns empty array when goal is null or empty (early return !goal)', () => {
    const profile = { mismatchHints: [{ pattern: /test/, onbox: 'a', nsm: 'b' }] };
    expect(findMismatchHints(profile, null)).toEqual([]);
    expect(findMismatchHints(profile, '')).toEqual([]);
  });

  test('returns matching hints when pattern matches goal', () => {
    const profile = {
      mismatchHints: [
        { pattern: /System > Licenses/i, onbox: 'System > Licenses', nsm: 'Tenants > Licenses' },
        { pattern: /no match/i, onbox: 'no match', nsm: 'other' },
      ]
    };
    const result = findMismatchHints(profile, 'Go to System > Licenses page');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ onbox: 'System > Licenses', target: 'Tenants > Licenses' });
  });

  test('swallows throwing hint pattern (catch block)', () => {
    const profile = {
      mismatchHints: [
        { pattern: { test() { throw new Error('bad regex'); } }, onbox: 'a', nsm: 'b' },
        { pattern: /valid/, onbox: 'c', nsm: 'd' },
      ]
    };
    expect(() => findMismatchHints(profile, 'valid goal')).not.toThrow();
    expect(findMismatchHints(profile, 'valid goal')).toEqual([{ onbox: 'c', target: 'd' }]);
  });
});

describe('Platform profile registry - getPlatformProfile catch block', () => {
  test('catches detect() Error and logs error.message (line 72 ternary true branch)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A goal whose toString() throws an Error — caught by getPlatformProfile's catch
    const badGoal = { toString() { throw new Error('bad goal msg'); } };
    expect(() => getPlatformProfile('https://example.com/', badGoal)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Sentinel]'),
      expect.anything(),
      expect.anything(),
      'bad goal msg'
    );
    warnSpy.mockRestore();
  });

  test('catches detect() non-Error throw and uses String(_e) (line 72 ternary false branch)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Goal whose toString() throws a primitive — _e is a number, not an Error object
    const badGoal = { toString() { throw 42; } };
    expect(() => getPlatformProfile('https://example.com/', badGoal)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Sentinel]'),
      expect.anything(),
      expect.anything(),
      '42'
    );
    warnSpy.mockRestore();
  });
});
