// background/agent-loop-machine.js
//
// The explicit state machine behind runAgentLoop (#45), plus the pure
// per-phase decision logic lifted verbatim out of the loop body.
//
// WHY THIS SHAPE
// --------------
// runAgentLoop is one ~4,950-line `while` with ~120 live locals and 26 distinct
// terminal exits reached by `break` from nine nesting levels. `break`/`continue`
// cannot cross a function boundary, so bulk-extracting phases into functions
// would mean inventing a return-code protocol for every one of those exits — the
// single most likely way to silently change agent behaviour, which is exactly
// what #45 warns against.
//
// So the machine is introduced in the shape that is provably behaviour-
// preserving:
//
//   1. LOOP_PHASE / PHASE_SEQUENCE name the states the loop already moves
//      through, and the loop declares its phase at each boundary. Declaring a
//      phase is pure bookkeeping — it cannot change what the loop does.
//   2. LOOP_EXIT enumerates every terminal the loop can reach. Naming them turns
//      26 anonymous `break`s into a closed, testable alphabet.
//   3. The pure decision logic each phase runs (step budget, loop directives,
//      circuit-breaker escalation, prompt-history construction, vision action
//      mapping, element partitioning, finish-memory cleanup) moves here
//      verbatim, where it can be unit-tested in isolation instead of only
//      through a 60-step integration run.
//
// Nothing in this module touches chrome.*, the network, or module state in
// agent-engine.js. Every function is pure or (for the machine) owns only its own
// instance state.

// ═══════════════════════════════════════════════════════════════════════════
// Phases
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The states one iteration of runAgentLoop moves through, in order.
 *
 * These are descriptive, not aspirational: each maps onto a contiguous span of
 * the existing loop body. The issue's proposed Observe/Think/Act/Verify/
 * Checkpoint model is the spine; the extra states are the ones the real loop
 * turned out to need (tab acquisition, human-interrupt gates, directive
 * synthesis, command preprocessing, and non-page command dispatch).
 */
export const LOOP_PHASE = Object.freeze({
  /** Stop/pause checks, context injections, corrections, step budget. */
  PREFLIGHT: 'preflight',
  /** Resolve the working tab, wait for load, handle cert/restricted pages. */
  ACQUIRE_TAB: 'acquire_tab',
  /** Inject the content script, dismiss overlays, read the page, screenshot. */
  OBSERVE: 'observe',
  /** Human gates: sign-in wall, MFA challenge, CAPTCHA. */
  INTERRUPT: 'interrupt',
  /** Loop-directive synthesis, circuit breaker, recovery skills. */
  DIRECTIVES: 'directives',
  /** The LLM consult (vision / parallel text / legacy) that produces a command. */
  THINK: 'think',
  /** Command normalisation: prose guard, templates, target resolution. */
  PREPROCESS: 'preprocess',
  /** Commands handled without touching the page (finish, note, lookup, ...). */
  DISPATCH: 'dispatch',
  /** Executing a page-affecting action, including the fallback ladders. */
  ACT: 'act',
  /** Failure accounting, loop detectors, stall detection. */
  VERIFY: 'verify',
  /** History/run-log persistence, checkpoint write, pacing. */
  CHECKPOINT: 'checkpoint',
  /** Post-loop: report generation and cleanup. */
  FINALIZE: 'finalize',
});

/** The canonical order phases run in within a single step. */
export const PHASE_SEQUENCE = Object.freeze([
  LOOP_PHASE.PREFLIGHT,
  LOOP_PHASE.ACQUIRE_TAB,
  LOOP_PHASE.OBSERVE,
  LOOP_PHASE.INTERRUPT,
  LOOP_PHASE.DIRECTIVES,
  LOOP_PHASE.THINK,
  LOOP_PHASE.PREPROCESS,
  LOOP_PHASE.DISPATCH,
  LOOP_PHASE.ACT,
  LOOP_PHASE.VERIFY,
  LOOP_PHASE.CHECKPOINT,
]);

/**
 * Every terminal the loop can reach.
 *
 * Enumerated by reading all 26 `break` statements plus the normal loop-condition
 * exit. Anything that stops a run is in here; if a future change adds a new way
 * out, it belongs in this list.
 */
export const LOOP_EXIT = Object.freeze({
  /** `finished && agentRunning` went false without an explicit break. */
  LOOP_CONDITION: 'loop_condition',
  /** stopAgent() / pause-cancel observed at one of the six agentRunning checks. */
  STOPPED: 'stopped',
  /** 4+ steps elapsed with apiCallCount still 0 — the page is not scriptable. */
  NO_LLM_CALLS: 'no_llm_calls',
  /** stepCount exceeded the dynamic step ceiling. */
  STEP_LIMIT: 'step_limit',
  /** No active tab and no recoverable tab context. */
  NO_ACTIVE_TAB: 'no_active_tab',
  /** The working tab disappeared from both getTabInfo and tabs.query. */
  TAB_CLOSED: 'tab_closed',
  /** Started on chrome://-style page and the goal contained no URL to escape to. */
  RESTRICTED_PAGE_NO_URL: 'restricted_page_no_url',
  /** Started on a restricted page and both navigate and new-tab fallback failed. */
  RESTRICTED_PAGE_NAV_FAILED: 'restricted_page_nav_failed',
  /** Circuit breaker hard stop, or the absolute step ceiling. */
  HARD_STOP: 'hard_stop',
  /** Circuit breaker saw an identical-action loop 5+ deep and force-finished. */
  CIRCUIT_BREAKER_FORCE_FINISH: 'circuit_breaker_force_finish',
  /**
   * The vision request body failed to serialise.
   *
   * NOTE — pre-existing behaviour, deliberately preserved: the `break` at this
   * site is commented "Exit vision mode on serialization failure", but its
   * nearest enclosing loop is the main `while`, so it ends the entire run rather
   * than falling through to the legacy LLM path. Named here so the discrepancy
   * is visible instead of buried; fixing it is a behaviour change and therefore
   * out of scope for #45.
   */
  VISION_PAYLOAD_SERIALIZATION: 'vision_payload_serialization',
  /** Three identical no-action prose replies (the PR #61 announce-loop guard). */
  PROSE_LOOP: 'prose_loop',
  /** The model called finish and every finish gate passed. */
  FINISH: 'finish',
  /** click_at attempted while >500 chars of data already sat in memory. */
  CLICK_AT_DATA_IN_MEMORY: 'click_at_data_in_memory',
  /** Second coordinate-less click_at in a run. */
  CLICK_AT_BLOCK_LIMIT: 'click_at_block_limit',
  /** execute_js blocked twice — the page rejects all JS execution. */
  JS_BLOCKED: 'js_blocked',
  /** The same execute_js result came back after two DUPLICATE blocks. */
  DUPLICATE_JS: 'duplicate_js',
  /** Duplicate execute_js result while >500 chars were already captured. */
  AUTO_FINISH_DATA_READY: 'auto_finish_data_ready',
  /** The click_at watchdog fired STUCK_CLICK_LOOP_ABORT_FIRES times. */
  STUCK_CLICK_LOOP: 'stuck_click_loop',
  /** 4+ BLOCKED/Recovery results in the last 12 steps (alternating loop). */
  ALT_LOOP: 'alt_loop',
  /** The step threw, the tab was closed, and no replacement tab existed. */
  TAB_RECOVERY_FAILED: 'tab_recovery_failed',
});

const _PHASE_VALUES = new Set(Object.values(LOOP_PHASE));
const _EXIT_VALUES = new Set(Object.values(LOOP_EXIT));

/** @returns {boolean} whether `phase` is a declared LOOP_PHASE value. */
export function isPhase(phase) { return _PHASE_VALUES.has(phase); }
/** @returns {boolean} whether `reason` is a declared LOOP_EXIT value. */
export function isExitReason(reason) { return _EXIT_VALUES.has(reason); }

/**
 * Is moving from `from` to `to` a legal step transition?
 *
 * The loop only ever moves forward through PHASE_SEQUENCE within a step, and
 * `continue` sends it back to PREFLIGHT from anywhere. FINALIZE is reachable
 * from any phase (the loop can break out mid-step). Forward skips are legal —
 * most steps never reach ACT (a `note` short-circuits at DISPATCH) and a cached
 * observation skips work inside OBSERVE without skipping the phase itself.
 */
export function isLegalTransition(from, to) {
  if (!isPhase(to)) return false;
  if (to === LOOP_PHASE.FINALIZE) return true;
  if (from === null || from === undefined) return to === LOOP_PHASE.PREFLIGHT;
  if (!isPhase(from)) return false;
  if (from === LOOP_PHASE.FINALIZE) return false;   // FINALIZE is terminal
  if (to === LOOP_PHASE.PREFLIGHT) return true;     // `continue` restarts the step
  const fromIdx = PHASE_SEQUENCE.indexOf(from);
  const toIdx = PHASE_SEQUENCE.indexOf(to);
  return fromIdx >= 0 && toIdx > fromIdx;
}

/**
 * Create the per-run loop state machine.
 *
 * Pure bookkeeping: it records where the loop is, which phases each step
 * touched, and how the run ended. It never decides anything — the loop still
 * owns control flow — so wiring it in cannot change agent behaviour. What it
 * buys is a phase trace for postmortems and a machine-checkable statement of
 * which transitions are supposed to be possible.
 *
 * @param {{strict?: boolean, maxTrace?: number}} [options]
 *   strict   — throw on an illegal transition (tests use this; the loop does not)
 *   maxTrace — ring-cap on retained per-step traces (default 200)
 */
export function createLoopMachine(options = {}) {
  const strict = !!options.strict;
  const maxTrace = Number.isInteger(options.maxTrace) && options.maxTrace > 0 ? options.maxTrace : 200;

  let phase = null;
  let step = 0;
  let exitReason = null;
  let exitDetail = '';
  let illegalTransitions = 0;
  /** @type {Array<{step: number, phases: string[]}>} */
  const trace = [];
  let currentTrace = null;

  function beginStep(n) {
    step = Number.isFinite(n) ? n : step + 1;
    currentTrace = { step, phases: [] };
    trace.push(currentTrace);
    if (trace.length > maxTrace) trace.splice(0, trace.length - maxTrace);
    return enter(LOOP_PHASE.PREFLIGHT);
  }

  function enter(next) {
    if (!isLegalTransition(phase, next)) {
      illegalTransitions++;
      if (strict) {
        throw new Error(`[agent-loop-machine] illegal transition ${String(phase)} -> ${String(next)}`);
      }
    }
    phase = next;
    if (currentTrace && next !== LOOP_PHASE.FINALIZE) currentTrace.phases.push(next);
    return next;
  }

  function exit(reason, detail) {
    if (exitReason !== null) return exitReason;  // first terminal wins
    if (!isExitReason(reason)) {
      illegalTransitions++;
      if (strict) throw new Error(`[agent-loop-machine] unknown exit reason: ${String(reason)}`);
      return exitReason;
    }
    exitReason = reason;
    exitDetail = typeof detail === 'string' ? detail : '';
    return exitReason;
  }

  function finalize() {
    if (exitReason === null) exitReason = LOOP_EXIT.LOOP_CONDITION;
    enter(LOOP_PHASE.FINALIZE);
    return exitReason;
  }

  return {
    beginStep,
    enter,
    exit,
    finalize,
    get phase() { return phase; },
    get step() { return step; },
    get exitReason() { return exitReason; },
    get exitDetail() { return exitDetail; },
    get illegalTransitions() { return illegalTransitions; },
    /** Phases touched on the most recent step. */
    lastStepPhases() { return currentTrace ? currentTrace.phases.slice() : []; },
    /** Immutable snapshot for reports / postmortems. */
    snapshot() {
      return {
        phase,
        step,
        exitReason,
        exitDetail,
        illegalTransitions,
        trace: trace.map(t => ({ step: t.step, phases: t.phases.slice() })),
      };
    },
    reset() {
      phase = null; step = 0; exitReason = null; exitDetail = '';
      illegalTransitions = 0; trace.length = 0; currentTrace = null;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREFLIGHT — step budget
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the step ceiling for this iteration. Moved verbatim from the top of
 * the loop body.
 *
 * Baseline is `maxSteps`, +50 when the goal names two or more portals (so a
 * multi-portal investigation doesn't choke on the first one), then +25 per
 * productive action — all clamped to a hard 60, which is the real ceiling for
 * browser automation regardless of how generous the baseline looks.
 *
 * @param {string} goal
 * @param {number} maxSteps       CONFIG.maxSteps
 * @param {number} productiveSteps
 * @param {RegExp} multiPortalRe  global regex matching known portal names
 * @returns {{dynamicBaseline: number, dynamicMaxSteps: number, multiPortal: boolean}}
 */
export function computeStepBudget(goal, maxSteps, productiveSteps, multiPortalRe) {
  let dynamicBaseline = maxSteps;
  let multiPortal = false;
  try {
    // Global match counts distinct platform keywords safely (avoids ReDoS from a .* pattern).
    if (typeof goal === 'string' && multiPortalRe) {
      const matches = goal.match(multiPortalRe);
      if (matches && matches.length >= 2) {
        dynamicBaseline = maxSteps + 50;
        multiPortal = true;
      }
    }
  } catch (_e) {
    // Dynamic baseline calculation failed non-fatally.
  }
  return {
    dynamicBaseline,
    multiPortal,
    dynamicMaxSteps: Math.min(60, dynamicBaseline + (productiveSteps * 25)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OBSERVE — element partitioning
// ═══════════════════════════════════════════════════════════════════════════

/** Element selectors that get priority in the capped list handed to the LLM. */
export const PRIORITY_ELEMENT_TYPES = new Set(['button', 'input', 'select', 'textarea']);

/**
 * Order observed elements (interactive first), cap the list, and truncate long
 * label text. Moved verbatim from the observation phase.
 *
 * Deliberately NOT hardened against a non-array input: the inline version
 * called .reduce() straight on the value and a malformed observation therefore
 * threw into the loop's per-step catch (log + retry). Swallowing that here
 * would turn a retried step into a silent zero-element observation, which is a
 * behaviour change. The caller guarantees an array.
 *
 * @param {Array} allElements
 * @param {number} maxElements CONFIG.maxElements
 * @returns {Array} a new array — the cached observation's elements are untouched
 */
export function partitionElements(allElements, maxElements) {
  const { priorityEls, otherEls } = allElements.reduce((acc, e) => {
    const selectorLower = e.selector?.toLowerCase() || '';
    let isPriority = false;
    for (const t of PRIORITY_ELEMENT_TYPES) {
      if (selectorLower.includes(t)) {
        isPriority = true;
        break;
      }
    }
    (isPriority ? acc.priorityEls : acc.otherEls).push(e);
    return acc;
  }, { priorityEls: [], otherEls: [] });
  return [...priorityEls, ...otherEls]
    .slice(0, maxElements)
    .map(e => ({
      ...e,
      text: e.text && e.text.length > 80 ? e.text.substring(0, 77) + '...' : e.text
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// DIRECTIVES — anti-loop directive synthesis
// ═══════════════════════════════════════════════════════════════════════════

/** Own copy of agent-engine's getObjectLength (own-enumerable key count). */
function objectLength(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return 0;
  let count = 0;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) count++;
  }
  return count;
}

/**
 * Build the anti-loop directive appended to this step's prompt.
 *
 * Six checks, first match wins, in the order the loop applied them:
 *   0. two consecutive read_page on the same page
 *   1. URL-aware action-type loop (7 navigates, nothing extracted)
 *   1b. execute_js-heavy / consecutive non-productive window
 *   1c. page rendered empty twice running
 *   2. step-based soft caps at 15 and 20
 *
 * Pure: every input is passed in, including the action-type loop detector, so
 * the whole ladder can be unit-tested without a browser.
 *
 * @param {object} ctx
 * @param {Array}  ctx.history
 * @param {object} ctx.agentMemory
 * @param {number} ctx.stepCount
 * @param {boolean} ctx.pageIsEmpty
 * @param {boolean} ctx.elementsEmpty
 * @param {Function} ctx.detectActionTypeLoop  (history, agentMemory) => {isLoop, type, count}
 * @param {Set<string>} ctx.nonProductiveReadActions
 * @param {Set<string>} ctx.dataActions
 * @param {Set<string>} ctx.tabActions
 * @returns {string} the directive, or '' when the run looks healthy
 */
export function buildLoopDirective(ctx) {
  const {
    history, agentMemory, stepCount, pageIsEmpty, elementsEmpty,
    detectActionTypeLoop, nonProductiveReadActions, dataActions, tabActions,
  } = ctx;
  let loopDirective = '';
  const _histLen = history.length;

  // (3.8.0) Tightened read_page loop guard: 2+ consecutive read_page on the
  // same URL is a stall (page hasn't changed; rereading achieves nothing).
  if (_histLen >= 2) {
    const last = history[_histLen - 1] || null;
    const prior = history[_histLen - 2] || null;
    const isReadPage = h => h && h.action && h.action.type === 'read_page';
    if (last && prior && isReadPage(last) && isReadPage(prior)) {
      loopDirective = '\n⚠ READ_PAGE LOOP DETECTED — Two consecutive read_page actions returned the same content. The page state has not changed. You MUST take a different approach now: use "extract" / "extract_list" with specific selectors, "execute_js" to query the DOM directly, "scroll" to reveal more content, or "click" to interact. Do NOT call read_page again on this same page.\n';
    }
  }

  // 1. Consecutive non-productive actions from end of history
  // (3.13.0) URL-aware loop detection -- catches "agent did 7 navigates
  // to 7 different pages, none extracted anything" pattern that the
  // existing exact-action check misses.
  if (!loopDirective) {
    const typeLoop = detectActionTypeLoop(history, agentMemory);
    if (typeLoop.isLoop) {
      loopDirective = `\n⚠ ACTION-TYPE LOOP -- ${typeLoop.count} of last 4 actions were "${typeLoop.type}" with no productive memory write. The current strategy is not yielding data. You MUST switch action types now:\n1. If you have been navigating, STOP -- run execute_js with a key on the current page to extract whatever data is visible. The retry ladder will fall back to body.innerText automatically.\n2. If you have been clicking, try a different selector or use execute_js to read the DOM directly.\n3. If you have been read_page-ing, switch to extract / extract_list with a key.\n4. If extraction has failed twice on this page, finish() with what you have and move on rather than retrying.\n`;
    }
  }

  // Cache memory count for reuse in this section (perf: multiple uses below)
  const memCount = objectLength(agentMemory);

  //    Also check for execute_js-heavy patterns in recent window (model escaping consecutive check)
  if (_histLen >= 3 && !loopDirective) {
    let consecutiveNonProductive = 0;
    for (let i = _histLen - 1; i >= 0; i--) {
      const h = history[i];
      if (h.action && nonProductiveReadActions.has(h.action.type)) {
        consecutiveNonProductive++;
      } else {
        break;
      }
    }
    // Also count execute_js in the last 8 steps — if too many without extract/note/finish, it's a loop
    // Iterate directly over history to avoid array copy (perf)
    const _recentCounts = { js: 0, extract: 0 };
    const last8Start = Math.max(0, _histLen - 8);
    for (let i = last8Start; i < _histLen; i++) {
      const h = history[i];
      if (!h || !h.action) continue;
      const type = h.action.type;
      if (type === 'execute_js') _recentCounts.js++;
      if (dataActions.has(type)) _recentCounts.extract++;
    }
    const recentJsCount = _recentCounts.js;
    const recentExtractCount = _recentCounts.extract;
    const jsLoop = recentJsCount >= 4 && recentExtractCount === 0;

    if (consecutiveNonProductive >= 3 || jsLoop) {
      const reason = jsLoop
        ? `${recentJsCount} execute_js calls in last 8 steps with no data saved`
        : `${consecutiveNonProductive} non-productive steps in a row`;
      loopDirective = memCount === 0
        ? `\n⚠ LOOP DETECTED -- ${reason}. You MUST use "execute_js" with a "key" to save results, or use "note" to record findings. Do NOT run more JS without saving.\n`
        : `\n⚠ LOOP DETECTED -- ${reason}. You have ${memCount} items in memory. You MUST use "finish" NOW with a summary of your extracted data.\n`;
    }
  }

  // 1b. Empty page detection — page didn't render (SPA, anti-bot, loading failure)
  if ((pageIsEmpty || elementsEmpty) && !loopDirective) {
    // Iterate directly over history to avoid array copy (perf)
    const emptyCount = (() => {
      let count = 0;
      const last4Start = Math.max(0, _histLen - 4);
      for (let i = last4Start; i < _histLen; i++) {
        const r = history[i].result || '';
        if (r.includes('empty') || r.includes('no content') || (r.includes('Page Title:') && r.length < 300)) count++;
      }
      return count;
    })();
    if (emptyCount >= 2) {
      loopDirective = '\n⚠ EMPTY PAGE -- The page content has been empty for multiple attempts. This site may block automation or use heavy JavaScript rendering. You MUST try a different approach:\n1. Use "execute_js" with key to extract data directly: return document.body.innerText\n2. Navigate to a simpler URL (e.g., the homepage instead of search results)\n3. Try a different site for the same information\nDo NOT read_page again on this empty page.\n';
    }
  }

  // 2. Step-based soft cap: warn model to finish after 15 steps
  //    But skip the warning if agent is actively making progress (opening tabs, switching tabs)
  let recentTabActions = 0;
  const recentStart = Math.max(0, _histLen - 5);
  for (let i = recentStart; i < _histLen; i++) {
    const h = history[i];
    if (h.action && tabActions.has(h.action.type)) recentTabActions++;
  }
  const isMakingProgress = recentTabActions > 0 || memCount > 0;
  if (stepCount >= 15 && !loopDirective && !isMakingProgress) {
    loopDirective = `\n⚠ STEP LIMIT -- You are on step ${stepCount} with no data extracted and no active tab work. You MUST call "finish" NOW with what you know, or use "execute_js" to extract data. Do not continue reading the same page.\n`;
  } else if (stepCount >= 20 && !loopDirective) {
    loopDirective = memCount > 0
      ? `\n⚠ STEP LIMIT -- You are on step ${stepCount}. You have ${memCount} extracted items. You MUST call "finish" NOW with a summary. No more reading or extracting.\n`
      : `\n⚠ STEP LIMIT -- You are on step ${stepCount}. If you have not found useful data, call "finish" with what you know. Do not continue looping.\n`;
  }

  return loopDirective;
}

/**
 * Escalate the circuit-breaker verdict with the two overrides the loop applied
 * on top of `checkCircuitBreaker()`. Mutates and returns `cbResult`, exactly as
 * the inline code did.
 *
 *   - 5+ recent API failures ⇒ hard stop (likely model/provider incompatibility)
 *   - the previous result complaining about image input ⇒ hard stop (the model
 *     has no vision support, so every subsequent step would fail identically)
 *
 * @param {object} cbResult result from checkCircuitBreaker()
 * @param {Array}  history
 * @returns {object} the same cbResult object
 */
export function escalateCircuitBreaker(cbResult, history) {
  // (v21.6.1) Track consecutive LLM failures for early-stop
  const _recentFailures = history.slice(-6).filter(h => h.result && typeof h.result === 'string' && (h.result.includes('API Error') || h.result.includes('non-ok response'))).length;
  if (_recentFailures >= 5 && !cbResult.shouldHardStop) {
    cbResult.shouldHardStop = true;
    cbResult.reason = `3 consecutive LLM failures — likely model/provider incompatibility. Check model supports vision.`;
    cbResult.severity = 'critical';
  }
  // (v21.6.1) Vision 404 detection — model doesn't support image input
  const _lastEntry = history[history.length - 1];
  const _lastErr = _lastEntry && _lastEntry.result ? String(_lastEntry.result) : '';
  if (_lastErr.includes('No endpoints found that support image input') || _lastErr.includes('support image input')) {
    cbResult.shouldHardStop = true;
    cbResult.reason = 'Model does not support vision (image input). Switch to a vision-capable model in Settings or Quick Switcher.';
    cbResult.severity = 'critical';
  }
  return cbResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// THINK — prompt construction and vision action mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the capped, screenshot-stripped history window handed to the LLM.
 *
 * Past entries carry base64 screenshots, 5KB of typed text and JS source that
 * would otherwise be re-sent every step; only the most recent observation needs
 * the image (passed separately as base64Image).
 *
 * @param {Array} history
 * @param {number} historyWindow CONFIG.historyWindow
 * @returns {Array} a new array of cleaned entries
 */
export function buildPromptHistory(history, historyWindow) {
  const promptHistory = [];
  const _histLen = history.length;
  const historyStart = Math.max(0, _histLen - historyWindow);
  for (let i = historyStart; i < _histLen; i++) {
    const h = history[i];
    if (!h || typeof h !== 'object' || h === null) {
      promptHistory.push(h);
      continue;
    }
    const cleaned = { ...h };
    // Strip screenshots (large) from past entries — only the most recent
    // observation needs the image (passed separately as base64Image).
    delete cleaned.base64Image;
    delete cleaned.screenshot;
    if (cleaned.action && typeof cleaned.action === 'object' && cleaned.action !== null) {
      const a = { ...cleaned.action };
      delete a.base64Image;
      delete a.screenshot;
      // (3.20.0) Cap action.text and action.code in past history to
      // prevent the prompt from carrying 5KB of typed text or JS source
      // forever. The current step's command is passed fresh; past
      // versions only need a hint of what happened.
      if (typeof a.text === 'string' && a.text.length > 200) a.text = `${a.text.slice(0, 200)}…`;
      if (typeof a.code === 'string' && a.code.length > 300) a.code = `${a.code.slice(0, 300)}…`;
      cleaned.action = a;
    }
    // (3.20.0) Cap result field — 800 chars is plenty for the LLM to
    // remember "what came back". Article bodies, log dumps, and other
    // large outputs would otherwise bloat every subsequent step's
    // prompt by thousands of tokens.
    if (typeof cleaned.result === 'string' && cleaned.result.length > 800) {
      cleaned.result = `${cleaned.result.slice(0, 800)}… [truncated; ${cleaned.result.length - 800} more chars in memory]`;
    }
    promptHistory.push(cleaned);
  }
  return promptHistory;
}

/**
 * Build the corrective hint shown when the vision model picks an [index] that
 * isn't on the page.
 *
 * We deliberately do NOT auto-click a numeric neighbour: the index is DOM-scan
 * order, not visual proximity, so [N±1] is often an unrelated (sometimes
 * destructive) control. Instead we hand the model the real valid range.
 */
export function buildBadIndexHint(visionElementMap, want) {
  const _keys = visionElementMap
    ? Array.from(visionElementMap.keys()).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b)
    : [];
  if (!_keys.length) return 'No numbered elements are currently visible — scroll or re-observe to reveal them.';
  const _lead = want > 0 ? `[${want}] is not on this page.` : 'No index was given.';
  return `${_lead} Valid indices on this page: ${_keys[0]}–${_keys[_keys.length - 1]} (${_keys.length} elements). Re-read the green labels / Elements list and pick a number that actually exists.`;
}

/**
 * Translate a parsed vision action into a legacy command object.
 *
 * GLM-4V frequently hallucinates an [index] that isn't on the page, or omits it
 * entirely. Only an index present in the current vision element map is accepted;
 * anything else falls through to a corrective note or an auto-extract, so a dead
 * no-op click_at never burns a step.
 *
 * @param {object} parsed        parseVisionResponse() output (must have .action)
 * @param {Map|null} visionElementMap
 * @param {{now?: Function}} [deps] injection seam for the execute_js fallback key
 * @returns {object|null} the command, or null when `parsed` carries no action
 */
export function mapVisionAction(parsed, visionElementMap, deps = {}) {
  if (!parsed || !parsed.action) return null;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const _va = parsed.action;
  let command;

  // (v20.4) Resolve + validate the element index.
  const _rawIdx = (typeof _va.index === 'number') ? _va.index
    : (typeof _va.index === 'string' && /^\d+$/.test(_va.index.trim())) ? Number(_va.index)
      : NaN;
  const _validIdx = (Number.isInteger(_rawIdx) && _rawIdx > 0
    && visionElementMap && visionElementMap.has(_rawIdx)) ? _rawIdx : null;
  const _badIndexHint = (want) => buildBadIndexHint(visionElementMap, want);

  // Map vision action types to legacy command format
  // v21.6.73: Convert click_at to click — GLM sometimes sends click_at directly
  if (_va.type === 'click_at') _va.type = 'click';
  switch (_va.type) {
    case 'click':
      if (_validIdx) {
        command = { type: 'click_at', _visionIndex: _validIdx, _visionAction: true };
      } else {
        // v21.6.74: No valid index — auto-extract page content instead of looping
        command = { type: 'execute_js', code: 'return document.body.innerText.substring(0, 16000)', key: 'page_content', _visionAction: true, approvalGranted: true };
        console.info('[Sentinel/v4] Click with no valid index → auto-extracting page content');
      }
      break;
    case 'input':
      command = _validIdx
        ? { type: 'type', text: _va.text || '', _visionIndex: _validIdx, _visionAction: true }
        : { type: 'note', text: `SYSTEM: input needs a valid [index] for the field. ${_badIndexHint(_rawIdx)} Then emit {"action":{"type":"input","index":N,"text":"…"}}.`, _visionAction: true };
      break;
    case 'scroll':
      command = { type: 'scroll', direction: _va.direction || 'down', _visionAction: true };
      break;
    case 'navigate':
      command = { type: 'navigate', url: _va.url, _visionAction: true };
      break;
    case 'go_back':
      command = { type: 'navigate_back', _visionAction: true };
      break;
    case 'extract':
      command = { type: 'execute_js', code: _va.code || 'return document.body.innerText.substring(0, 20000)', key: _va.key || 'page_content', _visionAction: true, approvalGranted: true };
      break;
    case 'execute_js':
      command = { type: 'execute_js', code: _va.code || '', key: _va.key || 'js_result_' + now(), _visionAction: true, approvalGranted: true };
      break;
    case 'done':
      command = { type: 'finish', summary: _va.text || parsed.memory || 'Task complete', _visionAction: true };
      break;
    default:
      command = { type: 'note', text: `Vision: unknown action ${_va.type}`, _visionAction: true };
  }
  return command;
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPATCH — finish-time memory cleanup
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Drop failed/timed-out/empty entries before the finish summary counts them as
 * "data points collected". Saving these is worse than reporting nothing.
 *
 * @param {object} agentMemory
 * @param {string[]} memKeys keys to consider, in order
 * @returns {object} a new object containing only the usable entries
 */
export function cleanFinishMemory(agentMemory, memKeys) {
  const cleanMemory = {};
  for (const k of memKeys) {
    const v = agentMemory[k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    // Skip empty, failed, timed-out, or "Done" entries
    if (!s || s === 'Done' || s.length < 5) continue;
    if (s.startsWith('Execution error') || s.startsWith('Code execution timed out')) continue;
    if (s.startsWith('JS Error:') || s.startsWith('Element not found')) continue;
    cleanMemory[k] = v;
  }
  return cleanMemory;
}
