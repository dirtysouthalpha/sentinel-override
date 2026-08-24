// Sentinel Override — Thinking-Model Token Budget
//
// Observed live (2026-08-23, glm-4.6 via the z.ai proxy), first call of a run:
//
//   200 25482ms model=glm-4.6 promptChars=4732 finish=length emptyContent=true
//
// 25.5 seconds, a full billed call, and nothing usable came back. A reasoning
// model spends its output budget on `reasoning_content` first and only then
// emits `content`. generatePlan() asked for maxTokens:1200 — a budget sized for
// a non-thinking model — so the model hit the ceiling mid-thought,
// finish_reason came back "length", `content` was empty, and the caller quietly
// fell back to a single-step plan as if the model had simply declined.
//
// The failure is invisible in every way that matters: no error, no non-2xx, no
// log line. It just costs a quarter of a minute and degrades the run's plan.
//
// This module names the condition and sizes the retry. It is deliberately
// conservative: it fires ONLY when the response was truncated AND produced no
// usable content, so a normal long-but-complete answer is never re-billed.

/** Multiplier applied to the failed budget on the single retry. */
export const THINKING_RETRY_MULTIPLIER = 4;

/** Never ask for more than this on a retry, whatever the original budget was. */
export const THINKING_MAX_TOKENS_CAP = 16000;

/**
 * Did this response get cut off before the model produced any answer?
 *
 * True only when BOTH hold:
 *   - the provider says it stopped because it ran out of room
 *     (OpenAI-compatible `finish_reason: "length"`, Anthropic
 *     `stop_reason: "max_tokens"`), and
 *   - there is no usable `content` — empty, whitespace, or nothing but a
 *     `<think>` block.
 *
 * A truncated answer that still contains content is NOT this: that is a normal
 * long response and the caller's parser can salvage it. Re-billing it would
 * double the cost of every verbose reply.
 *
 * @param {object} data - Raw provider response body.
 * @returns {boolean}
 */
export function isTruncatedThinking(data) {
  if (!data || typeof data !== 'object') return false;

  const choice = Array.isArray(data.choices) && data.choices.length ? data.choices[0] : null;
  const finish = (choice && choice.finish_reason) || data.stop_reason || '';
  const truncated = finish === 'length' || finish === 'max_tokens';
  if (!truncated) return false;

  const msg = (choice && choice.message) || {};

  // OpenAI-compatible shape.
  let content = typeof msg.content === 'string' ? msg.content : '';

  // Anthropic shape: content is an array of blocks.
  if (!content && Array.isArray(data.content)) {
    content = data.content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('');
  }

  // A response that is nothing but a think block is no better than empty.
  const usable = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return usable.length === 0;
}

/**
 * The budget to retry with, given the one that was exhausted.
 *
 * @param {number} current - The maxTokens that produced the truncation.
 * @returns {number} A larger budget, capped.
 */
export function nextTokenBudget(current) {
  const base = Number.isFinite(current) && current > 0 ? current : 1200;
  return Math.min(Math.round(base * THINKING_RETRY_MULTIPLIER), THINKING_MAX_TOKENS_CAP);
}

/**
 * Should we spend a retry here? Encapsulates the once-only rule so callers
 * cannot accidentally loop and bill the same prompt repeatedly.
 *
 * @param {object} data - Raw provider response body.
 * @param {number} attempt - 0 for the first call, 1 after one retry.
 * @param {number} currentBudget
 * @returns {{retry: boolean, budget: number, reason: string}}
 */
export function planThinkingRetry(data, attempt, currentBudget) {
  if (attempt >= 1) {
    return { retry: false, budget: currentBudget, reason: 'already retried once' };
  }
  if (!isTruncatedThinking(data)) {
    return { retry: false, budget: currentBudget, reason: 'not a truncated-thinking response' };
  }
  const budget = nextTokenBudget(currentBudget);
  if (budget <= currentBudget) {
    return { retry: false, budget: currentBudget, reason: 'already at the cap' };
  }
  return { retry: true, budget, reason: `truncated with empty content at ${currentBudget} tokens` };
}
