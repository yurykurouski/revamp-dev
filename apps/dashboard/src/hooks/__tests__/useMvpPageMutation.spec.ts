/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../api/client.js';
import { MvpPageActionVariables, useMvpPageMutation } from '../useLeads.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mvp = { id: 'mvp-1', leadId: 'lead-1', fullPreviewUrl: 'https://x', editedAt: '2026-10-10T12:00:00.000Z' };

describe('useMvpPageMutation (REV-140)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let mutation: ReturnType<typeof useMvpPageMutation>;

  const Harness: React.FC = () => {
    mutation = useMvpPageMutation();
    return null;
  };

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Harness))));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const run = (variables: MvpPageActionVariables) => act(() => mutation.mutateAsync(variables).catch((error: unknown) => error));

  it('sends each action to its route', async () => {
    const edit = vi.spyOn(apiClient, 'editMvp').mockResolvedValue({ applied: true, version: 2, mvp });
    const tokens = vi.spyOn(apiClient, 'updateMvpTokens').mockResolvedValue({ applied: true, mvp });
    const restore = vi.spyOn(apiClient, 'restoreMvpVersion').mockResolvedValue({ applied: true, version: 3, mvp });

    await run({ mvpId: 'mvp-1', leadId: 'lead-1', action: 'change', instruction: 'Shorter' });
    await run({ mvpId: 'mvp-1', leadId: 'lead-1', action: 'controls', controls: { fonts: null } });
    await run({ mvpId: 'mvp-1', leadId: 'lead-1', action: 'restore', version: 1 });

    expect(edit).toHaveBeenCalledWith('mvp-1', 'Shorter');
    expect(tokens).toHaveBeenCalledWith('mvp-1', { fonts: null });
    expect(restore).toHaveBeenCalledWith('mvp-1', 1);
  });

  it('stores the MVP the API returned', async () => {
    vi.spyOn(apiClient, 'editMvp').mockResolvedValue({ applied: true, version: 2, mvp });
    await run({ mvpId: 'mvp-1', leadId: 'lead-1', action: 'change', instruction: 'Shorter' });
    expect(queryClient.getQueryData(['mvp', 'lead-1'])).toEqual(mvp);
  });

  it('keeps a refusal as a result, not an error', async () => {
    vi.spyOn(apiClient, 'editMvp').mockResolvedValue({ applied: false, reason: 'invalid_page', message: 'rejected twice', mvp });
    const result = await act(() => mutation.mutateAsync({ mvpId: 'mvp-1', leadId: 'lead-1', action: 'change', instruction: 'x x' }));
    expect(result).toMatchObject({ applied: false, reason: 'invalid_page' });
  });

  it('refetches the MVP after a 504, since the change may still publish', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    vi.spyOn(apiClient, 'restoreMvpVersion').mockRejectedValue(new ApiError('may still be published', 504, 'MVP_EDIT_TIMEOUT'));
    const error = await run({ mvpId: 'mvp-1', leadId: 'lead-1', action: 'restore', version: 1 });
    expect((error as Error).message).toBe('may still be published');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mvp', 'lead-1'] });
  });

  it('does not refetch after another error', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    vi.spyOn(apiClient, 'restoreMvpVersion').mockRejectedValue(new ApiError('no longer fits', 409, 'MVP_VERSION_UNUSABLE'));
    await run({ mvpId: 'mvp-1', leadId: 'lead-1', action: 'restore', version: 1 });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
