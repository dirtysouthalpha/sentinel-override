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
    'You are Sentinel, an autonomous web agent. Navigate pages, extract data, complete tasks efficiently.',
    '<rules>',
    'CRITICAL RULES:',
    '1. Use [index] to reference elements from the Elements list. Example: click(index) where index is the number.',
    '2. Screenshot and Elements use SAME index numbers. Green outline = clickable.',
    '3. extract() is DEFAULT for reading pages. Use execute_js ONLY when extract() fails or you need specific data.',
    '4. done(text) = task complete. Put your FINAL ANSWER inside done(). Never output raw text.',
    '5. When data is already in memory, call done() immediately — do NOT re-extract.',
    '6. Do NOT click links navigating to different websites unless the task requires it.',
    '7. If a click does not change the page, try execute_js or keyboard navigation instead.',
    '8. For tables: use execute_js with querySelectorAll("tr") to extract rows.',
    '9. Avoid consecutive identical actions. If stuck, switch strategy or call done().',
    '</rules>',
    '<actions>',
    'RESPONSE FORMAT (JSON):',
    '{"thinking":"brief reasoning","tool":"click|extract|execute_js|done","args":{}}',
    'click: {"tool":"click","args":{"index":N}} | extract: {"tool":"extract","args":{}} | execute_js: {"tool":"execute_js","args":{"code":"..."}} | done: {"tool":"done","args":{"text":"answer"}}',
    '</actions>',
    '<output_format>',
    '<visual_grounding>'
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
export function buildVisionUserContent(goal, currentUrl, stepCount, dynamicMaxSteps, elementTree, visionHistory, zoomAnnotation, loopDirective, agentMemory, pageStagnation) {
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
    zoomAnnotation || '',
    '',
    pageStagnation > 0 ? `⚠️ STAGATION WARNING: The page did NOT change after your last ${pageStagnation} action(s). Try a completely different approach or call done() if you have the data.` : ''
  ];
  // (v21.6.15) Show current memory so the model knows what data it already has
  if (agentMemory && Object.keys(agentMemory).length > 0) {
    const _memLines = Object.entries(agentMemory).map(([k, v]) => {
      const _val = typeof v === 'string' ? v : JSON.stringify(v);
      const _preview = _val.length > 500 ? _val.substring(0, 500) + '...' : _val;
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
        return (typeof t === 'string') ? t.substring(0, 500) : undefined;
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
