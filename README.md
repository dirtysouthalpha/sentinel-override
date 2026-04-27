# Sentinel Override — Browser Automation Agent

<p align="center">
  <img src="screenshots/popup-mockup.html" alt="Sentinel Override Popup" width="380" style="border-radius: 12px;">
  <br>
  <em>AI-powered browser automation with cost safeguards, plan decomposition, and TTS voice feedback</em>
</p>

[![GitHub stars](https://img.shields.io/github/stars/dirtysouthalpha/sentinel-override?style=flat-square)](https://github.com/dirtysouthalpha/sentinel-override/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

## ✨ Features

### 🧠 Plan-Decompose Architecture
Intelligently breaks down your instructions into sequential steps, shows you the plan, and executes with per-step progress tracking — just like Claude for Chrome.

### 🛡️ Hard-Coded Cost Safeguards
- **Model Whitelist** — only approved models allowed per provider (Venice, OpenRouter, z.ai)
- **Block List** — expensive models (GPT-4, Claude Opus, etc.) are blocked at the code level
- **Per-Call Budget** — $0.50 input / $0.50 output per request
- **Session Budget** — $5.00 hard limit per session
- **Cost Logging** — full audit trail of every API call with cost tracking

### 🎤 JennyNeural TTS (Local)
Click the **Speak** button to hear the last assistant response read aloud using natural-sounding voice. Runs locally on port 8765.

### ⌨️ Saved Shortcuts
Save frequently used prompts as shortcuts (Ctrl+Shift+S), then run them with one click from the Shortcuts modal.

### 🌐 Multi-Provider Support
| Provider | Configuration | Status |
|----------|--------------|--------|
| **OpenRouter** | Default — single API key to 200+ models | ✅ |
| **Venice.ai** | Uncensored models, low cost | ✅ |
| **z.ai** | Prepaid coding plan | ✅ |
| **Custom** | Any OpenAI-compatible endpoint | ✅ |

### 🎨 Themes
8 built-in themes: Light, Dark, Matrix, Tron, Cyberpunk, Neon, Terminal, Blood. Customize colors with the theme picker.

## 📸 Screenshots

| Feature | Preview |
|---------|---------|
| **Plan Card** | Shows decomposed steps with approve/reject buttons |
| **Settings** | Provider dropdown (OpenRouter / Venice / z.ai / Custom), API key, model ID, Approval Mode toggle |
| **Shortcuts** | Save and run frequently used prompts |
| **Agent Actions** | Claude-style action cards showing each step with status |

> **Note:** Open `screenshots/*.html` files in a browser to see interactive mockups of the extension UI.

## 🚀 Quick Start

### 1. Install the Extension
1. Clone this repo:
   ```bash
   git clone https://github.com/dirtysouthalpha/sentinel-override.git
   ```
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer Mode** (toggle in top-right)
4. Click **Load Unpacked** → select the `browser_agent/` directory

### 2. Configure API Access

#### Option A: OpenRouter (Recommended)
1. Sign up at [openrouter.ai](https://openrouter.ai) and get your API key
2. Click the settings gear icon in the extension toolbar
3. Select **OpenRouter** from the provider dropdown (auto-fills endpoint)
4. Paste your API key
5. Default model: `deepseek-v4-flash` (cost-effective, high quality)

#### Option B: Venice.ai
1. Get API key from [venice.ai](https://venice.ai)
2. Select **Venice.ai** in settings — auto-fills endpoint
3. Only whitelisted models are allowed (e.g., `gemma-4-uncensored`, `grok-41-fast`)

### 3. Start Automating!
Open the extension sidebar (click the toolbar icon) and type:
> *"Search Gmail for invoices from last month and create a summary"*

The agent will:
1. Show you a plan with 3-5 steps
2. Wait for your approval
3. Execute each step with live progress updates
4. Report results when done

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+Shift+S` | Save current prompt as shortcut |
| `Cmd/Ctrl+N` | New chat |

## 🧠 How It Works

```mermaid
flowchart LR
    A[User Types Goal] --> B[planTask() Decomposes into Steps]
    B --> C[Show Plan Card in Popup]
    C --> D{User Approves?}
    D -->|Yes| E[executePlan() Runs Steps]
    D -->|No| F[Plan Rejected]
    E --> G[Step 1: Navigate]
    G --> H[Step 2: Extract Data]
    H --> I[Step 3: Process]
    I --> J[Complete! Summary]
    subgraph S[Cost Safeguards Active]
        K[Model Whitelist Check]
        L[Budget Validation]
        M[Session Tracking]
    end
    E --- S
```

### Task Context Retention
Every LLM call includes full context: original goal, completed steps, collected data, and failed attempts. This means the agent never loses sight of what it's doing across multi-step tasks.

### Auto-Tool Generation
If a step fails (e.g., element not found), the agent automatically asks the LLM to generate a workaround script and injects it — never gets stuck because of missing selectors.

## 🔧 Development

### Project Structure
```
browser_agent/
├── background.js      # Service worker — core logic, plans, execution, cost safety
├── content.js         # Content script — page interaction, element selection
├── popup.html         # Extension popup UI (sidebar panel)
├── popup-full.js      # Popup logic — chat, plans, settings, shortcuts
├── manifest.json      # Extension manifest
├── marked.min.js      # Markdown renderer
├── icon-*.png         # Extension icons (16, 32, 48, 128, 256)
├── screenshots/       # UI mockups for documentation
│   ├── popup-mockup.html
│   ├── settings-mockup.html
│   └── shortcuts-mockup.html
└── .gitignore
```

### Key Technologies
- **Chrome Extensions API** (sidePanel, storage, scripting, tabs, alarms)
- **JavaScript** — vanilla, no framework overhead
- **OpenAI-compatible API** — works with OpenRouter, Venice, z.ai, or any provider

## 🔒 Security

- API keys are stored in `chrome.storage.local` (encrypted at rest by Chrome)
- Cost limits are hard-coded in `background.js` under `COST_SAFETY` object
- Model whitelist is enforced at the code level — cannot be overridden by prompt injection
- All API calls are logged with cost tracking in `costLog` array

## ⚠️ Cost Safety

This extension was **born from a $80 bill** from a single accidental API call to an expensive model. Every cost safeguard is hard-coded and cannot be bypassed:

```javascript
// In background.js — these limits cannot be changed via prompt
const COST_SAFETY = {
  MAX_INPUT_COST: 0.50,    // Per-call input limit
  MAX_OUTPUT_COST: 0.50,   // Per-call output limit
  MAX_TOTAL_COST: 1.00,    // Per-call total limit
  MAX_SESSION_COST: 5.00,  // Session hard cap
  BLOCKED_MODEL_PREFIXES: ['gpt-4', 'claude-opus', ...],
  VENICE_ALLOWED_MODELS: new Set(['gemma-4-uncensored', 'grok-41-fast', ...])
};
```

## 📊 Roadmap

- [ ] **Approval Mode** — per-step confirmation before execution (DONE)
- [ ] **Saved Shortcuts** — reusable prompt templates (DONE)
- [ ] **Cloud Sync** — sync settings and shortcuts across devices
- [ ] **Execution History** — replay past task runs
- [ ] **Custom Actions API** — user-defined reusable action blocks

## 🤝 Contributing

PRs welcome! Please read our code of conduct before contributing.

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

## 🙏 Acknowledgments

- Built with [OpenRouter](https://openrouter.ai), [Venice.ai](https://venice.ai), and [z.ai](https://z.ai)
- Voice by [Microsoft Edge-TTS](https://github.com/rany2/edge-tts) (JennyNeural)
- Inspired by [Claude for Chrome](https://claude.ai/chrome)
- Created with [Agent Zero](https://github.com/frdel/agent-zero)

---
<p align="center">
  Made with 🛡️ by <a href="https://github.com/dirtysouthalpha">dirtysouthalpha</a>
</p>
