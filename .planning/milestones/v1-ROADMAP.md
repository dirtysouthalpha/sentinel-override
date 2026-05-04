# Milestone v1: Sentinel Override MVP

**Status:** Shipped 2026-05-04
**Phases:** 1-4
**Total Plans:** 8

## Overview

Transform the existing v3.1.3 Chrome extension from a functional prototype into a reliable, organization-deployable browser automation agent. Starting with foundational refactoring and reliability fixes to the agent engine, then expanding capability to handle complex enterprise UIs, multi-tab investigation workflows, and structured report generation -- all while introducing multi-provider LLM support.

## Phases

### Phase 1: Agent Engine Foundation

**Goal**: The agent engine is modular, handles errors consistently, and reliably detects and recovers from stalls, produces accurate plans, and handles SPA page transitions
**Depends on**: Nothing (first phase)
**Requirements**: HEA-01, HEA-02, REL-01, REL-02, REL-03
**Plans**: 2 plans

Plans:

- [x] 01-01: Refactor background.js into modular components (agent engine, LLM client, tab manager) and standardize error handling across all message passing
- [x] 01-02: Implement agent stall detection and autonomous recovery, accurate planning, and SPA page transition handling

**Success Criteria** (what must be TRUE):
  1. Agent detects when it is stuck (no progress after N iterations) and autonomously recovers by re-assessing page state instead of looping indefinitely
  2. Agent planning produces step sequences that match the user's stated goal -- generic approximations are replaced by accurate task-specific plans
  3. Agent handles SPA page transitions (content changes without full navigation) by detecting DOM mutations and re-scanning automatically
  4. Background.js is split into distinct modules (agent engine, LLM client, tab manager) instead of one monolithic file
  5. All message passing between background, content scripts, and UI follows a single consistent error handling pattern -- no mixed throw/return-error-string behavior

### Phase 2: Complex UI Interactions

**Goal**: The agent can reliably interact with the full range of complex enterprise web UI elements including dropdowns, iframes, shadow DOM, modals, and special input types
**Depends on**: Phase 1 (modular agent engine and standardized error handling)
**Requirements**: UIX-01, UIX-02, UIX-03, UIX-04, UIX-05, HEA-03
**Plans**: 2 plans

Plans:

- [x] 02-01: Extract content.js into content/ utility modules, implement shadow DOM piercing, and dropdown/nested menu interaction
- [x] 02-02: Implement special input types, iframe (cross-origin) support, and modal/overlay detection and dismissal

**Success Criteria** (what must be TRUE):
  1. Agent successfully opens, selects from, and dismisses dropdowns and nested hover menus on enterprise web UIs
  2. Agent fills in date pickers, uploads files, and interacts with rich text editors without breaking
  3. Agent interacts with elements inside iframes (including cross-origin) and shadow DOM elements that were previously inaccessible
  4. Agent dismisses modal dialogs, confirmation prompts, and overlay popups that block the main UI
  5. Content script DOM operations are extracted into reusable utility functions rather than being scattered inline

### Phase 3: Multi-Tab Workflows

**Goal**: The agent can operate across multiple browser tabs simultaneously, tracking context per tab and correlating data between them
**Depends on**: Phase 2 (complex UI interactions working reliably on single tabs)
**Requirements**: TAB-01, TAB-02, TAB-03
**Plans**: 2 plans

Plans:

- [x] 03-01: Create tab-context.js module and integrate into agent-engine.js -- core multi-tab infrastructure with open/switch/close, per-tab screenshot cache, and cleanup
- [x] 03-02: Add multi-tab LLM commands, cross-tab prompt context, and popup tab bar UI

**Success Criteria** (what must be TRUE):
  1. Agent opens new tabs, switches between existing tabs, and closes tabs as needed during task execution
  2. Agent can reference data from one tab while working in another (e.g., read a log entry on tab A, compare with config on tab B)
  3. Agent always knows which tab it is on and what that tab represents -- no confusion about current context after tab switches

### Phase 4: Reports & Multi-Provider LLM

**Goal**: The agent generates structured, copy-paste-ready investigation reports after task completion, and users can switch between Claude and OpenAI as the LLM backend
**Depends on**: Phase 3 (multi-tab workflows provide full task execution capability to report on)
**Requirements**: RPT-01, RPT-02, RPT-03, LLM-01, LLM-02, LLM-03
**Plans**: 2 plans

Plans:

- [x] 04-01: Implement structured investigation report generation with timeline, findings, screenshots, and copy-paste-ready formatting
- [x] 04-02: Implement multi-provider LLM support with UI settings for switching between Claude and OpenAI, handling provider-specific API differences transparently

**Success Criteria** (what must be TRUE):
  1. After completing a task, the agent produces a structured report containing the user's goal, steps taken, key findings, evidence (screenshots and data), and conclusions
  2. The generated report is formatted for direct copy-paste into ticket documentation (plain text or markdown)
  3. User can switch between Claude and OpenAI as the LLM backend from the UI settings
  4. Switching LLM providers works transparently -- the agent handles API differences without user intervention or broken functionality

---

## Milestone Summary

**Key Decisions:**
- Strict one-way dependency graph: message-protocol -> llm-client/tab-manager -> agent-engine -> index.js
- IIFE namespace pattern (window.__sentinelUtils) for content scripts since ES modules unavailable
- Provider registry pattern consolidating all Anthropic/OpenAI branching into single module
- Async post-loop report generation (non-blocking) with fallback report on LLM failure
- In-memory Map-only TabContext (no chrome.storage.session for v1)
- Reactive overlay detection (on action) not proactive -- avoids false positives

**Issues Resolved:**
- Monolithic 1,232-line background.js split into 8 focused ES modules
- Monolithic 582-line content.js split into 9 modular utility files
- Inconsistent error handling standardized to { ok, data, error } envelope
- Agent stall loops resolved with autonomous recovery (RESCAN_AND_REPLAN + FORCE_STRATEGY_SHIFT)
- Generic planning replaced with context-enriched prompts using page URL, platform context, and learned patterns
- SPA transitions handled via MutationObserver + history patching + shared-state flag
- Shadow DOM (open + closed) now accessible via TreeWalker and attachShadow patch
- Cross-origin iframe interaction enabled via two-step chrome.scripting injection
- Provider-specific API format differences consolidated into provider registry

**Technical Debt Incurred:**
- Old content.js still exists alongside new content/ directory -- cleanup needed
- popup-full.js has grown to ~1,450+ lines -- monitor for maintainability
- Agent-engine.js LLM prompt does not describe iframe/dropdown/overlay capabilities
- Deprecated isAnthropicEndpoint export in llm-client.js -- dead code
- No test infrastructure -- deferred to v2

---
_For current project status, see .planning/ROADMAP.md_
