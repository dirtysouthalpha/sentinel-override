---
phase: "06-command-templates-runbooks"
plan: "01"
subsystem: "template-backend"
tags: ["templates", "crud", "chrome-storage", "message-routing", "parameter-extraction"]
duration: "2 min"
completed: "2026-05-04"

dependency_graph:
  requires: ["05-02 (popup split, ::key:: delimiter decision)"]
  provides: ["template-manager.js (CRUD + resolution)", "index.js template message routing"]
  affects: ["06-02 (template popup UI)", "07-01 (scheduler uses templates as execution targets)"]

tech_stack:
  added: []
  patterns:
    - "Object-keyed storage pattern: { [id]: Template } in chrome.storage.local"
    - "::key:: parameter extraction via /:{2}(\\w+):{2}/g regex"
    - "Layer 2 pure utility module (no background module imports)"

key_files:
  created:
    - "background/template-manager.js"
  modified:
    - "background/index.js"
---

# Phase 6 Plan 01: Template Backend Summary

**One-liner:** Template CRUD, ::key:: parameter extraction, goal resolution, and usage tracking via chrome.storage.local, with 6 message routes in index.js.

## What Was Built

### template-manager.js (266 lines, Layer 2)
Pure utility module with zero imports from other background modules. Provides 8 exported async functions:

| Function | Purpose |
|----------|---------|
| `listTemplates()` | Return all templates sorted by updatedAt desc |
| `getTemplate(id)` | Single template by ID, or null |
| `saveTemplate(data)` | Create new template with auto-ID and param extraction |
| `updateTemplate(id, updates)` | Partial update with auto-param re-extraction on goal change |
| `deleteTemplate(id)` | Remove from storage |
| `extractParameters(goalText)` | Parse ::key:: patterns, deduplicate, title-case labels |
| `resolveTemplateGoal(id, params)` | Substitute ::key:: with values, update usage stats |
| `updateTemplateUsage(id)` | Bump lastUsedAt and runCount (post-agent completion) |

Storage key: `sentinel_templates` as `{ [id: string]: Template }` object.

### index.js additions (30 lines)
Import line + 6 new switch cases for template message routing:

- `template_list` -> `listTemplates()`
- `template_get` -> `getTemplate(request.id)`
- `template_save` -> `saveTemplate(request.template)`
- `template_update` -> `updateTemplate(request.id, request.updates)`
- `template_delete` -> `deleteTemplate(request.id)`
- `template_run` -> `resolveTemplateGoal()` then `startAgent()` with `agentRunning` guard

## Decisions Made

1. **Object-keyed storage** -- Templates stored as `{ [id]: Template }` rather than an array, avoiding reindexing on every write and enabling O(1) lookup by ID.
2. **Auto-param extraction on save/update** -- If `params` not provided, automatically extracted from goal text via `extractParameters()`. On goal update, params are re-extracted unless explicitly provided.
3. **Leave unresolved placeholders** -- When a param value is empty/missing and no default exists, the `::key::` placeholder is left as-is rather than removed or replaced with empty string. This lets the user see what was skipped.
4. **Usage tracking in resolveTemplateGoal** -- `resolveTemplateGoal` both resolves the goal string AND updates usage stats (lastUsedAt, runCount). `updateTemplateUsage` is a separate convenience for post-completion tracking if needed.
5. **Title-case label generation** -- `firewall_url` becomes `Firewall Url` (simple split-replace-titlecase, no dictionary).

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

- **06-02 (Template Popup UI)** depends on this module for all persistence. The message protocol is ready: popup sends `{ action: 'template_*' }` messages to background.
- **07-01 (Scheduler)** will use `template_run` message type to execute templates on schedule.
- No blockers or concerns identified.
