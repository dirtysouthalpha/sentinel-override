/**
 * Sentinel Override — Shared Constants
 * Centralized timeout and configuration values used across the extension.
 */

// API request timeouts (in milliseconds)
export const API_TIMEOUT_MS = 30000; // 30 seconds - standard timeout for LLM API calls
export const API_CACHE_TTL_MS = 30000; // 30 seconds - cache TTL for API responses

// Cache TTL values (in milliseconds)
export const PLATFORM_CTX_CACHE_TTL_MS = 30000; // 30 seconds - platform context cache
export const BATCH_MODE_CACHE_TTL_MS = 60000; // 60 seconds - extended cache in batch mode

// Scheduler refresh interval (in milliseconds)
export const SCHEDULER_REFRESH_INTERVAL_MS = 30000; // 30 seconds - refresh countdown timers

// Maximum wait time for commands (in milliseconds)
export const MAX_WAIT_TIME_MS = 30000; // 30 seconds - maximum wait command duration

// Time interval constants (in milliseconds)
export const ONE_SECOND_MS = 1000; // 1 second
export const ONE_MINUTE_MS = 60000; // 1 minute
export const FIVE_MINUTES_MS = 300000; // 5 minutes
export const ONE_HOUR_MS = 3600000; // 1 hour
export const ONE_DAY_MS = 86400000; // 24 hours

// Page content limits
export const MAX_PAGE_TEXT_LENGTH = 30000; // Maximum characters to extract from page text
