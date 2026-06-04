/**
 * UAP Server Tests
 *
 * Tests for Universal Agent Protocol server functionality
 *
 * @version 10.0.0
 */

import { jest } from '@jest/globals';

// ── Chrome API mock ──
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) || typeof keys === 'string' ? undefined : keys[k]);
        }
        if (callback) {
          process.nextTick(() => callback(result));
        }
        return Promise.resolve(result);
      }),
      set: jest.fn((obj, callback) => {
        Object.assign(storageData, obj);
        if (callback) {
          process.nextTick(() => callback());
        }
        return Promise.resolve();
      }),
    },
  },
};

import { uapServer } from '../background/uap-server.js';

describe('UAP Server', () => {
  let mockSender;
  let mockSendResponse;

  beforeEach(() => {
    mockSender = {
      id: 'test-client-123',
      origin: 'https://example.com'
    };
    mockSendResponse = jest.fn();

    // Clear audit log before each test
    uapServer.auditLog = [];
  });

  afterEach(async () => {
    await uapServer.shutdown();
  });

  describe('Initialization', () => {
    test('should initialize server', async () => {
      await uapServer.init();
      expect(uapServer.config).toBeDefined();
    });

    test('should load config from storage', async () => {
      const mockConfig = {
        enabled: true,
        port: 8765,
        maxConnections: 100
      };

      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ uapConfig: mockConfig });
      });

      await uapServer.loadConfig();
      expect(uapServer.config.enabled).toBe(true);
    });
  });

  describe('Message Handling', () => {
    test('should handle ping message', async () => {
      const message = {
        type: 'ping',
        id: 'req-123'
      };

      await uapServer.handleMessage(message, mockSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'pong',
        id: 'req-123',
        timestamp: expect.any(Number)
      });
    });

    test('should reject goal request without auth', async () => {
      const message = {
        type: 'goal_request',
        id: 'req-456',
        payload: {
          goal: 'Test goal',
          context: {},
          authToken: null
        }
      };

      await uapServer.handleMessage(message, mockSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'error',
        id: 'req-456',
        error: 'authentication_failed'
      });
    });

    test('should accept valid goal request', async () => {
      const message = {
        type: 'goal_request',
        id: 'req-789',
        payload: {
          goal: 'Navigate to example.com and verify page loads',
          context: { budget: 50 },
          authToken: 'valid_token'
        }
      };

      await uapServer.handleMessage(message, mockSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'goal_accepted',
          id: 'req-789',
          runId: expect.any(String)
        })
      );
    });

    test('should reject invalid goals', async () => {
      const message = {
        type: 'goal_request',
        id: 'req-999',
        payload: {
          goal: 'short',
          context: {},
          authToken: 'valid_token'
        }
      };

      await uapServer.handleMessage(message, mockSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'error',
        id: 'req-999',
        error: 'invalid_goal'
      });
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits', async () => {
      const clientId = 'rate-limit-test';
      
      // Fill rate limit
      for (let i = 0; i < 101; i++) {
        uapServer.rateLimits.set(clientId, {
          requests: Array(101).fill(Date.now()),
          count: 101
        });
      }

      const result = uapServer.checkRateLimit(clientId);
      expect(result).toBe(false);
    });

    test('should allow requests within limit', async () => {
      const clientId = 'within-limit';
      
      uapServer.rateLimits.set(clientId, {
        requests: [Date.now()],
        count: 1
      });

      const result = uapServer.checkRateLimit(clientId);
      expect(result).toBe(true);
    });
  });

  describe('Context Validation', () => {
    test('should validate tenant format', () => {
      const context = uapServer.validateContext({
        tenant: 'invalid-tenant',
        budget: 100
      });

      expect(context.tenant).toBeNull();
    });

    test('should accept valid tenant', () => {
      const context = uapServer.validateContext({
        tenant: 'acme.onmicrosoft.com',
        budget: 100
      });

      expect(context.tenant).toBe('acme.onmicrosoft.com');
    });

    test('should default mode to normal', () => {
      const context = uapServer.validateContext({
        mode: 'invalid'
      });

      expect(context.mode).toBe('normal');
    });

    test('should clamp budget to valid range', () => {
      const context1 = uapServer.validateContext({ budget: 0 });
      expect(context1.budget).toBe(1);

      const context2 = uapServer.validateContext({ budget: 2000 });
      expect(context2.budget).toBe(1000);
    });
  });

  describe('Audit Logging', () => {
    test('should log audit events', async () => {
      const client = 'audit-test-client';
      
      uapServer.logAudit('test_event', client, { test: 'data' });

      expect(uapServer.auditLog.length).toBeGreaterThan(0);
      expect(uapServer.auditLog[0]).toMatchObject({
        event_type: 'test_event',
        client_id: client,
        test: 'data'
      });
    });

    test('should persist audit log to storage', async () => {
      chrome.storage.local.set.mockImplementation((data, callback) => {
        if (typeof callback === 'function') {
          callback();
        }
      });

      uapServer.logAudit('persist_test', 'client-1', {});

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('Statistics', () => {
    test('should return server statistics', async () => {
      // Setup some data
      uapServer.activeRuns.set('run-1', { clientId: 'client-1', status: 'running' });
      uapServer.clients.set('client-1', { ws: {}, authToken: 'token' });

      const stats = uapServer.getStats();

      expect(stats).toMatchObject({
        activeRuns: expect.any(Number),
        connectedClients: expect.any(Number),
        federationPeers: expect.any(Number),
        auditLogEntries: expect.any(Number)
      });
    });
  });

  describe('Peer Registration (Federation)', () => {
    test('should register valid peer', async () => {
      const message = {
        type: 'register_peer',
        id: 'req-peer-1',
        payload: {
          peer_id: 'peer-123',
          capabilities: ['vision', 'network'],
          max_concurrent_goals: 5,
          trust_score_baseline: 85,
          signature: 'valid_signature'
        }
      };

      await uapServer.handleMessage(message, mockSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'peer_registered',
          peer_id: 'peer-123'
        })
      );
    });

    test('should reject peer with invalid signature', async () => {
      const message = {
        type: 'register_peer',
        id: 'req-peer-2',
        payload: {
          peer_id: 'peer-456',
          capabilities: [],
          signature: null
        }
      };

      await uapServer.handleMessage(message, mockSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'invalid_signature'
        })
      );
    });
  });
});
