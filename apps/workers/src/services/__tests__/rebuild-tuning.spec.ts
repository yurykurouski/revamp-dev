import { describe, expect, it } from 'vitest';
import { BANNER_OVERLAY, clampPadding, contrastRatio, fontStack, onColor, readableText, typeScale } from '../rebuild-tuning.js';
import { FONT_STACKS } from '../../templates/design.js';

describe('contrast (REV-110)', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
  it('keeps a readable color', () => {
    expect(readableText('#222222', '#ffffff')).toEqual({ color: '#222222', changed: false });
  });
  it('darkens a pale text on white until it passes', () => {
    const fixed = readableText('#aaaaaa', '#ffffff');
    expect(fixed.changed).toBe(true);
    expect(contrastRatio(fixed.color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('reads white on white as unreadable and fixes it', () => {
    const fixed = readableText('#ffffff', '#ffffff');
    expect(contrastRatio(fixed.color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('uses the better of near-black and white with no text color', () => {
    expect(readableText(undefined, '#0b1f3a').color).toBe('#ffffff');
    expect(readableText(undefined, '#f5f5f5').color).toBe('#111111');
  });
  it('picks the CTA text color by contrast', () => {
    expect(onColor('#0e7490')).toBe('#ffffff');
    expect(onColor('#fde047')).toBe('#111111');
  });
  it('the banner overlay makes white text pass over a white photo', () => {
    const grey = Math.round(255 * (1 - BANNER_OVERLAY)).toString(16).padStart(2, '0');
    expect(contrastRatio('#ffffff', `#${grey}${grey}${grey}`)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('type (REV-110)', () => {
  it('maps families to system stacks', () => {
    expect(fontStack('"Playfair Display", serif')).toBe(FONT_STACKS.serif);
    expect(fontStack('Montserrat, sans-serif')).toBe(FONT_STACKS.geometric);
    expect(fontStack('Nunito')).toBe(FONT_STACKS.rounded);
    expect(fontStack('Roboto Mono')).toBe(FONT_STACKS.mono);
    expect(fontStack('Open Sans')).toBe(FONT_STACKS.humanist);
    expect(fontStack(undefined)).toBe(FONT_STACKS.humanist);
  });
  it('raises small body text and tight line height, and records it', () => {
    const scale = typeScale({
      heading: { family: 'Lato', size: 30, weight: 700, uppercase: true },
      body: { family: 'Lato', size: 14, weight: 400, lineHeight: 1.2 },
    });
    expect(scale).toMatchObject({ bodySize: 16, lineHeight: 1.5, headingWeight: 700, headingUppercase: true, h2Size: 30 });
    expect(scale.tuning).toEqual(['font:body-16', 'line-height:1.5']);
  });
  it('bounds heading sizes and defaults without typography', () => {
    expect(typeScale({ heading: { family: 'x', size: 90, weight: 800, uppercase: false }, body: { family: 'x', size: 18, weight: 400 } }))
      .toMatchObject({ h2Size: 48, h1Size: 64, bodySize: 18, lineHeight: 1.6 });
    expect(typeScale(undefined)).toMatchObject({ h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, headingWeight: 700 });
  });
  it('clamps section padding to 48..120', () => {
    expect(clampPadding(10)).toBe(48);
    expect(clampPadding(80)).toBe(80);
    expect(clampPadding(300)).toBe(120);
    expect(clampPadding(undefined)).toBe(64);
  });
});
