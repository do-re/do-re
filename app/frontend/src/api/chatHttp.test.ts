import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiErrorCode } from './apiErrors';
import { createHttpChatApi } from './chatHttp';
import { createHttpTransport } from './http';

const BASE = 'https://api.test/prod';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(reply: () => Response | Promise<Response>, token: string | null = 'test-token') {
  const fetchFn = vi.fn<typeof fetch>(async () => reply());
  const api = createHttpChatApi(createHttpTransport({ baseUrl: `${BASE}/`, getToken: () => token, fetchFn }));
  /** @returns the URL and options of the first call */
  const call = () => {
    const [url, init] = fetchFn.mock.calls[0];
    return { url: String(url), init: init!, headers: init!.headers as Record<string, string> };
  };
  return { api, fetchFn, call };
}

async function expectCode(promise: Promise<unknown>, code: ApiErrorCode, status: number): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
  expect((error as ApiError).status).toBe(status);
  return error as ApiError;
}

const MESSAGE = { messageId: 'm1', senderId: 'u1', text: 'hi', timestamp: '2026-11-23T12:00:00.000Z' };

describe('createHttpChatApi routes (api.md)', () => {
  it('R_CHAT_02 getChatLog: GET /chats with the bearer token, ignoring the base URL slash', async () => {
    const { api, call } = setup(() => json({ chats: [{ chatId: 'c1' }] }));
    expect(await api.getChatLog('u-ignored')).toEqual([{ chatId: 'c1' }]);
    expect(call().url).toBe(`${BASE}/chats`);
    expect(call().init.method).toBe('GET');
    expect(call().headers.Authorization).toBe('Bearer test-token');
    expect(call().headers['Content-Type']).toBeUndefined();
    expect(call().init.body).toBeUndefined();
  });

  it('R_CHAT_01 getHistory: GET messages, without since on first load', async () => {
    const history = { chatId: 'c1', messages: [MESSAGE], serverTime: MESSAGE.timestamp };
    const { api, call } = setup(() => json(history));
    expect(await api.getHistory('c1', 'u-ignored')).toEqual(history);
    expect(call().url).toBe(`${BASE}/chats/c1/messages`);
  });

  it('getHistory encodes since', async () => {
    const { api, call } = setup(() => json({ messages: [] }));
    await api.getHistory('c1', 'u-ignored', '2026-11-23T12:00:00.000+00:00');
    expect(call().url).toBe(`${BASE}/chats/c1/messages?since=2026-11-23T12%3A00%3A00.000%2B00%3A00`);
  });

  it('encodes the chat ID', async () => {
    const { api, call } = setup(() => json({ messages: [] }));
    await api.getHistory('c/1 x', 'u-ignored');
    expect(call().url).toBe(`${BASE}/chats/c%2F1%20x/messages`);
  });

  it('R_CHAT_13 sendMessage: POST the text only, never the user ID', async () => {
    const { api, call } = setup(() => json(MESSAGE, 201));
    expect(await api.sendMessage('c1', 'u-secret', 'hi')).toEqual(MESSAGE);
    expect(call().url).toBe(`${BASE}/chats/c1/messages`);
    expect(call().init.method).toBe('POST');
    expect(call().headers['Content-Type']).toBe('application/json');
    expect(call().init.body).toBe('{"text":"hi"}');
  });

  it('removeChatFromLog: DELETE /chats/{id}, 204', async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));
    await expect(api.removeChatFromLog('u-ignored', 'c1')).resolves.toBeUndefined();
    expect(call().url).toBe(`${BASE}/chats/c1`);
    expect(call().init.method).toBe('DELETE');
  });

  it('R_CHAT_15 R_CHAT_16 reportChat: POST /chats/{id}/report, 204', async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));
    await api.reportChat('u-ignored', 'c1');
    expect(call().url).toBe(`${BASE}/chats/c1/report`);
    expect(call().init.method).toBe('POST');
    expect(call().init.body).toBe('{}');
  });

  it('R_CHAT_06 recordHeartbeat: POST /presence/heartbeat, 204', async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));
    await api.recordHeartbeat('u-ignored');
    expect(call().url).toBe(`${BASE}/presence/heartbeat`);
  });

  it('uses the global fetch by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ chats: [] }));
    try {
      await createHttpChatApi(createHttpTransport({ baseUrl: BASE, getToken: () => 't' })).getChatLog('u');
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createHttpChatApi errors', () => {
  it('fails as UNAUTHENTICATED without calling the server when there is no token', async () => {
    const { api, fetchFn } = setup(() => json({ chats: [] }), null);
    await expectCode(api.getChatLog('u'), 'UNAUTHENTICATED', 401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each<[ApiErrorCode, number]>([
    ['BAD_REQUEST', 400],
    ['EMPTY_MESSAGE', 400],
    ['MESSAGE_TOO_LONG', 400],
    ['UNAUTHENTICATED', 401],
    ['NOT_PARTICIPANT', 403],
    ['CHAT_NOT_FOUND', 404],
    ['RATE_LIMITED', 429],
    ['INTERNAL', 500],
  ])('maps %s (%d) with the server message', async (code, status) => {
    const { api } = setup(() => json({ error: { code, message: `server says ${code}` } }, status));
    const error = await expectCode(api.getChatLog('u'), code, status);
    expect(error.message).toBe(`server says ${code}`);
  });

  it('an unknown code becomes INTERNAL but keeps a usable message', async () => {
    const { api } = setup(() => json({ error: { code: 'WAT', message: 'Try later.' } }, 503));
    const error = await expectCode(api.getChatLog('u'), 'INTERNAL', 503);
    expect(error.message).toBe('Try later.');
  });

  it.each([
    ['a non-JSON error page', () => new Response('<html>Bad gateway</html>', { status: 502 })],
    ['JSON that is not an object', () => json('nope', 502)],
    ['an object without error', () => json({ oops: true }, 502)],
    ['an empty message', () => json({ error: { code: 'INTERNAL', message: '' } }, 502)],
  ])('%s gets the generic error', async (_name, reply) => {
    const { api } = setup(reply);
    const error = await expectCode(api.getChatLog('u'), 'INTERNAL', 502);
    expect(error.message).toBe('Something went wrong. Try again.');
  });

  it('a network failure becomes NETWORK_ERROR with text saying what to do', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await expectCode(api.getChatLog('u'), 'NETWORK_ERROR', 0);
    expect(error.message).toMatch(/Check your connection/);
  });

  it('a 200 with an unreadable body is an error', async () => {
    const { api } = setup(() => new Response('not json', { status: 200 }));
    await expectCode(api.getChatLog('u'), 'INTERNAL', 200);
  });

  it.each([
    ['getChatLog', (a: ReturnType<typeof createHttpChatApi>) => a.getChatLog('u'), { chats: 'x' }],
    ['getChatLog null', (a: ReturnType<typeof createHttpChatApi>) => a.getChatLog('u'), null],
    ['getHistory', (a: ReturnType<typeof createHttpChatApi>) => a.getHistory('c', 'u'), { messages: 'x' }],
    ['getHistory null', (a: ReturnType<typeof createHttpChatApi>) => a.getHistory('c', 'u'), null],
    ['sendMessage', (a: ReturnType<typeof createHttpChatApi>) => a.sendMessage('c', 'u', 'hi'), { text: 'hi' }],
    ['sendMessage null', (a: ReturnType<typeof createHttpChatApi>) => a.sendMessage('c', 'u', 'hi'), null],
  ])('%s rejects a body of the wrong shape', async (_name, callApi, body) => {
    const { api } = setup(() => json(body));
    await expect(callApi(api)).rejects.toBeInstanceOf(ApiError);
  });
});
