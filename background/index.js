// Sentinel Override v3 — Service Worker Entry Point
// Wires all modules together and handles message routing.

import { startAgent, stopAgent, agentRunning } from './agent-engine.js';
import { wrapMessageHandler, sendSilentUpdate, sendActionMessage, sendActionResult } from './message-protocol.js';
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl } from './tab-manager.js';
import { setSPATransitionPending } from './shared-state.js';
import { enumerateFrames, executeInFrame, resolveFrameForSelector } from './frame-router.js';
import { getActiveTabId, getTabContext, getAllTabContexts, handleTabRemoved } from './tab-context.js';
import { generateReport } from './report-generator.js';
import { migrateLegacySettings } from './provider-registry.js';
import { listTemplates, getTemplate, saveTemplate, updateTemplate, deleteTemplate, resolveTemplateGoal } from './template-manager.js';
import { createSchedule, listSchedules, deleteSchedule, toggleSchedule, executeScheduledTask, getScheduleResults, getRecentResults, clearScheduleResults, initScheduler } from './scheduler.js';
import { exportTemplate, exportAllTemplates, validateImport, importTemplates, exportReportAsMarkdown } from './collaboration.js';

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

// ========== Tab Locking ==========
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'popup.html' });
});

// ========== Unified Message Handler ==========
chrome.runtime.onMessage.addListener(wrapMessageHandler(async (request, sender) => {
  switch (request.action) {
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
      const frameId = await resolveFrameForSelector(getActiveTabId(), frameIndex);
      if (!frameId) throw new Error('Frame ' + frameIndex + ' not found');
      return await executeInFrame(getActiveTabId(), frameId, command);
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

// Track user tab switches for popup UI awareness only.
// Do NOT change the agent's active tab when the user switches.
// Per CONTEXT.md decision: agent ignores user's manual tab switches.
chrome.tabs.onActivated.addListener((activeInfo) => {
  // This listener exists for future popup UI features.
  // No action needed -- agent ignores user tab switches per CONTEXT.md decision.
});
