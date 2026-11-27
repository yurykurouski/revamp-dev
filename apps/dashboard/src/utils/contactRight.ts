import type { TFunction } from 'i18next';
import type { IContactRightView } from '@revamp/shared-types';
import { ApiError } from '../api/client.js';
import { formatDate, type AppLanguage } from '../i18n/languages.js';

/** A right that ends within this many days is shown as a warning (REV-228) */
export const CONTACT_RIGHT_WARNING_DAYS = 3;

export type ContactRightState = 'none' | 'active' | 'expiring' | 'ended';

/** The state of the studio's right on a lead at `now`; the one place that decides what the dashboard shows and allows */
export function contactRightState(view: IContactRightView | null | undefined, now: Date): ContactRightState {
  if (!view) return 'none';
  // The API says "active" at request time; the clock moves on while the review is open
  const expires = new Date(view.expiresAt).getTime();
  if (!view.active || expires <= now.getTime()) return 'ended';
  return expires - now.getTime() < CONTACT_RIGHT_WARNING_DAYS * 86_400_000 ? 'expiring' : 'active';
}

export const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** A date from an API `details` object, formatted in the UI language; undefined when absent or not a date */
function detailDate(details: unknown, key: string, language: AppLanguage): string | undefined {
  const value = details && typeof details === 'object' ? (details as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return undefined;
  return formatDate(value, language, DATE_FORMAT);
}

/** The localized explanation of a contact-right refusal from the API (REV-228), or undefined for any other error */
export function refusalMessage(t: TFunction, error: unknown, language: AppLanguage): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  switch (error.code) {
    case 'CONTACT_RIGHT_HELD': {
      const date = detailDate(error.details, 'expiresAt', language);
      return date ? t('refusals.held', { date }) : t('refusals.heldNoDate');
    }
    case 'BUSINESS_IN_COOLDOWN': {
      const date = detailDate(error.details, 'availableAt', language);
      return date ? t('refusals.cooldown', { date }) : t('refusals.cooldownNoDate');
    }
    case 'BUSINESS_OPTED_OUT':
      return t('refusals.optedOut');
    case 'CONTACT_RIGHT_REQUIRED': {
      const date = detailDate(error.details, 'expiredAt', language);
      return date ? t('refusals.rightRequired', { date }) : t('refusals.rightRequiredNoDate');
    }
    default:
      return undefined;
  }
}
