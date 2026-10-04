import { describe, expect, it, vi } from 'vitest';
import type { IAudit, ISiteSections } from '@revamp/shared-types';
import { RebuildUnavailable, defaultRebuildPrimary, editForAudit, rebuildTemplateService } from '../rebuild-template.service.js';
import { checkMvpStandards } from '../mvp-standards.js';

const siteSections = (ratio = 0.98): ISiteSections => ({
  sections: [{ index: 1, role: 'hero', kind: 'other', arrangement: 'banner', intro: { heading: 'Witamy', text: ['Tekst'], links: [] }, items: [], extra: [], images: [], embeds: [], style: {} }],
  typography: { heading: { family: 'Lato', size: 32, weight: 700, uppercase: false }, body: { family: 'Lato', size: 16, weight: 400 }, button: { radius: 4, filled: true, uppercase: false, background: '#c2185b' } },
  skipped: [], coverage: { pageChars: 100, capturedChars: 98, ratio, uncaptured: [] },
});
const audit = (over: Partial<IAudit> = {}): Partial<IAudit> => ({ siteSections: siteSections(), extractedContacts: { phone: '+48 1 2 3' } as IAudit['extractedContacts'], extractedContent: { language: 'pl' } as IAudit['extractedContent'], ...over });

describe('rebuildTemplateService (REV-110)', () => {
  it('renders the rebuild and returns its summary', () => {
    const { html, summary } = rebuildTemplateService.renderFromAudit({ businessName: 'Falco-Dent' }, audit(), undefined, undefined, undefined, new Date('2026-09-30'));
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

describe('rebuildTemplateService with the operator edit (REV-111)', () => {
  const auditId = '0123456789abcdef01234567';
  const withSections = () => {
    const read = siteSections();
    read.sections.push({ ...read.sections[0]!, index: 2, role: 'content', intro: { heading: 'O nas', text: ['Drugi'], links: [] } });
    return audit({ _id: auditId, siteSections: read } as Partial<IAudit>);
  };

  it('applies an edit made for this audit', () => {
    const { html, summary } = rebuildTemplateService.renderFromAudit({ businessName: 'X' }, withSections(), undefined, { auditId, hidden: ['s-2'] });
    expect(html).not.toContain('id="s-2"');
    expect(summary.omitted).toContainEqual({ what: 'section', reason: 'hidden', sample: 'O nas' });
  });

  it('leaves out an edit made for another audit, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { html } = rebuildTemplateService.renderFromAudit({ businessName: 'X' }, withSections(), undefined, { auditId: 'ffffffffffffffffffffffff', hidden: ['s-2'] });
    expect(html).toContain('id="s-2"');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('editForAudit strips the audit id', () => {
    expect(editForAudit({ auditId, order: ['s-1'] }, { _id: auditId } as unknown as Partial<IAudit>)).toEqual({ order: ['s-1'] });
    expect(editForAudit(undefined, {})).toBeUndefined();
  });
});

describe('rebuildTemplateService with the modernize layer (REV-114)', () => {
  it('applies the modernize design under no edit', () => {
    const plain = rebuildTemplateService.renderFromAudit({ businessName: 'X' }, audit(), undefined, undefined, undefined, new Date('2026-09-30'));
    const modern = rebuildTemplateService.renderFromAudit({ businessName: 'X' }, audit(), undefined, undefined, { theme: { typeScale: 'modern' } }, new Date('2026-09-30'));
    expect(modern.html).not.toBe(plain.html);
    expect(modern.summary.tuning.some((code) => code.startsWith('modernize:'))).toBe(true);
    expect(plain.summary.tuning.some((code) => code.startsWith('modernize:'))).toBe(false);
  });
});

describe('rebuildTemplateService search and sharing tags (REV-118)', () => {
  const failed = { https: true, viewport: true, title: true, metaDescription: false, singleH1: false, favicon: false, structuredData: false, openGraph: false };

  it('renders a page that passes every standards check it can, with the original description', () => {
    const { html, summary } = rebuildTemplateService.renderFromAudit(
      { businessName: 'Falco-Dent', originalUrl: 'https://falcodent.pl/' },
      audit({
        extractedContent: { language: 'pl', metaDescription: 'Stomatologia w Warszawie', paragraphs: [] } as unknown as IAudit['extractedContent'],
        standardsChecks: failed,
      }),
    );
    expect(html).toContain('<meta name="description" content="Stomatologia w Warszawie">');
    expect(html).toContain('<meta property="og:locale" content="pl_PL">');
    expect(html).toContain('"@type":"LocalBusiness"');
    expect(summary.tuning).toEqual(expect.arrayContaining(['seo:description', 'seo:og', 'seo:jsonld']));
    expect(checkMvpStandards(html)).toEqual({
      checks: { https: true, viewport: true, title: true, metaDescription: true, singleH1: true, favicon: true, structuredData: true, openGraph: true },
      score: 100,
    });
  });

  it('keeps a single h1 when the page has no hero heading (the business name, visually hidden)', () => {
    const noHeading = siteSections();
    noHeading.sections = [{ ...noHeading.sections[0]!, intro: { text: ['Tekst bez nagłówka'], links: [] } }];
    const { html } = rebuildTemplateService.renderFromAudit({ businessName: 'Falco-Dent' }, audit({ siteSections: noHeading }));
    expect(checkMvpStandards(html).checks.singleH1).toBe(true);
  });

  it('leaves the description out when the original has none and no paragraph long enough', () => {
    const { html } = rebuildTemplateService.renderFromAudit({ businessName: 'Falco-Dent' }, audit());
    expect(html).not.toContain('name="description"');
  });
});
