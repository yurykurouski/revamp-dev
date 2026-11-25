/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { OrganizationRole } from '@revamp/shared-types';
import '../../../i18n/index.js';
import { en } from '../../../i18n/locales/en.js';
import { senderApi } from '../../../api/client.js';
import { getTheme } from '../../../theme/theme.js';
import { useAuthStore } from '../../../store/useAuthStore.js';
import { SenderSection } from '../SenderSection.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sessionAs = (role: OrganizationRole) => ({
  token: 'tok',
  user: { id: 'u1', email: 'a@studio.test' },
  organization: { id: 'o1', name: 'Pixel Studio' },
  role,
});

describe('SenderSection (REV-221)', () => {
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
  const mount = async (role: OrganizationRole) => {
    act(() => useAuthStore.setState({ session: sessionAs(role) }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ThemeProvider, { theme: getTheme('dark', 'en') }, React.createElement(SenderSection)),
        ),
      );
    });
    await flush();
  };
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const inputs = () => [...document.querySelectorAll<HTMLInputElement>('input')];
  const saveButton = () => document.querySelector<HTMLButtonElement>('[data-testid="sender-save"]');

  it('shows the owner the form and the simulated note', async () => {
    vi.spyOn(senderApi, 'get').mockResolvedValue({ configured: false });
    await mount('owner');
    expect(inputs()).toHaveLength(2);
    expect(saveButton()).not.toBeNull();
    expect(document.body.textContent).toContain(en.settings.sender.none);
    expect(document.body.textContent).toContain(en.settings.sender.simulatedNote);
  });

  it('shows a viewer and an operator the sender read-only, with no form', async () => {
    vi.spyOn(senderApi, 'get').mockResolvedValue({ configured: true, name: 'Studio A', address: 'a@studio-a.test' });
    for (const role of ['viewer', 'operator'] as const) {
      await mount(role);
      expect(inputs()).toHaveLength(0);
      expect(saveButton()).toBeNull();
      expect(document.body.textContent).toContain('Studio A <a@studio-a.test>');
      expect(document.body.textContent).toContain(en.settings.sender.ownerOnly);
    }
  });

  it('an invalid address blocks Save: no request is made', async () => {
    vi.spyOn(senderApi, 'get').mockResolvedValue({ configured: false });
    const save = vi.spyOn(senderApi, 'save');
    await mount('owner');
    await type(inputs()[0]!, 'Studio A');
    await type(inputs()[1]!, 'not-an-email');
    await act(async () => saveButton()!.click());
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(en.settings.sender.invalid);
  });

  it('saves a valid sender, lowercased, and confirms it', async () => {
    vi.spyOn(senderApi, 'get').mockResolvedValue({ configured: false });
    const save = vi.spyOn(senderApi, 'save').mockResolvedValue({ configured: true, name: 'Studio A', address: 'a@studio-a.test' });
    await mount('owner');
    await type(inputs()[0]!, 'Studio A');
    await type(inputs()[1]!, 'A@Studio-A.test');
    await act(async () => saveButton()!.click());
    await flush();
    expect(save).toHaveBeenCalledWith({ name: 'Studio A', address: 'a@studio-a.test' });
    expect(document.body.textContent).toContain(en.settings.sender.saved);
  });

  it('shows the error when the save fails', async () => {
    vi.spyOn(senderApi, 'get').mockResolvedValue({ configured: false });
    vi.spyOn(senderApi, 'save').mockRejectedValue(new Error('Boom'));
    await mount('owner');
    await type(inputs()[0]!, 'Studio A');
    await type(inputs()[1]!, 'a@studio-a.test');
    await act(async () => saveButton()!.click());
    await flush();
    expect(document.body.textContent).toContain('Boom');
  });
});
