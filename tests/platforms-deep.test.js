// tests/platforms-deep.test.js
// Additional coverage for platform modules with uncovered lines:
//   ambio_viewlinc.js line 37 (detect with OQ pattern)
//   connectwise_manage.js lines 20-21 (detect by hostname patterns)
//   sonicwall_nsm.js lines 146-155 (knownSelectors functions)
//   itglue.js line 27 (detect catch branch)
//   ninjarmm.js line 19 (detect catch branch)
//   aruba.js line 28 (detect catch branch)
//   index.js line 67 (mismatchHints with undefined mismatchHints)

import { jest } from '@jest/globals';

// Mock console.warn to suppress noise
const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

const {
  getPlatformProfile,
  getAllPlatforms,
} = await import('../background/platforms/index.js');

describe('ambio_viewlinc detect', () => {
  const platform = (await import('../background/platforms/ambio_viewlinc.js')).ambioViewlinc;

  test('detects by viewlinc hostname', () => {
    expect(platform.detect('https://viewlinc.example.com', '')).toBe(true);
  });

  test('detects by internal IP', () => {
    expect(platform.detect('https://192.168.100.50', '')).toBe(true);
  });

  test('detects by goal text mentioning viewlinc', () => {
    expect(platform.detect(null, 'Check viewlinc thresholds')).toBe(true);
  });

  test('detects by goal text mentioning ambio', () => {
    expect(platform.detect(null, 'Configure ambio monitoring')).toBe(true);
  });

  test('detects OQ test pattern with threshold keyword', () => {
    expect(platform.detect(null, 'Run OQ-3 threshold test on chamber')).toBe(true);
  });

  test('detects IQ pattern with stability keyword', () => {
    expect(platform.detect(null, 'Complete IQ-2 stability test')).toBe(true);
  });

  test('returns false for unrelated URL and goal', () => {
    expect(platform.detect('https://example.com', 'Check firewall')).toBe(false);
  });

  test('handles null URL gracefully', () => {
    expect(platform.detect(null, '')).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(platform.detect('not-a-url', '')).toBe(false);
  });
});

describe('connectwise_manage detect', () => {
  const platform = (await import('../background/platforms/connectwise_manage.js')).connectwiseManage;

  test('detects my.connectwise.com', () => {
    expect(platform.detect('https://my.connectwise.com', '')).toBe(true);
  });

  test('detects connectwise.net hostname', () => {
    expect(platform.detect('https://host.connectwise.net', '')).toBe(true);
  });

  test('detects cw.local hostname', () => {
    expect(platform.detect('https://cw.local', '')).toBe(true);
  });

  test('detects cw.manage hostname', () => {
    expect(platform.detect('https://cw.manage.example.com', '')).toBe(true);
  });

  test('detects by API rails path', () => {
    expect(platform.detect('https://example.com/v4_6_release/services/system_io/router/api.rails', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(platform.detect(null, 'Use connectwise manage to create ticket')).toBe(true);
  });

  test('detects CW Manage goal text', () => {
    expect(platform.detect(null, 'Open CWManage')).toBe(true);
  });

  test('returns false for null URL without goal match', () => {
    expect(platform.detect(null, 'Check something else')).toBe(false);
  });

  test('returns false for empty input', () => {
    expect(platform.detect(null, null)).toBe(false);
  });

  test('handles URL parse error gracefully', () => {
    expect(platform.detect('://invalid', '')).toBe(false);
  });
});

describe('sonicwall_nsm knownSelectors', () => {
  const platform = (await import('../background/platforms/sonicwall_nsm.js')).sonicwallNsm;

  test('has vpnPolicyTabClientText selector entries', () => {
    const s = platform.knownSelectors;
    expect(s.policyTabClientText).toBeDefined();
    expect(Array.isArray(s.policyTabClientText)).toBe(true);
    expect(s.policyTabClientText).toContain('Client');
  });

  test('has virtualAdapterOptions entries', () => {
    const s = platform.knownSelectors;
    expect(s.virtualAdapterOptions).toBeDefined();
    expect(Array.isArray(s.virtualAdapterOptions)).toBe(true);
    expect(s.virtualAdapterOptions).toContain('None');
    expect(s.virtualAdapterOptions).toContain('DHCP Lease');
  });

  test('policyDialogTab is a function returning a selector', () => {
    const s = platform.knownSelectors;
    expect(typeof s.policyDialogTab).toBe('function');
    const result = s.policyDialogTab('Client');
    expect(typeof result).toBe('string');
  });

  test('virtualAdapterOption is a function returning a selector', () => {
    const s = platform.knownSelectors;
    expect(typeof s.virtualAdapterOption).toBe('function');
    const result = s.virtualAdapterOption('DHCP Lease');
    expect(typeof result).toBe('string');
  });
});

describe('itglue detect edge cases', () => {
  const platform = (await import('../background/platforms/itglue.js')).itglue;

  test('detects by itglue.com hostname', () => {
    expect(platform.detect('https://account.itglue.com', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(platform.detect(null, 'Open IT Glue and find the password')).toBe(true);
  });

  test('handles URL parse error gracefully', () => {
    expect(platform.detect('not-valid-url', '')).toBe(false);
  });

  test('returns false for null URL without goal match', () => {
    expect(platform.detect(null, '')).toBe(false);
  });
});

describe('ninjarmm detect edge cases', () => {
  const platform = (await import('../background/platforms/ninjarmm.js')).ninjaRmm;

  test('detects by ninja hostname', () => {
    expect(platform.detect('https://app.ninjarmm.com', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(platform.detect(null, 'Check NinjaOne RMM')).toBe(true);
  });

  test('handles URL parse error gracefully', () => {
    expect(platform.detect('not-valid-url', '')).toBe(false);
  });
});

describe('aruba detect edge cases', () => {
  const platform = (await import('../background/platforms/aruba.js')).aruba;

  test('detects by aruba hostname', () => {
    expect(platform.detect('https://aruba.example.com', '')).toBe(true);
  });

  test('detects by goal text', () => {
    expect(platform.detect(null, 'Configure Aruba switch')).toBe(true);
  });

  test('handles URL parse error gracefully', () => {
    expect(platform.detect('not-valid-url', '')).toBe(false);
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
    expect(result.id).toBe('connectwise_manage');
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

describe('getAllPlatforms', () => {
  test('returns an array of platform objects', () => {
    const platforms = getAllPlatforms();
    expect(Array.isArray(platforms)).toBe(true);
    expect(platforms.length).toBeGreaterThan(0);
    // Each should have id, label, detect function
    for (const p of platforms) {
      expect(p.id).toBeDefined();
      expect(p.label).toBeDefined();
      expect(typeof p.detect).toBe('function');
    }
  });
});

afterAll(() => {
  warnSpy.mockRestore();
});
