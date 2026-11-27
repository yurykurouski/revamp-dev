/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { formatDate } from '../../i18n/languages.js';
import { EmailDraftEditor } from '../EmailDraftEditor.js';
import { APPROVE_ARM_DELAY_MS, ReviewActionBar } from '../leadReview/ReviewActionBar.js';
import { useEmailDraft } from '../../hooks/useEmailDraft.js';
import { ApiError, type ILeadItem } from '../../api/client.js';
import { DATE_FORMAT } from '../../utils/contactRight.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const NOW = new Date('2026-11-27T12:00:00.000Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const baseLead: ILeadItem = {
  id: 'lead-1',
  businessName: 'Dr. Smile',
  domain: 'drsmile.pl',
  originalUrl: 'https://drsmile.pl',
  niche: 'dental',
  city: 'Warsaw',
  status: 'NEEDS_APPROVAL',
  previewUrl: 'https://demo.example/dr-smile',
  createdAt: NOW.toISOString(),
};

const EmailStep: React.FC<Omit<React.ComponentProps<typeof ReviewActionBar>, 'step' | 'onBack' | 'onNext' | 'getDraft'>> = (props) => {
  const draft = useEmailDraft(props.lead);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(EmailDraftEditor, { lead: props.lead, draft }),
    React.createElement(ReviewActionBar, { ...props, step: 'email', onBack: () => {}, onNext: () => {}, getDraft: draft.rendered }),
  );
};

describe('lead review and the contact right (REV-228)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // Only the clock and intervals are faked: the approve arming delay is a real timeout
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  const mount = (lead: ILeadItem, props: Partial<React.ComponentProps<typeof ReviewActionBar>> = {}) =>
    act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(EmailStep, { lead, onApprove: async () => {}, onSendTest: async () => {}, onReject: async () => {}, ...props }),
        ),
      );
    });
  const armApprove = () => act(() => new Promise((r) => setTimeout(r, APPROVE_ARM_DELAY_MS + 20)));
  const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  const blocked = () => document.body.querySelector('[data-testid="contact-right-blocked-notice"]');

  it('disables Approve with the reason for an ended right and for a lead with no right', async () => {
    for (const contactRight of [{ expiresAt: iso(-DAY), active: false }, null]) {
      await mount({ ...baseLead, contactRight });
      await armApprove();
      expect(button(en.email.approve)!.disabled).toBe(true);
      expect(blocked()!.textContent).toBe(en.contactRight.approveBlocked);
    }
  });

  it('says the business opted out when the right ended for that reason', async () => {
    await mount({ ...baseLead, contactRight: { expiresAt: iso(20 * DAY), active: false, endedAt: iso(-DAY), endReason: 'opted_out' } });
    await armApprove();
    expect(button(en.email.approve)!.disabled).toBe(true);
    expect(blocked()!.textContent).toBe(en.contactRight.approveBlockedOptedOut);
  });

  it('enables Approve for an active and for an expiring right', async () => {
    for (const expiresAt of [iso(10 * DAY), iso(DAY)]) {
      await mount({ ...baseLead, contactRight: { expiresAt, active: true } });
      await armApprove();
      expect(button(en.email.approve)!.disabled).toBe(false);
      expect(blocked()).toBeNull();
    }
  });

  it('disables Approve when the right expires during the review', async () => {
    await mount({ ...baseLead, contactRight: { expiresAt: iso(2 * 60_000), active: true } });
    await armApprove();
    expect(button(en.email.approve)!.disabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(3 * 60_000);
    });

    expect(button(en.email.approve)!.disabled).toBe(true);
    expect(blocked()!.textContent).toBe(en.contactRight.approveBlocked);
  });

  it('a lead without the field (not read from the API) is not blocked by the screen', async () => {
    await mount(baseLead);
    await armApprove();
    expect(button(en.email.approve)!.disabled).toBe(false);
  });

  it('an approve refused with CONTACT_RIGHT_REQUIRED shows the localized text and asks for the lead again', async () => {
    const expiredAt = iso(-DAY);
    const onApprove = vi.fn().mockRejectedValue(new ApiError('raw server text', 409, 'CONTACT_RIGHT_REQUIRED', { expiredAt }));
    const onRightRefused = vi.fn();
    await mount({ ...baseLead, contactRight: { expiresAt: iso(10 * DAY), active: true } }, { onApprove, onRightRefused });
    await armApprove();

    await act(async () => button(en.email.approve)!.click());

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onRightRefused).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(`Your studio's right to contact this business ended on ${formatDate(expiredAt, 'en', DATE_FORMAT)}.`);
    expect(document.body.textContent).not.toContain('raw server text');
  });

  it('an opt-out refusal explains itself; other errors keep their text and do not reload the lead', async () => {
    const onRightRefused = vi.fn();
    const onApprove = vi.fn().mockRejectedValueOnce(new ApiError('x', 409, 'BUSINESS_OPTED_OUT')).mockRejectedValueOnce(new Error('boom'));
    await mount({ ...baseLead, contactRight: { expiresAt: iso(10 * DAY), active: true } }, { onApprove, onRightRefused });
    await armApprove();
    await act(async () => button(en.email.approve)!.click());
    expect(document.body.textContent).toContain(en.refusals.optedOut);
    expect(onRightRefused).toHaveBeenCalledTimes(1);

    await act(async () => button(en.email.approve)!.click());
    expect(document.body.textContent).toContain('boom');
    expect(onRightRefused).toHaveBeenCalledTimes(1);
  });

  it('shows why a send came back to review, for each code, on a lead awaiting approval only', async () => {
    const active = { expiresAt: iso(10 * DAY), active: true };
    const at = iso(-60_000);
    for (const code of ['CONTACT_RIGHT_EXPIRED', 'CONTACT_OPTED_OUT'] as const) {
      await mount({ ...baseLead, contactRight: active, outreachError: { code, message: 'm', at } });
      const text = document.body.querySelector('[data-testid="outreach-error-notice"]')!.textContent!;
      expect(text).toContain(en.outreachError[code]);
      expect(text).toContain(formatDate(at, 'en', DATE_FORMAT));
    }
    await mount({ ...baseLead, status: 'SENT', contactRight: active, outreachError: { code: 'CONTACT_OPTED_OUT', message: 'm', at } });
    expect(document.body.querySelector('[data-testid="outreach-error-notice"]')).toBeNull();
    await mount({ ...baseLead, contactRight: active });
    expect(document.body.querySelector('[data-testid="outreach-error-notice"]')).toBeNull();
  });
});
