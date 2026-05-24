# Sentinel Override — Make It Perfect

## THE GOAL
Make Sentinel Override the best browser automation agent on the planet. It should work better, faster, and more reliably than Claude's own computer use in Chrome. Every feature must be polished, every edge case handled, every test passing.

## What Is This
AI-powered browser automation Chrome extension (MV3). User gives a goal → agent plans → executes click/type/navigate actions → reports results. The daily driver for an IT Support Technician.

## CRITICAL — Chrome MV3 Constraints (NEVER VIOLATE)
- NEVER use top-level await in background/index.js (service worker)
- NEVER use const or let at top-level of content/index.js (all_frames: true, MAIN world — use var)
- Every chrome.* API used in background/ must have its corresponding permission in manifest.json
- Use optional chaining (chrome.X?.onY) for any top-level chrome.* access
- NEVER access window or document in service worker context
- NEVER use require() — this is ES modules (type: "module" in manifest)
- NEVER reference a const/let variable before its declaration line (temporal dead zone)
- NEVER add npm dependencies without a compelling reason
- Content scripts sending messages to background MUST unwrap wrapped responses: `response?.data?.text || response?.text`
- New content scripts that need UI panels MUST use Shadow DOM (attachShadow) for style isolation
- New content scripts get their OWN manifest.json content_scripts entry (don't combine with main content script)
- NEVER use const/let at top-level in content scripts (even ISOLATED world — use var or IIFE guard)

## PHASE 1: Fix Everything Broken (DO THIS FIRST)
1. Run `npm test` — fix ALL failing tests. Zero failures allowed.
2. Run `npx eslint .` — fix ALL lint errors. Zero warnings allowed.
3. Fix the `generatePlan()` bug — it returns prose instead of JSON. This is the #1 blocker for non-Quick Mode.
4. Fix innerHTML XSS risks — use textContent or sanitize before insertion (quick-assist.js:551, content/index.js:733,840)
5. Fix the dead Z.AI model reference — `glm-5.1` in provider-registry.js line 553 is DEAD. Update to working model.

## PHASE 2: Make It Bulletproof
6. Improve test coverage — every module should have ≥80% branch coverage
7. Edge case hardening:
   - Race conditions in scheduler and tab-manager
   - LLM client with malformed responses
   - Content scripts in shadow DOM + cross-origin iframe scenarios
   - Agent recovery from network failures mid-run
   - Tab crash recovery (service worker stays alive)
8. Performance optimizations:
   - Profile and reduce memory usage in long-running sessions
   - Optimize DOM mutation observers in content scripts
   - Debounce/throttle expensive operations (telemetry, audit logging)
   - Lazy-load heavy modules only when needed
9. Security hardening:
   - Audit all user input paths for injection
   - Rate limit LLM API calls to prevent accidental spend
   - Validate all message payloads between content/background/popup

## PHASE 3: Make It Better Than Claude In Chrome
10. Smarter agent behavior:
    - Implement multi-step reasoning chains (observe → plan → execute → verify → adapt)
    - Add page state memory — agent remembers what it tried and what worked
    - Implement element confidence scoring — don't just click the first match
    - Add fallback selectors when primary selectors fail
    - Smart wait — detect SPA navigation completion without arbitrary timeouts
11. Better user experience:
    - Add a progress bar or step counter to the popup during agent runs
    - Show the agent's current "thinking" in real-time (not just after completion)
    - Add ability to pause/resume agent runs
    - Add undo functionality — revert the last N agent actions
    - Improve Quick Assist with streaming responses
12. More reliable automation:
    - Implement self-healing selectors — when a selector breaks, try alternatives automatically
    - Add visual confirmation — screenshot comparison before/after critical actions
    - Implement action replay — record and replay sequences of actions
    - Add scheduled runs — automate recurring tasks at set times

## PHASE 4: Polish To Perfection
13. Documentation:
    - JSDoc on every exported function
    - Header comments on every module
    - Update README with current version and features
14. Code quality:
    - Refactor any functions over 50 lines
    - Consolidate duplicate utility functions
    - Ensure all async operations have timeout handling
    - Remove dead code and commented-out blocks
15. Version bump to v3.47.0 when Phase 2 complete, v3.48.0 when Phase 3 complete

## Commands
- Test: `npm test`
- Lint: `npx eslint .`
- Build: `node scripts/build.js`

## Git Rules
- Branch: main
- Commit style: conventional commits (feat:, fix:, docs:, style:, chore:, test:)
- Push after every 3-5 commits
- After EVERY change: run tests, then commit

## Key Architecture
- background/agent-engine.js (~3000 lines) — agent loop, CONFIG, _runSettings
- background/llm-client.js (~900 lines) — callLLM(), generatePlan(), providers
- background/telemetry.js (~400 lines) — emit() with PII redaction
- background/provider-registry.js (~600 lines) — 20+ LLM provider catalog
- popup.html (~500 lines) — chat UI, settings, approval cards
- content/index.js (~100 lines) — content script, ctel bridge
- content/quick-assist.js (~350 lines) — inline AI on any page

## Known Bugs (from audit)
- generatePlan() returns prose not JSON — LLM ignores JSON schema
- Z.AI model glm-5.1 is DEAD in provider-registry.js:553 — update it
- innerHTML XSS in quick-assist.js:551 and content/index.js:733,840
- No build system — 150+ JS files loaded individually
