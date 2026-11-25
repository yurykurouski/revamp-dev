# Ticket Pipeline and Definition of Done

The full Linear workflow for Revamp-dev, moved out of the root [AGENTS.md](../../AGENTS.md) (§4) so sessions that only read or answer questions don't load it. **Read this whole file before starting work on any ticket.** Section numbers match the references elsewhere (§4.1, §4.3, §5).

## 4. Linear Workflow Synchronization

All development tasks are tracked in the Linear project: [Revamp (REV)](https://linear.app/revamp-proect/team/REV/overview).

### 4.1. Branch and Commit Conventions
* **Task branches:** `ymorpheus/rev-<issue_number>-<short-description>` or `feat/REV-<issue_number>-<short-description>` (e.g., `feat/REV-5-initialize-full-stack-monorepo`).
* **Commit messages:** Always include the task key when applicable:
  * `feat(REV-5): add docker compose and base workspaces`
  * `fix(REV-10): resolve playwright browser context cleanup`

### 4.2. Using Linear MCP
When the `linear` MCP server is available in the agent environment:
* Query task requirements before starting work using `get_issue` (ID: `REV-<number>`).
* Verify acceptance criteria against both the issue description and `../Revamp-docs/milestones.md` before considering a task finished.

### 4.3. Mandatory Ticket Pipeline for Bug Fixes and New Features
Every bug fix and every new feature MUST have its own Linear ticket and MUST go through the full pipeline below: **ticket → code → testing → PR → merge → docs → close ticket**. No step may be skipped, and no code for a bug or feature may reach `main` without a ticket.

1. **Ticket.** Before writing any code, create a ticket in team **REV**, project **Revamp: Lead Generation SaaS (Diploma)** (`save_issue`), or reuse an existing one if it already covers the work.
   * Title: a short, specific summary in English.
   * Description: `## Problem` (observed vs. expected, root cause when known), `## Expected`, and `## Acceptance criteria` as a checklist.
   * Label `Bug` for bug fixes or `Feature` for new features. Assign to the requesting user. Set priority.
   * One ticket per bug or feature. When the user reports several issues at once, create a separate ticket for each.
   * **Read the project documents first.** Before formulating any new ticket, read the documents of the Linear project **Revamp: Lead Generation SaaS (Diploma)** (`get_document`): "Revamp — Current Concept and Decision Log" (current model, decisions, what is deferred), "Revamp — Business Analysis" (scope, epics, user stories, NFR, risks) and, for criteria work, "Revamp — Diploma Topic Application". The ticket must fit the current concept: link the epic (E1–E5) and user story it serves, take acceptance criteria from the story, and do not reintroduce anything listed as deferred (auction, self-serve publishing). If the work contradicts or extends these documents, say so in the ticket and update the documents (or ask the user) before coding.
   * Move the ticket to **In Progress** when work starts.
2. **Code.** Create a branch from an up-to-date `main` following §4.1 (`ymorpheus/rev-<number>-<short-description>`). Plan before coding, on Opus: the plan goes to `docs/superpowers/plans/<date>-rev-<n>-<slug>.md` on the branch and is approved (by the user, or in `/next-task` by the Opus main session that wrote it) before any code. The code is then written on Sonnet by the `implementer` agent from that plan (root `AGENTS.md` §4). Commit with the ticket key (`fix(REV-<n>): ...` / `feat(REV-<n>): ...`). Keep each branch scoped to its ticket; changes unrelated to the ticket go in their own ticket.
3. **Testing.** Add or update Vitest tests per root `AGENTS.md` §3.2.5, then run every gate locally before pushing. GitHub Actions (`.github/workflows/ci.yml`, REV-177) runs the same gates on every PR as the required `Gates` check, but it is a backstop, not a substitute for the local run:
   * `npm run build:packages` (the apps typecheck against the packages' compiled `dist`)
   * `npm run typecheck`
   * `npm run lint` (0 errors, no new warnings)
   * `npm test` (0 failures)
   * `npm run build` (full production build)
   * For behavior changes, also run the app (API, workers, dashboard) and check the change end to end.
   * Before committing, verify the change in Chrome: open the running dashboard, go through the affected flow, and confirm it behaves as expected with no new console errors.
   If any gate fails, fix it before opening the PR. Never open or merge a PR with failing gates, locally or in the PR's `Gates` check.
   * The workflow's `Deploy` job runs only on `main` after `Gates` passes: it builds the production images and runs `deploy/deploy.sh` on the server over SSH, with credentials from the GitHub `production` environment (README, CI/CD). Never put a secret in the workflow or the repository; `deploy/__tests__/ci-workflow.spec.ts` checks the workflow's gates, scripts and secret references, so a change to the workflow updates that test too.
4. **PR.** Push the branch and open a PR with `gh pr create`.
   * Title in the same format as the commit (e.g. `fix(REV-<n>): ...`).
   * The body starts with `Fixes [REV-<n>](<ticket url>)` and has `## Problem`, `## Changes`, and `## Verification` sections. Verification lists the exact commands run and their results.
   * Attach the PR link to the ticket (`save_issue` → `links`) and move the ticket to **In Review**.
   * When a PR depends on another open PR, stack it on that branch and state the merge order in the body.
5. **Merge.** Before merging, pull the latest `main` into the branch (or rebase onto it) and re-run all testing gates from step 3 on the result. Merge only when every gate passes (`gh pr merge --merge`). Merge stacked PRs in order, retargeting each to `main` (`gh pr edit <n> --base main`) before merging it. After merging, pull `main` and run `npm test` once more.
6. **Docs.** After every implemented ticket, bring the documentation up to date so it matches the code on `main`. Check each place the change touches and update it in the same pass:
   * `README.md` in this repository (setup, scripts, environment variables, features, directory layout).
   * `AGENTS.md` in this repository (directory structure, gates, conventions) when the change affects how agents should work, and the area `AGENTS.md` (root §3.3) whose rules the change touches.
   * After editing `../Revamp-docs`, run `npm run docs:index` so `INDEX.md` matches the headings, and commit `INDEX.md` with the docs change.
   * The docs repository `../Revamp-docs` ([revamp-docs](https://github.com/yurykurouski/revamp-docs)): `spec.md` (statuses, endpoints, DTOs, validation rules), `blueprint.md` (queues, schemas, diagrams, storage), `milestones.md` (tick the DoD items the ticket completes), `AGENTS.md` (agent prompts and schemas), and `research.md` when a decision changed.
   * `.env.example` when environment variables were added, renamed, or removed.
   Changes inside this repository go in the ticket's PR. Changes to `../Revamp-docs` are committed there with the ticket key (`docs(REV-<n>): ...`) and pushed, and the commit link is added to the ticket. If nothing needed updating, say so in a ticket comment. A ticket is not done until its docs are current.
7. **Close.** Once the PR is merged, `main` is green, and the docs are updated, move the ticket to **Done**. If the work is abandoned instead, close the PR and move the ticket to **Canceled** with a comment explaining why.

Report the ticket and PR links to the user at each hand-off point.

---

## 5. Pre-Commit Checklist (Definition of Done)

* [ ] Verified against the architecture in `../Revamp-docs/blueprint.md` and requirements in `../Revamp-docs/spec.md`.
* [ ] TypeScript compilation passes without errors: `npm run build` or `npm run typecheck`.
* [ ] Linter passes with no warnings: `npm run lint`.
* [ ] **Automated tests pass with full coverage:** `npm test` runs cleanly with 0 failures and covers all added/modified functionality.
* [ ] **Verified in Chrome:** the change was checked in the running app in Chrome (e.g. via Claude in Chrome) before committing — the affected flow works end to end and the browser console shows no new errors.
* [ ] All public API endpoints validate request payloads via Zod schemas from `packages/validation`.
* [ ] Heavy or asynchronous operations are dispatched through BullMQ queues.
* [ ] External resources (Playwright browser contexts, Redis/Mongo connections) are cleanly closed and managed.
* [ ] The Human-In-The-Loop constraint is strictly preserved.
* [ ] **Docs up to date:** `README.md`, the root and area `AGENTS.md` files, `.env.example`, `../Revamp-docs/INDEX.md` (`npm run docs:index`), and the relevant files in `../Revamp-docs` reflect the change (§4.3 step 6).
