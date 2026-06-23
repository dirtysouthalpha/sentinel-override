// tests/agent-network.test.js
// Tests for background/agent-network.js — CDP Network Interception Module.
//
// Coverage:
//   shouldReportNetwork — keyword matching for API/network/debug goals
//   formatNetworkForContext — formatting, sorting, truncation
//   captureNetworkSnapshot — integration with readNetworkRequests
//   captureFailedRequests — failed-only filtering

import { jest } from '@jest/globals';

// ── Mock readNetworkRequests from tab-manager.js ──
const mockReadNetworkRequests = jest.fn();
jest.unstable_mockModule('../background/tab-manager.js', () => ({
  readNetworkRequests: mockReadNetworkRequests,
}));

// Dynamic import after mock is set up
let mod;

beforeAll(async () => {
  mod = await import('../background/agent-network.js');
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helper: create a network request entry ──
function makeRequest(overrides = {}) {
  return {
    method: 'GET',
    url: 'https://api.example.com/v1/data',
    status: 200,
    type: 'fetch',
    duration_ms: 120,
    failed: false,
    error: '',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// shouldReportNetwork
// ═══════════════════════════════════════════════════════════
describe('shouldReportNetwork', () => {
  test('returns true for goals containing API keywords', () => {
    expect(mod.shouldReportNetwork('Debug the API endpoint')).toBe(true);
    expect(mod.shouldReportNetwork('Check network requests')).toBe(true);
    expect(mod.shouldReportNetwork('Fix the failed fetch request')).toBe(true);
    expect(mod.shouldReportNetwork('Inspect XHR calls')).toBe(true);
  });

  test('returns true for goals with debugging keywords', () => {
    expect(mod.shouldReportNetwork('Debug why login fails')).toBe(true);
    expect(mod.shouldReportNetwork('Debugging CORS error')).toBe(true);
    expect(mod.shouldReportNetwork('Inspect the graphql response')).toBe(true);
  });

  test('returns true for goals with HTTP/error keywords', () => {
    expect(mod.shouldReportNetwork('Check HTTP status codes')).toBe(true);
    expect(mod.shouldReportNetwork('Fix timeout on webhook')).toBe(true);
    expect(mod.shouldReportNetwork('Investigate auth token failure')).toBe(true);
  });

  test('returns false for non-network goals', () => {
    expect(mod.shouldReportNetwork('Click the submit button')).toBe(false);
    expect(mod.shouldReportNetwork('Fill out the contact form')).toBe(false);
    expect(mod.shouldReportNetwork('Take a screenshot')).toBe(false);
    expect(mod.shouldReportNetwork('Scroll down to bottom')).toBe(false);
  });

  test('returns false for empty/invalid input', () => {
    expect(mod.shouldReportNetwork('')).toBe(false);
    expect(mod.shouldReportNetwork(null)).toBe(false);
    expect(mod.shouldReportNetwork(undefined)).toBe(false);
    expect(mod.shouldReportNetwork(123)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// formatNetworkForContext
// ═══════════════════════════════════════════════════════════
describe('formatNetworkForContext', () => {
  test('returns empty string for empty/null input', () => {
    expect(mod.formatNetworkForContext([])).toBe('');
    expect(mod.formatNetworkForContext(null)).toBe('');
    expect(mod.formatNetworkForContext(undefined)).toBe('');
  });

  test('formats basic request entries', () => {
    const reqs = [makeRequest()];
    const result = mod.formatNetworkForContext(reqs);
    expect(result).toContain('GET');
    expect(result).toContain('200');
    expect(result).toContain('https://api.example.com/v1/data');
    expect(result).toContain('120ms');
  });

  test('includes summary header with request count', () => {
    const reqs = [makeRequest(), makeRequest({ method: 'POST' })];
    const result = mod.formatNetworkForContext(reqs);
    expect(result).toContain('Network Snapshot');
    expect(result).toContain('2 requests');
  });

  test('uses singular for single request', () => {
    const reqs = [makeRequest()];
    const result = mod.formatNetworkForContext(reqs);
    expect(result).toContain('1 request');
  });

  test('respects maxEntries limit', () => {
    const reqs = Array.from({ length: 50 }, (_, i) =>
      makeRequest({ url: `https://api.example.com/v1/item-${i}` })
    );
    const result = mod.formatNetworkForContext(reqs, { maxEntries: 5 });
    const lines = result.split('\n').filter(l => !l.startsWith('['));
    expect(lines.length).toBe(5);
  });

  test('sorts failed requests before successful ones', () => {
    const reqs = [
      makeRequest({ url: 'https://ok.com', status: 200, failed: false }),
      makeRequest({ url: 'https://fail.com', status: 500, failed: true }),
      makeRequest({ url: 'https://ok2.com', status: 200, failed: false }),
    ];
    const result = mod.formatNetworkForContext(reqs);
    const lines = result.split('\n');
    const firstReqLine = lines.find(l => !l.startsWith('['));
    expect(firstReqLine).toContain('https://fail.com');
    expect(firstReqLine).toContain('FAIL');
  });

  test('filters to failed-only when includeFailedOnly is true', () => {
    const reqs = [
      makeRequest({ url: 'https://ok.com', status: 200, failed: false }),
      makeRequest({ url: 'https://err.com', status: 500, failed: true, error: 'Internal Server Error' }),
    ];
    const result = mod.formatNetworkForContext(reqs, { includeFailedOnly: true });
    expect(result).toContain('https://err.com');
    expect(result).not.toContain('https://ok.com');
  });

  test('includes error text for failed requests', () => {
    const reqs = [
      makeRequest({ status: 503, failed: true, error: 'Service Unavailable' }),
    ];
    const result = mod.formatNetworkForContext(reqs);
    expect(result).toContain('Service Unavailable');
    expect(result).toContain('err=Service Unavailable');
  });

  test('handles requests with missing fields gracefully', () => {
    const reqs = [{ method: undefined, url: undefined, status: undefined }];
    const result = mod.formatNetworkForContext(reqs);
    expect(result).toContain('GET'); // default
    expect(result).toContain('---'); // default status
  });
});

// ═══════════════════════════════════════════════════════════
// captureNetworkSnapshot
// ═══════════════════════════════════════════════════════════
describe('captureNetworkSnapshot', () => {
  test('reads network buffer via readNetworkRequests', () => {
    mockReadNetworkRequests.mockReturnValue([
      makeRequest({ url: 'https://test.com/api' }),
    ]);
    const result = mod.captureNetworkSnapshot(42);
    expect(mockReadNetworkRequests).toHaveBeenCalledWith(42, { limit: 30 });
    expect(result).toContain('https://test.com/api');
  });

  test('returns empty string when no network data', () => {
    mockReadNetworkRequests.mockReturnValue([]);
    const result = mod.captureNetworkSnapshot(42);
    expect(result).toBe('');
  });

  test('returns empty string for invalid tabId', () => {
    const result = mod.captureNetworkSnapshot(null);
    expect(result).toBe('');
    expect(mockReadNetworkRequests).not.toHaveBeenCalled();
  });

  test('passes custom options through', () => {
    mockReadNetworkRequests.mockReturnValue([]);
    mod.captureNetworkSnapshot(42, { limit: 50 });
    expect(mockReadNetworkRequests).toHaveBeenCalledWith(42, { limit: 50 });
  });
});

// ═══════════════════════════════════════════════════════════
// captureFailedRequests
// ═══════════════════════════════════════════════════════════
describe('captureFailedRequests', () => {
  test('uses failed filter when reading network requests', () => {
    mockReadNetworkRequests.mockReturnValue([]);
    mod.captureFailedRequests(42);
    expect(mockReadNetworkRequests).toHaveBeenCalledWith(42, { limit: 20, filter: 'failed' });
  });

  test('formats failed requests', () => {
    mockReadNetworkRequests.mockReturnValue([
      makeRequest({ status: 404, failed: true, error: 'Not Found', url: 'https://missing.com' }),
    ]);
    const result = mod.captureFailedRequests(42);
    expect(result).toContain('https://missing.com');
    expect(result).toContain('Not Found');
  });

  test('returns empty string when no failed requests', () => {
    mockReadNetworkRequests.mockReturnValue([]);
    const result = mod.captureFailedRequests(42);
    expect(result).toBe('');
  });

  test('returns empty string for invalid tabId', () => {
    const result = mod.captureFailedRequests('invalid');
    expect(result).toBe('');
    expect(mockReadNetworkRequests).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// _internal exports
// ═══════════════════════════════════════════════════════════
describe('_internal', () => {
  test('exports NETWORK_KEYWORDS array', () => {
    expect(Array.isArray(mod._internal.NETWORK_KEYWORDS)).toBe(true);
    expect(mod._internal.NETWORK_KEYWORDS).toContain('api');
    expect(mod._internal.NETWORK_KEYWORDS).toContain('network');
    expect(mod._internal.NETWORK_KEYWORDS).toContain('debug');
  });

  test('exports _compactEntry formatter', () => {
    expect(typeof mod._internal._compactEntry).toBe('function');
    const entry = makeRequest({ status: 200 });
    const result = mod._internal._compactEntry(entry);
    expect(result).toContain('GET');
    expect(result).toContain('200');
  });

  test('exports _detailedEntry formatter', () => {
    expect(typeof mod._internal._detailedEntry).toBe('function');
    const entry = makeRequest({ status: 500, failed: true, error: 'Server Error' });
    const result = mod._internal._detailedEntry(entry);
    expect(result).toContain('GET');
    expect(result).toContain('500');
    expect(result).toContain('FAILED');
    expect(result).toContain('Server Error');
  });
});
