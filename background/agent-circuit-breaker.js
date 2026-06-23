// ========== Agent Circuit Breaker ==========
// Detects and breaks degenerate loops that the existing action-type checks miss.
// Specifically:
//   - Identical actions (same type + selector + text) repeated N times
//   - Click loops (clicking the same coordinates/element repeatedly)
//   - Hard step ceiling that cannot be bumped by productiveSteps
//   - Stale page detection (page hasn't changed despite multiple actions)
//
// This is the "last line of defense" before the LLM wastes another API call.
// Inspired by Claude Computer Use's loop-guard and Browser Use's max_same_action.

;

/**
 * Absolute maximum steps regardless of productiveSteps bumps.
 * Cannot be overridden by dynamicMaxSteps logic.
 */
export const ABSOLUTE_MAX_STEPS = 150;

/**
 * How many times the EXACT same action can repeat before we force a strategy shift.
 * 3 is enough to confirm a genuine stuck state (not a flaky click).
 */
export const MAX_IDENTICAL_ACTIONS = 3;

/**
 * How many times clicking the same element/coords before we force a different approach.
 */
export const MAX_SAME_TARGET_CLICKS = 3;

/**
 * Window for detecting action similarity patterns (look-back).
 */
const SIMILARITY_WINDOW = 8;

/**
 * Create a fingerprint of a command for dedup comparison.
 * Two commands with the same fingerprint are functionally identical.
 * @param {Object} cmd - The command object from LLM.
 * @returns {string} Action fingerprint.
 */
export function fingerprintCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return 'null';
  const type = cmd.type || 'unknown';
  // For click actions, fingerprint on selector + description
  if (type === 'click' || type === 'click_at') {
    const target = cmd.selector || cmd.ref || cmd.description ||
      (cmd._visionIndex ? `idx:${cmd._visionIndex}` : '') ||
      `x:${cmd.x || 0},y:${cmd.y || 0}`;
    return `${type}:${target}`;
  }
  // For type actions, include the text being typed
  if (type === 'type' || type === 'type_submit') {
    const target = cmd.selector || cmd.ref || cmd.description || '';
    const text = (cmd.text || '').substring(0, 50);
    return `${type}:${target}:${text}`;
  }
  // For scroll, fingerprint direction + amount
  if (type === 'scroll') {
    return `${type}:${cmd.direction || 'down'}:${cmd.amount || 'default'}`;
  }
  // For navigate, include URL
  if (type === 'navigate') {
    return `${type}:${(cmd.url || '').substring(0, 100)}`;
  }
  // For execute_js, include first 200 chars of code
  if (type === 'execute_js') {
    return `${type}:${(cmd.code || '').substring(0, 200)}`;
  }
  // Default: type + selector
  return `${type}:${cmd.selector || cmd.ref || cmd.url || ''}`;
}

/**
 * Analyze recent history for degenerate loop patterns.
 * Returns a diagnostic object with recommended action.
 *
 * @param {Array} history - Agent history array.
 * @param {number} stepCount - Current step number.
 * @param {number} dynamicMaxSteps - Current dynamic step cap.
 * @returns {Object} { shouldBreak, reason, directive, severity }
 */
export function checkCircuitBreaker(history, stepCount, dynamicMaxSteps) {
  const result = {
    shouldBreak: false,
    shouldHardStop: false,
    reason: '',
    directive: '',
    severity: 'none', // 'none' | 'warning' | 'critical'
  };

  // --- CHECK 1: Absolute hard step ceiling ---
  if (stepCount > ABSOLUTE_MAX_STEPS) {
    result.shouldHardStop = true;
    result.reason = `ABSOLUTE STEP CEILING: ${stepCount} > ${ABSOLUTE_MAX_STEPS} (hard limit). Productive-step bumps cannot extend past this.`;
    result.severity = 'critical';
    return result;
  }

  // --- CHECK 5: Step budget approaching absolute cap ---
  // (moved before history check so it fires even with empty history)
  if (stepCount >= ABSOLUTE_MAX_STEPS - 10) {
    result.reason = `APPROACHING ABSOLUTE STEP CEILING: ${stepCount} steps (cap: ${ABSOLUTE_MAX_STEPS}).`;
    result.directive = `\n⚠️ FINAL STEPS: You are at step ${stepCount} of an absolute maximum of ${ABSOLUTE_MAX_STEPS}. You MUST call finish() NOW with whatever results you have. Do not attempt any more exploratory actions.\n`;
    result.severity = 'warning';
    return result;
  }

  if (!history || history.length < 2) return result;

  // --- CHECK 2: Identical action repeated N+ times ---
  const recentActions = history.slice(-SIMILARITY_WINDOW);
  const fingerprints = recentActions.map(h => {
    if (!h || !h.action) return 'none';
    return fingerprintCommand(h.action);
  });

  // Count consecutive identical actions at the end
  const lastFp = fingerprints[fingerprints.length - 1];
  let consecutiveIdentical = 0;
  for (let i = fingerprints.length - 1; i >= 0; i--) {
    if (fingerprints[i] === lastFp && lastFp !== 'none' && lastFp !== 'note:null') {
      consecutiveIdentical++;
    } else {
      break;
    }
  }

  if (consecutiveIdentical >= MAX_IDENTICAL_ACTIONS) {
    result.shouldBreak = true;
    result.reason = `IDENTICAL ACTION LOOP: "${lastFp}" repeated ${consecutiveIdentical} times. Agent is stuck.`;
    result.directive = `\n🔴 CIRCUIT BREAKER: You have attempted the exact same action (${lastFp}) ${consecutiveIdentical} times in a row with no progress. This action is NOT working. You MUST:\n1. Choose a COMPLETELY DIFFERENT approach (different selector, different action type, or execute_js).\n2. If you are stuck on a login/auth page, call finish() and report the blocker.\n3. Do NOT repeat the same action again.\n`;
    result.severity = 'critical';
    return result;
  }

  // --- CHECK 3: Same target clicked N+ times across the window (non-consecutive) ---
  const clickFingerprints = fingerprints.filter(fp => fp.startsWith('click'));
  if (clickFingerprints.length >= 2) {
    const clickCounts = {};
    for (const fp of clickFingerprints) {
      clickCounts[fp] = (clickCounts[fp] || 0) + 1;
    }
    const maxClickRepeat = Math.max(...Object.values(clickCounts));
    if (maxClickRepeat >= MAX_SAME_TARGET_CLICKS) {
      const stuckTarget = Object.entries(clickCounts).find(([_, c]) => c === maxClickRepeat)[0];
      result.shouldBreak = true;
      result.reason = `REPEATED TARGET: ${stuckTarget} clicked ${maxClickRepeat} times in last ${SIMILARITY_WINDOW} steps.`;
      result.directive = `\n🔴 CIRCUIT BREAKER: You have clicked the same element (${stuckTarget}) ${maxClickRepeat} times. This element is not responding to clicks. You MUST:\n1. Use execute_js to trigger the action programmatically (element.click() or dispatchEvent).\n2. Try scrolling to reveal a different control, or navigate to a different page section.\n3. If this is a login/auth wall, call finish() and report that manual authentication is required.\n4. Do NOT click this element again.\n`;
      result.severity = 'critical';
      return result;
    }
  }

  // --- CHECK 4: High failure rate in recent window ---
  const recentWindow = history.slice(-10);
  const failures = recentWindow.filter(h =>
    h && h.result && typeof h.result === 'string' &&
    (h.result.startsWith('BLOCKED:') ||
     h.result.startsWith('Error') ||
     h.result.startsWith('Element not found') ||
     h.result.startsWith('JS Error') ||
     h.result.includes('not found') ||
     h.result.includes('failed'))
  );
  if (recentWindow.length >= 6 && failures.length >= recentWindow.length * 0.7) {
    result.shouldBreak = true;
    result.reason = `HIGH FAILURE RATE: ${failures.length}/${recentWindow.length} recent steps failed (${Math.round(failures.length / recentWindow.length * 100)}%).`;
    result.directive = `\n⚠️ CIRCUIT BREAKER: ${failures.length} of your last ${recentWindow.length} actions failed. Your current strategy is not working. Step back and reconsider:\n1. Is the page fully loaded? Try wait + re-observe.\n2. Are you on the right page? Check the URL.\n3. Are your selectors correct? Re-read the element list.\n4. If nothing works, call finish() with a summary of what you attempted and where you're blocked.\n`;
    result.severity = 'warning';
    return result;
  }

  return result;
}

/**
 * Check if the page has fundamentally changed between observations.
 * Detects when the agent is acting on a stale/frozen page.
 *
 * @param {string} currentDomHash - Hash of current DOM state.
 * @param {string} lastDomHash - Hash from previous observation.
 * @param {number} unchangedSteps - How many steps the DOM has been unchanged.
 * @returns {Object} { isStale, directive }
 */
export function checkPageStaleness(currentDomHash, lastDomHash, unchangedSteps) {
  // If the page hash changed, reset staleness regardless of unchangedSteps counter
  if (currentDomHash !== lastDomHash) {
    return { isStale: false, directive: '' };
  }
  if (unchangedSteps >= 4) {
    return {
      isStale: true,
      directive: `\n⚠️ STALE PAGE: The page has not changed in ${unchangedSteps} steps despite your actions. Either:\n1. Your actions are not taking effect (check if the element is disabled/covered).\n2. The page requires a different interaction (try execute_js or a different selector).\n3. You may be on a page that requires human authentication — call finish() if so.\n`,
    };
  }
  return { isStale: false, directive: '' };
}
