/**
 * Task Queue - JavaScript implementation of v3.0 task queue
 * Manages background task processing with IndexedDB persistence
 * 
 * Based on Python v3.0 implementation with Chrome extension adaptations
 */

// Task priorities
const TaskPriority = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4
};

// Task states
const TaskState = {
  PENDING: 'pending',
  PROCESSING: 'processing', 
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Task Queue implementation using IndexedDB for persistence
 */
class TaskQueue {
  constructor(options = {}) {
    this.dbName = options.dbName || 'SentinelTaskQueue';
    this.dbVersion = 1;
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.concurrency = options.concurrency || 3;
    this.processing = new Set(); // Currently processing task IDs
    this.db = null;
    this.processors = new Map(); // Task type -> processor function
    
    // Event callbacks
    this.onTaskComplete = options.onTaskComplete || null;
    this.onTaskFailed = options.onTaskFailed || null;
  }

  /**
   * Initialize the IndexedDB database
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create tasks store
        if (!db.objectStoreNames.contains('tasks')) {
          const store = db.createObjectStore('tasks', { keyPath: 'id' });
          store.createIndex('state', 'state', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }
        
        // Create metadata store
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Register a processor for a specific task type
   */
  registerProcessor(taskType, processorFn) {
    this.processors.set(taskType, processorFn);
  }

  /**
   * Enqueue a new task
   */
  async enqueue(task) {
    if (!this.db) await this.init();
    
    // Check queue size limit
    const count = await this._countTasks();
    if (count >= this.maxQueueSize) {
      throw new Error('Task queue is full');
    }

    const taskData = {
      id: this._generateId(),
      type: task.type || 'generic',
      payload: task.payload || {},
      priority: task.priority || TaskPriority.NORMAL,
      state: TaskState.PENDING,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      attempts: 0,
      maxAttempts: task.maxAttempts || 3,
      result: null,
      error: null
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tasks'], 'readwrite');
      const store = transaction.objectStore('tasks');
      const request = store.add(taskData);
      
      request.onsuccess = () => {
        resolve(taskData.id);
        // Try to process if we have capacity
        this._tryProcessNext();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Process a single task
   */
  async _processTask(task) {
    const processor = this.processors.get(task.type);
    if (!processor) {
      throw new Error(`No processor registered for task type: ${task.type}`);
    }

    // Update task state to processing
    await this._updateTaskState(task.id, TaskState.PROCESSING);
    this.processing.add(task.id);

    try {
      const result = await processor(task.payload);
      
      // Mark as completed
      await this._completeTask(task.id, result, null);
      this.processing.delete(task.id);
      
      if (this.onTaskComplete) {
        this.onTaskComplete(task.id, result);
      }
      
      // Try to process next task
      this._tryProcessNext();
      
    } catch (error) {
      this.processing.delete(task.id);
      
      // Increment attempts and check if we should retry
      task.attempts = (task.attempts || 0) + 1;
      
      if (task.attempts < task.maxAttempts) {
        // Re-queue for retry
        await this._updateTaskState(task.id, TaskState.PENDING);
        this._tryProcessNext();
      } else {
        // Mark as failed
        await this._completeTask(task.id, null, error.message);
        
        if (this.onTaskFailed) {
          this.onTaskFailed(task.id, error);
        }
      }
    }
  }

  /**
   * Try to process the next pending task if we have capacity
   */
  async _tryProcessNext() {
    if (this.processing.size >= this.concurrency) {
      return; // At capacity
    }

    const task = await this._getNextPendingTask();
    if (task) {
      this._processTask(task);
    }
  }

  /**
   * Get the next pending task ordered by priority
   */
  _getNextPendingTask() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tasks'], 'readonly');
      const store = transaction.objectStore('tasks');
      const index = store.index('state');
      const request = index.openCursor(IDBKeyRange.only(TaskState.PENDING));
      
      let highestPriorityTask = null;
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const task = cursor.value;
          if (!highestPriorityTask || task.priority > highestPriorityTask.priority) {
            highestPriorityTask = task;
          }
          cursor.continue();
        } else {
          resolve(highestPriorityTask);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update task state
   */
  _updateTaskState(taskId, state) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tasks'], 'readwrite');
      const store = transaction.objectStore('tasks');
      const request = store.get(taskId);
      
      request.onsuccess = () => {
        const task = request.result;
        if (task) {
          task.state = state;
          if (state === TaskState.PROCESSING) {
            task.startedAt = Date.now();
          }
          const updateRequest = store.put(task);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error('Task not found'));
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark task as completed or failed
   */
  _completeTask(taskId, result, error) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tasks'], 'readwrite');
      const store = transaction.objectStore('tasks');
      const request = store.get(taskId);
      
      request.onsuccess = () => {
        const task = request.result;
        if (task) {
          task.state = error ? TaskState.FAILED : TaskState.COMPLETED;
          task.completedAt = Date.now();
          task.result = result;
          task.error = error;
          
          const updateRequest = store.put(task);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error('Task not found'));
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count total tasks in queue
   */
  _countTasks() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tasks'], 'readonly');
      const store = transaction.objectStore('tasks');
      const request = store.count();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    const pending = await this._countByState(TaskState.PENDING);
    const processing = await this._countByState(TaskState.PROCESSING);
    const completed = await this._countByState(TaskState.COMPLETED);
    const failed = await this._countByState(TaskState.FAILED);
    
    return {
      pending,
      processing,
      completed,
      failed,
      total: pending + processing + completed + failed,
      processingCapacity: this.processing.size,
      concurrencyLimit: this.concurrency
    };
  }

  /**
   * Count tasks by state
   */
  _countByState(state) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tasks'], 'readonly');
      const store = transaction.objectStore('tasks');
      const index = store.index('state');
      const request = index.count(IDBKeyRange.only(state));
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Purge old completed/failed tasks
   */
  async purge(olderThanMs = 3600000) { // Default 1 hour
    const cutoff = Date.now() - olderThanMs;
    const states = [TaskState.COMPLETED, TaskState.FAILED];
    
    for (const state of states) {
      await this._purgeByState(state, cutoff);
    }
  }

  /**
   * Purge tasks by state and cutoff time
   */
  _purgeByState(state, cutoff) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tasks'], 'readwrite');
      const store = transaction.objectStore('tasks');
      const index = store.index('state');
      const range = IDBKeyRange.only(state);
      const request = index.openCursor(range);
      
      let purged = 0;
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const task = cursor.value;
          if (task.completedAt && task.completedAt < cutoff) {
            cursor.delete();
            purged++;
          }
          cursor.continue();
        } else {
          resolve(purged);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Generate unique task ID
   */
  _generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

export { TaskQueue, TaskPriority, TaskState };