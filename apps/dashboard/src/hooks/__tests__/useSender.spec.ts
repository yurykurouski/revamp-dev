/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { senderApi } from '../../api/client.js';
import { SENDER_QUERY_KEY, useSaveSenderMutation, useSenderQuery } from '../useSender.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSender (REV-221)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let save: ReturnType<typeof useSaveSenderMutation>;
  let query: ReturnType<typeof useSenderQuery>;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const Probe: React.FC = () => {
    query = useSenderQuery();
    save = useSaveSenderMutation();
    return null;
  };
  const mount = () =>
    act(async () => {
      root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Probe)));
    });
  const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

  it('reads the studio sender', async () => {
    vi.spyOn(senderApi, 'get').mockResolvedValue({ configured: false });
    await mount();
    await flush();
    expect(query.data).toEqual({ configured: false });
  });

  it('the save mutation writes the answer into the cache, with no second request', async () => {
    const get = vi.spyOn(senderApi, 'get').mockResolvedValue({ configured: false });
    const view = { configured: true, name: 'Studio A', address: 'a@studio-a.test' };
    const put = vi.spyOn(senderApi, 'save').mockResolvedValue(view);
    await mount();
    await flush();

    await act(async () => {
      await save.mutateAsync({ name: 'Studio A', address: 'a@studio-a.test' });
    });

    expect(put).toHaveBeenCalledWith({ name: 'Studio A', address: 'a@studio-a.test' });
    expect(queryClient.getQueryData(SENDER_QUERY_KEY)).toEqual(view);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
