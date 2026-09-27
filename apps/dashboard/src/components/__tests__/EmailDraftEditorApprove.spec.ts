/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { EmailDraftEditor } from '../EmailDraftEditor.js';
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

describe('EmailDraftEditor approve (REV-72)', () => {
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

  const mount = (onApprove: (draft: IEmailDraft) => Promise<void>, onSendTest = vi.fn().mockResolvedValue(undefined)) =>
    act(async () => {
      root.render(
        React.createElement(EmailDraftEditor, { lead, onApprove, onSendTest, onReject: async () => {} }),
      );
    });

  const button = (label: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

  it('approves the draft as the preview shows it, with no {{variables}} left', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    await mount(onApprove);

    await act(async () => button(en.email.approve)!.click());

    expect(onApprove).toHaveBeenCalledTimes(1);
    const draft: IEmailDraft = onApprove.mock.calls[0]![0];
    expect(draft.subject).toContain('Dr. Smile');
    expect(draft.preheader).toContain('Warsaw');
    expect(draft.body).toContain('👉 https://demo.example/dr-smile');
    expect(JSON.stringify(draft)).not.toMatch(/{{.*}}/);
  });

  it('approves the same draft that the test send sends', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onSendTest = vi.fn().mockResolvedValue(undefined);
    await mount(onApprove, onSendTest);

    await act(async () => button(en.email.sendTestToMe)!.click());
    await act(async () => document.body.querySelector<HTMLButtonElement>('[data-testid="send-test-submit"]')!.click());
    await act(async () => button(en.email.approve)!.click());

    expect(onApprove.mock.calls[0]![0]).toEqual(onSendTest.mock.calls[0]![1]);
  });
});
