// agent-run-setup.js
// Extracted from agent-engine.js — Run Setup Helpers.
// Contains run initialization, page narration, and page state narration.

import { getErrorMessage } from './error-utils.js';
import { migrateLegacySettings } from './provider-registry.js';
import { initReasoningTrace } from './reasoning-trace.js';
import { clearBiasLog } from './bias-detector.js';
import { initKnowledgeGraph } from './knowledge-graph.js';
import { clearContradictionLog } from './contradiction-detector.js';
import { clearNoveltyHistory } from './novelty-detector.js';
import { clearSynthesis } from './knowledge-synthesizer.js';

// Copied regex patterns (kept in sync with agent-engine.js definitions)
const WWW_PREFIX_RE = /^www\./;
const ELEMENT_TAG_FORM_RE = /^form$/i;
const ELEMENT_TAG_BUTTON_RE = /^button$/i;
const ELEMENT_TAG_INPUT_RE = /^(input|textarea|select)$/i;
const ELEMENT_TAG_A_RE = /^a$/i;
const ELEMENT_TAG_HEADING_RE = /^h[1-3]$/i;
const ELEMENT_ERROR_TEXT_RE = /error|invalid|failed/i;

// Load run-stable settings, initialize module-level state, and return the
// (possibly context-prepended) goal string + settings. Called once at the start of each run.
// Returns: { goal, runSettings, expectedTenant }
async function _initRunState(goal) {
  await migrateLegacySettings();
  // (3.41.0) Batch all run-stable settings in one read — avoids per-step round-trips.
  let stored;
  try {
    stored = await chrome.storage.local.get([
      'agent_history', 'agent_context', 'agent_memory', 'expectedTenant',
      'ticketMode', 'ticketFormat', 'approvalMode', 'useTrustedInput',
      'quickMode',
    ]);
  } catch (e) {
    console.warn('[Sentinel] runAgentLoop settings load failed:', getErrorMessage(e));
    stored = {};
  }
  const runSettings = {
    ticketMode:      stored.ticketMode     ?? false,
    ticketFormat:    stored.ticketFormat   ?? 'standard',
    approvalMode:    stored.approvalMode   ?? false,
    useTrustedInput: stored.useTrustedInput ?? false,
    quickMode:       stored.quickMode      ?? false,
  };
  const _expectedTenant = (stored && typeof stored.expectedTenant === 'string') ? stored.expectedTenant.trim() : null;
  // Each run gets a clean memory namespace — never carry over data from a prior task.
  // Cross-client contamination: yesterday's findings must never leak into today's run.
  try {
    await chrome.storage.local.set({ agent_history: [] });
  } catch (e) {
    console.warn('[Sentinel] agent_history clear failed:', getErrorMessage(e));
  }
  // v10.0: Initialize intelligence systems for each new run
  try {
    await Promise.all([
      initReasoningTrace(),
      initKnowledgeGraph(),
      clearBiasLog(),
      clearContradictionLog(),
      clearNoveltyHistory(),
      clearSynthesis()
    ]);
    console.debug('[Sentinel] Intelligence systems initialized');
  } catch (e) {
    console.warn('[Sentinel] Intelligence systems initialization failed:', getErrorMessage(e));
  }
  let _goal = goal;
  if (stored.agent_context && stored.agent_context.trim()) {
    _goal = `Previous context: ${stored.agent_context.trim()}\n\nCurrent goal: ${goal}`;
  }
  return { goal: _goal, runSettings, expectedTenant: _expectedTenant };
}

// Build a plain-English one-liner describing what the agent can see on the page.
// Pure heuristic — no LLM call. Used for Phase 8.2 page state narration.
function _buildPageNarration(url, title, observation, pageContent) {
  try {
    const els = (observation && observation.elements) || [];
    const _text = (pageContent && pageContent.content) || '';
    const host = (() => { try { return new URL(url).hostname.replace(WWW_PREFIX_RE, ''); } catch (_urlErr) { return url; } })();
    const pageTitle = (title || '').trim();

    // Single-pass optimization: count all element types and collect headings in one loop
    let forms = 0, buttons = 0, inputs = 0, links = 0, errorEl = null;
    const headings = [];

    for (const e of els) {
      const tag = e.tag || '';

      // Count element types
      if (ELEMENT_TAG_FORM_RE.test(tag)) {
        forms++;
      } else if (ELEMENT_TAG_BUTTON_RE.test(tag) || e.role === 'button') {
        buttons++;
      } else if (ELEMENT_TAG_INPUT_RE.test(tag)) {
        inputs++;
      } else if (ELEMENT_TAG_A_RE.test(tag)) {
        links++;
      }

      // Collect headings
      if (ELEMENT_TAG_HEADING_RE.test(tag)) {
        const text = e.text || '';
        if (text) headings.push(text);
      }

      // Find error element (if not already found)
      if (!errorEl) {
        const t = typeof e.text === 'string' ? e.text.toLowerCase() : '';
        if (ELEMENT_ERROR_TEXT_RE.test(t)) {
          errorEl = e;
        }
      }
    }

    const parts = [];
    if (pageTitle) parts.push(pageTitle);
    else if (host) parts.push(host);

    if (headings[0]) {
      const hText = typeof headings[0] === 'string' ? headings[0] : '';
      const h = hText.length > 60 ? `${hText.substring(0, 57)}...` : hText;
      const hLower = typeof h === 'string' ? h.toLowerCase() : '';
      const pTitleLower = typeof pageTitle === 'string' ? pageTitle.toLowerCase() : '';
      if (hLower !== pTitleLower) parts.push(`"${h}"`);
    }

    const details = [];
    if (forms > 0) details.push(`${forms} form${forms > 1 ? 's' : ''}`);
    if (inputs > 0) details.push(`${inputs} input${inputs > 1 ? 's' : ''}`);
    if (buttons > 0) details.push(`${buttons} button${buttons > 1 ? 's' : ''}`);
    if (links > 5) details.push(`${links} links`);
    if (errorEl) details.push('⚠ error message visible');

    const summary = `${parts.join(' — ')}${details.length ? ` (${details.join(', ')})` : ''}`;
    return `I can see: ${summary || host}`;
  } catch (_) {
    return '';
  }
}

// Page state narration helper — generates a plain-English summary of page context.
// Takes a pageContext object with optional title, url, forms, buttons, links,
// inputs, tables, and bodyText fields. Returns a human-readable narration string.
function narratePageState(pageContext) {
  if (!pageContext) return 'Page state unknown.';
  const parts = [];
  if (pageContext.title) parts.push('Page: ' + pageContext.title);
  if (pageContext.url) {
    try { parts.push('on ' + new URL(pageContext.url).hostname); } catch(_e) {}
  }
  if (pageContext.forms && pageContext.forms.length > 0) parts.push(pageContext.forms.length + ' form(s) visible');
  if (pageContext.buttons && pageContext.buttons.length > 0) parts.push(pageContext.buttons.length + ' button(s)');
  if (pageContext.links && pageContext.links.length > 0) parts.push(pageContext.links.length + ' link(s)');
  if (pageContext.inputs && pageContext.inputs.length > 0) parts.push(pageContext.inputs.length + ' input field(s)');
  if (pageContext.tables && pageContext.tables.length > 0) parts.push(pageContext.tables.length + ' table(s)');
  // Check for specific platform indicators
  const text = (pageContext.bodyText || '').toLowerCase();
  if (text.includes('login') || text.includes('sign in')) parts.push('login page detected');
  if (text.includes('dashboard')) parts.push('dashboard detected');
  if (text.includes('error') || text.includes('404') || text.includes('403')) parts.push('error page detected');
  return parts.length > 0 ? parts.join(' · ') : 'Page loaded.';
}

export {
  _initRunState,
  _buildPageNarration,
  narratePageState,
};
