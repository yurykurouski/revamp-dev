# LLM page generation: the MVP is designed by a model, grounded by code

Date: 2026-10-10
Status: approved 2026-10-10
Tracking: Epic REV-135; children REV-136 … REV-143 (§11)

## 1. Why

The MVP today is a rebuild of the original home page (REV-110 … REV-133): code reads the page into
sections, a vision model groups pieces by id, `planRebuild` decides everything, fixed renderers write the
markup, and a modernize layer restyles it within a closed vocabulary. The result is reliable but rigid:
every MVP is the original page re-skinned; the model can never restructure the site or give it a new
visual language.

This design replaces that pipeline entirely. A model designs and writes the whole page (HTML + CSS).
Code keeps the facts: it decides what the model may read, inserts every contact itself, rejects unsafe or
off-list output, flags any fact the original site does not support, and measures the result.

## 2. Agreed decisions

| Topic | Decision |
|---|---|
| Model output | One complete, self-contained HTML document (HTML + CSS). No component vocabulary. |
| Layout / design | Free. The model decides structure, sections, typography and look. |
| Copy | Grounded in the original: the model may reword lightly or use synonyms, never add facts. |
| Model input | Name, niche, city, language, extracted services, the original's main copy, brand colors, logo, the original's image list, the desktop screenshot. Contacts only as placeholders. |
| Contacts | Never typed by the model; `{{phone}}`, `{{email}}`, `{{address}}`, `{{hours}}`, `{{booking}}` filled by code from verified data. |
| Images | Only the original's images and logo (URL allowlist), no stock or hotlinks. |
| Fact control | Prompt rule + code grounding check; unsupported facts are **flagged** for the operator, not rejected. |
| Generation strategy | One vision call + code checks, one retry with reasons (approach A). Visual self-review (approach C) is a follow-up ticket behind an env flag. |
| Changes | Free-text change (model returns a full new page), Regenerate, version history with restore, and direct controls (palette, font pairing) with no model call. |
| Old pipeline | Removed completely: rebuild, modernize, grouping, section reader, Bento, custom CSS design layer. No fallback renderer. |
| Failure | No stand-in page. Failed generation is unrecoverable with a coded reason; a failed change publishes nothing. |
| HITL | Unchanged. The lead stops at `NEEDS_APPROVAL`; outreach only after operator approval. |

## 3. Pipeline

```
audit-queue      estimation + snapshot   unchanged: vitals, axe, standards, era, contacts, services,
                                         extractedContent, brand colors, logo, images, screenshots
      ↓                                  (the per-audit vision grouping call is removed)
ai-gen-queue     LLM generation          buildMvpSourceBrief(audit, lead) → MvpPageGenerator.generate
                                         → checkMvpPage (retry once) → store raw page
      ↓
deploy-queue     render / publish        finishMvpPage → upload → standards, performance,
                                         completeness, grounding, banner → NEEDS_APPROVAL
```

### 3.1 `MvpSourceBrief` (code only)

The one place that decides what the model sees. Built by `buildMvpSourceBrief(audit, lead)`
(`apps/workers/src/services/mvp-source-brief.ts`, pure):

- `business`: `name`, `niche`, `city`
- `language`: `extractedContent.language` (unset → the prompt says English)
- `services`: `audit.extractedServices`
- `copy`: from `extractedContent`: `title`, `metaDescription`, `h1`, `headings`, `paragraphs`,
  `serviceItems`, `testimonials`, `rating`, `foundingYear` (each only when extracted; lists capped so the
  prompt stays within budget, caps in `MVP_BRIEF_LIMITS`)
- `brand`: brand colors and logo URL from the audit
- `images`: the original's images with their size (URL, width, height), deduplicated, capped
- `placeholders`: the names of the placeholders that may be used, one per verified contact
  (`{{booking}}` always)
- `screenshot`: the audit's desktop screenshot (passed as an `LlmImage`, not in the JSON)

Contact values never appear in the brief. The brief is validated by `MvpSourceBriefSchema`
(`@revamp/validation`).

### 3.2 `MvpPageGenerator`

`apps/workers/src/services/mvp-page-generator.ts`, `MVP_PAGE_SYSTEM_PROMPT`. Two modes:

- `generate(brief)`: a fresh design.
- `change(brief, currentPage, instruction)`: the current raw page plus the operator's instruction; returns
  a full new page.

One vision call through `LlmClient` (provider `VISION_LLM_PROVIDER`, else the copywriting default, else the
local CLI; the operator's provider/model pick for the job wins, as REV-32). The answer is the HTML document
(the client strips a surrounding code fence). `checkMvpPage` gates it; a rejected answer is retried once
with the reason codes and messages. Two rejections, a missing provider or a failed call end in a coded
failure:

`MVP_PAGE_FAILURES`: `not_configured` | `call_failed` | `invalid_page`.

The prompt requires: one `<h1>`; `<html lang>` = the brief's language; the `--rv-*` variables in `:root`
and all colors and fonts through them; responsive layout (mobile first, no horizontal scroll at 360 px);
WCAG AA contrast; only listed images; placeholders for every contact and the booking call to action; no
scripts, forms, iframes or external resources other than the listed images; copy from `copy` reworded at
most lightly; no numbers, years, prices, ratings, awards, names or testimonials that are not in the brief.

### 3.3 Theme variables

Required in `:root`, listed in `MVP_THEME_VARS` (`@revamp/shared-types`):

`--rv-color-primary`, `--rv-color-accent`, `--rv-color-bg`, `--rv-color-surface`, `--rv-color-text`,
`--rv-font-heading`, `--rv-font-body`.

The values the model chose are read into `MvpProject.theme` (`IMvpTheme`). The operator's controls
(`MvpProject.controls`, same shape, every field optional) override them at finishing time.

## 4. Checks and finishing (code only)

### 4.1 `checkMvpPage(html, brief)` → `{ ok, reasons: { code, message }[] }`

`apps/workers/src/services/mvp-page-check.ts`. Rejections, each with a code (`MVP_PAGE_CHECKS`):

| Code | Rule |
|---|---|
| `page:parse` | Not one complete HTML document, or over 300 KB |
| `page:script` | `<script>`, `on*` attributes, `javascript:` URLs, `<iframe>`, `<object>`, `<embed>`, `<form>` |
| `page:external` | Any external resource other than an allowed image or Google Fonts |
| `page:image` | An `<img>` `src`/`srcset` or CSS `url()` not in the brief's image list or the logo |
| `page:css` | A `<style>` block or `style` attribute that `sanitizeMvpCss` would change (the sanitizer is reused, never loosened) |
| `page:theme` | A required `--rv-*` variable missing from `:root` |
| `page:placeholder` | An unknown placeholder, or one for a contact that is not verified |
| `page:contact` | A literal phone number or email address in the page instead of a placeholder |
| `page:h1` | Not exactly one `<h1>` |
| `page:lang` | `<html lang>` does not match the brief's language |

### 4.2 `checkMvpGrounding(html, brief)` → `IMvpGroundingFlag[]`

`apps/workers/src/services/mvp-grounding.ts`. Extracts checkable facts from the page's visible text
(placeholders excluded): numbers (incl. years, prices, percentages, `4,9` ≡ `4.9`), ratings and review
counts, and capitalized multi-word names (brands, certifications, places) that are not sentence starts.
Each fact not found in the normalized source copy (the brief's `copy`, `services`, business name and city)
becomes a flag `{ kind: 'number' | 'name', text, context }`. Flags never reject the page; they are stored
on `MvpProject.grounding` and shown to the operator.

### 4.3 `finishMvpPage(page, ctx)` (pure, deterministic)

`apps/workers/src/services/mvp-page-finish.ts`. Runs on every publish from the stored raw page:

1. Fill placeholders from verified contacts (phone → `tel:` link, email → `mailto:` link, address,
   hours, `{{booking}}` → `#booking`).
2. Apply `controls` over `theme` by rewriting the `--rv-*` values in `:root`.
3. Add SEO tags (`buildMvpSeo` / `seoHeadTags`, kept), the Google Fonts link for the fonts in use, the
   booking form (`templates/shared/booking.ts`, kept) before `</body>`, and the tracking already added by
   the deploy worker.

The deploy then runs the existing standards (`checkMvpStandards`), performance
(`measureMvpPerformance`), completeness and comparison-banner steps on the finished page, and the
grounding check on it.

## 5. Data model

`MvpProject` (`packages/db`, `IMvpProject`, schemas in `@revamp/validation`):

- New: `page` (raw model HTML, placeholders unfilled), `theme` (`IMvpTheme`), `controls`
  (`Partial<IMvpTheme>`), `grounding` (`IMvpGroundingFlag[]`), `versions` (`IMvpPageVersion[]`:
  `n`, `kind` `generate` | `change` | `controls` | `restore`, `instruction?`, `provider?`, `model?`,
  `storagePath`, `createdAt`), `pageFailure` (`IMvpPageFailure`: code, reason codes, message) replacing
  `renderFailure`.
- Kept: slug, preview URL, `storageHtmlPath`, `comparisonBannerUrl`, `isPublished`, `generatedAt`,
  `generationCount`, `editedAt`, `provider`, `modelUsed`, `requestedProvider`, `requestedModel`,
  `standards`, `performance`, `completenessReport`.
- Removed from the schema: `generatedContent`, `colorPalette`, `layout`, `design`, `rebuild`,
  `rebuildEdit`, `modernize`, `renderFailure`.

`Lead.generationFailure` keeps its shape with the new codes. `Audit`: `siteSections*`, `siteLayout*`
and the `sections` measurement are no longer written or declared; `siteEra` stays.

Versions: each raw page is stored at `revamp-demos/<slug>/versions/<n>.html`; the published
`index.html` is overwritten as today, so the preview URL never changes. At most 20 versions
(`MVP_MAX_VERSIONS`); the oldest is removed from storage and the record. Every publish writes
standards, performance, completeness, grounding, `editedAt` and the new version in one update.

Existing MVPs: no migration. A record without `page` is shown as "made with the previous generator";
only Regenerate is offered.

## 6. API

All errors through `AppError`; new codes in `API_ERROR_CODES` and blueprint.md §5.

| Route | Behavior | Model |
|---|---|---|
| `POST /mvp/generate` | A fresh design; body `{ leadId, provider?, model? }` (`layout` removed) | yes |
| `POST /mvp/:id/edit` | `{ instruction }`; full new page via `change`, same checks and retry; on failure nothing is published and the reason is returned (the request waits, as today) | yes |
| `PATCH /mvp/:id/tokens` | `{ colors?: { primary, accent, bg, surface, text }, fonts?: { heading, body } }`; colors must keep AA contrast (text on bg, text on surface), fonts from `MVP_FONT_CHOICES` (fixed pairings); saves `controls`, re-finishes and publishes | no |
| `POST /mvp/:id/versions/:n/restore` | Re-publishes version `n`'s raw page with the current controls as a new version (`restore`) | no |
| `PATCH /mvp/:id/layout`, `DELETE /mvp/:id/design` | Removed | — |

Model routes run in the existing `mvp-edit` worker (renamed `mvp-page` worker); control and restore
routes queue a deploy-only job.

## 7. Dashboard

Prototype step:

1. Preview iframe, unchanged (`sandbox="allow-scripts allow-same-origin"`, `mvpPreviewVersion`).
2. `MvpGroundingFlags`: shown when flags exist, each fact with a "Show in preview" link that highlights
   the text in the frame; a warning chip with the count on the step header.
3. "What changed" rebuilt on measured facts only: standards, axe violations, LCP/CLS original vs MVP (the
   host named), completeness. No tuning codes; no model-written text.
4. `MvpGenerationFailure` simplified: the code and reason in the interface language and "Try again".

Design tools panel (`MvpDesignTools`, still the single place for these, shared with `/leads/:id/preview`):
free-text change (`MvpEditPrompt`), colors (five swatches seeded from `theme`, brand colors offered first,
live contrast check), fonts (pairing menu), versions (`MvpVersionList`: date, kind, instruction, Restore),
Regenerate (with the provider/model picker). Removed: layout picker, Faithful/Modernized toggle, custom
CSS, "Reset custom design", and their `SHORTCUTS` entries.

i18n: new keys in all five locales (flags, versions, fonts, `page:*` / failure codes); `mvpChangeLog.*`
code-based keys, `mvpLayout.*` and `rebuild*` removed.

## 8. Removed

- Workers: `site-sections.*`, `site-grouping.*`, `site-layout.service`, `layout-selection.service`,
  `rebuild-*` (plan, tuning, edit, modernize, template), `templates/rebuild/`,
  `templates/bento.template.ts`, `templates/design.ts`, `template.service`, `mvp-content.service`,
  `mvp-edit.service`, `mvp-render.ts`; scripts `read_site_sections.ts`, `render_rebuild.ts`; the
  related fixtures and tests.
- Types/schemas in `shared-types`, `validation`, `db` that only those use (`SITE_SECTION_*`,
  `REBUILD_*`, `IRebuildEdit`, `IMvpDesign`, `MVP_DESIGN_*`, `BentoLayoutVariant`, …).
- Dashboard: `MvpRebuildLevelToggle`, layout and custom-CSS pickers, `utils/mvpChangeLog.ts` (code
  parsing), related hooks.
- Kept: `css-sanitizer`, `mvp-seo`, `templates/shared/{seo,booking,page}.ts`, `mvp-standards`,
  `mvp-performance`, `mvp-completeness*`, image banner, `site-era`, `site-content.extractor`,
  `brand-extractor`.

## 9. Testing

Vitest, every layer (AGENTS.md §3.2.5); no test calls a live model.

- `checkMvpPage`: one passing fixture, one failing fixture per code.
- `checkMvpGrounding`: grounded rewording passes; numbers, years, ratings, names not in the source flagged;
  normalization (whitespace, decimal comma, thousands separators).
- `finishMvpPage`: placeholders, controls, SEO, booking, tracking; same input → same output.
- `buildMvpSourceBrief`: only allowed fields, caps, no contact values.
- `MvpPageGenerator`: recorded answers in `apps/workers/src/services/__tests__/fixtures/page-gen/`
  (accept, retry then accept, two rejections, provider missing, call failed).
- Workers (job handling, failures, single-update publish), API routes (200/400/404/409, schemas),
  version cap and restore, contrast validation of controls, dashboard components and stores, i18n key
  coverage in all five locales.
- Dev script `npx tsx scripts/generate_mvp_page.ts [--record <dir>] <out-dir> <url...>`: audits a URL
  read-only, generates, checks and finishes a page, writes HTML files and the grounding flags; `--record`
  saves the brief and answer for fixtures. No database or storage writes.

## 10. Documentation

AGENTS.md §3.2: the rebuild, modernize, grouping and section-reader bullets are replaced by one rule set
(model writes layout and markup, never facts; contacts by placeholder; the checks; the flags; the theme
variables; versions). README. `../Revamp-docs`: `spec.md`, `blueprint.md`, `AGENTS.md` (the new system
prompt and schemas), `research.md` (ADR: reversing REV-110/REV-132's rebuild-only policy),
`milestones.md`.

## 11. Epic and child tickets

Epic REV-135: **LLM page generation: the model designs the MVP, code keeps the facts**. Children, in merge order
(each its own branch and PR, stacked where noted):

1. REV-136 **Brief, checks and finishing** — `MvpSourceBrief`, `checkMvpPage`, `checkMvpGrounding`,
   `finishMvpPage`, theme variables, types and schemas. Pure code, no wiring.
2. REV-137 **Page generator** — `MvpPageGenerator` (`generate`, `change`), system prompt, retry, failures,
   recorded-answer tests, `scripts/generate_mvp_page.ts`. (Depends on 1.)
3. REV-138 **Generation and publish wiring** — ai-gen and deploy workers on the new path, `MvpProject` schema
   changes, versions storage and cap, single-update publish, `Lead.generationFailure` codes,
   `POST /mvp/generate` body. (Depends on 2.)
4. REV-139 **Changes, controls and restore** — `/edit` on `change`, `PATCH /tokens` new body with contrast check
   and font pairings, `POST /versions/:n/restore`, `mvp-page` worker. (Depends on 3.)
5. REV-140 **Dashboard: Prototype step and Design tools** — grounding flags, measured "What changed", versions
   list, colors and fonts controls, failure panel, legacy-MVP state, i18n in five locales. (Depends on 4.)
6. REV-141 **Remove the rebuild pipeline** — delete the code, types, scripts, audit grouping call, dashboard
   pieces and shortcuts listed in §8. (Depends on 5.)
7. REV-142 **Docs** — AGENTS.md, README, `../Revamp-docs` (spec, blueprint, AGENTS, research ADR, milestones).
   (Depends on 6.)
8. REV-143 **Follow-up: visual self-review (approach C)** — render the page with Playwright at desktop and
   mobile, one revision call with the screenshots, same checks; behind `MVP_PAGE_SELF_REVIEW`; measured on
   real sites before turning on by default.
