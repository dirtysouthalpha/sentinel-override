# Sentinel Override

## What This Is

A Chrome browser extension that acts as an AI-powered browser automation agent for MSP/IT operations. Users give it a command — a runbook to execute, a natural language goal, or a guided workflow — and the agent drives the browser to completion, navigating web UIs (SonicWall, Fortinet, Office 365, etc.), executing investigation/management tasks, and producing structured investigation reports. Organization-wide deployment target.

## Core Value

Give a command in any form and the agent drives the browser to completion, then generates a structured report — regardless of the web UI or task complexity.

## Requirements

### Validated

- ✓ Agent loop with plan-observe-act cycle — existing (`background.js`)
- ✓ Content script DOM interaction (click, type, navigate, observe) — existing (`content.js`)
- ✓ Side panel chat UI with command input — existing (`popup.html`, `popup-full.js`)
- ✓ Platform detection for SonicWall, Fortinet, Cisco, Palo Alto — existing (`background.js` getPlatformContext)
- ✓ LLM integration for decision-making — existing
- ✓ Self-healing retry logic — existing
- ✓ Memory system with template substitution — existing
- ✓ Chrome Manifest V3 architecture — existing

### Active

- [ ] Agent recovers from stalls instead of getting stuck indefinitely
- [ ] Agent planning produces accurate step sequences that match user intent
- [ ] Multi-tab workflows — agent operates across multiple browser tabs
- [ ] Complex UI interactions: dropdowns, nested menus, date pickers, file uploads, rich text editors
- [ ] Iframe and shadow DOM element interaction
- [ ] SPA page transition handling (content changes without full navigation)
- [ ] Structured investigation report generation after task completion
- [ ] Multi-provider LLM support (Claude, OpenAI, others)
- [ ] Reliable enough for organization-wide deployment

### Out of Scope

- Native mobile support — Chrome extension only
- Server-side orchestration — runs entirely in-browser
- Non-browser automation (CLI, SSH, API calls outside the browser)
- Custom LLM model training or fine-tuning

## Context

The extension (v3.1.3) already has functional bones: an agent loop in `background.js`, content scripts in `content.js`, a chat UI in `popup.html`/`popup-full.js`, and platform-specific detection. The codebase map in `.planning/codebase/` documents the full existing state.

Key technical debt: monolithic files (popup-full.js is ~1,257 lines), global state management, inconsistent error handling, no test infrastructure, and fragile iframe/message passing. These structural issues contribute to the reliability problems.

The user is an MSP tech who uses this for firewall investigations (SonicWall, Fortinet), Office 365 admin tasks, and other browser-based IT operations. The extension needs to handle enterprise web UIs that are often complex — nested menus, iframes, SPAs with dynamic content.

## Constraints

- **Platform**: Chrome Manifest V3 — must work within MV3 constraints (service worker lifecycle, no background pages)
- **Storage**: Chrome storage API only — no IndexedDB initially, no server-side storage
- **LLM**: Must support multiple providers (Claude, OpenAI) — user already has multi-provider setup
- **Security**: No dynamic code execution beyond what's needed — `new Function()` in content.js needs review
- **Deployment**: Organization-wide — needs to be stable enough for non-technical users
- **Offline**: No — requires LLM API access to function

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Enhance existing code vs rewrite | Working agent loop exists; rewriting loses platform detection, memory system, UI work | — Pending |
| Multi-tab as core capability | MSP investigations often require cross-tab workflows (compare logs, check multiple systems) | — Pending |
| Structured reports over audit logs | Users need copy-paste ticket documentation, not raw action logs | — Pending |
| Keep MV3 architecture | Chrome extension constraints are acceptable; no migration to Firefox/Safari needed | — Pending |

---
*Last updated: 2026-04-24 after initialization*
