// agent-config-gate.js
// Extracted from agent-engine.js — Configuration Verification Gate + action-type Sets.
// Prevents false-positive completions on config-change tasks.

import { getErrorMessage } from './error-utils.js';

// ========== Configuration Verification Gate (3.7.0) ==========
// Prevents the agent from declaring "done" on a configuration-change task
// (firewall rule add, M365 permission grant, RMM script deploy, etc.) before
// it has actually clicked Save/Apply/Commit AND verified the change is
// reflected on the page. Stops false-positive completions cold — the most
// common reason a ticket gets reopened.

const CHANGE_VERBS_RE = /\b(add|create|delete|modify|update|enable|disable|block|allow|configure|grant|revoke|assign|remove|change|deploy|push)\b/i;
const COMMIT_TARGET_RE = /\b(apply|applied|save|saved|commit|committed|deploy|deployed|accept|accepted|update|updated|create|created|delete|deleted|publish|published|submit|submitted|confirm|confirmed|ok)\b/i;
const CONFIG_PLATFORM_RE = /(sonicwall|sonicos|fortinet|fortigate|cisco|paloalto|pan-os|panorama|admin\.microsoft|admin\.exchange|entra\.microsoft|portal\.azure|connectwise|ninjaone|ninja\.io|ninjarmm|datto|autotask|itglue|it-glue|huntress|screenconnect)/i;
const MULTI_PORTAL_RE = /\b(entra|exchange|purview|onedrive|sharepoint|teams|intune|defender|sentinelone|connectwise|ninjaone|datto|itglue|huntress|m365|admin\.microsoft|portal\.azure)\b/gi;

// Precompiled regex patterns for goal parsing
const MODE_TIER1_RE = /\bMode\s*[:=-]\s*(APPROVAL|AUTONOMOUS|YOLO)\b/i;
const MODE_TIER2_RE = /\b(approval|autonomous|yolo)\s+mode\b/i;
const _URL_NAV_RE = /(?:go to|navigate to|visit|check|open)\s+(https?:\/\/[^\s,]+|[\w.-]+\.(?:com|org|net|io|gov|edu|co)[^\s,]*)/i;
const _URL_ANY_RE = /(https?:\/\/[^\s]+)/i;
const _BARE_SITE_RE = /(?:go to|navigate to|visit|check|open)\s+(?:the\s+)?([\w\s]+?)(?:\s+(?:and|then|,|\.))?(?:\s|$)/i;
const _SEARCH_LONG_RE = /(?:search|find|look up|google)\s+(?:for\s+)?["']?([^"']{10,80})/i;
const _ABOUT_RE = /(?:about|on|regarding)\s+([^,.\n]{10,60})/i;
const _COUNT_RE = /(?:top\s+)?(\d+)/;
const ARTICLE_RE = /\b(?:top|first|best|recent)\s+(\d{1,2})\s+(articles?|stories|posts?|items?|headlines?|results?)\b/i;
const ARTICLE_KEY_RE = /article[_\s]?\d/i;


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
      typeof h.action.text === 'string' ? h.action.text : '',
      typeof h.action.selector === 'string' ? h.action.selector : '',
      typeof h.action.ref === 'string' ? h.action.ref : '',
      typeof h.action.description === 'string' ? h.action.description : '',
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
          typeof h.action.text === 'string' ? h.action.text : '',
          typeof h.action.selector === 'string' ? h.action.selector : '',
          typeof h.action.ref === 'string' ? h.action.ref : '',
          typeof h.result === 'string' ? h.result : ''
        ].join(' ').toLowerCase();
        if (COMMIT_TARGET_RE.test(probe)) sawCommit = true;
      }
    } else {
      if (MEMORY_WRITING_ACTIONS.has(t)) return true;
    }
  }
  return false;
}

const MODIFYING_ACTIONS = new Set(['click', 'click_at', 'type', 'select', 'check', 'check_all', 'press_key', 'upload_file']);

// Pre-computed Sets for loop detection - avoid recreating on every action
const NON_PRODUCTIVE_READ_ACTIONS = new Set(['read_page', 'execute_js', 'scroll', 'wait_for_text', 'wait_for_element']);
const REF_DRIVEN_ACTIONS = new Set(['click', 'type', 'hover', 'select', 'check', 'extract', 'extract_list', 'wait_for_element', 'scroll_to']);
const TARGETABLE_ACTIONS = new Set(['click', 'type', 'hover', 'select', 'check', 'check_all', 'extract', 'extract_list', 'scroll_to', 'wait_for_element']);
const LOOP_EXCLUDE_TYPES = new Set(['finish', 'navigate', 'extract', 'extract_list']);
const DATA_ACTIONS = new Set(['extract', 'extract_list', 'note', 'finish']);
const TAB_ACTIONS = new Set(['open_tab', 'switch_tab', 'close_tab']);
const INTERACTIVE_ACTIONS = new Set(['navigate', 'click', 'click_at', 'type', 'press_key', 'select', 'scroll_to', 'scroll']);
const CDP_FALLBACK_BLOCKED = new Set(['navigate', 'click', 'click_at', 'type', 'press_key', 'smart_navigate']);
const EXTRACT_ACTIONS = new Set(['extract', 'extract_list', 'read_page']);
const MEMORY_WRITING_ACTIONS = new Set(['read_page', 'extract', 'extract_list', 'note']);
const MODIFYING_INTERACTIVE_ACTIONS = new Set(['click', 'type', 'select', 'navigate', 'check', 'check_all']);
const OTHER_ACTIONS = new Set(['execute_js', 'scroll', 'dismiss_overlay']);

function _hostnameOf(url) {
  try { return new URL(url).hostname; } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); return ''; }
}

export {
  CHANGE_VERBS_RE,
  COMMIT_TARGET_RE,
  CONFIG_PLATFORM_RE,
  MULTI_PORTAL_RE,
  MODE_TIER1_RE,
  MODE_TIER2_RE,
  _URL_NAV_RE,
  _URL_ANY_RE,
  _BARE_SITE_RE,
  _SEARCH_LONG_RE,
  _ABOUT_RE,
  _COUNT_RE,
  ARTICLE_RE,
  ARTICLE_KEY_RE,
  isConfigChangeGoal,
  hasRecentCommitClick,
  hasPostCommitVerification,
  MODIFYING_ACTIONS,
  NON_PRODUCTIVE_READ_ACTIONS,
  REF_DRIVEN_ACTIONS,
  TARGETABLE_ACTIONS,
  LOOP_EXCLUDE_TYPES,
  DATA_ACTIONS,
  TAB_ACTIONS,
  INTERACTIVE_ACTIONS,
  CDP_FALLBACK_BLOCKED,
  EXTRACT_ACTIONS,
  MEMORY_WRITING_ACTIONS,
  MODIFYING_INTERACTIVE_ACTIONS,
  OTHER_ACTIONS,
  _hostnameOf,
};
