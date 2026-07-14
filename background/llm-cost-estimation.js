// ========== Cost Estimation & Tracking ==========
// Extracted from llm-client.js for modularity.
// Provides pricing tables, cost estimation, tier-based cost tracking.

// Regex used by isSimpleStep to detect runbook-style goals.
const RUNBOOK_PATTERN_RE = /STEP\s+\d|PHASE\s+\d|INVESTIGATION|RUNBOOK|runbook|investigation/i;

const _PRICING = {
  // Anthropic
  'claude-haiku-4-5': [0.80, 4.00],
  'claude-haiku-4-5-20251001': [0.80, 4.00],
  'claude-3-5-haiku': [0.80, 4.00],
  'claude-3-haiku': [0.25, 1.25],
  'claude-sonnet-4-6': [3.00, 15.00],
  'claude-sonnet-4-5': [3.00, 15.00],
  'claude-3-5-sonnet': [3.00, 15.00],
  'claude-3-sonnet': [3.00, 15.00],
  'claude-opus-4-8': [15.00, 75.00],
  'claude-opus-4-6': [15.00, 75.00],
  'claude-opus-4-7': [15.00, 75.00],
  'claude-opus-4-5': [15.00, 75.00],
  'claude-3-opus': [15.00, 75.00],
  // OpenAI
  'gpt-4o': [2.50, 10.00],
  'gpt-4o-mini': [0.15, 0.60],
  'gpt-4.1': [2.00, 8.00],
  'gpt-4.1-mini': [0.40, 1.60],
  'gpt-4.1-nano': [0.10, 0.40],
  'o4-mini': [1.10, 4.40],
  'o3': [10.00, 40.00],
};

// Cache sorted pricing entries by key length (longest first) for efficient matching
const _PRICING_SORTED = Object.entries(_PRICING).sort((a, b) => b[0].length - a[0].length);

/**
 * Estimate run cost in USD from token counts and model name.
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {string} modelName
 * @returns {number} estimated cost in USD
 */
export function estimateCostUsd(inputTokens, outputTokens, modelName) {
  const m = (modelName || '').toLowerCase();
  if (!m) return ((inputTokens || 0) * 3.00 + (outputTokens || 0) * 15.00) / 1_000_000;
  let rates = null;
  for (const [key, r] of _PRICING_SORTED) {
    if (m.includes(key) || m.startsWith(key)) { rates = r; break; }
  }
  if (!rates) {
    // (audit) Family-aware fallback so unlisted new versions (e.g. the default
    // claude-opus-4-8) aren't silently priced at the Sonnet-class default —
    // opus is 5x sonnet. Exact entries above still win; this only refines the
    // fallback. Anything not clearly opus/haiku keeps the Sonnet-class estimate.
    if (/opus/.test(m)) rates = [15.00, 75.00];
    else if (/haiku/.test(m)) rates = [0.80, 4.00];
    else rates = [3.00, 15.00];
  }
  return ((inputTokens || 0) * (rates[0] || 0) + (outputTokens || 0) * (rates[1] || 0)) / 1_000_000;
}

/**
 * (9.2) Determine whether the current step is "simple" enough to route to a
 * cheaper / faster model. Simple = early in the run, no failures, not runbook,
 * and the pending action type (if known) is a low-stakes operation.
 *
 * @param {object} agentState
 * @param {number} stepCount
 * @param {Array} history
 * @returns {boolean}
 */
export function isSimpleStep(agentState, stepCount, history) {
  if (!agentState) return false;
  if (agentState.consecutiveFailures > 0) return false;
  if (agentState.quickMode) return false; // quick mode already uses fewer tokens
  const isRunbook = RUNBOOK_PATTERN_RE.test(agentState.goal || '');
  if (isRunbook) return false;
  if (stepCount > 6) return false;
  if ((history || []).length > 8) return false;
  return true;
}


const _costTracker = {
  totalCalls: 0,
  byTier: { light: 0, default: 0, heavy: 0 },
  estimatedCost: 0
};

/**
 * Record a model usage event for cost tracking.
 * @param {string} tier - 'light', 'default', or 'heavy'
 * @param {number} inputTokens - Input token count for this call.
 * @param {number} outputTokens - Output token count for this call.
 */
export function recordModelUsage(tier, inputTokens, outputTokens) {
  _costTracker.totalCalls++;
  if (_costTracker.byTier[tier] !== undefined) _costTracker.byTier[tier]++;
  else _costTracker.byTier.default++;
  // Cost estimates per tier — [input rate, output rate] per token
  // Output tokens typically 3-5x more expensive than input
  const rates = { light: [0.15, 0.60], default: [3.00, 15.00], heavy: [15.00, 75.00] };
  const [inRate, outRate] = rates[tier] || rates.default;
  _costTracker.estimatedCost += (inRate * (inputTokens || 0) + outRate * (outputTokens || 0)) / 1_000_000;
}

/**
 * Get a snapshot of the cost tracker state.
 * @returns {Object} { totalCalls, byTier, estimatedCost }
 */
export function getCostTracker() {
  return { ..._costTracker, byTier: { ..._costTracker.byTier }, estimatedCost: _costTracker.estimatedCost.toFixed(4) };
}
