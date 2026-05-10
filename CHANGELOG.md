# Changelog

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
