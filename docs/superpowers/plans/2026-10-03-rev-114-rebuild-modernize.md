# REV-114 Modernize Level for the Rebuilt MVP: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rebuilt MVP of a dated site renders at a `modern` level: the same content, order and brand colours, with a modern look the model picks by id from a fixed vocabulary, or a deterministic default when the model can't. The operator can switch between Faithful and Modernized.

**Architecture:**
- A deterministic detector stores `Audit.siteEra` at audit time.
- `IMvpLayoutSelection.rebuildLevel` holds the level. `rebuildLevelFor` decides it at generation, and `PATCH /mvp/:id/layout { variant, level }` changes it.
- The modernize design is a restricted subset of the extended `IRebuildEdit` vocabulary. `RebuildModernizeService` (text-only model) or `defaultModernDesign` produces it, and it is stored per audit on `MvpProject.modernize`.
- `planRebuild` merges it under the operator's edit. The existing renderers and `RebuildPlanSchema` stay the only path to HTML.

**Tech Stack:** TypeScript, Zod (`@revamp/validation`), Mongoose (`@revamp/db`), Playwright, BullMQ workers, React/MUI dashboard, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-rev-114-rebuild-modernize-design.md`

## Global Constraints

- The model never writes copy, markup or facts. Its modernize answer holds ids and enum values only (no string fields) and passes `RebuildModernizeAnswerSchema` and then `checkRebuildEdit`.
- `planRebuild(input)` without `input.modernize` returns exactly today's plan. Every existing planner, renderer and template test passes unchanged.
- No per-site CSS. New looks are `data-*` attributes and `--rb-*` variables with rules in `STATIC_CSS`. `sanitizeMvpCss` stays the only CSS escape hatch.
- Detector weights: `table_layout`, `no_viewport`, `frames`, `flash`, `narrow_fixed` = 2; `legacy_tags`, `default_font`, `old_jquery`, `stale_copyright` = 1. `SITE_DATED_THRESHOLD = 3`. `narrow_fixed` when `contentWidth <= 1000` and the full-bleed share is under 0.5. Default font names: `times`, `times new roman`, `serif` (case-insensitive, first family of the stack).
- Fit rules:
  - `text` → `card-grid` / `list` needs at least 3 intro paragraphs, each at most 300 characters;
  - `list` → `card-grid` needs at least 3 items;
  - `mediaSide` and `media` only on a `media-beside-text` section with an image;
  - `banner` needs an image at least `REBUILD_BANNER_MIN_WIDTH = 1000` px wide.
- Planner values:
  - cards from paragraphs: 3 columns, or 2 when the longest paragraph is over 160 characters;
  - `mediaMax` = min(1200, 2 × natural width);
  - `typeScale: 'modern'`: h1 56, h2 36, body max(read, 17).
- `defaultModernDesign` hero photo: the first image at least 300 px wide in the next three hero or content sections after the h1 section.
- Ids: section `s-<i>`; pieces `s-<i>.t|i|x<n>` (dropped) and `s-<i>.m<n>` (hero photo only), where `m<n>` indexes the read section's `images` before `mediaFirst`.
- Codes: `modernize:<code>` in `summary.tuning` for choices from the modernize layer, `edit:<code>` for the operator's. Layout reasons: `modernize:dated`, `dated:<score>`, `modernize:manual`, `modernize:default` (12 codes of 60 characters max).
- Every new Audit or MvpProject field is declared in `@revamp/db`.
- Run vitest from the repo root (`npx vitest run <path>`), never inside `apps/workers`. Tests never call a live model. Under load, rerun with `npm test -- --maxWorkers=1`.
- New dashboard strings go in all five locales (en, ru, be, pl, lt).
- Commits: `feat(REV-114): …` / `test(REV-114): …` / `docs(REV-114): …`, ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JgQNXXJSWsL13X8CvMuSfX
  ```

## Review Focus

1. **The operator styles a section whose only photo the hero took** (e.g. `sections['s-2'].mediaSide`). The planner must ignore side and fit on a section with no media left, not fail the plan. Test in Task 3.
2. **A text section longer than `COLLAPSE_CHARS` turned into cards** (anident `s-9`, 26 paragraphs). It must not be collapsed, and it keeps every paragraph (up to `textsPerArray` 40). Test in Task 3.
3. **The hero photo's source section left empty.** It is omitted as `empty`, and a nav link to it drops as it does today. Test in Task 3.
4. **A switch of level with no change of renderer.** The preview must still reload: `rebuild.level` changes, so the worker sets `editedAt` and the dashboard's re-render wait ends on `mvp.rebuild.level`. Tests in Tasks 5 and 7.
5. **A stored `modernize` from an older audit after a re-audit.** It is ignored at render and unset at regeneration, and the default or a fresh model answer is used. Test in Task 5.

---

## File Structure

| File | Change |
|---|---|
| `packages/shared-types/src/index.ts` | `SITE_DATED_SIGNS`, `ISiteEra`, `IAudit.siteEra?/siteEraError?`; `REBUILD_LEVELS`, `IMvpLayoutSelection.rebuildLevel?`; `REBUILD_EDIT_ARRANGEMENTS`, `REBUILD_MEDIA_FITS`, `REBUILD_HERO_STYLES`, `REBUILD_TYPE_SCALES`; new fields on `IRebuildSectionEdit`, `IRebuildEditAnswer` (`hero`, `theme.typeScale`); `IRebuildModernizeAnswer`, `IRebuildModernize`, `IMvpProject.modernize?`; `IRebuildSection.mediaFit?/mediaMax?`; `IMvpRebuildSummary.level?` |
| `packages/validation/src/index.ts` | `SITE_DATED_THRESHOLD`, `SiteEraSchema`; extend `RebuildEditAnswerSchema`, `checkRebuildEdit`, `hasRebuildEdit`; `REBUILD_BANNER_MIN_WIDTH`; `RebuildModernizeAnswerSchema`, `RebuildModernizeSchema`; `MvpLayoutSelectionSchema.rebuildLevel`; `manualMvpLayout(previous, variant, level?)`; `UpdateMvpLayoutSchema.level`; `RebuildPlanSchema` section `mediaFit`/`mediaMax`; `MvpRebuildSummarySchema.level` |
| `packages/validation/__tests__/rebuild-modernize.spec.ts` | new |
| `packages/db/src/models/{Audit,MvpProject}.model.ts` | `siteEra` (Mixed), `siteEraError` (String); `modernize` (Mixed) |
| `apps/workers/src/services/site-era.service.ts` | new: `readSiteEra` |
| `apps/workers/src/services/site-sections.page.ts` | `RawSiteSections.contentWidth?`, `fullBleedShare?` |
| `apps/workers/src/services/browser.service.ts` | the capture returns `homeHtml?: string` |
| `apps/workers/src/workers/audit.worker.ts` | store `siteEra` / `siteEraError` |
| `apps/workers/src/services/rebuild-plan.service.ts` | `RebuildInput.modernize`, `mergeRebuildEdits`, the new fields |
| `apps/workers/src/templates/rebuild/{sections,styles}.ts` | `data-media-fit`, `--rb-media-max`, the CSS rule |
| `apps/workers/src/services/rebuild-modernize.ts` | new: `defaultModernDesign`, `modernizeForAudit` |
| `apps/workers/src/services/rebuild-modernize.service.ts` | new: `RebuildModernizeService`, `REBUILD_MODERNIZE_SYSTEM_PROMPT` |
| `apps/workers/src/services/rebuild-edit.service.ts` | outline gains image ids and sizes; the prompt lists the new fields |
| `apps/workers/src/services/{rebuild-template.service,mvp-render}.ts` | pass `modernize` at level `modern`; `rebuildLevelFor` |
| `apps/workers/src/workers/deploy.worker.ts` | resolve and store `modernize` at generation and re-publish; `editedAt` on a level change |
| `apps/api/src/routes/mvp.routes.ts` | `PATCH /:id/layout` with `level` |
| `apps/dashboard/src/{api/client.ts,hooks/useLeads.ts,hooks/useLiveMvpLayout.ts}` | `level` in the mutation; `level`, `changeLevel` |
| `apps/dashboard/src/components/leadReview/MvpRebuildLevelToggle.tsx` | new, used by `MvpDesignTools` |
| `apps/dashboard/src/i18n/locales/*.ts` | `mvpLayout.level.*` |
| `scripts/render_rebuild.ts` | `--level`, `--record` |
| `apps/workers/src/services/__tests__/fixtures/modernize/{anident,falcodent}.json` | recorded answers |

---

### Task 1: Types, schemas, checks and db fields

**Files:**
- Modify: `packages/shared-types/src/index.ts`, `packages/validation/src/index.ts`, `packages/db/src/models/Audit.model.ts`, `packages/db/src/models/MvpProject.model.ts`
- Test: `packages/validation/__tests__/rebuild-modernize.spec.ts`

**Interfaces:**
- Produces (shared-types):
  ```ts
  SITE_DATED_SIGNS; type SiteDatedSign
  interface ISiteEra { dated: boolean; score: number; signs: SiteDatedSign[]; contentWidth?: number }
  REBUILD_LEVELS = ['faithful', 'modern']; type RebuildLevel
  REBUILD_EDIT_ARRANGEMENTS = ['card-grid', 'list']; REBUILD_MEDIA_FITS = ['natural', 'fill']
  REBUILD_HERO_STYLES = ['split', 'banner']; REBUILD_TYPE_SCALES = ['original', 'modern']
  IRebuildSectionEdit += { arrangement?; mediaSide?: 'left' | 'right'; media? }
  IRebuildEditAnswer += { hero?: { photo: string; style: RebuildHeroStyle } }, theme += { typeScale? }
  type IRebuildModernizeAnswer = Omit<IRebuildEditAnswer, 'order' | 'hidden' | 'dropped' | 'customCss'>
  interface IRebuildModernize { auditId: string; source: 'llm' | 'default'; design: IRebuildModernizeAnswer; error?: string }
  IMvpProject.modernize?: IRebuildModernize; IAudit.siteEra?: ISiteEra; IAudit.siteEraError?: string
  IMvpLayoutSelection.rebuildLevel?: RebuildLevel; IMvpRebuildSummary.level?: RebuildLevel
  IRebuildSection += { mediaFit?: 'natural' | 'fill'; mediaMax?: number }
  MVP_LAYOUT_MODERNIZE_REASONS = { dated: 'modernize:dated', manual: 'modernize:manual', fallback: 'modernize:default' }
  ```
- Produces (validation):
  ```ts
  SITE_DATED_THRESHOLD = 3; REBUILD_BANNER_MIN_WIDTH = 1000; SiteEraSchema
  RebuildModernizeAnswerSchema; RebuildModernizeSchema   // strict, auditId 24-hex
  checkRebuildEdit(edit, read)                            // same signature, new rules
  manualMvpLayout(previous, variant, level?: RebuildLevel): MvpLayoutSelection
  UpdateMvpLayoutSchema: { variant, level? }              // refine: level only with 'original'
  ```

- [ ] **Step 1: Write the failing tests in `rebuild-modernize.spec.ts`**
  - `SiteEraSchema`:
    - accepts `{ dated: true, score: 7, signs: ['table_layout', 'narrow_fixed'], contentWidth: 760 }`;
    - rejects an unknown sign, a negative score and extra keys.
  - `RebuildModernizeAnswerSchema`:
    - accepts `{ hero: { photo: 's-2.m0', style: 'split' }, theme: { typeScale: 'modern' }, sections: { 's-9': { arrangement: 'card-grid' }, 's-3': { mediaSide: 'left', media: 'fill' } } }`;
    - rejects `hidden`, `order`, `dropped`, `customCss`, a photo id `s-2.t0`, and `arrangement: 'slider'`.
  - `RebuildEditAnswerSchema` accepts the new fields too (the operator layer).
  - `checkRebuildEdit` against a fixture of `s-1` hero (heading only), `s-2` media-beside-text with images `[{ src: 'https://x/a.jpg', width: 352 }]`, `s-3` text with 3 paragraphs of 300 characters, `s-4` text with 3 paragraphs where one is 301 characters, and `s-5` list with 2 items:
    - `s-3` → `card-grid`: ok.
    - `s-4` → `card-grid`: `{ ok: false, reason: 's-4 cannot be shown as card-grid' }`.
    - `s-5` → `card-grid`: fails.
    - A read arrangement given as itself: ok.
    - `mediaSide` on `s-3`: fails.
    - `hero.photo: 's-2.m0'` with `split`: ok.
    - `hero.photo: 's-2.m0'` with `banner`: fails (352 < 1000).
    - `hero.photo: 's-2.m1'`: fails as an unknown piece.
    - A hero photo when `s-1` already has `images`: fails.
    - `hero.photo` pointing at the h1 section itself: fails.
  - `manualMvpLayout`:
    - `manualMvpLayout({ variant: 'original', reasons: ['modernize:dated', 'dated:7', 'rule:rebuild'], rebuildLevel: 'modern' }, 'original', 'faithful')` gives `rebuildLevel: 'faithful'` and reasons that start with `rule:manual` and include `modernize:manual`, without `modernize:dated` or `dated:7`.
    - Without `level`, the previous `rebuildLevel` is kept.
  - `UpdateMvpLayoutSchema`: `{ variant: 'bento', level: 'modern' }` fails, `{ variant: 'original', level: 'modern' }` passes, `{ variant: 'split' }` passes.
  - `hasRebuildEdit({ hero: { photo: 's-2.m0', style: 'split' } })` and `hasRebuildEdit({ sections: { 's-3': { media: 'fill' } } })` are true.
  - `MvpLayoutSelectionSchema` accepts `rebuildLevel` and rejects `'retro'`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run packages/validation/__tests__/rebuild-modernize.spec.ts`. Expected: FAIL (exports missing).

- [ ] **Step 3: Implement the types and schemas**
  - Add the shared-types listed above.
  - In validation:
    - extend the section-edit object, the theme and `hero` (`photo` matches `^s-\d{1,3}\.m\d{1,3}$`);
    - derive `RebuildModernizeAnswerSchema` with `.omit({ order, hidden, dropped, customCss })`;
    - add the `checkRebuildEdit` rules after the existing ones, with reason strings in the form `s-<i> cannot be shown as <arrangement>`, `s-<i> has no photo beside its text`, `unknown piece s-<i>.m<n>`, `the opening section already shows a photo`, `s-<i>.m<n> is too small for a banner`;
    - make `isRenderOutcome` (used by `manualMvpLayout`) drop `modernize:dated`, `dated:*` and `modernize:default`;
    - add `level` to `UpdateMvpLayoutSchema` with `.refine`, and `mediaFit`/`mediaMax` (int 1..1200) on the plan section schema and `level` on the summary schema, both optional.
  - In `@revamp/db`: `Audit.siteEra: Mixed`, `Audit.siteEraError: String`, `MvpProject.modernize: Mixed`.

- [ ] **Step 4: Run the tests to verify they pass**
  Run: `npx vitest run packages/validation` then `npm run build:packages`. Expected: PASS; the existing `rebuild-edit.spec.ts` and `mvp-layout.spec.ts` are unchanged and green.

- [ ] **Step 5: Commit**: `feat(REV-114): modernize vocabulary, site era and rebuild level schemas`

---

### Task 2: The dated-site detector

**Files:**
- Create: `apps/workers/src/services/site-era.service.ts`
- Modify: `apps/workers/src/services/site-sections.page.ts`, `apps/workers/src/services/browser.service.ts`, `apps/workers/src/workers/audit.worker.ts`
- Test: `apps/workers/src/services/__tests__/site-era.spec.ts`, `site-sections.page.spec.ts`, `apps/workers/src/workers/__tests__/audit.worker.spec.ts`

**Interfaces:**
- Consumes: `HomePageSignals`, `parseHomePage(html, now)`, `findCopyrightYear`, `STALE_COPYRIGHT_YEARS` from `site-assessment.service.ts`; `SiteEraSchema`.
- Produces:
  ```ts
  readSiteEra(input: { html: string; contentWidth?: number; fullBleedShare?: number; typography?: ISiteSections['typography']; now: Date }): ISiteEra
  RawSiteSections.contentWidth?: number; RawSiteSections.fullBleedShare?: number
  capture result: homeHtml?: string    // page.content() on the desktop page, cut at MAX_HTML_BYTES
  ```

- [ ] **Step 1: Write the failing tests in `site-era.spec.ts`**
  - `readSiteEra({ html: '<html><body><table><tr><td><table></table></td></tr></table><font>x</font></body></html>', now })` has signs `table_layout`, `no_viewport`, `legacy_tags`, a score of 5 and `dated: true`.
  - A modern page (viewport meta, no tables, `contentWidth` 1200, Inter body font) gives score 0 and `dated: false`.
  - A score of 2 alone (only `no_viewport`) is not dated; a score of 3 (`no_viewport` + `legacy_tags`) is.
  - `contentWidth`:
    - 1000 with `fullBleedShare` 0.2 → `narrow_fixed`;
    - 1001 → none;
    - 900 with `fullBleedShare` 0.5 → none;
    - undefined → none.
  - `default_font`:
    - for `Times`, `"Times New Roman", serif` and `serif`;
    - not for `Georgia, serif` or `Montserrat`.
  - `stale_copyright` for `© 2015` with `now` in 2026.
  - The result always passes `SiteEraSchema`, and the signs follow `SITE_DATED_SIGNS` order.

- [ ] **Step 2: Add the reader fixture test in `site-sections.page.spec.ts`**
  - On a fixture with two `data-revamp-block` boxes 760 px wide and one 1440 px full-bleed block at a 1440 px viewport, `collectSiteSectionsInPage()` returns `contentWidth: 760` (the median) and `fullBleedShare` ≈ 0.33.
  - Follow the file's existing happy-dom fixture style.

- [ ] **Step 3: Run them to verify they fail**
  Run: `npx vitest run apps/workers/src/services/__tests__/site-era.spec.ts apps/workers/src/services/__tests__/site-sections.page.spec.ts`. Expected: FAIL.

- [ ] **Step 4: Implement**
  - `readSiteEra` maps `HomePageSignals` to the signs, sums the weights and sets `dated` at `SITE_DATED_THRESHOLD`.
  - `collectSiteSectionsInPage` measures the tagged blocks' widths (self-contained, no imports).
  - `browserService` reads `page.content()` in the desktop context next to `extractSiteSections`, and on failure leaves `homeHtml` undefined.
  - The audit worker, after `readPageSections`:
    ```ts
    siteEra: homeHtml ? readSiteEra({ html: homeHtml, contentWidth: raw?.contentWidth, fullBleedShare: raw?.fullBleedShare, typography: siteSections.sections?.typography, now: new Date() }) : undefined
    siteEraError: homeHtml ? undefined : 'home page HTML not read'
    ```
    It is wrapped in try/catch: a thrown error becomes `siteEraError` with the message, cut to 300 characters. Exactly one of the two fields is set, and the other is in the `unmeasured` unset list, as `siteSections` is.

- [ ] **Step 5: Add the audit worker test in `audit.worker.spec.ts`**
  - With a mocked capture returning `homeHtml` that has a table layout, the saved audit update has `siteEra.dated === true`.
  - With no `homeHtml`, it has `siteEraError` and no `siteEra`, and the audit still completes.

- [ ] **Step 6: Run and verify**
  Run: `npx vitest run apps/workers/src/services/__tests__/site-era.spec.ts apps/workers/src/services/__tests__/site-sections.page.spec.ts apps/workers/src/workers/__tests__/audit.worker.spec.ts`. Expected: PASS.

- [ ] **Step 7: Commit**: `feat(REV-114): detect dated sites at audit time`

---

### Task 3: The planner applies the modernize layer and the new fields

**Files:**
- Modify: `apps/workers/src/services/rebuild-plan.service.ts`, `apps/workers/src/templates/rebuild/sections.ts`, `apps/workers/src/templates/rebuild/styles.ts`
- Test: `apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts` (new `describe('modernize (REV-114)')` block; existing tests untouched), `apps/workers/src/templates/__tests__/` rebuild renderer spec (wherever `data-revamp-section` is tested today)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  RebuildInput.modernize?: IRebuildModernizeAnswer
  mergeRebuildEdits(modernize: IRebuildModernizeAnswer | undefined, edit: IRebuildEditAnswer | undefined): { edit?: IRebuildEditAnswer; from: (path: string) => 'modernize' | 'edit' }
  ```
  `path` is `sections.<id>.<key>`, `theme.<key>` or `hero`. It decides the code prefix.

- [ ] **Step 1: Write the failing planner tests** (fixture: the anident reading from `fixtures/grouping/anident.json` through `readGroupedSections`, as in `site-grouping.recorded.spec.ts`, plus small hand-made sections)
  - `planRebuild(input)` deep-equals `planRebuild({ ...input, modernize: undefined })`, and a snapshot of the anident faithful plan's `summary` and section ids/arrangements is stored.
  - Cards from paragraphs:
    - With `modernize: { sections: { 's-9': { arrangement: 'card-grid' } } }`, section `s-9` has `arrangement: 'card-grid'`, `columns` 3 or 2 by the 160-character rule, one item per kept paragraph with `text: [p]`, an empty intro `text`, `collapsed: false`, and tuning includes `modernize:cards:9`.
    - Every paragraph of the faithful plan's `s-9` appears in exactly one item (Review Focus 2).
  - With the operator's `edit: { dropped: ['s-9.t0'] }` on top, the first paragraph is not among the cards, and an `omitted { what: 'text', reason: 'dropped' }` is recorded.
  - `list` → `card-grid` keeps the items and sets `cards:<i>`.
  - `media: 'fill'` on a 352 px image gives `mediaFit: 'fill'`, `mediaMax: 704`, and the code `modernize:fill:<i>`. `mediaSide: 'left'` gives `mediaSide: 'left'` and `modernize:side:<i>`.
  - Hero split:
    - `hero: { photo: 's-2.m0', style: 'split' }` turns `s-1` into `arrangement: 'media-beside-text'`, `mediaSide: 'right'`, `mediaFit: 'fill'`, with `images[0].src` = s-2's photo and `eager: true`.
    - `s-2` no longer has that image, and the tuning includes `modernize:hero-photo:s-2.m0`.
    - `s-1` intro links include `{ href: '#booking', kind: 'booking' }` with the header's CTA label, and the code `modernize:hero-cta`.
  - A hero that already has a link gets no `hero-cta`.
  - Hero banner on a 1200 px photo: `s-1.style.backgroundImage` is the photo, `overlay` is `BANNER_OVERLAY`, `style.text` is `#ffffff`, and the tuning has `overlay:1`.
  - When the source section held only that photo, it is omitted as `empty`, and a header nav link naming it lands in `omitted { what: 'nav_link' }` (Review Focus 3).
  - `theme.typeScale: 'modern'` gives `h1Size` 56, `h2Size` 36, `bodySize` ≥ 17, and `modernize:type`.
  - The operator wins:
    - With `modernize.sections['s-3'].background = 'tinted'` and `edit.sections['s-3'].background = 'dark'`, `s-3.style.background` is `#111827`.
    - The tuning has `edit:style:3` and no `modernize:style:3`.
    - `modernize.theme.font = 'humanist'` with `edit.theme.font = 'serif'` uses the serif stack.
  - Review Focus 1: with modernize hero `s-2.m0` (s-2's only image) and `edit.sections['s-2'] = { mediaSide: 'left', media: 'fill' }`, the plan passes `RebuildPlanSchema`, `s-2` has no `mediaFit`, and no side or fill code is recorded for `s-2`.
  - Every modernize plan in this block passes `RebuildPlanSchema`.

- [ ] **Step 2: Write the failing renderer test**
  - A section with `mediaFit: 'fill', mediaMax: 704` renders `data-media-fit="fill"` and `--rb-media-max: 704px`.
  - A section without them renders neither, and today's renderer snapshots are unchanged.
  - `rebuildCss` contains `[data-media-fit=fill] .rb-media img`.

- [ ] **Step 3: Run them to verify they fail**
  Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts apps/workers/src/templates`. Expected: the new tests FAIL; the old ones PASS.

- [ ] **Step 4: Implement**
  - `mergeRebuildEdits`: per section key, per theme key, and `hero` whole, with the operator's value winning. The operator's `order`, `hidden`, `dropped` and `customCss` are used as they are. With no modernize it returns the operator's edit unchanged.
  - In `planRebuild`:
    - the hero photo move runs after `withoutDropped` and before `planSection`, on copies of the read sections, never mutating the input;
    - the card conversion runs inside `planSection`, before `collapsed` is computed;
    - the hero CTA runs after the header CTA label is known (compute `ctaLabel` before planning the sections);
    - the type scale override runs after `typeScale`.
  - Record each code through `rec.fix` with the prefix from `from(path)`. Existing `edit:style:<i>` and `edit:theme` codes apply only to fields from the operator.
  - Renderer: two attributes/variables in `renderSection`, one rule in `STATIC_CSS`:
    ```css
    [data-media-fit=fill] .rb-media img { width: 100%; max-width: var(--rb-media-max, 100%); aspect-ratio: 4/3; object-fit: cover; }
    ```

- [ ] **Step 5: Run and verify**
  Run: `npx vitest run apps/workers/src/services apps/workers/src/templates`. Expected: PASS, with no existing test edited.

- [ ] **Step 6: Commit**: `feat(REV-114): plan the modernize layer under the operator's edit`

---

### Task 4: The deterministic default and the model call

**Files:**
- Create: `apps/workers/src/services/rebuild-modernize.ts`, `apps/workers/src/services/rebuild-modernize.service.ts`
- Modify: `apps/workers/src/services/rebuild-edit.service.ts` (outline and prompt)
- Test: `apps/workers/src/services/__tests__/rebuild-modernize.spec.ts`, `rebuild-modernize.service.spec.ts`, `rebuild-edit.service.spec.ts`

**Interfaces:**
- Consumes: `buildRebuildOutline`, `LlmClient`, `extractJsonObject`, `checkRebuildEdit`, `RebuildModernizeAnswerSchema`.
- Produces:
  ```ts
  defaultModernDesign(read: ISiteSections): IRebuildModernizeAnswer
  modernizeForAudit(stored: IRebuildModernize | null | undefined, audit: Partial<IAudit> | undefined): IRebuildModernize | undefined   // auditId match and checkRebuildEdit pass, else undefined with a log line
  class RebuildModernizeService { constructor(options?: MvpEditServiceOptions); choose(input: { siteSections: ISiteSections; brandColors: string[] }): Promise<Omit<IRebuildModernize, 'auditId'>> }
  export const rebuildModernizeService: RebuildModernizeService
  REBUILD_MODERNIZE_SYSTEM_PROMPT: string
  RebuildOutlineSection += { images: { id: string; width?: number; height?: number }[]; paragraphs: number; longestParagraph: number; background?: string; align?: string }
  ```

- [ ] **Step 1: Write the failing tests for `defaultModernDesign`**
  - On the anident fixture:
    - `hero` is `{ photo: 's-2.m0', style: 'split' }`;
    - `sections['s-9'].arrangement` is `'card-grid'`;
    - the media-beside-text sections with images get `media: 'fill'` and `mediaSide` alternating `right`, `left`, `right` in page order;
    - backgrounds alternate `page`, `tinted` from the first content section after the hero;
    - `align: 'left'` everywhere;
    - `theme` is `{ typeScale: 'modern', density: 'comfortable', corners: 'soft', font: 'humanist' }` (anident's body is Times).
  - On the falcodent fixture:
    - no `hero` (the slider hero has photos);
    - `corners: 'sharp'` (button radius 0);
    - no `font` (Montserrat);
    - sections with a background photo keep no background value.
  - Both answers pass `RebuildModernizeAnswerSchema` and `checkRebuildEdit`.

- [ ] **Step 2: Write the failing tests for `RebuildModernizeService`** (stubbed `LlmClient.complete`, as in `rebuild-edit.service.spec.ts`)
  - A valid answer gives `{ source: 'llm', design }`.
  - An invalid answer followed by a valid one gives `llm`, and the second call's user prompt contains the first rejection reason.
  - Two invalid answers (bad JSON, then an unknown id `s-99`) give `{ source: 'default', design: defaultModernDesign(read), error: 'invalid: unknown section s-99' }`.
  - A thrown call gives `source: 'default'` with `error` starting `call_failed:`.
  - No provider gives `error: 'not_configured'` and makes no call.
  - An answer with a string field (`summary`) is rejected by the strict schema.
  - The system prompt names every value of `REBUILD_EDIT_ARRANGEMENTS`, `REBUILD_MEDIA_FITS`, `REBUILD_HERO_STYLES`, `REBUILD_TYPE_SCALES` and `REBUILD_EDIT_BACKGROUNDS`.

- [ ] **Step 3: Extend the outline test in `rebuild-edit.service.spec.ts`**
  - The outline lists `images: [{ id: 's-2.m0', width: 352 }]` for anident `s-2`, and the paragraph counts.
  - The edit prompt names the new fields.
  - With `current.modernize` set, the edit user prompt carries it as `current.modernize`, so the model sees the look the operator sees. The edit's answer still holds only the operator layer.

- [ ] **Step 4: Run them to verify they fail**
  Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-modernize.spec.ts apps/workers/src/services/__tests__/rebuild-modernize.service.spec.ts apps/workers/src/services/__tests__/rebuild-edit.service.spec.ts`. Expected: FAIL.

- [ ] **Step 5: Implement**
  - The prompt is built from the constants, as `REBUILD_EDIT_SYSTEM_PROMPT` is. It states:
    - keep everything, never hide, drop or reorder;
    - answer `{"design": {...}}` with JSON only;
    - cards only where a section has 3+ short paragraphs or items;
    - the hero photo by an `m` id from a later section;
    - `banner` only for a photo at least 1000 px wide.
  - The user prompt is `{ page: buildRebuildOutline(read), brandColors, start: defaultModernDesign(read) }`.
  - Settings: `temperature: 0.2`, `timeoutMs: EDIT_LLM_TIMEOUT_MS`, and one retry with `previousAnswerRejected: <reason>` added to the user prompt.
  - The service never throws for a model failure.

- [ ] **Step 6: Run and verify** the same command. Expected: PASS.

- [ ] **Step 7: Commit**: `feat(REV-114): default modern design and the modernize model call`

---

### Task 5: The level in the render paths and the workers

**Files:**
- Modify: `apps/workers/src/services/rebuild-template.service.ts`, `apps/workers/src/services/mvp-render.ts`, `apps/workers/src/workers/deploy.worker.ts`
- Test: `apps/workers/src/services/__tests__/mvp-render.spec.ts`, `rebuild-template.service.spec.ts`, `apps/workers/src/workers/__tests__/deploy-rebuild.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4.
- Produces:
  ```ts
  rebuildLevelFor(previous: { rebuildLevel?: RebuildLevel; reasons?: string[] | null } | null | undefined, audit: Partial<IAudit>): { level: RebuildLevel; reasons: string[] }   // in mvp-render.ts
  rebuildTemplateService.renderFromAudit(lead, audit, palette?, edit?, modernize?: IRebuildModernizeAnswer, now?)
  renderMvp({ ..., modernize?: IRebuildModernize | null })    // passes modernize.design only when layout.rebuildLevel === 'modern'; summary.level set
  resolveModernize(project, auditData, level): Promise<{ modernize?: IRebuildModernize; changed: boolean }>  // deploy.worker.ts
  ```

- [ ] **Step 1: Write the failing tests**
  - `rebuildLevelFor`:
    - a previous layout with `modernize:manual` and `rebuildLevel: 'faithful'` on a dated audit stays `faithful`;
    - no previous layout on `{ siteEra: { dated: true, score: 7 } }` gives `modern` with `['modernize:dated', 'dated:7']`;
    - an undated audit or no `siteEra` gives `faithful` with `[]`.
  - `renderMvp`:
    - at `modern` it passes the design, and `rebuild.level` is `'modern'`;
    - at `faithful` with a stored modernize the HTML equals the HTML with no modernize;
    - a Bento fallback ignores the level;
    - a `modernize` with another `auditId` is ignored (Review Focus 5).
  - Generation (`deploy-rebuild.spec.ts`, mocked `rebuildModernizeService.choose`):
    - a dated audit calls `choose` once, saves `modernize` with this `auditId`, and saves `layout.rebuildLevel: 'modern'` with `modernize:dated`;
    - a stored modernize for the same audit is reused without a call;
    - a stored modernize for an older audit is unset and recomputed;
    - an undated audit makes no call;
    - `choose` returning `source: 'default'` adds `modernize:default` to the reasons.
  - Re-publish:
    - a layout switched to `modern` with no stored modernize calls `choose` once and stores it;
    - a second re-publish reuses it;
    - switching back to `faithful` keeps `modernize` stored;
    - each level change sets `editedAt` because `rebuild.level` changed (Review Focus 4);
    - reset custom design (`mvp-edit.worker`) unsets `rebuildEdit` and keeps `modernize`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run apps/workers/src/services/__tests__/mvp-render.spec.ts apps/workers/src/services/__tests__/rebuild-template.service.spec.ts apps/workers/src/workers/__tests__/deploy-rebuild.spec.ts apps/workers/src/workers/__tests__/mvp-edit.worker.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - At generation, `requested` gets `rebuildLevel` and reasons from `rebuildLevelFor` when its variant is `original`.
  - `resolveModernize` runs before `renderMvp` in generation and in each re-publish pass (only at `modern`).
  - `existingProject` selects `modernize`. `savedDesign`/`sameDesign` include `layout.rebuildLevel` and `modernize`.
  - Set `editedAt` when `project.rebuild?.level !== rendered.rebuild?.level`, alongside the existing `switched`.
  - Record a `token_usage` analytics event with stage `mvp_modernize` when the provider reports usage.

- [ ] **Step 4: Run and verify** the same command plus `npx vitest run apps/workers`. Expected: PASS.

- [ ] **Step 5: Commit**: `feat(REV-114): pick the rebuild level and store the modern design per audit`

---

### Task 6: The API takes the level

**Files:**
- Modify: `apps/api/src/routes/mvp.routes.ts`
- Test: `apps/api/src/routes/__tests__/api.routes.spec.ts`

**Interfaces:**
- Consumes: `UpdateMvpLayoutSchema` with `level`; `manualMvpLayout(previous, variant, level)`.

- [ ] **Step 1: Write the failing tests**
  - `PATCH /mvp/:id/layout`:
    - `{ variant: 'bento', level: 'modern' }` → 400 `VALIDATION_ERROR`.
    - `{ variant: 'original', level: 'modern' }` on an audit failing `rebuildEligibility` → 409 `MVP_REBUILD_UNAVAILABLE`, with nothing saved and no job.
    - Same variant and same effective level (a missing level counts as `faithful`) → 200, no write, no job.
    - Same variant with a new level → 200, the saved `layout.rebuildLevel` is `'modern'`, reasons include `rule:manual` and `modernize:manual`, and `addMvpRelayoutJob` is called once.
    - Outside review → 409 `MVP_LAYOUT_CHANGE_NOT_ALLOWED`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run apps/api/src/routes/__tests__/api.routes.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - The early return compares the variant and `(project.layout?.rebuildLevel ?? 'faithful')` with `level ?? current`.
  - The eligibility check runs for `original` as today.
  - The route saves `manualMvpLayout(project.layout, variant, level)`.

- [ ] **Step 4: Run and verify** the same command. Expected: PASS.

- [ ] **Step 5: Commit**: `feat(REV-114): switch the rebuild level through the layout endpoint`

---

### Task 7: The toggle in the Design tools

**Files:**
- Create: `apps/dashboard/src/components/leadReview/MvpRebuildLevelToggle.tsx`
- Modify: `apps/dashboard/src/api/client.ts` (`updateMvpLayout(mvpId, variant, level?)`), `apps/dashboard/src/hooks/useLeads.ts` (`UpdateMvpLayoutVariables.level?`), `apps/dashboard/src/hooks/useLiveMvpLayout.ts`, `apps/dashboard/src/components/leadReview/MvpDesignTools.tsx`, `apps/dashboard/src/i18n/locales/{en,ru,be,pl,lt}.ts`
- Test: `apps/dashboard/src/components/__tests__/MvpRebuildLevelToggle.spec.ts`, `apps/dashboard/src/i18n/__tests__/locales.spec.ts` (already checks parity)

**Interfaces:**
- Produces:
  ```ts
  useLiveMvpLayout(...) returns += { level: RebuildLevel; changeLevel(level: RebuildLevel): void; levelReason?: 'suggested' | 'defaultDesign' }
  <MvpRebuildLevelToggle value={level} onChange={changeLevel} disabled reason={levelReason} />
  ```
  - `level` is the pending pick, else `mvp.layout.rebuildLevel ?? 'faithful'`.
  - A level pick waits for re-render like a cross-renderer pick. It is settled when `mvp.rebuild?.level` equals the picked level.

- [ ] **Step 1: Write the failing tests**
  - `MvpDesignTools` shows the toggle with a live layout of `original` and hides it for `bento`.
  - Clicking **Modernized** calls the layout mutation with `{ variant: 'original', level: 'modern' }`.
  - It is disabled while `locked` or while the edit is pending.
  - Captions: `mvpLayout.level.suggested` shows when the reasons contain `modernize:dated`, and `mvpLayout.level.defaultDesign` when they contain `modernize:default`.
  - "Re-rendering…" shows until the polled MVP has `rebuild.level === 'modern'`.
  - The toggle has an accessible group label (`mvpLayout.level.label`).

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run apps/dashboard/src/components/__tests__/MvpRebuildLevelToggle.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - The toggle is an MUI `ToggleButtonGroup` with `exclusive`, `size="small"` and theme tokens only.
  - Add the locale keys in all five locales. The en values:
    - `label`: 'Look'
    - `faithful`: 'Faithful'
    - `modern`: 'Modernized'
    - `suggested`: 'Suggested: the original site looks dated'
    - `defaultDesign`: 'Standard modern design (the AI choice was not available)'

- [ ] **Step 4: Run and verify**
  Run: `npx vitest run apps/dashboard`. Expected: PASS, including locale parity.

- [ ] **Step 5: Commit**: `feat(REV-114): Faithful / Modernized toggle in the Design tools`

---

### Task 8: Real sites, recorded answers and the render script

**Files:**
- Modify: `scripts/render_rebuild.ts`
- Create: `apps/workers/src/services/__tests__/fixtures/modernize/{anident,falcodent}.json`, `apps/workers/src/services/__tests__/rebuild-modernize.recorded.spec.ts`

- [ ] **Step 1: Add the script flags**
  - `--level faithful|modern|auto`, default `auto`. `auto` uses `readSiteEra` on `page.content()`, with `contentWidth`/`fullBleedShare` from the raw reading.
  - At `modern`, call `rebuildModernizeService.choose` (with `--llm`) or `defaultModernDesign`, and pass the result to `planRebuild`.
  - `--record <dir>` writes `{ siteSections, answer }` per host.
  - Print `host: era score=<n> signs=<...> level=<l> source=<llm|default>`.
  - The script stays read-only.

- [ ] **Step 2: Run on the real sites**
  ```
  npx tsx scripts/render_rebuild.ts --llm --record apps/workers/src/services/__tests__/fixtures/modernize <out> https://anident.pl https://falcodent.pl
  npx tsx scripts/render_rebuild.ts --llm --level modern <out> https://falcodent.pl
  ```
  Expected:
  - anident.pl: `dated`, level `modern`, source `llm`. Open the HTML: a split hero with a photo, filled photos on alternating sides, cards for "DLACZEGO WARTO", left-aligned copy, tinted bands. Every section of the faithful render is present.
  - falcodent.pl: not dated, level `faithful` at `auto`. The `--level modern` render is valid and keeps every section.
  - Iterate on `defaultModernDesign` or the prompt only, never on the checks.

- [ ] **Step 3: Write `rebuild-modernize.recorded.spec.ts`**
  - For each fixture, the recorded answer passes `RebuildModernizeAnswerSchema` and `checkRebuildEdit` against its `siteSections`.
  - The modern plan passes `RebuildPlanSchema`.
  - Every section id of the faithful plan is in the modern plan, except a source section omitted as `empty` after the hero photo move.
  - Concatenating all text of the modern plan contains every paragraph of the faithful plan.

- [ ] **Step 4: Run and verify**
  Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-modernize.recorded.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit**: `test(REV-114): recorded modernize answers for anident.pl and falcodent.pl`

---

### Task 9: Gates, Chrome check, PR, merge, docs, close (AGENTS.md §4.3)

- [ ] **Step 1: Run the gates**
  - `npm run build:packages`
  - `npm run typecheck`
  - `npm run lint` (0 errors, no new warnings)
  - `npm test` (rerun with `--maxWorkers=1` if timing tests flake)
  - `npm run build`
- [ ] **Step 2: Check in Chrome** (chrome-devtools MCP), with `npm run dev` running:
  1. Use Add lead (URL only) for `https://anident.pl` and wait for the MVP.
  2. On the Prototype step, check: the layout `original` shows **Modernized** selected with the "Suggested" caption, and the preview is modern.
  3. Switch to Faithful, then back. Check that "Re-rendering…" shows, the preview reloads, and the console has no new errors.
  4. Never approve the lead.
- [ ] **Step 3: Docs in this repo**
  - `AGENTS.md` §3.2.2: `Audit.siteEra`, and the rule for a new sign.
  - `AGENTS.md` §3.2.6:
    - the level and `MvpProject.modernize`;
    - the merge order and the new vocabulary fields;
    - the rule that a new modernize choice goes into the vocabulary, the checks, the planner, the prompt and their tests;
    - `render_rebuild.ts --level`.
  - `README.md` features.
  - Commit: `docs(REV-114): …`.
- [ ] **Step 4: Open the PR**
  - Push and run `gh pr create` with the title `feat(REV-114): modernize level for the rebuilt MVP on dated sites`.
  - The body starts `Fixes [REV-114](https://linear.app/revamp-proect/issue/REV-114)`, has Problem / Changes / Verification sections (the exact commands and results), and ends with the PR attribution lines.
  - Attach the PR to the ticket and move it to In Review.
- [ ] **Step 5: Merge**
  - Merge `main` into the branch and re-run Step 1.
  - `gh pr merge --merge`, then pull `main`, `npm run build:packages` and `npm test`.
- [ ] **Step 6: Docs in `../Revamp-docs`**
  - `spec.md`: 3.2.2.5e, and the layout DTO with `level`.
  - `blueprint.md`: `Audit.siteEra`, `MvpProject.modernize`, `layout.rebuildLevel`, the rebuild section.
  - `AGENTS.md`: the Rebuild Modernize Agent prompt and schema.
  - `milestones.md`.
  - `research.md`: ADR 14.
  - Commit `docs(REV-114): …`, push, and add the commit link to the ticket.
- [ ] **Step 7: Close the ticket**: move REV-114 to Done, comment on REV-108 that its last sub-project is done, and report the links.
