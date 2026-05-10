// Sentinel Override v3 -- Agent Engine
// Agent loop, planning, self-healing, state management.
// Imports from llm-client.js, tab-manager.js, message-protocol.js.

import { callLLMWithRetry, generatePlan, supportsVision, getPlatformContext, getRelevantPatterns } from './llm-client.js';
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl, getTabInfo, detachAllDebuggees, cdpDispatchClick, cdpDispatchType, cdpDispatchKey, cdpExecuteJs, readConsoleMessages, readNetworkRequests } from './tab-manager.js';
import { sendSilentUpdate, sendActionMessage, sendActionResult, sendReportUpdate, sendPageContext, sendTabStateUpdate, sendScreenshotUpdate } from './message-protocol.js';
import { generateReport } from './report-generator.js';
import { getActiveProvider, migrateLegacySettings } from './provider-registry.js';
import { isSPATransitionPending, clearSPATransition, notifyIfEnabled } from './shared-state.js';
import { getActiveTabId, setActiveTab, getTabContext, getAllTabContexts, openTab, switchToTab, closeTab, closeAllAgentTabs, updateSnapshot, resetAllContexts, findTabByLabel, registerInitialTab, handleTabRemoved, getTabCount } from './tab-context.js';
import { getActiveClient, getRelevantEntries, formatPromptSection, markRunCompleted } from './client-knowledge.js';

// ========== Agent State ==========
let agentRunning = false;
let apiCallCount = 0;
let lastApiCallTime = 0;
let agentMemory = {};           // Extract-and-remember: carries data between pages
let consecutiveFailures = 0;    // Self-healing: tracks failures for strategy shift
let currentStrategies = [];     // Self-healing: remembers tried approaches
let agentPlan = null;           // Planning phase: numbered list of steps
let currentPlanStep = 0;        // Planning phase: which step we're currently on
let agentSpeed = 'normal';      // Speed mode: 'turbo' (0.2x), 'normal' (1x), 'stealth' (2x)
let agentPaused = false;        // Pause/resume: agent loop waits when true
let mfaAckUrl = null;           // (3.7.0) URL where the user last acknowledged MFA — prevents re-pausing on the same challenge
let detectedTenant = null;      // (3.7.0) {tid, onmicrosoft, chipText, hostname} most recently detected on a Microsoft admin URL
let tenantOverrideUrls = new Set(); // (3.11.0) URLs where the tech has explicitly approved a cross-tenant action this run
let runLogId = null;            // (3.9.0) per-run UUID; keys runLog entries in storage
let runLogBuffer = [];          // (3.9.0) in-memory log buffer flushed to storage every step
let agentTabGroupId = null;     // (3.7.2) chrome.tabGroups id grouping every attached tab — visual "glow" in the tab bar
let productiveSteps = 0;        // (3.8.0) dynamic step-limit driver — every successful extract/note/finish-blocker bumps this so productive runs get more oxygen
const agentAttachedTabs = new Set(); // (3.7.2) tabIds currently in the Sentinel group; used by the side-panel visibility hook
let expectedTenant = null;      // (3.7.0) chrome.storage.local.expectedTenant — the user's intended tenant for this run
let activeClientId = null;      // (3.12.0) currently-selected client (sentinelClientKnowledge.activeClientId)
let clientKnowledgeText = '';   // (3.12.0) pre-formatted system-prompt section listing relevant entries
let clientKnowledgeUsedIds = []; // (3.12.0) ids of entries injected into this run; useCount bumps at run end
let pendingVerification = null; // (3.12.0) {type,description,attemptedAt} of the last MODIFYING_ACTIONS step; consumed by next observation cycle to force explicit "did this work?" check

// Expose agentRunning for index.js
export { agentRunning };

/** Compatibility accessor -- returns the current active tab ID from tab-context. */
export function getAgentTabId() { return getActiveTabId(); }

// ========== Tab URL Change Tracking (#29) ==========
// React to user-driven (or page-driven) URL changes inside tracked tabs:
// keep the tracked TabContext.url current and invalidate stale screenshot caches.
try {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo /*, tab */) => {
      if (!changeInfo || !changeInfo.url) return;
      const ctx = getTabContext(tabId);
      if (!ctx) return;
      ctx.url = changeInfo.url;
      // Invalidate screenshot cache — page changed, old image is stale.
      if (ctx.screenshotCache) {
        ctx.screenshotCache.cachedSnapshot = null;
        ctx.screenshotCache.cachedBase64Image = null;
        ctx.screenshotCache.lastScreenshotUrl = null;
      }
    });
  }
} catch (e) { /* non-fatal: chrome API may be unavailable in some contexts */ }

// ========== Service Worker Persistence Checkpoint (#16, lite) ==========
// Module-level snapshot of the most recent loop state so onSuspend can flush it.
// Resume is intentionally NOT implemented yet — this only persists the state.
let _lastCheckpoint = null;
let _lastGoal = '';

function buildCheckpoint(stepCount) {
  return {
    agentRunning,
    currentTabId: getActiveTabId(),
    stepCount,
    lastGoal: _lastGoal,
    agentMemorySnapshot: { ...agentMemory },
    lastUpdate: Date.now(),
  };
}

async function writeCheckpoint(stepCount) {
  try {
    _lastCheckpoint = buildCheckpoint(stepCount);
    if (chrome.storage && chrome.storage.session && chrome.storage.session.set) {
      await chrome.storage.session.set({ agent_checkpoint: _lastCheckpoint });
    }
  } catch (e) { /* non-fatal */ }
}

try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
    chrome.runtime.onSuspend.addListener(() => {
      // Synchronous-ish flush. chrome.storage.session.set returns a promise but
      // onSuspend gives us a brief window; we fire-and-forget with the latest snapshot.
      try {
        const snap = _lastCheckpoint || buildCheckpoint(0);
        if (chrome.storage && chrome.storage.session && chrome.storage.session.set) {
          chrome.storage.session.set({ agent_checkpoint: snap });
        }
      } catch (e) { /* non-fatal */ }
    });
  }
} catch (e) { /* non-fatal */ }

// ========== Configuration ==========
const CONFIG = {
  minDelayBetweenCalls: 2000,
  maxRetries: 3,
  retryDelay: 5000,
  maxRetryDelay: 30000,
  screenshotQuality: 30,
  fetchTimeout: 45000,
  pageLoadTimeout: 25000,
  maxSteps: 100,
  maxPageContentLength: 16000,
  maxElements: 80,
  maxSelectorLength: 200,
  historyWindow: 5,
  screenshotCache: true,
  maxMemoryEntries: 50,
  maxHistoryEntries: 40,
  maxStoredHistory: 20,
  maxLearnedPatterns: 100,
  strategyShiftThreshold: 3,
  stallConfig: {
    similarityWindow: 3,        // Look at last N actions for repeated identical failures
    maxConsecutiveFailures: 5,  // Hard limit: force recovery after this many total failures
    stateRecheckSteps: 3,       // After N same-result steps, force re-scan
  },
};

// ========== State Reset ==========
export function resetAgentState() {
  apiCallCount = 0;
  lastApiCallTime = 0;
  agentMemory = {};
  productiveSteps = 0;
  consecutiveFailures = 0;
  currentStrategies = [];
  agentPlan = null;
  currentPlanStep = 0;
  resetAllContexts();
}

// ========== Agent Lifecycle ==========
export async function startAgent(goal, sender) {
  if (agentRunning) throw new Error('Agent already running');

  // Determine which tab to operate on
  let startTabId;
  if (!sender.tab || !sender.tab.id) {
    const tabs = await new Promise(resolve => { chrome.tabs.query({active: true, currentWindow: true}, (t) => resolve(t)); });
    if (tabs && tabs.length > 0) {
      startTabId = tabs[0].id;
    } else {
      throw new Error('No active tab found');
    }
  } else {
    startTabId = sender.tab.id;
  }

  agentRunning = true;
  resetAgentState();

  // Load speed mode from settings
  try {
    const speedSettings = await chrome.storage.local.get(['agentSpeedMode']);
    agentSpeed = speedSettings.agentSpeedMode || 'normal';
  } catch (e) { agentSpeed = 'normal'; }

  // Register the starting tab in the tab context map
  const tabInfo = await getTabInfo(startTabId);
  registerInitialTab(startTabId, tabInfo?.url || '');

  // (3.12.0) Load client knowledge for the active client. Format relevant
  // entries as a prompt section that gets injected into every step's
  // system prompt via agentState.clientKnowledgeText.
  try {
    const activeClient = await getActiveClient();
    if (activeClient && activeClient.id) {
      activeClientId = activeClient.id;
      const startUrl = tabInfo?.url || '';
      const relevantEntries = await getRelevantEntries(activeClient.id, startUrl);
      clientKnowledgeUsedIds = relevantEntries.map(e => e.id);
      clientKnowledgeText = await formatPromptSection(activeClient.id, startUrl);
    } else {
      activeClientId = null;
      clientKnowledgeText = '';
      clientKnowledgeUsedIds = [];
    }
  } catch (e) {
    activeClientId = null;
    clientKnowledgeText = '';
    clientKnowledgeUsedIds = [];
  }

  // (3.9.0) Forensic run log — start a fresh buffer with a UUID. Persisted
  // every step to chrome.storage.local.run_logs[runLogId] for export.
  try {
    runLogId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : ('run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
    runLogBuffer = [{
      step: 0,
      timestamp: new Date().toISOString(),
      kind: 'run_start',
      goal: goal,
      tenant: null,
      url: tabInfo?.url || ''
    }];
  } catch (e) { runLogId = null; runLogBuffer = []; }

  // (3.7.2) Visually attach the working tab to the orange "Sentinel" group.
  // Subsequent open_tab handlers add their tabs to the same group.
  try { await attachTabToSentinelGroup(startTabId); } catch (e) { /* non-fatal */ }

  runAgentLoop(goal, startTabId);
  return 'Agent started in background';
}

export async function stopAgent() {
  agentRunning = false;
  agentPaused = false;
  // Release any CDP attachments held by the screenshot pipeline.
  try { await detachAllDebuggees(); } catch (e) { /* non-fatal */ }
  // (3.7.2) Dissolve the visual tab group + reset side-panel availability.
  try { await detachAllSentinelTabs(); } catch (e) { /* non-fatal */ }
  await closeAllAgentTabs();
  return 'Agent stopped';
}

export async function pauseAgent() {
  if (!agentRunning) return 'Agent not running';
  agentPaused = true;
  return 'Agent paused';
}

export async function resumeAgent() {
  if (!agentRunning) return 'Agent not running';
  agentPaused = false;
  return 'Agent resumed';
}

export function setAgentSpeed(mode) {
  if (!['turbo', 'normal', 'stealth'].includes(mode)) return 'Invalid speed mode. Use: turbo, normal, stealth';
  agentSpeed = mode;
  chrome.storage.local.set({ agentSpeedMode: mode }).catch(() => {});
  return 'Speed set to ' + mode;
}

// ========== Rolling History Summarization (3.8.2) ==========
// Long runs (200+ steps) bloat the LLM prompt with historical action data.
// When history exceeds 30 entries, condense the oldest 15 into a single
// SUMMARY entry so the prompt stays bounded. The summary preserves what
// matters for the agent's decision-making: per-portal step counts, key
// extractions, navigations, and any failure clusters.

const HISTORY_SUMMARIZE_THRESHOLD = 30;
const HISTORY_SUMMARIZE_BATCH = 15;

function summarizeHistoryBatch(batch) {
  if (!batch || batch.length === 0) return null;
  const counts = {};
  const navUrls = [];
  const extractedKeys = [];
  const failures = [];
  const notes = [];
  for (const h of batch) {
    if (!h || !h.action) continue;
    const t = h.action.type;
    counts[t] = (counts[t] || 0) + 1;
    if (t === 'navigate' && h.action.url) navUrls.push(h.action.url.substring(0, 100));
    if ((t === 'extract' || t === 'extract_list') && h.action.key) extractedKeys.push(h.action.key);
    if (t === 'execute_js' && h.action.key) extractedKeys.push(h.action.key);
    if (t === 'note' && h.action.text) notes.push(h.action.text.substring(0, 200));
    const r = (h && typeof h.result === 'string') ? h.result : '';
    if (/error|fail|not found|blocked|timed out/i.test(r)) failures.push(t + ': ' + r.substring(0, 120));
  }
  const summaryParts = [];
  summaryParts.push('Action counts: ' + Object.entries(counts).map(([k, v]) => k + '×' + v).join(', '));
  if (navUrls.length) summaryParts.push('Navigated to: ' + Array.from(new Set(navUrls)).slice(0, 5).join(' | '));
  if (extractedKeys.length) summaryParts.push('Memory keys saved: ' + Array.from(new Set(extractedKeys)).slice(0, 8).join(', '));
  if (notes.length) summaryParts.push('Notes recorded: ' + notes.slice(0, 3).join(' || '));
  if (failures.length) summaryParts.push('Failures: ' + failures.slice(0, 3).join(' || '));
  return {
    step: batch[0].step + '-' + batch[batch.length - 1].step,
    action: { type: 'history_summary' },
    result: '[ROLLED-UP SUMMARY of steps ' + batch[0].step + '-' + batch[batch.length - 1].step + '] ' + summaryParts.join(' • ')
  };
}

function maybeRollupHistory(history) {
  if (history.length <= HISTORY_SUMMARIZE_THRESHOLD) return;
  // Already-summarized batches stay at the front (their action.type === 'history_summary')
  // and we don't re-summarize them. Find the first non-summary entry to
  // determine whether we need to roll up.
  const firstNonSummary = history.findIndex(h => !h.action || h.action.type !== 'history_summary');
  if (firstNonSummary < 0) return;
  const detailed = history.slice(firstNonSummary);
  if (detailed.length <= HISTORY_SUMMARIZE_THRESHOLD) return;
  const oldest = detailed.slice(0, HISTORY_SUMMARIZE_BATCH);
  const summary = summarizeHistoryBatch(oldest);
  if (!summary) return;
  // Splice: replace the oldest batch with the summary entry.
  history.splice(firstNonSummary, HISTORY_SUMMARIZE_BATCH, summary);
}

// ========== Periodic Progress Updates (3.8.2) ==========
// Every PROGRESS_UPDATE_INTERVAL steps during a long run, post a chat
// message summarizing portals visited and data points collected so the
// user sees forward motion instead of just a step counter.
const PROGRESS_UPDATE_INTERVAL = 25;

function maybePostProgressUpdate(stepCount, history, agentMemory) {
  if (stepCount === 0 || stepCount % PROGRESS_UPDATE_INTERVAL !== 0) return;
  try {
    const portalsSeen = new Set();
    for (const h of history) {
      if (!h || !h.action) continue;
      const url = (h.action && h.action.url) || '';
      if (/entra/i.test(url)) portalsSeen.add('Entra');
      else if (/admin\.exchange/i.test(url)) portalsSeen.add('Exchange');
      else if (/purview/i.test(url)) portalsSeen.add('Purview');
      else if (/admin\.microsoft/i.test(url)) portalsSeen.add('M365 Admin');
      else if (/onedrive|sharepoint/i.test(url)) portalsSeen.add('OneDrive/SharePoint');
      else if (/teams/i.test(url)) portalsSeen.add('Teams');
      else if (/intune|endpoint\.microsoft/i.test(url)) portalsSeen.add('Intune');
      else if (/defender|security\.microsoft/i.test(url)) portalsSeen.add('Defender');
      else if (/sentinelone/i.test(url)) portalsSeen.add('SentinelOne');
      else if (/virustotal/i.test(url)) portalsSeen.add('VirusTotal');
    }
    const memCount = Object.keys(agentMemory || {}).length;
    const lines = [
      '📊 PROGRESS UPDATE — step ' + stepCount,
      'Portals visited: ' + (portalsSeen.size > 0 ? Array.from(portalsSeen).join(', ') : '(none yet)'),
      'Data points in memory: ' + memCount,
      'Recent action: ' + (history.length > 0 ? (history[history.length - 1].action.type) : '(none)')
    ];
    sendSilentUpdate(lines.join(' | '), stepCount);
  } catch (e) { /* non-fatal */ }
}

// ========== Stall Detection ==========
function detectStall(history, consecutiveFailures, currentStrategies) {
  const recent = history.slice(-CONFIG.stallConfig.similarityWindow);

  // Check 1: All recent actions are the same type with the same failure result
  if (recent.length >= CONFIG.stallConfig.similarityWindow) {
    const allSameType = recent.every(h => h.action.type === recent[0].action.type);
    const allSameResult = recent.every(h => h.result === recent[0].result);
    const allFailed = recent.every(h =>
      h.result.includes('not found') ||
      h.result.startsWith('Error') ||
      h.result.includes('timed out') ||
      h.result.includes('Element not found') ||
      h.result.includes('No element')
    );

    if (allSameType && allSameResult && allFailed) {
      return {
        stalled: true,
        reason: `Repeated "${recent[0].action.type}" with same failure: "${recent[0].result}"`,
        recoveryAction: 'RESCAN_AND_REPLAN'
      };
    }
  }

  // Check 2: High consecutive failures regardless of action type
  if (consecutiveFailures >= CONFIG.stallConfig.maxConsecutiveFailures) {
    return {
      stalled: true,
      reason: `${consecutiveFailures} consecutive failures without progress`,
      recoveryAction: 'FORCE_STRATEGY_SHIFT'
    };
  }

  return { stalled: false };
}


// ========== Tab Group Attachment (3.7.2) ==========
// Visually link every tab the agent operates on into an orange "Sentinel"
// tab group, so the user sees a clear glowing strip above attached tabs in
// the Chrome tab bar. Pairs with per-tab sidePanel.setOptions to hide the
// side panel when the user clicks unrelated tabs.

const SENTINEL_GROUP_TITLE = 'Sentinel';
const SENTINEL_GROUP_COLOR = 'orange';

async function attachTabToSentinelGroup(tabId) {
  if (!tabId || typeof tabId !== 'number') return;
  if (agentAttachedTabs.has(tabId)) return; // already attached
  try {
    if (agentTabGroupId === null) {
      // No group yet — create one containing just this tab.
      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      agentTabGroupId = groupId;
      try {
        await chrome.tabGroups.update(groupId, {
          title: SENTINEL_GROUP_TITLE,
          color: SENTINEL_GROUP_COLOR,
          collapsed: false
        });
      } catch (e) { /* tabGroups permission may be missing; non-fatal */ }
    } else {
      // Add to the existing group. tabs.group with groupId moves them in.
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: agentTabGroupId });
      } catch (e) {
        // Group may have been dissolved by the user — recreate.
        const groupId = await chrome.tabs.group({ tabIds: [tabId] });
        agentTabGroupId = groupId;
        try {
          await chrome.tabGroups.update(groupId, {
            title: SENTINEL_GROUP_TITLE,
            color: SENTINEL_GROUP_COLOR,
            collapsed: false
          });
        } catch (e2) {}
      }
    }
    agentAttachedTabs.add(tabId);
    // Ensure side panel is enabled on this attached tab.
    try {
      await chrome.sidePanel.setOptions({ tabId, enabled: true, path: 'popup.html' });
    } catch (e) {}
  } catch (e) {
    console.warn('[Sentinel] attachTabToSentinelGroup failed:', e && e.message);
  }
}

async function detachAllSentinelTabs() {
  // Ungroup every attached tab. Safe even if some are already gone.
  const ids = Array.from(agentAttachedTabs);
  agentAttachedTabs.clear();
  agentTabGroupId = null;
  if (ids.length === 0) return;
  try {
    await chrome.tabs.ungroup(ids);
  } catch (e) {
    // Some tabs may have been closed already; try one-by-one as a fallback.
    for (const id of ids) {
      try { await chrome.tabs.ungroup([id]); } catch (e2) {}
    }
  }
  // Re-enable the side panel everywhere so non-agent tabs aren't permanently muted.
  try {
    await chrome.sidePanel.setOptions({ enabled: true, path: 'popup.html' });
  } catch (e) {}
}

// Public accessor so background/index.js can decide side-panel visibility on
// tab-activation events without importing the full Set.
export function isAgentAttachedTab(tabId) {
  return agentAttachedTabs.has(tabId);
}

export function getAttachedTabIds() {
  return Array.from(agentAttachedTabs);
}

// ========== Configuration Verification Gate (3.7.0) ==========
// Prevents the agent from declaring "done" on a configuration-change task
// (firewall rule add, M365 permission grant, RMM script deploy, etc.) before
// it has actually clicked Save/Apply/Commit AND verified the change is
// reflected on the page. Stops false-positive completions cold — the most
// common reason a ticket gets reopened.

const CHANGE_VERBS_RE = /\b(add|create|delete|modify|update|enable|disable|block|allow|configure|grant|revoke|assign|remove|change|deploy|push)\b/i;
const COMMIT_TARGET_RE = /\b(apply|save|commit|deploy|accept|update|create|delete|publish|submit|confirm|ok)\b/i;
const CONFIG_PLATFORM_RE = /(sonicwall|sonicos|fortinet|fortigate|cisco|paloalto|pan-os|panorama|admin\.microsoft|admin\.exchange|entra\.microsoft|portal\.azure|connectwise|ninjaone|ninja\.io|ninjarmm|datto|autotask|itglue|it-glue|huntress|screenconnect)/i;

function isConfigChangeGoal(goal, currentUrl) {
  const text = String(goal || '');
  const url  = String(currentUrl || '');
  return CHANGE_VERBS_RE.test(text) && (CONFIG_PLATFORM_RE.test(url) || CONFIG_PLATFORM_RE.test(text));
}

function hasRecentCommitClick(history) {
  // Look at last 12 entries for a click whose target text or result mentions
  // commit-style verbs. Tolerate both selector-based and click_at clicks.
  const lookback = history.slice(-12);
  for (const h of lookback) {
    if (!h || !h.action) continue;
    const t = h.action.type;
    if (t !== 'click' && t !== 'click_at') continue;
    const probe = [
      h.action.text || '',
      h.action.selector || '',
      h.action.ref || '',
      h.action.description || '',
      typeof h.result === 'string' ? h.result : ''
    ].join(' ').toLowerCase();
    if (COMMIT_TARGET_RE.test(probe)) return true;
  }
  return false;
}

function hasPostCommitVerification(history) {
  // After the most recent commit click, did a read_page / extract / extract_list / note run?
  // We require ordering: commit FIRST, verification AFTER.
  const lookback = history.slice(-12);
  let sawCommit = false;
  for (const h of lookback) {
    if (!h || !h.action) continue;
    const t = h.action.type;
    if (!sawCommit) {
      if (t === 'click' || t === 'click_at') {
        const probe = [
          h.action.text || '',
          h.action.selector || '',
          h.action.ref || '',
          typeof h.result === 'string' ? h.result : ''
        ].join(' ').toLowerCase();
        if (COMMIT_TARGET_RE.test(probe)) sawCommit = true;
      }
    } else {
      if (['read_page', 'extract', 'extract_list', 'note'].includes(t)) return true;
    }
  }
  return false;
}

// ========== Ticket FINAL_NOTES Auto-Formatter (3.8.0) ==========
// Post-processes the agent's finish summary into Brandon's preferred ticket
// FINAL_NOTES format when the goal is recognized as a ticket investigation.
// The format (per user prefs):
//   Action Taken: [1-2 sentences]
//   Contact Attempt Details: [method/time]
//   Next Step and Time: [follow-up time or "None required. Ticket closed."]
//   Ownership Statement: [technician name + resolution confirmation]
//
// Technician details are pulled from chrome.storage.local.technicianInfo
// with sensible defaults that match the user's preferences.

const TICKET_GOAL_RE = /\b(ticket|incident|alert|investigat|threat\s+hunt|malware|sentinelone|connectwise|kaseya)\b|#\d{3,}/i;

function isTicketInvestigationGoal(goal) {
  if (!goal || typeof goal !== 'string') return false;
  return TICKET_GOAL_RE.test(goal);
}

async function getTechnicianInfo() {
  const defaults = {
    name: 'Brandon Goolsby',
    title: 'IT Support Technician',
    company: 'Premier Networx',
    phone: '706-426-6313',
    email: 'support@augustaitguys.com'
  };
  try {
    const stored = await chrome.storage.local.get(['technicianInfo']);
    if (stored && stored.technicianInfo && typeof stored.technicianInfo === 'object') {
      return { ...defaults, ...stored.technicianInfo };
    }
  } catch (e) {}
  return defaults;
}

// Best-effort ticket-number extraction: matches "ticket #NNN", "ticket NNN",
// "incident #NNN", or a leading "#NNN" pattern.
function extractTicketNumber(goal) {
  if (!goal) return '';
  const m = goal.match(/(?:ticket|incident|alert)[#\s:]*(\d{3,8})/i)
         || goal.match(/#(\d{3,8})/);
  return m ? m[1] : '';
}

function formatTicketFinalNotes(summary, goal, tech, options) {
  const ticketNum = extractTicketNumber(goal);
  const opts = options || {};
  const stepCount = opts.stepCount || 0;
  const apiCallCount = opts.apiCallCount || 0;
  const now = new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  // Default to "ticket-resolved" framing. If the agent indicates partial
  // results (step-limit / extraction failure), shift to "waiting" framing.
  const partial = /step limit|extraction.*fail|not yet|incomplete|manually search/i.test(summary || '');

  // Action Taken: take the first 2 sentences from the summary (or up to 240 chars).
  let actionTaken = (summary || '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').trim();
  if (!actionTaken) actionTaken = 'Investigation completed via Sentinel Override agent.';
  if (actionTaken.length > 240) actionTaken = actionTaken.slice(0, 237) + '...';

  const nextStep = partial
    ? 'Manual review required — see investigation findings below. Recommend follow-up within 1 business day.'
    : 'None required. Ticket closed pending client confirmation.';

  const ownership = `${tech.name} (${tech.title}, ${tech.company}) — ${partial ? 'investigation in progress' : 'investigation completed and findings documented'}.`;

  let header = '';
  if (ticketNum) header = `**Ticket #${ticketNum}** — `;
  header += partial ? 'Investigation Notes (partial)' : 'Final Notes';

  // Build the formatted block.
  const block = [
    '## ' + header,
    '',
    '**Action Taken:**',
    '- ' + actionTaken,
    '',
    '**Contact Attempt Details:**',
    '- Automated investigation via Sentinel Override agent at ' + stamp + ' (' + stepCount + ' steps, ' + apiCallCount + ' AI calls).',
    '',
    '**Next Step and Time:**',
    '- ' + nextStep,
    '',
    '**Ownership Statement:**',
    '- ' + ownership,
    '',
    '---',
    '',
    '### Full investigation findings',
    '',
    summary || '(no summary)',
    '',
    '---',
    '',
    '_' + tech.name + ' · ' + tech.title + ' · ' + tech.company + '_',
    '_Phone: ' + tech.phone + ' · Email: ' + tech.email + '_'
  ].join('\n');

  return block;
}

// ========== Tenant Lockdown (3.11.0) ==========
// Hard-blocks modifying actions on Microsoft admin URLs when the detected
// tenant does not match the user's expectedTenant setting. Forces a separate
// "cross-tenant override" approval card before dispatching. Logs the override
// event to the forensic run log so HR/compliance reviews have a timestamped
// record of intentional cross-tenant work.

const TENANT_LOCKED_HOSTS_RE = /(microsoft\.com|microsoftonline\.com|azure\.com|office\.com|sharepoint\.com)$/i;
const MODIFYING_ACTIONS = new Set(['click', 'click_at', 'type', 'select', 'check', 'check_all', 'press_key', 'upload_file']);

function _hostnameOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

function _tenantsMatch(detected, expected) {
  if (!expected || !expected.trim()) return true;  // no expected = no lock
  if (!detected) return false;  // we have an expectation but nothing detected yet → block
  const exp = expected.trim().toLowerCase();
  const signals = [detected.chipText || '', detected.onmicrosoft || '', detected.tid || ''].map(s => String(s).toLowerCase());
  return signals.some(s => s && (s.includes(exp) || exp.includes(s)));
}

function shouldLockoutCrossTenantAction(command, currentUrl, detectedTenant, expectedTenant) {
  if (!command || !MODIFYING_ACTIONS.has(command.type)) return null;
  if (!expectedTenant || !expectedTenant.trim()) return null;  // no expected tenant set = no lock
  const host = _hostnameOf(currentUrl);
  if (!host || !TENANT_LOCKED_HOSTS_RE.test(host)) return null;
  if (_tenantsMatch(detectedTenant, expectedTenant)) return null;
  if (tenantOverrideUrls.has(currentUrl)) return null;  // already overridden this URL
  return {
    expected: expectedTenant,
    detected: detectedTenant
      ? (detectedTenant.chipText || detectedTenant.onmicrosoft || detectedTenant.tid || 'unknown')
      : '(none detected)',
    host,
    actionType: command.type
  };
}

async function requestTenantOverride(blockInfo, command, stepNumber) {
  const requestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'tenant-override-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'request_tenant_override',
      payload: {
        expected: blockInfo.expected,
        detected: blockInfo.detected,
        host: blockInfo.host,
        actionType: blockInfo.actionType,
        actionDescription: describeAction(command),
        stepNumber,
        requestId
      },
      requestId
    }).catch(() => {});
    const listener = (message) => {
      if (message && message.action === 'tenant_override_response' && message.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        resolve({
          approved: message.approved === true,
          rejected: message.rejected === true
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    // Fail-closed: 90s timeout = reject (never silently approve cross-tenant work)
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ approved: false, rejected: true, reason: 'tenant_override_timeout' });
    }, 90000);
  });
}

// ========== Hallucination Hard-Stop (3.9.1) ==========
// Counts distinct "claim items" in a finish summary vs the actual evidence
// sources the agent collected (memory keys + note actions). When the claim
// density wildly outstrips evidence AND there are no "headline only / not
// read in this run" caveats, blocks the finish and forces the LLM to either
// trim the summary or tag unverified items explicitly.

const _UNVERIFIED_CAVEATS = /\b(headline only|not read in this run|not actually read|not yet read|could not (?:read|extract|verify)|unverified|extraction failed|skipped reading|did not read|not visited|not opened|listed by headline|based on headline)\b/i;

function _countSummaryClaims(summary) {
  if (!summary || typeof summary !== 'string') return 0;
  // Numbered list entries: "1. ", "2. ", etc., or "1) ", "## 1." style.
  const numbered = (summary.match(/^\s*(?:#+\s*)?\d+[.)]\s/gm) || []).length;
  // Markdown table rows (excluding header + separator)
  const tableRows = Math.max(0, (summary.match(/^\|[^\n]+\|\s*$/gm) || []).length - 2);
  // Top-level bullets
  const bullets = (summary.match(/^\s*[-*]\s/gm) || []).length;
  // Use the densest grouping signal as the claim count.
  return Math.max(numbered, tableRows, bullets);
}

function _countEvidenceSources(agentMemory, history) {
  let count = 0;
  try {
    count += Object.keys(agentMemory || {}).length;
    if (Array.isArray(history)) {
      count += history.filter(h => h && h.action && h.action.type === 'note').length;
    }
  } catch (e) {}
  return count;
}

// (3.10.0) Patterns for "specific claims" that should be tagged with [src:*].
const _SPECIFIC_CLAIM_RES = [
  /\b\d[\d,]{3,}\b/g,                       // 1,234 / 110,000 / 271000
  /\b\d+(?:\.\d+)?%/g,                       // 47% / 15.5%
  /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[KMB]|million|billion|thousand)?\b/gi, // $5M / $12,345
  /\b\d{4}-\d{2}-\d{2}\b/g,                 // ISO dates
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\b/g
];
function _countSpecificClaims(summary) {
  if (!summary) return 0;
  let total = 0;
  for (const re of _SPECIFIC_CLAIM_RES) {
    const matches = summary.match(re);
    if (matches) total += matches.length;
  }
  return total;
}
function _countSourceTags(summary) {
  if (!summary) return 0;
  const matches = summary.match(/\[src:[a-z0-9_\-]+\]/gi) || [];
  const unverified = summary.match(/\[unverified\]/gi) || [];
  return matches.length + unverified.length;
}

function evaluateHallucinationRisk(summary, agentMemory, history) {
  const claims = _countSummaryClaims(summary);
  const evidence = _countEvidenceSources(agentMemory, history);
  const hasCaveats = _UNVERIFIED_CAVEATS.test(summary || '');
  const specificClaims = _countSpecificClaims(summary);
  const sourceTags = _countSourceTags(summary);

  // 3+ claims with 0 evidence is a clear fabrication.
  if (claims >= 3 && evidence === 0) {
    return { risky: true, reason: 'Summary lists ' + claims + ' items but no data was extracted to memory or recorded as notes.' };
  }
  // claims > 2x evidence with no caveats is suspicious.
  if (claims >= 4 && evidence > 0 && claims > evidence * 2 && !hasCaveats) {
    return { risky: true, reason: 'Summary lists ' + claims + ' items but only ' + evidence + ' evidence sources (memory keys + notes) and no "headline only / not read" caveats.' };
  }
  // (3.10.0) Lots of specific numeric/date claims with no [src:*] tags
  if (specificClaims >= 5 && sourceTags === 0) {
    return { risky: true, reason: 'Summary contains ' + specificClaims + ' specific claims (numbers, dates, statistics) but no [src:memory_key] citations. Per the SOURCE-CITED OUTPUTS rule, every specific claim must be tagged.' };
  }
  // Specific claims wildly outnumber tags
  if (specificClaims >= 8 && sourceTags > 0 && specificClaims > sourceTags * 3) {
    return { risky: true, reason: 'Summary has ' + specificClaims + ' specific claims but only ' + sourceTags + ' source tags. Tag each specific claim with [src:memory_key] or move it to a Caveats section as [unverified].' };
  }
  return { risky: false, claims, evidence, hasCaveats, specificClaims, sourceTags };
}

// ========== MFA Challenge Detection (3.7.0) ==========
// Many M365 / Entra / firewall login flows fire a step-up auth prompt
// (verification code, push notification, authenticator app). Without this
// detection the agent loops uselessly on the auth page until step-limit.
// We scan freshly read pageText for a panel of known MFA cues; on match,
// pause the agent, fire a desktop notification, and post a chat banner with
// a Resume button. The user resolves the challenge in the page, then clicks
// Resume.

// (3.12.0) Confidence-based MFA detection. The previous flat regex array
// false-positived on retail/checkout pages (coupon code fields, security
// product descriptions, news articles mentioning two-factor). Real MFA
// pages have stacked evidence: auth-provider URL + step-up language +
// short-input field. Match scheme:
//   1. Tier-1 cue alone (specific to MFA flows) -> fire
//   2. Auth-provider URL + ANY tier-2 cue -> fire
//   3. 2+ tier-2 cues on same page -> fire
//   4. Otherwise -> no fire
// Domain exclusion list short-circuits known non-MFA contexts.

const MFA_TIER1_PATTERNS = [
  /approve\s+(?:the\s+|this\s+)?sign.?in\s+request/i,
  /we'?ve\s+sent\s+(?:a\s+|an\s+)?(?:verification\s+)?code\s+to/i,
  /open\s+your\s+authenticator\s+app/i,
  /tap\s+the\s+number\s+you\s+see/i,         // Microsoft number-matching MFA
  /\bduo\s+(?:push|prompt|mobile)\b/i,
  /\bpush\s+(?:notification|approval)\s+sent\b/i,
  /enter\s+the\s+(?:verification\s+|security\s+)?code\s+(?:from|sent\s+to)/i,
  /\bwaiting\s+for\s+approval\b/i,
  /security\s+key\s+(?:plugged\s+in|connected|inserted)/i
];

const MFA_TIER2_PATTERNS = [
  /verify\s+your\s+identity/i,
  /two.?factor\s+(?:authentication|verification)/i,
  /multi.?factor\s+authentication/i,
  /authenticator\s+app/i,
  /one.?time\s+(?:passcode|password|code)/i,
  /\bOTP\b/,
  /6.?digit\s+(?:code|number|verification)/i,
  /check\s+your\s+phone/i,
  /enter\s+(?:the\s+)?verification\s+code/i,
  /verification\s+code\s+(?:was\s+)?sent/i
];

const MFA_AUTH_URL_PATTERNS = [
  /login\.microsoftonline\.com/i,
  /login\.live\.com/i,
  /accounts\.google\.com/i,
  /login\.okta\.com/i,
  /\.okta\.com\/(?:signin|verify|mfa)/i,
  /\.duosecurity\.com/i,
  /sts\.[a-z0-9.-]+\.(com|net|org)/i,
  /\/(?:mfa|2fa|otp|challenge|verify|signin|sign-in)(?:[\/?#]|$)/i,
  /auth\.[a-z0-9.-]+\.(com|net|org)/i
];

// Pages that should NEVER fire MFA, even with weak text cues. Stops
// shopping / news / social sites from tripping the detector.
const MFA_EXCLUDE_DOMAINS = [
  /amazon\.[a-z.]+\/(?:s|gp|dp|product|cart|checkout)/i,
  /ebay\.[a-z.]+\/(?:itm|sch|str)/i,
  /walmart\.com\/(?:ip|search|cart)/i,
  /target\.com\/(?:p|s|c)/i,
  /bestbuy\.com\/(?:site|cart)/i,
  /apple\.com\/shop/i,
  /bhphotovideo\.com\/c/i,
  /newegg\.com\/p/i,
  /github\.com\/[^/]+\/[^/]+(?:\/|$)/i,    // GitHub repos
  /\/blog\//i,
  /\/news\//i,
  /\/article\//i,
  /\/(?:product|products|shop|store|cart|checkout)\//i,
  /(?:youtube|youtu\.be|twitter|x\.com|reddit|linkedin|facebook|instagram|tiktok)\.com/i
];

function detectMfaInText(text, currentUrl) {
  if (!text || typeof text !== 'string') return null;
  const url = (currentUrl || '').toLowerCase();

  // Hard exclude known non-MFA contexts -- protects against shopping /
  // news / social pages with random "verify" or "two-factor" text.
  for (const re of MFA_EXCLUDE_DOMAINS) {
    if (re.test(url)) return null;
  }

  const sample = text.substring(0, 5000);

  // Tier 1: any single match fires.
  for (const re of MFA_TIER1_PATTERNS) {
    const m = sample.match(re);
    if (m) return m[0];
  }

  const isAuthUrl = MFA_AUTH_URL_PATTERNS.some(re => re.test(url));

  // Tier 2: collect matches, decide based on count + URL.
  const tier2Hits = [];
  for (const re of MFA_TIER2_PATTERNS) {
    const m = sample.match(re);
    if (m) tier2Hits.push(m[0]);
  }

  // Auth URL + any tier-2 cue -> fire.
  if (isAuthUrl && tier2Hits.length >= 1) return tier2Hits[0];

  // Multiple tier-2 cues on same page -> fire (covers MFA flows on
  // less-common auth domains).
  if (tier2Hits.length >= 2) return tier2Hits[0];

  return null;
}

// Legacy alias kept for any external callers expecting the old name.
function _legacyDetectMfaInText(text) {
  // Original flat-regex behavior preserved internally if anything
  // imports the old patterns directly.
  if (!text || typeof text !== 'string') return null;
  const sample = text.substring(0, 5000);
  const ALL_PATTERNS = [...MFA_TIER1_PATTERNS, ...MFA_TIER2_PATTERNS];
  for (const re of ALL_PATTERNS) {
    const m = sample.match(re);
    if (m) return m[0];
  }
  return null;
}

// ========== v3.13.0 Auto-Recovery Helpers ==========
// Engine-side reliability layer. The LLM is good at "what's the next step";
// it's bad at "did my code actually work, and what should I try instead".
// These helpers move retry/recovery decisions OUT of the LLM and INTO the
// engine, which means: fewer wasted steps, fewer hallucinations from
// retry-go-wrong, and the LLM can focus on planning vs. error handling.

/**
 * Detect whether a raw JS-result string is unproductive (empty, error,
 * non-serializable, parsed-but-empty). Used by the retry ladder and by
 * memory hygiene at write time. Single source of truth for "this didn't work".
 */
function _isUnproductiveJsResult(raw) {
  if (raw == null) return true;
  if (typeof raw !== 'string') raw = String(raw);
  if (raw === '' || raw === 'Done') return true;
  if (raw.startsWith('JS Error:')) return true;
  if (raw.startsWith('Code execution timed out')) return true;
  if (raw.startsWith('Execution error')) return true;

  let val = raw;
  if (raw.startsWith('JS Result: ')) val = raw.substring(11);
  const trim = val.trim();

  if (trim.length < 5) return true;
  if (trim === 'undefined' || trim === 'null') return true;
  if (/^\s*\[object\s+\w+\]\s*$/i.test(trim)) return true;

  // Parsed-but-empty check
  try {
    const p = JSON.parse(trim);
    if (p === null) return true;
    if (Array.isArray(p) && p.length === 0) return true;
    if (typeof p === 'object' && Object.keys(p).length === 0) return true;
  } catch (e) { /* not JSON, that's fine */ }

  return false;
}

/**
 * Run a single execute_js attempt via CDP first, falling back to content
 * script if CDP attach is denied (chrome:// pages, devtools, etc.).
 * Returns the raw "JS Result: ..." string or an error string.
 */
async function _runExecuteJsOnce(tabId, code, timeout) {
  // CDP path (preferred -- bypasses page CSP)
  try {
    const cdpResult = await cdpExecuteJs(tabId, code, { timeout });
    if (cdpResult && cdpResult.ok) {
      const valStr = cdpResult.value === undefined || cdpResult.value === null
        ? ''
        : (typeof cdpResult.value === 'object'
            ? JSON.stringify(cdpResult.value).slice(0, 3000)
            : String(cdpResult.value).slice(0, 3000));
      return 'JS Result: ' + valStr;
    } else if (cdpResult && cdpResult.attachDenied) {
      // Fall through to content-script path
    } else if (cdpResult && cdpResult.error) {
      // Fall through too -- content script may succeed where CDP errored
    }
  } catch (e) { /* fall through */ }

  // Content-script path (fallback for chrome:// or CDP-failed sites)
  try {
    const csRes = await sendMessageWithRetry(tabId, {
      action: 'execute_command',
      command: { type: 'execute_js', code, timeout }
    });
    return csRes || 'Done';
  } catch (e) {
    return 'JS Error: ' + (e && e.message ? e.message : String(e));
  }
}

/**
 * Auto-recovery retry ladder for execute_js. Tries the LLM's original code
 * first; if that returns unproductive (empty / null / [object Object] /
 * non-serializable), automatically retries with progressively more
 * conservative strategies. The LLM is NEVER asked to choose between these --
 * the engine handles it mechanically.
 *
 * Strategies (in order):
 *   1. original   -- LLM's intended code
 *   2. body_text  -- document.body.innerText (covers null-query and
 *                    selector-miss cases; LLM can parse text in finish)
 *   3. visible    -- aggregated innerText from all common visible
 *                    elements (covers SPA pages where body.innerText
 *                    misses lazy-rendered children)
 *
 * Returns { raw, strategy }. raw is the same shape the rest of the
 * pipeline expects; strategy is for logging / forensic run log.
 */
async function _runExecuteJsWithRetryLadder(tabId, originalCode, timeout) {
  // Strategy 1: LLM's original code
  let raw = await _runExecuteJsOnce(tabId, originalCode || '', timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'original' };
  }

  // Strategy 2: body.innerText fallback (covers most LLM-extraction failures)
  const FB_BODY_TEXT = 'return (document.body && document.body.innerText) ? document.body.innerText.substring(0, 8000) : "";';
  raw = await _runExecuteJsOnce(tabId, FB_BODY_TEXT, timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'body_text_fallback' };
  }

  // Strategy 3: aggregate visible-element text (SPA-heavy sites where
  // body.innerText returns just the loading state)
  const FB_VISIBLE = "return Array.from(document.querySelectorAll('h1,h2,h3,h4,p,td,li,a,span,div')).map(e => (e.innerText || '').trim()).filter(t => t && t.length > 3).slice(0, 300).join('\\n').substring(0, 8000);";
  raw = await _runExecuteJsOnce(tabId, FB_VISIBLE, timeout);
  if (!_isUnproductiveJsResult(raw)) {
    return { raw, strategy: 'visible_text_fallback' };
  }

  return { raw, strategy: 'all_failed' };
}

/**
 * Memory-hygiene gate: should this candidate value be written to agentMemory?
 * Returns { ok: bool, reason: string }. Reasons help debug / log why a write
 * was rejected. Run BEFORE writing -- prevents garbage from polluting future
 * prompts and the report-generator's memory summary.
 */
function _shouldAcceptMemoryWrite(key, candidateValue, agentMemory) {
  if (!key || typeof key !== 'string') return { ok: false, reason: 'empty key' };
  if (candidateValue == null) return { ok: false, reason: 'null/undefined value' };

  const valStr = typeof candidateValue === 'string'
    ? candidateValue
    : (Array.isArray(candidateValue) || typeof candidateValue === 'object'
        ? JSON.stringify(candidateValue)
        : String(candidateValue));

  if (valStr.length < 10) return { ok: false, reason: 'value too short' };

  // Reject error-shaped strings
  if (/^(JS Error|Execution error|Code execution timed out|Element not found|JS execution failed)/i.test(valStr.trim())) {
    return { ok: false, reason: 'error-shaped value' };
  }

  // Reject [object Foo] strings
  if (/^\s*\[object\s+\w+\]\s*$/i.test(valStr.trim())) {
    return { ok: false, reason: 'non-serialized object' };
  }

  // Reject duplicates -- if an existing memory key has the EXACT same value,
  // overwriting it is meaningless and clutters the prompt.
  for (const existingKey of Object.keys(agentMemory || {})) {
    if (existingKey === key) continue;
    const ev = agentMemory[existingKey];
    const evStr = typeof ev === 'string' ? ev : JSON.stringify(ev);
    if (evStr === valStr) {
      return { ok: false, reason: 'duplicates existing key ' + existingKey };
    }
  }

  return { ok: true, reason: '' };
}

/**
 * (3.13.0) Pre-finish data-completeness check. Parse the goal text for
 * data fields the user asked for ("extract X, Y, Z for each item"), then
 * verify memory has plausible data for each. Returns null if everything's
 * present, or a string describing the gap so we can block the finish and
 * push the LLM to extract the missing piece.
 *
 * Heuristic, not authoritative -- false positives only delay finish by
 * one step, which is cheap. False negatives let a sparse report through,
 * which is the existing v3.10 hallucination gate's job. This adds a
 * complementary "did you actually get what was asked for" pass.
 */
function _checkPreFinishCompleteness(goal, agentMemory, history) {
  if (!goal || typeof goal !== 'string') return null;
  if (!agentMemory || typeof agentMemory !== 'object') return null;

  const goalLower = goal.toLowerCase();
  const memorySerialized = JSON.stringify(agentMemory).toLowerCase();
  const noteText = history
    .filter(h => h && h.action && h.action.type === 'note' && h.action.text)
    .map(h => h.action.text.toLowerCase())
    .join(' ');
  const allEvidence = memorySerialized + ' ' + noteText;

  // Patterns we care about: "extract X" / "give me X" / "find X" + commas
  // For each: the CVE ID, CVSS v3 base score, affected FortiOS versions, ...
  const fieldListMatch = goal.match(/(?:extract|find|pull|give\s+me|return)[^.]*?:\s*([^.\n]+)/i);
  if (!fieldListMatch) return null;

  const fieldList = fieldListMatch[1];
  // Split on commas / "and" / "&" -- get individual field names
  const rawFields = fieldList.split(/[,]|\s+and\s+|\s+&\s+/i)
    .map(f => f.trim().replace(/^the\s+/i, '').replace(/\.$/, ''))
    .filter(f => f.length > 3 && f.length < 60);

  if (rawFields.length < 2) return null;  // not a structured field list

  // For each requested field, check whether ANY token from it appears in
  // memory or notes. This is a deliberately loose heuristic.
  const missing = [];
  for (const field of rawFields) {
    // Pull "key" tokens from the field name (skip filler words)
    const filler = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'each', 'one', 'sentence', 'summary', 'whether', 'has', 'have', 'been', 'observed', 'in', 'is']);
    const tokens = field.toLowerCase().split(/\s+/).filter(t => t.length > 3 && !filler.has(t));
    if (tokens.length === 0) continue;
    // Match if ANY meaningful token from this field shows up in evidence
    const found = tokens.some(t => allEvidence.includes(t));
    if (!found) missing.push(field);
  }

  if (missing.length === 0) return null;

  // Don't fire on every gap -- only if MORE THAN HALF of asked fields are
  // missing. Otherwise the existing hallucination gate handles it via
  // [unverified] tagging.
  if (missing.length / rawFields.length < 0.5) return null;

  return 'Goal asked for: ' + rawFields.join(', ') + '. Memory is missing token-evidence for: ' + missing.join(', ') + '. Try one more execute_js or extract pass before finishing -- the retry ladder will auto-fall-back to body.innerText if your selectors miss.';
}

/**
 * URL-aware loop detector. Catches "agent did 7 navigates to 7 different
 * pages, none produced a productive memory write". Loop detection that
 * requires repeated EXACT actions is too narrow -- this version says:
 *
 *   "If 3+ of the last 4 actions are the same TYPE, and none of them
 *    resulted in a productive memory write, that is a loop. Force
 *    a strategy shift."
 *
 * Returns { isLoop: bool, type: string, count: number } so the caller can
 * inject a context-specific directive.
 */
function _detectActionTypeLoop(history, agentMemory) {
  if (!Array.isArray(history) || history.length < 4) return { isLoop: false };
  const recent = history.slice(-4);
  const types = recent.map(h => (h && h.action && h.action.type) || '');
  // Most common type in the window
  const counts = {};
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  let dominantType = null, dominantCount = 0;
  for (const t of Object.keys(counts)) {
    if (counts[t] > dominantCount) { dominantType = t; dominantCount = counts[t]; }
  }
  if (dominantCount < 3) return { isLoop: false };

  // Check whether THIS dominant-type window produced any productive memory.
  // A "productive" step is one that wrote a key with a usable value to memory.
  // We can't know which key was written by which step, but we can check:
  // did the memory keys count GROW during this 4-step window? If not, loop.
  // (Imperfect but conservative -- false positives only delay the run a bit.)
  // Implementation: store a memory-key-count snapshot in agent state at each
  // step and compare. For now we use a simpler heuristic: the dominant type
  // is non-modifying AND no new note/extract/execute_js-with-key happened.
  const NON_PRODUCTIVE = new Set(['navigate', 'switch_tab', 'click', 'scroll', 'wait_for_text', 'wait_for_element', 'read_page']);
  if (!NON_PRODUCTIVE.has(dominantType)) return { isLoop: false };

  // Count productive actions in the window
  const recentProductive = recent.filter(h => {
    if (!h || !h.action) return false;
    const t = h.action.type;
    if (t === 'note') return true;
    if (t === 'extract' || t === 'extract_list') return !!h.action.key;
    if (t === 'execute_js') return !!h.action.key;
    return false;
  });
  if (recentProductive.length === 0) {
    return { isLoop: true, type: dominantType, count: dominantCount };
  }

  return { isLoop: false };
}

// ========== Heuristic Plan Generator ==========
// Fallback when LLM-based plan generation fails. Analyzes the goal text
// to produce a basic step-by-step plan without any API calls.

function generateHeuristicPlan(goal, currentUrl) {
  if (!goal) return null;
  const g = goal.toLowerCase();
  const currentHost = (() => { try { return new URL(currentUrl).hostname; } catch { return ''; } })();

  // Detect multi-page research patterns
  const isMultiPage = /\b(top\s+\d|each|every|all|10|5|3)\b.*\b(article|page|site|link|url|result|source)\b/i.test(g)
    || /\b(open|visit|browse|check)\b.*\b(each|and|then)\b/i.test(g)
    || /\b(summar|brief|report)\b.*\b(all|each|every)\b/i.test(g);

  // Extract target URL from goal
  const urlMatch = goal.match(/(?:go to|navigate to|visit|check|open)\s+(https?:\/\/[^\s,]+|[\w.-]+\.(?:com|org|net|io|gov|edu|co)[^\s,]*)/i)
    || goal.match(/(https?:\/\/[^\s]+)/);
  const targetUrl = urlMatch ? urlMatch[1] : null;
  const targetHost = targetUrl ? (() => { try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
  const alreadyThere = targetHost && currentHost.includes(targetHost);

  // Extract search query from goal
  const searchMatch = goal.match(/(?:search|find|look up|google)\s+(?:for\s+)?["']?([^"']{10,80})/i)
    || goal.match(/(?:about|on|regarding)\s+([^,.\n]{10,60})/i);
  const searchQuery = searchMatch ? searchMatch[1].trim() : null;

  // Extract count
  const countMatch = goal.match(/(?:top\s+)?(\d+)/);
  const count = countMatch ? parseInt(countMatch[1]) : 10;

  if (isMultiPage) {
    const steps = [];
    if (targetUrl && !alreadyThere) {
      steps.push(`Navigate to ${targetUrl}`);
    } else if (searchQuery) {
      steps.push(`Search Google for "${searchQuery}"`);
    }
    steps.push(`Use execute_js with key "links" to extract article/result links from the page`);
    steps.push(`Review extracted links and identify the ${count} most relevant ones`);
    for (let i = 1; i <= Math.min(count, 10); i++) {
      steps.push(`Open article ${i} in a new tab, read it, and note a brief summary`);
    }
    steps.push(`Close all article tabs`);
    steps.push(`Finish with a combined summary of all ${count} items`);
    return steps;
  }

  if (targetUrl && !alreadyThere) {
    return [
      `Navigate to ${targetUrl}`,
      'Read the page content',
      'Extract key information using execute_js with key "data"',
      'Finish with a summary of findings'
    ];
  }

  if (searchQuery) {
    return [
      `Search Google for "${searchQuery}"`,
      'Read search results and extract top links',
      'Visit the most relevant result',
      'Read and extract key information',
      'Finish with a summary'
    ];
  }

  // Generic fallback
  return [
    'Read the current page',
    'Extract key information',
    'If needed, navigate to find more data',
    'Finish with a summary'
  ];
}

// ========== Main Agent Loop ==========
async function runAgentLoop(goal, workingTabId) {
  console.log('Agent starting loop for goal:', goal);
  _lastGoal = goal || '';
  let finished = false;
  let history = [];
  let stepCount = 0;
  let reportData = null;  // Snapshot for async report generation
  agentPlan = null;
  currentPlanStep = 0;

  // Migrate legacy settings before any LLM calls
  await migrateLegacySettings();

  const stored = await chrome.storage.local.get(['agent_history', 'agent_context', 'agent_memory', 'expectedTenant']);
  expectedTenant = (stored && typeof stored.expectedTenant === 'string') ? stored.expectedTenant.trim() : null;
  tenantOverrideUrls = new Set();  // (3.11.0) cleared per-run
  detectedTenant = null;
  // Restore agent_memory from prior session. agentMemory is a plain object
  // (see writes at lines ~883/920 which do chrome.storage.local.set({ agent_memory: agentMemory })).
  // Restore in the same shape.
  if (stored.agent_memory && typeof stored.agent_memory === 'object' && !Array.isArray(stored.agent_memory)) {
    try {
      agentMemory = { ...stored.agent_memory };
    } catch (e) {
      agentMemory = {};
    }
  }
  await chrome.storage.local.set({ agent_history: [] });

  if (stored.agent_context && stored.agent_context.trim()) {
    goal = `Previous context: ${stored.agent_context.trim()}\n\nCurrent goal: ${goal}`;
  }

  let consecutiveNavigates = 0;

  // Generate a plan before execution
  sendSilentUpdate('Planning task...');
  const planProviderConfig = await getActiveProvider();
  const planSettings = {
    api_endpoint: planProviderConfig.endpoint,
    api_key: planProviderConfig.apiKey,
    model: planProviderConfig.model
  };

  // Gather context for plan generation
  const currentTabInfo = await getTabInfo(workingTabId);
  const platformCtx = getPlatformContext(
    currentTabInfo?.url || '',
    goal
  );
  const patterns = await getRelevantPatterns(goal);

  agentPlan = await generatePlan(goal, planSettings, {
    currentUrl: currentTabInfo?.url || '',
    pageTitle: currentTabInfo?.title || '',
    platformContext: platformCtx,
    relevantPatterns: patterns
  });
  if (agentPlan) {
    sendSilentUpdate(`📋 Plan ready (${agentPlan.length} steps): ${agentPlan[0]}`);
  } else {
    // Fallback: generate a basic heuristic plan from goal analysis
    agentPlan = generateHeuristicPlan(goal, currentTabInfo?.url || '');
    if (agentPlan) {
      sendSilentUpdate(`📋 Basic plan (${agentPlan.length} steps): ${agentPlan[0]}`);
    } else {
      sendSilentUpdate('Running in direct mode');
    }
  }

  while (!finished && agentRunning) {
    try {
      // Pause check — wait until resumed
      if (agentPaused) {
        sendSilentUpdate('⏸ Agent paused — waiting for resume', stepCount);
        while (agentPaused && agentRunning) await sleep(500);
        if (!agentRunning) break;
        sendSilentUpdate('▶ Agent resumed', stepCount);
      }

      stepCount++;
      // (3.8.2) Dynamic step limit. Baseline = CONFIG.maxSteps (100). Each
      // productive action bumps `productiveSteps` and extends the cap by +25.
      // Hard cap = 300. Multi-portal investigations get a +50 head-start so
      // they don't choke on the first portal.
      let dynamicBaseline = CONFIG.maxSteps;
      try {
        if (typeof goal === 'string' && /\b(entra|exchange|purview|onedrive|sharepoint|teams|intune|defender|sentinelone|connectwise|ninjaone|datto|itglue|huntress|m365|admin\.microsoft|portal\.azure)\b.*\b(entra|exchange|purview|onedrive|sharepoint|teams|intune|defender|sentinelone|connectwise|ninjaone|datto|itglue|huntress|m365|admin\.microsoft|portal\.azure)\b/i.test(goal)) {
          dynamicBaseline = CONFIG.maxSteps + 50;
        }
      } catch (e) {}
      const dynamicMaxSteps = Math.min(300, dynamicBaseline + (productiveSteps * 25));
      if (stepCount > dynamicMaxSteps) {
        sendSilentUpdate(`Reached step limit (${dynamicMaxSteps}, baseline ${CONFIG.maxSteps} + ${productiveSteps} productive bumps). Finishing.`, stepCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: `Reached step limit of ${dynamicMaxSteps}. Task may be incomplete — ${productiveSteps} productive actions extended the run.` }).catch(() => {});
        break;
      }

      // Check for pending SPA transition -- if the page changed under us,
      // re-scan instead of using stale observation data
      if (isSPATransitionPending()) {
        sendSilentUpdate('SPA page transition detected -- re-scanning...', stepCount);
        clearSPATransition();
        // Invalidate screenshot cache for current active tab
        const spaCtx = getTabContext(getActiveTabId());
        if (spaCtx) {
          spaCtx.screenshotCache.cachedSnapshot = null;
          spaCtx.screenshotCache.cachedBase64Image = null;
          spaCtx.screenshotCache.lastScreenshotUrl = null;
        }
        // Don't skip the iteration -- just let the normal observe/scan flow run
        // with fresh data. The continue is NOT used here because we want the
        // normal flow to pick up the new page state.
      }

      let tab = getActiveTabId();
      if (!tab) {
        sendSilentUpdate('No active tab -- stopping', stepCount);
        chrome.runtime.sendMessage({ action: 'agent_finished', summary: 'No active tab. Task interrupted.' }).catch(() => {});
        break;
      }

      // Get tab info
      let tabInfo = await getTabInfo(tab);

      if (!tabInfo) {
        sendSilentUpdate('Agent tab lost. Attempting recovery...', stepCount);
        const allTabs = await new Promise(resolve => { chrome.tabs.query({}, (t) => resolve(t)); });
        const lostTab = allTabs.find(t => t.id === tab);
        if (lostTab) { tabInfo = lostTab; }
        else {
          sendSilentUpdate('Agent tab was closed. Task stopped.', stepCount);
          chrome.runtime.sendMessage({ action: 'agent_finished', summary: 'Agent tab closed. Task interrupted.' }).catch(() => {});
          break;
        }
      }

      // Wait for page load
      if (tabInfo.status !== 'complete') {
        sendSilentUpdate('Waiting for page to load...', stepCount);
        await waitForPageLoad(tab);
        await sleep(500);
      }

      // Redirect internal pages
      if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('edge://') || tabInfo.url.startsWith('about:')) {
        sendSilentUpdate('Internal page -- navigating to Google', stepCount);
        await chrome.tabs.update(tab, { url: 'https://www.google.com' });
        await sleep(3000);
        continue;
      }

      // Auto-navigate to URL found in goal (first iteration only)
      // Smart: checks current page hostname before navigating
      if (stepCount === 1 && goal) {
        const urlMatch = goal.match(/https?:\/\/[^\s"'<>,]+/i) || goal.match(/(?:go to|visit|navigate to|open)\s+(?:the\s+)?(?:site\s+)?([^\s]+?\.(?:com|org|net|io|gov|edu|co|us|uk|de|fr|cn|jp|ru|br|in|ca|au|me|tv|info|biz|dev|app|ai|xyz))/i);
        if (urlMatch) {
          const goalUrl = urlMatch[0].startsWith('http') ? urlMatch[0] : 'https://' + urlMatch[1];
          try {
            const goalHostname = new URL(goalUrl).hostname.toLowerCase();
            const currentHostname = new URL(tabInfo.url).hostname.toLowerCase();
            if (!currentHostname.includes(goalHostname.replace(/^www\./, ''))) {
              sendSilentUpdate('Navigating to: ' + goalUrl, stepCount);
              sendActionMessage({ type: 'navigate', url: goalUrl }, stepCount, null);
              await chrome.tabs.update(tab, { url: goalUrl });
              await waitForPageLoad(tab);
              await sleep(1500);
              const reinjected = await injectContentScript(tab);
              if (reinjected) {
                history.push({ step: stepCount, action: { type: 'navigate', url: goalUrl }, result: 'Navigated to ' + goalUrl });
                await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
              }
              continue;
            }
            // Already on the right page - skip navigation
          } catch (e) { /* URL parse error, skip auto-navigate */ }
        }
      }

      sendSilentUpdate('Observing page...', stepCount);

      // Send page context to popup so user can see where the agent is
      sendPageContext(tabInfo?.url || '', tabInfo?.title || '', stepCount, tab);

      // (3.7.0) Tenant detection on Microsoft admin URLs. We probe via the
      // content script and broadcast the result so the popup chip updates.
      try {
        const _u = (tabInfo && tabInfo.url) || '';
        if (/microsoft\.com|microsoftonline\.com|azure\.com|office\.com/i.test(_u)) {
          const _td = await sendMessageWithRetry(tab, { action: 'detect_tenant' }, 1).catch(() => null);
          if (_td && (_td.tid || _td.onmicrosoft || _td.chipText)) {
            detectedTenant = _td;
            try {
              chrome.runtime.sendMessage({
                action: 'tenant_detected',
                tenant: _td,
                expected: expectedTenant
              }).catch(() => {});
            } catch (e) {}
          }
        }
      } catch (e) { /* non-fatal */ }

      // Send tab state to popup so user can see all managed tabs
      const allTabContexts = getAllTabContexts();
      if (allTabContexts.length > 0) {
        sendTabStateUpdate(allTabContexts);
      }

      // Inject content script
      const scriptReady = await injectContentScript(tab);
      if (!scriptReady) { sendSilentUpdate('Content script failed -- retrying', stepCount); await sleep(2000); continue; }

      // Auto-dismiss popups/overlays (cookie consent, ad-blocker warnings, etc.)
      try {
        const overlayResult = await sendMessageWithRetry(tab, { action: 'dismiss_overlays' });
        if (overlayResult && overlayResult.count > 0) {
          sendSilentUpdate(`Dismissed ${overlayResult.count} overlay(s)`, stepCount);
          await sleep(800); // let overlay close animate
        }
      } catch (e) { /* non-fatal */ }

      // Get page data
      let observation, pageContent;
      try {
        observation = await sendMessageWithRetry(tab, { action: 'observe_page' });
        pageContent = await sendMessageWithRetry(tab, { action: 'read_page' });
      } catch (err) {
        sendSilentUpdate(`Error reading page: ${err.message}`, stepCount);
        await sleep(2000);
        continue;
      }

      // Update snapshot for the current tab
      updateSnapshot(tab, {
        elements: observation?.elements || [],
        pageContent: pageContent?.content || '',
        url: tabInfo?.url || '',
        title: tabInfo?.title || ''
      });

      // Screenshot (CDP with per-tab cache)
      const freshTabInfo = await getTabInfo(tab);
      if (!freshTabInfo) { await sleep(1000); continue; }

      const currentUrl = (freshTabInfo && freshTabInfo.url) || tabInfo.url;

      // Get per-tab screenshot cache
      const tabCtx = getTabContext(tab);
      if (!tabCtx) { await sleep(1000); continue; }
      const screenshotCache = tabCtx.screenshotCache;

      let base64Image = null;
      // (#11) DPR-aware screenshot metadata. Defaults are safe for non-vision
      // models / failed captures and signal "no metadata available".
      let screenshotMeta = null;
      const screenshotProviderConfig = await getActiveProvider();
      const modelForScreenshot = screenshotProviderConfig.model || 'glm-5.1';
      if (supportsVision(modelForScreenshot)) {
        const shotResult = await takeScreenshot(tab, freshTabInfo.windowId, currentUrl, screenshotCache, CONFIG, stepCount, sendSilentUpdate);
        if (shotResult) {
          base64Image = shotResult.base64Image;
          screenshotMeta = {
            width: shotResult.width,
            height: shotResult.height,
            dpr: shotResult.dpr,
            scrollX: shotResult.scrollX,
            scrollY: shotResult.scrollY
          };
          // (3.7.1) Forward to the popup for the live mini-shot panel.
          try { sendScreenshotUpdate(base64Image, stepCount); } catch (e) {}
        }
      }

      // Truncate page content
      let pageText = (pageContent && pageContent.content) || '';
      const effectiveMaxLength = (goal && /PHASE\s+\d|RUNBOOK|INVESTIGATION|checkpoint|TICKET/i.test(goal))
        ? 28000
        : CONFIG.maxPageContentLength;
      if (pageText.length > effectiveMaxLength) {
        pageText = pageText.substring(0, effectiveMaxLength) + '\n\n[... content truncated]';
      }

      // Build capped element list (needed before empty page check)
      const allElements = (observation && observation.elements) ? observation.elements : [];

      // Detect empty page (SPA not rendered, anti-bot, or loading failure)
      const pageIsEmpty = pageText.length < 150 || (pageText.includes('Page Title:') && pageText.length < 300);
      const elementsEmpty = allElements.length < 3;
      if (pageIsEmpty) {
        pageText = '[WARNING: Page content is empty or nearly empty. This site may block automation or use heavy JavaScript rendering. Try execute_js with key to extract data directly, or navigate to a different URL.]\n\n' + pageText;
      }
      const priorityTypes = ['button', 'input', 'select', 'textarea'];
      const priorityEls = allElements.filter(e => priorityTypes.some(t => e.selector && e.selector.toLowerCase().includes(t)));
      const otherEls    = allElements.filter(e => !priorityTypes.some(t => e.selector && e.selector.toLowerCase().includes(t)));
      const trimmedElements = [...priorityEls, ...otherEls]
        .slice(0, CONFIG.maxElements)
        .map(e => ({
          ...e,
          text: e.text && e.text.length > 80 ? e.text.substring(0, 77) + '...' : e.text
        }));

      // (3.7.0) MFA challenge detection. If the freshly observed page text
      // matches a known MFA cue and we haven't already acknowledged this URL,
      // pause the agent, notify the desktop, and post a chat banner. The
      // existing pauseAgent/resumeAgent infra unblocks the loop.
      try {
        const _mfaHit = detectMfaInText(pageText, currentUrl);
        if (_mfaHit && mfaAckUrl !== currentUrl) {
          agentPaused = true;
          sendSilentUpdate('⏸ MFA challenge detected (' + _mfaHit + ') — agent paused', stepCount);
          notifyIfEnabled('mfa_pause_' + Date.now(), {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon-48.png'),
            title: 'Sentinel Override — MFA required',
            message: 'Approve / enter the code on ' + (currentUrl || 'the page') + ', then click Resume.'
          });
          try {
            chrome.runtime.sendMessage({
              action: 'mfa_pause',
              url: currentUrl,
              hint: _mfaHit,
              stepNumber: stepCount
            }).catch(() => {});
          } catch (e) {}
          // Wait until user resumes
          while (agentPaused && agentRunning) await sleep(500);
          if (!agentRunning) break;
          mfaAckUrl = currentUrl;  // suppress re-pause for the SAME page
          sendSilentUpdate('▶ Resumed after MFA', stepCount);
          continue; // re-observe the page now that MFA is presumably handled
        }
      } catch (_e) { /* never crash the loop on detection issues */ }

      // Rate limiting
      await enforceRateLimit();

      // Anti-loop directives: force the model to make progress
      let loopDirective = '';

      // (3.8.0) Tightened read_page loop guard: 2+ consecutive read_page on the
      // same URL is a stall (page hasn't changed; rereading achieves nothing).
      if (history.length >= 2) {
        const last = history[history.length - 1];
        const prior = history[history.length - 2];
        const isReadPage = h => h && h.action && h.action.type === 'read_page';
        if (isReadPage(last) && isReadPage(prior)) {
          loopDirective = '\n⚠ READ_PAGE LOOP DETECTED — Two consecutive read_page actions returned the same content. The page state has not changed. You MUST take a different approach now: use "extract" / "extract_list" with specific selectors, "execute_js" to query the DOM directly, "scroll" to reveal more content, or "click" to interact. Do NOT call read_page again on this same page.\n';
        }
      }

      // 1. Consecutive non-productive actions from end of history
      // (3.13.0) URL-aware loop detection -- catches "agent did 7 navigates
      // to 7 different pages, none extracted anything" pattern that the
      // existing exact-action check misses.
      if (!loopDirective) {
        const typeLoop = _detectActionTypeLoop(history, agentMemory);
        if (typeLoop.isLoop) {
          loopDirective = '\n⚠ ACTION-TYPE LOOP -- ' + typeLoop.count + ' of last 4 actions were "' + typeLoop.type + '" with no productive memory write. The current strategy is not yielding data. You MUST switch action types now:\n1. If you have been navigating, STOP -- run execute_js with a key on the current page to extract whatever data is visible. The retry ladder will fall back to body.innerText automatically.\n2. If you have been clicking, try a different selector or use execute_js to read the DOM directly.\n3. If you have been read_page-ing, switch to extract / extract_list with a key.\n4. If extraction has failed twice on this page, finish() with what you have and move on rather than retrying.\n';
        }
      }

      //    Also check for execute_js-heavy patterns in recent window (model escaping consecutive check)
      if (history.length >= 3 && !loopDirective) {
        const nonProductive = new Set(['read_page', 'execute_js', 'scroll', 'wait_for_text', 'wait_for_element']);
        let consecutiveNonProductive = 0;
        for (let i = history.length - 1; i >= 0; i--) {
          if (nonProductive.has(history[i].action.type)) {
            consecutiveNonProductive++;
          } else {
            break;
          }
        }
        // Also count execute_js in the last 8 steps — if too many without extract/note/finish, it's a loop
        const recentWindow = history.slice(-8);
        const recentJsCount = recentWindow.filter(h => h.action.type === 'execute_js').length;
        const recentExtractCount = recentWindow.filter(h => ['extract', 'extract_list', 'note', 'finish'].includes(h.action.type)).length;
        const jsLoop = recentJsCount >= 4 && recentExtractCount === 0;

        if (consecutiveNonProductive >= 3 || jsLoop) {
          const memCount = Object.keys(agentMemory).length;
          const reason = jsLoop
            ? recentJsCount + ' execute_js calls in last 8 steps with no data saved'
            : consecutiveNonProductive + ' non-productive steps in a row';
          loopDirective = memCount === 0
            ? '\n⚠ LOOP DETECTED -- ' + reason + '. You MUST use "execute_js" with a "key" to save results, or use "note" to record findings. Do NOT run more JS without saving.\n'
            : '\n⚠ LOOP DETECTED -- ' + reason + '. You have ' + memCount + ' items in memory. You MUST use "finish" NOW with a summary of your extracted data.\n';
        }
      }

      // 1b. Empty page detection — page didn't render (SPA, anti-bot, loading failure)
      if ((pageIsEmpty || elementsEmpty) && !loopDirective) {
        const emptyCount = history.slice(-4).filter(h => {
          const r = h.result || '';
          return r.includes('empty') || r.includes('no content') || (r.includes('Page Title:') && r.length < 300);
        }).length;
        if (emptyCount >= 2) {
          loopDirective = '\n⚠ EMPTY PAGE -- The page content has been empty for multiple attempts. This site may block automation or use heavy JavaScript rendering. You MUST try a different approach:\n1. Use "execute_js" with key to extract data directly: return document.body.innerText\n2. Navigate to a simpler URL (e.g., the homepage instead of search results)\n3. Try a different site for the same information\nDo NOT read_page again on this empty page.\n';
        }
      }

      // 2. Step-based soft cap: warn model to finish after 15 steps
      //    But skip the warning if agent is actively making progress (opening tabs, switching tabs)
      const recentTabActions = history.slice(-5).filter(h => ['open_tab', 'switch_tab', 'close_tab'].includes(h.action.type)).length;
      const isMakingProgress = recentTabActions > 0 || Object.keys(agentMemory).length > 0;
      if (stepCount >= 15 && !loopDirective && !isMakingProgress) {
        loopDirective = '\n⚠ STEP LIMIT -- You are on step ' + stepCount + ' with no data extracted and no active tab work. You MUST call "finish" NOW with what you know, or use "execute_js" to extract data. Do not continue reading the same page.\n';
      } else if (stepCount >= 20 && !loopDirective) {
        const memCount = Object.keys(agentMemory).length;
        loopDirective = memCount > 0
          ? '\n⚠ STEP LIMIT -- You are on step ' + stepCount + '. You have ' + memCount + ' extracted items. You MUST call "finish" NOW with a summary. No more reading or extracting.\n'
          : '\n⚠ STEP LIMIT -- You are on step ' + stepCount + '. If you have not found useful data, call "finish" with what you know. Do not continue looping.\n';
      }

      // 3. Step-based soft cap: force a clean finish ~5 steps before the
      //    hard dynamic cap so the agent gets a chance to build a summary
      //    from collected memory instead of just being broken out of.
      const _softCap = Math.max(40, dynamicMaxSteps - 5);
      if (stepCount >= _softCap) {
        const memCount = Object.keys(agentMemory).length;
        const memLines = Object.entries(agentMemory).slice(0, 10).map(([k, v]) => {
          const vStr = Array.isArray(v) ? v.slice(0, 5).map(i => String(i)).join(', ') : String(v).substring(0, 200);
          return '- ' + k + ': ' + vStr;
        }).join('\n');
        const summary = memCount > 0
          ? 'Task completed after ' + stepCount + ' steps with ' + memCount + ' data points extracted:\n\n' + memLines + (Object.keys(agentMemory).length > 10 ? '\n...and ' + (Object.keys(agentMemory).length - 10) + ' more items.' : '')
          : 'Task timed out after ' + stepCount + ' steps without extracting useful data.';
        finished = true;
        sendSilentUpdate('Step limit reached -- finishing', stepCount);
        sendActionResult(stepCount, { type: 'finish', summary }, false);
        history.push({ step: stepCount, action: { type: 'finish', summary }, result: summary });
        chrome.runtime.sendMessage({ action: 'agent_finished', summary }).catch(() => {});
        break;
      }

      // Progress indicator
      let apiWaitSeconds = 0;
      const progressTimer = setInterval(() => {
        apiWaitSeconds += 5;
        sendSilentUpdate(`Consulting AI... (${apiWaitSeconds}s)`, stepCount);
      }, 5000);

      sendSilentUpdate(`Consulting AI -- call #${apiCallCount + 1}`, stepCount);
      let command;
      // (3.9.0) Budget hint — tell the LLM how much step room it has left so
      // it can pace itself. Multi-portal investigations especially benefit
      // from knowing they have 200 vs 50 steps remaining.
      const _stepsRemaining = Math.max(0, dynamicMaxSteps - stepCount);
      const _budgetHint = 'Current step: ' + stepCount + ' of ' + dynamicMaxSteps +
        ' (' + _stepsRemaining + ' remaining; ' + productiveSteps + ' productive bumps so far). ' +
        'Pace your work: extract / note / execute_js with key = productive (extends budget). ' +
        'Aimless read_page / scroll = unproductive (does not extend).';
      const agentState = { apiCallCount, agentMemory, consecutiveFailures, currentStrategies, agentPlan, currentPlanStep, loopDirective, screenshotMeta, budgetHint: _budgetHint, clientKnowledgeText, pendingVerification };
      // Cap history window for prompt to control token cost (CONFIG.historyWindow).
      // Also strip any base64Image / screenshot fields from past entries -- only the
      // most recent observation needs the image (passed separately as base64Image arg).
      const promptHistory = history.slice(-CONFIG.historyWindow).map(h => {
        if (!h || typeof h !== 'object') return h;
        if ('base64Image' in h || 'screenshot' in h || (h.action && (h.action.base64Image || h.action.screenshot))) {
          const cleaned = { ...h };
          delete cleaned.base64Image;
          delete cleaned.screenshot;
          if (cleaned.action && typeof cleaned.action === 'object') {
            const a = { ...cleaned.action };
            delete a.base64Image;
            delete a.screenshot;
            cleaned.action = a;
          }
          return cleaned;
        }
        return h;
      });
      try {
        command = await callLLMWithRetry(
          trimmedElements, allElements.length, pageText, base64Image,
          goal, promptHistory, stepCount, currentUrl,
          0, // retryCount
          CONFIG,
          agentState
        );
      } finally {
        clearInterval(progressTimer);
        base64Image = null; // release screenshot memory after LLM call
      }

      // Sync apiCallCount — callLLM mutates agentState.apiCallCount by reference, but the
      // module-level var is a primitive and doesn't auto-update. Pull it back from the object.
      apiCallCount = agentState.apiCallCount;

      // Advance plan step if the LLM signalled it's done with the current step
      if (command.advance_plan && agentPlan && currentPlanStep < agentPlan.length - 1) {
        currentPlanStep++;
        const nextStep = agentPlan[currentPlanStep];
        const progress = `[${currentPlanStep + 1}/${agentPlan.length}]`;
        sendSilentUpdate(`📋 Step ${progress}: ${nextStep}`);
        delete command.advance_plan;
      }

      // Template substitution: replace ::key:: with memory values
      if (command.text && typeof command.text === 'string') {
        command.text = command.text.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (command.url && typeof command.url === 'string') {
        command.url = command.url.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }
      if (command.value && typeof command.value === 'string') {
        command.value = command.value.replace(/::(\w+)::/g, (_, key) => agentMemory[key] || `::${key}::`);
      }

      // (#10) Sanity-check ref ids the LLM returns. A ref that doesn't appear
      // in the most recent observation almost always means the model invented
      // it (or carried it over from a stale step). We log a warning but DON'T
      // block — the content script handles stale-ref fallback to selector.
      if (command.ref && typeof command.ref === 'string') {
        const refExists = trimmedElements.some(e => e.ref === command.ref);
        if (!refExists) {
          try {
            console.warn('[agent-engine] LLM returned unknown ref "' + command.ref + '" not in latest observation. Content script will fall back to selector if available.');
          } catch (e) {}
        }
      }

      // Validate selectors against the trimmed list. Skip selector validation
      // when the LLM supplied a ref — refs are the preferred handle and the
      // content script resolves them directly. Also accept commands that have
      // ONLY a ref (no selector at all) for the ref-driven actions.
      const refDrivenActions = new Set(['click', 'type', 'hover', 'select', 'check', 'extract', 'extract_list', 'wait_for_element', 'scroll_to']);
      if (refDrivenActions.has(command.type) && command.selector && !command.ref) {
        const selectorExists = trimmedElements.some(e => e.selector === command.selector);
        if (!selectorExists) {
          sendSilentUpdate('Invalid selector -- re-asking AI', stepCount);
          consecutiveFailures++;
          history.push({ step: stepCount, action: command, result: `Invalid selector "${command.selector}" -- not in element list.` });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          await sleep(1000);
          continue;
        }
      }

      // Handle finish — but block premature finishes (model giving up without trying)
      if (command.type === 'finish') {
        // (3.13.0) Pre-finish data completeness check. Parses the goal
        // text for "extract X, Y, Z" patterns and verifies memory has
        // evidence for each field. Blocks finish (once) if MORE THAN HALF
        // of the asked fields lack token-evidence in memory + notes.
        // Saves the "agent finished but CVSS missing" failure mode by
        // forcing one more extraction pass with the retry ladder.
        try {
          const _completenessGap = _checkPreFinishCompleteness(goal, agentMemory, history);
          // Only block ONCE per run -- if the agent retries finish after
          // the block, we let it through (the gap may be genuinely
          // unextractable, like data behind auth).
          const _alreadyBlocked = history.some(h => h && h.result &&
            typeof h.result === 'string' &&
            h.result.startsWith('BLOCKED: pre-finish completeness'));
          if (_completenessGap && !_alreadyBlocked && stepCount < (dynamicMaxSteps - 5)) {
            history.push({ step: stepCount, action: command, result: 'BLOCKED: pre-finish completeness -- ' + _completenessGap });
            if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
            sendSilentUpdate('Finish blocked — completeness check requesting one more extraction pass', stepCount);
            await sleep(800);
            continue;
          }
        } catch (e) { /* completeness check failure is non-fatal */ }

        const memCount = Object.keys(agentMemory).length;
        const noteCount = history.filter(h => h.action.type === 'note').length;
        const hasData = memCount > 0 || noteCount > 0;

        // Block finish if no real data was extracted and we haven't tried enough
        if (!hasData && stepCount < 8) {
          history.push({ step: stepCount, action: command, result: 'BLOCKED: Cannot finish without extracting data first. Read the page or use execute_js to get real data.' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          sendSilentUpdate('Finish blocked — must extract real data first', stepCount);
          await sleep(1000);
          continue;
        }

        // Block finish if memory only contains failed results ("Done", empty strings)
        const hasRealData = memCount > 0 && Object.values(agentMemory).some(v => {
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          return s.length > 10 && s !== 'Done';
        });
        if (!hasRealData && !hasData && stepCount < 15) {
          history.push({ step: stepCount, action: command, result: 'BLOCKED: No real data in memory. Use execute_js with key to extract actual page content.' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          sendSilentUpdate('Finish blocked — extracted data is empty', stepCount);
          await sleep(1000);
          continue;
        }


        // (3.7.0) Configuration-change verification gate. If the goal involves
        // adding/changing config on a known platform (firewall, M365, RMM, etc.),
        // require a Save/Apply/Commit click + a follow-up read_page or extract
        // BEFORE allowing finish. Prevents false-positive completions where the
        // agent declares "done" without actually committing the change.
        try {
          const _gateGoal = (typeof goal === 'string') ? goal : '';
          const _gateUrl  = (typeof currentUrl === 'string') ? currentUrl : '';
          if (isConfigChangeGoal(_gateGoal, _gateUrl)) {
            if (!hasRecentCommitClick(history)) {
              const blockMsg = 'BLOCKED: configuration change detected but no Save/Apply/Commit click in recent history. Find and click the Apply/Save/Commit/Deploy button before finishing.';
              history.push({ step: stepCount, action: command, result: blockMsg });
              if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
              await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
              sendSilentUpdate('Finish blocked — change not yet committed', stepCount);
              await sleep(1000);
              continue;
            }
            if (!hasPostCommitVerification(history)) {
              const blockMsg = 'BLOCKED: change committed but not verified. Re-read the page or extract from the relevant table to confirm the change is active before finishing.';
              history.push({ step: stepCount, action: command, result: blockMsg });
              if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
              await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
              sendSilentUpdate('Finish blocked — change not verified', stepCount);
              await sleep(1000);
              continue;
            }
          }
        } catch (_e) { /* non-fatal: never let the gate itself crash the loop */ }

        // (3.8.3) Don't-give-up-early guard for multi-portal investigations.
        // If the agent calls finish before step 40 with "incomplete" markers
        // in the summary, push back and force it to try alternative strategies
        // (Microsoft Graph API via read_network_requests, alternate URLs,
        // Log Analytics KQL, etc.) before declaring done.
        try {
          const _summary = String(command.summary || '').toLowerCase();
          const _isMultiPortal = (function() {
            try {
              const RE = /\b(entra|exchange|purview|onedrive|sharepoint|teams|intune|defender|m365|admin\.microsoft|portal\.azure|sentinelone|virustotal)\b/gi;
              const matches = String(goal || '').match(RE) || [];
              return matches.length >= 2;
            } catch (e) { return false; }
          })();
          const _hasIncompleteMarker = /\b(incomplete|step budget|could not access|unable to|exhausted|not yet|did not complete|did not reach|was unable|failed to extract)\b/i.test(_summary);
          if (_isMultiPortal && stepCount < 80 && _hasIncompleteMarker) {
            const blockMsg = 'BLOCKED: finish called early with "incomplete" markers on a multi-portal investigation (' + stepCount + ' steps; threshold 80). You have substantial budget remaining (dynamic cap 300, +25 per productive action). Try alternative strategies before declaring done:\n' +
              '  1. Microsoft Graph API: read_network_requests filter for graph.microsoft.com to capture the underlying JSON the UI is rendering.\n' +
              '  2. Alternate URL paths: Purview audit moved to purview.microsoft.com/audit/auditsearch (NOT /auditlogsearch).\n' +
              '  3. Cross-origin iframes block DOM scraping but the Graph API is visible. Use it.\n' +
              '  4. Log Analytics KQL for >60-day windows that the UI doesn\'t support.\n' +
              'Re-attempt the investigation using one of these paths before calling finish again.';
            history.push({ step: stepCount, action: command, result: blockMsg });
            if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
            await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
            sendSilentUpdate('Finish blocked — try Graph API or alternate URL before giving up', stepCount);
            await sleep(1000);
            continue;
          }
        } catch (_e) { /* never let the guard itself crash the loop */ }

        finished = true;
        consecutiveFailures = 0;
        sendSilentUpdate('Task complete', stepCount);

        let finalSummary = command.summary || '';
        const memKeys = Object.keys(agentMemory);

        // Clean up memory — filter out failed/timed-out/empty entries
        const cleanMemory = {};
        for (const k of memKeys) {
          const v = agentMemory[k];
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          // Skip empty, failed, timed-out, or "Done" entries
          if (!s || s === 'Done' || s.length < 5) continue;
          if (s.startsWith('Execution error') || s.startsWith('Code execution timed out')) continue;
          if (s.startsWith('JS Error:') || s.startsWith('Element not found')) continue;
          cleanMemory[k] = v;
        }

        // Don't append raw memory to the summary — let the report generator handle it
        // Only include a clean reference if there's valuable data
        const cleanKeys = Object.keys(cleanMemory);
        if (cleanKeys.length > 0) {
          // Let the LLM's summary stand on its own — the report will incorporate the data
          finalSummary += '\n\n📊 **' + cleanKeys.length + ' data points collected** — full analysis in the report below.';
        }

        // Capture report data BEFORE history gets cleared at loop exit
        reportData = {
          goal,
          history: history.slice(),
          agentMemory: { ...agentMemory },
          agentPlan: agentPlan ? agentPlan.slice() : null,
          stepCount,
          apiCallCount,
          tabContexts: getAllTabContexts().map(tc => ({ label: tc.label, url: tc.url, hasScreenshot: !!tc.snapshot }))
        };

        // (3.9.1) Hallucination hard-stop. If the summary's claim density
        // wildly exceeds the actual evidence the agent collected, block and
        // force a re-write. This catches the "list 10 articles when only 1
        // was read" pattern that sneaks past the system prompt's anti-
        // hallucination rule. Skipped for ticket-style investigation finishes
        // where claim counts can be high by design (per-portal sections).
        try {
          const _isTicketStyle = isTicketInvestigationGoal(goal);
          if (!_isTicketStyle) {
            const _risk = evaluateHallucinationRisk(finalSummary, agentMemory, history);
            if (_risk && _risk.risky) {
              const blockMsg = 'BLOCKED: hallucination risk detected — ' + _risk.reason +
                ' Either: (a) trim the summary to ONLY items you actually read/extracted, or (b) clearly tag unread items with "headline only — not read in this run". Then call finish again.';
              history.push({ step: stepCount, action: command, result: blockMsg });
              if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
              await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
              sendSilentUpdate('Finish blocked — claim density exceeds evidence', stepCount);
              await sleep(1000);
              continue;
            }
          }
        } catch (_e) { /* never crash the loop on hallucination check */ }

        // (3.8.0) Auto-format ticket investigations into the user's FINAL_NOTES
        // template with technician details auto-filled. Applied AFTER the
        // memory-summary suffix so all data points flow through the report.
        try {
          if (isTicketInvestigationGoal(goal)) {
            const tech = await getTechnicianInfo();
            finalSummary = formatTicketFinalNotes(finalSummary, goal, tech, {
              stepCount, apiCallCount
            });
          }
        } catch (e) { console.warn('[Sentinel] ticket formatter failed:', e && e.message); }

        // (3.9.0) Final run-log entry + broadcast runLogId so the popup can offer Export.
        try {
          if (runLogId) {
            runLogBuffer.push({
              step: stepCount,
              timestamp: new Date().toISOString(),
              kind: 'run_finish',
              url: currentUrl,
              summary_preview: typeof finalSummary === 'string' ? finalSummary.substring(0, 500) : ''
            });
            await chrome.storage.local.set({
              ['run_log_' + runLogId]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now(), completed: true }
            });
            try {
              chrome.runtime.sendMessage({ action: 'run_log_available', runLogId, entryCount: runLogBuffer.length }).catch(() => {});
            } catch (e) {}
          }
        } catch (_e) {}

        chrome.runtime.sendMessage({ action: 'agent_finished', summary: finalSummary }).catch(() => {});
        sendReportUpdate('generating');
        saveLearnedPattern(goal, history, true);
        break;
      }

      // Handle note
      if (command.type === 'note') {
        const noteText = command.text || command.summary || 'No note text';
        sendSilentUpdate(`${noteText.slice(0, 200)}${noteText.length > 200 ? '...' : ''}`, stepCount);
        history.push({ step: stepCount, action: command, result: `Note recorded: ${noteText}` });
        productiveSteps++;  // (3.8.0) every recorded finding extends the run
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        await sleep(500);
        continue;
      }

      // Handle extract / extract_list (save to agent memory)
      if (command.type === 'extract' || command.type === 'extract_list') {
        sendSilentUpdate(`Extracting: ${command.key}`, stepCount);
      }

      // (3.7.0) Observability actions — return buffered console / network data
      // captured by the CDP listeners attached at agent start. No content-script
      // round trip required; these are pure background-side reads.
      if (command.type === 'read_console_messages') {
        try {
          const entries = readConsoleMessages(tab, {
            limit: command.limit,
            filter: command.filter
          });
          const result = JSON.stringify(entries);
          sendActionMessage(command, stepCount, observation);
          if (entries.length > 0) productiveSteps++;  // (3.8.0)
          sendActionResult(stepCount, 'Console: ' + entries.length + ' entries', false);
          history.push({ step: stepCount, action: command, result });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        } catch (e) {
          sendActionResult(stepCount, 'Error reading console: ' + (e.message || 'unknown'), true);
        }
        await sleep(300);
        continue;
      }
      if (command.type === 'read_network_requests') {
        try {
          const entries = readNetworkRequests(tab, {
            limit: command.limit,
            filter: command.filter,
            url_includes: command.url_includes
          });
          const result = JSON.stringify(entries);
          sendActionMessage(command, stepCount, observation);
          if (entries.length > 0) productiveSteps++;  // (3.8.0)
          sendActionResult(stepCount, 'Network: ' + entries.length + ' requests', false);
          history.push({ step: stepCount, action: command, result });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        } catch (e) {
          sendActionResult(stepCount, 'Error reading network: ' + (e.message || 'unknown'), true);
        }
        await sleep(300);
        continue;
      }

      // Handle wait_for actions
      if (command.type === 'wait_for_text' || command.type === 'wait_for_element' || command.type === 'wait_for_navigation') {
        sendSilentUpdate(`Waiting for: ${command.text || command.selector || 'navigation'}`, stepCount);
        sendActionMessage(command, stepCount, observation);
        const waitResult = await sendMessageWithRetry(tab, {
          action: 'wait_for',
          condition: { ...command, currentUrl: tabInfo.url }
        });
        const result = waitResult || 'Wait completed';
        sendActionResult(stepCount, result, false);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        await sleep(500);
        continue;
      }

      sendSilentUpdate(`Executing: ${command.type}${agentPlan ? ` [${currentPlanStep + 1}/${agentPlan.length}]` : ''}`, stepCount);

      // (3.11.0) Tenant Lockdown — fires BEFORE the regular approval gate so
      // cross-tenant modifying actions on Microsoft admin URLs are caught even
      // when the user is in autonomous mode.
      try {
        const _block = shouldLockoutCrossTenantAction(command, currentUrl, detectedTenant, expectedTenant);
        if (_block) {
          sendSilentUpdate('🛑 Cross-tenant action blocked — awaiting override approval', stepCount);
          // Forensic log: override request fired
          if (runLogId) {
            try {
              runLogBuffer.push({
                step: stepCount,
                timestamp: new Date().toISOString(),
                kind: 'tenant_override_requested',
                url: currentUrl,
                expected: _block.expected,
                detected: _block.detected,
                action_type: _block.actionType
              });
              await chrome.storage.local.set({ ['run_log_' + runLogId]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } });
            } catch (e) {}
          }
          const decision = await requestTenantOverride(_block, command, stepCount);
          if (decision.approved) {
            tenantOverrideUrls.add(currentUrl);
            // Log the override grant
            if (runLogId) {
              try {
                runLogBuffer.push({
                  step: stepCount,
                  timestamp: new Date().toISOString(),
                  kind: 'tenant_override_granted',
                  url: currentUrl,
                  expected: _block.expected,
                  detected: _block.detected,
                  action_type: _block.actionType
                });
                await chrome.storage.local.set({ ['run_log_' + runLogId]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } });
              } catch (e) {}
            }
            sendSilentUpdate('✓ Cross-tenant override granted — proceeding', stepCount);
          } else {
            // Log the rejection and skip the action
            if (runLogId) {
              try {
                runLogBuffer.push({
                  step: stepCount,
                  timestamp: new Date().toISOString(),
                  kind: 'tenant_override_denied',
                  url: currentUrl,
                  expected: _block.expected,
                  detected: _block.detected,
                  action_type: _block.actionType
                });
                await chrome.storage.local.set({ ['run_log_' + runLogId]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() } });
              } catch (e) {}
            }
            history.push({ step: stepCount, action: command, result: 'BLOCKED: cross-tenant action rejected by tenant lockdown (expected ' + _block.expected + ', detected ' + _block.detected + ')' });
            if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
            await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
            sendSilentUpdate('🛑 Cross-tenant override denied — action skipped', stepCount);
            await sleep(1000);
            continue;
          }
        }
      } catch (_e) { /* never crash the loop on lockdown check */ }

      // Approval gate + CDP trusted input flag (#9)
      const settings = await chrome.storage.local.get(['approvalMode', 'useTrustedInput']);
      const useTrustedInput = settings.useTrustedInput === true;
      if (settings.approvalMode === true) {
        const approval = await requestApproval(command, stepCount);
        if (approval.rejected) {
          history.push({ step: stepCount, action: command, result: 'Rejected by user' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          await sleep(1000); continue;
        }
        if (approval.skipped) {
          history.push({ step: stepCount, action: command, result: 'Skipped by user' });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
          await sleep(1000); continue;
        }
      }

      // Show action card
      sendActionMessage(command, stepCount, observation);

      // Invalidate screenshot cache for actions that can change the page.
      // (#10) scroll_to changes viewport position which affects bbox/elementFromPoint
      // for the next observation — must invalidate.
      if (['navigate', 'click', 'click_at', 'type', 'press_key', 'select', 'scroll_to', 'scroll'].includes(command.type)) {
        const invalidationCtx = getTabContext(tab);
        if (invalidationCtx) {
          // (#11) Invalidate the entire snapshot object, not just the legacy field.
          invalidationCtx.screenshotCache.cachedSnapshot = null;
          invalidationCtx.screenshotCache.cachedBase64Image = null;
          invalidationCtx.screenshotCache.lastScreenshotUrl = null;
        }
      }

      // Execute command
      const urlBeforeCommand = tabInfo.url;
      let result;
      let actionFailed = false;

      // Handle open_tab
      if (command.type === 'open_tab') {
        if (!isValidUrl(command.url)) {
          result = 'Invalid URL: ' + command.url;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          sendSilentUpdate(`Opening tab: ${command.label || command.url}`, stepCount);
          const ctx = await openTab(command.url, command.label);
          // (3.7.2) Attach the new tab to the Sentinel group so the user
          // sees it linked in the tab bar.
          try { await attachTabToSentinelGroup(ctx.tabId); } catch (e) {}
          await switchToTab(ctx.tabId);
          await sleep(2000);
          await injectContentScript(ctx.tabId);
          result = `Opened tab "${command.label || command.url}" (ID: ${ctx.tabId})`;
        }
        sendActionResult(stepCount, result, actionFailed);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        continue;
      }

      // Handle switch_tab
      if (command.type === 'switch_tab') {
        let targetId = command.tab_id;
        if (!targetId && command.label) {
          targetId = findTabByLabel(command.label);
        }
        if (!targetId) {
          result = `Tab not found: ${command.label || command.tab_id}`;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          await switchToTab(targetId);
          await injectContentScript(targetId);
          result = `Switched to tab "${getTabContext(targetId)?.label || targetId}"`;
        }
        sendActionResult(stepCount, result, actionFailed);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        continue;
      }

      // Handle close_tab
      if (command.type === 'close_tab') {
        let targetId = command.tab_id;
        if (!targetId && command.label) {
          targetId = findTabByLabel(command.label);
        }
        if (!targetId) {
          result = `Tab not found: ${command.label || command.tab_id}`;
          actionFailed = true;
        } else {
          sendActionMessage(command, stepCount, null); // Show action card in popup
          await closeTab(targetId);
          result = `Closed tab "${command.label || targetId}"`;
        }
        sendActionResult(stepCount, result, actionFailed);
        history.push({ step: stepCount, action: command, result });
        if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
        await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
        continue;
      }

      if (command.type === 'navigate') {
        if (!isValidUrl(command.url)) {
          result = 'Invalid URL: ' + command.url;
          actionFailed = true;
        } else {
          await chrome.tabs.update(tab, { url: command.url });
          await waitForPageLoad(tab);
          await sleep(1500);
          // Re-inject content script on the new page
          const reinjected = await injectContentScript(tab);
          if (!reinjected) {
            result = 'Navigated to ' + command.url + ' (content script failed to load)';
            actionFailed = true;
          } else {
            // Verify we actually arrived at the intended page
            const newTabInfo = await getTabInfo(tab);
            const arrivedUrl = newTabInfo ? newTabInfo.url : command.url;
            try {
              const intendedHost = new URL(command.url).hostname.toLowerCase();
              const arrivedHost = new URL(arrivedUrl).hostname.toLowerCase();
              if (arrivedHost.includes(intendedHost.replace(/^www\./, ''))) {
                result = 'Navigated to ' + arrivedUrl;
              } else {
                result = 'Navigated but landed on ' + arrivedUrl + ' instead of ' + command.url;
                actionFailed = true;
              }
            } catch (e) {
              result = 'Navigated to ' + arrivedUrl;
            }
          }
        }
      } else if (command.type === 'read_page') {
        try {
          const freshContent = await sendMessageWithRetry(tab, { action: 'read_page' });
          result = freshContent ? 'Page content re-read' : 'Failed to re-read page';
          actionFailed = !freshContent;
        } catch (err) { result = 'Could not re-read page'; actionFailed = true; }
      } else if (command.type === 'extract' || command.type === 'extract_list') {
        const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
        result = res || 'Done';
        let extractSucceeded = false;
        try {
          const parsed = JSON.parse(result.replace('JS Result: ', ''));
          if (parsed.key !== undefined && parsed.value !== undefined) {
            // (3.8.2) Auto-prefix memory key with the portal name when on a
            // known platform, so multi-portal investigations group findings
            // cleanly in the report (e.g. "entra_signins" vs "exchange_rules").
            const _portalKey = (function() {
              const u = (currentUrl || '').toLowerCase();
              if (u.includes('entra')) return 'entra';
              if (u.includes('admin.exchange')) return 'exchange';
              if (u.includes('purview')) return 'purview';
              if (u.includes('onedrive')) return 'onedrive';
              if (u.includes('sharepoint')) return 'sharepoint';
              if (u.includes('teams')) return 'teams';
              if (u.includes('intune') || u.includes('endpoint.microsoft')) return 'intune';
              if (u.includes('defender') || u.includes('security.microsoft')) return 'defender';
              if (u.includes('admin.microsoft')) return 'm365';
              if (u.includes('sentinelone')) return 'sentinelone';
              if (u.includes('virustotal')) return 'virustotal';
              return null;
            })();
            const _finalKey = (_portalKey && !String(parsed.key).startsWith(_portalKey + '_'))
              ? (_portalKey + '_' + parsed.key)
              : parsed.key;
            agentMemory[_finalKey] = parsed.value;
            const memKeys = Object.keys(agentMemory);
            if (memKeys.length > CONFIG.maxMemoryEntries) {
              delete agentMemory[memKeys[0]];
            }
            await chrome.storage.local.set({ agent_memory: agentMemory });
            const preview = Array.isArray(parsed.value)
              ? `${parsed.value.length} items extracted`
              : `"${String(parsed.value).substring(0, 100)}"`;
            result = `Extracted ${parsed.key} = ${preview}`;
            extractSucceeded = true;
            productiveSteps++;  // (3.8.0)
          }
        } catch (e) {
          // extract result wasn't JSON -- treat as failure
        }
        if (!extractSucceeded) actionFailed = true;
      } else if (command.type === 'execute_js' && command.key) {
        // (3.13.0) Engine-side auto-recovery retry ladder for execute_js.
        // Try the LLM's original code first; on unproductive result, the
        // engine automatically retries with body.innerText, then with an
        // aggregated visible-element text harvest. The LLM is NEVER asked
        // to choose between these strategies -- engine handles mechanically.
        // Outcomes:
        //   strategy: 'original'              -> LLM's code worked
        //   strategy: 'body_text_fallback'    -> selector missed, text saved
        //   strategy: 'visible_text_fallback' -> SPA-heavy page text saved
        //   strategy: 'all_failed'            -> surface error to LLM
        const ladder = await _runExecuteJsWithRetryLadder(tab, command.code || '', command.timeout);
        if (ladder.strategy !== 'original') {
          console.log('[Sentinel] execute_js auto-recovered via:', ladder.strategy);
          // Append a hint to the result so the LLM knows which strategy
          // succeeded. Helps it adapt subsequent extractions on this page.
          ladder.raw = ladder.raw + '\n\n[ENGINE NOTE: original execute_js was unproductive; auto-recovered via ' + ladder.strategy + ' strategy. The data above is from ' + (ladder.strategy === 'body_text_fallback' ? 'document.body.innerText' : 'aggregated visible-element text') + '. Parse it with regex/string ops in your finish summary.]';
        }
        let res = ladder.raw;
        result = res || 'Done';
        // Extract the JS result value
        let jsValue = result;
        if (result.startsWith('JS Result: ')) {
          jsValue = result.substring(10);
        }
        if (result === 'Done' || result.startsWith('JS Error: ')) {
          // JS execution failed or returned nothing — do NOT save to memory
          actionFailed = true;
          result = result === 'Done' ? 'JS execution failed — no response from page' : result;
        } else if (jsValue.length < 5) {
          // Result too short to be useful data
          actionFailed = true;
          result = 'JS returned empty result';
        } else {
          // (3.9.0) Reject useless toString'd values — '[object Object]', null,
          // undefined, empty objects/arrays. Saving these is worse than failing.
          const _useless = /^\s*\[object\s+(?:Object|Promise|Array|Function|HTMLElement|HTMLCollection|NodeList|Window|Document|Map|Set)\]\s*$/i;
          const _trim = jsValue.trim();
          if (_useless.test(_trim) || _trim === 'undefined' || _trim === 'null') {
            actionFailed = true;
            // (3.12.1) More actionable guidance — tell the LLM the SPECIFIC
            // recovery patterns rather than vague "wrap in JSON.stringify".
            // The wrapper already does that; the bug is usually returning a
            // DOM node, a null query, or an unawaited Promise.
            result = 'JS returned a non-serializable value ("' + _trim.slice(0, 60) + '"). DO NOT retry the same code -- it will fail again. Recovery options: (1) Return text only: `return document.body.innerText.substring(0, 5000)` and parse in finish. (2) Use regex on body text: `const t = document.body.innerText; const m = t.match(/<your_pattern>/); return m ? m[1] : null;`. (3) Fall back to `read_page` action. (4) If you returned a DOM element, change to `el.innerText` instead. (5) If you returned a query that may be null, guard with `(document.querySelector(sel) || {}).innerText || null`.';
          } else {
            let savedKey = command.key;
            let savedValue = jsValue;
            try {
              const parsed = JSON.parse(jsValue);
              // Reject parsed-but-empty objects/arrays
              const isEmptyObj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0;
              const isEmptyArr = Array.isArray(parsed) && parsed.length === 0;
              if (parsed === null || isEmptyObj || isEmptyArr) {
                actionFailed = true;
                result = 'JS returned ' + (isEmptyArr ? 'an empty array []' : (isEmptyObj ? 'an empty object {}' : 'null')) + '. Re-run the query or extract specific fields directly.';
                savedValue = null;
              } else {
                savedValue = parsed;
              }
            } catch (e) { /* not JSON — keep the raw string */ }
            // (3.13.0) Memory hygiene at write time -- reject garbage values
            // BEFORE they pollute future prompts. Single source of truth via
            // _shouldAcceptMemoryWrite. Cleaner state means cleaner subsequent
            // prompts, faster hallucination gate, less report-time noise.
            if (savedValue !== null) {
              const hygiene = _shouldAcceptMemoryWrite(savedKey, savedValue, agentMemory);
              if (!hygiene.ok) {
                actionFailed = true;
                result = 'JS result rejected by memory hygiene: ' + hygiene.reason + '. Try a different extraction strategy or move on to another data source.';
                savedValue = null;
              }
            }
            if (savedValue !== null) {
              agentMemory[savedKey] = savedValue;
              const memKeys = Object.keys(agentMemory);
              if (memKeys.length > CONFIG.maxMemoryEntries) delete agentMemory[memKeys[0]];
              await chrome.storage.local.set({ agent_memory: agentMemory });
              const preview = String(jsValue).substring(0, 100);
              result = `JS result saved to "${savedKey}": ${preview}`;
              productiveSteps++;  // (3.8.0)
            }
          }
        }
      } else if (useTrustedInput && (command.type === 'click' || command.type === 'click_at' || command.type === 'type' || command.type === 'press_key')) {
        // (#9) CDP trusted-input dispatch path. Opt-in via settings.
        // On any CDP failure we fall back to the synthetic content-script
        // path so existing flows aren't broken.
        let cdpDone = false;
        try {
          if (command.type === 'click_at') {
            // click_at provides x/y in CSS pixels already (after #11 DPR fix).
            const x = Number(command.x) || 0;
            const y = Number(command.y) || 0;
            const r = await cdpDispatchClick(tab, x, y, {
              button: command.button,
              clickCount: command.clickCount,
              description: 'Clicking at (' + Math.round(x) + ', ' + Math.round(y) + ')'
            });
            if (r.ok) { result = 'Clicked at (' + Math.round(x) + ',' + Math.round(y) + ') via CDP'; cdpDone = true; }
            else { console.warn('[CDP] dispatchClick failed, falling back:', r.error); }
          } else if (command.type === 'click') {
            // Resolve ref/selector to a bbox center via the content script.
            try {
              const bbox = await sendMessageWithRetry(tab, { action: 'get_bbox', ref: command.ref, selector: command.selector }, 1);
              if (bbox && typeof bbox.x === 'number' && typeof bbox.y === 'number') {
                // Make sure the element is in view, then click via CDP at its center.
                try { await sendMessageWithRetry(tab, { action: 'execute_command', command: { type: 'scroll_to', ref: command.ref, selector: command.selector } }, 1); } catch (e) { /* non-fatal */ }
                // Re-query bbox after scroll
                let cx = bbox.x, cy = bbox.y;
                try {
                  const bbox2 = await sendMessageWithRetry(tab, { action: 'get_bbox', ref: command.ref, selector: command.selector }, 1);
                  if (bbox2 && typeof bbox2.x === 'number') { cx = bbox2.x; cy = bbox2.y; }
                } catch (e) { /* keep original */ }
                const targetLabel = command.ref || command.selector || 'element';
                const r = await cdpDispatchClick(tab, cx, cy, {
                  description: 'Clicking ' + targetLabel
                });
                if (r.ok) { result = 'Clicked ' + targetLabel + ' via CDP'; cdpDone = true; }
                else { console.warn('[CDP] dispatchClick failed, falling back:', r.error); }
              }
            } catch (e) { console.warn('[CDP] get_bbox failed, falling back:', e && e.message); }
          } else if (command.type === 'type') {
            // Focus the target via the content script (it knows the ref/selector
            // resolution rules), then dispatch trusted text via CDP.
            try {
              await sendMessageWithRetry(tab, { action: 'focus_element', ref: command.ref, selector: command.selector }, 1);
            } catch (e) { /* non-fatal: insertText may still hit the active element */ }
            const r = await cdpDispatchType(tab, command.text || '');
            if (r.ok) { result = 'Typed ' + (command.text ? command.text.length : 0) + ' chars via CDP'; cdpDone = true; }
            else { console.warn('[CDP] dispatchType failed, falling back:', r.error); }
          } else if (command.type === 'press_key') {
            const r = await cdpDispatchKey(tab, command.key);
            if (r.ok) { result = 'Pressed ' + command.key + ' via CDP'; cdpDone = true; }
            else { console.warn('[CDP] dispatchKey failed, falling back:', r.error); }
          }
        } catch (err) {
          console.warn('[CDP] dispatch threw, falling back:', err && err.message);
        }
        if (!cdpDone) {
          // CDP path failed -- fall back to the synthetic content-script path.
          try {
            const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
            result = res || 'Done';
            actionFailed = result.startsWith('Error') || result.includes(' not found') || result.includes('Element not found') || result.includes('No element');
          } catch (err) {
            result = 'Content script error: ' + (err.message || 'command failed to reach page');
            actionFailed = true;
          }
        }
      } else {
        try {
          // CSP-bypass: for execute_js without a key, also prefer CDP
          // Runtime.evaluate so strict-CSP sites work. (Same reason as the
          // with-key branch above — drudgereport.com et al. silently block
          // <script>-tag injection.)
          if (command.type === 'execute_js') {
            let cdpUsed = false;
            try {
              const cdpResult = await cdpExecuteJs(tab, command.code || '', { timeout: command.timeout });
              if (cdpResult && cdpResult.ok) {
                cdpUsed = true;
                const valStr = cdpResult.value === undefined || cdpResult.value === null
                  ? ''
                  : (typeof cdpResult.value === 'object'
                      ? JSON.stringify(cdpResult.value).slice(0, 3000)
                      : String(cdpResult.value).slice(0, 3000));
                result = 'JS Result: ' + valStr;
                actionFailed = false;
              } else if (cdpResult && !cdpResult.attachDenied && cdpResult.error) {
                console.warn('[CDP] execute_js failed, falling back:', cdpResult.error);
              }
            } catch (e) {
              console.warn('[CDP] execute_js threw, falling back:', e && e.message);
            }
            if (!cdpUsed) {
              const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
              result = res || 'Done';
              actionFailed = result.startsWith('Error') || result.startsWith('JS Error') || result.includes('timed out') || result.includes(' not found');
            }
          } else {
            const res = await sendMessageWithRetry(tab, { action: 'execute_command', command });
            result = res || 'Done';
            actionFailed = result.startsWith('Error') || result.includes(' not found') || result.includes('Element not found') || result.includes('No element');
          }
        } catch (err) {
          result = 'Content script error: ' + (err.message || 'command failed to reach page');
          actionFailed = true;
        }
      }

      // Post-click: handle navigation and new tab capture
      if (command.type === 'click' || command.type === 'click_at') {
        await sleep(1000);
        try {
          const allTabs = await new Promise(resolve => { chrome.tabs.query({}, (t) => resolve(t)); });
          const newTabs = allTabs.filter(t => t.openerTabId === tab && t.id !== tab);
          if (newTabs.length > 0) {
            const newTab = newTabs[0];
            const newUrl = newTab.url;
            if (getTabCount() > 1) {
              // Multi-tab mode: register the new tab as a tracked context
              registerInitialTab(newTab.id, newUrl);
              // Mark it as agent-created since it was opened by page interaction
              const newCtx = getTabContext(newTab.id);
              if (newCtx) newCtx.isAgentCreated = true;
              // (3.7.2) Attach the click-opened new tab to the Sentinel group.
              try { await attachTabToSentinelGroup(newTab.id); } catch (e) {}
              result = 'Clicked -> new tab opened: ' + (newUrl ? new URL(newUrl).hostname : 'new page');
            } else {
              // Single tab mode: capture URL, close new tab, navigate original (backward compat)
              chrome.tabs.remove(newTabs.map(t => t.id));
              await chrome.tabs.update(tab, { url: newUrl });
              await waitForPageLoad(tab);
              await sleep(500);
              result = 'Clicked -> navigated to ' + (newUrl ? new URL(newUrl).hostname : 'new page');
            }
          } else {
            const updatedTab = await getTabInfo(tab);
            if (updatedTab && updatedTab.url !== urlBeforeCommand) {
              await waitForPageLoad(tab);
              await sleep(500);
              try { result = 'Clicked -> navigated to ' + new URL(updatedTab.url).hostname; } catch (e) { result = 'Clicked -> page navigated'; }
            }
          }
        } catch (e) {}
      }

      // Track success/failure for self-healing
      if (actionFailed) {
        consecutiveFailures++;
        currentStrategies.push(`${command.type}:${command.selector || command.url || ''}`);
        if (currentStrategies.length > 10) currentStrategies.shift();
      } else {
        consecutiveFailures = 0;
        currentStrategies = [];
      }

      // Check for stall
      const stall = detectStall(history, consecutiveFailures, currentStrategies);
      if (stall.stalled) {
        sendSilentUpdate(`Stall detected: ${stall.reason}. Recovering...`, stepCount);

        if (stall.recoveryAction === 'RESCAN_AND_REPLAN') {
          // Force re-scan and replan from current page state
          agentPlan = null;
          currentPlanStep = 0;
          consecutiveFailures = 0;
          currentStrategies = [];

          // Inject stall context into history so the LLM knows what happened
          history.push({
            step: stepCount,
            action: { type: 'note', text: `STALL RECOVERY: Re-assessing page state. Previous approach: ${stall.reason}` },
            result: 'Stall detected -- forcing page re-scan and strategy change'
          });
          if (history.length > CONFIG.maxHistoryEntries) history.splice(0, history.length - CONFIG.maxHistoryEntries);
          await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });

          // Skip the normal sleep to recover faster
          continue;
        }

        if (stall.recoveryAction === 'FORCE_STRATEGY_SHIFT') {
          // Bump consecutiveFailures above threshold to ensure strategyCtx fires in callLLM
          consecutiveFailures = Math.max(consecutiveFailures, CONFIG.strategyShiftThreshold);
          // Don't continue -- let the normal flow proceed with the strategy shift prompt injected
        }
      }

      sendActionResult(stepCount, result, actionFailed);
      history.push({ step: stepCount, action: command, result });

      // (3.12.0) Vision-based action verification flag. After every modifying
      // action that didn't fail outright, mark the next observation cycle to
      // explicitly verify the action took effect. The actual verification
      // runs via prompt-injection in llm-client.js — no extra API call,
      // just forces the LLM to look at the post-action screenshot and
      // confirm before continuing.
      try {
        if (!actionFailed && command && MODIFYING_ACTIONS.has(command.type)) {
          pendingVerification = {
            type: command.type,
            description: (command.text || command.selector || command.value || command.url || command.key || '').toString().substring(0, 120),
            attemptedAt: stepCount
          };
        } else if (command && !MODIFYING_ACTIONS.has(command.type)) {
          // Non-modifying action consumes any pending flag implicitly.
          pendingVerification = null;
        }
      } catch (e) { pendingVerification = null; }

      // (3.9.0) Forensic run log: persist a structured record per step.
      try {
        if (runLogId) {
          runLogBuffer.push({
            step: stepCount,
            timestamp: new Date().toISOString(),
            kind: 'action',
            url: currentUrl,
            tenant: detectedTenant ? (detectedTenant.chipText || detectedTenant.onmicrosoft || detectedTenant.tid || '') : '',
            action_type: command.type,
            action: {
              selector: command.selector,
              ref: command.ref,
              url: command.url,
              key: command.key,
              text: (typeof command.text === 'string') ? command.text.substring(0, 200) : undefined,
              x: command.x, y: command.y
            },
            result: typeof result === 'string' ? result.substring(0, 500) : JSON.stringify(result || '').substring(0, 500),
            failed: !!actionFailed
          });
          // Keep last 200 entries; older ones get rolled into a summary.
          if (runLogBuffer.length > 200) {
            runLogBuffer.splice(0, runLogBuffer.length - 200);
          }
          // Persist to storage every step.
          chrome.storage.local.set({
            ['run_log_' + runLogId]: { goal, runLogId, entries: runLogBuffer, lastUpdate: Date.now() }
          }).catch(() => {});
        }
      } catch (_e) { /* never crash the loop on logging */ }

      // Consecutive navigate tracking
      if (command.type === 'navigate') {
        consecutiveNavigates++;
      } else if (['extract', 'extract_list', 'read_page'].includes(command.type)) {
        consecutiveNavigates = 0;
      }

      // HARD GUARD: After 3 consecutive navigates without reading/extracting
      if (consecutiveNavigates >= 3) {
        sendSilentUpdate(`Auto-reading page after ${consecutiveNavigates} navigates`, stepCount);
        try {
          const forcedRead = await sendMessageWithRetry(tab, { action: 'read_page' });
          if (forcedRead) {
            const forcedText = (forcedRead.content || '').substring(0, 8000);
            history.push({ step: stepCount, action: { type: 'read_page' }, result: `Auto-read: ${forcedText.substring(0, 500)}` });
          }
        } catch (e) { /* non-fatal */ }
        consecutiveNavigates = 0;
      }
      // (3.8.2) Roll up old history into a single summary entry so the
      // LLM prompt stays bounded on long multi-portal runs.
      try { maybeRollupHistory(history); } catch (e) {}

      // (3.8.2) Periodic progress checkpoint chat message.
      try { maybePostProgressUpdate(stepCount, history, agentMemory); } catch (e) {}

      // Cap in-memory history
      if (history.length > CONFIG.maxHistoryEntries) {
        history.splice(0, history.length - CONFIG.maxHistoryEntries);
      }
      await chrome.storage.local.set({ agent_history: history.slice(-CONFIG.maxStoredHistory) });
      // Service-worker resilience checkpoint (#16, lite). Resume is TODO.
      await writeCheckpoint(stepCount);
      // Human-like pacing between steps — variable delays so it feels like an operator working
      // Respects speed mode: turbo (0.2x), normal (1x), stealth (2x)
      const speedMultiplier = agentSpeed === 'turbo' ? 0.2 : agentSpeed === 'stealth' ? 2.0 : 1.0;
      const actionType = command.type;
      let baseDelay;
      if (['read_page', 'extract', 'extract_list', 'note'].includes(actionType)) {
        baseDelay = 800 + Math.random() * 600;    // 800-1400ms: quick data gathering
      } else if (['click', 'type', 'select', 'navigate', 'check', 'check_all'].includes(actionType)) {
        baseDelay = 1200 + Math.random() * 800;   // 1200-2000ms: deliberate actions
      } else if (['execute_js', 'scroll', 'dismiss_overlay'].includes(actionType)) {
        baseDelay = 600 + Math.random() * 400;    // 600-1000ms: quick utility actions
      } else {
        baseDelay = 1000 + Math.random() * 1000;  // 1000-2000ms: default
      }
      await sleep(baseDelay * speedMultiplier);

    } catch (err) {
      console.error('Agent loop error:', err);
      sendSilentUpdate(`Loop error: ${err.message}`, stepCount);
      consecutiveFailures++;
      if (err.message.includes('was closed')) { agentRunning = false; break; }
      await sleep(3000);
    }
  }

  if (finished) await chrome.storage.local.set({ agent_history: [], agent_memory: {} });

  // Release any CDP debugger attachments held during the run.
  try { await detachAllDebuggees(); } catch (e) { /* non-fatal */ }

  // Batch-close all agent-created tabs
  await closeAllAgentTabs();

  // (3.7.2) Dissolve the visual tab group at natural loop end too.
  try { await detachAllSentinelTabs(); } catch (e) { /* non-fatal */ }

  // Generate report (await so we can include it in the completion message)
  let agentReport = null;
  if (reportData) {
    try {
      agentReport = await generateReport(reportData, CONFIG);
      sendReportUpdate('ready', agentReport);
      // Backward compat: still write to storage for any code that polls
      await chrome.storage.local.set({ last_agent_report: agentReport });
    } catch (err) {
      console.error('Report generation failed:', err);
      sendReportUpdate('error', null, err.message);
      await chrome.storage.local.set({ last_agent_report_error: err.message });
    }
  }

  agentRunning = false;
  console.log(`Agent completed. Total API calls: ${apiCallCount}`);

  // (3.12.0) Tally client-knowledge entries used and bump the client's runCount.
  // Quiet, non-fatal — never let knowledge bookkeeping break the run finish path.
  try {
    if (activeClientId) {
      await markRunCompleted(activeClientId, clientKnowledgeUsedIds);
    }
  } catch (e) { /* non-fatal */ }

  // Signal completion via messaging (replaces polling for scheduler)
  chrome.runtime.sendMessage({ action: 'agent_loop_complete', report: agentReport }).catch(() => {});
}

// ========== Self-Learning ==========
async function saveLearnedPattern(goal, history, success) {
  try {
    const stored = await chrome.storage.local.get(['learned_patterns']);
    const patterns = stored.learned_patterns || [];
    patterns.push({
      goal: goal.substring(0, 100),
      steps: history.map(h => ({ type: h.action.type, selector: h.action.selector })),
      success,
      timestamp: Date.now()
    });
    if (patterns.length > CONFIG.maxLearnedPatterns) patterns.splice(0, patterns.length - CONFIG.maxLearnedPatterns);
    await chrome.storage.local.set({ learned_patterns: patterns });
  } catch (e) { console.warn('Failed to save pattern:', e); }
}

// ========== Utilities ==========
async function enforceRateLimit() {
  const delayNeeded = Math.max(0, CONFIG.minDelayBetweenCalls - (Date.now() - lastApiCallTime));
  if (delayNeeded > 0) await sleep(delayNeeded);
  lastApiCallTime = Date.now();
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ========== Approval Mode ==========
function describeAction(command) {
  switch (command.type) {
    case 'click': return `Click: ${command.selector}`;
    case 'type': return `Type into ${command.selector}: '${command.text || ''}'`;
    case 'navigate': return `Navigate to ${command.url}`;
    case 'scroll': return `Scroll ${(command.amount||0)>=0?'down':'up'}`;
    case 'select': return `Select "${command.value}" in ${command.selector}`;
    case 'hover': return `Hover: ${command.selector}`;
    case 'press_key': return `Press: ${command.key}`;
    case 'execute_js': return `Run JS: ${command.code || ''}`;
    case 'extract': return `Extract "${command.key}" from ${command.selector}`;
    default: return `${command.type}: ${JSON.stringify(command)}`;
  }
}

async function requestApproval(command, stepNumber) {
  const description = describeAction(command);
  // Per-call requestId so concurrent approvals don't cross-contaminate listeners.
  const requestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'request_approval',
      payload: { action: command.type, description, stepNumber, requestId },
      requestId
    }).catch(() => {});
    const listener = (message) => {
      if (message && message.action === 'approval_response' && message.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        resolve({
          approved: message.approved === true,
          skipped: message.skipped === true,
          rejected: message.rejected === true
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    // Fail-closed timeout: if no user response in 60s, REJECT rather than approve.
    // Auto-approving an AFK user is the opposite of safe.
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ approved: false, skipped: false, rejected: true, reason: 'approval_timeout' });
    }, 60000);
  });
}
