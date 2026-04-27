# Sentinel Override - Usage Guide

## Installation

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer Mode** (toggle in top right).
3. Click **Load unpacked**.
4. Select the `browser_agent` folder from this repository.
5. The **SentinelAgent Browser** icon should appear in your toolbar.

## Quick Start

1. **Click the Icon**: Opens the side panel.
2. **Enter Instruction**: Type what you want the agent to do (e.g., "Find the top 3 news sites about AI").
3. **Plan & Approve**: The agent will propose a plan. Review it and click **Execute**.
4. **Watch it Work**: The agent will navigate, click, and read pages automatically.

## Features

### Shortcuts
- Press **`/`** in the instruction box to open the **Shortcuts Menu**.
- Select a saved prompt to run it instantly.
- **Save New Shortcut**: After running a complex prompt, click the **Save** icon to reuse it.

### Settings
- Click the **Gear Icon** to open Settings.
- **Provider**: Choose between OpenRouter, Venice, z.ai, or Custom.
- **Cost Safety**: View current session budget and per-call limits.
- **TTS**: Toggle text-to-speech for agent updates.

## Example Prompts

### Research
> "Find the top 5 GitHub repositories for 'browser automation' in 2026 and summarize their key features."

### Shopping
> "Compare the prices of the MacBook Air M3 and M2 on Amazon. List the best deal."

### News
> "Read the latest headlines from the BBC website and summarize the top 3 stories."

### Coding
> "Find the documentation for the latest Python release and summarize the new features."

## Troubleshooting

- **Extension not loading**: Ensure Developer Mode is on and you selected the correct folder.
- **Agent stuck**: Click the **Stop** button in the side panel.
- **API Error**: Check your API key in Settings > Provider.
