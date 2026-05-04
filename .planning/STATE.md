# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-04)

**Core value:** Give a command in any form and the agent drives the browser to completion, then generates a structured report.
**Current focus:** v2 milestone -- testing, tech debt, templates, scheduling, collaboration

## Current Position

Phase: 5 -- Testing & Tech Debt Cleanup (next to plan)
Plan: 05-01
Status: Roadmap created, ready to plan Phase 5
Last activity: 2026-05-04 -- v2 roadmap created

Progress: [░░░░░░░░░░░░░░░░░░░░] 0% (v2, 0/8 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 8 (v1)
- Average duration: ~3.5 min/plan
- Total execution time: ~28 minutes

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1     | 2     | 2     | ~4 min   |
| 2     | 2     | 2     | ~5 min   |
| 3     | 2     | 2     | ~3 min   |
| 4     | 2     | 2     | ~4.5 min |

*Updated after each plan completion*

## Accumulated Context

### Decisions

- [Roadmap]: Phase 5 prioritizes testing and tech debt cleanup -- every v2 feature depends on validated, clean code
- [Roadmap]: Templates (Phase 6) before Scheduling (Phase 7) -- scheduling depends on templates as its primary execution target
- [Roadmap]: Scheduling (Phase 7) before Collaboration (Phase 8) -- scheduled run reports need to be exportable, so export format designed with scheduled metadata
- [Roadmap]: v2 has 4 phases (5-8), 8 plans total -- matches "quick" depth calibration
- [Roadmap]: Each phase split into 2 plans -- backend first, then UI
- [01-01]: Dependency graph is strictly one-way: message-protocol has no imports; llm-client and tab-manager import only from message-protocol; agent-engine imports from all three; index.js imports from all
- [01-01]: callLLM/callLLMWithRetry pass CONFIG and agentState as parameters (not closures) for clean module boundaries
- [01-01]: getRelevantPatterns moved to llm-client.js, saveLearnedPattern stays in agent-engine.js
- [01-02]: SPA transition flag lives in dedicated shared-state.js (not message-protocol.js) to maintain pure utility invariant
- [01-02]: Stall detection uses `continue` for RESCAN_AND_REPLAN but not for FORCE_STRATEGY_SHIFT
- [02-01]: IIFE namespace pattern (window.__sentinelUtils) chosen over ES modules -- content scripts cannot use import/export
- [02-01]: Multi-file executeScript injection for module loading -- no build step required
- [02-01]: DOM polling (100ms/3s) for dropdown open detection -- simpler than MutationObserver for enterprise UIs
- [02-01]: attachShadow patch at document_start via manifest content_scripts for closed shadow root capture
- [02-01]: All dispatched events use { bubbles: true, composed: true } for shadow DOM boundary crossing
- [02-01]: Old content.js preserved as reference, not deleted
- [02-02]: Overlay detection is reactive (on action) not proactive -- avoids false positives on legitimate full-screen UIs
- [02-02]: Cross-origin iframe commands use two-step injection (utility files first, then command runner function) because inline functions cannot access separately loaded content script modules
- [02-02]: Frame index to Chrome frameId mapping is positional via webNavigation.getAllFrames
- [02-02]: dismissOverlay never removes elements from DOM -- only clicks close buttons or presses Escape
- [02-02]: Rich text editor APIs (Quill, TinyMCE, CKEditor) checked before execCommand fallback
- [03-01]: TabContext is in-memory Map only (no chrome.storage.session backup for v1)
- [03-01]: Agent-created tabs batch-closed at loop end; no cross-task tab persistence in v1
- [03-01]: User tab switches do NOT change agent's active tab (CONTEXT.md decision)
- [03-01]: Post-click new tab: registered as tracked context in multi-tab mode, captured in single-tab mode
- [03-01]: tab-context.js imports sendTabStateUpdate from message-protocol.js (acceptable one-way dep)
- [03-01]: handleTabRemoved exported from tab-context.js, called from index.js listener
- [03-02]: Tab context built inside callLLM, not passed as parameter, to keep function signature unchanged
- [03-02]: MANAGED TABS shows first 300 chars of page content for inactive tabs, not full element list
- [03-02]: Labels are the primary reference mechanism for LLM tab commands
- [03-02]: Popup tab clicks use chrome.tabs.update only, no background messaging (observation-only)
- [04-01]: Report generation is async (non-blocking) -- uses .then() after loop exit so "Task completed" appears immediately
- [04-01]: reportData snapshot captured BEFORE history is cleared, ensuring data survives cleanup
- [04-01]: Report LLM call is a dedicated fetch (not callLLMWithRetry) because report prompt has different format requirements
- [04-01]: Fallback report built from raw execution data when LLM call fails
- [04-01]: Report modal reuses existing .modal CSS class for consistent z-index and backdrop behavior
- [04-02]: Provider registry uses PROVIDERS object with per-provider methods (buildHeaders, buildBody, parseResponse) rather than class hierarchy
- [04-02]: Test connection handler in popup uses inline URL-based detection (cannot import background modules)
- [04-02]: Legacy migration removes old keys after creating new structure to prevent stale data
- [04-02]: Mid-task provider switching works transparently via getActiveProvider() on each call -- no context bridge needed for v1
- [04-02]: generatePlan() keeps flat settings parameter interface to minimize change surface

### Pending Todos

None.

### Blockers/Concerns

- [Research]: `{{key}}` delimiter collision in agent-engine.js -- must fix before templates ship (DEB-06)
- [Research]: `new Function()` in content/index.js -- security review needed (DEB-05)
- [Research]: In-memory state loss on service worker termination -- agent state must persist for scheduling
- [Research]: Malicious runbook import -- `execute_js` + `new Function()` makes untrusted import dangerous (COL-05)
- [Research]: Service worker 5-minute execution timeout for long scheduled runs
- [Research]: chrome.alarms may be cleared on browser restart -- must re-register in scheduler init()

## Session Continuity

Last session: 2026-05-04
Stopped at: v2 roadmap created -- 4 phases (5-8), 8 plans, 25/25 requirements mapped
Resume file: None
