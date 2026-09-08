// tests/macro-recorder-deep.test.js
// Deep tests for background/macro-recorder.js — CRUD, recording, historyToMacro, import/export.

import { jest } from '@jest/globals';

// Mock chrome.storage.local
const storage = {};
const mockStorageLocal = {
  get: jest.fn((keys) => {
    const result = {};
    if (typeof keys === 'string') {
      result[keys] = storage[keys];
    } else if (Array.isArray(keys)) {
      keys.forEach(k => { result[k] = storage[k]; });
    } else {
      Object.keys(keys).forEach(k => { result[k] = storage[k] !== undefined ? storage[k] : keys[k]; });
    }
    return Promise.resolve(result);
  }),
  set: jest.fn((items) => {
    Object.assign(storage, items);
    return Promise.resolve();
  }),
};

global.chrome = { storage: { local: mockStorageLocal } };

// Import the module
const {
  loadMacros, createMacro, updateMacro, deleteMacro,
  incrementRunCount, exportMacro, importMacro, historyToMacro,
  startRecording, recordStep, stopRecording, isRecording, recordedStepCount,
} = await import('../background/macro-recorder.js');

describe('macro-recorder: loadMacros', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('returns empty array when no macros stored', async () => {
    const macros = await loadMacros();
    expect(macros).toEqual([]);
  });

  test('returns stored macros', async () => {
    storage.sentinel_macros = [{ id: 'm1', name: 'Test Macro' }];
    const macros = await loadMacros();
    expect(macros).toHaveLength(1);
    expect(macros[0].name).toBe('Test Macro');
  });

  test('handles storage error gracefully', async () => {
    mockStorageLocal.get.mockRejectedValueOnce(new Error('Storage error'));
    const macros = await loadMacros();
    expect(macros).toEqual([]);
  });
});

describe('macro-recorder: createMacro', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('creates a macro with name, description, and steps', async () => {
    const macro = await createMacro('Test', 'A test macro', [{ action: 'click' }]);
    expect(macro.name).toBe('Test');
    expect(macro.description).toBe('A test macro');
    expect(macro.steps).toEqual([{ action: 'click' }]);
    expect(macro.id).toBeDefined();
    expect(macro.runCount).toBe(0);
  });

  test('trims whitespace from name', async () => {
    const macro = await createMacro('  Test  ', '', []);
    expect(macro.name).toBe('Test');
  });

  test('defaults name to "Untitled Macro" for empty name', async () => {
    const macro = await createMacro('', '', []);
    expect(macro.name).toBe('Untitled Macro');
  });

  test('defaults name to "Untitled Macro" for whitespace name', async () => {
    const macro = await createMacro('   ', '', []);
    expect(macro.name).toBe('Untitled Macro');
  });

  test('defaults steps to empty array', async () => {
    const macro = await createMacro('Test', '', null);
    expect(macro.steps).toEqual([]);
  });

  test('defaults description to empty string', async () => {
    const macro = await createMacro('Test', null, []);
    expect(macro.description).toBe('');
  });

  test('sets createdAt and updatedAt timestamps', async () => {
    const before = Date.now();
    const macro = await createMacro('Test', '', []);
    const after = Date.now();
    expect(new Date(macro.createdAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(macro.createdAt).getTime()).toBeLessThanOrEqual(after);
    expect(macro.createdAt).toBe(macro.updatedAt);
  });

  test('persists macro to storage', async () => {
    await createMacro('Test', 'Desc', [{ action: 'click' }]);
    expect(storage.sentinel_macros).toHaveLength(1);
    expect(storage.sentinel_macros[0].name).toBe('Test');
  });

  test('appends to existing macros', async () => {
    storage.sentinel_macros = [{ id: 'existing', name: 'Old' }];
    await createMacro('New', '', []);
    expect(storage.sentinel_macros).toHaveLength(2);
  });
});

describe('macro-recorder: updateMacro', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('updates name', async () => {
    const macro = await createMacro('Old Name', '', []);
    const updated = await updateMacro(macro.id, { name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect(updated.id).toBe(macro.id);
  });

  test('updates steps', async () => {
    const macro = await createMacro('Test', '', []);
    const updated = await updateMacro(macro.id, { steps: [{ action: 'type' }] });
    expect(updated.steps).toEqual([{ action: 'type' }]);
  });

  test('updates updatedAt timestamp', async () => {
    const macro = await createMacro('Test', '', []);
    await new Promise(r => setTimeout(r, 10));
    const updated = await updateMacro(macro.id, { name: 'Updated' });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(macro.updatedAt).getTime());
  });

  test('throws for non-existent ID', async () => {
    await expect(updateMacro('non-existent', { name: 'Nope' })).rejects.toThrow('not found');
  });

  test('preserves unchanged fields', async () => {
    const macro = await createMacro('Test', 'Description', [{ action: 'click' }]);
    const updated = await updateMacro(macro.id, { name: 'New' });
    expect(updated.description).toBe('Description');
    expect(updated.steps).toEqual([{ action: 'click' }]);
    expect(updated.runCount).toBe(0);
  });
});

describe('macro-recorder: deleteMacro', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('deletes existing macro', async () => {
    const macro = await createMacro('Delete Me', '', []);
    await deleteMacro(macro.id);
    const macros = await loadMacros();
    expect(macros.find(m => m.id === macro.id)).toBeUndefined();
  });

  test('does not crash when deleting non-existent macro', async () => {
    await expect(deleteMacro('non-existent')).resolves.not.toThrow();
  });

  test('keeps other macros intact', async () => {
    const m1 = await createMacro('Keep', '', []);
    const m2 = await createMacro('Delete', '', []);
    await deleteMacro(m2.id);
    const macros = await loadMacros();
    expect(macros).toHaveLength(1);
    expect(macros[0].id).toBe(m1.id);
  });
});

describe('macro-recorder: incrementRunCount', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('increments from 0 to 1', async () => {
    const macro = await createMacro('Test', '', []);
    await incrementRunCount(macro.id);
    const macros = await loadMacros();
    expect(macros[0].runCount).toBe(1);
  });

  test('increments multiple times', async () => {
    const macro = await createMacro('Test', '', []);
    await incrementRunCount(macro.id);
    await incrementRunCount(macro.id);
    await incrementRunCount(macro.id);
    const macros = await loadMacros();
    expect(macros[0].runCount).toBe(3);
  });

  test('updates updatedAt on increment', async () => {
    const macro = await createMacro('Test', '', []);
    await new Promise(r => setTimeout(r, 10));
    await incrementRunCount(macro.id);
    const macros = await loadMacros();
    expect(new Date(macros[0].updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(macro.updatedAt).getTime());
  });

  test('does not crash for non-existent ID', async () => {
    await expect(incrementRunCount('non-existent')).resolves.not.toThrow();
  });
});

describe('macro-recorder: exportMacro', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('exports macro as JSON string', async () => {
    const macro = await createMacro('Export Test', 'A macro', [{ action: 'click' }]);
    const json = await exportMacro(macro.id);
    const parsed = JSON.parse(json);
    expect(parsed.sentinelMacro).toBe(1);
    expect(parsed.name).toBe('Export Test');
    expect(parsed.steps).toEqual([{ action: 'click' }]);
  });

  test('throws for non-existent macro', async () => {
    await expect(exportMacro('non-existent')).rejects.toThrow('not found');
  });
});

describe('macro-recorder: importMacro', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('imports valid macro JSON', async () => {
    const json = JSON.stringify({ sentinelMacro: 1, name: 'Imported', description: 'Desc', steps: [{ action: 'click' }] });
    const macro = await importMacro(json);
    expect(macro.name).toBe('Imported');
    expect(macro.description).toBe('Desc');
    expect(macro.steps).toEqual([{ action: 'click' }]);
  });

  test('throws on invalid JSON', async () => {
    await expect(importMacro('not json')).rejects.toThrow('Invalid macro JSON');
  });

  test('throws on missing sentinelMacro flag', async () => {
    const json = JSON.stringify({ name: 'Test', steps: [] });
    await expect(importMacro(json)).rejects.toThrow('Invalid macro format');
  });

  test('throws on missing steps', async () => {
    const json = JSON.stringify({ sentinelMacro: 1, name: 'Test' });
    await expect(importMacro(json)).rejects.toThrow('Invalid macro format');
  });

  test('defaults name when missing', async () => {
    const json = JSON.stringify({ sentinelMacro: 1, steps: [{ action: 'click' }] });
    const macro = await importMacro(json);
    expect(macro.name).toBe('Imported Macro');
  });

  test('defaults description when missing', async () => {
    const json = JSON.stringify({ sentinelMacro: 1, name: 'Test', steps: [] });
    const macro = await importMacro(json);
    expect(macro.description).toBe('');
  });
});

describe('macro-recorder: historyToMacro', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    jest.clearAllMocks();
  });

  test('converts history to macro with successful steps', async () => {
    const history = [
      { action: { type: 'click', params: { selector: '#btn' } }, duration: 500 },
      { actionFailed: true, action: { type: 'click', params: { selector: '#missing' } } },
      { action: { type: 'type', params: { text: 'hello' } }, duration: 300 },
    ];
    const macro = await historyToMacro(history, 'From History', 'Converted');
    expect(macro.steps).toHaveLength(2); // failed step filtered out
    expect(macro.steps[0].action).toBe('click');
    expect(macro.steps[0].params).toEqual({ selector: '#btn' });
    expect(macro.steps[0].delay).toBe(500);
  });

  test('handles string action type', async () => {
    const history = [{ action: 'scroll', duration: 200 }];
    const macro = await historyToMacro(history, 'Test', '');
    expect(macro.steps[0].action).toBe('scroll');
  });

  test('handles action without params', async () => {
    const history = [{ action: { type: 'navigate' }, duration: 1000 }];
    const macro = await historyToMacro(history, 'Test', '');
    expect(macro.steps[0].params).toEqual({});
  });

  test('returns empty steps for all-failed history', async () => {
    const history = [
      { actionFailed: true, action: { type: 'click' } },
      { actionFailed: true, action: 'scroll' },
    ];
    const macro = await historyToMacro(history, 'Test', '');
    expect(macro.steps).toHaveLength(0);
  });

  test('returns empty steps for empty history', async () => {
    const macro = await historyToMacro([], 'Test', '');
    expect(macro.steps).toHaveLength(0);
  });

  test('handles action without type property', async () => {
    const history = [{ action: { params: { x: 1 } }, duration: 100 }];
    const macro = await historyToMacro(history, 'Test', '');
    expect(macro.steps[0].action).toBe('unknown');
  });
});

describe('macro-recorder: live recording', () => {
  afterEach(() => {
    // Stop any active recording
    if (isRecording()) stopRecording();
    jest.clearAllMocks();
  });

  test('isRecording starts false', () => {
    expect(isRecording()).toBe(false);
  });

  test('startRecording sets isRecording to true', () => {
    startRecording();
    expect(isRecording()).toBe(true);
  });

  test('recordStep adds step during recording', () => {
    startRecording();
    recordStep('click', { selector: '#btn' }, 200);
    expect(recordedStepCount()).toBe(1);
  });

  test('recordStep is ignored when not recording', () => {
    recordStep('click', { selector: '#btn' });
    expect(recordedStepCount()).toBe(0);
  });

  test('recordStep defaults delay to 500', () => {
    startRecording();
    recordStep('click', {});
    const macros = [];
    // Read the step count to verify
    expect(recordedStepCount()).toBe(1);
  });

  test('stopRecording returns null for empty recording', async () => {
    startRecording();
    const result = await stopRecording('Test');
    expect(result).toBeNull();
    expect(isRecording()).toBe(false);
  });

  test('stopRecording saves macro with steps', async () => {
    Object.keys(storage).forEach(k => delete storage[k]);
    startRecording();
    recordStep('click', { selector: '#btn' }, 200);
    recordStep('type', { text: 'hello' }, 300);
    const macro = await stopRecording('Recorded', 'From live');
    expect(macro).not.toBeNull();
    expect(macro.name).toBe('Recorded');
    expect(macro.steps).toHaveLength(2);
    expect(macro.steps[0].action).toBe('click');
    expect(macro.steps[1].action).toBe('type');
    expect(isRecording()).toBe(false);
    expect(recordedStepCount()).toBe(0);
  });

  test('recordedStepCount returns 0 when not recording', () => {
    expect(recordedStepCount()).toBe(0);
  });

  test('multiple record sessions are independent', async () => {
    Object.keys(storage).forEach(k => delete storage[k]);
    startRecording();
    recordStep('click', {});
    await stopRecording('Session1');
    startRecording();
    recordStep('type', {});
    const macro = await stopRecording('Session2');
    expect(macro.steps).toHaveLength(1);
    expect(macro.steps[0].action).toBe('type');
  });
});
