# Sentinel Override — Chrome Extension for IT Automation

AI-powered browser automation agent as a Chrome extension. Used daily by an IT Support Technician for investigating, configuring, and troubleshooting web applications.

## What To Do (Priority Order)
1. Run `npm test` — fix ALL failing tests first.
2. Run `npx eslint .` — fix ALL lint errors.
3. Improve test coverage — add tests for any remaining untested code paths in popup-modules/, background/, content/. Target: every module should have ≥80% branch coverage.
4. Edge case hardening:
   - Add error handling tests for every module's failure modes
   - Test race conditions in scheduler and tab-manager
   - Test LLM client with malformed responses
   - Test content scripts in shadow DOM + cross-origin iframe scenarios
5. Performance optimizations:
   - Profile and reduce memory usage in long-running sessions
   - Optimize DOM mutation observers in content scripts
   - Debounce/throttle expensive operations (telemetry, audit logging)
6. Documentation:
   - Add JSDoc to any undocumented exported functions
   - Ensure every module has a header comment explaining its purpose
7. Code quality:
   - Refactor any functions over 50 lines into smaller units
   - Consolidate duplicate utility functions across modules
   - Ensure all async operations have proper timeout handling
8. After each logical unit of work: commit with a descriptive message and push.

## Commands
- Test: `npm test`
- Lint: `npx eslint .`
- Build: `node scripts/build.js`

## Architecture
- **Manifest V3** Chrome extension
- **background/** — Service worker (agent engine, LLM client, scheduler, providers)
- **content/** — Content scripts (cursor, DOM utils, shadow DOM, frame management)
- **popup-modules/** — Side panel UI modules (chat, settings, templates, scheduler, telemetry)
- **tests/** — Jest test suite with 70 test files
- Multi-provider LLM support (OpenAI, Anthropic, Google, xAI, DeepSeek, etc.)

## Completed Features (May 13–17 Grind)
- ✅ Context menu right-click AI actions (analyze, extract, fill form, screenshot, summarize) — wired to agent engine (v3.44)
- ✅ Page monitor DOM change watcher with storage persistence and alarm-based polling
- ✅ HTML report export from audit log
- ✅ Macro recorder with live recording, replay, import/export
- ✅ Execute JS approval gate
- ✅ Service worker resume handling
- ✅ 7 new IT platform profiles (Cisco, Huntress, Palo Alto, SentinelOne, VirusTotal, Network Device, NVD)
- ✅ ESLint config and full codebase lint pass
- ✅ 145+ silent catch blocks logged across 22+ files
- ✅ Comprehensive test expansion (provider-registry 24→138, platform 12→90, overlay-detector 8→72, etc.)
- ✅ XSS fixes and security hardening

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
