# CPEN 221A (Fall 2026) — Team Project: Course Requirements

**Source:** https://ubc-ece.craft.me/cpen221/fall2026/project and its sub-pages (Overview, Design Your Team, Design Your Solution, Requirements, Architecture, Plan, Release, Evaluate and Triage, Reflect, plus 3 lecture-note pages). Captured 2026-11-11.

**Scope of this file:** ONLY what the course requires or recommends. Project-specific design, requirements, and architecture live in the project spec files (see CLAUDE.md). If a project decision conflicts with anything tagged `[MUST]` here, flag it. Do not silently resolve it.

## Labels

| Label | Meaning |
|---|---|
| `[MUST]` | Stated course requirement. Missing it costs marks or makes work ungradable. |
| `[SHOULD]` | Stated recommendation or "preferably". |
| `[GRADED n]` | Worth n points (project total = 25). |
| `[DELIVERABLE]` | A file or artifact that must exist at the graded commit. |
| `[CONTEXT]` | Background or rationale from the course. Not a requirement. |
| `[UNCONFIRMED]` | Inferred or ambiguous on the course page. Verify with course staff. |
| `[DERIVED]` | Not stated by the course. An implication drawn from the requirements, for implementation work. |

IDs (`C-XXX-n`) let project docs and commits reference course requirements.

---

## 1. Schedule & grading

All deadlines are 11:59 pm on the date. **Late submissions receive 0.** `[MUST]`
The project is worth **25 points, about 20% of the CPEN 221A grade.**

| Milestone | Due | Phase(s) & points | Deliverable | Graded branch |
|---|---|---|---|---|
| M1 | Oct 26 (orig. Oct 16) | Design Your Team **3**; Design Your Solution **2** | Problem statement in README; design spec (Markdown) | not stated |
| M2 | Nov 2 (orig. Oct 30) | Requirements **2**; Architecture **2** | `milestone_2_requirements.md`, `milestone_2_architecture.md`, code stubs | `milestone-2` |
| M3 | **Nov 13** (orig. Nov 6) | Plan **6** (largest single item) | `milestone_3_plan.md` at repo root | `milestone-3` |
| M4 | **Nov 27** | Release **5** | See §5.6 | not stated `[UNCONFIRMED]` (likely `milestone-4`) |
| Demo | **Dec 3**, lecture time, Kaiser 2020/2030 | Part of Release | Live demo (video only if live is impossible) | — |
| M5 | Dec 4 | Evaluate **2** | Issues filed on *other* teams' repos | — |
| M6 | Dec 9 | Triage **1**; Reflect **2** (individual) | Triaged issues; `reflections.md` (separate repo) | — |

`[UNCONFIRMED]` The page lists two dates for M1–M3. This file treats the later date as the extended deadline. Confirm with course staff.

---

## 2. Submission rules (every milestone)

- **C-SUB-1** `[MUST]` All work lives in repo `cpen-221-2026-project-<n>` in GitHub org `CPEN-221-2026`. Work anywhere else cannot be graded.
- **C-SUB-2** `[MUST]` For each milestone, create branch `milestone-<k>` off `main`. The latest commit on that branch before the deadline is the **only** graded commit.
- **C-SUB-3** `[MUST]` If TAs should look anywhere other than the milestone's Markdown file (e.g., stub source files), the milestone file must point there explicitly. For M2, it must state where the code stubs are.
- **C-SUB-4** `[MUST]` M3: if GitHub Pages is used, link it from `milestone_3_plan.md`. Self-contained in the .md is also fine.

---

## 3. Technical constraints (whole project)

- **C-TECH-1** `[MUST]` Interactive: accepts and responds to user input; not static content. A CLI or API is allowed, but every command or endpoint and its behavior must be specified.
- **C-TECH-2** `[SHOULD]` Uses a data set read from a file or set of files.
- **C-TECH-3** `[MUST]` Client-server pattern: communication between two or more machines.
- **C-TECH-4** `[MUST]` Uses at least one external library beyond the standard Java libraries.
- **C-TECH-5** `[MUST]` Any language is allowed (Java, Rust, Go, TypeScript, C++, Python…), but the work **must integrate the course's core concepts: specifications, testing, abstract data types, and concurrency.**
- **C-TECH-6** `[MUST]` Easy to build/compile.
- **C-TECH-7** `[SHOULD]` Built with free components and services; nobody is expected to spend money.
- **C-TECH-8** `[CONTEXT]` Architecture vocabulary is MVC + client-server. Models, views, and controllers may live on the client, the server, or both.

## 4. Process requirements

- **C-PROC-1** `[MUST]` Follow the course's phased development process.
- **C-PROC-2** `[MUST]` Track milestones in GitHub (e.g., GitHub Issues).
- **C-PROC-3** `[MUST]` Use git branching and merging.
- **C-PROC-4** `[MUST]` Apply good testing practices.
- **C-PROC-5** `[MUST]` Generative AI is allowed **with documentation of prompts and of the mechanisms used to verify correctness.** `[CONTEXT]` The course asks teams to consider AI's environmental cost, and the timeline assumes careful AI use.
- **C-PROC-6** `[MUST]` Each team designates one primary person for each role: **PM, Designer, Developer**. Roles aren't exclusive.
- **C-PROC-7** `[CONTEXT]` Scope is about 3 h/week per student (1 credit), about 105 person-hours over the term. Build a **minimum viable product**: real functionality, not every imaginable feature. Process is emphasized over final implementation. Complexity isn't needed for an A but may be for an A+.
- **C-PROC-8** `[SHOULD]` The project is relevant to UBC campus life (students, staff, faculty, community).

---

## 5. Phase-by-phase requirements

### 5.1 Design Your Team — M1 `[GRADED 3]`
- **C-TEAM-1** `[MUST]` Assign PM, Designer, and Developer(s) (see C-PROC-6).
- **C-TEAM-2** `[MUST]` Write a mission statement and pick a team name; the designer chooses a logo (a Creative Commons icon is fine).
- **C-TEAM-3** `[MUST]` `[DELIVERABLE]` Problem statement in the repo **README**. It describes the problem's scope, consequences, causes, and why existing solutions fall short, and it **must not mention a solution**.
- **C-TEAM-4** `[MUST]` The app is *authentic*: a genuine, compelling, well-focused problem, and a novel or effective solution (or contribution toward one).

### 5.2 Design Your Solution — M1 `[GRADED 2]`
- **C-DSGN-1** `[DELIVERABLE]` Design spec in GitHub Markdown with two sections:
  - **Problem**: a logical, evidence-backed argument (user research, literature). A few paragraphs.
  - **Solution**: *every* screen, error, algorithmic behavior, and piece of textual/visual content, with mockups embedded (hand sketches are OK). An engineer should be able to build it without asking questions. It specifies *what*, not *how*.
- **C-DSGN-2** `[MUST]` Implementable in about 4 weeks part-time. Keep it simple: well-architected, defect-free, and shipped beats feature-rich.

### 5.3 Requirements — M2 `[GRADED 2]`
- **C-REQ-1** `[DELIVERABLE]` `milestone_2_requirements.md`: natural-language requirements grouped into sections, each section linked to the relevant part of the design spec.
- **C-REQ-2** `[MUST]` Each requirement is **one single, precise, verifiable fact**. The set is **non-conflicting** and **complete** with respect to the design spec. Expect dozens to hundreds.
- **C-REQ-3** `[CONTEXT]` **A later grade is based on the proportion of requirements met.** The list can be revised before the final sprint. Requirements double as the implementation to-do list and the basis of the test plan.

### 5.4 Architecture — M2 `[GRADED 2]`
- **C-ARCH-1** `[DELIVERABLE]` `milestone_2_architecture.md` describes every model, view, and controller with:
  1. its responsibility;
  2. where it lives: **client, server, or both**;
  3. which components it communicates with and **precisely what** is communicated.
- **C-ARCH-2** Third-party components (e.g., the database) don't need specs, but components that talk to them should say so.
- **C-ARCH-3** `[DELIVERABLE]` Stub source files for **every** component, with all function headers including arguments, return values, **preconditions, and postconditions**. Bodies can be TODOs.
- **C-ARCH-4** `[SHOULD]` Every teammate can explain the whole architecture in detail. Avoid both a "ball of mud" and over-fragmentation.

### 5.5 Plan — M3 `[GRADED 6]` (due Nov 13)
`[DELIVERABLE]` `milestone_3_plan.md` at repo root. **Every answer needs a written justification.**
- **C-PLAN-1** Coordination: who coordinates, PM practices, meetings (how often, who sets agendas).
- **C-PLAN-2** Communication tools: for each, the alternatives considered and why this one was chosen.
- **C-PLAN-3** Ownership: **exactly one owner per architecture component**, responsible for writing it and making it correct.
- **C-PLAN-4** Timeline: internal milestones and their deadlines.
- **C-PLAN-5** **Acceptance testing plan**: for **every requirement**, how it will be verified (test, review/inspection, or proof), or a justification for not verifying it. For tests: exactly which tests and what counts as passing. For reviews: what code aspects are inspected. For proofs: which property. Also state *when* verification runs (every build? pre-commit?) and who is involved.
- **C-PLAN-6** `[SHOULD]` Stress-test the plan against disasters (illness, API limits, hard bugs). Show how features are prioritized for the MVP.

### 5.6 Release — M4 `[GRADED 5]` (due Nov 27)
`[DELIVERABLE]`s at release:
- **C-REL-1** Well-documented source code.
- **C-REL-2** Install and usage documentation (Docker suggested).
- **C-REL-3** Tests, **plus automation to run them and to measure code coverage**.
- **C-REL-4** A known-bugs list.
- **C-REL-5** A contributions statement.
- **C-REL-6** Live demo on **Dec 3** at lecture time (Kaiser 2020/2030). A walkthrough video only if a live demo is impossible.
- `[CONTEXT]` The PM should review the grading criteria with the team. The rubric isn't on the project page `[UNCONFIRMED]`.

### 5.7 Evaluate — M5 `[GRADED 2]` (due Dec 4)
- **C-EVAL-1** Use other teams' apps for at least 10 minutes each (about 1 h total) and file bugs in their GitHub Issues, labeled by severity:
  - **Major**: functionality can't be used for its intended task, including usability problems that block understanding.
  - **Minor**: works, but needs a workaround or a poorly usable design choice.
- **C-EVAL-2** Check existing issues first. **Duplicates earn no credit**, and credit goes to the first reporter. Black-box testing is suggested.
- `[DERIVED]` Other teams will test *our* app in this window. It must be deployed, reachable, and stable from release through Dec 4. Fixes may be pushed as soon as bugs are reported.

### 5.8 Triage — M6 `[GRADED 1]` (due Dec 9)
- **C-TRI-1** Triage the issues filed against our app using the course's issue triage strategy. **No patch release is required this term.**

### 5.9 Reflect — M6 `[GRADED 2]`, individual (due Dec 9)
- **C-REFL-1** About 1,000 words in `reflections.md`, in a separate repo (link TBD by course), one paragraph per question: what worked or didn't in the team process and why; what you personally did well or poorly and why; optional MVP nomination with two examples; optional "fire" nomination.
- `[CONTEXT]` If the whole team fires the same person, that person loses 15% of their project grade.

---

## 6. Implications for implementation work `[DERIVED]`

These follow from the requirements above and should guide every coding session:

1. **Traceability.** Every feature maps to a requirement ID in the project requirements doc (C-REQ-3: grade = proportion met). Reference requirement IDs in commits, PRs, and tests.
2. **Specs everywhere.** Public methods carry pre/postconditions. ADTs carry rep invariants and abstraction functions (C-TECH-5, C-ARCH-3).
3. **Concurrency must actually appear** somewhere meaningful in the system, not just incidentally (C-TECH-5).
4. **Tests + coverage are automated** and runnable with one command (C-REL-3, C-PROC-4).
5. **One-command build and documented install** (C-TECH-6, C-REL-2).
6. **Free-tier hosting only** (C-TECH-7), and the app stays up through Dec 4 (C-EVAL).
7. **Log AI usage** (C-PROC-5): prompt summary and how correctness was verified, for each AI-assisted change.
8. **Never commit to `milestone-*` branches after their deadline.** Work on feature branches and merge to `main` (C-SUB-2, C-PROC-3).

---

## 7. Lecture notes — background only `[CONTEXT]`

Low priority. Useful for README, design rationale, and reflection wording; not for code.

- **Software Design: From Observation to Values.** Observe before prescribing; workarounds and user errors reveal needs. Interview for stories, not opinions. Value Sensitive Design considers stakeholders (direct, indirect, non-targeted), time, pervasiveness, and values. Software is not neutral; support non-use.
- **Designing Responsibly.** Diverge (brainstorm, lateral thinking), then converge on *concepts*: purposive, user-facing, modular units like Post, Comment, User. Keep concept dependencies extrinsic (Parnas information hiding). Impact Case template: "Problem X matters because…; solution Y; Y is good because…; we'll measure N." Map about 5 stakeholder groups.
- **Software Requirements.** Requirements are explicit acceptance goals and must be complete, precise, non-conflicting, and verifiable. Prototypes leave some requirements implicit (e.g., performance). Requirements must also be legal, ethical, and just.
