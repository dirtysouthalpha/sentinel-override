# Domain Pitfalls: Testing, Templates, Scheduling, and Collaboration

**Project:** Sentinel Override (Chrome MV3 Extension)
**Researched:** 2026-05-04
**Overall confidence:** MEDIUM (codebase analysis HIGH; some web searches rate-limited, supplemented with verified training knowledge)

---

## 1. Testing Pitfalls

### 1.1 CRITICAL: Mocking Chrome Extension APIs That Use Callbacks

**What goes wrong:**
The extension heavily uses callback-based Chrome APIs (`chrome.tabs.query`, `chrome.tabs.get`, `chrome.storage.local.get`, `chrome.debugger.attach`, `chrome.scripting.executeScript`). These are wrapped in Promises throughout the codebase (see `tab-manager.js` lines 14-21, `agent-engine.js` lines 75-76, `provider-registry.js` lines 127-158). Tests that mock these APIs by simply making them return values will pass but will not catch real callback edge cases: `chrome.runtime.lastError` being set, callbacks never firing, or callbacks firing with `undefined` response.

**Why it happens:**
The codebase uses a mix of callback-to-Promise patterns. Some use `new Promise(resolve => chrome.X.get(..., resolve))` (simple, ignores `lastError`). Others use `new Promise((resolve, reject) => chrome.X.get(..., (result) => { if (chrome.runtime.lastError) reject(...); resolve(result); }))` (proper error handling). The inconsistency means mocks must match the exact wrapping pattern or tests give false confidence.

**Consequences:**
- Tests pass in CI but extension crashes in production when `chrome.runtime.lastError` is set (e.g., tab closed between check and action).
- Mocking `fetch()` for LLM calls (see `llm-client.js` lines 200-216, 410-416) is easy, but mocking the provider registry's `resolveProvider()` / `buildHeaders()` / `buildBody()` / `parseResponse()` chain requires understanding the full call path.
- Tests that mock `chrome.storage.local.get` to return a value synchronously will not catch race conditions where storage reads return stale data.

**Prevention:**
1. **Use `vitest-chrome`** ([github.com/probil/vitest-chrome](https://github.com/probil/vitest-chrome)) -- a Vitest-specific Chrome API mock that properly handles callback-to-Promise semantics. Alternatively, `jest-chrome` for Jest.
2. **Write a shared mock factory** for the Chrome APIs actually used by this extension. Based on codebase analysis, the required mocks are:
   - `chrome.tabs.query`, `chrome.tabs.get`, `chrome.tabs.create`, `chrome.tabs.update`, `chrome.tabs.remove`, `chrome.tabs.sendMessage`, `chrome.tabs.captureVisibleTab`
   - `chrome.storage.local.get`, `chrome.storage.local.set`, `chrome.storage.local.remove`
   - `chrome.runtime.sendMessage`, `chrome.runtime.onMessage.addListener`, `chrome.runtime.lastError`
   - `chrome.scripting.executeScript`
   - `chrome.debugger.attach`, `chrome.debugger.detach`, `chrome.debugger.sendCommand`
   - `chrome.alarms.create`, `chrome.alarms.onAlarm`
3. **Always mock `chrome.runtime.lastError`** -- test both the error case and the success case for every callback-based call.
4. **Mock `fetch` at the global level** for LLM calls -- do NOT try to test through the provider registry. Test the provider registry separately with its own mocked fetch.

**Detection (warning signs):**
- Tests that never import or reference `chrome` in their setup are probably testing against nothing.
- Tests that mock a Chrome API as `jest.fn().mockReturnValue(value)` instead of `jest.fn().mockImplementation((..., cb) => cb(value))` will miss callback-specific bugs.
- CI passes but production logs show "Cannot read properties of undefined" from Chrome API callbacks.

**Phase to address:** Phase 1 (Test Infrastructure) -- this is the foundational problem that all other test phases depend on.

---

### 1.2 CRITICAL: Testing Content Scripts That Rely on DOM

**What goes wrong:**
The content scripts (especially `content/index.js` at 597 lines) are deeply intertwined with real browser DOM APIs: `document.querySelector`, `MutationObserver`, `history.pushState` patching, `dispatchEvent` with specific `{ bubbles: true, composed: true }` options, `window.__sentinelUtils` IIFE namespace, and custom event dispatching for shadow DOM boundary crossing. JSDOM does not support shadow DOM rendering, has incomplete `MutationObserver` behavior, and has no concept of Chrome extension isolated worlds.

**Why it happens:**
JSDOM implements a subset of the DOM spec. The content scripts rely on browser-specific behaviors that JSDOM does not replicate:
- Shadow DOM (`shadow-dom.js`) -- JSDOM has basic `attachShadow` but no `composed: true` event propagation.
- `document.createTreeWalker` -- used in `dom-utils.js` for element scanning.
- `contenteditable` input handling -- `content/index.js` lines 250-265 use `execCommand` and `InputEvent` with `inputType: 'insertText'` per-character typing.
- Rich text editor APIs (Quill, TinyMCE, CKEditor) -- `special-inputs.js` checks for these libraries on the global scope.
- `matchMedia()` -- not implemented in JSDOM without polyfill.

**Consequences:**
- Tests pass with JSDOM but content scripts fail in real browsers (false positives).
- Tests fail with JSDOM but content scripts work in real browsers (false negatives).
- Heavy mocking of DOM APIs produces tests that are more complex than the code they test, providing no value.

**Prevention:**
1. **Split content script testing into two tiers:**
   - **Tier 1 -- Logic-only unit tests (Vitest + JSDOM):** Test pure functions that do not touch the DOM directly. Extract functions like `executeCommand` logic for specific command types, `extract`/`extract_list` parsing, element selector resolution from `dom-utils.js`. These are testable with JSDOM.
   - **Tier 2 -- Integration tests (Puppeteer with `--load-extension`):** Test actual content script injection, DOM interaction, and message passing against a real Chrome instance. This is the only reliable way to test shadow DOM, event propagation, and SPA transition detection.
2. **Do NOT try to unit test the full `executeCommand` function.** It touches too many browser APIs. Instead, test individual command handlers in isolation after extracting them.
3. **Mock `window.__sentinelUtils` namespace** for any JSDOM-based content script tests. The IIFE pattern (see `content/index.js` line 14: `const dom = window.__sentinelUtils.dom`) means tests must set up this global before importing.
4. **For JSDOM tests, polyfill missing APIs:** `matchmedia-polyfill` for `matchMedia`, and mock `MutationObserver` with the real implementation (JSDOM's built-in one is acceptable for basic tests).

**Detection (warning signs):**
- Content script test file has more mock setup code than test code.
- Tests pass locally but fail in CI or vice versa (platform-specific JSDOM behavior).
- Tests that mock `document.querySelector` to return fake elements are testing mocks, not code.

**Phase to address:** Phase 1 (Test Infrastructure) -- content script test strategy must be decided before writing any tests.

---

### 1.3 MODERATE: Testing Async Agent Loop Without Making Tests Slow

**What goes wrong:**
The agent loop (`agent-engine.js` `runAgentLoop`, lines 140-727) is a long-running async function with `sleep()` calls (2000ms between API calls, 1500ms post-action), up to 120 steps (`CONFIG.maxSteps`), and nested retry logic (`callLLMWithRetry` with exponential backoff up to 30s). A naive integration test that runs the real loop could take 10+ minutes per test.

**Why it happens:**
The loop is designed for real-time browser interaction with rate limiting and deliberate pauses. Tests cannot afford to wait for real delays.

**Consequences:**
- Slow tests (>5 seconds each) cause developers to skip running them.
- Test suite takes 10+ minutes, breaking the feedback loop.
- Flaky tests due to timing sensitivity (race conditions between `sleep()` and mock resolution).

**Prevention:**
1. **Mock time at the module level:** Vitest's `vi.useFakeTimers()` can advance time instantly. However, this requires the agent loop to use `setTimeout`/`Promise`-based sleep (which it does -- `function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }`). Replace `sleep` in tests with a mock that resolves immediately.
2. **Test the loop in phases, not end-to-end:**
   - Test `startAgent()` initialization and state reset separately.
   - Test a single loop iteration (one observe-plan-act cycle) with mocked LLM responses.
   - Test stall detection (`detectStall`, line 103) as a pure function -- it takes history and returns a result.
   - Test template substitution (lines 354-363) as a pure string operation.
3. **Mock `fetch` for LLM calls with canned responses:** Return a fixed command JSON from `callLLMWithRetry`. This eliminates the slowest part of the loop (network calls).
4. **Set `CONFIG.maxSteps = 3` in tests** to cap loop iterations.
5. **Test the agent loop's decision logic, not its timing:** The value of the loop test is verifying it calls the right actions in the right order, not that it waits the right amount of time.

**Detection (warning signs):**
- Any test with `await sleep(...)` or `setTimeout` in the test body (not the code under test).
- Test files that take >2 seconds to run individually.
- Tests that sometimes pass and sometimes fail (timing-dependent).

**Phase to address:** Phase 1 (Test Infrastructure) -- must be solved before agent loop tests can be written.

---

### 1.4 MODERATE: Avoiding Test Brittleness With LLM Responses

**What goes wrong:**
The agent loop's behavior is driven by LLM responses (`callLLM` in `llm-client.js`). If tests mock the LLM to return `{ type: 'click', selector: '#login-btn' }`, but the real LLM returns `{ type: 'click', selector: 'button.login-btn' }` (different selector format), the test passes but the extension breaks. Conversely, if the test asserts on exact LLM response structure, every prompt change breaks tests.

**Why it happens:**
LLM responses are non-deterministic. The `parseLLMResponse` function (lines 453-476) has significant flexibility -- it handles code-fenced JSON, raw JSON, nested `action`/`command`/`next_action` wrappers, and returns a fallback `{ type: 'note', text: 'Parse error...' }` on failure. Tests that assert on exact response format will be fragile.

**Consequences:**
- Every prompt engineering change breaks unit tests.
- Tests assert on JSON structure instead of behavior (did the agent click the right thing?), providing false confidence.
- Developers start committing `// @ts-ignore` and `// FIXME: flaky test` markers.

**Prevention:**
1. **Mock at the `parseLLMResponse` output boundary, not at the `fetch` boundary.** Tests should provide pre-parsed command objects, not raw LLM text. This isolates prompt/response format changes from behavior tests.
2. **Test `parseLLMResponse` separately** with a variety of real-world LLM output formats (code-fenced, raw, with explanation text, with nested wrappers). This is where format brittleness belongs.
3. **Test agent behavior, not LLM responses.** Instead of asserting "the LLM returned `{ type: 'click', selector: '#btn' }`", assert "after the LLM returned a click command, the agent sent the correct message to the content script."
4. **Store a corpus of real LLM responses** (sanitized) as test fixtures. Use these for `parseLLMResponse` tests to catch regressions when the parser changes.

**Detection (warning signs):**
- Test names like "should parse LLM response with X format" -- good, these are parser tests.
- Test names like "agent should click login button" that mock fetch to return specific JSON -- brittle, should mock at a higher level.
- Test file with 5+ different mock LLM responses for what is essentially the same behavior path.

**Phase to address:** Phase 1 (Test Infrastructure) -- mock strategy must be established before agent behavior tests.

---

## 2. Template/Runbook Pitfalls

### 2.1 CRITICAL: Template Variable Naming Collisions With Page Content

**What goes wrong:**
The existing template system uses `{{key}}` syntax (see `agent-engine.js` lines 354-363) where `key` is any word character (`\w+`). If a user creates a template with goal text like "Check the {{status}} of the firewall" and the page content happens to contain literal `{{status}}` text (e.g., in a troubleshooting guide), the substitution will replace it unexpectedly.

**Why it happens:**
The regex `/\{\{(\w+)\}\}/g` is applied to `command.text`, `command.url`, and `command.value` -- fields that may contain content from the page (e.g., when the LLM copies text from the page into a command). The substitution happens after the LLM generates the command, so it has no way to distinguish template variables from literal braces.

**Consequences:**
- Agent navigates to wrong URL because a `{{variable}}` in the URL was replaced with extracted data.
- Agent types wrong text into a form field because the text contained `{{something}}` that matched a memory key.
- Silent data corruption -- the agent proceeds without error but produces incorrect results.

**Prevention:**
1. **Use a distinct delimiter that will never appear in natural text.** Instead of `{{key}}`, use something like `{{sentinel:key}}` or `${memory.key}` or `::key::`. The delimiter must be something that has zero probability of appearing in web page content or LLM-generated text.
2. **Only substitute in specific fields, not all fields.** Currently, `command.text`, `command.url`, and `command.value` are all substituted. Consider restricting substitution to fields explicitly marked as template-aware (e.g., only when the command originated from a saved runbook).
3. **Log every substitution** so users can debug unexpected replacements.
4. **Validate template variables at template save time.** If a template contains `{{foo}}` but no extraction step creates `foo`, warn the user.

**Detection (warning signs):**
- User reports agent "typed the wrong thing" or "went to the wrong page" when using a saved runbook.
- Memory keys with common names like `status`, `url`, `name`, `id` are most likely to collide.

**Phase to address:** Phase 2 (Command Templates) -- the template delimiter choice must be made before the first template is created.

---

### 2.2 CRITICAL: Templates Breaking When Web UIs Change

**What goes wrong:**
Saved runbooks/templates capture sequences like "Navigate to firewall URL, click Firewall > Rules, read the rules table." If SonicWall updates their UI from hash-based routing (`#/firewall/rules`) to path-based routing (`/firewall/rules`), or renames "Firewall" to "Network Firewall", the template's steps silently fail.

**Why it happens:**
Templates encode UI-specific knowledge (URLs, button labels, navigation paths) that is external to the extension. The extension's platform context system (`getPlatformContext` in `llm-client.js` lines 16-136) provides generic guidance ("SonicWall uses Angular custom dropdowns"), but templates need specific knowledge ("Click Firewall > Rules in the left nav").

**Consequences:**
- Saved runbooks become worthless after vendor UI updates.
- Users lose trust in the template system.
- Debugging is painful because the failure mode is "agent clicked wrong thing" which looks like a general agent failure, not a template staleness problem.

**Prevention:**
1. **Store templates as natural language goals, not step-by-step instructions.** The agent's strength is interpreting goals and adapting to current page state. A template should be "Check SonicWall firewall for blocked connections from IP X" not "Navigate to 192.168.1.1, click Log > View, set filter to X." The agent already knows how to navigate SonicWall from `getPlatformContext`.
2. **Add a "template health check" feature.** Periodically re-run templates in a dry-run mode that verifies each step still works without making changes. Flag templates that fail.
3. **Version templates with the platform context they were created against.** When the platform detection system is updated, flag templates created with the old version.
4. **Never store selectors in templates.** Selectors change frequently. Store intent ("click the login button") and let the LLM find the selector at runtime.

**Detection (warning signs):**
- Template success rate drops over time (need to track this metric).
- User deletes and recreates the same template after a vendor update.
- Agent gets stuck in retry loops when running saved templates.

**Phase to address:** Phase 2 (Command Templates) -- template format must be designed to be resilient to UI changes.

---

### 2.3 MODERATE: Over-Engineering the Template System

**What goes wrong:**
Teams often build template systems with variable scoping, conditional logic, loops, nested templates, template inheritance, and a custom DSL. For Sentinel Override, this is over-engineering because the LLM already serves as the "execution engine" -- templates just need to provide the goal and any parameters.

**Why it happens:**
The existing memory system (`agentMemory`) and `{{key}}` substitution (agent-engine.js lines 354-363) provide a foundation that seems to invite extension. The temptation is to add "if/else" and "loop" constructs to templates. But the LLM already handles conditional logic -- the template should not duplicate this.

**Consequences:**
- Template syntax becomes a language to learn, increasing cognitive load.
- Bugs in template parsing/logic consume development time.
- Templates become rigid, losing the flexibility that makes the agent valuable.

**Prevention:**
1. **Keep templates as "parameterized goals."** A template is:
   - A goal string with placeholder variables (e.g., "Check {firewall_url} for blocked connections from {source_ip}")
   - A set of variable definitions (name, description, default value)
   - An optional set of instructions/context that gets prepended to the goal
2. **Do NOT add control flow to templates.** If a user needs conditional logic, they should write it in the goal text ("If the firewall shows X, do Y, otherwise do Z"). The LLM interprets this.
3. **Do NOT add template composition/inheritance.** Users can reference other templates by name in the goal text if needed.
4. **Maximum template complexity: 5 variables.** If a template needs more, it should be split into multiple templates or just be a one-off goal.

**Detection (warning signs):**
- Design document includes a "template DSL" section.
- Anyone proposes adding `{{#if}}` or `{{#each}}` syntax.
- Template parsing code exceeds 200 lines.

**Phase to address:** Phase 2 (Command Templates) -- establish the "parameterized goal" principle before building.

---

### 2.4 MODERATE: Template Storage Growing Unbounded

**What goes wrong:**
Users create templates and never delete them. Each template includes the goal text, variable definitions, and possibly embedded context/instructions. Over months, this can grow to fill `chrome.storage.local`.

**Why it happens:**
`chrome.storage.local` has a 10 MB limit (Chrome 114+; 5 MB in Chrome 113 and earlier). With no cleanup mechanism, templates accumulate. Each template might be 1-5 KB (goal text + metadata). At 5 KB each, that is 2000 templates before hitting the 10 MB limit -- but combined with `agent_history`, `learned_patterns`, and `agent_memory`, the limit is reachable.

**Consequences:**
- `chrome.storage.local.set()` silently fails when quota is exceeded (no error thrown -- the write just does not persist).
- Other data (settings, history) cannot be saved because templates consumed the quota.
- Extension appears to work but loses data silently.

**Prevention:**
1. **Track storage usage.** Before saving, check `chrome.storage.local.getBytesInUse()` and warn if approaching 80% of quota.
2. **Set a template count limit (e.g., 50 templates).** Enforce it in the UI (disable "Save as Template" when at limit) and in the save function.
3. **Add a "Manage Templates" view** with bulk delete and storage usage display.
4. **Consider adding `unlimitedStorage` permission** to manifest.json if templates + other data might exceed 10 MB. This is a one-line change but has privacy review implications for Chrome Web Store distribution (not applicable for organization-wide deployment).
5. **Clean up `learned_patterns` and `agent_history` periodically.** The codebase already caps these (CONFIG.maxLearnedPatterns = 100, CONFIG.maxStoredHistory = 20), but old data is not explicitly purged on version upgrade.

**Detection (warning signs):**
- `chrome.storage.local.set()` calls that don't throw but data does not persist on reload.
- User reports "my settings keep resetting."
- Storage usage logging shows >7 MB consumed.

**Phase to address:** Phase 2 (Command Templates) -- storage management must be part of the template design, not an afterthought.

---

## 3. Scheduling Pitfalls

### 3.1 CRITICAL: Chrome Alarms Minimum Interval and Service Worker Lifecycle

**What goes wrong:**
Chrome alarms in MV3 have a minimum interval of 1 minute in production (30 seconds per some documentation, but Chrome clamps to the minimum). More critically, the service worker can be terminated between alarm fires, losing all in-memory state. The agent's state is currently entirely in-memory: `agentRunning`, `agentMemory`, `agentPlan`, `history`, `apiCallCount`, `consecutiveFailures` -- all module-scoped variables in `agent-engine.js` (lines 14-21). None of this survives a service worker termination.

**Why it happens:**
MV3 service workers are ephemeral. They are terminated after ~30 seconds of inactivity (or ~5 minutes with an active port connection). When an alarm fires, Chrome wakes the service worker, but any state from the previous execution is gone. The current codebase was designed for interactive sessions where the user is present and the service worker stays alive.

**Consequences:**
- A scheduled task starts but the agent has no memory of previous steps, extracted data, or the plan.
- A task that was mid-execution when the service worker died cannot be resumed.
- Multiple scheduled tasks fire simultaneously if the service worker was asleep for multiple intervals (alarms do not queue -- they coalesce).

**Prevention:**
1. **Persist agent state to `chrome.storage.session`** (not `chrome.storage.local`) at every step. `chrome.storage.session` is faster than local and scoped to the browser session. Key state to persist:
   - `agentMemory` (extracted data)
   - `agentPlan` and `currentPlanStep` (execution progress)
   - `history` (recent action history)
   - `consecutiveFailures` and `currentStrategies` (self-healing state)
2. **Restore state at the start of each alarm handler.** On service worker wake-up, read persisted state and resume.
3. **Use `chrome.alarms.create` with `delayInMinutes` for one-shot tasks** (e.g., "run this investigation at 3:00 PM") and `periodInMinutes` for recurring tasks (e.g., "check firewall logs every 30 minutes").
4. **Keep alarm handlers short.** The alarm fires, the handler starts the agent loop, and the agent loop uses `chrome.alarms` only for scheduling -- not for step-by-step pacing. The agent loop's internal `sleep()` calls are fine because they keep the service worker alive.
5. **Register alarms in the `chrome.alarms.onAlarm` listener itself** (re-registration pattern). This ensures alarms survive service worker restarts.
6. **Never use `setTimeout`/`setInterval` for anything longer than 30 seconds.** These are cleared when the service worker terminates. Use alarms instead.

**Detection (warning signs):**
- Scheduled task runs but the agent starts from scratch every time (no memory of previous extractions).
- Intermittent "No active tab" errors when a scheduled task tries to resume.
- Agent completes a scheduled task but the report shows empty memory (no extracted data).

**Phase to address:** Phase 3 (Agent Scheduling) -- state persistence must be implemented before scheduling works.

---

### 3.2 CRITICAL: No User Present to Handle Prompts (Headless Execution)

**What goes wrong:**
The current agent has an approval mode (`requestApproval` in `agent-engine.js` lines 770-787) that waits up to 60 seconds for user confirmation before proceeding. Scheduled tasks run without a user present. If a scheduled task encounters a prompt-requiring situation (approval mode enabled, or the LLM asks the user a question), the task hangs for 60 seconds and then auto-approves (line 784: `resolve({ approved: true, ... })`). Auto-approving every action is dangerous for scheduled tasks.

**Why it happens:**
The approval system was designed for interactive use. There is no concept of "unattended mode" or "pre-approved actions."

**Consequences:**
- Scheduled task auto-approves destructive actions (deleting firewall rules, changing configurations).
- Task hangs for 60 seconds on every approval prompt, wasting time and API calls.
- User returns to find their firewall configuration changed unexpectedly.

**Prevention:**
1. **Add an "unattended mode" flag to scheduled tasks.** When scheduling, the user must explicitly acknowledge that the task will run without approval prompts.
2. **Disable approval mode for scheduled tasks.** If approval mode is enabled globally, scheduled tasks should either skip it or fail immediately with a clear error.
3. **Define a whitelist of allowed action types for scheduled tasks.** For example, allow `navigate`, `read_page`, `extract`, `note`, `finish` but block `type` into form fields, `click` on destructive buttons, and `execute_js`.
4. **Add a "dry run" option** that logs what the agent would do without actually doing it. This is the safest option for first-time scheduled tasks.
5. **Require saved runbooks (templates) for scheduled tasks.** Do not allow free-form goals in scheduled tasks. This ensures the task has been tested interactively first.

**Detection (warning signs):**
- Approval mode is enabled and a scheduled task is configured.
- Scheduled task description includes destructive actions ("delete", "remove", "disable").
- No mechanism to distinguish interactive vs. unattended execution.

**Phase to address:** Phase 3 (Agent Scheduling) -- unattended execution safety must be designed before scheduling UI is built.

---

### 3.3 MODERATE: Multiple Scheduled Tasks Conflicting

**What goes wrong:**
If a user schedules two tasks to run at the same time (e.g., "check SonicWall at 3:00 PM" and "check FortiGate at 3:00 PM"), both alarms fire, both try to start the agent, and the second one hits `if (agentRunning) throw new Error('Agent already running')` (agent-engine.js line 70). The second task silently fails.

**Why it happens:**
The agent is a singleton (`agentRunning` flag). There is no task queue or conflict resolution.

**Consequences:**
- One scheduled task always fails if it overlaps with another.
- User has no visibility into which task ran and which was skipped.
- No retry mechanism for the failed task.

**Prevention:**
1. **Implement a task queue.** When an alarm fires and the agent is busy, add the task to a queue in `chrome.storage.session`. When the current task finishes, pop the next task from the queue.
2. **Stagger alarms.** If two tasks are scheduled for the same time, automatically offset the second one by N minutes.
3. **Show scheduling conflicts in the UI.** When creating a scheduled task, warn if it overlaps with an existing one.
4. **Log task execution results.** Store the outcome of each scheduled task (success/failure/skipped) so users can audit what happened.

**Detection (warning signs):**
- User schedules two tasks for the same time and only one report is generated.
- Agent logs show "Agent already running" errors during scheduled execution.

**Phase to address:** Phase 3 (Agent Scheduling) -- task queue or conflict resolution must be part of the scheduling design.

---

### 3.4 MINOR: Chrome Alarms Are Not Precise

**What goes wrong:**
Chrome alarms are coalesced and subject to browser-level throttling. If the machine is asleep, on battery, or Chrome determines the extension is idle, alarms may be delayed by minutes or hours. A task scheduled for "3:00 PM" might fire at 3:05 PM or 3:45 PM.

**Why it happens:**
Chrome optimizes battery and CPU by batching alarm events. This is by design and cannot be disabled.

**Consequences:**
- Scheduled investigations that depend on specific timing (e.g., "check logs at exactly 3:00 PM to capture an event") may miss their window.
- Users expect precision but Chrome does not guarantee it.

**Prevention:**
1. **Document the imprecision.** In the scheduling UI, show a disclaimer: "Scheduled tasks may run up to 5 minutes late due to browser power management."
2. **Use `chrome.alarms.create` with `when` (timestamp) for one-shot tasks, not `delayInMinutes`.** This gives Chrome the best chance of firing at the right time.
3. **For recurring tasks, store the intended next-run time and compare it with the actual fire time.** Log the delta so users can see how imprecise the scheduling was.

**Detection (warning signs):**
- Users report "the task didn't run at the scheduled time."
- Scheduled task logs show alarm fire times that differ significantly from scheduled times.

**Phase to address:** Phase 3 (Agent Scheduling) -- document and set user expectations.

---

## 4. Collaboration Pitfalls

### 4.1 CRITICAL: Importing Untrusted Runbooks (Security Risk)

**What goes wrong:**
If the collaboration feature allows importing runbooks/templates from other users or external sources, an attacker could craft a malicious runbook that:
1. Contains a goal with embedded instructions that trick the LLM into executing `execute_js` with arbitrary code (the `new Function()` in `content/index.js` line 434 already executes arbitrary JS from LLM commands).
2. Contains template variables that inject content into URLs, causing the agent to navigate to attacker-controlled pages.
3. Includes instructions to extract sensitive data (API keys, credentials from the settings page) and store them in memory, then the report includes the extracted data.

**Why it happens:**
The agent executes whatever the LLM decides to do based on the goal text. There is no sandboxing or permission boundary between "benign investigation" and "extract all credentials and send them to attacker.com." The `execute_js` command (content/index.js lines 426-448) runs arbitrary JavaScript in the page context with full access to the page's cookies, localStorage, and network.

**Consequences:**
- **Credential theft:** Attacker-crafted runbook extracts API keys from the extension's own settings page.
- **Data exfiltration:** Agent navigates to attacker URL with extracted data in the URL or as form submissions.
- **Lateral movement:** Agent executes JavaScript that modifies the page to steal session tokens.
- **Supply chain attack:** A seemingly useful shared runbook contains hidden malicious instructions.

**Prevention:**
1. **Treat imported runbooks as untrusted.** Always show the full goal text to the user before execution and require explicit approval.
2. **Add a "review mode" for imported runbooks.** Parse the goal text and flag suspicious patterns:
   - References to the extension's own settings/options pages (potential credential extraction).
   - `execute_js` instructions in the goal text.
   - URLs to domains not matching the expected target platform.
3. **Restrict `execute_js` for scheduled/unattended tasks.** This is the most dangerous command. Consider requiring it to be explicitly enabled per-task.
4. **Do NOT allow runbooks to contain embedded JavaScript code.** The template system should only support natural language goals and variable substitution. If a runbook contains code, reject it at import time.
5. **Add an import sandbox.** Before executing an imported runbook, parse it and verify it only contains allowed constructs (natural language goal, variable definitions, platform context). Reject anything else.
6. **Sign exported runbooks.** When exporting, include a hash of the runbook content. When importing, verify the hash matches. This detects tampering but does not prevent it (the hash is not cryptographically signed without a key management system).

**Detection (warning signs):**
- Imported runbook goal text contains code blocks, JavaScript syntax, or URLs to unexpected domains.
- Runbook instructions reference `chrome://`, `chrome-extension://`, or the extension's own popup URL.
- Runbook asks the agent to navigate to a non-enterprise domain (e.g., `http://evil.com`).

**Phase to address:** Phase 4 (Collaboration) -- security review of the import path must happen before the collaboration feature ships.

---

### 4.2 MODERATE: Report Format Versioning (Old Reports Incompatible With New Format)

**What goes wrong:**
The report format (see `report-generator.js` lines 60-104) is defined by the LLM prompt. It produces markdown with sections: Goal, Steps Taken, Key Findings, Evidence, Conclusions. If the report format changes in a future version (e.g., adding a "Recommendations" section, changing "Evidence" to "Data Sources"), old reports will not render correctly in the new UI. If reports are shared between team members on different extension versions, format mismatches occur.

**Why it happens:**
Reports are free-form markdown generated by the LLM. There is no schema, no version field, and no structured data format. The report prompt instructs the LLM to produce specific sections, but the LLM may vary its output format slightly between calls.

**Consequences:**
- Report viewer UI breaks when displaying old-format reports.
- Team members on different versions see different report layouts.
- Data extraction from reports (e.g., for ticketing integration) fails on unexpected formats.

**Prevention:**
1. **Add a `format_version` field to the report object.** When generating, include the current format version. When displaying, check the version and apply appropriate rendering.
2. **Store reports as structured JSON, not just markdown.** The report object already has `{ summary, fullReport, goal, timestamp }` (report-generator.js line 120). Add structured fields for each section:
   ```json
   {
     "format_version": "2.0",
     "goal": "...",
     "sections": {
       "steps_taken": [...],
       "key_findings": [...],
       "evidence": [...],
       "conclusions": "..."
     },
     "full_markdown": "...",
     "timestamp": "..."
   }
   ```
3. **Keep a format migration function.** When loading an old-format report, run it through a migration to the current format.
4. **Version the export format.** When exporting reports for sharing, include the format version in the filename or file header.

**Detection (warning signs):**
- Report viewer has `try/catch` around section parsing.
- Team members report "the report looks weird" or "missing sections."
- Diff of report prompt between versions shows section name changes.

**Phase to address:** Phase 4 (Collaboration) -- format versioning must be part of the report export design.

---

### 4.3 MINOR: Large Export Files

**What goes wrong:**
Exporting reports and runbooks as files (JSON, markdown, or PDF) can produce large files if:
- A report includes full page content (the agent captures up to 28,000 characters per page for runbook tasks -- agent-engine.js line 300-305).
- Multiple reports are bundled into a single export.
- Screenshots are included in the export (base64 JPEG at quality 30 -- each screenshot is ~50-200 KB).

**Why it happens:**
The agent captures extensive data during execution. Reports include the full action history and extracted memory. Bundle exports multiply this.

**Consequences:**
- Export file is too large to email or share via Slack/Teams.
- JSON export of chrome.storage.local (if someone builds a "backup all data" feature) can be several MB.
- Download takes noticeable time, making the UI feel unresponsive.

**Prevention:**
1. **Strip page content from exported reports.** The report markdown already summarizes the page content. The raw page content (28,000 chars per page) should not be included in exports.
2. **Exclude screenshots from exports by default.** Add an "Include screenshots" checkbox for users who want them.
3. **Compress multi-report exports.** Use a zip file for bundled exports instead of a single large JSON file.
4. **Set a size limit on exports (e.g., 5 MB).** Warn the user if the export exceeds this and suggest reducing the scope.

**Detection (warning signs):**
- Export file is >1 MB for a single report.
- Export process takes >2 seconds.
- Users complain about being unable to share exported files.

**Phase to address:** Phase 4 (Collaboration) -- implement size limits and content stripping in the export feature.

---

## Phase-Specific Warning Summary

| Phase | Topic | Likely Pitfall | Severity | Mitigation |
|-------|-------|----------------|----------|------------|
| Phase 1 | Test Infrastructure | Chrome API callback mocking mismatch | CRITICAL | Use vitest-chrome; build shared mock factory |
| Phase 1 | Test Infrastructure | Content scripts untestable with JSDOM alone | CRITICAL | Two-tier strategy: JSDOM for logic, Puppeteer for integration |
| Phase 1 | Test Infrastructure | Agent loop tests too slow | MODERATE | Mock time; mock fetch; cap maxSteps at 3 |
| Phase 1 | Test Infrastructure | LLM response brittleness | MODERATE | Mock at parseLLMResponse boundary, not fetch |
| Phase 2 | Templates | `{{key}}` delimiter collisions with page content | CRITICAL | Use distinct delimiter like `{{sentinel:key}}` |
| Phase 2 | Templates | Templates break when vendor UIs change | CRITICAL | Store intent, not steps; add health checks |
| Phase 2 | Templates | Over-engineering template DSL | MODERATE | Limit to parameterized goals; max 5 variables |
| Phase 2 | Templates | Storage quota exhaustion | MODERATE | Track usage; cap at 50 templates; add management UI |
| Phase 3 | Scheduling | In-memory state lost on service worker termination | CRITICAL | Persist state to chrome.storage.session at each step |
| Phase 3 | Scheduling | Approval mode blocks unattended execution | CRITICAL | Add unattended mode; disable approval; whitelist action types |
| Phase 3 | Scheduling | Concurrent scheduled tasks conflict | MODERATE | Implement task queue; stagger alarms; log results |
| Phase 3 | Scheduling | Alarm timing imprecision | MINOR | Document limitation; use `when` timestamp |
| Phase 4 | Collaboration | Malicious runbook import (RCE via execute_js) | CRITICAL | Review mode; restrict execute_js; sandbox imports |
| Phase 4 | Collaboration | Report format versioning | MODERATE | Add format_version; structured JSON; migration function |
| Phase 4 | Collaboration | Large export files | MINOR | Strip raw content; exclude screenshots by default; zip bundles |

---

## Cross-Phase Dependencies

Several pitfalls span multiple phases and should be addressed early:

1. **`new Function()` security review** (currently flagged in STATE.md line 87): This affects both testing (Pitfall 1.1 -- need to test execute_js safely) and collaboration (Pitfall 4.1 -- importing untrusted runbooks). The review should happen in Phase 1 alongside test infrastructure, not deferred to Phase 4.

2. **State persistence architecture** (Pitfall 3.1): The in-memory state problem affects scheduling (Phase 3) but the persistence mechanism should be designed in Phase 2 (templates also need persistent storage). Building a shared state persistence layer in Phase 2 that both templates and scheduling can use avoids duplication.

3. **Storage management** (Pitfalls 2.4, 3.1): Both templates and scheduling increase storage usage. A unified storage management approach (quota tracking, cleanup, usage display) should be built once in Phase 2 and reused.

---

## Sources

- [Chrome Developer Blog: Testing MV3 Service Worker Suspension](https://developer.chrome.com/blog/eyeos-journey-to-testing-mv3-service%20worker-suspension) -- HIGH confidence, official source
- [Vitest GitHub Discussion #3090: Testing Chrome Extensions](https://github.com/vitest-dev/vitest/discussions/3090) -- MEDIUM confidence, community discussion
- [vitest-chrome on GitHub](https://github.com/probil/vitest-chrome) -- MEDIUM confidence, library README
- [Chromium Extensions Google Group: Vitest unit testing](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/hssoAlvluW8) -- MEDIUM confidence, developer experiences
- [Chrome Developer Docs: Service Worker Events](https://developer.chrome.com/docs/extensions/get-started/tutorial/service-worker-events) -- HIGH confidence, official source
- [Chrome Developer Docs: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) -- HIGH confidence, official source
- [Chrome Developer Docs: Improve Extension Security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) -- HIGH confidence, official source
- [PortSwigger: Server-Side Template Injection](https://portswigger.net/web-security/server-side-template-injection) -- MEDIUM confidence, general web security reference
- [StackOverflow: Render template literals without new Function](https://stackoverflow.com/questions/77241188/how-to-render-template-literals-without-using-new-function-because-chrome-extens) -- LOW confidence, single Q&A
- [W3C WebExtensions Issue #351: Storage limits](https://github.com/w3c/webextensions/issues/351) -- MEDIUM confidence, standards discussion
- Codebase analysis of Sentinel Override v3.1.3 -- HIGH confidence, direct inspection
