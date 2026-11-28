/**
 * The real Api: one typed call per route in docs/project/api.md. The app uses it as soon as
 * VITE_API_BASE_URL is set (src/backend.ts).
 *
 * Except on the public account routes, the caller's identity comes only from the bearer token, so
 * user ID arguments are deliberately not sent. Emails go in request bodies, never in URLs, so they
 * can't end up in access logs.
 */
import { ApiError } from './apiErrors';
import { createHttpChatApi } from './chatHttp';
import type { AccountApi, AdminApi, Api, BrowserSubscription, MatchApi, PushApi, SongApi } from './client';
import { createHttpTransport, isRecord, malformed, type HttpOptions, type HttpTransport } from './http';
import {
  FEATURE_COUNT,
  type AdminReport,
  type AdminUser,
  type AuditEntry,
  type CreateAccountResult,
  type Feedback,
  type LoginResponse,
  type LoginResult,
  type Match,
  type OutgoingMatch,
  type ReportReason,
  type Song,
  type SwipeResult,
  type UndoResult,
  type UserProfile,
} from './types';

const LOGIN_FAILURES: readonly unknown[] = ['WRONG_PASSWORD', 'NO_ACCOUNT', 'NOT_VERIFIED', 'SUSPENDED'];
const CREATE_RESULTS: readonly unknown[] = [
  'PENDING_VERIFICATION',
  'EMAIL_IN_USE',
  'INVALID_EMAIL',
  'PASSWORDS_DO_NOT_MATCH',
];

function asProfile(body: unknown): UserProfile {
  if (!isRecord(body) || typeof body.userId !== 'string') throw malformed(200);
  return body as unknown as UserProfile;
}

function asSong(body: unknown): Song {
  if (!isRecord(body) || typeof body.id !== 'string' || !Array.isArray(body.features)) throw malformed(200);
  return body as unknown as Song;
}

function asMatch(body: unknown): Match {
  if (!isRecord(body) || typeof body.matchId !== 'string') throw malformed(200);
  return body as unknown as Match;
}

/**
 * Requires: none.
 * Effects: none.
 * @returns an AccountApi that talks to the server through http
 */
export function createHttpAccountApi(http: HttpTransport): AccountApi {
  return {
    async login(email: string, password: string): Promise<LoginResponse> {
      const body = await http.request('POST', '/auth/login', { json: { email, password }, auth: false });
      if (!isRecord(body)) throw malformed(200);
      if (body.result === 'SUCCESS' && typeof body.userId === 'string' && typeof body.token === 'string') {
        return { result: 'SUCCESS', userId: body.userId, token: body.token, ...(body.isAdmin === true ? { isAdmin: true } : {}) };
      }
      if (LOGIN_FAILURES.includes(body.result)) {
        return { result: body.result as Exclude<LoginResult, 'SUCCESS'> };
      }
      throw malformed(200);
    },

    async logout(): Promise<void> {
      await http.request('POST', '/auth/logout', { json: {} });
    },

    async createAccount(email: string, password: string, confirmPassword: string): Promise<CreateAccountResult> {
      const body = await http.request('POST', '/accounts', {
        json: { email, password, confirmPassword },
        auth: false,
      });
      if (!isRecord(body) || !CREATE_RESULTS.includes(body.result)) throw malformed(200);
      return body.result as CreateAccountResult;
    },

    async confirmEmail(userId: string, token: string): Promise<boolean> {
      const body = await http.request('POST', '/accounts/confirm', { json: { userId, token }, auth: false });
      if (!isRecord(body) || typeof body.confirmed !== 'boolean') throw malformed(200);
      return body.confirmed;
    },

    async isVerified(email: string): Promise<boolean> {
      const body = await http.request('POST', '/accounts/verification-status', { json: { email }, auth: false });
      if (!isRecord(body) || typeof body.verified !== 'boolean') throw malformed(200);
      return body.verified;
    },

    async getProfile(userId: string): Promise<UserProfile> {
      return asProfile(await http.request('GET', `/users/${encodeURIComponent(userId)}`));
    },

    async updateUsername(_userId: string, newUsername: string): Promise<void> {
      await http.request('PATCH', '/users/me', { json: { username: newUsername } });
    },

    async updateProfilePicture(_userId: string, image: Blob): Promise<void> {
      await http.request('PUT', '/users/me/picture', { file: image });
    },
  };
}

/**
 * Requires: none.
 * Effects: none.
 * @returns a SongApi that talks to the server through http
 */
export function createHttpSongApi(http: HttpTransport): SongApi {
  const songPath = (songId: string) => `/songs/${encodeURIComponent(songId)}`;

  return {
    async getCurrentSong(): Promise<Song> {
      return asSong(await http.request('GET', '/songs/current'));
    },

    async markLiked(_userId: string, songId: string): Promise<void> {
      await http.request('POST', `${songPath(songId)}/like`, { json: {} });
    },

    async submitFeedback(
      _userId: string,
      songId: string,
      swipe: Feedback,
      secondsListened: number,
    ): Promise<SwipeResult> {
      const body = await http.request('POST', `${songPath(songId)}/feedback`, { json: { swipe, secondsListened } });
      if (!isRecord(body)) throw malformed(200);
      return {
        nextSong: asSong(body.nextSong),
        offeredMatch: body.offeredMatch === null ? null : asMatch(body.offeredMatch),
      };
    },

    async canUndo(): Promise<boolean> {
      const body = await http.request('GET', '/songs/undo');
      if (!isRecord(body) || typeof body.canUndo !== 'boolean') throw malformed(200);
      return body.canUndo;
    },

    async undoLastSwipe(): Promise<UndoResult | null> {
      const body = await http.request('POST', '/songs/undo', { json: {} });
      if (!isRecord(body)) throw malformed(200);
      if (body.song === null) return null;
      if (typeof body.liked !== 'boolean' || typeof body.canUndo !== 'boolean') throw malformed(200);
      return { song: asSong(body.song), liked: body.liked, canUndo: body.canUndo };
    },

    async getTasteVector(): Promise<readonly number[]> {
      const body = await http.request('GET', '/songs/taste');
      if (
        !isRecord(body) ||
        !Array.isArray(body.taste) ||
        body.taste.length !== FEATURE_COUNT ||
        !body.taste.every((value) => typeof value === 'number')
      ) {
        throw malformed(200);
      }
      return body.taste as number[];
    },
  };
}

/**
 * Requires: none.
 * Effects: none.
 * @returns a MatchApi that talks to the server through http
 */
export function createHttpMatchApi(http: HttpTransport): MatchApi {
  const matchPath = (matchId: string) => `/matches/${encodeURIComponent(matchId)}`;

  return {
    async getPendingMatches(): Promise<Match[]> {
      const body = await http.request('GET', '/matches/pending');
      if (!isRecord(body) || !Array.isArray(body.matches)) throw malformed(200);
      return body.matches.map(asMatch);
    },

    async getMatch(matchId: string): Promise<Match | null> {
      try {
        return asMatch(await http.request('GET', matchPath(matchId)));
      } catch (error) {
        if (error instanceof ApiError && error.code === 'MATCH_NOT_FOUND') return null;
        throw error;
      }
    },

    async getOtherProfile(match: Match): Promise<UserProfile> {
      return asProfile(await http.request('GET', `${matchPath(match.matchId)}/other-user`));
    },

    async confirmMatch(match: Match): Promise<string | null> {
      const body = await http.request('POST', `${matchPath(match.matchId)}/confirm`, { json: {} });
      if (!isRecord(body) || (body.chatId !== null && typeof body.chatId !== 'string')) throw malformed(200);
      return body.chatId as string | null;
    },

    async declineMatch(match: Match): Promise<void> {
      await http.request('POST', `${matchPath(match.matchId)}/decline`, { json: {} });
    },

    async getOutgoingMatches(): Promise<OutgoingMatch[]> {
      const body = await http.request('GET', '/matches/outgoing');
      if (!isRecord(body) || !Array.isArray(body.matches)) throw malformed(200);
      return body.matches.map((entry: unknown) => {
        if (!isRecord(entry)) throw malformed(200);
        return { match: asMatch(entry.match), otherUser: asProfile(entry.otherUser) };
      });
    },

    async retractMatch(match: Match): Promise<void> {
      await http.request('POST', `${matchPath(match.matchId)}/retract`, { json: {} });
    },

    async reportProfile(match: Match, userId: string, reason: ReportReason, details: string): Promise<void> {
      // The server knows the caller from the token; the URL names the person being reported.
      const other = match.userA === userId ? match.userB : match.userA;
      await http.request('POST', `/users/${encodeURIComponent(other)}/report`, { json: { reason, details } });
    },
  };
}

/**
 * Requires: none.
 * Effects: none.
 * @returns an AdminApi that talks to the server through http
 */
export function createHttpAdminApi(http: HttpTransport): AdminApi {
  const userPath = (userId: string) => `/admin/users/${encodeURIComponent(userId)}`;
  const list = async <T>(path: string, field: string): Promise<T[]> => {
    const body = await http.request('GET', path);
    if (!isRecord(body) || !Array.isArray(body[field])) throw malformed(200);
    return body[field] as T[];
  };

  return {
    listUsers: () => list<AdminUser>('/admin/users', 'users'),
    async suspend(_adminId: string, userId: string, reason: string): Promise<void> {
      await http.request('POST', `${userPath(userId)}/suspend`, { json: { reason } });
    },
    async unsuspend(_adminId: string, userId: string): Promise<void> {
      await http.request('POST', `${userPath(userId)}/unsuspend`, { json: {} });
    },
    async verify(_adminId: string, userId: string): Promise<void> {
      await http.request('POST', `${userPath(userId)}/verify`, { json: {} });
    },
    async setAdmin(_adminId: string, userId: string, admin: boolean): Promise<void> {
      await http.request('POST', `${userPath(userId)}/admin`, { json: { admin } });
    },
    listReports: () => list<AdminReport>('/admin/reports', 'reports'),
    async resolveReport(_adminId: string, reportId: string, note: string): Promise<void> {
      await http.request('POST', `/admin/reports/${encodeURIComponent(reportId)}/resolve`, { json: { note } });
    },
    auditLog: () => list<AuditEntry>('/admin/audit', 'entries'),
  };
}

/**
 * Requires: none.
 * Effects: none.
 * @returns a PushApi that talks to the server through http
 */
export function createHttpPushApi(http: HttpTransport): PushApi {
  return {
    async getPublicKey(): Promise<string> {
      const body = await http.request('GET', '/push/public-key');
      if (!isRecord(body) || typeof body.publicKey !== 'string' || body.publicKey === '') throw malformed(200);
      return body.publicKey;
    },

    async saveSubscription(subscription: BrowserSubscription): Promise<void> {
      const { endpoint, keys } = subscription;
      await http.request('PUT', '/push/subscription', { json: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } });
    },

    async removeSubscription(endpoint: string): Promise<void> {
      await http.request('DELETE', '/push/subscription', { json: { endpoint } });
    },
  };
}

/**
 * Requires: options.baseUrl is an absolute URL.
 * Effects: none.
 * @returns the full Api over HTTP
 */
export function createHttpApi(options: HttpOptions): Api {
  const http = createHttpTransport(options);
  return {
    account: createHttpAccountApi(http),
    songs: createHttpSongApi(http),
    matches: createHttpMatchApi(http),
    chats: createHttpChatApi(http),
    push: createHttpPushApi(http),
    admin: createHttpAdminApi(http),
  };
}
