/**
 * v3.0 Integration Tests
 * Comprehensive tests for v3.0 runtime components
 * 
 * Tests cover: circuit breaker, task queue, state manager, load monitor, event bus, orchestrator
 */

describe('v3.0 Circuit Breaker', () => {
  let CircuitBreaker, CircuitState, CircuitBreakerRegistry;
  beforeAll(async () => {
    // Import modules dynamically for test environment
    const module = await import('../v3.0-integration/circuit-breaker.js');
    CircuitBreaker = module.CircuitBreaker;
    CircuitState = module.CircuitState;
    CircuitBreakerRegistry = module.CircuitBreakerRegistry;
  });

  describe('Circuit Breaker Basic Functionality', () => {
    test('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3 });
      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
    });

    test('should trip to OPEN after threshold failures', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 2, resetTimeout: 1000 });
      
      // Execute failing operations
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Test failure'); });
        } catch (e) {
          // Expected failures
        }
      }
      
      expect(breaker.getState().state).toBe(CircuitState.OPEN);
    });

    test('should allow operations in CLOSED state', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3 });
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    test('should block operations in OPEN state', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeout: 5000 });
      
      // Trip the breaker
      try {
        await breaker.execute(async () => { throw new Error('Trip'); });
      } catch (e) {}
      
      // Should block next call
      await expect(breaker.execute(async () => 'blocked')).rejects.toThrow();
    });

    test('should reset to CLOSED after timeout', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeout: 100 });
      
      // Trip the breaker
      try {
        await breaker.execute(async () => { throw new Error('Trip'); });
      } catch (e) {}
      
      expect(breaker.getState().state).toBe(CircuitState.OPEN);
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should transition to HALF_OPEN then CLOSED on success
      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
    });
  });

  describe('Circuit Breaker Registry', () => {
    test('should create and retrieve circuit breakers', () => {
      const registry = new CircuitBreakerRegistry();
      const breaker1 = registry.get('breaker1', { failureThreshold: 5 });
      const breaker2 = registry.get('breaker1', { failureThreshold: 3 });
      expect(breaker1).toBe(breaker2); // Should return same instance
      expect(breaker1.failureThreshold).toBe(5); // First config wins
    });

    test('should get status of all breakers', () => {
      const registry = new CircuitBreakerRegistry();
      registry.get('breaker1', { failureThreshold: 3 });
      registry.get('breaker2', { failureThreshold: 5 });
      const status = registry.getAllStatus();
      expect(status).toHaveProperty('breaker1');
      expect(status).toHaveProperty('breaker2');
    });
    test('should identify open breakers', async () => {
      const registry = new CircuitBreakerRegistry();
      const breaker = registry.get('test', { failureThreshold: 1, resetTimeout: 5000 });
      // Trip the breaker
      try {
        await breaker.execute(async () => { throw new Error('Trip'); });
      } catch (e) {}
      const openBreakers = registry.getOpenBreakers();
      expect(openBreakers).toContain('test');
    });
  });
});
describe('v3.0 Task Queue', () => {
  let TaskQueue, TaskPriority, TaskState;

  beforeAll(async () => {
    const module = await import('../v3.0-integration/task-queue.js');
    TaskQueue = module.TaskQueue;
    TaskPriority = module.TaskPriority;
    TaskState = module.TaskState;
  });

  describe('Task Queue Basic Functionality', () => {
    let taskQueue;

    beforeEach(async () => {
      taskQueue = new TaskQueue({ dbName: 'TestTaskQueue', maxQueueSize: 100 });
      await taskQueue.init();
    });

    afterEach(async () => {
      // Cleanup would go here
    });

    test('should enqueue and process tasks', async () => {
      let processorCalled = false;
      taskQueue.registerProcessor('test', async (payload) => {
        processorCalled = true;
        return payload.value;
      });

      const taskId = await taskQueue.enqueue({
        type: 'test',
        payload: { value: 'test_data' },
        priority: TaskPriority.NORMAL
      });

      expect(taskId).toBeDefined();
      expect(processorCalled).toBe(true);
    });

    test('should respect task priority', async () => {
      const results = [];
      taskQueue.registerProcessor('priority_test', async (payload) => {
        results.push(payload.value);
        return payload.value;
      });

      // Enqueue tasks in different order
      await taskQueue.enqueue({ type: 'priority_test', payload: { value: 'low' }, priority: TaskPriority.LOW });
      await taskQueue.enqueue({ type: 'priority_test', payload: { value: 'high' }, priority: TaskPriority.HIGH });
      await taskQueue.enqueue({ type: 'priority_test', payload: { value: 'normal' }, priority: TaskPriority.NORMAL });

      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for processing

      expect(results[0]).toBe('high'); // High priority should process first
    });

    test('should retry failed tasks up to max attempts', async () => {
      let attempts = 0;
      taskQueue.registerProcessor('retry_test', async (payload) => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Not yet');
        }
        return 'success';
      });

      await taskQueue.enqueue({
        type: 'retry_test',
        payload: {},
        priority: TaskPriority.NORMAL,
        maxAttempts: 3
      });

      await new Promise(resolve => setTimeout(resolve, 200)); // Wait for retries
      
      expect(attempts).toBe(3);
    });

    test('should provide queue statistics', async () => {
      const stats = await taskQueue.getStats();
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
    });
  });
});

describe('v3.0 State Manager', () => {
  let StateManager;

  beforeAll(async () => {
    const module = await import('../v3.0-integration/state-manager.js');
    StateManager = module.StateManager;
  });

  describe('State Persistence', () => {
    let stateManager;

    beforeEach(() => {
      stateManager = new StateManager({ stateKey: 'test_agent_state' });
    });

    test('should save and load state', async () => {
      const testState = {
        agentMemory: { key1: 'value1' },
        history: [{ action: 'navigate', timestamp: Date.now() }],
        stepCount: 5
      };

      const saveResult = await stateManager.saveState(testState);
      expect(saveResult).toBe(true);

      const loadedState = await stateManager.loadState();
      expect(loadedState).toEqual(testState);
    });

    test('should update partial state', async () => {
      const initialState = { key1: 'value1', key2: 'value2' };
      await stateManager.saveState(initialState);

      await stateManager.updateState({ key1: 'updated' });

      const loadedState = await stateManager.loadState();
      expect(loadedState.key1).toBe('updated');
      expect(loadedState.key2).toBe('value2'); // Other keys preserved
    });

    test('should create and load checkpoints', async () => {
      const checkpointState = { stepCount: 10, data: 'checkpoint_data' };
      
      const created = await stateManager.createCheckpoint('cp1', checkpointState);
      expect(created).toBe(true);

      const loadedCheckpoint = await stateManager.loadCheckpoint('cp1');
      expect(loadedCheckpoint).toEqual(checkpointState);
    });

    test('should list checkpoints', async () => {
      await stateManager.createCheckpoint('cp1', { data: '1' });
      await stateManager.createCheckpoint('cp2', { data: '2' });

      const checkpoints = await stateManager.listCheckpoints();
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    });

    test('should clear state', async () => {
      await stateManager.saveState({ key: 'value' });
      expect(await stateManager.hasState()).toBe(true);

      await stateManager.clearState();
      expect(await stateManager.hasState()).toBe(false);
    });
  });
});

describe('v3.0 Event Bus', () => {
  let EventBus, EventTypes;

  beforeAll(async () => {
    const module = await import('../v3.0-integration/event-bus.js');
    EventBus = module.EventBus;
    EventTypes = module.EventTypes;
  });

  describe('Event Pub/Sub', () => {
    test('should publish and subscribe to events', async () => {
      const bus = new EventBus();
      let receivedData = null;

      bus.on('test_event', (data) => {
        receivedData = data;
      });

      await bus.emit('test_event', { message: 'hello' });
      
      expect(receivedData).toEqual({ message: 'hello' });
    });

    test('should support one-time subscriptions', async () => {
      const bus = new EventBus();
      let callCount = 0;

      bus.once('one_time', () => {
        callCount++;
      });

      await bus.emit('one_time', {});
      await bus.emit('one_time', {});

      expect(callCount).toBe(1); // Should only call once
    });

    test('should support event history', async () => {
      const bus = new EventBus({ maxHistory: 5 });

      await bus.emit('event1', {});
      await bus.emit('event2', {});
      await bus.emit('event3', {});

      const history = bus.getHistory();
      expect(history.length).toBe(3);
      expect(history[0].event).toBe('event1');
    });

    test('should track statistics', async () => {
      const bus = new EventBus();

      bus.on('test', () => {});
      await bus.emit('test', {});

      const stats = bus.getStats();
      expect(stats.published).toBe(1);
      expect(stats.delivered).toBe(1);
    });

    test('should support scoped event buses', async () => {
      const mainBus = new EventBus();
      const scopedBus = mainBus.scope('agent');
      
      let received = null;
      mainBus.on('agent:action', (data) => {
        received = data;
      });

      await scopedBus.emit('action', { type: 'click' });
      
      expect(received).toEqual({ type: 'click' });
    });
  });
});

describe('v3.0 Integration Layer', () => {
  describe('V3 Runtime Orchestrator', () => {
    let V3RuntimeOrchestrator;

    beforeAll(async () => {
      const module = await import('../v3.0-integration/orchestrator.js');
      V3RuntimeOrchestrator = module.V3RuntimeOrchestrator;
    });

    test('should initialize all components', async () => {
      const orchestrator = new V3RuntimeOrchestrator({ enabled: true });
      
      await orchestrator.initialize();
      
      const status = orchestrator.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.components).toBeDefined();
    });

    test('should execute operations with circuit breaker protection', async () => {
      const orchestrator = new V3RuntimeOrchestrator({ enabled: true });
      await orchestrator.initialize();

      const result = await orchestrator.executeWithBreaker('llm-api', async () => {
        return 'success';
      });

      expect(result).toBe('success');
    });

    test('should perform health checks', async () => {
      const orchestrator = new V3RuntimeOrchestrator({ enabled: true });
      await orchestrator.initialize();

      const health = await orchestrator.performHealthCheck();
      
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('components');
      expect(health.components).toHaveProperty('circuitBreakers');
      expect(health.components).toHaveProperty('taskQueue');
    });
  });
});