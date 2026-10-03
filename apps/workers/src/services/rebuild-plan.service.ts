import type {
  IMvpRebuildSummary,
  IRebuildEditAnswer,
  IRebuildModernizeAnswer,
  IRebuildSectionEdit,
  IRebuildBlock,
  IRebuildImage,
  IRebuildItem,
  IRebuildLink,
  IRebuildPlan,
  IRebuildSection,
  ISiteImage,
  ISiteLink,
  ISiteSection,
  ISiteSectionItem,
  ISiteSections,
} from '@revamp/shared-types';
import { z } from 'zod';
import { REBUILD_BANNER_MIN_WIDTH, REBUILD_IFRAME_HOSTS, REBUILD_SUMMARY_LIMITS, SITE_SECTIONS_LIMITS, rebuildH1Section } from '@revamp/validation';
import { getMvpStrings, sanitizeLanguageTag } from '../templates/mvp-locale.js';
import { FONT_STACKS } from '../templates/design.js';
import { UnsafeCssError, sanitizeMvpCss } from '../templates/css-sanitizer.js';
import { BANNER_OVERLAY, clampPadding, fontStack, mix, onColor, readableText, typeScale } from './rebuild-tuning.js';
import { type EditSource, arrangedSection, mergeRebuildEdits } from './rebuild-modernize-plan.js';

export { mergeRebuildEdits };

// The rebuild's decisions (REV-110): which sections, links, embeds and fixes. Pure; the renderer only
// turns the plan into markup, and nothing here adds a fact the original page does not have.

export interface RebuildInput {
  siteSections: ISiteSections;
  businessName: string;
  language?: string;
  contacts: { phone?: string; email?: string; address?: string; workingHours?: string };
  socialLinks: { platform?: string; url: string }[];
  logoUrl?: string;
  primary: string;
  year: number;
  /** The operator's change (REV-111), its ids already checked against these sections */
  edit?: IRebuildEditAnswer;
  /** The modernize layer (REV-114), under the operator's edit; its ids already checked against these sections */
  modernize?: IRebuildModernizeAnswer;
}

/** A `text` section longer than this puts its body in a collapsed <details> */
export const COLLAPSE_CHARS = 1200;
/** Booking and appointment hosts: a link there becomes the page's own booking form */
export const BOOKING_HOSTS = /(^|\.)(booksy\.com|znanylekarz\.pl|docplanner\.[a-z.]+|medfile\.pl|calendly\.com|reservio\.[a-z.]+)$/i;
const PAGE_BACKGROUND = '#ffffff';
/** The rebuild edit's values (REV-111): section padding per density, radius per corner style, the dark background */
export const DENSITY_PADDING = { compact: 48, comfortable: 72, airy: 112 } as const;
export const CORNER_RADIUS = { sharp: 0, soft: 6, rounded: 12, 'extra-round': 999 } as const;
export const DARK_BACKGROUND = '#111827';
/** A tint is this share of the primary over white */
const TINT_SHARE = 0.08;
/** The modern type scale (REV-114): fixed heading sizes, the body at least this */
export const MODERN_TYPE = { h1Size: 56, h2Size: 36, minBodySize: 17 } as const;
/** A filled media column is at most twice the photo's natural width, and never over this */
export const MEDIA_MAX = 1200;
/** The section edit's style fields (REV-111), recorded as `style:<i>` */
const STYLE_KEYS = ['background', 'align', 'density'] as const;
/** The theme edit's fields recorded as `theme` (REV-111); the type scale has its own `type` code */
const THEME_KEYS = ['font', 'density', 'corners', 'headingCase'] as const;

const LIMITS = SITE_SECTIONS_LIMITS;
const EmailSchema = z.string().email().max(254);
const HEX = /^#[0-9a-f]{6}$/i;
const isHttp = (url: string | undefined): url is string => Boolean(url && url.length <= LIMITS.urlChars && /^https?:\/\//i.test(url));
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);
/** A nav label names a section when it equals its heading or opens it, followed by a non-letter */
function namesSection(heading: string | undefined, text: string): boolean {
  if (!heading) return false;
  const h = fold(heading);
  const l = fold(text);
  if (!l) return false;
  return h === l || (h.startsWith(l) && /[^\p{L}\p{N}]/u.test(h.charAt(l.length)));
}
/** A label the schema accepts (1..300 chars), or undefined when nothing is left */
const label = (text: string | undefined) => cut((text ?? '').trim(), LIMITS.labelChars) || undefined;
/** Non-empty strings only, each within the text cap, at most `textsPerArray` of them */
const texts = (list: string[]) =>
  list.map((t) => cut(t, LIMITS.textChars)).filter((t) => t.trim()).slice(0, LIMITS.textsPerArray);

class Recorder {
  readonly summary: IMvpRebuildSummary;
  private altFilled = 0;
  constructor(coverage: number) {
    this.summary = { coverage, sections: 0, omitted: [], tuning: [] };
  }
  /** One running `alt:<count>` code for the alt texts filled in from a title or heading */
  countAlt() {
    this.altFilled += 1;
    const at = this.summary.tuning.findIndex((code) => code.startsWith('alt:'));
    if (at >= 0) this.summary.tuning[at] = `alt:${this.altFilled}`;
    else this.fix(`alt:${this.altFilled}`);
  }
  omit(what: IMvpRebuildSummary['omitted'][number]['what'], reason: string, sample?: string) {
    if (this.summary.omitted.length >= REBUILD_SUMMARY_LIMITS.omitted) return;
    this.summary.omitted.push({ what, reason, ...(sample ? { sample: cut(sample, 120) } : {}) });
  }
  fix(code: string) {
    if (this.summary.tuning.length < REBUILD_SUMMARY_LIMITS.tuning && !this.summary.tuning.includes(code)) this.summary.tuning.push(code);
  }
}

function planLink(link: ISiteLink, rec: Recorder): IRebuildLink | null {
  const href = link.href.trim();
  const text = label(link.label);
  if (!text) {
    rec.omit('link', 'no_label', href.slice(0, 60));
    return null;
  }
  if (link.kind === 'phone' && /^tel:/i.test(href)) {
    let decoded: string | undefined;
    try {
      decoded = decodeURIComponent(href.slice(4));
    } catch {
      rec.omit('link', 'unsafe_url', text);
      return null;
    }
    const digits = decoded.replace(/[^+\d]/g, '');
    if (/^\+?\d{3,20}$/.test(digits)) return { label: text, href: `tel:${digits}`, kind: 'phone' };
  }
  if (link.kind === 'email' && href.length <= LIMITS.urlChars && /^mailto:[^\s@<>"]+@[^\s@<>"]+$/i.test(href.split('?')[0]!)) {
    return { label: text, href: `mailto:${href.split('?')[0]!.slice(7)}`, kind: 'email' };
  }
  if (isHttp(href) && (link.kind === 'cta' || BOOKING_HOSTS.test(hostOf(href)))) {
    return { label: text, href: '#booking', kind: 'booking' };
  }
  if (link.kind === 'map' && isHttp(href)) return { label: text, href, kind: 'map' };
  rec.omit('link', isHttp(href) ? 'other_page' : 'unsafe_url', text);
  return null;
}

/** A header link that is the page's call to action: marked so, or to a booking host */
const isCtaLink = (link: ISiteLink) => link.kind === 'cta' || (isHttp(link.href) && BOOKING_HOSTS.test(hostOf(link.href)));

const planLinks = (links: ISiteLink[], rec: Recorder) =>
  links.map((link) => planLink(link, rec)).filter((link): link is IRebuildLink => link !== null).slice(0, LIMITS.links);

function planImage(image: ISiteImage | undefined, fallbackAlt: string | undefined, rec: Recorder, eager: boolean): IRebuildImage | undefined {
  if (!image) return undefined;
  if (!isHttp(image.src)) {
    rec.omit('image', 'not_http', String(image.src).slice(0, 40));
    return undefined;
  }
  const alt = image.alt?.trim() || fallbackAlt?.trim() || '';
  if (!image.alt?.trim() && alt) rec.countAlt();
  return {
    src: image.src,
    alt: cut(alt, 300),
    ...(image.width && Math.round(image.width) >= 1 ? { width: Math.round(image.width) } : {}),
    ...(image.height && Math.round(image.height) >= 1 ? { height: Math.round(image.height) } : {}),
    // Key always present (undefined when lazy): JSON drops it, the plan schema allows it
    eager: eager ? true : undefined,
  };
}

function planItem(item: ISiteSectionItem, rec: Recorder, eager: boolean, photo = false): IRebuildItem {
  const title = label(item.title);
  const subtitle = label(item.subtitle);
  const price = label(item.price);
  let image = item.image ? planImage(item.image, title, rec, eager) : undefined;
  // A photo slide shows its background photo, else its picture, behind the caption
  let backgroundImage: string | undefined;
  let backgroundAlt: string | undefined;
  if (photo) {
    backgroundImage = isHttp(item.backgroundImage) ? item.backgroundImage : image?.src;
    if (image && backgroundImage === image.src) {
      // The picture's own alt stays as the slide's text alternative (never one made up from the title)
      backgroundAlt = label(item.image?.alt);
      image = undefined;
    }
  }
  return {
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
    text: texts(item.text),
    ...(image ? { image } : {}),
    ...(backgroundImage ? { backgroundImage } : {}),
    ...(backgroundAlt ? { backgroundAlt } : {}),
    ...(price ? { price } : {}),
    ...(item.rating !== undefined ? { rating: Math.min(5, Math.max(0, item.rating)) } : {}),
    links: planLinks(item.links, rec),
  };
}

/** An item with nothing left to show, e.g. a menu of links to other pages once those are dropped */
const isEmptyItem = (item: IRebuildItem) =>
  !item.title &&
  !item.subtitle &&
  !item.text.length &&
  !item.image &&
  !item.backgroundImage &&
  !item.price &&
  item.rating === undefined &&
  !item.links.length;

const planItems = (items: ISiteSectionItem[], rec: Recorder, eagerFirst: boolean, photo = false) =>
  items
    .slice(0, LIMITS.items)
    .map((item, i) => planItem(item, rec, eagerFirst && i === 0, photo))
    .filter((item) => !isEmptyItem(item));

/** Beside the text, the largest picture takes the media slot (the renderer's first image); the rest keep their order */
function mediaFirst(section: ISiteSection): ISiteImage[] {
  if (section.arrangement !== 'media-beside-text' || section.images.length < 2) return section.images;
  const area = (image: ISiteImage) => (image.width ?? 0) * (image.height ?? 0);
  const largest = section.images.reduce((best, image) => (area(image) > area(best) ? image : best));
  return [largest, ...section.images.filter((image) => image !== largest)];
}

/** A hero slider whose slides mostly carry a photo is shown as photo slides, one at a time */
const isPhotoSlider = (section: ISiteSection) =>
  section.role === 'hero' &&
  section.arrangement === 'slider' &&
  section.items.length > 0 &&
  section.items.filter((item) => isHttp(item.backgroundImage) || isHttp(item.image?.src)).length * 2 >= section.items.length;

/** A planned section with nothing to render: no heading, copy, items, images, photo, embeds or booking form */
const isEmptySection = (s: IRebuildSection) =>
  !s.style.backgroundImage &&
  !s.intro.heading &&
  !s.intro.eyebrow &&
  !s.intro.text.length &&
  !s.intro.links.length &&
  !s.items.length &&
  s.extra.every((block) => (block.type === 'text' ? !block.text.length : !block.items.length)) &&
  !s.images.length &&
  !s.embeds.length &&
  !s.booking;

const textLength = (section: ISiteSection) =>
  [...section.intro.text, ...section.extra.flatMap((e) => (e.type === 'text' ? e.text : []))].join('').length;

/**
 * One section's plan. Its section-level fixes (overlay, contrast, collapse) go into `fixes`, recorded by the caller
 * only when the section is rendered.
 */
interface Look {
  primary: string;
  sections: Record<string, IRebuildSectionEdit>;
  /** Where a field of the applied edit came from (REV-114), for its code's prefix */
  from: (path: string) => EditSource;
  density?: keyof typeof DENSITY_PADDING;
  radius?: number;
}

/** A section's background as the operator picked it, else as read */
function editedBackground(pick: IRebuildSectionEdit['background'], read: string | undefined, primary: string): string | undefined {
  switch (pick) {
    case 'page':
      return PAGE_BACKGROUND;
    case 'tinted':
      return mix(primary, 255, 1 - TINT_SHARE);
    case 'brand':
      return primary;
    case 'dark':
      return DARK_BACKGROUND;
    default:
      return read;
  }
}

/** The h1 section given a photo from a later section (REV-114), with its codes and, when it has no link, the CTA */
interface HeroPhoto {
  index: number;
  style: 'split' | 'banner';
  codes: string[];
  cta?: IRebuildLink;
}

function planSection(
  read: ISiteSection,
  ctx: { rec: Recorder; t: ReturnType<typeof getMvpStrings>; booking: { placed: boolean }; h1: { used: boolean }; look?: Look; hero?: HeroPhoto },
  fixes: string[],
): IRebuildSection {
  const { rec, t } = ctx;
  const sid = `s-${read.index}`;
  const edit = ctx.look?.sections[sid];
  const from = (key: keyof IRebuildSectionEdit): EditSource => ctx.look?.from(`sections.${sid}.${key}`) ?? 'edit';
  const styled = new Set(STYLE_KEYS.filter((key) => edit?.[key] !== undefined).map(from));
  styled.forEach((source) => fixes.push(`${source}:style:${read.index}`));
  // Cards or a list from the section's paragraphs (REV-114), before anything is measured
  const section = arrangedSection(read, edit?.arrangement);
  if (section !== read) fixes.push(`${from('arrangement')}:cards:${read.index}`);
  const hero = ctx.hero?.index === section.index ? ctx.hero : undefined;
  if (hero) fixes.push(...hero.codes);
  const eager = section.role === 'hero';
  const heading = label(section.intro.heading);
  const headingLevel: 1 | 2 = section.role === 'hero' && heading && !ctx.h1.used ? 1 : 2;
  if (headingLevel === 1) ctx.h1.used = true;

  let booking = false;
  const embeds: IRebuildSection['embeds'] = [];
  for (const embed of section.embeds) {
    if (embeds.length >= LIMITS.embeds) break;
    if ((embed.kind === 'form' || embed.kind === 'widget') && !ctx.booking.placed) {
      ctx.booking.placed = booking = true;
      rec.fix('booking:replaced');
    } else if ((embed.kind === 'map' || embed.kind === 'video') && isHttp(embed.src) && REBUILD_IFRAME_HOSTS.some((host) => host.test(embed.src!))) {
      embeds.push({ kind: embed.kind, src: embed.src, title: embed.kind === 'map' ? t.mapTitle : t.videoTitle });
    } else {
      rec.omit('embed', embed.kind === 'form' || embed.kind === 'widget' ? 'second_form' : 'host_not_allowed', embed.src ?? embed.kind);
    }
  }

  const photoSlides = isPhotoSlider(section);
  // Photo slides carry their own photos; the section's (the first slide's) would only sit behind them
  const photo = !photoSlides && isHttp(section.style.backgroundImage) ? section.style.backgroundImage : undefined;
  const readBackground = section.style.background && HEX.test(section.style.background) ? section.style.background : undefined;
  const background = ctx.look ? editedBackground(edit?.background, readBackground, ctx.look.primary) : readBackground;
  const textColor = section.style.textColor && HEX.test(section.style.textColor) ? section.style.textColor : undefined;
  let text: string;
  let overlay: number | undefined;
  if (photo || photoSlides) {
    // The overlay darkens the section's photo, or each slide's; slides keep their own white caption
    overlay = BANNER_OVERLAY;
    fixes.push(`overlay:${section.index}`);
  }
  if (photo) {
    text = '#ffffff';
  } else {
    // A photo slider's own intro (heading, text, links) sits on the section background, not on a photo
    const fixed = readableText(textColor, background ?? PAGE_BACKGROUND);
    text = fixed.color;
    if (fixed.changed) fixes.push(`contrast:${section.index}`);
  }

  // Items on their own background get a text color readable there, not the section's (white over a photo)
  let itemStyle: IRebuildSection['itemStyle'];
  if (section.itemStyle) {
    const { radius, background: itemBackground } = section.itemStyle;
    const itemText = itemBackground && HEX.test(itemBackground) ? readableText(textColor, itemBackground) : undefined;
    if (itemText?.changed) fixes.push(`contrast:${section.index}`);
    itemStyle = {
      ...section.itemStyle,
      // The reader keeps radii up to 1000 px; the plan caps them at 999 (a pill either way)
      ...(radius !== undefined ? { radius: Math.min(999, radius) } : {}),
      ...(itemText ? { text: itemText.color } : {}),
    };
  }
  // The operator's corner style rounds every section's items alike
  if (ctx.look?.radius !== undefined) itemStyle = { ...itemStyle, radius: ctx.look.radius };
  const density = edit?.density ?? ctx.look?.density;

  const collapsed = section.arrangement === 'text' && textLength(section) > COLLAPSE_CHARS;
  if (collapsed) fixes.push(`collapse:${section.index}`);

  const extra: IRebuildBlock[] = section.extra
    .slice(0, LIMITS.extra)
    .map((entry): IRebuildBlock => (entry.type === 'text' ? { type: 'text', text: texts(entry.text) } : { type: 'items', arrangement: entry.arrangement, items: planItems(entry.items, rec, false) }));

  const images = mediaFirst(section)
    .slice(0, LIMITS.images)
    .map((image, i) => planImage(image, heading, rec, eager && i === 0))
    .filter((image): image is IRebuildImage => Boolean(image));
  // Side and fill (REV-114) only where a photo sits beside the text; a section whose photo moved to the hero has none
  const hasMedia = section.arrangement === 'media-beside-text' && images.length > 0;
  const side = hasMedia && !hero ? edit?.mediaSide : undefined;
  if (side) fixes.push(`${from('mediaSide')}:side:${section.index}`);
  const filled = hasMedia && !hero && edit?.media === 'fill';
  if (filled) fixes.push(`${from('media')}:fill:${section.index}`);
  const fill = filled || (hasMedia && hero?.style === 'split');
  const mediaMax = fill && images[0]!.width ? Math.min(MEDIA_MAX, images[0]!.width * 2) : undefined;
  const mediaSide = side ?? section.mediaSide;

  return {
    id: `s-${section.index}`,
    index: section.index,
    kind: section.kind,
    arrangement: section.arrangement,
    ...(section.columns ? { columns: Math.min(8, Math.max(1, Math.round(section.columns))) } : {}),
    ...(mediaSide ? { mediaSide } : {}),
    ...(fill ? { mediaFit: 'fill' as const } : {}),
    ...(mediaMax !== undefined ? { mediaMax } : {}),
    ...(section.style.split !== undefined ? { split: Math.min(0.9, Math.max(0.1, section.style.split)) } : {}),
    headingLevel,
    ...(photoSlides ? { photoSlides } : {}),
    intro: {
      ...(label(section.intro.eyebrow) ? { eyebrow: label(section.intro.eyebrow) } : {}),
      ...(heading ? { heading } : {}),
      text: texts(section.intro.text),
      links: [...planLinks(section.intro.links, rec), ...(hero?.cta ? [hero.cta] : [])],
    },
    items: planItems(section.items, rec, eager, photoSlides),
    ...(itemStyle ? { itemStyle } : {}),
    extra,
    images,
    embeds,
    booking,
    collapsed,
    style: {
      ...(background ? { background } : {}),
      ...(photo ? { backgroundImage: photo } : {}),
      text,
      ...(overlay !== undefined ? { overlay } : {}),
      align: edit?.align ?? section.style.align ?? 'left',
      paddingY: density ? DENSITY_PADDING[density] : clampPadding(section.style.paddingY),
      fullBleed: section.style.fullBleed ?? false,
    },
  };
}

/** The section without the paragraphs, items and extra blocks the operator left out (REV-111), each recorded */
function withoutDropped(section: ISiteSection, dropped: Set<string>, rec: Recorder): ISiteSection {
  const id = `s-${section.index}`;
  const kept = (part: 't' | 'i' | 'x', n: number) => !dropped.has(`${id}.${part}${n}`);
  if (![...dropped].some((piece) => piece.startsWith(`${id}.`))) return section;
  section.intro.text.forEach((text, n) => kept('t', n) || rec.omit('text', 'dropped', text));
  section.items.forEach((item, n) => kept('i', n) || rec.omit('item', 'dropped', item.title ?? item.text[0]));
  section.extra.forEach((entry, n) => kept('x', n) || rec.omit('text', 'dropped', entry.type === 'text' ? entry.text[0] : entry.items[0]?.title));
  return {
    ...section,
    intro: { ...section.intro, text: section.intro.text.filter((_, n) => kept('t', n)) },
    items: section.items.filter((_, n) => kept('i', n)),
    extra: section.extra.filter((_, n) => kept('x', n)),
  };
}

/**
 * The page with the hero photo moved (REV-114): out of its section and into the h1 section, as the split's media
 * or the banner's background. Copies the two sections it touches and never changes the reading; a photo the
 * checks would refuse is left where it is.
 */
function withHeroPhoto(sections: ISiteSection[], hero: IRebuildEditAnswer['hero']): { sections: ISiteSection[]; h1?: ISiteSection } {
  const id = hero ? /^s-(\d+)\.m(\d+)$/.exec(hero.photo) : null;
  if (!hero || !id) return { sections };
  const main = sections.filter((s) => s.role === 'hero' || s.role === 'content').slice(0, LIMITS.sections);
  const h1 = rebuildH1Section(main);
  const source = main.find((s) => s.index === Number(id[1]));
  const n = Number(id[2]);
  const image = source?.images[n];
  if (!h1 || !source || !image || !isHttp(image.src) || main.indexOf(source) <= main.indexOf(h1)) return { sections };
  if (h1.images.length || isHttp(h1.style.backgroundImage) || isPhotoSlider(h1)) return { sections };
  if (hero.style === 'banner' && (image.width ?? 0) < REBUILD_BANNER_MIN_WIDTH) return { sections };
  const opened: ISiteSection =
    hero.style === 'split'
      ? { ...h1, arrangement: 'media-beside-text', mediaSide: 'right', images: [image] }
      : { ...h1, arrangement: h1.arrangement === 'text' ? 'banner' : h1.arrangement, style: { ...h1.style, backgroundImage: image.src } };
  const rest: ISiteSection = { ...source, images: source.images.filter((_, m) => m !== n) };
  return { sections: sections.map((s) => (s === h1 ? opened : s === source ? rest : s)), h1 };
}

/** The operator's CSS, through the sanitizer again; CSS that no longer passes is left out and recorded */
function plannedCss(css: string | undefined, rec: Recorder): string | undefined {
  if (!css?.trim()) return undefined;
  try {
    return sanitizeMvpCss(css);
  } catch (error) {
    if (!(error instanceof UnsafeCssError)) throw error;
    rec.fix('edit:css-dropped');
    return undefined;
  }
}

/** The services and pricing item titles as booking options, each once (case and spacing ignored), in its first spelling */
function bookingServices(sections: ISiteSection[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const s of sections) {
    if (s.kind !== 'services' && s.kind !== 'pricing') continue;
    for (const item of s.items) {
      const title = item.title?.trim().slice(0, 60);
      if (!title) continue;
      const key = title.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(title);
    }
  }
  return list.slice(0, LIMITS.items);
}

export function planRebuild(input: RebuildInput): IRebuildPlan {
  const read = input.siteSections;
  const rec = new Recorder(Math.min(1, Math.max(0, read.coverage.ratio)));
  const language = sanitizeLanguageTag(input.language) ?? 'en';
  const t = getMvpStrings(language);
  for (const skipped of read.skipped) rec.omit('section', skipped.reason, skipped.sample || skipped.heading);

  // The operator's edit (REV-111) over the modernize layer (REV-114): hidden sections and dropped pieces
  // leave before planning, recorded
  const { edit, from } = mergeRebuildEdits(input.modernize, input.edit);
  const hidden = new Set(edit?.hidden ?? []);
  const dropped = new Set(edit?.dropped ?? []);
  const pageSections = read.sections
    .filter((s) => {
      if (!hidden.has(`s-${s.index}`)) return true;
      rec.omit('section', 'hidden', s.intro.heading);
      return false;
    })
    .map((s) => withoutDropped(s, dropped, rec));
  const corners = edit?.theme?.corners;
  const look: Look | undefined = edit
    ? {
        primary: input.primary,
        sections: edit.sections ?? {},
        from,
        ...(edit.theme?.density ? { density: edit.theme.density } : {}),
        ...(corners ? { radius: CORNER_RADIUS[corners] } : {}),
      }
    : undefined;

  const header = pageSections.find((s) => s.role === 'header');
  const footer = pageSections.find((s) => s.role === 'footer');
  // The header's call to action: the original's own label, else the localised one
  let ctaLabel: string | undefined;
  for (const link of header?.intro.links ?? []) if (isCtaLink(link)) ctaLabel ??= label(link.label);
  const cta = label(ctaLabel) ?? t.sendRequest;

  // The hero photo (REV-114) moves after the drops and before planning; a hero without a link gets the header's CTA
  const moved = withHeroPhoto(pageSections, edit?.hero);
  const heroPhoto: HeroPhoto | undefined =
    moved.h1 && edit?.hero
      ? {
          index: moved.h1.index,
          style: edit.hero.style,
          codes: [`${from('hero')}:hero-photo:${edit.hero.photo}`, ...(moved.h1.intro.links.length ? [] : [`${from('hero')}:hero-cta`])],
          ...(moved.h1.intro.links.length ? {} : { cta: { label: cta, href: '#booking', kind: 'booking' as const } }),
        }
      : undefined;
  const ctx = { rec, t, booking: { placed: false }, h1: { used: false }, ...(look ? { look } : {}), ...(heroPhoto ? { hero: heroPhoto } : {}) };
  const mainSections = moved.sections.filter((s) => s.role === 'hero' || s.role === 'content');
  for (const dropped of mainSections.slice(LIMITS.sections)) rec.omit('section', 'over_cap', dropped.intro.heading);
  const sections = mainSections
    .slice(0, LIMITS.sections)
    .map((s) => {
      const fixes: string[] = [];
      return { read: s, planned: planSection(s, ctx, fixes), fixes };
    })
    .filter(({ read: s, planned, fixes }) => {
      if (!isEmptySection(planned)) {
        fixes.forEach((code) => rec.fix(code));
        return true;
      }
      // Recorded with what it held, e.g. the first of its dropped links
      const held = [...s.intro.links, ...s.items.flatMap((item) => item.links)][0]?.label;
      rec.omit('section', 'empty', held);
      return false;
    })
    .map(({ planned }) => planned);
  // The operator's order; unlisted sections follow in the original order
  if (edit?.order?.length) {
    const rank = new Map(edit.order.map((id, i) => [id, i]));
    const position = new Map(sections.map((s, i) => [s.id, i]));
    const key = (s: IRebuildSection) => rank.get(s.id) ?? edit.order!.length + position.get(s.id)!;
    sections.sort((a, b) => key(a) - key(b));
    rec.fix('edit:order');
  }
  rec.summary.sections = sections.length;
  if (!ctx.h1.used) rec.fix('h1:hidden');
  if (!ctx.booking.placed) rec.fix('booking:appended');

  const businessName = label(input.businessName) ?? 'Business';
  // The footer never claims the booking slot (R2): a form there is an omitted second form
  const footerFixes: string[] = [];
  const plannedFooter = footer ? planSection(footer, { ...ctx, booking: { placed: true }, h1: { used: true } }, footerFixes) : undefined;
  // A footer of links to other pages alone is empty once they are dropped; the page's own footer takes its place
  const footerSection = plannedFooter && !isEmptySection(plannedFooter) ? plannedFooter : undefined;
  if (footerSection) footerFixes.forEach((code) => rec.fix(code));
  if (footer && plannedFooter && !footerSection) {
    rec.omit('section', 'empty', [...footer.intro.links, ...footer.items.flatMap((item) => item.links)][0]?.label);
  }
  if (!footerSection) rec.fix('footer:added');

  // Header: logo, nav links that name a section on this page (the footer included), and the CTA label
  const logo =
    planImage(header?.images[0], businessName, rec, true) ??
    (isHttp(input.logoUrl) ? { src: input.logoUrl, alt: cut(businessName, 300), eager: true } : undefined);
  const nav: IRebuildPlan['header']['nav'] = [];
  const anchors = footerSection ? [...sections, footerSection] : sections;
  for (const link of header?.intro.links ?? []) {
    if (isCtaLink(link)) continue;
    const text = label(link.label);
    if (link.kind === 'phone' || link.kind === 'email' || link.kind === 'map') {
      rec.omit('nav_link', 'contact_link', text);
      continue;
    }
    if (link.kind !== 'link' || !text) continue;
    const target = anchors.find((s) => namesSection(s.intro.heading, text));
    if (target && !nav.some((n) => n.href === `#${target.id}`) && nav.length < LIMITS.links) nav.push({ label: text, href: `#${target.id}` });
    else rec.omit('nav_link', 'other_page', text);
  }

  const scale = typeScale(read.typography);
  scale.tuning.forEach((code) => rec.fix(code));
  // The modern type scale (REV-114) replaces the read sizes; the responsive clamps stay in the CSS
  const modern = edit?.theme?.typeScale === 'modern';
  if (modern) rec.fix(`${from('theme.typeScale')}:type`);
  const sizes = modern
    ? { h1Size: MODERN_TYPE.h1Size, h2Size: MODERN_TYPE.h2Size, bodySize: Math.max(scale.bodySize, MODERN_TYPE.minBodySize) }
    : { h1Size: scale.h1Size, h2Size: scale.h2Size, bodySize: scale.bodySize };
  const theme = themeEdit(edit?.theme, fontStack(read.typography?.heading.family), fontStack(read.typography?.body.family));
  const themed = new Set(THEME_KEYS.filter((key) => edit?.theme?.[key] !== undefined).map((key) => from(`theme.${key}`)));
  themed.forEach((source) => rec.fix(`${source}:theme`));
  const customCss = plannedCss(edit?.customCss, rec);
  const button = read.typography?.button;
  const phone = input.contacts.phone?.trim().slice(0, 30) || undefined;
  const email = input.contacts.email?.trim();
  const validEmail = email && EmailSchema.safeParse(email).success ? email : undefined;

  return {
    language,
    businessName,
    ...(ctx.h1.used || !businessName ? {} : { hiddenH1: businessName }),
    year: input.year,
    theme: {
      primary: input.primary,
      onPrimary: onColor(input.primary),
      pageBackground: PAGE_BACKGROUND,
      pageText: readableText(read.typography?.body.color, PAGE_BACKGROUND).color,
      headingFont: theme.headingFont,
      bodyFont: theme.bodyFont,
      headingWeight: scale.headingWeight,
      headingUppercase: edit?.theme?.headingCase ? edit.theme.headingCase === 'uppercase' : scale.headingUppercase,
      h1Size: sizes.h1Size,
      h2Size: sizes.h2Size,
      bodySize: sizes.bodySize,
      lineHeight: scale.lineHeight,
      buttonRadius: corners ? CORNER_RADIUS[corners] : Math.min(999, Math.max(0, button?.radius ?? 6)),
      buttonUppercase: button?.uppercase ?? false,
    },
    header: {
      ...(logo ? { logo } : {}),
      nav,
      cta: { label: cta },
      ...(phone ? { phone } : {}),
    },
    sections,
    bookingAppended: !ctx.booking.placed,
    bookingServices: bookingServices(pageSections),
    footer: {
      ...(footerSection ? { section: footerSection } : {}),
      contacts: {
        ...(phone ? { phone } : {}),
        ...(validEmail ? { email: validEmail } : {}),
        ...(input.contacts.address?.trim() ? { address: cut(input.contacts.address.trim(), 300) } : {}),
        ...(input.contacts.workingHours?.trim() ? { workingHours: cut(input.contacts.workingHours.trim(), 300) } : {}),
      },
      social: input.socialLinks
        .filter((link) => isHttp(link.url))
        .slice(0, 12)
        .map((link) => ({ label: label(link.platform) ?? label(hostOf(link.url)) ?? 'link', href: link.url })),
    },
    summary: rec.summary,
    ...(customCss ? { customCss } : {}),
  };
}

/** Heading and body font stacks with the operator's font (REV-111); `system` keeps the original's */
function themeEdit(edit: IRebuildEditAnswer['theme'], headingFont: string, bodyFont: string): { headingFont: string; bodyFont: string } {
  switch (edit?.font) {
    case 'humanist':
    case 'geometric':
    case 'rounded':
    case 'serif':
      return { headingFont: FONT_STACKS[edit.font], bodyFont: FONT_STACKS[edit.font] };
    case 'serif-display':
      return { headingFont: FONT_STACKS.display, bodyFont };
    case 'mono-display':
      return { headingFont: FONT_STACKS.mono, bodyFont };
    default:
      return { headingFont, bodyFont };
  }
}
