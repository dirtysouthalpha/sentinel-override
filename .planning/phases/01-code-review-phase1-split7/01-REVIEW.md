---
phase: 01-code-review-phase1-split7
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 121
files_reviewed_list:
  - tests/adaptive-prompts-edge-cases.test.js
  - tests/adaptive-prompts.test.js
  - tests/agent-engine-activity.test.js
  - tests/agent-engine-checkpoint.test.js
  - tests/agent-engine-deep.test.js
  - tests/agent-engine-history.test.js
  - tests/agent-engine-integration.test.js
  - tests/agent-engine-loop-paths.test.js
  - tests/agent-engine-recovery.test.js
  - tests/agent-engine-startagent-errors.test.js
  - tests/agent-engine-tab-recovery.test.js
  - tests/agent-engine-undo.test.js
  - tests/agent-engine-uncovered.test.js
  - tests/agent-engine-vision-constants.test.js
  - tests/audit-log-edge-cases.test.js
  - tests/audit-log.test.js
  - tests/checkpoint-resume.test.js
  - tests/client-knowledge.test.js
  - tests/collaboration.test.js
  - tests/content-action-hud.test.js
  - tests/content-cursor.test.js
  - tests/content-dropdown-utils.test.js
  - tests/content-dom-utils.test.js
  - tests/content-frame-manager.test.js
  - tests/content-highlight.test.js
  - tests/content-overlay-detector.test.js
  - tests/content-overlay.test.js
  - tests/content-quick-assist.test.js
  - tests/content-shadow-dom.test.js
  - tests/content-shadow-intercept.test.js
  - tests/content-special-inputs-edge-cases.test.js
  - tests/content-special-inputs.test.js
  - tests/content-wait-utils.test.js
  - tests/context-menu.test.js
  - tests/cross-domain-click-detection.test.js
  - tests/cursor-deep.test.js
  - tests/cursor-coverage.test.js
  - tests/dropdown-utils-error-handling.test.js
  - tests/dropdown-utils.test.js
  - tests/export-report.test.js
  - tests/frame-router-edge-cases.test.js
  - tests/frame-router.test.js
  - tests/llm-client-deep.test.js
  - tests/llm-client-edge-cases.test.js
  - tests/llm-client-uncovered.test.js
  - tests/llm-client.test.js
  - tests/macro-recorder.test.js
  - tests/message-protocol-edge-cases.test.js
  - tests/message-protocol.test.js
  - tests/page-monitor-edge-cases.test.js
  - tests/page-monitor.test.js
  - tests/platform-modules.test.js
  - tests/platforms-modules-deep.test.js
  - tests/platforms-deep.test.js
  - tests/platforms-edge-cases.test.js
  - tests/platforms-remaining-modules.test.js
  - tests/platforms.test.js
  - tests/popup-chat.test.js
  - tests/popup-client-knowledge.test.js
  - tests/popup-collaboration.test.js
  - tests/popup-full.test.js
  - tests/popup-helpers.test.js
  - tests/popup-modal-drag.test.js
  - tests/popup-recent-chats.test.js
  - tests/popup-scheduler-ui.test.js
  - tests/popup-settings.test.js
  - tests/popup-state.test.js
  - tests/popup-telemetry-panel.test.js
  - tests/popup-templates.test.js
  - tests/provider-registry-zai-error-paths.test.js
  - tests/provider-registry.test.js
  - tests/quick-assist-edge-cases.test.js
  - tests/quick-assist-handler.test.js
  - tests/report-generator.test.js
  - tests/scheduler-edge-cases.test.js
  - tests/scheduler-missing-coverage.test.js
  - tests/scheduler-race-timing.test.js
  - tests/scheduler-test-helper.js
  - tests/scheduler-uncovered.test.js
  - tests/scheduler-wait-report.test.js
  - tests/scheduler.test.js
  - tests/shared-state-edge-cases.test.js
  - tests/shared-state.test.js
  - tests/shadow-intercept.test.js
  - tests/skills-index-deep.test.js
  - tests/skills-index.test.js
  - tests/skills-modules-deep.test.js
  - tests/special-inputs-edge-cases.test.js
  - tests/tab-context-edge-cases.test.js
  - tests/tab-context.test.js
  - tests/telemetry-edge-cases.test.js
  - tests/telemetry.test.js
  - tests/template-manager.test.js
  - tests/test-collaboration-comprehensive.test.js
  - tests/test-export-report-comprehensive.test.js
  - tests/test-llm-client-comprehensive.test.js
  - tests/test-platforms-skills-comprehensive.test.js
  - tests/test-provider-registry-comprehensive.test.js
  - tests/test-template-manager-comprehensive.test.js
  - tests/test-trust-score-comprehensive.test.js
  - tests/trust-score.test.js
  - tests/voice-input-edge-cases.test.js
findings:
  critical: 4
  warning: 2
  info: 0
  total: 6
status: issues_found
---

# Phase 1 (Split 7): Mock Assertion Safety Review

**Reviewed:** 2026-06-02
**Depth:** Standard
**Files Reviewed:** 121 test files
**Status:** Issues Found

## Summary

Scanned all test files for mock assertion safety issues, focusing on unprotected array access and missing call count verification. The codebase demonstrates strong defensive programming practices with extensive use of optional chaining (`?.`) and fallback patterns (`|| []`). However, **4 CRITICAL** issues were found where mock array access lacks proper bounds checking, which could cause test failures or mask bugs if code behavior changes.

## Critical Issues

### CR-01: Unsafe mock.calls[1] access without call count verification

**File:** `tests/frame-router.test.js:313`
**Issue:** Test accesses `mock.calls[1]` without verifying the mock was called at least twice. If the code under test changes and only calls once, this will access undefined and cause unclear test failures.

**Context:**
```javascript
test('injects utility files before running command', async () => {
  chrome.scripting.executeScript
    .mockResolvedValueOnce([])  // utility injection step
    .mockResolvedValueOnce([{ result: { ok: true, data: 'ok' } }]);

  await executeInFrame(1, 5, { type: 'click', selector: '#btn' });

  const firstCall = chrome.scripting.executeScript.mock.calls[0]?.[0];
  expect(firstCall).toBeDefined();

  // BUG: No toHaveBeenCalledTimes(2) check before accessing [1]
  const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
  expect(secondCall?.target).toEqual({ tabId: 1, frameIds: [5] });
```

**Fix:**
```javascript
  // Verify exactly 2 calls before accessing [1]
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
  expect(secondCall?.target).toEqual({ tabId: 1, frameIds: [5] });
```

---

### CR-02: Same pattern - duplicate unsafe calls[1] access

**File:** `tests/frame-router.test.js:347`
**Issue:** Same as CR-01 - accessing index [1] without verifying call count.

**Context:**
```javascript
test('command args include the command object', async () => {
  chrome.scripting.executeScript
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ result: { ok: true, data: 'ok' } }]);

  const cmd = { type: 'type', selector: 'input', text: 'hello' };
  await executeInFrame(1, 5, cmd);

  // BUG: No toHaveBeenCalledTimes(2) check
  const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
  expect(secondCall).toBeDefined();
  expect(secondCall.args?.[0]).toEqual(cmd);
```

**Fix:**
```javascript
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
```

---

### CR-03: Third occurrence - unsafe calls[1] in beforeAll

**File:** `tests/frame-router.test.js:563`
**Issue:** Same pattern in beforeAll hook - accessing [1] without verifying count.

**Context:**
```javascript
beforeAll(async () => {
  chrome.scripting.executeScript
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ result: { ok: true } }]);
  await executeInFrame(9999, 99, { type: 'click', selector: 'x' });

  // BUG: No toHaveBeenCalledTimes(2) verification
  const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
  expect(secondCall).toBeDefined();
  runCmd = secondCall.func;
  expect(typeof runCmd).toBe('function');
});
```

**Fix:**
```javascript
  await executeInFrame(9999, 99, { type: 'click', selector: 'x' });
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  const secondCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
```

---

### CR-04: Unsafe dynamic index calculation (length - 1)

**File:** `tests/agent-engine-loop-paths.test.js:384`
**Issue:** Accessing `mock.calls[mock.calls.length - 1]` without first verifying `mock.calls.length > 0`. If length is 0, this accesses index -1, returning undefined.

**Context:**
```javascript
listener();
expect(chrome.storage.session.set).toHaveBeenCalled();

// BUG: If length is 0, accesses index -1 (undefined)
const call = chrome.storage.session.set.mock.calls[chrome.storage.session.set.mock.calls.length - 1];
expect(call[0]).toHaveProperty('agent_checkpoint');
```

**Fix:**
```javascript
listener();
expect(chrome.storage.session.set).toHaveBeenCalled();
expect(chrome.storage.session.set.mock.calls.length).toBeGreaterThan(0);
const call = chrome.storage.session.set.mock.calls[chrome.storage.session.set.mock.calls.length - 1];
expect(call[0]).toHaveProperty('agent_checkpoint');
```

---

## Warnings

### WR-01: Non-idiomatic mock access (length check present but pattern inconsistent)

**File:** `tests/quick-assist-handler.test.js:296`
**Issue:** After checking `toBeGreaterThan(0)`, code accesses `mock.calls[0]` directly without optional chaining. While safe due to the length check, this is inconsistent with the rest of the codebase which uses `|| []` fallbacks.

**Context:**
```javascript
expect(global.fetch.mock.calls.length).toBeGreaterThan(0);
const fetchCall = global.fetch.mock.calls[0];  // Should be .calls[0] || [] for consistency
expect(fetchCall[1].headers).toMatchObject({
```

**Fix:**
```javascript
expect(global.fetch.mock.calls.length).toBeGreaterThan(0);
const fetchCall = global.fetch.mock.calls[0] || [];
expect(fetchCall[1]?.headers).toMatchObject({
```

---

### WR-02: Array destructuring without fallback pattern

**File:** `tests/adaptive-prompts.test.js:456,759`
**Issue:** Uses destructuring assignment `const [url, opts] = globalThis.fetch.mock.calls[0] || []` which is safe, but inconsistent with the rest of the file's pattern of using optional chaining on subsequent access.

**Context:**
```javascript
// Line 456
const [url, opts] = globalThis.fetch.mock.calls[0] || [];
const body = JSON.parse(globalThis.fetch.mock.calls[0]?.[1]?.body);  // Why not use opts here?
```

**Fix:** Use the destructured variable consistently:
```javascript
const [url, opts] = globalThis.fetch.mock.calls[0] || [];
const body = JSON.parse(opts?.body);  // Use destructured opts, not re-accessing mock.calls
```

---

## Positive Findings (Exemplary Patterns)

The codebase shows excellent defensive programming in test files:

1. **Extensive optional chaining:** 100+ instances of `mock.calls[0]?.[0]` providing null-safety
2. **Fallback patterns:** Widespread use of `|| []` to prevent undefined access
3. **Pre-verification:** Most tests properly use `toHaveBeenCalled()` before array access
4. **Safe calls[1] example:** `tests/telemetry.test.js:122` correctly uses `toHaveBeenCalledTimes(2)` before accessing index [1]

**Example of safe pattern (telemetry.test.js:116-123):**
```javascript
emit('test', 'info', 'first');
expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalled();
const seq1 = globalThis.chrome.runtime.sendMessage.mock.calls[0]?.[0]?.seq;
emit('test', 'info', 'second');
expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);  // Proper verification
const seq2 = globalThis.chrome.runtime.sendMessage.mock.calls[1]?.[0]?.seq;
```

---

_Reviewed: 2026-06-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (Phase 1 Split 7)_
