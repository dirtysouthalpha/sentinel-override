# Sentinel Override - Comprehensive Test Plan

**Version:** 1.0
**Last Updated:** 2026-04-29
**Author:** QA-Tester (Paperclip Agent d2e7d7ac)
**Issue:** SVO-1

---

## Table of Contents

1. [Overview](#overview)
2. [Action Types Under Test](#action-types-under-test)
3. [Test Environment](#test-environment)
4. [1. click](#1-click)
5. [2. type](#2-type)
6. [3. navigate](#3-navigate)
7. [4. scroll](#4-scroll)
8. [5. select](#5-select)
9. [6. hover](#6-hover)
10. [7. press_key](#7-press_key)
11. [8. extract](#8-extract)
12. [9. wait_for_text](#9-wait_for_text)
13. [10. wait_for_element](#10-wait_for_element)
14. [11. wait_for_navigation](#11-wait_for_navigation)
15. [12. execute_js](#12-execute_js)
16. [13. read_page](#13-read_page)
17. [14. note](#14-note)
18. [15. finish](#15-finish)
19. [Integration and E2E Scenarios](#integration--e2e-scenarios)
20. [Regression and Edge-Case Matrix](#regression--edge-case-matrix)
21. [Defects Found](#defects-found)
22. [Appendix](#appendix)

---

## Overview

This test plan covers all **15 action types** implemented in the Sentinel Override browser automation extension. The extension operates as a Chrome MV3 extension with:

- **background.js** - Service worker handling the agent loop, LLM calls, plan execution, rate limiting, cost tracking, and tier-based model routing.
- **content.js** - Content script injected into pages to execute DOM commands (click, type, scroll, observe, extract).
- **popup-full.js** - UI layer for agent interaction, plan approval, settings, and conversation history.

### Architecture Summary

`
User Goal -> popup.js -> background.js (plan_task) -> LLM (decompose)
           -> background.js (execute_plan) -> content.js (execute_command)
           -> LLM observes screenshot + DOM -> next action -> ... -> finish
`

### Key Entry Points

| Path | Method | Purpose |
|------|--------|---------|
| background.js:runAgentLoop() | Main loop | Goal -> LLM decides each step -> execute -> repeat until finish |
| background.js:executePlan() | Planned execution | Runs pre-decomposed steps sequentially |
| background.js:callLLM() | LLM interaction | Sends screenshot + DOM to LLM, parses JSON response |
| background.js:parseLLMResponse() | Response parsing | Validates action type, fixes common LLM errors |
| content.js:execute_command | DOM execution | Dispatches click/type/scroll in the page context |

---

## Action Types Under Test

| # | Action Type | In validTypes | In content.js | Status |
|---|-------------|:---:|:---:|--------|
| 1 | click | Yes | Yes | **Implemented** |
| 2 | type | Yes | Yes | **Implemented** |
| 3 | navigate | Yes | N/A (background.js) | **Implemented** |
| 4 | scroll | Yes | Yes | **Implemented** |
| 5 | select | Yes | No | **Missing** |
| 6 | hover | Yes | No | **Missing** |
| 7 | press_key | Yes | No | **Missing** |
| 8 | extract | Yes | No | **Missing** |
| 9 | wait_for_text | Yes | No | **Missing** |
| 10 | wait_for_element | Yes | No | **Missing** |
| 11 | wait_for_navigation | No | No | **Not validated, not implemented** |
| 12 | execute_js | Yes | No | **Missing (auto-tool workaround)** |
| 13 | read_page | Yes | Partial (msg action only) | **Routing bug** |
| 14 | note | Yes | No | **Parse-only fallback** |
| 15 | finish | Yes | N/A (background.js) | **Implemented** |

---

## Test Environment

### Prerequisites

- Chrome 120+ or Edge 120+ (Chromium MV3)
- Extension loaded in developer mode from sentinel-override/ directory
- Valid API key for at least one provider (OpenRouter, Venice.ai, or z.ai)
- Test pages served locally or accessible via HTTPS

### Test Pages

| Page | URL | Purpose |
|------|-----|---------|
| M365 Admin Portal | https://admin.microsoft.com | Real-world IT: user management, license assignment |
| SonicWall Management | https://firewall-ip | Real-world IT: firewall configuration UI |
| Google Search | https://www.google.com | Simple search + extract |
| GitHub | https://github.com | Navigation, form interaction, table extraction |
| Local Test Form | test-fixtures/form.html | 5-field form for type/select testing |
| Local Infinite Scroll | test-fixtures/infinite-scroll.html | Scroll + extract testing |

---

## 1. click

**Implementation:** content.js - cmd.type === 'click'
**Selector:** CSS selector via querySelector
**Behavior:** Scrolls element into view, calls el.click()

### TC-CLICK-001: Happy path - click a visible button

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded with a visible submit button |
| **Input** | { type: "click", selector: "#submit-btn" } |
| **Steps** | 1. Navigate to test page 2. Agent sends execute_command with click action |
| **Expected** | Button receives click event; form submits or handler fires; result = "Clicked #submit-btn" |
| **Actual** | _(fill after test)_ |
| **Pass/Fail** | |

### TC-CLICK-002: Happy path - click an anchor link

| Field | Value |
|-------|-------|
| **Precondition** | Page with a navigable anchor element |
| **Input** | { type: "click", selector: "#nav-link" } |
| **Expected** | Browser navigates to link target; result = "Clicked #nav-link" |
| **Actual** | |
| **Pass/Fail** | |

### TC-CLICK-003: Edge case - click a hidden element

| Field | Value |
|-------|-------|
| **Precondition** | Button with display:none style |
| **Input** | { type: "click", selector: "#hidden-btn" } |
| **Expected** | scrollIntoView succeeds, click() fires but not visible to user. Result = "Clicked #hidden-btn" |
| **Actual** | |
| **Pass/Fail** | |

### TC-CLICK-004: Edge case - click non-existent selector

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "click", selector: "#does-not-exist" } |
| **Expected** | querySelector returns null; result = "Element not found: #does-not-exist" |
| **Actual** | |
| **Pass/Fail** | |

### TC-CLICK-005: Edge case - click with invalid/empty selector

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "click", selector: "" } |
| **Expected** | querySelector("") throws SyntaxError or returns null; result includes error message |
| **Actual** | |
| **Pass/Fail** | |

### TC-CLICK-006: IT Scenario - M365 admin "Add user" button

| Field | Value |
|-------|-------|
| **Precondition** | Logged into M365 Admin Center |
| **Input** | { type: "click", selector: "[data-testid='add-user-button']" } or equivalent |
| **Expected** | "Add user" wizard opens |
| **Actual** | |
| **Pass/Fail** | |

### TC-CLICK-007: Error handling - click after navigation (stale context)

| Field | Value |
|-------|-------|
| **Precondition** | Agent navigates to new page; content.js not re-injected |
| **Input** | { type: "click", selector: "#content" } |
| **Expected** | sendMessageWithRetry fails; after 3 retries, error propagated to agent loop |
| **Actual** | |
| **Pass/Fail** | |

---
﻿## 2. type

**Implementation:** content.js - cmd.type === 'type'
**Selector:** CSS selector for input or textarea
**Behavior:** Scrolls into view, focuses, sets value via native setter (React/framework compat), dispatches input and change events.

### TC-TYPE-001: Happy path - type into text input

| Field | Value |
|-------|-------|
| **Precondition** | Text input visible on page |
| **Input** | { type: "type", selector: "#email", text: "user@example.com" } |
| **Expected** | Input value = "user@example.com"; input and change events fired; result = "Typed into #email" |
| **Actual** | |
| **Pass/Fail** | |

### TC-TYPE-002: Happy path - type into textarea

| Field | Value |
|-------|-------|
| **Precondition** | Textarea visible on page |
| **Input** | { type: "type", selector: "#notes", text: "Hello world" } |
| **Expected** | Textarea value includes text; events dispatched |
| **Actual** | |
| **Pass/Fail** | |

### TC-TYPE-003: Edge case - empty text string

| Field | Value |
|-------|-------|
| **Precondition** | Input with existing value |
| **Input** | { type: "type", selector: "#search", text: "" } |
| **Expected** | Input value cleared to ""; events still dispatched |
| **Actual** | |
| **Pass/Fail** | |

### TC-TYPE-004: Edge case - type into non-input element (div)

| Field | Value |
|-------|-------|
| **Precondition** | contenteditable div on page |
| **Input** | { type: "type", selector: "#contenteditable", text: "test" } |
| **Expected** | Native setter lookup fails for div; el.value = cmd.text sets property but not visible text |
| **Actual** | |
| **Pass/Fail** | |

### TC-TYPE-005: Edge case - element not found

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "type", selector: "#missing-input", text: "test" } |
| **Expected** | result = "Element not found: #missing-input" |
| **Actual** | |
| **Pass/Fail** | |

### TC-TYPE-006: IT Scenario - SonicWall firewall rule description

| Field | Value |
|-------|-------|
| **Precondition** | SonicWall management UI loaded, firewall rule form visible |
| **Input** | { type: "type", selector: "input[name='rule-description']", text: "Block-social-media-vlan20" } |
| **Expected** | Description field populated; form model updated |
| **Actual** | |
| **Pass/Fail** | |

### TC-TYPE-007: Edge case - type special characters (XSS attempt)

| Field | Value |
|-------|-------|
| **Precondition** | Text input visible |
| **Input** | { type: "type", selector: "#special", text: "<script>alert(1)</script>" } |
| **Expected** | Value set literally (XSS not executed via value setter); events dispatched normally |
| **Actual** | |
| **Pass/Fail** | |

---

## 3. navigate

**Implementation:** background.js - cmd.type === 'navigate' (in runAgentLoop) and execute_command handler
**Validation:** isValidUrl() checks for http: or https: protocol
**Behavior:** chrome.tabs.update(tabId, { url }), waits 2000ms

### TC-NAV-001: Happy path - navigate to HTTPS URL

| Field | Value |
|-------|-------|
| **Precondition** | Extension active, tab open |
| **Input** | { type: "navigate", url: "https://www.google.com" } |
| **Expected** | Tab navigates to google.com; after 2s wait, agent observes new page |
| **Actual** | |
| **Pass/Fail** | |

### TC-NAV-002: Happy path - navigate to HTTP URL

| Field | Value |
|-------|-------|
| **Precondition** | Tab open |
| **Input** | { type: "navigate", url: "http://example.com" } |
| **Expected** | Tab navigates; isValidUrl returns true for http: |
| **Actual** | |
| **Pass/Fail** | |

### TC-NAV-003: Edge case - navigate to chrome:// URL (blocked)

| Field | Value |
|-------|-------|
| **Precondition** | Tab open |
| **Input** | { type: "navigate", url: "chrome://settings" } |
| **Expected** | isValidUrl returns false; result = "Invalid URL: chrome://settings" |
| **Actual** | |
| **Pass/Fail** | |

### TC-NAV-004: Edge case - navigate to malformed URL

| Field | Value |
|-------|-------|
| **Precondition** | Tab open |
| **Input** | { type: "navigate", url: "not-a-url" } |
| **Expected** | isValidUrl throws/returns false; result = "Invalid URL: not-a-url" |
| **Actual** | |
| **Pass/Fail** | |

### TC-NAV-005: Edge case - navigate to empty URL

| Field | Value |
|-------|-------|
| **Precondition** | Tab open |
| **Input** | { type: "navigate", url: "" } |
| **Expected** | isValidUrl("") throws; result = "Invalid URL: " |
| **Actual** | |
| **Pass/Fail** | |

### TC-NAV-006: Edge case - navigate to javascript: URL (XSS attempt)

| Field | Value |
|-------|-------|
| **Precondition** | Tab open |
| **Input** | { type: "navigate", url: "javascript:alert(1)" } |
| **Expected** | isValidUrl returns false; blocked |
| **Actual** | |
| **Pass/Fail** | |

### TC-NAV-007: IT Scenario - navigate to M365 admin portal

| Field | Value |
|-------|-------|
| **Precondition** | Extension active |
| **Input** | { type: "navigate", url: "https://admin.microsoft.com" } |
| **Expected** | Tab loads M365 admin; login page appears if not authenticated |
| **Actual** | |
| **Pass/Fail** | |

---

## 4. scroll

**Implementation:** content.js - cmd.type === 'scroll'
**Behavior:** window.scrollBy(0, cmd.amount) - positive = down, negative = up

### TC-SCROLL-001: Happy path - scroll down

| Field | Value |
|-------|-------|
| **Precondition** | Page with vertical content overflow |
| **Input** | { type: "scroll", amount: 500 } |
| **Expected** | Page scrolls down 500px; result = "Scrolled 500" |
| **Actual** | |
| **Pass/Fail** | |

### TC-SCROLL-002: Happy path - scroll up

| Field | Value |
|-------|-------|
| **Precondition** | Page already scrolled down |
| **Input** | { type: "scroll", amount: -300 } |
| **Expected** | Page scrolls up 300px; result = "Scrolled -300" |
| **Actual** | |
| **Pass/Fail** | |

### TC-SCROLL-003: Edge case - scroll with zero amount

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "scroll", amount: 0 } |
| **Expected** | No visible change; result = "Scrolled 0" |
| **Actual** | |
| **Pass/Fail** | |

### TC-SCROLL-004: Edge case - scroll with no amount field (undefined)

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "scroll" } (no amount property) |
| **Expected** | window.scrollBy(0, undefined) results in no scroll; result = "Scrolled undefined" |
| **Actual** | |
| **Pass/Fail** | |

### TC-SCROLL-005: Edge case - scroll on short page (no overflow)

| Field | Value |
|-------|-------|
| **Precondition** | Page fits entirely in viewport |
| **Input** | { type: "scroll", amount: 5000 } |
| **Expected** | Browser scrolls to bottom (clamped by page height); result = "Scrolled 5000" |
| **Actual** | |
| **Pass/Fail** | |

### TC-SCROLL-006: IT Scenario - scroll through SonicWall log viewer

| Field | Value |
|-------|-------|
| **Precondition** | SonicWall log page loaded with many entries |
| **Input** | { type: "scroll", amount: 800 } repeated 3x |
| **Expected** | Each call scrolls 800px down, revealing more log entries |
| **Actual** | |
| **Pass/Fail** | |

---
﻿## 5. select

**Implementation:** Validated in parseLLMResponse validTypes, but NOT handled in content.js execute_command.
**Expected behavior:** Falls through the if/else if chain in content.js with no match; result stays as "Command failed".

### TC-SELECT-001: Happy path - select option from dropdown (EXPECTED FAILURE)

| Field | Value |
|-------|-------|
| **Precondition** | Select dropdown with options on page |
| **Input** | { type: "select", selector: "#country", value: "uk" } |
| **Expected** | **BUG:** content.js does not handle select; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-SELECT-002: Defect verification - select not in content.js handler

| Field | Value |
|-------|-------|
| **Precondition** | Review content.js source |
| **Input** | Grep for cmd.type === 'select' |
| **Expected** | Not found; confirms missing implementation |
| **Actual** | |
| **Pass/Fail** | |

### TC-SELECT-003: Workaround - select via execute_js

| Field | Value |
|-------|-------|
| **Precondition** | Select dropdown on page |
| **Input** | { type: "execute_js", script: "document.querySelector('#country').value='uk'" } |
| **Expected** | Value set via JavaScript injection (if execute_js is implemented) |
| **Actual** | |
| **Pass/Fail** | |

---

## 6. hover

**Implementation:** Validated in parseLLMResponse validTypes, but NOT handled in content.js.

### TC-HOVER-001: Happy path - hover over element (EXPECTED FAILURE)

| Field | Value |
|-------|-------|
| **Precondition** | Element with hover-triggered dropdown on page |
| **Input** | { type: "hover", selector: "#menu-trigger" } |
| **Expected** | **BUG:** Not implemented; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-HOVER-002: Edge case - hover over non-existent element

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "hover", selector: "#ghost" } |
| **Expected** | **BUG:** Same as above - falls through unhandled |
| **Actual** | |
| **Pass/Fail** | |

### TC-HOVER-003: Workaround - hover via execute_js

| Field | Value |
|-------|-------|
| **Precondition** | Target element exists |
| **Input** | { type: "execute_js", script: "document.querySelector('#el').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))" } |
| **Expected** | Hover effect triggered via synthetic event |
| **Actual** | |
| **Pass/Fail** | |

---

## 7. press_key

**Implementation:** Validated in parseLLMResponse validTypes, but NOT handled in content.js.

### TC-PRESS-001: Happy path - press Enter key (EXPECTED FAILURE)

| Field | Value |
|-------|-------|
| **Precondition** | Text input focused on page |
| **Input** | { type: "press_key", key: "Enter" } |
| **Expected** | **BUG:** Not implemented; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-PRESS-002: Edge case - press_key with no key specified

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "press_key" } |
| **Expected** | **BUG:** Falls through unhandled |
| **Actual** | |
| **Pass/Fail** | |

### TC-PRESS-003: IT Scenario - press Enter to submit M365 user form

| Field | Value |
|-------|-------|
| **Precondition** | M365 "Add user" form filled out |
| **Input** | { type: "press_key", key: "Enter" } |
| **Expected** | **BUG:** Cannot submit form via keyboard; must use click on submit button |
| **Actual** | |
| **Pass/Fail** | |

---

## 8. extract

**Implementation:** Validated in parseLLMResponse validTypes, but NOT handled in content.js.
Related: extract_list is also validated but unimplemented. The page has extract_data and read_page handlers that return structured data.

### TC-EXTRACT-001: Happy path - extract text from element (EXPECTED FAILURE)

| Field | Value |
|-------|-------|
| **Precondition** | Element with extractable text on page |
| **Input** | { type: "extract", selector: "#result" } |
| **Expected** | **BUG:** Not implemented; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-EXTRACT-002: Workaround - extract via read_page

| Field | Value |
|-------|-------|
| **Precondition** | Page with extractable content |
| **Input** | { type: "read_page" } - then parse page content in LLM |
| **Expected** | Full page text returned; LLM can extract specific values |
| **Actual** | |
| **Pass/Fail** | |

### TC-EXTRACT-003: Workaround - extract via observe_page + element selection

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | Agent calls observe_page then identifies target in returned element list |
| **Expected** | Agent reads element text from observation data |
| **Actual** | |
| **Pass/Fail** | |

---

## 9. wait_for_text

**Implementation:** Validated in parseLLMResponse validTypes, but NOT handled in content.js.

### TC-WAITTEXT-001: Happy path - wait for text to appear (EXPECTED FAILURE)

| Field | Value |
|-------|-------|
| **Precondition** | Page loading dynamically |
| **Input** | { type: "wait_for_text", text: "Loading complete" } |
| **Expected** | **BUG:** Not implemented; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-WAITTEXT-002: Edge case - wait for text that never appears

| Field | Value |
|-------|-------|
| **Precondition** | Static page without target text |
| **Input** | { type: "wait_for_text", text: "Never appears", timeout: 5000 } |
| **Expected** | **BUG:** Would need timeout handling; unimplemented |
| **Actual** | |
| **Pass/Fail** | |

### TC-WAITTEXT-003: Workaround - use read_page in polling loop

| Field | Value |
|-------|-------|
| **Precondition** | Page loading |
| **Input** | Agent issues read_page repeatedly until target text appears |
| **Expected** | Agent loop handles retry; LLM sees updated page content |
| **Actual** | |
| **Pass/Fail** | |

---
﻿## 10. wait_for_element

**Implementation:** Validated in parseLLMResponse validTypes, but NOT handled in content.js.

### TC-WAITELEM-001: Happy path - wait for element to appear (EXPECTED FAILURE)

| Field | Value |
|-------|-------|
| **Precondition** | SPA loading content dynamically |
| **Input** | { type: "wait_for_element", selector: "#results-table" } |
| **Expected** | **BUG:** Not implemented; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-WAITELEM-002: Workaround - use observe_page polling

| Field | Value |
|-------|-------|
| **Precondition** | SPA loading |
| **Input** | Agent observes page, checks for element, repeats if not found |
| **Expected** | observe_page returns element list; agent retries until element appears |
| **Actual** | |
| **Pass/Fail** | |

---

## 11. wait_for_navigation

**Implementation:** NOT validated in parseLLMResponse validTypes. An LLM response with this type would be rejected as "Invalid command type: wait_for_navigation".

### TC-WAITNAV-001: Happy path - wait for page navigation (EXPECTED FAILURE)

| Field | Value |
|-------|-------|
| **Precondition** | Form submission expected to trigger navigation |
| **Input** | { type: "wait_for_navigation" } |
| **Expected** | **BUG:** Not in validTypes; parseLLMResponse returns { type: "note", text: "Parse error..." } |
| **Actual** | |
| **Pass/Fail** | |

### TC-WAITNAV-002: Defect - wait_for_navigation missing from validTypes

| Field | Value |
|-------|-------|
| **Precondition** | Review background.js:parseLLMResponse |
| **Input** | Check validTypes array |
| **Expected** | wait_for_navigation is NOT listed; must be added |
| **Actual** | |
| **Pass/Fail** | |

### TC-WAITNAV-003: Workaround - use read_page to detect URL change

| Field | Value |
|-------|-------|
| **Precondition** | After action that triggers navigation |
| **Input** | { type: "read_page" } - check URL in returned content |
| **Expected** | Agent sees new URL and confirms navigation completed |
| **Actual** | |
| **Pass/Fail** | |

---

## 12. execute_js

**Implementation:** Validated in parseLLMResponse validTypes, but NOT handled in content.js execute_command. However, background.js has generateMissingTool() which dynamically generates and injects JS via chrome.scripting.executeScript as an auto-recovery mechanism.

### TC-EXECJS-001: Happy path - execute custom JavaScript (EXPECTED FAILURE via content.js)

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "execute_js", script: "return document.title" } |
| **Expected** | **BUG:** Not handled in content.js; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-EXECJS-002: Auto-tool generation - LLM generates workaround script

| Field | Value |
|-------|-------|
| **Precondition** | Agent step fails; generateMissingTool invoked |
| **Input** | Error message + step description sent to LLM |
| **Expected** | LLM generates JS snippet; injected via chrome.scripting.executeScript; result returned |
| **Actual** | |
| **Pass/Fail** | |

### TC-EXECJS-003: Edge case - generated script returns no value

| Field | Value |
|-------|-------|
| **Precondition** | Auto-tool generates script without return statement |
| **Input** | Script like document.querySelector('#btn').click() |
| **Expected** | results[0].result may be undefined; falls back to { success: true } |
| **Actual** | |
| **Pass/Fail** | |

### TC-EXECJS-004: Security - generated script attempts privileged access

| Field | Value |
|-------|-------|
| **Precondition** | Auto-tool active |
| **Input** | LLM generates chrome.cookies.getAll(...) |
| **Expected** | Script runs in MAIN world, not extension context; chrome API unavailable; fails gracefully |
| **Actual** | |
| **Pass/Fail** | |

---

## 13. read_page

**Implementation:** content.js - request.action === 'read_page' (separate from execute_command)
**Behavior:** Returns { content: "Page Title: ... URL: ... {body.innerText}" }

Note: read_page is handled as a message action, not as a command.type. When the LLM returns { type: "read_page" }, the agent loop processes it as a regular command via sendMessageWithRetry, but content.js handles it via the read_page action listener, NOT the execute_command handler.

### TC-READPG-001: Happy path - read page content

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded with visible content |
| **Input** | sendMessage(tab, { action: 'read_page' }) |
| **Expected** | Returns { content: "Page Title: ... URL: ... {page text}" } |
| **Actual** | |
| **Pass/Fail** | |

### TC-READPG-002: Edge case - read empty page

| Field | Value |
|-------|-------|
| **Precondition** | about:blank or page with empty body |
| **Input** | { action: 'read_page' } |
| **Expected** | Returns { content: "Page Title:  URL: about:blank" } |
| **Actual** | |
| **Pass/Fail** | |

### TC-READPG-003: Edge case - read very long page (performance)

| Field | Value |
|-------|-------|
| **Precondition** | Page with over 100KB of text |
| **Input** | { action: 'read_page' } |
| **Expected** | Returns full innerText; may impact LLM token budget |
| **Actual** | |
| **Pass/Fail** | |

### TC-READPG-004: LLM-driven read_page as command type

| Field | Value |
|-------|-------|
| **Precondition** | Agent loop running |
| **Input** | LLM returns { type: "read_page" } |
| **Expected** | Sent as execute_command to content.js; falls through unhandled; result = "Command failed" |
| **Actual** | |
| **Pass/Fail** | |

### TC-READPG-005: IT Scenario - read M365 user list page

| Field | Value |
|-------|-------|
| **Precondition** | M365 Admin > Users page loaded |
| **Input** | { action: 'read_page' } |
| **Expected** | Returns user list text; LLM can extract user names, emails, license status |
| **Actual** | |
| **Pass/Fail** | |

---
﻿## 14. note

**Implementation:** Validated in parseLLMResponse validTypes; no DOM action. Used internally by the parser as a fallback when:
1. LLM returns a response with no type field (converted to note)
2. LLM response fails JSON parsing entirely (converted to note with error text)

### TC-NOTE-001: Happy path - note returned for non-actionable LLM response

| Field | Value |
|-------|-------|
| **Precondition** | Agent loop running |
| **Input** | LLM returns { summary: ["Step 1 done", "Step 2 pending"] } (no type field) |
| **Expected** | parseLLMResponse converts to { type: "note", text: "[Processed] Step 1 done. Step 2 pending" } |
| **Actual** | |
| **Pass/Fail** | |

### TC-NOTE-002: Edge case - completely unparseable LLM response

| Field | Value |
|-------|-------|
| **Precondition** | Agent loop running |
| **Input** | LLM returns plain text instead of JSON |
| **Expected** | parseLLMResponse JSON parse fails; returns { type: "note", text: "Parse error (will retry): ..." } |
| **Actual** | |
| **Pass/Fail** | |

### TC-NOTE-003: note command in execute_command handler

| Field | Value |
|-------|-------|
| **Precondition** | Page loaded |
| **Input** | { type: "note", text: "Observation recorded" } sent via execute_command |
| **Expected** | content.js does not handle note in execute_command; result = "Command failed"; agent loop continues |
| **Actual** | |
| **Pass/Fail** | |

---

## 15. finish

**Implementation:** background.js - runAgentLoop checks command.type === 'finish'
**Behavior:** Sets finished = true, breaks loop, clears agent history, resets tier router escalation

### TC-FINISH-001: Happy path - finish with summary

| Field | Value |
|-------|-------|
| **Precondition** | Agent loop running, goal achieved |
| **Input** | LLM returns { type: "finish", summary: "Extracted 5 email addresses" } |
| **Expected** | Loop terminates; sendSilentUpdate("Task completed: ..."); agentRunning = false |
| **Actual** | |
| **Pass/Fail** | |

### TC-FINISH-002: Edge case - finish with no summary

| Field | Value |
|-------|-------|
| **Precondition** | Agent loop running |
| **Input** | { type: "finish" } |
| **Expected** | Loop terminates; command.summary is undefined |
| **Actual** | |
| **Pass/Fail** | |

### TC-FINISH-003: Edge case - finish called prematurely (goal not met)

| Field | Value |
|-------|-------|
| **Precondition** | Agent on step 2 of 5-step task |
| **Input** | LLM returns { type: "finish", summary: "Done" } prematurely |
| **Expected** | Loop terminates regardless; no validation of goal completion |
| **Actual** | |
| **Pass/Fail** | |

### TC-FINISH-004: Edge case - finish during plan execution

| Field | Value |
|-------|-------|
| **Precondition** | executePlan() running through pre-planned steps |
| **Input** | N/A - finish is only checked in runAgentLoop, not in executePlan |
| **Expected** | executePlan runs all steps; finish type never checked |
| **Actual** | |
| **Pass/Fail** | |

---

## Integration and E2E Scenarios

### E2E-001: Google Search + Extract First Result

| Step | Action | Details |
|------|--------|---------|
| 1 | navigate | https://www.google.com |
| 2 | type | Selector: input[name="q"], text: "Sentinel Override extension" |
| 3 | click | Selector: input[type="submit"] |
| 4 | read_page | Observe search results |
| 5 | extract | First result title (BUG: unimplemented - must use read_page workaround) |
| 6 | finish | Summary with extracted title |

### E2E-002: GitHub Repo Navigation + README Section

| Step | Action | Details |
|------|--------|---------|
| 1 | navigate | https://github.com/dirtysouthalpha/sentinel-override |
| 2 | read_page | Get README content |
| 3 | scroll | amount: 500 to reach Configuration section |
| 4 | read_page | Confirm section visible |
| 5 | finish | Summary of configuration options |

### E2E-003: Fill and Submit 5-Field Form

| Step | Action | Details |
|------|--------|---------|
| 1 | navigate | Test form page |
| 2 | type | Name field: "John Doe" |
| 3 | type | Email field: "john@example.com" |
| 4 | select | Country dropdown: "us" (BUG: unimplemented) |
| 5 | type | Notes field: "Test submission" |
| 6 | click | Submit button |
| 7 | finish | Summary of form submission |

### E2E-004: M365 Admin - User Lookup Workflow

| Step | Action | Details |
|------|--------|---------|
| 1 | navigate | https://admin.microsoft.com |
| 2 | read_page | Confirm admin portal loaded |
| 3 | click | Users > Active users nav |
| 4 | type | Search box: "test.user@contoso.com" |
| 5 | wait_for_text | Wait for user to appear (BUG: unimplemented) |
| 6 | read_page | Workaround: read page to confirm user visible |
| 7 | click | User row |
| 8 | finish | Summary: user details displayed |

### E2E-005: SonicWall Config - Firewall Rule Creation

| Step | Action | Details |
|------|--------|---------|
| 1 | navigate | Firewall management URL |
| 2 | type | Username field |
| 3 | type | Password field |
| 4 | click | Login button |
| 5 | navigate | Navigate to firewall rules page |
| 6 | click | Add Rule button |
| 7 | type | Rule name field |
| 8 | select | Action dropdown (BUG: unimplemented) |
| 9 | click | Save/Apply button |
| 10 | finish | Summary: rule created |

---
﻿## Regression and Edge-Case Matrix

### Cross-Cutting Concerns

| Test ID | Category | Description | Affected Actions |
|---------|----------|-------------|------------------|
| REG-001 | Rate limiting | Agent respects CONFIG.minDelayBetweenCalls (2s) between API calls | All LLM-driven actions |
| REG-002 | Retry logic | sendMessageWithRetry retries 3x with exponential backoff | click, type, scroll |
| REG-003 | Cost safety | validateModelCost blocks calls exceeding session budget | All LLM-driven actions |
| REG-004 | Tier escalation | Failed steps trigger tier escalation via ModelTierRouter.recordFailure | All LLM-driven actions |
| REG-005 | Tab closure | Agent stops gracefully when working tab is closed | All actions |
| REG-006 | Content script injection | content.js injected before each command via chrome.scripting.executeScript | click, type, scroll |
| REG-007 | Parse error recovery | Invalid LLM responses converted to note type | All |
| REG-008 | action to type fixup | LLM returning action:"click" auto-corrected to type:"click" | All |
| REG-009 | Screenshot quality | Screenshots captured at JPEG quality 30 to minimize tokens | All LLM-driven steps |
| REG-010 | Auto-tool recovery | Failed steps trigger generateMissingTool once per step | All failing actions |

---

## Defects Found

### DEF-001: content.js missing handlers for select, hover, press_key, extract, wait_for_text, wait_for_element, execute_js

- **Severity:** High
- **Impact:** 7 of 15 action types fail silently at runtime
- **Root Cause:** content.js only implements click, type, and scroll in the execute_command handler
- **Fix:** Add else-if branches for each missing action type in content.js

### DEF-002: wait_for_navigation not in validTypes

- **Severity:** Medium
- **Impact:** LLM responses with type: "wait_for_navigation" are rejected by parseLLMResponse
- **Root Cause:** validTypes array in background.js does not include "wait_for_navigation"
- **Fix:** Add "wait_for_navigation" to validTypes array

### DEF-003: read_page routing mismatch

- **Severity:** Medium
- **Impact:** LLM returning { type: "read_page" } gets sent as execute_command to content.js, which does not handle it; only the read_page message action works
- **Root Cause:** Agent loop sends all non-navigate commands via execute_command; read_page is only handled as a top-level message action
- **Fix:** Either add read_page to execute_command handler in content.js, or check for read_page type in background.js and send as { action: 'read_page' } instead

### DEF-004: note type sent to content.js as execute_command

- **Severity:** Low
- **Impact:** Note commands produce "Command failed" in content.js; harmless but noisy
- **Root Cause:** Agent loop does not filter note type before sending to content.js
- **Fix:** Add early return in agent loop when command.type === 'note'

### DEF-005: Default error result "Command failed" is not actionable

- **Severity:** Low
- **Impact:** When an unimplemented action falls through, the error message does not indicate which action was attempted
- **Root Cause:** let result = "Command failed" is the default string
- **Fix:** Change to "Command not implemented: " + cmd.type for better debugging

---

## Appendix

### A. Test Execution Checklist

- [ ] TC-CLICK-001 through TC-CLICK-007
- [ ] TC-TYPE-001 through TC-TYPE-007
- [ ] TC-NAV-001 through TC-NAV-007
- [ ] TC-SCROLL-001 through TC-SCROLL-006
- [ ] TC-SELECT-001 through TC-SELECT-003
- [ ] TC-HOVER-001 through TC-HOVER-003
- [ ] TC-PRESS-001 through TC-PRESS-003
- [ ] TC-EXTRACT-001 through TC-EXTRACT-003
- [ ] TC-WAITTEXT-001 through TC-WAITTEXT-003
- [ ] TC-WAITELEM-001 through TC-WAITELEM-002
- [ ] TC-WAITNAV-001 through TC-WAITNAV-003
- [ ] TC-EXECJS-001 through TC-EXECJS-004
- [ ] TC-READPG-001 through TC-READPG-005
- [ ] TC-NOTE-001 through TC-NOTE-003
- [ ] TC-FINISH-001 through TC-FINISH-004
- [ ] E2E-001 through E2E-005
- [ ] REG-001 through REG-010

### B. Test Metrics Summary

| Metric | Value |
|--------|-------|
| Total test cases | 52 |
| Implemented action coverage | 4/15 (27%) |
| Known defects | 5 |
| Critical defects | 1 (DEF-001: 7 actions unimplemented) |
| E2E scenario coverage | 5 real-world IT workflows |
| IT-specific test cases | 6 (M365, SonicWall) |
