# Yara — task brief (from the Milestone 3 plan)

Claude Code: this is the work list for Yara's sessions. Read `CLAUDE.md` first; everything there (precedence, specs, tests, AI log) applies. Work through the phases in order and tick items off in this file as they're done (`[x]`), so progress survives between sessions.

## What Yara owns

From the Milestone 3 plan, section 3 ("Component Ownership"):

| Component | Side | Ownership |
|---|---|---|
| **ChatController** | client + server | Yara implements; **coordinates with Felix** for API integration |
| **ChatView** | client | Yara |
| **MessageLogView** | client | Yara |
| **BottomBarView** | client | Yara |
| **ViewController** | client | Yara implements; **coordinates with Felix** for API integration |
| **SongController** | client + server | **Gavin and Yara** implement; coordinate with Felix for backend integration |

Felix owns **ChatModel**, the DynamoDB tables and the AWS setup. Gavin owns HomeView, MatchView and MatchController, which call into Yara's components.

Don't edit their components. Where Yara's work needs something from theirs (an API route, a table, a method), write it down under **Hand-offs** below and say so in your reply.

## Requirements to satisfy (IDs in `docs/project/requirements.md`)

- **Chat:** R-CHAT-01 to R-CHAT-16. Every one is black-box, so the logic behind it still gets unit tests (`testing.md`).
- **Navigation:** R-UI-04, R-UI-05, R-ACC-06 (routing to Home after login), R-CHAT-05 (back button).
- **Songs (shared with Gavin):** R-HOME-03, R-HOME-15, R-HOME-16, R-HOME-25, plus the SongController side of R-HOME-17 and R-HOME-19 (it feeds MusicTasteModel and MatchModel).
- **Match → chat:** R-HOME-23 (ChatController.openChat is called by MatchController).

The specs to implement are in `architecture-stubs-v2.java`: `class ChatController`, `ChatView`, `MessageLogView`, `BottomBarView`, `ViewController` and `SongController`. Each method's `Requires:` / `Effects:` is the contract, and its `Satisfies:` line names the requirements.

## Timeline (team plan) and where we are

| Plan date | Item | Status |
|---|---|---|
| Nov 16 | Front end done (views + mock controllers, local mock DB) | **overdue** |
| Nov 18 | Chat system on AWS (with Felix) | **overdue** |
| Nov 22 | Front end integrated with backend API | **overdue** |
| **Nov 25** | App complete; manual review starts | |
| **Nov 27** | Milestone 4 release | |
| Dec 3 | Live demo | |

Plan for the tight schedule: get the client components working against mocks first (Phase 2), then swap in Felix's API (Phase 4). This way a slip on the backend never blocks the demo.

## Phase 0 — orient (first session only)

- [x] Find out what already exists. _(2026-11-23: do-re/do-re has only docs + stubs on `main`, `milestone-2`, `milestone-3`; no app code. Waiting on Yara: does code live in the course repo?)_ Find out what already exists. Check this repo, any branches, and ask Yara whether the team's code lives elsewhere (e.g. the course repo `CPEN-221-2026/cpen-221-2026-project-<n>`). If code exists, build the graph (`/graphify .`) and map it to the stubs before writing anything. **Don't scaffold a second app next to an existing one.**
- [x] _(2026-11-23: no scaffold needed. Gavin's `gavin-frontend` branch already has the Vite + React + TypeScript + Vitest app in `app/frontend`; Yara's work builds on it in branch `yara-chat`.)_ If no frontend exists yet, confirm with Yara whether to scaffold it. Use Vite + React + TypeScript in `frontend/`, with Vitest + React Testing Library. Gavin's screens will live there too, so agree on the folder layout before he starts.
- [ ] _(2026-11-23: DRAFT written in `docs/project/api.md`; waiting on Felix for Q-1 to Q-9.)_ Agree the **chat API contract** with Felix and write it in `docs/project/api.md`: routes, request/response JSON, error codes, polling interval. Draft it from the ChatController stub; Felix confirms it.

## Phase 1 — shared client foundations (unblocks Gavin too)

- [x] **ViewController = the router** (`app/frontend/src/routes.tsx`). One route per `ViewType`: `/login`, `/signup`, `/home`, `/profile`, `/match/:matchId`, `/chats/:chatId`, `/chats` (chat paths agreed, notes-for-yara Y-1). Logged-out users are redirected to `/login`, logged-in users away from `/login`. Back/forward/refresh work. (R-ACC-06, R-UI-04)
- [x] **BottomBarView:** Home / Messages / Profile, shown on every route except `/login` and `/signup`. The current page is highlighted. (R-UI-04, R-UI-05; OPEN-10)
- [x] **API client module** (`app/frontend/src/api/`): a typed function per chat route (`client.ts`, `chatHttp.ts`), plus a mock implementation behind the same interface (`mockChat.ts`) so views work before the backend is ready. `chatHttp.ts` isn't wired in until the backend and session token exist.

## Phase 2 — chat UI against mocks

- [x] **MessageLogView:** one row per chat (other user's picture + username), most recent activity first, remove-chat button, tap opens the chat. (R-CHAT-01, R-CHAT-02)
- [x] **ChatView header:** back button, username, green online dot, report button, left to right. (R-CHAT-03 to R-CHAT-06, R-CHAT-14)
- [x] **ChatView messages:** theirs on the left in **grey** bubbles; yours on the right in **blue** (iMessage style). Each sender's picture shows once per group of messages sent within 60 s (architecture.md and the sketch show both users' pictures). `startsNewGroup` is a pure function, tested at 59, 60 and 61 seconds. (R-CHAT-07 to R-CHAT-11)
- [x] **Composer:** rounded text bar plus send button. Enter sends; empty text does nothing. (R-CHAT-12, R-CHAT-13)
- [x] **Report:** after a confirmation popup, reports the chat, removes it from the list and returns to `/chats`. (R-CHAT-15)
- [x] **Polling:** while a chat is open, fetch history every ~3 s; that same call is the heartbeat (see `architecture.md` → real-time chat). Stop polling when the view unmounts.

## Whole frontend (added 2026-11-23, with Gavin's consent)

- [x] Demo backend follows the Java model stubs: taste update, suggestions near taste, ranked 72 h matching, final declines.
- [x] Fake users match you through songs you both like; no automatic match at login.
- [x] `/verify` page for the email link (R-SEC-02); blank new accounts (R-ACC-09).
- [x] Typed HTTP calls for every route, session token handling, and one setting to switch to the real backend.
- [x] Silent demo player, crash page, credits and logo.
- [x] Handoff for Felix: `docs/project/frontend-handoff.md`.
- [x] Smooth progress bar, undo button, swipe and like effects, developer mode (no requirement IDs; Yara's request).

## Phase 3 — ChatController server side (with Felix)

- [ ] Lambda handler(s) for the chat routes, calling Felix's ChatModel through its store interface.
- [ ] `reportChat` → `ChatModel.flagChat` + remove from the reporter's log (R-CHAT-16).
- [ ] `recordHeartbeat` / `isUserOnline` with a 30 s window (R-CHAT-06).
- [ ] `openChat`, called by MatchController when both users confirm. **Exactly one chat per match**, even when both confirm at once. This is the course's concurrency requirement, so it needs a concurrency test (`testing.md`).

## Phase 4 — SongController (with Gavin)

- [ ] Split the work with Gavin first (suggested: Gavin does the client side used by HomeView; Yara does the server side). Record the split in Hand-offs.
- [ ] `getCurrentSong`, `markLiked` (idempotent; counts once), `submitFeedback` → `SwipeResult` (LIKE if swiped right *or* marked liked; updates taste, match activity and swipe count; may return a match). (R-HOME-03, 15, 16, 25; OPEN-2)

## Phase 5 — integrate and harden (by Nov 25)

- [ ] Swap mocks for the real API; run the chat flow end to end on the deployed app.
- [ ] Coverage meets `testing.md` targets for Yara's code (frontend: branch ≥ 85%, lines ≥ 90%; backend: JaCoCo complexity ≥ 90%, branch ≥ 85%, method 100%).
- [ ] Code-review checklist (`testing.md`) applied to every file Yara owns.
- [ ] Known bugs for Yara's components are written down for the Milestone 4 known-bugs list.
- [ ] AI usage log rows added for each session.

## Hand-offs and open questions

Write here anything that needs Felix, Gavin or the team (date, who, what):

- 2026-11-23 · Felix · Confirm the chat API draft (`docs/project/api.md`, questions Q-1 to Q-9): auth token, picture URLs, `messageId` on ChatMessage, `since` filter, max length, app-wide heartbeat route, 404 after remove/report.
- 2026-11-23 · Felix · Proposed ChatModel signature change: `createChat(matchId, userA, userB)` with a conditional put keyed on the match, so a match can never get two chats (api.md Q-8). Public spec change → his call.
- 2026-11-23 · Gavin + Felix · Session token format from login (api.md Q-1); the chat routes depend on it.
- 2026-11-23 · Gavin · RESOLVED: the frontend stays in Gavin's `app/frontend` layout. Yara's answers to Gavin's notes: Y-1 yes (`/chats`, `/chats/:chatId`); Y-3 yes (keep `SessionContext` for now).
- 2026-11-23 · Gavin · Y-7 still open. Proposal: Gavin keeps the SongController client half; Yara writes the server half as plain Java once the backend project exists.
- 2026-11-23 · Gavin · Gave consent for Yara to finish the whole frontend, including Gavin's components. Changes are on `yara-chat`, for Gavin to review before merging.
- 2026-11-23 · Felix · The backend repo structure doesn't exist yet. Yara's Java controllers (Phase 3, 4) need it, or Felix's OK for Yara to create it.
- 2026-11-23 · Felix · The frontend has HTTP calls for every route in `api.md`. Connecting needs the base URL and session token (Q-1); steps are in `frontend-handoff.md`. The app-wide heartbeat stays unwired until Q-7 is answered.
- 2026-11-23 · Felix · Polling change in `api.md`: the client re-requests the last 5 s and de-duplicates by `messageId`, so a message saved just after a poll isn't lost. This depends on Q-3 (`messageId`).
- 2026-11-23 · Team · Known limit of the mock: its data lives in one browser tab and resets on refresh, so two people can't message each other until the backend is live.
