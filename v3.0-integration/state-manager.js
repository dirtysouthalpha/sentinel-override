/**
 * State Manager - JavaScript implementation of v3.0 state management
 * Provides persistence and recovery for agent runtime state
 * 
 * Based on Python v3.0 implementation with Chrome extension adaptations
 */

/**
 * State Manager class for agent state persistence
 */
class StateManager {
  constructor(options = {}) {
    this.storageArea = options.storageArea || chrome.storage.local; // chrome.storage.local or chrome.storage.session
    this.stateKey = options.stateKey || 'agent_state';
    this.compressionEnabled = options.compression !== false; // Default enabled
    this.version = options.version || '1.0';
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * Save current agent state
   */
  async saveState(state) {
    const stateData = {
      version: this.version,
      timestamp: Date.now(),
      state: state
    };

    try {
      if (this.compressionEnabled) {
        stateData.compressed = true;
        // Could add compression here if needed
      }

      await this.storageArea.set({ [this.stateKey]: stateData });
      return true;
    } catch (error) {
      console.error('[StateManager] Failed to save state:', error);
      return false;
    }
  }

  /**
   * Load saved agent state
   */
  async loadState() {
    try {
      const result = await this.storageArea.get(this.stateKey);
      const stateData = result[this.stateKey];

      if (!stateData) {
        return null; // No saved state found
      }

      // Version check
      if (stateData.version !== this.version) {
        console.warn('[StateManager] State version mismatch:', stateData.version, 'vs', this.version);
        // Could implement migration logic here
      }

      return stateData.state;
    } catch (error) {
      console.error('[StateManager] Failed to load state:', error);
      return null;
    }
  }

  /**
   * Clear saved state
   */
  async clearState() {
    try {
      await this.storageArea.remove(this.stateKey);
      return true;
    } catch (error) {
      console.error('[StateManager] Failed to clear state:', error);
      return false;
    }
  }

  /**
   * Check if saved state exists
   */
  async hasState() {
    try {
      const result = await this.storageArea.get(this.stateKey);
      return result[this.stateKey] !== undefined;
    } catch (error) {
      console.error('[StateManager] Failed to check state:', error);
      return false;
    }
  }

  /**
   * Get state metadata without loading full state
   */
  async getStateMetadata() {
    try {
      const result = await this.storageArea.get(this.stateKey);
      const stateData = result[this.stateKey];

      if (!stateData) {
        return null;
      }

      return {
        version: stateData.version,
        timestamp: stateData.timestamp,
        compressed: stateData.compressed || false,
        age: Date.now() - stateData.timestamp
      };
    } catch (error) {
      console.error('[StateManager] Failed to get metadata:', error);
      return null;
    }
  }

  /**
   * Save partial state update (merges with existing state)
   */
  async updateState(updates) {
    const currentState = await this.loadState() || {};
    const mergedState = { ...currentState, ...updates };
    return await this.saveState(mergedState);
  }

  /**
   * Create state checkpoint with history
   */
  async createCheckpoint(checkpointId, state) {
    const checkpointKey = `${this.stateKey}_checkpoint_${checkpointId}`;
    const checkpointData = {
      version: this.version,
      timestamp: Date.now(),
      id: checkpointId,
      state: state
    };

    try {
      await this.storageArea.set({ [checkpointKey]: checkpointData });
      
      // Update checkpoint index
      await this._updateCheckpointIndex(checkpointId, checkpointData.timestamp);
      
      // Enforce max history size
      await this._enforceHistoryLimit();
      
      return true;
    } catch (error) {
      console.error('[StateManager] Failed to create checkpoint:', error);
      return false;
    }
  }

  /**
   * Load specific checkpoint
   */
  async loadCheckpoint(checkpointId) {
    const checkpointKey = `${this.stateKey}_checkpoint_${checkpointId}`;
    
    try {
      const result = await this.storageArea.get(checkpointKey);
      const checkpointData = result[checkpointKey];

      if (!checkpointData) {
        return null;
      }

      return checkpointData.state;
    } catch (error) {
      console.error('[StateManager] Failed to load checkpoint:', error);
      return null;
    }
  }

  /**
   * List all available checkpoints
   */
  async listCheckpoints() {
    try {
      const result = await this.storageArea.get(`${this.stateKey}_checkpoints`);
      const checkpoints = result[`${this.stateKey}_checkpoints`] || [];
      
      return checkpoints.map(cp => ({
        id: cp.id,
        timestamp: cp.timestamp,
        age: Date.now() - cp.timestamp
      }));
    } catch (error) {
      console.error('[StateManager] Failed to list checkpoints:', error);
      return [];
    }
  }

  /**
   * Delete specific checkpoint
   */
  async deleteCheckpoint(checkpointId) {
    const checkpointKey = `${this.stateKey}_checkpoint_${checkpointId}`;
    
    try {
      await this.storageArea.remove(checkpointKey);
      await this._removeFromCheckpointIndex(checkpointId);
      return true;
    } catch (error) {
      console.error('[StateManager] Failed to delete checkpoint:', error);
      return false;
    }
  }

  /**
   * Update checkpoint index
   */
  async _updateCheckpointIndex(checkpointId, timestamp) {
    const indexKey = `${this.stateKey}_checkpoints`;
    const result = await this.storageArea.get(indexKey);
    const checkpoints = result[indexKey] || [];
    
    // Add or update checkpoint
    const existingIndex = checkpoints.findIndex(cp => cp.id === checkpointId);
    if (existingIndex >= 0) {
      checkpoints[existingIndex] = { id: checkpointId, timestamp };
    } else {
      checkpoints.push({ id: checkpointId, timestamp });
    }
    
    // Sort by timestamp descending
    checkpoints.sort((a, b) => b.timestamp - a.timestamp);
    
    await this.storageArea.set({ [indexKey]: checkpoints });
  }

  /**
   * Remove checkpoint from index
   */
  async _removeFromCheckpointIndex(checkpointId) {
    const indexKey = `${this.stateKey}_checkpoints`;
    const result = await this.storageArea.get(indexKey);
    const checkpoints = result[indexKey] || [];
    
    const filtered = checkpoints.filter(cp => cp.id !== checkpointId);
    await this.storageArea.set({ [indexKey]: filtered });
  }

  /**
   * Enforce maximum checkpoint history size
   */
  async _enforceHistoryLimit() {
    const checkpoints = await this.listCheckpoints();
    
    if (checkpoints.length > this.maxHistorySize) {
      const toDelete = checkpoints.slice(this.maxHistorySize);
      
      for (const cp of toDelete) {
        await this.deleteCheckpoint(cp.id);
      }
    }
  }

  /**
   * Get storage usage statistics
   */
  async getUsageStats() {
    try {
      if (this.storageArea.getBytesInUse) {
        const bytes = await new Promise((resolve) => {
          this.storageArea.getBytesInUse([this.stateKey], resolve);
        });
        
        return {
          bytes,
          kilobytes: (bytes / 1024).toFixed(2),
          megabytes: (bytes / 1024 / 1024).toFixed(2)
        };
      }
      
      return null;
    } catch (error) {
      console.error('[StateManager] Failed to get usage stats:', error);
      return null;
    }
  }
}

/**
 * History Manager - Manage action history with summarization
 */
class HistoryManager {
  constructor(options = {}) {
    this.maxHistorySize = options.maxHistorySize || 1000;
    this.summarizeThreshold = options.summarizeThreshold || 50;
    this.summarizeBatchSize = options.summarizeBatchSize || 20;
  }

  /**
   * Add entry to history
   */
  addEntry(history, entry) {
    history.push({
      ...entry,
      timestamp: entry.timestamp || Date.now()
    });

    // Summarize if threshold exceeded
    if (history.length > this.summarizeThreshold) {
      this._summarizeHistory(history);
    }

    // Cap at max size
    if (history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize);
    }

    return history;
  }

  /**
   * Summarize oldest history entries
   */
  _summarizeHistory(history) {
    const oldest = history.splice(0, this.summarizeBatchSize);
    
    const summary = this._createSummary(oldest);
    
    history.unshift({
      type: 'summary',
      timestamp: Date.now(),
      entryCount: oldest.length,
      summary: summary
    });
  }

  /**
   * Create summary from batch of entries
   */
  _createSummary(entries) {
    // Count action types
    const actionCounts = {};
    const portals = new Set();
    let navigations = 0;
    
    entries.forEach(entry => {
      const action = entry.action || 'unknown';
      actionCounts[action] = (actionCounts[action] || 0) + 1;
      
      if (entry.portal) {
        portals.add(entry.portal);
      }
      
      if (action === 'navigate') {
        navigations++;
      }
    });

    return {
      actionCounts,
      portals: Array.from(portals),
      navigations,
      duration: entries[entries.length - 1].timestamp - entries[0].timestamp,
      timeRange: {
        start: entries[0].timestamp,
        end: entries[entries.length - 1].timestamp
      }
    };
  }

  /**
   * Get recent history entries
   */
  getRecent(history, count = 20) {
    return history.slice(-count);
  }
}

export { StateManager, HistoryManager };