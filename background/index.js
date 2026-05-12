// Sentinel Override v3 — Service Worker Entry Point
// Wires all modules together and handles message routing.

import { startAgent, stopAgent, agentRunning, isAgentAttachedTab, getAttachedTabIds } from './agent-engine.js';
import { wrapMessageHandler, sendSilentUpdate, sendActionMessage, sendActionResult } from './message-protocol.js';
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl } from './tab-manager.js';
import { setSPATransitionPending, notifyIfEnabled } from './shared-state.js';
import { enumerateFrames, executeInFrame, resolveFrameForSelector, addFrameRouterListeners } from './frame-router.js';
import { getActiveTabId, getTabContext, getAllTabContexts, handleTabRemoved } from './tab-context.js';
import { generateReport } from './report-generator.js';
import { migrateLegacySettings } from './provider-registry.js';
import { listTemplates, getTemplate, saveTemplate, updateTemplate, deleteTemplate, resolveTemplateGoal } from './template-manager.js';
import { PROVIDER_CATALOG, getCatalogProvider, fetchModelsList } from './provider-registry.js';
import { createSchedule, listSchedules, deleteSchedule, toggleSchedule, executeScheduledTask, getScheduleResults, getRecentResults, clearScheduleResults, initScheduler } from './scheduler.js';
import { exportTemplate, exportAllTemplates, validateImport, importTemplates, exportReportAsMarkdown } from './collaboration.js';
// (3.26.0) Bridge for content-script telemetry — content/index.js cannot
// import telemetry.js directly (different context), so it posts a
// `content_telemetry_event` message and we re-emit via tel.emit() so the
// verbosity gate, console mirror, and panel broadcast all apply uniformly.
// (3.27.0) Also exposes Past Runs queries to the popup-side panel.
import { tel, listPersistedRuns, loadPersistedRun, deletePersistedRun } from './telemetry.js';
import {
  listClients as ck_listClients,
  getClient as ck_getClient,
  getActiveClient as ck_getActiveClient,
  setActiveClient as ck_setActiveClient,
  createClient as ck_createClient,
  updateClient as ck_updateClient,
  deleteClient as ck_deleteClient,
  addEntry as ck_addEntry,
  updateEntry as ck_updateEntry,
  deleteEntry as ck_deleteEntry,
  exportClient as ck_exportClient,
  importClient as ck_importClient
} from './client-knowledge.js';

// ========== One-time migration ==========
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['api_endpoint', 'model'], (result) => {
    const updates = {};
    if (result.api_endpoint && result.api_endpoint.includes('bigmodel.cn')) updates.api_endpoint = '';
    if (result.model && (result.model.includes('glm-4.6v-flash') || result.model.includes('glm-4v-'))) updates.model = '';
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
});

// ========== Scheduler Initialization ==========
// Re-register alarms on service worker restart (handles browser restart alarm loss)
initScheduler();

// ========== Frame Router Initialization ==========
// Subscribe to webNavigation events to keep the per-tab frame map fresh
// for cross-origin iframe routing.
addFrameRouterListeners();

// Schedule alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('schedule-')) {
    const scheduleId = alarm.name.replace('schedule-', '');
    try {
      await executeScheduledTask(scheduleId);
    } catch (err) {
      console.error('Scheduled task execution failed:', err);
    }
  }
});

// ========== Download Capture (3.9.0) ==========
// While an agent run is active, capture every download Chrome creates and
// surface it in the popup chat with the file path. Lets the agent's "Click
// Export → CSV" step actually deliver the file location to the user.
try {
  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onCreated) {
    chrome.downloads.onCreated.addListener((dl) => {
      try {
        if (!agentRunning) return;
        if (!dl || typeof dl !== 'object') return;
        chrome.runtime.sendMessage({
          action: 'download_captured',
          download: {
            id: dl.id,
            url: dl.url || '',
            filename: dl.filename || '',
            mime: dl.mime || '',
            startTime: dl.startTime || new Date().toISOString(),
            totalBytes: dl.totalBytes || 0
          }
        }).catch(() => {});
      } catch (e) { /* non-fatal */ }
    });
  }
} catch (e) { /* downloads API may be unavailable */ }

// ========== Toolbar Icon: Toggle Side Panel (3.12.2) ==========
// Tell Chrome to handle the action-icon click natively as a toggle. With
// this set, clicking the toolbar icon opens the panel; clicking again
// closes it. Without it, our previous manual onClicked listener could
// only open -- there is no chrome.sidePanel.close() API to pair with
// .open(), so manual toggling is impossible. Letting Chrome own the
// behavior is the supported path for true open/close from one icon.
//
// Per-tab setOptions in the tabs.onActivated handler still controls
// whether the panel is enabled on a given tab during a run -- those
// two APIs coexist fine.
try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn('[Sentinel] setPanelBehavior failed:', e && e.message));
} catch (e) { /* non-fatal on older Chrome */ }

// ========== Unified Message Handler ==========
chrome.runtime.onMessage.addListener(wrapMessageHandler(async (request, sender) => {
  switch (request.action) {
    // (3.26.0) Content-script telemetry bridge. The content script can't
    // import telemetry.js (different execution context, no module access in
    // MAIN world), so it sends `content_telemetry_event` messages and we
    // re-emit through the same tel.emit() that background-side code uses.
    // This means: verbosity gating, console mirror, sequence numbering, and
    // panel broadcast all behave identically for content-side events.
    //
    // Request shape:
    //   { action: 'content_telemetry_event', category, level, message, payload }
    //
    // We auto-stamp `tabId` and `frameUrl` from the sender so the panel can
    // attribute events to the originating tab without the content script
    // having to look those up itself.
    case 'content_telemetry_event': {
      try {
        const cat = String(request.category || 'content');
        const lvl = ['error', 'warn', 'info', 'debug', 'trace'].includes(request.level) ? request.level : 'info';
        const msg = String(request.message || '');
        const payload = (request.payload && typeof request.payload === 'object') ? { ...request.payload } : {};
        // Auto-stamp the sender info so panel rows show which tab fired.
        if (sender && sender.tab && typeof sender.tab.id === 'number') payload.tabId = sender.tab.id;
        if (sender && sender.url) payload.frameUrl = String(sender.url).substring(0, 200);
        tel[lvl](cat, msg, payload);
      } catch (e) { /* never throw on telemetry */ }
      return { ok: true };
    }

    // (3.27.0) Telemetry-panel Past Runs bridge. The panel runs in the side
    // panel context and can't import telemetry.js directly — these handlers
    // expose the persistence read/delete API.
    case 'list_persisted_telemetry_runs': {
      try { return await listPersistedRuns(); } catch (e) { return []; }
    }
    case 'load_persisted_telemetry_run': {
      try { return await loadPersistedRun(request.runId); } catch (e) { return []; }
    }
    case 'delete_persisted_telemetry_run': {
      try { await deletePersistedRun(request.runId); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
    }

    case 'get_provider_catalog': {
      // (3.10.0) Return the catalog so the popup can populate the dropdown.
      try {
        return PROVIDER_CATALOG.map(p => ({
          id: p.id, label: p.label,
          endpoint: p.endpoint,
          modelsUrl: p.modelsUrl,
          defaultModel: p.defaultModel,
          auth: p.auth,
          docsUrl: p.docsUrl
        }));
      } catch (e) { return []; }
    }
    case 'fetch_provider_models': {
      // (3.10.0) Auto-detect models for the selected provider. Caller passes
      // { providerId, apiKey, customEndpoint } — uses customEndpoint as
      // the modelsUrl base for the 'custom' provider.
      try {
        const id = request.providerId;
        const apiKey = request.apiKey || '';
        let provider = getCatalogProvider(id);
        if (!provider) return { ok: false, error: 'Unknown provider id: ' + id };
        let modelsUrl = provider.modelsUrl;
        if (id === 'custom') {
          // For 'custom', derive modelsUrl from the user's endpoint URL.
          // Strip /chat/completions and append /models.
          const ep = request.customEndpoint || '';
          if (!ep) return { ok: false, error: 'Enter your custom endpoint URL first' };
          try {
            const u = new URL(ep);
            // Strip any /chat/completions or trailing path
            const base = u.protocol + '//' + u.host + u.pathname.replace(/\/(chat\/completions|messages|completions)\/?$/i, '');
            modelsUrl = base.replace(/\/$/, '') + '/models';
          } catch (e) {
            return { ok: false, error: 'Could not parse custom endpoint: ' + e.message };
          }
        }
        const models = await fetchModelsList({ ...provider, modelsUrl }, apiKey);
        return { ok: true, models };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    }
    case 'check_resume_available': {
      // (3.9.0) Look for a recent checkpoint that suggests an interrupted run.
      try {
        const stored = await chrome.storage.session.get('agent_checkpoint');
        const cp = stored && stored.agent_checkpoint;
        if (!cp) return { available: false };
        const age = Date.now() - (cp.lastUpdate || 0);
        if (age > 60 * 60 * 1000) return { available: false };  // older than 1h, ignore
        if (agentRunning) return { available: false };          // already running
        return {
          available: true,
          goal: cp.lastGoal || '',
          stepCount: cp.stepCount || 0,
          ageSeconds: Math.floor(age / 1000)
        };
      } catch (e) {
        return { available: false };
      }
    }
    case 'resume_from_checkpoint': {
      // For now, this just clears the checkpoint and starts a NEW run with
      // the saved goal — a full state restore is more invasive. The new
      // run picks up the prior agent_memory automatically (see runAgentLoop).
      try {
        const stored = await chrome.storage.session.get('agent_checkpoint');
        const cp = stored && stored.agent_checkpoint;
        if (!cp || !cp.lastGoal) return { ok: false, error: 'No checkpoint to resume' };
        await chrome.storage.session.remove('agent_checkpoint');
        return await startAgent(cp.lastGoal, sender);
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    case 'execute_command': {
      const activeTab = getActiveTabId();
      if (!activeTab) throw new Error('No agent tab specified');
      const tab = activeTab;
      const cmd = request.command;

      // Handle navigate inline (no content script needed)
      if (cmd.type === 'navigate') {
        if (!isValidUrl(cmd.url)) throw new Error('Invalid URL provided');
        await chrome.tabs.update(tab, { url: cmd.url });
        return 'Navigated to ' + cmd.url;
      }

      // All other commands: inject content script, send message
      await injectContentScript(tab);
      return await sendMessageWithRetry(tab, { action: 'execute_command', command: cmd });
    }

    case 'run_agent_loop': {
      return await startAgent(request.goal, sender);
    }

    case 'stop_agent_loop': {
      return stopAgent();
    }

    case 'pause_agent_loop': {
      const { pauseAgent } = await import('./agent-engine.js');
      return pauseAgent();
    }

    case 'resume_agent_loop': {
      const { resumeAgent } = await import('./agent-engine.js');
      return resumeAgent();
    }

    // (3.14.1) Used by the sign-in wall banner's "Focus tab" button: switch
    // the active Chrome tab+window to the URL whose auth wall caused the pause.
    case 'focus_tab_by_url': {
      try {
        const target = String(request.url || '');
        if (!target) return { ok: false, error: 'focus_tab_by_url: missing url' };
        let targetHost;
        try { targetHost = new URL(target).host; } catch (e) { targetHost = ''; }
        const tabs = await chrome.tabs.query({});
        // Prefer exact URL match, fall back to host match (Microsoft sign-in
        // walks the user through multiple URLs on the same host).
        let match = tabs.find(t => t && t.url === target);
        if (!match && targetHost) {
          match = tabs.find(t => {
            try { return t && t.url && new URL(t.url).host === targetHost; } catch (e) { return false; }
          });
        }
        if (!match) return { ok: false, error: 'no matching tab' };
        try { await chrome.tabs.update(match.id, { active: true }); } catch (e) {}
        try { await chrome.windows.update(match.windowId, { focused: true }); } catch (e) {}
        return { ok: true, tabId: match.id };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : 'unknown' };
      }
    }

    case 'set_agent_speed': {
      const { setAgentSpeed } = await import('./agent-engine.js');
      return setAgentSpeed(request.mode);
    }

    // SPA messages from content script
    case 'spa_navigation':
    case 'spa_content_changed':
      // Only set flag if agent is running (ignore transitions when idle)
      if (agentRunning) {
        setSPATransitionPending();
      }
      return null;

    // Cross-origin iframe commands from content script
    case 'execute_in_frame': {
      const { frameIndex, command } = request;
      const tabId = getActiveTabId();
      if (tabId == null) {
        return { ok: false, error: 'execute_in_frame: no active agent tab' };
      }
      if (frameIndex == null || frameIndex < 0) {
        return { ok: false, error: 'execute_in_frame: invalid frameIndex ' + frameIndex };
      }
      const frameId = await resolveFrameForSelector(tabId, frameIndex);
      // frameId === 0 (main frame) is a legitimate value — only reject null/undefined.
      if (frameId == null) {
        return { ok: false, error: 'execute_in_frame: frame ' + frameIndex + ' not found in tab ' + tabId };
      }
      return await executeInFrame(tabId, frameId, command);
    }

    case 'enumerate_frames': {
      return await enumerateFrames(getActiveTabId());
    }

    // Template CRUD
    case 'template_list':
      return await listTemplates();

    case 'template_get':
      if (!request.id) throw new Error('Template ID required');
      return await getTemplate(request.id);

    case 'template_save':
      if (!request.template) throw new Error('Template data required');
      return await saveTemplate(request.template);

    case 'template_update':
      if (!request.id) throw new Error('Template ID required');
      if (!request.updates) throw new Error('Update data required');
      return await updateTemplate(request.id, request.updates);

    case 'template_delete':
      if (!request.id) throw new Error('Template ID required');
      await deleteTemplate(request.id);
      return { deleted: true };

    case 'template_run': {
      if (!request.templateId) throw new Error('Template ID required');
      if (agentRunning) throw new Error('Agent already running');
      const goal = await resolveTemplateGoal(request.templateId, request.params || {});
      return await startAgent(goal, sender);
    }

    // ========== Client Knowledge (3.12.0+ -- 3.12.3 unwrap fix) ==========
    // wrapMessageHandler already wraps every return as { ok: true, data: <ret> }.
    // Earlier handlers double-wrapped with { ok: true, data: ... }, so the popup
    // saw { ok: true, data: { ok: true, data: <array> } } and list.map blew up.
    // Now: handlers return data directly, throw on error -- wrapper handles the rest.
    case 'client_list':
      return await ck_listClients();

    case 'client_get_active':
      return await ck_getActiveClient();

    case 'client_set_active': {
      const r = await ck_setActiveClient(request.id || null);
      if (!r.ok) throw new Error(r.error || 'Set active failed');
      return null;
    }

    case 'client_get':
      if (!request.id) throw new Error('Client ID required');
      return await ck_getClient(request.id);

    case 'client_create': {
      const r = await ck_createClient(request.client || {});
      if (!r.ok) throw new Error(r.error || 'Create failed');
      return r.client;
    }

    case 'client_update': {
      if (!request.id) throw new Error('Client ID required');
      const r = await ck_updateClient(request.id, request.updates || {});
      if (!r.ok) throw new Error(r.error || 'Update failed');
      return r.client;
    }

    case 'client_delete': {
      if (!request.id) throw new Error('Client ID required');
      const r = await ck_deleteClient(request.id);
      if (!r.ok) throw new Error(r.error || 'Delete failed');
      return null;
    }

    case 'client_entry_add': {
      if (!request.clientId) throw new Error('Client ID required');
      const r = await ck_addEntry(request.clientId, request.entry || {});
      if (!r.ok) throw new Error(r.error || 'Add entry failed');
      return r.entry;
    }

    case 'client_entry_update': {
      if (!request.clientId || !request.entryId) throw new Error('Client + entry IDs required');
      const r = await ck_updateEntry(request.clientId, request.entryId, request.updates || {});
      if (!r.ok) throw new Error(r.error || 'Update entry failed');
      return r.entry;
    }

    case 'client_entry_delete': {
      if (!request.clientId || !request.entryId) throw new Error('Client + entry IDs required');
      const r = await ck_deleteEntry(request.clientId, request.entryId);
      if (!r.ok) throw new Error(r.error || 'Delete entry failed');
      return null;
    }

    case 'client_export':
      if (!request.id) throw new Error('Client ID required');
      return await ck_exportClient(request.id);

    case 'client_import': {
      if (!request.payload) throw new Error('Import payload required');
      const r = await ck_importClient(request.payload, { rename: request.rename });
      if (!r.ok) throw new Error(r.error || 'Import failed');
      return r.client;
    }

    // Schedule CRUD
    case 'schedule_list':
      return await listSchedules();

    case 'schedule_create':
      if (!request.schedule) throw new Error('Schedule data required');
      return await createSchedule(request.schedule);

    case 'schedule_delete':
      if (!request.id) throw new Error('Schedule ID required');
      await deleteSchedule(request.id);
      return { deleted: true };

    case 'schedule_toggle':
      if (!request.id) throw new Error('Schedule ID required');
      if (typeof request.enabled !== 'boolean') throw new Error('Enabled flag required');
      return await toggleSchedule(request.id, request.enabled);

    case 'schedule_results':
      if (request.id) return await getScheduleResults(request.id);
      return await getRecentResults(request.limit || 20);

    case 'schedule_clear_results':
      if (!request.id) throw new Error('Schedule ID required');
      await clearScheduleResults(request.id);
      return { cleared: true };

    case 'schedule_clear_badge':
      chrome.action.setBadgeText({ text: '' });
      return { cleared: true };

    // Collaboration: export/import
    case 'collab_export_template':
      if (!request.id) throw new Error('Template ID required');
      return await exportTemplate(request.id);

    case 'collab_export_all_templates':
      return await exportAllTemplates();

    case 'collab_validate_import':
      if (!request.data) throw new Error('Import data required');
      return validateImport(request.data);

    case 'collab_import_templates':
      if (!request.templates || !Array.isArray(request.templates)) throw new Error('Templates array required');
      return await importTemplates(request.templates, request.conflictMode || 'skip');

    case 'collab_export_report':
      if (!request.report) throw new Error('Report data required');
      return exportReportAsMarkdown(request.report);

    // Fire-and-forget messages from content script — acknowledge silently
    case 'content_script_ready':
    case 'spa_navigation':
    case 'spa_content_changed':
      return null;

    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}));

// ========== Tab Event Listeners ==========

// Detect externally-closed tabs and clean up context
chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabRemoved(tabId);
});

// Track user tab switches for popup UI awareness AND side-panel visibility.
// Do NOT change the agent's active tab when the user switches.
// Per CONTEXT.md decision: agent ignores user's manual tab switches.
//
// (3.7.2) When an agent run is in progress, hide the side panel on tabs that
// are NOT in the Sentinel attached-group, and show it on tabs that ARE.
// This mirrors Claude in Chrome's "panel only follows the agent's tabs"
// behavior. When no agent is running, every tab gets the panel.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!activeInfo || typeof activeInfo.tabId !== 'number') return;
  try {
    if (agentRunning) {
      const attached = isAgentAttachedTab(activeInfo.tabId);
      await chrome.sidePanel.setOptions({
        tabId: activeInfo.tabId,
        enabled: attached,
        path: 'popup.html'
      });
    } else {
      // No run in progress — keep the panel available everywhere.
      await chrome.sidePanel.setOptions({
        tabId: activeInfo.tabId,
        enabled: true,
        path: 'popup.html'
      });
    }
  } catch (e) { /* non-fatal: sidePanel may be unavailable on chrome:// */ }
});

// ========== Keyboard Shortcut Commands ==========
chrome.commands.onCommand.addListener(async (command) => {
  try {
    switch (command) {
      case 'toggle-agent': {
        if (agentRunning) {
          await stopAgent();
          notifyIfEnabled({ type: 'basic', iconUrl: chrome.runtime.getURL('icon-48.png'), title: 'Sentinel Override', message: 'Agent stopped' });
        }
        // Start requires a goal — open the side panel instead.
        // sidePanel.open() needs a tabId or windowId; query active tab first.
        else {
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && typeof activeTab.id === 'number') {
              await chrome.sidePanel.open({ tabId: activeTab.id }).catch(() => {});
            }
          } catch (e) { /* no active tab — silently ignore */ }
        }
        break;
      }
      case 'pause-agent': {
        if (agentRunning) {
          const { pauseAgent, resumeAgent } = await import('./agent-engine.js');
          // Simple toggle: pause if running, resume if paused (agentPaused read from module scope won't work)
          // Instead, just send both and let the engine decide
          await pauseAgent(); // Will set agentPaused = true
        }
        break;
      }
      case 'turbo-mode': {
        const { setAgentSpeed } = await import('./agent-engine.js');
        setAgentSpeed('turbo');
        notifyIfEnabled({ type: 'basic', iconUrl: chrome.runtime.getURL('icon-48.png'), title: 'Sentinel Override', message: '🚀 Turbo mode' });
        break;
      }
      case 'normal-mode': {
        const { setAgentSpeed } = await import('./agent-engine.js');
        setAgentSpeed('normal');
        notifyIfEnabled({ type: 'basic', iconUrl: chrome.runtime.getURL('icon-48.png'), title: 'Sentinel Override', message: '👤 Normal mode' });
        break;
      }
      case 'stealth-mode': {
        const { setAgentSpeed } = await import('./agent-engine.js');
        setAgentSpeed('stealth');
        notifyIfEnabled({ type: 'basic', iconUrl: chrome.runtime.getURL('icon-48.png'), title: 'Sentinel Override', message: '🥷 Stealth mode' });
        break;
      }
    }
  } catch (e) { console.warn('Command handler error:', e); }
});
