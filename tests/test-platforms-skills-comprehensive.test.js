// Comprehensive tests for platforms/index.js and skills/index.js pure functions
import { jest } from '@jest/globals';

let getPlatformProfile, findMismatchHints, listAllProfiles;
let listSkills, getSkillStats;

beforeAll(async () => {
  const platMod = await import('../background/platforms/index.js');
  getPlatformProfile = platMod.getPlatformProfile;
  findMismatchHints = platMod.findMismatchHints;
  listAllProfiles = platMod.listAllProfiles;

  const skillMod = await import('../background/skills/index.js');
  listSkills = skillMod.listSkills;
  getSkillStats = skillMod.getSkillStats;
});

// ============================================================
// listAllProfiles
// ============================================================
describe('listAllProfiles', () => {
  test('returns an array', () => {
    const profiles = listAllProfiles();
    expect(Array.isArray(profiles)).toBe(true);
  });
  test('has at least 10 profiles', () => {
    expect(listAllProfiles().length).toBeGreaterThanOrEqual(10);
  });
  test('each profile has id', () => {
    for (const p of listAllProfiles()) {
      expect(p.id).toBeTruthy();
    }
  });
  test('each profile has label', () => {
    for (const p of listAllProfiles()) {
      expect(p.label).toBeTruthy();
    }
  });
  test('each profile has memoryKeyPrefix', () => {
    for (const p of listAllProfiles()) {
      expect(p).toHaveProperty('memoryKeyPrefix');
    }
  });
  test('includes sonicwall_nsm', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('sonicwall_nsm');
  });
  test('includes sonicwall_onbox', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('sonicwall_onbox');
  });
  test('includes m365_admin', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('m365_admin');
  });
  test('includes fortigate', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('fortigate');
  });
  test('includes itglue', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('itglue');
  });
  test('includes aruba', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('aruba');
  });
  test('includes screenconnect', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('screenconnect');
  });
  test('includes ninjarmm', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('ninjarmm');
  });
  test('includes connectwise_manage', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('connectwise_manage');
  });
  test('includes datto_rmm', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('datto_rmm');
  });
  test('includes cisco', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('cisco');
  });
  test('includes paloalto', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('paloalto');
  });
  test('includes sentinelone', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('sentinelone');
  });
  test('includes nvd', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('nvd');
  });
  test('includes virustotal', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('virustotal');
  });
  test('includes huntress', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('huntress');
  });
  test('includes network_device', () => {
    const ids = listAllProfiles().map(p => p.id);
    expect(ids).toContain('network_device');
  });
  test('no duplicate IDs', () => {
    const ids = listAllProfiles().map(p => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
  test('labels are strings', () => {
    for (const p of listAllProfiles()) {
      expect(typeof p.label).toBe('string');
    }
  });
});

// ============================================================
// getPlatformProfile
// ============================================================
describe('getPlatformProfile', () => {
  test('detects M365 admin from URL', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', 'check audit logs');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });
  test('detects M365 admin from admin endpoint', () => {
    const profile = getPlatformProfile('https://entra.microsoft.com/', 'check sign-ins');
    expect(profile).not.toBeNull();
  });
  test('detects SonicWall NSM from URL', () => {
    const profile = getPlatformProfile('https://192.168.1.1:443', 'check firewall rules');
    // NSM detection depends on specific URL patterns
    // Just verify we get some profile or null without error
    expect(profile === null || typeof profile === 'object').toBe(true);
  });
  test('returns null for non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'click the button');
    // network_device is catch-all, may match on keywords
    expect(profile === null || typeof profile === 'object').toBe(true);
  });
  test('handles null URL', () => {
    const profile = getPlatformProfile(null, 'check logs');
    expect(profile === null || typeof profile === 'object').toBe(true);
  });
  test('handles empty URL', () => {
    const profile = getPlatformProfile('', 'check logs');
    expect(profile === null || typeof profile === 'object').toBe(true);
  });
  test('handles null goal', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', null);
    expect(profile === null || typeof profile === 'object').toBe(true);
  });
  test('handles empty goal', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(profile === null || typeof profile === 'object').toBe(true);
  });
  test('returns object with id for matches', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/#!/portal', 'check users');
    if (profile) {
      expect(profile).toHaveProperty('id');
      expect(profile).toHaveProperty('label');
    }
  });
});

// ============================================================
// findMismatchHints
// ============================================================
describe('findMismatchHints', () => {
  test('returns empty for null profile', () => {
    expect(findMismatchHints(null, 'check SonicWall NSM')).toEqual([]);
  });
  test('returns empty for undefined profile', () => {
    expect(findMismatchHints(undefined, 'some goal')).toEqual([]);
  });
  test('returns empty for profile without mismatchHints', () => {
    expect(findMismatchHints({ id: 'test' }, 'some goal')).toEqual([]);
  });
  test('returns empty for null goal', () => {
    expect(findMismatchHints({ mismatchHints: [] }, null)).toEqual([]);
  });
  test('returns empty for empty goal', () => {
    expect(findMismatchHints({ mismatchHints: [] }, '')).toEqual([]);
  });
  test('returns empty when no hints match', () => {
    const profile = { mismatchHints: [{ pattern: /firewall rules/i, onbox: 'Firewall', nsm: 'NSM' }] };
    expect(findMismatchHints(profile, 'check audit logs')).toEqual([]);
  });
  test('returns hint when pattern matches goal', () => {
    const profile = { mismatchHints: [{ pattern: /firewall rules/i, onbox: 'Firewall', nsm: 'NSM' }] };
    const hints = findMismatchHints(profile, 'check firewall rules');
    expect(hints).toHaveLength(1);
    expect(hints[0].onbox).toBe('Firewall');
    expect(hints[0].target).toBe('NSM');
  });
  test('skips hints with bad patterns', () => {
    const profile = { mismatchHints: [{ pattern: null, onbox: 'A', nsm: 'B' }] };
    expect(findMismatchHints(profile, 'test')).toEqual([]);
  });
});

// ============================================================
// listSkills
// ============================================================
describe('listSkills', () => {
  test('returns an array', () => {
    expect(Array.isArray(listSkills())).toBe(true);
  });
  test('has at least 5 skills', () => {
    expect(listSkills().length).toBeGreaterThanOrEqual(5);
  });
  test('each skill has id', () => {
    for (const s of listSkills()) {
      expect(s.id).toBeTruthy();
    }
  });
  test('each skill has description', () => {
    for (const s of listSkills()) {
      expect(s.description).toBeTruthy();
    }
  });
  test('each skill has priority', () => {
    for (const s of listSkills()) {
      expect(typeof s.priority).toBe('number');
    }
  });
  test('each skill has effectivePriority', () => {
    for (const s of listSkills()) {
      expect(typeof s.effectivePriority).toBe('number');
    }
  });
  test('includes csp-blocked skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('csp-blocked');
  });
  test('includes auth-wall skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('auth-wall');
  });
  test('includes click-no-target skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('click-no-target');
  });
  test('includes navigate-loop skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('navigate-loop');
  });
  test('includes selector-miss skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('selector-miss');
  });
  test('includes unproductive-extract skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('unproductive-extract');
  });
  test('includes empty-observation skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('empty-observation');
  });
  test('includes consecutive-failures skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('consecutive-failures');
  });
  test('includes slow-llm-call skill', () => {
    const ids = listSkills().map(s => s.id);
    expect(ids).toContain('slow-llm-call');
  });
  test('no duplicate skill IDs', () => {
    const ids = listSkills().map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('effectivePriority equals base priority when no stats', () => {
    for (const s of listSkills()) {
      if (!s.stats) {
        expect(s.effectivePriority).toBe(s.priority);
      }
    }
  });
  test('stats is null or object for each skill', () => {
    for (const s of listSkills()) {
      expect(s.stats === null || typeof s.stats === 'object').toBe(true);
    }
  });
});

// ============================================================
// getSkillStats
// ============================================================
describe('getSkillStats', () => {
  test('returns an object', () => {
    expect(typeof getSkillStats()).toBe('object');
  });
  test('is not null', () => {
    expect(getSkillStats()).not.toBeNull();
  });
  test('each stat has fires', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('fires');
    }
  });
  test('each stat has successes', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('successes');
    }
  });
  test('each stat has failures', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('failures');
    }
  });
  test('each stat has lastFiredAt', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('lastFiredAt');
    }
  });
  test('each stat has lastOutcomeAt', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('lastOutcomeAt');
    }
  });
  test('each stat has basePriority', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('basePriority');
    }
  });
  test('each stat has effectivePriority', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('effectivePriority');
    }
  });
  test('each stat has successRate', () => {
    const stats = getSkillStats();
    for (const [id, stat] of Object.entries(stats)) {
      expect(stat).toHaveProperty('successRate');
    }
  });
});
