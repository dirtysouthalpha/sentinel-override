# Technology Stack: Sentinel Override v2

**Project:** Sentinel Override Chrome Extension (v2 features)
**Researched:** 2026-05-04
**Overall confidence:** HIGH (stack decisions based on official docs and verified npm data)

## Context: Existing v1 Architecture

Before recommending additions, here is what v1 ships with today (no build step, no bundler, no tests):

- **Background:** 8 ES modules under `background/`, entry point `background/index.js` (service worker, `"type": "module"` in manifest)
- **Content scripts:** 9 modules under `content/` using IIFE namespace pattern (`window.__sentinelUtils`)
  - `shadow-intercept.js` loaded at `document_start` (patches `Element.prototype.attachShadow`)
  - Remaining 8 modules loaded on-demand via `chrome.scripting.executeScript` with retry
  - Content modules communicate through `window.__sentinelUtils.dom`, `.shadow`, `.wait`, `.dd`, `.si`, `.ov`, `.fm`
- **Popup:** `popup-full.js` (~1,450 lines) + `popup.html` (loaded as `sidePanel`)
- **Dependencies:** ZERO npm packages. Only external file is `marked.min.js` for markdown rendering
- **Chrome APIs used:** `storage.local`, `tabs`, `runtime`, `scripting`, `debugger`, `action`, `sidePanel`, `webNavigation`, `onInstalled`

## V2 Feature Stack Requirements

| V2 Feature | What It Needs From the Stack |
|---|---|
| Test infrastructure | Test runner, DOM environment, Chrome API mocks, E2E browser automation |
| Command templates / runbooks | Structured storage schema, CRUD operations on `chrome.storage.local` |
| Agent scheduling | `chrome.alarms` permission + API, service worker wake-up handling |
| Collaboration (export/import) | JSON schema for runbooks/reports, file download/upload, clipboard API |

---

## 1. Test Infrastructure

### Recommended: Vitest + happy-dom + Playwright

**Vitest** (v4.1.5 stable, v5.0.0-beta.1 available) is the clear choice for this project.

| Technology | Version | Purpose | Why |
|---|---|---|---|
| **vitest** | ^4.1.5 | Test runner for unit + integration tests | Native ESM support (critical -- background modules use `import`/`export`). No build step needed. Vitest can resolve `.js` imports natively. Fast watch mode. Built-in assertion library and mocking. The `.js` extension issue (Vitest requires explicit extensions for ESM resolution) is already a non-issue since all source files already use `.js` extensions in their imports (e.g., `import { ... } from './message-protocol.js'`). |
| **happy-dom** | ^17.x | DOM environment for content script unit tests | Faster than jsdom. Supports `MutationObserver`, `document.createTreeWalker`, `IntersectionObserver` -- all APIs used by `shadow-dom.js`, `wait-utils.js`, and `overlay-detector.js`. Vitest has first-class `happy-dom` environment support. |
| **@playwright/test** | ^1.50.x | E2E tests loading the full extension in a real browser | Official Chrome extension docs recommend Playwright for E2E. Loads the unpacked extension into Chromium, tests popup, background, and content script integration in a real Chrome environment. Avoids all mock fidelity issues. |

### Why Not Jest?

Jest requires either a transform step or `"type": "module"` in package.json with experimental ESM support. Vitest works with native ESM out of the box. Since the project explicitly has no build step and uses `"type": "module"` in the manifest, Vitest is the correct fit. Jest's ESM support is still incomplete and requires configuration workarounds that Vitest avoids entirely.

### Why Not Karma?

Karma is designed for browser-based testing and requires a browser launcher. It is overkill for unit tests and has fallen out of favor. Playwright handles the browser-based E2E layer better.

### Vitest Configuration

The project needs a `vitest.config.js` (not TypeScript -- keep consistency with the JS-only codebase):

```js
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use happy-dom for content script unit tests
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.test.js'],
    // Exclude E2E tests (those run via Playwright separately)
    exclude: ['tests/e2e/**'],
  },
});
```

### Test Directory Structure

```
tests/
  unit/
    dom-utils.test.js          # window.__sentinelUtils.dom
    shadow-dom.test.js         # window.__sentinelUtils.shadow
    wait-utils.test.js         # window.__sentinelUtils.wait
    dropdown-utils.test.js     # window.__sentinelUtils.dropdown
    overlay-detector.test.js   # window.__sentinelUtils.overlay
    special-inputs.test.js     # window.__sentinelUtils.specialInputs
    frame-manager.test.js      # window.__sentinelUtils.frame
    message-protocol.test.js   # wrapMessageHandler, sendSilentUpdate, etc.
    shared-state.test.js       # SPA transition flags
    provider-registry.test.js  # resolveProvider, migrateLegacySettings
    report-generator.test.js   # generateReport, buildFallbackReport
  integration/
    content-script.test.js     # Full content/index.js message handling
    agent-engine.test.js       # Agent loop with mocked Chrome APIs
    tab-manager.test.js        # injectContentScript, sendMessageWithRetry
  e2e/
    popup.test.js              # Playwright: load extension, test popup UI
    agent-flow.test.js         # Playwright: full agent execution in browser
  helpers/
    chrome-mock.js             # Custom lightweight Chrome API mock
    dom-fixture.js             # Helper to build test DOM trees
```

---

## 2. Chrome API Mocking Strategy

### Recommended: Custom Lightweight Mock (NOT sinon-chrome)

**Do NOT use sinon-chrome.** It has not been updated since approximately 2023-2024, lacks Manifest V3 API coverage (no `chrome.scripting`, no `chrome.sidePanel`, no `chrome.debugger`), and uses callback-only patterns that do not match the Promise-based API style used throughout the v1 codebase.

**Build a custom mock** in `tests/helpers/chrome-mock.js`. This is the right approach because:

1. **The project only uses a small subset of Chrome APIs.** The full API surface that needs mocking is: `chrome.storage.local`, `chrome.tabs`, `chrome.runtime`, `chrome.scripting`, `chrome.debugger`, `chrome.action`, `chrome.sidePanel`, `chrome.webNavigation`, `chrome.alarms`. That is 9 namespaces with maybe 30 methods total.

2. **The mock must be stateful for storage tests.** `chrome.storage.local.set({key: 'val'})` followed by `chrome.storage.local.get('key')` must return `'val'`. sinon-chrome only provides stubs; it does not persist state.

3. **The existing code uses both callback and Promise patterns.** For example, `chrome.tabs.get(tabId, callback)` is callback-based in some places but the v1 code also uses `chrome.storage.local.get([...]).then(...)`. The mock needs to support both.

### Mock Architecture

```js
// tests/helpers/chrome-mock.js
// Lightweight, stateful mock of the Chrome extension APIs used by Sentinel Override.

class EventListenerPool {
  constructor() { this._listeners = []; }
  addListener(fn) { this._listeners.push(fn); }
  removeListener(fn) { this._listeners = this._listeners.filter(l => l !== fn); }
  fire(...args) { this._listeners.forEach(fn => fn(...args)); }
}

function createStorageMock() {
  const store = {};
  return {
    local: {
      get: jest.fn(async (keys) => {
        const keyList = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : Object.keys(keys));
        const result = {};
        keyList.forEach(k => { if (k in store) result[k] = store[k]; });
        return result;
      }),
      set: jest.fn(async (items) => { Object.assign(store, items); }),
      remove: jest.fn(async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { delete store[k]; });
      }),
      // Expose store for test assertions
      _store: store,
    },
  };
}

function createTabsMock() {
  const tabs = new Map();
  return {
    get: jest.fn((tabId, callback) => {
      const tab = tabs.get(tabId);
      callback?.(tab || undefined);
    }),
    query: jest.fn((queryInfo, callback) => {
      const results = Array.from(tabs.values()).filter(/* ... */);
      callback?.(results);
    }),
    update: jest.fn(async (tabId, props) => { /* ... */ }),
    sendMessage: jest.fn((tabId, msg, callback) => { /* ... */ }),
    create: jest.fn(async (props) => { /* ... */ }),
    remove: jest.fn(async (tabIds) => { /* ... */ }),
    captureVisibleTab: jest.fn((windowId, opts, callback) => { /* ... */ }),
    onUpdated: new EventListenerPool(),
    onRemoved: new EventListenerPool(),
    onActivated: new EventListenerPool(),
    _tabs: tabs,
  };
}

function createRuntimeMock() {
  return {
    sendMessage: jest.fn((msg, callback) => { callback?.(undefined); }),
    onMessage: new EventListenerPool(),
    onInstalled: new EventListenerPool(),
    lastError: null,
    getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`),
  };
}

function createAlarmsMock() {
  const alarms = new Map();
  return {
    create: jest.fn(async (name, info) => { /* ... */ }),
    get: jest.fn(async (name) => alarms.get(name)),
    getAll: jest.fn(async () => Array.from(alarms.values())),
    clear: jest.fn(async (name) => alarms.delete(name)),
    clearAll: jest.fn(async () => { alarms.clear(); }),
    onAlarm: new EventListenerPool(),
    _alarms: alarms,
  };
}

// Export assembled mock
export function createChromeMock() {
  return {
    storage: createStorageMock(),
    tabs: createTabsMock(),
    runtime: createRuntimeMock(),
    alarms: createAlarmsMock(),
    scripting: {
      executeScript: jest.fn(async () => {}),
    },
    debugger: {
      attach: jest.fn(async () => {}),
      detach: jest.fn(async () => {}),
      sendCommand: jest.fn(async () => ({ data: 'mock-screenshot' })),
    },
    action: {
      setIcon: jest.fn(async () => {}),
      setBadgeText: jest.fn(async () => {}),
    },
    sidePanel: {
      open: jest.fn(async () => {}),
      setOptions: jest.fn(async () => {}),
    },
    webNavigation: {
      onBeforeNavigate: new EventListenerPool(),
    },
  };
}

// Global setup for tests
export function setupChromeMock() {
  const mock = createChromeMock();
  global.chrome = mock;
  return mock;
}
```

**Key design decisions:**
- Stateful `chrome.storage.local` -- tests can verify that `set` followed by `get` returns the right data, which is essential for testing command template CRUD.
- `EventListenerPool` class simulates `chrome.*.onEvent.addListener/removeListener/fire` -- needed for testing `chrome.runtime.onMessage`, `chrome.tabs.onRemoved`, `chrome.alarms.onAlarm`.
- Exposes `_store`, `_tabs`, `_alarms` for direct test assertions without going through the API.
- Uses Vitest's built-in `vi.fn()` instead of Sinon -- one fewer dependency.

### Content Script Test Setup

Content scripts use the IIFE pattern (`window.__sentinelUtils`), so tests need to:

1. Load the module files in order (shadow-intercept first, then dom-utils, shadow-dom, etc.)
2. Set up `window.__sentinelUtils` before each test
3. Provide `document` via happy-dom

```js
// tests/unit/dom-utils.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom'; // or use happy-dom via vitest environment

// Load the IIFE modules (they self-attach to window.__sentinelUtils)
// In vitest with happy-dom environment, 'document' and 'window' are global

describe('dom-utils', () => {
  beforeEach(() => {
    // Re-initialize namespace before each test
    window.__sentinelUtils = {};
    // Load the module by reading and eval-ing, or by restructuring for testability
  });

  it('isVisible returns false for display:none', () => {
    // ...
  });
});
```

**Important testing constraint:** The IIFE pattern means content script modules cannot be `import`ed in tests. Two options:

1. **Refactor content scripts to also export** (recommended for v2): Add `export` alongside the IIFE namespace assignment. This allows tests to import the module directly while keeping backward compatibility in the extension (the IIFE still runs, the export is just ignored by the browser).

2. **Load via `fs.readFileSync` + `eval`**: Read the file, execute it in the test context. This is fragile and does not work well with source maps.

**Recommendation:** Option 1 is the way to go. Each content script module gets a small addition at the bottom:

```js
// Existing IIFE pattern stays for production:
// (function() { ... })();

// New: export for testability (ignored by browser)
export const dom = window.__sentinelUtils.dom;
```

---

## 3. Storage for Command Templates / Runbooks

### Recommended: chrome.storage.local with structured JSON

**No additional storage technology needed.** The existing codebase already uses `chrome.storage.local` extensively for settings, agent history, learned patterns, and provider configuration. Command templates/runbooks should follow the same pattern.

**Why chrome.storage.local is sufficient:**
- Default 10 MB limit (was 5 MB before Chrome 113). Each runbook is a JSON object of maybe 2-5 KB. That is 2,000-5,000 runbooks before hitting the limit. For an individual user, this is effectively unlimited.
- If needed, add `"unlimitedStorage"` permission for edge cases (a team sharing thousands of runbooks).
- Already used everywhere in v1 -- no new patterns, no new permissions, no new failure modes.
- Supports async get/set with the same Promise-based API the background modules already use.
- Survives service worker termination (unlike in-memory state).

### Runbook Storage Schema

Store runbooks under a single key in `chrome.storage.local`:

```js
// Key: 'runbooks'
// Value:
{
  "runbooks": [
    {
      "id": "rb_<uuid>",           // Unique ID for export/import dedup
      "name": "SonicWall Blocked Connection Investigation",
      "description": "Investigate blocked connections for a specific source IP",
      "category": "firewall",      // firewall | network | vpn | general
      "tags": ["sonicwall", "investigation", "blocking"],
      "goal_template": "Investigate blocked connections from {{source_ip}} on the SonicWall at {{firewall_ip}}",
      "variables": [               // Template variables the user fills in
        { "key": "source_ip", "label": "Source IP", "type": "text", "required": true },
        { "key": "firewall_ip", "label": "Firewall IP", "type": "text", "required": true }
      ],
      "steps": [                   // Optional pre-defined steps (optional -- can also just be a goal template)
        "Navigate to {{firewall_ip}} and log in",
        "Click Log > View",
        "Filter by source IP {{source_ip}}",
        "Extract blocked connection details",
        "Check firewall rules for the source IP",
        "Document findings and recommend action"
      ],
      "created_at": 1715000000000,
      "updated_at": 1715000000000,
      "version": 1,
      "run_count": 5,              // How many times this runbook has been executed
      "last_run": 1715200000000    // Timestamp of last execution
    }
  ]
}
```

**Design rationale:**
- Single key (`'runbooks'`) with an array keeps get/set operations simple -- one read to list all, one write to save.
- `goal_template` with `{{variable}}` placeholders reuses the existing template substitution logic already in `agent-engine.js` (lines 383-392 in the v1 code).
- `id` uses a UUID prefix (`rb_`) to avoid collisions with other storage keys and to support dedup during import.
- `run_count` and `last_run` enable a "recently used" sort in the UI without additional queries.
- The schema is designed for both simple templates (just a goal with variables) and structured runbooks (pre-defined steps).

### CRUD Operations Module

New background module: `background/runbook-store.js`

```js
// background/runbook-store.js
// CRUD operations for command templates / saved runbooks.

const STORAGE_KEY = 'runbooks';

export async function listRunbooks() { /* ... */ }
export async function getRunbook(id) { /* ... */ }
export async function saveRunbook(runbook) { /* ... */ }
export async function deleteRunbook(id) { /* ... */ }
export async function importRunbooks(runbooks) { /* ... */ }  // Merge with dedup by id
export async function exportRunbooks(ids) { /* ... */ }       // Filter and return
export async function recordRun(id) { /* ... */ }             // Increment run_count, set last_run
```

This module imports nothing from other background modules (pure utility, no circular deps), consistent with the v1 module design.

---

## 4. Agent Scheduling via chrome.alarms

### How chrome.alarms Works in MV3

Based on the [official Chrome documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms) (last updated 2026-01-07):

**Permissions required:**
```json
{
  "permissions": ["alarms"]
}
```

**API surface:**
- `chrome.alarms.create(name?, alarmInfo)` -- Create a named alarm
- `chrome.alarms.get(name?)` -- Get a specific alarm
- `chrome.alarms.getAll()` -- List all alarms
- `chrome.alarms.clear(name?)` -- Clear a specific alarm
- `chrome.alarms.clearAll()` -- Clear all alarms
- `chrome.alarms.onAlarm.addListener(callback)` -- Handle alarm firing

**AlarmCreateInfo:**
- `when` -- Absolute time in ms (e.g., `Date.now() + 60000`)
- `delayInMinutes` -- Relative delay (minimum 0.5 minutes in production)
- `periodInMinutes` -- For repeating alarms (minimum 1 minute in production)

**Critical constraints:**
1. **Minimum interval: 30 seconds in production** (can be lower in unpacked/dev mode). `delayInMinutes < 0.5` will not be honored and produces a warning.
2. **Service worker lifecycle:** The service worker can be terminated at any time. When an alarm fires, Chrome wakes the service worker, dispatches the `onAlarm` event, and the service worker must re-register listeners. This is already handled by the existing v1 pattern where `index.js` registers all listeners at module load time.
3. **Alarm persistence is not guaranteed across browser restarts.** The docs explicitly say: "ensure it exists each time your service worker starts up."
4. **No alarms persist across extension updates.** Re-create on `chrome.runtime.onInstalled`.
5. **Device sleep:** Alarms continue to run while sleeping but will not wake the device. Missed alarms fire when the device wakes.

### Scheduling Module Design

New background module: `background/scheduler.js`

```js
// background/scheduler.js
// Agent scheduling: queue tasks to run at specific times via chrome.alarms.

const ALARM_PREFIX = 'scheduled_task_';

export async function scheduleTask(task) {
  // task: { id, goal, scheduledAt (Date), variables?, runbookId? }
  const alarmName = ALARM_PREFIX + task.id;
  const now = Date.now();
  const when = new Date(task.scheduledAt).getTime();

  if (when <= now) throw new Error('Scheduled time must be in the future');

  // Store task details in chrome.storage.local
  await chrome.storage.local.set({ [alarmName]: task });

  // Create the alarm
  await chrome.alarms.create(alarmName, { when });
}

export async function cancelScheduledTask(taskId) {
  const alarmName = ALARM_PREFIX + taskId;
  await chrome.alarms.clear(alarmName);
  await chrome.storage.local.remove(alarmName);
}

export async function listScheduledTasks() {
  const alarms = await chrome.alarms.getAll();
  const scheduledAlarms = alarms.filter(a => a.name.startsWith(ALARM_PREFIX));
  const tasks = [];
  for (const alarm of scheduledAlarms) {
    const task = (await chrome.storage.local.get(alarm.name))[alarm.name];
    if (task) tasks.push({ ...task, alarm });
  }
  return tasks;
}

// Handler: called from index.js when onAlarm fires
export async function handleScheduledAlarm(alarm) {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;

  const task = (await chrome.storage.local.get(alarm.name))[alarm.name];
  if (!task) return;

  // Clear the alarm and stored task
  await chrome.alarms.clear(alarm.name);
  await chrome.storage.local.remove(alarm.name);

  // Build goal from template + variables
  let goal = task.goal || '';
  if (task.variables) {
    for (const [key, value] of Object.entries(task.variables)) {
      goal = goal.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }

  // Start the agent
  const { startAgent } = await import('./agent-engine.js');
  await startAgent(goal, { tab: null }); // No sender tab -- background-initiated
}
```

**Integration point in `index.js`:**
```js
import { handleScheduledAlarm, restoreScheduledTasks } from './scheduler.js';

// Register alarm handler
chrome.alarms.onAlarm.addListener(handleScheduledAlarm);

// Re-register alarms on service worker start (persistence not guaranteed)
chrome.runtime.onInstalled.addListener(async () => {
  await restoreScheduledTasks();
});
```

### Limitations and Mitigations

| Limitation | Mitigation |
|---|---|
| 30-second minimum interval in production | Acceptable for "run at specific time" use case. MSP tasks are typically scheduled hours/days in advance, not seconds. |
| Service worker can die mid-task | Already handled -- the agent loop uses `chrome.storage.local` for state persistence. If the service worker dies, the task is lost (alarm already fired). For critical tasks, consider a "task queue" pattern with status tracking. |
| Alarms lost on browser restart | Re-create from `chrome.storage.local` on service worker startup. |
| No alarm fires while Chrome is closed | This is expected behavior. Show "missed" tasks when the user next opens Chrome. |

---

## 5. Export/Import Format for Collaboration

### Recommended: JSON with Schema Versioning

**Format: Single JSON file per export, array of runbooks.**

```json
{
  "schema": "sentinel-runbooks-v1",
  "exported_at": "2026-05-04T12:00:00.000Z",
  "exported_by": "sentinel-override-extension",
  "version": "3.1.3",
  "runbooks": [
    {
      "id": "rb_abc123",
      "name": "SonicWall Blocked Connection Investigation",
      "description": "...",
      "category": "firewall",
      "tags": ["sonicwall", "investigation"],
      "goal_template": "...",
      "variables": [...],
      "steps": [...],
      "created_at": 1715000000000,
      "updated_at": 1715000000000,
      "version": 1
    }
  ],
  "reports": [
    {
      "id": "rpt_def456",
      "runbook_id": "rb_abc123",
      "goal": "...",
      "summary": "...",
      "fullReport": "...",
      "timestamp": "2026-05-04T11:00:00.000Z"
    }
  ]
}
```

**Design decisions:**
- **Top-level metadata** (`schema`, `exported_at`, `version`) enables future format migration. When v3 adds new fields, the import code can detect `"schema": "sentinel-runbooks-v1"` and migrate.
- **Both runbooks and reports** in a single export. This allows a team lead to share a runbook along with example completed reports. The UI can offer "Export Runbooks Only" vs "Export with Reports" as options.
- **No binary data** -- reports are markdown text. Screenshots are excluded from export (they are base64 and would make files huge). The report references pages by URL instead.
- **Deduplication by `id`** on import. If the receiving user already has a runbook with the same `id`, the import offers: skip, overwrite, or create as copy (new id).

### Export/Import Mechanism

**Export:** Use `URL.createObjectURL` + programmatic `<a>` click download. No new permissions needed.

```js
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Import:** Use a file `<input type="file">` in the popup/sidePanel. Parse with `JSON.parse`, validate against the schema, then merge via the `runbook-store.js` module.

### File Naming Convention

`sentinel-runbooks-2026-05-04.json` (auto-generated from export date)

---

## 6. Dependency Summary: Can We Stay Dependency-Free?

**No.** The v2 features require npm dependencies for the test infrastructure. However, the extension runtime remains dependency-free -- the new npm packages are devDependencies only.

### Required New Packages

| Package | Type | Version | Why |
|---|---|---|---|
| `vitest` | devDependency | ^4.1.5 | Test runner for unit + integration tests |
| `happy-dom` | devDependency | ^17.x | DOM environment for content script tests |
| `@playwright/test` | devDependency | ^1.50.x | E2E browser tests with real extension loading |

### Optional Packages (Not Recommended)

| Package | Why Not Needed |
|---|---|
| `sinon-chrome` | Outdated, lacks MV3 APIs, callback-only. Custom mock is better. |
| `sinon` | Vitest has built-in `vi.fn()`, `vi.spyOn()`, `vi.mock()`. No need for Sinon. |
| `jest` | Vitest is strictly better for native ESM. |
| `jsdom` | happy-dom is faster and has better MutationObserver support. |
| `jszip` | Export format is JSON, not zip. No compression needed. |
| `uuid` | Use `crypto.randomUUID()` (available in service workers and modern browsers). |

### Packages NOT Added

The extension runtime (what gets loaded in Chrome) continues to have zero npm dependencies. All new code for v2 (runbook-store.js, scheduler.js, export/import) is vanilla JavaScript using only Chrome extension APIs and Web APIs. No bundler, no transpiler, no build step.

---

## 7. Manifest Changes Required

```json
{
  "manifest_version": 3,
  "permissions": [
    "activeTab",
    "scripting",
    "tabs",
    "sidePanel",
    "storage",
    "debugger",
    "webNavigation",
    "alarms"          // NEW: for agent scheduling
  ]
}
```

Only one new permission: `"alarms"`. No new host_permissions needed. No changes to content_scripts, background, or side_panel configuration.

---

## 8. New Background Modules

| Module | Responsibility | Imports From |
|---|---|---|
| `background/runbook-store.js` | CRUD for command templates/runbooks in chrome.storage.local | Nothing (pure storage utility) |
| `background/scheduler.js` | Schedule/cancel/list tasks via chrome.alarms + storage | `agent-engine.js` (dynamic import for startAgent) |

Both modules follow the v1 convention of being pure ES modules with `export` for functions and `import` for dependencies.

---

## Installation

```bash
# Dev dependencies only (extension runtime stays dependency-free)
npm install -D vitest@^4.1.5 happy-dom @playwright/test

# Install Playwright browsers (needed for E2E tests)
npx playwright install chromium
```

### package.json scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --include 'tests/unit/**'",
    "test:integration": "vitest run --include 'tests/integration/**'",
    "test:e2e": "playwright test tests/e2e/"
  }
}
```

---

## Sources

- [chrome.alarms API -- Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/alarms) (updated 2026-01-07) -- HIGH confidence
- [chrome.storage API -- Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage) -- HIGH confidence
- [Migrate to Service Workers -- Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers) -- HIGH confidence
- [vitest v4.1.5 on npm](https://www.npmjs.com/package/vitest) -- HIGH confidence (verified version)
- [Vitest 4.1 Release Blog](https://vitest.dev/blog/vitest-4-1.html) -- HIGH confidence
- [E2E Testing for Chrome Extensions -- Chrome for Developers](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing) -- HIGH confidence
- [Testing Browser Extensions with Playwright](https://testdino.com/blog/browser-extensions-testing/) -- MEDIUM confidence
- [sinon-chrome GitHub](https://github.com/acvetkov/sinon-chrome) -- MEDIUM confidence (verified inactive)
- [MV3 Service Worker Keepalive -- Medium](https://medium.com/@dzianisv/vibe-engineering-mv3-service-worker-keepalive-how-chrome-keeps-killing-our-ai-agent-9fba3bebdc5b) -- MEDIUM confidence
- [Chrome Alarm API Deep Dive -- Dev.to](https://dev.to/scriptjsh/deep-dive-into-chrome-alarm-api-scheduling-timed-events-in-chrome-extensions-2glc) -- MEDIUM confidence
