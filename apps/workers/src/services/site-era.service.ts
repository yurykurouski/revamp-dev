import { SITE_DATED_SIGNS, type ISiteEra, type ISiteSections, type SiteDatedSign } from '@revamp/shared-types';
import { SITE_DATED_THRESHOLD, SiteEraSchema } from '@revamp/validation';
import { parseHomePage, STALE_COPYRIGHT_YEARS } from './site-assessment.service.js';

/** What each sign adds to the dated score (REV-114) */
export const SITE_DATED_WEIGHTS: Record<SiteDatedSign, number> = {
  table_layout: 2,
  no_viewport: 2,
  frames: 2,
  flash: 2,
  narrow_fixed: 2,
  legacy_tags: 1,
  default_font: 1,
  old_jquery: 1,
  stale_copyright: 1,
};

/** A page whose content blocks are at most this wide (px) and not mostly full-bleed is a fixed narrow layout */
export const NARROW_FIXED_MAX_WIDTH = 1000;
export const NARROW_FIXED_MAX_BLEED_SHARE = 0.5;

const DEFAULT_FONTS = new Set(['times', 'times new roman', 'serif']);

const firstFamily = (stack: string): string =>
  (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();

export interface SiteEraInput {
  html: string;
  contentWidth?: number;
  fullBleedShare?: number;
  typography?: ISiteSections['typography'];
  now: Date;
}

/** Decides from deterministic facts whether the original site looks dated; no model involved */
export function readSiteEra(input: SiteEraInput): ISiteEra {
  const signals = parseHomePage(input.html, input.now);
  const found = new Set<SiteDatedSign>();
  if (signals.hasTableLayout) found.add('table_layout');
  if (!signals.hasViewport) found.add('no_viewport');
  if (signals.hasFrames) found.add('frames');
  if (signals.hasFlash) found.add('flash');
  if (
    input.contentWidth !== undefined &&
    input.contentWidth <= NARROW_FIXED_MAX_WIDTH &&
    (input.fullBleedShare ?? 0) < NARROW_FIXED_MAX_BLEED_SHARE
  ) {
    found.add('narrow_fixed');
  }
  if (signals.hasLegacyTags) found.add('legacy_tags');
  const families = [input.typography?.body?.family, input.typography?.heading?.family];
  if (families.some((f) => f !== undefined && DEFAULT_FONTS.has(firstFamily(f)))) found.add('default_font');
  if (signals.hasOldJquery) found.add('old_jquery');
  if (signals.copyrightYear !== undefined && input.now.getUTCFullYear() - signals.copyrightYear >= STALE_COPYRIGHT_YEARS) {
    found.add('stale_copyright');
  }
  const signs = SITE_DATED_SIGNS.filter((sign) => found.has(sign));
  const score = signs.reduce((sum, sign) => sum + SITE_DATED_WEIGHTS[sign], 0);
  return SiteEraSchema.parse({
    dated: score >= SITE_DATED_THRESHOLD,
    score,
    signs,
    ...(input.contentWidth !== undefined ? { contentWidth: input.contentWidth } : {}),
  });
}
