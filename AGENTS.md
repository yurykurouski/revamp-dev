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
├── scripts/             # setup.mjs / dev.mjs (REV-95, plain Node, no deps), maintenance and live-crawl scripts
├── docker-compose.yml   # Containerized services: MongoDB 7.0, Redis 7.0, MinIO + minio-init
├── package.json         # Root npm workspace configuration
├── AGENTS.md            # This instruction file
├── .env.example         # Environment variables template
└── tsconfig.base.json   # Base TypeScript compiler configuration
```

### 3.1.1. Running the Stack Locally (REV-95)
* `npm run setup` (once, idempotent) checks Node 20+ and Docker, installs dependencies and Playwright Chromium, creates `.env` from `.env.example` without overwriting it, starts MongoDB/Redis/MinIO (waits until healthy, runs `minio-init`) and builds the packages.
* `npm run dev` starts the infrastructure, rebuilds stale packages, then runs API, workers and dashboard in one terminal with prefixed output; it refuses to start while port 4000 or 5173 is taken. Ctrl+C stops the apps, not the containers. Use `dev:api` / `dev:workers` / `dev:dashboard` to run one app.
* `scripts/setup.mjs` and `scripts/dev.mjs` run before `npm install`, so they stay plain Node with no dependencies; their logic lives in `scripts/lib/dev-stack.mjs` and is tested in `scripts/__tests__/dev-stack.spec.ts`.

### 3.2. Fundamental Engineering Constraints
1. **Human-In-The-Loop (HITL):**
   * No background worker or agent may dispatch external emails autonomously.
   * The generation pipeline halts at `NEEDS_APPROVAL`. Outreach occurs only after explicit operator review and manual approval in the dashboard (`REV-16`).
2. **Deterministic Metrics (Strict Grounding):**
   * All performance metrics (LCP/CLS, measured in the page as `Audit.webVitals`; no Lighthouse runs, REV-102), accessibility checks (`axe-core`), and business contact data (phone numbers, email addresses, physical addresses) must be extracted by deterministic code (Playwright / DOM parsers).
   * LLMs are strictly prohibited from calculating numerical metrics or hallucinating contact information.
   * The pre-assessment of discovered sites (REV-98) follows the same rule: `apps/workers/src/services/site-assessment.service.ts` fetches each home page once and parses it without running scripts. A new sign goes into `SITE_BAD_SIGNS` / `SITE_COMPLEXITY_SIGNS` (`@revamp/shared-types`), `SiteAssessmentSchema`, the detector, its tests and the five locales. A site that cannot be checked gets `outcome: 'failed'` with its reason, never a verdict.
   * The original site's language (REV-25, REV-116) is read by `extractSiteContentInPage` (`site-content.extractor.ts`), most specific source first: `<html lang>`, then `<meta http-equiv="content-language">`, then a deterministic guess from the page text (stop words and letters, en/ru/be/pl/lt only, cookie banners skipped; too little text, Ukrainian letters or no clear winner give no guess). An empty or malformed tag counts as missing. The source is stored as `extractedContent.languageSource` (`SITE_LANGUAGE_SOURCES`: `html` | `meta` | `text`); the MVP falls back to English only when the language is unknown. Never ask a model for the language.
   * Web standards and SEO checks (`IStandardsChecks`: HTTPS, viewport, title, meta description, a single h1, favicon, Schema.org, OpenGraph; REV-102, REV-118) are read by `readStandardsInDocument` (`apps/workers/src/services/standards.page.ts`, self-contained, attribute values compared in code because happy-dom has no case-insensitive selectors) and scored by `STANDARDS_POINTS` (`@revamp/shared-types`, `STANDARDS_CHECKS` lists them). The audit runs it in the page (`VitalsService`); every MVP publish runs the same reader on the uploaded HTML (`checkMvpStandards`, `mvp-standards.ts`) and stores `MvpProject.standards` (`MvpStandardsSchema`). The MVP's `https` is HTTPS-readiness (the page loads nothing over plain http, its own tracker aside), because serving it over HTTPS depends on hosting; the dashboard shows it in orange and never lists it as fixed or lost. `metaDescription` and `singleH1` are absent on audits made before REV-118, which the dashboard shows as not checked and does not compare by score. A new check goes into the type, `STANDARDS_CHECKS`, the points table (still summing to 100), the reader, the Audit schema, the dashboard labels in all five locales and their tests.
   * The MVP's search and sharing tags (REV-118) are built by `buildMvpSeo` (`apps/workers/src/services/mvp-seo.ts`) from verified data only: the original's meta description (else its first paragraph of at least 50 characters, at most 160), `og:image` (the original's own, else the page's first section background or an image of at least 200 px a side, else the logo), `og:locale` only when the language tag names or implies one region, and a Schema.org `LocalBusiness` from the verified contacts. A tag whose source is missing is left out; no model writes any of it. `finishMvpPage` (`apps/workers/src/services/mvp-page-finish.ts`) writes them into the model's page with `seoHeadTags` (`templates/shared/seo.ts`), replacing any the model wrote.
   * Whether the original home page looks dated is read by code too (REV-114): `Audit.siteEra` (`ISiteEra`: `dated`, `score`, `signs`, `contentWidth`) is the weighted sum of `SITE_DATED_SIGNS` (weight 2: `table_layout`, `no_viewport`, `frames`, `flash`, `narrow_fixed`; weight 1: `legacy_tags`, `default_font`, `old_jquery`, `stale_copyright`), dated from `SITE_DATED_THRESHOLD` 3. `readSiteEra` (`apps/workers/src/services/site-era.service.ts`, pure) takes the REV-98 `parseHomePage` signals of the page the audit already loaded plus the facts `collectEraFactsInPage` (`site-era.page.ts`, self-contained, REV-141) measures on the rendered page: `narrow_fixed` is a median content-block width of at most 1000 px at 1440 px with fewer than half of the blocks full-bleed, and `default_font` reads the body font only; facts it cannot collect leave those two signs out. `siteComplexity` is size, not age, and does not count. A new sign goes into `SITE_DATED_SIGNS`, `SiteEraSchema`, `readSiteEra` and its tests; a site that can't be checked gets `Audit.siteEraError`, never a verdict.
   * The MVP is a page the model designs and writes in full (REV-136 – REV-140): code builds what it may read (`buildMvpSourceBrief`), checks the answer (`checkMvpPage`), flags facts the original does not support (`checkMvpGrounding`) and fills every contact itself (`finishMvpPage`). The section reader, the vision grouping, the rebuild, the modernized level, Bento and the design spec were removed in REV-141; REV-142 documents the page generator's rules here.
   * No mock data or mock providers in runtime code (REV-45). When the API is unreachable, a request fails, or a provider (LLM, Vision, email) is not configured, surface an error or an empty state; never substitute made-up leads, metrics, contacts or "sent" results. Mocks and test doubles live only in test files.
   * A measurement that failed is never replaced by a stand-in value (REV-100): its value is left out, the total is weighted over the measured pillars, and the failure goes into `Audit.measurementErrors` (`AUDIT_MEASUREMENTS`). The Vision critique's templated fallback counts as such a failure (`design`, REV-101): the template is saved for the operator to read but never scored. `Audit.aiFallbackUsed` also covers MVP copy, so read the `design` measurement error, not that flag, to know the critique is a template.
   * The Before / After banner (`ImageService.createComparisonBanner`, attached to outreach) carries measured values only (REV-126): the original's LCP, axe violation count and standards score (`comparableStandardsScore`: only when every check was read), and the published MVP's standards score, read from its HTML before the upload. The MVP's web vitals stay off it, because they are measured on the demo host. A value not measured is left out with nothing in its place, and a missing original screenshot shows "Original screenshot not available", never the MVP.
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
   * Pages are routes (`apps/dashboard/src/routes`, REV-76): add a path to `ROUTES` in `routes/paths.ts` and the route to `APP_ROUTES`; open a lead with `useOpenLead` / `LeadLink` (`/leads/:id`). A lead is reviewed in `LeadReview` (`components/leadReview`, REV-77): steps Audit, Prototype, Email, with the email draft held by the review (`useEmailDraft`) and approval only in `ReviewActionBar` on the email step; keep it that way rather than adding another approve entry point. The home route `/` is the review queue (`ReviewQueuePage`, REV-79): bucket tabs, a list of the bucket's leads and the selected lead's `LeadReview`; its ordering, selection (the selected lead stays listed while a worker moves it to another bucket, `keepSelectedLead`, REV-86), and quick filters (status and score band, REV-80) live in `utils/reviewQueue.ts`. Keyboard shortcuts (REV-47) are defined only in `SHORTCUTS` (`utils/shortcuts.ts`: key, scope, platform modifier, typing and focus rules, checked for conflicts by its tests) and bound with `useShortcuts`; the `?` overlay (`ShortcutsDialog`) lists the registry, so a new shortcut is a registry entry, its handler and a label in all five locales, never a separate `keydown` listener. An element with a shortcut shows it through `KeyCaps` / `ShortcutTitle` (`components/KeyCaps.tsx`, REV-97) and sets `aria-keyshortcuts` from `ariaKeyShortcuts`; never hard-code a key label. The approve shortcut only calls `ReviewActionBar`'s own approve path. The selected lead opens full screen at `/leads/:id` through `useOpenLead` only (Enter, a focused item, or the header's open-full-screen button passed as `LeadReview` `headerActions`, REV-89). The operator changes a model-designed MVP (one with a `theme`, REV-140) only in the floating Design tools panel (`MvpDesignTools` / `useMvpDesignTools`, REV-88), shared by the Prototype step and the full-window preview at `/leads/:id/preview` (REV-91, outside the app shell): the free-text change (`MvpEditPrompt`), colors (`MvpColorControls`: five roles, brand colors first, text contrast checked live against `MVP_MIN_CONTRAST`), fonts (`MvpFontControl`, `MVP_FONT_CHOICES`), versions with Restore (`MvpVersionList`) and Regenerate; an MVP without a `theme` (previous generator) offers Regenerate only. All three actions go through `useMvpPageMutation` (`POST /mvp/:id/edit`, `PATCH /mvp/:id/tokens`, `POST /mvp/:id/versions/:n/restore`), one at a time, with the answer kept per lead and its words from `pageResultText` (`utils/mvpPage.ts`); a new kind of MVP change goes through that path. The preview's version comes from `mvpPreviewVersion` (generation or last change). The Prototype step lists the page's grounding flags (`MvpGroundingFlags`, a warning chip with the count on the Prototype tab); "Show in preview" posts `REVAMP_SHOW_TEXT` to the frame, which the published page's own script (`previewScript`, `finishMvpPage`) scrolls to and outlines. "What changed" (`MvpChangeSummary`, `summarizeMvpChanges`) shows measured facts only: standards, the original's axe violations, LCP/CLS with the MVP's host, and business data kept.
   * Tinted status chips come from the theme: pass `color="warning"` etc. to `Chip` instead of styling its background. New color pairs must keep WCAG AA contrast; `theme.spec.ts` checks it.
7. **One Schema per Collection (REV-48):**
   * Mongoose schemas are defined only in `packages/db` (`@revamp/db`). `apps/api/src/models` and `apps/workers/src/models` only re-export them; never add or change a schema inside an app.
   * Queue names come from `QUEUE_NAMES` in `@revamp/shared-types`.
8. **One Lead State Machine (REV-62):**
   * `LEAD_STATUSES` (`@revamp/shared-types`) lists every lead status; `LEAD_TRANSITIONS`, `canTransition` and `leadStatusesInto` (`@revamp/validation`) define the allowed moves.
   * Every write of `Lead.status` checks the table, normally as an atomic filter (`Lead.findOneAndUpdate({ _id, status: { $in: leadStatusesInto(to) } }, …)`), so stale jobs and late tracking hits never move a lead backwards. Never keep a local list of statuses; add a status or an edge to the table (and its tests) instead.
   * The dashboard maps each status to a Kanban column (`LEAD_STATUS_STAGE`) and a review-queue bucket (`LEAD_STATUS_BUCKET`: Needs you, In progress, Outreach, Closed) in `apps/dashboard/src/utils/leadStages.ts`; a new status must get a column, a bucket, a chip color and a label in all five locales.
9. **One API Error Format (REV-63):**
   * Every API error is `{ success: false, error: { code, message, details? } }`. Routes and services throw `AppError(statusCode, code, message, details?)`; only `errorHandler` writes error JSON. Never call `res.status(4xx/5xx).json(...)` in a route.
   * Codes come from `API_ERROR_CODES` in `@revamp/shared-types`; add a new code there (and to blueprint.md §5) instead of inventing a string. The dashboard reads only `error.code` / `error.message`, through `ApiError` in `apps/dashboard/src/api/client.ts`.
   * The dashboard types API responses as `Serialized<T>` of the shared-types entities (`ILead`, `IAudit`, `IMvpProject`; dates arrive as strings) instead of redeclaring server shapes (REV-67). Mappers read only fields the API returns, with no legacy fallbacks, and a record without an id is a malformed response, never given a made-up id.

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
