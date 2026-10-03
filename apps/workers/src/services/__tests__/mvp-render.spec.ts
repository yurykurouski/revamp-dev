import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IAudit, IMvpLayoutSelection, IRebuildModernize, ISiteSections } from '@revamp/shared-types';
import { fallbackLayout, rebuildLayout, rebuildLevelFor, renderMvp, requestedVariant, withRebuildLevel } from '../mvp-render.js';
import { defaultModernDesign } from '../rebuild-modernize.js';
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

describe('the rebuild level (REV-114)', () => {
  const auditId = '0123456789abcdef01234567';
  const block = (index: number, role: 'hero' | 'content', heading: string) => ({
    index, role, kind: 'other' as const, arrangement: 'text' as const,
    intro: { heading, text: ['Pierwszy akapit.', 'Drugi akapit.', 'Trzeci akapit.'], links: [] }, items: [], extra: [], images: [], embeds: [], style: {},
  });
  const siteSections: ISiteSections = {
    sections: [block(1, 'hero', 'Witamy'), block(2, 'content', 'O nas')],
    typography: { heading: { family: 'Lato', size: 32, weight: 700, uppercase: false }, body: { family: 'Lato', size: 16, weight: 400 }, button: { radius: 4, filled: true, uppercase: false, background: '#c2185b' } },
    skipped: [], coverage: { pageChars: 100, capturedChars: 98, ratio: 0.98, uncaptured: [] },
  };
  const audit = { _id: auditId, siteSections } as unknown as Partial<IAudit>;
  const stored: IRebuildModernize = { auditId, source: 'llm', design: { theme: { typeScale: 'modern' }, sections: { 's-2': { background: 'tinted' } } } };
  const modern = withRebuildLevel(rebuildLayout(derived), { level: 'modern', reasons: ['modernize:dated', 'dated:7'] });

  afterEach(() => vi.restoreAllMocks());

  describe('rebuildLevelFor', () => {
    it("keeps the operator's level over the detector", () => {
      expect(rebuildLevelFor({ rebuildLevel: 'faithful', reasons: ['rule:manual', 'modernize:manual'] }, { siteEra: { dated: true, score: 7, signs: [] } })).toEqual({
        level: 'faithful',
        reasons: ['modernize:manual'],
      });
      expect(rebuildLevelFor({ rebuildLevel: 'modern', reasons: ['rule:manual', 'modernize:manual'] }, {}).level).toBe('modern');
    });
    it('modernizes a dated site, with the score', () => {
      expect(rebuildLevelFor(undefined, { siteEra: { dated: true, score: 7, signs: [] } })).toEqual({ level: 'modern', reasons: ['modernize:dated', 'dated:7'] });
      // A previous detector choice is not a pick: the new audit decides
      expect(rebuildLevelFor({ rebuildLevel: 'modern', reasons: ['rule:rebuild', 'modernize:dated'] }, { siteEra: { dated: false, score: 1, signs: [] } }).level).toBe('faithful');
    });
    it('stays faithful on an undated or unread site', () => {
      expect(rebuildLevelFor(null, { siteEra: { dated: false, score: 2, signs: [] } })).toEqual({ level: 'faithful', reasons: [] });
      expect(rebuildLevelFor(null, {})).toEqual({ level: 'faithful', reasons: [] });
    });
  });

  describe('withRebuildLevel', () => {
    it('puts the level codes after the rule and replaces older ones, within the caps', () => {
      expect(modern).toMatchObject({ variant: 'original', rebuildLevel: 'modern', reasons: ['rule:rebuild', 'modernize:dated', 'dated:7', 'hero:side-right', 'images:5'] });
      const again = withRebuildLevel(modern, { level: 'faithful', reasons: [] });
      expect(again).toMatchObject({ rebuildLevel: 'faithful', reasons: ['rule:rebuild', 'hero:side-right', 'images:5'] });
      const full = withRebuildLevel({ variant: 'original', reasons: ['rule:rebuild', ...Array.from({ length: 11 }, (_, i) => `fact:${i}`)] }, { level: 'modern', reasons: ['modernize:dated', 'dated:7'] });
      expect(full.reasons).toHaveLength(12);
      expect(full.reasons.slice(0, 3)).toEqual(['rule:rebuild', 'modernize:dated', 'dated:7']);
    });
    it('leaves a Bento layout alone', () => {
      expect(withRebuildLevel(derived, { level: 'modern', reasons: ['modernize:dated'] })).toBe(derived);
    });
  });

  describe('renderMvp', () => {
    it('passes the stored design at modern and records the level', () => {
      const render = vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 2, omitted: [], tuning: [] } });
      const out = renderMvp({ lead: {}, audit, layout: modern, derived, modernize: stored });
      expect(render.mock.calls[0]![4]).toEqual(stored.design);
      expect(out.rebuild?.level).toBe('modern');
      expect(out.layout).toBe(modern);
    });
    it('records faithful on a plain rebuild', () => {
      vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 2, omitted: [], tuning: [] } });
      expect(renderMvp({ lead: {}, audit, layout: rebuildLayout(derived), derived }).rebuild?.level).toBe('faithful');
    });
    it('renders the same page at faithful whether a design is stored or not', () => {
      const faithful = withRebuildLevel(rebuildLayout(derived), { level: 'faithful', reasons: [] });
      const plain = renderMvp({ lead: { businessName: 'X' }, audit, layout: faithful, derived });
      const withStored = renderMvp({ lead: { businessName: 'X' }, audit, layout: faithful, derived, modernize: stored });
      expect(withStored.html).toBe(plain.html);
      const modernHtml = renderMvp({ lead: { businessName: 'X' }, audit, layout: modern, derived, modernize: stored }).html;
      expect(modernHtml).not.toBe(plain.html);
    });
    it('marks a default design on the layout, and drops the mark when the model chose', () => {
      vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 2, omitted: [], tuning: [] } });
      const out = renderMvp({ lead: {}, audit, layout: modern, derived, modernize: { ...stored, source: 'default', error: 'not_configured' } });
      expect(out.layout.reasons).toEqual(['rule:rebuild', 'modernize:dated', 'dated:7', 'modernize:default', 'hero:side-right', 'images:5']);
      expect(renderMvp({ lead: {}, audit, layout: out.layout, derived, modernize: stored }).layout.reasons).not.toContain('modernize:default');
    });
    it('ignores a design stored for another audit, rendering the default', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const render = vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 2, omitted: [], tuning: [] } });
      const out = renderMvp({ lead: {}, audit, layout: modern, derived, modernize: { ...stored, auditId: 'ffffffffffffffffffffffff' } });
      expect(render.mock.calls[0]![4]).toEqual(defaultModernDesign(siteSections));
      expect(out.layout.reasons).toContain('modernize:default');
      expect(warn).toHaveBeenCalled();
    });
    it('a Bento fallback ignores the level', () => {
      vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockImplementation(() => { throw new RebuildUnavailable('rebuild:invalid'); });
      vi.spyOn(bentoTemplateService, 'renderFromAudit').mockReturnValue('BENTO');
      const out = renderMvp({ lead: {}, audit, layout: modern, derived, modernize: stored });
      expect(out.rebuild).toBeUndefined();
      expect(out.layout.rebuildLevel).toBeUndefined();
      expect(out.layout.reasons.some((r) => r.startsWith('modernize:') || r.startsWith('dated:'))).toBe(false);
    });
  });
});
