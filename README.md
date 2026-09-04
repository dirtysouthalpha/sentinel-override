# Sentinel Override

![Version](https://img.shields.io/badge/version-21.6.76-orange)
![Tests](https://img.shields.io/badge/tests-10,249++-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

An autonomous browser agent for MSPs and IT professionals. Sentinel Override sees the screen, plans multi-step workflows, and executes them with human-like visual feedback — cursor movement, element highlighting, click pulses, and typing animation.

**Runs on free OpenRouter vision models. No API costs required.**

---

## Recent Fixes (v21.6.76)

This release hardens security, fixes stability bugs, and improves code quality:

### Security Hardening
- **`execute_js` sandbox bypass fixed** — Added `'use strict'` mode to prevent `this` globalThis bypass, blocked `globalThis` access in the Proxy allowlist, fixed `has` trap to check actual property existence instead of always returning `true`
- **`postMessage` origin fixed** — Changed from wildcard `"*"` to `window.location.origin` in both sandboxed and unsandboxed `execute_js` paths to prevent cross-origin message leakage
- **CSS selector injection prevention** — Sanitized `selectionText` in context menu `monitor_changes` handler to strip selector-special characters before interpolation
- **XSS hardening** — All `innerHTML` calls use `escapeHtml()` for user-generated content

### Stability & Bug Fixes
- **Approval flow SW suspend detection** — Added 15s health check polling during approval waits; rejects promptly if the service worker suspends instead of hanging for 5 minutes
- **Credit usage race condition fixed** — Serialized `record_credit_usage` updates via async lock to prevent read-modify-write data loss
- **Pause/resume toggle fixed** — `Ctrl+Shift+P` now correctly toggles between pause and resume (previously only paused)
- **`userPanelTabId` cleanup** — Clears stale tab reference when the tracked tab is closed, preventing silent `setOptions` failures
- **Duplicate keyboard shortcut resolved** — Removed conflicting `Ctrl+Shift+S` binding on `toggle-panel` (kept `_execute_action`)

### Code Quality
- **Consolidated imports** — Moved 47 scattered `import` statements in `agent-engine.js` to the top of the file (ES module hoisting made them work, but they harmed readability and maintainability)
- **SW health heartbeat** — Added `sw_heartbeat` alarm to confirm the service worker event loop stays alive

---

## Quick Start

1. **Download** the [latest release](https://github.com/dirtysouthalpha/sentinel-override/releases/latest)
2. **Load unpacked** in Chrome: `chrome://extensions` → Developer mode → Load unpacked
3. **Open a web tab** (not chrome://extensions)
4. **Click the icon** or press **Ctrl+Shift+S** to open the side panel
5. **Select a model** from the quick switcher (Gemma 4 31B recommended — free + vision)
6. **Type a goal:** `go to cnn.com and get the top 5 articles`
7. **Watch it work** — cursor travels to elements, highlights them, clicks, types, and reports back

---

## Key Features

### Autonomous Browser Agent

| Feature | Description |
|---------|-------------|
| **Vision-driven** | Takes full-page screenshots every step. The LLM sees the entire page, not just the viewport. |
| **Multi-step planning** | Generates execution plans (up to 14 phases) before acting. |
| **Human-like visuals** | Cursor travels 450ms to targets, elements highlight before clicks, click pulses render at exact coordinates. |
| **CDP trusted input** | Real keyboard/mouse events via Chrome DevTools Protocol. Not synthetic JS events. |
| **Circuit breaker** | Stops after 5 consecutive failures or 150 max steps. No infinite loops. |
| **Cross-origin iframes** | Full support for embedded content and admin panels. |
| **Prompt injection defense** | Pre-check regex blocks malicious instructions in page content. |

### Security & Anti-Detection

| Feature | Description |
|---------|-------------|
| **Anti-detection mode** | Patches `navigator.webdriver`, languages, and chrome.runtime in MAIN world at document_start. Admin panels (M365, SentinelOne, ConnectWise) cannot detect automation. |
| **CDP trusted input gate** | Removed — fires after any action failure instead of blocking upfront. |
| **XSS hardening** | All innerHTML calls use escapeHtml() for user-generated content. |
| **Per-client proxy routing** | Route agent traffic through client-specific proxies for IP allowlisting. |
| **Session isolation** | Per-client memory namespacing prevents data leakage between tenants. |

### MSP / IT Pro Features

| Feature | Description |
|---------|-------------|
| **Session persistence** | Save/restore cookies per client. Log in once, run unlimited tasks (24h TTL). |
| **Cost tracking** | Real per-model pricing tables. Shows token usage and $ cost per run. |
| **Run history export** | Download all past runs as JSON for billing and time tracking. |
| **Undo/rollback** | Reverse the last click/type/navigate action. Safety net for client environments. |
| **Template library** | 5 built-in MSP presets: M365 User Audit, Teams Guest Review, ConnectWise Triage, IT Glue Doc Audit, Web Research. |
| **Team template sharing** | Export/import workflows via GitHub Gist. Share with your techs. |
| **Recurring scheduled runs** | Daily, weekly, or custom recurrence. Automated compliance checks. |
| **Config change verification** | Agent re-reads after making changes to confirm they worked. Prevents false positives. |
| **Console/network diagnostics** | `read_console_messages` and `read_network_requests` actions expose client-side errors and failed API calls. |
| **SSO/MFA handling** | Detects sign-in walls and MFA prompts. Pauses for user intervention. |
| **19 platform profiles** | Built-in knowledge for M365 Admin, Teams Admin, ConnectWise, IT Glue, SentinelOne, Huntress, and more. |

### Reporting

| Feature | Description |
|---------|-------------|
| **Markdown reports** | Structured investigation reports with goals, steps, and findings. |
| **PDF export** | One-click professional PDF with embedded screenshots. |
| **Streaming LLM display** | Watch the agent think in real-time — tokens render as they arrive. |
| **Investigation replay** | Step-by-step replay of any completed run. |
| **Activity feed** | Real-time event stream with collapsible sections. |

### Voice & Hands-Free

| Feature | Description |
|---------|-------------|
| **Voice input** | Speak goals aloud via webkitSpeechRecognition. |
| **Desktop notifications** | System notification fires when a task completes or hits a wall. |
| **Keyboard shortcuts** | Toggle panel (Ctrl+Shift+S), start/stop agent (Ctrl+Shift+Space), speed modes. |

### Intelligence

| Feature | Description |
|---------|-------------|
| **Neuralis Brain** | Persistent learning across runs. Remembers platform quirks, client environments, and optimal workflows. |
| **Action learning** | Tracks action success/failure per platform. Builds one-shot playbooks for repeated tasks. |
| **Federation** | Multi-agent coordination across local and remote peers for parallel work. |
| **Scheduler** | Natural language scheduling ("every Monday at 9am, audit M365 licenses for Client X"). |


### v21.x Intelligence Upgrades

| Feature | Description |
|---------|-------------|
| **Circuit Breaker** | ABSOLUTE_MAX_STEPS=150 ceiling, identical-action detection, repeated target click prevention, stale-page detection, 70%+ failure rate trigger |
| **Dual-Provider Architecture** | Vision + text providers fire simultaneously for faster processing; LongCat, Ollama, LM Studio, vLLM presets |
| **Federation Controller** | 706-line FederationController with peer discovery, zero-trust auth, goal decomposition for multi-agent orchestration |
| **Prompt Injection Defense** | Regex pre-check for injection patterns before page content processing |
| **Adaptive Intelligence** | Cross-run domain learning — agent remembers solutions from prior sessions |
| **100-Iteration Hardening** | 27 try/catch wraps, 12 JSON.parse guards, XSS fixes, provider-aware 429 retry (GLM/DeepSeek 2x, free/OpenRouter 1.5x) |
| **50-Iteration Improvement** | Page-type detection, progressive summarizer, output schema compliance, budget awareness |
| **Investigation Checklist** | 86-test suite for MSP investigation workflows with Teams Admin integration |

---

## Free Vision Models (OpenRouter)

All models in the quick switcher are verified free + vision-capable:

| Model | Context | Vision | Tools |
|-------|---------|--------|-------|
| **Gemma 4 31B** | 262K | ✅ | ✅ |
| **Gemma 4 26B A4B** | 262K | ✅ | ✅ |
| **Nemotron 3 Nano Omni 30B** | 256K | ✅ | ✅ |
| **Nemotron Nano 12B VL** | 128K | ✅ | ✅ |
| **Free Models Router** | 200K | ✅ | ✅ |

Rate-limit aware: if a free model hits 429 twice, the agent auto-switches to the next available model.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+S** | Toggle side panel |
| **Ctrl+Shift+Space** | Start/stop agent |
| **Ctrl+Shift+P** | Pause/resume running agent |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                 Service Worker               │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │  Agent   │  │  LLM      │  │  Tab      │  │
│  │  Engine  │←→│  Client   │  │  Manager  │  │
│  └────┬─────┘  └───────────┘  └─────┬─────┘  │
│       │                                  │   │
│  ┌────▼──────────────────────────────▼─┐  │
│  │     CDP (Chrome DevTools Protocol)   │  │
│  │  Screenshots · Trusted Input · Network │  │
│  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         ↕                           ↕
┌─────────────────┐         ┌──────────────────┐
│   Side Panel    │         │  Content Scripts │
│  Chat · Reports │         │  Cursor · HUD    │
│  Settings · Telemetry │   │  Shadow Intercept│
└─────────────────┘         └──────────────────┘
```

**31 LLM providers** supported via provider registry (OpenAI, Anthropic, Google, OpenRouter, GLM, DeepSeek, and more).

---

## CI/CD Pipeline

- **Test gate**: Every PR runs 10,249 tests + import resolution checker (507 imports) + bare import scanner
- **Auto-release**: Tagged commits automatically build and publish a release zip
- **Issue templates**: Structured bug reports and feature requests
- **Import checker**: CI safeguard prevents the recurring "missing export" service worker crash class

---

## Development

### Install dependencies
```bash
npm install
```

### Run tests
```bash
npm test
```

### Load in Chrome
1. `chrome://extensions` → Developer mode → Load unpacked
2. Select the project root folder

### Release Process
1. Bump version in `manifest.json` + `package.json`
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. Auto-release workflow handles the rest

---

## Test Results

```
Test Suites: 230 passed, 0 failures
Tests:       10,249 passed
Imports:     507 resolved
Files:       133 syntax-checked
```

---

## License

MIT

---

## Links

- [Releases](https://github.com/dirtysouthalpha/sentinel-override/releases)
- [Issues](https://github.com/dirtysouthalpha/sentinel-override/issues)
- [Changelog](CHANGELOG.md)

---

## Support this project

Built and maintained by one person, in the open. If it saves you time or
money, you can throw something in the hat — entirely optional, and it changes
nothing about the license or what ships.

<a href="https://cash.app/$vladien"><img src="docs/assets/donate-cashapp.png" alt="Cash App donation QR code for $vladien" width="170" align="left" hspace="18" vspace="6"></a>

**Cash App — [$vladien](https://cash.app/$vladien)**

Scan the code, or follow the link.

No tiers, no paywalled features, no "pro" build.

<br clear="left">