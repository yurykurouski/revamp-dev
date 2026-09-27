/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type { LeadStatus } from '@revamp/shared-types';
import '../../i18n/index.js';
import { APPROVE_ARM_DELAY_MS, ReviewActionBar } from '../leadReview/ReviewActionBar.js';
import type { ReviewStep } from '../leadReview/steps.js';
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** The bar's markup once Approve has had time to arm */
const render = (status: LeadStatus, step: ReviewStep = 'email') => {
  act(() => {
    root.render(
      React.createElement(ReviewActionBar, {
        lead: lead(status),
        step,
        onBack: () => {},
        onNext: () => {},
        getDraft: () => ({ subject: 'S', body: 'B' }),
        onApprove: async () => {},
        onSendTest: async () => {},
        onReject: async () => {},
      }),
    );
  });
  act(() => vi.advanceTimersByTime(APPROVE_ARM_DELAY_MS));
  return container.innerHTML;
};

/** Whether the button whose text contains `label` is rendered disabled */
const isDisabled = (html: string, label: string): boolean => {
  const text = label.replace(/&/g, '&amp;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const button = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${text}(?:(?!</button>).)*</button>`))?.[0];
  if (!button) throw new Error(`No button labelled ${label}`);
  return /<button[^>]*\sdisabled=""/.test(button);
};

const notice = (html: string) => html.includes('data-testid="outreach-status-notice"');

describe('review action bar outreach actions by lead status (REV-59, REV-77)', () => {
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

  it.each<ReviewStep>(['audit', 'prototype'])('offers reject but no approve on the %s step', (step) => {
    const html = render('NEEDS_APPROVAL', step);
    expect(html).not.toContain(en.email.approve.replace(/&/g, '&amp;'));
    expect(html).not.toContain(en.email.sendTestToMe);
    expect(isDisabled(html, en.email.reject)).toBe(false);
    expect(notice(html)).toBe(false);
  });

  it('arms Approve only a moment after the email step opens', () => {
    act(() => {
      root.render(
        React.createElement(ReviewActionBar, {
          lead: lead('NEEDS_APPROVAL'),
          step: 'email',
          onBack: () => {},
          onNext: () => {},
          getDraft: () => ({ subject: 'S', body: 'B' }),
          onApprove: async () => {},
          onSendTest: async () => {},
          onReject: async () => {},
        }),
      );
    });
    expect(isDisabled(container.innerHTML, en.email.approve)).toBe(true);
    act(() => vi.advanceTimersByTime(APPROVE_ARM_DELAY_MS));
    expect(isDisabled(container.innerHTML, en.email.approve)).toBe(false);
  });
});
