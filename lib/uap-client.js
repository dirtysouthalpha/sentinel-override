/**
 * Universal Agent Protocol (UAP) Client SDK
 * 
 * JavaScript/TypeScript client for connecting to Sentinel Override UAP server.
 * Works in both browser and Node.js environments.
 * 
 * @version 10.0.0
 * @module lib/uap-client
 */

/**
 * UAP Client class
 */
class UAPClient {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || 'ws://localhost:8765/uap';
    this.authToken = options.authToken;
    this.timeout = options.timeout || 300000; // 5 minutes default
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    
    this.ws = null;
    this.connected = false;
    this.clientId = null;
    this.activeRuns = new Map(); // runId → { resolve, reject, onStep, onComplete, onError }
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.messageQueue = [];
    this.eventHandlers = new Map();
  }

  /**
   * Connect to UAP server
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // Create WebSocket connection
        this.ws = new WebSocket(this.serverUrl, 'uap');
        
        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('[UAP Client] Connected to server');
          
          // Send authentication
          this.sendAuth();
          
          // Process queued messages
          this.flushQueue();
          
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };
        
        this.ws.onerror = (error) => {
          console.error('[UAP Client] WebSocket error:', error);
          this.connected = false;
          reject(error);
        };
        
        this.ws.onclose = () => {
          this.connected = false;
          console.log('[UAP Client] Disconnected from server');

          if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          } else {
            // Reject all pending runs
            for (const [runId, run] of this.activeRuns.entries()) {
              try {
                run.reject(new Error('Connection closed'));
              } catch (e) {
                // Ignore errors from already settled promises
              }
            }
            this.activeRuns.clear();
          }
        };
        
        // Set connection timeout
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send authentication message
   */
  sendAuth() {
    this.send({
      type: 'auth',
      authToken: this.authToken
    });
  }

  /**
   * Schedule reconnection
   */
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    console.log(`[UAP Client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(error => {
        console.error('[UAP Client] Reconnect failed:', error);
      });
    }, delay);
  }

  /**
   * Handle incoming message
   */
  handleMessage(message) {
    const { type, id, payload } = message;
    
    // Emit event
    this.emit(type, message);
    
    switch (type) {
      case 'auth_accepted':
        this.clientId = payload.clientId;
        console.log('[UAP Client] Authenticated as', this.clientId);
        break;
        
      case 'goal_accepted':
        this.handleGoalAccepted(id, payload);
        break;
        
      case 'step_update':
        this.handleStepUpdate(id, payload);
        break;
        
      case 'goal_complete':
        this.handleGoalComplete(id, payload);
        break;
        
      case 'error':
        this.handleError(id, payload);
        break;
        
      case 'status_response':
        this.handleStatusResponse(id, payload);
        break;
        
      case 'cancel_accepted':
      case 'pause_accepted':
      case 'resume_accepted':
        // Acknowledgment messages
        console.log(`[UAP Client] ${type} for run ${id}`);
        break;
        
      case 'pong':
        // Ping/pong for connection health
        break;
        
      default:
        console.warn('[UAP Client] Unknown message type:', type);
    }
  }

  /**
   * Handle goal accepted response
   */
  handleGoalAccepted(id, payload) {
    const run = this.activeRuns.get(id);
    if (!run) return;
    
    run.runId = payload.runId;
    
    // Remap to runId for future messages
    this.activeRuns.set(payload.runId, run);
    this.activeRuns.delete(id);
  }

  /**
   * Handle step update
   */
  handleStepUpdate(id, payload) {
    const run = this.activeRuns.get(id);
    if (!run) return;
    
    if (run.onStep) {
      run.onStep(payload);
    }
  }

  /**
   * Handle goal completion
   */
  handleGoalComplete(id, payload) {
    const run = this.activeRuns.get(id);
    if (!run) return;
    
    if (payload.status === 'success') {
      if (run.onComplete) {
        run.onComplete(payload.result, payload.metrics);
      }
      run.resolve(payload.result);
    } else {
      const error = new Error(payload.error || 'Goal failed');
      error.recoverable = payload.recoverable;
      
      if (run.onError) {
        run.onError(error);
      }
      run.reject(error);
    }
    
    this.activeRuns.delete(id);
  }

  /**
   * Handle error message
   */
  handleError(id, payload) {
    const run = this.activeRuns.get(id);
    if (!run) return;
    
    const error = new Error(payload.message || 'Unknown error');
    error.code = payload.error;
    
    if (run.onError) {
      run.onError(error);
    }
    
    // Don't reject run if error is recoverable
    if (!payload.recoverable) {
      run.reject(error);
      this.activeRuns.delete(id);
    }
  }

  /**
   * Handle status response
   */
  handleStatusResponse(id, payload) {
    const run = this.activeRuns.get(id);
    if (!run) return;
    
    if (run.onStatus) {
      run.onStatus(payload);
    }
  }

  /**
   * Execute a goal
   */
  async execute(goal, callbacks = {}) {
    if (!this.connected) {
      throw new Error('Not connected to server. Call connect() first.');
    }
    
    if (!goal || typeof goal !== 'string' || goal.length < 10) {
      throw new Error('Invalid goal: must be a non-empty string');
    }
    
    const id = this.generateId();
    
    return new Promise((resolve, reject) => {
      // Store promise callbacks
      this.activeRuns.set(id, {
        resolve,
        reject,
        goal,
        onStep: callbacks.onStep,
        onComplete: callbacks.onComplete,
        onError: callbacks.onError,
        onStatus: callbacks.onStatus,
        startTime: Date.now()
      });
      
      // Send goal request
      this.send({
        type: 'goal_request',
        id,
        payload: {
          goal,
          context: callbacks.context || {},
          webhook: callbacks.webhook || null
        }
      });
      
      // Set timeout
      const timer = setTimeout(() => {
        if (this.activeRuns.has(id)) {
          this.activeRuns.delete(id);
          reject(new Error('Goal execution timeout'));
        }
      }, this.timeout);
      
      // Clear timeout on completion
      const originalResolve = resolve;
      const originalReject = reject;
      
      this.activeRuns.set(id, {
        ...this.activeRuns.get(id),
        resolve: (value) => {
          clearTimeout(timer);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          originalReject(error);
        }
      });
    });
  }

  /**
   * Get status of a run
   */
  async getStatus(runId) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }
    
    const id = this.generateId();
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Status request timeout'));
      }, 5000);
      
      // Setup one-time handler
      const handler = (message) => {
        if (message.type === 'status_response' && message.id === id) {
          clearTimeout(timer);
          this.removeEventListener('status_response', handler);
          resolve(message.payload);
        }
      };
      
      this.addEventListener('status_response', handler);
      
      this.send({
        type: 'status_request',
        id,
        payload: { runId }
      });
    });
  }

  /**
   * Pause a run
   */
  async pause(runId) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }
    
    return this.sendControlCommand('pause_request', runId);
  }

  /**
   * Resume a run
   */
  async resume(runId) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }
    
    return this.sendControlCommand('resume_request', runId);
  }

  /**
   * Cancel a run
   */
  async cancel(runId) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }
    
    return this.sendControlCommand('cancel_request', runId);
  }

  /**
   * Send control command
   */
  async sendControlCommand(type, runId) {
    const id = this.generateId();
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Command timeout'));
      }, 5000);
      
      const handler = (message) => {
        if (message.type === type.replace('_request', '_accepted') && message.id === id) {
          clearTimeout(timer);
          this.removeEventListener(type.replace('_request', '_accepted'), handler);
          resolve(message);
        }
      };
      
      this.addEventListener(type.replace('_request', '_accepted'), handler);
      
      this.send({
        type,
        id,
        payload: { runId }
      });
    });
  }

  /**
   * Send message to server
   */
  send(message) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for when connected
      this.messageQueue.push(message);
    }
  }

  /**
   * Flush queued messages
   */
  flushQueue() {
    // Process all queued messages (O(n) instead of O(n²) with repeated shift)
    const queue = this.messageQueue;
    this.messageQueue = [];
    for (const message of queue) {
      this.send(message);
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  }

  /**
   * Add event listener
   */
  addEventListener(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Remove event listener
   */
  removeEventListener(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error('[UAP Client] Event handler error:', error);
        }
      }
    }
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this.autoReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending runs BEFORE closing the WebSocket
    // to avoid double-rejection when onclose fires
    for (const [runId, run] of this.activeRuns.entries()) {
      run.reject(new Error('Client disconnected'));
    }
    this.activeRuns.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.clientId = null;
  }

  /**
   * Check connection health
   */
  async ping() {
    if (!this.connected) {
      return false;
    }
    
    const id = this.generateId();
    
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      
      const handler = (message) => {
        if (message.type === 'pong' && message.id === id) {
          clearTimeout(timer);
          this.removeEventListener('pong', handler);
          resolve(true);
        }
      };
      
      this.addEventListener('pong', handler);
      
      this.send({
        type: 'ping',
        id
      });
    });
  }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  // Node.js
  module.exports = { UAPClient };
} else if (typeof window !== 'undefined') {
  // Browser
  window.UAPClient = UAPClient;
}

// Export for ES modules
export { UAPClient };

/**
 * Example usage:
 * 
 * ```javascript
 * import { UAPClient } from '@sentinel-override/uap-client';
 * 
 * const client = new UAPClient({
 *   serverUrl: 'ws://localhost:8765/uap',
 *   authToken: 'your_api_token',
 *   timeout: 300000
 * });
 * 
 * await client.connect();
 * 
 * const result = await client.execute({
 *   goal: 'Pull user sign-in events from Entra',
 *   context: {
 *     tenant: 'acme.onmicrosoft.com',
 *     budget: 150
 *   },
 *   onStep: (step) => {
 *     console.log(`Step ${step.step}/${step.total}: ${step.action}`);
 *   },
 *   onComplete: (result, metrics) => {
 *     console.log('Done:', result.summary);
 *     console.log('Trust score:', result.trust_score);
 *   }
 * });
 * 
 * await client.disconnect();
 * ```
 */
