// tests/platforms-edge-cases.test.js
// Tests for uncovered branches in platform profiles:
//   - aruba.js lines 28-29: portal.arubanetworks.com and IP-based detection
//   - itglue.js line 27: partner.itglue.com detection
//   - report-generator.js line 27: executionData validation error

import { jest } from '@jest/globals';

// ============================================================
// aruba.js — uncovered detection branches (lines 28-29)
// ============================================================

describe('aruba.js — detection branches (lines 28-29)', () => {
  let aruba;

  beforeAll(async () => {
    const mod = await import('../background/platforms/aruba.js');
    aruba = mod.aruba;
  });

  test('detects portal.central.arubanetworks.com', () => {
    expect(aruba.detect('https://portal.central.arubanetworks.com/dashboard', '')).toBe(true);
  });

  test('detects central.arubanetworks.com', () => {
    expect(aruba.detect('https://central.arubanetworks.com/xxx/login', '')).toBe(true);
  });

  test('detects IP-based Aruba Instant by path pattern', () => {
    expect(aruba.detect('http://10.0.0.1/swarm.html', '')).toBe(true);
  });

  test('detects IP-based by /aruba path', () => {
    expect(aruba.detect('http://192.168.1.1/aruba/main.html', '')).toBe(true);
  });

  test('detects IP-based by /p/login path', () => {
    expect(aruba.detect('http://10.0.0.1/p/login', '')).toBe(true);
  });

  test('does not match IP without characteristic path', () => {
    expect(aruba.detect('http://10.0.0.1/something-else', '')).toBe(false);
  });

  test('detects by goal keyword "aruba central"', () => {
    expect(aruba.detect(null, 'check aruba central for alerts')).toBe(true);
  });

  test('detects by goal keyword "aruba instant"', () => {
    expect(aruba.detect(null, 'configure aruba instant AP')).toBe(true);
  });

  test('detects by goal keyword "aos-cx"', () => {
    expect(aruba.detect(null, 'check aos-cx switch VLANs')).toBe(true);
  });

  test('returns false for empty url and goal', () => {
    expect(aruba.detect(null, null)).toBe(false);
  });

  test('returns false for non-Aruba URL', () => {
    expect(aruba.detect('https://example.com', '')).toBe(false);
  });

  test('handles invalid URL gracefully', () => {
    expect(aruba.detect('not-a-url', '')).toBe(false);
  });
});

// ============================================================
// itglue.js — partner.itglue.com detection (line 27)
// ============================================================

describe('itglue.js — partner.itglue.com detection (line 27)', () => {
  let itglue;

  beforeAll(async () => {
    const mod = await import('../background/platforms/itglue.js');
    itglue = mod.itglue;
  });

  test('detects partner.itglue.com', () => {
    expect(itglue.detect('https://partner.itglue.com/organizations', '')).toBe(true);
  });

  test('detects standard itglue.com', () => {
    expect(itglue.detect('https://acme.itglue.com/123/configurations', '')).toBe(true);
  });

  test('detects by goal keyword "IT Glue"', () => {
    expect(itglue.detect(null, 'Look up IT Glue configuration for server')).toBe(true);
  });

  test('detects by goal keyword "it glue" (space)', () => {
    expect(itglue.detect(null, 'find it glue documentation')).toBe(true);
  });

  test('returns false for empty url and goal', () => {
    expect(itglue.detect(null, null)).toBe(false);
  });

  test('returns false for non-ITGlue URL', () => {
    expect(itglue.detect('https://example.com', '')).toBe(false);
  });

  test('handles invalid URL gracefully', () => {
    expect(itglue.detect('not-a-valid-url', '')).toBe(false);
  });
});

// ============================================================
// report-generator.js — executionData validation (line 27)
// ============================================================

describe('report-generator.js — executionData validation (line 27)', () => {
  let generateReport;

  beforeAll(async () => {
    // Set up minimal chrome mock
    globalThis.chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: { sendMessage: async () => {} },
    };

    jest.unstable_mockModule('../background/provider-registry.js', () => ({
      getActiveProvider: jest.fn(() => Promise.resolve({ endpoint: 'https://api.test.com', apiKey: 'k', model: 'm' })),
      resolveProvider: jest.fn(() => ({
        buildBody: (m, s, p, o) => ({ messages: [] }),
        buildHeaders: () => ({}),
        parseResponse: (d) => '',
      })),
    }));

    jest.unstable_mockModule('../background/message-protocol.js', () => ({
      sendSilentUpdate: jest.fn(),
    }));

    globalThis.fetch = jest.fn();

    const mod = await import('../background/report-generator.js');
    generateReport = mod.generateReport;
  });

  test('throws error when executionData is null', async () => {
    await expect(generateReport(null, {})).rejects.toThrow('generateReport: executionData is required');
  });

  test('throws error when executionData is undefined', async () => {
    await expect(generateReport(undefined, {})).rejects.toThrow('generateReport: executionData is required');
  });

  test('throws error when executionData is a string', async () => {
    await expect(generateReport('bad data', {})).rejects.toThrow('generateReport: executionData is required');
  });

  test('throws error when executionData is a number', async () => {
    await expect(generateReport(42, {})).rejects.toThrow('generateReport: executionData is required');
  });
});
