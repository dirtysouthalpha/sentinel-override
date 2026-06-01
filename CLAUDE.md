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
**Status: FIXED** (2026-05-24 — commit `63dd5c2`)
- `response_format` is only sent to `api.openai.com`; Z.AI endpoint never gets it
- 5-strategy fallback parse chain handles prose/numbered/bulleted responses
- Regression tests added in `d5d2891`

**If Z.AI returns 400 on vision requests:** A fallback was added (commit after `1d353b0`) — if vision content causes a 400, the request is automatically retried text-only so the agent doesn't silently fail.

## Bug #3: Voice input mic button doesn't work
**Symptom:** Clicking the mic button does nothing
**Root cause:** setupVoiceInput() was defined but never called, AND Web Speech API doesn't work in Chrome extension popups
**Status: FIXED** — tab-based injection via chrome.scripting.executeScript; setupVoiceInput() called from popup-full.js DOMContentLoaded; full error handling + showToast feedback; listener cleanup on unload
**File:** `popup-modules/chat.js` setupVoiceInput function

## Bug #4: Z.AI models not appearing in dropdown
**Symptom:** User can't easily pick models
**Status:** FIXED — modelsUrl set to coding plan endpoint
**File:** `background/provider-registry.js`
**Verify:** Make sure the model fetch actually works and populates the UI

## Bug #5: Extension doesn't work AT ALL on basic sites
**Status: FIXED** — root causes (Bug #1 + Bug #2) are resolved. The full flow works:
user types goal → generatePlan → parsePlan → runAgentLoop → each step calls callLLM → LLM returns tool_calls → executeToolAction → next step → final report

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
