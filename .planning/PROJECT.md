# Sentinel Override

## What This Is

A Chrome browser extension that acts as an AI-powered browser automation agent for MSP/IT operations. Users give it a command — a runbook to execute, a natural language goal, or a guided workflow — and the agent drives the browser to completion, navigating web UIs (SonicWall, Fortinet, Office 365, etc.), executing investigation/management tasks, and producing structured investigation reports. Organization-wide deployment target.

## Core Value

Give a command in any form and the agent drives the browser to completion, then generates a structured report — regardless of the web UI or task complexity.

## Current Milestone: v2

**Goal:** Make Sentinel Override production-ready and powerful — test infrastructure, tech debt cleanup, command templates for runbook reuse, agent scheduling, and team collaboration.

**Target features:**
- Test infrastructure (unit, integration, E2E)
- Tech debt cleanup and security hardening
- Command templates / saved runbooks
- Agent scheduling
- Report and runbook collaboration

## Current State

**Shipped:** v1 milestone (2026-05-04) — 4 phases, 8 plans, 20/20 requirements satisfied.
**In Progress:** v2 milestone — quality, testing, and power-user features.

The extension has a modular background service worker (8 ES modules), modular content scripts (9 utility modules), multi-tab infrastructure, structured report generation, and multi-provider LLM support (Claude/OpenAI). See `.planning/MILESTONES.md` for full delivery details.

## Requirements

### Validated

- ✓ Agent loop with plan-observe-act cycle — existing (v1)
- ✓ Content script DOM interaction (click, type, navigate, observe) — existing (v1)
- ✓ Side panel chat UI with command input — existing (v1)
- ✓ Platform detection for SonicWall, Fortinet, Cisco, Palo Alto — existing (v1)
- ✓ LLM integration for decision-making — existing (v1)
- ✓ Self-healing retry logic — existing (v1)
- ✓ Memory system with template substitution — existing (v1)
- ✓ Chrome Manifest V3 architecture — existing (v1)
- ✓ Agent recovers from stalls instead of getting stuck indefinitely — v1 (REL-01)
- ✓ Agent planning produces accurate step sequences that match user intent — v1 (REL-02)
- ✓ Complex UI interactions: dropdowns, nested menus, date pickers, file uploads, rich text editors — v1 (UIX-01 through UIX-05)
- ✓ Iframe and shadow DOM element interaction — v1 (UIX-03, UIX-04)
- ✓ SPA page transition handling (content changes without full navigation) — v1 (REL-03)
- ✓ Multi-tab workflows — agent operates across multiple browser tabs — v1 (TAB-01, TAB-02, TAB-03)
- ✓ Structured investigation report generation after task completion — v1 (RPT-01, RPT-02, RPT-03)
- ✓ Multi-provider LLM support (Claude, OpenAI) with per-provider settings — v1 (LLM-01, LLM-02, LLM-03)
- ✓ Modular background architecture with standardized error handling — v1 (HEA-01, HEA-02)
- ✓ Content script DOM operations extracted into reusable utilities — v1 (HEA-03)

### Active

- [ ] Test infrastructure for confident code changes
- [ ] Tech debt cleanup and security hardening
- [ ] Command templates / saved runbooks for re-use
- [ ] Agent scheduling — queue tasks to run at specific times
- [ ] Collaboration — share reports and runbooks with team members
- [ ] Reliable enough for organization-wide deployment

### Out of Scope

- Native mobile support — Chrome extension only
- Server-side orchestration — runs entirely in-browser
- Non-browser automation (CLI, SSH, API calls outside the browser)
- Custom LLM model training or fine-tuning
- Firefox/Safari support — Chrome-only deployment

## Context

The extension has been transformed from a v3.1.3 prototype into a modular, reliable agent. The codebase consists of 8 background ES modules (agent-engine, llm-client, tab-manager, message-protocol, tab-context, report-generator, provider-registry, shared-state, frame-router, index), 9 content script modules, a popup UI, and a Manifest V3 configuration.

Remaining tech debt: old content.js alongside content/ directory, popup-full.js at ~1,450 lines, no test infrastructure. v2 requirements include testing (TST-01, TST-02, TST-03) and advanced capabilities (command templates, scheduling, collaboration).

## Constraints

- **Platform**: Chrome Manifest V3 — must work within MV3 constraints (service worker lifecycle, no background pages)
- **Storage**: Chrome storage API only — no IndexedDB initially, no server-side storage
- **LLM**: Supports multiple providers (Claude, OpenAI) via provider registry pattern
- **Security**: `new Function()` in content.js needs review
- **Deployment**: Organization-wide — needs to be stable enough for non-technical users
- **Offline**: No — requires LLM API access to function

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Enhance existing code vs rewrite | Working agent loop exists; rewriting loses platform detection, memory system, UI work | ✓ Enhanced — modular refactoring preserved all existing functionality |
| Multi-tab as core capability | MSP investigations often require cross-tab workflows (compare logs, check multiple systems) | ✓ Delivered — tab-context.js with open/switch/close, LLM vocabulary, popup tab bar |
| Structured reports over audit logs | Users need copy-paste ticket documentation, not raw action logs | ✓ Delivered — async LLM report with Goal/Steps/Findings/Evidence/Conclusions |
| Keep MV3 architecture | Chrome extension constraints are acceptable; no migration to Firefox/Safari needed | ✓ Maintained |
| Provider registry pattern | Consolidates Anthropic/OpenAI API format differences into single module | ✓ Delivered — PROVIDERS object with buildHeaders/buildBody/parseResponse |
| IIFE namespace for content scripts | Content scripts cannot use ES module imports in Chrome extensions | ✓ Delivered — window.__sentinelUtils namespace |
| Reactive overlay detection | Proactive detection causes false positives on legitimate full-screen UIs | ✓ Delivered — check only on action failure |
| In-memory TabContext for v1 | Service worker stays alive during agent execution; persistence unnecessary | ✓ Delivered — Map-based with LRU eviction |

---
*Last updated: 2026-05-04 after v2 milestone start*
