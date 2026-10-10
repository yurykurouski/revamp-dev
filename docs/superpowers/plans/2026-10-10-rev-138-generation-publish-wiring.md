# REV-138 Generation and publish wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Generate MVP" runs the new pipeline end to end: the ai-gen worker builds the brief and asks `MvpPageGenerator` for the page; the deploy worker finishes, uploads and measures it, stores the raw page as a version, and moves the lead to `NEEDS_APPROVAL`. A page the model cannot make fails the generation for good with a coded reason.

**Architecture:** The model's raw page travels from the ai-gen job to the deploy job in the job data (at most 300 KB), so nothing half-made is ever stored. The deploy job writes the published `index.html`, the raw page as `v/<slug>/versions/<n>.html`, and the `MvpProject` in one update. The old rebuild/Bento code stays in place (removed in REV-141) but is no longer reached by a generation; its relayout and free-text change paths refuse a model-designed MVP until REV-139 replaces them.

**Tech Stack:** TypeScript, BullMQ, Mongoose, S3/MinIO (`@aws-sdk/client-s3`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md` §3, §5, §6 (`POST /mvp/generate`). Ticket [REV-138](https://linear.app/revamp-proect/issue/REV-138). Builds on REV-136 (brief, checks, finishing) and REV-137 (generator).

## Global Constraints

- Branch `ymorpheus/rev-138-page-generation-wire-generation-and-publish-workers` (exists). Commits `feat(REV-138): …` / `fix(REV-138): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests from the repo root: `npx vitest run <path>`; `.spec.ts` only. `npm run build:packages` after package changes.
- New Mongo fields must be declared in `packages/db` (strict mode drops undeclared fields).
- Every `Lead.status` write keeps the `leadStatusesInto` filter (AGENTS.md §3.2.8). HITL unchanged: the job stops at `NEEDS_APPROVAL`.
- `MVP_MAX_VERSIONS = 20`. Version kinds: `generate` | `change` | `controls` | `restore`.
- Failure code `MVP_PAGE_UNAVAILABLE` with reason in `MVP_PAGE_FAILURES`.

## Decisions this plan makes (deviations from the ticket text are marked)

1. **Old fields stay in the schema until REV-141** *(ticket: "dropped from the schema")*: `relayout`, the free-text change worker, the API routes and the dashboard still read them; dropping them now breaks those before REV-139/140/141 replace them. `generatedContent` and `colorPalette` become optional. A new generation `$unset`s every old field on its record, so a model-designed MVP never carries a stale rebuild, layout or design.
2. **`POST /mvp/generate` keeps accepting `layout`** *(ticket: removed)* but the new worker ignores it; the field and its dashboard action ("Generate with a template layout") go together in REV-140, so the dashboard keeps working in between.
3. **The raw page rides in the deploy job data**, not in the database between jobs.
4. **A regeneration clears the operator's `controls`** (palette/font picks were made for the previous design) and starts the version list's next number after the highest stored one; old versions stay restorable (REV-139).
5. **Old paths refuse a model-designed MVP**: `republishSavedMvp` (relayout) and the `mvp-edit` worker throw a clear `Error` when the project has `page` (the published page stays). REV-139 replaces them.
6. **The generator is created lazily** (`defaultPageGenerator()`), not at import (REV-137 review).
7. **BullMQ lock:** a job may take up to 2 × 300 s; BullMQ renews the lock while the job runs (`lockDuration` stays default), so only the CLI timeout matters, and REV-137 already passes 300 s to it per call.
8. **Screenshot:** the audit's full desktop capture (`screenshotUrls.desktopFull`), fetched over HTTP like the deploy fetches the mobile one; a missing or failed fetch means a text-only call, never a failure.

## Review Focus

1. A lead rejected while the model is working must not be moved to `NEEDS_APPROVAL` or have its MVP replaced. (Task 4)
2. A job retried by BullMQ after the upload succeeded but before the Mongo write must not leave two versions with the same number or orphan the version file. (Task 4)
3. A regeneration over an old Bento/rebuild MVP must leave no stale `layout`, `rebuild`, `design`, `rebuildEdit`, `modernize` or `renderFailure` on the record. (Task 4)
4. The 21st version must delete version 1's file from storage, and a failed delete must not fail the publish. (Tasks 2, 4)
5. A provider error that is final (`not_configured`, `invalid_page`) must not be retried by BullMQ; `call_failed` may be (one more job attempt), then fails for good. (Task 3)

---

### Task 1: Types, schemas and the db model

**Files:** `packages/shared-types/src/index.ts`, `packages/validation/src/index.ts`, `packages/db/src/models/MvpProject.model.ts`; tests `packages/validation/__tests__/mvp-page.spec.ts`, `packages/db/__tests__/models.spec.ts`

**Produces:**
```ts
// shared-types
MVP_RENDER_FAILURE_CODES = ['MVP_REBUILD_UNAVAILABLE', 'MVP_MODERNIZE_UNAVAILABLE', 'MVP_PAGE_UNAVAILABLE']
IMvpRenderFailure.reason: RebuildUnavailableReason | ModernizeFailure | MvpPageFailure
export const MVP_MAX_VERSIONS = 20;
export const MVP_PAGE_VERSION_KINDS = ['generate', 'change', 'controls', 'restore'] as const;
export interface IMvpPageVersion { n: number; kind: MvpPageVersionKind; instruction?: string; provider?: string; model?: string; storagePath: string; createdAt: string | Date }
IMvpProject += page?: string; theme?: IMvpTheme; controls?: Partial<IMvpTheme>; grounding?: IMvpGroundingFlag[]; versions?: IMvpPageVersion[]
IMvpProject.generatedContent and colorPalette become optional
export interface IMvpPageJob { html: string; theme: IMvpTheme; grounding: IMvpGroundingFlag[]; kind: MvpPageVersionKind; instruction?: string }
IDeployJobData += page?: IMvpPageJob
// validation
MvpRenderFailureSchema += { code: 'MVP_PAGE_UNAVAILABLE', reason: z.enum(MVP_PAGE_FAILURES), message?, at }
MvpPageVersionSchema
```
db: `page: String`, `theme`, `controls`, `grounding`, `versions` (Mixed), `generatedContent` and `colorPalette.*` no longer `required`.

- [ ] **Step 1:** Move REV-138 to **In Progress**. Failing tests: `MvpRenderFailureSchema` accepts `{ code: 'MVP_PAGE_UNAVAILABLE', reason: 'invalid_page', at }`, rejects reason `'grouping:call_failed'` with that code; `MvpPageVersionSchema` accepts a full entry, rejects kind `'edit'` and `n: 0`; db model validates a project without `generatedContent`/`colorPalette` and keeps `page`, `theme`, `controls`, `grounding`, `versions` (same style as the existing models test).
- [ ] **Step 2:** Run both test files → FAIL.
- [ ] **Step 3:** Implement; `npm run build:packages`; `npm run typecheck` (fix every place that now sees optional `generatedContent`/`colorPalette` with the narrowest change).
- [ ] **Step 4:** Tests → PASS. **Commit** `feat(REV-138): page versions and the page failure in types, schemas and the model`

### Task 2: Storage for page versions

**Files:** `apps/workers/src/services/storage.service.ts`; test `apps/workers/src/services/__tests__/storage.service.spec.ts`

**Produces:** `uploadPageVersion(slug: string, n: number, html: string): Promise<string>` (key `v/<slug>/versions/<n>.html`, `text/html; charset=utf-8`, demos bucket, returns the key) and `deleteObject(key: string, bucket?: string): Promise<void>`.

- [ ] **Step 1:** Failing tests with the existing mocked client: the PutObject key/content type/bucket; `deleteObject` sends `DeleteObjectCommand` with bucket and key.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Commit** `feat(REV-138): store page versions`

### Task 3: AI worker on the generator

**Files:** `apps/workers/src/workers/ai.worker.ts`, `apps/workers/src/services/mvp-page-generator.ts` (lazy getter), `apps/workers/src/workers/generation-failure.ts` (no change expected; verify the failure is recorded); test `apps/workers/src/workers/__tests__/ai.worker.spec.ts`

**Consumes:** `buildMvpSourceBrief`, `MvpPageGenerator`, `defaultPageGenerator()`, `addDeployJob`.
**Produces:** `export function defaultPageGenerator(): MvpPageGenerator` (memoized; replaces the `mvpPageGenerator` const); `export class MvpPageUnavailableError extends UnrecoverableError { failure: IMvpRenderFailure }` in `ai.worker.ts` (or a small `page-failure.ts`).

Flow: lead + audit as today → `GENERATING` as today → brief → screenshot (decision 8) → `generate` with the job's provider/model (`new MvpPageGenerator({ provider, model })` when picked, else the default) → on `ok:false`: `call_failed` throws a plain `Error` (BullMQ's retry), `not_configured`/`invalid_page` throw `MvpPageUnavailableError` with `{ code: 'MVP_PAGE_UNAVAILABLE', reason, message, at }` → on success `addDeployJob({ leadId, auditId, forceRegenerate, previousStatus, page: { html, theme, grounding, kind: 'generate' }, generationSource: { provider, modelUsed, requested… } })`. `mvpContentService` is no longer called; `Audit.generatedContent` is no longer written.

- [ ] **Step 1:** Replace the content-service tests with failing ones (mock `mvp-page-generator.js`): success dispatches a deploy job carrying the page and the source; the brief has no contact values; the screenshot is fetched from `desktopFull` and passed; a fetch failure still generates text-only; `invalid_page` throws an error with `name === 'UnrecoverableError'` and the failure; `not_configured` likewise; `call_failed` throws a plain error; the operator's provider/model builds a dedicated generator; a lead that cannot move to `GENERATING` is skipped with no model call. Plus `handleGenerationFailure` with this error stores `generationFailure.code === 'MVP_PAGE_UNAVAILABLE'` (generation-failure.spec).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Commit** `feat(REV-138): the ai worker asks the model for the page`

### Task 4: Deploy worker publishes the page

**Files:** `apps/workers/src/workers/deploy.worker.ts` (new `deployPage`, guard in `republishSavedMvp`), `apps/workers/src/workers/mvp-edit.worker.ts` (guard); tests `apps/workers/src/workers/__tests__/deploy.worker.spec.ts`, `mvp-edit.worker.spec.ts`

**Consumes:** `finishMvpPage`, `verifiedContacts`, `buildMvpSeo`, `publishMvp` (existing), `checkMvpStandards`/`publishedStandards`, `mvpCompletenessService.assess`, `measureMvpPerformance`, `uploadPageVersion`, `deleteObject`.

`deployPage(job)` when `job.data.page` is set (the old `deployMvp` stays for jobs without it):
1. lead, audit, slug as today; the existing project's `versions`.
2. `n = max(n) + 1` (1 when none). Upload the raw page as version `n` first, then finish (`finishMvpPage` with verified contacts, `buildMvpSeo` from the audit as REV-137's script does, logo, `theme`, no controls on a generation), standards, `publishMvp` (index + banner), completeness, performance.
3. One `findOneAndUpdate`: `$set` page, theme, grounding, standards, performance, completenessReport, URLs, auditId, generatedAt, isPublished, source; `$push: { versions: { $each: [entry], $slice: -MVP_MAX_VERSIONS } }`; `$inc generationCount`; `$unset` generatedContent, colorPalette, layout, design, rebuild, rebuildEdit, modernize, renderFailure, controls, editedAt, and requestedProvider/Model when not picked.
4. Delete the files of versions that fell off (computed from the versions read in step 1); a failed delete is logged, never thrown.
5. Audit banner URL and the lead update exactly as today (`leadStatusesInto('NEEDS_APPROVAL')`, unset generationError/generationFailure).
6. Retry safety (Review Focus 2): before uploading, if a version with this job's id already exists (`entry.jobId = job.id`), reuse its number and file instead of adding one.

Guards: `republishSavedMvp` and the `mvp-edit` worker throw `Error('This MVP was designed by the model: the layout and design tools do not apply to it')` when the project has `page`; the published page stays.

- [ ] **Step 1:** Failing tests (existing mocks): a page job uploads version 1 then the finished index, writes one update with the fields above and the `$unset` list, moves the lead to review; a 21st version pushes with `$slice: -20` and deletes version 1's key; a failing delete still publishes; a job id already in `versions` reuses its number (no second push); a lead rejected meanwhile is left as is (update filter); relayout and edit refuse a project with `page`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Commit** `feat(REV-138): the deploy worker publishes the model's page as a version`

### Task 5: Real-browser check of a finished page

**Files:** test `apps/workers/src/services/__tests__/mvp-page-finish.browser.spec.ts`

- [ ] **Step 1:** Load `finishMvpPage(VALID, ctx with publicApiUrl)` in Chromium (`page.setContent`, every request intercepted and aborted after recording its URL). Assert: no `pageerror`; every requested URL's origin is in {fonts.googleapis.com, fonts.gstatic.com, falco-dent.pl, the tracker's origin}; no `alert`/dialog. Run it; it passes on the current code (it guards regressions, so record in the ledger that it was not written RED).
- [ ] **Step 2: Commit** `test(REV-138): a finished page runs only its own scripts and loads only allowed hosts`

### Task 6: End to end, Chrome, gates, PR

- [ ] Start the stack (`npm run dev`), add a fresh lead by URL in the dashboard (Add lead), wait for the audit, click Generate MVP. Check: the lead reaches Needs approval; the preview iframe shows the model's page; `MvpProject` has `page`, `theme`, `grounding`, `versions[0]` and no old fields; `v/<slug>/versions/1.html` exists. Never approve or send.
- [ ] Chrome check of that flow (Prototype step renders the page, no new console errors). If the chrome-devtools MCP is unavailable, say so and use Playwright screenshots instead.
- [ ] Gates: `npm run build:packages`, `typecheck`, `lint`, `test`, `build`.
- [ ] Push, `gh pr create` (`feat(REV-138): …`, `Fixes [REV-138](…)`, Problem/Changes/Verification), link on the ticket, **In Review**; merge per §4.3 step 5; **Done**.
