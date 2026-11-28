# Architecture (golden reference)

**Source of truth:** the team's Milestone 2 component descriptions (PDF supplied by the team, Nov 11 2026). Where this document and the design spec, sketches, requirements or stubs disagree, **this document wins**, and the disagreement goes in `open-issues.md`.

**Owners** are from the team's Milestone 3 plan. "A (with B)" means A implements and coordinates with B for backend/API integration.

**Stubs:** `architecture-stubs-v2.java` (the implementation starting point). `milestone-2-stubs.java` is the graded Milestone 2 snapshot; leave it unchanged.

Labels: text without a label is the golden document. `[ADDED]` = filled in from requirements or stubs v2 because the golden text is silent or truncated. `[OWNER]` = from the Milestone 3 plan.

## Placement

- **All models are server side.** (golden)
- **All controllers perform API calls between** … (golden text is truncated, OPEN-14). `[ADDED]` Read as: each controller has a client side that sends API requests and a server side that handles them and calls the models. The team plan agrees: "controllers are communicators between front and backend."
- **Views are client side** (team plan: "views are the UI of our app").

## Deployment `[ADDED — team decision 2026-11-11, OPEN-11]`

| Part | Runs on | Notes |
|---|---|---|
| Frontend (views, ViewController, client half of controllers) | **React + TypeScript** single-page app, built to static files on **S3 + CloudFront** | Each view is a React component; ViewController is the app's routing/state; talks to the backend over HTTPS |
| Backend (server half of controllers, all models) | **TypeScript on AWS Lambda** (Node.js 22; changed from Java on 2026-11-23, OPEN-11), behind an API Gateway HTTP API that CloudFront serves under `/api/*` | One handler per controller area: account, song, match, chat. Code in `backend/`; API contract in `docs/project/api.md` |
| Data | **DynamoDB** (one table, provisioned mode, small capacity, to stay in the free tier) | Accounts, sessions, taste vectors + history, active song, matches, chats, heartbeats. Key layout: `backend/README.md` |
| Song library | Starting library: CSV file bundled with the backend, loaded when a Lambda starts. Plus songs pulled while users swipe from **ReccoBeats** (audio features, recommendations) and **Spotify** (covers), stored in DynamoDB | Changed 2026-11-26, OPEN-6. Details: `backend/README.md` |
| Email | **Amazon SES** | Production access: Felix (OPEN-7) |
| Profile pictures | **S3** bucket, served by CloudFront under `/pictures/*` | The account stores only the picture's URL (api.md Q-2) |
| Admin panel and reports | Server: `AdminController`, `ReportController`, `ReportModel` in `backend/src/admin/`. Client: `AdminView` (`/admin`) and a Report dialog on MatchView | Added 2026-11-27 (OPEN-18). Not in the golden document or the stubs |
| Push notifications | **SNS** topic for match and chat events, a **notifier Lambda** that sends Web Push to browsers, signing key in **SSM Parameter Store** | Added 2026-11-26 (OPEN-17). The golden backend structure lists "push notifications" under Felix. Client: service worker in `frontend/public/sw.js` |
| Audio + album art | **Spotify embed player** in the browser | Plays `spotifyUri`; previews for logged-out listeners |

**Consequences for implementation (read before writing a model):**
- **Lambda instances share no memory.** Anything a model "stores" must be in DynamoDB, including the suggestion cache, active song, liked flag, swipe count and last-active time. A cold start may hit any instance.
- **Concurrency (course C-TECH-5) is about requests, not threads in one JVM.** Atomic operations use DynamoDB **conditional writes / transactions**, e.g. match confirmation and appending a chat message. An in-process lock would not protect anything across instances.
- **Testability:** models reach DynamoDB through the `Table` store interface, so tests swap in the in-memory fake `MemoryTable`, which has the same conditional-write semantics, and concurrency tests fire many requests at once (`Promise.all`). The same tests also run against DynamoDB Local.
- **Real-time chat `[RECOMMENDATION]`:** for the MVP, the open ChatView polls `getHistory` every ~3 s, and that poll doubles as the heartbeat that drives the online dot (`recordHeartbeat` / `isUserOnline`, 30 s window). This costs nothing in the Lambda free tier at class scale. API Gateway WebSockets are an upgrade if time allows; they have no free tier on the Free plan, though cost is still pennies.

```
CLIENT                                   SERVER
LoginView ─┐                         ┌─ AccountModel
ProfileView┤── AccountController ────┤
HomeView ──┼── SongController ───────┼─ MusicTasteModel, SongSuggestionModel, MatchModel
MatchView ─┼── MatchController ──────┼─ MatchModel → ChatController
ChatView ──┤── ChatController ───────┴─ ChatModel
MessageLogView┘
BottomBarView → ViewController (client only, routes between views)
```

## Backend structure `[OWNER: Felix]`

Database (credentials/authentication/IAM, chat logs, profile information); calculations (compatibility/matches); notification services (email, push notifications, sockets possibly for chat instances). Chat system planned on AWS.

---

## Account

### AccountModel `[OWNER: Felix]` — server
- Stores email / password **hash + salt** combinations; checks whether login info is valid and whether a new account's email is already in use.
- On account creation, assigns a unique ID attached to the email and password.
- Stores username and profile picture.
- Communicates with **AccountController** only:
  - AccountController sends email and password when Enter is pressed.
  - AccountController asks for login validation, whether an email is in use, or to create a new account from the submitted email and password.
  - AccountController sends the username and profile picture.

### AccountController `[OWNER: Gavin (with Felix)]` — client + server
- Handles all database queries or updates for AccountModel.
- On account creation, sends a confirmation email with a link and waits for confirmation to activate the account.
- `[ADDED]` Checks password/confirm-password match and email format at creation (R-ACC-08).

### LoginView `[OWNER: Gavin]` — client
- Email box, password box, Enter button.
- Synchronously sends interaction info to AccountController when Enter is pressed.
- ~~Account creation popup~~: **replaced by CreateAccountView, a separate page (team decision 2026-11-11, OPEN-3).** LoginView has a "Create an account" link to it.
- `[ADDED]` Errors appear as popups on this page: "Account not verified, please try again" (sketch; R-SEC-03) and "Email or password is incorrect", each with OK.
- Upon successful login, sends ViewController a request for HomeView.

### CreateAccountView `[ADDED — team decision 2026-11-11]` `[OWNER: Gavin, DERIVED]` — client
- Its own page (`/signup`): email (pre-filled from the login page), password, confirm password, terms-of-service text on fake accounts, "Create account" button, "Back to login" link (R-ACC-02, 07, 08, 10).
- Sends the three fields to AccountController.createAccount.
- Errors (invalid email, passwords don't match, email in use) and the "check your email" confirmation are **popups on this page**. After verification, it sends the user to LoginView.

### ProfileView `[OWNER: Gavin]` — client
- Displays username and profile picture.
- Box for username change; button to change profile picture.
- Profile picture popup: on button press, prompts the user to upload an image file and sends it to AccountModel (via AccountController).

## Songs & taste

### MusicTasteModel `[OWNER: Felix]` — server
- Stores each user's **latest 100 songs** with their **Audio Features** (7 numbers per song, from Chosic: valence, danceability, energy, acousticness, instrumentalness, liveness, speechiness, each 0–1).
- Pulls like/skip data from SongController.
- Keeps a **7-long Taste Vector** per user. Each newly listened song's Audio Features, multiplied by a **weight coefficient** (from time listened and like/skip), are added to it. `[ADDED]` Stubs v2 use a bounded form of this update so the vector cannot grow without limit (OPEN-15).

### SongSuggestionModel `[OWNER: Felix]` — server
- Sends SongController new songs near the user's music taste.
- **Caches the next 5 suggestions** when the app opens.
- `[ADDED]` Holds the song library, loaded from the Chosic CSV export (R-HOME-01; course C-TECH-2). Each song has title, artist, duration, album cover URL, Spotify URI and the 7 features (OPEN-6).

### SongController `[OWNER: Gavin & Yara (with Felix)]` — client + server
- Pulls the Taste Vector from MusicTasteModel.
- Sends the Taste Vector to SongSuggestionModel or MatchModel.
- Sends skip/like and time listened to MusicTasteModel.
- `[ADDED]` Returns any swipe-triggered match to HomeView (`SwipeResult`).
- `[ADDED]` Marks the active song liked when the like button is pressed; the like counts once, when the user leaves the song.

### HomeView `[OWNER: Gavin]` — client
- Displays the active song from SongController. ~~and its tags~~ (tags dropped by team decision, OPEN-1)
- Song time slider; pause button. **Team decision (OPEN-2):** swipe left or left arrow button → next song; swipe right or right arrow button → like + next song; like button → like and keep playing.
- On leaving a song, asks SongController for the next song and sends skip/like and time listened.

## Matching

### MatchModel `[OWNER: Gavin (with Felix)]` — server
- Stores users in **leaderboards according to Taste Vector metrics**.
- Communicates with MatchController and MusicTasteModel.
- "Queries the Taste Vectors from …" / "At random 'swipe' intervals, …": golden text truncated (OPEN-14). `[ADDED]` Offers a match after a randomly chosen number of swipes; picks the highest-compatibility user active in the last 72 h who hasn't already been proposed (R-HOME-19, 22); computes the 0–100% compatibility (R-HOME-18).
- `[ADDED]` Atomic across concurrent requests (DynamoDB conditional writes): concurrent confirmations of one match create exactly one chat.

### MatchController `[ADDED]` — client + server
- Named by the golden document but not described (OPEN-14). Owner not assigned in the plan. `[DERIVED]` Gavin, as MatchModel/MatchView owner.
- Serves pending matches (so both users see a match), records confirm/decline, and opens a chat through ChatController when both confirm.

### MatchView `[OWNER: Gavin]` — client
- Displays both matched users' profile pictures and usernames. `[ADDED]` Also "You matched with *username*!" and the "XX.X% match!" percentage (sketch).
- Confirm button and decline button.
- Confirm → ChatView; decline → HomeView. (OPEN-4)

## Chat

### ChatModel `[OWNER: Felix]` — server
- Stores a list of all chats, each with its time-stamped, message-by-message history.
- `[ADDED]` Flags reported chats (R-CHAT-16); atomic appends for concurrent senders.

### ChatController `[OWNER: Yara (with Felix)]` — client + server
- Sends message data from ChatView to ChatModel.
- Pulls history from ChatModel for ChatView and MessageLogView.
- `[ADDED]` Report handling, chat-log ordering, online status via heartbeats (R-CHAT-02, 06, 15, 16).

### ChatView `[OWNER: Yara]` — client
- Text box; send button; close-chat button (sends a request to ViewController).
- Shows both users' messages with profile pictures: the match's on the left, yours on the right. `[ADDED]` Yours in blue bubbles, the match's in grey (OPEN-8).
- `[ADDED]` Header: back button, username, online dot, report button (R-CHAT-03–06, 14).

### MessageLogView `[OWNER: Yara]` — client
- Profile photos and usernames of all prior matches, as buttons that send requests to ViewController.
- Button to remove a chat from the log.

## Navigation

### BottomBarView `[OWNER: Yara]` — client
- Contained in every view. Buttons for HomeView, MessageLogView, ProfileView; sends the requested view to ViewController. `[ADDED]` Hidden on LoginView and CreateAccountView (OPEN-10).

### ViewController `[OWNER: Yara (with Felix)]` — client
- Takes view requests from BottomBarView, ChatView, MessageLogView, MatchView, LoginView and CreateAccountView and opens the corresponding view. `[ADDED]` In React this is the router: one URL route per view (`/login`, `/signup`, `/home`, …), so back/forward and refresh work.
