/**
 * Circuit Breaker - JavaScript implementation of v3.0 circuit breaker pattern
 * Prevents cascading failures by tripping after threshold failures
 * 
 * Based on Python v3.0 implementation with Chrome extension adaptations
 */

// Circuit breaker states
const CircuitState = {
  CLOSED: 'closed',     // Normal operation
  OPEN: 'open',         // Tripped, blocking requests
  HALF_OPEN: 'half_open' // Testing if service recovered
};

/**
 * Circuit Breaker class for failure detection and automatic recovery
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute default
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 3;
    this.halfOpenAttempts = 0;
    
    // Event callbacks
    this.onStateChange = options.onStateChange || null;
    this.onTrip = options.onTrip || null;
    this.onReset = options.onReset || null;
  }

  /**
   * Execute an operation with circuit breaker protection
   */
  async execute(operation) {
    if (this.state === CircuitState.OPEN) {
      if (this._shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenAttempts = 0;
        this._notifyStateChange();
      } else {
        throw new Error(`Circuit breaker '${this.name}' is OPEN`);
      }
    }

    try {
      const result = await operation();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure();
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  _onSuccess() {
    this.failureCount = 0;
    this.lastFailureTime = null;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      this.halfOpenAttempts++;
      
      // If we succeed enough times in half-open, reset to closed
      if (this.successCount >= 2) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        this.halfOpenAttempts = 0;
        this._notifyStateChange();
        if (this.onReset) this.onReset(this.name);
      }
    }
  }

  /**
   * Record a failed operation
   */
  _onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    // Trip the breaker if threshold exceeded
    if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this._notifyStateChange();
      if (this.onTrip) this.onTrip(this.name, this.failureCount);
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Failed in half-open, go back to open
      this.state = CircuitState.OPEN;
      this.halfOpenAttempts = 0;
      this._notifyStateChange();
    }
  }

  /**
   * Check if enough time has passed to attempt a reset
   */
  _shouldAttemptReset() {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime >= this.resetTimeout;
  }

  /**
   * Get current breaker state
   */
  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      successCount: this.successCount
    };
  }

  /**
   * Manually reset the breaker to closed state
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this._notifyStateChange();
  }

  /**
   * Notify state change listeners
   */
  _notifyStateChange() {
    console.log(`[CircuitBreaker] '${this.name}' state: ${this.state}`);
    if (this.onStateChange) {
      this.onStateChange(this.name, this.state);
    }
  }
}

/**
 * Circuit Breaker Registry - Manage multiple breakers
 */
class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker
   */
  get(name, options = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...options }));
    }
    return this.breakers.get(name);
  }

  /**
   * Get status of all breakers
   */
  getAllStatus() {
    const status = {};
    this.breakers.forEach((breaker, name) => {
      status[name] = breaker.getState();
    });
    return status;
  }

  /**
   * Reset all breakers
   */
  resetAll() {
    this.breakers.forEach(breaker => breaker.reset());
  }

  /**
   * Get only open (tripped) breakers
   */
  getOpenBreakers() {
    const open = [];
    this.breakers.forEach((breaker, name) => {
      if (breaker.state === CircuitState.OPEN) {
        open.push(name);
      }
    });
    return open;
  }
}

// Global registry instance
const globalRegistry = new CircuitBreakerRegistry();

export { CircuitBreaker, CircuitBreakerRegistry, CircuitState, globalRegistry };