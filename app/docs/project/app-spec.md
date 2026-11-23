# App Spec — Do~Re (song-matching app)

**Sources:** `design-specs.md` and `README.md` in the team repo (do-re/do-re), the UI sketch (`docs/assets/ui-sketch.png`), and the golden architecture (`architecture.md`). The sketch and design spec are earlier drafts: some screens and popups have changed since. **When they disagree with `architecture.md`, the architecture wins.**

## Team

- **Team / app name:** Project Do-re (app wordmark "Do~Re", with music notes).
- **Mission:** Fostering connections online.
- **Roles:** PM Kevin; Designer Sarah; Developers Gavin, Felix (lead developer, coordinates), Yara.
- **Logo:** `docs/assets/logo.png`, a speech bubble containing two beamed music notes. Black line art on white. "Created by BEARicons from Noun Project" (Creative Commons). **Keep that attribution wherever the logo appears** (README, app About/credits, GitHub org avatar).

## Problem (summary)

Phone-based social media has made in-person connection harder, especially for younger people. Structured hobbies (clubs, teams) need commitment, money, or skill. Music is a near-universal interest, but there's no low-commitment way to find people with the same taste. Many skip concerts rather than go alone. Loneliness carries real health risks (US Surgeon General, 2023). Shared music experiences promote social bonding (Harvey, 2020; Tarr et al., 2014). Full text: `design-specs.md`.

## Solution (what the app does)

1. **Account:** sign up with email and password; the email must be verified before anything but login/sign-up works.
2. **Swipe songs:** one song card at a time (album cover, coloured background, playtime), played through the Spotify embed player (a preview by default). At any time:
   - swipe left or tap the left arrow → next song;
   - swipe right or tap the right arrow → like + next song;
   - tap like → like and keep listening.
3. **Taste profile:** each song the user leaves updates a 7-number Taste Vector, Spotify-style: valence, danceability, energy, acousticness, instrumentalness, liveness, speechiness. The update is weighted by listen time and like/skip. Song features come from Chosic. No tags (team decision 2026-11-11).
4. **Matching:** after a random number of swipes, the user is shown their next-best match among users active in the last 72 h, with a compatibility percentage. Both users accept or reject.
5. **Chat:** when both accept, a chat opens. Users can exchange messages and contact info. Chats can be removed from the log or reported.

Out of scope for the MVP: location / "nearby" matching (decided, OPEN-5), push notifications, encrypted contact fields, song tags.

**Hosting:** all on AWS. React + TypeScript frontend on S3 + CloudFront; Java backend on Lambda + DynamoDB; email via SES (`architecture.md` → Deployment).
**Credits to show in the README / app:** logo (BEARicons, Noun Project), song data (Chosic, from Spotify), playback and album art (Spotify).

## Screens (from the sketch, reconciled with the architecture)

| Screen | Layout | Component |
|---|---|---|
| Login (`/login`) | "Do~Re" wordmark with notes; "LOGIN"; email box; password box; arrow (Enter) button; "Create an account" link | LoginView |
| Login error popups | Popup on the login page: ⚠ "ERROR — Account not verified, please try again" or "Email or password is incorrect", OK button | LoginView |
| Create account (`/signup`) | Wordmark; "CREATE AN ACCOUNT"; email (pre-filled if typed on login), password, confirm password; terms-of-service text on fake accounts; "Create account" button; "Back to login" link | CreateAccountView |
| Create-account popups | Popups on the signup page: errors (invalid email, passwords don't match, email already in use) with OK; on success, "Check your email: we sent a verification link to …" with "Back to login" | CreateAccountView |
| Home | Song name + artist at top; album cover centred on a full-screen coloured background, with a **left arrow button** on its left and a **right arrow button** on its right; slider under the cover with elapsed time; **like button** under the cover next to play/pause; bottom bar. (Sketch tag bubbles removed.) | HomeView |
| Match | "You matched with *username*!"; two circular profile pictures joined by a music note; "XX.X% match!"; "Skip or play this match?" with skip (decline) and play (confirm) buttons | MatchView |
| Chat | Header: back, other user's name, online dot, report. Their messages left in **grey** bubbles with their picture; yours right in **blue** bubbles (iMessage style); rounded text box at bottom with send button | ChatView |
| Chat list | One button per past match (picture + username), most recent first; remove-chat button | MessageLogView |
| Profile | Username + profile picture; change-username box; change-picture button → upload popup | ProfileView |
| Bottom bar | Home, Messages, Profile buttons (all screens except Login) | BottomBarView |

## Visual rules (from requirements)

One readable font across the whole app; background colours contrast with UI elements; the bottom bar is on Home, Profile and the chat list. Chat bubbles: yours blue, your match's grey.
