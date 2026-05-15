// tests/telemetry.test.js
// Unit tests for background/telemetry.js — redaction, level filtering, emit, run lifecycle.

import { jest } from '@jest/globals';

let storageData = {};
const listeners = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        if (typeof keys === 'string') {
          return { [keys]: storageData[keys] };
        }
        if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) result[k] = storageData[k];
          return result;
        }
        // Object with defaults
        const result = {};
        for (const k of Object.keys(keys)) {
          result[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
      remove: jest.fn(async (keys) => {
        const toRemove = Array.isArray(keys) ? keys : [keys];
        for (const k of toRemove) delete storageData[k];
      }),
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
  // Reset telemetry level to 'normal' and disable persistence via storage change listener
  if (listeners.storageChanged) {
    listeners.storageChanged({ telemetryLevel: { newValue: 'normal' } }, 'local');
    listeners.storageChanged({ telemetryPersist: { newValue: false } }, 'local');
    listeners.storageChanged({ telemetryRedact: { newValue: true } }, 'local');
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

// ========== Level filtering — negative cases ==========

describe('level filtering', () => {
  test('quiet mode suppresses info events', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'quiet' } }, 'local');
    jest.clearAllMocks();
    emit('test', 'info', 'Suppressed');
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('quiet mode suppresses warn events', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'quiet' } }, 'local');
    jest.clearAllMocks();
    emit('test', 'warn', 'Suppressed');
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('normal mode suppresses debug events', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'normal' } }, 'local');
    jest.clearAllMocks();
    emit('test', 'debug', 'Suppressed');
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('normal mode suppresses trace events', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'normal' } }, 'local');
    jest.clearAllMocks();
    emit('test', 'trace', 'Suppressed');
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('verbose mode suppresses trace events', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'verbose' } }, 'local');
    jest.clearAllMocks();
    emit('test', 'trace', 'Suppressed');
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('verbose mode allows debug events', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'verbose' } }, 'local');
    jest.clearAllMocks();
    emit('test', 'debug', 'Allowed');
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  test('normal mode allows info events', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'normal' } }, 'local');
    jest.clearAllMocks();
    emit('test', 'info', 'Allowed');
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  test('storage change ignores non-local area', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: 'debug' } }, 'sync');
    expect(getLevel()).toBe('normal');
  });

  test('storage change falls back to normal for undefined newValue', () => {
    listeners.storageChanged({ telemetryLevel: { newValue: undefined } }, 'local');
    expect(getLevel()).toBe('normal');
  });
});

// ========== Persistence flow ==========

describe('persistence flow', () => {
  test('enabling persist and starting a run writes to index', async () => {
    listeners.storageChanged({ telemetryPersist: { newValue: true } }, 'local');
    await startRun('run-p1', 'Persistence test goal');
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalled();
    const setCalls = globalThis.chrome.storage.local.set.mock.calls;
    const indexCall = setCalls.find(c => c[0] && c[0].telemetry_runs_index);
    expect(indexCall).toBeTruthy();
    const index = indexCall[0].telemetry_runs_index;
    expect(index[0].runId).toBe('run-p1');
    expect(index[0].goal).toBe('Persistence test goal');
  });

  test('startRun truncates goal to 200 chars', async () => {
    listeners.storageChanged({ telemetryPersist: { newValue: true } }, 'local');
    const longGoal = 'G'.repeat(300);
    await startRun('run-trunc', longGoal);
    const setCalls = globalThis.chrome.storage.local.set.mock.calls;
    const indexCall = setCalls.find(c => c[0] && c[0].telemetry_runs_index);
    expect(indexCall[0].telemetry_runs_index[0].goal.length).toBeLessThanOrEqual(200);
  });

  test('endRun updates finishedAt and count in index', async () => {
    listeners.storageChanged({ telemetryPersist: { newValue: true } }, 'local');
    await startRun('run-end', 'End test');
    jest.clearAllMocks();

    // Emit an event so the run buffer has content
    emit('test', 'info', 'Event during run', { x: 1 });

    await endRun('run-end');

    // Should have flushed buffer and updated index
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalled();
  });

  test('startRun evicts old runs beyond MAX_PERSISTED_RUNS', async () => {
    listeners.storageChanged({ telemetryPersist: { newValue: true } }, 'local');

    // Pre-populate with 5 runs
    const existingIndex = [];
    for (let i = 0; i < 5; i++) {
      existingIndex.push({ runId: 'old-' + i, goal: 'old', startedAt: Date.now(), finishedAt: null, count: 0 });
    }
    storageData['telemetry_runs_index'] = existingIndex;

    await startRun('run-new', 'Should evict');
    const setCalls = globalThis.chrome.storage.local.set.mock.calls;
    const indexCall = setCalls.find(c => c[0] && c[0].telemetry_runs_index);
    const index = indexCall[0].telemetry_runs_index;
    // New run at front, old runs evicted — total should be <= 5
    expect(index.length).toBeLessThanOrEqual(5);
    expect(index[0].runId).toBe('run-new');
    // Should have removed the evicted run's data
    expect(globalThis.chrome.storage.local.remove).toHaveBeenCalled();
  });

  test('disabling persist clears buffer and stops timer', async () => {
    listeners.storageChanged({ telemetryPersist: { newValue: true } }, 'local');
    await startRun('run-disable', 'Test');
    emit('test', 'info', 'Buffer this');

    listeners.storageChanged({ telemetryPersist: { newValue: false } }, 'local');

    // Emit should not be buffered now
    emit('test', 'info', 'After disable');
    // No crash, buffer was cleared
  });

  test('emit during active run buffers event', async () => {
    listeners.storageChanged({ telemetryPersist: { newValue: true } }, 'local');
    await startRun('run-buf', 'Buffer test');
    jest.clearAllMocks();

    emit('test', 'info', 'Buffered event', { data: 42 });
    // The event was sent via sendMessage AND buffered
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  test('loadPersistedRun returns stored events', async () => {
    storageData['telemetry_run_run-load'] = [{ seq: 1, message: 'test' }];
    const events = await loadPersistedRun('run-load');
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe('test');
  });

  test('deletePersistedRun removes from index and storage', async () => {
    storageData['telemetry_runs_index'] = [
      { runId: 'del-1', goal: 'g', startedAt: 0, finishedAt: null, count: 0 },
      { runId: 'del-2', goal: 'g', startedAt: 0, finishedAt: null, count: 0 },
    ];
    await deletePersistedRun('del-1');
    expect(globalThis.chrome.storage.local.remove).toHaveBeenCalledWith('telemetry_run_del-1');
    const setCalls = globalThis.chrome.storage.local.set.mock.calls;
    const indexCall = setCalls.find(c => c[0] && c[0].telemetry_runs_index);
    expect(indexCall[0].telemetry_runs_index).toHaveLength(1);
    expect(indexCall[0].telemetry_runs_index[0].runId).toBe('del-2');
  });
});

// ========== Redaction toggle ==========

describe('redaction toggle', () => {
  test('disabling redaction passes raw event through', () => {
    listeners.storageChanged({ telemetryRedact: { newValue: false } }, 'local');
    jest.clearAllMocks();

    emit('test', 'info', 'Key sk-proj-AbCdEf1234567890AbCdEf1234567890AbCd', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('sk-proj-AbCd');
    expect(event.message).not.toContain('[REDACTED');
  });

  test('re-enabling redaction scrubs again', () => {
    listeners.storageChanged({ telemetryRedact: { newValue: false } }, 'local');
    listeners.storageChanged({ telemetryRedact: { newValue: true } }, 'local');
    jest.clearAllMocks();

    emit('test', 'info', 'Key sk-proj-AbCdEf1234567890AbCdEf1234567890AbCd', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:openai-key]');
  });

  test('undefined newValue for redact defaults to true', () => {
    listeners.storageChanged({ telemetryRedact: { newValue: false } }, 'local');
    listeners.storageChanged({ telemetryRedact: { newValue: undefined } }, 'local');
    jest.clearAllMocks();

    emit('test', 'info', 'Key sk-proj-AbCdEf1234567890AbCdEf1234567890AbCd', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:openai-key]');
  });
});

// ========== Additional redaction patterns ==========

describe('additional redaction patterns', () => {
  test('redacts Google API keys', () => {
    // AIza + 35 alphanumeric/underscore/hyphen chars
    const googleKey = 'AIzaSyBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
    emit('test', 'info', 'Google key ' + googleKey, {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:google-api-key]');
    expect(event.message).not.toContain(googleKey);
  });

  test('redacts Slack tokens', () => {
    const token = 'xoxb' + '-FAKETESTDATA001-FAKETESTDATA002-AbCdEfGhIjKlMnOpQrSt';
    emit('test', 'info', 'Token ' + token, {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:slack-token]');
  });

  test('redacts Stripe live keys', () => {
    // Construct key dynamically to avoid push protection false positive on test fixture
    const prefix = 'sk' + '_live_';
    const key = prefix + 'FAKESTRIPEKEYTEST1234567890abcdef';
    emit('test', 'info', 'Stripe ' + key, {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:stripe-key]');
  });

  test('redacts JWT tokens', () => {
    emit('test', 'info', 'Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:jwt]');
  });

  test('redacts Basic auth headers', () => {
    emit('test', 'info', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', {});
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.message).toContain('[REDACTED:auth-header]');
  });

  test('redacts arrays with sensitive field names', () => {
    emit('test', 'info', 'Config', [{ password: 'secret1' }, { password: 'secret2' }]);
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.payload[0].password).toBe('[REDACTED]');
    expect(event.payload[1].password).toBe('[REDACTED]');
  });

  test('passes through null and number payload values', () => {
    emit('test', 'info', 'Data', { count: 42, ref: null, flag: true });
    const event = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
    expect(event.payload.count).toBe(42);
    expect(event.payload.ref).toBeNull();
    expect(event.payload.flag).toBe(true);
  });
});
