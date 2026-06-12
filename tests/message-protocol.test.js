// tests/message-protocol.test.js
// Unit tests for background/message-protocol.js — full coverage of all
// message wrappers: sendMessage, sendRuntimeMessage, wrapMessageHandler,
// fire-and-forget helpers (sendSilentUpdate, sendActionMessage, etc.)

import { jest } from '@jest/globals';

// ---------- chrome mock ----------
let _nextTabError = null;
let _nextTabResponse = null;

globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage: jest.fn(),
  },
  tabs: {
    sendMessage: jest.fn(),
  },
};

// Helper to set up tab message response for sendMessage tests
function setupTabMessage(response, error) {
  _nextTabResponse = response;
  _nextTabError = error || null;
  chrome.runtime.lastError = null;
}

// Helper to set up runtime message response
function setupRuntimeMessage(response, error) {
  chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
    if (error) {
      chrome.runtime.lastError = { message: error };
    } else {
      chrome.runtime.lastError = null;
    }
    if (cb) cb(response);
    return Promise.resolve(response);
  });
}

const {
  sendMessage,
  sendRuntimeMessage,
  wrapMessageHandler,
  sendSilentUpdate,
  sendPageContext,
  sendActionMessage,
  sendActionResult,
  sendReportUpdate,
  sendTabStateUpdate,
  sendAgentActivity,
  sendAgentStepStart,
  sendScreenshotUpdate,
  sendAgentStatus,
  sendPlanPreview,
  sendClientKnowledgePreview,
  sendCostUpdate,
} = await import('../background/message-protocol.js');

beforeEach(() => {
  jest.clearAllMocks();
  _nextTabError = null;
  _nextTabResponse = null;
  chrome.runtime.lastError = null;
});

// ========== sendMessage ==========

describe('sendMessage', () => {
  test('resolves with response.data on success', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = null;
      cb({ ok: true, data: 'result' });
    });

    const result = await sendMessage(1, { action: 'test' });
    expect(result).toBe('result');
  });

  test('resolves with full response when data is undefined', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = null;
      cb({ ok: true, custom: 42 });
    });

    const result = await sendMessage(1, { action: 'test' });
    expect(result).toEqual({ ok: true, custom: 42 });
  });

  test('rejects on chrome.runtime.lastError', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = { message: 'tab closed' };
      cb(undefined);
    });

    await expect(sendMessage(1, { action: 'test' })).rejects.toThrow('tab closed');
  });

  test('rejects when no response', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = null;
      cb(undefined);
    });

    await expect(sendMessage(1, { action: 'test' })).rejects.toThrow('No response');
  });

  test('rejects when response.ok is false', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = null;
      cb({ ok: false, error: 'content script error' });
    });

    await expect(sendMessage(1, { action: 'test' })).rejects.toThrow('content script error');
  });

  test('rejects on timeout', async () => {
    chrome.tabs.sendMessage.mockImplementation(() => {
      // Never call callback — simulate timeout
    });

    await expect(sendMessage(1, { action: 'test' }, 50)).rejects.toThrow('timed out');
  }, 10000);
});

// ========== sendRuntimeMessage ==========

describe('sendRuntimeMessage', () => {
  test('resolves with response', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      chrome.runtime.lastError = null;
      if (cb) cb({ ok: true });
      return Promise.resolve({ ok: true });
    });

    const result = await sendRuntimeMessage({ action: 'test' });
    expect(result).toEqual({ ok: true });
  });

  test('rejects on chrome.runtime.lastError', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      chrome.runtime.lastError = { message: 'receiver does not exist' };
      if (cb) cb(undefined);
      return Promise.resolve(undefined);
    });

    await expect(sendRuntimeMessage({ action: 'test' })).rejects.toThrow('receiver does not exist');
  });

  test('rejects on timeout when callback never fires (covers L57)', async () => {
    chrome.runtime.sendMessage.mockImplementation(() => {
      // Never calls callback — simulate timeout
    });

    await expect(sendRuntimeMessage({ action: 'test' }, 50)).rejects.toThrow('timed out');
  }, 10000);
});

// ========== wrapMessageHandler ==========

describe('wrapMessageHandler', () => {
  test('returns true to keep message channel open', () => {
    const wrapped = wrapMessageHandler(async () => 'ok');
    expect(wrapped({}, {}, () => {})).toBe(true);
  });

  test('sends { ok: true, data } on success', async () => {
    const handler = async () => ({ answer: 42 });
    const wrapped = wrapMessageHandler(handler);
    let sent = null;
    wrapped({}, {}, (msg) => { sent = msg; });
    await new Promise(r => setTimeout(r, 10));
    expect(sent).toEqual({ ok: true, data: { answer: 42 } });
  });

  test('sends { ok: false, error } on rejection', async () => {
    const handler = async () => { throw new Error('boom'); };
    const wrapped = wrapMessageHandler(handler);
    let sent = null;
    wrapped({}, {}, (msg) => { sent = msg; });
    await new Promise(r => setTimeout(r, 10));
    expect(sent.ok).toBe(false);
    expect(sent.error).toBe('boom');
  });

  test('passes request and sender to handler', async () => {
    let received = null;
    const handler = async (req, snd) => { received = { req, snd }; return 'done'; };
    const wrapped = wrapMessageHandler(handler);
    const req = { action: 'x' };
    const snd = { tab: { id: 1 } };
    wrapped(req, snd, () => {});
    await new Promise(r => setTimeout(r, 10));
    expect(received.req).toBe(req);
    expect(received.snd).toBe(snd);
  });

  test('handles handler returning undefined', async () => {
    const wrapped = wrapMessageHandler(async () => {});
    let sent = null;
    wrapped({}, {}, (msg) => { sent = msg; });
    await new Promise(r => setTimeout(r, 10));
    expect(sent.ok).toBe(true);
    expect(sent.data).toBeUndefined();
  });
});

// ========== Fire-and-forget helpers ==========

describe('sendSilentUpdate', () => {
  test('sends agent_update message', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendSilentUpdate('working...', 3);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent_update', text: 'working...', stepNumber: 3, silent: true })
    );
  });

  test('defaults stepNumber to 0', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendSilentUpdate('status');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ stepNumber: 0 })
    );
  });

  test('catches send errors silently', () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('no listener'));
    expect(() => sendSilentUpdate('test')).not.toThrow();
  });
});

describe('sendPageContext', () => {
  test('sends page_context message', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPageContext('https://example.com', 'Example', 2, 42);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'page_context', url: 'https://example.com', title: 'Example', stepNumber: 2, tabId: 42 })
    );
  });

  test('defaults missing fields', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPageContext();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ url: '', title: '', stepNumber: 0, tabId: null })
    );
  });
});

describe('sendActionMessage', () => {
  test('describes click action with element label', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const cmd = { type: 'click', selector: '#btn' };
    const obs = { elements: [{ selector: '#btn', text: 'Save Settings' }] };
    sendActionMessage(cmd, 1, obs);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);

    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.action).toBe('agent_action');
    expect(msg.payload.description).toBe('Click "Save Settings"');
    expect(msg.payload.stepNumber).toBe(1);
  });

  test('truncates long element labels', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const longText = 'A'.repeat(60);
    const cmd = { type: 'click', selector: '#btn' };
    const obs = { elements: [{ selector: '#btn', text: longText }] };
    sendActionMessage(cmd, 1, obs);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);

    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toContain('...');
  });

  test('describes type action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const cmd = { type: 'type', selector: '#input', text: 'hello' };
    const obs = { elements: [{ selector: '#input', text: 'Username' }] };
    sendActionMessage(cmd, 1, obs);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Type into "Username"');
  });

  test('describes navigate action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'navigate', url: 'https://portal.example.com/dashboard' }, 2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Navigate to portal.example.com');
  });

  test('describes navigate action with invalid URL', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'navigate', url: 'not-a-url' }, 2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toContain('Navigate to not-a-url');
  });

  test('describes scroll action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'scroll', amount: 300 }, 3);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Scroll down');
    chrome.runtime.sendMessage.mockClear();
    sendActionMessage({ type: 'scroll', amount: -100 }, 4);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);

    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload?.description).toBe('Scroll up');
  });

  test('describes execute_js action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'execute_js', code: 'document.querySelectorAll(".row").length', key: 'row_count' }, 5);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toContain('save as "row_count"');
  });

  test('describes press_key action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'press_key', key: 'Enter' }, 6);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Press Enter');
  });

  test('describes wait_for_text action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'wait_for_text', text: 'Loading complete' }, 7);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toContain('Loading complete');
  });

  test('describes wait_for_element action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'wait_for_element' }, 8);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload?.description).toBe('Wait for element');
  });

  test('describes wait_for_navigation action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'wait_for_navigation' }, 9);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload?.description).toBe('Wait for navigation');
  });

  test('describes click_at action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'click_at', x: 100, y: 200 }, 10);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload?.description).toBe('Click at (100, 200)');
  });

  test('describes open_tab action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'open_tab', label: 'New Tab', url: 'https://x.com' }, 11);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload.description).toBe('Open tab: New Tab');
  });

  test('describes switch_tab action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'switch_tab', label: 'Dashboard' }, 12);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload.description).toBe('Switch to: Dashboard');
  });

  test('describes close_tab action', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'close_tab', tab_id: 5 }, 13);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload.description).toBe('Close tab: 5');
  });

  test('describes unknown action type', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'custom_action' }, 14);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload.description).toBe('custom_action');
  });

  test('truncates long text and code in payload', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const longText = 'x'.repeat(300);
    const longCode = 'y'.repeat(300);
    sendActionMessage({ type: 'type', text: longText, code: longCode }, 1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const payload = chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload;
    expect(payload.text.length).toBeLessThanOrEqual(201);
    expect(payload.code.length).toBeLessThanOrEqual(201);
  });

  test('includes enriched payload fields', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'click', selector: '#x', ref: 'r1', url: 'u', key: 'k' }, 1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const payload = chrome.runtime.sendMessage.mock.calls[0]?.[0]?.payload;
    expect(payload.selector).toBe('#x');
    expect(payload.ref).toBe('r1');
    expect(payload.url).toBe('u');
    expect(payload.key).toBe('k');
  });
});

describe('sendActionResult', () => {
  test('sends agent_action_result message', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionResult(5, 'Clicked button', false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent_action_result', stepNumber: 5, result: 'Clicked button', isError: false })
    );
  });

  test('serializes non-string result', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionResult(5, { data: 42 }, true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.isError).toBe(true);
    expect(msg.result).toBe('{"data":42}');
  });

  test('truncates result to 300 chars', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionResult(5, 'x'.repeat(500), false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.result.length).toBeLessThanOrEqual(300);
  });
});

describe('sendReportUpdate', () => {
  test('sends generating status', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendReportUpdate('generating');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'report_update', status: 'generating' });
  });

  test('includes report when provided', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const report = { title: 'Test Report' };
    sendReportUpdate('ready', report);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', report })
    );
  });

  test('includes error when provided', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendReportUpdate('error', null, 'API failed');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', error: 'API failed' })
    );
  });
});

describe('sendTabStateUpdate', () => {
  test('maps tab objects to stripped format', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendTabStateUpdate([
      { tabId: 1, label: 'Tab 1', url: 'https://a.com', title: 'A', isActive: true },
      { tabId: 2, label: 'Tab 2', url: 'https://b.com', isActive: false },
    ]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.action).toBe('tab_state_update');
    expect(msg.tabs).toEqual([
      { tabId: 1, label: 'Tab 1', url: 'https://a.com', title: 'A', isActive: true },
      { tabId: 2, label: 'Tab 2', url: 'https://b.com', title: '', isActive: false },
    ]);
  });

  test('handles null/empty tabs array', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendTabStateUpdate(null);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.tabs).toEqual([]);
  });
});

describe('sendAgentActivity', () => {
  test('sends agent_activity message with all fields', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentActivity(3, 'observe', 'Observing page', 'in_progress', { durationMs: 150 });
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.action).toBe('agent_activity');
    expect(msg.stepNumber).toBe(3);
    expect(msg.key).toBe('observe');
    expect(msg.label).toBe('Observing page');
    expect(msg.status).toBe('in_progress');
    expect(msg.detail).toEqual({ durationMs: 150 });
    expect(typeof msg.timestamp).toBe('number');
  });

  test('defaults missing fields', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentActivity();
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.stepNumber).toBe(0);
    expect(msg.key).toBe('misc');
    expect(msg.label).toBe('');
    expect(msg.status).toBe('in_progress');
    expect(msg.detail).toBeNull();
  });
});

describe('sendAgentStepStart', () => {
  test('sends step start message', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentStepStart(5, 10);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.action).toBe('agent_step_start');
    expect(msg.stepNumber).toBe(5);
    expect(msg.totalPlannedSteps).toBe(10);
    expect(typeof msg.timestamp).toBe('number');
  });

  test('defaults missing fields', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentStepStart();
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.stepNumber).toBe(0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(chrome.runtime.sendMessage.mock.calls[0]?.[0]?.totalPlannedSteps).toBe(0);
  });
});

describe('sendScreenshotUpdate', () => {
  test('sends screenshot when base64Image provided', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendScreenshotUpdate('base64data', 3);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screenshot_update', base64Image: 'base64data', stepNumber: 3 })
    );
  });

  test('skips sending when base64Image is falsy', () => {
    sendScreenshotUpdate(null, 3);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    sendScreenshotUpdate('', 3);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ========== Phase 9 message helpers ==========

describe('sendAgentStatus', () => {
  test('sends agent_status message with state and text', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentStatus('thinking', 'Analyzing context...');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent_status', state: 'thinking', text: 'Analyzing context...' })
    );
  });

  test('includes a timestamp string', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentStatus('observing', 'Reading page...');
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    const call = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(call.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test('defaults state to idle when not provided', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentStatus(null, 'text');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'idle' })
    );
  });

  test('defaults text to empty string when not provided', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendAgentStatus('waiting');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '' })
    );
  });

  test('catches send errors silently', () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('no listener'));
    expect(() => sendAgentStatus('thinking', 'test')).not.toThrow();
  });
});

describe('sendPlanPreview', () => {
  test('sends plan_preview with steps and count', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const steps = ['Step 1: Login', 'Step 2: Navigate', 'Step 3: Click'];
    sendPlanPreview(steps, 3);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'plan_preview', steps, estimatedSteps: 3 })
    );
  });

  test('skips sending when steps array is empty', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPlanPreview([], 0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('catches send errors silently', () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('no listener'));
    expect(() => sendPlanPreview(['step'], 1)).not.toThrow();
  });
});

describe('sendClientKnowledgePreview', () => {
  test('sends client_knowledge_preview with mapped facts and clientName', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const entries = [{ id: '1', wisdom: 'Admin IP: 192.168.1.1', scope: 'global', extra: 'ignored' }];
    sendClientKnowledgePreview('ACME Corp', entries);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_knowledge_preview',
        clientName: 'ACME Corp',
        count: 1,
        facts: [{ id: '1', wisdom: 'Admin IP: 192.168.1.1', scope: 'global' }],
      })
    );
  });

  test('skips sending when entries are empty', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendClientKnowledgePreview('client', []);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('catches send errors silently', () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('no listener'));
    expect(() => sendClientKnowledgePreview('client', [{ id: '1', wisdom: 'x', scope: 'y' }])).not.toThrow();
  });
});

describe('sendCostUpdate', () => {
  test('sends cost_update with cost and token counts', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendCostUpdate(0.0042, 1000, 500, 3);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cost_update',
        estimatedCostUsd: 0.0042,
        inputTokens: 1000,
        outputTokens: 500,
        callCount: 3,
      })
    );
  });

  test('handles zero cost with defaults', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendCostUpdate(0, 0, 0, 0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCostUsd: 0, callCount: 0 })
    );
  });

  test('catches send errors silently', () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('no listener'));
    expect(() => sendCostUpdate(0.01, 100, 50, 1)).not.toThrow();
  });
});

// ========== Branch coverage additions ==========

describe('sendMessage — non-string lastError (line 29 false branch)', () => {
  test('rejects using raw lastError object when lastError.message is not a string', async () => {
    chrome.tabs.sendMessage.mockImplementation((_tabId, _msg, cb) => {
      chrome.runtime.lastError = { code: 42 };
      cb(undefined);
    });
    await expect(sendMessage(1, { action: 'test' })).rejects.toThrow();
  });

  test('rejects with "Unknown content script error" when response.error is falsy (line 38 branch)', async () => {
    chrome.tabs.sendMessage.mockImplementation((_tabId, _msg, cb) => {
      chrome.runtime.lastError = null;
      cb({ ok: false });
    });
    await expect(sendMessage(1, { action: 'test' })).rejects.toThrow('Unknown content script error');
  });
});

describe('sendRuntimeMessage — non-string lastError (line 63 false branch)', () => {
  test('rejects using raw lastError object when lastError.message is not a string', async () => {
    chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
      chrome.runtime.lastError = { code: 99 };
      cb(undefined);
    });
    await expect(sendRuntimeMessage({ action: 'test' })).rejects.toThrow();
  });
});

describe('wrapMessageHandler — String(err) branch (line 87)', () => {
  test('uses String(err) when thrown error has no .message property', async () => {
    const handler = wrapMessageHandler(async () => { throw { code: 'BAD_INPUT' }; });
    const sendResponse = jest.fn();
    handler({ action: 'test' }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: '[object Object]' })
    );
  });
});

describe('sendPageContext — non-positive totalSteps (line 130 false branch)', () => {
  test('defaults totalSteps to 0 when value is 0', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPageContext('https://x.com', 'Title', 1, 1, 0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ totalSteps: 0 })
    );
  });

  test('defaults totalSteps to 0 when value is negative', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPageContext('https://x.com', 'Title', 1, 1, -3);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ totalSteps: 0 })
    );
  });

  test('passes totalSteps when value is a positive number (line 130 true branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPageContext('https://x.com', 'Title', 1, 1, 5);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ totalSteps: 5 })
    );
  });
});

describe('sendActionMessage — _describeCommand element label branches (lines 146-148)', () => {
  test('describes hover with matching element label (line 146)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage(
      { type: 'hover', selector: '#tooltip-btn' },
      1,
      { elements: [{ selector: '#tooltip-btn', text: 'More info' }] }
    );
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Hover "More info"');
  });

  test('describes select with matching element label (line 147)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage(
      { type: 'select', selector: '#dropdown' },
      1,
      { elements: [{ selector: '#dropdown', text: 'Country' }] }
    );
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Select in "Country"');
  });

  test('describes extract with matching element label (line 148)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage(
      { type: 'extract', selector: '.result-text' },
      1,
      { elements: [{ selector: '.result-text', text: 'Total Revenue' }] }
    );
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Extract from "Total Revenue"');
  });

  test('describes scroll without amount using 0 fallback — Scroll down (line 156 || branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'scroll' }, 5);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Scroll down');
  });

  test('describes execute_js without key uses "Run JS:" format (line 159 false branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'execute_js', code: 'document.title' }, 5);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toMatch(/^Run JS:/);
    expect(msg.payload.description).not.toContain('save as');
  });

  test('describes execute_js without code uses empty preview (line 158 || branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'execute_js' }, 5);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Run JS: ...');
  });

  test('describes press_key without key defaults to Enter (line 161 || branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'press_key' }, 6);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Press Enter');
  });

  test('describes wait_for_text without text defaults to empty string (line 162 || branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'wait_for_text' }, 7);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Wait for text: ""');
  });

  test('describes open_tab without label falls back to url (line 166 || branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'open_tab', url: 'https://example.com' }, 11);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Open tab: https://example.com');
  });

  test('describes switch_tab without label falls back to tab_id (line 167 || branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage({ type: 'switch_tab', tab_id: 42 }, 12);
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.description).toBe('Switch to: 42');
  });
});

describe('sendActionMessage — payload branch coverage (lines 198-226)', () => {
  test('resolves element text into targetText when matching element exists (line 198 true branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage(
      { type: 'click', selector: '#save-btn' },
      1,
      { elements: [{ selector: '#save-btn', text: 'Save Changes' }] }
    );
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.targetText).toBe('Save Changes');
  });

  test('includes reasoning when __reasoning is a non-empty string (line 224 true branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage(
      { type: 'click', selector: '#btn', __reasoning: 'Submitting the form' },
      1
    );
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.reasoning).toBe('Submitting the form');
  });

  test('omits reasoning when __reasoning is empty string (line 224 false branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage(
      { type: 'click', selector: '#btn', __reasoning: '' },
      1
    );
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.reasoning).toBeUndefined();
  });

  test('includes confidence when __confidence is a number (line 226 true branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendActionMessage(
      { type: 'click', selector: '#btn', __confidence: 0.85 },
      1
    );
    const msg = chrome.runtime.sendMessage.mock.calls[0]?.[0];
    expect(msg.payload.confidence).toBe(0.85);
  });
});

describe('sendScreenshotUpdate — viewportMeta branches (lines 349-350)', () => {
  test('includes viewport dimensions when viewportMeta is provided (true branch)', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendScreenshotUpdate('base64data', 3, { width: 1280, height: 720 });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ viewportW: 1280, viewportH: 720 })
    );
  });
});

describe('sendClientKnowledgePreview — clientName fallback (line 423)', () => {
  test('defaults clientName to "Unknown Client" when null is passed', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendClientKnowledgePreview(null, [{ id: '1', wisdom: 'tip', scope: 'global' }]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: 'Unknown Client' })
    );
  });
});

describe('sendPlanPreview — estimatedSteps fallback (line 435)', () => {
  test('defaults estimatedSteps to steps.length when not provided', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const steps = ['Step 1', 'Step 2', 'Step 3'];
    sendPlanPreview(steps);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedSteps: 3 })
    );
  });
});

describe('sendMessage — empty-string lastError.message (line 29 || fallback)', () => {
  test('uses fallback message when lastError.message is empty string', async () => {
    chrome.tabs.sendMessage.mockImplementation((_tabId, _msg, cb) => {
      chrome.runtime.lastError = { message: '' };
      cb(undefined);
      chrome.runtime.lastError = null;
    });
    await expect(sendMessage(1, { action: 'test' })).rejects.toThrow('Content script message failed');
  });
});

describe('sendRuntimeMessage — empty-string lastError.message (line 63 || fallback)', () => {
  test('uses fallback message when lastError.message is empty string', async () => {
    chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
      chrome.runtime.lastError = { message: '' };
      cb(undefined);
      chrome.runtime.lastError = null;
    });
    await expect(sendRuntimeMessage({ action: 'test' })).rejects.toThrow('Runtime message failed');
  });
});

describe('sendPageContext — non-number totalSteps (line 130 && short-circuit)', () => {
  test('defaults totalSteps to 0 when value is a string', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPageContext(1, {}, 'Title', 1, 'not-a-number');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ totalSteps: 0 })
    );
  });

  test('defaults totalSteps to 0 when value is undefined', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    sendPageContext(1, {}, 'Title', 1, undefined);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ totalSteps: 0 })
    );
  });
});

describe('sendActionMessage — resolvedText stays empty (line 198 && branches)', () => {
  test('targetText is empty when matching element has no text', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const cmd = { type: 'click', selector: '#btn' };
    const obs = { elements: [{ selector: '#btn' }] }; // no .text property
    sendActionMessage(cmd, 1, obs);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ targetText: '' }) })
    );
  });

  test('targetText is empty when element text is "No label"', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());
    const cmd = { type: 'click', selector: '#btn' };
    const obs = { elements: [{ selector: '#btn', text: 'No label' }] };
    sendActionMessage(cmd, 1, obs);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ targetText: '' }) })
    );
  });
});
