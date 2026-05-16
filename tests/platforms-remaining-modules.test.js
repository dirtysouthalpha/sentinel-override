// tests/platforms-remaining-modules.test.js
// Coverage for 6 platform modules not covered by platforms-modules-deep.test.js:
//   ambio_viewlinc, aruba, connectwise_manage, itglue, ninjarmm, screenconnect, sonicwall_nsm

import { jest } from '@jest/globals';

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

const { ambioViewlinc } = await import('../background/platforms/ambio_viewlinc.js');
const { aruba } = await import('../background/platforms/aruba.js');
const { connectwiseManage } = await import('../background/platforms/connectwise_manage.js');
const { itglue } = await import('../background/platforms/itglue.js');
const { ninjarmm } = await import('../background/platforms/ninjarmm.js');
const { screenconnect } = await import('../background/platforms/screenconnect.js');
const { sonicwallNsm } = await import('../background/platforms/sonicwall_nsm.js');

const allPlatforms = [
  ambioViewlinc, aruba, connectwiseManage, itglue, ninjarmm, screenconnect, sonicwallNsm,
];

describe('all remaining platform modules export required fields', () => {
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

// ── ambio_viewlinc ─────────────────────────────────────────────────────────

describe('ambio_viewlinc detect', () => {
  test('detects viewlinc hostname', () => {
    expect(ambioViewlinc.detect('https://viewlinc.internal.local', '')).toBe(true);
  });

  test('detects subdomain viewlinc hostname', () => {
    expect(ambioViewlinc.detect('https://my.viewlinc.corp', '')).toBe(true);
  });

  test('detects 192.168.100.x IP', () => {
    expect(ambioViewlinc.detect('https://192.168.100.10', '')).toBe(true);
    expect(ambioViewlinc.detect('https://192.168.100.254', '')).toBe(true);
  });

  test('does not detect other 192.168.x.x IPs', () => {
    expect(ambioViewlinc.detect('https://192.168.1.1', '')).toBe(false);
  });

  test('detects goal text: viewlinc', () => {
    expect(ambioViewlinc.detect(null, 'Check viewlinc readings')).toBe(true);
  });

  test('detects goal text: ambio', () => {
    expect(ambioViewlinc.detect(null, 'Open ambio dashboard')).toBe(true);
  });

  test('detects OQ + threshold pattern', () => {
    expect(ambioViewlinc.detect(null, 'Run OQ-9 threshold test on chamber')).toBe(true);
  });

  test('detects IQ + rfl100 pattern', () => {
    expect(ambioViewlinc.detect(null, 'Perform IQ-3 rfl100 verification')).toBe(true);
  });

  test('detects PQ + stability pattern', () => {
    expect(ambioViewlinc.detect(null, 'Complete PQ-2 stability monitoring')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(ambioViewlinc.detect(null, '')).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(ambioViewlinc.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(ambioViewlinc.detect('not-a-url', '')).toBe(false);
  });
});

describe('ambio_viewlinc structure', () => {
  test('has needsTargetSelection', () => {
    expect(ambioViewlinc.needsTargetSelection).toBe(true);
  });

  test('has pageTypes with hints', () => {
    expect(ambioViewlinc.pageTypes.length).toBeGreaterThan(0);
    for (const pt of ambioViewlinc.pageTypes) {
      expect(pt.name).toBeDefined();
      expect(pt.hint).toBeDefined();
    }
  });

  test('has knownSelectors', () => {
    expect(Object.keys(ambioViewlinc.knownSelectors).length).toBeGreaterThan(10);
  });

  test('has waitStrings', () => {
    expect(typeof ambioViewlinc.waitStrings).toBe('object');
  });

  test('has knownGotchas array', () => {
    expect(Array.isArray(ambioViewlinc.knownGotchas)).toBe(true);
    expect(ambioViewlinc.knownGotchas.length).toBeGreaterThan(0);
  });

  test('has mismatchHints', () => {
    expect(Array.isArray(ambioViewlinc.mismatchHints)).toBe(true);
  });

  test('has rewriteInstructions', () => {
    expect(Array.isArray(ambioViewlinc.rewriteInstructions)).toBe(true);
  });

  test('has workflowHints', () => {
    expect(Array.isArray(ambioViewlinc.workflowHints)).toBe(true);
    expect(ambioViewlinc.workflowHints.length).toBeGreaterThan(0);
  });
});

// ── aruba ──────────────────────────────────────────────────────────────────

describe('aruba detect', () => {
  test('detects central.arubanetworks.com', () => {
    expect(aruba.detect('https://central.arubanetworks.com', '')).toBe(true);
  });

  test('detects portal.central.arubanetworks.com', () => {
    expect(aruba.detect('https://portal.central.arubanetworks.com', '')).toBe(true);
  });

  test('detects aruba in hostname', () => {
    expect(aruba.detect('https://aruba-controller.local', '')).toBe(true);
  });

  test('detects Aruba Instant on IP with /p/login path', () => {
    expect(aruba.detect('https://192.168.1.1/p/login', '')).toBe(true);
  });

  test('detects Aruba Instant on IP with /aruba path', () => {
    expect(aruba.detect('https://10.0.0.1/aruba', '')).toBe(true);
  });

  test('detects Aruba Instant on IP with /swarm.html path', () => {
    expect(aruba.detect('https://10.0.0.1/swarm.html', '')).toBe(true);
  });

  test('detects Aruba Instant on IP with /monitoring path', () => {
    expect(aruba.detect('https://10.0.0.1/monitoring', '')).toBe(true);
  });

  test('detects Aruba Instant on IP with /configuration path', () => {
    expect(aruba.detect('https://10.0.0.1/configuration', '')).toBe(true);
  });

  test('does not detect IP without Aruba paths', () => {
    expect(aruba.detect('https://10.0.0.1/dashboard', '')).toBe(false);
  });

  test('detects goal text: aruba', () => {
    expect(aruba.detect(null, 'Check aruba access points')).toBe(true);
  });

  test('detects goal text: arubaos', () => {
    expect(aruba.detect(null, 'Configure arubaos switch')).toBe(true);
  });

  test('detects goal text: aruba central', () => {
    expect(aruba.detect(null, 'Open aruba central dashboard')).toBe(true);
  });

  test('detects goal text: aruba instant', () => {
    expect(aruba.detect(null, 'Manage aruba instant APs')).toBe(true);
  });

  test('detects goal text: aos-cx', () => {
    expect(aruba.detect(null, 'Check aos-cx switch')).toBe(true);
  });

  test('detects goal text: hpe aruba', () => {
    expect(aruba.detect(null, 'Configure hpe aruba switch')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(aruba.detect(null, '')).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(aruba.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(aruba.detect('not-a-url', '')).toBe(false);
  });
});

describe('aruba structure', () => {
  test('has needsTargetSelection', () => {
    expect(aruba.needsTargetSelection).toBe(true);
  });

  test('has preflightInstructions', () => {
    expect(typeof aruba.preflightInstructions).toBe('string');
    expect(aruba.preflightInstructions.length).toBeGreaterThan(0);
  });

  test('has workflowHints', () => {
    expect(Array.isArray(aruba.workflowHints)).toBe(true);
    expect(aruba.workflowHints.length).toBeGreaterThan(0);
  });

  test('has rewriteInstructions', () => {
    expect(typeof aruba.rewriteInstructions).toBe('string');
  });

  test('has liveDataCaveats', () => {
    expect(typeof aruba.liveDataCaveats).toBe('string');
  });
});

// ── connectwise_manage ─────────────────────────────────────────────────────

describe('connectwise_manage detect', () => {
  test('detects my.connectwise.com', () => {
    expect(connectwiseManage.detect('https://my.connectwise.com', '')).toBe(true);
  });

  test('detects connectwise.net hostname', () => {
    expect(connectwiseManage.detect('https://company.connectwise.net', '')).toBe(true);
  });

  test('detects cw.local hostname', () => {
    expect(connectwiseManage.detect('https://cw.local', '')).toBe(true);
  });

  test('detects cw.manage in hostname', () => {
    expect(connectwiseManage.detect('https://cw.manage.internal', '')).toBe(true);
  });

  test('detects /v4_6_release Rails API path', () => {
    expect(connectwiseManage.detect('https://example.com/v4_6_release/services/system_io/router/api.rails', '')).toBe(true);
  });

  test('detects goal text: connectwise manage', () => {
    expect(connectwiseManage.detect(null, 'Open connectwise manage')).toBe(true);
  });

  test('detects goal text: cw manage', () => {
    expect(connectwiseManage.detect(null, 'Check cw manage tickets')).toBe(true);
  });

  test('detects goal text: cwmanage', () => {
    expect(connectwiseManage.detect(null, 'Login to cwmanage')).toBe(true);
  });

  test('detects goal text: connectwise psa', () => {
    expect(connectwiseManage.detect(null, 'Open connectwise psa')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(connectwiseManage.detect(null, '')).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(connectwiseManage.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(connectwiseManage.detect('not-a-url', '')).toBe(false);
  });
});

describe('connectwise_manage structure', () => {
  test('has pageTypes with hints', () => {
    expect(connectwiseManage.pageTypes.length).toBeGreaterThan(0);
    for (const pt of connectwiseManage.pageTypes) {
      expect(pt.name).toBeDefined();
      expect(pt.hint).toBeDefined();
    }
  });

  test('has knownSelectors with ticket elements', () => {
    expect(connectwiseManage.knownSelectors.ticketGrid).toBeDefined();
    expect(connectwiseManage.knownSelectors.ticketSaveBtn).toBeDefined();
  });

  test('has waitStrings', () => {
    expect(typeof connectwiseManage.waitStrings).toBe('object');
    expect(connectwiseManage.waitStrings.pageReady).toBeDefined();
  });

  test('has knownGotchas array', () => {
    expect(Array.isArray(connectwiseManage.knownGotchas)).toBe(true);
    expect(connectwiseManage.knownGotchas.length).toBeGreaterThan(0);
  });

  test('has mismatchHints', () => {
    expect(Array.isArray(connectwiseManage.mismatchHints)).toBe(true);
  });

  test('has workflowHints', () => {
    expect(Array.isArray(connectwiseManage.workflowHints)).toBe(true);
    expect(connectwiseManage.workflowHints.length).toBeGreaterThan(0);
  });
});

// ── itglue ─────────────────────────────────────────────────────────────────

describe('itglue detect', () => {
  test('detects itglue.com', () => {
    expect(itglue.detect('https://company.itglue.com', '')).toBe(true);
  });

  test('detects partner.itglue.com', () => {
    expect(itglue.detect('https://partner.itglue.com', '')).toBe(true);
  });

  test('detects goal text: it glue', () => {
    expect(itglue.detect(null, 'Open it glue documentation')).toBe(true);
  });

  test('detects goal text: itglue (no space)', () => {
    expect(itglue.detect(null, 'Login to itglue')).toBe(true);
  });

  test('detects goal text: IT Glue (case insensitive)', () => {
    expect(itglue.detect(null, 'Search IT Glue for config')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(itglue.detect(null, '')).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(itglue.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(itglue.detect('not-a-url', '')).toBe(false);
  });
});

describe('itglue structure', () => {
  test('has needsTargetSelection', () => {
    expect(itglue.needsTargetSelection).toBe(true);
  });

  test('has preflightInstructions', () => {
    expect(typeof itglue.preflightInstructions).toBe('string');
    expect(itglue.preflightInstructions.length).toBeGreaterThan(0);
  });

  test('has pageTypes for key surfaces', () => {
    const names = itglue.pageTypes.map(pt => pt.name);
    expect(names).toContain('itglue-configurations');
    expect(names).toContain('itglue-passwords');
    expect(names).toContain('itglue-documents');
    expect(names).toContain('itglue-domains');
    expect(names).toContain('itglue-ssl-certs');
  });

  test('has knownSelectors for password-sensitive elements', () => {
    expect(itglue.knownSelectors.passwordRevealButton).toBeDefined();
    expect(itglue.knownSelectors.passwordCopyButton).toBeDefined();
  });

  test('has waitStrings', () => {
    expect(typeof itglue.waitStrings).toBe('object');
  });

  test('has knownGotchas mentioning password safety', () => {
    const gotchas = Array.isArray(itglue.knownGotchas)
      ? itglue.knownGotchas.join(' ')
      : String(itglue.knownGotchas);
    expect(gotchas).toMatch(/password/i);
    expect(gotchas).toMatch(/never/i);
  });

  test('has rewriteInstructions', () => {
    expect(typeof itglue.rewriteInstructions).toBe('string');
    expect(itglue.rewriteInstructions).toMatch(/password/i);
  });

  test('has workflowHints', () => {
    expect(Array.isArray(itglue.workflowHints)).toBe(true);
    expect(itglue.workflowHints.length).toBeGreaterThan(0);
  });
});

// ── ninjarmm ───────────────────────────────────────────────────────────────

describe('ninjarmm detect', () => {
  test('detects ninjarmm.com', () => {
    expect(ninjarmm.detect('https://app.ninjarmm.com', '')).toBe(true);
  });

  test('detects ninjarmm.io', () => {
    expect(ninjarmm.detect('https://company.ninjarmm.io', '')).toBe(true);
  });

  test('detects app.ninjarmm hostname', () => {
    expect(ninjarmm.detect('https://app.ninjarmm.com/#devicesDashboard', '')).toBe(true);
  });

  test('detects ninjarmm in hostname', () => {
    expect(ninjarmm.detect('https://ninjarmm.internal.local', '')).toBe(true);
  });

  test('detects goal text: ninjarmm', () => {
    expect(ninjarmm.detect(null, 'Open ninjarmm')).toBe(true);
  });

  test('detects goal text: ninjaone', () => {
    expect(ninjarmm.detect(null, 'Check ninjaone alerts')).toBe(true);
  });

  test('detects goal text: ninja rmm', () => {
    expect(ninjarmm.detect(null, 'Login to ninja rmm')).toBe(true);
  });

  test('detects goal text: ninja-rmm', () => {
    expect(ninjarmm.detect(null, 'Check ninja-rmm devices')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(ninjarmm.detect(null, '')).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(ninjarmm.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(ninjarmm.detect('not-a-url', '')).toBe(false);
  });
});

describe('ninjarmm structure', () => {
  test('has commandInterface', () => {
    expect(typeof ninjarmm.commandInterface).toBe('object');
    expect(ninjarmm.commandInterface.inputSelector).toBeDefined();
    expect(ninjarmm.commandInterface.submitSelector).toBeDefined();
    expect(ninjarmm.commandInterface.outputSelector).toBeDefined();
  });

  test('commandInterface has commandTypes', () => {
    expect(typeof ninjarmm.commandInterface.commandTypes).toBe('object');
    expect(ninjarmm.commandInterface.commandTypes.powershell).toBeDefined();
  });

  test('has workflowHints', () => {
    expect(Array.isArray(ninjarmm.workflowHints)).toBe(true);
    expect(ninjarmm.workflowHints.length).toBeGreaterThan(0);
  });

  test('has waitStrings', () => {
    expect(typeof ninjarmm.waitStrings).toBe('object');
    expect(ninjarmm.waitStrings.commandComplete).toBeDefined();
  });
});

// ── screenconnect ──────────────────────────────────────────────────────────

describe('screenconnect detect', () => {
  test('detects screenconnect.com', () => {
    expect(screenconnect.detect('https://company.screenconnect.com', '')).toBe(true);
  });

  test('detects connectwisecontrol.com', () => {
    expect(screenconnect.detect('https://company.connectwisecontrol.com', '')).toBe(true);
  });

  test('detects /Host#Access path', () => {
    expect(screenconnect.detect('https://example.com/Host#Access', '')).toBe(true);
  });

  test('detects /Host#Support path', () => {
    expect(screenconnect.detect('https://example.com/Host#Support', '')).toBe(true);
  });

  test('detects /Backstage path', () => {
    expect(screenconnect.detect('https://example.com/Backstage', '')).toBe(true);
  });

  test('detects /Host#Join path', () => {
    expect(screenconnect.detect('https://example.com/Host#Join', '')).toBe(true);
  });

  test('detects goal text: screenconnect via fallback regex', () => {
    expect(screenconnect.detect('https://example.com', 'Open screenconnect')).toBe(true);
  });

  test('detects goal text: control.connectwise via fallback regex', () => {
    expect(screenconnect.detect('https://example.com', 'Open control.connectwise')).toBe(true);
  });

  test('detects goal text: sc.local via fallback regex', () => {
    expect(screenconnect.detect('https://example.com', 'Connect to sc.local')).toBe(true);
  });

  test('detects goal text: schost via fallback regex', () => {
    expect(screenconnect.detect('https://example.com', 'Open schost session')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(screenconnect.detect(null, '')).toBe(false);
  });

  test('returns false for null URL period', () => {
    expect(screenconnect.detect(null, null)).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(screenconnect.detect('https://example.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(screenconnect.detect('not-a-url', '')).toBe(false);
  });
});

describe('screenconnect structure', () => {
  test('has commandInterface', () => {
    expect(typeof screenconnect.commandInterface).toBe('object');
    expect(screenconnect.commandInterface.inputSelector).toBeDefined();
    expect(screenconnect.commandInterface.outputTimeoutMs).toBe(15000);
  });

  test('has workflowHints', () => {
    expect(Array.isArray(screenconnect.workflowHints)).toBe(true);
    expect(screenconnect.workflowHints.length).toBeGreaterThan(0);
  });

  test('has pageTypes', () => {
    expect(screenconnect.pageTypes.length).toBeGreaterThan(0);
  });
});

// ── sonicwall_nsm ──────────────────────────────────────────────────────────

describe('sonicwall_nsm detect', () => {
  test('detects nsm.sonicwall.com', () => {
    expect(sonicwallNsm.detect('https://nsm.sonicwall.com', '')).toBe(true);
  });

  test('detects subdomain nsm host', () => {
    expect(sonicwallNsm.detect('https://nsm-us-1.sonicwall.com', '')).toBe(true);
  });

  test('detects cloud.sonicwall.com', () => {
    expect(sonicwallNsm.detect('https://cloud.sonicwall.com', '')).toBe(true);
  });

  test('detects goal text: sonicwall nsm via fallback regex', () => {
    expect(sonicwallNsm.detect('https://example.com', 'Open sonicwall nsm')).toBe(true);
  });

  test('detects goal text: network security manager via fallback regex', () => {
    expect(sonicwallNsm.detect('https://example.com', 'Check network security manager')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(sonicwallNsm.detect(null, '')).toBe(false);
  });

  test('returns false for null URL period', () => {
    expect(sonicwallNsm.detect(null, null)).toBe(false);
  });

  test('returns false for unrelated URL', () => {
    expect(sonicwallNsm.detect('https://example.com', '')).toBe(false);
  });

  test('does not match sonicwall.com without NSM subdomain', () => {
    expect(sonicwallNsm.detect('https://www.sonicwall.com', '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(sonicwallNsm.detect('not-a-url', '')).toBe(false);
  });
});

describe('sonicwall_nsm structure', () => {
  test('has needsTargetSelection', () => {
    expect(sonicwallNsm.needsTargetSelection).toBe(true);
  });

  test('has preflightInstructions', () => {
    expect(typeof sonicwallNsm.preflightInstructions).toBe('string');
    expect(sonicwallNsm.preflightInstructions.length).toBeGreaterThan(0);
  });

  test('has mismatchHints with on-box to NSM mappings', () => {
    expect(Array.isArray(sonicwallNsm.mismatchHints)).toBe(true);
    expect(sonicwallNsm.mismatchHints.length).toBeGreaterThan(5);
    for (const hint of sonicwallNsm.mismatchHints) {
      expect(hint.pattern).toBeDefined();
      expect(hint.onbox).toBeDefined();
      expect(hint.nsm).toBeDefined();
    }
  });

  test('has pageTypes', () => {
    expect(sonicwallNsm.pageTypes.length).toBeGreaterThan(0);
    const names = sonicwallNsm.pageTypes.map(pt => pt.name);
    expect(names).toContain('firewall-list');
    expect(names).toContain('device-console');
  });

  test('has waitStrings', () => {
    expect(typeof sonicwallNsm.waitStrings).toBe('object');
    expect(sonicwallNsm.waitStrings.saveSucceeded).toBeDefined();
  });

  test('has knownGotchas', () => {
    expect(typeof sonicwallNsm.knownGotchas).toBe('string');
    expect(sonicwallNsm.knownGotchas.length).toBeGreaterThan(0);
  });

  test('has rewriteInstructions', () => {
    expect(typeof sonicwallNsm.rewriteInstructions).toBe('string');
  });

  test('has workflowHints', () => {
    expect(Array.isArray(sonicwallNsm.workflowHints)).toBe(true);
    expect(sonicwallNsm.workflowHints.length).toBeGreaterThan(0);
  });

  test('has liveDataCaveats', () => {
    expect(typeof sonicwallNsm.liveDataCaveats).toBe('string');
  });
});

afterAll(() => {
  warnSpy.mockRestore();
});
