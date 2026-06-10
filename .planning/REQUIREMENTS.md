# Milestone v16.0 Requirements — Foundation Hardening + Plugin Power

## Hygiene (HYG)

- [ ] **HYG-01**: All stale session/phase/summary markdown removed from repo root
  - Remove: 05-01-PHASE5-SUMMARY.md, GRINDING_REPORT.md, IMPROVEMENT-PLAN.md, OPTIMIZATION_SUMMARY.md, OPTIMIZATION_SUMMARY_2025-06-05.md, PERFORMANCE_IMPLEMENTATION_GUIDE.md, PHASE_1-SUMMARY.md, PHASE_6-SUMMARY.md, RELEASE_NOTES_10.1.0.md, REVIEW.md, SESSION-REPORT-2025-05-25.md, SESSION_SUMMARY_20260604.md, TEST_FIX_PROGRESS.md, UAP_ARCHITECTURE.md, UI-REVIEW.md, V10_UPGRADE_COMPLETE.md
  - Keep: CHANGELOG.md, CLAUDE.md, LICENSE, README.md, MIGRATION_GUIDE_v4_to_v10.md

- [ ] **HYG-02**: docs/archive/ duplicates removed (source docs in docs/ preserved)
  - Remove docs/archive/ directory entirely — content is duplicated in docs/

- [ ] **HYG-03**: memory/ session artifacts removed or relocated
  - Remove memory/MEMORY.md, memory/phase1-phase2-scan-summary.md, memory/v4-grind-session-20260603-session-bb.md
  - If content is valuable, relocate to .planning/ before deletion

- [ ] **HYG-04**: marked.min.js replaced with npm dependency or moved to lib/
  - Replace with `npm install marked` or create lib/ directory for vendored dependencies
  - Update import references in code

- [ ] **HYG-05**: v3.0-integration/ evaluated — integrated into main codebase or removed
  - If circuit-breaker.js, event-bus.js, etc. are used: import properly
  - If not used: remove entirely

## Settings Persistence (SET)

- [ ] **SET-01**: All settings writes go through a single persistSettings() path
  - Create unified settings write function in settings.js
  - All save/test/persist actions funnel through this single path

- [ ] **SET-02**: Settings read always returns storage-backed value (never stale form state)
  - getActiveProvider() and all settings getters read from chrome.storage.local
  - Form state is display-only; storage is truth

- [ ] **SET-03**: Unsaved changes indicator on all settings forms
  - Visual indicator (amber dot) when form values differ from storage
  - Clear indicator (green check) after save

- [ ] **SET-04**: Settings export/import (JSON backup/restore)
  - Export: serialize all chrome.storage.local to downloadable JSON
  - Import: validate schema, merge/replace, reload extension

- [ ] **SET-05**: Settings migration on version upgrade (schema versioning)
  - Store schema version in chrome.storage.local
  - On extension update, run migration functions for each version bump

## WebSocket Bridge (WSB)

- [ ] **WSB-01**: Auth token via configurable storage (not hardcoded)
  - Read token from chrome.storage.local or env variable
  - Remove hardcoded 'sentinel-prime-bridge-2025'

- [ ] **WSB-02**: Challenge-response auth handshake on connect
  - Server sends challenge, client responds with signed token
  - Reject connections that fail handshake

- [ ] **WSB-03**: Message validation schema for WebSocket messages
  - Define valid message types and required fields
  - Reject malformed messages with error response

- [ ] **WSB-04**: Exponential backoff reconnection with jitter
  - 1s → 2s → 4s → 8s max with ±20% jitter
  - Reset backoff on successful connection

- [ ] **WSB-05**: Heartbeat timeout detection (30s idle = reconnect)
  - Send periodic ping, expect pong within 10s
  - No pong after 30s = connection dead, trigger reconnect

## Plugin System (PLG)

- [ ] **PLG-01**: Plugin registry endpoint URL configurable
  - Default registry URL in settings, user can override
  - Support private registries for enterprise

- [ ] **PLG-02**: Plugin install lifecycle (fetch → download → validate → install → activate)
  - Fetch manifest from registry
  - Validate schema, check compatibility
  - Download and store plugin files
  - Register with plugin system
  - Activate (available for use)

- [ ] **PLG-03**: Plugin uninstall with full cleanup
  - Remove registered handlers and storage keys
  - Delete plugin files
  - Remove from active plugin list

- [ ] **PLG-04**: Plugin toggle (enable/disable without uninstall)
  - Disabled plugins remain installed but don't execute
  - Toggle preserves all plugin data

- [ ] **PLG-05**: Plugin conflict detection
  - Detect duplicate platform profiles from different plugins
  - Detect overlapping action names
  - Warn user before activation

- [ ] **PLG-06**: Plugin management UI in settings modal
  - Browse available plugins from registry
  - Install/uninstall/toggle controls
  - Plugin detail view (description, version, author, platforms)

## Platform Profiles (PLT)

- [ ] **PLT-01**: Automated smoke test for all 19 platform profiles
  - Validate required fields exist (name, selectors, actions)
  - Validate selector syntax
  - Run on every `npm test`

- [ ] **PLT-02**: Platform profile schema validation
  - Define JSON schema for platform profiles
  - Validate all profiles against schema
  - Fail test on schema violation

- [ ] **PLT-03**: Platform profile test runner integrated into npm test
  - `npm test:platforms` runs profile validation
  - Also runs as part of full `npm test`

- [ ] **PLT-04**: Profile coverage report
  - Report which profiles have integration tests
  - Report which profiles only have smoke tests
  - Output as test summary

## Error Recovery (ERR)

- [ ] **ERR-01**: Structured error objects (code, message, suggestion, retryable)
  - Define AgentError class with code, message, suggestion, retryable, context
  - All agent errors wrapped in AgentError

- [ ] **ERR-02**: Error card in chat stream with context
  - Render AgentError as styled card in chat
  - Show: what failed, why, suggestion for next step
  - Collapsible details for technical info

- [ ] **ERR-03**: One-click retry from error card
  - Retry button on retryable errors
  - Re-executes the exact failed step with same context
  - Shows new result (success or another error card)

- [ ] **ERR-04**: Agent-level error recovery policy
  - Auto-retry up to 3 times for retryable errors
  - After 3 failures, pause agent and show error card
  - User can: retry, skip step, adjust goal, or abort

## Future Requirements (deferred to v17.0+)

- Multi-agent orchestration (collaboration.js/federation.js)
- Visual macro recording/playback
- CDP network interception + console capture
- Natural language scheduled tasks
- Chrome Web Store publishing preparation

## Out of Scope

- **Mobile support** — Chrome extension, desktop only
- **Multi-user auth** — single-user extension per CLAUDE.md
- **Auto-updates** — explicitly excluded per CLAUDE.md
- **Web GUI** — explicitly excluded per CLAUDE.md

## Traceability

| Phase | Requirements |
|-------|-------------|
| Phase 1: Repo Hygiene | HYG-01, HYG-02, HYG-03, HYG-04, HYG-05 |
| Phase 2: Settings Persistence | SET-01, SET-02, SET-03, SET-04, SET-05 |
| Phase 3: WebSocket Bridge | WSB-01, WSB-02, WSB-03, WSB-04, WSB-05 |
| Phase 4: Plugin System | PLG-01, PLG-02, PLG-03, PLG-04, PLG-05, PLG-06 |
| Phase 5: Platform Profiles | PLT-01, PLT-02, PLT-03, PLT-04 |
| Phase 6: Error Recovery | ERR-01, ERR-02, ERR-03, ERR-04 |
