/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { formatDate } from '../../i18n/languages.js';
import { ApiError, apiClient } from '../../api/client.js';
import { useLeadFilterStore } from '../../store/useLeadFilterStore.js';
import { AddLeadModal } from '../AddLeadModal.js';
import { DATE_FORMAT } from '../../utils/contactRight.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Add lead refusals (REV-228)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => useLeadFilterStore.setState({ isAddModalOpen: true }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AddLeadModal)));
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const submit = async (error: unknown) => {
    vi.spyOn(apiClient, 'createLead').mockRejectedValue(error);
    const input = document.body.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'https://held-site.example');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      document.body.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  };
  const alert = () => document.body.querySelector('[role="alert"]')?.textContent;

  it.each([
    ['CONTACT_RIGHT_HELD', { expiresAt: '2026-12-31T00:00:00.000Z' }, (d: string) => `Another studio holds this business until ${d}.`],
    ['BUSINESS_IN_COOLDOWN', { availableAt: '2026-12-31T00:00:00.000Z' }, (d: string) => `This business can be added again from ${d}.`],
  ] as const)('%s shows its message with the date', async (code, details, text) => {
    await submit(new ApiError('raw server text', 409, code, details));
    expect(alert()).toBe(text(formatDate('2026-12-31T00:00:00.000Z', 'en', DATE_FORMAT)));
  });

  it('BUSINESS_OPTED_OUT shows its message', async () => {
    await submit(new ApiError('raw server text', 409, 'BUSINESS_OPTED_OUT'));
    expect(alert()).toBe(en.refusals.optedOut);
  });

  it('any other error keeps its own text', async () => {
    await submit(new ApiError('Lead already exists', 409, 'LEAD_ALREADY_EXISTS'));
    expect(alert()).toBe('Lead already exists');
  });
});
