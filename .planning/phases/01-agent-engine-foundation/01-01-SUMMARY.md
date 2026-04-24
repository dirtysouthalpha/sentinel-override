---
phase: 01-agent-engine-foundation
plan: 01
subsystem: architecture
tags: [chrome-extension, es-modules, message-passing, service-worker, refactoring]

# Dependency graph
requires: []
provides:
  - "background/ directory with 5 focused ES modules"
  - "Standardized { ok, data, error } message envelope across all components"
  - "Clean one-way dependency graph with no circular imports"
  - "Content script re-injection guard preventing duplicate listeners"
affects: [01-02, 02-01, 02-02, 03-01, 04-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ES module architecture with strict one-way dependency graph"
    - "{ ok, data, error } response envelope for all message passing"
    - "wrapMessageHandler pattern for async message listeners"

key-files:
  created:
    - background/index.js
    - background/message-protocol.js
    - background/agent-engine.js
    - background/llm-client.js
    - background/tab-manager.js
  modified:
    - content.js
    - manifest.json
    - popup-full.js

key-decisions:
  - "Strict one-way dependency: message-protocol -> llm-client/tab-manager -> agent-engine -> index.js"
  - "content.js follows envelope pattern manually (no ES module imports in content scripts)"
  - "saveLearnedPattern stays in agent-engine.js (needs agentMemory), getRelevantPatterns moved to llm-client.js (called from callLLM prompt building)"
  - "callLLM/callLLMWithRetry receive CONFIG and agentState as parameters instead of closure access"

patterns-established:
  - "Message envelope: all sendResponse calls use { ok: boolean, data?: any, error?: string }"
  - "wrapMessageHandler: async handler wrapper that returns true and handles ok/error envelope"
  - "Module dependency direction: utility -> infrastructure -> core -> entry point"

# Metrics
duration: 0min
completed: 2026-04-24
---

# Phase 1 Plan 01: Refactor background.js into modular components Summary

**Split monolithic 1,232-line background.js into 5 focused ES modules with standardized { ok, data, error } message envelope across all extension components**

## Performance

- **Duration:** plan execution (commits already exist)
- **Started:** 2026-04-24
- **Completed:** 2026-04-24
- **Tasks:** 2/2
- **Files modified:** 8

## Accomplishments
- Split background.js into 5 focused ES modules under background/ with clean one-way dependency graph
- Standardized all message passing to use { ok, data, error } response envelope across content.js, background modules, and popup
- Added __sentinelInitialized re-injection guard in content.js to prevent duplicate listener registration
- Updated manifest.json service_worker entry and popup-full.js to work with new module structure

## Task Commits

Each task was committed atomically:

1. **Task 1: Create message-protocol.js and refactor content.js error handling** - `d206fed` (feat)
2. **Task 2: Split background.js into modular components and wire through index.js** - `79b7eb9` (feat)

## Files Created/Modified
- `background/index.js` - Service worker entry point with message routing, imports all modules
- `background/message-protocol.js` (149 lines) - Standardized message send/receive wrappers with { ok, data, error } envelope. Zero imports from other modules.
- `background/agent-engine.js` (556 lines) - Agent loop, planning, self-healing, state management. Exports startAgent, stopAgent, resetAgentState, agentRunning, agentTabId.
- `background/llm-client.js` (514 lines) - API calls, retry logic, response parsing, vision detection, platform context. Exports callLLMWithRetry, callLLM, generatePlan, supportsVision, isAnthropicEndpoint, extractFirstJsonObject, parseLLMResponse.
- `background/tab-manager.js` (142 lines) - Tab locking, page load waiting, content script injection, screenshot capture. Exports waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl, getTabInfo.
- `content.js` - Added __sentinelInitialized re-injection guard, all responses use { ok, data, error } envelope, removed duplicate functions from bottom of file.
- `manifest.json` - Updated service_worker to background/index.js.
- `popup-full.js` - Updated sendMessage callbacks to check response.ok.

## Decisions Made
- **Strict one-way dependency graph**: message-protocol.js has no imports; llm-client.js and tab-manager.js import only from message-protocol.js; agent-engine.js imports from all three; index.js imports from all modules. This eliminates circular dependency risk.
- **content.js follows envelope pattern manually**: Content scripts cannot use ES module imports, so the { ok, data, error } contract is enforced by convention rather than a shared module.
- **saveLearnedPattern vs getRelevantPatterns split**: saveLearnedPattern stays in agent-engine.js because it needs access to agentMemory; getRelevantPatterns moved to llm-client.js because it is called from callLLM prompt building and has no agent state dependencies.
- **Parameter passing over closures**: callLLM and callLLMWithRetry receive CONFIG and agentState as explicit parameters instead of relying on closure access, maintaining clean module boundaries.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed duplicate functions from content.js**
- **Found during:** Task 1 (Create message-protocol.js and refactor content.js)
- **Issue:** Duplicate function declarations (getUniqueSelector, getNthOfTypePath, findElementBySelector, removeHighlight) at the bottom of content.js. This was a pre-existing copy-paste bug that would cause "function already declared" errors.
- **Fix:** Removed the duplicate block at the bottom of the file, keeping only the original declarations.
- **Files modified:** content.js
- **Committed in:** d206fed (Task 1 commit)

**2. [Rule 1 - Bug] Adjusted callLLM/callLLMWithRetry signatures**
- **Found during:** Task 2 (Split background.js into modular components)
- **Issue:** Original functions relied on closure access to CONFIG and agentState, which breaks when extracted into a separate module.
- **Fix:** Changed signatures to accept CONFIG and agentState as explicit parameters, maintaining clean module boundaries without shared mutable state.
- **Files modified:** background/llm-client.js, background/agent-engine.js
- **Committed in:** 79b7eb9 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Modular background architecture is in place and ready for 01-02 (stall detection, planning accuracy, SPA handling)
- The clean module boundaries make it straightforward to add stall detection in agent-engine.js and SPA handling in tab-manager.js
- No blockers or concerns for next plan

---
*Phase: 01-agent-engine-foundation*
*Completed: 2026-04-24*
