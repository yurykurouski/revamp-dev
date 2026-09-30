# REV-109: Read the original home page as ordered sections — design

Ticket: [REV-109](https://linear.app/revamp-proect/issue/REV-109) (sub-project 1 of [REV-108](https://linear.app/revamp-proect/issue/REV-108))
Status: agreed in chat on 2026-09-29; reviewed 2026-09-29 (review fixes folded in, see §8).

## 1. Purpose

Revamp tunes the business's own site; it does not generate a templated one (REV-108). A faithful rebuild needs the original home page read **section by section**: each section's own content, how it is arranged, and how it looks. Today the audit has only per-block counts and a kind (`Audit.siteLayout`, REV-104) and page-wide content lists with no link to their section (`site-content.extractor.ts`).

This sub-project adds a deterministic reader (Playwright/DOM, no LLM) that stores the ordered sections on the audit. **The MVP does not change.** The renderer (REV-110) and the adaptation of the completeness check, design tools and edits (REV-111) follow.

### Success criteria

- Every text on the home page is either in a section or in `skipped` with a reason. Coverage is measured and stored, and the leftovers are listed.
- Content with no Bento slot (team, FAQ, "why us", pricing) is read as sections with their items.
- Each section keeps its arrangement parameters and measured style, so two sites with the same sections still differ the way the originals do.
- On Falco-Dent, the team (6 people), the FAQ and "Co nas wyróżnia" appear as sections with their items.

### Out of scope

- Pages other than the home page.
- Inline formatting inside a paragraph (bold, in-text links). Paragraph and list structure is kept.
- Downloading images into MinIO (REV-110 decides).
- Any change to the MVP, Bento, `Audit.siteLayout` or the dashboard.

## 2. Data model

Types go in `@revamp/shared-types`, and `SiteSectionsSchema` goes in `@revamp/validation`. `Audit.siteSections` and `Audit.siteSectionsError` are declared in the `@revamp/db` Audit schema; an undeclared field is dropped by strict mode.

```ts
export const SITE_SECTION_ROLES = ['header', 'hero', 'content', 'footer'] as const;

export const SITE_SECTION_ARRANGEMENTS = [
  'banner',            // copy over a full-width photo or color
  'media-beside-text', // with mediaSide and style.split
  'text',
  'card-grid',         // with columns
  'list',
  'accordion',
  'tabs',
  'slider',
  'gallery',           // images only
  'embed',             // a map, video or widget takes up the section
] as const;

// SITE_SECTION_KINDS gains 'features' ("why us", "Co nas wyróżnia")

interface ISiteImage { src: string /* absolute */; alt?: string; width?: number; height?: number }
interface ISiteLink { label: string; href: string; kind: 'cta' | 'link' | 'phone' | 'email' | 'map' }

interface ISiteSectionItem {
  title?: string;     // service name, person's name, question, reviewer
  subtitle?: string;  // role, date, eyebrow
  text: string[];     // paragraphs and bullets, verbatim (an FAQ answer, a review's quote)
  image?: ISiteImage;
  price?: string;     // as written, e.g. "od 150 zł"
  rating?: number;
  links: ISiteLink[];
}

interface ISiteStyle {
  background?: string;      // hex
  backgroundImage?: string; // absolute URL
  textColor?: string;       // hex
  align?: 'left' | 'center';
  paddingY?: number;        // px
  fullBleed?: boolean;      // edge to edge vs contained
  split?: number;           // media-beside-text: the media's share of the width, 0..1
}

interface ISiteItemStyle {
  background?: string;
  radius?: number;
  border?: boolean;
  shadow?: boolean;
  imageShape?: 'square' | 'round' | 'wide' | 'tall';
  align?: 'left' | 'center';
}

interface ISiteSection {
  index: number;            // page order
  role: SiteSectionRole;
  kind: SiteSectionKind;    // a label for tuning and completeness; the rebuild follows `arrangement`
  arrangement: SiteSectionArrangement;
  columns?: number;
  mediaSide?: 'left' | 'right';
  intro: { eyebrow?: string; heading?: string; headingLevel?: number; text: string[]; links: ISiteLink[] };
  items: ISiteSectionItem[];
  itemStyle?: ISiteItemStyle;
  extra: (
    | { type: 'text'; text: string[] }
    | { type: 'items'; arrangement: SiteSectionArrangement; items: ISiteSectionItem[] }
  )[];                      // everything else in the section, in page order
  images: ISiteImage[];     // images outside the items
  embeds: { kind: 'map' | 'video' | 'form' | 'widget'; src?: string }[];
  style: ISiteStyle;
  truncated?: boolean;
}

interface ISiteTypography {
  heading: { family: string; size: number; weight: number; uppercase: boolean; color?: string };
  body: { family: string; size: number; weight: number; lineHeight?: number; color?: string };
  button?: { radius: number; filled: boolean; uppercase: boolean; background?: string; color?: string };
}

interface ISiteSections {
  sections: ISiteSection[];
  typography?: ISiteTypography;
  skipped: { index: number; reason: 'noise' | 'empty' | 'duplicate' | 'cap'; heading?: string; sample: string }[];
  coverage: { pageChars: number; capturedChars: number; ratio: number; uncaptured: string[] };
}
```

**Item conventions.** One generic item shape serves every kind:

| Kind | `title` | `subtitle` | `text` | Other fields |
|---|---|---|---|---|
| Team member | name | role | bio | `image` |
| FAQ entry | question | | answer | |
| Review | author | | quote | `rating` |
| Price row | service | | | `price` |

The `header` section holds the logo (`images`), the nav links (`intro.links`) and the CTA. The `footer` section holds the address, opening hours and footer links.

**Caps** (constants in `@revamp/validation`, tuned against the fixtures):

| Cap | Value |
|---|---|
| Sections (including header and footer) | 45 |
| Items per section | 60 |
| Characters per text string | 2,000 |
| `uncaptured` snippets | 12 |
| `skipped[].sample` | 120 characters |
| `title`, `subtitle`, `eyebrow`, `heading`, `price`, link `label` | 300 characters |
| URLs (`src`, `href`, `backgroundImage`) | 2,000 characters |
| Strings per `text` array | 40 |
| Links per item or intro | 40 |
| Images per section | 24 |
| Embeds per section | 8 |
| `extra` entries per section | 20 |
| `skipped` entries | 80 |
| All text in the result | 150,000 characters |

A cut sets `truncated` on the section it cut. Past the total text budget, the remaining sections go to `skipped` with reason `cap`. `rating` is on a 0..5 scale ("9/10" is stored as 4.5).

**Failure.** `siteSectionsError` holds the reason and `siteSections` stays empty, the same pattern as `siteLayoutError`. The reader never makes the audit fail.

## 3. Architecture

The work follows the REV-104 pattern: the page reports raw facts, and Node makes every decision.

| Unit | Where | Job |
|---|---|---|
| Block marking | `collectSiteLayoutInPage` (`site-layout.service.ts`) | Tags each block it picks with `data-revamp-block="<i>"` (one line; nothing else changes) |
| `collectSiteSectionsInPage()` | `site-sections.page.ts` (with the `Raw*` types), self-contained (runs via `page.evaluate`, no imports) | Reads the header, the tagged blocks and the footer into `RawSiteSections` |
| `readSiteSections(raw)` | `site-sections.service.ts`, Node | Cleans, attaches, skips, names the arrangement, kind and style, computes coverage, applies caps, validates; returns `{ sections }` or `{ error }` |
| `extractSiteSections(page)` | `browser.service.ts` | Runs straight after `extractSiteLayout` on the same page, with a 15 s time limit; returns `{ raw }` or `{ error }` and never throws |
| Audit worker | `audit.worker.ts` | Stores `siteSections` / `siteSectionsError` next to `siteLayout` |

Sharing one block walk keeps the layout and the sections on the same section boundaries by construction. If the layout collection itself failed (`extractSiteLayout` returned `{ error }`, so no block is tagged), the reader stops with `siteSectionsError: 'layout walk failed: …'` and doesn't guess. `readSiteLayout` rejecting the raw facts (e.g. a page of one block) does not stop the reader: the blocks are tagged either way. `readSiteSections` takes the raw layout blocks too, so `classifyBlock` runs on the same facts REV-104 used.

## 4. In-page reader (`collectSiteSectionsInPage`)

1. **Header.** The same element REV-104's header reading picks (`header`, `[role=banner]`, `#header`, `.header`, `.site-header`, `.navbar`, else a `nav`, shown and starting in the top 200 px): the logo, nav labels and hrefs, and the CTA. Its other text goes to `extra`.
   **Footer.** The last shown `footer`, `[role=contentinfo]`, `#footer`, `.footer` or `.site-footer` that is not inside another candidate or a tagged block: its columns (read like any block), links, address and hours.
2. **Blocks.** The `[data-revamp-block]` elements in index order.
3. **Items: the largest group of repeated siblings.**
   - A group is at least 2 siblings with the same structural signature: their tag outline two levels deep, with builder-generated ids and class tokens stripped out.
   - Each member must carry text or an image.
   - Groups are ranked by the text their members hold.
   - Semantic markup settles ties or wins outright:
     - `details`, `[aria-expanded]` or a class containing `accordion`, `toggle` or `faq` → accordion;
     - `[role=tablist]` → tabs;
     - the REV-104 slider selector → slider;
     - `itemtype` Person or Review.
   - Cloned slides (`.swiper-slide-duplicate`, `.slick-cloned`) are removed before counting.
4. **Item fields.**
   - `title`: the first heading, or a short bold line.
   - `subtitle`: a short line right next to the title.
   - `text`: the remaining paragraphs and list items, read with `textContent`, so hidden answers, tabs and slides are included.
   - `image`: the largest image, taken from `currentSrc`, `data-src`, `data-lazy-src` or `srcset`, made absolute. A `data:` URI (a lazy-load placeholder) is never kept.
   - `price`: a match for the REV-104 currency regex.
   - `rating`: from star icons, `aria-label` or text like "5/5".
   - `links`: each link or button with its `href`. `tel:` gives `phone`, `mailto:` gives `email`, a maps link gives `map`, and a link styled as a button (opaque background or border, plus padding) gives `cta`.
5. **Intro and extra.**
   - Intro: the content before the item group, in DOM order (eyebrow, heading and its level, paragraphs, CTA links).
   - Extra: whatever remains, as text runs or a second item group.
   - Links outside the items (a "see all services" button after the grid too) go to `intro.links`, since `extra` holds only text and items.
   - A link whose text is its whole line is kept as a link, not repeated as text; a link inside a paragraph stays part of the paragraph.
6. **Media.**
   - Images outside the items.
   - The computed background image.
   - Embeds: an iframe is classified as a map, video or widget by its `src` (Booksy and ZnanyLekarz count as widgets); a `form` is recorded as a `form` embed.
7. **Geometry and style (raw).**
   - Bounding rectangles of the intro, the main media and each item.
   - Computed styles of the section and its first item (background color and image, text color, text-align, padding, radius, border, box-shadow).
   - Image aspect ratio and border radius.
   - Site-wide typography, sampled from the h1, an h2, body text and the main button.
8. **Text accounting.**
   - Every element content is taken from goes into a `consumed` set.
   - The reader then walks all text in `body`, excluding `script`, `style`, `noscript`, `template`, cloned slides and cookie or consent widgets (the extractor's `inBoilerplate` rule, copied because in-page code can't import).
   - Hidden text counts only inside a section (collapsed answers, tabs, slides); hidden text elsewhere (a closed mobile menu, a modal) is not page text.
   - Both sides split text the same way: one string per nearest block-level ancestor, whitespace collapsed.
   - It reports `pageChars`, plus each text run outside any section with its page position.

## 5. Node side (`readSiteSections`)

1. **Clean and attach.**
   - Collapse whitespace, strip soft hyphens, trim.
   - An uncaptured run between two blocks goes into the nearer section's `extra`.
   - Runs that can't be placed stay in `coverage.uncaptured`.
2. **Skip, always with a reason**, recorded in `skipped` with a sample:
   - `noise`: cookie or consent text and legal boilerplate (the RODO/GDPR clause, "all rights reserved"). Only those lines are removed. If the whole section is noise, it's skipped.
   - `empty`: no text, image or embed.
   - `duplicate`: the same text as an earlier section.
   - `cap`: past the section limit.
3. **Arrangement**, first rule that matches:
   1. The reader flagged an accordion, tabs or a slider → that arrangement.
   2. An embed covers more than half of the section → `embed`.
   3. The items are images only → `gallery`.
   4. Two or more items → `card-grid` if item tops line up in a row (`columns` = the number of items in the first row), else `list`.
   5. A large image (at least a quarter of the section's width) beside the text: their boxes overlap vertically by at least half the shorter one and horizontally by at most a tenth of the narrower one → `media-beside-text`, plus `mediaSide` and `style.split`.
   6. A background photo, or full width with the copy on top → `banner`.
   7. Otherwise → `text`.
4. **Kind.**
   - `classifyBlock` (REV-104) runs on the heading and hints.
   - The item fields also count:
     - 3+ items each with a portrait, a name and a short role → `team`;
     - Q&A items → `faq`;
     - short headed items with an icon or none, under a "why us"-style heading → `features`.
   - The item rules win over the heading: "O nas" over six portraits with names and roles is `team`.
   - The header's kind is `other`; the footer's is `contact` when it holds a phone, email or map link, else `other`.
   - The first content block on the first screen gets the `hero` role.
   - `index` is the position in page order (header, blocks, footer), shared by `sections` and `skipped`, so a gap shows where a skipped block was.
5. **Style.**
   - Colors are converted to hex; a transparent background inherits the page's.
   - Sizes are rounded to px.
   - `imageShape` comes from the aspect ratio and border radius: `round` if the radius is at least half the width.
6. **Coverage.** `capturedChars` = the text kept in sections (intro, items, extra, link labels; a `price` is part of its text and not counted twice) plus the full text of what was `skipped`, and `ratio = min(1, capturedChars / pageChars)`, rounded to 3 places. It's stored even when low; this reader doesn't judge it (REV-110 sets the fallback threshold).
7. **Caps and validation.**
   - Truncation sets `truncated`.
   - The result is parsed with `SiteSectionsSchema`.
   - A schema failure or zero content sections gives `{ error }` with the reason.

**The new kind `features`.** It's added to `SITE_SECTION_KINDS`, the schema, the classifier's word list and its tests. `deriveMvpLayout` (`layout-selection.service.ts`) treats it like `other`, so Bento's output is unchanged.

## 6. Testing (Vitest)

- **Schema** (`packages/validation/__tests__/site-sections.spec.ts`): a valid full result; every role and arrangement; caps at their limits and one past them; an invalid color, URL, rating or split; a missing required field.
- **In-page reader** (`apps/workers/src/services/__tests__/site-sections.service.spec.ts`, real Chromium fixtures, skipped when Chromium is unavailable, like REV-104's spec). Fixtures:
  - an Elementor-style card grid in nested wrappers;
  - a Divi-style team section with round portraits;
  - an FAQ accordion with collapsed answers;
  - a swiper slider with cloned slides;
  - text beside an image at 60/40;
  - a map embed plus a form;
  - a cookie banner plus a GDPR footer;
  - a "why us" icon list;
  - a stray paragraph between two blocks;
  - a lazy `data-src` image;
  - a header with nav and CTA, plus a footer with address and hours.

  Each fixture asserts the items, fields, arrangement and style, plus coverage ≥ 0.95 with the leftovers listed.
- **Node side**: pure `readSiteSections` tests covering each arrangement rule, each skip reason, kind from items, style normalization, the coverage math, caps and `truncated`, and a schema failure or zero sections giving `{ error }`.
- **Wiring**:
  - `extractSiteSections` returns `{ error }` when evaluation throws.
  - The audit worker stores `siteSections` / `siteSectionsError` without failing the audit.
  - A save through the real `@revamp/db` Audit model keeps the field.
- **REV-104 is unchanged**: the site-layout and layout-selection tests still pass with the marking line and the new kind.
- **Real sites**: run the read-only `scripts/read_site_sections.ts` (no database writes; `crawl_live` neither reads the layout nor keeps out of the shared dev data) on Falco-Dent (`https://falcodent.pl/`), Dentalux (`https://www.dentalux.pl/`) and Elefant (`https://www.elefant.med.pl/`). The PR records the section list, arrangements, coverage and leftovers. Falco-Dent's team, FAQ and "Co nas wyróżnia" must appear with their items.
- **Chrome**: no dashboard change. Open an audited lead and check the review and preview still load with no new console errors.

## 7. Docs and definition of done

- `AGENTS.md` §3.2.2 gets a paragraph on the section reader: where it lives, how to add an arrangement or a kind, and that nothing is dropped without a reason.
- In `../Revamp-docs`: the Audit schema in `blueprint.md`, the audit DTO in `spec.md`, and REV-109 in `milestones.md`.
- `README.md` only if its feature list covers audit fields.
- All gates pass (`build:packages`, `typecheck`, `lint`, `test`, `build`), then PR, merge, docs, and REV-109 moved to Done.

## 8. Review notes (2026-09-29)

Fixed in place: rule 5 of the arrangement said "little vertical overlap", which describes stacked boxes; the footer had no detection rule; most arrays had no cap and the worst case exceeded MongoDB's 16 MB document limit; "layout walk failed" was ambiguous; hidden text and cloned slides were counted differently by the two sides of the coverage; `page.evaluate` had no time limit; `crawl_live` writes leads into the shared dev database; section-level links had no place; the rating scale and the priority between the heading and the item rules were open. The in-page reader moves to its own file, `site-sections.page.ts`, because it is larger than REV-104's.
