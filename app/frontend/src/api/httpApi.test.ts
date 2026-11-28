import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './apiErrors';
import { createHttpTransport } from './http';
import { createHttpApi } from './httpApi';
import type { Match, Song } from './types';

const BASE = 'https://api.test';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = () => new Response(null, { status: 204 });

function setup(reply: () => Response, token: string | null = 'test-token') {
  const fetchFn = vi.fn<typeof fetch>(async () => reply());
  const onUnauthorized = vi.fn();
  const api = createHttpApi({ baseUrl: BASE, getToken: () => token, fetchFn, onUnauthorized });
  const call = () => {
    const [url, init] = fetchFn.mock.calls[0];
    return { url: String(url), method: init!.method, body: init!.body, headers: init!.headers as Record<string, string> };
  };
  return { api, fetchFn, onUnauthorized, call };
}

const SONG: Song = {
  id: 's1',
  title: 'Title',
  artist: 'Artist',
  durationSeconds: 30,
  albumCoverUrl: 'https://img.test/a.jpg',
  spotifyUri: 'spotify:track:abc',
  features: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
};
const MATCH: Match = { matchId: 'm/1', userA: 'u1', userB: 'u2', compatibilityPercent: 80 };
const PROFILE = { userId: 'u2', username: 'sam', profilePictureUrl: null };

describe('account routes', () => {
  it('R_ACC_01 login: POST /auth/login, no token, and returns the session', async () => {
    const { api, call } = setup(() => json({ result: 'SUCCESS', userId: 'u1', token: 'tok', extra: 1 }));
    expect(await api.account.login('a@b.co', 'pw')).toEqual({ result: 'SUCCESS', userId: 'u1', token: 'tok' });
    expect(call().url).toBe(`${BASE}/auth/login`);
    expect(call().method).toBe('POST');
    expect(call().headers.Authorization).toBeUndefined();
    expect(JSON.parse(call().body as string)).toEqual({ email: 'a@b.co', password: 'pw' });
  });

  it.each(['WRONG_PASSWORD', 'NO_ACCOUNT', 'NOT_VERIFIED'])('R_ACC_05 login reports %s', async (result) => {
    const { api } = setup(() => json({ result }));
    expect(await api.account.login('a@b.co', 'pw')).toEqual({ result });
  });

  it.each([
    ['not an object', null],
    ['an unknown result', { result: 'NOPE' }],
    ['SUCCESS without a token', { result: 'SUCCESS', userId: 'u1' }],
    ['SUCCESS without a user', { result: 'SUCCESS', token: 't' }],
  ])('login rejects %s', async (_, body) => {
    const { api } = setup(() => json(body));
    await expect(api.account.login('a@b.co', 'pw')).rejects.toBeInstanceOf(ApiError);
  });

  it('R_ACC_09 createAccount: POST /accounts with all three fields, no token', async () => {
    const { api, call } = setup(() => json({ result: 'PENDING_VERIFICATION' }));
    expect(await api.account.createAccount('a@b.co', 'pw', 'pw')).toBe('PENDING_VERIFICATION');
    expect(call().url).toBe(`${BASE}/accounts`);
    expect(call().headers.Authorization).toBeUndefined();
    expect(JSON.parse(call().body as string)).toEqual({ email: 'a@b.co', password: 'pw', confirmPassword: 'pw' });
  });

  it.each([null, { result: 'NOPE' }])('createAccount rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.account.createAccount('a@b.co', 'pw', 'pw')).rejects.toBeInstanceOf(ApiError);
  });

  it('R_SEC_02 confirmEmail: POST /accounts/confirm', async () => {
    const { api, call } = setup(() => json({ confirmed: true }));
    expect(await api.account.confirmEmail('u1', 'tok')).toBe(true);
    expect(call().url).toBe(`${BASE}/accounts/confirm`);
    expect(JSON.parse(call().body as string)).toEqual({ userId: 'u1', token: 'tok' });
  });

  it.each([null, { confirmed: 'yes' }])('confirmEmail rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.account.confirmEmail('u1', 'tok')).rejects.toBeInstanceOf(ApiError);
  });

  it('isVerified keeps the email in the body, out of the URL', async () => {
    const { api, call } = setup(() => json({ verified: false }));
    expect(await api.account.isVerified('a@b.co')).toBe(false);
    expect(call().url).toBe(`${BASE}/accounts/verification-status`);
    expect(call().url).not.toContain('a@b.co');
    expect(JSON.parse(call().body as string)).toEqual({ email: 'a@b.co' });
  });

  it.each([null, { verified: 1 }])('isVerified rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.account.isVerified('a@b.co')).rejects.toBeInstanceOf(ApiError);
  });

  it('getProfile: GET /users/{id} with the token', async () => {
    const { api, call } = setup(() => json(PROFILE));
    expect(await api.account.getProfile('u/2')).toEqual(PROFILE);
    expect(call().url).toBe(`${BASE}/users/u%2F2`);
    expect(call().headers.Authorization).toBe('Bearer test-token');
  });

  it.each([null, { username: 'x' }])('getProfile rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.account.getProfile('u1')).rejects.toBeInstanceOf(ApiError);
  });

  it('updateUsername: PATCH /users/me without the user ID', async () => {
    const { api, call } = setup(empty);
    await api.account.updateUsername('u-secret', 'dj');
    expect(call().url).toBe(`${BASE}/users/me`);
    expect(call().method).toBe('PATCH');
    expect(call().body).toBe('{"username":"dj"}');
  });

  it('updateProfilePicture: PUT the raw file with its own type', async () => {
    const { api, call } = setup(empty);
    const image = new Blob(['bytes'], { type: 'image/png' });
    await api.account.updateProfilePicture('u-secret', image);
    expect(call().url).toBe(`${BASE}/users/me/picture`);
    expect(call().method).toBe('PUT');
    expect(call().body).toBe(image);
    expect(call().headers['Content-Type']).toBe('image/png');
  });
});

describe('song routes', () => {
  it('R_HOME_03 getCurrentSong: GET /songs/current', async () => {
    const { api, call } = setup(() => json(SONG));
    expect(await api.songs.getCurrentSong('u1')).toEqual(SONG);
    expect(call().url).toBe(`${BASE}/songs/current`);
  });

  it.each([null, { id: 1, features: [] }, { id: 's' }])('getCurrentSong rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.songs.getCurrentSong('u1')).rejects.toBeInstanceOf(ApiError);
  });

  it('R_HOME_25 markLiked: POST /songs/{id}/like', async () => {
    const { api, call } = setup(empty);
    await api.songs.markLiked('u1', 's/1');
    expect(call().url).toBe(`${BASE}/songs/s%2F1/like`);
    expect(call().method).toBe('POST');
  });

  it('R_HOME_15 submitFeedback sends the swipe and time, and returns the next song', async () => {
    const { api, call } = setup(() => json({ nextSong: SONG, offeredMatch: null }));
    expect(await api.songs.submitFeedback('u1', 's1', 'LIKE', 12.5)).toEqual({ nextSong: SONG, offeredMatch: null });
    expect(call().url).toBe(`${BASE}/songs/s1/feedback`);
    expect(JSON.parse(call().body as string)).toEqual({ swipe: 'LIKE', secondsListened: 12.5 });
  });

  it('R_HOME_19 submitFeedback returns an offered match', async () => {
    const { api } = setup(() => json({ nextSong: SONG, offeredMatch: MATCH }));
    expect((await api.songs.submitFeedback('u1', 's1', 'SKIP', 0)).offeredMatch).toEqual(MATCH);
  });

  it.each([
    ['not an object', null],
    ['no song', { offeredMatch: null }],
    ['a bad match', { nextSong: SONG, offeredMatch: { id: 'x' } }],
  ])('submitFeedback rejects %s', async (_, body) => {
    const { api } = setup(() => json(body));
    await expect(api.songs.submitFeedback('u1', 's1', 'SKIP', 0)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('undo and taste routes', () => {
  it.each([true, false])('canUndo: GET /songs/undo -> %s', async (canUndo) => {
    const { api, call } = setup(() => json({ canUndo }));
    expect(await api.songs.canUndo('u1')).toBe(canUndo);
    expect(call().url).toBe(`${BASE}/songs/undo`);
    expect(call().method).toBe('GET');
  });

  it.each([null, {}, { canUndo: 'yes' }])('canUndo rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.songs.canUndo('u1')).rejects.toBeInstanceOf(ApiError);
  });

  it('undoLastSwipe: POST /songs/undo returns the restored song', async () => {
    const { api, call } = setup(() => json({ song: SONG, liked: true, canUndo: false }));
    expect(await api.songs.undoLastSwipe('u1')).toEqual({ song: SONG, liked: true, canUndo: false });
    expect(call().url).toBe(`${BASE}/songs/undo`);
    expect(call().method).toBe('POST');
  });

  it('undoLastSwipe returns null when there is nothing to undo', async () => {
    const { api } = setup(() => json({ song: null, liked: false, canUndo: false }));
    expect(await api.songs.undoLastSwipe('u1')).toBeNull();
  });

  it.each([
    ['not an object', null],
    ['no liked flag', { song: SONG, canUndo: false }],
    ['no canUndo flag', { song: SONG, liked: false }],
    ['a bad song', { song: { id: 1 }, liked: false, canUndo: false }],
  ])('undoLastSwipe rejects %s', async (_, body) => {
    const { api } = setup(() => json(body));
    await expect(api.songs.undoLastSwipe('u1')).rejects.toBeInstanceOf(ApiError);
  });

  it('getTasteVector: GET /songs/taste', async () => {
    const taste = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const { api, call } = setup(() => json({ taste }));
    expect(await api.songs.getTasteVector('u1')).toEqual(taste);
    expect(call().url).toBe(`${BASE}/songs/taste`);
  });

  it.each([
    ['not an object', null],
    ['no vector', {}],
    ['not a list', { taste: 'x' }],
    ['too short', { taste: [0.5] }],
    ['not numbers', { taste: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
  ])('getTasteVector rejects %s', async (_, body) => {
    const { api } = setup(() => json(body));
    await expect(api.songs.getTasteVector('u1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('match routes', () => {
  it('R_HOME_20 getPendingMatches: GET /matches/pending', async () => {
    const { api, call } = setup(() => json({ matches: [MATCH] }));
    expect(await api.matches.getPendingMatches('u1')).toEqual([MATCH]);
    expect(call().url).toBe(`${BASE}/matches/pending`);
  });

  it.each([null, { matches: 'x' }, { matches: [{}] }])('getPendingMatches rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.matches.getPendingMatches('u1')).rejects.toBeInstanceOf(ApiError);
  });

  it('getMatch: GET /matches/{id}', async () => {
    const { api, call } = setup(() => json(MATCH));
    expect(await api.matches.getMatch('m/1', 'u1')).toEqual(MATCH);
    expect(call().url).toBe(`${BASE}/matches/m%2F1`);
  });

  it('getMatch turns MATCH_NOT_FOUND into null, and rethrows anything else', async () => {
    const missing = setup(() => json({ error: { code: 'MATCH_NOT_FOUND', message: 'Gone.' } }, 404));
    expect(await missing.api.matches.getMatch('m', 'u1')).toBeNull();
    const broken = setup(() => json({ error: { code: 'INTERNAL', message: 'Oops.' } }, 500));
    await expect(broken.api.matches.getMatch('m', 'u1')).rejects.toBeInstanceOf(ApiError);
  });

  it('getOtherProfile: GET /matches/{id}/other-user', async () => {
    const { api, call } = setup(() => json(PROFILE));
    expect(await api.matches.getOtherProfile(MATCH, 'u1')).toEqual(PROFILE);
    expect(call().url).toBe(`${BASE}/matches/m%2F1/other-user`);
  });

  it.each([
    ['the chat ID', 'c1'],
    ['null while waiting (OPEN-4)', null],
  ])('R_HOME_23 confirmMatch returns %s', async (_, chatId) => {
    const { api, call } = setup(() => json({ chatId }));
    expect(await api.matches.confirmMatch(MATCH, 'u1')).toBe(chatId);
    expect(call().url).toBe(`${BASE}/matches/m%2F1/confirm`);
    expect(call().method).toBe('POST');
  });

  it.each([null, {}, { chatId: 3 }])('confirmMatch rejects %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.matches.confirmMatch(MATCH, 'u1')).rejects.toBeInstanceOf(ApiError);
  });

  it('R_HOME_22 declineMatch: POST /matches/{id}/decline', async () => {
    const { api, call } = setup(empty);
    await api.matches.declineMatch(MATCH, 'u1');
    expect(call().url).toBe(`${BASE}/matches/m%2F1/decline`);
  });
});

describe('chat routes through createHttpApi', () => {
  it('uses the same token and base URL', async () => {
    const { api, call } = setup(() => json({ chats: [] }));
    await api.chats.getChatLog('u1');
    expect(call().url).toBe(`${BASE}/chats`);
    expect(call().headers.Authorization).toBe('Bearer test-token');
  });

  it('has no demo tools', () => {
    expect(setup(empty).api.demo).toBeUndefined();
  });
});

describe('session handling', () => {
  it('a 401 on an authenticated route tells the app the session ended', async () => {
    const { api, onUnauthorized } = setup(() => json({ error: { code: 'UNAUTHENTICATED', message: 'Log in.' } }, 401));
    await expect(api.songs.getCurrentSong('u1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('a missing token ends the session without calling the server', async () => {
    const { api, fetchFn, onUnauthorized } = setup(() => json(SONG), null);
    await expect(api.songs.getCurrentSong('u1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('other errors, and a 401 on a public route, do not end the session', async () => {
    const serverError = setup(() => json({ error: { code: 'INTERNAL', message: 'Oops.' } }, 500));
    await expect(serverError.api.songs.getCurrentSong('u1')).rejects.toBeInstanceOf(ApiError);
    expect(serverError.onUnauthorized).not.toHaveBeenCalled();

    const publicRoute = setup(() => json({ error: { code: 'UNAUTHENTICATED', message: 'No.' } }, 401), null);
    await expect(publicRoute.api.account.login('a@b.co', 'pw')).rejects.toBeInstanceOf(ApiError);
    expect(publicRoute.onUnauthorized).not.toHaveBeenCalled();
  });

  it('works without an onUnauthorized callback', async () => {
    const noToken = createHttpTransport({ baseUrl: BASE, getToken: () => null, fetchFn: vi.fn() });
    await expect(noToken.request('GET', '/x')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const rejected = createHttpTransport({
      baseUrl: BASE,
      getToken: () => 't',
      fetchFn: async () => json({ error: { code: 'UNAUTHENTICATED', message: 'No.' } }, 401),
    });
    await expect(rejected.request('GET', '/x')).rejects.toMatchObject({ status: 401 });
  });
});

describe('push routes', () => {
  it('getPublicKey: GET /push/public-key with the token', async () => {
    const { api, call } = setup(() => json({ publicKey: 'BKey' }));
    expect(await api.push.getPublicKey()).toBe('BKey');
    expect(call()).toMatchObject({ method: 'GET', url: 'https://api.test/push/public-key' });
    expect(call().headers.Authorization).toBe('Bearer test-token');
  });

  it.each([[{}], [{ publicKey: '' }], [{ publicKey: 5 }], ['text']])('getPublicKey rejects a malformed body %j', async (body) => {
    const { api } = setup(() => json(body));
    await expect(api.push.getPublicKey()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('saveSubscription: PUT /push/subscription with only the endpoint and keys', async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' }, expirationTime: null };
    await api.push.saveSubscription(subscription);
    expect(call()).toMatchObject({ method: 'PUT', url: 'https://api.test/push/subscription' });
    expect(JSON.parse(call().body as string)).toEqual({ endpoint: subscription.endpoint, keys: { p256dh: 'p', auth: 'a' } });
  });

  it('removeSubscription: DELETE /push/subscription with the endpoint in the body', async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));
    await api.push.removeSubscription('https://fcm.googleapis.com/fcm/send/abc');
    expect(call()).toMatchObject({ method: 'DELETE', url: 'https://api.test/push/subscription' });
    expect(JSON.parse(call().body as string)).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' });
  });
});

describe('report and admin routes (OPEN-18)', () => {
  it('login says when the user is an admin, and only then', async () => {
    const admin = setup(() => json({ result: 'SUCCESS', userId: 'u1', token: 'tok', isAdmin: true }));
    expect(await admin.api.account.login('a@b.co', 'pw')).toEqual({ result: 'SUCCESS', userId: 'u1', token: 'tok', isAdmin: true });
    for (const isAdmin of [false, 'yes', undefined]) {
      const other = setup(() => json({ result: 'SUCCESS', userId: 'u1', token: 'tok', isAdmin }));
      expect(await other.api.account.login('a@b.co', 'pw')).toEqual({ result: 'SUCCESS', userId: 'u1', token: 'tok' });
    }
  });

  it('login passes on SUSPENDED', async () => {
    const { api } = setup(() => json({ result: 'SUSPENDED' }));
    expect(await api.account.login('a@b.co', 'pw')).toEqual({ result: 'SUSPENDED' });
  });

  it('reportProfile: POST /users/{the other user}/report with the reason and details', async () => {
    const { api, call } = setup(empty);
    await api.matches.reportProfile(MATCH, 'u1', 'SPAM', 'ads');
    expect(call()).toMatchObject({ method: 'POST', url: 'https://api.test/users/u2/report' });
    expect(JSON.parse(call().body as string)).toEqual({ reason: 'SPAM', details: 'ads' });
    const other = setup(empty);
    await other.api.matches.reportProfile(MATCH, 'u2', 'OTHER', '');
    expect(other.call().url).toBe('https://api.test/users/u1/report');
  });

  it('lists users, reports and the activity log', async () => {
    const users = setup(() => json({ users: [{ userId: 'u1' }] }));
    expect(await users.api.admin.listUsers('me')).toEqual([{ userId: 'u1' }]);
    expect(users.call()).toMatchObject({ method: 'GET', url: 'https://api.test/admin/users' });
    const reports = setup(() => json({ reports: [] }));
    expect(await reports.api.admin.listReports('me')).toEqual([]);
    expect(reports.call().url).toBe('https://api.test/admin/reports');
    const audit = setup(() => json({ entries: [{ action: 'VERIFY' }] }));
    expect(await audit.api.admin.auditLog('me')).toEqual([{ action: 'VERIFY' }]);
    expect(audit.call().url).toBe('https://api.test/admin/audit');
    await expect(setup(() => json({ users: 'x' })).api.admin.listUsers('me')).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(setup(() => json('x')).api.admin.listReports('me')).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it.each([
    ['suspend', (a: ReturnType<typeof setup>['api']) => a.admin.suspend('me', 'u/2', 'spam'), '/admin/users/u%2F2/suspend', { reason: 'spam' }],
    ['unsuspend', (a: ReturnType<typeof setup>['api']) => a.admin.unsuspend('me', 'u2'), '/admin/users/u2/unsuspend', {}],
    ['verify', (a: ReturnType<typeof setup>['api']) => a.admin.verify('me', 'u2'), '/admin/users/u2/verify', {}],
    ['setAdmin', (a: ReturnType<typeof setup>['api']) => a.admin.setAdmin('me', 'u2', true), '/admin/users/u2/admin', { admin: true }],
    ['resolveReport', (a: ReturnType<typeof setup>['api']) => a.admin.resolveReport('me', 'u2.u1', 'done'), '/admin/reports/u2.u1/resolve', { note: 'done' }],
  ])('%s posts to its route', async (_name, act, path, body) => {
    const { api, call } = setup(empty);
    await act(api);
    expect(call()).toMatchObject({ method: 'POST', url: `https://api.test${path}` });
    expect(JSON.parse(call().body as string)).toEqual(body);
  });

  it('passes on the server refusing a non-admin', async () => {
    const { api } = setup(() => json({ error: { code: 'NOT_ADMIN', message: 'This page is for admins.' } }, 403));
    await expect(api.admin.listUsers('me')).rejects.toMatchObject({ code: 'NOT_ADMIN', status: 403 });
  });
});

describe('outgoing match routes', () => {
  it('getOutgoingMatches: GET /matches/outgoing', async () => {
    const { api, call } = setup(() => json({ matches: [{ match: MATCH, otherUser: PROFILE }] }));
    expect(await api.matches.getOutgoingMatches('u1')).toEqual([{ match: MATCH, otherUser: PROFILE }]);
    expect(call()).toMatchObject({ method: 'GET', url: 'https://api.test/matches/outgoing' });
  });

  it.each([[{}], [{ matches: 'x' }], [{ matches: ['x'] }], [{ matches: [{ match: {}, otherUser: PROFILE }] }], [{ matches: [{ match: MATCH, otherUser: {} }] }]])(
    'getOutgoingMatches rejects a malformed body %j',
    async (body) => {
      const { api } = setup(() => json(body));
      await expect(api.matches.getOutgoingMatches('u1')).rejects.toMatchObject({ code: 'INTERNAL' });
    },
  );

  it('retractMatch: POST /matches/{matchId}/retract', async () => {
    const { api, call } = setup(empty);
    await api.matches.retractMatch(MATCH, 'u1');
    expect(call()).toMatchObject({ method: 'POST', url: 'https://api.test/matches/m%2F1/retract' });
  });
});

describe('security audit 2026-11-27', () => {
  it('logout: POST /auth/logout with the token, so the server ends the session', async () => {
    const { api, call } = setup(empty);
    await api.account.logout();
    expect(call()).toMatchObject({ method: 'POST', url: 'https://api.test/auth/logout' });
    expect(call().headers.Authorization).toBe('Bearer test-token');
  });

  it('login passes on the server locking an email after too many attempts', async () => {
    const { api } = setup(() => json({ error: { code: 'RATE_LIMITED', message: 'Too many failed attempts. Try again in 15 minutes.' } }, 429));
    await expect(api.account.login('a@b.co', 'pw')).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });
});

