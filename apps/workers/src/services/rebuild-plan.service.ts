import type {
  IMvpRebuildSummary,
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
import { REBUILD_IFRAME_HOSTS, REBUILD_SUMMARY_LIMITS, SITE_SECTIONS_LIMITS } from '@revamp/validation';
import { getMvpStrings, sanitizeLanguageTag } from '../templates/mvp-locale.js';
import { BANNER_OVERLAY, clampPadding, fontStack, onColor, readableText, typeScale } from './rebuild-tuning.js';

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
}

/** A `text` section longer than this puts its body in a collapsed <details> */
export const COLLAPSE_CHARS = 1200;
/** Booking and appointment hosts: a link there becomes the page's own booking form */
export const BOOKING_HOSTS = /(^|\.)(booksy\.com|znanylekarz\.pl|docplanner\.[a-z.]+|medfile\.pl|calendly\.com|reservio\.[a-z.]+)$/i;
const PAGE_BACKGROUND = '#ffffff';

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

function planItem(item: ISiteSectionItem, rec: Recorder, eager: boolean): IRebuildItem {
  const title = label(item.title);
  const subtitle = label(item.subtitle);
  const price = label(item.price);
  const image = item.image ? planImage(item.image, title, rec, eager) : undefined;
  return {
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
    text: texts(item.text),
    ...(image ? { image } : {}),
    ...(price ? { price } : {}),
    ...(item.rating !== undefined ? { rating: Math.min(5, Math.max(0, item.rating)) } : {}),
    links: planLinks(item.links, rec),
  };
}

/** An item with nothing left to show, e.g. a menu of links to other pages once those are dropped */
const isEmptyItem = (item: IRebuildItem) =>
  !item.title && !item.subtitle && !item.text.length && !item.image && !item.price && item.rating === undefined && !item.links.length;

const planItems = (items: ISiteSectionItem[], rec: Recorder, eagerFirst: boolean) =>
  items
    .slice(0, LIMITS.items)
    .map((item, i) => planItem(item, rec, eagerFirst && i === 0))
    .filter((item) => !isEmptyItem(item));

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

function planSection(section: ISiteSection, ctx: { rec: Recorder; t: ReturnType<typeof getMvpStrings>; booking: { placed: boolean }; h1: { used: boolean } }): IRebuildSection {
  const { rec, t } = ctx;
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

  const photo = isHttp(section.style.backgroundImage) ? section.style.backgroundImage : undefined;
  const background = section.style.background && HEX.test(section.style.background) ? section.style.background : undefined;
  const textColor = section.style.textColor && HEX.test(section.style.textColor) ? section.style.textColor : undefined;
  let text: string;
  let overlay: number | undefined;
  if (photo) {
    overlay = BANNER_OVERLAY;
    text = '#ffffff';
    rec.fix(`overlay:${section.index}`);
  } else {
    const fixed = readableText(textColor, background ?? PAGE_BACKGROUND);
    text = fixed.color;
    if (fixed.changed) rec.fix(`contrast:${section.index}`);
  }

  // Items on their own background get a text color readable there, not the section's (white over a photo)
  let itemStyle: IRebuildSection['itemStyle'];
  if (section.itemStyle) {
    const { radius, background: itemBackground } = section.itemStyle;
    const itemText = itemBackground && HEX.test(itemBackground) ? readableText(textColor, itemBackground) : undefined;
    if (itemText?.changed) rec.fix(`contrast:${section.index}`);
    itemStyle = {
      ...section.itemStyle,
      // The reader keeps radii up to 1000 px; the plan caps them at 999 (a pill either way)
      ...(radius !== undefined ? { radius: Math.min(999, radius) } : {}),
      ...(itemText ? { text: itemText.color } : {}),
    };
  }

  const collapsed = section.arrangement === 'text' && textLength(section) > COLLAPSE_CHARS;
  if (collapsed) rec.fix(`collapse:${section.index}`);

  const extra: IRebuildBlock[] = section.extra
    .slice(0, LIMITS.extra)
    .map((entry): IRebuildBlock => (entry.type === 'text' ? { type: 'text', text: texts(entry.text) } : { type: 'items', arrangement: entry.arrangement, items: planItems(entry.items, rec, false) }));

  return {
    id: `s-${section.index}`,
    index: section.index,
    kind: section.kind,
    arrangement: section.arrangement,
    ...(section.columns ? { columns: Math.min(8, Math.max(1, Math.round(section.columns))) } : {}),
    ...(section.mediaSide ? { mediaSide: section.mediaSide } : {}),
    ...(section.style.split !== undefined ? { split: Math.min(0.9, Math.max(0.1, section.style.split)) } : {}),
    headingLevel,
    intro: {
      ...(label(section.intro.eyebrow) ? { eyebrow: label(section.intro.eyebrow) } : {}),
      ...(heading ? { heading } : {}),
      text: texts(section.intro.text),
      links: planLinks(section.intro.links, rec),
    },
    items: planItems(section.items, rec, eager),
    ...(itemStyle ? { itemStyle } : {}),
    extra,
    images: section.images
      .slice(0, LIMITS.images)
      .map((image, i) => planImage(image, heading, rec, eager && i === 0))
      .filter((image): image is IRebuildImage => Boolean(image)),
    embeds,
    booking,
    collapsed,
    style: {
      ...(background ? { background } : {}),
      ...(photo ? { backgroundImage: photo } : {}),
      text,
      ...(overlay !== undefined ? { overlay } : {}),
      align: section.style.align ?? 'left',
      paddingY: clampPadding(section.style.paddingY),
      fullBleed: section.style.fullBleed ?? false,
    },
  };
}

export function planRebuild(input: RebuildInput): IRebuildPlan {
  const read = input.siteSections;
  const rec = new Recorder(Math.min(1, Math.max(0, read.coverage.ratio)));
  const language = sanitizeLanguageTag(input.language) ?? 'en';
  const t = getMvpStrings(language);
  for (const skipped of read.skipped) rec.omit('section', skipped.reason, skipped.sample || skipped.heading);

  const header = read.sections.find((s) => s.role === 'header');
  const footer = read.sections.find((s) => s.role === 'footer');
  const ctx = { rec, t, booking: { placed: false }, h1: { used: false } };
  const mainSections = read.sections.filter((s) => s.role === 'hero' || s.role === 'content');
  for (const dropped of mainSections.slice(LIMITS.sections)) rec.omit('section', 'over_cap', dropped.intro.heading);
  const sections = mainSections
    .slice(0, LIMITS.sections)
    .map((s) => ({ read: s, planned: planSection(s, ctx) }))
    .filter(({ read: s, planned }) => {
      if (!isEmptySection(planned)) return true;
      // Recorded with what it held, e.g. the first of its dropped links
      const held = [...s.intro.links, ...s.items.flatMap((item) => item.links)][0]?.label;
      rec.omit('section', 'empty', held);
      return false;
    })
    .map(({ planned }) => planned);
  rec.summary.sections = sections.length;
  if (!ctx.h1.used) rec.fix('h1:hidden');
  if (!ctx.booking.placed) rec.fix('booking:appended');

  const businessName = label(input.businessName) ?? 'Business';
  // The footer never claims the booking slot (R2): a form there is an omitted second form
  const footerSection = footer ? planSection(footer, { ...ctx, booking: { placed: true }, h1: { used: true } }) : undefined;
  if (!footerSection) rec.fix('footer:added');

  // Header: logo, nav links that name a section on this page (the footer included), and the CTA label
  const logo =
    planImage(header?.images[0], businessName, rec, true) ??
    (isHttp(input.logoUrl) ? { src: input.logoUrl, alt: cut(businessName, 300), eager: true } : undefined);
  const nav: IRebuildPlan['header']['nav'] = [];
  const anchors = footerSection ? [...sections, footerSection] : sections;
  let ctaLabel: string | undefined;
  for (const link of header?.intro.links ?? []) {
    if (link.kind === 'cta' || (isHttp(link.href) && BOOKING_HOSTS.test(hostOf(link.href)))) {
      ctaLabel ??= label(link.label);
      continue;
    }
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
      headingFont: fontStack(read.typography?.heading.family),
      bodyFont: fontStack(read.typography?.body.family),
      headingWeight: scale.headingWeight,
      headingUppercase: scale.headingUppercase,
      h1Size: scale.h1Size,
      h2Size: scale.h2Size,
      bodySize: scale.bodySize,
      lineHeight: scale.lineHeight,
      buttonRadius: Math.min(999, Math.max(0, button?.radius ?? 6)),
      buttonUppercase: button?.uppercase ?? false,
    },
    header: {
      ...(logo ? { logo } : {}),
      nav,
      cta: { label: label(ctaLabel) ?? t.sendRequest },
      ...(phone ? { phone } : {}),
    },
    sections,
    bookingAppended: !ctx.booking.placed,
    bookingServices: read.sections
      .filter((s) => s.kind === 'services' || s.kind === 'pricing')
      .flatMap((s) => s.items.map((item) => item.title?.trim().slice(0, 60)).filter((title): title is string => Boolean(title)))
      .slice(0, LIMITS.items),
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
  };
}
