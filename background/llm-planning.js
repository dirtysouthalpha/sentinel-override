// ========== Pre-flight Planning ==========
// Extracted from llm-client.js for modularity.
// Generates a numbered plan from the goal before execution begins.
import { planThinkingRetry } from './llm-thinking-budget.js';
import { API_TIMEOUT_MS } from './constants.js';
import { resolveProvider } from './provider-registry.js';
import { getErrorMessage } from './error-utils.js';
import { getMultiPortalDirective, getMultiArticleDirective } from './llm-client.js';

// Copied from llm-client.js to avoid runtime dependency
const CODE_BLOCK_REGEX = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;

/**
 * Generate an initial step plan for a goal using a planning LLM call.
 * Sends the goal + context to the configured model and returns parsed action steps.
 * @param {string} goal - The user's automation goal.
 * @param {Object} settings - Extension settings (api_key, model, api_endpoint, etc.).
 * @param {Object} [context={}] - Additional context (currentUrl, pageTitle, etc.).
 * @returns {Promise<Array|null>} Parsed plan steps, or null on failure.
 */
/**
 * Build the plan-generation prompt string from a goal and context object.
 * Extracted from generatePlan to keep that function under 50 lines.
 * @param {string} goal
 * @param {object} context - { currentUrl, pageTitle, platformContext, relevantPatterns }
 * @returns {string}
 */
function _buildPlanPrompt(goal, context) {
  const urlContext = context.currentUrl
    ? `Current page: ${context.currentUrl}${context.pageTitle ? ` (${context.pageTitle})` : ''}\n`
    : '';
  const platformContext = context.platformContext || '';
  const patternContext = Array.isArray(context.relevantPatterns) && context.relevantPatterns.length
    ? `\nPast successful patterns for similar tasks:\n${context.relevantPatterns.map(p => p && p.goal ? `- "${p.goal}" -> ${Array.isArray(p.steps) ? p.steps.map(s => s && s.type ? s.type : '?').join(', ') : '(no steps)'}` : '').join('\n')}\n`
    : '';

  return `You are an expert browser automation planner for an MSP (Managed Service Provider) tool. Given a user goal and current context, produce a DETAILED hierarchical execution plan formatted as structured phases with sub-tasks.

OUTPUT FORMAT:
{
  "phases": [
    {
      "phase": 1,
      "title": "Phase 1 – Setup",
      "steps": ["step 1", "step 2"]
    },
    {
      "phase": 2,
      "title": "Phase 2 – Discovery",
      "steps": ["step 1", "step 2"]
    }
  ]
}

DECOMPOSITION RULES — follow these exactly:
1. Break every task into EXPLICIT, atomic browser actions. NEVER combine multiple actions into one step.
2. Login flows: navigate to login page → type username → type password → click submit → wait for dashboard
3. Form interactions: locate field → clear/focus → type value → move to next field
4. Navigation: click menu item → wait for content → scan elements → proceed
5. Table/filter tasks: navigate to table → locate filter → set filter → wait for results → read → extract data
6. Configuration changes: navigate to config section → find item → open edit → set values → save → verify success
7. Multi-page research: navigate to source → extract links → open each in tab → read → note findings → close tabs → summarize
8. ALWAYS include data extraction steps (extract, execute_js with key, or note) — never just navigate and read without saving
9. ALWAYS include verification after saves/commits (wait for success message, then use a verify action to confirm the value persisted)
10. For firewalls/network devices: ALWAYS include the save/commit/apply step after any configuration change, followed by a verify action
11. Phases must be numbered sequentially starting at 1. Phase titles are short descriptive strings.
12. If the goal naturally splits into independent sub-goals, create separate phases for each sub-goal.
13. Maximum overall steps still limited to 100, but phases may contain multiple steps.

${urlContext}${platformContext}${patternContext}${getMultiPortalDirective(goal) || ''}${getMultiArticleDirective(goal) || ''}
<GOAL>
${goal}
</GOAL>

Return ONLY a JSON object: { "phases": [...] }

Example GOOD phased plan for a complex MSP task:
{
  "phases": [
    {
      "phase": 1,
      "title": "Initialize",
      "steps": ["Navigate to https://192.168.1.1"]
    },
    {
      "phase": 2,
      "title": "Authenticate",
      "steps": ["Type the username into the login field", "Type the password into the password field", "Click the Login button and wait for dashboard"]
    },
    {
      "phase": 3,
      "title": "Navigate to Rules",
      "steps": ["Click Policy or Firewall in the left navigation menu", "Click Access Rules or IPv4 Rules", "Wait for the rules table to load"]
    },
    {
      "phase": 4,
      "title": "Create Block Rule",
      "steps": ["Click Add Rule or the + button to create a new rule", "Set the Source Zone dropdown to WAN", "Set the Destination Zone dropdown to LAN", "Set the Service dropdown to RDP (port 3389) or type 3389", "Set the Action to Deny or Drop", "Type a descriptive name in the Comment/Name field", "Click Save or Apply", "Wait for the success confirmation banner"]
    },
    {
      "phase": 5,
      "title": "Verify",
      "steps": ["Finish with confirmation that the RDP block rule was created"]
    }
  ]
}

Example GOOD phased plan for a multi-page research task:
{
  "phases": [
    {
      "phase": 1,
      "title": "Source",
      "steps": ["Navigate to cnn.com", "Read the homepage content to identify top stories"]
    },
    {
      "phase": 2,
      "title": "Extract Links",
      "steps": ["Use execute_js with key 'headlines' to extract the top 10 headline titles, links, and descriptions"]
    },
    {
      "phase": 3,
      "title": "Detail Pages",
      "steps": ["For each article that needs more detail, open it in a new tab using open_tab with label", "Switch to each article tab, read the page, and note a brief summary", "Close article tabs when done"]
    },
    {
      "phase": 4,
      "title": "Summarize",
      "steps": ["Finish with a numbered briefing of all 10 articles with headlines and key takeaways"]
    }
  ]
}

Example BAD plan (too vague):
{
  "phases": [
    {
      "phase": 1,
      "title": "Phase 1",
      "steps": ["Go to the website", "Find the information", "Get the data"]
    }
  ]
}`;
}

/**
 * Generate a step-by-step execution plan for the given goal using the LLM.
 * Returns an array of step strings, or null if planning fails or no API key is set.
 *
 * @param {string} goal - The user's task description.
 * @param {object} settings - Provider settings: { api_endpoint, api_key, model }.
 * @param {object} [context] - Optional context: { currentUrl, pageTitle, platformContext, relevantPatterns }.
 * @returns {Promise<string[]|null>}
 */
export async function generatePlan(goal, settings, context = {}) {
  const endpoint = settings.api_endpoint || 'https://api.z.ai/api/coding/paas/v4/chat/completions';
  const apiKey = settings.api_key;
  const model = settings.model || 'glm-5';
  if (!apiKey) return null;

  // Helper to normalize plan step objects/strings into consistent string array
  const _normalizeSteps = arr => arr.map(s => (typeof s === 'string' ? s : (s && typeof s === 'object' ? (s.action || s.description || s.step || JSON.stringify(s)) : String(s)))).filter(Boolean);

  const planPrompt = _buildPlanPrompt(goal, context);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const provider = resolveProvider(endpoint);
    // Only send response_format:json_object to OpenAI proper — Z.AI and other
    // compatible providers may reject or ignore it, causing 400 errors.
    // The fallback strategies in the parse block below handle non-JSON responses.
    const useJsonMode = endpoint.includes('api.openai.com');
    const planHeaders = provider.buildHeaders(apiKey);

    // Reasoning models spend the output budget on reasoning_content before they
    // emit any answer. 1200 tokens is a non-thinking budget: observed live,
    // glm-4.6 burned 25.5s, returned finish_reason "length" with empty content,
    // and this function silently fell back to a single-step plan. Retry ONCE
    // with a bigger budget when — and only when — the response was truncated
    // before producing anything usable.
    let _budget = 1200;
    let data = null;
    let response = null;
    for (let _attempt = 0; _attempt < 2; _attempt++) {
      const planBody = JSON.stringify(provider.buildBody(
        model,
        'You are a planning assistant. Return ONLY valid JSON.',
        planPrompt,
        { maxTokens: _budget, temperature: 0.2, jsonMode: useJsonMode }
      ));
      response = await fetch(endpoint, {
        method: 'POST',
        headers: planHeaders,
        body: planBody,
        signal: controller.signal
      });
      if (!response.ok) break;
      data = await response.json();
      const _verdict = planThinkingRetry(data, _attempt, _budget);
      if (!_verdict.retry) break;
      console.warn(`[Sentinel/plan] Thinking model truncated (${_verdict.reason}); retrying with maxTokens=${_verdict.budget}`);
      _budget = _verdict.budget;
      data = null;
    }
    clearTimeout(timeout);
    if (!response.ok) {
      console.warn('Plan generation API returned', response.status, '— using goal as single-step fallback');
      return [(goal || 'Complete the task').substring(0, 300)];
    }
    if (!data) {
      console.warn('Plan generation: no usable response after thinking-budget retry — single-step fallback');
      return [(goal || 'Complete the task').substring(0, 300)];
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Plan API returned invalid response body');
    // Early detection of auth errors from providers that return HTTP 200 with error payloads
    if ((!data.choices || !data.choices.length) && (data.error || data.msg || (data.code && data.success === false))) {
      const errMsg = data.error?.message || data.msg || data.message || JSON.stringify(data);
      throw new Error(`🔑 API Authentication Failed: ${errMsg}. Check your API key in extension settings.`);
    }
    const content = provider.parseResponse(data);
    if (!content) {
      console.warn('Plan generation: empty response content — using single-step fallback');
      return [(goal || 'Complete the task').substring(0, 300)];
    }
    // Pre-process: strip <think>...</think> blocks that some GLM/DeepSeek models embed
    // directly in the content field. These must be removed BEFORE any JSON scanning so
    // that a plan-like JSON snippet inside the thinking block isn't mistaken for the
    // real plan. This is a no-op when no think tags are present.
    const contentNoThink = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Strategy 1: strip markdown fences, strip control chars, then JSON.parse
    let jsonStr = contentNoThink;
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(CODE_BLOCK_REGEX);
      if (match && match[1]) jsonStr = match[1].trim();
    }
    jsonStr = jsonStr.replace(/[\x00-\x1f]/gu, '');  // eslint-disable-line no-control-regex
    try {
      const parsed = JSON.parse(jsonStr);
      // Some models (Z.AI/GLM) return a bare array ["step1","step2"] with no wrapper object
      if (Array.isArray(parsed) && parsed.length) {
        const strs = _normalizeSteps(parsed);
        if (strs.length) return strs;
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.plan) && parsed.plan.length) {
        const strs = _normalizeSteps(parsed.plan);
        if (strs.length) return strs;
      }
      // New phased format: { "phases": [{ phase: 1, title: "...", steps: [...] }] }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.phases) && parsed.phases.length) {
        const flatSteps = [];
        for (const phase of parsed.phases) {
          if (phase && typeof phase === 'object' && Array.isArray(phase.steps)) {
            flatSteps.push(...phase.steps);
          }
        }
        if (flatSteps.length) return _normalizeSteps(flatSteps);
      }
      // Some models return { "steps": [...] } instead of { "plan": [...] }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps) && parsed.steps.length) {
        const strs = _normalizeSteps(parsed.steps);
        if (strs.length) return strs;
      }
    } catch (e) { console.warn('[Sentinel/llm] Strategy 1 failed:', getErrorMessage(e)); }

    // Strategy 2: scan for the first balanced JSON object containing "plan" or "steps".
    // extractFirstJsonObject() checks for action "type" fields and never matches plan JSON.
    // Uses contentNoThink so thinking-block JSON doesn't get selected over the real plan.
    {
      let s2from = 0;
      const contentLen = contentNoThink.length;
      while (s2from < contentLen) {
        const s2start = contentNoThink.indexOf('{', s2from);
        if (s2start === -1) break;
        let depth = 0, inStr = false, esc = false, s2end = -1;
        for (let i = s2start; i < contentLen; i++) {
          const ch = contentNoThink[i];
          if (esc) { esc = false; continue; }
          if (ch === '\\' && inStr) { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { s2end = i; break; } }
        }
        if (s2end !== -1) {
          try {
            const parsed = JSON.parse(contentNoThink.substring(s2start, s2end + 1));
            if (Array.isArray(parsed.plan) && parsed.plan.length) { const r = _normalizeSteps(parsed.plan); if (r.length) return r; }
            if (Array.isArray(parsed.steps) && parsed.steps.length) { const r = _normalizeSteps(parsed.steps); if (r.length) return r; }
            // New phased format
            if (Array.isArray(parsed.phases) && parsed.phases.length) {
              const flatSteps = [];
              for (const phase of parsed.phases) {
                if (phase && typeof phase === 'object' && Array.isArray(phase.steps)) {
                  flatSteps.push(...phase.steps);
                }
              }
              if (flatSteps.length) return _normalizeSteps(flatSteps);
            }
          } catch (parseErr) {
            /* Not valid JSON at this position - keep scanning for next { */
            console.warn('[Sentinel/llm] JSON parse attempt at position', s2start, 'failed:', getErrorMessage(parseErr));
          }
          s2from = s2end + 1;
        } else { break; }
      }
    }

    // Strategy 3: find first { and last } and try that substring; also try bare array.
    // Uses contentNoThink so thinking-block JSON doesn't pollute the search range.
    try {
      const objStart = contentNoThink.indexOf('{');
      const objEnd = contentNoThink.lastIndexOf('}');
      if (objStart !== -1 && objEnd > objStart) {
        const parsed = (() => { try { return JSON.parse(contentNoThink.slice(objStart, objEnd + 1)); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
        if (Array.isArray(parsed.plan) && parsed.plan.length) { const r = _normalizeSteps(parsed.plan); if (r.length) return r; }
        if (Array.isArray(parsed.steps) && parsed.steps.length) { const r = _normalizeSteps(parsed.steps); if (r.length) return r; }
      }
      // Also handle bare JSON arrays that may appear in prose: find first [ and last ]
      const arrStart = contentNoThink.indexOf('[');
      const arrEnd = contentNoThink.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart && (objStart === -1 || arrStart < objStart)) {
        const parsed = JSON.parse(contentNoThink.slice(arrStart, arrEnd + 1));
        if (Array.isArray(parsed) && parsed.length) { const r = _normalizeSteps(parsed); if (r.length) return r; }
      }
    } catch (e) { console.warn('[Sentinel/llm] Strategy 3 failed:', getErrorMessage(e)); }

    // Strategy 4: extract numbered or bulleted steps from prose.
    // Uses contentNoThink so think-block text isn't mistaken for real plan steps.
    {
      const lines = contentNoThink.split(/\n/).map(l => {
        const _trimmed = l.trim(); // Cache to avoid repeated trim calls
        return _trimmed.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
      }).filter(Boolean);
      // Numbered: "1. Step", "1) Step", "Step 1: Step"
      const numberedLines = lines.filter(l => /^\d+[.)]\s+.{8,}/.test(l) || /^[Ss]tep\s+\d+[:.)\s]+.{8,}/.test(l));
      if (numberedLines.length >= 2) {
        // Single replace with alternation is more efficient than chained replaces
        const steps = numberedLines.map(l => l.replace(/^(?:\d+[.)]\s+|[Ss]tep\s+\d+[:.)\s]+)/, '').trim()).filter(s => s.length >= 8);
        if (steps.length >= 2) {
          console.warn(`Plan generation: extracted ${steps.length} numbered steps from prose`);
          return steps;
        }
      }
      // Bulleted: "- Step", "* Step", "• Step"
      const bulletLines = lines.filter(l => /^[-*•→]\s+.{8,}/.test(l));
      if (bulletLines.length >= 2) {
        const steps = bulletLines.map(l => l.replace(/^[-*•→]\s+/, '').trim()).filter(s => s.length >= 8);
        if (steps.length >= 2) {
          console.warn(`Plan generation: extracted ${steps.length} bullet steps from prose`);
          return steps;
        }
      }
    }

    // Strategy 5: single-step fallback from goal — guarantees a non-null plan
    // even when the model ignores the JSON instruction entirely.
    console.warn('Plan generation: all JSON strategies failed, creating single-step fallback. Content:', contentNoThink.slice(0, 200));
    return [(goal || 'Complete the task').substring(0, 300)];
  } catch (e) {
    clearTimeout(timeout);
    console.warn('Plan generation failed (non-fatal):', getErrorMessage(e));
    // Even on hard exception, return a minimal fallback so the loop has a plan.
    return goal ? [goal.substring(0, 300)] : ['Complete the task'];
  }
}

