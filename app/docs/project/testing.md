# Testing & Verification Plan

**Source:** the team's Milestone 3 plan (Google Doc), section 5 and Appendix A. Text marked `[RECOMMENDATION]` or `[DERIVED]` is not from the team plan.

## Who verifies what

| Category | What | Who | When |
|---|---|---|---|
| **White-box (WB)** | Automated test suite | **Written by Claude, reviewed and overseen by developers** | Run after **every build** |
| **Black-box (BB)** | Use the running app; check output against input | PM + Designer | Live demo session at a team meeting once implementation is complete (around Nov 25–26) |
| **Visual (V)** | Inspect screens for the visual requirement | PM + Designer (Appendix A intro says PM + Developer; the plan's closing paragraph says PM + Designer) | Same demo session; the designer leads it |

Each requirement's category is in `requirements.md`. Any team member can **escalate** a requirement's test: Visual → Black-box → White-box. Disagreements were resolved by picking the higher category.

## White-box rules for Claude

- **Coverage targets (OPEN-12, decided):**
  - **Backend (TypeScript, Vitest; changed from Java/JaCoCo on 2026-11-23, see OPEN-12):** branch ≥ 85%, lines ≥ 90%, functions = 100%, enforced by Vitest coverage thresholds so `npm test` fails below target. (The Java plan was JaCoCo complexity ≥ 90%, branch ≥ 85%, method = 100%.) `src/lambda.ts`, the composition root that only reads environment variables and creates AWS clients, is excluded and covered by the deployed smoke test.
  - **Frontend (React + TypeScript):** Vitest + React Testing Library, with Vitest's coverage report: branch ≥ 85%, lines ≥ 90%, every exported function and component tested. Mock the backend API client and the Spotify embed player in component tests.
  - Every method is tested.
- Name tests after the requirement they verify, e.g. `R_HOME_19_findMatchIgnoresUsersInactiveFor72h()`. Tests for methods with no requirement get a `// spec:` comment naming the method's postcondition.
- Test against the **spec** (Requires/Effects), not the implementation: cover each partition of each input and each clause of each postcondition, and include boundary values (exactly 72 h, exactly 60 s between messages, 100th vs 101st history entry, 0% and 100% compatibility).
- Every ADT gets a `checkRep()` and tests that operations preserve the rep invariant.
- `[RECOMMENDATION]` Black-box requirements still depend on model/controller logic (chat ordering, report flagging, verification gating). Unit-test that logic as well: it doesn't change the requirement's category, and the "every method tested" target requires it anyway.
- `[RECOMMENDATION]` Concurrency gets explicit tests: many threads confirming the same match yield exactly one chat; concurrent `addMessage` calls lose no message and keep timestamps ordered. Run them against the in-memory store fake (which must give the same atomicity as DynamoDB conditional writes), plus at least one run against DynamoDB Local. In the backend, `test/tableContract.ts` runs one set of store assertions against both, and `test/dynamo.test.ts` repeats the concurrency tests on DynamoDB Local.
- Models take their store as a constructor argument, so unit tests never touch AWS.

White-box requirements (7): R-ACC-04, R-HOME-11, R-HOME-12, R-HOME-17, R-HOME-18, R-HOME-19, R-HOME-22. (R-HOME-02 was removed.)

## Proofs (team plan)

1. "Ensure the integrity of our database under any conditions." `[DERIVED]` Concrete invariants to prove or argue: emails and user IDs are unique; only hashes and salts are stored, never passwords; every chat's two participants exist and confirmed the same match; each confirmed pair has at most one chat; messages within a chat are in timestamp order.
2. "Validate the suggestion algorithm to give reliable answers and not explode in value under strange listening behaviours." `[DERIVED]` Property: for any sequence of listens, every Taste Vector entry stays in [0, 1]. This follows from the bounded update in `MusicTasteModel.recordListen` (|w| ≤ MAX_STEP < 1 and clamping). Back it with a randomized (property-based) test.

## Code review / inspection checklist (team plan)

Applied at review, by the designer (Sarah) and developers:

1. Detailed specifications for every method.
2. Abstraction functions and rep invariants for ADTs.
3. Good language conventions and practices.
4. All variables in proper scope.
5. No memory leaks.
6. Sensitive user data is encrypted and protected.
7. Mutability/immutability matches the specs.

## Process

- Tests run after every build. White-box testing beyond the suite is at developers' discretion, alongside each build.
- Commit regularly to GitHub with brief messages.
- Course: the Release deliverable needs **automation to run the tests and measure coverage** (course C-REL-3), so one command must do it: `npm test` in `backend/` (needs Docker for DynamoDB Local).
