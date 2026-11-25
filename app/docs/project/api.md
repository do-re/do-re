# API contract

> **Status (2026-11-24): implemented by the backend on branch `felix-backend`, not yet deployed.** Drafted 2026-11-23 by Yara (with Claude) from `architecture-stubs-v2.java` and `architecture.md`; the frontend is built against every route below (`frontend/src/api/httpApi.ts`, `chatHttp.ts`). The backend (`backend/src/http/api.ts`) serves every route, and `backend/test/contract.test.ts` runs the frontend's HTTP client against it in-process. Nothing has run on AWS yet. The questions **Q-1 to Q-14** are answered in [Backend answers](#backend-answers-2026-11-24) at the end; each answer is what the code does today and is Felix's to confirm or change. If a route changes, update this file, the client function and the backend route together.

Owners: account and match routes Gavin, chat routes Yara, song routes Gavin + Yara. Backend integration: Felix.

## Conventions

- **Base URL:** one URL for the whole API (Function URL or API Gateway stage), read by the client from `VITE_API_BASE_URL`. All routes below are relative to it. **Q-10:** if each controller gets its own Function URL, put them behind one API Gateway or CloudFront path, or tell the frontend.
- **Transport:** HTTPS, JSON bodies (`Content-Type: application/json`), UTF-8. The one exception is the picture upload, which sends the raw image.
- **Auth:** every route needs `Authorization: Bearer <sessionToken>`, the token returned by login, except the four **public** account routes marked below. The server derives the caller's `userId` from the token; **the client never sends its own userId** on an authenticated route. **Q-1:** token format and how each Lambda validates it (shared secret / JWT / DynamoDB session table).
- **Times:** ISO-8601 UTC strings with milliseconds, e.g. `"2026-11-23T22:41:07.512Z"`. The **server** sets every message timestamp (`ChatController.sendMessage`: "time-stamped with the current time"); client clocks are never trusted.
- **IDs:** opaque strings.
- **Heartbeat:** every authenticated chat request records a heartbeat for the caller (`recordHeartbeat(userId, now)`). A user counts as online if their last heartbeat is ≤ 30 s old (`ONLINE_WINDOW`).

## Shared JSON shapes

```jsonc
// UserSummary — the other participant, as shown in MessageLogView / ChatView header
{ "userId": "u_123", "username": "sam", "profilePictureUrl": "https://…/u_123.jpg" }

// Message — one ChatMessage
{ "messageId": "m_456", "senderId": "u_123", "text": "hi!", "timestamp": "2026-11-23T22:41:07.512Z" }
```

- **Q-2:** `profilePictureUrl` — the stub's `UserProfile` holds raw `byte[]`. Proposal: store pictures in S3 and return a URL (or a presigned URL); sending base64 on every 3 s poll is wasteful. `null` if the user has no picture (the client shows a placeholder).
- **Q-3:** `messageId` is **not** in the `ChatMessage` record. Proposal: add it (e.g. the DynamoDB sort key) so polling clients can de-duplicate and an optimistic "sending…" bubble can be matched to the stored one. This is a public spec change to a shared record → Felix decides.

## Routes

### 1. `GET /chats` — the caller's message log
`ChatController.getChatLog(userId)` · Satisfies R-CHAT-02 (and feeds R-CHAT-01).

Response `200`:
```jsonc
{
  "chats": [
    {
      "chatId": "c_789",
      "otherUser": { /* UserSummary */ },
      "lastMessage": { /* Message */ } ,   // null if the chat has no messages yet
      "lastActivityAt": "2026-11-23T22:41:07.512Z"  // last message time, else creation time
    }
  ]
}
```
- Ordered by `lastActivityAt`, most recent first (server does the ordering; client does not re-sort).
- Excludes chats the caller removed or reported (`ChatModel.getChatsForUser`).
- Empty log → `{ "chats": [] }`, not 404.

### 2. `GET /chats/{chatId}/messages` — history + presence (the 3 s poll)
`ChatController.getHistory(chatId)` + `isUserOnline(other, now)` + `recordHeartbeat(caller, now)` · Satisfies R-CHAT-01, R-CHAT-06.

Query (optional): `since=<timestamp>` → only messages with `timestamp > since`. Omit on first load to get the full history.

Response `200`:
```jsonc
{
  "chatId": "c_789",
  "otherUser": { /* UserSummary */ },
  "otherUserOnline": true,
  "messages": [ /* Message, oldest first */ ],
  "serverTime": "2026-11-23T22:41:10.001Z"   // the next poll's `since` is this minus 5 s
}
```
- **Polling:** while ChatView is open, the client calls this every **3 s** with `since = previous serverTime − 5 s`, and stops on unmount. Because each poll is also the heartbeat, an open chat keeps the caller "online".
- **Why the 5 s overlap:** a message can be stamped just before a poll's `serverTime` but saved just after that poll reads. Asking only for newer messages would miss it permanently. The client drops the repeats by `messageId` (Q-3).
- **Q-4:** `since` is an addition to the stub (which returns full history). It keeps polls cheap in DynamoDB read units. OK to add `getHistorySince(chatId, Instant)` to ChatModel, or should the Lambda filter the full history?

### 3. `POST /chats/{chatId}/messages` — send
`ChatController.sendMessage(chatId, callerId, text)` · Satisfies R-CHAT-12, R-CHAT-13.

Request: `{ "text": "hi!" }`
Response `201`: the stored `Message` (with the server's timestamp).
- `text` is trimmed; empty after trimming → `400 EMPTY_MESSAGE` (the UI already blocks this; the server is the authority).
- **Q-5:** max length. Proposal: 2000 characters → `400 MESSAGE_TOO_LONG`.
- Concurrency: two participants may send at once (different Lambda instances). ChatModel's conditional write guarantees no lost message and non-decreasing timestamps (stub class comment). If the write loses a race, the server retries with a fresh timestamp; the client never sees that.

### 4. `DELETE /chats/{chatId}` — remove from my log
`ChatController.removeChatFromLog(callerId, chatId)` · MessageLogView remove button.

Response `204`, no body. Only hides the chat for the caller; the other user still has it. Idempotent (removing twice → `204`).

### 5. `POST /chats/{chatId}/report` — report
`ChatController.reportChat(callerId, chatId)` · Satisfies R-CHAT-15, R-CHAT-16.

Request: `{}` (**Q-6:** add an optional `"reason"` string? Not required by any requirement; proposal: leave out for the MVP.)
Response `204`. Effects: `ChatModel.flagChat(chatId, callerId)` and the chat is removed from the caller's log. Idempotent.

### 6. `POST /presence/heartbeat` — heartbeat when no chat is open
`ChatController.recordHeartbeat(callerId, now)` · Supports R-CHAT-06.

Request: `{}` · Response `204`.
- **Q-7:** the stub says the client heartbeats "every few seconds while the app is open". If only the chat poll heartbeats, a user on HomeView shows as offline to their match. Proposal: the app shell (ViewController) calls this every **15 s** on every logged-in page except an open chat (where route 2 already does it). Alternative: drop this route and accept "online = has a chat open".

### Not a public route: `openChat`
`ChatController.openChat(userA, userB)` is called **server-side** by MatchController when both users confirm (R-HOME-23). It is not exposed to the browser. Exactly one chat per match, even if both confirm at the same instant (course concurrency requirement):
- MatchModel.recordDecision already lets at most one caller "complete" the match.
- **Q-8 (belt and braces):** `ChatModel.createChat(userA, userB)` has no match ID. Proposal: derive `chatId` deterministically from the `matchId` and create it with a conditional put (`attribute_not_exists(chatId)`), so a retry can never make a second chat. Needs a signature change (`createChat(matchId, userA, userB)`) on Felix's ChatModel.

## Account routes

| Route | Auth | Request | Response `200` (or `204`) | Stub / requirements |
|---|---|---|---|---|
| `POST /auth/login` | public | `{ "email", "password" }` | `{ "result": "SUCCESS", "userId", "token" }`, or `{ "result": "WRONG_PASSWORD" \| "NO_ACCOUNT" \| "NOT_VERIFIED" }` | `login` · R-ACC-01, 03, 04, 05, R-SEC-03 |
| `POST /accounts` | public | `{ "email", "password", "confirmPassword" }` | `{ "result": "PENDING_VERIFICATION" \| "EMAIL_IN_USE" \| "INVALID_EMAIL" \| "PASSWORDS_DO_NOT_MATCH" }` | `createAccount` · R-ACC-02, 08, 09, R-SEC-01 |
| `POST /accounts/confirm` | public | `{ "userId", "token" }` | `{ "confirmed": true \| false }` | `confirmEmail` · R-SEC-02 |
| `POST /accounts/verification-status` | public | `{ "email" }` | `{ "verified": true \| false }` | `isVerified` · R-SEC-02, 03 |
| `GET /users/{userId}` | token | | `UserProfile` | `getProfile` |
| `PATCH /users/me` | token | `{ "username" }` | `204` | `updateUsername` |
| `PUT /users/me/picture` | token | raw image, `Content-Type: image/*` | `204` | `updateProfilePicture` |

- A wrong password and an unknown email are separate results, as in the stub, but the login page shows the same message for both.
- A new account's username is **empty** (R-ACC-09). The client shows "New user" until it is set, and must never fall back to the email.
- **Verification email:** the link must be `<frontend origin>/verify?userId=<id>&token=<single-use token>`. That page calls `POST /accounts/confirm` once.
- `verification-status` takes the email in the **body** so it never lands in access logs. **Q-12:** it reveals whether an email has an account (notes F-5).
- **Q-11:** picture upload format and limit. The client sends the raw file through the API and blocks files over 5 MB (notes F-3). A pre-signed S3 upload would change only `updateProfilePicture` in `httpApi.ts`.

## Song routes

| Route | Request | Response | Stub / requirements |
|---|---|---|---|
| `GET /songs/current` | | `Song` | `getCurrentSong` · R-HOME-03 |
| `POST /songs/{songId}/like` | `{}` | `204` | `markLiked` · R-HOME-25 |
| `POST /songs/{songId}/feedback` | `{ "swipe": "LIKE" \| "SKIP", "secondsListened": 12.5 }` | `{ "nextSong": Song, "offeredMatch": Match \| null }` | `submitFeedback` · R-HOME-15, 16, 17, 19 |
| `GET /songs/undo` | | `{ "canUndo": true \| false }` | WEB addition: enables the undo button |
| `POST /songs/undo` | `{}` | `{ "song": Song \| null, "liked": true \| false, "canUndo": true \| false }` | WEB addition: the undo button |
| `GET /songs/taste` | | `{ "taste": [7 numbers in 0 to 1] }` | `getTasteVector`, for developer mode |

```jsonc
// Song
{ "id": "s1", "title": "…", "artist": "…", "durationSeconds": 214, "albumCoverUrl": "https://…",
  "spotifyUri": "spotify:track:…", "features": [0.8, 0.7, 0.9, 0.1, 0.0, 0.2, 0.05] } // 7 values in [0, 1]
```

- `features` order: valence, danceability, energy, acousticness, instrumentalness, liveness, speechiness. The client colours the page from them.
- If `songId` isn't the caller's active song, return `409 SONG_NOT_ACTIVE`.
- **Undo** reverses the caller's latest swipe, up to 10 in a row: the song becomes active again with its like button as it was, the listen leaves the history and Taste Vector, the swipe count drops by one, and the song being left returns to the front of the suggestions. A match that swipe already offered stays. With nothing to undo, return `{ "song": null, "liked": false, "canUndo": false }`. **Q-14:** this needs the server to keep the last 10 swipes per user, including each previous Taste Vector.
- **Q-13:** nothing in the browser calls `onAppOpened`. Proposal: `GET /songs/current` preloads the cache if it is empty (notes F-7).

## Match routes

| Route | Request | Response | Stub / requirements |
|---|---|---|---|
| `GET /matches/pending` | | `{ "matches": [Match] }` | `getPendingMatches` · R-HOME-20 |
| `GET /matches/{matchId}` | | `Match`, or `404 MATCH_NOT_FOUND` | WEB addition (notes F-4) |
| `GET /matches/{matchId}/other-user` | | `UserProfile` | `getOtherProfile` |
| `POST /matches/{matchId}/confirm` | `{}` | `{ "chatId": "c_789" \| null }` | `confirmMatch` · R-HOME-21, 23, OPEN-4 |
| `POST /matches/{matchId}/decline` | `{}` | `204` | `declineMatch` · R-HOME-21, 22 |

```jsonc
// Match
{ "matchId": "m_1", "userA": "u_1", "userB": "u_2", "compatibilityPercent": 87.4 }
```

- `GET /matches/{matchId}` returns the match only while it is **waiting for the caller's answer**. Otherwise it returns `404`, so an old link can't re-answer a match.
- `confirm` returns the chat ID once both users have confirmed, and `null` while waiting for the other user. A repeated confirm returns the same result.
- A decline is final for both users, and the pair is never proposed again (R-HOME-22).

## Errors

Every non-2xx response has this body:
```json
{ "error": { "code": "CHAT_NOT_FOUND", "message": "This chat doesn't exist or was removed." } }
```
`message` is user-presentable (CLAUDE.md: "error text says what to fix"); the client switches on `code`.

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON, missing field, bad `since` timestamp |
| 400 | `EMPTY_MESSAGE` | `text` empty after trimming |
| 400 | `MESSAGE_TOO_LONG` | `text` over the limit (Q-5) |
| 401 | `UNAUTHENTICATED` | Missing / invalid / expired token → client logs out and goes to `/login` |
| 403 | `NOT_PARTICIPANT` | Caller is not one of the chat's or match's two users |
| 404 | `CHAT_NOT_FOUND` | No chat with this ID |
| 404 | `MATCH_NOT_FOUND` | No match with this ID, or it is no longer waiting for the caller |
| 409 | `SONG_NOT_ACTIVE` | The song in the URL isn't the caller's active song |
| 413 | `PICTURE_TOO_LARGE` | Uploaded image is over the limit (Q-11) |
| 429 | `RATE_LIMITED` | Optional; only if we add throttling |
| 500 | `INTERNAL` | Anything else; client shows "Something went wrong, try again" and keeps polling |

- **Q-9:** after a user removes or reports a chat, should routes 2 and 3 return `404` for *that user*? Proposal: yes for report (they should not keep chatting in a reported chat); for remove, also `404` — the chat is gone from their side. The other user is unaffected.
- **CORS:** the Lambda must allow the CloudFront origin (and `http://localhost:5173` for local dev) with `Authorization` and `Content-Type` headers, methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

## Mapping to the stub (chat routes)

| Route | Stub method(s) | Requirements |
|---|---|---|
| `GET /chats` | `getChatLog` | R-CHAT-02, R-CHAT-01 |
| `GET /chats/{id}/messages` | `getHistory`, `isUserOnline`, `recordHeartbeat` | R-CHAT-01, R-CHAT-03, R-CHAT-06 |
| `POST /chats/{id}/messages` | `sendMessage` | R-CHAT-12, R-CHAT-13 |
| `DELETE /chats/{id}` | `removeChatFromLog` | (MessageLogView remove button) |
| `POST /chats/{id}/report` | `reportChat` | R-CHAT-15, R-CHAT-16 |
| `POST /presence/heartbeat` | `recordHeartbeat` | R-CHAT-06 |
| *(internal)* | `openChat` | R-HOME-23 |

## Open questions for Felix (summary)

Q-1 auth token · Q-2 picture URLs · Q-3 `messageId` · Q-4 `since` filter · Q-5 max length · Q-6 report reason · Q-7 app-wide heartbeat · Q-8 match-keyed `createChat` · Q-9 404 after remove/report · Q-10 one base URL · Q-11 picture upload · Q-12 verification-status privacy · Q-13 who calls `onAppOpened` · Q-14 storing undo history.

## Backend answers (2026-11-24)

What the backend on `felix-backend` does for each open question. Written by Claude for Felix; he has not reviewed them individually.

| Q | Answer |
|---|---|
| Q-1 token | An opaque random token (256 bits), returned by login and valid for 7 days. The server stores only its SHA-256 hash in DynamoDB (`SessionModel`), so every Lambda validates it with one read and there is no shared secret. Extra route: `POST /auth/logout` (token, no body, `204`) ends the session on the server; the frontend does not call it yet. |
| Q-2 picture URLs | As proposed. Pictures are stored in S3 and served by CloudFront; `profilePictureUrl` is `<app origin>/pictures/<unguessable name>`, or `null`. A new upload gets a new URL. |
| Q-3 `messageId` | Added. It is the message's position in its chat as a string (`"1"`, `"2"`, …), unique within a chat. |
| Q-4 `since` | Added in ChatModel (`getChat(chatId, { since })`), so a poll reads only newer messages. `since` is exclusive; a value that is not a timestamp → `400 BAD_REQUEST`. |
| Q-5 max length | 2000 characters after trimming → `400 MESSAGE_TOO_LONG`. |
| Q-6 report reason | Left out. Any body is ignored. |
| Q-7 heartbeat | `POST /presence/heartbeat` exists, and every authenticated `/chats…` route also counts as one. Heartbeats less than 10 s after the stored one are not written (saves DynamoDB writes; the online window is still 30 s). No page calls the app-wide heartbeat yet, so today a user is online only while on a chat screen. |
| Q-8 one chat per match | `createChat(userA, userB)` keeps its signature. The chat ID is derived from the two user IDs and created with a conditional write, so a pair can only ever have one chat and a retry returns the same ID. |
| Q-9 after remove/report | As proposed: for the user who removed or reported it, routes 2 and 3 return `404 CHAT_NOT_FOUND`. Remove and report themselves stay idempotent (`204`). The other user is unaffected. |
| Q-10 base URL | One base URL: `<app origin>/api` (CloudFront forwards `/api/*` to the API), so the deployed app is same-origin and needs no CORS. For local development the API's own URL allows `http://localhost:5173`. Both are stack outputs (`ApiBaseUrl`, `DevApiBaseUrl`). |
| Q-11 picture upload | Raw body as drafted. Limit **4 MB** (Lambda's request limit is 6 MB after base64) → `413 PICTURE_TOO_LARGE`. Accepted types: PNG, JPEG, GIF, WebP, detected from the file's contents, not the `Content-Type` header; anything else → `400 BAD_REQUEST`. **The client's 5 MB check (`MAX_PICTURE_BYTES` in `profileLogic.ts`) should become 4 MB.** |
| Q-12 verification-status | Implemented as drafted. An unknown email answers `{ "verified": false }` rather than an error. It still reveals verified accounts (OPEN-16). |
| Q-13 `onAppOpened` | Not needed by the browser: `GET /songs/current` fills the cache when it is empty. |
| Q-14 undo | Implemented: the server keeps each user's last 10 swipes with the Taste Vector before each. `GET /songs/taste` is served to the logged-in user for their own vector only. |

Other things the client should know:

- **Extra error codes.** `404 USER_NOT_FOUND` (`GET /users/{userId}`), `404 NOT_FOUND` (no such route), `502 EMAIL_SEND_FAILED` (the account was created but the email could not be sent; logging in re-sends it), `503 BUSY` (too much contention; retry). The client currently shows these as `INTERNAL` with the server's message, which is acceptable.
- **`GET /users/me`** returns the caller's own profile.
- **Login by an unverified user re-sends the confirmation email**, at most once a minute. Confirmation links expire after 24 hours.
- **Tuning taken from the demo** (frontend-handoff.md "Decisions to confirm"): skip weight `-0.05 × (1 - fraction)`, first songs spread across the library, then the cached song nearest the taste, a match offer every 5 to 9 swipes, compatibility `100 × (1 - distance / √7)`, `getMatch` only while awaiting the caller.
- **CloudFront serves `/index.html` for app routes** through a CloudFront Function instead of custom error responses, because error responses would also replace the API's own 403 and 404 bodies.

