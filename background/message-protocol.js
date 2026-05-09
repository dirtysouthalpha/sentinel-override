// Sentinel Override v3 — Message Protocol
// Standardized message send/receive wrappers with { ok, data, error } envelope.
// Pure utility module — imports NOTHING from other background modules (no circular dependency risk).
// NOTE: tab-context.js imports sendTabStateUpdate from this module. This is acceptable
// because tab-context.js does not re-export anything from message-protocol.js, and
// message-protocol.js never imports from tab-context.js.

/**
 * Promise wrapper around chrome.tabs.sendMessage.
 * Checks chrome.runtime.lastError, rejects on error,
 * rejects if response.ok is false, resolves with response.data.
 *
 * @param {number} tabId
 * @param {object} message
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<any>} response.data on success
 */
export function sendMessage(tabId, message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Message to tab ${tabId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from content script'));
        return;
      }
      if (response.ok === false) {
        reject(new Error(response.error || 'Unknown content script error'));
        return;
      }
      resolve(response.data !== undefined ? response.data : response);
    });
  });
}

/**
 * Promise wrapper around chrome.runtime.sendMessage for popup-to-background communication.
 * Checks chrome.runtime.lastError, rejects on error, resolves with response.
 *
 * @param {object} message
 * @returns {Promise<any>} response on success
 */
export function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Returns a (request, sender, sendResponse) => true function that wraps an async handler.
 * On success: sendResponse({ ok: true, data: result })
 * On failure: sendResponse({ ok: false, error: err.message })
 * Always returns true to keep the message channel open for async responses.
 *
 * @param {function} asyncHandler - async (request, sender) => result
 * @returns {function} (request, sender, sendResponse) => true
 */
export function wrapMessageHandler(asyncHandler) {
  return (request, sender, sendResponse) => {
    asyncHandler(request, sender)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open
  };
}

/**
 * Send a silent status update to the popup (step log area or status bar).
 * stepNumber tags the message to a specific step card in the UI.
 * Pass 0 or omit for pre-loop messages (planning, startup).
 *
 * @param {string} text
 * @param {number} [stepNumber=0]
 */
export function sendSilentUpdate(text, stepNumber) {
  chrome.runtime.sendMessage({
    action: 'agent_update',
    text,
    stepNumber: stepNumber || 0,
    silent: true
  }).catch(() => { console.log(text); });
}

export function sendPageContext(url, pageTitle, stepNumber, tabId) {
  chrome.runtime.sendMessage({
    action: 'page_context',
    url: url || '',
    title: pageTitle || '',
    stepNumber: stepNumber || 0,
    tabId: typeof tabId === 'number' ? tabId : null
  }).catch(() => {});
}

/**
 * Send an action message to the popup (shows an action card).
 *
 * @param {object} command - The command object from the LLM
 * @param {number} stepNumber - Current step number
 * @param {object} [observation] - The page observation (with elements array)
 */
export function sendActionMessage(command, stepNumber, observation) {
  let description;
  if (['click', 'type', 'hover', 'select', 'extract'].includes(command.type) && observation && observation.elements) {
    const el = observation.elements.find(e => e.selector === command.selector);
    if (el && el.text && el.text !== 'No label') {
      const label = el.text.length > 50 ? el.text.substring(0, 47) + '...' : el.text;
      description = command.type === 'click' ? `Click "${label}"` : command.type === 'hover' ? `Hover "${label}"` : command.type === 'select' ? `Select in "${label}"` : command.type === 'extract' ? `Extract from "${label}"` : `Type into "${label}"`;
    } else {
      description = `${command.type} element`;
    }
  } else if (command.type === 'navigate' && command.url) {
    try { description = `Navigate to ${new URL(command.url).hostname}`; } catch (e) { description = `Navigate to ${command.url}`; }
  } else if (command.type === 'scroll') {
    description = `Scroll ${(command.amount || 0) >= 0 ? 'down' : 'up'}`;
  } else if (command.type === 'execute_js') {
    const codePreview = (command.code || '').substring(0, 60).replace(/\n/g, ' ');
    description = command.key ? `Run JS → save as "${command.key}": ${codePreview}...` : `Run JS: ${codePreview}...`;
  } else if (command.type === 'press_key') {
    description = `Press ${command.key || 'Enter'}`;
  } else if (command.type === 'wait_for_text') {
    description = `Wait for text: "${(command.text || '').substring(0, 40)}"`;
  } else if (command.type === 'wait_for_element') {
    description = `Wait for element`;
  } else if (command.type === 'wait_for_navigation') {
    description = `Wait for navigation`;
  } else if (command.type === 'click_at') {
    description = `Click at (${command.x}, ${command.y})`;
  } else if (command.type === 'open_tab') {
    description = `Open tab: ${command.label || command.url}`;
  } else if (command.type === 'switch_tab') {
    description = `Switch to: ${command.label || command.tab_id}`;
  } else if (command.type === 'close_tab') {
    description = `Close tab: ${command.label || command.tab_id}`;
  } else {
    description = `${command.type}`;
  }
  // (3.7.1) Enriched payload — include the raw command fields so the popup's
  // describeActionPlain helper (and the active-tab strip) can render a rich,
  // human-readable live status with the actual click target text, typed value,
  // URL, key name, etc. Truncate `text` and `code` so we don't ship huge
  // payloads through the message bus.
  const enrichedText = (typeof command.text === 'string' && command.text.length > 200)
    ? command.text.slice(0, 200) + '…'
    : command.text;
  const enrichedCode = (typeof command.code === 'string' && command.code.length > 200)
    ? command.code.slice(0, 200) + '…'
    : command.code;
  // Resolve the visible text of the clicked/hovered element so the popup can
  // show "Clicking 'Save'" rather than "Clicking button.save-btn".
  let resolvedText = '';
  try {
    if (observation && observation.elements && command.selector) {
      const el = observation.elements.find(e => e.selector === command.selector);
      if (el && el.text && el.text !== 'No label') resolvedText = el.text;
    }
  } catch (e) {}
  chrome.runtime.sendMessage({
    action: 'agent_action',
    payload: {
      type: command.type,
      description,
      stepNumber,
      // raw command fields for richer popup rendering
      selector: command.selector,
      ref: command.ref,
      url: command.url,
      key: command.key,
      value: command.value,
      label: command.label,
      attribute: command.attribute,
      x: command.x,
      y: command.y,
      amount: command.amount,
      checked: command.checked,
      frame_index: command.frame_index,
      fields: command.fields,
      text: enrichedText,
      code: enrichedCode,
      targetText: resolvedText
    }
  }).catch(() => {});
}

/**
 * Send an action result update to the popup (updates an action card with success/failure).
 *
 * @param {number} stepNumber
 * @param {string} result
 * @param {boolean} isError
 */
export function sendActionResult(stepNumber, result, isError) {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  chrome.runtime.sendMessage({
    action: 'agent_action_result',
    stepNumber,
    result: resultStr.substring(0, 300),
    isError: !!isError
  }).catch(() => {});
}

/**
 * Send a report update to the popup (generating, ready, or error).
 * Fire-and-forget messaging pattern consistent with other send functions.
 *
 * @param {string} status - 'generating' | 'ready' | 'error'
 * @param {object} [report] - The report object (when ready)
 * @param {string} [error] - Error message (when status is 'error')
 */
export function sendReportUpdate(status, report, error) {
  const message = { action: 'report_update', status };
  if (report) message.report = report;
  if (error) message.error = error;
  chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Send a tab state update to the popup (renders the tab bar).
 *
 * @param {Array<object>} tabs - Array of TabContext-shaped objects
 */
export function sendTabStateUpdate(tabs) {
  chrome.runtime.sendMessage({
    action: 'tab_state_update',
    tabs: (tabs || []).map(t => ({
      tabId: t.tabId,
      label: t.label,
      url: t.url,
      title: t.title || '',
      isActive: !!t.isActive
    }))
  }).catch(() => {});
}

/**
 * (3.7.1) Forward the latest captured screenshot to the popup so the live
 * mini-shot panel can render the agent's-eye view. Fire-and-forget.
 *
 * @param {string} base64Image - JPEG base64 (without the data: prefix)
 * @param {number} stepNumber
 */
export function sendScreenshotUpdate(base64Image, stepNumber) {
  if (!base64Image) return;
  chrome.runtime.sendMessage({
    action: 'screenshot_update',
    base64Image,
    stepNumber: stepNumber || 0
  }).catch(() => {});
}
