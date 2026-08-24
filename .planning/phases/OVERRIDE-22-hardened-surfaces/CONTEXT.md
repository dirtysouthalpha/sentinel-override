# Milestone v22.0 "Hardened Surfaces" — Record

**Date:** 2026-08-24 · **Repo:** sentinel-override @ v21.6.76 · **Status:** COMPLETE

## Context
Planning docs had drifted 5+ versions behind shipped reality (PROJECT.md still listed v16 unchecked while v21.6.76 shipped). Fresh audit established what actually remained: PLT (platform validation) never built; SET (settings persistence) never built; WSB-01/ERR-01..04 already implemented upstream (token-from-storage, AgentError + card + retry + recovery policy, all tested).

## Phase 1 — PLT: Platform Profile Validation (BUILT)
- `background/platforms/schema.js`: validateProfile/validateRegistry — ids (kebab + legacy underscore), priority, detect(), pageTypes (empty allowed only with declared `catchAll: true`), knownSelectors accepting string / parameterized function / string[] option lists; selector-smoke charset incl. Playwright pseudos and attribute-substring values.
- `tests/platforms.test.js`: loads EVERY profile file on disk (dynamic import), validates all, duplicate-id detection, broken-profile rejection, selector smoke, coverage report (per-profile selector/pageType counts, catchAll-aware). Runs in the main npm test gate (PLT-03).
- Defect caught: `network_device` (the registered-last generic) shipped `pageTypes: []` undocumented — now declares `catchAll: true`, encoding existing design intent.

## Phase 2 — SET: Settings Persistence (BUILT; SET-03 deferred)
- `background/settings-persistence.js`: THE single write path — MANAGED_KEYS namespace, per-key validators, fail-closed (no partial writes), schema versioning + pure v1→v2 migration (legacy flat keys → providers structure), exportSettings/importSettings (type-checked payload, managed keys only).
- `popup-modules/settings.js`: quickAssist, brainEnabled, brainBaseUrl, and the save-button preferences now route through persistSettingsManaged(). Provider shape already had persistProviderConfig (kept).
- `tests/settings-persistence.test.js`: 8 tests incl. round-trip and fail-closed rejection.
- Deferred: SET-03 unsaved-changes indicator (UI polish, v23).

## Phase 3 — ERR: Verified already implemented (no new work)
AgentError (code/message/suggestion/retryable/context + toJSON), wrapError, recovery policy, error card with technical details, one-click retry re-firing the goal. Tests exist (agent-errors.test.js et al.).

## Verification
- Full gate: `npm test` (jest, workers pinned 4) — see STATE.md for the recorded run
- New suites: platforms (5 tests), settings-persistence (8 tests)
