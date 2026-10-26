# Demo guide

A reproducible walkthrough of the complete workflow on **synthetic data**, with no API keys. The application, REST API, PostgreSQL + pgvector, review rules and audit history are all real. Only the inference step is replaced, by the **deterministic test provider**: a rule-based word-overlap matcher, **not AI**. The UI says so in a banner and on every recommendation ("Demo provider · not AI").

## What the demo uses

| Piece          | Demo setting                                                                 | Why                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Database       | `fis_demo` on the same PostgreSQL server (override with `DEMO_DATABASE_URL`) | Demo data never mixes with your development data. Scripts refuse any database whose name doesn't end in `_demo`          |
| API            | `pnpm demo:api`: `AI_PROVIDER=deterministic-test`, `DEMO_MODE=true`          | Labelled stand-in; `GET /api/v1/system/ai` reports `demoMode: true`                                                      |
| Seed data      | `data/demo/fixture.json`: 6 need groups, 15 synthetic requests               | Created **through the public API** by the reviewer handle `demo.seed`, using idempotency keys `demo-seed-<synthetic id>` |
| Live scenarios | Texts from `data/synthetic/requests.jsonl` (synthetic)                       | You type them into the UI during the demo                                                                                |

The seed reads only the runtime request texts. Hidden ground-truth labels are never used by the app or the matcher. The fixture's group choices are a curated demo setup, documented here.

## Prerequisites

Steps 1–2 of the [README](../README.md) are done: `pnpm install`, Docker running, `apps/api/.env` copied from `.env.example`.

## Start the demo (three terminals)

```bash
# 1. once: create the demo database and apply migrations (safe to repeat)
pnpm demo:setup

# 2. terminal A: API in demo mode (demo DB + deterministic test provider)
pnpm demo:api

# 3. terminal B: seed the demo groups through the API (idempotent; re-running adds nothing)
pnpm demo:seed

# 4. terminal C: web app
pnpm --filter @fis/web dev            # http://localhost:5173
```

In the web app, type a reviewer handle in the header, for example `pm.demo`, and press **Set**. Every decision is recorded under that handle. There is no login in this version.

## Scenarios (verified with the current demo provider)

These outcomes were observed by running each text through the demo API and are covered by the end-to-end tests (`apps/web/e2e/workflow.spec.ts`). Submit them from **Submit request**, then open the request.

| #                    | Submit this (synthetic)                                                                                                                          | What the system proposes                                                                                                                      | What the reviewer does                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Match             | **Title** `Email notifications are too frequent` · **Description** `Email notifications are way too frequent, I get hundreds per day.`           | _Link to existing group → Fewer, consolidated notifications_, medium confidence, with verified quotes from the request and an approved member | Inspect the evidence → **Approve** → **Confirm approval**. Open the group: the request is now an approved member. The history shows "Assignment to group approved · followed the recommendation"                           |
| 2. Reject / override | `Weekly summary email` · `A weekly roll-up of activity on the projects I follow would replace the dozens of separate emails I get.`              | _Create a new group_. The notifications group appears as a candidate, but word overlap is below the match threshold                           | **Reject recommendation** with a note (no membership is created), then **Link to this group instead** on the notifications candidate. The history records the rejection and a link that "differed from the recommendation" |
| 3. New need          | `Recover deleted tasks` · `Someone accidentally deleted a task with three weeks of comments. There's no trash or undo, so it was gone for good.` | _Create a new group_. The closest candidate ("Edit many tasks at once") is shown but not matched                                              | **Create new group…** (title, e.g. `Recover deleted work`, plus the prefilled need, which you can edit) → the group appears under **Need groups**                                                                          |
| 4. Uncertain         | `notifications` · `too much noise`                                                                                                               | _Needs human review_, flagged "too vague to identify a clear need", with a suggested group                                                    | Discuss why a human decides: approve, reject or create a group                                                                                                                                                             |
| 5. Reversal          | the request from scenario 1                                                                                                                      | n/a                                                                                                                                           | **Reverse assignment…** with a reason. The request returns to the queue, the group no longer lists it, and the history keeps both the approval and the reversal                                                            |

Other texts that currently produce a link proposal:

- `Export invoices to accounting software` → "Invoices flow into accounting"
- `Sign in with company account` → "Single sign-on and central access control"
- `Editing tasks one by one is tedious` → "Edit many tasks at once"

Paraphrases with little shared vocabulary (for example `Night mode`) are **not** matched by the demo provider. That is an honest limitation of word overlap, not of the workflow, and it's a good moment to explain what a semantic model is for.

### Showing AI-unavailable behaviour (optional)

Stop the demo API and start the normal API with `AI_PROVIDER=none` (the default) against the demo database:

```bash
DATABASE_URL=postgresql://fis:fis_local_dev@localhost:5433/fis_demo pnpm --filter @fis/api dev
```

The banner reads "AI not configured". New requests show "Manual triage". Reviewers can still create groups, link requests to any existing group, reverse assignments and read the history.

## Suggested 5-minute recording

1. Queue → the demo banner (what is real, what is a stand-in) → **Need groups** (seeded groups, supporter counts).
2. Scenario 1, end to end: submit → "Processing — not reviewed yet" → recommendation, evidence, candidates → approve → group page → history.
3. Scenario 2: reject, then human override. Point at "Proposed (not approved)" versus "Approved group".
4. Scenario 4: uncertainty flags. Scenario 5: reversal in the history.
5. Close on `docs/evaluation.md`: what the offline evaluation measures, and why the real-model run is still pending.

## Reset or recreate

```bash
pnpm demo:reset     # drops and recreates ONLY the demo database (name must end in _demo), then migrates
pnpm demo:seed      # with `pnpm demo:api` running
```

- `demo:reset` never touches `DATABASE_URL`, and it refuses to run if the demo URL points at the same database.
- `demo:seed` refuses to run unless the API reports `demoMode: true` with the deterministic provider. Re-running it is safe: submissions use fixed idempotency keys, and requests that are already grouped are skipped.
- Live scenario submissions are ordinary requests. Run `pnpm demo:reset` to start a recording from a clean state.

## Telling demo data apart

- **UI:** a purple "Demo mode" banner, and "Demo provider · not AI" on every recommendation.
- **Database:** seeded requests have `idempotency_key LIKE 'demo-seed-%'`, and seeded decisions, groups and memberships are attributed to `demo.seed`. Every triage run stores `provider = 'deterministic-test'` and `is_test_provider = true`.
