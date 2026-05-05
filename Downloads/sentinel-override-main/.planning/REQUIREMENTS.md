# Requirements: Sentinel Override

**Defined:** 2026-05-04
**Core Value:** Reliable, multi-provider AI browser automation that works with any LLM API the user configures

## v1 Requirements

### Provider Architecture (PROV)

- [ ] **PROV-01**: Modular provider system with base class/interface for all LLM providers
- [ ] **PROV-02**: z.ai provider with OpenAI-compatible chat completions endpoint
- [ ] **PROV-03**: OpenRouter provider with model validation and cost tracking
- [ ] **PROV-04**: Anthropic Claude provider using native Messages API (not OpenAI-compatible)
- [ ] **PROV-05**: OpenAI provider with native API support and proper model routing
- [ ] **PROV-06**: Provider auto-detection based on endpoint URL pattern
- [ ] **PROV-07**: Provider-specific model lists and cost tables
- [ ] **PROV-08**: Unified error handling across all provider formats (OpenAI errors vs Anthropic errors)

### Agent Loop (AGNT)

- [ ] **AGNT-01**: Observe-reason-act loop executes reliably without hangs or memory leaks
- [ ] **AGNT-02**: Screenshot capture works across all page types (HTTP, HTTPS, chrome://)
- [ ] **AGNT-03**: Set-of-marks overlay renders correctly on all page layouts
- [ ] **AGNT-04**: Plan-execute workflow decomposes goals into steps and tracks progress
- [ ] **AGNT-05**: Auto-recovery on step failure with retry and alternative approach
- [ ] **AGNT-06**: Agent stops cleanly on user cancel with no orphaned state
- [ ] **AGNT-07**: Rate limiting prevents API throttling (2s minimum between calls)
- [ ] **AGNT-08**: Timeout handling for long-running API calls (60s max)

### Command Execution (CMD)

- [ ] **CMD-01**: click command works on all interactive elements (buttons, links, checkboxes)
- [ ] **CMD-02**: type command handles text inputs, textareas, and contenteditable
- [ ] **CMD-03**: select command handles dropdown menus and multi-select
- [ ] **CMD-04**: scroll command works in both directions with pixel and element targeting
- [ ] **CMD-05**: extract command returns structured data (text, tables, forms)
- [ ] **CMD-06**: hover command triggers hover states and dropdowns
- [ ] **CMD-07**: press_key command handles special keys (Enter, Tab, Escape, etc.)
- [ ] **CMD-08**: navigate command validates URLs and handles redirects
- [ ] **CMD-09**: wait_for_text and wait_for_element commands with configurable timeouts
- [ ] **CMD-10**: wait_stable command detects page load completion
- [ ] **CMD-11**: go_back and go_forward commands handle browser history

### Analysis Mode (ANLY)

- [ ] **ANLY-01**: Analysis produces structured markdown reports (headers, tables, lists)
- [ ] **ANLY-02**: Conversation history persists across analysis turns
- [ ] **ANLY-03**: Template matching auto-detects incident type (network, server, security, database)
- [ ] **ANLY-04**: Page context (URL, title, content, tables) injected into analysis
- [ ] **ANLY-05**: Follow-up suggestions generated based on analysis content

### Cost Safety (COST)

- [ ] **COST-01**: Per-call cost caps enforced per provider (not just Venice)
- [ ] **COST-02**: Session cost cap enforced across all providers
- [ ] **COST-03**: Cost tracking and audit log for all API calls
- [ ] **COST-04**: Provider-aware model validation (don't block Claude on Anthropic endpoint)
- [ ] **COST-05**: User-configurable cost limits in settings

### UI/UX (UIUX)

- [ ] **UIUX-01**: Side panel loads fast with no blank states
- [ ] **UIUX-02**: Chat history scrolls smoothly with markdown rendering
- [ ] **UIUX-03**: Settings page shows all providers with clear configuration
- [ ] **UIUX-04**: Theme system applies consistently across all views
- [ ] **UIUX-05**: Loading states and progress indicators during API calls
- [ ] **UIUX-06**: Error messages are user-friendly with actionable guidance
- [ ] **UIUX-07**: Keyboard shortcuts accessible from side panel
- [ ] **UIUX-08**: Export conversation history to file

### Documentation & Release (DOCS)

- [ ] **DOCS-01**: README accurate and compelling with screenshots
- [ ] **DOCS-02**: ARCHITECTURE.md reflects actual codebase (not aspirational)
- [ ] **DOCS-03**: USAGE.md step-by-step installation and configuration guide
- [ ] **DOCS-04**: Consistent naming throughout (Sentinel Override everywhere)
- [ ] **DOCS-05**: CHANGELOG.md updated with all changes
- [ ] **DOCS-06**: Chrome Web Store listing ready (description, screenshots, icons)
- [ ] **DOCS-07**: LICENSE file added

## v2 Requirements

### Advanced Features

- **ADV-01**: Voice output via TTS (document or remove localhost dependency)
- **ADV-02**: Site-specific automation recipes (saved workflows)
- **ADV-03**: Custom prompt templates library
- **ADV-04**: Multi-tab orchestration
- **ADV-05**: Data extraction pipelines (extract → transform → export)

### Integrations

- **INTG-01**: Browser Control Agent WebSocket bridge for SENTINEL PRIME
- **INTG-02**: Telegram integration for remote task initiation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user auth | Single-user extension, no backend |
| Real-time collaboration | Not a team tool |
| Mobile support | Chrome extension, desktop only |
| Firefox/Edge support | Chrome MV3 only for v1 |
| Custom fine-tuned models | User brings their own API keys |
| Backend/database | All state in chrome.storage.local |
| TypeScript rewrite | Vanilla JS is the constraint — no build step |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROV-01 | Phase 1 | Pending |
| PROV-02 | Phase 1 | Pending |
| PROV-03 | Phase 1 | Pending |
| PROV-04 | Phase 1 | Pending |
| PROV-05 | Phase 1 | Pending |
| PROV-06 | Phase 1 | Pending |
| PROV-07 | Phase 1 | Pending |
| PROV-08 | Phase 1 | Pending |
| AGNT-01 | Phase 2 | Pending |
| AGNT-02 | Phase 2 | Pending |
| AGNT-03 | Phase 2 | Pending |
| AGNT-04 | Phase 2 | Pending |
| AGNT-05 | Phase 2 | Pending |
| AGNT-06 | Phase 2 | Pending |
| AGNT-07 | Phase 2 | Pending |
| AGNT-08 | Phase 2 | Pending |
| CMD-01 | Phase 3 | Pending |
| CMD-02 | Phase 3 | Pending |
| CMD-03 | Phase 3 | Pending |
| CMD-04 | Phase 3 | Pending |
| CMD-05 | Phase 3 | Pending |
| CMD-06 | Phase 3 | Pending |
| CMD-07 | Phase 3 | Pending |
| CMD-08 | Phase 3 | Pending |
| CMD-09 | Phase 3 | Pending |
| CMD-10 | Phase 3 | Pending |
| CMD-11 | Phase 3 | Pending |
| ANLY-01 | Phase 4 | Pending |
| ANLY-02 | Phase 4 | Pending |
| ANLY-03 | Phase 4 | Pending |
| ANLY-04 | Phase 4 | Pending |
| ANLY-05 | Phase 4 | Pending |
| COST-01 | Phase 5 | Pending |
| COST-02 | Phase 5 | Pending |
| COST-03 | Phase 5 | Pending |
| COST-04 | Phase 5 | Pending |
| COST-05 | Phase 5 | Pending |
| UIUX-01 | Phase 6 | Pending |
| UIUX-02 | Phase 6 | Pending |
| UIUX-03 | Phase 6 | Pending |
| UIUX-04 | Phase 6 | Pending |
| UIUX-05 | Phase 6 | Pending |
| UIUX-06 | Phase 6 | Pending |
| UIUX-07 | Phase 6 | Pending |
| UIUX-08 | Phase 6 | Pending |
| DOCS-01 | Phase 7 | Pending |
| DOCS-02 | Phase 7 | Pending |
| DOCS-03 | Phase 7 | Pending |
| DOCS-04 | Phase 7 | Pending |
| DOCS-05 | Phase 7 | Pending |
| DOCS-06 | Phase 7 | Pending |
| DOCS-07 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 51 total
- Mapped to phases: 51
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-04*
*Last updated: 2026-05-04 after initial definition*
