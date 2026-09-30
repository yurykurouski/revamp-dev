# REV-109 Site Section Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The audit reads the original home page section by section (content, arrangement, measured style) with deterministic Playwright/DOM code and stores it as `Audit.siteSections`, without changing the MVP.

**Architecture:** REV-104's layout walk tags each block it picks with `data-revamp-block`. A self-contained in-page function (`collectSiteSectionsInPage`, `site-sections.page.ts`) reads the header, the tagged blocks and the footer into raw DOM facts. A pure Node function (`readSiteSections`, `site-sections.service.ts`) cleans them, attaches stray text, skips noise with a reason, names each section's arrangement/kind/style, computes coverage, applies caps and validates with `SiteSectionsSchema`. `BrowserService.extractSiteSections` runs it after `extractSiteLayout`; the audit worker stores the result or its error.

**Tech Stack:** TypeScript, Playwright (Chromium), Zod, Mongoose, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-rev-109-site-section-reader-design.md` (read it first; §8 lists the review fixes this plan implements).

## Global Constraints

- No LLM anywhere in this feature; every value comes from the DOM or from Node code (AGENTS.md §3.2.2 Strict Grounding).
- A page that cannot be read gets `siteSectionsError` with the reason and no `siteSections`; never a guessed structure. The reader never fails the audit.
- The MVP, Bento, `Audit.siteLayout`, `deriveMvpLayout` output and the dashboard do not change.
- `collectSiteSectionsInPage` runs through `page.evaluate`: no imports, no module-level values, no helpers defined outside the function body.
- Mongoose schemas live only in `packages/db` (§3.2.7); the new fields must be declared there or strict mode drops them.
- Caps (in `@revamp/validation` as `SITE_SECTIONS_LIMITS`): sections 45, items per section 60, characters per text string 2,000, `uncaptured` 12, `skipped[].sample` 120, title/subtitle/eyebrow/heading/price/label 300, URLs 2,000, strings per `text` array 40, links per item or intro 40, images per section 24, embeds per section 8, `extra` entries 20, `skipped` entries 80, all text 150,000.
- `rating` is on a 0..5 scale; `ratio = min(1, capturedChars / pageChars)` rounded to 3 places.
- `extractSiteSections` time limit: 15 s.
- Run Vitest from the repo root (`npx vitest run <path>`), never from inside `apps/workers` (it hits the real LLM path there).
- Branch `ymorpheus/rev-109-site-section-reader` (already checked out). Commits: `feat(REV-109): ...` / `test(REV-109): ...` / `docs(REV-109): ...`, each ending with the attribution lines from the session.

## Review Focus

1. **A header nested inside the first block** (page builders wrap the header in the hero wrapper): the nav must appear once, in the `header` section, not again in the hero. Test in Task 7.
2. **A section of plain paragraphs, each in its own `div`**: must stay `text`, not become a `list` of one-line items. Test in Task 8.
3. **Two columns with identical wrapper markup, text in one and a photo in the other** (Elementor 50/50): must be `media-beside-text`, not a `card-grid` of 2. Test in Task 9.
4. **A page whose `evaluate` never returns** (endless scripts, huge DOM): the audit must go on with `siteSectionsError` after 15 s. Test in Task 10.
5. **A re-audit of a lead whose earlier audit had sections, now failing**: the old `siteSections` must be unset, not kept next to the new error. Test in Task 11.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/shared-types/src/index.ts` | modify | `SITE_SECTION_ROLES`, `SITE_SECTION_ARRANGEMENTS`, `SITE_LINK_KINDS`, `SITE_EMBED_KINDS`, `SITE_SKIP_REASONS`, `SITE_IMAGE_SHAPES`, `features` kind, `ISite*` interfaces, `IAudit.siteSections(Error)` |
| `packages/validation/src/index.ts` | modify | `SITE_SECTIONS_LIMITS`, `SiteSectionsSchema` |
| `packages/validation/__tests__/site-sections.spec.ts` | create | schema tests |
| `packages/db/src/models/Audit.model.ts` | modify | declare `siteSections`, `siteSectionsError` |
| `packages/db/__tests__/models.spec.ts` | modify | the model keeps both fields |
| `apps/workers/src/services/site-layout.service.ts` | modify | tag blocks with `data-revamp-block`; `features` words |
| `apps/workers/src/services/__tests__/site-layout.service.spec.ts` | modify | tagging + `features` tests |
| `apps/workers/src/services/__tests__/layout-selection.service.spec.ts` | modify | `features` treated like `other` |
| `apps/workers/src/services/site-sections.page.ts` | create | `Raw*` types + `collectSiteSectionsInPage` |
| `apps/workers/src/services/site-sections.service.ts` | create | `readSiteSections` and its pure helpers |
| `apps/workers/src/services/__tests__/site-sections.service.spec.ts` | create | Node-side tests (pure) |
| `apps/workers/src/services/__tests__/site-sections.page.spec.ts` | create | real-Chromium fixtures |
| `apps/workers/src/services/browser.service.ts` | modify | `extractSiteSections`, wiring in `captureFullAudit` |
| `apps/workers/src/services/__tests__/browser.service.spec.ts` | modify | `extractSiteSections` tests |
| `apps/workers/src/workers/audit.worker.ts` | modify | store `siteSections` / `siteSectionsError` |
| `apps/workers/src/workers/__tests__/audit.worker.spec.ts` | modify | worker tests |
| `scripts/read_site_sections.ts` | create | read-only live check on real sites |
| `AGENTS.md`, `../Revamp-docs/{blueprint,spec,milestones}.md` | modify | docs |

---

### Task 1: Types and schema

**Files:**
- Modify: `packages/shared-types/src/index.ts` (after `ISiteLayout`, ~line 360; `SITE_SECTION_KINDS` at line 306; `IAudit` at ~line 394)
- Modify: `packages/validation/src/index.ts` (after `SiteLayoutDto`, ~line 219; import list at line ~31)
- Create: `packages/validation/__tests__/site-sections.spec.ts`

**Interfaces:**
- Produces: the constants and types below (exact names used by every later task), `SITE_SECTIONS_LIMITS`, `SiteSectionsSchema`, `SiteSectionsDto`.

- [ ] **Step 1: Write the failing schema test**

Create `packages/validation/__tests__/site-sections.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SITE_SECTION_ARRANGEMENTS, SITE_SECTION_KINDS, SITE_SECTION_ROLES } from '@revamp/shared-types';
import { SITE_SECTIONS_LIMITS as L, SiteSectionsSchema } from '../src/index.js';

const item = {
  title: 'dr Anna Nowak',
  subtitle: 'Ortodonta',
  text: ['Specjalizuje się w leczeniu aparatami stałymi.'],
  image: { src: 'https://falcodent.pl/team/anna.jpg', alt: 'Anna Nowak', width: 160, height: 160 },
  links: [{ label: 'Umów wizytę', href: 'https://falcodent.pl/kontakt', kind: 'cta' }],
};

const section = {
  index: 2,
  role: 'content',
  kind: 'team',
  arrangement: 'card-grid',
  columns: 3,
  intro: { eyebrow: 'Zespół', heading: 'Poznaj nas', headingLevel: 2, text: ['Nasi lekarze.'], links: [] },
  items: [item],
  itemStyle: { background: '#ffffff', radius: 12, border: false, shadow: true, imageShape: 'round', align: 'center' },
  extra: [
    { type: 'text', text: ['Przyjmujemy od poniedziałku do soboty.'] },
    { type: 'items', arrangement: 'list', items: [{ text: ['Implanty'], price: 'od 150 zł', links: [] }] },
  ],
  images: [],
  embeds: [{ kind: 'map', src: 'https://www.google.com/maps/embed?pb=1' }],
  style: { background: '#f5f7fa', textColor: '#111111', align: 'left', paddingY: 60, fullBleed: false },
};

const result = {
  sections: [section],
  typography: {
    heading: { family: 'Georgia', size: 32, weight: 700, uppercase: false, color: '#111111' },
    body: { family: 'Arial', size: 16, weight: 400, lineHeight: 1.5, color: '#333333' },
    button: { radius: 4, filled: true, uppercase: true, background: '#00aa77', color: '#ffffff' },
  },
  skipped: [{ index: 5, reason: 'noise', sample: 'Wszelkie prawa zastrzeżone' }],
  coverage: { pageChars: 1000, capturedChars: 980, ratio: 0.98, uncaptured: ['Zadzwoń'] },
};

const withSection = (patch: Record<string, unknown>) => ({ ...result, sections: [{ ...section, ...patch }] });
const withItem = (patch: Record<string, unknown>) => withSection({ items: [{ ...item, ...patch }] });
const ok = (value: unknown) => SiteSectionsSchema.safeParse(value).success;

describe('SiteSectionsSchema (REV-109)', () => {
  it('accepts a full result read from the DOM', () => {
    expect(SiteSectionsSchema.parse(result)).toEqual(result);
  });

  it('accepts every role, kind and arrangement, and rejects unknown ones', () => {
    for (const role of SITE_SECTION_ROLES) expect(ok(withSection({ role }))).toBe(true);
    for (const kind of SITE_SECTION_KINDS) expect(ok(withSection({ kind }))).toBe(true);
    for (const arrangement of SITE_SECTION_ARRANGEMENTS) expect(ok(withSection({ arrangement }))).toBe(true);
    expect(ok(withSection({ role: 'sidebar' }))).toBe(false);
    expect(ok(withSection({ arrangement: 'masonry' }))).toBe(false);
    expect(SITE_SECTION_KINDS).toContain('features');
  });

  it('keeps the caps at their limits and rejects one past them', () => {
    const many = <T>(count: number, value: T) => Array.from({ length: count }, () => value);
    expect(ok({ ...result, sections: many(L.sections, section) })).toBe(true);
    expect(ok({ ...result, sections: many(L.sections + 1, section) })).toBe(false);
    expect(ok(withSection({ items: many(L.items, item) }))).toBe(true);
    expect(ok(withSection({ items: many(L.items + 1, item) }))).toBe(false);
    expect(ok(withItem({ text: ['x'.repeat(L.textChars)] }))).toBe(true);
    expect(ok(withItem({ text: ['x'.repeat(L.textChars + 1)] }))).toBe(false);
    expect(ok(withItem({ text: many(L.textsPerArray + 1, 'x') }))).toBe(false);
    expect(ok(withItem({ title: 'x'.repeat(L.labelChars + 1) }))).toBe(false);
    expect(ok(withSection({ images: many(L.images + 1, item.image) }))).toBe(false);
    expect(ok(withSection({ embeds: many(L.embeds + 1, { kind: 'widget' }) }))).toBe(false);
    expect(ok(withSection({ extra: many(L.extra + 1, { type: 'text', text: ['x'] }) }))).toBe(false);
    expect(ok({ ...result, coverage: { ...result.coverage, uncaptured: many(L.uncaptured, 'x') } })).toBe(true);
    expect(ok({ ...result, coverage: { ...result.coverage, uncaptured: many(L.uncaptured + 1, 'x') } })).toBe(false);
    expect(ok({ ...result, skipped: [{ index: 1, reason: 'cap', sample: 'x'.repeat(L.sampleChars) }] })).toBe(true);
    expect(ok({ ...result, skipped: [{ index: 1, reason: 'cap', sample: 'x'.repeat(L.sampleChars + 1) }] })).toBe(false);
    expect(ok({ ...result, skipped: many(L.skipped + 1, { index: 1, reason: 'empty', sample: '' }) })).toBe(false);
  });

  it('rejects an invalid color, URL, rating, split or skip reason', () => {
    expect(ok(withSection({ style: { background: 'rgb(0,0,0)' } }))).toBe(false);
    expect(ok(withSection({ style: { backgroundImage: '/bg.jpg' } }))).toBe(false);
    expect(ok(withItem({ image: { src: 'data:image/gif;base64,R0lG' } }))).toBe(false);
    expect(ok(withItem({ links: [{ label: 'x', href: 'javascript:alert(1)', kind: 'link' }] }))).toBe(false);
    expect(ok(withItem({ links: [{ label: 'Zadzwoń', href: 'tel:+48123456789', kind: 'phone' }] }))).toBe(true);
    expect(ok(withItem({ rating: 5 }))).toBe(true);
    expect(ok(withItem({ rating: 5.5 }))).toBe(false);
    expect(ok(withItem({ rating: -1 }))).toBe(false);
    expect(ok(withSection({ style: { split: 1.2 } }))).toBe(false);
    expect(ok(withSection({ intro: { ...section.intro, headingLevel: 7 } }))).toBe(false);
    expect(ok({ ...result, skipped: [{ index: 1, reason: 'boring', sample: '' }] })).toBe(false);
    expect(ok({ ...result, coverage: { ...result.coverage, ratio: 1.01 } })).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { arrangement: _arrangement, ...noArrangement } = section;
    expect(ok({ ...result, sections: [noArrangement] })).toBe(false);
    const { links: _links, ...noLinks } = item;
    expect(ok(withSection({ items: [noLinks] }))).toBe(false);
    const { coverage: _coverage, ...noCoverage } = result;
    expect(ok(noCoverage)).toBe(false);
    expect(ok({ ...result, typography: undefined })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/validation/__tests__/site-sections.spec.ts`
Expected: FAIL (`SITE_SECTIONS_LIMITS` / `SITE_SECTION_ROLES` not exported).

- [ ] **Step 3: Add the types to `@revamp/shared-types`**

In `packages/shared-types/src/index.ts`, add `'features'` to `SITE_SECTION_KINDS` right before `'other'`:

```ts
  'map',
  // "Why us" / "Co nas wyróżnia": short headed points (REV-109)
  'features',
  'other',
```

After the `ISiteLayout` interface, add:

```ts
// The original home page read section by section, deterministically from the DOM (REV-109)

/** Where a section sits on the page; `hero` is the first content block on the first screen */
export const SITE_SECTION_ROLES = ['header', 'hero', 'content', 'footer'] as const;
export type SiteSectionRole = (typeof SITE_SECTION_ROLES)[number];

/** How a section lays out its content; the rebuild follows this rather than the kind */
export const SITE_SECTION_ARRANGEMENTS = [
  'banner',
  'media-beside-text',
  'text',
  'card-grid',
  'list',
  'accordion',
  'tabs',
  'slider',
  'gallery',
  'embed',
] as const;
export type SiteSectionArrangement = (typeof SITE_SECTION_ARRANGEMENTS)[number];

export const SITE_LINK_KINDS = ['cta', 'link', 'phone', 'email', 'map'] as const;
export type SiteLinkKind = (typeof SITE_LINK_KINDS)[number];

export const SITE_EMBED_KINDS = ['map', 'video', 'form', 'widget'] as const;
export type SiteEmbedKind = (typeof SITE_EMBED_KINDS)[number];

/** Why a block was left out of the sections; nothing is dropped without one */
export const SITE_SKIP_REASONS = ['noise', 'empty', 'duplicate', 'cap'] as const;
export type SiteSkipReason = (typeof SITE_SKIP_REASONS)[number];

export const SITE_IMAGE_SHAPES = ['square', 'round', 'wide', 'tall'] as const;
export type SiteImageShape = (typeof SITE_IMAGE_SHAPES)[number];

export interface ISiteImage {
  /** Absolute URL */
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface ISiteLink {
  label: string;
  href: string;
  kind: SiteLinkKind;
}

/** One repeated thing in a section: a service card, a person, an FAQ entry, a review, a price row */
export interface ISiteSectionItem {
  /** Service name, person's name, question, reviewer */
  title?: string;
  /** Role, date, eyebrow */
  subtitle?: string;
  /** Paragraphs and bullets, verbatim (an FAQ answer, a review's quote) */
  text: string[];
  image?: ISiteImage;
  /** As written, e.g. "od 150 zł" */
  price?: string;
  /** 0..5 */
  rating?: number;
  links: ISiteLink[];
}

export interface ISiteStyle {
  /** Hex */
  background?: string;
  /** Absolute URL */
  backgroundImage?: string;
  textColor?: string;
  align?: 'left' | 'center';
  /** Vertical padding per side, px */
  paddingY?: number;
  /** The content runs edge to edge rather than in a centred container */
  fullBleed?: boolean;
  /** media-beside-text: the media's share of the width, 0..1 */
  split?: number;
}

export interface ISiteItemStyle {
  background?: string;
  radius?: number;
  border?: boolean;
  shadow?: boolean;
  imageShape?: SiteImageShape;
  align?: 'left' | 'center';
}

export type ISiteSectionExtra =
  | { type: 'text'; text: string[] }
  | { type: 'items'; arrangement: SiteSectionArrangement; items: ISiteSectionItem[] };

export interface ISiteSection {
  /** Position in page order (header, blocks, footer), shared with `skipped` */
  index: number;
  role: SiteSectionRole;
  /** A label for tuning and completeness; the rebuild follows `arrangement` */
  kind: SiteSectionKind;
  arrangement: SiteSectionArrangement;
  columns?: number;
  mediaSide?: 'left' | 'right';
  intro: { eyebrow?: string; heading?: string; headingLevel?: number; text: string[]; links: ISiteLink[] };
  items: ISiteSectionItem[];
  itemStyle?: ISiteItemStyle;
  /** Everything else in the section, in page order */
  extra: ISiteSectionExtra[];
  /** Images outside the items */
  images: ISiteImage[];
  embeds: { kind: SiteEmbedKind; src?: string }[];
  style: ISiteStyle;
  /** A cap cut something from this section */
  truncated?: boolean;
}

export interface ISiteTypography {
  heading: { family: string; size: number; weight: number; uppercase: boolean; color?: string };
  body: { family: string; size: number; weight: number; lineHeight?: number; color?: string };
  button?: { radius: number; filled: boolean; uppercase: boolean; background?: string; color?: string };
}

export interface ISiteSections {
  sections: ISiteSection[];
  typography?: ISiteTypography;
  skipped: { index: number; reason: SiteSkipReason; heading?: string; sample: string }[];
  coverage: { pageChars: number; capturedChars: number; ratio: number; uncaptured: string[] };
}
```

In `IAudit`, after `siteLayoutError`:

```ts
  /** The original home page read section by section (REV-109); absent when it could not be read */
  siteSections?: ISiteSections;
  /** Why the sections could not be read */
  siteSectionsError?: string;
```

- [ ] **Step 4: Add the schema to `@revamp/validation`**

Add `SITE_SECTION_ROLES, SITE_SECTION_ARRANGEMENTS, SITE_LINK_KINDS, SITE_EMBED_KINDS, SITE_SKIP_REASONS, SITE_IMAGE_SHAPES` to the `@revamp/shared-types` import list at the top of `packages/validation/src/index.ts`. After `export type SiteLayoutDto ...` add:

```ts
// ==============================================================================
// Original site sections (REV-109)
// ==============================================================================

/** Caps on what the section reader keeps; a cut sets `truncated` on the section */
export const SITE_SECTIONS_LIMITS = {
  sections: 45,
  items: 60,
  textChars: 2000,
  uncaptured: 12,
  sampleChars: 120,
  labelChars: 300,
  urlChars: 2000,
  textsPerArray: 40,
  links: 40,
  images: 24,
  embeds: 8,
  extra: 20,
  skipped: 80,
  /** All text in the result; keeps the audit document far below MongoDB's 16 MB */
  totalChars: 150_000,
} as const;

const SL = SITE_SECTIONS_LIMITS;
const siteHex = z.string().regex(/^#[0-9a-f]{6}$/i);
const siteUrl = z.string().max(SL.urlChars).regex(/^https?:\/\//i);
const siteHref = z.string().max(SL.urlChars).regex(/^(https?:|tel:|mailto:|sms:)/i);
const siteLabel = z.string().min(1).max(SL.labelChars);
const siteTexts = z.array(z.string().min(1).max(SL.textChars)).max(SL.textsPerArray);
const siteAlign = z.enum(['left', 'center']);

const SiteImageSchema = z.object({
  src: siteUrl,
  alt: z.string().max(SL.labelChars).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
});

const SiteLinksSchema = z.array(z.object({ label: siteLabel, href: siteHref, kind: z.enum(SITE_LINK_KINDS) })).max(SL.links);

const SiteSectionItemSchema = z.object({
  title: siteLabel.optional(),
  subtitle: siteLabel.optional(),
  text: siteTexts,
  image: SiteImageSchema.optional(),
  price: siteLabel.optional(),
  rating: z.number().min(0).max(5).optional(),
  links: SiteLinksSchema,
});

const SiteItemsSchema = z.array(SiteSectionItemSchema).max(SL.items);

export const SiteSectionSchema = z.object({
  index: z.number().int().min(0),
  role: z.enum(SITE_SECTION_ROLES),
  kind: z.enum(SITE_SECTION_KINDS),
  arrangement: z.enum(SITE_SECTION_ARRANGEMENTS),
  columns: z.number().int().min(1).max(12).optional(),
  mediaSide: z.enum(['left', 'right']).optional(),
  intro: z.object({
    eyebrow: siteLabel.optional(),
    heading: siteLabel.optional(),
    headingLevel: z.number().int().min(1).max(6).optional(),
    text: siteTexts,
    links: SiteLinksSchema,
  }),
  items: SiteItemsSchema,
  itemStyle: z
    .object({
      background: siteHex.optional(),
      radius: z.number().int().min(0).max(1000).optional(),
      border: z.boolean().optional(),
      shadow: z.boolean().optional(),
      imageShape: z.enum(SITE_IMAGE_SHAPES).optional(),
      align: siteAlign.optional(),
    })
    .optional(),
  extra: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: siteTexts }),
        z.object({ type: z.literal('items'), arrangement: z.enum(SITE_SECTION_ARRANGEMENTS), items: SiteItemsSchema }),
      ]),
    )
    .max(SL.extra),
  images: z.array(SiteImageSchema).max(SL.images),
  embeds: z.array(z.object({ kind: z.enum(SITE_EMBED_KINDS), src: siteUrl.optional() })).max(SL.embeds),
  style: z.object({
    background: siteHex.optional(),
    backgroundImage: siteUrl.optional(),
    textColor: siteHex.optional(),
    align: siteAlign.optional(),
    paddingY: z.number().int().min(0).max(2000).optional(),
    fullBleed: z.boolean().optional(),
    split: z.number().min(0).max(1).optional(),
  }),
  truncated: z.boolean().optional(),
});

const siteFont = {
  family: z.string().min(1).max(100),
  size: z.number().int().min(1).max(200),
  weight: z.number().int().min(100).max(1000),
};

/**
 * The original home page as ordered sections, read from the DOM by code (never a model): each
 * section's content, arrangement and measured style, what was left out and why, and how much of the
 * page's text the sections hold.
 */
export const SiteSectionsSchema = z.object({
  sections: z.array(SiteSectionSchema).max(SL.sections),
  typography: z
    .object({
      heading: z.object({ ...siteFont, uppercase: z.boolean(), color: siteHex.optional() }),
      body: z.object({ ...siteFont, lineHeight: z.number().min(0.5).max(5).optional(), color: siteHex.optional() }),
      button: z
        .object({
          radius: z.number().int().min(0).max(1000),
          filled: z.boolean(),
          uppercase: z.boolean(),
          background: siteHex.optional(),
          color: siteHex.optional(),
        })
        .optional(),
    })
    .optional(),
  skipped: z
    .array(
      z.object({
        index: z.number().int().min(0),
        reason: z.enum(SITE_SKIP_REASONS),
        heading: siteLabel.optional(),
        sample: z.string().max(SL.sampleChars),
      }),
    )
    .max(SL.skipped),
  coverage: z.object({
    pageChars: z.number().int().min(0),
    capturedChars: z.number().int().min(0),
    ratio: z.number().min(0).max(1),
    uncaptured: z.array(z.string().min(1).max(SL.sampleChars)).max(SL.uncaptured),
  }),
});

export type SiteSectionsDto = z.infer<typeof SiteSectionsSchema>;
```

- [ ] **Step 5: Build the packages and run the test**

Run: `npm run build:packages && npx vitest run packages/validation/__tests__/site-sections.spec.ts packages/validation/__tests__/site-layout.spec.ts`
Expected: PASS (site-layout's "every section kind" test now includes `features` and still passes).

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/index.ts packages/validation/src/index.ts packages/validation/__tests__/site-sections.spec.ts
git commit -m "feat(REV-109): site section types and SiteSectionsSchema"
```

---

### Task 2: Audit model fields

**Files:**
- Modify: `packages/db/src/models/Audit.model.ts:127-129`
- Modify: `packages/db/__tests__/models.spec.ts` (after the REV-104 test at line 144)

**Interfaces:**
- Consumes: `ISiteSections` (Task 1).
- Produces: `Audit.siteSections` (Mixed), `Audit.siteSectionsError` (String).

- [ ] **Step 1: Write the failing test** — add after the REV-104 test in `packages/db/__tests__/models.spec.ts`:

```ts
    it('keeps the original site sections and the reason they could not be read (REV-109)', () => {
      const siteSections = {
        sections: [
          {
            index: 1,
            role: 'hero',
            kind: 'other',
            arrangement: 'banner',
            intro: { heading: 'Gabinet', headingLevel: 1, text: ['Witamy.'], links: [] },
            items: [],
            extra: [],
            images: [],
            embeds: [],
            style: { background: '#112233' },
          },
        ],
        skipped: [{ index: 3, reason: 'noise', sample: 'Wszelkie prawa zastrzeżone' }],
        coverage: { pageChars: 100, capturedChars: 97, ratio: 0.97, uncaptured: [] },
      };
      const read = new Audit({ leadId: new mongoose.Types.ObjectId(), siteSections });
      expect(read.toObject().siteSections).toEqual(siteSections);
      const unread = new Audit({ leadId: new mongoose.Types.ObjectId(), siteSectionsError: 'layout walk failed: timeout' });
      expect(unread.toObject().siteSectionsError).toBe('layout walk failed: timeout');
      expect(unread.toObject().siteSections).toBeUndefined();
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/db/__tests__/models.spec.ts -t "REV-109"`
Expected: FAIL (`siteSections` is `undefined`: strict mode dropped it).

- [ ] **Step 3: Declare the fields** — in `packages/db/src/models/Audit.model.ts`, right after `siteLayoutError: { type: String },`:

```ts
    // REV-109: the original home page read section by section (validated by SiteSectionsSchema), or why it could not be read
    siteSections: { type: Schema.Types.Mixed },
    siteSectionsError: { type: String },
```

- [ ] **Step 4: Run the test**

Run: `npm run build:packages && npx vitest run packages/db/__tests__/models.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/models/Audit.model.ts packages/db/__tests__/models.spec.ts
git commit -m "feat(REV-109): declare siteSections on the Audit model"
```

---

### Task 3: Block tagging and the `features` kind

**Files:**
- Modify: `apps/workers/src/services/site-layout.service.ts` (after `blocks = blocks.slice(0, MAX_BLOCKS);` line 124; `SECTION_WORDS` line 280)
- Modify: `apps/workers/src/services/__tests__/site-layout.service.spec.ts`
- Modify: `apps/workers/src/services/__tests__/layout-selection.service.spec.ts`

**Interfaces:**
- Produces: every block `collectSiteLayoutInPage` returns carries `data-revamp-block="<its index in raw.blocks>"` in the DOM; `classifyBlock` returns `'features'` for "why us" headings; `WHY_US_WORDS: RegExp` exported from `site-layout.service.ts`.

- [ ] **Step 1: Write the failing tests**

In `site-layout.service.spec.ts`, inside `describe('classifyBlock (REV-104)')` add:

```ts
  it('names a "why us" section features (REV-109)', () => {
    expect(classifyBlock(block({ heading: 'Co nas wyróżnia' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Dlaczego my?' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Why choose us' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Почему мы' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Nasze atuty' }))).toBe('features');
    // Existing kinds keep their words
    expect(classifyBlock(block({ heading: 'O nas' }))).toBe('about');
    expect(classifyBlock(block({ heading: 'Nasz zespół' }))).toBe('team');
  });
```

Inside `describe.skipIf(!browser)('collectSiteLayoutInPage ...')` add:

```ts
  it('tags each block it reads with its index, for the section reader (REV-109)', async () => {
    await page.setContent(PHOTO_SITE);
    const layout = await page.evaluate(collectSiteLayoutInPage);
    const tags = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-revamp-block]')).map((el) => el.getAttribute('data-revamp-block')),
    );
    expect(tags).toEqual(layout.blocks.map((_, index) => String(index)));
    // A second walk replaces the tags instead of adding to them
    await page.evaluate(collectSiteLayoutInPage);
    expect(await page.evaluate(() => document.querySelectorAll('[data-revamp-block]').length)).toBe(layout.blocks.length);
  });
```

In `layout-selection.service.spec.ts`, inside `describe('deriveMvpLayout (REV-104)')` (the file's builders are `site()` at line 160 and `signals()` at line 12), add:

```ts
  it('treats a features section like other: no MVP section, no order entry (REV-109)', () => {
    const base = site();
    const withFeatures = deriveMvpLayout(site({ sections: [...base.sections, { kind: 'features', heading: 'Co nas wyróżnia' }] }), signals());
    const withOther = deriveMvpLayout(site({ sections: [...base.sections, { kind: 'other', heading: 'Co nas wyróżnia' }] }), signals());
    expect(withFeatures.design).toEqual(withOther.design);
    expect(withFeatures.variant).toBe(withOther.variant);
    expect(withFeatures.reasons.find((r) => r.startsWith('order:'))).not.toContain('features');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/workers/src/services/__tests__/site-layout.service.spec.ts apps/workers/src/services/__tests__/layout-selection.service.spec.ts`
Expected: the `features` and tagging tests FAIL; the layout-selection test fails on `order:` containing `features`.

- [ ] **Step 3: Tag the blocks** — in `collectSiteLayoutInPage`, right after `blocks = blocks.slice(0, MAX_BLOCKS);`:

```ts
  // The section reader (REV-109) reads the same blocks, so both agree on where sections begin
  document.querySelectorAll('[data-revamp-block]').forEach((el) => el.removeAttribute('data-revamp-block'));
  blocks.forEach((el, index) => el.setAttribute('data-revamp-block', String(index)));
```

- [ ] **Step 4: Add the words** — in `site-layout.service.ts`, above `SECTION_WORDS`:

```ts
/** "Why us" headings, in the languages of the audited sites (REV-109) */
export const WHY_US_WORDS =
  /why (us|choose)|dlaczego (my|warto|nas)|co nas wyróżnia|nasze (atuty|zalety)|\bzalety\b|advantages|преимуществ|почему (мы|выбирают)|чаму (мы|выбіраюць)|перавагі|переваги|чому (ми|обирають)|kodėl (mes|verta)|privalum|warum wir|vorteile/;
```

and in `SECTION_WORDS` insert after the `'pricing'` entry and before `'team'`:

```ts
  ['features', WHY_US_WORDS],
```

- [ ] **Step 5: Keep `features` out of the derived order** — in `layout-selection.service.ts` `deriveMvpLayout`, change

```ts
  const kinds = site.sections.map((section) => section.kind).filter((kind) => kind !== 'other');
```

to

```ts
  // `features` has no MVP counterpart yet (REV-109); like `other`, it does not name the order
  const kinds = site.sections.map((section) => section.kind).filter((kind) => kind !== 'other' && kind !== 'features');
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/site-layout.service.spec.ts apps/workers/src/services/__tests__/layout-selection.service.spec.ts`
Expected: PASS, including every pre-existing REV-104 test.

- [ ] **Step 7: Commit**

```bash
git add apps/workers/src/services/site-layout.service.ts apps/workers/src/services/layout-selection.service.ts apps/workers/src/services/__tests__/site-layout.service.spec.ts apps/workers/src/services/__tests__/layout-selection.service.spec.ts
git commit -m "feat(REV-109): tag layout blocks and add the features kind"
```

---

### Task 4: Raw types and Node helpers (colors, links, shapes, arrangement, kind)

**Files:**
- Create: `apps/workers/src/services/site-sections.page.ts` (types only in this task)
- Create: `apps/workers/src/services/site-sections.service.ts` (helpers only in this task)
- Create: `apps/workers/src/services/__tests__/site-sections.service.spec.ts`

**Interfaces:**
- Produces (in `site-sections.page.ts`): `RawBox`, `RawSiteLink`, `RawSiteImage`, `RawSiteItem`, `RawGroupMarkup`, `RawItemGroup`, `RawSiteEmbed`, `RawSiteBlock`, `RawTextRun`, `RawTypography`, `RawSiteSections` — exactly as below.
- Produces (in `site-sections.service.ts`): `cleanText(value?: string): string`, `toHex(color?: string): string | undefined`, `linkKind(link: RawSiteLink): SiteLinkKind`, `imageShape(width: number, height: number, radius: number): SiteImageShape | undefined`, `columnsOf(items: RawSiteItem[]): number`, `groupArrangement(group: RawItemGroup): SiteSectionArrangement`, `arrangementOf(block: RawSiteBlock): { arrangement: SiteSectionArrangement; columns?: number; mediaSide?: 'left' | 'right'; split?: number }`, `kindFromItems(block: RawSiteBlock): SiteSectionKind | undefined`, `NOISE_LINE: RegExp`, `ROW_TOLERANCE = 8`.

- [ ] **Step 1: Create the raw types** — `apps/workers/src/services/site-sections.page.ts`:

```ts
/**
 * In-page half of the site section reader (REV-109). `collectSiteSectionsInPage` runs inside the
 * crawled page via page.evaluate(), so it must stay fully self-contained: no imports, no references
 * to module-level values. It reads the header, the blocks REV-104's layout walk tagged with
 * `data-revamp-block`, and the footer, and only reports raw DOM facts; `readSiteSections`
 * (site-sections.service.ts) makes every decision in Node. No LLM is involved at any step.
 */

/** A box in page coordinates, px */
export interface RawBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface RawSiteLink {
  label: string;
  /** Absolute */
  href: string;
  /** Styled as a button: padding plus an opaque background or a border */
  button: boolean;
}

export interface RawSiteImage {
  /** Absolute, never a data: URI */
  src: string;
  alt: string;
  box: RawBox;
  /** Corner radius of the image or its clipping parent, px */
  radius: number;
}

export interface RawSiteItem {
  title?: string;
  subtitle?: string;
  text: string[];
  image?: RawSiteImage;
  price?: string;
  rating?: number;
  links: RawSiteLink[];
  /** Carries an icon (svg, icon font, or a small image) */
  icon: boolean;
  box: RawBox;
}

/** Markup that names a group's arrangement or content outright */
export type RawGroupMarkup = 'accordion' | 'tabs' | 'slider' | 'person' | 'review';

export interface RawItemGroup {
  markup?: RawGroupMarkup;
  items: RawSiteItem[];
}

export interface RawSiteEmbed {
  kind: 'map' | 'video' | 'form' | 'widget';
  src?: string;
  box: RawBox;
}

export interface RawSiteBlock {
  role: 'header' | 'content' | 'footer';
  /** The REV-104 block index (`data-revamp-block`); absent for the header and footer */
  block?: number;
  box: RawBox;
  /** Around the eyebrow, heading and intro text */
  introBox?: RawBox;
  /** Around all visible content */
  contentBox?: RawBox;
  intro: { eyebrow?: string; heading?: string; headingLevel?: number; text: string[]; links: RawSiteLink[] };
  group?: RawItemGroup;
  extra: Array<{ type: 'text'; text: string[] } | { type: 'items'; group: RawItemGroup }>;
  /** Images outside the items */
  images: RawSiteImage[];
  backgroundImage?: string;
  embeds: RawSiteEmbed[];
  style: { background: string; color: string; textAlign: string; paddingTop: number; paddingBottom: number };
  /** Computed style of the first item's card */
  itemStyle?: { background: string; radius: number; borderWidth: number; boxShadow: string; textAlign: string };
}

/** Text outside every section, with its offset from the top of the page */
export interface RawTextRun {
  text: string;
  top: number;
}

export interface RawTypography {
  heading?: { family: string; size: number; weight: number; transform: string; color: string };
  body?: { family: string; size: number; weight: number; lineHeight: string; color: string };
  button?: { radius: number; background: string; borderWidth: number; transform: string; color: string };
}

export interface RawSiteSections {
  viewportWidth: number;
  viewportHeight: number;
  header?: RawSiteBlock;
  blocks: RawSiteBlock[];
  footer?: RawSiteBlock;
  typography: RawTypography;
  /** Characters of page text (visible text, plus hidden text inside sections) */
  pageChars: number;
  uncaptured: RawTextRun[];
}
```

- [ ] **Step 2: Write the failing helper tests** — create `apps/workers/src/services/__tests__/site-sections.service.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { RawBox, RawItemGroup, RawSiteBlock, RawSiteItem } from '../site-sections.page.js';
import { arrangementOf, cleanText, columnsOf, groupArrangement, imageShape, kindFromItems, linkKind, NOISE_LINE, toHex } from '../site-sections.service.js';

export const box = (top: number, left = 0, width = 1440, height = 400): RawBox => ({ top, left, width, height });

export const item = (overrides: Partial<RawSiteItem> = {}): RawSiteItem => ({
  title: 'Implanty',
  text: ['Opis usługi implantów w naszym gabinecie.'],
  links: [],
  icon: false,
  box: box(1100, 200, 320, 300),
  ...overrides,
});

export const rawBlock = (overrides: Partial<RawSiteBlock> = {}): RawSiteBlock => ({
  role: 'content',
  block: 1,
  box: box(900, 0, 1440, 600),
  introBox: box(960, 200, 1040, 120),
  contentBox: box(960, 200, 1040, 480),
  intro: { heading: 'Nasze usługi', headingLevel: 2, text: ['Leczymy kompleksowo.'], links: [] },
  extra: [],
  images: [],
  embeds: [],
  style: { background: 'rgb(255, 255, 255)', color: 'rgb(17, 17, 17)', textAlign: 'start', paddingTop: 60, paddingBottom: 60 },
  ...overrides,
});

const grid = (count: number, perRow: number): RawSiteItem[] =>
  Array.from({ length: count }, (_, i) => item({ box: box(1100 + Math.floor(i / perRow) * 320, 200 + (i % perRow) * 340, 320, 300) }));

describe('cleanText and toHex (REV-109)', () => {
  it('collapses whitespace and strips soft hyphens', () => {
    expect(cleanText('  Sto­matologia \n  estetyczna ')).toBe('Stomatologia estetyczna');
    expect(cleanText(undefined)).toBe('');
  });

  it('converts computed colors to hex and treats see-through ones as unset', () => {
    expect(toHex('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(toHex('rgba(10, 170, 119, 0.9)')).toBe('#0aaa77');
    expect(toHex('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(toHex('rgba(0, 0, 0, 0.3)')).toBeUndefined();
    expect(toHex('rgb(0 0 0 / 50%)')).toBe('#000000');
    expect(toHex('#ABCDEF')).toBe('#abcdef');
    expect(toHex('')).toBeUndefined();
    expect(toHex('transparent')).toBeUndefined();
  });
});

describe('linkKind (REV-109)', () => {
  it('names phone, email and map links by their href, then buttons', () => {
    expect(linkKind({ label: 'Zadzwoń', href: 'tel:+48123', button: true })).toBe('phone');
    expect(linkKind({ label: 'Napisz', href: 'mailto:a@b.pl', button: false })).toBe('email');
    expect(linkKind({ label: 'Dojazd', href: 'https://maps.app.goo.gl/abc', button: false })).toBe('map');
    expect(linkKind({ label: 'Dojazd', href: 'https://www.google.com/maps/place/x', button: false })).toBe('map');
    expect(linkKind({ label: 'Umów wizytę', href: 'https://a.pl/kontakt', button: true })).toBe('cta');
    expect(linkKind({ label: 'Więcej', href: 'https://a.pl/o-nas', button: false })).toBe('link');
  });
});

describe('imageShape (REV-109)', () => {
  it('reads round, wide, tall and square from the box and radius', () => {
    expect(imageShape(160, 160, 80)).toBe('round');
    expect(imageShape(160, 160, 79.5)).toBe('round');
    expect(imageShape(160, 160, 12)).toBe('square');
    expect(imageShape(400, 200, 0)).toBe('wide');
    expect(imageShape(200, 300, 0)).toBe('tall');
    expect(imageShape(0, 0, 0)).toBeUndefined();
  });
});

describe('arrangement (REV-109)', () => {
  it('follows markup first: accordion, tabs, slider', () => {
    for (const markup of ['accordion', 'tabs', 'slider'] as const) {
      expect(arrangementOf(rawBlock({ group: { markup, items: grid(3, 3) } })).arrangement).toBe(markup);
    }
  });

  it('calls a section taken up by an embed an embed', () => {
    const map = { kind: 'map' as const, box: box(900, 600, 840, 600) };
    expect(arrangementOf(rawBlock({ embeds: [map] })).arrangement).toBe('embed');
    expect(arrangementOf(rawBlock({ embeds: [{ ...map, box: box(900, 600, 400, 300) }] })).arrangement).toBe('text');
  });

  it('calls image-only items a gallery', () => {
    const photos = grid(4, 4).map((i) => ({ ...i, title: undefined, text: [], image: { src: 'https://a.pl/1.jpg', alt: '', box: i.box, radius: 0 } }));
    expect(arrangementOf(rawBlock({ group: { items: photos } })).arrangement).toBe('gallery');
  });

  it('calls items in a row a card grid with its columns, and stacked items a list', () => {
    expect(arrangementOf(rawBlock({ group: { items: grid(6, 3) } }))).toEqual({ arrangement: 'card-grid', columns: 3 });
    expect(arrangementOf(rawBlock({ group: { items: grid(4, 1) } }))).toEqual({ arrangement: 'list' });
    expect(columnsOf(grid(5, 2))).toBe(2);
    expect(columnsOf([])).toBe(0);
  });

  it('reads a large image beside the text, with its side and split', () => {
    const photo = { src: 'https://a.pl/room.jpg', alt: '', box: box(950, 864, 576, 400), radius: 0 };
    const result = arrangementOf(rawBlock({ images: [photo], introBox: box(1000, 40, 784, 300) }));
    expect(result.arrangement).toBe('media-beside-text');
    expect(result.mediaSide).toBe('right');
    expect(result.split).toBeCloseTo(0.42, 2);
    const left = arrangementOf(rawBlock({ images: [{ ...photo, box: box(950, 0, 576, 400) }], introBox: box(1000, 656, 784, 300) }));
    expect(left.mediaSide).toBe('left');
  });

  it('does not call a small or stacked image beside the text', () => {
    const small = { src: 'https://a.pl/i.png', alt: '', box: box(950, 1100, 200, 200), radius: 0 };
    expect(arrangementOf(rawBlock({ images: [small], introBox: box(1000, 40, 784, 300) })).arrangement).toBe('text');
    const below = { src: 'https://a.pl/i.png', alt: '', box: box(1400, 200, 1040, 400), radius: 0 };
    expect(arrangementOf(rawBlock({ images: [below], introBox: box(960, 200, 1040, 300) })).arrangement).toBe('text');
  });

  it('calls a background photo, or a full photo under the copy, a banner', () => {
    expect(arrangementOf(rawBlock({ backgroundImage: 'https://a.pl/bg.jpg' })).arrangement).toBe('banner');
    const cover = { src: 'https://a.pl/bg.jpg', alt: '', box: box(900, 0, 1440, 600), radius: 0 };
    expect(arrangementOf(rawBlock({ images: [cover], introBox: box(1000, 200, 800, 200) })).arrangement).toBe('banner');
  });

  it('falls back to text', () => {
    expect(arrangementOf(rawBlock())).toEqual({ arrangement: 'text' });
  });

  it('names an extra group by the same rules', () => {
    const group: RawItemGroup = { items: grid(2, 1) };
    expect(groupArrangement(group)).toBe('list');
  });
});

describe('kindFromItems (REV-109)', () => {
  const portrait = (i: number) => ({ src: `https://a.pl/p${i}.jpg`, alt: '', box: box(1100, 200 + i * 340, 160, 160), radius: 80 });

  it('reads a team from portraits with names and short roles', () => {
    const people = Array.from({ length: 6 }, (_, i) => item({ title: `dr Osoba ${i}`, subtitle: 'Lekarz stomatolog', text: ['Krótkie bio.'], image: portrait(i) }));
    expect(kindFromItems(rawBlock({ intro: { heading: 'O nas', text: [], links: [] }, group: { items: people } }))).toBe('team');
    // Two people are not a team section
    expect(kindFromItems(rawBlock({ group: { items: people.slice(0, 2) } }))).toBeUndefined();
    // No roles: not a team
    expect(kindFromItems(rawBlock({ group: { items: people.map((p) => ({ ...p, subtitle: undefined })) } }))).toBeUndefined();
  });

  it('reads an FAQ from question titles', () => {
    const faq = ['Czy boli?', 'Ile trwa wizyta?', 'Jak się przygotować?'].map((title) => item({ title, text: ['Odpowiedź.'] }));
    expect(kindFromItems(rawBlock({ group: { markup: 'accordion', items: faq } }))).toBe('faq');
    expect(kindFromItems(rawBlock({ group: { items: faq.map((f) => ({ ...f, title: 'Implanty' })) } }))).toBeUndefined();
  });

  it('reads features from short headed points under a why-us heading', () => {
    const points = ['Doświadczenie', 'Nowoczesny sprzęt', 'Raty 0%'].map((title) => item({ title, text: ['Krótko.'], icon: true }));
    expect(kindFromItems(rawBlock({ intro: { heading: 'Co nas wyróżnia', text: [], links: [] }, group: { items: points } }))).toBe('features');
    expect(kindFromItems(rawBlock({ intro: { heading: 'Nasze usługi', text: [], links: [] }, group: { items: points } }))).toBeUndefined();
  });
});

describe('NOISE_LINE (REV-109)', () => {
  it('matches consent and legal boilerplate only', () => {
    for (const line of [
      'Ta strona używa plików cookies.',
      'Administratorem Twoich danych osobowych jest Falco-Dent sp. z o.o.',
      '© 2024 Falco-Dent. Wszelkie prawa zastrzeżone.',
      'All rights reserved.',
      'Klauzula informacyjna RODO',
    ]) {
      expect(NOISE_LINE.test(line)).toBe(true);
    }
    for (const line of ['ul. Ogrodowa 5, Kraków', 'Leczenie kanałowe pod mikroskopem', 'Pon–Pt 9:00–18:00']) {
      expect(NOISE_LINE.test(line)).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.service.spec.ts`
Expected: FAIL (`site-sections.service.js` does not exist).

- [ ] **Step 4: Write the helpers** — create `apps/workers/src/services/site-sections.service.ts`:

```ts
/**
 * Node half of the site section reader (REV-109): turns the raw DOM facts `collectSiteSectionsInPage`
 * reports into validated `ISiteSections`. Cleans the text, attaches stray text to the nearer section,
 * skips noise, empty, duplicate and over-cap blocks with a reason, names each section's arrangement,
 * kind and style, and measures how much of the page's text the sections hold. No LLM at any step.
 */
import type { SiteImageShape, SiteLinkKind, SiteSectionArrangement, SiteSectionKind } from '@revamp/shared-types';
import { WHY_US_WORDS } from './site-layout.service.js';
import type { RawItemGroup, RawSiteBlock, RawSiteItem, RawSiteLink } from './site-sections.page.js';

export const cleanText = (value: string | undefined): string =>
  (value ?? '').replace(/­/g, '').replace(/\s+/g, ' ').trim();

/** A computed color as hex; see-through colors (alpha below 0.5) count as unset */
export function toHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const match = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/);
  if (!match) return undefined;
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : Number(alphaRaw);
  if (alpha < 0.5) return undefined;
  const channel = (value: string | undefined) =>
    Math.max(0, Math.min(255, Math.round(Number(value)))).toString(16).padStart(2, '0');
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

const MAP_LINK = /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap\.org|mapy\.cz|yandex\.[a-z]+\/maps|maps\.apple\.com/i;

export function linkKind(link: RawSiteLink): SiteLinkKind {
  if (/^tel:/i.test(link.href)) return 'phone';
  if (/^mailto:/i.test(link.href)) return 'email';
  if (MAP_LINK.test(link.href)) return 'map';
  return link.button ? 'cta' : 'link';
}

export function imageShape(width: number, height: number, radius: number): SiteImageShape | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  // Half the width, with a pixel of slack for sub-pixel layout
  if (radius >= width / 2 - 1) return 'round';
  const ratio = width / height;
  if (ratio >= 1.3) return 'wide';
  if (ratio <= 0.77) return 'tall';
  return 'square';
}

/** Items whose tops are this close sit in one row, px */
export const ROW_TOLERANCE = 8;

export function columnsOf(items: RawSiteItem[]): number {
  const first = items[0];
  if (!first) return 0;
  return items.filter((i) => Math.abs(i.box.top - first.box.top) <= ROW_TOLERANCE).length;
}

const ARRANGED_BY_MARKUP = new Set<string>(['accordion', 'tabs', 'slider']);

export function groupArrangement(group: RawItemGroup): SiteSectionArrangement {
  if (group.markup && ARRANGED_BY_MARKUP.has(group.markup)) return group.markup as SiteSectionArrangement;
  if (group.items.length > 0 && group.items.every((i) => i.image && !i.title && i.text.length === 0)) return 'gallery';
  return columnsOf(group.items) >= 2 ? 'card-grid' : 'list';
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const area = (b: { width: number; height: number }) => b.width * b.height;

/**
 * How the section lays out its content, first rule that matches (spec §5.3): markup, an embed that
 * takes up the section, image-only items, items in a row or stacked, a large image beside the text,
 * a photo behind the copy, else plain text.
 */
export function arrangementOf(block: RawSiteBlock): {
  arrangement: SiteSectionArrangement;
  columns?: number;
  mediaSide?: 'left' | 'right';
  split?: number;
} {
  const group = block.group;
  if (group?.markup && ARRANGED_BY_MARKUP.has(group.markup)) return { arrangement: group.markup as SiteSectionArrangement };

  const sectionArea = area(block.box);
  const embedArea = block.embeds.reduce((sum, e) => sum + area(e.box), 0);
  if (sectionArea > 0 && embedArea > sectionArea / 2) return { arrangement: 'embed' };

  if (group && group.items.length >= 2) {
    const arrangement = groupArrangement(group);
    return arrangement === 'card-grid' ? { arrangement, columns: columnsOf(group.items) } : { arrangement };
  }

  const media = [...block.images].sort((a, b) => area(b.box) - area(a.box))[0];
  const text = block.introBox;
  if (media && text && media.box.width >= block.box.width / 4) {
    const m = media.box;
    const vertical = overlap(m.top, m.top + m.height, text.top, text.top + text.height);
    const horizontal = overlap(m.left, m.left + m.width, text.left, text.left + text.width);
    if (vertical >= Math.min(m.height, text.height) / 2 && horizontal <= Math.min(m.width, text.width) / 10) {
      return {
        arrangement: 'media-beside-text',
        mediaSide: m.left + m.width / 2 < text.left + text.width / 2 ? 'left' : 'right',
        split: Math.round((m.width / (m.width + text.width)) * 100) / 100,
      };
    }
  }

  const coversSection = media !== undefined && sectionArea > 0 && area(media.box) >= sectionArea * 0.6;
  const copyOnMedia =
    media !== undefined &&
    text !== undefined &&
    text.top >= media.box.top &&
    text.top + text.height <= media.box.top + media.box.height &&
    text.left >= media.box.left &&
    text.left + text.width <= media.box.left + media.box.width;
  if (block.backgroundImage || (coversSection && copyOnMedia)) return { arrangement: 'banner' };
  return { arrangement: 'text' };
}

/** What the items say the section is; wins over the heading (spec §5.4) */
export function kindFromItems(block: RawSiteBlock): SiteSectionKind | undefined {
  const items = block.group?.items ?? [];
  const portrait = (i: RawSiteItem) => {
    const b = i.image?.box;
    return b !== undefined && b.width > 0 && b.height / b.width >= 0.8 && b.height / b.width <= 1.6;
  };
  const textLength = (i: RawSiteItem) => i.text.join(' ').length;
  if (
    (block.group?.markup === 'person' && items.length >= 2) ||
    (items.length >= 3 &&
      items.every((i) => portrait(i) && i.title && i.title.length <= 60 && i.subtitle && i.subtitle.length <= 80 && textLength(i) <= 600))
  ) {
    return 'team';
  }
  if (items.length >= 2 && items.every((i) => i.title) && items.filter((i) => i.title!.trim().endsWith('?')).length >= items.length / 2) {
    return 'faq';
  }
  const heading = (block.intro.heading ?? '').toLowerCase();
  if (items.length >= 2 && WHY_US_WORDS.test(heading) && items.every((i) => i.title && textLength(i) <= 400)) return 'features';
  return undefined;
}

/** Consent and legal boilerplate: removed line by line, always recorded in `skipped` */
export const NOISE_LINE =
  /\b(cookies?|ciasteczk\w*|rodo|gdpr)\b|polityk\S* prywatności|privacy policy|all rights reserved|wszelkie prawa zastrzeżone|все права защищены|усе правы абаронены|всі права захищені|visos teisės saugomos|alle rechte vorbehalten|administratorem (twoich |pani\/pana )?danych/i;
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.service.spec.ts`
Expected: PASS. (If `NOISE_LINE` misses `plików cookies.` because `\b` fails before a non-ASCII letter, it won't here; `cookies` is ASCII.)

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/services/site-sections.page.ts apps/workers/src/services/site-sections.service.ts apps/workers/src/services/__tests__/site-sections.service.spec.ts
git commit -m "feat(REV-109): raw section types and arrangement, kind and style helpers"
```

---

### Task 5: `readSiteSections`

**Files:**
- Modify: `apps/workers/src/services/site-sections.service.ts`
- Modify: `apps/workers/src/services/__tests__/site-sections.service.spec.ts`

**Interfaces:**
- Consumes: Task 4 helpers, `classifyBlock` and `RawLayoutBlock` from `site-layout.service.ts`, `SITE_SECTIONS_LIMITS` and `SiteSectionsSchema`.
- Produces: `type SiteSectionsReading = { sections: ISiteSections; error?: undefined } | { sections?: undefined; error: string }`; `readSiteSections(raw: RawSiteSections | undefined, layoutBlocks?: RawLayoutBlock[]): SiteSectionsReading`; `toTypography(raw: RawTypography | undefined): ISiteTypography | undefined`.

- [ ] **Step 1: Write the failing tests** — append to `site-sections.service.spec.ts` (add `readSiteSections, toTypography` to the service import, `RawSiteSections` to the type import, and `import type { RawLayoutBlock } from '../site-layout.service.js'; import { SITE_SECTIONS_LIMITS as L } from '@revamp/validation';`):

```ts
const layoutBlock = (overrides: Partial<RawLayoutBlock> = {}): RawLayoutBlock => ({
  top: 900, height: 600, hint: '', heading: '', imageCount: 0, formCount: 0, mapEmbed: false,
  quoteCount: 0, priceCount: 0, textLength: 400, paddingY: 120, ...overrides,
});

const HERO = rawBlock({ block: 0, box: box(90, 0, 1440, 700), intro: { heading: 'Gabinet Falco', headingLevel: 1, text: ['Witamy.'], links: [] } });

const raw = (overrides: Partial<RawSiteSections> = {}): RawSiteSections => ({
  viewportWidth: 1440,
  viewportHeight: 900,
  blocks: [HERO, rawBlock({ block: 1 })],
  typography: {},
  pageChars: 60,
  uncaptured: [],
  ...overrides,
});

const LAYOUT = [layoutBlock({ top: 90, heading: 'Gabinet Falco' }), layoutBlock({ heading: 'Nasze usługi' })];

describe('readSiteSections (REV-109)', () => {
  it('reads the blocks in page order, the first one on the first screen as the hero', () => {
    const { sections, error } = readSiteSections(raw(), LAYOUT);
    expect(error).toBeUndefined();
    expect(sections!.sections.map((s) => [s.index, s.role, s.kind, s.arrangement])).toEqual([
      [0, 'hero', 'other', 'text'],
      [1, 'content', 'services', 'text'],
    ]);
    expect(sections!.sections[1]!.intro).toEqual({ heading: 'Nasze usługi', headingLevel: 2, text: ['Leczymy kompleksowo.'], links: [] });
  });

  it('keeps a first block below the first screen as content', () => {
    const low = { ...HERO, box: box(1000, 0, 1440, 700) };
    expect(readSiteSections(raw({ blocks: [low, rawBlock()] }), LAYOUT).sections!.sections[0]!.role).toBe('content');
  });

  it('numbers header, blocks and footer in page order and names the footer by its contacts', () => {
    const header = rawBlock({ role: 'header', block: undefined, box: box(0, 0, 1440, 90), intro: { text: [], links: [{ label: 'Start', href: 'https://a.pl/', button: false }] } });
    const footer = rawBlock({ role: 'footer', block: undefined, box: box(1600, 0, 1440, 300), intro: { text: [], links: [{ label: '+48 12 345', href: 'tel:+4812345', button: false }] }, extra: [{ type: 'text', text: ['ul. Długa 5'] }] });
    const { sections } = readSiteSections(raw({ header, footer }), LAYOUT);
    expect(sections!.sections.map((s) => [s.index, s.role, s.kind])).toEqual([
      [0, 'header', 'other'], [1, 'hero', 'other'], [2, 'content', 'services'], [3, 'footer', 'contact'],
    ]);
    expect(sections!.sections[3]!.intro.links[0]!.kind).toBe('phone');
  });

  it('lets the items win over the heading', () => {
    const portrait = (i: number) => ({ src: `https://a.pl/p${i}.jpg`, alt: '', box: box(1100, i * 300, 160, 160), radius: 80 });
    const people = Array.from({ length: 3 }, (_, i) => item({ title: `dr Osoba ${i}`, subtitle: 'Ortodonta', text: ['Bio.'], image: portrait(i), box: box(1100, i * 300, 280, 400) }));
    const about = rawBlock({ intro: { heading: 'O nas', text: [], links: [] }, group: { items: people }, itemStyle: { background: 'rgba(0, 0, 0, 0)', radius: 0, borderWidth: 0, boxShadow: 'none', textAlign: 'center' } });
    const section = readSiteSections(raw({ blocks: [HERO, about] }), [LAYOUT[0]!, layoutBlock({ heading: 'O nas' })]).sections!.sections[1]!;
    expect(section.kind).toBe('team');
    expect(section.arrangement).toBe('card-grid');
    expect(section.columns).toBe(3);
    expect(section.items[0]).toEqual({ title: 'dr Osoba 0', subtitle: 'Ortodonta', text: ['Bio.'], image: { src: 'https://a.pl/p0.jpg', width: 160, height: 160 }, links: [] });
    expect(section.itemStyle).toEqual({ radius: 0, border: false, shadow: false, imageShape: 'round', align: 'center' });
  });

  it('normalizes the style: hex colors, px padding per side, alignment, full bleed', () => {
    const block = rawBlock({ style: { background: 'rgb(245, 247, 250)', color: 'rgb(17, 17, 17)', textAlign: 'center', paddingTop: 61.4, paddingBottom: 80.2 }, contentBox: box(960, 0, 1440, 480) });
    expect(readSiteSections(raw({ blocks: [HERO, block] }), LAYOUT).sections!.sections[1]!.style).toEqual({
      background: '#f5f7fa', textColor: '#111111', align: 'center', paddingY: 71, fullBleed: true,
    });
  });

  it('moves a price out of the text and keeps it as written', () => {
    const rows = [item({ title: 'Przegląd', text: ['od 150 zł'], price: 'od 150 zł' }), item({ title: 'Higienizacja', text: ['300 zł'], price: '300 zł', box: box(1500, 200, 320, 300) })];
    const s = readSiteSections(raw({ blocks: [HERO, rawBlock({ group: { items: rows } })] }), LAYOUT).sections!.sections[1]!;
    expect(s.items.map((i) => [i.title, i.text, i.price])).toEqual([['Przegląd', [], 'od 150 zł'], ['Higienizacja', [], '300 zł']]);
  });

  it('attaches a stray paragraph between blocks to the nearer section, before or after its own text', () => {
    const second = rawBlock({ box: box(1000, 0, 1440, 600) });
    const nearHero = { text: 'Zapraszamy od poniedziałku do soboty.', top: 800 };
    const nearSecond = { text: 'Kolejny akapit.', top: 990 };
    const { sections } = readSiteSections(raw({ blocks: [HERO, second], uncaptured: [nearHero, nearSecond] }), LAYOUT);
    expect(sections!.sections[0]!.extra).toEqual([{ type: 'text', text: ['Zapraszamy od poniedziałku do soboty.'] }]);
    expect(sections!.sections[1]!.extra).toEqual([{ type: 'text', text: ['Kolejny akapit.'] }]);
    expect(sections!.coverage.uncaptured).toEqual([]);
  });

  it('leaves text that sits beside a section, not between sections, in uncaptured', () => {
    const { sections } = readSiteSections(raw({ uncaptured: [{ text: 'Menu boczne', top: 1000 }] }), LAYOUT);
    expect(sections!.coverage.uncaptured).toEqual(['Menu boczne']);
  });

  it('removes noise lines with a reason and skips a section that is all noise', () => {
    const footer = rawBlock({ role: 'footer', block: undefined, box: box(1600, 0, 1440, 200), intro: { text: [], links: [] }, extra: [{ type: 'text', text: ['ul. Długa 5', '© 2024 Falco. Wszelkie prawa zastrzeżone.'] }] });
    const consent = rawBlock({ block: 2, box: box(1500, 0, 1440, 90), intro: { text: ['Ta strona używa plików cookies.'], links: [] } });
    const { sections } = readSiteSections(raw({ blocks: [HERO, rawBlock(), consent], footer }), [...LAYOUT, layoutBlock()]);
    const f = sections!.sections.find((s) => s.role === 'footer')!;
    expect(f.extra).toEqual([{ type: 'text', text: ['ul. Długa 5'] }]);
    expect(sections!.skipped).toEqual([
      { index: 2, reason: 'noise', sample: 'Ta strona używa plików cookies.' },
      { index: 3, reason: 'noise', sample: '© 2024 Falco. Wszelkie prawa zastrzeżone.' },
    ]);
    expect(sections!.sections.map((s) => s.index)).toEqual([0, 1, 3]);
  });

  it('skips an empty block and a duplicate with a reason', () => {
    const empty = rawBlock({ block: 2, intro: { text: [], links: [] } });
    const again = rawBlock({ block: 3 });
    const { sections } = readSiteSections(raw({ blocks: [HERO, rawBlock(), empty, again] }), [...LAYOUT, layoutBlock(), layoutBlock()]);
    expect(sections!.skipped.map((s) => [s.index, s.reason])).toEqual([[2, 'empty'], [3, 'duplicate']]);
    expect(sections!.skipped[1]!.heading).toBe('Nasze usługi');
  });

  it('keeps an image-only section', () => {
    const photo = rawBlock({ block: 2, intro: { text: [], links: [] }, images: [{ src: 'https://a.pl/x.jpg', alt: '', box: box(1600, 0, 400, 300), radius: 0 }] });
    expect(readSiteSections(raw({ blocks: [HERO, rawBlock(), photo] }), [...LAYOUT, layoutBlock()]).sections!.sections).toHaveLength(3);
  });

  it('computes coverage from the kept and the skipped text', () => {
    // Kept: "Gabinet Falco"(13) + "Witamy."(7) + "Nasze usługi"(12) + "Leczymy kompleksowo."(20) = 52; the skipped duplicate adds its 32
    const { sections } = readSiteSections(raw({ blocks: [HERO, rawBlock(), rawBlock({ block: 2 })], pageChars: 100 }), [...LAYOUT, layoutBlock()]);
    expect(sections!.coverage).toEqual({ pageChars: 100, capturedChars: 84, ratio: 0.84, uncaptured: [] });
    expect(readSiteSections(raw({ pageChars: 10 }), LAYOUT).sections!.coverage.ratio).toBe(1);
  });

  it('cuts at the caps, sets truncated, and sends sections past the limit to skipped', () => {
    const many = Array.from({ length: L.items + 5 }, (_, i) => item({ title: `Usługa ${i}`, box: box(1100, i * 10, 100, 100) }));
    const long = rawBlock({ intro: { heading: 'Nasze usługi', text: ['x'.repeat(L.textChars + 10)], links: [] }, group: { items: many } });
    const s = readSiteSections(raw({ blocks: [HERO, long] }), LAYOUT).sections!.sections[1]!;
    expect(s.items).toHaveLength(L.items);
    expect(s.intro.text[0]).toHaveLength(L.textChars);
    expect(s.truncated).toBe(true);

    const blocks = Array.from({ length: L.sections + 3 }, (_, i) => rawBlock({ block: i, box: box(900 + i * 700), intro: { heading: `Sekcja ${i}`, text: [], links: [] } }));
    const capped = readSiteSections(raw({ blocks }), blocks.map(() => layoutBlock())).sections!;
    expect(capped.sections).toHaveLength(L.sections);
    expect(capped.skipped.filter((s) => s.reason === 'cap')).toHaveLength(3);
  });

  it('stops at the total text budget', () => {
    const big = (i: number) => rawBlock({ block: i, box: box(900 + i * 700), intro: { heading: `S${i}`, text: Array.from({ length: L.textsPerArray }, (_, j) => `${i}-${j}-${'x'.repeat(L.textChars - 10)}`), links: [] } });
    const blocks = Array.from({ length: 4 }, (_, i) => big(i));
    const { sections } = readSiteSections(raw({ blocks }), blocks.map(() => layoutBlock()));
    const total = sections!.sections.reduce((sum, s) => sum + s.intro.text.join('').length, 0);
    expect(total).toBeLessThanOrEqual(L.totalChars);
    expect(sections!.skipped.some((s) => s.reason === 'cap')).toBe(true);
  });

  it('drops links it cannot store and repeats of the same link', () => {
    const links = [
      { label: 'Umów', href: 'https://a.pl/kontakt', button: true },
      { label: 'Umów', href: 'https://a.pl/kontakt', button: true },
      { label: 'WhatsApp', href: 'whatsapp://send?phone=1', button: false },
    ];
    const s = readSiteSections(raw({ blocks: [HERO, rawBlock({ intro: { heading: 'Kontakt', text: [], links } })] }), LAYOUT).sections!.sections[1]!;
    expect(s.intro.links).toEqual([{ label: 'Umów', href: 'https://a.pl/kontakt', kind: 'cta' }]);
  });

  it('reports why nothing could be read instead of inventing sections', () => {
    expect(readSiteSections(undefined).error).toMatch(/could not be collected/);
    const onlyHeader = raw({ blocks: [], header: rawBlock({ role: 'header', block: undefined, box: box(0) }) });
    expect(readSiteSections(onlyHeader, []).error).toMatch(/No content sections/);
    const invalid = raw({ blocks: [HERO, rawBlock({ intro: { heading: 'X', headingLevel: 9, text: [], links: [] } })] });
    expect(readSiteSections(invalid, LAYOUT).error).toMatch(/failed validation.*headingLevel/);
  });
});

describe('toTypography (REV-109)', () => {
  it('keeps the first family, rounds sizes and turns px line height into a ratio', () => {
    expect(
      toTypography({
        heading: { family: '"Playfair Display", Georgia, serif', size: 32.4, weight: 700, transform: 'uppercase', color: 'rgb(17, 17, 17)' },
        body: { family: 'Arial, sans-serif', size: 16, weight: 400, lineHeight: '24px', color: 'rgb(51, 51, 51)' },
        button: { radius: 4, background: 'rgb(0, 170, 119)', borderWidth: 0, transform: 'none', color: 'rgb(255, 255, 255)' },
      }),
    ).toEqual({
      heading: { family: 'Playfair Display', size: 32, weight: 700, uppercase: true, color: '#111111' },
      body: { family: 'Arial', size: 16, weight: 400, lineHeight: 1.5, color: '#333333' },
      button: { radius: 4, filled: true, uppercase: false, background: '#00aa77', color: '#ffffff' },
    });
    expect(toTypography({ heading: undefined })).toBeUndefined();
    expect(toTypography({ heading: { family: 'A', size: 30, weight: 700, transform: 'none', color: '' }, body: { family: 'B', size: 16, weight: 400, lineHeight: 'normal', color: '' } })!.body.lineHeight).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.service.spec.ts`
Expected: FAIL (`readSiteSections` is not exported).

- [ ] **Step 3: Implement** — extend `site-sections.service.ts`. Update the imports:

```ts
import type {
  ISiteImage,
  ISiteLink,
  ISiteSection,
  ISiteSectionItem,
  ISiteSections,
  ISiteTypography,
  SiteImageShape,
  SiteLinkKind,
  SiteSectionArrangement,
  SiteSectionKind,
} from '@revamp/shared-types';
import { SITE_SECTIONS_LIMITS, SiteSectionsSchema } from '@revamp/validation';
import { classifyBlock, WHY_US_WORDS, type RawLayoutBlock } from './site-layout.service.js';
import type { RawItemGroup, RawSiteBlock, RawSiteImage, RawSiteItem, RawSiteLink, RawSiteSections, RawTextRun, RawTypography } from './site-sections.page.js';
```

Append:

```ts
const L = SITE_SECTIONS_LIMITS;
type Cut = { truncated: boolean };

const cut = (value: string | undefined, max: number, flag: Cut): string | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;
  if (text.length <= max) return text;
  flag.truncated = true;
  return text.slice(0, max);
};

const cutList = <T>(list: T[], max: number, flag: Cut): T[] => {
  if (list.length <= max) return list;
  flag.truncated = true;
  return list.slice(0, max);
};

const texts = (lines: string[], flag: Cut): string[] =>
  cutList(lines.map((line) => cut(line, L.textChars, flag)).filter((line): line is string => line !== undefined), L.textsPerArray, flag);

const STORABLE_HREF = /^(https?:|tel:|mailto:|sms:)/i;

const toLinks = (links: RawSiteLink[], flag: Cut): ISiteLink[] => {
  const seen = new Set<string>();
  const kept: ISiteLink[] = [];
  for (const link of links) {
    const label = cut(link.label, L.labelChars, flag);
    const href = link.href.trim();
    const key = `${label}\n${href}`;
    if (!label || !STORABLE_HREF.test(href) || href.length > L.urlChars || seen.has(key)) continue;
    seen.add(key);
    kept.push({ label, href, kind: linkKind(link) });
  }
  return cutList(kept, L.links, flag);
};

const storableUrl = (url: string | undefined) => (url && /^https?:\/\//i.test(url) && url.length <= L.urlChars ? url : undefined);

const toImage = (image: RawSiteImage | undefined): ISiteImage | undefined => {
  const src = storableUrl(image?.src);
  if (!image || !src) return undefined;
  const alt = cleanText(image.alt).slice(0, L.labelChars);
  return {
    src,
    ...(alt ? { alt } : {}),
    ...(image.box.width > 0 && image.box.height > 0 ? { width: Math.round(image.box.width), height: Math.round(image.box.height) } : {}),
  };
};

const toItem = (item: RawSiteItem, flag: Cut): ISiteSectionItem => {
  const price = cut(item.price, L.labelChars, flag);
  return {
    title: cut(item.title, L.labelChars, flag),
    subtitle: cut(item.subtitle, L.labelChars, flag),
    // A line that is only the price is the price, not text
    text: texts(item.text.filter((line) => cleanText(line) !== price), flag),
    image: toImage(item.image),
    price,
    rating: item.rating !== undefined && item.rating >= 0 && item.rating <= 5 ? Math.round(item.rating * 10) / 10 : undefined,
    links: toLinks(item.links, flag),
  };
};

const alignOf = (textAlign: string): 'left' | 'center' => (/center/.test(textAlign) ? 'center' : 'left');

/** Characters of text a section holds; a price inside its item's text is not counted twice */
function sectionChars(section: ISiteSection): number {
  const sum = (list: string[]) => list.reduce((total, s) => total + s.length, 0);
  const labels = (links: ISiteLink[]) => sum(links.map((link) => link.label));
  const itemChars = (i: ISiteSectionItem) =>
    (i.title?.length ?? 0) +
    (i.subtitle?.length ?? 0) +
    sum(i.text) +
    (i.price && !i.text.some((line) => line.includes(i.price!)) ? i.price.length : 0) +
    labels(i.links);
  const itemsChars = (items: ISiteSectionItem[]) => items.reduce((total, i) => total + itemChars(i), 0);
  return (
    (section.intro.eyebrow?.length ?? 0) +
    (section.intro.heading?.length ?? 0) +
    sum(section.intro.text) +
    labels(section.intro.links) +
    itemsChars(section.items) +
    section.extra.reduce((total, e) => total + (e.type === 'text' ? sum(e.text) : itemsChars(e.items)), 0)
  );
}

/** All the section's text in order, for duplicate detection and samples */
function sectionText(section: ISiteSection): string {
  const itemText = (i: ISiteSectionItem) => [i.title, i.subtitle, ...i.text, i.price].filter(Boolean).join('\n');
  return [
    section.intro.eyebrow,
    section.intro.heading,
    ...section.intro.text,
    ...section.items.map(itemText),
    ...section.extra.map((e) => (e.type === 'text' ? e.text.join('\n') : e.items.map(itemText).join('\n'))),
  ]
    .filter(Boolean)
    .join('\n');
}

type Attached = { before: Map<number, string[]>; after: Map<number, string[]>; unplaced: string[] };

/**
 * Text outside every section goes to the nearer section when it sits between sections; text that
 * sits level with a section (beside it, or floating over it) cannot be placed and stays uncaptured.
 */
function attachRuns(ordered: RawSiteBlock[], runs: RawTextRun[]): Attached {
  const attached: Attached = { before: new Map(), after: new Map(), unplaced: [] };
  for (const run of runs) {
    const text = cleanText(run.text);
    if (!text) continue;
    const level = ordered.some((b) => run.top >= b.box.top && run.top < b.box.top + b.box.height);
    if (level || ordered.length === 0) {
      attached.unplaced.push(text);
      continue;
    }
    let nearest = 0;
    let nearestDistance = Infinity;
    ordered.forEach((b, i) => {
      const distance = run.top < b.box.top ? b.box.top - run.top : run.top - (b.box.top + b.box.height);
      if (distance < nearestDistance) {
        nearest = i;
        nearestDistance = distance;
      }
    });
    const side = run.top < ordered[nearest]!.box.top ? attached.before : attached.after;
    side.set(nearest, [...(side.get(nearest) ?? []), text]);
  }
  return attached;
}

function toSection(
  block: RawSiteBlock,
  index: number,
  raw: RawSiteSections,
  layoutBlocks: RawLayoutBlock[],
  attached: Attached,
): { section: ISiteSection; noise: string[] } {
  const flag: Cut = { truncated: false };
  const noise: string[] = [];
  const keep = (lines: string[]) =>
    lines.map(cleanText).filter((line) => {
      if (!line) return false;
      if (NOISE_LINE.test(line)) {
        noise.push(line);
        return false;
      }
      return true;
    });

  const extra: ISiteSection['extra'] = [];
  const pushText = (lines: string[]) => {
    const kept = texts(keep(lines), flag);
    if (kept.length) extra.push({ type: 'text', text: kept });
  };
  pushText(attached.before.get(index) ?? []);
  for (const entry of block.extra) {
    if (entry.type === 'text') pushText(entry.text);
    else {
      const items = cutList(entry.group.items.map((i) => toItem(i, flag)), L.items, flag);
      if (items.length) extra.push({ type: 'items', arrangement: groupArrangement(entry.group), items });
    }
  }
  pushText(attached.after.get(index) ?? []);

  const introLinks = toLinks(block.intro.links, flag);
  const role: ISiteSection['role'] =
    block.role !== 'content' ? block.role : block === raw.blocks[0] && block.box.top < raw.viewportHeight ? 'hero' : 'content';
  const layoutBlock = block.block !== undefined ? layoutBlocks[block.block] : undefined;
  let kind: SiteSectionKind;
  if (block.role === 'header') kind = 'other';
  else if (block.role === 'footer') kind = introLinks.some((l) => l.kind !== 'link' && l.kind !== 'cta') ? 'contact' : 'other';
  else kind = kindFromItems(block) ?? (layoutBlock ? classifyBlock(layoutBlock) : 'other');

  const arrangement = arrangementOf(block);
  const items = block.group ? cutList(block.group.items.map((i) => toItem(i, flag)), L.items, flag) : [];
  const firstImage = block.group?.items.find((i) => i.image)?.image;
  const itemStyle = block.itemStyle
    ? {
        background: toHex(block.itemStyle.background),
        radius: Math.max(0, Math.round(block.itemStyle.radius)),
        border: block.itemStyle.borderWidth >= 1,
        shadow: Boolean(block.itemStyle.boxShadow) && block.itemStyle.boxShadow !== 'none',
        imageShape: firstImage ? imageShape(firstImage.box.width, firstImage.box.height, firstImage.radius) : undefined,
        align: alignOf(block.itemStyle.textAlign),
      }
    : undefined;

  const section: ISiteSection = {
    index,
    role,
    kind,
    arrangement: arrangement.arrangement,
    columns: arrangement.columns,
    mediaSide: arrangement.mediaSide,
    intro: {
      eyebrow: cut(block.intro.eyebrow, L.labelChars, flag),
      heading: cut(block.intro.heading, L.labelChars, flag),
      headingLevel: block.intro.headingLevel,
      text: texts(keep(block.intro.text), flag),
      links: introLinks,
    },
    items,
    itemStyle,
    extra: cutList(extra, L.extra, flag),
    images: cutList(block.images.map(toImage).filter((i): i is ISiteImage => i !== undefined), L.images, flag),
    embeds: cutList(block.embeds.map((e) => ({ kind: e.kind, src: storableUrl(e.src) })), L.embeds, flag),
    style: {
      background: toHex(block.style.background),
      backgroundImage: storableUrl(block.backgroundImage),
      textColor: toHex(block.style.color),
      align: alignOf(block.style.textAlign),
      paddingY: Math.max(0, Math.round((block.style.paddingTop + block.style.paddingBottom) / 2)),
      fullBleed: block.contentBox ? block.contentBox.width >= raw.viewportWidth * 0.9 : undefined,
      split: arrangement.split,
    },
    truncated: undefined,
  };
  if (flag.truncated) section.truncated = true;
  return { section, noise };
}

export function toTypography(raw: RawTypography | undefined): ISiteTypography | undefined {
  if (!raw?.heading || !raw.body) return undefined;
  const family = (value: string) => cleanText(value.split(',')[0]?.replace(/["']/g, '')).slice(0, 100) || 'sans-serif';
  const clampInt = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
  const { heading, body, button } = raw;
  const lineHeight =
    body.lineHeight.endsWith('px') && body.size > 0 ? Math.round((parseFloat(body.lineHeight) / body.size) * 100) / 100 : undefined;
  return {
    heading: { family: family(heading.family), size: clampInt(heading.size, 1, 200), weight: clampInt(heading.weight, 100, 1000), uppercase: heading.transform === 'uppercase', color: toHex(heading.color) },
    body: { family: family(body.family), size: clampInt(body.size, 1, 200), weight: clampInt(body.weight, 100, 1000), lineHeight, color: toHex(body.color) },
    button: button
      ? { radius: clampInt(button.radius, 0, 1000), filled: toHex(button.background) !== undefined, uppercase: button.transform === 'uppercase', background: toHex(button.background), color: toHex(button.color) }
      : undefined,
  };
}

export type SiteSectionsReading = { sections: ISiteSections; error?: undefined } | { sections?: undefined; error: string };

/**
 * Turns the raw DOM facts into the page's sections, or says why they don't describe any. Every block
 * becomes a section or a `skipped` entry with its reason; nothing is dropped silently.
 */
export function readSiteSections(raw: RawSiteSections | undefined, layoutBlocks: RawLayoutBlock[] = []): SiteSectionsReading {
  if (!raw || !Array.isArray(raw.blocks) || !(raw.viewportWidth > 0)) {
    return { error: 'The page sections could not be collected' };
  }
  const ordered = [...(raw.header ? [raw.header] : []), ...raw.blocks, ...(raw.footer ? [raw.footer] : [])];
  const attached = attachRuns(ordered, raw.uncaptured ?? []);
  const sections: ISiteSection[] = [];
  const skipped: ISiteSections['skipped'] = [];
  const seen = new Set<string>();
  let captured = 0;
  let total = 0;

  ordered.forEach((block, index) => {
    const { section, noise } = toSection(block, index, raw, layoutBlocks, attached);
    const heading = section.intro.heading;
    const skip = (reason: ISiteSections['skipped'][number]['reason'], sample: string, chars: number) => {
      if (skipped.length < L.skipped) skipped.push({ index, reason, ...(heading ? { heading } : {}), sample: sample.slice(0, L.sampleChars) });
      captured += chars;
    };
    const text = sectionText(section);
    const chars = sectionChars(section);
    const noiseText = noise.join(' ');
    const hasMedia = section.images.length > 0 || section.embeds.length > 0 || section.style.backgroundImage !== undefined;
    if (!text && !hasMedia) {
      if (noise.length) skip('noise', noiseText, noiseText.length);
      else skip('empty', '', 0);
      return;
    }
    if (noise.length) skip('noise', noiseText, noiseText.length);
    if (text && seen.has(text)) return skip('duplicate', text, chars);
    if (text) seen.add(text);
    if (sections.length >= L.sections || total + chars > L.totalChars) return skip('cap', text, chars);
    sections.push(section);
    total += chars;
    captured += chars;
  });

  if (!sections.some((s) => s.role === 'hero' || s.role === 'content')) {
    return { error: `No content sections on the page (${skipped.length} skipped)` };
  }

  const pageChars = Math.max(0, Math.round(raw.pageChars));
  const result: ISiteSections = {
    sections,
    typography: toTypography(raw.typography),
    skipped,
    coverage: {
      pageChars,
      capturedChars: captured,
      ratio: pageChars > 0 ? Math.min(1, Math.round((captured / pageChars) * 1000) / 1000) : 0,
      uncaptured: attached.unplaced.slice(0, L.uncaptured).map((t) => t.slice(0, L.sampleChars)),
    },
  };
  // JSON drops the unset optional fields, which MongoDB would otherwise store as null
  const parsed = SiteSectionsSchema.safeParse(JSON.parse(JSON.stringify(result)));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `The sections failed validation at ${issue?.path.join('.')}: ${issue?.message}`.slice(0, 300) };
  }
  return { sections: parsed.data };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.service.spec.ts`
Expected: PASS. If the coverage test's arithmetic is off by the heading of the duplicate, recount by hand from `sectionChars` and fix the expectation, not the code, only if the code matches the spec's definition (§5.6: kept text plus the full text of what was skipped).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add apps/workers/src/services/site-sections.service.ts apps/workers/src/services/__tests__/site-sections.service.spec.ts
git commit -m "feat(REV-109): readSiteSections: skip with reasons, coverage, caps, validation"
```

---

### Task 6: In-page reader — blocks, header, footer, text accounting

**Files:**
- Modify: `apps/workers/src/services/site-sections.page.ts`
- Create: `apps/workers/src/services/__tests__/site-sections.page.spec.ts`

**Interfaces:**
- Consumes: `data-revamp-block` tags (Task 3), `readSiteSections` (Task 5).
- Produces: `collectSiteSectionsInPage(): RawSiteSections`. In this task item groups are not read yet (`pickGroups` returns `[]`); Task 8 replaces `pickGroups` and `readItem`.

- [ ] **Step 1: Write the failing Chromium tests** — create `apps/workers/src/services/__tests__/site-sections.page.spec.ts`:

```ts
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EVALUATE_NAME_SHIM } from '../browser.service.js';
import { collectSiteLayoutInPage } from '../site-layout.service.js';
import { collectSiteSectionsInPage } from '../site-sections.page.js';
import { readSiteSections } from '../site-sections.service.js';

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.warn('[site-sections.spec] Chromium unavailable, skipping real-browser fixtures:', err);
}

afterAll(async () => {
  await browser?.close();
});

// 1x1 PNG served for every https://img.test/ image, so images load and report currentSrc
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export const pageOf = (body: string, css = '') => `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<base href="https://falco.test/">
<style>body{margin:0;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#333}
section{padding:60px 40px;min-height:200px;box-sizing:border-box} h1,h2{font-family:Georgia,serif;color:#111} h2{font-size:32px}
${css}</style></head><body>${body}</body></html>`;

export const HEADER = `<header style="height:90px;display:flex;align-items:center;gap:20px;padding:0 40px">
  <img src="https://img.test/logo.png" alt="Falco-Dent" width="120" height="40">
  <nav style="display:flex;gap:16px"><a href="/">Start</a><a href="/oferta">Oferta</a><a href="/kontakt">Kontakt</a></nav>
  <a href="tel:+48123456789" style="background:#0a7;color:#fff;padding:10px 20px">Zadzwoń</a>
</header>`;

export const HERO = `<section style="min-height:500px;background:#123;color:#fff"><h1>Gabinet Stomatologiczny Falco-Dent</h1>
  <p>Nowoczesna stomatologia w centrum Krakowa od ponad dwudziestu lat.</p></section>`;

export const FOOTER = `<footer style="padding:40px;background:#222;color:#eee">
  <p>ul. Długa 5, 31-147 Kraków</p><p>Pon–Pt 9:00–18:00, Sob 9:00–13:00</p>
  <p><a href="mailto:recepcja@falcodent.pl">recepcja@falcodent.pl</a></p>
  <ul><li><a href="/polityka-prywatnosci">Polityka prywatności</a></li><li><a href="/regulamin">Regulamin</a></li></ul>
</footer>`;

describe.skipIf(!browser)('collectSiteSectionsInPage (real Chromium, REV-109)', () => {
  let context: BrowserContext;
  let page: Page;

  beforeEach(async () => {
    context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript({ content: EVALUATE_NAME_SHIM });
    await context.route(/^https?:\/\//, (route) =>
      route.request().url().startsWith('https://img.test/')
        ? route.fulfill({ contentType: 'image/png', body: TINY_PNG })
        : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }),
    );
    page = await context.newPage();
  });

  afterEach(async () => {
    await context.close();
  });

  const sectionsOf = async (html: string) => {
    await page.setContent(html, { waitUntil: 'load' });
    const layout = await page.evaluate(collectSiteLayoutInPage);
    const raw = await page.evaluate(collectSiteSectionsInPage);
    const reading = readSiteSections(raw, layout.blocks);
    if (reading.error) throw new Error(reading.error);
    return reading.sections!;
  };

  const expectCovered = (result: { coverage: { ratio: number; uncaptured: string[] } }) => {
    expect(result.coverage.ratio, `uncaptured: ${JSON.stringify(result.coverage.uncaptured)}`).toBeGreaterThanOrEqual(0.95);
  };

  it('reads the header with its logo, menu and call button, and the footer with address, hours and links', async () => {
    const result = await sectionsOf(pageOf(`${HEADER}${HERO}
      <section><h2>O gabinecie</h2><p>Leczymy dzieci i dorosłych, z pełną diagnostyką na miejscu.</p></section>${FOOTER}`));
    expect(result.sections.map((s) => s.role)).toEqual(['header', 'hero', 'content', 'footer']);
    const [header, hero, about, footer] = result.sections;
    expect(header!.images[0]!.src).toBe('https://img.test/logo.png');
    expect(header!.intro.links.map((l) => [l.label, l.kind])).toEqual([
      ['Start', 'link'], ['Oferta', 'link'], ['Kontakt', 'link'], ['Zadzwoń', 'phone'],
    ]);
    expect(header!.intro.links[1]!.href).toBe('https://falco.test/oferta');
    expect(hero!.intro).toMatchObject({ heading: 'Gabinet Stomatologiczny Falco-Dent', headingLevel: 1 });
    expect(about!.intro.text).toEqual(['Leczymy dzieci i dorosłych, z pełną diagnostyką na miejscu.']);
    expect(footer!.kind).toBe('contact');
    expect(footer!.extra).toEqual([{ type: 'text', text: ['ul. Długa 5, 31-147 Kraków', 'Pon–Pt 9:00–18:00, Sob 9:00–13:00'] }]);
    expect(footer!.intro.links.map((l) => l.label)).toEqual(['recepcja@falcodent.pl', 'Polityka prywatności', 'Regulamin']);
    expectCovered(result);
  });

  it('attaches a stray paragraph between two blocks to the nearer section', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>
      <p style="margin:0 40px 300px">Przyjmujemy również w soboty po wcześniejszym umówieniu.</p>
      <section><h2>Kontakt</h2><p>Zadzwoń lub napisz.</p></section>`));
    const services = result.sections.find((s) => s.intro.heading === 'Nasze usługi')!;
    expect(services.extra).toEqual([{ type: 'text', text: ['Przyjmujemy również w soboty po wcześniejszym umówieniu.'] }]);
    expect(result.coverage.uncaptured).toEqual([]);
    expectCovered(result);
  });

  it('leaves out the cookie banner and records the GDPR clause as noise', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>
      <div class="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;background:#000;color:#fff">
        Ta strona używa plików cookies. <button>Akceptuję</button></div>
      <footer style="padding:40px"><p>ul. Długa 5, Kraków</p>
        <p>Administratorem Twoich danych osobowych jest Falco-Dent sp. z o.o.</p>
        <p>© 2024 Falco-Dent. Wszelkie prawa zastrzeżone.</p></footer>`));
    const all = JSON.stringify(result.sections);
    expect(all).not.toContain('cookies');
    expect(all).not.toContain('Administratorem');
    expect(all).toContain('ul. Długa 5, Kraków');
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: 'noise', sample: expect.stringContaining('Administratorem Twoich danych') }),
    ]);
    expectCovered(result);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts`
Expected: FAIL (`collectSiteSectionsInPage` is not exported).

- [ ] **Step 3: Implement the in-page reader** — append to `site-sections.page.ts`. Everything below lives inside the function body; nothing references module scope.

```ts
export function collectSiteSectionsInPage(): RawSiteSections {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const MAX_ITEMS = 80;
  const MAX_RUNS = 200;
  const EXCLUDED = 'script, style, noscript, template, svg, .swiper-slide-duplicate, .slick-cloned';
  const CONTENT = 'h1, h2, h3, h4, h5, h6, p, img, video, li, a, button, blockquote, iframe, figure, input, textarea';
  const MAP_SRC = /google\.[a-z.]+\/maps|maps\.google|openstreetmap|mapy\.|yandex\.[a-z]+\/(map-widget|maps)/i;
  const VIDEO_SRC = /youtube\.com|youtu\.be|youtube-nocookie|vimeo\.com|wistia/i;

  const clean = (value: string | null | undefined): string => (value || '').replace(/­/g, '').replace(/\s+/g, ' ').trim();
  const classOf = (el: Element): string => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
  const boxOf = (el: Element): RawBox => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY), left: Math.round(r.left + window.scrollX), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const unionOf = (boxes: RawBox[]): RawBox | undefined => {
    const drawn = boxes.filter((b) => b.width > 0 && b.height > 0);
    if (drawn.length === 0) return undefined;
    const top = Math.min(...drawn.map((b) => b.top));
    const left = Math.min(...drawn.map((b) => b.left));
    const bottom = Math.max(...drawn.map((b) => b.top + b.height));
    const right = Math.max(...drawn.map((b) => b.left + b.width));
    return { top, left, width: right - left, height: bottom - top };
  };
  const shown = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const absolute = (value: string | null | undefined): string | undefined => {
    const trimmed = (value || '').trim();
    if (!trimmed || /^(data:|javascript:|#)/i.test(trimmed)) return undefined;
    try {
      return new URL(trimmed, document.baseURI).href;
    } catch {
      return undefined;
    }
  };
  const radiusOf = (el: Element, width: number): number => {
    const value = window.getComputedStyle(el).borderTopLeftRadius;
    return value.endsWith('%') ? (parseFloat(value) / 100) * width : parseFloat(value) || 0;
  };
  const OPAQUE = (color: string) => {
    const match = color.match(/rgba?\(([^)]+)\)/);
    if (!match) return false;
    const parts = (match[1] ?? '').split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || Number(parts[3]) >= 0.5;
  };
  const backgroundOf = (el: Element | null): string => {
    for (let node = el; node; node = node.parentElement) {
      const color = window.getComputedStyle(node).backgroundColor;
      if (OPAQUE(color)) return color;
    }
    return 'rgb(255, 255, 255)';
  };
  // Copied from site-content.extractor.ts (in-page code cannot import)
  const inBoilerplate = (el: Element): boolean => {
    const match = el.closest('[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i], script, style, noscript');
    if (!match || match === document.body || match === document.documentElement) return false;
    return !match.querySelector('h1, main, article');
  };
  const excluded = (el: Element): boolean => el.closest(EXCLUDED) !== null || inBoilerplate(el);
  const displays = new Map<Element, string>();
  const isBlock = (el: Element): boolean => {
    let display = displays.get(el);
    if (display === undefined) {
      display = window.getComputedStyle(el).display;
      displays.set(el, display);
    }
    return !display.startsWith('inline') && display !== 'contents';
  };
  const blockOf = (el: Element, root: Element): Element => {
    let node: Element | null = el;
    while (node && node !== root && !isBlock(node)) node = node.parentElement;
    return node ?? root;
  };

  /** Text of `root` as one string per nearest block-level ancestor, in page order; text inside `skip` is left out */
  const runsOf = (root: Element, skip: Element[]): Array<{ el: Element; text: string }> => {
    const runs = new Map<Element, string[]>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue || !node.nodeValue.trim()) continue;
      if (excluded(parent) || skip.some((el) => el.contains(parent))) continue;
      const block = blockOf(parent, root);
      const parts = runs.get(block);
      if (parts) parts.push(node.nodeValue);
      else runs.set(block, [node.nodeValue]);
    }
    return Array.from(runs, ([el, parts]) => ({ el, text: clean(parts.join(' ')) })).filter((run) => run.text.length > 0);
  };

  const isButton = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    const padded = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) >= 16;
    const bordered = style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) >= 1;
    return (padded && (OPAQUE(style.backgroundColor) || bordered)) || /\bbtn\b|button/i.test(classOf(el));
  };
  const linkOf = (el: Element): RawSiteLink | undefined => {
    const href = absolute(el.getAttribute('href'));
    const label = clean(el.textContent) || clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'));
    return href && label ? { label, href, button: isButton(el) } : undefined;
  };
  /**
   * A block whose own text (not its nested blocks') is all inside links: a menu, a button row, a call
   * to action placed straight in a section. Its links are kept as links, not repeated as text.
   */
  const onlyLinks = (block: Element, root: Element): boolean => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let any = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue?.trim() || excluded(parent) || blockOf(parent, root) !== block) continue;
      if (!parent.closest('a[href]')) return false;
      any = true;
    }
    return any;
  };
  const linksIn = (root: Element, skip: Element[]): { links: RawSiteLink[]; standalone: Element[] } => {
    const anchors = Array.from(root.querySelectorAll('a[href]')).filter((a) => !excluded(a) && !skip.some((el) => el.contains(a)));
    const links = anchors.map(linkOf).filter((link): link is RawSiteLink => link !== undefined);
    const standalone = anchors.filter((a) => !a.querySelector('p, h1, h2, h3, h4, h5, h6, li, img') && onlyLinks(blockOf(a, root), root));
    return { links, standalone };
  };

  const imageOf = (el: Element): RawSiteImage | undefined => {
    const img = el as HTMLImageElement;
    const srcset = (img.getAttribute('data-srcset') || img.getAttribute('srcset') || '').split(',')[0]?.trim().split(/\s+/)[0];
    const src = [img.currentSrc, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), srcset, img.getAttribute('src')]
      .map(absolute)
      .find((value) => value !== undefined);
    if (!src) return undefined;
    const box = boxOf(img);
    const parent = img.parentElement;
    const parentRadius = parent && window.getComputedStyle(parent).overflow === 'hidden' ? radiusOf(parent, boxOf(parent).width) : 0;
    return { src, alt: clean(img.getAttribute('alt')), box, radius: Math.round(Math.max(radiusOf(img, box.width), parentRadius)) };
  };
  const imagesIn = (root: Element, skip: Element[]): RawSiteImage[] =>
    Array.from(root.querySelectorAll('img'))
      .filter((img) => !excluded(img) && !skip.some((el) => el.contains(img)))
      .map(imageOf)
      .filter((image): image is RawSiteImage => image !== undefined && (image.box.width === 0 || image.box.width >= 40 || image.box.height >= 40))
      .slice(0, 40);

  const embedsIn = (root: Element): RawSiteEmbed[] => {
    const SELECTOR = 'iframe, video, form, .leaflet-container, .gm-style';
    const embeds: RawSiteEmbed[] = [];
    for (const el of Array.from(root.querySelectorAll(SELECTOR))) {
      if (excluded(el) || (el.parentElement && el.parentElement.closest(SELECTOR) && root.contains(el.parentElement.closest(SELECTOR)))) continue;
      if (el.tagName === 'FORM') {
        const action = absolute(el.getAttribute('action'));
        embeds.push({ kind: 'form', ...(action ? { src: action } : {}), box: boxOf(el) });
        continue;
      }
      const src = absolute(el.getAttribute('src') || el.getAttribute('data-src') || el.querySelector('source')?.getAttribute('src'));
      let kind: RawSiteEmbed['kind'];
      if (el.tagName === 'IFRAME') kind = src && MAP_SRC.test(src) ? 'map' : src && VIDEO_SRC.test(src) ? 'video' : 'widget';
      else if (el.tagName === 'VIDEO') kind = 'video';
      else kind = 'map';
      embeds.push({ kind, ...(src ? { src } : {}), box: boxOf(el) });
    }
    return embeds.slice(0, 20);
  };

  const backgroundImageOf = (root: Element): string | undefined => {
    const rootBox = root.getBoundingClientRect();
    const rootArea = rootBox.width * rootBox.height;
    for (const el of [root, ...Array.from(root.querySelectorAll('*')).slice(0, 300)]) {
      const match = window.getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (!match) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < rootArea * 0.6) continue;
      const src = absolute(match[1]);
      if (src) return src;
    }
    return undefined;
  };

  // Item groups: filled in by Task 8
  type Found = { members: Element[]; covers: Element[]; markup?: RawGroupMarkup; weight: number; titles?: string[] };
  const pickGroups = (_root: Element, _skip: Element[]): Found[] => [];
  const readItem = (member: Element): RawSiteItem => ({ text: runsOf(member, []).map((r) => r.text), links: [], icon: false, box: boxOf(member) });
  const readGroup = (found: Found): RawItemGroup => ({
    ...(found.markup ? { markup: found.markup } : {}),
    items: found.members.slice(0, MAX_ITEMS).map((member) => readItem(member)),
  });
  const cardStyle = (_member: Element): RawSiteBlock['itemStyle'] => undefined;

  const readBlock = (root: Element, role: RawSiteBlock['role'], index: number | undefined, skip: Element[]): RawSiteBlock => {
    const groups = role === 'content' ? pickGroups(root, skip) : [];
    const [main, second] = groups;
    const hidden = [...skip, ...groups.flatMap((g) => g.covers)];
    const { links, standalone } = linksIn(root, hidden);
    const firstMember = main?.members[0];
    const precedes = (el: Element) => !firstMember || Boolean(el.compareDocumentPosition(firstMember) & Node.DOCUMENT_POSITION_FOLLOWING);
    const headingEl =
      role === 'content'
        ? Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(
            (h) => !hidden.some((el) => el.contains(h)) && !excluded(h) && precedes(h) && clean(h.textContent),
          )
        : undefined;
    const runs = runsOf(root, [...hidden, ...standalone, ...(headingEl ? [headingEl] : [])]);

    // Intro: what comes before the items; header and footer keep all their text as extra
    const introRuns = role === 'content' ? runs.filter((run) => precedes(run.el)) : [];
    let eyebrow: string | undefined;
    const firstRun = introRuns[0];
    if (headingEl && firstRun && firstRun.text.length <= 60 && firstRun.el.compareDocumentPosition(headingEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
      eyebrow = firstRun.text;
      introRuns.shift();
    }
    const restRuns = runs.filter((run) => !introRuns.includes(run) && run.text !== eyebrow);

    const extra: RawSiteBlock['extra'] = [];
    const secondAt = second?.members[0];
    let secondPlaced = second === undefined;
    for (const run of restRuns) {
      if (!secondPlaced && secondAt && run.el.compareDocumentPosition(secondAt) & Node.DOCUMENT_POSITION_PRECEDING) {
        extra.push({ type: 'items', group: readGroup(second!) });
        secondPlaced = true;
      }
      const last = extra[extra.length - 1];
      if (last && last.type === 'text') last.text.push(run.text);
      else extra.push({ type: 'text', text: [run.text] });
    }
    if (!secondPlaced && second) extra.push({ type: 'items', group: readGroup(second) });

    const contentBox = unionOf(
      Array.from(root.querySelectorAll(CONTENT)).slice(0, 400).filter((el) => !excluded(el)).map(boxOf),
    );
    const box = boxOf(root);
    const styleEl = headingEl ?? root;
    const styleOf = window.getComputedStyle(styleEl);
    const headingLevel = headingEl ? Number(headingEl.tagName.slice(1)) : undefined;
    const backgroundImage = backgroundImageOf(root);
    const itemStyle = firstMember ? cardStyle(firstMember) : undefined;
    const introBox = unionOf([...(headingEl ? [boxOf(headingEl)] : []), ...introRuns.map((run) => boxOf(run.el))]);

    return {
      role,
      ...(index !== undefined ? { block: index } : {}),
      box,
      ...(introBox ? { introBox } : {}),
      ...(contentBox ? { contentBox } : {}),
      intro: {
        ...(eyebrow ? { eyebrow } : {}),
        ...(headingEl ? { heading: clean(headingEl.textContent), headingLevel } : {}),
        text: introRuns.map((run) => run.text),
        links,
      },
      ...(main ? { group: readGroup(main) } : {}),
      extra,
      images: imagesIn(root, hidden),
      ...(backgroundImage ? { backgroundImage } : {}),
      embeds: embedsIn(root),
      style: {
        background: backgroundOf(root),
        color: styleOf.color,
        textAlign: styleOf.textAlign,
        paddingTop: contentBox ? Math.max(0, contentBox.top - box.top) : 0,
        paddingBottom: contentBox ? Math.max(0, box.top + box.height - (contentBox.top + contentBox.height)) : 0,
      },
      ...(itemStyle ? { itemStyle } : {}),
    };
  };

  // The roots: the header, the blocks the layout walk tagged, the footer
  const blocks = Array.from(document.querySelectorAll('[data-revamp-block]')).sort(
    (a, b) => Number(a.getAttribute('data-revamp-block')) - Number(b.getAttribute('data-revamp-block')),
  );
  // Same pick as REV-104's header reading; a "header" that wraps content blocks is not the header
  const headerCandidate =
    Array.from(document.querySelectorAll('header, [role="banner"], #header, .header, .site-header, .navbar')).find(
      (node) => shown(node) && node.getBoundingClientRect().top < 200,
    ) ?? Array.from(document.querySelectorAll('nav')).find((node) => shown(node) && node.getBoundingClientRect().top < 200);
  const headerEl = headerCandidate && !blocks.some((b) => headerCandidate.contains(b)) ? headerCandidate : undefined;
  const footerCandidates = Array.from(document.querySelectorAll('footer, [role="contentinfo"], #footer, .footer, .site-footer')).filter(
    (el) => shown(el) && !el.closest('[data-revamp-block]') && !blocks.some((b) => el.contains(b)) && !(headerEl && headerEl.contains(el)),
  );
  const footerEl = footerCandidates.filter((el) => !footerCandidates.some((other) => other !== el && other.contains(el))).pop();
  const chrome = [headerEl, footerEl].filter((el): el is Element => el !== undefined);

  // Site-wide typography
  const firstIn = (roots: Element[], selector: string, test: (el: Element) => boolean) =>
    roots.flatMap((root) => Array.from(root.querySelectorAll(selector))).find((el) => shown(el) && !excluded(el) && test(el));
  const fontOf = (el: Element) => {
    const s = window.getComputedStyle(el);
    return { family: s.fontFamily, size: parseFloat(s.fontSize) || 0, weight: Number(s.fontWeight) || 400, transform: s.textTransform, color: s.color, lineHeight: s.lineHeight };
  };
  const headingSample = firstIn(blocks, 'h2', (el) => clean(el.textContent).length > 0) ?? firstIn(blocks, 'h1', (el) => clean(el.textContent).length > 0);
  const bodySample = firstIn(blocks, 'p', (el) => clean(el.textContent).length >= 40);
  const buttonSample = firstIn([...chrome, ...blocks], 'a[href], button', (el) => clean(el.textContent).length > 0 && isButton(el));
  const typography: RawTypography = {};
  if (headingSample) {
    const { family, size, weight, transform, color } = fontOf(headingSample);
    typography.heading = { family, size, weight, transform, color };
  }
  if (bodySample) {
    const { family, size, weight, lineHeight, color } = fontOf(bodySample);
    typography.body = { family, size, weight, lineHeight, color };
  }
  if (buttonSample) {
    const s = window.getComputedStyle(buttonSample);
    typography.button = {
      radius: radiusOf(buttonSample, boxOf(buttonSample).width),
      background: s.backgroundColor,
      borderWidth: s.borderTopStyle === 'none' ? 0 : parseFloat(s.borderTopWidth) || 0,
      transform: s.textTransform,
      color: s.color,
    };
  }

  // Text accounting: all page text, split the same way the sections are read
  const roots = [...chrome, ...blocks];
  const floating = (el: Element): boolean => {
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      if (window.getComputedStyle(node).position === 'fixed') return true;
    }
    return false;
  };
  let pageChars = 0;
  const uncaptured: RawTextRun[] = [];
  for (const run of runsOf(document.body, [])) {
    // Hidden text counts inside a section (collapsed answers, tabs, slides), not elsewhere
    if (roots.some((root) => root.contains(run.el))) {
      pageChars += run.text.length;
      continue;
    }
    if (floating(run.el) || !shown(run.el)) continue;
    pageChars += run.text.length;
    if (uncaptured.length < MAX_RUNS) uncaptured.push({ text: run.text.slice(0, 300), top: boxOf(run.el).top });
  }

  return {
    viewportWidth: vw,
    viewportHeight: vh,
    ...(headerEl ? { header: readBlock(headerEl, 'header', undefined, []) } : {}),
    blocks: blocks.map((el) => readBlock(el, 'content', Number(el.getAttribute('data-revamp-block')), chrome)),
    ...(footerEl ? { footer: readBlock(footerEl, 'footer', undefined, []) } : {}),
    typography,
    pageChars,
    uncaptured,
  };
}
```

`noUnusedLocals` is on (tsconfig.base.json), so the constants only item groups need (`MAX_SCAN`, `SLIDER`, `PRICE`) are added in Task 8, not here. The stubs' unused parameters are prefixed with `_`, which `noUnusedParameters` allows.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts`
Expected: PASS. If a coverage assertion fails, the message lists the uncaptured runs: fix the reader (a root not found, a run split differently), not the threshold.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, no new warnings.

```bash
git add apps/workers/src/services/site-sections.page.ts apps/workers/src/services/__tests__/site-sections.page.spec.ts
git commit -m "feat(REV-109): in-page section reader: header, blocks, footer, text accounting"
```

---

### Task 7: Header nested in the first block (Review Focus 1)

**Files:**
- Modify: `apps/workers/src/services/__tests__/site-sections.page.spec.ts`
- Modify (only if the test fails): `apps/workers/src/services/site-sections.page.ts`

**Interfaces:**
- Consumes: Task 6 fixtures (`pageOf`, `HERO`), `sectionsOf`.

- [ ] **Step 1: Write the test** — inside the Chromium `describe`:

```ts
  it('reads a header nested in the first block once, in the header section', async () => {
    const result = await sectionsOf(pageOf(`<div class="hero-wrap" style="min-height:700px;background:#123;color:#fff">
        <header style="height:90px;display:flex;gap:16px;padding:0 40px"><a href="/">Start</a><a href="/oferta">Oferta</a><a href="/kontakt">Kontakt</a></header>
        <h1 style="margin:120px 40px 0">Gabinet Falco-Dent</h1><p style="margin:0 40px">Stomatologia dla całej rodziny w Krakowie.</p></div>
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>`));
    const header = result.sections.find((s) => s.role === 'header')!;
    const hero = result.sections.find((s) => s.role === 'hero')!;
    expect(header.intro.links.map((l) => l.label)).toEqual(['Start', 'Oferta', 'Kontakt']);
    expect(JSON.stringify(hero)).not.toContain('Oferta');
    expect(hero.intro.heading).toBe('Gabinet Falco-Dent');
    expectCovered(result);
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts -t "nested"`
Expected: PASS with Task 6's code (the header is read on its own and passed as `skip` to every block). If it fails because the layout walk made the whole wrapper one block that *contains* the header, `headerEl` is still valid (it contains no block); check `chrome` is passed to `readBlock` for content blocks and that `runsOf`/`linksIn`/`imagesIn` honour `skip`.

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/services/__tests__/site-sections.page.spec.ts apps/workers/src/services/site-sections.page.ts
git commit -m "test(REV-109): a header nested in the first block is read once"
```

---

### Task 8: In-page item groups and item fields

**Files:**
- Modify: `apps/workers/src/services/site-sections.page.ts` (replace the `pickGroups`, `readItem`, `cardStyle` stubs from Task 6)
- Modify: `apps/workers/src/services/__tests__/site-sections.page.spec.ts`

**Interfaces:**
- Consumes: Task 6 helpers inside the function (`clean`, `classOf`, `boxOf`, `runsOf`, `linksIn`, `imageOf`, `excluded`, `OPAQUE`, `radiusOf`, `SLIDER`, `PRICE`, `MAX_SCAN`).
- Produces: `RawSiteBlock.group`, `RawSiteBlock.extra[{type:'items'}]`, `RawSiteBlock.itemStyle` filled for content blocks.

- [ ] **Step 1: Write the failing fixtures** — inside the Chromium `describe`:

```ts
  it('reads an Elementor-style card grid in nested wrappers', async () => {
    const card = (name: string, i: number) => `
      <div class="elementor-column elementor-element elementor-element-a${i}f3" style="flex:1"><div class="elementor-widget-wrap">
        <div class="elementor-widget elementor-widget-image-box"><div class="elementor-widget-container" style="background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);padding:16px">
          <img src="https://img.test/s${i}.png" alt="${name}" width="300" height="200" style="display:block;width:100%;height:auto">
          <h3>${name}</h3><p>Pełna diagnostyka, plan leczenia i opieka po zabiegu ${name.toLowerCase()} w naszym gabinecie.</p><p>od ${150 + i * 50} zł</p>
        </div></div>
      </div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section class="elementor-section elementor-element-3f2a1b" style="background:#f5f7fa">
        <div class="elementor-container"><div class="elementor-column"><div class="elementor-widget-wrap"><div class="elementor-widget"><div class="elementor-widget-container"><h2>Nasze usługi</h2></div></div></div></div></div>
        <div class="elementor-container" style="display:flex;gap:24px">${['Implanty', 'Ortodoncja', 'Wybielanie'].map(card).join('')}</div>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasze usługi')!;
    expect(s.kind).toBe('services');
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(3);
    expect(s.items.map((i) => [i.title, i.price])).toEqual([['Implanty', 'od 150 zł'], ['Ortodoncja', 'od 200 zł'], ['Wybielanie', 'od 250 zł']]);
    expect(s.items[0]!.text).toEqual(['Pełna diagnostyka, plan leczenia i opieka po zabiegu implanty w naszym gabinecie.']);
    expect(s.items[0]!.image!.src).toBe('https://img.test/s0.png');
    expect(s.itemStyle).toMatchObject({ background: '#ffffff', radius: 12, shadow: true });
    expect(s.style.background).toBe('#f5f7fa');
    expectCovered(result);
  });

  it('reads a Divi-style team with round portraits', async () => {
    const people = [
      ['dr Anna Nowak', 'Ortodonta'], ['dr Jan Kowalski', 'Chirurg stomatolog'], ['lek. Ewa Wiśniewska', 'Endodonta'],
      ['dr Piotr Zieliński', 'Implantolog'], ['Maria Lewandowska', 'Higienistka'], ['Karolina Wójcik', 'Asystentka'],
    ];
    const member = ([name, role]: string[], i: number) => `
      <div class="et_pb_column et_pb_column_1_3" style="width:30%;text-align:center"><div class="et_pb_module et_pb_team_member et_pb_team_member_${i}">
        <div class="et_pb_team_member_image" style="border-radius:50%;overflow:hidden;width:160px;height:160px;margin:0 auto"><img src="https://img.test/p${i}.jpg" alt="${name}" width="160" height="160" style="display:block"></div>
        <div class="et_pb_team_member_description"><h4 class="et_pb_module_header">${name}</h4><p class="et_pb_member_position">${role}</p>
          <div><p>Absolwentka Uniwersytetu Jagiellońskiego, pracuje z pacjentami od lat.</p></div></div>
      </div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <div class="et_pb_section et_pb_section_3" style="padding:60px 40px">
        <div class="et_pb_row"><div class="et_pb_column"><div class="et_pb_text"><div class="et_pb_text_inner"><h2>Poznaj nas</h2></div></div></div></div>
        <div class="et_pb_row" style="display:flex;flex-wrap:wrap;gap:20px">${people.map(member).join('')}</div>
      </div>`));
    const s = result.sections.find((x) => x.intro.heading === 'Poznaj nas')!;
    expect(s.kind).toBe('team');
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(3);
    expect(s.items).toHaveLength(6);
    expect(s.items[0]).toMatchObject({ title: 'dr Anna Nowak', subtitle: 'Ortodonta', text: ['Absolwentka Uniwersytetu Jagiellońskiego, pracuje z pacjentami od lat.'] });
    expect(s.items[0]!.image!.src).toBe('https://img.test/p0.jpg');
    expect(s.itemStyle!.imageShape).toBe('round');
    expect(s.itemStyle!.align).toBe('center');
    expectCovered(result);
  });

  it('reads an FAQ accordion with collapsed answers', async () => {
    const qa = [
      ['Czy leczenie kanałowe boli?', 'Zabieg wykonujemy w znieczuleniu, więc jest bezbolesny.'],
      ['Ile trwa wizyta kontrolna?', 'Około trzydziestu minut, razem z przeglądem.'],
      ['Czy przyjmujecie dzieci?', 'Tak, od trzeciego roku życia.'],
    ];
    const result = await sectionsOf(pageOf(`${HERO}
      <section id="faq"><h2>Najczęściej zadawane pytania</h2><div class="accordion">
        ${qa.map(([q, a]) => `<div class="accordion-item"><button class="accordion-button" aria-expanded="false">${q}</button><div class="accordion-body" style="display:none"><p>${a}</p></div></div>`).join('')}
      </div></section>`));
    const s = result.sections.find((x) => x.kind === 'faq')!;
    expect(s.arrangement).toBe('accordion');
    expect(s.items.map((i) => [i.title, i.text])).toEqual(qa.map(([q, a]) => [q, [a]]));
    expectCovered(result);
  });

  it('reads a details-based accordion too', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Pytania</h2>
        <details><summary>Czy są raty?</summary><p>Tak, raty 0% do dwunastu miesięcy.</p></details>
        <details><summary>Czy jest parking?</summary><p>Tak, bezpłatny, przy wejściu.</p></details>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Pytania')!;
    expect(s.arrangement).toBe('accordion');
    expect(s.items.map((i) => i.title)).toEqual(['Czy są raty?', 'Czy jest parking?']);
  });

  it('reads a swiper slider without its cloned slides', async () => {
    const slide = (quote: string, name: string, cls = 'swiper-slide') => `
      <div class="${cls}" style="width:400px;flex-shrink:0"><div class="stars" aria-label="Ocena 5/5"><span class="star"></span><span class="star"></span><span class="star"></span><span class="star"></span><span class="star"></span></div>
      <blockquote>${quote}</blockquote><p class="author">${name}</p></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section style="overflow:hidden"><h2>Opinie pacjentów</h2><div class="swiper"><div class="swiper-wrapper" style="display:flex">
        ${slide('Klon slajdu, nie opinia.', 'Klon', 'swiper-slide swiper-slide-duplicate')}
        ${slide('Bezbolesne leczenie i miła obsługa.', 'Anna K.')}${slide('Polecam każdemu, świetni lekarze.', 'Tomasz W.')}${slide('Szybka wizyta, bez kolejek.', 'Ewa M.')}
        ${slide('Klon slajdu, nie opinia.', 'Klon', 'swiper-slide swiper-slide-duplicate')}
      </div></div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Opinie pacjentów')!;
    expect(s.kind).toBe('reviews');
    expect(s.arrangement).toBe('slider');
    expect(s.items.map((i) => [i.title, i.text, i.rating])).toEqual([
      ['Anna K.', ['Bezbolesne leczenie i miła obsługa.'], 5],
      ['Tomasz W.', ['Polecam każdemu, świetni lekarze.'], 5],
      ['Ewa M.', ['Szybka wizyta, bez kolejek.'], 5],
    ]);
    expect(JSON.stringify(result)).not.toContain('Klon');
    expectCovered(result);
  });

  it('reads a "why us" icon list as features', async () => {
    const point = (title: string, text: string) => `<li><svg width="32" height="32"><circle cx="16" cy="16" r="16"/></svg><h3>${title}</h3><p>${text}</p></li>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Co nas wyróżnia</h2><ul style="display:grid;grid-template-columns:repeat(2,1fr);list-style:none;padding:0">
        ${point('Doświadczenie', 'Ponad 20 lat praktyki.')}${point('Nowoczesny sprzęt', 'Mikroskop i tomograf na miejscu.')}
        ${point('Raty 0%', 'Leczenie na wygodne raty.')}${point('Bez bólu', 'Znieczulenie komputerowe.')}
      </ul></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Co nas wyróżnia')!;
    expect(s.kind).toBe('features');
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(2);
    expect(s.items.map((i) => i.title)).toEqual(['Doświadczenie', 'Nowoczesny sprzęt', 'Raty 0%', 'Bez bólu']);
    expectCovered(result);
  });

  it('keeps a lazy image by its data-src, never the placeholder', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Gabinet</h2><p>Nowe wnętrze od 2023 roku, z osobną salą zabiegową.</p>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://img.test/lazy.jpg" alt="Wnętrze" width="600" height="400"></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Gabinet')!;
    expect(s.images).toEqual([{ src: 'https://img.test/lazy.jpg', alt: 'Wnętrze', width: 600, height: 400 }]);
  });

  it('reads tabs with their panels, hidden ones included', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Cennik</h2><div role="tablist"><button role="tab" aria-controls="t1">Protetyka</button><button role="tab" aria-controls="t2">Chirurgia</button></div>
        <div id="t1" role="tabpanel"><p>Korona porcelanowa od 1200 zł</p></div>
        <div id="t2" role="tabpanel" hidden><p>Ekstrakcja zęba od 250 zł</p></div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Cennik')!;
    expect(s.arrangement).toBe('tabs');
    expect(s.items.map((i) => [i.title, i.text])).toEqual([['Protetyka', ['Korona porcelanowa od 1200 zł']], ['Chirurgia', ['Ekstrakcja zęba od 250 zł']]]);
    expectCovered(result);
  });
```

Review Focus 2 fixture (same `describe`):

```ts
  it('keeps plain paragraphs in their own divs as text, not a list of items', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>O gabinecie</h2>
        <div><p>Gabinet działa od 1998 roku w centrum Krakowa.</p></div>
        <div><p>Leczymy dzieci i dorosłych, z pełną diagnostyką na miejscu.</p></div>
        <div><p>Współpracujemy z pracownią protetyczną na miejscu.</p></div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'O gabinecie')!;
    expect(s.arrangement).toBe('text');
    expect(s.items).toEqual([]);
    expect(s.intro.text).toHaveLength(3);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts`
Expected: the new item tests FAIL (no groups yet); Task 6/7 tests and the plain-paragraphs test still pass.

- [ ] **Step 3: Replace the stubs** — in `collectSiteSectionsInPage`, replace the block from `// Item groups: filled in by Task 8` through `const cardStyle = ...;` with:

```ts
  // Item groups: the largest group of repeated siblings, or one markup names outright
  type Found = { members: Element[]; covers: Element[]; markup?: RawGroupMarkup; weight: number; titles?: string[] };
  // Plain text elements are never items on their own; a list of paragraphs is text
  const TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'A', 'BUTTON', 'LABEL', 'BR', 'SMALL', 'SUMMARY']);
  const ITEM_TAGS = new Set(['LI', 'DETAILS', 'ARTICLE', 'TR', 'FIGURE']);
  const hasImage = (el: Element) => el.tagName === 'IMG' || el.querySelector('img') !== null;
  const signature = (el: Element): string => {
    const tags = (list: Element[]) => Array.from(new Set(list.map((node) => node.tagName))).sort().join(',');
    const children = Array.from(el.children);
    return `${el.tagName}(${tags(children)}|${tags(children.flatMap((child) => Array.from(child.children)))})`;
  };
  const profile = (el: Element) => `${hasImage(el) ? 'i' : ''}${clean(el.textContent) ? 't' : ''}`;
  // An item holds more than one line of text, an image, a price, or is a list entry
  const composite = (el: Element) => ITEM_TAGS.has(el.tagName) || hasImage(el) || runsOf(el, []).length >= 2 || PRICE.test(clean(el.textContent));
  const markupOf = (parent: Element, members: Element[]): RawGroupMarkup | undefined => {
    if (
      members.every((m) => m.matches('details') || m.querySelector('details, [aria-expanded]') !== null) ||
      /accordion|toggle|faq/i.test(`${classOf(parent)} ${classOf(members[0]!)}`)
    ) {
      return 'accordion';
    }
    if (parent.closest(SLIDER)) return 'slider';
    if (members.every((m) => /schema\.org\/Person/i.test(m.getAttribute('itemtype') || ''))) return 'person';
    if (members.every((m) => /schema\.org\/Review/i.test(m.getAttribute('itemtype') || ''))) return 'review';
    return undefined;
  };

  const pickGroups = (root: Element, skip: Element[]): Found[] => {
    const found: Found[] = [];
    const taken = (el: Element) => skip.some((s) => s.contains(el) || el.contains(s));

    // Tabs: each tab with the panel it controls, hidden panels included
    for (const list of Array.from(root.querySelectorAll('[role="tablist"]'))) {
      const tabs = Array.from(list.querySelectorAll('[role="tab"]')).filter((tab) => !taken(tab));
      const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls') || ''));
      if (tabs.length < 2 || panels.some((panel) => !panel || !root.contains(panel))) continue;
      found.push({
        members: panels as Element[],
        covers: [list, ...(panels as Element[])],
        markup: 'tabs',
        titles: tabs.map((tab) => clean(tab.textContent)),
        weight: (panels as Element[]).reduce((sum, panel) => sum + clean(panel.textContent).length, 0),
      });
    }

    const parents = [root, ...Array.from(root.querySelectorAll('*')).slice(0, MAX_SCAN)];
    for (const parent of parents) {
      if (parent.children.length < 2 || excluded(parent) || TEXT_TAGS.has(parent.tagName) || parent.matches('[role="tablist"]')) continue;
      const bySignature = new Map<string, Element[]>();
      for (const child of Array.from(parent.children)) {
        if (excluded(child) || TEXT_TAGS.has(child.tagName) || taken(child)) continue;
        if (!clean(child.textContent) && !hasImage(child)) continue;
        const key = signature(child);
        const list = bySignature.get(key);
        if (list) list.push(child);
        else bySignature.set(key, [child]);
      }
      for (const members of Array.from(bySignature.values())) {
        if (members.length < 2) continue;
        // Most members must hold the same kinds of content: a text column beside a photo column is not a pair of cards
        const counts = new Map<string, number>();
        for (const m of members) counts.set(profile(m), (counts.get(profile(m)) ?? 0) + 1);
        if (Math.max(...Array.from(counts.values())) < members.length * 0.75) continue;
        const markup = markupOf(parent, members);
        if (!markup && members.filter(composite).length < members.length * 0.75) continue;
        const weight = members.reduce((sum, m) => sum + clean(m.textContent).length + (hasImage(m) ? 50 : 0), 0);
        found.push({ members, covers: members, ...(markup ? { markup } : {}), weight });
      }
    }

    const ranked = found.sort((a, b) => b.weight - a.weight);
    const top = ranked[0];
    if (!top) return [];
    // Markup wins when its group holds at least half of the biggest group's content
    const main = ranked.find((g) => g.markup && g.weight >= top.weight / 2) ?? top;
    const apart = (a: Found, b: Found) => !a.covers.some((x) => b.covers.some((y) => x.contains(y) || y.contains(x)));
    const second = ranked.find((g) => g !== main && apart(g, main) && g.weight >= 40);
    return second ? [main, second] : [main];
  };

  const TITLE = 'h1, h2, h3, h4, h5, h6, summary, [aria-expanded], dt';
  const TITLE_FALLBACK = 'strong, b, [class*="title" i], [class*="name" i], [class*="author" i]';
  const ratingOf = (el: Element): number | undefined => {
    const labels = [el, ...Array.from(el.querySelectorAll('[aria-label], [title]'))]
      .map((node) => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`)
      .join(' ');
    const scored = `${labels} ${clean(el.textContent)}`.match(/(?<![\d/.,])(\d(?:[.,]\d+)?)\s*(?:\/|na|z|из|of)\s*(5|10)(?![\d/])/i);
    if (scored) {
      const value = parseFloat((scored[1] ?? '').replace(',', '.'));
      return scored[2] === '10' ? value / 2 : value;
    }
    const glyphs = (clean(el.textContent).match(/★/g) || []).length;
    if (glyphs >= 1 && glyphs <= 5) return glyphs;
    const stars = Array.from(el.querySelectorAll('[class*="star" i]')).filter(
      (node) => node.querySelector('[class*="star" i]') === null && !/empty|half|outline|-o\b/i.test(classOf(node)),
    );
    return stars.length >= 1 && stars.length <= 5 ? stars.length : undefined;
  };

  const readItem = (member: Element, titleOverride?: string): RawSiteItem => {
    const titleEl =
      titleOverride !== undefined
        ? null
        : (member.querySelector(TITLE) ??
          Array.from(member.querySelectorAll(TITLE_FALLBACK)).find((el) => {
            const text = clean(el.textContent);
            return text.length > 0 && text.length <= 80;
          }) ??
          null);
    const title = titleOverride ?? (titleEl ? clean(titleEl.textContent) : undefined);

    // A short line right next to the title: a role under a name, a date over a review
    let subtitleEl: Element | undefined;
    if (titleEl && !member.matches('details') && !titleEl.matches('summary, [aria-expanded]')) {
      let anchor: Element = titleEl;
      while (anchor.parentElement && anchor.parentElement !== member && !anchor.nextElementSibling && !anchor.previousElementSibling) {
        anchor = anchor.parentElement;
      }
      subtitleEl = [anchor.nextElementSibling, anchor.previousElementSibling].find((el): el is Element => {
        if (!el || el.querySelector('img, h1, h2, h3, h4, h5, h6')) return false;
        const text = clean(el.textContent);
        return text.length > 0 && text.length <= 60 && !PRICE.test(text);
      });
    }

    const { links, standalone } = linksIn(member, []);
    const skip = [...(titleEl ? [titleEl] : []), ...(subtitleEl ? [subtitleEl] : []), ...standalone];
    let text = runsOf(member, skip).map((run) => run.text);
    const images = Array.from(member.querySelectorAll('img'))
      .map(imageOf)
      .filter((image): image is RawSiteImage => image !== undefined)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    const image = images[0];
    let subtitle = subtitleEl ? clean(subtitleEl.textContent) : undefined;
    // With nothing else under the title, the short line is the item's text, not its subtitle
    if (subtitle && text.length === 0 && !image) {
      text = [subtitle];
      subtitle = undefined;
    }
    const price = clean(member.textContent).match(PRICE)?.[0]?.trim();
    const rating = ratingOf(member);
    const icon =
      member.querySelector('svg, i[class*="icon" i], i[class*="fa-" i], [class*="icon" i]') !== null ||
      (image !== undefined && image.box.width > 0 && image.box.width <= 96);
    return {
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
      text,
      ...(image ? { image } : {}),
      ...(price ? { price } : {}),
      ...(rating !== undefined ? { rating } : {}),
      links,
      icon,
      box: boxOf(member),
    };
  };

  const readGroup = (found: Found): RawItemGroup => ({
    ...(found.markup ? { markup: found.markup } : {}),
    items: found.members.slice(0, MAX_ITEMS).map((member, i) => readItem(member, found.titles?.[i])),
  });

  // The element that paints the card: the member or a descendant nearly as big with a background, border or shadow
  const cardStyle = (member: Element): RawSiteBlock['itemStyle'] => {
    const areaOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };
    const memberArea = areaOf(member);
    const card =
      [member, ...Array.from(member.querySelectorAll('*')).slice(0, 50)].find((el) => {
        if (areaOf(el) < memberArea * 0.8) return false;
        const s = window.getComputedStyle(el);
        return OPAQUE(s.backgroundColor) || (s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) >= 1) || s.boxShadow !== 'none';
      }) ?? member;
    const s = window.getComputedStyle(card);
    return {
      background: OPAQUE(s.backgroundColor) ? s.backgroundColor : '',
      radius: radiusOf(card, boxOf(card).width),
      borderWidth: s.borderTopStyle === 'none' ? 0 : parseFloat(s.borderTopWidth) || 0,
      boxShadow: s.boxShadow,
      textAlign: s.textAlign,
    };
  };
```

Also add these next to the other constants at the top of the function:

```ts
  const MAX_SCAN = 1500;
  const SLIDER =
    '.swiper, .swiper-container, .slick-slider, .owl-carousel, .carousel, .splide, .flickity-enabled, .glide, rs-module, .rev_slider, [class*="slider" i], [class*="slideshow" i]';
  const PRICE = /(?:(?:od|from|от|ад|nuo|ab)\s+)?\d[\d\s.,]*\s?(?:zł|pln|€|eur|\$|usd|₽|руб|byn|br\b|£|gbp|kč|czk)/i;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts`
Expected: PASS. Tune only in-page heuristics when a fixture fails, and re-run the whole spec after each change (a fix for one builder must not break another). Common adjustments: a member's `profile` mismatched by an empty icon wrapper (drop members with no text and no image before profiling); a title fallback picking a wrapper (tighten `TITLE_FALLBACK` to elements without block children).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npm run typecheck && npm run lint`

```bash
git add apps/workers/src/services/site-sections.page.ts apps/workers/src/services/__tests__/site-sections.page.spec.ts
git commit -m "feat(REV-109): read repeated items: cards, team, FAQ, slider, tabs, features"
```

---

### Task 9: Arrangement and style fixtures (media, embeds, banner, typography)

**Files:**
- Modify: `apps/workers/src/services/__tests__/site-sections.page.spec.ts`
- Modify (only when a fixture fails): `site-sections.page.ts` / `site-sections.service.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the fixtures** — inside the Chromium `describe`:

```ts
  it('reads text beside an image at 60/40, with the side and split', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section style="display:flex;align-items:center;padding:60px 0">
        <div style="width:60%;padding:0 40px;box-sizing:border-box"><h2>O gabinecie</h2>
          <p>Gabinet działa od 1998 roku w centrum Krakowa, tuż przy Rynku Głównym.</p>
          <p>Leczymy dzieci i dorosłych, z pełną diagnostyką i pracownią protetyczną na miejscu.</p></div>
        <div style="width:40%"><img src="https://img.test/room.jpg" alt="Gabinet" width="576" height="400" style="display:block;width:100%;height:auto"></div>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'O gabinecie')!;
    expect(s.arrangement).toBe('media-beside-text');
    expect(s.mediaSide).toBe('right');
    expect(s.style.split).toBeCloseTo(0.42, 1);
    expect(s.images[0]!.src).toBe('https://img.test/room.jpg');
    expectCovered(result);
  });

  it('reads identical Elementor columns with text and a photo as media beside text, not two cards', async () => {
    const column = (inner: string) => `<div class="elementor-column" style="width:50%"><div class="elementor-widget-wrap"><div class="elementor-widget">${inner}</div></div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section style="display:flex;align-items:center">
        ${column('<h2>Nasza historia</h2><p>Od ponad dwudziestu lat dbamy o uśmiechy mieszkańców Krakowa i okolic.</p>')}
        ${column('<img src="https://img.test/team.jpg" alt="" width="640" height="420" style="display:block;width:100%;height:auto">')}
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasza historia')!;
    expect(s.items).toEqual([]);
    expect(s.arrangement).toBe('media-beside-text');
    expect(s.mediaSide).toBe('right');
  });

  it('reads a map embed and a form', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section id="kontakt" style="display:grid;grid-template-columns:2fr 3fr;min-height:500px;padding:0">
        <div style="padding:40px"><h2>Kontakt</h2><form action="/wyslij"><input name="email" placeholder="E-mail"><textarea name="m"></textarea><button>Wyślij</button></form></div>
        <iframe src="https://www.google.com/maps/embed?pb=xyz" style="border:0;width:100%;height:500px"></iframe>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Kontakt')!;
    expect(s.kind).toBe('contact');
    expect(s.embeds).toEqual([{ kind: 'form', src: 'https://falco.test/wyslij' }, { kind: 'map', src: 'https://www.google.com/maps/embed?pb=xyz' }]);
    expect(s.arrangement).toBe('embed');
  });

  it('reads a photo banner with its call to action, and the site typography', async () => {
    const result = await sectionsOf(pageOf(`${HEADER}
      <section style="background:url(https://img.test/bg.jpg) center/cover;min-height:600px;color:#fff;text-align:center">
        <h1 style="color:#fff">Piękny uśmiech zaczyna się tutaj</h1><p>Konsultacja online w dwie minuty.</p>
        <a class="btn" href="/rezerwacja" style="display:inline-block;background:#e91e63;padding:12px 24px;color:#fff;border-radius:4px;text-transform:uppercase">Umów wizytę</a>
      </section>
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze, protetyka i implanty, wszystko w jednym miejscu.</p></section>`));
    const hero = result.sections.find((x) => x.role === 'hero')!;
    expect(hero.arrangement).toBe('banner');
    expect(hero.style).toMatchObject({ backgroundImage: 'https://img.test/bg.jpg', textColor: '#ffffff', align: 'center' });
    expect(hero.intro.links).toEqual([{ label: 'Umów wizytę', href: 'https://falco.test/rezerwacja', kind: 'cta' }]);
    expect(result.typography).toEqual({
      heading: { family: 'Georgia', size: 32, weight: 700, uppercase: false, color: '#111111' },
      body: { family: 'Arial', size: 16, weight: 400, lineHeight: 1.5, color: '#333333' },
      button: { radius: 0, filled: true, uppercase: false, background: '#00aa77', color: '#ffffff' },
    });
    expectCovered(result);
  });
```

The hero's paragraph is under 40 characters on purpose: the body sample is the first paragraph of at least 40, here the services one (`#333`). The typography button comes from the first button-styled link in document order, which is the header's "Zadzwoń" (`#0a7` → `#00aa77`, no radius, no uppercase). That is intended: the header CTA is the site's main button.

- [ ] **Step 2: Run the fixtures**

Run: `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts`
Expected: PASS. If `split` lands outside ±0.05 of 0.42, check `introBox` (union of the heading and the intro paragraphs, which sit inside the 40 px padding) before touching the rule.

- [ ] **Step 3: Run the whole workers suite for REV-104 regressions**

Run: `npx vitest run apps/workers/src/services`
Expected: PASS (site-layout and layout-selection unchanged apart from Task 3).

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/services/__tests__/site-sections.page.spec.ts apps/workers/src/services/site-sections.page.ts apps/workers/src/services/site-sections.service.ts
git commit -m "test(REV-109): arrangement, embed, banner and typography fixtures"
```

---

### Task 10: `BrowserService.extractSiteSections` and wiring

**Files:**
- Modify: `apps/workers/src/services/browser.service.ts` (imports line 8; `FullAuditCrawlingResult` line 38; after `extractSiteLayout` ~line 270; `captureFullAudit` lines 478, 506, 558)
- Modify: `apps/workers/src/services/__tests__/browser.service.spec.ts`

**Interfaces:**
- Consumes: `collectSiteSectionsInPage`, `RawSiteSections`.
- Produces: `SITE_SECTIONS_TIMEOUT_MS = 15000`; `BrowserService.extractSiteSections(page: Page): Promise<{ raw?: RawSiteSections; error?: string }>`; `FullAuditCrawlingResult.siteSections: { raw?: RawSiteSections; error?: string }`.

- [ ] **Step 1: Write the failing tests** — add to `browser.service.spec.ts` (import `SITE_SECTIONS_TIMEOUT_MS` from `../browser.service.js` and `type Page` from `playwright`):

```ts
describe('extractSiteSections (REV-109)', () => {
  const pageWith = (evaluate: (...args: unknown[]) => Promise<unknown>) => ({ evaluate: vi.fn(evaluate) }) as unknown as Page;

  it('returns the raw section facts', async () => {
    const raw = { viewportWidth: 1440, viewportHeight: 900, blocks: [], typography: {}, pageChars: 0, uncaptured: [] };
    await expect(new BrowserService().extractSiteSections(pageWith(async () => raw))).resolves.toEqual({ raw });
  });

  it('returns an error, never throws, when evaluation fails or returns nothing', async () => {
    const failed = await new BrowserService().extractSiteSections(pageWith(async () => { throw new Error('Execution context was destroyed'); }));
    expect(failed.error).toMatch(/Section collection failed: Execution context was destroyed/);
    const empty = await new BrowserService().extractSiteSections(pageWith(async () => null));
    expect(empty.error).toMatch(/no section facts/);
  });

  it('gives up after the time limit (Review Focus 4)', async () => {
    vi.useFakeTimers();
    try {
      const pending = new BrowserService().extractSiteSections(pageWith(() => new Promise(() => {})));
      await vi.advanceTimersByTimeAsync(SITE_SECTIONS_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ error: expect.stringMatching(/timed out after 15 s/) });
    } finally {
      vi.useRealTimers();
    }
  });
});
```

In the existing `captureFullAudit` test at line ~168, add:

```ts
    expect(result.siteSections).toBeDefined();
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/workers/src/services/__tests__/browser.service.spec.ts`
Expected: FAIL (`extractSiteSections` is not a function).

- [ ] **Step 3: Implement** — in `browser.service.ts`:

```ts
import { collectSiteSectionsInPage, RawSiteSections } from './site-sections.page.js';
```

```ts
/** How long the section reader may run in the page before the audit goes on without it (REV-109) */
export const SITE_SECTIONS_TIMEOUT_MS = 15000;
```

In `FullAuditCrawlingResult`, after `siteLayout`:

```ts
  /** Raw DOM facts of the home page's sections (REV-109); absent with the reason when collection failed */
  siteSections: { raw?: RawSiteSections; error?: string };
```

After `extractSiteLayout`:

```ts
  /**
   * Collects the DOM facts the page's sections are read from (REV-109), from the blocks the layout
   * walk tagged, so it must run after `extractSiteLayout` on the same page. Never throws, and gives
   * up after SITE_SECTIONS_TIMEOUT_MS: the audit goes on with the reason instead.
   */
  async extractSiteSections(page: Page): Promise<{ raw?: RawSiteSections; error?: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${SITE_SECTIONS_TIMEOUT_MS / 1000} s`)), SITE_SECTIONS_TIMEOUT_MS);
      });
      const raw = await Promise.race([page.evaluate(collectSiteSectionsInPage), timeout]);
      return raw && typeof raw === 'object' && Array.isArray(raw.blocks) ? { raw } : { error: 'The page returned no section facts' };
    } catch (err) {
      console.warn('[BrowserService] Site section collection failed:', err);
      return { error: `Section collection failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  }
```

In `captureFullAudit`: declare `let siteSections: { raw?: RawSiteSections; error?: string };` next to `siteLayout`; after `siteLayout = await this.extractSiteLayout(page);` add:

```ts
      // Reads the blocks the layout walk just tagged; without that walk there is nothing to read (REV-109)
      siteSections = siteLayout.raw
        ? await this.extractSiteSections(page)
        : { error: `layout walk failed: ${siteLayout.error ?? 'no layout facts'}`.slice(0, 300) };
```

and add `siteSections,` to the returned object after `siteLayout,`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/browser.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/services/browser.service.ts apps/workers/src/services/__tests__/browser.service.spec.ts
git commit -m "feat(REV-109): collect site sections after the layout walk, with a time limit"
```

---

### Task 11: Audit worker stores the sections

**Files:**
- Modify: `apps/workers/src/workers/audit.worker.ts` (import at line 15; after line 73; `measuredFields` at line ~155)
- Modify: `apps/workers/src/workers/__tests__/audit.worker.spec.ts`

**Interfaces:**
- Consumes: `readSiteSections`, `FullAuditCrawlingResult.siteSections`.
- Produces: the COMPLETED audit update carries `siteSections` or `siteSectionsError`, and `$unset`s the other.

- [ ] **Step 1: Update the mocks and write the failing tests**

Every `vi.mocked(browserService.captureFullAudit).mockResolvedValue({...})` in `audit.worker.spec.ts` (7 of them; `grep -n "captureFullAudit).mockResolvedValue" apps/workers/src/workers/__tests__/audit.worker.spec.ts`) gets a `siteSections` entry. In the first one (line ~87, whose `siteLayout.raw` has three blocks), add:

```ts
      siteSections: {
        raw: {
          viewportWidth: 1440,
          viewportHeight: 900,
          blocks: [
            {
              role: 'content', block: 0, box: { top: 80, left: 0, width: 1440, height: 700 },
              intro: { heading: 'Test Dental', headingLevel: 1, text: ['Smiles for everyone.'], links: [] },
              extra: [], images: [], embeds: [],
              style: { background: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', textAlign: 'center', paddingTop: 100, paddingBottom: 100 },
            },
          ],
          typography: {},
          pageChars: 31,
          uncaptured: [],
        },
      },
```

In every other one, add `siteSections: { error: 'Sections not collected in this test' },`.

In the first test's COMPLETED expectation (line ~284), next to `siteLayout`, add:

```ts
        // The original sections, read from the page and validated (REV-109); no stale error kept
        siteSections: expect.objectContaining({
          sections: [expect.objectContaining({ index: 0, role: 'hero', arrangement: 'text', intro: expect.objectContaining({ heading: 'Test Dental' }) })],
          coverage: { pageChars: 31, capturedChars: 31, ratio: 1, uncaptured: [] },
        }),
```

and change `$unset: { siteLayoutError: '' }` to `$unset: { siteLayoutError: '', siteSectionsError: '' }`.

In the test at line ~420 that checks `completed.$unset` (the failing-measurements test), add `siteSections: ''` to the expected `$unset` object and:

```ts
    // The sections were not read either: the reason is stored and an earlier audit's sections are cleared (REV-109, Review Focus 5)
    expect(completed.siteSectionsError).toBe('Sections not collected in this test');
    expect(completed).not.toHaveProperty('siteSections');
```

That test already shows the audit reaching COMPLETED with the sections unread, so no separate "does not fail the audit" test is needed.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/workers/src/workers/__tests__/audit.worker.spec.ts`
Expected: FAIL (no `siteSections` in the update).

- [ ] **Step 3: Implement** — in `audit.worker.ts`:

```ts
import { readSiteSections } from '../services/site-sections.service.js';
```

Destructure `siteSections: rawSiteSections,` from `captureFullAudit`. After the `siteLayout` lines:

```ts
        // The original page section by section (REV-109), or why it could not be read; never fails the audit
        const siteSections = rawSiteSections.raw
          ? readSiteSections(rawSiteSections.raw, rawSiteLayout.raw?.blocks ?? [])
          : { error: rawSiteSections.error ?? 'No section facts' };
        if (siteSections.error) console.warn(`[AuditWorker] Original sections not read for lead ${leadId}: ${siteSections.error}`);
```

In `measuredFields`, after `siteLayoutError`:

```ts
          // Exactly one of the two is set, so a re-audit never keeps the previous run's sections (REV-109)
          siteSections: siteSections.sections,
          siteSectionsError: siteSections.error,
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/workers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/workers/audit.worker.ts apps/workers/src/workers/__tests__/audit.worker.spec.ts
git commit -m "feat(REV-109): store the original site sections on the audit"
```

---

### Task 12: Live check on real sites

**Files:**
- Create: `scripts/read_site_sections.ts`
- Modify (tuning only): `site-sections.page.ts`, `site-sections.service.ts`, plus a Chromium fixture for each real-site pattern you fix

**Interfaces:**
- Consumes: `browserService` internals are not used; the script drives Playwright itself, then calls the public `collectSiteLayoutInPage`, `collectSiteSectionsInPage`, `readSiteSections`, `cookieConsentService.dismiss`.

- [ ] **Step 1: Write the script** — `scripts/read_site_sections.ts` (read-only: no Mongo, no MinIO):

```ts
/**
 * Reads real home pages section by section and prints what the audit would store (REV-109).
 * Read-only: it writes nothing to MongoDB or MinIO. Usage:
 *   npx tsx scripts/read_site_sections.ts https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/
 */
import { chromium } from 'playwright';
import { EVALUATE_NAME_SHIM } from '../apps/workers/src/services/browser.service.js';
import { cookieConsentService } from '../apps/workers/src/services/cookie-consent.service.js';
import { collectSiteLayoutInPage } from '../apps/workers/src/services/site-layout.service.js';
import { collectSiteSectionsInPage } from '../apps/workers/src/services/site-sections.page.js';
import { readSiteSections } from '../apps/workers/src/services/site-sections.service.js';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('Usage: npx tsx scripts/read_site_sections.ts <url> [url...]');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const url of urls) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript({ content: EVALUATE_NAME_SHIM });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.waitForLoadState('load'));
      await cookieConsentService.dismiss(page);
      // Scroll through the page so lazy content loads, as the audit's full-page capture does
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        window.scrollTo(0, 0);
      });
      const layout = await page.evaluate(collectSiteLayoutInPage);
      const reading = readSiteSections(await page.evaluate(collectSiteSectionsInPage), layout.blocks);
      console.log(`\n=== ${url}`);
      if (reading.error) {
        console.log(`ERROR: ${reading.error}`);
        continue;
      }
      const { sections, skipped, coverage } = reading.sections;
      for (const s of sections) {
        console.log(
          `#${s.index} ${s.role}/${s.kind}/${s.arrangement}${s.columns ? `x${s.columns}` : ''} "${s.intro.heading ?? ''}" items=${s.items.length}` +
            (s.items.length ? ` [${s.items.slice(0, 6).map((i) => i.title ?? i.text[0]?.slice(0, 30)).join(' | ')}]` : '') +
            (s.truncated ? ' TRUNCATED' : ''),
        );
      }
      for (const k of skipped) console.log(`  skipped #${k.index} ${k.reason}: ${k.sample}`);
      console.log(`coverage ${coverage.capturedChars}/${coverage.pageChars} = ${coverage.ratio}`);
      for (const u of coverage.uncaptured) console.log(`  uncaptured: ${u}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Run it on the three leads**

Run: `npx tsx scripts/read_site_sections.ts https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/ | tee /private/tmp/claude-501/-Users-yurykurouski-code-ehu-Revamp-dev/9917f21c-ea02-49e0-b66a-d36fe905d50a/scratchpad/rev-109-live.txt`
Expected: each site prints its sections. Falco-Dent must show a `team` section with its 6 people as items, an `faq` section with its questions, and a `features` section ("Co nas wyróżnia") with its points.

- [ ] **Step 3: Tune, one pattern at a time**

For each miss (a section missing, the wrong arrangement, items not found, coverage below 0.95), open the site in Chrome DevTools (chrome-devtools MCP), look at the markup, then:
1. Add a Chromium fixture to `site-sections.page.spec.ts` reproducing that markup in miniature, and watch it fail.
2. Change the in-page or Node rule until it passes.
3. Re-run the whole `site-sections.page.spec.ts` and `site-sections.service.spec.ts`, then the script on all three sites.

Never lower a threshold or a coverage assertion to make a site pass. Record the final output for the PR.

- [ ] **Step 4: Commit**

```bash
git add scripts/read_site_sections.ts apps/workers/src/services/site-sections.page.ts apps/workers/src/services/site-sections.service.ts apps/workers/src/services/__tests__/site-sections.page.spec.ts
git commit -m "feat(REV-109): read-only live check script; tuned on Falco-Dent, Dentalux, Elefant"
```

---

### Task 13: Gates, Chrome check, docs, PR, merge, close

**Files:**
- Modify: `AGENTS.md` (§3.2.2, after the REV-104 paragraph)
- Modify: `../Revamp-docs/blueprint.md`, `../Revamp-docs/spec.md`, `../Revamp-docs/milestones.md`
- Check: `README.md`

- [ ] **Step 1: Run every gate**

```bash
npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all green, 0 lint errors, no new warnings, 0 test failures. If many tests time out at 5 s at once, check `uptime` for CPU load before suspecting the code (see memory: test timeouts under load), and re-run.

- [ ] **Step 2: End-to-end on the running stack**

With `npm run dev` running (or the workers alone), re-audit one lead you created for this check, never an existing real lead (other sessions share the dev data). Create it through the dashboard's add-lead form with `https://falcodent.pl/` and business name `REV-109 check: Falco-Dent`, wait for the audit, then:

```bash
docker exec revamp-mongo mongosh revamp --quiet --eval 'const l = db.leads.findOne({businessName: "REV-109 check: Falco-Dent"}); const a = db.audits.find({leadId: l._id}).sort({createdAt: -1}).limit(1).next(); printjson({error: a.siteSectionsError, count: a.siteSections && a.siteSections.sections.length, kinds: a.siteSections && a.siteSections.sections.map(s => s.kind + "/" + s.arrangement), coverage: a.siteSections && a.siteSections.coverage.ratio, layout: Boolean(a.siteLayout)})'
```

Expected: `error` undefined, the sections and coverage as in Task 12, `layout: true`.

- [ ] **Step 3: Chrome check** — with the chrome-devtools MCP tools, open `http://localhost:5173/leads/<that lead's id>`, go through Audit → Prototype → Email steps and `/leads/<id>/preview`; confirm they load and `list_console_messages` shows no new errors. Do not approve the lead.

- [ ] **Step 4: Docs**

`AGENTS.md` §3.2.2, after the REV-104 bullet, add:

```md
   * The original home page is also read section by section (REV-109): `collectSiteSectionsInPage` (`apps/workers/src/services/site-sections.page.ts`, self-contained) reads the header, the blocks REV-104's walk tagged with `data-revamp-block`, and the footer; `readSiteSections` (`site-sections.service.ts`) names each section's arrangement, kind and style and stores `Audit.siteSections` (`SiteSectionsSchema`, caps in `SITE_SECTIONS_LIMITS`), or `Audit.siteSectionsError`. Nothing is dropped without a reason: a left-out block goes to `skipped` (`SITE_SKIP_REASONS`), and `coverage` measures how much of the page's text the sections hold. A new arrangement goes into `SITE_SECTION_ARRANGEMENTS`, the schema, `arrangementOf` and its tests; a new kind into `SITE_SECTION_KINDS`, the schema, `SECTION_WORDS` or `kindFromItems`, and their tests. Check a change on real sites with `npx tsx scripts/read_site_sections.ts <url>` (read-only).
```

`../Revamp-docs/blueprint.md`: in the Audit schema, add `siteSections` (Mixed, `SiteSectionsSchema`) and `siteSectionsError` (String) with one line each, next to `siteLayout`. `../Revamp-docs/spec.md`: add the two fields to the audit DTO with the shape summary (sections with role, kind, arrangement, intro, items, extra, images, embeds, style; typography; skipped with reason; coverage). `../Revamp-docs/milestones.md`: add/tick REV-109 under the REV-108 work. `README.md`: update only if its feature list names audit fields (`grep -n "siteLayout\|layout" README.md`); otherwise note "README unchanged" in the ticket.

Commit this repo's docs:

```bash
git add AGENTS.md
git commit -m "docs(REV-109): the section reader in AGENTS.md"
```

Commit and push the docs repo:

```bash
git -C ../Revamp-docs add blueprint.md spec.md milestones.md
git -C ../Revamp-docs commit -m "docs(REV-109): Audit.siteSections"
git -C ../Revamp-docs push
```

- [ ] **Step 5: PR** — push and open:

```bash
git push -u origin ymorpheus/rev-109-site-section-reader
gh pr create --title "feat(REV-109): read the original home page as ordered sections" --body-file <scratchpad>/rev-109-pr.md
```

The body starts with `Fixes [REV-109](https://linear.app/revamp-proect/issue/REV-109/read-the-original-home-page-as-ordered-sections-with-their-content-and)` and has `## Problem`, `## Changes`, `## Verification` (every gate command with its result, the Task 12 output for the three sites, the Step 2 Mongo check, the Chrome check), ending with the PR attribution lines. Attach the PR and the docs commit links to REV-109 and move it to **In Review**.

- [ ] **Step 6: Merge** — `git pull origin main` (or rebase), re-run Step 1's gates on the result, then `gh pr merge --merge`, `git checkout main && git pull`, `npm run build:packages && npm test`.

- [ ] **Step 7: Close** — move REV-109 to **Done**; report the ticket, PR and docs commit links to the user.
