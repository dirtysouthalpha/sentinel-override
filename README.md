# Sentinel Override

> Universal browser automation agent — investigates, configures, and collaborates via Universal Agent Protocol

![Version](https://img.shields.io/badge/version-21.5.8-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Chrome](https://img.shields.io/badge/chrome-supported-green)
![Manifest](https://img.shields.io/badge/manifest-v3-blueviolet)
![Tests](https://img.shields.io/badge/tests-10%2C232%20passing-brightgreen)
![CI](https://img.shields.io/badge/CI-passing-success)

A self-healing, vision-powered browser agent built for the work technicians actually do — multi-portal investigations, M365 admin, threat hunts, ticket writeups. Watch it see, click, read, think, and produce defensible reports.

---

## Quick Start

1. Download the [latest release](https://github.com/dirtysouthalpha/sentinel-override/releases/latest)
2. Extract the ZIP
3. Go to `chrome://extensions` → **Developer mode** → **Load unpacked** → select folder
4. Click the Sentinel icon to open the side panel
5. Enter your LLM provider settings (Claude, GLM, DeepSeek, OpenAI, or 12+ others)
6. Type a goal in plain English and watch the agent work

---

## Key Features

### Core Agent
- **Vision-powered automation** — Takes screenshots, places numbered overlays on every clickable element, reasons about which to interact with
- **Circuit breaker** — Hard 150-step ceiling, identical-action detection, repeated-target detection — prevents runaway loops
- **Model-agnostic** — Works with Claude, GLM-4V, DeepSeek, OpenAI, and 12+ other providers. Provider-aware 429 retry backoff
- **Streaming LLM responses** — Partial AI responses stream to the popup UI in real-time
- **Cross-origin iframe support** — Interacts with Stripe checkout, OAuth popups, embedded widgets via `chrome.scripting` frame routing
- **Trusted CDP input** — Uses Chrome DevTools Protocol for trusted mouse events that pass reCAPTCHA, banking, and OAuth consent screens
- **Tab scoping** — Extension only attaches to tabs where you click the icon. Agent-opened tabs auto-close after the run

### Security & Reliability
- **Prompt injection defense** — Regex pre-check + `<UNTRUSTED_PAGE_CONTENT>` wrapper for page content
- **XSS prevention** — All innerHTML injections use escapeHtml()
- **execute_js sandbox** — LLM-generated JavaScript runs in a Proxy sandbox with approval gate
- **Service worker persistence** — State checkpointed to `chrome.storage.session` with restore on SW restart
- **Global unhandled rejection guards** — Prevents silent service worker crashes

### MSP / IT Pro Features
- **19 platform profiles** — Teams Admin, M365 Admin, ConnectWise, IT Glue, and more
- **Investigation checklists** — Auto-appended to prompts for structured workflows
- **Forensic run logs** — Step-by-step screenshots + actions, exportable reports
- **Neuralis Brain integration** — Opt-in shared knowledge base (READ + WRITE paths)
- **Multi-tab parallel agents** — Up to 5 concurrent instances on separate tabs
- **CDP network interception** — Captures API calls, XHR, fetch for debugging workflows
- **NLP scheduler** — Natural language scheduled tasks with regex parser
- **Agent federation** — Peer-to-peer agent collaboration protocol

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+Space` | Toggle agent start/stop |
| `Ctrl+Shift+P` | Pause/resume running agent |

---

## Architecture

| Directory | Purpose |
|-----------|---------|
| `background/` | Service worker — agent engine, LLM client, tab management, circuit breaker |
| `content/` | Content scripts injected into pages (DOM scanning, cursor, overlays, shadow DOM) |
| `popup-modules/` | UI modules for the side panel (chat, settings, activity feed, federation) |
| `platforms/` | Platform-specific profiles (Teams Admin, M365, ConnectWise, etc.) |
| `tests/` | Jest ESM test suites — 228 suites, 10,232 tests |

### CI/CD Pipeline

- **Test Gate** — Runs on every push/PR: bare import scanner + syntax check + 10,232 tests
- **Auto Release** — Triggered by tag push (`v*`): builds ZIP, creates GitHub release automatically

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Load in Chrome
# chrome://extensions → Developer mode → Load unpacked
```

### Release Process

```bash
# Bump version in manifest.json + package.json
git commit -m 'vXX.Y.Z: description'
git tag vX.Y.Z
git push origin vX.Y.Z
# Auto-release workflow handles the rest
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit format, and MV3 rules.

---

## Test Results

- **228 suites**, **10,232 tests**, **0 failures**
- ESM modules via `--experimental-vm-modules`

---

## License

MIT

## Links

- [Releases](https://github.com/dirtysouthalpha/sentinel-override/releases)
- [Issues](https://github.com/dirtysouthalpha/sentinel-override/issues)
- [Contributing](CONTRIBUTING.md)
