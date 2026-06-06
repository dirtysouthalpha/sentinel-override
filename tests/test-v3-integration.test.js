/**
 * v3.0 Integration Tests
 * Comprehensive tests for v3.0 runtime components
 *
 * Tests cover: circuit breaker, task queue, state manager, load monitor, event bus, orchestrator
 */

// Setup chrome API mocks BEFORE any imports
const storageData = {};
global.chrome = {
  storage: {
    local: {
      get: (keys) => Promise.resolve(storageData),
      set: (data) => {
        Object.assign(storageData, data);
        return Promise.resolve();
      },
      remove: (keys) => {
        if (Array.isArray(keys)) {
          keys.forEach(key => delete storageData[key]);
        } else {
          delete storageData[keys];
        }
        return Promise.resolve();
      },
      clear: () => {
        Object.keys(storageData).forEach(key => delete storageData[key]);
        return Promise.resolve();
      }
    },
    session: {
      get: (keys) => Promise.resolve(storageData),
      set: (data) => {
        Object.assign(storageData, data);
        return Promise.resolve();
      },
      remove: (keys) => {
        if (Array.isArray(keys)) {
          keys.forEach(key => delete storageData[key]);
        } else {
          delete storageData[keys];
        }
        return Promise.resolve();
      },
      clear: () => {
        Object.keys(storageData).forEach(key => delete storageData[key]);
        return Promise.resolve();
      }
    }
  },
  runtime: {
    lastError: null
  }
};

// Setup IDBKeyRange mock
global.IDBKeyRange = {
  only: (value) => ({ value }),
  lowerBound: (value) => ({ value, type: 'lowerBound' }),
  upperBound: (value) => ({ value, type: 'upperBound' }),
  bound: (lower, upper) => ({ lower, upper, type: 'bound' })
};

// Setup indexedDB mock BEFORE any imports
const idbStores = {
  tasks: [],
  metadata: []
};

const createMockStore = (storeName) => {
  // Ensure store array exists
  if (!idbStores[storeName]) {
    idbStores[storeName] = [];
  }

  const createRequest = (result) => {
    const request = {
      onsuccess: null,
      onerror: null,
      result: result,
      error: null,
      readyState: 'pending'
    };

    // Trigger callback asynchronously after it's set
    setImmediate(() => {
      if (request.onsuccess) {
        request.onsuccess({ target: request });
        request.readyState = 'done';
      }
    });

    return request;
  };

  return {
    createIndex: (name, keyPath, options) => {},
    add: (data) => {
      const item = { ...data, id: data.id || Date.now() + Math.random() };
      idbStores[storeName].push(item);
      return createRequest(item);
    },
    put: (data) => {
      const index = idbStores[storeName].findIndex(t => t.id === data.id);
      if (index >= 0) {
        idbStores[storeName][index] = data;
      } else {
        idbStores[storeName].push({ ...data, id: data.id || Date.now() + Math.random() });
      }
      return createRequest(data);
    },
    get: (key) => {
      return createRequest(idbStores[storeName].find(t => t.id === key));
    },
    getAll: () => {
      return createRequest([...idbStores[storeName]]);
    },
    delete: (key) => {
      const index = idbStores[storeName].findIndex(t => t.id === key);
      if (index >= 0) {
        idbStores[storeName].splice(index, 1);
      }
      return createRequest(undefined);
    },
    clear: () => {
      idbStores[storeName].length = 0;
      return createRequest(undefined);
    },
    count: () => {
      return createRequest(idbStores[storeName].length);
    },
    index: (name) => {
      return {
        count: (keyRange) => {
          const value = keyRange?.value || keyRange;
          const filtered = idbStores[storeName].filter(t => t[name] === value);
          return createRequest(filtered.length);
        },
        get: (key) => {
          return createRequest(idbStores[storeName].filter(t => t[name] === key));
        },
        getAll: () => {
          return createRequest([...idbStores[storeName]]);
        },
        openCursor: (keyRange) => {
          const value = keyRange?.value || keyRange;
          const filtered = idbStores[storeName].filter(t => t[name] === value);
          let currentIndex = 0;

          const cursor = {
            value: null,
            key: null,
            continue: () => {},
            advance: () => {},
            delete: () => {},
            update: () => {}
          };

          const request = {
            onsuccess: null,
            onerror: null,
            result: null,
            error: null,
            readyState: 'pending'
          };

          // Set up cursor continue method
          cursor.continue = () => {
            currentIndex++;
            if (currentIndex < filtered.length) {
              const item = filtered[currentIndex];
              cursor.value = item;
              cursor.key = item.id;
              request.result = cursor;
              if (request.onsuccess) {
                request.onsuccess({ target: { result: cursor } });
              }
            } else {
              // No more items - signal end by setting result to undefined
              request.result = undefined;
              if (request.onsuccess) {
                request.onsuccess({ target: { result: undefined } });
              }
            }
          };

          // Simulate asynchronous cursor opening
          setImmediate(() => {
            if (filtered.length > 0) {
              const item = filtered[0];
              cursor.value = item;
              cursor.key = item.id;
              request.result = cursor;
            } else {
              request.result = undefined;
            }

            if (request.onsuccess) {
              request.onsuccess({ target: { result: request.result } });
            }
            request.readyState = 'done';
          });

          return request;
        }
      };
    }
  };
};

// Track created object stores
const createdStores = new Set();

global.indexedDB = {
  open: (dbName, version) => {
    // Create a database-like object
    const db = {
      close: () => {},
      createObjectStore: (name, options) => {
        createdStores.add(name);
        return createMockStore(name);
      },
      objectStoreNames: {
        contains: (name) => createdStores.has(name),
        length: createdStores.size
      },
      transaction: (storeNames, mode) => {
        const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
        const transaction = {
          objectStore: (name) => createMockStore(name),
          oncomplete: null,
          onerror: null,
          abort: () => {},
          db: db
        };
        return transaction;
      }
    };

    const request = {
      result: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
      error: null,
      readyState: 'pending'
    };

    // Simulate asynchronous database opening
    setImmediate(() => {
      // Trigger onupgradeneeded if needed
      if (request.onupgradeneeded) {
        request.onupgradeneeded({
          target: {
            result: db,
            oldVersion: 0,
            newVersion: version
          }
        });
      }
      // Then trigger onsuccess
      request.result = db;
      request.readyState = 'done';
      if (request.onsuccess) {
        request.onsuccess({ target: { result: db } });
      }
    });

    return request;
  },
  deleteDatabase: (dbName) => {
    const request = {
      onsuccess: null,
      onerror: null
    };
    setImmediate(() => {
      if (request.onsuccess) request.onsuccess({ target: {} });
    });
    return request;
  }
};

// Make indexedDB available globally without the 'global.' prefix
globalThis.indexedDB = global.indexedDB;
globalThis.IDBKeyRange = global.IDBKeyRange;

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

    test('closes from HALF_OPEN after 2 successes', async () => {
      const onResetCalls = [];
      const onStateChangeCalls = [];
      const breaker = new CircuitBreaker({
        name: 'test-close',
        failureThreshold: 1,
        resetTimeout: 50,
        onReset: (name) => onResetCalls.push(name),
        onStateChange: (name, state) => onStateChangeCalls.push([name, state]),
      });

      // Trip to OPEN
      try { await breaker.execute(async () => { throw new Error('trip'); }); } catch (e) {}
      expect(breaker.getState().state).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise(r => setTimeout(r, 80));

      // First success → stays HALF_OPEN (successCount = 1)
      await breaker.execute(async () => 'ok');
      expect(breaker.getState().state).toBe(CircuitState.HALF_OPEN);

      // Second success → transitions to CLOSED (successCount = 2)
      await breaker.execute(async () => 'ok2');
      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
      expect(onResetCalls).toContain('test-close');
    });

    test('returns to OPEN when operation fails in HALF_OPEN', async () => {
      const breaker = new CircuitBreaker({ name: 'test-reopen', failureThreshold: 1, resetTimeout: 50 });

      // Trip to OPEN
      try { await breaker.execute(async () => { throw new Error('trip'); }); } catch (e) {}
      await new Promise(r => setTimeout(r, 80));

      // First execute transitions to HALF_OPEN; now fail
      try { await breaker.execute(async () => { throw new Error('fail in half-open'); }); } catch (e) {}
      expect(breaker.getState().state).toBe(CircuitState.OPEN);
    });

    test('manual reset transitions to CLOSED from any state', () => {
      const onStateChangeCalls = [];
      const breaker = new CircuitBreaker({
        name: 'test-reset',
        failureThreshold: 1,
        resetTimeout: 9999,
        onStateChange: (name, state) => onStateChangeCalls.push([name, state]),
      });

      // Trip to OPEN
      breaker._onFailure();
      expect(breaker.getState().state).toBe(CircuitState.OPEN);

      // Manual reset
      breaker.reset();
      expect(breaker.getState().state).toBe(CircuitState.CLOSED);
      expect(breaker.getState().failureCount).toBe(0);
      expect(onStateChangeCalls).toContainEqual(['test-reset', CircuitState.CLOSED]);
    });

    test('onStateChange callback fires on trip', async () => {
      const onStateChangeCalls = [];
      const breaker = new CircuitBreaker({
        name: 'cb-test',
        failureThreshold: 1,
        resetTimeout: 9999,
        onStateChange: (name, state) => onStateChangeCalls.push([name, state]),
      });

      try { await breaker.execute(async () => { throw new Error('trip'); }); } catch (e) {}
      expect(onStateChangeCalls).toContainEqual(['cb-test', CircuitState.OPEN]);
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
      // Clear stores before each test
      idbStores.tasks = [];
      idbStores.metadata = [];
      createdStores.clear();

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

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

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

    test('rejects enqueue when queue is full', async () => {
      const smallQueue = new TaskQueue({ dbName: 'SmallQueue', maxQueueSize: 1 });
      await smallQueue.init();
      smallQueue.registerProcessor('overflow', async () => 'done');

      await smallQueue.enqueue({ type: 'overflow', payload: {} });
      // Second enqueue should be rejected
      await expect(smallQueue.enqueue({ type: 'overflow', payload: {} }))
        .rejects.toThrow('Task queue is full');

      // Drain any pending setTimeout(0) from smallQueue so they don't leak into the next test
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    test('fires onTaskComplete callback after successful task', async () => {
      const completedIds = [];
      taskQueue.onTaskComplete = (id, result) => completedIds.push(id);
      taskQueue.registerProcessor('callback_test', async () => 'done');

      const taskId = await taskQueue.enqueue({ type: 'callback_test', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(completedIds).toContain(taskId);
      taskQueue.onTaskComplete = null;
    });

    test('fires onTaskFailed callback after exhausting retries', async () => {
      const failedIds = [];
      taskQueue.onTaskFailed = (id) => failedIds.push(id);
      taskQueue.registerProcessor('fail_test', async () => { throw new Error('always fails'); });

      const taskId = await taskQueue.enqueue({
        type: 'fail_test',
        payload: {},
        maxAttempts: 2,
      });
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(failedIds).toContain(taskId);
      taskQueue.onTaskFailed = null;
    });

    test('purge resolves without error after completing tasks', async () => {
      taskQueue.registerProcessor('purge_test', async () => 'done');
      await taskQueue.enqueue({ type: 'purge_test', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Backdate completedAt so the task falls within the purge window
      idbStores.tasks.forEach(t => {
        if (t.state === 'completed') {
          t.completedAt = Date.now() - 9999999;
        }
      });

      // purge() returns undefined (void) — just verify it doesn't throw
      await expect(taskQueue.purge(1000)).resolves.toBeUndefined();
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

    test('off() removes regular and once subscribers', async () => {
      const bus = new EventBus();
      let regularCalled = false;
      let onceCalled = false;
      const regFn = () => { regularCalled = true; };
      const onceFn = () => { onceCalled = true; };

      bus.on('evt', regFn);
      bus.once('evt', onceFn);
      bus.off('evt', regFn);
      bus.off('evt', onceFn);

      await bus.emit('evt', {});
      expect(regularCalled).toBe(false);
      expect(onceCalled).toBe(false);
    });

    test('before() and after() middleware fire during emit', async () => {
      const bus = new EventBus();
      const log = [];

      bus.before(() => { log.push('before'); });
      bus.after(() => { log.push('after'); });
      bus.on('mw_test', () => { log.push('handler'); });

      await bus.emit('mw_test', {});
      expect(log).toEqual(['before', 'handler', 'after']);
    });

    test('subscriber error increments stats.failed', async () => {
      const bus = new EventBus();
      bus.on('fail_evt', () => { throw new Error('subscriber boom'); });

      await bus.emit('fail_evt', {});
      expect(bus.getStats().failed).toBe(1);
    });

    test('subscriber with context uses call()', async () => {
      const bus = new EventBus();
      const ctx = { value: 42 };
      let thisValue;
      bus.on('ctx_evt', function() { thisValue = this.value; }, { context: ctx });
      await bus.emit('ctx_evt', {});
      expect(thisValue).toBe(42);
    });

    test('subscriberCount returns total of regular + once', () => {
      const bus = new EventBus();
      bus.on('c_evt', () => {});
      bus.on('c_evt', () => {});
      bus.once('c_evt', () => {});
      expect(bus.subscriberCount('c_evt')).toBe(3);
      expect(bus.subscriberCount('no_evt')).toBe(0);
    });

    test('clear() removes all subscribers', async () => {
      const bus = new EventBus();
      let called = false;
      bus.on('cl_evt', () => { called = true; });
      bus.clear();
      await bus.emit('cl_evt', {});
      expect(called).toBe(false);
    });

    test('clearEvent() removes subscribers for one event only', async () => {
      const bus = new EventBus();
      let aCount = 0, bCount = 0;
      bus.on('evt_a', () => { aCount++; });
      bus.on('evt_b', () => { bCount++; });
      bus.clearEvent('evt_a');
      await bus.emit('evt_a', {});
      await bus.emit('evt_b', {});
      expect(aCount).toBe(0);
      expect(bCount).toBe(1);
    });

    test('disable() prevents emit and on(); enable() restores', async () => {
      const bus = new EventBus();
      let called = false;
      bus.on('en_evt', () => { called = true; });
      bus.disable();
      await bus.emit('en_evt', {});
      expect(called).toBe(false);
      bus.enable();
      await bus.emit('en_evt', {});
      expect(called).toBe(true);
    });

    test('history shifts when maxHistory exceeded', async () => {
      const bus = new EventBus({ maxHistory: 3 });
      await bus.emit('h1', {});
      await bus.emit('h2', {});
      await bus.emit('h3', {});
      await bus.emit('h4', {});
      const history = bus.getHistory(10);
      expect(history.length).toBe(3);
      expect(history[0].event).toBe('h2');
    });
  });
});

describe('v3.0 Load Monitor', () => {
  let LoadMonitor, LoadState, PerformanceTracker;

  beforeAll(async () => {
    const module = await import('../v3.0-integration/load-monitor.js');
    LoadMonitor = module.LoadMonitor;
    LoadState = module.LoadState;
    PerformanceTracker = module.PerformanceTracker;
  });

  describe('LoadMonitor state machine', () => {
    test('starts in NORMAL state', () => {
      const monitor = new LoadMonitor();
      expect(monitor.getCurrentState().state).toBe(LoadState.NORMAL);
    });

    test('transitions to HIGH after sustained RAM usage', () => {
      // pollInterval: 1000ms, sustainDuration: 3000ms → need 3 consecutive high readings
      const monitor = new LoadMonitor({
        ramHighThreshold: 80,
        ramNormalThreshold: 75,
        sustainDuration: 3000,
        pollInterval: 1000,
      });
      const highReading = { timestamp: Date.now(), cpu: 0, ram: 85, jsHeap: 0, jsHeapLimit: 0 };
      let newState;
      for (let i = 0; i < 3; i++) {
        newState = monitor._evaluateLoadState(highReading);
      }
      expect(newState).toBe(LoadState.HIGH);
    });

    test('transitions to CRITICAL when RAM > 90 after sustained usage', () => {
      const monitor = new LoadMonitor({
        ramHighThreshold: 80,
        ramNormalThreshold: 75,
        sustainDuration: 3000,
        pollInterval: 1000,
      });
      const critReading = { timestamp: Date.now(), cpu: 0, ram: 95, jsHeap: 0, jsHeapLimit: 0 };
      let newState;
      for (let i = 0; i < 3; i++) {
        newState = monitor._evaluateLoadState(critReading);
      }
      expect(newState).toBe(LoadState.CRITICAL);
    });

    test('transitions back to NORMAL from HIGH when load drops', () => {
      const monitor = new LoadMonitor({
        ramHighThreshold: 80, ramNormalThreshold: 75, sustainDuration: 0, pollInterval: 1000,
      });
      monitor.currentState = LoadState.HIGH;
      const lowReading = { timestamp: Date.now(), cpu: 0, ram: 50, jsHeap: 0, jsHeapLimit: 0 };
      const newState = monitor._evaluateLoadState(lowReading);
      expect(newState).toBe(LoadState.NORMAL);
    });

    test('fires onLoadHigh callback on HIGH state transition', () => {
      const readings = [];
      const monitor = new LoadMonitor({
        ramHighThreshold: 80, ramNormalThreshold: 75, sustainDuration: 0, pollInterval: 1000,
        onLoadHigh: (r) => readings.push(r),
      });
      const highReading = { timestamp: Date.now(), cpu: 0, ram: 85, jsHeap: 0, jsHeapLimit: 0 };
      monitor._handleStateChange(LoadState.HIGH, highReading);
      expect(readings).toHaveLength(1);
    });

    test('fires onLoadCritical callback on CRITICAL transition', () => {
      const readings = [];
      const monitor = new LoadMonitor({ onLoadCritical: (r) => readings.push(r) });
      monitor._handleStateChange(LoadState.CRITICAL, { ram: 95 });
      expect(readings).toHaveLength(1);
    });

    test('fires onLoadNormal callback when returning to NORMAL', () => {
      const readings = [];
      const monitor = new LoadMonitor({ onLoadNormal: (r) => readings.push(r) });
      monitor._handleStateChange(LoadState.NORMAL, { ram: 50 });
      expect(readings).toHaveLength(1);
    });

    test('isThrottled returns true for HIGH and CRITICAL', () => {
      const monitor = new LoadMonitor();
      monitor.currentState = LoadState.HIGH;
      expect(monitor.isThrottled()).toBe(true);
      monitor.currentState = LoadState.CRITICAL;
      expect(monitor.isThrottled()).toBe(true);
      monitor.currentState = LoadState.NORMAL;
      expect(monitor.isThrottled()).toBe(false);
    });

    test('getThrottlingRecommendation returns correct severity', () => {
      const monitor = new LoadMonitor();
      expect(monitor.getThrottlingRecommendation().severity).toBe('normal');
      monitor.currentState = LoadState.HIGH;
      expect(monitor.getThrottlingRecommendation().severity).toBe('high');
      monitor.currentState = LoadState.CRITICAL;
      expect(monitor.getThrottlingRecommendation().severity).toBe('critical');
    });

    test('getAverageUsage returns zeros when no readings', () => {
      const monitor = new LoadMonitor();
      expect(monitor.getAverageUsage()).toEqual({ cpu: 0, ram: 0, jsHeap: 0 });
    });

    test('getAverageUsage calculates averages from readings', () => {
      const monitor = new LoadMonitor();
      monitor._addReading({ timestamp: Date.now(), cpu: 20, ram: 40, jsHeap: 100 });
      monitor._addReading({ timestamp: Date.now(), cpu: 40, ram: 60, jsHeap: 200 });
      const avg = monitor.getAverageUsage();
      expect(avg.cpu).toBe(30);
      expect(avg.ram).toBe(50);
    });

    test('_addReading shifts oldest when maxReadings exceeded', () => {
      const monitor = new LoadMonitor();
      monitor.maxReadings = 3;
      for (let i = 0; i < 4; i++) {
        monitor._addReading({ timestamp: Date.now() + i, cpu: i, ram: i, jsHeap: 0 });
      }
      expect(monitor.readings.length).toBe(3);
      expect(monitor.readings[0].cpu).toBe(1); // first reading evicted
    });

    test('reset clears state and readings', () => {
      const monitor = new LoadMonitor();
      monitor.currentState = LoadState.HIGH;
      monitor._addReading({ timestamp: Date.now(), cpu: 90, ram: 90, jsHeap: 0 });
      monitor.reset();
      expect(monitor.currentState).toBe(LoadState.NORMAL);
      expect(monitor.readings.length).toBe(0);
    });

    test('start warns when already monitoring', async () => {
      const monitor = new LoadMonitor({ pollInterval: 10000 });
      const warnSpy = [];
      const orig = console.warn;
      console.warn = (...args) => warnSpy.push(args.join(' '));
      await monitor.start();
      await monitor.start(); // second call — should warn
      console.warn = orig;
      monitor.stop();
      expect(warnSpy.some(m => m.includes('Already monitoring'))).toBe(true);
    });
  });

  describe('PerformanceTracker', () => {
    test('tracks operation metrics', () => {
      const tracker = new PerformanceTracker();
      tracker.track('op1', 100);
      tracker.track('op1', 200);
      const m = tracker.getMetrics('op1');
      expect(m.count).toBe(2);
      expect(m.averageTime).toBe(150);
      expect(m.minTime).toBe(100);
      expect(m.maxTime).toBe(200);
    });

    test('getMetrics returns null for unknown operation', () => {
      const tracker = new PerformanceTracker();
      expect(tracker.getMetrics('unknown')).toBeNull();
    });

    test('getAllMetrics returns all tracked operations', () => {
      const tracker = new PerformanceTracker();
      tracker.track('a', 50);
      tracker.track('b', 100);
      expect(tracker.getAllMetrics().length).toBe(2);
    });

    test('getSlowOperations filters by threshold', () => {
      const tracker = new PerformanceTracker();
      tracker.track('fast', 10);
      tracker.track('slow', 2000);
      const slow = tracker.getSlowOperations(1000);
      expect(slow.map(s => s.operation)).toContain('slow');
      expect(slow.map(s => s.operation)).not.toContain('fast');
    });

    test('reset clears all metrics', () => {
      const tracker = new PerformanceTracker();
      tracker.track('op', 100);
      tracker.reset();
      expect(tracker.getAllMetrics().length).toBe(0);
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