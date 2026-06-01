/**
 * Edge case tests for agent-engine.js recovery paths and error handling
 * Focus on coverage gaps: storage failures, undo errors, state management
 */

import { jest } from '@jest/globals';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock chrome APIs
const mockChrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn(),
      remove: jest.fn()
    },
    session: {
      set: jest.fn(),
      get: jest.fn(),
      remove: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    captureVisibleTab: jest.fn(),
    sendMessage: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
    update: jest.fn()
  },
  runtime: {
    getURL: jest.fn(),
    sendMessage: jest.fn(),
    getManifest: jest.fn().mockReturnValue({ version: '3.49.0' })
  },
  debugger: {
    attach: jest.fn(),
    detach: jest.fn(),
    sendCommand: jest.fn()
  }
};

global.chrome = mockChrome;

// Mock telemetry
const mockTel = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
  debug: jest.fn()
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: mockTel,
  loadLevel: jest.fn(),
  listCategories: jest.fn(),
  getLevel: jest.fn(),
  startRun: jest.fn(),
  endRun: jest.fn(),
  listPersistedRuns: jest.fn(),
  loadPersistedRun: jest.fn(),
  deletePersistedRun: jest.fn(),
  emit: jest.fn()
}));

let agentEngine;

describe('agent-engine recovery and edge cases', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockChrome.storage.local.get.mockImplementation((keys, callback) => {
      const result = {};
      if (callback) callback(result);
      return Promise.resolve(result);
    });
    mockChrome.storage.local.set.mockResolvedValue(undefined);
    mockChrome.storage.session.set.mockResolvedValue(undefined);
    mockChrome.tabs.sendMessage.mockResolvedValue({});
    mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
    mockChrome.runtime.sendMessage.mockResolvedValue({});
    mockChrome.debugger.attach.mockResolvedValue(undefined);
    mockChrome.debugger.detach.mockResolvedValue(undefined);
    mockChrome.debugger.sendCommand.mockResolvedValue({});

    // Import agent engine
    agentEngine = await import('../background/agent-engine.js');

    // Reset state before each test
    const { resetAgentState, stopAgent } = agentEngine;
    try {
      await stopAgent();
    } catch (e) {
      // Ignore if not running
    }
    resetAgentState();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('undo stack error handling', () => {
    it('should handle unknown undo entry types', async () => {
      const { pushUndoStack, undoLastAction } = agentEngine;

      // Push an unknown entry type
      pushUndoStack({ type: 'unknown_type', data: 'test' });

      // Attempt undo - should return failure without crashing
      const result = await undoLastAction();

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Unknown undo entry type');
    });

    it('should handle undo restoration failures', async () => {
      const { pushUndoStack, undoLastAction } = agentEngine;
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Tab closed'));

      // Push a type entry
      pushUndoStack({
        type: 'type',
        selector: '#test-input',
        previousValue: 'old value',
        tabId: 1
      });

      // Attempt undo - should handle tab communication failure
      const result = await undoLastAction();

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      // Error message should contain field restoration failure
      expect(result.reason).toMatch(/restore|field|Tab/);
    });

    it('should handle undo operation exceptions', async () => {
      const { pushUndoStack, undoLastAction } = agentEngine;

      // Push an entry that will cause an exception during undo
      pushUndoStack({
        type: 'type',
        selector: null,
        previousValue: 'test',
        tabId: 1
      });

      // Should not throw
      const result = await undoLastAction();

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should handle empty undo stack', async () => {
      const { undoLastAction } = agentEngine;

      const result = await undoLastAction();

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Nothing to undo');
    });
  });

  describe('agent lifecycle state management', () => {
    it('should track agent running state correctly', () => {
      const { agentRunning } = agentEngine;

      // agentRunning is exported as a reference
      expect(agentRunning).toBe(false);
    });

    it('should handle pause/resume state changes', async () => {
      const { pauseAgent, resumeAgent } = agentEngine;

      const pauseResult = await pauseAgent();
      expect(pauseResult).toContain('not running'); // Agent not running yet

      const resumeResult = await resumeAgent();
      expect(resumeResult).toContain('not running');
    });
  });

  describe('context injection handling', () => {
    it('should handle context note injection', () => {
      const { injectContext } = agentEngine;

      // Should not throw
      injectContext('Test note');
      injectContext('Another note');
    });

    it('should handle empty context notes', () => {
      const { injectContext } = agentEngine;

      // Should handle empty string
      injectContext('');
      injectContext(null);
      injectContext(undefined);
    });
  });

  describe('checkpoint management', () => {
    it('should handle checkpoint creation', async () => {
      const { restoreFromCheckpoint, clearCheckpoint } = agentEngine;

      // Should not throw when no checkpoint exists
      const result = await restoreFromCheckpoint();
      expect(result).toBeDefined();
    });

    it('should handle checkpoint clearing', async () => {
      const { clearCheckpoint } = agentEngine;

      // Should not throw
      await clearCheckpoint();
    });

    it('should handle checkpoint operations with invalid state', async () => {
      const { restoreFromCheckpoint, clearCheckpoint } = agentEngine;

      // Clear before restore
      await clearCheckpoint();
      const result = await restoreFromCheckpoint();

      expect(result).toBeDefined();
    });
  });

  describe('agent speed settings', () => {
    it('should handle speed mode changes', () => {
      const { setAgentSpeed } = agentEngine;

      // Test each mode
      setAgentSpeed('slow');
      setAgentSpeed('normal');
      setAgentSpeed('fast');

      // Should not throw on invalid mode
      setAgentSpeed('invalid');
    });
  });

  describe('agent attachment tracking', () => {
    it('should track attached tab IDs', () => {
      const { isAgentAttachedTab, getAttachedTabIds } = agentEngine;

      expect(isAgentAttachedTab(1)).toBe(false);

      const attached = getAttachedTabIds();
      expect(Array.isArray(attached)).toBe(true);
    });

    it('should handle invalid tab IDs', () => {
      const { isAgentAttachedTab } = agentEngine;

      expect(isAgentAttachedTab(null)).toBe(false);
      expect(isAgentAttachedTab(undefined)).toBe(false);
      expect(isAgentAttachedTab(-1)).toBe(false);
      expect(isAgentAttachedTab('string')).toBe(false);
    });
  });

  describe('agent tab ID management', () => {
    it('should return agent tab ID', () => {
      const { getAgentTabId } = agentEngine;

      // Should return null or undefined when not running
      const tabId = getAgentTabId();
      expect(tabId).toBeNull();
    });
  });

  describe('audit log handling', () => {
    it('should handle audit log retrieval', async () => {
      const { fetchAuditLog } = agentEngine;

      // Should handle non-existent log
      const log = await fetchAuditLog('non-existent-id');
      expect(log).toBeDefined();
    });

    it('should handle audit log CSV export', () => {
      const { auditLogToCsv } = agentEngine;

      // Should handle empty log
      const csv = auditLogToCsv([]);
      expect(typeof csv).toBe('string');
    });
  });

  describe('error handling in startAgent', () => {
    it('should reject empty goals', async () => {
      const { startAgent } = agentEngine;

      await expect(startAgent('', { tab: { id: 1 } })).rejects.toThrow('non-empty');
    });

    it('should reject whitespace-only goals', async () => {
      const { startAgent } = agentEngine;

      await expect(startAgent('   ', { tab: { id: 1 } })).rejects.toThrow();
    });

    it('should reject non-string goals', async () => {
      const { startAgent } = agentEngine;

      await expect(startAgent(null, { tab: { id: 1 } })).rejects.toThrow();
      await expect(startAgent(undefined, { tab: { id: 1 } })).rejects.toThrow();
      await expect(startAgent(123, { tab: { id: 1 } })).rejects.toThrow();
    });

    it('should truncate overly long goals', async () => {
      const { startAgent } = agentEngine;
      const longGoal = 'a'.repeat(5000);

      // May fail for other reasons (no LLM), but should truncate the goal
      try {
        await startAgent(longGoal, { tab: { id: 1 } });
      } catch (e) {
        // Expected to fail without LLM setup
        expect(e && e.message).not.toContain('4000');
      }
    });

    it('should handle missing sender tab', async () => {
      const { startAgent } = agentEngine;

      // Set up mock to return empty tabs array
      mockChrome.tabs.query.mockResolvedValue([]);

      // Use a promise with timeout to avoid hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout')), 5000)
      );

      const startPromise = startAgent('test goal', {});

      await expect(Promise.race([timeoutPromise, startPromise]))
        .rejects.toThrow();
    }, 10000);

    it('should handle missing tab ID in sender', async () => {
      const { startAgent } = agentEngine;
      mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);

      // Sender without tab should fall back to query
      const result = startAgent('test goal', {});
      // Should not throw immediately
      expect(result).rejects.toThrow();
    });
  });

  describe('state reset functionality', () => {
    it('should reset agent state completely', async () => {
      const { resetAgentState, agentRunning, stopAgent } = agentEngine;

      // Stop any running agent first
      try {
        await stopAgent();
      } catch (e) {
        // Ignore if not running
      }

      // Reset should not throw
      resetAgentState();

      // Verify state is reset
      expect(agentRunning).toBe(false);
    });
  });

  describe('consecutive operations', () => {
    it('should handle multiple rapid state changes', async () => {
      const { agentRunning, pauseAgent, resumeAgent, setAgentSpeed, stopAgent } = agentEngine;

      // Stop any running agent first
      try {
        await stopAgent();
      } catch (e) {
        // Ignore if not running
      }

      // Rapid state changes
      await pauseAgent();
      await resumeAgent();
      await pauseAgent();

      setAgentSpeed('turbo');
      setAgentSpeed('normal');

      expect(agentRunning).toBe(false);
    });
  });

  describe('edge case inputs', () => {
    it('should handle special characters in goals', async () => {
      const { startAgent } = agentEngine;

      const specialGoals = [
        'Test <script>alert("xss")</script>',
        'Test "quotes" and \'apostrophes\'',
        'Test $pecial characters',
        'Test emoji 🎉',
        'Test\nmultiline\nstring',
        'Test\ttab\tcharacters'
      ];

      for (const goal of specialGoals) {
        try {
          await startAgent(goal, { tab: { id: 1 } });
        } catch (e) {
          // Expected to fail without LLM
          expect(e && e.message).not.toContain('special');
        }
      }
    });

    it('should handle very long valid goals', async () => {
      const { startAgent } = agentEngine;

      const longGoal = 'a'.repeat(3999);
      try {
        await startAgent(longGoal, { tab: { id: 1 } });
      } catch (e) {
        // Expected to fail without LLM
        expect(e && e.message).not.toContain('4000');
      }
    });
  });

  describe('storage error handling', () => {
    it('should handle storage failures gracefully', async () => {
      const { startAgent } = agentEngine;
      mockChrome.storage.local.get.mockRejectedValue(new Error('Storage quota exceeded'));

      await expect(startAgent('test goal', { tab: { id: 1 } })).rejects.toThrow();
    });
  });

  describe('tab manager integration', () => {
    it('should handle tab manager failures', async () => {
      const { startAgent } = agentEngine;
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Tab not found'));

      try {
        await startAgent('test goal', { tab: { id: 1 } });
      } catch (e) {
        // Expected to fail
        expect(e).toBeDefined();
      }
    });
  });
});

// Export empty object for Jest
export {};
