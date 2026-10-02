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
  it('falls back to Bento on a flat reading, with rebuild:flat and its facts first (REV-112)', () => {
    const bento = vi.spyOn(bentoTemplateService, 'renderFromAudit').mockReturnValue('BENTO');
    const block = (index: number, chars: number) => ({
      index, role: 'content' as const, kind: 'other' as const, arrangement: 'text' as const,
      intro: { text: ['x'.repeat(chars)], links: [] }, items: [], extra: [], images: [], embeds: [], style: {},
    });
    // The anident.pl shape: three long blocks without headings
    const audit = { siteSections: { sections: [block(0, 4700), block(1, 3500), block(2, 350)], skipped: [], coverage: { pageChars: 8605, capturedChars: 8550, ratio: 0.994, uncaptured: [] } } };
    const out = renderMvp({ lead: {}, audit, layout: rebuildLayout(derived), derived, design: derived.design });
    expect(out.html).toBe('BENTO');
    expect(out.rebuild).toBeUndefined();
    expect(out.layout.reasons.slice(0, 4)).toEqual(['rebuild:flat', 'flat:share=0.55', 'flat:headings=0/3', 'rule:derived']);
    expect(bento).toHaveBeenCalledOnce();
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
