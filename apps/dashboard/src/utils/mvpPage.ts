import { MVP_FONT_CHOICES, MVP_MIN_CONTRAST, MVP_PAGE_FAILURES } from '@revamp/shared-types';
import type { IMvpPageJobResult, IMvpPageVersion, MvpFontChoice, Serialized } from '@revamp/shared-types';
import { contrastRatio } from '@revamp/validation';
import type { IAuditDetail, IMvpProjectDetail } from '../api/client.js';

// What the Design tools decide for a model-designed page (REV-140): the colors to start from, their contrast, the
// saved font pairing, the versions and what each answer means. Every word is an i18n key, filled by code.

export type MvpColorRole = 'primary' | 'accent' | 'bg' | 'surface' | 'text';
export const MVP_COLOR_ROLES: readonly MvpColorRole[] = ['primary', 'accent', 'bg', 'surface', 'text'];
export type MvpColors = Record<MvpColorRole, string>;

export interface MvpText {
  key: string;
  values?: Record<string, string | number>;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A page the model designed declares its theme; an MVP of the previous generator has none */
export const isModelDesigned = (mvp: Pick<IMvpProjectDetail, 'theme'> | null | undefined): boolean => Boolean(mvp?.theme);

const hex2 = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

/**
 * A color as #rrggbb when it can be read: #rgb is expanded and rgb()/rgba() converted, since the model may declare
 * its theme either way. Anything else is kept as it is, for the operator to retype.
 */
export function toHexColor(value: string): string {
  const color = value.trim().toLowerCase();
  const short = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}`;
  const rgb = color.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/);
  if (rgb) return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
  return color;
}

/** The operator's saved colors over the page's theme, as #rrggbb where they can be read; null without a theme */
export function seedColors(mvp: Pick<IMvpProjectDetail, 'theme' | 'controls'> | null | undefined): MvpColors | null {
  const theme = mvp?.theme;
  if (!theme) return null;
  const pick = (role: MvpColorRole) => toHexColor(mvp.controls?.[role] ?? theme[role]);
  return Object.fromEntries(MVP_COLOR_ROLES.map((role) => [role, pick(role)])) as MvpColors;
}

/** The audit's brand colors (primary, secondary, accent), valid #rrggbb only, lowercase, deduplicated, in that order */
export function brandColors(audit: Pick<IAuditDetail, 'colorPalette'> | null | undefined): string[] {
  const palette = audit?.colorPalette;
  const colors = [palette?.primary, palette?.secondary, palette?.accent]
    .filter((color): color is string => typeof color === 'string' && HEX.test(color))
    .map((color) => color.toLowerCase());
  return [...new Set(colors)];
}

const round = (ratio: number) => Math.round(ratio * 100) / 100;

/** Both ratios, rounded for display; `ok` only when every color is #rrggbb and both reach `MVP_MIN_CONTRAST` */
export function colorContrast(colors: MvpColors): { onBg?: number; onSurface?: number; valid: boolean; ok: boolean } {
  if (!MVP_COLOR_ROLES.every((role) => HEX.test(colors[role]))) return { valid: false, ok: false };
  const onBg = contrastRatio(colors.text, colors.bg);
  const onSurface = contrastRatio(colors.text, colors.surface);
  return { onBg: round(onBg), onSurface: round(onSurface), valid: true, ok: onBg >= MVP_MIN_CONTRAST && onSurface >= MVP_MIN_CONTRAST };
}

/** The pairing the operator saved, or null for the page's own fonts */
export function currentFontChoice(mvp: Pick<IMvpProjectDetail, 'controls'> | null | undefined): MvpFontChoice['id'] | null {
  const heading = mvp?.controls?.fontHeading;
  const body = mvp?.controls?.fontBody;
  return MVP_FONT_CHOICES.find((choice) => choice.heading === heading && choice.body === body)?.id ?? null;
}

export type ListedVersion = Serialized<IMvpPageVersion> & { current: boolean };

/** Newest first; `current` is the highest number, the version of the published page */
export function versionsNewestFirst(versions: IMvpProjectDetail['versions']): ListedVersion[] {
  const sorted = [...(versions ?? [])].sort((a, b) => b.n - a.n);
  return sorted.map((version, index) => ({ ...version, current: index === 0 }));
}

/** What an action's answer says, as an i18n key under `mvpPage.outcome` */
export function pageResultText(action: 'change' | 'controls' | 'restore', result: IMvpPageJobResult): MvpText {
  if (!result.applied) {
    if (result.reason === 'unchanged') return { key: 'mvpPage.outcome.unchanged' };
    return { key: `mvpPage.outcome.refused.${result.reason}`, values: { message: result.message } };
  }
  if (action === 'controls') return { key: 'mvpPage.outcome.controls' };
  const values = result.version !== undefined ? { values: { n: result.version } } : {};
  return { key: action === 'restore' ? 'mvpPage.outcome.restored' : 'mvpPage.outcome.changed', ...values };
}

/** A lead's generation failure: a page failure by its reason; any other (the previous generator's) a generic text */
export function generationFailureText(failure: { code: string; reason: string }): MvpText {
  const known = failure.code === 'MVP_PAGE_UNAVAILABLE' && (MVP_PAGE_FAILURES as readonly string[]).includes(failure.reason);
  return { key: `mvpFailure.page.${known ? failure.reason : 'previous'}` };
}
