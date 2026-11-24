# Notes for Yara (from Gavin)

Things Yara needs to know, decide or provide, coming out of Gavin's frontend work. Yara owns ChatController, ChatView, MessageLogView, BottomBarView and ViewController, and shares SongController with Gavin.

**How to use:** add new items at the bottom of **Open** with the date. When an item is settled, move it to **Resolved** with the answer and date. Keep the ID; don't renumber.

Status: `TO TELL` (an FYI, not raised yet) · `ASK` (needs an answer, not raised yet) · `WAITING` (raised, no answer yet) · `AGREED` / `CHANGED` (moved to Resolved).

---

## Open

### Y-7 · SongController split — `ASK` (2026-11-17)
- SongController is shared (Gavin & Yara). The client half is `SongApi` in `frontend/src/api/client.ts` and `httpApi.ts`: `getCurrentSong`, `markLiked`, `submitFeedback`. HomeView (Gavin) is its only caller.
- **Question:** which parts of the server half does each of us take?
- **Yara's proposal (2026-11-23):** the client half is done. Yara writes the server half as plain Java once Felix has set up the backend project.

---

## Resolved

### Y-1 · URL paths — `AGREED` (2026-11-23)
`/chats` for MessageLogView and `/chats/:chatId` for ChatView, as Gavin proposed.

### Y-2 · Routing table — `CHANGED` (2026-11-23)
`frontend/src/routes.tsx` is now ViewController.

### Y-3 · Session state — `AGREED` (2026-11-23)
Kept `SessionContext`, including `logOut`. It now also stores the login token (`session/sessionStore.ts`).

### Y-4 · Bottom bar placeholder — `CHANGED` (2026-11-23)
Replaced by `components/BottomBarView.tsx`, keeping `aria-label="Main"`.

### Y-5 · Shared pieces — `AGREED` (2026-11-23)
Chat uses `Modal`, `useApi()` and the `index.css` tokens. `ChatApi` is in `client.ts`, with its mock in `mockChat.ts`.

### Y-6 · MatchView sends users to ChatView — `AGREED` (2026-11-23)
ChatView opens from the ID in its URL alone, and MessageLogView refreshes so a chat appears when the other user confirms.

### Y-8 · Placeholder chat pages — `CHANGED` (2026-11-23)
Replaced by the real views, and `ChatPlaceholder.tsx` was deleted.
