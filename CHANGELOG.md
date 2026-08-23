# Changelog

## [Unreleased] - report grounding + outbound masking

### Fixed
- **The MSP ticket templates fabricated a technician identity on every fresh install.** `getTechnicianInfo()` fell back to hardcoded placeholders — "John Smith", "IT Support Technician", "Acme IT", "555-000-0000", "support@example.com" — whenever `technicianInfo` was unset. Those went into the ticket's Ownership Statement and into the body of a client-facing email. The settings UI only persists non-empty fields and the old `{...defaults, ...stored}` merge filled the gaps, so a technician who entered just their name still shipped the fake phone and the fake support address to a paying client. Unset fields are now `null` and every formatter renders a visible "not set — configure in Settings" marker. Five existing test suites had assertions pinning the fabricated values (one asserted that "Jane Doe" gets `support@example.com`); they are rewritten to the honest contract.
- **The templates asserted outcomes the agent cannot know.** FINAL_NOTES closed the ticket ("None required. Ticket closed pending client confirmation."); CLIENT_EMAIL's subject said "Resolved:" and its body said "has been resolved" and "Everything is now working as expected"; WAITING_ON_VENDOR claimed "Vendor case opened at <timestamp>"; TICKET_KICKOFF presented a canned three-step ladder unlabelled as *the* fastest safe resolution path. The agent performs read-only investigation — it does not remediate, close tickets, open vendor cases or contact anyone. Each field now states what is true, and CLIENT_EMAIL is marked "DRAFT — do not send unedited" with the status sentence left as an explicit blank.
- **`formatTicketOutput` threw a TypeError on a null/undefined tech object.** The engine wraps that call in a `try/catch` that only `console.warn`s, so ticket formatting was silently skipped and the operator got a bare summary with no explanation. It now degrades to a report naming the missing configuration.
- **`tests/agent-engine-deep.test.js` restored a throwing `chrome.storage` mock on the line *after* its assertion**, so the first failure there cascaded into 13 unrelated `saveLearnedPattern` failures. Moved into a `finally`.

### Added
- **`background/report-grounding.js`** — a runtime auditor wired into the finish path. The templates no longer fabricate, but the model's own summary flows through them verbatim and can still invent a contact address or assert an outcome. It builds a corpus of what the agent actually observed (page text, extracted memory, action results, the goal, plus the operator's configured identity — a technician's own phone is legitimately not on the page) and flags emails, phone numbers, retired placeholder values and unsupported outcome assertions it cannot tie back to that corpus, appending a visible "⚠️ UNVERIFIED DETAILS — review before sending" block. An outcome the *page* stated ("Status: Resolved") is grounded and passes clean — this is not blanket censorship. `tests/report-fabrication.test.js`, 49 tests.
- **`background/egress-scrub.js` — outbound masking before any cloud egress.** This tool reads a client's ticket system, billing portal or admin console and ships that text to a cloud model; the LLM path had no protection whatsoever (`_sanitizeHistory()` only strips screenshot blobs, and telemetry's `_redactString` is module-private and only ran on telemetry). Credentials (PEM blocks, Anthropic/OpenAI/AWS/Google/GitHub/Slack/Stripe key shapes, JWTs, `Authorization` and `Cookie` headers, password/secret/api_key assignments) and PII (emails, phones, SSNs, Luhn-valid cards) become stable placeholders — `[[SECRET-1]]`, `[[EMAIL-2]]` — that hold for the whole run, so the model can still reason about "the email in the ticket"; `llm-retry.js` restores the real value in the returned command before the agent acts. Wired at **one** chokepoint, immediately after `buildAgentPrompt()`, where every field is already assembled. Run-scoped and reset per run so a token from one client's ticket cannot resolve against another's. Scrub failure **blocks** the request rather than sending raw.
- **Destination policy** (`egressScrubMode`, default `cloud`): cloud providers scrubbed, self-hosted models on localhost/RFC1918/tailnet/`*.local` left raw, `always` scrubs everything, `off` disables. An unknown or unparseable endpoint fails safe.
- **Screenshot field masking** (`maskScreenshotFields`, default on): `takeScreenshot()` covers password/CVV/SSN/API-key fields before capture and uncovers them on every exit path, reusing the existing `__sentinelCheckSensitiveField()` detector.
- **Settings → "Privacy & Data Protection"** exposes both controls, with a warning toast when masking is turned off.
- `tests/egress-scrub.test.js`, 65 tests — including wire tests proving a planted key, email, phone and card are absent from the real outbound request body on the openai, anthropic and zai paths.

### Notes
- **Over-masking is an outage, not a safety win** — half the scrub suite asserts the opposite direction. Git SHAs (full and short), UUIDs, semver, ISO timestamps, `host:port`, byte counts, sha256 digests, order ids, ticket ids, CIDR ranges, file paths and CSS selectors all survive byte-identical. Three pattern bugs were caught this way while writing them: the Google-key pattern could never match a real 39-char key; a semver guard swallowed every dot-separated phone number; a hex guard swallowed every separator-free card number.
- **Screenshot limitation, stated rather than implied away:** a screenshot cannot be text-scrubbed. Anything else visible — an open password manager, a client record, another window in view — still reaches the vision model as-is. The settings UI says so.
- Test fixtures for the scrubber are assembled at runtime from fragments rather than written as credential-shaped literals. The pre-commit secret hook correctly blocked the first version of that commit: one fixture used as "realistic" was the live GitHub PAT from this repo's former origin URL.

## [Unreleased] - execute_js sandbox repair, vision payload, keyless providers

### Fixed
- **The execute_js runtime sandbox never ran.** The injected wrapper opened with `"use strict";` and its body is `with(__wp) { with(__dp) { … } }`. `with` is a SyntaxError in strict mode, so the whole inline script failed to compile, nothing executed, nothing posted back, and every sandboxed `execute_js` sat until the 8s timeout and returned "Code execution timed out (8000ms)". The content-script path is the fallback used whenever CDP `Runtime.evaluate` is unavailable (debugger denied, another debugger attached), so that fallback was dead. Strictness moved onto the inner user-code function, where it still denies user code a `this` of globalThis but leaves the enclosing `with` legal.
- **The sandbox deny list was inverted.** Both proxies returned `false` from the `has` trap for blocked names, commented "so `in`-checks see 'not present'". Inside a `with` scope `false` means "this scope does not have it", so the engine walked out to the real global object and returned the real `fetch` / `localStorage` / `chrome` / `eval`. The deny list made those APIs no harder to reach than having no sandbox at all. `has` now returns `true` so the `get` trap fires and throws.
- **`document.cookie` was never blocked** — the headline example in the sandbox's own comments. Bare `document` resolved through the *window* proxy (`'document' in window` is true), which handed back the real document untouched. The window proxy now returns the document proxy for that key. The old `var document = __dp;` could not have worked either: inside `with(__wp)` that assignment targeted `window.document`, an accessor with no setter, and was silently discarded.
- **A screenshot was re-sent to a text-only model on every step.** `_useVision` never consulted `agentState.visionDegraded` — the flag the 400 handler sets thirty lines later to "mark the run blind" — and `agentState` is rebuilt from scratch each iteration, so the flag died at the end of the step that set it. A live run against LongCat-2.0-nonthink showed a rejected ~57KB image upload followed by a text-only retry on *every* step: two requests, two rate-limiter slots and two `apiCallCount` increments per step, all run. Same task after the fix: 10 AI calls → 6, image requests 5 → 1.
- **`supportsVision()` said no to real vision models.** `/\bqwen[\w.-]*-vl\b/` required a dash before "vl", so `qwen2.5vl:7b` — the stock ollama tag — was classed text-only, as was `vl-7b-dspark`. Those models were told in their own system prompt that they could not see. Widened to cover dash-less qwen VL tags, a leading `vl-` segment, `internvl`, `minicpm-v`, `pixtral` and `moondream`; the `-text-only` deny suffix still overrides.
- **Every keyless self-hosted provider was unusable.** Seven catalog entries are declared `auth: 'none'` (ollama, LM Studio, KoboldCpp, vLLM, …) but `callLLM` and `callLLMSimple` opened with a bare `if (!apiKey) throw`, so they all failed with "No API key configured" before the provider's own optional-auth header builder ran. New `providerRequiresApiKey(id, endpoint)` exempts `auth: 'none'` entries and loopback / RFC1918 / tailnet / `*.local` endpoints; a public endpoint with no key still fails loudly. The openai header builder no longer sends a meaningless `Authorization: Bearer ` for an empty key.
- **`scripts/uap-server.js` bound port 8766 as an import side effect** and called `process.exit(1)` on EADDRINUSE. `tests/federation-remote.test.js` imports it for its `fedPeers` / `fedJobs` registries, so on any machine with something already on 8766 the Jest worker was killed outright — the single failing suite in `npm run check`. Startup now lives behind an `isMainModule()` guard, exposed as `startServer()`.
- **`UAP_PORT` was silently ignored.** `parseInt(env.UAP_PORT || argv.find(a => a === '--port') ? argv[idx+1] : '', 10)` parses as `parseInt((A || B) ? C : '')`, so setting the env var took the `--port` branch, `indexOf('--port')` returned -1, `argv[0]` (the node binary path) was parsed, and the NaN fell through to the default. Replaced by a unit-tested `resolvePort()` with env > flag > default precedence and range validation.

### Added
- `content/execute-js-sandbox.js` — the injected-wrapper builders and the two deny lists, extracted from `content/index.js` so the generated source can be unit-tested by actually running it. Carries an explicit THREAT MODEL note: this is a guard-rail against a mistaken LLM, not a boundary against hostile code (reflective escapes such as `({}).constructor.constructor` are not blocked here; the approval gate and the static privileged-API regex are the real controls). Injected before `content/index.js`; `execute_js` now fails **closed** if the module is missing rather than silently running with full page privileges.
- **Injected-script failure detection.** A window `error` listener spans the synchronous `appendChild` of the injected `<script>`, so a wrapper that fails to parse reports "execute_js wrapper failed to run: …" instead of burning the full timeout. This is the detector that would have caught the `"use strict"` regression in production.
- `tests/live/agent-live-smoke.test.js` + `npm run test:live` — a live end-to-end smoke test that drives the REAL `runAgentLoop`, prompt builder, llm-client and response parser against a real model and a simulated MSP helpdesk, with a wire recorder that logs every HTTP request (endpoint, model, whether an image part was attached, status, latency). Excluded from `npm test` / `npm run check` via a separate `jest.live.config.js`, so the gate stays hermetic. Every vision/payload defect above was found by reading its wire log.
- `tests/content-execute-js-sandbox.test.js` (42), `tests/llm-client-vision-payload.test.js` (40), `tests/uap-server-bootstrap.test.js` (15).

### Removed
- `_EXECUTE_JS_ALLOWED_GLOBALS` (30 entries, never read — the sandbox is deny-list based) and two dead `__blockedApisArr` / `__blockedDocArr` computations in `content/index.js`.

### Notes
- Sandboxed user code is now strict-mode, so an assignment to an undeclared identifier throws `ReferenceError` instead of creating a page global. That was the stated intent of the previous hardening commit; it is now actually in force.
- Observed live and NOT changed: with an MSP report goal the model fills the structured-report template with invented specifics (a fabricated technician name, "Ticket closed pending client confirmation") alongside the correctly-extracted data. That is a prompt/report-template problem, not a loop bug, and needs its own change.

## [Unreleased] - 2026-08-23 upgrade day: dashboard fixes + mechanical XSS gate

### Added
- **`scripts/check-html-injection.cjs`** — AST-based gate (via `@babel/parser`) that fails `npm run test:web` if any `web/` HTML sink (`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, inline or standalone script) receives an expression it cannot prove inert: literals, `escHtml()`/`escAttr()` calls, `Math`/`Number` results, safe compositions, never-reassigned consts with safe initializers, `map(fn).join()` with safe returns. Every XSS this project shipped was an unescaped interpolation into `innerHTML`; the rule is now mechanical instead of disciplinary. 8 jest tests prove both directions. 16 sinks currently checked, 0 unsafe.
- **`lib/report-sanitize.js`** — the ONE copy of `sanitizeReportHtml`, previously hand-duplicated in `report-view.js` and `report-print.js` (drift between two copies of a security function is a one-page-only XSS waiting to fire). Loaded by both report pages before their page script; 8 jest tests pin strip behavior plus drift guards against private forks and wrong load order.

### Added (2)
- **HTML-injection gate now covers the whole repo.** `check-html-injection.cjs` extended from `web/` to `popup-modules/`, `content/`, and the root popup/report pages — 157 sinks proven safe, 0 exceptions. The prover grew sound compositional rules (safe-write `let`s, literal lookup tables, `.map/.filter/.join` pipelines, numeric/date formatters, escape aliases, IIFEs) and its failures now name the exact unproven interpolation. 45 initially-unproven sinks were triaged: most were hardened with `escapeHtml()`/`Number()` wraps so safety is locally evident; `setResponseHTML(rawHtml)` in quick-assist was replaced with a DOM-built `setResponseError(message)`.

- **`npm run routes:sync`** — one-command heal for route-manifest drift: regenerates `contract/server-routes.json` and commits it if changed (never pushes). `routes:check` now says when a stale table is metadata-only drift (source lines moved, route set unchanged) instead of printing a bare FAIL.

- **Scope-aware injection prover.** The checker resolves names through real lexical scope chains (function granularity); parameters, destructuring targets and catch params bind opaque. Fixes both defects of the old file-global map: same-named locals in different functions no longer cross-contaminate (no more prover-driven renames), and a parameter can no longer be wrongly proven via a same-named safe outer const.
- **DOM regression tests for the hardened sinks** (linkedom/vm): chat stepNumber coercion (numeric, numeric-string, hostile), scheduler card adversarial fields, action-hud step coercion, typing-banner single-escape. The quick-assist markdown tests were also repointed at the REAL renderMarkdown — they previously asserted a hand-copied version, which is how the double-escape bug stayed invisible.

### Fixed (2)
- **quick-assist markdown double-escape**: `renderMarkdown` escaped its input via `escapeHtml` and then re-escaped `&<>` a second time, so `<` in AI responses displayed as the literal text `&lt;`.
- **Typing-banner double-escape** (`content/index.js`): the preview string was escaped at build AND at use; special characters in typed text displayed as entity text.
- **Run-log rows escaped only `<`** (`chat.js`): the goal text now goes through full `escapeHtml` instead of a lone `<` replace.

### Fixed
- **Prime dashboard: Escape now cancels inline conversation rename.** The input saved on blur, and Escape triggered a re-render that removed the focused input — firing blur and PATCHing the value the user asked to discard.
- **Prime dashboard: conversation rail keyboard support.** Group headers declared `role="button"`/`tabindex="0"` but only handled click (Enter/Space now toggle, including the dynamic pinned group); the pinned group's saved collapse state was dropped every reload (created after `loadGroupState()` ran); the conversation context menu (`role="menu"`) closes on Escape.
- **`report-print.js`: raw error text concatenated into `innerHTML`** on the failure path (report-view escaped the same message). Now built through the DOM with `textContent`.

### Changed
- `contract/server-routes.json` re-extracted after upgrade-day commits landed in neuralis and sentinel-prime-premium (540 routes / 3 servers; `routes:check` current, contract holds 57/57).
- `dashboard.js`: render-local `goal` const renamed `goalCell` (cross-scope name collision with the user-input `goal`).

## [Unreleased] - runAgentLoop state machine (#45)

### Added
- **`background/agent-loop-machine.js`** — the explicit state machine behind `runAgentLoop`, plus the pure per-phase decision logic lifted verbatim out of the loop body (`computeStepBudget`, `partitionElements`, `buildLoopDirective`, `escalateCircuitBreaker`, `buildPromptHistory`, `mapVisionAction`, `cleanFinishMemory`). 112 unit tests — the first direct coverage this logic has ever had; previously it was reachable only through a full multi-step integration run.
- **`LOOP_PHASE`** names the 12 states one iteration already moved through (PREFLIGHT, ACQUIRE_TAB, OBSERVE, INTERRUPT, DIRECTIVES, THINK, PREPROCESS, DISPATCH, ACT, VERIFY, CHECKPOINT, FINALIZE). **`LOOP_EXIT`** names all 21 terminals, enumerated from every `break` in the loop plus the loop-condition exit — turning anonymous control flow into a closed, testable alphabet.
- **Per-run phase trace + named terminal.** `getLoopMachineSnapshot()` reports which phases each step touched and which terminal ended the run; one `tel.info('lifecycle', 'Agent loop exited: <reason>')` is emitted at finalize. A run that stops early now leaves a machine-readable record of why, not just a prose summary aimed at the user.
- **`tests/agent-loop-characterisation.test.js`** (46 tests) — the first tests to drive real iterations of `runAgentLoop`. The existing loop-path suite mocks `getActiveTabId()` to null, so the loop exited at "No active tab" before the step body ever ran, which is why `agent-engine.js` sat at 29.8% statement / 21.0% branch coverage despite 10,478 passing tests. These pin the ugly exits (step-ceiling exhaustion, the no-LLM-call abort, tab loss, stop-mid-run, the PR #61 prose announce-loop guard, circuit-breaker force-finish, `click_at` guards, the finish gates) through the loop's observable surface only, so they survive further restructuring.

### Changed
- `runAgentLoop` calls the extracted helpers instead of seven inline copies of the same logic. Behaviour-preserving by construction: each block was moved verbatim and the instrumentation is 41 pure additions (11 `enter()`, 1 `beginStep()`, 26 `exit()`, 1 `finalize()`) with no existing statement moved, reordered or removed. `runAgentLoop` 4,950 → 4,792 lines; `agent-engine.js` 6,929 → 6,778.

### Notes (found, deliberately NOT changed — each is a behaviour change, not a refactor)
- **The prose-loop guard's `nudge` branch is a no-op.** `proseLoopVerdict()` returning `nudge` pushes a corrective SYSTEM note onto `promptHistory`, but the guard runs *after* that step's LLM call and `promptHistory` is rebuilt from `history` at the top of every iteration — so the note never reaches the model. Only the third-reply abort has any effect. Pinned by test.
- **`LOOP_EXIT.VISION_PAYLOAD_SERIALIZATION`**: the `break` commented "Exit vision mode on serialization failure" has the main `while` as its nearest enclosing loop, so it ends the whole run rather than falling through to the legacy LLM path.
- **The Z.ai content-safety (code 1301) handler is dead code.** In `agent-engine.js` an entire `if (_vErr && /1301|.../.test(...))` block sits *inside* an unterminated `console.warn(\`...\`)` template literal, so it is part of the warning string and never executes. `_consecutiveContentSafetyErrors` is therefore never incremented by it.
- **The `!agentRunning` check at the top of the loop body is unreachable** — the `while (!finished && agentRunning)` condition is evaluated immediately before it with no intervening await.


## [Unreleased] - Agent loop guard

### Fixed
- **Announce-loop with reasoning models (LongCat-2.0, observed live 2026-08-03)**: a model that narrates ("Let me update the domain config:") without emitting an action JSON had its prose preserved as a `Parse error (will retry)` note (v20.2) — but nothing broke the cycle, so the model saw its own announcement in history and repeated it verbatim until the step cap (~80 wasted LLM calls). New `proseLoopVerdict()` (pure, in `agent-loop-helpers.js`, 8 tests) tracks consecutive identical no-action prose: 1st repeat injects a corrective SYSTEM note ("respond with exactly ONE action JSON"), 3rd identical reply stops the run early with a clear report, mirroring the stuck-click watchdog. Transient notes (e.g. API failures) neither advance nor reset the streak, so flaky-network runs still trip the guard.

## [Unreleased] - Web dashboards v9

### Added
- `web/dashboard-prime.html` — the Sentinel Prime Dashboard, previously untracked at `C:\Users\Administrator\dashboard-v8.html`, now under version control alongside `web/dashboard.html`
- `web/lib/dash-escape.js` — shared, tested escaping + `data:` URI validation helpers for both dashboards
- Neuralis brain panel in the Prime dashboard, live from the brain API on `:8001` (`/health`, `/brain/stats`, `/brain/diagnostics`)
- `scripts/check-web-dashboards.cjs` + `npm run test:web` + a CI "Web Dashboard Load Gate" step: parses every `web/*.html`, compiles each inline script, and verifies the element ids the scripts drive exist
- `tests/web-dash-escape.test.js` and `tests/web-dashboard-prime-load.test.js` (55 tests)

### Fixed
- **XSS in the Prime dashboard sanitizer**: `esc()` was `textContent`-then-`innerHTML`, which escapes only `& < >`. It was used inside double-quoted HTML attributes and inside single-quoted JS string literals in `onclick=` handlers, where it neutralised nothing. Replaced with `escHtml`/`escAttr` (also escapes `"`, `'`, backtick) and every JS-code-context call site converted to `addEventListener` + closures
- **XSS in the Prime file viewer**: `data_uri` from the file-content API went into `<img src="${...}">` with no escaping or validation; now validated as a base64 raster data URI (SVG rejected) and assigned through the DOM
- **XSS in `web/dashboard.js`**: agent-run `goal` and web-learned playbook `platform` / `goalKey` were interpolated raw into `innerHTML`
- Composer could wedge permanently: the message-save `fetch` in `sendMsg()` sat outside any try/catch, so a network blip left `streaming = true` with Run hidden and the send button disabled until reload. UI reset now lives in `finally`
- Brain Lab panel never worked: it parsed the response then ignored it, hardcoded the version, and only wrote Neurons/Synapses/Regions in the `catch`
- Unbounded DOM growth in `#msgs` from `appendMsg` and every inbound WebSocket message
- Error messages rendered with assistant styling, so failures looked like model replies; they now have their own `.msg.e` style
- `openConv` depended on the non-standard implicit global `event`
- `web/dashboard.js`: no `res.ok` check before `res.json()`, no timeout on the fetch fallback, a `setInterval` that was never cleared and could overlap indefinitely, and blocking `alert()` error UX

### Changed
- Prime dashboard version strings bumped to v9
- All dashboard requests go through a helper that always applies a timeout and an explicit `res.ok` check, and distinguishes 503 ("reachable but unhealthy", per fleet convention) from unreachable


## [21.6.76] - 2026-07-02

### Added
- Report Generator Overhaul: route reports to TEXT provider (LongCat) when available, shorten report prompt ~60%, increase history truncation 150-400 chars, increase memory summary 3000-4000 chars, add _formatFallbackReport for clean markdown fallbacks
- Enhanced Auto-Extract: auto-extract page content on first click block (not just click_at)
- click vs click_at Fix: instant-finish now catches click (not just click_at) when data exists in memory

### Changed
- 50-iteration flow improvements across agent loop


## [21.6.75] - 2026-07-02

### Fixed
- Report Timeout: increased to 120s to prevent premature timeout
- Instant-Finish on click_at: now triggers when click_at has data in memory


## [21.6.74] - 2026-07-02

### Fixed
- Nuclear Fix: click with no index auto-converts to execute_js to prevent undefined coordinate crashes


## [21.6.73] - 2026-07-02

### Fixed
- Ban click_at in Vision Prompt: auto-convert click_at to click in vision output


## [21.6.72] - 2026-07-02

### Added
- Auto-Extract on First click_at: automatically extract page content when first click_at block is encountered


## [21.6.71] - 2026-07-02

### Fixed
- click_at Force-Finish Guard: prevents infinite loops on click_at actions
- Report Memory: truncated to 3000 chars to reduce token usage


## [21.6.70] - 2026-07-02

### Added
- Local Model Presets: support for Ollama, LM Studio, and vLLM as text providers
- Report Truncation Fix: prevents oversized report generation


## [21.6.69] - 2026-07-02

### Added
- Text Provider API Key Field: separate API key input for dual-provider setup


## [21.6.68] - 2026-07-02

### Added
- Parallel Dual-Provider Architecture: vision and text providers fire simultaneously


## [21.6.67] - 2026-07-02

### Fixed
- Vision Parser Format Mismatch: fixed parsing discrepancies between vision and text provider outputs
- Console Noise Reduction: reduced unnecessary console output


## [21.6.66] - 2026-07-02

### Fixed
- HOTFIX: fixed 3 runtime ReferenceErrors from v21.6.65
- Added safety guards for LongCat provider configuration


## [21.6.65] - 2026-07-02

### Fixed
- HOTFIX: moved LongCat inside PROVIDERS object (scope fix)


## [21.6.64] - 2026-07-02

### Added
- LongCat AI Provider: added LongCat-2.0 as a provider option


## [21.6.63] - 2026-07-02

### Fixed
- All Remaining Test Failures: cleaned up empty catch blocks, fixed 3 pre-existing test failures


## [21.6.62] - 2026-07-02

### Fixed
- Test Regressions: fixed all test failures introduced during optimization rounds


## [21.6.61] - 2026-07-02

### Changed
- Round 3 Optimization: removed 8 dead functions


## [21.6.60] - 2026-07-02

### Changed
- Round 2 Efficiency: CSS optimization, import consolidation, dead code removal


## [21.6.59] - 2026-07-02

### Changed
- 100-Iteration Efficiency Loop: systematic performance improvements


## [21.6.58] - 2026-07-02

### Added
- 50-Iteration Improvement Loop: page-type detection, progressive summarizer, output schema compliance, budget awareness
- 5 new test files


## [21.6.57] - 2026-07-02

### Fixed
- 100-Iteration Hardening Sweep: 27 try/catch wraps, 12 JSON.parse guards, 1 XSS fix, error handling


## [21.6.56] - 2026-07-01

### Fixed
- Orchestrator Threshold: adjusted 300-200 for better multi-task handling
- Analysis-Aware Auto-Finish: smarter completion detection


## [21.6.55] - 2026-06-30

### Fixed
- Z.ai Content Safety: capped observation text to 12K max, detect error code 1301


## [21.6.54] - 2026-06-29

### Added
- Adaptive Intelligence: failure diagnosis system + cross-run domain learning


## [21.6.53] - 2026-06-29

### Added
- Multi-Task Orchestrator: click_at guard, cursor hider, iframe extraction for MS portals


## [21.6.52] - 2026-06-29

### Fixed
- Hard Block click_at: prevents execution with undefined coordinates


## [21.6.51] - 2026-06-29

### Added
- Cursor Hider: CDP CSS injection to hide cursor during automation
- iframe Extraction: support for MS portal iframe content


## [21.6.50] - 2026-06-29

### Fixed
- Tab Scoping: per-tab setOptions for MV3 isolation
- MV3 Compliance: converted all dynamic import() to static imports


## [21.6.49] - 2026-06-29

### Fixed
- SPA Code Crash: guard against tabInfo.url undefined
- Navigate-only fallback for SPA timing issues


## [21.6.48] - 2026-06-29

### Fixed
- Double Cursor: fixed duplicate cursor in MS portals
- SPA Timing: improved wait logic for single-page applications
- Auto-Finish Threshold: adjusted for SPA-heavy workflows


## [21.6.47] - 2026-06-29

### Fixed
- EMERGENCY FIX: side panel open regression causing UI lockup


## [21.6.46] - 2026-06-29

### Added
- 4 MSP Templates: SonicWall, Microsoft Exchange, Microsoft Entra, CISA KEV
- Test coverage for cert detection and MSP templates




## [21.6.45] - 2026-06-28

### Added
- **SSL Cert Warning Auto-Bypass** — Critical for SonicWall/firewall MSP work. When agent detects cert error pages ("Privacy error", "not private", "NET::ERR_CERT"), it automatically bypasses via CDP `Security.setIgnoreCertificateErrors` and re-navigates. No more getting stuck on self-signed cert interstitials.

### Fixed
- Clipboard promise rejections — Added .catch() to all navigator.clipboard.writeText() calls in chat.js.


## [21.6.44] - 2026-06-28

### Fixed
- **Critical: execute_js auto-finish report loss** — Auto-finish block referenced undefined `_va` variable and never called `captureReportData()`, causing reports to be lost when duplicate detection triggered. Now properly captures report data before finishing.
- **Circuit breaker modernization** — Replaced `var` declarations with `const` in circuit breaker force-finish block.
- **5 unguarded chrome.* API calls** — Wrapped `chrome.storage.local.set`, `chrome.tabs.create`, and `chrome.tabs.group` calls in try/catch to prevent silent service worker crashes.
- **Activity feed test** — Updated test to match v21.6.25+ collapsed-by-default UI behavior.

### Changed
- Side panel tab scoping: Manual toggle with proper `userPanelTabId` tracking.
- `openPanelOnActionClick: false` so `action.onClicked` fires correctly.
- Added `Ctrl+Shift+S` keyboard shortcut to toggle/reopen side panel.

## v21.6.1 — Overnight Audit Fixes (9 Bugs Fixed)

Critical audit caught 9 bugs in v21.6.0 that would have caused silent failures. All fixed.

### 🚨 SHOWSTOPPER (Critical)

- **All 13 message handlers missing**: Python replace scripts had a logic bug — checked if handler was missing, then tried to replace it (which no-op'd). Every new feature (sessions, undo, gist, proxy, export) would have thrown 'Unknown action'. Now all 13 handlers are correctly inserted before the default case.

### Bug Fixes

- **proxy-manager.js**: Removed dead auth variable — Chrome MV3 chrome.proxy.settings does NOT support inline auth. Added documentation that authenticated proxies require separate onAuthRequired listener
- **llm-retry.js**: Added _triedModels Set to prevent infinite model cycling when all free vision models hit rate limits simultaneously
- **shadow-intercept.js**: Removed fake plugins array [1,2,3,4,5] — bare numbers break detection libraries expecting plugin.name/plugin.filename. Left plugins alone (Chrome with extensions has real PluginArray)
- **tab-manager.js**: Added OOM fallback for captureBeyondViewport — huge pages now fall back to viewport-only capture instead of crashing
- **tab-manager.js**: Fixed stray 'n' character on line 993 from Python replacement escaping issue
- **session-manager.js**: Fixed cookie URL protocol — now respects cookie.secure flag instead of hardcoding https://
- **telemetry-panel.js**: Fixed literal 
 in button HTML (rendered as visible text between buttons)
- **telemetry-panel.js**: Removed duplicate event listener wiring (handler fired twice per click)
- **telemetry-panel.js**: Replaced nonexistent _showToast calls with console.log/warn

### New Test Coverage

- tests/session-manager.test.js: 11 tests covering save/restore/list/delete session
- tests/proxy-manager.test.js: 6 tests covering set/clear/get/list proxy configs

### Verification

- 133 files syntax-checked, 0 errors
- 507 imports resolved
- 13/13 message handlers verified present
- 10,249 tests passing (up from 10,232), 0 failures

# Changelog

## v21.6.0 — MSP Workflow Features

- **Per-client memory isolation**: agentMemory now namespaces by expectedTenant — data from Client A can no longer bleed into Client B's context. Auto-saves on run reset, restores on next run for same tenant (1-hour TTL).
- **Keyboard shortcut**: Ctrl+Shift+S toggles the side panel (added _execute_action command to manifest)
- **Provider-aware cost tracking**: Replaced flat $0.000003/token rate with estimateCostUsd() — now uses real per-model pricing tables (Claude, GPT-4o, Gemini, etc.) for accurate cost tracking across all providers
- **Run history export**: New Export button in telemetry panel downloads all past runs as JSON with goals, steps, token usage, and costs — for billing and time tracking
- **Vision model enforcement**: Non-vision models are detected and blocked at run start with clear error message (from v21.5.13)

# Changelog

## v21.5.8 — Security Hardening

- Fixed 2 XSS vectors in `content/index.js` — innerHTML calls now use `escapeHtml()` for label and typing preview
- Verified `quick-assist.js` raw HTML path is safe — callers pre-escape all input

## v21.5.7 — Console Cleanup

- Removed 60 `console.log` calls across 9 files
- Downgraded 7 lifecycle logs to `console.debug()` / `console.warn()`
- Reduced console noise by 13% (60/521 calls eliminated)

## v21.5.6 — Error Handling Hardening

- Guarded 6 unguarded `await chrome.*` API calls in try/catch:
  - `telemetry.js`: `chrome.storage.local.set`
  - `index.js`: `chrome.storage.session.remove` (×2), `chrome.tabs.update`
  - `tab-manager.js`: `chrome.debugger.attach`, `chrome.debugger.sendCommand`
- Added global `unhandledrejection` event guards to `index.js` and `ws-bridge.js` (SW context only, skips test envs)

## v21.5.5 — Dead Code Cleanup

- Removed 33 unused imports across 8 files
- 0 dead files found
- All exports verified as used (no dead exports)

## v21.5.4 — Agent Tab Auto-Close

- Agent-opened tabs now auto-close when the run finishes
- Added `closeAttachedTabsExceptPrimary()` — closes all agent-attached tabs except the primary (user's) tab
- Called before `detachAllSentinelTabs()` in both stop and natural completion paths

## v21.5.3 — Side Panel Tab Scoping Fix

- Extension no longer shows the side panel on non-agent tabs
- Removed 4 global-enable paths:
  - Startup global default → `enabled: false`
  - `onActivated` handler → skips enable when no agent running
  - `detachAllSentinelTabs()` → no longer globally re-enables
  - `_enableSidePanelEverywhere()` → converted to no-op

## v21.5.2 — CI/CD Pipeline Verified

- First fully auto-released version (all 10 CI steps green)
- Auto-release workflow: tests → build ZIP → create GitHub release with asset

## v21.5.1 — CRITICAL HOTFIX: Service Worker Crash

- Replaced bare `import { v4 as uuidv4 } from 'uuid'` with native `crypto.randomUUID()`
- Affected: `uap-server.js`, `federation.js`
- Bare imports crash Chrome MV3 service workers (no Node.js module resolution)
- Comprehensive bare import scan added to CI pipeline

## v21.5.0 — Streaming LLM Display + Cross-Origin Iframe Support

- **Live streaming token display** — Partial AI responses stream to popup UI in real-time (200ms throttle)
- SSE accumulators (`_openaiStreamAcc`, `_anthropicStreamAcc`) expose `getPartial()` for live token extraction
- `onStreamChunk` callback wired from agent loop through `_readSSEToData` to popup message bus
- Cross-origin iframe support verified — `frame-router.js` uses `chrome.webNavigation.getAllFrames` + `chrome.scripting.executeScript` with `frameIds`

## v21.4.0 — CDP Trusted Input + Prompt Injection Defense

- CDP click/type/select fallback now fires after ANY action failure (was gated behind `cdpFallbackActive`)
- Prompt injection regex pre-check detects "ignore previous instructions", "DAN", "jailbreak" patterns
- Comprehensive audit: 11 of 13 remaining items verified already fixed in prior versions

## v21.3.1 — Tab Scoping

- Extension no longer auto-injects scripts into ALL tabs
- Removed static `content_scripts` block from manifest (highlight/cursor/quick-assist)
- Quick Assist now injects on-demand via context menu `chrome.scripting.executeScript`

## v21.3.0 — Agent Loop Circuit Breaker + Vision Parser Hardening

- **New module: `agent-circuit-breaker.js`** (193 lines, 21 tests)
  - `ABSOLUTE_MAX_STEPS = 150` hard ceiling (productiveSteps bumps can't override)
  - Identical-action detection (same selector + type 3× → forces strategy shift)
  - Repeated target click detection (same element 3× in 8-step window)
  - High failure rate detection (70%+ failures → warning directive)
  - Stale page detection (page unchanged 4+ steps despite actions)
- **Vision parser hardened** for GLM-4V/DeepSeek edge cases:
  - Unclosed `<think>` blocks (truncated at max_tokens)
  - Raw unescaped newlines inside JSON string values
  - Unclosed markdown code fences
  - Ultra last-ditch regex extraction for nested action objects
- **Auth-wall detection expanded** for Microsoft Teams Admin:
  - Hosts: `admin.teams.microsoft.com`, `admin.microsoft.com`, `login.partner.microsoft.com`
  - Consent/account-picker detection: "Pick an account", "Admin consent required"
  - OAuth2 consent flow URL patterns
- **Provider-aware 429 retry** — GLM/DeepSeek: 2× delay multiplier, free/OpenRouter: 1.5×, Claude/OpenAI: 1.0×

