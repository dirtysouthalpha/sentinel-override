// tests/platforms.test.js
// Unit tests for platform profile detection logic.
// Profiles are pure objects with a detect(url, goal) function — no chrome.* needed.

import { readdirSync } from 'fs';

import { getPlatformProfile, listAllProfiles, findMismatchHints } from '../background/platforms/index.js';

// ========== Individual profile detect() tests ==========

describe('getPlatformProfile — SonicWall NSM', () => {
  test('detects from cloud URL', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_nsm');
  });

  test('detects from cloud.sonicwall.com', () => {
    const profile = getPlatformProfile('https://cloud.sonicwall.com/manage', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_nsm');
  });

  test('detects from goal text "SonicWall NSM" with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check SonicWall NSM policies');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_nsm');
  });
});

describe('getPlatformProfile — SonicWall on-box', () => {
  test('detects from IP-based admin URL', () => {
    const profile = getPlatformProfile('https://192.168.1.1/main.html', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects from /sonicui/ path', () => {
    const profile = getPlatformProfile('https://10.0.0.1/sonicui/login', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects from IP-based URL with /dashboard path', () => {
    const profile = getPlatformProfile('https://192.168.1.1/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects from IP-based URL with /vpn path', () => {
    const profile = getPlatformProfile('https://10.0.0.1/vpn', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects from IP-based URL with /system path', () => {
    const profile = getPlatformProfile('https://10.0.0.1/system', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects from goal text mentioning SonicOS', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check SonicOS settings');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects from goal text mentioning NSA', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check NSA2600 firewall rules');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('detects from goal text mentioning TZ', () => {
    const profile = getPlatformProfile('https://example.com/', 'Configure TZ350 VPN');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });

  test('does not detect NSM URLs as on-box', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/main.html', '');
    expect(profile).not.toBeNull();
    expect(profile.id).not.toBe('sonicwall_onbox');
  });

  test('detects from /auth.html path', () => {
    const profile = getPlatformProfile('https://192.168.1.1/auth.html', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sonicwall_onbox');
  });
});

describe('getPlatformProfile — M365 admin', () => {
  test('detects from admin.microsoft.com', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/AdminPortal/Home', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });

  test('detects from entra.microsoft.com', () => {
    const profile = getPlatformProfile('https://entra.microsoft.com/', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });

  test('detects from security.microsoft.com (Defender)', () => {
    const profile = getPlatformProfile('https://security.microsoft.com/', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });

  test('detects from portal.azure.com', () => {
    const profile = getPlatformProfile('https://portal.azure.com/', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });

  test('detects from goal text mentioning Exchange with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Run a message trace in Exchange admin');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });

  test('detects from goal text mentioning Purview with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Purview audit logs');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('m365_admin');
  });
});

describe('getPlatformProfile — FortiGate', () => {
  test('detects from fortigate hostname', () => {
    const profile = getPlatformProfile('https://fortigate.local/ng/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('fortigate');
  });

  test('detects from fortinet hostname', () => {
    const profile = getPlatformProfile('https://fortinet.example.com/', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('fortigate');
  });

  test('detects from goal text when URL is non-matched', () => {
    const profile = getPlatformProfile('https://fortigate.acme.com/', 'Check the FortiGate firewall policy');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('fortigate');
  });
});

describe('getPlatformProfile — IT Glue', () => {
  test('detects from itglue.com URL', () => {
    const profile = getPlatformProfile('https://abc.itglue.com/configurations', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('itglue');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Look up the IT Glue documentation for this client');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('itglue');
  });
});

describe('getPlatformProfile — Aruba', () => {
  test('detects from central.arubanetworks.com', () => {
    const profile = getPlatformProfile('https://central.arubanetworks.com/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('aruba');
  });

  test('detects from goal text mentioning Aruba with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check the Aruba Central AP status');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('aruba');
  });
});

describe('getPlatformProfile — Ambio viewLinc', () => {
  test('detects from 192.168.100.x URL', () => {
    const profile = getPlatformProfile('https://192.168.100.50/Vaisala/', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('ambio_viewlinc');
  });

  test('detects from goal text mentioning viewlinc', () => {
    const profile = getPlatformProfile(null, 'Check viewlinc alarm thresholds');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('ambio_viewlinc');
  });
});

describe('getPlatformProfile — ScreenConnect', () => {
  test('detects from screenconnect.com URL', () => {
    const profile = getPlatformProfile('https://company.screenconnect.com/Host#Access', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('screenconnect');
  });

  test('detects from /Host#Access path on any host', () => {
    const profile = getPlatformProfile('https://remote.example.com/Host#Access', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('screenconnect');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Open ScreenConnect and run a command');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('screenconnect');
  });
});

describe('getPlatformProfile — NinjaOne RMM', () => {
  test('detects from ninjarmm.com URL', () => {
    const profile = getPlatformProfile('https://app.ninjarmm.com/#dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('ninjarmm');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check NinjaOne agent status');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('ninjarmm');
  });
});

describe('getPlatformProfile — ConnectWise Manage', () => {
  test('detects from myconnectwise.net URL', () => {
    const profile = getPlatformProfile('https://na.myconnectwise.net/v2023_1/services/system?screen=TicketList', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('connectwise_manage');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Open the ConnectWise Manage ticket list');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('connectwise_manage');
  });
});

describe('getPlatformProfile — Datto RMM', () => {
  test('detects from centrastage.net URL', () => {
    const profile = getPlatformProfile('https://msp.centrastage.net/device/12345', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('datto_rmm');
  });

  test('detects from dattormm.com URL', () => {
    const profile = getPlatformProfile('https://concordion.dattormm.com/', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('datto_rmm');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Datto RMM for offline agents');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('datto_rmm');
  });
});

describe('getPlatformProfile — Cisco', () => {
  test('detects from meraki.com URL', () => {
    const profile = getPlatformProfile('https://dashboard.meraki.com/manage', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from /asdm path', () => {
    const profile = getPlatformProfile('https://192.168.1.1/asdm', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from goal text mentioning Meraki with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Meraki switch port status');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from goal text mentioning Firepower with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Firepower FMC access control policy');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from cisco.com URL', () => {
    const profile = getPlatformProfile('https://app.cisco.com/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from /fmc path', () => {
    const profile = getPlatformProfile('https://10.0.0.1/fmc/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from ISE hostname', () => {
    const profile = getPlatformProfile('https://my.ise.local/admin', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from goal text mentioning Cisco ASA', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Cisco ASA firewall rules');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('detects from goal text mentioning Cisco ISE', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Cisco ISE identity services');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('cisco');
  });

  test('inferSurface returns ise for ISE goals', () => {
    const profile = getPlatformProfile('https://dashboard.meraki.com/', '');
    if (typeof profile.inferSurface === 'function') {
      expect(profile.inferSurface('Check ISE identity policy')).toBe('ise');
    }
  });

  test('inferSurface returns asdm for ASA goals', () => {
    const profile = getPlatformProfile('https://dashboard.meraki.com/', '');
    if (typeof profile.inferSurface === 'function') {
      expect(profile.inferSurface('Check ASA access rules via ASDM')).toBe('asdm');
    }
  });
});

describe('getPlatformProfile — Palo Alto', () => {
  test('detects from paloalto hostname', () => {
    const profile = getPlatformProfile('https://paloalto.local/', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('paloalto');
  });

  test('detects from /php/rest/pan path', () => {
    const profile = getPlatformProfile('https://10.0.0.1/php/rest/pan/config', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('paloalto');
  });

  test('detects from goal text mentioning PAN-OS with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Update the PAN-OS security policy');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('paloalto');
  });
});

describe('getPlatformProfile — SentinelOne', () => {
  test('detects from sentinelone.net URL', () => {
    const profile = getPlatformProfile('https://usea1.sentinelone.net/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sentinelone');
  });

  test('detects from .sentinelone.com URL', () => {
    const profile = getPlatformProfile('https://console.sentinelone.com/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sentinelone');
  });

  test('detects from bare sentinelone.com URL (no subdomain)', () => {
    const profile = getPlatformProfile('https://sentinelone.com/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sentinelone');
  });

  test('detects from s1.com URL', () => {
    const profile = getPlatformProfile('https://usea1.s1.com/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sentinelone');
  });

  test('detects from goal text mentioning Singularity', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Singularity console alerts');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sentinelone');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check SentinelOne threat console');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('sentinelone');
  });
});

describe('getPlatformProfile — NVD', () => {
  test('detects from nvd.nist.gov URL', () => {
    const profile = getPlatformProfile('https://nvd.nist.gov/vuln/search', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('nvd');
  });

  test('detects from cve.org URL', () => {
    const profile = getPlatformProfile('https://www.cve.org/CVERecord', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('nvd');
  });

  test('detects from goal text mentioning NVD with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Search the NVD for CVE-2024-1234');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('nvd');
  });

  test('detects from goal text mentioning CVE database with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Look up CVE database for Apache vulnerabilities');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('nvd');
  });
});

describe('getPlatformProfile — VirusTotal', () => {
  test('detects from virustotal.com URL', () => {
    const profile = getPlatformProfile('https://www.virustotal.com/gui/file/abc123/detection', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('virustotal');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check this hash on VirusTotal');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('virustotal');
  });
});

describe('getPlatformProfile — Huntress', () => {
  test('detects from huntress URL', () => {
    const profile = getPlatformProfile('https://partner.huntress.io/dashboard', '');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('huntress');
  });

  test('detects from goal text with non-matching URL', () => {
    const profile = getPlatformProfile('https://example.com/', 'Check Huntress MDR alerts');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('huntress');
  });
});

describe('getPlatformProfile — Network Device (catch-all)', () => {
  test('detects from goal text mentioning firewall', () => {
    const profile = getPlatformProfile('https://192.168.1.250/', 'Check firewall rules');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('network_device');
  });

  test('detects from goal text mentioning router', () => {
    const profile = getPlatformProfile('https://10.0.0.1/', 'Configure the router interfaces');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('network_device');
  });

  test('detects from goal text mentioning access point', () => {
    const profile = getPlatformProfile('https://192.168.1.10/', 'Check access point configuration');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('network_device');
  });

  test('detects from goal text mentioning admin panel', () => {
    const profile = getPlatformProfile('https://192.168.1.50/', 'Open admin panel for switch');
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('network_device');
  });
});

// ========== Edge cases ==========

describe('getPlatformProfile — edge cases', () => {
  test('returns null for unrecognised URL with no goal', () => {
    const profile = getPlatformProfile('https://example.com', '');
    expect(profile).toBeNull();
  });

  test('returns null for null URL and empty goal', () => {
    const profile = getPlatformProfile(null, '');
    expect(profile).toBeNull();
  });

  test('returns null for null URL and null goal', () => {
    const profile = getPlatformProfile(null, null);
    expect(profile).toBeNull();
  });

  test('returns null for undefined URL and goal', () => {
    const profile = getPlatformProfile(undefined, undefined);
    expect(profile).toBeNull();
  });

  test('returns null for empty string URL', () => {
    const profile = getPlatformProfile('', '');
    expect(profile).toBeNull();
  });

  test('handles malformed URL gracefully', () => {
    const profile = getPlatformProfile('not-a-url', '');
    // Should not throw, returns null or a profile via goal fallback
    expect(profile).toBeDefined();
  });
});

// ========== Profile ordering / priority ==========

describe('profile ordering — specific before generic', () => {
  test('NSM URL beats on-box patterns', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/main.html', '');
    expect(profile.id).toBe('sonicwall_nsm');
  });

  test('FortiGate URL beats network_device catch-all', () => {
    const profile = getPlatformProfile('https://fortigate.local/ng/', 'Check firewall rules');
    expect(profile.id).toBe('fortigate');
  });

  test('M365 URL beats network_device catch-all', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', 'Check the admin panel');
    expect(profile.id).toBe('m365_admin');
  });

  test('Palo Alto URL beats network_device catch-all', () => {
    const profile = getPlatformProfile('https://paloalto.local/', 'Check firewall policies');
    expect(profile.id).toBe('paloalto');
  });

  test('Cisco URL beats network_device catch-all', () => {
    const profile = getPlatformProfile('https://dashboard.meraki.com/', 'Check router config');
    expect(profile.id).toBe('cisco');
  });
});

// ========== listAllProfiles ==========

describe('listAllProfiles', () => {
  test('returns an array of profile descriptors', () => {
    const list = listAllProfiles();
    expect(Array.isArray(list)).toBe(true);
    // Counted from the profiles on disk rather than hardcoded: the registry is
    // generated, so a legitimate new platform used to fail this assertion for no
    // reason. tests/platform-registry.test.js pins the exact match order.
    const profileFiles = readdirSync(new URL('../background/platforms/', import.meta.url))
      .filter(f => f.endsWith('.js') && f !== 'index.js');
    expect(list.length).toBe(profileFiles.length);
  });

  test('each profile descriptor has id, label, and memoryKeyPrefix', () => {
    const list = listAllProfiles();
    for (const p of list) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.memoryKeyPrefix).toBe('string');
    }
  });

  test('network_device is the last profile (catch-all must be last)', () => {
    const list = listAllProfiles();
    expect(list[list.length - 1].id).toBe('network_device');
  });

  test('all profile ids are unique', () => {
    const list = listAllProfiles();
    const ids = list.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ========== findMismatchHints ==========

describe('findMismatchHints', () => {
  test('returns empty array for null profile', () => {
    expect(findMismatchHints(null, 'System > Licenses')).toEqual([]);
  });

  test('returns empty array for profile without mismatchHints', () => {
    const profile = getPlatformProfile('https://fortigate.local/ng/', '');
    // fortigate has no mismatchHints defined (or empty)
    expect(findMismatchHints(profile, 'Check policies')).toEqual([]);
  });

  test('returns empty array for null goal', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/', '');
    expect(findMismatchHints(profile, null)).toEqual([]);
  });

  test('returns empty array for empty goal', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/', '');
    expect(findMismatchHints(profile, '')).toEqual([]);
  });

  test('finds mismatch hint for NSM profile with on-box menu path', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/', '');
    const hints = findMismatchHints(profile, 'Check System > Licenses');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].onbox).toBeDefined();
    expect(hints[0].target).toBeDefined();
  });

  test('returns empty when goal does not match any mismatch pattern', () => {
    const profile = getPlatformProfile('https://nsm.sonicwall.com/', '');
    const hints = findMismatchHints(profile, 'Check NSM dashboard widgets');
    expect(hints).toEqual([]);
  });

  test('handles profile with undefined mismatchHints gracefully', () => {
    expect(findMismatchHints({ id: 'test' }, 'some goal')).toEqual([]);
  });
});

// ========== Profile property validation ==========

describe('all profiles have required properties', () => {
  const list = listAllProfiles();

  test('every profile has required top-level keys', () => {
    const urlGoalPairs = {
      sonicwall_nsm:        ['https://nsm.sonicwall.com/', ''],
      sonicwall_onbox:      ['https://192.168.1.1/main.html', ''],
      m365_admin:           ['https://admin.microsoft.com/', ''],
      fortigate:            ['https://fortigate.local/ng/', ''],
      itglue:               ['https://abc.itglue.com/', ''],
      aruba:                ['https://central.arubanetworks.com/', ''],
      ambio_viewlinc:       ['https://192.168.100.50/Vaisala/', ''],
      screenconnect:        ['https://company.screenconnect.com/Host#Access', ''],
      ninjarmm:             ['https://app.ninjarmm.com/', ''],
      connectwise_manage:   ['https://na.myconnectwise.net/', ''],
      datto_rmm:            ['https://msp.centrastage.net/', ''],
      cisco:                ['https://dashboard.meraki.com/', ''],
      paloalto:             ['https://paloalto.local/', ''],
      sentinelone:          ['https://usea1.sentinelone.net/', ''],
      nvd:                  ['https://nvd.nist.gov/vuln/search', ''],
      virustotal:           ['https://www.virustotal.com/gui/search', ''],
      huntress:             ['https://partner.huntress.io/', ''],
      network_device:       ['https://192.168.1.250/', 'firewall admin panel'],
    };
    for (const desc of list) {
      const pair = urlGoalPairs[desc.id];
      if (!pair) continue;
      const profile = getPlatformProfile(pair[0], pair[1]);
      expect(typeof profile.id).toBe('string');
      expect(typeof profile.label).toBe('string');
      expect(typeof profile.memoryKeyPrefix).toBe('string');
      expect(typeof profile.detect).toBe('function');
      expect(Array.isArray(profile.pageTypes)).toBe(true);
      expect(typeof profile.knownSelectors).toBe('object');
      // needsTargetSelection is optional — defaults to false/undefined
      if ('needsTargetSelection' in profile) {
        expect(typeof profile.needsTargetSelection).toBe('boolean');
      }
      // rewriteInstructions is optional — can be string, array, or undefined
      if ('rewriteInstructions' in profile) {
        expect(['string', 'object'].includes(typeof profile.rewriteInstructions)).toBe(true);
      }
    }
  });

  test('every pageType has name, urlMatch, and hint', () => {
    const urlGoalPairs = {
      sonicwall_nsm:        ['https://nsm.sonicwall.com/', ''],
      sonicwall_onbox:      ['https://192.168.1.1/main.html', ''],
      m365_admin:           ['https://admin.microsoft.com/', ''],
      fortigate:            ['https://fortigate.local/ng/', ''],
      itglue:               ['https://abc.itglue.com/', ''],
      aruba:                ['https://central.arubanetworks.com/', ''],
      ambio_viewlinc:       ['https://192.168.100.50/Vaisala/', ''],
      screenconnect:        ['https://company.screenconnect.com/Host#Access', ''],
      ninjarmm:             ['https://app.ninjarmm.com/', ''],
      connectwise_manage:   ['https://na.myconnectwise.net/', ''],
      datto_rmm:            ['https://msp.centrastage.net/', ''],
      cisco:                ['https://dashboard.meraki.com/', ''],
      paloalto:             ['https://paloalto.local/', ''],
      sentinelone:          ['https://usea1.sentinelone.net/', ''],
      nvd:                  ['https://nvd.nist.gov/vuln/search', ''],
      virustotal:           ['https://www.virustotal.com/gui/search', ''],
      huntress:             ['https://partner.huntress.io/', ''],
      network_device:       ['https://192.168.1.250/', 'firewall admin panel'],
    };
    for (const desc of list) {
      const pair = urlGoalPairs[desc.id];
      if (!pair) continue;
      const profile = getPlatformProfile(pair[0], pair[1]);
      for (const pt of profile.pageTypes) {
        expect(typeof pt.name).toBe('string');
        expect(pt.name.length).toBeGreaterThan(0);
        expect(pt.urlMatch).toBeInstanceOf(RegExp);
        expect(typeof pt.hint).toBe('string');
        expect(pt.hint.length).toBeGreaterThan(10);
      }
    }
  });
});

// ========== workflowHints shape validation ==========

describe('workflowHints shape validation', () => {
  test('all profiles with workflowHints have valid hint entries', () => {
    const list = listAllProfiles();
    for (const descriptor of list) {
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

// ========== inferSurface (profiles that have it) ==========

describe('inferSurface', () => {
  test('m365_admin inferSurface returns exchange for mail flow goals', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(typeof profile.inferSurface).toBe('function');
    expect(profile.inferSurface('Run a message trace')).toBe('exchange');
  });

  test('m365_admin inferSurface returns entra for sign-in goals', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(profile.inferSurface('Check sign-in log for user')).toBe('entra');
  });

  test('m365_admin inferSurface returns purview for audit goals', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(profile.inferSurface('Search audit log')).toBe('purview');
  });

  test('m365_admin inferSurface returns defender for threat goals', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(profile.inferSurface('Check Defender incident')).toBe('defender');
  });

  test('m365_admin inferSurface returns intune for device config goals', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(profile.inferSurface('Check Intune device config')).toBe('intune');
  });

  test('m365_admin inferSurface returns admin as default', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(profile.inferSurface('Add a new user')).toBe('admin');
  });

  test('cisco inferSurface returns meraki for Meraki goals', () => {
    const profile = getPlatformProfile('https://dashboard.meraki.com/', '');
    if (typeof profile.inferSurface === 'function') {
      expect(profile.inferSurface('Check Meraki switch ports')).toBe('meraki');
    }
  });

  test('cisco inferSurface returns fmc for Firepower goals', () => {
    const profile = getPlatformProfile('https://dashboard.meraki.com/', '');
    if (typeof profile.inferSurface === 'function') {
      expect(profile.inferSurface('Check Firepower FMC policy')).toBe('fmc');
    }
  });
});

// ========== surfaceUrls (profiles that have them) ==========

describe('surfaceUrls', () => {
  test('m365_admin has surfaceUrls for all sub-portals', () => {
    const profile = getPlatformProfile('https://admin.microsoft.com/', '');
    expect(typeof profile.surfaceUrls).toBe('object');
    expect(profile.surfaceUrls.admin).toContain('admin.cloud.microsoft');
    expect(profile.surfaceUrls.entra).toContain('entra.microsoft.com');
    expect(profile.surfaceUrls.exchange).toContain('admin.exchange.microsoft.com');
    expect(profile.surfaceUrls.purview).toContain('purview.microsoft.com');
    expect(profile.surfaceUrls.defender).toContain('security.microsoft.com');
    expect(profile.surfaceUrls.intune).toContain('intune.microsoft.com');
  });
});
