/**
 * PLACEHOLDER for Yara's MessageLogView (/chats) and ChatView (/chats/:chatId), so MatchView's
 * "open the chat" step lands somewhere during development. Delete it, and its routes in
 * routes.tsx, once his views exist (notes-for-yara Y-8).
 */
import { useParams } from 'react-router-dom';

export function ChatPlaceholder() {
  const chatId = useParams<{ chatId?: string }>().chatId;
  return (
    <main className="page">
      <h1>{chatId === undefined ? 'Messages' : 'Chat'}</h1>
      <p>{chatId === undefined ? 'Your chats will appear here.' : `Chat ${chatId} will open here.`}</p>
    </main>
  );
}
