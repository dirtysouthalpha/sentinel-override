// Tests for proxy-manager.js (v21.6)
// Validates per-client proxy routing for IP allowlisting.

let _setCalls = [];
let _clearCalls = [];
const _mockStorage = {};

global.chrome = {
  proxy: {
    settings: {
      set: async (config) => {
        _setCalls.push(config);
      },
      clear: async (config) => {
        _clearCalls.push(config);
      }
    }
  },
  storage: {
    local: {
      get: async (key) => {
        if (key === null) return { ..._mockStorage };
        if (typeof key === 'string') return key in _mockStorage ? { [key]: _mockStorage[key] } : {};
        const result = {};
        for (const k of Object.keys(key)) {
          if (k in _mockStorage) result[k] = _mockStorage[k];
        }
        return result;
      },
      set: async (obj) => { Object.assign(_mockStorage, obj); },
      remove: async (key) => { delete _mockStorage[key]; }
    }
  }
};

import { setClientProxy, clearProxy, getActiveProxy, listProxyConfigs } from '../background/proxy-manager.js';

beforeEach(() => {
  _setCalls = [];
  _clearCalls = [];
  for (const k of Object.keys(_mockStorage)) delete _mockStorage[k];
});

describe('proxy-manager (v21.6)', () => {
  describe('setClientProxy', () => {
    test('sets proxy configuration for a client', async () => {
      const result = await setClientProxy('client-a', { host: 'proxy.example.com', port: 8080, scheme: 'http' });
      expect(result.ok).toBe(true);
      expect(_setCalls.length).toBe(1);
      expect(_setCalls[0].value.mode).toBe('fixed_servers');
      expect(_setCalls[0].value.rules.singleProxy.host).toBe('proxy.example.com');
    });

    test('fails when clientId is missing', async () => {
      const result = await setClientProxy(null, { host: 'proxy.example.com' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing');
    });

    test('fails when host is missing', async () => {
      const result = await setClientProxy('client-a', {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing');
    });

    test('defaults port to 8080 and scheme to http', async () => {
      const result = await setClientProxy('client-a', { host: 'proxy.example.com' });
      expect(result.ok).toBe(true);
      expect(_setCalls[0].value.rules.singleProxy.port).toBe(8080);
      expect(_setCalls[0].value.rules.singleProxy.scheme).toBe('http');
    });
  });

  describe('clearProxy', () => {
    test('clears proxy configuration', async () => {
      await setClientProxy('client-a', { host: 'proxy.example.com' });
      const result = await clearProxy();
      expect(result.ok).toBe(true);
      expect(_clearCalls.length).toBe(1);
      expect(getActiveProxy()).toBeNull();
    });
  });

  describe('getActiveProxy', () => {
    test('returns null when no proxy set', () => {
      expect(getActiveProxy()).toBeNull();
    });

    test('returns active proxy config after setting', async () => {
      await setClientProxy('client-b', { host: 'proxy.test.com', port: 3128 });
      const active = getActiveProxy();
      expect(active).not.toBeNull();
      expect(active.clientId).toBe('client-b');
      expect(active.host).toBe('proxy.test.com');
    });
  });

  describe('listProxyConfigs', () => {
    test('returns empty array when no configs saved', async () => {
      const configs = await listProxyConfigs();
      expect(configs).toEqual([]);
    });

    test('returns saved proxy configs', async () => {
      await setClientProxy('client-c', { host: 'proxy.c.com', port: 8080 });
      const configs = await listProxyConfigs();
      expect(configs.length).toBe(1);
      expect(configs[0].clientId).toBe('client-c');
      expect(configs[0].host).toBe('proxy.c.com');
    });
  });
});
