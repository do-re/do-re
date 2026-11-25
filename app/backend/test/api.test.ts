/**
 * The HTTP layer's own behaviour: routing, sessions, error bodies, logging and the Lambda
 * adapter. What each route does for the client is covered by contract.test.ts.
 */
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createApi, type HttpRequest } from '../src/http/api';
import { AREA_PREFIXES, lambdaHandler, toRequest } from '../src/http/lambdaAdapter';
import { makeWorld } from './helpers';

const errorOf = (response: { body: unknown }) => (response.body as { error: { code: string; message: string } }).error;
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const request = (overrides: Partial<HttpRequest>): HttpRequest => ({
  method: 'GET',
  path: '/api/songs/current',
  query: {},
  headers: {},
  body: undefined,
  ...overrides,
});

describe('HTTP API: sessions', () => {
  it('security_everyRouteButTheFourPublicOnesNeedsAValidSession', async () => {
    const world = makeWorld();
    const { token, userId } = await world.join('ada@example.com');
    for (const [method, path] of [
      ['GET', '/api/users/me'],
      ['GET', '/api/songs/current'],
      ['GET', '/api/matches/pending'],
      ['GET', '/api/chats'],
      ['POST', '/api/presence/heartbeat'],
    ] as const) {
      const response = await world.call(method, path);
      expect(response.status).toBe(401);
      expect(errorOf(response).code).toBe('UNAUTHENTICATED');
      expect((await world.call(method, path, { token: 'forged' })).status).toBe(401);
    }
    expect((await world.call('GET', '/api/chats', { token: '' })).status).toBe(401);
    expect((await world.call('GET', '/api/users/me', { token })).body).toMatchObject({ userId });
    expect((await world.call('GET', `/api/users/${userId}`, { token })).body).toMatchObject({ userId });
    expect((await world.call('GET', '/api/users/nobody', { token })).status).toBe(404);

    expect((await world.call('POST', '/api/auth/logout', { token })).status).toBe(204);
    expect((await world.call('GET', '/api/users/me', { token })).status).toBe(401); // session ended
  });

  // api.md: every authenticated chat request records a heartbeat for the caller
  it('R_CHAT_06_chatRequestsCountAsHeartbeatsAndOtherRequestsDoNot', async () => {
    const world = makeWorld();
    const { token, userId } = await world.join('ada@example.com');
    await world.call('GET', '/api/songs/current', { token });
    expect(await world.services.chats.isUserOnline(userId, world.clock.now)).toBe(false);
    await world.call('GET', '/api/chats', { token });
    expect(await world.services.chats.isUserOnline(userId, world.clock.now)).toBe(true);
  });
});

describe('HTTP API: request handling', () => {
  // spec: failures become { error: { code, message } } responses; the function never throws
  it('answers 404 for unknown routes and 400 BAD_REQUEST for bad input', async () => {
    const world = makeWorld();
    const { token } = await world.join('ada@example.com');
    const unknown = await world.call('GET', '/api/nothing/here', { token });
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('NOT_FOUND');
    expect((await world.call('GET', '/api/accounts')).status).toBe(404); // wrong method
    expect((await world.call('GET', '/api/chats//messages', { token })).status).toBe(404); // empty path parameter
    expect((await world.call('GET', '/api/chats/a/b/c/d', { token })).status).toBe(404);

    const missing = await world.call('POST', '/api/auth/login', { body: { email: 'ada@example.com' } });
    expect(missing.status).toBe(400);
    expect(errorOf(missing).code).toBe('BAD_REQUEST');
    expect(errorOf(missing).message).toContain('password');
    expect((await world.call('POST', '/api/auth/login')).status).toBe(400); // no body at all
    expect(errorOf(await world.call('POST', '/api/auth/login', { raw: new Uint8Array() })).code).toBe('BAD_REQUEST');
    for (const raw of [new TextEncoder().encode('{oops'), Uint8Array.from([0xff, 0xfe, 0xfd])]) {
      const response = await world.call('POST', '/api/auth/login', { raw });
      expect(response.status).toBe(400);
      expect(errorOf(response).message).toContain('JSON');
    }

    const swipe = { swipe: 'MAYBE', secondsListened: 1 };
    expect((await world.call('POST', '/api/songs/s00/feedback', { token, body: swipe })).status).toBe(400);
    const text = { swipe: 'LIKE', secondsListened: '1' };
    expect((await world.call('POST', '/api/songs/s00/feedback', { token, body: text })).status).toBe(400);
    expect((await world.call('PUT', '/api/users/me/picture', { token })).status).toBe(400); // no file
    expect((await world.call('GET', '/api/matches/no_such', { token })).status).toBe(404);
    expect(errorOf(await world.call('GET', '/api/matches/no_such/other-user', { token })).code).toBe('MATCH_NOT_FOUND');
  });

  // CLAUDE.md security rule: never log passwords, tokens or emails
  it('security_unexpectedErrorsBecome500AndAreLoggedWithoutTheirMessage', async () => {
    const world = makeWorld();
    const { token } = await world.join('ada@example.com');
    const broken = {
      ...world.services,
      songs: Object.assign(Object.create(world.services.songs), {
        getCurrentSong: async () => {
          throw new TypeError('lookup failed for ada@example.com');
        },
      }),
    };
    const lines: string[] = [];
    const api = createApi(broken, (line) => lines.push(line));
    const response = await api(request({ headers: { authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(500);
    expect(errorOf(response).code).toBe('INTERNAL');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Unexpected TypeError on GET /api/songs/current');
    expect(JSON.stringify([lines, response])).not.toContain('ada@example.com');
  });

  it('logs unexpected errors to the console by default, even without a stack', async () => {
    const world = makeWorld();
    const broken = {
      ...world.services,
      accounts: Object.assign(Object.create(world.services.accounts), { login: () => Promise.reject({ name: 'Odd' }) }),
    };
    const original = console.error;
    const lines: unknown[] = [];
    console.error = (line: unknown) => void lines.push(line);
    try {
      const api = createApi(broken);
      const body = json({ email: 'a@b.co', password: 'x' });
      expect((await api(request({ method: 'POST', path: '/api/auth/login', body }))).status).toBe(500);
    } finally {
      console.error = original;
    }
    expect(lines).toEqual(['Unexpected Odd on POST /api/auth/login\n']);
  });

  it('reports a failed confirmation email as 502 with a message that says what to do', async () => {
    const world = makeWorld();
    world.email.failing = true;
    const body = { email: 'ada@example.com', password: 'pw', confirmPassword: 'pw' };
    const response = await world.call('POST', '/api/accounts', { body });
    expect(response.status).toBe(502);
    expect(errorOf(response).code).toBe('EMAIL_SEND_FAILED');
  });
});

describe('Lambda adapter', () => {
  const event = (overrides: Partial<APIGatewayProxyEventV2> & { method?: string }): APIGatewayProxyEventV2 =>
    ({
      rawPath: '/api/auth/login',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      requestContext: { http: { method: overrides.method ?? 'POST' } },
      isBase64Encoded: false,
      ...overrides,
    }) as APIGatewayProxyEventV2;

  // spec: lower-case header names, body as bytes, query defaulting to {}
  it('converts API Gateway events to requests', () => {
    expect(toRequest(event({ body: '{"a":1}', queryStringParameters: { since: 'x' } }))).toEqual({
      method: 'POST',
      path: '/api/auth/login',
      query: { since: 'x' },
      headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
      body: new TextEncoder().encode('{"a":1}'),
    });
    const picture = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x80]);
    const encoded = toRequest(event({ body: Buffer.from(picture).toString('base64'), isBase64Encoded: true }));
    expect(encoded.body).toEqual(picture); // binary uploads survive intact
    const bare = toRequest(event({ headers: undefined as never, method: 'GET' }));
    expect(bare).toMatchObject({ method: 'GET', query: {}, headers: {}, body: undefined });
  });

  // spec: serves one area's prefixes; builds the API once; JSON responses with caching disabled
  it('serves its own area through the API and answers 404 for others', async () => {
    const world = makeWorld();
    let built = 0;
    const handler = lambdaHandler('account', () => {
      built++;
      return createApi(world.services, () => undefined);
    });
    for (const rawPath of ['/api/chats', '/api/songs/current', '/api/authentic', '/api']) {
      expect((await handler(event({ rawPath }))).statusCode).toBe(404);
    }
    expect(built).toBe(0);

    const login = await handler(event({ body: JSON.stringify({ email: 'nobody@example.com', password: 'x' }) }));
    expect(login).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: '{"result":"NO_ACCOUNT"}',
    });
    const signup = { email: 'ada@example.com', password: 'pw', confirmPassword: 'pw' };
    expect((await handler(event({ rawPath: '/api/accounts', body: JSON.stringify(signup) }))).statusCode).toBe(200);

    const { token } = await world.join('bea@example.com');
    const logout = await handler(event({ rawPath: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } }));
    expect(logout).toMatchObject({ statusCode: 204, body: '' });
  });

  // every route of api.md belongs to exactly one area's function
  it('gives every API route to exactly one area', async () => {
    const world = makeWorld();
    const { token } = await world.join('ada@example.com');
    const areas = Object.keys(AREA_PREFIXES) as (keyof typeof AREA_PREFIXES)[];
    const handlers = areas.map((area) => lambdaHandler(area, () => createApi(world.services, () => undefined)));
    for (const [method, rawPath] of [
      ['GET', '/api/users/me'],
      ['GET', '/api/songs/current'],
      ['GET', '/api/matches/pending'],
      ['GET', '/api/chats'],
      ['POST', '/api/presence/heartbeat'],
    ] as const) {
      const results = await Promise.all(
        handlers.map((handler) => handler(event({ method, rawPath, headers: { authorization: `Bearer ${token}` } }))),
      );
      expect(results.filter((result) => result.statusCode !== 404)).toHaveLength(1);
    }
  });
});
