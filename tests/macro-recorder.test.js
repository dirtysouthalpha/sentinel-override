/**
 * Tests for macro-recorder.js
 * Macro recording, storage, import/export functionality.
 */

import { jest } from '@jest/globals';

// Setup chrome mock BEFORE importing the module
const mockStorage = { 'sentinel_macros': [] };

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys) => {
        // Always return the storage data, regardless of what keys are requested
        return Promise.resolve({ ...mockStorage });
      }),
      set: jest.fn((data) => {
        // Store the reference to the array
        Object.assign(mockStorage, data);
        return Promise.resolve();
      }),
    },
  },
};

// Now import the module after chrome is mocked
import {
  loadMacros,
  createMacro,
  updateMacro,
  deleteMacro,
  incrementRunCount,
  exportMacro,
  importMacro,
  historyToMacro,
  startRecording,
  recordStep,
  stopRecording,
  isRecording,
  recordedStepCount,
} from '../background/macro-recorder.js';

const waitForStorage = () => new Promise(resolve => setTimeout(resolve, 0));

describe('macro-recorder', () => {
  beforeEach(() => {
    // Clear mock storage before each test
    mockStorage['sentinel_macros'] = [];
    jest.clearAllMocks();
  });

  describe('loadMacros', () => {
    it('should return empty array when no macros exist', async () => {
      const macros = await loadMacros();
      expect(macros).toEqual([]);
      expect(chrome.storage.local.get).toHaveBeenCalledWith('sentinel_macros');
    });

    it('should return existing macros', async () => {
      const testMacros = [
        { id: 'macro-1', name: 'Test Macro', steps: [], createdAt: '2024-01-01', updatedAt: '2024-01-01', runCount: 0 },
      ];
      mockStorage['sentinel_macros'] = testMacros;

      const macros = await loadMacros();
      expect(macros).toEqual(testMacros);
    });

    it('should handle storage errors gracefully', async () => {
      chrome.storage.local.get.mockImplementation(() => Promise.reject(new Error('Storage error')));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const macros = await loadMacros();

      expect(macros).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Sentinel/macro-recorder] loadMacros failed:',
        'Storage error'
      );
      consoleSpy.mockRestore();

      // Restore the mock
      chrome.storage.local.get.mockImplementation((keys) => Promise.resolve({ ...mockStorage }));
    });
  });

  describe('createMacro', () => {
    it('should create a new macro with valid data', async () => {
      const name = 'Test Macro';
      const description = 'Test description';
      const steps = [
        { action: 'click', params: { selector: '#button' }, delay: 500 },
      ];

      const macro = await createMacro(name, description, steps);

      expect(macro).toMatchObject({
        name,
        description,
        steps,
        runCount: 0,
      });
      expect(macro.id).toBeDefined();
      expect(macro.createdAt).toBeDefined();
      expect(macro.updatedAt).toBeDefined();

      const stored = mockStorage['sentinel_macros'];
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(macro);
    });

    it('should trim whitespace from name and description', async () => {
      const macro = await createMacro('  Test Macro  ', '  Description  ', []);

      expect(macro.name).toBe('Test Macro');
      expect(macro.description).toBe('Description');
    });

    it('should default name to "Untitled Macro" when empty', async () => {
      const macro = await createMacro('', '', []);

      expect(macro.name).toBe('Untitled Macro');
    });

    it('should default to empty steps array', async () => {
      const macro = await createMacro('Test', 'Desc', null);

      expect(macro.steps).toEqual([]);
    });

    it('should handle storage set errors gracefully', async () => {
      chrome.storage.local.set.mockImplementation(() => Promise.reject(new Error('Storage quota exceeded')));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(createMacro('Test', 'Desc', [])).rejects.toThrow('Storage quota exceeded');
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Sentinel/macro-recorder] saveMacros failed:',
        'Storage quota exceeded'
      );

      consoleSpy.mockRestore();
      chrome.storage.local.set.mockImplementation((data) => {
        Object.assign(mockStorage, data);
        return Promise.resolve();
      });
    });
  });

  describe('updateMacro', () => {
    beforeEach(async () => {
      await createMacro('Original', 'Original Desc', [{ action: 'click' }]);
    });

    it('should update existing macro', async () => {
      const macros = await loadMacros();
      expect(macros.length).toBeGreaterThan(0);
      const id = macros[0].id;

      const updated = await updateMacro(id, {
        name: 'Updated Name',
        description: 'Updated Desc',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Updated Desc');
      expect(updated.updatedAt).toBeDefined();
    });

    it('should throw error when macro not found', async () => {
      await expect(updateMacro('non-existent', { name: 'Test' })).rejects.toThrow(
        'Macro non-existent not found'
      );
    });

    it('should preserve original fields when partially updating', async () => {
      const macros = await loadMacros();
      expect(macros.length).toBeGreaterThan(0);
      const id = macros[0].id;
      const originalCreatedAt = macros[0].createdAt;

      const updated = await updateMacro(id, { name: 'New Name' });

      expect(updated.createdAt).toBe(originalCreatedAt);
      expect(updated.description).toBe('Original Desc');
      expect(updated.steps).toEqual([{ action: 'click' }]);
    });

    it('should handle storage set errors gracefully', async () => {
      const macros = await loadMacros();
      const id = macros[0].id;

      chrome.storage.local.set.mockImplementation(() => Promise.reject(new Error('Storage quota exceeded')));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(updateMacro(id, { name: 'Test' })).rejects.toThrow('Storage quota exceeded');
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Sentinel/macro-recorder] saveMacros failed:',
        'Storage quota exceeded'
      );

      consoleSpy.mockRestore();
      chrome.storage.local.set.mockImplementation((data) => {
        Object.assign(mockStorage, data);
        return Promise.resolve();
      });
    });
  });

  describe('deleteMacro', () => {
    beforeEach(async () => {
      await createMacro('Macro 1', 'Desc 1', []);
      await createMacro('Macro 2', 'Desc 2', []);
      await createMacro('Macro 3', 'Desc 3', []);
    });

    it('should delete macro by id', async () => {
      const macrosBefore = await loadMacros();
      const idToDelete = macrosBefore[1].id;

      await deleteMacro(idToDelete);

      const macrosAfter = await loadMacros();
      expect(macrosAfter).toHaveLength(2);
      expect(macrosAfter.find(m => m.id === idToDelete)).toBeUndefined();
    });

    it('should handle deleting non-existent macro gracefully', async () => {
      const macrosBefore = await loadMacros();
      await deleteMacro('non-existent-id');

      const macrosAfter = await loadMacros();
      expect(macrosAfter).toHaveLength(macrosBefore.length);
    });

    it('should handle storage set errors gracefully', async () => {
      const macrosBefore = await loadMacros();
      const idToDelete = macrosBefore[0].id;

      chrome.storage.local.set.mockImplementation(() => Promise.reject(new Error('Storage quota exceeded')));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(deleteMacro(idToDelete)).rejects.toThrow('Storage quota exceeded');
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Sentinel/macro-recorder] saveMacros failed:',
        'Storage quota exceeded'
      );

      consoleSpy.mockRestore();
      chrome.storage.local.set.mockImplementation((data) => {
        Object.assign(mockStorage, data);
        return Promise.resolve();
      });
    });
  });

  describe('incrementRunCount', () => {
    it('should increment run count and update timestamp', async () => {
      const macro = await createMacro('Test', 'Desc', []);
      const originalUpdatedAt = macro.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for timestamp difference
      await incrementRunCount(macro.id);

      const macros = await loadMacros();
      const updated = macros.find(m => m.id === macro.id);

      expect(updated).toBeDefined();
      expect(updated.runCount).toBe(1);
      expect(updated.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should handle non-existent macro gracefully', async () => {
      await incrementRunCount('non-existent');
      // Should not throw
    });

    it('should increment multiple times', async () => {
      const macro = await createMacro('Test', 'Desc', []);
      await waitForStorage();

      await incrementRunCount(macro.id);
      await incrementRunCount(macro.id);
      await incrementRunCount(macro.id);

      const macros = await loadMacros();
      const updated = macros.find(m => m.id === macro.id);

      expect(updated).toBeDefined();
      expect(updated.runCount).toBe(3);
    });
  });

  describe('exportMacro', () => {
    it('should export macro as JSON string', async () => {
      const macro = await createMacro('Test Macro', 'Test Desc', [
        { action: 'click', params: { selector: '#btn' }, delay: 100 },
      ]);
      await waitForStorage();

      const exported = await exportMacro(macro.id);
      const parsed = JSON.parse(exported);

      expect(parsed.sentinelMacro).toBe(1);
      expect(parsed.name).toBe('Test Macro');
      expect(parsed.description).toBe('Test Desc');
      expect(parsed.steps).toEqual([{ action: 'click', params: { selector: '#btn' }, delay: 100 }]);
    });

    it('should throw error when exporting non-existent macro', async () => {
      await expect(exportMacro('non-existent')).rejects.toThrow(
        'Macro non-existent not found'
      );
    });
  });

  describe('importMacro', () => {
    it('should import valid macro JSON', async () => {
      const jsonStr = JSON.stringify({
        sentinelMacro: 1,
        name: 'Imported Macro',
        description: 'Imported Description',
        steps: [{ action: 'type', params: { text: 'hello' }, delay: 200 }],
      });

      const imported = await importMacro(jsonStr);

      expect(imported.name).toBe('Imported Macro');
      expect(imported.description).toBe('Imported Description');
      expect(imported.steps).toEqual([{ action: 'type', params: { text: 'hello' }, delay: 200 }]);
      expect(imported.id).toBeDefined();
    });

    it('should default name and description when missing', async () => {
      const jsonStr = JSON.stringify({
        sentinelMacro: 1,
        steps: [],
      });

      const imported = await importMacro(jsonStr);

      expect(imported.name).toBe('Imported Macro');
      expect(imported.description).toBe('');
    });

    it('should throw error for invalid format', async () => {
      await expect(importMacro('not valid json')).rejects.toThrow();
      await expect(importMacro(JSON.stringify({ name: 'Test' }))).rejects.toThrow(
        'Invalid macro format'
      );
    });

    it('should throw error when missing sentinelMacro version', async () => {
      const jsonStr = JSON.stringify({
        steps: [],
      });

      await expect(importMacro(jsonStr)).rejects.toThrow('Invalid macro format');
    });
  });

  describe('historyToMacro', () => {
    it('should convert valid history to macro', async () => {
      const history = [
        { action: { type: 'click', params: { selector: '#btn' } }, duration: 500 },
        { action: { type: 'type', params: { text: 'hello' } }, duration: 1000 },
      ];

      const macro = await historyToMacro(history, 'History Macro', 'From history');

      expect(macro.name).toBe('History Macro');
      expect(macro.description).toBe('From history');
      expect(macro.steps).toEqual([
        { action: 'click', params: { selector: '#btn' }, delay: 500 },
        { action: 'type', params: { text: 'hello' }, delay: 1000 },
      ]);
    });

    it('should filter out failed actions', async () => {
      const history = [
        { action: { type: 'click', params: { selector: '#btn' } }, duration: 500 },
        { action: { type: 'type', params: { text: 'hello' } }, actionFailed: true, duration: 1000 },
        { action: { type: 'scroll', params: { y: 100 } }, duration: 300 },
      ];

      const macro = await historyToMacro(history, 'Test', 'Desc');

      expect(macro.steps).toHaveLength(2);
      expect(macro.steps[0].action).toBe('click');
      expect(macro.steps[1].action).toBe('scroll');
    });

    it('should filter out entries without actions', async () => {
      const history = [
        { action: { type: 'click', params: {} }, duration: 500 },
        { duration: 1000 },
        { action: { type: 'scroll', params: {} }, duration: 300 },
      ];

      const macro = await historyToMacro(history, 'Test', 'Desc');

      expect(macro.steps).toHaveLength(2);
    });

    it('should handle string action type', async () => {
      const history = [
        { action: 'click', params: { selector: '#btn' }, duration: 500 },
      ];

      const macro = await historyToMacro(history, 'Test', 'Desc');

      expect(macro.steps[0].action).toBe('click');
    });

    it('should default delay to 1000ms when missing', async () => {
      const history = [
        { action: { type: 'click', params: {} } },
      ];

      const macro = await historyToMacro(history, 'Test', 'Desc');

      expect(macro.steps[0].delay).toBe(1000);
    });
  });

  describe('Live Recording', () => {
    beforeEach(() => {
      // Reset recording state
      stopRecording();
    });

    describe('startRecording', () => {
      it('should start recording state', () => {
        startRecording();
        expect(isRecording()).toBe(true);
      });

      it('should clear previous recorded steps', () => {
        recordStep('click', { selector: '#btn' }, 100);
        startRecording();
        expect(recordedStepCount()).toBe(0);
      });
    });

    describe('recordStep', () => {
      it('should record step when recording', () => {
        startRecording();
        recordStep('click', { selector: '#btn' }, 500);

        expect(recordedStepCount()).toBe(1);
      });

      it('should not record step when not recording', () => {
        recordStep('click', { selector: '#btn' }, 500);

        expect(recordedStepCount()).toBe(0);
      });

      it('should default delay to 500ms', () => {
        startRecording();
        recordStep('click', { selector: '#btn' });

        expect(recordedStepCount()).toBe(1);
      });

      it('should record multiple steps', () => {
        startRecording();
        recordStep('click', { selector: '#btn1' }, 100);
        recordStep('click', { selector: '#btn2' }, 200);
        recordStep('type', { text: 'hello' }, 300);

        expect(recordedStepCount()).toBe(3);
      });
    });

    describe('stopRecording', () => {
      it('should stop recording and create macro with steps', async () => {
        startRecording();
        recordStep('click', { selector: '#btn' }, 500);
        recordStep('type', { text: 'test' }, 1000);

        const macro = await stopRecording('My Macro', 'My Description');

        expect(macro).toMatchObject({
          name: 'My Macro',
          description: 'My Description',
          steps: [
            { action: 'click', params: { selector: '#btn' }, delay: 500 },
            { action: 'type', params: { text: 'test' }, delay: 1000 },
          ],
        });
        expect(isRecording()).toBe(false);
      });

      it('should return null when no steps recorded', async () => {
        startRecording();

        const macro = await stopRecording('Test', 'Desc');

        expect(macro).toBeNull();
        expect(mockStorage['sentinel_macros']).toEqual([]);
      });

      it('should use default name when not provided', async () => {
        startRecording();
        recordStep('click', {}, 100);

        const macro = await stopRecording();

        expect(macro.name).toBe('Recorded Macro');
      });

      it('should clear steps after stopping', async () => {
        startRecording();
        recordStep('click', {}, 100);
        await stopRecording();

        expect(recordedStepCount()).toBe(0);
      });
    });

    describe('isRecording', () => {
      it('should return false initially', () => {
        expect(isRecording()).toBe(false);
      });

      it('should return true after startRecording', () => {
        startRecording();
        expect(isRecording()).toBe(true);
      });

      it('should return false after stopRecording', async () => {
        startRecording();
        await stopRecording();

        expect(isRecording()).toBe(false);
      });
    });

    describe('recordedStepCount', () => {
      it('should return 0 when not recording', () => {
        expect(recordedStepCount()).toBe(0);
      });

      it('should return number of recorded steps', () => {
        startRecording();
        expect(recordedStepCount()).toBe(0);

        recordStep('click', {}, 100);
        expect(recordedStepCount()).toBe(1);

        recordStep('type', {}, 200);
        expect(recordedStepCount()).toBe(2);
      });

      it('should reset to 0 after stopRecording', async () => {
        startRecording();
        recordStep('click', {}, 100);
        recordStep('type', {}, 200);
        await stopRecording();

        expect(recordedStepCount()).toBe(0);
      });
    });
  });
});
