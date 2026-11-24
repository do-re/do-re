/**
 * The real ChatApi: one typed call per chat route in docs/project/api.md.
 *
 * The caller's identity comes only from the bearer token, so the user ID arguments of ChatApi are
 * deliberately not sent (api.md: "the client never sends its own userId").
 */
import type { ChatApi } from './client';
import { isRecord, malformed, type HttpTransport } from './http';
import type { ChatHistory, ChatMessage, ChatSummary } from './types';

/**
 * Requires: none.
 * Effects: none.
 * @returns a ChatApi that talks to the server through http
 */
export function createHttpChatApi(http: HttpTransport): ChatApi {
  const chatPath = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;

  return {
    async getChatLog(): Promise<ChatSummary[]> {
      const body = await http.request('GET', '/chats');
      if (!isRecord(body) || !Array.isArray(body.chats)) throw malformed(200);
      return body.chats as ChatSummary[];
    },

    async getHistory(chatId: string, _userId: string, since?: string): Promise<ChatHistory> {
      const query = since === undefined ? '' : `?since=${encodeURIComponent(since)}`;
      const body = await http.request('GET', `${chatPath(chatId)}/messages${query}`);
      if (!isRecord(body) || !Array.isArray(body.messages)) throw malformed(200);
      return body as unknown as ChatHistory;
    },

    async sendMessage(chatId: string, _senderId: string, text: string): Promise<ChatMessage> {
      const body = await http.request('POST', `${chatPath(chatId)}/messages`, { json: { text } });
      if (!isRecord(body) || typeof body.messageId !== 'string') throw malformed(201);
      return body as unknown as ChatMessage;
    },

    async removeChatFromLog(_userId: string, chatId: string): Promise<void> {
      await http.request('DELETE', chatPath(chatId));
    },

    async reportChat(_userId: string, chatId: string): Promise<void> {
      await http.request('POST', `${chatPath(chatId)}/report`, { json: {} });
    },

    async recordHeartbeat(): Promise<void> {
      await http.request('POST', '/presence/heartbeat', { json: {} });
    },
  };
}
