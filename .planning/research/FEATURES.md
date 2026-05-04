# Feature Landscape: Command Templates, Scheduling, and Collaboration

**Domain:** AI-powered Chrome browser automation extension (MSP/IT operations)
**Researched:** 2026-05-04
**Confidence:** MEDIUM-HIGH (official docs verified for chrome.alarms; ecosystem patterns from multiple sources)

---

## 1. Command Templates / Saved Runbooks

### 1.1 How Runbook/Template Systems Work in Automation Tools

Runbook/template systems across automation tools (AWS Systems Manager, Automa, Bardeen, Automation Anywhere, MuleSoft RPA) follow a consistent architecture:

**Core pattern:** A template is a saved command with parameterized placeholders. At execution time, the system prompts for parameter values, substitutes them into the command, then runs it.

**Variable substitution syntax patterns observed in the wild:**

| Tool | Syntax | Example |
|------|--------|---------|
| Automa (browser automation) | `{{variables@name}}` | `{{variables@username}}` |
| Bardeen (browser automation) | `{{stepId.output}}` | `{{step1.url}}` |
| AWS Systems Manager | `{{ automation:EXECUTION_ID }}` | `{{ ssm:parameter:name }}` |
| Octopus Deploy | `#{VariableName}` | `#{Server.Port}` |
| Stacker Build | `${{VAR}}` or `${{VAR:default}}` | `${{ENV:production}}` |
| Sentinel Override (existing) | `{{key}}` (in-memory only) | `{{vpn_ip}}` |

**Key insight:** Sentinel Override already has `{{key}}` template substitution in `agent-engine.js` (lines 354-362). It replaces `{{key}}` with values from `agentMemory` in `command.text`, `command.url`, and `command.value`. This is the foundation to build on. Currently it is ephemeral (in-memory only, lost after agent completes). Templates would persist this pattern to storage.

**Variable types in mature systems:**

1. **User-defined parameters** -- Prompted at run time (e.g., "Enter the VPN IP address")
2. **System variables** -- Auto-injected (e.g., `{{date}}`, `{{timestamp}}`, `{{current_url}}`)
3. **Extracted data from previous runs** -- Referencing output from earlier agent steps
4. **Defaults** -- Pre-filled values the user can override (e.g., `${{server:192.168.1.1}}`)

### 1.2 UX Patterns for Template Management

**Pattern: "Save as Template" (most common)**
- After an agent run completes, user clicks "Save as Template" on the report card
- System extracts the original goal text and auto-detects variable candidates
- User names the template and optionally edits variable definitions
- Template appears in a "Runbooks" section of the side panel

**Pattern: Create from scratch**
- User writes a goal with `{{placeholder}}` syntax directly
- System detects placeholders and creates parameter definitions
- User adds labels, defaults, and descriptions for each parameter

**Pattern: Template Library browsing**
- Grid or list view of saved runbooks
- Search and filter by name, tag, or category
- Pin/favorite frequently used templates
- Sort by last used, most used, or date created

**Organization patterns:**
- **Tags** -- More flexible than folders, supports cross-cutting concerns (e.g., "vpn", "office365", "audit", "daily")
- **Folders** -- Simpler mental model, works for teams (e.g., "Network", "Security", "Licensing")
- **Recommendation:** Tags over folders for v2. Tags are easier to implement, more flexible, and work well with search. Folders can be added later if teams need hierarchical organization.

**Edit/update patterns:**
- Inline editing of template name and description
- Parameter management (add, remove, reorder, set defaults)
- "Duplicate" to create a variant without modifying the original
- "Run history" showing past executions of this template

### 1.3 Template Data Model (Recommended)

```json
{
  "id": "uuid",
  "name": "Check SonicWall VPN Health",
  "description": "Log into SonicWall, check VPN tunnel status, verify active connections",
  "goalTemplate": "Navigate to {{firewall_url}}, log in with admin credentials, go to VPN > Connection Monitor, check that the tunnel to {{remote_site}} is up, note any error counts, and generate a report.",
  "variables": [
    {
      "name": "firewall_url",
      "label": "Firewall URL",
      "description": "SonicWall management interface URL",
      "defaultValue": "https://192.168.1.1:4444",
      "required": true,
      "type": "url"
    },
    {
      "name": "remote_site",
      "label": "Remote Site Name",
      "description": "Name of the VPN tunnel to check",
      "defaultValue": "",
      "required": true,
      "type": "text"
    }
  ],
  "tags": ["sonicwall", "vpn", "network", "daily"],
  "createdAt": "2026-05-04T10:00:00Z",
  "updatedAt": "2026-05-04T10:00:00Z",
  "lastRunAt": "2026-05-04T08:00:00Z",
  "runCount": 15,
  "sourceRunId": "uuid-of-original-run"
}
```

**Variable types to support:**
- `text` -- Free-form text input
- `url` -- Validated URL input
- `date` -- Date picker (useful for log searches: "Show logs from {{date}}")
- `select` -- Dropdown with predefined options (e.g., "SonicWall", "Fortinet", "Palo Alto")
- `number` -- Numeric input with optional min/max
- `boolean` -- Toggle switch (e.g., "Include screenshots in report?")

### 1.4 Table Stakes for Templates

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Save a command as a template | Core value proposition -- users run the same investigations repeatedly | Medium | "Save as Template" button on completed run |
| Variable placeholders with `{{name}}` syntax | Already exists in agent-engine.js, just needs persistence and UI | Low | Foundation already built |
| Parameter prompt before execution | Users need to fill in values each run | Medium | Modal dialog before agent starts |
| Default values for variables | Most runs only change 1-2 parameters | Low | Part of variable definition |
| Template list/library view | Users need to find and manage saved runbooks | Medium | New section in side panel |
| Edit template name/description | Basic management | Low | Inline editing |
| Delete template | Basic management | Low | With confirmation |
| Run from template | Execute with parameter substitution | Medium | Substitute variables, then call existing startAgent() |
| Tags for organization | Users will accumulate 10-30 templates quickly | Low | Simple tag array per template |

### 1.5 Differentiators for Templates

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-detect variables from goal text | Smart UX -- user types goal with `{{}}`, system extracts params automatically | Medium | Regex parse for `{{name}}` patterns |
| "Create from history" | One-click template from past run, no manual editing | Medium | Store original goal, detect replaceable values |
| Run history per template | Track execution results over time, see trends | Medium | Store runId references per template |
| Template duplication | Create variants without breaking originals | Low | Copy template with new ID |
| System variables (`{{date}}`, `{{timestamp}}`, `{{current_url}}`) | Useful for log searches, time-based reports | Low | Simple string substitution before LLM |
| Favorite/pin templates | Quick access to most-used runbooks | Low | Boolean flag + sort |

### 1.6 Anti-Features for Templates

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Visual workflow builder / drag-and-drop | Massive scope creep; users chose natural language, not node editors | Keep the natural language command as the template body |
| Template marketplace / community sharing | Requires server infrastructure, moderation, versioning -- out of scope for client-only extension | JSON export/import for peer-to-peer sharing |
| Version control / diff view on templates | Complex and rarely needed for simple text templates | Duplicate before editing if user wants a backup |
| Template categories / hierarchy beyond tags | Over-engineering for 10-30 templates; adds navigation complexity | Flat list with tag filtering and search |
| Conditional logic in templates (if/else branching) | Turns templates into a programming language; defeats natural-language-first approach | Let the LLM handle conditional logic within the goal text |

---

## 2. Agent Scheduling

### 2.1 chrome.alarms in MV3: Verified Technical Details

**Source:** [chrome.alarms API -- Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/alarms) (last updated 2026-01-07)

**API surface:**
```javascript
// Create a one-shot alarm (fires once)
chrome.alarms.create("task-uuid", { when: Date.now() + delayMs });

// Create a repeating alarm
chrome.alarms.create("task-uuid", {
  when: Date.now() + initialDelayMs,
  periodInMinutes: 10080  // e.g., every week
});

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  // alarm.name = "task-uuid"
  // alarm.scheduledTime = timestamp
});

// Get/clear alarms
chrome.alarms.get("task-uuid");
chrome.alarms.clear("task-uuid");
chrome.alarms.getAll();
chrome.alarms.clearAll();
```

**Critical limitations (verified from official docs):**

| Limitation | Detail | Impact |
|------------|--------|--------|
| **Minimum period** | 30 seconds minimum for `periodInMinutes` (Chrome 120+). Earlier versions: 1 minute. | Fine for scheduled tasks (weekly, daily) but NOT for sub-minute polling |
| **No sub-minute precision** | `delayInMinutes < 0.5` causes a warning; `when` set < 30s from now won't fire for at least 30s | Not an issue for scheduling -- tasks run on minute/hour/day boundaries |
| **Persistence is not guaranteed** | "Alarms may be cleared when the browser is restarted" | Must re-register alarms on service worker startup (see below) |
| **No wake-up** | "Alarms continue to run while a device is sleeping. However, an alarm will not wake up a device." | If laptop is asleep at 8am Monday, task runs when laptop wakes |
| **Service worker 30s idle timeout** | Service worker killed after 30s of inactivity | Alarm event wakes it; agent loop keeps it alive via API calls |
| **Service worker 5-minute max** | Single request/processing capped at 5 minutes | Agent tasks with maxSteps=120 at 2s delay could theoretically run 240s (~4 min). Tight fit but workable. May need to checkpoint progress. |

**Alarm persistence pattern (required):**
```javascript
// On service worker startup, re-register all scheduled tasks
chrome.runtime.onInstalled.addListener(() => {
  restoreScheduledTasks();
});

// Also restore on service worker wake (since it gets killed/restarted)
async function restoreScheduledTasks() {
  const { scheduledTasks } = await chrome.storage.local.get('scheduledTasks');
  for (const task of scheduledTasks) {
    const alarm = await chrome.alarms.get(task.id);
    if (!alarm) {
      chrome.alarms.create(task.id, {
        when: task.nextRunAt,
        periodInMinutes: task.periodInMinutes
      });
    }
  }
}
```

**Source:** [The extension service worker lifecycle -- Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) (verified 2026-05-04)

Key lifecycle facts:
- 30 seconds of inactivity = termination
- 5 minutes max for a single request
- `chrome.debugger` sessions keep service worker alive (already used by Sentinel Override)
- Events and extension API calls reset idle timer
- Alarms survive service worker termination because they are managed by the browser

### 2.2 Scheduling Data Model (Recommended)

```json
{
  "id": "uuid",
  "templateId": "uuid-or-null",
  "name": "Weekly VPN Health Check",
  "goal": "Navigate to {{firewall_url}} and check VPN status...",
  "variables": {
    "firewall_url": "https://192.168.1.1:4444"
  },
  "schedule": {
    "type": "weekly",
    "dayOfWeek": 1,
    "time": "08:00",
    "timezone": "America/New_York",
    "periodInMinutes": 10080
  },
  "enabled": true,
  "lastRunAt": "2026-05-04T08:00:00Z",
  "lastRunStatus": "success",
  "nextRunAt": "2026-05-11T08:00:00Z",
  "createdAt": "2026-04-20T10:00:00Z",
  "consecutiveFailures": 0
}
```

### 2.3 Scheduling UX Patterns

**Common patterns in automation tools:**

1. **Cron-like expression** -- Power-user friendly but confusing for non-technical users
2. **Natural language** -- "Every Monday at 8am" (Bardeen approach)
3. **Preset intervals** -- Dropdown: "Every hour", "Every day", "Every week", "Every month"
4. **Calendar picker** -- Visual date/time picker with repeat settings

**Recommendation for Sentinel Override:** Hybrid approach:
- Preset intervals as quick options (daily, weekly, monthly)
- Simple time picker for the time of day
- Day-of-week selector for weekly schedules
- No cron expressions -- target audience is IT/MSP, not DevOps

**Schedule management UI:**
- List of scheduled tasks with status (active/paused, next run, last result)
- Enable/disable toggle per task
- "Run now" button to execute immediately
- Edit schedule settings
- Delete schedule

### 2.4 Handling Popup Being Closed (Background Execution)

This is the critical architectural challenge. When a scheduled alarm fires:

1. **Service worker wakes up** (chrome.alarms wakes dormant service workers)
2. **Agent loop runs in background** -- The existing `startAgent()` function operates entirely in the service worker, so it works with popup closed
3. **Notification on completion** -- Use `chrome.notifications.create()` since service workers have no UI

**Required manifest permission addition:**
```json
{
  "permissions": ["alarms", "notifications"]
}
```

**Notification patterns:**

| Method | When to Use | User Experience |
|--------|-------------|-----------------|
| `chrome.notifications.create()` | Task completes while popup is closed | System notification toast; clickable to open report |
| `chrome.action.setBadgeText()` | Task completes; visual indicator on extension icon | Badge shows "1" or checkmark; user opens popup to see result |
| `chrome.action.setBadgeBackgroundColor()` | Combine with badge text | Green for success, red for failure |
| Store result in `chrome.storage` | Always -- so popup can show result when opened | Popup checks for pending results on load |

**Recommended completion flow:**
```
Alarm fires
  -> Service worker wakes
  -> Substitute template variables
  -> startAgent(goal) runs in background
  -> Agent completes (success or failure)
  -> generateReport() runs
  -> Store report in chrome.storage.local under "scheduledResults"
  -> chrome.notifications.create() with summary
  -> chrome.action.setBadgeText({ text: "1" })
  -> chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" })

User clicks notification or opens popup
  -> Popup checks chrome.storage.local for pending results
  -> Displays notification card with report link
  -> User clicks to view full report
```

**Important constraint:** The agent loop calls `sendSilentUpdate()` which sends messages to the popup via `chrome.runtime.sendMessage()`. When the popup is closed, these messages will fail silently (`.catch(() => {})`). The existing codebase already handles this pattern -- message sends that fail because no listener exists are caught. No code changes needed for this.

### 2.5 Table Stakes for Scheduling

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Schedule a template to run at a specific time | Core feature request | Medium | chrome.alarms + variable substitution |
| Daily/weekly/monthly repeat options | Most common scheduling intervals | Low | Preset periods in minutes |
| Enable/disable scheduled tasks | Pause without deleting | Low | Boolean flag + skip in onAlarm handler |
| Notification on completion | User needs to know when background task finishes | Medium | chrome.notifications + badge |
| View last run status | Did the scheduled check succeed or fail? | Low | Store status per task |
| "Run now" button | Execute immediately without waiting for schedule | Low | Call startAgent() directly from popup |

### 2.6 Differentiators for Scheduling

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-retry on failure | Scheduled health checks should retry if they fail (network issue, timeout) | Medium | Exponential backoff, max retries, then notify |
| Schedule from report card | One-click "Schedule this to run weekly" from any completed run | Low | Create schedule using the run's goal/template |
| Schedule chaining | Run template A, then template B (e.g., "check VPN" then "email report") | High | Queue system; defer to post-v2 |
| Timezone-aware scheduling | Correct execution time regardless of travel | Medium | Store timezone, calculate nextRunAt in UTC |
| Consecutive failure alerting | After N failures, escalate notification | Low | Counter + threshold check |

### 2.7 Anti-Features for Scheduling

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Sub-minute polling or real-time monitoring | chrome.alarms minimum is 30s; service worker 5-min max makes this unreliable | Use dedicated monitoring tools (Datadog, UptimeRobot) for real-time checks |
| Cron expression input | Confusing for IT/MSP audience; adds parsing complexity | Preset intervals (daily/weekly/monthly) with simple time picker |
| Schedule while agent is running | Creates race conditions and confusing state | Disable scheduling UI while agent is active; queue for next available slot |
| Parallel scheduled task execution | Agent operates on browser tabs; multiple agents would conflict | Queue scheduled tasks; run one at a time |
| Wake computer from sleep | chrome.alarms cannot wake a sleeping device; this is a browser limitation | Document this limitation; task runs when computer wakes |

---

## 3. Collaboration (Sharing Artifacts)

### 3.1 How Chrome Extensions Handle Sharing

Chrome extensions operate client-side with no built-in server. Sharing approaches fall into three tiers:

**Tier 1: File-based (most common, no server needed)**
- Export as JSON file to disk
- Import from JSON file
- Email/Slack the JSON file to teammates
- Pros: No infrastructure, works offline, simple
- Cons: No version control, no conflict resolution, manual distribution

**Tier 2: Clipboard-based (lightweight)**
- Copy template/report as JSON to clipboard
- Paste into Slack, email, wiki
- Recipient pastes into extension to import
- Pros: Faster than file save/load, works in chat tools
- Cons: Large templates may exceed clipboard limits, not suitable for reports with screenshots

**Tier 3: Cloud-based (requires server, out of scope for v2)**
- Shared database or cloud storage
- Real-time collaboration (like Google Docs)
- Version history, access control
- Pros: Best UX for teams
- Cons: Requires backend infrastructure, auth, hosting, ongoing costs

**Recommendation for v2:** Tier 1 (file-based) as primary, Tier 2 (clipboard) as secondary. Tier 3 is explicitly out of scope.

### 3.2 Existing Export Infrastructure in Sentinel Override

The codebase already has export infrastructure:
- **Conversation export** (popup-full.js lines 846-882): Downloads as JSON or text
- **Report export** (popup-full.js lines 1393-1425): Copy as Markdown, download as .md, copy as plain text
- **Export format selector** in settings (JSON, text, CSV options)

This means the file download mechanism is already built. The collaboration feature primarily needs:
1. A new export format that bundles template + metadata into a shareable JSON
2. An import flow that reads this JSON and adds it to the user's template library
3. A "Share" button that triggers the export with a helpful filename

### 3.3 Export/Import Format (Recommended)

**Template export JSON:**
```json
{
  "format": "sentinel-override-template",
  "version": "2.0",
  "exportedAt": "2026-05-04T10:00:00Z",
  "exportedBy": "user@company.com",
  "templates": [
    {
      "id": "uuid",
      "name": "Check SonicWall VPN Health",
      "description": "...",
      "goalTemplate": "...",
      "variables": [...],
      "tags": [...],
      "createdAt": "...",
      "runCount": 15
    }
  ]
}
```

**Report export JSON:**
```json
{
  "format": "sentinel-override-report",
  "version": "2.0",
  "exportedAt": "2026-05-04T10:00:00Z",
  "reports": [
    {
      "goal": "...",
      "summary": "...",
      "fullReport": "...",
      "timestamp": "...",
      "templateId": "uuid-or-null",
      "templateName": "Check SonicWall VPN Health"
    }
  ]
}
```

**Bundle export (template + recent reports):**
```json
{
  "format": "sentinel-override-bundle",
  "version": "2.0",
  "templates": [...],
  "reports": [...]
}
```

### 3.4 Import UX Patterns

**Import flow:**
1. User clicks "Import" button (in Runbooks section)
2. File picker opens (JSON files only)
3. Extension reads file, validates format/version
4. Preview modal shows what will be imported (template names, variable counts)
5. User confirms import
6. Templates added to library (new IDs assigned to avoid collisions)
7. Success toast with count of imported templates

**Conflict handling:**
- Always assign new IDs on import (avoid ID collisions)
- If template with same name exists: append "(imported)" or let user rename
- Tags are merged (no deduplication needed -- duplicate tags are harmless)

### 3.5 Table Stakes for Collaboration

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Export template as JSON file | Share runbooks via email, Slack, file share | Low | Use existing download infrastructure |
| Import template from JSON file | Receive runbooks from teammates | Medium | File picker + validation + storage |
| Export report as Markdown (.md) | Already exists -- copy/paste into tickets | Low | Already built (popup-full.js lines 1407-1421) |
| Copy template to clipboard | Quick share in chat without file save/load | Low | JSON.stringify to clipboard |
| Import from clipboard | Receive template in chat, paste to import | Low | Read clipboard on paste event |

### 3.6 Differentiators for Collaboration

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Batch export (all templates) | Onboarding new team member -- export entire library at once | Low | Loop through all templates, bundle into one JSON |
| Template version tracking | Know which version of a runbook a teammate shared | Medium | Include version number and changelog in export |
| Export as runnable URL | `chrome-extension://id?import=<base64>` -- one-click import from link | Medium | Requires encoding template in URL; may hit URL length limits |
| Report + template bundle | Share the runbook AND the results from last run together | Low | Combine both into one JSON export |

### 3.7 Anti-Features for Collaboration

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Cloud sync / shared database | Requires server infrastructure, auth, hosting costs, ongoing maintenance | File-based export/import for v2 |
| Real-time collaboration (multi-user editing) | Extremely complex; conflicts, locking, presence -- out of scope | Import/export with manual merge |
| Template marketplace / community library | Moderation, versioning, quality control -- massive scope | Share via existing channels (Slack, email, wiki) |
| Built-in diff/merge for template conflicts | Complex; rarely needed for simple text templates | "Duplicate and rename" workflow |
| Encrypted sharing / DRM on templates | Over-engineering for internal team sharing | Trust-based sharing; organizations can control distribution |
| Screenshot embedding in template exports | Bloats file size significantly; screenshots are session-specific | Export report with screenshots separately; template only contains text |

---

## 4. Feature Dependencies

```
Command Templates (foundation)
  |
  +---> Agent Scheduling (depends on templates for recurring tasks)
  |       |
  |       +---> chrome.alarms API
  |       +---> chrome.notifications API
  |       +---> Service worker background execution
  |
  +---> Collaboration (depends on templates for sharing)
          |
          +---> JSON export format
          +---> File import validation
          +---> Clipboard integration
```

**Build order recommendation:**
1. **Templates first** -- Everything else depends on having a template system
2. **Scheduling second** -- Highest user value; templates + scheduling = "run this every Monday"
3. **Collaboration third** -- Lower urgency; templates can be shared manually before formal export/import exists

---

## 5. Feature Complexity Summary

| Feature | Effort | Risk | Dependencies |
|---------|-------|------|-------------|
| Template CRUD (save/edit/delete) | Medium | Low | chrome.storage.local |
| Variable detection from `{{}}` syntax | Low | Low | Regex parsing |
| Parameter prompt modal | Medium | Low | New UI component |
| Template list/library UI | Medium | Low | New section in side panel |
| Tags (add/filter/search) | Low | Low | Array on template object |
| System variables (date, timestamp) | Low | Low | String substitution |
| Save from history | Medium | Low | Store original goal per run |
| chrome.alarms scheduling | Medium | **Medium** | New permission; persistence edge cases |
| Notification on completion | Low | Low | chrome.notifications API |
| Badge indicator on icon | Low | Low | chrome.action API |
| Auto-retry on failure | Medium | Medium | Retry logic with backoff |
| Export template as JSON | Low | Low | Existing download infrastructure |
| Import template from JSON | Medium | Low | File picker + validation |
| Batch export all templates | Low | Low | Loop + bundle |
| Clipboard share | Low | Low | navigator.clipboard API |

---

## 6. MVP Recommendation

**For v2 MVP, prioritize:**

1. Template CRUD + variable substitution (foundation)
2. "Save as Template" from completed run (fastest path to value)
3. Template library with search/filter
4. Parameter prompt before execution
5. Export/import as JSON (enables sharing immediately)
6. Basic scheduling (daily/weekly with notification)

**Defer to post-v2:**

- Template run history per template (requires additional storage schema)
- Schedule chaining (A then B) -- complex queue management
- Auto-retry on scheduled task failure -- nice-to-have
- Batch export all templates -- easy but not urgent
- Export as URL link -- clever but niche use case

---

## 7. Architectural Considerations for Existing Codebase

### 7.1 Storage Schema Addition

Templates and schedules go into `chrome.storage.local`. Recommended keys:

```
sentinel_templates: Array<Template>
sentinel_schedules: Array<ScheduledTask>
sentinel_run_results: Array<RunResult>  // for scheduled task results
```

**Storage limits:** `chrome.storage.local` has a 10MB limit (5MB in some older docs, but 10MB is current). Each template is roughly 1-5KB. At 5KB each, that is ~2000 templates. More than sufficient.

### 7.2 New Background Module: `template-manager.js`

A new ES module in `background/` to handle:
- Template CRUD operations
- Variable detection and substitution
- Template storage persistence
- Template export/import logic

### 7.3 New Background Module: `scheduler.js`

A new ES module in `background/` to handle:
- Schedule CRUD operations
- chrome.alarms management (create, clear, restore)
- Alarm event handling
- Task execution on alarm fire
- Completion notifications
- Schedule persistence

### 7.4 Manifest Permission Changes

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
    "alarms",           // NEW: for scheduling
    "notifications"     // NEW: for completion alerts
  ]
}
```

### 7.5 Popup UI Changes

- New "Runbooks" tab or section in side panel
- Template list with search/filter
- Template editor modal
- Parameter prompt modal (before agent execution)
- Schedule management section
- Import/Export buttons

---

## 8. Competitor Analysis

| Tool | Templates | Scheduling | Sharing | Notes |
|------|-----------|------------|---------|-------|
| **Automa** | Yes -- workflow variables, trigger parameters | Yes -- cron-like intervals | Yes -- JSON export/import | Open source; closest competitor |
| **Bardeen** | Yes -- "Playbooks" with step variables | Yes -- natural language triggers | Yes -- community playbooks | AI-first; polished UX |
| **Browser Use** | No -- one-off natural language commands | No | No | Python-based, not a Chrome extension |
| **MultiOn** | No -- single-purpose agent tasks | No | No | API-first, not template-oriented |
| **AWS Systems Manager** | Yes -- runbooks with parameters | Yes -- cron expressions | Yes -- SSM document sharing | Server-based; not a browser extension |
| **Sentinel Override (current)** | Partial -- `{{}}` syntax in-memory only | No | Partial -- Markdown/text export | Strong natural language + MSP domain focus |

**Competitive gap:** Sentinel Override's differentiator is the natural language command model combined with MSP/IT domain knowledge. Templates + scheduling brings it to feature parity with Automa/Bardeen while keeping the natural language advantage. The AI handles the complex UI interaction -- templates just parameterize the goal.

---

## Sources

### HIGH Confidence (Official Documentation)
- [chrome.alarms API -- Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/alarms) -- Last updated 2026-01-07
- [The extension service worker lifecycle -- Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [chrome.notifications API -- Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/notifications)

### MEDIUM Confidence (Verified from Multiple Sources)
- [Automa Variables Documentation](https://automa-docs-old.vercel.app/api-reference/variables.html) -- Mustache `{{}}` syntax for variable substitution
- [Manifest V3 Migration Pitfalls -- Dev.to](https://dev.to/_350df62777eb55e1/manifest-v3-migration-pitfalls-lessons-from-17-chrome-extensions-2j3h) -- 30-second minimum alarm interval, service worker constraints
- [AWS Systems Manager Automation Variables](https://docs.aws.amazon.com/systems-manager/latest/userguide/automation-variables.html) -- Runbook variable substitution patterns
- [Stack Overflow: Periodic background work in MV3](https://stackoverflow.com/questions/66629892/how-do-you-do-periodic-background-work-in-a-chrome-extension-using-manifest-v3) -- Service worker scheduling patterns
- [Stack Overflow: Alert in MV3 background service worker](https://stackoverflow.com/questions/66269718/alert-not-showing-in-manifestv3-background-service-worker) -- Use chrome.notifications instead of alert()

### LOW Confidence (Single Source / Unverified)
- Bardeen workflow patterns -- inferred from search result snippets, not directly verified on their docs site
- Template UX patterns from Medium articles -- synthesized from multiple sources but no primary research with users
