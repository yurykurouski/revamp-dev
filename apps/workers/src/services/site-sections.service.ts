/**
 * Node half of the site section reader (REV-109): turns the raw DOM facts `collectSiteSectionsInPage`
 * reports into validated `ISiteSections`. Cleans the text, attaches stray text to the nearer section,
 * skips noise, empty, duplicate and over-cap blocks with a reason, names each section's arrangement,
 * kind and style, and measures how much of the page's text the sections hold. No LLM at any step.
 */
import type { SiteImageShape, SiteLinkKind, SiteSectionArrangement, SiteSectionKind } from '@revamp/shared-types';
import { WHY_US_WORDS } from './site-layout.service.js';
import type { RawItemGroup, RawSiteBlock, RawSiteItem, RawSiteLink } from './site-sections.page.js';

export const cleanText = (value: string | undefined): string =>
  (value ?? '').replace(/­/g, '').replace(/\s+/g, ' ').trim();

/** A computed color as hex; see-through colors (alpha below 0.5) count as unset */
export function toHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const match = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/);
  if (!match) return undefined;
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : Number(alphaRaw);
  if (alpha < 0.5) return undefined;
  const channel = (value: string | undefined) =>
    Math.max(0, Math.min(255, Math.round(Number(value)))).toString(16).padStart(2, '0');
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

const MAP_LINK = /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap\.org|mapy\.cz|yandex\.[a-z]+\/maps|maps\.apple\.com/i;

export function linkKind(link: RawSiteLink): SiteLinkKind {
  if (/^tel:/i.test(link.href)) return 'phone';
  if (/^mailto:/i.test(link.href)) return 'email';
  if (MAP_LINK.test(link.href)) return 'map';
  return link.button ? 'cta' : 'link';
}

export function imageShape(width: number, height: number, radius: number): SiteImageShape | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  // Half the width, with a pixel of slack for sub-pixel layout
  if (radius >= width / 2 - 1) return 'round';
  const ratio = width / height;
  if (ratio >= 1.3) return 'wide';
  if (ratio <= 0.77) return 'tall';
  return 'square';
}

/** Items whose tops are this close sit in one row, px */
export const ROW_TOLERANCE = 8;

export function columnsOf(items: RawSiteItem[]): number {
  const first = items[0];
  if (!first) return 0;
  return items.filter((i) => Math.abs(i.box.top - first.box.top) <= ROW_TOLERANCE).length;
}

const ARRANGED_BY_MARKUP = new Set<string>(['accordion', 'tabs', 'slider']);

export function groupArrangement(group: RawItemGroup): SiteSectionArrangement {
  if (group.markup && ARRANGED_BY_MARKUP.has(group.markup)) return group.markup as SiteSectionArrangement;
  if (group.items.length > 0 && group.items.every((i) => i.image && !i.title && i.text.length === 0)) return 'gallery';
  return columnsOf(group.items) >= 2 ? 'card-grid' : 'list';
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const area = (b: { width: number; height: number }) => b.width * b.height;

/**
 * How the section lays out its content, first rule that matches (spec §5.3): markup, an embed that
 * takes up the section, image-only items, items in a row or stacked, a large image beside the text,
 * a photo behind the copy, else plain text.
 */
export function arrangementOf(block: RawSiteBlock): {
  arrangement: SiteSectionArrangement;
  columns?: number;
  mediaSide?: 'left' | 'right';
  split?: number;
} {
  const group = block.group;
  if (group?.markup && ARRANGED_BY_MARKUP.has(group.markup)) return { arrangement: group.markup as SiteSectionArrangement };

  const sectionArea = area(block.box);
  const embedArea = block.embeds.reduce((sum, e) => sum + area(e.box), 0);
  if (sectionArea > 0 && embedArea > sectionArea / 2) return { arrangement: 'embed' };

  if (group && group.items.length >= 2) {
    const arrangement = groupArrangement(group);
    return arrangement === 'card-grid' ? { arrangement, columns: columnsOf(group.items) } : { arrangement };
  }

  const media = [...block.images].sort((a, b) => area(b.box) - area(a.box))[0];
  const text = block.introBox;
  if (media && text && media.box.width >= block.box.width / 4) {
    const m = media.box;
    const vertical = overlap(m.top, m.top + m.height, text.top, text.top + text.height);
    const horizontal = overlap(m.left, m.left + m.width, text.left, text.left + text.width);
    if (vertical >= Math.min(m.height, text.height) / 2 && horizontal <= Math.min(m.width, text.width) / 10) {
      return {
        arrangement: 'media-beside-text',
        mediaSide: m.left + m.width / 2 < text.left + text.width / 2 ? 'left' : 'right',
        split: Math.round((m.width / (m.width + text.width)) * 100) / 100,
      };
    }
  }

  const coversSection = media !== undefined && sectionArea > 0 && area(media.box) >= sectionArea * 0.6;
  const copyOnMedia =
    media !== undefined &&
    text !== undefined &&
    text.top >= media.box.top &&
    text.top + text.height <= media.box.top + media.box.height &&
    text.left >= media.box.left &&
    text.left + text.width <= media.box.left + media.box.width;
  if (block.backgroundImage || (coversSection && copyOnMedia)) return { arrangement: 'banner' };
  return { arrangement: 'text' };
}

/** What the items say the section is; wins over the heading (spec §5.4) */
export function kindFromItems(block: RawSiteBlock): SiteSectionKind | undefined {
  const items = block.group?.items ?? [];
  const portrait = (i: RawSiteItem) => {
    const b = i.image?.box;
    return b !== undefined && b.width > 0 && b.height / b.width >= 0.8 && b.height / b.width <= 1.6;
  };
  const textLength = (i: RawSiteItem) => i.text.join(' ').length;
  if (
    (block.group?.markup === 'person' && items.length >= 2) ||
    (items.length >= 3 &&
      items.every((i) => portrait(i) && i.title && i.title.length <= 60 && i.subtitle && i.subtitle.length <= 80 && textLength(i) <= 600))
  ) {
    return 'team';
  }
  if (items.length >= 2 && items.every((i) => i.title) && items.filter((i) => i.title!.trim().endsWith('?')).length >= items.length / 2) {
    return 'faq';
  }
  const heading = (block.intro.heading ?? '').toLowerCase();
  if (items.length >= 2 && WHY_US_WORDS.test(heading) && items.every((i) => i.title && textLength(i) <= 400)) return 'features';
  return undefined;
}

/** Consent and legal boilerplate: removed line by line, always recorded in `skipped` */
export const NOISE_LINE =
  /\b(cookies?|ciasteczk\w*|rodo|gdpr)\b|polityk\S* prywatności|privacy policy|all rights reserved|wszelkie prawa zastrzeżone|все права защищены|усе правы абаронены|всі права захищені|visos teisės saugomos|alle rechte vorbehalten|administratorem (twoich |pani\/pana )?danych/i;
