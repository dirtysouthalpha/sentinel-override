# Roadmap: Sentinel Override

## Milestones

- **v1** -- Phases 1-4 (shipped 2026-05-04)
- **v2** -- Phases 5-8 (in progress)

## Overview

v2 makes Sentinel Override production-ready by building a test safety net, eliminating tech debt and security risks, then adding three layers of power-user capability: command templates for runbook reuse, agent scheduling for automated tasks, and collaboration for team sharing. Phase 5 (testing + tech debt) is the foundation -- every subsequent feature is built on validated, cleaned-up code. Phases 6-8 are additive, each depending on the previous.

## Phases

<details>
<summary>v1 MVP (Phases 1-4) -- SHIPPED 2026-05-04</summary>

- [x] **Phase 1: Agent Engine Foundation** (2/2 plans) -- completed 2026-04-24
- [x] **Phase 2: Complex UI Interactions** (2/2 plans) -- completed 2026-04-24
- [x] **Phase 3: Multi-Tab Workflows** (2/2 plans) -- completed 2026-05-04
- [x] **Phase 4: Reports & Multi-Provider LLM** (2/2 plans) -- completed 2026-05-04

Full details: [.planning/milestones/v1-ROADMAP.md](milestones/v1-ROADMAP.md)

</details>

### v2 (Phases 5-8) -- IN PROGRESS

- [x] **Phase 5: Testing & Tech Debt Cleanup** (2/2 plans) -- completed 2026-05-04
- [ ] **Phase 6: Command Templates & Runbooks** -- Users save, organize, and re-execute tasks as reusable templates with parameter substitution.
- [ ] **Phase 7: Agent Scheduling** -- Users schedule templates to run at specific times or on recurring intervals with background execution and notifications.
- [ ] **Phase 8: Collaboration & Export** -- Users export and import templates and reports as shareable files with format versioning and safety validation.

## Phase Details

### Phase 5: Testing & Tech Debt Cleanup

**Goal**: Every code change is validated by automated tests, security risks are documented or eliminated, and the codebase is free of legacy dead code and the monolithic popup bottleneck.

**Depends on**: v1 milestone (phases 1-4 complete)

**Requirements**: TST-01, TST-02, TST-03, DEB-01, DEB-02, DEB-03, DEB-04, DEB-05, DEB-06

**Success Criteria**:
  1. Developer can run `npm test` and see unit tests pass for all DOM interaction utilities, message-protocol, and tab-context modules.
  2. Developer can run integration tests that exercise the agent loop with mocked Chrome APIs and LLM responses without hitting real services.
  3. Developer can run E2E smoke tests that verify goal entry, agent execution, and report generation against a test page.
  4. Legacy `content.js` file no longer exists in the extension directory.
  5. Popup UI loads and functions identically to v1 but is split into focused modules (chat, settings, ui-common, bootstrap) instead of one monolithic file.

**Plans**: 2 plans

Plans:
- [x] 05-01: Test infrastructure setup, Chrome API mocks, unit tests for content script utilities and background modules, integration tests for agent loop with mocked APIs
- [x] 05-02: Tech debt cleanup -- delete legacy content.js, split popup-full.js into focused modules, update agent-engine LLM prompt, remove deprecated exports, fix template delimiter collision, document or resolve `new Function()` security risk ✓ (2026-05-04)

---

### Phase 6: Command Templates & Runbooks

**Goal**: Users can save any task as a reusable template with parameter placeholders, browse and filter their template library, and re-execute templates with prompted parameter values -- all surviving extension restarts.

**Depends on**: Phase 5

**Requirements**: TMP-01, TMP-02, TMP-03, TMP-04, TMP-05, TMP-06

**Success Criteria**:
  1. User can save their current task as a named template with extracted parameter placeholders, and see it appear in the template library.
  2. User can browse the template library, filter by tags, search by name, and see each template's last-used date and run count.
  3. User can click "Run" on a template, fill in prompted parameter values in a form, and the agent executes with the substituted goal.
  4. User can edit a template's name, goal text, parameters, and tags, and see changes persisted.
  5. User can delete a template and confirm it no longer appears in the library.
  6. After restarting the browser or reloading the extension, all templates remain in the library.

**Plans**: 2 plans

Plans:
- [ ] 06-01: Template data model and storage (template-manager.js), CRUD operations, goal resolution with parameter substitution, message routing in index.js
- [ ] 06-02: Template popup UI (popup-modules/templates.js) -- template library view with tag filtering and search, create/edit form with parameter definitions, run button with parameter prompt form, delete confirmation

---

### Phase 7: Agent Scheduling

**Goal**: Users can schedule templates to run automatically at specific times or on recurring intervals, with execution happening in the background and completion notifications delivered even when the popup is closed.

**Depends on**: Phase 6

**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04, SCH-05

**Success Criteria**:
  1. User can schedule a template to run at a specific date/time and see it appear in the schedule list with a countdown to next run.
  2. User can set up a recurring schedule (daily, weekly, custom interval) and see it repeat on the expected cadence.
  3. A scheduled task executes successfully in the background (popup closed) and the user receives a notification on completion.
  4. User can view all scheduled tasks, enable/disable individual schedules, and cancel schedules entirely from the schedule management UI.
  5. User can view past scheduled task results including success/failure status and generated reports.

**Plans**: 2 plans

Plans:
- [ ] 07-01: Scheduler backend (scheduler.js) -- chrome.alarms integration, schedule CRUD with storage persistence, execution bridge (alarm fires -> check agent state -> resolve template goal -> start agent), service worker restart recovery, run result storage
- [ ] 07-02: Scheduler popup UI (popup-modules/scheduler-ui.js) -- schedule list with status and next run, create form with time picker and recurrence options, enable/disable toggles, run history view, notification setup

---

### Phase 8: Collaboration & Export

**Goal**: Users can export templates and reports as shareable files, import files from teammates, and trust that imported content is validated for safety and format compatibility.

**Depends on**: Phase 6 (templates), Phase 7 (scheduled reports)

**Requirements**: COL-01, COL-02, COL-03, COL-04, COL-05

**Success Criteria**:
  1. User can export a single template as a JSON file and share it with a teammate.
  2. User can import a template from a JSON file -- if the template ID already exists, the conflict is handled gracefully (rename or skip, not silent overwrite).
  3. User can export an investigation report as a markdown file that opens correctly in any markdown viewer.
  4. Exported files include a format version number so future versions of the extension can handle older formats gracefully.
  5. Imported templates are validated for safety -- templates containing `execute_js` injection or other dangerous patterns from untrusted sources are flagged or rejected.

**Plans**: 2 plans

Plans:
- [ ] 08-01: Export/import backend -- shareable JSON format specification with versioning, template export/import with duplicate ID handling, report markdown export, import safety validation (execute_js injection detection), message routing
- [ ] 08-02: Collaboration popup UI (popup-modules/collaboration.js) -- export/import buttons with file picker, import preview showing what will be added, conflict resolution UI, format version compatibility warnings

---

## Progress

| Phase | Milestone | Plans | Complete | Status | Completed |
|-------|-----------|-------|----------|--------|-----------|
| 1. Agent Engine Foundation | v1 | 2 | 2/2 | Complete | 2026-04-24 |
| 2. Complex UI Interactions | v1 | 2 | 2/2 | Complete | 2026-04-24 |
| 3. Multi-Tab Workflows | v1 | 2 | 2/2 | Complete | 2026-05-04 |
| 4. Reports & Multi-Provider LLM | v1 | 2 | 2/2 | Complete | 2026-05-04 |
| 5. Testing & Tech Debt Cleanup | v2 | 2 | 2/2 | Complete | 2026-05-04 |
| 6. Command Templates & Runbooks | v2 | 2 | 0/2 | Pending | -- |
| 7. Agent Scheduling | v2 | 2 | 0/2 | Pending | -- |
| 8. Collaboration & Export | v2 | 2 | 0/2 | Pending | -- |

---
*Roadmap created: 2026-04-24*
*Last updated: 2026-05-04 -- v2 roadmap added*
*Coverage: 25/25 v2 requirements mapped*
