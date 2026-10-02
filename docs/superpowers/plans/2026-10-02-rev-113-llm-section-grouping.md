# REV-113 Model-Grouped Page Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every audit, a vision model groups numbered pieces of the original home page into header, sections and footer by id. Code copies every word from the page, and the result is stored as `Audit.siteSections` with `source: 'llm'`. The rules reader stays as the recorded fallback.

**Architecture:** `collectSiteSectionsInPage` also returns an `outline` of pieces. `SiteGroupingService` sends the outline plus full-page tiles to the model through `LlmClient` and checks the id-only answer. `assembleGroupedBlocks` turns it into `RawSiteBlock`s, and the unchanged `readSiteSections` cleans, caps, measures and validates them. The audit worker runs this in parallel with the design critique. On any failure it stores the rules reading and records a `sections` measurement error.

**Tech Stack:** TypeScript, Playwright (in-page collector), Zod (`@revamp/validation`), sharp (tiles), Vitest (real Chromium for fixtures, stubbed clients for the model).

**Spec:** `docs/superpowers/specs/2026-10-02-rev-113-llm-section-grouping-design.md`

## Global Constraints

- The model may group and classify page pieces by id; it never writes copy or markup. No string from the model's answer is ever stored.
- `planRebuild` / `renderRebuild` (`rebuild-plan.service.ts`, `templates/rebuild/`) are not modified.
- Pieces: at most 600 (`OUTLINE_LIMITS.pieces`); prompt preview 160 chars; sections in an answer 1..40; items per section at most 60.
- Styled heading: 1..120 chars, not ending in `,` or `;`, alone on its line, every fragment bold (weight ≥ 600) **or** ≥ 1.2× body size **or** uppercase (CSS, or the text itself with ≥ 4 letters).
- Images under 40px on both sides are not pieces; background pieces need ≥ 200×100px.
- Tiles: 1440×1800 page slices, at most 6, scaled to 1024px wide WebP.
- Model call: temperature 0.1 then 0, 2 attempts, `maxTokens` 8000, HTTP timeout 120 000 ms; stage `audit_section_grouping`.
- `unassigned` skips do not count as captured; coverage keeps `raw.pageChars` as its denominator.
- Safety net: a model reading that fails `rebuildEligibility` while the rules reading passes is rejected.
- Tests never call a live model. Run vitest from the repo root (`npx vitest run <path>`); running it inside `apps/workers` hits the real LLM path.
- Every Audit field must be declared in `@revamp/db` (`siteSections` is `Mixed`; `measurementErrors.measurement` reads `AUDIT_MEASUREMENTS`).
- Commits: `feat(REV-113): …` / `test(REV-113): …` / `docs(REV-113): …`, ending with the session's Co-Authored-By and Claude-Session lines.

## Review Focus

1. **A page with no headings at all**, styled or tagged (a photo-only landing). The model cannot name a heading for every section, so the answer is invalid. Expected: the rules reading is stored with a `sections` error, and the audit still completes. Pinned in Task 6 ("a heading-less answer falls back").
2. **A model answer wrapped in prose or a ```json fence.** Expected: `extractJsonObject` finds it and it is used, not counted as a failure. Pinned in Task 6.
3. **Hidden pieces** (accordion answers, slides) that the model puts in a section. Expected: their text is kept with zero boxes, and the section's box comes only from the drawn pieces. Pinned in Task 4 ("hidden pieces keep text, not geometry").
4. **An outline truncated at 600 pieces** on a long page. Expected: the pieces past the cap are counted in neither the model's sections nor the captured chars, so coverage drops and the gate decides. Pinned in Task 2 (the cap) and Task 4 (coverage).
5. **The model returns ids in a different order than the page**, or sections out of order. Expected: sections are sorted by their first piece id, and the text inside a section is in id order. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared-types/src/index.ts` (modify) | `SITE_SECTIONS_SOURCES`, `ISiteSections.source`, `unassigned` skip reason, `sections` measurement |
| `packages/validation/src/index.ts` (modify) | `OUTLINE_LIMITS`, `SiteGroupingAnswerSchema`, `source` in `SiteSectionsSchema` |
| `packages/validation/__tests__/site-grouping.spec.ts` (create) | answer schema and `source` tests |
| `apps/workers/src/services/site-sections.page.ts` (modify) | outline types and the in-page outline collector |
| `apps/workers/src/services/site-sections.service.ts` (modify) | `hint`, `leftOut`, `source` in `readSiteSections` |
| `apps/workers/src/services/site-grouping.ts` (create) | pure: `checkGrouping`, `assembleGroupedBlocks`, `readGroupedSections`, `outlinePrompt` |
| `apps/workers/src/services/site-grouping.service.ts` (create) | the agent (prompt, provider, retries) and `readPageSections` (the fallback flow) |
| `apps/workers/src/services/llm-client.ts` (modify) | images and token usage |
| `apps/workers/src/services/image.service.ts` (modify) | `tilesForVision` |
| `apps/workers/src/workers/audit.worker.ts` (modify) | wiring, token event, measurement error |
| `apps/dashboard/src/components/leadReview/AuditStep.tsx` + 5 locales (modify) | the `sections` line outside the score alert |
| `scripts/read_site_sections.ts`, `scripts/render_rebuild.ts` (modify) | `--llm`, `--record` |
| `apps/workers/src/services/__tests__/fixtures/grouping/*.json` (create) | recorded outlines and answers |

---

### Task 1: Types and schemas

**Files:**
- Modify: `packages/shared-types/src/index.ts:154` (`AUDIT_MEASUREMENTS`), `:388` (`SITE_SKIP_REASONS`), `:482` (`ISiteSections`)
- Modify: `packages/validation/src/index.ts:239` (limits), `:345` (`SiteSectionsSchema`)
- Create: `packages/validation/__tests__/site-grouping.spec.ts`
- Modify: `packages/db/__tests__/models.spec.ts`

**Interfaces:**
- Produces: `SITE_SECTIONS_SOURCES = ['rules','llm'] as const`, `SiteSectionsSource`; `ISiteSections.source?: SiteSectionsSource`; `'unassigned'` in `SITE_SKIP_REASONS`; `'sections'` in `AUDIT_MEASUREMENTS`; `OUTLINE_LIMITS = { pieces: 600, sections: 40, items: 60, previewChars: 160 }`; `SiteGroupingAnswerSchema`, `type SiteGroupingAnswer = z.infer<…>`.

- [ ] **Step 1: Write the failing tests** (`packages/validation/__tests__/site-grouping.spec.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { OUTLINE_LIMITS, SiteGroupingAnswerSchema, SiteSectionsSchema } from '../src/index.js';

const section = { heading: 3, pieces: [4, 5], kind: 'about', arrangement: 'text' };

describe('SiteGroupingAnswerSchema (REV-113)', () => {
  it('accepts ids-only answers with header, sections, items and footer', () => {
    const answer = {
      header: { logo: 1, pieces: [2] },
      sections: [section, { heading: 6, pieces: [], items: [{ title: 7, pieces: [8] }, { pieces: [9] }], kind: 'services', arrangement: 'card-grid' }],
      footer: { pieces: [10] },
    };
    expect(SiteGroupingAnswerSchema.safeParse(answer).success).toBe(true);
  });

  it('rejects text where an id belongs, ids out of range, and unknown kinds or arrangements', () => {
    for (const bad of [
      { sections: [{ ...section, heading: 'O nas' }] },
      { sections: [{ ...section, heading: 0 }] },
      { sections: [{ ...section, heading: OUTLINE_LIMITS.pieces + 1 }] },
      { sections: [{ ...section, pieces: [1.5] }] },
      { sections: [{ ...section, kind: 'blog' }] },
      { sections: [{ ...section, arrangement: 'masonry' }] },
      { sections: [] },
      { sections: Array.from({ length: OUTLINE_LIMITS.sections + 1 }, (_, i) => ({ ...section, heading: i + 1, pieces: [] })) },
    ]) {
      expect(SiteGroupingAnswerSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('drops keys it does not know, so no model text survives parsing', () => {
    const parsed = SiteGroupingAnswerSchema.parse({ sections: [{ ...section, title: 'Invented' }], note: 'hi' });
    expect(JSON.stringify(parsed)).not.toContain('Invented');
    expect(JSON.stringify(parsed)).not.toContain('hi');
  });
});

describe('SiteSectionsSchema source and unassigned (REV-113)', () => {
  const reading = { sections: [], skipped: [{ index: 0, reason: 'unassigned', sample: '' }], coverage: { pageChars: 0, capturedChars: 0, ratio: 0, uncaptured: [] } };
  it('accepts a reading with or without a source, and the unassigned reason', () => {
    expect(SiteSectionsSchema.safeParse(reading).success).toBe(true);
    expect(SiteSectionsSchema.safeParse({ ...reading, source: 'llm' }).success).toBe(true);
    expect(SiteSectionsSchema.safeParse({ ...reading, source: 'model' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails.** Run `npx vitest run packages/validation/__tests__/site-grouping.spec.ts`. Expected: FAIL (`OUTLINE_LIMITS` is not exported).

- [ ] **Step 3: Implement**

`packages/shared-types/src/index.ts`:
```ts
export const AUDIT_MEASUREMENTS = ['performance', 'accessibility', 'standards', 'design', 'sections'] as const;
```
Extend the doc comment above it: "`sections` is the vision model's grouping of the page (REV-113): when it fails, the rules reading is stored instead; it is not scored."
```ts
/** Why a block was left out of the sections; nothing is dropped without one. `unassigned`: the model placed the piece nowhere (REV-113) */
export const SITE_SKIP_REASONS = ['noise', 'empty', 'duplicate', 'cap', 'unassigned'] as const;

/** Which reader produced `Audit.siteSections`: the DOM rules (REV-109) or the vision model's grouping by id (REV-113) */
export const SITE_SECTIONS_SOURCES = ['rules', 'llm'] as const;
export type SiteSectionsSource = (typeof SITE_SECTIONS_SOURCES)[number];
```
In `ISiteSections` add `/** Absent on readings stored before REV-113 */ source?: SiteSectionsSource;`.

`packages/validation/src/index.ts`, after `SITE_SECTIONS_LIMITS`:
```ts
/** The page outline the vision model groups (REV-113) */
export const OUTLINE_LIMITS = { pieces: 600, sections: 40, items: 60, previewChars: 160 } as const;

const pieceId = z.number().int().min(1).max(OUTLINE_LIMITS.pieces);
const pieceIds = z.array(pieceId).max(OUTLINE_LIMITS.pieces);

/**
 * The vision model's grouping of the page (REV-113): references to outline pieces only. There is no
 * string field, and unknown keys are stripped, so no model-written text can reach the stored reading.
 */
export const SiteGroupingAnswerSchema = z.object({
  header: z.object({ logo: pieceId.optional(), pieces: pieceIds }).optional(),
  sections: z
    .array(
      z.object({
        heading: pieceId,
        eyebrow: pieceId.optional(),
        pieces: pieceIds,
        items: z.array(z.object({ title: pieceId.optional(), pieces: pieceIds })).max(OUTLINE_LIMITS.items).optional(),
        kind: z.enum(SITE_SECTION_KINDS),
        arrangement: z.enum(SITE_SECTION_ARRANGEMENTS),
      }),
    )
    .min(1)
    .max(OUTLINE_LIMITS.sections),
  footer: z.object({ pieces: pieceIds }).optional(),
});
export type SiteGroupingAnswer = z.infer<typeof SiteGroupingAnswerSchema>;
```
Import `SITE_SECTIONS_SOURCES` (and `SITE_SECTION_KINDS` / `SITE_SECTION_ARRANGEMENTS` if not already imported). Add `source: z.enum(SITE_SECTIONS_SOURCES).optional(),` to `SiteSectionsSchema`, and change its doc comment from "read from the DOM by code (never a model)" to "read from the DOM by code, or grouped by a vision model by id (REV-113); the text is always the page's own".

- [ ] **Step 4: Pin storage.** In `packages/db/__tests__/models.spec.ts`, next to the existing `siteSections` test, add a test that saves an Audit with `siteSections: { …, source: 'llm' }` and `measurementErrors: [{ measurement: 'sections', message: 'x' }]`, and asserts that both read back unchanged. Use the file's existing in-memory pattern.

- [ ] **Step 5: Run.** Run `npm run build:packages && npx vitest run packages/validation packages/db`. Expected: PASS.

- [ ] **Step 6: Commit** with `feat(REV-113): source, unassigned, sections measurement and the grouping answer schema`.

---

### Task 2: The page outline (in-page collector)

**Files:**
- Modify: `apps/workers/src/services/site-sections.page.ts` (types after `RawSiteSections`; collector before `return`)
- Test: `apps/workers/src/services/__tests__/site-sections.page.spec.ts`

**Interfaces:**
- Produces (exported types):
```ts
export type RawOutlinePieceType = 'heading' | 'text' | 'list' | 'links' | 'image' | 'background' | 'embed';
export interface RawOutlinePiece {
  /** 1..n in document order */
  id: number;
  type: RawOutlinePieceType;
  /** Tag of the nearest element */
  tag: string;
  /** Page coordinates; zero for hidden text */
  box: RawBox;
  font?: { size: number; weight: number; uppercase: boolean; color: string };
  /** Opaque color behind the piece */
  background?: string;
  align?: string;
  /** Kept hidden text: an accordion answer, a tab panel, a slide */
  hidden?: boolean;
  /** heading, text */
  text?: string;
  /** heading from h1..h6 */
  level?: number;
  /** A heading that is not an h tag (bold, larger or uppercase line) */
  styled?: boolean;
  /** list: one line per entry */
  lines?: string[];
  links?: RawSiteLink[];
  image?: RawSiteImage;
  /** background: absolute URL */
  src?: string;
  embed?: RawSiteEmbed;
}
export interface RawPageOutline {
  pieces: RawOutlinePiece[];
  /** The font size carrying the most text, px */
  bodySize: number;
  pageHeight: number;
  /** More than OUTLINE pieces; the rest were not collected */
  truncated: boolean;
}
```
- `RawSiteSections` gains `outline?: RawPageOutline` (optional, since tests and old fixtures build raw readings without it).

- [ ] **Step 1: Write the failing fixture tests.** Add these to the existing `describe` in `site-sections.page.spec.ts`; they use its `pageOf`, `HEADER` and `FOOTER`. Add a helper at the top of the new block:

```ts
const outlineOf = async (html: string) => {
  await page.setContent(html);
  await page.evaluate(collectSiteLayoutInPage);
  return (await page.evaluate(collectSiteSectionsInPage)).outline!;
};
const brief = (o: RawPageOutline) => o.pieces.map((p) => `${p.type}:${p.text ?? p.lines?.join('|') ?? p.links?.map((l) => l.label).join('|') ?? p.image?.alt ?? p.src ?? p.embed?.kind}`);
```

```ts
describe('outline (REV-113)', () => {
  it('cuts a table cell of <font><big><b> headings and <br> paragraphs into pieces in order', async () => {
    const o = await outlineOf(pageOf(`<table width="900" align="center"><tr>
      <td width="367"><img src="https://img.test/logo.png" alt="ANIDENT" width="367" height="179"></td>
      <td><a href="/">Start</a> | <a href="/oferta">Oferta</a> | <a href="/kontakt">Kontakt</a></td></tr>
      <tr><td colspan="2" width="460"><font face="Verdana" size="2"><big><b>IMPLANTY ZĘBÓW</b></big><br>
      Implanty to najlepsza metoda uzupełnienia braków zębowych, trwała i wygodna.<br>Zabieg trwa godzinę.<br><br>
      <img src="https://img.test/implant.jpg" alt="Implanty" width="350" height="233" align="right">
      <big><b>LICÓWKI</b></big><br>Licówki bez szlifowania zmieniają uśmiech w jeden dzień.</font></td></tr></table>`));
    expect(brief(o)).toEqual([
      'image:ANIDENT',
      'links:Start|Oferta|Kontakt',
      'heading:IMPLANTY ZĘBÓW',
      'text:Implanty to najlepsza metoda uzupełnienia braków zębowych, trwała i wygodna. Zabieg trwa godzinę.',
      'image:Implanty',
      'heading:LICÓWKI',
      'text:Licówki bez szlifowania zmieniają uśmiech w jeden dzień.',
    ]);
    expect(o.pieces.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const implanty = o.pieces[2]!;
    expect(implanty).toMatchObject({ styled: true, font: { weight: 700 } });
    expect(implanty.level).toBeUndefined();
    expect(implanty.box.width).toBeGreaterThan(0);
  });

  it('finds styled headings by weight, size or case, and not a bold lead-in, a long bold line or a line ending in a comma', async () => {
    const o = await outlineOf(pageOf(`<div style="width:600px">
      <p><span style="font-size:24px">Nasze usługi</span></p>
      <p><span style="text-transform:uppercase">cennik zabiegów</span></p>
      <p>KONTAKT</p>
      <p><b>Uwaga:</b> przyjmujemy tylko po rejestracji telefonicznej w godzinach pracy.</p>
      <p><b>${'Bardzo długa pogrubiona linia, '.repeat(5)}</b></p>
      <p><b>Szanowni Państwo,</b></p>
      <h3>Godziny otwarcia</h3></div>`));
    const heads = o.pieces.filter((p) => p.type === 'heading').map((p) => [p.text, p.styled ?? false, p.level]);
    expect(heads).toEqual([
      ['Nasze usługi', true, undefined],
      ['cennik zabiegów', true, undefined],
      ['KONTAKT', true, undefined],
      ['Godziny otwarcia', false, 3],
    ]);
  });

  it('splits a flat run of siblings with no wrappers into pieces', async () => {
    const o = await outlineOf(pageOf(`<div id="c" style="width:700px"><b>O NAS</b><br>Jesteśmy kliniką od 1995 roku.<br><br>
      <b>ZESPÓŁ</b><br>Pięciu lekarzy, trzy gabinety.<img src="https://img.test/team.jpg" alt="Zespół" width="300" height="200"></div>`));
    expect(brief(o)).toEqual(['heading:O NAS', 'text:Jesteśmy kliniką od 1995 roku.', 'heading:ZESPÓŁ', 'text:Pięciu lekarzy, trzy gabinety.', 'image:Zespół']);
  });

  it('reads a menu as one links piece, a plain list as one list piece, and leaves out spacers and bullets', async () => {
    const o = await outlineOf(pageOf(`${HEADER}<section><h2>Oferta</h2>
      <img src="https://img.test/spacer.gif" width="1" height="23"><img src="https://img.test/dot.png" width="11" height="11">
      <ul><li>Implanty</li><li>Protetyka</li><li>Ortodoncja</li></ul></section>${FOOTER}`));
    const types = brief(o);
    expect(types).toContain('links:Start|Oferta|Kontakt');
    expect(types).toContain('list:Implanty|Protetyka|Ortodoncja');
    expect(types.filter((t) => t.startsWith('image:'))).toEqual(['image:Falco-Dent']);
  });

  it('records background photos and embeds as pieces, and marks kept hidden text', async () => {
    const o = await outlineOf(pageOf(`<section style="height:400px;background:url(https://img.test/hero.jpg) center/cover"><h1>Witamy</h1></section>
      <section><h2>FAQ</h2><details><summary>Czy boli?</summary><p>Nie, zabieg jest w znieczuleniu.</p></details>
      <iframe src="https://www.google.com/maps/embed?pb=1" width="600" height="300"></iframe></section>`));
    expect(o.pieces.find((p) => p.type === 'background')?.src).toBe('https://img.test/hero.jpg');
    expect(o.pieces.find((p) => p.type === 'embed')?.embed?.kind).toBe('map');
    expect(o.pieces.find((p) => p.text === 'Nie, zabieg jest w znieczuleniu.')?.hidden).toBe(true);
  });

  it('stops at the piece cap and says so', async () => {
    const o = await outlineOf(pageOf(Array.from({ length: 700 }, (_, i) => `<p>Akapit numer ${i} z treścią.</p>`).join('')));
    expect(o.pieces).toHaveLength(600);
    expect(o.truncated).toBe(true);
  });

  it('reports the body size from the text it carries', async () => {
    const o = await outlineOf(pageOf(`<p>${'Zwykły tekst akapitu. '.repeat(20)}</p><h2>Duży</h2>`));
    expect(o.bodySize).toBe(16);
  });
});
```
Import `RawPageOutline` from `../site-sections.page.js`.

- [ ] **Step 2: Run them to make sure they fail.** Run `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts`. Expected: the new tests FAIL (`outline` is undefined); the existing tests still pass.

- [ ] **Step 3: Implement the collector.** Add it inside `collectSiteSectionsInPage`, after the typography block, and add `outline` to the returned object. It is self-contained and reuses the function's helpers (`clean`, `excluded`, `inFormUi`, `isBlock`, `linkOf`, `imageOf`, `boxOf`, `unionOf`, `backgroundOf`, `closedStyle`, `MAP_SRC`, `VIDEO_SRC`, `absolute`).

```ts
  // Page outline (REV-113): small numbered pieces a vision model groups into sections by id. Text is
  // cut at <br> and block edges, so a table cell of <font><big><b> headings becomes headings and paragraphs.
  const MAX_PIECES = 600;
  const pieces: RawOutlinePiece[] = [];
  let outlineTruncated = false;
  const addPiece = (piece: Omit<RawOutlinePiece, 'id'>) => {
    if (pieces.length >= MAX_PIECES) {
      outlineTruncated = true;
      return;
    }
    pieces.push({ id: pieces.length + 1, ...piece });
  };
  const sizeOf = (el: Element) => parseFloat(window.getComputedStyle(el).fontSize) || 0;
  // The body size: the font size that carries the most text
  const charsBySize = new Map<number, number>();
  {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const length = (node.nodeValue || '').trim().length;
      if (!parent || !length || excluded(parent)) continue;
      const size = Math.round(sizeOf(parent));
      charsBySize.set(size, (charsBySize.get(size) ?? 0) + length);
    }
  }
  const bodySize = Array.from(charsBySize).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;
  const fontFacts = (el: Element) => {
    const s = window.getComputedStyle(el);
    return { size: Math.round(parseFloat(s.fontSize) || 0), weight: Number(s.fontWeight) || 400, uppercase: s.textTransform === 'uppercase', color: s.color };
  };
  const shared = (el: Element) => ({ tag: el.tagName.toLowerCase(), font: fontFacts(el), background: backgroundOf(el), align: window.getComputedStyle(el).textAlign });
  // Closed menus in the header, the nav and the footer are not page text (the rules reader skips them too)
  const closedChrome = (el: Element) => {
    const chromeRoot = el.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]');
    if (!chromeRoot) return false;
    for (let node: Element | null = el; node && node !== chromeRoot.parentElement; node = node.parentElement) if (closedStyle(node)) return true;
    return false;
  };
  const skipText = (el: Element) => excluded(el) || inFormUi(el) || closedChrome(el);

  type Fragment = { node: Text; el: Element };
  let line: Fragment[] = [];
  let lines: Fragment[][] = [];
  let blankPending = false;
  const lineText = (frags: Fragment[]) => clean(frags.map((f) => f.node.nodeValue).join(' '));
  const lineBox = (frags: Fragment[]): RawBox => {
    const range = document.createRange();
    range.setStartBefore(frags[0]!.node);
    range.setEndAfter(frags[frags.length - 1]!.node);
    const r = range.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY), left: Math.round(r.left + window.scrollX), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const linksOfFrags = (frags: Fragment[]) =>
    Array.from(new Set(frags.map((f) => f.el.closest('a[href]')).filter((a): a is Element => a !== null)))
      .map(linkOf)
      .filter((link): link is RawSiteLink => link !== undefined);
  const LETTERS = /\p{L}/gu;
  const styledHeading = (frags: Fragment[]): boolean => {
    const text = lineText(frags);
    if (text.length < 1 || text.length > 120 || /[,;]$/.test(text)) return false;
    return frags
      .filter((f) => clean(f.node.nodeValue))
      .every((f) => {
        const s = window.getComputedStyle(f.el);
        const own = clean(f.node.nodeValue);
        const letters = own.match(LETTERS) ?? [];
        const upperText = letters.length >= 4 && own === own.toUpperCase() && own !== own.toLowerCase();
        return Number(s.fontWeight) >= 600 || (parseFloat(s.fontSize) || 0) >= bodySize * 1.2 || s.textTransform === 'uppercase' || upperText;
      });
  };
  const endLine = () => {
    if (line.length) lines.push(line);
    line = [];
  };
  const flushText = (pending: Fragment[][]) => {
    const frags = pending.flat();
    if (!frags.length) return;
    const box = unionOf(pending.map(lineBox)) ?? { top: 0, left: 0, width: 0, height: 0 };
    addPiece({ type: 'text', ...shared(frags[0]!.el), box, text: lineText(frags), links: linksOfFrags(frags), ...(box.width === 0 ? { hidden: true } : {}) });
  };
  /** Ends the paragraph: heading lines become headings, the lines between them one text piece each */
  const flushParagraph = () => {
    endLine();
    let pending: Fragment[][] = [];
    for (const frags of lines) {
      if (styledHeading(frags)) {
        flushText(pending);
        pending = [];
        const box = lineBox(frags);
        addPiece({ type: 'heading', ...shared(frags[0]!.el), box, text: lineText(frags), styled: true, links: linksOfFrags(frags), ...(box.width === 0 ? { hidden: true } : {}) });
      } else pending.push(frags);
    }
    flushText(pending);
    lines = [];
    blankPending = false;
  };
  const lineBreak = () => {
    if (line.length) {
      endLine();
      blankPending = false;
    } else if (lines.length && !blankPending) {
      // <br><br>: a blank line ends the paragraph
      flushParagraph();
      blankPending = true;
    }
  };

  const addImage = (el: Element) => {
    if (excluded(el)) return;
    const image = imageOf(el);
    if (!image) return;
    const { width, height } = image.box;
    if ((width > 0 || height > 0) && width < 40 && height < 40) return;
    addPiece({ type: 'image', tag: 'img', box: image.box, image, ...(width === 0 ? { hidden: true } : {}) });
  };
  const embedOf = (el: Element): RawSiteEmbed | undefined => {
    if (el.tagName === 'FORM') {
      const action = absolute(el.getAttribute('action'));
      return { kind: 'form', ...(action ? { src: action } : {}), box: boxOf(el) };
    }
    const src = absolute(el.getAttribute('src') || el.getAttribute('data-src') || el.querySelector('source')?.getAttribute('src'));
    if (el.tagName === 'IFRAME') return { kind: src && MAP_SRC.test(src) ? 'map' : src && VIDEO_SRC.test(src) ? 'video' : 'widget', ...(src ? { src } : {}), box: boxOf(el) };
    if (el.tagName === 'VIDEO') return { kind: 'video', ...(src ? { src } : {}), box: boxOf(el) };
    return { kind: 'map', box: boxOf(el) };
  };
  const EMBED = 'iframe, video, form, .leaflet-container, .gm-style';
  /** Every text node under the element sits in a link, and it holds no photo: a menu, a button row */
  const allLinks = (el: Element): boolean => {
    if (Array.from(el.querySelectorAll('img')).some((img) => { const r = img.getBoundingClientRect(); return r.width >= 40 || r.height >= 40; })) return false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let any = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !clean(node.nodeValue) || skipText(parent)) continue;
      // Separators between menu links ("|", "·") are not copy
      if (!parent.closest('a[href]')) {
        if (/^[|·•/\\\-–—\s]+$/.test(node.nodeValue || '')) continue;
        return false;
      }
      any = true;
    }
    return any;
  };
  const plainList = (el: Element) =>
    (el.tagName === 'UL' || el.tagName === 'OL') &&
    Array.from(el.children).every((li) => li.tagName === 'LI' && !li.querySelector('img, h1, h2, h3, h4, h5, h6') && Array.from(li.querySelectorAll('*')).every((d) => !isBlock(d)));

  let visited = 0;
  const visit = (el: Element) => {
    if (++visited > 20000 || pieces.length >= MAX_PIECES) {
      if (pieces.length >= MAX_PIECES) outlineTruncated = true;
      return;
    }
    if (el !== document.body && excluded(el)) return;
    if (el.tagName === 'IMG') return addImage(el);
    if (el.matches(EMBED)) {
      flushParagraph();
      const embed = embedOf(el);
      if (embed) addPiece({ type: 'embed', tag: el.tagName.toLowerCase(), box: embed.box, embed });
      return;
    }
    if (el !== document.body && el !== document.documentElement) {
      const match = window.getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      const r = el.getBoundingClientRect();
      const src = match ? absolute(match[1]) : undefined;
      if (src && r.width >= 200 && r.height >= 100) addPiece({ type: 'background', tag: el.tagName.toLowerCase(), box: boxOf(el), src });
    }
    if (/^H[1-6]$/.test(el.tagName)) {
      flushParagraph();
      const text = textOf(el);
      if (text && !skipText(el)) {
        const box = boxOf(el);
        addPiece({ type: 'heading', ...shared(el), box, text, level: Number(el.tagName[1]), links: linksIn(el, []).links, ...(box.width === 0 ? { hidden: true } : {}) });
      }
      el.querySelectorAll('img').forEach(addImage);
      return;
    }
    if (el !== document.body && isBlock(el) && allLinks(el)) {
      flushParagraph();
      const links = Array.from(el.querySelectorAll('a[href]')).filter((a) => !skipText(a)).map(linkOf).filter((l): l is RawSiteLink => l !== undefined);
      if (links.length) addPiece({ type: 'links', ...shared(el), box: boxOf(el), links });
      return;
    }
    if (plainList(el) && !skipText(el)) {
      flushParagraph();
      const items = Array.from(el.children).map((li) => textOf(li)).filter(Boolean);
      const box = boxOf(el);
      if (items.length) addPiece({ type: 'list', ...shared(el), box, lines: items, links: linksIn(el, []).links, ...(box.width === 0 ? { hidden: true } : {}) });
      return;
    }
    const block = isBlock(el);
    if (block) flushParagraph();
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (clean(child.nodeValue) && !skipText(el)) {
          line.push({ node: child as Text, el });
          blankPending = false;
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childEl = child as Element;
      if (childEl.tagName === 'BR') lineBreak();
      else visit(childEl);
    }
    if (block) flushParagraph();
  };
  visit(document.body);
  flushParagraph();
  const outline: RawPageOutline = { pieces, bodySize, pageHeight: Math.round(document.documentElement.scrollHeight), truncated: outlineTruncated };
```
Add `outline` to the returned object. Note the order: an inline child element (`<b>`, `<font>`, `<a>`) is visited through the same `visit`. It is not a block, so it adds its text nodes to the current `line` without flushing, which is what lets `<big><b>X</b></big><br>` form a line on its own.

- [ ] **Step 4: Run.** Run the page spec again. Expected: all of it PASSES. If a whitespace detail differs in an expected string (for example a double space joined across `<br>`), adjust `lineText`, not the test.

- [ ] **Step 5: Commit** with `feat(REV-113): the page outline: numbered pieces with styled headings`.

---

### Task 3: Reader hooks: hint, leftOut, source

**Files:**
- Modify: `apps/workers/src/services/site-sections.page.ts` (`RawSiteBlock`, `RawSiteSections` types only)
- Modify: `apps/workers/src/services/site-sections.service.ts:320-331` (`toSection`), `:404` (`readSiteSections`)
- Test: `apps/workers/src/services/__tests__/site-sections.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `RawSiteBlock.hint?: { kind: SiteSectionKind; arrangement: SiteSectionArrangement }`;
  - `RawSiteSections.leftOut?: RawLeftOut[]` with `export interface RawLeftOut { index: number; text: string }`, where `index` is the position in page order (header, blocks, footer) the run sits before;
  - `export function hintedArrangement(block: RawSiteBlock): ReturnType<typeof arrangementOf> | undefined`;
  - `readSiteSections(raw, layoutBlocks = [], source: SiteSectionsSource = 'rules')`.

- [ ] **Step 1: Write the failing tests.** Use the spec file's existing raw-block builder; if it has none, add `const blockOf = (over: Partial<RawSiteBlock>): RawSiteBlock => ({ role: 'content', box: { top: 1000, left: 0, width: 1440, height: 400 }, intro: { text: [], links: [] }, extra: [], images: [], embeds: [], style: { background: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', textAlign: 'left', paddingTop: 40, paddingBottom: 40 }, ...over })`.

```ts
describe('model hints and left-out pieces (REV-113)', () => {
  const raw = (blocks: RawSiteBlock[], extra: Partial<RawSiteSections> = {}): RawSiteSections => ({ viewportWidth: 1440, viewportHeight: 900, blocks, typography: {}, pageChars: 400, uncaptured: [], ...extra });
  const item = (title: string): RawSiteItem => ({ title, text: ['Opis usługi'], links: [], icon: false, box: { top: 1100, left: 0, width: 300, height: 200 } });

  it('takes the hinted kind, and the hinted arrangement when the content allows it', () => {
    const grid = blockOf({ intro: { heading: 'Oferta', text: [], links: [] }, group: { items: [item('A'), { ...item('B'), box: { top: 1100, left: 320, width: 300, height: 200 } }] }, hint: { kind: 'services', arrangement: 'card-grid' } });
    const s = readSiteSections(raw([grid]), [], 'llm').sections!;
    expect(s.source).toBe('llm');
    expect(s.sections[0]).toMatchObject({ kind: 'services', arrangement: 'card-grid', columns: 2 });
  });

  it('falls back to the measured arrangement when the hint does not fit the content', () => {
    const one = blockOf({ intro: { heading: 'O nas', text: ['Tekst sekcji o nas.'], links: [] }, hint: { kind: 'about', arrangement: 'gallery' } });
    expect(readSiteSections(raw([one])).sections!.sections[0]).toMatchObject({ kind: 'about', arrangement: 'text' });
  });

  it('records left-out runs as unassigned skips that do not count as captured', () => {
    const text = 'x'.repeat(100);
    const b = blockOf({ intro: { heading: 'O nas', text: [text], links: [] } });
    const s = readSiteSections(raw([b], { pageChars: 205, leftOut: [{ index: 1, text: 'y'.repeat(100) }] }), [], 'llm').sections!;
    expect(s.skipped).toContainEqual({ index: 1, reason: 'unassigned', sample: 'y'.repeat(100) });
    expect(s.coverage.capturedChars).toBe(105);
  });

  it('marks a rules reading as such', () => {
    expect(readSiteSections(raw([blockOf({ intro: { heading: 'O nas', text: ['Tekst'], links: [] } })])).sections!.source).toBe('rules');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run apps/workers/src/services/__tests__/site-sections.service.spec.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Types in `site-sections.page.ts`:
```ts
export interface RawSiteBlock {
  // ...existing fields
  /** The vision model's kind and arrangement for a grouped section (REV-113); the reader checks them against the content */
  hint?: { kind: SiteSectionKind; arrangement: SiteSectionArrangement };
}
/** Pieces the vision model placed in no section, one run each (REV-113) */
export interface RawLeftOut {
  /** Position in page order (header, blocks, footer) the run sits before */
  index: number;
  text: string;
}
```
Add `outline?` (Task 2) and `leftOut?: RawLeftOut[]` to `RawSiteSections`. Use type-only imports of `SiteSectionKind` and `SiteSectionArrangement` from `@revamp/shared-types`; type imports are erased, so the in-page function stays self-contained.

In `site-sections.service.ts`:
```ts
const ITEM_ARRANGEMENTS = new Set<SiteSectionArrangement>(['card-grid', 'list', 'accordion', 'tabs', 'slider', 'gallery']);

/** The model's arrangement for a grouped section, when the assembled content can be shown that way (REV-113) */
export function hintedArrangement(block: RawSiteBlock): ReturnType<typeof arrangementOf> | undefined {
  const arrangement = block.hint?.arrangement;
  if (!arrangement) return undefined;
  const items = block.group?.items ?? [];
  if (ITEM_ARRANGEMENTS.has(arrangement)) {
    if (items.length < 2) return undefined;
    return arrangement === 'card-grid' ? { arrangement, columns: Math.min(MAX_COLUMNS, Math.max(1, columnsOf(items))) } : { arrangement };
  }
  if (arrangement === 'embed') return block.embeds.length > 0 ? { arrangement } : undefined;
  if (arrangement === 'banner') return block.backgroundImage || block.images.length > 0 ? { arrangement } : undefined;
  if (arrangement === 'media-beside-text') {
    const measured = arrangementOf(block);
    if (measured.arrangement === 'media-beside-text') return measured;
    const media = [...block.images].sort((a, b) => area(b.box) - area(a.box))[0];
    const text = block.introBox;
    if (!media) return undefined;
    return { arrangement, ...(text ? { mediaSide: media.box.left + media.box.width / 2 < text.left + text.width / 2 ? ('left' as const) : ('right' as const) } : {}) };
  }
  return { arrangement };
}
```
In `toSection`: `kind = block.hint?.kind ?? kindFromItems(named) ?? …` (the content-block branch only), and `const arrangement = hintedArrangement(block) ?? arrangementOf(block);`.

In `readSiteSections` add the parameter `source: SiteSectionsSource = 'rules'`. After the `ordered.forEach` loop:
```ts
  // Pieces the model placed nowhere: recorded, never counted as captured, so coverage shows the loss (REV-113)
  for (const run of raw.leftOut ?? []) {
    if (skipped.length < L.skipped) skipped.push({ index: run.index, reason: 'unassigned', sample: cleanText(run.text).slice(0, L.sampleChars) });
  }
```
Set `source` on `result`. Update the file header comment: "No LLM at any step" becomes "No LLM here; a grouping from the vision model (REV-113) arrives as assembled blocks with hints".

- [ ] **Step 4: Run.** Run the service spec plus `apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts`. Expected: PASS (`source` is optional, and the plan specs build readings without it).

- [ ] **Step 5: Commit** with `feat(REV-113): reader takes model hints, records unassigned pieces and its source`.

---

### Task 4: Checking and assembling the answer (pure)

**Files:**
- Create: `apps/workers/src/services/site-grouping.ts`
- Test: `apps/workers/src/services/__tests__/site-grouping.spec.ts`

**Interfaces:**
- Consumes: `RawPageOutline`, `RawOutlinePiece`, `RawSiteSections`, `RawSiteBlock`, `RawLeftOut` (Tasks 2–3); `SiteGroupingAnswer`, `OUTLINE_LIMITS` (Task 1); `readSiteSections(raw, [], 'llm')`.
- Produces:
  - `checkGrouping(answer: SiteGroupingAnswer, outline: RawPageOutline): string[]`;
  - `assembleGroupedBlocks(raw: RawSiteSections, outline: RawPageOutline, answer: SiteGroupingAnswer): RawSiteSections`;
  - `readGroupedSections(raw: RawSiteSections, answer: SiteGroupingAnswer): SiteSectionsReading`;
  - `outlinePrompt(outline: RawPageOutline, tiles: { top: number; bottom: number }[]): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { rebuildEligibility, type SiteGroupingAnswer } from '@revamp/validation';
import type { RawOutlinePiece, RawPageOutline, RawSiteSections } from '../site-sections.page.js';
import { assembleGroupedBlocks, checkGrouping, outlinePrompt, readGroupedSections } from '../site-grouping.js';

const box = (top: number, left = 480, width = 460, height = 40) => ({ top, left, width, height });
const font = { size: 13, weight: 400, uppercase: false, color: 'rgb(0, 0, 0)' };
const bold = { ...font, size: 15, weight: 700 };
const P = (id: number, type: RawOutlinePiece['type'], over: Partial<RawOutlinePiece> = {}): RawOutlinePiece => ({ id, type, tag: 'td', box: box(id * 100), font, background: 'rgb(255, 255, 255)', align: 'left', ...over });
const long = (s: string) => `${s} ${'treść akapitu '.repeat(12)}`.trim();

// anident-like: logo, menu, three headed sections with floated photos, footer
const pieces: RawOutlinePiece[] = [
  P(1, 'image', { tag: 'img', box: box(20, 40, 367, 179), image: { src: 'https://anident.test/logo.jpg', alt: 'ANIDENT', box: box(20, 40, 367, 179), radius: 0 } }),
  P(2, 'links', { box: box(210, 40, 1360, 30), links: [{ label: 'Start', href: 'https://anident.test/', button: false }, { label: 'Oferta', href: 'https://anident.test/oferta', button: false }] }),
  P(3, 'heading', { text: 'IMPLANTY ZĘBÓW', styled: true, font: bold }),
  P(4, 'text', { text: long('Implanty') }),
  P(5, 'image', { tag: 'img', box: box(500, 590, 350, 233), image: { src: 'https://anident.test/implant.jpg', alt: 'Implanty', box: box(500, 590, 350, 233), radius: 0 } }),
  P(6, 'heading', { text: 'LICÓWKI', styled: true, font: bold }),
  P(7, 'text', { text: long('Licówki') }),
  P(8, 'image', { tag: 'img', box: box(800, 480, 350, 350), image: { src: 'https://anident.test/licowki.jpg', alt: 'Licówki', box: box(800, 480, 350, 350), radius: 0 } }),
  P(9, 'heading', { text: 'ORTODONCJA', styled: true, font: bold }),
  P(10, 'text', { text: long('Aparaty') }),
  P(11, 'text', { text: 'ul. Przykładowa 1, Warszawa · tel. 22 000 00 00', box: box(1300, 40, 1360, 30) }),
  P(12, 'text', { text: 'Licznik odwiedzin 12345' }),
];
const outline: RawPageOutline = { pieces, bodySize: 13, pageHeight: 1400, truncated: false };
const raw: RawSiteSections = { viewportWidth: 1440, viewportHeight: 900, blocks: [], typography: {}, pageChars: pieces.reduce((n, p) => n + (p.text?.length ?? 0), 0) + 11, uncaptured: [], outline };
const answer: SiteGroupingAnswer = {
  header: { logo: 1, pieces: [2] },
  sections: [
    { heading: 3, pieces: [4, 5], kind: 'services', arrangement: 'media-beside-text' },
    { heading: 6, pieces: [7, 8], kind: 'services', arrangement: 'media-beside-text' },
    { heading: 9, pieces: [10], kind: 'services', arrangement: 'text' },
  ],
  footer: { pieces: [11] },
};

describe('checkGrouping (REV-113)', () => {
  it('accepts a valid answer', () => expect(checkGrouping(answer, outline)).toEqual([]));
  it('rejects an unknown id', () => expect(checkGrouping({ ...answer, footer: { pieces: [99] } }, outline)).toContain('unknown id 99'));
  it('rejects a piece used twice', () =>
    expect(checkGrouping({ ...answer, footer: { pieces: [11, 4] } }, outline)).toContain('piece 4 used twice'));
  it('rejects a heading that is not heading-like', () =>
    expect(checkGrouping({ ...answer, sections: [{ ...answer.sections[0]!, heading: 5, pieces: [4] }, ...answer.sections.slice(1)] }, outline)).toContain('section 1: heading 5 is not a heading'));
  it('rejects a long text piece as a heading', () =>
    expect(checkGrouping({ ...answer, sections: [{ ...answer.sections[0]!, heading: 4, pieces: [3, 5] }, ...answer.sections.slice(1)] }, outline)).toContain('section 1: heading 4 is not a heading'));
  it('rejects a logo that is not an image', () => expect(checkGrouping({ ...answer, header: { logo: 2, pieces: [] } }, outline)).toContain('logo 2 is not an image'));
});

describe('assembleGroupedBlocks / readGroupedSections (REV-113)', () => {
  it('keeps each photo with its text, reads the header logo and nav and the footer, and passes the rebuild gate', () => {
    const read = readGroupedSections(raw, answer).sections!;
    expect(read.source).toBe('llm');
    const [header, ...rest] = read.sections;
    expect(header).toMatchObject({ role: 'header', images: [{ src: 'https://anident.test/logo.jpg' }] });
    expect(header!.intro.links.map((l) => l.label)).toEqual(['Start', 'Oferta']);
    const body = rest.filter((s) => s.role !== 'footer');
    expect(body.map((s) => s.intro.heading)).toEqual(['IMPLANTY ZĘBÓW', 'LICÓWKI', 'ORTODONCJA']);
    expect(body[0]!.images.map((i) => i.src)).toEqual(['https://anident.test/implant.jpg']);
    expect(body[0]!.arrangement).toBe('media-beside-text');
    expect(body.every((s) => s.arrangement !== 'gallery')).toBe(true);
    expect(read.sections.at(-1)!.role).toBe('footer');
  });

  it('records left-out pieces as unassigned and lowers coverage by their text', () => {
    const read = readGroupedSections(raw, answer).sections!;
    expect(read.skipped).toContainEqual(expect.objectContaining({ reason: 'unassigned', sample: 'Licznik odwiedzin 12345' }));
    expect(read.coverage.capturedChars).toBeLessThan(raw.pageChars);
  });

  it('sorts sections and their text into page order whatever order the model used', () => {
    const shuffled = { ...answer, sections: [answer.sections[2]!, { ...answer.sections[0]!, pieces: [5, 4] }, answer.sections[1]!] };
    const blocks = assembleGroupedBlocks(raw, outline, shuffled).blocks;
    expect(blocks.map((b) => b.intro.heading)).toEqual(['IMPLANTY ZĘBÓW', 'LICÓWKI', 'ORTODONCJA']);
    expect(blocks[0]!.intro.text[0]).toMatch(/^Implanty/);
  });

  it('builds items from item ids, with their own photo', () => {
    const cards: RawOutlinePiece[] = [
      P(1, 'heading', { text: 'Oferta', level: 2 }),
      P(2, 'heading', { text: 'Implanty', level: 3, box: box(200, 0, 300, 30) }), P(3, 'text', { text: 'Opis A', box: box(240, 0, 300, 60) }),
      P(4, 'image', { tag: 'img', box: box(300, 0, 300, 200), image: { src: 'https://x.test/a.jpg', alt: '', box: box(300, 0, 300, 200), radius: 0 } }),
      P(5, 'heading', { text: 'Protetyka', level: 3, box: box(200, 320, 300, 30) }), P(6, 'text', { text: 'Opis B', box: box(240, 320, 300, 60) }),
    ];
    const o = { ...outline, pieces: cards };
    const a: SiteGroupingAnswer = { sections: [{ heading: 1, pieces: [], items: [{ title: 2, pieces: [3, 4] }, { title: 5, pieces: [6] }], kind: 'services', arrangement: 'card-grid' }] };
    const s = readGroupedSections({ ...raw, outline: o, pageChars: 40 }, a).sections!.sections[0]!;
    expect(s).toMatchObject({ arrangement: 'card-grid', columns: 2, kind: 'services' });
    expect(s.items.map((i) => [i.title, i.text, i.image?.src])).toEqual([['Implanty', ['Opis A'], 'https://x.test/a.jpg'], ['Protetyka', ['Opis B'], undefined]]);
  });

  it('hidden pieces keep their text but not their geometry', () => {
    const hidden = [...pieces.slice(0, 4), P(5, 'text', { text: 'Ukryta odpowiedź', hidden: true, box: box(0, 0, 0, 0) })];
    const o = { ...outline, pieces: hidden };
    const blocks = assembleGroupedBlocks(raw, o, { sections: [{ heading: 3, pieces: [4, 5], kind: 'faq', arrangement: 'text' }] }).blocks;
    expect(blocks[0]!.intro.text).toContain('Ukryta odpowiedź');
    expect(blocks[0]!.box.top).toBe(300);
  });

  it('the assembled anident-like reading passes rebuildEligibility', () => {
    const read = readGroupedSections({ ...raw, pageChars: 1600 }, answer).sections!;
    expect(rebuildEligibility({ siteSections: { ...read, coverage: { ...read.coverage, ratio: 0.9 } } })).toEqual({ ok: true });
  });

  it('refuses an invalid answer with its reasons', () => {
    expect(readGroupedSections(raw, { ...answer, footer: { pieces: [99] } }).error).toMatch(/unknown id 99/);
    expect(readGroupedSections({ ...raw, outline: undefined }, answer).error).toBe('No page outline');
  });
});

describe('outlinePrompt (REV-113)', () => {
  it('lists every piece on one line with its facts and a text preview, and the tile ranges', () => {
    const text = outlinePrompt(outline, [{ top: 0, bottom: 1400 }]);
    expect(text).toContain('tile 1: y 0–1400');
    expect(text).toMatch(/^3 heading styled 15px b "IMPLANTY ZĘBÓW" y=300 x=480 w=460 h=40$/m);
    expect(text).toMatch(/^5 image 350x233 alt="Implanty" y=500 x=590$/m);
    expect(text).toMatch(/^2 links \["Start","Oferta"\] y=210 x=40 w=1360 h=30$/m);
    expect(text).toMatch(/^4 text 13px "Implanty treść.*… \(\d+ chars\)" y=400/m);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run apps/workers/src/services/__tests__/site-grouping.spec.ts`. Expected: FAIL (the module is missing).

- [ ] **Step 3: Implement `site-grouping.ts`**

```ts
/**
 * The vision model's grouping of the page (REV-113), made safe: `checkGrouping` refuses any answer that
 * names an unknown piece, uses one twice or gives a section no heading; `assembleGroupedBlocks` copies
 * every piece from the page by id into the reader's raw blocks. The model never writes text: what it
 * answers is ids, a kind and an arrangement, and `readSiteSections` checks those against the content.
 */
import { OUTLINE_LIMITS, type SiteGroupingAnswer } from '@revamp/validation';
import type { RawBox, RawLeftOut, RawOutlinePiece, RawPageOutline, RawSiteBlock, RawSiteItem, RawSiteSections } from './site-sections.page.js';
import { readSiteSections, type SiteSectionsReading } from './site-sections.service.js';

/** Longest text piece that may be a section's heading */
const HEADING_MAX_CHARS = 120;
/** Padding read from the gap between sections is capped, px */
const MAX_PADDING = 120;

type Section = SiteGroupingAnswer['sections'][number];

const idsOf = (answer: SiteGroupingAnswer): number[] => [
  ...(answer.header?.logo !== undefined ? [answer.header.logo] : []),
  ...(answer.header?.pieces ?? []),
  ...answer.sections.flatMap((s) => [s.heading, ...(s.eyebrow !== undefined ? [s.eyebrow] : []), ...s.pieces, ...(s.items ?? []).flatMap((i) => [...(i.title !== undefined ? [i.title] : []), ...i.pieces])]),
  ...(answer.footer?.pieces ?? []),
];

const headingLike = (piece: RawOutlinePiece | undefined) =>
  piece !== undefined && (piece.type === 'heading' || (piece.type === 'text' && (piece.text?.length ?? 0) <= HEADING_MAX_CHARS));

/** Why the answer cannot be used; empty when every id exists, is used once, and every section has a heading */
export function checkGrouping(answer: SiteGroupingAnswer, outline: RawPageOutline): string[] {
  const byId = new Map(outline.pieces.map((p) => [p.id, p]));
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const id of idsOf(answer)) {
    if (!byId.has(id)) problems.push(`unknown id ${id}`);
    else if (seen.has(id)) problems.push(`piece ${id} used twice`);
    seen.add(id);
  }
  answer.sections.forEach((s, i) => {
    if (byId.has(s.heading) && !headingLike(byId.get(s.heading))) problems.push(`section ${i + 1}: heading ${s.heading} is not a heading`);
  });
  const logo = answer.header?.logo;
  if (logo !== undefined && byId.has(logo) && byId.get(logo)!.type !== 'image') problems.push(`logo ${logo} is not an image`);
  return Array.from(new Set(problems));
}

const ZERO: RawBox = { top: 0, left: 0, width: 0, height: 0 };
const drawn = (b: RawBox) => b.width > 0 && b.height > 0;
const union = (boxes: RawBox[]): RawBox | undefined => {
  const list = boxes.filter(drawn);
  if (!list.length) return undefined;
  const top = Math.min(...list.map((b) => b.top));
  const left = Math.min(...list.map((b) => b.left));
  return { top, left, width: Math.max(...list.map((b) => b.left + b.width)) - left, height: Math.max(...list.map((b) => b.top + b.height)) - top };
};
const byPage = (a: RawOutlinePiece, b: RawOutlinePiece) => a.id - b.id;
const isCopy = (p: RawOutlinePiece) => p.type === 'text' || p.type === 'list' || p.type === 'heading';
const linesOf = (p: RawOutlinePiece) => (p.type === 'list' ? (p.lines ?? []) : p.text ? [p.text] : []);
const area = (b: RawBox) => b.width * b.height;

/** The background behind most of the pieces' text */
function backgroundOf(pieces: RawOutlinePiece[]): string {
  const weight = new Map<string, number>();
  for (const p of pieces.filter(isCopy)) {
    const color = p.background ?? 'rgb(255, 255, 255)';
    weight.set(color, (weight.get(color) ?? 0) + linesOf(p).join(' ').length);
  }
  return Array.from(weight).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'rgb(255, 255, 255)';
}

function toItem(title: RawOutlinePiece | undefined, pieces: RawOutlinePiece[]): RawSiteItem {
  const sorted = [...pieces].sort(byPage);
  const image = sorted.filter((p) => p.type === 'image' && p.image).map((p) => p.image!).sort((a, b) => area(b.box) - area(a.box))[0];
  const titleText = title ? linesOf(title).join(' ') : undefined;
  return {
    ...(titleText ? { title: titleText } : {}),
    text: sorted.filter(isCopy).flatMap(linesOf),
    ...(image ? { image } : {}),
    ...(sorted.find((p) => p.type === 'background')?.src ? { backgroundImage: sorted.find((p) => p.type === 'background')!.src } : {}),
    links: [...(title?.links ?? []), ...sorted.flatMap((p) => p.links ?? [])],
    icon: false,
    box: union([...(title ? [title.box] : []), ...sorted.map((p) => p.box)]) ?? ZERO,
  };
}

const MARKUP = new Set(['accordion', 'tabs', 'slider']);

function sectionBlock(s: Section, get: (id: number) => RawOutlinePiece): RawSiteBlock {
  const heading = get(s.heading);
  const eyebrow = s.eyebrow !== undefined ? get(s.eyebrow) : undefined;
  const pieces = s.pieces.map(get).sort(byPage);
  const items = (s.items ?? []).map((i) => ({ title: i.title !== undefined ? get(i.title) : undefined, pieces: i.pieces.map(get) }));
  const firstItem = Math.min(Infinity, ...items.flatMap((i) => [...(i.title ? [i.title.id] : []), ...i.pieces.map((p) => p.id)]));
  const intro = pieces.filter((p) => isCopy(p) && p.id < firstItem);
  const after = pieces.filter((p) => isCopy(p) && p.id > firstItem);
  const all = [heading, ...(eyebrow ? [eyebrow] : []), ...pieces, ...items.flatMap((i) => [...(i.title ? [i.title] : []), ...i.pieces])];
  const box = union(all.map((p) => p.box)) ?? ZERO;
  return {
    role: 'content',
    box,
    ...(union([heading.box, ...(eyebrow ? [eyebrow.box] : []), ...intro.map((p) => p.box)]) ? { introBox: union([heading.box, ...(eyebrow ? [eyebrow.box] : []), ...intro.map((p) => p.box)])! } : {}),
    contentBox: box,
    intro: {
      ...(eyebrow ? { eyebrow: linesOf(eyebrow).join(' ') } : {}),
      heading: linesOf(heading).join(' '),
      headingLevel: heading.level ?? 2,
      text: intro.flatMap(linesOf),
      links: [...(heading.links ?? []), ...pieces.flatMap((p) => p.links ?? [])],
    },
    ...(items.length ? { group: { ...(MARKUP.has(s.arrangement) ? { markup: s.arrangement as 'accordion' | 'tabs' | 'slider' } : {}), items: items.map((i) => toItem(i.title, i.pieces)) } } : {}),
    extra: after.length ? [{ type: 'text', text: after.flatMap(linesOf) }] : [],
    images: pieces.filter((p) => p.type === 'image' && p.image).map((p) => p.image!),
    ...(pieces.find((p) => p.type === 'background')?.src ? { backgroundImage: pieces.find((p) => p.type === 'background')!.src } : {}),
    embeds: pieces.filter((p) => p.type === 'embed' && p.embed).map((p) => p.embed!),
    style: { background: backgroundOf(all), color: heading.font?.color ?? 'rgb(0, 0, 0)', textAlign: heading.align ?? 'left', paddingTop: 0, paddingBottom: 0 },
    hint: { kind: s.kind, arrangement: s.arrangement },
  };
}

function chromeBlock(role: 'header' | 'footer', pieces: RawOutlinePiece[], logo?: RawOutlinePiece): RawSiteBlock {
  const sorted = [...pieces].sort(byPage);
  const box = union([...(logo ? [logo.box] : []), ...sorted.map((p) => p.box)]) ?? ZERO;
  const text = sorted.filter(isCopy).flatMap(linesOf);
  return {
    role,
    box,
    contentBox: box,
    intro: { text: [], links: sorted.flatMap((p) => p.links ?? []) },
    extra: text.length ? [{ type: 'text', text }] : [],
    images: [...(logo?.image ? [logo.image] : []), ...sorted.filter((p) => p.type === 'image' && p.image).map((p) => p.image!)],
    embeds: sorted.filter((p) => p.type === 'embed' && p.embed).map((p) => p.embed!),
    style: { background: backgroundOf(sorted), color: sorted.find(isCopy)?.font?.color ?? 'rgb(0, 0, 0)', textAlign: 'left', paddingTop: 0, paddingBottom: 0 },
  };
}

/** The answer as the reader's raw blocks: every word, link and image copied from the page by id */
export function assembleGroupedBlocks(raw: RawSiteSections, outline: RawPageOutline, answer: SiteGroupingAnswer): RawSiteSections {
  const byId = new Map(outline.pieces.map((p) => [p.id, p]));
  const get = (id: number) => byId.get(id)!;
  const firstId = (s: Section) => Math.min(s.heading, ...s.pieces, ...(s.eyebrow !== undefined ? [s.eyebrow] : []));
  const sections = [...answer.sections].sort((a, b) => firstId(a) - firstId(b));
  const blocks = sections.map((s) => sectionBlock(s, get));
  // Padding: half the gap to the neighbouring sections, capped
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    const next = blocks[i + 1];
    const gap = (a: RawBox | undefined, z: RawBox | undefined) => (a && z && drawn(a) && drawn(z) ? Math.max(0, z.top - (a.top + a.height)) : 0);
    b.style.paddingTop = Math.min(MAX_PADDING, Math.round(gap(prev?.box, b.box) / 2));
    b.style.paddingBottom = Math.min(MAX_PADDING, Math.round(gap(b.box, next?.box) / 2));
  });
  const header = answer.header ? chromeBlock('header', answer.header.pieces.map(get), answer.header.logo !== undefined ? get(answer.header.logo) : undefined) : undefined;
  const footer = answer.footer ? chromeBlock('footer', answer.footer.pieces.map(get)) : undefined;

  // Left-out runs, placed before the first section that starts after them (positions count the header)
  const used = new Set(idsOf(answer));
  const starts = sections.map(firstId);
  const offset = header ? 1 : 0;
  const leftOut: RawLeftOut[] = [];
  let run: RawOutlinePiece[] = [];
  const close = () => {
    if (!run.length) return;
    const at = starts.findIndex((start) => start > run[0]!.id);
    leftOut.push({ index: offset + (at < 0 ? blocks.length : at), text: run.flatMap(linesOf).join(' ') });
    run = [];
  };
  for (const piece of outline.pieces) {
    if (used.has(piece.id)) close();
    else run.push(piece);
  }
  close();

  return {
    ...raw,
    ...(header ? { header } : { header: undefined }),
    blocks,
    ...(footer ? { footer } : { footer: undefined }),
    uncaptured: [],
    leftOut,
  };
}

/** The model's grouping read like the rules reading, or why it cannot be */
export function readGroupedSections(raw: RawSiteSections, answer: SiteGroupingAnswer): SiteSectionsReading {
  const outline = raw.outline;
  if (!outline) return { error: 'No page outline' };
  const problems = checkGrouping(answer, outline);
  if (problems.length) return { error: `Invalid grouping: ${problems.slice(0, 5).join('; ')}`.slice(0, 300) };
  return readSiteSections(assembleGroupedBlocks(raw, outline, answer), [], 'llm');
}

const quote = (s: string) => JSON.stringify(s);
const preview = (s: string) => (s.length > OUTLINE_LIMITS.previewChars ? `${s.slice(0, OUTLINE_LIMITS.previewChars)}… (${s.length} chars)` : s);
const where = (b: RawBox, size = true) => `y=${b.top} x=${b.left}${size ? ` w=${b.width} h=${b.height}` : ''}`;

/** The outline as the model reads it: one line per piece, its facts, and a preview of its text */
export function outlinePrompt(outline: RawPageOutline, tiles: { top: number; bottom: number }[]): string {
  const lines = outline.pieces.map((p) => {
    const hidden = p.hidden ? ' hidden' : '';
    switch (p.type) {
      case 'heading':
        return `${p.id} heading ${p.level ? `h${p.level}` : 'styled'} ${p.font?.size ?? 0}px${(p.font?.weight ?? 400) >= 600 ? ' b' : ''} ${quote(preview(p.text ?? ''))} ${where(p.box)}${hidden}`;
      case 'text':
        return `${p.id} text ${p.font?.size ?? 0}px ${quote(preview(p.text ?? ''))} ${where(p.box)}${hidden}`;
      case 'list':
        return `${p.id} list ${quote(preview((p.lines ?? []).join(' | ')))} ${where(p.box)}${hidden}`;
      case 'links':
        return `${p.id} links ${JSON.stringify((p.links ?? []).map((l) => l.label.slice(0, 40)))} ${where(p.box)}`;
      case 'image':
        return `${p.id} image ${p.image?.box.width ?? 0}x${p.image?.box.height ?? 0} alt=${quote((p.image?.alt ?? '').slice(0, 60))} ${where(p.box, false)}${hidden}`;
      case 'background':
        return `${p.id} background ${p.box.width}x${p.box.height} ${where(p.box, false)}`;
      case 'embed':
        return `${p.id} embed ${p.embed?.kind ?? 'widget'} ${where(p.box)}`;
    }
  });
  const tileLines = tiles.map((t, i) => `tile ${i + 1}: y ${t.top}–${t.bottom}`);
  return [
    `Page height: ${outline.pageHeight}px, body text ${outline.bodySize}px${outline.truncated ? ', outline truncated' : ''}.`,
    'Screenshots (desktop, 1440px wide, in page order):',
    ...tileLines,
    '',
    'Pieces (id type facts "text" position):',
    ...lines,
  ].join('\n');
}
```

- [ ] **Step 4: Run** the spec. Expected: PASS. If the gate test's ratio override hides a real coverage problem, compute the expected coverage by hand and keep the override documented in the test name.

- [ ] **Step 5: Commit** with `feat(REV-113): check and assemble the model's grouping by id`.

---

### Task 5: LlmClient images and usage; vision tiles

**Files:**
- Modify: `apps/workers/src/services/llm-client.ts`
- Modify: `apps/workers/src/services/image.service.ts`
- Test: `apps/workers/src/services/__tests__/llm-client.spec.ts`, `apps/workers/src/services/__tests__/image.service.spec.ts` (create it if missing)

**Interfaces:**
- Produces:
  - `export interface LlmImage { mediaType: 'image/webp' | 'image/png' | 'image/jpeg'; data: Buffer }`;
  - `LlmCompletionRequest.images?: LlmImage[]`;
  - `export interface LlmUsage { promptTokens: number; completionTokens: number; totalTokens: number }`;
  - `LlmClient.completeWithUsage(req): Promise<{ text: string; usage?: LlmUsage }>`, with `complete()` unchanged on the outside;
  - `LlmClientOptions.claudeCliVisionRunner?: ClaudeCliVisionRunner`;
  - `ImageService.tilesForVision(png: Buffer, o?: { tileHeight?: number; maxTiles?: number; width?: number }): Promise<{ data: Buffer; top: number; bottom: number }[]>`.

- [ ] **Step 1: Write the failing tests** (llm-client: follow the file's stub-fetcher pattern)

```ts
describe('images and usage (REV-113)', () => {
  const img = { mediaType: 'image/webp' as const, data: Buffer.from('abc') };
  const ok = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => body, text: async () => '' });

  it('sends images to Anthropic after the text, and returns token usage', async () => {
    const fetcher = ok({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 10, output_tokens: 5 } });
    const client = new LlmClient({ provider: 'anthropic', anthropicApiKey: 'k', customFetcher: fetcher });
    const res = await client.completeWithUsage({ systemPrompt: 's', userPrompt: 'u', temperature: 0, images: [img] });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.messages[0].content).toEqual([{ type: 'text', text: 'u' }, { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'YWJj' } }]);
    expect(res).toEqual({ text: '{}', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
  });

  it('sends images to OpenAI as data URIs and to Gemini as inline data', async () => {
    const openai = ok({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
    await new LlmClient({ provider: 'openai', openaiApiKey: 'k', customFetcher: openai }).completeWithUsage({ systemPrompt: 's', userPrompt: 'u', temperature: 0, images: [img] });
    expect(JSON.parse(openai.mock.calls[0][1].body).messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/webp;base64,YWJj' } });
    const gemini = ok({ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } });
    const r = await new LlmClient({ provider: 'gemini', geminiApiKey: 'k', customFetcher: gemini }).completeWithUsage({ systemPrompt: 's', userPrompt: 'u', temperature: 0, images: [img] });
    expect(JSON.parse(gemini.mock.calls[0][1].body).contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/webp', data: 'YWJj' } });
    expect(r.usage).toEqual({ promptTokens: 4, completionTokens: 1, totalTokens: 5 });
  });

  it('sends images to the CLI through the vision runner, and text-only prompts through the plain runner', async () => {
    const vision = vi.fn().mockResolvedValue({ text: '{}', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    const plain = vi.fn().mockResolvedValue('{}');
    const client = new LlmClient({ provider: 'claude-cli', claudeCliRunner: plain, claudeCliVisionRunner: vision });
    await client.completeWithUsage({ systemPrompt: 's', userPrompt: 'u', temperature: 0, images: [img] });
    expect(vision).toHaveBeenCalledWith(expect.objectContaining({ images: [img] }));
    await client.complete({ systemPrompt: 's', userPrompt: 'u', temperature: 0 });
    expect(plain).toHaveBeenCalledTimes(1);
  });
});
```
Image service (real sharp):
```ts
it('cuts a full-page capture into page-ordered tiles at most maxTiles, scaled to the width', async () => {
  const png = await sharp({ create: { width: 1440, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer();
  const tiles = await ImageService.tilesForVision(png, { tileHeight: 1800, maxTiles: 2, width: 1024 });
  expect(tiles.map((t) => [t.top, t.bottom])).toEqual([[0, 1800], [1800, 3600]]);
  const meta = await sharp(tiles[0]!.data).metadata();
  expect([meta.format, meta.width]).toEqual(['webp', 1024]);
});
```

- [ ] **Step 2: Run** both specs. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Refactor `callAnthropic`, `callOpenAi` and `callGemini` to return `{ text, usage? }`.
  - `completeWithUsage` routes to them. For claude-cli it uses `claudeCliVisionRunner` when `images?.length`, else the plain runner with `usage` undefined.
  - `complete = async (r) => (await this.completeWithUsage(r)).text`.
  - Anthropic content: `request.images?.length ? [{ type: 'text', text: userPrompt }, ...images.map(...)] : userPrompt`.
  - OpenAI user content: `[{ type: 'text', text }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${b64}` } }))]` only when there are images.
  - Gemini: push `{ inline_data: { mime_type, data } }` parts after the text part.
  - Usage readers: Anthropic `usage.input_tokens/output_tokens`; OpenAI `usage.prompt_tokens/completion_tokens/total_tokens`; Gemini `usageMetadata.promptTokenCount/candidatesTokenCount`. A usage of 0/0 is reported as undefined.
  - The constructor creates `createClaudeCliVisionRunner({ cliPath, model, timeoutMs })` by default.

  `tilesForVision`:
```ts
  /** A full-page capture cut into page slices for a vision model (REV-113), top first */
  static async tilesForVision(png: Buffer, options: { tileHeight?: number; maxTiles?: number; width?: number } = {}): Promise<{ data: Buffer; top: number; bottom: number }[]> {
    const tileHeight = options.tileHeight ?? 1800;
    const { width = 0, height = 0 } = await sharp(png, { limitInputPixels: false }).metadata();
    const tiles: { data: Buffer; top: number; bottom: number }[] = [];
    for (let top = 0; top < height && tiles.length < (options.maxTiles ?? 6); top += tileHeight) {
      const bottom = Math.min(height, top + tileHeight);
      const data = await sharp(png, { limitInputPixels: false })
        .extract({ left: 0, top, width, height: bottom - top })
        .resize({ width: options.width ?? 1024, withoutEnlargement: true })
        .webp({ quality: 70, effort: 4 })
        .toBuffer();
      tiles.push({ data, top, bottom });
    }
    return tiles;
  }
```

- [ ] **Step 4: Run** both specs plus `design-critique.service.spec.ts` and `mvp-content` specs (callers of `complete`). Expected: PASS.

- [ ] **Step 5: Commit** with `feat(REV-113): LlmClient sends images and reports token usage; vision tiles`.

---

### Task 6: The grouping agent and the fallback flow

**Files:**
- Create: `apps/workers/src/services/site-grouping.service.ts`
- Test: `apps/workers/src/services/__tests__/site-grouping.service.spec.ts`

**Interfaces:**
- Consumes: `LlmClient`, `extractJsonObject`, `resolveDefaultProvider` (Task 5); `checkGrouping`, `readGroupedSections`, `outlinePrompt` (Task 4); `readSiteSections` (Task 3); `rebuildEligibility`, `SiteGroupingAnswerSchema`; `findExecutable` from `llm-capabilities.js`; `env`.
- Produces:
```ts
export const SITE_GROUPING_SYSTEM_PROMPT: string;
export type GroupingTile = { data: Buffer; top: number; bottom: number };
export type GroupingResult =
  | { answer: SiteGroupingAnswer; modelUsed: string; usage?: LlmUsage }
  | { error: string; modelUsed: string; usage?: LlmUsage };
export class SiteGroupingService {
  constructor(options?: { client?: LlmClient });
  unavailableReason(): string | undefined;
  group(input: { outline: RawPageOutline; tiles: GroupingTile[]; url: string; niche?: string }): Promise<GroupingResult>;
}
export const siteGroupingService: SiteGroupingService;
export interface PageSectionsResult {
  reading: SiteSectionsReading;
  measurementError?: IMeasurementError;
  modelUsed?: string;
  usage?: LlmUsage;
}
export function readPageSections(input: {
  raw?: RawSiteSections; rawError?: string; layoutBlocks: RawLayoutBlock[];
  tiles: GroupingTile[]; url: string; niche?: string; grouping?: SiteGroupingService;
}): Promise<PageSectionsResult>;
```

- [ ] **Step 1: Write the failing tests** (stub `LlmClient` objects; no network)

```ts
import { describe, it, expect, vi } from 'vitest';
import type { LlmClient } from '../llm-client.js';
import { SiteGroupingService, readPageSections } from '../site-grouping.service.js';
// Reuse the anident-like `raw`, `outline` and `answer` from site-grouping.spec.ts: move them to
// `__tests__/fixtures/grouping-fixtures.ts` (exported) in this task and import them in both specs.
import { raw, answer } from './fixtures/grouping-fixtures.js';

const clientOf = (...replies: Array<string | Error>) => {
  const completeWithUsage = vi.fn();
  for (const r of replies) r instanceof Error ? completeWithUsage.mockRejectedValueOnce(r) : completeWithUsage.mockResolvedValueOnce({ text: r, usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
  return { completeWithUsage, provider: 'anthropic', modelName: 'stub', unavailableReason: () => undefined } as unknown as LlmClient;
};
const tiles = [{ data: Buffer.from('x'), top: 0, bottom: 1400 }];
const input = { outline: raw.outline!, tiles, url: 'https://anident.test/' };

describe('SiteGroupingService (REV-113)', () => {
  it('returns a valid answer with its usage, also when wrapped in prose or a json fence', async () => {
    const svc = new SiteGroupingService({ client: clientOf('Here you go:\n```json\n' + JSON.stringify(answer) + '\n```') });
    const r = await svc.group(input);
    expect('answer' in r && r.answer.sections).toHaveLength(3);
    expect(r.usage?.totalTokens).toBe(110);
  });

  it('retries once at temperature 0 after a failure, then uses the answer', async () => {
    const client = clientOf(new Error('timeout'), JSON.stringify(answer));
    const r = await new SiteGroupingService({ client }).group(input);
    expect('answer' in r).toBe(true);
    expect(vi.mocked(client.completeWithUsage).mock.calls.map((c) => c[0].temperature)).toEqual([0.1, 0]);
    expect(vi.mocked(client.completeWithUsage).mock.calls[0][0].images).toHaveLength(1);
  });

  it('gives up after two invalid answers with the reasons, and sums the usage', async () => {
    const bad = JSON.stringify({ ...answer, footer: { pieces: [99] } });
    const r = await new SiteGroupingService({ client: clientOf(bad, bad) }).group(input);
    expect('error' in r && r.error).toMatch(/2 attempts.*unknown id 99/);
    expect(r.usage?.totalTokens).toBe(220);
  });

  it('a heading-less answer is invalid and falls back', async () => {
    const noHeading = JSON.stringify({ sections: [{ pieces: [4], kind: 'other', arrangement: 'text' }] });
    const r = await new SiteGroupingService({ client: clientOf(noHeading, noHeading) }).group(input);
    expect('error' in r).toBe(true);
  });
});

describe('readPageSections (REV-113)', () => {
  const rulesRaw = { ...raw, blocks: [/* one plain content block with a heading */] };
  it('stores the model reading when it is valid', async () => {
    const r = await readPageSections({ raw, layoutBlocks: [], tiles, url: 'u', grouping: new SiteGroupingService({ client: clientOf(JSON.stringify(answer)) }) });
    expect(r.reading.sections?.source).toBe('llm');
    expect(r.measurementError).toBeUndefined();
  });

  it('stores the rules reading and a sections error when no model is configured', async () => {
    const grouping = { unavailableReason: () => 'No vision model', group: vi.fn() } as unknown as SiteGroupingService;
    const r = await readPageSections({ raw: rulesRaw, layoutBlocks: [], tiles, url: 'u', grouping });
    expect(r.reading.sections?.source).toBe('rules');
    expect(r.measurementError).toEqual({ measurement: 'sections', message: 'No vision model' });
    expect(grouping.group).not.toHaveBeenCalled();
  });

  it('stores the rules reading when the outline is missing', async () => {
    const r = await readPageSections({ raw: { ...rulesRaw, outline: undefined }, layoutBlocks: [], tiles, url: 'u' });
    expect(r.measurementError?.message).toBe('No page outline');
  });

  it('rejects a model reading that fails the rebuild gate where the rules reading passes', async () => {
    // One giant section: flat
    const flat = { sections: [{ heading: 3, pieces: [4, 5, 6, 7, 8, 9, 10], kind: 'other', arrangement: 'text' }] };
    const passingRules = /* a rules raw whose reading passes rebuildEligibility: build 3 headed blocks of 600 chars each, pageChars 1900 */ rulesRaw;
    const r = await readPageSections({ raw: { ...passingRules, outline: raw.outline }, layoutBlocks: [], tiles, url: 'u', grouping: new SiteGroupingService({ client: clientOf(JSON.stringify(flat)) }) });
    expect(r.reading.sections?.source).toBe('rules');
    expect(r.measurementError?.message).toMatch(/fails rebuild:/);
  });

  it('keeps the rules error when neither reader has sections', async () => {
    const r = await readPageSections({ rawError: 'Section collection failed: boom', layoutBlocks: [], tiles, url: 'u' });
    expect(r.reading.error).toBe('Section collection failed: boom');
    expect(r.measurementError?.message).toBe('No page outline');
  });
});
```
Write the two placeholders in the gate test as real fixtures in `fixtures/grouping-fixtures.ts`:
- `rulesRaw`: one content block with heading "O nas" and two 300-char texts, `pageChars` 700;
- `passingRules`: three content blocks with headings, each holding 600 chars of `intro.text`, `pageChars` 1900, so `rebuildEligibility` is `{ ok: true }`. Assert that inside the test before using it.

- [ ] **Step 2: Run** `npx vitest run apps/workers/src/services/__tests__/site-grouping.service.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * SectionGroupingAgent (REV-113): a vision model groups the page outline's numbered pieces into the
 * header, sections and footer, answering with ids only. Every audit asks it; when it is not set up,
 * fails or answers badly, the rules reading (REV-109) is stored and the failure is recorded (REV-100).
 */
import type { IMeasurementError } from '@revamp/shared-types';
import { rebuildEligibility, SiteGroupingAnswerSchema, type SiteGroupingAnswer } from '@revamp/validation';
import { env } from '../config/env.js';
import { LlmClient, extractJsonObject, resolveDefaultProvider, type LlmProvider, type LlmUsage } from './llm-client.js';
import { findExecutable } from './llm-capabilities.js';
import { checkGrouping, outlinePrompt, readGroupedSections } from './site-grouping.js';
import type { RawLayoutBlock } from './site-layout.service.js';
import type { RawPageOutline, RawSiteSections } from './site-sections.page.js';
import { readSiteSections, type SiteSectionsReading } from './site-sections.service.js';

export const SITE_GROUPING_SYSTEM_PROMPT = `You organise a business's home page into sections. You never write text.

Inputs: screenshots of the desktop page (1440px wide) in order, each with its page range, and an outline:
one line per numbered piece of the page (heading, text, list, links, image, background, embed) with its
font size, bold (b), position (y = px from the top of the page, x) and size, and the start of its text.
"styled" headings are short bold, large or uppercase lines that are not HTML headings.

Group the pieces as a visitor sees the page:
- header: the logo image (logo) and the menu and top-bar pieces (pieces).
- sections, in page order: each starts at its heading and holds every piece that belongs to that heading
  until the next section: its text, lists, buttons and the photos shown with it. A photo floated beside or
  between paragraphs belongs to that paragraph's section, never to a separate gallery.
- items, only for repeated cards or entries (services, people, reviews, questions): each item's title id and pieces.
- footer: the pieces at the bottom (address, hours, links, copyright).
- kind, one of: services, pricing, gallery, about, team, reviews, faq, contact, map, features, other.
- arrangement, how the section shows its content, one of: banner, media-beside-text, text, card-grid, list,
  accordion, tabs, slider, gallery, embed.

Rules:
- Use only ids from the outline. Use each id at most once.
- Every section needs a heading id: a heading piece, or a short text piece that reads as a title.
- Place every piece that is part of the page. Leave a piece out only when it is not content (a duplicate
  menu, a hit counter, an empty spacer).
- Respond with one raw JSON object, no prose, no markdown:
{"header":{"logo":<id>,"pieces":[<id>...]},"sections":[{"heading":<id>,"eyebrow":<id, optional>,"pieces":[<id>...],
"items":[{"title":<id>,"pieces":[<id>...]}] (optional),"kind":"<kind>","arrangement":"<arrangement>"}],"footer":{"pieces":[<id>...]}}`;

const TEMPERATURES = [0.1, 0];
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 120_000;
const ERROR_CHARS = 300;

export type GroupingTile = { data: Buffer; top: number; bottom: number };
export type GroupingResult =
  | { answer: SiteGroupingAnswer; modelUsed: string; usage?: LlmUsage }
  | { error: string; modelUsed: string; usage?: LlmUsage };

/** VISION_LLM_PROVIDER, else the copywriting default, else the local Claude Code CLI when it is installed */
export function groupingProvider(): LlmProvider | undefined {
  return env.VISION_LLM_PROVIDER ?? resolveDefaultProvider() ?? (findExecutable(env.CLAUDE_CLI_PATH) ? 'claude-cli' : undefined);
}

const addUsage = (a: LlmUsage | undefined, b: LlmUsage | undefined): LlmUsage | undefined =>
  !a ? b : !b ? a : { promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, totalTokens: a.totalTokens + b.totalTokens };

export class SiteGroupingService {
  private readonly client: LlmClient;

  constructor(options: { client?: LlmClient } = {}) {
    this.client = options.client ?? new LlmClient({ provider: groupingProvider() });
  }

  unavailableReason(): string | undefined {
    const reason = this.client.unavailableReason();
    return reason ? `No vision model for the section grouping: ${reason}` : undefined;
  }

  async group(input: { outline: RawPageOutline; tiles: GroupingTile[]; url: string; niche?: string }): Promise<GroupingResult> {
    const userPrompt = `Page: ${input.url}\nBusiness niche: ${input.niche ?? 'not specified'}\n\n${outlinePrompt(input.outline, input.tiles)}`;
    const images = input.tiles.map((t) => ({ mediaType: 'image/webp' as const, data: t.data }));
    let usage: LlmUsage | undefined;
    let last = 'unknown error';
    for (const temperature of TEMPERATURES) {
      try {
        const res = await this.client.completeWithUsage({ systemPrompt: SITE_GROUPING_SYSTEM_PROMPT, userPrompt, images, temperature, maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS });
        usage = addUsage(usage, res.usage);
        const parsed = SiteGroupingAnswerSchema.safeParse(extractJsonObject(res.text));
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          last = `schema: ${issue?.path.join('.')} ${issue?.message}`;
          continue;
        }
        const problems = checkGrouping(parsed.data, input.outline);
        if (problems.length) {
          last = problems.slice(0, 5).join('; ');
          continue;
        }
        return { answer: parsed.data, modelUsed: this.client.modelName, usage };
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      error: `The vision model gave no valid grouping in ${TEMPERATURES.length} attempts (last error: ${last})`.slice(0, ERROR_CHARS),
      modelUsed: this.client.modelName,
      usage,
    };
  }
}

export const siteGroupingService = new SiteGroupingService();

export interface PageSectionsResult {
  reading: SiteSectionsReading;
  measurementError?: IMeasurementError;
  modelUsed?: string;
  usage?: LlmUsage;
}

/**
 * The page's sections as the audit stores them: the model's grouping when it is valid and does not
 * lose a rebuild the rules reading would allow, else the rules reading with the failure recorded.
 */
export async function readPageSections(input: {
  raw?: RawSiteSections;
  rawError?: string;
  layoutBlocks: RawLayoutBlock[];
  tiles: GroupingTile[];
  url: string;
  niche?: string;
  grouping?: SiteGroupingService;
}): Promise<PageSectionsResult> {
  const grouping = input.grouping ?? siteGroupingService;
  const rules: SiteSectionsReading = input.raw ? readSiteSections(input.raw, input.layoutBlocks) : { error: input.rawError ?? 'No section facts' };
  const fail = (message: string, extra: Partial<PageSectionsResult> = {}): PageSectionsResult => ({
    reading: rules,
    measurementError: { measurement: 'sections', message: message.slice(0, ERROR_CHARS) },
    ...extra,
  });
  if (!input.raw?.outline) return fail('No page outline');
  const unavailable = grouping.unavailableReason();
  if (unavailable) return fail(unavailable);
  const result = await grouping.group({ outline: input.raw.outline, tiles: input.tiles, url: input.url, niche: input.niche });
  const meta = { modelUsed: result.modelUsed, usage: result.usage };
  if ('error' in result) return fail(result.error, meta);
  const llm = readGroupedSections(input.raw, result.answer);
  if (llm.error) return fail(`The model's grouping could not be read: ${llm.error}`, meta);
  const llmGate = rebuildEligibility({ siteSections: llm.sections });
  const rulesGate = rules.sections ? rebuildEligibility({ siteSections: rules.sections }) : undefined;
  if (!llmGate.ok && rulesGate?.ok) {
    return fail(`The model's reading fails ${llmGate.reason} (${llmGate.facts.join(', ')}) where the rules reading passes`, meta);
  }
  return { reading: llm, ...meta };
}
```

- [ ] **Step 4: Run** the spec, then `npx vitest run apps/workers/src/services` (from the repo root). Expected: PASS.

- [ ] **Step 5: Commit** with `feat(REV-113): SectionGroupingAgent and the rules fallback`.

---

### Task 7: Audit worker wiring

**Files:**
- Modify: `apps/workers/src/workers/audit.worker.ts:76-155`
- Test: `apps/workers/src/workers/__tests__/audit.worker.spec.ts`

**Interfaces:**
- Consumes: `readPageSections` (Task 6), `ImageService.tilesForVision` (Task 5).

- [ ] **Step 1: Write the failing tests.** Add `vi.mock('../../services/site-grouping.service.js')` and, in `beforeEach`:
  - `vi.mocked(ImageService.tilesForVision).mockResolvedValue([{ data: Buffer.from('t'), top: 0, bottom: 1800 }])`;
  - `vi.mocked(readPageSections).mockResolvedValue({ reading: { sections: llmReading }, modelUsed: 'stub', usage: { promptTokens: 20000, completionTokens: 900, totalTokens: 20900 } })`, where `llmReading` is a small valid `ISiteSections` with `source: 'llm'`.

```ts
it('stores the model-grouped sections and logs the grouping tokens (REV-113)', async () => {
  await runJob();
  expect(readPageSections).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com', tiles: [expect.objectContaining({ top: 0 })] }));
  const update = vi.mocked(Audit.findOneAndUpdate).mock.calls.find((c) => (c[1] as Record<string, unknown>)['status'] === 'COMPLETED')![1] as Record<string, unknown>;
  expect((update['siteSections'] as ISiteSections).source).toBe('llm');
  expect(AnalyticsEvent.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ stage: 'audit_section_grouping', totalTokens: 20900 }) }));
});

it('stores the rules reading and records a sections measurement error when the grouping fails (REV-113)', async () => {
  vi.mocked(readPageSections).mockResolvedValue({ reading: { sections: { ...llmReading, source: 'rules' } }, measurementError: { measurement: 'sections', message: 'No vision model' } });
  await runJob();
  const update = vi.mocked(Audit.findOneAndUpdate).mock.calls.find((c) => (c[1] as Record<string, unknown>)['status'] === 'COMPLETED')![1] as Record<string, unknown>;
  expect(update['measurementErrors']).toContainEqual({ measurement: 'sections', message: 'No vision model' });
  expect(update['scores']).toEqual(expect.objectContaining({ total: expect.any(Number) }));
});
```
Use the spec's existing job runner and the URL/lead constants (read the file's helpers first and match their names).

- [ ] **Step 2: Run** `npx vitest run apps/workers/src/workers/__tests__/audit.worker.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Remove the `readSiteSections` call at lines 76–80. After compression (step 4), cut the tiles and run the grouping alongside the critique:
```ts
        // 7. Vision LLM critique (REV-9) and the page's sections grouped by the vision model (REV-113), side by side
        console.log(`[AuditWorker] Running Vision UX/UI analysis and section grouping for lead ${leadId}...`);
        const tiles = await ImageService.tilesForVision(desktopFullBuffer);
        const [critiqueResult, sectionsResult] = await Promise.all([
          designCritiqueService.analyzeDesign({ /* unchanged */ }),
          readPageSections({ raw: rawSiteSections.raw, rawError: rawSiteSections.error, layoutBlocks: rawSiteLayout.raw?.blocks ?? [], tiles, url, niche }),
        ]);
        const siteSections = sectionsResult.reading;
        if (siteSections.error) console.warn(`[AuditWorker] Original sections not read for lead ${leadId}: ${siteSections.error}`);
```
  Extract the token-event block into a local `recordTokens(stage: string, model: string | undefined, usage: TokenUsage | LlmUsage | undefined)`, called for `audit_vision_critique` and `audit_section_grouping`. After the critique's `design` error, add `if (sectionsResult.measurementError) measurementErrors.push(sectionsResult.measurementError);`. A tile failure must not fail the audit: wrap `tilesForVision` in `.catch(() => [])`, so the model sees the outline only, and log a warning.

- [ ] **Step 4: Run** the worker spec and `npx vitest run apps/workers`. Expected: PASS.

- [ ] **Step 5: Commit** with `feat(REV-113): the audit groups the page with the vision model, rules as fallback`.

---

### Task 8: Dashboard: the sections line

**Files:**
- Modify: `apps/dashboard/src/components/leadReview/AuditStep.tsx:212-222`
- Modify: `apps/dashboard/src/i18n/locales/{en,pl,ru,be,lt}.ts` (`inspector.measurement.sections`, `inspector.sectionsByRules`)
- Test: `apps/dashboard/src/components/__tests__/AuditStep.spec.ts`

- [ ] **Step 1: Write the failing test** (follow the file's render helper)

```ts
it('shows a sections failure on its own line, outside the score alert (REV-113)', () => {
  renderStep({ measurementErrors: [{ measurement: 'design', message: 'template' }, { measurement: 'sections', message: 'No vision model' }] });
  const scoreAlert = screen.getByTestId('measurement-errors');
  expect(within(scoreAlert).queryByText(/No vision model/)).toBeNull();
  expect(screen.getByTestId('sections-by-rules')).toHaveTextContent('No vision model');
});
it('shows no score alert when only the sections reading failed (REV-113)', () => {
  renderStep({ measurementErrors: [{ measurement: 'sections', message: 'x' }] });
  expect(screen.queryByTestId('measurement-errors')).toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run apps/dashboard/src/components/__tests__/AuditStep.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
```tsx
const scoredErrors = audit?.measurementErrors.filter((f) => f.measurement !== 'sections') ?? [];
const sectionsError = audit?.measurementErrors.find((f) => f.measurement === 'sections');
```
  - Render the existing alert from `scoredErrors`.
  - After it, add `{sectionsError && <Alert severity="info" data-testid="sections-by-rules">{t('inspector.sectionsByRules')}: {sectionsError.message}</Alert>}`.
  - Locale strings:

| Locale | `measurement.sections` | `sectionsByRules` |
|---|---|---|
| en | `'Page sections (vision model)'` | `'Page sections were read by the rules, not the vision model'` |
| pl | `'Sekcje strony (model wizyjny)'` | `'Sekcje strony odczytano regułami, nie modelem wizyjnym'` |
| ru | `'Секции страницы (визуальная модель)'` | `'Секции страницы прочитаны правилами, а не визуальной моделью'` |
| be | `'Секцыі старонкі (візуальная мадэль)'` | `'Секцыі старонкі прачытаны правіламі, а не візуальнай мадэллю'` |
| lt | `'Puslapio skiltys (vaizdo modelis)'` | `'Puslapio skiltys perskaitytos taisyklėmis, ne vaizdo modeliu'` |

- [ ] **Step 4: Run** the dashboard specs (`npx vitest run apps/dashboard`). Expected: PASS, including the locale-completeness tests.

- [ ] **Step 5: Commit** with `feat(REV-113): dashboard shows a rules-read page outside the score alert`.

---

### Task 9: Scripts, recorded answers and the real-site check

**Files:**
- Modify: `scripts/read_site_sections.ts`, `scripts/render_rebuild.ts`
- Create: `apps/workers/src/services/__tests__/fixtures/grouping/anident.json`, `falcodent.json`
- Test: `apps/workers/src/services/__tests__/site-grouping.recorded.spec.ts`

- [ ] **Step 1: Add `--llm` and `--record <dir>` to `read_site_sections.ts`.**
  - Parse the flags out of `argv`.
  - With `--llm`:
    1. after the scroll, take `page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(12000, scrollHeight) } })`;
    2. `const tiles = await ImageService.tilesForVision(png)`;
    3. `const result = await readPageSections({ raw, layoutBlocks: layout.blocks, tiles, url })`.
  - Print the rules reading (the existing format) and the stored one (`source`), each with `rebuildEligibility(...)`, then the `measurementError` and the token usage.
  - With `--record`, run `siteGroupingService.group(...)` directly and write `<dir>/<hostname>.json`: `{ url, recordedAt, model, viewportWidth, viewportHeight, pageChars, typography, outline, answer }` (the raw reading without `blocks`).
  - In `render_rebuild.ts`, with `--llm`, use `readPageSections` (the same screenshot and tiles) instead of `readSiteSections`. The positional arguments stay `<out-dir> <url...>`, with the flags anywhere.

- [ ] **Step 2: Run on the real sites.** Use the local `claude-cli` provider:
```bash
npx tsx scripts/read_site_sections.ts --llm https://www.anident.pl/ https://falcodent.pl/
```
  Expected for anident:
  - about 8 content sections, all headed;
  - a header with an image and nav links, and a footer;
  - photos inside the headed sections;
  - the stored reading is `source llm` with `rebuildEligibility ok`.

  Expected for falcodent: `source llm`, the gate ok, at least 11 headed sections, coverage at least the rules reading's minus 0.03.

  If it falls short, change in this order:
  1. the outline rules (Task 2), with a new fixture test for each change;
  2. the system prompt wording;
  3. never the checks or the gate.

  Re-run until both meet the criteria. Write down the token usage for the docs budget.

- [ ] **Step 3: Record**
```bash
npx tsx scripts/read_site_sections.ts --llm --record apps/workers/src/services/__tests__/fixtures/grouping https://www.anident.pl/ https://falcodent.pl/
```
  Check the files are below about 400 KB each. If a file is larger, trim each piece's `text` to 2000 chars (`SITE_SECTIONS_LIMITS.textChars`) in the recorder.

- [ ] **Step 4: Write the recorded-answer tests**
```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { rebuildEligibility } from '@revamp/validation';
import { readGroupedSections } from '../site-grouping.js';

const load = (name: string) => {
  const r = JSON.parse(readFileSync(new URL(`./fixtures/grouping/${name}.json`, import.meta.url), 'utf8'));
  return { raw: { viewportWidth: r.viewportWidth, viewportHeight: r.viewportHeight, blocks: [], typography: r.typography, pageChars: r.pageChars, uncaptured: [], outline: r.outline }, answer: r.answer };
};
const body = (s: { sections: { role: string; intro: { heading?: string } }[] }) => s.sections.filter((x) => x.role === 'hero' || x.role === 'content');

describe('recorded model answers (REV-113)', () => {
  it('anident.pl: headed sections, header with logo and nav, footer, passes the rebuild gate', () => {
    const { raw, answer } = load('anident');
    const read = readGroupedSections(raw, answer).sections!;
    expect(body(read).length).toBeGreaterThanOrEqual(7);
    expect(body(read).every((s) => s.intro.heading)).toBe(true);
    const header = read.sections.find((s) => s.role === 'header')!;
    expect(header.images.length).toBeGreaterThan(0);
    expect(header.intro.links.length).toBeGreaterThanOrEqual(4);
    expect(read.sections.at(-1)!.role).toBe('footer');
    expect(rebuildEligibility({ siteSections: read })).toEqual({ ok: true });
    expect(body(read).filter((s) => s.images.length > 0 && s.intro.text.length > 0).length).toBeGreaterThanOrEqual(3);
  });

  it('falcodent.pl: not worse than the rules reading (11 headed sections, gate passes)', () => {
    const { raw, answer } = load('falcodent');
    const read = readGroupedSections(raw, answer).sections!;
    expect(body(read).filter((s) => s.intro.heading).length).toBeGreaterThanOrEqual(11);
    expect(rebuildEligibility({ siteSections: read })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 5: Render check.** Run `npx tsx scripts/render_rebuild.ts --llm /private/tmp/claude-501/…/scratchpad/rev113 https://www.anident.pl/ https://falcodent.pl/`. Open both HTML files in Chrome next to the originals (chrome-devtools MCP). Check that anident shows the logo header, the headed photo-and-text sections and the footer, and that falcodent looks as it did before. Take screenshots for the PR.

- [ ] **Step 6: Run** `npx vitest run apps/workers/src/services/__tests__/site-grouping.recorded.spec.ts`. Expected: PASS. Commit with `test(REV-113): recorded groupings for anident.pl and falcodent.pl; --llm in the scripts`.

---

### Task 10: Gates, end to end, PR, merge, docs, close (AGENTS.md §4.3)

- [ ] **Step 1: Gates.** Run in order and fix anything that fails:
  1. `npm run build:packages`
  2. `npm run typecheck`
  3. `npm run lint` (0 errors, no new warnings)
  4. `npm test` (0 failures)
  5. `npm run build`
- [ ] **Step 2: End to end.**
  1. Run `npm run dev`.
  2. In the dashboard, Add lead with the URL only: `https://www.anident.pl/`, then `https://falcodent.pl/`. Regenerate does not re-audit, so the leads must be fresh.
  3. When each reaches NEEDS_APPROVAL, check `Audit.siteSections.source === 'llm'` and the sections through `/src/api/client.ts` in the page.
  4. Open the Prototype step: anident is rebuilt (no `rebuild:flat` chip), and falcodent's rebuild looks as before.
  5. The console shows no new errors.
  6. Never approve a lead.
- [ ] **Step 3: Fallback check.** Restart the workers with `VISION_LLM_PROVIDER=openai` and no key. Add a third lead and confirm that the audit completes, `source` is `rules`, and the Audit step shows the "read by the rules" line. Restore `.env`.
- [ ] **Step 4: Docs in this repo.**
  - `AGENTS.md` §3.2.2: replace "No LLM is involved" and similar wording with "the model may group and classify page pieces by id; it never writes copy or markup". Describe the outline, `SiteGroupingService`, `readPageSections`, the `sections` measurement, `source` and `unassigned`.
  - `AGENTS.md` §3.2.6: the rebuild reads `Audit.siteSections` whatever its `source`.
  - README: the audit step, `VISION_LLM_PROVIDER`, the `--llm` and `--record` flags.
  - `.env.example`: update the `VISION_LLM_PROVIDER` comment (it now also drives the grouping).
  - Commit with `docs(REV-113): …`.
- [ ] **Step 5: PR.** Push and run `gh pr create --title "feat(REV-113): let a vision model group the page into sections, by id only"`. The body starts with `Fixes [REV-113](https://linear.app/revamp-proect/issue/REV-113)`, then:
  - `## Problem`;
  - `## Changes`;
  - `## Verification`: the exact commands and results, the anident and falcodent numbers before and after, and the screenshots.

  Attach the PR to the ticket and move it to In Review.
- [ ] **Step 6: Merge.** Pull `main` into the branch and re-run all the gates. Then `gh pr merge --merge`, pull `main` and run `npm test`.
- [ ] **Step 7: Revamp-docs.** In `../Revamp-docs`:
  - `AGENTS.md`: the SectionGroupingAgent prompt, answer schema, token budget (from Task 9's measured usage) and fallback;
  - `spec.md`: `source`, `unassigned`, the `sections` measurement;
  - `blueprint.md`: the audit flow and the Audit fields;
  - `research.md`: an ADR for model grouping by id, on every audit, rules as fallback, the safety net, rejected alternatives;
  - `milestones.md`, if a DoD item applies.

  Commit `docs(REV-113): …`, push, and add the commit link to the ticket.
- [ ] **Step 8: Close.** Move REV-113 to Done.
