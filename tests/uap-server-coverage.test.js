/**
 * UAP Server coverage — hits the branches not covered by uap-server.test.js:
 * init() when enabled=true, isValidJWT catch, setupCleanup interval, shutdown cancellation.
 */

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const _startupListeners = [];
const _installedListeners = [];
const _externalListeners = [];
const storageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : undefined;
        }
        if (callback) process.nextTick(() => callback(result));
        return Promise.resolve(result);
      }),
      set: jest.fn((obj, callback) => {
        Object.assign(storageData, obj);
        if (callback) process.nextTick(() => callback());
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    lastError: null,
    onMessageExternal: {
      addListener: jest.fn((fn) => _externalListeners.push(fn)),
    },
    onStartup: {
      addListener: jest.fn((fn) => _startupListeners.push(fn)),
    },
    onInstalled: {
      addListener: jest.fn((fn) => _installedListeners.push(fn)),
    },
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
};

import { uapServer } from '../background/uap-server.js';

describe('UAP Server — coverage gaps', () => {
  beforeEach(async () => {
    uapServer.auditLog = [];
    uapServer.clients.clear();
    uapServer.activeRuns.clear();
    uapServer.rateLimits.clear();
    uapServer.peerTrust.clear();
    // Reset to default disabled state
    uapServer.config.enabled = false;
  });

  afterEach(async () => {
    uapServer.config.enabled = false;
  });

  // ── init() when enabled = true ──────────────────────────────────────────────
  describe('init() — enabled path', () => {
    test('generates keypair and starts server when enabled', async () => {
      // Mock storage returning enabled config
      chrome.storage.local.get.mockImplementationOnce((keys, callback) => {
        callback({ uapConfig: { enabled: true, port: 8765, maxConnections: 100 } });
      });

      await uapServer.init();

      expect(uapServer.config.enabled).toBe(true);
      expect(uapServer.keyPair).toBeDefined();
      expect(uapServer.keyPair.publicKey).toMatch(/^p_placeholder_/);
    });

    test('init() error path: re-throws when an internal method throws', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, callback) => {
        callback({ uapConfig: { enabled: true } });
      });

      const origGenerate = uapServer.generateKeyPair.bind(uapServer);
      uapServer.generateKeyPair = jest.fn().mockRejectedValue(new Error('crypto unavailable'));

      await expect(uapServer.init()).rejects.toThrow('crypto unavailable');

      uapServer.generateKeyPair = origGenerate;
    });
  });

  // ── isValidJWT() catch block ────────────────────────────────────────────────
  describe('isValidJWT() — catch branch', () => {
    test('returns false for token with non-base64 payload segment', () => {
      // Three-part token but second segment is invalid base64 for atob
      const badToken = 'header.!!!invalid!!!.signature';
      const result = uapServer.isValidJWT(badToken);
      expect(result).toBe(false);
    });

    test('returns false for token whose payload lacks exp field', () => {
      // Valid base64 JSON but no exp field → payload.exp is undefined → returns false
      const payload = btoa(JSON.stringify({ sub: 'user' }));
      const token = `header.${payload}.sig`;
      const result = uapServer.isValidJWT(token);
      expect(result).toBe(false);
    });
  });

  // ── setupCleanup() interval callback ───────────────────────────────────────
  describe('setupCleanup() — interval callback', () => {
    test('removes stale rate-limit entries when requests are old', () => {
      const now = Date.now();
      const twoHoursAgo = now - 7200000;

      // Add a rate-limit entry with an old request time
      uapServer.rateLimits.set('stale-client', { requests: [twoHoursAgo], count: 1 });
      // Add a fresh one that should survive
      uapServer.rateLimits.set('fresh-client', { requests: [now], count: 1 });

      // Manually trigger cleanup
      uapServer._performCleanup();

      expect(uapServer.rateLimits.has('stale-client')).toBe(false);
      expect(uapServer.rateLimits.has('fresh-client')).toBe(true);
    });

    test('removes completed runs older than 24 hours', () => {
      const oldRunId = 'old-run';
      const freshRunId = 'fresh-run';
      uapServer.activeRuns.set(oldRunId, {
        status: 'completed',
        clientId: 'c1',
        endTime: Date.now() - 90000000 // > 24h
      });
      uapServer.activeRuns.set(freshRunId, {
        status: 'completed',
        clientId: 'c2',
        endTime: Date.now()
      });

      // Manually trigger cleanup
      uapServer._performCleanup();

      expect(uapServer.activeRuns.has(oldRunId)).toBe(false);
      expect(uapServer.activeRuns.has(freshRunId)).toBe(true);
    });

    test('removes inactive federation peers', () => {
      uapServer.peerTrust.set('stale-peer', { lastSeen: Date.now() - 7200000, score: 1 });
      uapServer.peerTrust.set('active-peer', { lastSeen: Date.now(), score: 1 });

      // Manually trigger cleanup
      uapServer._performCleanup();

      expect(uapServer.peerTrust.has('stale-peer')).toBe(false);
      expect(uapServer.peerTrust.has('active-peer')).toBe(true);
    });
  });

  // ── loadConfig() — lastError path ────────────────────────────────────────────
  describe('loadConfig() — lastError path', () => {
    test('resolves without crashing when chrome.runtime.lastError is set', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        chrome.runtime.lastError = { message: 'Storage quota exceeded' };
        if (cb) cb({});
        chrome.runtime.lastError = null;
      });
      await expect(uapServer.loadConfig()).resolves.toBeUndefined();
    });
  });

  // ── logAudit() — lastError on persist ────────────────────────────────────────
  describe('logAudit() — storage persist lastError', () => {
    test('does not throw when chrome.runtime.lastError is set on set callback', () => {
      chrome.storage.local.set.mockImplementationOnce((data, cb) => {
        chrome.runtime.lastError = { message: 'Quota exceeded' };
        if (cb) cb();
        chrome.runtime.lastError = null;
      });
      expect(() => uapServer.logAudit('test_event', 'test-client', { detail: 'x' })).not.toThrow();
    });
  });

  // ── shutdown() — running runs are cancelled ──────────────────────────────────
  describe('shutdown() — cancellation path', () => {
    test('marks running runs as cancelled and logs audit', async () => {
      uapServer.activeRuns.set('run-1', {
        status: 'running',
        clientId: 'client-shutdown',
        startTime: Date.now()
      });
      uapServer.activeRuns.set('run-2', {
        status: 'completed',
        clientId: 'client-shutdown',
        startTime: Date.now()
      });

      await uapServer.shutdown();

      // After shutdown, activeRuns is cleared but the audit log entry was written
      expect(uapServer.auditLog.some(e => e.event === 'server_shutdown' && e.runId === 'run-1')).toBe(true);
      expect(uapServer.activeRuns.size).toBe(0);
    });
  });
});
