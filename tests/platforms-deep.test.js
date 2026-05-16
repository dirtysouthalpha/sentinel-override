// tests/platforms-deep.test.js
// Additional coverage for platform modules with uncovered lines

import { jest } from '@jest/globals';

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

const {
  getPlatformProfile,
  listAllProfiles,
} = await import('../background/platforms/index.js');

const { ambioViewlinc } = await import('../background/platforms/ambio_viewlinc.js');
const { connectwiseManage } = await import('../background/platforms/connectwise_manage.js');
const { sonicwallNsm } = await import('../background/platforms/sonicwall_nsm.js');
const { itglue } = await import('../background/platforms/itglue.js');
const { ninjarmm } = await import('../background/platforms/ninjarmm.js');
const { aruba } = await import('../background/platforms/aruba.js');

describe('ambio_viewlinc detect', () => {
  test('detects by viewlinc hostname', () => {
    expect(ambioViewlinc.detect('https://viewlinc.example.com', '')).toBe(true);
  });

  test('detects by internal IP', () => {
    expect(ambioViewlinc.detect('https://192.168.100.50', '')).toBe(true);
  });

  test('detects by goal text mentioning viewlinc', () => {
    expect(ambioViewlinc.detect(null, 'Check viewlinc thresholds')).toBe(true);
  });

  test('detects by goal text mentioning ambio', () => {
    expect(ambioViewlinc.detect(null, 'Configure ambio monitoring')).toBe(true);
  });

  test('detects OQ test pattern with threshold keyword', () => {
    expect(ambioViewlinc.detect(null, 'Run OQ-3 threshold test on chamber')).toBe(true);
  });

  test('detects IQ pattern with stability keyword', () => {
    expect(ambioViewlinc.detect(null, 'Complete IQ-2 stability test')).toBe(true);
  });

  test('returns false for unrelated URL and goal', () => {
    expect(ambioViewlinc.detect('https://example.com', 'Check firewall')).toBe(false);
  });

  test('handles null URL gracefully', () => {
    expect(ambioViewlinc.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(ambioViewlinc.detect('not-a-url', '')).toBe(false);
  });
});

describe('connectwise_manage detect', () => {
  test('detects my.connectwise.com', () => {
    expect(connectwiseManage.detect('https://my.connectwise.com', '')).toBe(true);
  });

  test('detects connectwise.net hostname', () => {
    expect(connectwiseManage.detect('https://host.connectwise.net', '')).toBe(true);
  });

  test('detects cw.local hostname', () => {
    expect(connectwiseManage.detect('https://cw.local', '')).toBe(true);
  });

  test('detects cw.manage hostname', () => {
    expect(connectwiseManage.detect('https://cw.manage.example.com', '')).toBe(true);
  });

  test('detects by API rails path', () => {
    expect(connectwiseManage.detect('https://example.com/v4_6_release/services/system_io/router/api.rails', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(connectwiseManage.detect(null, 'Use connectwise manage to create ticket')).toBe(true);
  });

  test('detects CW Manage goal text', () => {
    expect(connectwiseManage.detect(null, 'Open CWManage')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(connectwiseManage.detect(null, 'Check something else')).toBe(false);
  });

  test('returns false for empty input', () => {
    expect(connectwiseManage.detect(null, null)).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(connectwiseManage.detect('://invalid', '')).toBe(false);
  });
});

describe('sonicwall_nsm knownSelectors', () => {
  test('has vpnPolicyTabClientText selector entries', () => {
    const s = sonicwallNsm.knownSelectors;
    expect(s.policyTabClientText).toBeDefined();
    expect(Array.isArray(s.policyTabClientText)).toBe(true);
    expect(s.policyTabClientText).toContain('Client');
  });

  test('has virtualAdapterOptions entries', () => {
    const s = sonicwallNsm.knownSelectors;
    expect(s.virtualAdapterOptions).toBeDefined();
    expect(Array.isArray(s.virtualAdapterOptions)).toBe(true);
    expect(s.virtualAdapterOptions).toContain('None');
    expect(s.virtualAdapterOptions).toContain('DHCP Lease');
  });

  test('policyDialogTab is a function returning a selector', () => {
    const s = sonicwallNsm.knownSelectors;
    expect(typeof s.policyDialogTab).toBe('function');
    const result = s.policyDialogTab('Client');
    expect(typeof result).toBe('string');
  });

  test('virtualAdapterOption is a function returning a selector', () => {
    const s = sonicwallNsm.knownSelectors;
    expect(typeof s.virtualAdapterOption).toBe('function');
    const result = s.virtualAdapterOption('DHCP Lease');
    expect(typeof result).toBe('string');
  });
});

describe('itglue detect edge cases', () => {
  test('detects by itglue.com hostname', () => {
    expect(itglue.detect('https://account.itglue.com', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(itglue.detect(null, 'Open IT Glue and find the password')).toBe(true);
  });

  test('handles URL parse error gracefully', () => {
    expect(itglue.detect('not-valid-url', '')).toBe(false);
  });

  test('returns false for null URL without goal match', () => {
    expect(itglue.detect(null, '')).toBe(false);
  });
});

describe('ninjarmm detect edge cases', () => {
  test('detects by ninja hostname', () => {
    expect(ninjarmm.detect('https://app.ninjarmm.com', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(ninjarmm.detect(null, 'Check NinjaOne RMM')).toBe(true);
  });

  test('handles URL parse error gracefully', () => {
    expect(ninjarmm.detect('not-valid-url', '')).toBe(false);
  });
});

describe('aruba detect edge cases', () => {
  test('detects by aruba hostname', () => {
    expect(aruba.detect('https://aruba.example.com', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(aruba.detect(null, 'Configure Aruba switch')).toBe(true);
  });

  test('handles URL parse error gracefully', () => {
    expect(aruba.detect('not-valid-url', '')).toBe(false);
  });
});

describe('getPlatformProfile mismatchHints coverage', () => {
  test('returns null for non-matching URL', () => {
    const result = getPlatformProfile('https://example.com', 'check something');
    expect(result).toBeNull();
  });

  test('returns profile for matching platform', () => {
    const result = getPlatformProfile('https://my.connectwise.com', 'manage ticket');
    expect(result).not.toBeNull();
    expect(['connectwise_manage', 'screenconnect']).toContain(result.id);
  });

  test('handles null URL', () => {
    const result = getPlatformProfile(null, 'check something');
    expect(result).toBeNull();
  });

  test('handles empty goal', () => {
    const result = getPlatformProfile('https://my.connectwise.com', '');
    expect(result).not.toBeNull();
  });
});

describe('listAllProfiles', () => {
  test('returns an array of profile summaries', () => {
    const profiles = listAllProfiles();
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBeGreaterThan(0);
    for (const p of profiles) {
      expect(p.id).toBeDefined();
      expect(p.label).toBeDefined();
    }
  });
});

afterAll(() => {
  warnSpy.mockRestore();
});
