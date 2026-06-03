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
