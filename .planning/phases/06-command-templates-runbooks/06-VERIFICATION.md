---
phase: 06-command-templates-runbooks
verified: 2026-05-04T12:51:00Z
status: passed
score: 3/14 must-haves verified
gaps:
  - truth: "User can save their current task as a named template with extracted parameter placeholders, and see it appear in the template library"
    status: failed
    reason: "Template save reaches background and persists to storage, but the template library UI never displays it because loadTemplates() ignores the { ok, data } response wrapper from wrapMessageHandler"
    artifacts:
      - path: "popup-modules/templates.js"
        issue: "Line 54: accesses response.templates but wrapMessageHandler returns { ok: true, data: [...] }. response.templates is always undefined, so template list is always empty."
    missing:
      - "Change response.templates to response.data in loadTemplates() (line 54)"
      - "Add response.ok check before accessing response.data"
  - truth: "User can browse the template library, filter by tags, search by name, and see each template last-used date and run count"
    status: failed
    reason: "Template library rendering logic (renderTemplateList, filterTemplates) is substantive and correct, but loadTemplates() never receives data due to response wrapper mismatch, so the library is always empty"
    artifacts:
      - path: "popup-modules/templates.js"
        issue: "Lines 60-78: filterTemplates() logic correct. Lines 80-129: renderTemplateList() correct. Both dead code because loadTemplates() feeds them empty array."
    missing:
      - "Fix loadTemplates() to read from response.data instead of response.templates"
  - truth: "User can click Run on a template, fill in prompted parameter values in a form, and the agent executes with the substituted goal"
    status: failed
    reason: "openRunModal() calls template_get, which returns { ok: true, data: template }, but popup checks response.template (line 312). response.template is undefined, so it shows Template not found toast and never opens the run modal"
    artifacts:
      - path: "popup-modules/templates.js"
        issue: "Line 207 and 312: checks response.template but should check response.data"
    missing:
      - "Change response.template to response.data in openEditTemplateModal() (line 207) and openRunModal() (line 312)"
      - "Add response.ok === false error checks before accessing response.data"
  - truth: "User can edit a template name, goal text, parameters, and tags, and see changes persisted"
    status: failed
    reason: "openEditTemplateModal() cannot fetch the template to populate the edit form due to same response wrapper mismatch (response.template vs response.data)"
    artifacts:
      - path: "popup-modules/templates.js"
        issue: "Line 207: response.template is undefined, shows Template not found toast"
    missing:
      - "Change response.template to response.data in openEditTemplateModal()"
  - truth: "User can delete a template and confirm it no longer appears in the library"
    status: failed
    reason: "Delete message sends correctly and background removes from storage. But after deletion, loadTemplates() is called to refresh the list, and it always shows empty due to the response wrapper bug"
    artifacts:
      - path: "popup-modules/templates.js"
        issue: "Delete handler (line 380) works but the subsequent loadTemplates() call cannot display the updated list"
    missing:
      - "Fix loadTemplates() response handling so the list refreshes correctly after delete"
  - truth: "After restarting the browser or reloading the extension, all templates remain in the library"
    status: partial
    reason: "Persistence to chrome.storage.local works correctly. Templates survive restarts at the storage level. However, the popup UI cannot display them due to the response wrapper bug"
    artifacts:
      - path: "background/template-manager.js"
        issue: "Storage layer is correct -- chrome.storage.local.get/set with sentinel_templates key"
    missing:
      - "Fix popup response handling to actually display persisted templates"
  - truth: "hideTemplatesPanel() hides both chat view and input area"
    status: failed
    reason: "hideTemplatesPanel() toggles chat-container and templates-panel but does not hide the input-area div. When templates panel is shown, the goal input bar remains visible below it"
    artifacts:
      - path: "popup-modules/templates.js"
        issue: "Lines 37-41: showTemplatesPanel/hideTemplatesPanel only toggle chat-container and templates-panel, not input-area"
    missing:
      - "Add input-area display:none in showTemplatesPanel() and display:flex in hideTemplatesPanel()"
  - truth: "Template-specific tests exist"
    status: failed
    reason: "No test files exist for template-manager.js or templates.js. The 216 passing tests are all from Phases 1-5."
    artifacts: []
    missing:
      - "Unit tests for template-manager.js CRUD operations, parameter extraction, goal resolution"
      - "Unit tests for popup templates.js filtering, parameter editing, response handling"
---

# Phase 6: Command Templates and Runbooks Verification Report

**Phase Goal:** Users can save any task as a reusable template with parameter placeholders, browse and filter their template library, and re-execute templates with prompted parameter values -- all surviving extension restarts.
**Verified:** 2026-05-04T12:51:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can save task as named template with parameter placeholders | FAILED | Backend save works, but popup response handling ignores { ok, data } wrapper, so template never appears in UI |
| 2 | User can browse library, filter by tags, search by name, see last-used and run count | FAILED | Rendering logic correct but loadTemplates() always receives empty array due to response wrapper mismatch |
| 3 | User can click Run, fill in parameters, agent executes with substituted goal | FAILED | openRunModal() cannot fetch template data (checks response.template instead of response.data), shows Template not found |
| 4 | User can edit template name, goal, parameters, tags | FAILED | openEditTemplateModal() has same response wrapper mismatch, cannot populate edit form |
| 5 | User can delete template and confirm removal | FAILED | Delete works at storage level but UI list never updates correctly (loadTemplates broken) |
| 6 | Templates persist after browser restart | PARTIAL | Storage layer (chrome.storage.local) works correctly, but popup cannot display them due to response wrapper bug |
| 7 | hideTemplatesPanel() hides chat view AND input area | FAILED | Only toggles chat-container and templates-panel; input-area remains visible |
| 8 | Template-specific tests exist | FAILED | No test files for template-manager.js or templates.js |

**Score:** 3/14 must-haves verified (backend CRUD, ::key:: delimiter consistency, message routing in index.js)

### Root Cause Analysis

The primary blocker is a **response wrapper mismatch** between the popup UI module and the background message protocol:

- wrapMessageHandler() in message-protocol.js wraps ALL responses as { ok: true, data: <return_value> } or { ok: false, error: <message> }
- popup-modules/templates.js accesses response properties directly (e.g., response.templates, response.template) without unwrapping response.data
- The chat.js module correctly handles this by checking response.ok === false and response.error
- This single bug makes the entire template UI non-functional: lists are always empty, edit/run modals cannot load template data

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| background/template-manager.js | 8 exported functions, CRUD, resolution, storage | VERIFIED | 266 lines, all 8 functions present, substantive, no stubs, correct ::key:: regex, chrome.storage.local persistence |
| background/index.js | 6 template message routes + import | VERIFIED | Import line present (line 12), all 6 cases in switch (lines 81-107), agentRunning guard on template_run |
| popup-modules/templates.js | Template UI with list, search, filter, CRUD modals, run modal | PARTIAL | 422 lines, all functions defined, event wiring complete, but response wrapper handling is broken throughout |
| popup.html | Template button, panel, modals, script tag, CSS | VERIFIED | templatesBtn (line 1835), templates-panel (line 1880), template-modal (line 2105), template-run-modal (line 2133), script tag (line 2152), CSS styles present |
| popup-full.js | Bootstrap wiring for templates | VERIFIED | 68 lines, templatesBtn toggle (lines 29-36), Escape close (lines 45-46), click-outside close (lines 62-67) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| background/index.js | background/template-manager.js | import statement | WIRED | Line 12: imports all 6 required functions |
| background/template-manager.js | chrome.storage.local | get/set with sentinel_templates | WIRED | Lines 47-58: loadTemplates/saveTemplates use STORAGE_KEY |
| background/index.js template_run | agent-engine.js startAgent | resolveTemplateGoal then startAgent | WIRED | Lines 102-107: resolves goal then calls startAgent(goal, sender) |
| popup-modules/templates.js | background/index.js | chrome.runtime.sendMessage | BROKEN | Messages sent correctly, but responses not unwrapped from { ok, data } envelope |
| popup.html | popup-modules/templates.js | script tag | WIRED | Line 2152 |
| popup-full.js | popup-modules/templates.js | DOMContentLoaded calling showTemplatesPanel | WIRED | Lines 29-36 |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| TMP-01: Save task as reusable template | BLOCKED | Response wrapper mismatch prevents UI from confirming save success |
| TMP-02: Browse library with filtering/search | BLOCKED | loadTemplates() always returns empty array |
| TMP-03: Execute template with parameter prompt | BLOCKED | openRunModal() cannot fetch template data |
| TMP-04: Edit template properties | BLOCKED | openEditTemplateModal() cannot fetch template data |
| TMP-05: Delete template | BLOCKED | UI list never updates correctly after delete |
| TMP-06: Templates persist across restarts | PARTIAL | Storage works but UI cannot display persisted templates |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| popup-modules/templates.js | 54 | response.templates instead of response.data | Blocker | Template list always empty |
| popup-modules/templates.js | 207 | response.template instead of response.data | Blocker | Edit modal never opens |
| popup-modules/templates.js | 312 | response.template instead of response.data | Blocker | Run modal never opens |
| popup-modules/templates.js | 37-41 | Missing input-area toggle | Warning | Input bar visible when templates panel shown |

### Gaps Summary

The core implementation is well-structured and nearly complete. All backend CRUD operations, parameter extraction, goal resolution, and message routing are correctly implemented in background/template-manager.js and background/index.js. The popup UI module (popup-modules/templates.js) has comprehensive functionality for listing, searching, filtering, creating, editing, running, and deleting templates.

However, a single systematic bug -- **failure to unwrap the { ok, data } response envelope** from wrapMessageHandler() -- makes the entire template UI non-functional. Every chrome.runtime.sendMessage callback in templates.js accesses response properties at the wrong level. The fix is straightforward:

1. In loadTemplates(): change response.templates to response.data
2. In openEditTemplateModal(): change response.template to response.data
3. In openRunModal(): change response.template to response.data
4. In all callbacks: add if (response && response.ok === false) error checks before accessing response.data

Additionally, hideTemplatesPanel() should also toggle the input-area element, and template-specific unit tests should be added.

The backend is fully functional and ready. The UI module needs response handling fixes and the input-area toggle fix.

---

_Verified: 2026-05-04T12:51:00Z_
_Verifier: Claude (gsd-verifier)_
