// Sentinel Override - History Summarization
// Extracted from agent-engine.js for modularity.
// Rolling history summarization for bounded prompt context.

import { CONFIG } from './constants.js';
import { sharedState } from './agent-shared-state.js';

const EXTRACT_TYPE_RE = /^extract(_list)?$/;
const HISTORY_FAILURE_RE = /error|fail|not found|blocked|timed out/i;

// ========== Rolling History Summarization (3.8.2) ==========
// Long runs (200+ steps) bloat the LLM prompt with historical action data.
// When history exceeds 30 entries, condense the oldest 15 into a single
// SUMMARY entry so the prompt stays bounded. The summary preserves what
// matters for the agent's decision-making: per-portal step counts, key
// extractions, navigations, and any failure clusters.

const HISTORY_SUMMARIZE_THRESHOLD = 30;
const HISTORY_SUMMARIZE_BATCH = 15;

function summarizeHistoryBatch(batch) {
  if (!batch || !batch.length) return null;
  const batchLen = batch.length;
  const firstValid = batch.find(h => h && h.step !== undefined);
  let lastValid = null;
  for (let i = batchLen - 1; i >= 0; i--) {
    if (batch[i] && batch[i].step !== undefined) {
      lastValid = batch[i];
      break;
    }
  }
  if (!firstValid || !lastValid) return null;
  const counts = {};
  const navUrls = [];
  const extractedKeys = [];
  const failures = [];
  const notes = [];
  for (const h of batch) {
    if (!h || !h.action) continue;
    const t = h.action.type;
    counts[t] = (counts[t] || 0) + 1;
    if (t === 'navigate' && h.action.url) {
      const url = h.action.url;
      navUrls.push(typeof url === 'string' ? url.substring(0, 100) : String(url).substring(0, 100));
    }
    if ((EXTRACT_TYPE_RE.test(t)) && h.action.key) extractedKeys.push(h.action.key);
    if (t === 'execute_js' && h.action.key) extractedKeys.push(h.action.key);
    if (t === 'note' && h.action.text) {
      const text = h.action.text;
      notes.push(typeof text === 'string' ? text.substring(0, 200) : String(text).substring(0, 200));
    }
    const r = (h && typeof h.result === 'string') ? h.result : '';
    if (HISTORY_FAILURE_RE.test(r)) failures.push(`${t}: ${r.substring(0, 120)}`);
  }
  const summaryParts = [];
  summaryParts.push(`Action counts: ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ')}`);
  if (navUrls.length) summaryParts.push(`Navigated to: ${[...new Set(navUrls)].slice(0, 5).join(' | ')}`);
  if (extractedKeys.length) summaryParts.push(`Memory keys saved: ${[...new Set(extractedKeys)].slice(0, 8).join(', ')}`);
  if (notes.length) summaryParts.push(`Notes recorded: ${notes.slice(0, 3).join(' || ')}`);
  if (failures.length) summaryParts.push(`Failures: ${failures.slice(0, 3).join(' || ')}`);
  return {
    step: `${firstValid?.step || '?'}-${lastValid?.step || '?'}`,
    action: { type: 'history_summary' },
    result: `[ROLLED-UP SUMMARY of steps ${firstValid?.step || '?'}-${lastValid?.step || '?'}] ${summaryParts.join(' • ')}`
  };
}

function maybeRollupHistory(history) {
  if (history.length <= HISTORY_SUMMARIZE_THRESHOLD) return;
  // Already-summarized batches stay at the front (their action.type === 'history_summary')
  // and we don't re-summarize them. Find the first non-summary entry to
  // determine whether we need to roll up.
  const firstNonSummary = history.findIndex(h => !h.action || h.action.type !== 'history_summary');
  if (firstNonSummary < 0) return;
  const detailed = history.slice(firstNonSummary);
  if (detailed.length <= HISTORY_SUMMARIZE_THRESHOLD) return;
  const oldest = detailed.slice(0, HISTORY_SUMMARIZE_BATCH);
  const summary = summarizeHistoryBatch(oldest);
  if (!summary) return;
  // Splice: replace the oldest batch with the summary entry.
  history.splice(firstNonSummary, HISTORY_SUMMARIZE_BATCH, summary);
}



// ========== Stall Detection ==========
const STALL_ERROR_RE = /^(Error|Timeout)|not found|timed out|Element not found|No element/i;

function detectStall(history, consecutiveFailures, _currentStrategies) {
  const recent = history.slice(-CONFIG.stallConfig.similarityWindow);

  // Check 1: All recent actions are the same type with the same failure result
  if (recent.length >= CONFIG.stallConfig.similarityWindow) {
    const first = recent[0];
    const firstResult = first ? first.result : undefined;
    const allSameType = first && first.action && recent.every(h => h.action && h.action.type === first.action.type);
    const allSameResult = recent.every(h => h.result === firstResult);
    const allFailed = recent.every(h => {
      const r = typeof h.result === 'string' ? h.result : '';
      return STALL_ERROR_RE.test(r);
    });

    if (allSameType && allSameResult && allFailed) {
      const actionType = first.action.type || 'unknown';
      const resultStr = typeof firstResult === 'string' ? firstResult : '';
      return {
        stalled: true,
        reason: `Repeated "${actionType}" with same failure: "${resultStr}"`,
        recoveryAction: 'RESCAN_AND_REPLAN'
      };
    }
  }

  // Check 2: Page stagnation — too many clicks/types without page change
  if (sharedState.pageStagnation >= CONFIG.stallConfig.stateRecheckSteps) {
    return {
      stalled: true,
      reason: `${sharedState.pageStagnation} consecutive clicks/types without page change (stagnation)`,
      recoveryAction: 'RESCAN_AND_REPLAN'
    };
  }

  // Check 3: High consecutive failures regardless of action type
  if (consecutiveFailures >= CONFIG.stallConfig.maxConsecutiveFailures) {
    return {
      stalled: true,
      reason: `${consecutiveFailures} consecutive failures without progress`,
      recoveryAction: 'FORCE_STRATEGY_SHIFT'
    };
  }

  return { stalled: false };
}

export {
  summarizeHistoryBatch,
  maybeRollupHistory,
  detectStall,
};
