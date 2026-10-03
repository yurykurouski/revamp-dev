import type { IAudit, IRebuildModernize, IRebuildModernizeAnswer, IRebuildSectionEdit, ISiteSection, ISiteSections } from '@revamp/shared-types';
import { SITE_SECTIONS_LIMITS, cardRun, checkRebuildEdit, rebuildH1Section } from '@revamp/validation';

// The modernize layer's deterministic default (REV-114): the design a dated site gets when the model is not
// used or its answer is rejected. It is also the model's starting point. Ids and fixed values only.

/** A photo narrower than this is not worth opening the page with */
export const HERO_PHOTO_MIN_WIDTH = 300;
/** How many hero or content sections after the page's h1 section are searched for the hero photo */
const HERO_PHOTO_SEARCH = 3;
/** The browser's own fonts, which a site gets when it sets none */
const DEFAULT_FONTS = ['times', 'times new roman', 'serif'];

const isHttp = (url: string | undefined): url is string => Boolean(url && /^https?:\/\//i.test(url));

/** A section whose own photo sits behind it: a background image or a slider of photos */
const hasPhotoBackground = (s: ISiteSection) =>
  isHttp(s.style.backgroundImage) ||
  (s.arrangement === 'slider' && s.items.length > 0 && s.items.filter((i) => isHttp(i.backgroundImage) || isHttp(i.image?.src)).length * 2 >= s.items.length);

const firstFamily = (family: string | undefined) => (family ?? '').split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase() ?? '';

export function defaultModernDesign(read: ISiteSections): IRebuildModernizeAnswer {
  const main = read.sections.filter((s) => s.role === 'hero' || s.role === 'content').slice(0, SITE_SECTIONS_LIMITS.sections);
  const h1 = rebuildH1Section(main);
  const id = (s: ISiteSection) => `s-${s.index}`;
  const sections: Record<string, IRebuildSectionEdit> = {};
  const edit = (s: ISiteSection) => (sections[id(s)] ??= {});

  // The page opens with the first photo wide enough from the next sections, when its own section has none
  let hero: IRebuildModernizeAnswer['hero'];
  let heroSource: { section: ISiteSection } | undefined;
  if (h1 && !h1.images.length && !hasPhotoBackground(h1) && !h1.items.some((i) => i.image || i.backgroundImage)) {
    for (const s of main.slice(main.indexOf(h1) + 1, main.indexOf(h1) + 1 + HERO_PHOTO_SEARCH)) {
      const n = s.images.findIndex((image) => isHttp(image.src) && (image.width ?? 0) >= HERO_PHOTO_MIN_WIDTH);
      if (n < 0) continue;
      hero = { photo: `${id(s)}.m${n}`, style: 'split' };
      // A section left without its only photo keeps no photo settings
      heroSource = s.images.length === 1 ? { section: s } : undefined;
      break;
    }
  }

  let side: 'left' | 'right' = 'right';
  let tinted = false;
  const afterHero = h1 ? main.indexOf(h1) : -1;
  main.forEach((s, i) => {
    edit(s).align = 'left';
    if (s.role !== 'content') return;
    if (s.arrangement === 'text' && cardRun(s.intro.text)) edit(s).arrangement = 'card-grid';
    else if (s.arrangement === 'list' && s.items.length >= 3) edit(s).arrangement = 'card-grid';
    if (s.arrangement === 'media-beside-text' && s.images.length > 0 && heroSource?.section !== s) {
      edit(s).media = 'fill';
      edit(s).mediaSide = side;
      side = side === 'right' ? 'left' : 'right';
    }
    if (i > afterHero && !hasPhotoBackground(s)) {
      edit(s).background = tinted ? 'tinted' : 'page';
      tinted = !tinted;
    }
  });

  const typography = read.typography;
  const theme: NonNullable<IRebuildModernizeAnswer['theme']> = {
    typeScale: 'modern',
    density: 'comfortable',
    corners: typography?.button?.radius === 0 ? 'sharp' : 'soft',
    ...(DEFAULT_FONTS.includes(firstFamily(typography?.body.family)) ? { font: 'humanist' as const } : {}),
  };
  return { ...(hero ? { hero } : {}), sections, theme };
}

/**
 * The stored modernize design when it was made for this audit and still fits its page, else undefined: its ids
 * name this audit's sections only (as `editForAudit` does for the operator's edit)
 */
export function modernizeForAudit(stored: IRebuildModernize | null | undefined, audit: Partial<IAudit> | undefined): IRebuildModernize | undefined {
  if (!stored) return undefined;
  const key = String(audit?._id ?? '');
  if (stored.auditId !== key) {
    console.warn(`[RebuildModernize] Design for audit ${stored.auditId} left out: the MVP renders audit ${key || 'unknown'}`);
    return undefined;
  }
  const check = audit?.siteSections ? checkRebuildEdit(stored.design, audit.siteSections) : ({ ok: false, reason: 'the audit has no site sections' } as const);
  if (!check.ok) {
    console.warn(`[RebuildModernize] Design for audit ${key} left out: ${check.reason}`);
    return undefined;
  }
  return stored;
}
