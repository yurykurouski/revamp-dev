/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { OrganizationRole } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { EmailDraftEditor } from '../EmailDraftEditor.js';
import { APPROVE_ARM_DELAY_MS, ReviewActionBar } from '../leadReview/ReviewActionBar.js';
import { useEmailDraft } from '../../hooks/useEmailDraft.js';
import { ApiError, type ILeadItem } from '../../api/client.js';
import { useAuthStore } from '../../store/useAuthStore.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lead: ILeadItem = {
  id: 'lead-1',
  businessName: 'Dr. Smile',
  domain: 'drsmile.pl',
  originalUrl: 'https://drsmile.pl',
  niche: 'dental',
  city: 'Warsaw',
  status: 'NEEDS_APPROVAL',
  previewUrl: 'https://demo.example/dr-smile',
  createdAt: new Date().toISOString(),
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

describe('lead review without a studio sender (REV-221)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const mount = (props: Partial<React.ComponentProps<typeof ReviewActionBar>> = {}, role: OrganizationRole = 'owner') => {
    act(() =>
      useAuthStore.setState({
        session: { token: 't', user: { id: 'u', email: 'a@studio.test' }, organization: { id: 'o', name: 'S' }, role },
      }),
    );
    return act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(EmailStep, { lead, onApprove: async () => {}, onSendTest: async () => {}, onReject: async () => {}, ...props }),
        ),
      );
    });
  };
  const armApprove = () => act(() => new Promise((r) => setTimeout(r, APPROVE_ARM_DELAY_MS + 20)));
  const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  const notice = () => document.body.querySelector('[data-testid="sender-missing-notice"]');

  it('disables Approve and Send test and warns, with a link to Settings for the owner', async () => {
    await mount({ sender: { configured: false } });
    await armApprove();

    expect(button(en.email.approve)!.disabled).toBe(true);
    expect(button(en.email.sendTestToMe)!.disabled).toBe(true);
    expect(notice()!.textContent).toContain(en.email.sender.notConfigured);
    const link = notice()!.querySelector('a')!;
    expect(link.textContent).toBe(en.email.sender.openSettings);
    expect(link.getAttribute('href')).toBe('/settings');
  });

  it('tells an operator to ask the owner, with no link', async () => {
    await mount({ sender: { configured: false } }, 'operator');
    expect(notice()!.textContent).toContain(en.email.sender.askOwner);
    expect(notice()!.querySelector('a')).toBeNull();
  });

  it('blocks nothing with a configured sender, or while it is not loaded yet', async () => {
    for (const sender of [{ configured: true, name: 'Studio A', address: 'a@studio-a.test' }, undefined]) {
      await mount({ sender });
      await armApprove();
      expect(button(en.email.approve)!.disabled).toBe(false);
      expect(button(en.email.sendTestToMe)!.disabled).toBe(false);
      expect(notice()).toBeNull();
    }
  });

  it('an approve rejected with SENDER_NOT_CONFIGURED shows the localized text and asks for a fresh sender', async () => {
    const onApprove = vi.fn().mockRejectedValue(new ApiError('This studio has no sender yet.', 409, 'SENDER_NOT_CONFIGURED'));
    const onSenderMissing = vi.fn();
    await mount({ onApprove, onSenderMissing });
    await armApprove();

    await act(async () => button(en.email.approve)!.click());

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onSenderMissing).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(en.email.sender.notConfigured);
    expect(document.body.textContent).not.toContain(en.email.approvedSimulated);
  });

  it('a successful approve says the email is recorded as simulated, not delivered', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    await mount({ onApprove, sender: { configured: true, name: 'Studio A', address: 'a@studio-a.test' } });
    await armApprove();

    await act(async () => button(en.email.approve)!.click());

    expect(document.body.textContent).toContain(en.email.approvedSimulated);
    expect(en.email.approvedSimulated).toMatch(/simulated, not delivered/);
  });
});
