/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { EmailDraftEditor } from '../EmailDraftEditor.js';
import { ReviewActionBar } from '../leadReview/ReviewActionBar.js';
import { useEmailDraft } from '../../hooks/useEmailDraft.js';
import type { ILeadItem, IEmailDraft } from '../../api/client.js';

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


/** The email step as the review wires it: the draft is shared by the editor and the action bar */
const EmailStep: React.FC<Omit<React.ComponentProps<typeof ReviewActionBar>, 'step' | 'onBack' | 'onNext' | 'getDraft'>> = (
  props,
) => {
  const draft = useEmailDraft(props.lead);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(EmailDraftEditor, { lead: props.lead, draft }),
    React.createElement(ReviewActionBar, { ...props, step: 'email', onBack: () => {}, onNext: () => {}, getDraft: draft.rendered }),
  );
};

describe('lead review test send (REV-60, REV-77)', () => {
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

  const mount = (onSendTest: (email: string, draft: IEmailDraft) => Promise<void>, isActionLoading = false) =>
    act(async () => {
      root.render(
        React.createElement(EmailStep, {
          lead,
          onApprove: async () => {},
          onSendTest,
          onReject: async () => {},
          isActionLoading,
        }),
      );
    });

  const button = (label: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  const submit = () => document.body.querySelector<HTMLButtonElement>('[data-testid="send-test-submit"]');
  const page = () => document.body.textContent ?? '';

  const openAndSend = async () => {
    await act(async () => button(en.email.sendTestToMe)!.click());
    await act(async () => submit()!.click());
  };

  it('sends the draft as the preview renders it, with its variables substituted', async () => {
    const onSendTest = vi.fn().mockResolvedValue(undefined);
    await mount(onSendTest);

    await openAndSend();

    expect(onSendTest).toHaveBeenCalledTimes(1);
    const [email, draft] = onSendTest.mock.calls[0]!;
    expect(email).toBe('operator@revamp.io');
    expect(draft.subject).toContain('Dr. Smile');
    expect(draft.preheader).toContain('Warsaw');
    expect(draft.body).toContain('https://demo.example/dr-smile');
    expect(draft.body).not.toContain('{{demoUrl}}');
    expect(page()).toContain(en.email.testSent.replace('{{email}}', 'operator@revamp.io'));
  });

  it('shows the error and no success when the send fails', async () => {
    const onSendTest = vi.fn().mockRejectedValue(new Error('No email provider is configured'));
    await mount(onSendTest);

    await openAndSend();

    expect(page()).toContain('No email provider is configured');
    expect(page()).not.toContain(en.email.testSent.replace('{{email}}', 'operator@revamp.io'));
  });

  it('closes the dialog and disables the opener while the send is in flight', async () => {
    let finish: () => void = () => {};
    await mount(() => new Promise<void>((resolve) => (finish = resolve)));
    await openAndSend();
    // happy-dom never ends MUI's exit transition, so check that it started
    const container = submit()!.closest<HTMLElement>('.MuiDialog-container')!;
    expect(container.style.opacity).toBe('0');

    await mount(vi.fn(), true);
    expect(button(en.email.sendTestToMe)!.disabled).toBe(true);
    await act(async () => finish());
  });

  it('disables the send button in the dialog while another action is in flight', async () => {
    await mount(vi.fn());
    await act(async () => button(en.email.sendTestToMe)!.click());
    expect(submit()!.disabled).toBe(false);

    await mount(vi.fn(), true);

    expect(submit()!.disabled).toBe(true);
  });
});
