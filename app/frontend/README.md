# Do~Re frontend

React + TypeScript single-page app (Vite), deployed as static files to S3 + CloudFront.
Until the backend is live, it runs on an in-memory demo with fake users (`src/api/mock.ts`).

## Commands

```
npm install          # once
npm run dev          # local dev server
npm test             # run the tests once
npm run coverage     # tests + coverage; fails below branch 85% / lines 90%
npm run build        # typecheck + production build into dist/
npm run lint
```

## Running on the real backend

Copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL`. The app then uses the real API and
the Spotify player. Without it, the app runs the demo. See `../docs/project/frontend-handoff.md`.

## Demo accounts

| Email | Password | Behaviour |
|---|---|---|
| `demo@do-re.test` | `demo-pass-1` | Verified, starts with no matches or chats |
| `unverified@do-re.test` | `demo-pass-1` | Login shows "Account not verified" (R-SEC-03) |

You can also sign up. The demo can't send email, so the "Check your email" popup has a link to the
verification page.

## How matching works in the demo

The library has 30 invented songs in five styles. Each swipe updates your 7-number Taste Vector, and
every 5 to 9 swipes you are offered the most compatible active user. Say yes and they answer a few
seconds later. If they accept, the chat appears in Messages and online bots greet you.

| Bot | Likes | Status |
|---|---|---|
| `melody` | Folk | Online |
| `harmony` | Pop | Online |
| `rhythm` | Hip-hop | Online |
| `tempo` | Rock | Online |
| `lyric` | Ambient | Offline: accepts matches but doesn't reply |
| `echo` | Pop | Inactive for over 72 hours, so never matched (R-HOME-19) |

The demo has no sound because its Spotify track IDs are placeholders. Its data lives in one browser
tab and resets on refresh.

The curved arrow left of the heart goes back to the previous song, up to 10 songs, and reverses
that swipe's effect on your taste.

## Developer mode

Turn on **Developer mode** on the Profile page. Home then shows each song's 7 Audio Features, ID and
Spotify URI, and Profile shows your Taste Vector. The setting is remembered in this browser.

## Layout

```
src/api/        types.ts (mirrors the Java records), client.ts (API interfaces)
                http.ts, httpApi.ts, chatHttp.ts: the real API calls
                mock*.ts: the demo backend, following the Java model stubs
src/backend.ts  chooses the real API or the demo
src/session/    who is logged in, and the session token
src/player/     Spotify embed, and the silent demo player
src/components/ Modal, BottomBarView, Avatar, TextField, Credits, ErrorBoundary
src/views/      LoginView, CreateAccountView, VerifyEmailView, HomeView, MatchView, ProfileView,
                MessageLogView, ChatView
src/routes.tsx  ViewController: one URL per view; only login, signup and verify are public
src/paths.ts    path constants used by routes and navigate()
```

Views call the backend only through `useApi()`, so they don't change when the real API is connected.

## Credits

Song data: Chosic (from Spotify). Playback and album art: Spotify.
Logo: "Created by BEARicons from Noun Project" (Creative Commons).
