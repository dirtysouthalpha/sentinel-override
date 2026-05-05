# Sentinel Override

## What This Is

Sentinel Override is a Chrome Extension (Manifest V3) that performs AI-powered browser automation via a side panel. It watches the current web page, sends screenshots and DOM observations to an LLM, receives structured JSON commands back, and executes those commands — clicking, typing, scrolling, extracting data, navigating, and more. It runs an observe-reason-act loop until the user's goal is achieved. Built for IT professionals, security analysts, and power users who need autonomous browser interaction.

## Core Value

Reliable, multi-provider AI browser automation that works with any LLM API the user configures — one extension, any model, full control.

## Requirements

### Validated

- ✓ Agent loop (observe → reason → act) — existing
- ✓ 15 command types in content.js — existing
- ✓ Plan-execute workflow with approval mode — existing
- ✓ Set-of-marks visual overlay — existing
- ✓ Cost safety with rate tables — existing
- ✓ 7 visual themes — existing
- ✓ Persistent settings, shortcuts, chat history — existing
- ✓ Analysis mode with conversation history — existing
- ✓ Voice input via Web Speech API — existing
- ✓ Screenshot capture and vision-based interaction — existing

### Active

- [ ] Modular provider architecture (z.ai, OpenRouter, Anthropic Claude, OpenAI native)
- [ ] Native Anthropic Messages API support (non-OpenAI-compatible)
- [ ] Native OpenAI API support with proper model routing
- [ ] All existing bugs fixed and edge cases handled
- [ ] Comprehensive error handling and user-facing error messages
- [ ] Clean, professional documentation matching actual codebase
- [ ] Chrome Web Store-ready presentation (icons, screenshots, listing)
- [ ] Automated test suite covering core functionality

### Out of Scope

- Multi-user auth — single-user extension, no backend
- Real-time collaboration — not a team tool
- Mobile support — Chrome extension, desktop only
- Auto-updates — Chrome Web Store handles this
- Custom fine-tuned models — user brings their own API keys
- Firefox/Edge support — Chrome MV3 only for v1

## Context

**Current state:** Monolithic vanilla JS Chrome extension. All provider logic inlined in background.js (1649 lines). Content script at 630 lines. UI at popup-full.js (1519 lines) + popup.html (266 lines). No build system, no tests, no bundler.

**Key issues to address:**
- ARCHITECTURE.md describes modular provider code that doesn't exist — everything is inlined
- Naming inconsistency: "Sentinel Override" (manifest), "Sentinel Overdrive" (README), "SentinelAgent" (code), "Sentinel Prime" (ARCHITECTURE.md)
- Cost safety blocks Claude models by prefix — needs to allow Claude when using Anthropic API directly
- Only OpenAI-compatible endpoints supported — no native Anthropic Messages API
- No automated tests despite 52-case test plan
- TTS feature depends on localhost:8765 server with no documentation
- `eval()` usage in auto-tool generation is a security risk

**Target audience:** IT professionals (Premier Networx use case), security analysts, developers, power users. Also targeting GitHub popularity to drive attention to DirtySouthAlpha ecosystem.

## Constraints

- **Platform:** Chrome Extension MV3 — service worker, no persistent background
- **Language:** Vanilla JavaScript (no TypeScript transpilation, no build step)
- **Storage:** chrome.storage.local only — no backend database
- **API format:** Must support both OpenAI-compatible (z.ai, OpenRouter) AND Anthropic Messages API
- **Security:** Content script runs in page context, extension pages have strict CSP
- **Performance:** Side panel must remain responsive during agent loop
- **Cost:** Users bring their own API keys — extension must handle billing errors gracefully

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS, no build step | Simplicity, fast iteration, direct Chrome loading | — Pending |
| Modular provider abstraction | Support multiple API formats (OpenAI-compat + Anthropic native) | — Pending |
| z.ai as primary provider | User's max coding plan — best cost/performance ratio | — Pending |
| Keep cost safety but make provider-aware | Prevent accidental spend without blocking valid provider+model combos | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-04 after initialization*
