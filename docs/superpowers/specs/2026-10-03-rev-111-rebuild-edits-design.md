# REV-111: Completeness check, design tools, free-text edit and regeneration on the rebuilt MVP (design)

Ticket: [REV-111](https://linear.app/revamp-proect/issue/REV-111) (sub-project 3 of [REV-108](https://linear.app/revamp-proect/issue/REV-108))
Builds on: [REV-110](https://linear.app/revamp-proect/issue/REV-110) (the rebuild), [REV-112](https://linear.app/revamp-proect/issue/REV-112) (`rebuild:flat`), [REV-113](https://linear.app/revamp-proect/issue/REV-113) (sections grouped by a model, by id), [REV-85](https://linear.app/revamp-proect/issue/REV-85) / [REV-92](https://linear.app/revamp-proect/issue/REV-92) / [REV-93](https://linear.app/revamp-proect/issue/REV-93) (free-text edit, design spec, custom CSS), [REV-36](https://linear.app/revamp-proect/issue/REV-36) / [REV-37](https://linear.app/revamp-proect/issue/REV-37) (completeness)
Status: design, awaiting review

## 1. Purpose

Since REV-110 the MVP is, by default, a rebuild of the original home page (`original` variant). Four features were built for the Bento template:

| Feature | On a rebuilt MVP today |
|---|---|
| Palette (REV-88/90) | Works: `renderFromAudit` takes `palette.primary`. |
| Regeneration (REV-31) | Works: it re-plans from `Audit.siteSections`, and a manual `original` pick survives. |
| Completeness check (REV-36/37) | Runs on the rebuilt HTML, but only at generation. A re-publish (palette, layout, edit) never re-checks it. |
| Free-text change and design spec (REV-85/92/93) | Refused: `409 MVP_EDIT_UNSUPPORTED`, and the prompt is disabled in the Design tools. |

The design spec (`IMvpDesign`) cannot be reused as it is. Its sections (`about`, `services`, `gallery`, `reviews`), hero parts, element names and model-written blocks describe Bento's fixed page. A rebuilt page has the original site's own sections, which vary from site to site.

This ticket lets the operator change a rebuilt MVP in their own words, and keeps the completeness report true after every change. The model never writes copy or markup.

### Success criteria

- On a rebuilt MVP, "move the reviews above the services, hide the gallery, serif headings, more spacing" is applied, and the preview reloads with the change.
- Everything the model returns about the page is ids and enum values, validated by Zod and checked against the page's sections. No string from the model reaches the page. The one exception is custom CSS, which only passes `sanitizeMvpCss`. The model's `summary` is shown to the operator, never put on the page.
- "Shorten the about section" drops whole paragraphs or items the model picks by id. No text is rewritten.
- Hiding the section that held the services lowers the completeness report's services check right after the re-publish.
- Reset custom design drops the rebuild edit and re-publishes the plain rebuild.
- Switching between `original` and a Bento layout keeps both renderers' edits. Each one applies only to its own renderer.
- `planRebuild` without an edit gives exactly today's plan (existing planner tests unchanged).

### Out of scope

- REV-114 (modernising dated sites with a design the model chooses).
- Any model-written text on a rebuilt page: rewritten or shortened sentences, new headings, new blocks.
- Editing the header and footer content. The theme, colour and CSS still reach them.
- The duplicate React key `phone` in `MvpChangeSummary` (separate ticket).

## 2. Decisions (settled with the user, 2026-10-03)

1. **A separate rebuild edit, by id.** New `IRebuildEdit` stored on `MvpProject.rebuildEdit`. `IMvpDesign` stays Bento's alone. Rejected: extending `IMvpDesign` (two vocabularies in one spec, Bento-only fields that do nothing on a rebuild); theme variables only (most requests would be refused).
2. **Copy is tightened by selection, never by rewriting.** The model may name paragraphs and items of a section to leave out, by id. This is the REV-113 rule ("the model may group and classify page pieces by id; it never writes copy or markup") applied to edits. Rejected: a word-level deletion-only rewrite (cuts can flip meaning, e.g. dropping "not"); no copy step at all.
3. **Completeness re-checked in code on every re-publish.** `republishSavedMvp` re-runs the deterministic comparison (no LLM judge) and saves it with `method: 'deterministic'`. Generation keeps the LLM judge. This applies to Bento re-publishes too, so the report always describes the published page.
4. **Custom CSS on the rebuild** through the same `sanitizeMvpCss`. The rebuild gets its own list of hooks for the prompt (`REBUILD_CSS_HOOKS`), and `.rb-header` joins `.site-header` as the only selector that may be `position: fixed|sticky`.
5. **Regeneration keeps its LLM copy step.** Bento copy (`generatedContent`) is still written on every generation, because the operator can switch to a template and a rebuild can fall back to Bento. A rebuild edit survives a regeneration from the same audit. When the MVP's audit changes (a new audit run), section ids no longer mean the same thing, so the edit is dropped and the drop is logged.

## 3. The rebuild edit

### 3.1. Shape (`@revamp/shared-types`, schema in `@revamp/validation`)

```ts
export const REBUILD_EDIT_BACKGROUNDS = ['original', 'page', 'tinted', 'brand', 'dark'] as const;
export const REBUILD_EDIT_ALIGNS = ['left', 'center'] as const;
// Theme vocabulary reused from the design spec: MVP_DESIGN_FONTS, MVP_DESIGN_DENSITIES, MVP_DESIGN_CORNERS

export interface IRebuildSectionEdit {
  background?: RebuildEditBackground;  // 'original' = what the reader measured
  align?: 'left' | 'center';
  density?: MvpDesignDensity;          // this section's vertical padding
}

export interface IRebuildEdit {
  /** The audit the ids were read from; an edit for another audit is dropped */
  auditId: string;
  /** Section ids (`s-<index>`) in page order; unlisted sections follow in the original order */
  order?: string[];
  /** Section ids left out */
  hidden?: string[];
  /** Piece ids left out of their section: `s-<i>.t<n>` intro paragraph, `s-<i>.i<n>` item, `s-<i>.x<n>` extra block */
  dropped?: string[];
  sections?: Record<string, IRebuildSectionEdit>;
  theme?: { font?: MvpDesignFont; density?: MvpDesignDensity; corners?: MvpDesignCorners; headingCase?: 'none' | 'uppercase' };
  /** Passes sanitizeMvpCss (REV-93) */
  customCss?: string;
}
```

`RebuildEditSchema` (Zod, strict objects). Ids must match `^s-\d{1,3}$` and `^s-\d{1,3}\.[tix]\d{1,3}$`. Caps: `order`/`hidden` up to `SITE_SECTIONS_LIMITS.sections`, `dropped` up to 200, `customCss` up to `MVP_CUSTOM_CSS_MAX`. There are no other free strings. `auditId` is set by the worker, never by the model: the model's answer uses `RebuildEditAnswerSchema`, the same schema without `auditId`.

Ids are the reader's own. `s-<index>` is already the plan's section id and DOM `id`. Piece indices are positions in the read section's `intro.text`, `items` and `extra` arrays, before the planner filters anything, so the same id always means the same piece of `Audit.siteSections`.

### 3.2. Checks (`checkRebuildEdit(edit, siteSections)`, pure, in `@revamp/validation`)

An answer that fails any of these is an error and is not applied, not even in part (the same as REV-85):

- Every id names an existing `hero`/`content` section, or a piece of one. Header and footer ids are not offered.
- `order` has no repeats. A piece id appears at most once in `dropped`.
- At least one section with content stays visible.
- The section that gets the page's `h1` (the first `hero` with a heading) is not hidden, and when it opens the page it stays first. The page keeps its opening screen and its only `h1`.
- `sections` keys are known section ids.

### 3.3. Applying it (`planRebuild(input)` with `input.edit?: IRebuildEdit`)

The edit is applied inside the planner, so the existing machinery records everything. There is no separate post-pass over a finished plan:

1. **Hidden** sections are filtered out before planning. Each is recorded as `omitted { what: 'section', reason: 'hidden' }` (new reason). The header nav then drops links to them by itself (anchors come from planned sections). If the hidden section held the original form, the booking form is appended before the footer (`booking:appended`), as today.
2. **Dropped** pieces are removed from the read section before `planSection`. Each is recorded as `omitted { what: 'text' | 'item', reason: 'dropped' }`; `REBUILD_OMISSIONS` gains `text` and `item`. A section left with nothing is omitted as `empty`, as today.
3. **Order**: planned sections are sorted by `order`, and unlisted ones keep their relative order after the listed ones. Recorded as tuning code `edit:order`.
4. **Section style**:
   - `background` sets `style.background`: `page` is `#ffffff`, `tinted` is primary mixed 8% into white, `brand` is the primary, `dark` is `#111827`, and `original` keeps the read one. Text colour is then computed by the existing `readableText`, so contrast stays at least 4.5:1. A section with a background photo keeps its photo and overlay; the colour applies behind it.
   - `align` sets `style.align`.
   - `density` sets `paddingY` to 48 / 72 / 112 (inside `clampPadding`'s 48–120).
   - Recorded as `edit:style:<index>`.
5. **Theme**:
   - `font` maps to `FONT_STACKS` (moved from `templates/design.ts` to `templates/shared/fonts.ts`, so both renderers import it). `serif-display` and `mono-display` change `headingFont` only; `system` keeps the original's stack.
   - `density` sets every section's `paddingY` unless that section has its own.
   - `corners` maps `sharp`/`soft`/`rounded`/`extra-round` to 0/6/12/999 px. It sets `theme.buttonRadius` and every section's `itemStyle.radius`.
   - `headingCase` sets `headingUppercase`.
   - Recorded as `edit:theme`.
6. **Custom CSS** goes into the plan as `customCss` (new optional field, max `MVP_CUSTOM_CSS_MAX`). It is sanitized again when planned, and a failure drops it with tuning code `edit:css-dropped`. `rebuildCss` appends it after the static CSS, as Bento does.

`RebuildPlanSchema` still validates the result, so a broken edit can only ever cause a `rebuild:invalid` fallback, never a broken page.

`renderRebuild` gains one attribute per section, `data-revamp-section="s-<i>"`, so custom CSS can target a section through the sanitizer's `data-revamp-*` rule. It also gains the `customCss` output. Nothing else in the renderer changes.

## 4. The free-text change on a rebuilt MVP

### 4.1. Flow

`POST /mvp/:id/edit` no longer refuses `original`. `processMvpEditJob` branches on the saved variant:

- **Bento**: unchanged (`MvpEditService`).
- **Original**: the new `RebuildEditService.interpret(input)`:
  - **Input**: the instruction, an outline of the page built from `Audit.siteSections` (section id, kind, arrangement, role, heading, and each piece's id with a preview of at most 160 characters), the current edit, the colour candidates (as today), and the allowed layouts (`original` and the four Bento ones).
  - **Output**: `RebuildEditOutputSchema` = `{ summary, edit: RebuildEditAnswerSchema | null, primaryColor: hex | null, layout: MvpLayoutVariant | null }`. `edit` is the complete new edit, `{}` drops it, and `null` keeps it.
  - **Checks**: Zod, then `checkRebuildEdit`, then `sanitizeMvpCss` on `customCss`, then the primary colour must be one of the candidates (as today). One attempt, as in REV-85.
  - **Errors**: a failing answer gives `502 MVP_EDIT_FAILED` with the reason. No provider gives the same error, with no stand-in.
- The worker saves only what changed:
  - `rebuildEdit` with `auditId` set to the MVP's audit, or unset when the edit is `{}`;
  - `colorPalette.primary`/`accent`;
  - `layout` through `manualMvpLayout` (a switch to Bento is allowed, as on Bento);
  - `editedAt`.
  
  Then it re-publishes. Change kinds reported to the dashboard: structure and style are `design`, and dropped pieces are `content`.

The prompt (`REBUILD_EDIT_SYSTEM_PROMPT`) is written from the same constants as the schema, as `DESIGN_VOCABULARY` is for Bento. It says the model may only reorder, hide, drop pieces by id, restyle with the listed tokens and write CSS under the sanitizer's rules. When a request needs new text, the model changes nothing and says why in `summary`.

### 4.2. Reset custom design

`DELETE /mvp/:id/design` on a rebuilt MVP unsets `rebuildEdit` (not `design`) and re-publishes. "Has a custom design" is per renderer: `hasRebuildEdit(project.rebuildEdit)` for `original`, `hasDesign(project.design)` for Bento. The dashboard's `hasCustomDesign` follows the live layout the same way.

### 4.3. API error code

`MVP_EDIT_UNSUPPORTED` has no use left. It is removed from `API_ERROR_CODES`, the API route and blueprint §5.

## 5. Rendering paths

- `rebuildTemplateService.renderFromAudit(lead, audit, palette, edit?)` passes the edit to `planRebuild` when `edit.auditId` equals the audit's id. Otherwise the edit is ignored, with a log line.
- `renderMvp` gains `rebuildEdit?: IRebuildEdit`. `republishSavedMvp` and the generation path in `deploy.worker.ts` pass `project.rebuildEdit`.
- Generation reads `rebuildEdit` along with `design` from the existing project. When the generation's audit differs from `rebuildEdit.auditId`, it unsets `rebuildEdit` and logs it.
- `MvpProject.rebuildEdit` is declared in `@revamp/db` (`Schema.Types.Mixed`, like `design`).

## 6. Completeness after a re-publish

After its last pass, `republishSavedMvp` computes the report:

```ts
mvpCompletenessService.compare(html, mvpCompletenessService.buildSource(leadData, auditData))
```

It saves it as `completenessReport`. `compare` is the existing code-only path (`method: 'deterministic'`) and never throws on a valid page. A failure is logged and the previous report kept, as at generation. The comment that says re-publishes do "no completeness re-check" is updated. No LLM call is made on a re-publish.

`buildSource` stays as it is. The source is the audit's extracted data, not `siteSections`, so the report measures the same thing for both renderers.

## 7. Dashboard

- `MvpDesignTools`: the prompt is no longer disabled for `original`.
- `MvpEditPrompt` takes the live variant:
  - On a rebuild it shows `mvpEdit.placeholderRebuild` ("e.g. Reviews above services, hide the gallery, serif headings, more spacing") and `mvpEdit.groundingRebuild` ("AI reorders, hides and restyles the original page's sections; it never writes text.").
  - Both are new keys in all five locales. `mvpEdit.unsupported` is removed.
- `useMvpDesignTools` `hasCustomDesign`: `rebuildEdit` for `original`, `design` otherwise. `Serialized<IMvpProject>` carries `rebuildEdit`.
- The completeness panel already reads `mvp.completenessReport`, and the MVP query refetches after an edit or a relayout, so the new report shows up with no UI change.

## 8. Testing

- **`@revamp/validation`**: `RebuildEditSchema` / `RebuildEditAnswerSchema` (valid, bad ids, caps, strictness, no extra strings), `checkRebuildEdit` (every rule in 3.2), `RebuildPlanSchema` with `customCss`.
- **Planner**:
  - No edit gives today's plan (snapshot on an existing fixture).
  - Hidden sections are omitted with reason `hidden`, and their nav link drops.
  - Hiding the form's section gives `booking:appended`.
  - Dropped pieces are recorded; a section left empty is omitted as `empty`.
  - Order, including unlisted sections.
  - Backgrounds keep contrast.
  - Density, corners, font and heading case.
  - Unsafe custom CSS is dropped with `edit:css-dropped`.
- **Renderer**: `data-revamp-section`, and custom CSS emitted once.
- **Sanitizer**: `.rb-header` sticky allowed; sticky on another class still refused.
- **`RebuildEditService`** (stubbed `LlmClient`): a valid answer becomes a plan; invalid JSON, a Zod failure, an unknown id, hiding the h1 section and unsafe CSS each throw; an off-list colour throws; `{}` drops; `null` keeps.
- **`processMvpEditJob`**: the rebuild branch saves `rebuildEdit` with `auditId` and re-publishes; reset-design on a rebuild unsets `rebuildEdit`; Bento is unchanged.
- **`republishSavedMvp`**: saves a fresh deterministic `completenessReport`; passes `rebuildEdit`; ignores an edit for another audit.
- **Generation**: drops `rebuildEdit` when the audit changed and keeps it when it is the same.
- **API**: `POST /mvp/:id/edit` and `DELETE /mvp/:id/design` on `original` reach the worker (no 409).
- **Dashboard**: the prompt is enabled on `original`, shows the rebuild placeholder and grounding, and the reset button follows `rebuildEdit`. Locale key parity.
- **Chrome**: a fresh lead from Add lead (URL only) with a rebuilt MVP; apply the success-criteria instruction; check the preview, the completeness panel and the console; reset. Never approve the lead.

## 9. Documentation

- `AGENTS.md` §3.2.6: the rebuild edit replaces "until REV-111 … 409 MVP_EDIT_UNSUPPORTED". New rule: a new kind of rebuild change goes into `IRebuildEdit`, its schema, `checkRebuildEdit`, the planner and their tests, and never into model-written text.
- `README.md` features, if the edit is listed there.
- `../Revamp-docs`:
  - `spec.md` 3.2.2.5c and the REV-85 paragraph;
  - `blueprint.md` (the rebuild section, `MvpProject.rebuildEdit`, error table);
  - `AGENTS.md` (`RebuildEditService` prompt and schema);
  - `milestones.md`;
  - `research.md` new ADR 13: edits on the rebuild by id, the move away from the fixed template.
