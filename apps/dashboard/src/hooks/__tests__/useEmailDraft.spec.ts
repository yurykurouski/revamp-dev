import { describe, expect, it } from 'vitest';
import type { IAuditDetail, ILeadItem } from '../../api/client.js';
import { renderEmailDraft } from '../../utils/emailTemplate.js';
import { defaultEmailDraft } from '../useEmailDraft.js';

const lead: ILeadItem = {
  id: 'lead-1',
  businessName: 'Barber Warszawa',
  domain: 'barber.example.pl',
  originalUrl: 'https://barber.example.pl',
  niche: 'BARBERSHOP' as ILeadItem['niche'],
  city: 'Warszawa',
  status: 'NEEDS_APPROVAL' as ILeadItem['status'],
  auditId: 'audit-1',
  previewUrl: 'https://demos.example/v/barber/index.html',
  mvpGeneratedAt: '2026-10-30T10:00:00.000Z',
  createdAt: '2026-10-29T10:00:00.000Z',
};

/** A rebuild of the original page (REV-110) and an MVP from the old Bento template both get this draft */
const leads: Array<[string, ILeadItem]> = [
  ['a rebuilt MVP', lead],
  ['a Bento MVP', { ...lead, id: 'lead-2', previewUrl: 'https://demos.example/v/bento/index.html' }],
];

const audit = { lcpSeconds: 4.2 } as IAuditDetail;

function draftText(item: ILeadItem, withAudit: IAuditDetail | null = audit): string {
  const draft = defaultEmailDraft(item, withAudit);
  return [draft.subject, draft.preheader, draft.body].join('\n');
}

describe('defaultEmailDraft (REV-128)', () => {
  for (const [name, item] of leads) {
    describe(`for ${name}`, () => {
      it('never names the internal template', () => {
        expect(draftText(item)).not.toMatch(/\bBento\b/i);
      });

      it('describes the prototype neutrally', () => {
        const draft = defaultEmailDraft(item, audit);
        expect(draft.preheader).toBe('We built an interactive prototype of your updated website for Warszawa');
        expect(draft.body).toContain('a prototype of your updated website');
        expect(draft.body).toContain('{{demoUrl}}');
      });

      it('makes no fixed claims the prototype does not back', () => {
        const text = draftText(item);
        expect(text).not.toMatch(/key improvements/i);
        expect(text).not.toMatch(/fast loading/i);
        expect(text).not.toMatch(/one-tap booking/i);
        expect(text).not.toMatch(/services grid/i);
        expect(text).not.toMatch(/conversion|high-converting/i);
        expect(text).not.toMatch(/faster LCP/i);
      });

      it('quotes the LCP only when the audit measured it', () => {
        expect(draftText(item)).toContain('loads in 4.2s (LCP)');
        const unmeasured = draftText(item, null);
        expect(unmeasured).not.toMatch(/\d+(\.\d+)?s\b/);
        expect(unmeasured).not.toContain('LCP');
      });

      it('renders the demo link into the body', () => {
        const draft = defaultEmailDraft(item, audit);
        const rendered = renderEmailDraft(draft, { businessName: item.businessName, city: item.city, demoUrl: item.previewUrl });
        expect(rendered.body).toContain(item.previewUrl);
      });
    });
  }

  it('leaves the city out of the preheader when it is unknown', () => {
    expect(defaultEmailDraft({ ...lead, city: undefined }, audit).preheader).toBe(
      'We built an interactive prototype of your updated website',
    );
  });
});
