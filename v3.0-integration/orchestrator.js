/**
 * v3.0 Runtime Orchestrator - Integration layer for v3.0 components
 * Coordinates circuit breaker, task queue, state management, load monitoring, and event bus
 * 
 * This is the main integration point that bridges v3.0 Python runtime functionality
 * with the existing v4.0.2 JavaScript Chrome extension architecture.
 */

import { CircuitBreaker, CircuitBreakerRegistry, CircuitState } from './circuit-breaker.js';
import { TaskQueue, TaskPriority, TaskState } from './task-queue.js';
import { StateManager, HistoryManager } from './state-manager.js';
import { LoadMonitor, LoadState, PerformanceTracker } from './load-monitor.js';
import { EventBus, EventTypes, globalEventBus } from './event-bus.js';

/**
 * v3.0 Runtime Orchestrator - Main integration coordinator
 */
class V3RuntimeOrchestrator {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.initialized = false;
    
    // Component instances
    this.circuitBreakers = new CircuitBreakerRegistry();
    this.taskQueue = null;
    this.stateManager = null;
    this.historyManager = new HistoryManager(options.history);
    this.loadMonitor = null;
    this.performanceTracker = new PerformanceTracker();
    this.eventBus = options.eventBus || globalEventBus;
    
    // Configuration
    this.config = {
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 60000,
        halfOpenMaxAttempts: 3
      },
      taskQueue: {
        concurrency: 3,
        maxQueueSize: 1000
      },
      loadMonitor: {
        cpuHighThreshold: 80,
        cpuNormalThreshold: 60,
        ramHighThreshold: 85,
        ramNormalThreshold: 75,
        pollInterval: 5000
      },
      stateManager: {
        compressionEnabled: true,
        maxHistorySize: 100
      }
    };
    
    // Merge user config
    if (options.config) {
      this.config = this._mergeConfig(this.config, options.config);
    }
  }

  /**
   * Initialize all v3.0 components
   */
  async initialize() {
    if (this.initialized) {
      console.warn('[V3Orchestrator] Already initialized');
      return;
    }

    try {
      // Initialize load monitor
      this.loadMonitor = new LoadMonitor({
        ...this.config.loadMonitor,
        onLoadHigh: (reading) => this._handleLoadHigh(reading),
        onLoadNormal: (reading) => this._handleLoadNormal(reading),
        onLoadCritical: (reading) => this._handleLoadCritical(reading)
      });
      
      // Initialize task queue
      this.taskQueue = new TaskQueue({
        ...this.config.taskQueue,
        onTaskComplete: (taskId, result) => this._handleTaskComplete(taskId, result),
        onTaskFailed: (taskId, error) => this._handleTaskFailed(taskId, error)
      });
      await this.taskQueue.init();
      
      // Initialize state manager
      this.stateManager = new StateManager({
        ...this.config.stateManager
      });
      
      // Setup circuit breakers for common operations
      this._setupCircuitBreakers();
      
      // Register default task processors
      this._registerDefaultTaskProcessors();
      
      // Setup event subscriptions
      this._setupEventSubscriptions();
      
      // Start load monitoring
      if (this.config.loadMonitor.enabled !== false) {
        await this.loadMonitor.start();
      }
      
      this.initialized = true;
      console.log('[V3Orchestrator] Initialized successfully');
      
      // Emit initialization event
      await this.eventBus.emit(EventTypes.AGENT_START, {
        orchestrator: 'v3.0-runtime',
        version: '1.0.0'
      });
      
    } catch (error) {
      console.error('[V3Orchestrator] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Setup circuit breakers for common operations
   */
  _setupCircuitBreakers() {
    // LLM API calls breaker
    this.circuitBreakers.get('llm-api', {
      failureThreshold: this.config.circuitBreaker.failureThreshold,
      resetTimeout: this.config.circuitBreaker.resetTimeout,
      onTrip: (name) => {
        console.error(`[V3Orchestrator] Circuit breaker '${name}' tripped`);
        this.eventBus.emit(EventTypes.CIRCUIT_TRIP, { breaker: name });
      },
      onReset: (name) => {
        console.log(`[V3Orchestrator] Circuit breaker '${name}' reset`);
        this.eventBus.emit(EventTypes.CIRCUIT_RESET, { breaker: name });
      }
    });

    // Chrome API breaker
    this.circuitBreakers.get('chrome-api', {
      failureThreshold: this.config.circuitBreaker.failureThreshold,
      resetTimeout: this.config.circuitBreaker.resetTimeout
    });

    // Content script breaker
    this.circuitBreakers.get('content-script', {
      failureThreshold: this.config.circuitBreaker.failureThreshold,
      resetTimeout: this.config.circuitBreaker.resetTimeout
    });
  }

  /**
   * Register default task processors
   */
  _registerDefaultTaskProcessors() {
    // Health check processor
    this.taskQueue.registerProcessor('health_check', async (payload) => {
      return await this.performHealthCheck();
    });

    // State save processor
    this.taskQueue.registerProcessor('state_save', async (payload) => {
      return await this.saveAgentState(payload.state);
    });

    // Memory cleanup processor
    this.taskQueue.registerProcessor('memory_cleanup', async (payload) => {
      return await this.performMemoryCleanup();
    });
  }

  /**
   * Setup event subscriptions
   */
  _setupEventSubscriptions() {
    // Subscribe to action events for tracking
    this.eventBus.on(EventTypes.ACTION_COMPLETE, (data) => {
      this.performanceTracker.track(data.action || 'unknown', data.duration || 0);
    });

    // Subscribe to circuit breaker events
    this.eventBus.on(EventTypes.CIRCUIT_TRIP, (data) => {
      console.warn('[V3Orchestrator] Circuit breaker tripped:', data.breaker);
    });

    // Subscribe to load events
    this.eventBus.on(EventTypes.LOAD_CRITICAL, (data) => {
      console.error('[V3Orchestrator] Critical load detected, activating emergency measures');
    });
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async executeWithBreaker(breakerName, operation) {
    const breaker = this.circuitBreakers.get(breakerName);
    return await breaker.execute(operation);
  }

  /**
   * Enqueue background task
   */
  async enqueueTask(task) {
    if (!this.initialized) {
      throw new Error('V3Orchestrator not initialized');
    }

    const taskId = await this.taskQueue.enqueue(task);
    await this.eventBus.emit(EventTypes.TASK_ENQUEUED, { taskId, task });
    return taskId;
  }

  /**
   * Save agent state
   */
  async saveAgentState(state) {
    if (!this.initialized) {
      throw new Error('V3Orchestrator not initialized');
    }

    const success = await this.stateManager.saveState(state);
    if (success) {
      await this.eventBus.emit(EventTypes.STATE_SAVE, { state });
    }
    return success;
  }

  /**
   * Load agent state
   */
  async loadAgentState() {
    if (!this.initialized) {
      throw new Error('V3Orchestrator not initialized');
    }

    const state = await this.stateManager.loadState();
    if (state) {
      await this.eventBus.emit(EventTypes.STATE_LOAD, { state });
    }
    return state;
  }

  /**
   * Create state checkpoint
   */
  async createCheckpoint(checkpointId, state) {
    if (!this.initialized) {
      throw new Error('V3Orchestrator not initialized');
    }

    return await this.stateManager.createCheckpoint(checkpointId, state);
  }

  /**
   * Load checkpoint
   */
  async loadCheckpoint(checkpointId) {
    if (!this.initialized) {
      throw new Error('V3Orchestrator not initialized');
    }

    return await this.stateManager.loadCheckpoint(checkpointId);
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    const health = {
      status: 'healthy',
      components: {},
      timestamp: Date.now()
    };

    // Check circuit breakers
    const breakerStatus = this.circuitBreakers.getAllStatus();
    const openBreakers = this.circuitBreakers.getOpenBreakers();
    
    health.components.circuitBreakers = {
      status: openBreakers.length === 0 ? 'healthy' : 'degraded',
      openBreakers,
      details: breakerStatus
    };

    // Check task queue
    const queueStats = await this.taskQueue.getStats();
    health.components.taskQueue = {
      status: queueStats.pending < 100 ? 'healthy' : 'degraded',
      stats: queueStats
    };

    // Check load monitor
    const loadState = this.loadMonitor.getCurrentState();
    health.components.loadMonitor = {
      status: loadState.state === 'normal' ? 'healthy' : 'degraded',
      state: loadState
    };

    // Check state manager
    const hasState = await this.stateManager.hasState();
    const stateMetadata = await this.stateManager.getStateMetadata();
    health.components.stateManager = {
      status: hasState ? 'healthy' : 'unknown',
      metadata: stateMetadata
    };

    // Overall health
    const componentHealth = Object.values(health.components);
    const degradedCount = componentHealth.filter(c => c.status === 'degraded').length;
    
    if (degradedCount > 0) {
      health.status = degradedCount > 2 ? 'unhealthy' : 'degraded';
    }

    return health;
  }

  /**
   * Perform memory cleanup
   */
  async performMemoryCleanup() {
    const cleaned = {
      taskQueue: 0,
      checkpoints: 0,
      timestamp: Date.now()
    };

    // Purge old tasks
    const purgedTasks = await this.taskQueue.purge(3600000); // 1 hour
    cleaned.taskQueue = purgedTasks;

    // Clean old checkpoints
    const checkpoints = await this.stateManager.listCheckpoints();
    const oldCheckpoints = checkpoints.filter(cp => cp.age > 86400000); // 24 hours
    
    for (const cp of oldCheckpoints) {
      await this.stateManager.deleteCheckpoint(cp.id);
      cleaned.checkpoints++;
    }

    return cleaned;
  }

  /**
   * Handle high load condition
   */
  _handleLoadHigh(reading) {
    this.eventBus.emit(EventTypes.LOAD_HIGH, { reading });
    
    // Implement throttling recommendations
    const recommendation = this.loadMonitor.getThrottlingRecommendation();
    console.warn('[V3Orchestrator] High load detected:', recommendation);
  }

  /**
   * Handle normal load condition
   */
  _handleLoadNormal(reading) {
    this.eventBus.emit(EventTypes.LOAD_NORMAL, { reading });
    console.log('[V3Orchestrator] Load returned to normal');
  }

  /**
   * Handle critical load condition
   */
  _handleLoadCritical(reading) {
    this.eventBus.emit(EventTypes.LOAD_CRITICAL, { reading });
    console.error('[V3Orchestrator] Critical load - emergency measures activated');
  }

  /**
   * Handle task completion
   */
  _handleTaskComplete(taskId, result) {
    this.eventBus.emit(EventTypes.TASK_COMPLETE, { taskId, result });
  }

  /**
   * Handle task failure
   */
  _handleTaskFailed(taskId, error) {
    this.eventBus.emit(EventTypes.TASK_FAILED, { taskId, error });
  }

  /**
   * Get orchestrator status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      enabled: this.enabled,
      components: {
        circuitBreakers: this.circuitBreakers.getAllStatus(),
        loadMonitor: this.loadMonitor ? this.loadMonitor.getCurrentState() : null,
        performanceTracker: this.performanceTracker.getAllMetrics()
      },
      eventStats: this.eventBus.getStats()
    };
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown() {
    if (!this.initialized) {
      return;
    }

    console.log('[V3Orchestrator] Shutting down...');

    // Stop load monitoring
    if (this.loadMonitor) {
      this.loadMonitor.stop();
    }

    // Save final state
    // (This would be implemented based on agent state)

    this.initialized = false;
    console.log('[V3Orchestrator] Shutdown complete');
  }

  /**
   * Merge configuration objects
   */
  _mergeConfig(base, overrides) {
    return {
      circuitBreaker: { ...base.circuitBreaker, ...overrides.circuitBreaker },
      taskQueue: { ...base.taskQueue, ...overrides.taskQueue },
      loadMonitor: { ...base.loadMonitor, ...overrides.loadMonitor },
      stateManager: { ...base.stateManager, ...overrides.stateManager }
    };
  }
}

/**
 * Create global orchestrator instance
 */
const globalOrchestrator = new V3RuntimeOrchestrator();

export { V3RuntimeOrchestrator, globalOrchestrator };