# Changelog

## v3.30.0 — 2026-05-12 (Run Trust Score — one number for "how well did this run actually do")

Every release since v3.13.0 has chipped away at "the agent did something useful, probably." v3.30.0 finally puts a number on it. Each completed run gets a 0-100 trust score that rolls up failure rate, productivity, recovery effectiveness, plan adherence, token efficiency, and safety incidents into a single readout you can quote: "that run scored 87/100, trustworthy."

This is the metric you'd point at when comparing Sentinel to other browser agents. Most directly aligned with the "trustworthy as Claude in Chrome" target.

### Added — `background/trust-score.js` (new pure module)

Single-export `computeTrustScore(metrics)` returns `{ score, band, breakdown }`. Pure function, no `chrome.*` dependencies, testable in isolation. Component weights sum to 100, with one negative-deduction component:

- **40 pts — Failure rate.** `40 * (1 - failedSteps/totalSteps)`. Additional streak penalty: -5 per consecutive failure beyond 2, capped at -20. So a 10-step run with 1 isolated failure scores 36/40, but a 10-step run with a 5-failure streak scores 20/40 even at the same overall rate.
- **20 pts — Productivity density.** `20 * productiveSteps/totalSteps`. Captures whether the agent actually *did* anything (extract/note/finish-blocker) vs spinning on observations.
- **15 pts — Recovery effectiveness.** If recovery skills fired this run, what fraction led to a successful next step? If no skills needed, full 15 (no recovery required = healthy run).
- **10 pts — Plan adherence.** `planCompleted / planLength`. If no plan was generated, defaults to full 10 (not a penalty for unplanned runs).
- **10 pts — Token efficiency.** `apiCallCount / productiveSteps`. <1 → full credit, 3+ → zero, smoothly interpolated. Captures wasteful retry loops.
- **-5 pts — Safety incidents.** Each cross-tenant block / sensitive-field block / CSP-blocked execute_js deducts 2 points, capped at -5. These are *good outcomes* (we prevented something bad), but the underlying request was suspect — the small deduction reflects the LLM choosing to attempt the blocked action in the first place.

### Added — Trust bands

`trustBand(score)` returns one of:
- `'high'` (≥80) — green, "Trustworthy"
- `'good'` (≥60) — blue, "Good"
- `'questionable'` (≥40) — amber, "Questionable"
- `'low'` (<40) — red, "Low"

Boundaries deliberately require *not just absence of failures* but actual productive output. A run with no failures and no productive steps scores ~70-75 — good band, not great.

### Added — `describeTrustScore(scoreResult)`

Returns a one-line summary like `Trust 73/100 · good (weak productivity, 1 safety block)`. Used in telemetry messages and (eventually) the Run Log hover-tip. Leads with the dominant weakness so the operator sees what's pulling the score down without expanding the breakdown.

### Added — Agent-engine integration (background/agent-engine.js)

- New module-level counters: `failedSteps`, `consecutiveFailureMax`, `safetyBlocks`. Reset in `resetAgentState()`.
- Increment sites: `failedSteps++` and max-streak update at the existing self-healing failure path; `safetyBlocks++` at the cross-tenant lockdown site and on `CSP_BLOCKED` / `BLOCKED: target field appears sensitive` result strings.
- Score computed at run finalize. Attached to:
  1. The forensic run-log index entry (`trustScore`, `trustBand`, `trustBreakdown` fields).
  2. The `run_log_available` broadcast message (so the popup-side Run Log list can render the badge without a re-fetch).
  3. The `agent_finished` broadcast (so the chat report card renders the badge immediately).
- Telemetry `lifecycle` info emit: `Trust score: 87/100 (high)` with the full breakdown in payload.

### Added — Chat report card badge (popup-modules/chat.js)

When `agent_finished` carries a `trustScore` payload, the chat appends a trust-score card right after the completion summary. Card shows:
- Header line: bold score (`Trust 87/100`) in band-colored text + band label ("Trustworthy" / "Good" / "Questionable" / "Low") + ▾ details toggle.
- Click-to-expand breakdown: per-component bars (Failure rate / Productivity / Recovery / Plan / Efficiency / Safety) with progress bars showing points/max. Bars are color-coded by ratio.
- Inline render — no top-level helper added to chat.js. The file has had recurring large-edit truncation issues; isolating the score-card markup inside the `agent_finished` handler keeps the blast radius small.

### Why this matters

Until now, "how did the run go?" required eyeballing the step count, the report content, and any error toasts. Now there's a single number that:
- Tells you at-a-glance whether to trust the output without reading the full report.
- Gets persisted alongside the forensic log so historical trends are recoverable.
- Will eventually drive auto-retry decisions (low scores → suggest re-run with a different mode).
- Gives you a quotable metric for the "is this thing good?" conversation.

### Files touched

- `background/trust-score.js` — new (170 lines, pure function + helpers).
- `background/agent-engine.js` — counter declarations + reset + 2 increment sites + run-finalize integration + `agent_finished` payload + telemetry emit.
- `popup-modules/chat.js` — inline trust-score card render in the `agent_finished` handler.
- `manifest.json` — 3.29.0 → 3.30.0.
- `CHANGELOG.md` — this entry.

### Not in this version

- Score badge in the Past Runs dropdown (telemetry panel) — the data is already on the run-log index entry, but rendering it in the dropdown UI is deferred to v3.31.0.
- Score badge in the standalone report-view tab — deferred. The chat report card carries it for now.
- Auto-retry on low scores — deferred until we have at least a week of real scores to set the threshold from.
- Trend chart of scores over time — deferred.
- Per-platform score breakdown — deferred (pairs naturally with v3.29's per-platform skill stats, both wait on the platform-tagging layer).

---

## v3.29.0 — 2026-05-12 (Adaptive skill priority — outcome-driven recovery learning)

The recovery skill library (v3.21.0) ships with 8 skills, each with a hand-picked static priority number. v3.29.0 turns those numbers into a starting point and lets real-run outcomes nudge them up or down. A skill that consistently rescues runs gets promoted; a skill that fires noisily but doesn't actually help gets demoted. The static priorities still anchor — adjustments cap at ±20.

### Added — Skill outcome tracking (background/skills/index.js)

Per-skill stats persisted to `chrome.storage.local.skill_stats`:
```
{
  [skillId]: {
    fires: integer,            // total times this skill was applied
    successes: integer,        // times the NEXT step's action did NOT fail
    failures: integer,         // times the next step's action also failed
    lastFiredAt: epoch ms,
    lastOutcomeAt: epoch ms
  }
}
```

Outcome attribution: simple "next step success" heuristic. The skill fires, the engine dispatches the next action (either the autoApply command directly or the LLM's follow-up after a prompt injection), and the verdict is whichever action that is. If multiple skills fire in one step, they all share the same outcome credit. Partial-credit attribution is a research problem we don't need to start getting signal.

### Added — Effective priority calculation

```
effectivePriority(skill) = basePriority + Math.round((successRate - 0.5) * 40)
```

- successRate = 1.0 → +20 boost (the skill fires and ~always rescues the run)
- successRate = 0.5 → 0 (neutral — coin flip, no signal)
- successRate = 0.0 → -20 penalty (the skill fires but the next step still fails)

Requires ≥3 fires before any adjustment applies — avoids jumping conclusions on tiny samples. Skills with fewer fires use the static priority as-is.

`runRecoverySkills()` sorts by effective priority (not static), so as your runs accumulate, the order in which skills compete to autoApply shifts toward the ones that have actually been working.

### Added — Self-contained outcome loop

No agent-engine changes required. `runRecoverySkills()` records outcomes for the *previous* call's pending skills at the top of every invocation, judging against `context.lastActionFailed`. This means:
- The same call site that already fires recovery skills now also closes the learning loop.
- If the agent stops mid-run, the pending skills' outcomes are simply lost (no leak, no corruption — they just don't get credited this run).

### Added — Settings toggle + reset (popup.html + popup-modules/settings.js)

- "Adaptive skill priority" checkbox in the existing Live Telemetry settings card. **Default ON.** Wired to `chrome.storage.local.telemetrySkillAdapt`. When OFF, all skills fall back to their static priority.
- "Reset stats" button next to it. Confirmation dialog before wiping. Clears in-memory cache + storage entry.
- "View skill stats" button opens a modal table: skill ID, description, fires, successes/failures, success rate (color-coded ≥70% green / ≥40% amber / red), base priority, effective priority + delta. Sorted by effective priority descending — top rows fire first when multiple match.

### Added — Bridge handlers (background/index.js)

Three new message cases:
- `list_skills_with_stats` → `listSkills()` (now returns stats + effectivePriority on each skill).
- `get_skill_stats` → `getSkillStats()` (raw stats map with successRate + base/effective priority computed).
- `reset_skill_stats` → `resetSkillStats()` (clears in-memory + storage, emits telemetry).

### Telemetry

Every skill outcome emits a `skill` category event at debug level:
```
Skill outcome: <id> → success | failure
  { skillId, success, fires, successes, failures, successRate, adjustedPriority }
```

Pair with the v3.25.1 "Skill matched" debug events to trace a full skill lifecycle: matched → fired → outcome → stat updated → effective priority adjusted.

### Why this matters

The static priorities in v3.21.0 were guesses based on which skills *seemed* most likely to be load-bearing. After a month of real runs you'd want to know:
- Did `selectorMiss` actually rescue runs, or did the LLM ignore its injection 80% of the time?
- Is `consecutiveFailures` firing too eagerly, marking transient hiccups as fatal?
- Did the `cspBlocked` skill that we shipped in v3.21.1 turn out to fire on pages that weren't actually CSP-blocked?

v3.29.0 gives you the data. Open "View skill stats" after a week and the answers are in front of you.

### Files touched

- `background/skills/index.js` — +140 lines (stats state, _effectivePriority, _recordPendingOutcomes, resetSkillStats, getSkillStats, sort + pending-stamp wiring).
- `background/index.js` — 3 new message-handler cases + import.
- `popup-modules/settings.js` — Adaptive toggle, Reset button, View Stats modal (renders the stats table).
- `popup.html` — checkbox + two buttons in the Live Telemetry settings card.
- `manifest.json` — 3.28.0 → 3.29.0.
- `CHANGELOG.md` — this entry.

### Not in this version

- Per-skill manual enable/disable from the View Stats modal — deferred until a skill earns a "permanently bad, never fire" verdict in real runs.
- Outcome attribution over a longer window (success-within-3-steps rather than just-next-step) — deferred until next-step proves insufficient.
- Cross-domain skill stats (e.g. `selectorMiss` performs differently on M365 vs SonicWall) — deferred. The current scheme is a global rollup; per-platform stats would need a tagging layer.

---

## v3.28.0 — 2026-05-12 (Telemetry redaction — close the persist/export leak)

v3.27.0 shipped persistence + Export JSON. That immediately created a new leak surface: API keys, bearer tokens, or password values that happen to ride along in a telemetry payload now survive across sessions and walk out the door inside bug-report attachments. v3.28.0 plugs that with an aggressive default-ON scrubber in `emit()`.

### Added — Redaction layer (background/telemetry.js)

Three-tier scrub applied to every emit, before broadcast + before persistence:

**1. Pattern-based replacements** (9 patterns, run against message + every string in payload):
- OpenAI: `sk-proj-*`, `sk-svcacct-*`, `sk-*` (20+ char tail)
- Anthropic: `sk-ant-*`
- GitHub: `ghp_*`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*`
- AWS access key: `AKIA[16 chars]`
- Google API key: `AIza[35 chars]`
- Slack: `xoxb-*` / `xoxp-*` / `xoxr-*` / `xoxs-*` / `xoxa-*`
- Stripe live keys: `sk_live_*`, `pk_live_*`, `rk_live_*`
- Bearer / Basic auth headers (scheme preserved, credential redacted)
- JWT-shaped tokens (`eyJ*.eyJ*.*`)

Each replacement uses a labeled placeholder like `[REDACTED:openai-key]` so operators can see at a glance which credential type was scrubbed — useful for triaging "wait, what key was in that payload?" moments without leaking the value.

**2. JSON field-name driven scrubs** (case-insensitive whole-value replacement when the key matches):
- `password`, `passwd`, `secret`
- `api_key` / `apikey` (exact)
- `auth_token`, `access_token`, `refresh_token`, `bearer_token`, `session_token`
- `private_key`, `client_secret`, `csrf_token`
- `recovery_code`, `mfa_code`

Recursive — handles nested objects + arrays. So if a network response payload includes `{ user: { recovery_code: 'A1B2-C3D4' } }`, the recovery code gets `[REDACTED]` regardless of the surrounding shape.

**3. URL query-param scrub** (string-level regex against any URL-shaped substring):
- `?token=*`, `?access_token=*`, `?refresh_token=*`, `?id_token=*`
- `?apikey=*`, `?api_key=*`, `?key=*`, `?secret=*`
- `?password=*`, `?pwd=*`, `?sig=*`, `?signature=*`
- `?code=*`, `?state=*` (OAuth flow values)

This catches the most common leak path: navigate / page telemetry capturing a URL with credentials in the query string. The param name passes through; only the value is `[REDACTED]`.

### Trust-boundary design

- **chrome.runtime broadcast (panel)** — redacted.
- **chrome.storage persistence** — redacted.
- **Export JSON download** — redacted (consumes the same persisted/buffered events).
- **SW console (chrome://extensions DevTools)** — RAW. Reason: anyone with DevTools access can read storage anyway, and deep debugging needs unredacted output. This is an established trust boundary in the codebase.

### Added — Settings toggle (popup.html + popup-modules/settings.js)

- New "Redact sensitive payloads" checkbox in the existing Live Telemetry settings card. **Default ON.**
- Wired to `chrome.storage.local.telemetryRedact`. Tested against three states: explicit-true → on, explicit-false → off, unset → on (safer default).
- `chrome.storage.onChanged` listener in telemetry.js reacts immediately — no reload needed.
- Toast confirms each toggle: "Telemetry redaction ON — secrets scrubbed before persist" or "Telemetry redaction OFF — raw payloads will be stored".

### Fail-open semantics

If `_redactEvent()` throws for any reason (malformed payload, circular reference in object), it returns the **original** event. Rationale: visibility is the whole point of the panel. Better to leak a single buggy event to the operator than to silently drop telemetry and look like a hang. The console mirror always shows raw events anyway, so the worst case is parity with v3.27.0.

### Why these patterns specifically

Every regex was selected based on real values that have appeared in telemetry during v3.13 → v3.27 testing:
- Brandon's Z.AI / GLM API keys (covered by the generic 20-char tail patterns).
- Microsoft tenant bearer tokens captured during `read_network_requests` on Entra portals.
- OAuth `?code=` values in M365 sign-in redirects.
- SentinelOne JWTs in execute_js CSP-block error messages.
- Stripe `sk_live_*` keys mistakenly pasted into ticket descriptions during testing.

### Files touched

- `background/telemetry.js` — +120 lines (REDACT_PATTERNS, REDACT_KEY_PATTERNS, REDACT_QUERY_PARAMS, _redactString, _redactValue, _redactEvent + wiring in emit()).
- `popup.html` — Redact checkbox in the Live Telemetry settings card.
- `popup-modules/settings.js` — Redact toggle wiring (default-ON storage semantics).
- `manifest.json` — 3.27.0 → 3.28.0.
- `CHANGELOG.md` — this entry.

### Not in this version

- Per-event "🛡 Redacted" badge in the panel UI — deferred. The placeholder text `[REDACTED:label]` is visible at the message level which is currently sufficient.
- Custom user-defined regex patterns — deferred until at least one user requests it.
- Console-mirror redaction toggle (`telemetryRedactConsoleAlso`) — deferred; SW DevTools is a fine trust boundary for now.

---

## v3.27.0 — 2026-05-12 (Telemetry export + cross-session persistence)

Finishes the v3.25.0 telemetry framework. Two big additions: every run's events can now survive a panel close / browser restart (opt-in), and you can dump the current panel buffer to a downloadable JSON file at any time.

The push: a colleague reports "the agent hung yesterday" — you used to be looking at an empty panel. Now you toggle Past Runs ▾, pick the run, and replay it.

### Added — Cross-session telemetry persistence (background/telemetry.js)

- New `startRun(runId, goal)` / `endRun(runId)` lifecycle hooks. agent-engine calls these alongside the existing run-log open/finalize sites so the telemetry index matches the forensic log 1:1.
- Background-side buffering: every emit also pushes into an in-memory `_runBuffer`. A 5-second flush timer writes the buffer to `chrome.storage.local.telemetry_run_<id>` and bumps the count on `telemetry_runs_index`.
- Storage cap: 5 runs maximum (oldest evicted with their event lists). Per-run hard cap of 1000 events to prevent runaway runs from hitting Chrome's QUOTA_BYTES_PER_ITEM.
- Settings-toggle reactive: flipping the persistence checkbox mid-run starts/stops the flush timer immediately via the existing `chrome.storage.onChanged` listener.
- Three new exported helpers for the panel: `listPersistedRuns()` returns the index, `loadPersistedRun(runId)` returns the events for one run, `deletePersistedRun(runId)` removes a single run from storage.
- Early-flush trigger: if `_runBuffer` exceeds 200 events between scheduled flushes (i.e. the agent is firing >40 events/sec), flush immediately to bound memory.
- Quota-safe error path: if a storage write throws (typically QUOTA_BYTES_PER_ITEM), drop the buffer instead of retry-looping.

### Added — Telemetry-engine run lifecycle (background/agent-engine.js)

- `telStartRun(runLogId, goal)` called at the same point as the forensic run-log open (right after `_updateRunLogIndex`).
- `telEndRun(runLogId)` called on both natural completion (after `_updateRunLogIndex` finalize) and user-initiated `stopAgent`. The natural-finish path is `await`ed so storage flushes before the service worker has a chance to suspend after `agent_finished` fires.

### Added — Export JSON button (popup-modules/telemetry-panel.js)

- New "Export" button in the panel header, between Copy and Past Runs. Dumps the *filtered* events (respecting active filter chip + search query) as a downloadable `sentinel-telemetry-<ISO timestamp>.json` file.
- Schema: `{ schemaVersion, exportedAt, filter, search, totalEvents, filteredEvents, viewingPastRun, events: [...] }`. Pastes cleanly into a bug report.
- Uses `URL.createObjectURL` + anchor click trick — no extra Chrome APIs needed. Object URL revoked after 1.5s.

### Added — Past Runs dropdown (popup-modules/telemetry-panel.js)

- New "Past Runs ▾" button opens an anchored dropdown listing persisted runs (most recent first).
- Each item shows: completion glyph (✓ vs ⋯), goal snippet (60 chars), start timestamp (localized), event count, and a per-item delete (✕) button.
- "● Live stream" item at top always shows the current run's buffer size and switches back to live view.
- Click a row → snapshot the live buffer into `_liveBuffer`, swap the visible `events` array with the loaded run's events, render. Click "Back to Live" → reverse.
- While viewing a past run, incoming `telemetry_event` messages get routed into `_liveBuffer` instead of being dropped, so nothing's lost when the operator toggles back.
- Sticky orange "Viewing past run · &lt;goal&gt; · &lt;timestamp&gt;" banner above the event list. Includes a Back to Live button so it works without the dropdown.
- Outside-click + Escape both dismiss the dropdown.

### Added — Message handlers (background/index.js)

Three new bridge cases so the popup-side panel can read persistence state without importing telemetry.js:
- `list_persisted_telemetry_runs` → `listPersistedRuns()`
- `load_persisted_telemetry_run` (with `runId`) → `loadPersistedRun(runId)`
- `delete_persisted_telemetry_run` (with `runId`) → `deletePersistedRun(runId)`

### Added — Settings toggle (popup.html + popup-modules/settings.js)

- New "Persist telemetry across sessions" checkbox in the existing Live Telemetry Verbosity card. Visually grouped with the verbosity dropdown under a top-border so both controls feel like one telemetry-settings unit.
- Wired to `chrome.storage.local.telemetryPersist` (default false). Shows a toast on change.

### Why these specifically

The v3.25.0 panel solved the "I can't see what's happening right now" problem. v3.27.0 solves the two adjacent problems:
1. **"It happened yesterday"** — persistence + Past Runs.
2. **"Look at what I'm seeing"** — Export JSON button.

Both are opt-in / no-cost when not used. The persistence checkbox is OFF by default, so users who don't need cross-session debugging get zero storage overhead.

### Files touched

- `background/telemetry.js` — +175 lines (persistence layer + 4 exported helpers).
- `background/agent-engine.js` — startRun/endRun wiring at run-log open, finalize, and stopAgent (+3 emit sites).
- `background/index.js` — 3 new message-handler cases + import.
- `popup-modules/telemetry-panel.js` — Export button + Past Runs dropdown + Viewing banner + live-buffer routing while viewing past.
- `popup-modules/settings.js` — Persistence checkbox wiring.
- `popup.html` — Persistence checkbox markup in the existing Telemetry settings card.
- `manifest.json` — 3.26.0 → 3.27.0.
- `CHANGELOG.md` — this entry.

### Not in this version

- Per-run goal-text filtering on the Past Runs dropdown — deferred; 5 runs is small enough that scrolling works.
- Telemetry-event redaction (strip API keys / tokens before persist) — deferred to v3.28.0 if user reports show sensitive payloads leaking.
- Cross-device sync (chrome.storage.sync) — deliberately not supported; the per-item quota is 8KB which a single run blows past instantly.

---

## v3.26.0 — 2026-05-12 (Content-script telemetry bridge)

The agent runs in three execution contexts — service worker (background), side panel (popup), and the page itself (content script). v3.25.0 lit up the first two; v3.26.0 finishes the picture by routing content-script events through the same panel, with the same filters and verbosity gate.

This matters because the content script is where most "the agent did something weird and I don't know why" moments happen: stale selectors, sensitive-field blocks, disabled-element rejections, CSP violations, execute_js timeouts. Until now those returned a string to the engine and that's all you saw.

### Added — Telemetry bridge (background/index.js)

- New `content_telemetry_event` message handler. Content script sends `{ category, level, message, payload }`; background re-emits via `tel.<level>(category, message, payload)`. This means content-side events get verbosity gating, console mirror, sequence numbering, and panel broadcast for free — no separate transport.
- Sender auto-stamping: every content event is annotated with `tabId` and `frameUrl` (truncated to 200 chars) so the panel can attribute events to the originating tab.

### Added — Content-side emit helper (content/index.js)

- `window.__sentinelContentTel` (alias `ctel`) — fire-and-forget helper with per-level shorthands (`.error`, `.warn`, `.info`, `.debug`, `.trace`).
- Defined unconditionally before the re-injection guard so handlers in both the initial load and re-injected paths can use it.
- Never throws (wrapped in try/catch); never blocks (uses `.catch(() => {})` on the promise).

### Added — Content-script hooks (content/index.js)

Six high-signal hooks at the sites that have produced the most "what happened?" moments during real runs:

- `click` target not found — warn level. Includes selector, ref, label, staleRef flag, and current URL. This is the single most common content-side failure; surfaces selector hallucination and SPA late-mount issues immediately.
- `click` rejected (disabled / pointer-events:none / aria-disabled) — warn level. Includes the rejection reason from `dom.checkInteractable`.
- `type` target not found — warn level. Same shape as the click variant, plus the text length so you can see when long passages were about to be entered into a missing field.
- `type` BLOCKED by sensitive-field detector — warn level (always visible). Logs the matched pattern (e.g. "password", "recovery-code", "API-secret"), field tag/name/id. This is a security event; operators audit these.
- `type` rejected (disabled / aria-disabled) — warn level.
- `extract` target not found — warn level.
- CSP `securitypolicyviolation` — warn level. Captures the first violation observed during an execute_js injection window with directive, blockedURI, effectiveDirective, sample, and sourceFile. Distinguishes strict SentinelOne-style policies from looser CDN-only policies.
- `execute_js` timeout — warn level. Includes timeoutMs, key, codeLen. Different cause profile from CSP block — usually long-running scripts or unresponsive pages.
- `execute_js` runtime error — warn level. Truncated exception message + key + codeLen.
- `execute_js` outer failure — error level. Catches infrastructure failures (script element rejected, etc.).

### Why these specifically

Every one of these has been the silent cause of a "the agent stopped working" report at least once during v3.13 → v3.25. Now they all surface to the same panel as the LLM and skill events — so when a click misses, you see the selector + URL right next to the LLM decision that emitted it.

### Panel UI — no changes required

The existing `popup-modules/telemetry-panel.js` filter chips, search, copy, clear, level dots, and category badges all work as-is. Content events use the `page` category, which already has a filter chip and color badge. The `tabId`/`frameUrl` payload fields surface when you click a row to expand.

### Files touched

- `background/index.js` — new `content_telemetry_event` case in the message handler (+ tel import).
- `content/index.js` — `window.__sentinelContentTel` helper at module top + 9 emit sites (click ×2, type ×3, extract ×1, CSP ×1, execute_js ×3).
- `manifest.json` — 3.25.1 → 3.26.0.
- `CHANGELOG.md` — this entry.

### Not in this version

- Forensic-log persistence of telemetry events (cross-session debugging) — deferred to v3.27.0.
- Telemetry export-as-JSON button — deferred to v3.27.0.
- Content-side shadow-DOM hit logging — deferred until shadow-intercept.js gets its own telemetry pass (it runs in MAIN world and needs a different bridge).

---

## v3.25.1 — 2026-05-12 (Telemetry hook expansion)

Builds out the v3.25.0 framework with high-signal hooks at the sites that mattered during the v3.13 → v3.21 incident parade — memory writes, navigates, CDP attach/detach, network/console reads, platform detection, recovery-skill matches, and goal rewriting. Same panel, same filters, same verbosity dropdown — just much more visible from the operator's seat.

### Added — Telemetry hooks (background/agent-engine.js)

- `memory` — every `extract` / `extract_list` / `execute_js` memory write logs the key, length, isArray flag, and (for execute_js) which retry-ladder strategy succeeded (`original` / `body_text_fallback` / `visible_text_fallback`). Lets you watch memory build in real time and spot keys getting repeatedly overwritten.
- `page` — navigate kickoff (target URL + fromUrl), navigate success (arrivedUrl + durationMs), navigate landed-elsewhere warnings (intended vs arrivedUrl), and invalid-URL rejections.
- `network` — agent-level read_network_requests (with failed count) and read_console_messages (with filter + returned count). Errors surface at error level with the exception message.
- `sleep` — trace-level only for sleeps ≥ 1500ms (the post-navigate / page-load waits that operators actually care about — short jitter sleeps are suppressed to keep the panel readable).
- `storage` — run log opened (with runLogId + goal length) + run log finalized (with entries + stepCount + apiCallCount); paired bracket-style events for postmortem export. `persistHistory` emits at trace level only.

### Added — Telemetry hooks (background/tab-manager.js)

- `cdp` — debugger attach (debug then info levels — debug during attach, info on success with attachedCount), debugger detach-all (with tabId list), unexpected detaches via `chrome.debugger.onDetach` (warn level — most common cause is the user clicking "Cancel" on the orange CDP banner mid-run, which silently breaks subsequent trusted-input clicks).
- `cdp` — `cdpExecuteJs` runtime exceptions (warn + truncated error message) and outer failures (warn + attachDenied flag). Trace-level success emit when codeLen + value-present is useful for chasing extract retries.
- `network` — `readConsoleMessages` and `readNetworkRequests` emit at debug level with returned count + filter so you can confirm what observation passes are returning before the LLM acts on them.

### Added — Telemetry hooks (background/llm-client.js + adaptive-prompts.js + skills/index.js)

- `platform` — `getPlatformContext` emits once per (profileId, host) change so the panel shows platform transitions (e.g. "m365_admin → entra → exchange") without spamming every observation cycle. Includes a "No platform profile match" debug emit so unrecognized portals are easy to spot.
- `platform` — adaptive-prompts goal rewriter emits one telemetry event at the end of every rewrite attempt: info if adapted, debug for soft skips (no profile, no adaptation needed, goal too short), warn for unexpected errors. Payload includes platformId, mismatchHintCount, durationMs, adaptedLen vs originalLen.
- `skill` — per-skill match logging at debug level (skillId, priority, stepCount, consecutiveFailures, lastActionFailed, lastCommandType). agent-engine continues to emit the aggregated summary at info level; these per-skill events let you trace exactly which skills' `matches()` predicates fired.

### Why these hooks specifically

These eight categories cover every failure pattern we hit during the v3.13 → v3.25 incident parade:
- M365 SMTP sign-in wall freeze → `page` + `sleep` telemetry now shows the post-navigate wait timing out.
- SonicWall NSM menu mismatch → `platform` shows when the profile matched + whether goal-rewriting fired.
- SentinelOne CSP-blocked execute_js → `cdp` warn emits the exact runtime exception.
- Drudge Report multi-article inefficiency → `memory` telemetry shows per-article writes accumulating.
- Cloudflare history-scope crash → `lifecycle` + `error` telemetry brackets the run.
- Unexpected debugger detach mid-run → new `cdp` warn fires immediately.

### Files touched

- `background/telemetry.js` — unchanged (framework was complete in v3.25.0)
- `background/agent-engine.js` — +8 emit sites (memory ×2, page ×4, network ×4, sleep ×1, storage ×3)
- `background/tab-manager.js` — +5 emit sites + import (cdp attach/detach/onDetach, cdpExecuteJs, console/network reads)
- `background/llm-client.js` — +1 emit site + de-dup helper + import (platform detection)
- `background/adaptive-prompts.js` — +1 emit site + import (rewriter outcome)
- `background/skills/index.js` — +2 emit sites + import (per-skill match + predicate error)
- `manifest.json` — 3.25.0 → 3.25.1
- `CHANGELOG.md` — this entry

No popup-side changes. Existing telemetry panel UI consumes the new events without modification.

---

## v3.25.0 — 2026-05-12 (Live Telemetry Panel — stop the black box)

User ask: "We need to make sure we're always seeing what it's doing or where it hangs at, the whole black box thing doesn't work when troubleshooting."

v3.25.0 ships a slide-up Live Telemetry Panel that shows every internal event — LLM calls with elapsed time + provider/model details, recovery skill consultations, lifecycle transitions, page observations, memory writes, CDP attach/detach, errors, and more — in real time as the agent runs. Pinned to the bottom of the side panel (past the rail), filterable, searchable, copyable. When something hangs, you open the panel and SEE where.

### Added — `background/telemetry.js` (new emit module)

- `emit(category, level, message, payload)` — broadcasts a `telemetry_event` chrome.runtime message + mirrors to SW DevTools console.
- Convenience: `tel.error/warn/info/debug/trace(category, message, payload?)`.
- Verbosity gating: `chrome.storage.local.telemetryLevel` ('quiet' / 'normal' / 'verbose' / 'debug'), default 'normal'. Re-reads on storage change via `chrome.storage.onChanged` listener so verbosity flips take effect immediately.
- 11 standard categories: `llm`, `skill`, `platform`, `memory`, `cdp`, `page`, `sleep`, `storage`, `network`, `lifecycle`, `error`.
- Monotonic `seq` counter on every event so the panel can detect dropped messages.

### Added — Hooks across the agent loop (`background/agent-engine.js`)

Initial hook set in v3.25.0:
- `lifecycle` — agent start (with goal + startTabId), stop (user-initiated), per-step start (with stepCount, dynamicMaxSteps, productiveSteps, consecutiveFailures).
- `llm` — call started (with elementsCount, pageTextLen, historyEntries, hasScreenshot), call finished (with durationMs + decided action type), call failed (with durationMs + error).
- `skill` — recovery skill consultations (with applied skill IDs, autoApplied flag, last result preview).

More hooks (memory writes, CDP events, page observations, storage writes, sleep delays) deferred to v3.25.1+ — easier to add incrementally than tune all at once. The framework supports any number; each new hook is one `tel.<level>('<category>', '<message>', { ...payload })` line.

### Added — Slide-up panel (`popup-modules/telemetry-panel.js`)

- Fixed-position panel, 40vh tall by default, slides up from the bottom of the side panel (past the 42px left rail).
- Header bar: search box + Pause/Auto-scroll toggle + Copy + Clear + Close.
- Filter chips: All / Errors+Warn / LLM / Skills / Platform / Memory / Page / Lifecycle / CDP / Network / Storage. Clicking a chip filters live events + retroactively from buffer.
- Each event row: HH:MM:SS.ms timestamp + level dot (color-coded) + category badge (color-coded by category) + message. Click row to expand JSON payload inline.
- Circular buffer: last 500 events in memory. DOM shows last 250 of filtered set (auto-trims older nodes to keep render snappy).
- Auto-scroll detection: scrolling up pauses auto-scroll automatically; scrolling back near bottom re-enables it. Manual Pause button overrides.
- Copy button: dumps all currently-filtered events to clipboard as plaintext (`HH:MM:SS.ms [level/category] message  {payload}`) — drop straight into a bug report or chat.

### Added — Rail button + settings toggle

- New rail icon (pulse-line activity icon) opens/closes the telemetry panel. Tooltip "Live Telemetry".
- New Settings dropdown "Live Telemetry Verbosity" with 4 levels. Default Normal. Changes apply on next emit (no reload needed).

### Bumped

- `manifest.json`: `3.24.0` → `3.25.0`.

### Files touched

- `background/telemetry.js` — NEW (~110 lines).
- `background/agent-engine.js` — imported tel; hooks at startAgent, stopAgent, step start, LLM start/finish/fail, skill consult (~8 hook sites in this release).
- `popup-modules/telemetry-panel.js` — NEW (~280 lines). Self-contained IIFE.
- `popup-modules/settings.js` — wires the verbosity dropdown.
- `popup.html` — rail button + verbosity dropdown + script tag.

### Honest notes

- Initial hook set is intentionally minimal (~8 hooks) — covers the most-frequently-asked questions ("is the LLM hung?", "did a skill fire?", "what step are we on?"). The framework is in place; v3.25.1+ adds more hooks based on real-run diagnostics.
- Telemetry events are NOT persisted across sessions — the panel is a live diagnostic surface, not a historical log. The forensic run log (v3.9.0) is still where durable per-step records live.
- Open the SW console alongside the panel for the same events mirrored to console.log/warn/error — useful for grep + cross-referencing with other browser-internal events.
- Performance: every emit is a fire-and-forget chrome.runtime.sendMessage + console call. Per-event cost is sub-millisecond. Even at high verbosity on a 100-step run, total overhead is well under 1% of run time.


## v3.24.0 — 2026-05-12 (Recent Chats — session archive + restore)

User ask: "When I close the extension it closes the chat also, but have the ability to bring it back, last 10 or so prompts and actions and all."

v3.24.0 ships exactly that. Sessions auto-archive when the side panel closes, when an agent run finishes, or when the user clicks New Chat. A new rail button opens a Recent Chats modal showing the last 10 archives — pick one to restore the full chat (messages + action cards + activity streams + final report) back into the chat view.

### Added — `popup-modules/recent-chats.js`

- New `chrome.storage.local.recent_chats` storage key, capped at 10 sessions. Each entry: `{id, goal, createdAt, finishedAt, messagesCount, hadReport, runLogId, htmlSnapshot, conversationHistory, archivedReason}`.
- Snapshot strategy: serialize the chatContainer's `innerHTML` so action cards, activity streams, banners, and report cards all restore visually. Plus the underlying `conversationHistory` array for message-level fidelity.
- `archiveCurrentChat(opts)` — captures the current state. Called on visibilitychange (panel hidden), beforeunload, agent_finished + report_update ready, and New Chat click. Dedup: skips archives within 5 seconds of the last identical snapshot (prevents duplicates from rapid panel-toggle).
- `listRecentChats()` / `restoreChat(id)` / `deleteRecentChat(id)` / `clearAllRecent()` — public API.
- Restore flow: archives the current chat first (so work-in-progress isn't lost), then replaces chatContainer's innerHTML with the snapshot and syncs conversationHistory. Adds a "Restored chat · archived 4 min ago · 12 messages · had report" banner at the top with a Dismiss button.
- Exposed globally as `window.__sentinelRecentChats` so chat.js and other modules can call archive on events.

### Added — Recent Chats rail button + modal (`popup.html`)

- New rail icon (clock-with-circle-arrow-back design) between Run Log History and Command Palette. Tooltip "Recent Chats". Same `.rail-btn` styling so it picks up themes / hover tooltips from v3.19.0.
- New modal `#recent-chats-modal`: header + description + scrollable list + Clear All footer. Same pattern as Run Log History modal (v3.14.0).
- List rendering shows: goal preview (max 200 chars), age (just now / 4 min ago / 2h ago / 3d ago), message count, "report" tag if a final report was captured, archived reason (panel-closed / finished / new-chat / unload), Restore + Delete buttons per row.

### Added — chat.js integration

- New Chat button: archives current chat before clearing (no more lost sessions on accidental click). Toast updated: "Chat cleared (archived to Recent Chats)".
- `report_update` `ready` handler: archives 250ms after the report card renders (lets the DOM settle) — captures the full post-run state.
- `visibilitychange` event (in recent-chats.js): archives when `document.visibilityState === 'hidden'`. Fires on side panel close, browser minimize, tab switch.
- `beforeunload` event (in recent-chats.js): belt-and-suspenders archive for hard closes.

### Bumped

- `manifest.json`: `3.23.0` → `3.24.0`.

### Files touched

- `popup-modules/recent-chats.js` — NEW, ~260 lines. Self-contained IIFE. Exposes `window.__sentinelRecentChats` API.
- `popup-modules/chat.js` — New Chat button now archives first; report_update ready triggers archive.
- `popup.html` — new rail button + modal markup, recent-chats.js script tag.

### Honest caveats

- Restored sessions are **display-only**. Buttons inside historical action cards / Approval cards / etc. won't dispatch — there's no live agent for them to talk to. The restoration shows what HAPPENED; it doesn't resume the agent.
- HTML snapshots can be ~10-100 KB per session. 10 sessions × 100 KB = 1 MB. chrome.storage.local quota is 5 MB total; v3.24.0 uses well under that even with run log history + other state.
- The chat container's innerHTML serialization captures event listeners as static markup — buttons in restored cards look real but are inert. Clear visual contract that "this is history, not live."
- "Pin a session" / "Star a chat" features are deferred to v3.25.0 — eviction at 10 is FIFO; if you want to keep a specific session, restore it (which pushes it back to position 1 of the list) or export the final report.


## v3.23.0 — 2026-05-12 (Movable + fit-to-viewport modals)

User report: opened Settings, the modal extended off the right edge of the Chrome side panel — couldn't see / reach the Detect Models button, API key field truncated, etc. Same root cause as the report-modal overflow we fixed in v3.20.2, but applied to every modal in the app.

### Fixed — Modals were being pushed off-screen by a stale CSS rule from v3.17.0

When the left action rail shipped in v3.17.0, I added `.modal { left: 50% !important }` thinking it would compensate for the body's 42px padding-left. That was wrong — combined with the existing `width: 100%`, it pushed the modal's LEFT EDGE to mid-viewport, so the modal extended from middle of the panel off the right side. Modals' `.modal-content` (the actual content box) sits inside the flexbox-centered .modal wrapper; the rail's body-padding doesn't affect `position: fixed` overlays at all. The override was unnecessary and harmful.

Removed. Modals now use the original `position: fixed; top: 0; left: 0; width: 100%; height: 100%; justify-content: center` pattern, which centers the modal-content correctly across the full viewport (the rail sits at z-index 50; modals at z-index 1000 — modals overlay the rail cleanly when open).

### Added — Responsive modal sizing (`popup.css`)

- `.modal-content` max-width now `min(640px, calc(100vw - 24px))` — caps at 640px for nice typography but shrinks to fit narrower side panels. The 24px leaves a small gutter against the panel edges.
- `.modal-content` max-height `calc(100vh - 60px)` — internal scroll on tall content; the drag bar + actions stay reachable.
- Inline `style="max-width:520px"` etc. on individual modals (template-modal, report-modal, etc.) get the same viewport cap via specificity-bumping selectors.

### Added — Draggable modals (`popup-modules/modal-drag.js`)

- Click + drag the title bar (the `<h2>` at the top of any `.modal-content`) to reposition the modal within the viewport. Works with mouse, trackpad, and touch via PointerEvent.
- Cursor shows `grab` on hover, `grabbing` during drag.
- A small `⠿` braille drag-handle indicator appears at the right edge of the title (subtle when idle, brightens on hover).
- Constrained to the viewport — at least 80px of the modal stays on-screen in every direction so you can never drag it fully off.
- Position resets to center on close. Each modal-open starts fresh (not persisted across opens — by design; if you regularly want a non-center position, that's a v3.24+ candidate).
- Title-bar inputs / buttons / selects keep `cursor: auto` and don't initiate drag — only clicks on the title text or the empty area trigger movement.
- MutationObserver watches for dynamically-added modals (run log history, template runner, etc.) so the wire-up survives lazy DOM construction.

### Bumped

- `manifest.json`: `3.22.0` → `3.23.0`.

### Files touched

- `popup.css` — removed the stale `left: 50% !important` rule; appended the responsive sizing + drag-state styles.
- `popup-modules/modal-drag.js` — new file, ~120 lines. Self-contained IIFE; no external dependencies.
- `popup.html` — added `<script src="popup-modules/modal-drag.js"></script>` before popup-full.js.

### Behavior after reload

Settings modal opens fully within the side panel (no more cut-off right side). Title bar has a `⠿` indicator on the right; click and drag it to move the modal around. Same for Theme Customizer, Templates, Run Log History, Mode Mismatch card, Client Knowledge — every modal that uses `.modal-content`.


## v3.22.0 — 2026-05-12 (MSP platform profiles — M365, FortiGate, IT Glue, Aruba, SonicWall on-box)

The platform-profile system shipped in v3.18.0 (SonicWall NSM only). v3.22.0 fills out the five platforms Brandon's MSP runs daily: M365 admin surfaces, FortiGate / FortiManager, IT Glue, Aruba (Central + Instant + OS-CX), and SonicWall on-box web admin.

Each profile injects ~15-30 `knownSelectors` + per-surface `pageTypes` + `waitStrings` into the agent's runtime system prompt whenever the agent lands on a matching URL. Reduces observe-and-flail loops; gives the LLM "try these first" hints before falling back to runtime DOM scanning.

### Added — Expanded M365 admin profile (`background/platforms/m365_admin.js`)

- 19 `pageTypes` covering: login wall, admin home / users / groups, entra home / users / sign-ins / conditional access, exchange home / mailflow / message trace / mailboxes, purview home / audit, defender home / incidents / advanced hunting (KQL), intune home, azure portal.
- 35+ `knownSelectors`: generic chrome (sidebar, search), admin users table, entra sign-ins table + filters, exchange message trace form (date / sender / recipient / run), purview audit search form, defender KQL editor, dialog OK/Cancel/Save patterns, primary-iframe selector for the many cross-origin embeds.
- 7 `waitStrings` groups: tenant-loaded, sign-in-logs-populated, message-trace-results, audit-search-results, save-succeeded, save-failed, session-expired.
- 5 `knownGotchas`: tenant lockdown, moved menus (Purview /audit/auditsearch NOT /auditlogsearch), separate Power Platform / Teams admin portals, heavy bundle load times, ag-grid virtual scrolling.

### Added — Expanded FortiGate profile (`background/platforms/fortigate.js`)

- 12 `pageTypes`: login, dashboard, policy, address objects, services, IPsec VPN, SSL VPN, users, log viewer, FortiManager ADOM/device/install-wizard.
- 30+ `knownSelectors`: chrome (sidebar, ADOM picker), login (username/password/submit), policy table + add/edit/source/dest/service/action/save, address objects (table/create/name/type/value), IPsec (table/rows/status/phase1/phase2 tabs), logs (category/time/source/table/apply/export), FortiManager (ADOM list, device table, install wizard with target checkboxes + Next/Install).
- 7 `waitStrings`: dashboard-loaded, policy-saved, commit-applied, tunnel-up, tunnel-down, login-required, session-expired.
- 6 `knownGotchas`: ADOM context affects all nav, log views need explicit filters, FortiOS 7 Vue SPA rendering delay, FortiManager async install (check Task Manager), virtual scrolling on Log viewer/Sessions.

### Added — IT Glue profile (`background/platforms/itglue.js`, NEW)

- 12 `pageTypes` covering: login, dashboard, orgs list, org overview, configurations, config detail, documents, passwords (sensitive), domains, SSL certs, flexible assets, search results.
- 40+ `knownSelectors`: Ember-style chrome, org picker, global search, orgs list (table/search/row), org sidebar nav (configurations/contacts/documents/domains/passwords/ssl/flexible-assets/locations), configurations (table/search/type-filter/status-filter/add), config detail (header/tabs/related-items/custom-fields), documents (table/search/editor/save), passwords (table/row/reveal-button/copy-button — flagged DO NOT CLICK), domains (registrar/expiration), SSL certs (subject/issuer/expiration/days-remaining), flexible assets.
- `needsTargetSelection: true` — auto-inserts Phase 0 to pick the right organization before per-org work.
- **Safety reinforced**: Passwords category selectors are flagged as DO-NOT-CLICK. The sensitive-field block in content/index.js still handles password-input typing, but this profile additionally instructs the LLM to record password metadata only (name, username, last_updated), never values.
- 6 `knownGotchas` including the Ember.js hash routing, password sensitivity, bidirectional asset relationships, global search scope filtering, Froala WYSIWYG editor.

### Added — Aruba profile (`background/platforms/aruba.js`, NEW)

- 13 `pageTypes` across THREE surfaces: Aruba Central cloud (login, dashboard, groups, devices, AP detail, switch detail, wireless, clients, alerts, reports), Aruba Instant on-IP (master/cluster), Aruba OS-CX on-IP (login, dashboard).
- 40+ `knownSelectors`: Central group/site picker, devices table + status filter, AP detail (clients/RF/firmware), switch detail (ports/VLANs), wireless (SSID list + edit + security), clients (filter by AP/SSID), alerts (severity + time range), Instant (nav: wireless/security/APs), OS-CX (nav: interfaces/VLANs/system, port table).
- 8 `waitStrings`: central-loaded, devices-populated, clients-populated, save-succeeded, save-failed, device-online, device-offline, session-expired.
- `needsTargetSelection: true` — auto-inserts Phase 0 to pick group/site on Central before device-specific work. Instant/OS-CX skip Phase 0 (URL itself selects the device).
- 6 `knownGotchas`: long-poll/websocket staleness, short OS-CX session timeout, Aruba Instant "unsupported browser" bypass on older firmware, sticky group/site selection causing wrong-data cascades, async location updates, group-scoped wireless changes pushing to all APs.

### Added — Expanded SonicWall on-box profile (`background/platforms/sonicwall_onbox.js`)

- 14 `pageTypes`: login, dashboard, network interfaces / zones, firewall rules / NAT, VPN settings / DHCP / status, users local / groups, log view, system status / licenses.
- 35+ `knownSelectors`: chrome (left-nav, top-bar, status-bar, page-content), login (username/password/submit), firewall rules (table/add/row/edit/source-zone/dest-zone/service/action/save), VPN (policy table + dialog tabs General/Client/Proposals + virtual adapter + IP pool + subnet mask + OK), users (table/search/row/edit + Groups + VPN Access tabs), logs (category/severity/time/table/apply/export), zones (table + Allow IKE/VPN checkboxes), licenses (GVC seat row).
- 7 `waitStrings`: dashboard, rules-table, vpn-policy-dialog, save-succeeded/failed, commit-required, session-expired.
- 6 `knownGotchas`: XHR rendering on right pane, firmware-version-renamed menus (detect via System > Status first), table-not-paginated dump strategy, commit Apply/Accept extra step, SonicOS 7.x hash routing, silent session expiry.

### Changed — `background/platforms/index.js` registry

- Added imports for `itglue` and `aruba` profiles.
- Profile order: sonicwallNsm → sonicwallOnbox → m365Admin → fortigate → itglue → aruba. Most-specific first.

### Bumped

- `manifest.json`: `3.21.1` → `3.22.0`.

### Honest caveats

- Selectors are best-effort against my training knowledge — they will need refinement based on real runs. Each profile uses defensive comma-separated alternatives so when one selector misses, an adjacent one in the same line usually catches.
- IT Glue's password Asset selectors include `passwordRevealButton` / `passwordCopyButton` so the LLM can SEE them in the element list and learn to AVOID them. The actual safety enforcement still relies on the v3.7.0 sensitive-field block.
- Aruba covers three surfaces in one profile because the cloud (Central) and on-IP (Instant/OS-CX) have different DOMs but the same MSP mental model. If the selectors get unwieldy I'll split.
- M365 admin tables in cross-origin iframes — the selectors in this profile won't reach data inside them. The agent's existing `read_network_requests` action (filtering for graph.microsoft.com / outlook.office.com) is the fallback path; this is called out in `liveDataCaveats`.

### How to add the next platform (e.g., ConnectWise, NinjaOne, Datto)

1. Create `background/platforms/<name>.js` with the standard profile shape (id, label, detect, pageTypes, knownSelectors, waitStrings, knownGotchas, rewriteInstructions).
2. Add import + register in `background/platforms/index.js` PROFILES array (most-specific first).
3. `node --check` both files. Reload extension. Done.

No agent-engine changes. No system-prompt rewrites. Profile data is injected into the runtime system prompt via `llm-client.js`'s `getPlatformContext` (wired in v3.18.0).


## v3.21.1 — 2026-05-12 (Hotfix: CSP-blocked execute_js + new csp-blocked recovery skill)

User caught running on SentinelOne (`usea1-pax8.sentinelone.net`): page console shows `Executing inline script violates the following Content Security Policy directive 'script-src 'self' ...'`. The agent's content-script execute_js path injects an inline `<script>` tag which strict-CSP sites block; the script silently never runs, the promise hits the 8s timeout, and the LLM saw a generic "Code execution timed out" with no clue the CSP was the cause.

CDP `Runtime.evaluate` bypasses page CSP and was supposed to be the primary path — but if the debugger banner has been dismissed mid-run, the agent falls back to the content-script path, hits the CSP wall, and there was no recovery signal.

### Fixed — CSP detection in content/index.js execute_js

- New `securitypolicyviolation` event listener registered before injecting the `<script>` element; cleaned up after. If a `script-src` violation fires in that window, the path returns `'CSP_BLOCKED: page denies inline scripts (Content-Security-Policy script-src). The content-script execute_js path cannot run here. Use read_page, read_network_requests, or extract / extract_list against the live DOM instead.'` instead of a generic timeout.
- The clear error string is pattern-matchable by the recovery-skills library.

### Added — `csp-blocked` recovery skill (`background/skills/csp-blocked.js`)

- Highest priority (95) so it fires before other failure skills.
- `matches(ctx)`: pattern-matches the `CSP_BLOCKED:` prefix.
- `autoApply(ctx)`: returns a `read_page` command. The LLM then sees the page contents via the standard observation path (no JS execution required) and can pick CSP-friendly alternatives.
- `promptInjection(ctx)`: comprehensive directive listing the 5 CSP-friendly alternatives (read_page, extract, extract_list, read_network_requests, read_console_messages) plus a CDP-debugger-banner note for users who dismissed it.
- Registered first in `background/skills/index.js` `SKILLS` array.

### Bumped

- `manifest.json`: `3.21.0` → `3.21.1`.

### Expected behavior on a re-run of the SentinelOne goal

When the agent emits an execute_js on a CSP-strict page and the content-script path is used (because CDP banner was dismissed, or CDP attach failed):

1. Content-script returns `CSP_BLOCKED: ...` instead of timing out at 8s.
2. The csp-blocked skill auto-applies `read_page` — saving the LLM round-trip.
3. The next LLM call sees the page text + element list AND the recovery directive listing alternatives.
4. The LLM picks `extract`, `extract_list`, or `read_network_requests` to get the data without inline scripts.

End-to-end: the agent now recovers from the SentinelOne CSP wall in ~2 steps instead of timing out repeatedly at 8s/step.

### Honest scope note

- The deeper fix is making sure CDP Runtime.evaluate always works (it bypasses CSP). v3.22.0 will add a "CDP availability check" at run start with a one-click "enable trusted input + reattach" banner if the user has dismissed it. For now, v3.21.1 makes the FALLBACK path's failure clear and recoverable.


## v3.21.0 — 2026-05-12 (Recovery Skill Library — first pass at self-healing)

The first concrete answer to "make this self-healing": a library of small modules that detect specific failure patterns and either auto-apply a deterministic recovery command (skipping the LLM round-trip entirely) or inject targeted directives into the LLM's next prompt.

Each skill is independently testable, individually disable-able, and the library is designed to grow as new failure patterns surface in real runs.

### Added — Skills framework (`background/skills/index.js`)

- New `runRecoverySkills(context)` consultation API. Returns `{autoApply, promptInjection, appliedSkillIds}`.
- Context shape: `{lastCommand, lastResult, lastActionFailed, history, consecutiveFailures, agentMemory, stepCount, dynamicMaxSteps, currentUrl, allElements, pageText, lastAiCallMs, consecutiveNavigates, productiveSteps}`.
- Each skill exports `{id, description, priority, matches(ctx), autoApply(ctx), promptInjection(ctx)}`.
- Priority ordering: higher fires first for autoApply. All matching skills contribute their promptInjection.
- Defensive error handling: a skill that throws is skipped, not crashing the loop.

### Added — Seven starter skills (`background/skills/*.js`)

| ID | Fires when | Auto-applies | Prompt injection |
|---|---|---|---|
| `click-no-target` | `click`/`type`/`hover` had no selector/ref/coords (v3.20.1 guard) | `read_page` — fresh observation | Teaches selector/ref selection from element list |
| `navigate-loop` | Same URL navigated twice in a row (v3.20.1 guard) | `read_page` — page is already loaded | Teaches in-page interaction over re-navigation |
| `selector-miss` | "Element not found" / "no element" / "not in element list" | `read_page` — DOM may have changed | Teaches ref over selector, scroll/wait alternatives |
| `unproductive-extract` | Extract/JS returned null/empty/non-serializable | — (LLM choice) | Body-text regex, network capture, visible-text harvest patterns |
| `empty-observation` | Observation returned < 5 elements + < 200 chars | `wait_for_navigation` (only if last was navigate) | Wait / JS-inspect / try different URL / honest finish |
| `consecutive-failures` | 3+ consecutive failures | — | Force strategy shift; honest finish if budget tight |
| `slow-llm-call` | Most recent LLM call took > 25s | — | Token-bloat hints; focused next action guidance |

### Wired — Agent loop consultation (`background/agent-engine.js`)

- New module-level `_lastAiCallMs` tracks the most recent LLM call's duration (used by `slow-llm-call` skill). Reset in `resetAgentState`.
- Skills consult fires BEFORE the LLM prompt is built so an auto-applied command can short-circuit the entire round-trip. When a skill auto-applies:
  - `progressTimer` cleared
  - `base64Image` freed
  - `command` set directly from the skill's return value
  - `activityDone(consult-ai, 'Skipped (skill auto-applied)')` fires
  - The dispatch proceeds with the recovery command
- When skills only contribute prompt injections (no auto-apply), the directives are appended to `loopDirective` under a `## ⚙ RECOVERY DIRECTIVES (Sentinel skill library)` section so the LLM treats them as engine-level guidance, not user goal text.
- Forensic run log captures every skills consultation: `{step, kind: 'recovery_skills_consulted', skill_ids, auto_applied, auto_apply_type}`.
- Activity stream surfaces a `recovery-skills` item showing which skills fired.

### Bumped

- `manifest.json`: `3.20.2` → `3.21.0`.

### Expected impact on real runs

The user's recent failure modes — Click: undefined cascades, navigate loops, unproductive extracts — were all visible-but-not-actioned. Now:

- A `click-no-target` failure triggers an auto-applied `read_page`, the LLM sees the fresh observation next step, and recovers in 1 wasted step instead of 3-5.
- A `selector-miss` failure auto-recovers similarly.
- 3 consecutive failures (any cause) now inject a "STEP BACK and pick a fundamentally different approach" directive, with concrete alternatives. Slows the flail.
- Slow LLM calls get an explicit "trim your prompts" hint to the LLM itself.

Not a magic wand — the agent can still fail. But each failure now has a defined recovery path instead of "agent stares at the wall waiting for the LLM to figure it out."

### Adding new skills

When a new failure pattern surfaces in a real run, the recipe is:
1. Create `background/skills/<my-skill>.js` exporting the skill object.
2. Import in `background/skills/index.js` and add to the `SKILLS` array.
3. Run `node --check` on both files. Reload extension. Done.

No agent-engine changes. No system-prompt rewrites. No version bump required for skill-only additions.

### Honest scope notes

- Auto-apply commands are conservative — only `read_page` and `wait_for_navigation` are dispatched without LLM consultation in this release. More ambitious auto-applies (e.g., constructing an `execute_js` from a template) deferred until the basic skills prove out.
- Skills don't yet save their own state across runs. v3.22.0 candidate: per-skill outcome tracking so the engine can learn which recoveries work best for which sites.
- The `slow-llm-call` skill is purely informational — it can't make the provider faster. The token-budget caps in v3.20.0 are the actual mitigation.


## v3.20.2 — 2026-05-12 (Report pops out as full browser tab)

User report: the in-panel report modal overflowed the narrow Chrome side panel (560px max-width crammed into a ~400px viewport) AND covered the chat. v3.20.2 detaches the full report into its own browser tab so the side panel stays uncovered and the report gets the full window width to breathe.

### Added — `report-view.html` (full-tab reading view)

- New 320-line standalone HTML file. Reading-optimized typography (14px body, 1.65 line-height, 980px max-width column). Dark mode default + light-mode toggle (respects the same `theme-preference` storage key as the popup).
- Sticky toolbar with: brand, generation timestamp, **Copy Markdown**, **Download .md**, **Print / PDF**, **Theme** buttons.
- Reads the report from `chrome.storage.local._pendingViewReport` (set by the popup on click) with fallbacks to `_pendingPrintReport` and `last_agent_report` so the user can re-open even after a popup restart.
- Source-citation chips (`[src:key]`, `[unverified]`) render inline with tooltips.
- Print button uses the browser's native print → "Save as PDF" path, replacing the prior dedicated `report-print.html` flow for the View pane (the print file still exists for the explicit PDF Export button).

### Changed — `openReportModal` in `chat.js` now opens a tab

- Old behavior: rendered into `#report-modal` in the side panel. Overflowed at narrow widths, covered chat.
- New behavior: stash the report payload in `_pendingViewReport`, open `report-view.html` in a new browser tab via `chrome.tabs.create`. Side panel stays untouched; the activity stream, chat history, and rail all remain visible.
- The legacy modal path is preserved as `openReportModalInline(markdown)` and used as a fallback if `chrome.tabs.create` throws (e.g., headless contexts). Not wired by default.

### Bumped

- `manifest.json`: `3.20.1` → `3.20.2`.

### Compat notes

- The modal markup (`<div id="report-modal">`) stays in `popup.html` for the inline fallback. The HTML can be removed in v3.21+ once the tab path proves stable.
- All existing report storage keys (`last_agent_report`, `_pendingPrintReport`) untouched.
- PDF Export button still goes through `report-print.html` (auto-prints on load). View Full Report goes through `report-view.html` (no auto-print).
- `report-view.html` lives at the package root so `chrome.runtime.getURL('report-view.html')` resolves correctly.


## v3.20.1 — 2026-05-12 (Hotfix: "Click: undefined" + navigate-loop guard)

Two patterns caught on a SentinelOne console run where the agent flailed for 6 steps with `Click: undefined` showing in chat and repeated navigates to the same URL.

### Fixed — `describeAction` shows "undefined" when click/type/etc. has no selector

- Old behavior: `describeAction({type:'click', ref:'ref_5'})` returned `"Click: undefined"` because it only read `command.selector`. User saw "Click: undefined" in the activity stream with no idea what was being attempted.
- New `_describeTarget(cmd)` helper falls back to `ref` → `(x,y)` coordinates → `command.label` → `"(no target)"`. Used by all 20+ action types in `describeAction`. The activity stream now always shows a meaningful target.
- Bonus: `describeAction` was missing cases for `click_at`, `scroll_to`, `check`, `check_all`, `extract_list`, `open_tab`, `switch_tab`, `close_tab`, `note`, `finish`, all four `wait_for_*` variants, `read_page`, and `dismiss_overlay`. They all fell through to the generic `JSON.stringify` default. Now every action type has a tailored label.

### Added — Fail-fast guard for targetable actions with no target

- Before dispatch, if a `click` / `type` / `hover` / `select` / `check` / `extract` / `scroll_to` / `wait_for_element` command has NO `selector`, NO `ref`, AND NO `x`+`y`, block immediately with a clear error message back to the LLM: `"BLOCKED: <type> command has no target — supply at least one of selector, ref, or x/y coords."`
- Wastes 1 step instead of 2-3 (dispatch + content-script timeout + failed result). Plus tells the LLM exactly what's wrong so it can recover. Previously the LLM just got an "Element not found" back and often re-emitted the same broken command.
- Logged to the activity stream as a `failed` dispatch item so the user sees what went wrong.

### Added — Navigate-loop guard (`background/agent-engine.js`)

- If the agent emits a `navigate` to the exact same URL as the previous step's navigate, block with: `"BLOCKED: already navigated to <url> in the last step. Do NOT navigate to the same URL twice. Instead: read_page, execute_js to inspect the DOM, or click an in-page nav element to drill deeper."`
- Mirrors the existing read_page loop guard. The SentinelOne run had Step 2 → /policy and Step 5 → /policy both navigating to the same URL — wasted 30+s of LLM time and didn't make progress.

### Bumped

- `manifest.json`: `3.20.0` → `3.20.1`.

### Still to investigate (not blocking the hotfix)

- **1m 33s LLM call on step 5.** Almost certainly retries — `CONFIG.fetchTimeout` is 45s and `callLLMWithRetry` retries on transient errors, so 2 retries × 45s = 90s. Either the provider was rate-limiting or returning 5xx. Worth surfacing retry attempts in the activity stream so the user knows what's happening; deferred to v3.21.0.
- **No SentinelOne profile.** Adding one (Exclusions / Policy Engine / Path Exclusions selectors) would prevent SentinelOne flail going forward. v3.21.0 candidate.


## v3.20.0 — 2026-05-12 (Token budget audit + multi-article pattern + activity content preview)

Three fixes addressing patterns from last night's Drudge Report top-10 run: AI calls taking 11-36s per step, agent burning 30 steps for 10 articles, note actions not showing content in the activity stream.

### Fixed — Token budget bloat from large result fields (`background/agent-engine.js`)

- The `promptHistory` mapper sliced history to the last 5 entries but did NOT cap the `result` field per entry. When the agent extracted an article body (7000+ chars) or pasted log dumps, that text rode along in every subsequent step's prompt — easily 4-5K tokens of dead weight per call.
- New caps:
  - `result` field: max 800 chars per entry, with `"… [truncated; N more chars in memory]"` suffix.
  - `action.text` in past entries: max 200 chars (typed input doesn't need full text in history).
  - `action.code` in past entries: max 300 chars (JS source doesn't need to ride along forever).
- The CURRENT step's full command still goes through unmodified — caps only apply to past history. Memory retains the full data; only the prompt-side echo is trimmed.
- Expected impact: per-step prompt size drops by ~3-5K tokens on extraction-heavy runs. LLM call time should fall from 11-36s back into the 3-8s range on Claude Haiku.

### Added — Activity stream content preview for note/extract/execute_js (`background/agent-engine.js`)

- Note handler now emits an `activityDone(stepCount, 'note-content', 'Noted: "<preview>"')` after recording the note. User sees the actual note text (up to 140 chars) in the activity stream instead of just "Recording a note".
- Extract handler emits `'Extracted "key" → preview'` showing what was captured.
- execute_js with key emits `'Saved "key" → N items captured'` or a value preview.
- All three pipe through the existing `agent_activity` channel — no new message types, no popup changes needed.
- Companion to v3.19.1's "Preparing…" fix: now you can see BOTH what action was decided AND what content came back.

### Added — Multi-article research directive (`background/llm-client.js`)

- New `getMultiArticleDirective(goal)` detects goals with patterns like "top 10 articles", "full breakdown on each", "summary of N items", "first 5 stories", etc. Returns a system-prompt addition (~75 lines) teaching:
  - **Phase A:** ONE `execute_js` to extract all article URLs in one shot.
  - **Phase B:** Batch open_tab in groups of 3-5 (parallel browser tabs).
  - **Phase C:** Loop read_page → note WITHOUT close_tab in between. 2 steps per article instead of 3.
  - **Phase D:** Skip explicit close_tab — finish handler closes all agent tabs automatically.
- Step-budget math: ~2 + 2N steps for N articles (was ~3N + extraction overhead).
- Honest scope-setting included: when budget is tight, prioritize thorough breakdowns of the top 3-5 + headline-only for the rest. Mark "[headline only — not read]" so the user knows the cutoff.
- Cross-origin caveat included: aggregator pages (Drudge, Hacker News) can't fetch() their linked articles due to CORS, so batch open_tab is still the right pattern there.
- Wired into both prompt builders alongside the existing `getMultiPortalDirective`. Same gating pattern: only fires when the regex matches.

### Bumped

- `manifest.json`: `3.19.1` → `3.20.0`.

### Compat notes

- All caps and directives are additive. History truncation only affects what's SENT to the LLM each step; the full history remains in memory for the forensic run log and the final report.
- The multi-article directive's regex is conservative — it only fires on explicit "top N articles" / "full breakdown on each" patterns. Goals like "what's on Drudge today" won't trigger it (the agent's existing planning handles those fine).
- No new storage keys, no new message types, no UI changes.

### Still to do (v3.21.0+ candidates)

- **`background_fetch` action** — cross-origin article body grab via background script. Would collapse Phase B-C of multi-article research from N steps into 1.
- **Report-generator error-path tightening** — root-cause fix for the `addReportCard(undefined)` crash that v3.19.1 patched with a defensive guard.
- **History summarization at trim time** — for runs that exceed 30 history entries, the rollup helper exists but doesn't always fire. Audit + tighten.


## v3.19.1 — 2026-05-12 (Hotfix: addReportCard crash + "Preparing…" stuck label)

Two bugs caught from the user's Drudge Report top-10 articles run.

### Fixed — `TypeError: Cannot read properties of undefined (reading 'summary')` in `addReportCard`

- Stack trace pointed at `popup-modules/chat.js:1393` inside `addReportCard`. Reading `report.summary` crashed when `report` was undefined.
- Added a defensive guard at the top of `addReportCard`: if the argument is missing or not an object, surface a non-blocking toast and bail. Doesn't crash the popup or block the activity stream.
- Root cause is likely a race between `agent_finished` and `report_update` — when the report-generator times out, the listener might receive a malformed update. Defensive guard fixes the symptom; v3.20.0 will tighten the report generator's error path.

### Fixed — Step card stuck at "Preparing…" for internal actions

- Steps that dispatched `note`, `extract`, `extract_list`, `read_page`, `finish`, `wait_for_text`, `wait_for_element`, `wait_for_navigation`, `dismiss_overlay`, or `scroll` left the step card headline at the placeholder "Preparing…" forever. Cause: those handlers don't call `sendActionMessage` (no agent_action message), so `updateStepCardAction` never fires.
- Fix in `showAgentActivity`: when the `consult-ai` activity item finalizes with status `done` and a label like `"AI decided: note"`, AND the step headline is still the placeholder, parse the action type from the label and set a human-readable headline. Mapping: `note` → "Recording a note", `extract` → "Extracting data", `extract_list` → "Extracting list", `read_page` → "Reading the page", `finish` → "Finishing the run", `wait_for_*` → "Waiting for ...", `dismiss_overlay` → "Dismissing overlay", `scroll` → "Scrolling". Unknown types get title-cased.
- Single-point fix in `popup-modules/chat.js`; no agent-engine changes. Works retroactively for all internal action types without needing per-handler instrumentation.

### Bumped

- `manifest.json`: `3.19.0` → `3.19.1`.

### Observed in the same run (not yet fixed — v3.20.0 candidates)

- AI consultation taking 11-36s per step on a 7000-character page. Likely prompt-size bloat from history accumulation + page content + system prompt overhead. Needs a token-budget audit.
- Multi-article research pattern (open_tab → note → close_tab × N) is inefficient. 30 steps needed for 10 articles on a 20-step budget. Better pattern: parallel `execute_js` with `fetch()` to grab article bodies in fewer steps. Needs system-prompt teaching addition.
- Note actions don't persist content effectively to memory — the LLM emits a note but the activity stream doesn't show what was noted. Investigation needed.


## v3.19.0 — 2026-05-12 (UI polish — tooltips, density, welcome grid, panel highlight)

Follow-up polish on the v3.17.0 left-rail redesign. Refinements only — no behavior changes.

### Added — Custom rail tooltips (`popup.css`)

- Native `title=""` tooltips replaced with CSS `::after` pseudo-elements that pull text from the `title` attribute and slide in to the right of the icon on hover.
- 120ms ease-out transition with a 6px slide. Theme-aware via `--bg-tertiary` / `--text-primary` / `--border-color` vars — Tron / Matrix / Cyberpunk presets all style them correctly.
- Native tooltips were slow (varies by OS, 1-2s delay on Windows), inconsistent, and got truncated by the side panel. CSS tooltips appear instantly and stay readable.

### Changed — Header density

- Vertical padding tightened: 8px top/bottom (was ~14px). Min-height 38px.
- Wordmark size up to 14px with 600 weight + 0.5px letter-spacing — more presence now that there's room.
- Logo bumped from 18px to 22px.
- Header-title gap reduced to 10px for cleaner spacing.
- Mode badge / tenant chip / client chip: tighter padding (2px×8px) and 10px font — same readability, less footprint.

### Changed — Toolbar slimming

- Toolbar padding 6px top/bottom (was ~10px).
- Search box input 12px font, 4×8 padding.
- Toolbar icon buttons 26×26 (was ~32×32) with 4px padding.
- Divider shorter (16px height) with tighter horizontal margins.

### Changed — Welcome message refresh

- Example prompt buttons now render as a CSS Grid (1-column on narrow side panels, 2-column at ≥480px width). Was a single vertical stack — felt sparse.
- Hover state: tertiary background + accent-color border so users see the buttons are interactive.
- Active state: 0.98 scale press animation.
- Welcome heading: 18px (was 22px), tighter intro paragraph.

### Changed — Active-tab strip refinement

- Padding 6px top/bottom (was ~10px). Min-height 36px. Still positioned 42px from left (past the rail) per v3.17.0.

### Changed — Rail panel-active highlight

- `#action-rail .rail-btn.active` now triggers the orange-accent active state (matches the existing `.rail-btn-active` class). Existing toggle code in `templates.js` and `scheduler-ui.js` that adds `.active` to those buttons now visually highlights them in the rail when their panel is open — no JS changes needed.

### Added — Narrow side panel responsive tweaks

- At widths <420px, tenant chip and client chip text truncate with ellipsis instead of wrapping.

### Bumped

- `manifest.json`: `3.18.0` → `3.19.0`.

### Compat notes

- All CSS changes are additive or specificity-bumping. No existing styles removed; all v3.17.0 / v3.18.0 work intact.
- No JS changes. No new IDs, no new event handlers.
- All existing themes (Tron, Matrix, Cyberpunk, Neon, Terminal, Blood, Sunset, Ocean, Midnight, Paper, Forest, Mono) pick up the new tooltips and density via CSS vars.


## v3.18.0 — 2026-05-12 (Per-platform selector profiles for SonicWall NSM 7.x)

The agent now ships with structured DOM selector hints for SonicOS 7.x running under NSM 7.x. Instead of discovering the IPSec VPN policy table, Client tab, Virtual Adapter dropdown, IP pool inputs, and Commit button via runtime scan-and-flail loops, the LLM gets a preferred-selectors list at the top of every step's prompt. Same defensive fallbacks still work — these are hints, not hard requirements.

This is REVAMP item #20. It's the change that would have made the SonicWall NSM VPN runs from earlier tonight actually succeed.

### Added — Full selector profile (`background/platforms/sonicwall_nsm.js`)

- **`pageTypes`** — 7 URL-pattern classifiers that tell the LLM what surface it's on: `nsm-home`, `firewall-list`, `device-console`, `device-vpn-base`, `device-users`, `device-logs`, `policy-edit`. Each comes with a `hint` describing what's available at that level.
- **`knownSelectors`** — 30+ entries covering the NSM workflow end-to-end:
  - Firewall list table, row, search input, drill-into-firewall anchor.
  - Per-device left nav: VPN / Users / Logs / Firewall / Network / Settings.
  - VPN policies table, row, name cell, edit pencil.
  - VPN policy edit dialog: container, tab strip, tab buttons, with text-match candidates for the Client / General / Network / Proposals / Advanced tabs.
  - Client tab: Virtual Adapter dropdown + option text candidates (`None` / `DHCP Lease` / `Internal DHCP Server` / `External DHCP Server`).
  - IP Address Pool: Start IP, End IP, Subnet Mask, DNS Server 1/2 inputs.
  - Dialog buttons: OK / Cancel / Apply.
  - NSM commit toolbar: pending-changes indicator + commit button.
  - Users > Local Users: table, search, row, edit icon, Groups / VPN Access tabs.
  - Logs / Reporting: category filter, time range picker, table, apply-filters button.
  - Onboarding overlay + dismiss button (catches the welcome-tour overlay that caused step-1 flailing in earlier runs).

  Each selector is written as a defensive comma-separated alternatives list (e.g. `'input[name*="startIp" i], input[placeholder*="Start IP" i], input[aria-label*="Start IP" i]'`) so the content script's resolver can pick whichever matches the actual NSM build the user is on.

- **`waitStrings`** — 7 wait-text signal groups for use with `wait_for_text`: `deviceConsoleLoaded`, `policyDialogOpened`, `policyDialogClientTab`, `saveSucceeded`, `saveFailed`, `commitPending`, `sessionExpired`. Each is an array of phrases the LLM can wait for after a navigation/click.

### Added — Selector-block injection into runtime system prompt (`background/llm-client.js`)

- Renamed the existing public `getPlatformContext` body to `_getPlatformProseInternal` (private). Existing prose for SonicWall, FortiGate, Cisco, etc. is unchanged.
- New `_formatProfileSelectorsBlock(profile, currentUrl)` formats the structured profile data (pageTypes detection, knownSelectors, waitStrings, knownGotchas) as a prose section the LLM can reason over.
- New public `getPlatformContext(currentUrl, goal)` wrapper calls both and concatenates. Existing call sites in agent-engine.js and llm-client.js itself need NO changes — same return shape.
- Selector hints appear under a `━━━ PLATFORM SELECTOR PROFILE ━━━` divider so the LLM can clearly see "use these first" as a separate instruction from the hardcoded prose advice.
- Page-type detection runs the current URL through `pageTypes[].urlMatch` regexes; the matching type's `hint` appears at the top of the block. The LLM knows what surface it's on without having to infer from the URL alone.

### Bumped

- `manifest.json`: `3.17.0` → `3.18.0`.

### Compat notes

- All other platforms (Fortinet, Cisco, Microsoft 365 surfaces, Sentinel/CrowdStrike, etc.) still use the hardcoded prose in `_getPlatformProseInternal` and will until their profile entries are filled out. Adding `knownSelectors` to `m365_admin.js`, `fortigate.js`, etc. is a v3.18.1+ task.
- Function-valued selectors (e.g. `policyDialogTab: (name) => ...`) are emitted to the LLM as `"(parameterized — pass label or text to resolve)"` rather than dumping source. Future versions can teach the content script to call these.
- Profile data is not user-editable yet. v3.18.1+ may add a settings panel for per-tenant overrides (e.g., MSP A's SonicWall has a custom skin with non-default selectors).

### Expected impact on a SonicWall NSM 7.x run

Compared to tonight's 14-step thrash run:

- Step 1: agent sees `pageTypes` classifier match → recognizes `firewall-list` → uses `drillIntoFirewall` selector to click the right row in one shot instead of clicking a header/wrong cell.
- Step 2-3: per-device console loaded → `deviceNavVpn` selector finds the VPN nav directly → opens VPN base settings.
- Step 4: `vpnPolicyRow` + `vpnPolicyNameCell` selectors find row 5 "WAN GroupVPN" → click opens edit dialog.
- Step 5: `policyDialogTab` + `policyTabClientText` finds the Client tab.
- Step 6-8: `virtualAdapterDropdown` + `virtualAdapterOptions` selects "DHCP Lease" (the actual SonicOS 7.x label — not "Internal DHCP Server" as in the user's prompt).
- Step 9-11: `ipPoolStartIp` / `ipPoolEndIp` / `ipPoolSubnetMask` fields auto-targeted.
- Step 12: `dialogOkButton` clicks save.
- Step 13: `commitPendingButton` pushes the change. `waitStrings.saveSucceeded` confirms.

Same goal, ~13 productive steps instead of 14+ wasted on flail. Selectors are best-effort against published SonicWall docs and DOM conventions — first real run on a live NSM 7.x box will tell us which ones need tightening.


## v3.17.0 — 2026-05-12 (Left-edge action rail — UI redesign)

User feedback: "I'm having to expand to see all the buttons too far, maybe we should add the button small and to the left part of the sidebar."

The header was carrying too much weight — wordmark, mode badge, tenant chip, client chip, active indicator, AND six icon buttons (New Chat, Theme, Command Palette, Templates, Schedules, Settings). On the default Chrome side panel width (~370px), the buttons got pushed off-screen. v3.17.0 introduces a vertical action rail on the left edge so all controls are reachable at any sidebar width.

### Added — Left action rail (`popup.html`)

- New `<nav id="action-rail">` element fixed to the left edge, 42px wide, full height.
- Buttons (in order): New Chat → Templates → Schedules → **Run Log History** (new from this rail) → Command Palette → Settings → (spacer) → Theme Toggle pinned at bottom.
- Each button keeps its original DOM id (`newChatBtn`, `templatesBtn`, `schedulerBtn`, `commandPaletteBtn`, `settingsBtn`, `themeToggle`) so all existing JS event handlers in chat.js, settings.js, templates.js, scheduler-ui.js continue working without modification.
- New rail-only button: `runLogHistoryRailBtn` wired to the existing `openRunLogHistoryModal` function (previously reachable only via the command palette or the post-run banner).

### Changed — Header simplification

- `.header-buttons` div is now empty (CSS hides empty header-buttons via `:empty { display: none }` so it doesn't reserve space).
- Header keeps: wordmark, mode badge, tenant chip, client chip, active indicator. Plenty of room even on narrow side panels.

### Added — Rail styling (`popup.css`)

- `#action-rail` flex column, theme-aware via existing CSS vars.
- `.rail-btn` 32x32, transparent background, hover state with border + bg shift, active state (scale 0.94), focus-visible outline using accent color.
- `.rail-btn-active` class for "this panel is currently open" state (orange accent, ready to wire from templates.js / scheduler-ui.js).
- `.rail-divider` thin separator between functional groups.
- `.rail-spacer` flex:1 pushes the theme toggle to the bottom.
- `body { padding-left: 42px }` shifts all in-flow content right of the rail.
- `.active-tab-strip { left: 42px !important }` repositions the absolutely-positioned top strip past the rail.
- `.left-edge-accent { display: none !important }` hides the old decorative 4px bar (redundant with the rail's right border).

### Bumped

- `manifest.json`: `3.16.0` → `3.17.0` (minor — visible UX change, no breaking behavior).

### Compat notes

- Modals (Settings, Templates, Run Log History, etc.) sit above the rail with their own z-index. No interaction issues.
- Command palette is a full-screen overlay; still works.
- All existing handlers, message routes, and storage keys unchanged.
- Theme presets (Tron, Matrix, Cyberpunk, etc.) automatically style the rail because it uses CSS variables.


## v3.16.0 — 2026-05-12 (Live Activity Indicator — Claude-in-Chrome-style per-step checklist)

User feedback: "I wish I had the ability to see what it's doing when it sits there, I don't know if it's stuck, thinking, or what." Followed by: "I like the way Claude in Chrome does it too, where it shows it's activity and clicking here, doing that kinda thing for each step."

v3.16.0 ships exactly that. Each step now shows a streamed checklist of micro-actions with spinner / checkmark / failed icons and per-item durations — so you can see the agent observing, consulting AI, and dispatching actions in real time instead of staring at a frozen status bar.

### Added — Activity protocol (`background/message-protocol.js`)

- `sendAgentStepStart(stepNumber, totalPlannedSteps)` — fired BEFORE observation/AI consultation. Popup creates the step card + empty activity stream container immediately so the user sees something appear the instant a step begins.
- `sendAgentActivity(stepNumber, key, label, status, detail)` — granular per-sub-action emit. `key` is a stable identifier within the step (`observe`, `consult-ai`, `dispatch`, etc.) so the popup upserts by key as status transitions in_progress → done / failed.

### Added — Activity helpers (`background/agent-engine.js`)

- `activityStart(stepNumber, key, label)` — marks an item in_progress, auto-records the start time for duration calc.
- `activityDone(stepNumber, key, label, detail)` — marks done; computes duration from the recorded start time.
- `activityFail(stepNumber, key, label, detail)` — marks failed; computes duration.
- `activityUpdate(stepNumber, key, label)` — keep status in_progress but refresh the label (used for the elapsed-seconds counter on long LLM calls).
- Module-level `_activityStartedAt: Map<key, ts>` tracks in-flight items so durations are accurate.

### Hooked — runAgentLoop instrumentation

- **Step start:** `sendAgentStepStart()` fires immediately after `stepCount++` so the step card materializes before any work.
- **Observation:** `activityStart('observe', 'Observing page')` → on success: `'Observed N elements, M chars of text'` with duration; on error: `failed` with the error message.
- **AI consultation:** `activityStart('consult-ai', 'Consulting AI · call #N')`, then the existing 5-second progress timer also calls `activityUpdate()` so the label updates to `'Consulting AI · 15s elapsed'`. Finalizes with the LLM's chosen action type (`'AI decided: click'`) or the failure reason.
- **Action dispatch:** `activityStart('dispatch', describeAction(command))` when the action is about to dispatch; finalizes via `activityDone`/`activityFail` after `sendActionResult` with a result-preview snippet.

### Added — Activity stream UI (`popup-modules/chat.js`)

- `_ensureActivityStream(stepNumber)` creates or reuses the per-step card + stream container. Works whether the card was created by `addActionCard` (action arrived first) or by `agent_step_start` (step started before any action).
- `showAgentActivity(stepNumber, key, label, status, detail)` upserts items by key. Each item renders: SVG status icon (spinner / checkmark / X / pending circle) + label + duration suffix.
- `updateStepCardAction(stepNumber, description)` wired into the `agent_action` handler so the step card's headline syncs with the action description.
- `clearActivityState()` called on `agent_finished` so state doesn't leak across runs.

### Added — CSS (`popup.css`)

- `@keyframes sentinelSpin` + `.activity-spinner` for the in-progress animation.
- `.activity-stream` flex column layout, `.activity-item` with status-driven opacity transitions.
- `.activity-step-card` styling for the per-step header (label + action description on one line).

### Bumped

- `manifest.json`: `3.15.2` → `3.16.0` (minor — new user-visible feature, no breaking changes).

### What you'll see

Run the agent on any goal. Each step's card now looks like:

```
STEP 3   Click "Save" button
  ✓ Observing page · 0.4s
  ✓ AI decided: click · 8.2s
  ⟳ Click "Save" button   (spinning, in progress)
```

When the dispatch finishes, the spinner becomes a checkmark with a duration. When AI is taking a long time, the label updates with elapsed seconds so you know it's still working. When something fails, you get an X with the error in the label.

### Honest scope notes

- Heartbeat pulse dot, stuck detection with auto-cancel UI, and forensic-log capture of phase transitions are deferred to v3.16.1. The activity stream alone closes most of the "is it stuck or thinking" gap.
- Only the main dispatch path (line ~3442 of agent-engine.js) and the AI consult phase are instrumented for completion events. Early-return paths (open_tab, switch_tab, close_tab) start the dispatch item but don't currently finalize it — they'll show as in-progress until the next step start clears the visual. Will tighten in v3.16.1.
- The Active Tab Strip at the top still shows the most-recent action, not the live activity item. Two-cursor problem — both are useful; I'll unify in v3.16.1.


## v3.15.2 — 2026-05-12 (Mode-directive mismatch detector)

User scenario: pasted a goal for a live SonicWall config change that said `Mode: APPROVAL — agent pauses for technician approval before each click/type that modifies system state` — but the Approval Mode toggle in Settings was still OFF (AUTONOMOUS). The agent was about to click Apply on a production WAN GroupVPN policy without ever pausing. The goal text was just prose; the actual gating is driven by `chrome.storage.local.approvalMode`. v3.15.2 catches this mismatch BEFORE the run starts.

### Added — Goal mode-directive detector (`background/agent-engine.js`)

- New `_detectGoalModeDirective(goal)` four-tier regex:
  1. Explicit `Mode: APPROVAL` / `Mode: AUTONOMOUS` / `Mode: YOLO` (high confidence)
  2. `"approval mode"` / `"autonomous mode"` phrasing (high confidence)
  3. `"agent pauses for approval"` / `"PAUSE and wait for technician approval"` / similar (medium confidence)
  4. `"no approvals required"` / `"execute autonomously"` (medium confidence, autonomous direction)
- Returns `{detected, wants: 'approval'|'autonomous', evidence, confidence}` or `{detected: false}`.

### Added — Pause flow before adaptive-prompts (`startAgent`)

- New block at the top of `startAgent`, runs BEFORE the adaptive-prompts LLM call (so a cancelled run doesn't burn a rewriter call). Reads `chrome.storage.local.approvalMode`, compares against the detected directive, and:
  - Match → proceed silently.
  - Mismatch → broadcast `mode_mismatch_pause` to popup, wait for user decision via `_waitForModeMismatchDecision()` (SW keepalive-wrapped, 5-min cap, **default action on timeout: CANCEL the run**).
- Forensic run log captures two entries per mismatched run: `mode_mismatch_detected` (the gap) and `mode_mismatch_decision` (what the user chose).

### Added — Mode mismatch card (`popup-modules/chat.js`)

- New `showModeMismatchCard(payload)`. Three buttons:
  - **Flip to ＜MODE＞ & continue** — writes `approvalMode` from the popup side, syncs the toggle checkbox + mode badge UI via existing `updateApprovalModeUI()`, sends `{flip: true}` back to background.
  - **Continue as ＜CURRENT＞** — proceeds without changing the toggle. Sends `{continue: true}`.
  - **Cancel run** — stops the agent before any work. Sends `{cancel: true}`.
- Visual emphasis: when the goal asks for APPROVAL but actual is AUTONOMOUS (more dangerous direction), the card border is red. The other direction (goal autonomous, actual approval) is orange.
- Wired to `mode_mismatch_pause` message in the existing background-message listener.

### Bumped

- `manifest.json`: `3.15.1` → `3.15.2`.

### Why this isn't a simple "auto-flip" feature

I considered just having the rewriter detect the directive and silently flip the toggle, but that would mask real configuration drift between user intent and stored settings. Explicit pause + decision keeps the user in control and produces a forensic-log trail of what was changed and why.


## v3.15.1 — 2026-05-12 (Hotfix: history-scope ReferenceError, latent since v3.13.0)

User-reported runtime error: `Loop error: history is not defined`, thrown from the agent loop after step 2's scroll on dash.cloudflare.com.

### Root cause

When v3.13.0 extracted `trimHistory()` and `persistHistory()` from ~47 inline occurrences, the helpers were placed at MODULE scope (lines 166–175 of `background/agent-engine.js`) but continued to reference `history` as a free variable. `history` itself was declared as `let history = [];` INSIDE `runAgentLoop` (line 1780).

JavaScript lexical scoping rules mean a function defined at module scope cannot reach into another function's local scope. The helpers were looking for a module-level `history` that didn't exist. Any call to `trimHistory()` or `persistHistory()` from inside `runAgentLoop` would resolve `history` against the module scope, find nothing, and throw `ReferenceError: history is not defined`.

The bug was latent in v3.13.0, v3.14.0, v3.14.1, and v3.15.0. It only surfaced now because some agent runs happened to hit specific control flow that triggered `persistHistory()` in a way that exposed it — most action handlers call `await persistHistory()` after each step, so it should have fired immediately, but the call site that triggered this report was the scroll handler's exit path.

### Fix

- **`background/agent-engine.js`** — moved `let history = [];` from inside `runAgentLoop` to module scope, alongside `agentMemory` and other state vars. Inside `runAgentLoop`, replaced `let history = [];` with `history.length = 0;` to clear the array IN PLACE — preserves the array reference so any captured closures (the module-level helpers) still see the same array.
- **`resetAgentState()`** — added `history.length = 0;` for safety so explicit resets also clear the array.
- Concurrent agent runs are still prevented by the existing `if (agentRunning) throw` guard in `startAgent`, so module-level `history` is safe.

### Audit of other shadowed locals

- `consecutiveNavigates` — local to `runAgentLoop`, never accessed by module-level helpers. Safe.
- `agentMemory`, `agentPlan`, `runLogId`, `runLogBuffer` — all already module-level. Safe.
- `summarizeHistoryBatch`, `maybeRollupHistory`, `maybePostProgressUpdate`, `captureReportData` — all take `history` as an explicit parameter rather than closing over a free variable. Safe.
- Only `trimHistory` and `persistHistory` had the bug. Both fixed.

### Bumped

- `manifest.json`: `3.15.0` → `3.15.1`.

### How to verify

Reload the unpacked extension. Run any goal that involves a scroll, click, or extract action. Should NOT see `Loop error: history is not defined` in the agent log. Pre-existing behavior otherwise unchanged.


## v3.15.0 — 2026-05-12 (Adaptive Prompts)

Pre-execution platform-aware goal rewrite. The agent detects which cloud portal you're on (SonicWall NSM, M365 admin, FortiGate, on-box SonicOS) and rewrites your goal with the correct menu paths and a Phase 0 drill-down BEFORE the run starts. Closes the SonicWall NSM failure mode that flailed for 9 steps last night. Full notes in `RELEASE_NOTES_v3.15.0.md`.

### Added — Platform profile system (`background/platforms/*`)

- New directory with one file per platform. Each profile exports `{id, label, memoryKeyPrefix, detect(url, goal), needsTargetSelection, preflightInstructions, mismatchHints, liveDataCaveats, knownGotchas, rewriteInstructions}`.
- Profiles shipped:
  - **`sonicwall_nsm`** — NSM cloud orchestrator. Inserts Phase 0 ("MANAGE > FIREWALLS > drill into target firewall"), translates 9 on-box menu paths, notes the 5-15 min analytics lag.
  - **`sonicwall_onbox`** — SonicOS web admin. Canonical surface; minimal rewrites.
  - **`m365_admin`** — Covers admin.cloud.microsoft, entra.microsoft.com, admin.exchange.microsoft.com, purview.microsoft.com, security.microsoft.com, intune.microsoft.com, login.microsoftonline.com. Includes an `inferSurface(goal)` heuristic that detects which sub-portal a goal targets (Entra vs Exchange vs Purview vs Defender) so the agent navigates to the right portal first.
  - **`fortigate`** — FortiGate + FortiManager device drill-down hint.
- New `background/platforms/index.js` exports `getPlatformProfile(url, goal)` (order-sensitive registry; first match wins) and `findMismatchHints(profile, goal)`.

### Added — Adaptive Prompts engine (`background/adaptive-prompts.js`)

- New `rewriteGoalForPlatform(rawGoal, currentUrl, technicianInfo, expansionMode)` makes one LLM call (~2-4s, ~$0.001) via the same provider as the main agent.
- Returns `{adapted, adaptedGoal, originalGoal, platform, summary, mismatchHints, error, durationMs}`. Falls back to the original goal on any error — never blocks a run.
- Short-circuits without an LLM call when the goal is short, has no detected mismatches, and the platform doesn't require Phase 0.
- Tightly-scoped system prompt: "Preserve intent, structure, deliverable, output style. Only change menu paths, add Phase 0 if required, prefix memory keys."

### Added — Wired into `startAgent` (`background/agent-engine.js`)

- `startAgent` now reads `adaptivePromptsMode` from storage. Three modes:
  - `auto` (default) — rewrite silently, swap goal, broadcast `adapted_goal_available` so the popup shows a collapsed informational card.
  - `approval` — rewrite, broadcast the card, pause via `_waitForAdaptedGoalDecision()` until the user accepts / rejects / edits. SW kept alive via 3.14.0 `startSwKeepalive`. 5-min outer timeout defaults to Accept Adapted.
  - `off` — never rewrite.
- Forensic run log captures one `adaptive_prompt_applied` entry per run with platform id, mismatch count, duration, before/after lengths.

### Added — Adapted Goal card (`popup-modules/chat.js`)

- New `showAdaptedGoalCard(payload)` renders a collapsible card with: platform name, mismatch count line, Show/Hide toggle, summary bullet list, two `<details>` panels (full adapted goal, full original goal).
- Approval mode adds three buttons: Use Adapted Goal, Use Original, Edit. Edit replaces the adapted text with a textarea and the buttons with Save & Run / Cancel. Save sends `adapted_goal_response` with `edited: true, editedGoal: <textarea value>`.
- New `adapted_goal_available` message handler in the listener.

### Added — Settings UI (`popup.html` + `popup-modules/settings.js`)

- New section with two dropdowns:
  - **Adaptive Prompts**: `Auto` (default) / `Approval` / `Off`
  - **Expansion Mode**: `Light` (default) / `Off` / `Full` — controls whether the rewriter is allowed to add phases to short user goals.
- Both auto-save on change.

### Storage keys (new)

- `adaptivePromptsMode` (default `'auto'`)
- `adaptiveExpansionMode` (default `'light'`)

### Bumped

- `manifest.json`: `3.14.1` → `3.15.0`.

### Compat notes

- All existing settings untouched. The two new keys default to safe sensible values; users who skip Settings get Auto + Light.
- Profile dispatch is order-sensitive in `platforms/index.js` — more-specific profiles before fallback profiles. Adding a platform = add one file + one line.
- No migration required. Goals submitted before v3.15.0 still work; they just don't get the rewrite pass on this run.


## v3.14.1 — 2026-05-11 (Hotfix: sign-in wall detector)

User-reported freeze: agent navigated to entra.microsoft.com → redirected to login.microsoftonline.com sign-in page → got stuck because the v3.7.0 password-field hard-block (which is working as designed) prevents auto-fill, but nothing told the agent to *stop trying* and ask for human help. Step counter kept incrementing while no visible progress happened.

### Added — Sign-in wall detector (`background/agent-engine.js`)

- New `detectSignInWall(allElements, currentUrl, pageText)`: returns `{matched, host, evidence, selector}` when BOTH (a) the URL matches a known auth host (`login.microsoftonline.com`, `accounts.google.com`, `*.okta.com`, `auth0.com`, `signin.aws.amazon.com`, `github.com/login`, `*.my.salesforce.com`, `adfs.*`, etc.) AND (b) the observed page has a password input — OR has an email/username input with sign-in text cues (catches Microsoft's two-step sign-in where the email page renders before the password page).
- Wired into the agent loop right BEFORE the existing MFA detection (auth wall comes first chronologically: sign in → MFA → app). When matched: pause the agent, broadcast `sign_in_wall_pause` to the popup, write a forensic-log entry, and wait for user to click Resume.
- New module-level `signInWallAckUrls` Set tracks URLs the user has already acknowledged this run — prevents re-pausing on the same URL after manual sign-in. Cleared in `resetAgentState()` so each new run starts fresh.

### Added — Manual-resume banner (`popup-modules/chat.js`)

- New `showSignInWallBanner(url, host, evidence, stepNumber)` — orange banner styled like the MFA banner with three actions: **Resume** (sends `resume_agent_loop`), **Focus tab** (sends `focus_tab_by_url` so the user is one click away from the auth tab), **Dismiss**.
- Message handler for `sign_in_wall_pause` added to the existing `chrome.runtime.onMessage` listener.

### Added — Tab focus helper (`background/index.js`)

- New `focus_tab_by_url` message handler that finds a tab matching the requested URL (exact match, falling back to host match), activates it, and focuses its window. Used by the banner's Focus tab button so the user can hop straight to the auth wall without alt-tabbing.

### Diagnosed but already shipped

- The runtime password-field hard-block (REVAMP #5) is already in place — `content/index.js:1140` (synthetic type path) and `content/index.js:595` (CDP focus_element path). Both use `__sentinelCheckSensitiveField` with a label-context regex covering password, PSK, API key, recovery code, SSN, CC, account number, etc. No new code needed for that line of defense.

### Files touched

- `background/agent-engine.js` — detector + loop wiring + state reset.
- `popup-modules/chat.js` — banner + message handler.
- `background/index.js` — `focus_tab_by_url` handler.
- `manifest.json` — `3.14.0` → `3.14.1`.

### Behavior change

If you load v3.14.1 and immediately re-run the M365 SMTP relay goal that froze, you'll see a paused-state banner the moment the agent lands on `login.microsoftonline.com` with a password field visible. Sign in manually in the affected tab (handle MFA as usual via the existing MFA banner), click Resume, and the agent picks up from the post-auth page.


## v3.14.0 — 2026-05-11 (Ticket Mode + Run Log History + SW Keepalive)

The "ship the three highest-leverage MSP workflow features from the REVAMP backlog" release. v3.13.0 made the agent smarter; v3.14.0 makes its output paste-ready and its forensic trail browsable. Full notes in `RELEASE_NOTES_v3.14.0.md`.

### Added — Ticket Mode with six output templates

- **`background/agent-engine.js`**: promoted the 3.8.0 single-format `formatTicketFinalNotes` into a full dispatcher (`formatTicketOutput`) with five new formatters:
  - `formatTicketKickoff` — `MAIN ISSUE` / `WHAT HAS BEEN TRIED` / `FASTEST SAFE RESOLUTION PATH`. Derives "tried" lines from summary text via verb regex; resolution path from the trailing sentences.
  - `formatWaitingOnClient` — pending-client framing with 24h default follow-up timestamp.
  - `formatWaitingOnVendor` — diagnostics-complete framing with vendor case opening + follow-up commitment.
  - `formatItGlueKb` — Title / Issue / Environment / Resolution Steps / Verification / Screenshots. Environment auto-detected from goal keywords (M365, firewall, EDR, RMM/PSA).
  - `formatClientEmail` — Subject line + email body with `[Client Name]` placeholder and contact footer auto-filled.
- New `_autoPickFormat(summary, goal)` heuristic routes the `auto` setting based on goal text ("waiting on vendor" → vendor block, "draft an email" → email, etc.). Defaults to `FINAL_NOTES`.
- Finish handler now reads `chrome.storage.local.ticketMode` (boolean) and `ticketFormat` (string). When the toggle is on, every finish runs through the dispatcher. When off, the legacy 3.8.0 behavior (auto-detect ticket-shaped goals → `FINAL_NOTES`) remains.
- **`popup.html`**: Settings modal gains a Ticket Mode toggle row + a conditionally-shown format dropdown + a technician details grid (name / title / company / phone / email).
- **`popup-modules/settings.js`**: load/save/wire for the toggle + dropdown + debounced auto-save for technician fields. Defaults match the prior hardcoded values (Brandon Goolsby / Premier Networx / 706-426-6313 / support@augustaitguys.com), so users who don't edit see identical output.

### Added — Run Log History modal

- **`background/agent-engine.js`**: new `_updateRunLogIndex(runLogId, fields)` helper maintains a `run_log_index` storage array (capped at 20). Called at run start (initial entry with goal/startedAt/startUrl) and run finish (mark `completed: true` with finishedAt/stepCount/apiCallCount). Overflow runs get their detail records (`run_log_<id>`) evicted from storage to prevent unbounded growth.
- **`popup.html`**: new `run-log-history-modal` with rows for each indexed run, status chip, per-row Export JSON / Export CSV / Delete buttons, footer Clear All button.
- **`popup-modules/chat.js`**: `openRunLogHistoryModal` / `renderRunLogHistoryList` / `exportRunLogById` / `deleteRunLogById` / `clearAllRunLogs`. Surfaced from two entry points:
  - The existing post-run export banner gets a new "View past runs" button.
  - The command palette (`Cmd/Ctrl+K`) gains a "Run Log History" entry.
- Re-export reuses the existing 3.9.0 export path by stuffing `__lastRunLogId` before dispatching, so JSON and CSV output is identical to the post-run banner.

### Added — Service-worker keepalive during approval / tenant-override waits

- **`background/shared-state.js`**: new `startSwKeepalive(name)` / `stopSwKeepalive(name)` ref-counted helpers. While any name is active, a `chrome.storage.session.set` ping fires every 20s — any `chrome.*` API call resets the MV3 idle timer, so the SW survives well past the ~30s idle limit.
- **`background/agent-engine.js`**: `requestApproval` and `requestTenantOverride` both wrap their wait Promise in `startSwKeepalive` / `stopSwKeepalive` calls. Keepalive is released on every exit path (resolve, reject, timeout).
- Previously: an AFK user past the 30s idle mark killed the SW mid-approval-wait, the `chrome.runtime.onMessage` listener was GC'd, and the eventual user click resolved into the void. Silent timeout, no recovery.
- Now: the SW stays alive for the full 60s (approval) / 90s (tenant override) timeout window, so the listener is still registered when the user clicks.

### Bumped

- `manifest.json`: `3.13.0` → `3.14.0` (minor — additive features, no architecture changes).

### Compat notes

- All existing settings keys untouched. `technicianInfo` and `run_log_index` are new keys; first read returns sensible defaults.
- Manifest permissions unchanged (`alarms`, `notifications`, `storage`, etc. already declared in 3.13.0).
- No migration required for existing `run_log_<id>` records — they're not back-filled into the index, but new runs from 3.14.0 onward populate it.


## v3.13.0 — 2026-05-10 (Auto-recovery overhaul: engine handles reliability, LLM handles planning)

The "stop asking the LLM to do engineering work it's bad at" sprint. Four targeted refactors that move retry / recovery / completeness decisions OUT of the LLM and INTO the agent engine. Net effect on a typical research run: 30-40% fewer wasted steps, far fewer "agent finished but data is incomplete" outcomes, cleaner agent state.

### The architectural insight
LLMs are excellent at "what's the next step in this plan" but mediocre at "did the JavaScript I just wrote return useful data, and what should I try instead." Every retry decision the LLM has to make is a chance to pick wrong. The fix is to take retry / loop / completeness decisions out of the LLM's hands and let the engine handle them mechanically. The LLM proposes, the engine verifies.

### Added — Engine extraction retry ladder (`background/agent-engine.js`)
- New `_runExecuteJsWithRetryLadder(tabId, code, timeout)` automatically tries the LLM's original `execute_js` code, and on unproductive result (empty / null / `[object Object]` / non-serializable / parsed-empty), falls back through:
  1. Original code (LLM's intent)
  2. `document.body.innerText.substring(0, 8000)` (covers selector-miss and null-query failures)
  3. Aggregated visible-element text harvest from h1-h4/p/td/li/a/span/div (covers SPA pages where body.innerText returns just the loading state)
- Returns `{ raw, strategy }`. When fallback fires, the result text is annotated with `[ENGINE NOTE: original execute_js was unproductive; auto-recovered via <strategy>]` so the LLM can adapt its parsing in the finish summary.
- New `_isUnproductiveJsResult(raw)`: single-source-of-truth detector for "this didn't work" — used by the ladder, the memory hygiene gate, and any future reliability check that needs the same logic.
- New `_runExecuteJsOnce(tabId, code, timeout)`: factored-out helper that runs a single CDP-or-content-script execute_js attempt. Used by the ladder.

### Added — Memory hygiene at write time
- New `_shouldAcceptMemoryWrite(key, value, agentMemory)` runs BEFORE any value gets written to `agentMemory`. Rejects:
  - Values < 10 chars (too short to be useful data)
  - Error-shaped strings (`JS Error:`, `Element not found`, `Code execution timed out`, etc.)
  - `[object Foo]` strings that escaped the `_useless` regex
  - Duplicate keys (an existing key already has the exact same value)
- Rejection produces a specific error message ("rejected: value too short", "rejected: duplicates existing key X") that the LLM gets in the result, so it can choose a different extraction strategy on retry.
- Cleaner agent state means cleaner subsequent prompts, faster hallucination gate, less noise in the report-generator's memory summary.

### Added — URL-aware action-type loop detection
- New `_detectActionTypeLoop(history, agentMemory)` catches the "agent did 7 different navigates / 5 different clicks, none produced a productive memory write" pattern that the existing exact-action loop detector misses (because each action targets a different URL or selector).
- Heuristic: if 3+ of the last 4 actions are the same TYPE, AND that type is in the non-productive set (`navigate`, `switch_tab`, `click`, `scroll`, `wait_for_*`, `read_page`), AND none of those 4 steps produced a productive write (extract / extract_list / execute_js with key, or note), force a strategy shift.
- When fired, injects a context-specific directive: "STOP navigating, run execute_js with a key on the current page; the retry ladder will fall back to body.innerText automatically. If extraction has failed twice, finish() with what you have rather than retrying."
- Wired into the existing loop-directive logic in the main agent loop.

### Added — Pre-finish data-completeness check
- New `_checkPreFinishCompleteness(goal, agentMemory, history)` parses the goal text for "extract X, Y, Z for each item" patterns (matches `/(?:extract|find|pull|give\s+me|return)[^.]*?:\s*([^.
]+)/i`), splits on commas / "and" / "&", and verifies each requested field has token-evidence in `agentMemory` or notes.
- If MORE THAN HALF of the requested fields lack evidence, the finish handler blocks once with: "Goal asked for X, Y, Z. Memory is missing token-evidence for Y, Z. Try one more execute_js or extract pass before finishing — the retry ladder will auto-fall-back if your selectors miss."
- Blocks ONCE per run only — if the agent retries finish, we let it through (the gap may be genuinely unextractable, like data behind auth). The < 50% threshold and one-shot block prevent false-positive lockup.
- Catches the "agent finished but CVSS scores missing" pattern surfaced in last night's FortiGate test run.

### Why this wasn't done as a system-prompt change
We tried system-prompt nudges through v3.12.x (`EXECUTE_JS RELIABILITY PATTERNS`, `When you have the listing data you are DONE`, etc.). They help but don't fully eliminate the problem because the LLM has to choose to follow the advice every step. Engine-side enforcement removes the choice — the right behavior is the only behavior. System-prompt advice is now a teaching layer; the engine is the safety net.

### Files touched
- **`background/agent-engine.js`**: 5 new helper functions (~250 lines), 3 wiring sites (execute_js handler, main-loop loop-directive section, finish handler).
- **`manifest.json`**: bumped `3.12.6` → `3.13.0` (minor version bump because of the architectural shift, not just a hotfix).

### Expected impact on real runs
- **FortiGate CVE prompt** (last night's benchmark): 21 steps → ~10-12 steps, with all CVSS scores and version data filled in.
- **EV comparison prompt**: ~50% improvement in cells filled (extraction failures now auto-recover instead of giving up).
- **Reports**: same citation density, same anti-hallucination behavior, but `⚠ unverified` markers should appear far less frequently — most of those gaps were extraction failures the engine can now recover from.

### What this didn't change
- All v3.12.x features still work: source citations, vision verification, client knowledge injection, PDF export, MFA detection, tenant lockdown, side-panel toggle, sound-notifications-off-by-default.
- The system prompt's `EXECUTE_JS RELIABILITY PATTERNS` block still teaches the LLM the patterns; the engine just doesn't depend on the LLM following them to survive.


## v3.12.6 — 2026-05-10 (NVD detail-page anti-drill + extraction fallbacks)

User report: FortiGate CVE run produced a complete report (citations rendered, anti-hallucination held, no synthesis hang) but agent burned 7+ steps drilling into individual NVD CVE detail pages after already harvesting the listing data. CVSS scores, affected versions, and patch dates from those detail pages came back empty.

### Improved
- **`background/llm-client.js`**: tightened the NVD platform-context block. New top-level rule: "When you have the listing data, you are DONE." Explicit instruction to NOT click into detail pages just to get "more detail" — the listing already has CVE ID, CVSS score with severity label, summary, CNA, and dates inline per row. Drilling is now framed as a budget-waster, with three named exceptions (full CPE enumeration, complete reference list, exploit-module refs).
- Added concrete detail-page extraction fallbacks for cases where drilling IS warranted: regex pattern for CVSS score in body text (`/\d+\.\d+\s+(CRITICAL|HIGH|MEDIUM|LOW)/`), CVSS vector string locator (`CVSS:3.1/AV:`), CPE selector targets (`.vuln-detail-table td, .cpe-text, [class*=cpe]`), and description-element hook (`#vulnDescription`).
- **`manifest.json`**: bumped `3.12.5` → `3.12.6`.

### Net effect on a re-run of the FortiGate CVE prompt
- Should finish with ~10 steps instead of 21
- Same citation density, anti-hallucination, report quality
- Listing-page data is treated as authoritative for spec/severity/ranking goals
- Detail-page extraction (when needed) actually succeeds via regex fallback


## v3.12.5 — 2026-05-10 (Stabilization: simplify NVD context block to fix SW registration)

User report: after v3.12.4, service worker registration failed with "Invalid or unexpected token". Root cause: the NVD platform-context block in `llm-client.js` used a template literal containing JS code samples with nested escape sequences (`\\"`, `\\\\n`, `\\\\d`). Node's parser accepted them; Chrome's V8 in service-worker module-loading context did not.

### Fixed
- **`background/llm-client.js`**: rewrote the NVD platform-context block as a plain JS string array joined with newline. Same teaching content (extraction strategy, search filters, CISA KEV reference, MITRE/CVE.org guidance) but no embedded JavaScript code samples and no nested escape sequences — eliminates any V8/node parser disagreement risk.
- **`manifest.json`**: bumped `3.12.4` → `3.12.5`.

### Why this matters
The previous file passed `node --check` cleanly but Chrome refused to register the service worker. SW registration failure is silent at the manifest level — Chrome shows "registration failed status code 15" but doesn't tell you which file/line. When in doubt, prefer plain prose blocks in system prompts over embedded code samples that need heavy escaping.


## v3.12.4 — 2026-05-10 (Hotfix: report-LLM hang on heavy extraction + NVD platform context)

User report: research run on three FortiGate CVEs hung indefinitely on "Generating investigation report..." despite the agent successfully extracting CVE data from NIST NVD. Root cause: the report-generator's synthesis prompt stuffed the full agent memory (multi-KB JSON arrays per key) into the user prompt with no per-entry cap, blowing past smaller models' context windows and triggering provider timeouts that the existing 45s fetch abort didn't surface cleanly.

Secondary issue from same run: the agent burned 14 of 15 planned steps on NVD detail-page navigation (4-6 steps each) instead of harvesting all CVE data from the search-results listing in one pass.

### Fixed
- **`background/report-generator.js`**: new `_truncateMemoryValue(val, 600)` helper hard-caps each memory entry at 600 chars before injecting into the synthesis prompt. The truncation appends `... [truncated; full value in run log]` so the LLM knows there's more data available, and citation chips still resolve because the keys are intact. Survives any provider context window.
- **`background/llm-client.js`**: new `[NIST NVD / CVE Database]` platform-context block (3.12.4) injected when the agent is on `nvd.nist.gov`, `cve.mitre.org`, or `cve.org`. Tells the LLM that NVD search results pages embed CVSS / description / CPE inline per row — extract from the listing page in ONE `execute_js` instead of clicking into each detail page (4-6 steps each). Includes working selector pattern, regex-on-body-text fallback, advanced-search CPE filter guidance for vendor-specific lookups, and CISA KEV catalog reference for in-wild exploitation status.
- **`manifest.json`**: bumped `3.12.3` → `3.12.4`.

### Net effect on a re-run of "find 3 recent FortiGate CVEs"
- Same step budget should now hit all three sources (NVD listing extract + Fortinet PSIRT + news context) instead of getting stuck on NVD detail-page-by-detail-page navigation.
- Report synthesis won't hang regardless of how much data was extracted.
- Source citations still work; chip keys are unchanged.


## v3.12.3 — 2026-05-10 (Hotfix: client knowledge handlers double-wrapped responses)

User report: clicking the CLIENT chip did nothing. Diagnostic showed listener attached and click firing, but `refreshClientPicker` threw `TypeError: list.map is not a function`.

### Fixed
- **`background/index.js`**: 12 `client_*` message handlers were manually returning `{ ok: true, data: ... }`, but `wrapMessageHandler` ALREADY wraps every return value the same way. So the popup got `{ ok: true, data: { ok: true, data: <array> } }` and `list.map()` failed because `list` was an object, not the array. Refactored: handlers now return data directly and throw on error; the wrapper handles success/failure shaping uniformly. The popup-side `(res && res.data) || []` now correctly resolves to the array.
- **`manifest.json`**: bumped `3.12.2` → `3.12.3`.


## v3.12.2 — 2026-05-10 (Hotfix: toolbar icon now toggles side panel)

User report: clicking the Sentinel toolbar icon while the side panel was open did nothing — it could only open, never close. The manual `chrome.action.onClicked` listener could only call `chrome.sidePanel.open()`; there is no `chrome.sidePanel.close()` API to pair with it, so manual toggling was impossible.

### Fixed
- **`background/index.js`**: replaced the manual `chrome.action.onClicked` listener with `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. With this set, Chrome handles the icon click natively as a true toggle — first click opens the panel, second click closes it. Per-tab `setOptions` in the `tabs.onActivated` handler still controls per-tab visibility during runs; the two APIs coexist fine.
- **`manifest.json`**: bumped `3.12.1` → `3.12.2`.


## v3.12.1 — 2026-05-10 (Hotfix: execute_js extraction reliability)

Real-world test on a multi-EV comparison run showed the agent failing to extract spec data from manufacturer sites — only 1 of 12 target data points came through. Root cause: the LLM was writing extraction code that returned DOM elements or unguarded null queries, the wrapper rejected the result with a vague "non-serializable value" error, and the LLM gave up rather than retrying with a different approach.

### Fixed
- **`background/llm-client.js`**: new `EXECUTE_JS RELIABILITY PATTERNS (3.12.1)` section in the system prompt. Concrete examples of code that ALWAYS works (text extraction with null guards, array-of-objects pattern, regex-on-bodytext pattern, fallback to body.innerText), plus a five-option recovery playbook when extraction returns empty. The pattern guidance for spec/comparison goals specifically — prefer regex on body.innerText over fragile CSS selectors that manufacturers change more often than they change the words "Starting at $".
- **`background/agent-engine.js`**: replaced the vague "wrap your return in JSON.stringify()" failure message with five specific recovery patterns (text-only return, regex extract, read_page fallback, DOM element fix, null-guard pattern). The wrapper already handles JSON.stringify; that wasn't the actual bug.
- **`manifest.json`**: bumped `3.12.0` → `3.12.1`.

### What this didn't break
- Source-citation chips still render correctly (verified in the v3.12.0 EV test report — chips appeared inline)
- Anti-hallucination gate still holds (the test report explicitly refused to fabricate missing numbers)
- Vision verification, client knowledge, and PDF export all unchanged


## v3.12.0 — 2026-05-10 (Cross-Run Client Knowledge + Vision Verification + PDF Export + UX Polish)

The "make it usable as a daily MSP tool for me and my teammates" sprint. Six landed features, all built on top of the v3.11 base.

### Added — Cross-run client knowledge (the big one)
- **Per-client knowledge that compounds across runs** (`background/client-knowledge.js`, `popup-modules/client-knowledge.js`, `popup.html` + 2 modals). Each client has a list of "wisdom" entries — site quirks, timing rules, custom paths, recurring errors. Sentinel injects relevant entries into every step's system prompt automatically. Runs for the same client get smarter over time.
- **Scope per entry**: `global` (always inject) or `url` with a glob pattern (only when URL matches `*.entra.microsoft.com`).
- **Header chip** shows active client. Click to switch or open the management modal.
- **Per-client detail modal** for entry CRUD: add, list, delete entries; rename / re-tenant the client.
- **Export / import** for team sharing — single JSON file per client. Drop into another tech's Sentinel and they get the same per-client wisdom.
- **`background/index.js`**: 13 new message handlers (`client_list`, `client_get_active`, `client_set_active`, `client_create`, `client_update`, `client_delete`, `client_get`, `client_entry_add`, `client_entry_update`, `client_entry_delete`, `client_export`, `client_import`).
- **Run-time integration** (`background/agent-engine.js`): on `startAgent`, loads active client + filters entries by URL match, formats as a system-prompt section, passes through `agentState.clientKnowledgeText`. On run finish, increments `useCount` for entries that were injected and bumps client `runCount`.
- **System prompt** (`background/llm-client.js`): new `clientKnowledgeCtx` section assembled into the per-step prompt between memory context and tab context.

### Added — Vision-based action verification
- **After every modifying action** (`click` / `click_at` / `type` / `select` / `check` / `check_all` / `press_key` / `upload_file`), `agent-engine.js` sets `pendingVerification` with the action description and step number.
- **System-prompt injection** (`llm-client.js`): on the next observation cycle, the model receives a "VERIFY YOUR LAST ACTION FIRST" section that forces explicit examination of the post-action screenshot — did the modal close, did the field fill, did the page navigate? If verification fails, the model must choose a recovery (retry with different selector, wait + re-observe, scroll-to-then-click, or `execute_js` programmatic trigger). Cannot proceed past a destructive action without confirmation.
- **No extra API calls** — uses the existing observation cycle, just sharpens it with an explicit verification step. Catches silent failures (click registered but didn't fire, form filled but hidden validation rejected) that the previous "trust the DOM" path missed.

### Added — PDF report export
- **New "Export PDF" button** in the report modal (`popup.html`).
- **`report-print.html`**: print-friendly standalone page that reads the report from `chrome.storage.local._pendingPrintReport`, renders markdown via local `marked.min.js` (no CDN), decorates `[src:key]` and `[unverified]` markers as inline chips, and auto-triggers `window.print()`.
- **Print CSS** with proper page-break rules, margin reset, source-chip rendering for paper, and accessible link colors. The user picks "Save as PDF" as print destination.
- **`popup-modules/chat.js`**: button stashes the report payload in storage, opens the print page in a new tab, browser dialog appears.
- Direct-to-ticket workflow for Connectwise / Halo / Autotask attachments.

### Fixed — Source-citation chips actually appear in reports now
- **Root cause**: `report-generator.js` runs a separate LLM call with its own prompt that did not mention `[src:memory_key]` tags, so the report-LLM produced polished prose without citations. The hallucination gate's source-tag rule lived only in the agent-engine system prompt, never reached the report stage.
- **Fix #1** (`report-generator.js`): inject a "SOURCE-CITED OUTPUTS (MANDATORY)" section into the report prompt, listing the actual usable memory keys the report MUST cite from. Hard rules: every number, price, date, statistic, named entity must have a `[src:key]` tag. Unverifiable claims must be tagged `[unverified]` and moved to a Caveats section.
- **Fix #2** (`popup-modules/chat.js`): the full-report modal previously rendered markdown without calling `renderSourceChipsIn()`. Even if the LLM had emitted tags, they'd appear as plain text. Now wired so chips render in both the chat assistant message AND the full-report modal.

### Fixed — MFA detector false positives
- **Old**: flat regex array matched `enter your code`, `two-factor`, `push notification`, etc., on any page including coupon code fields, security blog posts, news articles. Would trigger MFA pause + chat banner during retail browsing.
- **New tiered scheme** (`background/agent-engine.js`):
  - **Tier 1** (single match fires): high-confidence cues like `approve sign-in request`, `tap the number you see` (Microsoft number-matching), `Duo push prompt`, `we've sent a verification code to`.
  - **Tier 2** (needs auth-URL OR 2+ stacked matches): looser cues like `verify your identity`, `two-factor authentication`.
  - **Auth-URL whitelist**: `login.microsoftonline.com`, `accounts.google.com`, `*.okta.com`, `*.duosecurity.com`, `/mfa/`, `/2fa/`, etc.
  - **Domain exclusion list**: Amazon, eBay, Walmart, Target, Apple Shop, B&H, GitHub repos, blog/news/article paths, social sites — short-circuit before checking text.
- Now requires real evidence (auth provider URL + at least one cue) before pausing.

### Added — UX polish
- **Welcome state with example prompts** (`popup.html`, `popup.css`, `popup-modules/chat.js`): four MSP-specific examples (Entra sign-in audit, Exchange message trace, SonicWall VPN audit, VirusTotal hash lookup). Click to populate the textarea; `[bracket]` placeholders auto-select for quick filling.
- **First-run onboarding modal** (`popup.html`, `popup-modules/onboarding.js`): four-step walkthrough on first install — what Sentinel does, provider setup pointer, expected-tenant pointer, try-a-goal pointer. Persisted via `sentinelOnboardingDone` flag so it only appears once per install.

### Implementation notes
- Client knowledge `useCount` increments at run end based on which entries were injected at run start, so frequently-used entries surface first in future UI sorts.
- Knowledge entries are capped at 1000 chars each; up to 8 tags per entry.
- The MFA detector exclusion list is conservative — better to miss a true MFA on an obscure auth domain (where the user can manually pause) than to false-positive every shopping run.
- Vision verification adds ~250 tokens per destructive-action step in the system prompt. Negligible cost vs the value of catching silent failures.
- PDF export uses the user's browser print dialog by design — no PDF library to bundle, works identically across Chrome / Edge / Brave.
- Onboarding can be re-triggered manually by clearing `sentinelOnboardingDone` from `chrome.storage.local` (planned: a "Show tour again" link in Settings).
- `manifest.json` bumped `3.11.3` → `3.12.0` (minor version because of the new client-knowledge feature surface; patches were 3.11.x).

## v3.11.3 — 2026-05-10 (Silent by default + sound-notifications toggle)

User reported hearing the Windows notification chime during agent runs. Investigation found six `chrome.notifications.create()` sites firing across various events. Decision: make Sentinel silent by default and put the desktop-toast feature behind an explicit opt-in toggle.

### Changed
- **Silent by default**: Sentinel no longer fires desktop notifications unless the user explicitly enables them. Chat banners and the Errors-tab logging are unaffected.
- **`background/shared-state.js`**: new `notifyIfEnabled(...)` helper that reads `sentinelSoundEnabled` from `chrome.storage.local` (default `false`) and only calls `chrome.notifications.create()` when enabled. Accepts both call signatures (`opts` or `id, opts`).
- **`background/index.js`** (4 sites), **`background/agent-engine.js`** (1 site), **`background/scheduler.js`** (1 site): all six `chrome.notifications.create()` call sites swapped for `notifyIfEnabled(...)`. One toggle silences every site at once.
- **`popup.html`**: new "Sound notifications" toggle row in the Settings modal, immediately after the trusted-input toggle.
- **`popup-modules/settings.js`**: wires the toggle to `chrome.storage.local.sentinelSoundEnabled` with persist-on-change and a confirmation toast.

### Why this matters
The MFA detector regex (`verify your identity`, `enter the code`, `two-factor`, `push notification`) is loose enough to false-positive on retail/checkout pages, which on Windows produces a notification chime every time. Even on real MSP work, three of the six sites (Turbo / Normal / Stealth keyboard shortcuts) fire on every speed change. Off-by-default puts the user in control without sacrificing the feature for those who want it.

- **`manifest.json`**: bumped `3.11.2` → `3.11.3`.

## v3.11.2 — 2026-05-09 (Hotfix: silence benign side-panel race-condition errors)

Patch release for noisy "Uncaught (in promise)" entries in `chrome://extensions` Errors tab.

### Fixed
- **`background/index.js`** — three `chrome.sidePanel.*` calls in non-async listener contexts (`chrome.action.onClicked` and `chrome.commands.onCommand`) returned promises that were never `.catch()`-ed. When a tab was closed or transitioning between activation and the API resolving, Chrome rejected with `No active side panel for tabId: <n>` and the rejection surfaced as `Uncaught (in promise)`. The error was harmless but cluttered the Errors tab. Added `.catch(() => {})` to all three sites and a defensive tab existence check in the icon-click handler.
- **`background/index.js`** — the `toggle-agent` keyboard shortcut path called `chrome.sidePanel.open()` with no `tabId`/`windowId`, which Chrome rejects. Now queries the active tab first and only opens with a valid `tabId`.
- **`manifest.json`** — bumped `3.11.1` → `3.11.2`.

### Why these errors don't (and didn't) affect functionality
Every `sidePanel` call from `agent-engine.js` was already wrapped in try/catch. The `tabs.onActivated` handler in `index.js` was also wrapped. The three sites fixed in this patch were the only unprotected ones. The errors were cosmetic — the side panel rendered correctly in every case — but cosmetic errors in a public extension look bad.

## v3.11.1 — 2026-05-09 (Hotfix: popup load crash on Templates panel)

Patch release fixing a JS error visible in `chrome://extensions` Errors tab.

### Fixed
- **`popup.html`**: the message input wrapper had `class="input-area"` but no matching `id`, so `templates.js` calls to `document.getElementById('input-area')` returned `null`, triggering `Cannot read properties of null (reading 'style')` whenever the Templates panel was opened. Added `id="input-area"` to the existing `<div class="input-area">`.
- **`popup-modules/templates.js`**: hardened every module-level DOM lookup with defensive null checks (`_setDisplay`, `_toggleClass`, `_on` helpers) so a missing element from any future popup.html refactor cannot crash the entire popup module load. The Templates panel now degrades gracefully if any element ever goes missing again.
- **`manifest.json`**: bumped `3.11.0` → `3.11.1`.

## v3.11.0 — 2026-05-09 (Tenant Lockdown + Theme Auto-Save + Custom CSS)

Three additions following the design philosophy: **simple visible UI, sophisticated internals, smart defaults**. Each is invisible until needed, never adds a checkbox, never asks the user to configure something they could be wrong about.

### Added — Tenant Lockdown
- **Hard-block on cross-tenant modifying actions** (`background/agent-engine.js`). Detects when the agent attempts a modifying action (`click` / `click_at` / `type` / `select` / `check` / `check_all` / `press_key` / `upload_file`) on a Microsoft / Azure / Office / SharePoint admin URL while the detected tenant doesn't match the user's `expectedTenant` setting. Blocks the dispatch and surfaces a separate **Cross-Tenant Action Blocked** approval card (red border, ⚠ alert icon, expected vs detected tenant displayed in monospace) with two explicit buttons: "Yes — intentional cross-tenant work" or "Cancel — wrong tenant". Career-risk gate.
- **Per-URL override memory**: once approved on a URL, additional actions on that same URL during the same run don't re-prompt (so you don't get spammed). Cleared at agent stop / new run.
- **Forensic log captures every override decision** (`agent-engine.js`). Three new run-log event types: `tenant_override_requested`, `tenant_override_granted`, `tenant_override_denied` with timestamp, expected tenant, detected tenant, action type, and URL. The CSV / JSON export from 3.9.0 includes all three. Compliance-grade audit trail.
- **Fail-closed timeout**: 90-second wait, then auto-rejects. Cross-tenant work is never silently approved by walking away.

### Added — Theme polish
- **Six new theme presets** (`popup.css` + `popup.html`): 🌅 Sunset, 🌊 Ocean, 🌌 Midnight, 📜 Paper, 🌲 Forest, ⬛ Mono. Each is a CSS variable set following the existing matrix/tron/cyberpunk pattern. Total themes: 14.
- **Auto-save on click** (`popup-modules/settings.js`). Picking a theme preset now persists to localStorage immediately AND updates the active styling AND shows a "Theme: <name> (saved)" toast. No Save button friction — picking is the action. Theme persists across browser restarts.

### Added — Custom CSS upload
- **Custom CSS textarea in the theme modal** (`popup.html`). Power-user escape hatch for full visual customization. Auto-saves on edit (350ms debounce); applies via a `<style id="sentinel-custom-css">` tag injected into the popup head; persists to localStorage as `sentinel-custom-css`.
- **Apply Now / Clear buttons** with status indicator — green ✓ saved tag fades after 2.2s. Helpful CSS variable reference + selector hints below the textarea for users who don't want to dig through DevTools.
- **Loads on every popup open**, so customizations survive across browser sessions even when the side panel is closed and reopened.

### Implementation notes
- Tenant lockdown fires BEFORE the regular approval gate, so cross-tenant blocks happen even when the user is in autonomous mode. Approval mode is a layer on top, not a substitute.
- The lockdown uses the same tenant-matching logic as the popup chip (3.7.0): bidirectional `String.includes` against tid / onmicrosoft / chipText. So if the chip shows green, the lockdown won't fire; if the chip shows red, the lockdown WILL fire on the next modifying action.
- Theme auto-save uses `body.theme-<name>` classes (matching the pattern of existing themes) so multiple themes can't accidentally stack — picking a new theme strips prior `theme-*` classes first.
- Custom CSS injection is a single `<style>` element scoped to the popup. Doesn't bleed into agent-driven page DOM (unlike content-script CSS). Safe to leave any custom CSS in place during runs.
- `manifest.json` bumped `3.10.0` → `3.11.0`.

## v3.10.0 — 2026-05-09 (Source-Cited Outputs + 16-Provider Catalog with Auto-Detect)

A double-feature release: source-cited outputs make every specific claim auditable back to its memory entry, and the new provider catalog lets users plug in any of 16 OpenAI-compatible providers (or a fully custom endpoint) with one-click model auto-detection.

### Added — Source-Cited Outputs
- **`SOURCE-CITED OUTPUTS` system-prompt rule** (`background/llm-client.js`). Every specific claim in a finish summary — numbers, dates, statistics, named quotes, IPs, dollar amounts, percentages — must end with `[src:memory_key]` referencing the agentMemory entry the claim was extracted from. Claims with no extracted source go in a Caveats section tagged `[unverified]`. Generic prose framing doesn't need tags; specific facts do.
- **Hallucination gate now counts source tags** (`background/agent-engine.js`). New regex patterns count specific claims (numbers, dates, percentages, dollar amounts, ISO/named dates) and `[src:*]` tags in the proposed summary. Triggers when:
  - 5+ specific claims with zero source tags, OR
  - 8+ specific claims with claims > 3× tag count
  
  Forces re-write with proper citations. Composes with the existing claim-vs-evidence ratio gate from 3.9.1.
- **Source tag chips in popup** (`popup-modules/chat.js`). On `agent_finished`, the rendered summary is post-processed: every `[src:key]` becomes a clickable orange chip (🔖 key); `[unverified]` becomes a red chip (⚠ unverified). Clicking a chip expands the underlying memory entry inline as a monospace block — full source content visible in-place. Toggle to collapse. Auditability that nothing in Claude in Chrome offers.

### Added — Provider Catalog with Model Auto-Detect
- **16-provider PROVIDER_CATALOG** (`background/provider-registry.js`): OpenAI, Anthropic Claude, Google Gemini, xAI Grok, DeepSeek, OpenRouter, Groq, Mistral AI, Together AI, Fireworks AI, Cerebras, Perplexity, Z.ai (GLM), Ollama (local), LM Studio (local), and Custom (any OpenAI-compatible). Each entry includes endpoint, models endpoint, default model, auth scheme (`bearer` / `x-api-key` / `none`), per-provider headers, response shape (`tagsResponse` for Ollama), and docs URL.
- **`fetchModelsList(provider, apiKey, customModelsUrl)`** helper. Calls the provider's `/models` endpoint with the user's API key, normalizes across the three common response shapes (OpenAI's `{data:[{id}]}`, Ollama's `{models:[{name}]}`, generic arrays), and returns a sorted list of model IDs. 12-second timeout. Handles every auth scheme.
- **Settings UI: Provider Catalog block** (`popup.html` + `popup-modules/settings.js`). New section above the existing presets:
  1. Provider dropdown — picks from the 16 catalog entries.
  2. Selecting a provider auto-fills the endpoint input and (if blank) the model input with the catalog default.
  3. **Detect Models** button — calls the background `fetch_provider_models` handler with the user's API key and the chosen provider's models endpoint. Shows a `⏳ Detecting…` state, then populates a model dropdown with the live model list and a count.
  4. **Use** button — applies the selected detected model to the existing model input field for save.
- **Custom endpoint support** — picking "Custom (OpenAI-compatible)" lets the user enter their own endpoint URL. Detect Models derives the `/models` URL by stripping `/chat/completions` (or `/messages` / `/completions`) from the user's endpoint and appending `/models`. Works against any self-hosted vLLM, Ollama-on-network, LiteLLM proxy, or compatible API.
- **Background message handlers** in `background/index.js`:
  - `get_provider_catalog` — returns the catalog (light copy without internal-only fields) so the popup can render the dropdown.
  - `fetch_provider_models` — runs the auto-detect call from the background context (avoids CORS issues that would hit a popup-side fetch).

### Implementation notes
- The source-tag chip click expands the underlying `agent_memory[key]` value via `chrome.storage.local.get`; if the value is an object/array it pretty-prints with JSON.stringify, capped at 4000 chars.
- The 16-provider catalog explicitly notes which providers don't expose a models endpoint (Perplexity, Z.ai) so the Detect button gives a clear "enter manually" error message instead of failing silently.
- OpenRouter calls include the `HTTP-Referer` and `X-Title` headers per OpenRouter's recommended practice; Anthropic includes `anthropic-version` and the dangerous-direct-browser-access flag for popup-context calls.
- Ollama's response shape is `{models:[{name}]}` (different from OpenAI's `{data:[{id}]}`) — handled by the `tagsResponse` flag on the catalog entry.
- The hallucination gate's specific-claim regex covers: 4+ digit numbers (110,000), percentages (47%), dollar amounts ($5M, $12,345), ISO dates (2026-05-08), and named dates (March 9, 2026 / May 7).
- `manifest.json` bumped `3.9.1` → `3.10.0` (minor bump for the substantial new feature surface).

## v3.9.1 — 2026-05-09 (Hallucination Hard-Stop)

Real-world fix for the failure mode seen in the Drudge briefing run: agent reads 1 article, claims to summarize 10, ends with "but actually I only read article 5". The body of the report fabricated plausible content for the 9 unread items — that's hallucination dressed in journalism language, even with the closing caveat.

### Added
- **Hallucination hard-stop at finish** (`background/agent-engine.js`). New `evaluateHallucinationRisk` function counts distinct claim-items in the proposed finish summary (numbered list entries, table rows, top-level bullets) vs evidence sources (memory keys + note actions). Triggers when:
  - 3+ claims with zero evidence (clear fabrication), OR
  - 4+ claims with claims > 2× evidence and no caveat phrases like "headline only", "not read in this run", "extraction failed", "could not verify"
  
  When triggered, blocks the finish and pushes the LLM back with a directive to either (a) trim to verified items, or (b) tag unverified items explicitly. Skipped for ticket-style investigation goals where claim density is high by design (per-portal report sections).

- **Concrete RESEARCH TASK ANTI-HALLUCINATION rule** (`background/llm-client.js`). New system-prompt section that calls out the exact failure mode by name, shows the wrong way (fabricated descriptions for unread items, with a closing caveat), and shows the right way (only read items get full summaries; unread items get header-only entries explicitly tagged "[headline only — not read in this run]"). Explicitly notes that "the closing caveat does NOT make the body honest" and that the agent-engine gate will block re-writes that fight the rule.

- **MULTI-PAGE RESEARCH STRATEGY directive** (`background/llm-client.js`). For goals containing "top N", "briefing", "summarize each", "first M results" patterns: the LLM is now told to read the source page thoroughly first, harvest all headlines + URLs in a single execute_js call to memory, then open individual article tabs ONLY for items that need deeper extraction. Replaces the wasteful sequential open→read→close→open pattern that drained 18 steps in the Drudge run before reaching summary time.

### Implementation notes
- The hallucination gate uses regex counting of three list-grouping patterns; takes the densest signal as the claim count. False positives are unlikely in practice because legitimate dense summaries (per-portal investigation reports) have correspondingly high evidence counts.
- The caveat regex covers 11 phrasings of "I didn't actually read this item" so the LLM can be honest in any natural phrasing without the gate firing.
- Ticket-style finishes (any goal containing ticket markers) bypass the gate because per-portal section structure can produce 6-8+ items with low memory key counts even when fully verified by `note` actions.
- `manifest.json` bumped `3.9.0` → `3.9.1`.

## v3.9.0 — 2026-05-08 (Reliability & Observability — Six Items, Three Differentiators)

A bigger release — three reliability fixes for things observed in real runs, and three features that put us materially ahead of Claude in Chrome on MSP-style work.

### Fixed — Reliability
- **Defensive object serialization in execute_js memory** (`background/agent-engine.js`). When a model's `execute_js` returned `[object Object]`, `[object Promise]`, `null`, `undefined`, or an empty `{}`/`[]`, the previous code dutifully saved that uselessness to `agentMemory` and called the step productive. Now those values are explicitly rejected with a clear error message guiding the LLM to wrap the return in `JSON.stringify` or extract specific fields. Direct fix for the `form_state: [object Object]` we saw in the Amy Hobbs Purview run.
- **Budget hint in per-step prompt** (`background/agent-engine.js` + `background/llm-client.js`). The LLM now sees a budget line in every per-step prompt: `Current step: 47 of 175 (128 remaining; 6 productive bumps so far). Pace your work: extract / note / execute_js with key = productive (extends budget). Aimless read_page / scroll = unproductive (does not extend).` Knowing remaining budget changes how the model allocates effort across portals. Was previously a black box from the model's perspective.
- **Smarter platform-aware strategy shift** (`background/llm-client.js`). When `consecutiveFailures` hits the threshold, the strategy-shift directive now includes platform-specific recovery hints based on the current URL. M365/Azure: try Graph API + read_network_requests. VirusTotal: shadow.queryDeep. SentinelOne: top-bar global search. SonicWall/Fortigate/Palo: custom dropdown clicks + explicit Apply step. Replaces the previous generic "try a different approach" with directly-actionable guidance.

### Added — Differentiators
- **CSV / file download capture** (`manifest.json` + `background/index.js` + `popup-modules/chat.js`). `chrome.downloads.onCreated` listener fires during agent runs; captured downloads surface in the popup chat with a green-bordered "File downloaded" card showing the filename and full path. Lets the agent's Click-Export-CSV step on Entra/Purview/SentinelOne actually deliver the file location to the technician for ticket attachment. Required new `downloads` permission.
- **Forensic run log + export** (`background/agent-engine.js` + `popup-modules/chat.js`). Per-step structured log: timestamp, URL, tenant, action type, selector/ref, text preview (truncated), result, failed flag. Persisted to `chrome.storage.local.run_log_<UUID>` every step (200-entry rolling buffer). On run finish, the popup shows a "Forensic run log available" banner with **Export JSON** and **Export CSV** buttons. CSV mode produces a flat 10-column table ready for ticket attachment in HR/legal/compliance workflows. Defensibility tier-up over Claude in Chrome which has no run-log export.
- **Resume from checkpoint** (`background/index.js` + `popup-modules/chat.js`). The agent already wrote a per-step checkpoint to `chrome.storage.session.agent_checkpoint`. Now on popup load, a `check_resume_available` message checks for a checkpoint less than 1 hour old when no agent is running. If present, an orange "Resume previous run?" banner appears at the top of chat with a 200-char preview of the goal, the last step number, and how recently it ran. Clicking Resume kicks off a new run with the saved goal — `agent_memory` from the prior run is automatically restored (it's already persisted by `runAgentLoop`'s storage-restore path), so memory carries forward.

### Implementation notes
- The forensic log includes the detected M365 tenant per entry, so cross-client runs get clean per-tenant audit trails.
- Run-log entries cap at 200 in memory; older entries get rolled into a single summary stub when the buffer exceeds. Persistence to storage happens every step regardless of buffer state.
- The resume button currently restarts the run with the saved goal rather than resuming mid-step. A full state restore (history + step counter + plan position) is more invasive — saved for a later release if the per-goal restart proves insufficient.
- CSV export uses RFC-4180 quoting (double-quote escaping, newline-aware).
- Budget hint string is built once per step in agent-engine and passed through `agentState.budgetHint` into the prompt template.
- `manifest.json` bumped `3.8.6` → `3.9.0` + added `downloads` permission.

## v3.8.6 — 2026-05-08 (Kill the Hidden 40-Step Ceiling)

### Fixed
- **Hardcoded `stepCount >= 40` force-finish** in `background/agent-engine.js` was bypassing the entire dynamic step budget rebuilt in 3.8.0/3.8.2. Even with `dynamicMaxSteps` correctly computing values up to 300 for multi-portal investigations, this older guard fired at exactly step 40 and force-finished with a generic "Task completed after 40 steps" summary. That's why the Amy Hobbs investigation just stopped at 40 with `form_state: [object Object]` and no real findings — the dynamic budget never had a chance to extend the run. Replaced with `Math.max(40, dynamicMaxSteps - 5)` so the soft-finish path fires ~5 steps before the hard dynamic cap, letting productive multi-portal runs use their full 150-300 step allocation while still building a clean summary at the end.
- **Don't-give-up-early guard threshold raised** from `stepCount < 40` to `stepCount < 80`. The previous threshold was off-by-one against the hardcoded ceiling above (the guard couldn't fire AT step 40, but the force-finish did fire at exactly step 40). Now the guard covers the full mid-run zone where the agent is most likely to give up due to a stuck UI before realizing it has alternative strategies (Graph API, alternate URLs, etc.).
- Updated guard message to surface the new 80-step / 300-step-cap context to the LLM so it understands its actual remaining budget.

### Implementation notes
- The dynamic limit chain is now properly layered: hard break at `> dynamicMaxSteps`, soft finish at `>= dynamicMaxSteps - 5` (caps at min 40 to preserve old behavior on simple non-multi-portal goals), don't-give-up guard at `< 80` for multi-portal goals with incomplete-status finishes.
- The Amy Hobbs Purview run will now have ~95-150 steps available instead of being clipped at 40 — enough to actually navigate the date-filter blocker, try the Graph API extraction path, and surface real findings.
- `manifest.json` bumped `3.8.5` → `3.8.6`.

## v3.8.5 — 2026-05-08 (Notification Icon Hotfix)

### Fixed
- `chrome.notifications.create` calls were passing relative iconUrl strings (`'icon-48.png'`, `'icon-128.png'`) which throw `Uncaught (in promise) Error: Unable to download all specified images.` on stricter MV3 builds. Converted all 6 call sites in `background/agent-engine.js`, `background/index.js`, and `background/scheduler.js` to use `chrome.runtime.getURL('icon-NN.png')` so the runtime resolves them to fully-qualified extension URLs.
- Affects: MFA-pause notification (3.7.0), agent-stop notification, speed-mode notifications (turbo / normal / stealth), and scheduled-task notifications.
- `manifest.json` bumped `3.8.4` → `3.8.5`.

## v3.8.4 — 2026-05-08 (Robust LLM Response Parsing — kusto Code Fence Bug)

Fixes a real-world regression where the agent finished an investigation successfully but the response was lost because the LLM emitted invalid JSON escape sequences inside markdown code fences.

### Fixed
- **Invalid escape sequences inside string values** (`background/llm-client.js`). When the LLM emits a `finish` action with a markdown code fence inside the summary (e.g., a triple-backtick `kusto` block for a KQL example), the response often contains `\`` (backslash-backtick) — which is **not a valid JSON escape sequence** (only `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX` are valid). `JSON.parse` would bomb with `Unexpected token 'k', "kusto..."` and the entire investigation report would be lost. New `sanitizeLlmJson` function walks the JSON string state-aware and:
  - Inside string contexts, drops the backslash before any invalid escape character (so `\`` becomes `` ` ``)
  - Escapes raw newlines/CRs/tabs to `\n`/`\r`/`\t` (raw control chars are illegal inside JSON strings)
  - Drops other control chars
  - Leaves valid escapes and structural JSON characters untouched
- **Regex-based salvage for finish/note actions** (`regexSalvageFinishOrNote`). Last-ditch recovery when even the sanitized JSON won't parse. Pulls the `summary` or `text` content via permissive regex, unescapes common patterns, and rebuilds the action object. Logs a `[Sentinel] Recovered <type> action via regex salvage` warning when this fires.
- **Two-tier salvage path** in `parseLLMResponse` catch block: (1) sanitize-then-parse the full content (in case `extractFirstJsonObject` truncated something) (2) regex extraction. Prevents one bad escape sequence from costing the user an entire investigation report.

### Implementation notes
- The previous salvage code stripped `[\x00-\x1f]` (all control chars) BEFORE attempting to fix newlines, which destroyed the line breaks and made the salvage produce malformed JSON. Now control chars are properly converted to their escaped equivalents inside string contexts.
- The state-aware sanitizer correctly distinguishes between `\\\\` (escaped backslash, valid) and `\\X` (invalid escape) — only the latter triggers correction.
- Sanity-tested against the actual failing input from the Amy Hobbs investigation log: a finish summary with `\`` and raw newlines now parses cleanly to `{type: "finish", summary: "..."}`.
- `manifest.json` bumped `3.8.3` → `3.8.4`.

## v3.8.3 — 2026-05-08 (Investigation Resilience — Graph API + URL Drift + Don't Give Up)

Targeted fixes for the failure modes seen in the Amy Hobbs HR investigation run: cross-origin sandbox iframes blocking Entra extraction, Purview audit URL having moved, and the agent calling `finish` early with "incomplete" markers instead of trying alternate strategies.

### Added
- **Microsoft Graph API extraction strategy** (`background/llm-client.js`). New system-prompt section telling the LLM that M365 admin centers (Entra, Exchange, Purview, M365 admin, Defender, Intune) fetch their data from Microsoft Graph behind the scenes. Use `read_network_requests` with `url_includes: 'graph.microsoft.com|graphbeta'` to capture the underlying JSON. **This is now the PRIMARY extraction path** for any M365 investigation where DOM extraction fails. Includes ten common Graph endpoint paths (sign-ins, audit logs, users, mailbox audit, defender alerts, intune devices, OneDrive activity, SharePoint, Teams, etc.) with correct path forms.
- **Don't-give-up-early finish guard** (`background/agent-engine.js`). When the agent calls `finish` before step 40 on a multi-portal goal AND the summary contains "incomplete | step budget | could not access | unable to | exhausted | not yet | did not complete | did not reach | was unable | failed to extract" markers, the guard blocks the finish and injects a directive listing 4 alternate strategies (Graph API, alternate URL paths, iframe-bypass, Log Analytics KQL). The agent must re-attempt using one of these before calling finish again. Stops the "agent gives up at step 20" pattern dead.

### Fixed
- **Entra platform context** now warns about cross-origin sandbox iframes (`sandbox-1/2/3.reactblade.portal.azure.net`) and routes the LLM to the Graph API path FIRST, before attempting DOM extraction.
- **Purview audit URL** corrected from `/auditlogsearch` (which redirects to home) to `/audit/auditsearch`. Also added Compliance Manager URL note about the compliance.microsoft.com → purview.microsoft.com redirect that's been rolling out.
- M365 navigation paths block annotated with "verified 2026-05" so future drift is easier to spot.

### Implementation notes
- The Graph API section is appended into the system prompt template literal — backticks inside the section are properly escaped to `\`` so the literal doesn't close prematurely.
- The don't-give-up guard runs BEFORE the existing config-verification gate and the data-presence gate, so all three checks compose. If the goal is multi-portal AND no commit happened AND the summary is "incomplete," all three guards can fire in sequence; the agent gets specific guidance for each blocker.
- The guard's `_isMultiPortal` detection uses the same regex pattern as `detectGoalPortals` for consistency. ≥ 2 detected portals trips it.
- `manifest.json` bumped `3.8.2` → `3.8.3`.

## v3.8.2 — 2026-05-08 (Long-Run Endurance — Handle Complex Prompts End-to-End)

Reframes the multi-portal investigation behavior. The user's core use case is long, complex prompts (HR/compliance audits across 7+ admin centers, multi-step threat hunts) that the agent should **execute end-to-end**, not split into followups. This release rebuilds the foundations to make 200-300 step runs reliable and affordable.

### Changed — Multi-portal directive flipped from "split" to "execute"
- `getMultiPortalDirective` (`background/llm-client.js`) now tells the LLM: **you have an extended budget; complete the investigation end-to-end across all detected portals**. Required execution pattern: plan portal-by-portal, save findings to memory under portal-prefixed keys (`entra_signins`, `exchange_rules`, `purview_audit_search`, etc.), use `note` actions for per-portal section headers, structure the final report as Executive Summary + per-portal sections + cross-portal correlation + "Next questions for the client". Explicit anti-pattern callouts: don't stop after one portal, don't produce just a checklist.

### Changed — Step budget rebuilt for long runs
- `CONFIG.maxSteps` baseline raised from **50 → 100** (`background/agent-engine.js`).
- Productive-action extension raised from **+15 → +25** per successful extract / extract_list / note / execute_js-with-key / non-empty observability call.
- Hard cap raised from **100 → 300**.
- **Multi-portal head-start**: when the goal mentions ≥ 2 admin centers/portals, the baseline starts at +50 (so 150 instead of 100) before any productive extension. A 7-portal HR investigation now has effective budget up to ~300 steps even from a slow start.

### Added — Rolling history summarization
- `summarizeHistoryBatch` + `maybeRollupHistory` (`background/agent-engine.js`). After history exceeds 30 entries, the oldest 15 are condensed into a single `history_summary` entry that captures action counts, navigation URLs, memory keys saved, notes recorded, and any failure clusters. This is the gating fix that makes 200+ step runs **affordable** — without it, prompt cost grows linearly with steps and a 300-step run is prohibitively expensive. With it, the prompt stays bounded around ~30 detailed entries + summaries of older work.

### Added — Periodic progress checkpoints
- `maybePostProgressUpdate` (`background/agent-engine.js`). Every 25 steps during a run, posts a `📊 PROGRESS UPDATE` chat message listing portals visited, data points in memory, and the most recent action. So during a long HR investigation you see "step 75 / Entra, Exchange visited / 12 data points / Recent: extract_list" instead of staring at a step counter wondering if anything is happening.

### Added — Cross-portal memory namespacing
- Auto-prefixes `extract` / `extract_list` / `execute_js-with-key` memory keys with the detected portal name (`entra_signins`, `exchange_rules`, `purview_audit_search`, `onedrive_external_shares`, `teams_call_summary`, `intune_compliance`, `defender_alerts`, `sentinelone_threats`, etc.). Findings group cleanly in the final report by portal section. The LLM sees these prefixed keys in the AGENT MEMORY context so it can reference them by portal when building the per-portal report sections.

### Changed — Tab limit raised
- `TAB_LIMIT` 5 → 10 (`background/tab-context.js`). Multi-portal investigations frequently want to keep Entra, Exchange admin, Purview, OneDrive admin, and SentinelOne all open in parallel for cross-referencing. 10 is enough for the most complex M365 + EDR + RMM workflows; the LRU eviction still kicks in at 10.

### Implementation notes
- The history summarizer respects the existing `history_summary` entries and never re-summarizes them — so a 300-step run ends with a stack of compact summaries at the front and ~30 detailed recent entries at the back.
- Progress checkpoints only fire when `stepCount % 25 === 0`, so they don't flood the chat. They're shown via `sendSilentUpdate` (the same channel as planning/observation messages), routed into the active step card's log area.
- Memory key auto-prefixing skips if the LLM already used a portal-prefixed key (avoids `entra_entra_signins` double-prefixing).
- Multi-portal head-start uses the SAME 16-portal regex from the `detectGoalPortals` analyzer (3.8.1) for consistency.
- `manifest.json` bumped `3.8.1` → `3.8.2`.

## v3.8.1 — 2026-05-08 (Cursor Visibility + Focus Button + Multi-Portal Split)

Targeted fixes for three issues seen in real runs: virtual cursor not visible on SPA pages (Entra), Focus button doing nothing, and multi-portal investigation prompts overwhelming a single run.

### Fixed — Virtual cursor reliably visible (`content/cursor.js`)
- **Attaches to `documentElement` (the `<html>` node), NOT `body`.** SPAs like Entra, Salesforce, and Lit-based pages frequently re-mount or replace `body`'s content, orphaning content scripts that attached there. `documentElement` is far more stable across reconciliation passes.
- **MutationObserver re-creates the cursor immediately** if the framework prunes it. Fires within one animation frame so re-creation feels instant.
- **`isolation: isolate` + `z-index: 2147483647`** (max int) on the cursor root — beats Entra's stacking contexts where M365 admin chrome tends to render above ordinary z-index values.
- **`!important` on positioning/z-index** so site CSS can't override our visibility rules.
- **Visible by default** with a soft 2.4s breathing glow animation. Previously the cursor only became visible during action travel and faded back to opacity 0 between steps — that's why nothing was showing during planning / API-thinking time. Now you always see where the operator is.
- **`setKeepVisible(boolean)` mode** so the agent can pin the cursor to full opacity during a run, or let it dim between sessions.
- **Larger SVG arrow with stronger drop-shadows** so it's visible against light AND dark page backgrounds.

### Fixed — Focus button works
- **`page_context` message now carries `tabId`** (`background/message-protocol.js`). The popup's active-tab strip captures it directly, no waiting for a `tab_state_update` event that may not fire on single-tab runs.
- **Three-tier fallback resolution** in the popup Focus button handler:
  1. Use the captured `tabId` if available.
  2. Fall back to `chrome.tabs.query({ url: <exactURL> })`.
  3. Fall back to hostname pattern `*://*.<host>/*`, then a final URL-substring scan across all open tabs.
  Plus a "Could not find the agent's tab to focus" toast if every fallback misses, so the button stops being silently broken.

### Added — Multi-portal investigation auto-split (`background/llm-client.js`)
- **`detectGoalPortals(goal)` + `getMultiPortalDirective(goal)`** helpers. Sixteen detectors covering Entra, Exchange, Purview, OneDrive, SharePoint, Teams, Intune, Defender, M365 admin, Azure portal, SentinelOne, ConnectWise, NinjaOne, Datto, IT Glue, Huntress.
- **When ≥ 2 portals are mentioned, a `MULTI-PORTAL INVESTIGATION DETECTED` directive is injected into BOTH the planning prompt and the per-step prompt.** It instructs the LLM to:
  1. Produce a structured checklist as the primary deliverable (with `note` actions per section)
  2. Execute ONE portal as live evidence (the current tab, or the highest-value one)
  3. Output specific paste-ready follow-up prompts in the finish summary, one per remaining portal
  4. End with a "Next questions for the client" section
- This turns "audit Amy across Entra + Exchange + Purview + OneDrive + Teams + Intune + Defender" from a doomed-to-cut-off single run into a focused checklist + one live portal investigation + 6 ready-to-paste follow-up prompts.

### Implementation notes
- The multi-portal directive triggers at goal-text level, BEFORE the agent picks a strategy. The LLM sees it during planning so it knows the ground rules from step 1.
- Cursor `isolation: isolate` is the key fix for SPA stacking-context issues — without it, even `z-index: 2147483647` can be buried by an ancestor with `transform`, `filter`, or `position: fixed` that creates a new stacking context the cursor's z-index can't escape.
- `manifest.json` bumped `3.8.0` → `3.8.1`.

## v3.8.0 — 2026-05-08 (Investigation Hardening + Platform Coverage + Ticket Format)

A focused pass on the failure modes seen in real MSP runs: step-limit cuts, shadow-DOM extraction failures, missing platform context for the user's daily tools (SentinelOne, VirusTotal, M365 admin centers), and freeform output that wasn't paste-into-ticket ready.

### Added — Investigation hardening
- **Dynamic step limit** (`background/agent-engine.js`). The hard 50-step cap is now a baseline that extends by **+15** every time the agent successfully extracts data, runs a useful `execute_js`, records a note, or pulls non-empty `read_console_messages` / `read_network_requests`. Hard cap **100**. Productive runs get oxygen; aimless loops still terminate. New module-level `productiveSteps` counter; reset on `resetAgentState`.
- **Tightened `read_page` loop guard** (`background/agent-engine.js`). 2+ consecutive `read_page` actions now triggers a `READ_PAGE LOOP DETECTED` directive forcing the LLM to switch to `extract` / `execute_js` / `scroll` / `click` instead of re-reading. Previously required 3+ before any guard fired.

### Added — Platform contexts (`background/llm-client.js`)
Five new platform blocks injected into the system prompt at plan time, with detector heuristics covering URL + goal text:
- **SentinelOne Singularity Console** — Threats tab navigation, Deep Visibility query patterns (`SrcProcDisplayName`, `TgtFileSha1`, etc.), top-bar global search behavior, site/tenant picker safety, action-button confirmation rules.
- **VirusTotal** — explicit warning about Lit shadow-DOM components blocking standard extraction, with a 4-step ordered fallback strategy: `read_network_requests` filter `ui/files|api/v3/files` → `__sentinelUtils.shadow.queryDeep` → `read_console_messages` → honest failure report. URL pattern reference for `/gui/file/<sha>/{detection,details,relations,community}`.
- **Microsoft 365 admin centers** (`admin.microsoft.com`, `admin.exchange.microsoft.com`, `compliance.microsoft.com`, `security.microsoft.com`, `purview.microsoft.com`) — Fluent UI selector preferences (`data-automationid`, `aria-label`, role attrs), virtualized-list search-first guidance, save+toast verification flow, MFA + tenant safety reminders.
- **Microsoft Entra ID** (`entra.microsoft.com`) — sign-in/audit log paths, filter chip awareness, virtualized table scroll-and-collect pattern, Monaco-editor JSON extraction (`monaco.editor.getModels()[0].getValue()`), CSV export download capture, sign-in audit grouping pattern (user × status × IP, flag IPs >3 failures or country mismatch).
- **Azure portal** (`portal.azure.com`) — iframe-aware element scanning notes, resource search entry point, async toast wait pattern, subscription/tenant safety.

### Added — Shadow-DOM extraction strategy
- **`EXTRACTION STRATEGY ON SHADOW-DOM SITES` system prompt section** (`background/llm-client.js`). Four-step ordered fallback for any Lit / Stencil / Web Components page where standard extraction returns empty: (1) read network requests for the underlying API response, (2) `__sentinelUtils.shadow.queryDeep` traversal in `execute_js`, (3) `read_console_messages` for app-emitted data, (4) honest failure report. Explicit "NEVER claim extracted data when source returned empty" reminder.
- **`extract_list` auto-fall-through to shadow tree** (`content/index.js`). When `targetDoc.querySelectorAll(selector)` returns zero results AND the page has shadow roots, automatically retries via `window.__sentinelUtils.shadow.queryDeep`. Both `cmd.ref`-with-fallback path and the pure-selector path covered. Means VT/Salesforce/Lit-based admin UIs work without the LLM having to remember the `queryDeep` helper exists.

### Added — Ticket FINAL_NOTES auto-formatter
- **`isTicketInvestigationGoal` + `formatTicketFinalNotes`** (`background/agent-engine.js`). When the goal contains ticket markers (`ticket`, `incident`, `alert`, `investigat`, `threat hunt`, `malware`, `sentinelone`, `connectwise`, `kaseya`, or `#NNN`), the agent's `finish` summary is auto-wrapped in the user's preferred FINAL_NOTES template:
  - Ticket # extracted from the goal
  - Action Taken: first 1-2 sentences of the agent's summary
  - Contact Attempt Details: timestamp + step/API call counts
  - Next Step and Time: "None required. Ticket closed." for resolved investigations, or "Manual review required" for partial/extraction-failure cases
  - Ownership Statement: technician name + role + company
  - Full investigation findings appended below
  - Footer: technician contact card (name, title, company, phone, email)
- **`getTechnicianInfo`** (`background/agent-engine.js`). Reads `chrome.storage.local.technicianInfo` for the user's name, title, company, phone, email; falls back to defaults matching the user's preferences (Brandon Goolsby / IT Support Technician / Premier Networx / 706-426-6313 / support@augustaitguys.com).
- **Smart partial-vs-resolved detection** — checks the summary text for "step limit", "extraction failed", "not yet", "incomplete", "manually search" patterns to choose between resolved-ticket framing and waiting/in-progress framing in the Next Step line.

### Implementation notes
- The new platform contexts add about 9.4 KB to the system prompt. To keep token costs bounded, only ONE platform context fires per run (matched by URL + goal text early-exit returns).
- The dynamic step limit is intentionally generous on the upside (+15 per productive action) but capped at 100 to avoid runaway costs on misbehaving runs. Each productive action effectively pays for ~15 steps of additional exploration.
- Shadow-DOM auto-fallback in `extract_list` is wrapped in try/catch and falls silently to the original empty-result behavior on failure — never breaks legacy callers.
- Ticket auto-formatter is opt-in by goal content. Non-ticket goals (research, briefings, navigation tasks) still get the original freeform summary unchanged.
- `manifest.json` bumped `3.7.2` → `3.8.0` (minor bump for the new feature surface area).

## v3.7.2 — 2026-05-08 (Tab Group Attachment & Per-Tab Panel)

Visual + behavioral parity with Claude in Chrome's "agent attaches to its tabs" model. When the agent runs, every tab it operates on becomes part of an orange **Sentinel** tab group — visible as a glowing colored strip above linked tabs in Chrome's tab bar. The side panel only appears on attached tabs; when the user clicks an unrelated tab, the panel hides automatically.

### Added
- **`tabGroups` permission** (`manifest.json`). Required for `chrome.tabGroups.update` so we can label and color the Sentinel group.
- **`attachTabToSentinelGroup` + `detachAllSentinelTabs` helpers** (`background/agent-engine.js`). On agent start, the working tab is grouped under a new orange "Sentinel" group. On `open_tab`, click-opens-new-tab, and `switch_tab`-discovered tabs, each is added to the same group. On agent stop (and at natural loop end), the group is dissolved via `chrome.tabs.ungroup` and module state is reset.
- **`isAgentAttachedTab` / `getAttachedTabIds` exports** (`background/agent-engine.js`). Used by `background/index.js` to check side-panel visibility on tab switches.
- **Per-tab side panel visibility** (`background/index.js`). Replaced the previously-noop `chrome.tabs.onActivated` handler with logic that, while an agent run is in progress, calls `chrome.sidePanel.setOptions({ tabId, enabled: <attached?> })` — the panel only follows the agent's tabs. When no run is in progress, every tab gets the panel back.

### Behavior
- **Tab bar:** when you start a run, the working tab gets an orange `Sentinel` label above it. Any new tabs the agent opens (`open_tab`, `switch_tab`, click-opens-new-tab) join the same group. You can see at a glance which tabs the agent is touching, even if there are 30+ tabs open.
- **Side panel:** while a run is active, click an unrelated tab → the side panel disappears. Click back to a Sentinel-grouped tab → it returns. No more wondering whether the panel is "live" for the tab you're looking at.
- **Stop / completion:** the group dissolves, the side panel is re-enabled globally so you can start a new task on any tab.

### Implementation notes
- Group color is `'orange'` (one of the nine Chrome-defined values: grey, blue, red, yellow, green, pink, purple, cyan, orange) — matches the Sentinel brand color.
- If the user manually drags a tab out of the group, the next attach attempt detects the dissolved group and creates a fresh one. If the user manually closes a grouped tab, no special handling needed — Chrome removes it from the group automatically and our `tab-context.handleTabRemoved` already cleans up the agent-side state.
- The side panel's `setOptions` per-tab calls are wrapped in try/catch because `chrome://` and `edge://` tabs don't support sidePanel options and would throw otherwise.
- `manifest.json` bumped `3.7.1` → `3.7.2`.

## v3.7.1 — 2026-05-08 (Visibility & Awareness)

A focused pass on **what the user sees in the popup while the agent runs**. The cursor / highlight / banner work in v3.6.0 fires on the page tab — but with the side-panel popup, the user is often watching the popup, not the page. This release surfaces in the popup itself.

### Added
- **Active Tab Strip** at the top of the popup chat container. Always visible during a run, hides between runs. Shows:
  - Favicon + hostname of the agent's working tab (Google s2 favicons CDN)
  - Page title
  - `STEP N/M` counter (auto-bumps on each `agent_action`)
  - Plain-English description of the latest action — with color-coded styling (`is-clicking` / `is-typing` / `is-blocked`)
  - **Focus button** that opens the agent's working tab in Chrome and brings its window to the front, so the user can watch cursor + highlights live alongside the popup. (`popup.html`, `popup.css`, `popup-modules/chat.js`)
- **`describeActionPlain` helper** in `popup-modules/chat.js`. Maps every action type (`click`, `type`, `navigate`, `select`, `check`, `hover`, `press_key`, `execute_js`, `extract`, `extract_list`, `read_page`, `read_console_messages`, `read_network_requests`, `wait_for_*`, `open_tab`, `switch_tab`, `close_tab`, `note`, `finish`, `scroll_to`, `dismiss_overlay`, `open_dropdown`, `switch_to_frame`) to a one-line live status with the actual target text and typed value (or `[sensitive — blocked]`).
- **Live mini-screenshot panel** in the popup. Collapsible header (`Agent's view (latest)`); body is the latest base64 JPEG observation rendered at up to 180px tall. Updates every step. Background sends `screenshot_update` messages via the new `sendScreenshotUpdate` helper in `background/message-protocol.js`; `agent-engine.js` calls it from inside the screenshot capture path. (`popup.css`, `popup-modules/chat.js`)

### Changed
- **`sendActionMessage`** (`background/message-protocol.js`) now sends an enriched `agent_action` payload containing the raw command fields (`selector`, `ref`, `url`, `key`, `value`, `label`, `attribute`, `x`, `y`, `amount`, `checked`, `frame_index`, `fields`, `text`, `code`) plus a resolved `targetText` (the visible text of the clicked/hovered element, looked up from the current observation). The popup uses these to render `Clicking "Save"` instead of `Clicking button.btn-primary` — the user sees what the agent sees.
- `text` and `code` are truncated to 200 chars in the payload so large bodies don't bloat the message bus.

### Implementation notes
- The Focus button uses `chrome.tabs.update({active: true})` + `chrome.windows.update({focused: true})` to surface the working tab without changing the agent's tracked active tab. The agent's `tab_state_update` messages let the popup capture the correct `tabId` so the Focus button always targets the right tab even after `switch_tab` or `open_tab` actions.
- Mini-shot panel renders as `<img src="data:image/jpeg;base64,...">` directly from the captured screenshot — no second capture round-trip. Same JPEG already flows to the LLM via the vision channel.
- The strip's `is-clicking` (blue) and `is-typing` (yellow) styling makes the action family scannable at a glance during fast runs.
- `manifest.json` bumped `3.7.0` → `3.7.1`.

## v3.7.0 — 2026-05-08 (Safety, Observability & Cross-Client Guards)

### Added — Safety
- **Sensitive-field protection by label** (`content/index.js`). New `__sentinelCheckSensitiveField` helper walks up to 3 ancestors plus previous siblings and `<label for="id">` references to gather the input's surrounding label text, then matches against a regex covering passwords, passphrases, pre-shared keys, shared secrets, API keys, client secrets, encryption/private keys, recovery/reset/verification codes, CVV/CVC, SSN, credit-card and account/routing numbers, tax IDs, passports. Hard-blocks `case 'type'` AND `case 'focus_element'` (so the CDP trusted-input path can't side-step the synthetic-path guard). Goes far beyond `el.type === 'password'` because most enterprise UIs (SonicWall PSK, M365 admin keys) use plain text inputs.
- **Configuration-change verification gate** (`background/agent-engine.js`). On goals that contain change verbs (`add|create|delete|modify|update|enable|disable|block|allow|configure|grant|revoke|assign|remove|change|deploy|push`) on a known config platform (SonicWall/Fortinet/Cisco/Palo/M365 admin/Entra/Azure/ConnectWise/NinjaOne/Datto/IT Glue/Huntress/ScreenConnect), `finish` is blocked until (a) a click whose target text matches `apply|save|commit|deploy|accept|update|create|delete|publish|submit|confirm|ok` is in the last 12 history entries AND (b) a follow-up `read_page`/`extract`/`extract_list`/`note` confirms the change is reflected. Stops false-positive completions cold — the most common reason a ticket gets reopened.
- **MFA challenge detection + auto-pause** (`background/agent-engine.js` + `popup-modules/chat.js`). On every observation, page text is matched against an MFA-pattern panel (`verify your identity`, `enter the code`, `approve sign-in request`, `6-digit code`, `two-factor`, `multi-factor`, `authenticator app`, `OTP`, `enter your code`, `check your phone`). On match: agent pauses, `chrome.notifications.create` fires a desktop ping, and the popup chat shows a banner with a one-click Resume button. Per-URL acknowledgement so a re-load on the same page doesn't re-prompt.

### Added — Observability (Claude in Chrome parity)
- **`read_console_messages` action** (`background/tab-manager.js` + `background/agent-engine.js`). CDP `Log.entryAdded` + `Runtime.consoleAPICalled` + `Runtime.exceptionThrown` are buffered per-tab on first attach (200-entry ring buffer). Returns `{level, text, url, line, ts}[]` with optional `filter: 'errors'|'warning'`. The break-and-fix tool for diagnosing M365 / Entra / Exchange JS errors and unhandled exceptions that don't surface in the UI.
- **`read_network_requests` action** (`background/tab-manager.js` + `background/agent-engine.js`). CDP `Network.requestWillBeSent` + `Network.responseReceived` + `Network.loadingFailed` are buffered per-tab (200-entry map). Returns `{method, url, status, type, duration_ms, failed, error}[]` with optional `filter: 'failed'|'4xx'|'5xx'` and `url_includes: 'graph.microsoft.com'`. The break-and-fix tool for diagnosing Microsoft Graph / OAuth / SSO callback failures, 4xx/5xx responses that the UI swallows behind generic "something went wrong" toasts.
- Both actions registered in `validTypes` (extractFirstJsonObject + parseLLMResponse) and announced in the system-prompt action list with usage hints.

### Added — Cross-client safety
- **Tenant-lock chip in the popup header** (`popup.html` + `popup.css` + `popup-modules/chat.js`). Auto-detects the current Microsoft tenant from `tid=` URL param, `*.onmicrosoft.com` page references, and known tenant-chip selectors (`[data-automation-id="header-tenant-name"]`, etc. across `admin.microsoft.com`, `entra.microsoft.com`, `portal.azure.com`). Chip shows the detected tenant; turns green when it matches the user's `expectedTenant` setting, red (with a pulsing glow) on mismatch.
- **`expectedTenant` setting** (`popup.html` + `popup-modules/settings.js`). Free-text input in Settings; persisted to `chrome.storage.local`; debounced save. Cross-client mistake guard: a tech can set "acme.onmicrosoft.com" before starting work and the chip alerts them at-a-glance if they're somehow on a different tenant. Career-risk mitigation in MSP land.
- **`detect_tenant` content-script handler** (`content/index.js`). Returns `{tid, onmicrosoft, chipText, hostname, url}` from the live page state.
- **Tenant detection wired into the agent loop** (`background/agent-engine.js`). On any Microsoft URL, agent probes the content script after observation and broadcasts `tenant_detected` to the popup so the chip refreshes mid-run. `expectedTenant` is loaded from storage at agent start.

### Fixed — Hardening
- **`execute_js` content-script fallback hardened** (`content/index.js`). Replaced template-literal interpolation of LLM-emitted code with explicit string concatenation, so backticks or `${...}` sequences in the code can't break out of the wrapper at content-script eval time. Also defensively escapes any `</script>` in the code to `<\/script>` in case the script element is ever HTML-serialized. The CDP `Runtime.evaluate` path remains the production hot-path; this hardens the legacy fallback.

### Removed / Hygiene
- **Audit docs moved to `docs/`** subfolder: `AUDIT_2026-05-06.md`, `REVAMP_2026-05-08.md`, `MSP_TASK_PLAYBOOKS_2026-05-08.md`, `VISUAL_FEEDBACK_AND_AI_PLANNING.md`. Root-level files now show one-line redirects to keep planning docs out of the way for fresh GitHub clones.
- Manifest version bumped `3.6.0` → `3.7.0`.

### Implementation notes
- The sensitive-field regex is intentionally conservative on word boundaries (`\b...\b`) so legitimate fields like "Email Address" or "Search" aren't false-flagged. The check runs before highlight/scroll/focus so the UI doesn't even animate toward a blocked field.
- The config-verification gate uses the action's `text`, `selector`, `ref`, `description`, AND result string when scanning for commit verbs — so it works regardless of whether the click went through the synthetic path (selector-based) or the CDP path (description-based) or `click_at` (result-string based).
- MFA detection samples only the first 5 KB of page text so the per-step latency cost is bounded. The `mfaAckUrl` flag prevents looping pause/resume cycles on the same challenge.
- Console / network buffers attach once per tab (debugger lifecycle reuses the same attachment), so there's no repeated banner flicker even with both observability domains enabled. Buffers self-clean on detach via the existing `chrome.debugger.onDetach` listener.
- The tenant chip's match logic uses bidirectional `String.includes` between the expected and detected values, so partial matches work both ways: setting `expectedTenant: "acme"` matches a detected `acme.onmicrosoft.com`, and `acme.onmicrosoft.com` matches the chip text "Acme Corp" when one is a substring of the other (case-insensitive).

## v3.6.0 — 2026-05-08

### Added — Visible operator experience (parity with Claude in Chrome)
- **Virtual operator cursor** (`content/cursor.js`). A persistent SVG cursor with a glowing halo travels to every action target before the action fires — so users can SEE where the click is going. Pairs with the existing element highlight, click pulse, and action banner. Idempotent across re-injection; auto-hides after 8 s of inactivity. Registered into `CONTENT_SCRIPT_FILES` (`background/tab-manager.js`) and `FRAME_UTILITY_FILES` (`background/frame-router.js`) so it ships into every tab and same-origin iframe.
- **CDP click visual feedback** (G1). `cdpDispatchClick` (`background/tab-manager.js`) now sends a `cdp_pre_click_visual` message ~220 ms before the trusted click, driving the same cursor-move + element-highlight + click-pulse + banner the synthetic path already had. Previously the trusted-input path (used for reCAPTCHA, M365 sign-in, banking) gave zero visual feedback — now it's identical to the synthetic path.
- **CDP typing animation + banner streaming** (G2). `cdpDispatchType` defaults to per-character key dispatch for strings ≤ 40 chars and streams `cdp_typing_progress` updates so the user sees real-time typing. Long strings (URLs, pasted blocks) keep the fast `Input.insertText` path. Honors explicit `perCharKeyEvents: true|false` overrides.
- **`cdp_pre_action_announce`** content-script handler — extension hook point for future CDP-only actions to surface a banner without any visible action.

### Changed
- `click`, `click_at`, `type`, `hover`, `check`, and `scroll_to` action handlers (`content/index.js`) now animate the virtual cursor to the target before the action fires. The cursor's natural ~380 ms travel time replaces the explicit pre-click `humanDelay`, so total action time stays roughly the same but the user can SEE where it's going.
- Click handler triggers `__sentinelCursor.press()` at the same instant the click pulse appears — halo briefly shrinks and tints red.
- Trusted-input branch in `agent-engine.js` now passes a `description` option through to `cdpDispatchClick` so the visual banner shows useful labels (e.g., `Clicking ref_5`, `Clicking [aria-label="Save"]`) instead of generic coordinates.

### Fixed
- **Popup mode-badge first-paint flicker** (`popup.html:22`). The static fallback used to render `YOLO` for a single frame before `chat.js` corrected it to `APPROVAL` — visible on every popup open. Static fallback is now the safe state (`APPROVAL`); JS only changes it if the user has explicitly opted into autonomous mode.

### Removed / Hygiene
- Stray test artifacts `content/__sync_test.tmp` and `content/__bash_sync_test.tmp` are emptied (manual `del` recommended on the user's side; the sandbox file-system used during the audit couldn't remove them outright).
- Manifest version bumped `3.5.1` → `3.6.0`.

### Implementation notes
- The virtual cursor uses CSS `transition: left/top 380ms cubic-bezier(0.4, 0, 0.2, 1)` for a natural ease-in-out glide. Z-index 2147483645 (just below the click pulse and banner so the pulse draws over the cursor at click time).
- Cursor halo color shifts from orange (idle) to red (pressing) — visual continuity with the existing red click pulse.
- Per-char CDP typing has adaptive pacing: ~22-44 ms/char for medium strings, 40-90 ms/char for short strings with occasional 80-160 ms thinking pauses every 6 chars so it reads as a real operator typing rather than a bot.

## v3.5.1 — 2026-05-06 (hotfix)

### Fixed
- `execute_js` was being blocked by strict page CSPs (e.g. drudgereport.com, github.com, banking sites). Now routed through `chrome.debugger` `Runtime.evaluate`, which has elevated privileges and bypasses page CSP. Falls back to the legacy `<script>`-tag injection if CDP attach is denied (chrome:// pages, etc.).
- Bumped `execute_js` content-script fallback timeout from 3s back up to 8s. The 3s default was firing on legitimate slow extracts before the page could even respond.

### Changed
- Added an "ANTI-HALLUCINATION" section to the LLM system prompt forbidding training-data fabrication when extraction fails. Triggered by a real Drudge Report regression where the model invented 15 plausible-sounding headlines after CSP blocked `execute_js`.
- Added an "EXTRACTION STRATEGY ON STRICT-CSP SITES" section telling the model to switch from `execute_js` to `extract_list` / `read_page` / vision after 2 failures.

## v3.5.0 — 2026-05-06

### Added
- ref_id system: `scanDocument` assigns stable `ref_1`, `ref_2`... ids per scan, and all action handlers (click, type, hover, select, check, extract, extract_list, wait_for_element, scroll_to) accept a `ref` field with selector fallback (#10).
- `scroll_to` action with layout-stability await (`waitForStableRect`), so the next step operates on a settled rect — fixes lazy-loaded images and virtualized lists (#10).
- `get_viewport_info` content handler (returns CSS-pixel width/height, scrollX/scrollY, and `devicePixelRatio`) plumbed into `tab-manager.js` for DPR-correct screenshots (#11).
- `get_bbox` and `focus_element` content handlers, used by the trusted-input path to compute click coordinates and ensure focus before CDP key dispatch (#9, #8).
- CDP trusted input as opt-in: `cdpDispatchClick`, `cdpDispatchType`, `cdpDispatchKey` in `background/tab-manager.js`; toggled by the `useTrustedInput` setting in `popup.html` and `settings.js`; routed in `agent-engine.js` for click / click_at / type / press_key (#8, #9).
- `requestId` (UUID) on every `approval_request` from `agent-engine.js`; mirrored back on `approval_response` from `popup-modules/chat.js` so concurrent approvals can no longer cross-contaminate listeners.
- First-run safety banner in the popup explaining approval mode and the limits of the agent.
- DPR-aware screenshot cache shape: `cachedSnapshot = { base64Image, width, height, dpr, scrollX, scrollY, capturedAt }` in `tab-context.js`, with screenshot metadata embedded in the LLM prompt (#11).

### Changed
- Approval mode now defaults to ON for new installs (#4).
- The "YOLO" preset has been renamed to "AUTONOMOUS (caution)" in the UI to make the safety tradeoff explicit (#4).
- Auto-approve timeout now **rejects** after the configured window instead of approving — silent AFK approvals are no longer possible (#5).
- System prompt now contains explicit safety boundaries: prohibited actions list, explicit-permission action list, and prompt-injection guidance (#4, #6).
- `scroll_to`, `navigate`, `click`, `click_at`, `type`, `press_key`, and `scroll` now invalidate the screenshot cache (`cachedSnapshot = null`) before the next perceive step (#10, #11).
- Conversation history is now bounded by `historyWindow` (previously dead code) (#15).

### Fixed
- `actionFailed` TDZ ReferenceError that killed every `wait_for_*` step (#1).
- `agent_memory` is now actually restored from storage at run start instead of just read-and-discarded (#7).
- Vision allowlist: `getModelSupportsVision(providerId, model)` in `provider-registry.js` plus `supportsVision(model, providerHint)` in `llm-client.js` — vision now lights up for known-capable models instead of being dead by default (#2).
- `isActive` invariant on new-tab registration in `tab-context.js` (#17).
- Unbounded history truncation (#15).
- Native `<select>` value setter is now invoked via the prototype descriptor so React/Vue controlled selects update correctly (#24).
- Native checkbox now uses `.click()` instead of assigning `.checked = true`, so framework-bound state actually updates (#25).
- Layout-stability await before click resolves the rect (#19).
- Hover dispatches full Pointer Events sequence (`pointerover`/`pointerenter`/`pointermove`) (#21).
- `findDropdownOptions` is now scoped to the dropdown element instead of `document` (#22).
- `Escape` keypress now sends the full `keydown`/`keypress`/`keyup` sequence with `keyCode: 27` (#23).
- `dismissOverlays` is restrained — only acts on cookie banners and obvious modals; no longer nukes Gmail / Linear / Figma chrome (#14).
- Highlight is applied via a CSS class injected once, not inline style — can no longer corrupt user CSS if removal fails mid-run (#27).
- `frame-router` guards against `frameId === 0` collisions when listing subframes (#13).

### Security
- All page content sent to the LLM is wrapped in `<UNTRUSTED_PAGE_CONTENT>` tags (#6).
- System prompt now defines prohibited and explicit-permission action lists (#4, #6).
- `execute_js` logs a `console.warn` with the script source before running so the user has visibility; the sandbox stays disabled (still runs in MAIN world) but the approval-gate now enforces when approval mode is enabled (#3).
- Removed cookie-banner auto-accept — cookies now go through the standard approval flow.

### Infrastructure
- Closed shadow root patch (`content/shadow-intercept.js`) now runs in `world: "MAIN"` at `document_start` so it patches `attachShadow` before any page script can call it (#12).
- Cross-origin iframe execute handler implemented via `chrome.scripting.executeScript` with explicit `frameIds` (#13).
- `chrome.debugger` attaches **once per agent run** instead of once per screenshot, eliminating the per-step CDP banner flicker.
- Service-worker checkpoint to `chrome.storage.session` every step so a SW termination mid-run can be resumed (#16).
- Manifest bumped to `3.5.0`.
