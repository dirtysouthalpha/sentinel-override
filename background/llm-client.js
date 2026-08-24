// Sentinel Override v3 — LLM Client
// API calls, retry logic, response parsing, vision detection, platform context.
// Imports from message-protocol.js only (no circular dependency risk).

;
import {getAllTabContexts, getActiveTabId, TAB_LIMIT} from './tab-context.js';
import {resolveProviderForConfig, getActiveProvider, getModelSupportsVision, providerRequiresApiKey} from './provider-registry.js';
import {getEgressScrubber, shouldScrub, SCRUB_MODE} from './egress-scrub.js';
import {getPlatformProfile} from './platforms/index.js';
import {getErrorMessage} from './error-utils.js';
import {API_TIMEOUT_MS, PLATFORM_CTX_CACHE_TTL_MS, ONE_SECOND_MS} from './constants.js';
import {_rateLimiter, setLLMRateLimit, resetLLMRateLimiter} from './llm-rate-limiter.js';
import {buildAgentPrompt} from './agent-prompt-builder.js';
export { setLLMRateLimit, resetLLMRateLimiter };
import {estimateCostUsd, isSimpleStep, recordModelUsage, getCostTracker} from './llm-cost-estimation.js';
export { estimateCostUsd, isSimpleStep, recordModelUsage, getCostTracker };
import {generatePlan} from './llm-planning.js';
export { generatePlan };
import {callLLMWithRetry} from './llm-retry.js';
export { callLLMWithRetry };

// Constants for response parsing - avoid recreating on every call
const VALID_ACTION_TYPES = new Set(['click', 'type', 'navigate', 'scroll', 'select', 'hover', 'press_key',
  'extract', 'extract_list', 'wait', 'wait_for_text', 'wait_for_element', 'wait_for_navigation',
  'execute_js', 'read_page', 'note', 'finish', 'open_tab', 'switch_tab', 'close_tab',
  'dismiss_overlay', 'switch_to_frame', 'switch_to_parent_frame', 'drag_and_drop', 'right_click', 'double_click',
  'navigate_back', 'navigate_forward',
  'click_at', 'scroll_to', 'check', 'check_all', 'open_dropdown', 'upload_file',
  'read_console_messages', 'read_network_requests',
  'lookup', 'run_remote_command', 'verify', 'repeat_for_each',
  'smart_navigate', 'batch']);

// Precompiled regex for extracting JSON from markdown code blocks
const CODE_BLOCK_REGEX = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;

// Precompiled regex patterns for platform detection (performance optimization)
const SONICWALL_TEXT_RE = /sonicwall|sonicos/;
const SONICWALL_PATH_RE = /\/ui\b|#\/dashboard|#\/firewall|#\/network|#\/security/;
const FORTINET_URL_RE = /fortinet|fortigate|fortimanager/;
const FORTINET_TEXT_RE = /fortinet|fortigate/;

// Precompiled regex patterns for plan parsing (performance optimization)
const WHITESPACE_REPLACE_RE = /\s+/g;

// Precompiled regex patterns for salvaging finish/note from malformed LLM responses
const FINISH_SALVAGE_REGEX = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/m;
const NOTE_SALVAGE_REGEX = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/m;
const CISCO_URL_RE = /cisco|\/asdm|\/fmc|meraki|\.ise\./;
const CISCO_TEXT_RE = /cisco asa|firepower|meraki|cisco ise/;
const PALOALTO_URL_RE = /paloalto|panorama|\/php\/rest\/pan/;

// Precompiled regex patterns for vision support detection (performance optimization)
const GPT_3_5_RE = /^gpt-3\.5/i;
const CLAUDE_3_HAIKU_TEXT_RE = /^claude-3-haiku-text/i;
const CLAUDE_2_RE = /^claude-2(\b|-)/i;
const CLAUDE_INSTANT_RE = /^claude-instant/i;
const TEXT_ONLY_RE = /-text-only$/i;
const CLAUDE_OPUS_SONNET_RE = /\bclaude-(opus|sonnet|haiku|3|4|5)\b/i;
const GPT_4_RE = /\bgpt-(4o|4\.1|4-vision|5|o\d)\b/i;
const GEMINI_RE = /\bgemini\b/i;
// Self-hosted VL builds do not follow one naming convention. The old
// /\bqwen[\w.-]*-vl\b/ required a dash before "vl", so `qwen2.5vl:7b` (the
// default ollama tag) reported NOT vision-capable, and `vl-7b-dspark` matched
// neither /-vl-/ nor /-vl$/. Both are vision models that were being told, in
// their own system prompt, that they could not see.
const QWEN_VL_RE = /\bqwen[\w.]*-?vl\b/i;
const LLAVA_RE = /\bllava\b/i;
const VISION_RE = /vision/i;
const VL_DASH_RE = /-vl-/i;
const VL_END_RE = /-vl$/i;
// `vl-7b-dspark`, `vl-7b`, `vl_3b` — a leading "vl" segment.
const VL_START_RE = /^vl[-_.]/i;
// `qwen2.5vl:7b`, `internvl2-8b`, `minicpm-v-2.6`, `pixtral-12b`, `moondream2`.
const VL_TAGGED_RE = /\bvl[:\-_.]?\d/i;
const INTERNVL_RE = /internvl/i;
const MINICPM_V_RE = /\bminicpm-?v\b/i;
const PIXTRAL_RE = /\bpixtral\b/i;
const MOONDREAM_RE = /moondream/i;
const PALOALTO_TEXT_RE = /palo alto|pan-os|panorama/;
const SENTINELONE_URL_RE = /sentinelone\.net|\.sentinelone\.com|s1\.com/;
const SENTINELONE_TEXT_RE = /sentinelone|singularity/;
const NVD_URL_RE = /(nvd\.nist\.gov|cve\.mitre\.org|cve\.org)/;
const VIRUSTOTAL_URL_RE = /virustotal\.com|vt-api/;
const VIRUSTOTAL_TEXT_RE = /virustotal| vt /;
const M365_ADMIN_URL_RE = /admin\.microsoft\.com|admin\.exchange\.microsoft\.com|admin\.exchange\.outlook\.com|compliance\.microsoft\.com|security\.microsoft\.com|purview\.microsoft\.com/;
const ENTRA_URL_RE = /entra\.microsoft\.com|aad\.portal\.azure\.com|myapps\.microsoft\.com/;
const ENTRA_TEXT_RE = /entra/;
const AZURE_AD_TEXT_RE = /azure ad/;
const MICROSOFT_URL_RE = /microsoft/;
const AZURE_PORTAL_RE = /portal\.azure\.com|preview\.portal\.azure\.com/;
const CONNECTWISE_URL_RE = /connectwise|cw\.manage|my\.connectwise|cwautomate/;
const CONNECTWISE_TEXT_RE = /connectwise/;
const DATTO_URL_RE = /datto|centrestage|autotask|adra/;
const DATTO_TEXT_RE = /datto rmm|autotask/;
const ITGLUE_RE = /itglue|it-glue/;
const HUNTRESS_RE = /huntress/;
const SCREENCONNECT_URL_RE = /screenconnect|connectwisecontrol/;
const SCREENCONNECT_TEXT_RE = /screenconnect/;
const GENERIC_NETWORK_RE = /firewall|router|switch|access point|management ui|admin panel|web ui/;

// Precompiled regex patterns for intent parsing (performance optimization)
const FORECAST_QUERY_RE = /(?:forecast|weather|search|find|look\s*up|about)\s+(?:for\s+)?["']?([^"',]+?)["']?\s*(?:\s+(?:and|then|,|\.|in\s+a|summar|$))/i;
const FOR_ABOUT_QUERY_RE = /(?:for|about)\s+(.+?)(?:\s+(?:and|then|,|\.|$))/i;
const NAVIGATE_URL_RE = /navigate\s+(?:to\s+)?(?:the\s+)?(?:url\s+)?["']?(https?:\/\/[^\s"'\])\]]+)/i;
const NAVIGATE_SITE_RE = /(?:go|navigate)\s+(?:to\s+)?(?:the\s+)?(amazon|reddit|youtube|google|twitter|github|wikipedia|hackernews|hacker\s+news|cnn|bbc|nytimes|weather\.gov|stackoverflow|facebook|instagram|linkedin)[\s.,)]/i;
const ARTICLE_GOAL_RE = /\b(?:top|first|best|recent)\s+(\d{1,2})\s+(articles?|stories|posts?|items?|headlines?|results?)\b/i;

// Site name to domain mapping - avoid recreating on every call
const SITE_DOMAIN_MAP = {
  amazon: 'amazon.com',
  reddit: 'reddit.com',
  youtube: 'youtube.com',
  google: 'google.com',
  twitter: 'twitter.com',
  github: 'github.com',
  wikipedia: 'wikipedia.org',
  hackernews: 'news.ycombinator.com',
  'hacker news': 'news.ycombinator.com',
  cnn: 'cnn.com',
  bbc: 'bbc.com',
  nytimes: 'nytimes.com',
  'weather.gov': 'weather.gov',
  stackoverflow: 'stackoverflow.com',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  linkedin: 'linkedin.com'
};

// Valid JSON escape characters - avoid recreating on every call
const VALID_JSON_ESCAPE_CHARS = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

// API Health Heartbeat - tracks LLM API responsiveness
const _apiHealth = {
  lastResponseTime: null,
  avgResponseTime: null,
  totalCalls: 0,
  failures: 0,
  _times: [],    // rolling window of last 10 response times
  _lastPing: null,

  record(startTime, ok) {
    const elapsed = Date.now() - startTime;
    this._times.push(elapsed);
    if (this._times.length > 10) this._times.shift();
    this.totalCalls++;
    if (!ok) this.failures++;
    this.lastResponseTime = elapsed;
    this.avgResponseTime = Math.round(this._times.reduce((a, b) => a + b, 0) / this._times.length);
    this._lastPing = Date.now();
    // Emit health status to popup
    try {
      const status = this.getStatus();
      chrome.runtime.sendMessage({ type: 'api_health', ...status }).catch(() => {});
    } catch (_e) { /* popup not open */ }
  },

  getStatus() {
    const now = Date.now();
    const stale = this._lastPing && (now - this._lastPing > 60000);
    let state = 'unknown';
    if (stale || !this._lastPing) state = 'idle';
    else if (this.avgResponseTime && this.avgResponseTime < 5000) state = 'healthy';
    else if (this.avgResponseTime && this.avgResponseTime < 15000) state = 'slow';
    else if (this.failures > 3) state = 'down';
    else if (this._lastPing) state = 'healthy';
    return {
      state,
      avgMs: this.avgResponseTime,
      lastMs: this.lastResponseTime,
      totalCalls: this.totalCalls,
      failures: this.failures,
      timestamp: now
    };
  }
};

// ========== Multi-Portal Investigation Analyzer (3.8.1) ==========
// Detects when a goal mentions 2+ M365/security admin centers (Entra,
// Exchange, Purview, OneDrive, SharePoint, Teams, Intune, Defender, Compliance,
// Azure portal, Sentinel/RMM tools, ConnectWise, etc.) so the planner can
// route to checklist-deliverable + one-portal-execution mode instead of
// trying to cover everything in a single run and inevitably running out.

// Precompile regex patterns for performance optimization
const ENTRA_MP_RE = new RegExp('\\bentra(\\.microsoft|\\s+id)?\\b|\\bazure\\s+ad\\b|\\bsign.?in\\s+logs?\\b|\\baudit\\s+logs?\\b', 'i');
const EXCHANGE_MP_RE = new RegExp('\\bexchange(\\s+online)?\\b|\\bmailbox(\\s+audit)?\\b|\\bmessage\\s+trace\\b|\\binbox\\s+rules?\\b|\\btransport\\s+rules?\\b|\\bmail\\s+flow\\b', 'i');
const PURVIEW_MP_RE = new RegExp('\\bpurview\\b|\\bunified\\s+audit\\s+log\\b|\\bcompliance\\s+(center|search)\\b|\\bedisco\\b|\\bcontent\\s+search\\b', 'i');
const ONEDRIVE_MP_RE = new RegExp('\\bonedrive\\b|\\bone.?drive\\b', 'i');
const SHAREPOINT_MP_RE = new RegExp('\\bsharepoint\\b|\\bsharing\\s+externally\\b', 'i');
const TEAMS_MP_RE = new RegExp('\\bteams(\\s+admin|\\s+chat|\\s+meeting|\\s+call)?\\b', 'i');
const INTUNE_MP_RE = new RegExp('\\bintune\\b|\\bmdm\\b|\\bmem\\b', 'i');
const DEFENDER_MP_RE = new RegExp('\\bdefender(\\s+for\\s+endpoint|\\s+for\\s+identity|\\s+for\\s+cloud)?\\b|\\bmde\\b|\\bdevice\\s+timeline\\b', 'i');
const M365_ADMIN_MP_RE = new RegExp('\\badmin\\.microsoft\\b|\\bm365\\s+admin\\b|\\boffice\\s+365\\s+admin\\b', 'i');
const AZURE_PORTAL_MP_RE = new RegExp('\\bportal\\.azure\\b|\\bazure\\s+portal\\b', 'i');
const SENTINELONE_MP_RE = new RegExp('\\bsentinelone\\b|\\bsingularity\\b|\\bs1\\s+console\\b|\\bdeep\\s+visibility\\b', 'i');
const CONNECTWISE_MP_RE = new RegExp('\\bconnectwise\\b|\\bcw\\.manage\\b|\\bcw\\s+manage\\b', 'i');
const NINJAONE_MP_RE = new RegExp('\\bninjaone\\b|\\bninja\\s+rmm\\b', 'i');
const DATTO_MP_RE = new RegExp('\\bdatto\\b|\\bautotask\\b', 'i');
const ITGLUE_MP_RE = new RegExp('\\bit\\s*glue\\b', 'i');
const HUNTRESS_MP_RE = new RegExp('\\bhuntress\\b', 'i');

const MULTI_PORTAL_DETECTORS = [
  { key: 'entra',          re: ENTRA_MP_RE },
  { key: 'exchange',       re: EXCHANGE_MP_RE },
  { key: 'purview',        re: PURVIEW_MP_RE },
  { key: 'onedrive',       re: ONEDRIVE_MP_RE },
  { key: 'sharepoint',     re: SHAREPOINT_MP_RE },
  { key: 'teams',          re: TEAMS_MP_RE },
  { key: 'intune',         re: INTUNE_MP_RE },
  { key: 'defender',       re: DEFENDER_MP_RE },
  { key: 'm365_admin',     re: M365_ADMIN_MP_RE },
  { key: 'azure_portal',   re: AZURE_PORTAL_MP_RE },
  { key: 'sentinelone',    re: SENTINELONE_MP_RE },
  { key: 'connectwise',    re: CONNECTWISE_MP_RE },
  { key: 'ninjaone',       re: NINJAONE_MP_RE },
  { key: 'datto',          re: DATTO_MP_RE },
  { key: 'itglue',         re: ITGLUE_MP_RE },
  { key: 'huntress',       re: HUNTRESS_MP_RE }
];

/**
 * Detect which admin portals (Entra, Exchange, Defender, etc.) are referenced in a goal string.
 * @param {string} goal - The user's goal text to scan.
 * @returns {string[]} Array of detected portal keys (e.g. ['entra', 'exchange']).
 */
export function detectGoalPortals(goal) {
  if (!goal || typeof goal !== 'string') return [];
  const found = [];
  for (const d of MULTI_PORTAL_DETECTORS) {
    if (d.re.test(goal)) found.push(d.key);
  }
  return found;
}

/**
 * Build the multi-portal execution directive injected into the system prompt
 * when a goal spans 2+ admin portals. Returns empty string if only one (or zero).
 * @param {string} goal - The user's goal text.
 * @returns {string} Multi-portal directive, or '' if not applicable.
 */
export function getMultiPortalDirective(goal) {
  const portals = detectGoalPortals(goal);
  if (portals.length < 2) return '';
  const portalList = portals.join(', ');
  return `
## ⚠ MULTI-PORTAL INVESTIGATION — END-TO-END EXECUTION REQUIRED (3.8.2)

This goal spans ${portals.length} admin centers/portals: ${portalList}.

**You have an EXTENDED step budget for this run** (up to 300 steps with
productive-action extension). The user EXPECTS you to complete the entire
investigation end-to-end, NOT to stop early and suggest follow-ups.

REQUIRED EXECUTION PATTERN:

1. **Plan portal-by-portal.** Decide the order — start with the highest-value
   portal for the investigation question, but visit ALL of them. Move through
   the list systematically.

2. **For each portal:**
   - Navigate to the portal (open_tab when useful so you can return without
     reloading state in other portals).
   - Run the relevant investigation queries / filters / searches.
   - Use \`extract\` / \`extract_list\` / \`read_network_requests\` /
     \`scroll_and_collect\`-via-execute_js to PULL ACTUAL DATA, not just
     navigate. Aim for at least 2-3 productive extractions per portal.
   - **Save findings to memory using portal-prefixed keys** like
     \`entra_signins\`, \`exchange_rules\`, \`purview_audit_search\`,
     \`onedrive_external_shares\`, \`teams_call_summary\`, etc. The
     finish summary will group findings by these keys.
   - Use \`note\` actions to record per-portal section headers as you
     finish each portal (e.g., note: "PORTAL: Entra ID — sign-in audit
     complete, 47 records pulled, 3 anomalies flagged").

3. **Pace yourself.** Productive actions extend the run; aimless reads
   shorten it. Spend most steps on extract/execute_js/note, not on read_page
   or scroll. Avoid re-reading the same page (READ_PAGE LOOP guard fires
   after 2 consecutive read_page calls).

4. **Per-step orientation:** at the start of each portal, briefly note
   "Now investigating <portal>" so the progress stream shows the user where
   you are. The popup's Active Tab strip surfaces this automatically; the
   note also lands in the run log.

5. **Final report structure** (when you call \`finish\`):
   - Executive summary (1-3 sentences)
   - Per-portal findings, in order: each portal gets a section header,
     concrete evidence (timestamps, IPs, device names, event IDs, file
     paths, audit entries), and a noteworthy-or-not assessment
   - Cross-portal correlation: any patterns connecting findings across
     portals (same IP across Entra + Defender, same time window, etc.)
   - "Next questions for the client" — anything you couldn't determine
     from the audit (known work hours, known devices, etc.)
   - Defensible language only: timestamps, IPs, devices, event IDs,
     concrete audit entries. NO speculation. Mark items as "noteworthy"
     or "no evidence found" — never invent.

DO NOT stop after one portal and suggest follow-ups. DO NOT produce just a
checklist. The user has explicitly said they want the investigation handled
end-to-end. You have the budget and the tools — execute the sweep.
`;
}

// (3.20.0) Multi-article research pattern detection. The naive pattern
// (open_tab → note → close_tab × N) burns 3 steps per article — 30 steps
// for 10 articles, overflowing a typical step budget. This directive
// teaches a tighter pattern: batch-open in groups, then loop with
// read_page + note WITHOUT close, then close at the end.
const MULTI_ARTICLE_PATTERN = /\b(top|first|best|recent)\s+(\d{1,2})\s+(articles?|stories|posts?|items?|headlines?|results?)\b|\b(give|provide|write|do)\s+(?:me\s+)?(?:a\s+)?(?:full\s+)?(?:breakdown|summary|recap|briefing|overview)\s+(?:on|for|of)\s+each\b/i;

// Precompile regex for runbook pattern detection (hot paths in adaptive prompts)
const RUNBOOK_PATTERN_RE = /STEP\s+\d|PHASE\s+\d|INVESTIGATION|RUNBOOK|runbook|investigation/i;
const RUNBOOK_COMPREHENSIVE_RE = /STEP\s+\d|PHASE\s+\d|INVESTIGATION|RUNBOOK|Navigation:|Success Indicator|TICKET|checkpoint|rollback|decision tree|Phase [0-9]|what has been tried|fastest.*resolution/i;

/**
 * Build the multi-article directive for news/reading goals that request
 * summarizing multiple articles. Returns '' if not a multi-article goal.
 * @param {string} goal - The user's goal text.
 * @returns {string} Multi-article execution directive, or ''.
 */
export function getMultiArticleDirective(goal) {
  if (!goal || typeof goal !== 'string') return '';
  if (!MULTI_ARTICLE_PATTERN.test(goal)) return '';
  // Try to extract N if present
  const m = goal.match(ARTICLE_GOAL_RE);
  const parsedN = m ? parseInt(m[1], 10) : 0;
  const n = parsedN;
  const nLabel = (n > 0) ? n : 'N';

  return `
## 📰 MULTI-ARTICLE RESEARCH — USE BATCH PATTERN (3.20.0)

This goal asks for a deep breakdown of ${nLabel} articles. The NAIVE pattern
of open_tab → note → close_tab per article burns 3 steps × ${nLabel} = ${n > 0 ? (3 * n) : '3N'} steps and
will overflow your budget. Use this BATCH pattern instead:

### Phase A — One step: extract the article list
- Navigate to the source page, then run ONE \`execute_js\` with a \`key\` to
  scrape all ${nLabel} headlines + URLs in one shot. Save as e.g. \`top_links\`.
- Filter dedup early (don't re-extract the same headline twice).

### Phase B — Batch open tabs (3-5 at a time)
- Use \`open_tab\` with a label like \`article-1\`, \`article-2\`, ... for the
  first 3-5 URLs. Do NOT close tabs between articles in this phase.
- After each open_tab, the agent automatically switches to the new tab.

### Phase C — Loop: read + note, WITHOUT close_tab
- For each open tab: \`read_page\` then \`note\` with a 2-3 sentence summary
  (NOT a single-step open+close cycle). 2 steps per article, not 3.
- The \`note\` action persists the summary to history with portal-prefix
  memory keys recommended (\`article_1_summary\`, \`article_2_summary\`...).

### Phase D — Batch-close at the end
- After all ${nLabel} articles have been read + noted, you may close tabs in
  one pass if needed for memory pressure. But the finish handler closes all
  agent-created tabs automatically — usually you don't need explicit
  close_tab actions at all.

### Step-budget math
- Phase A: 2 steps (navigate + execute_js).
- Phase B-C: ~2 steps per article = 2*${nLabel} = ${n > 0 ? (2 * n) : '2N'} steps.
- Total: ~2 + 2*${nLabel} = ${n > 0 ? (2 + 2 * n) : '2 + 2N'} steps. Well within a 20-step budget for N≤9.

### Honest scope-setting
- If the goal genuinely asks for 10 deep article summaries AND the step
  budget is tight, prioritize: deliver thorough breakdowns of the top 3-5
  articles + headline-only listing for the rest. Mark the rest clearly as
  "[headline only — not read in this run]" so the user knows the limit.
- Never invent article content you didn't actually read.

### Cross-origin caveat
- If the goal source page (e.g., drudgereport.com, Hacker News) is just a
  headline aggregator and articles are on other domains, \`execute_js\`
  with \`fetch()\` running on the aggregator's page will be blocked by CORS
  for cross-origin article URLs. Stick with the batch open_tab pattern in
  that case — that's the right call.
`;
}

// ========== Platform Context Detection ==========
// Detects which UI the agent is currently operating in based on the page URL
// and goal text, then injects platform-specific behavioral guidance.
// Specifics (IPs, credentials, zone names, rule names) are intentionally NOT
// hardcoded here -- those come from the user's goal/Context Memory. This
// function only provides UI interaction patterns for each platform type.

// (3.18.0) Renamed to internal; the new wrapper below appends structured
// selector hints from the platforms/ profile system. Existing prose logic
// untouched — selectors complement, not replace.
// Platform detection specs: each entry has a test(url, text) predicate and prose to inject.
// Evaluated in order; first match wins. Keeping detection logic and prose co-located makes
// it easy to add or update platforms without touching function control flow.
const _PLATFORM_SPECS = [
  {
    test: (url, text) =>
      url.includes('sonicwall') || SONICWALL_TEXT_RE.test(text) ||
      SONICWALL_PATH_RE.test(url),
    prose: `
PLATFORM: SonicWall Management UI (SonicOS)
UI-SPECIFIC RULES -- follow these exactly:

DROPDOWNS: SonicWall uses Angular custom dropdowns, NOT native <select> elements.
  - To select a value: first CLICK the dropdown trigger to open the list, then CLICK the desired option.
  - Never use the "select" action on SonicWall dropdowns -- it only works on native HTML <select> and will silently fail here.
  - If a dropdown doesn't open on first click, try hover then click.

SAVING CHANGES: Every policy/object change requires an explicit commit step.
  - After editing a rule or object, look for an "Accept", "Apply", "OK", or "Save" button and click it.
  - Changes shown on screen are NOT saved until committed -- always confirm before moving on.
  - After committing, wait for the success toast/banner before proceeding.

LOG PAGES: Log > View and Connection Monitor pages are slow to populate.
  - After navigating to a log page, use wait_for_text with a 30000ms timeout before reading.
  - Filter inputs may need a click to focus before type will work.
  - Export/download buttons generate CSV files -- note the filename in a "note" action.

NAVIGATION: SonicWall uses SPA hash routing (#/path).
  - After clicking a nav item, wait 2-3 seconds for the panel to render before scanning elements.
  - If a panel seems empty, use scroll to reveal lazy-loaded content, then read_page again.

POLICY RULES TABLE: Click a rule row to open its edit dialog.
  - The edit icon (pencil) or the row itself opens the edit form.
  - Rule order matters: note the row number/position as well as the rule name.

SESSION EXPIRY: If you see a login form mid-task, the session expired.
  - The management URL and credentials are in the goal/context -- re-login and resume.

IFRAMES: Some SonicWall panels (especially older 6.5 UI) embed content in iframes.
  - If expected elements aren't found, try scrolling or waiting -- they may be in a same-origin iframe that the scanner will pick up automatically.
  - Cross-origin iframes cannot be read -- note this and use read_page on the outer frame instead.
`
  },
  {
    test: (url, text) =>
      FORTINET_URL_RE.test(url) ||
      FORTINET_TEXT_RE.test(text),
    prose: `
PLATFORM: Fortinet / FortiGate Management UI
UI-SPECIFIC RULES:
  - Dropdowns are custom widgets -- click to open, then click the option (not native select).
  - After policy changes, click Apply and wait for the green confirmation banner.
  - Log pages use virtual scrolling -- scroll down to load more entries.
  - Tables have inline edit icons (pencil); click the icon not the row to edit.
  - Session timeout is short -- if a login page appears, re-authenticate using goal credentials.
`
  },
  {
    test: (url, text) =>
      CISCO_URL_RE.test(url) ||
      CISCO_TEXT_RE.test(text),
    prose: `
PLATFORM: Cisco Management UI (ASA/FMC/Meraki/ISE)
UI-SPECIFIC RULES:
  - ASDM uses Java -- if the UI is Java-based, use execute_js sparingly; DOM interaction is limited.
  - FMC uses custom React components -- dropdowns need click-to-open then click-option.
  - Meraki dashboard: standard web UI, most actions work normally; wait for AJAX to settle after saves.
  - Always look for a Deploy or Commit button after policy changes -- pending changes are staged, not live.
  - Log tables use pagination -- note the page number when extracting log entries.
`
  },
  {
    test: (url, text) =>
      PALOALTO_URL_RE.test(url) ||
      PALOALTO_TEXT_RE.test(text),
    prose: `
PLATFORM: Palo Alto Networks (PAN-OS / Panorama)
UI-SPECIFIC RULES:
  - After any change, a "Commit" step is required -- look for the Commit button (top right) and click it.
  - Dropdowns are Ext JS widgets -- click the dropdown arrow, then click the option.
  - Tabs within panels are clickable text -- click the tab label to switch views.
  - Log Viewer uses AJAX pagination -- wait for spinner to disappear before extracting log data.
  - Object names are case-sensitive -- extract exact names as shown on screen.
`
  },
  {
    test: (url, text) =>
      SENTINELONE_URL_RE.test(url) ||
      SENTINELONE_TEXT_RE.test(text),
    prose: `
[SentinelOne Singularity Console — Platform Context]
- Top-bar global search accepts SHA1, SHA256, MD5 hashes, filenames, IPs, URLs.
  After typing, press Enter to execute the search; results appear in a side
  panel + table view.
- Threats tab: Sentinels > Threats. Each row expands to show endpoint, agent,
  AI Confidence, Analyst Verdict, Mitigation status, Originating Process.
- Deep Visibility (Hunting): supports a query language (PowerQuery-like).
  Common patterns:
    SrcProcDisplayName contains "old_msedge"
    TgtFileSha1 = "d548d72837175752fe5b563690049066ac93fdf5"
    TgtFileSha256 = "..."
    SrcProcSignedStatus = "unsigned"
- Endpoints/Sentinels tab: lists every device. Click a row for full detail
  panel (OS, agent version, last seen, IP, user).
- Site/scope picker: top-right. Switch between client tenants. ALWAYS verify
  you are on the correct site/scope before any action — cross-client data
  contamination is a serious risk.
- Action buttons (Disconnect, Quarantine, Kill, Disable Agent) require role
  permission and explicit confirmation — DO NOT auto-click these.
- Filtering: each column header has a filter dropdown; multi-select supported.
- Bulk actions: checkbox column on the left; selected rows enable a toolbar.
- Search results often paginate — scroll to load more, or use the page selector.
- Wait for spinners to clear after Run/Refresh; use wait_for_text on a result
  count (e.g., "results") with 30000ms timeout.
`
  },
  {
    test: (url) => NVD_URL_RE.test(url),
    prose: `[NIST NVD / CVE Database -- Platform Context (3.12.6)]

## CRITICAL RULE: When you have the listing data, you are DONE.

NVD search results pages embed each CVEs ID, CVSS v3 score (with severity
label like "9.8 CRITICAL"), summary description, CNA, and assigned date
INLINE in each row. ONE execute_js on the listing page can harvest all of
this for ALL listed CVEs. After that, you have everything you need.

DO NOT click into individual CVE detail pages just to "get more detail".
Detail pages cost 4-6 steps each (navigate, wait, extract, back, navigate-
next), the extraction is fragile, and the data you would gain is already
in the listing. Drilling in is the #1 budget waster on NVD goals -- the
previous version of this extension burned 14+ steps clicking into detail
pages when 1 listing extract would have answered the goal.

ONLY drill into a detail page if the user specifically asked for:
   - full CPE enumeration (every affected product/version pair)
   - the complete reference link list (advisor URLs, vendor advisories)
   - exploit module references or PoC links
For "find me N CVEs" / "rank by severity" / "give me CVSS scores" --
the listing has it. Extract once, finish.

## Listing-page extraction strategy

1. Land on nvd.nist.gov/vuln/search and use the keyword field for
   vendor name (e.g. "fortinet fortigate") OR Advanced Search with
   a CPE filter (cpe:2.3:o:fortinet:fortios:*) for cleaner results.
   Date range: "Last 3 Months" or "Last Year" for "recent" goals.
   Sort by "Date Last Modified" descending for most-recent goals.

2. Wait for results to render (NVD is server-rendered Angular but lists
   load fast). Then run a SINGLE execute_js to harvest all rows. Use
   query selectors that target the result row container -- common shapes
   are tr inside the vuln-table tbody, divs with class .row-result-snippet
   ancestors, or [data-testid="vuln-row"]. From each row pull innerText
   from: the CVE-link, the severity badge, the summary paragraph, the
   publish date. Use the (el || {}).innerText null-guard pattern from
   EXECUTE_JS RELIABILITY PATTERNS.

3. If selectors miss, use document.body.innerText regex on the listing:
   match /^CVE-\\d{4}-\\d{4,7}/ at line starts; for the next line capture
   the severity label or numeric score; capture subsequent lines as
   description until the next CVE marker. This text-pattern approach is
   robust against UI changes.

## Detail-page extraction (only if you genuinely need to drill)

If the user asked for full CPE/refs and you must drill into a detail
page (nvd.nist.gov/vuln/detail/CVE-XXXX-XXXXX):

1. The CVSS v3 base score lives in the page text near "CVSS 3.x Severity
   and Metrics" header. Use body.innerText regex: match digits.digits
   followed by space + (CRITICAL|HIGH|MEDIUM|LOW). The CVSS vector
   string starts with "CVSS:3.1/AV:" or "CVSS:3.0/AV:".

2. Affected versions are in the "Known Affected Software Configurations"
   section as CPE strings (cpe:2.3:o:fortinet:fortios:7.4.0:*). Each is
   a list item; iterate document.querySelectorAll(".vuln-detail-table
   td, .cpe-text, [class*=cpe]") and pull innerText.

3. Description text is in a <p> with id="vulnDescription" or class
   .vuln-description. Pull innerText.

If the detail extraction fails twice, FALL BACK to body.innerText regex
rather than retrying the same selectors. NVD updates their UI quarterly.

## Other CVE sources

4. CISA KEV catalog (cisa.gov/known-exploited-vulnerabilities-catalog) is
   the authoritative source for "exploited in the wild" status. If a CVE
   appears in KEV, it has confirmed in-wild exploitation. Cite as
   [src:kev_<cveid>]. The KEV table can be filtered by CVE ID.

5. MITRE / CVE.org (cve.org/CVERecord?id=...) has the CNAs official
   description but typically NO CVSS score -- NVD enriches it. Use
   CVE.org only when NVD is rate-limiting or for very-recent CVEs not
   yet in NVD.

NEVER fabricate CVSS scores or affected versions when extraction fails.
If a score was not on the page you read, leave it "not captured" and
recommend the user check NVD directly. The hallucination gate enforces.`
  },
  {
    test: (url, text) =>
      VIRUSTOTAL_URL_RE.test(url) ||
      VIRUSTOTAL_TEXT_RE.test(text),
    prose: `
[VirusTotal — Platform Context]
- The GUI is built with Lit shadow-DOM web components (vt-ui-main-generic-report,
  vt-ui-file-card, vt-ui-detections-list, vt-ui-results-summary). Standard
  document.querySelector / .innerText extraction CANNOT pierce these shadow
  roots and will return little or nothing. This is the #1 failure mode here.

EXTRACTION STRATEGY (use in order):
1. PREFER read_network_requests with url_includes: "ui/files" or "api/v3/files" —
   the GUI calls VT's own JSON API and the response contains every detection
   ratio, AV vendor result, signature info, and prevalence stat you need.
   Filter for "ui/files/<sha>" or "/api/v3/files/<sha>" specifically.
2. If read_network_requests doesn't have the entry, use execute_js with
   window.__sentinelUtils.shadow.queryDeep(document, '<selector>') to traverse
   shadow roots:
     return Array.from(window.__sentinelUtils.shadow.queryDeep(document, '[class*=detection]'))
       .map(el => el.innerText).filter(Boolean);
3. As a last resort, ask the user to paste the detection summary from the page.

URL patterns:
- /gui/file/<sha256>/detection — main detection panel
- /gui/file/<sha256>/details — file metadata, signatures, names
- /gui/file/<sha256>/relations — related files
- /gui/file/<sha256>/community — comments, votes

NEVER fabricate detection ratios or AV vendor results when extraction fails.
Report the failure honestly and recommend a manual lookup.
`
  },
  {
    test: (url) =>
      M365_ADMIN_URL_RE.test(url),
    prose: `
[Microsoft 365 Admin Center — Platform Context]
- Built on Microsoft Fluent UI / FluentUI React. Prefer selectors using:
    [data-automationid="..."]
    [aria-label="..."]
    role="button" / role="menuitem" / role="row"
- Page-level search ALWAYS exists; type to filter instead of scrolling
  virtualized lists (Active users, Mailboxes, etc. virtualize aggressively —
  scroll-and-scan loses rows).
- Side panels open from the right with class hooks like
  [data-automationid="detailsPaneOuter"] or role="complementary". After
  clicking a row, wait for the panel to render before scanning elements.
- Save buttons on Fluent UI panels are at the bottom and use class
  ms-Button--primary or text "Save". They re-disable until form changes are
  valid. Toast confirmations appear briefly with role="alert".
- Tenant safety: confirm tenant matches expected before any modifying action.
  The detected tenant is shown in the popup header chip (3.7.0).
- MFA step-up auth fires on admin actions — Sentinel auto-detects and pauses.
- Common navigation paths (verified 2026-05):
    Active users:        admin.microsoft.com → Users → Active users
    Mailbox delegation:  admin.exchange.microsoft.com → Recipients → Mailboxes
    Groups:              admin.microsoft.com → Teams & groups → Active teams & groups
    SharePoint sites:    admin.microsoft.com → SharePoint admin → Active sites
    Purview Audit:       https://purview.microsoft.com/audit/auditsearch
                         (NOT /auditlogsearch — that path redirects to home).
                         If the URL redirects to home, the new audit path is
                         purview.microsoft.com → Solutions → Audit → New search.
    Compliance Manager:  https://compliance.microsoft.com/compliancemanager
                         (note: compliance.microsoft.com is increasingly
                         redirecting to purview.microsoft.com — prefer purview).
- After ANY save: wait for toast text and re-read the user/group panel to
  verify the change is reflected. Don't finish before verification.
`
  },
  {
    test: (url, text) =>
      ENTRA_URL_RE.test(url) ||
      ENTRA_TEXT_RE.test(text) ||
      (AZURE_AD_TEXT_RE.test(text) && MICROSOFT_URL_RE.test(url)),
    prose: `
[Microsoft Entra ID — Platform Context]
- Identity admin UI built on FluentUI React + Monaco editor for JSON details.
- ⚠ CRITICAL: Sign-in logs, Audit logs, and Users tables render INSIDE
  cross-origin sandbox iframes (sandbox-1/2/3.reactblade.portal.azure.net).
  Standard DOM extraction from these tables WILL fail. Use the Microsoft
  Graph API extraction strategy: read_network_requests filter for
  graph.microsoft.com to capture the underlying JSON response (e.g.,
  /beta/auditLogs/signIns). This is reliable; DOM scraping is not.
- Sign-in logs path: Monitoring & health > Sign-in logs.
- Audit logs path: Monitoring & health > Audit logs.
- Filter chips render above tables; existing filters show as "Date: Last 24
  hours", "Status: Failure" pills. Read these BEFORE re-applying filters.
- Tables are virtualized (~30 rows in DOM at a time). To get all rows:
  use scroll-and-collect pattern (scroll the container, dedupe by row identity).
- Click a row → details panel with tabs: Basic info, Location, Device info,
  Authentication details (Monaco JSON), Conditional Access. To extract the
  JSON, use execute_js with monaco-aware code:
    return monaco.editor.getModels()[0].getValue();
- Export to CSV: button at top of table. Sentinel can detect the download
  via chrome.downloads.onCreated (3.7.0+).
- Tenant safety: ALWAYS verify tenant chip matches expected before any
  modifying action (Conditional Access, App registrations, Users).
- Sign-in audit goal pattern: group by user × status × IP, flag any IP
  with >3 failures or country mismatch with the user's typical location.
`
  },
  {
    test: (url) => AZURE_PORTAL_RE.test(url),
    prose: `
[Azure Portal — Platform Context]
- Heavy use of iframes and Monaco editor. iframe-aware element scanning is
  on by default but cross-origin frames may need execute_in_frame routing.
- Resource search: top-bar "Search resources, services, and docs" — most
  reliable navigation entry point.
- Service blade (left nav) → resource list → resource detail (right blade).
- Most actions are async — wait for the toast (top-right, role="alert") and
  the activity log row before declaring success.
- Subscription picker (top-right): cross-tenant safety same as M365. Verify
  before any modify.
- Tags + RBAC are common edit targets. Both render in side blades with Save
  at the bottom.
`
  },
  {
    test: (url, text) =>
      CONNECTWISE_URL_RE.test(url) ||
      CONNECTWISE_TEXT_RE.test(text),
    prose: `
[ConnectWise Platform Context]
- Navigation uses a left sidebar with expandable menu sections (Service, Sales, Procurement, etc.)
- Tables use a filter bar at top — click the filter icon to add criteria, then click Refresh
- Opening a ticket: Service > Service Tickets > click + or "New Ticket" button
- Ticket fields: Summary, Company (dropdown), Contact, Type, Subtype, Item, Priority, Status
- Company dropdown is searchable — type to filter, click to select
- Time entries: open ticket, click the Time tab, click "Enter Time" or + button
- Use click to interact with dropdown menus; ConnectWise uses custom dropdowns (not native <select>)
- For bulk operations, use the checkbox column to select rows, then use the action toolbar
- SSO/SAML redirects are common — if redirected to a login page, wait for it to load
- Configurations (devices) are under the Configurations tab on a company or ticket
`
  },
  {
    test: (url, text) =>
      url.includes('ninjarmm') || url.includes('ninja.io') || url.includes('ninjabe') ||
      text.includes('ninjaone') || text.includes('ninja rmm'),
    prose: `
[NinjaOne Platform Context]
- Navigation uses a top menu bar with Organizations, Devices, Software, Policies, etc.
- Device list has a search/filter bar — type to search by hostname, IP, or organization
- Click a device row to open the device detail panel (slide-in from right)
- Policy management: Policies > select policy type > edit conditions/actions
- Organization selector (top-left or top-right dropdown) switches between managed orgs
- Custom fields are under Organization > Custom Fields or Device > Custom Fields
- Scripts: Automation > Scripts > search or browse, click to run on selected devices
- Software management: Software > patching status, approve/deny updates
- Ninja uses React-based custom dropdowns — use click to open, click to select
- Tables support column sorting by clicking column headers
`
  },
  {
    test: (url, text) =>
      DATTO_URL_RE.test(url) ||
      DATTO_TEXT_RE.test(text),
    prose: `
[Datto/Autotask Platform Context]
- Autotask PSA: navigation via top menu (Dispatch, Service Desk, Projects, etc.)
- Ticket creation: Service Desk > Tickets > New Ticket
- Datto RMM: left sidebar navigation (Sites, Devices, Policies, Jobs, etc.)
- Device search: Devices > use filter bar, supports hostname/IP/serial search
- Alert management: Alerts page shows active alerts, click to acknowledge or create ticket
- Integration between Datto RMM and Autotask PSA via Datto Integration
- Autotask uses custom ASP.NET dropdowns — click to open, may need to type to filter
- Datto RMM uses Angular-based dropdowns — click to open, click to select
- Both platforms have session timeouts — if login form appears, re-authenticate
`
  },
  {
    test: (url, text) => ITGLUE_RE.test(url) || /it glue/.test(text),
    prose: `
[IT Glue Platform Context]
- Navigation: left sidebar with Organizations, Passwords, Documents, Configurations, etc.
- Search bar at top of every page — type to search across all asset types
- Organizations page lists all managed orgs, click to open org detail
- Passwords: organized by organization, click to view (may require re-authentication)
- Documents: rich text editor with version history
- Configurations: network devices, servers, workstations listed with IPs and credentials
- IT Glue uses standard HTML forms — type, click, select all work natively
- Related items section at bottom of each asset links to connected configs/passwords
`
  },
  {
    test: (url, text) => HUNTRESS_RE.test(url) || /huntress/.test(text),
    prose: `
[Huntress Platform Context]
- Dashboard shows threat summary with alert counts
- Left sidebar: Dashboard, Threat Intelligence, Managed Agents, Reports, Account
- Managed Agents page lists all endpoints with agent status
- Alert management: Threat Intelligence > click alert to see details
- Agent deployment: Account > Deployment > download installer or copy install command
- Reports: generates PDF/CSV reports for compliance
- Huntress uses custom React dropdowns — click to open, click to select
`
  },
  {
    test: (url, text) =>
      SCREENCONNECT_URL_RE.test(url) ||
      SCREENCONNECT_TEXT_RE.test(text),
    prose: `
[ScreenConnect Platform Context]
- Access page lists all managed machines with status (online/offline)
- Search bar filters by hostname, organization, or custom property
- To connect: click the checkbox next to machine, click "Connect" or double-click
- Session types: Control (full desktop), Access (background), Meeting (presentation)
- Command tab allows running commands on connected machines
- File transfer tab for uploading/downloading files
- Custom properties used for tagging/organization — editable in machine details
`
  },
  {
    test: (_, text) =>
      GENERIC_NETWORK_RE.test(text),
    prose: `
PLATFORM: Network/Security Device Management UI (generic)
UI-SPECIFIC RULES:
  - Many network device UIs use custom dropdowns -- if "select" fails, try click-to-open then click-option.
  - Changes are often staged -- look for Apply, Save, Commit, or Accept buttons after edits.
  - Log pages may be slow to load -- use wait_for_text with generous timeouts (20000-30000ms).
  - Session timeouts are common -- if a login form appears, re-authenticate using credentials from the goal.
  - Table rows often open edit dialogs on click -- click the row or its edit icon to modify entries.
`
  },
];

/**
 * Match a platform spec from _PLATFORM_SPECS by URL and goal text, returning its prose guidance.
 * @param {string} currentUrl - The current page URL to match against.
 * @param {string} goal - The goal text to match against.
 * @returns {string} Platform prose string, or empty string if no spec matches.
 */
function _getPlatformProseInternal(currentUrl, goal) {
  const url  = (currentUrl || '').toLowerCase();
  const text = (goal || '').toLowerCase();
  for (const spec of _PLATFORM_SPECS) {
    if (spec.test(url, text)) return spec.prose;
  }
  return '';
}

// (3.18.0) Format the structured profile's knownSelectors + waitStrings +
// pageTypes as a prose block for the agent's runtime system prompt. The LLM
// gets "try these selectors first" hints which reduce trial-and-error
// observe-and-flail loops on complex SPAs like SonicWall NSM 7.x.
/**
 * Format a platform profile's known selectors, wait strings, page types, and gotchas
 * into a prose block for the agent's system prompt.
 * @param {Object|null} profile - Platform profile object with knownSelectors, waitStrings, pageTypes, etc.
 * @param {string} currentUrl - Current URL used to detect the active page type.
 * @returns {string} Formatted prose block, or empty string if profile is null/empty.
 */
function _formatProfileSelectorsBlock(profile, currentUrl) {
  if (!profile) return '';
  const sel = profile.knownSelectors;
  const wait = profile.waitStrings;
  const pageTypes = profile.pageTypes;
  if (!sel && !wait && !pageTypes) return '';

  const parts = [];
  parts.push('');
  parts.push(`━━━ PLATFORM SELECTOR PROFILE (${profile.label || profile.id}) ━━━`);
  parts.push('These are KNOWN selectors for this platform. Try them FIRST before falling back to runtime element scanning. Each entry is a defensive comma-separated alternatives list — the content script will resolve whichever matches.');
  parts.push('');

  // Page-type classification — tell the LLM what surface it's on so it can
  // pick relevant selectors.
  if (Array.isArray(pageTypes) && pageTypes.length && currentUrl) {
    let detected = null;
    for (const pt of pageTypes) {
      try { if (pt && pt.urlMatch && pt.urlMatch.test(currentUrl)) { detected = pt; break; } } catch (e) { console.error('[Sentinel] Error in llm-client.js:', getErrorMessage(e)); }
    }
    if (detected) {
      parts.push(`CURRENT PAGE TYPE: ${detected.name} — ${detected.hint || ''}`);
      parts.push('');
    }
  }

  if (sel && typeof sel === 'object') {
    parts.push('KNOWN SELECTORS (use as preferred targets):');
    for (const [k, v] of Object.entries(sel)) {
      if (typeof v === 'string') {
        parts.push(`  ${k}: ${v}`);
      } else if (Array.isArray(v)) {
        parts.push(`  ${k}: [${v.map(s => `"${s}"`).join(', ')}]`);
      } else if (typeof v === 'function') {
        // Function-valued selectors are parameterized — describe the slot
        // rather than dump source.
        parts.push(`  ${k}: (parameterized — pass label or text to resolve)`);
      }
    }
    parts.push('');
  }

  if (wait && typeof wait === 'object') {
    parts.push('WAIT-TEXT SIGNALS (use with wait_for_text):');
    for (const [k, v] of Object.entries(wait)) {
      if (Array.isArray(v) && v.length) {
        parts.push(`  ${k}: any of [${v.map(s => `"${s}"`).join(', ')}]`);
      }
    }
    parts.push('');
  }

  if (profile.knownGotchas) {
    parts.push(`KNOWN GOTCHAS: ${profile.knownGotchas}`);
    parts.push('');
  }

  if (profile.liveDataCaveats) {
    parts.push(`LIVE DATA NOTE: ${profile.liveDataCaveats}`);
    parts.push('');
  }

  if (Array.isArray(profile.commitFlow) && profile.commitFlow.length) {
    parts.push(`COMMIT SEQUENCE: After any config change, click in order: ${profile.commitFlow.join(' → ')}. Do not skip steps — each platform requires this exact sequence to persist changes.`);
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * (3.18.0) Public platform-context API. Returns the existing hardcoded prose
 * (for backwards compat with all current callers) PLUS a structured selector
 * block sourced from background/platforms/<id>.js when a profile matches.
 * Same single-string return shape — no changes needed at the call sites.
 */
// (3.41.0) Cache platform context by URL+goal prefix — rebuilding the selector
// block and prose on every LLM call (50-100 times per run) is wasteful when
// the URL is stable. TTL of 30s covers SPA route transitions.
const _platformContextCache = new Map();

/**
 * Build platform-specific context (selectors, guidance) for the current URL and goal.
 * Results are cached for 60s to avoid repeated lookups during a run.
 * @param {string} currentUrl - The active tab's URL.
 * @param {string} goal - The user's current goal text.
 * @returns {string} Formatted platform context block for the system prompt.
 */
export function getPlatformContext(currentUrl, goal) {
  const _cacheKey = `${currentUrl || ''}||${(goal || '').slice(0, 50)}`;
  const _cached = _platformContextCache.get(_cacheKey);
  if (_cached && Date.now() - _cached.ts < PLATFORM_CTX_CACHE_TTL_MS) return _cached.ctx;

  const prose = _getPlatformProseInternal(currentUrl, goal);
  let selectorBlock = '';
  try {
    const profile = getPlatformProfile(currentUrl, goal);
    selectorBlock = _formatProfileSelectorsBlock(profile, currentUrl);
  } catch (e) {
    console.warn('[Sentinel/llm] Profile lookup failed:', getErrorMessage(e));
    // Continue without selector block - non-fatal
  }
  const ctx = prose + selectorBlock;
  _platformContextCache.set(_cacheKey, { ctx, ts: Date.now() });
  if (_platformContextCache.size > 50) {
    const oldest = _platformContextCache.keys().next().value;
    _platformContextCache.delete(oldest);
  }
  return ctx;
}

// ========== Vision Support ==========
// Three-tier resolution:
//   1. Provider/model registry in provider-registry.js (deterministic).
//   2. Broad regex matcher for unknown models (forward-compatible).
//   3. Small text-only deny list as a safety net.
//
// Signature is intentionally stable: supportsVision(model[, providerHint]).
// When providerHint is omitted, we infer from common model-id patterns; this
// preserves the legacy single-arg call sites.
/**
 * Check whether a given model supports vision/screenshot analysis.
 * Uses a three-tier approach: exact model lookup, broad regex match, and a deny list.
 * @param {string} model - The model identifier (e.g. 'gpt-4o', 'claude-3-5-sonnet').
 * @param {string} [providerHint] - Optional provider key for faster matching.
 * @returns {boolean} True if the model supports vision input.
 */
export function supportsVision(model, providerHint) {
  if (!model) return false;
  const m = String(model).toLowerCase();

  // (a) Hard deny list -- confirmed text-only variants.
  // Precompiled for performance
  const denyList = [
    GPT_3_5_RE,
    CLAUDE_3_HAIKU_TEXT_RE,
    CLAUDE_2_RE,
    CLAUDE_INSTANT_RE,
    TEXT_ONLY_RE
  ];
  if (denyList.some(re => re.test(m))) return false;

  // (b) Registry lookup (provider-driven). Infer provider from model name when
  //     a hint isn't given.
  const inferredProvider =
    providerHint ||
    (m.startsWith('claude-') ? 'anthropic'
      : (m.startsWith('gpt-') || m.startsWith('o3') || m.startsWith('o4')) ? 'openai'
      : null);
  const registryAnswer = getModelSupportsVision(inferredProvider, model);
  if (registryAnswer === true) return true;
  if (registryAnswer === false) return false;

  // (c) Fallback positive matcher for unknown models.
  // Precompiled for performance
  const visionPatterns = [
    CLAUDE_OPUS_SONNET_RE,
    GPT_4_RE,
    GEMINI_RE,
    QWEN_VL_RE,
    LLAVA_RE,
    VISION_RE,
    VL_DASH_RE,
    VL_END_RE,
    VL_START_RE,
    VL_TAGGED_RE,
    INTERNVL_RE,
    MINICPM_V_RE,
    PIXTRAL_RE,
    MOONDREAM_RE
  ];
  return visionPatterns.some(re => re.test(m));
}

// ========== Anthropic Tool Definitions ==========
// One tool per action type. Used when the active provider supportsToolUse.
// The model selects a tool and fills its input_schema fields — no JSON parsing needed.
const SENTINEL_TOOLS = [
  { name: 'click',           description: 'Click an interactive element by ref, selector, or coordinates.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, selector: { type: 'string' }, description: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'type',            description: 'Focus an element and type text into it.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' } }, required: ['text'] } },
  { name: 'navigate',        description: 'Navigate the active tab to a URL.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'extract',         description: 'Extract a value from the page and store it in agent memory under the given key.',
    input_schema: { type: 'object', properties: { selector: { type: 'string' }, key: { type: 'string' }, attribute: { type: 'string' } }, required: ['key'] } },
  { name: 'extract_list',    description: 'Extract multiple values matching a selector into a memory array.',
    input_schema: { type: 'object', properties: { selector: { type: 'string' }, key: { type: 'string' }, attribute: { type: 'string' } }, required: ['selector', 'key'] } },
  { name: 'scroll',          description: 'Scroll the page or a scrollable element.',
    input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' }, selector: { type: 'string' } } } },
  { name: 'wait',            description: 'Wait a fixed number of milliseconds before the next action.',
    input_schema: { type: 'object', properties: { ms: { type: 'number' } }, required: ['ms'] } },
  { name: 'wait_for_text',   description: 'Wait until specific text appears on the page (polls up to 30s by default).',
    input_schema: { type: 'object', properties: { text: { type: 'string' }, timeout: { type: 'number' } }, required: ['text'] } },
  { name: 'execute_js',      description: 'Run a JavaScript snippet in the page context; store the return value in memory under key.',
    input_schema: { type: 'object', properties: { code: { type: 'string' }, key: { type: 'string' } }, required: ['code'] } },
  { name: 'verify',          description: 'Read back a field value and compare to expected. Returns "verified: <actual>" or "MISMATCH: expected X, got Y".',
    input_schema: { type: 'object', properties: { selector: { type: 'string' }, ref: { type: 'string' }, expected: { type: 'string' } } } },
  { name: 'note',            description: 'Record an observation or finding without performing any browser action.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'finish',          description: 'Mark the task complete and return the final summary report to the user.',
    input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
  { name: 'select',          description: 'Select an option from a <select> dropdown by value or visible label.',
    input_schema: { type: 'object', properties: { selector: { type: 'string' }, ref: { type: 'string' }, value: { type: 'string' }, label: { type: 'string' } } } },
  { name: 'hover',           description: 'Hover over an element to reveal hover-state UI (tooltips, sub-menus).',
    input_schema: { type: 'object', properties: { selector: { type: 'string' }, ref: { type: 'string' } } } },
  { name: 'press_key',       description: 'Send a keyboard event to the focused element (e.g. Enter, Escape, Tab, ArrowDown).',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'open_tab',        description: 'Open a URL in a new browser tab and switch agent focus to it.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'switch_tab',      description: 'Switch agent focus to an already-open tab by index or label.',
    input_schema: { type: 'object', properties: { index: { type: 'number' }, label: { type: 'string' } } } },
  { name: 'close_tab',       description: 'Close an open tab. Provide index (0-based from tab list), label, or leave empty to close the current active tab.',
    input_schema: { type: 'object', properties: { index: { type: 'number', description: '0-based tab index from the MANAGED TABS list' }, label: { type: 'string', description: 'Tab label (e.g. "article-1")' } } } },
  { name: 'read_page',       description: 'Re-read the current page content and element list (use when observation is stale).',
    input_schema: { type: 'object', properties: {} } },
  { name: 'click_at',        description: 'Click at specific x,y CSS-pixel coordinates (use when element list has no match).',
    input_schema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
  { name: 'repeat_for_each', description: 'Execute a sub-sequence of actions for every item in a memory list.',
    input_schema: { type: 'object', properties: { items_key: { type: 'string' }, item_var: { type: 'string' }, do: { type: 'array', items: { type: 'object' } } }, required: ['items_key', 'item_var', 'do'] } },
  { name: 'read_network_requests', description: 'Read recent network requests matching a URL pattern; useful for extracting API responses when DOM is blocked.',
    input_schema: { type: 'object', properties: { url_includes: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'smart_navigate', description: 'Navigate directly to a known site search/forecast page. MUCH faster than clicking through menus. Supported: google, weather.gov, wikipedia, youtube, amazon, reddit, twitter.',
    input_schema: { type: 'object', properties: { site: { type: 'string', description: 'google|weather.gov|wikipedia|youtube|amazon|reddit|twitter' }, query: { type: 'string', description: 'Search query or location' } }, required: ['site', 'query'] } },
  { name: 'batch', description: 'Execute multiple actions in sequence WITHOUT re-observing between them. Use for predictable sequences like type+Enter, navigate+wait+read, scroll+extract. Max 5 actions.',
    input_schema: { type: 'object', properties: { actions: { type: 'array', description: 'Array of action objects to execute in order', items: { type: 'object' } } }, required: ['actions'] } },
];

// ========== Multi-Provider Model Routing ==========
// Routes steps to cheap/light models for simple tasks and powerful/heavy
// models for complex ones. Reduces cost on observation-heavy runs while
// keeping accuracy high on action-critical steps.

/**
 * Select the model tier for a step based on its complexity context.
 * Returns 'light', 'default', or 'heavy', or null to use the default model.
 * @param {Object} stepContext - { type, selector, hasScreenshot, stepNumber, totalSteps, previousFailures }
 * @returns {string|null} Tier identifier or null for default.
 */
export function selectModelForStep(stepContext) {
  if (!stepContext) return null; // use default

  const type = stepContext.type || '';

  // Simple observation/reading tasks — use cheap model
  const simpleTypes = ['read_page', 'extract', 'extract_list', 'read_network_requests', 'read_console_messages', 'scroll', 'wait'];
  if (simpleTypes.includes(type)) return 'light';

  // Complex reasoning tasks — use powerful model
  const complexTypes = ['click', 'type', 'execute_js', 'navigate', 'form_fill'];
  if (complexTypes.includes(type)) {
    // If previous failures, upgrade model
    if (stepContext.previousFailures > 1) return 'heavy';
    return 'default';
  }

  // Screenshot analysis always uses heavy model
  if (stepContext.hasScreenshot) return 'heavy';

  // Final steps use heavy model for accuracy
  if (stepContext.stepNumber && stepContext.totalSteps &&
      stepContext.stepNumber >= stepContext.totalSteps - 1) return 'heavy';

  return null; // use default
}

// Cost tracker for multi-provider routing — accumulates per-tier call counts
// and rough cost estimates across the run lifetime.

// ========== LLM Prompt Context Builders ==========

// Build the strategy-shift injection when the agent has failed consecutively.
// Returns an empty string when below the failure threshold.
/**
 * Build a strategy-shift prompt injection when the agent has failed consecutively.
 * Includes platform-specific recovery hints for M365, VirusTotal, SentinelOne, and network devices.
 * @param {Object} agentState - Live agent state with consecutiveFailures and currentStrategies.
 * @param {string} currentUrl - Current page URL for platform detection.
 * @param {Object} CONFIG - Agent configuration with strategyShiftThreshold.
 * @returns {string} Strategy-shift directive string, or empty string if below threshold.
 */
function _buildStrategyCtx(agentState, currentUrl, CONFIG) {
  if (!agentState || agentState.consecutiveFailures < CONFIG.strategyShiftThreshold) return '';
  const _u = (currentUrl || '').toLowerCase();
  let platformHints = '';
  if (/entra|admin\.microsoft|admin\.exchange|purview|defender|security\.microsoft|portal\.azure|intune|endpoint\.microsoft/.test(_u)) {
    platformHints = `\nPLATFORM-SPECIFIC RECOVERY (M365 admin centers):
- Try { type: "read_network_requests", url_includes: "graph.microsoft.com|graphbeta", limit: 30 } to read the underlying Graph API JSON. UI tables are in cross-origin iframes that block DOM extraction; the Graph data is not.
- After identifying the right Graph URL, fetch it via execute_js with credentials: include — the JSON has every field shown in the UI.
- Common Graph paths: /beta/auditLogs/signIns, /beta/security/auditLog/queries, /v1.0/users/{upn}, /beta/deviceManagement/managedDevices.
`;
  } else if (/virustotal/.test(_u)) {
    platformHints = `\nPLATFORM-SPECIFIC RECOVERY (VirusTotal):
- Try { type: "read_network_requests", url_includes: "ui/files|api/v3/files", limit: 30 } — VT calls its own JSON API.
- Or use execute_js with window.__sentinelUtils.shadow.queryDeep(document, "[class*=detection]") to pierce Lit shadow roots.
`;
  } else if (/sentinelone|singularity/.test(_u)) {
    platformHints = `\nPLATFORM-SPECIFIC RECOVERY (SentinelOne):
- Use the global top-bar search instead of navigating tabs. SHA1/SHA256/filename/IP all work as queries.
- For Deep Visibility: SrcProcDisplayName contains "X", TgtFileSha1 = "...", TgtFileSha256 = "...".
`;
  } else if (/sonicwall|sonicos|fortigate|paloalto/.test(_u)) {
    platformHints = `\nPLATFORM-SPECIFIC RECOVERY (network device UI):
- Custom dropdowns: click trigger to open, then click option (NOT the select action).
- After config changes: look for Apply/Commit/Save button explicitly. Changes do NOT save until committed.
- Long log loads: use wait_for_text with 30000ms timeout.
`;
  }
  return `\nSTRATEGY SHIFT REQUIRED -- You have failed ${agentState.consecutiveFailures} times in a row.
Approaches already tried: ${(agentState.currentStrategies || []).join(', ')}
You MUST try a COMPLETELY DIFFERENT approach. Consider:
- Using "execute_js" to write custom JavaScript to accomplish the task
- Using "read_network_requests" to read the underlying API response
- Scrolling to find different elements
- Navigating to a different page
- Using "extract" + memory to build data step by step
${platformHints}Do NOT repeat the same failed action.
`;
}

// Build the execution-plan status block injected before the prompt schema.
// Returns empty string if no plan exists.
/**
 * Build an execution-plan status block showing done/current/pending steps.
 * Instructs the LLM to set advance_plan:true when the current step is complete.
 * @param {string[]|null} agentPlan - Array of plan step strings, or null.
 * @param {number} currentPlanStep - Index of the currently active plan step.
 * @returns {string} Rendered plan context block, or empty string if no plan.
 */
function _buildPlanCtx(agentPlan, currentPlanStep) {
  if (!agentPlan || !agentPlan.length) return '';
  const planLines = agentPlan.map((step, i) => {
    const marker = i < currentPlanStep ? '[done]' : i === currentPlanStep ? '[current]' : '[pending]';
    return `${marker} ${i + 1}. ${step}`;
  }).join('\n');
  return `\nEXECUTION PLAN (your roadmap -- follow in order):\n${planLines}\n\nCURRENT PLAN STEP: ${currentPlanStep + 1} -- "${agentPlan[currentPlanStep] || 'All steps complete'}"\nWhen the current plan step is fully done, include "advance_plan": true in your JSON response.\n`;
}

// Build the multi-tab context block listing all managed tabs with snapshots.
// Returns empty string when only one tab is managed.
/**
 * Build a multi-tab context block listing all managed tabs with their snapshots and tab rules.
 * @returns {string} Tab context section with tab list and usage rules, or empty string if no tabs.
 */
function _buildTabCtx() {
  const allContexts = getAllTabContexts();
  const activeId = getActiveTabId();
  if (!allContexts.length) return '';

  const parts = [];
  parts.push(`\nMANAGED TABS (${allContexts.length}/${TAB_LIMIT} tab limit):\n`);

  for (const ctx of allContexts) {
    const isActive = ctx.tabId === activeId;
    const marker = isActive ? '[ACTIVE] ' : '';
    const snapSummary = ctx.snapshot && typeof ctx.snapshot === 'object'
      ? `Last seen: "${(ctx.snapshot.pageContent || '').substring(0, 300)}..." (${(() => {
          const ts = ctx.snapshot.timestamp;
          if (!ts) return 'No timestamp';
          const d = new Date(ts);
          return Number.isNaN(d.getTime()) ? 'Invalid timestamp' : d.toLocaleTimeString();
        })()})`
      : 'No snapshot yet.';
    parts.push(`- ${marker}"${ctx.label}" (${ctx.url}): ${snapSummary}\n`);
  }

  parts.push(`\nTab rules:\n`);
  parts.push(`- Use "open_tab" to open a new URL in a background tab (max ${TAB_LIMIT} tabs total)\n`);
  parts.push(`- Use "switch_tab" with a label to operate on a different tab\n`);
  parts.push(`- Use "close_tab" with a label to close a tab you no longer need\n`);
  parts.push(`- Extract data from a tab BEFORE opening new tabs that might push it past the ${TAB_LIMIT}-tab limit\n`);
  parts.push(`- Reference data from other tabs in your reasoning -- you can see their last-known content above\n`);

  return parts.join('');
}

// Strip screenshot payloads from history entries beyond the most-recent step,
// and trim the window to the configured size. Keeps token cost bounded.
/**
 * Sanitize conversation history: trim to window size, strip screenshots from older entries,
 * and truncate long selectors and results to reduce token cost.
 * @param {Array} history - Raw conversation history array.
 * @param {boolean} isRunbook - Whether runbook mode is active (larger window).
 * @param {Object} CONFIG - Agent configuration with historyWindow size.
 * @returns {Array} Sanitized history array with bounded size and stripped images.
 */
function _sanitizeHistory(history, isRunbook, CONFIG) {
  const historyWindowSize = isRunbook ? 25 : CONFIG.historyWindow;
  const fullHistory = Array.isArray(history) ? history : [];
  // (v20.4) Compaction: steps that fall outside the window used to vanish, so
  // long / multi-portal runs lost the earlier trajectory and re-tried dead ends.
  // Summarize the dropped steps into a single deterministic digest entry (no
  // extra LLM call) and prepend it, so the model keeps cheap awareness of what
  // it already did without paying full per-step token cost.
  const dropped = fullHistory.length > historyWindowSize
    ? fullHistory.slice(0, fullHistory.length - historyWindowSize)
    : [];
  const slicedHistory = fullHistory.slice(-historyWindowSize);
  const mapped = slicedHistory.map((h, idx) => {
    const isMostRecent = idx === slicedHistory.length - 1;
    const action = h.action || {};
    const safeAction = {
      type: action.type,
      selector: action.selector
        ? (action.selector.length > 60 ? `...${action.selector.slice(-60)}` : action.selector)
        : undefined,
      text: action.text,
      url: action.url
    };
    let safeResult;
    if (typeof h.result === 'string') {
      safeResult = h.result.substring(0, 200);
    } else if (h.result && typeof h.result === 'object') {
      const r = { ...h.result };
      if (!isMostRecent) {
        if ('base64Image' in r) r.base64Image = '[screenshot omitted from history]';
        if ('image_url' in r) r.image_url = '[screenshot omitted from history]';
        if ('imageUrl' in r) r.imageUrl = '[screenshot omitted from history]';
        if ('screenshot' in r) r.screenshot = '[screenshot omitted from history]';
        if ('image' in r) r.image = '[screenshot omitted from history]';
      }
      safeResult = r;
    } else {
      safeResult = h.result;
    }
    const cleanedEntry = { step: h.step, action: safeAction, result: safeResult };
    if (!isMostRecent) {
      if ('base64Image' in h) cleanedEntry.base64Image = '[screenshot omitted from history]';
      if ('image_url' in h) cleanedEntry.image_url = '[screenshot omitted from history]';
      if ('imageUrl' in h) cleanedEntry.imageUrl = '[screenshot omitted from history]';
    }
    return cleanedEntry;
  });
  if (dropped.length) {
    mapped.unshift(_compactHistoryDigest(dropped));
  }
  return mapped;
}

/**
 * Build a single compacted digest entry summarizing history steps that fell
 * outside the live window. Deterministic (no LLM call), bounded in size, and
 * shaped like a normal history entry so it renders through the existing
 * JSON.stringify(sanitizedHistory) path.
 *
 * @param {Array} dropped - History entries being dropped from the live window.
 * @returns {{step: string, action: {type: string}, result: string}} Digest entry.
 */
function _compactHistoryDigest(dropped) {
  const lines = [];
  for (const h of dropped) {
    const a = h.action || {};
    const t = a.type || '?';
    let r = '';
    if (typeof h.result === 'string') {
      r = h.result;
    } else if (h.result && typeof h.result === 'object') {
      const res = h.result;
      r = res.text || res.value || res.summary || res.message
        || (res.success === false ? `failed: ${res.error || ''}` : (res.success ? 'ok' : ''));
    }
    r = String(r || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const detail = [a.url, a.selector].filter(Boolean).join(' ').slice(0, 60);
    lines.push(`#${h.step != null ? h.step : '?'} ${t}${detail ? ' ' + detail : ''}${r ? ` → ${r}` : ''}`);
  }
  // Keep the digest bounded: retain the most recent dropped steps, count the rest.
  const kept = lines.slice(-14);
  const omitted = lines.length - kept.length;
  const text = (omitted > 0 ? `(+${omitted} earlier steps) ` : '') + kept.join(' | ');
  return {
    step: `1-${dropped.length}`,
    action: { type: '(earlier steps, compacted)' },
    result: text.slice(0, 1400)
  };
}

// ========== Streaming (SSE) ==========
// (v20.4) Stream LLM responses so slow/thinking models keep the connection alive
// via a per-chunk idle timeout instead of a single wall-clock deadline — the abort
// that produced "API timed out after 60s" mid-generation on heavy pages. The
// accumulators reconstruct the SAME object shape the non-streaming parsers expect,
// so the downstream parse path is untouched. Streaming only activates on a genuine
// text/event-stream response; anything else (non-SSE proxy, a provider that ignored
// stream:true, unit-test mocks) falls back to response.json().

/** Accumulate an Anthropic Messages SSE stream into a non-streaming-shaped object. */
function _anthropicStreamAcc() {
  const blocks = [];
  let stopReason = null;
  let model;
  const usage = { input_tokens: 0, output_tokens: 0 };
  return {
    handle(ev) {
      const type = ev && ev.type;
      if (type === 'message_start' && ev.message) {
        model = ev.message.model;
        const u = ev.message.usage || {};
        usage.input_tokens = u.input_tokens || 0;
        usage.output_tokens = u.output_tokens || 0;
        if (u.cache_read_input_tokens) usage.cache_read_input_tokens = u.cache_read_input_tokens;
        if (u.cache_creation_input_tokens) usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
      } else if (type === 'content_block_start') {
        const b = { ...(ev.content_block || {}) };
        if (b.type === 'tool_use') b._partialJson = '';
        blocks[ev.index] = b;
      } else if (type === 'content_block_delta') {
        const b = blocks[ev.index]; if (!b) return;
        const d = ev.delta || {};
        if (d.type === 'text_delta') b.text = (b.text || '') + (d.text || '');
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
        else if (d.type === 'input_json_delta') b._partialJson = (b._partialJson || '') + (d.partial_json || '');
      } else if (type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b && b.type === 'tool_use') {
          try { b.input = JSON.parse(b._partialJson || '{}'); } catch (_e) { b.input = b.input || {}; }
          delete b._partialJson;
        }
      } else if (type === 'message_delta') {
        if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage && typeof ev.usage.output_tokens === 'number') usage.output_tokens = ev.usage.output_tokens;
      }
    },
    getPartial() {
      const textBlock = blocks.find(b => b && b.type === 'text' && b.text);
      return textBlock ? textBlock.text : '';
    },
    finalize() {
      const content = blocks.filter(Boolean).map(b => { const c = { ...b }; delete c._partialJson; return c; });
      const out = { content, stop_reason: stopReason, usage };
      if (model) out.model = model;
      return out;
    }
  };
}

/** Accumulate an OpenAI-compatible chat-completions SSE stream into a non-streaming-shaped object. */
function _openaiStreamAcc() {
  let content = '';
  let reasoning = '';
  const toolCalls = [];
  let finishReason = null;
  let usage = null;
  return {
    handle(chunk) {
      if (chunk && chunk.usage) usage = chunk.usage;
      const choice = chunk && Array.isArray(chunk.choices) && chunk.choices[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const d = choice.delta || {};
      if (typeof d.content === 'string') content += d.content;
      if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
      else if (typeof d.reasoning === 'string') reasoning += d.reasoning;
      if (Array.isArray(d.tool_calls)) {
        for (const tc of d.tool_calls) {
          const i = typeof tc.index === 'number' ? tc.index : toolCalls.length;
          if (!toolCalls[i]) toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          const slot = toolCalls[i];
          if (tc.id) slot.id = tc.id;
          if (tc.type) slot.type = tc.type;
          if (tc.function) {
            if (tc.function.name) slot.function.name = tc.function.name;
            if (typeof tc.function.arguments === 'string') slot.function.arguments += tc.function.arguments;
          }
        }
      }
    },
    getPartial() {
      return content || '';
    },
    finalize() {
      const message = { role: 'assistant', content: content || '' };
      const tc = toolCalls.filter(Boolean);
      if (tc.length) message.tool_calls = tc;
      if (reasoning) message.reasoning_content = reasoning;
      const out = { choices: [{ message, finish_reason: finishReason }] };
      if (usage) out.usage = usage;
      return out;
    }
  };
}

/** Parse one raw SSE event block and dispatch its JSON data payload to the accumulator. */
function _consumeSSEEvent(rawEvent, acc) {
  const dataLines = [];
  for (const line of rawEvent.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).replace(/^ /, ''));
  }
  if (!dataLines.length) return;
  const payload = dataLines.join('\n');
  if (payload === '[DONE]') return;
  let obj;
  try { obj = JSON.parse(payload); } catch (_e) { return; } // ignore non-JSON keepalives/comments
  acc.handle(obj);
}

/**
 * Read a streaming fetch Response (SSE) to completion and reconstruct the
 * non-streaming response object. Resets an idle timer on every chunk so a model
 * that keeps producing output is never aborted mid-generation.
 *
 * @param {Response} response - Streaming fetch Response (text/event-stream).
 * @param {object} provider - Resolved provider (provider.id selects the accumulator).
 * @param {AbortController} controller - The fetch's AbortController (idle timeout aborts it).
 * @param {number} idleMs - Abort if no chunk arrives within this many ms.
 * @returns {Promise<object>} Reconstructed response data object.
 */
async function _readSSEToData(response, provider, controller, idleMs, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const acc = provider.id === 'anthropic' ? _anthropicStreamAcc() : _openaiStreamAcc();
  let buffer = '';
  let idleTimer = setTimeout(() => controller.abort(), idleMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleMs);
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (rawEvent.trim()) {
        _consumeSSEEvent(rawEvent, acc);
        // (v21.5) Stream partial tokens to popup for live AI response display
        if (onChunk) {
          try {
            const partial = acc.getPartial && acc.getPartial();
            if (partial) onChunk(partial);
          } catch (_) { /* non-fatal */ }
        }
      }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) _consumeSSEEvent(buffer, acc);
  } finally {
    clearTimeout(idleTimer);
    try { reader.releaseLock(); } catch (_e) { /* already released */ }
  }
  return acc.finalize();
}

/** True when a Response is a genuine SSE stream we can read incrementally. */
function _isStreamingResponse(response) {
  const ctype = (response && response.headers && typeof response.headers.get === 'function')
    ? (response.headers.get('content-type') || '') : '';
  return /event-stream/i.test(ctype)
    && response.body != null
    && typeof response.body.getReader === 'function';
}



// ========== Main LLM Call ==========
// trimmedElements: the capped/cleaned element list built in the main loop
// totalElementCount: the raw count before trimming (for the prompt header)
/**
 * Main LLM call: builds the full system prompt, sends the request to the active provider,
 * parses the response, and handles vision fallback on 400 errors. Increments apiCallCount
 * and applies rate limiting before each call. Routes simple steps to the fast model when configured.
 * @param {Array} trimmedElements - Capped list of interactive DOM elements.
 * @param {number} totalElementCount - Raw element count before trimming.
 * @param {string} pageContent - Extracted page text content.
 * @param {string|null} base64Image - Screenshot as base64, or null.
 * @param {string} goal - Current goal text.
 * @param {Array} history - Conversation history messages.
 * @param {number} stepCount - Current step number in the agent run.
 * @param {string} currentUrl - Active tab URL.
 * @param {Object} CONFIG - Agent configuration (timeouts, retries, model, etc.).
 * @param {Object} agentState - Mutable agent state (apiCallCount, plan, memory, etc.).
 * @returns {Promise<Object>} Parsed LLM response object.
 */
export async function callLLM(trimmedElements, totalElementCount, pageContent, base64Image, goal, history, stepCount, currentUrl, CONFIG, agentState) {
  if (!agentState) throw new Error('agentState is required');
  if (!CONFIG) throw new Error('CONFIG is required');
  const _apiStart = Date.now();
  _rateLimiter.check();
  // Credit protection: check daily limit before making API call
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const limitCheck = await chrome.runtime.sendMessage({ action: 'check_credit_limit' }).catch(() => null);
      if (limitCheck && !limitCheck.allowed) {
        console.warn('[Sentinel/LLM] Daily credit limit exceeded');
        return { type: 'finish', summary: 'Daily credit limit reached. Increase limit in Settings or wait until tomorrow.' };
      }
    }
  } catch (_e) { /* non-fatal — allow call if check fails */ }
  agentState.apiCallCount++; // increment before any throws so the count is always recorded
  const providerConfig = await getActiveProvider();
  const { endpoint, apiKey } = providerConfig;
  // Self-hosted providers (ollama, LM Studio, vLLM, KoboldCpp, …) are declared
  // `auth: 'none'` in PROVIDER_CATALOG and legitimately have no key. This guard
  // used to reject them outright, so every local-first configuration failed
  // here — before the provider's own optional-auth buildHeaders ever ran.
  if (!apiKey && providerRequiresApiKey(providerConfig.id, endpoint)) {
    console.error('[Sentinel/LLM] No API key configured! Provider:', providerConfig.id || endpoint || 'unknown');
    throw new Error('No API key configured. Open Settings and configure a provider.');
  }
  const provider = resolveProviderForConfig(providerConfig);
  if (!provider) throw new Error(`Unknown provider for endpoint: ${endpoint}`);
  // (9.2) Route simple steps to fast model if configured
  const _useSimple = isSimpleStep(agentState, stepCount, history) && providerConfig.fastModel;
  // Multi-provider model routing: check stepContext for complexity-based tier selection
  const _stepTier = selectModelForStep(agentState.stepContext || null);
  let model;
  if (_stepTier === 'light' && providerConfig.fastModel) {
    model = providerConfig.fastModel;
  } else if (_stepTier === 'heavy' && providerConfig.heavyModel) {
    model = providerConfig.heavyModel;
  } else if (_useSimple) {
    model = providerConfig.fastModel;
  } else {
    model = providerConfig.model;
  }
  agentState.model = model; // needed by buildAgentPrompt → supportsVision
  const _resolvedTier = _stepTier || (_useSimple ? 'light' : 'default');
  if (_useSimple) agentState.fastModelCallCount = (agentState.fastModelCallCount || 0) + 1;
  agentState._lastModelTier = _resolvedTier; // track tier for cost recording after response

  const hasHistory = Array.isArray(history) && history.length;
  const lastEntry = hasHistory ? history[history.length - 1] : null;
  const lastAction = lastEntry ? lastEntry.action : null;
  const lastResult = lastEntry ? lastEntry.result : null;

  // Runbook detection
  const isRunbook = RUNBOOK_COMPREHENSIVE_RE.test(goal);

  const runbookCtx = isRunbook ? `
RUNBOOK / INVESTIGATION MODE ACTIVE
You are executing a structured, multi-phase IT investigation. Rules for this mode:
1. NEVER finish early -- complete ALL phases listed in the goal before calling "finish".
2. Use "note" actions liberally to document every finding: IPs, zone names, rule IDs, log entries, FQDN lists, any value observed on screen.
3. Use "extract" to save key values (client IP, rule name, zone, etc.) to memory for later reference via ::key::.
4. Navigate to each UI location specified. Read the page after every navigation before acting.
5. If a page has a form or filter, fill it in before reading results.
6. Follow the phase order exactly. Complete each phase fully before advancing.
7. At the end, call "finish" with a COMPLETE ticket-ready summary: all phases covered, all findings listed, the exact change made (or recommended), and rollback steps.
8. Do NOT skip phases because you think you found the answer early -- document ALL phases as instructed.
` : '';

  // Navigation fatigue detection -- DISABLED in runbook mode.
  const _actionCounts = Array.isArray(history) ? history.reduce((acc, h) => {
    if (!h || !h.action) return acc;
    const type = h.action.type;
    if (type === 'navigate') acc.navigate++;
    if (/^extract(_list)?$/.test(type)) acc.extract++;
    if (type === 'note') acc.note++;
    return acc;
  }, { navigate: 0, extract: 0, note: 0 }) : { navigate: 0, extract: 0, note: 0 };
  const navigateCount = _actionCounts.navigate;
  const extractCount = _actionCounts.extract;
  const noteCount = _actionCounts.note;

  const finishCtx = isRunbook ? '' :
    (navigateCount >= 5 && extractCount === 0 && noteCount === 0)
    ? `\nFINISH NOW -- ${navigateCount} navigates with nothing recorded. Use your memory and finish with a comprehensive answer. Include ACTUAL content.\n`
    : (navigateCount >= 3 && extractCount === 0 && noteCount === 0)
    ? `\nHARD STOP -- You navigated ${navigateCount} times without extracting or noting anything. You MUST use "extract", "note", or "finish" NOW. Do NOT navigate again.\n`
    : '';

  // (3.45.0) Quick Mode — action-oriented prompt injection
  const quickModeCtx = (agentState && agentState.quickMode) ?
    '\nQUICK MODE ACTIVE: Skip "note" actions. Every step must be a real action (click, type, navigate, extract, scroll, finish). Do NOT use "note" — think less, act more.\n' : '';

  // Platform-specific UI guidance
  const platformCtx = getPlatformContext(currentUrl, goal);

  // Self-healing: strategy shift prompt — platform-aware (3.9.0)
  const strategyCtx = _buildStrategyCtx(agentState, currentUrl, CONFIG);

  // Self-learning: inject relevant patterns
  const patterns = await getRelevantPatterns(goal);
  const patternCtx = Array.isArray(patterns) && patterns.length
    ? `\nPAST SUCCESSFUL PATTERNS (similar tasks):\n${patterns.map((p, i) => p && p.goal ? `${i+1}. "${p.goal}" -> ${Array.isArray(p.steps) ? p.steps.map(s => s.type).join(' -> ') : '(no steps)'}` : '').join('\n')}\n`
    : '';

  // Memory context
  const memoryKeys = Object.keys(agentState?.agentMemory || {});
  const memoryCtx = memoryKeys.length
    ? `\nAGENT MEMORY (data extracted from pages, use ::key:: to reference):\n${JSON.stringify(agentState?.agentMemory || {})}\n`
    : '';

  // (3.12.0) Client knowledge context. agent-engine.js pre-formats this
  // string at run start and passes it through agentState.clientKnowledgeText.
  // When set, it lists facts learned from prior runs for the active client
  // — site quirks, timing rules, custom paths, recurring errors. Inject
  // verbatim so the LLM sees them every step.
  const clientKnowledgeCtx = (agentState.clientKnowledgeText && typeof agentState.clientKnowledgeText === 'string')
    ? agentState.clientKnowledgeText
    : '';

  // (sub-project B) Brain knowledge context. agent-engine.js pre-formats this
  // string at run start (via background/brain-client.js → getBrainStartupContext,
  // which recalls from the Neuralis brain by platform id / host) and passes it
  // through agentState.brainKnowledgeText. Renders as a DISTINCT, LABELED section
  // ("## BRAIN KNOWLEDGE (shared, cross-installation)") adjacent to the local
  // Client Knowledge section — different trust tier, different framing, both
  // visible to the model. Fails open: empty when the brain is off/down/empty.
  const brainKnowledgeCtx = (agentState.brainKnowledgeText && typeof agentState.brainKnowledgeText === 'string')
    ? agentState.brainKnowledgeText
    : '';

  // (3.12.0) Vision-based action verification. When the immediately prior
  // step was a modifying action (click, type, select, check, press_key,
  // upload_file), force the model to look at the post-action screenshot
  // and explicitly confirm the action took effect BEFORE proposing the next
  // command. No extra API call -- this just sharpens the existing
  // observation cycle so silent failures (click registered but modal didn't
  // close, form filled but hidden validation rejected) get caught.
  const _pv = (agentState && agentState.pendingVerification) || null;
  const verificationCtx = (_pv && _pv.type && typeof _pv === 'object')
    ? `\n## VERIFY YOUR LAST ACTION FIRST\nYour previous step was: **${_pv.type}** -> "${(_pv.description || '').replace(/"/g, '\\"').substring(0, 100)}".\n\nBefore proposing the next command, examine the current screenshot and confirm the action took effect. Look for evidence:\n- Click on a button -> Did the modal close? Did the page navigate? Did a success message appear?\n- Type in a field -> Does the field now contain the typed text?\n- Select a dropdown -> Did the selected value update?\n- Check / check_all -> Are the checkboxes now in the expected state?\n- press_key (Enter/Tab/etc.) -> Did the form submit / focus advance / dropdown open?\n\nIf the page state confirms the action took effect: proceed with the next planned step.\n\nIf the page does NOT reflect the action (button still highlighted, modal still open, field still empty, no navigation): treat the step as failed. Do NOT proceed as if it succeeded. Choose ONE recovery:\n1. Retry the same action with a different selector (often the click missed or hit a wrapper element).\n2. wait 1500ms, then re-observe -- some SPAs commit asynchronously.\n3. scroll_to the element first, then retry.\n4. Use execute_js to trigger the action programmatically (.click(), dispatchEvent('click'), HTMLElement.value setter + 'input' event).\n\nThis verification is mandatory -- never skip past a destructive action without confirming it landed.\n`
    : '';

  // Inject plan context if a plan was generated
  const planCtx = _buildPlanCtx(agentState.agentPlan, agentState.currentPlanStep);

  // Multi-tab context: show all managed tabs with summaries
  const tabCtxSection = _buildTabCtx();

  // Loop directive from stall detection
  const loopCtx = agentState.loopDirective || '';

  // History sanitization: strip screenshot payloads from older entries
  const historyWindowSize = isRunbook ? 25 : CONFIG.historyWindow;
  const sanitizedHistory = _sanitizeHistory(history, isRunbook, CONFIG);

  const _rawPrompt = buildAgentPrompt({
    quickModeCtx, runbookCtx, platformCtx,
    goal, currentUrl, stepCount, pageContent,
    trimmedElements, totalElementCount,
    historyWindowSize, isRunbook, sanitizedHistory,
    lastAction, lastResult,
    planCtx, strategyCtx, finishCtx, verificationCtx,
    patternCtx, memoryCtx, clientKnowledgeCtx, brainKnowledgeCtx, tabCtxSection, loopCtx,
    agentState, base64Image, provider,
    multiPortalCtx: getMultiPortalDirective(goal),
    multiArticleCtx: getMultiArticleDirective(goal),
    visionCapable: supportsVision(agentState && agentState.model) && !(agentState && agentState.visionDegraded)
  });

  // ── Outbound scrub ────────────────────────────────────────────────────────
  // Single chokepoint: everything bound for the model — page text, DOM
  // extracts, action results, agent memory, the goal — has already been
  // assembled into `prompt` by this line, so scrubbing here cannot miss a
  // field the way per-call-site scrubbing would.
  //
  // Secrets and PII become stable placeholders ([[SECRET-1]], [[EMAIL-2]]) that
  // survive the whole run, so the model can still reason about "the email in
  // the ticket". llm-retry.js restores the real values in the command that
  // comes back, before the agent acts on it.
  let prompt = _rawPrompt;
  try {
    const _scrubMode = (await chrome.storage.local.get(['egressScrubMode']))
      .egressScrubMode || SCRUB_MODE.CLOUD;
    if (shouldScrub(endpoint, _scrubMode, model)) {
      const _scrubber = getEgressScrubber();
      const _before = _scrubber.count();
      prompt = _scrubber.scrub(_rawPrompt);
      const _added = _scrubber.count() - _before;
      if (_added > 0) {
        agentState.egressMasked = _scrubber.summary();
        console.warn('[Sentinel/scrub] Masked before egress:', JSON.stringify(_scrubber.summary()));
      }
    }
  } catch (e) {
    // Fail CLOSED on an unexpected scrubber fault: a page we could not scrub
    // must not be shipped to a third party just because the guard broke.
    console.error('[Sentinel/scrub] Scrub failed — refusing to send raw content:', getErrorMessage(e));
    throw new Error('Outbound scrub failed; request blocked to avoid leaking page content. See console.');
  }

  const controller = new AbortController();
  // Adaptive timeout: a vision request (screenshot payload + a slower vision
  // model such as glm-4.6v) legitimately takes longer than a text-only call.
  // The flat 30s ceiling was aborting these mid-flight ("signal is aborted
  // without reason" → "API timed out after 30s"), forcing a wasted retry on
  // every slow step. Give vision calls 2x headroom; text calls keep 30s.
  const _isVisionCall = !!base64Image && typeof provider.buildVisionContent === 'function';
  const _effectiveTimeout = _isVisionCall ? CONFIG.fetchTimeout * 2 : CONFIG.fetchTimeout;
  const fetchTimeout = setTimeout(() => controller.abort(), _effectiveTimeout);

  // Build request body using provider registry
  // (3.51) Send vision content when we have an image and the provider supports it.
  // If the endpoint rejects the vision request with 400, we fall back to text-only
  // (see the 400-retry block below) so non-vision model variants don't silently fail.
  // Once THIS run has had an image payload rejected with a 400, stop attaching
  // the screenshot. Without this the optimistic probe below repeats on every
  // single step: against a text-only model behind an OpenAI-compatible endpoint
  // a live run showed a 400 (≈57KB of base64 uploaded for nothing) followed by a
  // text-only retry on step after step — two requests, two rate-limiter slots
  // and two apiCallCount increments per step, for the whole run. It also made
  // the request contradict the prompt, which already tells the model
  // `visionCapable:false` once visionDegraded is set. One probe per run is
  // enough, and probing (rather than trusting supportsVision()) is deliberate:
  // the model-name matcher has false negatives for self-hosted VL builds.
  const _useVision = _isVisionCall && !(agentState && agentState.visionDegraded);
  const userContent = (_useVision)
    ? provider.buildVisionContent(prompt, base64Image)
    : prompt;

  const useThinking = provider.supportsToolUse && provider.id === 'anthropic'
    && typeof provider.buildBodyWithThinking === 'function'
    && CONFIG.strategyShiftThreshold > 0
    && agentState.consecutiveFailures >= CONFIG.strategyShiftThreshold;
  // (v20.4) Streaming gate. Default on; a provider can opt out with
  // supportsStreaming:false, or globally via CONFIG.streaming:false. Adds the
  // stream flag to the request body (and OpenAI-style usage opt-in). The parse
  // path only treats the response as a stream if it actually comes back as SSE
  // (see _isStreamingResponse), so providers that ignore stream:true are safe.
  const _wantStream = CONFIG.streaming !== false && provider.supportsStreaming !== false;
  const _withStream = (obj) => {
    if (!_wantStream) return obj;
    const o = { ...obj, stream: true };
    if (provider.id !== 'anthropic') o.stream_options = { include_usage: true };
    return o;
  };
  let requestBody;
  if (useThinking) {
    requestBody = JSON.stringify(_withStream(provider.buildBodyWithThinking(model, provider.systemPromptTweak, userContent, SENTINEL_TOOLS, 8000, { maxTokens: 8000 })));
  } else if (provider.supportsToolUse) {
    requestBody = JSON.stringify(_withStream(provider.buildBodyWithTools(model, provider.systemPromptTweak, userContent, SENTINEL_TOOLS, { maxTokens: 8000, temperature: 0.1 })));
  } else {
    requestBody = JSON.stringify(_withStream(provider.buildBody(model, provider.systemPromptTweak, userContent, { maxTokens: 8000, temperature: 0.1 })));
  }
  // (v21.6.1) Merge provider-specific custom headers (e.g. OpenRouter HTTP-Referer, X-Title)
  const requestHeaders = { ...provider.buildHeaders(apiKey, { thinking: useThinking }), ...(provider.headers || {}) };
  // Tracks which AbortController owns the response we ultimately parse (the
  // vision fallback below swaps in its own controller).
  let activeController = controller;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(fetchTimeout);
    _apiHealth.record(_apiStart, false);
    console.error('[Sentinel/LLM] API call failed:', getErrorMessage(err));
    throw (typeof err === 'object' && err !== null && typeof err.name === 'string' && err.name === 'AbortError') ? new Error(`API timed out after ${_effectiveTimeout/ONE_SECOND_MS}s`) : err;
  }
  clearTimeout(fetchTimeout);
  let _apiHealthRecorded = false;
  try {
  if (!response.ok) {
    let errorData;
    try { errorData = await response.text(); } catch (_readErr) { errorData = 'unable to read error body'; }
    if (response.status === 429) throw new Error(`429 Rate limited. ${errorData}`);
    if (response.status === 400 && errorData && typeof errorData === 'string' && errorData.includes('Unknown Model')) throw new Error(`Unknown model "${model}".`);
    // (3.51.1) Vision fallback: if we sent image content and got a 400, retry
    // text-only. Some OpenAI-compatible endpoints (e.g. Z.AI for text-primary
    // GLM variants) reject image_url even though the protocol accepts it.
    if (response.status === 400 && _useVision) {
      console.warn('[Sentinel] Vision request rejected (400) — retrying without image. Error:', (errorData || 'unknown error').slice(0, 200));
      // (v20.3) Mark the run blind so subsequent steps switch to selector-based
      // interaction instead of preferring click_at coordinates it can't derive.
      if (agentState) agentState.visionDegraded = true;
      _rateLimiter.check(); // rate-limit the fallback call just like the original
      agentState.apiCallCount++; // second attempt counts as its own call
      const _fbContent = prompt; // text-only
      let _fbBody;
      if (useThinking) {
        _fbBody = JSON.stringify(_withStream(provider.buildBodyWithThinking(model, provider.systemPromptTweak, _fbContent, SENTINEL_TOOLS, 8000, { maxTokens: 8000 })));
      } else if (provider.supportsToolUse) {
        _fbBody = JSON.stringify(_withStream(provider.buildBodyWithTools(model, provider.systemPromptTweak, _fbContent, SENTINEL_TOOLS, { maxTokens: 8000, temperature: 0.1 })));
      } else {
        _fbBody = JSON.stringify(_withStream(provider.buildBody(model, provider.systemPromptTweak, _fbContent, { maxTokens: 8000, temperature: 0.1 })));
      }
      const _fbCtrl = new AbortController();
      const _fbTimeout = setTimeout(() => _fbCtrl.abort(), CONFIG.fetchTimeout);
      let _fbResp;
      try {
        _fbResp = await fetch(endpoint, { method: 'POST', headers: requestHeaders, body: _fbBody, signal: _fbCtrl.signal });
      } catch (err) {
        clearTimeout(_fbTimeout);
        console.error('[Sentinel/LLM] Vision fallback API call failed:', getErrorMessage(err));
        throw (typeof err === 'object' && err !== null && typeof err.name === 'string' && err.name === 'AbortError') ? new Error(`API timed out after ${CONFIG.fetchTimeout/ONE_SECOND_MS}s`) : err;
      }
      clearTimeout(_fbTimeout);
      if (!_fbResp.ok) {
        let _fbErr;
        try { _fbErr = await _fbResp.text(); } catch (_readErr) { _fbErr = 'unable to read error body'; }
        if (_fbResp.status === 429) throw new Error(`429 Rate limited. ${_fbErr}`);
        throw new Error(`API Error: ${_fbResp.status} - ${_fbErr}`);
      }
      // Replace `response` with the successful fallback response for the parse logic below
      response = _fbResp;
      activeController = _fbCtrl; // idle-stream timeout must abort the fallback fetch
    } else {
      throw new Error(`API Error: ${response.status} - ${errorData}`);
    }
  }

  let data;
  if (_wantStream && _isStreamingResponse(response)) {
    // (v20.4) Read the SSE stream with a per-chunk idle timeout — slow/thinking
    // models that keep producing output are never aborted mid-generation.
    try {
      data = await _readSSEToData(response, provider, activeController, CONFIG.fetchTimeout, agentState && agentState.onStreamChunk);
    } catch (e) {
      const aborted = typeof e === 'object' && e !== null && e.name === 'AbortError';
      throw aborted
        ? new Error(`API timed out after ${CONFIG.fetchTimeout / ONE_SECOND_MS}s`)
        : new Error(`API stream read failed: ${getErrorMessage(e)}`);
    }
  } else {
    // (audit) The fetch timeout was cleared once headers arrived, and the
    // streaming path has its own idle timeout — but this non-streaming body read
    // had none, so a server that sends 200 + headers then stalls the body would
    // hang the step forever. Abort the owning controller if the read stalls.
    const _bodyTimeout = setTimeout(() => { try { activeController.abort(); } catch (_) { /* already settled */ } }, CONFIG.fetchTimeout);
    try {
      data = await response.json();
    } catch (e) {
      const aborted = typeof e === 'object' && e !== null && e.name === 'AbortError';
      throw aborted
        ? new Error(`API body read timed out after ${CONFIG.fetchTimeout / ONE_SECOND_MS}s`)
        : new Error(`API returned invalid JSON: ${getErrorMessage(e)}`);
    } finally {
      clearTimeout(_bodyTimeout);
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('API returned invalid response body (expected object)');
  }
  // Early detection of auth errors from providers that return HTTP 200 with error payloads
  if ((!data.choices || !data.choices.length) && (data.error || data.msg || (data.code && data.success === false))) {
    const errMsg = data.error?.message || data.msg || data.message || JSON.stringify(data);
    throw new Error(`🔑 API Authentication Failed: ${errMsg}. Check your API key in extension settings.`);
  }

  // Extract real token usage (provider-normalised).
  // Anthropic: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
  // OpenAI:    { prompt_tokens, completion_tokens, total_tokens }
  const _u = data.usage || {};
  const _in  = _u.input_tokens  || _u.prompt_tokens    || 0;
  const _out = _u.output_tokens || _u.completion_tokens || 0;
  if (_in > 0 || _out > 0) {
    agentState.totalInputTokens  = (agentState.totalInputTokens  || 0) + _in;
    agentState.totalOutputTokens = (agentState.totalOutputTokens || 0) + _out;
    // (9.2) Update running cost estimate
    agentState.estimatedCostUsd = estimateCostUsd(agentState.totalInputTokens, agentState.totalOutputTokens, model);
    // Multi-provider cost tracking by tier
    recordModelUsage(agentState._lastModelTier || 'default', _in, _out);
    // Credit protection: record usage for daily limit tracking
    try {
      const _msg = { action: 'record_credit_usage', inputTokens: _in, outputTokens: _out, model };
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(_msg).catch(() => {});
      }
    } catch (_e) { /* non-fatal */ }
  }
  if (_u.cache_read_input_tokens)    agentState.totalCacheReadTokens  = (agentState.totalCacheReadTokens  || 0) + _u.cache_read_input_tokens;
  if (_u.cache_creation_input_tokens) agentState.totalCacheWriteTokens = (agentState.totalCacheWriteTokens || 0) + _u.cache_creation_input_tokens;
  // API Health: record successful response
  _apiHealthRecorded = true; _apiHealth.record(_apiStart, true);


  // Extract reasoning_content from models that return it (GLM, DeepSeek, etc.)
  // This is the model's chain-of-thought, separate from the action text.
  // parseLLMResponse captures text-before-JSON reasoning; this captures the
  // API-level reasoning field. We merge both so the popup reasoning cards
  // show the most complete picture.
  const _apiReasoning = (typeof data.choices?.[0]?.message?.reasoning_content === 'string')
    ? data.choices[0].message.reasoning_content.trim().substring(0, 600)
    : '';
  function _attachReasoning(cmd) {
    if (!_apiReasoning || !cmd || typeof cmd !== 'object') return cmd;
    if (cmd.__reasoning) {
      cmd.__reasoning = (_apiReasoning + '\n' + cmd.__reasoning).substring(0, 600);
    } else {
      cmd.__reasoning = _apiReasoning;
    }
    return cmd;
  }
  // Parse response — tool use path for providers that support it
  if (provider.supportsToolUse) {
    // Anthropic: check stop_reason === 'tool_use'
    if (data.stop_reason === 'tool_use') {
      try {
        return provider.parseToolUseResponse(data);
      } catch (e) {
        // Malformed Anthropic tool_use response — fall through to text parsing
        console.warn('[Sentinel] Anthropic parseToolUseResponse failed, falling back to text parsing:', getErrorMessage(e));
      }
    }
    // OpenAI-compatible: check for tool_calls in the response message
    const choice = Array.isArray(data.choices) && data.choices.length ? data.choices[0] : null;
    const hasToolCalls = choice && choice.message && Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length;
    if (hasToolCalls) {
      try {
        return provider.parseToolUseResponse(data);
      } catch (e) {
        // parseToolUseResponse failed — fall through to text parsing
        console.warn('[Sentinel] tool_use parse failed, falling back to text parsing:', getErrorMessage(e));
      }
    }
    // Fallback: model returned text instead of tool_calls (e.g. finish_reason !== 'tool_calls')
    // Try text-JSON parsing as a safety net
    try {
      const responseText = provider.parseResponse(data);
      if (responseText) return _attachReasoning(parseLLMResponse(responseText));
    } catch (e) {
      console.warn('[Sentinel/llm] parseResponse fallback failed:', getErrorMessage(e));
    }
    // If we get here, the model returned tool_calls but parsing failed AND text fallback failed
    // One last attempt: try the raw tool_calls directly
    if (hasToolCalls && choice.message && Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length) {
      const tc = choice.message.tool_calls[0];
      if (tc && tc.function && tc.function.name) {
        try {
          const input = JSON.parse(tc.function.arguments || '{}');
          return _attachReasoning({ type: tc.function.name, ...input });
        } catch (e) { console.warn('[Sentinel/llm] tool_calls JSON parse failed:', getErrorMessage(e)); }
      }
    }
    // v3.61: z.ai sometimes returns finish_reason="tool_calls" with malformed/empty tool_calls
    // but the content or reasoning_content contains the tool intent. Detect and construct action.
    if (choice && choice.finish_reason === 'tool_calls') {
      const _msg = choice.message || {}; // Cache to avoid repeated property access
      const _intentText = `${(typeof _msg.content === 'string' ? _msg.content : '') || ''} ${(typeof _msg.reasoning_content === 'string' ? _msg.reasoning_content : '') || ''}`;
      // Detect smart_navigate intent from content
      if (/smart[._-]?navigate/i.test(_intentText)) {
        const _goal = goal || ''; // Cache to avoid repeated fallback
        let _site = 'google', _query = '';
        if (/weather\.gov/i.test(_goal)) _site = 'weather.gov';
        else if (/wikipedia/i.test(_goal)) _site = 'wikipedia';
        else if (/youtube/i.test(_goal)) _site = 'youtube';
        else if (/amazon/i.test(_goal)) _site = 'amazon';
        else if (/reddit/i.test(_goal)) _site = 'reddit';
        else if (/twitter\.com|x\.com/i.test(_goal)) _site = 'twitter';
        // Extract query from goal text
        const _qm = _goal.match(FORECAST_QUERY_RE);
        if (_qm && _qm[1]) _query = _qm[1].trim();
        else {
          const _fm = _goal.match(FOR_ABOUT_QUERY_RE);
          if (_fm && _fm[1]) _query = _fm[1].trim();
        }
        if (_query) {
          console.warn('[Sentinel/FALLBACK] Detected smart_navigate intent from content — site:', _site, 'query:', _query);
          return { type: 'smart_navigate', site: _site, query: _query };
        }
      }
      // Detect explicit navigate URL in content
      const _navUrl = _intentText.match(NAVIGATE_URL_RE);
      if (_navUrl && _navUrl[1]) {
        console.warn('[Sentinel/FALLBACK] Detected navigate intent from content — url:', _navUrl[1]);
        return { type: 'navigate', url: _navUrl[1] };
      }
      // v3.63: Detect navigate_back / go back intent
      if (/\b(?:go|navigate)\s*back\b|\bback\s+to\b|\breturn\s+to\b|\bprevious\s+page\b/i.test(_intentText)) {
        console.warn('[Sentinel/FALLBACK] Detected navigate_back intent from content');
        return { type: 'navigate_back' };
      }
      // v3.63: Detect navigate to named site from content ("go to Amazon", "navigate to Reddit")
      const _siteUrl = _intentText.match(NAVIGATE_SITE_RE);
      if (_siteUrl && _siteUrl[1]) {
        const _mapped = SITE_DOMAIN_MAP[_siteUrl[1].toLowerCase().replace(WHITESPACE_REPLACE_RE, '')];
        if (_mapped) {
          console.warn('[Sentinel/FALLBACK] Detected navigate to site from content:', _mapped);
          return { type: 'navigate', url: `https://${_mapped}` };
        }
      }
      // v3.63: Detect finish intent from content
      if (/\b(?:finish|done|complete|here\s+(?:is|are)|summary|report)\b/i.test(_intentText) && /\b(?:task|report|findings|articles|results)\b/i.test(_intentText)) {
        console.warn('[Sentinel/FALLBACK] Detected finish intent from content');
        return { type: 'finish', summary: _intentText.substring(0, 500) };
      }
    }
    // (fix) Salvage substantive assistant text as a note instead of discarding it.
    // Some providers (e.g. z.ai GLM) return finish_reason="tool_calls" but put the
    // real work — reasoning plus already-extracted data — in content/reasoning_content
    // with no parseable tool call. Dropping it ("will retry") loses data the model
    // already gathered (e.g. a SonicWall interface table) and burns a step. Keep it
    // as a note so it persists in history/memory for the finish summary.
    if (choice && choice.message) {
      const _m = choice.message;
      const _salvageText = `${(typeof _m.content === 'string' ? _m.content : '') || ''}\n${(typeof _m.reasoning_content === 'string' ? _m.reasoning_content : '') || ''}`.trim();
      if (_salvageText.length > 40) {
        console.warn('[Sentinel/llm] No parseable action — salvaging assistant text as a note (' + _salvageText.length + ' chars).');
        return _attachReasoning({ type: 'note', text: _salvageText.substring(0, 4000) });
      }
    }
    return { type: 'note', text: 'LLM returned an unparseable response. Will retry.' };
  }
  // Fallback: text-JSON parsing (non-tool-use providers)
  let responseText;
  try {
    responseText = provider.parseResponse(data);
  } catch (e) {
    console.warn('[Sentinel/llm] parseResponse failed (non-tool-use path):', getErrorMessage(e));
    return { type: 'note', text: 'LLM returned an unparseable response. Will retry.' };
  }
  if (!responseText) return { type: 'note', text: 'Empty LLM response — will retry on next step.' };
  return _attachReasoning(parseLLMResponse(responseText));
  } catch(_apiErr) { if (!_apiHealthRecorded) _apiHealth.record(_apiStart, false); throw _apiErr; }
}

// ========== Response Parsing ==========
/**
 * Extract the first valid JSON object with a recognized "type" field from a string.
 * Handles models that prepend reasoning/thinking text before the actual JSON payload.
 * @param {string} str - Raw LLM response text.
 * @returns {Object|null} Parsed action object, or null if no valid JSON found.
 */
export function extractFirstJsonObject(str) {
  // Try every '{' position to find a valid JSON object with a "type" field.
  // This handles models that prepend reasoning text before the actual JSON.

  let searchFrom = 0;
  const strLen = str.length;
  while (searchFrom < strLen) {
    const start = str.indexOf('{', searchFrom);
    if (start === -1) return null;

    let depth = 0, inString = false, escape = false;
    let end = -1;
    for (let i = start; i < strLen; i++) {
      const ch = str[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }

    if (end !== -1) {
      const candidate = str.substring(start, end + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed.type && VALID_ACTION_TYPES.has(parsed.type)) return candidate;
      } catch (e) { console.warn('[Sentinel/llm] JSON parse failed:', getErrorMessage(e)); }
      searchFrom = end + 1;
    } else {
      break;
    }
  }
  return null;
}

// (3.8.4) Sanitize LLM-emitted JSON: handle invalid escape sequences and
// literal control characters inside string values WITHOUT corrupting the
// structural JSON. Operates only inside string contexts (between unescaped
// double-quotes) so JSON syntax outside strings is left untouched.
/**
 * Sanitize LLM-emitted JSON by fixing invalid escape sequences and replacing
 * literal control characters inside string values with valid JSON escapes.
 * @param {string} jsonStr - Raw JSON string from the LLM.
 * @returns {string} Sanitized JSON string safe for JSON.parse.
 */
function sanitizeLlmJson(jsonStr) {
  if (typeof jsonStr !== 'string') return jsonStr;
  let out = '';
  let inStr = false;
  const len = jsonStr.length;
  for (let i = 0; i < len; i++) {
    const ch = jsonStr[i];
    if (!inStr) {
      if (ch === '"') { inStr = true; out += ch; continue; }
      out += ch;
      continue;
    }
    // We are inside a string.
    if (ch === '"') { inStr = false; out += ch; continue; }
    if (ch === '\\') {
      const next = jsonStr[i + 1];
      if (next === undefined) { out += ch; continue; }
      if (VALID_JSON_ESCAPE_CHARS.has(next)) {
        // Valid JSON escape — emit both chars and skip ahead.
        out += ch + next;
        i++;
        continue;
      }
      // Invalid escape (e.g., \\` from a markdown code fence). Drop the
      // backslash, keep the next char as a literal so the JSON parses.
      out += next;
      i++;
      continue;
    }
    // Inside a string, raw control chars are illegal. Replace newlines, CRs,
    // and tabs with their valid escapes; drop any other control chars.
    const code = ch.charCodeAt(0);
    if (code === 0x0A) { out += '\\n'; continue; }
    if (code === 0x0D) { out += '\\r'; continue; }
    if (code === 0x09) { out += '\\t'; continue; }
    if (code < 0x20) { continue; /* drop other ctrl chars */ }
    out += ch;
  }
  return out;
}

// (3.8.4) Last-ditch regex extraction for finish/note actions when JSON.parse
// fails completely. Pulls the summary or text content via a permissive regex
// that tolerates whatever malformed escapes the LLM emitted.
/**
 * Last-ditch regex extraction for finish/note actions when JSON.parse fails.
 * Detects "summary" or "text" keys and extracts their values, tolerating malformed escapes.
 * @param {string} content - Raw LLM response text.
 * @returns {Object|null} Parsed action object {type: 'finish'|'note', summary|text}, or null if no match.
 */
function regexSalvageFinishOrNote(content) {
  if (typeof content !== 'string') return null;
  // Detect finish vs note by which marker appears first.
  const finishIdx = content.indexOf('"summary"');
  const noteIdx = content.indexOf('"text"');
  if (finishIdx === -1 && noteIdx === -1) return null;
  const useFinish = finishIdx !== -1 && (noteIdx === -1 || finishIdx < noteIdx);
  // Use precompiled regex to avoid recreating on every call
  const re = useFinish ? FINISH_SALVAGE_REGEX : NOTE_SALVAGE_REGEX;
  const m = content.match(re);
  if (!m) return null;
  let raw = m[1];
  // Soften common malformations the LLM emits: \\` -> \`, then unescape \n/\r/\t
  raw = raw.replace(/\\([^"\\/bfnrtu])/g, '$1')
           .replace(/\\n/g, '\n')
           .replace(/\\r/g, '\r')
           .replace(/\\t/g, '\t')
           .replace(/\\"/g, '"');
  if (useFinish) return { type: 'finish', summary: raw };
  if (!raw) return null;
  return { type: 'note', text: raw };
}

/**
 * Parse an LLM response string into an action object.
 * Strips markdown code fences, then tries direct JSON parse, then
 * falls back to extractFirstJsonObject for responses with preamble text.
 * @param {string} content - Raw LLM response text.
 * @returns {Object} Parsed action object with a "type" field.
 * @throws {Error} If the response cannot be parsed as valid action JSON.
 */
export function parseLLMResponse(content) {
  try {
    if (!content || typeof content !== 'string') {
      throw new Error('Empty or null response from API');
    }
    let jsonStr = content.trim();
    // Strip <think>...</think> blocks (GLM/DeepSeek) so JSON inside them
    // isn't mistaken for the real action. Same fix as in generatePlan.
    jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(CODE_BLOCK_REGEX);
      if (match && match[1]) jsonStr = match[1].trim();
    }
    const firstObj = extractFirstJsonObject(jsonStr);
    // (6.0) Capture pre-JSON reasoning text for reasoning cards in the popup.
    let __reasoning = '';
    if (firstObj) {
      const jsonIdx = jsonStr.indexOf(firstObj.substring(0, 30));
      if (jsonIdx > 10) __reasoning = jsonStr.substring(0, jsonIdx).trim().slice(0, 600);
      jsonStr = firstObj;
    }
    // (3.8.4) Sanitize invalid escape sequences and raw control chars inside
    // string values BEFORE parsing. Replaces the old "strip 0x00-0x1f" pass
    // which destroyed newlines and broke the salvage path.
    jsonStr = sanitizeLlmJson(jsonStr);
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`Failed to parse action JSON: ${getErrorMessage(e)}`);
    }
    if (!parsed.type && parsed.action && typeof parsed.action === 'object') parsed = parsed.action;
    if (!parsed.type && parsed.command && typeof parsed.command === 'object') parsed = parsed.command;
    if (!parsed.type && parsed.next_action && typeof parsed.next_action === 'object') parsed = parsed.next_action;
    if (!parsed.type) throw new Error('Missing type field');
    if (!VALID_ACTION_TYPES.has(parsed.type)) throw new Error(`Invalid command type: ${parsed.type}`);
    if (__reasoning) parsed.__reasoning = __reasoning;
    return parsed;
  } catch (err) {
    console.error('Failed to parse LLM response:', getErrorMessage(err), 'Content:', content);
    // (3.8.4) Two-tier salvage:
    //  1. Try sanitize-then-parse on the raw content (in case extractFirstJsonObject
    //     truncated something we needed).
    //  2. If that fails, regex-extract finish/note content directly.
    if (typeof content === 'string' && content) {
      try {
        const sanitized = sanitizeLlmJson(content.trim());
        const parsed = (() => { try { return JSON.parse(sanitized); } catch(_e) { console.warn("[Sentinel] JSON.parse failed:", _e.message); return null; } })();
        if (parsed && parsed.type && VALID_ACTION_TYPES.has(parsed.type)) return parsed;
      } catch (e) { console.warn('[Sentinel/llm] Regex salvage failed:', getErrorMessage(e)); }
      try {
        const salvaged = regexSalvageFinishOrNote(content);
        if (salvaged) {
          console.warn(`[Sentinel] Recovered ${salvaged.type} action via regex salvage`);
          return salvaged;
        }
      } catch (e) { console.warn('[Sentinel/llm] Parse failed:', getErrorMessage(e)); }
    }
    // (v20.2) Preserve the model's prose instead of discarding it. Some models
    // (especially with extended thinking, or non-tool endpoints) narrate their
    // findings in plain text instead of emitting an action JSON — e.g. reading
    // SonicWall interface IPs aloud, then "Let me navigate to…". The old path
    // threw that away as a bare "Parse error" and looped, losing real extracted
    // data. Capture substantial prose as a note so it survives into history and
    // the final report. Keep the "Parse error" marker (telemetry + tests rely on
    // it) and keep the generic message for short/garbage responses.
    const _prose = (typeof content === 'string' ? content.trim() : '').replace(/\s+/g, ' ');
    if (_prose.length > 40) {
      return { type: 'note', text: `Parse error (will retry) — captured model output: ${_prose.substring(0, 1500)}` };
    }
    return { type: 'note', text: `Parse error (will retry): ${getErrorMessage(err)}` };
  }
}

// (v20.4) Find the first balanced { … } object in a string, optionally one that
// contains a marker substring (e.g. '"action"'). String-aware brace matching so
// braces inside quoted values don't confuse depth tracking. Tolerates reasoning
// prose before the JSON (scans from each '{') and trailing prose after it (stops
// at the matching '}'). Shared by the vision parser below.
function firstBalancedJsonObject(str, marker) {
  if (typeof str !== 'string') return null;
  let searchFrom = 0;
  const strLen = str.length;
  while (searchFrom < strLen) {
    const start = str.indexOf('{', searchFrom);
    if (start === -1) return null;
    let depth = 0, inString = false, escape = false, end = -1;
    for (let i = start; i < strLen; i++) {
      const ch = str[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null;
    const candidate = str.substring(start, end + 1);
    if (!marker || candidate.includes(marker)) return candidate;
    searchFrom = end + 1;
  }
  return null;
}

/**
 * Robustly parse the v4 vision-first JSON response shape:
 *   {"thinking":…,"evaluation":…,"memory":…,"next_goal":…,"action":{"type":…,"index":N,…}}
 *
 * Weak vision models (notably GLM-4V / GLM-4.xv) routinely wrap this object in
 * <think> reasoning blocks, markdown code fences, or trailing prose, emit invalid
 * escape sequences, or append explanatory text — all of which break a naive
 * JSON.parse. This mirrors the hardening in parseLLMResponse so the vision path is
 * just as forgiving as the legacy text path.
 *
 * @param {string} raw - Raw LLM response content.
 * @returns {Object|null} Parsed response object (with .action when present), or null.
 */
export function parseVisionResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const tryParse = (str) => {
    if (typeof str !== 'string' || !str) return null;
    try { const o = JSON.parse(str); return (o && typeof o === 'object') ? o : null; }
    catch (_e) { return null; }
  };
  let s = raw.trim();

  // (v21.3) GLM-4V/DeepSeek sometimes return the action wrapped in <think> WITHOUT
  // a closing tag (truncated by max_tokens). Strip everything up to the last
  // { that starts a JSON object — the model's thinking prose before it is noise.
  // First try the normal closed-tag strip.
  const thinkStripped = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (thinkStripped.length > 0 && thinkStripped !== s) {
    s = thinkStripped;
  } else {
    // Unclosed <think> — strip everything before the opening tag.
    const openThink = s.indexOf('<think>');
    if (openThink >= 0) {
      const afterThink = s.substring(openThink + 7);
      const firstBrace = afterThink.indexOf('{');
      if (firstBrace >= 0) {
        s = afterThink.substring(firstBrace).trim();
      }
    }
  }

  // (v21.3) Strip markdown code fences more aggressively.
  // (v21.3) Strip markdown code fences more aggressively (GLM-4V wraps JSON in fences).
  while (s.includes('```')) {
    const fence = s.match(/```(?:json|JSON|javascript|js)?\s*([\s\S]*?)```/);
    if (fence && fence[1]) {
      s = fence[1].trim();
    } else {
      // Unclosed code fence — take everything after the opening ```
      const openFence = s.indexOf('```');
      if (openFence >= 0) {
        const afterFence = s.substring(openFence + 3);
        const langEnd = afterFence.indexOf('\n');
        if (langEnd >= 0) {
          s = afterFence.substring(langEnd + 1).trim();
        } else {
          s = afterFence.trim();
        }
      } else {
        break;
      }
    }
  }

  // (v21.3) Fix raw newlines inside JSON string values.
  // GLM-4V frequently emits unescaped \n inside "text" fields, breaking JSON.parse.
  // This regex finds string values and escapes literal newlines/tabs within them.
  s = s.replace(/("(?:text|url|code|thinking|evaluation|memory|next_goal|direction|query|summary)"\s*:\s*")(.*?)("")/gs,
    (match, prefix, content, suffix) => {
      // Escape literal newlines, tabs, and carriage returns inside the string value
      const fixed = content
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
      return prefix + fixed + suffix;
    });

  // 1) Direct parse, then sanitized parse.
  let parsed = tryParse(s) || tryParse(sanitizeLlmJson(s));
  if (parsed) return parsed;

  // 2) Extract the first balanced object that looks like a vision response
  //    (handles preamble/trailing prose around the JSON).
  const candidate = firstBalancedJsonObject(s, '"action"')
    || firstBalancedJsonObject(s, '"next_goal"')
    || firstBalancedJsonObject(s);
  if (candidate) {
    parsed = tryParse(candidate) || tryParse(sanitizeLlmJson(candidate));
    if (parsed) return parsed;
  }

  // 3) Pull just the nested action object out of the noise.
  // (v21.3) Made the regex non-greedy + handle nested braces better.
  const actMatch = s.match(/"action"\s*:\\s*(\{[^]*(?:\}|$))/) ||
                   s.match(/"action"\s*:\s*(\{[\s\S]*?\})/);
  if (actMatch && actMatch[1]) {
    const actObj = tryParse(actMatch[1]) || tryParse(sanitizeLlmJson(actMatch[1]));
    if (actObj && actObj.type) return { action: actObj };
  }

  // 4) Last-ditch: scrape a bare type (+ optional index/text) from anywhere.
  const typeMatch = s.match(/"type"\s*:\s*"([a-zA-Z_]+)"/);
  if (typeMatch) {
    const action = { type: typeMatch[1] };
    const idxMatch = s.match(/"index"\s*:\s*(\d+)/);
    if (idxMatch) action.index = Number(idxMatch[1]);
    const strFieldMatch = s.match(/"(?:text|url|code|direction|query)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (strFieldMatch) action.text = strFieldMatch[1];
    return { action };
  }

  // (v21.3) ULTRA last-ditch: try extracting from reasoning_content.
  // GLM-4V sometimes puts the JSON ONLY in reasoning_content with empty content.
  if (s.includes('"action"') || s.includes('"type"')) {
    // Already tried above, but try one more with extreme tolerance.
    const ultraMatch = s.match(/\{[^{}]*"type"\s*:\s*"([a-zA-Z_]+)"[^{}]*\}/);
    if (ultraMatch) {
      try {
        const ultra = JSON.parse(ultraMatch[0]);
        if (ultra && ultra.type) return { action: ultra };
      } catch (_) {}
    }
  }

  return null;
}

// ========== Self-Learning ==========
/**
 * Retrieve learned action patterns relevant to the current goal from storage.
 * Patterns are scored by keyword overlap with the goal text and sorted by
 * recency and success count.
 * @param {string} goal - The user's current goal text.
 * @returns {Promise<Array>} Sorted array of relevant learned patterns.
 */
export async function getRelevantPatterns(goal) {
  try {
    if (!goal || typeof goal !== 'string') return [];
    const stored = await chrome.storage.local.get(['learned_patterns']).catch(() => ({ learned_patterns: [] }));
    const patterns = stored.learned_patterns || [];
    // Cache goal processing to avoid repeated toLowerCase and split calls
    const goalLower = goal.toLowerCase();
    const goalWords = goalLower.split(/\s+/).filter(w => w.length > 3);
    const scored = patterns
      .filter(p => p.success)
      .map(p => {
        // Cache goal processing to avoid repeated toLowerCase calls
        const pGoalLower = p.goal && typeof p.goal === 'string' ? p.goal.toLowerCase() : '';
        return {
          pattern: p,
          score: goalWords.reduce((acc, w) => acc + (pGoalLower.includes(w) ? 1 : 0), 0)
        };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return scored.map(s => s.pattern);
  } catch (e) { console.error('[Sentinel/llm] getRelevantPatterns failed:', getErrorMessage(e)); return []; }
}

// ========== Simple LLM Call (Quick Assist) ==========
/**
 * Make a single-turn LLM call for Quick Assist and similar lightweight uses.
 * Uses the active provider from settings. Returns the text response or throws.
 *
 * @param {string} systemPrompt - The system/instruction context.
 * @param {string} userPrompt - The user's query or content to process.
 * @param {number} [maxTokens=1200] - Maximum tokens for the response.
 * @returns {Promise<string>} The LLM's text response.
 */
export async function callLLMSimple(systemPrompt, userPrompt, maxTokens = 1200) {
  if (!systemPrompt || !userPrompt) throw new Error('systemPrompt and userPrompt are required');
  const providerConfig = await getActiveProvider();
  if (!providerConfig) throw new Error('No active provider configured. Set one in extension settings.');
  const { endpoint, apiKey, model } = providerConfig;
  // Same rule as callLLM: a local `auth: 'none'` provider needs no key.
  if (!apiKey && providerRequiresApiKey(providerConfig.id, endpoint)) {
    throw new Error('API key not configured. Set it in extension settings.');
  }
  const provider = resolveProviderForConfig(providerConfig);
  if (!provider) throw new Error(`Unknown provider for endpoint: ${endpoint}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const body = JSON.stringify(provider.buildBody(model, systemPrompt, userPrompt, { maxTokens, temperature: 0.4 }));
    // (v21.6.1) Merge provider-specific custom headers
    const headers = { ...provider.buildHeaders(apiKey), ...(provider.headers || {}) };
    const response = await fetch(endpoint, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      let errText;
      try { errText = await response.text(); } catch (_) { errText = ''; }
      throw new Error(`API Error ${response?.status || 'unknown'}: ${errText.substring(0, 200)}`);
    }
    const data = await response.json();
    if (!data) throw new Error('Quick Assist API returned null response body');
    const text = provider.parseResponse(data);
    if (!text) throw new Error('Empty response from API');
    return text;
  } catch (err) {
    clearTimeout(timeout);
    throw (typeof err === 'object' && err !== null && typeof err.name === 'string' && err.name === 'AbortError') ? new Error('Quick Assist request timed out after 30s') : err;
  }
}

