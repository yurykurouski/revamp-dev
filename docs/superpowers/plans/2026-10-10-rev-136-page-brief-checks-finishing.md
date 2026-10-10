# REV-136 Source brief, page checks, grounding check and finishing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pure code around a model-written MVP page: what the model may read (`buildMvpSourceBrief`), what it may write (`checkMvpPage`), which of its facts are unsupported (`checkMvpGrounding`), and how its raw page becomes the published one (`finishMvpPage`). No worker, API or model call is wired here.

**Architecture:** Types and constants in `@revamp/shared-types`, Zod schemas in `@revamp/validation`, five focused modules in `apps/workers/src/services/`. HTML is parsed with happy-dom with scripts, file loading and navigation off (the `checkMvpStandards` settings, extracted into one helper); CSS is parsed with postcss. Every function is pure and deterministic.

**Tech Stack:** TypeScript, Zod, happy-dom 20, postcss 8, Vitest (run from the repo root).

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md` §3.1, §3.3, §4. Ticket: [REV-136](https://linear.app/revamp-proect/issue/REV-136), Epic REV-135.

## Global Constraints

- Branch `ymorpheus/rev-136-page-generation-source-brief-page-checks-grounding-check-and` (exists, holds the spec commit). Commits `feat(REV-136): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run tests from the repo root: `npx vitest run <path>` (never from inside `apps/workers`). Only `*.spec.ts` files run.
- Apps typecheck against packages' `dist`: run `npm run build:packages` after changing `shared-types` or `validation`.
- Contact values never enter the brief. Placeholder names: `phone`, `email`, `address`, `hours`, `booking`.
- Theme variables, exactly: `--rv-color-primary`, `--rv-color-accent`, `--rv-color-bg`, `--rv-color-surface`, `--rv-color-text`, `--rv-font-heading`, `--rv-font-body`.
- Page size limit 300 KB (`MVP_PAGE_MAX_BYTES = 300_000`, UTF-8 bytes).
- Check codes, exactly: `page:parse`, `page:script`, `page:external`, `page:image`, `page:css`, `page:theme`, `page:placeholder`, `page:contact`, `page:h1`, `page:lang`.
- Grounding flags never reject a page.
- `sanitizeMvpCss` is not loosened or changed.

## Decisions this plan makes beyond the spec (spec updated in Task 0)

1. **`page:css` uses its own checker, not `sanitizeMvpCss`.** The sanitizer guards a small custom stylesheet on our template: it rejects `:root`, `body`, element selectors, `display:none` and every `url()`. A model-written page needs all of those. `checkPageCss` keeps only the safety rules: no `@import`, no `@font-face`, no `<`, no escapes, no `expression(`/`javascript:`/`behavior`/`-moz-binding`, and `url()` only to an allowed image.
2. **Images are URLs only.** `extractedContent.images` has no sizes; the model sees the screenshot.
3. **Placeholder grammar.** `{{name}}`, lowercase, no spaces. In text: `phone`, `email`, `address`, `hours`. In an `href`: `phone` → `tel:`, `email` → `mailto:`, `address` → a Google Maps search link, `booking` → `#booking`. Anything else (another attribute, `{{booking}}` in text, unknown name, a contact that is not verified) is `page:placeholder`. `id="booking"` is reserved for the form code adds: also `page:placeholder`.
4. **No `data:` URLs** in images or CSS: `page:image`. Icons are inline `<svg>`.
5. **The model's own SEO head tags are replaced** at finishing (meta description, `og:*`, `twitter:*`, canonical, icon links), so the page carries only `seoHeadTags` from verified data.
6. **Controls** are applied as a trailing `<style id="rv-controls">:root{…}</style>` in `<head>`, so they win over the model's `:root` without rewriting its CSS.

## Review Focus

1. A model answer with prose before `<!DOCTYPE html>` or a code fence around it must fail `page:parse`, not pass as a page with junk text. (Task 4)
2. Placeholder variants the model will try (`{{ phone }}`, `{{Phone}}`, `{{tel}}`) must be rejected, not left as visible braces on the published page. (Task 4)
3. A literal `href="tel:+48…"` or `mailto:` must be `page:contact` even when the visible text uses a placeholder. (Task 4)
4. All-caps headings (`OUR SERVICES`) must not flag every word as a name. (Task 5)
5. The same number written differently in source and page (`4,9`/`4.9`, `1 200`/`1200`, non-breaking space) must not be flagged. (Task 5)

---

### Task 0: Record the decisions in the spec

**Files:** Modify `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md`

- [ ] **Step 1:** Move REV-136 to **In Progress** in Linear.
- [ ] **Step 2:** In §3.1 change `images` to "the original's image URLs (`extractedContent.images`), deduplicated, capped". In §4.1 replace the `page:css` row's rule with "A `<style>` block or `style` attribute that fails `checkPageCss`: `@import`, `@font-face`, `<`, escapes, `expression(`, `javascript:`, `behavior`, `-moz-binding`, or a `url()` outside the allowed images". Add a short "Placeholder grammar" paragraph under §4.1 with decision 3, and note decisions 4–6 under §4.1/§4.3.
- [ ] **Step 3: Commit** `docs(REV-136): page CSS check, placeholder grammar and image list in the spec`

### Task 1: Types, constants and schemas

**Files:**
- Modify: `packages/shared-types/src/index.ts` (new block "Model-designed MVP page (REV-136)" at the end)
- Modify: `packages/validation/src/index.ts` (matching block at the end)
- Test: `packages/validation/__tests__/mvp-page.spec.ts`

**Interfaces — Produces (shared-types):**
```ts
export const MVP_PLACEHOLDERS = ['phone', 'email', 'address', 'hours', 'booking'] as const;
export type MvpPlaceholder = (typeof MVP_PLACEHOLDERS)[number];
export const MVP_THEME_VARS = { primary: '--rv-color-primary', accent: '--rv-color-accent', bg: '--rv-color-bg',
  surface: '--rv-color-surface', text: '--rv-color-text', fontHeading: '--rv-font-heading', fontBody: '--rv-font-body' } as const;
export type MvpThemeKey = keyof typeof MVP_THEME_VARS;
export type IMvpTheme = Record<MvpThemeKey, string>;
export const MVP_PAGE_CHECKS = ['page:parse', 'page:script', 'page:external', 'page:image', 'page:css',
  'page:theme', 'page:placeholder', 'page:contact', 'page:h1', 'page:lang'] as const;
export type MvpPageCheck = (typeof MVP_PAGE_CHECKS)[number];
export interface IMvpPageProblem { code: MvpPageCheck; message: string }
export const MVP_PAGE_MAX_BYTES = 300_000;
export const MVP_BRIEF_LIMITS = { services: 30, headings: 40, paragraphs: 60, copyChars: 12_000,
  serviceItems: 30, testimonials: 10, images: 24 } as const;
export interface IMvpSourceBrief {
  business: { name: string; niche: string; city?: string; originalUrl: string };
  language?: string;
  services: string[];
  copy: { title?: string; metaDescription?: string; h1?: string; headings: string[]; paragraphs: string[];
    serviceItems: Array<{ title: string; description?: string }>; testimonials: Array<{ text: string; author?: string }>;
    rating?: { value: number; count?: number }; foundingYear?: number };
  brand: { primary: string; secondary: string; accent: string; fonts: string[]; logoUrl?: string };
  images: string[];
  placeholders: MvpPlaceholder[];
}
export const MVP_GROUNDING_KINDS = ['number', 'name'] as const;
export interface IMvpGroundingFlag { kind: (typeof MVP_GROUNDING_KINDS)[number]; text: string; context: string }
```
**Produces (validation):** `MvpThemeSchema`, `MvpThemeControlsSchema` (its own `.strict()` object, every key optional, stricter than the theme), `MvpSourceBriefSchema`, `MvpGroundingFlagSchema`. Colors: `#rrggbb` hex; fonts: `/^[A-Za-z0-9 ]{1,40}$/` for controls only (the model's theme values are any non-empty string ≤ 200 chars, since they are CSS font stacks).

- [ ] **Step 1: Write failing tests** in `mvp-page.spec.ts`:
  - `MvpSourceBriefSchema` accepts a full brief and a minimal one (`services: []`, empty copy lists, no language, `placeholders: ['booking']`).
  - rejects a brief with `placeholders: ['fax']`, `services` longer than 30, `images` longer than 24, an extra key `contacts` (schema is `.strict()`).
  - `MvpThemeSchema` rejects a missing `fontBody`; `MvpThemeControlsSchema` accepts `{}` and `{ primary: '#112233' }`, rejects `{ primary: 'red' }` and `{ fontHeading: 'Inter; }' }`.
  - `MvpGroundingFlagSchema` rejects `kind: 'date'`.
- [ ] **Step 2:** `npx vitest run packages/validation/__tests__/mvp-page.spec.ts` → FAIL (exports missing).
- [ ] **Step 3:** Add the shared-types block and the schemas.
- [ ] **Step 4:** `npm run build:packages && npx vitest run packages/validation/__tests__/mvp-page.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(REV-136): types and schemas for the model-designed page`

### Task 2: Source brief

**Files:** Create `apps/workers/src/services/mvp-source-brief.ts`; Test `apps/workers/src/services/__tests__/mvp-source-brief.spec.ts`

**Interfaces:**
- Consumes: `IMvpSourceBrief`, `MVP_BRIEF_LIMITS`, `MvpSourceBriefSchema` (Task 1); `IAudit`, `ILead`.
- Produces:
  - `export interface VerifiedContacts { phone?: string; email?: string; address?: string; hours?: string }`
  - `export function verifiedContacts(audit: Pick<IAudit, 'extractedContacts'>, lead: Pick<ILead, 'contactPhone' | 'contactEmail'>): VerifiedContacts` — audit first, then lead (same rule as `ai.worker.ts` today); `hours` from `workingHours`; blank strings count as missing.
  - `export function buildMvpSourceBrief(audit: Pick<IAudit, 'extractedContacts' | 'extractedContent' | 'extractedServices' | 'extractedBrandTokens'>, lead: Pick<ILead, 'businessName' | 'niche' | 'city' | 'originalUrl' | 'contactPhone' | 'contactEmail'>): IMvpSourceBrief` — returns `MvpSourceBriefSchema.parse(…)`.

Rules: `placeholders` = verified contact names in `MVP_PLACEHOLDERS` order plus `booking` always. Lists deduplicated (trimmed, case-insensitive), then capped by `MVP_BRIEF_LIMITS`. `copyChars` caps the summed length of `headings` + `paragraphs` + service item texts + testimonial texts: items are taken in order and the first one that would pass the cap and all after it are dropped (never cut mid-text). `images` excludes the logo URL.

- [ ] **Step 1: Write failing tests:**
  - full audit + lead → brief with business, language, services, copy, brand (from `extractedBrandTokens`), images, `placeholders: ['phone','email','address','hours','booking']`.
  - `JSON.stringify(brief)` contains none of the contact values (phone, email, address, hours) used in the fixture.
  - contacts only on the lead → `placeholders` has `phone`/`email` from the lead; none anywhere → `['booking']`.
  - 50 services with duplicates (`'Implants'`, `' implants '`) → 30 unique.
  - paragraphs summing past 12 000 chars → whole paragraphs kept up to the cap, none truncated.
  - logo URL also in `images` → removed from `images`.
  - audit without `extractedContent` → empty copy lists, no `language`.
- [ ] **Step 2:** `npx vitest run apps/workers/src/services/__tests__/mvp-source-brief.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `feat(REV-136): build the model's source brief from verified audit data`

### Task 3: HTML parsing helper, page CSS check and theme reader

**Files:**
- Create: `apps/workers/src/services/html-document.ts`
- Create: `apps/workers/src/services/mvp-page-css.ts`
- Modify: `apps/workers/src/services/mvp-standards.ts` (use the helper; behavior unchanged)
- Test: `apps/workers/src/services/__tests__/mvp-page-css.spec.ts`

**Interfaces — Produces:**
- `export function withHtmlDocument<T>(html: string, read: (doc: Document) => T): T` — the `checkMvpStandards` happy-dom settings (no script evaluation, no file loading, no navigation), closes the window in `finally`.
- `export function checkPageCss(css: string, allowedUrls: ReadonlySet<string>): string[]` — problem messages, `[]` when safe. postcss parse error → one problem. Rules: decision 1 above; `url()` value (quotes stripped) must be in `allowedUrls` exactly; `data:` never allowed.
- `export function readMvpTheme(cssBlocks: string[]): Partial<IMvpTheme>` — the last value of each `MVP_THEME_VARS` property declared in a rule whose selector list is exactly `:root` (also `html:root` not accepted; keep it strict), across blocks in order.

- [ ] **Step 1: Write failing tests:**
  - `checkPageCss`: a realistic page stylesheet (`:root{…}`, `body{…}`, `h1{…}`, `@media`, `display:none` in a nav, `position:sticky` on `header`, `background:url("https://site.pl/a.jpg")` with that URL allowed) → `[]`.
  - one problem each for `@import url(x.css)`, `@font-face{src:url(x)}`, `url(https://other.com/x.png)`, `url(data:image/png;base64,AA)`, `width:expression(1)`, `behavior:url(x.htc)`, `-moz-binding:url(x)`, `content:"\\3c"`, `a{color:red` (parse error).
  - `readMvpTheme(['…:root{--rv-color-primary:#123456;--rv-font-body:"Inter",sans-serif}', ':root{--rv-color-primary:#654321}'])` → `{ primary: '#654321', fontBody: '"Inter",sans-serif' }`; a var declared in `.hero{}` is ignored.
  - existing `mvp-standards.spec.ts` still passes unchanged.
- [ ] **Step 2:** `npx vitest run apps/workers/src/services/__tests__/mvp-page-css.spec.ts` → FAIL.
- [ ] **Step 3:** Implement; switch `checkMvpStandards` to `withHtmlDocument`.
- [ ] **Step 4:** `npx vitest run apps/workers/src/services/__tests__/mvp-page-css.spec.ts apps/workers/src/services/__tests__/mvp-standards.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(REV-136): page CSS safety check and theme reader`

### Task 4: `checkMvpPage`

**Files:** Create `apps/workers/src/services/mvp-page-check.ts`; Test `apps/workers/src/services/__tests__/mvp-page-check.spec.ts`; Fixture `apps/workers/src/services/__tests__/fixtures/page-gen/valid-page.html`

**Interfaces:**
- Consumes: `withHtmlDocument`, `checkPageCss`, `readMvpTheme` (Task 3); `IMvpSourceBrief`, `IMvpPageProblem`, `MVP_PAGE_MAX_BYTES`, `MVP_THEME_VARS`, `MVP_PLACEHOLDERS` (Task 1).
- Produces:
  - `export interface MvpPageCheckResult { ok: boolean; problems: IMvpPageProblem[]; theme?: IMvpTheme }` — `theme` set when `ok`.
  - `export function checkMvpPage(html: string, brief: IMvpSourceBrief): MvpPageCheckResult` — runs every check and reports all problems (not just the first), one entry per distinct message; on `page:parse` it stops there.
  - `export const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g` (shared with Task 6).

Rules, per code:
- `page:parse`: trimmed input must start with `<!doctype html` (case-insensitive) and contain `</html>`, nothing non-whitespace after `</html>`; UTF-8 byte length ≤ `MVP_PAGE_MAX_BYTES`.
- `page:script`: any `script`, `iframe`, `object`, `embed`, `form`, `base`, `meta[http-equiv=refresh]` (compare in code, lowercased), any attribute name starting `on`, any attribute value starting `javascript:` after trimming.
- `page:external`: `link` other than `rel=stylesheet|preconnect` to `https://fonts.googleapis.com/` or `https://fonts.gstatic.com/`; `video`, `audio`, `source` elements; `img`/`source` handled by `page:image`.
- `page:image`: every `img[src]`, each `srcset` URL (descriptor stripped), must be in `brief.images` or `brief.brand.logoUrl`.
- `page:css`: `checkPageCss` over every `<style>` text and every `style` attribute (wrapped as `x{…}`), allowed URLs = images + logo.
- `page:theme`: `readMvpTheme` result missing any key → one problem naming the missing variables.
- `page:placeholder`: decision 3; also `id="booking"` anywhere.
- `page:contact`: in visible text or any `href`: an email address (`/[\w.+-]+@[\w-]+\.[\w.-]+/`), a `tel:`/`mailto:` href, or a phone-like run (`/\+?\d[\d\s().-]{6,}\d/` with at least 7 digits).
- `page:h1`: not exactly one `h1`.
- `page:lang`: primary subtag of `<html lang>` ≠ primary subtag of `brief.language ?? 'en'` (case-insensitive).

- [ ] **Step 1: Write the fixture** `valid-page.html`: a ~60-line page in Polish (`lang="pl"`), `:root` with all seven variables, a Google Fonts link, header with logo `<img>`, h1, services list, one image from the brief, `<a href="{{phone}}">{{phone}}</a>`, `<a href="{{booking}}">`, `{{address}}` in the footer, an inline `<svg>` icon. Brief fixture in the spec file with matching images, logo, `placeholders: ['phone','address','booking']`.
- [ ] **Step 2: Write failing tests:**
  - valid page → `{ ok: true, problems: [], theme: {…seven values} }`.
  - one test per code, each mutating the valid page once and asserting `problems.map(p => p.code)` equals `[code]`: prose before doctype and a ```` ```html ```` fence (`page:parse`), 300 001-byte page (`page:parse`), `<script>`, `onclick=`, `<a href="javascript:x">`, `<form>` (`page:script`), `<link rel="stylesheet" href="https://cdn.x/y.css">` (`page:external`), unlisted `<img>` and an unlisted `srcset` entry (`page:image`), `@import` in a `style` block (`page:css`), `:root` without `--rv-font-body` (`page:theme`), `{{ phone }}`, `{{Phone}}`, `{{email}}` (not verified), `{{booking}}` in text, `<div id="booking">` (`page:placeholder`), literal `+48 600 100 200`, `href="tel:+48600100200"` with placeholder text, `kontakt@firma.pl` (`page:contact`), two h1 (`page:h1`), `lang="en"` against brief `pl` (`page:lang`).
  - a page with two problems reports both codes.
- [ ] **Step 3:** `npx vitest run apps/workers/src/services/__tests__/mvp-page-check.spec.ts` → FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Same command → PASS.
- [ ] **Step 6: Commit** `feat(REV-136): check a model-written page before it is accepted`

### Task 5: `checkMvpGrounding`

**Files:** Create `apps/workers/src/services/mvp-grounding.ts`; Test `apps/workers/src/services/__tests__/mvp-grounding.spec.ts`

**Interfaces:**
- Consumes: `withHtmlDocument` (Task 3), `PLACEHOLDER_PATTERN` (Task 4), `IMvpSourceBrief`, `IMvpGroundingFlag` (Task 1).
- Produces: `export function checkMvpGrounding(html: string, brief: IMvpSourceBrief): IMvpGroundingFlag[]` — deduplicated by `kind` + normalized text, in page order.

Algorithm:
- Page text: each non-empty text node under `body` (skipping `svg`, `style`), plus `alt` and `title` attributes, each a separate unit; placeholders removed first.
- Source text: business name, niche, city, services, and every string in `brief.copy` (incl. `rating.value`, `rating.count`, `foundingYear`), joined.
- Number normalization: replace ` `/` ` with space; join digit groups separated by a single space or `.`/`,` followed by exactly three digits when the number has ≥ 2 groups (`1 200`, `1.200` → `1200`); then decimal comma → dot. A page number is grounded when its normalized form is in the set of normalized source numbers. Numbers 0–9 standing alone are ignored (list markers, "1 visit").
- Names: within a unit, split into sentences on `[.!?…]\s`; a token matching `/^\p{Lu}[\p{L}\p{N}&'’-]*$/u` that is not a sentence's first token is a candidate; a unit with no lowercase letter is skipped for names; a candidate is grounded when its lowercase form appears as a word in the lowercased source text. Adjacent ungrounded candidates join into one flag (`Gold Dental Award`).
- `context`: the unit's text, whitespace-squashed, cut to 80 characters.

- [ ] **Step 1: Write failing tests:**
  - page reusing source copy with synonyms and reordered sentences → `[]`.
  - "Ponad 15 lat doświadczenia" with no 15 in the source → one `number` flag `15` with that context.
  - source `4,9` and `1 200 pacjentów`, page `4.9` and `1200` and `1 200` → `[]`.
  - "Nagroda Gold Dental Award 2024" with none in source → flags `Gold Dental Award` (name) and `2024` (number).
  - "NASZE USŁUGI" heading → `[]`; "Zadzwoń do nas" (first token capitalized) → `[]`.
  - a name present in the source in lowercase or different case → `[]`.
  - `{{phone}}` and an `alt="Gabinet Kraków"` with Kraków the brief's city → `[]`.
  - the same ungrounded number twice → one flag.
- [ ] **Step 2:** `npx vitest run apps/workers/src/services/__tests__/mvp-grounding.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `feat(REV-136): flag facts on the page that the original does not support`

### Task 6: `finishMvpPage`

**Files:** Create `apps/workers/src/services/mvp-page-finish.ts`; Test `apps/workers/src/services/__tests__/mvp-page-finish.spec.ts`

**Interfaces:**
- Consumes: `withHtmlDocument` (Task 3), `PLACEHOLDER_PATTERN` (Task 4), `VerifiedContacts` (Task 2), `IMvpTheme`, `MVP_THEME_VARS` (Task 1); kept helpers `seoHeadTags` (`templates/shared/seo.ts`), `bookingFormHtml`, `bookingScript` (`templates/shared/booking.ts`), `resolveTrackerUrls`, `trackerScriptTag`, `monogramSvg`, `svgDataUri` (`templates/shared/page.ts`), `getMvpStrings` (`templates/mvp-locale.ts`), `escapeHtml`.
- Produces:
  ```ts
  export interface MvpFinishContext {
    businessName: string; language?: string; services: string[];
    contacts: VerifiedContacts; seo: IMvpSeo; logoUrl?: string;
    controls?: Partial<IMvpTheme>; publicApiUrl?: string; trackingToken?: string;
  }
  export function finishMvpPage(page: string, ctx: MvpFinishContext): string;
  export const MVP_BOOKING_CSS: string; // booking form styles using only --rv-* variables
  ```
  The caller passes a page that passed `checkMvpPage`.

Steps inside, in order:
1. Text placeholders → escaped values; `href` placeholders → `tel:` + the phone with everything but `+` and digits removed, `mailto:` + email, `https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(address)`, `#booking`.
2. Remove from `<head>`: `meta[name=description]`, `meta[property^=og:]`, `meta[name^=twitter:]`, `link[rel=canonical]`, `link[rel~=icon]`; append `seoHeadTags(ctx.seo, ctx.businessName)` and `<link rel="icon" href="…">` (logo, else the monogram in `--rv-color-primary`'s control value or `#333333`).
3. Controls: when any key is set, append `<style id="rv-controls">:root{<var>:<value>;…}</style>` in `MVP_THEME_VARS` key order; font controls also append a Google Fonts `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=<Name+With+Plus>:wght@400;600;700&display=swap">` per family, sorted.
4. `<style id="rv-booking">${MVP_BOOKING_CSS}</style>` in head; `<section id="booking" class="rv-booking">${bookingFormHtml({ t, businessName, heading: escapeHtml(t.bookNow), serviceOptionsHtml })}</section>` at the end of `<main>` if the page has one, else before the first `<footer>` that is a direct child of `body`, else at the end of `body`.
5. Serialize `<!DOCTYPE html>\n` + `documentElement.outerHTML`, then before `</body>` add `bookingScript({ t, tracker, trackingToken, themeVars: { primary: '--rv-color-primary' } })` and `trackerScriptTag(tracker, trackingToken)`.

- [ ] **Step 1: Write failing tests** (using Task 4's `valid-page.html`):
  - `{{phone}}` text and href become `+48 600 100 200` and `tel:+48600100200`; `{{address}}` href is the encoded maps link; `{{booking}}` href is `#booking`; output contains no `{{`.
  - a value with `<b>` is escaped.
  - a model `<meta name="description">` and `og:title` are gone; `seoHeadTags` output is present once.
  - `controls: { primary: '#0a0a0a', fontHeading: 'DM Serif Display' }` → a `#rv-controls` style with `--rv-color-primary:#0a0a0a;--rv-font-heading:"DM Serif Display"` and one fonts link containing `family=DM+Serif+Display`; no controls → no `#rv-controls`.
  - exactly one `id="booking"`; placed inside `<main>`; with no `<main>`, before the body's `<footer>`.
  - the service options list the brief services; with `publicApiUrl` set the tracker script is present, without it absent.
  - `finishMvpPage(p, ctx) === finishMvpPage(p, ctx)`, and the result passes `checkMvpStandards` with `singleH1`, `metaDescription` true when `seo.description` is set.
- [ ] **Step 2:** `npx vitest run apps/workers/src/services/__tests__/mvp-page-finish.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `feat(REV-136): finish a model-written page with verified contacts, SEO and booking`

### Task 7: Gates, PR, ticket

- [ ] **Step 1:** Run every gate; all must pass:
  `npm run build:packages` · `npm run typecheck` · `npm run lint` (0 errors, no new warnings) · `npm test` (0 failures) · `npm run build`.
  No runtime behavior changes (nothing is wired), so no dashboard/Chrome check applies; say so in the PR.
- [ ] **Step 2:** Push the branch and `gh pr create` with title `feat(REV-136): source brief, page checks, grounding check and finishing`, body starting `Fixes [REV-136](https://linear.app/revamp-proect/issue/REV-136)`, sections `## Problem`, `## Changes`, `## Verification` (exact commands and results), ending with the Claude Code attribution line.
- [ ] **Step 3:** Attach the PR link to REV-136 and move it to **In Review**. Comment that docs for the new pipeline land in REV-142 (nothing user-facing changes here).
- [ ] **Step 4:** Merge per AGENTS.md §4.3 step 5 (pull `main`, re-run gates, `gh pr merge --merge`, pull `main`, `npm test`), then move REV-136 to **Done**.
