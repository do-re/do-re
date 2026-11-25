# Open Issues — conflicts and decisions

Claude Code: **do not silently resolve `OPEN` or `ASSUMED` items.** If a task touches one, follow the "Working assumption", mention the issue ID in your reply, and leave the decision to the team. `DECIDED` items are settled: implement them as written.

---

## Decided (team, 2026-11-11)

**OPEN-1 · Matching basis** — DECIDED
**Decision:** Drop song tags entirely. Matching uses the 7-number Audio Feature Taste Vector, Spotify-style.
**Effects:** `Song` has no tags; R-HOME-02 removed; R-HOME-11, 12, 17, 18 reworded (`requirements.md` ✎). The sketch's tag bubbles are gone from HomeView.

**OPEN-2 · Swipe and like behaviour** — DECIDED
**Decision:** At any time, the user can:
- **swipe left** → next song;
- **swipe right** → like + next song;
- **press like** → like, and the same song keeps playing.

**Left and right arrow buttons** beside the album cover do the same as the swipes (as in the sketch).
**Effects:** A song liked with the button counts as one like when the user leaves it, however they leave it (`SongController.markLiked` + `submitFeedback`). R-HOME-16 reworded; R-HOME-24, R-HOME-25 added.

**OPEN-6 · Audio Features source** — DECIDED
**Decision:** Chosic (chosic.com). Verified 2026-11-11:
- A song lookup returns **all 7 features**, each as a score out of 100: Happiness (= valence), Danceability, Energy, Acousticness, Instrumentalness, Liveness, Speechiness. It also gives tempo, loudness, key and popularity, sourced from Spotify's track analysis.
- **songbpm.com does not work for this:** its song pages show only BPM and duration; key, energy and danceability are blank.
- **How to build the library:** put the songs in a Spotify playlist, run it through Chosic's **Spotify Playlist Analyzer**, and use **Export to CSV**. That gives one file to load at backend start, with no scraping. Check that the export includes the 7 columns and the Spotify track ID/link before relying on it.
- Store each feature as score / 100 (`AudioFeatures` rep invariant).
- **Playback and album art:** use the Spotify embed player (iFrame API: load a track URI; play/pause/seek; `playback_update` events give position and duration). Listeners not logged in to Spotify get a preview clip, which fits R-HOME-13.
- Chosic's terms page link is broken (404), so there are no published terms to check. Credit Chosic and Spotify in the README.

**OPEN-11 · Hosting and client technology** — DECIDED
**Decision:** AWS for both. Frontend is **React + TypeScript**, built to static files on S3 + CloudFront; backend is on AWS Lambda + DynamoDB (see `architecture.md` → Deployment). The Java stubs are the behaviour spec for the React components.
**Changed 2026-11-23 (Felix): the backend is TypeScript (Node.js Lambda), not Java.** The course allows any language (C-TECH-5). Reasons: one language and test runner across client and server, so the frontend's HTTP client can be tested directly against the backend (`backend/test/contract.test.ts`), and fast cold starts. The Java stubs are now the behaviour spec for the backend too; `backend/README.md` lists where the implementation differs. **The rest of the team has not confirmed this change yet.**

**OPEN-5 · "Nearby" matching** — DECIDED
**Decision:** No location matching. With so few users, filtering by distance would leave no one to match. Matching uses taste + the 72 h activity window only. Don't add location fields.

**OPEN-8 · Chat bubble colours** — DECIDED
**Decision:** Like iMessage: your messages are **blue**, your match's are **grey**. R-CHAT-08 reworded to grey.

**OPEN-12 · Coverage metric** — DECIDED (proposed; confirm wording in the M3 plan)
JaCoCo has no path coverage, but its **COMPLEXITY counter is basis-path coverage**: cyclomatic complexity is the minimum number of independent paths through a method, and JaCoCo reports how many are still missed.
**Targets (written for a Java backend):** backend Java **complexity (basis path) ≥ 90%, branch ≥ 85%, method = 100%**, enforced by `jacocoTestCoverageVerification`. Frontend TypeScript: branch ≥ 85%, lines ≥ 90% via the test runner's coverage report. Suggested plan wording: "≥ 90% basis-path coverage (JaCoCo cyclomatic-complexity counter) and ≥ 85% branch coverage."
**Changed 2026-11-23 with the move to TypeScript (OPEN-11) — needs team confirmation:** JaCoCo does not apply. The backend now enforces **branch ≥ 85%, lines ≥ 90%, functions = 100%** with Vitest's coverage thresholds (`npm test` fails below them). This is a weaker claim than basis-path coverage, so the M3 plan wording should change to match, e.g. "≥ 90% line coverage, ≥ 85% branch coverage, and every function called by a test."

**OPEN-13 · Graded repository** — DECIDED: the team will make sure work is pushed to the course repo (`CPEN-221-2026/cpen-221-2026-project-<n>`, `milestone-<k>` branches).

---

**OPEN-3 · Account creation: page vs popup** — DECIDED
**Decision:** Account creation is **its own page** (CreateAccountView, `/signup`), linked from the login page. Errors and the "check your email" confirmation are **popups on that page**. Requirements R-ACC-02/07/08/10 already say "page", so no rewording is needed. This overrides the golden "account creation popup".

**OPEN-7 · Email verification for outside users** — DECIDED: **Felix owns this** (SES production access, sender identity, demo accounts). Background kept below for reference.

## Still open

**OPEN-7 (background) · Email verification for outside users**
Amazon SES starts in sandbox mode: it delivers only to pre-verified addresses, max 200 emails/day. Anyone else who signs up never gets a link, and R-SEC-03 then locks them out.
"Only the demo is graded" is not quite right. Per the course page:
- Release (5 pts) also grades documented code, install docs, automated tests + coverage, known bugs and a contributions statement.
- The requirements list is later graded by the **proportion met**.
- In Evaluate (Nov 27 – Dec 4), **other teams use your deployed app** for 10+ minutes and file bugs. A sign-up that never sends a link would be an easy **Major** bug, and Triage (1 pt) means handling those.

**Suggested solution:**
1. **Request SES production access now:** console → SES → Get set up → Request production access, type *Transactional*, describe the verification email. AWS replies within ~96 h, so a request this week clears well before Nov 27. Email cost at this volume is negligible.
2. Verify a sender address (or domain) for the From line.
3. Seed a few **pre-verified demo accounts** so the Dec 3 demo never depends on an email arriving.

If AWS denies the request, a free tier of another transactional email provider can be called from the same Lambda.

**OPEN-14 · Gaps in the golden architecture text** — OPEN
Truncated sentences ("All controllers perform API calls between"; MatchModel "Queries the Taste Vectors from" / "At random 'swipe' intervals,"). MatchController has no description and no owner. The doc names `milestone_2_architecture_stubs.java`, but the repo file is `milestone-2-stubs.java`. `architecture.md` fills these with `[ADDED]` text.

---

## Assumed (confirm with the team)

**OPEN-4 · After confirming a match** — ASSUMED
Golden says confirm → ChatView; R-HOME-23 needs both users to accept. Working assumption: open the chat if the other user already confirmed; otherwise return to HomeView, and the chat appears in the chat list once they confirm.

**OPEN-9 · Login with username or email** — ASSUMED
Working assumption: email only (golden). Suggest rewording R-ACC-03/07 to "email".

**OPEN-10 · Bottom bar on every view** — ASSUMED
Working assumption: hidden on LoginView and CreateAccountView, shown everywhere else.

**OPEN-16 · The API tells callers which emails have accounts** — ASSUMED (new, 2026-11-24)
Three public routes reveal whether an email has an account: login (`WRONG_PASSWORD` vs `NO_ACCOUNT`, as in the stubs), sign-up (`EMAIL_IN_USE`, required by the CreateAccountView spec) and `verification-status` (notes-for-felix F-5, api.md Q-12). Working assumption: keep all three as the frontend was built against them; the login page already shows one message for both login failures, and `verification-status` answers `false` for an unknown email. Closing this fully means a pending-signup ID for the poll and a single login failure result, which changes the client.

**OPEN-15 · Bounded Taste Vector update** — ASSUMED
Working assumption: `t ← clamp(t + w·(f − t), 0, 1)` with |w| ≤ MAX_STEP. This is the golden "add features × weight" idea, but bounded, which makes the "won't explode" proof possible.
