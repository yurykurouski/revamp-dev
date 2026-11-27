/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { getTheme } from '../../theme/theme.js';
import type { ILeadItem } from '../../api/client.js';
import { LeadsDataGrid } from '../LeadsDataGrid.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lead = (id: string, extra: Partial<ILeadItem>): ILeadItem => ({
  id,
  businessName: `Clinic ${id}`,
  domain: `${id}.example`,
  originalUrl: `https://${id}.example`,
  niche: 'dental',
  status: 'NEEDS_APPROVAL',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...extra,
});

describe('LeadsDataGrid contact right column (REV-228)', () => {
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
  });

  it('shows the right of each lead, and nothing for a lead without one', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(
            ThemeProvider,
            { theme: getTheme('dark', 'en') },
            React.createElement(LeadsDataGrid, {
              leads: [
                lead('a', { contactRight: { expiresAt: soon, active: true } }),
                lead('b', { contactRight: { expiresAt: past, active: false } }),
                lead('c', { contactRight: null }),
              ],
            }),
          ),
        ),
      );
    });
    expect(container.textContent).toContain(en.contactRight.column);
    const chips = [...container.querySelectorAll('[data-testid="contact-right-chip"]')];
    expect(chips.map((c) => c.textContent)).toEqual([expect.stringMatching(/^Until .*2026$/), en.contactRight.expired]);
    expect(chips[0]!.className).toContain('MuiChip-colorSuccess');
  });
});
