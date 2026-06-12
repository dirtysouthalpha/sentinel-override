// tests/platforms-modules-deep.test.js
// Coverage for 11 previously-untested platform modules

import { jest } from '@jest/globals';

import { networkDevice } from '../background/platforms/network_device.js';
import { cisco } from '../background/platforms/cisco.js';
import { dattoRmm } from '../background/platforms/datto_rmm.js';
import { fortigate } from '../background/platforms/fortigate.js';
import { huntress } from '../background/platforms/huntress.js';
import { m365Admin } from '../background/platforms/m365_admin.js';
import { nvd } from '../background/platforms/nvd.js';
import { paloalto } from '../background/platforms/paloalto.js';
import { sentinelone } from '../background/platforms/sentinelone.js';
import { virustotal } from '../background/platforms/virustotal.js';
import { sonicwallOnbox } from '../background/platforms/sonicwall_onbox.js';

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

const allPlatforms = [
  networkDevice, cisco, dattoRmm, fortigate, huntress, m365Admin,
  nvd, paloalto, sentinelone, virustotal, sonicwallOnbox,
];

describe('all platform modules export required fields', () => {
  test.each(allPlatforms)('$id has required fields', (p) => {
    expect(p.id).toBeDefined();
    expect(typeof p.id).toBe('string');
    expect(p.label).toBeDefined();
    expect(typeof p.label).toBe('string');
    expect(p.memoryKeyPrefix).toBeDefined();
    expect(typeof p.memoryKeyPrefix).toBe('string');
    expect(typeof p.detect).toBe('function');
    expect(Array.isArray(p.pageTypes)).toBe(true);
    expect(typeof p.knownSelectors).toBe('object');
  });
});

// ── network_device ──────────────────────────────────────────────────────────

describe('network_device detect', () => {
  test('detects firewall in goal', () => {
    expect(networkDevice.detect(null, 'Check firewall rules')).toBe(true);
  });

  test('detects router in goal', () => {
    expect(networkDevice.detect(null, 'Configure router interfaces')).toBe(true);
  });

  test('detects switch in goal', () => {
    expect(networkDevice.detect(null, 'Check switch VLANs')).toBe(true);
  });

  test('detects access point in goal', () => {
    expect(networkDevice.detect(null, 'Manage access point settings')).toBe(true);
  });

  test('detects management ui in goal', () => {
    expect(networkDevice.detect(null, 'Open management UI')).toBe(true);
  });

  test('detects admin panel in goal', () => {
    expect(networkDevice.detect(null, 'Login to admin panel')).toBe(true);
  });

  test('detects web ui in goal', () => {
    expect(networkDevice.detect(null, 'Open the web UI')).toBe(true);
  });

  test('returns false for unrelated goal', () => {
    expect(networkDevice.detect(null, 'Check email settings')).toBe(false);
  });

  test('returns false for empty inputs', () => {
    expect(networkDevice.detect(null, '')).toBe(false);
    expect(networkDevice.detect(null, null)).toBe(false);
  });

  test('ignores URL — goal-text only detection', () => {
    expect(networkDevice.detect('https://example.com', null)).toBe(false);
  });
});

// ── cisco ───────────────────────────────────────────────────────────────────

describe('cisco detect', () => {
  test('detects cisco.com hostname', () => {
    expect(cisco.detect('https://manage.cisco.com', '')).toBe(true);
  });

  test('detects meraki.com hostname', () => {
    expect(cisco.detect('https://dashboard.meraki.com', '')).toBe(true);
  });

  test('detects /asdm path', () => {
    expect(cisco.detect('https://192.168.1.1/asdm', '')).toBe(true);
  });

  test('detects /fmc path', () => {
    expect(cisco.detect('https://192.168.1.1/fmc', '')).toBe(true);
  });

  test('detects .ise. in hostname', () => {
    expect(cisco.detect('https://my.ise.local', '')).toBe(true);
  });

  test('detects goal text: cisco asa', () => {
    expect(cisco.detect(null, 'Configure cisco asa firewall')).toBe(true);
  });

  test('detects goal text: firepower', () => {
    expect(cisco.detect(null, 'Check firepower rules')).toBe(true);
  });

  test('detects goal text: meraki', () => {
    expect(cisco.detect(null, 'View meraki dashboard')).toBe(true);
  });

  test('detects goal text: cisco ise', () => {
    expect(cisco.detect(null, 'Manage cisco ise policies')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(cisco.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(cisco.detect('not-a-url', '')).toBe(false);
  });
});

describe('cisco inferSurface', () => {
  test('infers meraki from goal text', () => {
    expect(cisco.inferSurface('Check meraki dashboard')).toBe('meraki');
  });

  test('infers fmc from firepower goal', () => {
    expect(cisco.inferSurface('View firepower management center')).toBe('fmc');
  });

  test('infers ise from ise goal', () => {
    expect(cisco.inferSurface('Configure identity services engine')).toBe('ise');
  });

  test('infers asdm from asa goal', () => {
    expect(cisco.inferSurface('Open asdm for cisco asa')).toBe('asdm');
  });

  test('defaults to fmc', () => {
    expect(cisco.inferSurface('something else')).toBe('fmc');
  });

  test('null goal fires goal||"" fallback and defaults to fmc', () => {
    expect(cisco.inferSurface(null)).toBe('fmc');
  });

  test('undefined goal fires goal||"" fallback and defaults to fmc', () => {
    expect(cisco.inferSurface(undefined)).toBe('fmc');
  });
});

// ── datto_rmm ───────────────────────────────────────────────────────────────

describe('datto_rmm detect', () => {
  test('detects centrastage.net hostname', () => {
    expect(dattoRmm.detect('https://company.centrastage.net', '')).toBe(true);
  });

  test('detects dattormm.com hostname', () => {
    expect(dattoRmm.detect('https://app.dattormm.com', '')).toBe(true);
  });

  test('detects autotask.net hostname', () => {
    expect(dattoRmm.detect('https://company.autotask.net', '')).toBe(true);
  });

  test('detects goal text: datto rmm', () => {
    expect(dattoRmm.detect(null, 'Open datto rmm')).toBe(true);
  });

  test('detects goal text: autotask', () => {
    expect(dattoRmm.detect(null, 'Check autotask tickets')).toBe(true);
  });

  test('detects goal text: centrastage', () => {
    expect(dattoRmm.detect(null, 'Login to centrastage')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(dattoRmm.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(dattoRmm.detect('not-a-url', '')).toBe(false);
  });
});

// ── fortigate ───────────────────────────────────────────────────────────────

describe('fortigate detect', () => {
  test('detects fortinet hostname', () => {
    expect(fortigate.detect('https://fortinet.example.com', '')).toBe(true);
  });

  test('detects fortigate hostname', () => {
    expect(fortigate.detect('https://fortigate.example.com', '')).toBe(true);
  });

  test('detects fortimanager hostname', () => {
    expect(fortigate.detect('https://fortimanager.example.com', '')).toBe(true);
  });

  test('detects /ng/ path on IP', () => {
    expect(fortigate.detect('https://192.168.1.1/ng/dashboard', '')).toBe(true);
  });

  test('detects /p/login path on IP', () => {
    expect(fortigate.detect('https://10.0.0.1/p/login', '')).toBe(true);
  });

  test('detects goal text: fortigate', () => {
    expect(fortigate.detect(null, 'Check fortigate policies')).toBe(true);
  });

  test('detects goal text: fortimanager', () => {
    expect(fortigate.detect(null, 'Push config via fortimanager')).toBe(true);
  });

  test('detects goal text: fortiweb', () => {
    expect(fortigate.detect(null, 'Configure fortiweb')).toBe(true);
  });

  test('detects goal text: fortianalyzer', () => {
    expect(fortigate.detect(null, 'Check fortianalyzer logs')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(fortigate.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(fortigate.detect('not-a-url', '')).toBe(false);
  });
});

// ── huntress ────────────────────────────────────────────────────────────────

describe('huntress detect', () => {
  test('detects huntress hostname', () => {
    expect(huntress.detect('https://company.huntress.io', '')).toBe(true);
  });

  test('detects goal text: huntress', () => {
    expect(huntress.detect(null, 'Check huntress alerts')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(huntress.detect(null, '')).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(huntress.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(huntress.detect('not-a-url', '')).toBe(false);
  });
});

// ── m365_admin ──────────────────────────────────────────────────────────────

describe('m365_admin detect', () => {
  test('detects admin.microsoft.com', () => {
    expect(m365Admin.detect('https://admin.microsoft.com', '')).toBe(true);
  });

  test('detects entra.microsoft.com', () => {
    expect(m365Admin.detect('https://entra.microsoft.com', '')).toBe(true);
  });

  test('detects portal.azure.com', () => {
    expect(m365Admin.detect('https://portal.azure.com', '')).toBe(true);
  });

  test('detects security.microsoft.com', () => {
    expect(m365Admin.detect('https://security.microsoft.com', '')).toBe(true);
  });

  test('detects intune.microsoft.com', () => {
    expect(m365Admin.detect('https://intune.microsoft.com', '')).toBe(true);
  });

  test('detects admin.exchange.microsoft.com', () => {
    expect(m365Admin.detect('https://admin.exchange.microsoft.com', '')).toBe(true);
  });

  test('detects login.microsoftonline.com', () => {
    expect(m365Admin.detect('https://login.microsoftonline.com', '')).toBe(true);
  });

  test('detects goal text: m365', () => {
    expect(m365Admin.detect(null, 'Check m365 licenses')).toBe(true);
  });

  test('detects goal text: entra', () => {
    expect(m365Admin.detect(null, 'Check entra sign-in logs')).toBe(true);
  });

  test('detects goal text: intune', () => {
    expect(m365Admin.detect(null, 'Manage intune devices')).toBe(true);
  });

  test('detects goal text: purview', () => {
    expect(m365Admin.detect(null, 'Search purview audit logs')).toBe(true);
  });

  test('detects goal text: defender', () => {
    expect(m365Admin.detect(null, 'Check defender alerts')).toBe(true);
  });

  test('detects goal text: exchange admin', () => {
    expect(m365Admin.detect(null, 'Open exchange admin center')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(m365Admin.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(m365Admin.detect('not-a-url', '')).toBe(false);
  });
});

describe('m365_admin inferSurface', () => {
  test('infers exchange from message trace', () => {
    expect(m365Admin.inferSurface('run a message trace')).toBe('exchange');
  });

  test('infers exchange from shared mailbox', () => {
    expect(m365Admin.inferSurface('create shared mailbox')).toBe('exchange');
  });

  test('infers entra from sign-in log', () => {
    expect(m365Admin.inferSurface('check sign-in logs')).toBe('entra');
  });

  test('infers entra from conditional access', () => {
    expect(m365Admin.inferSurface('review conditional access policies')).toBe('entra');
  });

  test('infers purview from audit log', () => {
    expect(m365Admin.inferSurface('search audit log')).toBe('purview');
  });

  test('infers purview from ediscovery', () => {
    expect(m365Admin.inferSurface('run ediscovery search')).toBe('purview');
  });

  test('infers defender from threat hunt', () => {
    expect(m365Admin.inferSurface('threat hunting in defender')).toBe('defender');
  });

  test('infers defender from secure score', () => {
    expect(m365Admin.inferSurface('check secure score')).toBe('defender');
  });

  test('infers intune from device config', () => {
    expect(m365Admin.inferSurface('check device configuration')).toBe('intune');
  });

  test('defaults to admin', () => {
    expect(m365Admin.inferSurface('something else')).toBe('admin');
  });

  test('null goal fires goal||"" fallback and defaults to admin', () => {
    expect(m365Admin.inferSurface(null)).toBe('admin');
  });

  test('undefined goal fires goal||"" fallback and defaults to admin', () => {
    expect(m365Admin.inferSurface(undefined)).toBe('admin');
  });
});

// ── nvd ─────────────────────────────────────────────────────────────────────

describe('nvd detect', () => {
  test('detects nvd.nist.gov', () => {
    expect(nvd.detect('https://nvd.nist.gov/vuln/search', '')).toBe(true);
  });

  test('detects cve.mitre.org', () => {
    expect(nvd.detect('https://cve.mitre.org', '')).toBe(true);
  });

  test('detects cve.org', () => {
    expect(nvd.detect('https://cve.org', '')).toBe(true);
  });

  test('detects goal text: nvd', () => {
    expect(nvd.detect(null, 'Search nvd for CVEs')).toBe(true);
  });

  test('detects goal text: cve database', () => {
    expect(nvd.detect(null, 'Query cve database')).toBe(true);
  });

  test('detects goal text: cve search', () => {
    expect(nvd.detect(null, 'Run cve search for vendor')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(nvd.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(nvd.detect('not-a-url', '')).toBe(false);
  });
});

// ── paloalto ────────────────────────────────────────────────────────────────

describe('paloalto detect', () => {
  test('detects paloalto hostname', () => {
    expect(paloalto.detect('https://paloalto.example.com', '')).toBe(true);
  });

  test('detects panorama hostname', () => {
    expect(paloalto.detect('https://panorama.example.com', '')).toBe(true);
  });

  test('detects /php/rest/pan path', () => {
    expect(paloalto.detect('https://10.0.0.1/php/rest/pan/config', '')).toBe(true);
  });

  test('detects goal text: palo alto', () => {
    expect(paloalto.detect(null, 'Configure palo alto firewall')).toBe(true);
  });

  test('detects goal text: pan-os', () => {
    expect(paloalto.detect(null, 'Check pan-os policies')).toBe(true);
  });

  test('detects goal text: panorama', () => {
    expect(paloalto.detect(null, 'Push config via panorama')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(paloalto.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(paloalto.detect('not-a-url', '')).toBe(false);
  });
});

// ── sentinelone ─────────────────────────────────────────────────────────────

describe('sentinelone detect', () => {
  test('detects sentinelone.net', () => {
    expect(sentinelone.detect('https://company.sentinelone.net', '')).toBe(true);
  });

  test('detects .sentinelone.com', () => {
    expect(sentinelone.detect('https://usea1.sentinelone.com', '')).toBe(true);
  });

  test('detects goal text: sentinelone', () => {
    expect(sentinelone.detect(null, 'Check sentinelone console')).toBe(true);
  });

  test('detects goal text: singularity', () => {
    expect(sentinelone.detect(null, 'Open singularity platform')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(sentinelone.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(sentinelone.detect('not-a-url', '')).toBe(false);
  });
});

// ── virustotal ──────────────────────────────────────────────────────────────

describe('virustotal detect', () => {
  test('detects virustotal.com', () => {
    expect(virustotal.detect('https://www.virustotal.com/gui/file/abc', '')).toBe(true);
  });

  test('detects goal text: virustotal', () => {
    expect(virustotal.detect(null, 'Check virustotal for hash')).toBe(true);
  });

  test('detects goal text: vt api', () => {
    expect(virustotal.detect(null, 'Query vt api for hash')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(virustotal.detect(null, '')).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(virustotal.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(virustotal.detect('not-a-url', '')).toBe(false);
  });
});

// ── sonicwall_onbox ─────────────────────────────────────────────────────────

describe('sonicwall_onbox detect', () => {
  test('detects /sonicui/ path', () => {
    expect(sonicwallOnbox.detect('https://192.168.1.1/sonicui/7x/dashboard', '')).toBe(true);
  });

  test('detects /main.html path', () => {
    expect(sonicwallOnbox.detect('https://192.168.168.168/main.html', '')).toBe(true);
  });

  test('detects /auth.html path', () => {
    expect(sonicwallOnbox.detect('https://192.168.168.168/auth.html', '')).toBe(true);
  });

  test('detects IP with /dashboard path', () => {
    expect(sonicwallOnbox.detect('https://10.0.0.1/dashboard', '')).toBe(true);
  });

  test('detects IP with /policy path', () => {
    expect(sonicwallOnbox.detect('https://10.0.0.1/policy', '')).toBe(true);
  });

  test('does not detect /fmc on IP host (Cisco FMC)', () => {
    expect(sonicwallOnbox.detect('https://10.0.0.1/fmc', '')).toBe(false);
  });

  test('does not detect /asdm on IP host (Cisco ASDM)', () => {
    expect(sonicwallOnbox.detect('https://10.0.0.1/asdm', '')).toBe(false);
  });

  test('excludes NSM hosts', () => {
    expect(sonicwallOnbox.detect('https://nsm.sonicwall.com', '')).toBe(false);
  });

  test('excludes cloud.sonicwall.com', () => {
    expect(sonicwallOnbox.detect('https://cloud.sonicwall.com', '')).toBe(false);
  });

  test('detects goal text: sonicwall', () => {
    expect(sonicwallOnbox.detect(null, 'Check sonicwall firewall')).toBe(true);
  });

  test('detects goal text: sonicos', () => {
    expect(sonicwallOnbox.detect(null, 'Login to sonicos')).toBe(true);
  });

  test('detects goal text: tz model', () => {
    expect(sonicwallOnbox.detect(null, 'Configure tz350')).toBe(true);
  });

  test('detects goal text: nsa model', () => {
    expect(sonicwallOnbox.detect(null, 'Check nsa270')).toBe(true);
  });

  test('detects goal text: soho', () => {
    expect(sonicwallOnbox.detect(null, 'Setup soho firewall')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(sonicwallOnbox.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(sonicwallOnbox.detect('not-a-url', '')).toBe(false);
  });
});

afterAll(() => {
  warnSpy.mockRestore();
});
