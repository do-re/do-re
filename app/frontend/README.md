# Do~Re frontend

React + TypeScript single-page app (Vite), deployed as static files to S3 + CloudFront.
Until the backend is live, it runs against an in-memory mock (`src/api/mock.ts`).

## Commands

```
npm install          # once
npm run dev          # local dev server (mock backend)
npm test             # run the tests once
npm run coverage     # tests + coverage; fails below branch 85% / lines 90%
npm run build        # typecheck + production build into dist/
npm run lint
```

## Mock accounts

| Email | Password | Behaviour |
|---|---|---|
| `demo@do-re.test` | `demo-pass-1` | Verified; has a pending match with `harmony` |
| `unverified@do-re.test` | `demo-pass-1` | Login shows "Account not verified" (R-SEC-03) |

The mock offers a match every 5 swipes. Its Spotify track IDs are placeholders until the
Chosic CSV export is available.

## Layout

```
src/api/        types.ts (mirrors the Java records), client.ts (API interfaces), mock.ts
src/session/    who is logged in (temporary, until ViewController)
src/components/ Modal (accessible popup), BottomBarPlaceholder (until Yara's BottomBarView)
src/views/      LoginView, CreateAccountView, HomeView, MatchView, ProfileView
src/routes.tsx  one URL per view; /home, /profile and /match/:id need a session
src/paths.ts    path constants used by routes and navigate()
```

Views call the backend only through `useApi()`, so swapping the mock for the HTTP client is a
one-line change in `main.tsx`.

## Credits

Song data: Chosic (from Spotify). Playback and album art: Spotify.
Logo: "Created by BEARicons from Noun Project" (Creative Commons).
