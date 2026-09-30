# REV-110 Section Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the MVP as a section-by-section rebuild of the original home page (`Audit.siteSections`), tuned deterministically, with a visible, recorded fallback to the Bento template.

**Architecture:** A new layout variant `original`. A pure planner (`planRebuild`) turns the audit's sections into a validated `IRebuildPlan` (every decision and every tuning fix lives there); `renderRebuild(plan)` turns the plan into HTML with one renderer per arrangement. A shared `renderMvp` helper picks the rebuild or Bento for both the deploy and the re-publish path, and falls back to Bento with `rebuild:*` reason codes. The dashboard shows the variant, the fallback and the summary, and disables the free-text change and custom design on a rebuilt MVP until REV-111.

**Tech Stack:** TypeScript, Zod (`@revamp/validation`), Mongoose (`@revamp/db`), BullMQ workers, Express API, React 18 + MUI v6 + react-i18next dashboard, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-30-rev-110-section-rebuild-design.md` (read it first; this plan argues from it).

## Global Constraints

- Markup is rendered only from validated data; no site markup or model output is copied through (REV-92). Every string goes through `escapeHtml`.
- Only `http(s)` URLs are rendered in `src`/`href`, plus `tel:`/`mailto:` built from original or verified values, plus `#` anchors. Never `javascript:` or `data:`.
- Strict Grounding: no service, review, person, price, contact or copy is invented. Alt text comes only from the original alt, the item title or the section heading, else is empty.
- No external fonts and no external scripts except the existing tracker; iframes only from the allowlist (Google Maps, OpenStreetMap, YouTube, youtube-nocookie, Vimeo), `https` only.
- `REBUILD_MIN_COVERAGE = 0.85`; bundle limit 300 KB (`300 * 1024` bytes), the same as Bento.
- Layout reason codes are strings of 1–60 chars, at most 12 per layout.
- Bento's rendered output must stay byte-identical for the same input.
- One schema per collection: new Mongoose fields only in `packages/db` (AGENTS.md §3.2.7). API errors only via `AppError` with codes from `API_ERROR_CODES` (§3.2.9). Dashboard colors only from theme tokens (§3.2.6); new UI strings in all five locales (`en`, `pl`, `ru`, `be`, `lt`).
- Commits: `feat(REV-110): …` / `test(REV-110): …` / `docs(REV-110): …`, each ending with the two attribution lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Ag5gFrWPYYuCwFdQGDu4Gs
  ```
- Run Vitest from the repo root (`npx vitest run <path>`), never from inside an app (the workers' own env reaches the real LLM path).

## Spec additions made while planning (agreed in chat on 2026-09-30)

1. `rebuildEligibility` lives in `@revamp/validation` so the API can use it; `PATCH /mvp/:id/layout` with `original` on a lead whose audit cannot be rebuilt answers 409 `MVP_REBUILD_UNAVAILABLE` with `details.reason`. Without this the picker would show a pick the worker silently undid.
2. A re-publish that changes the renderer (rebuild ↔ Bento) sets `MvpProject.editedAt`, so the preview reloads; the dashboard polls the MVP while such a switch re-renders and shows "Re-rendering…". Bento variants still switch in place.
3. `manualMvpLayout` drops `rebuild:*` and `coverage:*` codes (they describe one render, not the audit), and a manual `original` pick that had to fall back keeps the marker `manual:original`, so a later regeneration tries the rebuild again.

## Review Focus

1. **A site whose sections have no hero** (a page whose first block sits below the fold): the rebuild must still render with a visually hidden `h1` of the business name — pinned in Task 5.
2. **A lead switched to `original` while its audit predates REV-109** (no `siteSections`, no `siteSectionsError`): the API must refuse with 409 `MVP_REBUILD_UNAVAILABLE`, not queue a relayout that bounces — pinned in Task 9.
3. **Original text containing `<script>`, quotes or `javascript:` links**: escaped text, link dropped and recorded — pinned in Task 6.
4. **A section whose background and text colors are both absent or identical** (transparent inherited, white on white): the text must come out readable (≥ 4.5:1 against the page background) — pinned in Task 4.
5. **A slider section with one item and a page opened with JS disabled**: no broken prev/next buttons; the track still scrolls — pinned in Task 6.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/shared-types/src/index.ts` | Modify | `BENTO_LAYOUT_VARIANTS`, `original`, rebuild reason constants, `IMvpRebuildSummary`, `IRebuildPlan` and parts, `IMvpProject.rebuild`, two API error codes |
| `packages/validation/src/index.ts` | Modify | `BentoLayoutVariantSchema`, `REBUILD_MIN_COVERAGE`, `rebuildEligibility`, `MvpRebuildSummarySchema`, `RebuildPlanSchema`, `manualMvpLayout` change |
| `packages/validation/__tests__/rebuild.spec.ts` | Create | Schema + eligibility + manual layout tests |
| `packages/db/src/models/MvpProject.model.ts` | Modify | `rebuild: Mixed` |
| `apps/workers/src/templates/shared/page.ts` | Create | `scriptJson`, `svgDataUri`, `hexToRgb`, `monogramSvg`, `resolveTrackerUrls`, `trackerScriptTag` (moved from Bento) |
| `apps/workers/src/templates/shared/booking.ts` | Create | `bookingFormHtml`, `bookingScript` (moved from Bento) |
| `apps/workers/src/templates/bento.template.ts` | Modify | Uses shared modules and `BentoLayoutVariant` |
| `apps/workers/src/templates/mvp-locale.ts` | Modify | Five new strings × five languages |
| `apps/workers/src/services/rebuild-tuning.ts` | Create | Pure color/type helpers: contrast, font stacks, sizes |
| `apps/workers/src/services/rebuild-plan.service.ts` | Create | `planRebuild` |
| `apps/workers/src/templates/rebuild/{index,sections,chrome,styles,script}.ts` | Create | `renderRebuild` and its parts (`chrome.ts` = header + footer) |
| `apps/workers/src/services/rebuild-template.service.ts` | Create | plan → validate → render → size; `RebuildUnavailable` |
| `apps/workers/src/services/mvp-render.ts` | Create | `renderMvp`, `rebuildLayout`, `fallbackLayout`, `requestedVariant` |
| `apps/workers/src/workers/deploy.worker.ts` | Modify | Uses `renderMvp` in deploy and re-publish |
| `apps/workers/src/services/{layout-selection,mvp-edit}.service.ts`, `workers/mvp-edit.worker.ts`, `services/template.service.ts` | Modify | Bento variant type |
| `apps/api/src/routes/mvp.routes.ts` | Modify | `MVP_EDIT_UNSUPPORTED`, `MVP_REBUILD_UNAVAILABLE` |
| `apps/dashboard/src/components/MvpLayoutChip.tsx`, `MvpLayoutPicker.tsx`, `leadReview/MvpDesignTools.tsx`, `hooks/useLiveMvpLayout.ts`, `i18n/locales/*.ts` | Modify | Chip, picker, disabled tools, re-render wait, strings |
| `scripts/render_rebuild.ts` | Create | Read-only live check |
| `AGENTS.md`, `README.md` | Modify | Docs |

---

### Task 1: Shared types, schemas and eligibility

**Files:**
- Modify: `packages/shared-types/src/index.ts` (near line 1164 `MVP_LAYOUT_VARIANTS`, line 1293 `IMvpLayoutSelection`, line 631 `IMvpProject`, line 1368 `API_ERROR_CODES`)
- Modify: `packages/validation/src/index.ts` (near line 783 `MvpLayoutVariantSchema`, line 799 `manualMvpLayout`)
- Modify: `packages/db/src/models/MvpProject.model.ts:78-79`
- Test: `packages/validation/__tests__/rebuild.spec.ts`

**Interfaces:**
- Produces (shared-types): `BENTO_LAYOUT_VARIANTS`, `BentoLayoutVariant`, `MVP_LAYOUT_VARIANTS` (now with `'original'` first), `MVP_LAYOUT_REBUILD_REASON = 'rule:rebuild'`, `MVP_LAYOUT_MANUAL_ORIGINAL = 'manual:original'`, `REBUILD_FALLBACK_REASONS`, `RebuildFallbackReason`, `IMvpRebuildSummary`, `RebuildOmission`, `IRebuildImage`, `IRebuildLink`, `IRebuildItem`, `IRebuildBlock`, `IRebuildSection`, `IRebuildPlan`; `IMvpProject.rebuild?`; codes `MVP_EDIT_UNSUPPORTED`, `MVP_REBUILD_UNAVAILABLE`.
- Produces (validation): `BentoLayoutVariantSchema`, `REBUILD_MIN_COVERAGE`, `rebuildEligibility(audit): { ok: true } | { ok: false; reason: RebuildFallbackReason; facts: string[] }`, `MvpRebuildSummarySchema`, `RebuildPlanSchema`, `REBUILD_SUMMARY_LIMITS`.

- [ ] **Step 1: Write the failing tests**

`packages/validation/__tests__/rebuild.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MvpLayoutSelectionSchema,
  MvpRebuildSummarySchema,
  REBUILD_MIN_COVERAGE,
  RebuildPlanSchema,
  UpdateMvpLayoutSchema,
  manualMvpLayout,
  rebuildEligibility,
} from '../src/index.js';
import type { IRebuildPlan, ISiteSections } from '@revamp/shared-types';

const sections = (ratio: number, roles: Array<'header' | 'hero' | 'content' | 'footer'> = ['header', 'hero', 'content']): ISiteSections => ({
  sections: roles.map((role, index) => ({
    index, role, kind: 'other', arrangement: 'text',
    intro: { heading: `H${index}`, text: ['Body'], links: [] },
    items: [], extra: [], images: [], embeds: [], style: {},
  })),
  skipped: [],
  coverage: { pageChars: 1000, capturedChars: Math.round(ratio * 1000), ratio, uncaptured: [] },
});

describe('rebuildEligibility (REV-110)', () => {
  it('accepts sections at the coverage threshold', () => {
    expect(REBUILD_MIN_COVERAGE).toBe(0.85);
    expect(rebuildEligibility({ siteSections: sections(0.85) })).toEqual({ ok: true });
  });
  it('falls back just under the threshold, with the ratio as a fact', () => {
    expect(rebuildEligibility({ siteSections: sections(0.849) })).toEqual({
      ok: false, reason: 'rebuild:low_coverage', facts: ['coverage:0.849'],
    });
  });
  it('falls back when the sections were not read', () => {
    expect(rebuildEligibility({ siteSectionsError: 'layout walk failed: x' })).toMatchObject({ ok: false, reason: 'rebuild:unread' });
    expect(rebuildEligibility({})).toMatchObject({ ok: false, reason: 'rebuild:unread' });
    expect(rebuildEligibility(null)).toMatchObject({ ok: false, reason: 'rebuild:unread' });
  });
  it('falls back with only a header and a footer', () => {
    expect(rebuildEligibility({ siteSections: sections(1, ['header', 'footer']) })).toMatchObject({
      ok: false, reason: 'rebuild:no_content',
    });
  });
});

describe('layout variants (REV-110)', () => {
  it('accepts original in the layout selection and the PATCH body', () => {
    expect(MvpLayoutSelectionSchema.parse({ variant: 'original', reasons: ['rule:rebuild'] }).variant).toBe('original');
    expect(UpdateMvpLayoutSchema.parse({ variant: 'original' }).variant).toBe('original');
  });
  it('manualMvpLayout drops render outcomes but keeps audit facts', () => {
    const layout = manualMvpLayout(
      { reasons: ['rebuild:low_coverage', 'coverage:0.7', 'manual:original', 'rule:derived', 'images:3'] },
      'bento',
    );
    expect(layout.reasons).toEqual(['rule:manual', 'images:3']);
  });
});

describe('MvpRebuildSummarySchema', () => {
  it('accepts a summary and rejects an unknown omission', () => {
    const summary = { coverage: 0.978, sections: 19, omitted: [{ what: 'nav_link', reason: 'other_page', sample: 'Cennik' }], tuning: ['contrast:3'] };
    expect(MvpRebuildSummarySchema.parse(summary)).toEqual(summary);
    expect(() => MvpRebuildSummarySchema.parse({ ...summary, omitted: [{ what: 'banana', reason: 'x' }] })).toThrow();
  });
  it('caps omitted at 80 and tuning at 120', () => {
    const omitted = Array.from({ length: 81 }, () => ({ what: 'link', reason: 'other_page' }));
    expect(() => MvpRebuildSummarySchema.parse({ coverage: 1, sections: 1, omitted, tuning: [] })).toThrow();
    expect(() => MvpRebuildSummarySchema.parse({ coverage: 1, sections: 1, omitted: [], tuning: Array(121).fill('x') })).toThrow();
  });
});

export const minimalPlan = (): IRebuildPlan => ({
  language: 'pl',
  businessName: 'Falco-Dent',
  hiddenH1: undefined,
  year: 2026,
  theme: {
    primary: '#0e7490', onPrimary: '#ffffff', pageBackground: '#ffffff', pageText: '#111111',
    headingFont: 'sans-serif', bodyFont: 'sans-serif', headingWeight: 700, headingUppercase: false,
    h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, buttonRadius: 6, buttonUppercase: false,
  },
  header: { nav: [], cta: { label: 'Umów wizytę' } },
  sections: [{
    id: 's-1', index: 1, kind: 'other', arrangement: 'text', headingLevel: 1,
    intro: { heading: 'Gabinet', text: ['Tekst'], links: [] },
    items: [], extra: [], images: [], embeds: [], booking: false, collapsed: false,
    style: { text: '#111111', align: 'left', paddingY: 64, fullBleed: false },
  }],
  bookingAppended: true,
  bookingServices: [],
  footer: { contacts: {}, social: [] },
  summary: { coverage: 0.978, sections: 1, omitted: [], tuning: [] },
});

describe('RebuildPlanSchema', () => {
  it('accepts a minimal plan', () => {
    expect(() => RebuildPlanSchema.parse(minimalPlan())).not.toThrow();
  });
  it('rejects a javascript: link and a data: image', () => {
    const plan = minimalPlan();
    plan.sections[0]!.intro.links = [{ label: 'x', href: 'javascript:alert(1)', kind: 'phone' }];
    expect(() => RebuildPlanSchema.parse(plan)).toThrow();
    const plan2 = minimalPlan();
    plan2.sections[0]!.images = [{ src: 'data:image/png;base64,AA', alt: '' }];
    expect(() => RebuildPlanSchema.parse(plan2)).toThrow();
  });
  it('rejects an iframe host off the allowlist', () => {
    const plan = minimalPlan();
    plan.sections[0]!.embeds = [{ kind: 'map', src: 'https://evil.example/maps', title: 'Mapa' }];
    expect(() => RebuildPlanSchema.parse(plan)).toThrow();
  });
  it('rejects a color that is not #rrggbb', () => {
    const plan = minimalPlan();
    plan.theme.primary = 'red';
    expect(() => RebuildPlanSchema.parse(plan)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/validation/__tests__/rebuild.spec.ts`
Expected: FAIL — `rebuildEligibility` / `RebuildPlanSchema` are not exported.

- [ ] **Step 3: Add the types** in `packages/shared-types/src/index.ts`

Replace the variant list at line 1164:

```ts
/** The Bento template's layouts (REV-54) */
export const BENTO_LAYOUT_VARIANTS = ['bento', 'split', 'editorial', 'compact'] as const;
export type BentoLayoutVariant = (typeof BENTO_LAYOUT_VARIANTS)[number];
/** `original`: the section-by-section rebuild of the original home page (REV-110); the rest are Bento's */
export const MVP_LAYOUT_VARIANTS = ['original', ...BENTO_LAYOUT_VARIANTS] as const;
```

(keep the existing `export type MvpLayoutVariant = (typeof MVP_LAYOUT_VARIANTS)[number];`). Next to `MVP_LAYOUT_UNREAD_REASON` (line 1307) add:

```ts
/** The reason code of an MVP rebuilt from the original site's sections (REV-110) */
export const MVP_LAYOUT_REBUILD_REASON = 'rule:rebuild';
/** Kept on a manual `original` pick that had to fall back, so a regeneration tries the rebuild again */
export const MVP_LAYOUT_MANUAL_ORIGINAL = 'manual:original';
/** Why the rebuild fell back to the Bento template (REV-110); stored first in `layout.reasons` */
export const REBUILD_FALLBACK_REASONS = [
  'rebuild:unread',
  'rebuild:no_content',
  'rebuild:low_coverage',
  'rebuild:invalid',
  'rebuild:too_large',
] as const;
export type RebuildFallbackReason = (typeof REBUILD_FALLBACK_REASONS)[number];

export const REBUILD_OMISSIONS = ['section', 'nav_link', 'link', 'embed', 'image'] as const;
export type RebuildOmission = (typeof REBUILD_OMISSIONS)[number];

/** What the rebuild kept out and which fixes it applied (REV-110) */
export interface IMvpRebuildSummary {
  /** The reader's coverage ratio of the original page */
  coverage: number;
  /** Sections rendered (header and footer excluded) */
  sections: number;
  omitted: { what: RebuildOmission; reason: string; sample?: string }[];
  /** Fix codes, e.g. `contrast:3`, `overlay:1`, `alt:12`, `font:body-16`, `collapse:11`, `h1:hidden` */
  tuning: string[];
}

// The rebuild plan (REV-110): every decision of the rebuild, validated before it is rendered; never stored

export interface IRebuildImage {
  src: string;
  /** Empty for a decorative image; never invented */
  alt: string;
  width?: number;
  height?: number;
  /** Loaded eagerly (the first section); the rest are lazy */
  eager?: boolean;
}

/** `booking` → #booking; `anchor` → a section on the page */
export interface IRebuildLink {
  label: string;
  href: string;
  kind: 'booking' | 'anchor' | 'phone' | 'email' | 'map';
}

export interface IRebuildItem {
  title?: string;
  subtitle?: string;
  text: string[];
  image?: IRebuildImage;
  price?: string;
  rating?: number;
  links: IRebuildLink[];
}

export type IRebuildBlock =
  | { type: 'text'; text: string[] }
  | { type: 'items'; arrangement: SiteSectionArrangement; items: IRebuildItem[] };

export interface IRebuildSection {
  /** Anchor id, `s-<index>` */
  id: string;
  index: number;
  kind: SiteSectionKind;
  arrangement: SiteSectionArrangement;
  columns?: number;
  mediaSide?: 'left' | 'right';
  split?: number;
  /** 1 only for the hero's heading */
  headingLevel: 1 | 2;
  intro: { eyebrow?: string; heading?: string; text: string[]; links: IRebuildLink[] };
  items: IRebuildItem[];
  itemStyle?: ISiteItemStyle;
  extra: IRebuildBlock[];
  images: IRebuildImage[];
  embeds: { kind: 'map' | 'video'; src: string; title: string }[];
  /** The booking form renders here, in place of the original form or widget */
  booking: boolean;
  /** A long text section: its body sits in a collapsed <details> */
  collapsed: boolean;
  style: {
    background?: string;
    backgroundImage?: string;
    /** Text color after the contrast fix */
    text: string;
    /** Dark overlay opacity over a background photo, 0..1 */
    overlay?: number;
    align: 'left' | 'center';
    paddingY: number;
    fullBleed: boolean;
  };
}

export interface IRebuildPlan {
  language: string;
  businessName: string;
  /** Set when no hero heading exists: the business name as a visually hidden h1 */
  hiddenH1?: string;
  year: number;
  theme: {
    primary: string;
    /** CTA text color, by contrast with `primary` */
    onPrimary: string;
    pageBackground: string;
    pageText: string;
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    headingUppercase: boolean;
    h1Size: number;
    h2Size: number;
    bodySize: number;
    lineHeight: number;
    buttonRadius: number;
    buttonUppercase: boolean;
  };
  header: {
    logo?: IRebuildImage;
    nav: { label: string; href: string }[];
    cta: { label: string };
    phone?: string;
  };
  sections: IRebuildSection[];
  /** No form or widget was replaced: the booking form goes just before the footer */
  bookingAppended: boolean;
  /** Options of the booking form's service select: titles of the original's services sections */
  bookingServices: string[];
  footer: {
    /** The original footer, when read */
    section?: IRebuildSection;
    contacts: { phone?: string; email?: string; address?: string; workingHours?: string };
    social: { label: string; href: string }[];
  };
  summary: IMvpRebuildSummary;
}
```

In `IMvpProject` (after `design?: IMvpDesign;`) add:

```ts
  /** What the rebuild left out and fixed (REV-110); absent when the page was rendered by the Bento template */
  rebuild?: IMvpRebuildSummary;
```

In `IBentoTemplateData` change `layout?: MvpLayoutVariant;` to `layout?: BentoLayoutVariant;`.

In `API_ERROR_CODES` after `'MVP_EDIT_TIMEOUT',` add:

```ts
  'MVP_EDIT_UNSUPPORTED',
  'MVP_REBUILD_UNAVAILABLE',
```

- [ ] **Step 4: Add the schemas** in `packages/validation/src/index.ts`

Import the new names from `@revamp/shared-types` (`BENTO_LAYOUT_VARIANTS`, `REBUILD_OMISSIONS`, `REBUILD_FALLBACK_REASONS`, `RebuildFallbackReason`, `ISiteSections`, `SITE_SECTION_ARRANGEMENTS` if not imported, `SITE_SECTION_KINDS`, `SITE_IMAGE_SHAPES`). Replace `manualMvpLayout`'s `facts` line and add after `MvpLayoutVariantSchema`:

```ts
export const BentoLayoutVariantSchema = z.enum(BENTO_LAYOUT_VARIANTS);

/** Codes that describe one render (REV-110), not the audit; a new pick starts without them */
const isRenderOutcome = (reason: string) =>
  reason.startsWith('rule:') || reason.startsWith('rebuild:') || reason.startsWith('coverage:') || reason.startsWith('manual:');
```

and in `manualMvpLayout`: `const facts = (previous?.reasons ?? []).filter((reason) => !isRenderOutcome(reason));`

Change `BentoTemplateDataSchema`'s `layout` field (search `layout: MvpLayoutVariantSchema` inside it) to `layout: BentoLayoutVariantSchema.optional()`.

Append (after the site sections schemas, since it uses `siteHex`):

```ts
// ---------------------------------------------------------------------------------------------
// Section rebuild (REV-110)
// ---------------------------------------------------------------------------------------------

/** Below this share of the original page's text the MVP falls back to the Bento template */
export const REBUILD_MIN_COVERAGE = 0.85;

export type RebuildEligibility = { ok: true } | { ok: false; reason: RebuildFallbackReason; facts: string[] };

/**
 * Whether the audit's sections can be rebuilt (REV-110). The plan and size checks happen at render
 * time; these are the checks the API can make before it accepts a switch to `original`.
 */
export function rebuildEligibility(
  audit: { siteSections?: ISiteSections | null; siteSectionsError?: string | null } | null | undefined,
): RebuildEligibility {
  const read = audit?.siteSections;
  if (!read || audit?.siteSectionsError) return { ok: false, reason: 'rebuild:unread', facts: [] };
  if (!read.sections.some((section) => section.role === 'hero' || section.role === 'content')) {
    return { ok: false, reason: 'rebuild:no_content', facts: [] };
  }
  if (read.coverage.ratio < REBUILD_MIN_COVERAGE) {
    return { ok: false, reason: 'rebuild:low_coverage', facts: [`coverage:${read.coverage.ratio}`] };
  }
  return { ok: true };
}

export const REBUILD_SUMMARY_LIMITS = { omitted: 80, tuning: 120 } as const;

export const MvpRebuildSummarySchema = z.object({
  coverage: z.number().min(0).max(1),
  sections: z.number().int().min(0),
  omitted: z
    .array(z.object({ what: z.enum(REBUILD_OMISSIONS), reason: z.string().min(1).max(60), sample: z.string().max(120).optional() }))
    .max(REBUILD_SUMMARY_LIMITS.omitted),
  tuning: z.array(z.string().min(1).max(60)).max(REBUILD_SUMMARY_LIMITS.tuning),
});

/** Iframe hosts the rebuild may embed (REV-110) */
export const REBUILD_IFRAME_HOSTS = [
  /^https:\/\/(www\.)?google\.[a-z.]+\/maps/i,
  /^https:\/\/maps\.google\.[a-z.]+\//i,
  /^https:\/\/(www\.)?openstreetmap\.org\//i,
  /^https:\/\/(www\.)?youtube\.com\/embed\//i,
  /^https:\/\/(www\.)?youtube-nocookie\.com\/embed\//i,
  /^https:\/\/player\.vimeo\.com\/video\//i,
];

const rebuildText = z.string().min(1).max(SITE_SECTIONS_LIMITS.textChars);
const rebuildShort = z.string().min(1).max(300);
const rebuildHttp = z.string().max(2000).regex(/^https?:\/\//i, 'Only http(s) URLs are allowed');
const RebuildImageSchema = z.object({
  src: rebuildHttp,
  alt: z.string().max(300),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  eager: z.boolean().optional(),
});
const RebuildLinkSchema = z
  .object({ label: rebuildShort, href: z.string().max(2000), kind: z.enum(['booking', 'anchor', 'phone', 'email', 'map']) })
  .refine(
    (link) =>
      ({
        booking: link.href === '#booking',
        anchor: /^#s-\d+$/.test(link.href),
        phone: /^tel:\+?[\d]{3,20}$/.test(link.href),
        email: /^mailto:[^\s@<>"]+@[^\s@<>"]+$/.test(link.href),
        map: /^https?:\/\//i.test(link.href),
      })[link.kind],
    'Link href does not match its kind',
  );
const RebuildItemSchema = z.object({
  title: rebuildShort.optional(),
  subtitle: rebuildShort.optional(),
  text: z.array(rebuildText).max(SITE_SECTIONS_LIMITS.textStrings),
  image: RebuildImageSchema.optional(),
  price: rebuildShort.optional(),
  rating: z.number().min(0).max(5).optional(),
  links: z.array(RebuildLinkSchema).max(SITE_SECTIONS_LIMITS.links),
});
const RebuildSectionSchema = z.object({
  id: z.string().regex(/^s-\d+$/),
  index: z.number().int().min(0),
  kind: z.enum(SITE_SECTION_KINDS),
  arrangement: z.enum(SITE_SECTION_ARRANGEMENTS),
  columns: z.number().int().min(1).max(8).optional(),
  mediaSide: z.enum(['left', 'right']).optional(),
  split: z.number().min(0.1).max(0.9).optional(),
  headingLevel: z.union([z.literal(1), z.literal(2)]),
  intro: z.object({
    eyebrow: rebuildShort.optional(),
    heading: rebuildShort.optional(),
    text: z.array(rebuildText).max(SITE_SECTIONS_LIMITS.textStrings),
    links: z.array(RebuildLinkSchema).max(SITE_SECTIONS_LIMITS.links),
  }),
  items: z.array(RebuildItemSchema).max(SITE_SECTIONS_LIMITS.items),
  itemStyle: z
    .object({
      background: siteHex.optional(),
      radius: z.number().min(0).max(999).optional(),
      border: z.boolean().optional(),
      shadow: z.boolean().optional(),
      imageShape: z.enum(SITE_IMAGE_SHAPES).optional(),
      align: z.enum(['left', 'center']).optional(),
    })
    .optional(),
  extra: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.array(rebuildText).max(SITE_SECTIONS_LIMITS.textStrings) }),
        z.object({ type: z.literal('items'), arrangement: z.enum(SITE_SECTION_ARRANGEMENTS), items: z.array(RebuildItemSchema).max(SITE_SECTIONS_LIMITS.items) }),
      ]),
    )
    .max(SITE_SECTIONS_LIMITS.extra),
  images: z.array(RebuildImageSchema).max(SITE_SECTIONS_LIMITS.images),
  embeds: z
    .array(
      z.object({
        kind: z.enum(['map', 'video']),
        src: rebuildHttp.refine((src) => REBUILD_IFRAME_HOSTS.some((host) => host.test(src)), 'Iframe host not allowed'),
        title: rebuildShort,
      }),
    )
    .max(SITE_SECTIONS_LIMITS.embeds),
  booking: z.boolean(),
  collapsed: z.boolean(),
  style: z.object({
    background: siteHex.optional(),
    backgroundImage: rebuildHttp.optional(),
    text: siteHex,
    overlay: z.number().min(0).max(1).optional(),
    align: z.enum(['left', 'center']),
    paddingY: z.number().int().min(0).max(200),
    fullBleed: z.boolean(),
  }),
});

export const RebuildPlanSchema = z.object({
  language: z.string().min(2).max(35),
  businessName: rebuildShort,
  hiddenH1: rebuildShort.optional(),
  year: z.number().int().min(2000).max(2200),
  theme: z.object({
    primary: siteHex,
    onPrimary: siteHex,
    pageBackground: siteHex,
    pageText: siteHex,
    headingFont: z.string().min(1).max(300),
    bodyFont: z.string().min(1).max(300),
    headingWeight: z.number().int().min(100).max(1000),
    headingUppercase: z.boolean(),
    h1Size: z.number().min(16).max(96),
    h2Size: z.number().min(16).max(72),
    bodySize: z.number().min(16).max(22),
    lineHeight: z.number().min(1.5).max(2.2),
    buttonRadius: z.number().min(0).max(999),
    buttonUppercase: z.boolean(),
  }),
  header: z.object({
    logo: RebuildImageSchema.optional(),
    nav: z.array(z.object({ label: rebuildShort, href: z.string().regex(/^#s-\d+$/) })).max(SITE_SECTIONS_LIMITS.links),
    cta: z.object({ label: rebuildShort }),
    phone: z.string().max(30).optional(),
  }),
  sections: z.array(RebuildSectionSchema).min(1).max(SITE_SECTIONS_LIMITS.sections),
  bookingAppended: z.boolean(),
  bookingServices: z.array(z.string().min(1).max(60)).max(SITE_SECTIONS_LIMITS.items),
  footer: z.object({
    section: RebuildSectionSchema.optional(),
    contacts: z.object({
      phone: z.string().max(30).optional(),
      email: z.string().email().max(254).optional(),
      address: z.string().max(300).optional(),
      workingHours: z.string().max(300).optional(),
    }),
    social: z.array(z.object({ label: rebuildShort, href: rebuildHttp })).max(12),
  }),
  summary: MvpRebuildSummarySchema,
});
```

Check `SITE_SECTIONS_LIMITS` for the exact key names used above (`textChars`, `textStrings`, `links`, `items`, `images`, `embeds`, `extra`, `sections`) by reading lines 232–250 of the same file; use the existing keys (rename in this code if they differ, e.g. `strings` instead of `textStrings`).

- [ ] **Step 5: Declare the field** in `packages/db/src/models/MvpProject.model.ts` after `design`:

```ts
    // REV-110: what the rebuild of the original site left out and which fixes it applied
    rebuild: { type: Schema.Types.Mixed },
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/validation/__tests__/rebuild.spec.ts`
Expected: PASS.
Then `npm run build:packages` — expected to succeed. Workers and dashboard may now fail typecheck where `Record<MvpLayoutVariant, …>` misses `original`; Task 2 fixes that.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types packages/validation packages/db
git commit -m "feat(REV-110): rebuild plan types, schemas and eligibility"
```

---

### Task 2: Bento keeps its own variant type

**Files:**
- Modify: `apps/workers/src/templates/bento.template.ts` (lines 1, 71, 211, 257, 497, 562, 698–699, 719)
- Modify: `apps/workers/src/services/template.service.ts:62`
- Modify: `apps/workers/src/services/layout-selection.service.ts:18,86,170`
- Modify: `apps/workers/src/services/mvp-edit.service.ts:18-20,43,56,77,307`
- Modify: `apps/workers/src/workers/mvp-edit.worker.ts:6-7,86-87`
- Test: existing `apps/workers/src/templates/__tests__/layout-switch.spec.ts`, `services/__tests__/layout-selection.service.spec.ts`, `services/__tests__/mvp-edit.service.spec.ts`

**Interfaces:**
- Consumes: `BENTO_LAYOUT_VARIANTS`, `BentoLayoutVariant` (Task 1).
- Produces: `bentoTemplateService.renderFromAudit(lead, audit, content, layout?: BentoLayoutVariant, palette?, design?)`; `deriveMvpLayout` / `selectMvpLayout` return a selection whose `variant` is a `BentoLayoutVariant`.

- [ ] **Step 1:** In every file listed, replace `MVP_LAYOUT_VARIANTS` with `BENTO_LAYOUT_VARIANTS` and `MvpLayoutVariant` with `BentoLayoutVariant`, except that `mvp-edit.worker.ts:86-87` becomes:

```ts
  // The rebuilt original (REV-110) is not edited by the free-text change until REV-111; the API refuses it
  const layout: BentoLayoutVariant =
    savedVariant && (BENTO_LAYOUT_VARIANTS as readonly string[]).includes(savedVariant) ? (savedVariant as BentoLayoutVariant) : 'bento';
```

In `layout-selection.service.ts`, `deriveMvpLayout`/`selectMvpLayout` keep returning `IMvpLayoutSelection`; only the local `variant` variables and `pick` take `BentoLayoutVariant`. In `mvp-edit.service.ts` the model is offered only Bento layouts (`BENTO_LAYOUT_VARIANTS.map(...)` at line 307).

- [ ] **Step 2: Typecheck and run the affected tests**

Run: `npm run typecheck --workspace=@revamp/workers && npx vitest run apps/workers/src/templates apps/workers/src/services/__tests__/layout-selection.service.spec.ts apps/workers/src/services/__tests__/mvp-edit.service.spec.ts apps/workers/src/workers/__tests__/mvp-edit.worker.spec.ts`
Expected: PASS. If a test iterates `MVP_LAYOUT_VARIANTS` to render Bento (e.g. `layout-switch.spec.ts`), switch it to `BENTO_LAYOUT_VARIANTS`.

- [ ] **Step 3: Commit**

```bash
git add apps/workers
git commit -m "refactor(REV-110): Bento renders only its own layout variants"
```

---

### Task 3: Extract the shared page pieces from Bento (output unchanged)

**Files:**
- Create: `apps/workers/src/templates/shared/page.ts`, `apps/workers/src/templates/shared/booking.ts`
- Modify: `apps/workers/src/templates/bento.template.ts` (lines 11–69 helpers; 287–310 monogram; 600–682 booking section; 1757–1868 booking script and tracker tag)
- Test: `apps/workers/src/templates/__tests__/bento-snapshot.spec.ts`

**Interfaces:**
- Produces:
  - `scriptJson(value: unknown): string`, `svgDataUri(svg: string): string`, `hexToRgb(hex: string): string`, `monogramSvg(businessName: string, color: string): string`, `resolveTrackerUrls(publicApiUrl?: string)` (re-exported from `bento.template.ts` for existing imports), `trackerScriptTag(tracker, trackingToken?: string): string` — all in `shared/page.ts`.
  - `bookingFormHtml(opts: { t: MvpStrings; businessName: string; heading: string; serviceOptionsHtml: string }): string` returns the `<div class="booking-wrapper">…</div>` block; `bookingScript(opts: { t: MvpStrings; tracker: ReturnType<typeof resolveTrackerUrls>; trackingToken?: string; themeVars: { primary: string; primaryRgb?: string; secondary?: string; accent?: string } }): string` returns the whole `<script>…</script>` including the `REVAMP_UPDATE_THEME` listener, where `themeVars` names the CSS custom properties to set (Bento passes `--brand-primary`, `--brand-primary-rgb`, `--brand-secondary`, `--brand-accent`).

- [ ] **Step 1: Write the snapshot test first, against the current code**

`apps/workers/src/templates/__tests__/bento-snapshot.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IBentoTemplateData, BENTO_LAYOUT_VARIANTS } from '@revamp/shared-types';
import { generateBentoHtml } from '../bento.template.js';

const data: IBentoTemplateData = {
  businessName: 'Warsaw Dental Center',
  language: 'pl',
  palette: { primary: '#0e7490', secondary: '#1e293b', accent: '#0e7490' },
  contacts: { phone: '+48 22 542 18 04', email: 'kontakt@wdc.example', address: 'ul. Powstańców Śląskich 7a', workingHours: 'Pn-Pt 9-21' },
  hero: { headline: 'Klinika', subheadline: 'Od 2010 roku.' },
  services: [{ title: 'Implanty', description: 'Tytan.', lucideIconName: 'shield-check' }],
  trustSignals: [],
  reviews: [{ author: 'Anna', comment: 'Polecam!', source: 'Website' }],
  gallery: ['https://wdc.example/1.jpg'],
  publicApiUrl: 'https://api.example/api/v1',
  trackingToken: 'tok_123',
};

// Taken before the shared pieces moved out of the template (REV-110); the move must not change a byte
describe('Bento output is unchanged by the shared extraction', () => {
  for (const layout of BENTO_LAYOUT_VARIANTS) {
    it(`renders the ${layout} layout exactly as before`, () => {
      expect(generateBentoHtml({ ...data, layout })).toMatchSnapshot();
    });
  }
  it('renders without a tracker or a logo exactly as before', () => {
    expect(generateBentoHtml({ ...data, publicApiUrl: undefined, trackingToken: undefined })).toMatchSnapshot();
  });
});
```

If `IBentoTemplateData` has no `trackingToken` field, drop it from `data` (check the interface at shared-types line 1309).

- [ ] **Step 2: Record the snapshot on the unchanged template**

Run: `npx vitest run apps/workers/src/templates/__tests__/bento-snapshot.spec.ts`
Expected: PASS, writing `__snapshots__/bento-snapshot.spec.ts.snap`. Commit it now so the refactor is judged against it:

```bash
git add apps/workers/src/templates/__tests__
git commit -m "test(REV-110): snapshot Bento before extracting shared pieces"
```

- [ ] **Step 3: Move the helpers**

Create `shared/page.ts` by moving `hexToRgb`, `scriptJson`, `svgDataUri` and `resolveTrackerUrls` verbatim from `bento.template.ts` (export all four), plus:

```ts
/** Generated inline SVG monogram, used when the site has neither a logo nor a monogram */
export function monogramSvg(businessName: string, color: string): string {
  const initials =
    businessName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || 'R';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <rect width="44" height="44" rx="10" fill="${color}" />
          <text x="22" y="28" fill="#ffffff" font-family="system-ui, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${escapeHtml(initials)}</text>
        </svg>`;
}

/** The engagement tracker, loaded from the API rather than the storage host (REV-52) */
export function trackerScriptTag(tracker: ReturnType<typeof resolveTrackerUrls>, trackingToken?: string): string {
  return tracker
    ? `<script src="${escapeHtml(tracker.scriptSrc)}" data-api="${escapeHtml(tracker.apiOrigin)}" data-token="${escapeHtml(trackingToken)}" async></script>`
    : '';
}
```

In `bento.template.ts`: import these, add `export { resolveTrackerUrls } from './shared/page.js';`, replace the inline `fallbackMonogramSvg` template with `monogramSvg(data.businessName, primaryColor)`, and the trailing tracker ternary with `${trackerScriptTag(tracker, data.trackingToken)}`.

Create `shared/booking.ts`: move the markup from `<div class="booking-wrapper">` to its closing `</div>` (currently lines 604–679) into `bookingFormHtml`, taking the `section-title` text as `heading` (Bento passes its `primaryCtaText`, already escaped — so `bookingFormHtml` inserts `heading` as-is and documents that it must be escaped by the caller) and the `<option>` list as `serviceOptionsHtml`. Move the second `<script>` block (lines 1757–1864) into `bookingScript`; its `REVAMP_UPDATE_THEME` listener sets the property names from `themeVars` instead of the hard-coded `--brand-*` names. Keep every character of whitespace the same so the snapshot holds.

- [ ] **Step 4: Run the snapshot**

Run: `npx vitest run apps/workers/src/templates`
Expected: PASS with no snapshot written or updated. A diff means whitespace moved; fix the extraction, never update the snapshot.

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/templates
git commit -m "refactor(REV-110): share the booking form, tracker and monogram with the rebuild"
```

---

### Task 4: Tuning helpers (color and type)

**Files:**
- Create: `apps/workers/src/services/rebuild-tuning.ts`
- Modify: `apps/workers/src/templates/design.ts:190` (`export const FONT_STACKS`)
- Test: `apps/workers/src/services/__tests__/rebuild-tuning.spec.ts`

**Interfaces:**
- Produces: `contrastRatio(a: string, b: string): number`, `readableText(text: string | undefined, background: string): { color: string; changed: boolean }`, `onColor(background: string): '#111111' | '#ffffff'`, `BANNER_OVERLAY = 0.55`, `fontStack(family: string | undefined): string`, `typeScale(typography?: ISiteTypography): { h1Size; h2Size; bodySize; lineHeight; headingWeight; headingUppercase; tuning: string[] }`, `clampPadding(px?: number): number`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { BANNER_OVERLAY, clampPadding, contrastRatio, fontStack, onColor, readableText, typeScale } from '../rebuild-tuning.js';
import { FONT_STACKS } from '../../templates/design.js';

describe('contrast (REV-110)', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
  it('keeps a readable color', () => {
    expect(readableText('#222222', '#ffffff')).toEqual({ color: '#222222', changed: false });
  });
  it('darkens a pale text on white until it passes', () => {
    const fixed = readableText('#aaaaaa', '#ffffff');
    expect(fixed.changed).toBe(true);
    expect(contrastRatio(fixed.color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('reads white on white as unreadable and fixes it', () => {
    const fixed = readableText('#ffffff', '#ffffff');
    expect(contrastRatio(fixed.color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('uses the better of near-black and white with no text color', () => {
    expect(readableText(undefined, '#0b1f3a').color).toBe('#ffffff');
    expect(readableText(undefined, '#f5f5f5').color).toBe('#111111');
  });
  it('picks the CTA text color by contrast', () => {
    expect(onColor('#0e7490')).toBe('#ffffff');
    expect(onColor('#fde047')).toBe('#111111');
  });
  it('the banner overlay makes white text pass over a white photo', () => {
    const grey = Math.round(255 * (1 - BANNER_OVERLAY)).toString(16).padStart(2, '0');
    expect(contrastRatio('#ffffff', `#${grey}${grey}${grey}`)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('type (REV-110)', () => {
  it('maps families to system stacks', () => {
    expect(fontStack('"Playfair Display", serif')).toBe(FONT_STACKS.serif);
    expect(fontStack('Montserrat, sans-serif')).toBe(FONT_STACKS.geometric);
    expect(fontStack('Nunito')).toBe(FONT_STACKS.rounded);
    expect(fontStack('Roboto Mono')).toBe(FONT_STACKS.mono);
    expect(fontStack('Open Sans')).toBe(FONT_STACKS.humanist);
    expect(fontStack(undefined)).toBe(FONT_STACKS.humanist);
  });
  it('raises small body text and tight line height, and records it', () => {
    const scale = typeScale({
      heading: { family: 'Lato', size: 30, weight: 700, uppercase: true },
      body: { family: 'Lato', size: 14, weight: 400, lineHeight: 1.2 },
    });
    expect(scale).toMatchObject({ bodySize: 16, lineHeight: 1.5, headingWeight: 700, headingUppercase: true, h2Size: 30 });
    expect(scale.tuning).toEqual(['font:body-16', 'line-height:1.5']);
  });
  it('bounds heading sizes and defaults without typography', () => {
    expect(typeScale({ heading: { family: 'x', size: 90, weight: 800, uppercase: false }, body: { family: 'x', size: 18, weight: 400 } }))
      .toMatchObject({ h2Size: 48, h1Size: 64, bodySize: 18, lineHeight: 1.6 });
    expect(typeScale(undefined)).toMatchObject({ h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, headingWeight: 700 });
  });
  it('clamps section padding to 48..120', () => {
    expect(clampPadding(10)).toBe(48);
    expect(clampPadding(80)).toBe(80);
    expect(clampPadding(300)).toBe(120);
    expect(clampPadding(undefined)).toBe(64);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-tuning.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

In `design.ts` change `const FONT_STACKS = {` to `export const FONT_STACKS = {`. Create `rebuild-tuning.ts`:

```ts
import type { ISiteTypography } from '@revamp/shared-types';
import { FONT_STACKS } from '../templates/design.js';

// Deterministic tuning of the rebuilt page (REV-110): color contrast and type, no LLM

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) =>
  0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));

/** WCAG 2 contrast ratio of two #rrggbb colors */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const mix = (hex: string, target: number, share: number) =>
  `#${[0, 1, 2].map((i) => toHex(channel(hex, i) * 255 * (1 - share) + target * share)).join('')}`;

/** Near-black or white, whichever reads better on the background */
export function onColor(background: string): '#111111' | '#ffffff' {
  return contrastRatio('#111111', background) >= contrastRatio('#ffffff', background) ? '#111111' : '#ffffff';
}

/**
 * The text color made readable on its background (AA, 4.5:1): kept when it passes, else moved toward
 * black or white in 10% steps, else near-black or white
 */
export function readableText(text: string | undefined, background: string): { color: string; changed: boolean } {
  if (!text) return { color: onColor(background), changed: false };
  if (contrastRatio(text, background) >= AA) return { color: text, changed: false };
  const target = onColor(background) === '#111111' ? 0 : 255;
  for (let share = 0.1; share < 1; share += 0.1) {
    const candidate = mix(text, target, share);
    if (contrastRatio(candidate, background) >= AA) return { color: candidate, changed: true };
  }
  return { color: onColor(background), changed: true };
}

/** Dark overlay over a background photo: white text reaches AA even over a white photo */
export const BANNER_OVERLAY = 0.55;

const FAMILY_RULES: Array<[RegExp, keyof typeof FONT_STACKS]> = [
  [/mono|code|courier|consolas/i, 'mono'],
  [/nunito|quicksand|comfortaa|varela round|rounded|baloo|fredoka/i, 'rounded'],
  [/montserrat|poppins|raleway|futura|avenir|josefin|urbanist|outfit|manrope|gotham|century gothic|jost/i, 'geometric'],
  [/playfair|merriweather|lora|georgia|times|garamond|cormorant|baskerville|pt serif|noto serif|libre|crimson|(^|[^-\w])serif/i, 'serif'],
];

/** The system font stack nearest to the original family; the page loads no external fonts */
export function fontStack(family: string | undefined): string {
  const name = (family ?? '').replace(/sans-serif/gi, '');
  const rule = FAMILY_RULES.find(([pattern]) => pattern.test(name));
  return FONT_STACKS[rule?.[1] ?? 'humanist'];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Heading and body sizes from the original, bounded, with the fixes applied recorded */
export function typeScale(typography: ISiteTypography | undefined) {
  const tuning: string[] = [];
  const h2Size = clamp(Math.round(typography?.heading.size ?? 34), 24, 48);
  const h1Size = clamp(Math.round(h2Size * 1.4), 32, 64);
  const originalBody = Math.round(typography?.body.size ?? 16);
  const bodySize = clamp(originalBody, 16, 20);
  if (originalBody < 16) tuning.push('font:body-16');
  const originalLine = typography?.body.lineHeight;
  const lineHeight = originalLine === undefined ? 1.6 : clamp(originalLine, 1.5, 1.9);
  if (originalLine !== undefined && originalLine < 1.5) tuning.push('line-height:1.5');
  return {
    h1Size,
    h2Size,
    bodySize,
    lineHeight,
    headingWeight: clamp(Math.round((typography?.heading.weight ?? 700) / 100) * 100, 400, 900),
    headingUppercase: typography?.heading.uppercase ?? false,
    tuning,
  };
}

/** Section padding per side, px: the original's, bounded to 48..120 */
export const clampPadding = (px: number | undefined): number => clamp(Math.round(px ?? 64), 48, 120);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-tuning.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/services/rebuild-tuning.ts apps/workers/src/services/__tests__/rebuild-tuning.spec.ts apps/workers/src/templates/design.ts
git commit -m "feat(REV-110): deterministic contrast and type tuning helpers"
```

---

### Task 5: The planner (`planRebuild`)

**Files:**
- Create: `apps/workers/src/services/rebuild-plan.service.ts`
- Modify: `apps/workers/src/templates/mvp-locale.ts` (add five strings to `MvpStrings` and all five languages)
- Test: `apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts`, `apps/workers/src/templates/__tests__/mvp-locale.spec.ts` (existing; it checks all languages have all keys)

**Interfaces:**
- Consumes: `IRebuildPlan` & parts (Task 1), tuning helpers (Task 4), `getMvpStrings`, `sanitizeLanguageTag`.
- Produces:

```ts
export interface RebuildInput {
  siteSections: ISiteSections;
  businessName: string;
  language?: string;
  contacts: { phone?: string; email?: string; address?: string; workingHours?: string };
  socialLinks: { platform?: string; url: string }[];
  logoUrl?: string;
  primary: string;
  year: number;
}
export function planRebuild(input: RebuildInput): IRebuildPlan;
export const COLLAPSE_CHARS = 1200;
export const BOOKING_HOSTS: RegExp;
```

- [ ] **Step 1: Add the locale strings**

In `MvpStrings` add:

```ts
  mapTitle: string;
  videoTitle: string;
  previousSlide: string;
  nextSlide: string;
  readMore: string;
```

Values per language (`en`, `ru`, `be`, `pl`, `lt`):

| key | en | ru | be | pl | lt |
|---|---|---|---|---|---|
| mapTitle | Map | Карта | Карта | Mapa | Žemėlapis |
| videoTitle | Video | Видео | Відэа | Wideo | Vaizdo įrašas |
| previousSlide | Previous | Назад | Назад | Poprzedni | Ankstesnis |
| nextSlide | Next | Далее | Далей | Następny | Kitas |
| readMore | Read more | Подробнее | Падрабязней | Czytaj więcej | Skaityti daugiau |

Run: `npx vitest run apps/workers/src/templates/__tests__/mvp-locale.spec.ts` — Expected: PASS.

- [ ] **Step 2: Write the failing planner tests**

`apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ISiteSection, ISiteSections } from '@revamp/shared-types';
import { RebuildPlanSchema } from '@revamp/validation';
import { planRebuild, RebuildInput } from '../rebuild-plan.service.js';
import { contrastRatio } from '../rebuild-tuning.js';
import { getMvpStrings } from '../../templates/mvp-locale.js';

const section = (index: number, over: Partial<ISiteSection> = {}): ISiteSection => ({
  index, role: 'content', kind: 'other', arrangement: 'text',
  intro: { heading: `Sekcja ${index}`, text: ['Tekst sekcji.'], links: [] },
  items: [], extra: [], images: [], embeds: [], style: {}, ...over,
});

const read = (sections: ISiteSection[], over: Partial<ISiteSections> = {}): ISiteSections => ({
  sections, skipped: [], coverage: { pageChars: 1000, capturedChars: 980, ratio: 0.98, uncaptured: [] }, ...over,
});

const input = (sections: ISiteSection[], over: Partial<RebuildInput> = {}): RebuildInput => ({
  siteSections: read(sections),
  businessName: 'Falco-Dent',
  language: 'pl-PL',
  contacts: { phone: '+48 510 510 706', email: 'recepcja@falcodent.pl', address: 'ul. Kasprowicza 1, Warszawa' },
  socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/falcodent' }],
  primary: '#0e7490',
  year: 2026,
  ...over,
});

const header = section(0, {
  role: 'header', intro: { text: [], links: [
    { label: 'Zespół', href: 'https://falcodent.pl/#zespol', kind: 'link' },
    { label: 'Cennik', href: 'https://falcodent.pl/cennik/', kind: 'link' },
    { label: 'Umów wizytę', href: 'https://booksy.com/pl-pl/123', kind: 'cta' },
  ] },
  images: [{ src: 'https://falcodent.pl/logo.png', alt: 'Falco-Dent' }],
});
const hero = section(1, { role: 'hero', arrangement: 'banner', intro: { heading: 'Stomatologia estetyczna', text: ['Witamy'], links: [] },
  style: { backgroundImage: 'https://falcodent.pl/hero.jpg', textColor: '#ffffff' } });
const team = section(2, { kind: 'team', arrangement: 'card-grid', columns: 3, intro: { heading: 'Zespół', text: [], links: [] },
  items: [{ title: 'Dr Anna', subtitle: 'Ortodonta', text: ['Bio'], image: { src: 'https://falcodent.pl/a.jpg' }, links: [] }] });

describe('planRebuild (REV-110)', () => {
  it('keeps every section in order and validates', () => {
    const plan = planRebuild(input([header, hero, team]));
    expect(plan.sections.map((s) => s.id)).toEqual(['s-1', 's-2']);
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
    expect(plan.summary).toMatchObject({ coverage: 0.98, sections: 2 });
  });

  it('gives the hero heading the only h1', () => {
    const plan = planRebuild(input([header, hero, team]));
    expect(plan.sections.map((s) => s.headingLevel)).toEqual([1, 2]);
    expect(plan.hiddenH1).toBeUndefined();
  });

  it('uses a hidden business-name h1 when there is no hero heading', () => {
    const plan = planRebuild(input([header, team]));
    expect(plan.sections.every((s) => s.headingLevel === 2)).toBe(true);
    expect(plan.hiddenH1).toBe('Falco-Dent');
    expect(plan.summary.tuning).toContain('h1:hidden');
  });

  it('turns nav links into anchors of matching sections and drops the rest, recorded', () => {
    const plan = planRebuild(input([header, hero, team]));
    expect(plan.header.nav).toEqual([{ label: 'Zespół', href: '#s-2' }]);
    expect(plan.summary.omitted).toContainEqual({ what: 'nav_link', reason: 'other_page', sample: 'Cennik' });
  });

  it('points the header CTA and booking hosts to #booking with the original label', () => {
    const plan = planRebuild(input([header, hero]));
    expect(plan.header.cta.label).toBe('Umów wizytę');
    const withLink = planRebuild(input([header, section(1, { intro: { heading: 'H', text: [], links: [
      { label: 'Zapisz się', href: 'https://booksy.com/x', kind: 'link' },
      { label: 'Więcej', href: 'https://falcodent.pl/oferta/', kind: 'link' },
      { label: '510 510 706', href: 'tel:+48510510706', kind: 'phone' },
      { label: 'Klik', href: 'javascript:alert(1)', kind: 'cta' },
    ] } })]));
    expect(withLink.sections[0]!.intro.links).toEqual([
      { label: 'Zapisz się', href: '#booking', kind: 'booking' },
      { label: '510 510 706', href: 'tel:+48510510706', kind: 'phone' },
    ]);
    expect(withLink.summary.omitted.filter((o) => o.what === 'link')).toHaveLength(2);
  });

  it('falls back to the locale CTA label without a header CTA', () => {
    expect(planRebuild(input([hero])).header.cta.label).toBe(getMvpStrings('pl').sendRequest);
  });

  it('replaces the first form or widget with the booking form and keeps allowed iframes', () => {
    const plan = planRebuild(input([hero, section(2, { embeds: [
      { kind: 'form' },
      { kind: 'map', src: 'https://www.google.com/maps/embed?pb=1' },
      { kind: 'widget', src: 'https://booksy.com/widget' },
      { kind: 'video', src: 'https://evil.example/v' },
    ] })]));
    expect(plan.sections[1]).toMatchObject({ booking: true, embeds: [{ kind: 'map', src: 'https://www.google.com/maps/embed?pb=1', title: 'Mapa' }] });
    expect(plan.bookingAppended).toBe(false);
    expect(plan.summary.tuning).toContain('booking:replaced');
    expect(plan.summary.omitted.filter((o) => o.what === 'embed')).toHaveLength(2);
  });

  it('appends the booking form when nothing is replaced', () => {
    const plan = planRebuild(input([hero]));
    expect(plan.bookingAppended).toBe(true);
    expect(plan.summary.tuning).toContain('booking:appended');
  });

  it('adds a contacts-only footer when the site has none, and merges one that exists', () => {
    const none = planRebuild(input([hero]));
    expect(none.footer.section).toBeUndefined();
    expect(none.footer.contacts).toMatchObject({ phone: '+48 510 510 706', email: 'recepcja@falcodent.pl' });
    expect(none.summary.tuning).toContain('footer:added');
    const footer = section(9, { role: 'footer', kind: 'contact', intro: { text: ['Pon-Pt 9-20'], links: [] } });
    expect(planRebuild(input([hero, footer])).footer.section?.id).toBe('s-9');
  });

  it('collapses a long text section', () => {
    const plan = planRebuild(input([hero, section(2, { intro: { heading: 'RODO', text: ['x'.repeat(1300)], links: [] } })]));
    expect(plan.sections[1]!.collapsed).toBe(true);
    expect(plan.summary.tuning).toContain('collapse:2');
  });

  it('raises low contrast and overlays a banner photo', () => {
    const plan = planRebuild(input([hero, section(2, { style: { background: '#ffffff', textColor: '#cccccc' } })]));
    expect(plan.sections[0]!.style).toMatchObject({ overlay: 0.55, text: '#ffffff' });
    expect(contrastRatio(plan.sections[1]!.style.text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(plan.summary.tuning).toEqual(expect.arrayContaining(['overlay:1', 'contrast:2']));
  });

  it('reads text on a transparent section against the page background', () => {
    const plan = planRebuild(input([hero, section(2, { style: { textColor: '#ffffff' } })]));
    expect(contrastRatio(plan.sections[1]!.style.text, plan.theme.pageBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('takes alt text only from the original, the title or the heading', () => {
    const plan = planRebuild(input([hero, team, section(3, { images: [{ src: 'https://x.pl/1.jpg' }], intro: { text: ['t'], links: [] } })]));
    expect(plan.sections[1]!.items[0]!.image).toMatchObject({ alt: 'Dr Anna', eager: undefined });
    expect(plan.sections[2]!.images[0]!.alt).toBe('');
    expect(plan.summary.tuning).toContain('alt:1');
  });

  it('never keeps a data: image', () => {
    const plan = planRebuild(input([hero, section(2, { images: [{ src: 'data:image/gif;base64,R0lG' }] })]));
    expect(plan.sections[1]!.images).toEqual([]);
    expect(plan.summary.omitted).toContainEqual(expect.objectContaining({ what: 'image' }));
  });

  it('lists the services sections item titles as booking options', () => {
    const services = section(3, { kind: 'services', arrangement: 'card-grid', items: [
      { title: 'Implanty', text: [], links: [] }, { title: 'Ortodoncja', text: [], links: [] },
    ] });
    expect(planRebuild(input([hero, services])).bookingServices).toEqual(['Implanty', 'Ortodoncja']);
  });

  it('carries the reader skipped blocks into the omissions', () => {
    const plan = planRebuild({ ...input([hero]), siteSections: read([hero], { skipped: [{ index: 12, reason: 'noise', sample: 'Polityka prywatności' }] }) });
    expect(plan.summary.omitted).toContainEqual({ what: 'section', reason: 'noise', sample: 'Polityka prywatności' });
  });

  it('uses the header logo, else the brand logo', () => {
    expect(planRebuild(input([header, hero])).header.logo).toMatchObject({ src: 'https://falcodent.pl/logo.png', alt: 'Falco-Dent' });
    expect(planRebuild(input([hero], { logoUrl: 'https://x.pl/l.svg' })).header.logo?.src).toBe('https://x.pl/l.svg');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`apps/workers/src/services/rebuild-plan.service.ts`:

```ts
import type {
  IMvpRebuildSummary,
  IRebuildBlock,
  IRebuildImage,
  IRebuildItem,
  IRebuildLink,
  IRebuildPlan,
  IRebuildSection,
  ISiteImage,
  ISiteLink,
  ISiteSection,
  ISiteSectionItem,
  ISiteSections,
} from '@revamp/shared-types';
import { REBUILD_IFRAME_HOSTS, REBUILD_SUMMARY_LIMITS } from '@revamp/validation';
import { getMvpStrings, sanitizeLanguageTag } from '../templates/mvp-locale.js';
import { BANNER_OVERLAY, clampPadding, fontStack, onColor, readableText, typeScale } from './rebuild-tuning.js';

// The rebuild's decisions (REV-110): which sections, links, embeds and fixes. Pure; the renderer only
// turns the plan into markup, and nothing here adds a fact the original page does not have.

export interface RebuildInput {
  siteSections: ISiteSections;
  businessName: string;
  language?: string;
  contacts: { phone?: string; email?: string; address?: string; workingHours?: string };
  socialLinks: { platform?: string; url: string }[];
  logoUrl?: string;
  primary: string;
  year: number;
}

/** A `text` section longer than this puts its body in a collapsed <details> */
export const COLLAPSE_CHARS = 1200;
/** Booking and appointment hosts: a link there becomes the page's own booking form */
export const BOOKING_HOSTS = /(^|\.)(booksy\.com|znanylekarz\.pl|docplanner\.[a-z.]+|medfile\.pl|calendly\.com|reservio\.[a-z.]+)$/i;
const PAGE_BACKGROUND = '#ffffff';

const isHttp = (url: string | undefined): url is string => Boolean(url && /^https?:\/\//i.test(url));
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
const fold = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

class Recorder {
  readonly summary: IMvpRebuildSummary;
  private altFilled = 0;
  constructor(coverage: number) {
    this.summary = { coverage, sections: 0, omitted: [], tuning: [] };
  }
  /** One running `alt:<count>` code for the alt texts filled in from a title or heading */
  countAlt() {
    this.altFilled += 1;
    const at = this.summary.tuning.findIndex((code) => code.startsWith('alt:'));
    if (at >= 0) this.summary.tuning[at] = `alt:${this.altFilled}`;
    else this.fix(`alt:${this.altFilled}`);
  }
  omit(what: IMvpRebuildSummary['omitted'][number]['what'], reason: string, sample?: string) {
    if (this.summary.omitted.length >= REBUILD_SUMMARY_LIMITS.omitted) return;
    this.summary.omitted.push({ what, reason, ...(sample ? { sample: cut(sample, 120) } : {}) });
  }
  fix(code: string) {
    if (this.summary.tuning.length < REBUILD_SUMMARY_LIMITS.tuning && !this.summary.tuning.includes(code)) this.summary.tuning.push(code);
  }
}

function planLink(link: ISiteLink, rec: Recorder): IRebuildLink | null {
  const href = link.href.trim();
  if (link.kind === 'phone' && /^tel:/i.test(href)) {
    const digits = href.slice(4).replace(/[^+\d]/g, '');
    if (/^\+?\d{3,20}$/.test(digits)) return { label: link.label, href: `tel:${digits}`, kind: 'phone' };
  }
  if (link.kind === 'email' && /^mailto:[^\s@<>"]+@[^\s@<>"]+$/i.test(href.split('?')[0]!)) {
    return { label: link.label, href: href.split('?')[0]!, kind: 'email' };
  }
  if (isHttp(href) && (link.kind === 'cta' || BOOKING_HOSTS.test(hostOf(href)))) {
    return { label: link.label, href: '#booking', kind: 'booking' };
  }
  if (link.kind === 'map' && isHttp(href)) return { label: link.label, href, kind: 'map' };
  rec.omit('link', isHttp(href) ? 'other_page' : 'unsafe_url', link.label);
  return null;
}

const planLinks = (links: ISiteLink[], rec: Recorder) =>
  links.map((link) => planLink(link, rec)).filter((link): link is IRebuildLink => link !== null);

function planImage(image: ISiteImage | undefined, fallbackAlt: string | undefined, rec: Recorder, eager: boolean): IRebuildImage | undefined {
  if (!image) return undefined;
  if (!isHttp(image.src)) {
    rec.omit('image', 'not_http', image.src.slice(0, 40));
    return undefined;
  }
  const alt = image.alt?.trim() || fallbackAlt?.trim() || '';
  if (!image.alt?.trim() && alt) rec.countAlt();
  return {
    src: image.src,
    alt: cut(alt, 300),
    ...(image.width ? { width: Math.round(image.width) } : {}),
    ...(image.height ? { height: Math.round(image.height) } : {}),
    ...(eager ? { eager: true } : {}),
  };
}

function planItem(item: ISiteSectionItem, rec: Recorder, eager: boolean): IRebuildItem {
  return {
    ...(item.title ? { title: item.title } : {}),
    ...(item.subtitle ? { subtitle: item.subtitle } : {}),
    text: item.text,
    ...(item.image ? { image: planImage(item.image, item.title, rec, eager) } : {}),
    ...(item.price ? { price: item.price } : {}),
    ...(item.rating !== undefined ? { rating: item.rating } : {}),
    links: planLinks(item.links, rec),
  };
}

const textLength = (section: ISiteSection) =>
  [...section.intro.text, ...section.extra.flatMap((e) => (e.type === 'text' ? e.text : []))].join('').length;

function planSection(section: ISiteSection, ctx: { rec: Recorder; t: ReturnType<typeof getMvpStrings>; booking: { placed: boolean }; h1: { used: boolean } }): IRebuildSection {
  const { rec, t } = ctx;
  const eager = section.role === 'hero';
  const heading = section.intro.heading;
  const headingLevel: 1 | 2 = section.role === 'hero' && heading && !ctx.h1.used ? 1 : 2;
  if (headingLevel === 1) ctx.h1.used = true;

  let booking = false;
  const embeds: IRebuildSection['embeds'] = [];
  for (const embed of section.embeds) {
    if ((embed.kind === 'form' || embed.kind === 'widget') && !ctx.booking.placed) {
      ctx.booking.placed = booking = true;
      rec.fix('booking:replaced');
    } else if ((embed.kind === 'map' || embed.kind === 'video') && embed.src && REBUILD_IFRAME_HOSTS.some((host) => host.test(embed.src!))) {
      embeds.push({ kind: embed.kind, src: embed.src, title: embed.kind === 'map' ? t.mapTitle : t.videoTitle });
    } else {
      rec.omit('embed', embed.kind === 'form' || embed.kind === 'widget' ? 'second_form' : 'host_not_allowed', embed.src ?? embed.kind);
    }
  }

  const photo = isHttp(section.style.backgroundImage) ? section.style.backgroundImage : undefined;
  const background = section.style.background;
  let text: string;
  let overlay: number | undefined;
  if (photo) {
    overlay = BANNER_OVERLAY;
    text = '#ffffff';
    rec.fix(`overlay:${section.index}`);
  } else {
    const fixed = readableText(section.style.textColor, background ?? PAGE_BACKGROUND);
    text = fixed.color;
    if (fixed.changed) rec.fix(`contrast:${section.index}`);
  }

  const collapsed = section.arrangement === 'text' && textLength(section) > COLLAPSE_CHARS;
  if (collapsed) rec.fix(`collapse:${section.index}`);

  const extra: IRebuildBlock[] = section.extra.map((entry) =>
    entry.type === 'text' ? entry : { type: 'items', arrangement: entry.arrangement, items: entry.items.map((item) => planItem(item, rec, false)) },
  );

  return {
    id: `s-${section.index}`,
    index: section.index,
    kind: section.kind,
    arrangement: section.arrangement,
    ...(section.columns ? { columns: Math.min(8, section.columns) } : {}),
    ...(section.mediaSide ? { mediaSide: section.mediaSide } : {}),
    ...(section.style.split !== undefined ? { split: Math.min(0.9, Math.max(0.1, section.style.split)) } : {}),
    headingLevel,
    intro: {
      ...(section.intro.eyebrow ? { eyebrow: section.intro.eyebrow } : {}),
      ...(heading ? { heading } : {}),
      text: section.intro.text,
      links: planLinks(section.intro.links, rec),
    },
    items: section.items.map((item, i) => planItem(item, rec, eager && i === 0)),
    ...(section.itemStyle ? { itemStyle: section.itemStyle } : {}),
    extra,
    images: section.images
      .map((image, i) => planImage(image, heading, rec, eager && i === 0))
      .filter((image): image is IRebuildImage => Boolean(image)),
    embeds,
    booking,
    collapsed,
    style: {
      ...(background ? { background } : {}),
      ...(photo ? { backgroundImage: photo } : {}),
      text,
      ...(overlay !== undefined ? { overlay } : {}),
      align: section.style.align ?? 'left',
      paddingY: clampPadding(section.style.paddingY),
      fullBleed: section.style.fullBleed ?? false,
    },
  };
}

export function planRebuild(input: RebuildInput): IRebuildPlan {
  const read = input.siteSections;
  const rec = new Recorder(read.coverage.ratio);
  const language = sanitizeLanguageTag(input.language) ?? 'en';
  const t = getMvpStrings(language);
  for (const skipped of read.skipped) rec.omit('section', skipped.reason, skipped.sample || skipped.heading);

  const header = read.sections.find((s) => s.role === 'header');
  const footer = read.sections.find((s) => s.role === 'footer');
  const ctx = { rec, t, booking: { placed: false }, h1: { used: false } };
  const sections = read.sections.filter((s) => s.role === 'hero' || s.role === 'content').map((s) => planSection(s, ctx));
  rec.summary.sections = sections.length;
  if (!ctx.h1.used) rec.fix('h1:hidden');
  if (!ctx.booking.placed) rec.fix('booking:appended');

  // Header: logo, nav links that name a section on this page, and the CTA label
  const logo = planImage(header?.images[0], input.businessName, rec, true) ?? (isHttp(input.logoUrl) ? { src: input.logoUrl, alt: input.businessName, eager: true } : undefined);
  const nav: IRebuildPlan['header']['nav'] = [];
  let ctaLabel: string | undefined;
  for (const link of header?.intro.links ?? []) {
    if (link.kind === 'cta' || (isHttp(link.href) && BOOKING_HOSTS.test(hostOf(link.href)))) {
      ctaLabel ??= link.label;
      continue;
    }
    if (link.kind !== 'link') continue;
    const target = sections.find((s) => s.intro.heading && fold(s.intro.heading).startsWith(fold(link.label)));
    if (target && !nav.some((n) => n.href === `#${target.id}`)) nav.push({ label: link.label, href: `#${target.id}` });
    else rec.omit('nav_link', 'other_page', link.label);
  }

  const footerSection = footer ? planSection(footer, { ...ctx, h1: { used: true } }) : undefined;
  if (!footerSection) rec.fix('footer:added');

  const scale = typeScale(read.typography);
  scale.tuning.forEach((code) => rec.fix(code));
  const button = read.typography?.button;
  const email = input.contacts.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contacts.email) ? input.contacts.email : undefined;

  return {
    language,
    businessName: cut(input.businessName, 300),
    ...(ctx.h1.used ? {} : { hiddenH1: cut(input.businessName, 300) }),
    year: input.year,
    theme: {
      primary: input.primary,
      onPrimary: onColor(input.primary),
      pageBackground: PAGE_BACKGROUND,
      pageText: readableText(read.typography?.body.color, PAGE_BACKGROUND).color,
      headingFont: fontStack(read.typography?.heading.family),
      bodyFont: fontStack(read.typography?.body.family),
      headingWeight: scale.headingWeight,
      headingUppercase: scale.headingUppercase,
      h1Size: scale.h1Size,
      h2Size: scale.h2Size,
      bodySize: scale.bodySize,
      lineHeight: scale.lineHeight,
      buttonRadius: Math.min(999, Math.max(0, button?.radius ?? 6)),
      buttonUppercase: button?.uppercase ?? false,
    },
    header: {
      ...(logo ? { logo } : {}),
      nav,
      cta: { label: cut(ctaLabel ?? t.sendRequest, 300) },
      ...(input.contacts.phone ? { phone: input.contacts.phone.slice(0, 30) } : {}),
    },
    sections,
    bookingAppended: !ctx.booking.placed,
    bookingServices: read.sections
      .filter((s) => s.kind === 'services' || s.kind === 'pricing')
      .flatMap((s) => s.items.map((item) => item.title).filter((title): title is string => Boolean(title)))
      .map((title) => cut(title, 60))
      .slice(0, 60),
    footer: {
      ...(footerSection ? { section: footerSection } : {}),
      contacts: {
        ...(input.contacts.phone ? { phone: input.contacts.phone.slice(0, 30) } : {}),
        ...(email ? { email } : {}),
        ...(input.contacts.address ? { address: cut(input.contacts.address, 300) } : {}),
        ...(input.contacts.workingHours ? { workingHours: cut(input.contacts.workingHours, 300) } : {}),
      },
      social: input.socialLinks
        .filter((link) => isHttp(link.url))
        .slice(0, 12)
        .map((link) => ({ label: cut(link.platform || hostOf(link.url) || link.url, 300), href: link.url })),
    },
    summary: rec.summary,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts`
Expected: PASS. Fix the implementation, not the tests, if a case fails.

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/services/rebuild-plan.service.ts apps/workers/src/services/__tests__/rebuild-plan.service.spec.ts apps/workers/src/templates/mvp-locale.ts
git commit -m "feat(REV-110): plan the rebuild from the original sections, with tuning recorded"
```

---

### Task 6: The renderers (`renderRebuild`)

**Files:**
- Create: `apps/workers/src/templates/rebuild/index.ts`, `sections.ts`, `chrome.ts`, `styles.ts`, `script.ts`
- Test: `apps/workers/src/templates/__tests__/rebuild.template.spec.ts`, `apps/workers/src/templates/__tests__/rebuild-script.spec.ts`

**Interfaces:**
- Consumes: `IRebuildPlan` (Task 1), `bookingFormHtml`, `bookingScript`, `monogramSvg`, `svgDataUri`, `resolveTrackerUrls`, `trackerScriptTag` (Task 3), `escapeHtml`, `getMvpStrings`.
- Produces: `renderRebuild(plan: IRebuildPlan, opts?: { publicApiUrl?: string; trackingToken?: string }): string`; in `sections.ts`: `renderSection(section: IRebuildSection, ctx: RenderCtx): string`, `renderItem(item: IRebuildItem, level: 3 | 4): string`, `type RenderCtx = { t: MvpStrings; bookingHtml: string }`.

- [ ] **Step 1: Write the failing tests**

`rebuild.template.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SITE_SECTION_ARRANGEMENTS } from '@revamp/shared-types';
import type { IRebuildPlan, IRebuildSection } from '@revamp/shared-types';
import { renderRebuild } from '../rebuild/index.js';

const item = (title: string) => ({ title, subtitle: 'Rola', text: [`O ${title}`], image: { src: `https://x.pl/${title}.jpg`, alt: title }, price: 'od 150 zł', rating: 5, links: [] });
const section = (index: number, over: Partial<IRebuildSection> = {}): IRebuildSection => ({
  id: `s-${index}`, index, kind: 'other', arrangement: 'text', headingLevel: 2,
  intro: { heading: `Sekcja ${index}`, text: [`Tekst ${index}`], links: [] },
  items: [], extra: [], images: [], embeds: [], booking: false, collapsed: false,
  style: { text: '#111111', align: 'left', paddingY: 64, fullBleed: false }, ...over,
});
const plan = (sections: IRebuildSection[], over: Partial<IRebuildPlan> = {}): IRebuildPlan => ({
  language: 'pl', businessName: 'Falco-Dent', year: 2026,
  theme: { primary: '#0e7490', onPrimary: '#ffffff', pageBackground: '#ffffff', pageText: '#111111', headingFont: 'serif', bodyFont: 'sans-serif',
    headingWeight: 700, headingUppercase: false, h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, buttonRadius: 6, buttonUppercase: false },
  header: { nav: [{ label: 'Zespół', href: '#s-2' }], cta: { label: 'Umów wizytę' }, phone: '+48 510 510 706' },
  sections, bookingAppended: true, bookingServices: ['Implanty'],
  footer: { contacts: { phone: '+48 510 510 706', email: 'a@b.pl', address: 'ul. X 1' }, social: [{ label: 'facebook', href: 'https://facebook.com/x' }] },
  summary: { coverage: 1, sections: sections.length, omitted: [], tuning: [] },
  ...over,
});

describe('renderRebuild (REV-110)', () => {
  it('renders every arrangement with its items', () => {
    for (const arrangement of SITE_SECTION_ARRANGEMENTS) {
      const html = renderRebuild(plan([section(1, { arrangement, columns: 3, items: [item('Anna'), item('Jan')] })]));
      expect(html, arrangement).toContain(`data-arrangement="${arrangement}"`);
      if (arrangement !== 'embed') {
        expect(html, arrangement).toContain('Anna');
        expect(html, arrangement).toContain('Jan');
      }
    }
  });

  it('keeps the section order, anchors and heading levels', () => {
    const html = renderRebuild(plan([section(1, { headingLevel: 1, intro: { heading: 'Hero', text: [], links: [] } }), section(2), section(3)]));
    expect(html.indexOf('id="s-1"')).toBeLessThan(html.indexOf('id="s-2"'));
    expect(html.indexOf('id="s-2"')).toBeLessThan(html.indexOf('id="s-3"'));
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('<h2 class="rb-heading">Sekcja 2</h2>');
  });

  it('renders a hidden h1 when the plan asks', () => {
    const html = renderRebuild(plan([section(1)], { hiddenH1: 'Falco-Dent' }));
    expect(html).toMatch(/<h1 class="rb-visually-hidden">Falco-Dent<\/h1>/);
  });

  it('renders every item field only when present', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'card-grid', items: [item('Anna'), { text: ['Sam tekst'], links: [] }] })]));
    expect(html).toContain('od 150 zł');
    expect(html).toContain('aria-label="5/5"');
    expect(html).toContain('alt="Anna"');
    expect(html).toContain('Sam tekst');
  });

  it('escapes original text', () => {
    const html = renderRebuild(plan([section(1, { intro: { heading: '<script>alert(1)</script>', text: ['"quoted" & <b>'], links: [] } })]));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;');
  });

  it('puts the booking form in place of a form, else before the footer', () => {
    const inPlace = renderRebuild(plan([section(1), section(2, { booking: true }), section(3)], { bookingAppended: false }));
    expect(inPlace.indexOf('id="booking"')).toBeGreaterThan(inPlace.indexOf('id="s-2"'));
    expect(inPlace.indexOf('id="booking"')).toBeLessThan(inPlace.indexOf('id="s-3"'));
    const appended = renderRebuild(plan([section(1)]));
    expect(appended.indexOf('id="booking"')).toBeLessThan(appended.indexOf('<footer'));
    expect(appended.match(/id="booking"/g)).toHaveLength(1);
    expect(appended).toContain('<option value="Implanty">Implanty</option>');
  });

  it('collapses a long section into details and renders an accordion natively', () => {
    const html = renderRebuild(plan([section(1, { collapsed: true }), section(2, { arrangement: 'accordion', items: [{ title: 'Pytanie?', text: ['Odpowiedź'], links: [] }] })]));
    expect(html).toContain('<details class="rb-collapsed"><summary>Sekcja 1</summary>');
    expect(html).toContain('<summary class="rb-item-title">Pytanie?</summary>');
  });

  it('renders an allowed iframe lazily with a title', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'embed', embeds: [{ kind: 'map', src: 'https://www.google.com/maps/embed?pb=1', title: 'Mapa' }] })]));
    expect(html).toContain('<iframe src="https://www.google.com/maps/embed?pb=1" title="Mapa" loading="lazy"');
  });

  it('lazy-loads all but eager images and sets their size', () => {
    const html = renderRebuild(plan([section(1, { images: [{ src: 'https://x.pl/a.jpg', alt: '', width: 800, height: 600, eager: true }, { src: 'https://x.pl/b.jpg', alt: '' }] })]));
    expect(html).toContain('<img src="https://x.pl/a.jpg" alt="" width="800" height="600" decoding="async">');
    expect(html).toContain('<img src="https://x.pl/b.jpg" alt="" loading="lazy" decoding="async">');
  });

  it('renders the header nav, CTA and phone, and the footer contacts', () => {
    const html = renderRebuild(plan([section(1)]));
    expect(html).toContain('<a class="rb-nav-link" href="#s-2">Zespół</a>');
    expect(html).toContain('<a class="rb-cta" href="#booking">Umów wizytę</a>');
    expect(html).toContain('href="tel:+48510510706"');
    expect(html).toContain('href="mailto:a@b.pl"');
    expect(html).toContain('© 2026 Falco-Dent');
  });

  it('sets the tuned theme as CSS variables and no external font', () => {
    const html = renderRebuild(plan([section(1)]));
    expect(html).toContain('--rb-primary: #0e7490');
    expect(html).toContain('--rb-body-size: 16px');
    expect(html).not.toMatch(/fonts\.googleapis|@import/);
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('<html lang="pl">');
  });

  it('draws an overlay over a background photo', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'banner', style: { backgroundImage: 'https://x.pl/h.jpg', overlay: 0.55, text: '#ffffff', align: 'center', paddingY: 96, fullBleed: true } })]));
    expect(html).toContain('--rb-overlay: 0.55');
    expect(html).toContain("--rb-bg-image: url('https://x.pl/h.jpg')");
  });

  it('renders every heading, title and text of a Falco-Dent-shaped plan', () => {
    const sections = [
      section(1, { arrangement: 'slider', headingLevel: 1, items: ['Nakładki', 'Estetyka', 'Laser', 'Medycyna'].map(item) }),
      section(2, { kind: 'reviews', arrangement: 'slider', items: ['Agi', 'Marta', 'Katarzyna'].map(item) }),
      section(6, { kind: 'features', arrangement: 'card-grid', columns: 4, items: Array.from({ length: 8 }, (_, i) => item(`Cecha${i}`)) }),
      section(8, { kind: 'team', arrangement: 'card-grid', columns: 3, items: Array.from({ length: 10 }, (_, i) => item(`Lekarz${i}`)) }),
      section(9, { kind: 'gallery', arrangement: 'gallery', images: [{ src: 'https://x.pl/g.jpg', alt: '' }] }),
      section(11, { collapsed: true, intro: { heading: 'REGULAMIN', text: ['x'.repeat(1500)], links: [] } }),
    ];
    const p = plan(sections);
    const html = renderRebuild(p);
    const strings = p.sections.flatMap((s) => [s.intro.heading, ...s.intro.text, ...s.items.flatMap((i) => [i.title, i.subtitle, ...i.text])]);
    for (const text of strings.filter((x): x is string => Boolean(x))) expect(html).toContain(text);
  });
});
```

`rebuild-script.spec.ts` (page script under happy-dom; see memory note: inline scripts need `enableJavaScriptEvaluation: true`):

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import type { IRebuildPlan } from '@revamp/shared-types';
import { renderRebuild } from '../rebuild/index.js';

const windows: Window[] = [];
afterEach(async () => {
  for (const w of windows.splice(0)) await w.happyDOM.close();
});

function open(plan: IRebuildPlan): Window {
  const window = new Window({ url: 'https://mvp.example/', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  windows.push(window);
  window.document.write(renderRebuild(plan));
  return window;
}

const slider = (n: number): IRebuildPlan => ({
  language: 'pl', businessName: 'X', year: 2026,
  theme: { primary: '#0e7490', onPrimary: '#ffffff', pageBackground: '#ffffff', pageText: '#111111', headingFont: 'serif', bodyFont: 'sans-serif',
    headingWeight: 700, headingUppercase: false, h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, buttonRadius: 6, buttonUppercase: false },
  header: { nav: [], cta: { label: 'CTA' } },
  sections: [{ id: 's-1', index: 1, kind: 'other', arrangement: 'slider', headingLevel: 2, intro: { heading: 'S', text: [], links: [] },
    items: Array.from({ length: n }, (_, i) => ({ title: `Slajd ${i}`, text: [], links: [] })), extra: [], images: [], embeds: [], booking: false, collapsed: false,
    style: { text: '#111111', align: 'left', paddingY: 64, fullBleed: false } }],
  bookingAppended: true, bookingServices: [], footer: { contacts: {}, social: [] },
  summary: { coverage: 1, sections: 1, omitted: [], tuning: [] },
});

describe('rebuild page script (REV-110)', () => {
  it('shows prev/next only for a slider with more than one slide', () => {
    expect(open(slider(3)).document.querySelectorAll('[data-slide-step]')).toHaveLength(2);
    expect(open(slider(1)).document.querySelectorAll('[data-slide-step]')).toHaveLength(0);
  });

  it('the next button scrolls the track by one slide', () => {
    const window = open(slider(3));
    const track = window.document.querySelector('.rb-track') as unknown as { scrollBy: (o: unknown) => void };
    const calls: unknown[] = [];
    track.scrollBy = (o) => calls.push(o);
    (window.document.querySelector('[data-slide-step="1"]') as unknown as { click: () => void }).click();
    expect(calls).toHaveLength(1);
  });

  it('applies a live palette from the dashboard', async () => {
    const window = open(slider(1));
    window.postMessage({ type: 'REVAMP_UPDATE_THEME', palette: { primary: '#ff0000' } }, '*');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.document.documentElement.style.getPropertyValue('--rb-primary')).toBe('#ff0000');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/workers/src/templates/__tests__/rebuild.template.spec.ts apps/workers/src/templates/__tests__/rebuild-script.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sections.ts`**

```ts
import type { IRebuildBlock, IRebuildImage, IRebuildItem, IRebuildLink, IRebuildSection } from '@revamp/shared-types';
import type { MvpStrings } from '../mvp-locale.js';
import { escapeHtml } from '../html.js';

// One renderer per arrangement (REV-110). Every value comes from the validated plan and is escaped.

export interface RenderCtx {
  t: MvpStrings;
  /** The booking form section, rendered once where the plan places it */
  bookingHtml: string;
}

export const img = (image: IRebuildImage | undefined, className = ''): string =>
  image
    ? `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"${className ? ` class="${className}"` : ''}` +
      `${image.width ? ` width="${image.width}"` : ''}${image.height ? ` height="${image.height}"` : ''}` +
      `${image.eager ? '' : ' loading="lazy"'} decoding="async">`
    : '';

export const link = (l: IRebuildLink): string =>
  `<a class="${l.kind === 'booking' ? 'rb-cta' : 'rb-link'}" href="${escapeHtml(l.href)}"${l.kind === 'map' ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(l.label)}</a>`;

const links = (list: IRebuildLink[]) => (list.length ? `<div class="rb-links">${list.map(link).join('')}</div>` : '');
const paragraphs = (text: string[]) => text.map((p) => `<p>${escapeHtml(p)}</p>`).join('');

const stars = (rating: number) =>
  `<div class="rb-rating" role="img" aria-label="${rating}/5">${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))}</div>`;

export function renderItem(item: IRebuildItem, level: 3 | 4 = 3): string {
  return `<article class="rb-item">
    ${img(item.image, 'rb-item-image')}
    <div class="rb-item-body">
      ${item.subtitle && !item.title ? `<p class="rb-item-subtitle">${escapeHtml(item.subtitle)}</p>` : ''}
      ${item.title ? `<h${level} class="rb-item-title">${escapeHtml(item.title)}</h${level}>` : ''}
      ${item.subtitle && item.title ? `<p class="rb-item-subtitle">${escapeHtml(item.subtitle)}</p>` : ''}
      ${item.price ? `<p class="rb-price">${escapeHtml(item.price)}</p>` : ''}
      ${item.rating !== undefined ? stars(item.rating) : ''}
      ${paragraphs(item.text)}
      ${links(item.links)}
    </div>
  </article>`;
}

function renderItems(arrangement: IRebuildSection['arrangement'], items: IRebuildItem[], ctx: RenderCtx, sectionId: string, columns?: number): string {
  if (!items.length) return '';
  switch (arrangement) {
    case 'accordion':
      return `<div class="rb-accordion">${items
        .map((i) => `<details class="rb-item"><summary class="rb-item-title">${escapeHtml(i.title ?? i.text[0] ?? '')}</summary>${paragraphs(i.title ? i.text : i.text.slice(1))}${links(i.links)}</details>`)
        .join('')}</div>`;
    case 'tabs':
      return `<div class="rb-tabs">${items
        .map((i, n) => `<input type="radio" name="${sectionId}-tab" id="${sectionId}-tab-${n}"${n === 0 ? ' checked' : ''}><label for="${sectionId}-tab-${n}">${escapeHtml(i.title ?? String(n + 1))}</label><div class="rb-tab-panel">${renderItem({ ...i, title: undefined })}</div>`)
        .join('')}</div>`;
    case 'slider': {
      const controls =
        items.length > 1
          ? `<div class="rb-slider-controls"><button type="button" data-slide-step="-1" aria-label="${escapeHtml(ctx.t.previousSlide)}">‹</button><button type="button" data-slide-step="1" aria-label="${escapeHtml(ctx.t.nextSlide)}">›</button></div>`
          : '';
      return `<div class="rb-slider"><div class="rb-track" tabindex="0">${items.map((i) => `<div class="rb-slide">${renderItem(i)}</div>`).join('')}</div>${controls}</div>`;
    }
    case 'gallery':
      return `<div class="rb-gallery">${items.map((i) => img(i.image)).join('')}</div>`;
    case 'card-grid':
      return `<div class="rb-grid" style="--rb-columns: ${columns ?? 3}">${items.map((i) => renderItem(i)).join('')}</div>`;
    default:
      return `<div class="rb-list">${items.map((i) => renderItem(i)).join('')}</div>`;
  }
}

const renderExtra = (block: IRebuildBlock, ctx: RenderCtx, sectionId: string) =>
  block.type === 'text' ? `<div class="rb-text">${paragraphs(block.text)}</div>` : renderItems(block.arrangement, block.items, ctx, `${sectionId}-x`);

function intro(section: IRebuildSection): string {
  const { eyebrow, heading, text } = section.intro;
  const tag = `h${section.headingLevel}`;
  const headingHtml = heading ? `<${tag} class="rb-heading">${escapeHtml(heading)}</${tag}>` : '';
  if (section.collapsed) {
    return `${eyebrow ? `<p class="rb-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<details class="rb-collapsed"><summary>${escapeHtml(heading ?? '')}</summary>${paragraphs(text)}</details>`;
  }
  return `${eyebrow ? `<p class="rb-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}${headingHtml}${paragraphs(text)}${links(section.intro.links)}`;
}

export function renderSection(section: IRebuildSection, ctx: RenderCtx, tag: 'section' | 'div' = 'section'): string {
  const style = [
    `--rb-section-text: ${section.style.text}`,
    `--rb-section-pad: ${section.style.paddingY}px`,
    section.style.background ? `--rb-section-bg: ${section.style.background}` : '',
    section.style.backgroundImage ? `--rb-bg-image: url('${escapeHtml(section.style.backgroundImage)}')` : '',
    section.style.overlay !== undefined ? `--rb-overlay: ${section.style.overlay}` : '',
    section.split !== undefined ? `--rb-split: ${Math.round(section.split * 100)}%` : '',
  ]
    .filter(Boolean)
    .join('; ');
  const media = section.images.length
    ? section.arrangement === 'gallery' || section.images.length > 1
      ? `<div class="rb-gallery">${section.images.map((i) => img(i)).join('')}</div>`
      : `<div class="rb-media">${img(section.images[0])}</div>`
    : '';
  const embeds = section.embeds
    .map((e) => `<div class="rb-embed"><iframe src="${escapeHtml(e.src)}" title="${escapeHtml(e.title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>`)
    .join('');
  const body = `<div class="rb-copy">${intro(section)}${section.collapsed ? '' : renderItems(section.arrangement, section.items, ctx, section.id, section.columns)}${section.extra
    .map((block) => renderExtra(block, ctx, section.id))
    .join('')}</div>`;
  // The media side of media-beside-text is set in CSS through data-media-side
  const inner = body + media;
  return `<${tag} id="${section.id}" class="rb-section" data-arrangement="${section.arrangement}" data-kind="${section.kind}"${
    section.mediaSide ? ` data-media-side="${section.mediaSide}"` : ''
  } data-align="${section.style.align}"${section.style.fullBleed ? ' data-full-bleed' : ''} style="${style}">
  <div class="rb-container">${inner}${embeds}</div>
</${tag}>${section.booking ? ctx.bookingHtml : ''}`;
}
```


- [ ] **Step 4: Implement `chrome.ts`, `styles.ts`, `script.ts`, `index.ts`**

`chrome.ts`:

```ts
import type { IRebuildPlan } from '@revamp/shared-types';
import type { MvpStrings } from '../mvp-locale.js';
import { escapeHtml } from '../html.js';
import { monogramSvg } from '../shared/page.js';
import { img, renderSection, RenderCtx } from './sections.js';

const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, '')}`;

export function renderHeader(plan: IRebuildPlan): string {
  const logo = plan.header.logo
    ? img({ ...plan.header.logo, eager: true }, 'rb-logo')
    : `<span class="rb-logo">${monogramSvg(plan.businessName, plan.theme.primary)}</span>`;
  return `<header class="rb-header">
  <div class="rb-container rb-header-row">
    <a class="rb-brand" href="#top" aria-label="${escapeHtml(plan.businessName)}">${logo}</a>
    ${plan.header.nav.length ? `<nav class="rb-nav">${plan.header.nav.map((n) => `<a class="rb-nav-link" href="${escapeHtml(n.href)}">${escapeHtml(n.label)}</a>`).join('')}</nav>` : ''}
    <div class="rb-header-actions">
      ${plan.header.phone ? `<a class="rb-phone" href="${escapeHtml(telHref(plan.header.phone))}">${escapeHtml(plan.header.phone)}</a>` : ''}
      <a class="rb-cta" href="#booking">${escapeHtml(plan.header.cta.label)}</a>
    </div>
  </div>
</header>`;
}

export function renderFooter(plan: IRebuildPlan, t: MvpStrings, ctx: RenderCtx): string {
  const c = plan.footer.contacts;
  const contacts = [
    c.phone ? `<li><a href="${escapeHtml(telHref(c.phone))}">${escapeHtml(c.phone)}</a></li>` : '',
    c.email ? `<li><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></li>` : '',
    c.address ? `<li>${escapeHtml(c.address)}</li>` : '',
    c.workingHours ? `<li><span class="rb-footer-label">${escapeHtml(t.openingHoursTitle)}</span> ${escapeHtml(c.workingHours)}</li>` : '',
  ].join('');
  const social = plan.footer.social.map((s) => `<a href="${escapeHtml(s.href)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`).join('');
  return `<footer class="rb-footer">
  ${plan.footer.section ? renderSection({ ...plan.footer.section, booking: false }, ctx, 'div') : ''}
  <div class="rb-container rb-footer-contacts">
    <h2 class="rb-footer-title">${escapeHtml(t.contactsTitle)}</h2>
    ${contacts ? `<ul>${contacts}</ul>` : ''}
    ${social ? `<div class="rb-social">${social}</div>` : ''}
    <p class="rb-copyright">© ${plan.year} ${escapeHtml(plan.businessName)}. ${escapeHtml(t.rightsReserved)}</p>
  </div>
</footer>`;
}
```

`script.ts`:

```ts
/** The rebuild's page script (REV-110): slider steps. The page works without it (the track still scrolls). */
export const REBUILD_SCRIPT = `<script>
(function() {
  document.querySelectorAll('.rb-slider').forEach(function(slider) {
    var track = slider.querySelector('.rb-track');
    slider.querySelectorAll('[data-slide-step]').forEach(function(button) {
      button.addEventListener('click', function() {
        var slide = track && track.querySelector('.rb-slide');
        if (!track || !slide) return;
        track.scrollBy({ left: Number(button.getAttribute('data-slide-step')) * slide.getBoundingClientRect().width, behavior: 'smooth' });
      });
    });
  });
})();
</script>`;
```

The booking script from Task 3 (`bookingScript`) owns the `REVAMP_UPDATE_THEME` listener; the rebuild passes `themeVars: { primary: '--rb-primary' }`. `REBUILD_SCRIPT` holds only the slider code, so exactly one theme listener runs on the page.

`styles.ts`: export `rebuildCss(plan: IRebuildPlan): string` with the `:root` variables and the static rules:

```ts
import type { IRebuildPlan } from '@revamp/shared-types';

export function rebuildCss(plan: IRebuildPlan): string {
  const t = plan.theme;
  return `:root {
  --rb-primary: ${t.primary}; --rb-on-primary: ${t.onPrimary};
  --rb-page-bg: ${t.pageBackground}; --rb-page-text: ${t.pageText};
  --rb-heading-font: ${t.headingFont}; --rb-body-font: ${t.bodyFont};
  --rb-heading-weight: ${t.headingWeight}; --rb-heading-case: ${t.headingUppercase ? 'uppercase' : 'none'};
  --rb-h1: clamp(${Math.round(t.h1Size * 0.6)}px, 6vw, ${t.h1Size}px); --rb-h2: clamp(${Math.round(t.h2Size * 0.7)}px, 4vw, ${t.h2Size}px);
  --rb-body-size: ${t.bodySize}px; --rb-line: ${t.lineHeight};
  --rb-button-radius: ${t.buttonRadius}px; --rb-button-case: ${t.buttonUppercase ? 'uppercase' : 'none'};
}
${STATIC_CSS}`;
}
```

and `STATIC_CSS` covering: box-sizing reset; `body` (font, size, line height, colors, margin 0); `.rb-visually-hidden`; `.rb-container` (max-width 1200px, margin auto, padding 0 16px); `.rb-section` (padding `var(--rb-section-pad) 0`, `background: var(--rb-section-bg, transparent)`, `color: var(--rb-section-text)`); `[data-full-bleed] .rb-container { max-width: none }`; `[data-align=center] .rb-copy { text-align: center }`; banner (`background-image: linear-gradient(rgba(0,0,0,var(--rb-overlay,0)), rgba(0,0,0,var(--rb-overlay,0))), var(--rb-bg-image)`, cover, center); `media-beside-text` (`.rb-container { display: grid; grid-template-columns: 1fr var(--rb-split, 50%); gap: 48px; align-items: center }`, `[data-media-side=left] .rb-media { order: -1 }` and swapped columns); `.rb-grid` (`grid-template-columns: repeat(var(--rb-columns), minmax(0, 1fr))`, gap 24px); `.rb-list`; `.rb-accordion details`; `.rb-tabs` (radio inputs visually hidden, `input:checked + label + .rb-tab-panel { display: block }`, panels hidden otherwise, labels as a row); `.rb-track` (`display: grid; grid-auto-flow: column; grid-auto-columns: min(100%, 420px); overflow-x: auto; scroll-snap-type: x mandatory`), `.rb-slide { scroll-snap-align: start }`; `.rb-gallery` (`grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`, images `aspect-ratio: 4/3; object-fit: cover`); `.rb-embed iframe` (width 100%, `aspect-ratio: 16/9`, border 0); `.rb-item-image` (width 100%, `object-fit: cover`) with the `itemStyle` handled per section via `data-*` is out of scope — use `data-image-shape` on the section (add it in `renderSection` from `section.itemStyle?.imageShape`) with `[data-image-shape=round] .rb-item-image { border-radius: 50%; aspect-ratio: 1 }`, `square` → `aspect-ratio: 1`, `wide` → `16/9`, `tall` → `3/4`; item radius/border/shadow via `--rb-item-radius`, `[data-item-border]`, `[data-item-shadow]` on the section; headings (`h1 { font-size: var(--rb-h1) }`, `h2 { font-size: var(--rb-h2) }`, `h1,h2,h3 { font-family: var(--rb-heading-font); font-weight: var(--rb-heading-weight); text-transform: var(--rb-heading-case) }`); `.rb-header` (sticky top 0, z-index 10, background `var(--rb-page-bg)`, `box-shadow: 0 1px 0 rgba(0,0,0,.08)`); `.rb-cta` (background `var(--rb-primary)`, color `var(--rb-on-primary)`, radius, text-transform, padding 12px 20px, min-height 44px); `:focus-visible { outline: 3px solid var(--rb-primary); outline-offset: 2px }`; `.rb-footer` (padding 48px 0, border-top); booking wrapper styles for the class names `bookingFormHtml` emits (`.booking-section`, `.booking-wrapper`, `.booking-form`, `.form-group`, `.form-label`, `.form-input`, `.form-select`, `.form-textarea`, `.form-checkbox-container`, `.form-submit-btn`, `.form-success-message { display: none }`, `.section-tag`, `.section-title`, `.section-desc`) using the `--rb-*` variables; `@media (max-width: 900px)` → grids 2 columns, media-beside-text 1 column, nav hidden; `@media (max-width: 700px)` → grids 1 column, `.rb-section { padding: calc(var(--rb-section-pad) * 0.6) 0 }`; `@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; animation: none !important } }`.

`index.ts`:

```ts
import type { IRebuildPlan } from '@revamp/shared-types';
import { escapeHtml } from '../html.js';
import { getMvpStrings } from '../mvp-locale.js';
import { bookingFormHtml, bookingScript } from '../shared/booking.js';
import { monogramSvg, resolveTrackerUrls, svgDataUri, trackerScriptTag } from '../shared/page.js';
import { renderFooter, renderHeader } from './chrome.js';
import { renderSection, RenderCtx } from './sections.js';
import { REBUILD_SCRIPT } from './script.js';
import { rebuildCss } from './styles.js';

/** The rebuilt original home page (REV-110), from a validated plan; no markup from the site or a model */
export function renderRebuild(plan: IRebuildPlan, opts: { publicApiUrl?: string; trackingToken?: string } = {}): string {
  const t = getMvpStrings(plan.language);
  const tracker = resolveTrackerUrls(opts.publicApiUrl);
  const options = plan.bookingServices.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const bookingHtml = `<section class="booking-section rb-section" id="booking" data-arrangement="booking">
  <div class="rb-container">${bookingFormHtml({ t, businessName: plan.businessName, heading: escapeHtml(plan.header.cta.label), serviceOptionsHtml: options })}</div>
</section>`;
  const ctx: RenderCtx = { t, bookingHtml };
  const favicon = plan.header.logo?.src ?? svgDataUri(monogramSvg(plan.businessName, plan.theme.primary));
  return `<!DOCTYPE html>
<html lang="${escapeHtml(plan.language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(plan.businessName)}</title>
  <link rel="icon" href="${escapeHtml(favicon)}">
  <style>${rebuildCss(plan)}</style>
</head>
<body id="top">
${renderHeader(plan)}
<main>
${plan.hiddenH1 ? `<h1 class="rb-visually-hidden">${escapeHtml(plan.hiddenH1)}</h1>` : ''}
${plan.sections.map((section) => renderSection(section, ctx)).join('\n')}
${plan.bookingAppended ? bookingHtml : ''}
</main>
${renderFooter(plan, t, ctx)}
${bookingScript({ t, tracker, trackingToken: opts.trackingToken, themeVars: { primary: '--rb-primary' } })}
${REBUILD_SCRIPT}
${trackerScriptTag(tracker, opts.trackingToken)}
</body>
</html>`;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/workers/src/templates`
Expected: PASS (the Bento snapshot too).

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/templates
git commit -m "feat(REV-110): render the rebuild, one renderer per arrangement"
```

---

### Task 7: The rebuild service and `renderMvp`

**Files:**
- Create: `apps/workers/src/services/rebuild-template.service.ts`, `apps/workers/src/services/mvp-render.ts`
- Test: `apps/workers/src/services/__tests__/rebuild-template.service.spec.ts`, `apps/workers/src/services/__tests__/mvp-render.spec.ts`

**Interfaces:**
- Consumes: `planRebuild` (Task 5), `renderRebuild` (Task 6), `rebuildEligibility`, `RebuildPlanSchema` (Task 1), `bentoTemplateService.renderFromAudit` (Task 2), `MvpPaletteOverride` from `template.service.ts`.
- Produces:

```ts
// rebuild-template.service.ts
export class RebuildUnavailable extends Error { constructor(readonly reason: RebuildFallbackReason, readonly facts: string[] = []) }
export function defaultRebuildPrimary(audit: Partial<IAudit> | undefined): string; // site's button background, else brand primary, else '#2563eb'
export const rebuildTemplateService: { renderFromAudit(lead: Partial<ILead>, audit: Partial<IAudit> | undefined, palette?: MvpPaletteOverride, now?: Date): { html: string; summary: IMvpRebuildSummary } };

// mvp-render.ts
export function rebuildLayout(derived: IMvpLayoutSelection): IMvpLayoutSelection;               // variant original, 'rule:rebuild', derived facts + design
export function fallbackLayout(derived: IMvpLayoutSelection, reason: RebuildFallbackReason, facts: string[], manual: boolean): IMvpLayoutSelection;
export function requestedVariant(previous: { variant?: MvpLayoutVariant; reasons?: string[] } | null | undefined): MvpLayoutVariant | undefined; // manual picks only
export interface MvpRender { html: string; layout: IMvpLayoutSelection; rebuild?: IMvpRebuildSummary }
export function renderMvp(args: {
  lead: Partial<ILead>; audit: Partial<IAudit>; generatedContent?: Partial<IMvpGeneratedContent>;
  layout: IMvpLayoutSelection; derived: IMvpLayoutSelection; palette?: MvpPaletteOverride; design?: IMvpDesign;
}): MvpRender;
```

- [ ] **Step 1: Write the failing tests**

`rebuild-template.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { IAudit, ISiteSections } from '@revamp/shared-types';
import { RebuildUnavailable, defaultRebuildPrimary, rebuildTemplateService } from '../rebuild-template.service.js';

const siteSections = (ratio = 0.98): ISiteSections => ({
  sections: [{ index: 1, role: 'hero', kind: 'other', arrangement: 'banner', intro: { heading: 'Witamy', text: ['Tekst'], links: [] }, items: [], extra: [], images: [], embeds: [], style: {} }],
  typography: { heading: { family: 'Lato', size: 32, weight: 700, uppercase: false }, body: { family: 'Lato', size: 16, weight: 400 }, button: { radius: 4, filled: true, uppercase: false, background: '#c2185b' } },
  skipped: [], coverage: { pageChars: 100, capturedChars: 98, ratio, uncaptured: [] },
});
const audit = (over: Partial<IAudit> = {}): Partial<IAudit> => ({ siteSections: siteSections(), extractedContacts: { phone: '+48 1 2 3' } as IAudit['extractedContacts'], extractedContent: { language: 'pl' } as IAudit['extractedContent'], ...over });

describe('rebuildTemplateService (REV-110)', () => {
  it('renders the rebuild and returns its summary', () => {
    const { html, summary } = rebuildTemplateService.renderFromAudit({ businessName: 'Falco-Dent' }, audit(), undefined, new Date('2026-09-30'));
    expect(html).toContain('Witamy');
    expect(summary).toMatchObject({ coverage: 0.98, sections: 1 });
  });
  it('throws RebuildUnavailable with the eligibility reason', () => {
    expect(() => rebuildTemplateService.renderFromAudit({ businessName: 'X' }, audit({ siteSections: siteSections(0.5) })))
      .toThrow(expect.objectContaining({ reason: 'rebuild:low_coverage', facts: ['coverage:0.5'] }));
    expect(() => rebuildTemplateService.renderFromAudit({ businessName: 'X' }, {})).toThrow(RebuildUnavailable);
  });
  it('throws rebuild:too_large over 300 KB', () => {
    const big = siteSections();
    big.sections = Array.from({ length: 40 }, (_, i) => ({ ...big.sections[0]!, index: i + 1, role: 'content' as const, intro: { heading: `H${i}`, text: Array(40).fill('x'.repeat(2000)), links: [] } }));
    expect(() => rebuildTemplateService.renderFromAudit({ businessName: 'X' }, audit({ siteSections: big })))
      .toThrow(expect.objectContaining({ reason: 'rebuild:too_large' }));
  });
  it('defaults the CTA color to the site button, else the brand color', () => {
    expect(defaultRebuildPrimary(audit())).toBe('#c2185b');
    expect(defaultRebuildPrimary({ extractedBrandTokens: { primaryColor: '#123456' } as IAudit['extractedBrandTokens'] })).toBe('#123456');
    expect(defaultRebuildPrimary(undefined)).toBe('#2563eb');
  });
  it('uses a saved palette over the default', () => {
    const { html } = rebuildTemplateService.renderFromAudit({ businessName: 'X' }, audit(), { primary: '#00ff00' });
    expect(html).toContain('--rb-primary: #00ff00');
  });
});
```

`mvp-render.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMvpLayoutSelection } from '@revamp/shared-types';
import { fallbackLayout, rebuildLayout, renderMvp, requestedVariant } from '../mvp-render.js';
import { bentoTemplateService } from '../template.service.js';
import { RebuildUnavailable, rebuildTemplateService } from '../rebuild-template.service.js';

const derived: IMvpLayoutSelection = { variant: 'split', reasons: ['rule:derived', 'hero:side-right', 'images:5'], design: { hero: { align: 'left' } } };

describe('layout helpers (REV-110)', () => {
  it('rebuildLayout keeps the audit facts and the derived look', () => {
    expect(rebuildLayout(derived)).toEqual({ variant: 'original', reasons: ['rule:rebuild', 'hero:side-right', 'images:5'], design: derived.design });
  });
  it('fallbackLayout puts the reason first on the derived Bento choice', () => {
    expect(fallbackLayout(derived, 'rebuild:low_coverage', ['coverage:0.7'], false).reasons.slice(0, 3)).toEqual(['rebuild:low_coverage', 'coverage:0.7', 'rule:derived']);
    const manual = fallbackLayout(derived, 'rebuild:unread', [], true);
    expect(manual.variant).toBe('split');
    expect(manual.reasons.slice(0, 3)).toEqual(['rule:manual', 'manual:original', 'rebuild:unread']);
  });
  it('requestedVariant reads only manual picks, including a fallen-back original', () => {
    expect(requestedVariant({ variant: 'editorial', reasons: ['rule:manual'] })).toBe('editorial');
    expect(requestedVariant({ variant: 'split', reasons: ['rule:manual', 'manual:original', 'rebuild:unread'] })).toBe('original');
    expect(requestedVariant({ variant: 'split', reasons: ['rule:derived'] })).toBeUndefined();
    expect(requestedVariant(null)).toBeUndefined();
  });
});

describe('renderMvp (REV-110)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the rebuild for original', () => {
    vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockReturnValue({ html: 'REBUILD', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    const out = renderMvp({ lead: {}, audit: {}, layout: rebuildLayout(derived), derived });
    expect(out).toMatchObject({ html: 'REBUILD', layout: { variant: 'original' }, rebuild: { sections: 1 } });
  });
  it('falls back to Bento with the reason when the rebuild is unavailable', () => {
    vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockImplementation(() => { throw new RebuildUnavailable('rebuild:invalid'); });
    const bento = vi.spyOn(bentoTemplateService, 'renderFromAudit').mockReturnValue('BENTO');
    const out = renderMvp({ lead: {}, audit: {}, layout: rebuildLayout(derived), derived, design: derived.design });
    expect(out.html).toBe('BENTO');
    expect(out.rebuild).toBeUndefined();
    expect(out.layout).toMatchObject({ variant: 'split', reasons: expect.arrayContaining(['rebuild:invalid']) });
    expect(bento).toHaveBeenCalledWith({}, {}, undefined, 'split', undefined, derived.design);
  });
  it('rethrows an unexpected error rather than hiding it as a fallback', () => {
    vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockImplementation(() => { throw new Error('bug'); });
    expect(() => renderMvp({ lead: {}, audit: {}, layout: rebuildLayout(derived), derived })).toThrow('bug');
  });
  it('renders Bento for a Bento variant', () => {
    const bento = vi.spyOn(bentoTemplateService, 'renderFromAudit').mockReturnValue('BENTO');
    const layout = { ...derived, variant: 'editorial' as const };
    expect(renderMvp({ lead: {}, audit: {}, layout, derived, design: derived.design }).html).toBe('BENTO');
    expect(bento).toHaveBeenCalledWith({}, {}, undefined, 'editorial', undefined, derived.design);
  });
});
```


- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-template.service.spec.ts apps/workers/src/services/__tests__/mvp-render.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `rebuild-template.service.ts`**

```ts
import type { IAudit, ILead, IMvpRebuildSummary, RebuildFallbackReason } from '@revamp/shared-types';
import { RebuildPlanSchema, rebuildEligibility } from '@revamp/validation';
import { env } from '../config/env.js';
import { renderRebuild } from '../templates/rebuild/index.js';
import { planRebuild } from './rebuild-plan.service.js';
import { BentoTemplateService, MvpPaletteOverride } from './template.service.js';

/** Why the rebuild could not be rendered; the caller falls back to the Bento template (REV-110) */
export class RebuildUnavailable extends Error {
  constructor(
    readonly reason: RebuildFallbackReason,
    readonly facts: string[] = [],
  ) {
    super(`Rebuild unavailable: ${reason}${facts.length ? ` (${facts.join(', ')})` : ''}`);
    this.name = 'RebuildUnavailable';
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
const isHttpUrl = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url));

/** The site's own button color, so the default CTA looks like theirs; else the brand color */
export function defaultRebuildPrimary(audit: Partial<IAudit> | undefined): string {
  const button = audit?.siteSections?.typography?.button?.background;
  if (button && HEX.test(button)) return button;
  const brand = audit?.extractedBrandTokens?.primaryColor;
  return brand && HEX.test(brand) ? brand : '#2563eb';
}

export const rebuildTemplateService = {
  /** Plan → validate → render → size check; throws RebuildUnavailable for every fallback reason */
  renderFromAudit(
    lead: Partial<ILead>,
    audit: Partial<IAudit> | undefined,
    palette?: MvpPaletteOverride,
    now: Date = new Date(),
  ): { html: string; summary: IMvpRebuildSummary } {
    const eligible = rebuildEligibility(audit);
    if (!eligible.ok) throw new RebuildUnavailable(eligible.reason, eligible.facts);
    const contacts = audit?.extractedContacts;
    const primary = palette?.primary && HEX.test(palette.primary) ? palette.primary : defaultRebuildPrimary(audit);
    const parsed = RebuildPlanSchema.safeParse(
      planRebuild({
        siteSections: audit!.siteSections!,
        businessName: lead.businessName || lead.domain || 'Business',
        language: audit?.extractedContent?.language,
        contacts: {
          phone: contacts?.phone || lead.contactPhone,
          email: contacts?.email || lead.contactEmail,
          address: contacts?.address,
          workingHours: contacts?.workingHours,
        },
        socialLinks: contacts?.socialLinks ?? [],
        logoUrl: isHttpUrl(audit?.extractedBrandTokens?.logoUrl) ? audit!.extractedBrandTokens!.logoUrl : undefined,
        primary,
        year: now.getFullYear(),
      }),
    );
    if (!parsed.success) throw new RebuildUnavailable('rebuild:invalid', [`invalid:${parsed.error.issues[0]?.path.join('.') ?? 'plan'}`.slice(0, 60)]);
    const html = renderRebuild(parsed.data, { publicApiUrl: isHttpUrl(env.PUBLIC_API_URL) ? env.PUBLIC_API_URL : undefined });
    if (Buffer.byteLength(html, 'utf8') > BentoTemplateService.MAX_BUNDLE_SIZE_BYTES) throw new RebuildUnavailable('rebuild:too_large');
    return { html, summary: parsed.data.summary };
  },
};
```


- [ ] **Step 4: Implement `mvp-render.ts`**

```ts
import {
  IAudit,
  ILead,
  IMvpDesign,
  IMvpGeneratedContent,
  IMvpLayoutSelection,
  IMvpRebuildSummary,
  MVP_LAYOUT_MANUAL_ORIGINAL,
  MVP_LAYOUT_MANUAL_REASON,
  MVP_LAYOUT_REBUILD_REASON,
  MvpLayoutVariant,
  RebuildFallbackReason,
  BentoLayoutVariant,
} from '@revamp/shared-types';
import { MvpLayoutSelectionSchema } from '@revamp/validation';
import { MvpPaletteOverride, bentoTemplateService } from './template.service.js';
import { RebuildUnavailable, rebuildTemplateService } from './rebuild-template.service.js';

// Picks the renderer for an MVP (REV-110): the rebuild of the original for `original`, else Bento, and
// Bento with the reason recorded whenever the rebuild is unavailable

const facts = (reasons: string[]) => reasons.filter((r) => !/^(rule|rebuild|coverage|manual):/.test(r));
const selection = (layout: IMvpLayoutSelection) => MvpLayoutSelectionSchema.parse({ ...layout, reasons: layout.reasons.map((r) => r.slice(0, 60)).slice(0, 12) });

/** The rebuild: the audit facts and the look derived from the original (REV-104) are kept for a switch to Bento */
export const rebuildLayout = (derived: IMvpLayoutSelection): IMvpLayoutSelection =>
  selection({ variant: 'original', reasons: [MVP_LAYOUT_REBUILD_REASON, ...facts(derived.reasons)], ...(derived.design ? { design: derived.design } : {}) });

/** The derived Bento choice with the fallback reason first; a manual `original` pick stays marked for the next run */
export const fallbackLayout = (derived: IMvpLayoutSelection, reason: RebuildFallbackReason, reasonFacts: string[], manual: boolean): IMvpLayoutSelection =>
  selection({
    ...derived,
    reasons: manual
      ? [MVP_LAYOUT_MANUAL_REASON, MVP_LAYOUT_MANUAL_ORIGINAL, reason, ...reasonFacts, ...facts(derived.reasons)]
      : [reason, ...reasonFacts, ...derived.reasons],
  });

/** The variant the operator picked, when the previous layout was a manual pick */
export function requestedVariant(previous: { variant?: MvpLayoutVariant; reasons?: string[] | null } | null | undefined): MvpLayoutVariant | undefined {
  if (!previous?.reasons?.includes(MVP_LAYOUT_MANUAL_REASON)) return undefined;
  return previous.reasons.includes(MVP_LAYOUT_MANUAL_ORIGINAL) ? 'original' : previous.variant;
}

export interface MvpRender {
  html: string;
  layout: IMvpLayoutSelection;
  rebuild?: IMvpRebuildSummary;
}

export function renderMvp(args: {
  lead: Partial<ILead>;
  audit: Partial<IAudit>;
  generatedContent?: Partial<IMvpGeneratedContent>;
  layout: IMvpLayoutSelection;
  derived: IMvpLayoutSelection;
  palette?: MvpPaletteOverride;
  design?: IMvpDesign;
}): MvpRender {
  const bento = (layout: IMvpLayoutSelection): MvpRender => ({
    html: bentoTemplateService.renderFromAudit(args.lead, args.audit, args.generatedContent, layout.variant as BentoLayoutVariant, args.palette, args.design),
    layout,
  });
  if (args.layout.variant !== 'original') return bento(args.layout);
  try {
    const { html, summary } = rebuildTemplateService.renderFromAudit(args.lead, args.audit, args.palette);
    return { html, layout: args.layout, rebuild: summary };
  } catch (error) {
    if (!(error instanceof RebuildUnavailable)) throw error;
    const manual = args.layout.reasons.includes(MVP_LAYOUT_MANUAL_REASON);
    return bento(fallbackLayout(args.derived, error.reason, error.facts, manual));
  }
}
```

`args.design` is `mergeDesigns(layout.design, project.design)` from the caller; a fallback keeps it because `rebuildLayout` and `fallbackLayout` both carry `derived.design`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/rebuild-template.service.spec.ts apps/workers/src/services/__tests__/mvp-render.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/services
git commit -m "feat(REV-110): rebuild service and renderer choice with a recorded fallback"
```

---

### Task 8: Deploy and re-publish through `renderMvp`

**Files:**
- Modify: `apps/workers/src/workers/deploy.worker.ts` (`savedDesign`/`sameDesign` lines 85–110, `republishSavedMvp` lines 118–166, deploy steps 2 and 8 lines 196–289)
- Test: `apps/workers/src/workers/__tests__/deploy.worker.spec.ts`; `apps/workers/src/workers/__tests__/deploy-rebuild.spec.ts` (new); `packages/db` save test (add to the existing MvpProject model spec, find it with `ls packages/db/__tests__`)

**Interfaces:**
- Consumes: `renderMvp`, `rebuildLayout`, `requestedVariant` (Task 7), `defaultRebuildPrimary` (Task 7), `deriveMvpLayout`, `buildLayoutSignals`, `mergeDesigns`.
- Produces: MvpProject writes `layout`, `rebuild` (or `$unset` it), `colorPalette.primary` from `defaultRebuildPrimary` when the rendered variant is `original`, and `editedAt` on a re-publish that switches renderer.

- [ ] **Step 1: Write the failing tests** in `deploy-rebuild.spec.ts`, reusing the mocking set-up of `deploy.worker.spec.ts` (copy its `vi.mock` block and `bullmq` mock verbatim) and additionally `vi.mock('../../services/rebuild-template.service.js', async (orig) => ({ ...(await orig()), rebuildTemplateService: { renderFromAudit: vi.fn() } }))`:

```ts
describe('deploy with the rebuild (REV-110)', () => {
  it('publishes the rebuild and saves the variant, the summary and the site button color', async () => {
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: '<html>REBUILD</html>', summary: { coverage: 0.98, sections: 5, omitted: [], tuning: ['alt:2'] } });
    const result = await runDeploy({ siteSections: sectionsFixture, siteLayout: undefined });
    expect(storageService.uploadHtml).toHaveBeenCalledWith(expect.any(String), '<html>REBUILD</html>', expect.anything());
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.layout).toMatchObject({ variant: 'original', reasons: expect.arrayContaining(['rule:rebuild']) });
    expect(update.rebuild).toEqual({ coverage: 0.98, sections: 5, omitted: [], tuning: ['alt:2'] });
    expect(update.colorPalette.primary).toBe('#c2185b');
    expect(result.success).toBe(true);
  });

  it('falls back to Bento with the reason and unsets the summary', async () => {
    vi.mocked(rebuildTemplateService.renderFromAudit).mockImplementation(() => { throw new RebuildUnavailable('rebuild:low_coverage', ['coverage:0.6']); });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<html>BENTO</html>');
    await runDeploy({ siteSections: sectionsFixture });
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.layout.reasons.slice(0, 2)).toEqual(['rebuild:low_coverage', 'coverage:0.6']);
    expect(update.layout.variant).not.toBe('original');
    expect(update.$unset).toMatchObject({ rebuild: '' });
  });

  it('keeps a manual Bento pick over the rebuild on regeneration', async () => {
    existingProject({ layout: { variant: 'editorial', reasons: ['rule:manual'] } });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<html>BENTO</html>');
    await runDeploy({ siteSections: sectionsFixture });
    expect(rebuildTemplateService.renderFromAudit).not.toHaveBeenCalled();
    expect((vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as any).layout.variant).toBe('editorial');
  });

  it('tries the rebuild again for a manual original that had fallen back', async () => {
    existingProject({ layout: { variant: 'split', reasons: ['rule:manual', 'manual:original', 'rebuild:unread'] } });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    await runDeploy({ siteSections: sectionsFixture });
    expect((vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as any).layout).toMatchObject({ variant: 'original', reasons: expect.arrayContaining(['rule:manual']) });
  });
});

describe('re-publish with the rebuild (REV-110)', () => {
  it('re-renders the rebuild with the saved palette and marks a renderer switch as edited', async () => {
    savedProject({ layout: { variant: 'original', reasons: ['rule:manual'] }, colorPalette: { primary: '#00ff00' }, rebuild: undefined });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    await republishSavedMvp(leadId);
    expect(rebuildTemplateService.renderFromAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ primary: '#00ff00' }));
    expect(MvpProject.findByIdAndUpdate).toHaveBeenCalledWith(projectId, expect.objectContaining({ $set: expect.objectContaining({ editedAt: expect.any(Date), rebuild: expect.anything() }) }));
  });

  it('does not touch editedAt when the renderer stays the same', async () => {
    savedProject({ layout: { variant: 'bento', reasons: ['rule:manual'] }, rebuild: undefined });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('B');
    await republishSavedMvp(leadId);
    const calls = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls;
    expect(calls.every(([, update]) => !(update as any)?.$set?.editedAt)).toBe(true);
  });
});
```

Write `runDeploy(auditOver)`, `existingProject(p)`, `savedProject(p)`, `sectionsFixture` (one hero section, coverage 0.98, `typography.button.background: '#c2185b'`), `leadId`, `projectId` as local helpers in the spec, built from the mocks in `deploy.worker.spec.ts` (lines 60–150 show the shapes; `savedProject` mocks `Lead.findById`, `MvpProject.findOne(...).exec()`, `MvpProject.findById(...).exec()` returning the same project so the relayout loop stops after one pass, `findGenerationAudit`, and `MvpProject.findByIdAndUpdate(...).exec()`). Import `republishSavedMvp` from `../deploy.worker.js`.

In the db package, add to the MvpProject model spec:

```ts
it('keeps the rebuild summary (REV-110)', () => {
  const doc = new MvpProject({ auditId: new Types.ObjectId(), leadId: new Types.ObjectId(), previewSlug: 's', fullPreviewUrl: 'u', storageHtmlPath: 'p',
    rebuild: { coverage: 0.98, sections: 2, omitted: [], tuning: ['alt:1'] } });
  expect(doc.toObject().rebuild).toEqual({ coverage: 0.98, sections: 2, omitted: [], tuning: ['alt:1'] });
});
```

(match the required fields of that spec's existing cases.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/workers/src/workers/__tests__/deploy-rebuild.spec.ts`
Expected: FAIL — the worker still calls Bento directly.

- [ ] **Step 3: Change the deploy step** (replacing the block that computes `derived`, `layout` and `html` around lines 196–216):

```ts
      const leadData = (lead.toObject ? lead.toObject() : lead) as unknown as Partial<ILead>;
      const auditData = (audit.toObject ? audit.toObject() : audit) as unknown as Partial<IAudit>;
      const derived = deriveMvpLayout(auditData.siteLayout ?? undefined, buildLayoutSignals(leadData, auditData, audit.generatedContent));
      // The rebuild of the original (REV-110) unless the operator picked a layout, which survives a regeneration (REV-84)
      const picked = requestedVariant(existingProject?.layout);
      const requested = picked ? manualMvpLayout(derived, picked) : rebuildLayout(derived);
      const palette = requested.variant === 'original' ? { primary: defaultRebuildPrimary(auditData), accent: defaultRebuildPrimary(auditData) } : undefined;
      const rendered = renderMvp({
        lead: leadData,
        audit: auditData,
        generatedContent: audit.generatedContent,
        layout: requested,
        derived,
        palette,
        design: mergeDesigns(requested.design, existingProject?.design),
      });
      const { html, layout } = rendered;
      console.log(`[DeployWorker] Layout: ${layout.variant} (${layout.reasons.join(', ')})`);
```

Select `previewSlug design layout rebuild` on `existingProject`. In the `findOneAndUpdate` update: keep `layout`, set `colorPalette.primary`/`accent` to `defaultRebuildPrimary(auditData)` when `layout.variant === 'original'` (else the current brand-token defaults), add `...(rendered.rebuild ? { rebuild: rendered.rebuild } : {})`, and merge `rebuild: ''` into `$unset` when `!rendered.rebuild` (combine with the existing `requestedProvider` `$unset` into one object).

- [ ] **Step 4: Change `republishSavedMvp`**

Extend `SavedMvpDesign` with `rebuild?: unknown` and in the loop replace the Bento call with:

```ts
    const derived = deriveMvpLayout(auditData.siteLayout ?? undefined, buildLayoutSignals(leadData, auditData, project.generatedContent));
    const rendered = renderMvp({
      lead: leadData,
      audit: auditData,
      generatedContent: project.generatedContent,
      layout: project.layout?.variant ? (project.layout as IMvpLayoutSelection) : { variant: 'bento', reasons: [] },
      derived,
      palette: design.palette,
      design: design.design,
    });
    published = await publishMvp(project.previewSlug, rendered.html, lead, audit);
    // The page's renderer changed (rebuild ↔ Bento): the preview cannot switch in place, so it reloads (REV-110)
    const switched = Boolean(project.rebuild) !== Boolean(rendered.rebuild);
    await MvpProject.findByIdAndUpdate(project._id, {
      $set: {
        ...(rendered.rebuild ? { rebuild: rendered.rebuild } : {}),
        ...(rendered.layout !== project.layout ? { layout: rendered.layout } : {}),
        ...(switched ? { editedAt: new Date() } : {}),
      },
      ...(rendered.rebuild ? {} : { $unset: { rebuild: '' } }),
    }).exec();
```

`savedDesign(project).variant` stays as the sameDesign check input (now `MvpLayoutVariant` including `original`). Compare `rendered.layout` with `project.layout` by `JSON.stringify` rather than identity, and only write `layout` when a fallback changed it.

- [ ] **Step 5: Run the worker tests and update the old ones**

Run: `npx vitest run apps/workers/src/workers packages/db`
Expected: the new spec passes. Existing `deploy.worker.spec.ts` cases have audits without `siteSections`, so they now render Bento through the fallback: update their layout assertions to expect `rebuild:unread` first in `layout.reasons` (do not change what they check otherwise), and mock `MvpProject.findByIdAndUpdate` in the relayout cases (`mockReturnValue({ exec: vi.fn().mockResolvedValue(null) })`). Expected after the update: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/workers packages/db
git commit -m "feat(REV-110): deploy and re-publish render the rebuild, falling back visibly"
```

---

### Task 9: API guards

**Files:**
- Modify: `apps/api/src/routes/mvp.routes.ts` (`PATCH /:id/layout` ~line 215; `runMvpChange` ~line 278)
- Test: `apps/api/src/routes/__tests__/mvp.routes.spec.ts` (find the existing MVP route spec with `ls apps/api/src/routes/__tests__`; add cases there)
- Docs later: blueprint.md §5 (Task 12)

**Interfaces:**
- Consumes: `rebuildEligibility` (Task 1), `Audit` model from `apps/api/src/models`.
- Produces: 409 `MVP_EDIT_UNSUPPORTED` for `POST /mvp/:id/edit` and `DELETE /mvp/:id/design` when `project.layout.variant === 'original'`; 409 `MVP_REBUILD_UNAVAILABLE` with `details: { reason, facts }` for `PATCH /mvp/:id/layout {variant:'original'}` when the audit is not eligible.

- [ ] **Step 1: Write the failing tests** (follow the spec file's existing mocking of `MvpProject`, `Lead`, the queue and `runMvpEditJob`):

```ts
describe('rebuilt MVPs (REV-110)', () => {
  it('refuses a free-text change on the rebuild', async () => {
    mockProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] } });
    mockLead({ status: 'NEEDS_APPROVAL' });
    const res = await request(app).post(`/api/v1/mvp/${projectId}/edit`).send({ instruction: 'Make it blue' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MVP_EDIT_UNSUPPORTED');
    expect(runMvpEditJob).not.toHaveBeenCalled();
  });
  it('refuses a design reset on the rebuild', async () => {
    mockProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] } });
    mockLead({ status: 'NEEDS_APPROVAL' });
    const res = await request(app).delete(`/api/v1/mvp/${projectId}/design`);
    expect(res.body.error.code).toBe('MVP_EDIT_UNSUPPORTED');
  });
  it('refuses a switch to original when the audit cannot be rebuilt', async () => {
    mockProject({ layout: { variant: 'split', reasons: ['rule:derived'] } });
    mockLead({ status: 'NEEDS_APPROVAL' });
    mockAudit({});
    const res = await request(app).patch(`/api/v1/mvp/${projectId}/layout`).send({ variant: 'original' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'MVP_REBUILD_UNAVAILABLE', details: { reason: 'rebuild:unread' } });
    expect(addMvpRelayoutJob).not.toHaveBeenCalled();
  });
  it('accepts a switch to original when the audit can be rebuilt', async () => {
    mockProject({ layout: { variant: 'split', reasons: ['rule:derived'] } });
    mockLead({ status: 'NEEDS_APPROVAL' });
    mockAudit({ siteSections: { sections: [{ index: 1, role: 'hero' }], skipped: [], coverage: { pageChars: 1, capturedChars: 1, ratio: 1, uncaptured: [] } } });
    const res = await request(app).patch(`/api/v1/mvp/${projectId}/layout`).send({ variant: 'original' });
    expect(res.status).toBe(200);
    expect(addMvpRelayoutJob).toHaveBeenCalled();
  });
});
```

`mockAudit` mocks `Audit.findById(...).select(...).exec()`; add `vi.mock` for the API's Audit model if the spec doesn't already.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/api/src/routes/__tests__/mvp.routes.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `runMvpChange`, after the `canChangeMvpLayout` check:

```ts
  // The rebuilt original (REV-110) has no design spec or Bento copy to change until REV-111
  if (project.layout?.variant === 'original') {
    throw new AppError(
      409,
      'MVP_EDIT_UNSUPPORTED',
      'Free-text changes and custom designs are not available for the rebuilt original site yet. Switch to a template layout to use them.',
    );
  }
```

In `PATCH /:id/layout`, after the same-variant early return:

```ts
      // A switch to the rebuild (REV-110) only when the audit's sections can be rebuilt
      if (variant === 'original') {
        const audit = await Audit.findById(project.auditId).select('siteSections siteSectionsError').exec();
        const eligible = rebuildEligibility(audit);
        if (!eligible.ok) {
          throw new AppError(409, 'MVP_REBUILD_UNAVAILABLE', `The original site cannot be rebuilt: ${eligible.reason}`, {
            reason: eligible.reason,
            facts: eligible.facts,
          });
        }
      }
```

Import `rebuildEligibility` from `@revamp/validation` and `Audit` from `../models/Audit.model.js` (check the API models folder name).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(REV-110): refuse edits on the rebuild and switches it cannot render"
```

---

### Task 10: Dashboard

**Files:**
- Modify: `apps/dashboard/src/components/MvpLayoutChip.tsx`, `MvpLayoutPicker.tsx`, `components/leadReview/MvpDesignTools.tsx`, `hooks/useLiveMvpLayout.ts`, `i18n/locales/{en,pl,ru,be,lt}.ts`
- Test: `apps/dashboard/src/components/__tests__/MvpLayoutChip.spec.tsx` (new or existing — check `ls apps/dashboard/src/components/__tests__`), `apps/dashboard/src/hooks/__tests__/useLiveMvpLayout.spec.ts` (existing if present), `apps/dashboard/src/i18n/__tests__` (the key-parity test already checks all locales)

**Interfaces:**
- Consumes: `MVP_LAYOUT_VARIANTS` with `original`, `IMvpProject.rebuild`, `REBUILD_FALLBACK_REASONS`.
- Produces: `rebuildFallbackOf(reasons?: string[]): { reason: RebuildFallbackReason; percent?: number } | undefined` exported from `MvpLayoutChip.tsx`; `useLiveMvpLayout` returns `rerendering: boolean`.

- [ ] **Step 1: Add the strings** — under `mvpLayout` in each locale:

| key | en | pl | ru | be | lt |
|---|---|---|---|---|---|
| variants.original | Original site | Oryginalna strona | Исходный сайт | Арыгінальны сайт | Originali svetainė |
| descriptions.original | Their own site, rebuilt section by section | Ich własna strona, odtworzona sekcja po sekcji | Их собственный сайт, пересобранный по секциям | Іх уласны сайт, перазабраны па секцыях | Jų pačių svetainė, atkurta skiltis po skilties |
| rules.rebuild | rebuilt from the original site | odtworzona z oryginalnej strony | пересобран из исходного сайта | перазабраны з арыгінальнага сайта | atkurta iš originalios svetainės |
| rebuildSummary | {{sections}} sections rebuilt, {{omitted}} left out, {{fixes}} fixes | Odtworzono sekcje: {{sections}}, pominięto: {{omitted}}, poprawki: {{fixes}} | Секций пересобрано: {{sections}}, пропущено: {{omitted}}, исправлений: {{fixes}} | Секцый перазабрана: {{sections}}, прапушчана: {{omitted}}, выпраўленняў: {{fixes}} | Atkurta skilčių: {{sections}}, praleista: {{omitted}}, pataisymų: {{fixes}} |
| rerendering | Re-rendering the page… | Ponowne renderowanie strony… | Страница перерисовывается… | Старонка перамалёўваецца… | Puslapis perpiešiamas… |
| fallback.unread | The original page could not be read section by section, so the template was used. | Nie udało się odczytać oryginalnej strony sekcja po sekcji, więc użyto szablonu. | Исходную страницу не удалось прочитать по секциям, поэтому использован шаблон. | Арыгінальную старонку не ўдалося прачытаць па секцыях, таму выкарыстаны шаблон. | Originalaus puslapio nepavyko perskaityti skiltimis, todėl naudotas šablonas. |
| fallback.no_content | No content sections were found on the original page, so the template was used. | Na oryginalnej stronie nie znaleziono sekcji z treścią, więc użyto szablonu. | На исходной странице не найдено секций с содержимым, поэтому использован шаблон. | На арыгінальнай старонцы не знойдзена секцый са зместам, таму выкарыстаны шаблон. | Originaliame puslapyje nerasta turinio skilčių, todėl naudotas šablonas. |
| fallback.low_coverage | Only {{percent}}% of the original page could be read, so the template was used. | Udało się odczytać tylko {{percent}}% oryginalnej strony, więc użyto szablonu. | Удалось прочитать только {{percent}}% исходной страницы, поэтому использован шаблон. | Удалося прачытаць толькі {{percent}}% арыгінальнай старонкі, таму выкарыстаны шаблон. | Pavyko perskaityti tik {{percent}}% originalaus puslapio, todėl naudotas šablonas. |
| fallback.invalid | The rebuild did not pass validation, so the template was used. | Odtworzona strona nie przeszła walidacji, więc użyto szablonu. | Пересобранная страница не прошла проверку, поэтому использован шаблон. | Перазабраная старонка не прайшла праверку, таму выкарыстаны шаблон. | Atkurtas puslapis nepraėjo patikros, todėl naudotas šablonas. |
| fallback.too_large | The rebuilt page was too large, so the template was used. | Odtworzona strona była za duża, więc użyto szablonu. | Пересобранная страница оказалась слишком большой, поэтому использован шаблон. | Перазабраная старонка аказалася занадта вялікай, таму выкарыстаны шаблон. | Atkurtas puslapis buvo per didelis, todėl naudotas šablonas. |

and under `mvpEdit`: `unsupported` — en "Free-text changes are not available for the rebuilt original site yet. Switch to a template layout to use them." / pl "Zmiany opisowe nie są jeszcze dostępne dla odtworzonej strony. Przełącz na układ szablonu, aby z nich skorzystać." / ru "Текстовые правки пока недоступны для пересобранного сайта. Переключитесь на шаблонный макет, чтобы ими воспользоваться." / be "Тэкставыя праўкі пакуль недаступныя для перазабранага сайта. Пераключыцеся на шаблонны макет, каб імі скарыстацца." / lt "Laisvo teksto pakeitimai dar negalimi atkurtai svetainei. Perjunkite į šablono išdėstymą, kad galėtumėte juos naudoti."

- [ ] **Step 2: Write the failing tests**

```tsx
import { describe, expect, it } from 'vitest';
import { rebuildFallbackOf, layoutRuleOf } from '../MvpLayoutChip.js';

describe('MvpLayoutChip helpers (REV-110)', () => {
  it('reads the rebuild rule', () => {
    expect(layoutRuleOf(['rule:rebuild'])).toBe('rebuild');
  });
  it('reads a fallback and its coverage', () => {
    expect(rebuildFallbackOf(['rebuild:low_coverage', 'coverage:0.72', 'rule:derived'])).toEqual({ reason: 'rebuild:low_coverage', percent: 72 });
    expect(rebuildFallbackOf(['rebuild:unread'])).toEqual({ reason: 'rebuild:unread' });
    expect(rebuildFallbackOf(['rule:rebuild'])).toBeUndefined();
    expect(rebuildFallbackOf(undefined)).toBeUndefined();
  });
});
```

And a render test (follow the dashboard's existing component test set-up — `@testing-library/react` with the i18n provider used in other `components/__tests__` specs):

```tsx
it('shows the original variant with its summary, and a warning chip on a fallback', () => {
  const { getByText, rerender } = renderWithI18n(<MvpLayoutChip mvp={{ layout: { variant: 'original', reasons: ['rule:rebuild'] }, rebuild: { coverage: 0.98, sections: 17, omitted: [], tuning: ['alt:2'] } } as any} />);
  expect(getByText('Original site')).toBeTruthy();
  rerender(<MvpLayoutChip mvp={{ layout: { variant: 'split', reasons: ['rebuild:low_coverage', 'coverage:0.72'] } } as any} />);
  expect(document.querySelector('.MuiChip-colorWarning')).toBeTruthy();
});
```

For the tools: a test that `MvpDesignTools` with `liveLayout.layout === 'original'` renders the edit prompt disabled with the `mvpEdit.unsupported` reason (follow the existing `MvpDesignTools`/`MvpEditPrompt` spec if present; else assert on `aria-disabled` of the prompt's root).

For `useLiveMvpLayout`: a test that a pick from `bento` to `original` sets `rerendering` true after the save succeeds and clears it when the MVP arrives with a newer `editedAt`, and that a Bento↔Bento pick never sets it. (Memory note: node test env skips `refetchInterval`; this hook uses `setInterval` + `invalidateQueries`, drive it with `vi.useFakeTimers()`.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run apps/dashboard/src/components apps/dashboard/src/hooks`
Expected: FAIL.

- [ ] **Step 4: Implement**

`MvpLayoutChip.tsx`: add `'rebuild'` to `LAYOUT_RULES`; add

```tsx
/** Why the rebuild fell back to the template (REV-110), with the coverage it read */
export function rebuildFallbackOf(reasons: string[] | undefined): { reason: RebuildFallbackReason; percent?: number } | undefined {
  const reason = reasons?.find((r): r is RebuildFallbackReason => (REBUILD_FALLBACK_REASONS as readonly string[]).includes(r));
  if (!reason) return undefined;
  const coverage = reasons?.find((r) => r.startsWith('coverage:'));
  const ratio = coverage ? Number(coverage.slice('coverage:'.length)) : NaN;
  return Number.isFinite(ratio) ? { reason, percent: Math.round(ratio * 100) } : { reason };
}
```

and in the component: `const fallback = rebuildFallbackOf(mvp.layout?.reasons);` the tooltip becomes, in order, `chosen`, then `t('mvpLayout.rebuildSummary', { sections, omitted: rebuild.omitted.length, fixes: rebuild.tuning.length })` when `mvp.rebuild`, then `t(\`mvpLayout.fallback.${fallback.reason.slice('rebuild:'.length)}\`, { percent })` when `fallback`, then the existing `unread` text; the `Chip` gets `color={fallback ? 'warning' : 'default'}` (theme-tinted; no hand-styled colors).

`MvpLayoutPicker.tsx`: no code change beyond the list now including `original` first; check the `title` attribute uses `mvpLayout.descriptions.original`.

`useLiveMvpLayout.ts`:

```ts
const crossesRenderer = (a: MvpLayoutVariant | undefined, b: MvpLayoutVariant) => (a === 'original') !== (b === 'original');
/** How long the picker waits for a re-render across renderers before it stops polling */
const RERENDER_WAIT_MS = 90_000;
```

In the hook: `const queryClient = useQueryClient();` and `const [rerender, setRerender] = useState<{ version: string; since: number } | null>(null);` where the watched `version` is `${mvpId}:${mvp?.generatedAt ?? ''}:${mvp?.editedAt ?? ''}`. In `changeLayout`, pass `onSuccess: () => { if (crossesRenderer(layout, variant)) setRerender({ version: watched, since: Date.now() }); }` to `mutation.mutate`. Clear it during render when `rerender && (rerender.version !== watched || Date.now() - rerender.since > RERENDER_WAIT_MS)`. An effect polls while it is set:

```ts
  useEffect(() => {
    if (!rerender) return;
    const id = setInterval(() => void queryClient.invalidateQueries({ queryKey: ['mvp', lead.id] }), 2000);
    return () => clearInterval(id);
  }, [rerender, queryClient, lead.id]);
```

Return `rerendering: Boolean(rerender)`. Skip posting `REVAMP_SET_LAYOUT` for a crossing pick (the effect posting on `layout` change: post only when `!crossesRenderer(saved, layout)`).

`MvpDesignTools.tsx`: `const rebuilt = liveLayout.layout === 'original';` → `<MvpEditPrompt edit={tools.edit} disabled={disabled || rebuilt} disabledReason={rebuilt ? t('mvpEdit.unsupported') : t('mvpEdit.locked')} />`; under the picker, when `liveLayout.rerendering`, a `<Typography variant="caption" color="text.secondary">{t('mvpLayout.rerendering')}</Typography>`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run apps/dashboard && npm run typecheck --workspace=@revamp/dashboard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard
git commit -m "feat(REV-110): show the rebuild and its fallback; disable edits on it"
```

---

### Task 11: Live check on the reference sites (and the deferred minors they surface)

**Files:**
- Create: `scripts/render_rebuild.ts`
- Possibly modify: `apps/workers/src/services/site-sections.page.ts` / `site-sections.service.ts` and their specs (only for a REV-109 minor seen on a reference site)

**Interfaces:**
- Consumes: `collectSiteLayoutInPage`, `collectSiteSectionsInPage`, `readSiteSections`, `EVALUATE_NAME_SHIM`, `cookieConsentService`, `planRebuild`, `RebuildPlanSchema`, `renderRebuild`.

- [ ] **Step 1: Write the script** (read-only: no DB, no MinIO), modelled on `scripts/read_site_sections.ts` (copy its browser, consent and scroll set-up verbatim):

```ts
/**
 * Rebuilds real home pages from their sections and writes the HTML to a local folder (REV-110).
 * Read-only: nothing is written to MongoDB or MinIO. Usage:
 *   npx tsx scripts/render_rebuild.ts <out-dir> https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/
 */
// … same imports and page set-up as read_site_sections.ts, plus:
import { mkdirSync, writeFileSync } from 'node:fs';
import { planRebuild } from '../apps/workers/src/services/rebuild-plan.service.js';
import { renderRebuild } from '../apps/workers/src/templates/rebuild/index.js';
import { RebuildPlanSchema, rebuildEligibility } from '../packages/validation/src/index.js';

// after `reading` is computed for a url:
const host = new URL(url).hostname;
const eligible = rebuildEligibility({ siteSections: reading.sections, siteSectionsError: reading.error });
if (!eligible.ok) { console.log(`${host}: FALLBACK ${eligible.reason} ${eligible.facts.join(' ')}`); continue; }
// Contacts for this local check only: the page's own tel:/mailto: links (the audit uses the verified extractor)
const links = reading.sections!.sections.flatMap((s) => [...s.intro.links, ...s.items.flatMap((i) => i.links)]);
const phone = links.find((l) => l.kind === 'phone')?.label;
const email = links.find((l) => l.kind === 'email')?.href.replace(/^mailto:/, '');
const plan = RebuildPlanSchema.parse(planRebuild({
  siteSections: reading.sections!, businessName: host, language: await page.evaluate(() => document.documentElement.lang),
  contacts: { phone, email }, socialLinks: [], primary: '#2563eb', year: new Date().getFullYear(),
}));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/${host}.html`, renderRebuild(plan));
console.log(`${host}: ${plan.summary.sections} sections, omitted ${plan.summary.omitted.length}, tuning ${plan.summary.tuning.join(' ')}`);
for (const o of plan.summary.omitted) console.log(`  omitted ${o.what} ${o.reason}: ${o.sample ?? ''}`);
```

(`outDir = process.argv[2]`, urls = `process.argv.slice(3)`.)

- [ ] **Step 2: Run it into the scratchpad**

Run: `npx tsx scripts/render_rebuild.ts /private/tmp/claude-501/-Users-yurykurouski-code-ehu-Revamp-dev/a2909a1d-c27d-47dd-ab3d-8e56131f2766/scratchpad/rebuild https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/`
Expected: three lines with no FALLBACK; Falco-Dent ~19 sections, Dentalux ~8, Elefant ~12.

- [ ] **Step 3: Side by side in Chrome** (chrome-devtools MCP; see memory "Chrome verification tooling"): serve the folder (`npx http-server <dir> -p 8765` or `python3 -m http.server 8765 -d <dir>`), open each rebuild next to its original at 1440 px and 375 px (`resize_page`), take screenshots, and read the console (`list_console_messages`): expect no errors. Check: same sections in the same order; Falco-Dent's team (10), "Co nas wyróżnia" (8), reviews slider; Elefant's team (5) and "Baza wiedzy"; Dentalux's slider hero; long Regulamin/RODO collapsed; contrast readable; booking form present once.

- [ ] **Step 4: Deferred REV-109 minors** — for each defect seen in Step 3 that comes from the reader (e.g. an eyebrow out of order, a `.topbar` outside the header losing contacts), write a failing fixture test in `apps/workers/src/services/__tests__/site-sections.page.spec.ts` reproducing the shape, fix the reader, run `npx vitest run apps/workers/src/services/__tests__/site-sections.page.spec.ts apps/workers/src/services/__tests__/site-sections.service.spec.ts` to PASS, re-run Step 2, and commit per fix (`fix(REV-110): …`). Defects in the rebuild itself go back to the owning task's tests (Task 5 or 6) the same way. List the minors left deferred in a ticket comment in Task 12.

- [ ] **Step 5: Commit the script**

```bash
git add scripts/render_rebuild.ts
git commit -m "feat(REV-110): read-only live rebuild script"
```

---

### Task 12: Gates, end-to-end check, docs, PR

**Files:**
- Modify: `AGENTS.md` (§3.2.2 note on the rebuild reading `siteSections`; §3.2.6 rebuild paragraph), `README.md` (feature list)
- Modify (docs repo `../Revamp-docs`): `spec.md`, `blueprint.md` (MvpProject.rebuild, deploy flow, §5 error codes `MVP_EDIT_UNSUPPORTED`, `MVP_REBUILD_UNAVAILABLE`), `milestones.md`
- Modify: `docs/superpowers/specs/2026-09-30-rev-110-section-rebuild-design.md` (fold in the three "Spec additions made while planning")

- [ ] **Step 1: Gates**

Run, in order, each to success: `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` (0 failures; if many 5 s timeouts appear, check `uptime` load and re-run — memory "Test timeouts under load"), `npm run build`.

- [ ] **Step 2: End to end in the running stack** (`npm run dev`; memories "Dashboard store in Chrome", "Check leads: no DB writes", "Concurrent sessions share dev data"): add a test lead for `https://falcodent.pl/` via Add lead, let the audit run, generate the MVP. In Chrome: the chip reads "Original site" with the summary tooltip; the preview shows the rebuild; a palette change re-colors the CTA live and after re-publish; the free-text prompt is disabled with the note; switching to Split shows "Re-rendering…" then the Bento page, and back to Original site likewise; the console shows no new errors. Never approve the lead. For the fallback, generate for a lead whose audit has no `siteSections` (an audit from before REV-109, or a site the reader fails on) and check the warning chip and its reason; switching it to Original site shows the 409 message.

- [ ] **Step 3: Docs**

`AGENTS.md` §3.2.6, append:

> The MVP is rendered as a rebuild of the original home page by default (REV-110): the `original` layout variant. `planRebuild` (`apps/workers/src/services/rebuild-plan.service.ts`) makes every decision from `Audit.siteSections` — sections in order, links (other pages dropped and recorded), allowlisted embeds, the booking form in place of the original form, verified contacts, and the tuning (contrast, type, spacing, alt text) — into an `IRebuildPlan` validated by `RebuildPlanSchema`; `renderRebuild` (`templates/rebuild/`) turns it into markup with one renderer per arrangement. `renderMvp` (`services/mvp-render.ts`) falls back to Bento when `rebuildEligibility` fails (coverage below `REBUILD_MIN_COVERAGE` 0.85, unread or empty sections) or the plan is invalid or too large, putting the `rebuild:*` reason first in `layout.reasons`; `MvpProject.rebuild` records the omissions and tuning codes. A new arrangement needs a renderer in `templates/rebuild/sections.ts` and its test; a new tuning rule goes in the planner with a code and a test. Until REV-111 the free-text change and custom design are refused on a rebuilt MVP (`MVP_EDIT_UNSUPPORTED`).

README: one feature line ("MVP rebuilt section by section from the original home page, tuned, with a visible fallback to the template (REV-110)"). Revamp-docs: `spec.md` — the `original` variant, the fallback rule and threshold, the two new error codes on the MVP endpoints; `blueprint.md` — `MvpProject.rebuild`, the rebuild step in the deploy flow, the codes in §5; `milestones.md` — REV-110 DoD items ticked. Commit there as `docs(REV-110): section rebuild` and push.

- [ ] **Step 4: PR** — push the branch, `gh pr create` titled `feat(REV-110): render the MVP as a section-by-section rebuild of the original`, body starting `Fixes [REV-110](https://linear.app/revamp-proect/issue/REV-110/render-the-mvp-as-a-section-by-section-rebuild-of-the-original-tuned)`, with `## Problem`, `## Changes`, `## Verification` (the exact gate commands and results, the three sites' section counts, omissions, tuning codes and screenshots), ending with the PR attribution line. Attach the PR to the ticket, move it to In Review, comment the Revamp-docs commit link and the minors left deferred.

- [ ] **Step 5: Merge** (memory "Merge in pipeline"): pull `main` into the branch, re-run the gates, `gh pr merge --merge`, pull `main`, `npm run build:packages && npm test`, move REV-110 to Done.
