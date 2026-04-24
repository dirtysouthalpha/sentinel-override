# External Integrations

**Analysis Date:** 2026-04-24

## APIs & External Services

**LLM Providers:**
- Multiple OpenAI-compatible APIs
  - Z.ai (GLM-5.1) - `https://api.z.ai/api/paas/v4/chat/completions`
  - OpenRouter - `https://openrouter.ai/api/v1/chat/completions`
  - OpenAI - `https://api.openai.com/v1/chat/completions`
  - Ollama (Local) - `http://localhost:11434/v1/chat/completions`
  - Anthropic - Support for Anthropic API format
  - Custom endpoints - User-configurable API endpoint
- Auth: API keys stored in chrome.storage.local
- Supported models: GLM-5.1, GPT-4o, Claude, Gemini, and any OpenAI-compatible model

## Data Storage

**Databases:**
- None detected - Data stored locally in chrome.storage.local

**File Storage:**
- Local filesystem only - No external file storage

**Caching:**
- Screenshot caching in memory (configurable via CONFIG.screenshotCache)
- Pattern memory for learning successful approaches

## Authentication & Identity

**Auth Provider:**
- Custom API key authentication
- Implementation: Bearer token or x-api-key headers
- User credentials stored securely in chrome.storage.local

## Monitoring & Observability

**Error Tracking:**
- Custom error handling with retry logic
- Debug mode for troubleshooting
- Console logging for development

**Logs:**
- Chrome DevTools Protocol integration for debugging
- Agent history stored in local storage

## CI/CD & Deployment

**Hosting:**
- Chrome Web Store (implied)
- Manual distribution via ZIP file

**CI Pipeline:**
- Not detected

## Environment Configuration

**Required env vars:**
- None - All configuration stored in chrome.storage.local
- API endpoint URL
- API key
- Model selection

**Secrets location:**
- Chrome extension local storage (`chrome.storage.local`)
- Not encrypted at rest

## Webhooks & Callbacks

**Incoming:**
- Chrome Extension message listeners
- Chrome API callbacks (tabs, storage, etc.)

**Outgoing:**
- API calls to LLM providers
- Chrome DevTools Protocol commands
- Script injection via chrome.scripting

## Chrome Extension Specific

**Permissions:**
- activeTab
- scripting
- tabs
- sidePanel
- storage
- debugger

**Host Permissions:**
- `<all_urls>` - Access to any website

---

*Integration audit: 2026-04-24*
```