/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { OrganizationRole } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import type { ILeadItem } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useAuthStore } from '../../store/useAuthStore.js';
import { AuditFailedActions } from '../AuditFailedActions.js';
import { GenerateMvpButton } from '../GenerateMvpButton.js';
import { RegenerateMvpButton } from '../RegenerateMvpButton.js';
import { TopBar } from '../TopBar.js';
import { APPROVE_ARM_DELAY_MS, ReviewActionBar } from '../leadReview/ReviewActionBar.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sessionAs = (role: OrganizationRole) => ({
  token: 'tok',
  user: { id: 'u1', email: 'a@studio.test' },
  organization: { id: 'o1', name: 'Pixel Studio' },
  role,
});

const lead: ILeadItem = {
  id: 'lead-1',
  businessName: 'Dr. Smile',
  domain: 'drsmile.pl',
  originalUrl: 'https://drsmile.pl',
  niche: 'dental',
  city: 'Warsaw',
  status: 'NEEDS_APPROVAL',
  auditId: 'audit-1',
  previewUrl: 'about:blank#mvp',
  createdAt: new Date().toISOString(),
};

describe('write actions by role (REV-207)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const mount = async (element: React.ReactElement) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            ThemeProvider,
            { theme: getTheme('light') },
            React.createElement(MemoryRouter, null, element),
          ),
        ),
      );
    });
  };
  const as = (role: OrganizationRole) => act(() => useAuthStore.setState({ session: sessionAs(role) }));
  const buttonByText = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

  describe('top bar', () => {
    const bar = () => React.createElement(TopBar, { discovery: 'idle', discoveryNewCount: 0 });

    it.each<OrganizationRole>(['owner', 'operator'])('shows Add lead and Find businesses to an %s', async (role) => {
      as(role);
      await mount(bar());
      expect(buttonByText(en.topBar.addLead)).toBeDefined();
      expect(container.querySelector(`[aria-label="${en.header.findBusinesses}"]`)).not.toBeNull();
    });

    it('hides Add lead and Find businesses from a viewer, who can still search', async () => {
      as('viewer');
      await mount(bar());
      expect(buttonByText(en.topBar.addLead)).toBeUndefined();
      expect(container.querySelector(`[aria-label="${en.header.findBusinesses}"]`)).toBeNull();
      expect(container.querySelector('input')).not.toBeNull();
    });
  });

  describe('MVP and audit buttons', () => {
    it.each<[string, () => React.ReactElement, string]>([
      ['Generate MVP', () => React.createElement(GenerateMvpButton, { lead }), 'button'],
      ['Regenerate MVP', () => React.createElement(RegenerateMvpButton, { lead: { ...lead, status: 'NEEDS_APPROVAL' } as never }), 'button'],
      ['Retry audit', () => React.createElement(AuditFailedActions, { lead: { ...lead, status: 'AUDIT_FAILED' } as never }), 'button'],
    ])('%s is offered to an operator and not to a viewer', async (_name, element, selector) => {
      as('operator');
      await mount(element());
      expect(container.querySelector(selector)).not.toBeNull();
      as('viewer');
      await mount(element());
      expect(container.querySelector(selector)).toBeNull();
    });
  });

  describe('review action bar', () => {
    const bar = (overrides: Partial<React.ComponentProps<typeof ReviewActionBar>> = {}) =>
      React.createElement(ReviewActionBar, {
        lead,
        step: 'email',
        onBack: () => {},
        onNext: () => {},
        getDraft: () => ({ subject: 'S', body: 'B' }),
        onApprove: vi.fn(async () => {}),
        onSendTest: vi.fn(async () => {}),
        onReject: vi.fn(async () => {}),
        ...overrides,
      });
    const armed = () => act(async () => new Promise((r) => setTimeout(r, APPROVE_ARM_DELAY_MS + 60)));
    const notice = () => container.querySelector('[data-testid="read-only-notice"]');

    it('lets an owner and an operator approve, reject and send a test, with no read-only notice', async () => {
      for (const role of ['owner', 'operator'] as const) {
        as(role);
        await mount(bar());
        await armed();
        expect(buttonByText(en.email.approve)!.disabled, role).toBe(false);
        expect(buttonByText(en.email.reject)!.disabled, role).toBe(false);
        expect(buttonByText(en.email.sendTestToMe)!.disabled, role).toBe(false);
        expect(notice(), role).toBeNull();
      }
    });

    it('disables approve, reject and the test send for a viewer and says why; Back stays available', async () => {
      as('viewer');
      await mount(bar());
      await armed();
      expect(buttonByText(en.email.approve)!.disabled).toBe(true);
      expect(buttonByText(en.email.reject)!.disabled).toBe(true);
      expect(buttonByText(en.email.sendTestToMe)!.disabled).toBe(true);
      expect(buttonByText(en.review.back)!.disabled).toBe(false);
      expect(notice()?.textContent).toBe(en.permissions.readOnly);
    });

    it('approves an operator on the keyboard shortcut (the control for the viewer test below)', async () => {
      const onApprove = vi.fn(async () => {});
      as('operator');
      await mount(bar({ onApprove }));
      await armed();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      });
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it('does not approve a viewer on the keyboard shortcut either', async () => {
      const onApprove = vi.fn(async () => {});
      as('viewer');
      await mount(bar({ onApprove }));
      await armed();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      });
      expect(onApprove).not.toHaveBeenCalled();
    });

    it('shows the read-only notice on every step for a viewer, not only on the email step', async () => {
      as('viewer');
      await mount(bar({ step: 'audit' }));
      expect(notice()).not.toBeNull();
    });
  });
});
