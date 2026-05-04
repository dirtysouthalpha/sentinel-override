# Phase 4 Plan 1: Investigation Report Generation Summary

Structured report generation that produces copy-paste-ready markdown reports after agent task completion, with popup UI for viewing and exporting.

**One-liner:** Async LLM-powered investigation report with Goal/Steps/Findings/Evidence/Conclusions sections, inline card preview, modal view, and three export options (copy markdown, download .md, copy plain text).

---

## Metadata

| Field       | Value                          |
|-------------|--------------------------------|
| Phase       | 04-reports-multi-provider-llm  |
| Plan        | 01                             |
| Subsystem   | Reports                        |
| Tags        | report-generation, LLM, popup, export, markdown |
| Duration    | 3 minutes                      |
| Completed   | 2026-05-04                     |
| Status      | Complete                       |

## Dependency Graph

| Direction  | Target                    | Description                                        |
|------------|---------------------------|----------------------------------------------------|
| requires   | 01-01, 01-02             | Agent engine, LLM client, message protocol modules  |
| provides   | Report generation system  | background/report-generator.js + popup UI           |
| affects    | 04-02                     | Multi-provider LLM (independent, no overlap)        |

## Tech Tracking

| Category          | Items                                                    |
|-------------------|----------------------------------------------------------|
| tech-stack.added  | None (uses existing marked.js for markdown rendering)    |
| tech-stack.patterns | Async post-loop report generation (non-blocking .then()) |

## File Tracking

### Created
- `background/report-generator.js` (248 lines) - Report generation module

### Modified
- `background/agent-engine.js` - Added report data capture, async report generation trigger
- `background/message-protocol.js` - Added sendReportUpdate() function
- `background/index.js` - Added report-generator.js import
- `popup.html` - Added report modal HTML and report card CSS
- `popup-full.js` - Added report card, modal, export handlers, message handlers

## Tasks Completed

| Task | Name                                        | Commit  | Files                                                      |
|------|---------------------------------------------|---------|------------------------------------------------------------|
| 1    | Create report-generator.js and wire into agent-engine | 49b448b | report-generator.js, agent-engine.js, message-protocol.js, index.js |
| 2    | Add report card and modal UI with export options | 8141a4b | popup.html, popup-full.js                                    |

## Decisions Made

- [04-01]: Report generation is async (non-blocking) -- uses .then() after loop exit so the "Task completed" message appears immediately
- [04-01]: reportData snapshot captured BEFORE history is cleared, ensuring data survives cleanup
- [04-01]: Report LLM call is a dedicated fetch (not callLLMWithRetry) because the report prompt has different format requirements than the agent prompt -- reuses isAnthropicEndpoint for API format detection
- [04-01]: Fallback report built from raw execution data when LLM call fails -- ensures user always gets something useful
- [04-01]: Report modal reuses existing .modal CSS class for consistent z-index and backdrop behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Report LLM call does not use callLLMWithRetry directly**

- **Found during:** Task 1
- **Issue:** The plan said to use callLLMWithRetry for report generation, but that function has a tightly coupled signature (trimmedElements, totalElementCount, etc.) designed for agent commands. Report generation needs a different prompt format and does not produce JSON commands.
- **Fix:** Created a dedicated `generateReportViaLLM()` function that makes its own fetch call but reuses `isAnthropicEndpoint()` for API format detection. This follows the same retry/error pattern but with appropriate parameters for report generation.
- **Files modified:** background/report-generator.js
- **Commit:** 49b448b

## Authentication Gates

None encountered.

## Next Phase Readiness

- Report generation is fully independent from the multi-provider LLM work (plan 04-02)
- No blockers identified
- The fallback report mechanism ensures graceful degradation even if LLM calls fail
