import { z, ZodError } from 'zod';
import { AppError, badRequest, matchNotFound, unauthorized } from '../errors';
import { type ChatMessage, otherUser, type Song } from '../model/types';
import type { Services } from '../services';

/** An HTTP request, independent of how it arrived (API Gateway in production, direct calls in tests). */
export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string | undefined>>;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The raw request body: JSON text for every route except the picture upload. */
  readonly body: Uint8Array | undefined;
}

/** body is JSON-serialisable, or undefined for 204. */
export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

interface Context {
  /** The logged-in user; '' on public routes. */
  readonly userId: string;
  /** The session token; '' on public routes. */
  readonly token: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  /** The raw body. */
  readonly bytes: Uint8Array | undefined;
  /** The body parsed as JSON (undefined if there is none). Throws 400 if it is not JSON. */
  readonly json: () => unknown;
}

interface Route {
  readonly method: string;
  /** Path under /api; a segment starting with ":" matches anything and is put in params. */
  readonly path: string;
  /** Public routes need no session. */
  readonly public?: true;
  /** Returns the response body (undefined for 204), or a Created for 201. */
  readonly handle: (ctx: Context) => Promise<unknown>;
}

/** A handler result that is sent with status 201. */
class Created {
  constructor(readonly body: unknown) {}
}

// Request body shapes (docs/project/api.md). The server is the authority: every body is
// checked here, whatever the client validated.
const text = (max: number) => z.string().max(max);
const signupBody = z.object({ email: text(254), password: text(1024), confirmPassword: text(1024) });
const loginBody = z.object({ email: text(254), password: text(1024) });
const confirmBody = z.object({ userId: text(100), token: text(200) });
const emailBody = z.object({ email: text(254) });
const usernameBody = z.object({ username: text(200) });
const feedbackBody = z.object({ swipe: z.enum(['LIKE', 'SKIP']), secondsListened: z.number() });
const messageBody = z.object({ text: z.string() });

const iso = (time: number) => new Date(time).toISOString();

/**
 * The server half of every controller's client/server communication: maps each HTTP route
 * of docs/project/api.md (served under /api) to controller calls.
 *
 * Every route except login, sign-up, confirm and verification-status requires a valid
 * session token, and the caller's user ID always comes from that session, never from the
 * request. The controllers' `Requires:` clauses about the caller (participant of the chat,
 * party to the match, active song) are enforced by the controllers and models and surface
 * here as 4xx responses. Every authenticated chat route also records a heartbeat for the
 * caller.
 *
 * Requires: services were built by buildServices.
 * Effects: none at construction. The returned function performs the effects of the
 *          controller methods the matched route calls.
 * @param services the server-side components
 * @param log      where unexpected errors are reported. Receives the error's name and stack
 *                 frames only, never its message, so no email, password or token is logged.
 * @returns a function that answers one request. It never throws: failures become responses
 *          with the body { error: { code, message } } (api.md "Errors").
 */
export function createApi(
  services: Services,
  log: (line: string) => void = console.error,
): (request: HttpRequest) => Promise<HttpResponse> {
  const { accounts, sessions, songs, matches, matchModel, chats, clock } = services;

  const messageDto = (message: ChatMessage) => ({
    messageId: String(message.seq),
    senderId: message.senderId,
    text: message.text,
    timestamp: iso(message.timestamp),
  });

  /** A chat route: the same handler, after recording the caller's heartbeat. */
  const chatRoute = (route: Route): Route => ({
    ...route,
    handle: async (ctx) => {
      await chats.recordHeartbeat(ctx.userId, clock());
      return route.handle(ctx);
    },
  });

  const routes: Route[] = [
    // ------------------------------------------------------------ account
    {
      method: 'POST',
      path: '/auth/login',
      public: true,
      handle: async ({ json }) => {
        const { email, password } = loginBody.parse(json());
        const result = await accounts.login(email, password);
        if (result !== 'SUCCESS') {
          return { result };
        }
        const userId = await accounts.getUserId(email);
        return { result, userId, token: await sessions.createSession(userId) };
      },
    },
    // Not in the stubs: ends the session on the server, so a copied token stops working.
    { method: 'POST', path: '/auth/logout', handle: ({ token }) => sessions.endSession(token) },
    {
      method: 'POST',
      path: '/accounts',
      public: true,
      handle: async ({ json }) => {
        const { email, password, confirmPassword } = signupBody.parse(json());
        return { result: await accounts.createAccount(email, password, confirmPassword) };
      },
    },
    {
      method: 'POST',
      path: '/accounts/confirm',
      public: true,
      handle: async ({ json }) => {
        const { userId, token } = confirmBody.parse(json());
        return { confirmed: await accounts.confirmEmail(userId, token) };
      },
    },
    {
      method: 'POST',
      path: '/accounts/verification-status',
      public: true,
      handle: async ({ json }) => {
        const { email } = emailBody.parse(json());
        // An unknown email answers false rather than 404, to say as little as possible (Q-12).
        return { verified: (await accounts.isEmailInUse(email)) && (await accounts.isVerified(email)) };
      },
    },
    {
      method: 'GET',
      path: '/users/:userId',
      handle: ({ userId, params }) => accounts.getProfile(params.userId === 'me' ? userId : params.userId!),
    },
    {
      method: 'PATCH',
      path: '/users/me',
      handle: ({ userId, json }) => accounts.updateUsername(userId, usernameBody.parse(json()).username),
    },
    {
      method: 'PUT',
      path: '/users/me/picture',
      handle: ({ userId, bytes }) => accounts.updateProfilePicture(userId, bytes ?? new Uint8Array()),
    },

    // ------------------------------------------------------------ song
    { method: 'GET', path: '/songs/current', handle: async ({ userId }) => songDto(await songs.getCurrentSong(userId)) },
    { method: 'GET', path: '/songs/undo', handle: async ({ userId }) => ({ canUndo: await songs.canUndo(userId) }) },
    {
      method: 'POST',
      path: '/songs/undo',
      handle: async ({ userId }) => {
        const undone = await songs.undoLastSwipe(userId);
        return undone === undefined
          ? { song: null, liked: false, canUndo: false }
          : { song: songDto(undone.song), liked: undone.liked, canUndo: undone.canUndo };
      },
    },
    {
      method: 'GET',
      path: '/songs/taste',
      handle: async ({ userId }) => ({ taste: (await songs.getTasteVector(userId)).values() }),
    },
    { method: 'POST', path: '/songs/:songId/like', handle: ({ userId, params }) => songs.markLiked(userId, params.songId!) },
    {
      method: 'POST',
      path: '/songs/:songId/feedback',
      handle: async ({ userId, params, json }) => {
        const { swipe, secondsListened } = feedbackBody.parse(json());
        const result = await songs.submitFeedback(userId, params.songId!, swipe, secondsListened);
        return { nextSong: songDto(result.nextSong), offeredMatch: result.offeredMatch ?? null };
      },
    },

    // ------------------------------------------------------------ match
    {
      method: 'GET',
      path: '/matches/pending',
      handle: async ({ userId }) => ({ matches: await matches.getPendingMatches(userId) }),
    },
    {
      method: 'GET',
      path: '/matches/:matchId',
      handle: async ({ userId, params }) => {
        const match = await matches.getMatch(params.matchId!, userId);
        if (match === undefined) {
          throw matchNotFound();
        }
        return match;
      },
    },
    {
      method: 'GET',
      path: '/matches/:matchId/other-user',
      handle: async ({ userId, params }) => matches.getOtherProfile(await matchModel.getMatch(params.matchId!), userId),
    },
    {
      method: 'POST',
      path: '/matches/:matchId/confirm',
      handle: async ({ userId, params }) => ({ chatId: (await matches.confirmMatch(params.matchId!, userId)) ?? null }),
    },
    {
      method: 'POST',
      path: '/matches/:matchId/decline',
      handle: ({ userId, params }) => matches.declineMatch(params.matchId!, userId),
    },

    // ------------------------------------------------------------ chat
    chatRoute({
      method: 'GET',
      path: '/chats',
      handle: async ({ userId }) => {
        const entries = (await chats.getChatLog(userId)).map(async (chat) => ({
          chatId: chat.chatId,
          otherUser: await accounts.getProfile(otherUser(chat, userId)),
          lastMessage: chat.lastMessage === undefined ? null : messageDto(chat.lastMessage),
          lastActivityAt: iso(chat.lastActivity),
        }));
        return { chats: await Promise.all(entries) };
      },
    }),
    chatRoute({
      method: 'GET',
      path: '/chats/:chatId/messages',
      handle: async ({ userId, params, query }) => {
        const since = query.since === undefined ? undefined : Date.parse(query.since);
        if (Number.isNaN(since)) {
          throw badRequest('since must be an ISO-8601 timestamp.');
        }
        const now = clock();
        const chat = await chats.getChat(params.chatId!, userId, since);
        const other = otherUser(chat, userId);
        const [profile, online] = await Promise.all([accounts.getProfile(other), chats.isUserOnline(other, now)]);
        return {
          chatId: chat.chatId,
          otherUser: profile,
          otherUserOnline: online,
          messages: chat.messages.map(messageDto),
          serverTime: iso(now),
        };
      },
    }),
    chatRoute({
      method: 'POST',
      path: '/chats/:chatId/messages',
      handle: async ({ userId, params, json }) => {
        const message = await chats.sendMessage(params.chatId!, userId, messageBody.parse(json()).text);
        return new Created(messageDto(message));
      },
    }),
    chatRoute({
      method: 'DELETE',
      path: '/chats/:chatId',
      handle: ({ userId, params }) => chats.removeChatFromLog(userId, params.chatId!),
    }),
    chatRoute({
      method: 'POST',
      path: '/chats/:chatId/report',
      handle: ({ userId, params }) => chats.reportChat(userId, params.chatId!),
    }),
    { method: 'POST', path: '/presence/heartbeat', handle: ({ userId }) => chats.recordHeartbeat(userId, clock()) },
  ];

  return async (request) => {
    try {
      const found = findRoute(routes, request.method, request.path);
      if (found === undefined) {
        throw new AppError(404, 'NOT_FOUND', 'There is nothing at that address.');
      }
      let userId = '';
      let token = '';
      if (!found.route.public) {
        token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
        userId = (token === '' ? undefined : await sessions.authenticate(token)) ?? '';
        if (userId === '') {
          throw unauthorized();
        }
      }
      const result = await found.route.handle({
        userId,
        token,
        params: found.params,
        query: request.query,
        bytes: request.body,
        json: () => parseJson(request.body),
      });
      if (result instanceof Created) {
        return { status: 201, body: result.body };
      }
      return result === undefined ? { status: 204, body: undefined } : { status: 200, body: result };
    } catch (error) {
      if (error instanceof AppError) {
        return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      }
      if (error instanceof ZodError) {
        const issue = error.issues[0]!;
        const message = `${issue.path.join('.') || 'request'}: ${issue.message}`;
        return { status: 400, body: { error: { code: 'BAD_REQUEST', message } } };
      }
      const { name, stack } = error as Error;
      log(`Unexpected ${name} on ${request.method} ${request.path}\n${(stack ?? '').split('\n').slice(1, 6).join('\n')}`);
      const message = 'Something went wrong on our side. Please try again.';
      return { status: 500, body: { error: { code: 'INTERNAL', message } } };
    }
  };
}

function findRoute(
  routes: readonly Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | undefined {
  const segments = path.split('/');
  for (const route of routes) {
    const pattern = `/api${route.path}`.split('/');
    if (route.method !== method || pattern.length !== segments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    const matches = pattern.every((part, i) => {
      if (part.startsWith(':') && segments[i] !== '') {
        params[part.slice(1)] = decodeURIComponent(segments[i]!);
        return true;
      }
      return part === segments[i];
    });
    if (matches) {
      return { route, params };
    }
  }
  return undefined;
}

function parseJson(body: Uint8Array | undefined): unknown {
  if (body === undefined || body.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw badRequest('The request body must be JSON.');
  }
}

/** The Song shape of api.md: the song with its 7 features as a plain array. */
function songDto(song: Song): object {
  return { ...song, features: song.features.values() };
}
