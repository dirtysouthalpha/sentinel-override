// tests/message-protocol.test.js
// Unit tests for background/message-protocol.js pure functions.
// wrapMessageHandler has no chrome.* dependencies at import time.

import { wrapMessageHandler } from '../background/message-protocol.js';

describe('wrapMessageHandler', () => {
  test('wraps async handler and returns true (keeps channel open)', () => {
    const handler = async () => 'ok';
    const wrapped = wrapMessageHandler(handler);
    const result = wrapped({}, {}, () => {});
    expect(result).toBe(true);
  });

  test('sends { ok: true, data } on success', async () => {
    const handler = async () => ({ answer: 42 });
    const wrapped = wrapMessageHandler(handler);

    let sentResponse = null;
    const sendResponse = (msg) => { sentResponse = msg; };

    wrapped({}, {}, sendResponse);
    // Allow the async handler to resolve
    await new Promise(r => setTimeout(r, 10));

    expect(sentResponse).toEqual({ ok: true, data: { answer: 42 } });
  });

  test('sends { ok: false, error } on rejection', async () => {
    const handler = async () => { throw new Error('something broke'); };
    const wrapped = wrapMessageHandler(handler);

    let sentResponse = null;
    const sendResponse = (msg) => { sentResponse = msg; };

    wrapped({}, {}, sendResponse);
    await new Promise(r => setTimeout(r, 10));

    expect(sentResponse.ok).toBe(false);
    expect(sentResponse.error).toBe('something broke');
  });

  test('passes request and sender to handler', async () => {
    let receivedArgs = null;
    const handler = async (request, sender) => {
      receivedArgs = { request, sender };
      return 'done';
    };
    const wrapped = wrapMessageHandler(handler);

    const req = { action: 'test' };
    const sender = { tab: { id: 1 } };

    wrapped(req, sender, () => {});
    await new Promise(r => setTimeout(r, 10));

    expect(receivedArgs.request).toBe(req);
    expect(receivedArgs.sender).toBe(sender);
  });

  test('handles handler returning undefined', async () => {
    const handler = async () => {};
    const wrapped = wrapMessageHandler(handler);

    let sentResponse = null;
    const sendResponse = (msg) => { sentResponse = msg; };

    wrapped({}, {}, sendResponse);
    await new Promise(r => setTimeout(r, 10));

    expect(sentResponse.ok).toBe(true);
    expect(sentResponse.data).toBeUndefined();
  });
});
