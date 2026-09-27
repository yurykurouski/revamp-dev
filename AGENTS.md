# Revamp SaaS — AI Agent Guidelines (AGENTS.md)

This document establishes the operational rules, repository relationships, Linear issue tracker integration, and navigation guidelines for autonomous AI agents and coding assistants (Coding Agents: Antigravity, Cursor, Claude Code, Copilot).

---

## 1. Ecosystem Architecture and Repository Links

The Revamp project consists of two linked repositories and a centralized Linear workspace:

| Resource | Location / Link | Purpose |
|---|---|---|
| **Implementation Repository (Codebase)** | `Revamp-dev` (current repository)<br/>`yurykurouski/Revamp-dev` | Monorepo: API Gateway, BullMQ background workers, React/MUI operator dashboard, shared types and validation packages. |
| **Documentation Repository (Single Source of Truth)** | [yurykurouski/revamp-docs](https://github.com/yurykurouski/revamp-docs)<br/>Local path: `../Revamp-docs` | Complete system, engineering, and product documentation (architecture, specifications, prompts, ADRs, milestones). |
| **Linear Workspace** | [Revamp Linear Workspace](https://linear.app/revamp-proect) | Project management workspace. |
| **Linear Team Overview** | [Team REV Overview](https://linear.app/revamp-proect/team/REV/overview) | **REV** (Revamp) team dashboard, sprints, and backlog. |
| **Linear Project** | [Revamp Project](https://linear.app/revamp-proect/project/revamp-992fa5274adb) | Task roadmap and milestone tracking (`REV-1` ... `REV-20`). |

> [!IMPORTANT]
> **Where Project Documentation Lives:**
> The source documentation for this project is maintained in the [revamp-docs](https://github.com/yurykurouski/revamp-docs) repository. In a local development environment, it is located as a sibling directory: `../Revamp-docs`.
> When implementing any feature, the agent **MUST consult** the relevant documentation files in `../Revamp-docs`.

---

## 2. Documentation Map (`../Revamp-docs`)

Before implementing tasks, refer to the specialized documents in `../Revamp-docs/`:

1. [**`blueprint.md`**](../Revamp-docs/blueprint.md) — **System Architectural Blueprint:**
   * BullMQ queue architecture (`audit-queue`, `ai-gen-queue`, `deploy-queue`, `email-queue`).
   * MongoDB / Mongoose schemas (`Lead`, `AuditResult`, `MvpGeneration`, `EmailCampaign`, `TelemetryEvent`).
   * Interaction diagrams (Sequence & State diagrams), Docker topology, and S3/MinIO storage layout.

2. [**`spec.md`**](../Revamp-docs/spec.md) — **Software Requirements Specification (SRS):**
   * Lead lifecycle (`LeadStatus`: `QUEUED` ➔ `AUDITING` ➔ `AUDITED` ➔ `GENERATING` ➔ `NEEDS_APPROVAL` ➔ `SCHEDULED` ➔ `SENT` ➔ `OPENED` ➔ `CLICKED` ➔ `ENGAGED`, plus `AUDIT_FAILED`, `REJECTED` and `UNSUBSCRIBED`; the allowed transitions are `LEAD_TRANSITIONS` in `@revamp/validation`, see §3.2.8).
   * REST API endpoint specifications (request/response DTOs, status codes, validation rules).
   * Non-functional requirements (timeouts, Playwright memory thresholds, security policies).

3. [**`research.md`**](../Revamp-docs/research.md) — **Research and Architectural Decision Records (ADR):**
   * Technology stack selection (Playwright vs. Puppeteer, MongoDB vs. PostgreSQL, BullMQ vs. Temporal).
   * Customer Journey Maps (CJM) for operator and target business owner.
   * Competitive analysis and rationale behind key architectural decisions.

4. [**`milestones.md`**](../Revamp-docs/milestones.md) — **Implementation Roadmap:**
   * 4-week sprint schedule (28 days) aligned with Linear issues (`REV-5` ... `REV-20`).
   * Definition of Done (DoD) checklists for each development milestone.

5. [**`AGENTS.md`** (in `Revamp-docs`)](../Revamp-docs/AGENTS.md) — **AI System Instructions and Prompts:**
   * System prompts and Zod validation schemas for embedded SaaS agents:
     - `DesignCritiqueAgent` (Vision LLM, above-the-fold analysis, Critical Flaws & Quick Wins).
     - `MvpContentAgent` (Bento landing page copywriting, Strict Grounding).
     - `OutreachPersonalizerAgent` (hyper-personalized B2B cold email generation).
   * Fault tolerance policies (Fallbacks) and token usage budgets.

---

## 3. Monorepo Development Guidelines (`Revamp-dev`)

### 3.1. Monorepo Directory Structure
```
Revamp-dev/
├── apps/
│   ├── api/             # Express.js REST API Gateway (Node.js + TypeScript)
│   ├── workers/         # BullMQ background workers (Playwright, AI, Deploy, Email)
│   └── dashboard/       # Operator frontend (React 18+, Material UI v6, Vite, Zustand)
├── packages/
│   ├── shared-types/    # Shared interfaces, enums, DTOs and queue names across the monorepo
│   ├── validation/      # Shared Zod validation schemas (API and frontend forms)
│   └── db/              # Mongoose models shared by the API and workers (REV-48)
├── docker-compose.yml   # Containerized services: MongoDB 7.0, Redis 7.0, MinIO + minio-init
├── package.json         # Root npm workspace configuration
├── AGENTS.md            # This instruction file
├── .env.example         # Environment variables template
└── tsconfig.base.json   # Base TypeScript compiler configuration
```

### 3.2. Fundamental Engineering Constraints
1. **Human-In-The-Loop (HITL):**
   * No background worker or agent may dispatch external emails autonomously.
   * The generation pipeline halts at `NEEDS_APPROVAL`. Outreach occurs only after explicit operator review and manual approval in the dashboard (`REV-16`).
2. **Deterministic Metrics (Strict Grounding):**
   * All performance metrics (Lighthouse LCP/CLS), accessibility checks (`axe-core`), and business contact data (phone numbers, email addresses, physical addresses) must be extracted by deterministic code (Playwright / DOM parsers).
   * LLMs are strictly prohibited from calculating numerical metrics or hallucinating contact information.
   * No mock data or mock providers in runtime code (REV-45). When the API is unreachable, a request fails, or a provider (LLM, Vision, email) is not configured, surface an error or an empty state; never substitute made-up leads, metrics, contacts or "sent" results. Mocks and test doubles live only in test files.
3. **Sandboxed MVP Hosting:**
   * Generated MVPs are hosted as static HTML+CSS bundles in an isolated S3/MinIO bucket (`revamp-demos`).
   * Inside the dashboard, previews must be embedded exclusively through `<iframe sandbox="allow-scripts allow-same-origin">`.
4. **Strict Schema Validation (Zod):**
   * All LLM responses and incoming HTTP request payloads must be validated using Zod schemas from `@revamp/validation` before persisting or processing.
5. **Mandatory Test Coverage (Testing Policy):**
   * All new or modified functionality, endpoints, services, background workers, and validation schemas MUST be covered with automated tests using Vitest.
   * Testing must span all core layers:
     - **Validation & Schemas:** Test valid cases, invalid inputs, edge cases, and boundary limits.
     - **Middleware & Services:** Test error handlers, request validation, business operations, and database persistence.
     - **API Endpoints:** Test HTTP status codes (200, 201, 400, 404, 500), payload structures, and error responses.
     - **Workers & Queues:** Test job payload handling, state transitions, and error recovery.
     - **Frontend Stores:** Test Zustand state transitions, filter mutations, and reset actions.
   * All test suites must execute and pass cleanly (`npm test`) with 0 failures prior to submitting any task.
6. **Dashboard Styling (REV-49):**
   * Colors, radii, typography and component overrides live in the MUI theme (`apps/dashboard/src/theme/theme.ts`, `TOKENS` for dark and light). Components use theme tokens (`text.secondary`, `warning.soft`, `stage.sent`, `border.subtle`, …), never hard-coded hex or rgba values.
   * Tinted status chips come from the theme: pass `color="warning"` etc. to `Chip` instead of styling its background. New color pairs must keep WCAG AA contrast; `theme.spec.ts` checks it.
7. **One Schema per Collection (REV-48):**
   * Mongoose schemas are defined only in `packages/db` (`@revamp/db`). `apps/api/src/models` and `apps/workers/src/models` only re-export them; never add or change a schema inside an app.
   * Queue names come from `QUEUE_NAMES` in `@revamp/shared-types`.
8. **One Lead State Machine (REV-62):**
   * `LEAD_STATUSES` (`@revamp/shared-types`) lists every lead status; `LEAD_TRANSITIONS`, `canTransition` and `leadStatusesInto` (`@revamp/validation`) define the allowed moves.
   * Every write of `Lead.status` checks the table, normally as an atomic filter (`Lead.findOneAndUpdate({ _id, status: { $in: leadStatusesInto(to) } }, …)`), so stale jobs and late tracking hits never move a lead backwards. Never keep a local list of statuses; add a status or an edge to the table (and its tests) instead.
   * The dashboard maps each status to a Kanban column in `apps/dashboard/src/utils/leadStages.ts`; a new status must get a column, a chip color and a label in all five locales.
9. **One API Error Format (REV-63):**
   * Every API error is `{ success: false, error: { code, message, details? } }`. Routes and services throw `AppError(statusCode, code, message, details?)`; only `errorHandler` writes error JSON. Never call `res.status(4xx/5xx).json(...)` in a route.
   * Codes come from `API_ERROR_CODES` in `@revamp/shared-types`; add a new code there (and to blueprint.md §5) instead of inventing a string. The dashboard reads only `error.code` / `error.message`, through `ApiError` in `apps/dashboard/src/api/client.ts`.

---

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
* Verify acceptance criteria against both the issue description and [`milestones.md`](file:///Users/yurykurouski/code/ehu/Revamp-docs/milestones.md) before considering a task finished.

### 4.3. Mandatory Ticket Pipeline for Bug Fixes and New Features
Every bug fix and every new feature MUST have its own Linear ticket and MUST go through the full pipeline below: **ticket → code → testing → PR → merge → docs → close ticket**. No step may be skipped, and no code for a bug or feature may reach `main` without a ticket.

1. **Ticket.** Before writing any code, create a ticket in team **REV**, project **Revamp** (`save_issue`), or reuse an existing one if it already covers the work.
   * Title: a short, specific summary in English.
   * Description: `## Problem` (observed vs. expected, root cause when known), `## Expected`, and `## Acceptance criteria` as a checklist.
   * Label `Bug` for bug fixes or `Feature` for new features. Assign to the requesting user. Set priority.
   * One ticket per bug or feature. When the user reports several issues at once, create a separate ticket for each.
   * Move the ticket to **In Progress** when work starts.
2. **Code.** Create a branch from an up-to-date `main` following §4.1 (`ymorpheus/rev-<number>-<short-description>`). Commit with the ticket key (`fix(REV-<n>): ...` / `feat(REV-<n>): ...`). Keep each branch scoped to its ticket; changes unrelated to the ticket go in their own ticket.
3. **Testing.** Add or update Vitest tests per §3.2.5, then run every gate locally. The repository has no CI, so this local run is the gate:
   * `npm run build:packages` (the apps typecheck against the packages' compiled `dist`)
   * `npm run typecheck`
   * `npm run lint` (0 errors, no new warnings)
   * `npm test` (0 failures)
   * `npm run build` (full production build)
   * For behavior changes, also run the app (API, workers, dashboard) and check the change end to end.
   * Before committing, verify the change in Chrome: open the running dashboard, go through the affected flow, and confirm it behaves as expected with no new console errors.
   If any gate fails, fix it before opening the PR. Never open or merge a PR with failing gates.
4. **PR.** Push the branch and open a PR with `gh pr create`.
   * Title in the same format as the commit (e.g. `fix(REV-<n>): ...`).
   * The body starts with `Fixes [REV-<n>](<ticket url>)` and has `## Problem`, `## Changes`, and `## Verification` sections. Verification lists the exact commands run and their results.
   * Attach the PR link to the ticket (`save_issue` → `links`) and move the ticket to **In Review**.
   * When a PR depends on another open PR, stack it on that branch and state the merge order in the body.
5. **Merge.** Before merging, pull the latest `main` into the branch (or rebase onto it) and re-run all testing gates from step 3 on the result. Merge only when every gate passes (`gh pr merge --merge`). Merge stacked PRs in order, retargeting each to `main` (`gh pr edit <n> --base main`) before merging it. After merging, pull `main` and run `npm test` once more.
6. **Docs.** After every implemented ticket, bring the documentation up to date so it matches the code on `main`. Check each place the change touches and update it in the same pass:
   * `README.md` in this repository (setup, scripts, environment variables, features, directory layout).
   * `AGENTS.md` in this repository (directory structure, gates, conventions) when the change affects how agents should work.
   * The docs repository `../Revamp-docs` ([revamp-docs](https://github.com/yurykurouski/revamp-docs)): `spec.md` (statuses, endpoints, DTOs, validation rules), `blueprint.md` (queues, schemas, diagrams, storage), `milestones.md` (tick the DoD items the ticket completes), `AGENTS.md` (agent prompts and schemas), and `research.md` when a decision changed.
   * `.env.example` when environment variables were added, renamed, or removed.
   Changes inside this repository go in the ticket's PR. Changes to `../Revamp-docs` are committed there with the ticket key (`docs(REV-<n>): ...`) and pushed, and the commit link is added to the ticket. If nothing needed updating, say so in a ticket comment. A ticket is not done until its docs are current.
7. **Close.** Once the PR is merged, `main` is green, and the docs are updated, move the ticket to **Done**. If the work is abandoned instead, close the PR and move the ticket to **Canceled** with a comment explaining why.

Report the ticket and PR links to the user at each hand-off point.

---

## 5. Pre-Commit Checklist (Definition of Done)

* [ ] Verified against the architecture in [blueprint.md](file:///Users/yurykurouski/code/ehu/Revamp-docs/blueprint.md) and requirements in [spec.md](file:///Users/yurykurouski/code/ehu/Revamp-docs/spec.md).
* [ ] TypeScript compilation passes without errors: `npm run build` or `npm run typecheck`.
* [ ] Linter passes with no warnings: `npm run lint`.
* [ ] **Automated tests pass with full coverage:** `npm test` runs cleanly with 0 failures and covers all added/modified functionality.
* [ ] **Verified in Chrome:** the change was checked in the running app in Chrome (e.g. via Claude in Chrome) before committing — the affected flow works end to end and the browser console shows no new errors.
* [ ] All public API endpoints validate request payloads via Zod schemas from `packages/validation`.
* [ ] Heavy or asynchronous operations are dispatched through BullMQ queues.
* [ ] External resources (Playwright browser contexts, Redis/Mongo connections) are cleanly closed and managed.
* [ ] The Human-In-The-Loop constraint is strictly preserved.
* [ ] **Docs up to date:** `README.md`, `AGENTS.md`, `.env.example`, and the relevant files in `../Revamp-docs` reflect the change (§4.3 step 6).
