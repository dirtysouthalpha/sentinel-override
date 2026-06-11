/**
 * Branch coverage tests for background/tab-manager.js
 * Targets uncovered paths in sendMessageWithRetry, cdpDispatchKey,
 * cdpDispatchClick, cdpDispatchType, and cdpExecuteJs.
 */

import { jest } from '@jest/globals';

// Mock sleep to be a no-op so CDP retries don't introduce real delays.
jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: jest.fn((e) => (e && e.message) || String(e)),
  sleep: jest.fn(async () => {}),
}));

const sendMessageMock = jest.fn();
const attachMock = jest.fn(async () => {});
const debuggerSendCommandMock = jest.fn(async () => ({}));
const executeScriptMock = jest.fn(async () => []);

globalThis.chrome = {
  tabs: {
    get: jest.fn((tabId, cb) => { if (cb) cb({ id: tabId, status: 'complete' }); }),
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    sendMessage: sendMessageMock,
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    sendMessage: jest.fn(async () => {}),
  },
  scripting: { executeScript: executeScriptMock },
  debugger: {
    attach: attachMock,
    detach: jest.fn(async () => {}),
    sendCommand: debuggerSendCommandMock,
    onEvent: { addListener: jest.fn() },
    onDetach: { addListener: jest.fn() },
  },
};

const {
  sendMessageWithRetry,
  cdpDispatchKey,
  cdpDispatchClick,
  cdpDispatchType,
  cdpExecuteJs,
  waitForPageReady,
  getTabInfo,
} = await import('../background/tab-manager.js');

const TAB = 11111;

beforeEach(() => {
  jest.clearAllMocks();
  // re-assign mocks that may have been cleared
  attachMock.mockResolvedValue(undefined);
  debuggerSendCommandMock.mockResolvedValue({});
  executeScriptMock.mockResolvedValue([]);
  sendMessageMock.mockResolvedValue(null);
});

// ── sendMessageWithRetry ─────────────────────────────────────────────────────

describe('sendMessageWithRetry — response.ok = false → throws', () => {
  test('throws with response.error when response.ok is false', async () => {
    sendMessageMock.mockResolvedValue({ ok: false, error: 'Element not found' });
    await expect(sendMessageWithRetry(TAB, { action: 'click' }, 1)).rejects.toThrow('Element not found');
  });

  test('throws with default message when ok=false and no error field', async () => {
    sendMessageMock.mockResolvedValue({ ok: false });
    await expect(sendMessageWithRetry(TAB, { action: 'click' }, 1)).rejects.toThrow('Content script error');
  });
});

describe('sendMessageWithRetry — data unwrap paths', () => {
  test('unwraps response.data when present', async () => {
    sendMessageMock.mockResolvedValueOnce({ ok: true, data: { key: 'value' } });
    const result = await sendMessageWithRetry(TAB, { action: 'get_data' });
    expect(result).toEqual({ key: 'value' });
  });

  test('returns full response when ok=true and no .data field', async () => {
    sendMessageMock.mockResolvedValueOnce({ ok: true, foo: 'bar' });
    const result = await sendMessageWithRetry(TAB, { action: 'get' });
    expect(result).toEqual({ ok: true, foo: 'bar' });
  });

  test('unwraps single-key {result: x} inner wrapper', async () => {
    sendMessageMock.mockResolvedValueOnce({ ok: true, data: { result: 'inner-value' } });
    const result = await sendMessageWithRetry(TAB, { action: 'execute_command' });
    expect(result).toBe('inner-value');
  });

  test('does not unwrap multi-key objects (not the result wrapper)', async () => {
    sendMessageMock.mockResolvedValueOnce({ ok: true, data: { result: 'a', extra: 'b' } });
    const result = await sendMessageWithRetry(TAB, { action: 'get' });
    expect(result).toEqual({ result: 'a', extra: 'b' });
  });

  test('does not unwrap arrays', async () => {
    sendMessageMock.mockResolvedValueOnce({ ok: true, data: ['a', 'b'] });
    const result = await sendMessageWithRetry(TAB, { action: 'list' });
    expect(result).toEqual(['a', 'b']);
  });
});

describe('sendMessageWithRetry — retry on failure', () => {
  test('retries after failure and succeeds on second attempt', async () => {
    // First call throws; executeScript also throws so csListener.cancel() is called
    sendMessageMock
      .mockRejectedValueOnce(new Error('tab not ready'))
      .mockResolvedValueOnce({ ok: true, data: 'success' });
    executeScriptMock.mockRejectedValueOnce(new Error('inject failed'));

    const result = await sendMessageWithRetry(TAB, { action: 'click' }, 2);
    expect(result).toBe('success');
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });

  test('throws after all retries exhausted', async () => {
    sendMessageMock.mockRejectedValue(new Error('persistent error'));
    executeScriptMock.mockRejectedValue(new Error('inject failed'));

    await expect(sendMessageWithRetry(TAB, { action: 'click' }, 3)).rejects.toThrow('persistent error');
    expect(sendMessageMock).toHaveBeenCalledTimes(3);
  });
});

// ── cdpDispatchKey ───────────────────────────────────────────────────────────

describe('cdpDispatchKey — unknown key returns error', () => {
  test('multi-char unrecognized key returns {ok:false}', async () => {
    const result = await cdpDispatchKey(TAB, 'UnknownKey');
    expect(result).toEqual({ ok: false, error: 'Unknown key: UnknownKey' });
    expect(debuggerSendCommandMock).not.toHaveBeenCalled();
  });

  test('empty string key returns {ok:false}', async () => {
    const result = await cdpDispatchKey(TAB, '');
    expect(result).toEqual({ ok: false, error: 'Unknown key: ' });
  });
});

describe('cdpDispatchKey — special keys use rawKeyDown or keyDown', () => {
  test('Tab key dispatches rawKeyDown (no text field)', async () => {
    const result = await cdpDispatchKey(TAB, 'Tab');
    expect(result).toEqual({ ok: true });
    const calls = debuggerSendCommandMock.mock.calls;
    const downCall = calls.find(c => c[1] === 'Input.dispatchKeyEvent' && c[2].type === 'rawKeyDown');
    expect(downCall).toBeDefined();
    expect(downCall[2].key).toBe('Tab');
  });

  test('Enter key dispatches keyDown (has text field)', async () => {
    const result = await cdpDispatchKey(TAB, 'Enter');
    expect(result).toEqual({ ok: true });
    const calls = debuggerSendCommandMock.mock.calls;
    const downCall = calls.find(c => c[1] === 'Input.dispatchKeyEvent' && c[2].type === 'keyDown');
    expect(downCall).toBeDefined();
    expect(downCall[2].key).toBe('Enter');
  });

  test('Space key dispatches keyDown (has text field)', async () => {
    const result = await cdpDispatchKey(TAB, 'Space');
    expect(result).toEqual({ ok: true });
    const downCall = debuggerSendCommandMock.mock.calls.find(
      c => c[1] === 'Input.dispatchKeyEvent' && c[2].type === 'keyDown'
    );
    expect(downCall[2].key).toBe(' ');
  });

  test('Escape key dispatches rawKeyDown (no text field)', async () => {
    const result = await cdpDispatchKey(TAB, 'Escape');
    expect(result).toEqual({ ok: true });
    const downCall = debuggerSendCommandMock.mock.calls.find(
      c => c[1] === 'Input.dispatchKeyEvent' && c[2].type === 'rawKeyDown'
    );
    expect(downCall[2].key).toBe('Escape');
  });

  test('Return alias resolves to Enter', async () => {
    const result = await cdpDispatchKey(TAB, 'Return');
    expect(result).toEqual({ ok: true });
    const downCall = debuggerSendCommandMock.mock.calls.find(
      c => c[1] === 'Input.dispatchKeyEvent' && c[2].type === 'keyDown'
    );
    expect(downCall[2].key).toBe('Enter');
  });
});

describe('cdpDispatchKey — single printable character', () => {
  test('single char "a" dispatches keyDown', async () => {
    const result = await cdpDispatchKey(TAB, 'a');
    expect(result).toEqual({ ok: true });
    const downCall = debuggerSendCommandMock.mock.calls.find(
      c => c[1] === 'Input.dispatchKeyEvent' && c[2].type === 'keyDown'
    );
    expect(downCall).toBeDefined();
    expect(downCall[2].key).toBe('a');
    expect(downCall[2].text).toBe('a');
  });

  test('single char "5" is handled', async () => {
    const result = await cdpDispatchKey(TAB, '5');
    expect(result).toEqual({ ok: true });
  });
});

describe('cdpDispatchKey — debugger error returns {ok:false}', () => {
  test('debugger.sendCommand failure returns error object', async () => {
    debuggerSendCommandMock.mockRejectedValueOnce(new Error('debugger crashed'));
    const result = await cdpDispatchKey(TAB, 'Enter');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('debugger crashed');
  });
});

// ── cdpDispatchClick ─────────────────────────────────────────────────────────

describe('cdpDispatchClick — skipVisual=true skips pre-click message', () => {
  test('does not call sendMessage when skipVisual=true', async () => {
    const result = await cdpDispatchClick(TAB, 100, 200, { skipVisual: true });
    expect(result).toEqual({ ok: true });
    // No tabs.sendMessage call for the cdp_pre_click_visual action
    const visualCall = sendMessageMock.mock.calls.find(
      c => c[1] && c[1].action === 'cdp_pre_click_visual'
    );
    expect(visualCall).toBeUndefined();
  });
});

describe('cdpDispatchClick — default sends pre-click visual message', () => {
  test('sends cdp_pre_click_visual before clicking', async () => {
    // sendMessage may fail (content script not ready) — that's OK, it's caught
    sendMessageMock.mockRejectedValueOnce(new Error('content script not ready'));
    const result = await cdpDispatchClick(TAB, 50, 75);
    expect(result).toEqual({ ok: true });
    const visualCall = sendMessageMock.mock.calls.find(
      c => c[1] && c[1].action === 'cdp_pre_click_visual'
    );
    expect(visualCall).toBeDefined();
    expect(visualCall[1].x).toBe(50);
    expect(visualCall[1].y).toBe(75);
  });
});

describe('cdpDispatchClick — button and clickCount options', () => {
  test('right button option is passed through', async () => {
    await cdpDispatchClick(TAB, 10, 20, { button: 'right', skipVisual: true });
    const pressedCall = debuggerSendCommandMock.mock.calls.find(
      c => c[2] && c[2].type === 'mousePressed'
    );
    expect(pressedCall[2].button).toBe('right');
  });

  test('clickCount=2 option is passed through', async () => {
    await cdpDispatchClick(TAB, 10, 20, { clickCount: 2, skipVisual: true });
    const pressedCall = debuggerSendCommandMock.mock.calls.find(
      c => c[2] && c[2].type === 'mousePressed'
    );
    expect(pressedCall[2].clickCount).toBe(2);
  });
});

describe('cdpDispatchClick — debugger error returns {ok:false}', () => {
  test('returns error object when debugger.sendCommand throws', async () => {
    debuggerSendCommandMock.mockRejectedValueOnce(new Error('attach failed'));
    const result = await cdpDispatchClick(TAB, 100, 200, { skipVisual: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('attach failed');
  });
});

// ── cdpDispatchType ──────────────────────────────────────────────────────────

describe('cdpDispatchType — empty / invalid input guard', () => {
  test('empty string returns {ok:true} without attaching debugger', async () => {
    const result = await cdpDispatchType(TAB, '');
    expect(result).toEqual({ ok: true });
    expect(debuggerSendCommandMock).not.toHaveBeenCalled();
  });

  test('non-string input returns {ok:true} without attaching debugger', async () => {
    const result = await cdpDispatchType(TAB, 42);
    expect(result).toEqual({ ok: true });
    expect(debuggerSendCommandMock).not.toHaveBeenCalled();
  });
});

describe('cdpDispatchType — perCharKeyEvents=false uses fast insertText path', () => {
  test('short text with perCharKeyEvents=false uses Input.insertText', async () => {
    const result = await cdpDispatchType(TAB, 'hi', { perCharKeyEvents: false });
    expect(result).toEqual({ ok: true });
    const insertCall = debuggerSendCommandMock.mock.calls.find(
      c => c[1] === 'Input.insertText'
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[2].text).toBe('hi');
  });
});

describe('cdpDispatchType — long text (>40 chars) uses fast insertText path', () => {
  test('41-char string uses Input.insertText', async () => {
    const longText = 'abcdefghijklmnopqrstuvwxyz0123456789abcde'; // 41 chars
    const result = await cdpDispatchType(TAB, longText);
    expect(result).toEqual({ ok: true });
    const insertCall = debuggerSendCommandMock.mock.calls.find(
      c => c[1] === 'Input.insertText'
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[2].text).toBe(longText);
  });
});

describe('cdpDispatchType — per-char path for short strings', () => {
  test('short string dispatches keyDown per character', async () => {
    // sendMessage is used for typing progress updates — let it succeed
    sendMessageMock.mockResolvedValue(null);
    const result = await cdpDispatchType(TAB, 'ab');
    expect(result).toEqual({ ok: true });
    const keyDownCalls = debuggerSendCommandMock.mock.calls.filter(
      c => c[1] === 'Input.dispatchKeyEvent' && c[2].type === 'keyDown'
    );
    expect(keyDownCalls.length).toBe(2); // 'a' and 'b'
  });

  test('newline character in short string dispatches Enter via cdpDispatchKey', async () => {
    sendMessageMock.mockResolvedValue(null);
    const result = await cdpDispatchType(TAB, 'a\n');
    expect(result).toEqual({ ok: true });
    // The newline dispatches Enter: key=Enter in the keyDown call
    const enterDown = debuggerSendCommandMock.mock.calls.find(
      c => c[1] === 'Input.dispatchKeyEvent' && c[2].key === 'Enter' && c[2].type === 'keyDown'
    );
    expect(enterDown).toBeDefined();
  });
});

describe('cdpDispatchType — 3 consecutive errors exit early', () => {
  test('returns Content-script-unreachable error when sendMessage+key both fail', async () => {
    // With text='abc' (len=3, updateInterval=1), both sendMessage and key dispatch fail.
    // i=0: sendMessage fails (consecutive=1), key fails (consecutive=2).
    // i=1: sendMessage fails (consecutive=3) → "Content script unreachable...".
    sendMessageMock.mockRejectedValue(new Error('content script gone'));
    debuggerSendCommandMock.mockRejectedValue(new Error('key error'));
    const result = await cdpDispatchType(TAB, 'abc');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Content script unreachable');
  });

  test('returns Debugger-command-failed error when key dispatch fails 3 times in a row', async () => {
    // Use 36-char text (updateInterval=3). sendMessage succeeds so consecutive=0 at i=0.
    // Key dispatch fails at i=0,1,2 → consecutive=1,2,3 → return "Debugger command failed...".
    sendMessageMock.mockResolvedValue(null);
    debuggerSendCommandMock.mockRejectedValue(new Error('debugger crash'));
    const text36 = 'a'.repeat(36);
    const result = await cdpDispatchType(TAB, text36);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Debugger command failed');
  });
});

describe('cdpDispatchType — debugger error on insertText path', () => {
  test('long text returns {ok:false} when insertText throws', async () => {
    debuggerSendCommandMock.mockRejectedValueOnce(new Error('debugger detached'));
    const longText = 'x'.repeat(50);
    const result = await cdpDispatchType(TAB, longText);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('debugger detached');
  });
});

// ── cdpExecuteJs ─────────────────────────────────────────────────────────────

describe('cdpExecuteJs — empty / null code guard', () => {
  test('empty string returns {ok:false}', async () => {
    const result = await cdpExecuteJs(TAB, '');
    expect(result).toEqual({ ok: false, error: 'No code provided' });
    expect(debuggerSendCommandMock).not.toHaveBeenCalled();
  });

  test('null code returns {ok:false}', async () => {
    const result = await cdpExecuteJs(TAB, null);
    expect(result).toEqual({ ok: false, error: 'No code provided' });
  });
});

describe('cdpExecuteJs — exceptionDetails in result', () => {
  test('returns {ok:false} with error from exception.description', async () => {
    debuggerSendCommandMock.mockResolvedValueOnce({
      exceptionDetails: {
        exception: { description: 'ReferenceError: x is not defined' },
        text: 'Uncaught'
      }
    });
    const result = await cdpExecuteJs(TAB, 'return x');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ReferenceError');
  });

  test('falls back to ex.text when no exception object', async () => {
    debuggerSendCommandMock.mockResolvedValueOnce({
      exceptionDetails: {
        text: 'Script failed'
      }
    });
    const result = await cdpExecuteJs(TAB, 'return boom()');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Script failed');
  });

  test('falls back to "Runtime exception" literal when both empty', async () => {
    debuggerSendCommandMock.mockResolvedValueOnce({
      exceptionDetails: {}
    });
    const result = await cdpExecuteJs(TAB, 'bad');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Runtime exception');
  });
});

describe('cdpExecuteJs — success path', () => {
  test('returns {ok:true, value} from result.result.value', async () => {
    debuggerSendCommandMock.mockResolvedValueOnce({
      result: { value: 42 }
    });
    const result = await cdpExecuteJs(TAB, 'return 42');
    expect(result).toEqual({ ok: true, value: 42 });
  });

  test('returns {ok:true, value:undefined} when result.result has no value', async () => {
    debuggerSendCommandMock.mockResolvedValueOnce({ result: {} });
    const result = await cdpExecuteJs(TAB, 'document.title');
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe('cdpExecuteJs — debugger error path', () => {
  test('returns {ok:false} when debugger.attach throws', async () => {
    attachMock.mockRejectedValueOnce(new Error('Cannot access chrome://'));
    const result = await cdpExecuteJs(99, 'return 1');
    expect(result.ok).toBe(false);
    expect(result.attachDenied).toBe(true);
  });

  test('non-chrome error has attachDenied=false', async () => {
    attachMock.mockRejectedValueOnce(new Error('network error'));
    const result = await cdpExecuteJs(99, 'return 1');
    expect(result.ok).toBe(false);
    expect(result.attachDenied).toBe(false);
    expect(result.cspBlocked).toBe(false);
  });
});

// ── waitForPageReady ─────────────────────────────────────────────────────────

describe('waitForPageReady — maxWaitMs=0 exits immediately', () => {
  test('resolves immediately when cap is 0', async () => {
    await expect(waitForPageReady(TAB, 0)).resolves.toBeUndefined();
  });
});

// ── cdpDispatchType — thinking pause branch (line 842) ───────────────────────

describe('cdpDispatchType — thinking pause at 6th character', () => {
  test('text of 7 chars triggers i%6===0 thinking-pause branch at i=6', async () => {
    // 'abcdefg' has 7 chars; text.length=7 ≤ 25, so at i=6: i>0 && i%6===0 → line 842
    sendMessageMock.mockResolvedValue(null);
    const result = await cdpDispatchType(TAB, 'abcdefg');
    expect(result).toEqual({ ok: true });
    // Each char dispatches keyDown + keyUp = 2 sendCommand calls × 7 chars = 14 min
    expect(debuggerSendCommandMock.mock.calls.length).toBeGreaterThanOrEqual(12);
  });
});

// ── getTabInfo ────────────────────────────────────────────────────────────────

describe('getTabInfo — callback pattern (lines 1057-1058)', () => {
  test('resolves with tab info when lastError is null', async () => {
    const info = await getTabInfo(TAB);
    expect(info).toEqual({ id: TAB, status: 'complete' });
  });

  test('resolves with null when chrome.runtime.lastError is set', async () => {
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = { message: 'tab not found' };
      cb(null);
      chrome.runtime.lastError = null;
    });
    const info = await getTabInfo(TAB);
    expect(info).toBeNull();
  });
});
