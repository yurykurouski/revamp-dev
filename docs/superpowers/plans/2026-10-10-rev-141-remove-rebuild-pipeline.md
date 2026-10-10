# REV-141 Remove the rebuild, modernize, grouping and Bento pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the old MVP pipeline (section reader, vision grouping, layout selection, rebuild, modernize, Bento, design layer, relayout) and everything only it uses. The audit then stops paying for a grouping call, and the model-designed page becomes the only path.

**Architecture:** This is a deletion done in compile-safe order. The two live paths that still touch the old code are cut loose first:
- The audit keeps its dated-site check (`siteEra`) through a new, small in-page collector that replaces the section reader's three measurements.
- The deploy worker keeps only `deployPage`.

Then the modules, their tests and their scripts go. The dashboard's leftovers go next, and last the types, schemas, error codes and db fields that nothing reads any more. A script lists unreferenced exports, so nothing is removed by guesswork.

**Tech Stack:** TypeScript monorepo (Express API, BullMQ workers, React dashboard, `@revamp/shared-types`, `@revamp/validation`, `@revamp/db`), Vitest, and Playwright for in-page collectors.

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md`, §8 (Removed) and §5 (Data model: removed fields; `siteEra` stays).

## Global Constraints

- **Kept (spec §8):**
  - `css-sanitizer`, `mvp-seo`, `templates/shared/{seo,booking,page}.ts`, `mvp-standards`, `mvp-performance`, `mvp-completeness*`, the image banner
  - `site-era`, `site-content.extractor`, `brand-extractor`
  - `html.ts`, `icons.ts` and `mvp-locale.ts`, while the kept code still imports them
- **Audit:** `siteSections*`, `siteLayout*` and the `sections` measurement are no longer written or declared. `siteEra` stays, with the same signs, weights and thresholds (`SITE_DATED_SIGNS`, `NARROW_FIXED_MAX_WIDTH` 1000, `NARROW_FIXED_MAX_BLEED_SHARE` 0.5, `SITE_DATED_THRESHOLD` 3).
- **MvpProject:** `generatedContent`, `colorPalette`, `layout`, `design`, `rebuild`, `rebuildEdit`, `modernize` and `renderFailure` are removed from the schema and `IMvpProject`. There is no migration: old records keep the values in Mongo, and nothing reads them. An MVP without `theme` is "previous generator" (REV-140).
- **No data writes** beyond what the code does. Never rename or delete records in the dev database.
- **Tests:** run vitest from the repo root. Gates: `build:packages`, `typecheck`, `lint` (0 errors, no new warnings), `test`, `build`.
- **Acceptance (ticket):**
  - `grep` finds no reference to the removed modules, types or i18n keys.
  - An audit on a real site completes without a grouping call.
  - End-to-end generation still works.

## Review Focus

1. **A deploy job without `page`,** for example a retry left in Redis from before this change. It fails for good with a clear message and records the lead's generation failure. It is not retried three times or crashed on. Test in Task 2.
2. **An old audit** that carries `siteSections`, `siteLayout` and a `sections` entry in `measurementErrors`. The Audit step renders without a raw key or an extra "not scored" line for it, and the score is unchanged. Test in Task 4.
3. **A lead whose `generationFailure` has an old code** (`MVP_REBUILD_UNAVAILABLE` / `MVP_MODERNIZE_UNAVAILABLE`) after the failure type is narrowed. The failure panel still shows the generic "previous generator" text. Test in Task 4 (dashboard), plus a db-schema check in Task 5.
4. **The era facts cannot be collected** (the page throws, or there are no blocks). The audit completes with `siteEraError`, or with `siteEra` from the HTML signs alone, never a crash. Test in Task 1.
5. **An MVP record with old fields** (`layout`, `colorPalette`, `rebuild`). `GET /mvp/:id` still answers 200 and the dashboard shows the previous-generator note. Test in Task 5 (API route).

---

### Task 1: The audit reads the dated-site facts itself and makes no grouping call

**Files:**
- Create: `apps/workers/src/services/site-era.page.ts`
- Modify:
  - `apps/workers/src/services/site-era.service.ts` (input)
  - `apps/workers/src/services/browser.service.ts` (collect era facts; drop the layout and section collection)
  - `apps/workers/src/workers/audit.worker.ts` (no `readSiteLayout`, no `readPageSections`, no grouping tokens, no `siteSections*` / `siteLayout*` writes)
- Test:
  - `apps/workers/src/services/__tests__/site-era.page.spec.ts` (new, real Chromium)
  - `site-era.spec.ts`
  - `apps/workers/src/workers/__tests__/audit.worker.spec.ts`

**Interfaces:**
- Produces in `site-era.page.ts`, a self-contained function serialised with `page.evaluate`, with no imports used inside it:
  - `export interface RawEraFacts { contentWidth?: number; fullBleedShare?: number; bodyFont?: string }`
  - `export function collectEraFactsInPage(): RawEraFacts`
  - Content blocks are chosen exactly as `collectSiteLayoutInPage` does today (`site-layout.service.ts` lines 66–117: open single big wrappers from `main`/`body`, split tall wrappers that hold ≥2 headed blocks, max 40). Copy that walk, without the `data-revamp-block` tagging.
  - `contentWidth` is the median block width, rounded. `fullBleedShare` is the share of blocks at least `0.95 × innerWidth` wide. Without blocks both are absent.
  - `bodyFont` is the computed `font-family` of the first shown `p` in a block with at least 40 characters of text. Without one it is absent.
- Produces in `site-era.service.ts`: `SiteEraInput` replaces `typography?: ISiteSections['typography']` with `bodyFont?: string`. Everything else is unchanged.
- Produces in `browser.service.ts`: `FullAuditCapture` (or whatever the return type is named) drops `siteLayout` and `siteSections` and gains `eraFacts: { raw?: RawEraFacts; error?: string }`, collected after `complexitySignals` on the desktop page. It never throws, and on failure it carries the reason in `error`.

- [ ] **Step 1: Write the failing tests**
  - `site-era.page.spec.ts`, using Playwright `chromium` at a 1440×900 viewport with `page.setContent`, as `site-layout.service.spec.ts` does:
    - `'measures a narrow fixed page'`: a `body` with three 900px-wide centered blocks of 200px height, each with an `h2` and a `p`. Result: `contentWidth` 900 and `fullBleedShare` 0.
    - `'measures full-bleed blocks'`: three 100%-wide blocks. `fullBleedShare` is 1 and `contentWidth` ≥ 1368.
    - `'reads the body font from the first long paragraph'`: `p { font-family: Georgia }` with 60 characters gives `bodyFont` containing `Georgia`.
    - `'returns nothing it cannot measure'`: an empty body gives `{}`.
  - `site-era.spec.ts`: change the existing `typography: { body: { family } }` inputs to `bodyFont`, keeping the same expectations (`default_font` for `"Times New Roman", serif`).
  - `audit.worker.spec.ts`:
    - `'makes no section grouping call and stores no sections or layout'`: the audit's update has no `siteSections`, `siteSectionsError`, `siteSectionsErrorReason`, `siteLayout` or `siteLayoutError` key. No grouping service and no `audit_section_grouping` token record are called. `measurementErrors` never contains `sections`.
    - `'stores siteEra from the era facts'`: the capture mock returns `eraFacts: { raw: { contentWidth: 900, fullBleedShare: 0, bodyFont: 'Times New Roman' } }` with HTML that has no viewport. `siteEra.signs` contains `narrow_fixed`, `default_font` and `no_viewport`.
    - `'completes without era facts'`: `eraFacts: { error: 'boom' }` still stores `siteEra` from the HTML signs and completes.
- [ ] **Step 2: Run them**, `npx vitest run apps/workers/src/services/__tests__/site-era.page.spec.ts apps/workers/src/services/__tests__/site-era.spec.ts apps/workers/src/workers/__tests__/audit.worker.spec.ts`. Expected: the new tests FAIL (missing module, old wiring).
- [ ] **Step 3: Implement** the collector, the input change, the browser capture change and the audit worker change. Delete the audit worker's Vision grouping branch, but keep the design critique call: the critique and grouping ran side by side, so keep the critique `Promise` alone.
- [ ] **Step 4: Run them.** Expected: PASS. Then run `npx vitest run apps/workers`. Failures are expected only in specs of modules deleted in Task 3, since nothing is deleted yet; no other spec may fail.
- [ ] **Step 5: Commit** `refactor(REV-141): the audit reads the dated-site facts itself and makes no grouping call`

### Task 2: The deploy worker publishes model pages only

**Files:**
- Modify:
  - `apps/workers/src/workers/deploy.worker.ts`: keep `deployPage`, `newSlug`, the slug helpers and `createDeployWorker`. Delete `deployMvp`, `republishSavedMvp`, `resolveModernize`, `recordModernizeTokens`, the relayout constants and helpers, `MODEL_DESIGNED_REFUSAL`, and their imports.
  - `apps/api/src/queues/deploy.queue.ts`: delete `addMvpRelayoutJob` and `RELAYOUT_DEBOUNCE_MS`.
  - `packages/shared-types` `IDeployJobData`: `page` becomes required, and `mode` is deleted.
- Test:
  - `apps/workers/src/workers/__tests__/deploy-page.spec.ts`
  - `deploy.worker.spec.ts`: rewrite to the page path or delete the cases of deleted paths.
  - Delete `deploy-rebuild.spec.ts`.
  - `apps/api/src/queues/__tests__/deploy.queue.spec.ts`: drop the relayout cases.

**Interfaces:**
- `createDeployWorker` handles every job with `deployPage`. A job without `page` throws `UnrecoverableError('Deploy job without a page: the previous generator was removed (REV-141). Regenerate the MVP.')`, so the existing `failed` handler records the generation failure once.

- [ ] **Step 1: Write the failing test** in `deploy-page.spec.ts`: `'refuses a job without a page for good'`. Process `{ leadId, auditId }` with no `page`. It rejects with an `UnrecoverableError` whose message contains `without a page`. No storage upload and no MvpProject write happen.
- [ ] **Step 2: Run it**, `npx vitest run apps/workers/src/workers/__tests__/deploy-page.spec.ts`. Expected: FAIL. The old `deployMvp` runs, or the error is not unrecoverable.
- [ ] **Step 3: Implement** the cut. Keep `OLD_MVP_FIELDS` in `deployPage`'s `$unset`, with `strict: false` on that update, so a regeneration still clears an old record's leftovers once their schema paths are gone in Task 5. Ruling: without `strict: false`, Mongoose would drop the unknown paths from the `$unset`.
- [ ] **Step 4: Run them**, `npx vitest run apps/workers/src/workers apps/api/src/queues`. Expected: PASS, apart from specs of modules deleted in Task 3.
- [ ] **Step 5: Commit** `refactor(REV-141): the deploy worker publishes model-designed pages only`

### Task 3: Delete the old worker modules, their tests, fixtures and scripts

**Files (delete):**
- `apps/workers/src/services/`:
  - `site-sections.page.ts`, `site-sections.service.ts`
  - `site-grouping.ts`, `site-grouping.service.ts`
  - `site-layout.service.ts`, `layout-selection.service.ts`
  - `rebuild-plan.service.ts`, `rebuild-tuning.ts`, `rebuild-edit.service.ts`
  - `rebuild-modernize.ts`, `rebuild-modernize.service.ts`, `rebuild-modernize-plan.ts`
  - `rebuild-template.service.ts`, `template.service.ts`
  - `mvp-content.service.ts`, `mvp-edit.service.ts`, `mvp-render.ts`
- `apps/workers/src/templates/`: `rebuild/` (the whole directory), `bento.template.ts`, `design.ts`
- Their specs in `services/__tests__` and `templates/__tests__`, and their fixture directories: grouping, modernize and section fixtures.
- `scripts/read_site_sections.ts`, `scripts/render_rebuild.ts`
- Any worker or template file that only the deleted modules imported. Find them with the import scan from Step 2; never by name alone.

**Interfaces:** none produced; nothing kept may import a deleted path.

- [ ] **Step 1: Delete** the files with `git rm`.
- [ ] **Step 2: Scan** the kept code for imports of removed paths and for files left without importers:
  ```bash
  npx tsc --noEmit -p apps/workers && npx tsc --noEmit -p apps/api
  ```
  Expected: no errors. Each "cannot find module" error names a kept file that still imports deleted code: change it (Tasks 1 and 2 should have covered all of them), never restore the module. Then list kept non-test files that no other file imports (for example `templates/mvp-locale.ts`, `icons.ts`). Delete one only when its last importer was deleted here, and ledger it.
- [ ] **Step 3: Run** `npx vitest run apps/workers apps/api scripts`. Expected: PASS.
- [ ] **Step 4: Commit** `refactor(REV-141): delete the section reader, grouping, rebuild, modernize, Bento and design layer`

### Task 4: Delete the dashboard's leftovers of the old pipeline

**Files:**
- Delete:
  - `apps/dashboard/src/utils/mvpChangeLog.ts`
  - `components/leadReview/MvpChangeLog.tsx`
  - `components/MvpLayoutChip.tsx`
  - `utils/renderFailure.ts`
  - their specs: `mvpChangeLog.spec.ts`, `MvpChangeLog.spec.ts`, `MvpLayoutChip.spec.ts`, `renderFailure.spec.ts`
- Modify:
  - `components/leadReview/AuditStep.tsx`: no `sections` measurement handling.
  - `api/client.ts`: comments and types naming the rebuild.
  - `components/leadReview/PrototypeStep.tsx`: comments.
- Delete the i18n keys `mvpLayout.*`, `mvpChangeLog.*`, the `sections` measurement keys and any key whose only reader was deleted, in all five locales. Check each key with grep before removing it.
- Test:
  - `components/__tests__/AuditStep.spec.ts`
  - `components/__tests__/PrototypeGenerationFailure.spec.ts`
  - `i18n/__tests__/locales.spec.ts` (parity)

**Interfaces:** none.

- [ ] **Step 1: Write the failing tests**
  - `AuditStep.spec.ts`: `'ignores a sections measurement error of an audit made before REV-141'`. An audit with `measurementErrors: [{ measurement: 'sections', … }]` renders with no "Sections" line, and the text contains no `audit.measurements.sections`. Delete the existing test that expects that line.
  - `PrototypeGenerationFailure.spec.ts` keeps `'shows a generic text for a failure of the previous generator'` (Review Focus 3). Make sure it uses an `MVP_REBUILD_UNAVAILABLE` code typed as a plain string, so the type narrowing in Task 5 cannot break it.
- [ ] **Step 2: Run them.** Expected: the AuditStep test FAILS.
- [ ] **Step 3: Delete and edit** as listed.
- [ ] **Step 4: Run** `npx vitest run apps/dashboard` and `npx tsc --noEmit -p apps/dashboard`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(REV-141): remove the dashboard's change log, layout chip and section measurement`

### Task 5: Remove the types, schemas, codes and db fields nothing reads

**Files:**
- Modify:
  - `packages/shared-types/src/index.ts`
  - `packages/validation/src/index.ts`
  - `packages/db/src/models/{Audit,MvpProject,Lead}.model.ts`
  - `apps/api/src/routes/mvp.routes.ts` (the generate body loses `layout`)
- Test:
  - `packages/*/__tests__`
  - `apps/api/src/routes/__tests__/api.routes.spec.ts`
  - `packages/db/__tests__/shared-models.spec.ts`

**Interfaces (removed, with everything only they use):**
- Constants and types: `SITE_SECTION_*`, `SITE_SKIP_REASONS`, `SITE_SECTIONS_LIMITS`, `OUTLINE_LIMITS`, `SITE_GROUPING_FAILURES`, `REBUILD_*`, `RebuildUnavailableReason`, `RebuildLevel`, `IRebuild*`, `IRebuildEdit`, `IRebuildModernize`, `MODERNIZE_FAILURES`, `IMvpDesign`, `MVP_DESIGN_*`, `BentoLayoutVariant`, `BENTO_LAYOUT_VARIANTS`, `MvpLayoutVariant`, `MVP_LAYOUT_*`, `IMvpLayoutSelection`, `IMvpGeneratedContent`, `ISiteSections`, `ISiteLayout`, `IMvpEditJobData`, `IMvpEditJobResult`, `MvpEditChange`, `QUEUE_NAMES.MVP_EDIT`.
- Their schemas in validation: `RebuildPlanSchema`, `RebuildEditSchema`, `RebuildModernize*Schema`, `MvpDesignSchema`, `SiteSectionsSchema`, `SiteLayoutSchema`, `SiteGroupingAnswerSchema`, `checkGrouping`, `checkRebuildEdit`, `rebuildEligibility`, `mergeRebuildEdits`, `parseRebuildChange`, `hasRebuildEdit`, `MvpEditOutputSchema`, and so on.
- `AUDIT_MEASUREMENTS` loses `sections`.
- `IAudit` loses `siteSections*`, `siteLayout*` and `generatedContent`.
- `IMvpProject` loses the eight fields in Global Constraints.
- `IMvpRenderFailure` becomes `{ code: 'MVP_PAGE_UNAVAILABLE'; reason: MvpPageFailure; message?: string; at: string | Date }`, and `MVP_RENDER_FAILURE_CODES = ['MVP_PAGE_UNAVAILABLE']`.
- `API_ERROR_CODES` loses `MVP_LAYOUT_CHANGE_NOT_ALLOWED`, `MVP_PALETTE_CHANGE_NOT_ALLOWED` and `MVP_REBUILD_UNAVAILABLE`, once nothing throws them.
- The token purpose `audit_section_grouping` is removed if it is listed.
- `GenerateMvpSchema` loses `layout`.
- **db:**
  - The Audit schema drops `siteLayout`, `siteLayoutError`, `siteSections`, `siteSectionsError`, `siteSectionsErrorReason` and `generatedContent`.
  - The MvpProject schema drops the eight fields.
  - `Lead.generationFailure.code` and `.reason` stay plain `String`s with no enum, so old leads still load and save. Ruling: an enum would fail validation on a save of an old lead.
- Method: after each round of removal, run `npm run build:packages && npm run typecheck` and the export scan below. Remove only what the scan reports as unreferenced outside its own definition, and repeat until it reports nothing new:
  ```bash
  # for every exported name in shared-types and validation, count references across apps/ and packages/ (excluding dist and node_modules)
  ```
  Write the scan as a short Node script in the scratchpad, not in the repo.

- [ ] **Step 1: Write the failing tests**
  - `api.routes.spec.ts`:
    - `'POST /mvp/generate refuses a layout'`: a body with `layout: 'bento'` gives 400 `VALIDATION_ERROR`, since the schema is strict.
    - `'GET /mvp/:id still answers an MVP stored with old fields'` (Review Focus 5): the mocked record has `layout`, `colorPalette` and `rebuild`. The answer is 200, and the body's `data.leadId` is set.
  - `shared-models.spec.ts`:
    - `'the Audit schema no longer declares the section reader or layout fields'`: `Audit.schema.path('siteSections')` and `path('siteLayout')` are undefined.
    - `'the MvpProject schema no longer declares the old renderer fields'`: the same check for the eight fields.
    - `'a lead keeps an old generation failure code'` (Review Focus 3): `new Lead({ …, generationFailure: { code: 'MVP_REBUILD_UNAVAILABLE', reason: 'rebuild:flat', at: new Date() } }).validateSync()` gives no error.
  - Validation spec: `'AUDIT_MEASUREMENTS has no sections'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Remove** the items using the scan loop. Fix every compile error by removing the dead use, never by restoring the type.
- [ ] **Step 4: Run** `npm run build:packages && npm run typecheck && npx vitest run packages apps/api apps/workers apps/dashboard`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(REV-141): drop the old pipeline's types, schemas, error codes and db fields`

### Task 6: Repository docs, acceptance grep, gates and end-to-end

- [ ] **AGENTS.md:** delete the §3.2.2 and §3.2.6 bullets and sentences that describe deleted modules or scripts: section reader, grouping, layout derivation, rebuild, modernize, the change log codes, `relayout-mvp`, the design spec, Bento and `customCss` for the old renderer. Add one line saying the MVP is written by the page generator (REV-136–REV-140) and that REV-142 documents its rules. The new rule set itself belongs to REV-142.
- [ ] **README.md:** delete the paragraphs describing the section rebuild, modernize, the layout picker, the scripts `read_site_sections.ts` and `render_rebuild.ts`, and `mvp-edit-queue`. Same rule: REV-142 writes the new text.
- [ ] **Acceptance grep:** run this from the repo root, excluding `dist`, `node_modules`, `docs/superpowers` and git history. Expected: no matches in code, tests or i18n. Remaining matches in AGENTS.md/README are only the REV-142 pointer line.
  ```bash
  grep -rEn "site-sections|site-grouping|site-layout\.service|layout-selection|rebuild-(plan|tuning|edit|modernize|template)|templates/rebuild|bento\.template|templates/design|template\.service|mvp-content\.service|mvp-edit\.service|mvp-render|read_site_sections|render_rebuild|IRebuildEdit|IMvpDesign|MVP_DESIGN_|BentoLayoutVariant|SITE_SECTION_|REBUILD_|mvpLayout\.|mvpChangeLog|relayout" apps packages scripts AGENTS.md README.md --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md'
  ```
- [ ] **Gates:** `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` and `npm run build`.
- [ ] **End to end with the dev stack:**
  1. Add a lead for a real site by URL (Add lead), and watch the workers' log: the audit completes with no grouping call and no `audit_section_grouping` token record, and `siteEra` is stored.
  2. Generate its MVP and wait for NEEDS_APPROVAL. The page is published and the Prototype step shows it.
  3. Open an older lead in Chrome: it shows the previous-generator note.

  Expect no console errors.
- [ ] **Final review, PR, merge, docs, close:**
  - The final whole-branch review comes first.
  - Then the PR with `Fixes REV-141`. Attach it to the ticket and move the ticket to In Review.
  - Merge after re-running the gates on the up-to-date branch, then run `npm test` on `main`.
  - Revamp-docs: blueprint.md §5 drops the removed error codes, with a ticket comment that REV-142 rewrites the rest.
  - Close the ticket.

## Decisions taken in this plan (rulings for review)

1. **`siteEra` stays, and the audit measures its facts with a new in-page collector** that copies the layout walk's block choice. The signs and thresholds are unchanged. The cost: a second copy of about 50 lines of DOM walking, now the only one.
2. **A deploy job without `page` fails for good.** Old jobs in Redis cannot be rendered any more.
3. **Old fields stay in Mongo, unread.** A regeneration clears them (`$unset` with `strict: false`). There is no migration, per spec §5.
4. **`Lead.generationFailure` keeps plain string fields** so old leads still validate. Only the TypeScript type narrows.
5. **AGENTS.md and README lose the paragraphs about deleted code here; REV-142 writes the new rule set.** Leaving them in would tell agents to use code that no longer exists.
