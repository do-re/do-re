/**
 * An error the HTTP layer turns into a response with this status and the body
 * `{ "error": { "code", "message" } }` (docs/project/api.md, "Errors").
 * Messages are shown to users, so they say what to fix and never contain emails,
 * passwords or tokens.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 400. code defaults to BAD_REQUEST; chat text errors pass EMPTY_MESSAGE or MESSAGE_TOO_LONG. */
export const badRequest = (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message);
export const unauthorized = () => new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Log in again.');
export const notParticipant = (message: string) => new AppError(403, 'NOT_PARTICIPANT', message);
export const userNotFound = () => new AppError(404, 'USER_NOT_FOUND', 'That account does not exist.');
export const chatNotFound = () => new AppError(404, 'CHAT_NOT_FOUND', "This chat doesn't exist or was removed.");
export const matchNotFound = () =>
  new AppError(404, 'MATCH_NOT_FOUND', "This match doesn't exist or is no longer waiting for your answer.");
export const songNotActive = () =>
  new AppError(409, 'SONG_NOT_ACTIVE', 'That is no longer your current song. Reload to get the current one.');
export const pictureTooLarge = (message: string) => new AppError(413, 'PICTURE_TOO_LARGE', message);
