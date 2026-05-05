# Roadmap: Sentinel Override

**Created:** 2026-05-04
**Granularity:** Standard (7 phases)
**Total v1 Requirements:** 51

---

## Phase 1: Provider Architecture
**Goal:** Modular provider system supporting z.ai, OpenRouter, Anthropic Claude, and OpenAI natively

**Requirements:** PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07, PROV-08

**Success Criteria:**
1. User can configure any of 4 providers and extension auto-detects which to use
2. Anthropic Claude models work via native Messages API (not OpenAI-compatible shim)
3. OpenAI models work with proper model routing (GPT-4o, GPT-4o-mini, etc.)
4. z.ai endpoint works as default/primary provider
5. Switching providers in settings immediately changes API format without restart

---

## Phase 2: Agent Loop Hardening
**Goal:** Reliable, leak-free agent loop with proper error recovery

**Requirements:** AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, AGNT-06, AGNT-07, AGNT-08

**Success Criteria:**
1. Agent loop runs 50+ consecutive steps without memory leak or hang
2. Screenshots captured successfully on HTTP, HTTPS, and complex SPA pages
3. Set-of-marks renders without breaking page layout
4. Plan-execute workflow completes multi-step goals (5+ steps) reliably
5. Agent stops within 1 second of user cancel

---

## Phase 3: Command Execution Fixes
**Goal:** All 11+ command types work reliably across diverse page structures

**Requirements:** CMD-01 through CMD-11

**Success Criteria:**
1. All command types execute without errors on 5+ different website types
2. Extract command returns clean structured data (no markup in text)
3. Wait commands timeout gracefully with clear error messages
4. Type command handles special characters, autocomplete, and contenteditable
5. Navigate command validates and normalizes URLs

---

## Phase 4: Analysis Mode Polish
**Goal:** Professional-grade analysis output matching Claude quality

**Requirements:** ANLY-01, ANLY-02, ANLY-03, ANLY-04, ANLY-05

**Success Criteria:**
1. Analysis output is properly formatted markdown with headers, tables, and lists
2. Multi-turn analysis maintains context across 10+ turns
3. Template matching correctly identifies 4+ incident types
4. Page context enriches analysis without overwhelming the prompt
5. Follow-up suggestions are relevant and actionable

---

## Phase 5: Cost Safety Overhaul
**Goal:** Provider-aware cost safety that works across all providers

**Requirements:** COST-01, COST-02, COST-03, COST-04, COST-05

**Success Criteria:**
1. Cost tracking works for all 4 providers with accurate rate tables
2. Claude models are NOT blocked when using Anthropic provider
3. Session cost cap enforced and visible to user
4. User can configure custom cost limits in settings
5. Cost audit log persists across sessions

---

## Phase 6: UI/UX Polish
**Goal:** Professional side panel UX matching Chrome Web Store quality standards

**Requirements:** UIUX-01 through UIUX-08

**Success Criteria:**
1. Side panel loads in under 500ms with no blank state
2. Chat scrolls smoothly with properly rendered markdown
3. Settings page clearly shows all 4 provider options with model selection
4. Error messages explain what went wrong and how to fix it
5. Export produces a readable conversation transcript

---

## Phase 7: Documentation & Release
**Goal:** Chrome Web Store-ready with accurate docs and professional presentation

**Requirements:** DOCS-01 through DOCS-07

**Success Criteria:**
1. README has screenshots, feature list, and install instructions
2. ARCHITECTURE.md matches actual codebase structure
3. All naming consistent: "Sentinel Override" everywhere
4. LICENSE file present and correct
5. Chrome Web Store listing assets ready (description, screenshots, icons)

---

## Execution Order

```
Phase 1 (Provider Architecture)
    ↓
Phase 2 (Agent Loop) ← depends on providers
    ↓
Phase 3 (Command Execution) ← depends on agent loop
    ↓
Phase 4 (Analysis Mode) ← can parallel with Phase 5
Phase 5 (Cost Safety)  ← can parallel with Phase 4
    ↓
Phase 6 (UI/UX) ← depends on all functional phases
    ↓
Phase 7 (Documentation) ← final phase
```

---
*Roadmap created: 2026-05-04*
