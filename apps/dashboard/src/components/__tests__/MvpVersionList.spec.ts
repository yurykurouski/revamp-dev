/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import { MVP_PAGE_VERSION_KINDS } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { getTheme } from '../../theme/theme.js';
import { MvpVersionList } from '../leadReview/MvpVersionList.js';
import { versionsNewestFirst } from '../../utils/mvpPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const versions = versionsNewestFirst([
  { n: 1, kind: 'generate', storagePath: 'v/s/versions/1.html', createdAt: '2026-10-10T10:00:00.000Z' },
  { n: 2, kind: 'change', instruction: 'Make the hero heading shorter', storagePath: 'v/s/versions/2.html', createdAt: '2026-10-10T11:00:00.000Z' },
  { n: 3, kind: 'restore', from: 1, storagePath: 'v/s/versions/3.html', createdAt: '2026-10-10T12:00:00.000Z' },
]);

describe('MvpVersionList (REV-140)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onRestore = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onRestore.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (props: Partial<React.ComponentProps<typeof MvpVersionList>> = {}) =>
    act(() =>
      root.render(
        React.createElement(
          ThemeProvider,
          { theme: getTheme('light') },
          React.createElement(MvpVersionList, { versions, disabled: false, onRestore, ...props }),
        ),
      ),
    );
  const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="mvp-version"]'));
  const restore = (n: number) => container.querySelector<HTMLButtonElement>(`[data-testid="mvp-version-restore-${n}"]`);

  it('has a label for every kind', () => {
    for (const kind of MVP_PAGE_VERSION_KINDS) expect(typeof en.mvpPage.versions.kinds[kind]).toBe('string');
  });

  it('lists newest first with kind, instruction and date; the current one has no Restore', () => {
    render();
    expect(rows().map((row) => row.getAttribute('data-version'))).toEqual(['3', '2', '1']);
    expect(rows()[1]!.textContent).toContain('Version 2');
    expect(rows()[1]!.textContent).toContain('Changed');
    expect(rows()[1]!.textContent).toContain('Make the hero heading shorter');
    expect(rows()[1]!.textContent).toMatch(/2026/);
    expect(rows()[0]!.textContent).toContain('Published');
    expect(restore(3)).toBeNull();
  });

  it('shows a restore as restored from its source', () => {
    render();
    expect(rows()[0]!.textContent).toContain('Restored from version 1');
  });

  it('restores an older version', () => {
    render();
    act(() => restore(1)!.click());
    expect(onRestore).toHaveBeenCalledWith(1);
  });

  it('disables Restore while an action runs', () => {
    render({ disabled: true, pending: 2 });
    expect(restore(1)!.disabled).toBe(true);
    expect(restore(2)!.disabled).toBe(true);
  });

  it('says when there are no versions', () => {
    render({ versions: [] });
    expect(container.textContent).toContain('No versions yet');
  });
});
