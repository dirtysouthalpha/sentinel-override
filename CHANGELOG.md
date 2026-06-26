# Changelog

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

