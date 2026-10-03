# REV-113: Let a vision model group the page into sections, by id only (design)

Ticket: [REV-113](https://linear.app/revamp-proect/issue/REV-113)
Builds on: [REV-109](https://linear.app/revamp-proect/issue/REV-109) (the rules reader, `Audit.siteSections`), [REV-110](https://linear.app/revamp-proect/issue/REV-110) (the rebuild), [REV-112](https://linear.app/revamp-proect/issue/REV-112) (`rebuild:flat`), [REV-100](https://linear.app/revamp-proect/issue/REV-100) (`measurementErrors`)
Status: design, awaiting review

## 1. Purpose

The rules reader (REV-109) finds sections with fixed rules: blocks at least half the viewport wide, splits only at `h1`/`h2`, headings only from `h1`–`h6`, and header and footer only from tags and class names. Old table layouts and page-builder layouts break those rules. On anident.pl (a ~460px table column, `<font><big><b>` headings, floated photos) it returns 3 sections with no heading (largest section 0.554 of the text). It loses the logo, reads the menu as content and puts every photo in one gallery. REV-112 sends such readings to Bento. This ticket makes them readable.

A vision model looks at the page and an outline of its pieces, and says which pieces form the header, each section and the footer. It answers with **ids only**. Code copies every word, link and image from the page by id. The model never writes copy or markup (the rule approved for REV-112/113/114: "the model may group and classify page pieces by id; it never writes copy or markup").

### Success criteria

- anident.pl: about 8 sections, each with a heading. A header with the logo and the nav, and a footer. The photos sit in the sections of the text they illustrate. The reading passes `rebuildEligibility`, including `rebuild:flat`.
- falcodent.pl is not worse: its reading still passes `rebuildEligibility`, keeps at least as many headed sections (11 today), and its rebuild still looks like the original side by side.
- When the model is not configured, fails, or gives an invalid answer, the audit stores the rules reading and records the failure in `Audit.measurementErrors`. It never stores a made-up structure.
- `planRebuild` and `renderRebuild` do not change.

### Out of scope

- REV-114 (modernising dated sites with a model-chosen design) and REV-111 (edits on a rebuilt MVP).
- Any model-written text, including headings for sections that have none.
- Pages other than the home page.

## 2. Decision: the model runs on every audit

Decided with the user (2026-10-02). Every audit asks the model, and the rules reader is the fallback. Two other options were rejected:

- Calling the model only when the rules reading fails the gate. Cheaper, but rejected.
- Running both readers and picking the better one. It costs the most, and "better" needs its own scoring rule.

One safety net stays, because it costs nothing: if the model's reading fails `rebuildEligibility` while the rules reading passes it, the answer counts as invalid (section 6). A page that rebuilds today can therefore never drop to Bento because of the model.

Cost: one vision call per audit, budget about 25k input and 4k output tokens (section 5.4). It runs in parallel with the design critique, so the audit takes little longer than the slower of the two calls.

## 3. Overview

```
desktop page (Playwright)
  collectSiteSectionsInPage()  ─►  RawSiteSections (unchanged)  +  outline: RawPageOutline (new)
                                                                        │
audit worker                                                            ▼
  rules  = readSiteSections(raw, layoutBlocks)                 source 'rules'
  answer = siteGroupingService.group(outline, desktop full-page tiles)   ◄── vision model, ids only
  llm    = readGroupedSections(raw, outline, answer)          source 'llm'
           = assembleGroupedBlocks(...) → readSiteSections(...)  (same cleaning, caps, coverage, Zod)
  store llm when it is valid, else rules plus measurementErrors[{ measurement: 'sections', … }]
```

The model's answer is turned into the same `RawSiteBlock`s the rules reader produces. `readSiteSections` then does all its usual work: noise filtering, deduplication, caps, coverage and `SiteSectionsSchema` validation. The result therefore has the same shape by construction.

## 4. The outline (in the page)

### 4.1. Where it lives

`collectSiteSectionsInPage` gains an `outline` field. The collector must stay self-contained (it runs through `page.evaluate`), and putting the outline inside it reuses its helpers: `clean`, `textOf`, `excluded`, `hiddenCopy`, `screenReaderOnly`, `inFormUi`, `linkOf`, `imageOf`, `embedsIn`, `backgroundOf`. The rules for what is not copy (consent boilerplate, slider controls, screen-reader text, hidden screen-size copies, form UI) are therefore identical for both readers. The rules output does not change.

### 4.2. Pieces

Pieces are numbered 1..n in document order. Each piece has a type and a few facts:

| type | what | facts |
|---|---|---|
| `heading` | `h1`–`h6` text, or a styled heading (4.3) | `level` (tag level, or none when styled), `styled: true` when it is not an `h` tag |
| `text` | a paragraph: consecutive lines in one block up to a blank line (`<br><br>`), a heading line or the block's end | `links` inside it (kept with the copy) |
| `list` | a `ul`/`ol` whose entries are plain text (no image, no heading, no nested block of copy) | `lines` (one per `li`), `links` |
| `links` | a block whose own text is all links (`onlyLinks`): a menu, a button row, a lone call to action | `links` |
| `image` | a shown `img` at least 40px on a side (spacers and bullets are left out), or a lazy one with its size attributes | `image` (`RawSiteImage`) |
| `background` | a `background-image` URL on an element at least 200×100px | `src`, `box` |
| `embed` | a map, video, form or widget (`embedsIn` on the body) | `embed` (`RawSiteEmbed`) |

Every piece also carries `tag` (the nearest element's tag), `box` (page coordinates), `font` (`size`, `weight`, `uppercase`, `color`), `background` (`backgroundOf`, the opaque color behind it), `align` (`textAlign`) and `hidden` (true for kept hidden text: accordion answers, tab panels, slides). Header and footer menus that are closed (`closedParts`) are left out, as the rules reader does.

Splitting inside a block is the part the rules reader lacks. A table cell is one block holding many paragraphs and `<font><big><b>` headings separated by `<br>`. The collector walks the block's text nodes and `<br>` elements, cuts it into lines at each `<br>` and at each nested block boundary, and then forms pieces from those lines:

- a line that qualifies as a styled heading becomes a `heading` piece;
- other consecutive lines join into one `text` piece until a blank line or a heading line.

### 4.3. Styled headings

The body size is the font size that carries the most text characters on the page. A line is a styled heading when all of these hold:

- it is 1 to 120 characters long, and it ends neither in a comma nor in a colon followed by more text on the line;
- it is alone on its line: a `<br>` or a block boundary before and after it;
- every text node on it is bold (weight 600 or more), **or** at least 1.2× the body size, **or** uppercase (`text-transform` or the text itself, with at least 4 letters).

### 4.4. Caps and facts sent to the model

- At most 600 pieces (`OUTLINE_LIMITS.pieces`). A page with more is collected up to the cap, and `outline.truncated` is set. Pieces past the cap cannot be grouped and count as uncaptured.
- A piece's full text stays in Node for assembly. The prompt shows only the first 160 characters.
- `outline.bodySize` (the body size from 4.3) and `outline.pageHeight` are reported as well.

## 5. The grouping agent (Node)

### 5.1. Provider

`apps/workers/src/services/site-grouping.service.ts` uses `LlmClient` (`llm-client.ts`). The provider is `VISION_LLM_PROVIDER` when set, else the client's default (`MVP_LLM_PROVIDER`, then the first API key). The design critique also falls back to the Claude Code CLI when it is on the PATH, and so does this service. `LlmCompletionRequest` gains optional `images: { mediaType, data }[]`:

- Anthropic: `image` blocks after the text;
- OpenAI: `image_url` data URIs;
- Gemini: `inline_data` parts;
- claude-cli: `createClaudeCliVisionRunner`, the runner the critique already uses.

Calls without images behave as today. `complete` also returns token usage (`completeWithUsage`), so the audit can log a `token_usage` event with stage `audit_section_grouping`.

### 5.2. Input

- **Screenshot:** the desktop full-page capture (1440px wide, up to 12000px tall), cut into tiles 1440×1800 (at most 6, so y ≤ 10800), each scaled to 1024px wide WebP (`ImageService.tilesForVision`). The prompt states each tile's page range (`tile 2: y 1800–3600`).
- **Outline:** one line per piece, for example:
  ```
  14 heading styled 18px b "IMPLANTY ZĘBÓW" y=1320 x=480 w=460 h=24
  15 text 13px "Implanty to najlepsza metoda uzupełnienia braków… (412 chars)" y=1350 x=480 w=460 h=120
  16 image 350x233 alt="ANIDENT Implanty Warszawa" y=1350 x=590 float=right
  17 links ["Start","O nas","Oferta","Cennik","Kontakt"] y=210 x=40 w=1360
  ```
- The niche and the page URL.

### 5.3. Answer (`SiteGroupingAnswerSchema`, `@revamp/validation`)

```ts
{
  header?: { logo?: number; pieces: number[] };      // logo: an image piece; pieces: nav links, top-bar text
  sections: Array<{                                    // 1..40, page order
    heading: number;                                   // required: a heading piece or a text piece of at most 120 chars
    eyebrow?: number;                                  // a short label above the heading
    pieces: number[];                                  // text, list, links, image, background, embed pieces outside items
    items?: Array<{ title?: number; pieces: number[] }>;   // cards, entries, people, questions
    kind: SiteSectionKind;                             // SITE_SECTION_KINDS
    arrangement: SiteSectionArrangement;               // SITE_SECTION_ARRANGEMENTS
  }>;
  footer?: { pieces: number[] };
}
```

Ids are integers from the outline. The schema has no string fields, so the model has nowhere to put copy.

### 5.4. Prompt and budget

The system prompt (`SITE_GROUPING_SYSTEM_PROMPT`, documented in `../Revamp-docs/AGENTS.md` as `SectionGroupingAgent`) tells the model:

- Group the outline's pieces into the header, sections in page order, and the footer, as a visitor sees them in the screenshots.
- Each section starts at its heading and holds the photos and text that belong to that heading. A photo floated beside a paragraph belongs to that paragraph's section.
- Use items only for repeated cards or entries.
- Leave out only what is not part of the page (a duplicate menu). Answer with ids only, in JSON.

Budget: about 25k input tokens (outline about 12k at 600 pieces, 6 tiles about 10k, prompt about 1.5k) and at most 4k output tokens. Temperature 0.1, then 0 for the one retry. Timeout 120s per attempt on the HTTP providers; the CLI uses `CLAUDE_CLI_TIMEOUT_MS`.

Page text reaches the prompt. A page that tries to steer the model can only change the grouping, because the answer holds no text and every id is checked.

## 6. Checking the answer

`checkGrouping(answer, outline)` (pure, in `site-grouping.ts`) returns the reasons the answer is invalid. If there is any reason, the service retries once; if the retry is invalid too, the rules reading is used.

- The JSON fails `SiteGroupingAnswerSchema`.
- An unknown id.
- A piece used twice, anywhere in the answer.
- A missing heading: a section's `heading` that is not a `heading` piece or a `text` piece of at most 120 characters.
- A logo that is not an `image` piece.
- No section at all.

After assembly (section 7), the answer is also invalid if:

- `readSiteSections` returns an error for the assembled blocks;
- the result fails `rebuildEligibility` while the rules reading passes it (the safety net from section 2). This check happens once, with no retry.

## 7. Assembly (`assembleGroupedBlocks`, `site-grouping.ts`)

Every referenced piece is copied into a `RawSiteBlock` by id:

- **Header:** the logo goes to `images[0]`, `links` pieces go to `intro.links`, other text goes to `extra`.
- **Footer:** links go to `intro.links`, text to `extra`.
- **Section:**
  - `heading` → `intro.heading`, with `headingLevel` from the tag, or 2 for a styled heading;
  - `eyebrow` → `intro.eyebrow`;
  - section pieces before the first item → `intro.text` / `intro.links`, and pieces after it → `extra` text;
  - `image` pieces → `images`, the first `background` → `backgroundImage`, `embed` → `embeds`;
  - `items` → `group.items`. Each item has its title, its text lines, its largest image and its links. Its `markup` is the arrangement when that is `accordion`, `tabs` or `slider`.
- **Geometry and style:**
  - `box` is the union of the section's piece boxes, and `introBox` the heading's and intro's boxes;
  - `style.background` is the background behind most of the section's text, and `style.color` and `textAlign` come from its heading;
  - `paddingTop`/`paddingBottom` are half the vertical gap to the previous and next section, capped at 120px;
  - `itemStyle` is left unset; there is no card element to read it from.
- **Hint:** `RawSiteBlock.hint = { kind, arrangement }`.

Two small reader changes, and no other rule changes:

- `toSection` takes `hint.kind` over `classifyBlock` (the assembled blocks have no REV-104 block). It takes `hint.arrangement` over `arrangementOf` only when the content allows it:
  - an item arrangement (`card-grid`, `list`, `accordion`, `tabs`, `slider`, `gallery`) needs at least 2 items;
  - `embed` needs an embed;
  - `banner` needs a background image or an image;
  - `media-beside-text` needs an image.
  
  Otherwise it uses `arrangementOf`, the same rule as today. `card-grid` takes `columnsOf(items)`.
- `RawSiteSections.leftOut` (new, optional) lists pieces the model put nowhere. Each run of consecutive left-out pieces becomes one `skipped` entry with the new reason `unassigned` (`SITE_SKIP_REASONS`). Its `index` is the next section's index, and its sample is the run's text. Unlike `noise` and `duplicate`, `unassigned` text does **not** count as captured, so coverage drops by what the model lost, and `rebuild:low_coverage` still guards the rebuild.

Coverage keeps the rules collector's denominator (`raw.pageChars`), so both readers are measured against the same page text. `uncaptured` is empty for the model's reading: every piece is either placed or `unassigned`. `typography` comes from the same `raw.typography`.

## 8. Types, schema and storage

- `ISiteSections.source?: 'rules' | 'llm'` (`SITE_SECTIONS_SOURCES`). `SiteSectionsSchema` makes it optional because readings stored before this ticket lack it; the reader always sets it. `Audit.siteSections` is `Schema.Types.Mixed` in `@revamp/db`, so the nested field is stored as is; a model test pins that `source` survives a save. No other new Audit field is needed: failures go to `measurementErrors`.
- `SITE_SKIP_REASONS` gains `unassigned`.
- `AUDIT_MEASUREMENTS` gains `sections`. Its `MeasurementErrorSchema` in `@revamp/db` takes the enum from shared-types (checked in the plan).
- **Dashboard:** `AuditStep`'s alert says that the total counts only the measured parts. `sections` is not part of the score, so that alert lists only the scored measurements. A `sections` failure shows as its own line ("Page sections were read by the rules: …"), with labels in all five locales.

## 9. Error handling

| Case | Stored | `measurementErrors` |
|---|---|---|
| Model answer valid and assembled | llm reading | none |
| No vision provider configured | rules reading | `sections`: the client's `unavailableReason()` |
| Call fails or times out twice | rules reading | `sections`: `The vision model gave no grouping in 2 attempts (last error: …)` |
| Answer invalid twice (schema, ids, heading) | rules reading | `sections`: the first reasons, 300 chars at most |
| Assembled reading errors, or fails the gate where rules pass | rules reading | `sections`: the reason (`rebuild:flat flat:share=…`) |
| Outline missing (collection failed) | rules reading, or `siteSectionsError` as today | `sections`: `No page outline` |
| Rules reading also fails | `siteSectionsError` as today | as above |

The grouping never fails the audit.

## 10. Testing

- **Outline fixtures** (`site-sections.page.spec.ts`, real Chromium as today):
  - a table layout with a 460px column, `<font><big><b>` headings and `<br><br>` paragraphs gives separate heading and text pieces in order;
  - styled-heading rules (bold, 1.2×, uppercase; a long bold line, a bold lead-in on a paragraph line, or a line ending in a comma is not a heading);
  - flat sibling runs (`div > p, b, p, img…` with no wrappers) split into pieces;
  - floated images become image pieces;
  - a menu becomes one `links` piece;
  - spacers under 40px are left out;
  - the rules output is unchanged (the existing tests keep passing).
- **Answer checks** (`site-grouping.spec.ts`): an unknown id, a duplicate id, a missing or non-heading heading, a logo that is not an image, no sections, and a malformed schema are each invalid. A valid answer passes.
- **Assembly** (`site-grouping.spec.ts`):
  - the hint is used or overridden per the compatibility rules;
  - `unassigned` skips lower coverage;
  - images stay in their section (a photo-and-text section becomes `media-beside-text`, not a gallery);
  - `source: 'llm'`;
  - the result passes `SiteSectionsSchema`.
- **Recorded answers:** `scripts/read_site_sections.ts --llm --record <dir>` saves the outline, the rules reading and the model's raw answer for anident.pl and falcodent.pl into `apps/workers/src/services/__tests__/fixtures/grouping/`. The tests assemble from those files: anident has at least 7 headed sections, a header with a logo and links, a footer, and passes `rebuildEligibility`; falcodent passes it with at least 11 headed sections. No test calls a live model.
- **Service** (`site-grouping.service.spec.ts`, stub client):
  - unavailable provider → error;
  - a call failure followed by a valid answer → used;
  - an invalid answer twice → error with the reasons;
  - the safety net;
  - the token usage is returned.
- **LLM client** (`llm-client.spec.ts`): image blocks per provider with a stub fetcher and a stub CLI runner; requests without images are unchanged.
- **Worker** (`audit.worker.spec.ts`): the llm reading is stored with `source: 'llm'`; on failure the rules reading is stored with a `sections` measurement error; the token event has stage `audit_section_grouping`.
- **Validation** (`rebuild.spec.ts` / a new `site-grouping` spec): the answer schema's bounds, the `unassigned` reason and the optional `source`.
- **Dashboard:** `AuditStep.spec.ts`: a `sections` error shows as its own line and stays out of the score alert.

## 11. Real-site check

- `npx tsx scripts/read_site_sections.ts --llm https://www.anident.pl/ https://falcodent.pl/` prints both readings, the gate verdict for each, and which one the audit would store.
- `npx tsx scripts/render_rebuild.ts --llm <out> https://www.anident.pl/ https://falcodent.pl/` renders from that reading.
- End to end: add both sites as fresh leads with Add lead (Regenerate does not re-audit). Check `Audit.siteSections.source`, the section count and headings, then the MVP in Chrome side by side with the original.

## 12. Documentation

- `AGENTS.md` §3.2.2: the rules reader and the grouping step, and the wording "the model may group and classify page pieces by id; it never writes copy or markup". §3.2.6: `source`, `unassigned`, the `sections` measurement.
- README: the grouping step and its env (`VISION_LLM_PROVIDER`).
- `../Revamp-docs`:
  - `AGENTS.md`: the `SectionGroupingAgent` prompt, schema, budget and fallback;
  - `spec.md`: the reading's `source`, `unassigned` and the `sections` measurement;
  - `blueprint.md`: the audit flow and the Audit fields;
  - `research.md`: a decision record for model-grouped sections by id, on every audit, with the rules reader as fallback;
  - `milestones.md`, if a DoD item applies.
