// Sentinel Override v3 -- Agent Engine
// Agent loop, planning, self-healing, state management.
// Imports from llm-client.js, tab-manager.js, message-protocol.js.

import { callLLMWithRetry, generatePlan, getPlatformContext, getRelevantPatterns } from './llm-client.js';
import { getPlatformProfile } from './platforms/index.js';
import { waitForPageLoad, waitForPageReady, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl, getTabInfo, detachAllDebuggees, cdpDispatchClick, cdpDispatchType, cdpDispatchKey, cdpExecuteJs, readConsoleMessages, readNetworkRequests } from './tab-manager.js';
import { MAX_PAGE_TEXT_LENGTH, API_CACHE_TTL_MS, BATCH_MODE_CACHE_TTL_MS, MAX_WAIT_TIME_MS } from './constants.js';

// v4.0 VISION-FIRST MODULES
const VISION_DISCOVER = "const __sentinel_discoverElements = function() {\n  'use strict';\n\n  // ---- Selector for all interactive element types ----\n  var SELECTOR = 'a, button, input, select, textarea, [role=\"button\"], [role=\"link\"], '\n    + '[role=\"textbox\"], [role=\"combobox\"], [role=\"checkbox\"], [role=\"radio\"], '\n    + '[role=\"tab\"], [role=\"menuitem\"], [role=\"switch\"], [role=\"option\"], '\n    + '[onclick], [contenteditable]:not([contenteditable=\"false\"]), '\n    + '[tabindex]:not([tabindex=\"-1\"]), [aria-label], summary, [data-testid], label[for]';\n\n  // ---- Tags whose subtrees should be completely skipped ----\n  var SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);\n\n  function isInSkippedParent(el) {\n    var node = el;\n    while (node) {\n      if (SKIP_TAGS.has(node.tagName)) return true;\n      node = node.parentElement;\n    }\n    return false;\n  }\n\n  // ---- Computed-style checks ----\n  function isHiddenByStyle(el) {\n    var s = window.getComputedStyle(el);\n    if (s.opacity === '0') return true;\n    if (s.visibility === 'hidden') return true;\n    if (s.display === 'none') return true;\n    if (s.pointerEvents === 'none') return true;\n    return false;\n  }\n\n  // ---- Visibility helpers ----\n  function isRectVisible(rect) {\n    if (!rect) return false;\n    if (rect.width <= 0 || rect.height <= 0) return false;\n    return true;\n  }\n\n  function isOnScreen(rect) {\n    // Allow elements that are at least partially within the viewport\n    if (rect.right <= 0 || rect.bottom <= 0) return false;\n    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;\n    return true;\n  }\n\n  // ---- Overlap / dedup helpers ----\n  function intersectionArea(r1, r2) {\n    var x1 = Math.max(r1.x, r2.x);\n    var y1 = Math.max(r1.y, r2.y);\n    var x2 = Math.min(r1.x + r1.w, r2.x + r2.w);\n    var y2 = Math.min(r1.y + r1.h, r2.y + r2.h);\n    if (x2 <= x1 || y2 <= y1) return 0;\n    return (x2 - x1) * (y2 - y1);\n  }\n\n  function overlapRatio(r1, r2) {\n    var area1 = r1.w * r1.h;\n    var area2 = r2.w * r2.h;\n    if (area1 === 0 || area2 === 0) return 0;\n    var inter = intersectionArea(r1, r2);\n    // Use the smaller area as denominator so parent/child overlap is detected\n    var minArea = Math.min(area1, area2);\n    return inter / minArea;\n  }\n\n  // ---- Extract display text ----\n  function getText(el) {\n    var t = '';\n    if (el.innerText) t = el.innerText;\n    else if (el.value) t = el.value;\n    else if (el.placeholder) t = el.placeholder;\n    else if (el.getAttribute && el.getAttribute('aria-label')) t = el.getAttribute('aria-label');\n    else if (el.getAttribute && el.getAttribute('title')) t = el.getAttribute('title');\n    return (t || '').replace(/[\\\\s\\\\n]+/g, ' ').trim().substring(0, 60);\n  }\n\n  // ---- Main ----\n  var candidates = document.querySelectorAll(SELECTOR);\n  var elements = [];\n  var i, el, rect, cs;\n\n  for (i = 0; i < candidates.length; i++) {\n    el = candidates[i];\n\n    // Skip elements inside script/style/etc.\n    if (isInSkippedParent(el)) continue;\n\n    // Check offsetParent (unless fixed)\n    cs = window.getComputedStyle(el);\n    var isFixed = cs.position === 'fixed';\n    if (!el.offsetParent && !isFixed) continue;\n\n    // Get bounding rect\n    var cRect = el.getBoundingClientRect();\n    if (!isRectVisible(cRect)) continue;\n    if (!isOnScreen(cRect)) continue;\n\n    // Check computed style\n    if (isHiddenByStyle(el)) continue;\n\n    elements.push({ el: el, rect: { x: cRect.left, y: cRect.top, w: cRect.width, h: cRect.height } });\n  }\n\n  // ---- Deduplicate overlapping elements (>80% overlap, keep more specific) ----\n  var removed = new Set();\n  for (i = 0; i < elements.length; i++) {\n    if (removed.has(i)) continue;\n    for (var j = i + 1; j < elements.length; j++) {\n      if (removed.has(j)) continue;\n      var ratio = overlapRatio(elements[i].rect, elements[j].rect);\n      if (ratio > 0.8) {\n        // Keep the one deeper in the DOM (more specific)\n        // j > i means j comes later in DOM order (deeper child usually)\n        // Compare actual DOM depth\n        var depthI = 0, depthJ = 0, n;\n        n = elements[i].el; while (n.parentElement) { depthI++; n = n.parentElement; }\n        n = elements[j].el; while (n.parentElement) { depthJ++; n = n.parentElement; }\n        if (depthJ >= depthI) {\n          removed.add(i);\n        } else {\n          removed.add(j);\n        }\n      }\n    }\n  }\n\n  var filtered = [];\n  for (i = 0; i < elements.length; i++) {\n    if (!removed.has(i)) filtered.push(elements[i]);\n  }\n\n  // ---- Cap at 150 ----\n  if (filtered.length > 150) filtered = filtered.slice(0, 150);\n\n  // ---- Build output and store references ----\n  window.__sentinelElements = new Map();\n  var result = [];\n\n  for (i = 0; i < filtered.length; i++) {\n    var index = i + 1;\n    var e = filtered[i].el;\n    var r = filtered[i].rect;\n\n    window.__sentinelElements.set(index, e);\n    try { e.setAttribute('data-sentinel-index', String(index)); } catch(_ae) {}\n\n    var tag = e.tagName.toLowerCase();\n    var text = getText(e);\n    var ariaLabel = e.getAttribute && e.getAttribute('aria-label') || '';\n    var role = e.getAttribute && e.getAttribute('role') || '';\n    var type = e.getAttribute && e.getAttribute('type') || '';\n    var placeholder = e.getAttribute && e.getAttribute('placeholder') || '';\n    var href = (e.getAttribute && e.getAttribute('href') || '').substring(0, 100);\n\n    // Determine interactivity\n    var clickableTags = new Set(['a', 'button', 'summary']);\n    var clickableRoles = new Set(['button', 'link', 'tab', 'menuitem', 'switch', 'option', 'checkbox', 'radio']);\n    var isClickable = clickableTags.has(tag)\n      || clickableRoles.has(role)\n      || e.hasAttribute && e.hasAttribute('onclick')\n      || tag === 'input' && (type === 'submit' || type === 'button' || type === 'image' || type === 'reset');\n    var isInput = tag === 'input' || tag === 'textarea' || tag === 'select'\n      || role === 'textbox' || role === 'combobox'\n      || (e.hasAttribute && e.hasAttribute('contenteditable'));\n\n    result.push({\n      index: index,\n      tag: tag,\n      text: text,\n      ariaLabel: ariaLabel,\n      role: role,\n      type: type,\n      placeholder: placeholder,\n      href: href,\n      rect: r,\n      isClickable: isClickable,\n      isInput: isInput\n    });\n  }\n\n  return JSON.stringify(result);\n}; return __sentinel_discoverElements();";
const VISION_SOM = "const __sentinel_drawSoMOverlay = function() {\n  'use strict';\n\n  // ---- Remove any existing overlay ----\n  var existing = document.getElementById('sentinel-som-overlay');\n  if (existing) existing.remove();\n\n  // ---- Create canvas ----\n  var canvas = document.createElement('canvas');\n  canvas.id = 'sentinel-som-overlay';\n  canvas.style.position = 'fixed';\n  canvas.style.top = '0';\n  canvas.style.left = '0';\n  canvas.style.width = window.innerWidth + 'px';\n  canvas.style.height = window.innerHeight + 'px';\n  canvas.style.zIndex = '2147483647';\n  canvas.style.pointerEvents = 'none';\n  canvas.width = window.innerWidth * (window.devicePixelRatio || 1);\n  canvas.height = window.innerHeight * (window.devicePixelRatio || 1);\n  canvas.style.width = window.innerWidth + 'px';\n  canvas.style.height = window.innerHeight + 'px';\n\n  var ctx = canvas.getContext('2d');\n  var dpr = window.devicePixelRatio || 1;\n  ctx.scale(dpr, dpr);\n\n  // ---- Guard ----\n  if (!window.__sentinelElements || typeof window.__sentinelElements.forEach !== 'function') {\n    (document.body || document.documentElement).appendChild(canvas);\n    return 'ok';\n  }\n\n  var vw = window.innerWidth;\n  var vh = window.innerHeight;\n\n  // ---- Draw boxes and labels ----\n  window.__sentinelElements.forEach(function(el, idx) {\n    if (!el || !el.getBoundingClientRect) return;\n\n    var cRect = el.getBoundingClientRect();\n    var x = cRect.left;\n    var y = cRect.top;\n    var w = cRect.width;\n    var h = cRect.height;\n\n    // Skip zero-size\n    if (w <= 0 || h <= 0) return;\n\n    // Draw bounding box\n    ctx.strokeStyle = '#00ff88';\n    ctx.lineWidth = 2;\n    ctx.strokeRect(x, y, w, h);\n\n    // ---- Label dimensions ----\n    var lw = 24;\n    var lh = 18;\n    var lx = x;\n    var ly = y - lh;\n\n    // If label would go above the viewport, move it inside the box\n    if (ly < 0) {\n      ly = y;\n    }\n    // If label would go off the left edge, nudge right\n    if (lx < 0) {\n      lx = 0;\n    }\n    // If label would go off the right edge, nudge left\n    if (lx + lw > vw) {\n      lx = vw - lw;\n    }\n\n    // Draw label background\n    ctx.fillStyle = '#00ff88';\n    ctx.fillRect(lx, ly, lw, lh);\n\n    // Draw label text\n    ctx.fillStyle = '#000000';\n    ctx.font = 'bold 12px monospace';\n    ctx.textAlign = 'center';\n    ctx.textBaseline = 'middle';\n    ctx.fillText(String(idx), lx + lw / 2, ly + lh / 2);\n  });\n\n  (document.body || document.documentElement).appendChild(canvas);\n  return 'ok';\n}; __sentinel_drawSoMOverlay();";
const VISION_CLEAR = "const __sentinel_clearSoMOverlay = function() {\n  'use strict';\n  var overlay = document.getElementById('sentinel-som-overlay');\n  if (overlay) overlay.remove();\n  var _tagged = document.querySelectorAll('[data-sentinel-index]');\n  for (var _ti = 0; _ti < _tagged.length; _ti++) { try { _tagged[_ti].removeAttribute('data-sentinel-index'); } catch(_ae) {} }\n  return 'ok';\n}; __sentinel_clearSoMOverlay();";

// Precompute valid agent speed modes for O(1) lookup
const VALID_AGENT_SPEEDS = new Set(['turbo', 'normal', 'stealth']);

// Precompile regex for extracting JSON from markdown code blocks
const CODE_BLOCK_REGEX = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;

// Priority element types for O(1) lookup in element sorting
const PRIORITY_ELEMENT_TYPES = new Set(['button', 'input', 'select', 'textarea']);

// ═══════════════════════════════════════════════════════════════
// v4.0 Vision Observe — discovers elements, draws SoM, returns indexed list
// ═══════════════════════════════════════════════════════════════
async function _visionObserve(tab, _currentUrl) {
  try {
    // Step 1: Discover interactive elements via CDP
    const discoverResult = await cdpExecuteJs(tab, VISION_DISCOVER, { timeout: 8000 });
    let indexedElements = [];
    if (discoverResult && discoverResult.ok && discoverResult.value) {
      try {
        const parsed = typeof discoverResult.value === 'string'
          ? JSON.parse(discoverResult.value) : discoverResult.value;
        indexedElements = Array.isArray(parsed) ? parsed : [];
      } catch (e) { console.warn('[Sentinel/v4] Element parse error:', getErrorMessage(e)); }
    }
    console.log(`[Sentinel/v4] Discovered ${indexedElements.length} interactive elements`);

    // Step 2: Draw SoM overlay (numbered bounding boxes on canvas)
    try { await cdpExecuteJs(tab, VISION_SOM, { timeout: 5000 }); }
    catch (e) { console.warn('[Sentinel/v4] SoM overlay failed:', getErrorMessage(e)); }

    // Step 3: Small delay for canvas to render
    await new Promise(r => setTimeout(r, 200));

    // Step 4: Get page text via CDP
    let pageText = '';
    try {
      const textResult = await cdpExecuteJs(tab,
        `return document.body ? document.body.innerText.substring(0, ${MAX_PAGE_TEXT_LENGTH}) : "";`,
        { timeout: 5000 });
      pageText = (textResult && textResult.value) || '';
    } catch (e) { console.warn('[Sentinel/v4] Page text failed:', getErrorMessage(e)); }

    // Step 5: Build element tree text for LLM
    const elementParts = [];
    for (const el of indexedElements) {
      const tag = el.tag || 'div';
      // Template literal is more efficient than += concatenation in loop
      const attrs = `${el.type ? ` type=${el.type}` : ''}${el.role ? ` role=${el.role}` : ''}${el.ariaLabel ? ` aria-label=${JSON.stringify((el.ariaLabel || '').substring(0, 40))}` : ''}${el.placeholder ? ` placeholder=${JSON.stringify((el.placeholder || '').substring(0, 40))}` : ''}${el.href && el.href.length > 5 && el.href.length < 100 ? ` href=${JSON.stringify(el.href.substring(0, 80))}` : ''}`;
      const text = el.text ? `>${(el.text || '').substring(0, 60)}` : '/>';
      const closing = el.text ? `</${tag}>` : '';
      elementParts.push(`[${el.index}]<${tag}${attrs}${text}${closing}\n`);
    }
    const elementTree = elementParts.join('');

    return {
      elements: Array.isArray(indexedElements) ? indexedElements : [],
      elementTree: typeof elementTree === 'string' ? elementTree : '',
      pageText: typeof pageText === 'string' ? pageText : ''
    };
  } catch (e) {
    console.error('[Sentinel/v4] Vision observe error:', getErrorMessage(e));
    return { elements: [], elementTree: '', pageText: '' };
  }
}


import { sendSilentUpdate, sendActionMessage, sendActionResult, sendReportUpdate, sendPageContext, sendTabStateUpdate, sendScreenshotUpdate, sendAgentActivity, sendAgentStepStart, sendAgentStatus, sendHeartbeat, sendPlanPreview, sendClientKnowledgePreview, sendCostUpdate } from './message-protocol.js';
import { generateReport, buildFallbackReport } from './report-generator.js';
import { getActiveProvider, migrateLegacySettings } from './provider-registry.js';
import { isSPATransitionPending, clearSPATransition, notifyIfEnabled, startSwKeepalive, stopSwKeepalive } from './shared-state.js';
import { getActiveTabId, getTabContext, getAllTabContexts, openTab, switchToTab, closeTab, closeAllAgentTabs, updateSnapshot, resetAllContexts, findTabByLabel, registerInitialTab, getTabCount } from './tab-context.js';
import { getActiveClient, getRelevantEntries, formatPromptSection, markRunCompleted } from './client-knowledge.js';
import { rewriteGoalForPlatform } from './adaptive-prompts.js';
import { appendAuditEntry, getAuditLog, auditLogToCsv } from './audit-log.js';
import { runRecoverySkills } from './skills/index.js';
import { tel, startRun as telStartRun, endRun as telEndRun } from './telemetry.js';
// (3.30.0) Trust-score computation at run finalize. Pure function — no side
// effects, no chrome.* deps. We aggregate the run's metrics here at the end
// of the loop and stamp the result onto both the report card and the
// run-log index entry.
import { computeTrustScore, suggestRetryActions } from './trust-score.js';
import { getSkillStats } from './skills/index.js';
import { getErrorMessage, sleep } from './error-utils.js';

// ========== Agent State ==========
let agentRunning = false;
let apiCallCount = 0;
let lastApiCallTime = 0;
let agentMemory = {};           // Extract-and-remember: carries data between pages
let history = [];               // (3.15.1) Per-run action history. MUST be module-level so the trimHistory()/persistHistory() helpers at module scope can access it. Cleared in-place at start of each runAgentLoop via history.length = 0 (preserves the array reference for any captured closures).
let _lastAiCallMs = null;       // (3.21.0) Duration of the most recent LLM call in ms; consumed by the slow-llm-call recovery skill.
let consecutiveFailures = 0;    // Self-healing: tracks failures for strategy shift
let currentStrategies = [];     // Self-healing: remembers tried approaches
let agentPlan = null;           // Planning phase: numbered list of steps
let currentPlanStep = 0;        // Planning phase: which step we're currently on
let agentSpeed = 'turbo';       // Speed mode: 'turbo' (0.05x), 'fast' (0.3x), 'normal' (1x), 'stealth' (2x)
let agentPaused = false;        // Pause/resume: agent loop waits when true
let _historyDirty = false;      // (3.41.0) Dirty-bit: true when history has changed since last persist
let _runSettings = {};          // (3.41.0) Run-stable settings cache: loaded once at runAgentLoop start
let mfaAckUrl = null;           // (3.7.0) URL where the user last acknowledged MFA — prevents re-pausing on the same challenge
let signInWallAckUrls = new Set(); // (3.14.1) URLs where the user has acknowledged a sign-in wall this run — prevents re-pausing after manual sign-in
let detectedTenant = null;      // (3.7.0) {tid, onmicrosoft, chipText, hostname} most recently detected on a Microsoft admin URL
let runLogId = null;            // (3.9.0) per-run UUID; keys runLog entries in storage
let runLogBuffer = [];          // (3.9.0) in-memory log buffer flushed to storage every step
const _stepScreenshots = new Map(); // (9.3) step# → base64Image; ring-capped at 20 entries for replay export
let agentTabGroupId = null;     // (3.7.2) chrome.tabGroups id grouping every attached tab — visual "glow" in the tab bar
let productiveSteps = 0;        // (3.8.0) dynamic step-limit driver — every successful extract/note/finish-blocker bumps this so productive runs get more oxygen
// (3.30.0) Trust-score counters. Module-level so the loop can update them
// from any branch and the run finalize block can read them at the end.
let failedSteps = 0;            // running count of steps where actionFailed=true
let consecutiveFailureMax = 0;  // longest streak of consecutive failures seen this run
let _pageStagnation = 0;      // (3.46.1) Counts consecutive non-mutating clicks on same page state — detects click-spam loops
const agentAttachedTabs = new Set(); // (3.7.2) tabIds currently in the Sentinel group; used by the side-panel visibility hook
let expectedTenant = null;      // (3.7.0) chrome.storage.local.expectedTenant — the user's intended tenant for this run
let activeClientId = null;      // (3.12.0) currently-selected client (sentinelClientKnowledge.activeClientId)
let clientKnowledgeText = '';   // (3.12.0) pre-formatted system-prompt section listing relevant entries
let clientKnowledgeUsedIds = []; // (3.12.0) ids of entries injected into this run; useCount bumps at run end
let pendingVerification = null; // (3.12.0) {type,description,attemptedAt} of the last MODIFYING_ACTIONS step; consumed by next observation cycle to force explicit "did this work?" check
let _pendingContextInjections = []; // Mid-run context notes queued by the user; drained at top of each step
let _pendingCommandQueue = [];      // repeat_for_each sub-commands; drained before consulting LLM
let undoStack = [];                 // (3.49.1) Undo entries for reversible actions; max 10 entries

// Expose agentRunning for index.js
export { agentRunning };

/** Enqueue a user note to be injected into the LLM prompt on the next step. */
export function injectContext(note) {
  if (typeof note === 'string' && note.trim()) {
    _pendingContextInjections.push(note.trim());
  }
}

/** Compatibility accessor -- returns the current active tab ID from tab-context. */
export function getAgentTabId() { return getActiveTabId(); }

// ========== Tab URL Change Tracking (#29) ==========
// React to user-driven (or page-driven) URL changes inside tracked tabs:
// keep the tracked TabContext.url current and invalidate stale screenshot caches.
try {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo /*, tab */) => {
      if (!changeInfo || !changeInfo.url) return;
      const ctx = getTabContext(tabId);
      if (!ctx) return;
      ctx.url = changeInfo.url;
      // Invalidate screenshot cache — page changed, old image is stale.
      if (ctx.screenshotCache) {
        ctx.screenshotCache.cachedSnapshot = null;
        ctx.screenshotCache.cachedBase64Image = null;
        ctx.screenshotCache.lastScreenshotUrl = null;
      }
    });
  }
} catch (_checkpointErr) {
  /* Non-fatal: chrome API may be unavailable in some contexts */
}

// ========== Service Worker Persistence Checkpoint (#16, lite → full) ==========
// Module-level snapshot of the most recent loop state so onSuspend can flush it.
// Supports full state resume: history, agentMemory, runSettings, tab contexts
// are all persisted and restored when the SW restarts after an interruption.
let _lastCheckpoint = null;
let _lastGoal = '';

function buildCheckpoint(stepCount) {
  return {
    agentRunning,
    currentTabId: getActiveTabId(),
    stepCount,
    lastGoal: _lastGoal,
    agentMemorySnapshot: { ...agentMemory },
    lastUpdate: Date.now(),
    // Full resume fields — allow the agent to pick up exactly where it left off
    historySnapshot: history.map(h => ({ ...h })),
    productiveSteps,
    consecutiveFailures,
    apiCallCount,
    runLogId,
    agentSpeed,
    expectedTenant,
    activeClientId,
    runSettingsSnapshot: { ..._runSettings },
    trustCounters: { failedSteps, consecutiveFailureMax },
    agentPlan: Array.isArray(agentPlan) ? agentPlan.slice() : null,
    currentPlanStep,
    // Tab context URLs for re-registration after SW restart
    tabContextUrls: Object.fromEntries(
      (getAllTabContexts() || []).map(tc => [tc.tabId, tc.url || ''])
    ),
  };
}

async function writeCheckpoint(stepCount) {
  try {
    _lastCheckpoint = buildCheckpoint(stepCount);
    if (chrome.storage && chrome.storage.session && chrome.storage.session.set) {
      await chrome.storage.session.set({ agent_checkpoint: _lastCheckpoint });
    }
  } catch (_writeErr) {
    /* Non-fatal: checkpoint write failed, but agent loop continues */
  }
}

/**
 * Restore agent state from a service worker checkpoint after SW restart.
 * Recovers history, memory, tab contexts, and step count to continue runs.
 * @returns {Promise<object>} { restored: true, goal, stepCount } on success, { restored: false, error } otherwise.
 */
export async function restoreFromCheckpoint() {
  try {
    if (!chrome.storage || !chrome.storage.session || !chrome.storage.session.get) {
      return { restored: false, error: 'session storage unavailable' };
    }
    const stored = await chrome.storage.session.get('agent_checkpoint');
    const cp = stored && stored.agent_checkpoint;
    if (!cp) return { restored: false, error: 'no checkpoint' };
    const age = Date.now() - (cp.lastUpdate || 0);
    if (age > 60 * 60 * 1000) return { restored: false, error: `checkpoint too old (>${Math.floor(age / 60000)} min)` };
    if (!cp.lastGoal) return { restored: false, error: 'no goal in checkpoint' };

    // Restore in-memory state
    if (cp.agentMemorySnapshot && typeof cp.agentMemorySnapshot === 'object') {
      agentMemory = { ...agentMemory, ...cp.agentMemorySnapshot };
    }
    if (Array.isArray(cp.historySnapshot)) {
      history.length = 0;
      history.push(...cp.historySnapshot.filter(h => h));
    }
    if (typeof cp.productiveSteps === 'number') productiveSteps = cp.productiveSteps;
    if (typeof cp.consecutiveFailures === 'number') consecutiveFailures = cp.consecutiveFailures;
    if (typeof cp.apiCallCount === 'number') apiCallCount = cp.apiCallCount;
    if (cp.runLogId) runLogId = cp.runLogId;
    if (cp.agentSpeed && VALID_AGENT_SPEEDS.has(cp.agentSpeed)) agentSpeed = cp.agentSpeed;
    if (cp.expectedTenant) expectedTenant = cp.expectedTenant;
    if (cp.activeClientId) activeClientId = cp.activeClientId;
    if (cp.runSettingsSnapshot && typeof cp.runSettingsSnapshot === 'object') {
      _runSettings = { ...cp.runSettingsSnapshot, ..._runSettings };
    }
    if (cp.trustCounters && typeof cp.trustCounters === 'object') {
      if (typeof cp.trustCounters.failedSteps === 'number') failedSteps = cp.trustCounters.failedSteps;
      if (typeof cp.trustCounters.consecutiveFailureMax === 'number') consecutiveFailureMax = cp.trustCounters.consecutiveFailureMax;
    }
    if (Array.isArray(cp.agentPlan)) agentPlan = cp.agentPlan.slice();
    if (typeof cp.currentPlanStep === 'number') currentPlanStep = cp.currentPlanStep;

    // Re-register tab contexts from URLs. After SW restart we don't have the
    // full context objects, just URLs, but that's enough for the tab manager
    // to re-initialize when the agent re-opens tabs.
    if (cp.tabContextUrls && typeof cp.tabContextUrls === 'object') {
      for (const [tabIdStr, url] of Object.entries(cp.tabContextUrls)) {
        const tabId = parseInt(tabIdStr, 10);
        if (typeof tabId !== 'number' || isNaN(tabId) || tabId <= 0) {
          console.warn('[Sentinel] Invalid tabId in checkpoint:', tabIdStr);
          continue;
        }
        if (typeof url === 'string') {
          try { registerInitialTab(tabId, url); } catch (e) { console.error('[Sentinel] Initial tab registration failed:', getErrorMessage(e)); }
        }
      }
    }

    _lastGoal = cp.lastGoal;

    // Persist restored history to chrome.storage.local so it survives across
    // the boundary. The run loop reads it from there on the first step.
    try { await persistHistory(); } catch (e) { console.error('[Sentinel] History persistence failed:', getErrorMessage(e)); }

    return {
      restored: true,
      goal: cp.lastGoal,
      stepCount: cp.stepCount || 0,
      ageSeconds: Math.floor(age / 1000),
      historyLength: history.length,
      memoryKeys: Object.keys(agentMemory || {})
    };
  } catch (e) {
    return { restored: false, error: getErrorMessage(e) };
  }
}

/**
 * Clear the persisted service-worker checkpoint from chrome.storage.session.
 * Call after a run completes successfully or when discarding stale state.
 * @returns {Promise<void>}
 */
export async function clearCheckpoint() {
  try {
    if (chrome.storage && chrome.storage.session && chrome.storage.session.remove) {
      await chrome.storage.session.remove('agent_checkpoint');
    }
    _lastCheckpoint = null;
  } catch (_e) { /* non-fatal */ }
}

try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
    chrome.runtime.onSuspend.addListener(() => {
      // Synchronous-ish flush. chrome.storage.session.set returns a promise but
      // onSuspend gives us a brief window; we fire-and-forget with the latest snapshot.
      try {
        const snap = _lastCheckpoint || buildCheckpoint(0);
        if (chrome.storage && chrome.storage.session && chrome.storage.session.set) {
          chrome.storage.session.set({ agent_checkpoint: snap });
        }
      } catch (_) { /* non-fatal */ }
    });
  }
} catch (_) { /* non-fatal */ }

// ========== Run Log Index Helper (3.14.0) ==========
// Maintains an ordered list of recent runIds so the popup can browse and
// re-export past logs even if the user dismissed the post-run banner. Cap is
// soft (~20) — older entries get their detail records evicted from storage
// to prevent unbounded growth.
const RUN_LOG_INDEX_MAX = 20;
const RUN_LOG_INDEX_KEY = 'run_log_index';

async function _updateRunLogIndex(runLogId, fields) {
  if (!runLogId) return;
  try {
    const stored = await chrome.storage.local.get(RUN_LOG_INDEX_KEY);
    const list = Array.isArray(stored[RUN_LOG_INDEX_KEY]) ? stored[RUN_LOG_INDEX_KEY].slice() : [];
    const idx = list.findIndex(e => e && e.runLogId === runLogId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...fields, runLogId };
    } else {
      list.unshift({ runLogId, ...fields });
    }
    // Drop overflow and evict detail records for those runs.
    const evict = list.splice(RUN_LOG_INDEX_MAX);
    if (evict.length) {
      // Single-pass optimization: filter and map in one loop
      const evictKeys = [];
      for (const e of evict) {
        if (e && e.runLogId) evictKeys.push(`run_log_${e.runLogId}`);
      }
      try { await chrome.storage.local.remove(evictKeys); } catch (e) { console.error('[Sentinel] History eviction failed:', getErrorMessage(e)); }
    }
    await chrome.storage.local.set({ [RUN_LOG_INDEX_KEY]: list });
  } catch (e) {
    // Storage write failed non-fatally
    console.warn('[Sentinel] Run log index save failed:', getErrorMessage(e));
  }
}

// ========== Activity Phase Tracking (3.16.0) ==========
// Per-step micro-action emitter. Each loop iteration goes through a
// predictable set of phases (observe → consult AI → dispatch → wait → result).
// _activity helpers wrap sendAgentActivity with auto-timing so the popup
// renders a Claude-in-Chrome-style checklist with spinner / checkmark /
// failed states + per-item durations.
//
// State of in-flight items so we can compute duration on completion.
const _activityStartedAt = new Map(); // key: `${stepNumber}:${key}` -> Date.now()

function _activityKey(stepNumber, key) { return `${stepNumber || 0}:${key || 'misc'}`; }

/** Mark a sub-action as in-progress. Auto-records start time for duration calc. */
function activityStart(stepNumber, key, label) {
  try {
    _activityStartedAt.set(_activityKey(stepNumber, key), Date.now());
    sendAgentActivity(stepNumber, key, label, 'in_progress', null);
  } catch (_) { /* never crash the loop on telemetry */ }
}

/** Mark a sub-action as done. Computes duration if start was recorded. */
function activityDone(stepNumber, key, label, detail) {
  try {
    const startedAt = _activityStartedAt.get(_activityKey(stepNumber, key));
    const durationMs = startedAt ? (Date.now() - startedAt) : null;
    _activityStartedAt.delete(_activityKey(stepNumber, key));
    sendAgentActivity(stepNumber, key, label, 'done', { durationMs, ...(detail || {}) });
  } catch (_e) { /* activity tracking non-fatal */ }
}

/** Mark a sub-action as failed. Computes duration if start was recorded. */
function activityFail(stepNumber, key, label, detail) {
  try {
    const startedAt = _activityStartedAt.get(_activityKey(stepNumber, key));
    const durationMs = startedAt ? (Date.now() - startedAt) : null;
    _activityStartedAt.delete(_activityKey(stepNumber, key));
    sendAgentActivity(stepNumber, key, label, 'failed', { durationMs, ...(detail || {}) });
  } catch (_e) { /* activity tracking non-fatal */ }
}

/** Update an in-progress item's label without changing state (e.g., elapsed counter). */
function activityUpdate(stepNumber, key, label) {
  try { sendAgentActivity(stepNumber, key, label, 'in_progress', null); } catch (e) { console.error('[Sentinel] Agent activity send failed:', getErrorMessage(e)); }
}

// ========== Configuration ==========
const CONFIG = {
  minDelayBetweenCalls: 500,
  maxRetries: 2,
  retryDelay: 2000,
  maxRetryDelay: 10000,
  screenshotQuality: 30,
  fetchTimeout: 30000,
  pageLoadTimeout: 25000,
  maxSteps: 100,
  maxPageContentLength: 16000,
  maxElements: 80,
  maxSelectorLength: 200,
  historyWindow: 15,
  screenshotCache: true,
  maxMemoryEntries: 50,
  maxHistoryEntries: 60,
  maxStoredHistory: 40,
  maxLearnedPatterns: 100,
  strategyShiftThreshold: 3,
  stallConfig: {
    similarityWindow: 3,        // Look at last N actions for repeated identical failures
    maxConsecutiveFailures: 5,  // Hard limit: force recovery after this many total failures
    stateRecheckSteps: 4,       // (3.46.1) After N non-mutating clicks, force re-scan (stagnation)
  },
};

// ========== History Helpers ==========
// Deduplicated from ~47 inline occurrences across the agent loop.
function historyPush(entry) {
  history.push(entry);
  _historyDirty = true;
}

function trimHistory() {
  if (history.length > CONFIG.maxHistoryEntries) {
    history.splice(0, history.length - CONFIG.maxHistoryEntries);
  }
}

async function persistHistory() {
  // (3.41.0) Dirty-bit guard: skip the storage write when nothing has
  // changed since the last persist. Eliminates ~30 redundant writes per run
  // on read-only steps (extract, scroll, wait_for_text, note).
  if (!_historyDirty) return;
  trimHistory();
  const slice = history.slice(-CONFIG.maxStoredHistory);
  try {
    await chrome.storage.local.set({ agent_history: slice });
    _historyDirty = false;
  } catch (e) {
    console.warn('[Sentinel] persistHistory storage write failed:', getErrorMessage(e));
  }
  try { tel.trace('storage', `agent_history persisted (${slice.length} entries)`, { entries: slice.length, totalInMemory: history.length }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
}

function captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount) {
  let tabCtxData = [];
  try { tabCtxData = (getAllTabContexts() || []).map(tc => ({ label: tc.label, url: tc.url, hasScreenshot: !!tc.snapshot })); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  return {
    goal,
    history: history.slice(),
    agentMemory: { ...agentMemory },
    agentPlan: agentPlan ? agentPlan.slice() : null,
    stepCount,
    apiCallCount,
    tabContexts: tabCtxData
  };
}

// ========== State Reset ==========

/**
 * Reset all agent run-scoped state to defaults.
 * Called between runs so a fresh start is guaranteed — clears counters,
 * memory, history, plan state, trust-score accumulators, and pending queues.
 */
export function resetAgentState() {
  apiCallCount = 0;
  lastApiCallTime = 0;
  agentMemory = {};
  productiveSteps = 0;
  consecutiveFailures = 0;
  _pageStagnation = 0;
  currentStrategies = [];
  agentPlan = null;
  currentPlanStep = 0;
  mfaAckUrl = null;
  signInWallAckUrls = new Set();
  history.length = 0;   // (3.15.1) clear in-place so module-level helpers keep their reference
  _lastAiCallMs = null; // (3.21.0) reset slow-llm-call skill input
  // (3.30.0) Reset trust-score counters at the same time as the rest of
  // run-scoped state so a re-run starts from a clean slate.
  failedSteps = 0;
  consecutiveFailureMax = 0;
  _pendingContextInjections.length = 0;
  _pendingCommandQueue.length = 0;
  _historyDirty = false;
  undoStack.length = 0;
  _stepScreenshots.clear(); // (9.3) reset replay screenshot ring buffer
  // Reset CDP observe-path optimization flags so a new run always gets a fresh
  // page ready check and overlay nuke on its first observation.
  _pageWasReady = false;
  _lastNukeClean = false;
  resetAllContexts();
}

/**
 * Undo the last reversible agent action.
 * Pops the most recent entry from `undoStack` and reverses it:
 * - navigate: navigates the tab back to the previous URL
 * - type: clears the target field and restores the previous value
 *
 * @returns {Promise<{ success: boolean, description: string }|{ success: boolean, reason: string }>}
 */
export async function undoLastAction() {
  if (!undoStack.length) {
    return { success: false, reason: 'Nothing to undo' };
  }
  const entry = undoStack.pop();
  try {
    chrome.runtime.sendMessage({ action: 'undo_stack_updated', size: undoStack.length }).catch(() => {});
    if (entry.type === 'navigate') {
      const prevUrl = entry.previousUrl;
      if (!prevUrl) {
        // No previous URL — try goBack
        try { await chrome.tabs.goBack(entry.tabId); } catch (_goBackErr) {
          /* Non-fatal: goBack failed during undo */
        }
        return { success: true, description: 'Navigated back (no previous URL recorded)' };
      }
      await chrome.tabs.update(entry.tabId, { url: prevUrl });
      return { success: true, description: `Navigated back to ${prevUrl}` };
    } else if (entry.type === 'type') {
      const selector = entry.selector;
      const prevValue = entry.previousValue || '';
      if (!selector) {
        return { success: false, reason: 'Cannot undo type: no selector recorded' };
      }
      // Cache JSON.stringify calls to avoid redundant serialization (perf)
      const _selJson = JSON.stringify(selector);
      const _valJson = JSON.stringify(prevValue);
      const code = `(function(){const el=document.querySelector(${_selJson});if(!el)return'not found';el.value=${_valJson};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return'ok';})()`;
      try {
        await sendMessageWithRetry(entry.tabId, { action: 'execute_command', command: { type: 'execute_js', code } }, 1);
      } catch (e) {
        return { success: false, reason: `Could not restore field: ${getErrorMessage(e)}` };
      }
      return { success: true, description: `Restored field "${selector}" to previous value` };
    }
    return { success: false, reason: `Unknown undo entry type: ${entry.type}` };
  } catch (e) {
    return { success: false, reason: `Undo failed: ${getErrorMessage(e)}` };
  }
}

/**
 * Test helper: Push an entry to the undo stack.
 * Only exported in test environments to enable comprehensive edge case testing.
 * @param {Object} entry - Undo entry to push
 */
export function pushUndoStack(entry) {
  undoStack.push(entry);
  if (undoStack.length > 10) undoStack.shift();
  chrome.runtime.sendMessage({ action: 'undo_stack_updated', size: undoStack.length }).catch(() => {});
}

// ========== Agent Lifecycle ==========

/**
 * Check for a mode-directive mismatch between the goal text and the stored
 * approvalMode setting.  When a mismatch is detected the function logs to the
 * forensic run log, waits for the user's decision via
 * `_waitForModeMismatchDecision`, logs that decision, and then either cancels
 * the run (returns `{ cancel: true }`) or lets it continue (`{ cancel: false }`).
 *
 * @param {string} goal - The trimmed goal text to scan for mode directives.
 * @param {{ detected: boolean, wants: string, evidence: string, confidence: string }} modeDirective - Pre-parsed directive from `_detectGoalModeDirective`.
 * @param {string|null} runLogId - Current run-log UUID (may be null if log init failed).
 * @param {Array} runLogBuffer - In-memory run-log buffer to append decision entries to.
 * @returns {Promise<{ cancel: boolean }>} Whether the run should be cancelled.
 */
async function _handleModeMismatchCheck(goal, modeDirective, runLogId, runLogBuffer) {
  try {
    const stored = await chrome.storage.local.get(['approvalMode']);
    const actualWants = stored.approvalMode ? 'approval' : 'autonomous';
    if (modeDirective.wants === actualWants) {
      return { cancel: false };
    }

    // Log the mismatch to the forensic run log
    try {
      if (runLogId) {
        runLogBuffer.push({
          step: 0,
          timestamp: new Date().toISOString(),
          kind: 'mode_mismatch_detected',
          goalWants: modeDirective.wants,
          actualMode: actualWants,
          evidence: modeDirective.evidence,
          confidence: modeDirective.confidence
        });
        chrome.storage.local.set({ [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } }).catch((e) => {
          console.error('[_handleModeMismatchCheck] run log set failed:', getErrorMessage(e));
        });
      }
    } catch (_) { /* non-fatal */ }

    const decision = await _waitForModeMismatchDecision({
      goalWants: modeDirective.wants,
      actualMode: actualWants,
      evidence: modeDirective.evidence,
      confidence: modeDirective.confidence
    });

    // Log the decision
    try {
      if (runLogId) {
        runLogBuffer.push({
          step: 0,
          timestamp: new Date().toISOString(),
          kind: 'mode_mismatch_decision',
          decision: decision.flip ? 'flip' : (decision.continue ? 'continue' : 'cancel')
        });
        chrome.storage.local.set({ [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } }).catch((e) => {
          console.error('[_handleModeMismatchCheck] decision log set failed:', getErrorMessage(e));
        });
      }
    } catch (_e) { /* mode directive logging non-fatal */ }

    if (decision.cancel) {
      return { cancel: true };
    }
    // If decision.flip === true, the popup has already written the new
    // approvalMode to storage. The action loop reads storage on every
    // step, so it will pick up the new value automatically.
    return { cancel: false };
  } catch (e) {
    console.warn('[Sentinel] _handleModeMismatchCheck failed (non-fatal):', getErrorMessage(e));
    return { cancel: false };
  }
}

/**
 * Start the agent loop for the given goal on the sender's active tab.
 * @param {string} goal - Natural language instruction for the agent to execute.
 * @param {chrome.runtime.MessageSender} sender - Message sender providing tab context.
 * @returns {Promise<string>} Status message on completion.
 * @throws {Error} If the agent is already running or no active tab is found.
 */
export async function startAgent(goal, sender) {
  if (typeof goal !== 'string' || !goal.trim()) throw new Error('Goal must be a non-empty string');
  goal = goal.trim().substring(0, 4000);
  if (agentRunning) throw new Error('Agent already running');

  // Determine which tab to operate on
  let startTabId;
  if (!sender.tab || !sender.tab.id) {
    const tabs = await new Promise(resolve => {
      chrome.tabs.query({active: true, currentWindow: true}, (t) => {
        if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) {
          console.error('[startAgent] tabs.query failed:', (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError)));
          resolve([]);
        } else {
          resolve(t || []);
        }
      });
    });
    if (Array.isArray(tabs) && tabs[0] != null && tabs[0].id) {
      startTabId = tabs[0].id;
    } else {
      throw new Error('No active tab found');
    }
  } else {
    startTabId = sender.tab.id;
  }

  agentRunning = true;
  // Persist running state so SW restarts can detect an interrupted run
  try { await chrome.storage.session.set({ agentRunning: true, agentGoal: goal, agentStartTime: Date.now() }); } catch(_sessionErr) {
    /* Non-fatal: session storage set failed */
  }
  resetAgentState();
  tel.info('lifecycle', 'Agent started', { goal: (goal || '').substring(0, 200), startTabId });

  // Load speed mode from settings
  try {
    const speedSettings = await chrome.storage.local.get(['agentSpeedMode']);
    const savedSpeed = speedSettings.agentSpeedMode;
    agentSpeed = VALID_AGENT_SPEEDS.has(savedSpeed) ? savedSpeed : 'turbo';
  } catch (_speedErr) {
    /* Non-fatal: speed mode load failed, using turbo */
    agentSpeed = 'turbo';
  }

  // Register the starting tab in the tab context map
  const tabInfo = await getTabInfo(startTabId);
  registerInitialTab(startTabId, tabInfo?.url || '');

  // (3.12.0) Load client knowledge for the active client. Format relevant
  // entries as a prompt section that gets injected into every step's
  // system prompt via agentState.clientKnowledgeText.
  try {
    const activeClient = await getActiveClient();
    if (activeClient && activeClient.id) {
      activeClientId = activeClient.id;
      const startUrl = tabInfo?.url || '';
      const relevantEntries = await getRelevantEntries(activeClient.id, startUrl);
      clientKnowledgeUsedIds = relevantEntries.map(e => e.id);
      clientKnowledgeText = await formatPromptSection(activeClient.id, startUrl);
      // (9.1) Broadcast which facts are being injected so popup can show them
      try { sendClientKnowledgePreview(activeClient.displayName || activeClient.id, relevantEntries); } catch (_previewErr) {
        /* Non-fatal: client knowledge preview send failed */
      }
    } else {
      activeClientId = null;
      clientKnowledgeText = '';
      clientKnowledgeUsedIds = [];
    }
  } catch (_) {
    activeClientId = null;
    clientKnowledgeText = '';
    clientKnowledgeUsedIds = [];
  }

  // (3.9.0) Forensic run log — start a fresh buffer with a UUID. Persisted
  // every step to chrome.storage.local.run_logs[runLogId] for export.
  try {
    runLogId = crypto.randomUUID();
    runLogBuffer = [{
      step: 0,
      timestamp: new Date().toISOString(),
      kind: 'run_start',
      goal: goal,
      tenant: null,
      url: tabInfo?.url || ''
    }];
    // (3.14.0) Track this run in the index so the popup can list it later
    // even if the user dismisses the post-run banner.
    try {
      await _updateRunLogIndex(runLogId, {
        goal: (goal || '').slice(0, 200),
        startedAt: Date.now(),
        completed: false,
        stepCount: 0,
        startUrl: tabInfo?.url || ''
      });
    } catch (_) { /* non-fatal */ }
    // (3.25.1) Storage telemetry: run-log opened. Brackets every run; useful
    // for matching telemetry events to forensic log entries during postmortems.
    try { tel.info('storage', `Run log opened: ${runLogId}`, { runLogId, goalLen: (goal || '').length }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
    // (3.27.0) Tell the telemetry persistence layer this is a new run. If the
    // user has telemetryPersist enabled in settings, events start streaming
    // to chrome.storage.local from this point onward.
    try { telStartRun(runLogId, goal); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  } catch (_) { runLogId = null; runLogBuffer = []; }

  // (3.7.2) Visually attach the working tab to the orange "Sentinel" group.
  // Subsequent open_tab handlers add their tabs to the same group.
  try { await attachTabToSentinelGroup(startTabId); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }

  // (v3.53) Disable side panel on all tabs except the working tab
  // (v3.57) sidePanel scoping removed — was closing panel on start

  // (3.15.2) Mode-directive mismatch check. If the goal text says "Mode:
  // APPROVAL" / "agent pauses for approval" but chrome.storage.local.approvalMode
  // is false (or vice versa), pause for explicit user decision before the
  // run starts. Prevents the "user wrote APPROVAL in the prompt but the
  // toggle was still AUTONOMOUS" disaster scenario on live config changes.
  // Run BEFORE adaptive-prompts so a cancelled run doesn't burn an LLM call.
  const modeDirective = _detectGoalModeDirective(goal);
  if (modeDirective.detected) {
    const mismatchResult = await _handleModeMismatchCheck(goal, modeDirective, runLogId, runLogBuffer);
    if (mismatchResult.cancel) {
      agentRunning = false;
      try { await detachAllSentinelTabs();
    // (v3.53) Re-enable side panel on all tabs now that agent stopped
    try { await _enableSidePanelEverywhere(); } catch (_sidePanelErr) {
      /* Non-fatal: side panel re-enable failed */
    } } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      chrome.runtime.sendMessage({ action: 'agent_finished', summary: `⏹ Run cancelled — mode mismatch between goal directive ("${modeDirective.wants}") and current Approval Mode setting.` }).catch((e) => {
        console.error('[startAgent] mode mismatch cancel sendMessage failed:', getErrorMessage(e));
      });
      return 'Agent cancelled by user (mode mismatch)';
    }
  }

  const finalGoal = await _applyAdaptivePrompts(goal, tabInfo, startTabId);

  // Fire-and-forget but catch any unhandled rejection so agentRunning never stays
  // stuck at true if runAgentLoop crashes before its own cleanup runs.
  runAgentLoop(finalGoal, startTabId).catch(err => {
    console.error('[Sentinel] runAgentLoop crashed unexpectedly:', getErrorMessage(err));
    agentRunning = false;
    chrome.runtime.sendMessage({
      action: 'agent_finished',
      summary: `Agent crashed unexpectedly: ${getErrorMessage(err)}`
    }).catch(() => {});
  });
  return 'Agent started in background';
}

// (3.15.0) Run the adaptive-prompts platform-rewrite pass before agent execution.
// Reads user settings, calls rewriteGoalForPlatform, handles the approval flow
// (if mode === 'approval'), and returns the final goal string to use for the run.
// Falls back to the original goal on any error.
async function _applyAdaptivePrompts(goal, tabInfo, startTabId) {
  try {
    const apSettings = await chrome.storage.local.get(['adaptivePromptsMode', 'adaptiveExpansionMode', 'technicianInfo']);
    const apMode = (apSettings.adaptivePromptsMode || 'auto').toString();
    if (apMode === 'off') return goal;
    const result = await rewriteGoalForPlatform(
      goal,
      tabInfo?.url || '',
      apSettings.technicianInfo || null,
      apSettings.adaptiveExpansionMode || 'light'
    );
    if (!result || !result.adapted) return goal;
    // Log the adaptation to the forensic run log
    try {
      if (runLogId) {
        runLogBuffer.push({
          step: 0,
          timestamp: new Date().toISOString(),
          kind: 'adaptive_prompt_applied',
          platform: result.platform ? result.platform.id : '',
          mismatchCount: (result.mismatchHints || []).length,
          durationMs: result.durationMs,
          originalLength: (result.originalGoal || '').length,
          adaptedLength: (result.adaptedGoal || '').length
        });
        chrome.storage.local.set({ [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } }).catch((e) => {
          console.error('[_applyAdaptivePrompts] Unhandled rejection:', getErrorMessage(e));
        });
      }
    } catch (_) { /* non-fatal */ }
    if (apMode === 'approval') {
      const decision = await _waitForAdaptedGoalDecision(result, startTabId);
      if (decision.useOriginal) return goal;
      if (decision.edited && typeof decision.editedGoal === 'string' && decision.editedGoal.length > 10) return decision.editedGoal;
      // approved, timeout, or unknown → use adapted
      return result.adaptedGoal;
    }
    // Auto mode: swap silently but broadcast the card for the popup diff view
    try {
      chrome.runtime.sendMessage({
        action: 'adapted_goal_available',
        mode: 'auto',
        platform: result.platform,
        summary: result.summary,
        mismatchHints: result.mismatchHints,
        originalGoal: result.originalGoal,
        adaptedGoal: result.adaptedGoal
      }).catch((e) => {
        console.error('[_applyAdaptivePrompts] Unhandled rejection:', getErrorMessage(e));
      });
    } catch (_e) { /* non-fatal */ }
    return result.adaptedGoal;
  } catch (e) {
    console.warn('[Sentinel] adaptive-prompts pass failed (non-fatal):', getErrorMessage(e));
    return goal;
  }
}

// (3.15.0) Approval flow for Adaptive Prompts. Broadcasts the rewritten goal
// to the popup, waits for the user's decision via adapted_goal_response, and
// keeps the SW alive during the wait.
async function _waitForAdaptedGoalDecision(rewriteResult, _startTabId) {
  const requestId = crypto.randomUUID();
  const kaName = `adaptive_prompt_${requestId}`;
  try { startSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  return new Promise((resolve) => {
    const finish = (payload) => {
      try { stopSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      resolve(payload);
    };
    chrome.runtime.sendMessage({
      action: 'adapted_goal_available',
      mode: 'approval',
      requestId,
      platform: rewriteResult.platform,
      summary: rewriteResult.summary,
      mismatchHints: rewriteResult.mismatchHints,
      originalGoal: rewriteResult.originalGoal,
      adaptedGoal: rewriteResult.adaptedGoal
    }).catch((e) => {
      console.error('[finish] Unhandled rejection:', e);
    });
    const listener = (message) => {
      if (message && message.action === 'adapted_goal_response' && message.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        finish({
          approved: !!message.approved,
          useOriginal: !!message.useOriginal,
          edited: !!message.edited,
          editedGoal: message.editedGoal
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    // Cap at 5 minutes — if the user walks away, proceed with adapted goal
    // rather than blocking the run forever.
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      finish({ approved: true, useOriginal: false, edited: false, reason: 'approval_timeout_default_adapted' });
    }, 5 * 60 * 1000);
  });
}

// (3.15.2) Goal mode-directive detection. MSP technicians often write "Mode:
// APPROVAL" or "agent pauses for technician approval before each click" in the
// goal text to express intent. But the actual approval gating is driven by
// chrome.storage.local.approvalMode (a Settings toggle) — the goal text is
// just prose. A mismatch is dangerous on live production changes: the user
// writes "APPROVAL" expecting the agent to pause, but the toggle is still
// AUTONOMOUS so the agent clicks Apply unprompted. This helper catches that
// before the run starts.
function _detectGoalModeDirective(goal) {
  if (!goal || typeof goal !== 'string') return { detected: false };
  const text = goal.substring(0, 6000);

  // Tier 1: Explicit "Mode: APPROVAL" / "Mode: AUTONOMOUS" / "Mode: YOLO"
  const tier1 = text.match(/\bMode\s*[:=-]\s*(APPROVAL|AUTONOMOUS|YOLO)\b/i);
  if (tier1) {
    const w = tier1[1] ? tier1[1].toUpperCase() : '';
    return {
      detected: true,
      wants: (w === 'APPROVAL') ? 'approval' : 'autonomous',
      evidence: tier1[0] || '',
      confidence: 'high'
    };
  }

  // Tier 2: "<word> mode" phrasing
  const tier2 = text.match(/\b(approval|autonomous|yolo)\s+mode\b/i);
  if (tier2) {
    const w = tier2[1] ? tier2[1].toUpperCase() : '';
    return {
      detected: true,
      wants: (w === 'APPROVAL') ? 'approval' : 'autonomous',
      evidence: tier2[0] || '',
      confidence: 'high'
    };
  }

  // Tier 3: phrases that imply approval-required behavior
  if (/\b(?:agent|sentinel)\s+(?:pauses?|must\s+pause|should\s+pause|will\s+pause)\s+(?:for|before|on|to\s+wait|until)/i.test(text) ||
      /\b(?:PAUSE|pause)\s+(?:and\s+)?wait\s+for\s+(?:technician|user|operator|human|brandon)\s+approval/i.test(text) ||
      /\bwait\s+for\s+(?:technician|user|operator|brandon)\s+approval\s+(?:before|prior\s+to)\s+(?:each|every|any)/i.test(text)) {
    return {
      detected: true,
      wants: 'approval',
      evidence: 'phrase implying agent must pause for human approval',
      confidence: 'medium'
    };
  }

  // Tier 4: phrases implying autonomous behavior (less common but possible)
  if (/\b(?:no\s+approvals?\s+required|execute\s+all\s+steps?\s+(?:autonomously|without\s+pausing)|do\s+not\s+pause)\b/i.test(text)) {
    return {
      detected: true,
      wants: 'autonomous',
      evidence: 'phrase implying agent should run autonomously',
      confidence: 'medium'
    };
  }

  return { detected: false };
}

// (3.15.2) Pause flow for when the goal's mode directive disagrees with the
// actual approval-mode setting. Modeled after _waitForAdaptedGoalDecision.
// Resolves to one of: { flip: true } (user flipped setting, proceed),
// { continue: true } (proceed as-is), { cancel: true } (stop run).
async function _waitForModeMismatchDecision(info) {
  const requestId = crypto.randomUUID();
  const kaName = `mode_mismatch_${requestId}`;
  try { startSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  return new Promise((resolve) => {
    const finish = (payload) => {
      try { stopSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      resolve(payload);
    };
    chrome.runtime.sendMessage({
      action: 'mode_mismatch_pause',
      requestId,
      goalWants: info.goalWants,
      actualMode: info.actualMode,
      evidence: info.evidence,
      confidence: info.confidence
    }).catch((e) => {
      console.error('[finish] Unhandled rejection:', e);
    });
    const listener = (message) => {
      if (message && message.action === 'mode_mismatch_response' && message.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        finish({
          flip: !!message.flip,
          continue: !!message.continue,
          cancel: !!message.cancel
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    // 5-minute cap. Default action on timeout: CANCEL the run. Mode mismatch
    // is a safety issue; "user walked away" should NOT silently proceed.
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      finish({ flip: false, continue: false, cancel: true, reason: 'mode_mismatch_timeout' });
    }, 5 * 60 * 1000);
  });
}

/**
 * Stop the agent loop — ends telemetry, detaches CDP debuggees,
 * dissolves tab groups, and closes all agent-managed tabs.
 * @returns {Promise<string>} Status message indicating the agent was stopped.
 */
export async function stopAgent() {
  tel.info('lifecycle', 'Agent stopping (user-initiated)');
  // (3.27.0) End the telemetry persistence run on user-initiated stop, not
  // just on natural finish. Otherwise the buffer dangles until the next run
  // starts, and the "finishedAt" field never gets stamped.
  try { await telEndRun(runLogId); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  agentRunning = false;
  agentPaused = false;
  // Release any CDP attachments held by the screenshot pipeline.
  try { await detachAllDebuggees(); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  // (3.7.2) Dissolve the visual tab group + reset side-panel availability.
  try { await detachAllSentinelTabs();
    // (v3.53) Re-enable side panel on all tabs now that agent stopped
    try { await _enableSidePanelEverywhere(); } catch (e) { console.warn('[Sentinel] Side panel enable failed:', getErrorMessage(e)); } } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  await closeAllAgentTabs();
  return 'Agent stopped';
}

/**
 * Pause the agent loop. The agent will wait for resumeAgent before continuing.
 * @returns {Promise<string>} Status message indicating the agent was paused.
 */
export async function pauseAgent() {
  if (!agentRunning) return 'Agent not running';
  agentPaused = true;
  return 'Agent paused';
}

/**
 * Resume a paused agent loop.
 * @returns {Promise<string>} Status message indicating the agent was resumed.
 */
export async function resumeAgent() {
  if (!agentRunning) return 'Agent not running';
  agentPaused = false;
  return 'Agent resumed';
}

/**
 * Set the agent execution speed mode, controlling inter-step delays.
 * @param {'turbo'|'normal'|'stealth'} mode - Speed profile to use.
 * @returns {string} Confirmation or error message.
 */
export function setAgentSpeed(mode) {
  if (!VALID_AGENT_SPEEDS.has(mode)) return 'Invalid speed mode. Use: turbo, normal, stealth';
  agentSpeed = mode;
  chrome.storage.local.set({ agentSpeedMode: mode }).catch((e) => {
    console.error('[setAgentSpeed] Unhandled rejection:', e);
  });
  return `Speed set to ${mode}`;
}

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
  const firstValid = batch.find(h => h && h.step !== undefined);
  let lastValid = null;
  for (let i = batch.length - 1; i >= 0; i--) {
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
    if ((/^extract(_list)?$/.test(t)) && h.action.key) extractedKeys.push(h.action.key);
    if (t === 'execute_js' && h.action.key) extractedKeys.push(h.action.key);
    if (t === 'note' && h.action.text) {
      const text = h.action.text;
      notes.push(typeof text === 'string' ? text.substring(0, 200) : String(text).substring(0, 200));
    }
    const r = (h && typeof h.result === 'string') ? h.result : '';
    if (/error|fail|not found|blocked|timed out/i.test(r)) failures.push(`${t}: ${r.substring(0, 120)}`);
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

// ========== Periodic Progress Updates (3.8.2) ==========
// Every PROGRESS_UPDATE_INTERVAL steps during a long run, post a chat
// message summarizing portals visited and data points collected so the
// user sees forward motion instead of just a step counter.
const PROGRESS_UPDATE_INTERVAL = 25;

function maybePostProgressUpdate(stepCount, history, agentMemory) {
  if (stepCount === 0 || stepCount % PROGRESS_UPDATE_INTERVAL !== 0) return;
  try {
    const portalsSeen = new Set();
    for (const h of history) {
      if (!h || !h.action) continue;
      const url = (h.action && h.action.url) || '';
      if (/entra/i.test(url)) portalsSeen.add('Entra');
      else if (/admin\.exchange/i.test(url)) portalsSeen.add('Exchange');
      else if (/purview/i.test(url)) portalsSeen.add('Purview');
      else if (/admin\.microsoft/i.test(url)) portalsSeen.add('M365 Admin');
      else if (/onedrive|sharepoint/i.test(url)) portalsSeen.add('OneDrive/SharePoint');
      else if (/teams/i.test(url)) portalsSeen.add('Teams');
      else if (/intune|endpoint\.microsoft/i.test(url)) portalsSeen.add('Intune');
      else if (/defender|security\.microsoft/i.test(url)) portalsSeen.add('Defender');
      else if (/sentinelone/i.test(url)) portalsSeen.add('SentinelOne');
      else if (/virustotal/i.test(url)) portalsSeen.add('VirusTotal');
    }
    const memCount = Object.keys(agentMemory).length;
    const lastAction = history.length ? history[history.length - 1] : null;
    const lines = [
      `📊 PROGRESS UPDATE — step ${stepCount}`,
      `Portals visited: ${portalsSeen.size > 0 ? [...portalsSeen].join(', ') : '(none yet)'}`,
      `Data points in memory: ${memCount}`,
      `Recent action: ${lastAction?.action ? lastAction.action.type : '(none)'}`
    ];
    sendSilentUpdate(lines.join(' | '), stepCount);
  } catch (e) { console.warn('[Sentinel] HUD update failed:', getErrorMessage(e)); }
}

// ========== Stall Detection ==========
function detectStall(history, consecutiveFailures, _currentStrategies) {
  const recent = history.slice(-CONFIG.stallConfig.similarityWindow);

  // Check 1: All recent actions are the same type with the same failure result
  if (recent.length >= CONFIG.stallConfig.similarityWindow) {
    const firstResult = recent[0] ? recent[0].result : undefined;
    const allSameType = recent[0] && recent[0].action && recent.every(h => h.action && h.action.type === recent[0].action.type);
    const allSameResult = recent.every(h => h.result === firstResult);
    const allFailed = recent.every(h => {
      const r = typeof h.result === 'string' ? h.result : '';
      return /^(Error|Timeout)|not found|timed out|Element not found|No element/i.test(r);
    });

    if (allSameType && allSameResult && allFailed) {
      const actionType = recent[0].action.type || 'unknown';
      const resultStr = typeof firstResult === 'string' ? firstResult : '';
      return {
        stalled: true,
        reason: `Repeated "${actionType}" with same failure: "${resultStr}"`,
        recoveryAction: 'RESCAN_AND_REPLAN'
      };
    }
  }

  // Check 2: Page stagnation — too many clicks/types without page change
  if (_pageStagnation >= CONFIG.stallConfig.stateRecheckSteps) {
    return {
      stalled: true,
      reason: `${_pageStagnation} consecutive clicks/types without page change (stagnation)`,
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


// ========== Tab Group Attachment (3.7.2) ==========
// Visually link every tab the agent operates on into an orange "Sentinel"
// tab group, so the user sees a clear glowing strip above attached tabs in
// the Chrome tab bar. Pairs with per-tab sidePanel.setOptions to hide the
// side panel when the user clicks unrelated tabs.

const SENTINEL_GROUP_TITLE = 'Sentinel';
const SENTINEL_GROUP_COLOR = 'orange';

async function attachTabToSentinelGroup(tabId) {
  if (!tabId || typeof tabId !== 'number') return;
  if (agentAttachedTabs.has(tabId)) return; // already attached
  try {
    if (agentTabGroupId === null) {
      // No group yet — create one containing just this tab.
      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      agentTabGroupId = groupId;
      try {
        await chrome.tabGroups.update(groupId, {
          title: SENTINEL_GROUP_TITLE,
          color: SENTINEL_GROUP_COLOR,
          collapsed: false
        });
      } catch (e) { console.warn('[Sentinel] Tab group update failed (permission?):', getErrorMessage(e)); }
    } else {
      // Add to the existing group. tabs.group with groupId moves them in.
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: agentTabGroupId });
      } catch (e) {
        // Group may have been dissolved by the user — recreate.
        console.warn('[Sentinel] Tab group failed, recreating:', getErrorMessage(e));
        const groupId = await chrome.tabs.group({ tabIds: [tabId] });
        agentTabGroupId = groupId;
        try {
          await chrome.tabGroups.update(groupId, {
            title: SENTINEL_GROUP_TITLE,
            color: SENTINEL_GROUP_COLOR,
            collapsed: false
          });
        } catch (e2) { console.warn('[Sentinel] Tab group recreate update failed:', getErrorMessage(e2)); }
      }
    }
    agentAttachedTabs.add(tabId);
    // Ensure side panel is enabled on this attached tab.
    try {
      await chrome.sidePanel.setOptions({ tabId, enabled: true, path: 'popup.html' });
    } catch (e) { console.warn('[Sentinel] Side panel enable failed (API unavailable?):', getErrorMessage(e)); }
    // (v3.53) Re-scope: enable panel on this new tab, disable on others
    // (v3.57) sidePanel scoping removed from tab attach
  } catch (e) {
    console.warn('[Sentinel] attachTabToSentinelGroup failed:', getErrorMessage(e));
  }
}

async function detachAllSentinelTabs() {
  // Ungroup every attached tab. Safe even if some are already gone.
  const ids = [...agentAttachedTabs];
  agentAttachedTabs.clear();
  agentTabGroupId = null;
  if (!ids.length) return;
  try {
    await chrome.tabs.ungroup(ids);
  } catch (_e) {
    // Some tabs may have been closed already; try one-by-one as a fallback.
    for (const id of ids) {
      try { await chrome.tabs.ungroup([id]); } catch (_e2) {
        // Tab was already closed during the run — not an error, expected behavior
        if (typeof _e2 !== 'object' || _e2 === null || typeof _e2.message !== 'string' || !_e2.message.includes('No tab with id')) {
          console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(_e2));
        }
      }
    }
  }
  // Re-enable the side panel everywhere so non-agent tabs aren't permanently muted.
  try {
    await chrome.sidePanel.setOptions({ enabled: true, path: 'popup.html' });
  } catch (_e) { /* side panel API may not be available */ }
}

// Public accessor so background/index.js can decide side-panel visibility on
// tab-activation events without importing the full Set.
/**
 * Check if a tab is currently attached to the agent session.
 * @param {number} tabId - Chrome tab ID to check.
 * @returns {boolean} True if the tab is attached to the agent.
 */
export function isAgentAttachedTab(tabId) {
  return agentAttachedTabs.has(tabId);
}

// ========== Side Panel Scoping (v3.53) ==========
async function _enableSidePanelEverywhere() {
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (tab.id) {
        try {
          await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true, path: 'popup.html' });
        } catch (_e) {
          // Side panel may not be available in all contexts
        }
      }
    }
  } catch (_e) {
    // Side panel API call failed non-critically
  }
}


// ========== CDP Fallback (v3.54) ==========
// When the content script can't inject (CSP, security headers, etc.), use CDP
// directly to observe the page, dismiss overlays, and execute commands.
// CDP bypasses CSP entirely — it's the same channel DevTools uses.

async function _cdpObservePage(tabId) {
  // (v3.57) Extract interactive elements and page text via CDP Runtime.evaluate
  // First, wait for DOM to be ready (document.body can be null on slow-loading pages)
  const waitCode = 'var body = document.body || document.documentElement;'
    + 'var title = document.title || "";'
    + 'var childCount = body ? body.childNodes.length : 0;'
    + 'return { hasBody: !!document.body, title: title, childCount: childCount, '
    + '  url: window.location.href, readyState: document.readyState };';

  // SPEED: Skip ready check if previous observe found page was loaded
  if (_pageWasReady) {
    console.log('[Sentinel/CDP] Skipping page ready check — previous observe confirmed loaded');
  } else try {
    const readyState = await cdpExecuteJs(tabId, waitCode, { timeout: 2000 });
    console.log('[Sentinel/CDP] Page ready check:', JSON.stringify(readyState && readyState.value));
    if (readyState && readyState.ok && readyState.value) {
      const r = readyState.value;
      // If page has no body and no children, wait a moment and try again
      if (!r.hasBody && r.childCount === 0) {
        console.log('[Sentinel/CDP] Page has no body — waiting 2s for DOM...');
        try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
        await sleep(2000);
      }
      // If title is empty and URL is still about:blank or loading, wait
      if (!r.title && (r.url === 'about:blank' || r.url === '')) {
        console.log('[Sentinel/CDP] Page still loading — waiting 2s...');
        try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
        await sleep(2000);
      }
    }
  } catch(e) {
    console.warn('[Sentinel/CDP] Ready check failed:', getErrorMessage(e));
  }

  const code = 'var results = { elements: [], text: "", overlays: [] };'
    + 'try {'
    + '  var body = document.body || document.documentElement;'
    // Page text — use documentElement as fallback if body is null
    + '  results.text = body ? (body.innerText || "").substring(0, 8000) : "";'
    // Interactive elements
    + '  var els = document.querySelectorAll("a[href], button, input, select, textarea, [role=\\"button\\"], [role=\\"link\\"], [onclick]");'
    + '  var seen = new Set();'
    + '  for (var i = 0; i < els.length; i++) {'
    + '    if (seen.size >= 60) break;'
    + '    var el = els[i];'
    + '    var rect = el.getBoundingClientRect();'
    + '    if (rect.width < 2 || rect.height < 2) continue;'
    + '    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;'
    + '    var tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";'
    + '    var tText = typeof el.textContent === "string" ? el.textContent : "";'
    + '    var text = tText.trim().substring(0, 50);'
    + '    var href = el.href || "";'
    + '    var type = el.type || "";'
    + '    var id = el.id || "";'
    + '    var cls = el.className && typeof el.className === "string" ? el.className.substring(0, 80) : "";'
    + '    var selector = id ? "#" + id : (tag + (cls ? "." + cls.split(" ").filter(function(c){return c;}).slice(0,2).join(".") : "")).substring(0, 80);'
    + '    var key = selector + text.substring(0, 20);'
    + '    if (seen.has(key)) continue;'
    + '    seen.add(key);'
    + '    results.elements.push({'
    + '      tag: tag, text: text.substring(0, 40), href: href.substring(0, 100),'
    + '      type: type, id: id.substring(0, 40),'
    + '      bbox: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },'
    + '      selector: selector.substring(0, 100)'
    + '    });'
    + '  }'
    // Detect overlays — only if we have a body
    + '  if (document.body) {'
    + '    var overlayEls = document.querySelectorAll("div, section, aside, dialog");'
    + '    for (var o = 0; o < overlayEls.length; o++) {'
    + '      try {'
    + '        var node = overlayEls[o];'
    + '        var nst = window.getComputedStyle(node);'
    + '        if (nst.display === "none" || nst.visibility === "hidden") continue;'
    + '        var npos = nst.position || "";'
    + '        var nz = parseInt(nst.zIndex, 10) || 0;'
    + '        if ((npos === "fixed" || npos === "absolute") && nz >= 100) {'
    + '          var nrect = node.getBoundingClientRect();'
    + '          if (nrect.width > 200 && nrect.height > 100) {'
    + '            var buttons = node.querySelectorAll("button, a, [role=\\"button\\"]");'
    + '            var btnList = [];'
    + '            for (var b = 0; b < buttons.length; b++) {'
    + '              var bContent = typeof buttons[b].textContent === "string" ? buttons[b].textContent : "";'
    + '              var bText = bContent.trim().substring(0, 40);'
    + '              var bRect = buttons[b].getBoundingClientRect();'
    + '              if (bRect.width > 0 && bRect.height > 0) {'
    + '                btnList.push({ text: bText, x: Math.round(bRect.left + bRect.width/2), y: Math.round(bRect.top + bRect.height/2) });'
    + '              }'
    + '            }'
    + '            var nodeText = typeof node.textContent === "string" ? node.textContent : "";'
    + '            results.overlays.push({ selector: "overlay", text: nodeText.substring(0, 100), buttons: btnList });'
    + '          }'
    + '        }'
    + '      } catch(e) { console.error("[Sentinel] Overlay processing error:", (typeof e === "object" && e !== null && typeof e.message === "string") ? e.message : String(e)); }'
    + '    }'
    + '  }'
    + '} catch(e) { results.error = (typeof e === "object" && e !== null && typeof e.message === "string") ? e.message : String(e); }'
    + 'return results;';

  // SPEED: Check cache — if same URL observed recently, reuse
  const tabInfo = await getTabInfo(tabId);
  const currentUrl = tabInfo ? tabInfo.url : '';
  // In batch mode (queue has items), always use cache if available (no TTL limit)
  const _inBatchMode = _pendingCommandQueue?.length;
  const _cacheTTL = _inBatchMode ? BATCH_MODE_CACHE_TTL_MS : API_CACHE_TTL_MS;
  if (_cachedObservation && _cachedObservation.url === currentUrl && (Date.now() - _cachedObservation.timestamp) < _cacheTTL) {
    _observeCacheHits++;
    console.log(`[Sentinel/CDP] Observation CACHE HIT #${_observeCacheHits} — reusing last result for`, currentUrl);
    return _cachedObservation;
  }
  console.log('[Sentinel/CDP] _cdpObservePage: sending to tab', tabId, 'code length:', code.length);
  const result = await cdpExecuteJs(tabId, code, { timeout: 3000 });
  console.log('[Sentinel/CDP] _cdpObservePage result:', JSON.stringify(result).substring(0, 300));
  if (result?.ok && result?.value) {
    console.log('[Sentinel/CDP] _cdpObservePage: got', (result.value.elements || []).length, 'elements,', (result.value.text || '').length, 'chars text,', (result.value.overlays || []).length, 'overlays');
    _pageWasReady = true; // Mark page as ready for next step
    return result.value;
  }
  return null;
}

async function _cdpDismissOverlays(tabId, overlays) {
  // (v3.56) Nuclear overlay annihilator — 3 phases, no mercy
  let totalRemoved = 0;

  // Phase 1: Click accept/agree buttons if we have overlay detection data
  if (overlays && overlays.length) {
    const acceptRegex = /agree|accept|accept all|got it|ok|consent|allow|continue|proceed|yes|sure/i;
    for (const overlay of overlays) {
      const buttons = Array.isArray(overlay.buttons) ? overlay.buttons : [];
      // Single-pass button selection: prefer accept button, fallback to any button with text
      let dismissBtn = null;
      for (const b of buttons) {
        if (b && acceptRegex.test(b.text)) {
          dismissBtn = b;
          break; // Found accept button, use it immediately
        }
        if (!dismissBtn && b && b.text && b.text.length) {
          dismissBtn = b; // Track first fallback
        }
      }
      // Final fallback: first button if no other found
      if (!dismissBtn && buttons.length) {
        dismissBtn = buttons[0];
      }
      if (dismissBtn && dismissBtn.x && dismissBtn.y) {
        console.log('[Sentinel/CDP] Phase1 clicking:', dismissBtn.text, 'at', dismissBtn.x, dismissBtn.y);
        const r = await cdpDispatchClick(tabId, dismissBtn.x, dismissBtn.y, { skipVisual: true });
        if (r && r.ok) totalRemoved++;
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }

  // Phase 2: Remove ALL iframes (consent dialogs are almost always in iframes)
  // and remove ANY fixed/absolute element with high z-index covering significant screen area
  const nukeCode = [
        'var n = 0;',
        'var btns = document.querySelectorAll("button, a, [role=\\"button\\"], input[type=\\"submit\\"]");',
        'var consentClicked = false;',
        'for (var b = 0; b < btns.length; b++) {',
        '  var btnContent = typeof btns[b].textContent === "string" ? btns[b].textContent : "";',
        '  var t = btnContent.trim().toLowerCase();',
        '  if (t === "accept" || t === "agree" || t === "i agree" || t === "ok" || t === "got it" || t === "accept all" || t === "agree all" || t === "consent" || t === "allow all" || t === "yes, i agree" || t.indexOf("accept") === 0 || t.indexOf("agree") === 0) {',
        '    btns[b].click(); consentClicked = true; n++; break;',
        '  }',
        '}',
        'if (!consentClicked) {',
        '  var iframes = document.querySelectorAll("iframe");',
        '  for (var i = iframes.length - 1; i >= 0; i--) {',
        '    var src = (iframes[i].src || "").toLowerCase();',
        '    var iid = (iframes[i].id || "").toLowerCase();',
        '    var icls = (iframes[i].className || "").toLowerCase();',
        '    var isConsent = src.indexOf("consent") >= 0 || src.indexOf("cookie") >= 0 || src.indexOf("gdpr") >= 0 || src.indexOf("onetrust") >= 0 || src.indexOf("trustarc") >= 0 || src.indexOf("sourcepoint") >= 0 || src.indexOf("privacymgmt") >= 0 || iid.indexOf("consent") >= 0 || iid.indexOf("sp_message") >= 0;',
        '    var rect = iframes[i].getBoundingClientRect();',
        '    var isSmall = rect.height < 300 && rect.width < 600;',
        '    if (isConsent && isSmall) { iframes[i].remove(); n++; }',
        '  }',
        '}',
        'if (!consentClicked && n === 0) {',
        '  var overlaySels = ["#onetrust-consent-sdk","#onetrust-banner-sdk","#cookieConsent","#cookie-notice","#cookie-banner",".cky-consent-container",".cc-window",".cc-banner",".cc-floating","[aria-modal=true]","[role=dialog]","div[id^=sp_message]",".sp_message",".sp_veil"];',
        '  for (var s = 0; s < overlaySels.length; s++) {',
        '    try {',
        '      var els = document.querySelectorAll(overlaySels[s]);',
        '      for (var j = 0; j < els.length; j++) { els[j].remove(); n++; }',
        '    } catch(e) {}',
        '  }',
        '}',
        'if (!consentClicked && n === 0) {',
        '  var allDivs = document.querySelectorAll("div, section, aside, dialog");',
        '  for (var k = 0; k < allDivs.length; k++) {',
        '    try {',
        '      var st = window.getComputedStyle(allDivs[k]);',
        '      var pos = st.position || "";',
        '      var z = parseInt(st.zIndex, 10) || 0;',
        '      if ((pos === "fixed" || pos === "absolute") && z >= 100) {',
        '        var r = allDivs[k].getBoundingClientRect();',
        '        var area = r.width * r.height;',
        '        var screen = window.innerWidth * window.innerHeight;',
        '        var divContent = typeof allDivs[k].textContent === "string" ? allDivs[k].textContent : "";',
        '        var textLen = divContent.trim().length;',
        '        if (area > screen * 0.3 && textLen < 200) {',
        '          allDivs[k].remove(); n++;',
        '        }',
        '      }',
        '    } catch(e) {}',
        '  }',
        '}',
        'if (document.body) { document.body.style.overflow = ""; document.body.style.position = ""; document.body.style.width = ""; }',
        'if (document.documentElement) { document.documentElement.style.overflow = ""; }',
        'return n;'
      ].join('\n');

  // SPEED: Skip nuke entirely when no overlays detected AND last nuke was clean
  if (!overlays.length && _lastNukeClean) {
    console.log('[Sentinel/CDP] Skipping nuke — no overlays and last nuke was clean');
  } else try {
    console.log(`[Sentinel/CDP] Phase2: sending surgical nuke (${nukeCode.length} chars) to tab`, tabId);
    const nukeResult = await cdpExecuteJs(tabId, nukeCode, { timeout: 5000 });
    console.log('[Sentinel/CDP] Phase2 raw result:', JSON.stringify(nukeResult));
    if (nukeResult && nukeResult.ok) {
      const removed = (nukeResult.value || 0);
      console.log('[Sentinel/CDP] Phase2 surgical removal:', removed, 'elements affected');
      totalRemoved += removed;
      _lastNukeClean = (removed === 0); // Track for skip optimization
      // (v3.59) Post-nuke integrity check: verify page still has content
      if ((nukeResult.value || 0) > 0) {
        const integrityCheck = await cdpExecuteJs(tabId, 'return { hasBody: !!document.body, title: document.title || "", url: window.location.href };', { timeout: 3000 });
        console.log('[Sentinel/CDP] Post-nuke integrity:', JSON.stringify(integrityCheck && integrityCheck.value));
        if (integrityCheck && integrityCheck.ok && integrityCheck.value) {
          if (!integrityCheck.value.hasBody || !integrityCheck.value.title) {
            console.warn('[Sentinel/CDP] Nuke destroyed page content — reloading via CDP...');
            try {
              await chrome.debugger.sendCommand({ tabId: tabId }, 'Page.reload', { ignoreCache: true });
              await new Promise(r => setTimeout(r, 2000));
              console.warn('[Sentinel/CDP] Page reloaded after integrity failure');
            } catch(reloadErr) {
              console.warn('[Sentinel/CDP] Reload failed:', getErrorMessage(reloadErr));
            }
          }
        }
      }
    } else {
      console.warn('[Sentinel/CDP] Phase2 FAILED. error:', (typeof nukeResult === 'object' && nukeResult !== null && typeof nukeResult.error === 'string' ? nukeResult.error : String(nukeResult?.error || 'unknown')));
    }
  } catch(e) {
    console.warn('[Sentinel/CDP] Phase2 threw:', getErrorMessage(e));
  }

  // Phase 3: Quick scroll test (only if overlays were found)
  if (totalRemoved > 0) try {
    await cdpExecuteJs(tabId, 'window.scrollTo(0, 100)', { timeout: 2000 });
    await new Promise(r => setTimeout(r, 200));
    await cdpExecuteJs(tabId, 'window.scrollTo(0, 0)', { timeout: 2000 });
  } catch(e) { console.warn('[Sentinel/CDP] Scroll test failed:', getErrorMessage(e)); }

  console.log('[Sentinel/CDP] Overlay dismissal complete. Total removed:', totalRemoved);
  return totalRemoved;
}

// Track whether we're in CDP fallback mode for the current step
let _cdpFallbackActive = false;
let _lastNukeClean = false; // Track if last nuke found nothing to remove
let _pageWasReady = false; // Skip ready check if previous observe succeeded
let _cachedObservation = null; // { url, elementsCount, textLen, elements, text, timestamp }
let _observeCacheHits = 0;



/**
 * Get all tab IDs currently attached to the agent session.
 * @returns {number[]} Array of Chrome tab IDs.
 */
export function getAttachedTabIds() {
  return [...agentAttachedTabs];
}

// (3.40.0) Audit log access — delegated from background/index.js message handler.
/**
 * Fetch the audit log for a specific run, or the current run if no ID provided.
 * @param {string} [id] - Run log ID; defaults to the current run.
 * @returns {Promise<Array>} Array of audit log entries.
 */
export async function fetchAuditLog(id) {
  return getAuditLog(id || runLogId);
}
export { auditLogToCsv };

// ========== Configuration Verification Gate (3.7.0) ==========
// Prevents the agent from declaring "done" on a configuration-change task
// (firewall rule add, M365 permission grant, RMM script deploy, etc.) before
// it has actually clicked Save/Apply/Commit AND verified the change is
// reflected on the page. Stops false-positive completions cold — the most
// common reason a ticket gets reopened.

const CHANGE_VERBS_RE = /\b(add|create|delete|modify|update|enable|disable|block|allow|configure|grant|revoke|assign|remove|change|deploy|push)\b/i;
const COMMIT_TARGET_RE = /\b(apply|applied|save|saved|commit|committed|deploy|deployed|accept|accepted|update|updated|create|created|delete|deleted|publish|published|submit|submitted|confirm|confirmed|ok)\b/i;
const CONFIG_PLATFORM_RE = /(sonicwall|sonicos|fortinet|fortigate|cisco|paloalto|pan-os|panorama|admin\.microsoft|admin\.exchange|entra\.microsoft|portal\.azure|connectwise|ninjaone|ninja\.io|ninjarmm|datto|autotask|itglue|it-glue|huntress|screenconnect)/i;

function isConfigChangeGoal(goal, currentUrl) {
  const text = String(goal || '');
  const url  = String(currentUrl || '');
  return CHANGE_VERBS_RE.test(text) && (CONFIG_PLATFORM_RE.test(url) || CONFIG_PLATFORM_RE.test(text));
}

function hasRecentCommitClick(history) {
  // Look at last 12 entries for a click whose target text or result mentions
  // commit-style verbs. Tolerate both selector-based and click_at clicks.
  const lookback = history.slice(-12);
  for (const h of lookback) {
    if (!h || !h.action) continue;
    const t = h.action.type;
    if (t !== 'click' && t !== 'click_at') continue;
    const probe = [
      typeof h.action.text === 'string' ? h.action.text : '',
      typeof h.action.selector === 'string' ? h.action.selector : '',
      typeof h.action.ref === 'string' ? h.action.ref : '',
      typeof h.action.description === 'string' ? h.action.description : '',
      typeof h.result === 'string' ? h.result : ''
    ].join(' ').toLowerCase();
    if (COMMIT_TARGET_RE.test(probe)) return true;
  }
  return false;
}

function hasPostCommitVerification(history) {
  // After the most recent commit click, did a read_page / extract / extract_list / note run?
  // We require ordering: commit FIRST, verification AFTER.
  const lookback = history.slice(-12);
  let sawCommit = false;
  for (const h of lookback) {
    if (!h || !h.action) continue;
    const t = h.action.type;
    if (!sawCommit) {
      if (t === 'click' || t === 'click_at') {
        const probe = [
          typeof h.action.text === 'string' ? h.action.text : '',
          typeof h.action.selector === 'string' ? h.action.selector : '',
          typeof h.action.ref === 'string' ? h.action.ref : '',
          typeof h.result === 'string' ? h.result : ''
        ].join(' ').toLowerCase();
        if (COMMIT_TARGET_RE.test(probe)) sawCommit = true;
      }
    } else {
      if (MEMORY_WRITING_ACTIONS.has(t)) return true;
    }
  }
  return false;
}

// ========== Ticket FINAL_NOTES Auto-Formatter (3.8.0) ==========
// Post-processes the agent's finish summary into Brandon's preferred ticket
// FINAL_NOTES format when the goal is recognized as a ticket investigation.
// The format (per user prefs):
//   Action Taken: [1-2 sentences]
//   Contact Attempt Details: [method/time]
//   Next Step and Time: [follow-up time or "None required. Ticket closed."]
//   Ownership Statement: [technician name + resolution confirmation]
//
// Technician details are pulled from chrome.storage.local.technicianInfo
// with sensible defaults that match the user's preferences.

const TICKET_GOAL_RE = /\b(ticket|incident|alert|investigat|threat\s+hunt|malware|sentinelone|connectwise|kaseya)\b|#\d{3,}/i;

function isTicketInvestigationGoal(goal) {
  if (!goal || typeof goal !== 'string') return false;
  return TICKET_GOAL_RE.test(goal);
}

async function getTechnicianInfo() {
  const defaults = {
    name: 'John Smith',
    title: 'IT Support Technician',
    company: 'Acme IT',
    phone: '555-000-0000',
    email: 'support@example.com'
  };
  try {
    const stored = await chrome.storage.local.get(['technicianInfo']);
    if (stored && stored.technicianInfo && typeof stored.technicianInfo === 'object' && stored.technicianInfo !== null) {
      return { ...defaults, ...stored.technicianInfo };
    }
  } catch (_e) { /* storage read non-fatal */ }
  return defaults;
}

// Best-effort ticket-number extraction: matches "ticket #NNN", "ticket NNN",
// "incident #NNN", or a leading "#NNN" pattern.
function extractTicketNumber(goal) {
  if (!goal) return '';
  const m = goal.match(/(?:ticket|incident|alert)[#\s:]*(\d{3,8})/i)
         || goal.match(/#(\d{3,8})/);
  return m ? m[1] : '';
}

function formatTicketFinalNotes(summary, goal, tech, options) {
  const ticketNum = extractTicketNumber(goal);
  const opts = options || {};
  const stepCount = opts.stepCount || 0;
  const apiCallCount = opts.apiCallCount || 0;
  const now = new Date();
  const stamp = `${now.toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  // Default to "ticket-resolved" framing. If the agent indicates partial
  // results (step-limit / extraction failure), shift to "waiting" framing.
  const partial = /step limit|extraction.*fail|not yet|incomplete|manually search/i.test(summary || '');

  // Action Taken: take the first 2 sentences from the summary (or up to 240 chars).
  const summaryStr = typeof summary === 'string' ? summary : '';
  let actionTaken = summaryStr.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').trim();
  if (!actionTaken) actionTaken = 'Investigation completed via Sentinel Override agent.';
  if (actionTaken.length > 240) actionTaken = `${actionTaken.slice(0, 237)}...`;

  const nextStep = partial
    ? 'Manual review required — see investigation findings below. Recommend follow-up within 1 business day.'
    : 'None required. Ticket closed pending client confirmation.';

  const ownership = `${tech.name} (${tech.title}, ${tech.company}) — ${partial ? 'investigation in progress' : 'investigation completed and findings documented'}.`;

  let header = '';
  if (ticketNum) header = `**Ticket #${ticketNum}** — `;
  header += partial ? 'Investigation Notes (partial)' : 'Final Notes';

  // Build the formatted block.
  const block = [
    `## ${header}`,
    '',
    '**Action Taken:**',
    `- ${actionTaken}`,
    '',
    '**Contact Attempt Details:**',
    `- Automated investigation via Sentinel Override agent at ${stamp} (${stepCount} steps, ${apiCallCount} AI calls).`,
    '',
    '**Next Step and Time:**',
    `- ${nextStep}`,
    '',
    '**Ownership Statement:**',
    `- ${ownership}`,
    '',
    '---',
    '',
    '### Full investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    `_${tech.name} · ${tech.title} · ${tech.company}_`,
    `_Phone: ${tech.phone} · Email: ${tech.email}_`
  ].join('\n');

  return block;
}

// ========== Ticket Mode Formatters (3.14.0) ==========
// Additional MSP output templates per the user's preference doc. Each takes
// (summary, goal, tech, options) and returns a markdown-formatted block. The
// dispatcher `formatTicketOutput(format, ...)` routes to the right one based on
// chrome.storage.local.ticketMode/ticketFormat settings.
//
// Formats: TICKET_KICKOFF, FINAL_NOTES (existing), WAITING_ON_CLIENT,
// WAITING_ON_VENDOR, IT_GLUE_KB, CLIENT_EMAIL.

function _ticketHeader(ticketNum, label) {
  return ticketNum ? `**Ticket #${ticketNum}** — ${label}` : label;
}

function _ticketStamp() {
  return `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function _splitTriedSection(summary) {
  // Pull "what's been tried" candidates from the summary — anything that reads
  // like a remediation step. Falls back to a single line if nothing matches.
  if (!summary || typeof summary !== 'string') return ['Pending technician input.'];
  const lines = summary.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const triedRe = /^(tried|attempted|ran|tested|restart|reboot|reinstall|reset|verified|confirmed|checked|cleared|escalated)/i;
  const matches = lines.filter(l => triedRe.test(l)).slice(0, 6);
  return matches.length ? matches : [(lines.length ? lines[0] : '').slice(0, 200)];
}

function formatTicketKickoff(summary, goal, tech, options) {
  const _opts = options || {}; // reserved for future template options
  const ticketNum = extractTicketNumber(goal);
  const tried = _splitTriedSection(summary).map(s => `- ${s}`).join('\n');
  // Resolution path: derive from the summary's last 1-3 sentences (treat them
  // as recommended next steps). If empty, leave numbered placeholders so the
  // tech can fill in.
  const sentences = (summary || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const tail = sentences.slice(-3);
  const pathLines = tail.length
    ? tail.map((s, i) => `${i + 1}. ${s.replace(/\s+/g, ' ').slice(0, 240)}`)
    : ['1. Low-risk check (verify configuration, run diagnostics).', '2. Next step (apply targeted fix or escalate).', '3. Escalation/fix (vendor case, change request, or remediation)'];

  const lines = [
    `## ${_ticketHeader(ticketNum, 'Ticket Kickoff')}`,
    '',
    '**MAIN ISSUE:**',
    `- ${((goal || '').split(/\n/)[0] || '').slice(0, 280)}`,
    '',
    '**WHAT HAS BEEN TRIED:**',
    tried,
    '',
    '**FASTEST SAFE RESOLUTION PATH:**',
    pathLines.join('\n'),
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    `_${tech.name} · ${tech.title} · ${tech.company}_`,
    `_Phone: ${tech.phone} · Email: ${tech.email}_`
  ];
  return lines.join('\n');
}

function formatWaitingOnClient(summary, goal, tech, options) {
  const _opts = options || {}; // reserved for future template options
  const ticketNum = extractTicketNumber(goal);
  const stamp = _ticketStamp();
  const firstSentence = ((summary || '').split(/(?<=[.!?])\s+/)[0] || '').slice(0, 240) || 'Investigation in progress; awaiting client response.';
  const followUp = `${new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  const lines = [
    `## ${_ticketHeader(ticketNum, 'Waiting on Client')}`,
    '',
    '**Action Taken:**',
    `- ${firstSentence}`,
    '',
    '**Contact Attempt Details:**',
    `- Automated investigation completed at ${stamp}. Awaiting client confirmation or additional details.`,
    '',
    '**Next Step and Time:**',
    `- Follow up by ${followUp} (or sooner if client responds).`,
    '',
    '**Ownership Statement:**',
    `- ${tech.name} (${tech.title}, ${tech.company}) — will re-engage once client responds.`,
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    `_ ${tech.name} · Phone: ${tech.phone} · Email: ${tech.email}_`
  ];
  return lines.join('\n');
}

function formatWaitingOnVendor(summary, goal, tech, options) {
  const _opts = options || {}; // reserved for future template options
  const ticketNum = extractTicketNumber(goal);
  const stamp = _ticketStamp();
  const firstSentence = ((summary || '').split(/(?<=[.!?])\s+/)[0] || '').slice(0, 240) || 'Diagnostics completed; vendor case opened.';
  const followUp = `${new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  const lines = [
    `## ${_ticketHeader(ticketNum, 'Waiting on Vendor')}`,
    '',
    '**Action Taken:**',
    `- ${firstSentence}`,
    '',
    '**Contact Attempt Details:**',
    `- Vendor case opened at ${stamp}. Awaiting vendor response / ETA.`,
    '',
    '**Next Step and Time:**',
    `- Follow up by ${followUp} (or on vendor response).`,
    '',
    '**Ownership Statement:**',
    `- ${tech.name} (${tech.title}, ${tech.company}) — will follow up with vendor and update ticket.`,
    '',
    '---',
    '',
    '### Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    `_ ${tech.name} · Phone: ${tech.phone} · Email: ${tech.email}_`
  ];
  return lines.join('\n');
}

function formatItGlueKb(summary, goal, tech, options) {
  const _opts = options || {}; // reserved for future template options
  const goalShort = ((goal || '').split(/\n/)[0] || '').slice(0, 100);
  const ticketNum = extractTicketNumber(goal);
  const title = ticketNum ? `${goalShort} (Ref: Ticket #${ticketNum})` : goalShort;

  // Derive resolution steps from the summary's numbered/bulleted lines or
  // sentence breakdown.
  const lines = (summary || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  const stepCandidates = lines.filter(l => /^(\d+[.)]|-|\*)\s+/.test(l)).slice(0, 8);
  const steps = stepCandidates.length
    ? stepCandidates.map((s, i) => `${i + 1}. ${s.replace(/^(\d+[.)]|-|\*)\s+/, '')}`)
    : (lines.slice(0, 5).map((s, i) => `${i + 1}. ${s}`));

  const envBits = [];
  if (/m365|microsoft|entra|exchange|defender|purview/i.test(goal || '')) envBits.push('Microsoft 365 / Entra ID');
  if (/sonicwall|fortigate|firewall/i.test(goal || '')) envBits.push('Firewall (vendor-specific)');
  if (/sentinelone|crowdstrike|defender for endpoint/i.test(goal || '')) envBits.push('EDR platform');
  if (/connectwise|ninjaone|kaseya|datto/i.test(goal || '')) envBits.push('RMM/PSA platform');
  if (!envBits.length) envBits.push('General — see investigation findings for specifics');

  const out = [
    '## IT Glue Knowledge Base Entry',
    '',
    '**Title:**',
    `- ${(title || 'Untitled')}`,
    '',
    '**Issue:**',
    `- ${((summary || '').split(/(?<=[.!?])\s+/)[0] || '').slice(0, 240)}`,
    '',
    '**Environment:**',
    `- ${envBits.join('; ')}`,
    '',
    '**Resolution Steps:**',
    steps.length ? steps.join('\n') : '1. (steps not auto-derivable — fill in manually)',
    '',
    '**Verification:**',
    '- Confirm the configured state is present and the original symptom no longer reproduces.',
    '',
    '**Screenshots:**',
    '- (attach the agent\'s screenshots from the investigation report)',
    '',
    '---',
    '',
    '### Source — Investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    `_Documented by ${tech.name} · ${tech.company}_`
  ];
  return out.join('\n');
}

function formatClientEmail(summary, goal, tech, options) {
  const _opts = options || {}; // reserved for future template options
  const ticketNum = extractTicketNumber(goal);
  const ticketRef = ticketNum ? `Ticket #${ticketNum}` : 'your recent ticket';
  const ticketRefShort = ticketNum ? `Ticket #${ticketNum}` : 'your ticket';
  const briefIssue = ((goal || '').split(/\n/)[0] || '').replace(/^(ticket|incident)\s*#?\d*[:\-\s]+/i, '').slice(0, 80) || 'your reported issue';
  const oneLine = ((summary || '').split(/(?<=[.!?])\s+/)[0] || 'The issue has been investigated and addressed.').slice(0, 240);

  const subject = `Resolved: ${ticketRefShort} – ${briefIssue}`;

  const body = [
    'Hello [Client Name],',
    '',
    `The issue reported in ${ticketRef} has been resolved. ${oneLine}`,
    '',
    `Everything is now working as expected. If you need further assistance, contact us at ${tech.phone} or ${tech.email}.`,
    '',
    'Best regards,',
    tech.name,
    tech.title,
    tech.company,
    `Phone: ${tech.phone} | Email: ${tech.email}`
  ];

  const block = [
    '## Client Email',
    '',
    `**Subject:** ${subject}`,
    '',
    '**Body:**',
    '',
    body.join('\n'),
    '',
    '---',
    '',
    '_Replace `[Client Name]` before sending. Investigation findings (for your reference, not in email body):_',
    '',
    summary || '(no summary)'
  ];
  return block.join('\n');
}

// Dispatcher — returns formatted text for the requested format. Format values
// match the user's preference doc: 'TICKET_KICKOFF', 'FINAL_NOTES',
// 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR', 'IT_GLUE_KB', 'CLIENT_EMAIL', or
// 'auto'. 'auto' picks based on goal/summary heuristics.
function _autoPickFormat(summary, goal) {
  const text = `${goal} ${summary}`.toLowerCase();
  if (/waiting on (the )?vendor|vendor (case|ticket)|vendor support/.test(text)) return 'WAITING_ON_VENDOR';
  if (/waiting on (the )?client|awaiting client|client to respond|client (callback|reply)/.test(text)) return 'WAITING_ON_CLIENT';
  if (/(create|document|write).*(kb|knowledge base|it glue)/.test(text)) return 'IT_GLUE_KB';
  if (/draft (an?|the) email|send (an?|the) email|email the client/.test(text)) return 'CLIENT_EMAIL';
  if (/kickoff|new ticket|just opened|investigate this ticket/.test(text)) return 'TICKET_KICKOFF';
  return 'FINAL_NOTES';  // default
}

function formatTicketOutput(format, summary, goal, tech, options) {
  const fmt = (format || 'auto').toString().toUpperCase();
  const resolved = (fmt === 'AUTO') ? _autoPickFormat(summary, goal) : fmt;
  switch (resolved) {
    case 'TICKET_KICKOFF':     return formatTicketKickoff(summary, goal, tech, options);
    case 'WAITING_ON_CLIENT':  return formatWaitingOnClient(summary, goal, tech, options);
    case 'WAITING_ON_VENDOR':  return formatWaitingOnVendor(summary, goal, tech, options);
    case 'IT_GLUE_KB':         return formatItGlueKb(summary, goal, tech, options);
    case 'CLIENT_EMAIL':       return formatClientEmail(summary, goal, tech, options);
    case 'FINAL_NOTES':
    default:                   return formatTicketFinalNotes(summary, goal, tech, options);
  }
}

const MODIFYING_ACTIONS = new Set(['click', 'click_at', 'type', 'select', 'check', 'check_all', 'press_key', 'upload_file']);

// Pre-computed Sets for loop detection - avoid recreating on every action
const NON_PRODUCTIVE_ACTIONS = new Set(['navigate', 'switch_tab', 'click', 'scroll', 'wait_for_text', 'wait_for_element', 'read_page']);
const NON_PRODUCTIVE_READ_ACTIONS = new Set(['read_page', 'execute_js', 'scroll', 'wait_for_text', 'wait_for_element']);
const REF_DRIVEN_ACTIONS = new Set(['click', 'type', 'hover', 'select', 'check', 'extract', 'extract_list', 'wait_for_element', 'scroll_to']);
const TARGETABLE_ACTIONS = new Set(['click', 'type', 'hover', 'select', 'check', 'check_all', 'extract', 'extract_list', 'scroll_to', 'wait_for_element']);
const LOOP_EXCLUDE_TYPES = new Set(['finish', 'navigate', 'extract', 'extract_list']);
const FILLER_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'each', 'one', 'sentence', 'summary', 'whether', 'has', 'have', 'been', 'observed', 'in', 'is']);
const DATA_ACTIONS = new Set(['extract', 'extract_list', 'note', 'finish']);
const TAB_ACTIONS = new Set(['open_tab', 'switch_tab', 'close_tab']);
const INTERACTIVE_ACTIONS = new Set(['navigate', 'click', 'click_at', 'type', 'press_key', 'select', 'scroll_to', 'scroll']);
const CDP_FALLBACK_BLOCKED = new Set(['navigate', 'click', 'click_at', 'type', 'press_key', 'execute_js', 'finish', 'extract', 'extract_list', 'note', 'batch', 'smart_navigate']);
const EXTRACT_ACTIONS = new Set(['extract', 'extract_list', 'read_page']);
const MEMORY_WRITING_ACTIONS = new Set(['read_page', 'extract', 'extract_list', 'note']);
const MODIFYING_INTERACTIVE_ACTIONS = new Set(['click', 'type', 'select', 'navigate', 'check', 'check_all']);
const OTHER_ACTIONS = new Set(['execute_js', 'scroll', 'dismiss_overlay']);

function _hostnameOf(url) {
  try { return new URL(url).hostname; } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); return ''; }
}

function _tenantsMatch(detected, expected) {
  if (!expected || (typeof expected === 'string' && !expected.trim())) return true;  // no expected = no lock
  if (!detected) return false;  // we have an expectation but nothing detected yet → block
  const exp = typeof expected === 'string' ? expected.trim().toLowerCase() : '';
  const signals = [detected.chipText || '', detected.onmicrosoft || '', detected.tid || ''].map(s => String(s).toLowerCase());
  return signals.some(s => s && (s.includes(exp) || exp.includes(s)));
}


// ========== Hallucination Hard-Stop (3.9.1) ==========
// Counts distinct "claim items" in a finish summary vs the actual evidence
// sources the agent collected (memory keys + note actions). When the claim
// density wildly outstrips evidence AND there are no "headline only / not
// read in this run" caveats, blocks the finish and forces the LLM to either
// trim the summary or tag unverified items explicitly.

const _UNVERIFIED_CAVEATS = /\b(headline only|not read in this run|not actually read|not yet read|could not (?:read|extract|verify)|unverified|extraction failed|skipped reading|did not read|not visited|not opened|listed by headline|based on headline)\b/i;

function _countSummaryClaims(summary) {
  if (!summary || typeof summary !== 'string') return 0;
  // Numbered list entries: "1. ", "2. ", etc., or "1) ", "## 1." style.
  const numbered = (summary.match(/^\s*(?:#+\s*)?\d+[.)]\s/gm) || []).length;
  // Markdown table rows (excluding header + separator)
  const tableRows = Math.max(0, (summary.match(/^\|[^\n]+\|\s*$/gm) || []).length - 2);
  // Top-level bullets
  const bullets = (summary.match(/^\s*[-*]\s/gm) || []).length;
  // Use the densest grouping signal as the claim count.
  return Math.max(numbered, tableRows, bullets);
}

function _countEvidenceSources(agentMemory, history) {
  let count = 0;
  try {
    count += Object.keys(agentMemory || {}).length;
    if (Array.isArray(history)) {
      // Count notes in a single pass
      const noteCount = history.reduce((acc, h) => acc + (h && h.action && h.action.type === 'note' ? 1 : 0), 0);
      count += noteCount;
    }
  } catch (_e) {
    // Context data read failed non-fatally
  }
  return count;
}

// (3.10.0) Patterns for "specific claims" that should be tagged with [src:*].
const _SPECIFIC_CLAIM_RES = [
  /\b\d[\d,]{3,}\b/g,                       // 1,234 / 110,000 / 271000
  /\b\d+(?:\.\d+)?%/g,                       // 47% / 15.5%
  /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[KMB]|million|billion|thousand)?\b/gi, // $5M / $12,345
  /\b\d{4}-\d{2}-\d{2}\b/g,                 // ISO dates
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\b/g
];
function _countSpecificClaims(summary) {
  if (!summary) return 0;
  let total = 0;
  for (const re of _SPECIFIC_CLAIM_RES) {
    const matches = summary.match(re);
    if (matches) total += matches.length;
  }
  return total;
}
function _countSourceTags(summary) {
  if (!summary) return 0;
  const matches = summary.match(/\[src:[a-z0-9_-]+\]/gi) || [];
  const unverified = summary.match(/\[unverified\]/gi) || [];
  return matches.length + unverified.length;
}

function evaluateHallucinationRisk(summary, agentMemory, history) {
  const claims = _countSummaryClaims(summary);
  const evidence = _countEvidenceSources(agentMemory, history);
  const hasCaveats = _UNVERIFIED_CAVEATS.test(summary || '');
  const specificClaims = _countSpecificClaims(summary);
  const sourceTags = _countSourceTags(summary);

  // 3+ claims with 0 evidence is a clear fabrication.
  if (claims >= 3 && evidence === 0) {
    return { risky: true, reason: `Summary lists ${claims} items but no data was extracted to memory or recorded as notes.` };
  }
  // claims > 2x evidence with no caveats is suspicious.
  if (claims >= 4 && evidence > 0 && claims > evidence * 2 && !hasCaveats) {
    return { risky: true, reason: `Summary lists ${claims} items but only ${evidence} evidence sources (memory keys + notes) and no "headline only / not read" caveats.` };
  }
  // (3.10.0) Lots of specific numeric/date claims with no [src:*] tags
  if (specificClaims >= 5 && sourceTags === 0) {
    return { risky: true, reason: `Summary contains ${specificClaims} specific claims (numbers, dates, statistics) but no [src:memory_key] citations. Per the SOURCE-CITED OUTPUTS rule, every specific claim must be tagged.` };
  }
  // Specific claims wildly outnumber tags
  if (specificClaims >= 8 && sourceTags > 0 && specificClaims > sourceTags * 3) {
    return { risky: true, reason: `Summary has ${specificClaims} specific claims but only ${sourceTags} source tags. Tag each specific claim with [src:memory_key] or move it to a Caveats section as [unverified].` };
  }
  return { risky: false, claims, evidence, hasCaveats, specificClaims, sourceTags };
}

// ========== MFA Challenge Detection (3.7.0) ==========
// Many M365 / Entra / firewall login flows fire a step-up auth prompt
// (verification code, push notification, authenticator app). Without this
// detection the agent loops uselessly on the auth page until step-limit.
// We scan freshly read pageText for a panel of known MFA cues; on match,
// pause the agent, fire a desktop notification, and post a chat banner with
// a Resume button. The user resolves the challenge in the page, then clicks
// Resume.

// (3.12.0) Confidence-based MFA detection. The previous flat regex array
// false-positived on retail/checkout pages (coupon code fields, security
// product descriptions, news articles mentioning two-factor). Real MFA
// pages have stacked evidence: auth-provider URL + step-up language +
// short-input field. Match scheme:
//   1. Tier-1 cue alone (specific to MFA flows) -> fire
//   2. Auth-provider URL + ANY tier-2 cue -> fire
//   3. 2+ tier-2 cues on same page -> fire
//   4. Otherwise -> no fire
// Domain exclusion list short-circuits known non-MFA contexts.

const MFA_TIER1_PATTERNS = [
  /approve\s+(?:the\s+|this\s+)?sign.?in\s+request/i,
  /we'?ve\s+sent\s+(?:a\s+|an\s+)?(?:verification\s+)?code\s+to/i,
  /open\s+your\s+authenticator\s+app/i,
  /tap\s+the\s+number\s+you\s+see/i,         // Microsoft number-matching MFA
  /\bduo\s+(?:push|prompt|mobile)\b/i,
  /\bpush\s+(?:notification|approval)\s+sent\b/i,
  /enter\s+the\s+(?:verification\s+|security\s+)?code\s+(?:from|sent\s+to)/i,
  /\bwaiting\s+for\s+approval\b/i,
  /security\s+key\s+(?:plugged\s+in|connected|inserted)/i
];

const MFA_TIER2_PATTERNS = [
  /verify\s+your\s+identity/i,
  /two.?factor\s+(?:authentication|verification)/i,
  /multi.?factor\s+authentication/i,
  /authenticator\s+app/i,
  /one.?time\s+(?:passcode|password|code)/i,
  /\bOTP\b/,
  /6.?digit\s+(?:code|number|verification)/i,
  /check\s+your\s+phone/i,
  /enter\s+(?:the\s+)?verification\s+code/i,
  /verification\s+code\s+(?:was\s+)?sent/i
];

const MFA_AUTH_URL_PATTERNS = [
  /login\.microsoftonline\.com/i,
  /login\.live\.com/i,
  /accounts\.google\.com/i,
  /login\.okta\.com/i,
  /\.okta\.com\/(?:signin|verify|mfa)/i,
  /\.duosecurity\.com/i,
  /sts\.[a-z0-9.-]+\.(com|net|org)/i,
  /\/(?:mfa|2fa|otp|challenge|verify|signin|sign-in)(?:[/?#]|$)/i,
  /auth\.[a-z0-9.-]+\.(com|net|org)/i
];

// Pages that should NEVER fire MFA, even with weak text cues. Stops
// shopping / news / social sites from tripping the detector.
const MFA_EXCLUDE_DOMAINS = [
  /amazon\.[a-z.]+\/(?:s|gp|dp|product|cart|checkout)/i,
  /ebay\.[a-z.]+\/(?:itm|sch|str)/i,
  /walmart\.com\/(?:ip|search|cart)/i,
  /target\.com\/(?:p|s|c)/i,
  /bestbuy\.com\/(?:site|cart)/i,
  /apple\.com\/shop/i,
  /bhphotovideo\.com\/c/i,
  /newegg\.com\/p/i,
  /github\.com\/[^/]+\/[^/]+(?:\/|$)/i,    // GitHub repos
  /\/blog\//i,
  /\/news\//i,
  /\/article\//i,
  /\/(?:product|products|shop|store|cart|checkout)\//i,
  /(?:youtube|youtu\.be|twitter|x\.com|reddit|linkedin|facebook|instagram|tiktok)\.com/i
];

function detectMfaInText(text, currentUrl) {
  if (!text || typeof text !== 'string') return null;
  const url = (currentUrl || '').toLowerCase();

  // Hard exclude known non-MFA contexts -- protects against shopping /
  // news / social pages with random "verify" or "two-factor" text.
  for (const re of MFA_EXCLUDE_DOMAINS) {
    if (re.test(url)) return null;
  }

  const sample = text.substring(0, 5000);

  // Tier 1: any single match fires.
  for (const re of MFA_TIER1_PATTERNS) {
    const m = sample.match(re);
    if (m) return m[0];
  }

  const isAuthUrl = MFA_AUTH_URL_PATTERNS.some(re => re.test(url));

  // Tier 2: collect matches, decide based on count + URL.
  const tier2Hits = [];
  for (const re of MFA_TIER2_PATTERNS) {
    const m = sample.match(re);
    if (m) tier2Hits.push(m[0]);
  }

  // Auth URL + any tier-2 cue -> fire.
  if (isAuthUrl && tier2Hits.length) return tier2Hits[0];

  // Multiple tier-2 cues on same page -> fire (covers MFA flows on
  // less-common auth domains).
  if (tier2Hits.length >= 2) return tier2Hits[0];

  return null;
}

// ========== Sign-In Wall Detection (3.14.1) ==========
// Detects authentication walls (username/password forms) BEFORE the LLM tries
// to drive past them. Different from MFA detection: MFA fires AFTER credentials
// have been entered. Sign-in wall fires when we hit the login page at all and
// have no way to enter the user's password (the runtime password-field block in
// content/index.js already prevents auto-fill).
//
// Trigger requires BOTH signals to be true:
//   1. URL matches a known auth host
//   2. Page has at least one visible password input in the observation
// This guards against false positives on post-auth redirect pages that
// briefly pass through login.microsoftonline.com without showing a form.

const SIGN_IN_WALL_HOSTS_RE = /(login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|accounts\.google\.com|accounts\.youtube\.com|login\.okta\.com|[^.]+\.okta\.com|[^.]+\.oktapreview\.com|auth0\.com|[^.]+\.auth0\.com|signin\.aws\.amazon\.com|github\.com\/login|gitlab\.com\/users\/sign_in|bitbucket\.org\/account\/signin|login\.salesforce\.com|[^.]+\.my\.salesforce\.com|signin\.intuit\.com|login\.duosecurity\.com|connect\.secureauth\.com|adfs\..+|sts\..+)/i;

const SIGN_IN_WALL_TEXT_RE = /\b(sign\s*in|log\s*in|enter\s+your\s+(?:password|email)|use\s+your\s+microsoft\s+account|stay\s+signed\s+in)\b/i;

// Returns { matched: true, host, evidence } when a sign-in wall is detected,
// or null. Evidence describes WHY we matched (URL + password-field selector


// ========== CAPTCHA / Bot Detection (v3.65) ==========
const CAPTCHA_URL_PATTERNS = [
  /validateCaptcha/i,
  /\/captcha[/?#]/i,
  /\/challenge[/?#]/i,
  /\/bot-detect/i,
  /\/verify[/?#]/i,
  /captcha\./i,
  /recaptcha/i,
  /hcaptcha/i,
  /turnstile/i,
  /cf-chl/i,
  /\/errors\//i,        // Amazon /errors/ pages
  /blocked/i,
  /\/access.denied/i,
  /\/security.check/i,
];

const CAPTCHA_TEXT_PATTERNS = [
  /verify.{0,10}(you are|you.re).{0,5}human/i,
  /not.a.robot/i,
  /prove.{0,10}(you are|you.re).{0,5}human/i,
  /are you a robot/i,
  /complete.the.security/i,
  /enter.the.characters/i,
  /type.the.characters/i,
  /solve.this.puzzle/i,
  /please.complete.this/i,
  /sorry.{0,20}interrupt/i,
  /automated.access/i,
  /bot.detect/i,
  /unusual.traffic/i,
  /our.systems.have.detected/i,
  /sorry.we.just.need/i,
  /checking.your.browser/i,
  /before.we.proceed/i,
  /human.verification/i,
  /are.you.human/i,
];

const CAPTCHA_HOST_MAP = {
  'amazon': { altUrl: 'https://www.amazon.com', searchPath: '/s?k=' },
  'google': { altUrl: 'https://www.google.com', searchPath: '/search?q=' },
  'reddit': { altUrl: 'https://www.reddit.com', searchPath: '/search/?q=' },
};

function detectCaptcha(currentUrl, pageText, elementsCount) {
  if (!currentUrl) return null;
  
  // URL-based detection
  const urlHit = CAPTCHA_URL_PATTERNS.find(p => p.test(currentUrl));
  if (urlHit) {
    // Also check if page text confirms it
    const textHit = pageText && CAPTCHA_TEXT_PATTERNS.find(p => p.test(pageText));
    // Low element count on a flagged URL is strong signal
    const lowElements = elementsCount !== undefined && elementsCount <= 5;
    return {
      matched: true,
      type: 'captcha_url',
      url: currentUrl,
      pattern: urlHit.source,
      textConfirm: !!textHit,
      lowElements: !!lowElements,
      confidence: (textHit ? 0.9 : 0.0) + (lowElements ? 0.1 : 0.0)
    };
  }
  
  // Content-based detection (only if strong signal)
  if (pageText) {
    const textHit = CAPTCHA_TEXT_PATTERNS.find(p => p.test(pageText));
    if (textHit && elementsCount !== undefined && elementsCount <= 10) {
      return {
        matched: true,
        type: 'captcha_text',
        url: currentUrl,
        pattern: textHit.source,
        textConfirm: true,
        lowElements: elementsCount <= 5,
        confidence: 0.85
      };
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// (v3.69) Smart Recovery Engine — "MacGyver Mode"
// When stuck, analyzes page + goal and generates creative solutions.
// Can construct URLs, suggest execute_js, find alternative approaches.
// ═══════════════════════════════════════════════════════════════════
function _generateSmartRecovery(goal, currentUrl, pageText, _observation, _history, _stepCount) {
  var strategies = [];
  var url = currentUrl || '';
  var text = pageText || '';

  // URL manipulation strategies
  if (/amazon/i.test(url)) {
    if (/\/s\?/i.test(url)) {
      if (!/s=review-rank/.test(url)) strategies.push('Sort by rating: add "&s=review-rank" to URL via smart_navigate');
      if (!/s=price-asc-rank/.test(url)) strategies.push('Sort by price: add "&s=price-asc-rank" to URL via smart_navigate');
      if (!/s=date-desc-rank/.test(url)) strategies.push('Sort by newest: add "&s=date-desc-rank" to URL via smart_navigate');
    }
    strategies.push('Extract products via execute_js: document.querySelectorAll(".s-result-item") for title/price/rating/link');
  }
  if (/reddit/i.test(url)) {
    strategies.push('Extract posts via execute_js: document.querySelectorAll("[data-testid=\\"post-container\\"]")');
    if (/search/i.test(url)) strategies.push('Add "&sort=top" or "&sort=relevance" to URL');
  }
  if (/google/i.test(url) && /search/i.test(url)) {
    strategies.push('Extract results via execute_js: document.querySelectorAll(".g") for title/link/snippet');
  }
  if (/youtube/i.test(url)) {
    strategies.push('Extract videos via execute_js: document.querySelectorAll("ytd-video-renderer")');
  }
  if (/cnn|bbc|nytimes|reuters/i.test(url)) {
    strategies.push('Extract articles via execute_js: document.querySelectorAll("article, h2, h3, [class*=headline]")');
  }

  // Goal-based strategies
  if (/top \d|find.*\d|list.*\d|best/i.test(goal)) {
    strategies.push('Use execute_js to extract all matching items from the page in one shot');
  }
  if (/then go to|also check|compare/i.test(goal)) {
    strategies.push('Use navigate with direct URL instead of clicking through pages');
  }

  // Direct URL construction for multi-site goals
  var siteUrls = {
    amazon: 'amazon.com/s?k=',
    reddit: 'reddit.com/search/?q=',
    youtube: 'youtube.com/results?search_query=',
    google: 'google.com/search?q='
  };
  var goalLower = typeof goal === 'string' ? goal.toLowerCase() : '';
  var urlLower = typeof url === 'string' ? url.toLowerCase() : '';
  for (const [site, siteUrl] of Object.entries(siteUrls)) {
    if (goalLower.includes(site) && !urlLower.includes(site)) {
      var qm = goal.match(/(?:search|find|look).{0,5}(?:for|about|on)\s+([^,.]+)/i);
      if (qm && qm[1]) {
        strategies.push(`Navigate directly to https://www.${siteUrl}${encodeURIComponent(typeof qm[1] === 'string' ? qm[1].trim() : '')}`);
      }
    }
  }

  // Fallback strategies
  if (text.length > 1000) {
    strategies.push('Read the page text — you may already have enough data');
  }
  if (!strategies.length) {
    strategies.push('Use execute_js to inspect DOM and find alternative approach');
    strategies.push('Try read_page to get full content and extract what you need');
    strategies.push('Use navigate_back and try a different path');
  }

  return strategies;
}


// ═══════════════════════════════════════════════════════════════════
// (v3.69) Universal CDP Fallback Engine — "Nothing Stops the Agent"
// When content script is dead AND per-action CDP fallbacks fail,
// this translates ANY action into equivalent JavaScript via CDP.
// Includes fuzzy selector resolution (by text, aria, role, class).
// ═══════════════════════════════════════════════════════════════════
async function _universalCdpFallback(tab, cmd, opts) {
  var timeout = (opts && opts.timeout) || 5000;
  var sel = cmd.selector || (cmd.ref ? cmd.ref.replace(/^ref_/, '#') : '') || '';
  var textHint = cmd.text || cmd.value || '';
  
  // Build the fuzzy element finder as a self-contained JS string
  // This gets embedded into each action's JS code
  var finderCode = '(function(){'
    + `var _s=${JSON.stringify(sel)},_t=${JSON.stringify(textHint)};`
    + 'var el=null;'
    + 'try{el=document.querySelector(_s)}catch(e){}'
    + 'if(el&&el.offsetParent!==null)return el;'
    + 'if(_t){'
    +   'var _tl=_t.toLowerCase();'
    +   'var _cands=document.querySelectorAll("button,a,input,select,[role=button],[role=link],span,div");'
    +   'for(var i=0;i<_cands.length;i++){'
    +     'if(_cands[i].textContent&&_cands[i].textContent.trim().toLowerCase().indexOf(_tl)>=0&&_cands[i].offsetParent!==null)return _cands[i]'
    +   '}'
    + '}'
    + 'if(_s){'
    +   'var _parts=_s.replace(/[.#\\[\\]]/g," ").trim().split(/\\s+/);'
    +   'for(var p=0;p<_parts.length;p++){'
    +     'if(_parts[p].length>3){'
    +       'var _w=document.querySelectorAll("[class*="+_parts[p]+"],[id*="+_parts[p]+"]");'
    +       'for(var w=0;w<_w.length;w++){if(_w[w].offsetParent!==null)return _w[w]}'
    +     '}'
    +   '}'
    + '}'
    + 'return null'
    + '})()';

  var jsCode = '';
  
  switch (cmd.type) {
    case 'click':
    case 'double_click':
    case 'right_click': {
      var btn = cmd.type === 'right_click' ? '2' : '0';
      var detail = cmd.type === 'double_click' ? '2' : '1';
      jsCode = '(function(){'
        + `var el=${finderCode};`
        + 'if(!el)return JSON.stringify({ok:false,error:"not found"});'
        + 'el.scrollIntoView({block:"center",behavior:"instant"});'
        + `el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,button:${btn},detail:${detail}}));`
        + 'if(typeof el.click==="function")try{el.click()}catch(e){}'
        + 'return JSON.stringify({ok:true,result:"clicked "+el.tagName});'
        + '})()';
      break;
    }
    case 'type': {
      var safeText = escapeJsString(cmd.text || '', '"');
      jsCode = '(function(){'
        + `var el=${finderCode};`
        + 'if(!el)return JSON.stringify({ok:false,error:"input not found"});'
        + 'el.scrollIntoView({block:"center",behavior:"instant"});'
        + 'el.focus();'
        + 'var _s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value");'
        + `if(_s)_s.set.call(el,"${safeText}");else el.value="${safeText}";`
        + 'el.dispatchEvent(new Event("input",{bubbles:true}));'
        + 'el.dispatchEvent(new Event("change",{bubbles:true}));'
        + `return JSON.stringify({ok:true,result:"typed ${safeText.length} chars"});`
        + '})()';
      break;
    }
    case 'select': {
      var safeVal = escapeJsString(cmd.value || '', '"');
      jsCode = '(function(){'
        + `var el=${finderCode};`
        + 'if(!el)return JSON.stringify({ok:false,error:"select not found"});'
        // Native select
        + 'if(el.tagName==="SELECT"&&el.options){'
        +   'for(var i=0;i<el.options.length;i++){'
        +     `if(el.options[i].value==="${safeVal}"||el.options[i].text.trim().toLowerCase()==="${safeVal.toLowerCase()}"){`
        +       'el.selectedIndex=i;el.value=el.options[i].value;'
        +       'el.dispatchEvent(new Event("change",{bubbles:true}));'
        +       `return JSON.stringify({ok:true,result:"selected ${safeVal}"})`
        +     '}'
        +   '}'
        + '}'
        // Custom dropdown - click to open, then find option
        + 'el.click();'
        + `var _vl="${safeVal}".toLowerCase();`
        + 'var _opts=document.querySelectorAll("[role=option],li,[data-value],.option,[class*=option],[class*=item]");'
        + 'for(var j=0;j<_opts.length;j++){'
        +   'if(_opts[j].textContent&&_opts[j].textContent.trim().toLowerCase().indexOf(_vl)>=0&&_opts[j].offsetParent!==null){'
        +     '_opts[j].click();'
        +     `return JSON.stringify({ok:true,result:"selected custom: ${safeVal}"})`
        +   '}'
        + '}'
        // Try aria listbox
        + 'var _lb=document.querySelector("[role=listbox]");'
        + 'if(_lb){var _li=_lb.querySelectorAll("[role=option]");for(var k=0;k<_li.length;k++){'
        +   `if(_li[k].textContent&&_li[k].textContent.trim().toLowerCase().indexOf(_vl)>=0){_li[k].click();return JSON.stringify({ok:true,result:"selected listbox: ${safeVal}"})}`
        + '}}'
        + `return JSON.stringify({ok:false,error:"option not found: ${safeVal}"});`
        + '})()';
      break;
    }
    case 'check':
    case 'check_all': {
      jsCode = `(function(){
        var el=${finderCode};
        if(!el)return JSON.stringify({ok:false,error:"checkbox not found"});
        if(el.type==="checkbox"||el.type==="radio"){el.checked=${cmd.checked !== false};el.dispatchEvent(new Event("change",{bubbles:true}));el.click();return JSON.stringify({ok:true,result:"${cmd.checked !== false ? 'checked' : 'unchecked'}"})}
        el.click();return JSON.stringify({ok:true,result:"toggled"})
      })()`;
      break;
    }
    case 'hover': {
      jsCode = `(function(){
        var el=${finderCode};
        if(!el)return JSON.stringify({ok:false,error:"hover target not found"});
        el.scrollIntoView({block:"center",behavior:"instant"});
        el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));
        el.dispatchEvent(new MouseEvent("mouseenter",{bubbles:true}));
        return JSON.stringify({ok:true,result:"hovered"})
      })()`;
      break;
    }
    case 'scroll_to': {
      jsCode = `(function(){
        var el=${finderCode};
        if(el){el.scrollIntoView({block:"center",behavior:"instant"});return JSON.stringify({ok:true,result:"scrolled to element"})}
        window.scrollBy(0,window.innerHeight*0.8);
        return JSON.stringify({ok:true,result:"scrolled down"})
      })()`;
      break;
    }
    case 'wait_for_element':
    case 'wait_for_text': {
      var searchFor = cmd.text || cmd.value || cmd.selector || '';
      jsCode = `(function(){
        var body=(document.body&&document.body.innerText)||"";
        var _s=${JSON.stringify(searchFor)};
        if(_s&&body.indexOf(_s)>=0)return JSON.stringify({ok:true,result:"found"});
        if(_s&&body.toLowerCase().indexOf(_s.toLowerCase())>=0)return JSON.stringify({ok:true,result:"found case-insensitive"});
        // Also try finding by selector
        var _el=document.querySelector(${JSON.stringify(cmd.selector || '')});
        if(_el&&_el.offsetParent!==null)return JSON.stringify({ok:true,result:"element visible"});
        return JSON.stringify({ok:false,error:"not found: "+(typeof _s==="string"?_s:String(_s)).slice(0,50)})
      })()`;
      break;
    }
    case 'extract':
    case 'extract_list': {
      jsCode = `(function(){
        var sel=${JSON.stringify(cmd.selector || '')};
        if(sel){var els=document.querySelectorAll(sel);if(els.length){
          var items=[];for(var i=0;i<els.length;i++){var el=els[i];if(el&&el.textContent)items.push(el.textContent.trim().slice(0,200));}
          return JSON.stringify({ok:true,result:"extracted "+items.length,value:items})
        }}
        return JSON.stringify({ok:false,error:"nothing to extract"})
      })()`;
      break;
    }
    case 'verify': {
      jsCode = `(function(){
        var body=(document.body&&document.body.innerText)||"";
        var _c=${JSON.stringify(cmd.text || cmd.value || '')};
        if(_c&&body.indexOf(_c)>=0)return JSON.stringify({ok:true,result:"verified"});
        if(_c&&body.toLowerCase().indexOf(_c.toLowerCase())>=0)return JSON.stringify({ok:true,result:"verified case-insensitive"});
        return JSON.stringify({ok:false,error:"verification failed"})
      })()`;
      break;
    }
    default: {
      if (sel) {
        jsCode = `(function(){
          var el=${finderCode};
          if(!el)return JSON.stringify({ok:false,error:"not found for ${cmd.type}"});
          el.scrollIntoView({block:"center",behavior:"instant"});
          el.click();
          return JSON.stringify({ok:true,result:"generic fallback clicked for ${cmd.type}"})
        })()`;
      }
      break;
    }
  }
  
  if (!jsCode) return { ok: false, result: `No UFB for: ${cmd.type}` };

  var ufbRes = await cdpExecuteJs(tab, `return ${jsCode}`, { timeout: timeout });
  if (ufbRes && ufbRes.ok && ufbRes.value != null) {
    try {
      var parsed = typeof ufbRes.value === 'string' ? JSON.parse(ufbRes.value) : ufbRes.value;
      if (!parsed || typeof parsed !== 'object' || parsed === null) return { ok: true, result: String(parsed != null ? parsed : 'UFB done') };
      return { ok: parsed.ok !== false, result: parsed.result || parsed.error || 'UFB done', value: parsed.value };
    } catch(_e) {
      return { ok: true, result: String(ufbRes.value).slice(0, 200) };
    }
  }
  return { ok: false, result: 'UFB returned no result' };
}


async function recoverFromCaptcha(tab, captchaInfo, currentUrl, goal, stepCount = 0) {
  console.log('[Sentinel/CAPTCHA] Detected:', captchaInfo.type, 'url:', currentUrl);
  
  // Strategy 1: Try to click CAPTCHA checkbox/button via CDP
  try {
    const clickCode = `
      // reCAPTCHA checkbox
      const rcFrame = document.querySelector('iframe[src*="recaptcha"]');
      if (rcFrame) {
        const rcDoc = rcFrame.contentDocument || rcFrame.contentWindow.document;
        const cb = rcDoc && rcDoc.querySelector('.recaptcha-checkbox');
        if (cb) { cb.click(); return 'recaptcha_clicked'; }
      }
      // hCaptcha checkbox  
      const hcFrame = document.querySelector('iframe[src*="hcaptcha"]');
      if (hcFrame) {
        const hcDoc = hcFrame.contentDocument || hcFrame.contentWindow.document;
        const cb = hcDoc && hcDoc.querySelector('#checkbox');
        if (cb) { cb.click(); return 'hcaptcha_clicked'; }
      }
      // Cloudflare Turnstile
      const cfChk = document.querySelector('.cf-turnstile input, [name="cf-turnstile-response"]');
      if (cfChk) { cfChk.click(); return 'turnstile_clicked'; }
      // Generic checkbox
      const chk = document.querySelector('input[type="checkbox"]');
      if (chk && document.body && document.body.innerText && document.body.innerText.length < 500) { chk.click(); return 'generic_checkbox'; }
      // Amazon CAPTCHA - try the input field
      const amzInput = document.querySelector('#captchacharacters');
      if (amzInput) return 'amazon_captcha_needs_input';
      return null;
    `;
    const result = await cdpExecuteJs(tab.id, clickCode, { timeout: 3000 });
    const clickedWhat = (result && result.ok) ? result.value : null;
    if (clickedWhat && clickedWhat !== 'null' && clickedWhat !== 'amazon_captcha_needs_input') {
      console.log('[Sentinel/CAPTCHA] Auto-solved:', clickedWhat);
      sendSilentUpdate(`🤖 CAPTCHA auto-solved (${clickedWhat})`, stepCount);
      try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      await sleep(2000); // wait for page to process
      return 'solved';
    }
  } catch (e) {
    console.warn('[Sentinel/CAPTCHA] Auto-solve attempt failed:', getErrorMessage(e));
  }
  
  // Strategy 2: Navigate to an alternative URL for the same site
  let host;
  try { host = new URL(currentUrl).hostname.replace(/^www\./, ''); } catch (_urlErr) { host = ''; }
  
  for (const [key, info] of Object.entries(CAPTCHA_HOST_MAP)) {
    if (host.includes(key) && goal) {
      // Try to extract search query from goal and go directly to search results
      const searchMatch = goal.match(/(?:search|find|look)\s+(?:for\s+)?["']?([^"']{3,60})/i);
      if (searchMatch && info.searchPath && searchMatch[1]) {
        const searchUrl = info.altUrl + info.searchPath + encodeURIComponent(searchMatch[1]);
        console.log('[Sentinel/CAPTCHA] Navigating around CAPTCHA to:', searchUrl);
        sendSilentUpdate('🔄 Bypassing CAPTCHA via direct search URL', stepCount);
        try {
          await chrome.tabs.update(tab.id, { url: searchUrl });
          try { tel.trace('sleep', 'Sleep 3000ms', { ms: 3000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          await sleep(3000);
        } catch (_navErr) {
          console.warn('[Sentinel/CAPTCHA] Navigate to search URL failed:', getErrorMessage(_navErr));
        }
        return 'bypassed';
      }
      // No search query - just go to homepage
      console.log('[Sentinel/CAPTCHA] Navigating to homepage:', info.altUrl);
      sendSilentUpdate('🔄 Bypassing CAPTCHA via homepage', stepCount);
      try {
        await chrome.tabs.update(tab.id, { url: info.altUrl });
        try { tel.trace('sleep', 'Sleep 3000ms', { ms: 3000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
        await sleep(3000);
      } catch (_navErr) {
        console.warn('[Sentinel/CAPTCHA] Navigate to homepage failed:', getErrorMessage(_navErr));
      }
      return 'bypassed';
    }
  }
  
  // Strategy 3: Go back and try again
  try {
    console.log('[Sentinel/CAPTCHA] Going back to previous page');
    sendSilentUpdate('⬅️ CAPTCHA detected, going back', stepCount);
    await chrome.tabs.goBack(tab.id);
    try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
    await sleep(2000);
    return 'went_back';
  } catch (e) {
    console.warn('[Sentinel/CAPTCHA] Go back failed:', getErrorMessage(e));
  }
  
  // Strategy 4: Pause for user
  return 'needs_user';
}



// or text cue) so the banner can show useful context.
function detectSignInWall(allElements, currentUrl, pageText) {
  if (!currentUrl) return null;
  let host;
  try { host = new URL(currentUrl).host; } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); return null; }
  if (!SIGN_IN_WALL_HOSTS_RE.test(host) && !SIGN_IN_WALL_HOSTS_RE.test(currentUrl)) return null;

  // Signal 1: a password input is present in the observed elements
  let pwField = null;
  if (Array.isArray(allElements)) {
    pwField = allElements.find(e => {
      if (!e) return false;
      if (e.type === 'password') return true;
      const sel = String(e.selector || '').toLowerCase();
      if (/passw(or)?d|passwordinput/i.test(sel)) return true;
      return false;
    });
  }
  if (pwField) {
    return { matched: true, host, evidence: `password input on ${host}`, selector: pwField.selector || '' };
  }

  // Signal 2 (fallback): page text contains sign-in cues AND we're on a known auth host
  // This catches the brief username-only first step before the password field renders
  // (Microsoft's two-step sign-in: email page → password page).
  if (pageText && SIGN_IN_WALL_TEXT_RE.test(pageText)) {
    // Require a username/email input to be present so we don't trip on
    // post-auth redirect screens that say "Stay signed in?" without a form.
    if (Array.isArray(allElements)) {
      const emailField = allElements.find(e => {
        if (!e) return false;
        if (e.type === 'email') return true;
        const sel = String(e.selector || '').toLowerCase();
        return /(email|username|loginfmt|user_?id|user_?name|signin)/i.test(sel);
      });
      if (emailField) {
        return { matched: true, host, evidence: `email/username input on ${host}`, selector: emailField.selector || '' };
      }
    }
  }

  return null;
}

// ========== v3.13.0 Auto-Recovery Helpers ==========
// Engine-side reliability layer. The LLM is good at "what's the next step";
// it's bad at "did my code actually work, and what should I try instead".
// These helpers move retry/recovery decisions OUT of the LLM and INTO the
// engine, which means: fewer wasted steps, fewer hallucinations from
// retry-go-wrong, and the LLM can focus on planning vs. error handling.

/**
 * Detect whether a raw JS-result string is unproductive (empty, error,
 * non-serializable, parsed-but-empty). Used by the retry ladder and by
 * memory hygiene at write time. Single source of truth for "this didn't work".
 */
function _isUnproductiveJsResult(raw) {
  if (raw == null) return true;
  if (typeof raw !== 'string') raw = String(raw);
  if (raw === '' || raw === 'Done') return true;
  if (raw.startsWith('JS Error:')) return true;
  if (raw.startsWith('Code execution timed out')) return true;
  if (raw.startsWith('Execution error')) return true;

  let val = raw;
  if (raw.startsWith('JS Result: ')) val = raw.substring(11);
  const trim = val.trim();

  if (trim.length < 5) return true;
  if (trim === 'undefined' || trim === 'null') return true;
  if (/^\s*\[object\s+\w+\]\s*$/i.test(trim)) return true;

  // Parsed-but-empty check
  try {
    const p = JSON.parse(trim);
    if (p === null) return true;
    if (Array.isArray(p) && !p.length) return true;
    if (typeof p === 'object' && p !== null && !Object.keys(p).length) return true;
  } catch (_) { /* not JSON, that's fine */ }

  return false;
}

/**
 * Run a single execute_js attempt via CDP first, falling back to content
 * script if CDP attach is denied (chrome:// pages, devtools, etc.).
 * Returns the raw "JS Result: ..." string or an error string.
 */
async function _runExecuteJsOnce(tabId, code, timeout) {
  // CDP path (preferred -- bypasses page CSP)
  try {
    const cdpResult = await cdpExecuteJs(tabId, code, { timeout });
    if (cdpResult && cdpResult.ok) {
      const valStr = cdpResult.value === undefined || cdpResult.value === null
        ? ''
        : (typeof cdpResult.value === 'object'
            ? JSON.stringify(cdpResult.value).slice(0, 3000)
            : String(cdpResult.value).slice(0, 3000));
      return `JS Result: ${valStr}`;
    } else if (cdpResult && cdpResult.attachDenied) {
      // Fall through to content-script path
    } else if (cdpResult && cdpResult.error) {
      // Fall through too -- content script may succeed where CDP errored
    }
  } catch (_) { /* fall through */ }

  // Content-script path (fallback for chrome:// or CDP-failed sites)
  try {
    const csRes = await sendMessageWithRetry(tabId, {
      action: 'execute_command',
      command: { type: 'execute_js', code, timeout }
    });
    return csRes || 'Done';
  } catch (e) {
    return `JS Error: ${getErrorMessage(e)}`;
  }
}

/**
 * Auto-recovery retry ladder for execute_js. Tries the LLM's original code
 * first; if that returns unproductive (empty / null / [object Object] /
 * non-serializable), automatically retries with progressively more
 * conservative strategies. The LLM is NEVER asked to choose between these --
 * the engine handles it mechanically.
 *
 * Strategies (in order):
 *   1. original   -- LLM's intended code
 *   2. body_text  -- document.body.innerText (covers null-query and
 *                    selector-miss cases; LLM can parse text in finish)
 *   3. visible    -- aggregated innerText from all common visible
 *                    elements (covers SPA pages where body.innerText
 *                    misses lazy-rendered children)
 *
 * Returns { raw, strategy }. raw is the same shape the rest of the
 * pipeline expects; strategy is for logging / forensic run log.
 */
async function _runExecuteJsWithRetryLadder(tabId, originalCode, timeout) {
  // Strategy 1: LLM's original code
  let raw = await _runExecuteJsOnce(tabId, originalCode || '', timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'original' };
  }

  // Strategy 2: body.innerText fallback (covers most LLM-extraction failures)
  const FB_BODY_TEXT = 'return (document.body && document.body.innerText) ? document.body.innerText.substring(0, 8000) : "";';
  raw = await _runExecuteJsOnce(tabId, FB_BODY_TEXT, timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'body_text_fallback' };
  }

  // Strategy 3: aggregate visible-element text (SPA-heavy sites where
  // body.innerText returns just the loading state)
  const FB_VISIBLE = "return Array.from(document.querySelectorAll('h1,h2,h3,h4,p,td,li,a,span,div')).map(e => (e.innerText || '').trim()).filter(t => t && t.length > 3).slice(0, 300).join('\\n').substring(0, 8000);";
  raw = await _runExecuteJsOnce(tabId, FB_VISIBLE, timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'visible_text_fallback' };
  }

  return { raw, strategy: 'all_failed' };
}

/**
 * Memory-hygiene gate: should this candidate value be written to agentMemory?
 * Returns { ok: bool, reason: string }. Reasons help debug / log why a write
 * was rejected. Run BEFORE writing -- prevents garbage from polluting future
 * prompts and the report-generator's memory summary.
 */
function _shouldAcceptMemoryWrite(key, candidateValue, agentMemory) {
  if (!key || typeof key !== 'string') return { ok: false, reason: 'empty key' };
  if (candidateValue == null) return { ok: false, reason: 'null/undefined value' };

  const valStr = typeof candidateValue === 'string'
    ? candidateValue
    : (Array.isArray(candidateValue) || typeof candidateValue === 'object'
        ? JSON.stringify(candidateValue)
        : String(candidateValue));

  if (valStr.length < 10) return { ok: false, reason: 'value too short' };

  // Reject error-shaped strings
  if (/^(JS Error|Execution error|Code execution timed out|Element not found|JS execution failed)/i.test(valStr.trim())) {
    return { ok: false, reason: 'error-shaped value' };
  }

  // Reject [object Foo] strings
  if (/^\s*\[object\s+\w+\]\s*$/i.test(valStr.trim())) {
    return { ok: false, reason: 'non-serialized object' };
  }

  // Reject duplicates -- if an existing memory key has the EXACT same value,
  // overwriting it is meaningless and clutters the prompt.
  for (const [existingKey, ev] of Object.entries(agentMemory || {})) {
    if (existingKey === key) continue;
    const evStr = typeof ev === 'string' ? ev : JSON.stringify(ev);
    if (evStr === valStr) {
      return { ok: false, reason: `duplicates existing key ${existingKey}` };
    }
  }

  return { ok: true, reason: '' };
}

/**
 * (3.13.0) Pre-finish data-completeness check. Parse the goal text for
 * data fields the user asked for ("extract X, Y, Z for each item"), then
 * verify memory has plausible data for each. Returns null if everything's
 * present, or a string describing the gap so we can block the finish and
 * push the LLM to extract the missing piece.
 *
 * Heuristic, not authoritative -- false positives only delay finish by
 * one step, which is cheap. False negatives let a sparse report through,
 * which is the existing v3.10 hallucination gate's job. This adds a
 * complementary "did you actually get what was asked for" pass.
 */
function _checkPreFinishCompleteness(goal, agentMemory, history) {
  if (!goal || typeof goal !== 'string') return null;
  if (!agentMemory || typeof agentMemory !== 'object' || agentMemory === null) return null;
  if (!Array.isArray(history)) history = [];

  const memorySerialized = JSON.stringify(agentMemory).toLowerCase();
  const noteText = history
    .filter(h => h && h.action && h.action.type === 'note' && h.action.text)
    .map(h => String(h.action.text).toLowerCase())
    .join(' ');
  const allEvidence = `${memorySerialized} ${noteText}`;

  // Patterns we care about: "extract X" / "give me X" / "find X" + commas
  // For each: the CVE ID, CVSS v3 base score, affected FortiOS versions, ...
  const fieldListMatch = goal.match(/(?:extract|find|pull|give\s+me|return)[^.]*?:\s*([^.\n]+)/i);
  if (!fieldListMatch || !fieldListMatch[1]) return null;

  const fieldList = fieldListMatch[1];
  // Split on commas / "and" / "&" -- get individual field names
  const rawFields = fieldList.split(/[,]|\s+and\s+|\s+&\s+/i)
    .map(f => f.trim().replace(/^the\s+|\.$/gi, ''))
    .filter(f => f.length > 3 && f.length < 60);

  if (rawFields.length < 2) return null;  // not a structured field list

  // For each requested field, check whether ANY token from it appears in
  // memory or notes. This is a deliberately loose heuristic.
  const missing = [];
  for (const field of rawFields) {
    // Pull "key" tokens from the field name (skip filler words)
    const tokens = typeof field === 'string' ? field.toLowerCase().split(/\s+/).filter(t => t.length > 3 && !FILLER_WORDS.has(t)) : [];
    if (!tokens.length) continue;
    // Match if ANY meaningful token from this field shows up in evidence
    const found = typeof allEvidence === 'string' && tokens.some(t => allEvidence.includes(t));
    if (!found) missing.push(field);
  }

  if (!missing.length) return null;

  // Don't fire on every gap -- only if MORE THAN HALF of asked fields are
  // missing. Otherwise the existing hallucination gate handles it via
  // [unverified] tagging.
  if (!rawFields.length || missing.length / rawFields.length < 0.5) return null;

  return `Goal asked for: ${rawFields.join(', ')}. Memory is missing token-evidence for: ${missing.join(', ')}. Try one more execute_js or extract pass before finishing -- the retry ladder will auto-fall-back to body.innerText if your selectors miss.`;
}

/**
 * URL-aware loop detector. Catches "agent did 7 navigates to 7 different
 * pages, none produced a productive memory write". Loop detection that
 * requires repeated EXACT actions is too narrow -- this version says:
 *
 *   "If 3+ of the last 4 actions are the same TYPE, and none of them
 *    resulted in a productive memory write, that is a loop. Force
 *    a strategy shift."
 *
 * Returns { isLoop: bool, type: string, count: number } so the caller can
 * inject a context-specific directive.
 */
function _detectActionTypeLoop(history, _agentMemory) {
  if (!Array.isArray(history) || history.length < 4) return { isLoop: false };
  const recent = history.slice(-4);
  const types = recent.map(h => (h && h.action && h.action.type) || '');
  // Most common type in the window
  const counts = {};
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  let dominantType = null, dominantCount = 0;
  for (const [t, count] of Object.entries(counts)) {
    if (count > dominantCount) { dominantType = t; dominantCount = count; }
  }
  if (dominantCount < 3) return { isLoop: false };

  // Check whether THIS dominant-type window produced any productive memory.
  // A "productive" step is one that wrote a key with a usable value to memory.
  // We can't know which key was written by which step, but we can check:
  // did the memory keys count GROW during this 4-step window? If not, loop.
  // (Imperfect but conservative -- false positives only delay the run a bit.)
  // Implementation: store a memory-key-count snapshot in agent state at each
  // step and compare. For now we use a simpler heuristic: the dominant type
  // is non-modifying AND no new note/extract/execute_js-with-key happened.
  if (!NON_PRODUCTIVE_ACTIONS.has(dominantType)) return { isLoop: false };

  // Count productive actions in the window
  const recentProductive = recent.filter(h => {
    if (!h || !h.action) return false;
    const t = h.action.type;
    if (t === 'note') return true;
    if (/^extract(_list)?$/.test(t)) return !!h.action.key;
    if (t === 'execute_js') return !!h.action.key;
    return false;
  });
  if (!recentProductive.length) {
    return { isLoop: true, type: dominantType, count: dominantCount };
  }

  return { isLoop: false };
}

// ========== Heuristic Plan Generator ==========
// Fallback when LLM-based plan generation fails. Analyzes the goal text
// to produce a basic step-by-step plan without any API calls.

function generateHeuristicPlan(goal, currentUrl) {
  if (!goal) return null;
  const g = goal.toLowerCase();
  const currentHost = (() => { try { return new URL(currentUrl).hostname; } catch (_urlErr) { return ''; } })();

  // Detect multi-page research patterns
  const isMultiPage = /\b(top\s+\d|each|every|all|10|5|3)\b.*\b(articles?|pages?|sites?|links?|urls?|results?|sources?)\b/i.test(g)
    || /\b(open|visit|browse|check)\b.*\b(each|and|then)\b/i.test(g)
    || /\b(summarize?|brief|report)\b.*\b(all|each|every)\b/i.test(g);

  // Extract target URL from goal
  const urlMatch = goal.match(/(?:go to|navigate to|visit|check|open)\s+(https?:\/\/[^\s,]+|[\w.-]+\.(?:com|org|net|io|gov|edu|co)[^\s,]*)/i)
    || goal.match(/(https?:\/\/[^\s]+)/);
  // v3.63: Also match bare site names ("go to Amazon", "go to Reddit")
  const _bareSiteMap = { amazon: 'amazon.com', reddit: 'reddit.com', youtube: 'youtube.com', twitter: 'twitter.com', x: 'x.com', github: 'github.com', wikipedia: 'wikipedia.org', hackernews: 'news.ycombinator.com', 'hacker news': 'news.ycombinator.com', hn: 'news.ycombinator.com', google: 'google.com', facebook: 'facebook.com', instagram: 'instagram.com', linkedin: 'linkedin.com', netflix: 'netflix.com', yahoo: 'yahoo.com', bing: 'bing.com', duckduckgo: 'duckduckgo.com', stackoverflow: 'stackoverflow.com', 'stack overflow': 'stackoverflow.com', cnn: 'cnn.com', bbc: 'bbc.com', nytimes: 'nytimes.com', espn: 'espn.com', weather: 'weather.gov' };
  let _urlMatch = urlMatch;
  if (!_urlMatch) {
    const _bareMatch = goal.match(/(?:go to|navigate to|visit|check|open)\s+(?:the\s+)?([\w\s]+?)(?:\s+(?:and|then|,|\.))?(?:\s|$)/i);
    if (_bareMatch && _bareMatch[1]) {
      const _siteKey = _bareMatch[1].trim().toLowerCase().replace(/\s+/g, '');
      if (_bareSiteMap[_siteKey]) {
        _urlMatch = [`go to ${_bareMatch[1]}`, `https://${_bareSiteMap[_siteKey]}`];
      } else {
        // Try partial match
        for (const [k, v] of Object.entries(_bareSiteMap)) {
          if (_siteKey.includes(k) || k.includes(_siteKey)) {
            _urlMatch = [`go to ${_bareMatch[1]}`, `https://${v}`];
            break;
          }
        }
      }
    }
  }
  const urlMatchFinal = _urlMatch;
  const targetUrl = urlMatchFinal && urlMatchFinal[1] ? urlMatchFinal[1] : null;
  const targetHost = targetUrl ? (() => { try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch (_urlErr) { return ''; } })() : '';
  const _normHost = currentHost.replace(/^www\./, '');
  const alreadyThere = targetHost && (_normHost === targetHost || _normHost.endsWith('.' + targetHost));

  // Extract search query from goal
  const searchMatch = goal.match(/(?:search|find|look up|google)\s+(?:for\s+)?["']?([^"']{10,80})/i)
    || goal.match(/(?:about|on|regarding)\s+([^,.\n]{10,60})/i);
  const searchQuery = searchMatch && searchMatch[1] && typeof searchMatch[1] === 'string' ? searchMatch[1].trim() : null;

  // Extract count
  const countMatch = goal.match(/(?:top\s+)?(\d+)/);
  const count = countMatch && countMatch[1] ? (parseInt(countMatch[1], 10) || 10) : 10;

  if (isMultiPage) {
    const steps = [];
    if (targetUrl && !alreadyThere) {
      steps.push(`Navigate to ${targetUrl}`);
    } else if (searchQuery) {
      steps.push(`Search Google for "${searchQuery}"`);
    }
    steps.push(`Use execute_js with key "links" to extract article/result links from the page`);
    steps.push(`Review extracted links and identify the ${count} most relevant ones`);
    for (let i = 1; i <= Math.min(count, 10); i++) {
      steps.push(`Open article ${i} in a new tab, read it, and note a brief summary`);
    }
    steps.push(`Close all article tabs`);
    steps.push(`Finish with a combined summary of all ${count} items`);
    return steps;
  }

  if (targetUrl && !alreadyThere) {
    return [
      `Navigate to ${targetUrl}`,
      'Read the page content',
      'Extract key information using execute_js with key "data"',
      'Finish with a summary of findings'
    ];
  }

  if (searchQuery) {
    return [
      `Search Google for "${searchQuery}"`,
      'Read search results and extract top links',
      'Visit the most relevant result',
      'Read and extract key information',
      'Finish with a summary'
    ];
  }

  // Generic fallback
  return [
    'Read the current page',
    'Extract key information',
    'If needed, navigate to find more data',
    'Finish with a summary'
  ];
}

// ========== Run Setup Helpers ==========

// Load run-stable settings, initialize module-level state, and return the
// (possibly context-prepended) goal string. Called once at the start of each run.
async function _initRunState(goal) {
  await migrateLegacySettings();
  // (3.41.0) Batch all run-stable settings in one read — avoids per-step round-trips.
  let stored;
  try {
    stored = await chrome.storage.local.get([
      'agent_history', 'agent_context', 'agent_memory', 'expectedTenant',
      'ticketMode', 'ticketFormat', 'approvalMode', 'useTrustedInput',
      'quickMode',
    ]);
  } catch (e) {
    console.warn('[Sentinel] runAgentLoop settings load failed:', getErrorMessage(e));
    stored = {};
  }
  _runSettings = {
    ticketMode:      stored.ticketMode     ?? false,
    ticketFormat:    stored.ticketFormat   ?? 'standard',
    approvalMode:    stored.approvalMode   ?? false,
    useTrustedInput: stored.useTrustedInput ?? false,
    quickMode:       stored.quickMode      ?? false,
  };
  expectedTenant = (stored && typeof stored.expectedTenant === 'string') ? stored.expectedTenant.trim() : null;
  detectedTenant = null;
  // Each run gets a clean memory namespace — never carry over data from a prior task.
  // Cross-client contamination: yesterday's findings must never leak into today's run.
  agentMemory = {};
  try {
    await chrome.storage.local.set({ agent_history: [] });
  } catch (e) {
    console.warn('[Sentinel] agent_history clear failed:', getErrorMessage(e));
  }
  if (stored.agent_context && stored.agent_context.trim()) {
    return `Previous context: ${stored.agent_context.trim()}\n\nCurrent goal: ${goal}`;
  }
  return goal;
}

// Build a plain-English one-liner describing what the agent can see on the page.
// Pure heuristic — no LLM call. Used for Phase 8.2 page state narration.
function _buildPageNarration(url, title, observation, pageContent) {
  try {
    const els = (observation && observation.elements) || [];
    const _text = (pageContent && pageContent.content) || '';
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_urlErr) { return url; } })();
    const pageTitle = (title || '').trim();

    // Single-pass optimization: count all element types and collect headings in one loop
    let forms = 0, buttons = 0, inputs = 0, links = 0, errorEl = null;
    const headings = [];
    const headingRegex = /^h[1-3]$/i;

    for (const e of els) {
      const tag = e.tag || '';

      // Count element types
      if (/^form$/i.test(tag)) {
        forms++;
      } else if (/^button$/i.test(tag) || e.role === 'button') {
        buttons++;
      } else if (/^(input|textarea|select)$/i.test(tag)) {
        inputs++;
      } else if (/^a$/i.test(tag)) {
        links++;
      }

      // Collect headings
      if (headingRegex.test(tag)) {
        const text = e.text || '';
        if (text) headings.push(text);
      }

      // Find error element (if not already found)
      if (!errorEl) {
        const t = typeof e.text === 'string' ? e.text.toLowerCase() : '';
        if (/error|invalid|failed/i.test(t)) {
          errorEl = e;
        }
      }
    }

    const parts = [];
    if (pageTitle) parts.push(pageTitle);
    else if (host) parts.push(host);

    if (headings[0]) {
      const hText = typeof headings[0] === 'string' ? headings[0] : '';
      const h = hText.length > 60 ? `${hText.substring(0, 57)}...` : hText;
      const hLower = typeof h === 'string' ? h.toLowerCase() : '';
      const pTitleLower = typeof pageTitle === 'string' ? pageTitle.toLowerCase() : '';
      if (hLower !== pTitleLower) parts.push(`"${h}"`);
    }

    const details = [];
    if (forms > 0) details.push(`${forms} form${forms > 1 ? 's' : ''}`);
    if (inputs > 0) details.push(`${inputs} input${inputs > 1 ? 's' : ''}`);
    if (buttons > 0) details.push(`${buttons} button${buttons > 1 ? 's' : ''}`);
    if (links > 5) details.push(`${links} links`);
    if (errorEl) details.push('⚠ error message visible');

    const summary = `${parts.join(' — ')}${details.length ? ` (${details.join(', ')})` : ''}`;
    return `I can see: ${summary || host}`;
  } catch (_) {
    return '';
  }
}

// Generate the initial execution plan before the agent loop starts.
// In quick mode, skips planning and returns null. Otherwise tries LLM planning
// first and falls back to a heuristic plan if the LLM call fails.
async function _generateInitialPlan(goal, workingTabId) {
  if (_runSettings.quickMode) {
    sendSilentUpdate('⚡ Quick Mode — executing directly');
    return null;
  }
  sendSilentUpdate('Planning task...');
  sendAgentStatus('planning', 'Generating task plan...');
  const planProviderConfig = await getActiveProvider();
  if (!planProviderConfig) {
    sendSilentUpdate('No provider configured — cannot generate plan');
    return null;
  }
  const planSettings = {
    api_endpoint: planProviderConfig.endpoint,
    api_key: planProviderConfig.apiKey,
    model: planProviderConfig.model
  };
  const currentTabInfo = await getTabInfo(workingTabId);
  const platformCtx = getPlatformContext(currentTabInfo?.url || '', goal);
  const patterns = await getRelevantPatterns(goal);
  let plan = await generatePlan(goal, planSettings, {
    currentUrl: currentTabInfo?.url || '',
    pageTitle: currentTabInfo?.title || '',
    platformContext: platformCtx,
    relevantPatterns: patterns
  });
  if (plan) {
    sendSilentUpdate(`📋 Plan ready (${plan.length} steps): ${plan[0] || ''}`);
    return plan;
  }
  // Fallback: heuristic plan from goal analysis
  plan = generateHeuristicPlan(goal, currentTabInfo?.url || '');
  if (plan) {
    sendSilentUpdate(`📋 Basic plan (${plan.length} steps): ${plan[0] || ''}`);
  } else {
    sendSilentUpdate('Running in direct mode');
  }
  return plan;
}

// ========== Main Agent Loop ==========
async function runAgentLoop(goal, workingTabId) {
  console.log('[Sentinel] Agent starting loop for goal:', goal);
  _lastGoal = goal || '';
  let finished = false;
  // (3.15.1) `history` is module-level — clear in-place so the array reference
  // stays valid for any captured closures (trimHistory/persistHistory helpers).
  history.length = 0;
  let stepCount = 0;
  let reportData = null;  // Snapshot for async report generation
  agentPlan = null;
  currentPlanStep = 0;

  goal = await _initRunState(goal);

  let consecutiveNavigates = 0;
  let consecutiveInjectionFailures = 0;
  // Observation skip cache — reused when previous step was non-mutating and
  // the URL/SPA-route hasn't changed. DOM content hash catches SPA changes
  // without URL changes.
  _cachedObservation = null;
  let _cachedPageContent = null;
  let _lastObservedUrl = '';
  let _lastObservedDomHash = 0;

  try {
    agentPlan = await _generateInitialPlan(goal, workingTabId);
  } catch (e) {
    console.warn('[Sentinel] _generateInitialPlan failed (non-fatal), running without plan:', getErrorMessage(e));
    agentPlan = null;
  }
  try { sendPlanPreview(agentPlan, agentPlan && agentPlan.length); } catch (_e) {
    // Plan preview send failed non-fatally
  }

  // (SW keepalive) Pin the service worker for the entire agent loop duration.
  // Without this, the SW can be terminated during long LLM calls or page loads.
  const _loopKaName = `sentinel_loop_${runLogId || crypto.randomUUID()}`;
  try { startSwKeepalive(_loopKaName); } catch (e) { console.error('[Sentinel] SW keepalive start failed:', getErrorMessage(e)); }

  let command;  // v3.66: Moved declaration here so batch skip can assign it
  // Loop-detector state — declared here so they survive across iterations without
  // relying on `var` hoisting inside the loop body (fragile in strict mode).
  let _clickAtLoopCount = 0;
  let _lastCmdType = '';
  let _sameCmdCount = 0;
  let _lastLoopUrl = '';
  while (!finished && agentRunning) {

    // (v3.60 / fixed): Batch commands are drained just before the LLM consult
    // at the end of this iteration (see _pendingCommandQueue check near callLLM).
    // The early-shift block was removed — it caused a double-pop that dropped
    // commands when two or more were queued simultaneously.

    try {
      // Pause check — wait until resumed
      if (agentPaused) {
        sendSilentUpdate('⏸ Agent paused — waiting for resume', stepCount);
        while (agentPaused && agentRunning) await sleep(500);
        if (!agentRunning) break;
        sendSilentUpdate('▶ Agent resumed', stepCount);
      }

      // Drain any mid-run context notes from the user and push them into history
      // so the LLM sees them on the very next call.
      if (_pendingContextInjections.length) {
        const notes = _pendingContextInjections.splice(0);
        for (const n of notes) {
          historyPush({ role: 'user', content: `📌 Technician note (mid-run): ${n}` });
          sendSilentUpdate(`📌 Context injected: ${n}`, stepCount);
        }
      }

      _lastLoopUrl = _lastObservedUrl;
      stepCount++;
      // (3.16.0) Signal new step to the popup so it can create a fresh
      // activity stream container BEFORE observation/AI consultation begin.
      try { sendAgentStepStart(stepCount, agentPlan ? agentPlan.length : 0); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      // (3.8.2) Dynamic step limit. Baseline = CONFIG.maxSteps (100). Each
      // productive action bumps `productiveSteps` and extends the cap by +25.
      // Hard cap = 300. Multi-portal investigations get a +50 head-start so
      // they don't choke on the first portal.
      let dynamicBaseline = CONFIG.maxSteps;
      try {
        // Use global match to count distinct platform keywords safely (avoids ReDoS from .*  pattern)
        if (typeof goal === 'string') {
          const _multiPortalMatches = goal.match(/\b(entra|exchange|purview|onedrive|sharepoint|teams|intune|defender|sentinelone|connectwise|ninjaone|datto|itglue|huntress|m365|admin\.microsoft|portal\.azure)\b/gi);
          if (_multiPortalMatches && _multiPortalMatches.length >= 2) {
            dynamicBaseline = CONFIG.maxSteps + 50;
          }
        }
      } catch (_e) {
        // Dynamic baseline calculation failed non-fatally
      }
      const dynamicMaxSteps = Math.min(300, dynamicBaseline + (productiveSteps * 25));
      // (3.36.1) Hotfix — telemetry emit moved AFTER `const dynamicMaxSteps`
      // declaration. Previously this line was above the const and tripped a
      // temporal-dead-zone ReferenceError every step on the first iteration,
      // hanging every run. The "let dynamicMaxSteps" in the outer block-scope
      // is in TDZ until the line that initializes it runs, so the previous
      // ordering blew up before any LLM call could fire.
      tel.info('lifecycle', `Step ${stepCount} starting`, { stepCount, dynamicMaxSteps, productiveSteps, consecutiveFailures });
      if (stepCount > dynamicMaxSteps) {
        sendSilentUpdate(`Reached step limit (${dynamicMaxSteps}, baseline ${CONFIG.maxSteps} + ${productiveSteps} productive bumps). Finishing.`, stepCount);
        const _hardLimitSummary = `Reached step limit of ${dynamicMaxSteps}. Task may be incomplete — ${productiveSteps} productive actions extended the run.`;
        finished = true;
        reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: _hardLimitSummary }).catch((e) => {
          console.error('[_hardLimitSummary] Unhandled rejection:', e);
        });
        sendReportUpdate('generating');
        break;
      }

      // Check for pending SPA transition -- if the page changed under us,
      // re-scan instead of using stale observation data
      if (isSPATransitionPending()) {
        sendSilentUpdate('SPA page transition detected -- re-scanning...', stepCount);
        clearSPATransition();
        // Invalidate screenshot cache for current active tab
        const spaCtx = getTabContext(getActiveTabId());
        if (spaCtx && spaCtx.screenshotCache) {
          spaCtx.screenshotCache.cachedSnapshot = null;
          spaCtx.screenshotCache.cachedBase64Image = null;
          spaCtx.screenshotCache.lastScreenshotUrl = null;
        }
        // Invalidate observation cache so the next step does a full re-scan.
        _cachedObservation = null;
        _cachedPageContent = null;
        _lastObservedUrl = '';
        _lastObservedDomHash = 0;
        // Don't skip the iteration -- just let the normal observe/scan flow run
        // with fresh data. The continue is NOT used here because we want the
        // normal flow to pick up the new page state.
      }

      let tab = getActiveTabId();
      if (!tab) {
        // Try to recover from tab contexts before giving up
        const allCtx = getAllTabContexts();
        if (allCtx && allCtx[0]) {
          tab = allCtx[0].tabId;
          /* Recovered tab from context */
        }
      }
      if (!tab) {
        sendSilentUpdate('No active tab -- stopping', stepCount);
        finished = true;
        reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: 'No active tab. Task interrupted.' }).catch((e) => {
          console.error('[tab] Unhandled rejection:', e);
        });
        sendReportUpdate('generating');
        break;
      }

      // Get tab info
      let tabInfo = await getTabInfo(tab);

      if (!tabInfo) {
        sendSilentUpdate('Agent tab lost. Attempting recovery...', stepCount);
        const allTabs = await new Promise(resolve => {
          chrome.tabs.query({}, (t) => {
            if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) {
              console.error('[Agent recovery] tabs.query failed:', (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError)));
              resolve([]);
            } else {
              resolve(t || []);
            }
          });
        });
        const lostTab = allTabs.find(t => t.id === tab);
        if (lostTab) { tabInfo = lostTab; }
        else {
          sendSilentUpdate('Agent tab was closed. Task stopped.', stepCount);
          finished = true;
          reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
          chrome.runtime.sendMessage({ action: 'agent_finished', summary: 'Agent tab closed. Task interrupted.' }).catch((e) => {
            console.error('[lostTab] Unhandled rejection:', e);
          });
          sendReportUpdate('generating');
          break;
        }
      }


      // Validate tabInfo.url before using it (needed for navigation checks below)
      if (!tabInfo.url) {
        sendSilentUpdate('Tab URL unavailable. Continuing with current page...', stepCount);
        // Skip auto-navigate and restricted page checks - just proceed with current state
        await sleep(500);
        continue;
      }
      // Wait for page load
      if (tabInfo.status !== 'complete') {
        sendSilentUpdate('Waiting for page to load...', stepCount);
        await waitForPageLoad(tab);
        await sleep(500);
      }

      // Internal browser pages (chrome://, edge://, about:) cannot be scripted.
      // EXCEPTION: chrome://newtab/ is a blank tab — the auto-navigate code below
      // will navigate it to the goal URL, so don't block it here.
      const _isNewTab = tabInfo.url === 'chrome://newtab/' || tabInfo.url === 'chrome://newtab'
        || tabInfo.url === 'about:blank' || tabInfo.url === 'about:newtab' || tabInfo.url === 'about:newtab/'
        || tabInfo.url === 'edge://newtab/' || tabInfo.url === 'edge://newtab';
      const _isRestrictedPage = !_isNewTab && (
        tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('edge://') || tabInfo.url.startsWith('about:')
      );
      if (_isRestrictedPage) {
        const _restrictedMsg = `Cannot operate on internal browser page (${tabInfo.url}). Switch to a normal web tab or open a new tab before starting the agent.`;
        historyPush({ step: stepCount, action: { type: 'note' }, result: _restrictedMsg });
        sendSilentUpdate('⚠️ Cannot operate on internal browser page. Please switch to a normal web tab.', stepCount);
        finished = true;
        reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: `⚠️ ${_restrictedMsg}` }).catch((e) => {
          console.error('[restrictedPage] Unhandled rejection:', e);
        });
        sendReportUpdate('generating');
        break;
      }

      // Auto-navigate to URL found in goal (first iteration only)
      // Smart: checks current page hostname before navigating
      if (stepCount === 1 && goal) {
        // Strip email addresses before URL extraction so "support@example.com" is
        // never mistaken for a navigation target.
        const _goalForUrlExtract = goal.replace(/[\w.+-]+@[\w.-]+/g, '');
        // Only auto-navigate when the goal starts with an explicit navigation
        // imperative OR contains a full https:// URL. Avoid triggering on ticket
        // text that mentions a URL in passing (e.g. "user cannot reach admin.microsoft.com").
        const _isExplicitNav = typeof _goalForUrlExtract === 'string' && (/^(?:go to|navigate to|visit|open|browse to|start at|begin at|check)\b/i.test(_goalForUrlExtract.trimStart())
          || /\bbegin at:\s*\S/i.test(_goalForUrlExtract)
          || /\bstart url:\s*\S/i.test(_goalForUrlExtract));
        let urlMatch = null;
        if (typeof _goalForUrlExtract === 'string') {
          urlMatch = _isExplicitNav
            ? (_goalForUrlExtract.match(/https?:\/\/[^\s"'<>,]+/i) || _goalForUrlExtract.match(/(?:go to|visit|navigate to|open|browse to|start at|begin at|check)\s+(?:the\s+)?(?:site\s+)?([^\s]+?\.(?:com|org|net|io|gov|edu|co|us|uk|de|fr|cn|jp|ru|br|in|ca|au|me|tv|info|biz|dev|app|ai|xyz))/i))
            : _goalForUrlExtract.match(/https?:\/\/[^\s"'<>,]+/i);
        }
        // v3.66: Bare site name fallback for Step 1 auto-navigate
        if (!urlMatch && _isExplicitNav) {
          const _step1BareMap = { amazon: 'amazon.com', reddit: 'reddit.com', youtube: 'youtube.com', twitter: 'twitter.com', x: 'x.com', github: 'github.com', wikipedia: 'wikipedia.org', hackernews: 'news.ycombinator.com', 'hacker news': 'news.ycombinator.com', hn: 'news.ycombinator.com', google: 'google.com', facebook: 'facebook.com', instagram: 'instagram.com', linkedin: 'linkedin.com', netflix: 'netflix.com', yahoo: 'yahoo.com', bing: 'bing.com', duckduckgo: 'duckduckgo.com', stackoverflow: 'stackoverflow.com', 'stack overflow': 'stackoverflow.com', cnn: 'cnn.com', bbc: 'bbc.com', nytimes: 'nytimes.com', espn: 'espn.com', weather: 'weather.gov' };
          const _step1Bare = _goalForUrlExtract.match(/(?:go to|navigate to|visit|open|check)\s+(?:the\s+)?([\w\s]+?)(?:\s+(?:and|then|,|\.))?(?:\s|$)/i);
          if (_step1Bare && typeof _step1Bare[1] === 'string') {
            const _step1Key = _step1Bare[1].trim().toLowerCase().replace(/\s+/g, '');
            if (_step1BareMap[_step1Key]) {
              urlMatch = [`go to ${_step1Bare[1]}`, _step1BareMap[_step1Key]];
            } else {
              for (const [k, v] of Object.entries(_step1BareMap)) {
                if (_step1Key.includes(k) || k.includes(_step1Key)) {
                  urlMatch = [`go to ${_step1Bare[1]}`, v];
                  break;
                }
              }
            }
          }
        }
        if (urlMatch && urlMatch.length) {
          const goalUrl = urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[1] || urlMatch[0]}`;
          try {
            const goalHostname = new URL(goalUrl).hostname.toLowerCase();
            const currentHostname = new URL(tabInfo.url).hostname.toLowerCase();
            if (!currentHostname.includes(goalHostname.replace(/^www\./, ''))) {
              sendSilentUpdate(`Navigating to: ${goalUrl}`, stepCount);
              sendActionMessage({ type: 'navigate', url: goalUrl }, stepCount, null);
              await chrome.tabs.update(tab, { url: goalUrl });
              await waitForPageLoad(tab);
              await waitForPageReady(tab);
              _cachedObservation = null; // Invalidate cache after navigation
              const reinjected = await injectContentScript(tab);
              if (reinjected) {
                historyPush({ step: stepCount, action: { type: 'navigate', url: goalUrl }, result: `Navigated to ${goalUrl}` });
                await persistHistory();
              }
              // Defensive: re-register the tab after navigation in case the tab
              // lifecycle events cleared the context during page load
              try { registerInitialTab(tab, goalUrl); } catch(e) { console.warn('[Sentinel] tab re-register failed:', getErrorMessage(e)); }
              continue;
            }
            // Already on the right page - skip navigation
          } catch (navErr) { console.warn('[Sentinel] auto-navigate error:', getErrorMessage(navErr)); /* URL parse error, skip auto-navigate */ }
        }
      }

      sendSilentUpdate('Observing page...', stepCount);

      // Send page context to popup so user can see where the agent is
      sendPageContext(tabInfo?.url || '', tabInfo?.title || '', stepCount, tab, dynamicMaxSteps);

      // (3.7.0) Tenant detection on Microsoft admin URLs. We probe via the
      // content script and broadcast the result so the popup chip updates.
      try {
        const _u = (tabInfo && tabInfo.url) || '';
        if (/microsoft\.com|microsoftonline\.com|azure\.com|office\.com/i.test(_u)) {
          const _td = await sendMessageWithRetry(tab, { action: 'detect_tenant' }, 1).catch(() => null);
          if (_td && (_td.tid || _td.onmicrosoft || _td.chipText)) {
            detectedTenant = _td;
            try {
              chrome.runtime.sendMessage({
                action: 'tenant_detected',
                tenant: _td,
                expected: expectedTenant
              }).catch((e) => {
                console.error('[_td] Unhandled rejection:', e);
              });
            } catch (e) { console.warn('[Sentinel] _td handler failed:', getErrorMessage(e)); }
          }
        }
      } catch (_) { /* non-fatal */ }

      // Send tab state to popup so user can see all managed tabs
      const allTabContexts = getAllTabContexts();
      if (allTabContexts.length) {
        sendTabStateUpdate(allTabContexts);
      }

      // SPEED: Skip content script injection after repeated failures
      let scriptReady = false;
      if (consecutiveInjectionFailures < 3) {
        scriptReady = await injectContentScript(tab);
      } else {
        console.warn(`[Sentinel/SPEED] Skipping content script injection (${consecutiveInjectionFailures} failures)`);
      }
      _cdpFallbackActive = false;
      if (!scriptReady) {
        consecutiveInjectionFailures++;
        sendSilentUpdate('Content script failed -- trying CDP fallback', stepCount);
        
        // (v3.54) CDP Fallback: bypass CSP by using Chrome DevTools Protocol directly.
        // After 2 failures, switch to CDP mode — observe, dismiss overlays, read page.
        if (consecutiveInjectionFailures >= 2) {
          console.warn(`[Sentinel] Content script failed ${consecutiveInjectionFailures} times — activating CDP fallback`);
          _cdpFallbackActive = true;
          // (v3.57) On first CDP activation, check if page has any DOM at all.
          // If empty (no body, no title), reload the page via CDP.
          if (consecutiveInjectionFailures === 2) {
            try {
              const pgCheck = await cdpExecuteJs(tab, 'return{hasBody:!!document.body,children:(document.body||document.documentElement).childNodes.length,title:document.title||"",url:window.location.href};', { timeout: 3000 });
              console.log('[Sentinel/CDP] Page check on first CDP activation:', JSON.stringify(pgCheck && pgCheck.value));
              if (pgCheck && pgCheck.ok && pgCheck.value && (!pgCheck.value.hasBody || (pgCheck.value.children === 0 && !pgCheck.value.title))) {
                console.log('[Sentinel/CDP] Page has no DOM — reloading via CDP Page.reload...');
                await chrome.debugger.sendCommand({ tabId: tab }, 'Page.reload', { ignoreCache: true });
                await new Promise(r => setTimeout(r, 2000));
              }
            } catch(_) { /* non-fatal */ }
          }
          // Don't continue — fall through to observation with CDP data
        } else {
          await sleep(1000); // SPEED: reduced from 2000ms — one retry, recover faster
          continue; // retry injection on first failure
        }
      } else {
        consecutiveInjectionFailures = 0;
      }

      // Stuck-loop detection: if the same action type failed 3+ times in a row,
      // inject a recovery hint to break the loop.
      try {
        const recentFailures = history.slice(-4);
        const recentActionEntries = recentFailures.filter(h => h.action && h.action.type);
        const lastActionTypes = recentActionEntries.map(h => h.action.type);
        if (lastActionTypes.length >= 3) {
          const allSame = lastActionTypes.every(t => t === lastActionTypes[0]);
          const allFailed = recentActionEntries.every(h => h.actionFailed);
          if (allSame && allFailed) {
            const stuckAction = lastActionTypes[0];
            console.warn(`[Sentinel/stuck] Detected stuck loop: ${stuckAction} failed ${lastActionTypes.length} times`);
            // Inject a forced recovery note into history
            historyPush({
              role: 'user',
              content: `[SYSTEM RECOVERY] The action "${stuckAction}" has failed ${lastActionTypes.length} times in a row. You are stuck in a loop. Try a COMPLETELY DIFFERENT approach. If close_tab isn't working, try navigate to the main page instead. If you can't close a tab, just navigate away from it. Do NOT repeat "${stuckAction}" again.`
            });
            try { await persistHistory(); } catch (_e) {
              // History persist failed non-fatally during recovery
            }
          }
        }
      } catch (_e) { /* non-fatal */ }

      // Auto-dismiss popups/overlays (cookie consent, ad-blocker warnings, etc.)
      if (_cdpFallbackActive) {
        // (v3.54→3.55) CDP fallback: always run nuclear overlay removal.
        // Don't wait for overlay detection — just nuke everything that looks like one.
        try {
          const dismissed = await _cdpDismissOverlays(tab, []);
          if (dismissed > 0) {
            sendSilentUpdate(`[CDP] Nuked ${dismissed} overlay element(s)`, stepCount);
            await sleep(800);
          }
        } catch (_) { /* non-fatal */ }
      } else {
        try {
          const overlayResult = await sendMessageWithRetry(tab, { action: 'dismiss_overlays' });
          if (overlayResult && overlayResult.count > 0) {
            sendSilentUpdate(`Dismissed ${overlayResult.count} overlay(s)`, stepCount);
            await sleep(400); // let overlay close animate
          }
        } catch (_) { /* non-fatal */ }
      }

      // Get page data — skip re-observation when the previous action was
      // non-mutating (note/extract/scroll/wait) AND no SPA transition occurred
      // AND the URL hasn't changed AND the DOM content hash matches (catches SPA
      // content changes without URL changes). On slow portals this halves step latency.
      let observation, pageContent;
      const _prevAction = history.length ? history[history.length - 1] : null;
      const _prevType = _prevAction && _prevAction.action ? _prevAction.action.type : '';
      const _nonMutating = /^(note|extract|extract_list|scroll|wait_for_text|wait_for_element|wait_for_navigation|read_page)$/.test(_prevType);
      const _obsUrl = (tabInfo && tabInfo.url) || '';

      // Compute a lightweight DOM content hash via the content script to detect
      // SPA content changes that don't alter the URL. The hash is a stable
      // fingerprint based on visible text length + interactive element count.
      let _currentDomHash = 0;
      if (_nonMutating && !isSPATransitionPending() && _lastObservedUrl === _obsUrl && !!_cachedObservation) {
        try {
          const _hashResult = await sendMessageWithRetry(tab, {
            action: 'execute_command',
            command: {
              type: 'execute_js',
              code: `(() => {
                const textLen = (document.body && document.body.innerText) ? document.body.innerText.length : 0;
                const interactiveCount = document.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="link"], [role="textbox"]').length;
                return textLen * 31 + interactiveCount;
              })()`
            }
          }).catch(() => null);
          if (_hashResult) {
            let val = _hashResult;
            if (typeof val === 'string') {
              try {
                const parsed = JSON.parse(val.replace('JS Result: ', ''));
                val = (parsed && parsed.value !== undefined) ? parsed.value : val;
              } catch (_e) { /* JSON parse failed - use raw value */ }
            }
            const parsed = typeof val === 'number' ? val : parseInt(String(val), 10);
            _currentDomHash = (typeof parsed === 'number' && !Number.isNaN(parsed)) ? parsed : 0;
          }
        } catch (_) { /* hash probe failed — assume cache miss */ }
      }

      const _observedHashBefore = _lastObservedDomHash;
      const _skipObserve = _nonMutating && !isSPATransitionPending() && _lastObservedUrl === _obsUrl && !!_cachedObservation && (_currentDomHash !== 0 && _currentDomHash === _lastObservedDomHash);
      if (_skipObserve) {
        observation = _cachedObservation;
        pageContent = _cachedPageContent;
        activityDone(stepCount, 'observe', '(cached — page unchanged)', null);
      } else {
        if (_nonMutating && _lastObservedUrl === _obsUrl && _currentDomHash !== 0 && _currentDomHash !== _lastObservedDomHash) {
          // SPA content change detected (URL same, DOM hash different)
          sendSilentUpdate('DOM changed (SPA) — re-observing...', stepCount);
        }
        // (3.16.0) Observation phase activity item
        sendAgentStatus('observing', 'Reading page structure...');
        activityStart(stepCount, 'observe', 'Observing page');
        try {
          if (_cdpFallbackActive) {
            // (v3.54) CDP fallback: observe page via DevTools Protocol instead of content script
            const cdpObs = await _cdpObservePage(tab);
            if (cdpObs) {
              observation = { elements: cdpObs.elements || [] };
              pageContent = { content: cdpObs.text || '' };
              // Also check for overlays and auto-dismiss
              if (cdpObs.overlays && cdpObs.overlays.length) {
                const dismissed = await _cdpDismissOverlays(tab, cdpObs.overlays);
                if (dismissed > 0) {
                  sendSilentUpdate(`[CDP] Auto-dismissed ${dismissed} overlay(s) during observation`, stepCount);
                  await sleep(800);
                  // Re-observe after dismissal
                  const cdpObs2 = await _cdpObservePage(tab);
                  if (cdpObs2) {
                    observation = { elements: cdpObs2.elements || [] };
                    pageContent = { content: cdpObs2.text || '' };
                  }
                }
              }
            } else {
              observation = { elements: [] };
              pageContent = { content: '' };
            }
          } else {
          // (3.41.0) observe_page and read_page are independent read-only DOM
          // operations; run them in parallel to save 100-300ms per step.
          try {
            [observation, pageContent] = await Promise.all([
              sendMessageWithRetry(tab, { action: 'observe_page' }),
              sendMessageWithRetry(tab, { action: 'read_page' })
            ]);
          } catch (parallelErr) {
            // If parallel observation fails, fall back to sequential with better error recovery
            console.warn('[Sentinel/agent] Parallel observation failed, falling back to sequential:', getErrorMessage(parallelErr));
            try {
              observation = await sendMessageWithRetry(tab, { action: 'observe_page' });
            } catch (obsErr) {
              observation = { elements: [] };
              console.warn('[Sentinel/agent] Sequential observe_page failed:', getErrorMessage(obsErr));
            }
            try {
              pageContent = await sendMessageWithRetry(tab, { action: 'read_page' });
            } catch (readErr) {
              pageContent = { content: '' };
              console.warn('[Sentinel/agent] Sequential read_page failed:', getErrorMessage(readErr));
            }
          }
          }
          const elemCount = (observation && observation.elements) ? observation.elements.length : 0;
          const textLen = (pageContent && pageContent.content) ? pageContent.content.length : 0;
          activityDone(stepCount, 'observe', `Observed ${elemCount} elements, ${textLen} chars of text`, null);
          _cachedObservation = observation;
          _cachedPageContent = pageContent;
          _lastObservedUrl = _obsUrl;
          // Update DOM hash from the fresh observation
          _lastObservedDomHash = textLen * 31 + elemCount;
          // (8.2) Page state narration — heuristic summary of what the agent sees
          try {
            const narration = _buildPageNarration(tabInfo && tabInfo.url, tabInfo && tabInfo.title, observation, pageContent);
            if (narration) sendAgentStatus('observing', narration);
          } catch (_e) {
            // Page narration failed non-fatally
          }
        } catch (err) {
          const errMsg = getErrorMessage(err);
          activityFail(stepCount, 'observe', `Page read failed: ${errMsg}`, null);
          sendSilentUpdate(`Error reading page: ${errMsg}`, stepCount);
          // sendMessageWithRetry already retried 3× with content-script re-injection
          // between each attempt. By the time we reach here the page is truly unreachable
          // for this step. Proceeding with empty observation lets the LLM fire and issue
          // a navigate action to escape, rather than continue-ing back to the top of the
          // loop and spinning forever (especially when injection keeps succeeding but
          // observe keeps failing, which would reset consecutiveInjectionFailures to 0
          // and keep the old `< 3` guard from ever breaking the cycle).
          console.warn('[Sentinel] Observe failed (sendMessageWithRetry exhausted) — using empty observation so LLM can navigate away');
          observation = { elements: [] };
          pageContent = { content: '' };
        }
      }

      // Update snapshot for the current tab
      updateSnapshot(tab, {
        elements: observation?.elements || [],
        pageContent: pageContent?.content || '',
        url: tabInfo?.url || '',
        title: tabInfo?.title || ''
      });

      // Screenshot (CDP with per-tab cache)
      let freshTabInfo = await getTabInfo(tab);
      if (!freshTabInfo) {
        // Tab may be in a transient state (navigation, redirect). Always fall
        // back to the tabInfo we validated earlier — never spin-loop here.
        freshTabInfo = tabInfo;
      }

      const currentUrl = (freshTabInfo && freshTabInfo.url) || tabInfo.url;

      // Get per-tab screenshot cache
      let tabCtx = getTabContext(tab);
      if (!tabCtx) {
        // Context should have been registered in startAgent/registerInitialTab.
        // If it's missing (e.g., tab was replaced mid-run), re-register so the
        // loop can continue rather than spin forever on the continue below.
        try { registerInitialTab(tab, currentUrl); } catch (_e) {
          // Tab registration failed non-fatally during recovery
        }
        tabCtx = getTabContext(tab);
        // If still null after re-registration, create a minimal context and
        // proceed — never spin-loop here as it would keep apiCallCount at 0.
        if (!tabCtx) {
          console.warn('[Sentinel] tabCtx still null after re-register — creating minimal context for tab', tab);
          try { registerInitialTab(tab, currentUrl); } catch (_e) {
          // Tab registration failed non-fatally during recovery
        }
          tabCtx = getTabContext(tab);
          if (!tabCtx) {
            // Last resort: proceed with a synthetic screenshotCache object so
            // the LLM call can still fire. Screenshot will be skipped this step.
            tabCtx = { tabId: tab, url: currentUrl, screenshotCache: {} };
          }
        }
      }
      const screenshotCache = tabCtx.screenshotCache;

      let base64Image = null;
      // (#11) DPR-aware screenshot metadata. Defaults are safe for non-vision
      // models / failed captures and signal "no metadata available".
      let screenshotMeta = null;
      // (3.51) ALWAYS capture screenshots — no vision gate. OpenAI-compatible APIs
      // (Z.ai) gracefully ignore image content if the model can't process it.
      // This guarantees screenshots for every step regardless of model/provider.
      try {
        const shotResult = await takeScreenshot(tab, freshTabInfo.windowId, currentUrl, screenshotCache, CONFIG, stepCount, sendSilentUpdate);
        if (shotResult) {
          base64Image = shotResult.base64Image;
          screenshotMeta = {
            width: shotResult.width,
            height: shotResult.height,
            dpr: shotResult.dpr,
            scrollX: shotResult.scrollX,
            scrollY: shotResult.scrollY
          };
          // (3.7.1) Forward to the popup for the live mini-shot panel + crosshair coords.
          try { sendScreenshotUpdate(base64Image, stepCount, screenshotMeta); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          // (9.3) Store screenshot for replay export (ring-cap at 20)
          _stepScreenshots.set(stepCount, base64Image);
          if (_stepScreenshots.size > 20) {
            const oldest = _stepScreenshots.keys().next().value;
            _stepScreenshots.delete(oldest);
          }
        }
      } catch (shotErr) {
        // Screenshot failure is non-fatal — continue to LLM call without image.
        console.warn('[Sentinel] Screenshot failed, continuing without image:', getErrorMessage(shotErr));
        base64Image = null;
        screenshotMeta = null;
      }

      // Truncate page content
      let pageText = (pageContent && pageContent.content) || '';
      const effectiveMaxLength = (goal && /PHASE\s+\d|RUNBOOK|INVESTIGATION|checkpoint|TICKET/i.test(goal))
        ? 28000
        : CONFIG.maxPageContentLength;
      if (pageText.length > effectiveMaxLength) {
        pageText = pageText.substring(0, effectiveMaxLength) + '\n\n[... content truncated]';
      }

      // Build capped element list (needed before empty page check)
      // Use let so vision mode can reassign to new array without mutating cached observation.elements
      let allElements = (observation && observation.elements) ? observation.elements : [];

      // Detect empty page (SPA not rendered, anti-bot, or loading failure)
      const pageIsEmpty = pageText.length < 150 || (pageText.includes('Page Title:') && pageText.length < 300);
      const elementsEmpty = allElements.length < 3;
      if (pageIsEmpty) {
        pageText = `[WARNING: Page content is empty or nearly empty. This site may block automation or use heavy JavaScript rendering. Try execute_js with key to extract data directly, or navigate to a different URL.]\n\n${pageText}`;
      }
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
      let trimmedElements = [...priorityEls, ...otherEls]
        .slice(0, CONFIG.maxElements)
        .map(e => ({
          ...e,
          text: e.text && e.text.length > 80 ? e.text.substring(0, 77) + '...' : e.text
        }));

      // (3.14.1) Sign-in wall detection. Fires when we hit a login page on a
      // known auth host with a password (or username) input — BEFORE the LLM
      // gets a chance to bang on it uselessly. The runtime password-field
      // block in content/index.js already prevents auto-fill, so without this
      // pause the agent would just loop on the sign-in page until the step
      // budget runs out. Tracked per-URL so we don't re-pause after the user
      // manually signs in.
      try {
        const _wallHit = detectSignInWall(allElements, currentUrl, pageText);
        if (_wallHit && !signInWallAckUrls.has(currentUrl)) {
          agentPaused = true;
          sendSilentUpdate(`⏸ Sign-in wall detected (${_wallHit.host}) — sign in manually, then click Resume`, stepCount);
          notifyIfEnabled(`sign_in_wall_${Date.now()}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon-48.png'),
            title: 'Sentinel Override — Sign in required',
            message: `Sign in to ${_wallHit.host} in the browser, then click Resume.`
          });
          try {
            chrome.runtime.sendMessage({
              action: 'sign_in_wall_pause',
              url: currentUrl,
              host: _wallHit.host,
              evidence: _wallHit.evidence,
              stepNumber: stepCount
            }).catch((e) => {
              console.error('[_wallHit] Unhandled rejection:', e);
            });
          } catch (e) { console.warn('[Sentinel] _wallHit handler failed:', getErrorMessage(e)); }
          // Log to forensic run log so HR/compliance reviews see when the agent
          // paused for credentials.
          try {
            if (runLogId) {
              runLogBuffer.push({
                step: stepCount,
                timestamp: new Date().toISOString(),
                kind: 'sign_in_wall_pause',
                url: currentUrl,
                host: _wallHit.host,
                evidence: _wallHit.evidence
              });
              chrome.storage.local.set({ [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } }).catch((e) => {
                console.error('[_wallHit] Unhandled rejection:', e);
              });
            }
          } catch (e) { console.warn('[Sentinel] _wallHit run log failed:', getErrorMessage(e)); }
          // Wait until user resumes (Resume button → resumeAgent message)
          while (agentPaused && agentRunning) await sleep(500);
          if (!agentRunning) break;
          signInWallAckUrls.add(currentUrl);
          sendSilentUpdate('▶ Resumed after sign-in', stepCount);
          continue; // re-observe — the page should be past the wall now
        }
      } catch (_) { /* never crash the loop on detection issues */ }

      // (3.7.0) MFA challenge detection. If the freshly observed page text
      // matches a known MFA cue and we haven't already acknowledged this URL,
      // pause the agent, notify the desktop, and post a chat banner. The
      // existing pauseAgent/resumeAgent infra unblocks the loop.
      try {
        const _mfaHit = detectMfaInText(pageText, currentUrl);
        if (_mfaHit && mfaAckUrl !== currentUrl) {
          agentPaused = true;
          sendSilentUpdate(`⏸ MFA challenge detected (${_mfaHit}) — agent paused`, stepCount);
          notifyIfEnabled(`mfa_pause_${Date.now()}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon-48.png'),
            title: 'Sentinel Override — MFA required',
            message: `Approve / enter the code on ${currentUrl || 'the page'}, then click Resume.`
          });
          try {
            chrome.runtime.sendMessage({
              action: 'mfa_pause',
              url: currentUrl,
              hint: _mfaHit,
              stepNumber: stepCount
            }).catch((e) => {
              console.error('[_mfaHit] Unhandled rejection:', e);
            });
          } catch (e) { console.warn('[Sentinel] _mfaHit handler failed:', getErrorMessage(e)); }
          // Wait until user resumes
          while (agentPaused && agentRunning) await sleep(500);
          if (!agentRunning) break;
          mfaAckUrl = currentUrl;  // suppress re-pause for the SAME page
          sendSilentUpdate('▶ Resumed after MFA', stepCount);
          continue; // re-observe the page now that MFA is presumably handled
        }
      } catch (_) { /* never crash the loop on detection issues */ }

            // (3.65) CAPTCHA / bot detection. If the page is a known CAPTCHA page,
      // try to auto-solve or navigate around it before proceeding.
      try {
        const _captchaHit = detectCaptcha(currentUrl, pageText, allElements.length);
        if (_captchaHit && _captchaHit.confidence >= 0.5) {
          const _captchaResult = await recoverFromCaptcha({id: tab}, _captchaHit, currentUrl, goal);
          if (/^(solved|bypassed|went_back)$/.test(_captchaResult)) {
            // Page should be in a different state now, re-observe
            continue;
          }
          // If we can't auto-solve, pause and notify user
          if (_captchaResult === 'needs_user') {
            agentPaused = true;
            sendSilentUpdate('⏸ CAPTCHA requires manual solve — agent paused', stepCount);
            notifyIfEnabled(`captcha_${Date.now()}`, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icon-48.png'),
              title: 'Sentinel Override — CAPTCHA Detected',
              message: `Solve the CAPTCHA on ${currentUrl || 'the page'}, then click Resume.`
            });
            while (agentPaused && agentRunning) await sleep(500);
            if (!agentRunning) break;
            sendSilentUpdate('▶ Resumed after CAPTCHA', stepCount);
            continue;
          }
        }
      } catch (_captchaErr) { console.error('[Sentinel/CAPTCHA] Error:', getErrorMessage(_captchaErr)); }

      // Rate limiting
      await enforceRateLimit();

      // Anti-loop directives: force the model to make progress
      let loopDirective = '';

      // (3.8.0) Tightened read_page loop guard: 2+ consecutive read_page on the
      // same URL is a stall (page hasn't changed; rereading achieves nothing).
      if (history.length >= 2) {
        const last = history[history.length - 1] || null;
        const prior = history[history.length - 2] || null;
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
        const typeLoop = _detectActionTypeLoop(history, agentMemory);
        if (typeLoop.isLoop) {
          loopDirective = `\n⚠ ACTION-TYPE LOOP -- ${typeLoop.count} of last 4 actions were "${typeLoop.type}" with no productive memory write. The current strategy is not yielding data. You MUST switch action types now:\n1. If you have been navigating, STOP -- run execute_js with a key on the current page to extract whatever data is visible. The retry ladder will fall back to body.innerText automatically.\n2. If you have been clicking, try a different selector or use execute_js to read the DOM directly.\n3. If you have been read_page-ing, switch to extract / extract_list with a key.\n4. If extraction has failed twice on this page, finish() with what you have and move on rather than retrying.\n`;
        }
      }

      // Cache memory count for reuse in this section (perf: multiple uses below)
      const memCount = Object.keys(agentMemory).length;

      //    Also check for execute_js-heavy patterns in recent window (model escaping consecutive check)
      if (history.length >= 3 && !loopDirective) {
        let consecutiveNonProductive = 0;
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.action && NON_PRODUCTIVE_READ_ACTIONS.has(h.action.type)) {
            consecutiveNonProductive++;
          } else {
            break;
          }
        }
        // Also count execute_js in the last 8 steps — if too many without extract/note/finish, it's a loop
        // Iterate directly over history to avoid array copy (perf)
        const _recentCounts = { js: 0, extract: 0 };
        const _hl1 = history.length;
        const last8Start = Math.max(0, _hl1 - 8);
        for (let i = last8Start; i < _hl1; i++) {
          const h = history[i];
          if (!h || !h.action) continue;
          const type = h.action.type;
          if (type === 'execute_js') _recentCounts.js++;
          if (DATA_ACTIONS.has(type)) _recentCounts.extract++;
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
          const _historyLen = history.length;
          const last4Start = Math.max(0, _historyLen - 4);
          for (let i = last4Start; i < _historyLen; i++) {
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
      const _hl2 = history.length;
      const recentStart = Math.max(0, _hl2 - 5);
      for (let i = recentStart; i < _hl2; i++) {
        const h = history[i];
        if (h.action && TAB_ACTIONS.has(h.action.type)) recentTabActions++;
      }
      const isMakingProgress = recentTabActions > 0 || memCount > 0;
      if (stepCount >= 15 && !loopDirective && !isMakingProgress) {
        loopDirective = `\n⚠ STEP LIMIT -- You are on step ${stepCount} with no data extracted and no active tab work. You MUST call "finish" NOW with what you know, or use "execute_js" to extract data. Do not continue reading the same page.\n`;
      } else if (stepCount >= 20 && !loopDirective) {
        loopDirective = memCount > 0
          ? `\n⚠ STEP LIMIT -- You are on step ${stepCount}. You have ${memCount} extracted items. You MUST call "finish" NOW with a summary. No more reading or extracting.\n`
          : `\n⚠ STEP LIMIT -- You are on step ${stepCount}. If you have not found useful data, call "finish" with what you know. Do not continue looping.\n`;
      }

      // 3. Step-based soft cap: force a clean finish ~5 steps before the
      //    hard dynamic cap so the agent gets a chance to build a summary
      //    from collected memory instead of just being broken out of.
      const _softCap = Math.max(40, dynamicMaxSteps - 5);
      if (stepCount >= _softCap) {
        const memLines = Object.entries(agentMemory).slice(0, 10).map(([k, v]) => {
          const vStr = Array.isArray(v) ? v.slice(0, 5).map(i => String(i)).join(', ') : String(v).substring(0, 200);
          return `- ${k}: ${vStr}`;
        }).join('\n');
        const summary = memCount > 0
          ? `Task completed after ${stepCount} steps with ${memCount} data points extracted:\n\n${memLines}${memCount > 10 ? `\n...and ${memCount - 10} more items.` : ''}`
          : `Task timed out after ${stepCount} steps without extracting useful data.`;
        finished = true;
        sendSilentUpdate('Step limit reached -- finishing', stepCount);
        sendActionResult(stepCount, { type: 'finish', summary }, false);
        historyPush({ step: stepCount, action: { type: 'finish', summary }, result: summary });
        reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary }).catch((e) => {
          console.error('[summary] Unhandled rejection:', e);
        });
        sendReportUpdate('generating');
        break;
      }

      // (3.21.0) Recovery skill library — consult before the LLM call.
      // Skills can either AUTO-APPLY a deterministic recovery command
      // (skipping the LLM round-trip entirely) or inject a directive into
      // the next prompt. Built on the failure-pattern signals already
      // accumulated in history + consecutiveFailures + _lastAiCallMs.
      let _skillAutoCommand = null;
      try {
        const _lastHistEntry = history.length ? history[history.length - 1] : null;
        const _lastResult = _lastHistEntry && typeof _lastHistEntry.result === 'string' ? _lastHistEntry.result : '';
        const _lastFailed = _lastResult.startsWith('BLOCKED:') ||
                            _lastResult.startsWith('Element not found') ||
                            _lastResult.startsWith('Error') ||
                            _lastResult.startsWith('JS Error') ||
                            /returned (?:an empty|null|a non-serializable)/i.test(_lastResult) ||
                            /memory hygiene/i.test(_lastResult);
        const _skillCtx = {
          lastCommand: _lastHistEntry ? _lastHistEntry.action : null,
          lastResult: _lastResult,
          lastActionFailed: _lastFailed,
          history: history.slice(-5),
          consecutiveFailures,
          agentMemory,
          stepCount,
          dynamicMaxSteps,
          currentUrl,
          allElements,
          pageText,
          lastAiCallMs: _lastAiCallMs,
          consecutiveNavigates,
          productiveSteps
        };
        const _recovery = runRecoverySkills(_skillCtx);
        if (_recovery.appliedSkillIds.length) {
          sendSilentUpdate(`Recovery skills consulted: ${_recovery.appliedSkillIds.join(', ')}`, stepCount);
          tel.info('skill', `Recovery skills fired: ${_recovery.appliedSkillIds.join(', ')}`, { autoApplied: !!_recovery.autoApply, autoApplyType: _recovery.autoApply ? _recovery.autoApply.type : null, lastResult: _skillCtx.lastResult });
          // Forensic log
          try {
            if (runLogId) {
              runLogBuffer.push({
                step: stepCount,
                timestamp: new Date().toISOString(),
                kind: 'recovery_skills_consulted',
                skill_ids: _recovery.appliedSkillIds,
                auto_applied: !!_recovery.autoApply,
                auto_apply_type: _recovery.autoApply ? _recovery.autoApply.type : null
              });
              chrome.storage.local.set({ [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } }).catch((e) => {
                console.error('[_recovery] Unhandled rejection:', getErrorMessage(e));
              });
            }
          } catch (e) { console.warn('[Sentinel] _recovery run log failed:', getErrorMessage(e)); }
          // Activity stream surface — single item showing which skills fired
          try {
            const _label = _recovery.autoApply
              ? `Skill auto-applied: ${_recovery.appliedSkillIds[0] || 'unknown'}`
              : `Skills consulted: ${_recovery.appliedSkillIds.join(', ')}`;
            activityDone(stepCount, 'recovery-skills', _label, null);
          } catch (e) { console.warn('[Sentinel] recovery skills activity failed:', getErrorMessage(e)); }
        }
        if (_recovery.autoApply) {
          // Deterministic recovery — skip the LLM consult for this step.
          // Tag the command so the dispatch activity label shows the
          // recovery context.
          _skillAutoCommand = _recovery.autoApply;
        } else if (_recovery.promptInjection) {
          // Append to loopDirective so the LLM sees the directive on the
          // next consult call.
          loopDirective += _recovery.promptInjection;
        }
      } catch (e) {
        try { console.warn('[Sentinel/skills] consultation failed (non-fatal):', getErrorMessage(e)); } catch (_e) {
          // Console logging failed non-fatally
        }
      }

      // Progress indicator
      let apiWaitSeconds = 0;
      // (3.16.0) Begin the consult-ai activity item with a spinner. The
      // periodic timer updates the label with elapsed seconds so the user
      // sees the spinner DOING something even on long calls.
      activityStart(stepCount, 'consult-ai', `Consulting AI · call #${apiCallCount + 1}`);
      const progressTimer = setInterval(() => {
        apiWaitSeconds += 5;
        sendSilentUpdate(`Consulting AI... (${apiWaitSeconds}s)`, stepCount);
        activityUpdate(stepCount, 'consult-ai', `Consulting AI · ${apiWaitSeconds}s elapsed`);
        // (6.4) Phase thresholds: warn at 30s, show pause option at 60s
        if (apiWaitSeconds === 30) {
          sendAgentStatus('waiting', `⚠️ Waiting for API response (${apiWaitSeconds}s)...`);
        } else if (apiWaitSeconds >= 60 && apiWaitSeconds % 30 === 0) {
          sendAgentStatus('waiting', `⚠️ API still responding (${apiWaitSeconds}s) — you can Pause to cancel`);
        }
      }, 5000);

      sendAgentStatus('thinking', 'Analyzing context, deciding next action...');
      sendSilentUpdate(`Consulting AI -- call #${apiCallCount + 1}`, stepCount);
      tel.info('llm', `LLM call #${apiCallCount + 1} starting`, { stepCount, elementsCount: trimmedElements.length, pageTextLen: pageText.length, historyEntries: history.length, hasScreenshot: !!base64Image });
      command = null;
      // (3.9.0) Budget hint — tell the LLM how much step room it has left so
      // it can pace itself. Multi-portal investigations especially benefit
      // from knowing they have 200 vs 50 steps remaining.
      const _stepsRemaining = Math.max(0, dynamicMaxSteps - stepCount);
      const _budgetHint = `Current step: ${stepCount} of ${dynamicMaxSteps} ` +
        `(${_stepsRemaining} remaining; ${productiveSteps} productive bumps so far). ` +
        'Pace your work: extract / note / execute_js with key = productive (extends budget). ' +
        'Aimless read_page / scroll = unproductive (does not extend).';
      
      // v4.0 Vision-First Observation Override
      let _visionElements = null;
      let _visionElementMap = null;
      let _visionElementTree = '';
      let _visionMode = false;
      // v4.0: Vision-first ALWAYS active
      {
        try {
          console.log('[Sentinel/v4] Vision observation starting...');
          const visionResult = await _visionObserve(tab, currentUrl);
          if (visionResult.elements.length) {
            _visionElements = visionResult.elements;
            _visionElementMap = new Map(visionResult.elements.map(e => [e.index, e]));
            _visionElementTree = visionResult.elementTree;
            _visionMode = true;
            if (visionResult.pageText && visionResult.pageText.length > pageText.length) {
              pageText = visionResult.pageText;
            }
            trimmedElements = visionResult.elements.slice(0, CONFIG.maxElements).map(e => ({
              selector: `[data-sentinel-index="${e.index}"]`,
              text: e.text || '',
              type: e.tag || 'div',
              index: e.index,
              rect: e.rect,
              isClickable: e.isClickable,
              isInput: e.isInput
            }));
            allElements = [...trimmedElements]; // reassign (not mutate) so cached observation.elements stays intact
            console.log(`[Sentinel/v4] Vision: ${_visionElements.length} indexed elements`);
          }
        } catch (e) {
          console.warn('[Sentinel/v4] Vision observe failed:', e);
        }
      }

      const agentState = { apiCallCount, agentMemory, visionMode: _visionMode, visionElementTree: _visionElementTree, visionElements: _visionElements, visionElementMap: _visionElementMap, consecutiveFailures, currentStrategies, agentPlan, currentPlanStep, loopDirective, screenshotMeta, budgetHint: _budgetHint, clientKnowledgeText, pendingVerification, quickMode: _runSettings.quickMode, cdpFallbackActive: _cdpFallbackActive };
      // Cap history window for prompt to control token cost (CONFIG.historyWindow).
      // Also strip any base64Image / screenshot fields from past entries -- only the
      // most recent observation needs the image (passed separately as base64Image arg).
      const promptHistory = [];
      const _hl3 = history.length;
      const historyStart = Math.max(0, _hl3 - CONFIG.historyWindow);
      for (let i = historyStart; i < _hl3; i++) {
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
      let _aiCallError = null;
      // Drain one sub-command from the repeat_for_each queue before consulting LLM
      if (_pendingCommandQueue.length) {
        clearInterval(progressTimer);
        base64Image = null;
        if (_visionMode) { try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: 3000 }); } catch (_e) { /* vision cleanup failed - non-fatal */ } }
        command = _pendingCommandQueue.shift();
        activityDone(stepCount, 'consult-ai', `Queued sub-command: ${command.type}`, null);
        _lastAiCallMs = 0;
      // (3.21.0) If a recovery skill auto-applied, use that command and
      // skip the LLM consult entirely. Saves ~5-30s per recovery + an LLM
      // call's worth of cost.
      } else if (_skillAutoCommand) {
        clearInterval(progressTimer);
        base64Image = null;
        if (_visionMode) { try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: 3000 }); } catch (_e) { /* vision cleanup failed - non-fatal */ } }
        command = _skillAutoCommand;
        activityDone(stepCount, 'consult-ai', 'Skipped (skill auto-applied)', null);
        _lastAiCallMs = 0;
      } else {
        const _aiStart = Date.now();

      // ═══════════════════════════════════════════════════════════
      // v4.0 VISION-FIRST LLM CALL (Browser Use architecture)
      // ═══════════════════════════════════════════════════════════
      if (_visionMode && _visionElements) {
        const _visionHistoryParts = [];
        const visionStart = Math.max(0, promptHistory.length - 6);
        for (let i = visionStart; i < promptHistory.length; i++) {
          const h = promptHistory[i];
          if (!h || !h.action) continue;
          const a = h.action;
          const actionText = a.text ? (typeof a.text === 'string' ? a.text.substring(0, 40) : String(a.text || '').substring(0, 40)) : null;
          const actionTextStr = actionText ? ` "${actionText}"` : '';
          const stepResult = typeof h.result === 'string' ? h.result.substring(0, 80) : String(h.result || '').substring(0, 80);
          _visionHistoryParts.push(`Step ${h.step || '?'}: ${a.type}${a.index ? `(${a.index})` : ''}${actionTextStr} -> ${stepResult}`);
        }
        const _visionHistory = _visionHistoryParts.join('\n');

        const _visionSystemPrompt = [
          'You are Sentinel, an AI agent that automates browser tasks by looking at screenshots with numbered elements.',
          '',
          '<rules>',
          '1. Interactive elements on the page have [index] numbers shown as green labels.',
          '2. You MUST reference elements by their [index] number.',
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
          'Respond with ONLY valid JSON, no markdown:',
          '{"thinking":"what you see and why","evaluation":"previous action success/fail/partial","memory":"progress notes","next_goal":"one clear goal","action":{"type":"...","index":N,"text":"...","direction":"up|down","url":"...","code":"..."}}',
          '</output_format>'
        ].join('\n');

        const _visionUserContent = [
          `Goal: ${goal}`,
          `URL: ${currentUrl}`,
          `Step: ${stepCount}/${dynamicMaxSteps}`,
          '',
          'Elements:',
          _visionElementTree || '(none)',
          '',
          'History:',
          _visionHistory || '(first step)',
          '',
          'What is your next action?'
        ].join('\n');

        // Build messages with screenshot
        const _visionMessages = [
          { role: 'system', content: _visionSystemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: _visionUserContent },
              ...(base64Image ? [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] : [])
            ]
          }
        ];

        try {
          const _vProviderConfig = await getActiveProvider().catch(() => null);
          const _vEndpoint = (_vProviderConfig && _vProviderConfig.endpoint) || 'https://api.z.ai/api/coding/paas/v4/chat/completions';
          const _vApiKey = (_vProviderConfig && _vProviderConfig.apiKey) || '';
          const _vModel = (_vProviderConfig && _vProviderConfig.model) || 'glm-5';
          // Skip vision LLM call for Anthropic — its image format differs from OpenAI
          if (_vEndpoint.includes('api.anthropic.com')) {
            throw new Error('Vision LLM not supported for Anthropic provider');
          }
          const _vCtrl = new AbortController();
          const _vTimeoutId = setTimeout(() => _vCtrl.abort(), 45000);
          let _vResponse;
          // Prepare request body safely
          let _visionBody;
          try {
            _visionBody = JSON.stringify({
              model: _vModel,
              messages: _visionMessages,
              max_tokens: 600,
              temperature: 0.1
            });
          } catch (_stringifyErr) {
            console.warn('[Sentinel/v4] Vision payload serialization failed:', getErrorMessage(_stringifyErr));
            break; // Exit vision mode on serialization failure
          }
          try {
            _vResponse = await fetch(
              _vEndpoint,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${_vApiKey}`
                },
                body: _visionBody,
                signal: _vCtrl.signal
              }
            );
          } finally {
            clearTimeout(_vTimeoutId);
          }
          if (_vResponse && !_vResponse.ok) {
            console.warn('[Sentinel/v4] Vision LLM non-ok response:', _vResponse.status);
          } else if (_vResponse && _vResponse.ok) {
            let _vData;
            try {
              _vData = await _vResponse.json();
            } catch (_jsonErr) {
              console.warn('[Sentinel/v4] Vision LLM response not JSON:', _vResponse.status);
              _vData = null; // Explicitly mark as failed
              // Don't break - let the null check on line 4433 handle it
            }
            const _vRaw = _vData && _vData.choices && Array.isArray(_vData.choices) && _vData.choices[0] && _vData.choices[0].message
              ? (_vData.choices[0].message.content || '') : '';
            
            // Parse structured JSON output
            let _vParsed = null;
            try { _vParsed = JSON.parse(_vRaw); } catch(_e) {
              // Try extracting from code block
              const _m = _vRaw.match(CODE_BLOCK_REGEX);
              if (_m && _m[1]) try { _vParsed = JSON.parse(_m[1].trim()); } catch(_e2) {}
            }

            if (_vParsed && _vParsed.action) {
              const _va = _vParsed.action;
              // Map vision action types to legacy command format
              switch (_va.type) {
                case 'click':
                  command = { type: 'click_at', _visionIndex: (typeof _va.index === 'number' && !Number.isNaN(_va.index) && _va.index > 0) ? _va.index : null, _visionAction: true };
                  break;
                case 'input':
                  command = { type: 'type', text: _va.text || '', _visionIndex: (typeof _va.index === 'number' && !Number.isNaN(_va.index) && _va.index > 0) ? _va.index : null, _visionAction: true };
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
                  command = { type: 'execute_js', code: 'return document.body.innerText.substring(0, 8000)', _visionAction: true };
                  break;
                case 'execute_js':
                  command = { type: 'execute_js', code: _va.code || '', _visionAction: true };
                  break;
                case 'done':
                  command = { type: 'finish', summary: _va.text || _vParsed.memory || 'Task complete', _visionAction: true };
                  break;
                default:
                  command = { type: 'note', text: `Vision: unknown action ${_va.type}`, _visionAction: true };
              }
              // Store thinking/evaluation for logging
              if (_vParsed.thinking) sendSilentUpdate(`[Vision] ${_vParsed.thinking}`, stepCount);
              console.log('[Sentinel/v4] Vision decided:', _va.type, 'index:', _va.index || 'N/A');
            } else {
              // Fallback: couldn't parse structured output, try the legacy LLM path
              console.warn('[Sentinel/v4] Vision: could not parse structured output, falling back to legacy');
            }
          }
        } catch (e) {
          console.warn('[Sentinel/v4] Vision LLM call failed, falling back:', getErrorMessage(e));
          try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: 3000 }); } catch (_e) { /* vision cleanup failed - non-fatal */ }
        }
      }

      // If vision produced a command, do the bookkeeping that the legacy path's
      // finally block would have done (it won't run since we skip it below).
      if (command && command.type) {
        clearInterval(progressTimer);
        _lastAiCallMs = Date.now() - _aiStart;
        try { sendHeartbeat(_lastAiCallMs); } catch (_e) { /* non-fatal */ }
        // Clear SoM overlay so it doesn't interfere with action execution
        try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: 3000 }); } catch (_e) { /* vision cleanup failed - non-fatal */ }
        base64Image = null; // release screenshot memory
        agentState.apiCallCount++; // vision path bypasses callLLMWithRetry which normally increments this
        apiCallCount = agentState.apiCallCount;
        activityDone(stepCount, 'consult-ai', `Vision decided: ${command.type}`, null);
        tel.info('llm', `Vision LLM decided: ${command.type}`, { durationMs: _lastAiCallMs, commandType: command.type });
      }

      // Legacy LLM fallback (only if vision didn't produce a command)
      if (!command || !command.type) {
        try {
          command = await callLLMWithRetry(
            trimmedElements, allElements.length, pageText, base64Image,
            goal, promptHistory, stepCount, currentUrl,
            0, // retryCount
            CONFIG,
            agentState
          );
        } catch (e) {
          _aiCallError = e;
          command = { type: 'note', text: 'API call failed: ' + (getErrorMessage(e)) };
        } finally {
          _lastAiCallMs = Date.now() - _aiStart;
          clearInterval(progressTimer);
          try { sendHeartbeat(_lastAiCallMs); } catch (_e) { /* non-fatal */ }
          // (9.2) Broadcast running cost estimate after each LLM call
          try {
            const _cost = agentState.estimatedCostUsd || 0;
            if (_cost > 0 || agentState.totalInputTokens > 0) {
              sendCostUpdate(_cost, agentState.totalInputTokens || 0, agentState.totalOutputTokens || 0, agentState.apiCallCount || 0);
            }
          } catch (_e) { /* non-fatal */ }
          // v4.0: Clear SoM overlay so it doesn't interfere with action execution
          try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: 3000 }); } catch(e) {
            console.warn('[Sentinel] Failed to clear SoM overlay:', getErrorMessage(e));
            // Non-fatal but could affect next action execution
          }
          base64Image = null; // release screenshot memory after LLM call
          // Sync apiCallCount — always, even on failure. callLLM increments
          // agentState.apiCallCount before the fetch, so if the call throws the
          // module-level var must still be updated or the final log shows 0.
          apiCallCount = agentState.apiCallCount;
          // (3.16.0) Mark the consult-ai activity as done or failed.
          if (_aiCallError) {
            activityFail(stepCount, 'consult-ai', 'AI call failed: ' + getErrorMessage(_aiCallError || 'unknown'), null);
            tel.error('llm', 'LLM call failed', { durationMs: _lastAiCallMs, error: getErrorMessage(_aiCallError) });
          } else if (command && command.type) {
            activityDone(stepCount, 'consult-ai', 'AI decided: ' + command.type, null);
            tel.info('llm', 'LLM decided: ' + command.type, { durationMs: _lastAiCallMs, commandType: command.type, hasSelector: !!command.selector, hasRef: !!command.ref });
          } else {
            activityDone(stepCount, 'consult-ai', 'AI consultation complete', null);
            tel.info('llm', 'LLM call complete (no command)', { durationMs: _lastAiCallMs });
          }
        }
      }
      } // closes } else { at line 4211 (aiStart/LLM call block)

      // apiCallCount is now synced in the finally block above (handles both success and failure).

      // Guard: callLLM returns null when no API key is configured (early return at
      // llm-client.js:904). Downstream code accesses command.type/.text/etc unconditionally,
      // so synthesize a note rather than crashing on null dereference.
      if (!command) {
        command = { type: 'note', text: 'No response from AI — check API key and provider settings.' };
      }

      // Advance plan step if the LLM signalled it's done with the current step
      if (command.advance_plan && agentPlan && currentPlanStep < agentPlan.length - 1) {
        currentPlanStep++;
        const nextStep = agentPlan[currentPlanStep];
        const progress = `[${currentPlanStep + 1}/${agentPlan.length}]`;
        sendSilentUpdate(`📋 Step ${progress}: ${nextStep}`);
        delete command.advance_plan;
      }

      // Template substitution: replace ::key:: with memory values
      if (typeof command.text === 'string') {
        command.text = command.text.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (typeof command.url === 'string') {
        command.url = command.url.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (typeof command.value === 'string') {
        command.value = command.value.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }

      // (#10) Sanity-check ref ids the LLM returns. A ref that doesn't appear
      // in the most recent observation almost always means the model invented
      // it (or carried it over from a stale step). We log a warning but DON'T
      // block — the content script handles stale-ref fallback to selector.
      if (typeof command.ref === 'string') {
        const refExists = trimmedElements.some(e => e.ref === command.ref);
        if (!refExists) {
          try {
            console.warn(`[agent-engine] LLM returned unknown ref "${command.ref}" not in latest observation. Content script will fall back to selector if available.`);
          } catch (e) { console.warn('[Sentinel] unknown ref logging failed:', getErrorMessage(e)); }
        }
      }

      // Validate selectors against the trimmed list. Skip selector validation
      // when the LLM supplied a ref — refs are the preferred handle and the
      // content script resolves them directly. Also accept commands that have
      // ONLY a ref (no selector at all) for the ref-driven actions.
      if (REF_DRIVEN_ACTIONS.has(command.type) && command.selector && !command.ref) {
        const selectorExists = trimmedElements.some(e => e.selector === command.selector);
        if (!selectorExists) {
          sendSilentUpdate('Invalid selector -- re-asking AI', stepCount);
          consecutiveFailures++;
          historyPush({ step: stepCount, action: command, result: `Invalid selector "${command.selector}" -- not in element list.` });
          await persistHistory();
          await sleep(1000);
          continue;
        }
      }

      // Handle finish — but block premature finishes (model giving up without trying)
      if (command.type === 'finish') {
        // (3.13.0) Pre-finish data completeness check. Parses the goal
        // text for "extract X, Y, Z" patterns and verifies memory has
        // evidence for each field. Blocks finish (once) if MORE THAN HALF
        // of the asked fields lack token-evidence in memory + notes.
        // Saves the "agent finished but CVSS missing" failure mode by
        // forcing one more extraction pass with the retry ladder.
        try {
          const _completenessGap = _checkPreFinishCompleteness(goal, agentMemory, history);
          // Only block ONCE per run -- if the agent retries finish after
          // the block, we let it through (the gap may be genuinely
          // unextractable, like data behind auth).
          const _alreadyBlocked = history.some(h => h && h.result &&
            typeof h.result === 'string' &&
            h.result.startsWith('BLOCKED: pre-finish completeness'));
          if (_completenessGap && !_alreadyBlocked && stepCount < (dynamicMaxSteps - 5)) {
            historyPush({ step: stepCount, action: command, result: 'BLOCKED: pre-finish completeness -- ' + _completenessGap });
            trimHistory();
            sendSilentUpdate('Finish blocked — completeness check requesting one more extraction pass', stepCount);
            await sleep(800);
            continue;
          }
        } catch (_) { /* completeness check failure is non-fatal */ }

        const memKeys = Object.keys(agentMemory || {});
        const memCount = memKeys.length;
        const noteCount = history.reduce((acc, h) => acc + (h.action && h.action.type === 'note' ? 1 : 0), 0);
        const hasData = memCount > 0 || noteCount > 0;

        // Block finish if no real data was extracted and we haven't tried enough
        if (!hasData && stepCount < 8) {
          historyPush({ step: stepCount, action: command, result: 'BLOCKED: Cannot finish without extracting data first. Read the page or use execute_js to get real data.' });
          await persistHistory();
          sendSilentUpdate('Finish blocked — must extract real data first', stepCount);
          await sleep(1000);
          continue;
        }

        // Block finish if memory only contains failed results ("Done", empty strings)
        const hasRealData = memCount > 0 && Object.values(agentMemory).some(v => {
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          return s.length > 10 && s !== 'Done';
        });
        if (!hasRealData && hasData && stepCount < 15) {
          historyPush({ step: stepCount, action: command, result: 'BLOCKED: No real data in memory. Use execute_js with key to extract actual page content.' });
          await persistHistory();
          sendSilentUpdate('Finish blocked — extracted data is empty', stepCount);
          await sleep(1000);
          continue;
        }


        // (3.50.0) Multi-article completion guard: don't let the agent finish
        // with just link lists — it must actually OPEN and READ the articles.
        try {
          const _articleGoal = (typeof goal === 'string') ? goal.match(/\b(?:top|first|best|recent)\s+(\d{1,2})\s+(articles?|stories|posts?|items?|headlines?|results?)\b/i) : null;
          if (_articleGoal && !command.force) {
            const _targetN = _articleGoal[1] ? (parseInt(_articleGoal[1], 10) || 10) : 10;
            const _openTabs = history.reduce((acc, h) => acc + (h.action && h.action.type === 'open_tab' ? 1 : 0), 0);
            const _summaryKeys = memKeys.filter(k =>
              k.includes('summary') || k.includes('_summary') || k.match(/article[_\s]?\d/i)
            );
            // Block: haven't opened ANY article tabs AND no summaries written
            if (_openTabs === 0 && !_summaryKeys.length && noteCount === 0) {
              console.warn('[Sentinel/multi-article] Blocking premature finish —', _targetN, 'articles requested, 0 opened/read');
              historyPush({ step: stepCount, action: command, result: `BLOCKED: premature finish — goal asks for ${_targetN} articles. Must open_tab article URLs and read each page before finishing.` });
              await persistHistory();
              sendSilentUpdate('Finish blocked — must read articles first', stepCount);
              await sleep(1000);
              continue;
            }
          }
        } catch (_) { /* non-fatal */ }

        // (3.7.0) Configuration-change verification gate. If the goal involves
        // adding/changing config on a known platform (firewall, M365, RMM, etc.),
        // require a Save/Apply/Commit click + a follow-up read_page or extract
        // BEFORE allowing finish. Prevents false-positive completions where the
        // agent declares "done" without actually committing the change.
        try {
          const _gateGoal = (typeof goal === 'string') ? goal : '';
          const _gateUrl  = (typeof currentUrl === 'string') ? currentUrl : '';
          if (isConfigChangeGoal(_gateGoal, _gateUrl)) {
            sendAgentStatus('verifying', 'Checking if configuration change was committed...');
            if (!hasRecentCommitClick(history)) {
              const blockMsg = 'BLOCKED: configuration change detected but no Save/Apply/Commit click in recent history. Find and click the Apply/Save/Commit/Deploy button before finishing.';
              historyPush({ step: stepCount, action: command, result: blockMsg });
              await persistHistory();
              sendSilentUpdate('Finish blocked — change not yet committed', stepCount);
              await sleep(1000);
              continue;
            }
            if (!hasPostCommitVerification(history)) {
              const blockMsg = 'BLOCKED: change committed but not verified. Re-read the page or extract from the relevant table to confirm the change is active before finishing.';
              historyPush({ step: stepCount, action: command, result: blockMsg });
              await persistHistory();
              sendSilentUpdate('Finish blocked — change not verified', stepCount);
              await sleep(1000);
              continue;
            }
            sendAgentStatus('verifying', 'Change committed and verified.');
          }
        } catch (_) { /* non-fatal: never let the gate itself crash the loop */ }

        // (3.8.3) Don't-give-up-early guard for multi-portal investigations.
        // If the agent calls finish before step 40 with "incomplete" markers
        // in the summary, push back and force it to try alternative strategies
        // (Microsoft Graph API via read_network_requests, alternate URLs,
        // Log Analytics KQL, etc.) before declaring done.
        try {
          const _summary = String(command.summary || '').toLowerCase();
          const _isMultiPortal = (function() {
            try {
              const RE = /\b(entra|exchange|purview|onedrive|sharepoint|teams|intune|defender|m365|admin\.microsoft|portal\.azure|sentinelone|virustotal)\b/gi;
              const matches = (goal || '').match(RE) || [];
              return matches.length >= 2;
            } catch (_) { return false; }
          })();
          const _hasIncompleteMarker = /\b(incomplete|step budget|could not access|unable to|exhausted|not yet|did not complete|did not reach|was unable|failed to extract)\b/i.test(_summary);
          if (_isMultiPortal && stepCount < 80 && _hasIncompleteMarker) {
            const blockMsg = `BLOCKED: finish called early with "incomplete" markers on a multi-portal investigation (${stepCount} steps; threshold 80). You have substantial budget remaining (dynamic cap 300, +25 per productive action). Try alternative strategies before declaring done:\n` +
              `  1. Microsoft Graph API: read_network_requests filter for graph.microsoft.com to capture the underlying JSON the UI is rendering.\n` +
              '  2. Alternate URL paths: Purview audit moved to purview.microsoft.com/audit/auditsearch (NOT /auditlogsearch).\n' +
              '  3. Cross-origin iframes block DOM scraping but the Graph API is visible. Use it.\n' +
              '  4. Log Analytics KQL for >60-day windows that the UI doesn\'t support.\n' +
              'Re-attempt the investigation using one of these paths before calling finish again.';
            historyPush({ step: stepCount, action: command, result: blockMsg });
            await persistHistory();
            sendSilentUpdate('Finish blocked — try Graph API or alternate URL before giving up', stepCount);
            await sleep(1000);
            continue;
          }
        } catch (_) { /* never let the guard itself crash the loop */ }

        finished = true;
        consecutiveFailures = 0;
        sendSilentUpdate('Task complete', stepCount);

        let finalSummary = command.summary || '';

        // Clean up memory — filter out failed/timed-out/empty entries
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

        // Don't append raw memory to the summary — let the report generator handle it
        // Only include a clean reference if there's valuable data
        const cleanKeys = Object.keys(cleanMemory);
        if (cleanKeys.length) {
          // Let the LLM's summary stand on its own — the report will incorporate the data
          finalSummary += `\n\n📊 **${cleanKeys.length} data points collected** — full analysis in the report below.`;
        }

        // Capture report data BEFORE history gets cleared at loop exit
        reportData = {
          goal,
          history: history.slice(),
          agentMemory: { ...agentMemory },
          agentPlan: agentPlan ? agentPlan.slice() : null,
          stepCount,
          apiCallCount,
          tabContexts: getAllTabContexts().map(tc => ({ label: tc.label, url: tc.url, hasScreenshot: !!tc.snapshot }))
        };

        // (3.9.1) Hallucination hard-stop. If the summary's claim density
        // wildly exceeds the actual evidence the agent collected, block and
        // force a re-write. This catches the "list 10 articles when only 1
        // was read" pattern that sneaks past the system prompt's anti-
        // hallucination rule. Skipped for ticket-style investigation finishes
        // where claim counts can be high by design (per-portal sections).
        try {
          const _isTicketStyle = isTicketInvestigationGoal(goal);
          if (!_isTicketStyle) {
            const _risk = evaluateHallucinationRisk(finalSummary, agentMemory, history);
            if (_risk && _risk.risky) {
              const blockMsg = `BLOCKED: hallucination risk detected — ${_risk.reason} Either: (a) trim the summary to ONLY items you actually read/extracted, or (b) clearly tag unread items with "headline only — not read in this run". Then call finish again.`;
              historyPush({ step: stepCount, action: command, result: blockMsg });
              await persistHistory();
              sendSilentUpdate('Finish blocked — claim density exceeds evidence', stepCount);
              await sleep(1000);
              continue;
            }
          }
        } catch (_) { /* never crash the loop on hallucination check */ }

        // (3.14.0) Ticket-mode output formatting. Dispatches to one of six
        // MSP-aware templates based on settings:
        //   - chrome.storage.local.ticketMode === true  → always format
        //   - chrome.storage.local.ticketFormat         → 'auto' or specific format
        // When ticketMode is off, we still auto-apply FINAL_NOTES on
        // ticket-style goals (legacy 3.8.0 behavior) for backward compatibility.
        try {
          // (3.41.0) Read from run-stable settings cache instead of storage.
          const _tmEnabled = !!_runSettings.ticketMode;
          const _tmFormat = (_runSettings.ticketFormat || 'auto').toString();
          const _autoApplyLegacy = !_tmEnabled && isTicketInvestigationGoal(goal);
          if (_tmEnabled || _autoApplyLegacy) {
            const tech = await getTechnicianInfo();
            const fmt = _tmEnabled ? _tmFormat : 'FINAL_NOTES';
            finalSummary = formatTicketOutput(fmt, finalSummary, goal, tech, {
              stepCount, apiCallCount
            });
          }
        } catch (e) { console.warn('[Sentinel] ticket formatter failed:', getErrorMessage(e)); }

        // (3.9.0) Final run-log entry + broadcast runLogId so the popup can offer Export.
        try {
          if (runLogId) {
            runLogBuffer.push({
              step: stepCount,
              timestamp: new Date().toISOString(),
              kind: 'run_finish',
              url: currentUrl,
              summary_preview: typeof finalSummary === 'string' ? finalSummary.substring(0, 500) : ''
            });
            await chrome.storage.local.set({
              [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now(), completed: true }
            });
            // (3.25.1) Storage telemetry: run-log finalized. Bracketing pair
            // with the run_log_opened event so postmortem export pulls the
            // full slice between them.
            try { tel.info('storage', `Run log finalized: ${runLogId} (${runLogBuffer.length} entries)`, { runLogId, entries: runLogBuffer.length, stepCount, apiCallCount }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
            // (3.27.0) Tell the persistence layer this run is done. Flushes
            // the buffer one last time and stamps finishedAt on the index.
            // Awaited so the storage write completes before the SW potentially
            // suspends after agent_finished fires.
            try { await telEndRun(runLogId); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
            // (3.14.0) Stamp the index entry as completed with final step count.
            // (3.30.0) Compute the trust score and attach it to the index entry
            // so the popup-side Run Log list can render it without recomputing.
            let _trustScore = null;
            try {
              const _skillStats = getSkillStats();
              _trustScore = computeTrustScore({
                totalSteps: stepCount,
                failedSteps,
                productiveSteps,
                consecutiveFailureMax,
                skillStats: _skillStats,
                apiCallCount,
                planLength: Array.isArray(agentPlan) ? agentPlan.length : 0,
                planCompleted: Math.min(currentPlanStep, Array.isArray(agentPlan) ? agentPlan.length : 0)
              });
              tel.info('lifecycle', `Trust score: ${_trustScore.score}/100 (${_trustScore.band})`, {
                score: _trustScore.score,
                band: _trustScore.band,
                breakdown: _trustScore.breakdown,
                runLogId
              });
            } catch (_) { /* non-fatal */ }
            try {
              await _updateRunLogIndex(runLogId, {
                completed: true,
                finishedAt: Date.now(),
                stepCount,
                apiCallCount,
                // (3.30.0) Persist score on the index for the Run Log UI.
                trustScore: _trustScore ? _trustScore.score : null,
                trustBand: _trustScore ? _trustScore.band : null,
                trustBreakdown: _trustScore ? _trustScore.breakdown : null
              });
            } catch (_) { /* non-fatal */ }
            try {
              chrome.runtime.sendMessage({
                action: 'run_log_available',
                runLogId,
                entryCount: runLogBuffer.length,
                trustScore: _trustScore ? _trustScore.score : null,
                trustBand: _trustScore ? _trustScore.band : null
              }).catch((e) => {
                console.error('[_skillStats] Unhandled rejection:', e);
              });
            } catch (e) { console.warn('[Sentinel] _skillStats telemetry failed:', getErrorMessage(e)); }
          }
        } catch (e) { console.warn('[Sentinel] skill stats block failed:', getErrorMessage(e)); }

        // (3.31.0) Compute trust score for the agent_finished payload.
        // We recompute here rather than reaching into the run-log block's
        // scope (where _trustScore is declared) — keeps the dependency
        // explicit and the cost is one cheap pure-function call.
        const _finalTrustScore = (function () {
          try {
            return computeTrustScore({
              totalSteps: stepCount,
              failedSteps,
              productiveSteps,
              consecutiveFailureMax,
              skillStats: getSkillStats(),
              apiCallCount,
              planLength: Array.isArray(agentPlan) ? agentPlan.length : 0,
              planCompleted: Math.min(currentPlanStep, Array.isArray(agentPlan) ? agentPlan.length : 0),
            });
          } catch (_) { return null; }
        })();
        const _retrySuggestions = (function () {
          try { return suggestRetryActions(_finalTrustScore); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); return []; }
        })();
        // Telemetry for the suggestions emitted — useful for "did anyone
        // actually use these?" questions later. One info event with the
        // count + ids, individual suggestions visible by expanding payload.
        try {
          if (_retrySuggestions.length) {
            tel.info('lifecycle', `Retry suggestions: ${_retrySuggestions.length} (${_retrySuggestions.map(s => s.id).join(', ')})`, {
              count: _retrySuggestions.length,
              suggestions: _retrySuggestions.map(s => ({ id: s.id, severity: s.severity, applyKeys: s.applyKeys })),
              scoreBand: _finalTrustScore ? _finalTrustScore.band : null
            });
          }
        } catch (_e) { /* mode directive logging non-fatal */ }
        chrome.runtime.sendMessage({
          action: 'agent_finished',
          summary: finalSummary,
          // (3.30.0) Trust score and (3.31.0) retry suggestions in one payload.
          trustScore: _finalTrustScore,
          retrySuggestions: _retrySuggestions,
          // (3.31.0) Echo the goal so chat can re-fire it on one-click retry.
          originalGoal: goal,
          // (3.38.0) Real token counts accumulated from API response.usage each step.
          tokenUsage: {
            input:       agentState.totalInputTokens   || 0,
            output:      agentState.totalOutputTokens  || 0,
            total:      (agentState.totalInputTokens   || 0) + (agentState.totalOutputTokens || 0),
            cacheRead:   agentState.totalCacheReadTokens  || 0,
            cacheWrite:  agentState.totalCacheWriteTokens || 0,
          }
        }).catch((e) => {
          console.error('[_retrySuggestions] Unhandled rejection:', e);
        });
        sendReportUpdate('generating');
        saveLearnedPattern(goal, history, true);
        break;
      }

      // Handle note
      // repeat_for_each: iterate over a memory array and run sub-actions for each item.
      // Sub-commands are pushed to _pendingCommandQueue and drained before LLM consults.
      if (command.type === 'repeat_for_each') {
        const itemsKey = command.items_key;
        const items = itemsKey && Array.isArray(agentMemory[itemsKey]) ? agentMemory[itemsKey] : (Array.isArray(command.items) ? command.items : []);
        const doActions = Array.isArray(command.do) ? command.do : [];
        if (!items.length || !doActions.length) {
          historyPush({ step: stepCount, action: command, result: `repeat_for_each: nothing to iterate (items=${items.length}, actions=${doActions.length})` });
          await persistHistory();
          continue;
        }
        const MAX_REPEAT_ITEMS = 50;
        if (items.length > MAX_REPEAT_ITEMS) {
          historyPush({ step: stepCount, action: command, result: `repeat_for_each: capped at ${MAX_REPEAT_ITEMS} items (list had ${items.length})` });
          items.splice(MAX_REPEAT_ITEMS);
        }
        sendSilentUpdate(`repeat_for_each: ${items.length} items × ${doActions.length} actions`, stepCount);
        const iterVar = command.item_var || 'item';
        // Pre-compile regex for template substitution - created once, reused for all iterations
        const _templateRegex = new RegExp(`\\{\\{${iterVar}(?:\\.([\\w]+))?\\}\\}`, 'g');
        for (const _item of items) {
          for (const _act of doActions) {
            if (!_act || !_act.type) continue;
            // (3.41.0) Use structuredClone + JSON template substitution for
            // correctness (handles undefined fields, circular-ref-safe) and
            // speed (avoids double-parse on deeply nested action objects).
            const _resolvedStr = JSON.stringify(structuredClone(_act)).replace(
              _templateRegex,
              (_, field) => field ? (typeof _item === 'object' && _item !== null ? String(_item[field] ?? '') : '') : String(_item)
            );
            let _resolved;
            try { _resolved = JSON.parse(_resolvedStr); } catch (e) {
              console.error('[Sentinel] Error in agent-engine.js:', e);
              historyPush({ step: stepCount, action: _act, result: `repeat_for_each: skipping malformed item — JSON parse failed: ${getErrorMessage(e)}` });
              continue;
            }
            _pendingCommandQueue.push(_resolved);
          }
        }
        historyPush({ step: stepCount, action: command, result: `repeat_for_each queued ${_pendingCommandQueue.length} sub-actions for ${items.length} items` });
        productiveSteps++;
        await persistHistory();
        continue;
      }

      if (command.type === 'verify') {
        // (3.40.0) Read back an element to confirm a config change persisted.
        // Route through execute_command/extract to use the full resolveCommandTarget()
        // fallback chain (handles refs, shadow DOM, aria-label, XPath, etc.).
        // extract with attribute:'text' returns innerText; for inputs use attribute:'value'.
        const _verifyExpected = typeof command.expected === 'string' ? command.expected.trim() : '';
        let _verifyActual = '';
        try {
          // Try value attribute first (for inputs), then fall back to text
          const _extractText = await sendMessageWithRetry(tab, {
            action: 'execute_command',
            command: { type: 'extract', key: '_verify_val', selector: command.selector, ref: command.ref, attribute: 'text' }
          }, 2, 1200).catch(() => null);
          const _extractValue = await sendMessageWithRetry(tab, {
            action: 'execute_command',
            command: { type: 'extract', key: '_verify_val2', selector: command.selector, ref: command.ref, attribute: 'value' }
          }, 1, 800).catch(() => null);
          // Parse JSON result from extract action: { key, value }
          const _parseExtract = (r) => {
            if (!r || typeof r !== 'string') return '';
            try { const p = JSON.parse(r); return (p && typeof p.value === 'string') ? p.value.trim() : ''; } catch (_parseErr) { return ''; }
          };
          const _textVal = _parseExtract(_extractText);
          const _inputVal = _parseExtract(_extractValue);
          _verifyActual = _inputVal || _textVal;
        } catch (e) { console.warn('[Sentinel] verify extract parse failed:', getErrorMessage(e)); _verifyActual = null; }
        let _verifyOutcome;
        if (!_verifyActual) {
          _verifyOutcome = `verify: element not found or empty (${command.selector || command.ref || 'no selector'})`;
        } else if (!_verifyExpected) {
          _verifyOutcome = `verified (read-back): ${_verifyActual.slice(0, 200)}`;
        } else if (typeof _verifyActual === 'string' && typeof _verifyExpected === 'string') {
          // Cache toLowerCase() to avoid redundant string operations (perf)
          const _actualLower = _verifyActual.toLowerCase();
          const _expectedLower = _verifyExpected.toLowerCase();
          if (_actualLower.includes(_expectedLower)) {
            _verifyOutcome = `verified: "${_verifyActual.slice(0, 100)}" contains expected "${_verifyExpected}"`;
          } else {
            _verifyOutcome = `MISMATCH: expected "${_verifyExpected}", got "${_verifyActual.slice(0, 100)}"`;
          }
        }
        sendSilentUpdate(_verifyOutcome.slice(0, 120), stepCount);
        activityDone(stepCount, 'verify', _verifyOutcome.slice(0, 100), null);
        historyPush({ step: stepCount, action: command, result: _verifyOutcome });
        productiveSteps++;
        await persistHistory();
        await sleep(400);
        continue;
      }

      if (command.type === 'wait') {
        const waitMs = Math.min(Math.max(command.ms || 1000, 100), MAX_WAIT_TIME_MS);
        sendSilentUpdate(`Waiting ${waitMs}ms...`, stepCount);
        await sleep(waitMs);
        historyPush({ step: stepCount, action: command, result: `Waited ${waitMs}ms` });
        await persistHistory();
        continue;
      }

      if (command.type === 'note') {
        const noteText = typeof command.text === 'string' ? command.text : (typeof command.summary === 'string' ? command.summary : 'No note text');
        sendSilentUpdate(`${noteText.slice(0, 200)}${noteText.length > 200 ? '...' : ''}`, stepCount);
        // (3.20.0) Surface the actual note content in the per-step activity
        // stream so the user can SEE what was captured, not just "Recording
        // a note". Truncated for display; full text remains in history.
        try {
          const _preview = noteText.length > 140 ? `${noteText.slice(0, 137)}…` : noteText;
          activityDone(stepCount, 'note-content', `Noted: "${_preview}"`, null);
        } catch (e) { console.warn('[Sentinel] note-content activity failed:', getErrorMessage(e)); }
        historyPush({ step: stepCount, action: command, result: `Note recorded: ${noteText}` });
        productiveSteps++;  // (3.8.0) every recorded finding extends the run
        await persistHistory();
        await sleep(500);
        continue;
      }

      // Handle extract / extract_list (save to agent memory)
      if (/^extract(_list)?$/.test(command.type)) {
        sendSilentUpdate(`Extracting: ${command.key}`, stepCount);
      }

      // (3.7.0) Observability actions — return buffered console / network data
      // captured by the CDP listeners attached at agent start. No content-script
      // round trip required; these are pure background-side reads.
      if (command.type === 'read_console_messages') {
        try {
          const entries = readConsoleMessages(tab, {
            limit: command.limit,
            filter: command.filter
          });
          const result = JSON.stringify(entries);
          sendActionMessage(command, stepCount, observation);
          if (entries.length) productiveSteps++;  // (3.8.0)
          sendActionResult(stepCount, `Console: ${entries.length} entries`, false);
          // (3.25.1) Telemetry: surface what the LLM asked for + what it got.
          // tab-manager already emits a debug-level read summary; this one is
          // at info level because the LLM explicitly chose to consume it.
          try { tel.info('network', `Agent read console: ${entries.length} entries`, { stepCount, filter: command.filter || null, returned: entries.length }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          historyPush({ step: stepCount, action: command, result });
          await persistHistory();
        } catch (e) {
          try { tel.error('network', 'Error reading console', { stepCount, error: getErrorMessage(e) }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          sendActionResult(stepCount, 'Error reading console: ' + getErrorMessage(e || 'unknown'), true);
        }
        await sleep(300);
        continue;
      }
      if (command.type === 'read_network_requests') {
        try {
          const entries = readNetworkRequests(tab, {
            limit: command.limit,
            filter: command.filter,
            url_includes: command.url_includes
          });
          const result = JSON.stringify(entries);
          sendActionMessage(command, stepCount, observation);
          if (entries.length) productiveSteps++;  // (3.8.0)
          sendActionResult(stepCount, `Network: ${entries.length} requests`, false);
          // (3.25.1) Telemetry: LLM-requested network read. Tag the failed
          // count so 4xx/5xx spikes during a run are easy to spot.
          try {
            const _failed = entries.reduce((acc, e) => acc + ((e.failed || (e.status >= 400)) ? 1 : 0), 0);
            tel.info('network', `Agent read network: ${entries.length} requests (${_failed} failed)`, { stepCount, filter: command.filter || null, urlIncludes: command.url_includes || null, returned: entries.length, failed: _failed });
          } catch (_e) { console.warn('[Sentinel] Telemetry failed (non-critical):', getErrorMessage(_e)); }
          historyPush({ step: stepCount, action: command, result });
          await persistHistory();
        } catch (e) {
          try { tel.error('network', 'Error reading network', { stepCount, error: getErrorMessage(e) }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          sendActionResult(stepCount, `Error reading network: ${getErrorMessage(e || 'unknown')}`, true);
        }
        await sleep(300);
        continue;
      }

      // (3.37.0) DNS-over-HTTPS lookup — no page interaction, pure background fetch
      // (3.39.0) preset: 'spf' | 'dmarc' | 'dkim' expand to the correct query target.
      if (command.type === 'lookup') {
        let _domain = typeof command.domain === 'string' ? command.domain.trim() : (typeof command.host === 'string' ? command.host.trim() : '');
        _domain = _domain.replace(/^https?:\/\/|\/.*$/gi, '');
        let _type = typeof command.record_type === 'string' ? command.record_type.toUpperCase() : (typeof command.type_field === 'string' ? command.type_field.toUpperCase() : 'A');
        const _preset = typeof command.preset === 'string' ? command.preset.toLowerCase() : '';
        // Expand preset shortcuts into canonical DNS query parameters
        if (_preset === 'spf') {
          _type = 'TXT';  // SPF lives in TXT at the root domain
        } else if (_preset === 'dmarc') {
          _type = 'TXT';
          _domain = `_dmarc.${_domain.replace(/^_dmarc\./i, '')}`;
        } else if (_preset === 'dkim') {
          const _sel = String(command.selector || 'default').trim().replace(/\._domainkey.*$/i, '');
          _type = 'TXT';
          _domain = `${_sel}._domainkey.${_domain.replace(new RegExp(`\\.${_sel}\\._domainkey\\.`, 'i'), '.')}`;
        }
        if (!_domain) {
          const _r = 'lookup: domain is required';
          sendActionResult(stepCount, _r, true);
          historyPush({ step: stepCount, action: command, result: _r });
          await persistHistory();
          continue;
        }
        sendSilentUpdate(`DNS lookup: ${_domain} (${_type})${_preset ? ` [${_preset}]` : ''}`, stepCount);
        sendActionMessage(command, stepCount, observation);
        try {
          const _dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(_domain)}&type=${encodeURIComponent(_type)}`;
          const _dohResp = await fetch(_dohUrl, { headers: { Accept: 'application/dns-json' } });
          if (!_dohResp.ok) throw new Error(`DoH HTTP ${_dohResp.status}`);
          const _dohJson = await _dohResp.json();
          if (!_dohJson) throw new Error('Invalid DNS response');
          const _answers = (_dohJson.Answer || []).map(a => ({ name: a.name, type: a.type, ttl: a.TTL, data: a.data }));
          const _status = (_dohJson.Status === 0 || _dohJson.Status === 'NOERROR') ? 'NOERROR' : `RCODE ${_dohJson.Status ?? 'UNKNOWN'}`;
          const _result = JSON.stringify({ domain: _domain, recordType: _type, preset: _preset || null, status: _status, answers: _answers, authoritative: !!_dohJson.AA });
          if (_answers.length) productiveSteps++;
          sendActionResult(stepCount, `DNS ${_type} ${_domain}: ${_answers.length} record(s)`, false);
          historyPush({ step: stepCount, action: command, result: _result });
          await persistHistory();
        } catch (e) {
          const _r = 'lookup failed: ' + (getErrorMessage(e));
          sendActionResult(stepCount, _r, true);
          historyPush({ step: stepCount, action: command, result: _r });
          await persistHistory();
        }
        await sleep(300);
        continue;
      }

      // (3.37.0) run_remote_command — drives ScreenConnect / NinjaRMM command interface
      if (command.type === 'run_remote_command') {
        const _cmd = typeof command.command === 'string' ? command.command.trim() : '';
        const _cmdType = typeof command.command_type === 'string' ? command.command_type.toLowerCase() : 'powershell';
        if (!_cmd) {
          const _r = 'run_remote_command: command is required';
          sendActionResult(stepCount, _r, true);
          historyPush({ step: stepCount, action: command, result: _r });
          await persistHistory();
          continue;
        }
        sendSilentUpdate(`Remote command (${_cmdType}): ${_cmd.slice(0, 60)}`, stepCount);
        sendActionMessage(command, stepCount, observation);
        try {
          const _profile = getPlatformProfile(tabInfo.url, goal);
          const _ci = _profile && _profile.commandInterface ? _profile.commandInterface : null;
          const _inputSel = (_ci && _ci.inputSelector) || 'textarea[data-command], .command-input textarea, .code-editor textarea';
          const _submitSel = (_ci && _ci.submitSelector) || 'button[type="submit"]:has-text("Run"), button:has-text("Execute")';
          const _outputSel = (_ci && _ci.outputSelector) || '#commandOutput, .command-output, .job-result pre';
          const _outputMs = (_ci && _ci.outputTimeoutMs) || 15000;
          const _readyText = (_ci && _ci.outputReadyText) || null;

          // Optionally set command type via a select element
          if (_ci && _ci.typeSelect && _ci.commandTypes && _ci.commandTypes[_cmdType]) {
            const _typeSel = _ci.typeSelect;
            const _typeVal = _ci.commandTypes[_cmdType];
            await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'select', selector: _typeSel, value: _typeVal } }).catch((e) => {
              console.error('[_typeVal] Unhandled rejection:', e);
            });
            await sleep(300);
          }

          // Clear + type the command
          await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'click', selector: _inputSel } }).catch((e) => {
            console.error('[_typeVal] Unhandled rejection:', e);
          });
          await sleep(200);
          await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'execute_js', code: `(function(){var el=document.querySelector(${JSON.stringify(_inputSel)});if(el){el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));}})()` } }).catch((e) => {
            console.error('[el] Unhandled rejection:', e);
          });
          await sleep(150);
          await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'type', selector: _inputSel, text: _cmd } }).catch((e) => {
            console.error('[el] Unhandled rejection:', e);
          });
          await sleep(300);

          // Submit
          await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'click', selector: _submitSel } }).catch((e) => {
            console.error('[el] Unhandled rejection:', e);
          });

          // Wait for output — poll until readyText appears or timeout
          const _outputJs = `(function(){var el=document.querySelector(${JSON.stringify(_outputSel)});return el?(el.innerText||el.value||el.textContent||'').trim():'';})()`;
          const _pollInterval = 600;
          const _pollDeadline = Date.now() + _outputMs;
          let _output = '';
          while (Date.now() < _pollDeadline) {
            await sleep(_pollInterval);
            const _poll = await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'execute_js', code: _outputJs, key: '_rc_output' } }).catch(() => null);
            const _pollText = typeof _poll === 'string' ? _poll : '';
            if (_pollText) {
              _output = _pollText;
              if (!_readyText || _pollText.includes(_readyText)) break;
            }
          }
          if (!_output) _output = '(output element not found or timed out)';
          const _result = JSON.stringify({ command: _cmd, command_type: _cmdType, platform: _profile ? _profile.id : 'generic', output: _output });
          if (_output && !_output.startsWith('(output element not found')) productiveSteps++;
          sendActionResult(stepCount, `Command ran on ${_profile ? _profile.label : 'remote machine'}`, false);
          historyPush({ step: stepCount, action: command, result: _result });
          await persistHistory();
        } catch (e) {
          const _r = 'run_remote_command failed: ' + (getErrorMessage(e));
          sendActionResult(stepCount, _r, true);
          historyPush({ step: stepCount, action: command, result: _r });
          await persistHistory();
        }
        await sleep(500);
        continue;
      }

      // Handle wait_for actions
      if (/^wait_for_(text|element|navigation)$/.test(command.type)) {
        sendAgentStatus('waiting', 'Waiting for: ' + (command.text || command.selector || 'navigation'));
        sendSilentUpdate(`Waiting for: ${command.text || command.selector || 'navigation'}`, stepCount);
        sendActionMessage(command, stepCount, observation);
        // Default timeout: navigation waits need more time than element waits
        const _waitTimeout = command.timeout || (command.type === 'wait_for_navigation' ? 20000 : 10000);
        const waitResult = await sendMessageWithRetry(tab, {
          action: 'wait_for',
          condition: { ...command, currentUrl: tabInfo.url, timeout: _waitTimeout }
        });
        const result = waitResult || 'Wait completed';
        sendActionResult(stepCount, result, false);
        historyPush({ step: stepCount, action: command, result });
        await persistHistory();
        await sleep(500);
        continue;
      }



      sendAgentStatus('executing', describeAction(command));
      // (3.50.0) Update the in-page action HUD so the user can see what's happening
      try {
        chrome.tabs.sendMessage(tab, {
          action: 'update_hud',
          hudData: {
            step: stepCount,
            totalSteps: dynamicMaxSteps || 20,
            action: command.type,
            actionLabel: describeAction(command).substring(0, 60)
          }
        }).catch(() => {});
      } catch (_) { /* non-fatal */ }
      // (3.50.2) Show visual action feedback (cursor + banner) for ALL actions
      try {
        chrome.tabs.sendMessage(tab, {
          action: 'show_action_feedback',
          actionType: command.type,
          label: describeAction(command).substring(0, 80),
          target: command.url || command.selector || command.text || '',
          step: stepCount
        }).catch(() => {});
      } catch (_) { /* non-fatal */ }
      sendSilentUpdate(`Executing: ${command.type}${agentPlan ? ` [${currentPlanStep + 1}/${agentPlan.length}]` : ''}`, stepCount);

      // Approval gate + CDP trusted input flag (#9)
      // (3.41.0) Read from run-stable settings cache instead of per-step storage fetch.
      const useTrustedInput = !!_runSettings.useTrustedInput;
      if (_runSettings.approvalMode) {
        const approval = await requestApproval(command, stepCount);
        if (approval.rejected) {
          historyPush({ step: stepCount, action: command, result: 'Rejected by user' });
          await persistHistory();
          await sleep(1000); continue;
        }
        if (approval.skipped) {
          historyPush({ step: stepCount, action: command, result: 'Skipped by user' });
          await persistHistory();
          await sleep(1000); continue;
        }
        // User explicitly approved — mark so content-script guards pass.
        if (approval.approved) command.approvalGranted = true;
      }

      // Show action card
      sendActionMessage(command, stepCount, observation);
      // (3.16.0) Begin the dispatch activity item — gives the user a "Now
      // doing: <X>" indicator that finalizes when the action completes.
      activityStart(stepCount, 'dispatch', describeAction(command));

      // Invalidate screenshot cache for actions that can change the page.
      // (#10) scroll_to changes viewport position which affects bbox/elementFromPoint
      // for the next observation — must invalidate.
      if (INTERACTIVE_ACTIONS.has(command.type)) {
        const invalidationCtx = getTabContext(tab);
        if (invalidationCtx) {
          // (#11) Invalidate the entire snapshot object, not just the legacy field.
          invalidationCtx.screenshotCache.cachedSnapshot = null;
          invalidationCtx.screenshotCache.cachedBase64Image = null;
          invalidationCtx.screenshotCache.lastScreenshotUrl = null;
        }
      }

      // Execute command
      const urlBeforeCommand = tabInfo.url;
      let result;
      let actionFailed = false;

      // ═══════════════════════════════════════════════════════════
      // v4.0 VISION INDEX-BASED ACTION EXECUTION
      // ═══════════════════════════════════════════════════════════
      if (command._visionAction && Number.isInteger(command._visionIndex) && command._visionIndex > 0) {
        const _viEl = _visionElementMap ? _visionElementMap.get(command._visionIndex) : null;
        if (_viEl) {
          try {
            if (command.type === 'click_at') {
              // (v4.2) Refresh element rect from live DOM — stored rect can go
              // stale between discover and click (overlay re-renders, layout
              // shifts). Look up via window.__sentinelElements Map which
              // VISION_CLEAR preserves (it only removes the canvas overlay +
              // data-sentinel-index attrs).
              let _liveRect = null;
              try {
                const _rectRes = await cdpExecuteJs(tab,
                  `return (function(){var e=window.__sentinelElements?window.__sentinelElements.get(${command._visionIndex}):null;if(!e||!e.getBoundingClientRect)return null;e.scrollIntoView&&e.scrollIntoView({block:"center",inline:"center"});var r=e.getBoundingClientRect();return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height,visible:r.width>0&&r.height>0});})()`,
                  { timeout: 3000 });
                if (_rectRes && _rectRes.value) {
                  const _parsed = typeof _rectRes.value === 'string' ? JSON.parse(_rectRes.value) : _rectRes.value;
                  if (_parsed && _parsed.visible) _liveRect = _parsed;
                }
              } catch (_re) { /* fall back to stored rect */ }

              const _rect = _liveRect || _viEl.rect;
              if (!_rect) {
                result = `Click failed for [${command._visionIndex}]: no bounding rect available`;
                actionFailed = true;
              } else {
                // CDP Input.dispatchMouseEvent uses CSS pixels (see
                // cdpDispatchClick docstring in tab-manager.js), so no DPR
                // scaling needed.
                const _cx = Math.round(_rect.x + _rect.w / 2);
                const _cy = Math.round(_rect.y + _rect.h / 2);
                let _cdpClickOk = false;
                try {
                  // Full mouse event chain: moved -> pressed -> released (mimics real click)
                  await chrome.debugger.sendCommand({ tabId: tab }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: _cx, y: _cy });
                  await new Promise(r => setTimeout(r, 50));
                  await chrome.debugger.sendCommand({ tabId: tab }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: _cx, y: _cy, button: 'left', clickCount: 1 });
                  await new Promise(r => setTimeout(r, 30));
                  await chrome.debugger.sendCommand({ tabId: tab }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: _cx, y: _cy, button: 'left', clickCount: 1 });
                  result = `Clicked [${command._visionIndex}] at (${_cx},${_cy})${_liveRect ? ' [live-rect]' : ' [cached-rect]'}`;
                  console.log('[Sentinel/v4]', result);
                  _cdpClickOk = true;
                } catch (_cme) { /* fall through to JS .click() */ }

                // (v4.2) Verify dismissal — short delay, then check if the same
                // element is still present + visible. If yes, the CDP mouse
                // event was absorbed by an overlay; fire a JS .click() on the
                // stored element reference (bypasses pointer-events and
                // overlay interception).
                await new Promise(r => setTimeout(r, 100));
                try {
                  const _jsClickRes = await cdpExecuteJs(tab,
                    `return (function(){var e=window.__sentinelElements?window.__sentinelElements.get(${command._visionIndex}):null;if(!e)return"no-ref";var r=e.getBoundingClientRect();var stillVisible=r.width>0&&r.height>0&&document.body.contains(e);if(stillVisible){try{e.click();}catch(_e){}return"js-clicked";}return"dismissed";})()`,
                    { timeout: 3000 });
                  const _val = _jsClickRes && _jsClickRes.value;
                  if (_val === 'js-clicked') {
                    result = `${result || `Clicked [${command._visionIndex}]`} + js-fallback`;
                  } else if (!_cdpClickOk && _val !== 'dismissed') {
                    // CDP failed AND JS fallback couldn't find element — last
                    // resort: try by old attribute (only works if VISION_CLEAR
                    // hasn't run yet on this step).
                    try {
                      const _attrRes = await cdpExecuteJs(tab,
                        `return (function(){var e=document.querySelector('[data-sentinel-index="${command._visionIndex}"]');if(e){e.click();return"clicked";}return"not found";})()`,
                        { timeout: 3000 });
                      result = `Clicked [${command._visionIndex}] via attr selector: ${_attrRes && _attrRes.value || 'unknown'}`;
                    } catch (_cme2) {
                      result = `Click failed for [${command._visionIndex}]`;
                      actionFailed = true;
                    }
                  }
                } catch (_jsE) { /* non-fatal — CDP click likely already worked */ }
              }
            } else if (command.type === 'type') {
              // Type into indexed element
              const _safeText = escapeJsString(command.text || '', "'");
              try {
                const _typeRes = await cdpExecuteJs(tab,
                  `return (function(){var e=document.querySelector('[data-sentinel-index="${command._visionIndex}"]');if(!e)return"not found";e.focus();e.scrollIntoView({block:"center"});var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value");if(s)s.set.call(e,"${_safeText}");else e.value="${_safeText}";e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return"typed";})()`,
                  { timeout: 5000 });
                const _typeVal = _typeRes && _typeRes.value;
                if (_typeVal === 'not found') {
                  result = `Type failed for [${command._visionIndex}]: element not found`;
                  actionFailed = true;
                } else {
                  result = `Typed into [${command._visionIndex}]: ${_typeVal || 'unknown'}`;
                  console.log('[Sentinel/v4]', result);
                }
              } catch (_te) {
                result = `Type failed for [${command._visionIndex}]`;
                actionFailed = true;
              }
            }
          } catch (_ve) {
            result = `Vision action error: ${getErrorMessage(_ve)}`;
            actionFailed = true;
          }
          // Skip the legacy execution path for this action
          command._visionExecuted = true;
        } else {
          result = `Element [${command._visionIndex || 'invalid'}] not found in vision elements`;
          actionFailed = true;
          command._visionExecuted = true;
        }
      }
      // Handle non-indexed vision actions (scroll, navigate, go_back, execute_js, done)
      else if (command._visionAction && command._visionIndex == null) {
        // These fall through to normal execution — just clear the flag
        // scroll, navigate, execute_js, done are all handled by the legacy switch
        command._visionExecuted = false;  // let legacy handle it
      }
      
            // (3.20.1) Fail-fast for targetable actions with NO target. The LLM
      // sometimes emits {type: 'click'} with no selector / ref / coords —
      // the content script then can't find anything to click, dispatches a
      // no-op, and the result is "Click: undefined" with no useful feedback.
      // Catch it here and return a clear error to the LLM so it picks a
      // different strategy next step.
      if (TARGETABLE_ACTIONS.has(command.type) && !command._visionAction) {
        const _hasSelector = typeof command.selector === 'string' && command.selector;
        const _hasRef      = typeof command.ref === 'string' && command.ref;
        const _hasCoords   = typeof command.x === 'number' && typeof command.y === 'number';
        if (!_hasSelector && !_hasRef && !_hasCoords) {
          const _msg = `BLOCKED: ${command.type} command has no target — supply at least one of selector, ref, or x/y coords. The observation panel above lists usable selectors/refs.`;
          activityFail(stepCount, 'dispatch', describeAction(command), { result: _msg });
          sendActionResult(stepCount, _msg, true);
          historyPush({ step: stepCount, action: command, result: _msg });
          await persistHistory();
          await sleep(800);
          continue;
        }
      }

      // (3.20.1) Navigate-loop guard. If the LLM emits 2 consecutive navigate

      // SPEED (v3.60): Handle batch actions — execute multiple actions without re-observing
      if (command.type === 'batch' && Array.isArray(command.actions)) {
        const batchActions = command.actions.filter(a => a && a.type);
        if (batchActions.length) {
          console.log(`[Sentinel/SPEED] Batch: queuing ${batchActions.length} actions`);
          // Push in reverse so shift() gets them in order
          for (let i = batchActions.length - 1; i >= 0; i--) {
            _pendingCommandQueue.unshift(batchActions[i]);
          }
          command = _pendingCommandQueue.shift();
          console.log(`[Sentinel/SPEED] Batch: executing first action: ${command.type}`);
        } else {
          result = 'Batch contained no valid actions';
          actionFailed = true;
        }
      }

      // SPEED (v3.60): Handle auto-navigate for common patterns
      // If goal mentions a site+query, construct the direct URL instead of clicking through
      if (command.type === 'smart_navigate' && command.query) {
        const site = command.site || 'google';
        const q = encodeURIComponent(command.query);
        let smartUrl = '';
        if (site === 'google') smartUrl = `https://www.google.com/search?q=${q}`;
        else if (site === 'weather.gov') smartUrl = `https://forecast.weather.gov/zipcity.php?inputstring=${q}`;
        else if (site === 'wikipedia') smartUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${q}`;
        else if (site === 'youtube') smartUrl = `https://www.youtube.com/results?search_query=${q}`;
        else if (site === 'amazon') smartUrl = `https://www.amazon.com/s?k=${q}`;
        else if (site === 'reddit') smartUrl = `https://www.reddit.com/search/?q=${q}`;
        else if (/^(twitter|x)$/.test(site)) smartUrl = `https://x.com/search?q=${q}`;
        if (smartUrl) {
          command = { type: 'navigate', url: smartUrl };
          console.log(`[Sentinel/SPEED] smart_navigate → ${smartUrl}`);
        } else {
          // Fallback to Google
          command = { type: 'navigate', url: 'https://www.google.com/search?q=' + q };
        }
      }

      // commands to the same URL WHILE ALREADY ON THAT PAGE, force a strategy shift.
      // (3.51) FIXED: if we're on a DIFFERENT page, navigating back to a previous
      // URL is recovery, not a loop — allow it (e.g., click_at landed on wrong site).
      if (command.type === 'navigate' && typeof command.url === 'string') {
        const _currentHost = (() => { try { return new URL(currentUrl).hostname.toLowerCase(); } catch(_) { return ''; } })();
        const _targetHost = (() => { try { return new URL(command.url).hostname.toLowerCase(); } catch(_) { return ''; } })();
                const _targetHostNoWww = _targetHost.replace(/^www\./, '');
        const _currentHostNoWww = _currentHost.replace(/^www\./, '');
        const _alreadyThere = _currentHost && _targetHost && (_currentHost === _targetHost || _currentHost.includes(_targetHostNoWww) || _targetHost.includes(_currentHostNoWww));
        if (_alreadyThere) {
          let _recent = false;
          const _hl4 = history.length;
          const checkStart = Math.max(0, _hl4 - 2);
          for (let i = checkStart; i < _hl4; i++) {
            const h = history[i];
            if (h && h.action && h.action.type === 'navigate' && h.action.url === command.url) {
              _recent = true;
              break;
            }
          }
          if (_recent) {
            const _msg = `BLOCKED: already on ${command.url}. Do NOT navigate to the same URL. Instead: read_page, execute_js to inspect the DOM, or click an in-page nav element to drill deeper.`;
            activityFail(stepCount, 'dispatch', describeAction(command), { result: _msg });
            sendActionResult(stepCount, _msg, true);
            historyPush({ step: stepCount, action: command, result: _msg });
            await persistHistory();
            await sleep(800);
            continue;
          }
        }
      }

      // Handle open_tab
      if (command.type === 'open_tab') {
        if (!isValidUrl(command.url)) {
          result = `Invalid URL: ${command.url}`;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          sendSilentUpdate(`Opening tab: ${command.label || command.url}`, stepCount);
          const ctx = await openTab(command.url, command.label);
          if (!ctx) {
            result = `Failed to open tab: browser rejected chrome.tabs.create for ${command.url}`;
            actionFailed = true;
          } else {
          // (3.7.2) Attach the new tab to the Sentinel group so the user
          // sees it linked in the tab bar.
          try { await attachTabToSentinelGroup(ctx.tabId); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          await switchToTab(ctx.tabId);
          try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          await sleep(2000);
          await injectContentScript(ctx.tabId);
          // (3.50.1) Validate we landed where we intended.
          // Sites like Reddit can redirect to completely different content.
          const _arrivedInfo = await getTabInfo(ctx.tabId);
          const _arrivedUrl = _arrivedInfo?.url || '';
          result = `Opened tab "${command.label || command.url}" (ID: ${ctx.tabId})`;
          if (_arrivedUrl && command.url) {
            try {
              if (!command.url || typeof command.url !== 'string') throw new Error('Invalid command.url');
              if (!_arrivedUrl || typeof _arrivedUrl !== 'string') throw new Error('Invalid _arrivedUrl');
              const _intendedPath = new URL(command.url).pathname.replace(/\/$/, '');
              const _arrivedPath = new URL(_arrivedUrl).pathname.replace(/\/$/, '');
              if (_intendedPath !== _arrivedPath) {
                result += ` — WARNING: redirected to ${_arrivedUrl}. The page may not contain the expected content. Check the URL and try a different link.`;
                console.warn('[Sentinel/open_tab] URL mismatch. Intended:', command.url, 'Arrived:', _arrivedUrl);
              }
            } catch (_urlE) { /* non-standard URL (e.g. chrome://newtab) — skip path comparison */ }
          }
          } // close ctx null check else
        }
        sendActionResult(stepCount, result, actionFailed);
        historyPush({ step: stepCount, action: command, result });
        await persistHistory();
        continue;
      }

      // Handle switch_tab
      if (command.type === 'switch_tab') {
        let targetId = command.tab_id;
        if (!targetId && command.label) {
          targetId = findTabByLabel(command.label);
        }
        if (!targetId) {
          result = `Tab not found: ${command.label || command.tab_id}`;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          await switchToTab(targetId);
          await injectContentScript(targetId);
          result = `Switched to tab "${getTabContext(targetId)?.label || targetId}"`;
        }
        sendActionResult(stepCount, result, actionFailed);
        historyPush({ step: stepCount, action: command, result });
        await persistHistory();
        continue;
      }

      // Handle close_tab — supports index, label, tab_id, or defaults to active tab
      if (command.type === 'close_tab') {
        let targetId = command.tab_id;
        if (!targetId && command.label) {
          targetId = findTabByLabel(command.label);
        }
        // Cache tab contexts to avoid redundant getAllTabContexts() calls
        const allCtx = getAllTabContexts();
        // Support the `index` parameter from the tool definition
        if (!targetId && typeof command.index === 'number') {
          if (Array.isArray(allCtx) && command.index >= 0 && command.index < allCtx.length) {
            targetId = allCtx[command.index].tabId;
          }
        }
        // Default: close the current active tab (if it's not the last one)
        if (!targetId) {
          const activeId = getActiveTabId();
          if (allCtx.length > 1 && activeId) {
            targetId = activeId;
          }
        }
        if (!targetId) {
          result = 'No tab to close (only one tab open or no valid target). Use navigate to go elsewhere instead.';
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null);
          await closeTab(targetId);
          result = `Closed tab ${targetId}`;
        }
        sendActionResult(stepCount, result, actionFailed);
        historyPush({ step: stepCount, action: command, result });
        await persistHistory();
        continue;
      }

      if (command.type === 'navigate') {
        if (!isValidUrl(command.url)) {
          // (3.25.1) Telemetry: invalid navigate URL — usually means the LLM
          // hallucinated a URL or pasted a fragment without a scheme.
          try { tel.warn('page', 'Navigate rejected (invalid URL)', { stepCount, url: command.url }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          result = `Invalid URL: ${command.url}`;
          actionFailed = true;
        } else {
          // (3.25.1) Telemetry: navigate kickoff. Pair with the result emit
          // below so operators can see latency + landing-URL mismatches.
          try {
            const targetUrl = command.url;
            tel.info('page', 'Navigating → ' + (typeof targetUrl === 'string' ? targetUrl.substring(0, 100) : String(targetUrl).substring(0, 100)), { stepCount, target: targetUrl, fromUrl: currentUrl });
          } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
          // (3.49.1) Push undo entry before navigating so we can go back.
          try {
            undoStack.push({ type: 'navigate', tabId: tab, previousUrl: currentUrl || '' });
            if (undoStack.length > 10) undoStack.shift();
            chrome.runtime.sendMessage({ action: 'undo_stack_updated', size: undoStack.length }).catch(() => {});
          } catch (_) { /* undo stack non-fatal */ }
          const _navStart = Date.now();
          await chrome.tabs.update(tab, { url: command.url });
          await waitForPageLoad(tab);
          await waitForPageReady(tab);
          _cachedObservation = null; // Invalidate cache after navigate action
          // Re-inject content script on the new page
          const reinjected = await injectContentScript(tab);
          if (!reinjected) {
            try { tel.warn('page', 'Navigate: content script failed to load', { stepCount, url: command.url, durationMs: Date.now() - _navStart }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
            // In CDP mode, content script failure is expected — don't mark as action failure
            if (_cdpFallbackActive) {
              result = `Navigated to ${command.url}`;
              // Don't set actionFailed — navigation succeeded, CDP will handle observation
            } else {
              result = `Navigated to ${command.url} (content script failed to load)`;
              actionFailed = true;
            }
          } else {
            // Verify we actually arrived at the intended page
            const newTabInfo = await getTabInfo(tab);
            const arrivedUrl = newTabInfo ? newTabInfo.url : command.url;
            try {
              const intendedHost = new URL(command.url).hostname.toLowerCase();
              const arrivedHost = new URL(arrivedUrl).hostname.toLowerCase();
              if (arrivedHost.includes(intendedHost.replace(/^www\./, ''))) {
                try {
                  const displayUrl = typeof arrivedUrl === 'string' ? arrivedUrl.substring(0, 100) : String(arrivedUrl).substring(0, 100);
                  tel.info('page', 'Navigate ok → ' + displayUrl, { stepCount, arrivedUrl, durationMs: Date.now() - _navStart });
                } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
                result = `Navigated to ${arrivedUrl}`;
              } else {
                try { tel.warn('page', 'Navigate landed elsewhere', { stepCount, intended: command.url, arrivedUrl, durationMs: Date.now() - _navStart }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
                result = `Navigated but landed on ${arrivedUrl} instead of ${command.url}`;
                actionFailed = true;
              }
            } catch (_) {
              result = `Navigated to ${arrivedUrl}`;
            }
          }
        }
      } else if (/^navigate_(back|forward)$/.test(command.type)) {
        try {
          const _prevUrl = (await getTabInfo(tab))?.url || '';
          const _navDelta = command.type === 'navigate_back' ? -1 : 1;
          await sendMessageWithRetry(tab, { action: 'execute_command', command: { type: 'execute_js', code: `history.go(${_navDelta})`, key: '_nav_hist' } });
          await waitForPageLoad(tab);
          await sleep(500);
          const _newInfo = await getTabInfo(tab);
          const _newUrl = _newInfo?.url || '';
          if (_newUrl && _newUrl !== _prevUrl) {
            result = (command.type === 'navigate_back' ? 'Navigated back to ' : 'Navigated forward to ') + _newUrl;
          } else {
            result = (command.type === 'navigate_back' ? 'Back navigation — ' : 'Forward navigation — ') + (_newUrl || 'no change');
          }
          actionFailed = false;
        } catch (e) {
          result = `${command.type === 'navigate_back' ? 'navigate_back' : 'navigate_forward'} failed: ${getErrorMessage(e || 'unknown')}`;
          actionFailed = true;
        }
      } else if (command.type === 'read_page') {
        try {
          const freshContent = await sendMessageWithRetry(tab, { action: 'read_page' });
          result = freshContent ? 'Page content re-read' : 'Failed to re-read page';
          actionFailed = !freshContent;
        } catch (_err) { result = 'Could not re-read page'; actionFailed = true; }
      } else if (/^extract(_list)?$/.test(command.type)) {
        const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
        result = (typeof res === 'string' && res) ? res : 'Error: no response from content script';
        let extractSucceeded = false;
        try {
          if (!result || typeof result !== 'string') {
            throw new Error('Invalid result for extract');
          }
          const _resultToParse = result.startsWith('JS Result: ') ? result.replace('JS Result: ', '') : result;
          const parsed = JSON.parse(_resultToParse);
          if (parsed.key !== undefined && parsed.value !== undefined) {
            // Reject error-shaped values so failure strings ("Element not found",
            // "JS Error: ...", etc.) are never stored as real data in memory.
            const _extractValStr = parsed.value === null ? '' : (typeof parsed.value === 'string' ? parsed.value : JSON.stringify(parsed.value));
            if (!_extractValStr || /^(Element not found|Error|JS Error|JS execution failed|Execution error|Code execution timed out|No element|timed out|Done\.|undefined)/i.test(_extractValStr.trim())) {
              extractSucceeded = false;
              // fall through to actionFailed = true below
            } else {
            // (3.8.2) Auto-prefix memory key with the portal name when on a
            // known platform, so multi-portal investigations group findings
            // cleanly in the report (e.g. "entra_signins" vs "exchange_rules").
            const _portalKey = (function() {
              const u = (currentUrl || '').toLowerCase();
              if (u.includes('entra')) return 'entra';
              if (u.includes('admin.exchange')) return 'exchange';
              if (u.includes('purview')) return 'purview';
              if (u.includes('onedrive')) return 'onedrive';
              if (u.includes('sharepoint')) return 'sharepoint';
              if (u.includes('teams')) return 'teams';
              if (/intune|endpoint\.microsoft/.test(u)) return 'intune';
              if (/defender|security\.microsoft/.test(u)) return 'defender';
              if (u.includes('admin.microsoft')) return 'm365';
              if (u.includes('sentinelone')) return 'sentinelone';
              if (u.includes('virustotal')) return 'virustotal';
              return null;
            })();
            const _finalKey = (_portalKey && !String(parsed.key).startsWith(`${_portalKey}_`))
              ? `${_portalKey}_${parsed.key}`
              : parsed.key;
            agentMemory[_finalKey] = parsed.value;
            const memKeys = Object.keys(agentMemory || {});
            if (memKeys.length > CONFIG.maxMemoryEntries && memKeys[0]) {
              delete agentMemory[memKeys[0]];
            }
            try {
              await chrome.storage.local.set({ agent_memory: agentMemory });
            } catch (e) {
              console.warn('[Sentinel] agent_memory storage write failed (extract):', getErrorMessage(e));
            }
            // (3.25.1) Telemetry: memory write from extract/extract_list. Lets
            // the operator watch memory grow in real time and catch keys that
            // are repeatedly overwritten or empty.
            try {
              const _isArr = Array.isArray(parsed.value);
              const _len = _isArr ? parsed.value.length : (typeof parsed.value === 'string' ? parsed.value.length : null);
              tel.info('memory', `Wrote "${_finalKey}" (extract)`, { key: _finalKey, isArray: _isArr, length: _len, totalKeys: memKeys.length });
            } catch (e) { console.warn('[Sentinel] extract telemetry failed:', getErrorMessage(e)); }
            const preview = Array.isArray(parsed.value)
              ? `${parsed.value.length} items extracted`
              : (() => {
                  const v = parsed.value;
                  return `"${typeof v === 'string' ? v.substring(0, 100) : String(v).substring(0, 100)}"`;
                })();
            result = `Extracted ${parsed.key} = ${preview}`;
            extractSucceeded = true;
            productiveSteps++;  // (3.8.0)
            // (3.20.0) Show extraction outcome in the activity stream
            try {
              activityDone(stepCount, 'extract-content', `Extracted "${parsed.key}" → ${preview}`, null);
            } catch (e) { console.warn('[Sentinel] extract-content activity failed:', getErrorMessage(e)); }
            } // close else (error-string guard)
          }
        } catch (_) {
          // extract result wasn't JSON -- treat as failure
        }
        if (!extractSucceeded) actionFailed = true;
      } else if (command.type === 'execute_js' && command.key) {
        // (3.13.0) Engine-side auto-recovery retry ladder for execute_js.
        // Try the LLM's original code first; on unproductive result, the
        // engine automatically retries with body.innerText, then with an
        // aggregated visible-element text harvest. The LLM is NEVER asked
        // to choose between these strategies -- engine handles mechanically.
        // Outcomes:
        //   strategy: 'original'              -> LLM's code worked
        //   strategy: 'body_text_fallback'    -> selector missed, text saved
        //   strategy: 'visible_text_fallback' -> SPA-heavy page text saved
        //   strategy: 'all_failed'            -> surface error to LLM
        const ladder = await _runExecuteJsWithRetryLadder(tab, command.code || '', command.timeout);
        if (ladder.strategy !== 'original') {
          console.log('[Sentinel] execute_js auto-recovered via:', ladder.strategy);
          // Append a hint to the result so the LLM knows which strategy
          // succeeded. Helps it adapt subsequent extractions on this page.
          ladder.raw = `${ladder.raw}\n\n[ENGINE NOTE: original execute_js was unproductive; auto-recovered via ${ladder.strategy} strategy. The data above is from ${ladder.strategy === 'body_text_fallback' ? 'document.body.innerText' : 'aggregated visible-element text'}. Parse it with regex/string ops in your finish summary.]`;
        }
        let res = ladder.raw;
        result = res || 'Done';
        // Extract the JS result value
        let jsValue = result;
        if (result.startsWith('JS Result: ')) {
          jsValue = result.substring(11);
        }
        if (result === 'Done' || result.startsWith('JS Error: ')) {
          // JS execution failed or returned nothing — do NOT save to memory
          actionFailed = true;
          result = result === 'Done' ? 'JS execution failed — no response from page' : result;
        } else if (jsValue.length < 5) {
          // Result too short to be useful data
          actionFailed = true;
          result = 'JS returned empty result';
        } else {
          // (3.9.0) Reject useless toString'd values — '[object Object]', null,
          // undefined, empty objects/arrays. Saving these is worse than failing.
          const _useless = /^\s*\[object\s+(?:Object|Promise|Array|Function|HTMLElement|HTMLCollection|NodeList|Window|Document|Map|Set)\]\s*$/i;
          const _trim = String(jsValue).trim();
          if (_useless.test(_trim) || _trim === 'undefined' || _trim === 'null') {
            actionFailed = true;
            // (3.12.1) More actionable guidance — tell the LLM the SPECIFIC
            // recovery patterns rather than vague "wrap in JSON.stringify".
            // The wrapper already does that; the bug is usually returning a
            // DOM node, a null query, or an unawaited Promise.
            result = `JS returned a non-serializable value ("${_trim.slice(0, 60)}"). DO NOT retry the same code -- it will fail again. Recovery options: (1) Return text only: \`return document.body.innerText.substring(0, 5000)\` and parse in finish. (2) Use regex on body text: \`const t = document.body.innerText; const m = t.match(/<your_pattern>/); return m ? m[1] : null;\`. (3) Fall back to \`read_page\` action. (4) If you returned a DOM element, change to \`el.innerText\` instead. (5) If you returned a query that may be null, guard with \`(document.querySelector(sel) || {}).innerText || null\`.`;
          } else {
            let savedKey = command.key;
            let savedValue = jsValue;
            try {
              const parsed = JSON.parse(jsValue);
              // Reject parsed-but-empty objects/arrays
              const isEmptyObj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && !Object.keys(parsed).length;
              const isEmptyArr = Array.isArray(parsed) && !parsed.length;
              if (parsed === null || isEmptyObj || isEmptyArr) {
                actionFailed = true;
                result = `JS returned ${isEmptyArr ? 'an empty array []' : (isEmptyObj ? 'an empty object {}' : 'null')}. Re-run the query or extract specific fields directly.`;
                savedValue = null;
              } else {
                savedValue = parsed;
              }
            } catch (_) { /* not JSON — keep the raw string */ }
            // (3.13.0) Memory hygiene at write time -- reject garbage values
            // BEFORE they pollute future prompts. Single source of truth via
            // _shouldAcceptMemoryWrite. Cleaner state means cleaner subsequent
            // prompts, faster hallucination gate, less report-time noise.
            if (savedValue !== null) {
              const hygiene = _shouldAcceptMemoryWrite(savedKey, savedValue, agentMemory);
              if (!hygiene.ok) {
                actionFailed = true;
                result = `JS result rejected by memory hygiene: ${hygiene.reason}. This data is already captured — use the existing memory key and proceed to finish or next step. Do NOT retry extraction.`;
                savedValue = null;
              }
            }
            if (savedValue !== null) {
              agentMemory[savedKey] = savedValue;
              const memKeys = Object.keys(agentMemory || {});
              if (memKeys.length > CONFIG.maxMemoryEntries && memKeys[0] && agentMemory) delete agentMemory[memKeys[0]];
              try {
                await chrome.storage.local.set({ agent_memory: agentMemory });
              } catch (e) {
                console.warn('[Sentinel] agent_memory storage write failed (execute_js):', getErrorMessage(e));
              }
              // (3.25.1) Telemetry: memory write from execute_js. Tagged with
              // the recovery ladder strategy so operators can see when an
              // execute_js fell back to body_text / visible_text.
              try {
                const _isArr = Array.isArray(savedValue);
                const _len = _isArr ? savedValue.length : (typeof savedValue === 'string' ? savedValue.length : (typeof savedValue === 'object' && savedValue !== null ? Object.keys(savedValue).length : null));
                tel.info('memory', `Wrote "${savedKey}" (execute_js, strategy=${ladder.strategy || 'original'})`, { key: savedKey, isArray: _isArr, length: _len, strategy: ladder.strategy || 'original', totalKeys: memKeys.length });
              } catch (e) { console.warn('[Sentinel] execute_js telemetry failed:', getErrorMessage(e)); }
              const preview = String(jsValue).substring(0, 100);
              result = `JS result saved to "${savedKey}": ${preview}`;
              productiveSteps++;  // (3.8.0)
              // (3.20.0) Surface JS-extraction outcome in activity stream
              try {
                const _itemCount = Array.isArray(savedValue) ? savedValue.length : null;
                const _summary = _itemCount !== null
                  ? `${_itemCount} items captured`
                  : (preview.length > 60 ? `${preview.slice(0, 57)}…` : preview);
                activityDone(stepCount, 'js-extract-content', `Saved "${savedKey}" → ${_summary}`, null);
              } catch (e) { console.warn('[Sentinel] js-extract-content activity failed:', getErrorMessage(e)); }
            }
          }
        }
      } else if (useTrustedInput && (/^(click|click_at|type|press_key|select)$/.test(command.type))) {
        // (#9) CDP trusted-input dispatch path. Opt-in via settings.
        // On any CDP failure we fall back to the synthetic content-script
        // path so existing flows aren't broken.
        let cdpDone = false;
        try {
          if (command.type === 'click_at') {
            // click_at provides x/y in CSS pixels already (after #11 DPR fix).
            const x = Number(command.x);
            const y = Number(command.y);
            if (typeof x !== 'number' || Number.isNaN(x)) throw new Error('Invalid x coordinate: must be a number');
            if (typeof y !== 'number' || Number.isNaN(y)) throw new Error('Invalid y coordinate: must be a number');
            const r = await cdpDispatchClick(tab, x, y, {
              button: command.button,
              clickCount: command.clickCount,
              description: `Clicking at (${Math.round(x)}, ${Math.round(y)})`
            });
            if (r.ok) { result = `Clicked at (${Math.round(x)},${Math.round(y)}) via CDP`; cdpDone = true; }
            else { console.warn('[CDP] dispatchClick failed, falling back:', (typeof r === 'object' && r !== null && typeof r.error === 'string' ? r.error : String(r?.error || 'unknown'))); }
          } else if (command.type === 'click') {
            // Resolve ref/selector to a bbox center via the content script.
            try {
              const bbox = await sendMessageWithRetry(tab, { action: 'get_bbox', ref: command.ref, selector: command.selector }, 1);
              if (bbox && typeof bbox.x === 'number' && typeof bbox.y === 'number') {
                // Make sure the element is in view, then click via CDP at its center.
                try { await sendMessageWithRetry(tab, { action: 'execute_command', command: { type: 'scroll_to', ref: command.ref, selector: command.selector } }, 1); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
                // Re-query bbox after scroll
                let cx = bbox.x, cy = bbox.y;
                try {
                  const bbox2 = await sendMessageWithRetry(tab, { action: 'get_bbox', ref: command.ref, selector: command.selector }, 1);
                  if (bbox2 && typeof bbox2.x === 'number' && typeof bbox2.y === 'number') { cx = bbox2.x; cy = bbox2.y; }
                } catch (_) { /* keep original */ }
                const targetLabel = command.ref || command.selector || 'element';
                const r = await cdpDispatchClick(tab, cx, cy, {
                  description: `Clicking ${targetLabel}`
                });
                if (r.ok) { result = `Clicked ${targetLabel} via CDP`; cdpDone = true; }
                else { console.warn('[CDP] dispatchClick failed, falling back:', (typeof r === 'object' && r !== null && typeof r.error === 'string' ? r.error : String(r?.error || 'unknown'))); }
              }
            } catch (e) { console.warn('[CDP] get_bbox failed, falling back:', getErrorMessage(e)); }
          } else if (command.type === 'type') {
            // (3.49.1) Push undo entry before typing so we can restore the field.
            try {
              let _prevVal = '';
              try {
                const _valRes = await sendMessageWithRetry(tab, { action: 'execute_command', command: { type: 'execute_js', code: `(function(){const el=document.querySelector(${JSON.stringify(command.selector||'')});return el?el.value:'';})()` } }, 1);
                if (typeof _valRes === 'string' && _valRes.startsWith('JS Result: ')) _prevVal = _valRes.slice('JS Result: '.length);
              } catch (_) { /* prev value capture non-fatal */ }
              undoStack.push({ type: 'type', tabId: tab, selector: command.selector || command.ref || '', previousValue: _prevVal });
              if (undoStack.length > 10) undoStack.shift();
              chrome.runtime.sendMessage({ action: 'undo_stack_updated', size: undoStack.length }).catch(() => {});
            } catch (_) { /* undo stack non-fatal */ }
            // Focus the target via the content script (it knows the ref/selector
            // resolution rules), then dispatch trusted text via CDP.
            try {
              await sendMessageWithRetry(tab, { action: 'focus_element', ref: command.ref, selector: command.selector }, 1);
            } catch (_) { /* non-fatal: insertText may still hit the active element */ }
            const r = await cdpDispatchType(tab, command.text || '');
            if (r.ok) { result = `Typed ${command.text ? command.text.length : 0} chars via CDP`; cdpDone = true; }
            else { console.warn('[CDP] dispatchType failed, falling back:', (typeof r === 'object' && r !== null && typeof r.error === 'string' ? r.error : String(r?.error || 'unknown'))); }
          } else if (command.type === 'press_key') {
            const r = await cdpDispatchKey(tab, command.key);
            if (r.ok) { result = `Pressed ${command.key} via CDP`; cdpDone = true; }
            else { console.warn('[CDP] dispatchKey failed, falling back:', (typeof r === 'object' && r !== null && typeof r.error === 'string' ? r.error : String(r?.error || 'unknown'))); }
          } else if (command.type === 'select') {
            // v3.66: CDP select - find the <select> element and set its value
            try {
              // Cache JSON.stringify calls to avoid redundant serialization (perf)
              const _selJson = JSON.stringify(command.selector || '');
              const _valJson = JSON.stringify(command.value || '');
              const selCode = `return (function(){
var el = document.querySelector(${_selJson});
if (!el) { var sels = document.querySelectorAll("select"); for (var i = 0; i < sels.length; i++) { if (sels[i].offsetParent !== null) { el = sels[i]; break; } } }
if (!el) return { ok: false, error: "No select element found" };
var opts = el.options; var found = false;
for (var i = 0; i < opts.length; i++) {
  if (opts[i].value === ${_valJson} || (typeof opts[i].text === "string" && opts[i].text.trim().toLowerCase() === (${_valJson}).toLowerCase())) {
    el.selectedIndex = i; el.value = opts[i].value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    found = true; break;
  }
}
if (!found) return { ok: false, error: "Option not found: " + ${_valJson} };
return { ok: true, value: el.value };
})()`;
              const selResult = await cdpExecuteJs(tab, selCode, { timeout: 3000 });
              if (selResult && selResult.ok && selResult.value && selResult.value.ok) {
                result = `Selected "${command.value}" via CDP fallback`;
                cdpDone = true;
                sendSilentUpdate(`[CDP] Selected ${command.value} in ${command.selector || 'dropdown'}`, stepCount);
              } else {
                console.warn('[CDP] Select failed:', selResult);
              }
            } catch (selErr) {
              console.warn('[CDP] Select error:', getErrorMessage(selErr));
            }
          }
        } catch (err) {
          console.warn('[CDP] dispatch threw, falling back:', getErrorMessage(err));
        }
        if (!cdpDone) {
          // CDP path failed -- fall back to the synthetic content-script path.
          try {
            const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
            result = res || 'Done';
            actionFailed = /^(Error|BLOCKED:)| not found|Element not found|No element/i.test(result);
          } catch (err) {
            result = `Content script error: ${getErrorMessage(err || 'command failed to reach page')}`;
            actionFailed = true;
          }
        }
      } else if (!command._visionExecuted) {
        try {
          // CSP-bypass: for execute_js without a key, also prefer CDP
          // Runtime.evaluate so strict-CSP sites work. (Same reason as the
          // with-key branch above — drudgereport.com et al. silently block
          // <script>-tag injection.)
          if (command.type === 'execute_js') {
            let cdpUsed = false;
            try {
              const cdpResult = await cdpExecuteJs(tab, command.code || '', { timeout: command.timeout });
              if (cdpResult && cdpResult.ok) {
                cdpUsed = true;
                const valStr = cdpResult.value === undefined || cdpResult.value === null
                  ? ''
                  : (typeof cdpResult.value === 'object'
                      ? JSON.stringify(cdpResult.value).slice(0, 3000)
                      : String(cdpResult.value).slice(0, 3000));
                result = `JS Result: ${valStr}`;
                actionFailed = false;
              } else if (cdpResult && !cdpResult.attachDenied && cdpResult.error) {
                console.warn('[CDP] execute_js failed, falling back:', (typeof cdpResult === 'object' && cdpResult !== null && typeof cdpResult.error === 'string' ? cdpResult.error : String(cdpResult?.error || 'unknown')));
              }
            } catch (e) {
              console.warn('[CDP] execute_js threw, falling back:', getErrorMessage(e));
            }
            if (!cdpUsed) {
              const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
              result = (typeof res === 'string' ? res : null) || 'Done';
              actionFailed = /^(Error|BLOCKED:|JS Error)|timed out| not found/i.test(result);
            }
          } else {
            // (3.49.1) Push undo entry for type actions when not using CDP path.
            if (command.type === 'type') {
              try {
                let _prevVal = '';
                try {
                  const _valRes = await sendMessageWithRetry(tab, { action: 'execute_command', command: { type: 'execute_js', code: `(function(){const el=document.querySelector(${JSON.stringify(command.selector||'')});return el?el.value:'';})()` } }, 1);
                  if (typeof _valRes === 'string' && _valRes.startsWith('JS Result: ')) _prevVal = _valRes.slice('JS Result: '.length);
                } catch (_) { /* prev value capture non-fatal */ }
                undoStack.push({ type: 'type', tabId: tab, selector: command.selector || command.ref || '', previousValue: _prevVal });
                if (undoStack.length > 10) undoStack.shift();
                chrome.runtime.sendMessage({ action: 'undo_stack_updated', size: undoStack.length }).catch(() => {});
              } catch (_) { /* undo stack non-fatal */ }
            }
            const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
            result = (typeof res === 'string' ? res : null) || 'Done';
            actionFailed = /^(Error|BLOCKED:)| not found|Element not found|No element/i.test(result);
          }
        } catch (err) {
          result = `Content script error: ${getErrorMessage(err || 'command failed to reach page')}`;
          actionFailed = true;
        }
      }

      // (v3.54) CDP fallback for click: when content script can't inject and click fails,
      // resolve the element via CDP and click its center coordinates.
      if (actionFailed && _cdpFallbackActive && (/^(click|right_click|double_click)$/.test(command.type))) {
        try {
          const sel = command.selector || (command.ref ? command.ref.replace(/^ref_/, '#') : '');
          if (sel) {
            const cdpCode = 'var el = null;'
              + 'try { el = document.querySelector(' + JSON.stringify(sel) + '); } catch(e) {}'
              + 'if (!el) {'
              + '  var allEls = document.querySelectorAll("button, a, [role=\\"button\\"], input, [onclick]");'
              + '  for (var i = 0; i < allEls.length; i++) {'
              + '    if (allEls[i].textContent && allEls[i].textContent.trim().length) { el = allEls[i]; break; }'
              + '  }'
              + '}'
              + 'if (!el) return null;'
              + 'var r = el.getBoundingClientRect();'
              + 'return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height };'
            const cdpBbox = await cdpExecuteJs(tab, cdpCode, { timeout: 3000 });
            if (cdpBbox && cdpBbox.ok && cdpBbox.value && cdpBbox.value.x != null && cdpBbox.value.y != null) {
              const cx = Math.round(cdpBbox.value.x);
              const cy = Math.round(cdpBbox.value.y);
              const r = await cdpDispatchClick(tab, cx, cy, {
                button: command.type === 'right_click' ? 'right' : 'left',
                clickCount: command.type === 'double_click' ? 2 : 1,
                description: '[CDP fallback] Clicking ' + sel
              });
              if (r && r.ok) {
                result = `Clicked ${sel} via CDP fallback at (${cx},${cy})`;
                actionFailed = false;
                sendSilentUpdate(`[CDP] Clicked ${sel} at (${cx},${cy})`, stepCount);
              }
            }
          }
        } catch (_) { /* CDP click fallback non-fatal */ }
      }
      // (v3.66) CDP fallback for select: when content script is dead, set dropdown via CDP JS
      if (actionFailed && _cdpFallbackActive && command.type === 'select') {
        try {
          // Cache JSON.stringify calls to avoid redundant serialization (perf)
          const _selJson = JSON.stringify(command.selector || '');
          const _valJson = JSON.stringify(command.value || '');
          const selJs = '(function(){'
            + 'var el = document.querySelector(' + _selJson + ');'
            + 'if (!el) { var sels = document.querySelectorAll("select"); for (var i = 0; i < sels.length; i++) { if (sels[i].offsetParent !== null) { el = sels[i]; break; } } }'
            + 'if (!el) return null;'
            + 'var opts = el.options;'
            + 'for (var i = 0; i < opts.length; i++) {'
            + '  if (opts[i].value === ' + _valJson + ' || (typeof opts[i].text === "string" && opts[i].text.trim().toLowerCase() === (' + _valJson + ').toLowerCase())) {'
            + '    el.selectedIndex = i; el.value = opts[i].value;'
            + '    el.dispatchEvent(new Event("change", { bubbles: true }));'
            + '    return el.value;'
            + '  }'
            + '}'
            + 'return null;'
            + '})()';
          const selRes = await cdpExecuteJs(tab, 'return ' + selJs, { timeout: 3000 });
          if (selRes && selRes.ok && selRes.value != null) {
            result = `Selected "${command.value}" via CDP fallback`;
            actionFailed = false;
            sendSilentUpdate('[CDP] Selected ' + command.value, stepCount);
          }
        } catch (_selErr) { console.warn('[Sentinel/CDP] Select fallback error:', getErrorMessage(_selErr)); }
      }

      // (v3.66) CDP fallback for type: when content script can't inject,
      // resolve the input element via CDP, focus it, and dispatch keyboard events.
      if (actionFailed && _cdpFallbackActive && command.type === 'type') {
        try {
          const sel = command.selector || (command.ref ? command.ref.replace(/^ref_/, '#') : '');
          if (sel) {
            // Focus the input via CDP
            const focusCode = 'var el = document.querySelector(' + JSON.stringify(sel) + ');'
              + 'if (!el) { var inputs = document.querySelectorAll("input, textarea, [contenteditable]"); for (var i = 0; i < inputs.length; i++) { if (inputs[i].offsetParent !== null) { el = inputs[i]; break; } } }'
              + 'if (!el) return null;'
              + 'el.focus(); el.value = "";'
              + 'return el.tagName;'
            const focusResult = await cdpExecuteJs(tab, focusCode, { timeout: 3000 });
            if (focusResult && focusResult.ok && focusResult.value) {
              // Type each character via CDP Input.dispatchKeyEvent
              const text = command.text || '';
              // Note: no additional reference used - CDP sends directly to tab
              for (let ci = 0; ci < text.length; ci++) {
                const ch = text[ci];
                try {
                  await new Promise((res, rej) => {
                    chrome.debugger.sendCommand({ tabId: typeof tab === 'object' && tab !== null ? tab.id : tab }, 'Input.dispatchKeyEvent', {
                      type: 'keyDown',
                      text: ch,
                      key: ch,
                      code: 'Key' + ch.toUpperCase()
                    }, (r) => { if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) rej((typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError))); else res(r); });
                  });
                  await new Promise((res, rej) => {
                    chrome.debugger.sendCommand({ tabId: typeof tab === 'object' && tab !== null ? tab.id : tab }, 'Input.dispatchKeyEvent', {
                      type: 'keyUp',
                      key: ch,
                      code: 'Key' + ch.toUpperCase()
                    }, (r) => { if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) rej((typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError))); else res(r); });
                  });
                } catch (_keyErr) {
                  // Fallback: set value directly via CDP JS
                  // Cache JSON.stringify calls to avoid redundant serialization (perf)
                  const _selJson = JSON.stringify(sel);
                  const _textJson = JSON.stringify(text);
                  const setCode = 'var el = document.querySelector(' + _selJson + '); if (el) { el.value = ' + _textJson + '; el.dispatchEvent(new Event("input",{bubbles:true})); }';
                  await cdpExecuteJs(tab, setCode, { timeout: 2000 });
                  break;
                }
              }
              result = `Typed via CDP fallback into ${sel}`;
              actionFailed = false;
              sendSilentUpdate('[CDP] Typed into ' + sel, stepCount);
            }
          }
        } catch (_typeErr) { console.warn('[Sentinel/CDP] Type fallback error:', getErrorMessage(_typeErr)); }
      }

      //       // ═══════════════════════════════════════════════════════════════
      // (v3.69) UNIVERSAL CDP ACTION FALLBACK — "No-Excuses" Layer
      // If ANY action fails through content script AND existing CDP paths,
      // this catches it and executes the equivalent via CDP Runtime.evaluate.
      // Handles: click, type, select, check, hover, scroll_to, wait_for_*,
      // extract, verify, and any unknown action type. Nothing stops the agent.
      // ═══════════════════════════════════════════════════════════════
      if (actionFailed && _cdpFallbackActive) {
        try {
          const _ufbResult = await _universalCdpFallback(tab, command, { timeout: 5000 });
          if (_ufbResult && _ufbResult.ok) {
            result = _ufbResult.result || 'Executed via universal CDP fallback';
            actionFailed = false;
            sendSilentUpdate(`[CDP-UFB] ${command.type} success`, stepCount);
            console.log('[Sentinel/UFB] Universal fallback succeeded for', command.type);
          } else if (_ufbResult && _ufbResult.result) {
            result = _ufbResult.result;
            // Don't mark success but LLM gets useful feedback about what happened
          }
        } catch (_ufbErr) {
          console.warn('[Sentinel/UFB] Universal fallback error:', getErrorMessage(_ufbErr));
        }
      }

      // (7.1) Automatic bbox fallback: if a click fails due to selector issues,
      // resolve the element's bbox from the page and retry as click_at.
      if (actionFailed && command.type === 'click' && !command._bboxFallback) {
        try {
          const bbox = await sendMessageWithRetry(tab, { action: 'get_bbox', ref: command.ref, selector: command.selector }, 1);
          if (bbox && typeof bbox.x === 'number' && typeof bbox.y === 'number') {
            const cx = Math.round(bbox.x + (bbox.width || 0) / 2);
            const cy = Math.round(bbox.y + (bbox.height || 0) / 2);
            const fallbackCmd = { type: 'click_at', x: cx, y: cy, _bboxFallback: true };
            const fallbackRes = await sendMessageWithRetry(tab, { action: 'execute_command', command: fallbackCmd });
            const resStr = String(fallbackRes);
            if (fallbackRes && !resStr.startsWith('Error') && !resStr.includes('not found')) {
              result = `${resStr} [bbox fallback at (${cx},${cy})]`;
              actionFailed = false;
              sendSilentUpdate(`Selector failed → retried with bbox coordinates (${cx},${cy})`, stepCount);
              // Send a click_at action message so the crosshair shows on the mini-shot
              sendActionMessage({ ...command, type: 'click_at', x: cx, y: cy, _bboxFallback: true }, stepCount, observation);
            }
          }
        } catch (_) { /* bbox fallback is always non-fatal */ }
      }

      // (v3.67) UNIVERSAL CDP fallback — when content script is dead and a specific
      // CDP handler didn't fire, convert the failed action to execute_js via CDP.
      // Covers: select, check, check_all, scroll_to, wait_for_element, hover, wait_for_text
      if (actionFailed && _cdpFallbackActive && !CDP_FALLBACK_BLOCKED.has(command.type)) {
        try {
          let _universalJs = '';
          const _sel = command.selector || (command.ref ? command.ref.replace(/^ref_/, '#') : '');
          // Cache JSON.stringify(_sel) to avoid redundant serialization (perf)
          const _selJson = JSON.stringify(_sel);
          if (command.type === 'select' && _sel && command.value) {
            // Cache value JSON.stringify calls too
            const _valJson = JSON.stringify(command.value);
            const _valLowerJson = JSON.stringify(String(command.value).toLowerCase());
            _universalJs = '(function(){var el=document.querySelector(' + _selJson + ');'
              + 'if(!el){var ss=document.querySelectorAll("select");for(var i=0;i<ss.length;i++){if(ss[i].offsetParent!==null){el=ss[i];break;}}}'
              + 'if(!el)return null;var opts=el.options;'
              + 'for(var i=0;i<opts.length;i++){if(opts[i].value===' + _valJson + '||opts[i].text.toLowerCase().includes(' + _valLowerJson + ')){'
              + 'el.selectedIndex=i;el.value=opts[i].value;el.dispatchEvent(new Event("change",{bubbles:true}));return el.value;}}return null;})()';
          } else if (command.type === 'check' && _sel) {
            _universalJs = '(function(){var el=document.querySelector(' + _selJson + ');if(!el)el=document.querySelector("[type=checkbox]");if(el){el.checked=true;el.dispatchEvent(new Event("change",{bubbles:true}));return"checked";}return null;})()';
          } else if (command.type === 'scroll_to' && _sel) {
            _universalJs = '(function(){var el=document.querySelector(' + _selJson + ');if(el){el.scrollIntoView({behavior:"smooth",block:"center"});return"scrolled";}return null;})()';
          } else if (command.type === 'wait_for_element' && _sel) {
            _universalJs = '(function(){var el=document.querySelector(' + _selJson + ');return el?"found":"not_found";})()';
          } else if (command.type === 'wait_for_text' && command.text) {
            _universalJs = '(function(){if(!document.body)return"not_found";var t=document.body.innerText;return t.indexOf(' + JSON.stringify(command.text) + ')>=0?"found":"not_found";})()';
          } else if (command.type === 'hover' && _sel) {
            // Hover via CDP: dispatch mouseover/mouseenter events
            _universalJs = '(function(){var el=document.querySelector(' + _selJson + ');if(el){el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));el.dispatchEvent(new MouseEvent("mouseenter",{bubbles:true}));return"hovered";}return null;})()';
          }
          if (_universalJs) {
            const _uniRes = await cdpExecuteJs(tab, 'return ' + _universalJs, { timeout: 3000 });
            if (_uniRes && _uniRes.ok && _uniRes.value != null && _uniRes.value !== 'not_found') {
              result = `${command.type} via CDP universal fallback`;
              actionFailed = false;
              sendSilentUpdate(`[CDP] ${command.type} executed via universal fallback`, stepCount);
            }
          }
        } catch (_uniErr) { /* universal CDP fallback non-fatal */ }
      }

            // Post-click: handle navigation and new tab capture
      if (/^(click|click_at|double_click)$/.test(command.type)) {
        await sleep(1000);
        try {
          const allTabs = await new Promise(resolve => {
            chrome.tabs.query({}, (t) => {
              if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) {
                console.error('[New tab detection] tabs.query failed:', (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError)));
                resolve([]);
              } else {
                resolve(t || []);
              }
            });
          });
          const newTabs = allTabs.filter(t => t.openerTabId === tab && t.id !== tab);
          if (newTabs[0] != null) {
            const newTab = newTabs[0];
            const newUrl = newTab.url;
            if (getTabCount() > 1 && newTab.id) {
              // Multi-tab mode: register the new tab as a tracked context
              registerInitialTab(newTab.id, newUrl);
              // Mark it as agent-created since it was opened by page interaction
              const newCtx = getTabContext(newTab.id);
              if (newCtx) newCtx.isAgentCreated = true;
              // (3.7.2) Attach the click-opened new tab to the Sentinel group.
              try { await attachTabToSentinelGroup(newTab.id); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
              let _host;
              try { _host = newUrl ? new URL(newUrl).hostname : 'new page'; } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); _host = newUrl || 'new page'; }
              result = `Clicked -> new tab opened: ${_host}`;
            } else {
              // Single tab mode: capture URL, close new tab, navigate original (backward compat)
              chrome.tabs.remove(newTabs.map(t => t.id)).catch((e) => {
                console.error('[newCtx] Unhandled rejection:', e);
              });
              await chrome.tabs.update(tab, { url: newUrl });
              await waitForPageLoad(tab);
              await sleep(500);
              let _host;
              try { _host = newUrl ? new URL(newUrl).hostname : 'new page'; } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); _host = newUrl || 'new page'; }
              result = `Clicked -> navigated to ${_host}`;
            }
          } else {
            const updatedTab = await getTabInfo(tab);
            if (updatedTab && updatedTab.url !== urlBeforeCommand) {
              await waitForPageLoad(tab);
              await sleep(500);
              try {
                const _clickedHost = new URL(updatedTab.url).hostname.toLowerCase();
                const _fromHost = urlBeforeCommand ? new URL(urlBeforeCommand).hostname.toLowerCase() : '';
                const _clickedHostNoWww = _clickedHost.replace(/^www\./, '');
                const _fromHostNoWww = _fromHost.replace(/^www\./, '');
                const _crossDomain = _fromHost && _clickedHost && !_clickedHost.includes(_fromHostNoWww) && !_fromHost.includes(_clickedHostNoWww);
                if (_crossDomain) {
                  result = `WARNING: Click navigated away from ${_fromHost} to ${_clickedHost}. You likely clicked an EXTERNAL link instead of an on-page element. Navigate back to ${_fromHost} and look for the correct in-page link (e.g., "comments", "discuss", or "N comments" text).`;
                  actionFailed = true;
                } else {
                  result = `Clicked -> navigated to ${_clickedHost}`;
                }
              } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); result = 'Clicked -> page navigated'; }
            }
          }
        } catch (e) { console.warn('[Sentinel] click handler failed:', getErrorMessage(e)); }
      }

      // Track success/failure for self-healing
      if (actionFailed) {
        consecutiveFailures++;
        // (3.30.0) Trust-score counters — failedSteps accumulates over the run,
        // consecutiveFailureMax tracks the worst streak so even runs that
        // recover get penalized for getting stuck in the middle.
        failedSteps++;
        if (consecutiveFailures > consecutiveFailureMax) consecutiveFailureMax = consecutiveFailures;
        currentStrategies.push(`${command.type}:${command.selector || command.url || ''}`);
        if (currentStrategies.length > 10) currentStrategies.shift();
      } else {
        consecutiveFailures = 0;
        currentStrategies = [];
      }

      // (3.46.1) Page stagnation detection — if the page didn't change after a
      // click/type, increment stagnation counter. Resets on navigate, extract,
      // or any page-changing action.
      // navigate always changes the page, but its new DOM hash isn't captured until
      // the next iteration's observation phase — exclude it to avoid false stagnation.
      const _isPageMutating = /^(click|click_at|type|press_key|select|check|check_all)$/.test(command.type);
      const _pageChanged = _observedHashBefore !== _lastObservedDomHash;
      if (_isPageMutating && !_pageChanged && !actionFailed) {
        _pageStagnation++;
      } else {
        _pageStagnation = 0;
      }

      // (v3.52) click_at loop detector — catches the pattern where a text-only model
      // keeps generating click_at with wrong coordinates (e.g., CNN overlay with glm-5).
      // If we see 4+ consecutive click_at commands with no progress, inject recovery.
      if (command.type === 'click_at') {
        _clickAtLoopCount++;
        if (_clickAtLoopCount >= 3 && productiveSteps === 0) {
          console.error('[Sentinel/RECOVERY] click_at loop detected:', _clickAtLoopCount, 'consecutive click_at with 0 productive steps');
          // Auto-dismiss common overlay patterns. Two passes:
          //   1. selector-based: known consent libraries (OneTrust, Didomi,
          //      Sourcepoint, etc.) and aria-label heuristics.
          //   2. text-based fallback: any visible button whose text matches
          //      Accept/Agree/OK/Continue/I agree/Got it (handles bespoke
          //      overlays like CNN's that don't use a known framework).
          try {
            await cdpExecuteJs(tab, '(function(){var d=false;var p=["button[aria-label*=Accept]","button[aria-label*=agree]","button[aria-label*=Close]","button[aria-label*=Dismiss]",".consent-accept",".cookie-accept","button.accept","button.acceptAll","button#onetrust-accept-btn-handler",".didomi-accept-btn","[class*=accept]","[class*=agree]","[class*=consent] button","[class*=overlay] button","dialog button","[role=dialog] button",".fc-button.fc-cta-consent",".sp_choice_type_11"];for(var i=0;i<p.length;i++){var es=document.querySelectorAll(p[i]);for(var j=0;j<es.length;j++){if(es[j].offsetParent!==null||window.getComputedStyle(es[j]).position==="fixed"){es[j].click();d=true;break;}}if(d)break;}if(!d){var rx=/^(accept(\\s+all)?|i\\s+agree|agree|allow(\\s+all)?|got\\s+it|ok|okay|continue|yes,?\\s+i\\s+(agree|accept)|consent)$/i;var btns=document.querySelectorAll(\'button, [role="button"], a.button, input[type="submit"], input[type="button"]\');for(var k=0;k<btns.length;k++){var b=btns[k];var t=((b.innerText||b.value||b.getAttribute("aria-label")||"")+"").trim();if(!t||t.length>40)continue;if(!rx.test(t))continue;var br=b.getBoundingClientRect();if(br.width<=0||br.height<=0)continue;var cs=window.getComputedStyle(b);if(cs.visibility==="hidden"||cs.display==="none")continue;try{b.click();d=true;break;}catch(_e){}}}return d?"dismissed":"no-overlay";})()', { timeout: 5000 });
          } catch(_oe) { /* non-fatal */ }
          historyPush({
            step: stepCount,
            action: { type: 'note', text: `SYSTEM: click_at loop detected! ${_clickAtLoopCount} clicks with no progress. Auto-dismissed common overlays. ` +
              'If the overlay is still visible: (1) Check the element list for consent/agree buttons. ' +
              '(2) Use execute_js with a CSS selector to click it. ' +
              '(3) Try scrolling to reveal the button.' },
            result: 'Recovery from click_at loop + auto-overlay-dismiss'
          });
          await persistHistory();
          _clickAtLoopCount = 0;
          agentPlan = null;
          currentPlanStep = 0;
        }
      } else {
        // Reset on any non-click_at action
        _clickAtLoopCount = 0;
      }

      // (v3.67) Same-command loop detector — if the LLM emits 3+ consecutive
      // commands of the same type (select, wait_for_text, etc.) with no page change,
      // inject a recovery note telling it to switch strategy.
      if (command.type === _lastCmdType) {
        _sameCmdCount++;
      } else {
        _sameCmdCount = 0;
        _lastCmdType = command.type;
      }
      // v3.68: Trigger on 2 repeats (not 3), cover ALL action types, and be more specific
      if (_sameCmdCount >= 2 && !LOOP_EXCLUDE_TYPES.has(command.type)) {
        const _pageUnchanged = currentUrl === (_lastLoopUrl || '');
        console.warn(`[Sentinel/RECOVERY] Same-command loop:`, command.type, `used ${_sameCmdCount + 1} times. Page unchanged:`, _pageUnchanged);
        // Template literal more efficient than repeated += concatenation
        // (v3.69) Smart Recovery: generate site-specific strategies
        const _smartStrats = _generateSmartRecovery(goal, currentUrl, pageText, observation, history, stepCount);
        const _smartStratMsg = _smartStrats.length ? `SMART STRATEGIES for this page:\n${_smartStrats.map(s => `→ ${s}`).join('\n')}\n` : '';
        const _recoveryMsg = `SYSTEM: ${command.type} loop detected! You have used ${command.type} ${_sameCmdCount + 1} times in a row${_pageUnchanged ? ' with NO page change' : ''}. STOP using ${command.type}. ${_cdpFallbackActive ? 'The content script is NOT available on this page (CDP fallback active). ' : ''}Switch to a completely different approach. Examples:\n- Use execute_js to extract data or interact with the DOM directly\n- Use click with a specific selector to interact with elements\n- Use smart_navigate with a direct URL (e.g., sort by adding &s=review-rank to Amazon URL)\n- Read the page text content and extract what you need without interacting\n\n${_smartStratMsg}`;
        historyPush({
          step: stepCount,
          action: { type: 'note', text: _recoveryMsg },
          result: `Recovery from ${command.type} loop`
        });
        await persistHistory();
        _sameCmdCount = 0;
        agentPlan = null;
        currentPlanStep = 0;
      }

      // Check for stall
      const stall = detectStall(history, consecutiveFailures, currentStrategies);
      if (stall.stalled) {
        sendSilentUpdate(`Stall detected: ${stall.reason}. Recovering...`, stepCount);

        if (stall.recoveryAction === 'RESCAN_AND_REPLAN') {
          // Force re-scan and replan from current page state
          agentPlan = null;
          currentPlanStep = 0;
          consecutiveFailures = 0;
          _pageStagnation = 0;
          currentStrategies = [];

          // Inject stall context into history so the LLM knows what happened
          historyPush({
            step: stepCount,
            action: { type: 'note', text: `STALL RECOVERY: Re-assessing page state. Previous approach: ${stall.reason}` },
            result: 'Stall detected -- forcing page re-scan and strategy change'
          });
          await persistHistory();

          // Skip the normal sleep to recover faster
          continue;
        }

        if (stall.recoveryAction === 'FORCE_STRATEGY_SHIFT') {
          // Bump consecutiveFailures above threshold to ensure strategyCtx fires in callLLM
          consecutiveFailures = Math.max(consecutiveFailures, CONFIG.strategyShiftThreshold);
          // Don't continue -- let the normal flow proceed with the strategy shift prompt injected
        }
      }

      sendActionResult(stepCount, result, actionFailed);
      // (3.16.0) Finalize the dispatch activity item with the outcome.
      try {
        const _resPreview = typeof result === 'string' ? result.substring(0, 160) : '';
        if (actionFailed) {
          activityFail(stepCount, 'dispatch', describeAction(command) + ' — failed', { result: _resPreview });
        } else {
          activityDone(stepCount, 'dispatch', describeAction(command), { result: _resPreview });
        }
      } catch (_e) {
        // Activity emit failed non-fatally
      }
      historyPush({ step: stepCount, action: command, result });

      // (3.40.0) Audit log: append a structured entry for MSP compliance.
      try {
        appendAuditEntry(runLogId, {
          ts:      Date.now(),
          step:    stepCount,
          type:    command.type || 'unknown',
          target:  _describeTarget(command),
          outcome: typeof result === 'string' ? result.slice(0, 200) : (actionFailed ? 'failed' : 'ok'),
        });
      } catch (_e) {
        // Audit log append failed non-fatally
      }

      // (3.12.0) Vision-based action verification flag. After every modifying
      // action that didn't fail outright, mark the next observation cycle to
      // explicitly verify the action took effect. The actual verification
      // runs via prompt-injection in llm-client.js — no extra API call,
      // just forces the LLM to look at the post-action screenshot and
      // confirm before continuing.
      try {
        if (!actionFailed && command && MODIFYING_ACTIONS.has(command.type)) {
          pendingVerification = {
            type: command.type,
            description: (command.text || command.selector || command.value || command.url || command.key || '').toString().substring(0, 120),
            attemptedAt: stepCount
          };
        } else {
          // Non-modifying action or failed modifying action: clear stale verification
          // so the same old action isn't re-verified in subsequent steps.
          pendingVerification = null;
        }
      } catch (_) { pendingVerification = null; }

      // (3.9.0) Forensic run log: persist a structured record per step.
      try {
        if (runLogId) {
          runLogBuffer.push({
            step: stepCount,
            timestamp: new Date().toISOString(),
            kind: 'action',
            url: currentUrl,
            tenant: detectedTenant ? (detectedTenant.chipText || detectedTenant.onmicrosoft || detectedTenant.tid || '') : '',
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
              const r = result;
              return typeof r === 'string' ? r.substring(0, 500) : JSON.stringify(r || '').substring(0, 500);
            })(),
            failed: !!actionFailed,
            reasoning: (() => {
              const r = command.__reasoning;
              return (typeof r === 'string' && r) ? r.substring(0, 400) : undefined;
            })(),
            screenshot: _stepScreenshots.get(stepCount) || undefined,
          });
          // Keep last 200 entries; older ones get rolled into a summary.
          if (runLogBuffer.length > 200) {
            runLogBuffer.splice(0, runLogBuffer.length - 200);
          }
          // Persist to storage every step.
          chrome.storage.local.set({
            [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() }
          }).catch((e) => {
            console.error('[agent-engine] Unhandled rejection:', e);
          });
        }
      } catch (_) { /* never crash the loop on logging */ }

      // Consecutive navigate tracking
      if (command.type === 'navigate') {
        consecutiveNavigates++;
      } else if (EXTRACT_ACTIONS.has(command.type)) {
        consecutiveNavigates = 0;
      }

      // HARD GUARD: After 3 consecutive navigates without reading/extracting
      if (consecutiveNavigates >= 3) {
        sendSilentUpdate(`Auto-reading page after ${consecutiveNavigates} navigates`, stepCount);
        try {
          const forcedRead = await sendMessageWithRetry(tab, { action: 'read_page' });
          if (forcedRead) {
            const forcedText = (forcedRead.content || '').substring(0, 8000);
            historyPush({ step: stepCount, action: { type: 'read_page' }, result: `Auto-read: ${forcedText.substring(0, 500)}` });
          }
        } catch (_) { /* non-fatal */ }
        consecutiveNavigates = 0;
      }
      // (3.8.2) Roll up old history into a single summary entry so the
      // LLM prompt stays bounded on long multi-portal runs.
      try { maybeRollupHistory(history); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }

      // (3.8.2) Periodic progress checkpoint chat message.
      try { maybePostProgressUpdate(stepCount, history, agentMemory); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }

      // Cap in-memory history
      if (history.length > CONFIG.maxHistoryEntries) {
        history.splice(0, history.length - CONFIG.maxHistoryEntries);
      }
      await persistHistory();
      // Service-worker resilience checkpoint (#16, full). State is persisted
      // to chrome.storage.session every step; restoreFromCheckpoint() in
      // index.js can reconstruct the full in-memory state on SW restart.
      await writeCheckpoint(stepCount);
      // Human-like pacing between steps — variable delays so it feels like an operator working
      // Respects speed mode: turbo (0.2x), normal (1x), stealth (2x)
      const speedMultiplier = agentSpeed === 'turbo' ? 0.02 : agentSpeed === 'stealth' ? 2.0 : agentSpeed === 'fast' ? 0.15 : 1.0;
      const actionType = command.type;
      let baseDelay;
      if (MEMORY_WRITING_ACTIONS.has(actionType)) {
        baseDelay = 100 + Math.random() * 50;     // 100-150ms: data gathering (turbo ~7ms)
      } else if (MODIFYING_INTERACTIVE_ACTIONS.has(actionType)) {
        baseDelay = 200 + Math.random() * 100;    // 200-300ms: deliberate actions (turbo ~15ms)
      } else if (OTHER_ACTIONS.has(actionType)) {
        baseDelay = 75 + Math.random() * 50;      // 75-125ms: utility actions (turbo ~5ms)
      } else {
        baseDelay = 150 + Math.random() * 100;    // 150-250ms: default (turbo ~12ms)
      }
      await sleep(baseDelay * speedMultiplier);

    } catch (err) {
      console.error('[Sentinel] Agent loop error:', getErrorMessage(err), (typeof err.stack === 'string' ? err.stack : '[no stack]'));
      sendSilentUpdate(`Loop error: ${getErrorMessage(err)}`, stepCount);
      consecutiveFailures++;
      // Don't kill the loop on tab-closed errors — try to recover instead
      if (getErrorMessage(err).includes('was closed')) {
        console.warn('[Sentinel] Tab was closed, attempting recovery...');
        // Try to find another tab or the same tab re-created
        try {
          const allTabs = await new Promise(resolve => {
            chrome.tabs.query({}, (t) => {
              if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) {
                console.error('[Tab recovery] tabs.query failed:', (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null && typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError)));
                resolve([]);
              } else {
                resolve(t || []);
              }
            });
          });
          if (allTabs[0]) {
            const recoveryTab = allTabs[0];
            registerInitialTab(recoveryTab.id, recoveryTab.url || '');
          } else {
            console.error('[Sentinel] No tabs available, stopping agent');
            agentRunning = false;
            break;
          }
        } catch (recoveryErr) {
          console.error('[Sentinel] Recovery failed:', recoveryErr);
          agentRunning = false;
          break;
        }
      }
      await sleep(500);  // SPEED: reduced from 3000ms — recover faster
    }
  }

  // (3.50.0) Generate report WHILE the keepalive is still running.
  // Previously, keepalive was stopped before report generation, which could
  // cause the SW to terminate mid-fetch on MV3. Now we generate the report
  // first, THEN stop the keepalive and do cleanup.

  // Generate report BEFORE destructive cleanup (tab closing, debugger detaching).
  // reportData is already a snapshot, so cleanup order doesn't affect its content.
  // Keepalive must stay active for this fetch to complete.
  let agentReport = null;
  // (3.50.1) Force-capture reportData if somehow null at this point.
  if (!reportData && finished) {
    console.warn('[Sentinel/report] reportData was NULL — force-capturing');
    reportData = {
      goal: _lastGoal || '',
      history: history.slice(),
      agentMemory: { ...agentMemory },
      agentPlan: null,
      stepCount,
      apiCallCount,
      tabContexts: getAllTabContexts().map(tc => ({ label: tc.label, url: tc.url, hasScreenshot: !!tc.snapshot }))
    };
  }
  if (reportData) {
    // ═══════════════════════════════════════════════════════════════
    // (3.50.3) SAVE FALLBACK REPORT FIRST — before any LLM call.
    // MV3 kills idle SWs during await fetch(). If we don't save NOW,
    // the SW dies and we lose the report entirely.
    // ═══════════════════════════════════════════════════════════════
    const _fbReport = {
      summary: `Investigation complete: ${reportData.stepCount} steps, ${reportData.apiCallCount} API calls.`,
      fullReport: buildFallbackReport(reportData),
      structuredData: { stepCount: reportData.stepCount, apiCallCount: reportData.apiCallCount, timestamp: new Date().toISOString() },
      goal: reportData.goal,
      timestamp: new Date().toISOString(),
      _isFallback: true
    };
    try {
      await chrome.storage.local.set({ last_agent_report: _fbReport });
      sendReportUpdate('ready', _fbReport);
    } catch (e) {
      console.error('[Sentinel/report] Fallback save failed:', e);
    }

    // Now try the fancy LLM-generated report — if SW dies here, fallback is already saved
    sendSilentUpdate('Enhancing report with AI...', stepCount);
    try {
      const _reportTimeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Report LLM timeout (45s)')), 45000)
      );
      agentReport = await Promise.race([generateReport(reportData, CONFIG), _reportTimeout]);
      // LLM succeeded — overwrite fallback with the polished version
      // (3.50.4) Defensive: if generateReport returns malformed data, fall back
      if (typeof agentReport !== 'object' || !agentReport || typeof agentReport.fullReport !== 'string') {
        console.warn('[Sentinel/report] generateReport returned malformed data, using fallback');
        agentReport = _fbReport;
      } else {
        agentReport._isFallback = false;
      }
      sendReportUpdate('ready', agentReport);
      await chrome.storage.local.set({ last_agent_report: agentReport });
    } catch (err) {
      console.error('[Sentinel/report] LLM report failed (fallback already saved):', getErrorMessage(err));
      agentReport = _fbReport;
    }
  } else {
    console.warn('[Sentinel/report] No reportData — skipping report');
    sendReportUpdate('error', null, 'Agent finished without collecting execution data');
  }

  // NOW safe to release keepalive — report is already generated
  try { stopSwKeepalive(_loopKaName); } catch (e) { console.error('[Sentinel] SW keepalive stop failed:', getErrorMessage(e)); }
  try { await chrome.storage.session.remove(['agentRunning', 'agentGoal', 'agentStartTime']); } catch(e) {
    console.warn('[Sentinel] Failed to clear agent state from session storage:', getErrorMessage(e));
    // Try to force-clear individual keys
    try { await chrome.storage.session.remove(['agentRunning']); } catch (_clearErr) {}
    try { await chrome.storage.session.remove(['agentGoal']); } catch (_clearErr) {}
    try { await chrome.storage.session.remove(['agentStartTime']); } catch (_clearErr) {}
  }

  if (finished) {
    try {
      await chrome.storage.local.set({ agent_history: [], agent_memory: {} });
    } catch (e) {
      console.warn('[Sentinel] post-loop history/memory clear failed:', getErrorMessage(e));
    }
  }

  // Release any CDP debugger attachments held during the run.
  try { await detachAllDebuggees(); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }

  // Batch-close all agent-created tabs
  await closeAllAgentTabs();

  // (3.7.2) Dissolve the visual tab group at natural loop end too.
  try { await detachAllSentinelTabs();
    // (v3.53) Re-enable side panel on all tabs now that agent stopped
    try { await _enableSidePanelEverywhere(); } catch (e) { console.warn('[Sentinel] Side panel enable failed:', getErrorMessage(e)); } } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }

  agentRunning = false;
  console.log(`[Sentinel] Agent completed. Total API calls: ${apiCallCount}`);

  // (3.12.0) Tally client-knowledge entries used and bump the client's runCount.
  // Quiet, non-fatal — never let knowledge bookkeeping break the run finish path.
  try {
    if (activeClientId) {
      await markRunCompleted(activeClientId, clientKnowledgeUsedIds);
    }
  } catch (_) { /* non-fatal */ }

  // Signal completion via messaging (replaces polling for scheduler)
  chrome.runtime.sendMessage({ action: 'agent_loop_complete', report: agentReport }).catch((e) => {
    console.error('[agentReport] Unhandled rejection:', e);
  });
}

// ========== Self-Learning ==========
async function saveLearnedPattern(goal, history, success) {
  try {
    const stored = await chrome.storage.local.get(['learned_patterns']);
    const patterns = stored.learned_patterns || [];
    // Scrub PII before persisting — IPs, emails, ticket numbers, and quoted
    // strings (often client names) are replaced with safe placeholders so
    // chrome.storage.local doesn't accumulate identifiable client data.
    const _scrubPii = (str) => String(str)
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED:ip]')
      .replace(/[\w.+-]+@[\w.-]+/g, '[REDACTED:email]')
      .replace(/(?:\b(?:TKT|TICKET|INC|INCIDENT|SR)|#)\s*\d+/gi, '[REDACTED:ticket]')
      .replace(/"[^"]{2,60}"/g, '"[REDACTED:client]"')
      .replace(/'[^']{2,60}'/g, "'[REDACTED:client]'");
    const steps = [];
    for (const h of history) {
      if (h.action) {
        steps.push({ type: h.action.type, selector: h.action.selector });
      }
    }
    patterns.push({
      goal: _scrubPii(goal.substring(0, 100)),
      steps,
      success,
      timestamp: Date.now()
    });
    if (patterns.length > CONFIG.maxLearnedPatterns) patterns.splice(0, patterns.length - CONFIG.maxLearnedPatterns);
    await chrome.storage.local.set({ learned_patterns: patterns });
  } catch (e) { console.warn('Failed to save pattern:', getErrorMessage(e)); }
}

// ========== Utilities ==========
async function enforceRateLimit() {
  const delay = _runSettings.quickMode ? 200 : CONFIG.minDelayBetweenCalls;
  const delayNeeded = Math.max(0, delay - (Date.now() - lastApiCallTime));
  if (delayNeeded > 0) await sleep(delayNeeded);
  lastApiCallTime = Date.now();
}

/**

/**
 * Escape a string for safe inclusion in JavaScript code (CDP injection).
 * Handles backslashes, quotes, newlines, carriage returns, and tabs.
 * @param {string} str - The string to escape.
 * @param {string} [quote='"'] - The quote character to escape ('"' or "'").
 * @returns {string} The escaped string.
 */
function escapeJsString(str, quote = '"') {
  if (typeof str !== 'string') return '';
  const quoteChar = quote === '"' ? '"' : "'";
  return str.replace(/[\\'"\n\r\t]/g, (char) => {
    switch (char) {
      case '\\': return '\\\\';
      case quoteChar: return '\\' + quoteChar;
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      default: return char;
    }
  });
}

// ========== Approval Mode ==========
// (3.20.1) Defensive target-formatter — never shows "undefined". Falls back
// to ref, then to (x,y) coordinates, then to a "(no target)" placeholder so
// the activity stream label is always meaningful.
function _describeTarget(cmd) {
  if (!cmd) return '(no target)';
  // Prefer human-readable labels over raw CSS selectors for approval card readability
  if (cmd.ariaLabel) return `"${String(cmd.ariaLabel).slice(0, 80)}"`;
  if (cmd.elementText) return `"${String(cmd.elementText).slice(0, 80)}"`;
  if (cmd.label) return `"${String(cmd.label).slice(0, 80)}"`;
  if (cmd.selector) return cmd.selector;
  if (cmd.ref) return `ref:${cmd.ref}`;
  if (typeof cmd.x === 'number' && typeof cmd.y === 'number') return `(${cmd.x},${cmd.y})`;
  return '(no target)';
}
function describeAction(command) {
  switch (command.type) {
    case 'navigate_back':    return 'Navigate back';
    case 'navigate_forward': return 'Navigate forward';
    case 'click':        return `Click: ${_describeTarget(command)}`;
    case 'right_click':  return `Right-click: ${_describeTarget(command)}`;
    case 'double_click': return `Double-click: ${_describeTarget(command)}`;
    case 'drag_and_drop':return `Drag ${_describeTarget({ ref: command.source_ref, selector: command.source_selector, label: command.source_label })} → ${_describeTarget({ ref: command.target_ref, selector: command.target_selector, label: command.target_label })}`;
    case 'click_at':    return `Click at: ${_describeTarget(command)}`;
    case 'type':        return `Type into ${_describeTarget(command)}: '${(command.text || '').toString().slice(0, 80)}'`;
    case 'navigate':    return `Navigate to ${command.url || '(no url)'}`;
    case 'scroll':      return `Scroll ${(command.amount || 0) >= 0 ? 'down' : 'up'}`;
    case 'scroll_to':   return `Scroll to ${_describeTarget(command)}`;
    case 'select':      return `Select "${command.value || ''}" in ${_describeTarget(command)}`;
    case 'hover':       return `Hover: ${_describeTarget(command)}`;
    case 'check':       return `Check: ${_describeTarget(command)}`;
    case 'check_all':   return `Check all matching ${_describeTarget(command)}`;
    case 'press_key':   return `Press: ${command.key || '(no key)'}`;
    case 'execute_js':  return `Run JS: ${(command.code || '').toString().slice(0, 60)}${command.key ? ` → ${command.key}` : ''}`;
    case 'extract':     return `Extract "${command.key || ''}" from ${_describeTarget(command)}`;
    case 'extract_list':return `Extract list "${command.key || ''}" from ${_describeTarget(command)}`;
    case 'open_tab':    return `Open tab: ${command.label || command.url || '(no url)'}`;
    case 'switch_tab':  return `Switch to: ${command.label || command.tab_id || ''}`;
    case 'close_tab':   return `Close tab: ${command.label || command.tab_id || ''}`;
    case 'note':        return `Note: ${(command.text || command.summary || '').toString().slice(0, 80)}`;
    case 'finish':      return `Finish: ${(command.summary || '').toString().slice(0, 80)}`;
    case 'wait_for_text':       return `Wait for text: "${(command.text || '').toString().slice(0, 60)}"`;
    case 'wait_for_element':    return `Wait for element: ${_describeTarget(command)}`;
    case 'wait_for_navigation': return 'Wait for navigation';
    case 'read_page':   return 'Read page';
    case 'dismiss_overlay': return 'Dismiss overlay';
    case 'lookup':            return `DNS lookup: ${command.domain || '(no domain)'} (${command.record_type || 'A'})`;
    case 'run_remote_command': return `Remote cmd (${command.command_type || 'powershell'}): ${(command.command || '').toString().slice(0, 60)}`;
    default: return `${command.type}: ${JSON.stringify(command).slice(0, 100)}`;
  }
}

async function requestApproval(command, stepNumber) {
  const description = describeAction(command);
  // Per-call requestId so concurrent approvals don't cross-contaminate listeners.
  const requestId = crypto.randomUUID();
  // (3.14.0) Pin the service worker alive while we wait for the user. Without
  // this, an AFK user past the ~30s MV3 idle timer kills the SW and the
  // listener gets GC'd — silent timeout, no recovery.
  const kaName = 'approval_' + requestId;
  try { startSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  return new Promise((resolve) => {
    const finish = (payload) => {
      try { stopSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      resolve(payload);
    };
    chrome.runtime.sendMessage({
      action: 'request_approval',
      payload: { action: command.type, description, stepNumber, requestId,
        ariaLabel: command.ariaLabel || null,
        elementText: command.elementText || null,
        selector: command.selector || null },
      requestId
    }).catch((e) => {
      console.error('[finish] Unhandled rejection:', e);
    });
    const listener = (message) => {
      if (message && message.action === 'approval_response' && message.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        finish({
          approved: !!message.approved,
          skipped: !!message.skipped,
          rejected: !!message.rejected
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    // After 60 s with no response: pause the agent and notify the user rather
    // than silently rejecting. The agent stays paused until the user responds
    // (or hits the 5-minute hard wall).
    const timeoutId = setTimeout(async () => {
      // Pause the loop so the step isn't counted as failed while the tech is AFK.
      agentPaused = true;
      sendSilentUpdate('⏸ Approval pending — agent paused. Click Approve/Reject in the chat or the notification to continue.', stepNumber);
      try {
        await notifyIfEnabled(`approval_pending_${requestId}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon-48.png'),
          title: 'Sentinel Override — Approval needed',
          message: `Step ${stepNumber}: ${description.substring(0, 100)}. Open Sentinel to approve or reject.`
        });
      } catch (_e) {
        // Notification create failed non-fatally
      }
      // Hard-reject after 5 minutes total (4 more minutes from here).
      // The listener is still active so a user response still resolves early.
      const hardRejectId = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        chrome.runtime.onMessage.removeListener(hardTimeoutListener);
        agentPaused = false; // unblock loop so it can clean up
        finish({ approved: false, skipped: false, rejected: true, reason: 'approval_hard_timeout' });
      }, 240000);
      // If the user responds before the hard wall, clear the hard-reject timer.
      const origListener = listener;
      chrome.runtime.onMessage.removeListener(origListener);
      const hardTimeoutListener = (message) => {
        if (message && message.action === 'approval_response' && message.requestId === requestId) {
          clearTimeout(hardRejectId);
          agentPaused = false;
          chrome.runtime.onMessage.removeListener(hardTimeoutListener);
          finish({
            approved: !!message.approved,
            skipped: !!message.skipped,
            rejected: !!message.rejected
          });
        }
      };
      chrome.runtime.onMessage.addListener(hardTimeoutListener);
    }, 60000);
  });
}

// ========== Test-Only Exports ==========
// Internal pure helpers exported for unit testing. Not part of the public API.
export {
  detectMfaInText,
  detectSignInWall,
  evaluateHallucinationRisk,
  _isUnproductiveJsResult,
  _shouldAcceptMemoryWrite,
  _checkPreFinishCompleteness,
  _detectActionTypeLoop,
  generateHeuristicPlan,
  formatTicketOutput,
  formatTicketFinalNotes,
  formatTicketKickoff,
  formatWaitingOnClient,
  formatWaitingOnVendor,
  formatItGlueKb,
  formatClientEmail,
  summarizeHistoryBatch,
  maybeRollupHistory,
  detectStall,
  isConfigChangeGoal,
  hasRecentCommitClick,
  hasPostCommitVerification,
  _detectGoalModeDirective,
  _autoPickFormat,
  extractTicketNumber,
  isTicketInvestigationGoal,
  captureReportData,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags,
  _tenantsMatch,
  describeAction,
  _describeTarget,
  // Additional test-only exports for deep coverage
  getTechnicianInfo,
  saveLearnedPattern,
  enforceRateLimit,
  sleep,
  requestApproval,
  _waitForAdaptedGoalDecision,
  _waitForModeMismatchDecision,
  _handleModeMismatchCheck,
  undoStack,
  _runExecuteJsOnce,
  _runExecuteJsWithRetryLadder,
  activityStart,
  activityDone,
  activityFail,
  activityUpdate,
  historyPush,
  trimHistory,
  persistHistory,
  buildCheckpoint,
  writeCheckpoint,
  attachTabToSentinelGroup,
  detachAllSentinelTabs,
  maybePostProgressUpdate,
  _hostnameOf,
  _updateRunLogIndex,
  // Coverage gap exports
  detectCaptcha,
  _generateSmartRecovery,
  _universalCdpFallback,
  recoverFromCaptcha,
  _cdpDismissOverlays,
  _cdpObservePage,
};
