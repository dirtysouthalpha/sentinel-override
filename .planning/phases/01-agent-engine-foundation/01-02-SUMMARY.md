# Plan 01-02: Stall Detection, Enriched Planning, and SPA Transition Handling

## Status
Complete

## What Was Built
Four reliability features added to the modularized agent engine:

1. **Stall detection with autonomous recovery** (background/agent-engine.js) — `detectStall()` function checks for two patterns: repeated same-action-same-failure loops (similarityWindow=3) and high consecutive failures (maxConsecutiveFailures=5). RESCAN_AND_REPLAN recovery nullifies the plan, resets strategies, and forces a page re-scan. FORCE_STRATEGY_SHIFT bumps consecutiveFailures to trigger the existing strategy shift prompt in callLLM.

2. **Enriched generatePlan** (background/llm-client.js + agent-engine.js) — `generatePlan` now accepts a `context` parameter with `currentUrl`, `pageTitle`, `platformContext`, and `relevantPatterns`. The planning prompt includes URL context, platform-specific guidance, learned patterns from similar past tasks, and few-shot examples contrasting good vs bad plans. Caller in agent-engine.js gathers tab info, platform context, and relevant patterns before calling generatePlan.

3. **SPA page transition observers** (content.js) — `setupSPAObservers()` creates a MutationObserver on document.body (childList+subtree, 500ms debounce) for DOM content changes, patches `history.pushState`/`replaceState` for SPA router detection (300ms debounce), and listens for `popstate` events. Sends `spa_content_changed` and `spa_navigation` messages to background. Guarded by `__sentinelInitialized` to prevent duplicates on re-injection.

4. **SPA transition handling via shared-state** (background/shared-state.js + index.js + agent-engine.js) — New `background/shared-state.js` holds a mutable SPA transition flag. `index.js` sets the flag when receiving SPA messages while the agent is running. `agent-engine.js` checks and clears the flag at the top of each loop iteration, invalidating screenshot cache so the next observe/scan picks up fresh page state. message-protocol.js remains stateless.

## Commits
| Task | Commit | Files |
|------|--------|-------|
| 1: Implement stall detection with autonomous recovery | ac7d551 | background/agent-engine.js |
| 2: Enrich generatePlan with page context and few-shot examples | c5233c1 | background/llm-client.js, background/agent-engine.js |
| 3: Add SPA page transition observers to content.js | 6d91d39 | content.js |
| 4: Create shared-state module and wire SPA transition handling | 3d41d04 | background/shared-state.js, background/index.js, background/agent-engine.js |

## Deviations
None significant. All four features implemented as specified.

## Key Decisions
- SPA transition flag lives in dedicated shared-state.js (not in message-protocol.js) to maintain the pure utility invariant from 01-01
- Stall detection uses `continue` for RESCAN_AND_REPLAN (skip sleep, recover fast) but NOT for FORCE_STRATEGY_SHIFT (let normal flow proceed with strategy shift prompt)
- SPA observers use separate debounce timers (500ms for DOM mutations, 300ms for URL changes) to handle different timing requirements
