# Sentinel Override — Priority Bug Fix Grind

## CRITICAL: These are REAL bugs reported by the user on the LIVE extension. Fix them ALL.

## Bug #1: Agent completes with 0 API calls
**Symptom:** "Agent completed. Total API calls: 0" — the agent starts but never actually calls the LLM.
**Root cause:** After generatePlan fails or succeeds, the agent loop doesn't transition to calling the LLM for actions.
**File:** `background/agent-engine.js` — the runAgentLoop function
**Fix:** Trace the full loop from plan generation → action execution → make sure callLLM actually fires

## Bug #2: generatePlan returns prose not JSON for Z.AI
**Symptom:** "Plan generation: could not parse response as plan JSON: Unexpected token 'T'"  
**Root cause:** jsonMode wasn't being sent for Z.AI provider (FIXED to `provider.kind === 'openai'`) BUT the plan parsing might still fail if the model doesn't follow instructions.
**File:** `background/llm-client.js` generatePlan function
**Fix:** Make the plan parser more robust — try to extract JSON from markdown code blocks, handle trailing text after JSON, add a regex fallback that extracts the steps array

## Bug #3: Voice input mic button doesn't work
**Symptom:** Clicking the mic button does nothing
**Root cause:** setupVoiceInput() was defined but never called, AND Web Speech API doesn't work in Chrome extension popups
**Status:** PARTIALLY FIXED — tab-based injection added but may have issues with permissions or messaging
**File:** `popup-modules/chat.js` setupVoiceInput function
**Fix:** Make sure the function is called, test the chrome.scripting.executeScript approach, add error handling and fallback

## Bug #4: Z.AI models not appearing in dropdown
**Symptom:** User can't easily pick models
**Status:** FIXED — modelsUrl set to coding plan endpoint
**File:** `background/provider-registry.js`
**Verify:** Make sure the model fetch actually works and populates the UI

## Bug #5: Extension doesn't work AT ALL on basic sites
**Symptom:** User tries "go to dnn.com and give me top 10 articles" and agent does nothing
**Root cause:** Combination of Bug #1 (0 API calls) and Bug #2 (plan parse failure)
**Fix:** The ENTIRE flow must work: user types goal → generatePlan → parse plan → execute steps → each step calls LLM → LLM returns actions → actions execute on page → results collected → final report

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
   - Run `npm test` if tests exist
   - Commit with conventional commit message

6. **PUSH every 3-5 commits**

## Quality Standards
- No dead code — every function must be called
- No silent failures — every error must be logged and shown to user
- Every user action must produce visible feedback
- The extension must work end-to-end: goal → plan → execute → report
