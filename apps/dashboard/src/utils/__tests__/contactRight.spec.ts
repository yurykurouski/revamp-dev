import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { formatDate } from '../../i18n/languages.js';
import { ApiError } from '../../api/client.js';
import { CONTACT_RIGHT_WARNING_DAYS, DATE_FORMAT, contactRightState, refusalMessage } from '../contactRight.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const DAY = 86_400_000;
const right = (expiresInMs: number, extra: Record<string, unknown> = {}) => ({ expiresAt: new Date(NOW.getTime() + expiresInMs).toISOString(), active: true, ...extra });

describe('contactRightState (REV-228)', () => {
  it('is none without a right', () => {
    expect(contactRightState(null, NOW)).toBe('none');
    expect(contactRightState(undefined, NOW)).toBe('none');
  });

  it('is active far from the end and expiring inside the warning window, exactly at the boundary being active', () => {
    expect(CONTACT_RIGHT_WARNING_DAYS).toBe(3);
    expect(contactRightState(right(10 * DAY), NOW)).toBe('active');
    expect(contactRightState(right(3 * DAY), NOW)).toBe('active');
    expect(contactRightState(right(3 * DAY - 1), NOW)).toBe('expiring');
    expect(contactRightState(right(1), NOW)).toBe('expiring');
  });

  it('is ended when the API says inactive, or when the clock passed the expiry', () => {
    expect(contactRightState(right(10 * DAY, { active: false, endedAt: NOW.toISOString(), endReason: 'opted_out' }), NOW)).toBe('ended');
    expect(contactRightState(right(0), NOW)).toBe('ended');
    expect(contactRightState(right(-DAY), NOW)).toBe('ended');
  });
});

describe('refusalMessage (REV-228)', () => {
  const t = i18n.getFixedT('en') as TFunction;
  const date = '2026-12-31T00:00:00.000Z';
  const fmt = (lang: 'en' | 'pl') => formatDate(date, lang, DATE_FORMAT);

  it('explains each rights refusal with its date', () => {
    expect(refusalMessage(t, new ApiError('x', 409, 'CONTACT_RIGHT_HELD', { expiresAt: date }), 'en')).toBe(`Another studio holds this business until ${fmt('en')}.`);
    expect(refusalMessage(t, new ApiError('x', 409, 'BUSINESS_IN_COOLDOWN', { availableAt: date }), 'en')).toBe(`This business can be added again from ${fmt('en')}.`);
    expect(refusalMessage(t, new ApiError('x', 409, 'BUSINESS_OPTED_OUT'), 'en')).toBe(en.refusals.optedOut);
    expect(refusalMessage(t, new ApiError('x', 409, 'CONTACT_RIGHT_REQUIRED', { expiredAt: date }), 'en')).toBe(`Your studio's right to contact this business ended on ${fmt('en')}.`);
  });

  it('has a text without a date, also for an unparseable one', () => {
    expect(refusalMessage(t, new ApiError('x', 409, 'CONTACT_RIGHT_REQUIRED'), 'en')).toBe(en.refusals.rightRequiredNoDate);
    expect(refusalMessage(t, new ApiError('x', 409, 'CONTACT_RIGHT_REQUIRED', { expiredAt: 'soon' }), 'en')).toBe(en.refusals.rightRequiredNoDate);
    expect(refusalMessage(t, new ApiError('x', 409, 'CONTACT_RIGHT_HELD'), 'en')).toBe(en.refusals.heldNoDate);
    expect(refusalMessage(t, new ApiError('x', 409, 'BUSINESS_IN_COOLDOWN', null), 'en')).toBe(en.refusals.cooldownNoDate);
  });

  it('returns undefined for other codes and other errors', () => {
    expect(refusalMessage(t, new ApiError('x', 409, 'LEAD_ALREADY_EXISTS'), 'en')).toBeUndefined();
    expect(refusalMessage(t, new ApiError('x', 500), 'en')).toBeUndefined();
    expect(refusalMessage(t, new Error('CONTACT_RIGHT_HELD'), 'en')).toBeUndefined();
    expect(refusalMessage(t, 'CONTACT_RIGHT_HELD', 'en')).toBeUndefined();
  });

  it('formats the date in the UI language', async () => {
    const pl = i18n.getFixedT('pl') as TFunction;
    const message = refusalMessage(pl, new ApiError('x', 409, 'CONTACT_RIGHT_HELD', { expiresAt: date }), 'pl')!;
    expect(message).toContain(fmt('pl'));
    expect(message).toContain('inne studio');
    expect(fmt('pl')).not.toBe(fmt('en'));
  });
});
