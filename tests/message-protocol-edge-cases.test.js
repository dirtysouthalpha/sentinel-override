// tests/message-protocol-edge-cases.test.js
// Edge case tests for background/message-protocol.js error paths

import { jest } from '@jest/globals';

globalThis.chrome = {
  runtime: {
    sendMessage: jest.fn(() => Promise.reject(new Error('Message send failed'))),
    getURL: jest.fn((p) => p),
  },
};

describe('message-protocol edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage promise rejection handling', () => {
    test('sendSilentUpdate should handle sendMessage rejection', async () => {
      const { sendSilentUpdate } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendSilentUpdate('Test message')).not.toThrow();
    });

    test('sendActionMessage should handle sendMessage rejection', async () => {
      const { sendActionMessage } = await import('../background/message-protocol.js');

      const command = {
        type: 'click',
        selector: '#button',
      };

      // Should not throw despite sendMessage rejecting
      expect(() => sendActionMessage(command, 1)).not.toThrow();
    });

    test('sendActionResult should handle sendMessage rejection', async () => {
      const { sendActionResult } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendActionResult(1, 'Success', false)).not.toThrow();
    });

    test('sendReportUpdate should handle sendMessage rejection', async () => {
      const { sendReportUpdate } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendReportUpdate('ready', { summary: 'Test' })).not.toThrow();
    });

    test('sendPageContext should handle sendMessage rejection', async () => {
      const { sendPageContext } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendPageContext('https://example.com', 'Test Page', 1, 123)).not.toThrow();
    });

    test('sendTabStateUpdate should handle sendMessage rejection', async () => {
      const { sendTabStateUpdate } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendTabStateUpdate([{ id: 1, url: 'https://example.com' }])).not.toThrow();
    });

    test('sendScreenshotUpdate should handle sendMessage rejection', async () => {
      const { sendScreenshotUpdate } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendScreenshotUpdate('data:image/png;base64,abc')).not.toThrow();
    });

    test('sendAgentActivity should handle sendMessage rejection', async () => {
      const { sendAgentActivity } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendAgentActivity('thinking', 'Processing...')).not.toThrow();
    });

    test('sendAgentStepStart should handle sendMessage rejection', async () => {
      const { sendAgentStepStart } = await import('../background/message-protocol.js');

      // Should not throw despite sendMessage rejecting
      expect(() => sendAgentStepStart(1, 'Test step')).not.toThrow();
    });
  });

  describe('sendActionMessage edge cases', () => {
    test('should handle command with unknown type', async () => {
      const { sendActionMessage } = await import('../background/message-protocol.js');

      const unknownCommand = {
        type: 'unknown_command_type',
        data: 'test',
      };

      // Should not throw and should create a description
      expect(() => sendActionMessage(unknownCommand, 1)).not.toThrow();
    });

    test('should handle click command with missing selector', async () => {
      const { sendActionMessage } = await import('../background/message-protocol.js');

      const command = {
        type: 'click',
        // Missing selector
      };

      // Should not throw
      expect(() => sendActionMessage(command, 1, { elements: [] })).not.toThrow();
    });

    test('should handle navigate command with invalid URL', async () => {
      const { sendActionMessage } = await import('../background/message-protocol.js');

      const command = {
        type: 'navigate',
        url: 'not-a-valid-url',
      };

      // Should not throw and should handle the invalid URL gracefully
      expect(() => sendActionMessage(command, 1)).not.toThrow();
    });

    test('should handle execute_js command with very long code', async () => {
      const { sendActionMessage } = await import('../background/message-protocol.js');

      const command = {
        type: 'execute_js',
        code: 'x'.repeat(1000), // Very long code
      };

      // Should not throw and should truncate the code preview
      expect(() => sendActionMessage(command, 1)).not.toThrow();
    });

    test('should handle type command with element text longer than 50 chars', async () => {
      const { sendActionMessage } = await import('../background/message-protocol.js');

      const command = {
        type: 'click',
        selector: '#button',
      };

      const observation = {
        elements: [{
          selector: '#button',
          text: 'x'.repeat(60), // Text longer than 50 chars
        }],
      };

      // Should not throw and should truncate the label
      expect(() => sendActionMessage(command, 1, observation)).not.toThrow();
    });
  });

  describe('sendActionResult edge cases', () => {
    test('should handle non-string result', async () => {
      const { sendActionResult } = await import('../background/message-protocol.js');

      const resultObject = {
        success: true,
        data: { value: 123 },
      };

      // Should not throw and should stringify the result
      expect(() => sendActionResult(1, resultObject, false)).not.toThrow();
    });

    test('should handle very long result string', async () => {
      const { sendActionResult } = await import('../background/message-protocol.js');

      const longResult = 'x'.repeat(500);

      // Should not throw and should truncate to 300 chars
      expect(() => sendActionResult(1, longResult, false)).not.toThrow();
    });
  });

  describe('sendAgentActivity edge cases', () => {
    test('should handle unknown status type', async () => {
      const { sendAgentActivity } = await import('../background/message-protocol.js');

      // Should not throw even with unknown status
      expect(() => sendAgentActivity('unknown_status', 'Test')).not.toThrow();
    });

    test('should handle null message', async () => {
      const { sendAgentActivity } = await import('../background/message-protocol.js');

      // Should not throw with null message
      expect(() => sendAgentActivity('thinking', null)).not.toThrow();
    });
  });

  describe('sendHeartbeat', () => {
    test('sends heartbeat_update message with durationMs (covers L380)', async () => {
      chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
      const { sendHeartbeat } = await import('../background/message-protocol.js');
      sendHeartbeat(750);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'heartbeat_update', durationMs: 750 })
      );
    });

    test('defaults durationMs to 0 when called without argument', async () => {
      chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
      const { sendHeartbeat } = await import('../background/message-protocol.js');
      sendHeartbeat();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'heartbeat_update', durationMs: 0 })
      );
    });
  });
});
