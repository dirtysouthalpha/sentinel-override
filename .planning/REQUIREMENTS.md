# Requirements: Sentinel Override

**Defined:** 2026-04-24
**Core Value:** Give a command in any form and the agent drives the browser to completion, then generates a structured report.

## v1 Requirements

### Agent Reliability

- [x] **REL-01**: Agent detects when it's stuck (no progress after N iterations) and autonomously recovers by re-assessing page state ✓ (2026-04-24)
- [x] **REL-02**: Agent planning produces step sequences that accurately reflect the user's stated goal, not generic approximations ✓ (2026-04-24)
- [x] **REL-03**: Agent handles SPA page transitions — detects content changes without full navigation and re-scans DOM ✓ (2026-04-24)

### Complex UI Interactions

- [ ] **UIX-01**: Agent reliably interacts with dropdowns and nested menus (hover, click, select)
- [ ] **UIX-02**: Agent handles special input types — date pickers, file uploads, rich text editors
- [ ] **UIX-03**: Agent interacts with elements inside iframes (cross-origin aware)
- [ ] **UIX-04**: Agent interacts with shadow DOM elements
- [ ] **UIX-05**: Agent handles modal dialogs, confirmation prompts, and overlay dismissal

### Multi-Tab Workflows

- [ ] **TAB-01**: Agent can open, switch between, and close multiple browser tabs
- [ ] **TAB-02**: Agent can correlate data across tabs (e.g., compare log entry on tab A with config on tab B)
- [ ] **TAB-03**: Agent tracks tab context — knows which tab it's on and what that tab represents

### Report Generation

- [ ] **RPT-01**: Agent generates a structured investigation report after task completion with timeline, findings, and screenshots
- [ ] **RPT-02**: Report format is copy-paste ready for ticket documentation
- [ ] **RPT-03**: Report includes: user goal, steps taken, key findings, evidence (screenshots/data), and conclusions

### Multi-Provider LLM

- [ ] **LLM-01**: Extension supports switching between Claude and OpenAI as the LLM backend
- [ ] **LLM-02**: LLM provider configuration is accessible in the UI settings
- [ ] **LLM-03**: Agent handles provider-specific API differences transparently

### Codebase Health

- [x] **HEA-01**: Background.js is refactored into modular components (agent engine, LLM client, tab manager) ✓ (2026-04-24)
- [x] **HEA-02**: Error handling is standardized across all message passing ✓ (2026-04-24)
- [ ] **HEA-03**: Content script DOM operations are extracted into reusable utilities

## v2 Requirements

### Testing

- **TST-01**: Unit tests for DOM interaction utilities
- **TST-02**: Integration tests for agent loop with mocked Chrome APIs
- **TST-03**: E2E tests for common workflows

### Advanced Capabilities

- **ADV-01**: Command templates / saved runbooks that can be re-used
- **ADV-02**: Agent scheduling — queue tasks to run at specific times
- **ADV-03**: Collaboration — share reports and runbooks with team members

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native mobile support | Chrome extension only |
| Server-side orchestration | Runs entirely in-browser |
| Non-browser automation (CLI, SSH) | Out of scope for browser extension |
| Custom LLM training | Use existing provider APIs |
| Firefox/Safari support | Chrome-only deployment |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HEA-01 | Phase 1 | Complete |
| HEA-02 | Phase 1 | Complete |
| REL-01 | Phase 1 | Complete |
| REL-02 | Phase 1 | Complete |
| REL-03 | Phase 1 | Complete |
| UIX-01 | Phase 2 | Pending |
| UIX-02 | Phase 2 | Pending |
| UIX-03 | Phase 2 | Pending |
| UIX-04 | Phase 2 | Pending |
| UIX-05 | Phase 2 | Pending |
| HEA-03 | Phase 2 | Pending |
| TAB-01 | Phase 3 | Pending |
| TAB-02 | Phase 3 | Pending |
| TAB-03 | Phase 3 | Pending |
| RPT-01 | Phase 4 | Pending |
| RPT-02 | Phase 4 | Pending |
| RPT-03 | Phase 4 | Pending |
| LLM-01 | Phase 4 | Pending |
| LLM-02 | Phase 4 | Pending |
| LLM-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 after roadmap creation*
