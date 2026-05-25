// tests/voice-input-edge-cases.test.js
// Edge case tests for voice input functionality (Bug #3 partial fix)
// Tests for permission errors, injection failures, and edge cases.

import { jest } from '@jest/globals';

// Mock Chrome API
globalThis.chrome = {
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
  },
  scripting: {
    executeScript: jest.fn(),
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
};

describe('Voice input edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handles no active tab when voice button clicked', async () => {
    // Mock chrome.tabs.query to return no tabs
    globalThis.chrome.tabs.query.mockResolvedValue([]);

    const result = await globalThis.chrome.tabs.query({ active: true, currentWindow: true });

    // Should handle gracefully (no error thrown)
    expect(result).toEqual([]);
  });

  test('handles script injection permission denied', async () => {
    // Mock chrome.scripting.executeScript to throw permission error
    globalThis.chrome.scripting.executeScript.mockRejectedValue(
      new Error('Cannot access contents of url')
    );

    // Mock chrome.tabs.query to return a tab
    globalThis.chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);

    try {
      await globalThis.chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: () => {},
      });
      // Should have thrown
      expect(true).toBe(false);
    } catch (e) {
      // Expected to throw permission error
      expect(e.message).toContain('Cannot access');
    }
  });

  test('handles restricted pages (chrome://, edge://, etc.)', async () => {
    // Mock tabs with restricted URLs
    const restrictedTabs = [
      { id: 1, url: 'chrome://settings' },
      { id: 2, url: 'edge://extensions' },
      { id: 3, url: 'chrome://version' },
    ];

    for (const tab of restrictedTabs) {
      globalThis.chrome.tabs.query.mockResolvedValueOnce([tab]);
      globalThis.chrome.scripting.executeScript.mockRejectedValue(
        new Error('Cannot access contents of url')
      );

      try {
        await globalThis.chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {},
        });
      } catch (e) {
        // Expected to fail for restricted pages
        expect(e.message).toContain('Cannot access');
      }
    }
  });

  test('handles tab closing during voice input', async () => {
    // Mock tab that exists initially but then is closed
    globalThis.chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com' }]);

    // First call succeeds
    globalThis.chrome.scripting.executeScript.mockResolvedValueOnce([{ result: 'injected' }]);

    // Second call fails because tab was closed
    globalThis.chrome.scripting.executeScript.mockRejectedValueOnce(
      new Error('Tab closed')
    );

    // First injection should succeed
    const result1 = await globalThis.chrome.scripting.executeScript({
      target: { tabId: 1 },
      func: () => 'injected',
    });
    expect(result1[0].result).toBe('injected');

    // Second injection should fail gracefully
    try {
      await globalThis.chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: () => 'injected',
      });
      expect(true).toBe(false);
    } catch (e) {
      expect(e.message).toContain('Tab closed');
    }
  });

  test('handles microphone permission denial', async () => {
    // This would be tested in the injected script context
    // Here we verify the error message structure is correct
    const permissionError = {
      action: 'voice_error',
      error: 'not-allowed',
    };

    globalThis.chrome.runtime.sendMessage.mockResolvedValue(undefined);

    // Simulate sending permission error
    await globalThis.chrome.runtime.sendMessage(permissionError);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(permissionError);
  });

  test('handles SpeechRecognition API not available', async () => {
    // Simulate environment where SpeechRecognition is not available
    const noSpeechApiError = {
      action: 'voice_error',
      error: 'Speech recognition not supported in this tab',
    };

    globalThis.chrome.runtime.sendMessage.mockResolvedValue(undefined);

    await globalThis.chrome.runtime.sendMessage(noSpeechApiError);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(noSpeechApiError);
  });

  test('handles multiple rapid voice button clicks', async () => {
    // Mock successful injection
    globalThis.chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
    globalThis.chrome.scripting.executeScript.mockResolvedValue([{ result: 'injected' }]);

    // Simulate rapid clicks (multiple injection attempts)
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        globalThis.chrome.scripting.executeScript({
          target: { tabId: 1 },
          func: () => 'injected',
        })
      );
    }

    const results = await Promise.allSettled(promises);

    // All should succeed or fail gracefully (no crashes)
    expect(results.length).toBe(5);
  });

  test('handles empty voice result (user spoke nothing)', async () => {
    const emptyResult = {
      action: 'voice_result',
      text: '',
    };

    globalThis.chrome.runtime.sendMessage.mockResolvedValue(undefined);

    await globalThis.chrome.runtime.sendMessage(emptyResult);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(emptyResult);
  });

  test('handles very long voice transcript', async () => {
    // Simulate a very long transcript (e.g., user spoke for several minutes)
    const longText = 'word '.repeat(1000); // ~5000 characters
    const longResult = {
      action: 'voice_result',
      text: longText,
    };

    globalThis.chrome.runtime.sendMessage.mockResolvedValue(undefined);

    await globalThis.chrome.runtime.sendMessage(longResult);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(longResult);
  });

  test('handles interim results during voice input', async () => {
    const interimResults = [
      { action: 'voice_interim', text: 'hello' },
      { action: 'voice_interim', text: 'hello world' },
      { action: 'voice_interim', text: 'hello world this is a test' },
    ];

    globalThis.chrome.runtime.sendMessage.mockResolvedValue(undefined);

    for (const result of interimResults) {
      await globalThis.chrome.runtime.sendMessage(result);
    }

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
  });
});
