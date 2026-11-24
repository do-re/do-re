# CLAUDE.md — Do~Re (CPEN 221A team project)

A Tinder-style app where users swipe on songs, build a 7-number music taste profile (Spotify-style audio features from Chosic; no tags), get matched with people of similar taste, and chat. Team: PM Kevin, designer Sarah, developers Felix (lead), Gavin, Yara. This file is shared by every developer's Claude Code session.

## Context files

Loaded automatically:
- @docs/project/requirements.md — the 57 requirements with stable IDs, test category and component. **This is what we're graded on.**
- @docs/project/open-issues.md — known conflicts between sources (OPEN-n). Check before touching an affected area.

Read when relevant:
- `docs/project/architecture.md` — **golden reference** for components, client/server placement, communication, owners.
- `docs/project/app-spec.md` — problem, solution, screen layouts, logo/branding.
- `docs/project/testing.md` — test categories, coverage targets, proofs, review checklist.
- `docs/course-requirements.md` — course deadlines, deliverables, rules (C-xxx IDs).
- `architecture-stubs-v2.java` — method signatures and specs to implement against.
- `docs/assets/ui-sketch.png` (screen sketches), `docs/assets/logo.png` (team logo).

## Precedence when sources disagree

1. Course `[MUST]` items (`docs/course-requirements.md`). Never violate; stop and flag.
2. `docs/project/architecture.md` (golden) for structure and behaviour.
3. `docs/project/requirements.md` for what must be true (graded by proportion met).
4. `architecture-stubs-v2.java` for signatures and specs.
5. `app-spec.md`, the sketch, and the original design spec: earlier drafts.

If a task hits a conflict between 2 and 3, check `open-issues.md`. Follow its working assumption, name the OPEN-n in your reply, and don't decide it yourself. If it's a new conflict, add it there.

## Ownership

Each component has one owner (team plan). Edit freely in the component you were asked to work on. **Changing another owner's component, or any public signature/spec, needs a heads-up**: say so in your reply so the dev can tell its owner.

| Owner | Components |
|---|---|
| Felix | Backend structure (DB, auth/IAM, chat logs, profiles, notifications), AccountModel, MusicTasteModel, SongSuggestionModel, ChatModel |
| Gavin | AccountController*, LoginView, CreateAccountView (new), ProfileView, HomeView, MatchModel*, MatchView, MatchController (not yet assigned) |
| Gavin & Yara | SongController* |
| Yara | ChatController*, ChatView, MessageLogView, BottomBarView, ViewController* |

\* implementer coordinates with Felix for backend/API integration.

## Working rules

- **Traceability:** before coding, name the requirement IDs the change satisfies (e.g. R-HOME-19). Put them in the commit message, test names, and the method's `Satisfies:` Javadoc line.
- **Specs:** every method keeps a Javadoc with `Requires:` / `Effects:` (pre/postconditions) and `@param`/`@return`. ADTs keep an abstraction function, rep invariant and `checkRep()`. Implement to the spec; if the spec is wrong, fix the spec first and flag it.
- **Tests (white-box, written by Claude):** see `testing.md`. Every method is tested; target line ≥ 90%, branch ≥ 85% (JaCoCo, OPEN-12). Partition inputs, hit boundaries (72 h, 60 s, 100 songs, 0% / 100%), and test concurrency where state is shared.
- **Serverless backend:** Lambda instances share no memory. All model state lives in DynamoDB, reached through store interfaces passed into each model, so tests use an in-memory fake.
- **Concurrency is a required course concept.** Concurrent requests can hit different Lambda instances, so MatchModel and ChatModel make their operations atomic with DynamoDB conditional writes / transactions. Each class comment has a written argument for this; there are no in-JVM locks for shared state.
- **Security:** store salted password hashes, never plaintext; never log passwords, tokens or emails. No secrets in the repo (use environment variables or AWS config).
- **Web front-end practice (React):**
  - Each view is a page with its own URL route, so back/forward and refresh work.
  - Forms use real `<form>` elements, with labels, the right input types and `autocomplete` (`email`, `current-password`, `new-password`), and submit on Enter.
  - Validate on the client for fast feedback, but the server is the authority.
  - Disable submit while a request is pending.
  - Keep typed input on errors, but clear password fields.
  - Popups are accessible modal dialogs: focus moves in on open and returns on close, Escape closes, and they use `role="dialog"`.
  - Error text says what to fix.
  - Layout is mobile-first.
- **Immutability:** records holding arrays or lists make defensive copies (see AudioFeatures, TasteVector, Song).
- **Branches:** feature branches, merged to `main`. Never commit to `milestone-*` branches; never edit `milestone-2-stubs.java` (graded snapshot).
- **Cost:** free tiers only. No always-on billed AWS resources (NAT gateways, EC2/RDS left running).
- **AI usage log (course requirement):** after each AI-assisted task, append a row to `docs/ai-usage-log.md`: date, dev, task + requirement IDs, prompt summary, files touched, how it was verified.

## Stack & commands

- **Frontend:** React + TypeScript single-page app on S3 + CloudFront. Spotify embed player for audio. Tests: Vitest + React Testing Library.
- **Backend:** Java on AWS Lambda + DynamoDB; Amazon SES for verification emails.
- **Data:** song library = Chosic playlist CSV export, loaded at backend start.

Fill these in once the build is set up:
- Build: `TBD`
- Run server: `TBD`
- Run client: `TBD`
- Tests + coverage: `TBD` (must be one command; course C-REL-3). Backend: JaCoCo complexity ≥ 90%, branch ≥ 85%, method 100%.

## Timeline (team plan + course)

- **Nov 13** — M3 plan due (course). Account system + email verification started. This context set up.
- **Nov 16** — Front end done (views + mock controllers, local mock database).
- **Nov 18** — Chat system on AWS.
- **Nov 20** — Backend structure done.
- **Nov 22** — Front end integrated with backend API.
- **Nov 25** — App complete; manual review (black-box + visual) starts.
- **Nov 27** — M4 Release due: documented code, install docs, automated tests + coverage, known bugs, contributions statement.
- **Dec 3** — Live demo (lecture time, Kaiser 2020/2030).
- **Nov 27 – Dec 4** — Other teams file bugs against the deployed app; keep it up.
- **Dec 9** — Triage + individual reflections due (team target Dec 7).
