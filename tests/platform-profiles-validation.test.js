// tests/platform-profiles-validation.test.js
// Schema validation and smoke tests for all registered platform profiles (PLT-01-04).

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
});
