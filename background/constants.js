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
export const ONE_HUNDRED_MS = 100; // 100 milliseconds
export const ONE_HUNDRED_FIFTY_MS = 150; // 150 milliseconds
export const TWO_HUNDRED_MS = 200; // 200 milliseconds
export const THREE_HUNDRED_MS = 300; // 300 milliseconds
export const FOUR_HUNDRED_MS = 400; // 400 milliseconds
export const FIVE_HUNDRED_MS = 500; // 500 milliseconds
export const SIX_HUNDRED_MS = 600; // 600 milliseconds
export const EIGHT_HUNDRED_MS = 800; // 800 milliseconds
export const ONE_SECOND_MS = 1000; // 1 second
export const TWO_SECONDS_MS = 2000; // 2 seconds
export const THREE_SECONDS_MS = 3000; // 3 seconds
export const FIVE_SECONDS_MS = 5000; // 5 seconds
export const TEN_SECONDS_MS = 10000; // 10 seconds
export const TWELVE_SECONDS_MS = 12000; // 12 seconds
export const FIFTEEN_SECONDS_MS = 15000; // 15 seconds
export const TWENTY_SECONDS_MS = 20000; // 20 seconds
export const THIRTY_SECONDS_MS = 30000; // 30 seconds
export const FORTY_FIVE_SECONDS_MS = 45000; // 45 seconds
export const ONE_MINUTE_MS = 60000; // 1 minute
export const FIVE_MINUTES_MS = 300000; // 5 minutes
export const ONE_HOUR_MS = 3600000; // 1 hour
export const ONE_DAY_MS = 86400000; // 24 hours

// Page content limits
export const MAX_PAGE_TEXT_LENGTH = 30000; // Maximum characters to extract from page text
export const TEXT_SAMPLE_LENGTH = 5000; // Maximum characters for text samples

// Report and log limits
export const MAX_REPORT_FINDING_LENGTH = 2000; // Maximum characters for report findings before truncation
export const MAX_CDP_RESULT_LENGTH = 3000; // Maximum characters for CDP result strings
export const MAX_LOG_ENTRY_LENGTH = 1000; // Maximum characters for console log entries

// Agent engine configuration constants
export const CONFIG = {
  minDelayBetweenCalls: 500,
  // (v20.3) Raised 2 → 6. On heavy admin pages a single 429/overload/timeout used
  // to hard-stop the run; free/community models on OpenRouter rate-limit often, so
  // a deeper retry budget with a longer backoff cap keeps runs alive across them.
  maxRetries: 6,
  retryDelay: TWO_SECONDS_MS,
  maxRetryDelay: 2 * TEN_SECONDS_MS, // 20s cap (was 10s)
  // (v20.5) Was 30. The SoM grounding approach lives or dies on the model being
  // able to READ the small green [N] labels off the screenshot, and JPEG q30
  // shreds sharp text edges with ringing artifacts — the exact failure mode that
  // makes GLM-4.xV misread an index. q50 roughly doubles edge fidelity for the
  // numerals while staying well under half the size of q80. Worth the bytes.
  screenshotQuality: 50,
  // (v20.4) Stream LLM responses (per-chunk idle timeout) so slow/thinking models
  // aren't aborted mid-generation. Set false to force the legacy buffered path.
  streaming: true,
  fetchTimeout: ONE_MINUTE_MS, // (v20.2) was 30s
  pageLoadTimeout: 25000,
  maxSteps: 100,
  maxPageContentLength: 16000,
  maxElements: 80,
  maxSelectorLength: 200,
  historyWindow: 15,
  screenshotCache: true,
  maxMemoryEntries: 50,
  maxHistoryEntries: 60,
  maxStoredHistory: 40,
  maxLearnedPatterns: 100,
  strategyShiftThreshold: 3,
  stallConfig: {
    similarityWindow: 3,        // Look at last N actions for repeated identical failures
    maxConsecutiveFailures: 5,  // Hard limit: force recovery after this many total failures
    stateRecheckSteps: 4,       // (3.46.1) After N non-mutating clicks, force re-scan (stagnation)
  },
};
