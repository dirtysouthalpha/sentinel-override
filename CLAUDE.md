# Sentinel Override

Human-like browser automation agent extension. Investigates, configures, and troubleshoots the web with visible interactions.

## hatz.ai + Hermes Agent Integration Reference

hatz.ai API is integrated with Hermes Agent (NousResearch) running in WSL Ubuntu-24.04 via a local proxy that bridges compatibility gaps.

### Key Facts
- **hatz.ai streaming is broken**: `response.output_item.done` has no content, `response.completed` has empty `output:[].` Non-streaming works perfectly.
- **Unsupported fields must be stripped**: `parallel_tool_calls`, `prompt_cache_key`, `store`, `include`, `reasoning` all cause errors.
- **Proxy solution**: `hatz-proxy.py` on localhost:9091 converts all requests to non-streaming, strips bad fields, wraps responses in SSE when caller wants streaming.
- **Hermes config**: provider `hatz` at `http://localhost:9091`, transport `codex_responses`, key env `HATZ_API_KEY`.
- **Dashboard**: `http://100.89.53.128:9119` (Hermes built-in web UI with embedded TUI terminal).
- **Services**: `hatz-proxy.service` and `hermes-dashboard.service` (WSL systemd user services, auto-start).
- **Full documentation**: See memory file `project_hatz_hermes.md` in the parent Claude Code project (`C:\Users\brandon.goolsby`) for complete architecture, config, troubleshooting, and file paths.
