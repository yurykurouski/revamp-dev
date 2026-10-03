import { describe, it, expect } from 'vitest';
import type { ISiteSection } from '@revamp/shared-types';
import {
  MVP_CUSTOM_CSS_MAX,
  REBUILD_EDIT_LIMITS,
  RebuildEditAnswerSchema,
  RebuildEditOutputSchema,
  RebuildEditSchema,
  SITE_SECTIONS_LIMITS,
  checkRebuildEdit,
  hasRebuildEdit,
  rebuildH1Section,
} from '../src/index.js';

const section = (index: number, role: ISiteSection['role'], heading?: string): ISiteSection => ({
  index,
  role,
  kind: 'about',
  arrangement: 'text',
  intro: { ...(heading ? { heading, headingLevel: 2 } : {}), text: ['One.', 'Two.'], links: [] },
  items: [{ title: 'A', text: [], links: [] }],
  extra: [{ type: 'text', text: ['Extra.'] }],
  images: [],
  embeds: [],
  style: {},
} as unknown as ISiteSection);

const page = {
  sections: [section(0, 'header'), section(1, 'hero', 'Welcome'), section(2, 'content', 'About'), section(3, 'content', 'Reviews'), section(4, 'footer')],
};

const full = {
  order: ['s-1', 's-3', 's-2'],
  hidden: ['s-2'],
  dropped: ['s-3.t0', 's-3.i0', 's-3.x0'],
  sections: { 's-3': { background: 'dark', align: 'center', density: 'airy' } },
  theme: { font: 'serif', density: 'compact', corners: 'rounded', headingCase: 'uppercase' },
  customCss: '.rb-heading { letter-spacing: .02em; }',
};

describe('RebuildEditAnswerSchema (REV-111)', () => {
  it('accepts a full edit', () => {
    expect(RebuildEditAnswerSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['an unknown key', { ...full, headline: 'New text' }],
    ['a bad section id', { hidden: ['x-1'] }],
    ['a bad piece id', { dropped: ['s-1.q0'] }],
    ['a section id as a piece', { dropped: ['s-1'] }],
    ['a background outside the list', { sections: { 's-1': { background: '#000000' } } }],
    ['a free string in a section', { sections: { 's-1': { heading: 'New' } } }],
    ['a free string in the theme', { theme: { font: 'Comic Sans' } }],
    ['too many sections in the order', { order: Array.from({ length: SITE_SECTIONS_LIMITS.sections + 1 }, (_, i) => `s-${i}`) }],
    ['too many dropped pieces', { dropped: Array.from({ length: REBUILD_EDIT_LIMITS.dropped + 1 }, (_, i) => `s-1.t${i}`) }],
    ['too much CSS', { customCss: 'a'.repeat(MVP_CUSTOM_CSS_MAX + 1) }],
  ])('rejects %s', (_label, edit) => {
    expect(RebuildEditAnswerSchema.safeParse(edit).success).toBe(false);
  });

  it('the saved edit needs the audit id, and the answer may not carry one', () => {
    expect(RebuildEditSchema.safeParse({ ...full, auditId: '0123456789abcdef01234567' }).success).toBe(true);
    expect(RebuildEditSchema.safeParse(full).success).toBe(false);
    expect(RebuildEditAnswerSchema.safeParse({ ...full, auditId: '0123456789abcdef01234567' }).success).toBe(false);
  });
});

describe('RebuildEditOutputSchema (REV-111)', () => {
  it('accepts keeping everything, or dropping the edit', () => {
    expect(RebuildEditOutputSchema.safeParse({ summary: 'Nothing to do', edit: null, primaryColor: null, layout: null }).success).toBe(true);
    expect(RebuildEditOutputSchema.safeParse({ summary: 'Dropped', edit: {} }).success).toBe(true);
  });

  it('rejects an empty summary, a colour name and an unknown layout', () => {
    expect(RebuildEditOutputSchema.safeParse({ summary: ' ' }).success).toBe(false);
    expect(RebuildEditOutputSchema.safeParse({ summary: 'x', primaryColor: 'red' }).success).toBe(false);
    expect(RebuildEditOutputSchema.safeParse({ summary: 'x', layout: 'grid' }).success).toBe(false);
  });
});

describe('hasRebuildEdit (REV-111)', () => {
  it.each([undefined, null, { auditId: 'a' }, { order: [] }, { sections: { 's-1': {} } }, { theme: {} }, { customCss: '  ' }])('%j changes nothing', (edit) => {
    expect(hasRebuildEdit(edit as never)).toBe(false);
  });

  it.each([{ order: ['s-1'] }, { hidden: ['s-1'] }, { dropped: ['s-1.t0'] }, { sections: { 's-1': { align: 'center' } } }, { theme: { font: 'serif' } }, { customCss: 'a{}' }])(
    '%j changes the page',
    (edit) => {
      expect(hasRebuildEdit(edit as never)).toBe(true);
    },
  );
});

describe('checkRebuildEdit (REV-111)', () => {
  it('accepts an edit that names only the page own sections and pieces', () => {
    expect(checkRebuildEdit({ order: ['s-1', 's-3'], hidden: ['s-2'], dropped: ['s-3.t1', 's-3.i0', 's-3.x0'], sections: { 's-3': { align: 'center' } } }, page)).toEqual({ ok: true });
  });

  it.each([
    ['an unknown section', { hidden: ['s-9'] }, 'unknown section s-9'],
    ['the header', { order: ['s-0'] }, 'unknown section s-0'],
    ['the footer', { sections: { 's-4': { align: 'center' } } }, 'unknown section s-4'],
    ['a paragraph past the end', { dropped: ['s-2.t2'] }, 'unknown piece s-2.t2'],
    ['an item past the end', { dropped: ['s-2.i1'] }, 'unknown piece s-2.i1'],
    ['a piece of the footer', { dropped: ['s-4.t0'] }, 'unknown piece s-4.t0'],
    ['a repeat in the order', { order: ['s-1', 's-2', 's-2'] }, 's-2 is listed twice'],
    ['a repeated piece', { dropped: ['s-2.t0', 's-2.t0'] }, 's-2.t0 is listed twice'],
    ['the main heading hidden', { hidden: ['s-1'] }, "s-1 holds the page's main heading and cannot be hidden"],
    ['the opening section moved', { order: ['s-2', 's-1'] }, 's-1 opens the page and must stay first'],
  ])('rejects %s', (_label, edit, reason) => {
    expect(checkRebuildEdit(edit, page)).toEqual({ ok: false, reason });
  });

  it('rejects hiding every section', () => {
    const noHero = { sections: [section(2, 'content', 'About'), section(3, 'content')] };
    expect(checkRebuildEdit({ hidden: ['s-2', 's-3'] }, noHero)).toEqual({ ok: false, reason: 'every section is hidden' });
  });

  it('lets a main heading that does not open the page move', () => {
    const late = { sections: [section(2, 'content', 'About'), section(3, 'hero', 'Welcome'), section(5, 'content')] };
    expect(rebuildH1Section(late.sections)?.index).toBe(3);
    expect(checkRebuildEdit({ order: ['s-5', 's-2'] }, late)).toEqual({ ok: true });
  });
});
