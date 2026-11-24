# Frontend handoff for Felix

**Status (2026-11-23):** every screen is built and runs on an in-memory demo backend. The real HTTP client is written and unit-tested against the routes in `api.md`, but **it has never talked to a real server**, because none exists yet. The code is on branch `yara-chat`, built on `gavin-frontend`.

## Connect the backend

1. Build the routes in [`api.md`](api.md), and answer its open questions (Q-1 to Q-14). Q-1 (login token) and Q-3 (`messageId`) block integration.
2. Allow CORS from the CloudFront origin and `http://localhost:5173`, with `Authorization` and `Content-Type` headers and methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`.
3. Set the API URL for the frontend. This is the **only code-free switch** from the demo to the real backend:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   Then set `VITE_API_BASE_URL` in `app/frontend/.env.local`. It is read at build time, so rebuild after changing it. With it set, the app uses the real API and the Spotify player, and the demo's test accounts aren't loaded.
4. Replace the demo songs with the Chosic CSV in the backend. Check real Spotify playback by hand, since `spotifyPlayer.ts` has only run against a fake.
5. Make the verification email link to `<frontend origin>/verify?userId=<id>&token=<single-use token>`.

## Deploy to S3 + CloudFront

```powershell
npm ci
```

```powershell
npm run build
```

- Upload `app/frontend/dist/` to S3.
- **Set CloudFront custom error responses so 403 and 404 return `/index.html` with status 200.** Without this, refreshing or opening any link such as `/chats` or `/verify?...` fails.
- A production build **without** `VITE_API_BASE_URL` runs the fake demo, so make sure it is set for the deployed app.

## What the backend must implement

The demo's models follow the Java stubs and can be used as a reference when porting. The demo runs in one browser thread, so **it does not prove the concurrency requirement**: the real models still need DynamoDB conditional writes.

| Java component | Reference in `frontend/src/api/` | Notes |
|---|---|---|
| MusicTasteModel | `mockTaste.ts` | Bounded update (OPEN-15), 100-song history |
| SongSuggestionModel | `mockSuggestions.ts` | Cache of 5; see the first decision below |
| MatchModel | `mockMatch.ts` | Compatibility, 72 h window, random 5 to 9 swipes |
| ChatModel + ChatController | `mockChat.ts` | Remove/report, 30 s online window |
| AccountModel + AccountController | `mock.ts` | The demo stores passwords in plain text. **The real one must store salted hashes.** |

## Decisions to confirm

These fill gaps in the stubs. Change them if you disagree.

- **New users' first songs:** "near taste" means nothing at the neutral starting point, so the first 5 songs are spread across the library (notes F-12).
- **`computeWeight`:** a like is `0.2 × (0.5 + 0.5 × fraction listened)`. A skip is `-0.05 × (1 - fraction listened)`. Skips are weaker because they say less about taste. In testing, equal-strength skips often matched people with the wrong bot.
- **Compatibility:** `100 × (1 - distance / √7)`, which meets the stub's spec.
- **`getMatch`:** returns a match only while it awaits the caller's answer.
- **Undo (Q-14):** not in the stubs. It reverses the latest swipe, including its effect on the Taste Vector, so a song swiped again counts once. The server must keep each user's last 10 swipes. `mock.ts` (`undoLastSwipe`) is the reference.
- **Developer mode:** a browser-only switch on Profile. It needs `GET /songs/taste` to show the Taste Vector. If you don't want that route public, tell the frontend and the panel can be removed from production builds.
- **App-wide heartbeat (Q-7):** the route is in the client, but no page calls it. Today a user only shows as online while they have a chat open.

## Not verified

- Anything against a real server: auth, CORS, email delivery, persistence, or two real people chatting.
- Real Spotify playback. The demo player is silent because its track IDs are placeholders.
- Real profile picture storage.

## Known limits of the demo

- Its data lives in one browser tab and resets on refresh.
- The bots and their chat replies exist only in the demo, and go away with the real backend.
- Someone who likes only one song and swipes instantly can occasionally match a bot with a similar style.

## Requirements status

All 58 active requirements have a frontend implementation. These can only be fully met once the backend exists, because the demo stands in for the server:

- **Accounts and security:** R-ACC-01, 04, 09, R-SEC-01, 02, 03
- **Songs and matching:** R-HOME-01, 11, 12, 13 (real audio), 15, 17, 18, 19, 20, 22, 23
- **Chat:** R-CHAT-01, 02, 06, 15, 16 (real data and other users)
