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

  close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose();
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
          setTimeout(() => {
            if (this.onopen) this.onopen();
          }, 10000);
        }

        send() {}
        close() {
          this.readyState = WebSocket.CLOSED;
          if (this.onclose) this.onclose();
        }
      };

      await expect(slowClient.connect()).rejects.toThrow('Connection timeout');
    });

    test('should reconnect on disconnect', async () => {
      await client.connect();
      mockWs = client.ws;

      // Simulate disconnect
      mockWs.close();

      // Should schedule reconnect
      expect(client.reconnectAttempts).toBe(1);
    });
  });

  describe('Goal Execution', () => {
    test('should execute goal', async () => {
      await client.connect();
      mockWs = client.ws;

      // Mock goal acceptance
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: 'req-1',
        payload: { runId: 'run-123' }
      });

      // Mock completion
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'run-123',
        status: 'success',
        result: {
          summary: 'Test completed successfully',
          findings: [],
          evidence: {},
          trust_score: 95
        }
      });

      const result = await client.execute('Test completed goal');
      
      expect(result.summary).toBe('Test completed successfully');
    });

    test('should call onStep callback', async () => {
      await client.connect();
      mockWs = client.ws;

      const onStep = jest.fn();

      const executePromise = client.execute('Test completed goal', { onStep });

      // Mock goal acceptance
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: 'req-2',
        payload: { runId: 'run-456' }
      });

      // Mock step update
      mockWs.simulateMessage({
        type: 'step_update',
        id: 'run-456',
        step: 1,
        total: 5,
        action: 'click',
        target: 'submit button'
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

      // Mock goal acceptance
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: 'req-3',
        payload: { runId: 'run-789' }
      });

      // Mock failure
      mockWs.simulateMessage({
        type: 'goal_complete',
        id: 'run-789',
        status: 'failed',
        error: 'Element not found',
        recoverable: false
      });

      await expect(client.execute('Failing goal')).rejects.toThrow('Element not found');
    });
  });

  describe('Status Operations', () => {
    test('should get run status', async () => {
      await client.connect();
      mockWs = client.ws;

      const statusPromise = client.getStatus('run-123');

      // Mock status response
      mockWs.simulateMessage({
        type: 'status_response',
        id: statusPromise.id,
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

      // Mock pause acceptance
      mockWs.simulateMessage({
        type: 'pause_accepted',
        id: pausePromise.id,
        runId: 'run-123'
      });

      await pausePromise;
    });

    test('should resume run', async () => {
      await client.connect();
      mockWs = client.ws;

      const resumePromise = client.resume('run-123');

      // Mock resume acceptance
      mockWs.simulateMessage({
        type: 'resume_accepted',
        id: resumePromise.id,
        runId: 'run-123'
      });

      await resumePromise;
    });

    test('should cancel run', async () => {
      await client.connect();
      mockWs = client.ws;

      const cancelPromise = client.cancel('run-123');

      // Mock cancel acceptance
      mockWs.simulateMessage({
        type: 'cancel_accepted',
        id: cancelPromise.id,
        runId: 'run-123'
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
        step: 1
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
        id: 'run-123'
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Ping Health Check', () => {
    test('should ping server', async () => {
      await client.connect();
      mockWs = client.ws;

      const pingPromise = client.ping();

      // Mock pong
      mockWs.simulateMessage({
        type: 'pong',
        id: pingPromise.id,
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
      mockWs.simulateMessage({
        type: 'goal_accepted',
        id: 'req-4',
        payload: { runId: 'run-999' }
      });

      await client.disconnect();

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
});
