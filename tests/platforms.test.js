// tests/platforms.test.js
// Unit tests for platform profile detection logic.
// Profiles are pure objects with a detect(url, goal) function — no chrome.* needed.

import { getPlatformProfile, listAllProfiles } from '../background/platforms/index.js';

describe('getPlatformProfile', () => {
  test('detects SonicWall NSM from cloud URL', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_nsm');
  });

  test('detects SonicWall on-box from IP-based admin URL', () => {
    const profile = getPlatformProfile('https://192.168.1.1/main.html', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects FortiGate from fortigate hostname', () => {
    const profile = getPlatformProfile('https://fortigate.local/ng/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('fortigate');
  });

  test('detects FortiGate from goal text when URL is a non-matched host', () => {
    const profile = getPlatformProfile('https://fortigate.acme.com/', 'Check the FortiGate firewall policy');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('fortigate');
  });

  test('detects M365 admin from admin.microsoft.com', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/AdminPortal/Home', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });

  test('detects ConnectWise Manage from URL', () => {
    const profile = getPlatformProfile('https://na.myconnectwise.net/v2023_1/services/system?screen=TicketList', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('connectwise_manage');
  });

  test('detects Datto RMM from centrastage URL', () => {
    const profile = getPlatformProfile('https://msp.centrastage.net/device/12345', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('datto_rmm');
  });

  test('returns null for unrecognised URL with no goal', () => {
    const profile = getPlatformProfile('https://example.com', '');
    expect(profile).toBeNull();
  });

  test('returns null for null URL and empty goal', () => {
    const profile = getPlatformProfile(null, '');
    expect(profile).toBeNull();
  });
});

describe('listAllProfiles', () => {
  test('returns an array of profile descriptors', () => {
    const list = listAllProfiles();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  test('each profile descriptor has id, label, and memoryKeyPrefix', () => {
    const list = listAllProfiles();
    for (const p of list) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.memoryKeyPrefix).toBe('string');
    }
  });
});

describe('workflowHints shape validation', () => {
  test('all profiles with workflowHints have valid hint entries', () => {
    const list = listAllProfiles();
    for (const descriptor of list) {
      // Re-import full profile to get workflowHints — listAllProfiles returns descriptors only
      // We test via getPlatformProfile with a goal-only match using the profile id
      const profile = getPlatformProfile(null, descriptor.id);
      if (!profile || !profile.workflowHints) continue;
      expect(Array.isArray(profile.workflowHints)).toBe(true);
      for (const wh of profile.workflowHints) {
        expect(wh.match).toBeInstanceOf(RegExp);
        expect(typeof wh.hint).toBe('string');
        expect(wh.hint.length).toBeGreaterThan(20);
      }
    }
  });

  test('sonicwall_onbox has workflowHints', () => {
    const profile = getPlatformProfile('https://192.168.1.1/main.html', '');
    expect(profile.workflowHints).toBeDefined();
    expect(profile.workflowHints.length).toBeGreaterThan(0);
  });

  test('fortigate has workflowHints', () => {
    const profile = getPlatformProfile('https://fortigate.local/ng/dashboard', '');
    expect(profile.workflowHints).toBeDefined();
    expect(profile.workflowHints.length).toBeGreaterThan(0);
  });

  test('m365_admin has workflowHints', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/AdminPortal/Home', '');
    expect(profile.workflowHints).toBeDefined();
    expect(profile.workflowHints.length).toBeGreaterThan(0);
  });

  test('connectwise_manage has workflowHints', () => {
    const profile = getPlatformProfile('https://na.myconnectwise.net/v2023_1/services/system?screen=TicketList', '');
    expect(profile.workflowHints).toBeDefined();
    expect(profile.workflowHints.length).toBeGreaterThan(0);
  });

  test('workflowHint regex matches expected goal text', () => {
    const sonicwall = getPlatformProfile('https://192.168.1.1/main.html', '');
    const tunnelHint = sonicwall.workflowHints.find(wh => wh.match.test('Check if the VPN tunnel is up'));
    expect(tunnelHint).toBeDefined();
    expect(tunnelHint.hint).toMatch(/Phase/);
  });
});
