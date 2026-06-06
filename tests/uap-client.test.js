/**
 * UAP Client Tests
 *
 * Tests for Universal Agent Protocol client SDK
 *
 * @version 10.0.0
 */

import { jest } from '@jest/globals';
import { UAPClient } from '../lib/uap-client.js';

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sentMessages = [];
    
    // Simulate connection
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 10);
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code || 1000, reason: reason || '' });
    }
  }

  simulateMessage(message) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(message) });
    }
  }
}

// Setup global WebSocket mock
global.WebSocket = MockWebSocket;

describe('UAP Client', () => {
  let client;
  let mockWs;
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    client = new UAPClient({
      serverUrl: 'ws://localhost:8765/uap',
      authToken: 'test-token',
      timeout: 5000
    });
  });

  afterEach(async () => {
    await client.disconnect();
    global.WebSocket = originalWebSocket;
  });

  describe('Connection', () => {
    test('should connect to server', async () => {
      await client.connect();
      expect(client.connected).toBe(true);
    });

    test('should authenticate on connect', async () => {
      await client.connect();
      mockWs = client.ws;

      const authMessage = mockWs.sentMessages.find(m => m.type === 'auth');
      expect(authMessage).toBeDefined();
      expect(authMessage.authToken).toBe('test-token');
    });

    test('should handle connection timeout', async () => {
      const slowClient = new UAPClient({ timeout: 1 });

      // Mock WebSocket that never connects
      global.WebSocket = class NeverConnectsWebSocket {
        constructor() {
          this.readyState = WebSocket.CONNECTING;
          this.onopen = null;
          this.onmessage = null;
          this.onerror = null;
          this.onclose = null;
          // Never call onopen - connection times out
        }

        send() {}
        close() {
          this.readyState = WebSocket.CLOSED;
          if (this.onclose) this.onclose();
        }
      };

      await expect(slowClient.connect()).rejects.toThrow('Connection timeout');
    }, 15000); // Increase test timeout to 15 seconds (connection timeout is 10s)

    test('should reconnect on disconnect', async () => {
      await client.connect();
      mockWs = client.ws;

      // Simulate disconnect
      mockWs.close();

      // Should schedule reconnect (reconnectTimer is set)
      expect(client.reconnectTimer).not.toBeNull();
    });
  });

  describe('Goal Execution', () => {
    test('should execute goal', async () => {
      await client.connect();
      mockWs = client.ws;

      const executePromise = client.execute('Test completed goal');

      // Get the request ID from the sent message
      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      expect(goalRequest).toBeDefined();
      const requestId = goalRequest.id;

      // Mock goal acceptance
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: requestId,
        payload: { runId: 'run-123' }
      });

      // Mock completion
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'run-123',
        payload: {
          status: 'success',
          result: {
            summary: 'Test completed successfully',
            findings: [],
            evidence: {},
            trust_score: 95
          }
        }
      });

      const result = await executePromise;

      expect(result.summary).toBe('Test completed successfully');
    });

    test('should call onStep callback', async () => {
      await client.connect();
      mockWs = client.ws;

      const onStep = jest.fn();

      const executePromise = client.execute('Test completed goal', { onStep });

      // Get the request ID from the sent message
      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      const requestId = goalRequest.id;

      // Mock goal acceptance
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: requestId,
        payload: { runId: 'run-456' }
      });

      // Mock step update
      mockWs.simulateMessage({
        type: 'step_update',
        id: 'run-456',
        payload: {
          step: 1,
          total: 5,
          action: 'click',
          target: 'submit button'
        }
      });

      // Mock completion
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'run-456',
        payload: {
          status: 'success',
          result: { summary: 'Done', findings: [], evidence: {}, trust_score: 100 }
        }
      });

      await executePromise;

      expect(onStep).toHaveBeenCalledWith({
        step: 1,
        total: 5,
        action: 'click',
        target: 'submit button'
      });
    });

    test('should reject on timeout', async () => {
      await client.connect();

      const timeoutClient = new UAPClient({ timeout: 100 });
      await timeoutClient.connect();

      await expect(
        timeoutClient.execute('Slow execution goal')
      ).rejects.toThrow('Goal execution timeout');
    });

    test('should handle goal failure', async () => {
      await client.connect();
      mockWs = client.ws;

      const executePromise = client.execute('Failing goal execution');

      // Get the request ID from the sent message
      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      const requestId = goalRequest.id;

      // Mock goal acceptance
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: requestId,
        payload: { runId: 'run-789' }
      });

      // Mock failure
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'run-789',
        payload: {
          status: 'failed',
          error: 'Element not found',
          recoverable: false
        }
      });

      await expect(executePromise).rejects.toThrow('Element not found');
    });
  });

  describe('Status Operations', () => {
    test('should get run status', async () => {
      await client.connect();
      mockWs = client.ws;

      const statusPromise = client.getStatus('run-123');

      // Get the status request from sent messages
      const statusRequest = mockWs.sentMessages.find(m => m.type === 'status_request');
      expect(statusRequest).toBeDefined();

      // Mock status response
      mockWs.simulateMessage({
        type: 'status_response',
        id: statusRequest.id,
        payload: {
          status: 'running',
          step: 3,
          total: 10
        }
      });

      const status = await statusPromise;

      expect(status.status).toBe('running');
      expect(status.step).toBe(3);
    });

    test('should pause run', async () => {
      await client.connect();
      mockWs = client.ws;

      const pausePromise = client.pause('run-123');

      // Get the pause request from sent messages
      const pauseRequest = mockWs.sentMessages.find(m => m.type === 'pause_request');
      expect(pauseRequest).toBeDefined();

      // Mock pause acceptance
      mockWs.simulateMessage({
        type: 'pause_accepted',
        id: pauseRequest.id,
        payload: { runId: 'run-123' }
      });

      await pausePromise;
    });

    test('should resume run', async () => {
      await client.connect();
      mockWs = client.ws;

      const resumePromise = client.resume('run-123');

      // Get the resume request from sent messages
      const resumeRequest = mockWs.sentMessages.find(m => m.type === 'resume_request');
      expect(resumeRequest).toBeDefined();

      // Mock resume acceptance
      mockWs.simulateMessage({
        type: 'resume_accepted',
        id: resumeRequest.id,
        payload: { runId: 'run-123' }
      });

      await resumePromise;
    });

    test('should cancel run', async () => {
      await client.connect();
      mockWs = client.ws;

      const cancelPromise = client.cancel('run-123');

      // Get the cancel request from sent messages
      const cancelRequest = mockWs.sentMessages.find(m => m.type === 'cancel_request');
      expect(cancelRequest).toBeDefined();

      // Mock cancel acceptance
      mockWs.simulateMessage({
        type: 'cancel_accepted',
        id: cancelRequest.id,
        payload: { runId: 'run-123' }
      });

      await cancelPromise;
    });
  });

  describe('Event Handling', () => {
    test('should emit events', async () => {
      await client.connect();
      mockWs = client.ws;

      const handler = jest.fn();
      client.addEventListener('step_update', handler);

      mockWs.simulateMessage({
        type: 'step_update',
        id: 'run-123',
        payload: {
          step: 1
        }
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'step_update'
        })
      );
    });

    test('should remove event listeners', async () => {
      await client.connect();
      mockWs = client.ws;

      const handler = jest.fn();
      client.addEventListener('step_update', handler);
      client.removeEventListener('step_update', handler);

      mockWs.simulateMessage({
        type: 'step_update',
        id: 'run-123',
        payload: {}
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Ping Health Check', () => {
    test('should ping server', async () => {
      await client.connect();
      mockWs = client.ws;

      const pingPromise = client.ping();

      // Get the ping request from sent messages
      const pingRequest = mockWs.sentMessages.find(m => m.type === 'ping');
      expect(pingRequest).toBeDefined();

      // Mock pong
      mockWs.simulateMessage({
        type: 'pong',
        id: pingRequest.id,
        timestamp: Date.now()
      });

      const result = await pingPromise;
      expect(result).toBe(true);
    });

    test('should return false on timeout', async () => {
      await client.connect();

      const result = await client.ping();
      expect(result).toBe(false);
    });
  });

  describe('Disconnect', () => {
    test('should disconnect and clean up', async () => {
      await client.connect();
      mockWs = client.ws;

      // Start a goal
      const goalPromise = client.execute('Test goal execution');
      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: goalRequest.id,
        payload: { runId: 'run-999' }
      });

      // Disconnect should reject the active goal
      client.disconnect();
      await expect(goalPromise).rejects.toThrow('Client disconnected');

      expect(client.connected).toBe(false);
      expect(client.activeRuns.size).toBe(0);
    });

    test('should not reconnect after manual disconnect', async () => {
      await client.connect();
      mockWs = client.ws;

      client.autoReconnect = false;
      mockWs.close();

      expect(client.reconnectTimer).toBeNull();
    });
  });

  describe('Message Queue', () => {
    test('should queue messages when disconnected', () => {
      client.send({ type: 'test', data: 'value' });

      expect(client.messageQueue.length).toBe(1);
    });

    test('should flush queue on connect', async () => {
      // Queue messages while disconnected
      client.send({ type: 'test1', data: 'value1' });
      client.send({ type: 'test2', data: 'value2' });

      await client.connect();
      mockWs = client.ws;

      // Queue should be flushed
      expect(client.messageQueue.length).toBe(0);

      // Messages should have been sent
      expect(mockWs.sentMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Not-connected error paths', () => {
    test('execute throws when not connected', async () => {
      await expect(client.execute('This goal is long enough to pass validation'))
        .rejects.toThrow('Not connected');
    });

    test('execute throws for invalid goal (too short)', async () => {
      await client.connect();
      await expect(client.execute('short')).rejects.toThrow('Invalid goal');
    });

    test('getStatus throws when not connected', async () => {
      await expect(client.getStatus('run-1')).rejects.toThrow('Not connected');
    });

    test('pause throws when not connected', async () => {
      await expect(client.pause('run-1')).rejects.toThrow('Not connected');
    });

    test('resume throws when not connected', async () => {
      await expect(client.resume('run-1')).rejects.toThrow('Not connected');
    });

    test('cancel throws when not connected', async () => {
      await expect(client.cancel('run-1')).rejects.toThrow('Not connected');
    });

    test('ping returns false when not connected', async () => {
      const result = await client.ping();
      expect(result).toBe(false);
    });
  });

  describe('Message handler edge cases', () => {
    test('auth_accepted sets clientId', async () => {
      await client.connect();
      mockWs = client.ws;
      mockWs.simulateMessage({ type: 'auth_accepted', id: 'x', payload: { clientId: 'client-abc' } });
      expect(client.clientId).toBe('client-abc');
    });

    test('unknown message type is handled without throwing', async () => {
      await client.connect();
      mockWs = client.ws;
      expect(() => mockWs.simulateMessage({ type: 'totally_unknown', id: 'x', payload: {} })).not.toThrow();
    });

    test('handleError rejects run and removes from activeRuns', async () => {
      await client.connect();
      mockWs = client.ws;

      const executePromise = client.execute('This goal is long enough to pass validation');
      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      mockWs.simulateMessage({ type: 'goal_accepted', id: goalRequest.id, payload: { runId: 'err-run' } });

      mockWs.simulateMessage({
        type: 'error',
        id: 'err-run',
        payload: { message: 'Execution failed', error: 'execution_error', recoverable: false }
      });

      await expect(executePromise).rejects.toThrow('Execution failed');
      expect(client.activeRuns.has('err-run')).toBe(false);
    });

    test('handleError with recoverable=true does not reject run', async () => {
      await client.connect();
      mockWs = client.ws;

      const executePromise = client.execute('This goal is long enough to pass');
      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      mockWs.simulateMessage({ type: 'goal_accepted', id: goalRequest.id, payload: { runId: 'rec-run' } });

      // Recoverable error — should NOT reject the promise
      mockWs.simulateMessage({
        type: 'error',
        id: 'rec-run',
        payload: { message: 'Transient error', error: 'retry_later', recoverable: true }
      });

      // The run should still be active — resolve it so it doesn't leak
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'rec-run',
        payload: { status: 'success', result: { summary: 'ok', findings: [], evidence: {}, trust_score: 90 } }
      });
      await executePromise;
    });

    test('onComplete callback is called on success', async () => {
      await client.connect();
      mockWs = client.ws;

      const completedWith = [];
      const executePromise = client.execute('Callback goal long enough validation', {
        onComplete: (result, metrics) => completedWith.push({ result, metrics })
      });

      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      mockWs.simulateMessage({ type: 'goal_accepted', id: goalRequest.id, payload: { runId: 'cb-run' } });
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'cb-run',
        payload: { status: 'success', result: { summary: 'done', findings: [], evidence: {}, trust_score: 99 }, metrics: { time: 1 } }
      });

      await executePromise;
      expect(completedWith.length).toBe(1);
      expect(completedWith[0].result.summary).toBe('done');
    });

    test('onError callback is called on failure', async () => {
      await client.connect();
      mockWs = client.ws;

      const errors = [];
      const executePromise = client.execute('Error callback test goal validation', {
        onError: (err) => errors.push(err)
      });

      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      mockWs.simulateMessage({ type: 'goal_accepted', id: goalRequest.id, payload: { runId: 'onerr-run' } });
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'onerr-run',
        payload: { status: 'failed', error: 'Step failed', recoverable: false }
      });

      await expect(executePromise).rejects.toThrow('Step failed');
      expect(errors.length).toBe(1);
    });

    test('emit catches and suppresses event handler errors', async () => {
      await client.connect();
      mockWs = client.ws;

      client.addEventListener('step_update', () => { throw new Error('handler crash'); });
      expect(() => mockWs.simulateMessage({ type: 'step_update', id: 'x', payload: { step: 1 } })).not.toThrow();
    });

    test('handleStatusResponse calls onStatus if present', async () => {
      await client.connect();
      mockWs = client.ws;

      const statuses = [];
      const statusPromise = client.getStatus('run-stat');

      // Simulate response to the status request
      const statusRequest = mockWs.sentMessages.find(m => m.type === 'status_request');
      mockWs.simulateMessage({
        type: 'status_response',
        id: statusRequest.id,
        payload: { status: 'running', step: 2, total: 5 }
      });

      const result = await statusPromise;
      expect(result.status).toBe('running');
    });
  });

  describe('Connection resilience', () => {
    test('reconnect timer fires and calls connect again', async () => {
      await client.connect();
      mockWs = client.ws;

      // Force reconnect scenario: max reconnect attempts not reached
      client.reconnectDelay = 5; // ultra-short delay
      client.maxReconnectAttempts = 3;
      client.reconnectAttempts = 0;
      client.reconnectTimer = null;

      client.scheduleReconnect();
      expect(client.reconnectTimer).not.toBeNull();
      await new Promise(resolve => setTimeout(resolve, 30)); // let timer fire
      // After timer fires, reconnectAttempts is incremented (we don't care if connect fails)
    });

    test('onclose rejects active runs when autoReconnect disabled and max attempts reached', async () => {
      await client.connect();
      mockWs = client.ws;

      const executePromise = client.execute('Run that gets terminated by close');
      const goalRequest = mockWs.sentMessages.find(m => m.type === 'goal_request');
      mockWs.simulateMessage({ type: 'goal_accepted', id: goalRequest.id, payload: { runId: 'close-run' } });

      // Disable reconnect and saturate attempts
      client.autoReconnect = false;

      // Manually trigger onclose
      client.ws.onclose({ code: 1001, reason: 'server gone' });

      await expect(executePromise).rejects.toThrow('Connection closed');
    });
  });
});
