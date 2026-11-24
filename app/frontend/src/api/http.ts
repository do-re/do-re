/**
 * The HTTP layer shared by every real API client: base URL, bearer token, JSON or file bodies, and
 * turning failures into ApiError (docs/project/api.md, "Conventions" and "Errors").
 * Tokens and passwords are never logged.
 */
import { ApiError, SERVER_ERROR_CODES, type ApiErrorCode } from './apiErrors';

const GENERIC_MESSAGE = 'Something went wrong. Try again.';

export interface HttpOptions {
  /** The API's base URL (VITE_API_BASE_URL). A trailing slash is ignored. */
  readonly baseUrl: string;
  /** The current session token, or null when logged out. */
  readonly getToken: () => string | null;
  /** Called when the server rejects the session, so the app can return to login. */
  readonly onUnauthorized?: () => void;
  /** Defaults to the browser's fetch; tests pass a fake. */
  readonly fetchFn?: typeof fetch;
}

export interface RequestOptions {
  /** Sent as a JSON body. */
  readonly json?: object;
  /** Sent as the raw body, with the file's own Content-Type. */
  readonly file?: Blob;
  /** Whether the route needs the session token. Default true. */
  readonly auth?: boolean;
}

export interface HttpTransport {
  /**
   * Requires: path starts with "/".
   * Effects: sends the request.
   * @returns the parsed JSON body, or undefined for a 204
   * @throws ApiError if the token is missing, there is no reply, the status isn't 2xx or the body
   *         can't be read
   */
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>;
}

/**
 * Requires: baseUrl is an absolute URL.
 * Effects: none.
 * @returns a transport that talks to the server over HTTPS
 */
export function createHttpTransport({ baseUrl, getToken, onUnauthorized, fetchFn }: HttpOptions): HttpTransport {
  const base = baseUrl.replace(/\/+$/, '');
  const send: typeof fetch = fetchFn ?? ((input, init) => fetch(input, init));

  return {
    async request(method, path, { json, file, auth = true } = {}) {
      const headers: Record<string, string> = {};
      if (auth) {
        const token = getToken();
        if (token === null) {
          onUnauthorized?.();
          throw new ApiError('UNAUTHENTICATED', 'Your session has ended. Log in again.', 401);
        }
        headers.Authorization = `Bearer ${token}`;
      }
      let body: BodyInit | undefined;
      if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      } else if (file !== undefined) {
        headers['Content-Type'] = file.type;
        body = file;
      }

      let response: Response;
      try {
        response = await send(`${base}${path}`, { method, headers, body });
      } catch {
        throw new ApiError('NETWORK_ERROR', "Can't reach the server. Check your connection and try again.", 0);
      }
      if (!response.ok) {
        const error = await toError(response);
        if (auth && error.status === 401) onUnauthorized?.();
        throw error;
      }
      if (response.status === 204) return undefined;
      try {
        return await response.json();
      } catch {
        throw malformed(response.status);
      }
    },
  };
}

/** Reads api.md's `{ error: { code, message } }` body, falling back when it isn't that shape. */
async function toError(response: Response): Promise<ApiError> {
  let code: ApiErrorCode = 'INTERNAL';
  let message = GENERIC_MESSAGE;
  try {
    const body: unknown = await response.json();
    const error = isRecord(body) ? body.error : undefined;
    if (isRecord(error)) {
      if (SERVER_ERROR_CODES.includes(error.code as ApiErrorCode)) code = error.code as ApiErrorCode;
      if (typeof error.message === 'string' && error.message !== '') message = error.message;
    }
  } catch {
    // Not JSON (e.g. a gateway error page): keep the generic error.
  }
  return new ApiError(code, message, response.status);
}

/**
 * Requires: none.
 * Effects: none.
 * @returns the error for a successful response whose body isn't the agreed shape
 */
export function malformed(status: number): ApiError {
  return new ApiError('INTERNAL', GENERIC_MESSAGE, status);
}

/**
 * Requires: none.
 * Effects: none.
 * @returns true iff value is a non-null object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
