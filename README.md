# Sentinel Override

![Emblem](emblem.svg)

[![Version](https://img.shields.io/github/v/tag/dirtysouthalpha/sentinel-override?label=version)](https://github.com/dirtysouthalpha/sentinel-override/releases)
[![License](https://img.shields.io/github/license/dirtysouthalpha/sentinel-override)](https://github.com/dirtysouthalpha/sentinel-override/blob/main/LICENSE)
[![Release](https://img.shields.io/github/release/dirtysouthalpha/sentinel-override.svg)](https://github.com/dirtysouthalpha/sentinel-override/releases)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/dirtysouthalpha/sentinel-override/graphs/commit-activity)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dirtysouthalpha/sentinel-override/pulls)

## AI-Powered Browser Automation Chrome Extension

**Sentinel Overdrive** is an LLM-powered Chrome extension that automates browser tasks with structured data extraction, persistent memory, and AI-driven planning. It supports multiple LLM providers (OpenRouter, z.ai Coding Plan, Venice.ai, OpenAI, Claude) with built-in cost safeguards to keep usage under $0.50 per 1k tokens.

### 🚀 Features

- **AI Planning & Execution**: Decomposes goals into executable steps with auto‑tool generation.
- **Structured Data Extraction**: Extracts JSON‑structured data from web pages.
- **Persistent Memory**: Stores conversation history, intermediate data, and task context across sessions.
- **Multi‑Provider Support**: Seamlessly switch between OpenRouter, z.ai, Venice.ai, OpenAI, and Claude APIs.
- **Cost Safety**: Enforces per‑call and session spending limits; defaults to affordable models.
- **Claude‑Style Tab Management**: Reuses or creates tabs for AI‑driven workflows, mimicking the Chrome extension.
- **Persistent UI**: Dark/light theme, voice input, file attachments, markdown preview, and export.
- **Extensible**: Easy to add new providers, tools, and UI components.

### 📦 Installation

1. Clone the repository or download the latest release.
2. Open Chrome/Edge → `chrome://extensions` → enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. The extension icon will appear in the toolbar.

### 🛠️ Usage

1. Click the extension icon to open the popup.
2. Configure your preferred LLM provider and API key in the settings (gear icon).
3. Enter a goal (e.g., "Extract all issue titles from the GitHub repository") and press **Send**.
4. The agent will propose a plan; approve or modify it.
5. Watch the agent execute steps, extract data, and return results.
6. Export the conversation as JSON, Markdown, or plain text.

### 🔧 Configuration

- **Provider**: Choose from OpenRouter (default), z.ai Coding Plan, Venice.ai, OpenAI, or Claude.
- **Endpoint & Model**: Auto‑filled based on provider; can be overridden.
- **API Key**: Required for the selected provider.
- **Cost Limits**: Built‑in safeguards prevent excessive spending.

### 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a pull request.

### 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

*Keywords*: AI agent, browser automation, Chrome extension, OpenRouter, z.ai, Venice.ai, OpenAI, Claude, LLM, task automation, structured data extraction, persistent memory, cost safety, tab handling, AI planning.
