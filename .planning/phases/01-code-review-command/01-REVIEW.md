# Phase 01: Code Review Report

**Reviewed:** 2026-06-04
**Depth:** standard
**Files Reviewed:** 120 (test files)
**Status:** issues_found

## Summary

Comprehensive scan of all test files for array bounds violations. Found 5 CRITICAL and 2 WARNING issues where arrays are accessed without proper length guards, which could cause test failures or obscure bugs.

## Critical Issues

### CR-01: Array bounds violation in popup-onboarding test

**File:** `tests/popup-onboarding.test.js:226-229`
**Issue:** `steps[0]`, `steps[1]`, `steps[2]`, `steps[3]` accessed without checking `steps.length`
**Fix:**
```javascript
const steps = sandbox._stepElements;
expect(steps.length).toBeGreaterThanOrEqual(4);
expect(steps[0].style.display).toBe('none');
expect(steps[1].style.display).toBe('');
expect(steps[2].style.display).toBe('none');
expect(steps[3].style.display).toBe('none');
```

### CR-02: Array bounds violation in macro-recorder test

**File:** `tests/macro-recorder.test.js:140`
**Issue:** `macros[0]` accessed without checking `macros.length`
**Fix:**
```javascript
it('should update existing macro', async () => {
  const macros = await loadMacros();
  expect(macros.length).toBeGreaterThan(0);
  const id = macros[0].id;
```

### CR-03: Array bounds violation in macro-recorder test (second instance)

**File:** `tests/macro-recorder.test.js:160-161`
**Issue:** `macros[0]` accessed twice without checking `macros.length`
**Fix:**
```javascript
it('should preserve original fields when partially updating', async () => {
  const macros = await loadMacros();
  expect(macros.length).toBeGreaterThan(0);
  const id = macros[0].id;
  const originalCreatedAt = macros[0].createdAt;
```

### CR-04: Array bounds violation in macro-recorder test (third instance)

**File:** `tests/macro-recorder.test.js:180`
**Issue:** `macrosBefore[1]` accessed without checking array has at least 2 elements
**Fix:**
```javascript
it('should delete macro by id', async () => {
  const macrosBefore = await loadMacros();
  expect(macrosBefore.length).toBeGreaterThanOrEqual(2);
  const idToDelete = macrosBefore[1].id;
```

### CR-05: Array bounds violation in page-monitor test

**File:** `tests/page-monitor.test.js:167`
**Issue:** `monitorsBefore[1]` accessed without checking array has at least 2 elements
**Fix:**
```javascript
it('should remove monitor by id', async () => {
  const monitorsBefore = await loadMonitors();
  expect(monitorsBefore.length).toBeGreaterThanOrEqual(2);
  const idToRemove = monitorsBefore[1].id;
```

## Warnings

### WR-01: Insufficient defensive guard in quick-assist-handler test

**File:** `tests/quick-assist-handler.test.js:296`
**Issue:** `mock.calls[0]` accessed without guard at the access point (length checked on previous line but should be immediately before access)
**Fix:**
```javascript
expect(global.fetch.mock.calls.length).toBeGreaterThan(0);
const fetchCall = global.fetch.mock.calls[0] || [];
if (!fetchCall.length) {
  throw new Error('No fetch calls recorded');
}
expect(fetchCall[1].headers).toMatchObject({
```

### WR-02: Insufficient guard for array access in agent-engine test

**File:** `tests/agent-engine.test.js:577`
**Issue:** `recent[0]` accessed with guard that checks `recent.length >= similarityWindow` but doesn't explicitly verify `recent[0]` exists before accessing it
**Fix:**
```javascript
const recent = history.slice(-stallConfig.similarityWindow);
if (recent.length >= stallConfig.similarityWindow && recent[0]) {
  const allSameType = recent[0].action != null && recent.every(h => h.action && h.action.type === recent[0].action.type);
```

---

_Reviewed: 2026-06-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
