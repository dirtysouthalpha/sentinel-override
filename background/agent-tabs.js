// agent-tabs.js — Tab group management, side panel scoping, CDP fallback observation.
// Extracted from agent-engine.js to reduce monolith size.
// All shared state is centralized via agent-shared-state.js.

import { sharedState } from './agent-shared-state.js';
import { getErrorMessage, sleep } from './error-utils.js';
import { tel } from './telemetry.js';
import { cdpExecuteJs, cdpDispatchClick, getTabInfo } from './tab-manager.js';
import { TWO_SECONDS_MS, THREE_SECONDS_MS, FIVE_SECONDS_MS, TWO_HUNDRED_MS, SIX_HUNDRED_MS, BATCH_MODE_CACHE_TTL_MS, API_CACHE_TTL_MS } from './constants.js';

// ========== Local State (moved from agent-engine.js) ==========
const agentAttachedTabs = new Set();
let agentTabGroupId = null;
let primaryPanelTabId = null;
let _observeCacheHits = 0;
const OVERLAY_ACCEPT_RE = /agree|accept|accept all|got it|ok|consent|allow|continue|proceed|yes|sure/i;
const SENTINEL_GROUP_TITLE = 'Sentinel';
const SENTINEL_GROUP_COLOR = 'orange';

// ========== Setter for primaryPanelTabId (called from agent-engine.js) ==========
export function setPrimaryPanelTab(tabId) {
  primaryPanelTabId = tabId;
}

// ========== Tab Group Attachment (3.7.2) ==========
// Visually link every tab the agent operates on into an orange "Sentinel"
// tab group, so the user sees a clear glowing strip above attached tabs in
// the Chrome tab bar. Pairs with per-tab sidePanel.setOptions to hide the
// side panel when the user clicks unrelated tabs.


export async function attachTabToSentinelGroup(tabId) {
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
    // (v20.1) The side panel is pinned to the single primary working tab. Newly
    // attached (agent-opened) tabs must NOT show it — enable on the primary tab,
    // explicitly disable on every other attached tab.
    try {
      await chrome.sidePanel.setOptions({ tabId, enabled: isPrimaryPanelTab(tabId), path: 'popup.html' });
    } catch (e) { console.warn('[Sentinel] Side panel scope failed (API unavailable?):', getErrorMessage(e)); }
  } catch (e) {
    console.warn('[Sentinel] attachTabToSentinelGroup failed:', getErrorMessage(e));
  }
}

export async function detachAllSentinelTabs() {
  // Ungroup every attached tab. Safe even if some are already gone.
  const ids = [...agentAttachedTabs];
  agentAttachedTabs.clear();
  agentTabGroupId = null;
  primaryPanelTabId = null; // (v20.1) run is over — release the pinned working tab
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
  // (v21.6) Do NOT re-enable the side panel globally — that causes it to show
  // on every tab. Per-tab settings remain as they were. The user opens the panel
  // by clicking the icon on whichever tab they want it on.
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

/**
 * Check if a tab is the primary "working" tab the current run was launched on.
 * (v20.1) During a run this is the ONLY tab that shows the side panel — agent-
 * opened tabs and tabs the user switches to are kept panel-free.
 * @param {number} tabId - Chrome tab ID to check.
 * @returns {boolean} True if tabId is the pinned working tab.
 */
export function isPrimaryPanelTab(tabId) {
  return primaryPanelTabId != null && tabId === primaryPanelTabId;
}

// ========== Side Panel Scoping (v3.53) ==========
// (v20.1) Enable the side panel only on the primary working tab, and disable it
// on every other currently-open tab. Called at run start so pre-existing tabs
// don't keep the panel from before the run began.
export async function _scopeSidePanelToPrimary() {
  if (primaryPanelTabId == null) return;
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (!tab.id) continue;
      try {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          enabled: tab.id === primaryPanelTabId,
          path: 'popup.html'
        });
      } catch (_e) { /* side panel may be unavailable in some contexts */ }
    }
  } catch (_e) { /* tab query failed non-critically */ }
}

export async function _enableSidePanelEverywhere() {
  // (v21.6) No-op: Do NOT enable the side panel on all tabs. This was causing
  // the panel to appear on tabs the user never opened it on. The panel should
  // only appear on tabs where the user explicitly clicked the extension icon.
  // Per-tab settings from the agent run remain scoped to agent-attached tabs.
}


// ========== CDP Fallback (v3.54) ==========
// When the content script can't inject (CSP, security headers, etc.), use CDP
// directly to observe the page, dismiss overlays, and execute commands.
// CDP bypasses CSP entirely — it's the same channel DevTools uses.

export async function _cdpObservePage(tabId, options = {}) {
  // (v3.57) Extract interactive elements and page text via CDP Runtime.evaluate
  // First, wait for DOM to be ready (document.body can be null on slow-loading pages)
  const waitCode = 'var body = document.body || document.documentElement;'
    + 'var title = document.title || "";'
    + 'var childCount = body ? body.childNodes.length : 0;'
    + 'return { hasBody: !!document.body, title: title, childCount: childCount, '
    + '  url: window.location.href, readyState: document.readyState };';

  // SPEED: Skip ready check if previous observe found page was loaded
  if (sharedState.pageWasReady) {
    // Skip page ready check - previous observe confirmed loaded
  } else try {
    const readyState = await cdpExecuteJs(tabId, waitCode, { timeout: 2000 });
    if (readyState && readyState.ok && readyState.value) {
      const r = readyState.value;
      // If page has no body and no children, wait a moment and try again
      if (!r.hasBody && r.childCount === 0) {
        try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
        await sleep(TWO_SECONDS_MS);
      }
      // If title is empty and URL is still about:blank or loading, wait
      if (!r.title && (r.url === 'about:blank' || r.url === '')) {
        try { tel.trace('sleep', 'Sleep 2000ms', { ms: 2000 }); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
        await sleep(TWO_SECONDS_MS);
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
    + '  for (var i = 0, elsLen = els.length; i < elsLen; i++) {'
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
    + '    for (var o = 0, overlayElsLen = overlayEls.length; o < overlayElsLen; o++) {'
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
    + '            for (var b = 0, buttonsLen = buttons.length; b < buttonsLen; b++) {'
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
  const _inBatchMode = options.inBatchMode || false;
  const _cacheTTL = _inBatchMode ? BATCH_MODE_CACHE_TTL_MS : API_CACHE_TTL_MS;
  if (sharedState.cachedObservation && sharedState.cachedObservation.url === currentUrl && (Date.now() - sharedState.cachedObservation.timestamp) < _cacheTTL) {
    _observeCacheHits++;
    return sharedState.cachedObservation;
  }
  const result = await cdpExecuteJs(tabId, code, { timeout: THREE_SECONDS_MS });
  if (result?.ok && result?.value) {
    sharedState.pageWasReady = true; // Mark page as ready for next step
    return result.value;
  }
  return null;
}

export async function _cdpDismissOverlays(tabId, overlays) {
  // (v3.56) Nuclear overlay annihilator — 3 phases, no mercy
  let totalRemoved = 0;

  // Phase 1: Click accept/agree buttons if we have overlay detection data
  if (overlays && overlays.length) {
    for (const overlay of overlays) {
      const buttons = Array.isArray(overlay.buttons) ? overlay.buttons : [];
      // Single-pass button selection: prefer accept button, fallback to any button with text
      let dismissBtn = null;
      for (const b of buttons) {
        if (b && OVERLAY_ACCEPT_RE.test(b.text)) {
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
        const r = await cdpDispatchClick(tabId, dismissBtn.x, dismissBtn.y, { skipVisual: true });
        if (r && r.ok) totalRemoved++;
        await new Promise(r => setTimeout(r, SIX_HUNDRED_MS));
      }
    }
  }

  // Phase 2: Remove ALL iframes (consent dialogs are almost always in iframes)
  // and remove ANY fixed/absolute element with high z-index covering significant screen area
  const nukeCode = [
        'var n = 0;',
        'var btns = document.querySelectorAll("button, a, [role=\\"button\\"], input[type=\\"submit\\"]");',
        'var consentClicked = false;',
        'for (var b = 0, btnsLen = btns.length; b < btnsLen; b++) {',
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
        '  for (var s = 0, overlaySelsLen = overlaySels.length; s < overlaySelsLen; s++) {',
        '    try {',
        '      var els = document.querySelectorAll(overlaySels[s]);',
        '      for (var j = 0, elsLen = els.length; j < elsLen; j++) { els[j].remove(); n++; }',
        '    } catch(e) {}',
        '  }',
        '}',
        'if (!consentClicked && n === 0) {',
        '  var allDivs = document.querySelectorAll("div, section, aside, dialog");',
        '  for (var k = 0, allDivsLen = allDivs.length; k < allDivsLen; k++) {',
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
  if (!overlays.length && sharedState.lastNukeClean) {
    // Skip nuke - no overlays and last nuke was clean
  } else try {
    const nukeResult = await cdpExecuteJs(tabId, nukeCode, { timeout: FIVE_SECONDS_MS });
    if (nukeResult && nukeResult.ok) {
      const removed = (nukeResult.value || 0);
      totalRemoved += removed;
      sharedState.lastNukeClean = (removed === 0); // Track for skip optimization
      // (v3.59) Post-nuke integrity check: verify page still has content
      if ((nukeResult.value || 0) > 0) {
        const integrityCheck = await cdpExecuteJs(tabId, 'return { hasBody: !!document.body, title: document.title || "", url: window.location.href };', { timeout: THREE_SECONDS_MS });
        if (integrityCheck && integrityCheck.ok && integrityCheck.value) {
          if (!integrityCheck.value.hasBody || !integrityCheck.value.title) {
            console.warn('[Sentinel/CDP] Nuke destroyed page content — reloading via CDP...');
            try {
              await chrome.debugger.sendCommand({ tabId: tabId }, 'Page.reload', { ignoreCache: true });
              await new Promise(r => setTimeout(r, TWO_SECONDS_MS));
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
    await new Promise(r => setTimeout(r, TWO_HUNDRED_MS));
    await cdpExecuteJs(tabId, 'window.scrollTo(0, 0)', { timeout: 2000 });
  } catch(e) { console.warn('[Sentinel/CDP] Scroll test failed:', getErrorMessage(e)); }

  return totalRemoved;
}

// Track whether we're in CDP fallback mode for the current step


// ═══════════════════════════════════════════════════════════════
// Coordinate-based click fallback — uses CDP Input.dispatchMouseEvent
// to click at exact viewport coordinates when selector matching fails.
// ═══════════════════════════════════════════════════════════════

/**
 * Click at exact viewport coordinates using CDP Input.dispatchMouseEvent.
 * Attaches the debugger, dispatches mousePressed + mouseReleased, then detaches.
 * Returns true on success, false on any failure.
 * @param {number} tabId - Chrome tab ID to click in.
 * @param {number} x - X coordinate in CSS pixels.
 * @param {number} y - Y coordinate in CSS pixels.
 * @returns {Promise<boolean>}
 */
export async function clickAtCoordinates(tabId, x, y) {
  try {
    const target = { tabId };
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    });
    await chrome.debugger.detach(target);
    return true;
  } catch (_e) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    return false;
  }
}

/**
 * Find an element's bbox from observed page data by matching selector or text.
 * Searches the elements array from observe_page / _cdpObservePage for an element
 * whose selector, id, or text content matches the given criteria.
 * @param {Array} elements - Array of observed element objects with bbox, text, selector, etc.
 * @param {string} [selector] - CSS selector or ref to match.
 * @param {string} [text] - Text content to match (case-insensitive substring).
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function _findElementBbox(elements, selector, text) {
  if (!elements || !Array.isArray(elements)) return null;
  for (const el of elements) {
    if (el.bbox && (
      (selector && (el.selector === selector || el.id === selector)) ||
      (text && el.text && el.text.toLowerCase().includes(text.toLowerCase()))
    )) {
      return el.bbox;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Visual Element Matching — enhances elements with visual descriptions
// and allows the LLM to specify actions by visual description.
// When vision/screenshot is available, elements get a _visual tag
// describing their visual properties (size, role, visibility).
// ═══════════════════════════════════════════════════════════════

/**
 * Enhance element descriptions with visual properties when available.
 * Adds a _visual string to each element describing its visual characteristics.
 * @param {Array} elements - Array of observed element objects.
 * @returns {Array} The same array with _visual properties added where applicable.
 */
export function enhanceWithVisualProperties(elements) {
  if (!elements || !Array.isArray(elements)) return elements;
  for (const el of elements) {
    const visual = [];
    if (el.bbox) {
      const w = el.bbox.w || el.bbox.width;
      const h = el.bbox.h || el.bbox.height;
      if (w && h) {
        if (w > 200 && h > 40) visual.push('large');
        else if (w < 50 || h < 20) visual.push('small');
      }
    }
    if (el.role) visual.push('role:' + el.role);
    if (el.tag) visual.push('tag:' + el.tag);
    if (el.type && el.type !== el.tag) visual.push('type:' + el.type);
    if (el.isClickable) visual.push('clickable');
    if (el.isInput) visual.push('input');
    if (el.visible === false) visual.push('hidden');
    if (visual.length > 0) el._visual = visual.join(', ');
  }
  return elements;
}

/**
 * Find an element by natural language description.
 * Searches element text, ariaLabel, placeholder, and title for matches.
 * @param {Array} elements - Array of observed element objects.
 * @param {string} description - Natural language description to match against.
 * @returns {Object|null} The matched element, or null.
 */
export function _findElementByDescription(elements, description) {
  if (!elements || !description) return null;
  const desc = description.toLowerCase();
  for (const el of elements) {
    const text = (el.text || el.textContent || '').toLowerCase();
    const ariaLabel = (el.ariaLabel || el['aria-label'] || '').toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();
    const title = (el.title || '').toLowerCase();
    if (text.includes(desc) || ariaLabel.includes(desc) || placeholder.includes(desc) || title.includes(desc)) {
      return el;
    }
  }
  return null;
}


/**
 * Get all tab IDs currently attached to the agent session.
 * @returns {number[]} Array of Chrome tab IDs.
 */
export function getAttachedTabIds() {
  return [...agentAttachedTabs];
}
