// Sentinel Override v3 — Service Worker Entry Point
// Wires all modules together and handles message routing.

import { startAgent, stopAgent, agentRunning } from './agent-engine.js';
import { wrapMessageHandler, sendSilentUpdate, sendActionMessage, sendActionResult } from './message-protocol.js';
import { waitForPageLoad, injectContentScript, sendMessageWithRetry, takeScreenshot, isValidUrl } from './tab-manager.js';
import { setSPATransitionPending } from './shared-state.js';
import { enumerateFrames, executeInFrame, resolveFrameForSelector } from './frame-router.js';
import { getActiveTabId, getTabContext, getAllTabContexts, handleTabRemoved } from './tab-context.js';
import { generateReport } from './report-generator.js';

// ========== One-time migration ==========
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['api_endpoint', 'model'], (result) => {
    const updates = {};
    if (result.api_endpoint && result.api_endpoint.includes('bigmodel.cn')) updates.api_endpoint = '';
    if (result.model && (result.model.includes('glm-4.6v-flash') || result.model.includes('glm-4v-'))) updates.model = '';
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
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
