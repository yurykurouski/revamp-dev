import type { ISiteTypography } from '@revamp/shared-types';
import { FONT_STACKS } from '../templates/design.js';

// Deterministic tuning of the rebuilt page (REV-110): color contrast and type, no LLM

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) =>
  0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));

/** WCAG 2 contrast ratio of two #rrggbb colors */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const mix = (hex: string, target: number, share: number) =>
  `#${[0, 1, 2].map((i) => toHex(channel(hex, i) * 255 * (1 - share) + target * share)).join('')}`;

/** Near-black or white, whichever reads better on the background */
export function onColor(background: string): '#111111' | '#ffffff' {
  return contrastRatio('#111111', background) >= contrastRatio('#ffffff', background) ? '#111111' : '#ffffff';
}

/**
 * The text color made readable on its background (AA, 4.5:1): kept when it passes, else moved toward
 * black or white in 10% steps, else near-black or white
 */
export function readableText(text: string | undefined, background: string): { color: string; changed: boolean } {
  if (!text) return { color: onColor(background), changed: false };
  if (contrastRatio(text, background) >= AA) return { color: text, changed: false };
  const target = onColor(background) === '#111111' ? 0 : 255;
  for (let share = 0.1; share < 1; share += 0.1) {
    const candidate = mix(text, target, share);
    if (contrastRatio(candidate, background) >= AA) return { color: candidate, changed: true };
  }
  return { color: onColor(background), changed: true };
}

/** Dark overlay over a background photo: white text reaches AA even over a white photo */
export const BANNER_OVERLAY = 0.55;

const FAMILY_RULES: Array<[RegExp, keyof typeof FONT_STACKS]> = [
  [/mono|code|courier|consolas/i, 'mono'],
  [/nunito|quicksand|comfortaa|varela round|rounded|baloo|fredoka/i, 'rounded'],
  [/montserrat|poppins|raleway|futura|avenir|josefin|urbanist|outfit|manrope|gotham|century gothic|jost/i, 'geometric'],
  [/playfair|merriweather|lora|georgia|times|garamond|cormorant|baskerville|pt serif|noto serif|libre|crimson|(^|[^-\w])serif/i, 'serif'],
];

/** The system font stack nearest to the original family; the page loads no external fonts */
export function fontStack(family: string | undefined): string {
  const name = (family ?? '').replace(/sans-serif/gi, '');
  const rule = FAMILY_RULES.find(([pattern]) => pattern.test(name));
  return FONT_STACKS[rule?.[1] ?? 'humanist'];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Heading and body sizes from the original, bounded, with the fixes applied recorded */
export function typeScale(typography: ISiteTypography | undefined) {
  const tuning: string[] = [];
  const h2Size = clamp(Math.round(typography?.heading.size ?? 34), 24, 48);
  const h1Size = clamp(Math.round(h2Size * 1.4), 32, 64);
  const originalBody = Math.round(typography?.body.size ?? 16);
  const bodySize = clamp(originalBody, 16, 20);
  if (originalBody < 16) tuning.push('font:body-16');
  const originalLine = typography?.body.lineHeight;
  const lineHeight = originalLine === undefined ? 1.6 : clamp(originalLine, 1.5, 1.9);
  if (originalLine !== undefined && originalLine < 1.5) tuning.push('line-height:1.5');
  return {
    h1Size,
    h2Size,
    bodySize,
    lineHeight,
    headingWeight: clamp(Math.round((typography?.heading.weight ?? 700) / 100) * 100, 400, 900),
    headingUppercase: typography?.heading.uppercase ?? false,
    tuning,
  };
}

/** Section padding per side, px: the original's, bounded to 48..120 */
export const clampPadding = (px: number | undefined): number => clamp(Math.round(px ?? 64), 48, 120);
