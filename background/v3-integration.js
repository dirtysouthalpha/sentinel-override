/**
 * v3.0 Integration Layer
 * Bridges v3.0 runtime components with existing v4.0.2 agent engine
 * 
 * This file integrates the new v3.0 components (circuit breaker, task queue,
 * state manager, load monitor, event bus) into the existing v4.0.2 architecture
 * without breaking existing functionality.
 */

import { V3RuntimeOrchestrator, globalOrchestrator } from '../v3.0-integration/orchestrator.js';
import { EventTypes } from '../v3.0-integration/event-bus.js';

// Track initialization state
let v3Initialized = false;
let v3Orchestrator = null;

/**
 * Initialize v3.0 runtime components
 * Called during agent startup to prepare circuit breakers, state management, etc.
 */
export async function initializeV3Runtime(options = {}) {
  if (v3Initialized) {
    console.warn('[V3Integration] Already initialized');
    return v3Orchestrator;
  }

  try {
    console.log('[V3Integration] Initializing v3.0 runtime components...');
    
    // Create orchestrator instance
    v3Orchestrator = new V3RuntimeOrchestrator({
      enabled: true,
      config: options.config,
      eventBus: options.eventBus
    });

    // Initialize all components
    await v3Orchestrator.initialize();
    
    v3Initialized = true;
    console.log('[V3Integration] v3.0 runtime initialization complete');
    
    // Set up global reference for access from other modules
    if (typeof globalThis !== 'undefined') {
      globalThis.v3Orchestrator = v3Orchestrator;
    }
    
    return v3Orchestrator;
    
  } catch (error) {
    console.error('[V3Integration] Failed to initialize v3.0 runtime:', error);
    throw error;
  }
}

/**
 * Get v3.0 orchestrator instance
 * Returns the global orchestrator if initialized, null otherwise
 */
export function getV3Orchestrator() {
  return v3Orchestrator || globalOrchestrator;
}

/**
 * Execute operation with circuit breaker protection
 * Wraps LLM API calls, Chrome API calls, and content script communication
 */
export async function executeWithBreaker(breakerName, operationFn) {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    // Fall back to direct execution if v3 not initialized
    console.warn('[V3Integration] v3.0 runtime not initialized, executing without breaker');
    return await operationFn();
  }
  
  return await orchestrator.executeWithBreaker(breakerName, operationFn);
}

/**
 * Save agent state using v3.0 state manager
 * Integrates with existing checkpoint/persistence system
 */
export async function saveV3State(state) {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    console.warn('[V3Integration] v3.0 runtime not initialized, skipping state save');
    return false;
  }
  
  return await orchestrator.saveAgentState(state);
}

/**
 * Load agent state using v3.0 state manager
 */
export async function loadV3State() {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    console.warn('[V3Integration] v3.0 runtime not initialized, skipping state load');
    return null;
  }
  
  return await orchestrator.loadAgentState();
}

/**
 * Create state checkpoint using v3.0 state manager
 */
export async function createV3Checkpoint(checkpointId, state) {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    console.warn('[V3Integration] v3.0 runtime not initialized, skipping checkpoint');
    return false;
  }
  
  return await orchestrator.createCheckpoint(checkpointId, state);
}

/**
 * Enqueue background task using v3.0 task queue
 */
export async function enqueueV3Task(task) {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    console.warn('[V3Integration] v3.0 runtime not initialized, skipping task enqueue');
    return null;
  }
  
  return await orchestrator.enqueueTask(task);
}

/**
 * Check if system is under high load
 */
export function isSystemThrottled() {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    return false;
  }
  
  const loadMonitor = orchestrator.loadMonitor;
  return loadMonitor ? loadMonitor.isThrottled() : false;
}

/**
 * Get throttling recommendations based on current system load
 */
export function getThrottlingRecommendations() {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    return { shouldThrottle: false, severity: 'normal', recommendations: [] };
  }
  
  const loadMonitor = orchestrator.loadMonitor;
  return loadMonitor ? loadMonitor.getThrottlingRecommendation() : { shouldThrottle: false };
}

/**
 * Emit event using v3.0 event bus
 */
export async function emitV3Event(eventType, data) {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    return;
  }
  
  await orchestrator.eventBus.emit(eventType, data);
}

/**
 * Subscribe to v3.0 events
 */
export function subscribeToV3Event(eventType, callback) {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    return () => {}; // Return no-op unsubscribe function
  }
  
  return orchestrator.eventBus.on(eventType, callback);
}

/**
 * Get v3.0 runtime status
 */
export function getV3Status() {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    return {
      initialized: false,
      enabled: false,
      components: {}
    };
  }
  
  return orchestrator.getStatus();
}

/**
 * Shutdown v3.0 runtime
 */
export async function shutdownV3Runtime() {
  if (!v3Initialized || !v3Orchestrator) {
    return;
  }
  
  console.log('[V3Integration] Shutting down v3.0 runtime...');
  await v3Orchestrator.shutdown();
  
  v3Initialized = false;
  v3Orchestrator = null;
  
  if (typeof globalThis !== 'undefined') {
    delete globalThis.v3Orchestrator;
  }
  
  console.log('[V3Integration] v3.0 runtime shutdown complete');
}

/**
 * Integration helpers for common operations
 */

/**
 * Wrap LLM call with circuit breaker protection
 */
export async function protectedLLMCall(llmFunction) {
  return await executeWithBreaker('llm-api', llmFunction);
}

/**
 * Wrap Chrome API call with circuit breaker protection  
 */
export async function protectedChromeCall(chromeFunction) {
  return await executeWithBreaker('chrome-api', chromeFunction);
}

/**
 * Wrap content script communication with circuit breaker protection
 */
export async function protectedContentScriptCall(scriptFunction) {
  return await executeWithBreaker('content-script', scriptFunction);
}

/**
 * Emit agent action event for tracking
 */
export async function trackAgentAction(action, details) {
  await emitV3Event(EventTypes.ACTION_COMPLETE, {
    action,
    timestamp: Date.now(),
    ...details
  });
}

/**
 * Emit agent error event
 */
export async function reportAgentError(error, context) {
  await emitV3Event(EventTypes.ERROR, {
    error: error.message || error,
    context,
    timestamp: Date.now()
  });
}

/**
 * Background health check task
 * Can be enqueued to run periodic health checks
 */
export async function performHealthCheck() {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    return { status: 'unavailable' };
  }
  
  return await orchestrator.performHealthCheck();
}

/**
 * Memory cleanup task
 * Can be enqueued to run periodic memory cleanup
 */
export async function performMemoryCleanup() {
  const orchestrator = getV3Orchestrator();
  if (!orchestrator || !v3Initialized) {
    return { cleaned: 0 };
  }
  
  return await orchestrator.performMemoryCleanup();
}

// Export initialization state
export { v3Initialized, v3Orchestrator };