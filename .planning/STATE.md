# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-04)

**Core value:** Give a command in any form and the agent drives the browser to completion, then generates a structured report.
**Current focus:** v2 milestone -- testing, tech debt, templates, scheduling, collaboration

## Current Position

Phase: 7 of 8 -- Agent Scheduling
Plan: 2 of 2 (Complete)
Status: Phase complete
Last activity: 2026-05-04 -- Completed 07-02-PLAN.md

Progress: [████████░░░░░░░] 62.5% (v2, 5/8 plans -- phases 1-7 done)

## Performance Metrics

**Velocity:**
- Total plans completed: 14 (v1: 8, v2: 6)
- Average duration: ~4 min/plan
- Total execution time: ~60 minutes

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1     | 2     | 2     | ~4 min   |
| 2     | 2     | 2     | ~5 min   |
| 3     | 2     | 2     | ~3 min   |
| 4     | 2     | 2     | ~4.5 min |
| 5     | 2     | 2     | ~12.5 min |
| 6     | 2     | 2     | ~2 min   |
| 7     | 2     | 2     | ~3.5 min |

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
- [05-01]: Used `beforeAll` instead of `beforeEach` for content script imports -- IIFEs only execute once per module load; resetting `window.__sentinelUtils` between tests breaks the namespace
- [05-01]: Patched `getBoundingClientRect` in test fixtures -- happy-dom does not implement layout calculations, so all elements have 0x0 dimensions, breaking `isVisible()` checks
- [05-01]: Content script testability achieved via `export const X = window.__sentinelUtils.X;` at end of each IIFE -- no production behavior change
- [05-01]: Vitest v4 removed `--include` flag -- test scripts use positional path arguments instead
- [05-02]: Regular `<script>` tags for popup modules (NOT type=module) -- global scope sharing is simpler than ES modules
- [05-02]: window.__popupState shared state object for cross-module communication in popup
- [05-02]: BUILT-IN UI CAPABILITIES section in LLM prompt describes automatic capabilities (shadow DOM, dropdowns, overlays, rich text editors, iframes)
- [05-02]: Template delimiter changed from {{key}} to ::key:: -- collision-proof for templates
- [05-02]: KEPT new Function() for v2 -- documented risk with detailed comment block, deferred sandboxing
- [05-02]: Legacy content.js deleted -- replaced by modular content/ directory since Phase 2
- [05-02]: isAnthropicEndpoint export removed from llm-client.js -- resolveProvider from provider-registry.js is the replacement
- [06-01]: Template storage uses object-keyed pattern { [id]: Template } in chrome.storage.local -- avoids array reindexing, O(1) lookup
- [06-01]: Auto-param extraction from goal text when params not provided; re-extracted on goal update unless explicitly overridden
- [06-01]: Unresolved ::key:: placeholders left as-is when no value/default provided -- user sees what was skipped
- [06-01]: template-manager.js is Layer 2 (zero imports from other background modules) -- pure chrome.storage.local utility
- [06-01]: Usage tracking (lastUsedAt, runCount) updated inside resolveTemplateGoal at agent start
- [06-02]: templatesBtn click handler lives only in popup-full.js bootstrap, not duplicated in templates.js
- [06-02]: escapeHtml helper duplicated per popup module (no shared utility module for popup)
- [06-02]: Template panel uses inline style display:none/flex toggle rather than CSS class
- [07-01]: Polling approach for agent completion (setInterval every 2s checking agentRunning) -- service worker stays alive during API calls
- [07-01]: One-time schedules auto-disable after execution to prevent stale alarm re-registration
- [07-01]: Schedule storage follows same object-keyed pattern as templates: { [id]: Schedule } in chrome.storage.local
- [07-01]: initScheduler() re-registers all enabled alarms on service worker restart (handles browser restart alarm loss)
- [07-01]: Scheduler skips execution if agentRunning=true, marks lastRunStatus='skipped', re-registers alarm for recurring
- [07-01]: Result storage capped at 50 entries per schedule with oldest evicted first
- [07-02]: Scheduler panel uses same mutual exclusion pattern as templates panel (show one, hide others)
- [07-02]: Form field toggling via display:none/flex rather than dynamic DOM generation for simplicity
- [07-02]: Event delegation on schedules-panel container for data-action button routing (matches templates.js pattern)
- [07-02]: Templates cached in module scope to avoid redundant template_list calls during form interactions
- [07-02]: Badge cleared on every panel open via schedule_clear_badge message to background

### Pending Todos

None.

### Blockers/Concerns

- ~~[Research]: `{{key}}` delimiter collision in agent-engine.js~~ -- FIXED: changed to ::key::
- ~~[Research]: `new Function()` in content/index.js -- security review needed~~ -- DONE: documented with SECURITY REVIEW comment block
- [Research]: In-memory state loss on service worker termination -- agent state must persist for scheduling
- [Research]: Malicious runbook import -- `execute_js` + `new Function()` makes untrusted import dangerous (COL-05)
- [Research]: Service worker 5-minute execution timeout for long scheduled runs
- ~~[Research]: chrome.alarms may be cleared on browser restart -- must re-register in scheduler init()~~ -- DONE: initScheduler() re-registers all enabled alarms

## Session Continuity

Last session: 2026-05-04
Stopped at: Completed 07-02-PLAN.md (scheduler popup UI)
Resume file: None
