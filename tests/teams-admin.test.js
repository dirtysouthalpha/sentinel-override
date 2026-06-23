// tests/teams-admin.test.js
// Unit tests for background/platforms/teams_admin.js — Teams Admin Center profile.
//
// Coverage:
//   detect() — URL matching and goal keyword detection
//   inferSurface() — goal-to-surface mapping
//   Registry integration — getPlatformProfile returns teams_admin
//   Profile structure validation — required fields present

import { getPlatformProfile, listAllProfiles } from '../background/platforms/index.js';
import { teamsAdmin } from '../background/platforms/teams_admin.js';

// ═══════════════════════════════════════════════════════════
// detect() — URL matching
// ═══════════════════════════════════════════════════════════
describe('teamsAdmin.detect() — URL matching', () => {
  test('detects admin.teams.microsoft.com root', () => {
    expect(teamsAdmin.detect('https://admin.teams.microsoft.com/', '')).toBe(true);
  });

  test('detects admin.teams.microsoft.com with path', () => {
    expect(teamsAdmin.detect('https://admin.teams.microsoft.com/policies/app-app', '')).toBe(true);
  });

  test('detects admin.teams.microsoft.com with hash', () => {
    expect(teamsAdmin.detect('https://admin.teams.microsoft.com/#/dashboard', '')).toBe(true);
  });

  test('does NOT detect admin.microsoft.com (that is M365)', () => {
    expect(teamsAdmin.detect('https://admin.microsoft.com/', '')).toBe(false);
  });

  test('does NOT detect admin.exchange.microsoft.com', () => {
    expect(teamsAdmin.detect('https://admin.exchange.microsoft.com/', '')).toBe(false);
  });

  test('returns false for null url and goal', () => {
    expect(teamsAdmin.detect(null, null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// detect() — Goal keyword detection
// ═══════════════════════════════════════════════════════════
describe('teamsAdmin.detect() — Goal keywords', () => {
  test('detects "teams app" in goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Check teams app status')).toBe(true);
  });

  test('detects "teams admin" in goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Navigate to teams admin center')).toBe(true);
  });

  test('detects "teams policy" in goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Check teams policy for user')).toBe(true);
  });

  test('detects "app permission policy" in goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Check the app permission policy')).toBe(true);
  });

  test('detects "setup policy" in goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Check the setup policy')).toBe(true);
  });

  test('detects "copilot teams" in goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Check copilot in teams')).toBe(true);
  });

  test('detects "teams copilot" in goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Why cant user see teams copilot')).toBe(true);
  });

  test('does NOT detect generic copilot goal without teams', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Check copilot status')).toBe(false);
  });

  test('does NOT detect unrelated goal', () => {
    expect(teamsAdmin.detect('https://example.com/', 'Check SonicWall firewall rules')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// inferSurface() — goal-to-surface mapping
// ═══════════════════════════════════════════════════════════
describe('teamsAdmin.inferSurface()', () => {
  test('infers manage-apps for app status goals', () => {
    expect(teamsAdmin.inferSurface('Check app status for copilot')).toBe('manage-apps');
  });

  test('infers app-permission for permission policy goals', () => {
    expect(teamsAdmin.inferSurface('Check the app permission policy')).toBe('app-permission');
  });

  test('infers app-setup for setup policy goals', () => {
    expect(teamsAdmin.inferSurface('Check the setup policy for pinned apps')).toBe('app-setup');
  });

  test('infers users for user policy goals', () => {
    expect(teamsAdmin.inferSurface('Check nick assigned policies')).toBe('users');
  });

  test('infers meeting-policies for meeting goals', () => {
    expect(teamsAdmin.inferSurface('Check meeting policy lobby bypass')).toBe('meeting-policies');
  });

  test('defaults to manage-apps for generic goals', () => {
    expect(teamsAdmin.inferSurface('Check teams app catalog')).toBe('manage-apps');
  });
});

// ═══════════════════════════════════════════════════════════
// Registry integration
// ═══════════════════════════════════════════════════════════
describe('Registry integration — teams_admin', () => {
  test('getPlatformProfile returns teams_admin for admin.teams.microsoft.com URL', () => {
    const profile = getPlatformProfile('https://admin.teams.microsoft.com/policies/app-app', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('teams_admin');
  });

  test('getPlatformProfile returns teams_admin for teams copilot goal', () => {
    const profile = getPlatformProfile('https://example.com/', 'Investigate why copilot is missing in teams');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('teams_admin');
  });

  test('listAllProfiles includes teams_admin', () => {
    const profiles = listAllProfiles();
    const ids = profiles.map(p => p.id);
    expect(ids).toContain('teams_admin');
  });
});

// ═══════════════════════════════════════════════════════════
// Profile structure validation
// ═══════════════════════════════════════════════════════════
describe('teamsAdmin profile structure', () => {
  test('has required top-level fields', () => {
    expect(teamsAdmin.id).toBe('teams_admin');
    expect(teamsAdmin.label).toBe('Teams Admin Center');
    expect(teamsAdmin.memoryKeyPrefix).toBe('teams_');
    expect(typeof teamsAdmin.detect).toBe('function');
    expect(typeof teamsAdmin.inferSurface).toBe('function');
  });

  test('has surfaceUrls with correct keys', () => {
    expect(teamsAdmin.surfaceUrls).toBeDefined();
    expect(teamsAdmin.surfaceUrls['manage-apps']).toContain('admin.teams.microsoft.com/policies/app-app');
    expect(teamsAdmin.surfaceUrls['app-permission']).toContain('admin.teams.microsoft.com/policies/app-permission');
    expect(teamsAdmin.surfaceUrls['app-setup']).toContain('admin.teams.microsoft.com/policies/app-setup');
    expect(teamsAdmin.surfaceUrls['users']).toContain('admin.teams.microsoft.com/users');
  });

  test('has pageTypes with urlMatch patterns', () => {
    expect(Array.isArray(teamsAdmin.pageTypes)).toBe(true);
    expect(teamsAdmin.pageTypes.length).toBeGreaterThanOrEqual(8);
    const hasManageApps = teamsAdmin.pageTypes.some(p => p.name === 'manage-apps');
    expect(hasManageApps).toBe(true);
  });

  test('has knownSelectors with Teams-specific keys', () => {
    expect(teamsAdmin.knownSelectors).toBeDefined();
    expect(teamsAdmin.knownSelectors.appCatalogTable).toBeDefined();
    expect(teamsAdmin.knownSelectors.appStatusColumn).toBeDefined();
    expect(teamsAdmin.knownSelectors.userAssignedPoliciesTab).toBeDefined();
  });

  test('has waitStrings for key operations', () => {
    expect(teamsAdmin.waitStrings).toBeDefined();
    expect(teamsAdmin.waitStrings.appsListLoaded).toBeDefined();
    expect(teamsAdmin.waitStrings.appFound).toContain('Copilot');
    expect(teamsAdmin.waitStrings.userDetailsLoaded).toContain('App setup policy');
  });

  test('has mismatchHints for M365 confusion cases', () => {
    expect(Array.isArray(teamsAdmin.mismatchHints)).toBe(true);
    expect(teamsAdmin.mismatchHints.length).toBeGreaterThanOrEqual(3);
    const copilotHint = teamsAdmin.mismatchHints.find(h => h.pattern.toString().includes('copilot'));
    expect(copilotHint).toBeDefined();
  });

  test('has liveDataCaveats as string', () => {
    expect(typeof teamsAdmin.liveDataCaveats).toBe('string');
    expect(teamsAdmin.liveDataCaveats.length).toBeGreaterThan(50);
  });

  test('has knownGotchas as string with navigation paths', () => {
    expect(typeof teamsAdmin.knownGotchas).toBe('string');
    expect(teamsAdmin.knownGotchas).toContain('admin.teams.microsoft.com');
    expect(teamsAdmin.knownGotchas).toContain('Copilot');
  });

  test('has rewriteInstructions', () => {
    expect(typeof teamsAdmin.rewriteInstructions).toBe('string');
    expect(teamsAdmin.rewriteInstructions).toContain('teams_');
  });

  test('has workflowHints array with Copilot pattern', () => {
    expect(Array.isArray(teamsAdmin.workflowHints)).toBe(true);
    expect(teamsAdmin.workflowHints.length).toBeGreaterThanOrEqual(4);
    const copilotHint = teamsAdmin.workflowHints.find(h => h.match.toString().includes('copilot'));
    expect(copilotHint).toBeDefined();
    expect(copilotHint.hint).toContain('app-app');
    expect(copilotHint.hint).toContain('app-permission');
    expect(copilotHint.hint).toContain('app-setup');
  });
});
