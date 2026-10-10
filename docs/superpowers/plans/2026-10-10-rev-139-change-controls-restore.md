# REV-139 Changes, controls and restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator can change a model-designed MVP in their own words, set its colors and fonts without a model call, and restore an earlier version. Each of these publishes the page again, or publishes nothing and says why.

**Architecture:** The three actions run in one queue: `mvp-edit` is renamed `mvp-page`, with concurrency 1. The API waits for each job's result, as the free-text change does today. A change asks `MvpPageGenerator.change` for a whole new page. Controls re-finish the stored raw page with new `controls`. A restore re-reads version *n*'s raw page from storage and re-checks it against the current brief. All three publish through the same steps the generation deploy uses, extracted from `deployPage` into `mvp-page-publish.ts`. The old Bento/rebuild edit, layout and design paths stop being reachable from the API. Their code is deleted in REV-141.

**Tech Stack:** TypeScript, Express, BullMQ, Mongoose, S3/MinIO, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md` §5, §6. Ticket [REV-139](https://linear.app/revamp-proect/issue/REV-139). Builds on REV-136 (`finishMvpPage`, `checkMvpPage`), REV-137 (`MvpPageGenerator.change`) and REV-138 (`deployPage`, versions).

## Global Constraints

- **Branch and commits:**
  - Branch: `ymorpheus/rev-139-page-generation-free-text-change-palettefont-controls-and`, from an up-to-date `main`.
  - Commits: `feat(REV-139): …` / `fix(REV-139): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run tests from the repo root with `npx vitest run <path>`; only `.spec.ts` files run. Run `npm run build:packages` after package changes.
- New Mongo fields must be declared in `packages/db`, because strict mode drops undeclared fields.
- **API errors:** errors go through `AppError` only. New codes go in `API_ERROR_CODES` and blueprint.md §5. Request bodies are validated by Zod schemas from `@revamp/validation`.
- **When a change is allowed:** only while `canChangeMvpLayout(lead.status)` holds (HITL). This is checked at the start of each action and again right before publishing.
- **Contrast and fonts:**
  - Colors must meet WCAG AA, a contrast ratio of at least 4.5:1: text on bg, and text on surface.
  - Fonts must come from `MVP_FONT_CHOICES`, a fixed list of Google Fonts pairings.
- No test calls a live model.

## Decisions this plan makes (deviations from the spec are marked)

1. **All three actions run in the `mvp-page` queue, and the API waits for the result** *(spec: controls and restore "queue a deploy-only job")*.
   - With one queue at concurrency 1, two publishes of the same MVP can never interleave. That rules out two versions with the same number, a version file overwritten, or one action's `page` written over another's.
   - The operator also gets a failure right away (contrast, an unusable version) instead of a page that silently stays.
   - **Cost:** one operator's change can wait behind another's model call. Each job carries its deadline, so a job that waited too long is dropped, never applied late.
2. **A controls change makes no version** *(spec lists a `controls` kind)*.
   - A version is a raw page, and controls are not part of the raw page. The spec has a restore use the *current* controls, so a `controls` version would only copy the page above it.
   - `controls` is removed from `MVP_PAGE_VERSION_KINDS`, which become `generate` | `change` | `restore`.
   - A restore records `from: n` on its version.
3. **The tokens body can also clear controls.** Either group may be `null`, which goes back to the model's own theme. Either group may be left out, which keeps it as it is. At least one group must be given.
4. **Restoring a version re-checks it against the current brief.** It runs `checkMvpPage(raw, brief)`, which gives the theme, and `checkMvpGrounding`.
   - A version whose placeholders or images the current audit no longer supports is refused: 409 `MVP_VERSION_UNUSABLE`, with the problems listed. This is the "stale contacts" case.
5. **Nothing changed means no publish.** A change whose page equals the current one, controls equal to the saved ones, or restoring the current page answer `applied: false, reason: 'unchanged'` with 200. Nothing is published or counted.
6. **The change waits up to 7 min** (`MVP_PAGE_CHANGE_WAIT_MS = 420_000`). Controls and restore wait up to 2 min (`MVP_PAGE_PUBLISH_WAIT_MS = 120_000`).
   - The generator gets a `deadline`: each call's timeout is the smaller of 300 s and the time left. When no time is left, it stops with `call_failed`.
   - The worker gives it the job's deadline minus a `PUBLISH_MARGIN_MS = 90_000` reserve for publishing.
7. **MVPs from the previous generator are refused.** A record without `page` gets 409 `MVP_PREVIOUS_GENERATOR` from edit, tokens and restore; only Regenerate applies to it (spec §5).
   - `PATCH /mvp/:id/layout` and `DELETE /mvp/:id/design` are deleted, so they answer 404.
   - `MVP_MODEL_DESIGNED` is removed from `API_ERROR_CODES`. The worker-side `MODEL_DESIGNED_REFUSAL` in `republishSavedMvp` stays until REV-141.
8. **`finishMvpPage` validates controls itself.** Each key goes through `MvpThemeControlsSchema`'s field rule, and an invalid value is dropped, never written into CSS. A font control uses its pairing's generic family (`serif` / `sans-serif`) as the fallback.
9. **The dashboard keeps compiling but is not reworked.** Its palette picker sends the old body (400), and its layout and reset calls get 404 until REV-140 replaces them. Its `IMvpEditResult` type follows the renamed job result.
10. **Docs:** blueprint.md §5 gets the new codes in this ticket. The rest of the documentation is REV-142, as for REV-136 … REV-138.

## Review Focus

1. A change whose model answer arrives after the API stopped waiting must publish nothing. (Task 4)
2. A lead that went to `GENERATING` (Regenerate) or `SCHEDULED` while a change ran must keep its page. (Task 4)
3. Restoring a version that uses `{{hours}}` when the current audit has no hours must answer 409 with the problem and publish nothing. (Tasks 4, 5)
4. Contrast exactly at the boundary: `#767676` on `#ffffff` (4.54) passes, and `#777777` on `#ffffff` (4.48) fails. (Task 1)
5. A version file missing from storage must fail the restore with a message (502) and leave the page as it is. (Task 4)

---

### Task 1: Types, schemas and codes

**Files:**
- Modify: `packages/shared-types/src/index.ts`, `packages/validation/src/index.ts`, `packages/db/src/models/MvpProject.model.ts`
- Test: `packages/validation/src/__tests__/` (the existing MVP schema spec), `packages/db/src/__tests__/models.spec.ts`

**Interfaces — Produces:**
- `MVP_FONT_CHOICES: readonly { id: string; heading: string; body: string; headingGeneric: 'serif' | 'sans-serif'; bodyGeneric: 'serif' | 'sans-serif' }[]`. There are 6 pairings, every name matching `^[A-Za-z0-9 ]{1,40}$`:
  - `classic`: Playfair Display / Source Sans 3
  - `modern`: Poppins / Inter
  - `friendly`: Nunito / Open Sans
  - `editorial`: Lora / Lato
  - `bold`: Montserrat / Roboto
  - `elegant`: DM Serif Display / DM Sans
- `MVP_PAGE_VERSION_KINDS = ['generate', 'change', 'restore']`; `IMvpPageVersion.from?: number`.
- `QUEUE_NAMES.MVP_PAGE = 'mvp-page-queue'`, replacing `MVP_EDIT`.
- `MVP_PAGE_ACTIONS = ['change', 'controls', 'restore'] as const`; `MvpPageAction`.
- `IMvpControlsUpdate = { colors?: { primary; accent; bg; surface; text } | null; fonts?: { heading; body } | null }`.
- `IMvpPageJobData = { mvpProjectId: string; action: MvpPageAction; instruction?: string; controls?: IMvpControlsUpdate; version?: number; deadline: number }`. It replaces `IMvpEditJobData`.
- `IMvpPageJobResult`, which replaces `IMvpEditJobResult` and `MvpEditChange`:
  - `{ applied: true; version?: number }`
  - `{ applied: false; reason: 'unchanged' }`
  - `{ applied: false; reason: MvpPageFailure | 'unusable_version'; message: string; problems?: IMvpPageProblem[] }`
- `API_ERROR_CODES`:
  - add `MVP_PREVIOUS_GENERATOR`, `MVP_VERSION_NOT_FOUND`, `MVP_VERSION_UNUSABLE`
  - remove `MVP_MODEL_DESIGNED`, `MVP_LAYOUT_CHANGE_NOT_ALLOWED`, `MVP_REBUILD_UNAVAILABLE` and `MVP_MODERNIZE_UNAVAILABLE`, but only those of the last three that nothing outside the deleted routes still uses (check with grep)
- `contrastRatio(a: string, b: string): number` (hex `#rrggbb`, WCAG 2.x), exported from `@revamp/validation`. `MVP_MIN_CONTRAST = 4.5`.
- `UpdateMvpTokensSchema`, which replaces the old one:
  - strict object `{ colors?: {5 × mvpHex} | null, fonts?: { heading, body } | null }`
  - refine: at least one key present
  - refine `colors`: `contrastRatio(text, bg) >= 4.5 && contrastRatio(text, surface) >= 4.5`, else an issue at path `['colors', 'text']`
  - refine `fonts`: the pair equals one entry of `MVP_FONT_CHOICES`, else an issue at `['fonts']`
- `MvpVersionParamsSchema = z.object({ n: z.coerce.number().int().min(1) })`.

- [ ] **Step 1: Write the failing tests.** In the validation spec:
  - `contrastRatio('#767676', '#ffffff')` ≈ 4.54, and `contrastRatio('#777777', '#ffffff')` < 4.5.
  - `UpdateMvpTokensSchema` accepts `{ colors: {primary:'#0a5c8a', accent:'#f2a900', bg:'#ffffff', surface:'#f5f7fa', text:'#767676'} }`.
  - It rejects the same with `text: '#777777'`, with the issue path `colors.text`.
  - It rejects `surface: '#888888'` with dark text, because of the surface contrast.
  - It accepts `{ fonts: { heading: 'Lora', body: 'Lato' } }` and rejects `{ fonts: { heading: 'Lora', body: 'Inter' } }`.
  - It accepts `{ colors: null }` and rejects `{}`.
  - It rejects an unknown key such as `{ primaryColor: '#000000' }`.
  - `MvpPageVersionSchema` rejects `kind: 'controls'` and accepts `{…, kind: 'restore', from: 3}`.
  - `MvpVersionParamsSchema` parses `'2'` to 2 and rejects `'0'` and `'x'`.
  
  In the db models spec, an MvpProject saved with a version that has `from: 3` reads back with `from === 3`.
- [ ] **Step 2: Run them.** Run `npx vitest run packages/validation packages/db`. Expected: FAIL (`contrastRatio` is not exported, and the schema shape differs).
- [ ] **Step 3: Implement the Produces block.** Move `luminance` out of `mvp-page-finish.ts` into `contrastRatio`'s module, so that `onColor` imports it. Rename `IMvpEditJob*` in its users (`api/src/queues/mvp-edit.queue.ts`, `workers/src/workers/mvp-edit.worker.ts`, `dashboard/src/api/client.ts`) only as far as typecheck needs; Tasks 4–5 replace them.
- [ ] **Step 4: Run.** Run `npm run build:packages && npx vitest run packages && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-139): font pairings, contrast-checked tokens body and the page job types`.

### Task 2: `finishMvpPage` validates controls; generator deadline

**Files:**
- Modify: `apps/workers/src/services/mvp-page-finish.ts`, `apps/workers/src/services/mvp-page-generator.ts`
- Test: `apps/workers/src/services/__tests__/mvp-page-finish.spec.ts`, `apps/workers/src/services/__tests__/mvp-page-generator.spec.ts`

**Interfaces:**
- Consumes: `MvpThemeControlsSchema`, `MVP_FONT_CHOICES`, `contrastRatio` (Task 1).
- Produces: `MvpPageInput.deadline?: number` (epoch ms). Without it, behavior is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `finishMvpPage` with `controls: { primary: 'red;}body{display:none', fontBody: 'Comic"Sans' }` writes no `#rv-controls` style, and the output contains neither `display:none` nor `Comic`.
  - With `controls: { fontHeading: 'Lora', fontBody: 'Inter' }`, the `#rv-controls` style contains `--rv-font-heading:"Lora",serif` and `--rv-font-body:"Inter",sans-serif`.
  - In the generator spec, `generate({ brief, deadline: Date.now() - 1 })` makes no client call and returns `{ ok: false, reason: 'call_failed' }` with a message containing `time`.
  - `generate({ brief, deadline: Date.now() + 10_000 })` passes `timeoutMs <= 10_000` to `completeWithUsage`.
  - When the first answer is rejected and the deadline has passed by the second call, there is no second call and the result is `invalid_page`.
- [ ] **Step 2: Run them.** Run `npx vitest run apps/workers/src/services/__tests__/mvp-page-finish.spec.ts apps/workers/src/services/__tests__/mvp-page-generator.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Finish:** drop each control key whose value fails its field schema. The generic family comes from the `MVP_FONT_CHOICES` entry that names the font (heading or body), else `sans-serif`.
  - **Generator:** before each call, set `left = deadline - Date.now()`. When `left <= 0`, stop the loop with `lastError = 'out of time'`. Otherwise use `timeoutMs = Math.min(TIMEOUT_MS, left)`.
- [ ] **Step 4: Run** the same tests and the existing finish browser spec. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-139): finishing drops invalid controls; the generator keeps to a deadline`.

### Task 3: Extract the publish steps from `deployPage`

**Files:**
- Create: `apps/workers/src/services/mvp-page-publish.ts`, `apps/workers/src/services/desktop-capture.ts`
- Modify: `apps/workers/src/workers/deploy.worker.ts`, `apps/workers/src/workers/ai.worker.ts`, `apps/workers/src/services/storage.service.ts`
- Test: `apps/workers/src/workers/__tests__/deploy-page.spec.ts` (must stay green unchanged except for import paths and mocks), `apps/workers/src/services/__tests__/storage.service.spec.ts`

**Interfaces — Produces:**
- `desktopCapture(url?: string): Promise<Buffer | undefined>`, moved from `ai.worker.ts` with the 15 s timeout.
- `storageService.readPageVersion(key: string): Promise<string>`. It is a GetObject on the demos bucket, returning the body as UTF-8, and it throws when the object is missing.
- `pageContext(lead: ILead, audit: IAudit): { brief: IMvpSourceBrief; finish: Omit<MvpFinishContext, 'theme' | 'controls'> }`. This is the brief, verified contacts, SEO, logo and tracker URL that `deployPage` builds today.
- `publishFinishedPage(input: { slug: string; html: string; lead; audit }): Promise<{ fullPreviewUrl; storageHtmlPath; comparisonBannerUrl; completenessReport; standards?; performance }>`. It covers completeness, standards, `publishMvp` and performance: steps 3 of `deployPage`, plus the audit banner write.
- `dropUnlistedVersions(before: IMvpPageVersion[], kept: IMvpPageVersion[]): Promise<void>`. This is step 5, warning instead of throwing.

- [ ] **Step 1: Write the failing test.** In the storage spec, `readPageVersion('v/x/versions/2.html')` sends a GetObject for that key in the demos bucket and returns the body text. A missing key rejects.
- [ ] **Step 2: Run it.** Run `npx vitest run apps/workers/src/services/__tests__/storage.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Implement `readPageVersion`. Move the code into the three helpers and `desktopCapture`, with `deployPage` and the ai worker calling them. Behavior is unchanged.
- [ ] **Step 4: Run** `npx vitest run apps/workers/src/workers/__tests__/deploy-page.spec.ts apps/workers/src/workers/__tests__/ai.worker.spec.ts apps/workers/src/services/__tests__/storage.service.spec.ts`. Expected: PASS, with deploy-page and ai.worker assertions unchanged (mocks may move to the new module paths).
- [ ] **Step 5: Commit** `refactor(REV-139): the page publish steps shared by generation and changes`.

### Task 4: The `mvp-page` worker

**Files:**
- Create: `apps/workers/src/workers/mvp-page.worker.ts`; Test: `apps/workers/src/workers/__tests__/mvp-page.worker.spec.ts`
- Delete: `apps/workers/src/workers/mvp-edit.worker.ts` and its spec. The services it used stay until REV-141.
- Modify: `apps/workers/src/index.ts` (register `createMvpPageWorker`)

**Interfaces:**
- Consumes: Task 1 types, Task 2 `deadline`, Task 3 helpers, `defaultPageGenerator()`, `checkMvpPage`, `checkMvpGrounding`.
- Produces: `processMvpPageJob(data: IMvpPageJobData, deps?: { generator?: Pick<MvpPageGenerator, 'change'>; now?: () => number }): Promise<IMvpPageJobResult>` and `createMvpPageWorker()` (queue `QUEUE_NAMES.MVP_PAGE`, concurrency 1).

**Flow, for every action:**
1. Deadline passed → throw the "stopped waiting" error, as `expired()` does today.
2. Load the project and lead. If the project has no `page`, throw `MVP_PREVIOUS_GENERATOR`'s message. Check `canChangeMvpLayout`.
3. Build the next state:
   - **change:** `generator.change({ brief, screenshot, currentPage: project.page, instruction, deadline: data.deadline - PUBLISH_MARGIN_MS })`.
     - A failure returns `{ applied: false, reason, message, problems }`.
     - A page equal to `project.page` returns `unchanged`.
     - Version `{ kind: 'change', instruction, provider, model }`.
   - **controls:** new controls = saved `controls` with each group replaced (given), cleared (`null`) or kept (absent). A colors group maps to `primary…text`, and a fonts group to `fontHeading` / `fontBody`. Equal to the saved controls → `unchanged`. There is no version, and the page and theme are the stored ones.
   - **restore:** find version `n` in `project.versions`; when it is not there, throw "Version n not found". `raw = readPageVersion(storagePath)`.
     - `raw === project.page` → `unchanged`.
     - `checkMvpPage(raw, brief)` not ok → `{ applied: false, reason: 'unusable_version', message, problems }`.
     - Otherwise the theme comes from the check, grounding is `checkMvpGrounding`, and the version is `{ kind: 'restore', from: n }`.
4. Before publishing, check again: the deadline, and that the lead is still in a status `canChangeMvpLayout` allows (else throw).
5. When a version is made, `n = max(versions.n) + 1`, then `uploadPageVersion`.
6. `finishMvpPage(page, { ...finish, theme, controls })`, then `publishFinishedPage`.
7. One `findByIdAndUpdate`:
   - `$set`: `page`, `theme`, `grounding`, `controls` (or `$unset` when empty), `editedAt`, the publish checks and URLs
   - `$push` the version with `$slice: -MVP_MAX_VERSIONS`, only when one was made
   - then `dropUnlistedVersions`
   - the lead's status and `generationCount` are untouched
8. Return `{ applied: true, version? }`.

- [ ] **Step 1: Write the failing tests** in `mvp-page.worker.spec.ts`. Mock the models, storage and publish helpers as `deploy-page.spec.ts` does, with a fake generator.
  - **change accepted:** `change` is called with the stored page, the instruction and a deadline of 90 s before the job's. One update sets the new `page` and `theme`, pushes `{ n: 3, kind: 'change', instruction }`, keeps `controls` and does not touch `generationCount`. The result is `{ applied: true, version: 3 }`.
  - **change rejected twice:** the generator answers `{ ok: false, reason: 'invalid_page', problems }`. The result carries them, and no upload, publish or update happens.
  - **change unchanged:** the result is `reason: 'unchanged'` with no upload.
  - **answer after the deadline:** `now` passes the deadline while `change` runs. The job throws and nothing is published.
  - **lead moved:** `Lead.findById` returns `GENERATING` on the re-check. The job throws and nothing is published.
  - **controls:** colors given and fonts `null` over saved `{ fontHeading: 'Lora', fontBody: 'Lato', primary: '#111111' }` gives controls `{ primary…text }` with no fonts. The finished HTML has `#rv-controls`, no version is pushed and `editedAt` is set.
  - **controls equal:** the result is `unchanged`.
  - **restore:** version 1's raw page is read, re-checked and pushed as `{ n: 3, kind: 'restore', from: 1 }`. The grounding is recomputed.
  - **restore unusable:** the raw page uses `{{hours}}` and the brief has no `hours`. The result is `unusable_version` with a `page:placeholder` problem, and nothing is published.
  - **restore missing file:** `readPageVersion` rejects. The job throws and nothing is published.
  - **restore unknown n:** the job throws "Version 9 not found".
  - **previous generator:** a project without `page` throws for every action.
  - **cap:** with 20 versions, the push uses `$slice: -20`, and the dropped version's file is deleted.
- [ ] **Step 2: Run them.** Run `npx vitest run apps/workers/src/workers/__tests__/mvp-page.worker.spec.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** the worker as in the flow above.
- [ ] **Step 4: Run** the spec plus `npx vitest run apps/workers`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-139): the mvp-page worker applies changes, controls and restores`.

### Task 5: API routes

**Files:**
- Create: `apps/api/src/queues/mvp-page.queue.ts`, replacing `mvp-edit.queue.ts`. Update `queues/index.ts` and `queues/close.ts`.
- Modify: `apps/api/src/routes/mvp.routes.ts`
- Test: `apps/api/src/routes/__tests__/api.routes.spec.ts`, and the queue spec if one exists for `mvp-edit.queue`

**Interfaces — Produces:**
- `runMvpPageJob(data: Omit<IMvpPageJobData, 'deadline'>, timeoutMs: number): Promise<{ status: 'done'; result: IMvpPageJobResult } | { status: 'failed'; reason: string } | { status: 'timeout' }>`
- `MVP_PAGE_CHANGE_WAIT_MS = 420_000`, `MVP_PAGE_PUBLISH_WAIT_MS = 120_000`

**Routes:**
- **Shared guard `loadChangeableMvp(id)`:**
  - 400 `INVALID_ID`; 404 `MVP_NOT_FOUND`
  - 409 `MVP_PREVIOUS_GENERATOR` when there is no `page`
  - 404 `LEAD_NOT_FOUND`
  - 409 `MVP_EDIT_NOT_ALLOWED` with `{ status }` when `!canChangeMvpLayout`
- **`POST /:id/edit`** (`EditMvpSchema`): action `change`, waits `MVP_PAGE_CHANGE_WAIT_MS`.
- **`PATCH /:id/tokens`** (`UpdateMvpTokensSchema`): action `controls`, waits `MVP_PAGE_PUBLISH_WAIT_MS`.
- **`POST /:id/versions/:n/restore`:**
  - `n` is parsed by `MvpVersionParamsSchema`; failure → 400 `VALIDATION_ERROR`.
  - Unknown `n` in `project.versions` → 404 `MVP_VERSION_NOT_FOUND`.
  - Action `restore`, waits `MVP_PAGE_PUBLISH_WAIT_MS`.
- **Outcomes:**
  - `timeout` → 504 `MVP_EDIT_TIMEOUT`
  - `failed` → 502 `MVP_EDIT_FAILED` with the reason
  - `applied: false` and `unchanged` → 200 `{ success: true, message: 'Nothing was changed', data: { ...result, mvp } }`
  - `unusable_version` → 409 `MVP_VERSION_UNUSABLE` with `details: { problems }`
  - a model failure → 502 `MVP_EDIT_FAILED` with `details: { reason, problems? }`
  - `applied: true` → 200 with `data: { ...result, mvp }`, where `mvp` is re-read
- **Deleted:** `PATCH /:id/layout`, `DELETE /:id/design`, `refuseModelDesigned`, and the API's now-unused imports (`addMvpRelayoutJob`, `manualMvpLayout`, `rebuildEligibility`, `UpdateMvpLayoutSchema` usage).

- [ ] **Step 1: Write the failing tests** in `api.routes.spec.ts`, with `runMvpPageJob` mocked:
  - **edit:** 200 applied, which passes action `change` and 420 000 ms; 200 unchanged; 502 with `details.reason: 'invalid_page'`; 504 timeout; 400 for a short instruction; 404 for an unknown MVP; 409 `MVP_PREVIOUS_GENERATOR`; 409 `MVP_EDIT_NOT_ALLOWED` for a `SCHEDULED` lead.
  - **tokens:** 200 with the controls passed through; 400 for contrast `#777777` on white with `details` naming `colors.text`; 400 for an off-list font pair; 400 for the old body `{ primaryColor }`; 409 `MVP_PREVIOUS_GENERATOR`.
  - **restore:** 200 passes `version: 2`; 400 for `n = 0`; 404 `MVP_VERSION_NOT_FOUND` for n = 9; 409 `MVP_VERSION_UNUSABLE` with problems.
  - **removed routes:** `PATCH /mvp/:id/layout` and `DELETE /mvp/:id/design` answer 404.
- [ ] **Step 2: Run them.** Run `npx vitest run apps/api/src/routes/__tests__/api.routes.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and the queue module.
- [ ] **Step 4: Run** `npx vitest run apps/api`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-139): edit, tokens and restore routes for the model-designed page`.

### Task 6: Gates, end to end, PR, merge, docs

- [ ] **Gates:** `npm run build:packages`, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass.
- [ ] **End to end** on the dev stack, with lead `6aca106be1bcb20002195ad0` (falcodent.pl, NEEDS_APPROVAL), through the API with curl:
  1. An edit ("make the hero heading shorter") → version 3. The published page differs from version 2, and the contact links are still verified values.
  2. Tokens with a palette and the `classic` pair → the published page has `#rv-controls` and the font link. No version is added.
  3. A token body that fails the contrast check → 400.
  4. Restoring version 1 → version 4, `from: 1`, with the controls kept.
  5. `PATCH /layout` → 404.
  
  Take a Playwright screenshot of the published page after each step. The dashboard preview must show no console errors.
- [ ] **Pull request:** open it with `Fixes REV-139` and the Problem, Changes and Verification sections. Attach it to the ticket and move the ticket to In Review. Merge after re-running the gates on the up-to-date branch, then run `npm test` on `main`.
- [ ] **Docs:** blueprint.md §5 gets the new and removed codes, committed in `../Revamp-docs` as `docs(REV-139): …`. Add a ticket comment naming what REV-142 still covers. Then close the ticket.
