## Hotfix

Silences benign `Uncaught (in promise) Error: No active side panel for tabId: <n>` entries in the chrome://extensions Errors tab.

### What changed
- `background/index.js`: three `chrome.sidePanel.*` calls in non-async listener contexts now have `.catch(() => {})` handlers, plus a defensive tab existence check in the icon-click handler. The `toggle-agent` keyboard shortcut now queries the active tab before calling `sidePanel.open()` so it always has a valid `tabId`.
- `manifest.json`: `3.11.1` -> `3.11.2`.

### Why this didn't affect functionality
Every `sidePanel` call from `agent-engine.js` was already wrapped in try/catch. The `tabs.onActivated` handler in `index.js` was also wrapped. The three sites fixed in this patch were the only unprotected ones. The side panel always rendered correctly; only the Errors tab was noisy.

No functional change. Drop-in replacement for v3.11.1.
