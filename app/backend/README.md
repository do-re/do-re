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
| `template.yaml` | AWS SAM template: table, four functions, HTTP API, S3 + CloudFront (app and profile pictures), budget alert |
| `test/` | Tests, named after the requirement they verify. `contract.test.ts` drives the backend with the frontend's real HTTP client |

## Install and test

Needs Node.js 22 or later, and Docker for the DynamoDB Local tests.

```
npm install
npm test            # type check + all tests + coverage gate (branch 85%, lines 90%, functions 100%)
npm run test:unit   # the same tests without Docker and without coverage
```

`npm test` starts `amazon/dynamodb-local` in Docker by itself and writes an HTML coverage report to `coverage/`.

## Deploy

Needs the AWS CLI and the AWS SAM CLI, with credentials for the team's AWS account.

1. Put the Chosic export at `data/songs.csv` (see below). The build fails without it.
2. Verify a sender address in SES in the deploy region (`us-west-2` in `samconfig.toml`). Until the account has SES production access, emails reach only verified addresses (OPEN-7).
3. First deploy: `sam build && sam deploy --parameter-overrides EmailFrom=<sender address>`
4. Copy the `AppUrl` output and deploy again with it, so confirmation links and picture URLs point at the app:
   `sam build && sam deploy --parameter-overrides EmailFrom=<sender address> AppBaseUrl=<AppUrl> AlertEmail=<your address>`
5. Build the frontend with `VITE_API_BASE_URL` set to the `ApiBaseUrl` output (`<AppUrl>/api`), then upload it: `aws s3 sync ../frontend/dist s3://<WebBucketName output>` and invalidate the CloudFront cache (`DistributionId` output).

The deployed app calls the API on its own origin, so it needs no CORS. To run the frontend on `localhost:5173` against the deployed backend, set `VITE_API_BASE_URL` to the `DevApiBaseUrl` output; that URL allows the `DevOrigin` parameter's origin. CloudFront serves `index.html` for app routes such as `/chats` and `/verify` through a CloudFront Function, so no custom error responses are needed.

### Song library file

`data/songs.csv` is the CSV export of Chosic's Spotify Playlist Analyzer (OPEN-6). Columns are found by header name, in any order; `data/songs.sample.csv` shows the expected shape with placeholder rows. Needed columns (alternative names in `src/song/SongLibrary.ts`): Song, Artist, Time, Dance, Energy, Acoustic, Instrumental, Happy, Speech, Live, Spotify Track Id, Spotify Track Img. The header names are an assumption until checked against a real export: if one differs, the loader's error names the missing column, and the alias goes in `COLUMNS`.

## Table layout

One DynamoDB table with string keys `pk` and `sk`.

| Item | `pk` / `sk` | Written by |
|---|---|---|
| Account | `USER#id` / `PROFILE` | AccountModel |
| Email claim (makes emails unique) | `EMAIL#address` / `EMAIL` | AccountModel |
| Confirmation token (hashed) | `USER#id` / `VERIFY` | AccountController |
| Session (token hashed) | `SESSION#hash` / `SESSION` | SessionModel |
| Taste Vector + history | `USER#id` / `TASTE` | MusicTasteModel |
| Suggestion cache | `USER#id` / `SUGGEST` | SongSuggestionModel |
| Active song, liked flag, swipe count | `USER#id` / `SONGSTATE` | SongController |
| Leaderboard entry | `POOL` / `USER#id` | MatchModel |
| Match + decisions | `MATCH#lo_hi` / `MATCH` | MatchModel |
| Match pointer | `USER#id` / `MATCH#other` | MatchModel |
| Next match offer | `USER#id` / `MATCHSTATE` | MatchModel |
| Chat | `CHAT#lo_hi` / `META` | ChatModel |
| Message | `CHAT#lo_hi` / `MSG#timestamp#seq` | ChatModel |
| Chat pointer | `USER#id` / `CHAT#lo_hi` | ChatModel |
| Last heartbeat | `USER#id` / `PRESENCE` | ChatController |

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
- **SongSuggestionModel** spreads a new user's first songs across the library, then plays the cached song nearest the current taste (both from the frontend demo). New: `getSong`, `returnSuggestion`.
- **SongController.submitFeedback** clamps a listen time above the song's duration instead of rejecting it, and fails with 409 `SONG_NOT_ACTIVE` when the song is not the active one. New: `canUndo`, `undoLastSwipe` (last 10 swipes).
- **MatchModel.recordDecision** takes a match ID; a user's first decision stands. A match is offered every 5 to 9 swipes. New: `isMutual`, `getMatch`, `getPendingMatch`, static `compatibilityOf`. **MatchController** has `getMatch(matchId, userId)`.
- **ChatModel.createChat** makes one chat per pair (the ID is derived from the two user IDs) and returns the existing one otherwise. **addMessage** trims the text, returns the stored message with a `seq`, and moves an out-of-order timestamp up rather than requiring the caller to order them. **getChatsForUser** returns summaries with the last message, not whole chats. **getChat** takes an optional `since` and `viewer`; a user who removed or reported a chat gets 404 for it.
- **ChatController** takes the table and clock; `getHistory` takes the requesting user; new `getChat`. **recordHeartbeat** ignores heartbeats within 10 s of the stored one.

## Known limitations

- The table is provisioned at 15 read / 10 write units to stay in the free tier. A chat poll costs about 4 read units, so more than roughly 10 people chatting at once will see slower responses while DynamoDB throttles and the SDK retries.
- `getLeaderboard` and `findMatch` read the whole leaderboard partition. That is fine for a class-sized user base and would need an index beyond a few thousand users.
- If a Lambda instance dies between recording a swipe and updating the Taste Vector, that one listen is not counted.
- Profile pictures are limited to 4 MB. Replaced pictures are not deleted from S3.
- With a small library a song can come back after (library size − 5) other songs, and a cached song far from the user's taste can wait a long time for its turn.
- Three public routes reveal whether an email has an account (OPEN-16).
- Usernames start empty (R-ACC-09) and are not unique; the client shows "New user".

Song data: Chosic (chosic.com), from Spotify's track analysis. Playback: Spotify embed player.
