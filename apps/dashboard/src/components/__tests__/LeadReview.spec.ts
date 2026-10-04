/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { apiClient, IAuditDetail, ILeadItem } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { LeadReview, type ReviewDecision } from '../leadReview/LeadReview.js';
import { APPROVE_ARM_DELAY_MS } from '../leadReview/ReviewActionBar.js';
import { REVIEW_STEPS, ReviewStep, nextStep, previousStep } from '../leadReview/steps.js';
import { isMacPlatform } from '../../utils/shortcuts.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lead: ILeadItem = {
  id: 'lead-1',
  businessName: 'Harbor Dental',
  domain: 'harbor.example',
  originalUrl: 'https://harbor.example',
  niche: 'dental',
  city: 'Vilnius',
  status: 'NEEDS_APPROVAL',
  auditId: 'audit-1',
  totalScore: 42,
  // happy-dom loads iframe sources, so the preview points nowhere
  previewUrl: 'about:blank#mvp',
  createdAt: '2026-09-27T10:00:00.000Z',
};

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  lcpSeconds: 4.8,
  a11yViolationsCount: 17,
  mobileFriendlinessRating: 35,
  criticalFlaws: [{ title: 'No call to action above the fold', impact: 'Visitors leave', recommendation: 'Add a booking button' }],
  quickWins: ['Compress the hero image'],
  colorPalette: { primary: '#123456' },
  measurementErrors: [],
  designCritiqueFallback: false,
};

describe('review steps (REV-77)', () => {
  it('orders the steps audit, prototype, email', () => {
    expect(REVIEW_STEPS).toEqual(['audit', 'prototype', 'email']);
    expect(nextStep('audit')).toBe('prototype');
    expect(nextStep('prototype')).toBe('email');
    expect(nextStep('email')).toBeNull();
    expect(previousStep('email')).toBe('prototype');
    expect(previousStep('audit')).toBeNull();
  });
});

describe('LeadReview (REV-77)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  let onDecision: ReturnType<typeof vi.fn<(decision: ReviewDecision) => void>>;

  beforeEach(() => {
    vi.spyOn(apiClient, 'getAudit').mockResolvedValue(audit);
    vi.spyOn(apiClient, 'getMvp').mockResolvedValue(null);
    vi.spyOn(apiClient, 'approveOutreach').mockResolvedValue({ success: true, leadId: 'lead-1', status: 'SCHEDULED' });
    vi.spyOn(apiClient, 'rejectLead').mockResolvedValue({ success: true, leadId: 'lead-1', status: 'REJECTED' });
    onClose = vi.fn<() => void>();
    onDecision = vi.fn<(decision: ReviewDecision) => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

  const mount = async (reviewed: ILeadItem = lead, headerActions?: React.ReactNode) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            ThemeProvider,
            { theme: getTheme('dark', 'en') },
            React.createElement(LeadReview, { lead: reviewed, onClose, onDecision, headerActions }),
          ),
        ),
      );
    });
    await flush();
  };

  it('fetches the MVP again once a generation publishes one, so a first MVP shows its design tools (REV-132)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderLead = (reviewed: ILeadItem) =>
      act(async () => {
        root.render(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(ThemeProvider, { theme: getTheme('dark', 'en') }, React.createElement(LeadReview, { lead: reviewed, onClose, onDecision })),
          ),
        );
      });
    await renderLead({ ...lead, status: 'AUDITED', mvpGeneratedAt: undefined });
    await flush();
    expect(apiClient.getMvp).toHaveBeenCalledTimes(1);
    await renderLead({ ...lead, status: 'NEEDS_APPROVAL', mvpGeneratedAt: '2026-10-04T15:30:00.000Z' });
    await flush();
    expect(apiClient.getMvp).toHaveBeenCalledTimes(2);
    // The same version is not fetched again on every render
    await renderLead({ ...lead, status: 'NEEDS_APPROVAL', mvpGeneratedAt: '2026-10-04T15:30:00.000Z' });
    await flush();
    expect(apiClient.getMvp).toHaveBeenCalledTimes(2);
  });

  /** Waits until Approve arms after the email step opens */
  const armApprove = () => act(() => new Promise((r) => setTimeout(r, APPROVE_ARM_DELAY_MS + 20)));
  const button = (label: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  const tab = (step: ReviewStep) => document.querySelector<HTMLElement>(`#lead-review-tab-${step}`)!;
  const currentStep = () =>
    REVIEW_STEPS.find((s) => tab(s).getAttribute('aria-selected') === 'true');
  const panel = (step: ReviewStep) => document.querySelector<HTMLElement>(`#lead-review-panel-${step}`)!;
  const click = (el: HTMLElement | undefined) => act(async () => el!.click());
  const subject = () => panel('email').querySelector<HTMLInputElement>('input[required]')!;

  /** Types into a controlled input the way React sees a keystroke */
  const type = (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  const goToEmail = async () => {
    await click(button(en.review.next.audit));
    await click(button(en.review.next.prototype));
  };

  const rejectFromHere = async () => {
    await click(button(en.email.reject));
    await click(document.querySelector<HTMLElement>('[data-testid="reject-submit"]')!);
    await flush();
  };

  it('opens on the audit step with the audit shown', async () => {
    await mount();

    expect(currentStep()).toBe('audit');
    expect(panel('audit').hidden).toBe(false);
    expect(panel('prototype').hidden).toBe(true);
    expect(panel('email').hidden).toBe(true);
    expect(panel('audit').textContent).toContain('No call to action above the fold');
    expect(panel('audit').textContent).toContain('4.8s');
    expect(document.querySelector('h1')?.textContent).toBe('Harbor Dental');
  });

  it('shows the header actions it is given next to the score (REV-89)', async () => {
    await mount(lead, React.createElement('button', { 'data-testid': 'header-action' }, 'expand'));
    const action = document.querySelector('[data-testid="header-action"]')!;
    expect(action.parentElement!.textContent).toContain(en.inspector.originalScore.split('{{')[0]);
  });

  it('moves forward with Next and back with Back, one step on screen at a time', async () => {
    await mount();
    expect(button(en.review.back)).toBeUndefined();

    await click(button(en.review.next.audit));
    expect(currentStep()).toBe('prototype');
    expect(panel('prototype').hidden).toBe(false);
    expect(panel('audit').hidden).toBe(true);

    await click(button(en.review.next.prototype));
    expect(currentStep()).toBe('email');
    expect(button(en.review.next.prototype)).toBeUndefined();

    await click(button(en.review.back));
    expect(currentStep()).toBe('prototype');
    await click(button(en.review.back));
    expect(currentStep()).toBe('audit');
  });

  it('jumps to a step from its tab', async () => {
    await mount();
    await click(tab('email'));
    expect(currentStep()).toBe('email');
  });

  it('keeps the prototype in a sandboxed iframe', async () => {
    await mount();
    const iframe = panel('prototype').querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(iframe.getAttribute('src')).toBe('about:blank#mvp');
  });

  it('offers Approve & send only on the email step', async () => {
    await mount();
    expect(button(en.email.approve)).toBeUndefined();
    await click(button(en.review.next.audit));
    expect(button(en.email.approve)).toBeUndefined();
    await click(button(en.review.next.prototype));
    expect(button(en.email.approve)).toBeDefined();
    expect(document.body.textContent).toContain(en.inspector.hitlNotice);
    expect(button(en.email.approve)!.getAttribute('aria-keyshortcuts')).toBe(isMacPlatform() ? 'Meta+Enter' : 'Control+Enter');
  });

  it('does not send when a click meant for Next lands on Approve', async () => {
    await mount();
    await click(button(en.review.next.audit));
    const next = button(en.review.next.prototype)!;
    next.focus();
    await click(next);

    const approve = button(en.email.approve)!;
    expect(approve.disabled).toBe(true);
    expect(document.activeElement).not.toBe(approve);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    });
    expect(apiClient.approveOutreach).not.toHaveBeenCalled();
  });

  it('ignores the approve shortcut before the email step', async () => {
    await mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    });
    expect(apiClient.approveOutreach).not.toHaveBeenCalled();
  });

  it('approves once with the platform modifier + Enter, from the draft, after Approve arms (REV-47)', async () => {
    await mount();
    await goToEmail();
    await armApprove();
    const modifier = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
    const wrongModifier = isMacPlatform() ? { ctrlKey: true } : { metaKey: true };

    await act(async () => {
      subject().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...wrongModifier }));
    });
    expect(apiClient.approveOutreach).not.toHaveBeenCalled();

    await act(async () => {
      subject().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifier }));
    });
    await flush();
    expect(apiClient.approveOutreach).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('approved');
  });

  it('keeps unsaved email edits while moving between steps and approves them', async () => {
    await mount();
    await goToEmail();
    await type(subject(), 'A faster site for {{businessName}}');

    await click(tab('audit'));
    await click(tab('prototype'));
    await click(tab('email'));
    expect(subject().value).toBe('A faster site for {{businessName}}');

    await armApprove();
    await click(button(en.email.approve));
    await flush();

    expect(apiClient.approveOutreach).toHaveBeenCalledTimes(1);
    const [leadId, draft] = vi.mocked(apiClient.approveOutreach).mock.calls[0]!;
    expect(leadId).toBe('lead-1');
    expect(draft.subject).toBe('A faster site for Harbor Dental');
    expect(document.body.textContent).toContain(en.email.approved);
    // The review queue moves on to the next lead and confirms the approval (REV-79)
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('approved');
  });

  it.each<ReviewStep>(['audit', 'prototype', 'email'])('rejects the lead from the %s step and closes', async (step) => {
    await mount();
    await click(tab(step));

    await rejectFromHere();

    expect(apiClient.rejectLead).toHaveBeenCalledWith('lead-1', en.email.defaultRejectReason);
    expect(apiClient.approveOutreach).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('rejected');
  });

  it('shows a failed reject and stays open', async () => {
    vi.mocked(apiClient.rejectLead).mockRejectedValue(new Error('Lead can no longer be rejected'));
    await mount();

    await rejectFromHere();

    expect(document.body.textContent).toContain('Lead can no longer be rejected');
    expect(onClose).not.toHaveBeenCalled();
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('does not offer reject for a lead whose outreach is closed', async () => {
    await mount({ ...lead, status: 'SENT' });
    expect(button(en.email.reject)!.disabled).toBe(true);
  });
});
