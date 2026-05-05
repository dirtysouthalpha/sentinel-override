# v3 Release Plan: Sentinel Override

**Created:** 2026-05-05
**Target:** v3.0.0
**Theme:** "From side project to professional tool"

## What v3 Means

v1 proved the agent concept. v2 made it production-ready with tests, templates, scheduling, and collaboration. v3 makes it a professional-grade platform that IT teams actually depend on.

Three pillars: **Reliability**, **Intelligence**, **Ecosystem**.

---

## Phase 9: Test Coverage & CI Foundation

**Goal:** Every feature has real test coverage. CI runs on every push. No more "works on my machine."

**Depends on:** v2 complete

### Requirements

- **QA-01:** Fix broken content script tests (dom-utils, dropdown-utils, overlay-detector, special-inputs, wait-utils, frame-manager) -- currently failing due to missing window.__sentinelUtils mock
- **QA-02:** Add real E2E tests (currently scaffolded only with 0 real assertions) -- use Puppeteer or Playwright against a test HTML page
- **QA-03:** GitHub Actions CI -- lint + unit + integration tests on push, block merge on failure
- **QA-04:** Test coverage reporting -- aim for 70%+ on background/ modules
- **QA-05:** Fix WSL/Windows test runner compatibility -- rolldown native binding issue

### Success Criteria

1. `npm test` passes all tests on both Windows and Linux
2. E2E tests exercise: goal entry -> agent execution -> report generation
3. CI badge in README shows green
4. Coverage report generated on every PR

---

## Phase 10: Error Recovery & Reliability

**Goal:** The agent handles failures gracefully, retries intelligently, and never loses user data.

### Requirements

- **REL-01:** Agent crash recovery -- if service worker restarts mid-task, resume from last checkpoint instead of losing all progress
- **REL-02:** Retry queue with exponential backoff for LLM API failures (429, 500, network timeout)
- **REL-03:** Graceful degradation when Chrome permissions are denied (debugger, tab access) -- show actionable error instead of silent failure
- **REL-04:** Auto-save task state to chrome.storage every N actions so progress survives crashes
- **REL-05:** Rate limiting on LLM calls -- configurable max requests per minute to avoid burning API credits
- **REL-06:** Input validation on all user-entered data (API endpoints, API keys, goals) before sending to LLM

### Success Criteria

1. Kill service worker mid-task -> restart -> agent picks up where it left off
2. Simulate 5 LLM API failures -> agent retries with backoff and eventually completes
3. Deny debugger permission -> popup shows "Enable debugger permission to continue" with link to settings
4. Agent running for 100+ actions -> all state persisted and recoverable

---

## Phase 11: Multi-Provider Intelligence

**Goal:** Smarter LLM usage -- model routing, prompt optimization, cost tracking.

### Requirements

- **LLM-01:** Multi-model routing -- use cheap/fast model for simple tasks (page reading, extraction), powerful model for complex tasks (multi-step reasoning, code generation)
- **LLM-02:** Token usage tracking per task -- show cost estimate before running, actual cost after completion
- **LLM-03:** Prompt template versioning -- when agent-engine prompt is updated, old templates still work with the version they were created on
- **LLM-04:** Streaming responses -- show LLM "thinking" in real-time instead of waiting for complete response
- **LLM-05:** Provider health checks -- test API connectivity before starting a task, suggest fixes if endpoint is unreachable

### Success Criteria

1. User configures two providers -> agent automatically picks the right one per action
2. After task completes, popup shows "Tokens used: 1,247 / Est. cost: $0.04"
3. Provider is down -> "Cannot reach api.openai.com. Check your endpoint URL or try a different provider."
4. Streaming shows partial responses updating in real-time

---

## Phase 12: Recording & Playback

**Goal:** Record a browser session, replay it automatically, share recordings with teammates.

### Requirements

- **REC-01:** Session recording -- capture full agent action log (screenshots, actions, DOM snapshots) as a shareable recording file
- **REC-02:** Session playback -- load a recording and replay it step-by-step with visual display of what happened
- **REC-03:** Recording export as GIF/MP4 -- generate a visual walkthrough from a recording for documentation
- **REC-04:** Recording-to-template -- convert a successful recording into a reusable template automatically
- **REC-05:** Recording comparison -- diff two recordings of the same task to see what changed (useful for regression testing)

### Success Criteria

1. Run a 20-step task -> export recording -> teammate loads it and sees every step
2. Convert recording to template -> run template -> same result
3. Export recording as GIF, attach to documentation
4. Run same task twice, compare recordings, see that step 12 diverged

---

## Phase 13: Team & Enterprise Features

**Goal:** Sentinel Override works for teams, not just individuals.

### Requirements

- **ENT-01:** Shared template library -- sync templates across team members via shared storage (Google Drive, GitHub, or custom endpoint)
- **ENT-02:** Role-based access -- admin can restrict execute_js to specific users, require approval for sensitive actions
- **ENT-03:** Audit log -- every agent action logged with timestamp, user, task, result. Exportable for compliance.
- **ENT-04:** Centralized configuration -- admin sets API endpoint and allowed domains, users inherit settings
- **ENT-05:** Template marketplace (internal) -- browse team templates, see usage counts and success rates

### Success Criteria

1. Admin adds a template -> appears in all team members' libraries within 60 seconds
2. Non-admin tries to run execute_js -> "This action requires admin approval"
3. Admin exports 30-day audit log as CSV
4. User opens extension -> sees org-mandated API endpoint, cannot change it

---

## Phase 14: Plugin Ecosystem

**Goal:** Third-party plugins can extend Sentinel Override without touching core code.

### Requirements

- **PLG-01:** Plugin API -- defined interface for plugins to register custom actions, content script behaviors, and popup panels
- **PLG-02:** Plugin manifest -- each plugin declares capabilities, permissions, and dependencies
- **PLG-03:** Plugin sandboxing -- plugins run in isolated context, cannot access chrome.storage outside their namespace
- **PLG-04:** Built-in plugin: SonicWall Firewall Manager -- domain-specific actions for SonicWall NSM/Gen6 configs
- **PLG-05:** Built-in plugin: M365 Admin -- common M365 admin tasks as pre-built agent workflows

### Success Criteria

1. Third-party developer writes a plugin following the docs -> it loads and runs
2. Plugin crashes -> core extension keeps running, shows error for that plugin only
3. SonicWall plugin adds "Configure firewall rule" action -> agent uses it like any built-in action
4. Plugin cannot read another plugin's data or core extension data

---

## Release Milestones

| Milestone | Phases | Theme | Estimated Effort |
|-----------|--------|-------|-----------------|
| v3.0 | 9-10 | Solid Foundation | 2-3 weeks |
| v3.1 | 11 | Smart LLM Usage | 1-2 weeks |
| v3.2 | 12 | Recording & Playback | 2-3 weeks |
| v3.3 | 13-14 | Team & Plugins | 3-4 weeks |

## Out of Scope for v3

| Feature | Reason |
|---------|--------|
| Native mobile app | Chrome extension only |
| Firefox/Safari support | Chrome-only for now |
| Custom LLM fine-tuning | Use existing providers |
| Real-time multi-user collaboration | Async sharing is sufficient |
| Server-side orchestration | Runs in-browser |

---

## Priority Recommendation

Start with Phase 9 (tests + CI) because everything else depends on having a reliable test suite. Then Phase 10 (reliability) because crash recovery and error handling are the biggest pain points for daily use. Phase 11 (multi-provider) unlocks real cost savings. Phases 12-14 are additive features that can ship independently.

---

*Release plan created: 2026-05-05*
*Author: PremierBot + Brandon*
