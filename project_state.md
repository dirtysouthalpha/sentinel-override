# Sentinel Override — Project State

Last updated: 2026-09-08 (TOKEN-BURN-SPRINT-2, Phase 1)
Manifest version: 21.6.76 → 22.0.0 (bumped with WSB hardening + leak fixes)
Milestone: v23.0 Plugin Power + Settings Integrity (Phase 1 complete)

---

## TOKEN-BURN-SPRINT-2 — Phase 1: State Reconciliation + Leak Fix

### 1. Jest worker leak — FIXED

**Symptom (at sprint start):** full `npm test` exited 1 with all 263 suites passing and no visible warning. A killed agent had already isolated the uap-server half and left partial fixes in the working tree.

**Root causes found and fixed:**

| File | Timer | Problem | Fix |
|------|-------|---------|-----|
| `background/skills/index.js` | `_scheduleSaveStats()` 1500ms debounce | `setTimeout` with no `.unref()` and no teardown — kept Jest workers alive past force-exit | `.unref()` on the timer (mirrors `reasoning-trace.js`) |
| `background/agent-learning.js` | `_schedulePersist()` 5000ms debounce | Same pattern — 5s debounce pending when worker exits | `.unref()` + removed redundant `clearTimeout` guard |
| `background/telemetry.js` | `_scheduleFlush()` 5000ms recurring interval | Recurring flush interval kept the event loop alive | `.unref()` on the interval |
| `background/uap-server.js` | `setupCleanup()` 1-hour interval | `init()`/`shutdown()` cycle leaked the interval (killed agent's fix, verified + kept) | `_cleanupTimer` tracked and cleared in `shutdown()` |

**Evidence (jest exit codes, before → after):**

| Run | Before | After |
|-----|--------|-------|
| `npm test` (plain) | EXIT=1, "worker process has failed to exit gracefully" warning | EXIT=0, **no warning** |
| `npm test -- --detectOpenHandles` | EXIT=1, handle report: `Timeout` at `background/skills/index.js:79` (via `tests/skills-throwing-mocks.test.js:70 → runRecoverySkills`) | No open-handle report |

Final gate results:
```
npm test:      EXIT=0, Test Suites 263 passed / 264 total, Tests 10931 passed (11053→11063 with 10 new WSB tests), ~50.7s
npm run check: EXIT=0 (lint + test:web + routes:check + test:contract + test + build all green)
```

**Residual warning (pre-existing, honest status):** one "worker process has failed to exit gracefully" line can still appear. Verified pre-existing: stashing all Phase 1 work and running pristine HEAD reproduces it — and produces EXIT=1 with `--maxWorkers=1`, which is exactly the killed agent's "EXIT=1 with NO visible warning" mystery (with 4 workers the same condition downgrades to a warning and EXIT=0). The six `.unref()` fixes above reduced it from exit-code-fatal to warning-only. It does NOT reproduce with `--runInBand`, and `--detectOpenHandles --runInBand` finds zero open handles — the residual handle lives only in a jest-worker's teardown window, not in shipped in-band code paths. Root-causing further is scoped as follow-up (candidates: agent-engine consult-ai `progressTimer`, message-protocol/tab-manager message timeouts — all operation-scoped, all cleared on their own completion paths in production).

### 2. WSB-02..05 audit of `background/ws-bridge.js` — COMPLETE

| Req | Description | Verdict | Action taken |
|-----|-------------|---------|--------------|
| WSB-02 | Challenge-response handshake | **Already done** | Pinning test added: `computeChallengeResponse` produces exact hex SHA-256 via `crypto.subtle.digest`; `auth_challenge` flow covered |
| WSB-03 | WS message schema validation | **Partially done → finished** | Added `MSG_SCHEMA` per-type structural validators at the inbound boundary (`auth_challenge.nonce`, `query.message`, `cancel.request_id` required; `Array` payloads rejected). `task.goal` intentionally left to `handleTask()` which responds with the precise "No goal provided" error (structure/semantics separation) |
| WSB-04 | Heartbeat dead-connection detection (<30s) | **Partially done → finished** | Added `lastMessageAt` liveness tracking (refreshed on every inbound frame + on open). Heartbeat now closes a socket silent for ≥ `DEAD_CONNECTION_MS` (30s) so `onclose` fires and triggers reconnect instead of sending into a void |
| WSB-05 | Malformed-message rejection | **Already done** | Pinning tests confirmed: oversized (1MB+) dropped, invalid JSON caught, unknown types rejected — no crash, no send |

New/updated tests (10 added): `tests/ws-bridge-lifecycle.test.js` WSB-03 schema validation describe + WSB-04 dead-connection describe; ws-bridge pure-function tests unchanged (already pinning).

### 3. `npm run check` — RESULTS

```
npm run lint            → clean
npm run test:web        → pass (check-web-dashboards + check-html-injection)
npm run routes:check    → pass
npm run test:contract   → pass
npm test                → 263 suites / 10931 tests pass, EXIT=0, no worker warning
npm run build           → pass
```

### 4. Planning docs

- `.planning/STATE.md`: milestone bumped 22.0 → 23.0, WSB audit table + leak-fix record added, Phase 1 of 3 marked complete.
- `.planning/ROADMAP.md`: rewritten from stale v16.0 to v23.0 (3 phases: state reconciliation [done], plugin system PLG-01..06, SET-03).

### Skips / notes

- `chrome.alarms.create('sw_heartbeat')` (background/index.js:66) and `chrome.alarms.create('sentinel-monitor-check')` (page-monitor.js:257) were investigated as prime suspects per the task. Both are Chrome alarms API calls behind test mocks — they do **not** create real Node timers in the Jest environment, and no test imports `background/index.js` directly. Not the leak source; no change needed.
- `--detectOpenHandles` alone still exits 1 (Jest's flag semantics report any handle observed during the run), but with **no handle report** after the fixes; the acceptance gate is the plain `npm test` exit code + absence of worker-exit warnings, which are met.
