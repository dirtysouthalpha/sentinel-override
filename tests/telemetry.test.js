// tests/telemetry.test.js
// Unit tests for background/telemetry.js — redaction, level filtering, emit, run lifecycle.

import { jest } from '@jest/globals';

let storageData = {};
const listeners = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (defaults) => {
        const result = {};
        for (const k of Object.keys(defaults)) {
          result[k] = storageData[k] !== undefined ? storageData[k] : defaults[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
      remove: jest.fn(async () => {}),
    },
    onChanged: {
      addListener: jest.fn((cb) => { listeners.storageChanged = cb; }),
    },
  },
  runtime: {
    sendMessage: jest.fn(async () => {}),
    onMessage: { addListener: jest.fn() },
    getPlatformInfo: jest.fn((cb) => { if (cb) cb({}); }),
  },
};

const {
  emit,
  tel,
  listCategories,
  getLevel,
  startRun,
  endRun,
  listPersistedRuns,
  loadPersistedRun,
  deletePersistedRun,
} = await import('../background/telemetry.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
  // Reset telemetry level to 'normal' via the storage change listener
  if (listeners.storageChanged) {
    listeners.storageChanged({ telemetryLevel: { newValue: 'normal' } }, 'local');
  }
});

describe('listCategories', () => {
  test('returns known category list', () => {
    const cats = listCategories();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toContain('llm');
    expect(cats).toContain('skill');
    expect(cats).toContain('error');
    expect(cats.length).toBeGreaterThan(5);
  });

  test('returns a copy (mutation safe)', () => {
    const a = listCategories();
    const b = listCategories();
    a.push('fake');
    expect(b).not.toContain('fake');
  });
});

describe('getLevel', () => {
  test('returns default level normal', () => {
    const level = getLevel();
    expect(['quiet', 'normal', 'verbose', 'debug']).toContain(level);
  });
});

describe('emit', () => {
  test('emits an event via chrome.runtime.sendMessage', () => {
    emit('test', 'info', 'Test message', { key: 'value' });
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.action).toBe('telemetry_event');
    expect(event.category).toBe('test');
    expect(event.level).toBe('info');
    expect(event.message).toBe('Test message');
    expect(event.payload).toEqual({ key: 'value' });
  });

  test('increments sequence number', () => {
    emit('test', 'info', 'first');
    const seq1 = globalThis.chrome.runtime.sendMessage.mock.calls[0][0].seq;
    emit('test', 'info', 'second');
    const seq2 = globalThis.chrome.runtime.sendMessage.mock.calls[1][0].seq;
    expect(seq2).toBeGreaterThan(seq1);
  });

  test('caps message at 500 chars', () => {
    const longMsg = 'A'.repeat(600);
    emit('test', 'info', longMsg);
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message.length).toBeLessThanOrEqual(500);
  });

  test('error level always emits even in quiet mode', () => {
    // Simulate quiet mode via storage change
    if (listeners.storageChanged) {
      listeners.storageChanged({ telemetryLevel: { newValue: 'quiet' } }, 'local');
    }
    emit('test', 'error', 'Critical error');
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  test('handles null payload gracefully', () => {
    emit('test', 'info', 'No payload', null);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  test('handles missing arguments gracefully', () => {
    emit();
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
  });
});

describe('tel convenience methods', () => {
  test('tel.error emits with error level', () => {
    tel.error('cat', 'msg');
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.level).toBe('error');
  });

  test('tel.warn emits with warn level', () => {
    tel.warn('cat', 'msg');
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.level).toBe('warn');
  });

  test('tel.info emits with info level', () => {
    tel.info('cat', 'msg');
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.level).toBe('info');
  });

  test('tel.debug emits with debug level when verbose', () => {
    // Set verbose mode so debug emits
    if (listeners.storageChanged) {
      listeners.storageChanged({ telemetryLevel: { newValue: 'verbose' } }, 'local');
    }
    expect(getLevel()).toBe('verbose');
    tel.debug('cat', 'msg');
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.level).toBe('debug');
  });

  test('tel.trace emits with trace level when debug', () => {
    if (listeners.storageChanged) {
      listeners.storageChanged({ telemetryLevel: { newValue: 'debug' } }, 'local');
    }
    expect(getLevel()).toBe('debug');
    tel.trace('cat', 'msg');
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.level).toBe('trace');
  });
});

describe('redaction', () => {
  test('redacts OpenAI API keys', () => {
    emit('test', 'info', 'Using key sk-proj-AbCdEf1234567890AbCdEf1234567890AbCd', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:openai-key]');
    expect(event.message).not.toContain('sk-proj-AbCd');
  });

  test('redacts Anthropic API keys', () => {
    emit('test', 'info', 'Key sk-ant-api03-AbCdEf1234567890AbCdEf1234567890', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:anthropic-key]');
  });

  test('redacts Bearer tokens in messages', () => {
    emit('test', 'info', 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('Bearer [REDACTED:auth-header]');
  });

  test('redacts sensitive field names in payload', () => {
    emit('test', 'info', 'Login attempt', { password: 'secret123', username: 'admin' });
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.payload.password).toBe('[REDACTED]');
    expect(event.payload.username).toBe('admin');
  });

  test('redacts nested sensitive fields', () => {
    emit('test', 'info', 'Config', { config: { api_key: 'sk-test-1234567890abcdef1234567890abcdef', name: 'prod' } });
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.payload.config.api_key).toBe('[REDACTED]');
    expect(event.payload.config.name).toBe('prod');
  });

  test('redacts sensitive URL query parameters', () => {
    emit('test', 'info', 'URL https://api.example.com/data?token=abc123&other=ok', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('token=[REDACTED]');
    expect(event.message).toContain('other=ok');
  });

  test('redacts GitHub tokens', () => {
    emit('test', 'info', 'Using ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:github-token]');
  });

  test('redacts AWS access keys', () => {
    emit('test', 'info', 'Found AKIAIOSFODNN7EXAMPLE in config', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:aws-access-key]');
  });
});

describe('run lifecycle', () => {
  test('startRun and endRun do not throw', async () => {
    await expect(startRun('run-1', 'Test goal')).resolves.toBeUndefined();
    await expect(endRun('run-1')).resolves.toBeUndefined();
  });

  test('startRun handles null args', async () => {
    await expect(startRun(null, null)).resolves.toBeUndefined();
  });

  test('endRun handles null runId', async () => {
    await expect(endRun(null)).resolves.toBeUndefined();
  });

  test('listPersistedRuns returns array', async () => {
    const runs = await listPersistedRuns();
    expect(Array.isArray(runs)).toBe(true);
  });

  test('loadPersistedRun returns empty for missing run', async () => {
    const events = await loadPersistedRun('nonexistent');
    expect(events).toEqual([]);
  });

  test('loadPersistedRun returns empty for falsy id', async () => {
    const events = await loadPersistedRun(null);
    expect(events).toEqual([]);
  });

  test('deletePersistedRun does not throw', async () => {
    await expect(deletePersistedRun(null)).resolves.toBeUndefined();
    await expect(deletePersistedRun('fake')).resolves.toBeUndefined();
  });
});
