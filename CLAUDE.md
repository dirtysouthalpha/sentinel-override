# Sentinel Override — Chrome Extension for IT Automation

AI-powered browser automation agent as a Chrome extension. Used daily by an IT Support Technician for investigating, configuring, and troubleshooting web applications.

## What To Do (Priority Order)
1. Run `npm test` — fix ALL failing tests first.
2. Run `npx eslint .` — fix ALL lint errors.
3. Finish in-progress features:
   - `background/context-menu.js` — right-click AI actions (analyze, extract, fill form, screenshot, summarize). Handlers need wiring to agent engine.
   - `background/page-monitor.js` — DOM change watcher. Storage persistence and alarm-based polling need integration.
   - `background/export-report.js` — HTML report generator from audit log. Verify it renders correctly.
   - `background/macro-recorder.js` — record/replay/import/export action macros. Verify roundtrip works.
4. Improve test coverage — add tests for untested code paths in popup-modules/, background/, content/.
5. Fix any bugs, improve error handling, reduce complexity.
6. After each logical unit of work: commit with a descriptive message and push.

## Commands
- Test: `npm test`
- Lint: `npx eslint .`
- Build: `node scripts/build.js`

## Architecture
- **Manifest V3** Chrome extension
- **background/** — Service worker (agent engine, LLM client, scheduler, providers)
- **content/** — Content scripts (cursor, DOM utils, shadow DOM, frame management)
- **popup-modules/** — Side panel UI modules (chat, settings, templates, scheduler, telemetry)
- **tests/** — Jest test suite with ~90 test files
- Multi-provider LLM support (OpenAI, Anthropic, Google, xAI, DeepSeek, etc.)

## Code Standards
- Vanilla JavaScript (no TypeScript, no build step for background/content)
- Jest for testing with `--experimental-vm-modules`
- 2-space indentation
- JSDoc comments on exported functions
- Error handling: every catch block should log, never swallow silently

## Critical Rules
- NEVER break existing tests. If a test fails after your change, fix it.
- NEVER add npm dependencies without a compelling reason.
- Commit early, commit often. Small focused commits > big messy ones.
- Push after every commit so progress isn't lost.
- If you hit a wall, skip and move to the next task.
- Version is in manifest.json — bump patch version for each feature commit.
