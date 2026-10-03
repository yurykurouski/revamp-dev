# REV-111 Edits, Design Tools and Completeness on the Rebuilt MVP: Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking. Work task by task, test first, and commit at the end of each task.

**Goal:** The free-text change, reset custom design and custom CSS work on a rebuilt (`original`) MVP through a separate, id-only rebuild edit. The completeness report is re-checked in code on every re-publish. Regeneration keeps the edit while the audit is the same.

**Architecture:**
- `IRebuildEdit` (ids and enum values, plus sanitized CSS) is stored on `MvpProject.rebuildEdit` with the `auditId` its ids belong to.
- `planRebuild` applies it while planning: hide, drop pieces, order, section style, theme, CSS. Everything is recorded in the summary, and `RebuildPlanSchema` still gates the result.
- `RebuildEditService` asks the model for an edit against an outline of `Audit.siteSections`, then checks it with Zod, `checkRebuildEdit` and `sanitizeMvpCss`.
- `processMvpEditJob` branches on the variant. `republishSavedMvp` passes the edit and saves a fresh deterministic completeness report.

**Tech Stack:** TypeScript, Zod (`@revamp/validation`), Mongoose (`@revamp/db`), BullMQ workers, React/MUI dashboard, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-rev-111-rebuild-edits-design.md`

## Global Constraints

- The model never writes copy or markup on a rebuilt page. Its answer may hold ids, enum values, a hex colour from the candidates, a layout variant, CSS that passes `sanitizeMvpCss`, and a `summary` shown only to the operator.
- `planRebuild(input)` without `input.edit` returns exactly today's plan, and every existing planner and renderer test passes unchanged.
- Ids: section `s-<index>` (`^s-\d{1,3}$`); piece `s-<i>.t<n>` / `.i<n>` / `.x<n>` (`^s-\d{1,3}\.[tix]\d{1,3}$`), indexed into the *read* section's `intro.text` / `items` / `extra`.
- Caps: `order`/`hidden` ≤ `SITE_SECTIONS_LIMITS.sections`; `dropped` ≤ 200; `customCss` ≤ `MVP_CUSTOM_CSS_MAX`; outline preview 160 chars per piece.
- Padding by density: compact 48, comfortable 72, airy 112. Corners: sharp 0, soft 6, rounded 12, extra-round 999. Backgrounds: page `#ffffff`, tinted = primary at 8% over white, brand = primary, dark `#111827`, original = read.
- Every new MvpProject field is declared in `@revamp/db`.
- Run vitest from the repo root: `npx vitest run <path>`. Never run it inside `apps/workers`.
- Under load, rerun with `npm test -- --maxWorkers=1` before suspecting a test.
- Commits: `feat(REV-111): …` / `test(REV-111): …` / `docs(REV-111): …`, ending with the session's Co-Authored-By and Claude-Session lines.

## Review Focus

1. **The h1 section.** It cannot be hidden, and if it opens the page it stays first (`checkRebuildEdit`). Otherwise `h1:hidden` would change silently. Task 1.
2. **The hidden section held the original form.** The booking form must be appended before the footer (`booking:appended`), and `id="booking"` must still appear exactly once. Task 4.
3. **An edit from an older audit** after a re-audit. Its ids would point at other sections, so it is dropped at generation and ignored at render. Tasks 6 and 7.
4. **Background tokens over a photo section.** The photo and overlay stay, and the text stays white. Task 4.
5. **Completeness on re-publish.** It replaces an LLM-judged report with a deterministic one. That is intended (decision 3), and the report's `method` shows it. Task 7.

---

## File Structure

| File | Change |
|---|---|
| `packages/shared-types/src/index.ts` | `REBUILD_EDIT_BACKGROUNDS`, `REBUILD_EDIT_ALIGNS`, `IRebuildSectionEdit`, `IRebuildEdit`; `REBUILD_OMISSIONS` + `text`, `item`; `IRebuildPlan.customCss?`; `IMvpProject.rebuildEdit?`; drop `MVP_EDIT_UNSUPPORTED` |
| `packages/validation/src/index.ts` | `RebuildEditAnswerSchema`, `RebuildEditSchema`, `RebuildEditOutputSchema`, `checkRebuildEdit`, `hasRebuildEdit`, `REBUILD_EDIT_LIMITS`; `RebuildPlanSchema.customCss` |
| `packages/validation/__tests__/rebuild-edit.spec.ts` | new |
| `packages/db/src/models/MvpProject.model.ts` | `rebuildEdit: Mixed` |
| `apps/workers/src/templates/shared/fonts.ts` | `FONT_STACKS` moved from `design.ts` |
| `apps/workers/src/services/rebuild-plan.service.ts` | `RebuildInput.edit`; apply the edit |
| `apps/workers/src/templates/rebuild/{sections,styles}.ts` | `data-revamp-section`; `customCss` |
| `apps/workers/src/templates/css-sanitizer.ts` | `REBUILD_CSS_HOOKS`; `.rb-header` may be sticky |
| `apps/workers/src/services/rebuild-template.service.ts`, `mvp-render.ts` | pass the edit when its `auditId` matches |
| `apps/workers/src/workers/deploy.worker.ts` | keep or drop the edit at generation; pass it and re-check completeness on re-publish |
| `apps/workers/src/services/rebuild-edit.service.ts` | new: outline, prompt, `RebuildEditService` |
| `apps/workers/src/workers/mvp-edit.worker.ts` | rebuild branch; reset on rebuild |
| `apps/api/src/routes/mvp.routes.ts` | drop the 409 |
| `apps/dashboard/src/hooks/useLeads.ts`, `components/leadReview/{MvpDesignTools,MvpEditPrompt}.tsx`, `i18n/locales/*.ts` | prompt on rebuild, per-renderer reset, new strings |

---

### Task 1: Types, schemas and checks

**Files:** `packages/shared-types/src/index.ts`, `packages/validation/src/index.ts`, test `packages/validation/__tests__/rebuild-edit.spec.ts`

- [ ] **Step 1: Failing tests** for:
  - The schemas: a valid full edit; an unknown key (strict); a bad section id `x-1`; a bad piece id `s-1.q0`; `order` over the cap; `dropped` over 200; `customCss` over `MVP_CUSTOM_CSS_MAX`; a string in `sections.s-1.background` outside the enum.
  - The output schema: `RebuildEditOutputSchema` accepts `{summary, edit: null, primaryColor: null, layout: null}` and `{summary, edit: {}}`.
  - `checkRebuildEdit(edit, siteSections)` returns `{ ok: true }` or `{ ok: false, reason }`, with these cases:
    - an unknown section id;
    - a header or footer id;
    - an unknown piece index;
    - a repeated id in `order`;
    - all sections hidden;
    - the h1 section hidden;
    - the h1 section moved off first place when it opens the page;
    - an h1 section not opening the page may move;
    - an unknown key in `sections`.
  - `hasRebuildEdit`: `undefined`, `{auditId}` alone and `{auditId, order: []}` are false; any field set is true.
- [ ] **Step 2:** Run `npx vitest run packages/validation/__tests__/rebuild-edit.spec.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Shared-types:

```ts
export const REBUILD_EDIT_BACKGROUNDS = ['original', 'page', 'tinted', 'brand', 'dark'] as const;
export type RebuildEditBackground = (typeof REBUILD_EDIT_BACKGROUNDS)[number];
export const REBUILD_EDIT_ALIGNS = ['left', 'center'] as const;
export interface IRebuildSectionEdit { background?: RebuildEditBackground; align?: (typeof REBUILD_EDIT_ALIGNS)[number]; density?: MvpDesignDensity }
export interface IRebuildEdit {
  auditId: string;
  order?: string[];
  hidden?: string[];
  dropped?: string[];
  sections?: Record<string, IRebuildSectionEdit>;
  theme?: { font?: MvpDesignFont; density?: MvpDesignDensity; corners?: MvpDesignCorners; headingCase?: 'none' | 'uppercase' };
  customCss?: string;
}
```

`REBUILD_OMISSIONS` gains `'text', 'item'`. Add `IRebuildPlan.customCss?: string`. Validation:

```ts
export const REBUILD_EDIT_LIMITS = { dropped: 200 } as const;
const SectionId = z.string().regex(/^s-\d{1,3}$/);
const PieceId = z.string().regex(/^s-\d{1,3}\.[tix]\d{1,3}$/);
export const RebuildEditAnswerSchema = z.object({
  order: z.array(SectionId).max(SITE_SECTIONS_LIMITS.sections).optional(),
  hidden: z.array(SectionId).max(SITE_SECTIONS_LIMITS.sections).optional(),
  dropped: z.array(PieceId).max(REBUILD_EDIT_LIMITS.dropped).optional(),
  sections: z.record(SectionId, z.object({ background: z.enum(REBUILD_EDIT_BACKGROUNDS).optional(), align: z.enum(REBUILD_EDIT_ALIGNS).optional(), density: z.enum(MVP_DESIGN_DENSITIES).optional() }).strict()).optional(),
  theme: z.object({ font: z.enum(MVP_DESIGN_FONTS).optional(), density: z.enum(MVP_DESIGN_DENSITIES).optional(), corners: z.enum(MVP_DESIGN_CORNERS).optional(), headingCase: z.enum(['none', 'uppercase']).optional() }).strict().optional(),
  customCss: z.string().max(MVP_CUSTOM_CSS_MAX).optional(),
}).strict();
export const RebuildEditSchema = RebuildEditAnswerSchema.extend({ auditId: z.string().regex(/^[a-f0-9]{24}$/i) }).strict();
export const RebuildEditOutputSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  edit: RebuildEditAnswerSchema.nullable().optional(),
  primaryColor: z.string().regex(/^#[A-Fa-f0-9]{6}$/).nullable().optional(),
  layout: MvpLayoutVariantSchema.nullable().optional(),
});
```

`MVP_CUSTOM_CSS_MAX` is a workers constant today. Move it into `@revamp/validation` and re-export it from `css-sanitizer.ts`, so both import one value. `checkRebuildEdit` finds the h1 section exactly as the planner does: the first `role === 'hero'` section with a non-empty heading, among `hero`/`content` sections. Add `RebuildPlanSchema.customCss: z.string().max(MVP_CUSTOM_CSS_MAX).optional()`.
- [ ] **Step 4:** Run the spec plus `npx vitest run packages/validation`. Expect PASS. Run `npm run build:packages`.
- [ ] **Step 5:** Commit `feat(REV-111): rebuild edit types, schemas and checks`.

### Task 2: Store the edit

**Files:** `packages/db/src/models/MvpProject.model.ts`, `packages/shared-types` (`IMvpProject.rebuildEdit?: IRebuildEdit`)

- [ ] Add `rebuildEdit: { type: Schema.Types.Mixed }` with a `// REV-111` comment beside `design`. Add a db test asserting the path exists, matching the existing model spec if there is one. Then `npm run build:packages`, and commit `feat(REV-111): MvpProject.rebuildEdit`.

### Task 3: Share the font stacks

**Files:** new `apps/workers/src/templates/shared/fonts.ts`; `templates/design.ts` imports it.

- [ ] Move `FONT_STACKS` out unchanged and re-export it from `design.ts` for existing importers. Run `npx vitest run apps/workers/src/templates`: Bento snapshots unchanged. Commit `refactor(REV-111): share font stacks between renderers`.

### Task 4: The planner applies the edit

**Files:** `apps/workers/src/services/rebuild-plan.service.ts`, test `apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts` (new `describe('edit (REV-111)')`)

- [ ] **Step 1: Failing tests** on the existing fixtures:
  1. `planRebuild({...input})` deep-equals `planRebuild({...input, edit: undefined})` and `planRebuild({...input, edit: { auditId }})`.
  2. `hidden: ['s-2']`:
     - no `s-2` in `sections`;
     - an `omitted` entry `{what:'section', reason:'hidden'}`;
     - no nav link to `#s-2`;
     - `summary.sections` one less.
  3. Hiding the section whose embed is a form gives `bookingAppended: true` and `booking:appended`.
  4. `dropped: ['s-1.t0', 's-1.i1']`: the intro's first paragraph and the second item are gone, with omissions `{what:'text', reason:'dropped'}` and `{what:'item', reason:'dropped'}`. Dropping every piece of a section without a heading omits it as `empty`.
  5. `order: ['s-3', 's-1']`: the sections are `s-3, s-1`, then the rest in the original order, and `edit:order` is recorded.
  6. `sections: { 's-1': { background: 'dark', align: 'center', density: 'airy' } }`:
     - `style.background === '#111827'`;
     - the text contrast is at least 4.5;
     - `align === 'center'`;
     - `paddingY === 112`;
     - `edit:style:1` is recorded.
     
     A `brand` background on a photo section keeps `backgroundImage` and white text.
  7. `theme: { font: 'serif', corners: 'extra-round', density: 'compact', headingCase: 'uppercase' }`:
     - `bodyFont` and `headingFont` hold the serif stack;
     - `buttonRadius === 999`;
     - every `itemStyle.radius` is 999 (where an itemStyle exists);
     - every section without its own density has `paddingY` 48;
     - `headingUppercase` is true;
     - `edit:theme` is recorded.
     
     `serif-display` changes `headingFont` only.
  8. `customCss: '.rb-heading { letter-spacing: .02em; }'` ends up in `plan.customCss`. `customCss: 'body{display:none}'` leaves no `customCss` and records `edit:css-dropped`.
  9. Every plan above passes `RebuildPlanSchema`.
- [ ] **Step 2:** Run `npx vitest run apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Add `RebuildInput.edit?: Omit<IRebuildEdit, 'auditId'>`. In `planRebuild`:
  - Before the `mainSections` map, filter out `hidden` sections (`rec.omit('section', 'hidden', heading)`).
  - Map each kept section through `withoutDropped(section, dropped, rec)`. It returns a copy without the dropped `intro.text[n]`, `items[n]` and `extra[n]`, recording `text`/`item` omissions (an `extra` block counts as `text`).
  - After the empty-section filter, sort by `order` with a stable index map.
  - Apply section style in `planSection` through a new optional `edit?: IRebuildSectionEdit` parameter. `background` is resolved before `readableText`, so contrast is computed on the new colour; density goes to `paddingY`.
  - Theme overrides go onto `theme` after `typeScale`; corners also go to each planned section's `itemStyle.radius`.
  - CSS goes through `sanitizeMvpCss`; on an `UnsafeCssError`, drop it and record `edit:css-dropped`.
  - `tinted` = `mix(primary, '#ffffff', 0.08)`. Add a `mix` helper to `rebuild-tuning.ts` with its own test in `rebuild-tuning.spec.ts`.
- [ ] **Step 4:** Run the planner and tuning specs. Expect PASS, with the earlier tests unchanged.
- [ ] **Step 5:** Commit `feat(REV-111): planRebuild applies the rebuild edit`.

### Task 5: Renderer hooks and CSS

**Files:** `templates/rebuild/sections.ts`, `templates/rebuild/styles.ts`, `templates/css-sanitizer.ts`; tests `rebuild.template.spec.ts`, `css-sanitizer.spec.ts`

- [ ] **Step 1: Failing tests.**
  - Every rebuilt section carries `data-revamp-section="s-<i>"`.
  - `rebuildCss({...plan, customCss: '.rb-cta{filter:none}'})` ends with that CSS, and the CSS appears once in the page.
  - Without `customCss`, the CSS output is unchanged.
  - The sanitizer accepts `.rb-header { position: sticky; }` and `[data-revamp-section="s-1"] .rb-heading { color: var(--rb-primary); }`, and still refuses `.rb-section { position: fixed; }`.
- [ ] **Step 2: Implement.** Add the attribute to `attrs` in `sections.ts` (footer included). In `rebuildCss`, add `${plan.customCss ? '\n' + plan.customCss : ''}` after `STATIC_CSS`. The sticky rule becomes `s.includes('.site-header') || s.includes('.rb-header')`. Add `REBUILD_CSS_HOOKS`:
  - `[data-revamp-section="s-<n>"]`, `[data-kind=…]`, `[data-arrangement=…]`;
  - `.rb-header`, `.rb-nav`, `.rb-section`, `.rb-copy`, `.rb-eyebrow`, `.rb-heading`, `.rb-item`, `.rb-item-title`, `.rb-grid`, `.rb-list`, `.rb-gallery`, `.rb-media`, `.rb-cta`, `.rb-link`, `.rb-footer`, `.booking-section`;
  - the variables `--rb-primary`, `--rb-on-primary`, `--rb-page-text`.
- [ ] **Step 3:** Run `npx vitest run apps/workers/src/templates`. Expect PASS. Commit `feat(REV-111): rebuild section hooks and custom CSS`.

### Task 6: Render paths pass the edit

**Files:** `services/rebuild-template.service.ts`, `services/mvp-render.ts`; tests `rebuild-template.service.spec.ts`, `deploy-rebuild.spec.ts`

- [ ] **Step 1: Failing tests.**
  - `renderFromAudit(lead, audit, palette, { auditId: audit._id, hidden: ['s-2'] })` has no `id="s-2"`.
  - The same edit with another `auditId` renders `s-2` and logs once.
  - `renderMvp({... rebuildEdit })` passes it through on `original` and ignores it on Bento.
- [ ] **Step 2: Implement.** Add an `edit?: IRebuildEdit` parameter. It is used only when `String(audit?._id) === edit.auditId`, passed as `edit` without `auditId` to `planRebuild`. Add `renderMvp` arg `rebuildEdit?`.
- [ ] **Step 3:** Run the specs. Expect PASS. Commit `feat(REV-111): render the rebuild with the saved edit`.

### Task 7: Deploy worker: keep the edit, re-check completeness

**Files:** `workers/deploy.worker.ts`; tests `workers/__tests__/deploy.worker.spec.ts`, `deploy-rebuild.spec.ts`

- [ ] **Step 1: Failing tests.**
  - **Re-publish:**
    - it passes `project.rebuildEdit` to `renderMvp`;
    - it `$set`s a `completenessReport` from `mvpCompletenessService.compare` (spy), with `method: 'deterministic'`;
    - a throwing `compare` keeps the old report and the re-publish still succeeds;
    - the judge is never called.
  - **Generation:**
    - an existing `rebuildEdit` with the same `auditId` is passed and kept;
    - one with a different `auditId` is `$unset` and not passed.
- [ ] **Step 2: Implement.**
  - `savedDesign` / `sameDesign` include `rebuildEdit`, so an edit saved during an upload gets its own pass.
  - After the loop, re-run completeness on the last rendered `html`, wrapped in try/catch with a log line, and `$set` it.
  - Generation selects `rebuildEdit` in `existingProject` and decides keep or drop.
  - Update the doc comment of `republishSavedMvp`.
- [ ] **Step 3:** Run both specs. Expect PASS. Commit `feat(REV-111): re-publish keeps the rebuild edit and re-checks completeness`.

### Task 8: `RebuildEditService`

**Files:** new `apps/workers/src/services/rebuild-edit.service.ts`; test `services/__tests__/rebuild-edit.service.spec.ts`

- [ ] **Step 1: Failing tests** with a stubbed `LlmClient` (inject `complete` as `MvpEditService` tests do):
  - `buildRebuildOutline(siteSections)` lists only `hero`/`content` sections, with ids, kind, arrangement, heading and pieces `{id, preview ≤160}`. An item's preview is its title, else its first text.
  - A valid answer gives a plan `{ summary, edit, changes: ['design'] }`. With `dropped` it reports `content` too.
  - Answers wrapped in a ```json fence are accepted.
  - Rejected answers: non-JSON; a Zod failure; `checkRebuildEdit` failing (unknown id, h1 hidden); unsafe CSS (`UnsafeCssError`); a colour not among the candidates.
  - `edit: {}` with a current edit present means drop. `edit: null` keeps. An answer equal to the current edit gives no change. `layout: 'split'` gives a `layout` change; `layout: 'original'` on a rebuild gives no change.
  - No provider throws the provider's unavailable reason.
  - The prompt contains every enum value from the shared constants (built from them, not typed out).
- [ ] **Step 2: Implement** by mirroring `MvpEditService`: the same `LlmClient` options, `EDIT_LLM_TIMEOUT_MS`, `extractJsonObject` and `stableJson` comparison. `REBUILD_EDIT_SYSTEM_PROMPT`:
  - lists the vocabulary from `REBUILD_EDIT_BACKGROUNDS`, `REBUILD_EDIT_ALIGNS`, `MVP_DESIGN_FONTS`/`DENSITIES`/`CORNERS`, `REBUILD_CSS_HOOKS` and the sanitizer rules;
  - forbids any text on the page;
  - tells the model, when a request needs new or reworded text, to change nothing and explain in `summary`.

  The user prompt holds `{ instruction, outline, current: { edit, primaryColor, layout: 'original' }, allowedColors, allowedLayouts }`. Export `rebuildEditService`.
- [ ] **Step 3:** Run the spec. Expect PASS. Commit `feat(REV-111): RebuildEditService turns a free-text change into an id-only edit`.

### Task 9: Edit worker: rebuild branch and reset

**Files:** `workers/mvp-edit.worker.ts`; test `workers/__tests__/mvp-edit.worker.spec.ts`

- [ ] **Step 1: Failing tests.**
  - On `layout.variant === 'original'`, `processMvpEditJob` calls the rebuild service (not `MvpEditService`), then `$set`s `rebuildEdit` with `auditId` set to the project's audit and `editedAt`, and re-publishes.
  - `{}` gives `$unset rebuildEdit`. A colour gives `colorPalette.primary`/`accent`. `layout: 'split'` gives `manualMvpLayout`.
  - `reset-design` on a rebuild with an edit gives `$unset rebuildEdit` and leaves `design` untouched. Without an edit: `applied: false`.
  - The Bento cases are unchanged.
- [ ] **Step 2: Implement.** Add a second injectable parameter `rebuildService = rebuildEditService`. The deadline and lead-lock re-checks are the same as on the Bento path.
- [ ] **Step 3:** Run the spec. Expect PASS. Commit `feat(REV-111): free-text change and reset on the rebuilt MVP`.

### Task 10: API

**Files:** `apps/api/src/routes/mvp.routes.ts`, `packages/shared-types` (`API_ERROR_CODES`); test `apps/api/src/routes/__tests__/api.routes.spec.ts`

- [ ] Replace the `MVP_EDIT_UNSUPPORTED` tests with ones showing that `POST /mvp/:id/edit` and `DELETE /mvp/:id/design` on an `original` MVP queue the job and return 200 with the worker's result. Remove the guard and the code. Run `npx vitest run apps/api` and `npm run build:packages`. Commit `feat(REV-111): the API accepts changes to a rebuilt MVP`.

### Task 11: Dashboard

**Files:** `hooks/useLeads.ts`, `components/leadReview/MvpDesignTools.tsx`, `components/leadReview/MvpEditPrompt.tsx`, `i18n/locales/{en,ru,be,pl,lt}.ts`; tests `components/__tests__/PrototypeEditPrompt.spec.ts`, the locale parity spec

- [ ] **Step 1: Failing tests.**
  - `mvpHasCustomDesign(mvp, 'original')` reads `rebuildEdit`, and `'bento'` reads `design`.
  - On `original` the prompt is enabled and shows `mvpEdit.placeholderRebuild` and `mvpEdit.groundingRebuild`.
  - The reset button follows `rebuildEdit`.
  - `mvpEdit.unsupported` is gone from all locales.
- [ ] **Step 2: Implement.**
  - `mvpHasCustomDesign(mvp, variant)` uses `hasRebuildEdit` from `@revamp/validation` for `original`.
  - `MvpDesignTools` drops `rebuilt` from `disabled` and passes `rebuilt` to `MvpEditPrompt`, which picks the placeholder and grounding keys.
  - Add the strings in the five locales.
- [ ] **Step 3:** Run `npx vitest run apps/dashboard`. Expect PASS. Commit `feat(REV-111): Design tools edit the rebuilt MVP`.

### Task 12: Gates and end-to-end check

- [ ] Run `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` (rerun with `--maxWorkers=1` on timing flakes) and `npm run build`.
- [ ] Run `npm run dev` (API, workers, dashboard).
- [ ] **Chrome** (chrome-devtools MCP):
  1. Add lead with a URL only, using a site known to rebuild (e.g. falcodent.pl). Wait for `NEEDS_APPROVAL` and a `original` layout chip.
  2. In the Prototype step, apply "Move the reviews above the services, hide the gallery, serif headings, more spacing". Check:
     - the summary says "Applied";
     - the preview reloads with the new order, no gallery, serif headings;
     - the completeness panel is refreshed (method deterministic);
     - no new console errors.
  3. Apply "Shorten the about section". Check that only whole paragraphs or items disappear.
  4. Apply "Add a line saying we have 20 years of experience". Expect "Nothing changed" with a reason.
  5. Reset the custom design and check the preview is back to the plain rebuild.
  6. Switch to Split and back: the edit is kept.

  Never approve the lead.

### Task 13: PR, merge, docs, close (AGENTS.md §4.3, steps 4–7)

- [ ] Push and open a PR titled `feat(REV-111): edits, design tools and completeness on the rebuilt MVP`. The body starts with `Fixes [REV-111](…)` and has Problem / Changes / Verification sections. Link the PR on the ticket and move it to In Review.
- [ ] Merge: pull `main`, re-run every gate, `gh pr merge --merge`, pull `main`, run `npm test`.
- [ ] **Docs:**
  - This repo: `AGENTS.md` §3.2.6 (replace the "until REV-111" sentences; the rule for new rebuild changes), and `README.md` if features are listed.
  - `../Revamp-docs`:
    - `spec.md` 3.2.2.5c and the REV-85 paragraph;
    - `blueprint.md` (rebuild section, `MvpProject.rebuildEdit`, drop the `MVP_EDIT_UNSUPPORTED` row);
    - `AGENTS.md` (`RebuildEditService` prompt and schema);
    - `milestones.md`;
    - `research.md` ADR 13.

    Commit them as `docs(REV-111): …`, push, and add the commit link to the ticket.
- [ ] Move the ticket to Done and report the links.
