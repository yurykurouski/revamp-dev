/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import i18n from '../../i18n/index.js';
import { getTheme } from '../../theme/theme.js';
import { EmailDraftEditor } from '../EmailDraftEditor.js';
import type { ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import type { EmailDraft } from '../../hooks/useEmailDraft.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// about:blank URLs keep happy-dom from fetching the image
const BANNER = 'about:blank#banner';
const GENERATED = '2026-10-01T10:00:00.000Z';
const EDITED = '2026-10-02T12:30:00.000Z';
// The version goes into the query, before the fragment
const versioned = (iso: string) => `about:blank?v=${Date.parse(iso)}#banner`;

const lead = {
  id: 'lead-1',
  businessName: 'Dr. Smile',
  domain: 'smile.pl',
  originalUrl: 'https://smile.pl',
  comparisonBannerUrl: BANNER,
  mvpGeneratedAt: GENERATED,
} as unknown as ILeadItem;

const draft: EmailDraft = {
  subject: 'Subject',
  preheader: '',
  body: 'Body',
  setSubject: () => undefined,
  setPreheader: () => undefined,
  setBody: () => undefined,
  insertTag: () => undefined,
  renderText: (text) => text,
  rendered: () => ({ subject: 'Subject', body: 'Body' }),
};

describe('EmailDraftEditor attachment preview (REV-127)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (props: { lead?: ILeadItem; mvp?: IMvpProjectDetail | null }) =>
    act(() =>
      root.render(
        React.createElement(
          ThemeProvider,
          { theme: getTheme('light') },
          React.createElement(EmailDraftEditor, { lead: props.lead ?? lead, draft, mvp: props.mvp }),
        ),
      ),
    );

  const banner = () => container.querySelector<HTMLImageElement>('img[alt="Before / after comparison collage"]');

  it('shows the whole 1200x630 banner instead of cropping it', () => {
    render({});
    const img = banner()!;
    expect(img).not.toBeNull();
    const style = getComputedStyle(img);
    expect(style.objectFit).toBe('contain');
    expect(style.maxHeight).not.toBe('180px');
    expect(style.aspectRatio.replace(/\s/g, '')).toBe('1200/630');
  });

  it('loads the banner of the current generation', () => {
    render({});
    expect(banner()!.getAttribute('src')).toBe(versioned(GENERATED));
  });

  it('loads the banner of the last change after a re-publish', () => {
    render({ mvp: { generatedAt: GENERATED, editedAt: EDITED } as IMvpProjectDetail });
    expect(banner()!.getAttribute('src')).toBe(versioned(EDITED));
  });

  it('opens the banner full size from a labelled link', () => {
    render({});
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Open the comparison banner full size"]')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe(versioned(GENERATED));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.contains(banner())).toBe(true);
  });

  it('shows no attachment without a banner', () => {
    render({ lead: { ...lead, comparisonBannerUrl: undefined } });
    expect(banner()).toBeNull();
    expect(container.textContent).not.toContain('Attachment');
  });
});
