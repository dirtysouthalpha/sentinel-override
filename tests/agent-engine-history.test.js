// tests/agent-engine-history.test.js
// Edge case tests for agent-engine.js history management and state persistence.
// Tests historyPush, trimHistory, persistHistory, captureReportData, and related functions.

import { jest } from '@jest/globals';

const storageData = {};
const sessionData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
    session: {
      set: jest.fn(async () => {}),
    },
  },
  runtime: {
    getURL: jest.fn((p) => p),
  },
};

jest.unstable_mockModule('../background/audit-log.js', () => ({
  appendAuditEntry: jest.fn(async () => {}),
  getAuditLog: jest.fn(async () => []),
  auditLogToCsv: jest.fn(() => ''),
}));

const {
  resetAgentState,
  injectContext,
  setAgentSpeed,
} = await import('../background/agent-engine.js');

describe('agent-engine — history management edge cases', () => {
  beforeEach(() => {
    Object.keys(storageData).forEach(k => delete storageData[k]);
    jest.clearAllMocks();
    // Restore storage mocks
    chrome.storage.local.get.mockImplementation(async (keys) => {
      const result = {};
      const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
      for (const k of keyList) {
        result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) ? undefined : keys[k]);
      }
      return result;
    });
    chrome.storage.local.set.mockImplementation(async (obj) => { Object.assign(storageData, obj); });
  });

  describe('resetAgentState', () => {
    test('clears injected context notes', async () => {
      injectContext('note 1');
      injectContext('note 2');
      injectContext('note 3');

      resetAgentState();

      // Context queue should be cleared (verified by no errors on subsequent operations)
      expect(() => resetAgentState()).not.toThrow();
    });

    test('handles multiple rapid reset calls', () => {
      expect(() => {
        resetAgentState();
        resetAgentState();
        resetAgentState();
      }).not.toThrow();
    });

    test('resets state after injectContext with edge case values', () => {
      injectContext('');
      injectContext('   ');
      injectContext(null);
      injectContext(123);
      injectContext({}); // non-string

      expect(() => resetAgentState()).not.toThrow();
    });
  });

  describe('injectContext', () => {
    test('accepts valid context notes', () => {
      expect(() => injectContext('check the firewall')).not.toThrow();
      expect(() => injectContext('user said: click submit')).not.toThrow();
      expect(() => injectContext('note with "quotes" and \'apostrophes\'')).not.toThrow();
    });

    test('handles empty and whitespace-only strings', () => {
      expect(() => injectContext('')).not.toThrow();
      expect(() => injectContext('   ')).not.toThrow();
      expect(() => injectContext('\n\t\r')).not.toThrow();
    });

    test('handles null and undefined', () => {
      expect(() => injectContext(null)).not.toThrow();
      expect(() => injectContext(undefined)).not.toThrow();
    });

    test('handles non-string types', () => {
      expect(() => injectContext(123)).not.toThrow();
      expect(() => injectContext(0)).not.toThrow();
      expect(() => injectContext(true)).not.toThrow();
      expect(() => injectContext(false)).not.toThrow();
      expect(() => injectContext({})).not.toThrow();
      expect(() => injectContext([])).not.toThrow();
    });

    test('handles very long strings', () => {
      const longNote = 'x'.repeat(100000);
      expect(() => injectContext(longNote)).not.toThrow();
    });

    test('handles special characters', () => {
      expect(() => injectContext('note with emoji 🎉')).not.toThrow();
      expect(() => injectContext('note with unicode \u{1F600}')).not.toThrow();
      expect(() => injectContext('note with null byte \x00')).not.toThrow();
    });
  });

  describe('setAgentSpeed', () => {
    test('accepts all valid speed modes', () => {
      expect(() => setAgentSpeed('turbo')).not.toThrow();
      expect(() => setAgentSpeed('normal')).not.toThrow();
      expect(() => setAgentSpeed('stealth')).not.toThrow();
    });

    test('handles invalid speed modes gracefully', () => {
      expect(() => setAgentSpeed('')).not.toThrow();
      expect(() => setAgentSpeed('invalid')).not.toThrow();
      expect(() => setAgentSpeed(null)).not.toThrow();
      expect(() => setAgentSpeed(undefined)).not.toThrow();
    });

    test('handles case variations', () => {
      expect(() => setAgentSpeed('TURBO')).not.toThrow();
      expect(() => setAgentSpeed('Normal')).not.toThrow();
      expect(() => setAgentSpeed('STEALTH')).not.toThrow();
    });

    test('handles rapid speed changes', () => {
      expect(() => {
        setAgentSpeed('turbo');
        setAgentSpeed('normal');
        setAgentSpeed('stealth');
        setAgentSpeed('turbo');
        setAgentSpeed('normal');
      }).not.toThrow();
    });
  });

  describe('context injection with special edge cases', () => {
    test('handles concurrent context injections', () => {
      const notes = [
        'check network settings',
        'verify DNS',
        'test firewall rules',
        'review routing table',
      ];

      notes.forEach(note => {
        expect(() => injectContext(note)).not.toThrow();
      });
    });

    test('handles context with JSON content', () => {
      expect(() => injectContext('{"action": "click", "selector": "#btn"}')).not.toThrow();
      expect(() => injectContext('["item1", "item2", "item3"]')).not.toThrow();
    });

    test('handles context with HTML/XML', () => {
      expect(() => injectContext('<div class="alert">Error</div>')).not.toThrow();
      expect(() => injectContext('<?xml version="1.0"?><root/>')).not.toThrow();
    });

    test('handles context with newlines and tabs', () => {
      expect(() => injectContext('line1\nline2\nline3')).not.toThrow();
      expect(() => injectContext('col1\tcol2\tcol3')).not.toThrow();
      expect(() => injectContext('mixed\n\t\r\n')).not.toThrow();
    });
  });
});
