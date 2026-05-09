# Sentinel Override v3.11.0 — Tenant Lockdown + Theme Polish + Custom CSS

**Release date:** 2026-05-09

This is the rollup release covering everything from v3.5.x through v3.11.0 — every reliability fix, MSP feature, and visual upgrade shipped in this development sprint. If you were running v3.4.x or earlier, you should upgrade.

## 🆕 What's new in v3.11.0 (the headline)

- **Tenant Lockdown** — Modifying actions on Microsoft / Azure / Office / SharePoint admin URLs are HARD-BLOCKED when the detected tenant doesn't match your `expectedTenant` setting. A red **CROSS-TENANT ACTION BLOCKED** card appears with explicit *"Yes — intentional cross-tenant work"* and *"Cancel — wrong tenant"* buttons. Per-URL override memory so you don't re-prompt mid-run. Every override is timestamped and logged to the forensic run log for compliance review.
- **6 new theme presets** — 🌅 Sunset, 🌊 Ocean, 🌌 Midnight, 📜 Paper, 🌲 Forest, ⬛ Mono. Total: 14. Auto-saves on click; "Theme: name (saved)" toast confirms.
- **Custom CSS upload** — Power-user escape hatch. Textarea in the theme modal, auto-saves on edit (350ms debounce), persists across browser restarts. Apply Now / Clear buttons + status indicator.

## 🚀 Major features delivered this sprint (v3.5 → v3.11)

### v3.10.0 — Source-Cited Outputs + 16-Provider Catalog
- **Source citations** — every specific claim in finish summaries gets `[src:memory_key]` tags that render as clickable orange chips in the popup. Click → expand the underlying memory entry inline. Auditable.
- **16-provider catalog** — OpenAI, Anthropic, Google, xAI, DeepSeek, OpenRouter, Groq, Mistral, Together, Fireworks, Cerebras, Perplexity, Z.ai, Ollama, LM Studio, Custom. One-click model auto-detection via Detect Models button.

### v3.9.x — Reliability & Observability
- **Forensic run log** with JSON/CSV export
- **Resume from checkpoint** banner on popup re-open
- **CSV/file download capture** — captured downloads appear in popup chat
- **Hallucination hard-stop gate** — blocks fabricated dense summaries
- **Defensive object serialization** — rejects `[object Object]` saves
- **Budget hint in prompt** — LLM sees remaining steps
- **Platform-aware strategy shift** — recovery hints per platform

### v3.8.x — Investigation Hardening
- **Microsoft Graph API extraction strategy** for shadow-DOM-blocked admin centers
- **End-to-end multi-portal sweep** with up to 300-step budget
- **Rolling history summarization** — bounded prompt cost on long runs
- **Periodic progress checkpoints** every 25 steps
- **Don't-give-up-early guard** — blocks premature finish on multi-portal
- **Dynamic step limit** — extends on productive work, hard cap 300
- **Configuration verification gate** — forces post-commit verification
- **Ticket FINAL_NOTES auto-formatter** with technician details
- **5 platform contexts** — SentinelOne, VirusTotal, M365, Entra, Azure
- **Sensitive-field protection** by label proximity
- **MFA challenge auto-pause** with desktop notification
- **read_console_messages + read_network_requests** CDP actions
- **Tenant chip** in popup header with auto-detection

### v3.7.x — Visibility & Awareness
- **Active Tab Strip** at top of chat — favicon, hostname, step counter, live action, Focus button
- **Live mini-screenshot panel** — collapsible thumbnail of latest observation
- **Tab group attachment** — orange "Sentinel" group glow above attached tabs
- **Per-tab side panel** — hides on unrelated tabs during runs
- **Source-tag chips** rendered in finish summaries

### v3.6.x — Visible Operator
- **Virtual operator cursor** — glides to every action target on synthetic AND CDP paths
- **CDP click visual feedback** — was missing, now matches synthetic path
- **Trusted-input typing animation** with banner streaming

## 🛡️ Security highlights

- Approval mode defaults ON for new installs
- Auto-approve timeout rejects after 60s (no silent AFK approvals)
- Sensitive fields blocked at content script level by label proximity (PSK, API keys, recovery codes, SSN, credit cards, CVV, account numbers)
- Cross-tenant modifying actions on M365 admin require explicit override
- 60-second sandboxing on `execute_js` execution
- All page content wrapped in `<UNTRUSTED_PAGE_CONTENT>` with prompt-injection defense
- No telemetry, no analytics, no data exfiltration

## 📊 By the numbers

- **33 JavaScript files**, all parse clean as ESM
- **14 themes** + custom CSS support
- **16 providers** with auto-detection
- **5 platform contexts** with vendor-specific guidance
- **300-step** maximum dynamic budget
- **20+ action types** including `read_console_messages` and `read_network_requests`

## 🔧 Installation

1. Download the source ZIP from this release.
2. Unzip.
3. Open `chrome://extensions` → enable Developer mode → Load unpacked → select the unzipped folder.
4. Pin Sentinel Override to your toolbar.
5. Open Settings → Provider Catalog → pick a provider → paste API key → Detect Models → pick a model → Save.

## ⚠️ Breaking changes from v3.4.x

- New `tabGroups` and `downloads` permissions required.
- `expectedTenant` setting is new — set it to your client's tenant for tenant lockdown to fire.
- The hardcoded 40-step ceiling that used to terminate runs is gone — runs can now go to 300 steps on productive multi-portal work.

## 🙏 Credits

Three years of MSP-pattern audit work + an extensive collaboration sprint produced this release. See `CHANGELOG.md` for the full per-version notes.

---

**Built for the techs in the trenches.**
