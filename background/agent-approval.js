// agent-approval.js
// Extracted from agent-engine.js — Approval Mode functions.
// Action description + approval flow with Chrome runtime messaging.

import { getErrorMessage } from './error-utils.js';
import { sendSilentUpdate } from './message-protocol.js';
import { notifyIfEnabled, startSwKeepalive, stopSwKeepalive } from './shared-state.js';
import { ONE_MINUTE_MS } from './constants.js';

function _describeTarget(cmd) {
  if (!cmd) return '(no target)';
  // Prefer human-readable labels over raw CSS selectors for approval card readability
  if (cmd.description) return `"${String(cmd.description).slice(0, 80)}"`;
  if (cmd.ariaLabel) return `"${String(cmd.ariaLabel).slice(0, 80)}"`;
  if (cmd.elementText) return `"${String(cmd.elementText).slice(0, 80)}"`;
  if (cmd.label) return `"${String(cmd.label).slice(0, 80)}"`;
  if (cmd.selector) return cmd.selector;
  if (cmd.ref) return `ref:${cmd.ref}`;
  if (typeof cmd.x === 'number' && typeof cmd.y === 'number') return `(${cmd.x},${cmd.y})`;
  return '(no target)';
}

function describeAction(command) {
  switch (command.type) {
    case 'navigate_back':    return 'Navigate back';
    case 'navigate_forward': return 'Navigate forward';
    case 'click':        return `Click: ${_describeTarget(command)}${command._matchedByVisual ? ' [visual match]' : ''}`;
    case 'right_click':  return `Right-click: ${_describeTarget(command)}`;
    case 'double_click': return `Double-click: ${_describeTarget(command)}`;
    case 'drag_and_drop':return `Drag ${_describeTarget({ ref: command.source_ref, selector: command.source_selector, label: command.source_label })} → ${_describeTarget({ ref: command.target_ref, selector: command.target_selector, label: command.target_label })}`;
    case 'click_at':    return `Click at: ${_describeTarget(command)}`;
    case 'type':        return `Type into ${_describeTarget(command)}: '${(command.text || '').toString().slice(0, 80)}'${command._matchedByVisual ? ' [visual match]' : ''}`;
    case 'navigate':    return `Navigate to ${command.url || '(no url)'}`;
    case 'scroll':      return `Scroll ${(command.amount || 0) >= 0 ? 'down' : 'up'}`;
    case 'scroll_to':   return `Scroll to ${_describeTarget(command)}`;
    case 'select':      return `Select "${command.value || ''}" in ${_describeTarget(command)}`;
    case 'hover':       return `Hover: ${_describeTarget(command)}`;
    case 'check':       return `Check: ${_describeTarget(command)}`;
    case 'check_all':   return `Check all matching ${_describeTarget(command)}`;
    case 'press_key':   return `Press: ${command.key || '(no key)'}`;
    case 'execute_js':  return `Run JS: ${(command.code || '').toString().slice(0, 60)}${command.key ? ` → ${command.key}` : ''}`;
    case 'extract':     return `Extract "${command.key || ''}" from ${_describeTarget(command)}`;
    case 'extract_list':return `Extract list "${command.key || ''}" from ${_describeTarget(command)}`;
    case 'open_tab':    return `Open tab: ${command.label || command.url || '(no url)'}`;
    case 'switch_tab':  return `Switch to: ${command.label || command.tab_id || ''}`;
    case 'close_tab':   return `Close tab: ${command.label || command.tab_id || ''}`;
    case 'note':        return `Note: ${(command.text || command.summary || '').toString().slice(0, 80)}`;
    case 'finish':      return `Finish: ${(command.summary || '').toString().slice(0, 80)}`;
    case 'wait_for_text':       return `Wait for text: "${(command.text || '').toString().slice(0, 60)}"`;
    case 'wait_for_element':    return `Wait for element: ${_describeTarget(command)}`;
    case 'wait_for_navigation': return 'Wait for navigation';
    case 'read_page':   return 'Read page';
    case 'dismiss_overlay': return 'Dismiss overlay';
    case 'lookup':            return `DNS lookup: ${command.domain || '(no domain)'} (${command.record_type || 'A'})`;
    case 'run_remote_command': return `Remote cmd (${command.command_type || 'powershell'}): ${(command.command || '').toString().slice(0, 60)}`;
    default: return `${command.type}: ${JSON.stringify(command).slice(0, 100)}`;
  }
}

async function requestApproval(command, stepNumber, { onPause, onResume } = {}) {
  const description = describeAction(command);
  const requestId = crypto.randomUUID();
  const kaName = 'approval_' + requestId;
  try { startSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
  return new Promise((resolve) => {
    const finish = (payload) => {
      try { stopSwKeepalive(kaName); } catch (e) { console.error('[Sentinel] Error in agent-engine.js:', getErrorMessage(e)); }
      resolve(payload);
    };
    chrome.runtime.sendMessage({
      action: 'request_approval',
      payload: { action: command.type, description, stepNumber, requestId,
        ariaLabel: command.ariaLabel || null,
        elementText: command.elementText || null,
        selector: command.selector || null },
      requestId
    }).catch((e) => {
      console.error('[finish] Unhandled rejection:', e);
    });
    const listener = (message) => {
      if (message && message.action === 'approval_response' && message.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        if (onResume) onResume(); // clear pause if response arrives during soft-timeout
        finish({
          approved: !!message.approved,
          skipped: !!message.skipped,
          rejected: !!message.rejected
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    const timeoutId = setTimeout(async () => {
      if (onPause) onPause();
      sendSilentUpdate('⏸ Approval pending — agent paused. Click Approve/Reject in the chat or the notification to continue.', stepNumber);
      try {
        await notifyIfEnabled(`approval_pending_${requestId}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon-48.png'),
          title: 'Sentinel Override — Approval needed',
          message: `Step ${stepNumber}: ${description.substring(0, 100)}. Open Sentinel to approve or reject.`
        });
      } catch (_e) {
      }
      const hardRejectId = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        chrome.runtime.onMessage.removeListener(hardTimeoutListener);
        if (onResume) onResume(); // unblock loop so it can clean up
        finish({ approved: false, skipped: false, rejected: true, reason: 'approval_hard_timeout' });
      }, 240000);
      const origListener = listener;
      chrome.runtime.onMessage.removeListener(origListener);
      const hardTimeoutListener = (message) => {
        if (message && message.action === 'approval_response' && message.requestId === requestId) {
          clearTimeout(hardRejectId);
          if (onResume) onResume();
          chrome.runtime.onMessage.removeListener(hardTimeoutListener);
          finish({
            approved: !!message.approved,
            skipped: !!message.skipped,
            rejected: !!message.rejected
          });
        }
      };
      chrome.runtime.onMessage.addListener(hardTimeoutListener);
    }, ONE_MINUTE_MS);
  });
}

export {
  _describeTarget,
  describeAction,
  requestApproval,
};
