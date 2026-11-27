/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { IAuditDetail, ILeadItem } from '../../api/client.js';
import { renderEmailDraft } from '../../utils/emailTemplate.js';
import { defaultEmailDraft, draftSignOff, draftSignerName, useEmailDraft, type EmailDraft } from '../useEmailDraft.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('the studio signs the default draft (REV-223)', () => {
  it('ends with the signer name', () => {
    expect(defaultEmailDraft(lead, audit, 'Studio Kraków').body.endsWith('Best regards,\nStudio Kraków')).toBe(true);
  });

  it('ends with a plain sign-off without a signer', () => {
    expect(defaultEmailDraft(lead, audit).body.endsWith('Best regards')).toBe(true);
    expect(draftSignOff()).toBe('Best regards');
    expect(draftSignOff('S')).toBe('Best regards,\nS');
  });

  for (const signer of ['Studio Kraków', undefined]) {
    it(`names no platform with ${signer ?? 'no signer'}`, () => {
      const draft = defaultEmailDraft(lead, audit, signer);
      const text = [draft.subject, draft.preheader, draft.body].join('\n');
      expect(text).not.toMatch(/revamp/i);
      expect(text).not.toMatch(/platform/i);
    });
  }

  it('speaks as the studio about the prototype', () => {
    expect(defaultEmailDraft(lead, audit).body).toContain('we built a prototype of your updated website:');
  });

  it('picks the signer: the configured sender, else the organization, else none', () => {
    expect(draftSignerName({ configured: true, name: 'S', address: 'a@b.test' }, 'Org')).toBe('S');
    expect(draftSignerName({ configured: false }, 'Org')).toBe('Org');
    expect(draftSignerName(undefined, 'Org')).toBe('Org');
    expect(draftSignerName(undefined, '  ')).toBeUndefined();
    expect(draftSignerName(undefined, undefined)).toBeUndefined();
  });
});

describe('useEmailDraft signer (REV-223)', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let current: EmailDraft;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = undefined;
  });

  function Probe(props: { signer?: string }) {
    current = useEmailDraft(lead, audit, props.signer);
    return null;
  }

  const render = (signer?: string) => {
    if (!root) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    }
    act(() => root!.render(createElement(Probe, { signer })));
  };

  it('signs with the signer it starts with', () => {
    render('Org');
    expect(current.body.endsWith('Best regards,\nOrg')).toBe(true);
  });

  it('follows a signer change while the body is untouched', () => {
    render('Org');
    render('Studio Kraków');
    expect(current.body.endsWith('Best regards,\nStudio Kraków')).toBe(true);
    render('Studio Gdańsk');
    expect(current.body.endsWith('Best regards,\nStudio Gdańsk')).toBe(true);
  });

  it('keeps an edited body when the signer arrives later', () => {
    render('Org');
    act(() => current.setBody('custom'));
    render('Studio Kraków');
    expect(current.body).toBe('custom');
  });

  it('keeps the subject and preheader across a signer change', () => {
    render('Org');
    const { subject, preheader } = current;
    render('Studio Kraków');
    expect(current.subject).toBe(subject);
    expect(current.preheader).toBe(preheader);
  });
});
