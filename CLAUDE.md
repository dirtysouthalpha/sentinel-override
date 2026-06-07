# Sentinel Override — Priority Bug Fix Grind

## CRITICAL: These are REAL bugs reported by the user on the LIVE extension. Fix them ALL.

## Bug #1: Agent completes with 0 API calls
**Status: FIXED** (2026-05-24 — commits `c4d1d3a`, `3ef74f5`, `b51ca30`, `25952c8`)
Four spin-loop paths that prevented callLLM from firing were all addressed:
1. `about:blank` treated as restricted page → added to `_isNewTab` allowlist
2. Injection failure → `consecutiveInjectionFailures` counter added; after 3 fails, proceeds to LLM
3. Observe fails after 3 injection failures → removed conditional continue, uses empty observation
4. Injection succeeds but observe fails → removed the counter-gated `continue` entirely from the observe catch block

## Bug #2: generatePlan returns prose not JSON for Z.AI
**Status: FIXED** (2026-05-24 — commit `63dd5c2`) · **SPOT-CHECKED 2026-06-07 ✅**
- `response_format` is only sent to `api.openai.com`; Z.AI endpoint never gets it
- 5-strategy fallback parse chain handles prose/numbered/bulleted responses
- Regression tests added in `d5d2891`

**If Z.AI returns 400 on vision requests:** A fallback was added (commit after `1d353b0`) — if vision content causes a 400, the request is automatically retried text-only so the agent doesn't silently fail.

**Spot-check (2026-06-07):** Verified end-to-end against live code. `useJsonMode = endpoint.includes('api.openai.com')` gates `response_format`; Z.AI resolves to the `zai` provider (reuses OpenAI `buildBody`) so it never receives the flag. All 5 fallback strategies present + `<think>` block stripping. Vision-400→text-only retry confirmed in `callLLM`. Tests: 10/10 Z.AI, 7/7 prose-fallback, 3/3 vision-400. Fixed an off-by-one in the strategy debug-log labels (cosmetic; parsing unchanged).

## Bug #3: Voice input mic button doesn't work
**Symptom:** Clicking the mic button does nothing
**Root cause:** setupVoiceInput() was defined but never called, AND Web Speech API doesn't work in Chrome extension popups
**Status: FIXED** — tab-based injection via chrome.scripting.executeScript; setupVoiceInput() called from popup-full.js DOMContentLoaded; full error handling + showToast feedback; listener cleanup on unload · **SPOT-CHECKED 2026-06-07 ✅**
**File:** `popup-modules/chat.js` setupVoiceInput function

**Spot-check (2026-06-07):** Confirmed `#voiceBtn` exists (`popup.html:234`), `setupVoiceInput()` called from `popup-full.js:15`, manifest grants `scripting`+`activeTab`, and scripts load at end of `<body>` so the `voiceBtn` const is populated before use. Hardened: added an early guard so a missing `#voiceBtn` disables voice gracefully instead of throwing uncaught inside DOMContentLoaded.

## Bug #4: Z.AI models not appearing in dropdown
**Symptom:** User can't easily pick models
**Status:** FIXED — modelsUrl set to coding plan endpoint · **SPOT-CHECKED 2026-06-07 ✅**
**File:** `background/provider-registry.js`
**Verify:** Make sure the model fetch actually works and populates the UI

**Spot-check (2026-06-07):** Wiring correct end-to-end — catalog entry has `modelsUrl: …/coding/paas/v4/models` + `auth: 'bearer'`; `get_provider_catalog` populates the dropdown; `fetch_provider_models` → `fetchModelsList` sends `Authorization: Bearer <key>` and normalizes Z.AI's OpenAI-style `{data:[{id}]}` response. No change needed.

## Bug #5: Extension doesn't work AT ALL on basic sites
**Status: FIXED** — root causes (Bug #1 + Bug #2) are resolved. The full flow works:
user types goal → generatePlan → parsePlan → runAgentLoop → each step calls callLLM → LLM returns tool_calls → executeToolAction → next step → final report

## Bug #6: "Tested fine but says no API key" — key never persisted
**Symptom:** User enters API key, clicks **Test Connection** → "Connection OK", sends a goal → agent does "nothing" and reports no API key.
**Root cause:** Test Connection (and Detect/Use-Model) only validated the form values via a live fetch; they **never wrote to `chrome.storage.local`**. Only the separate **Save Settings** button persisted. Closing the modal after a successful test left no key in storage → `getActiveProvider()` returned empty `apiKey` → `callLLM` threw "API key not configured" → buried "API call failed" note.
**Status: FIXED** (2026-06-07 — PR #24, branch `fix/persist-api-key-on-test`)
- `persistProviderConfig()` helper = single source of truth for the storage shape (`active_provider` + `providers[id]`); Save uses it.
- A successful **Test Connection now persists** the verified config ("Connection OK — saved").
- `chat.js` `sendMessage()` pre-flight: bails with a clear message + toast if no key, restoring the typed goal.
- Inline `#providerSaveStatus` indicator: green "✓ API key saved" vs amber "● Unsaved changes".
**Files:** `popup-modules/settings.js`, `popup-modules/chat.js`, `popup.html`

## Instructions

1. **FIRST:** Run the extension mentally through this flow:
   - User types goal → sendGoal() in chat.js → background processes goal → generatePlan() → parsePlan → runAgentLoop → each step calls callLLM → LLM returns tool_calls → executeToolAction → next step

2. **FIX Bug #1 FIRST** — This is the showstopper. No API calls = nothing works.
   - Read agent-engine.js runAgentLoop from top to bottom
   - Find where it should call the LLM but doesn't
   - The flow is: plan steps → for each step → call LLM with context → get actions → execute → next step
   - Check if there's an early return or missing await

3. **FIX Bug #2** — Make generatePlan bulletproof
   - After getting LLM response, try MULTIPLE parsing strategies:
     a. JSON.parse directly
     b. Extract JSON from ```json``` code blocks
     c. Find first { and last } and try to parse substring
     d. Regex to extract steps array
     e. If ALL fail, create a single-step plan from the goal

4. **FIX Bug #3** — Make voice input work
   - Verify setupVoiceInput() is called
   - Test the chrome.scripting.executeScript approach
   - Add try/catch with user-visible error messages
   - If tab injection fails, fall back to simple text input

5. **VERIFY EVERY FIX** — After each fix:
   - Read the changed code
   - Trace the execution path mentally
   - Run `npm test` — tests MUST pass before committing. NEVER use --detectOpenHandles (it hangs). If a test fails, fix it immediately.
   - Commit with conventional commit message

6. **PUSH every 3-5 commits**

## Quality Standards
- No dead code — every function must be called
- No silent failures — every error must be logged and shown to user
- Every user action must produce visible feedback
- The extension must work end-to-end: goal → plan → execute → report
