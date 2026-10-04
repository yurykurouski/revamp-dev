import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IAudit, IMvpLayoutSelection, IRebuildModernize, ISiteSections } from '@revamp/shared-types';
import { MvpRenderError, rebuildLayout, rebuildLevelFor, renderMvp, requestedVariant, withRebuildLevel } from '../mvp-render.js';
import { bentoTemplateService } from '../template.service.js';
import { RebuildUnavailable, rebuildTemplateService } from '../rebuild-template.service.js';

const derived: IMvpLayoutSelection = { variant: 'split', reasons: ['rule:derived', 'hero:side-right', 'images:5'], design: { hero: { align: 'left' } } };

describe('layout helpers (REV-110)', () => {
  it('rebuildLayout keeps the audit facts and the derived look', () => {
    expect(rebuildLayout(derived)).toEqual({ variant: 'original', reasons: ['rule:rebuild', 'hero:side-right', 'images:5'], design: derived.design });
  });
  it('requestedVariant reads only manual picks, including an original that fell back before REV-132', () => {
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
  /** The render failure renderMvp throws, or undefined when it does not throw one */
  const failureOf = (render: () => unknown) => {
    try {
      render();
    } catch (error) {
      if (error instanceof MvpRenderError) return error.failure;
      throw error;
    }
    return undefined;
  };
  it('fails with the reason when the rebuild is unavailable, and never renders Bento in its place (REV-132)', () => {
    vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockImplementation(() => { throw new RebuildUnavailable('rebuild:invalid', ['invalid:sections']); });
    const bento = vi.spyOn(bentoTemplateService, 'renderFromAudit').mockReturnValue('BENTO');
    const failure = failureOf(() => renderMvp({ lead: {}, audit: {}, layout: rebuildLayout(derived), derived, design: derived.design }));
    expect(failure).toEqual({ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'rebuild:invalid', level: 'faithful', message: 'Rebuild unavailable: rebuild:invalid (invalid:sections)' });
    expect(bento).not.toHaveBeenCalled();
  });
  it("fails with the vision model's reason when the audit has no grouping (REV-132)", () => {
    const bento = vi.spyOn(bentoTemplateService, 'renderFromAudit').mockReturnValue('BENTO');
    for (const reason of ['not_configured', 'call_failed', 'invalid_answer', 'ineligible'] as const) {
      const audit = { siteSectionsError: 'No vision model', siteSectionsErrorReason: reason };
      expect(failureOf(() => renderMvp({ lead: {}, audit, layout: rebuildLayout(derived), derived }))).toMatchObject({ code: 'MVP_REBUILD_UNAVAILABLE', reason: `grouping:${reason}` });
    }
    expect(bento).not.toHaveBeenCalled();
  });
  it('fails on a flat reading with rebuild:flat (REV-112, REV-132)', () => {
    const bento = vi.spyOn(bentoTemplateService, 'renderFromAudit').mockReturnValue('BENTO');
    const block = (index: number, chars: number) => ({
      index, role: 'content' as const, kind: 'other' as const, arrangement: 'text' as const,
      intro: { text: ['x'.repeat(chars)], links: [] }, items: [], extra: [], images: [], embeds: [], style: {},
    });
    // The anident.pl shape: three long blocks without headings
    const audit = { siteSections: { sections: [block(0, 4700), block(1, 3500), block(2, 350)], skipped: [], coverage: { pageChars: 8605, capturedChars: 8550, ratio: 0.994, uncaptured: [] }, source: 'llm' as const } };
    const failure = failureOf(() => renderMvp({ lead: {}, audit, layout: rebuildLayout(derived), derived, design: derived.design }));
    expect(failure).toMatchObject({ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'rebuild:flat' });
    expect(failure?.message).toContain('flat:share=0.55');
    expect(bento).not.toHaveBeenCalled();
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
    skipped: [], coverage: { pageChars: 100, capturedChars: 98, ratio: 0.98, uncaptured: [] }, source: 'llm',
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
    const failureOf = (render: () => unknown) => {
      try {
        render();
      } catch (error) {
        if (error instanceof MvpRenderError) return error.failure;
        throw error;
      }
      return undefined;
    };
    it('fails with the stored reason when the model gave no modern design, and renders nothing in its place (REV-132)', () => {
      const render = vi.spyOn(rebuildTemplateService, 'renderFromAudit');
      for (const error of ['not_configured', 'call_failed', 'invalid_answer'] as const) {
        const failed: IRebuildModernize = { auditId, source: 'failed', error, message: 'detail' };
        expect(failureOf(() => renderMvp({ lead: {}, audit, layout: modern, derived, modernize: failed }))).toEqual({
          code: 'MVP_MODERNIZE_UNAVAILABLE',
          reason: error,
          level: 'modern',
          message: 'detail',
        });
      }
      expect(render).not.toHaveBeenCalled();
    });
    it('names the rebuild first when neither the grouping nor the modern design is there', () => {
      const failed: IRebuildModernize = { auditId, source: 'failed', error: 'not_configured' };
      const unread = { _id: auditId, siteSectionsErrorReason: 'not_configured' } as unknown as Partial<IAudit>;
      expect(failureOf(() => renderMvp({ lead: {}, audit: unread, layout: modern, derived, modernize: failed }))).toMatchObject({ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'grouping:not_configured' });
    });
    it('never applies a design stored for another audit or a default stored before REV-132', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const render = vi.spyOn(rebuildTemplateService, 'renderFromAudit');
      expect(() => renderMvp({ lead: {}, audit, layout: modern, derived, modernize: { ...stored, auditId: 'ffffffffffffffffffffffff' } })).toThrow(/no modern design/);
      const legacy = { ...stored, source: 'default', error: 'not_configured' } as unknown as IRebuildModernize;
      expect(() => renderMvp({ lead: {}, audit, layout: modern, derived, modernize: legacy })).toThrow(/no modern design/);
      expect(render).not.toHaveBeenCalled();
    });
    it('drops the modernize:default code an MVP rendered before REV-132 carries', () => {
      vi.spyOn(rebuildTemplateService, 'renderFromAudit').mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 2, omitted: [], tuning: [] } });
      const old = { ...modern, reasons: ['rule:rebuild', 'modernize:dated', 'dated:7', 'modernize:default', 'hero:side-right'] };
      expect(renderMvp({ lead: {}, audit, layout: old, derived, modernize: stored }).layout.reasons).toEqual(['rule:rebuild', 'modernize:dated', 'dated:7', 'hero:side-right']);
    });
  });
});
