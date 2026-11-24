# Notes for Yara (from Gavin)

Things Yara needs to know, decide or provide, coming out of Gavin's frontend work. Yara owns ChatController, ChatView, MessageLogView, BottomBarView and ViewController, and shares SongController with Gavin.

**How to use:** add new items at the bottom of **Open** with the date. When an item is settled, move it to **Resolved** with the answer and date. Keep the ID; don't renumber.

Status: `TO TELL` (an FYI, not raised yet) · `ASK` (needs his answer, not raised yet) · `WAITING` (raised, no answer yet) · `AGREED` / `CHANGED` (moved to Resolved).

---

## Open

### Y-1 · Agree on URL paths — `ASK` (2026-11-17)
The frontend uses these paths (`frontend/src/paths.ts`):

| Path | View | Owner |
|---|---|---|
| `/login` | LoginView | Gavin |
| `/signup` | CreateAccountView | Gavin |
| `/home` | HomeView | Gavin |
| `/profile` | ProfileView | Gavin |
| `/match/:matchId` | MatchView | Gavin |
| `/chats` | MessageLogView | Yara |
| `/chats/:chatId` | ChatView | Yara |

The two chat paths are guesses; please confirm or change them. Use `PATHS.chat(id)` etc. instead of typing paths.

### Y-2 · Routing table lives in `routes.tsx` for now — `TO TELL` (2026-11-17)
- ViewController is Yara's. Until it exists, `frontend/src/routes.tsx` is the router.
- **It currently provides:**
  - a login guard (`RequireSession` sends logged-out users to `/login`);
  - the bottom-bar layout (`WithBottomBar`), hidden on login and signup (OPEN-10).
- **To do:** add the chat routes inside the guarded, bottom-bar group, or take the whole file over as ViewController.

### Y-3 · Temporary session state — `ASK` (2026-11-17)
- `frontend/src/session/SessionContext.tsx` holds the logged-in `userId` (in `sessionStorage`, so refresh works). It gives `useSession()` → `{ userId, logIn, logOut }`.
- **Question:** keep it as part of ViewController, or replace it with your own design? LoginView will call `logIn(userId)` on success.
- Real auth tokens depend on Felix (notes-for-felix F-1).
- ProfileView has a "Log out" button that calls `logOut()`, after which the route guard sends the user to `/login`. Keep `logOut` (or tell Gavin its new name) if you replace this file.

### Y-4 · Bottom bar placeholder — `TO TELL` (2026-11-17)
- `frontend/src/components/BottomBarPlaceholder.tsx` is a stand-in for BottomBarView: a `<nav aria-label="Main">` with Home / Messages / Profile links.
- **When you replace it:**
  - Swap it in `routes.tsx` (`WithBottomBar`).
  - Keep `aria-label="Main"`; the routing tests look it up by that name (or update `routes.test.tsx`).
  - `index.css` reserves `--bar-height` (56px) at the bottom of the page.

### Y-5 · Shared pieces you can reuse — `TO TELL` (2026-11-17)
- **`Modal`** (`frontend/src/components/Modal.tsx`): an accessible popup (`role="dialog"`, focus in and out, Escape closes, Tab stays inside). Useful for a report-confirmation popup in ChatView.
- **`useApi()`**: views reach the backend only through it.
  - Add a `ChatApi` interface to `frontend/src/api/client.ts` and a `chats` field on `Api`.
  - Add a fake to `mock.ts`, so the views can switch to the real backend later without changes.
  - Both files are Gavin's, so tell him before editing; he's happy to review.
- **`index.css`:** shared colour tokens and one app-wide font (R-UI-02). Please reuse the tokens rather than new colours, so light and dark mode stay consistent.

### Y-6 · MatchView sends users to ChatView — `TO TELL` (2026-11-17)
- On confirm, if MatchController returns a chat ID, MatchView navigates to `/chats/:chatId`. Otherwise it goes back to `/home` (OPEN-4).
- **Needed:**
  - ChatView must open a chat from the ID in its URL alone, because a refresh will do that.
  - MessageLogView must show a chat that appears later, when the other user confirms.

### Y-7 · SongController split — `ASK` (2026-11-17)
- SongController is shared (Gavin & Yara). The client half is `SongApi` in `frontend/src/api/client.ts`: `getCurrentSong`, `markLiked`, `submitFeedback`. HomeView (Gavin) is its only caller.
- **Question:** which parts of the server half does each of us take?

### Y-8 · Placeholder chat pages in `routes.tsx` — `TO TELL` (2026-11-17)
- So that confirming a match lands somewhere, `routes.tsx` sends `/chats` and `/chats/:chatId` to `frontend/src/views/ChatPlaceholder.tsx`. It shows a "Messages" or "Chat" heading and nothing else.
- **When your views are ready:** replace the two `ChatPlaceholder` routes with MessageLogView and ChatView, then delete the file. `routes.test.tsx` checks those two paths by their headings ("Messages" and "Chat"), so update it if your headings differ.
- **Already tested on the match side:** MatchView opens `/chats/<chatId>` when the other user had already said yes. It uses `replace`, so Back from the chat skips the answered match.

---

## Resolved

_(none yet)_
