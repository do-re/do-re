# Notes for Felix (from Gavin)

Things Felix needs to know, decide or provide, coming out of Gavin's frontend work (backend structure, AccountModel, MusicTasteModel, SongSuggestionModel, ChatModel, auth).

**How to use:** add new items at the bottom of **Open** with the date. When an item is settled, move it to **Resolved** with the answer and date. Keep the ID; don't renumber.

Status: `TO TELL` (an FYI, not raised yet) · `ASK` (needs his answer, not raised yet) · `WAITING` (raised, no answer yet) · `AGREED` / `CHANGED` (moved to Resolved).

---

## Open

### F-1 · `login` returns the user ID with SUCCESS — `TO TELL` (2026-11-17)
- **Stub:** `LoginResult login(email, password)`, then a second call to `getUserId(email)`.
- **Frontend now:** one call returns `{ result: 'SUCCESS', userId }`, or `{ result: 'WRONG_PASSWORD' | 'NO_ACCOUNT' | 'NOT_VERIFIED' }`. This saves an HTTP round trip.
- **Question:** what does a successful login hand the browser for later calls (session token, cookie, Cognito)? The frontend will add that to the SUCCESS response.
- **Code:** `frontend/src/api/types.ts` (`LoginResponse`), `frontend/src/api/client.ts` (`AccountApi.login`).

### F-2 · Profile pictures are URLs, not `byte[]` — `TO TELL` (2026-11-17)
- **Stub:** `UserProfile(userId, username, byte[] profilePicture)`.
- **Frontend now:** `profilePictureUrl: string | null`, since browsers display images by URL.
- **Suggestion:** store uploads in S3 (free tier) and return a URL, which could be pre-signed.
- **Code:** `UserProfile` in `frontend/src/api/types.ts`.

### F-3 · `updateProfilePicture` takes the uploaded file — `TO TELL` (2026-11-17)
- **Stub:** `updateProfilePicture(userId, byte[] image)`.
- **Frontend now:** takes a `Blob` (the uploaded `File`). The client checks that it's a non-empty `image/*` file.
- **Question:** what upload format (multipart, raw body, or a pre-signed S3 PUT) and what maximum size? Lambda request bodies are limited to about 6 MB.
- **For now (2026-11-17):** ProfileView refuses images over 5 MB (`MAX_PICTURE_BYTES` in `frontend/src/views/profileLogic.ts`) and says so in the popup. Change that number to match whatever the server allows.

### F-4 · New method `getMatch(matchId, userId)` — `TO TELL` (2026-11-17)
- **Why:** MatchView has its own URL (`/match/:matchId`). After a refresh it must reload the match from that ID.
- **Spec:** returns the match if `userId` is one of its users, otherwise null.
- **Server side:** needs a server half in MatchController/MatchModel. Gavin owns MatchModel; this note is so it fits the DB layout.

### F-5 · `isVerified(email)` is called from the browser — `ASK` (2026-11-17)
- **Why:** CreateAccountView polls it while the "check your email" popup is open (`awaitEmailVerification`).
- **Concern:** an endpoint that takes any email reveals whether an account exists (email enumeration).
- **Option:** createAccount returns a short-lived pending-signup ID, and the browser polls with that ID instead of the email.
- **Load:** the popup polls every 3 s (`VERIFY_POLL_MS` in `frontend/src/views/authLogic.ts`) for as long as it stays open: about 20 requests a minute per person signing up. Polling stops when the popup closes.

### F-6 · HTTP API contract — `ASK` (2026-11-17)
Needed before the Nov 22 integration:
- base URL(s): one Function URL per controller area, or API Gateway;
- endpoint paths and methods;
- error response format;
- CORS allowing the CloudFront domain and `localhost:5173` for development.

The frontend's method list is in `frontend/src/api/client.ts`. One HTTP endpoint per method would map directly.

### F-7 · Server-only methods the browser doesn't call — `TO TELL` (2026-11-17)
- These are not exposed to the client: `sendConfirmationEmail`, `getTasteVector`, `SongController.onAppOpened`.
- **Question:** who triggers `onAppOpened` (cache preload)? Options: the server runs it on login, or the frontend calls it when HomeView opens.

### F-8 · Real songs for the mock — `ASK` (2026-11-17)
- The mock's Spotify track IDs are placeholders, so the embed player can't play them.
- **Request:** a few rows from the Chosic CSV export (title, artist, duration, cover URL, Spotify URI, the 7 features). They go into `frontend/src/api/mockSeed.ts`.

### F-9 · Email check must match the server — `TO TELL` (2026-11-17)
- The client uses the regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` on the trimmed email (`frontend/src/api/validation.ts`).
- AccountController.createAccount should accept and reject the same emails, so users never see two different answers.
- The client also follows the stub's check order: INVALID_EMAIL, then PASSWORDS_DO_NOT_MATCH, then EMAIL_IN_USE.

### F-10 · Password rules: only "non-empty" today — `ASK` (2026-11-17)
- **Stub:** `createAccount` only requires a non-empty password, so a 1-character password is accepted. The sign-up page matches that exactly (`validateSignup`).
- **Suggestion:** require at least 8 characters on the server, a common minimum (NIST SP 800-63B), and have the server return a reason for the rejection. That changes the `createAccount` spec and the `CreateAccountResult` enum (e.g. `PASSWORD_TOO_SHORT`). Gavin will update the client check to match whatever is decided.
- **Requirement impact:** none; no requirement fixes the password rules.

### F-11 · Time listened is measured on the preview, not the full song — `ASK` (2026-11-17)
- **How HomeView measures it:** `secondsListened` counts only time actually played, so pauses and seeks are excluded (`nextListened` in `frontend/src/views/homeLogic.ts`). It is capped at `song.durationSeconds`, as the stub requires.
- **Catch:** listeners not logged in to Spotify hear a ~30 s preview (OPEN-6). A user who hears the whole preview of a 4-minute song sends `secondsListened = 30`, which looks like 12% of the song.
- **Question for MusicTasteModel's weight coefficient:** should listen time be compared with the song's full length, or with the length actually available? If the latter, the client could also send the preview's length (the player reports it) as a new parameter to `submitFeedback`.

### F-12 · Suggestions and weights in the demo — `ASK` (2026-11-23, from Yara)
- **Cold start:** a new user's taste is the centre of feature space, so "near taste" means nothing. The demo spreads their first 5 songs across the library, then plays the cached song nearest their taste (`frontend/src/api/mockSuggestions.ts`).
- **Weights:** a like is `0.2 × (0.5 + 0.5 × fraction)`, a skip is `-0.05 × (1 - fraction)` (`mockTaste.ts`). Both meet the `computeWeight` spec.
- **Question:** keep these in MusicTasteModel and SongSuggestionModel, or do you want something else?

### F-13 · Frontend is ready to connect — `TO TELL` (2026-11-23, from Yara)
- All routes are in `docs/project/api.md`, and the steps are in `docs/project/frontend-handoff.md`.
- Setting `VITE_API_BASE_URL` switches the app from the demo to your API.
- CloudFront must return `/index.html` for 403 and 404, or refreshing any page breaks.

### F-14 · Three new song routes — `ASK` (2026-11-23, from Yara)
- **Undo:** `GET /songs/undo` and `POST /songs/undo` go back to the previous song and reverse that swipe's effect. The server has to keep each user's last 10 swipes, including the Taste Vector before each one (api.md Q-14).
- **Developer mode:** `GET /songs/taste` returns the user's own Taste Vector, for a switch on the Profile page.
- **Question:** are you OK adding these? Both are public spec additions to SongController.

---

## Resolved

_(none yet)_

## Backend status (2026-11-24, branch `felix-backend`)

What the backend does today for each open item above. Written by Claude while building the backend for Felix; **Felix has not confirmed these one by one**, so the items stay in Open until he does. Full API answers are in `docs/project/api.md` → "Backend answers".

| Item | Backend today |
|---|---|
| F-1 | Login returns `{ result: 'SUCCESS', userId, token }`. The token is an opaque session token, sent as `Authorization: Bearer`, valid 7 days (api.md Q-1). |
| F-2 | `profilePictureUrl` as proposed: pictures in S3, served by CloudFront. |
| F-3 | Raw body upload. Limit 4 MB, types PNG/JPEG/GIF/WebP checked from the file contents. `MAX_PICTURE_BYTES` in `profileLogic.ts` was changed to 4 MB to match (2026-11-25). |
| F-4 | `getMatch` implemented (`MatchController.getMatch`, `MatchModel.getPendingMatch`): returns the match only while it awaits the caller. Gavin owns MatchModel; Claude implemented it and MatchController on this branch. |
| F-5 | `verification-status` implemented as the frontend calls it. The enumeration concern is recorded as OPEN-16, not solved. |
| F-6 | Answered in api.md: one base URL (`<app origin>/api`), error format as drafted, CORS for `localhost:5173` on the API's direct URL. |
| F-7 | Nobody needs to trigger `onAppOpened`: `GET /songs/current` fills the cache when empty. |
| F-8 | **Resolved differently (2026-11-26):** `backend/data/songs.csv` now holds 150 real tracks pulled from ReccoBeats and Spotify, and the backend pulls more while users swipe (OPEN-6). The mock's `mockSeed.ts` still has placeholder tracks. Earlier note: the Chosic CSV export (a manual step on chosic.com). `npm run library -- <export>` in `backend/` then builds `backend/data/songs.csv`, checking each track and fetching covers from Spotify. The backend cannot be deployed without it, and the mock still has placeholder tracks. Real Spotify playback through the app was checked on 2026-11-25 with real track IDs. |
| F-9 | Same regex and the same check order on the server. |
| F-10 | **Changed by the security audit (2026-11-27):** new passwords need at least 8 characters, checked by the server and by the sign-up form (`MIN_PASSWORD_LENGTH`). The server answers `400 BAD_REQUEST` with a message rather than a new `CreateAccountResult`. |
| F-11 | Listen time is compared with the song's full length, so a full 30 s preview of a 4-minute song counts as 12%. **Felix to decide** whether the client should send the preview length. |
| F-12 | Adopted the demo's rules: spread first 5 songs, then nearest in cache, skip weight `-0.05 × (1 - fraction)`. |
| F-13 | Connected locally: `npm run dev` in `backend/` serves the real backend code, and `frontend/.env.local` points the app at it (checked in a browser 2026-11-25). `backend/test/contract.test.ts` also runs `httpApi.ts` against the backend in-process. Not deployed yet. CloudFront serves `index.html` for app routes through a CloudFront Function rather than error responses. |
| F-14 | Both added: undo (last 10 swipes) and `GET /songs/taste`. |
