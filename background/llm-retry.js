// ========== API Call with Retry ==========
// Extracted from llm-client.js for modularity.
// Wraps callLLM with exponential backoff retry on transient errors.
import { ONE_SECOND_MS, TWO_SECONDS_MS } from './constants.js';
import { getErrorMessage, sleep } from './error-utils.js';
import { sendSilentUpdate } from './message-protocol.js';
import { callLLM } from './llm-client.js';

// (v21.6) Free fallback vision models for auto-switching on repeated 429s
// Ordered by reliability — first one that responds wins.
const FREE_FALLBACK_MODELS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'openrouter/free'
];

// (v21.6) Track 429 count per model to trigger fallback switching
let _rateLimitHits = {};
let _triedModels = new Set(); // (v21.6.1) Prevent infinite model cycling


/**
 * Call the LLM with automatic retry on transient errors (429, 502, 503, timeouts).
 * Uses exponential backoff with jitter. On permanent failure, re-throws.
 * @param {Array} trimmedElements - Trimmed DOM elements for context.
 * @param {number} totalElementCount - Total elements on page before trimming.
 * @param {string} pageContent - Extracted page text content.
 * @param {string|null} base64Image - Screenshot as base64, or null.
 * @param {string} goal - Current goal text.
 * @param {Array} history - Conversation history messages.
 * @param {number} stepCount - Current step number.
 * @param {string} currentUrl - Active tab URL.
 * @param {number} retryCount - Current retry attempt number.
 * @param {Object} CONFIG - Agent configuration object.
 * @param {Object} agentState - Mutable agent state (plan, etc.).
 * @returns {Promise<Object>} Parsed LLM response object.
 */
export async function callLLMWithRetry(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, retryCount, CONFIG, agentState) {
  try {
    return await callLLM(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, CONFIG, agentState);
  } catch (err) {
    console.error('[Sentinel/LLM] API call failed:', getErrorMessage(err));
    const msg = (typeof err.message === 'string' ? err.message : String(err));
    // (v20.3) Added 500 / 529 / "overloaded" — Anthropic returns 529 overloaded_error
    // and transient 500s under load; these are retryable just like 429/502/503.
    const isRetryable = (msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('529') || msg.includes('overloaded') || msg.includes('timed out') || msg.includes('AbortError') || msg.includes('Failed to fetch')) && retryCount < CONFIG.maxRetries;
    if (isRetryable) {
      // (v21.6) Rate-limit model switching: if free model hits 429 twice,
      // switch to next free vision model instead of just backing off
      if (msg.includes('429') && agentState) {
        const currentModel = (agentState.model || '').toLowerCase();
        _rateLimitHits[currentModel] = (_rateLimitHits[currentModel] || 0) + 1;
        if (_rateLimitHits[currentModel] >= 2 && currentModel.includes(':free')) {
          _triedModels.add(currentModel);
          const nextModel = FREE_FALLBACK_MODELS.find(m => !_triedModels.has(m));
          if (nextModel && agentState.model !== nextModel) {
            console.warn(`[Sentinel/LLM] Rate limit on ${currentModel} — switching to ${nextModel}`);
            agentState.model = nextModel;
            _rateLimitHits = {}; // reset counter for new model
          } else if (_triedModels.size >= FREE_FALLBACK_MODELS.length) {
            // All free models exhausted — reset and let normal retry handle it
            console.warn('[Sentinel/LLM] All free vision models rate-limited — resetting cycle');
            _triedModels = new Set();
            // Notify popup of model switch
            try { sendSilentUpdate({ type: 'model_switched', from: currentModel, to: nextModel }); } catch (_) {}
          }
        }
      }
      // (v21.3) Provider-aware backoff: different providers have different rate
      // limit characteristics. GLM/Z.ai 429s need longer backoff than Claude/OpenAI.
      const _model = (agentState && agentState.model) || '';
      const _isGlm = /glm/i.test(_model);
      const _isDeepSeek = /deepseek/i.test(_model);
      const _isFreeTier = /free|openrouter/i.test(_model);
      // GLM/DeepSeek free tiers are heavily rate-limited — give them more room.
      const _providerMultiplier = (_isGlm || _isDeepSeek) ? 2.0 : (_isFreeTier ? 1.5 : 1.0);
      const baseDelay = msg.includes('429') ? CONFIG.retryDelay * _providerMultiplier : CONFIG.retryDelay / 2;
      const delay = Math.min(baseDelay * Math.pow(2, retryCount) + Math.floor(Math.random() * TWO_SECONDS_MS), CONFIG.maxRetryDelay);
      const _reason = msg.includes('429') ? 'rate limited' : msg.includes('overloaded') ? 'overloaded' : 'transient error';
      sendSilentUpdate(`Retrying (${_reason}) in ${Math.round(delay/ONE_SECOND_MS)}s... (attempt ${retryCount + 1}/${CONFIG.maxRetries})`, stepCount);
      await sleep(delay);
      return callLLMWithRetry(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, retryCount + 1, CONFIG, agentState);
    }
    throw err;
  }
}
