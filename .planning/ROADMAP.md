# Milestone v16.0 Roadmap — Foundation Hardening + Plugin Power

## Overview

**6 phases** | **24 requirements** | **6 categories**

Starting from Phase 1 (continued numbering from scratch since this is a new milestone cycle).

## Phase 1: Repo Hygiene

**Goal:** Remove all session debris, consolidate docs, evaluate legacy code. Clean slate for development.

**Requirements:** HYG-01, HYG-02, HYG-03, HYG-04, HYG-05

**Success Criteria:**
1. `git ls-files '*.md'` shows only CHANGELOG, CLAUDE, LICENSE, README, docs/, MIGRATION_GUIDE, and release notes
2. No vendored JS in root that should be npm-managed
3. All 8,431 existing tests still pass after cleanup
4. `git status` is clean after commit

**Notes:**
- Safe phase — no feature changes, pure cleanup
- Run full test suite before and after to verify zero regressions
- Evaluate v3.0-integration/ carefully — may contain useful circuit-breaker patterns

## Phase 2: Settings Persistence

**Goal:** Single source of truth for all extension settings with no data loss.

**Requirements:** SET-01, SET-02, SET-03, SET-04, SET-05

**Success Criteria:**
1. Every write to settings goes through one function (persistSettings)
2. Killing the popup mid-edit doesn't lose previously saved settings
3. Export/import produces identical settings state on fresh install
4. Schema migration runs automatically on extension update

**Notes:**
- Bug #6 (key not persisted) was fixed in v15 but the pattern needs systemic fix
- This phase creates the foundation that Plugin System (Phase 4) depends on
- Settings export/import is critical for backup before any future changes

## Phase 3: WebSocket Bridge Hardening

**Goal:** Production-grade secure bridge for SENTINEL PRIME orchestration.

**Requirements:** WSB-01, WSB-02, WSB-03, WSB-04, WSB-05

**Success Criteria:**
1. Hardcoded token removed, auth read from configurable storage
2. Server disconnect + reconnect completes without message loss
3. Malformed messages rejected with error response, not crash
4. Heartbeat detects dead connections within 30 seconds

**Notes:**
- Current ws-bridge.js has hardcoded auth token 'sentinel-prime-bridge-2025'
- Must coordinate with SENTINEL PRIME bridge server expectations
- Reconnection must handle Chrome service worker lifecycle (may suspend)

## Phase 4: Plugin System

**Goal:** Working plugin lifecycle with browse/install/manage UI.

**Requirements:** PLG-01, PLG-02, PLG-03, PLG-04, PLG-05, PLG-06

**Success Criteria:**
1. Install a plugin from a registry URL, see it appear in settings
2. Disable a plugin, verify its actions don't fire
3. Uninstall removes all traces (files, storage, registered handlers)
4. Conflict between two plugins with same platform profile shows warning

**Notes:**
- Depends on Settings Persistence (Phase 2) for plugin storage
- plugin-registry.js already has skeleton code — build on it
- Start with local file-based plugins before remote registry
- Plugin schema should validate against a JSON schema

## Phase 5: Platform Profile Validation

**Goal:** Automated confidence in all 19 MSP platform integrations.

**Requirements:** PLT-01, PLT-02, PLT-03, PLT-04

**Success Criteria:**
1. `npm test:platforms` validates all 19 profiles pass schema + smoke tests
2. Invalid selector in a profile fails the test with actionable message
3. Coverage report shows which profiles have integration vs smoke-only tests
4. Runs as part of full `npm test` suite

**Notes:**
- 19 profiles: SonicWall NSM/OnBox, FortiGate, Aruba, Cisco, M365 Admin, IT Glue, ConnectWise, NinjaRMM, Huntress, ScreenConnect, SentinelOne, Palo Alto, Datto RMM, VirusTotal, NVD, Network Device, Ambio ViewLinc
- Focus on schema validation first (fast), then selector smoke tests
- Can't test against real portals (auth required) but can validate structure

## Phase 6: Error Recovery UX

**Goal:** Every failure is visible, explainable, and recoverable.

**Requirements:** ERR-01, ERR-02, ERR-03, ERR-04

**Success Criteria:**
1. Agent error produces a card with error code + human suggestion + retry button
2. Retry button re-executes the exact failed step with same context
3. After 3 consecutive failures, agent pauses and asks user for direction
4. Error cards are collapsible for technical details

**Notes:**
- Define AgentError class that wraps all existing error paths
- Error cards should match the existing chat message styling
- Retry logic must preserve agent state (current step, context, plan)
- This is the last phase because it touches agent-engine.js which is the most complex module
