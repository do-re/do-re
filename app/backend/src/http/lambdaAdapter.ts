import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { HttpRequest, HttpResponse } from './api';

/** The four controller areas; each is deployed as its own Lambda function (architecture.md). */
export type Area = 'account' | 'song' | 'match' | 'chat';

/** The route prefixes of docs/project/api.md that each area's function serves. */
export const AREA_PREFIXES: Readonly<Record<Area, readonly string[]>> = {
  account: ['/api/auth', '/api/accounts', '/api/users', '/api/push', '/api/admin'],
  song: ['/api/songs'],
  match: ['/api/matches'],
  chat: ['/api/chats', '/api/presence'],
};

/**
 * Wraps the API as the Lambda handler for one controller area, behind an API Gateway HTTP
 * API (payload format 2.0).
 *
 * Effects: none at construction; getApi is called on the first request, so a cold start
 *          builds the services once and later requests on the same instance reuse them.
 * @param area   the area this function serves; requests for other paths get 404
 * @param getApi returns the function made by createApi
 * @returns the handler: converts the event to an HttpRequest, calls the API, and returns its
 *          response as JSON with caching disabled
 */
export function lambdaHandler(
  area: Area,
  getApi: () => (request: HttpRequest) => Promise<HttpResponse>,
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2> {
  return async (event) => {
    const request = toRequest(event);
    const mine = AREA_PREFIXES[area].some((prefix) => request.path === prefix || request.path.startsWith(`${prefix}/`));
    const response: HttpResponse = mine
      ? await getApi()(request)
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'There is nothing at that address.' } } };
    return {
      statusCode: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      body: response.body === undefined ? '' : JSON.stringify(response.body),
    };
  };
}

/**
 * Effects: none.
 * @param event an API Gateway HTTP API event (payload format 2.0)
 * @returns the request it describes, with lower-case header names and the body as bytes
 *          (API Gateway base64-encodes binary bodies such as uploaded pictures)
 */
export function toRequest(event: APIGatewayProxyEventV2): HttpRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  const body =
    event.body === undefined
      ? undefined
      : Uint8Array.from(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  return {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    headers,
    body,
  };
}
