// Tests for session-manager.js (v21.6)
// Validates cookie/session persistence for per-client auth isolation.

const _mockCookieStore = [];
const _mockStorage = {};

global.chrome = {
  cookies: {
    getAll: async ({ domain }) => {
      return _mockCookieStore.filter(c => c.domain === domain || c.domain === '.' + domain.replace(/^\./, ''));
    },
    set: async (details) => {
      _mockCookieStore.push(details);
      return details;
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

import { saveSession, restoreSession, listSessions, deleteSession } from '../background/session-manager.js';

beforeEach(() => {
  _mockCookieStore.length = 0;
  for (const k of Object.keys(_mockStorage)) delete _mockStorage[k];
});

describe('session-manager (v21.6)', () => {
  describe('saveSession', () => {
    test('saves cookies for a client domain', async () => {
      _mockCookieStore.push(
        { name: 'sessionid', value: 'abc123', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'none' },
        { name: 'csrf', value: 'xyz789', domain: '.example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax' }
      );
      const result = await saveSession('client-a', '.example.com');
      expect(result.ok).toBe(true);
      expect(result.count).toBe(2);
    });

    test('fails when clientId is missing', async () => {
      const result = await saveSession(null, '.example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing');
    });

    test('fails when domain is missing', async () => {
      const result = await saveSession('client-a', null);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing');
    });
  });

  describe('restoreSession', () => {
    test('restores previously saved cookies', async () => {
      _mockCookieStore.push({ name: 'auth', value: 'token123', domain: '.example.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax' });
      await saveSession('client-b', '.example.com');
      _mockCookieStore.length = 0;
      const result = await restoreSession('client-b');
      expect(result.ok).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    test('fails when no saved session exists', async () => {
      const result = await restoreSession('nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No saved session');
    });
  });

  describe('listSessions', () => {
    test('returns empty array when no sessions', async () => {
      const sessions = await listSessions();
      expect(sessions).toEqual([]);
    });

    test('returns saved sessions with metadata', async () => {
      _mockCookieStore.push({ name: 'auth', value: 'v', domain: '.test.com', path: '/', secure: true, httpOnly: false });
      await saveSession('client-c', '.test.com');
      const sessions = await listSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].clientId).toBe('client-c');
      expect(sessions[0].domain).toBe('.test.com');
    });
  });

  describe('deleteSession', () => {
    test('deletes a saved session', async () => {
      _mockCookieStore.push({ name: 'x', value: 'y', domain: '.d.com', path: '/', secure: true, httpOnly: false });
      await saveSession('to-delete', '.d.com');
      const result = await deleteSession('to-delete');
      expect(result.ok).toBe(true);
      const sessions = await listSessions();
      expect(sessions.find(s => s.clientId === 'to-delete')).toBeUndefined();
    });
  });
});
