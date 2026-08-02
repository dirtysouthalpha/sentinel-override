# Chrome Web Store Listing — Sentinel Override

## Name
Sentinel Override

## Short Summary (132 chars max)
Vision-powered AI browser agent. See, click, read, think — automate any web task with your own LLM. Built for IT pros.

## Detailed Description

Sentinel Override is a professional AI browser automation agent that sees your page, understands it, and executes tasks — precisely and auditably.

**How it works:** Tell it what to do in plain English. A vision-powered agent places numbered overlays on every clickable element, reasons about which one to interact with, and executes. Every action is traced. Every claim in the report is source-cited.

**Bring your own LLM.** 20+ providers including OpenRouter supported — OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Groq, Mistral, Ollama (local), and more. Or add any OpenAI-compatible endpoint. Your API keys stay in your browser.

## Key Features

🔍 **Vision-First Automation** — Numbered SoM overlays on every element. Click by index, selector, or coordinate. Works on any website.

🛡️ **MSP-Grade Safety** — Tenant lockdown, MFA auto-pause, sensitive-field protection, cross-tenant hard-blocks, and forensic run logs with JSON/CSV export.

🧠 **19 Platform Profiles** — Adaptive prompts for M365 Admin, SonicWall, FortiGate, Palo Alto, SentinelOne, ConnectWise, Datto, NinjaRMM, IT Glue, Huntress, and more. Platform-aware goal rewriting before each run.

📊 **Full Auditability** — Source-cited reports where every claim links to evidence. Trust scoring (0-100) with breakdown. Run replay with step-by-step screenshots.

⚡ **Quick Assist** — Highlight any text on any page. Summarize, explain, troubleshoot, extract data, generate playbooks, or rewrite — using your configured LLM.

🎨 **14 Themes + Custom CSS** — Full visual customization. Dark, Matrix, Tron, Cyberpunk, Terminal, and more. Custom CSS textarea for anything else.

🧪 **8,300+ tests passing** — Zero failures. Production-hardened with comprehensive coverage.

## Built For

- IT technicians and MSPs automating multi-portal investigations
- Security teams doing threat hunts across EDR/firewall/SIEM dashboards  
- Compliance teams producing defensible audit reports
- Anyone who wants an AI agent that actually clicks, types, and reads — not just chats

## Privacy

- No analytics. No tracking. No data sent to extension developers.
- API keys stored locally in chrome.storage.
- Page content sent only to your chosen LLM provider.
- Full privacy policy: https://github.com/dirtysouthalpha/sentinel-override/blob/main/PRIVACY.md

## Category
Developer Tools

## Language
English

## Privacy Policy URL
https://github.com/dirtysouthalpha/sentinel-override/blob/main/PRIVACY.md

## Single Purpose
This extension automates browser tasks using AI vision. It reads page content, takes screenshots, and executes clicks/typing/navigation based on user instructions sent to their own configured LLM provider.

## Permission Justifications

### `debugger`
**Required for:** Capturing page screenshots via Chrome DevTools Protocol (CDP) for the vision-based agent. The agent uses `Debugger` and `Page` CDP domains to capture viewport screenshots with numbered element overlays (SoM — Set-of-Mark). This is the core mechanism — without screenshots, the agent cannot see the page.

The debugger API is also used for:
- `Runtime.evaluate` — executing JavaScript on the page for element interaction
- `Input.dispatchMouseEvent` — coordinate-based clicking when CSS selectors fail
- `Network.requestWillBeSent` — intercepting background API calls for data extraction

The debugger is attached only to tabs the user explicitly runs the agent on. It is never attached to background tabs or tabs the user hasn't interacted with.

### `<all_urls>` host permission
**Required for:** Content script injection on any website the user navigates to. The agent operates on whatever page the user is viewing — it cannot predict which domains in advance. The content scripts handle:
- Element indexing (placing numbered SoM overlays)
- Action execution (click, type, scroll, select)
- Sensitive-field detection (blocking password/SSN/API key entry)
- MFA challenge detection (auto-pausing on step-up auth)
- Virtual cursor rendering (visual feedback of agent actions)
- Quick Assist panel injection (floating AI panel for highlighted text)

Without `<all_urls>`, the agent would require users to manually grant access to every new domain — making it unusable for real-world MSP workflows that span dozens of admin portals per day.

The extension does not read data from tabs the user hasn't opened. It does not monitor browsing history. It does not communicate with any external servers except the LLM provider the user configures.

### Remaining permissions

The dashboard requires a justification for **every** permission, not just the sensitive
ones. Each entry below names the module that uses it.

| Permission | Justification |
|---|---|
| `activeTab` | Grants access to the tab the user starts a run on, so a run can begin without a broader grant. |
| `scripting` | Injects the content scripts that index elements and execute actions (`chrome.scripting.executeScript`). The agent cannot interact with a page without them. |
| `tabs` | Reads tab URL/title to give the agent page context, and opens/switches tabs when a task spans several pages. |
| `tabGroups` | Groups the tabs a single run opens (`background/agent-tabs.js`) so a multi-tab task stays visually contained and is easy to close. |
| `sidePanel` | The agent's entire UI is a side panel (`background/agent-tabs.js`, `background/index.js`) — it runs alongside the page rather than as a popup that closes on click. |
| `storage` | Stores the user's provider configuration, API keys, themes and saved runbooks locally. |
| `unlimitedStorage` | Run history, screenshots and generated reports exceed the 5 MB `storage.local` quota on long investigations. |
| `debugger` | See the dedicated section above — CDP screenshot capture is the core vision mechanism. |
| `webNavigation` | Detects page loads and sub-frame navigation (`background/frame-router.js`) so the agent waits for a page to settle before acting, and re-indexes elements after navigation. |
| `alarms` | Drives scheduled runs and the page-monitor watch feature (`background/page-monitor.js`); service workers are terminated when idle, so timers must survive as alarms. |
| `notifications` | Notifies the user when a long run finishes, fails, or pauses for MFA (`background/agent-reporting.js`) while they are working in another window. |
| `downloads` | Saves generated reports and extracted data to disk (`background/index.js`). |
| `contextMenus` | Adds the right-click actions that send highlighted text to Quick Assist (`background/context-menu.js`). |
| `cookies` | Per-client session persistence (`background/session-manager.js`) — saves and restores cookies so the agent authenticates once instead of on every run. Cookies are stored locally and never transmitted anywhere. |
| `proxy` | Per-client proxy routing (`background/proxy-manager.js`) — routes agent traffic through a client-specified proxy for IP allowlisting and network isolation, which MSP clients frequently require. |

### Remote code

The extension executes no remote code. All logic ships in the package. The only network
calls are to the LLM endpoint the user configures, and they carry prompts and screenshots
only — never extension code.

## Screenshots

Three 1280x800 PNGs are ready in `docs/screenshots-cws/` (CWS accepts 1280x800 or 640x400,
up to 5 images):

| File | Shows |
|---|---|
| `01-overview.png` | Side panel with the agent running alongside a page |
| `02-command-palette.png` | Command palette |
| `03-theme-customizer.png` | Theme gallery |

Optional additions if more are wanted: the settings modal with the provider catalog, and
the Quick Assist panel floating on a page.
