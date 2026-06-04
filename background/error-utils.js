// background/error-utils.js
// Utility functions for safe error handling across the codebase.

/**
 * Safely extract an error message from any value.
 * Handles Error objects, strings, objects with message properties, and primitives.
 * This is used 200+ times across the codebase to avoid:
 *   typeof e === 'object' && e !== null && typeof e.message === 'string' ? e.message : String(e)
 *
 * @param {*} err - The error value to extract a message from
 * @returns {string} A string representation of the error
 */
export function getErrorMessage(err) {
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && typeof err.message === 'string') return err.message;
  return String(err || '');
}

/**
 * Format an error for logging with optional prefix.
 *
 * @param {*} err - The error value
 * @param {string} [prefix] - Optional prefix for the error message
 * @returns {string} Formatted error message
 */
export function formatError(err, prefix) {
  const msg = getErrorMessage(err);
  return prefix ? `${prefix}: ${msg}` : msg;
}

/**
 * Check if chrome.runtime.lastError has a value.
 * This replaces the repeated pattern:
 *   typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && chrome.runtime.lastError
 *
 * @returns {boolean} True if chrome.runtime.lastError has a value
 */
export function hasLastError() {
  return typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && chrome.runtime.lastError;
}

/**
 * Get chrome.runtime.lastError message safely.
 *
 * @returns {string} The lastError message or empty string if no error
 */
export function getLastErrorMessage() {
  if (!hasLastError()) return '';
  return getErrorMessage(chrome.runtime.lastError);
}
