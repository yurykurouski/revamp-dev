import type { IAudit, IRebuildModernize, IRebuildModernizeAnswer, IRebuildSectionEdit, ISiteSection, ISiteSections } from '@revamp/shared-types';
import { REBUILD_BANNER_MIN_WIDTH, SITE_SECTIONS_LIMITS, cardRun, checkRebuildEdit, rebuildH1Section, rebuildItemsFitCards } from '@revamp/validation';

// The modernize layer's starting point (REV-114): the design the model is shown as a sound default to improve on.
// Since REV-132 it is never applied in place of the model's answer. Ids and fixed values only.

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
      // A photo wide enough fills the hero behind its text, a smaller one sits beside it
      hero = { photo: `${id(s)}.m${n}`, style: (s.images[n]!.width ?? 0) >= REBUILD_BANNER_MIN_WIDTH ? 'banner' : 'split' };
      // A section left without its only photo keeps no photo settings
      heroSource = s.images.length === 1 ? { section: s } : undefined;
      break;
    }
  }

  let side: 'left' | 'right' = 'right';
  let tinted = false;
  const afterHero = h1 ? main.indexOf(h1) : -1;
  main.forEach((s, i) => {
    // Text over a photo keeps the original's alignment: a hero with its own photo behind it, or a banner hero
    const overPhoto = (s === h1 || s.role === 'hero') && (hasPhotoBackground(s) || (s === h1 && hero?.style === 'banner'));
    if (!overPhoto) edit(s).align = 'left';
    if (s.role !== 'content') return;
    if (s.arrangement === 'text' && cardRun(s.intro.text)) edit(s).arrangement = 'card-grid';
    else if (rebuildItemsFitCards(s)) edit(s).arrangement = 'card-grid';
    // Items beside a photo become cards, and the photo follows them: there is no column to fill or side to pick
    if (s.arrangement === 'media-beside-text' && s.images.length > 0 && heroSource?.section !== s && !rebuildItemsFitCards(s)) {
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
 * The stored modernize design when the model made it for this audit and it still fits its page, else undefined:
 * its ids name this audit's sections only (as `editForAudit` does for the operator's edit). A stored failure, or a
 * default design stored before REV-132, is never applied
 */
export function modernizeForAudit(
  stored: IRebuildModernize | null | undefined,
  audit: Partial<IAudit> | undefined,
): (IRebuildModernize & { source: 'llm'; design: IRebuildModernizeAnswer }) | undefined {
  if (!stored || stored.source !== 'llm' || !stored.design) return undefined;
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
  return stored as IRebuildModernize & { source: 'llm'; design: IRebuildModernizeAnswer };
}
