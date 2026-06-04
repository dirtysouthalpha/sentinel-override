/**
 * Event Bus - JavaScript implementation of v3.0 event bus
 * Provides publish/subscribe messaging between components
 * 
 * Based on Python v3.0 implementation with Chrome extension adaptations
 */

/**
 * Event Bus class for component communication
 */
class EventBus {
  constructor(options = {}) {
    this.subscribers = new Map(); // event -> Set of callbacks
    this.onceSubscribers = new Map(); // event -> Set of one-time callbacks
    this.history = []; // Event history for debugging
    this.maxHistory = options.maxHistory || 100;
    this.enabled = options.enabled !== false; // Default enabled
    
    // Event handlers for middleware
    this.beforeHandlers = [];
    this.afterHandlers = [];
    
    // Statistics
    this.stats = {
      published: 0,
      delivered: 0,
      failed: 0
    };
  }

  /**
   * Subscribe to an event
   */
  on(event, callback, options = {}) {
    if (!this.enabled) return this;

    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }

    const subscriber = {
      callback,
      once: false,
      priority: options.priority || 0,
      context: options.context || null
    };

    this.subscribers.get(event).add(subscriber);
    
    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Subscribe to one-time event
   */
  once(event, callback, options = {}) {
    if (!this.enabled) return this;

    if (!this.onceSubscribers.has(event)) {
      this.onceSubscribers.set(event, new Set());
    }

    const subscriber = {
      callback,
      once: true,
      priority: options.priority || 0,
      context: options.context || null
    };

    this.onceSubscribers.get(event).add(subscriber);
    
    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   */
  off(event, callback) {
    if (!this.enabled) return this;

    // Remove from regular subscribers
    const regularSet = this.subscribers.get(event);
    if (regularSet) {
      for (const sub of regularSet) {
        if (sub.callback === callback) {
          regularSet.delete(sub);
          break;
        }
      }
    }

    // Remove from once subscribers
    const onceSet = this.onceSubscribers.get(event);
    if (onceSet) {
      for (const sub of onceSet) {
        if (sub.callback === callback) {
          onceSet.delete(sub);
          break;
        }
      }
    }
  }

  /**
   * Publish an event
   */
  async emit(event, data, options = {}) {
    if (!this.enabled) return this;

    this.stats.published++;

    const eventData = {
      event,
      data,
      timestamp: Date.now(),
      source: options.source || 'unknown'
    };

    // Add to history
    this._addToHistory(eventData);

    // Run before handlers
    for (const handler of this.beforeHandlers) {
      try {
        await handler(event, data);
      } catch (error) {
        console.error('[EventBus] Before handler error:', error);
      }
    }

    // Process regular subscribers
    await this._deliverToSubscribers(this.subscribers.get(event), eventData);

    // Process once subscribers
    const onceSet = this.onceSubscribers.get(event);
    if (onceSet && onceSet.size > 0) {
      await this._deliverToSubscribers(onceSet, eventData);
      // Clear once subscribers after delivery
      this.onceSubscribers.delete(event);
    }

    // Run after handlers
    for (const handler of this.afterHandlers) {
      try {
        await handler(event, data);
      } catch (error) {
        console.error('[EventBus] After handler error:', error);
      }
    }

    return eventData;
  }

  /**
   * Deliver event to a set of subscribers
   */
  async _deliverToSubscribers(subscribers, eventData) {
    if (!subscribers || subscribers.size === 0) return;

    // Sort by priority (higher priority first)
    const sorted = Array.from(subscribers).sort((a, b) => b.priority - a.priority);

    for (const sub of sorted) {
      try {
        // Call callback with context if provided
        if (sub.context) {
          await sub.callback.call(sub.context, eventData.data, eventData.event);
        } else {
          await sub.callback(eventData.data, eventData.event);
        }
        this.stats.delivered++;
      } catch (error) {
        this.stats.failed++;
        console.error(`[EventBus] Error delivering to subscriber for '${eventData.event}':`, error);
      }
    }
  }

  /**
   * Add event to history
   */
  _addToHistory(eventData) {
    this.history.push(eventData);
    
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Add before middleware handler
   */
  before(handler) {
    this.beforeHandlers.push(handler);
    return () => {
      const index = this.beforeHandlers.indexOf(handler);
      if (index >= 0) this.beforeHandlers.splice(index, 1);
    };
  }

  /**
   * Add after middleware handler
   */
  after(handler) {
    this.afterHandlers.push(handler);
    return () => {
      const index = this.afterHandlers.indexOf(handler);
      if (index >= 0) this.afterHandlers.splice(index, 1);
    };
  }

  /**
   * Get event history
   */
  getHistory(count = 20) {
    return this.history.slice(-count);
  }

  /**
   * Get subscriber count for an event
   */
  subscriberCount(event) {
    const regular = this.subscribers.has(event) ? this.subscribers.get(event).size : 0;
    const once = this.onceSubscribers.has(event) ? this.onceSubscribers.get(event).size : 0;
    return regular + once;
  }

  /**
   * Get all events with subscribers
   */
  getEvents() {
    const events = new Set();
    
    this.subscribers.forEach((_, event) => events.add(event));
    this.onceSubscribers.forEach((_, event) => events.add(event));
    
    return Array.from(events);
  }

  /**
   * Clear all subscribers
   */
  clear() {
    this.subscribers.clear();
    this.onceSubscribers.clear();
  }

  /**
   * Clear subscribers for specific event
   */
  clearEvent(event) {
    this.subscribers.delete(event);
    this.onceSubscribers.delete(event);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      events: this.getEvents().length,
      historySize: this.history.length,
      subscribers: Array.from(this.subscribers.entries()).map(([event, set]) => ({
        event,
        count: set.size
      }))
    };
  }

  /**
   * Enable event bus
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable event bus
   */
  disable() {
    this.enabled = false;
  }

  /**
   * Create scoped event bus (prefixed events)
   */
  scope(prefix) {
    const scoped = new EventBus({ enabled: this.enabled });
    
    // Proxy emit through to parent with prefix
    scoped.emit = async (event, data, options = {}) => {
      const scopedEvent = `${prefix}:${event}`;
      return this.emit(scopedEvent, data, options);
    };
    
    return scoped;
  }
}

/**
 * Event Types - Standard event names for Sentinel Override
 */
const EventTypes = {
  // Agent lifecycle
  AGENT_START: 'agent.start',
  AGENT_STOP: 'agent.stop',
  AGENT_PAUSE: 'agent.pause',
  AGENT_RESUME: 'agent.resume',
  
  // Agent actions
  ACTION_START: 'action.start',
  ACTION_COMPLETE: 'action.complete',
  ACTION_FAILED: 'action.failed',
  
  // Planning
  PLAN_GENERATED: 'plan.generated',
  PLAN_UPDATED: 'plan.updated',
  
  // State changes
  STATE_CHANGE: 'state.change',
  STATE_SAVE: 'state.save',
  STATE_LOAD: 'state.load',
  
  // Load monitoring
  LOAD_HIGH: 'load.high',
  LOAD_NORMAL: 'load.normal',
  LOAD_CRITICAL: 'load.critical',
  
  // Circuit breaker
  CIRCUIT_TRIP: 'circuit.trip',
  CIRCUIT_RESET: 'circuit.reset',
  CIRCUIT_STATE_CHANGE: 'circuit.state_change',
  
  // Task queue
  TASK_ENQUEUED: 'task.enqueued',
  TASK_COMPLETE: 'task.complete',
  TASK_FAILED: 'task.failed',
  
  // Errors
  ERROR: 'error',
  ERROR_RECOVERED: 'error.recovered'
};

/**
 * Create global event bus instance
 */
const globalEventBus = new EventBus();

export { EventBus, EventTypes, globalEventBus };