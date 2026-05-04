# Phase 4 Plan 2: Multi-Provider LLM Support Summary

Per-provider LLM configuration with a centralized provider registry that consolidates all Anthropic/OpenAI branching into a single module, plus a redesigned settings UI with provider selector cards.

**One-liner:** Provider registry module centralizing Anthropic/OpenAI API format handling with per-provider settings UI, legacy migration, and automatic provider detection from endpoint URL.

---

## Metadata

| Field       | Value                          |
|-------------|--------------------------------|
| Phase       | 04-reports-multi-provider-llm  |
| Plan        | 02                             |
| Subsystem   | LLM Provider Management       |
| Tags        | provider-registry, multi-provider, settings-ui, migration, Anthropic, OpenAI |
| Duration    | 6 minutes                      |
| Completed   | 2026-05-04                     |
| Status      | Complete                       |

## Dependency Graph

| Direction  | Target                    | Description                                              |
|------------|---------------------------|----------------------------------------------------------|
| requires   | 01-01, 01-02, 03-01, 03-02 | Agent engine, LLM client, tab-context modules            |
| provides   | Multi-provider LLM system | background/provider-registry.js + refactored LLM calls   |
| affects    | None (final plan)          | Phase 4 complete -- all plans executed                   |

## Tech Tracking

### Stack Changes
- **Added:** `background/provider-registry.js` -- new module (no npm dependencies)

### Patterns Established
- **Provider Registry Pattern:** All provider-specific API format logic lives in PROVIDERS definitions (buildHeaders, buildBody, parseResponse, buildVisionContent). LLM call sites use `resolveProvider(endpoint)` to get the right format handler.
- **Per-provider Storage Structure:** `chrome.storage.local` stores `{ active_provider: 'anthropic'|'openai', providers: { anthropic: { ... }, openai: { ... } } }` instead of flat `api_endpoint`/`api_key`/`model`.
- **Idempotent Migration:** `migrateLegacySettings()` checks if migration already happened and removes old keys after copying to prevent stale data.

## File Tracking

### Created
| File                          | Lines | Purpose                                              |
|-------------------------------|-------|------------------------------------------------------|
| `background/provider-registry.js` | 200 | Provider definitions, resolution, migration, active config |

### Modified
| File                          | Changes                                                       |
|-------------------------------|---------------------------------------------------------------|
| `background/llm-client.js`   | Removed inline Anthropic/OpenAI branching, uses provider registry |
| `background/agent-engine.js`  | Added migration call, uses getActiveProvider() for all settings |
| `background/index.js`         | Added provider-registry import                                |
| `popup-full.js`               | Replaced flat settings with per-provider UI (switchProviderCard) |
| `popup.html`                  | Replaced 3 fields with provider selector + config card + CSS    |

## Decisions Made

- **[04-02]** Provider registry uses a PROVIDERS object with per-provider methods (buildHeaders, buildBody, parseResponse, buildVisionContent) rather than a class hierarchy -- simpler, no inheritance needed for two providers.
- **[04-02]** Test connection handler in popup.js stays as inline URL-based detection (not importing from background modules) because the popup runs in a different context and cannot import ES modules from the service worker.
- **[04-02]** Legacy migration removes old keys (`api_endpoint`, `api_key`, `model`) after creating the new structure -- prevents stale values from being read by code paths that haven't been updated.
- **[04-02]** Mid-task provider switching works transparently because callLLM() reads from getActiveProvider() on each call. No context bridge needed for v1 since both providers use the same history format.
- **[04-02]** `generatePlan()` still receives a flat `settings` object as parameter (matching the existing interface) rather than being refactored to accept a provider config -- minimizes the change surface.

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

Phase 4 (final phase) is now complete. All 8 plans across 4 phases have been executed successfully.
