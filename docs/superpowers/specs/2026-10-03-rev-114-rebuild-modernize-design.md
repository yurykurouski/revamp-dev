# REV-114: A "modernize" level for the rebuilt MVP on dated sites (design)

Ticket: [REV-114](https://linear.app/revamp-proect/issue/REV-114) (the last sub-project of [REV-108](https://linear.app/revamp-proect/issue/REV-108))
Builds on: [REV-110](https://linear.app/revamp-proect/issue/REV-110) (the rebuild), [REV-112](https://linear.app/revamp-proect/issue/REV-112) (`rebuild:flat`), [REV-113](https://linear.app/revamp-proect/issue/REV-113) (sections grouped by a model, by id), [REV-111](https://linear.app/revamp-proect/issue/REV-111) (the id-only rebuild edit), [REV-98](https://linear.app/revamp-proect/issue/REV-98) (deterministic redesign signs)
Status: design, awaiting review

## 1. Purpose

The rebuild keeps the original's colours, alignment and arrangements, and only tunes contrast, type size, line height and alt text. On a dated site this gives a page that still looks dated. anident.pl as read by the model (REV-113 recording):

- `s-1`, the hero, holds only the heading "DENTYSTA WARSZAWA URSYNÓW". The first photo is in `s-2`.
- `s-2`…`s-10` are nearly all `media-beside-text`, centred, on beige `#ede4b9`, with headings written in capitals.
- The photos are 115–352 px wide.
- `s-9` ("DLACZEGO WARTO…") is one `text` section with 26 paragraphs.

This ticket adds a second rebuild level, `modern`. It keeps every piece of content, its order and the brand colours. It changes the look:

- a hero built from the H1 and a photo;
- photos that fill their column, on alternating sides;
- left-aligned copy on a white page with brand-tinted bands;
- runs of short paragraphs or items shown as cards;
- a modern type scale and spacing.

A deterministic detector picks the level for each audit, and the operator can switch it.

### Success criteria

- anident.pl rendered at `modern` looks clearly modern. Every section and piece of the faithful rebuild is still on the page, and the only difference in omissions is the hero photo moved from `s-2`.
- falcodent.pl is detected as not dated and renders exactly as today, unless the operator switches it.
- Everything the model returns is ids and enum values, validated by Zod and checked against the page. No string from the model reaches the page.
- With no provider, or with two invalid answers, a deterministic default modern design is used and recorded (`modernize:default`).
- `planRebuild` with no `modernize` input gives exactly today's plan (existing planner tests unchanged).
- The operator switches between Faithful and Modernized in the Design tools. The switch re-publishes, and a manual choice survives a regeneration.

### Out of scope

- Any model-written text, new headings or new sections.
- Restyling the header and footer content beyond what the theme already reaches.
- Lower-casing headings written in capitals (CSS would also lower-case proper nouns).
- The duplicate React key in `MvpChangeSummary` ([REV-115](https://linear.app/revamp-proect/issue/REV-115)).

## 2. Decisions (settled with the user, 2026-10-03)

1. **One vocabulary, two layers.** The modernize choices are a restricted subset of the `IRebuildEdit` vocabulary, extended with a few new fields that the operator's edit can use too.
   - The subset has no `order`, `hidden`, `dropped` or `customCss`, so content and order are kept by construction.
   - It is stored on its own (`MvpProject.modernize`) and merged under the operator's `rebuildEdit`, field by field, as `layout.design` sits under `design` for Bento.
   - Rejected: a separate `IRebuildModernize` vocabulary (the operator can't reach its knobs, and the planner gets two input paths); a fixed preset with no model choice (drifts from the ticket).
2. **Detector at audit time.** `Audit.siteEra` holds weighted signs (REV-98's `parseHomePage` plus two measured signs). `siteComplexity` doesn't count: it describes size, not age.
3. **The level lives on the layout.** It is stored as `IMvpLayoutSelection.rebuildLevel` and changed through `PATCH /mvp/:id/layout { variant, level? }`, with the same 409 rules as a layout pick. The Design tools show a Faithful/Modernized toggle while the layout is `original`.
4. **A separate, text-only model call, made lazily and cached.**
   - `RebuildModernizeService` gets the id outline, not screenshots.
   - It runs at generation when the level is `modern`, or at the first switch to `modern`.
   - The result is stored per audit and kept when the operator switches back.
   - A deterministic default is used when the model is unavailable or invalid.
5. **The hero photo is moved, not copied.** The section it came from loses it, so every photo still appears once.

## 3. The dated-site detector

### 3.1. Shape

```ts
export const SITE_DATED_SIGNS = [
  'table_layout', 'no_viewport', 'frames', 'flash', 'narrow_fixed',   // weight 2
  'legacy_tags', 'default_font', 'old_jquery', 'stale_copyright',     // weight 1
] as const;
export const SITE_DATED_THRESHOLD = 3;

export interface ISiteEra {
  dated: boolean;          // score >= SITE_DATED_THRESHOLD
  score: number;
  signs: SiteDatedSign[];
  /** The measured content column at a 1440 px viewport, for the operator */
  contentWidth?: number;
}
```

`Audit.siteEra?: ISiteEra` and `Audit.siteEraError?: string` are declared in `@revamp/db` (`Schema.Types.Mixed` / `String`). `SiteEraSchema` lives in `@revamp/validation`.

### 3.2. Signs

| Sign | Weight | Source |
|---|---|---|
| `table_layout`, `no_viewport`, `frames`, `flash`, `legacy_tags`, `old_jquery`, `stale_copyright` | 2 / 2 / 2 / 2 / 1 / 1 / 1 | `parseHomePage(await page.content(), now)` from `site-assessment.service.ts` (REV-98), on the same page the audit already loaded. `stale_copyright` uses `STALE_COPYRIGHT_YEARS`. |
| `narrow_fixed` | 2 | `collectSiteSectionsInPage` returns `contentWidth`: the median width of the boxes tagged `data-revamp-block` at the 1440 px desktop viewport. The sign is set when `contentWidth <= 1000` and fewer than half of those blocks are full-bleed. |
| `default_font` | 1 | `siteSections.typography.body.family` is the browser default (`Times`, `Times New Roman`, `serif`, case-insensitive). |

The pure function `readSiteEra({ signals, contentWidth, fullBleedShare, typography, now })` lives in `apps/workers/src/services/site-era.service.ts`.

The audit worker calls it after the section reader. If it throws, or the page content can't be read, the audit stores `siteEraError` and carries on, and the level stays faithful. No LLM is involved.

## 4. The vocabulary (extends REV-111)

### 4.1. New fields on `IRebuildEditAnswer` (and the operator's `IRebuildEdit`)

```ts
export const REBUILD_EDIT_ARRANGEMENTS = ['card-grid', 'list'] as const;   // the only overrides
export const REBUILD_MEDIA_FITS = ['natural', 'fill'] as const;
export const REBUILD_HERO_STYLES = ['split', 'banner'] as const;
export const REBUILD_TYPE_SCALES = ['original', 'modern'] as const;

interface IRebuildSectionEdit {
  background?; align?; density?;                       // REV-111
  arrangement?: (typeof REBUILD_EDIT_ARRANGEMENTS)[number];
  mediaSide?: 'left' | 'right';
  media?: (typeof REBUILD_MEDIA_FITS)[number];
}
interface IRebuildEditAnswer {
  // order, hidden, dropped, sections, theme, customCss as in REV-111
  hero?: { photo: string /* s-<i>.m<n> */; style: (typeof REBUILD_HERO_STYLES)[number] };
  theme?: { font?; density?; corners?; headingCase?; typeScale?: (typeof REBUILD_TYPE_SCALES)[number] };
}
```

New piece id: `s-<i>.m<n>` is the n-th image of the read section's `images` (before `mediaFirst` reorders them). It is allowed only in `hero.photo`. `dropped` keeps its `t|i|x` pattern.

### 4.2. Checks (`checkRebuildEdit`, extended)

Every REV-111 rule still applies. New rules:

- **`arrangement`:**
  - `card-grid` or `list` on a `text` section with at least 3 intro paragraphs, each at most 300 characters;
  - `card-grid` on a `list` section with at least 3 items;
  - the read arrangement itself (a no-op);
  - anything else fails with `s-<i> cannot be shown as <arrangement>`.
- **`mediaSide` and `media`:** only on a `media-beside-text` section that has an image.
- **`hero`:**
  - The page must have an h1 section (`rebuildH1Section`).
  - That section must not already show a photo (its own `images`, `style.backgroundImage` or photo slides).
  - `photo` must name an existing image with an `http(s)` `src` in a hero or content section after the h1 section.
  - `style: 'banner'` needs that image to be at least `REBUILD_BANNER_MIN_WIDTH` (1000) px wide.

`RebuildModernizeAnswerSchema = RebuildEditAnswerSchema.omit({ order, hidden, dropped, customCss })`, strict. `hasRebuildEdit` counts the new fields.

### 4.3. Applying it (`planRebuild`)

`RebuildInput` gains `modernize?: IRebuildModernizeAnswer`. Inside the planner, `mergeRebuildEdits(modernize, edit)` builds the edit that is applied:

- The operator's value wins per field: per section key, per theme key, and for `hero` as a whole.
- The operator's `order`, `hidden`, `dropped` and `customCss` are used as they are.
- With no `modernize`, the merged edit is `edit` unchanged, so today's plan is unchanged.

Codes: a choice that comes from the modernize layer is recorded as `modernize:<code>` in `summary.tuning`. A choice the operator made keeps its `edit:<code>`.

Applying each new field:

1. **Cards from paragraphs** (`arrangement` on a `text` section). Each intro paragraph becomes an item `{ text: [p], links: [] }`.
   - `columns` is 3, or 2 when the longest paragraph is over 160 characters.
   - The `t<n>` ids keep pointing at the same paragraphs, so the operator's `dropped` still works. Drops are applied first, then the cards are built.
   - The heading, eyebrow and links stay in the intro. Code `cards:<i>`.
2. **Cards from a list** (`list` → `card-grid`). The arrangement changes and the items stay. Code `cards:<i>`.
3. **`mediaSide`** sets the section's `mediaSide`. Code `side:<i>` (modernize only).
4. **`media: 'fill'`** sets `mediaFit: 'fill'` and `mediaMax` (twice the image's natural width, at most 1200) on the planned section. Code `fill:<i>`.
5. **`hero`.** The photo is removed from its source section (it moves; the source section's other content stays) and placed in the h1 section:
   - `split`: the hero becomes `media-beside-text`, `mediaSide: 'right'`, `mediaFit: 'fill'`, with the photo eager.
   - `banner`: the photo becomes `style.backgroundImage` with the existing banner overlay (`overlay:<i>`, white text).
   - A source section left empty is omitted as `empty`, as today.
   - Code `hero-photo:<s-i.mn>`.
   - When the hero has no link of its own, it gets the page's booking CTA (`{ label: header CTA label, href: '#booking', kind: 'booking' }`; the header CTA label is the original's own CTA text, else the localised `sendRequest`). Code `hero-cta`. No fact is added: the CTA already exists in the header.
6. **`typeScale: 'modern'`**: `h1Size` 56, `h2Size` 36, `bodySize` at least 17. Code `type`. The responsive clamps in `rebuildCss` stay.

Backgrounds, align, density, font, corners and heading case work as in REV-111, with `modernize:` codes when they come from the modernize layer.

`IRebuildSection` gains `mediaFit?: 'natural' | 'fill'` and `mediaMax?: number` (`RebuildPlanSchema`: enum, int 1..1200). `RebuildPlanSchema` still gates the result, so a bad combination can only cause `rebuild:invalid`.

### 4.4. Rendering

`renderSection` emits `data-media-fit="fill"` and `--rb-media-max: <n>px` when they are set. `STATIC_CSS` gains:

```css
[data-media-fit=fill] .rb-media img { width: 100%; max-width: var(--rb-media-max, 100%); aspect-ratio: 4/3; object-fit: cover; }
```

Card grids, the banner and media-beside-text use the existing renderers. No new arrangement renderer is needed, and there is no per-site CSS.

## 5. The modern design

### 5.1. Deterministic default: `defaultModernDesign(siteSections, primary)`

A pure function in `apps/workers/src/services/rebuild-modernize.ts`. It returns an answer that always passes `checkRebuildEdit`:

- **Theme:**
  - `typeScale: 'modern'`, `density: 'comfortable'`;
  - `corners: 'soft'`, unless the read button radius is 0 (then `sharp`);
  - `font: 'humanist'` when the body font is the browser default, else unset (the original's font is kept);
  - `headingCase: 'none'` unless the read typography is uppercase.
- **Sections:** the hero and content sections in order.
  - `align: 'left'`, except on a hero `banner`.
  - `background` alternates `page` / `tinted`, starting with `page` after the hero. Sections with a background photo keep `original`.
  - Every `media-beside-text` section with an image gets `media: 'fill'`, with `mediaSide` alternating `right`, `left`, … in page order.
  - A `text` section that fits gets `arrangement: 'card-grid'`, and a `list` with at least 3 items gets `card-grid`.
- **Hero:** when the h1 section has no photo, the first image of at least 300 px width in the next three hero or content sections becomes the hero photo, `banner` if it is at least 1000 px wide, else `split`.

### 5.2. The model: `RebuildModernizeService.choose(input)`

- **Input:**
  - the page outline from `RebuildEditService` (section id, kind, arrangement, role, heading, piece ids with 160-character previews), extended with image ids and sizes, paragraph counts and lengths, and the read background and alignment;
  - the brand colours;
  - the default design, as a starting point the model may keep or change.
- **Provider:** `LlmClient` with the copywriting default (`MVP_LLM_PROVIDER`, `claude-cli` locally). No vision.
- **Prompt:** `REBUILD_MODERNIZE_SYSTEM_PROMPT`, written from the same constants as the schema. Its rules:
  - choose only from the listed values;
  - never hide, drop or reorder;
  - pick the hero photo by id;
  - cards only where the content fits;
  - say nothing about the page's text.
- **Output:** `{ design: RebuildModernizeAnswerSchema }`. JSON only, no summary.
- **Checks:** Zod, then `checkRebuildEdit`. A rejected first answer is retried once, with the reason added to the prompt (as in REV-113).
- **Result:**
  - `{ source: 'llm', design }` on success;
  - otherwise `{ source: 'default', design: defaultModernDesign(...), error: <reason> }` (`not_configured`, `call_failed: …`, or `invalid: <reason>` after the retry). It never throws for a model failure.

### 5.3. Storage

`MvpProject.modernize?: IRebuildModernize = { auditId; source: 'llm' | 'default'; design: IRebuildModernizeAnswer; error?: string }` is declared in `@revamp/db` (`Mixed`), with `RebuildModernizeSchema` (strict) in `@revamp/validation`.

- It is used only when its `auditId` matches the rendered audit (`modernizeForAudit`, as `editForAudit` does).
- A stored design that no longer passes `checkRebuildEdit` is ignored with a log line, and the default is used for that render.
- A regeneration from a newer audit unsets it, as `rebuildEdit` is unset.

## 6. The level

### 6.1. State

`IMvpLayoutSelection.rebuildLevel?: 'faithful' | 'modern'` (`REBUILD_LEVELS`, `MvpLayoutSelectionSchema`). It is set only when `variant` is `original`. A missing value means faithful, so every existing MVP is unchanged.

Reason codes, within the layout's 12 codes of 60 characters:

- `modernize:dated` and `dated:<score>` when the detector chose `modern`;
- `modernize:manual` when the operator chose (either level);
- `modernize:default` when the stored design is the deterministic default.

`manualMvpLayout(previous, variant, level?)` keeps the previous `rebuildLevel` unless a level is given, and drops `modernize:dated`, `dated:*` and `modernize:default` (render outcomes).

### 6.2. Deciding it: `rebuildLevelFor(previous, audit)`

1. If the previous layout has `modernize:manual`, keep its `rebuildLevel`.
2. Otherwise use `modern` when `audit.siteEra?.dated`.
3. Otherwise use `faithful`.

It is used at generation, and only when the chosen variant is `original`.

### 6.3. Flow

- **Generation (`deploy.worker`):**
  - The worker picks the level.
  - If the level is `modern`, it uses the stored `modernize` for this audit, or calls `RebuildModernizeService` and stores the result.
  - `renderMvp` passes `modernize.design` only when the level is `modern`. A Bento fallback ignores the level.
- **Relayout (`relayout-mvp`):** the same steps. A first switch to `modern` computes and stores the design inside the job, so the switch takes as long as the model call. The dashboard shows "Re-rendering..." (`editedAt` is set when the page changes).
- **Free-text change (`RebuildEditService`):** the outline describes the merged look. The model may set the new fields in the operator's edit, and `checkRebuildEdit` checks them the same way.
- **Reset custom design:** drops `rebuildEdit` only. The level and `modernize` stay.

### 6.4. API

`UpdateMvpLayoutSchema = { variant, level?: 'faithful' | 'modern' }`, with a `.refine` that `level` is allowed only when `variant === 'original'` (`400 VALIDATION_ERROR`).

`PATCH /mvp/:id/layout`:

- `200` with no write when both the variant and the effective level are unchanged.
- `409 MVP_LAYOUT_CHANGE_NOT_ALLOWED` outside review.
- `409 MVP_REBUILD_UNAVAILABLE` for `original` when the audit can't be rebuilt.
- Otherwise it saves `manualMvpLayout(previous, variant, level)`, adding `modernize:manual` when a level was given, and queues `relayout-mvp`.

No new error code.

### 6.5. Dashboard

- `MvpDesignTools`: under the layout picker, a `ToggleButtonGroup` with **Faithful** / **Modernized**.
  - It shows only while the live layout is `original`, and is disabled under the pickers' lock.
  - A caption shows `mvpLayout.level.suggested` when the reasons hold `modernize:dated`, and `mvpLayout.level.defaultDesign` when they hold `modernize:default`.
- `useLiveMvpLayout` gains `level` / `changeLevel`, which call the same layout mutation with `{ variant: 'original', level }`.
- New keys in en, ru, be, pl, lt: `mvpLayout.level.label`, `.faithful`, `.modern`, `.suggested`, `.defaultDesign`.

## 7. Testing

- **`@revamp/validation`:**
  - `SiteEraSchema`, `RebuildModernizeSchema` and `RebuildModernizeAnswerSchema` (strict, no strings).
  - `checkRebuildEdit` fit rules (each arrangement rule and its boundary at 3 paragraphs and 300 characters, side/fit on a section without media, hero photo id, banner width, hero already has a photo).
  - `UpdateMvpLayoutSchema` level refine, `manualMvpLayout` with a level, `hasRebuildEdit` with the new fields.
- **Detector (`site-era.spec.ts`):** each sign, the weights, the threshold boundary (2 vs 3), `narrow_fixed` at 1000/1001 and full-bleed share, default font names.
- **Section reader:** `contentWidth` fixture test in `site-sections.page.spec.ts`.
- **Planner:**
  - No `modernize` gives today's plan (the existing tests stay unchanged, plus a snapshot on the anident fixture).
  - Cards from paragraphs and from a list, with `dropped` applied first.
  - Side, fill and `mediaMax`.
  - Hero split and banner: the photo moves, an emptied source section is omitted as `empty`, and the CTA is added only when the hero has no link.
  - Type scale.
  - The operator's edit wins per field.
  - `modernize:` versus `edit:` codes.
- **Renderer:** `data-media-fit`, `--rb-media-max`.
- **`defaultModernDesign`:** passes `checkRebuildEdit` on the anident and falcodent fixtures, and on anident it yields a split hero from `s-2.m0`, cards for `s-9`, and alternating sides.
- **`RebuildModernizeService`** (stubbed `LlmClient`): a valid answer; invalid JSON, a Zod failure and a failing check each retry once and then fall back to the default with the reason; not configured → default with `not_configured`.
- **Recorded answers** (`rebuild-modernize.recorded.spec.ts`): real anident.pl and falcodent.pl answers saved by `scripts/render_rebuild.ts --record`. Each passes the checks, and the planned page keeps every section of the faithful plan.
- **Workers:**
  - `rebuildLevelFor` (manual kept, dated → modern, else faithful);
  - generation computes and stores `modernize` only at `modern`;
  - relayout computes it on the first switch and reuses it after;
  - an older audit's `modernize` is ignored and dropped at regeneration;
  - reset keeps `modernize`.
- **API:** `level` with a Bento variant → 400; `original` + level on an audit that can't be rebuilt → 409; same level → 200 with no job; a new level → saved with `modernize:manual` and a job queued.
- **Dashboard:** the toggle shows only on `original`, calls the mutation, shows the captions, and is disabled under the lock. Locale key parity.

## 8. Checking on real sites

`scripts/render_rebuild.ts` gains `--level faithful|modern|auto` (default `auto`, the detector's choice) and `--record <dir>`, which saves the outline and the model's answer. It stays read-only.

```
npx tsx scripts/render_rebuild.ts --llm <out> https://anident.pl https://falcodent.pl
npx tsx scripts/render_rebuild.ts --llm --level modern <out> https://falcodent.pl
```

anident.pl must come out modern with all its content. falcodent.pl must stay faithful at `auto`.

Then in Chrome:

1. Create a fresh lead with Add lead (URL only).
2. Open its Prototype step and check the toggle both ways, the preview reload and the console.
3. Never approve the lead.

## 9. Documentation

- `AGENTS.md` §3.2.2: the dated detector (`Audit.siteEra`, `SITE_DATED_SIGNS`; a new sign goes into the constants, the schema, `readSiteEra` and its tests).
- `AGENTS.md` §3.2.6: the level, `MvpProject.modernize`, the merge order, the new vocabulary fields and the rule that a new modernize choice goes into the vocabulary, the checks, the planner, the prompt and their tests.
- `README.md` features.
- `../Revamp-docs`:
  - `spec.md`: a new 3.2.2.5e and the layout endpoint DTO;
  - `blueprint.md`: `Audit.siteEra`, `MvpProject.modernize`, `layout.rebuildLevel`, the rebuild section;
  - `AGENTS.md`: the Rebuild Modernize Agent prompt and schema;
  - `milestones.md`;
  - `research.md`: new ADR 14, modernize as a layer under the operator's edit, chosen by a model by id with a deterministic default.
