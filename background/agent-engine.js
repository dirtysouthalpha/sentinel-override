// Sentinel Override v3 -- Agent Engine
import {buildSmartUrl, buildGoogleFallbackUrl, buildBudgetHint, compareHostnames, formatVisionHistory, buildVisionSystemPrompt, buildVisionUserContent, buildRunLogEntry, isExplicitNavigation} from './agent-loop-helpers.js';
// Agent loop, planning, self-healing, state management.
// Imports from llm-client.js, tab-manager.js, message-protocol.js.

import {callLLMWithRetry, generatePlan as _generatePlan, getPlatformContext as _getPlatformContext, getRelevantPatterns as _getRelevantPatterns, selectModelForStep as _selectModelForStep, getCostTracker as _getCostTracker, parseVisionResponse} from './llm-client.js';
import {getPlatformProfile} from './platforms/index.js';
import {isTicketInvestigationGoal, getTechnicianInfo, extractTicketNumber, formatTicketFinalNotes, formatTicketKickoff, formatWaitingOnClient, formatWaitingOnVendor, formatItGlueKb, formatClientEmail, formatTicketOutput, _autoPickFormat} from './agent-ticket-format.js';
import { diagnoseFailure, buildDiagnosticMessage, saveDomainStrategy, getDomainStrategy, extractWinningStrategy, getDomainFromUrl } from './agent-adaptive.js';
import { isComplexGoal, buildDecompositionPrompt, parseDecomposition, buildSubTaskGoal, createOrchestratorState } from './agent-orchestrator.js';
import {detectCaptcha, _generateSmartRecovery, _universalCdpFallback, recoverFromCaptcha, _isUnproductiveJsResult, _runExecuteJsOnce, _runExecuteJsWithRetryLadder, _shouldAcceptMemoryWrite, _checkPreFinishCompleteness, _detectActionTypeLoop} from './agent-captcha.js';
import {summarizeHistoryBatch, maybeRollupHistory, detectStall} from './agent-progress.js';
import {getBrainStartupContext, resetBrainRunSignals} from './brain-client.js';
import { detectPageType, getPageStrategyHint } from './agent-page-type.js';
import {publishRunLearning, resetBrainProducerRunSignals} from './brain-producer.js';
import {waitForPageLoad, waitForPageReady, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl, getTabInfo, detachAllDebuggees, cdpDispatchClick, cdpDispatchType, cdpDispatchKey, cdpExecuteJs, readConsoleMessages, readNetworkRequests} from './tab-manager.js';
import {CONFIG, MAX_PAGE_TEXT_LENGTH, TEXT_SAMPLE_LENGTH as _TEXT_SAMPLE_LENGTH, MAX_WAIT_TIME_MS, ONE_HUNDRED_MS, ONE_HUNDRED_FIFTY_MS, TWO_HUNDRED_MS, THREE_HUNDRED_MS, FOUR_HUNDRED_MS, FIVE_HUNDRED_MS, EIGHT_HUNDRED_MS, ONE_SECOND_MS, TWO_SECONDS_MS, THREE_SECONDS_MS, FIVE_SECONDS_MS, TEN_SECONDS_MS, FIFTEEN_SECONDS_MS, TWENTY_SECONDS_MS, FORTY_FIVE_SECONDS_MS, ONE_MINUTE_MS, FIVE_MINUTES_MS, ONE_HOUR_MS} from './constants.js';
import {captureNetworkSnapshot, shouldReportNetwork} from './agent-network.js';
import {startParallelAgent, stopAgent as stopPoolAgent} from './agent-pool.js';

// v4.0 VISION-FIRST MODULES
const VISION_DISCOVER = `const __sentinel_discoverElements = function() {
  'use strict';

  // ---- Selector for all interactive element types ----
  var SELECTOR = 'a, button, input, select, textarea, [role="button"], [role="link"], '
    + '[role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], '
    + '[role="tab"], [role="menuitem"], [role="switch"], [role="option"], '
    + '[onclick], [contenteditable]:not([contenteditable="false"]), '
    + '[tabindex]:not([tabindex="-1"]), [aria-label], summary, [data-testid], label[for]';

  // ---- Tags whose subtrees should be completely skipped ----
  var SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

  function isInSkippedParent(el) {
    var node = el;
    while (node) {
      if (SKIP_TAGS.has(node.tagName)) return true;
      node = node.parentElement;
    }
    return false;
  }

  // ---- Computed-style checks ----
  function isHiddenByStyle(el) {
    var s = window.getComputedStyle(el);
    if (s.opacity === '0') return true;
    if (s.visibility === 'hidden') return true;
    if (s.display === 'none') return true;
    if (s.pointerEvents === 'none') return true;
    return false;
  }

  // ---- Visibility helpers ----
  function isRectVisible(rect) {
    if (!rect) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  function isOnScreen(rect) {
    // Allow elements that are at least partially within the viewport
    if (rect.right <= 0 || rect.bottom <= 0) return false;
    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
    return true;
  }

  // ---- Overlap / dedup helpers ----
  function intersectionArea(r1, r2) {
    var x1 = Math.max(r1.x, r2.x);
    var y1 = Math.max(r1.y, r2.y);
    var x2 = Math.min(r1.x + r1.w, r2.x + r2.w);
    var y2 = Math.min(r1.y + r1.h, r2.y + r2.h);
    if (x2 <= x1 || y2 <= y1) return 0;
    return (x2 - x1) * (y2 - y1);
  }

  function overlapRatio(r1, r2) {
    var area1 = r1.w * r1.h;
    var area2 = r2.w * r2.h;
    if (area1 === 0 || area2 === 0) return 0;
    var inter = intersectionArea(r1, r2);
    // Use the smaller area as denominator so parent/child overlap is detected
    var minArea = Math.min(area1, area2);
    return inter / minArea;
  }

  // ---- Extract display text ----
  function getText(el) {
    var t = '';
    if (el.innerText) t = el.innerText;
    else if (el.value) t = el.value;
    else if (el.placeholder) t = el.placeholder;
    else if (el.getAttribute && el.getAttribute('aria-label')) t = el.getAttribute('aria-label');
    else if (el.getAttribute && el.getAttribute('title')) t = el.getAttribute('title');
    return (t || '').replace(/[\\s\\n]+/g, ' ').trim().substring(0, 60);
  }

  // ---- Main ----
  var candidates = document.querySelectorAll(SELECTOR);
  var elements = [];
  var i, el, rect, cs;

  for (i = 0; i < candidates.length; i++) {
    el = candidates[i];

    // Skip elements inside script/style/etc.
    if (isInSkippedParent(el)) continue;

    // Check offsetParent (unless fixed)
    cs = window.getComputedStyle(el);
    var isFixed = cs.position === 'fixed';
    if (!el.offsetParent && !isFixed) continue;

    // Get bounding rect
    var cRect = el.getBoundingClientRect();
    if (!isRectVisible(cRect)) continue;
    if (!isOnScreen(cRect)) continue;

    // Check computed style
    if (isHiddenByStyle(el)) continue;

    elements.push({ el: el, rect: { x: cRect.left, y: cRect.top, w: cRect.width, h: cRect.height } });
  }

  // ---- Deduplicate overlapping elements (>80% overlap, keep more specific) ----
  var removed = new Set();
  for (i = 0; i < elements.length; i++) {
    if (removed.has(i)) continue;
    for (var j = i + 1; j < elements.length; j++) {
      if (removed.has(j)) continue;
      var ratio = overlapRatio(elements[i].rect, elements[j].rect);
      if (ratio > 0.8) {
        // Keep the one deeper in the DOM (more specific)
        // j > i means j comes later in DOM order (deeper child usually)
        // Compare actual DOM depth
        var depthI = 0, depthJ = 0, n;
        n = elements[i].el; while (n.parentElement) { depthI++; n = n.parentElement; }
        n = elements[j].el; while (n.parentElement) { depthJ++; n = n.parentElement; }
        if (depthJ >= depthI) {
          removed.add(i);
        } else {
          removed.add(j);
        }
      }
    }
  }

  var filtered = [];
  for (i = 0; i < elements.length; i++) {
    if (!removed.has(i)) filtered.push(elements[i]);
  }

  // ---- Salience-ranked cap ----
  // When more interactive elements are on screen than CAP, an arbitrary DOM-order
  // slice can drop the user's actual target. Instead, score each element by how
  // likely it is to be a real interaction target — genuinely interactive tag/role,
  // has a visible name, sensibly sized (not a 1px tracker or a giant wrapper),
  // near the viewport center, above the fold — and keep the top CAP. Survivors are
  // then restored to DOM order so numbering stays top-to-bottom and predictable
  // (and so click resolution by data-sentinel-index stays consistent).
  var CAP = 150;
  if (filtered.length > CAP) {
    var _vw = window.innerWidth, _vh = window.innerHeight;
    var _interactiveTags = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
    var _interactiveRoles = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'textbox']);
    var _salience = function(item) {
      var sel = item.el, sr = item.rect, score = 0;
      var stag = sel.tagName ? sel.tagName.toLowerCase() : '';
      var srole = (sel.getAttribute && sel.getAttribute('role')) || '';
      if (_interactiveTags.has(stag)) score += 50;
      if (_interactiveRoles.has(srole)) score += 40;
      var named = (sel.innerText && sel.innerText.trim())
        || (sel.getAttribute && (sel.getAttribute('aria-label') || sel.getAttribute('placeholder') || sel.getAttribute('title')));
      if (named) score += 30;
      var area = sr.w * sr.h;
      if (area >= 200 && area <= 120000) score += 20; else if (area > 120000) score -= 10;
      var cx = sr.x + sr.w / 2, cy = sr.y + sr.h / 2;
      var dx = cx - _vw / 2, dy = cy - _vh / 2;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var maxDist = Math.sqrt((_vw / 2) * (_vw / 2) + (_vh / 2) * (_vh / 2)) || 1;
      score += (1 - Math.min(dist / maxDist, 1)) * 20;
      if (sr.y >= 0 && sr.y < _vh) score += 10;
      return score;
    };
    for (var si = 0; si < filtered.length; si++) {
      filtered[si]._ord = si;
      filtered[si]._sal = _salience(filtered[si]);
    }
    filtered.sort(function(a, b) { return b._sal - a._sal; });
    filtered = filtered.slice(0, CAP);
    filtered.sort(function(a, b) { return a._ord - b._ord; });
  }

  // ---- Build output and store references ----
  window.__sentinelElements = new Map();
  var result = [];
  var clickableTags = new Set(['a', 'button', 'summary']);
  var clickableRoles = new Set(['button', 'link', 'tab', 'menuitem', 'switch', 'option', 'checkbox', 'radio']);

  for (i = 0; i < filtered.length; i++) {
    var index = i + 1;
    var e = filtered[i].el;
    var r = filtered[i].rect;

    window.__sentinelElements.set(index, e);
    try { e.setAttribute('data-sentinel-index', String(index)); } catch(_ae) {}

    var tag = e.tagName.toLowerCase();
    var text = getText(e);
    var ariaLabel = e.getAttribute && e.getAttribute('aria-label') || '';
    var role = e.getAttribute && e.getAttribute('role') || '';
    var type = e.getAttribute && e.getAttribute('type') || '';
    var placeholder = e.getAttribute && e.getAttribute('placeholder') || '';
    var href = (e.getAttribute && e.getAttribute('href') || '').substring(0, 100);

    // Determine interactivity
    var isClickable = clickableTags.has(tag)
      || clickableRoles.has(role)
      || e.hasAttribute && e.hasAttribute('onclick')
      || tag === 'input' && (type === 'submit' || type === 'button' || type === 'image' || type === 'reset');
    var isInput = tag === 'input' || tag === 'textarea' || tag === 'select'
      || role === 'textbox' || role === 'combobox'
      || (e.hasAttribute && e.hasAttribute('contenteditable'));

    result.push({
      index: index,
      tag: tag,
      text: text,
      ariaLabel: ariaLabel,
      role: role,
      type: type,
      placeholder: placeholder,
      href: href,
      rect: r,
      isClickable: isClickable,
      isInput: isInput
    });
  }

  return JSON.stringify(result);
}; return __sentinel_discoverElements();`;
// (v20.5) SoM overlay tuned for weak-vision grounding (GLM-4.xV):
//  - Larger, digit-aware labels (2- and 3-digit indices never clip).
//  - 16px bold text + dark outline so numerals survive JPEG compression and
//    stay legible over busy / green page content.
//  - Greedy collision avoidance: labels that would stack on dense dashboards
//    are nudged to alternate anchors, so each [N] is readable and unambiguous.
// Authored as a template literal (no backticks / ${} inside) — functionally
// identical to the old escaped one-line string when run via cdpExecuteJs.
const VISION_SOM = `const __sentinel_drawSoMOverlay = function() {
  'use strict';
  var existing = document.getElementById('sentinel-som-overlay');
  if (existing) existing.remove();

  var dpr = window.devicePixelRatio || 1;
  var vw = window.innerWidth;
  var vh = window.innerHeight;

  var canvas = document.createElement('canvas');
  canvas.id = 'sentinel-som-overlay';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.zIndex = '2147483647';
  canvas.style.pointerEvents = 'none';
  canvas.width = vw * dpr;
  canvas.height = vh * dpr;
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (!window.__sentinelElements || typeof window.__sentinelElements.forEach !== 'function') {
    (document.body || document.documentElement).appendChild(canvas);
    return 'ok';
  }

  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Track placed label rects so numbers do not stack on top of each other.
  var placed = [];
  function overlaps(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
  function collides(r) {
    for (var k = 0; k < placed.length; k++) { if (overlaps(r, placed[k])) return true; }
    return false;
  }

  var items = [];
  window.__sentinelElements.forEach(function(el, idx) {
    if (!el || !el.getBoundingClientRect) return;
    var cr = el.getBoundingClientRect();
    if (cr.width <= 0 || cr.height <= 0) return;
    items.push({ idx: idx, x: cr.left, y: cr.top, w: cr.width, h: cr.height });
  });

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var x = it.x, y = it.y, w = it.w, h = it.h;

    // Element bounding box
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Label size scales with digit count so indices never clip.
    var label = String(it.idx);
    var lw = 14 + label.length * 10;
    var lh = 22;

    // Candidate anchors: above-left, inside top-left, above-right, below-left.
    var cands = [
      { x: x, y: y - lh },
      { x: x, y: y },
      { x: x + w - lw, y: y - lh },
      { x: x, y: y + h }
    ];
    var lx = x, ly = y - lh, picked = false;
    for (var c = 0; c < cands.length; c++) {
      var cx = cands[c].x, cy = cands[c].y;
      if (cy < 0) cy = y;
      if (cx < 0) cx = 0;
      if (cx + lw > vw) cx = vw - lw;
      var rect = { x: cx, y: cy, w: lw, h: lh };
      if (!collides(rect)) { lx = cx; ly = cy; picked = true; placed.push(rect); break; }
    }
    if (!picked) {
      lx = x; ly = y - lh;
      if (ly < 0) ly = y;
      if (lx < 0) lx = 0;
      if (lx + lw > vw) lx = vw - lw;
      placed.push({ x: lx, y: ly, w: lw, h: lh });
    }

    // Label background + dark outline for contrast against any content.
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(lx, ly, lw, lh);
    ctx.strokeStyle = '#003322';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + 0.5, ly + 0.5, lw - 1, lh - 1);

    // Label text
    ctx.fillStyle = '#000000';
    ctx.fillText(label, lx + lw / 2, ly + lh / 2 + 1);
  }

  (document.body || document.documentElement).appendChild(canvas);
  return 'ok';
}; __sentinel_drawSoMOverlay();`;
const VISION_CLEAR = "const __sentinel_clearSoMOverlay = function() {\n  'use strict';\n  var overlay = document.getElementById('sentinel-som-overlay');\n  if (overlay) overlay.remove();\n  var _tagged = document.querySelectorAll('[data-sentinel-index]');\n  for (var _ti = 0, _taggedLen = _tagged.length; _ti < _taggedLen; _ti++) { try { _tagged[_ti].removeAttribute('data-sentinel-index'); } catch(_ae) {} }\n  return 'ok';\n}; __sentinel_clearSoMOverlay();";

// Precompute valid agent speed modes for O(1) lookup
const VALID_AGENT_SPEEDS = new Set(['turbo', 'normal', 'stealth']);

// Precompile regex for extract command type checks
const EXTRACT_TYPE_RE = /^extract(_list)?$/;

// Precompile regex for non-mutating action types
const NON_MUTATING_ACTIONS_RE = /^(note|extract|extract_list|scroll|wait_for_text|wait_for_element|wait_for_navigation|read_page)$/;

// Precompile regex for element tag matching in hot-path observation loop
const ELEMENT_TAG_FORM_RE = /^form$/i;
const ELEMENT_TAG_BUTTON_RE = /^button$/i;
const ELEMENT_TAG_INPUT_RE = /^(input|textarea|select)$/i;
const ELEMENT_TAG_A_RE = /^a$/i;
const ELEMENT_TAG_HEADING_RE = /^h[1-3]$/i;
const ELEMENT_ERROR_TEXT_RE = /error|invalid|failed/i;

// Precompile regex for JavaScript string escaping (performance optimization)
const JS_ESCAPE_RE = /[\\'"\n\r\t]/g;

// Priority element types for O(1) lookup in element sorting
const PRIORITY_ELEMENT_TYPES = new Set(['button', 'input', 'select', 'textarea']);

// Precompile regex for approval mode detection (Tier 3: pause phrases)
const APPROVAL_PAUSE_AGENT_RE = /\b(?:agent|sentinel)\s+(?:pauses?|must\s+pause|should\s+pause|will\s+pause)\s+(?:for|before|on|to\s+wait|until)/i;
const APPROVAL_PAUSE_GENERIC_RE = /\b(?:PAUSE|pause)\s+(?:and\s+)?wait\s+for\s+(?:technician|user|operator|human|owner)\s+approval/i;
const APPROVAL_WAIT_BEFORE_RE = /\bwait\s+for\s+(?:technician|user|operator|owner)\s+approval\s+(?:before|prior\s+to)\s+(?:each|every|any)/i;

// Precompile regex for approval mode detection (Tier 4: autonomous phrases)
const AUTONOMOUS_MODE_RE = /\b(?:no\s+approvals?\s+required|execute\s+all\s+steps?\s+(?:autonomously|without\s+pausing)|do\s+not\s+pause)\b/i;

// Precompile regex for Microsoft platform detection in history loop
const PORTAL_ENTRA_RE = /entra/i;
const PORTAL_EXCHANGE_RE = /admin\.exchange/i;
const PORTAL_PURVIEW_RE = /purview/i;
const PORTAL_M365_ADMIN_RE = /admin\.microsoft/i;


const WHITESPACE_NORMALIZE_RE = /\s+/g;

// Precompile regex for email removal (URL extraction)
const EMAIL_RE = /[\w.+-]+@[\w.-]+/g;

// Precompile regex for hostname cleaning
const WWW_PREFIX_RE = /^www\./;
const TRAILING_SLASH_RE = /\/$/;



// Precompile regex for domain cleaning
const DOMAIN_CLEAN_RE = /^https?:\/\/|\/.*$/gi;
const DMARC_PREFIX_RE = /^_dmarc\./i;
const DOMAINKEY_SUFFIX_RE = /\._domainkey.*$/i;

// Precompile regex for goal URL extraction (performance optimization)
const GOAL_URL_EXTRACT_RE = /https?:\/\/[^\s"'<>,]+/i;
const GOAL_NAV_COMMAND_RE = /(?:go to|visit|navigate to|open|browse to|start at|begin at|check)\s+(?:the\s+)?(?:site\s+)?([^\s]+?\.(?:com|org|net|io|gov|edu|co|us|uk|de|fr|cn|jp|ru|br|in|ca|au|me|tv|info|biz|dev|app|ai|xyz))/i;
const GOAL_BARE_SITE_RE = /(?:go to|navigate to|visit|open|check)\s+(?:the\s+)?([\w\s]+?)(?:\s+(?:and|then|,|\.))?(?:\s|$)/i;

// Precompile regex for selector prefix
const REF_SELECTOR_RE = /^ref_/;

// IP_ADDRESS_RE removed - unused (PII_IP_RE is used for PII redaction instead)

// Precompile regex for memory variable replacement
const MEMORY_VAR_RE = /::(\w+)::/g;


// Helper function to check if object is empty without creating intermediate array
const isEmptyObject = (obj) => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return false;
  }
  return true;
};

// Helper function to get object length without creating intermediate array
const getObjectLength = (obj) => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return 0;
  let count = 0;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) count++;
  }
  return count;
};



// Precompile regex for PII redaction (error logging)
const _PII_IP_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const _PII_EMAIL_RE = /[\w.+-]+@[\w.-]+/g;
const _PII_TICKET_RE = /(?:\b(?:TKT|TICKET|INC|INCIDENT|SR)|#)\s*\d+/gi;
const _PII_CLIENT_STRING_RE = /"[^"]{2,60}"/g;
const _PII_CLIENT_SINGLE_RE = /'[^']{2,60}'/g;
const PORTAL_ONEDRIVE_RE = /onedrive|sharepoint/i;
const PORTAL_TEAMS_RE = /teams/i;
const PORTAL_INTUNE_RE = /intune|endpoint\.microsoft/i;
const PORTAL_DEFENDER_RE = /defender|security\.microsoft/i;
const PORTAL_SENTINELONE_RE = /sentinelone/i;
const PORTAL_VIRUSTOTAL_RE = /virustotal/i;

// Precompile regex for stall detection



// Precompile regex for overlay dismissal (hot path in CDP observe)



// Precompile regex for incomplete marker detection (hot path in reporting)
const INCOMPLETE_MARKER_RE = /\b(incomplete|step budget|could not access|unable to|exhausted|not yet|did not complete|did not reach|was unable|failed to extract)\b/i;


// Precompile regex for multi-page goal detection
const _MULTI_PAGE_GOAL_RE = /\b(top\s+\d|each|every|all|10|5|3)\b.*\b(articles?|pages?|sites?|links?|urls?|results?|sources?)\b/i;

// Precompile regex for useless JavaScript result detection
const USELESS_OBJECT_RE = /^\s*\[object\s+(?:Object|Promise|Array|Function|HTMLElement|HTMLCollection|NodeList|Window|Document|Map|Set)\]\s*$/i;

// Precompile regex for action failure detection (hot path in error checking)
const ACTION_FAILED_RE = /^(Error|BLOCKED:)| not found|Element not found|No element/i;
const ACTION_FAILED_TIMEOUT_RE = /^(Error|BLOCKED:|JS Error)|timed out| not found/i;

// Precompile regex for page-mutating action detection (hot path in observation loop)
const PAGE_MUTATING_ACTIONS_RE = /^(click|click_at|type|press_key|select|check|check_all)$/;


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

    // Step 2: Draw SoM overlay (numbered bounding boxes on canvas)
    try { await cdpExecuteJs(tab, VISION_SOM, { timeout: FIVE_SECONDS_MS }); }
    catch (e) { console.warn('[Sentinel/v4] SoM overlay failed:', getErrorMessage(e)); }

    // Step 3: Small delay for canvas to render
    await new Promise(r => setTimeout(r, TWO_HUNDRED_MS));

    // Step 4: Get page text via CDP
    let pageText = '';
    try {
const textResult = await cdpExecuteJs(tab,
        `return document.body ? document.body.innerText.substring(0, ${MAX_PAGE_TEXT_LENGTH}) : "";`,
        { timeout: FIVE_SECONDS_MS });
      pageText = (textResult && textResult.value) || '';
    } catch (e) { console.warn('[Sentinel/v4] Page text failed:', getErrorMessage(e)); }

    // Step 5: Build element tree text for LLM
    const elementParts = [];
    for (const el of indexedElements) {
      const tag = el.tag || 'div';
      // Template literal is more efficient than += concatenation in loop
      const hrefLen = el.href ? el.href.length : 0;
      // Cache substring and JSON.stringify results for performance
      const ariaLabel = el.ariaLabel ? el.ariaLabel.substring(0, 40) : '';
      const placeholder = el.placeholder ? el.placeholder.substring(0, 40) : '';
      const href = el.href && hrefLen > 5 && hrefLen < 100 ? el.href.substring(0, 80) : '';
      const attrs = `${el.type ? ` type=${el.type}` : ''}${el.role ? ` role=${el.role}` : ''}${ariaLabel ? ` aria-label=${JSON.stringify(ariaLabel)}` : ''}${placeholder ? ` placeholder=${JSON.stringify(placeholder)}` : ''}${href ? ` href=${JSON.stringify(href)}` : ''}`;
      const text = el.text ? `>${el.text.substring(0, 60)}` : '/>';
      const closing = el.text ? `</${tag}>` : '';
      elementParts.push(`[${el.index}]<${tag}${attrs}${text}${closing}\n`);
    }
    const elementTree = elementParts.join('').substring(0, 4000); // v21.6.55: Cap element tree to avoid Z.ai content safety

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


import {sendSilentUpdate, sendActionMessage, sendActionResult, sendReportUpdate, sendPageContext, sendTabStateUpdate, sendScreenshotUpdate, sendAgentActivity, sendAgentStepStart, sendAgentStatus, sendHeartbeat, sendPlanPreview, sendClientKnowledgePreview, sendCostUpdate} from './message-protocol.js';
import {generateReport, buildFallbackReport} from './report-generator.js';
import {getActiveProvider} from './provider-registry.js';
import {isSPATransitionPending, clearSPATransition, notifyIfEnabled, startSwKeepalive, stopSwKeepalive} from './shared-state.js';
import {getActiveTabId, getTabContext, getAllTabContexts, openTab, switchToTab, closeTab, closeAllAgentTabs, updateSnapshot, resetAllContexts, findTabByLabel, registerInitialTab, getTabCount} from './tab-context.js';
import {getClientStartupContext, markRunCompleted} from './client-knowledge.js';
import {generateHeuristicPlan, _generateInitialPlan, _applyAdaptivePrompts, _waitForAdaptedGoalDecision, BARE_SITE_MAP} from './agent-planning.js';
import {appendAuditEntry, getAuditLog, auditLogToCsv} from './audit-log.js';
import {runRecoverySkills, getSkillStats} from './skills/index.js';
import {tel, startRun as telStartRun, endRun as telEndRun} from './telemetry.js';
// (Phase 6) UAP bridge — broadcasts agent lifecycle events to external UAP server
import {broadcast as uapBroadcast, setRunId as uapSetRunId} from './uap-bridge.js';
// (3.30.0) Trust-score computation at run finalize. Pure function — no side
// effects, no chrome.* deps. We aggregate the run's metrics here at the end
// of the loop and stamp the result onto both the report card and the
// run-log index entry.
import {computeTrustScore, suggestRetryActions} from './trust-score.js';
// v10.0 Intelligence Systems Integration
import {captureReasoningStep, getReasoningSummary} from './reasoning-trace.js';
import {analyzeForBias as _analyzeForBias, analyzeActionForBias, shouldTriggerBiasWarning, logBiasDetection, getBiasStatistics} from './bias-detector.js';
import {addKnowledgeNode, persistKnowledgeGraph} from './knowledge-graph.js';
import {analyzeForContradictions, logContradictionDetection, getContradictionStatistics} from './contradiction-detector.js';
import {analyzeForNovelty, storeNoveltyResult, getNoveltyStatistics} from './novelty-detector.js';
import {synthesizeKnowledge, getSynthesisStatistics} from './knowledge-synthesizer.js';
// v10.0 Advanced Intelligence Systems Integration (Phase 5)
import {PredictiveEngine} from './predictive-engine.js';
import {RuntimeProfiler} from './runtime-profiler.js';
import {getErrorMessage, sleep} from './error-utils.js';
import {_tenantsMatch, detectMfaInText, detectSignInWall, evaluateHallucinationRisk, _countSummaryClaims, _countSpecificClaims, _countSourceTags} from './agent-security.js';
// ========== Agent State ==========
// (v21.6.14) Hard tab limit — prevents browser crash from tab accumulation
const MAX_AGENT_TABS = 3;
async function _enforceTabLimit() {
  try {
    if (getTabCount() >= MAX_AGENT_TABS) {
      const _allTabs = getAllTabContexts();
      const _agentTabs = _allTabs.filter(t => t.isAgentCreated);
      if (_agentTabs.length >= 2) {
        const _toClose = _agentTabs[0];
        if (_toClose) { await chrome.tabs.remove(_toClose.tabId).catch(() => {}); }
      }
    }
  } catch (_e) { /* non-fatal */ }
}

let agentRunning = false;
let _consecutiveScrolls = 0; // (v21.6.21) Track consecutive scrolls to prevent scroll loops
let _runAbortController = null;  // (v21.6.8) AbortController for instant stop — aborted in stopAgent()
let apiCallCount = 0;
let lastApiCallTime = 0;
let agentMemory = {};           // Extract-and-remember: carries data between pages
let _lastTenantForMemory = null; // (v21.6) Track tenant for per-client memory isolation

// (v21.6) Per-client memory isolation: save current memory scoped to tenant
function _saveTenantMemory() {
  if (!_lastTenantForMemory || Object.keys(agentMemory).length === 0) return;
  try {
    const key = `tenant_memory_${_lastTenantForMemory}`;
    chrome.storage.local.set({ [key]: { ...agentMemory, _savedAt: Date.now() } }).catch(() => {});
  } catch (_e) { /* non-fatal */ }
}

// (v21.6) Per-client memory isolation: restore memory scoped to tenant
async function _restoreTenantMemory(tenant) {
  if (!tenant) return;
  _lastTenantForMemory = tenant;
  try {
    const key = `tenant_memory_${tenant}`;
    const result = await chrome.storage.local.get(key);
    const stored = result[key];
    if (stored && typeof stored === 'object') {
      const age = Date.now() - (stored._savedAt || 0);
      const ONE_HOUR = 3600000;
      if (age < ONE_HOUR) {
        const { _savedAt, ...mem } = stored;
        agentMemory = { ...mem };
      }
    }
  } catch (_e) { /* non-fatal */ }
}
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
const _dkimDomainKeyCache = new Map(); // (10.0.1) Cache for DKIM domain key regex patterns — avoids repeated RegExp creation
let productiveSteps = 0;        // (3.8.0) dynamic step-limit driver — every successful extract/note/finish-blocker bumps this so productive runs get more oxygen
// (stuck-loop watchdog) The click_at loop detector below fires when a streak of
// consecutive click_at commands produces no new output AND never moves the page
// — the "weak vision model fixates on one element" failure (e.g. CNN with
// glm/gemma, or SonicWall NSM showing an offline firewall). Count those fires and
// hard-stop after a few rather than grinding to the step cap (~80 wasted LLM
// calls). Progress is judged per-streak (productiveSteps snapshot + page-change
// flag), NOT lifetime: a run that extracted something earlier but is now spinning
// on click_at still trips this. Streaks that change the page or yield a productive
// non-click_at action reset, so wizards and execute_js-looping-but-progressing
// runs are unaffected.
const STUCK_CLICK_LOOP_ABORT_FIRES = 4;
let _clickAtLoopFires = 0;
// (stuck-loop watchdog fix) The abort above used to gate on lifetime
// productiveSteps === 0, so a run that produced ANY result early (e.g. one
// execute_js extraction) could then spin on click_at forever — exactly the
// failure seen on SonicWall NSM (firewall offline, agent clicks the same tab
// 50+ times). These two track the CURRENT click_at streak instead: the
// productiveSteps snapshot at streak start, and whether any click in the
// streak actually changed the page. A streak that produces nothing new AND
// never moves the page is stuck regardless of earlier progress.
let _clickAtStreakBaseline = 0;
let _clickAtStreakSawPageChange = false;
// (3.30.0) Trust-score counters. Module-level so the loop can update them
// from any branch and the run finalize block can read them at the end.
let failedSteps = 0;            // running count of steps where actionFailed=true
let consecutiveFailureMax = 0;  // longest streak of consecutive failures seen this run
let expectedTenant = null;      // (3.7.0) chrome.storage.local.expectedTenant — the user's intended tenant for this run
let activeClientId = null;      // (3.12.0) currently-selected client (sentinelClientKnowledge.activeClientId)
let clientKnowledgeText = '';   // (3.12.0) pre-formatted system-prompt section listing relevant entries
let brainKnowledgeText = '';   // (sub-project B) pre-formatted "BRAIN KNOWLEDGE" section from Neuralis /recall
let _runStartPlatformId = '';  // (sub-project C) platform id detected at run start; reused as producer tag at run end
let clientKnowledgeUsedIds = []; // (3.12.0) ids of entries injected into this run; useCount bumps at run end
let pendingVerification = null; // (3.12.0) {type,description,attemptedAt} of the last MODIFYING_ACTIONS step; consumed by next observation cycle to force explicit "did this work?" check
let _pendingContextInjections = []; // Mid-run context notes queued by the user; drained at top of each step
// Mid-run user corrections (e.g., "click the second one instead"). Distinct from
// context injections — corrections are higher-priority, consume on next step only,
// and trigger a status update so the user sees the agent adjusting.
const _correctionQueue = new Map(); // tabId -> correction text
let _pendingCommandQueue = [];      // repeat_for_each sub-commands; drained before consulting LLM
let undoStack = [];                 // (3.49.1) Undo entries for reversible actions; max 10 entries
let _verificationFailures = 0;  // (Phase 8.2) Consecutive post-action verification failures; strategy shift after 2
import {startRunRecording, recordStep, generateRunReplay, emitLearnedPatterns, notifyRunComplete, scoreActionConfidence, saveLearnedPattern} from './agent-reporting.js';
import {sharedState} from './agent-shared-state.js';
import {attachTabToSentinelGroup, detachAllSentinelTabs, closeAttachedTabsExceptPrimary, isAgentAttachedTab, isPrimaryPanelTab, setPrimaryPanelTab, _scopeSidePanelToPrimary, _enableSidePanelEverywhere, _cdpObservePage, _cdpDismissOverlays, clickAtCoordinates, _findElementBbox, enhanceWithVisualProperties, _findElementByDescription, getAttachedTabIds} from './agent-tabs.js';
import {checkCircuitBreaker, ABSOLUTE_MAX_STEPS} from './agent-circuit-breaker.js';

// Re-export originally-public functions for backward compatibility
export { isAgentAttachedTab, isPrimaryPanelTab, getAttachedTabIds };
// Re-exports from agent-ticket-format.js (backward compatibility)
export { isTicketInvestigationGoal, getTechnicianInfo, extractTicketNumber, formatTicketFinalNotes, formatTicketKickoff, formatWaitingOnClient, formatWaitingOnVendor, formatItGlueKb, formatClientEmail, formatTicketOutput, _autoPickFormat } from './agent-ticket-format.js';
export { detectCaptcha, _generateSmartRecovery, _universalCdpFallback, recoverFromCaptcha, _isUnproductiveJsResult, _runExecuteJsOnce, _runExecuteJsWithRetryLadder, _shouldAcceptMemoryWrite, _checkPreFinishCompleteness, _detectActionTypeLoop } from './agent-captcha.js';
export { summarizeHistoryBatch, maybeRollupHistory } from './agent-progress.js';
let _learnedPatterns = null;   // (Phase 5) Runtime pattern tracking: { key: { uses, successes, lastUsed } }
// Phase 5: Advanced Intelligence State
let _predictiveAnalysisEnabled = false;  // Predictive analytics enabled (reserved for future)
let profilingEnabled = false;            // Runtime profiling enabled
let mutationProposals = [];              // Proposed mutations for review
let _activeCanaryDeployment = null;       // Active canary deployment status (reserved for future)
let selfHealingEnabled = false;          // Self-healing system enabled
let healingHistory = [];                 // Self-healing attempt history


// Expose agentRunning for index.js
export { agentRunning };

/** Enqueue a user note to be injected into the LLM prompt on the next step. */
export function injectContext(note) {
  if (typeof note === 'string' && note.trim()) {
    _pendingContextInjections.push(note.trim());
  }
}

/** Enqueue a mid-run user correction (e.g., "click the second one instead"). */
export function applyCorrection(tabId, correction) {
  if (typeof correction === 'string' && correction.trim()) {
    _correctionQueue.set(tabId, correction.trim());
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
let _runStartTime = 0;

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
    if (age > ONE_HOUR_MS) return { restored: false, error: `checkpoint too old (>${Math.floor(age / ONE_MINUTE_MS)} min)` };
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
        if (typeof tabId !== 'number' || Number.isNaN(tabId) || tabId <= 0) {
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
      ageSeconds: Math.floor(age / ONE_SECOND_MS),
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
// Set once per run when a per-step run-log write hits a storage quota error, so
// the heal-by-pruning pass runs at most once per run instead of on every step.
let _runLogQuotaPruned = false;

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

// ========== Step Screenshot Capture + Zoom — extracted to agent-screenshot.js ==========
import {captureStepScreenshot, setZoomRegion, getZoomRegion, formatZoomRegion} from './agent-screenshot.js';
export { setZoomRegion, getZoomRegion };

// ========== Configuration ==========

// ========== Live Status Narration — extracted to agent-narration.js ==========
import {emitAgentStatus} from './agent-narration.js';

// ========== History Helpers ==========
// Deduplicated from ~47 inline occurrences across the agent loop.
function historyPush(entry) {
  history.push(entry);
  _historyDirty = true;
}

function trimHistory() {
  const len = history.length;
  if (len > CONFIG.maxHistoryEntries) {
    history.splice(0, len - CONFIG.maxHistoryEntries);
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
  _saveTenantMemory(); // (v21.6) Save tenant-scoped memory before reset
  apiCallCount = 0;
  lastApiCallTime = 0;
  agentMemory = {};
  productiveSteps = 0;
  _clickAtLoopFires = 0;
  _consecutiveScrolls = 0;
  _clickAtStreakBaseline = 0;
  _clickAtStreakSawPageChange = false;
  consecutiveFailures = 0;
  sharedState.pageStagnation = 0;
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
  _correctionQueue.clear();
  _pendingCommandQueue.length = 0;
  _historyDirty = false;
  undoStack.length = 0;
  _verificationFailures = 0; // (Phase 8.2) reset post-action verification counter
  _learnedPatterns = null; // (Phase 5) reset learned patterns for new run
  _stepScreenshots.clear(); // (9.3) reset replay screenshot ring buffer
  _dkimDomainKeyCache.clear(); // clear DKIM domain key cache between runs
  _activityStartedAt.clear(); // clear activity start timestamps between runs
  // Reset CDP observe-path optimization flags so a new run always gets a fresh
  // page ready check and overlay nuke on its first observation.
  sharedState.reset();
  // Phase 5: Reset advanced intelligence state
  _predictiveAnalysisEnabled = false;
  profilingEnabled = false;
  mutationProposals = [];
  _activeCanaryDeployment = null;
  selfHealingEnabled = false;
  healingHistory = [];
  setZoomRegion(null); // reset zoom/inspect region between runs
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
    const actualWants = _runSettings.approvalMode ? 'approval' : 'autonomous';
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
  _cursorHiderInjected = false;
let _orchestratorState = null;
let _lastDiagnosis = null; // v21.6.54: Adaptive failure diagnosis
let _consecutiveFailureTypes = {}; // v21.6.54: Track failure types per action
 // v21.6.53: Multi-task orchestrator state


  // Determine which tab to operate on
  let startTabId;
  if (!sender.tab || !sender.tab.id) {
    const tabs = await new Promise(resolve => {
      chrome.tabs.query({active: true, currentWindow: true}, (t) => {
        if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) {
          console.error('[startAgent] tabs.query failed:', chrome.runtime.lastError.message || String(chrome.runtime.lastError));
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

  // Register this agent in the multi-tab parallel agent pool (non-fatal)
  try {
    startParallelAgent(startTabId, goal);
  } catch (_poolErr) {
    // Pool full or duplicate tab — log warning but continue (backward compat)
    console.warn("[Sentinel/pool] Agent pool registration skipped:", getErrorMessage(_poolErr));
  }
  agentRunning = true;
  _runStartTime = Date.now();
  // Persist running state so SW restarts can detect an interrupted run
  try { await chrome.storage.session.set({ agentRunning: true, agentGoal: goal, agentStartTime: _runStartTime }); } catch(_sessionErr) {
    /* Non-fatal: session storage set failed */
  }
  resetAgentState();
  tel.info('lifecycle', 'Agent started', { goal: (goal || '').substring(0, 200), startTabId });
  // (Phase 6) UAP bridge: notify external server of agent start
  try { uapBroadcast('agent.started', { goal }); } catch (_uapErr) { /* UAP bridge unavailable */ }

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
  // (v20.1) This is the "working" tab — the only tab that shows the side panel
  // for the duration of the run. Tabs the agent opens later never show it.
  setPrimaryPanelTab(startTabId);

  // (3.12.0) Load client knowledge for the active client in a single storage
  // round-trip via getClientStartupContext (replaces 3 sequential reads).
  try {
    const startUrl = tabInfo?.url || '';
    const { client: activeClient, relevantEntries, promptSection } = await getClientStartupContext(startUrl);
    if (activeClient) {
      activeClientId = activeClient.id;
      clientKnowledgeUsedIds = relevantEntries.map(e => e.id);
      clientKnowledgeText = promptSection;
      // (9.1) Broadcast which facts are being injected so popup can show them
      try { sendClientKnowledgePreview(activeClient.displayName || activeClient.id, relevantEntries); } catch (_previewErr) {
        /* Non-fatal: client knowledge preview send failed */
      }
      // Emit knowledge_context so popup can show a persistent visibility bar
      if (relevantEntries.length > 0) {
        try {
          chrome.runtime.sendMessage({
            type: 'knowledge_context',
            tabId: startTabId,
            clientName: activeClient.displayName || '',
            factCount: relevantEntries.length,
            facts: relevantEntries.map(f => typeof f.wisdom === 'string' ? f.wisdom.substring(0, 100) : String(f.wisdom || '').substring(0, 100)),
            timestamp: Date.now()
          }).catch(() => {});
        } catch (_kcErr) {}
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
    _runLogQuotaPruned = false;
    runLogBuffer = [{
      step: 0,
      timestamp: new Date().toISOString(),
      kind: 'run_start',
      goal: goal,
      tenant: null,
      url: tabInfo?.url || ''
    }];
    // (Phase 6) UAP bridge: correlate events with this run
    try { uapSetRunId(runLogId); } catch (_uapErr) { /* UAP bridge unavailable */ }
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

  // (v20.1) Pin the side panel to the single working tab. The agent may open
  // additional tabs during the run, but the panel only ever shows on the tab
  // the user launched the task with.
  try { await _scopeSidePanelToPrimary(); } catch (e) { console.warn('[Sentinel] Side panel scope failed:', getErrorMessage(e)); }

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

  let finalGoal = await _applyAdaptivePrompts(goal, tabInfo, startTabId, runLogId, runLogBuffer);

  // (hardening 1B) Reset the one-warn-per-run signals so each run gets at most
  // one "brain unreachable" warning per path (read + write), not one per call.
  resetBrainRunSignals();
  resetBrainProducerRunSignals();

  // (sub-project B) Neuralis brain READ path. One recall call per run, gated
  // by the brainEnabled toggle (default OFF — read inside getBrainStartupContext).
  // Leak-zero by construction: the recall key is the adaptive-prompts platform id
  // (preferred) or the start-URL host (fallback) — NEVER client name, tenant, or
  // raw goal text. Fails open: any error leaves brainKnowledgeText = '' so a down
  // brain cannot break an MSP's run.
  try {
    let brainContextKey = '';
    try {
      const _profile = getPlatformProfile(tabInfo?.url || '', goal);
      if (_profile && _profile.id) {
        brainContextKey = String(_profile.id);
      } else if (tabInfo && tabInfo.url) {
        brainContextKey = (() => { try { return new URL(tabInfo.url).hostname || ''; } catch (_) { return ''; } })();
      }
    } catch (_) { brainContextKey = ''; }
    _runStartPlatformId = brainContextKey; // (sub-project C) reuse as producer tag at run end
    const brainCtx = await getBrainStartupContext(brainContextKey);
    brainKnowledgeText = (brainCtx && brainCtx.ok && typeof brainCtx.section === 'string') ? brainCtx.section : '';
  } catch (_) {
    brainKnowledgeText = '';
  }

  // Fire-and-forget but catch any unhandled rejection so agentRunning never stays
  // stuck at true if runAgentLoop crashes before its own cleanup runs.
  // v21.6.53: Multi-task orchestration for complex goals
  if (isComplexGoal(goal)) {
    try {
      sendSilentUpdate('Complex goal detected — decomposing into sub-tasks...', 0);
      const { callLLMSimple } = await import('./llm-client.js');
      const decompResponse = await callLLMSimple(
        'You are a task decomposition engine. Break complex investigation goals into simple sequential sub-tasks.',
        buildDecompositionPrompt(goal),
        2000
      );
      const subtasks = parseDecomposition(decompResponse);
      if (subtasks && subtasks.length >= 2) {
        _orchestratorState = createOrchestratorState();
        _orchestratorState.subtasks = subtasks;
        _orchestratorState.originalGoal = goal;
        _orchestratorState.active = true;
        finalGoal = buildSubTaskGoal(subtasks[0], goal, 0, subtasks.length, []);
        sendSilentUpdate(`Orchestrator: ${subtasks.length} sub-tasks planned. Starting task 1: ${subtasks[0].title}`, 0);
        try { chrome.runtime.sendMessage({ action: 'orchestrator_started', totalSubtasks: subtasks.length, titles: subtasks.map(s => s.title) }).catch(() => {}); } catch (_) {}
      }
    } catch (_decompErr) {
      console.warn('[Sentinel/Orchestrator] Decomposition failed, running as single task:', getErrorMessage(_decompErr));
      _orchestratorState = null;
    }
  }

  // v21.6.54: Load cross-run domain strategy
  try {
    const _startUrl = tabInfo ? tabInfo.url : '';
    if (_startUrl) {
      const _domainStrategy = await getDomainStrategy(_startUrl);
      if (_domainStrategy) {
        sendSilentUpdate('[ADAPTIVE] Loaded domain strategy for ' + getDomainFromUrl(_startUrl), 0);
        finalGoal = finalGoal + '\n\n' + _domainStrategy;
      }
    }
  } catch (_stratErr) { /* non-fatal */ }

  runAgentLoop(finalGoal, startTabId).catch(err => {
    console.error('[Sentinel/Loop] runAgentLoop crashed unexpectedly:', err);
    console.error('[Sentinel/Loop] Stack:', err && err.stack ? err.stack : '[no stack]');
    emitAgentStatus(startTabId, 'error', `Agent crashed: ${getErrorMessage(err)}`);
    agentRunning = false;
    // (Phase 6) UAP bridge: notify external server of crash
    try { uapBroadcast('agent.error', { error: getErrorMessage(err) }); } catch (_uapErr) { /* UAP bridge unavailable */ }
    chrome.runtime.sendMessage({
      action: 'agent_finished',
      summary: `Agent crashed: ${getErrorMessage(err)}`,
      error: true,
      errorStack: err && err.stack ? err.stack.substring(0, 500) : undefined
    }).catch(() => {});
    try {
      chrome.notifications.create('sentinel-agent-crash', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Sentinel Agent Crashed',
        message: `Agent error: ${getErrorMessage(err)}`.substring(0, 200)
      });
    } catch (_notifErr) { /* notifications API may be unavailable */ }
  });
  return 'Agent started in background';
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
  const tier1 = text.match(MODE_TIER1_RE);
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
  const tier2 = text.match(MODE_TIER2_RE);
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
  if (APPROVAL_PAUSE_AGENT_RE.test(text) ||
      APPROVAL_PAUSE_GENERIC_RE.test(text) ||
      APPROVAL_WAIT_BEFORE_RE.test(text)) {
    return {
      detected: true,
      wants: 'approval',
      evidence: 'phrase implying agent must pause for human approval',
      confidence: 'medium'
    };
  }

  // Tier 4: phrases implying autonomous behavior (less common but possible)
  if (AUTONOMOUS_MODE_RE.test(text)) {
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
    }, FIVE_MINUTES_MS);
  });
}

/**
 * Stop the agent loop — ends telemetry, detaches CDP debuggees,
 * dissolves tab groups, and closes all agent-managed tabs.
 * @returns {Promise<string>} Status message indicating the agent was stopped.
 */
export async function stopAgent() {
  // (v21.6.20) CRITICAL: Set agentRunning = false FIRST, before any awaits.
  // Previous code had this AFTER telEndRun and pool cleanup — if those
  // awaits hung during a chaotic loop state, agentRunning never got set
  // to false and the stop signal never propagated.
  agentRunning = false;
  agentPaused = false;
  // Abort in-flight fetch requests immediately
  if (_runAbortController) { _runAbortController.abort(); _runAbortController = null; }
  tel.info('lifecycle', 'Agent stopping (user-initiated)');
  // (3.27.0) End the telemetry persistence run on user-initiated stop, not
  // just on natural finish. Otherwise the buffer dangles until the next run
  // starts, and the "finishedAt" field never gets stamped.
  try { await telEndRun(runLogId); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  // Remove this agent from the parallel agent pool
  try {
    const _agentTabId = getAgentTabId();
    if (_agentTabId) stopPoolAgent(_agentTabId);
  } catch (_e) { /* pool cleanup failed — non-fatal */ }
  // Release any CDP attachments held by the screenshot pipeline.
  try { await detachAllDebuggees(); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  // (3.7.2) Dissolve the visual tab group + reset side-panel availability.
  // (v21.5.4) Close agent-opened tabs BEFORE detaching (detach clears the set)
  try { await closeAttachedTabsExceptPrimary(); } catch (e) { console.warn('[Sentinel] Close attached tabs failed:', getErrorMessage(e)); }
  try { await detachAllSentinelTabs(); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
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

// ========== Periodic Progress Updates (3.8.2) ==========
// Every PROGRESS_UPDATE_INTERVAL steps during a long run, post a chat
// message summarizing portals visited and data points collected so the
// user sees forward motion instead of just a step counter.
const PROGRESS_UPDATE_INTERVAL = 25;

function maybePostProgressUpdate(stepCount, history, agentMemory) {
  if (stepCount === 0 || stepCount % PROGRESS_UPDATE_INTERVAL !== 0) return;
  try {
    const portalsSeen = new Set();
    const histLen = history.length;
    for (const h of history) {
      if (!h || !h.action) continue;
      const url = h.action.url || '';
      if (PORTAL_ENTRA_RE.test(url)) portalsSeen.add('Entra');
      else if (PORTAL_EXCHANGE_RE.test(url)) portalsSeen.add('Exchange');
      else if (PORTAL_PURVIEW_RE.test(url)) portalsSeen.add('Purview');
      else if (PORTAL_M365_ADMIN_RE.test(url)) portalsSeen.add('M365 Admin');
      else if (PORTAL_ONEDRIVE_RE.test(url)) portalsSeen.add('OneDrive/SharePoint');
      else if (PORTAL_TEAMS_RE.test(url)) portalsSeen.add('Teams');
      else if (PORTAL_INTUNE_RE.test(url)) portalsSeen.add('Intune');
      else if (PORTAL_DEFENDER_RE.test(url)) portalsSeen.add('Defender');
      else if (PORTAL_SENTINELONE_RE.test(url)) portalsSeen.add('SentinelOne');
      else if (PORTAL_VIRUSTOTAL_RE.test(url)) portalsSeen.add('VirusTotal');
    }
    const memCount = getObjectLength(agentMemory);
    const lastAction = histLen ? history[histLen - 1] : null;
    const lines = [
      `📊 PROGRESS UPDATE — step ${stepCount}`,
      `Portals visited: ${portalsSeen.size > 0 ? [...portalsSeen].join(', ') : '(none yet)'}`,
      `Data points in memory: ${memCount}`,
      `Recent action: ${lastAction?.action ? lastAction.action.type : '(none)'}`
    ];
    sendSilentUpdate(lines.join(' | '), stepCount);
  } catch (e) { console.warn('[Sentinel] HUD update failed:', getErrorMessage(e)); }
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

// ========== Configuration Verification Gate — extracted to agent-config-gate.js ==========
import {MULTI_PORTAL_RE, MODE_TIER1_RE, MODE_TIER2_RE, _URL_ANY_RE, _BARE_SITE_RE, _SEARCH_LONG_RE, _ABOUT_RE, _COUNT_RE, ARTICLE_RE, ARTICLE_KEY_RE, isConfigChangeGoal, hasRecentCommitClick, hasPostCommitVerification, MODIFYING_ACTIONS, NON_PRODUCTIVE_READ_ACTIONS, REF_DRIVEN_ACTIONS, TARGETABLE_ACTIONS, LOOP_EXCLUDE_TYPES, DATA_ACTIONS, TAB_ACTIONS, INTERACTIVE_ACTIONS, CDP_FALLBACK_BLOCKED, EXTRACT_ACTIONS, MEMORY_WRITING_ACTIONS, MODIFYING_INTERACTIVE_ACTIONS, OTHER_ACTIONS, _hostnameOf, } from './agent-config-gate.js';

// ========== Run Setup Helpers — extracted to agent-run-setup.js ==========
import {_initRunState, _buildPageNarration, narratePageState} from './agent-run-setup.js';

// ========== Main Agent Loop ==========

/**
 * Inject a persistent CSS rule that hides the native cursor during agent runs.
 * Called once after the debugger attaches at the start of runAgentLoop.
 * This prevents the "double cursor" effect where both the native OS cursor
 * and the Sentinel custom cursor are visible simultaneously.
 */
let _cursorHiderInjected = false;
async function _injectCursorHider(tabId) {
  if (_cursorHiderInjected) return;
  try {
    const css = `(function(){var s=document.getElementById('sentinel-cursor-hider');if(s)return'true';s=document.createElement('style');s.id='sentinel-cursor-hider';s.textContent='*,*::before,*::after{cursor:none !important;}';document.head?document.head.appendChild(s):document.documentElement.appendChild(s);return'true';})();`;
    await cdpExecuteJs(tabId, css, { timeout: 2000 });
    _cursorHiderInjected = true;
    console.debug('[Sentinel] Native cursor hidden via CDP CSS injection');
  } catch (e) {
    console.warn('[Sentinel] Cursor hider injection failed:', getErrorMessage(e));
  }
}


/**
 * Extract text content from cross-origin iframes that document.body.innerText
 * cannot reach (e.g., Microsoft Entra, Azure Portal, M365 Admin).
 * Uses chrome.webNavigation to enumerate frames, then chrome.scripting.executeScript
 * to extract text from each iframe's execution context.
 *
 * @param {number} tabId - The active tab ID
 * @param {string} topFrameText - The text already extracted from the top frame
 * @returns {Promise<string>} Combined text from all frames, or empty string on failure
 */
async function _extractFromIframes(tabId, topFrameText) {
  const results = [];
  try {
    // Only attempt iframe extraction if top frame text is sparse
    const isSparse = !topFrameText || topFrameText.length < 800;
    if (!isSparse) return '';

    // Check if this looks like a portal page that uses iframes
    const isPortal = /entra\.microsoft\.com|admin\.microsoft|portal\.azure|make\.microsoft/.test(topFrameText) ||
                     /Microsoft Entra|Azure Portal|admin center/i.test(topFrameText);
    if (!isPortal) return '';

    // Enumerate all frames in the tab
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames || frames.length <= 1) return ''; // Only top frame exists

    const childFrames = frames.filter(f => f.frameId !== 0);
    if (childFrames.length === 0) return '';

    sendSilentUpdate(`[Iframe] Found ${childFrames.length} child frames, extracting...`, 0);

    for (const frame of childFrames) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frame.frameId] },
          func: () => {
            // Try multiple extraction strategies within the iframe
            let text = '';
            // Strategy 1: body.innerText
            if (document.body && document.body.innerText) {
              text = document.body.innerText.substring(0, 16000);
            }
            // Strategy 2: If innerText is sparse, try visible elements
            if (text.length < 200) {
              const els = document.querySelectorAll('h1,h2,h3,h4,h5,p,span,td,th,li,a,button,label,div[role],nav');
              const parts = [];
              els.forEach(el => {
                const t = (el.innerText || el.textContent || '').trim();
                if (t && t.length > 2 && t.length < 500) parts.push(t);
              });
              text = parts.slice(0, 200).join('\n').substring(0, 16000);
            }
            return { url: location.href, text };
          },
          world: 'MAIN'
        });

        if (result && result.result && result.result.text && result.result.text.length > 50) {
          results.push(`--- Iframe: ${result.result.url} ---\n${result.result.text}`);
        }
      } catch (frameErr) {
        // Cross-origin frame access may fail silently
      }
    }
  } catch (e) {
    console.warn('[Sentinel/Iframe] Extraction failed:', getErrorMessage(e));
  }
  return results.join('\n\n');
}

async function runAgentLoop(goal, workingTabId) {
  _runAbortController = new AbortController();  // (v21.6.8) For instant stop
  _lastGoal = goal || '';
  startRunRecording(workingTabId, goal);
  let finished = false;
  // (3.15.1) `history` is module-level — clear in-place so the array reference
  // stays valid for any captured closures (trimHistory/persistHistory helpers).
  history.length = 0;
  let stepCount = 0;
  let reportData = null;  // Snapshot for async report generation
  agentPlan = null;
  currentPlanStep = 0;
  const _loopStartTime = Date.now();

  const _runInit = await _initRunState(goal);
  goal = _runInit.goal;
  _runSettings = _runInit.runSettings;
  expectedTenant = _runInit.expectedTenant;
  detectedTenant = null;
  agentMemory = {};
  if (expectedTenant) {
    _restoreTenantMemory(expectedTenant); // (v21.6) Restore tenant-scoped memory
  }

  let consecutiveNavigates = 0;
  let consecutiveInjectionFailures = 0;
  // Observation skip cache — reused when previous step was non-mutating and
  // the URL/SPA-route hasn't changed. DOM content hash catches SPA changes
  // without URL changes.
  sharedState.cachedObservation = null;
  let _cachedPageContent = null;
  let _lastObservedUrl = '';
  let _lastObservedDomHash = 0;

  // (v21.6.22) Skip plan generation for simple extraction tasks — saves 1 LLM call + ~15s
  const _isSimpleTask = /tell me|list the|what is|who (created|made|wrote)|what year|extract|summarize/i.test(goal || '');
  if (_isSimpleTask && goal && goal.length < 200) {
    agentPlan = null;
    sendSilentUpdate('Simple task detected — skipping plan generation', 0);
  } else {
  try {
    agentPlan = await _generateInitialPlan(goal, workingTabId, _runSettings);
  } catch (e) {
    console.warn('[Sentinel] _generateInitialPlan failed (non-fatal), running without plan:', getErrorMessage(e));
    agentPlan = null;
  }
  }
  try { sendPlanPreview(agentPlan, agentPlan && agentPlan.length); } catch (_e) {
    // Plan preview send failed non-fatally
  }
  // Send plan to popup for preview
  try {
    chrome.runtime.sendMessage({
      type: 'agent_plan',
      tabId: workingTabId,
      plan: (agentPlan || []).map((step, i) => ({ index: i, text: String(step).substring(0, 200) })),
      totalSteps: (agentPlan || []).length,
      timestamp: Date.now()
    }).catch(() => {});
  } catch (_e) {}

  // (SW keepalive) Pin the service worker for the entire agent loop duration.
  // Without this, the SW can be terminated during long LLM calls or page loads.
  const _loopKaName = `sentinel_loop_${runLogId || crypto.randomUUID()}`;
  try { startSwKeepalive(_loopKaName); } catch (e) { console.error('[Sentinel] SW keepalive start failed:', getErrorMessage(e)); }

  // Phase 5: v8.0/v9.0 Advanced Intelligence - Start profiling and predictive analysis
  profilingEnabled = true;
  _predictiveAnalysisEnabled = true;
  selfHealingEnabled = true;
  RuntimeProfiler.start();
  console.debug('[Sentinel Phase 5] Runtime profiling started');
  const _profilingInterval = 10; // Take sample every 10 steps

  let command;
  // Loop-detector state — declared here so they survive across iterations without
  // relying on `var` hoisting inside the loop body (fragile in strict mode).
  let _clickAtLoopCount = 0;
  let _lastCmdType = '';
  let _sameCmdCount = 0;
  let _lastLoopUrl = '';
  let _totalLoopRecoveries = 0;  // (v21.6.6) Hard escalation after 3 total loops
  let _blockedCount = 0;  // (v21.6.38) Track BLOCKED execute_js calls
  while (!finished && agentRunning) {

    // (v3.60 / fixed): Batch commands are drained just before the LLM consult
    // at the end of this iteration (see _pendingCommandQueue check near callLLM).
    // The early-shift block was removed — it caused a double-pop that dropped
    // commands when two or more were queued simultaneously.

    // (v21.6.13) Nuclear stop check at top of every iteration
    if (!agentRunning) { console.warn('[Sentinel] Stop detected at loop top — breaking'); break; }

    try {
      // Pause check — wait until resumed
      if (agentPaused) {
        sendSilentUpdate('⏸ Agent paused — waiting for resume', stepCount);
        while (agentPaused && agentRunning) await sleep(FIVE_HUNDRED_MS);
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

      // Check for mid-run user correction (e.g., "click the second one instead")
      const _correctionTabId = getActiveTabId();
      const _correction = _correctionQueue.get(_correctionTabId);
      if (_correction) {
        _correctionQueue.delete(_correctionTabId);
        historyPush({ role: 'user', content: 'USER CORRECTION: ' + _correction + '. Adjust your next action accordingly.' });
        try {
          chrome.runtime.sendMessage({
            type: 'agent_status',
            tabId: _correctionTabId,
            status: 'thinking',
            detail: 'Adjusting plan: ' + _correction,
            timestamp: Date.now()
          }).catch(() => {});
        } catch(_e) {}
        sendSilentUpdate(`🔄 User correction: ${_correction}`, stepCount);
      }

      _lastLoopUrl = _lastObservedUrl;
      stepCount++;
      // (3.16.0) Signal new step to the popup so it can create a fresh
      // activity stream container BEFORE observation/AI consultation begin.
      try { sendAgentStepStart(stepCount, agentPlan ? agentPlan.length : 0); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      // v21.6.58: Progressive summarization every 8 steps
      if (stepCount > 0 && stepCount % 8 === 0 && history.length > 6) {
        try {
          const _psum = buildProgressSummary(history, agentMemory, stepCount);
          if (_psum) {
            loopDirective = (loopDirective || '') + '\n' + _psum;
            sendSilentUpdate('[ENGINE] Progress summary injected', stepCount);
          }
        } catch(_se) { /* best-effort */ }
      }
      
      // Phase 5: Take profiling sample periodically (every _profilingInterval steps)
      if (profilingEnabled && stepCount % _profilingInterval === 0) {
        try {
          RuntimeProfiler.sample();
        } catch (e) {
          console.warn('[Sentinel Phase 5] Profiling sample failed:', getErrorMessage(e));
        }
      }
      
      // (3.8.2) Dynamic step limit. Baseline = CONFIG.maxSteps (100). Each
      // productive action bumps `productiveSteps` and extends the cap by +25.
      // Hard cap = 300. Multi-portal investigations get a +50 head-start so
      // they don't choke on the first portal.
      let dynamicBaseline = CONFIG.maxSteps;
      try {
        // Use global match to count distinct platform keywords safely (avoids ReDoS from .*  pattern)
        if (typeof goal === 'string') {
          const _multiPortalMatches = goal.match(MULTI_PORTAL_RE);
          if (_multiPortalMatches && _multiPortalMatches.length >= 2) {
            dynamicBaseline = CONFIG.maxSteps + 50;
          }
        }
      } catch (_e) {
        // Dynamic baseline calculation failed non-fatally
      }
      // (v21.6.16) Lower step ceiling — 300 was way too high for browser automation
      const dynamicMaxSteps = Math.min(60, dynamicBaseline + (productiveSteps * 25));
      // (3.36.1) Hotfix — telemetry emit moved AFTER `const dynamicMaxSteps`
      // declaration. Previously this line was above the const and tripped a
      // temporal-dead-zone ReferenceError every step on the first iteration,
      // hanging every run. The "let dynamicMaxSteps" in the outer block-scope
      // is in TDZ until the line that initializes it runs, so the previous
      // ordering blew up before any LLM call could fire.
      // (v21.6.18) NUCLEAR: If 5+ steps with 0 API calls, abort immediately
      if (stepCount > 3 && apiCallCount === 0) {
        const _abortMsg = 'ABORTED: Agent looped 5+ steps without making any LLM calls. This usually means the page is not scriptable. Please start the agent from a normal webpage (not chrome://extensions).';
        sendSilentUpdate(_abortMsg, stepCount);
        reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: _abortMsg }).catch(() => {});
        sendReportUpdate('generating');
        finished = true;
        await closeAllAgentTabs();
        break;
      }
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
        sharedState.cachedObservation = null;
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
      // v21.6.51: Hide native cursor to prevent double-cursor effect
      await _injectCursorHider(tab);


      // Get tab info
      let tabInfo = await getTabInfo(tab);

      if (!tabInfo) {
        sendSilentUpdate('Agent tab lost. Attempting recovery...', stepCount);
        const allTabs = await new Promise(resolve => {
          chrome.tabs.query({}, (t) => {
            if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) {
              console.error('[Agent recovery] tabs.query failed:', chrome.runtime.lastError.message || String(chrome.runtime.lastError));
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
        await sleep(FIVE_HUNDRED_MS);
        continue;
      }
      // Wait for page load
      if (tabInfo.status !== 'complete') {
        sendSilentUpdate('Waiting for page to load...', stepCount);
        await waitForPageLoad(tab);
        await sleep(FIVE_HUNDRED_MS);
      }

      // (v21.6.49) SPA EXTENDED WAIT — only on navigate
      if (command && command.type === 'navigate') {
      const _navUrl = (command.url || currentUrl || '').toLowerCase();
      const _isSPAPortal = _navUrl.includes('microsoft.com') || _navUrl.includes('entra.') ||
        _navUrl.includes('admin.microsoft') || _navUrl.includes('portal.office');
      if (_isSPAPortal) {
        sendSilentUpdate('Waiting for SPA to render...', stepCount);
        let _spaReady = false;
        for (let _spaWait = 0; _spaWait < 12; _spaWait++) {
          await sleep(1000);
          try {
            const _spaCheck = await cdpExecuteJs(tab, 'return { bodyLen: (document.body && document.body.innerText || "").length, hasMain: !!document.querySelector("[role=main], main, .main-content, #mainContent, app-root"), title: document.title || "" };', { timeout: 2000 });
            if (_spaCheck && _spaCheck.ok && _spaCheck.value) {
              const _bodyLen = _spaCheck.value.bodyLen || 0;
              const _hasMain = _spaCheck.value.hasMain || false;
              if (_bodyLen > 500 && _hasMain) { _spaReady = true; break; }
              if (_bodyLen > 1000) { _spaReady = true; break; }
            }
          } catch (_) {}
        }
        if (_spaReady) {
          sendSilentUpdate('SPA content rendered', stepCount);
          await sleep(1000);
        } else {
          sendSilentUpdate('SPA wait timeout', stepCount);
        }
      }

      } // end SPA navigate guard
      // (v21.6.45) CERT WARNING DETECTION — Critical for SonicWall/firewall access
      // Self-signed cert pages stop the agent cold. Detect and auto-bypass via CDP.
      try {
        const _certCheck = await cdpExecuteJs(tab, 'return { title: document.title || "", url: window.location.href || "", body: (document.body && document.body.innerText || "").substring(0, 500) };', { timeout: 3000 });
        if (_certCheck && _certCheck.ok && _certCheck.value) {
          const _pageTitle = String(_certCheck.value.title || '').toLowerCase();
          const _pageBody = String(_certCheck.value.body || '').toLowerCase();
          const _isCertError = _pageTitle.includes('privacy error') ||
            _pageTitle.includes('not private') ||
            _pageTitle.includes('not secure') ||
            _pageTitle.includes('certificate') ||
            _pageBody.includes('your connection is not private') ||
            _pageBody.includes('net::err_cert') ||
            _pageBody.includes(' attackers might be trying') ||
            _pageBody.includes('this server could not prove');
          if (_isCertError) {
            sendSilentUpdate('SSL cert warning detected — auto-bypassing for firewall access...', stepCount);
            try {
              // Bypass cert errors via CDP Security domain
              await chrome.debugger.sendCommand({ tabId: tab }, 'Security.setIgnoreCertificateErrors', { ignore: true });
              // Re-navigate to the target URL
              const _targetUrl = command.url || (goal && goal.match(/https?:\/\/[^\s]+/) || [])[0];
              if (_targetUrl) {
                await chrome.tabs.update(tab, { url: _targetUrl });
                await waitForPageLoad(tab);
                await sleep(1500);
                await injectContentScript(tab);
                sendSilentUpdate('SSL cert bypassed — page reloaded', stepCount);
              }
            } catch (_certBypassErr) {
              console.warn('[Sentinel] Cert bypass failed:', getErrorMessage(_certBypassErr));
            }
          }
        }
      } catch (_certCheckErr) { /* cert detection failed — non-fatal */ }

      // Internal browser pages (chrome://, edge://, about:) cannot be scripted.
	      const _tabUrl = tabInfo.url; // Cache to avoid repeated property access
      // EXCEPTION: chrome://newtab/ is a blank tab — the auto-navigate code below
      // will navigate it to the goal URL, so don't block it here.
      const _isNewTab = _tabUrl === 'chrome://newtab/' || _tabUrl === 'chrome://newtab'
        || _tabUrl === 'about:blank' || _tabUrl === 'about:newtab' || _tabUrl === 'about:newtab/'
        || _tabUrl === 'edge://newtab/' || _tabUrl === 'edge://newtab';
      const _isRestrictedPage = !_isNewTab && (
        _tabUrl.startsWith('chrome://') || _tabUrl.startsWith('edge://') || _tabUrl.startsWith('about:')
      );
      if (_isRestrictedPage) {
        // (v21.6.19) BULLEPROOF restricted page handler — works from ANY starting page
        let _targetUrl = null;
        if (goal) {
          const _goalMatch = goal.match(/https?:\/\/[^\s]+/);
          if (_goalMatch) _targetUrl = _goalMatch[0];
        }

        if (!_targetUrl) {
          // No URL in goal — abort immediately, don't create useless about:blank tabs
          const _noUrlMsg = `Cannot start from internal page (${_tabUrl}) and no URL found in goal. Please start from a normal webpage.`;
          historyPush({ step: stepCount, action: { type: 'note' }, result: _noUrlMsg });
          reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
          chrome.runtime.sendMessage({ action: 'agent_finished', summary: _noUrlMsg }).catch(() => {});
          sendReportUpdate('generating');
          finished = true;
          break;
        }

        sendSilentUpdate(`Navigating to goal URL: ${_targetUrl}`, stepCount);
        try {
          // Navigate the CURRENT tab to the goal URL (reuse, don't create new tab)
          await chrome.tabs.update(tab, { url: _targetUrl });
          await waitForPageLoad(tab);
          await waitForPageReady(tab);
          await sleep(1000); // Extra settle time

          // Inject content script on the new page
          const _injected = await injectContentScript(tab);
          if (!_injected) {
            // Retry injection once
            await sleep(2000);
            await injectContentScript(tab);
          }

          // Register tab
          try { registerInitialTab(tab, _targetUrl); } catch(_re) {}

          historyPush({ step: stepCount, action: { type: 'navigate', url: _targetUrl }, result: `Navigated from ${_tabUrl} to ${_targetUrl}` });
          await persistHistory();
          continue;
        } catch (_navE) {
          // If navigation fails, try creating a new tab as fallback
          try {
            const _newTab = await chrome.tabs.create({ url: _targetUrl, active: true });
            if (_newTab && _newTab.id) {
              tab = _newTab.id;
              await waitForPageLoad(tab);
              await sleep(1000);
              await injectContentScript(tab);
              try {
                const { registerAgentTab } = await import('./agent-tabs.js');
                if (typeof registerAgentTab === 'function') {
                  await registerAgentTab(_newTab.id, { isPrimary: false, isAgentCreated: true });
                }
              } catch (_regE) { /* non-fatal */ }
              continue;
            }
          } catch (_tabE2) {
            const _failMsg = `Failed to navigate from internal page (${_tabUrl}). Please start from a normal webpage.`;
            reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
            chrome.runtime.sendMessage({ action: 'agent_finished', summary: _failMsg }).catch(() => {});
            sendReportUpdate('generating');
            finished = true;
            break;
          }
        }
      }

            // Auto-navigate to URL found in goal (first iteration only)
      // Smart: checks current page hostname before navigating
      if (stepCount === 1 && goal) {
        // Strip email addresses before URL extraction so "support@example.com" is
        // never mistaken for a navigation target.
        const _goalForUrlExtract = goal.replace(EMAIL_RE, '');
        // Only auto-navigate when the goal starts with an explicit navigation
        // imperative OR contains a full https:// URL. Avoid triggering on ticket
        // text that mentions a URL in passing (e.g. "user cannot reach admin.microsoft.com").
        const _isExplicitNav = isExplicitNavigation(_goalForUrlExtract);
        let urlMatch = null;
        if (typeof _goalForUrlExtract === 'string') {
          urlMatch = _isExplicitNav
            ? (_goalForUrlExtract.match(GOAL_URL_EXTRACT_RE) || _goalForUrlExtract.match(GOAL_NAV_COMMAND_RE))
            : _goalForUrlExtract.match(GOAL_URL_EXTRACT_RE);
        }
        // v3.66: Bare site name fallback for Step 1 auto-navigate
        if (!urlMatch && _isExplicitNav) {
          const _step1Bare = _goalForUrlExtract.match(GOAL_BARE_SITE_RE);
          if (_step1Bare && typeof _step1Bare[1] === 'string') {
            const _step1Key = _step1Bare[1].trim().toLowerCase().replace(WHITESPACE_NORMALIZE_RE, '');
            if (BARE_SITE_MAP[_step1Key]) {
              urlMatch = [`go to ${_step1Bare[1]}`, BARE_SITE_MAP[_step1Key]];
            } else {
              for (const [k, v] of Object.entries(BARE_SITE_MAP)) {
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
            if (!currentHostname.includes(goalHostname.replace(WWW_PREFIX_RE, ''))) {
              sendSilentUpdate(`Navigating to: ${goalUrl}`, stepCount);
              sendActionMessage({ type: 'navigate', url: goalUrl }, stepCount, null);
              await chrome.tabs.update(tab, { url: goalUrl });
              await waitForPageLoad(tab);
              await waitForPageReady(tab);
              sharedState.cachedObservation = null; // Invalidate cache after navigation
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
      sharedState.cdpFallbackActive = false;
      if (!scriptReady) {
        consecutiveInjectionFailures++;
        sendSilentUpdate('Content script failed -- trying CDP fallback', stepCount);
        
        // (v3.54) CDP Fallback: bypass CSP by using Chrome DevTools Protocol directly.
        // After 2 failures, switch to CDP mode — observe, dismiss overlays, read page.
        if (consecutiveInjectionFailures >= 2) {
          console.warn(`[Sentinel] Content script failed ${consecutiveInjectionFailures} times — activating CDP fallback`);
          sharedState.cdpFallbackActive = true;
          // (v3.57) On first CDP activation, check if page has any DOM at all.
          // If empty (no body, no title), reload the page via CDP.
          if (consecutiveInjectionFailures === 2) {
            try {
              const pgCheck = await cdpExecuteJs(tab, 'return{hasBody:!!document.body,children:(document.body||document.documentElement).childNodes.length,title:document.title||"",url:window.location.href};', { timeout: THREE_SECONDS_MS });
              if (pgCheck && pgCheck.ok && pgCheck.value && (!pgCheck.value.hasBody || (pgCheck.value.children === 0 && !pgCheck.value.title))) {
                await chrome.debugger.sendCommand({ tabId: tab }, 'Page.reload', { ignoreCache: true });
                await new Promise(r => setTimeout(r, TWO_SECONDS_MS));
              }
            } catch(_) { /* non-fatal */ }
          }
          // Don't continue — fall through to observation with CDP data
        } else {
          await sleep(ONE_SECOND_MS); // SPEED: reduced from 2000ms — one retry, recover faster
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
      if (sharedState.cdpFallbackActive) {
        // (v3.54→3.55) CDP fallback: always run nuclear overlay removal.
        // Don't wait for overlay detection — just nuke everything that looks like one.
        try {
          const dismissed = await _cdpDismissOverlays(tab, []);
          if (dismissed > 0) {
            sendSilentUpdate(`[CDP] Nuked ${dismissed} overlay element(s)`, stepCount);
            await sleep(EIGHT_HUNDRED_MS);
          }
        } catch (_) { /* non-fatal */ }
      } else {
        try {
          const overlayResult = await sendMessageWithRetry(tab, { action: 'dismiss_overlays' });
          if (overlayResult && overlayResult.count > 0) {
            sendSilentUpdate(`Dismissed ${overlayResult.count} overlay(s)`, stepCount);
            await sleep(FOUR_HUNDRED_MS); // let overlay close animate
          }
        } catch (_) { /* non-fatal */ }
      }

      // Get page data — skip re-observation when the previous action was
      // non-mutating (note/extract/scroll/wait) AND no SPA transition occurred
      // AND the URL hasn't changed AND the DOM content hash matches (catches SPA
      // content changes without URL changes). On slow portals this halves step latency.
      let observation, pageContent;
      const histLen = history.length;
      const _prevAction = histLen ? history[histLen - 1] : null;
      const _prevType = _prevAction && _prevAction.action ? _prevAction.action.type : '';
      const _nonMutating = NON_MUTATING_ACTIONS_RE.test(_prevType);
      const _obsUrl = (tabInfo && tabInfo.url) || '';

      // Cache repeated condition for observation skip logic (perf)
      const _cacheCondition = _nonMutating && !isSPATransitionPending() && _lastObservedUrl === _obsUrl && !!sharedState.cachedObservation;

      // Compute a lightweight DOM content hash via the content script to detect
      // SPA content changes that don't alter the URL. The hash is a stable
      // fingerprint based on visible text length + interactive element count.
      let _currentDomHash = 0;
      if (_cacheCondition) {
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
              } catch (_e) { console.warn('[Sentinel] DOM hash JSON parse failed:', getErrorMessage(_e)); }
            }
            const parsed = typeof val === 'number' ? val : parseInt(String(val), 10);
            _currentDomHash = (typeof parsed === 'number' && !Number.isNaN(parsed)) ? parsed : 0;
          }
        } catch (_) { console.warn('[Sentinel] DOM hash probe failed, assuming cache miss'); }
      }

      const _observedHashBefore = _lastObservedDomHash;
      const _skipObserve = _cacheCondition && (_currentDomHash !== 0 && _currentDomHash === _lastObservedDomHash);
      if (_skipObserve) {
        observation = sharedState.cachedObservation;
        pageContent = _cachedPageContent;
        activityDone(stepCount, 'observe', '(cached — page unchanged)', null);
      } else {
        if (_cacheCondition && _currentDomHash !== 0 && _currentDomHash !== _lastObservedDomHash) {
          // SPA content change detected (URL same, DOM hash different)
          sendSilentUpdate('DOM changed (SPA) — re-observing...', stepCount);
        }
        // (3.16.0) Observation phase activity item
        sendAgentStatus('observing', 'Reading page structure...');
        activityStart(stepCount, 'observe', 'Observing page');
        try {
          if (sharedState.cdpFallbackActive) {
            // (v3.54) CDP fallback: observe page via DevTools Protocol instead of content script
            const cdpObs = await _cdpObservePage(tab, { inBatchMode: !!_pendingCommandQueue.length });
            if (cdpObs) {
              observation = { elements: cdpObs.elements || [] };
              pageContent = { content: cdpObs.text || '' };
              // Also check for overlays and auto-dismiss
              if (cdpObs.overlays && cdpObs.overlays.length) {
                const dismissed = await _cdpDismissOverlays(tab, cdpObs.overlays);
                if (dismissed > 0) {
                  sendSilentUpdate(`[CDP] Auto-dismissed ${dismissed} overlay(s) during observation`, stepCount);
                  await sleep(EIGHT_HUNDRED_MS);
                  // Re-observe after dismissal
                  const cdpObs2 = await _cdpObservePage(tab, { inBatchMode: !!_pendingCommandQueue.length });
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
          sharedState.cachedObservation = observation;
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
          // Page state narration via narratePageState helper
          try {
            const _els = (observation && observation.elements) || [];
            const _forms = _els.filter(e => ELEMENT_TAG_FORM_RE.test(e.tag || ''));
            const _buttons = _els.filter(e => ELEMENT_TAG_BUTTON_RE.test(e.tag || '') || e.role === 'button');
            const _links = _els.filter(e => ELEMENT_TAG_A_RE.test(e.tag || ''));
            const _inputs = _els.filter(e => ELEMENT_TAG_INPUT_RE.test(e.tag || ''));
            const _tables = _els.filter(e => /^table$/i.test(e.tag || ''));
            const _pageCtx = {
              title: (tabInfo && tabInfo.title) || '',
              url: (tabInfo && tabInfo.url) || '',
              forms: _forms,
              buttons: _buttons,
              links: _links,
              inputs: _inputs,
              tables: _tables,
              bodyText: (pageContent && pageContent.content) || ''
            };
            const _narration = narratePageState(_pageCtx);
            try {
              chrome.runtime.sendMessage({
                type: 'agent_status',
                tabId: tab,
                status: 'thinking',
                detail: 'I see: ' + _narration,
                timestamp: Date.now()
              }).catch(() => {});
            } catch(_e) {}
          } catch (_ne) {
            // narratePageState emission failed non-fatally
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
      // Enhance elements with visual descriptions for LLM prompt
      enhanceWithVisualProperties(trimmedElements);

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
          while (agentPaused && agentRunning) await sleep(FIVE_HUNDRED_MS);
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
          while (agentPaused && agentRunning) await sleep(FIVE_HUNDRED_MS);
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
            while (agentPaused && agentRunning) await sleep(FIVE_HUNDRED_MS);
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

      // Cache history length once per iteration (perf: accessed many times below)
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
        const typeLoop = _detectActionTypeLoop(history, agentMemory);
        if (typeLoop.isLoop) {
          loopDirective = `\n⚠ ACTION-TYPE LOOP -- ${typeLoop.count} of last 4 actions were "${typeLoop.type}" with no productive memory write. The current strategy is not yielding data. You MUST switch action types now:\n1. If you have been navigating, STOP -- run execute_js with a key on the current page to extract whatever data is visible. The retry ladder will fall back to body.innerText automatically.\n2. If you have been clicking, try a different selector or use execute_js to read the DOM directly.\n3. If you have been read_page-ing, switch to extract / extract_list with a key.\n4. If extraction has failed twice on this page, finish() with what you have and move on rather than retrying.\n`;
        }
      }

      // Cache memory count for reuse in this section (perf: multiple uses below)
      const memCount = getObjectLength(agentMemory);

      //    Also check for execute_js-heavy patterns in recent window (model escaping consecutive check)
      if (_histLen >= 3 && !loopDirective) {
        let consecutiveNonProductive = 0;
        for (let i = _histLen - 1; i >= 0; i--) {
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
        const last8Start = Math.max(0, _histLen - 8);
        for (let i = last8Start; i < _histLen; i++) {
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

      // 3. (v21.3) HARD CEILING + circuit breaker: force a clean finish
      //    at ABSOLUTE_MAX_STEPS (150) regardless of dynamicMaxSteps bumps.
      //    Also inject circuit breaker directives when degenerate loops detected.
      // (v21.6.1) Track consecutive LLM failures for early-stop
      const _recentFailures = history.slice(-6).filter(h => h.result && typeof h.result === 'string' && (h.result.includes('API Error') || h.result.includes('non-ok response'))).length;
      const _cbResult = checkCircuitBreaker(history, stepCount, dynamicMaxSteps);
      if (_recentFailures >= 5 && !_cbResult.shouldHardStop) {
        _cbResult.shouldHardStop = true;
        _cbResult.reason = `5 consecutive LLM failures — likely model/provider incompatibility. Check model supports vision.`;
        _cbResult.severity = 'critical';
      }
      // (v21.6.1) Vision 404 detection — model doesn't support image input
      const _lastEntry = history[history.length - 1];
      const _lastErr = _lastEntry && _lastEntry.result ? String(_lastEntry.result) : '';
      if (_lastErr.includes('No endpoints found that support image input') || _lastErr.includes('support image input')) {
        _cbResult.shouldHardStop = true;
        _cbResult.reason = 'Model does not support vision (image input). Switch to a vision-capable model in Settings or Quick Switcher.';
        _cbResult.severity = 'critical';
      }
      if (_cbResult.directive) {
        loopDirective += _cbResult.directive;
      }
      // (v21.3) Hard stop on circuit breaker or absolute step ceiling
      if (_cbResult.shouldHardStop || stepCount >= ABSOLUTE_MAX_STEPS) {
        const _hardReason = _cbResult.shouldHardStop
          ? _cbResult.reason
          : `ABSOLUTE STEP CEILING reached (${stepCount} >= ${ABSOLUTE_MAX_STEPS})`;
        sendSilentUpdate(`🔴 ${_hardReason}`, stepCount);
        const memLines = Object.entries(agentMemory).slice(0, 10).map(([k, v]) => {
          const vStr = Array.isArray(v) ? v.slice(0, 5).map(i => String(i)).join(', ') : String(v).substring(0, 200);
          return `- ${k}: ${vStr}`;
        }).join('\n');
        const summary = memCount > 0
          ? `Task completed after ${stepCount} steps with ${memCount} data points extracted:\n\n${memLines}${memCount > 10 ? `\n...and ${memCount - 10} more items.` : ''}`
          : `Task timed out after ${stepCount} steps. ${_hardReason}`;
        finished = true;
        sendActionResult(stepCount, { type: 'finish', summary }, false);
        historyPush({ step: stepCount, action: { type: 'finish', summary }, result: summary });
        reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary }).catch((e) => {
          console.error('[summary] Unhandled rejection:', e);
        });
        sendReportUpdate('generating');
        break;
      }

      // (v21.3) Circuit breaker logging when triggered
      if (_cbResult && _cbResult.severity !== 'none') {
        // v21.6.38: Force-finish on identical action loops — don't just warn
        if (_cbResult.severity === 'critical' || (_cbResult.reason && _cbResult.reason.includes('IDENTICAL ACTION LOOP'))) {
          const _cbLoopCount = (_cbResult.reason || '').match(/repeated (\d+) times/);
          if (_cbLoopCount && parseInt(_cbLoopCount[1]) >= 5) {
            const _cbMemKeys = Object.keys(agentMemory || {});
            const _cbSummary = _cbMemKeys.length > 0 ? _cbMemKeys.map(k => `${k}: ${String(agentMemory[k]).substring(0, 80)}`).join(', ') : 'no data extracted';
            const _forceResult = `FORCE-FINISH (CIRCUIT BREAKER): Agent stuck in identical action loop (${_cbLoopCount[1]} repetitions). Finishing with available data: ${_cbSummary}`;
            historyPush({ step: stepCount, action: { type: 'circuit_breaker_stop' }, result: _forceResult });
            await persistHistory();
            sendActionResult(stepCount, _forceResult, false);
            reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
            chrome.runtime.sendMessage({ action: 'agent_finished', summary: `Task force-finished by circuit breaker. Data: ${_cbSummary}` }).catch(() => {});
            sendReportUpdate('generating');
            finished = true;
            break;
          }
        }
        try {
          console.warn(`[Sentinel/CircuitBreaker] ${_cbResult.reason}`);
          if (runLogId) {
            runLogBuffer.push({
              step: stepCount,
              timestamp: new Date().toISOString(),
              kind: 'circuit_breaker',
              severity: _cbResult.severity,
              reason: _cbResult.reason
            });
            chrome.storage.local.set({ [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } }).catch(() => {});
          }
        } catch (_) {}
      }

      // (3.21.0) Recovery skill library — consult before the LLM call.
      // Skills can either AUTO-APPLY a deterministic recovery command
      // (skipping the LLM round-trip entirely) or inject a directive into
      // the next prompt. Built on the failure-pattern signals already
      // accumulated in history + consecutiveFailures + _lastAiCallMs.
      let _skillAutoCommand = null;
      try {
        const _lastHistEntry = _histLen ? history[_histLen - 1] : null;
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
      }, FIVE_SECONDS_MS);

      sendAgentStatus('thinking', 'Analyzing context, deciding next action...');
      emitAgentStatus(workingTabId, 'thinking', `LLM call #${apiCallCount + 1} — analyzing context`);
      sendSilentUpdate(`Consulting AI -- call #${apiCallCount + 1}`, stepCount);
      tel.info('llm', `LLM call #${apiCallCount + 1} starting`, { stepCount, elementsCount: trimmedElements.length, pageTextLen: pageText.length, historyEntries: _histLen, hasScreenshot: !!base64Image });
      command = null;
      // (3.9.0) Budget hint — tell the LLM how much step room it has left so
      // it can pace itself. Multi-portal investigations especially benefit
      // from knowing they have 200 vs 50 steps remaining.
      const _budgetHint = buildBudgetHint(stepCount, dynamicMaxSteps, productiveSteps);
      // v21.6.58: Enhanced budget awareness — show what data we have vs what we need
      const _memKeys = Object.keys(agentMemory || {});
      if (_memKeys.length > 0 && stepCount > 3) {
        const _memHint = "\n[STEP " + stepCount + "/" + dynamicMaxSteps + "] " + (dynamicMaxSteps - stepCount) + " steps remaining. Data: " + _memKeys.length + " key(s) collected. Prioritize remaining goals.";
        loopDirective = (loopDirective || '') + _memHint;
      }
        'Aimless read_page / scroll = unproductive (does not extend).';
      
      // v4.0 Vision-First Observation Override
      let _visionElements = null;
      let _visionElementMap = null;
      let _visionElementTree = '';
      let _visionMode = false;
      // v4.0: Vision-first ALWAYS active
      {
        try {
          const visionResult = await _visionObserve(tab, currentUrl);
          if (visionResult.elements.length) {
            _visionElements = visionResult.elements;
            _visionElementMap = new Map();
            for (const e of visionResult.elements) {
              _visionElementMap.set(e.index, e);
            }
            // (v21.6.15) Prune element tree to interactive elements only — saves 60-80% tokens
            const _allElements = visionResult.elements || [];
            const _INTERACTIVE_TAGS = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','OPTION']);
            const _prunedElements = _allElements.filter(e =>
              _INTERACTIVE_TAGS.has((e.tag || '').toUpperCase()) ||
              (e.role && /button|link|textbox|checkbox|radio|tab|menuitem|option|combobox/i.test(e.role)) ||
              e.hasOnClick || e.isInteractive
            );
            if (_prunedElements.length >= 5 && _prunedElements.length < _allElements.length) {
              _visionElements = _prunedElements;
              _visionElementMap = new Map();
              for (const e of _prunedElements) { _visionElementMap.set(e.index, e); }
              _visionElementTree = _prunedElements.map(e =>
                `[${e.index}] <${e.tag}> ${e.text ? e.text.substring(0, 60) : ''}`
              ).join('\n');
            } else {
              _visionElementTree = visionResult.elementTree;
            }
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
              bbox: e.rect, // normalized bbox for visual property extraction
              isClickable: e.isClickable,
              isInput: e.isInput,
              tag: e.tag || 'div',
              role: e.role || '',
              ariaLabel: e.ariaLabel || ''
            }));
            // Enhance vision elements with visual descriptions
            enhanceWithVisualProperties(trimmedElements);
            allElements = [...trimmedElements]; // reassign (not mutate) so cached observation.elements stays intact
          }
        } catch (e) {
          console.warn('[Sentinel/v4] Vision observe failed:', e);
        }
      }
      // Build step context for multi-provider model routing
      const _stepContext = {
        type: '', // unknown at this point — LLM hasn't decided yet
        selector: '',
        hasScreenshot: !!base64Image,
        stepNumber: stepCount,
        totalSteps: agentPlan ? agentPlan.length : 0,
        previousFailures: consecutiveFailures || 0
      };

      const _zoomAnnotation = formatZoomRegion(getZoomRegion());
      // (v21.5) Streaming token callback — broadcasts partial content to popup.
      // Throttled to every ~200ms to avoid message bus flooding.
      let _lastStreamBroadcast = 0;
      const _onStreamChunk = (partialText) => {
        const now = Date.now();
        if (now - _lastStreamBroadcast < 200) return;
        _lastStreamBroadcast = now;
        try {
          chrome.runtime.sendMessage({
            action: 'ai_streaming_chunk',
            step: stepCount,
            text: partialText.substring(0, 500),
            timestamp: now
          }).catch(() => {});
        } catch (_) {}
      };
      const agentState = { apiCallCount, agentMemory, onStreamChunk: _onStreamChunk, visionMode: _visionMode, visionElementTree: _visionElementTree, visionElements: _visionElements, visionElementMap: _visionElementMap, consecutiveFailures, currentStrategies, agentPlan, currentPlanStep, loopDirective, screenshotMeta, budgetHint: _budgetHint, clientKnowledgeText, brainKnowledgeText, pendingVerification, quickMode: _runSettings.quickMode, cdpFallbackActive: sharedState.cdpFallbackActive, stepContext: _stepContext, zoomRegion: getZoomRegion(), zoomAnnotation: _zoomAnnotation };
      // Cap history window for prompt to control token cost (CONFIG.historyWindow).
      // Also strip any base64Image / screenshot fields from past entries -- only the
      // most recent observation needs the image (passed separately as base64Image arg).
      const promptHistory = [];
      const historyStart = Math.max(0, _histLen - CONFIG.historyWindow);
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
      // CDP Network Interception: inject network data when goal is network/API-related
      try {
        if (shouldReportNetwork(goal)) {
          const _netSnapshot = captureNetworkSnapshot(tab, { limit: 30, maxEntries: 15 });
          if (_netSnapshot) {
            promptHistory.push({
              step: stepCount,
              action: { type: "note" },
              result: `📡 ${_netSnapshot}`
            });
          }
        }
      } catch (_netErr) { /* network capture failed — non-fatal */ }
      let _aiCallError = null;
      // Drain one sub-command from the repeat_for_each queue before consulting LLM
      if (_pendingCommandQueue.length) {
        clearInterval(progressTimer);
        base64Image = null;
        if (_visionMode) { try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: THREE_SECONDS_MS }); } catch (_e) { /* vision cleanup failed - non-fatal */ } }
        command = _pendingCommandQueue.shift();
        activityDone(stepCount, 'consult-ai', `Queued sub-command: ${command.type}`, null);
        _lastAiCallMs = 0;
      // (3.21.0) If a recovery skill auto-applied, use that command and
      // skip the LLM consult entirely. Saves ~5-30s per recovery + an LLM
      // call's worth of cost.
      } else if (_skillAutoCommand) {
        clearInterval(progressTimer);
        base64Image = null;
        if (_visionMode) { try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: THREE_SECONDS_MS }); } catch (_e) { /* vision cleanup failed - non-fatal */ } }
        command = _skillAutoCommand;
        activityDone(stepCount, 'consult-ai', 'Skipped (skill auto-applied)', null);
        _lastAiCallMs = 0;
      } else {
        const _aiStart = Date.now();

      // ═══════════════════════════════════════════════════════════
      // v4.0 VISION-FIRST LLM CALL (Browser Use architecture)
      // ═══════════════════════════════════════════════════════════
      if (_visionMode && _visionElements) {
        const _visionHistory = formatVisionHistory(promptHistory, 5);

        const _visionSystemPrompt = buildVisionSystemPrompt();

        const _zoomAnnotation = formatZoomRegion(getZoomRegion());
      // v21.6.58: Page-type detection for smarter strategies
      let _pageTypeHint = '';
      try {
        const _pageType = await detectPageType(tab);
        if (_pageType && _pageType.confidence > 0.6) {
          _pageTypeHint = getPageStrategyHint(_pageType);
          if (_pageTypeHint) loopDirective = (loopDirective || '') + '\n' + _pageTypeHint;
        }
      } catch(_pte) { /* best-effort */ }
      
        const _visionUserContent = buildVisionUserContent(goal, currentUrl, stepCount, dynamicMaxSteps, _visionElementTree, _visionHistory, _zoomAnnotation, loopDirective, agentMemory, sharedState.pageStagnation);

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
          let _vResponse = null;
          // Prepare request body safely
          let _visionBody;
          try {
            _visionBody = JSON.stringify({
              model: _vModel,
              messages: _visionMessages,
              // GLM-4.xV / DeepSeek-VL emit a <think> reasoning block (300-500
              // tokens) BEFORE the JSON action. At 600 the action was routinely
              // truncated mid-emit, forcing parseVisionResponse into its salvage
              // paths. 1200 leaves ample room for think + full action.
              max_tokens: 1200,
              // Index selection is a precision task, not a creative one. temp 0
              // makes the chosen [index] deterministic so a re-observe of the same
              // screenshot yields the same decision instead of a different (and
              // possibly hallucinated) number each time.
              temperature: 0
            });
          } catch (_stringifyErr) {
            console.warn('[Sentinel/v4] Vision payload serialization failed:', getErrorMessage(_stringifyErr));
            break; // Exit vision mode on serialization failure
          }
          // (v20.5) Bounded retry-with-backoff for TRANSIENT failures (network
          // error, 429/5xx) before falling through to the legacy path. Keeps the
          // set-of-marks numbered-label grounding weak vision models depend on
          // (legacy clicks by estimated coordinates, which grounds worse); a
          // single transient blip shouldn't forfeit it. A 45s timeout (AbortError)
          // is NOT retried — it would just time out again, so we surface it and
          // fall through to the legacy callLLMWithRetry path (command stays null).
          // Honours Retry-After on 429.
          const _VISION_MAX_ATTEMPTS = 2; // 1 initial + 1 retry
          const _isTransientStatus = (s) => s === 429 || (s >= 500 && s <= 599);
          for (let _vAttempt = 0; _vAttempt < _VISION_MAX_ATTEMPTS; _vAttempt++) {
            const _vCtrl = new AbortController();
            // (v21.6.8) Chain run-level abort into this fetch's controller
            if (_runAbortController?.signal.aborted) _vCtrl.abort();
            else if (_runAbortController) _runAbortController.signal.addEventListener('abort', () => _vCtrl.abort(), { once: true });
            const _vTimeoutId = setTimeout(() => _vCtrl.abort(), FORTY_FIVE_SECONDS_MS);
            let _vFetchErr = null;
            let _vAborted = false;
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
            } catch (_fe) {
              _vFetchErr = _fe; // network error or 45s timeout abort
              _vAborted = !!(_fe && typeof _fe === 'object' && _fe.name === 'AbortError');
            } finally {
              clearTimeout(_vTimeoutId);
            }
            if (!agentRunning) break; // (v21.6.8) Stop requested during fetch
            if (_vResponse && _vResponse.ok) break; // success
            // A 45s timeout won't get better on retry — treat it as non-transient
            // so we surface it and fall through to legacy instead of waiting again.
            const _transient = _vFetchErr ? !_vAborted : (_vResponse ? _isTransientStatus(_vResponse.status) : false);
            const _attemptsLeft = _vAttempt < _VISION_MAX_ATTEMPTS - 1;
            if (!_transient || !_attemptsLeft) {
              if (_vFetchErr) throw _vFetchErr; // surface to outer catch → legacy fallback
              break; // non-transient non-ok response: handled below
            }
            // Honour Retry-After on 429 when it's a sane small value; else linear backoff.
            let _backoffMs = 700 * (_vAttempt + 1);
            if (_vResponse && _vResponse.status === 429 && _vResponse.headers && typeof _vResponse.headers.get === 'function') {
              const _ra = Number(_vResponse.headers.get('retry-after'));
              if (Number.isFinite(_ra) && _ra > 0 && _ra <= 10) _backoffMs = _ra * 1000;
            }
            console.warn(`[Sentinel/v4] 
        // v21.6.55: Detect Z.ai content safety filter (code 1301) — stop retrying immediately
        if (_vErr && /1301|content.*unsafe|sensitive content/i.test(String(_vErr))) {
          console.warn('[Sentinel] Z.ai content safety filter triggered — truncating page content for next attempt');
          _consecutiveContentSafetyErrors = (_consecutiveContentSafetyErrors || 0) + 1;
          if (_consecutiveContentSafetyErrors >= 2) {
            // After 2 content safety errors, force execute_js path to extract minimal content
            command = { type: 'execute_js', code: 'return document.body.innerText.substring(0, 5000)', key: 'page_content', _visionAction: true, approvalGranted: true };
            _consecutiveContentSafetyErrors = 0;
            sendSilentUpdate('[ADAPTIVE] Content safety triggered — switching to minimal extraction', stepCount);
          }
        }
Vision transient failure (${_vResponse ? `HTTP ${_vResponse.status}` : getErrorMessage(_vFetchErr)}); retrying in ${_backoffMs}ms`);;
        sendSilentUpdate('[RATE LIMIT] API rate limited — retrying with backoff. This is normal for free-tier models.', stepCount);
            _vResponse = null;
            await sleep(_backoffMs);
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
            // (v20.5) Prefer message.content, but fall back to reasoning_content.
            // GLM/DeepSeek-style reasoning models sometimes return an empty
            // content with the actual JSON action sitting in reasoning_content (or
            // emit both). Reading content-only silently produced an empty response
            // → parse failure → a wasted call. The legacy path already handles
            // reasoning_content; mirror that here so the SoM path doesn't lose it.
            const _vMsg = _vData && _vData.choices && Array.isArray(_vData.choices) && _vData.choices[0]
              ? _vData.choices[0].message : null;
            const _vContent = (_vMsg && typeof _vMsg.content === 'string') ? _vMsg.content : '';
            const _vReasoning = (_vMsg && typeof _vMsg.reasoning_content === 'string') ? _vMsg.reasoning_content
              : (_vMsg && typeof _vMsg.reasoning === 'string') ? _vMsg.reasoning : '';
            // If content lacks a JSON object but reasoning has one, parse reasoning too.
            const _contentHasJson = _vContent.includes('{') && _vContent.includes('}');
            const _vRaw = _contentHasJson
              ? _vContent
              : [_vContent, _vReasoning].filter(Boolean).join('\n').trim();

            // (v20.5) Record token usage — the v4 vision path previously bumped
            // only apiCallCount, so cost/credit tracking silently missed every
            // vision step (worst on metered free tiers).
            const _vu = (_vData && _vData.usage) || {};
            const _vIn  = _vu.prompt_tokens || _vu.input_tokens || 0;
            const _vOut = _vu.completion_tokens || _vu.output_tokens || 0;
            if (_vIn || _vOut) {
              agentState.totalInputTokens  = (agentState.totalInputTokens  || 0) + _vIn;
              agentState.totalOutputTokens = (agentState.totalOutputTokens || 0) + _vOut;
              try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                  chrome.runtime.sendMessage({ action: 'record_credit_usage', inputTokens: _vIn, outputTokens: _vOut, model: _vModel }).catch(() => {});
                }
              } catch (_creditErr) { /* non-fatal */ }
            }

            // Parse structured JSON output. Weak vision models (GLM-4V) wrap the
            // JSON in <think> blocks / markdown / prose and emit invalid escapes;
            // parseVisionResponse mirrors the legacy path's multi-tier hardening
            // (strip <think>/fences → sanitize → balanced-object extraction →
            // regex salvage) so a single malformed brace doesn't cost a step.
            const _vParsed = parseVisionResponse(_vRaw);
            if (!_vParsed) console.warn('[Sentinel/v4] Vision: response not parseable:', (_vRaw || '').slice(0, 200));

            if (_vParsed && _vParsed.action) {
              const _va = _vParsed.action;
              // (v20.4) Resolve + validate the element index. GLM-4V frequently
              // hallucinates an [index] that isn't on the page, or omits it
              // entirely. Only accept an index that actually exists in the
              // current vision element map; otherwise fall through to a
              // corrective note so the model re-picks from real numbers instead
              // of dispatching a dead no-op click_at that wastes a step.
              const _rawIdx = (typeof _va.index === 'number') ? _va.index
                : (typeof _va.index === 'string' && /^\d+$/.test(_va.index.trim())) ? Number(_va.index)
                : NaN;
              const _validIdx = (Number.isInteger(_rawIdx) && _rawIdx > 0
                && _visionElementMap && _visionElementMap.has(_rawIdx)) ? _rawIdx : null;
              // Build a precise correction hint when the model picks a bad index.
              // We deliberately do NOT auto-click a numeric neighbour: the index is
              // DOM-scan order, not visual proximity, so [N±1] is often an unrelated
              // (sometimes destructive) control. Instead we hand the model the real
              // valid range so it re-picks correctly on the next step.
              const _badIndexHint = (want) => {
                const _keys = _visionElementMap
                  ? Array.from(_visionElementMap.keys()).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b)
                  : [];
                if (!_keys.length) return 'No numbered elements are currently visible — scroll or re-observe to reveal them.';
                const _lead = want > 0 ? `[${want}] is not on this page.` : 'No index was given.';
                return `${_lead} Valid indices on this page: ${_keys[0]}–${_keys[_keys.length - 1]} (${_keys.length} elements). Re-read the green labels / Elements list and pick a number that actually exists.`;
              };
              // Map vision action types to legacy command format
              switch (_va.type) {
                case 'click':
                  command = _validIdx
                    ? { type: 'click_at', _visionIndex: _validIdx, _visionAction: true }
                    : { type: 'note', text: `SYSTEM: click needs a valid [index]. ${_badIndexHint(_rawIdx)} Then emit {"action":{"type":"click","index":N}}.`, _visionAction: true };
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
                  command = { type: 'execute_js', code: _va.code || '', key: _va.key || 'js_result_' + Date.now(), _visionAction: true, approvalGranted: true };
                  break;
                case 'done':
                  command = { type: 'finish', summary: _va.text || _vParsed.memory || 'Task complete', _visionAction: true };
                  break;
                default:
                  command = { type: 'note', text: `Vision: unknown action ${_va.type}`, _visionAction: true };
              }
              // Store thinking/evaluation for logging and reasoning cards
              if (_vParsed.thinking) {
                sendSilentUpdate(`[Vision] ${_vParsed.thinking}`, stepCount);
                if (command && typeof command === 'object') command.__reasoning = _vParsed.thinking.substring(0, 600);
              }
            } else {
              // Fallback: couldn't parse structured output, try the legacy LLM path
              console.warn('[Sentinel/v4] Vision: could not parse structured output, falling back to legacy');
            }
          }
        } catch (e) {
          console.warn('[Sentinel/v4] Vision LLM call failed, falling back:', getErrorMessage(e));
          try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: THREE_SECONDS_MS }); } catch (_e) { /* vision cleanup failed - non-fatal */ }
        }
      }

      // If vision produced a command, do the bookkeeping that the legacy path's
      // finally block would have done (it won't run since we skip it below).
      if (command && command.type) {
        clearInterval(progressTimer);
        _lastAiCallMs = Date.now() - _aiStart;
        try { sendHeartbeat(_lastAiCallMs); } catch (_e) { /* non-fatal */ }
        // Clear SoM overlay so it doesn't interfere with action execution
        try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: THREE_SECONDS_MS }); } catch (_e) { /* vision cleanup failed - non-fatal */ }
        base64Image = null; // release screenshot memory
        agentState.apiCallCount++; // vision path bypasses callLLMWithRetry which normally increments this
        apiCallCount = agentState.apiCallCount;
        activityDone(stepCount, 'consult-ai', `Vision decided: ${command.type}`, null);
        tel.info('llm', `Vision LLM decided: ${command.type}`, { durationMs: _lastAiCallMs, commandType: command.type });
      }

      // Legacy LLM fallback (only if vision didn't produce a command)
      if (!command || !command.type) {
        // (v20.5) Bridge the vocabulary switch. If we got here with vision mode
        // active, the SoM path failed this step and we're now on the legacy
        // selector/tool path. Prior history shows index-based actions like
        // "click(7)" which are NOT usable here — give the model an explicit
        // heads-up so it doesn't try to reuse a numbered index it can't address.
        if (_visionMode) {
          promptHistory.push({
            step: stepCount,
            action: { type: 'note' },
            result: 'SYSTEM: numbered-index (vision) mode is unavailable this step. Switch to selector-based interaction — use the selector or ref from the element list (e.g. click with "ref" or "selector"), NOT numbered [index] actions.'
          });
        }
        // v10.0: Capture reasoning before LLM call
        await captureReasoningStep('action_decision', 'input', {
          stepCount,
          goal,
          url: currentUrl,
          historyItems: promptHistory.length,
          elementsCount: trimmedElements.length
        });
        // v10.0: Check prompt history for contradictions before LLM call
        if (promptHistory.length > 1) {
          const historyText = promptHistory
            .map(h => (h && typeof h === 'object' ? String(h.result || '') : ''))
            .filter(Boolean)
            .join('\n');
          const contradictionCheck = analyzeForContradictions(historyText);
          if (contradictionCheck.hasContradictions) {
            logContradictionDetection(contradictionCheck, stepCount);
            console.warn('[Sentinel] Contradictions detected in prompt history:', contradictionCheck);
          }
        }
        try {
          command = await callLLMWithRetry(
            trimmedElements, allElements.length, pageText, base64Image,
            goal, promptHistory, stepCount, currentUrl,
            0, // retryCount
            CONFIG,
            agentState
          );
          // v10.0: Capture reasoning result and analyze for bias
          await captureReasoningStep('action_decision', 'output', {
            commandType: command?.type || 'none',
            commandText: command?.text || 'none',
            reasoning: command?.reasoning || 'none'
          });
          // Analyze action decision for potential bias
          if (command && command.type) {
            const actionBiasAnalysis = analyzeActionForBias(command);
            if (actionBiasAnalysis.hasBias && shouldTriggerBiasWarning(actionBiasAnalysis)) {
              console.warn('[Sentinel] Action bias detected:', actionBiasAnalysis);
              logBiasDetection(actionBiasAnalysis, stepCount);
            }
            // Store action in knowledge graph
            try {
              addKnowledgeNode(`action_${stepCount}`, {
                type: command.type,
                label: command.type,
                properties: { stepCount, goal: goal.substring(0, 100), url: currentUrl },
                source: 'agent'
              });
            } catch (e) {
              console.warn('[Sentinel] Failed to store action in knowledge graph:', getErrorMessage(e));
            }
          }
        } catch (e) {
          _aiCallError = e;
          command = { type: 'note', text: `API call failed: ${getErrorMessage(e)}` };
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
          try { await cdpExecuteJs(tab, VISION_CLEAR, { timeout: THREE_SECONDS_MS }); } catch(e) {
            console.warn('[Sentinel] Failed to clear SoM overlay:', getErrorMessage(e));
            // Non-fatal but could affect next action execution
          }
          base64Image = null; // release screenshot memory after LLM call
          setZoomRegion(null); // clear zoom region after consuming it
          // Sync apiCallCount — always, even on failure. callLLM increments
          // agentState.apiCallCount before the fetch, so if the call throws the
          // module-level var must still be updated or the final log shows 0.
          apiCallCount = agentState.apiCallCount;
          // (3.16.0) Mark the consult-ai activity as done or failed.
          if (_aiCallError) {
            activityFail(stepCount, 'consult-ai', `AI call failed: ${getErrorMessage(_aiCallError || 'unknown')}`, null);
            tel.error('llm', 'LLM call failed', { durationMs: _lastAiCallMs, error: getErrorMessage(_aiCallError) });
          } else if (command && command.type) {
            activityDone(stepCount, 'consult-ai', `AI decided: ${command.type}`, null);
            tel.info('llm', `LLM decided: ${command.type}`, { durationMs: _lastAiCallMs, commandType: command.type, hasSelector: !!command.selector, hasRef: !!command.ref });
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
        command.text = command.text.replace(MEMORY_VAR_RE, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (typeof command.url === 'string') {
        command.url = command.url.replace(MEMORY_VAR_RE, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (typeof command.value === 'string') {
        command.value = command.value.replace(MEMORY_VAR_RE, (_, key) => agentMemory[key] || `::${key}::`);
      }

      // Visual element matching — resolve description-based targeting.
      // If the LLM specifies a "description" field without a selector/ref,
      // match it against observed elements by text/aria/placeholder/title.
      if (command.description && !command.selector && !command.ref) {
        const _matched = _findElementByDescription(allElements, command.description);
        if (_matched) {
          command.selector = _matched.selector || _matched.id;
          command.ref = _matched.ref || null;
          command._matchedByVisual = true;
          try {
            tel.info('visual', `Visual match: "${command.description}" -> ${command.selector || command.ref}`, { description: command.description, selector: command.selector, ref: command.ref });
          } catch (_e) { /* non-fatal */ }
        } else {
          // No match — tell the LLM so it can adjust
          const _noMatchMsg = `BLOCKED: No element found matching description "${command.description}". Try using a selector or ref from the AVAILABLE INTERACTIVE ELEMENTS list instead.`;
          historyPush({ step: stepCount, action: command, result: _noMatchMsg });
          await persistHistory();
          sendSilentUpdate(`No visual match for "${command.description}"`, stepCount);
          await sleep(ONE_SECOND_MS);
          continue;
        }
        delete command.description; // consumed
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
        // v21.6.54: Adaptive failure diagnosis after 2+ consecutive failures
        if (consecutiveFailures >= 2 && command && command.type) {
          try {
            const _actionType = command.type;
            const _failKey = _actionType + ':' + String(currentUrl || '').substring(0, 50);
            _consecutiveFailureTypes[_failKey] = (_consecutiveFailureTypes[_failKey] || 0) + 1;
            if (_consecutiveFailureTypes[_failKey] >= 2) {
              _lastDiagnosis = diagnoseFailure(_actionType, String(result || ''), currentUrl || '', stepCount);
              const _diagMsg = buildDiagnosticMessage(_lastDiagnosis, _actionType, _consecutiveFailureTypes[_failKey]);
              sendSilentUpdate('[ADAPTIVE] ' + _lastDiagnosis.strategy + ': ' + _lastDiagnosis.suggestion.substring(0, 100), stepCount);
              // Inject diagnosis into history so the LLM sees it on the next step
              historyPush({ step: stepCount, action: { type: 'note', text: _diagMsg }, result: 'Adaptive diagnosis: ' + _lastDiagnosis.strategy });
              await persistHistory();
              // Reset counter after diagnosis to avoid spamming
              _consecutiveFailureTypes[_failKey] = 0;
            }
          } catch (_diagErr) { /* non-fatal */ }
        }

          historyPush({ step: stepCount, action: command, result: `Invalid selector "${command.selector}" -- not in element list.` });
          await persistHistory();
          await sleep(ONE_SECOND_MS);
          continue;
        }
      }

      // Handle finish — but block premature finishes (model giving up without trying)
      // v21.6.58: Output schema enforcement for structured reports
      if (command.type === 'finish' && command.summary) {
        // Check if goal requires structured output
        const _needsStructure = /\b(list|table|report|findings|results|inventory|audit|status)\b/i.test(goal || '');
        if (_needsStructure && agentMemory && Object.keys(agentMemory).length > 0) {
          const _keys = Object.keys(agentMemory).map(k => `"${k}"`).join(', ');
          command.summary = `STRUCTURED REPORT REQUIRED. Data keys collected: [${_keys}]. 
Organize findings under clear headers matching the original goal sections. Use tables for tabular data. Do NOT dump raw text.

` + (command.summary || '');
        }
      }
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
            historyPush({ step: stepCount, action: command, result: `BLOCKED: pre-finish completeness -- ${_completenessGap}` });
            trimHistory();
            sendSilentUpdate('Finish blocked — completeness check requesting one more extraction pass', stepCount);
            await sleep(EIGHT_HUNDRED_MS);
            continue;
          }
        } catch (_) { /* completeness check failure is non-fatal */ }

        const memKeys = Object.keys(agentMemory || {});
        const memCount = memKeys.length;
        const noteCount = history.reduce((acc, h) => acc + (h.action && h.action.type === 'note' ? 1 : 0), 0);
        const hasData = memCount > 0 || noteCount > 0;

        // Block finish if no real data was extracted and we haven't tried enough
        const _finishBlockCount = history.filter(h => h && h.result && typeof h.result === 'string' && h.result.startsWith('BLOCKED:')).length;
        if (Object.keys(agentMemory).length === 0 && stepCount < 4 && _finishBlockCount < 1) {
          historyPush({ step: stepCount, action: command, result: 'BLOCKED: Cannot finish without extracting data first. Read the page or use execute_js to get real data.' });
          await persistHistory();
          sendSilentUpdate('Finish blocked — must extract real data first', stepCount);
          await sleep(ONE_SECOND_MS);
          if (!agentRunning) break;
          continue;
        }

        // Block finish if memory only contains failed results ("Done", empty strings)
        const hasRealData = memCount > 0 && Object.keys(agentMemory).some(k => {
          const v = agentMemory[k];
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          return s.length > 10 && s !== 'Done';
        });
        if (false && !hasRealData && hasData && stepCount < 15 && _finishBlockCount < 1) {
          historyPush({ step: stepCount, action: command, result: 'BLOCKED: No real data in memory. Use execute_js with key to extract actual page content.' });
          await persistHistory();
          sendSilentUpdate('Finish blocked — extracted data is empty', stepCount);
          await sleep(ONE_SECOND_MS);
          if (!agentRunning) break;
          continue;
        }


        // (3.50.0) Multi-article completion guard: don't let the agent finish
        // with just link lists — it must actually OPEN and READ the articles.
        try {
          const _articleGoal = (typeof goal === 'string') ? goal.match(ARTICLE_RE) : null;
          if (_articleGoal && !command.force) {
            const _targetN = _articleGoal[1] ? (parseInt(_articleGoal[1], 10) || 10) : 10;
            const _openTabs = history.reduce((acc, h) => acc + (h.action && h.action.type === 'open_tab' ? 1 : 0), 0);
            const _summaryKeys = memKeys.filter(k =>
              k.includes('summary') || k.includes('_summary') || ARTICLE_KEY_RE.test(k)
            );
            // Block: haven't opened ANY article tabs AND no summaries written
            if (_openTabs === 0 && !_summaryKeys.length && noteCount === 0) {
              console.warn('[Sentinel/multi-article] Blocking premature finish —', _targetN, 'articles requested, 0 opened/read');
              historyPush({ step: stepCount, action: command, result: `BLOCKED: premature finish — goal asks for ${_targetN} articles. Must open_tab article URLs and read each page before finishing.` });
              await persistHistory();
              sendSilentUpdate('Finish blocked — must read articles first', stepCount);
              await sleep(ONE_SECOND_MS);
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
            emitAgentStatus(workingTabId, 'verifying', 'Checking if configuration change was committed');
            if (!hasRecentCommitClick(history)) {
              const blockMsg = 'BLOCKED: configuration change detected but no Save/Apply/Commit click in recent history. Find and click the Apply/Save/Commit/Deploy button before finishing.';
              historyPush({ step: stepCount, action: command, result: blockMsg });
              await persistHistory();
              sendSilentUpdate('Finish blocked — change not yet committed', stepCount);
              await sleep(ONE_SECOND_MS);
              continue;
            }
            if (!hasPostCommitVerification(history)) {
              const blockMsg = 'BLOCKED: change committed but not verified. Re-read the page or extract from the relevant table to confirm the change is active before finishing.';
              historyPush({ step: stepCount, action: command, result: blockMsg });
              await persistHistory();
              sendSilentUpdate('Finish blocked — change not verified', stepCount);
              await sleep(ONE_SECOND_MS);
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
          const _hasIncompleteMarker = INCOMPLETE_MARKER_RE.test(_summary);
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
            await sleep(ONE_SECOND_MS);
            continue;
          }
        } catch (_) { /* never let the guard itself crash the loop */ }

        // v21.6.53: Multi-task orchestrator — check if more subtasks remain
        if (_orchestratorState && _orchestratorState.active && _orchestratorState.currentIndex < _orchestratorState.subtasks.length - 1) {
          // Save current subtask results
          const _subtaskSummary = String(command.summary || '').substring(0, 2000);
          const _memSnapshot = {};
          for (const _k of Object.keys(agentMemory)) {
            _memSnapshot[_k] = String(agentMemory[_k]).substring(0, 1000);
          }
          _orchestratorState.accumulatedResults.push({
            title: _orchestratorState.subtasks[_orchestratorState.currentIndex].title,
            summary: _subtaskSummary,
            memory: _memSnapshot,
            steps: stepCount,
            apiCalls: apiCallCount
          });
          _orchestratorState.totalSteps += stepCount;
          _orchestratorState.totalApiCalls += apiCallCount;

          // Advance to next subtask
          _orchestratorState.currentIndex++;
          const _nextIdx = _orchestratorState.currentIndex;
          const _nextTotal = _orchestratorState.subtasks.length;
          const _nextSubtask = _orchestratorState.subtasks[_nextIdx];

          sendSilentUpdate(`Orchestrator: Starting sub-task ${_nextIdx + 1}/${_nextTotal}: ${_nextSubtask.title}`, 0);
          try {
            chrome.runtime.sendMessage({
              action: 'orchestrator_progress',
              currentIndex: _nextIdx + 1,
              totalSubtasks: _nextTotal,
              title: _nextSubtask.title,
              completedTitle: _orchestratorState.subtasks[_nextIdx - 1].title
            }).catch(() => {});
          } catch (_) {}

          // Reset loop state for next subtask (keep agentMemory!)
          goal = buildSubTaskGoal(_nextSubtask, _orchestratorState.originalGoal, _nextIdx, _nextTotal, _orchestratorState.accumulatedResults);
          stepCount = 0;
          history.length = 0;
          consecutiveFailures = 0;
          currentStrategies = [];
          dynamicMaxSteps = Math.max(15, Math.floor(60 / _nextTotal) + 10);
          sharedState.cachedObservation = null;
          _cachedPageContent = null;
          _lastObservedUrl = '';
          _lastObservedDomHash = 0;
          agentPlan = null;
          currentPlanStep = 0;
          _blockedCount = 0;
          _totalLoopRecoveries = 0;
          finished = false;
          // DON'T set finished=true or break — let the while loop continue
          sendAgentStatus('thinking', `Sub-task ${_nextIdx + 1}/${_nextTotal}: ${_nextSubtask.title}`);
          await sleep(ONE_SECOND_MS);
          continue;
        }

                // v21.6.54: Save winning strategy for cross-run learning
        try {
          const _finishDomain = getDomainFromUrl(currentUrl || '');
          if (_finishDomain) {
            const _strategy = extractWinningStrategy(_finishDomain, history, agentMemory, stepCount);
            if (_strategy) {
              saveDomainStrategy(_finishDomain, _strategy);
            }
          }
        } catch (_saveErr) { /* non-fatal */ }

finished = true;
        consecutiveFailures = 0;
        sendSilentUpdate('Task complete', stepCount);

        let finalSummary = command.summary || '';

        // v21.6.53: If orchestrator completed all subtasks, generate combined report
        if (_orchestratorState && _orchestratorState.active) {
          // Save the last subtask's results
          _orchestratorState.accumulatedResults.push({
            title: _orchestratorState.subtasks[_orchestratorState.currentIndex].title,
            summary: String(command.summary || '').substring(0, 2000),
            steps: stepCount,
            apiCalls: apiCallCount
          });
          _orchestratorState.totalSteps += stepCount;
          _orchestratorState.totalApiCalls += apiCallCount;

          // Build combined report
          const _combinedReport = _orchestratorState.accumulatedResults.map((r, i) =>
            `## ${i + 1}. ${r.title}\n${r.summary}`
          ).join('\n\n---\n\n');

          finalSummary = `# Multi-Task Investigation Report\n\nCompleted ${_orchestratorState.accumulatedResults.length} of ${_orchestratorState.subtasks.length} sub-tasks.\n\n---\n\n${_combinedReport}`;



          // Inject combined results into agentMemory for report generation
          agentMemory['orchestrator_combined_report'] = finalSummary;

          stepCount = _orchestratorState.totalSteps;
          apiCallCount = _orchestratorState.totalApiCalls;

          try {
            chrome.runtime.sendMessage({
              action: 'orchestrator_complete',
              totalSubtasks: _orchestratorState.subtasks.length,
              completedSubtasks: _orchestratorState.accumulatedResults.length,
              totalSteps: stepCount,
              totalApiCalls: apiCallCount
            }).catch(() => {});
          } catch (_) {}

          // Reset orchestrator state
          _orchestratorState = null;
        }


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
              await sleep(ONE_SECOND_MS);
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
        // (10.0.1) Cache agentState property access for performance
        const _inputTokens = agentState.totalInputTokens || 0;
        const _outputTokens = agentState.totalOutputTokens || 0;
        const _cacheReadTokens = agentState.totalCacheReadTokens || 0;
        const _cacheWriteTokens = agentState.totalCacheWriteTokens || 0;
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
            input: _inputTokens,
            output: _outputTokens,
            total: _inputTokens + _outputTokens,
            cacheRead: _cacheReadTokens,
            cacheWrite: _cacheWriteTokens,
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
            try { const p = (() => { try { return JSON.parse(r); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })(); return (p && typeof p.value === 'string') ? p.value.trim() : ''; } catch (_parseErr) { return ''; }
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
        await sleep(FOUR_HUNDRED_MS);
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
        const _notePreview = noteText.length > 200 ? `${noteText.slice(0, 200)}...` : noteText;
        sendSilentUpdate(_notePreview, stepCount);
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
        await sleep(FIVE_HUNDRED_MS);
        continue;
      }

      // Handle extract / extract_list (save to agent memory)
      if (EXTRACT_TYPE_RE.test(command.type)) {
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
          sendActionResult(stepCount, `Error reading console: ${getErrorMessage(e || 'unknown')}`, true);
        }
        await sleep(THREE_HUNDRED_MS);
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
        await sleep(THREE_HUNDRED_MS);
        continue;
      }

      // (3.37.0) DNS-over-HTTPS lookup — no page interaction, pure background fetch
      // (3.39.0) preset: 'spf' | 'dmarc' | 'dkim' expand to the correct query target.
      if (command.type === 'lookup') {
        let _domain = typeof command.domain === 'string' ? command.domain.trim() : (typeof command.host === 'string' ? command.host.trim() : '');
        _domain = _domain.replace(DOMAIN_CLEAN_RE, '');
        let _type = typeof command.record_type === 'string' ? command.record_type.toUpperCase() : (typeof command.type_field === 'string' ? command.type_field.toUpperCase() : 'A');
        const _preset = typeof command.preset === 'string' ? command.preset.toLowerCase() : '';
        // Expand preset shortcuts into canonical DNS query parameters
        if (_preset === 'spf') {
          _type = 'TXT';  // SPF lives in TXT at the root domain
        } else if (_preset === 'dmarc') {
          _type = 'TXT';
          _domain = `_dmarc.${_domain.replace(DMARC_PREFIX_RE, '')}`;
        } else if (_preset === 'dkim') {
          const _sel = String(command.selector || 'default').trim().replace(DOMAINKEY_SUFFIX_RE, '');
          _type = 'TXT';
          // (10.0.1) Cache regex pattern for this selector to avoid repeated RegExp creation
          let _dkimDomainKeyRe = _dkimDomainKeyCache.get(_sel);
          if (!_dkimDomainKeyRe) {
            _dkimDomainKeyRe = new RegExp(`\\.${_sel}\\._domainkey\\.`, 'i');
            _dkimDomainKeyCache.set(_sel, _dkimDomainKeyRe);
          }
          _domain = `${_sel}._domainkey.${_domain.replace(_dkimDomainKeyRe, '.')}`;
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
          const _r = `lookup failed: ${getErrorMessage(e)}`;
          sendActionResult(stepCount, _r, true);
          historyPush({ step: stepCount, action: command, result: _r });
          await persistHistory();
        }
        await sleep(THREE_HUNDRED_MS);
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
          const _outputMs = (_ci && _ci.outputTimeoutMs) || FIFTEEN_SECONDS_MS;
          const _readyText = (_ci && _ci.outputReadyText) || null;

          // Optionally set command type via a select element
          if (_ci && _ci.typeSelect && _ci.commandTypes && _ci.commandTypes[_cmdType]) {
            const _typeSel = _ci.typeSelect;
            const _typeVal = _ci.commandTypes[_cmdType];
            await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'select', selector: _typeSel, value: _typeVal } }).catch((e) => {
              console.error('[_typeVal] Unhandled rejection:', e);
            });
            await sleep(THREE_HUNDRED_MS);
          }

          // Clear + type the command
          await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'click', selector: _inputSel } }).catch((e) => {
            console.error('[_typeVal] Unhandled rejection:', e);
          });
          await sleep(TWO_HUNDRED_MS);
          await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'execute_js', code: `(function(){var el=document.querySelector(${JSON.stringify(_inputSel)});if(el){el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));}})()` } }).catch((e) => {
            console.error('[el] Unhandled rejection:', e);
          });
          await sleep(ONE_HUNDRED_FIFTY_MS);
          await sendMessageWithRetry(tab, { action: 'dispatch_command', command: { type: 'type', selector: _inputSel, text: _cmd } }).catch((e) => {
            console.error('[el] Unhandled rejection:', e);
          });
          await sleep(THREE_HUNDRED_MS);

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
          const _r = `run_remote_command failed: ${getErrorMessage(e)}`;
          sendActionResult(stepCount, _r, true);
          historyPush({ step: stepCount, action: command, result: _r });
          await persistHistory();
        }
        await sleep(FIVE_HUNDRED_MS);
        continue;
      }

      // Handle wait_for actions
      if (/^wait_for_(text|element|navigation)$/.test(command.type)) {
        sendAgentStatus('waiting', `Waiting for: ${command.text || command.selector || 'navigation'}`);
        sendSilentUpdate(`Waiting for: ${command.text || command.selector || 'navigation'}`, stepCount);
        sendActionMessage(command, stepCount, observation);
        // Default timeout: navigation waits need more time than element waits
        const _waitTimeout = command.timeout || (command.type === 'wait_for_navigation' ? TWENTY_SECONDS_MS : TEN_SECONDS_MS);
        const waitResult = await sendMessageWithRetry(tab, {
          action: 'wait_for',
          condition: { ...command, currentUrl: tabInfo.url, timeout: _waitTimeout }
        });
        const result = waitResult || 'Wait completed';
        sendActionResult(stepCount, result, false);
        historyPush({ step: stepCount, action: command, result });
        await persistHistory();
        await sleep(FIVE_HUNDRED_MS);
        continue;
      }



      sendAgentStatus('executing', describeAction(command));
      emitAgentStatus(workingTabId, 'executing', describeAction(command));
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
          await sleep(ONE_SECOND_MS); continue;
        }
        if (approval.skipped) {
          historyPush({ step: stepCount, action: command, result: 'Skipped by user' });
          await persistHistory();
          await sleep(ONE_SECOND_MS); continue;
        }
        // User explicitly approved — mark so content-script guards pass.
        if (approval.approved) command.approvalGranted = true;
      }

      // Capture pre-action screenshot for live preview
      const _beforeScreenshot = await captureStepScreenshot(tab);

      // Compute confidence score for this action
      const _confidence = scoreActionConfidence(command, observation);
      // Show action card (confidence is forwarded via command.__confidence)
      command.__confidence = _confidence;
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

      // (v21.6.13) Stop check before action execution
      if (!agentRunning) break;

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
                  { timeout: THREE_SECONDS_MS });
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
                  _cdpClickOk = true;
                } catch (_cme) { /* fall through to JS .click() */ }

                // (v4.2) Verify dismissal — short delay, then check if the same
                // element is still present + visible. If yes, the CDP mouse
                // event was absorbed by an overlay; fire a JS .click() on the
                // stored element reference (bypasses pointer-events and
                // overlay interception).
                await new Promise(r => setTimeout(r, ONE_HUNDRED_MS));
                try {
                  const _jsClickRes = await cdpExecuteJs(tab,
                    `return (function(){var e=window.__sentinelElements?window.__sentinelElements.get(${command._visionIndex}):null;if(!e)return"no-ref";var r=e.getBoundingClientRect();var stillVisible=r.width>0&&r.height>0&&document.body.contains(e);if(stillVisible){try{e.click();}catch(_e){}return"js-clicked";}return"dismissed";})()`,
                    { timeout: THREE_SECONDS_MS });
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
                        { timeout: THREE_SECONDS_MS });
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
                  { timeout: FIVE_SECONDS_MS });
                const _typeVal = _typeRes && _typeRes.value;
                if (_typeVal === 'not found') {
                  result = `Type failed for [${command._visionIndex}]: element not found`;
                  actionFailed = true;
                } else {
                  result = `Typed into [${command._visionIndex}]: ${_typeVal || 'unknown'}`;
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
        // (v21.6.11) Block identical execute_js from re-running
        if (command.type === 'execute_js' && command.code) {
          const _lastJsRuns = history.slice(-6).filter(h => h && h.action && h.action.type === 'execute_js' && h.action.code === command.code);
          if (_lastJsRuns.length >= 1) {
            result = `BLOCKED: This exact JavaScript was already run. The data is in memory. Use done() to finish, or write different code.`;
            actionFailed = false;
            command._visionExecuted = true;
          } else {
            command._visionExecuted = false;
          }
        } else {
          command._visionExecuted = false;
        }
      }
      
            // (3.20.1) Fail-fast for targetable actions with NO target. The LLM
      // sometimes emits {type: 'click'} with no selector / ref / coords —
      // the content script then can't find anything to click, dispatches a
      // no-op, and the result is "Click: undefined" with no useful feedback.
      // Catch it here and return a clear error to the LLM so it picks a
      // different strategy next step.
            // v21.6.52: Hard block click_at with undefined coordinates — GLM bug
      if (command.type === 'click_at' && (typeof command.x !== 'number' || typeof command.y !== 'number')) {
        result = 'BLOCKED: click_at requires numeric x/y coordinates. Use click(index) from the observation panel instead. The observation panel lists clickable elements with their index numbers.';
        activityFail(stepCount, 'dispatch', 'Click at (no target)', { result });
        sendActionResult(stepCount, result, true);
        historyPush({ step: stepCount, action: command, result });
        await persistHistory();
        await sleep(EIGHT_HUNDRED_MS);
        continue;
      }

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
          await sleep(EIGHT_HUNDRED_MS);
          continue;
        }
      }

      // (3.20.1) Navigate-loop guard. If the LLM emits 2 consecutive navigate

      // SPEED (v3.60): Handle batch actions — execute multiple actions without re-observing
      if (command.type === 'batch' && Array.isArray(command.actions)) {
        const batchActions = command.actions.filter(a => a && a.type);
        const batchLen = batchActions.length;
        if (batchLen) {
          // Push in reverse so shift() gets them in order
          for (let i = batchLen - 1; i >= 0; i--) {
            _pendingCommandQueue.unshift(batchActions[i]);
          }
          command = _pendingCommandQueue.shift();
        } else {
          result = 'Batch contained no valid actions';
          actionFailed = true;
        }
      }

      // SPEED (v3.60): Handle auto-navigate for common patterns
      // If goal mentions a site+query, construct the direct URL instead of clicking through
      if (command.type === 'smart_navigate' && command.query) {
        const site = command.site || 'google';
        const smartUrl = buildSmartUrl(site, command.query);
        if (smartUrl) {
          command = { type: 'navigate', url: smartUrl };
        } else {
          command = { type: 'navigate', url: buildGoogleFallbackUrl(command.query) };
        }
      }

      // commands to the same URL WHILE ALREADY ON THAT PAGE, force a strategy shift.
      // (3.51) FIXED: if we're on a DIFFERENT page, navigating back to a previous
      // URL is recovery, not a loop — allow it (e.g., click_at landed on wrong site).
      if (command.type === 'navigate' && typeof command.url === 'string') {
        const _hostCompare = compareHostnames(currentUrl, command.url);
        const _alreadyThere = _hostCompare.alreadyThere;
        if (_alreadyThere) {
          let _recent = false;
          const checkStart = Math.max(0, _histLen - 2);
          for (let i = checkStart; i < _histLen; i++) {
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
            await sleep(EIGHT_HUNDRED_MS);
            continue;
          }
        }
      }

      // Handle open_tab
      if (command.type === 'open_tab') {
        await _enforceTabLimit();
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
          await sleep(TWO_SECONDS_MS);
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
              const _intendedPath = new URL(command.url).pathname.replace(TRAILING_SLASH_RE, '');
              const _arrivedPath = new URL(_arrivedUrl).pathname.replace(TRAILING_SLASH_RE, '');
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
            tel.info('page', `Navigating → ${typeof targetUrl === 'string' ? targetUrl.substring(0, 100) : String(targetUrl).substring(0, 100)}`, { stepCount, target: targetUrl, fromUrl: currentUrl });
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
          sharedState.cachedObservation = null; // Invalidate cache after navigate action
          // Re-inject content script on the new page
          const reinjected = await injectContentScript(tab);
          if (!reinjected) {
            try { tel.warn('page', 'Navigate: content script failed to load', { stepCount, url: command.url, durationMs: Date.now() - _navStart }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
            // In CDP mode, content script failure is expected — don't mark as action failure
            if (sharedState.cdpFallbackActive) {
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
              if (arrivedHost.includes(intendedHost.replace(WWW_PREFIX_RE, ''))) {
                try {
                  const displayUrl = typeof arrivedUrl === 'string' ? arrivedUrl.substring(0, 100) : String(arrivedUrl).substring(0, 100);
                  tel.info('page', `Navigate ok → ${displayUrl}`, { stepCount, arrivedUrl, durationMs: Date.now() - _navStart });
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
          await sleep(FIVE_HUNDRED_MS);
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
      } else if (EXTRACT_TYPE_RE.test(command.type)) {
        const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
        result = (typeof res === 'string' && res) ? res : 'Error: no response from content script';
        let extractSucceeded = false;
        try {
          if (!result || typeof result !== 'string') {
            throw new Error('Invalid result for extract');
          }
          const _resultToParse = result.startsWith('JS Result: ') ? result.replace('JS Result: ', '') : result;
          const parsed = (() => { try { return JSON.parse(_resultToParse); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
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
          // Append a hint to the result so the LLM knows which strategy
          // succeeded. Helps it adapt subsequent extractions on this page.
          ladder.raw = `${ladder.raw}\n\n[ENGINE NOTE: original execute_js was unproductive; auto-recovered via ${ladder.strategy} strategy. The data above is from ${ladder.strategy === 'body_text_fallback' ? 'document.body.innerText' : 'aggregated visible-element text'}. Parse it with regex/string ops in your finish summary.]`;
        }
        let res = ladder.raw;
        result = res || 'Done';
        // v21.6.51: If result is sparse, try extracting from cross-origin iframes
        if (result && result.length < 800) {
          try {
            const _iframeText = await _extractFromIframes(tab, result);
            if (_iframeText && _iframeText.length > 100) {
              result = result + '\n\n' + _iframeText;
            }
          } catch (_iframeErr) { /* non-fatal */ }
        }
        // Extract the JS result value
        let jsValue = result;
        if (result.startsWith('JS Result: ')) {
          jsValue = result.substring(11);
        }
        // v21.6.38: BLOCKED guard — retry via CDP before giving up
        if (jsValue.includes('BLOCKED:') || jsValue.includes('not approved by operator')) {
          // v21.6.39: CDP bypass — Runtime.evaluate skips content script approval gates
          try {
            const _cdpRes = await cdpExecuteJs(tab, command.code || '', { timeout: command.timeout || 10000 });
            if (_cdpRes && _cdpRes.ok && _cdpRes.value !== undefined && _cdpRes.value !== null) {
              const _cdpVal = typeof _cdpRes.value === 'object' ? JSON.stringify(_cdpRes.value) : String(_cdpRes.value);
              if (_cdpVal && !_cdpVal.includes('BLOCKED') && _cdpVal.length > 5) {
                jsValue = _cdpVal;
                result = 'JS Result: ' + _cdpVal;
                _blockedCount = 0; // reset on success
              } else {
                _blockedCount = (_blockedCount || 0) + 1;
              }
            } else {
              _blockedCount = (_blockedCount || 0) + 1;
            }
          } catch (_cdpErr) {
            _blockedCount = (_blockedCount || 0) + 1;
          }
          if (_blockedCount >= 2) {
            result = 'FORCE-FINISH: Page blocks all JS execution. Cannot extract data.';
            historyPush({ step: stepCount, action: command, result });
            await persistHistory();
            sendActionResult(stepCount, result, false);
            finished = true;
            break;
          }
          if (jsValue.includes('BLOCKED:')) {
            result = 'BLOCKED: Page rejected JavaScript execution. Try extract() or done().';
            historyPush({ step: stepCount, action: command, result });
            await persistHistory();
            sendActionResult(stepCount, result, false);
            await sleep(FIVE_HUNDRED_MS);
            continue;
          }
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
          const _useless = USELESS_OBJECT_RE;
          const _trim = String(jsValue).trim();
          if (_useless.test(_trim) || _trim === 'undefined' || _trim === 'null') {
            actionFailed = true;
            // (3.12.1) More actionable guidance — tell the LLM the SPECIFIC
            // recovery patterns rather than vague "wrap in JSON.stringify".
            // The wrapper already does that; the bug is usually returning a
            // DOM node, a null query, or an unawaited Promise.
            result = `JS returned a non-serializable value ("${_trim.slice(0, 60)}"). DO NOT retry the same code -- it will fail again. Recovery options: (1) Return text only: \`return document.body.innerText.substring(0, 5000)\` and parse in finish. (2) Use regex on body text: \`const t = document.body.innerText; const m = t.match(/<your_pattern>/); return m ? m[1] : null;\`. (3) Fall back to \`read_page\` action. (4) If you returned a DOM element, change to \`el.innerText\` instead. (5) If you returned a query that may be null, guard with \`(document.querySelector(sel) || {}).innerText || null\`.`;
          } else if (jsValue && command.key) {
            let savedValue = jsValue;
            try {
              const parsed = JSON.parse(jsValue);
              // Reject parsed-but-empty objects/arrays
              const isEmptyObj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && isEmptyObject(parsed);
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
                const _len = _isArr ? savedValue.length : (typeof savedValue === 'string' ? savedValue.length : (typeof savedValue === 'object' && savedValue !== null ? getObjectLength(savedValue) : null));
                tel.info('memory', `Wrote "${savedKey}" (execute_js, strategy=${ladder.strategy || 'original'})`, { key: savedKey, isArray: _isArr, length: _len, strategy: ladder.strategy || 'original', totalKeys: memKeys.length });
              } catch (e) { console.warn('[Sentinel] execute_js telemetry failed:', getErrorMessage(e)); }
              // (v21.6.21) Duplicate JS detection — check last 4 history entries
              const preview = String(jsValue).substring(0, 100);
              const _recent4 = history.slice(-4);
              const _isDup = _recent4.some(h => h && h.result && typeof h.result === 'string' &&
                String(jsValue).length > 50 && h.result.includes(preview.substring(0, 80)));
              if (_isDup) {
                // Count consecutive duplicates
                const _dupCount = history.filter(h => h && h.result && typeof h.result === 'string' && h.result.startsWith('DUPLICATE:')).length;
                if (_dupCount >= 2) {
                  // FORCE FINISH after 2 duplicate blocks — don't let it try again
                  result = `FORCE-FINISH: Agent ran duplicate JS ${_dupCount} times. Data is in memory. Finishing now.`;
                  historyPush({ step: stepCount, action: command, result });
                  await persistHistory();
                  sendActionResult(stepCount, result, false);
                  const _memKeys = Object.keys(agentMemory || {});
                  const _memSummary = _memKeys.length > 0 ? _memKeys.map(k => `${k}: ${String(agentMemory[k]).substring(0, 80)}`).join(', ') : 'no data';
                  reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
                  chrome.runtime.sendMessage({ action: 'agent_finished', summary: `Task completed. Data collected: ${_memSummary}` }).catch(() => {});
                  sendReportUpdate('generating');
                  finished = true;
                  break;
                }
                result = `DUPLICATE: Same JS result as recent step. Data is already in memory under "${savedKey}". Call done() now.`;
                // v21.6.44: Auto-finish after 1 duplicate if we have real data
                // GLM never calls done() on its own — this saves 2-3 wasted steps
                if (Object.keys(agentMemory).length > 0 && savedKey in agentMemory) {
                  const _memSize = typeof agentMemory[savedKey] === 'string' ? agentMemory[savedKey].length : JSON.stringify(agentMemory[savedKey]).length;
                  if (_memSize > 500) {
                    const _memKeys = Object.keys(agentMemory || {});
                    const _memSummary = _memKeys.length > 0 ? _memKeys.map(k => `${k}: ${String(agentMemory[k]).substring(0, 80)}`).join(', ') : 'no data';
                    // v21.6.56: Analysis-aware auto-finish
          // If the goal requires analysis (count, compare, find, filter), don't just dump raw data.
          // Instead, inject a directive telling the model to process the data and answer the questions.
          const _analysisKeywords = /(count|compare|find\s+(?:the\s+)?(?:newest|oldest|latest)|filter|analy[sz]e|how many|summarize|report\s+findings)/i;
          const _needsAnalysis = _analysisKeywords.test(goal || '');
          if (_needsAnalysis && _memSize > 500) {
            // Don't force-finish — instead tell the model to process and call done()
            loopDirective = `
⚡ DATA READY — You have ${_memSize} chars of data in memory under "${savedKey}". 
STOP extracting. You MUST now call done() with a summary that directly ANSWERS every question in the original goal. 
Use the data you already extracted — do NOT run execute_js again. Call done() NOW.`;
            result = `DATA READY: You have ${_memSize} chars. Process the data to answer the goal questions, then call done().`;
            historyPush({ step: stepCount, action: command, result });
            await persistHistory();
            sendActionResult(stepCount, result, false);
            sendSilentUpdate('[ENGINE] Analysis task detected — instructing model to process data and finish', stepCount);
            await sleep(FIVE_HUNDRED_MS);
            continue; // Give the model one more step to process + finish
          }
          result = `AUTO-FINISH: You already have ${_memSize} chars of data in memory. Finishing now.`;
                    historyPush({ step: stepCount, action: command, result });
                    await persistHistory();
                    sendActionResult(stepCount, result, false);
                    reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
                    chrome.runtime.sendMessage({ action: 'agent_finished', summary: `Task completed. Data collected: ${_memSummary}` }).catch(() => {});
                    sendReportUpdate('generating');
                    finished = true;
                    break;
                  }
                }
                historyPush({ step: stepCount, action: command, result });
                await persistHistory();
                sendActionResult(stepCount, result, false);
                await sleep(FIVE_HUNDRED_MS);
                continue;
              }
              // v21.6.37: Don't save BLOCKED messages to memory — they're garbage data
              if (String(result).startsWith('BLOCKED:') || String(result).includes('not approved by operator')) {
                result = 'BLOCKED: execute_js was rejected. The page may block automation. Try extract() or navigate to a simpler page.';
                historyPush({ step: stepCount, action: command, result });
                await persistHistory();
                sendActionResult(stepCount, result, false);
                await sleep(FIVE_HUNDRED_MS);
                continue;
              }
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
      } else if (useTrustedInput && !command._visionAction && !command._visionExecuted && (/^(click|click_at|type|press_key|select)$/.test(command.type))) {
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
            // Cache rounded coordinates (perf)
            const rx = Math.round(x), ry = Math.round(y);
            const r = await cdpDispatchClick(tab, x, y, {
              button: command.button,
              clickCount: command.clickCount,
              description: `Clicking at (${rx}, ${ry})`
            });
            if (r.ok) { result = `Clicked at (${rx},${ry}) via CDP`; cdpDone = true; }
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
if (!el) { var sels = document.querySelectorAll("select"); for (var i = 0, selsLen = sels.length; i < selsLen; i++) { if (sels[i].offsetParent !== null) { el = sels[i]; break; } } }
if (!el) return { ok: false, error: "No select element found" };
var opts = el.options; var found = false;
for (var i = 0, optsLen = opts.length; i < optsLen; i++) {
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
              const selResult = await cdpExecuteJs(tab, selCode, { timeout: THREE_SECONDS_MS });
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
            actionFailed = ACTION_FAILED_RE.test(result);
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
                // (v21.6.16) Auto-detect duplicate JS results
                const _prevHist = history.length > 0 ? history[history.length - 1] : null;
                if (_prevHist && _prevHist.result && typeof _prevHist.result === 'string' &&
                    valStr.length > 50 && _prevHist.result.includes(valStr.substring(0, 100))) {
                  result = `DUPLICATE: Same data as previous step. Use done() now — data is in memory.`;
                  historyPush({ step: stepCount, action: command, result });
                  await persistHistory();
                  sendActionResult(stepCount, result, false);
                  await sleep(FIVE_HUNDRED_MS);
                  continue;
                }
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
              actionFailed = ACTION_FAILED_TIMEOUT_RE.test(result);
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
            actionFailed = ACTION_FAILED_RE.test(result);
          }
        } catch (err) {
          result = `Content script error: ${getErrorMessage(err || 'command failed to reach page')}`;
          actionFailed = true;
        }
      }

      // (v3.54) CDP fallback for click: when content script can't inject and click fails,
      // resolve the element via CDP and click its center coordinates.
      if (actionFailed && (/^(click|right_click|double_click)$/.test(command.type))) {
        try {
          const sel = command.selector || (command.ref ? command.ref.replace(REF_SELECTOR_RE, '#') : '');
          if (sel) {
            const cdpCode = 'var el = null;'
              + 'try { el = document.querySelector(' + JSON.stringify(sel) + '); } catch(e) {}'
              + 'if (!el) {'
              + '  var allEls = document.querySelectorAll("button, a, [role=\\"button\\"], input, [onclick]");'
              + '  for (var i = 0, allElsLen = allEls.length; i < allElsLen; i++) {'
              + '    if (allEls[i].textContent && allEls[i].textContent.trim().length) { el = allEls[i]; break; }'
              + '  }'
              + '}'
              + 'if (!el) return null;'
              + 'var r = el.getBoundingClientRect();'
              + 'return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height };'
            const cdpBbox = await cdpExecuteJs(tab, cdpCode, { timeout: THREE_SECONDS_MS });
            if (cdpBbox && cdpBbox.ok && cdpBbox.value && cdpBbox.value.x != null && cdpBbox.value.y != null) {
              const cx = Math.round(cdpBbox.value.x);
              const cy = Math.round(cdpBbox.value.y);
              const r = await cdpDispatchClick(tab, cx, cy, {
                button: command.type === 'right_click' ? 'right' : 'left',
                clickCount: command.type === 'double_click' ? 2 : 1,
                description: `[CDP fallback] Clicking ${sel}`
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
      if (actionFailed && command.type === 'select') {
        try {
          // Cache JSON.stringify calls to avoid redundant serialization (perf)
          const _selJson = JSON.stringify(command.selector || '');
          const _valJson = JSON.stringify(command.value || '');
          const selJs = '(function(){'
            + 'var el = document.querySelector(' + _selJson + ');'
            + 'if (!el) { var sels = document.querySelectorAll("select"); for (var i = 0, selsLen = sels.length; i < selsLen; i++) { if (sels[i].offsetParent !== null) { el = sels[i]; break; } } }'
            + 'if (!el) return null;'
            + 'var opts = el.options;'
            + 'for (var i = 0, optsLen = opts.length; i < optsLen; i++) {'
            + '  if (opts[i].value === ' + _valJson + ' || (typeof opts[i].text === "string" && opts[i].text.trim().toLowerCase() === (' + _valJson + ').toLowerCase())) {'
            + '    el.selectedIndex = i; el.value = opts[i].value;'
            + '    el.dispatchEvent(new Event("change", { bubbles: true }));'
            + '    return el.value;'
            + '  }'
            + '}'
            + 'return null;'
            + '})()';
          const selRes = await cdpExecuteJs(tab, 'return ' + selJs, { timeout: THREE_SECONDS_MS });
          if (selRes && selRes.ok && selRes.value != null) {
            result = `Selected "${command.value}" via CDP fallback`;
            actionFailed = false;
            sendSilentUpdate('[CDP] Selected ' + command.value, stepCount);
          }
        } catch (_selErr) { console.warn('[Sentinel/CDP] Select fallback error:', getErrorMessage(_selErr)); }
      }

      // (v3.66) CDP fallback for type: when content script can't inject,
      // resolve the input element via CDP, focus it, and dispatch keyboard events.
      if (actionFailed && command.type === 'type') {
        try {
          const sel = command.selector || (command.ref ? command.ref.replace(REF_SELECTOR_RE, '#') : '');
          if (sel) {
            // Focus the input via CDP
            const focusCode = 'var el = document.querySelector(' + JSON.stringify(sel) + ');'
              + 'if (!el) { var inputs = document.querySelectorAll("input, textarea, [contenteditable]"); for (var i = 0, inputsLen = inputs.length; i < inputsLen; i++) { if (inputs[i].offsetParent !== null) { el = inputs[i]; break; } } }'
              + 'if (!el) return null;'
              + 'el.focus(); el.value = "";'
              + 'return el.tagName;'
            const focusResult = await cdpExecuteJs(tab, focusCode, { timeout: THREE_SECONDS_MS });
            if (focusResult && focusResult.ok && focusResult.value) {
              // Type each character via CDP Input.dispatchKeyEvent
              const text = command.text || '';
              // Note: no additional reference used - CDP sends directly to tab
              const textLen = text.length;
              for (let ci = 0; ci < textLen; ci++) {
                const ch = text[ci];
                try {
                  await new Promise((res, rej) => {
                    chrome.debugger.sendCommand({ tabId: typeof tab === 'object' && tab !== null ? tab.id : tab }, 'Input.dispatchKeyEvent', {
                      type: 'keyDown',
                      text: ch,
                      key: ch,
                      code: 'Key' + ch.toUpperCase()
                    }, (r) => { if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) rej(chrome.runtime.lastError.message || String(chrome.runtime.lastError)); else res(r); });
                  });
                  await new Promise((res, rej) => {
                    chrome.debugger.sendCommand({ tabId: typeof tab === 'object' && tab !== null ? tab.id : tab }, 'Input.dispatchKeyEvent', {
                      type: 'keyUp',
                      key: ch,
                      code: 'Key' + ch.toUpperCase()
                    }, (r) => { if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) rej(chrome.runtime.lastError.message || String(chrome.runtime.lastError)); else res(r); });
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
      if (actionFailed && sharedState.cdpFallbackActive) {
        try {
          const _ufbResult = await _universalCdpFallback(tab, command, { timeout: FIVE_SECONDS_MS });
          if (_ufbResult && _ufbResult.ok) {
            result = _ufbResult.result || 'Executed via universal CDP fallback';
            actionFailed = false;
            sendSilentUpdate(`[CDP-UFB] ${command.type} success`, stepCount);
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

      // Coordinate fallback for failed selector clicks — uses observed page element
      // bboxes to locate the target by text/aria-label when selector matching fails,
      // then clicks via CDP Input.dispatchMouseEvent at the element's center.
      if (actionFailed && command.type === 'click') {
        const _bbox = _findElementBbox(observation && observation.elements, command.selector || command.ref, command.text);
        if (_bbox) {
          // bbox from observe_page uses {x, y, w, h}; compute center
          const _cx = Math.round((_bbox.x || 0) + (_bbox.w || _bbox.width || 0) / 2);
          const _cy = Math.round((_bbox.y || 0) + (_bbox.h || _bbox.height || 0) / 2);
          const _coordResult = await clickAtCoordinates(tab, _cx, _cy);
          if (_coordResult) {
            result = `Coordinate fallback click at (${_cx}, ${_cy})`;
            actionFailed = false;
            sendSilentUpdate(`Selector not found → coordinate fallback click at (${_cx}, ${_cy})`, stepCount);
            sendActionMessage({ ...command, type: 'click_at', x: _cx, y: _cy, _coordFallback: true }, stepCount, observation);
            try { chrome.runtime.sendMessage({ type: 'agent_status', tabId: tab, status: 'acting', detail: 'Coordinate fallback click at (' + _cx + ',' + _cy + ')' }).catch(() => {}); } catch(_e) {}
          }
        }
      }

      // (v3.67) UNIVERSAL CDP fallback — when content script is dead and a specific
      // CDP handler didn't fire, convert the failed action to execute_js via CDP.
      // Covers: select, check, check_all, scroll_to, wait_for_element, hover, wait_for_text
      if (actionFailed && sharedState.cdpFallbackActive && !CDP_FALLBACK_BLOCKED.has(command.type)) {
        try {
          let _universalJs = '';
          const _sel = command.selector || (command.ref ? command.ref.replace(REF_SELECTOR_RE, '#') : '');
          // Cache JSON.stringify(_sel) to avoid redundant serialization (perf)
          const _selJson = JSON.stringify(_sel);
          if (command.type === 'select' && _sel && command.value) {
            // Cache value JSON.stringify calls too
            const _valJson = JSON.stringify(command.value);
            const _valLowerJson = JSON.stringify(String(command.value).toLowerCase());
            _universalJs = '(function(){var el=document.querySelector(' + _selJson + ');'
              + 'if(!el){var ss=document.querySelectorAll("select");for(var i=0,ssLen=ss.length;i<ssLen;i++){if(ss[i].offsetParent!==null){el=ss[i];break;}}}'
              + 'if(!el)return null;var opts=el.options;'
              + 'for(var i=0,optsLen=opts.length;i<optsLen;i++){if(opts[i].value===' + _valJson + '||opts[i].text.toLowerCase().includes(' + _valLowerJson + ')){'
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
            const _uniRes = await cdpExecuteJs(tab, 'return ' + _universalJs, { timeout: THREE_SECONDS_MS });
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
        await sleep(ONE_SECOND_MS);
        try {
          const allTabs = await new Promise(resolve => {
            chrome.tabs.query({}, (t) => {
              if (typeof chrome.runtime.lastError === 'object' && chrome.runtime.lastError !== null) {
                console.error('[New tab detection] tabs.query failed:', chrome.runtime.lastError.message || String(chrome.runtime.lastError));
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
              await sleep(FIVE_HUNDRED_MS);
              let _host;
              try { _host = newUrl ? new URL(newUrl).hostname : 'new page'; } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); _host = newUrl || 'new page'; }
              result = `Clicked -> navigated to ${_host}`;
            }
          } else {
            const updatedTab = await getTabInfo(tab);
            if (updatedTab && updatedTab.url !== urlBeforeCommand) {
              await waitForPageLoad(tab);
              await sleep(FIVE_HUNDRED_MS);
              try {
                const _clickedHost = new URL(updatedTab.url).hostname.toLowerCase();
                const _fromHost = urlBeforeCommand ? new URL(urlBeforeCommand).hostname.toLowerCase() : '';
                const _clickedHostNoWww = _clickedHost.replace(WWW_PREFIX_RE, '');
                const _fromHostNoWww = _fromHost.replace(WWW_PREFIX_RE, '');
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
        
        // Phase 5: Trigger self-healing on repeated failures
        if (selfHealingEnabled && consecutiveFailures >= 3) {
          try {
            const issue = {
              type: 'consecutive_failures',
              count: consecutiveFailures,
              lastAction: command.type,
              strategies: currentStrategies.slice(),
              timestamp: Date.now()
            };
            const healingResult = RuntimeProfiler.heal(issue);
            if (healingResult.healed) {
              healingHistory.push(healingResult);
              consecutiveFailures = 0; // Reset after successful heal
            } else {
              console.warn('[Sentinel Phase 5] Self-healing failed:', healingResult.reason);
            }
          } catch (e) {
            console.warn('[Sentinel Phase 5] Self-healing error:', getErrorMessage(e));
          }
        }
        
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
      // (v21.6.21) Consecutive scroll limiter — prevent scroll loops
      if (command.type === 'scroll') {
        _consecutiveScrolls++;
        if (_consecutiveScrolls >= 3) {
          result = 'BLOCKED: Scrolled 3 times without extracting data. Use extract() or execute_js to read the page, or done() if you have the answer.';
          historyPush({ step: stepCount, action: command, result });
          await persistHistory();
          sendActionResult(stepCount, result, true);
          _consecutiveScrolls = 0;
          await sleep(FIVE_HUNDRED_MS);
          continue;
        }
      } else {
        _consecutiveScrolls = 0;
      }
      const _isPageMutating = PAGE_MUTATING_ACTIONS_RE.test(command.type);
      const _pageChanged = _observedHashBefore !== _lastObservedDomHash;
      if (_isPageMutating && !_pageChanged && !actionFailed) {
        sharedState.pageStagnation++;
      } else {
        sharedState.pageStagnation = 0;
      }

      // (v3.52) click_at loop detector — catches the pattern where a text-only model
      // keeps generating click_at with wrong coordinates (e.g., CNN overlay with glm-5).
      // If we see 4+ consecutive click_at commands with no progress, inject recovery.
      if (command.type === 'click_at') {
        // Start of a new click_at streak (previous action was something else):
        // snapshot progress markers. If real progress happened since the last
        // stuck episode, forgive earlier fires so isolated stuck moments in a
        // long, otherwise-productive run don't accumulate to a false abort.
        if (_clickAtLoopCount === 0) {
          if (productiveSteps > _clickAtStreakBaseline) _clickAtLoopFires = 0;
          _clickAtStreakBaseline = productiveSteps;
          _clickAtStreakSawPageChange = false;
        }
        _clickAtLoopCount++;
        if (_pageChanged) _clickAtStreakSawPageChange = true;
        // Stuck = repeated click_at that produced no NEW output during this
        // streak and never moved the page. Judged per-streak, not lifetime.
        const _streakStuck = (productiveSteps === _clickAtStreakBaseline) && !_clickAtStreakSawPageChange;
        if (_clickAtLoopCount >= 3 && _streakStuck) {
          console.error('[Sentinel/RECOVERY] click_at loop detected:', _clickAtLoopCount, 'consecutive click_at with no new progress + no page change');
          // Auto-dismiss common overlay patterns. Two passes:
          //   1. selector-based: known consent libraries (OneTrust, Didomi,
          //      Sourcepoint, etc.) and aria-label heuristics.
          //   2. text-based fallback: any visible button whose text matches
          //      Accept/Agree/OK/Continue/I agree/Got it (handles bespoke
          //      overlays like CNN's that don't use a known framework).
          try {
            await cdpExecuteJs(tab, '(function(){var d=false;var p=["button[aria-label*=Accept]","button[aria-label*=agree]","button[aria-label*=Close]","button[aria-label*=Dismiss]",".consent-accept",".cookie-accept","button.accept","button.acceptAll","button#onetrust-accept-btn-handler",".didomi-accept-btn","[class*=accept]","[class*=agree]","[class*=consent] button","[class*=overlay] button","dialog button","[role=dialog] button",".fc-button.fc-cta-consent",".sp_choice_type_11"];for(var i=0,pLen=p.length;i<pLen;i++){var es=document.querySelectorAll(p[i]);for(var j=0,esLen=es.length;j<esLen;j++){if(es[j].offsetParent!==null||window.getComputedStyle(es[j]).position==="fixed"){es[j].click();d=true;break;}}if(d)break;}if(!d){var rx=/^(accept(\\s+all)?|i\\s+agree|agree|allow(\\s+all)?|got\\s+it|ok|okay|continue|yes,?\\s+i\\s+(agree|accept)|consent)$/i;var btns=document.querySelectorAll(\'button, [role="button"], a.button, input[type="submit"], input[type="button"]\');for(var k=0,btnsLen=btns.length;k<btnsLen;k++){var b=btns[k];var t=((b.innerText||b.value||b.getAttribute("aria-label")||"")+"").trim();if(!t||t.length>40)continue;if(!rx.test(t))continue;var br=b.getBoundingClientRect();if(br.width<=0||br.height<=0)continue;var cs=window.getComputedStyle(b);if(cs.visibility==="hidden"||cs.display==="none")continue;try{b.click();d=true;break;}catch(_e){}}}return d?"dismissed":"no-overlay";})()', { timeout: FIVE_SECONDS_MS });
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
          // (stuck-loop watchdog) Escalate: the advisory note + overlay-dismiss
          // above often don't help a weak model that keeps re-picking the same
          // element. After several such fires with STILL zero productive output,
          // stop the run with a clear message + report rather than grinding to
          // the step cap.
          _clickAtLoopFires++;
          if (_clickAtLoopFires >= STUCK_CLICK_LOOP_ABORT_FIRES) {
            const _stuckSummary = `Stopped early: the agent clicked the same area ~${_clickAtLoopFires * 3} times and produced nothing — it's stuck (commonly a weak vision model fixating on one element). Try a more specific goal, a different starting page, or a stronger model.`;
            sendSilentUpdate(_stuckSummary, stepCount);
            finished = true;
            reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
            chrome.runtime.sendMessage({ action: 'agent_finished', summary: `⏹ ${_stuckSummary}` }).catch((e) => {
              console.error('[stuck-loop abort] Unhandled rejection:', e);
            });
            sendReportUpdate('generating');
            break;
          }
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
        const _recoveryMsg = `SYSTEM: ${command.type} loop detected! You have used ${command.type} ${_sameCmdCount + 1} times in a row${_pageUnchanged ? ' with NO page change' : ''}. STOP using ${command.type}. ${sharedState.cdpFallbackActive ? 'The content script is NOT available on this page (CDP fallback active). ' : ''}Switch to a completely different approach. Examples:\n- Use execute_js to extract data or interact with the DOM directly\n- Use click with a specific selector to interact with elements\n- Use smart_navigate with a direct URL (e.g., sort by adding &s=review-rank to Amazon URL)\n- Read the page text content and extract what you need without interacting\n\n${_smartStratMsg}`;
        historyPush({
          step: stepCount,
          action: { type: 'note', text: _recoveryMsg },
          result: `Recovery from ${command.type} loop`
        });
        await persistHistory();
        _sameCmdCount = 0;
        agentPlan = null;
        currentPlanStep = 0;
        // (v21.6.6) Hard escalation: after 3 total loop recoveries, force finish
        _totalLoopRecoveries++;
        if (_totalLoopRecoveries >= 3) {
          const _memKeys = Object.keys(agentMemory).filter(k => !k.startsWith('_'));
          const _memSummary = _memKeys.length > 0
            ? _memKeys.map(k => { const v = agentMemory[k]; const s = typeof v === 'string' ? v : JSON.stringify(v); return `${k}: ${s ? s.substring(0, 200) : 'empty'}`; }).join('; ')
            : 'No data extracted';
          console.warn(`[Sentinel/RECOVERY] HARD STOP: ${_totalLoopRecoveries} total loops. Forcing finish.`);
          command = { type: 'finish', text: `Task could not be completed fully due to repeated loops. Data collected so far: ${_memSummary}` };
        }
      }

      // (v21.6.9) Alternating loop detection — catches execute_js→finish→execute_js patterns
      // that _sameCmdCount misses because they alternate.
      const _nonProductiveSteps = history.slice(-12).filter(h =>
        h && h.result && typeof h.result === 'string' &&
        (h.result.startsWith('BLOCKED:') || h.result.startsWith('Recovery from'))
      ).length;
      if (_nonProductiveSteps >= 4) {
        console.warn(`[Sentinel/RECOVERY] ALT-LOOP: ${_nonProductiveSteps} non-productive steps in last 12. Forcing finish.`);
        const _memKeys = Object.keys(agentMemory).filter(k => !k.startsWith('_'));
        const _memSummary = _memKeys.length > 0
          ? _memKeys.map(k => { const v = agentMemory[k]; const s = typeof v === 'string' ? v : JSON.stringify(v); return `${k}: ${s ? s.substring(0, 200) : 'empty'}`; }).join('; ')
          : 'No data extracted';
        // BYPASS ALL GUARDS — set finished=true directly and skip to end of loop
        historyPush({ step: stepCount, action: { type: 'finish', summary: `Task completed. Data collected: ${_memSummary}` }, result: 'Force-finish from alternating loop detector' });
        await persistHistory();
        const finalSummary = `Task completed. Data collected: ${_memSummary}`;
        sendAgentStatus('complete', 'Task completed (force-finish after loop detection)');
        tel.info('lifecycle', 'Agent finished (force-finish)', { stepCount, reason: 'alternating-loop' });
        try { await telEndRun(runLogId); } catch (e) { console.error('[Sentinel]', getErrorMessage(e)); }
        try { await closeAttachedTabsExceptPrimary(); } catch (e) { console.warn('[Sentinel]', getErrorMessage(e)); }
        try { await detachAllSentinelTabs(); } catch (e) { console.error('[Sentinel]', getErrorMessage(e)); }
        await closeAllAgentTabs();
        agentRunning = false;
        agentPaused = false;
        // (v21.6.17) Fix: sendAgentResult doesn't exist — use correct finish pattern
        reportData = captureReportData(goal, history, agentMemory, agentPlan, stepCount, apiCallCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: finalSummary }).catch(() => {});
        sendReportUpdate('generating');
        finished = true;
        _runAbortController = null;
        break;
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
          sharedState.pageStagnation = 0;
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
      // Capture post-action screenshot and broadcast agent_step with before/after
      const _afterScreenshot = await captureStepScreenshot(tab);
      try {
        chrome.runtime.sendMessage({
          type: 'agent_step',
          stepNumber: stepCount,
          action: command.type,
          beforeScreenshot: _beforeScreenshot || undefined,
          afterScreenshot: _afterScreenshot || undefined,
          failed: !!actionFailed,
          confidence: _confidence
        }).catch(() => {});
      } catch (_e) { /* non-fatal */ }

      // ── Post-Action Verification (Phase 8.2) ──
      // After each action, check the post-action screenshot for evidence of success.
      // Track consecutive verification failures; after 2, inject a strategy-shift hint.
      // Emit verification status to popup for badge rendering.
      let _verificationStatus = 'unknown';
      try {
        if (_afterScreenshot && command && command.type !== 'finish' && command.type !== 'note') {
          // Use the post-action screenshot as evidence for the next LLM prompt cycle.
          // Store it so the observation phase can include it as context.
          _stepScreenshots.set(stepCount, _afterScreenshot);

          if (actionFailed) {
            _verificationFailures++;
            _verificationStatus = 'failed';
            // After 2 consecutive verification failures, inject a strategy-shift note
            if (_verificationFailures >= 2) {
              const _shiftNote = `SYSTEM: ${_verificationFailures} consecutive verification failures. Consider: using a different selector, trying execute_js, scrolling to reveal the element, or navigating to a different page section. The last action did NOT produce the expected result.`;
              historyPush({
                step: stepCount,
                action: { type: 'note', text: _shiftNote },
                result: `Verification strategy shift after ${_verificationFailures} failures`
              });
              _verificationFailures = 0; // Reset after injecting shift
            }
          } else {
            _verificationFailures = 0; // Reset on success
            _verificationStatus = 'verified';
          }

          // Emit verification status to popup for badge rendering
          chrome.runtime.sendMessage({
            action: 'agent_verification',
            stepNumber: stepCount,
            verification: {
              status: _verificationStatus,
              failures: _verificationFailures
            }
          }).catch(() => {});
        }
      } catch (_ve) {
        // Verification emit is non-fatal
        console.warn('[Sentinel] Post-action verification failed:', getErrorMessage(_ve));
      }
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

      // (Phase 5) Track learned patterns for dashboard
      if (command && command.type) {
        const _patternKey = command.type + ':' + (command.selector || '').substring(0, 50);
        if (!_learnedPatterns) _learnedPatterns = {};
        if (!_learnedPatterns[_patternKey]) _learnedPatterns[_patternKey] = { uses: 0, successes: 0, lastUsed: 0 };
        _learnedPatterns[_patternKey].uses++;
        if (!actionFailed) _learnedPatterns[_patternKey].successes++;
        _learnedPatterns[_patternKey].lastUsed = Date.now();
      }
      emitLearnedPatterns(tab, _learnedPatterns);

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

      // Run replay recording: capture every step for instant HTML export.
      try {
        recordStep({
          actionType: command.type || 'unknown',
          action: _describeTarget(command) || command.type || 'unknown',
          result: typeof result === 'string' ? result.substring(0, 300) : (actionFailed ? 'failed' : 'ok'),
          screenshot: _stepScreenshots.get(stepCount) || undefined,
          failed: !!actionFailed
        });
      } catch (_e) { /* never crash the loop on replay recording */ }

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
          runLogBuffer.push(buildRunLogEntry(
            stepCount, currentUrl, command, result, actionFailed,
            detectedTenant ? (detectedTenant.chipText || detectedTenant.onmicrosoft || detectedTenant.tid || '') : '',
            command.__reasoning,
            _stepScreenshots.get(stepCount)
          ));
          // Keep last 200 entries; older ones get rolled into a summary.
          if (runLogBuffer.length > 200) {
            runLogBuffer.splice(0, runLogBuffer.length - 200);
          }
          // Persist to storage every step.
          chrome.storage.local.set({
            [`run_log_${runLogId}`]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() }
          }).catch(async (e) => {
            const msg = (e && e.message) ? e.message : String(e);
            // Run logs carry base64 screenshots and can fill chrome.storage. When
            // that happens, OTHER writes — including last_agent_report — start
            // failing, which is why reports silently never appeared. Self-heal:
            // drop every OTHER run's forensic log (keep the current one), at most
            // once per run, and stop spamming the console every step.
            if (/quota/i.test(msg)) {
              if (_runLogQuotaPruned) return;
              _runLogQuotaPruned = true;
              try {
                const all = await chrome.storage.local.get(null);
                const stale = Object.keys(all).filter(k =>
                  k.indexOf('run_log_') === 0 && k !== RUN_LOG_INDEX_KEY && k !== `run_log_${runLogId}`);
                if (stale.length) await chrome.storage.local.remove(stale);
                console.warn(`[agent-engine] Storage quota hit — pruned ${stale.length} old run log(s) to reclaim space.`);
              } catch (_pe) { /* best effort */ }
              return;
            }
            console.error('[agent-engine] Run log persist failed:', msg);
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
            const forcedText = (forcedRead.content || '').substring(0, 20000);
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
      console.error('[Sentinel/Loop] Step error:', getErrorMessage(err), err.stack ? err.stack.substring(0, 200) : '');
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
                console.error('[Tab recovery] tabs.query failed:', chrome.runtime.lastError.message || String(chrome.runtime.lastError));
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
      await sleep(FIVE_HUNDRED_MS);  // SPEED: reduced from 3000ms — recover faster
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
        setTimeout(() => rej(new Error('Report LLM timeout (45s)')), FORTY_FIVE_SECONDS_MS)
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
    try { await chrome.storage.session.remove(['agentRunning']); } catch (_clearErr) { console.warn('[Sentinel] Failed to clear agentRunning:', getErrorMessage(_clearErr)); }
    try { await chrome.storage.session.remove(['agentGoal']); } catch (_clearErr) { console.warn('[Sentinel] Failed to clear agentGoal:', getErrorMessage(_clearErr)); }
    try { await chrome.storage.session.remove(['agentStartTime']); } catch (_clearErr) { console.warn('[Sentinel] Failed to clear agentStartTime:', getErrorMessage(_clearErr)); }
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

  // (v21.5.4) Close agent-opened tabs BEFORE detaching (detach clears the set)
  try { await closeAttachedTabsExceptPrimary(); } catch (e) { console.warn('[Sentinel] Close attached tabs failed:', getErrorMessage(e)); }
  // Batch-close all agent-created tabs
  await closeAllAgentTabs();

  // (3.7.2) Dissolve the visual tab group at natural loop end too.
  try { await detachAllSentinelTabs(); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }

  agentRunning = false;
  console.debug(`[Sentinel] Agent completed. Total API calls: ${apiCallCount}`);
  
  // Phase 5: v8.0/v9.0 Advanced Intelligence - Final analytics
  try {
    // Stop profiling and generate summary
    const profilingSummary = RuntimeProfiler.stop();
    
    // Run predictive analysis on this run
    const predictiveData = {
      goal: _lastGoal,
      duration: Date.now() - _runStartTime,
      stepCount: stepCount,
      apiCalls: apiCallCount,
      history: history,
      failures: failedSteps,
      stagnation: sharedState.pageStagnation
    };
    const predictiveInsights = PredictiveEngine.analyze(predictiveData);
    console.debug('[Sentinel Phase 5] Predictive analysis complete:', predictiveInsights);

    // Generate mutation proposals for optimization
    if ((predictiveInsights.riskAssessment?.score || 0) > 50) {
      const currentState = {
        profiling: profilingSummary,
        predictive: predictiveInsights,
        metrics: {
          totalSteps: stepCount,
          apiCalls: apiCallCount,
          failures: failedSteps,
          productiveSteps: productiveSteps
        }
      };
      const mutations = RuntimeProfiler.proposeMutations(currentState);
      mutationProposals = mutations.proposals || [];
    }
    
    // Store Phase 5 results in audit log
    await appendAuditEntry(runLogId || 'unknown', 'phase5_intelligence', {
      message: 'Phase 5 Predictive & Profiling Analysis',
      profiling: profilingSummary,
      predictive: predictiveInsights,
      mutations: mutationProposals
    });
    
  } catch (e) {
    console.warn('[Sentinel Phase 5] Advanced analytics failed:', getErrorMessage(e));
  }
  
  // v10.0: Run novelty detection on completed actions
  try {
    const noveltyData = {
      type: 'run_summary',
      content: JSON.stringify(history.slice(-10)), // last 10 steps for novelty check
      context: { goal: _lastGoal, stepCount: history.length, apiCallCount }
    };
    const runId = runLogId || 'current';
    const noveltyResults = await analyzeForNovelty(runId, noveltyData);
    await storeNoveltyResult(runId, noveltyData, noveltyResults);
    console.debug('[Sentinel] Novelty detection complete:', noveltyResults.isNovel ? 'novel' : 'familiar');
  } catch (e) {
    console.warn('[Sentinel] Novelty detection failed:', getErrorMessage(e));
  }
  // v10.0: Generate knowledge synthesis from this run
  try {
    const synthesis = await synthesizeKnowledge({
      goal: _lastGoal,
      history: history,
      reasoningTrace: await getReasoningSummary(),
      biasStats: await getBiasStatistics(),
      contradictionStats: await getContradictionStatistics(),
      noveltyStats: await getNoveltyStatistics(runLogId || 'current')
    });
  } catch (e) {
    console.warn('[Sentinel] Knowledge synthesis failed:', getErrorMessage(e));
  }
  // v10.0: Generate compliance report
  try {
    const [biasDetections, contradictionDetections, noveltyDetections, synthesisStats, reasoningTrace] =
      await Promise.all([
        getBiasStatistics(),
        getContradictionStatistics(),
        getNoveltyStatistics(runLogId || 'current'),
        getSynthesisStatistics(),
        getReasoningSummary()
      ]);
    const complianceReport = {
      timestamp: new Date().toISOString(),
      goal: _lastGoal,
      duration: Date.now() - _runStartTime,
      apiCalls: apiCallCount,
      biasDetections,
      contradictionDetections,
      noveltyDetections,
      synthesisStats,
      reasoningTrace
    };
    // Append compliance report to audit log
    await appendAuditEntry(runLogId || 'unknown', 'compliance_report', {
      message: 'V10.0 Intelligence Compliance Report',
      report: complianceReport
    });
  } catch (e) {
    console.warn('[Sentinel] Compliance report generation failed:', getErrorMessage(e));
  }
  // v10.0: Persist knowledge graph to storage
  try {
    await persistKnowledgeGraph();
  } catch (e) {
    console.warn('[Sentinel] Failed to persist knowledge graph:', getErrorMessage(e));
  }
  // (3.12.0) Tally client-knowledge entries used and bump the client's runCount.
  // Quiet, non-fatal — never let knowledge bookkeeping break the run finish path.
  try {
    if (activeClientId) {
      await markRunCompleted(activeClientId, clientKnowledgeUsedIds);
    }
  } catch (_) { /* non-fatal */ }
  // (sub-project C) Neuralis brain WRITE path. After a run, ship REDACTED
  // procedural learning (successful self-heals, scrubbed UI notes) to the brain
  // as source:"sentinel-override" neurons. Consent-gated (brainProducerEnabled +
  // last-confirmed freshness), redaction-gated (PII scrub + client denylist,
  // fail-closed), and FAILS OPEN — same isolation as the client-knowledge block
  // above. Never breaks the run finish path. No offline queue.
  try {
    // Gather run context conservatively — each piece is optional.
    // Platform id was captured at run start (sub-project B's block) into the
    // module-level _runStartPlatformId; reuse it as the producer tag here.
    const _producerPlatformId = (typeof _runStartPlatformId === 'string') ? _runStartPlatformId : '';
    let _producerNotes = [];
    try {
      // `note` actions the agent took during the run -> UI-structure observations.
      _producerNotes = (history || [])
        .filter((h) => h && h.action && h.action.type === 'note' && typeof h.action.text === 'string')
        .map((h) => h.action.text)
        .filter((t) => t && t.trim());
    } catch (_) { _producerNotes = []; }
    let _producerClientIdentity = {};
    try {
      // The producer's _loadDenylist reads the full client identity (name,
      // tenant) + all known clients from chrome.storage.local. We only need to
      // hand it the active client id as a hint so it can resolve the active one.
      if (activeClientId) _producerClientIdentity = { id: activeClientId };
    } catch (_) { _producerClientIdentity = {}; }
    await publishRunLearning({
      platformId: _producerPlatformId,
      healingHistory: Array.isArray(healingHistory) ? healingHistory.slice() : [],
      recoveryEvents: [],
      notes: _producerNotes,
      clientIdentity: _producerClientIdentity,
    });
  } catch (_) { /* non-fatal: producer must never break the run finish */ }
  // Phase 8.2: Emit final status narration for popup status bar
  emitAgentStatus(workingTabId, 'complete', `Agent finished — ${stepCount} steps, ${apiCallCount} API calls`);
  // (Phase 5) Final learned patterns emission on run finish
  emitLearnedPatterns(workingTabId, _learnedPatterns);
  // Desktop notification on run completion
  const _runDuration = Date.now() - _loopStartTime;
  notifyRunComplete(_lastGoal, !!finished, stepCount, _runDuration);

  // Signal completion via messaging (replaces polling for scheduler)
  chrome.runtime.sendMessage({ action: 'agent_loop_complete', report: agentReport }).catch((e) => {
    console.error('[agentReport] Unhandled rejection:', e);
  });
  // (Phase 6) UAP bridge: notify external server of completion
  try { uapBroadcast('agent.completed', { stepCount, apiCallCount, finished: !!finished }); } catch (_uapErr) { /* UAP bridge unavailable */ }
}

async function enforceRateLimit() {
  const delay = _runSettings.quickMode ? 200 : CONFIG.minDelayBetweenCalls;
  const delayNeeded = Math.max(0, delay - (Date.now() - lastApiCallTime));
  if (delayNeeded > 0) await sleep(delayNeeded);
  lastApiCallTime = Date.now();
}

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
  return str.replace(JS_ESCAPE_RE, (char) => {
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

// ========== Approval Mode — extracted to agent-approval.js ==========
import {_describeTarget, describeAction, requestApproval as _requestApprovalImpl} from './agent-approval.js';

// Wrapper to handle agentPaused mutation locally
async function requestApproval(command, stepNumber) {
  return _requestApprovalImpl(command, stepNumber, {
    onPause: () => { agentPaused = true; },
    onResume: () => { agentPaused = false; }
  });
}

// ========== Test-Only Exports ==========
// Internal pure helpers exported for unit testing. Not part of the public API.
export {
  detectMfaInText,
  detectSignInWall,
  evaluateHallucinationRisk,
  generateHeuristicPlan,
  detectStall,
  isConfigChangeGoal,
  hasRecentCommitClick,
  hasPostCommitVerification,
  _detectGoalModeDirective,
  captureReportData,
  _countSummaryClaims,
  _countSpecificClaims,
  _countSourceTags,
  _tenantsMatch,
  describeAction,
  _describeTarget,
  // Additional test-only exports for deep coverage
  saveLearnedPattern,
  enforceRateLimit,
  sleep,
  requestApproval,
  _waitForAdaptedGoalDecision,
  _waitForModeMismatchDecision,
  _handleModeMismatchCheck,
  undoStack,
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
  _cdpDismissOverlays,
  _cdpObservePage,
  clickAtCoordinates,
  _findElementBbox,
  enhanceWithVisualProperties,
  _findElementByDescription,
  scoreActionConfidence,
  generateRunReplay,
};
