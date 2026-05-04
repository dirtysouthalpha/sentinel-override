# Research Summary: Sentinel Override v2

**Synthesized:** 2026-05-04
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

## Stack Additions

- **Vitest 4.1.5** — Test runner with native ESM support (no build step needed)
- **happy-dom** — DOM environment for content script unit tests (faster than jsdom, better MutationObserver support)
- **Custom Chrome API mock** — Lightweight stateful mock for ~9 Chrome namespaces (~30 methods). No sinon-chrome (outdated, no MV3 APIs)
- **All new packages are devDependencies only** — Extension runtime stays dependency-free

## Feature Landscape

### Templates (Foundation)
- **Table stakes:** Save goal + extracted parameters as reusable template, parameter prompt UI, tag-based organization, execute from template library
- **Differentiators:** Create template from task history, variable validation, template versioning
- **Anti-features:** Template marketplace, server-side template storage, visual template builder

### Scheduling (Depends on Templates)
- **Table stakes:** Schedule template execution at specific time, recurring schedules (daily/weekly), view scheduled tasks, cancel scheduled tasks
- **Differentiators:** Cron-like flexibility, timezone support, scheduled task result history
- **Anti-features:** Real-time scheduling dashboard, multi-user scheduling conflicts

### Collaboration (Depends on Templates + Reports)
- **Table stakes:** Export template as JSON file, import template from JSON, export report as markdown, share via clipboard
- **Differentiators:** Template format versioning for forward compatibility, duplicate ID handling on import
- **Anti-features:** Server-side team storage, real-time collaboration, commenting on reports

## Architecture Integration

### New Modules
- `background/template-manager.js` (Layer 2) — Template CRUD, variable substitution, history-to-template conversion
- `background/scheduler.js` (Layer 3) — Alarm management, task queue, scheduled execution
- Popup split into 7 modules via `<script type="module">` with `window.__popupState` shared state

### Dependency Changes
- `message-protocol.js` — Minimal (~30 lines, 2 new fire-and-forget functions)
- `index.js` — 14 new message type handlers
- No existing modules need restructuring

### Build Order
1. **Testing + Tech Debt** (safety net for all subsequent work)
2. **Templates** (foundation for scheduling and collaboration)
3. **Scheduling** (depends on templates)
4. **Collaboration** (depends on templates + reports)

## Key Pitfalls

### Critical (4)
1. **Chrome API callback mocking** — Tests must handle callback-based APIs correctly
2. **`{{key}}` delimiter collision** — Must change to collision-proof delimiter before templates ship
3. **In-memory state loss on service worker termination** — Agent state must persist for scheduling
4. **Malicious runbook import** — `execute_js` + `new Function()` makes untrusted import dangerous

### Important (5)
5. Service worker 5-minute execution timeout for long scheduled runs
6. Template storage growing unbounded (no cleanup mechanism)
7. chrome.alarms may be cleared on browser restart (must re-register)
8. Report format versioning (old reports incompatible with new format)
9. Large export files for template libraries

### Minor (6)
10-15: Test brittleness with LLM responses, template variable naming, popup module split state management, notification permission UX, timezone handling, scheduled result auto-purge

## New Permissions Needed
- `"alarms"` — For scheduled task execution
- `"notifications"` — For scheduled task completion alerts

## Open Questions (Decisions for Planning)
- Cron presets vs full cron parser for recurring schedules
- Import conflict resolution (overwrite, skip, rename)
- Scheduled result retention policy (indefinite vs auto-purge)
- Timezone handling (local only vs timezone-aware)
- Service worker timeout mitigation for long runs (progress checkpointing vs shorter goals)
