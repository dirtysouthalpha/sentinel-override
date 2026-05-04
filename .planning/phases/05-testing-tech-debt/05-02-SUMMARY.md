---
phase: 05-testing-tech-debt
plan: 02
subsystem: tech-debt
tags: [refactoring, template-delimiter, security-review, popup-modules, llm-prompt]

# Dependency graph
requires:
  - phase: 05-01
    provides: "Test infrastructure with 216 passing tests (vitest, chrome-mock, content script exports)"
provides:
  - "Legacy content.js deleted (581 lines removed)"
  - "LLM prompt updated with BUILT-IN UI CAPABILITIES section (shadow DOM, dropdowns, overlays, rich text editors, iframes)"
  - "New action types: dismiss_overlay, switch_to_frame"
  - "Deprecated isAnthropicEndpoint export removed from llm-client.js"
  - "Template delimiter changed from {{key}} to ::key:: (collision-proof)"
  - "new Function() security risk documented in content/index.js"
  - "popup-full.js split into 3 focused modules + bootstrap (1571 -> 50 lines)"
affects: [06-templates, 07-scheduling, 08-collaboration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Popup module pattern: ui-common.js, settings.js, chat.js loaded via regular <script> tags with shared global scope"
    - "Template delimiter: ::key:: syntax for agent memory substitution (collision-proof, no conflict with mustache/handlebars)"
    - "BUILT-IN UI CAPABILITIES: LLM prompt section describing automatic capabilities (shadow DOM, dropdowns, overlays, rich text editors, iframes)"

key-files:
  created:
    - "popup-modules/ui-common.js"
    - "popup-modules/settings.js"
    - "popup-modules/chat.js"
  modified:
    - "popup-full.js (rewritten as 50-line bootstrap)"
    - "popup.html (added 3 script tags for popup-modules/)"
    - "background/llm-client.js (updated prompt, removed deprecated export, added action types)"
    - "background/agent-engine.js (fixed template delimiter)"
    - "content/index.js (added security review comment)"
  deleted:
    - "content.js (legacy 581-line monolithic content script)"

key-decisions:
  - "Regular <script> tags for popup modules (NOT type=module) -- simpler global scope sharing matches existing pattern"
  - "window.__popupState shared state object for cross-module communication in popup"
  - "BUILT-IN UI CAPABILITIES section placed between RULES and Actions in LLM prompt for natural reading flow"
  - "dismiss_overlay and switch_to_frame added as new action types with validTypes validation"
  - "KEPT new Function() for v2 -- documented risk with detailed comment block, deferred sandboxing to future"
  - "Removed emoji characters from chat.js command palette icons (text-only fallback for safety)"

patterns-established:
  - "Popup module loading order: ui-common.js -> settings.js -> chat.js -> popup-full.js (bootstrap)"
  - "Shared state via window.__popupState accessed through getState() helper in each module"
  - "Each popup module is a plain script defining global functions, no ES module imports/exports"

# Metrics
duration: 4min
completed: 2026-05-04
---

# Phase 5 Plan 02: Tech Debt Cleanup Summary

**Split 1571-line popup monolith into 3 focused modules, fixed {{key}} template collision, deleted legacy content.js, updated LLM prompt with UI capabilities, and documented security risk**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-04T16:19:19Z
- **Completed:** 2026-05-04T16:24:15Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Deleted legacy content.js (581 lines) -- replaced by modular content/ directory since Phase 2
- Updated LLM prompt with BUILT-IN UI CAPABILITIES section and two new action types (dismiss_overlay, switch_to_frame)
- Fixed template delimiter collision: {{key}} changed to ::key:: across agent-engine.js (3 lines) and llm-client.js (4 prompt references)
- Removed deprecated isAnthropicEndpoint export from llm-client.js
- Documented new Function() security risk with 22-line comment block in content/index.js
- Split popup-full.js from 1571 lines into: ui-common.js (47), settings.js (410), chat.js (1108), bootstrap (50)

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete legacy content.js, update LLM prompt, remove deprecated export, fix delimiter, document security risk** - `94f68f0` (feat)
2. **Task 2: Split popup-full.js into focused modules** - `1b35510` (feat)

## Files Created/Modified
- `popup-modules/ui-common.js` - Shared utilities: sanitizeHtml, isValidUrl, showToast, marked config (47 lines)
- `popup-modules/settings.js` - Theme management, provider switching, settings modal, test connection, presets (410 lines)
- `popup-modules/chat.js` - Chat UI, messages, action cards, reports, command palette, search, export, voice input, background message handler (1108 lines)
- `popup-full.js` - Rewritten as slim bootstrap: global state, DOMContentLoaded init, modal close handlers (50 lines)
- `popup.html` - Added 3 script tags loading popup-modules/ before popup-full.js
- `background/llm-client.js` - Added BUILT-IN UI CAPABILITIES, dismiss_overlay/switch_to_frame actions, removed isAnthropicEndpoint, fixed ::key:: delimiter in prompt
- `background/agent-engine.js` - Fixed template delimiter from {{key}} to ::key:: (3 substitution lines)
- `content/index.js` - Added 22-line SECURITY REVIEW comment block above new Function() call
- `content.js` - DELETED (581-line legacy monolithic content script)

## Decisions Made
- Regular `<script>` tags for popup modules -- global scope sharing is simpler than ES modules and matches existing popup-full.js pattern
- `window.__popupState` as shared state object -- accessed via `getState()` helper in each module
- BUILT-IN UI CAPABILITIES placed between RULES and Actions in LLM prompt -- natural reading order
- KEPT new Function() for v2 -- agent's core value depends on it; documented risk and deferred sandboxing

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Codebase is clean and ready for v2 feature development
- Template delimiter ::key:: is collision-proof for Phase 6 (Templates)
- Popup module split makes adding template/scheduling UI straightforward (new module or extend existing)
- All 216 tests pass -- validated foundation for new features
- Remaining concern from STATE.md: in-memory state loss on service worker termination (needs addressing for Phase 7 Scheduling)

---
*Phase: 05-testing-tech-debt*
*Completed: 2026-05-04*
