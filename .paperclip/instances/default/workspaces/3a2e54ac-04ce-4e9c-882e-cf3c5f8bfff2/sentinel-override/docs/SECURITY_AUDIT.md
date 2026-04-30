# Security Audit Report — SVO-20 / SVO-11.1

**Date:** 2026-04-30  
**Auditor:** Extension-Dev (Agent 814fa71c)  
**Scope:** Security audit of execute_js contexts, content script isolation, and message passing  
**Repo:** sentinel-override (commit fbba36c)

---

## Executive Summary

**Current Security Posture: BLOCKED — Insufficient code for audit**

The Sentinel Override repository (sentinel-override) currently contains only the multi-model tiering module (src/tiering/) from SVO-16. The core browser extension code — including manifest.json, ackground.js/service worker, content scripts, popup UI, and message passing infrastructure — **has not yet been implemented**.

As a result, the three audit areas specified in SVO-11.1 cannot be fully completed:

1. **execute_js context audit** — No chrome.scripting.executeScript calls exist to audit.
2. **Content script isolation** — No content scripts exist to verify.
3. **Message passing security** — No chrome.runtime.sendMessage / chrome.tabs.sendMessage calls exist to review.

---

## Findings Table

| # | Severity | Component | Description | Recommendation |
|---|----------|-----------|-------------|----------------|
| F-01 | **Critical** | Core Extension | Extension code (background scripts, content scripts, popup, manifest) has not been implemented. The security audit of execute_js, content scripts, and message passing cannot be performed. | **Block:** SVO-11.1 audit must be deferred until the core extension architecture (SVO-7 through SVO-10) is built. Create prerequisite issues for: manifest.json + MV3 service worker, content script injection, popup UI, and message passing layer. |
| F-02 | **Medium** | tiering/smart-router.ts | The SmartRouter.executeTask() method calls 	his.callModel() which passes user-provided prompt text directly to LLM providers without input sanitization. When this code runs in a browser extension context, malicious page content could be injected into prompts. | Sanitize DOM content before including it in LLM prompts. Strip <script> tags, event handlers, and other executable content. Consider using DOMPurify or a similar library. |
| F-03 | **Low** | tiering/session-stickiness.ts | deserializeSessionMemory() accepts arbitrary ny input without schema validation. Malicious or corrupted persisted state could cause unexpected behavior. | Add runtime type validation on deserialized data. Use a schema validator (e.g., zod) to validate the structure before restoring. |
| F-04 | **Low** | tiering/tier-config.ts | Model API keys are not present in the tiering code (good — they appear to be loaded at runtime). However, there is no code yet that handles secure storage of API keys in the extension context. | When implementing the extension shell, use chrome.storage.session (MV3) for API keys, never chrome.storage.local in plaintext. Consider encryption at rest. |
| F-05 | **Info** | tiering/cost-tracker.ts | Cost records include issueId which could leak internal tracking data if logs are exposed. | Ensure cost records are not logged to console or included in crash reports. |

---

## Acceptance Criteria Status

- [ ] **Every executeScript call cataloged and classified** — BLOCKED: No executeScript calls exist yet.
- [ ] **Content script isolation verified with test cases** — BLOCKED: No content scripts exist yet.
- [ ] **Message passing audit complete with no unresolved Critical findings** — BLOCKED: No message passing code exists yet.
- [ ] **Security audit report committed to repo** — ✅ This report.

---

## Recommended Architecture Security Controls (Pre-Implementation)

Since the core extension code has not been built, I recommend the following security controls be incorporated **by design** when the extension architecture is implemented:

### 1. executeScript Security
- Default all chrome.scripting.executeScript calls to world: 'ISOLATED'.
- Any world: 'MAIN' execution must require explicit user consent and be logged.
- Never pass unsanitized user/page content directly into unc parameters.
- Implement rate limiting per tab to prevent runaway script injection.

### 2. Content Script Isolation
- Content scripts must run in ISOLATED world by default (Chrome MV3 default).
- Use chrome.scripting.executeScript with world: 'MAIN' only when page context access is absolutely necessary.
- Content script global scope must not be accessible from page JavaScript.
- Use chrome.runtime.sendMessage for content script → background communication (not window.postMessage).

### 3. Message Passing Security
- Validate sender.tab.id and sender.origin in all chrome.runtime.onMessage handlers.
- Use structured message types with TypeScript discriminated unions.
- Never trust message payloads from content scripts without validation (page could inject via window.postMessage).
- Implement message schemas and validate before processing.

### 4. API Key Management
- Store API keys in chrome.storage.session (cleared on browser close).
- Never store in localStorage, chrome.storage.local unencrypted, or hardcoded.
- Consider using the chrome.identity API for OAuth flows where possible.

---

## Next Actions

1. **Prerequisite:** Build core extension shell (manifest.json, service worker, content script stubs, popup) — tracked under SVO-7 through SVO-10 in the technical roadmap (SVO-6).
2. **Re-audit:** Once extension code exists, re-run this security audit against the implementation.
3. **Owner:** The unblock is owned by whoever builds the extension core architecture (likely from Sprint 1/Sprint 2 of the roadmap).

---

*This audit was generated by Extension-Dev agent as part of SVO-20 (SVO-11.1).*
