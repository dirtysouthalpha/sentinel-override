# Milestone v23.0 Roadmap — Plugin Power + Settings Integrity

## Overview

**3 phases** | **8 requirements** | **2 categories**

Starting from the v22.0 Hardened Surfaces milestone (complete as of 2026-08-24).
Phase 1 (state reconciliation + leak fix) shipped as part of TOKEN-BURN-SPRINT-2;
Phases 2 and 3 are the remaining known work.

## Phase 1: State Reconciliation + Leak Fix (COMPLETE)

**Goal:** Reconcile planning state with shipped reality, audit WSB-02..05, and fix the jest worker leak.

**Requirements:** WSB-02, WSB-03, WSB-04, WSB-05 (audit + close-out)

**Success Criteria:**
1. `npm test` exits 0 with no "worker process has failed to exit gracefully" warning
2. WSB-02..05 each have a verdict (done/partial/missing) and pinning tests where applicable
3. `.planning/STATE.md` and `.planning/ROADMAP.md` reflect actual shipped state
4. `npm run check` fully green

**Notes:**
- Leak root cause: `background/skills/index.js` `_scheduleSaveStats()` 1500ms debounce timer without `.unref()` — fixed 2026-09-08
- uap-server `setupCleanup()` interval leak (init/shutdown cycle) — fixed same day
- WSB-02 (challenge-response) and WSB-05 (malformed-message rejection) verified already shipped; pinning tests added
- WSB-03 finished: per-type structural schema validation at the inbound boundary
- WSB-04 finished: dead-connection detection in the heartbeat (closes a socket silent > 30s so `onclose` → reconnect)

## Phase 2: Plugin System (PLG-01..06)

**Goal:** Working plugin lifecycle with install/use/disable/uninstall and conflict detection.

**Requirements:** PLG-01, PLG-02, PLG-03, PLG-04, PLG-05, PLG-06

**Success Criteria:**
1. Plugin schema (JSON Schema) + validator; local file-based first (PLG-01)
2. Install from local path/URL into extension storage; listed in settings UI (PLG-02)
3. Disable → registered actions/interceptors do not fire (PLG-03)
4. Uninstall → files, storage entries, handlers fully removed (PLG-04)
5. Conflict detection: two plugins claiming the same platform profile → warning in settings (PLG-05)
6. Tests for full lifecycle: install → use → disable → enable → uninstall + storage isolation (PLG-06)

**Notes:**
- `background/plugin-registry.js` already has skeleton code — build on it
- **Design constraint:** no `eval()` or remote code loading. Read `background/agent-security.js` and the egress manifest first; stay inside the existing security model
- Depends on the settings persistence write path (shipped in v22.0 SET module)

## Phase 3: SET-03 Unsaved-Changes Indicator

**Goal:** Every unsaved settings edit is visible and recoverable before it is lost.

**Requirements:** SET-03

**Success Criteria:**
1. Settings edits that differ from persisted state show an indicator + Save/Discard affordance
2. Closing the popup with unsaved changes prompts the user
3. Uses the single `persistSettings` write path (v22.0 SET module)
4. Tests with linkedom DOM

**Notes:**
- Smallest phase; touches only the popup settings surface and the v22.0 persistence module
- Deferred from v22.0 alongside WSB-02..05

## Out of Scope (for v23.0)

- Remote plugin registry (start with local file-based plugins only)
- Plugin sandboxing beyond the existing CSP + security model
- WSB transport change: the bridge remains plain WebSocket over `ws://localhost:8001`
