# Requirements: Sentinel Override

**Defined:** 2026-05-04
**Core Value:** Give a command in any form and the agent drives the browser to completion, then generates a structured report.

## v2 Requirements

Requirements for v2 milestone. Focus: test infrastructure, tech debt cleanup, command templates, scheduling, and collaboration.

### Testing & Quality

- [ ] **TST-01**: Unit tests for DOM interaction utilities (dom-utils, shadow-dom, dropdown-utils, overlay-detector, special-inputs, frame-manager)
- [ ] **TST-02**: Integration tests for agent loop with mocked Chrome APIs (message passing, tab management, LLM calls)
- [ ] **TST-03**: E2E smoke tests for common workflows (goal entry, agent execution, report generation)

### Tech Debt & Security

- [ ] **DEB-01**: Delete legacy content.js (replaced by content/ modules in v1)
- [ ] **DEB-02**: Split popup-full.js into focused modules (currently ~1,450 lines, adding more features will make it unmaintainable)
- [ ] **DEB-03**: Update agent-engine.js LLM prompt to describe iframe/dropdown/overlay/shadow DOM capabilities
- [ ] **DEB-04**: Remove deprecated isAnthropicEndpoint export from llm-client.js
- [ ] **DEB-05**: Security review of new Function() in content/index.js — document risk or replace with safer alternative
- [ ] **DEB-06**: Fix template delimiter collision — change {{key}} to collision-proof syntax in agent-engine.js

### Command Templates & Runbooks

- [ ] **TMP-01**: User can save current task as a reusable template with extracted parameter placeholders
- [ ] **TMP-02**: User can browse template library with tag-based filtering and search
- [ ] **TMP-03**: User can execute a template — prompted for parameter values, then agent runs with substituted goal
- [ ] **TMP-04**: User can edit template name, goal, parameters, and tags
- [ ] **TMP-05**: User can delete a template
- [ ] **TMP-06**: Templates persist in chrome.storage.local and survive extension restarts

### Agent Scheduling

- [ ] **SCH-01**: User can schedule a template to run at a specific date/time
- [ ] **SCH-02**: User can set up recurring schedules (daily, weekly, custom interval)
- [ ] **SCH-03**: Scheduled tasks execute in the background (popup closed) and notify user on completion
- [ ] **SCH-04**: User can view, enable, disable, and cancel scheduled tasks
- [ ] **SCH-05**: Scheduled task results (success/failure/report) are stored and viewable

### Collaboration

- [ ] **COL-01**: User can export a template as a JSON file for sharing
- [ ] **COL-02**: User can import a template from a JSON file (with duplicate ID handling)
- [ ] **COL-03**: User can export an investigation report as a markdown file
- [ ] **COL-04**: Template and report exports include format versioning for forward compatibility
- [ ] **COL-05**: Imported templates are validated for safety (no execute_js injection from untrusted sources)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Server-side team storage | Runs entirely in-browser; org deployment via file sharing |
| Real-time collaboration | Chrome extension constraint; async sharing sufficient |
| Template marketplace | Out of scope for org-internal tool |
| Visual template builder | Text-based goals are the core UX pattern |
| Native mobile support | Chrome extension only |
| Firefox/Safari support | Chrome-only deployment |
| Custom LLM training | Use existing provider APIs |
| Server-side orchestration | Runs entirely in-browser |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TST-01 | Phase 5 | Complete |
| TST-02 | Phase 5 | Complete |
| TST-03 | Phase 5 | Complete |
| DEB-01 | Phase 5 | Complete |
| DEB-02 | Phase 5 | Complete |
| DEB-03 | Phase 5 | Complete |
| DEB-04 | Phase 5 | Complete |
| DEB-05 | Phase 5 | Complete |
| DEB-06 | Phase 5 | Complete |
| TMP-01 | Phase 6 | Pending |
| TMP-02 | Phase 6 | Pending |
| TMP-03 | Phase 6 | Pending |
| TMP-04 | Phase 6 | Pending |
| TMP-05 | Phase 6 | Pending |
| TMP-06 | Phase 6 | Pending |
| SCH-01 | Phase 7 | Pending |
| SCH-02 | Phase 7 | Pending |
| SCH-03 | Phase 7 | Pending |
| SCH-04 | Phase 7 | Pending |
| SCH-05 | Phase 7 | Pending |
| COL-01 | Phase 8 | Pending |
| COL-02 | Phase 8 | Pending |
| COL-03 | Phase 8 | Pending |
| COL-04 | Phase 8 | Pending |
| COL-05 | Phase 8 | Pending |

**Coverage:**
- v2 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-05-04*
*Last updated: 2026-05-04 after v2 roadmap creation*
