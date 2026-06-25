# Sentinel Override — Privacy Policy

**Last updated:** June 24, 2026 (v21.5.15)

## Overview

Sentinel Override is a browser extension that provides AI-powered browser automation. We take privacy seriously. This policy explains what data the extension accesses and how it is handled.

## Data Collection

**Sentinel Override does not collect, transmit, or store any personal data to external servers operated by the extension developers.**

Specifically:

- **No analytics** — We do not use Google Analytics, Mixpanel, or any third-party tracking.
- **No telemetry** — The extension's internal telemetry is stored locally in `chrome.storage.local` and never leaves your browser.
- **No user accounts** — There are no accounts, sign-ups, or login requirements.
- **No crash reporting** — Errors are logged to the browser console only.

## Data Storage

All data is stored locally in your browser using `chrome.storage.local` and `chrome.storage.session`:

| Data | Purpose | Storage |
|------|---------|---------|
| API keys | Connect to your chosen LLM provider | `chrome.storage.local` |
| Provider settings | Model selection, endpoint configuration | `chrome.storage.local` |
| Theme preferences | Visual customization | `chrome.storage.local` |
| Client knowledge | Per-client notes for MSP workflows | `chrome.storage.local` |
| Run history | Recent agent runs with step details | `chrome.storage.session` |
| WS bridge token | Local authentication for bridge server | `chrome.storage.local` |
| Plugin state | Installed plugins and registry URL | `chrome.storage.local` |

**None of this data is transmitted to the extension developers.** It remains on your device.

## Data Sent to Third Parties

The extension sends data **only to the LLM provider you configure**:

- **Page content** — The agent reads page DOM and screenshots to perform tasks. This content is sent to your configured LLM API endpoint as part of the prompt.
- **Goal text** — Your natural language instructions are sent to the LLM.
- **Conversation history** — Recent agent steps are included for context continuity.

**You choose the provider.** The extension supports 16+ providers including local options (Ollama, LM Studio) that run entirely on your machine with zero data leaving your network.

Sensitive data protections:
- Passwords and sensitive fields are blocked from being typed by the agent (label-proximity detection).
- Goal text is scrubbed of IPs, emails, and ticket numbers before being persisted to learned patterns.
- Page content is wrapped in `<UNTRUSTED_PAGE_CONTENT>` tags to prevent prompt injection.

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Read the current tab's URL and title for agent context |
| `tabs` | Manage multiple tabs during agent runs |
| `tabGroups` | Group agent-affected tabs visually |
| `sidePanel` | Display the agent control panel |
| `storage` | Store settings, API keys, and run history locally |
| `debugger` | Access Chrome DevTools Protocol for screenshots and element interaction |
| `scripting` | Inject content scripts for page interaction |
| `webNavigation` | Detect page navigation events for agent awareness |
| `alarms` | Schedule recurring tasks |
| `notifications` | Desktop notifications for run completion and MFA challenges |
| `downloads` | Export run reports as files |
| `contextMenus` | Right-click menu integration |
| `<all_urls>` | Agent operates on any website the user navigates to |

## WebSocket Bridge (Optional)

The extension includes an optional WebSocket bridge for external orchestration. When enabled:

- Connects to `ws://localhost:8001/extension-bridge` only (no remote servers)
- Uses a randomly generated auth token stored in `chrome.storage.local`
- Challenge-response authentication (SHA-256)
- The bridge is **off by default** and only activates when explicitly configured

## Third-Party Services

- **LLM providers** — You choose which provider receives your data. Each provider has their own privacy policy.
- **No other third-party services** are used. No CDN resources, no external fonts, no tracking pixels.

## Children's Privacy

This extension is not directed at children under 13. We do not knowingly collect data from children.

## Changes to This Policy

We may update this policy from time to time. Changes will be reflected in the "Last updated" date above.

## Contact

For questions about this privacy policy, open an issue at [github.com/dirtysouthalpha/sentinel-override](https://github.com/dirtysouthalpha/sentinel-override).
