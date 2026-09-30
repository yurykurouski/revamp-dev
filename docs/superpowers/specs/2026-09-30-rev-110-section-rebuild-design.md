# REV-110: Render the MVP as a section-by-section rebuild of the original — design

Ticket: [REV-110](https://linear.app/revamp-proect/issue/REV-110) (sub-project 2 of [REV-108](https://linear.app/revamp-proect/issue/REV-108))
Builds on: [REV-109](https://linear.app/revamp-proect/issue/REV-109) (`Audit.siteSections`, PR #88)
Status: agreed in chat on 2026-09-30.

## 1. Purpose

Revamp tunes the business's own site; it does not generate a templated one (REV-108). REV-109 reads the original home page as ordered sections. This sub-project renders the MVP from those sections: one section per meaningful original section, in the original order, with a matching arrangement and the site's own copy. Tuning (contrast, type, spacing, alt text, a clear CTA, the verified contacts and the booking form) is applied on top. When the sections cannot be read well enough, the MVP falls back visibly to the Bento template and the reason is recorded.

### Success criteria

- One rendered section per section in `Audit.siteSections`, in order, with the same arrangement; every omission is recorded with a reason.
- Nothing is assembled or invented: every service, review, person, price and contact on the page comes from the original (or, for contacts, from the verified contacts).
- Tuning is applied and recorded as codes.
- A fallback to Bento is visible to the operator with its reason.
- On Falco-Dent, Dentalux and Elefant the rebuild is recognisably the same site side by side, visibly improved, with no console errors.

### Out of scope (REV-111 or later)

- Any LLM step over the copy (tightening text). The rebuild renders the copy verbatim.
- The custom design spec (REV-92) and the free-text change (REV-85) on a rebuilt MVP; they are disabled for it until REV-111.
- Adapting the completeness check (REV-36) to sections; it keeps running on the final HTML.
- Downloading images into MinIO (images are hotlinked from the original, as Bento does).
- Pages other than the home page. `research.md` (the move away from the fixed template) is updated in REV-111.

## 2. How the rebuild plugs in

### 2.1. The `original` layout variant

`MVP_LAYOUT_VARIANTS` becomes `['original', 'bento', 'split', 'editorial', 'compact']`. `layout.variant === 'original'` means the MVP is the rebuild. Bento-only tables typed by the variant (`LAYOUT_CSS`, `LAYOUT_SECTION_ORDER`, the layout `<template>`s) are keyed by `BentoLayoutVariant = Exclude<MvpLayoutVariant, 'original'>`.

- The layout picker (REV-88) lists "Original site" first. Picking a Bento variant switches to the template on purpose; picking "Original site" switches back.
- A manual pick survives regeneration through the existing `manual` reason (`manualMvpLayout`).

### 2.2. Choosing the renderer (deploy worker)

A pure `rebuildEligibility(audit)` (`rebuild-plan.service.ts`) returns `{ ok: true }` or `{ ok: false, reason }`:

| Reason code | When |
|---|---|
| `rebuild:unread` | `siteSectionsError` is set, or `siteSections` is absent |
| `rebuild:no_content` | `siteSections` has no section with the `hero` or `content` role |
| `rebuild:low_coverage` | `coverage.ratio < REBUILD_MIN_COVERAGE` (`0.85`, in `@revamp/validation`); the ratio is added as `coverage:<ratio>` |
| `rebuild:invalid` | The plan fails `RebuildPlanSchema` |
| `rebuild:too_large` | The HTML is over 300 KB (`MAX_BUNDLE_SIZE_BYTES`, as Bento) |

The first two and the coverage check come from `rebuildEligibility`; the last two are thrown by the rebuild service as `RebuildUnavailable(reason)` and caught by the deploy worker.

- New MVP: the variant is `original` with reason `rule:rebuild` when the rebuild succeeds. Otherwise the worker uses today's `deriveMvpLayout` Bento choice and adds the fallback reason codes to `layout.reasons` (codes are capped at 12 as today; the fallback codes go first).
- A manual `original` pick on a lead that cannot be rebuilt falls back the same way, keeping `manual` and adding the reason.
- The live coverage of the reference sites is 0.978 (Falco-Dent), 0.999 (Dentalux) and 0.997 (Elefant), well above the threshold.

### 2.3. Data flow

- The AI worker is unchanged: it still writes Bento copy (`generatedContent`), which the fallback and a later switch to a Bento variant need.
- The deploy worker renders the rebuild when the variant is `original`, else Bento. `republishSavedMvp` (relayout, palette, free-text re-publish) does the same, so a palette change re-renders the rebuild.
- The completeness check (REV-36) and the Before/After banner run on the final HTML, as now.

### 2.4. What is recorded

`MvpProject.rebuild` (type in `@revamp/shared-types`, schema `MvpRebuildSummarySchema` in `@revamp/validation`, declared in the `@revamp/db` MvpProject schema, so strict mode keeps it):

```ts
interface IMvpRebuildSummary {
  coverage: number;                       // siteSections.coverage.ratio
  sections: number;                       // sections rendered
  omitted: { what: RebuildOmission; reason: string; sample?: string }[]; // capped at 80
  tuning: string[];                       // fix codes, capped at 120
}
type RebuildOmission = 'section' | 'nav_link' | 'link' | 'embed' | 'image';
```

- `omitted` holds the reader's `skipped` entries (`what: 'section'`, the reader's reason) plus what the planner left out (a nav link to another page, a replaced widget, a dropped embed).
- `tuning` holds codes such as `contrast:3`, `overlay:1`, `alt:12`, `font:body-16`, `collapse:11`, `h1:hidden`.
- The field is set on a rebuild and unset (`$unset`) on a Bento render.

### 2.5. What the operator sees

- The layout chip (`MvpLayoutChip`) reads "Original site"; its tooltip summarises the counts: sections rendered, omissions and fixes.
- On a fallback the chip is `color="warning"` and the tooltip gives the reason in words, e.g. "Rebuilt from the template: only 72% of the page could be read." New strings in all five locales; the chip reads the `rebuild:*` and `coverage:*` codes.

### 2.6. Design tools on an `original` MVP (until REV-111)

- Palette: applies to the CTAs and accents of the rebuild.
- Layout picker: works as described in 2.1.
- Free-text change and custom design spec: disabled in the Design tools panel (`MvpDesignTools`) with a note. The API refuses them for an `original` MVP with a new code `MVP_EDIT_UNSUPPORTED` (409) in `API_ERROR_CODES` (and blueprint.md §5), so a stale client cannot apply a change that would have no effect.

## 3. Planner: `planRebuild` and tuning

`planRebuild(input) → IRebuildPlan` in `apps/workers/src/services/rebuild-plan.service.ts`. Pure; inputs: `siteSections`, the lead, the audit's verified contacts, brand tokens and language, and the palette. The plan (types in shared-types, `RebuildPlanSchema` in validation) is an intermediate: validated, rendered, never stored. The planner makes every decision; the renderer only turns the plan into markup.

### 3.1. Sections

- Every section in `siteSections.sections` becomes a planned section, in order, with its arrangement, `columns` and `mediaSide`. Nothing is merged, reordered or added. (Falco-Dent's heading-only "CO NAS WYRÓŻNIA" banner stays a banner above its 8-item grid, as on the original.)
- Each planned section gets an anchor id (`s-<index>`).
- Headings: exactly one `h1` — the hero's heading, else the business name visually hidden (`h1:hidden`). Section headings are `h2`, item titles `h3`.
- A `text` section with more than 1,200 characters of body keeps its heading and puts the body in a collapsed `<details>` (`collapse:<index>`), e.g. Falco-Dent's Regulamin and RODO.
- The header section provides the logo (its first image, else the brand logo, else the monogram), nav and CTA; the footer section provides its columns.

### 3.2. Links

| Link | Result |
|---|---|
| `cta` link, or a booking host (Booksy, ZnanyLekarz) | Points to `#booking`, keeping its original label |
| `tel:`, `mailto:`, a map link | Kept |
| Header nav link whose label matches a kept section's heading (case- and diacritic-insensitive) | Anchor to that section |
| Other header nav link | Dropped, recorded (`nav_link`) |
| A link to another page (any other http(s) link) | Dropped, recorded (`link`, counted per section) |

A `javascript:` or other non-http(s) URL is never rendered.

### 3.3. Embeds and the booking form

- Kept: `https` iframes on an allowlist (Google Maps, OpenStreetMap, YouTube, youtube-nocookie, Vimeo), lazy-loaded, with a `title`.
- The first `form` or `widget` embed is replaced by the booking form, in its place (`booking:replaced`).
- Other embeds are dropped and recorded (`embed`).
- With no replacement, the booking form goes just before the footer (`booking:appended`).

### 3.4. Contacts and footer

- The footer always ends with the verified contacts (`extractedContacts`, else the lead's), the business name and the social links, under the same Strict Grounding rule as Bento.
- The site's own footer section, when read, renders above that with its columns.
- A site with no footer (Falco-Dent and Elefant today) gets the verified-contacts footer only (`footer:added`).
- A verified phone is shown in the header next to the CTA.

### 3.5. Tuning (deterministic, each fix recorded)

| Area | Fix |
|---|---|
| Contrast | Each section's text color against its background: below 4.5:1 it becomes the text color darkened or lightened until it passes, else `#111111` / `#ffffff`, whichever contrasts more (`contrast:<index>`). A banner over a photo gets a dark overlay whose opacity makes white text reach AA against the darkest assumption (`overlay:<index>`). CTA text is black or white by contrast with the CTA background. |
| Type | Font families map to the nearest system stack (the `FONT_STACKS` of `design.ts`: serif, sans/humanist, geometric, rounded, mono) by family name, keeping weight and uppercase. Body text at least 16 px (`font:body-16`), line height at least 1.5. Heading sizes become `clamp()` values from the original sizes so they shrink on mobile. |
| Spacing | Section `paddingY` clamped to 48–120 px, scaled by 0.6 below 700 px. Content contained at 1,200 px unless `fullBleed`. |
| Images | `alt`: the original alt, else the item's title, else the section heading, else empty (decorative; never invented) (`alt:<count>`). `width`/`height` when known; everything after the first section lazy-loaded with `decoding="async"`. `data:` URIs never used. |
| CTA | Sticky header CTA to `#booking`: the original header CTA's label, else the locale's "Send a request". Color: `palette.primary`. When the variant is `original`, a new MVP's saved `colorPalette.primary` defaults to the site's button background (`typography.button.background`), else the brand tokens, so the default CTA keeps the site's own button color; a Bento MVP keeps the brand tokens as today. |
| Base | Viewport meta, `<html lang>` from the site's language, `prefers-reduced-motion` respected, visible keyboard focus. |

## 4. Rendering: `renderRebuild(plan)`

`apps/workers/src/templates/rebuild/`:

| File | Job |
|---|---|
| `index.ts` | `renderRebuild(plan): string` — the document shell, CSS custom properties from the plan (colors, font stacks, sizes), sections in order |
| `sections.ts` | One renderer per arrangement `(section, ctx) → string`; a shared `renderItem` renders only the fields present (image, subtitle, title, price, rating, text, links), so team cards, FAQ entries, reviews and price rows come from the same data |
| `header.ts`, `footer.ts` | Header (logo, anchor nav, sticky CTA, verified phone); footer (original columns, then the verified contacts) |
| `styles.ts` | The CSS, driven by `data-arrangement` / `data-columns` attributes and plan variables, never per-site CSS |

| Arrangement | Rendered as |
|---|---|
| `banner` | Copy over the background photo or color, with the tuning overlay |
| `media-beside-text` | CSS grid using `split` and `mediaSide`; stacks on mobile |
| `text` | Intro and paragraphs; `<details>` when collapsed |
| `card-grid` | `repeat(columns)` on desktop, 2 on tablet, 1 on mobile; `itemStyle` (radius, border, shadow, image shape, align) |
| `list` | Stacked items |
| `accordion` | Native `<details>`/`<summary>`, no JS |
| `tabs` | Radio-driven CSS tabs with labels; all panels readable without CSS |
| `slider` | Horizontal scroll-snap track with previous/next buttons (a small inline script; without JS it is a scroller); the first slide eager, the rest lazy |
| `gallery` | Responsive image grid |
| `embed` | The allowlisted iframe, or the booking form |

`extra` entries render after the items in page order (text runs as paragraphs, a second item group with its own arrangement renderer); `images` outside items render in the section's media slot (the first) or as a small gallery (the rest).

**Shared with Bento.** The booking form markup and submit script, the tracker `<script>`, the favicon/monogram, `escapeHtml` and `scriptJson` move from `bento.template.ts` into `apps/workers/src/templates/shared/`. Bento's output stays byte-identical (checked by a snapshot test taken before the move).

**Safety.** Every string is escaped; URLs are http(s) only; `tel:`/`mailto:` only from original or verified values; iframes only from the allowlist; no markup from the site or a model is copied through (REV-92).

**Service.** `rebuildTemplateService.renderFromAudit(lead, audit, palette)` in `apps/workers/src/services/rebuild-template.service.ts`: plan → `RebuildPlanSchema.parse` → render → size check. It returns `{ html, summary }` or throws `RebuildUnavailable(reason)`.

## 5. Deferred minors from REV-109

Fix only those that visibly harm the rebuild on the three reference sites, found during the side-by-side check; the likely candidates are the eyebrow ordering and a `.topbar` outside the picked header. Each fix gets the reader's fixture tests. The rest stay deferred and are listed in a REV-110 ticket comment.

## 6. Testing (Vitest)

- **Validation:** `RebuildPlanSchema`, `MvpRebuildSummarySchema` (valid, caps, invalid color/URL); the layout schemas accept `original`.
- **Planner** (`rebuild-plan.service.spec.ts`): nav → anchors; other-page links dropped and recorded; CTA and booking hosts → `#booking`; embed allowlist; form replaced by the booking form, else appended; footer merged or added; one h1; long text collapsed; contrast raised (ratio asserted); overlay; font stack mapping; font-size and spacing clamps; the alt chain (never invented); CTA color from the site's button.
- **Eligibility:** each fallback reason, including the 0.85 boundary (0.85 passes, 0.849 falls back).
- **Renderers** (`templates/__tests__/rebuild.template.spec.ts`): each arrangement, items with fields present and absent; escaping; `javascript:` rejected; a Falco-Dent-shaped fixture renders every section heading, item title and text string of the plan.
- **Page script:** the slider script under happy-dom with `enableJavaScriptEvaluation: true`.
- **Bento:** snapshot unchanged after the shared extraction.
- **Workers:** deploy renders the rebuild for `original`; each fallback reason gives Bento with the reason in `layout.reasons`; a manual pick survives regeneration; republish re-renders the rebuild with the palette; `rebuild` is saved through the real `@revamp/db` model and unset on Bento.
- **API:** free-text change and custom design on an `original` MVP → 409 `MVP_EDIT_UNSUPPORTED`; the layout PATCH accepts `original`.
- **Dashboard:** chip label and fallback tooltip; the Design tools panel disables free-text and design for `original`; picker entry; strings in all five locales.

**Real sites.** A read-only `scripts/render_rebuild.ts <url>` reads the sections and writes the rebuilt HTML to a local file (no DB or MinIO writes). Falco-Dent, Dentalux and Elefant are opened side by side with their originals in Chrome, at desktop and 375 px, with no console errors. The PR records section counts, omissions, tuning codes and screenshots.

**Chrome gate.** On the running dashboard, regenerate a test lead added through Add lead (never a real lead; never approved): the chip and tooltip, the preview, a palette change, the disabled free-text change, and a switch to a Bento variant and back.

## 7. Docs and definition of done

- `AGENTS.md` §3.2.6: the rebuild path, the `original` variant, the fallback reasons and threshold, how to add an arrangement renderer, and that tuning is recorded.
- `README.md` feature list.
- `../Revamp-docs`: `spec.md` (variant, fallback, `MVP_EDIT_UNSUPPORTED`), `blueprint.md` (`MvpProject.rebuild`, the rebuild step in the deploy flow, the error code), `milestones.md` (REV-110).
- All gates pass (`build:packages`, `typecheck`, `lint`, `test`, `build`), then PR, merge, docs, and REV-110 moved to Done.
