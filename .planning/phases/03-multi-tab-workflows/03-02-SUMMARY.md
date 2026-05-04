---
phase: 03-multi-tab-workflows
plan: 02
subsystem: multi-tab-llm-ui
tags: [chrome-extension, multi-tab, llm-prompt, popup-ui, tab-bar, es-modules]

# Dependency graph
requires:
  - "01-01: Modular background architecture with clean dependency graph"
  - "03-01: Tab-context.js module with tab lifecycle management"
provides:
  - "LLM prompt vocabulary includes open_tab, switch_tab, close_tab commands"
  - "Cross-tab context (MANAGED TABS section) injected into every LLM call"
  - "Popup tab bar showing all agent-managed tabs with active highlighting"
  - "User observation via popup tab clicks without interfering with agent state"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-tab context injection in LLM prompt via MANAGED TABS section"
    - "Observation-only popup tab clicks (chrome.tabs.update without background messaging)"
    - "Dynamic tab bar rendering based on tab_state_update messages"

key-files:
  created: []
  modified:
    - "background/llm-client.js"
    - "popup-full.js"
    - "popup.html"

# Decisions
decisions:
  - id: "03-02-a"
    area: "llm-prompt"
    decision: "Tab context built inside callLLM, not passed as parameter, to keep function signature unchanged"
    rationale: "Maintains pattern from Phase 1 where callLLM/callLLMWithRetry receive CONFIG and agentState only"
  - id: "03-02-b"
    area: "llm-prompt"
    decision: "MANAGED TABS shows first 300 chars of page content for inactive tabs, not full element list"
    rationale: "Keeps prompt focused while providing cross-tab awareness (per RESEARCH.md open question #4)"
  - id: "03-02-c"
    area: "llm-prompt"
    decision: "Labels are the primary reference mechanism for LLM tab commands"
    rationale: "Prompt lists tabs by label, commands accept labels (per RESEARCH.md open question #2)"
  - id: "03-02-d"
    area: "popup-ui"
    decision: "Popup tab clicks use chrome.tabs.update only, no background messaging"
    rationale: "User can observe tabs but cannot interfere with agent operation (per CONTEXT.md decision)"

# Metrics
metrics:
  duration: "< 2 minutes"
  completed: "2026-05-04"
  tasks_completed: 2
  tasks_total: 2

---

# Phase 3 Plan 02: Multi-Tab LLM Vocabulary and Popup Tab Bar

**One-liner:** LLM prompt gains open_tab/switch_tab/close_tab vocabulary with MANAGED TABS cross-tab context; popup renders observation-only tab bar.

## What was built

### Task 1: Multi-tab LLM vocabulary and cross-tab context (background/llm-client.js)

- Added import from `tab-context.js` for `getAllTabContexts`, `getActiveTabId`, `getTabContext`, `TAB_LIMIT`
- Added `open_tab`, `switch_tab`, `close_tab` to the `validTypes` array in `parseLLMResponse`
- Built a MANAGED TABS section showing all tracked tabs with labels, URLs, and snapshot summaries (first 300 chars of page content)
- Injected `tabCtxSection` into the LLM prompt between memory context and step counter
- Added actions 17 (open_tab), 18 (switch_tab), 19 (close_tab) to the prompt action list
- Added rule 11 (MULTI-TAB WORKFLOW) to the prompt RULES section with guidance on tab usage
- Tab context section is empty string when no tabs are tracked (safe for all call sites)

### Task 2: Popup tab bar UI (popup-full.js + popup.html)

- Added `#agent-tab-bar` container div between toolbar and chat container in popup.html
- Added CSS styles for tab items with active state, hover effects, and theme variable support
- Implemented `renderTabBar(tabs)` function that shows/hides the bar based on tab count (>1 shown, <=1 hidden)
- Added `tab_state_update` message listener to update the tab bar in real-time
- Tab click handler calls `chrome.tabs.update(ctx.tabId, { active: true })` for user observation only -- no messages sent to background
- Tab bar hidden on agent finish (`agent_finished` message) and agent stop (stop button)

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

Phase 3 is now complete (2/2 plans done). The multi-tab infrastructure is ready for Phase 4 (Reports & Multi-Provider LLM):
- The LLM can issue open_tab, switch_tab, close_tab commands
- Cross-tab context is available in every LLM call
- The popup shows managed tabs for user observation
- Agent-engine already handles the tab commands (from 03-01)
