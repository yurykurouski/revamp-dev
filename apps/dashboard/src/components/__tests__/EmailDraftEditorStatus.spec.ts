import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LeadStatus } from '@revamp/shared-types';
import '../../i18n/index.js';
import { EmailDraftEditor } from '../EmailDraftEditor.js';
import { ILeadItem } from '../../api/client.js';
import { en } from '../../i18n/locales/en.js';

const lead = (status: LeadStatus): ILeadItem => ({
  id: 'lead-1',
  businessName: 'Dr. Smile',
  domain: 'drsmile.pl',
  originalUrl: 'https://drsmile.pl',
  niche: 'dental',
  status,
  createdAt: new Date().toISOString(),
});

const render = (status: LeadStatus) =>
  renderToStaticMarkup(
    React.createElement(EmailDraftEditor, {
      lead: lead(status),
      onApprove: async () => {},
      onSendTest: async () => {},
      onReject: async () => {},
    }),
  );

/** Whether the button whose text contains `label` is rendered disabled */
const isDisabled = (html: string, label: string): boolean => {
  const text = label.replace(/&/g, '&amp;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const button = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${text}(?:(?!</button>).)*</button>`))?.[0];
  if (!button) throw new Error(`No button labelled ${label}`);
  return /<button[^>]*\sdisabled=""/.test(button);
};

const notice = (html: string) => html.includes('data-testid="outreach-status-notice"');

describe('EmailDraftEditor outreach actions by lead status (REV-59)', () => {
  it.each<LeadStatus>(['NEEDS_APPROVAL'])('offers approve and reject for a %s lead', (status) => {
    const html = render(status);
    expect(isDisabled(html, en.email.approve)).toBe(false);
    expect(isDisabled(html, en.email.reject)).toBe(false);
    expect(notice(html)).toBe(false);
  });

  it.each<LeadStatus>(['QUEUED', 'AUDITING', 'AUDIT_FAILED', 'AUDITED', 'GENERATING'])(
    'offers only reject for a %s lead that is not ready for review',
    (status) => {
      const html = render(status);
      expect(isDisabled(html, en.email.approve)).toBe(true);
      expect(isDisabled(html, en.email.reject)).toBe(false);
      expect(html).toContain(en.email.approveUnavailable.replace('{{status}}', status));
    },
  );

  it.each<LeadStatus>(['SCHEDULED', 'SENT', 'OPENED', 'CLICKED', 'ENGAGED', 'REJECTED', 'UNSUBSCRIBED'])(
    'offers neither approve nor reject for a %s lead',
    (status) => {
      const html = render(status);
      expect(isDisabled(html, en.email.approve)).toBe(true);
      expect(isDisabled(html, en.email.reject)).toBe(true);
      expect(html).toContain(en.email.outreachClosed.replace('{{status}}', status));
    },
  );
});
