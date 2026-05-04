# Phase 3: Multi-Tab Workflows - Research

**Researched:** 2026-05-04
**Domain:** Chrome Extension MV3 multi-tab management, per-tab context tracking, cross-tab data correlation in LLM browser agents
**Confidence:** HIGH

## Summary

This phase transforms Sentinel Override from a single-tab agent into a multi-tab agent capable of opening, switching between, and closing multiple browser tabs during task execution, while maintaining per-tab context snapshots and enabling cross-tab data correlation through the LLM context window.

The extension already has all the Chrome API permissions needed (`tabs`, `scripting`, `debugger`, `storage`). The current `tab-manager.js` already handles page load waiting, content script injection, and screenshot capture -- all of which generalize to any tab ID. The agent loop in `agent-engine.js` is hardcoded to a single `agentTabId` variable and operates on one tab at a time. The core work is: (1) replace the single `agentTabId` with a `TabContext` map that tracks multiple tabs, (2) add new LLM command types (`open_tab`, `switch_tab`, `close_tab`) alongside the existing action types, (3) update the agent loop to observe/act on the "current" tab from the context map, and (4) extend the popup UI to show managed tabs.

No new permissions, no new npm dependencies, no build step. This is pure extension of existing patterns using built-in Chrome APIs and vanilla JavaScript.

**Primary recommendation:** Create a `TabContext` manager module in `background/` that replaces the single `agentTabId` with a `Map<tabId, TabContext>` (label, URL, snapshot, screenshot cache), add three new command types to the LLM action vocabulary, update the agent loop to operate on whichever tab is "active" in the context map, and extend the popup to display managed tabs.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `chrome.tabs` API | Built-in (MV3) | Create, update, remove, query tabs | Already have `"tabs"` permission in manifest. Core API for TAB-01. |
| `chrome.storage.session` | Chrome 102+ | Ephemeral per-tab state that survives service worker restarts | Ideal for tab context snapshots that must survive the 30s service worker termination. 10MB limit, session-scoped. |
| `chrome.storage.local` | Built-in | Persistent tab metadata across browser sessions | For tab persistence across tasks (CONTEXT.md decision: "tabs persist across tasks"). Already used extensively. |
| `chrome.tabs.onRemoved` | Built-in | Detect when agent-created tabs are closed by user | Clean up context for externally-closed tabs. |
| `chrome.tabs.onActivated` | Built-in | Detect user tab switches (for awareness, not interruption) | CONTEXT.md: "agent ignores user's manual tab switches." This listener tracks what the user does but does NOT change agent behavior. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `chrome.tabs.onUpdated` | Built-in | Detect when a tab finishes loading | Already used in `waitForPageLoad`. Extends to multi-tab: each tab's load state tracked independently. |
| Vanilla JavaScript Map | ES2015+ | Per-tab context store | In-memory `Map<tabId, TabContext>` for fast access during agent loop. Backed by `chrome.storage.session` for persistence. |
| Vanilla JavaScript | ES2020+ | All implementation code | No new dependencies. Zero npm packages. Follows existing project constraint. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory `Map` + `chrome.storage.session` | `chrome.storage.local` for all tab state | `storage.local` is slower (async I/O to disk) and persists data that should be session-scoped. `storage.session` is in-memory and auto-clears on browser close -- matches "tabs persist across tasks but not across sessions" semantics. |
| New command types in existing action vocabulary | Separate "tab manager" LLM call | Separate call doubles API usage and adds latency. Embedding tab commands in the existing action vocabulary is simpler and lets the LLM reason about tab switches inline with page actions. |
| Extending `tab-manager.js` | New `tab-context.js` module | `tab-manager.js` is already 155 lines focused on page-level utilities (inject, screenshot, wait). Tab context tracking is a different concern (state management, LLM integration). Keep them separate per the existing dependency graph convention. |
| Tab groups (`chrome.tabGroups`) | Flat list of agent-managed tabs | Tab groups require additional permissions and add UI complexity. A flat list with labels is sufficient for 3-5 tabs. |

**Installation:**

No packages to install. This phase uses only built-in Chrome Extension APIs and vanilla JavaScript, consistent with the existing project constraint of zero npm dependencies.

## Architecture Patterns

### Recommended Module Structure

```
background/
  index.js              # MODIFIED: wire tab-context module, handle new message types
  agent-engine.js       # MODIFIED: use TabContext instead of single agentTabId
  tab-manager.js        # MODIFIED: generalize screenshot cache to per-tab
  tab-context.js        # NEW: TabContext map, open/switch/close, snapshot management
  llm-client.js         # MODIFIED: add tab commands to action vocabulary, multi-tab context in prompt
  message-protocol.js   # MODIFIED: add tab-related message types for popup
  shared-state.js       # MODIFIED: add tab-related flags if needed
  frame-router.js       # UNCHANGED
```

### Dependency Graph (Updated)

The existing one-way dependency graph must be maintained (prior decision 01-01):

```
message-protocol.js  <-- imports nothing
shared-state.js      <-- imports nothing
tab-manager.js       <-- imports from message-protocol.js
tab-context.js       <-- imports from message-protocol.js, tab-manager.js
llm-client.js        <-- imports from message-protocol.js
frame-router.js      <-- imports nothing (or from message-protocol.js)
agent-engine.js      <-- imports from all above
index.js             <-- imports from all above
```

`tab-context.js` imports from `tab-manager.js` (for `injectContentScript`, `waitForPageLoad`, `takeScreenshot`) and `message-protocol.js` (for `sendSilentUpdate`). It does NOT import from `agent-engine.js` -- avoiding circular dependencies.

### Pattern 1: TabContext Data Structure

**What:** A `Map<tabId, TabContext>` where each entry holds the full state for one agent-managed tab. The agent loop reads from and writes to this map instead of the single `agentTabId` variable.

**When to use:** Always during agent execution. The "active" tab is whichever entry has `isActive: true`.

**Example:**

```javascript
// background/tab-context.js

// TabContext shape:
// {
//   tabId: number,
//   label: string,           // Human-readable label (e.g., "SonicWall Logs")
//   url: string,             // Current URL
//   title: string,           // Page title
//   isActive: boolean,       // Agent is currently operating on this tab
//   snapshot: {              // Last page snapshot (updated on action)
//     elements: Array,       // From observe_page
//     pageContent: string,   // From read_page (truncated)
//     timestamp: number,
//   },
//   screenshotCache: {
//     cachedBase64Image: string|null,
//     lastScreenshotUrl: string|null,
//   },
//   createdAt: number,       // For LRU eviction
//   isAgentCreated: boolean, // True = agent opened it, False = user's existing tab
// }

const TAB_LIMIT = 5;

let tabContexts = new Map();  // Map<tabId, TabContext>
let activeTabId = null;        // Which tab the agent is currently operating on

export function getActiveTabId() { return activeTabId; }
export function getTabContext(tabId) { return tabContexts.get(tabId); }
export function getAllTabContexts() { return Array.from(tabContexts.values()); }
export function getTabCount() { return tabContexts.size; }

export function setActiveTab(tabId) {
  if (!tabContexts.has(tabId)) return false;
  // Deactivate previous
  if (activeTabId !== null && tabContexts.has(activeTabId)) {
    tabContexts.get(activeTabId).isActive = false;
  }
  activeTabId = tabId;
  tabContexts.get(tabId).isActive = true;
  return true;
}

export async function openTab(url, label) {
  if (tabContexts.size >= TAB_LIMIT) {
    // LRU eviction: remove oldest non-active tab
    const entries = Array.from(tabContexts.entries())
      .filter(([id]) => id !== activeTabId)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    if (entries.length > 0) {
      await closeTab(entries[0][0]);
    }
  }

  const tab = await chrome.tabs.create({ url, active: false }); // Don't steal focus
  const ctx = {
    tabId: tab.id,
    label: label || url,
    url: url,
    title: '',
    isActive: false,
    snapshot: null,
    screenshotCache: { cachedBase64Image: null, lastScreenshotUrl: null },
    createdAt: Date.now(),
    isAgentCreated: true,
  };
  tabContexts.set(tab.id, ctx);
  return ctx;
}

export async function switchToTab(tabId) {
  if (!tabContexts.has(tabId)) return false;
  await chrome.tabs.update(tabId, { active: true }); // Make it the visible tab
  return setActiveTab(tabId);
}

export async function closeTab(tabId) {
  if (!tabContexts.has(tabId)) return;
  if (tabId === activeTabId) {
    // Switch to another tab or null
    const others = Array.from(tabContexts.keys()).filter(id => id !== tabId);
    activeTabId = others.length > 0 ? others[0] : null;
    if (activeTabId !== null) {
      tabContexts.get(activeTabId).isActive = true;
    }
  }
  const ctx = tabContexts.get(tabId);
  if (ctx && ctx.isAgentCreated) {
    try { await chrome.tabs.remove(tabId); } catch (e) { /* tab may already be closed */ }
  }
  tabContexts.delete(tabId);
}

export async function closeAllAgentTabs() {
  const closable = Array.from(tabContexts.entries())
    .filter(([, ctx]) => ctx.isAgentCreated);
  for (const [tabId] of closable) {
    try { await chrome.tabs.remove(tabId); } catch (e) {}
  }
  tabContexts.clear();
  activeTabId = null;
}

export function updateSnapshot(tabId, snapshot) {
  const ctx = tabContexts.get(tabId);
  if (ctx) {
    ctx.snapshot = { ...snapshot, timestamp: Date.now() };
    ctx.url = snapshot.url || ctx.url;
    ctx.title = snapshot.title || ctx.title;
  }
}

export function resetAllContexts() {
  tabContexts.clear();
  activeTabId = null;
}
```

### Pattern 2: New LLM Command Types

**What:** Add `open_tab`, `switch_tab`, and `close_tab` to the action vocabulary in `llm-client.js`. These are handled in `agent-engine.js` before the standard action execution path.

**When to use:** The LLM decides when to open/switch/close tabs as part of its reasoning about multi-step tasks.

**Example:**

```javascript
// New command types added to validTypes in parseLLMResponse:
const validTypes = [
  // ... existing types ...
  'open_tab',      // { type: "open_tab", url: "https://...", label: "Logs Page" }
  'switch_tab',    // { type: "switch_tab", tab_id: 123 } or { type: "switch_tab", label: "Logs Page" }
  'close_tab',     // { type: "close_tab", tab_id: 123 } or { type: "switch_tab", label: "Logs Page" }
];

// In agent-engine.js, before standard command execution:
if (command.type === 'open_tab') {
  const ctx = await openTab(command.url, command.label);
  await switchToTab(ctx.tabId);
  await waitForPageLoad(ctx.tabId);
  result = `Opened new tab: ${command.label || command.url}`;
  // Continue loop -- next iteration will observe the new tab
}

if (command.type === 'switch_tab') {
  const tabId = command.tab_id || findTabByLabel(command.label);
  if (!tabId) { result = `Tab not found: ${command.label || command.tab_id}`; actionFailed = true; }
  else {
    await switchToTab(tabId);
    result = `Switched to tab: ${command.label || tabId}`;
  }
}

if (command.type === 'close_tab') {
  const tabId = command.tab_id || findTabByLabel(command.label);
  if (!tabId) { result = `Tab not found: ${command.label || command.tab_id}`; actionFailed = true; }
  else {
    await closeTab(tabId);
    result = `Closed tab: ${command.label || tabId}`;
  }
}
```

### Pattern 3: Multi-Tab Context in LLM Prompt

**What:** The LLM prompt includes a summary of all tracked tabs (not just the active one) so the agent can reason about cross-tab data. Inactive tab summaries come from their cached snapshots.

**When to use:** Every LLM call. The prompt header lists all managed tabs with their labels and URLs, and includes a brief summary of each inactive tab's last known content.

**Example:**

```javascript
// In callLLM, build multi-tab context section:
const allContexts = getAllTabContexts();
const otherTabs = allContexts.filter(ctx => ctx.tabId !== activeTabId);

let tabCtx = '';
if (otherTabs.length > 0) {
  tabCtx = '\nMANAGED TABS (you have data from these tabs):\n';
  for (const ctx of otherTabs) {
    const snapSummary = ctx.snapshot
      ? `Last seen: "${ctx.snapshot.pageContent?.substring(0, 500)}..."`
      : 'No snapshot yet.';
    tabCtx += `- Tab "${ctx.label}" (${ctx.url}): ${snapSummary}\n`;
  }
  tabCtx += 'Use "switch_tab" to operate on another tab. Use "open_tab" to open a new tab.\n';
}
```

### Pattern 4: Popup UI Tab Display

**What:** The popup shows a tab bar/list of all agent-managed tabs with labels, highlighting the active one. Clicking a tab in the popup switches the user's view to that tab (for observation) but does NOT change the agent's active tab.

**When to use:** Always visible when the agent is running with multiple tabs.

**Example:**

```javascript
// popup-full.js — add tab bar rendering
function renderTabBar(tabs) {
  const tabBar = document.getElementById('tab-bar');
  tabBar.innerHTML = '';
  tabs.forEach(ctx => {
    const tab = document.createElement('div');
    tab.className = `tab-item ${ctx.isActive ? 'active' : ''}`;
    tab.textContent = ctx.label || ctx.url;
    tab.title = ctx.url;
    tab.addEventListener('click', () => {
      // User observation: switch their VIEW but don't change agent's active tab
      chrome.tabs.update(ctx.tabId, { active: true });
    });
    tabBar.appendChild(tab);
  });
}

// Listen for tab state updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'tab_state_update') {
    renderTabBar(message.tabs);
  }
});
```

### Pattern 5: Agent Loop Adaptation for Multi-Tab

**What:** The agent loop uses `getActiveTabId()` instead of the hardcoded `workingTabId`. After executing a tab-switching command, the loop continues with the new active tab's context.

**When to use:** The core loop iteration must be tab-aware. The key change: replace `let tab = workingTabId;` with `let tab = getActiveTabId();`.

**Key change in agent-engine.js:**

```javascript
// BEFORE (single tab):
let tab = workingTabId;

// AFTER (multi-tab):
let tab = getActiveTabId();
if (!tab) {
  sendSilentUpdate('No active tab. Opening task start page...', stepCount);
  // Fall back to the original tab or open a new one
  tab = workingTabId;
}
```

### Anti-Patterns to Avoid

- **Global tab ID variable:** Do NOT replace `agentTabId` with another global. Use the `tab-context.js` module as the single source of truth. Import `getActiveTabId()` wherever needed.
- **Tab switching mid-action:** Do NOT allow the agent to switch tabs in the middle of an observe-execute cycle. Tab switches are discrete actions that produce a result, and the next loop iteration picks up the new tab.
- **Snapshot on every iteration:** Do NOT re-scan inactive tabs on every loop iteration. Snapshots update only when the agent performs an action on that tab (CONTEXT.md decision).
- **User tab switch changes agent behavior:** Do NOT react to `chrome.tabs.onActivated` by switching the agent's active tab. The agent ignores user tab switches (CONTEXT.md decision). The listener is for UI awareness only.
- **Storing full DOM in snapshots:** Do NOT store the raw DOM or untruncated page content. Snapshots store truncated content (matching existing `maxPageContentLength`) and element summaries -- the same data that goes into the LLM prompt.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tab creation/destruction | Custom tab lifecycle manager with event listeners | `chrome.tabs.create()`, `chrome.tabs.remove()` directly | The Chrome API handles all edge cases (tab crash, window close, etc.). Wrapping with minimal state tracking is fine; building a full lifecycle manager is over-engineering. |
| Content script injection for new tabs | Custom injection logic | Existing `injectContentScript(tabId)` from `tab-manager.js` | Already handles retry logic and ready-signaling. Works for any tabId. |
| Screenshot per tab | Per-tab screenshot cache manager | Extend existing `screenshotCache` pattern into `TabContext` | The cache invalidation logic already exists. Just move it from a single object to per-tab objects in the context map. |
| Page load waiting | New wait logic | Existing `waitForPageLoad(tabId)` from `tab-manager.js` | Already handles timeout and status checking. Works for any tabId. |
| Cross-tab data transport | Shared storage, postMessage, BroadcastChannel | LLM context window (CONTEXT.md decision) | The LLM already carries all context. Adding a shared storage layer is unnecessary complexity. Data moves between tabs via the prompt. |

**Key insight:** The existing single-tab infrastructure (inject, screenshot, wait, message) is already parameterized by `tabId`. The multi-tab phase is primarily about state management (tracking which tabs exist and which is active), not about building new tab manipulation infrastructure.

## Common Pitfalls

### Pitfall 1: Service Worker Termination Loses Tab Context Map

**What goes wrong:** The in-memory `Map<tabId, TabContext>` is lost when the service worker is terminated after 30 seconds of inactivity. The agent loses track of all tabs.

**Why it happens:** MV3 service workers are ephemeral. JavaScript variables do not survive termination.

**How to avoid:** Back up the tab context map to `chrome.storage.session` periodically (e.g., after each tab context change). On service worker startup, check `chrome.storage.session` for existing tab contexts and rebuild the in-memory map. Alternatively, since the agent loop keeps the service worker alive via continuous Chrome API calls, the termination risk during active agent execution is low. Focus on persistence for the "tabs persist across tasks" use case (store tab metadata in `chrome.storage.local`).

**Warning signs:** After a pause, the agent reports "No active tab" or opens duplicate tabs.

### Pitfall 2: User Closes an Agent-Managed Tab

**What goes wrong:** The user manually closes a tab that the agent is tracking. The agent tries to operate on a non-existent tab ID, gets errors.

**Why it happens:** `chrome.tabs.onRemoved` fires for any tab close, whether by the agent or by the user.

**How to avoid:** Listen to `chrome.tabs.onRemoved` and clean up the tab context. If the closed tab was the active tab, switch the agent to another tracked tab (or handle gracefully if no other tabs exist). The existing code already handles lost tabs (lines 203-213 of agent-engine.js) but only checks once per iteration. A proactive listener is more robust.

**Warning signs:** "Agent tab lost" messages appearing repeatedly.

### Pitfall 3: New Tab Content Script Not Ready

**What goes wrong:** After `chrome.tabs.create({url})`, the agent immediately tries to observe the page. The content script hasn't loaded yet.

**Why it happens:** Tab creation is async. The page must load, then the content script must be injected and signal ready.

**How to avoid:** The existing `waitForPageLoad(tabId)` + `injectContentScript(tabId)` pattern handles this. After `open_tab`, the agent loop should `continue` to the next iteration, which will wait for load and inject. Do NOT try to observe immediately after creation.

**Warning signs:** "No response from content script" errors on newly opened tabs.

### Pitfall 4: Screenshot Cache Invalidation Across Tabs

**What goes wrong:** The screenshot cache is tied to a URL. When the agent switches tabs, the cached screenshot from tab A is incorrectly used for tab B if they happen to have the same URL.

**Why it happens:** The current screenshot cache is a single object keyed by URL. With multiple tabs, two tabs could have the same URL.

**How to avoid:** Move the screenshot cache into `TabContext`, making it per-tab instead of global. Each tab has its own `{ cachedBase64Image, lastScreenshotUrl }` pair. The `takeScreenshot` function should accept the tab-specific cache object.

**Warning signs:** Screenshot shows wrong page content after tab switch.

### Pitfall 5: Tab Limit Eviction Loses Important Data

**What goes wrong:** When the agent opens a 6th tab (beyond the 3-5 limit), the LRU eviction removes a tab whose cached data is still needed.

**Why it happens:** LRU eviction is blind to task relevance. The oldest tab might hold critical data the agent hasn't extracted yet.

**How to avoid:** CONTEXT.md states: "evicted tabs lose their cached context -- agent must revisit the page if it needs data." This is the designed behavior. The agent should be instructed in the prompt to extract data from a tab BEFORE opening new tabs that would push it past the limit. The tab limit should be prominently displayed in the LLM prompt.

**Warning signs:** Agent opens many tabs, loses track of data, and cannot recover without re-visiting pages.

### Pitfall 6: Popup Tab Click Interferes with Agent

**What goes wrong:** User clicks a tab in the popup to observe it, and this somehow changes the agent's active tab, causing confusion.

**Why it happens:** If `chrome.tabs.update(tabId, {active: true})` is used both for agent tab switches and user observation clicks, they could interfere.

**How to avoid:** The popup click handler should ONLY call `chrome.tabs.update(tabId, {active: true})` to change the user's visible tab. It should NOT call `setActiveTab()` in the tab-context module. The agent's active tab is controlled solely by the agent loop via `switchTab()`. These are two separate concerns: user observation vs. agent operation.

**Warning signs:** Agent starts operating on a different tab after the user clicks the popup.

### Pitfall 7: Concurrent Operations Race Condition

**What goes wrong:** CONTEXT.md says "agent can perform concurrent operations on multiple tabs simultaneously (e.g., act on tab B while tab A is loading)." If the agent switches to tab B while tab A is still loading, tab A's load completion might trigger unintended behavior.

**Why it happens:** The current code has a single `waitForPageLoad` call per iteration. With concurrent operations, multiple loads could be in flight.

**How to avoid:** The simplest approach is sequential execution within the loop -- each iteration operates on exactly one tab. "Concurrent" means the agent can switch tabs while a previous tab is still loading in the background, not that it issues commands to two tabs simultaneously. The agent loop remains single-threaded. This avoids all race conditions while still being efficient (the agent doesn't wait for tab A to finish loading before starting work on tab B).

**Warning signs:** Commands being sent to the wrong tab. Observation data from tab A appearing in tab B's context.

## Code Examples

### Agent Engine Loop Adaptation (Key Changes)

The following shows the key modifications to `runAgentLoop` in `agent-engine.js`. The overall loop structure stays the same; the changes are localized.

```javascript
// BEFORE: Single tab reference
let tab = workingTabId;

// AFTER: Multi-tab reference
import { getActiveTabId, setActiveTab, getTabContext, getAllTabContexts, openTab, switchToTab, closeTab, closeAllAgentTabs, updateSnapshot, resetAllContexts } from './tab-context.js';

async function runAgentLoop(goal, workingTabId) {
  // ... existing setup ...

  // Initialize tab context with the starting tab
  const startCtx = {
    tabId: workingTabId,
    label: 'Main Task Tab',
    url: (await getTabInfo(workingTabId))?.url || '',
    title: '',
    isActive: true,
    snapshot: null,
    screenshotCache: { cachedBase64Image: null, lastScreenshotUrl: null },
    createdAt: Date.now(),
    isAgentCreated: false, // User's existing tab
  };
  // ... register startCtx in tab-context ...

  while (!finished && agentRunning) {
    // ... existing step counting, SPA check ...

    let tab = getActiveTabId();
    if (!tab) {
      sendSilentUpdate('No active tab -- stopping', stepCount);
      break;
    }

    let tabInfo = await getTabInfo(tab);
    // ... rest of existing loop, but tab-specific caches come from getTabContext(tab) ...
  }

  // Cleanup: batch-close agent-created tabs
  await closeAllAgentTabs();
}
```

### New Command Handling in Agent Loop

```javascript
// Handle open_tab
if (command.type === 'open_tab') {
  if (!isValidUrl(command.url)) {
    result = 'Invalid URL: ' + command.url;
    actionFailed = true;
  } else {
    sendSilentUpdate(`Opening tab: ${command.label || command.url}`, stepNumber);
    const ctx = await openTab(command.url, command.label);
    await switchToTab(ctx.tabId);
    // Don't wait for load here -- the next loop iteration handles that
    result = `Opened tab "${command.label || command.url}" (ID: ${ctx.tabId})`;
  }
  // Skip rest of action execution, continue to next iteration
  history.push({ step: stepCount, action: command, result });
  continue;
}

// Handle switch_tab
if (command.type === 'switch_tab') {
  let targetId = command.tab_id;
  if (!targetId && command.label) {
    const match = getAllTabContexts().find(ctx => ctx.label === command.label);
    targetId = match ? match.tabId : null;
  }
  if (!targetId) {
    result = `Tab not found: ${command.label || command.tab_id}`;
    actionFailed = true;
  } else {
    await switchToTab(targetId);
    result = `Switched to tab "${getTabContext(targetId)?.label || targetId}"`;
  }
  history.push({ step: stepCount, action: command, result });
  continue;
}

// Handle close_tab
if (command.type === 'close_tab') {
  let targetId = command.tab_id;
  if (!targetId && command.label) {
    const match = getAllTabContexts().find(ctx => ctx.label === command.label);
    targetId = match ? match.tabId : null;
  }
  if (!targetId) {
    result = `Tab not found: ${command.label || command.tab_id}`;
    actionFailed = true;
  } else {
    await closeTab(targetId);
    result = `Closed tab "${command.label || targetId}"`;
  }
  history.push({ step: stepCount, action: command, result });
  continue;
}
```

### Tab Context Cleanup on External Close

```javascript
// In background/index.js or tab-context.js
chrome.tabs.onRemoved.addListener((tabId) => {
  // Only clean up if this is an agent-managed tab
  const ctx = getTabContext(tabId);
  if (ctx) {
    // Remove from context map
    tabContexts.delete(tabId);
    // If it was the active tab, switch to another
    if (activeTabId === tabId) {
      const others = Array.from(tabContexts.keys());
      if (others.length > 0) {
        setActiveTab(others[0]);
      } else {
        activeTabId = null;
      }
    }
    // Notify popup
    chrome.runtime.sendMessage({
      action: 'tab_state_update',
      tabs: getAllTabContexts()
    }).catch(() => {});
  }
});
```

### Popup Tab State Message

```javascript
// In message-protocol.js — new helper for tab state updates
export function sendTabStateUpdate(tabs) {
  chrome.runtime.sendMessage({
    action: 'tab_state_update',
    tabs: tabs.map(ctx => ({
      tabId: ctx.tabId,
      label: ctx.label,
      url: ctx.url,
      isActive: ctx.isActive,
    }))
  }).catch(() => {});
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `agentTabId` variable | `Map<tabId, TabContext>` with active pointer | This phase | Enables multi-tab tracking with O(1) lookup |
| Global screenshot cache | Per-tab screenshot cache in TabContext | This phase | Prevents cross-tab cache pollution |
| LLM prompt shows one page | LLM prompt shows all managed tabs with summaries | This phase | Enables cross-tab reasoning without re-visiting pages |
| Tab info from `getTabInfo` per iteration | Tab info cached in TabContext, updated on action | This phase | Reduces redundant Chrome API calls |
| Agent ignores tabs opened by clicks | Agent opens and manages its own tabs | This phase | Agent controls its tab lifecycle independently |

**Deprecated/outdated:**
- The current `agentTabId` export from `agent-engine.js` becomes the `getActiveTabId()` export from `tab-context.js`. The old export can be kept as a compatibility wrapper initially, then removed.

## Open Questions

1. **Should `chrome.storage.session` be used for tab context persistence?**
   - What we know: `chrome.storage.session` survives service worker restarts within a browser session. It's in-memory and fast. Requires `"storage"` permission (already declared).
   - What's unclear: Whether the agent loop's continuous Chrome API calls are sufficient to keep the service worker alive, making `storage.session` backup unnecessary during active execution.
   - Recommendation: Use in-memory `Map` as the primary store during active execution. Back up to `chrome.storage.session` on significant state changes (tab open/close/switch) for crash recovery. Use `chrome.storage.local` for "tabs persist across tasks" metadata (tab labels, URLs). This is a belt-and-suspenders approach that handles both the 30s termination risk and cross-task persistence.

2. **How should the LLM reference tabs -- by ID or by label?**
   - What we know: Tab IDs are numeric and opaque. Labels are human-readable but could collide.
   - What's unclear: Whether the LLM can reliably track numeric IDs across many prompt turns.
   - Recommendation: Use labels as the primary reference mechanism. Add a tab index or short ID if needed for disambiguation. The prompt should list tabs with their labels, and the LLM references them by label. Fall back to tab_id for programmatic access. This matches how humans think about tabs ("the logs tab", "the config tab").

3. **What happens when the agent opens a tab that redirects?**
   - What we know: `chrome.tabs.create({url})` follows redirects. The final URL may differ from the requested URL. The context should update to reflect the actual URL.
   - What's unclear: Whether the label should update on redirect or stay as originally assigned.
   - Recommendation: Keep the original label (it's the agent's semantic name for the tab). Update the URL in TabContext after navigation completes. The label is for the agent's reference; the URL is for cache invalidation and display.

4. **Should tab context snapshots include the element list or just page content?**
   - What we know: Full element lists are ~2000-5000 chars per tab. With 5 tabs, that's up to 25KB of element data in the prompt, which is significant but manageable.
   - What's unclear: Whether including element lists for inactive tabs helps the LLM reason about cross-tab operations, or just adds noise.
   - Recommendation: Include a brief summary of inactive tabs (label + URL + first 300 chars of page content) but NOT the full element list. The element list is only relevant for the active tab where the agent will take actions. This keeps the prompt focused while still providing cross-tab awareness.

## Sources

### Primary (HIGH confidence)
- Chrome tabs API official docs: https://developer.chrome.com/docs/extensions/reference/api/tabs -- Verified `create`, `remove`, `update`, `query`, event listeners (`onCreated`, `onRemoved`, `onUpdated`, `onActivated`)
- Chrome storage.session API: https://developer.chrome.com/docs/extensions/reference/api/storage -- Verified session-scoped storage, 10MB limit, access levels
- Current codebase analysis: All files in `background/`, `content/`, `popup-full.js`, `manifest.json` -- Verified existing patterns, permissions, dependency graph, state management approach
- CONTEXT.md (03-CONTEXT.md): Verified all locked decisions constrain the implementation approach

### Secondary (MEDIUM confidence)
- Prior phase research: 01-RESEARCH.md, 02-RESEARCH.md -- Verified established patterns for module splitting, content script injection, state management
- Web search results on multi-tab browser agent architecture (rate-limited, could not fully verify): Confirms service-worker-as-orchestrator pattern and per-tab context store as standard approaches
- Academic paper "Building Browser Agents" (arXiv 2511.19477): Confirms that architecture (not LLM capability) is the key challenge for browser agents

### Tertiary (LOW confidence)
- BrowseAgent Chrome extension (GitHub): Open-source reference for browser agent architecture. Could not fully verify due to rate limiting. Marked for validation if specific patterns are needed.
- NanoBrowser (GitHub): Multi-agent workflow patterns for browser automation. Not directly applicable since this extension uses a single-agent model.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All Chrome APIs (`chrome.tabs`, `chrome.storage.session`) are well-documented and already have permissions declared. No new dependencies needed.
- Architecture: HIGH -- The TabContext pattern is a straightforward extension of the existing single-tab architecture. Dependency graph constraints are clear from prior decisions. The module structure follows established patterns from Phase 1.
- Pitfalls: HIGH -- All pitfalls are based on direct analysis of the current codebase and verified Chrome Extension MV3 behavior. The service worker lifecycle pitfall is well-documented.
- Cross-tab data flow: HIGH -- CONTEXT.md explicitly decides "data moves between tabs via LLM context." This eliminates the most complex alternative (shared storage infrastructure).
- Popup UI: MEDIUM -- The tab bar design is straightforward but the exact CSS/layout depends on the existing popup.html structure, which was not analyzed in detail.

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (30 days -- stable domain, Chrome MV3 APIs are not rapidly changing)
