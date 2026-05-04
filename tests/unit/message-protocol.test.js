// Sentinel Override v3 -- Unit tests for message-protocol.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';
import { sendMessage, sendRuntimeMessage, wrapMessageHandler, sendSilentUpdate, sendActionMessage, sendActionResult, sendTabStateUpdate } from '../../background/message-protocol.js';

describe('message-protocol', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
    chromeMock.runtime.lastError = null;
  });

  describe('sendMessage', () => {
    it('resolves with response.data on success', async () => {
      const testData = { ok: true, data: { result: 'hello' } };
      chromeMock.tabs.sendMessage = vi.fn((tabId, msg, cb) => {
        setTimeout(() => cb(testData), 0);
      });

      const result = await sendMessage(1, { action: 'test' });
      expect(result).toEqual({ result: 'hello' });
    });

    it('rejects when response.ok is false', async () => {
      const errorResponse = { ok: false, error: 'Something went wrong' };
      chromeMock.tabs.sendMessage = vi.fn((tabId, msg, cb) => {
        setTimeout(() => cb(errorResponse), 0);
      });

      await expect(sendMessage(1, { action: 'test' }))
        .rejects.toThrow('Something went wrong');
    });

    it('rejects when response is null', async () => {
      chromeMock.tabs.sendMessage = vi.fn((tabId, msg, cb) => {
        setTimeout(() => cb(null), 0);
      });

      await expect(sendMessage(1, { action: 'test' }))
        .rejects.toThrow('No response from content script');
    });

    it('rejects on chrome.runtime.lastError', async () => {
      chromeMock.runtime.lastError = { message: 'Tab not found' };
      chromeMock.tabs.sendMessage = vi.fn((tabId, msg, cb) => {
        setTimeout(() => cb(undefined), 0);
      });

      await expect(sendMessage(999, { action: 'test' }))
        .rejects.toThrow('Tab not found');
    });

    it('rejects on timeout', async () => {
      vi.useFakeTimers();
      chromeMock.tabs.sendMessage = vi.fn(() => {
        // Never calls callback -- simulates timeout
      });

      const promise = sendMessage(1, { action: 'test' }, 100);

      // Catch the rejection immediately to prevent unhandled rejection warning
      let caughtError = null;
      promise.catch(e => { caughtError = e; });

      await vi.advanceTimersByTimeAsync(150);
      // Give microtask queue time to process
      await vi.runAllTimersAsync();

      expect(caughtError).toBeDefined();
      expect(caughtError.message).toContain('timed out');
      vi.useRealTimers();
    });

    it('resolves with full response when response.data is undefined', async () => {
      const testResponse = { ok: true, someField: 'value' };
      chromeMock.tabs.sendMessage = vi.fn((tabId, msg, cb) => {
        setTimeout(() => cb(testResponse), 0);
      });

      const result = await sendMessage(1, { action: 'test' });
      expect(result).toEqual(testResponse);
    });
  });

  describe('sendRuntimeMessage', () => {
    it('resolves with response on success', async () => {
      const testData = { result: 'success' };
      chromeMock.runtime.sendMessage = vi.fn((msg, cb) => {
        setTimeout(() => cb(testData), 0);
      });

      const result = await sendRuntimeMessage({ action: 'test' });
      expect(result).toEqual(testData);
    });

    it('rejects on chrome.runtime.lastError', async () => {
      chromeMock.runtime.lastError = { message: 'Extension context invalidated' };
      chromeMock.runtime.sendMessage = vi.fn((msg, cb) => {
        setTimeout(() => cb(undefined), 0);
      });

      await expect(sendRuntimeMessage({ action: 'test' }))
        .rejects.toThrow('Extension context invalidated');
    });
  });

  describe('wrapMessageHandler', () => {
    it('returns { ok: true, data } for successful handler', async () => {
      const handler = vi.fn().mockResolvedValue({ value: 42 });
      const wrapped = wrapMessageHandler(handler);

      const sendResponse = vi.fn();
      const result = wrapped({ data: 'test' }, {}, sendResponse);

      expect(result).toBe(true); // keeps message channel open
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { value: 42 } });
    });

    it('returns { ok: false, error } for handler that throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const wrapped = wrapMessageHandler(handler);

      const sendResponse = vi.fn();
      wrapped({ data: 'test' }, {}, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Handler failed' });
    });

    it('handles handler that returns rejected promise', async () => {
      // wrapMessageHandler chains .then/.catch on the handler return value
      // A sync throw from a non-async handler propagates uncaught (not caught by .catch)
      // The production usage always passes async handlers, so test that pattern
      const handler = vi.fn(async () => { throw new Error('Async error'); });
      const wrapped = wrapMessageHandler(handler);

      const sendResponse = vi.fn();
      wrapped({ data: 'test' }, {}, sendResponse);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Async error' });
    });
  });

  describe('sendSilentUpdate', () => {
    it('calls chrome.runtime.sendMessage with correct shape', () => {
      chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve());

      sendSilentUpdate('Loading page...', 5);

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'agent_update',
        text: 'Loading page...',
        stepNumber: 5,
        silent: true,
      });
    });

    it('defaults stepNumber to 0', () => {
      chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve());

      sendSilentUpdate('Starting...');

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'agent_update',
        text: 'Starting...',
        stepNumber: 0,
        silent: true,
      });
    });
  });

  describe('sendActionMessage', () => {
    it('builds click description from elements', () => {
      chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve());

      const command = { type: 'click', selector: '#submit-btn' };
      const observation = {
        elements: [{ selector: '#submit-btn', text: 'Submit Form' }],
      };

      sendActionMessage(command, 3, observation);

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'agent_action',
          payload: expect.objectContaining({
            type: 'click',
            description: expect.stringContaining('Submit Form'),
          }),
        })
      );
    });

    it('builds navigate description from URL', () => {
      chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve());

      const command = { type: 'navigate', url: 'https://example.com/page' };

      sendActionMessage(command, 1);

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'navigate',
            description: expect.stringContaining('example.com'),
          }),
        })
      );
    });
  });

  describe('sendActionResult', () => {
    it('sends action result with string result', () => {
      chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve());

      sendActionResult(3, 'Click succeeded', false);

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'agent_action_result',
        stepNumber: 3,
        result: 'Click succeeded',
        isError: false,
      });
    });

    it('truncates long results to 120 chars', () => {
      chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve());

      const longResult = 'A'.repeat(200);
      sendActionResult(1, longResult, true);

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'A'.repeat(120),
          isError: true,
        })
      );
    });
  });

  describe('sendTabStateUpdate', () => {
    it('sends sanitized tab state', () => {
      chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve());

      const tabs = [
        { tabId: 1, label: 'Main', url: 'https://example.com', isActive: true, extra: 'ignored' },
        { tabId: 2, label: 'Logs', url: 'https://logs.example.com', isActive: false },
      ];

      sendTabStateUpdate(tabs);

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'tab_state_update',
        tabs: [
          { tabId: 1, label: 'Main', url: 'https://example.com', isActive: true },
          { tabId: 2, label: 'Logs', url: 'https://logs.example.com', isActive: false },
        ],
      });
    });
  });
});
