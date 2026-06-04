/**
 * Load Monitor - JavaScript implementation of v3.0 load monitoring
 * Tracks CPU/RAM usage and provides throttling recommendations
 * 
 * Based on Python v3.0 implementation with Chrome extension adaptations
 */

// Load states
const LoadState = {
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Load Monitor class for system resource tracking
 */
class LoadMonitor {
  constructor(options = {}) {
    // Thresholds
    this.cpuHighThreshold = options.cpuHighThreshold || 80; // percentage
    this.cpuNormalThreshold = options.cpuNormalThreshold || 60;
    this.ramHighThreshold = options.ramHighThreshold || 85; // percentage
    this.ramNormalThreshold = options.ramNormalThreshold || 75;
    
    // Timing
    this.pollInterval = options.pollInterval || 5000; // 5 seconds default
    this.sustainDuration = options.sustainDuration || 30000; // 30 seconds
    
    // State tracking
    this.currentState = LoadState.NORMAL;
    this.cpuSustainSeconds = 0;
    this.ramSustainSeconds = 0;
    this.readings = [];
    this.maxReadings = 100; // Keep last 100 readings
    
    // Monitoring
    this.monitoringActive = false;
    this.monitorInterval = null;
    
    // Callbacks
    this.onLoadHigh = options.onLoadHigh || null;
    this.onLoadNormal = options.onLoadNormal || null;
    this.onLoadCritical = options.onLoadCritical || null;
  }

  /**
   * Start monitoring system load
   */
  async start() {
    if (this.monitoringActive) {
      console.warn('[LoadMonitor] Already monitoring');
      return;
    }

    this.monitoringActive = true;
    this.monitorInterval = setInterval(() => {
      this._checkLoad();
    }, this.pollInterval);

    // Immediate check
    await this._checkLoad();
    
    console.log('[LoadMonitor] Started monitoring');
  }

  /**
   * Stop monitoring system load
   */
  stop() {
    if (!this.monitoringActive) {
      return;
    }

    this.monitoringActive = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    console.log('[LoadMonitor] Stopped monitoring');
  }

  /**
   * Check current system load
   */
  async _checkLoad() {
    try {
      const reading = await this._getSystemReading();
      this._addReading(reading);
      
      const newState = this._evaluateLoadState(reading);
      
      if (newState !== this.currentState) {
        this._handleStateChange(newState, reading);
      }
      
      this.currentState = newState;
    } catch (error) {
      console.error('[LoadMonitor] Failed to check load:', error);
    }
  }

  /**
   * Get current system resource reading
   */
  async _getSystemReading() {
    // Chrome extensions can't directly access CPU/RAM, so we use
    // performance.memory as an approximation and heuristics
    
    const reading = {
      timestamp: Date.now(),
      cpu: 0, // Not directly accessible
      ram: 0,
      jsHeap: 0,
      jsHeapLimit: 0
    };

    // Try to get memory info if available
    if (performance && performance.memory) {
      reading.jsHeap = performance.memory.usedJSHeapSize;
      reading.jsHeapLimit = performance.memory.jsHeapSizeLimit;
      
      // Calculate approximate RAM percentage
      if (reading.jsHeapLimit > 0) {
        reading.ram = (reading.jsHeap / reading.jsHeapLimit) * 100;
      }
    }

    // Estimate CPU load based on performance metrics
    if (performance && performance.now) {
      // Use performance timing as a rough CPU indicator
      const navigationStart = performance.timing?.navigationStart || 0;
      const loadTime = performance.now();
      
      if (loadTime > 0 && navigationStart > 0) {
        // This is a very rough approximation
        reading.cpu = Math.min(100, Math.max(0, (loadTime / 10000) * 10));
      }
    }

    return reading;
  }

  /**
   * Add reading to history
   */
  _addReading(reading) {
    this.readings.push(reading);

    if (this.readings.length > this.maxReadings) {
      this.readings.shift();
    }
  }

  /**
   * Evaluate current load state from reading
   */
  _evaluateLoadState(reading) {
    // Check RAM first (more reliable in browser context)
    if (reading.ram >= this.ramHighThreshold) {
      this.ramSustainSeconds++;
    } else if (reading.ram <= this.ramNormalThreshold) {
      this.ramSustainSeconds = 0;
    }

    // Check CPU (less reliable)
    if (reading.cpu >= this.cpuHighThreshold) {
      this.cpuSustainSeconds++;
    } else if (reading.cpu <= this.cpuNormalThreshold) {
      this.cpuSustainSeconds = 0;
    }

    // Determine state based on sustained duration
    const ramSustainMs = this.ramSustainSeconds * this.pollInterval;
    const cpuSustainMs = this.cpuSustainSeconds * this.pollInterval;

    if (ramSustainMs >= this.sustainDuration || cpuSustainMs >= this.sustainDuration) {
      // Check if critical (>90%)
      if (reading.ram > 90 || reading.cpu > 90) {
        return LoadState.CRITICAL;
      }
      return LoadState.HIGH;
    }

    // Check if we should return to normal
    if (this.currentState === LoadState.HIGH || this.currentState === LoadState.CRITICAL) {
      if (reading.ram <= this.ramNormalThreshold && reading.cpu <= this.cpuNormalThreshold) {
        this.ramSustainSeconds = 0;
        this.cpuSustainSeconds = 0;
        return LoadState.NORMAL;
      }
    }

    return this.currentState;
  }

  /**
   * Handle state change
   */
  _handleStateChange(newState, reading) {
    console.log(`[LoadMonitor] State change: ${this.currentState} -> ${newState}`, reading);

    if (newState === LoadState.HIGH && this.onLoadHigh) {
      this.onLoadHigh(reading);
    } else if (newState === LoadState.CRITICAL && this.onLoadCritical) {
      this.onLoadCritical(reading);
    } else if (newState === LoadState.NORMAL && this.onLoadNormal) {
      this.onLoadNormal(reading);
    }
  }

  /**
   * Get current state and readings
   */
  getCurrentState() {
    return {
      state: this.currentState,
      cpuSustainSeconds: this.cpuSustainSeconds,
      ramSustainSeconds: this.ramSustainSeconds,
      latestReading: this.readings[this.readings.length - 1] || null
    };
  }

  /**
   * Get reading history
   */
  getReadings(count = 20) {
    return this.readings.slice(-count);
  }

  /**
   * Get average resource usage
   */
  getAverageUsage(durationMs = 60000) { // Default last minute
    const cutoff = Date.now() - durationMs;
    const relevantReadings = this.readings.filter(r => r.timestamp >= cutoff);
    
    if (relevantReadings.length === 0) {
      return { cpu: 0, ram: 0, jsHeap: 0 };
    }

    const sum = relevantReadings.reduce((acc, r) => ({
      cpu: acc.cpu + r.cpu,
      ram: acc.ram + r.ram,
      jsHeap: acc.jsHeap + r.jsHeap
    }), { cpu: 0, ram: 0, jsHeap: 0 });

    return {
      cpu: sum.cpu / relevantReadings.length,
      ram: sum.ram / relevantReadings.length,
      jsHeap: sum.jsHeap / relevantReadings.length,
      sampleCount: relevantReadings.length
    };
  }

  /**
   * Check if system is under high load
   */
  isThrottled() {
    return this.currentState === LoadState.HIGH || this.currentState === LoadState.CRITICAL;
  }

  /**
   * Get throttling recommendation
   */
  getThrottlingRecommendation() {
    if (this.currentState === LoadState.CRITICAL) {
      return {
        shouldThrottle: true,
        severity: 'critical',
        recommendations: [
          'Pause non-critical operations',
          'Reduce request frequency',
          'Disable caching/compression',
          'Clear memory buffers'
        ]
      };
    } else if (this.currentState === LoadState.HIGH) {
      return {
        shouldThrottle: true,
        severity: 'high',
        recommendations: [
          'Reduce request frequency',
          'Use lighter models',
          'Disable optional features'
        ]
      };
    }

    return {
      shouldThrottle: false,
      severity: 'normal',
      recommendations: []
    };
  }

  /**
   * Reset monitoring state
   */
  reset() {
    this.currentState = LoadState.NORMAL;
    this.cpuSustainSeconds = 0;
    this.ramSustainSeconds = 0;
    this.readings = [];
  }
}

/**
 * Performance Tracker - Track operation performance metrics
 */
class PerformanceTracker {
  constructor() {
    this.metrics = new Map(); // operation -> {count, totalTime, minTime, maxTime}
  }

  /**
   * Track an operation execution
   */
  track(operation, durationMs) {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, {
        count: 0,
        totalTime: 0,
        minTime: Infinity,
        maxTime: 0
      });
    }

    const metric = this.metrics.get(operation);
    metric.count++;
    metric.totalTime += durationMs;
    metric.minTime = Math.min(metric.minTime, durationMs);
    metric.maxTime = Math.max(metric.maxTime, durationMs);
  }

  /**
   * Get metrics for an operation
   */
  getMetrics(operation) {
    const metric = this.metrics.get(operation);
    if (!metric) {
      return null;
    }

    return {
      operation,
      count: metric.count,
      averageTime: metric.totalTime / metric.count,
      minTime: metric.minTime,
      maxTime: metric.maxTime,
      totalTime: metric.totalTime
    };
  }

  /**
   * Get all metrics
   */
  getAllMetrics() {
    const result = [];
    this.metrics.forEach((metric, operation) => {
      result.push(this.getMetrics(operation));
    });
    return result;
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics.clear();
  }

  /**
   * Get slow operations
   */
  getSlowOperations(thresholdMs = 1000) {
    const slow = [];
    this.metrics.forEach((metric, operation) => {
      const avg = metric.totalTime / metric.count;
      if (avg > thresholdMs) {
        slow.push({
          operation,
          averageTime: avg,
          count: metric.count
        });
      }
    });
    return slow.sort((a, b) => b.averageTime - a.averageTime);
  }
}

export { LoadMonitor, LoadState, PerformanceTracker };