// ========== LLM Rate Limiter ==========
// Sliding-window rate limiter: prevents accidental runaway LLM spend.
// Default: max 120 calls per 60-second window (2/sec burst cap).
// Exported so CONFIG changes in agent-engine can adjust limits.
import { ONE_SECOND_MS } from './constants.js';

const _rateLimiter = {
  windowMs: 60_000,
  maxCalls: 120,
  timestamps: /** @type {number[]} */ ([]),
  check() {
    const now = Date.now();
    // Drop timestamps outside the sliding window
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    const timestampsLen = this.timestamps.length;
    if (timestampsLen >= this.maxCalls) {
      const oldestInWindow = timestampsLen ? this.timestamps[0] : now;
      const resetIn = Math.ceil((this.windowMs - (now - oldestInWindow)) / ONE_SECOND_MS);
      throw new Error(`LLM rate limit exceeded: ${this.maxCalls} calls per ${this.windowMs / ONE_SECOND_MS}s. Resets in ~${resetIn}s.`);
    }
    this.timestamps.push(now);
  },
  reset() { this.timestamps = []; }
};

/**
 * Override the LLM rate limiter thresholds at runtime.
 * @param {number} maxCalls - Maximum API calls allowed per window.
 * @param {number} windowMs - Window duration in milliseconds.
 */
export function setLLMRateLimit(maxCalls, windowMs) {
  if (typeof maxCalls === 'number' && maxCalls > 0) _rateLimiter.maxCalls = maxCalls;
  if (typeof windowMs === 'number' && windowMs > 0) _rateLimiter.windowMs = windowMs;
}

/** Reset the LLM rate limiter call count and window start time. */
export function resetLLMRateLimiter() { _rateLimiter.reset(); }

export { _rateLimiter };
