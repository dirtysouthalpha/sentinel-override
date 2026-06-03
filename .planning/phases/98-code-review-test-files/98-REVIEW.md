# Phase 98: Code Review Report — Test Files

**Reviewed:** 2026-06-09T16:30:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed 5 test files for common bug patterns:
- tests/report-generator.test.js
- tests/scheduler.test.js
- tests/skills-index.test.js
- tests/skills.test.js
- tests/tab-context.test.js

Note: Several files requested in the review scope do not exist:
- tests/recovery-guarantee.test.js (NOT FOUND)
- tests/refinery-registry.test.js (NOT FOUND)
- tests/schema-adapter.test.js (NOT FOUND)
- tests/scheduler-ui.test.js (NOT FOUND - popup-scheduler-ui.test.js exists)
- tests/script-injection.test.js (NOT FOUND)
- tests/search-engine.test.js (NOT FOUND)
- tests/secure-handler.test.js (NOT FOUND)
- tests/settings.test.js (NOT FOUND - popup-settings.test.js exists)
- tests/shield.test.js (NOT FOUND)
- tests/storage-async.test.js (NOT FOUND)
- tests/store.test.js (NOT FOUND)
- tests/stream-slicer.test.js (NOT FOUND)

## Critical Issues

**No critical issues found.** All array accesses use optional chaining (`?.`) or are properly defended.

## Warnings

### WR-01: Array access without explicit length check in test assertion

**File:** `tests/report-generator.test.js:171`

**Issue:**
```javascript
expect(result.structuredData.tabs[0]).toEqual({ label: 'SonicWall', url: 'https://192.168.1.1', hasScreenshot: true });
```

The test accesses `result.structuredData.tabs[0]` without verifying the array has at least one element. While the test setup ensures this, it creates a fragile test that could fail with unclear errors if the production code returns an empty array.

**Fix:**
```javascript
expect(result.structuredData.tabs).toHaveLength(1);
expect(result.structuredData.tabs[0]).toEqual({ label: 'SonicWall', url: 'https://192.168.1.1', hasScreenshot: true });
```

---

### WR-02: Array access without explicit length check in test assertion

**File:** `tests/report-generator.test.js:651`

**Issue:**
```javascript
expect(result.structuredData.tabs[0].hasScreenshot).toBe(false);
```

Similar to WR-01, this accesses index `[0]` without verifying array length.

**Fix:**
```javascript
expect(result.structuredData.tabs).toHaveLength(2);
expect(result.structuredData.tabs[0].hasScreenshot).toBe(false);
```

---

### WR-03: Mock callback array access without length check

**File:** `tests/skills-index.test.js:45`

**Issue:**
```javascript
const storageChangeListener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0] || null;
```

While this code uses optional chaining (`?.`), it still accesses `mock.calls[0]` without checking if `mock.calls` has any elements. If `addListener` was never called, this would attempt to access undefined.

**Fix:**
```javascript
const storageChangeListener = chrome.storage.onChanged.addListener.mock.calls.length > 0
  ? chrome.storage.onChanged.addListener.mock.calls[0][0]
  : null;
```

---

### WR-04: Potential race condition in timer-based test

**File:** `tests/scheduler.test.js:863-907`

**Issue:**
The test uses `jest.useFakeTimers()` but then manually advances time with `setTimeout` callbacks, creating a potential race condition between fake timers and real promises:

```javascript
jest.useFakeTimers();
// ... later ...
await new Promise(r => setTimeout(r, 50));  // Real timer with fake timers active
```

This mixing of fake and real timers can cause unpredictable test behavior.

**Fix:**
Use `jest.advanceTimersByTime()` consistently instead of mixing real `setTimeout`:
```javascript
jest.useFakeTimers();
// ... test setup ...
jest.advanceTimersByTime(50);
await Promise.resolve(); // Allow microtasks to flush
```

---

### WR-05: Test may not properly clean up listeners

**File:** `tests/scheduler.test.js:869-877`

**Issue:**
```javascript
chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
  capturedListener = fn;
  _msgListeners.push(fn);
});
chrome.runtime.onMessage.removeListener.mockImplementation((fn) => {
  if (_msgListeners) {
    _msgListeners = _msgListeners.filter(l => l !== fn);
  }
});
```

The mock implementation pushes to `_msgListeners` array but the test doesn't verify cleanup happens correctly. If the filter fails (e.g., due to reference inequality), listeners accumulate across tests.

**Fix:**
Add assertion to verify cleanup:
```javascript
chrome.runtime.onMessage.removeListener.mockImplementation((fn) => {
  if (_msgListeners) {
    const beforeLen = _msgListeners.length;
    _msgListeners = _msgListeners.filter(l => l !== fn);
    // Verify listener was actually removed
    if (_msgListeners.length === beforeLen) {
      console.warn('Listener not found in _msgListeners array');
    }
  }
});
```

---

### WR-06: Weak error handling in async test cleanup

**File:** `tests/scheduler.test.js:986-1013`

**Issue:**
```javascript
test.skip('executeScheduledTask — getTabInfo failure', async () => {
  // ...
  await execPromise;
  // registerInitialTab should have been called with empty url fallback
  const { registerInitialTab } = await import('../background/tab-context.js');
  expect(registerInitialTab).toHaveBeenCalledWith(42, '');
});
```

The test is skipped (`.skip`), and even if it weren't, it doesn't verify that `registerInitialTab` was actually called. A failure in `getTabInfo` might not reach the fallback path.

**Fix:**
```javascript
test('executeScheduledTask — getTabInfo failure', async () => {
  // ... setup ...
  await execPromise;
  // Verify the fallback was actually hit
  expect(registerInitialTab).toHaveBeenCalled();
  expect(registerInitialTab).toHaveBeenCalledWith(42, '');
});
```

---

### WR-07: Missing verification in mock callback test

**File:** `tests/skills-index.test.js:336-341`

**Issue:**
```javascript
test('set is called when stats are saved', async () => {
  await resetSkillStats();
  jest.clearAllMocks();
  // ... trigger save ...
  await new Promise(r => setTimeout(r, 1600));
  expect(chrome.storage.local.set).toHaveBeenCalled();
  const setCalls = chrome.storage.local.set.mock.calls;
  if (setCalls.length > 0) {
    const lastCall = setCalls[setCalls.length - 1];
    if (lastCall && lastCall[0]) {
      expect(lastCall[0]).toHaveProperty('skill_stats');
    }
  }
});
```

The test checks if `set` was called but doesn't verify the call was for `skill_stats` specifically. An unrelated `set` call would cause a false positive.

**Fix:**
```javascript
test('set is called when stats are saved', async () => {
  await resetSkillStats();
  jest.clearAllMocks();

  runRecoverySkills({
    lastResult: 'BLOCKED: click command has no target',
    lastCommand: { type: 'click' },
    lastActionFailed: true,
  });

  await new Promise(r => setTimeout(r, 1600));

  const setCalls = chrome.storage.local.set.mock.calls;
  const skillStatsCall = setCalls.find(call => call[0] && call[0].skill_stats);
  expect(skillStatsCall).toBeDefined();
  expect(skillStatsCall[0].skill_stats).toBeDefined();
});
```

---

### WR-08: Test uses hardcoded timing that may fail on slow systems

**File:** `tests/scheduler.test.js:330`

**Issue:**
```javascript
await new Promise(r => setTimeout(r, 1600));
```

The test waits exactly 1600ms for a debounced save that fires at 1500ms. On slow systems or under heavy load, this timing assumption may fail, causing flaky tests.

**Fix:**
Use jest fake timers or increase the safety margin:
```javascript
await new Promise(r => setTimeout(r, 2000)); // 500ms safety margin
```

---

## Info

### IN-01: Inconsistent use of optional chaining

**File:** Multiple files

**Issue:**
Some code uses optional chaining (`?.`) for array access while other parts don't. For consistency and robustness, all array access in test assertions should either use optional chaining or explicitly verify length first.

**Fix:**
Establish a project convention: either use `.toHaveLength()` assertions before accessing indices, or use optional chaining consistently.

---

### IN-02: Skipped tests without documentation

**File:** `tests/scheduler.test.js:457, 481, 505, 520, 715, 863, 986, 1016, 1047, 1089, 1128, 1165, 1371, 1573, 1624, 1844, 1854, 1922, 1966, 2021`

**Issue:**
Multiple tests are marked with `.skip` without clear documentation of why they're skipped or when they should be unskipped. This creates technical debt.

**Fix:**
Add comments explaining why each test is skipped:
```javascript
test.skip('reason: timing issue with mock lifecycle — revisit after refactor', async () => {
  // ...
});
```

---

### IN-03: Long test file

**File:** `tests/scheduler.test.js` (2128 lines)

**Issue:**
The scheduler test file is very long, making it difficult to navigate and maintain. Consider splitting into themed files (e.g., `scheduler-crud.test.js`, `scheduler-execution.test.js`, `scheduler-timing.test.js`).

**Fix:**
Split into smaller, focused test files by functionality.

---

## Summary Statistics

- **Critical Issues:** 0
- **Warnings:** 8
- **Info:** 3
- **Total:** 11

## Overall Assessment

The test files demonstrate **good defensive programming practices** with appropriate use of optional chaining and mock guards. However, there are opportunities to improve test robustness:

1. **Array access safety:** Several tests access array indices without explicit length checks, creating fragile tests that could fail with unclear error messages.

2. **Timing assumptions:** Some tests rely on hardcoded timing (1600ms waits) that could fail on slow systems.

3. **Skipped test debt:** Multiple skipped tests without clear documentation create maintenance burden.

4. **Mock cleanup:** Some mock setups don't properly verify cleanup, risking test pollution.

**Recommendation:** Address the 8 warnings to improve test reliability and maintainability. The skipped tests should either be fixed, documented, or removed to reduce technical debt.

---

_Reviewed: 2026-06-09T16:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
