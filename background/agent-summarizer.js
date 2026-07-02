// Sentinel Override v21.6.58 — Progressive Context Summarization
// Prevents context loss on long runs by compacting history.

/**
 * Summarize accumulated history into a compact discoveries block.
 * Called every 8 steps to prevent context overflow.
 *
 * @param {Array} history - Full action history
 * @param {object} agentMemory - Current memory state
 * @param {number} currentStep - Current step number
 * @returns {string} Compact summary string for injection into prompt
 */
export function buildProgressSummary(history, agentMemory, currentStep) {
  if (!history || history.length === 0) return '';

  const memKeys = Object.keys(agentMemory || {});
  if (memKeys.length === 0) return '';

  const lines = [`[PROGRESS SUMMARY - Steps 1-${currentStep}]`];
  
  // Summarize what data we have
  let totalDataChars = 0;
  for (const key of memKeys) {
    const val = agentMemory[key];
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    const len = str.length;
    totalDataChars += len;
    const preview = str.substring(0, 120).replace(/\n/g, ' ');
    if (len > 150) {
      lines.push(`✓ ${key}: ${len} chars — ${preview}...`);
    } else {
      lines.push(`✓ ${key}: ${preview}`);
    }
  }
  
  // Summarize actions taken
  const actionTypes = {};
  for (const h of history) {
    const type = h?.action?.type || 'unknown';
    actionTypes[type] = (actionTypes[type] || 0) + 1;
  }
  const actionSummary = Object.entries(actionTypes)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}(${count})`)
    .join(', ');
  lines.push(`Actions: ${actionSummary}`);
  lines.push(`Total data collected: ${totalDataChars} chars across ${memKeys.length} key(s)`);
  
  // Detect failures
  const failures = history.filter(h => h?.result && typeof h.result === 'string' && 
    (h.result.includes('failed') || h.result.includes('FAIL') || h.result.includes('Error')));
  if (failures.length > 0) {
    lines.push(`⚠ ${failures.length} failed actions — review errors above`);
  }

  return lines.join('\n');
}

/**
 * Check if history should be summarized.
 * Returns true every 8 steps.
 */
export function shouldSummarize(currentStep) {
  return currentStep > 0 && currentStep % 8 === 0;
}

/**
 * Compact history by replacing old entries with a summary.
 * Keeps the last 4 entries intact, replaces older ones with summaries.
 *
 * @param {Array} history - Full history
 * @param {string} summary - Progress summary
 * @returns {Array} Compacted history
 */
export function compactHistory(history, summary) {
  if (!history || history.length <= 6) return history;
  
  // Keep last 4 entries, replace the rest with a summary marker
  const recent = history.slice(-4);
  const compactEntry = {
    step: history[history.length - 5]?.step || 0,
    action: { type: 'summary', _isSummary: true },
    result: summary
  };
  
  return [compactEntry, ...recent];
}
