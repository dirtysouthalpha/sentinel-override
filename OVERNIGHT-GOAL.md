# Sentinel Override — Overnight Autonomy Goal (v23.0)

Browser-extension agent (Chrome MV3, vanilla JS, Jest). Repo root: this directory.
Work the PLAN -> ACT -> AUDIT -> REPEAT loop. Maintain `project_state.md` as your
brain: after every iteration append what you did, what you verified, what's left.

## Baseline (verified 2026-09-05)
- `npm test`: 264 suites, 10,921 passed / 132 skipped / 0 failed, ~60s.
- One jest worker fails to exit gracefully (timer/handle leak) — find and fix
  the leaking test teardown (`.unref()` / `clearInterval` on exit paths).
- v22.0 "Hardened Surfaces" complete. WSB is FURTHER ALONG than
  `.planning/STATE.md` claims: `background/ws-bridge.js` already has
  storage-based token, `auth_challenge` message type, challenge nonce, and a
  heartbeat timer. Verify what WSB-02..05 requirements remain vs. what exists
  before building anything.

## Hard rules
- NEVER break existing tests. Full gate: `npm test` (and `npm run lint` before
  each commit). Full gate before done: `npm run check` (lint + test:web +
  routes:check + test:contract + test + build) must pass.
- Chrome APIs in tests come from existing mocks in tests/ — follow those
  patterns; do not add new mocking frameworks.
- No new npm dependencies without a compelling reason (devDeps only with strong
  justification; the extension itself must stay dependency-light — `uuid` is
  currently the only runtime dep).
- Commit after every logical unit with a descriptive message; push to origin.
- Bump `manifest.json` version per shipped change-set (v23.0.x increments).
- If blocked >30 min, skip, log why in project_state.md, move on.

## Phase 1 — State reconciliation + leak fix
1. Run `npm run check` and record exact results in project_state.md.
2. Audit `background/ws-bridge.js` against REQUIREMENTS/STATE WSB-02..05:
   challenge-response handshake, WS message schema validation, heartbeat
   dead-connection detection (<30s), malformed-message rejection. For each:
   already-done (write a test pinning it if untested), partially-done (finish),
   or missing (implement). Update `.planning/STATE.md` to match reality.
3. Fix the jest worker leak: run `npm test -- --detectOpenHandles`, find the
   suite, fix its teardown. Gate: no "failed to exit gracefully" warning.
4. Update the stale `.planning/ROADMAP.md` header (still says "v16.0") — rewrite
   it as the v23.0 roadmap from this goal file.

## Phase 2 — Plugin system (PLG, the big unbuilt one)
`plugin-registry.js` skeleton exists (find it; grep). Requirements PLG-01..06:
1. Plugin schema (JSON Schema) + validator. Local file-based first.
2. Install from a local path/URL into extension storage; listed in settings UI.
3. Disable → its registered actions/interceptors do not fire.
4. Uninstall → files, storage entries, and registered handlers fully removed.
5. Conflict detection: two plugins claiming the same platform profile → warning
   surfaced in settings UI.
6. Tests for the full lifecycle: install → use → disable → enable → uninstall,
   including storage isolation between plugins.
Design constraint: plugins are data + JS bundles executed in the extension's
existing sandbox boundaries — do NOT introduce eval() or remote code loading;
read `background/agent-security.js` and the egress manifest first and keep the
plugin path inside the existing security model (`egress-coverage.test.js` must
stay green).

## Phase 3 — SET-03 unsaved-changes indicator
Settings edits that differ from persisted state show an indicator + Save/Discard
affordance in the popup; closing the popup with unsaved changes prompts. Uses
the single `persistSettings` write path (v22 work). Tests with linkedom DOM.

## Phase 4 — Stretch (only if 1-3 shipped and green)
1. Platform profile coverage report: extend `npm test:platforms` to emit which
   of the 19 profiles have integration vs smoke-only tests (ROADMAP Phase 5
   leftover).
2. Error Recovery UX audit (ROADMAP Phase 6): `agent-errors.js` exists — verify
   ERR-01..04 (error card, retry-same-context, pause-after-3-failures,
   collapsible details) are actually implemented; pin gaps with tests.

## Done means
- `npm run check` fully green. No worker-exit warning.
- PLG lifecycle shipped with tests. SET-03 shipped with tests.
- `.planning/STATE.md` + ROADMAP updated to reality. All work committed AND
  pushed. project_state.md final report: per-phase changes, evidence (test
  counts before/after), skips with reasons.
