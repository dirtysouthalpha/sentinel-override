---
phase: 03-multi-tab-workflows
plan: 01
subsystem: multi-tab-management
tags: [chrome-extension, multi-tab, tab-context, screenshot-cache, es-modules, lru-eviction]

# Dependency graph
requires:
  - "01-01: Modular background architecture with clean dependency graph"
  - "01-02: SPA transition handling in shared-state.js"
  - "02-01: Content script infrastructure for page interaction"
provides:
  - "TabContext map manager (background/tab-context.js) with open/switch/close lifecycle"
  - "Per-tab screenshot cache preventing cross-tab cache pollution"
  - "Tab state update messaging for popup UI notification"
  - "Agent loop integration with multi-tab command handlers (open_tab/switch_tab/close_tab)"
  - "External tab closure detection via chrome.tabs.onRemoved"
affects: [03-02, 04-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Map-based TabContext store with active pointer pattern"
    - "LRU eviction for tab limit enforcement"
    - "Per-tab screenshot cache objects within TabContext"
    - "getActiveTabId() accessor replacing bare agentTabId variable"

key-files:
  created:
    - background/tab-context.js
  modified:
    - background/agent-engine.js
    - background/index.js
    - background/message-protocol.js

key-decisions:
  - "TabContext is in-memory Map only (no chrome.storage.session backup for v1)"
  - "Agent-created tabs batch-closed at loop end; no cross-task tab persistence in v1"
  - "User tab switches do NOT change agent's active tab (CONTEXT.md decision)"
  - "chrome.tabs.onActivated registered as no-op documenting the CONTEXT.md decision"
  - "Post-click new tab: registered as tracked context in multi-tab mode, captured in single-tab mode"
  - "tab-context.js imports sendTabStateUpdate from message-protocol.js (acceptable one-way dep)"
  - "handleTabRemoved exported from tab-context.js, called from index.js listener"

patterns-established:
  - "Tab lifecycle: openTab -> switchToTab -> closeTab -> closeAllAgentTabs"
  - "Tab command handlers in agent loop: open_tab/switch_tab/close_tab before navigate"
  - "Per-tab state: each TabContext owns its own screenshotCache and snapshot"

# Metrics
duration: 4min
completed: 2026-05-04
---

# Phase 3 Plan 01: Tab Context Manager and Agent Engine Integration Summary

**Map-based TabContext manager replacing single agentTabId, with per-tab screenshot caches, LRU eviction, and full agent loop integration for open/switch/close tab commands**

## Performance

- **Duration:** 4 minutes
- **Started:** 2026-05-04
- **Completed:** 2026-05-04
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments
- Created `background/tab-context.js` (236 lines) with Map-based TabContext store, 15 exports, and TAB_LIMIT=5 with LRU eviction
- Added `sendTabStateUpdate` helper to `message-protocol.js` for popup tab state notifications
- Added `open_tab`, `switch_tab`, `close_tab` action descriptions in `sendActionMessage` for proper popup action cards
- Replaced single `agentTabId` variable with `getActiveTabId()` from tab-context throughout agent-engine.js and index.js
- Moved screenshot cache from module-level variables to per-tab `TabContext.screenshotCache` objects
- Added tab command handlers (open_tab/switch_tab/close_tab) before the navigate handler in the agent loop
- Added `updateSnapshot()` call after page observation for per-tab tracking
- Added multi-tab aware post-click behavior: new tabs registered as tracked contexts when agent has multiple tabs
- Added `chrome.tabs.onRemoved` listener in index.js calling `handleTabRemoved()` for external tab closure cleanup
- Added `chrome.tabs.onActivated` no-op listener documenting CONTEXT.md decision
- Called `closeAllAgentTabs()` at agent loop end and in `stopAgent()`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tab-context.js module and update message-protocol.js** - `c2bb5a9` (feat)
2. **Task 2: Integrate tab-context into agent-engine.js and index.js** - `00146c1` (feat)

## Files Created/Modified
- `background/tab-context.js` (236 lines) - NEW: TabContext map, open/switch/close tab, per-tab snapshot management, tab limit with LRU eviction, findTabByLabel, registerInitialTab, handleTabRemoved
- `background/message-protocol.js` (170 lines) - MODIFIED: Added sendTabStateUpdate helper, added open_tab/switch_tab/close_tab action descriptions in sendActionMessage
- `background/agent-engine.js` (700 lines) - MODIFIED: Replaced agentTabId with getActiveTabId(), per-tab screenshot cache, tab command handlers, updateSnapshot after observation, closeAllAgentTabs at loop end, multi-tab post-click handling
- `background/index.js` (95 lines) - MODIFIED: Removed agentTabId import, replaced with getActiveTabId() calls, added chrome.tabs.onRemoved and onActivated listeners

## Decisions Made
- **In-memory Map only for v1**: TabContext uses a plain `Map<tabId, TabContext>` with no `chrome.storage.session` backup. The agent loop keeps the service worker alive during active execution, making persistence unnecessary. Cross-task tab persistence is deferred.
- **Batch-close agent tabs at loop end**: When the agent finishes or is stopped, all agent-created tabs are closed and the context map is cleared. This keeps v1 simple -- "tabs persist across tasks" from CONTEXT.md is deferred.
- **User tab switches ignored**: Per CONTEXT.md decision, `chrome.tabs.onActivated` is registered but takes no action. The agent's active tab is controlled solely by `switchToTab()` in the agent loop.
- **Post-click multi-tab behavior**: When a click opens a new tab, the agent checks `getTabCount()`. If > 1, the new tab is registered as a tracked context. If only 1 tab exists (the original), the old behavior is kept (capture URL, close new tab, navigate original).
- **tab-context.js imports from message-protocol.js**: This is acceptable because it's a one-way dependency. message-protocol.js never imports from tab-context.js. The dependency graph remains acyclic.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tab context manager is fully integrated and ready for 03-02 (popup UI tab display and LLM prompt multi-tab context)
- The `sendTabStateUpdate` helper is ready for the popup to consume via `chrome.runtime.onMessage`
- Tab command types (open_tab/switch_tab/close_tab) need to be added to the LLM prompt vocabulary in a future plan
- No blockers or concerns for next plan

---
*Phase: 03-multi-tab-workflows*
*Completed: 2026-05-04*
