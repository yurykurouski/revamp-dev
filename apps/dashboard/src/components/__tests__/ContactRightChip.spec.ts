/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { formatDate } from '../../i18n/languages.js';
import { ContactRightChip } from '../ContactRightChip.js';
import { DATE_FORMAT } from '../../utils/contactRight.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const NOW = new Date('2026-11-27T12:00:00.000Z');

describe('ContactRightChip (REV-228)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  const render = (right: React.ComponentProps<typeof ContactRightChip>['right'], variant?: 'full' | 'compact') => act(() => root.render(React.createElement(ContactRightChip, { right, variant })));
  const chip = () => container.querySelector('[data-testid="contact-right-chip"]');
  const expires = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

  it('shows the expiry date in success color for an active right', () => {
    const expiresAt = expires(10 * DAY);
    render({ expiresAt, active: true });
    expect(chip()!.textContent).toBe(en.contactRight.until.replace('{{date}}', formatDate(expiresAt, 'en', DATE_FORMAT)));
    expect(chip()!.className).toContain('MuiChip-colorSuccess');
  });

  it('warns when the right is about to end', () => {
    render({ expiresAt: expires(DAY), active: true });
    expect(chip()!.className).toContain('MuiChip-colorWarning');
  });

  it('says the right expired, and that the business opted out', () => {
    render({ expiresAt: expires(-DAY), active: false });
    expect(chip()!.textContent).toBe(en.contactRight.expired);
    expect(chip()!.className).toContain('MuiChip-colorDefault');
    render({ expiresAt: expires(20 * DAY), active: false, endedAt: NOW.toISOString(), endReason: 'opted_out' });
    expect(chip()!.textContent).toBe(en.contactRight.optedOut);
  });

  it('renders nothing without a right', () => {
    render(null);
    expect(chip()).toBeNull();
    render(undefined);
    expect(chip()).toBeNull();
  });

  it('turns to expired by itself when the right ends during the review', () => {
    render({ expiresAt: expires(2 * 60_000), active: true });
    expect(chip()!.textContent).toContain('Contact right until');
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(chip()!.textContent).toBe(en.contactRight.expired);
  });

  describe('compact variant (REV-229)', () => {
    it('shows the short label with the full date and keeps the colors', () => {
      const expiresAt = expires(10 * DAY);
      const date = formatDate(expiresAt, 'en', DATE_FORMAT);
      render({ expiresAt, active: true }, 'compact');
      expect(chip()!.textContent).toBe(en.contactRight.untilShort.replace('{{date}}', date));
      expect(chip()!.textContent).toContain('2026');
      expect(chip()!.className).toContain('MuiChip-colorSuccess');
      render({ expiresAt: expires(DAY), active: true }, 'compact');
      expect(chip()!.className).toContain('MuiChip-colorWarning');
    });

    it('carries the full text as its accessible name', () => {
      const expiresAt = expires(10 * DAY);
      render({ expiresAt, active: true }, 'compact');
      expect(chip()!.getAttribute('aria-label')).toBe(en.contactRight.until.replace('{{date}}', formatDate(expiresAt, 'en', DATE_FORMAT)));
    });

    it('keeps the ended and opted-out labels', () => {
      render({ expiresAt: expires(-DAY), active: false }, 'compact');
      expect(chip()!.textContent).toBe(en.contactRight.expired);
      render({ expiresAt: expires(20 * DAY), active: false, endedAt: NOW.toISOString(), endReason: 'opted_out' }, 'compact');
      expect(chip()!.textContent).toBe(en.contactRight.optedOut);
      expect(chip()!.getAttribute('aria-label')).toBe(en.contactRight.optedOut);
    });

    it('leaves the default variant on the full label', () => {
      render({ expiresAt: expires(10 * DAY), active: true });
      expect(chip()!.textContent).toContain('Contact right until');
    });
  });
});
