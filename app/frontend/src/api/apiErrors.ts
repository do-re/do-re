/**
 * The error every API method rejects with (docs/project/api.md, "Errors"), so views can switch on
 * `code` whether the mock or the HTTP client is behind the interface.
 */

/** The API's error codes, plus NETWORK_ERROR (client only: the request never got a reply). */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'EMPTY_MESSAGE'
  | 'MESSAGE_TOO_LONG'
  | 'PICTURE_TOO_LARGE'
  | 'UNAUTHENTICATED'
  | 'NOT_PARTICIPANT'
  | 'CHAT_NOT_FOUND'
  | 'MATCH_NOT_FOUND'
  | 'SONG_NOT_ACTIVE'
  | 'RATE_LIMITED'
  | 'NOT_ADMIN'
  | 'INTERNAL'
  | 'NETWORK_ERROR';

/** Every code the server may send. */
export const SERVER_ERROR_CODES: readonly ApiErrorCode[] = [
  'BAD_REQUEST',
  'EMPTY_MESSAGE',
  'MESSAGE_TOO_LONG',
  'PICTURE_TOO_LARGE',
  'UNAUTHENTICATED',
  'NOT_PARTICIPANT',
  'CHAT_NOT_FOUND',
  'MATCH_NOT_FOUND',
  'SONG_NOT_ACTIVE',
  'RATE_LIMITED',
  'NOT_ADMIN',
  'INTERNAL',
];

/**
 * A failed API request.
 * Rep invariant: message is non-empty and can be shown to the user; status is the HTTP status,
 * or 0 for NETWORK_ERROR.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  /**
   * Requires: message is non-empty and user-presentable.
   * Effects: creates the error.
   * @param code what went wrong
   * @param message text to show the user
   * @param status the HTTP status, or 0 if there was no reply
   */
  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}
