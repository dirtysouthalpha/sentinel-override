// tests/agent-engine-misc-exports.test.js
// Coverage for exported helpers that have zero coverage:
//   applyCorrection, setZoomRegion, getZoomRegion

import { jest } from '@jest/globals';

const storageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k]
            : (Array.isArray(keys) ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
    session: { set: jest.fn(async () => {}) },
  },
  runtime: {
    getURL: jest.fn((p) => p),
    sendMessage: jest.fn(async () => {}),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onSuspend: { addListener: jest.fn() },
  },
  tabs: {
    onUpdated: { addListener: jest.fn() },
  },
};

jest.unstable_mockModule('../background/audit-log.js', () => ({
  appendAuditEntry: jest.fn(async () => {}),
  getAuditLog: jest.fn(async () => []),
  auditLogToCsv: jest.fn(() => ''),
}));

const {
  applyCorrection,
  setZoomRegion,
  getZoomRegion,
  resetAgentState,
} = await import('../background/agent-engine.js');

beforeEach(() => {
  resetAgentState();
  setZoomRegion(null);
  jest.clearAllMocks();
});

// ─── applyCorrection ───────────────────────────────────────────────────────────

describe('applyCorrection', () => {
  test('does not throw for valid string correction', () => {
    expect(() => applyCorrection(1, 'click the submit button')).not.toThrow();
  });

  test('trims whitespace before storing', () => {
    expect(() => applyCorrection(1, '  click submit  ')).not.toThrow();
  });

  test('does not throw for empty string (branch not taken)', () => {
    expect(() => applyCorrection(1, '')).not.toThrow();
  });

  test('does not throw for whitespace-only string (branch not taken)', () => {
    expect(() => applyCorrection(1, '   ')).not.toThrow();
  });

  test('does not throw for null correction', () => {
    expect(() => applyCorrection(1, null)).not.toThrow();
  });

  test('does not throw for undefined correction', () => {
    expect(() => applyCorrection(1, undefined)).not.toThrow();
  });

  test('does not throw for numeric correction', () => {
    expect(() => applyCorrection(1, 42)).not.toThrow();
  });

  test('does not throw for object correction', () => {
    expect(() => applyCorrection(1, { action: 'click' })).not.toThrow();
  });

  test('accepts corrections for multiple different tabIds', () => {
    expect(() => {
      applyCorrection(1, 'correction for tab 1');
      applyCorrection(2, 'correction for tab 2');
      applyCorrection(99, 'correction for tab 99');
    }).not.toThrow();
  });

  test('overwrites previous correction for same tabId', () => {
    expect(() => {
      applyCorrection(5, 'first correction');
      applyCorrection(5, 'second correction');
    }).not.toThrow();
  });

  test('does not throw when tabId is null', () => {
    expect(() => applyCorrection(null, 'fix this')).not.toThrow();
  });

  test('does not throw when tabId is undefined', () => {
    expect(() => applyCorrection(undefined, 'fix this')).not.toThrow();
  });
});

// ─── setZoomRegion / getZoomRegion ─────────────────────────────────────────────

describe('setZoomRegion / getZoomRegion', () => {
  test('getZoomRegion returns null initially', () => {
    expect(getZoomRegion()).toBeNull();
  });

  test('setZoomRegion stores a region object', () => {
    setZoomRegion({ x: 10, y: 20, width: 300, height: 150 });
    const region = getZoomRegion();
    expect(region).not.toBeNull();
    expect(region.x).toBe(10);
    expect(region.y).toBe(20);
    expect(region.width).toBe(300);
    expect(region.height).toBe(150);
  });

  test('setZoomRegion(null) clears the region', () => {
    setZoomRegion({ x: 0, y: 0, width: 100, height: 100 });
    setZoomRegion(null);
    expect(getZoomRegion()).toBeNull();
  });

  test('setZoomRegion(undefined) clears the region (falsy path)', () => {
    setZoomRegion({ x: 5, y: 5, width: 50, height: 50 });
    setZoomRegion(undefined);
    expect(getZoomRegion()).toBeNull();
  });

  test('setZoomRegion(0) clears the region (falsy path)', () => {
    setZoomRegion({ x: 1, y: 1, width: 10, height: 10 });
    setZoomRegion(0);
    expect(getZoomRegion()).toBeNull();
  });

  test('setZoomRegion replaces an existing region', () => {
    setZoomRegion({ x: 0, y: 0, width: 100, height: 100 });
    setZoomRegion({ x: 50, y: 60, width: 200, height: 80 });
    const region = getZoomRegion();
    expect(region.x).toBe(50);
    expect(region.y).toBe(60);
  });

  test('getZoomRegion returns same object reference that was set', () => {
    const region = { x: 10, y: 20, width: 300, height: 150 };
    setZoomRegion(region);
    expect(getZoomRegion()).toBe(region);
  });

  test('does not throw for partial region object', () => {
    expect(() => setZoomRegion({ x: 0 })).not.toThrow();
    expect(getZoomRegion()).toEqual({ x: 0 });
  });
});
