# Do~Re backend

TypeScript on AWS Lambda (Node.js 22) with DynamoDB and SES: all models and the server half of every controller from `docs/project/architecture.md`. The behaviour spec is `architecture-stubs-v2.java`; the HTTP contract shared with the React client is `../docs/project/api.md`, served under `/api`.

## Layout

| Path | What |
|---|---|
| `src/model/` | Shared data types: `AudioFeatures`, `TasteVector`, `Song`, `Match`, `Chat`, … |
| `src/account/`, `src/song/`, `src/match/`, `src/chat/` | One folder per controller area: its models and the server half of its controller |
| `src/store/` | `Table` (the store interface), `DynamoTable` (AWS), `MemoryTable` (test fake) |
| `src/http/` | Routes (`api.ts`) and the API Gateway adapter |
| `src/services.ts` | Wires the components together; `src/lambda.ts` is the Lambda entry point |
| `dev/server.ts` | Local development server (see below) |
| `scripts/buildLibrary.ts` | `npm run library`: builds `data/songs.csv` from a Chosic export |
| `template.yaml` | AWS SAM template: table, four API functions and the notifier function, HTTP API, SNS topic, S3 + CloudFront (app and profile pictures), budget alert |
| `test/` | Tests, named after the requirement they verify. `contract.test.ts` drives the backend with the frontend's real HTTP client |

## Install and test

Needs Node.js 22 or later, and Docker for the DynamoDB Local tests.

```
npm install
npm test            # type check + all tests + coverage gate (branch 85%, lines 90%, functions 100%)
npm run test:unit   # the same tests without Docker and without coverage
```

`npm test` starts `amazon/dynamodb-local` in Docker by itself and writes an HTML coverage report to `coverage/`.

## Run locally with the frontend

```
npm run dev          # in backend/: the real backend code on http://localhost:8787/api
npm run dev          # in frontend/, with VITE_API_BASE_URL=http://localhost:8787/api in .env.local
```

`dev/server.ts` runs the same `createApi` as the Lambdas, with three stand-ins: data is kept in memory (lost when the server stops), confirmation emails are printed in the terminal as a link to open, and pictures are served from memory. It seeds two verified accounts with no listening history, `demo1@do-re.test` and `demo2@do-re.test`, and six sample users with different tastes (`dev/sampleUsers.ts`), all with password `demo-pass-1`:

| Email | Taste |
|---|---|
| `melody@do-re.test` | acoustic folk |
| `harmony@do-re.test` | pop |
| `rhythm@do-re.test` | hip-hop |
| `tempo@do-re.test` | rock |
| `lyric@do-re.test` | ambient |
| `echo@do-re.test` | pop, but last active 80 hours ago, so never matched (R-HOME-19) |

Each sample user's Taste Vector comes from simulated listening through the real MusicTasteModel on the loaded library, and the server prints the vectors and the compatibility of every pair when it starts. To try matching: log in as `demo1`, swipe (a match is offered every 5 to 9 swipes), and you are offered the active user closest to your taste. The sample users do not answer by themselves; log in as the offered user in a second browser window to confirm or decline. Without `data/songs.csv` it loads the six placeholder songs, which have no cover art and do not play. It allows browser requests from `http://localhost:5173` only (set `APP_ORIGIN` if Vite uses another port). It is for development only and is not part of the Lambda bundle.

## Deploy

Needs the AWS CLI and the AWS SAM CLI, with credentials for the team's AWS account.

1. `data/songs.csv` is committed; rebuild it only if you want other songs (see below).
2. Verify a sender address in SES in the deploy region (`us-west-2` in `samconfig.toml`). Until the account has SES production access, emails reach only verified addresses (OPEN-7).
3. First deploy: `sam build && sam deploy --parameter-overrides EmailFrom=<sender address> AdminEmails=<your email>`
4. Copy the `AppUrl` output and deploy again with it, so confirmation links and picture URLs point at the app:
   `sam build && sam deploy --parameter-overrides EmailFrom=<sender address> AppBaseUrl=<AppUrl> AlertEmail=<your address>`
5. Build the frontend with `VITE_API_BASE_URL` set to the `ApiBaseUrl` output (`<AppUrl>/api`), then upload it: `aws s3 sync ../frontend/dist s3://<WebBucketName output>` and invalidate the CloudFront cache (`DistributionId` output).

The deployed app calls the API on its own origin, so it needs no CORS. To run the frontend on `localhost:5173` against the deployed backend, set `VITE_API_BASE_URL` to the `DevApiBaseUrl` output; that URL allows the `DevOrigin` parameter's origin. CloudFront serves `index.html` for app routes such as `/chats` and `/verify` through a CloudFront Function, so no custom error responses are needed.

### Where the music comes from

Two public services, neither needing an account or key (`src/song/MusicSource.ts`):

- **ReccoBeats** (reccobeats.com): recommendations, track details and the 7 audio features of Spotify tracks.
- **Spotify**: album covers through its oEmbed endpoint, and playback through the embed player in the browser.

**While a user swipes**, the backend pulls new songs for them. When fewer than 5 pulled songs are waiting, it asks ReccoBeats for 40 recommendations seeded with the songs nearest the user's taste, keeps up to 20 that are nearest that taste and that the user has not had, looks up their covers on Spotify, and stores them in the table (`SONG#id`). The user's next songs come from those before the starting library. If either service fails or limits requests, the failure is logged, suggestions continue from the starting library, and that user's next attempt waits a minute. Set `LIVE_MUSIC=off` to use the starting library only.

**The starting library** is `data/songs.csv`, bundled into the Lambda. It gives every new user their first songs and is the fallback. The committed file has 150 real tracks. To rebuild it:

- `npm run library:pull` pulls about 150 tracks from the platforms, spread across styles. `npm run library:pull -- 300 ids.txt` sets the size and starts from your own tracks (one Spotify track ID, URI or link per line).
- `npm run library -- <chosic-export.csv>` builds it from a manual Chosic Spotify Playlist Analyzer export instead (the original plan, OPEN-6). It checks each track on Spotify and fills in covers.

Columns are found by header name, in any order; `data/songs.sample.csv` shows the shape with placeholder rows.

Spotify answers 429 if its cover endpoint is called too fast, which is why covers are fetched only for songs that are kept and why the library scripts pause between batches. If a script stops on 429, wait a few minutes and run it again.

## Admins and reports

Users can report someone they were matched with (match screen), and the chat screen's report button files a report too. Admins review them on the `/admin` page (`src/admin/`).

- **Root admins** are named in the `AdminEmails` deploy parameter (comma-separated emails). Each signs up like any user. They cannot be demoted or suspended from the page.
- **Other admins** are given admin rights by an admin. No one can suspend or demote themselves.
- **Suspending** an account sets a flag, ends all its sessions, takes it out of matching and removes its push subscriptions. Its chats stay readable to the other people. Unsuspending clears the flag.
- **Every action is logged** (`AUDIT` items) and shown on the page's Activity tab.

The development server seeds `admin@do-re.test` (password `demo-pass-1`) as root admin, and two sample reports.

## Push notifications

Browsers are told about matches and chat messages with standard Web Push (`src/notify/`):

1. The song, match and chat functions publish an event to an **SNS topic** when a swipe offers a match, a confirmation completes one, or a message is stored.
2. The **notifier function**, subscribed to the topic, looks up the recipient's browser subscriptions in DynamoDB and sends each a Web Push request, encrypted for that browser and signed with the app's VAPID key. Subscriptions a push service reports gone are deleted.
3. The browser's service worker (`frontend/public/sw.js`) shows the notification.

Setup, once per deployment:

```
npm run push:keys
```

It prints an `aws ssm put-parameter` command that stores the private key as a SecureString in SSM Parameter Store, and the `VapidPublicKey` value to pass to `sam deploy`. The private key is the project's only secret and exists nowhere else. Without `VapidPublicKey` the app deploys with notifications off (`GET /push/public-key` answers 503). Making a new key pair later ends every existing subscription; browsers resubscribe the next time the app is opened.

On the development server a key pair is made at startup and events are delivered in-process, so real notifications work on `localhost` (with an internet connection, since the browser's push service is real).

Subscription endpoints are accepted only on the browsers' push services (Google, Mozilla, Microsoft, Apple), because the notifier sends requests to them.

## Table layout

One DynamoDB table with string keys `pk` and `sk`.

| Item | `pk` / `sk` | Written by |
|---|---|---|
| Account | `USER#id` / `PROFILE` | AccountModel |
| Email claim (makes emails unique) | `EMAIL#address` / `EMAIL` | AccountModel |
| Confirmation token (hashed) | `USER#id` / `VERIFY` | AccountController |
| Session (token hashed) | `SESSION#hash` / `SESSION` | SessionModel |
| Taste Vector + history | `USER#id` / `TASTE` | MusicTasteModel |
| Suggestion cache and pulled songs waiting | `USER#id` / `SUGGEST` | SongSuggestionModel |
| Song pulled from the music platform | `SONG#id` / `SONG` | SongCatalog |
| Active song, liked flag, swipe count | `USER#id` / `SONGSTATE` | SongController |
| Leaderboard entry | `POOL` / `USER#id` | MatchModel |
| Match + decisions | `MATCH#lo_hi` / `MATCH` | MatchModel |
| Match pointer | `USER#id` / `MATCH#other` | MatchModel |
| Next match offer | `USER#id` / `MATCHSTATE` | MatchModel |
| Chat | `CHAT#lo_hi` / `META` | ChatModel |
| Message | `CHAT#lo_hi` / `MSG#timestamp#seq` | ChatModel |
| Chat pointer | `USER#id` / `CHAT#lo_hi` | ChatModel |
| Last heartbeat | `USER#id` / `PRESENCE` | ChatController |
| Browser push subscription | `USER#id` / `PUSH#hash` | PushSubscriptionModel |
| List of all accounts | `USERS` / `USER#id` | AccountModel |
| A user's sessions (to end them all) | `USER#id` / `SESSION#hash` | SessionModel |
| Report about a profile | `REPORT` / `reportedId.reporterId` | ReportModel |
| Admin action log | `AUDIT` / `time#id` | AdminController |
| Which user a browser belongs to | `PUSHENDPOINT#hash` / `OWNER` | PushSubscriptionModel |

Concurrency arguments are in the class comments of `MatchModel`, `ChatModel`, `AccountModel`, `SongController` and in `updateItem` (`src/store/Table.ts`).

## Differences from `architecture-stubs-v2.java`

Each is also noted in the method's doc comment.

- **All methods are async** and return a `Promise`. `Optional<T>` is `T | undefined`, `Instant` is epoch milliseconds, `byte[]` is `Uint8Array`.
- **Models take a `Table`** (plus a clock and random source where needed) in their constructors. Preconditions about the caller are checked and thrown as `AppError` (400/403/404/409), because HTTP clients are not trusted.
- **SessionModel is new.** Login returns a token; every other route requires it.
- **Profile pictures are URLs** (`UserProfile.profilePictureUrl`), stored through a `PictureStore` (S3), limit 4 MB, PNG/JPEG/GIF/WebP.
- **AccountModel.createAccount** returns `undefined` if the email is taken, instead of requiring the caller to check first (two requests could both pass the check).
- **AccountController.login** re-sends the confirmation email on `NOT_VERIFIED`, at most once a minute. **confirmEmail** links expire after 24 hours.
- **MusicTasteModel.getTasteVector** has no effect; the neutral vector is the value of a user with nothing stored. A skip weighs a quarter of a like (`SKIP_STRENGTH`). New: `undoLastListen`.
- **SongSuggestionModel** spreads a new user's first songs across the library, then plays the cached song nearest the current taste (both from the frontend demo). It takes a `SongCatalog` and an optional `MusicSource`, and pulls songs from the platform (`pullSuggestions`). New: `getSong` (async), `returnSuggestion`.
- **The admin panel and reports are new** (`src/admin/`): `LoginResult` gains `SUSPENDED`; `AccountModel` gains `listUsers`, `getAccount`, `setAdmin`, `suspend`, `unsuspend`; `SessionModel` gains `endAllSessions`; `MatchModel` gains `removeUser`, `hasMatch`, `lastActiveTimes`; `ChatController.reportChat` also files a profile report.
- **Push notifications are new** (`src/notify/`): `SongController`, `MatchController` and `ChatController` take an optional `EventPublisher`; `ChatModel.isVisibleTo` is new.
- **SongCatalog and MusicSource are new.** The song library is no longer fixed: songs pulled while swiping are stored and resolved by ID.
- **SongController.submitFeedback** clamps a listen time above the song's duration instead of rejecting it, and fails with 409 `SONG_NOT_ACTIVE` when the song is not the active one. New: `canUndo`, `undoLastSwipe` (last 10 swipes).
- **MatchModel.recordDecision** takes a match ID; a user's first decision stands. A match is offered every 5 to 9 swipes. New: `isMutual`, `getMatch`, `getPendingMatch`, `getOutgoingMatches`, `retractConfirmation` (take back a yes the other user has not answered; it becomes a decline), static `compatibilityOf`. **MatchController** has `getMatch(matchId, userId)`, `getOutgoingMatches` and `retractMatch`.
- **ChatModel.createChat** makes one chat per pair (the ID is derived from the two user IDs) and returns the existing one otherwise. **addMessage** trims the text, returns the stored message with a `seq`, and moves an out-of-order timestamp up rather than requiring the caller to order them. **getChatsForUser** returns summaries with the last message, not whole chats. **getChat** takes an optional `since` and `viewer`; a user who removed or reported a chat gets 404 for it.
- **ChatController** takes the table and clock; `getHistory` takes the requesting user; new `getChat`. **recordHeartbeat** ignores heartbeats within 10 s of the stored one.

## Known limitations

- The table is provisioned at 15 read / 10 write units to stay in the free tier. A chat poll costs about 4 read units, so more than roughly 10 people chatting at once will see slower responses while DynamoDB throttles and the SDK retries.
- `getLeaderboard` and `findMatch` read the whole leaderboard partition. That is fine for a class-sized user base and would need an index beyond a few thousand users.
- If a Lambda instance dies between recording a swipe and updating the Taste Vector, that one listen is not counted.
- Profile pictures are limited to 4 MB. Replaced pictures are not deleted from S3.
- A starting-library song can come back after (library size − 5) other songs once pulled songs run out, and a cached song far from the user's taste can wait a long time for its turn.
- Live pulling depends on two outside services with no uptime promise and unpublished limits. A pull adds about a second to one swipe in roughly fifteen. Under many users Spotify's cover endpoint may limit requests; the app then serves the starting library until the backoff ends.
- ReccoBeats does not know every Spotify track, and its recommendations lean towards popular music in many languages.
- Sign-up and the verification poll reveal whether an email has an account (OPEN-16). `docs/project/security.md` lists what the security audit fixed and what it left for the team.
- Suspending a user does not hide their existing chats or pending matches from other people. The admin user list reads one item per account, which is fine at class size. Accounts cannot be deleted.
- Push notifications are best effort: if SNS or a browser's push service fails, the notification is lost (the app still shows the match or message when opened). On iPhone and iPad they work only after the app is added to the Home Screen. Clicking a notification when no tab is open lands on the login page, because the session lives in the tab.
- Usernames start empty (R-ACC-09) and are not unique; the client shows "New user".

Song data: Chosic (chosic.com), from Spotify's track analysis. Playback: Spotify embed player.
