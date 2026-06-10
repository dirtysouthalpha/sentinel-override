# Sentinel Override

## What This Is

A self-healing, vision-powered Chrome extension that turns the browser into an AI operator. Built for IT pros and MSPs — investigates, configures, and automates across multi-portal environments (SonicWall, M365, ConnectWise, NinjaOne, etc.) with defensible, source-cited reports. Manifest v3, 16+ LLM providers, 19 platform profiles, 8,400+ tests passing.

## Core Value

The agent must complete the user's goal on the first run without silent failures. Every action is traced, every claim is cited, every error is visible.

## Requirements

### Validated

<!-- Shipped in v10-v15 -->

- [x] Vision-powered element detection with numbered overlays — v10
- [x] Multi-provider LLM routing (16+ providers including OpenAI, Anthropic, Z.AI) — v10
- [x] 19 MSP platform profiles (SonicWall, Fortinet, M365, NinjaOne, etc.) — v10
- [x] Live status narration + API health heartbeat — v15
- [x] Screenshot capture + post-action verification — v15
- [x] Plan preview + natural language correction — v15
- [x] Enterprise audit export with hash chain verification — v14
- [x] REST API server + web dashboard — v15
- [x] Scheduling + macro recorder — v13
- [x] Knowledge graph + client knowledge — v13
- [x] Adaptive prompts + bias/novelty/contradiction detection — v12
- [x] Run queue with trust scoring — v11
- [x] Coordinate-based fallback clicking — v15

### Active

<!-- v16.0 milestone scope -->

- [ ] HYG-01: All stale session/phase/summary markdown removed from repo root
- [ ] HYG-02: docs/archive/ duplicates removed
- [ ] HYG-03: memory/ session artifacts removed or relocated
- [ ] HYG-04: marked.min.js replaced with npm dependency or moved to lib/
- [ ] HYG-05: v3.0-integration/ evaluated and integrated or removed
- [ ] SET-01: All settings writes go through single persistSettings() path
- [ ] SET-02: Settings read always returns storage-backed value
- [ ] SET-03: Unsaved changes indicator on all settings forms
- [ ] SET-04: Settings export/import (JSON backup/restore)
- [ ] SET-05: Settings migration on version upgrade (schema versioning)
- [ ] WSB-01: Auth token via configurable storage (not hardcoded)
- [ ] WSB-02: Challenge-response auth handshake on connect
- [ ] WSB-03: Message validation schema for WebSocket messages
- [ ] WSB-04: Exponential backoff reconnection with jitter
- [ ] WSB-05: Heartbeat timeout detection (30s idle = reconnect)
- [ ] PLG-01: Plugin registry endpoint URL configurable
- [ ] PLG-02: Plugin install lifecycle (fetch → download → validate → install → activate)
- [ ] PLG-03: Plugin uninstall with full cleanup
- [ ] PLG-04: Plugin toggle (enable/disable without uninstall)
- [ ] PLG-05: Plugin conflict detection
- [ ] PLG-06: Plugin management UI in settings modal
- [ ] PLT-01: Automated smoke test for all 19 platform profiles
- [ ] PLT-02: Platform profile schema validation
- [ ] PLT-03: Platform profile test runner in npm test
- [ ] PLT-04: Profile coverage report
- [ ] ERR-01: Structured error objects (code, message, suggestion, retryable)
- [ ] ERR-02: Error card in chat stream with context
- [ ] ERR-03: One-click retry from error card
- [ ] ERR-04: Agent-level error recovery policy

### Out of Scope

- Mobile support — Chrome extension, desktop only
- Multi-user auth — single-user extension per CLAUDE.md
- Auto-updates — explicitly excluded per CLAUDE.md
- Web GUI — explicitly excluded per CLAUDE.md
- Multi-agent orchestration — deferred to v17.0 (collaboration.js/federation.js stubs)
- Visual macro recording/playback — deferred to v17.0
- CDP network interception — deferred to v17.0
- Natural language scheduled tasks — deferred to v17.0
- Chrome Web Store publishing — future milestone

## Context

- Windows Server 2025 target (homeserver)
- Chrome Manifest v3, service worker background
- Z.AI coding plan API (primary provider), OpenAI and Anthropic compatible
- 155 test suites, 8,431 tests passing, 0 lint errors (as of v15.0.0-audit)
- WebSocket bridge connects to SENTINEL PRIME orchestration server
- Proxy at 127.0.0.1:18321 (zai-fix-proxy v3) handles OAuth token refresh
- Repo had significant session debris — 20+ stale markdown files accumulated during v3-v15 development

## Constraints

- **Manifest v3**: No eval, no remote code execution, service worker lifecycle constraints
- **No external dependencies at runtime**: marked.min.js is the only vendored lib — should be npm-managed
- **Security**: CSP is strict (script-src self-only), must maintain
- **Test gate**: All 8,431+ tests must pass after every change — no regressions
- **Platform profiles**: Must work with real portal DOMs — selectors must be maintained

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Manifest v3 service worker | Required by Chrome Web Store, future-proof | ✓ Good |
| Z.AI as primary LLM provider | Cost-effective coding plan, OpenAI-compatible API | ✓ Good |
| Platform profiles as JS modules | Easy to add/maintain, testable independently | ✓ Good |
| Vendored marked.min.js | Needed for markdown rendering in reports | ⚠️ Revisit — should be npm dependency |
| Plugin registry via remote URL | Enables community contributions without extension updates | — Pending |
| WebSocket bridge auth via hardcoded token | Quick prototype for SENTINEL integration | ⚠️ Revisit — must secure |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-10 after milestone v16.0 planning*
