/**
 * UAP Bridge Tests
 *
 * Tests for the service-worker-safe HTTP bridge that connects the
 * extension's agent engine to the external UAP server process.
 *
 * @version 10.0.0
 */

import { jest } from '@jest/globals';

// ── Mock fetch globally ──
const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

// ── Mock AbortController if not available ──
if (!globalThis.AbortController) {
  globalThis.AbortController = class AbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  };
}

// ── Mock clearTimeout / clearInterval ──
jest.useFakeTimers();

import {
  initBridge,
  setGoalCallback,
  setRunId,
  broadcast,
  stopBridge,
  isServerAvailable,
  getServerUrl
} from '../background/uap-bridge.js';

describe('UAP Bridge', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    stopBridge();
    jest.clearAllTimers();
  });

  afterAll(() => {
    stopBridge();
    jest.useRealTimers();
  });

  describe('initBridge', () => {
    test('should initialize with default server URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uptime: 12345 })
      });

      await initBridge();

      expect(getServerUrl()).toBe('http://localhost:8766');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8766/uap/status',
        expect.objectContaining({ method: 'GET' })
      );
    });

    test('should initialize with custom server URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uptime: 12345 })
      });

      await initBridge({ serverUrl: 'http://custom:9999' });

      expect(getServerUrl()).toBe('http://custom:9999');
    });

    test('should handle server unavailable gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await initBridge();

      expect(isServerAvailable()).toBe(false);
    });

    test('should start polling when server is available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ tasks: [], timestamp: Date.now() })
      });

      await initBridge();

      expect(isServerAvailable()).toBe(true);

      // Advance timer to trigger polling
      jest.advanceTimersByTime(5000);

      // Should have polled for tasks
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/uap/tasks'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('broadcast', () => {
    test('should POST events to /uap/events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      broadcast('agent.started', { goal: 'Test goal' });

      // broadcast is fire-and-forget (async IIFE)
      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8766/uap/events',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('agent.started')
        })
      );
    });

    test('should include runId when set', async () => {
      setRunId('run-123');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      broadcast('task.completed', { result: 'success' });

      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      const call = mockFetch.mock.calls.find(c => c[0] === 'http://localhost:8766/uap/events');
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.data.runId).toBe('run-123');
      expect(body.type).toBe('task.completed');
    });

    test('should NOT throw when server is down', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      // This should not throw
      expect(() => {
        broadcast('agent.error', { error: 'test error' });
      }).not.toThrow();

      await jest.advanceTimersByTimeAsync(100);
    });

    test('should mark server unavailable after 5 consecutive failures', async () => {
      jest.useRealTimers();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ uptime: 1 }) });
      await initBridge();
      expect(isServerAvailable()).toBe(true);

      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let i = 0; i < 5; i++) {
        broadcast('agent.started', { goal: 'test' });
        await new Promise(r => setTimeout(r, 100));
      }
      // Allow async IIFEs to settle
      await new Promise(r => setTimeout(r, 200));

      expect(isServerAvailable()).toBe(false);
      stopBridge(); // clear real interval before switching back to fake timers
      jest.useFakeTimers();
    }, 10000);

    test('should include source identifier in events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      broadcast('agent.started', { goal: 'test' });

      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      const call = mockFetch.mock.calls.find(c => c[0] === 'http://localhost:8766/uap/events');
      const body = JSON.parse(call[1].body);
      expect(body.data.source).toBe('sentinel-extension');
    });
  });

  describe('setGoalCallback', () => {
    test('should store goal callback', () => {
      const cb = jest.fn();
      setGoalCallback(cb);
      // Callback is stored internally; verified via poll behavior
    });
  });

  describe('setRunId', () => {
    test('should update runId for subsequent broadcasts', async () => {
      setRunId('run-abc');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      broadcast('task.completed', {});

      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      const call = mockFetch.mock.calls.find(c => c[0] === 'http://localhost:8766/uap/events');
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.data.runId).toBe('run-abc');
    });

    test('should clear runId when set to null', async () => {
      setRunId(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      broadcast('agent.started', { goal: 'test' });

      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      const call = mockFetch.mock.calls.find(c => c[0] === 'http://localhost:8766/uap/events');
      const body = JSON.parse(call[1].body);
      expect(body.data.runId).toBeUndefined();
    });
  });

  describe('stopBridge', () => {
    test('should stop polling and reset state', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ tasks: [], timestamp: Date.now() })
      });

      await initBridge();
      expect(isServerAvailable()).toBe(true);

      stopBridge();
      expect(isServerAvailable()).toBe(false);
    });
  });

  describe('isServerAvailable', () => {
    test('should return false before initialization', () => {
      expect(isServerAvailable()).toBe(false);
    });

    test('should return true when server responds', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uptime: 1 })
      });

      await initBridge();
      expect(isServerAvailable()).toBe(true);
    });
  });

  describe('getServerUrl', () => {
    test('should return default URL before initialization', () => {
      expect(getServerUrl()).toBe('http://localhost:8766');
    });

    test('should return configured URL after initialization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uptime: 1 })
      });

      await initBridge({ serverUrl: 'http://myhost:7777' });
      expect(getServerUrl()).toBe('http://myhost:7777');
    });
  });

  describe('Task polling', () => {
    test('should invoke goal callback when tasks are available', async () => {
      const goalCb = jest.fn().mockResolvedValue(undefined);
      const taskTime = Date.now();

      // initBridge health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uptime: 1 })
      });

      await initBridge({ onGoal: goalCb });

      // Poll returns a task
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tasks: [{
            id: 'task-1',
            type: 'goal_request',
            goal: 'Check M365 license usage',
            context: { tenant: 'acme.onmicrosoft.com' },
            status: 'pending',
            timestamp: taskTime
          }],
          timestamp: taskTime
        })
      });

      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(goalCb).toHaveBeenCalledWith(
        'Check M365 license usage',
        { tenant: 'acme.onmicrosoft.com' }
      );
    });

    test('should skip tasks that are not goal_request type', async () => {
      const goalCb = jest.fn().mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uptime: 1 })
      });

      await initBridge({ onGoal: goalCb });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tasks: [{
            id: 'task-2',
            type: 'cancel_request',
            status: 'pending',
            timestamp: Date.now()
          }],
          timestamp: Date.now()
        })
      });

      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      expect(goalCb).not.toHaveBeenCalled();
    });

    test('should handle poll failure gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uptime: 1 })
      });

      await initBridge();

      // Poll fails
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(100);

      // Bridge should still be functional
      expect(() => isServerAvailable()).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    test('broadcast with no data should work', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      broadcast('agent.started');

      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      const call = mockFetch.mock.calls.find(c => c[0] === 'http://localhost:8766/uap/events');
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.type).toBe('agent.started');
      expect(body.data).toBeDefined();
    });

    test('multiple rapid broadcasts should all fire', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      });

      broadcast('agent.started', { goal: 'task1' });
      broadcast('task.completed', { result: 'ok' });
      broadcast('agent.completed', { stepCount: 1 });

      await jest.advanceTimersByTimeAsync(500);
      await Promise.resolve();

      const eventsCalls = mockFetch.mock.calls.filter(c => c[0] === 'http://localhost:8766/uap/events');
      expect(eventsCalls.length).toBe(3);
    });
  });

  describe('_pollTasks coverage — internal branches', () => {
    test('poll marks server unavailable when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await initBridge();

      mockFetch.mockResolvedValueOnce({ ok: false });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(200);

      expect(isServerAvailable()).toBe(false);
    });

    test('poll uses Date.now() fallback when response has no timestamp', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await initBridge();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [] }), // no timestamp field
      });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(200);

      expect(isServerAvailable()).toBe(true);
    });

    test('poll uses empty-array fallback when response has no tasks field', async () => {
      const goalCb = jest.fn();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await initBridge({ onGoal: goalCb });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ timestamp: 9999 }), // no tasks field
      });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(200);

      expect(goalCb).not.toHaveBeenCalled();
      expect(isServerAvailable()).toBe(true);
    });

    test('poll marks server unavailable after 5 consecutive fetch failures', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await initBridge();

      for (let i = 0; i < 5; i++) {
        mockFetch.mockRejectedValueOnce(new Error('net fail'));
        jest.advanceTimersByTime(5000);
        await jest.advanceTimersByTimeAsync(200);
      }

      expect(isServerAvailable()).toBe(false);
    });

    test('poll retries health check when server is unavailable and comes back online', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await initBridge();

      // 5 failures to mark server unavailable
      for (let i = 0; i < 5; i++) {
        mockFetch.mockRejectedValueOnce(new Error('fail'));
        jest.advanceTimersByTime(5000);
        await jest.advanceTimersByTimeAsync(200);
      }
      expect(isServerAvailable()).toBe(false);

      // Next poll interval: server not available → health check succeeds
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(200);

      expect(isServerAvailable()).toBe(true);
    });

    test('poll stays unavailable when health check also fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await initBridge();

      for (let i = 0; i < 5; i++) {
        mockFetch.mockRejectedValueOnce(new Error('fail'));
        jest.advanceTimersByTime(5000);
        await jest.advanceTimersByTimeAsync(200);
      }
      expect(isServerAvailable()).toBe(false);

      // Health check fails too
      mockFetch.mockRejectedValueOnce(new Error('still down'));
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(200);

      expect(isServerAvailable()).toBe(false);
    });

    test('does not start duplicate polling when already polling', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await initBridge();
      // Second initBridge calls _startPolling but _polling is already true → early return
      await initBridge();

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [], timestamp: 1 }) });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(200);

      // Only one /uap/tasks fetch — not two (no duplicate interval)
      const taskCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('/uap/tasks'));
      expect(taskCalls.length).toBeLessThanOrEqual(1);
    });
  });
});
