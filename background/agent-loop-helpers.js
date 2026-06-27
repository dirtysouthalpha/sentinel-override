// Sentinel Override v3 — Agent Loop Helper Functions
// Pure functions extracted from runAgentLoop for testability and maintainability.
// These functions have NO dependency on loop state (agentState, history, agentMemory, etc.).
// Each takes explicit parameters and returns values — no side effects.

// ========== Smart URL Builder ==========

/**
 * Build a direct search/navigation URL from a smart_navigate command.
 * @param {string} site - Site identifier (google, wikipedia, youtube, etc.)
 * @param {string} query - Search query string
 * @returns {string} Fully qualified URL
 */
export function buildSmartUrl(site, query) {
  const q = encodeURIComponent(query);
  let smartUrl = '';
  if (site === 'google') smartUrl = `https://www.google.com/search?q=${q}`;
  else if (site === 'weather.gov') smartUrl = `https://forecast.weather.gov/zipcity.php?inputstring=${q}`;
  else if (site === 'wikipedia') smartUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${q}`;
  else if (site === 'youtube') smartUrl = `https://www.youtube.com/results?search_query=${q}`;
  else if (site === 'amazon') smartUrl = `https://www.amazon.com/s?k=${q}`;
  else if (site === 'reddit') smartUrl = `https://www.reddit.com/search/?q=${q}`;
  else if (/^(twitter|x)$/.test(site)) smartUrl = `https://x.com/search?q=${q}`;
  return smartUrl;
}

/**
 * Build a Google search fallback URL.
 * @param {string} query - Search query string
 * @returns {string} Google search URL
 */
export function buildGoogleFallbackUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// ========== Budget Hint Builder ==========

/**
 * Build the step budget hint string for LLM context.
 * @param {number} stepCount - Current step number
 * @param {number} dynamicMaxSteps - Maximum steps allowed
 * @param {number} productiveSteps - Productive steps so far
 * @returns {string} Budget hint string
 */
export function buildBudgetHint(stepCount, dynamicMaxSteps, productiveSteps) {
  const stepsRemaining = Math.max(0, dynamicMaxSteps - stepCount);
  return `Current step: ${stepCount} of ${dynamicMaxSteps} ` +
    `(${stepsRemaining} remaining; ${productiveSteps} productive bumps so far). ` +
    'Pace your work: extract / note / execute_js with key = productive (extends budget). ' +
    'Aimless read_page / scroll = unproductive (does not extend).';
}

// ========== Hostname Comparison ==========

/**
 * Compare two URLs by hostname (ignoring www. prefix).
 * @param {string} url1 - First URL
 * @param {string} url2 - Second URL
 * @returns {{ currentHost: string, targetHost: string, alreadyThere: boolean }}
 */
export function compareHostnames(url1, url2) {
  const currentHost = (() => { try { return new URL(url1).hostname.toLowerCase(); } catch (_) { return ''; } })();
  const targetHost = (() => { try { return new URL(url2).hostname.toLowerCase(); } catch (_) { return ''; } })();
  const noWww = (h) => h.replace(/^www\./, '');
  const currentNoWww = noWww(currentHost);
  const targetNoWww = noWww(targetHost);
  const alreadyThere = !!(currentHost && targetHost &&
    (currentHost === targetHost ||
     currentHost.includes(targetNoWww) ||
     targetHost.includes(currentNoWww)));
  return { currentHost, targetHost, alreadyThere };
}

// ========== Vision History Formatter ==========

/**
 * Format recent action history for vision-mode LLM context.
 * @param {Array<object>} promptHistory - Array of history entries
 * @param {number} windowSize - Number of recent steps to include (default 10)
 * @returns {string} Formatted history string
 */
export function formatVisionHistory(promptHistory, windowSize = 10) {
  const parts = [];
  const histLen = promptHistory.length;
  const start = Math.max(0, histLen - windowSize);
  for (let i = start; i < histLen; i++) {
    const h = promptHistory[i];
    if (!h || !h.action) continue;
    const a = h.action;
    const actionText = a.text ? (typeof a.text === 'string' ? a.text.substring(0, 40) : String(a.text || '').substring(0, 40)) : null;
    const actionTextStr = actionText ? ` "${actionText}"` : '';
    const stepResult = typeof h.result === 'string' ? h.result.substring(0, 80) : String(h.result || '').substring(0, 80);
    parts.push(`Step ${h.step || '?'}: ${a.type}${a.index ? `(${a.index})` : ''}${actionTextStr} -> ${stepResult}`);
  }
  return parts.join('\n');
}

// ========== Vision System Prompt Builder ==========

/**
 * Build the vision-mode system prompt (static text).
 * @returns {string} System prompt string
 */
export function buildVisionSystemPrompt() {
  return [
    'You are Sentinel, an AI agent that automates browser tasks by looking at screenshots with numbered elements.',
    '',
    '<rules>',
    '1. Interactive elements on the page have [index] numbers shown as green labels.',
    '2. You MUST reference elements by their [index] number. ONLY use index numbers that actually appear in the Elements list below — NEVER invent or guess an index. If the element you want has no number, scroll to bring it into view first.',
    '3. CRITICAL: If you see a popup, cookie banner, consent dialog, or overlay — dismiss it FIRST. Look for buttons with text like Accept, Agree, OK, Continue, I agree, Got it, Close, or Dismiss.',
    '4. Overlays often use role="button" or specific aria-labels. Check the element list for these patterns.',
    '5. If clicking an index does not dismiss the overlay after 2 attempts, try a DIFFERENT index — the correct button might be behind another element.',
    '6. If an action fails 2 times, CHANGE your approach entirely.',
    '7. After each action, evaluate whether the page changed. If not, try a different element.',
    '8. Be concise — one action per response.',
    '</rules>',
    '',
    '<actions>',
    'click(index) — Click element by index',
    'input(index, text) — Type text into input element',
    'scroll(direction) — Scroll up or down',
    'navigate(url) — Go to URL',
    'go_back() — Go back in browser history',
    'extract(query) — Read current page text',
    'execute_js(code) — Run custom JavaScript',
    'done(text) — Task complete, provide final answer',
    '</actions>',
    '',
    '<output_format>',
    'Respond with ONLY a single valid JSON object. No markdown fences, no <think> blocks, no text before or after the JSON.',
    '{"thinking":"what you see and why","evaluation":"previous action success/fail/partial","memory":"progress notes","next_goal":"one clear goal","action":{"type":"...","index":N,"text":"...","direction":"up|down","url":"...","code":"..."}}',
    'Include ONLY the fields relevant to the chosen action type. "type" is required; "index" is required for click and input.',
    'Example — click the element labeled [7]: {"thinking":"The Accept button is labeled 7","evaluation":"n/a","memory":"dismissing cookie banner","next_goal":"accept cookies","action":{"type":"click","index":7}}',
    '</output_format>',
    '',
    '<visual_grounding>',
    '- The screenshot and the Elements list use the SAME numbers: a green [N] drawn on the screenshot is the exact element shown as [N] in the Elements list below. Use the screenshot to LOCATE an element and the list to CONFIRM what it is.',
    '- The "index" in your action MUST be a green [N] label you can actually SEE on the screenshot AND that appears in the Elements list below.',
    '- Copy the number from the label EXACTLY — do not estimate, increment, or guess it. [7] means index 7, never 6 or 8.',
    '- NEVER invent or guess an index. If you are not sure an element exists, scroll or choose a different visible element instead.',
    '- NEGATIVE EXAMPLE (do NOT do this): seeing a button labeled [12] but writing {"action":{"type":"click","index":9}}. A wrong index clicks the wrong thing or wastes the step.',
    '- When unsure which number maps to your target, prefer the entry in the Elements list whose text matches your goal over a number you only half-see on the screenshot.',
    '</visual_grounding>',
    '',
    '<efficiency_rules>',
    '- If you have extracted data that answers the goal, call done() IMMEDIATELY — do not extract again.',
    '- Do NOT run execute_js on the same page more than twice. If you need data, use extract() once.',
    '- If ALREADY ATTEMPTED shows your action succeeded, do NOT repeat it — move to the next step.',
    '- If the Current Memory section shows data that answers the goal, call done() right now.',
    '- Prefer extract() over execute_js for reading page content — it is faster and cheaper.',
    '- If the goal contains a full URL, navigate DIRECTLY to it. Do NOT go to a homepage and search.',
    '- Be efficient: 3-5 steps is ideal. If you have the answer, finish.',
    '</efficiency_rules>'
  ].join('\n');
}

// ========== Vision User Content Builder ==========

/**
 * Build the vision-mode user content string.
 * @param {string} goal - The agent goal
 * @param {string} currentUrl - Current page URL
 * @param {number} stepCount - Current step number
 * @param {number} dynamicMaxSteps - Max steps allowed
 * @param {string} elementTree - Formatted element tree string
 * @param {string} visionHistory - Formatted history string
 * @param {string|null} zoomAnnotation - Optional zoom annotation
 * @returns {string} User content string
 */
export function buildVisionUserContent(goal, currentUrl, stepCount, dynamicMaxSteps, elementTree, visionHistory, zoomAnnotation, loopDirective, agentMemory) {
  const parts = [
    `Goal: ${goal}`,
    `URL: ${currentUrl}`,
    `Step: ${stepCount}/${dynamicMaxSteps}`,
    '',
    'Elements:',
    elementTree || '(none)',
    '',
    'ALREADY ATTEMPTED (do NOT repeat an action that did not change the page — try a different element or approach):',
    visionHistory || '(first step — nothing attempted yet)',
    zoomAnnotation || ''
  ];
  // (v21.6.15) Show current memory so the model knows what data it already has
  if (agentMemory && Object.keys(agentMemory).length > 0) {
    const _memLines = Object.entries(agentMemory).map(([k, v]) => {
      const _val = typeof v === 'string' ? v : JSON.stringify(v);
      const _preview = _val.length > 200 ? _val.substring(0, 200) + '...' : _val;
      return `  ${k}: "${_preview}" (${_val.length} chars)`;
    });
    parts.push('');
    parts.push('Current Memory (you already have this data — use it!):');
    parts.push(_memLines.join('\n'));
  }
  if (loopDirective && loopDirective.trim()) {
    parts.push('');
    parts.push(loopDirective.trim());
  }
  parts.push('');
  parts.push('What is your next action?');
  return parts.join('\n');
}

// ========== Run Log Entry Builder ==========

/**
 * Build a structured run log entry for a single step.
 * @param {number} stepCount - Current step number
 * @param {string} currentUrl - Current page URL
 * @param {object} command - The action command
 * @param {*} result - Action result
 * @param {boolean} actionFailed - Whether the action failed
 * @param {string|null} tenantChip - Detected tenant chip text
 * @param {string|null} reasoning - Command reasoning
 * @param {string|null} screenshot - Step screenshot
 * @returns {object} Run log entry object
 */
export function buildRunLogEntry(stepCount, currentUrl, command, result, actionFailed, tenantChip, reasoning, screenshot) {
  return {
    step: stepCount,
    timestamp: new Date().toISOString(),
    kind: 'action',
    url: currentUrl,
    tenant: tenantChip || '',
    action_type: command.type,
    action: {
      selector: command.selector,
      ref: command.ref,
      url: command.url,
      key: command.key,
      text: (() => {
        const t = command.text;
        return (typeof t === 'string') ? t.substring(0, 200) : undefined;
      })(),
      x: command.x, y: command.y
    },
    result: (() => {
      if (typeof result === 'string') {
        return result.substring(0, 500);
      }
      const jsonStr = JSON.stringify(result || '');
      return jsonStr.substring(0, 500);
    })(),
    failed: !!actionFailed,
    reasoning: (() => {
      return (typeof reasoning === 'string' && reasoning) ? reasoning.substring(0, 400) : undefined;
    })(),
    screenshot: screenshot || undefined,
  };
}

// ========== Goal Completion Detection ==========

/**
 * Check if an LLM response indicates goal completion.
 * @param {object|null} command - Parsed command from LLM response
 * @returns {boolean} True if goal is complete
 */
export function isGoalComplete(command) {
  if (!command) return false;
  return command.type === 'done';
}

/**
 * Check if a command is a page-mutating action.
 * @param {string} commandType - The command type
 * @param {RegExp} pageMutatingRe - Regex matching page-mutating actions
 * @returns {boolean}
 */
export function isPageMutating(commandType, pageMutatingRe) {
  return pageMutatingRe.test(commandType);
}

// ========== URL Extraction from Goal ==========

/**
 * Normalize a goal URL: ensure it has a protocol.
 * @param {string} urlMatch - Raw URL match from goal text
 * @param {string|null} domainMatch - Optional domain-only match
 * @returns {string} Normalized URL with protocol
 */
export function normalizeGoalUrl(urlMatch, domainMatch) {
  return urlMatch.startsWith('http') ? urlMatch : `https://${domainMatch || urlMatch}`;
}

/**
 * Check if a goal contains an explicit navigation command.
 * @param {string} goalText - Goal text with emails stripped
 * @returns {boolean}
 */
export function isExplicitNavigation(goalText) {
  if (typeof goalText !== 'string') return false;
  return (/^(?:go to|navigate to|visit|open|browse to|start at|begin at|check)\b/i.test(goalText.trimStart())
    || /\bbegin at:\s*\S/i.test(goalText)
    || /\bstart url:\s*\S/i.test(goalText));
}
