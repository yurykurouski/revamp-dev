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
