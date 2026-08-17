// background/agent-recovery.js
// Agent-level error recovery policy (ERR-04).
// Wraps agent operations with auto-retry, exponential backoff with jitter,
// failure classification, and error card emission.

import {AgentError, ERROR_CODES, wrapError} from './agent-errors.js';

const MAX_AUTO_RETRIES = 3;
const RETRY_DELAYS_MS = [2000, 4000, 8000]; // Exponential base: 2s, 4s, 8s
const MAX_JITTER_MS = 500; // Random jitter added to each delay to avoid thundering herd

// Track retry counts per operation
const retryCounts = new Map();

// Failure classification counters (for telemetry)
const failureClassCounts = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute exponential backoff with full jitter.
 * Adds a random value in [0, MAX_JITTER_MS] to the base delay.
 * @param {number} attempt - Current attempt number (1-based).
 * @returns {number} Delay in milliseconds.
 * @private
 */
function _backoffDelay(attempt) {
  const base = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
  const jitter = Math.floor(Math.random() * (MAX_JITTER_MS + 1));
  return base + jitter;
}

/**
 * Classify an error for telemetry and adaptive retry decisions.
 * @param {AgentError} error
 * @returns {'transient'|'permanent'|'auth'|'rate-limit'|'unknown'}
 * @private
 */
function _classifyError(error) {
  if (!error) return 'unknown';
  const code = error.code || '';
  if (code === 'LLM_RATE_LIMITED' || code === 'NETWORK_ERROR') return 'rate-limit';
  if (code === 'AUTH_REQUIRED' || code === 'CAPTCHA_DETECTED') return 'auth';
  if (code === 'LLM_TIMEOUT' || code === 'TAB_CLOSED' || code === 'TAB_NOT_FOUND') return 'transient';
  if (code === 'SELECTOR_MISS' || code === 'EXECUTE_JS_FAILED' || code === 'USER_ABORTED') return 'permanent';
  return error.retryable ? 'transient' : 'permanent';
}

/**
 * Record a failure classification for telemetry.
 * @param {string} classification - The failure class.
 * @private
 */
function _recordFailureClass(classification) {
  try {
    const current = failureClassCounts.get(classification) || 0;
    failureClassCounts.set(classification, current + 1);
  } catch (_) { /* non-fatal */ }
}

/**
 * Get a snapshot of failure classification counts.
 * @returns {Object<string, number>}
 */
export function getFailureClassStats() {
  try {
    return Object.fromEntries(failureClassCounts);
  } catch (_) {
    return {};
  }
}

/**
 * Emit an error card to the popup chat.
 * @param {AgentError} error
 */
function emitErrorCard(error) {
  try {
    chrome.runtime.sendMessage({
      action: 'agent_error',
      error: error.toJSON()
    }).catch(() => { /* popup may not be open */ });
  } catch (_e) { /* non-fatal */ }
}

/**
 * Execute an async operation with auto-retry policy.
 * - Retryable errors: auto-retry up to MAX_AUTO_RETRIES times with
 *   exponential backoff + jitter.
 * - After max retries: emit error card and throw
 * - Non-retryable errors: emit error card immediately and throw
 *
 * @param {Function} fn - async function to execute
 * @param {object} context - metadata to attach to errors (goal, stepNumber, etc.)
 * @param {string} operationId - unique key for retry tracking
 * @param {object} [options] - optional configuration
 * @param {Function} [options.sleepFn] - custom sleep function (for testing)
 * @returns {Promise<*>} result of fn()
 */
export async function withRecovery(fn, context = {}, operationId = 'default', options = {}) {
  const key = operationId;
  let attempts = retryCounts.get(key) || 0;
  const _sleep = options.sleepFn || sleep;

  try {
    const result = await fn();
    retryCounts.delete(key);
    return result;
  } catch (rawError) {
    const error = rawError instanceof AgentError
      ? rawError
      : wrapError(rawError, ERROR_CODES.UNKNOWN, null, false, context);

    attempts++;
    retryCounts.set(key, attempts);

    // Classify for telemetry.
    const classification = _classifyError(error);
    _recordFailureClass(classification);

    if (error.retryable && attempts < MAX_AUTO_RETRIES) {
      const delay = _backoffDelay(attempts);
      console.warn('[AGENT-RECOVERY] Retryable error (attempt ' + attempts + '/' + MAX_AUTO_RETRIES + ', class=' + classification + '), retrying in ' + delay + 'ms:', error.code, error.message);
      await _sleep(delay);
      return withRecovery(fn, context, operationId, options);
    }

    // Max retries exceeded or non-retryable — emit error card
    console.error('[AGENT-RECOVERY] ' + (error.retryable ? 'Max retries exceeded' : 'Non-retryable error') + ' (class=' + classification + '):', error.code, error.message);
    const finalError = error.retryable
      ? new AgentError({
          code: ERROR_CODES.MAX_RETRIES_EXCEEDED,
          message: 'Failed after ' + attempts + ' attempts: ' + error.message,
          suggestion: error.suggestion || 'Try again manually or adjust your goal.',
          retryable: true,
          context: { ...context, originalCode: error.code, attempts, classification }
        })
      : error;

    emitErrorCard(finalError);
    throw finalError;
  }
}

/**
 * Reset retry count for an operation (e.g., after a successful step).
 */
export function resetRetries(operationId) {
  retryCounts.delete(operationId);
}

/**
 * Get current retry count for an operation.
 */
export function getRetryCount(operationId) {
  return retryCounts.get(operationId) || 0;
}

