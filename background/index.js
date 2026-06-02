// Sentinel Override v3 — Service Worker Entry Point
// Wires all modules together and handles message routing.

import { startAgent, stopAgent, agentRunning, isAgentAttachedTab, getAttachedTabIds, injectContext, fetchAuditLog, auditLogToCsv } from './agent-engine.js';
// eslint-disable-next-line no-unused-vars
import { wrapMessageHandler, sendSilentUpdate, sendActionMessage, sendActionResult } from './message-protocol.js';
// eslint-disable-next-line no-unused-vars
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl } from './tab-manager.js';
import { setSPATransitionPending, notifyIfEnabled } from './shared-state.js';
import { enumerateFrames, executeInFrame, resolveFrameForSelector, addFrameRouterListeners } from './frame-router.js';
// eslint-disable-next-line no-unused-vars
import { getActiveTabId, getTabContext, getAllTabContexts, handleTabRemoved } from './tab-context.js';
// eslint-disable-next-line no-unused-vars
import { generateReport } from './report-generator.js';
// eslint-disable-next-line no-unused-vars
import { migrateLegacySettings } from './provider-registry.js';
import { callLLMSimple } from './llm-client.js';
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
// (3.29.0) Skill outcome stats bridge — popup side reads/resets these.
import { listSkills, getSkillStats, resetSkillStats } from './skills/index.js';
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
import { handleMenuClick } from './context-menu.js';
import { createMonitor, removeMonitor, toggleMonitor, loadMonitors, startMonitorLoop } from './page-monitor.js';
import { startRecording, stopRecording, isRecording, loadMacros } from './macro-recorder.js';
import { generateHtmlReport, generateReplayReport } from './export-report.js';

// ========== One-time migration ==========
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['api_endpoint', 'model'], (result) => {
    if (chrome.runtime.lastError) { console.warn('[Sentinel] Migration get failed:', (typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError))); return; }
    const updates = {};
    if (result.api_endpoint && result.api_endpoint.includes('bigmodel.cn')) updates.api_endpoint = '';
    if (result.model && (result.model.includes('glm-4.6v-flash') || result.model.includes('glm-4v-'))) updates.model = '';
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates, () => {
        if (chrome.runtime.lastError) console.error('[Sentinel] Migration set failed:', (typeof chrome.runtime.lastError.message === 'string' ? chrome.runtime.lastError.message : String(chrome.runtime.lastError)));
      });
    }
  });

  // (v3.44) Install context menus
  import('./context-menu.js').then(({ installContextMenus }) => {
    installContextMenus();
  }).catch(() => { /* context menus not critical */ });
});

// ========== Scheduler Initialization ==========
// Re-register alarms on service worker restart (handles browser restart alarm loss)
initScheduler();

// ========== Self-Healing: Auto-resume interrupted runs ==========
// On SW restart, check if an agent run was in progress and auto-resume it.
(async () => {
  try {
    const stored = await chrome.storage.session.get(['agentRunning', 'agentGoal', 'agentStartTime']);
    if (stored && stored.agentRunning && stored.agentGoal) {
      const age = Date.now() - (stored.agentStartTime || 0);
      // Only auto-resume if the run started less than 10 minutes ago
      if (age < 10 * 60 * 1000) {
        console.log('[Sentinel/self-heal] Detected interrupted run. Goal:', stored.agentGoal, 'Age:', Math.floor(age/1000) + 's');
        // Check for checkpoint with more state
        const cp = await chrome.storage.session.get('agent_checkpoint');
        if (cp && cp.agent_checkpoint && cp.agent_checkpoint.lastGoal) {
          console.log('[Sentinel/self-heal] Checkpoint found, resuming...');
          const { restoreFromCheckpoint, clearCheckpoint } = await import('./agent-engine.js');
          const result = await restoreFromCheckpoint();
          if (result.restored) {
            await clearCheckpoint();
            console.log('[Sentinel/self-heal] State restored, restarting agent loop');
            const { startAgent } = await import('./agent-engine.js');
            // Get any active tab to restart on
            const tabs = await new Promise(resolve => {
              chrome.tabs.query({active: true, currentWindow: true}, (t) => {
                if (chrome.runtime.lastError) {
                  console.warn('[Sentinel/index] tabs.query lastError:', chrome.runtime.lastError.message);
                  resolve([]);
                  return;
                }
                resolve(t || []);
              });
            });
            if (tabs.length > 0 && tabs[0] && tabs[0].id) {
              await startAgent(result.goal, { tab: tabs[0] });
            }
          }
        } else {
          // No checkpoint — clear stale session flags so next SW restart doesn't loop
          await chrome.storage.session.remove(['agentRunning', 'agentGoal', 'agentStartTime']);
        }
      } else {
        // Stale run — clear the flag
        console.log('[Sentinel/self-heal] Stale run detected (', Math.floor(age/60000), 'min old), clearing');
        await chrome.storage.session.remove(['agentRunning', 'agentGoal', 'agentStartTime']);
      }
    }
  } catch (e) {
    console.warn('[Sentinel/self-heal] Auto-resume check failed:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e));
  }
})();

// ========== Context Menu Click Handler (v3.44) ==========
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const result = handleMenuClick(info, tab);
  if (!result) return;

  // Route each context menu action to the message handler
  const { action, params } = result;
  const message = { action: `context_menu_${action}`, params };

  // Direct invocation for agent-starting actions
  if (['analyze', 'extract', 'fill_form', 'screenshot', 'summarize'].includes(action)) {
    chrome.runtime.sendMessage(message).catch(() => {});
  } else if (action === 'monitor_changes') {
    // Use selected text as selector hint, prompt via side panel
    chrome.runtime.sendMessage({
      action: 'context_menu_monitor_changes',
      params: {
        selector: params.selectionText ? `*:contains('${String(params.selectionText || '').substring(0, 50)}')` : 'body',
        label: params.selectionText ? `Monitor: "${String(params.selectionText || '').substring(0, 30)}"` : 'Page Monitor',
        url: params.pageUrl,
      },
    }).catch(() => {});
  } else if (action === 'start_recording') {
    chrome.runtime.sendMessage({ action: 'context_menu_start_recording' })
      .then(() => {
        chrome.action.setBadgeText({ text: 'REC' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      })
      .catch(() => {});
  } else if (action === 'run_macro') {
    // Open side panel with macro selection
    chrome.sidePanel.open({ tabId: tab?.id }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'macro_list' }).catch(() => {});
  } else if (action === 'export_report') {
    chrome.runtime.sendMessage({ action: 'export_html_report', params: {} })
      .then((resp) => {
        if (resp?.ok && resp.data?.html) {
          const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(resp.data.html);
          chrome.downloads.download({
            url: dataUrl,
            filename: `sentinel-report-${Date.now()}.html`,
            saveAs: true,
          });
        }
      })
      .catch(() => {});
  } else if (action === 'quick_assist') {
    // (3.46.0) Quick Assist — open side panel and inject selected text as prompt
    chrome.sidePanel.open({ tabId: tab?.id }).catch(() => {});
    // Send show_quick_assist to the content script so quick-assist.js shows the floating panel
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'show_quick_assist',
        selectedText: params.selectionText || '',
        pageInfo: { url: params.pageUrl || '' },
      }).catch(() => {});
    }
  }
});

// ========== Page Monitor Loop (v3.44) ==========
try {
  startMonitorLoop();
} catch (_e) { /* page monitor not critical */ }

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
      console.error('Scheduled task execution failed:', (typeof err === 'object' && err !== null && 'message' in err) ? err.message : String(err));
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
        if (!dl || typeof dl !== 'object' || dl === null) return;
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
        }).catch((e) => {
          console.error('[download_captured] Unhandled rejection:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e));
        });
      } catch (e) { console.warn('[Sentinel/index] download capture failed:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)); }
    });
  }
} catch (e) { console.warn('[Sentinel/index] downloads API unavailable:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)); }

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
    .catch((e) => console.warn('[Sentinel] setPanelBehavior failed:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)));
} catch (_e) { /* non-fatal on older Chrome */ }

// ========== Side Panel Tab-Scoping (v3.53) ==========
// During an agent run, the side panel should ONLY appear on tabs the agent
// is actively using (attached tabs). All other tabs have it disabled.
// Mirrors Claude's computer-use behavior — panel follows the agent window.

async function _scopeSidePanelToAttachedTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const attached = getAttachedTabIds();
    const attachedSet = new Set(attached);
    for (const tab of allTabs) {
      if (tab.id && !attachedSet.has(tab.id)) {
        try { await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false, path: 'popup.html' }); } catch (_) {}
      }
    }
  } catch (_) {}
}

async function _enableSidePanelEverywhere() {
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (tab.id) {
        try { await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true, path: 'popup.html' }); } catch (_) {}
      }
    }
  } catch (_) {}
}

// (v3.53) When user opens a new tab during agent run, immediately disable
// the side panel on it — only agent-attached tabs should show the panel.
chrome.tabs.onCreated.addListener((tab) => {
  if (agentRunning && tab.id) {
    chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false, path: 'popup.html' }).catch(() => {});
  }
});


// ========== Unified Message Handler ==========
chrome.runtime.onMessage.addListener(wrapMessageHandler(async (request, sender) => {
  switch (request.action) {
    // Diagnostic ping — remove after startup bug is fixed
    case 'ping': {
      return { pong: true, ts: Date.now(), agentRunning: typeof agentRunning !== 'undefined' ? agentRunning : 'unknown' };
    }
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
        const payload = (request.payload && typeof request.payload === 'object' && request.payload !== null) ? { ...request.payload } : {};
        // Auto-stamp the sender info so panel rows show which tab fired.
        if (sender && sender.tab && typeof sender.tab.id === 'number') payload.tabId = sender.tab.id;
        if (sender && sender.url) payload.frameUrl = String(sender.url).substring(0, 200);
        tel[lvl](cat, msg, payload);
      } catch (_e) { /* never throw on telemetry */ }
      return { ok: true };
    }

    // (3.27.0) Telemetry-panel Past Runs bridge. The panel runs in the side
    // panel context and can't import telemetry.js directly — these handlers
    // expose the persistence read/delete API.
    case 'list_persisted_telemetry_runs': {
      try { return await listPersistedRuns(); } catch { return []; }
    }
    case 'load_persisted_telemetry_run': {
      if (!request.runId) return [];
      try { return await loadPersistedRun(request.runId); } catch { return []; }
    }
    case 'delete_persisted_telemetry_run': {
      if (!request.runId) return { ok: false, error: 'runId required' };
      try { await deletePersistedRun(request.runId); return { ok: true }; } catch (e) { console.error('[Sentinel] Error in index.js:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)); return { ok: false, error: (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e) }; }
    }

    // (3.29.0) Skill outcome bridge. Settings UI reads via list_skills_with_stats
    // to render the per-skill success-rate table, then optionally resets via
    // reset_skill_stats. Both are popup-initiated, no side effects on the agent loop.
    case 'list_skills_with_stats': {
      try { return listSkills(); } catch { return []; }
    }
    case 'get_skill_stats': {
      try { return getSkillStats(); } catch { return {}; }
    }
    case 'reset_skill_stats': {
      try { await resetSkillStats(); return { ok: true }; } catch (e) { console.error('[Sentinel] Error in index.js:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)); return { ok: false, error: (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e) }; }
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
      } catch { return []; }
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
            return { ok: false, error: 'Could not parse custom endpoint: ' + ((typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)) };
          }
        }
        const models = await fetchModelsList({ ...provider, modelsUrl }, apiKey);
        return { ok: true, models };
      } catch (e) {
        return { ok: false, error: (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e) };
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
      } catch {
        return { available: false };
      }
    }
    case 'resume_from_checkpoint': {
      // Full state restore: recover history, agentMemory, run settings,
      // trust counters, and tab contexts from the session checkpoint,
      // then start a new agent run that inherits the restored state.
      try {
        const { restoreFromCheckpoint, clearCheckpoint } = await import('./agent-engine.js');
        if (agentRunning) return { ok: false, error: 'Agent already running' };
        const result = await restoreFromCheckpoint();
        if (!result.restored) {
          return { ok: false, error: 'Cannot resume: ' + (result.error || 'unknown') };
        }
        await clearCheckpoint();
        tel.info('lifecycle', 'Agent resuming from checkpoint', {
          stepCount: result.stepCount,
          historyLength: result.historyLength,
          memoryKeys: result.memoryKeys
        });
        return await startAgent(result.goal, sender);
      } catch (e) {
        return { ok: false, error: (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e) };
      }
    }
    case 'execute_js_approval_request': {
      // Content-side defence-in-depth approval gate for execute_js.
      // When the agent-engine hasn't pre-approved (cmd.approvalGranted),
      // the content script sends this message to get user confirmation
      // before running arbitrary JS in the page context.
      //
      // If approvalMode is off in settings, auto-approve immediately
      // (the static privileged-API guard in the content script still
      // blocks the most dangerous operations). If approvalMode is on,
      // fire a notification and wait for the user to respond.
      try {
        const stored = await chrome.storage.local.get(['approvalMode']);
        if (stored.approvalMode !== true) {
          // Approval mode off — auto-approve for non-privileged code.
          // Return reason:'auto' so the content script knows this wasn't
          // explicit user approval and keeps the runtime sandbox active.
          return { approved: true, reason: 'auto' };
        }

        // Approval mode on — present the code to the user via notification
        // and wait for response.
        const requestId = crypto.randomUUID();
        const codePreview = String(request.code || '').substring(0, 500);

        return await new Promise((resolve) => {
          const finish = (payload) => {
            resolve(payload);
          };

          // Broadcast to popup so the approval card renders
          chrome.runtime.sendMessage({
            action: 'request_approval',
            payload: {
              action: 'execute_js',
              description: 'Run JS: ' + codePreview + (request.key ? ' → "' + request.key + '"' : ''),
              stepNumber: 0,
              requestId,
              ariaLabel: null,
              elementText: null,
              selector: null,
              codePreview,
              sourceUrl: request.url || ''
            },
            requestId
          }).catch((_e) => {
            console.error('[finish] Unhandled rejection:', (typeof _e === 'object' && _e !== null && 'message' in _e) ? _e.message : String(_e));
          });

          // Notify the user
          try {
            notifyIfEnabled('exec_js_approval_' + requestId, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icon-48.png'),
              title: 'Sentinel Override — JS execution approval needed',
              message: 'Code: ' + codePreview.substring(0, 100) + '...'
            });
          } catch (_e) { /* notification API may not be available */ }

          let hardRejectId = null;

          const listener = (message) => {
            if (message && message.action === 'approval_response' && message.requestId === requestId) {
              chrome.runtime.onMessage.removeListener(listener);
              clearTimeout(timeoutId);
              if (hardRejectId) clearTimeout(hardRejectId);
              finish({
                approved: message.approved === true,
                reason: message.approved ? 'user_approved' : 'user_rejected'
              });
            }
          };
          chrome.runtime.onMessage.addListener(listener);

          // Soft timeout: 60s — pause and notify
          const timeoutId = setTimeout(() => {
            chrome.runtime.onMessage.removeListener(listener);

            const replacementListener = (message) => {
              if (message && message.action === 'approval_response' && message.requestId === requestId) {
                if (hardRejectId) clearTimeout(hardRejectId);
                chrome.runtime.onMessage.removeListener(replacementListener);
                finish({
                  approved: message.approved === true,
                  reason: message.approved ? 'user_approved' : 'user_rejected'
                });
              }
            };

            // Hard-reject after 5 min total — must be defined after replacementListener
            hardRejectId = setTimeout(() => {
              chrome.runtime.onMessage.removeListener(replacementListener);
              finish({ approved: false, reason: 'approval_hard_timeout' });
            }, 240000);

            chrome.runtime.onMessage.addListener(replacementListener);
          }, 60000);
        });
      } catch (e) {
        return { approved: false, reason: (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e) };
      }
    }

    case 'execute_command': {
      const activeTab = getActiveTabId();
      if (!activeTab) throw new Error('No agent tab specified');
      const tab = activeTab;
      const cmd = request.command;
      if (!cmd || typeof cmd !== 'object' || cmd === null) throw new Error('execute_command: missing or invalid command object');

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

    case 'undo_action': {
      const { undoLastAction } = await import('./agent-engine.js');
      return await undoLastAction();
    }

    case 'quick_assist_request': {
      const qaPrompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
      if (!qaPrompt) return { text: 'Error: empty prompt' };
      const qaSystem = 'You are Sentinel Quick Assist, an AI assistant for MSP technicians. Give clear, concise, actionable answers. Format your response with markdown where helpful.';
      try {
        const text = await callLLMSimple(qaSystem, qaPrompt, 1200);
        return { text };
      } catch (err) {
        return { text: 'Error: ' + ((typeof err === 'object' && err !== null && 'message' in err) ? err.message : String(err)) };
      }
    }

    case 'inject_context': {
      if (!agentRunning) return { ok: false, error: 'No agent running' };
      const note = typeof request.note === 'string' ? request.note.trim() : '';
      if (!note) return { ok: false, error: 'Empty note' };
      injectContext(note);
      return { ok: true };
    }

    case 'get_audit_log': {
      const log = await fetchAuditLog(request.runId || null);
      return { ok: true, log, csv: auditLogToCsv(log) };
    }

    // (3.14.1) Used by the sign-in wall banner's "Focus tab" button: switch
    // the active Chrome tab+window to the URL whose auth wall caused the pause.
    case 'focus_tab_by_url': {
      try {
        const target = String(request.url || '');
        if (!target) return { ok: false, error: 'focus_tab_by_url: missing url' };
        let targetHost;
        try { targetHost = new URL(target).host; } catch { targetHost = ''; }
        const tabs = await chrome.tabs.query({});
        if (!tabs || tabs.length === 0) return { ok: false, error: 'no tabs available' };
        // Prefer exact URL match, fall back to host match (Microsoft sign-in
        // walks the user through multiple URLs on the same host).
        let match = tabs.find(t => t && t.url === target);
        if (!match && targetHost) {
          match = tabs.find(t => {
            try { return t && t.url && new URL(t.url).host === targetHost; } catch (_e) { return false; }
          });
        }
        if (!match) return { ok: false, error: 'no matching tab' };
        try { await chrome.tabs.update(match.id, { active: true }); } catch (_e) { /* tab may have closed */ }
        try { await chrome.windows.update(match.windowId, { focused: true }); } catch (_e) { /* window may have closed */ }
        return { ok: true, tabId: match.id };
      } catch (e) {
        return { ok: false, error: (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e) };
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
      if (!command || typeof command !== 'object' || command === null) {
        return { ok: false, error: 'execute_in_frame: missing or invalid command' };
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
      { const _p = chrome.action.setBadgeText({ text: '' }); if (_p && typeof _p.catch === 'function') _p.catch((e) => {
        console.error('[_p] Unhandled rejection:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e));
      }); }
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
      return null;

    // ========== Voice Input Message Forwarding (Bug #3 fix) ==========
    // Content scripts send voice messages via chrome.runtime.sendMessage;
    // we forward them to the popup so the voice input UI can update.
    case 'voice_result':
    case 'voice_interim':
    case 'voice_error':
      // Forward to popup - chrome.runtime.sendMessage broadcasts to all contexts
      chrome.runtime.sendMessage(request).catch(() => {
        // Popup might not be open, that's fine
      });
      return null;

    // ========== Context Menu Actions (v3.44) ==========
    case 'context_menu_analyze':
    case 'context_menu_extract':
    case 'context_menu_fill_form':
    case 'context_menu_screenshot':
    case 'context_menu_summarize': {
      if (agentRunning) throw new Error('Agent already running');
      const goalMap = {
        context_menu_analyze: (p) => `Analyze this page and ${p.selectionText ? `the selected text "${p.selectionText}"` : p.linkUrl ? `the link ${p.linkUrl}` : 'the current page content'}. Provide a detailed analysis.`,
        context_menu_extract: (p) => p.selectionText ? `Extract all structured data from this text: "${p.selectionText}". Return as JSON.` : 'Extract all structured data visible on the current page. Return as JSON.',
        context_menu_fill_form: () => 'Look at the current page and fill in any forms with appropriate test data.',
        context_menu_screenshot: () => 'Take a full page screenshot of the current page.',
        context_menu_summarize: () => 'Summarize the current page content concisely.',
      };
      const goal = goalMap[request.action](request.params || {});
      return await startAgent(goal, sender);
    }

    case 'context_menu_monitor_changes': {
      const { selector, label, url } = request.params || {};
      const mon = await createMonitor(url || '', selector || 'body', label || 'Page Monitor');
      return { monitor: mon };
    }

    case 'context_menu_start_recording': {
      if (isRecording()) throw new Error('Already recording');
      startRecording();
      return { recording: true };
    }

    case 'context_menu_stop_recording': {
      if (!isRecording()) throw new Error('Not recording');
      const macro = await stopRecording(request.params?.name || 'Recorded Macro');
      if (!macro) throw new Error('No steps recorded — nothing to save');
      return { macro };
    }

    case 'monitor_list':
      return await loadMonitors();

    case 'monitor_create': {
      const mon = await createMonitor(
        request.params?.url || '',
        request.params?.selector || 'body',
        request.params?.label || 'Page Monitor',
        request.params?.interval || 30
      );
      return { monitor: mon };
    }

    case 'monitor_remove': {
      if (!request.params?.id) throw new Error('Monitor ID required');
      await removeMonitor(request.params.id);
      return { removed: true };
    }

    case 'monitor_toggle': {
      if (!request.params?.id) throw new Error('Monitor ID required');
      if (typeof request.params?.active !== 'boolean') throw new Error('Active flag required');
      await toggleMonitor(request.params.id, request.params.active);
      return { toggled: true };
    }

    case 'macro_list':
      return await loadMacros();

    case 'macro_stop_recording': {
      if (!isRecording()) throw new Error('Not recording');
      const macro = await stopRecording(request.params?.name || 'Recorded Macro');
      if (!macro) throw new Error('No steps recorded — nothing to save');
      return { macro };
    }

    case 'export_html_report': {
      const log = await fetchAuditLog(request.params?.runId || null);
      if (!log || log.length === 0) throw new Error('No audit log data to export');
      const html = generateHtmlReport(log, request.params?.metadata || {});
      return { html };
    }

    case 'export_replay_report': {
      const { runLogId: reqRunId, estimatedCostUsd } = request.params || {};
      const runId = reqRunId || (await chrome.storage.local.get('run_log_index').then(r => {
        const idx = (r.run_log_index || []);
        return idx.length > 0 && idx[0] ? idx[0].runLogId : null;
      }).catch(() => null));
      if (!runId) throw new Error('No run log available to export');
      const logData = await chrome.storage.local.get('run_log_' + runId).then(r => r['run_log_' + runId]).catch(() => null);
      if (!logData || !logData.entries) throw new Error('Run log data not found');
      const html = generateReplayReport(logData.entries, { goal: logData.goal, runLogId: runId, estimatedCostUsd: estimatedCostUsd || 0 });
      return { html };
    }

    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}));

// ========== Tab Event Listeners ==========

// SSO / OAuth popup detection: when a new window opens during an agent run
// and its first tab matches a known auth host, bring it to focus and notify
// the technician so they can complete sign-in without hunting for the window.
const _SSO_HOSTS_RE = /(login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|accounts\.google\.com|login\.okta\.com|[^.]+\.okta\.com|auth0\.com|[^.]+\.auth0\.com|signin\.aws\.amazon\.com|login\.duosecurity\.com)/i;
chrome.windows.onCreated.addListener(async (win) => {
  if (!agentRunning) return;
  try {
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const ssoTab = tabs.find(t => t.url && _SSO_HOSTS_RE.test(t.url));
    if (ssoTab) {
      await chrome.windows.update(win.id, { focused: true });
      sendSilentUpdate('🔐 SSO popup detected (' + new URL(ssoTab.url).hostname + ') — sign in, then the agent will continue automatically');
    }
  } catch (e) { console.warn('[Sentinel/index] SSO popup detection failed:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)); }
});

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
  } catch (e) { console.warn('[Sentinel/index] sidePanel configuration failed:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)); }
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
              await chrome.sidePanel.open({ tabId: activeTab.id }).catch((e) => {
                console.error('[attached] Unhandled rejection:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e));
              });
            }
          } catch (_e) { /* no active tab — silently ignore */ }
        }
        break;
      }
      case 'pause-agent': {
        if (agentRunning) {
          const { pauseAgent } = await import('./agent-engine.js');
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
  } catch (e) { console.warn('Command handler error:', (typeof e === 'object' && e !== null && 'message' in e) ? e.message : String(e)); }
});
