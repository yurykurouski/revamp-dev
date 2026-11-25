/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import '../../../i18n/index.js';
import { en } from '../../../i18n/locales/en.js';
import { ApiError, apiClient } from '../../../api/client.js';
import { getTheme } from '../../../theme/theme.js';
import { OUTBOX_FRAME_HEAD } from '../../../utils/outboxFrame.js';
import { OutboxDialog } from '../OutboxDialog.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view = {
  from: '"Studio A" <a@studio-a.test>',
  to: 'owner@biz.test',
  subject: 'A refreshed website',
  headers: {},
  html: '<html><head></head><body><p>Hello</p><img src="http://localhost:4000/api/v1/track/open/tok.gif"></body></html>',
  text: 'Hello',
  deliveryMode: 'SIMULATED' as const,
  sentAt: '2026-11-25T10:00:00.000Z',
};

describe('OutboxDialog (REV-221)', () => {
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
    vi.restoreAllMocks();
  });

  const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
  const mount = async (open = true) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ThemeProvider, { theme: getTheme('dark', 'en') }, React.createElement(OutboxDialog, { leadId: 'lead-1', open, onClose: () => {} })),
        ),
      );
    });
    await flush();
    await flush();
  };

  it('frame is sandboxed with no permissions and the srcdoc carries the CSP meta and base target', async () => {
    vi.spyOn(apiClient, 'getOutbox').mockResolvedValue(view);
    await mount();

    const frame = document.body.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('');
    const srcdoc = frame.getAttribute('srcdoc')!;
    expect(srcdoc).toContain(OUTBOX_FRAME_HEAD);
    expect(srcdoc).toContain(`default-src 'none'`);
    expect(srcdoc).toContain('<base target="_blank">');
    // The frame has no src, so nothing is fetched by the dialog itself
    expect(frame.getAttribute('src')).toBeNull();
  });

  it('shows the "Simulated – not delivered" chip, From, To, Subject and the date', async () => {
    vi.spyOn(apiClient, 'getOutbox').mockResolvedValue(view);
    await mount();

    expect(document.body.textContent).toContain('Simulated – not delivered');
    expect(document.body.textContent).toContain(en.email.outbox.simulated);
    expect(document.body.textContent).toContain('"Studio A" <a@studio-a.test>');
    expect(document.body.textContent).toContain('owner@biz.test');
    expect(document.body.textContent).toContain('A refreshed website');
    expect(document.body.textContent).toContain('2026');
  });

  it('answers OUTBOX_NOT_FOUND with the missing text and no frame', async () => {
    vi.spyOn(apiClient, 'getOutbox').mockRejectedValue(new ApiError('none', 404, 'OUTBOX_NOT_FOUND'));
    await mount();

    expect(document.body.querySelector('[data-testid="outbox-missing"]')!.textContent).toContain(en.email.outbox.missing);
    expect(document.body.querySelector('iframe')).toBeNull();
    // Still labelled
    expect(document.body.textContent).toContain(en.email.outbox.simulated);
  });

  it('shows another failure as an error', async () => {
    vi.spyOn(apiClient, 'getOutbox').mockRejectedValue(new Error('Server down'));
    await mount();
    expect(document.body.textContent).toContain('Server down');
  });

  it('does not fetch while closed', async () => {
    const get = vi.spyOn(apiClient, 'getOutbox').mockResolvedValue(view);
    await mount(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('only ever reads: no approve, test or track call is made', async () => {
    vi.spyOn(apiClient, 'getOutbox').mockResolvedValue(view);
    const approve = vi.spyOn(apiClient, 'approveOutreach');
    const test = vi.spyOn(apiClient, 'sendTestEmail');
    await mount();
    expect(approve).not.toHaveBeenCalled();
    expect(test).not.toHaveBeenCalled();
  });
});
