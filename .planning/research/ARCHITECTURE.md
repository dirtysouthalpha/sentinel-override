# Architecture Research: V2 Feature Integration

**Project:** Sentinel Override v2
**Researched:** 2026-05-04
**Overall confidence:** HIGH (full codebase read, all 10 background modules + popup + content scripts analyzed)

## Executive Summary

The existing v1 architecture has a clean one-way dependency graph across 10 background ES modules, 9 content script IIFE utilities, and a monolithic popup. V2 features (test infrastructure, command templates, agent scheduling, collaboration) slot into this graph at well-defined integration points without requiring restructuring of existing modules. The most significant architectural challenge is popup-full.js at 1,571 lines -- it must be split before adding template/scheduling UI to prevent further bloat. Testing should precede all feature work because the current zero-test baseline means every v2 change is unvalidated.

## Current Dependency Graph (v1)

```
                            index.js (entry + message routing)
                           /    |    \     \     \      \
                          /     |     \     \     \      \
                   agent-  tab-  frame-  shared- report-  provider-
                   engine   ctx    router  state   gen      registry
                    / | \    | |                    |
                   /  |  \   | |                    |
                  llm- tab- msg-  msg-              msg-  provider-
                  client mgr proto  proto            proto  registry
                       |        \   /
                       |     tab-mgr
                       |
                    msg-proto
```

**Layer 0 (no imports):** `message-protocol.js`, `shared-state.js`
**Layer 1 (imports from L0 only):** `tab-manager.js`, `provider-registry.js`
**Layer 2 (imports from L0+L1):** `llm-client.js`, `tab-context.js`
**Layer 3 (imports from L0+L1+L2):** `agent-engine.js`, `report-generator.js`
**Layer 4 (imports everything):** `index.js`, `frame-router.js`

**Key invariant:** No circular dependencies. `message-protocol.js` and `shared-state.js` are pure leaf nodes that import nothing.

## V2 Module Integration Map

### Q1: Where does template-manager.js fit in the dependency graph?

`background/template-manager.js` belongs at **Layer 2** -- same tier as `llm-client.js` and `tab-context.js`.

```
template-manager.js
  imports from: message-protocol.js (L0), shared-state.js (L0) [optional]
  imported by: agent-engine.js (L3), index.js (L4)
  stores data: chrome.storage.local (templates key)
```

**Recommended exports:**

```javascript
// CRUD operations
export async function listTemplates() -> Array<Template>
export async function getTemplate(id) -> Template | null
export async function saveTemplate(template) -> Template
export async function deleteTemplate(id) -> void
export async function duplicateTemplate(id) -> Template

// Execution bridge
export async function resolveTemplateGoal(templateId, params) -> string
// Takes a template's goal string with {{param}} placeholders and returns
// a concrete goal string with params substituted. This is what agent-engine
// receives as its `goal` parameter.

// Template shape
// { id: string, name: string, goal: string, params: Array<{key, label, default}>,
//   createdAt: number, updatedAt: number, lastUsedAt: number, runCount: number }
```

**Why NOT Layer 3:** Template manager does not need to call the agent loop. It stores templates and resolves goal strings. The actual execution happens when `index.js` receives a `run_template` message and calls `startAgent()` with the resolved goal.

**Integration with agent-engine.js:** Zero changes to agent-engine.js internals. `startAgent(goal, sender)` already accepts a plain string goal. Template resolution happens BEFORE `startAgent` is called, in `index.js`:

```
User clicks "Run Template" in popup
  -> popup sends { action: 'run_template', templateId, params }
  -> index.js receives message
  -> index.js imports resolveTemplateGoal from template-manager.js
  -> const goal = await resolveTemplateGoal(templateId, params)
  -> await startAgent(goal, sender)
```

This is critical: `agent-engine.js` does not need to know templates exist. The template system is a goal-preprocessing layer, not an execution layer.

### Q2: How does scheduler.js interact with agent-engine.js?

`background/scheduler.js` belongs at **Layer 3** -- same tier as `agent-engine.js`.

```
scheduler.js
  imports from: message-protocol.js (L0), template-manager.js (L2)
  imported by: index.js (L4)
  uses: chrome.alarms API
  stores data: chrome.storage.local (schedules key)
```

**Critical constraint: `chrome.alarms` requires the `"alarms"` permission in manifest.json.** Current manifest does NOT include this permission.

**Recommended exports:**

```javascript
export async function createSchedule(schedule) -> Schedule
export async function listSchedules() -> Array<Schedule>
export async function deleteSchedule(id) -> void
export async function toggleSchedule(id, enabled) -> void
export async function getNextRunTime(schedule) -> number | null

// Called from chrome.alarms.onAlarm listener in index.js
export async function executeScheduledTask(alarmName) -> void
```

**Schedule shape:**

```javascript
// { id: string, name: string,
//   type: 'once' | 'recurring',
//   cronExpression: string | null,  // for recurring (e.g., "0 9 * * 1-5")
//   runAt: number | null,           // timestamp for once
//   templateId: string | null,      // if template-based
//   goal: string | null,            // if freeform goal
//   params: object | null,          // template parameters
//   enabled: boolean,
//   lastRunAt: number | null,
//   lastRunStatus: 'success' | 'failure' | null,
//   createdAt: number }
```

**Interaction with agent-engine.js -- the scheduling problem:**

This is the trickiest v2 integration point. `chrome.alarms` fires in the service worker, but the agent needs an active tab to operate on. When an alarm fires:

1. **No tab is open:** The scheduler must open a new tab to the target URL (if specified in the template/goal) or to a default starting page.
2. **A tab is open but not the right one:** Navigate to the target URL.
3. **Agent is already running:** Skip this scheduled run (do not interrupt the active agent).

**Recommended flow:**

```
chrome.alarms.onAlarm fires in index.js
  -> index.js calls scheduler.executeScheduledTask(alarm.name)
  -> scheduler.js:
     1. Check if agent is running (import agentRunning from agent-engine.js)
     2. If running, skip (log + update lastRunStatus = 'skipped')
     3. Load schedule from storage
     4. If templateId, resolve goal via template-manager
     5. Find or open a tab
     6. Call startAgent(goal, { tab: { id: tabId } })
```

**IMPORTANT: scheduler.js must import `agentRunning` from agent-engine.js.** This creates a Layer 3 -> Layer 3 dependency, which is acceptable because it is a state read, not a function call. `agentRunning` is a boolean export, not a mutable reference.

**MV3 service worker lifecycle concern:** Service workers can be terminated after 30 seconds of inactivity and restarted when an alarm fires. This means:
- Scheduled state must persist in `chrome.storage.local`, not in-memory variables.
- The `chrome.alarms.onAlarm` listener must be registered in `index.js` (the entry point), not in `scheduler.js`, because event listeners must be registered synchronously at the top level of the service worker.
- `scheduler.js` should export an `init()` function that `index.js` calls to set up any necessary state restoration from storage.

### Q3: What changes to message-protocol.js are needed?

**message-protocol.js should remain a pure utility module (L0).** Do NOT add template or scheduling logic to it.

Instead, add new message types to the **action string constants** and document them. The actual routing stays in `index.js`.

**New message actions needed:**

```
// Template CRUD (popup <-> background)
'template_list'       -> listTemplates() -> Array<Template>
'template_get'        -> getTemplate(id) -> Template
'template_save'       -> saveTemplate(template) -> Template
'template_delete'     -> deleteTemplate(id) -> void
'template_run'        -> resolveTemplateGoal(id, params) -> startAgent(goal)
'template_export'     -> getTemplate(id) + metadata -> JSON blob
'template_import'     -> validate + saveTemplate(parsed) -> Template

// Schedule CRUD (popup <-> background)
'schedule_list'       -> listSchedules() -> Array<Schedule>
'schedule_create'     -> createSchedule(schedule) -> Schedule
'schedule_delete'     -> deleteSchedule(id) -> void
'schedule_toggle'     -> toggleSchedule(id, enabled) -> void
'schedule_get_status' -> getNextRunTime(id) + lastRunAt -> status object

// Collaboration (popup <-> background)
'export_report'       -> read from storage -> JSON blob
'import_report'       -> validate + write to storage -> void
'export_all_data'     -> bundle templates + settings + reports -> JSON
'import_all_data'     -> validate + merge into storage -> import summary
```

**New fire-and-forget message functions for message-protocol.js:**

These ARE acceptable additions because they follow the existing pattern (sendSilentUpdate, sendActionMessage, etc.):

```javascript
// Send template update to popup (e.g., during scheduled run)
export function sendTemplateUpdate(status, template) -> void

// Send schedule status update to popup
export function sendScheduleUpdate(scheduleId, status, nextRun) -> void
```

**Estimated additions to message-protocol.js:** ~30 lines (two new send functions). No imports added.

**New switch cases in index.js `wrapMessageHandler`:**

```javascript
case 'template_list':    return await listTemplates();
case 'template_get':     return await getTemplate(request.id);
case 'template_save':    return await saveTemplate(request.template);
case 'template_delete':  return await deleteTemplate(request.id);
case 'template_run': {
  const goal = await resolveTemplateGoal(request.templateId, request.params);
  return await startAgent(goal, sender);
}
case 'template_export':  return await exportTemplate(request.id);
case 'template_import':  return await importTemplate(request.data);
case 'schedule_list':    return await listSchedules();
case 'schedule_create':  return await createSchedule(request.schedule);
case 'schedule_delete':  return await deleteSchedule(request.id);
case 'schedule_toggle':  return await toggleSchedule(request.id, request.enabled);
case 'export_all_data':  return await exportAllData();
case 'import_all_data':  return await importAllData(request.data);
```

### Q4: How to structure popup-full.js additions without making it more bloated?

**popup-full.js at 1,571 lines is already the #1 maintainability risk in the codebase.** Adding template CRUD UI, schedule management UI, and collaboration UI directly would push it past 2,500 lines.

**Recommended approach: Split into ES modules loaded via `<script type="module">`**

The popup already loads `marked.min.js` as a separate script. We can add module scripts:

```html
<!-- popup.html additions -->
<script type="module" src="popup-modules/settings.js"></script>
<script type="module" src="popup-modules/templates.js"></script>
<script type="module" src="popup-modules/scheduler-ui.js"></script>
<script type="module" src="popup-modules/collaboration.js"></script>
<script type="module" src="popup-modules/chat.js"></script>
```

**Proposed popup module split:**

| Module | Lines (est.) | Responsibility | Extracted from |
|--------|-------------|----------------|----------------|
| `popup-modules/chat.js` | ~400 | Goal input, send, message rendering, action cards, typing indicator | Lines 1-620 of popup-full.js |
| `popup-modules/settings.js` | ~200 | Provider switching, settings modal, save/load, connection test | Lines 334-706 |
| `popup-modules/templates.js` | ~250 | Template list, create/edit form, parameter inputs, run button | NEW |
| `popup-modules/scheduler-ui.js` | ~200 | Schedule list, create form, cron picker, enable/disable toggle | NEW |
| `popup-modules/collaboration.js` | ~150 | Export/import buttons, JSON download/upload, share format | NEW |
| `popup-modules/ui-common.js` | ~150 | Toast, sanitize, isValidUrl, markdown config, modal helpers | Lines 1200-1250 + scattered utils |
| `popup-full.js` (bootstrap) | ~200 | DOMContentLoaded init, chrome.runtime.onMessage routing, module wiring | Remaining orchestration |

**Total: ~1,550 lines across 7 files vs 1,571 in one file.** The win is not line count reduction -- it is separation of concerns. Each module can be understood and tested independently.

**Critical constraint: `<script type="module">` works in extension pages.** Manifest V3 supports module scripts in extension pages (popup, options, sidePanel). This was confirmed in the existing manifest where the service worker already uses `"type": "module"`.

**Shared state across modules:** Use a simple shared state object on `window`:

```javascript
// popup-full.js (bootstrap) sets up shared state
window.__popupState = {
  conversationHistory: [],
  selectedAttachments: [],
  activeProviderId: 'anthropic',
  providerConfigs: {},
  currentReportMarkdown: null,
  isAgentRunning: false,
};
```

**Alternative considered: Keep popup-full.js monolithic.** Rejected because adding 3 new feature UIs (templates, scheduling, collaboration) to an already-large file would make it unmaintainable and untestable. The split is justified.

**Migration strategy:** Extract modules incrementally. Start with `ui-common.js` (lowest risk), then `settings.js`, then `chat.js`. The new feature modules (templates, scheduler-ui, collaboration) are written as modules from the start. The bootstrap file gradually shrinks as code moves out.

### Q5: What is the build order for these features?

**Testing MUST come first.** The current codebase has zero tests. Every subsequent feature will be built on unvalidated code.

```
Phase 1: Test Infrastructure + Tech Debt Cleanup
  1a. Test runner setup (Vitest recommended)
  1b. Chrome API mocks (chrome.storage, chrome.tabs, chrome.runtime, chrome.alarms)
  1c. Unit tests for content script utilities (dom-utils, shadow-dom, wait-utils)
  1d. Unit tests for message-protocol.js (pure functions, easy to test)
  1e. Integration tests for tab-context.js (in-memory state, no Chrome deps)
  1f. Delete legacy content.js
  1g. Split popup-full.js into modules

Phase 2: Command Templates (ADV-01)
  2a. template-manager.js (CRUD, storage, export/import)
  2b. Template message routing in index.js
  2c. Template UI in popup (popup-modules/templates.js)
  2d. Tests for template CRUD and goal resolution

Phase 3: Agent Scheduling (ADV-02)
  3a. Add "alarms" permission to manifest.json
  3b. scheduler.js (CRUD, chrome.alarms integration, execution bridge)
  3c. Schedule message routing in index.js
  3d. Schedule UI in popup (popup-modules/scheduler-ui.js)
  3e. Tests for schedule lifecycle (create, fire, execute, skip)

Phase 4: Collaboration (ADV-03)
  4a. Shareable JSON format specification (reports + templates)
  4b. Export/import logic in background
  4c. Collaboration UI in popup (popup-modules/collaboration.js)
  4d. Tests for import validation and data integrity
```

**Phase ordering rationale:**

1. **Testing first** because every subsequent feature needs regression safety. Without tests, Phase 2/3/4 changes could silently break v1 functionality.
2. **Templates before scheduling** because scheduling depends on templates (a scheduled task is either template-based or freeform; template-based is the primary use case).
3. **Scheduling before collaboration** because scheduled run reports need to be exportable, so the export format must be designed with scheduled task metadata in mind.
4. **Collaboration last** because it is purely additive (export/import) and depends on both templates and reports existing.

## Updated Dependency Graph (v2 Target)

```
Layer 0 (no imports):
  message-protocol.js
  shared-state.js

Layer 1 (imports L0):
  tab-manager.js
  provider-registry.js

Layer 2 (imports L0+L1):
  llm-client.js
  tab-context.js
  template-manager.js    [NEW]

Layer 3 (imports L0+L1+L2):
  agent-engine.js
  report-generator.js
  scheduler.js            [NEW - imports agentRunning from agent-engine]

Layer 4 (imports everything):
  index.js                [MODIFIED - new message handlers + alarm listener]
  frame-router.js
```

## New Module Responsibilities

### template-manager.js (~200 lines)

| Responsibility | Details |
|---------------|---------|
| Template CRUD | Create, read, update, delete templates in chrome.storage.local |
| Goal resolution | Substitute {{param}} placeholders with user-provided values |
| Template validation | Validate template shape, prevent empty goals, limit param count |
| Export/import | Serialize/deserialize templates to/from shareable JSON |
| Usage tracking | Update lastUsedAt and runCount on each execution |

**Storage key:** `templates` in chrome.storage.local
**Storage shape:** `{ [id]: Template }`

### scheduler.js (~250 lines)

| Responsibility | Details |
|---------------|---------|
| Schedule CRUD | Create, read, update, delete schedules in chrome.storage.local |
| Alarm management | Create/clear chrome.alarms for each schedule |
| Execution bridge | When alarm fires: check agent state, resolve goal, start agent |
| Lifecycle management | Enable/disable schedules, handle service worker restart |
| Run history | Track lastRunAt, lastRunStatus for each schedule |

**Storage key:** `schedules` in chrome.storage.local
**Storage shape:** `{ [id]: Schedule }`

**MV3 service worker concern:** On service worker restart, `scheduler.js` must re-register all enabled alarms from storage. This happens in `init()`:

```javascript
export async function init() {
  const schedules = await listSchedules();
  for (const s of schedules) {
    if (s.enabled) {
      await registerAlarm(s);
    }
  }
}
```

### popup-modules/templates.js (~250 lines)

| Responsibility | Details |
|---------------|---------|
| Template list UI | Render template cards with name, last used, run count |
| Create/edit form | Name, goal text, parameter definitions (key/label/default) |
| Run button | Collect parameter values from user, send template_run message |
| Delete/duplicate | Template management actions |
| Parameter form | Dynamic form generated from template's params array |

### popup-modules/scheduler-ui.js (~200 lines)

| Responsibility | Details |
|---------------|---------|
| Schedule list UI | Show schedules with name, frequency, next run, last status |
| Create form | Name, type (once/recurring), template selector or freeform goal, time picker |
| Cron picker | Simple UI for common schedules (daily, weekly, M-F 9am, etc.) |
| Enable/disable toggle | Per-schedule on/off switch |
| Run history | Show last N run statuses |

### popup-modules/collaboration.js (~150 lines)

| Responsibility | Details |
|---------------|---------|
| Export button | Download templates/reports/settings as JSON |
| Import button | Upload JSON, validate, merge into storage |
| Share format | Standardized JSON schema for cross-team sharing |
| Import preview | Show what will be imported before confirming |

## Manifest.json Changes Required

```json
{
  "permissions": [
    "activeTab",
    "scripting",
    "tabs",
    "sidePanel",
    "storage",
    "debugger",
    "webNavigation",
    "alarms"          // NEW - required for agent scheduling
  ]
}
```

No other manifest changes needed. The popup modules use `<script type="module">` which is already supported.

## Integration Points Summary

| Integration Point | Location | Change Type | Risk |
|------------------|----------|-------------|------|
| Template message routing | `background/index.js` switch statement | Add 7 cases | LOW - additive |
| Schedule message routing | `background/index.js` switch statement | Add 5 cases | LOW - additive |
| Alarm listener | `background/index.js` top level | Add `chrome.alarms.onAlarm` listener | LOW - new event |
| Scheduler init call | `background/index.js` top level | Add `initScheduler()` call | LOW |
| Agent-running guard | `background/scheduler.js` | Import `agentRunning` from agent-engine | LOW - read-only |
| Template goal resolution | `background/index.js` | Import from template-manager | LOW - new import |
| Popup module loading | `popup.html` | Add `<script type="module">` tags | MEDIUM - refactor |
| Shared popup state | `popup-full.js` | Create `window.__popupState` | MEDIUM - refactor |
| Message listener routing | `popup-full.js` (bootstrap) | Route template/schedule messages to modules | MEDIUM - refactor |
| Storage keys | `background/template-manager.js`, `background/scheduler.js` | New keys: `templates`, `schedules` | LOW - additive |

## Anti-Patterns to Avoid

### 1. Putting template/scheduling logic in agent-engine.js
**Why bad:** agent-engine.js is already at 788 lines and is the most critical module. It should remain focused on the agent loop. Template resolution is a pre-processing step that belongs in index.js.
**Instead:** Keep agent-engine.js unaware of templates. Resolve the goal string before calling startAgent().

### 2. Making scheduler.js depend on tab-context.js for tab management
**Why bad:** Creates tight coupling between scheduling and tab state. The scheduler should not manage tabs directly.
**Instead:** When a schedule fires, find or open a tab in the execution bridge function, then call startAgent() which handles tab registration via registerInitialTab().

### 3. Storing schedule state in-memory only
**Why bad:** MV3 service workers can be terminated and restarted. In-memory schedule state would be lost.
**Instead:** All schedule data persists in chrome.storage.local. The init() function restores alarms on service worker restart.

### 4. Adding new message types to message-protocol.js routing
**Why bad:** message-protocol.js is designed as a pure utility module (L0). Adding routing logic would break the invariant.
**Instead:** Keep all routing in index.js. Only add fire-and-forget send functions to message-protocol.js.

### 5. Making popup modules communicate via chrome.runtime.sendMessage
**Why bad:** Popup modules are in the same page. They should use direct function calls or shared state.
**Instead:** Popup modules communicate via `window.__popupState` and direct function imports. Only cross-context communication (popup <-> background) uses chrome.runtime.sendMessage.

## Scalability Considerations

| Concern | Current (v1) | After V2 | Notes |
|---------|-------------|----------|-------|
| Background modules | 10 | 12 | +template-manager, +scheduler |
| Popup scripts | 1 (1,571 lines) | 7 (~1,550 lines total) | Split for maintainability |
| Chrome permissions | 7 | 8 | +alarms |
| Storage keys | ~10 | ~12 | +templates, +schedules |
| Message action types | ~10 | ~22 | +7 template, +5 schedule |
| Content script modules | 9 | 9 | No changes needed |
| Service worker complexity | Medium | Medium-High | Alarm handling adds event-driven complexity |

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Template integration | HIGH | Read all relevant source files; dependency graph is clear |
| Scheduler integration | HIGH | chrome.alarms API is well-documented; MV3 constraints understood |
| Message protocol changes | HIGH | Pattern is established; only additive changes needed |
| Popup module split | MEDIUM | `<script type="module">` works but shared state approach needs validation |
| Build order | HIGH | Dependencies between features are unambiguous |
| MV3 service worker lifecycle | MEDIUM | Alarm restoration pattern is standard but needs testing |

## Gaps to Address

1. **Popup module communication pattern needs prototyping.** The `window.__popupState` approach should be validated with a small extraction (e.g., ui-common.js) before full split.
2. **Cron expression parsing.** scheduler.js needs a way to interpret cron-like expressions for recurring schedules. Options: simple preset strings ("daily", "weekdays-9am") vs full cron parser library.
3. **Import conflict resolution.** When importing templates/reports that have the same ID as existing ones, the merge strategy needs definition (skip, overwrite, rename).
4. **Template parameter validation.** How to validate user-provided parameter values before goal resolution (e.g., URL format validation for URL-type params).
5. **Scheduled run notifications.** When a scheduled task completes (or fails) while the user is not watching, how should they be notified? Options: badge text, notification API, log in schedule history.

## Sources

- All analysis based on direct source code reading of the v3.1.3 codebase
- Chrome Extension MV3 documentation (chrome.alarms, service worker lifecycle)
- Existing .planning/codebase/ architecture documents (ARCHITECTURE.md, STRUCTURE.md)
- .planning/STATE.md accumulated decisions and constraints
- .planning/milestones/v1-REQUIREMENTS.md v2 requirements (ADV-01, ADV-02, ADV-03)
