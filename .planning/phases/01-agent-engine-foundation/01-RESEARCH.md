# Phase 1: Agent Engine Foundation - Research

**Researched:** 2026-04-24
**Domain:** Chrome Extension MV3 modular architecture, agent reliability engineering, SPA transition detection
**Confidence:** MEDIUM

## Summary

This phase refactors the monolithic `background.js` (1,232 lines) into three distinct modules (agent engine, LLM client, tab manager), standardizes error handling across all message passing between background/content/UI, and adds three reliability features: stall detection with autonomous recovery, accurate planning, and SPA page transition handling.

The extension already uses `"type": "module"` in its manifest, which is the correct and current approach for Chrome Extension MV3 modularization. This means native ES module `import`/`export` syntax can be used immediately without adding a build tool. The key constraint is that service workers terminate after 30 seconds of inactivity (Chrome official docs), so global mutable state must be moved to `chrome.storage` or carefully managed across module boundaries.

The current error handling is inconsistent: `background.js` sends responses via `sendResponse({result: ...})` or `sendResponse({status: ...})` with error strings embedded in the value, while `content.js` mixes `sendResponse({ result: 'Error: ' + err.message })` with `sendResponse({ error: err.message })`, and `popup-full.js` checks `chrome.runtime.lastError` in one place but ignores errors in others. A standardized response envelope and Promise-based message wrapper are needed.

**Primary recommendation:** Use native ES modules (already configured in manifest), create a shared message protocol with `{ ok, data, error }` envelope, and implement stall detection via action+state similarity analysis rather than just step counting.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native ES Modules | Chrome 89+ | Module system for background.js splitting | Already configured (`"type": "module"` in manifest); no build tool needed |
| chrome.storage.local | Built-in | Persist agent state across service worker restarts | Required by MV3 service worker lifecycle (30s termination) |
| chrome.runtime.sendMessage | Built-in | Message passing | Standard Chrome API; no alternative |
| MutationObserver | Built-in | Detect SPA DOM changes | Standard Web API for observing DOM mutations |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| No build tool | N/A | Keep extension loadable as unpacked | Native ES modules in `"type": "module"` service worker are sufficient for 3-4 modules |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native ES modules | Vite + CRXJS bundler | Adds build step, dev dependency, complexity. Only worthwhile if module count grows past 8+ or HMR is needed. Not justified for splitting into 3 modules. |
| `{ ok, data, error }` envelope | Return thrown Errors from async listeners (Chrome 146+) | Chrome 146 async listener error propagation is rolling out and not available everywhere. Safe to target Chrome 120+. The envelope pattern works on all current Chrome versions. |
| MutationObserver in content script | pushState/replaceState patching | pushState patching detects URL-only changes but misses same-URL content swaps (common in enterprise UIs). MutationObserver catches both. Use both together for maximum coverage. |

**Installation:**

No packages to install. This phase uses only built-in Chrome Extension APIs and native JavaScript.

## Architecture Patterns

### Recommended Project Structure

```
sentinel-override-v3.1.3/
├── manifest.json              # Entry point (unchanged, already "type": "module")
├── background/
│   ├── index.js               # NEW: service worker entry, imports and wires modules
│   ├── agent-engine.js        # NEW: agent loop, planning, self-healing, stall detection
│   ├── llm-client.js          # NEW: API calls, retry logic, response parsing, Anthropic/OpenAI format
│   ├── tab-manager.js         # NEW: tab locking, page load waiting, content script injection, screenshot capture
│   └── message-protocol.js    # NEW: standardized message send/receive wrappers
├── content.js                 # MODIFIED: use message-protocol.js error envelope, add SPA observer
├── popup-full.js              # MODIFIED: use message-protocol.js for all sendMessage calls
├── popup.html                 # Unchanged
└── marked.min.js              # Unchanged
```

**Critical constraint:** `manifest.json` background field must change from `"service_worker": "background.js"` to `"service_worker": "background/index.js"`. All other paths in the extension that reference `background.js` (e.g., `content.js` injection) must be updated accordingly. The `"type": "module"` setting stays.

### Pattern 1: Module State Sharing via Closure/Exports

Since the agent engine is a single long-running async loop, modules share state through exported functions and objects rather than global variables. State that must survive service worker termination goes to `chrome.storage`.

**When to use:** Agent state (agentRunning, agentMemory, agentPlan, consecutiveFailures) must be accessible across modules during a single agent run.

**Example:**
```javascript
// background/agent-engine.js
export let agentRunning = false;
export let agentMemory = {};
export let consecutiveFailures = 0;
export let agentPlan = null;
export let currentPlanStep = 0;

export function resetAgentState() {
  agentRunning = false;
  agentMemory = {};
  consecutiveFailures = 0;
  agentPlan = null;
  currentPlanStep = 0;
}
```

```javascript
// background/index.js
import { resetAgentState, runAgentLoop } from './agent-engine.js';
import { handleAgentMessages } from './message-protocol.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleAgentMessages(request, sender, sendResponse);
  // Return true for async sendResponse in agent start/stop handlers
});
```

### Pattern 2: Standardized Message Envelope

**What:** Every message response follows the same structure: `{ ok: boolean, data?: any, error?: string }`. Every sender wraps `chrome.runtime.sendMessage` in a Promise that rejects on error.

**When to use:** ALL message passing between background, content scripts, and popup. No exceptions.

**Example:**
```javascript
// background/message-protocol.js

// Sender-side wrapper: returns Promise, rejects on error
export function sendMessage(tabId, message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Message timed out after ${timeoutMs}ms`)), timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response received'));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error || 'Unknown error'));
        return;
      }
      resolve(response.data);
    });
  });
}

// Background-to-runtime sender (popup messages)
export function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}
```

```javascript
// Receiver-side pattern in content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request)
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // async
});

async function handleMessage(request) {
  switch (request.action) {
    case 'observe_page':
      // ... scanning logic ...
      return { elements: interactiveElements };
    case 'execute_command':
      return await executeCommand(request.command);
    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}
```

### Pattern 3: Stall Detection via Action+State Similarity

**What:** Track the last N actions and their results. If the agent repeats the same action type + same result text (or "Element not found") across N consecutive steps without any successful action, declare a stall and inject a recovery prompt.

**When to use:** Inside the agent loop, after each action result is processed.

**Example:**
```javascript
// In agent-engine.js
const stallConfig = {
  maxConsecutiveFailures: 5,    // Hard limit: force recovery
  similarityWindow: 3,          // Look at last N actions for similarity
  stateRecheckSteps: 3,         // After N same-result steps, force re-scan
};

function detectStall(history, currentStep) {
  const recent = history.slice(-stallConfig.similarityWindow);

  // Check: all recent actions are the same type with same failure
  const allSameType = recent.every((h, i) =>
    h.action.type === recent[0].action.type
  );
  const allSameResult = recent.every((h, i) =>
    h.result === recent[0].result
  );
  const allFailed = recent.every(h =>
    h.result.includes('not found') ||
    h.result.startsWith('Error') ||
    h.result.includes('timed out')
  );

  if (allSameType && allSameResult && allFailed && recent.length >= stallConfig.similarityWindow) {
    return {
      stalled: true,
      reason: `Repeated "${recent[0].action.type}" with same failure: "${recent[0].result}"`,
      recoveryAction: 'RESCAN_AND_REPLAN'
    };
  }

  // Check: no successful action in last N steps (regardless of type)
  const noSuccess = recent.every(h => h.result.includes('not found') || h.result.startsWith('Error'));
  if (noSuccess && consecutiveFailures >= stallConfig.maxConsecutiveFailures) {
    return {
      stalled: true,
      reason: `${consecutiveFailures} consecutive failures without progress`,
      recoveryAction: 'FORCE_STRATEGY_SHIFT'
    };
  }

  return { stalled: false };
}
```

### Pattern 4: SPA Page Transition Detection in Content Script

**What:** A MutationObserver in `content.js` that detects significant DOM changes (added/removed nodes) and notifies the background agent to re-scan. Combined with URL change detection via `popstate` and patched `pushState`/`replaceState`.

**When to use:** Always active in `content.js`. Fires a message to background when a significant SPA transition is detected.

**Example:**
```javascript
// In content.js — add after the existing message listener
let spaTransitionDebounce = null;

function setupSPAObservers() {
  // 1. MutationObserver for DOM content changes
  const domObserver = new MutationObserver((mutations) => {
    const significantChange = mutations.some(m =>
      m.addedNodes.length > 0 || m.removedNodes.length > 0
    );
    if (significantChange) {
      clearTimeout(spaTransitionDebounce);
      spaTransitionDebounce = setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'spa_content_changed',
          url: window.location.href
        }).catch(() => {}); // non-critical
      }, 500); // Debounce: wait for SPA render to settle
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // 2. URL change detection (for hash-based and pushState routing)
  let lastUrl = window.location.href;

  // Patch pushState/replaceState for SPA routers
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      dispatchSPATransition(lastUrl);
    }
  };

  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      dispatchSPATransition(lastUrl);
    }
  };

  window.addEventListener('popstate', () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      dispatchSPATransition(lastUrl);
    }
  });
}

function dispatchSPATransition(url) {
  clearTimeout(spaTransitionDebounce);
  spaTransitionDebounce = setTimeout(() => {
    chrome.runtime.sendMessage({
      action: 'spa_navigation',
      url: url
    }).catch(() => {});
  }, 300);
}

// Initialize observers when content script loads
setupSPAObservers();
```

### Anti-Patterns to Avoid

- **Global variables across modules:** The current code uses module-level `let` variables for agent state. When splitting into modules, do NOT duplicate state across files. Export state from one module and import it in others. State that must survive service worker termination must use `chrome.storage`.
- **Mixed error transport:** Do not mix `sendResponse({ error: ... })` with `sendResponse({ result: 'Error: ... })`. Pick ONE pattern and use it everywhere.
- **Forgetting `return true` for async sendResponse:** When an `onMessage` listener calls `sendResponse` asynchronously (inside a `.then()` or `async` function), it MUST return `true` or the message channel closes immediately.
- **Observer without cleanup:** MutationObserver in content.js should be cleaned up if content script is re-injected. Check for existing observer before creating a new one.
- **Stall detection that only counts failures:** Simple consecutive failure counting misses "flutter" loops (succeed-fail-succeed-fail). Include action similarity analysis.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON extraction from LLM response | Custom regex/string parsing | Current `extractFirstJsonObject` is already adequate | The current balanced-bracket parser handles nested objects. Only needs minor hardening. |
| Build system for 3 modules | Vite/webpack config | Native ES modules (`"type": "module"`) | Adding a bundler for 3 files is over-engineering. Native imports work. Revisit if module count exceeds 8. |
| Debounce function | Custom setTimeout/clearTimeout | Simple inline debounce (already used in the SPA pattern above) | A 10-line debounce is simpler than importing a library for this use case. |

**Key insight:** This phase is primarily about reorganizing existing code, not adding new dependencies. The current codebase has no npm dependencies and no build system. Keeping it dependency-free is a deliberate constraint.

## Common Pitfalls

### Pitfall 1: Service Worker State Loss on Termination

**What goes wrong:** After splitting background.js into modules, the service worker can be terminated by Chrome after 30 seconds of inactivity. If the agent loop is mid-execution when this happens, all in-memory state (agentRunning, agentMemory, agentPlan) is lost.

**Why it happens:** MV3 service workers are ephemeral. Global variables and module-level `let` declarations are not persisted.

**How to avoid:** The current code already handles this correctly for the most part -- the agent loop runs continuously (calling Chrome APIs and fetching) which keeps the service worker alive. However, during `await sleep(3000)` pauses, the worker could theoretically terminate. Mitigation:
1. The existing `chrome.tabs.sendMessage` and `chrome.scripting.executeScript` calls in the loop reset the idle timer (Chrome 110+).
2. For long sleeps (>5s), consider using `chrome.alarms` instead of `setTimeout`.
3. Critical state (agentRunning flag) could be persisted to `chrome.storage.session` for crash recovery.

**Warning signs:** Agent mysteriously stops mid-task with no error. Variables reset to defaults.

### Pitfall 2: Message Channel Closure in Async Listeners

**What goes wrong:** After refactoring message handlers into async functions, `sendResponse` is called after the message channel has already closed.

**Why it happens:** If the `onMessage` listener is declared `async` or calls `sendResponse` inside a `.then()`, Chrome closes the message channel unless the listener explicitly returns `true`.

**How to avoid:** Every message handler that calls `sendResponse` asynchronously MUST return `true`. The standardized message pattern (Pattern 2) handles this by wrapping the async handler and always returning `true`.

**Warning signs:** Messages silently fail. `sendResponse` is called but the sender gets no response. `chrome.runtime.lastError: "The message port closed before a response was received."`

### Pitfall 3: Content Script Re-injection Breaks SPA Observers

**What goes wrong:** The agent loop re-injects `content.js` on every iteration (lines 262-272 of background.js). If SPA observers are added in content.js, they accumulate -- each injection adds another MutationObserver and another set of pushState patches.

**Why it happens:** `chrome.scripting.executeScript` runs the file again. The `content_script_ready` signal fires, but there is no guard against double-initialization of observers.

**How to avoid:** Add a guard variable at the top of content.js:
```javascript
if (window.__sentinelSPAInitialized) {
  chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});
} else {
  window.__sentinelSPAInitialized = true;
  // ... existing listener setup ...
  setupSPAObservers();
}
```

**Warning signs:** Multiple identical SPA transition messages per page change. Increasing memory usage over time.

### Pitfall 4: Planning Prompt Produces Generic Steps

**What goes wrong:** The planning LLM call returns generic steps like "Navigate to website" instead of specific actions like "Navigate to sonicwall.example.com and click Firewall > Rules".

**Why it happens:** The current `generatePlan` function has a minimal prompt (lines 121-131) with only 4 rules and a single goal string. It lacks context about the current page, user preferences, or platform-specific considerations.

**How to avoid:** Enhance the planning prompt with:
1. Current page URL (if one is open)
2. Platform context from `getPlatformContext()`
3. Relevant learned patterns from `getRelevantPatterns()`
4. A few-shot example showing specific vs. generic plans
5. Instruction to reference exact URLs, selectors, and UI elements from the goal

**Warning signs:** Plans contain phrases like "go to the website", "find the information", "take action". Plans should read like a technician's runbook.

### Pitfall 5: Circular Import Dependencies

**What goes wrong:** Module A imports from Module B, which imports from Module A, causing undefined exports at load time.

**Why it happens:** When splitting a monolithic file, it is easy to create circular dependencies. For example, `agent-engine.js` might import `sendMessage` from `message-protocol.js`, while `message-protocol.js` imports `agentRunning` from `agent-engine.js`.

**How to avoid:** Use a one-directional dependency graph:
- `index.js` imports all other modules (top-level orchestrator)
- `message-protocol.js` has NO imports from agent modules (pure utility)
- `agent-engine.js` imports from `llm-client.js`, `tab-manager.js`, and `message-protocol.js`
- `llm-client.js` and `tab-manager.js` import only from `message-protocol.js`
- State is exported from `agent-engine.js` and imported by others (no circularity)

**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'agentRunning')` at module load time.

## Code Examples

### Standardized Message Handler (Content Script)

```javascript
// content.js — refactored message handler with standardized envelope
const __sentinelInitialized = window.__sentinelInitialized;
window.__sentinelInitialized = true;

if (__sentinelInitialized) {
  chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});
} else {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // ALWAYS return true for async sendResponse
  });

  async function handleMessage(request) {
    switch (request.action) {
      case 'observe_page': {
        // ... existing scanning logic ...
        return { elements: interactiveElements };
      }
      case 'read_page': {
        // ... existing read logic ...
        return { content: `Page Title: ${title}\nURL: ${url}\n\n${content}` };
      }
      case 'execute_command': {
        return await executeCommand(request.command);
      }
      case 'wait_for': {
        return await handleWaitFor(request.condition);
      }
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  }

  // executeCommand now throws on failure instead of returning error strings
  async function executeCommand(cmd) {
    // ... existing logic ...
    // Replace: return 'Element not found: ' + cmd.selector;
    // With:    throw new Error(`Element not found: ${cmd.selector}`);
    // Replace: return 'Clicked ' + cmd.selector;
    // With:    return 'Clicked ' + cmd.selector;  // success stays as data
  }

  setupSPAObservers();
  chrome.runtime.sendMessage({ action: 'content_script_ready' }).catch(() => {});
}
```

### Stall Recovery Integration in Agent Loop

```javascript
// Inside the agent loop, after action execution:
// (in agent-engine.js)

// Track consecutive failures (existing)
if (actionFailed) {
  consecutiveFailures++;
  currentStrategies.push(`${command.type}:${command.selector || command.url || ''}`);
  if (currentStrategies.length > 10) currentStrategies.shift();
} else {
  consecutiveFailures = 0;
  currentStrategies = [];
}

// NEW: Check for stall
const stall = detectStall(history, stepCount);
if (stall.stalled) {
  sendSilentUpdate(`🔄 Stall detected: ${stall.reason}. Recovering...`, stepCount);

  if (stall.recoveryAction === 'RESCAN_AND_REPLAN') {
    // Force re-scan and replan from current page state
    agentPlan = null;
    currentPlanStep = 0;
    consecutiveFailures = 0;
    currentStrategies = [];

    // Inject stall context into next LLM call
    history.push({
      step: stepCount,
      action: { type: 'note', text: `STALL RECOVERY: Re-assessing page state. Previous approach failed.` },
      result: 'Stall detected — forcing page re-scan and strategy change'
    });

    // Skip the normal sleep to recover faster
    continue;
  }

  if (stall.recoveryAction === 'FORCE_STRATEGY_SHIFT') {
    // Already handled by existing strategyCtx in callLLM, but ensure it fires
    // by bumping consecutiveFailures above threshold
    consecutiveFailures = CONFIG.strategyShiftThreshold;
  }
}
```

### Background Index.js Entry Point

```javascript
// background/index.js — service worker entry point
import { resetAgentState, startAgent, stopAgent } from './agent-engine.js';
import { initTabManager } from './tab-manager.js';
import { initMessageProtocol } from './message-protocol.js';

// One-time migration (from current background.js)
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['api_endpoint', 'model'], (result) => {
    const updates = {};
    if (result.api_endpoint && result.api_endpoint.includes('bigmodel.cn')) updates.api_endpoint = '';
    if (result.model && (result.model.includes('glm-4.6v-flash') || result.model.includes('glm-4v-'))) updates.model = '';
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
});

// Tab locking
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'popup.html' });
});

// Unified message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  initMessageProtocol(request, sender, sendResponse);
  return true; // Keep channel open for async handlers
});

async function initMessageProtocol(request, sender, sendResponse) {
  try {
    switch (request.action) {
      case 'execute_command': {
        const result = await handleCommandRouting(request.command, sender);
        sendResponse({ ok: true, data: result });
        break;
      }
      case 'run_agent_loop': {
        const result = await startAgent(request.goal, sender);
        sendResponse({ ok: true, data: result });
        break;
      }
      case 'stop_agent_loop': {
        const result = stopAgent();
        sendResponse({ ok: true, data: result });
        break;
      }
      case 'spa_navigation':
      case 'spa_content_changed': {
        // Forward to agent engine for re-scan handling
        // (agent engine will check if it should re-scan)
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown action: ${request.action}` });
    }
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `importScripts()` for service worker modules | `"type": "module"` with native ES imports | Chrome 89 (2021) | Allows clean import/export, proper module encapsulation. Already used in this extension. |
| Callback-based `sendResponse` | Promise-based `sendMessage` + `return true` | Chrome 88 (2021) | Cleaner async patterns. Both still work; Promise form is preferred. |
| Async listeners with `return true` | Async listeners returning a Promise (auto-response) | Chrome 146 (2025, rolling out) | Still not universally available. Cannot rely on it yet. Keep `return true` pattern. |
| Service worker termination after 5min idle | 30 seconds idle, but API calls reset timer | Chrome 110 (2023) | Agent loop stays alive as long as it keeps calling Chrome APIs. Sleeps >5s are the risk zone. |
| `chrome.runtime.lastError` required | `chrome.runtime.lastError` still required for callbacks | Still current | Promise-based APIs don't need it, but `sendMessage` callbacks still do. Always check it. |

**Deprecated/outdated:**
- `importScripts()`: Still works but no module encapsulation. Native ES imports are preferred.
- `chrome.extension.lastError`: Removed in MV3. Use `chrome.runtime.lastError` instead.
- MV2 `background.scripts` array: Replaced by single `service_worker` file in MV3.

## Open Questions

1. **How many times is content.js re-injected per agent run?**
   - What we know: The agent loop re-injects content.js on every iteration (up to 3 retries). This means MutationObservers and pushState patches would stack up without a guard.
   - What's unclear: Whether Chrome deduplicates script execution if the file hasn't changed.
   - Recommendation: Add the `__sentinelInitialized` guard (shown in Pitfall 3) before implementing SPA observers. Test by logging observer count.

2. **Should the SPA transition handler interrupt the current agent step or queue a re-scan?**
   - What we know: The agent loop processes one step at a time. A SPA transition could happen while the LLM is being consulted (2-30 second wait).
   - What's unclear: Whether the background service worker should immediately re-scan on SPA change, or wait for the current step to complete.
   - Recommendation: Queue the SPA transition as a flag. At the top of the next agent loop iteration, check the flag and re-scan if set. This avoids race conditions with mid-step transitions.

3. **What is the right stall detection threshold?**
   - What we know: The current `strategyShiftThreshold` is 3 consecutive failures. This may be too aggressive for some enterprise UIs where clicking the wrong element 3 times is normal exploration.
   - What's unclear: The optimal balance between quick recovery and false-positive stall detection.
   - Recommendation: Start with the existing threshold of 3 for consecutive identical failures (same action + same result), but use a higher threshold of 5 for mixed-failure stalls. Make thresholds configurable via CONFIG.

4. **Should plan generation include current page context?**
   - What we know: The current `generatePlan()` only receives the goal string and settings. It has no knowledge of what page the agent is currently on.
   - What's unclear: Whether including the current URL and page title in the planning prompt would improve plan accuracy for follow-up tasks.
   - Recommendation: For v1, include the current tab URL and title in the planning prompt. This is a small change that could significantly improve plan relevance for tasks like "continue investigating" or "now check the firewall logs".

## Sources

### Primary (HIGH confidence)
- Chrome Extension Messaging API docs: https://developer.chrome.com/docs/extensions/develop/concepts/messaging -- Verified error handling patterns, async response behavior, Promise-based listeners (Chrome 146+)
- Chrome Service Worker Lifecycle docs: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle -- Verified 30s termination, state persistence requirements, timer reset behavior
- Chrome MV3 Migration guide: https://developer.chrome.com/docs/extensions/mv3/intro/mv3-migration/ -- Verified `"type": "module"` support, single service worker constraint
- Current codebase analysis: `background.js` (1,232 lines), `content.js` (591 lines), `popup-full.js` (1,258 lines), `manifest.json` -- Verified current error handling patterns, message passing, module structure

### Secondary (MEDIUM confidence)
- MutationObserver API: Standard Web API, well-documented. Debounce pattern is common practice.
- pushState/replaceState patching: Common SPA navigation detection pattern used by analytics libraries (GTM, Segment). Verified by multiple sources.
- Stall detection patterns: Based on analysis of existing codebase's `consecutiveFailures` and `strategyShiftThreshold` mechanisms, cross-referenced with general LLM agent loop patterns.

### Tertiary (LOW confidence)
- LLM agent stall detection best practices: No authoritative source found. Current codebase's existing self-healing mechanism is the primary reference. Research into academic papers (AgentS, WebArena) is based on training data and could not be verified with web search due to rate limiting.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Native ES modules confirmed in manifest.json, no external dependencies needed, verified against Chrome official docs
- Architecture: MEDIUM -- Module splitting approach is sound, but circular dependency risk and service worker state management need careful implementation. No test infrastructure to verify refactoring correctness.
- Pitfalls: HIGH -- All pitfalls are based on direct code analysis of the current codebase and verified against Chrome official documentation
- Stall detection: MEDIUM -- Approach is grounded in existing codebase patterns but the specific thresholds and recovery strategies need real-world tuning
- SPA detection: HIGH -- MutationObserver and pushState patching are well-established patterns. The integration challenge (re-injection guard) is the main risk.

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days -- stable domain, Chrome MV3 APIs are not rapidly changing)
