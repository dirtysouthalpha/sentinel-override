// background/reasoning-trace.js
// v6.0 Intelligence System - Reasoning Trace Capture
// Captures detailed reasoning traces for all agent decisions for explainability

import { getErrorMessage } from './error-utils.js';

const MAX_TRACE_ENTRIES = 1000; // Per-run limit
const STORAGE_KEY_PREFIX = 'reasoning_trace_';

// In-memory cache for active run
const _traceCache = new Map(); // runId → trace array

function _storageKey(runId) {
  return STORAGE_KEY_PREFIX + String(runId).replace(/[^a-z0-9_-]/gi, '_');
}

/**
 * Initialize a new reasoning trace for a run
 * @param {string} runId - The run identifier
 * @param {object} metadata - Initial metadata { goal, model, timestamp }
 */
export async function initReasoningTrace(runId, metadata = {}) {
  const trace = {
    runId,
    startTime: metadata.timestamp || Date.now(),
    goal: metadata.goal || '',
    model: metadata.model || '',
    entries: []
  };
  _traceCache.set(runId, trace);
  
  try {
    const key = _storageKey(runId);
    await chrome.storage.local.set({ [key]: trace });
  } catch (e) {
    console.error('[Sentinel] Failed to initialize reasoning trace:', getErrorMessage(e));
  }
}

/**
 * Capture a reasoning step in the agent's decision-making process
 * @param {string} runId - The run identifier
 * @param {object} entry - The reasoning entry { step, phase, decision, factors, confidence }
 */
export async function captureReasoningStep(runId, entry) {
  const trace = _traceCache.get(runId);
  if (!trace) {
    console.warn('[Sentinel] No reasoning trace found for run:', runId);
    return;
  }

  const enrichedEntry = {
    timestamp: Date.now(),
    step: entry.step || 0,
    phase: entry.phase || 'unknown', // e.g., 'observe', 'plan', 'execute', 'verify'
    decision: entry.decision || '',
    factors: entry.factors || [], // Array of factors considered
    confidence: entry.confidence || 0.5,
    alternatives: entry.alternatives || [], // Alternative decisions considered
    context: entry.context || {} // Additional context
  };

  trace.entries.push(enrichedEntry);

  // Cap entries to prevent unbounded growth
  if (trace.entries.length > MAX_TRACE_ENTRIES) {
    trace.entries = trace.entries.slice(-MAX_TRACE_ENTRIES);
  }

  try {
    const key = _storageKey(runId);
    await chrome.storage.local.set({ [key]: trace });
  } catch (e) {
    console.error('[Sentinel] Failed to capture reasoning step:', getErrorMessage(e));
  }
}

/**
 * Retrieve the full reasoning trace for a run
 * @param {string} runId - The run identifier
 * @returns {Promise<object|null>} The reasoning trace object or null
 */
export async function getReasoningTrace(runId) {
  // Check cache first
  if (_traceCache.has(runId)) {
    return _traceCache.get(runId);
  }

  // Load from storage
  try {
    const key = _storageKey(runId);
    const result = await chrome.storage.local.get([key]);
    if (result[key]) {
      _traceCache.set(runId, result[key]);
      return result[key];
    }
  } catch (e) {
    console.error('[Sentinel] Failed to load reasoning trace:', getErrorMessage(e));
  }

  return null;
}

/**
 * Get a summary of the reasoning trace for human review
 * @param {string} runId - The run identifier
 * @returns {Promise<string>} Human-readable summary
 */
export async function getReasoningSummary(runId) {
  const trace = await getReasoningTrace(runId);
  if (!trace) {
    return 'No reasoning trace found for this run.';
  }

  const parts = [];
  parts.push(`# Reasoning Trace Summary\n`);
  parts.push(`**Run ID:** ${trace.runId}\n`);
  parts.push(`**Goal:** ${trace.goal}\n`);
  parts.push(`**Model:** ${trace.model}\n`);
  parts.push(`**Total Decisions:** ${trace.entries.length}\n\n`);

  // Group by phase
  const byPhase = {};
  trace.entries.forEach(entry => {
    if (!byPhase[entry.phase]) {
      byPhase[entry.phase] = [];
    }
    byPhase[entry.phase].push(entry);
  });

  for (const [phase, entries] of Object.entries(byPhase)) {
    parts.push(`## ${phase.toUpperCase()} (${entries.length} decisions)\n`);
    entries.forEach(entry => {
      parts.push(`### Step ${entry.step}\n`);
      parts.push(`- **Decision:** ${entry.decision}\n`);
      parts.push(`- **Confidence:** ${(entry.confidence * 100).toFixed(1)}%\n`);
      parts.push(`- **Factors:** ${entry.factors.length} considered\n`);
      if (entry.alternatives.length > 0) {
        parts.push(`- **Alternatives:** ${entry.alternatives.length} considered\n`);
      }
      parts.push('\n');
    });
  }

  return parts.join('');

}

/**
 * Convert reasoning trace to JSON format for export
 * @param {string} runId - The run identifier
 * @returns {Promise<string>} JSON string
 */
export async function reasoningTraceToJson(runId) {
  const trace = await getReasoningTrace(runId);
  if (!trace) {
    return JSON.stringify({ error: 'No reasoning trace found' }, null, 2);
  }

  return JSON.stringify(trace, null, 2);
}

/**
 * Clear the reasoning trace for a run
 * @param {string} runId - The run identifier
 */
export async function clearReasoningTrace(runId) {
  _traceCache.delete(runId);
  
  try {
    const key = _storageKey(runId);
    await chrome.storage.local.remove(key);
  } catch (e) {
    console.error('[Sentinel] Failed to clear reasoning trace:', getErrorMessage(e));
  }
}

/**
 * Get high-confidence decisions from the trace
 * @param {string} runId - The run identifier
 * @param {number} minConfidence - Minimum confidence threshold (0-1)
 * @returns {Promise<Array>} Array of high-confidence decisions
 */
export async function getHighConfidenceDecisions(runId, minConfidence = 0.8) {
  const trace = await getReasoningTrace(runId);
  if (!trace) {
    return [];
  }

  return trace.entries.filter(entry => entry.confidence >= minConfidence);
}

/**
 * Get low-confidence decisions that may need review
 * @param {string} runId - The run identifier
 * @param {number} maxConfidence - Maximum confidence threshold (0-1)
 * @returns {Promise<Array>} Array of low-confidence decisions
 */
export async function getLowConfidenceDecisions(runId, maxConfidence = 0.5) {
  const trace = await getReasoningTrace(runId);
  if (!trace) {
    return [];
  }

  return trace.entries.filter(entry => entry.confidence <= maxConfidence);
}

/**
 * Clear the in-memory cache (for testing or cleanup)
 */
export function _resetReasoningTraceCache() {
  _traceCache.clear();
}