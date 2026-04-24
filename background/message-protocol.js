// Sentinel Override v3 — Message Protocol
// Standardized message send/receive wrappers with { ok, data, error } envelope.
// Pure utility module — imports NOTHING from other background modules (no circular dependency risk).

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
    description = `Run custom JS`;
  } else if (command.type === 'press_key') {
    description = `Press ${command.key || 'Enter'}`;
  } else if (command.type === 'wait_for_text') {
    description = `Wait for text: "${(command.text || '').substring(0, 40)}"`;
  } else if (command.type === 'wait_for_element') {
    description = `Wait for element`;
  } else if (command.type === 'wait_for_navigation') {
    description = `Wait for navigation`;
  } else {
    description = `${command.type}`;
  }
  chrome.runtime.sendMessage({
    action: 'agent_action',
    payload: { type: command.type, description, stepNumber }
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
    result: resultStr.substring(0, 120),
    isError: !!isError
  }).catch(() => {});
}
