/**
 * Node half of the site section reader (REV-109): turns the raw DOM facts `collectSiteSectionsInPage`
 * reports into validated `ISiteSections`. Cleans the text, attaches stray text to the nearer section,
 * skips noise, empty, duplicate and over-cap blocks with a reason, names each section's arrangement,
 * kind and style, and measures how much of the page's text the sections hold. No LLM at any step.
 */
import type {
  ISiteImage,
  ISiteLink,
  ISiteSection,
  ISiteSectionItem,
  ISiteSections,
  ISiteTypography,
  SiteImageShape,
  SiteLinkKind,
  SiteSectionArrangement,
  SiteSectionKind,
} from '@revamp/shared-types';
import { SITE_SECTIONS_LIMITS, SiteSectionsSchema, siteSectionChars } from '@revamp/validation';
import { classifyBlock, WHY_US_WORDS, type RawLayoutBlock } from './site-layout.service.js';
import type { RawItemGroup, RawSiteBlock, RawSiteImage, RawSiteItem, RawSiteLink, RawSiteSections, RawTextRun, RawTypography } from './site-sections.page.js';

export const cleanText = (value: string | undefined): string =>
  (value ?? '').replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();

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

/** Most columns a card grid is stored with (`SiteSectionSchema.columns`) */
const MAX_COLUMNS = 12;

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
    // The schema stores at most 12 columns; a longer row is still one row of cards
    return arrangement === 'card-grid' ? { arrangement, columns: Math.min(MAX_COLUMNS, columnsOf(group.items)) } : { arrangement };
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

const L = SITE_SECTIONS_LIMITS;
type Cut = { truncated: boolean };

const cut = (value: string | undefined, max: number, flag: Cut): string | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;
  if (text.length <= max) return text;
  flag.truncated = true;
  return text.slice(0, max);
};

const cutList = <T>(list: T[], max: number, flag: Cut): T[] => {
  if (list.length <= max) return list;
  flag.truncated = true;
  return list.slice(0, max);
};

const texts = (lines: string[], flag: Cut): string[] =>
  cutList(lines.map((line) => cut(line, L.textChars, flag)).filter((line): line is string => line !== undefined), L.textsPerArray, flag);

const STORABLE_HREF = /^(https?:|tel:|mailto:|sms:)/i;

/** Kept links whose label came from aria-label or title: stored, but not page text for the coverage */
const attributeLabels = new WeakSet<ISiteLink>();

const toLinks = (links: RawSiteLink[], flag: Cut): ISiteLink[] => {
  const seen = new Set<string>();
  const kept: ISiteLink[] = [];
  for (const link of links) {
    const label = cut(link.label, L.labelChars, flag);
    const href = link.href.trim();
    const key = `${label}\n${href}`;
    if (!label || !STORABLE_HREF.test(href) || href.length > L.urlChars || seen.has(key)) continue;
    seen.add(key);
    const stored = { label, href, kind: linkKind(link) };
    if (link.labelFromAttribute) attributeLabels.add(stored);
    kept.push(stored);
  }
  return cutList(kept, L.links, flag);
};

const storableUrl = (url: string | undefined) => (url && /^https?:\/\//i.test(url) && url.length <= L.urlChars ? url : undefined);

const toImage = (image: RawSiteImage | undefined): ISiteImage | undefined => {
  const src = storableUrl(image?.src);
  if (!image || !src) return undefined;
  const alt = cleanText(image.alt).slice(0, L.labelChars);
  return {
    src,
    ...(alt ? { alt } : {}),
    ...(image.box.width > 0 && image.box.height > 0 ? { width: Math.round(image.box.width), height: Math.round(image.box.height) } : {}),
  };
};

const toItem = (item: RawSiteItem, flag: Cut): ISiteSectionItem => {
  const price = cut(item.price, L.labelChars, flag);
  return {
    title: cut(item.title, L.labelChars, flag),
    subtitle: cut(item.subtitle, L.labelChars, flag),
    // A line that is only the price is the price, not text
    text: texts(item.text.filter((line) => cleanText(line) !== price), flag),
    image: toImage(item.image),
    backgroundImage: storableUrl(item.backgroundImage),
    price,
    rating: item.rating !== undefined && item.rating >= 0 && item.rating <= 5 ? Math.round(item.rating * 10) / 10 : undefined,
    links: toLinks(item.links, flag),
  };
};

const alignOf = (textAlign: string): 'left' | 'center' => (/center/.test(textAlign) ? 'center' : 'left');

/** Characters of text a section holds, as the coverage counts them; aria-label and title labels are not page text */
const sectionChars = (section: ISiteSection): number => siteSectionChars(section, (link) => attributeLabels.has(link));

/** All the section's text in order, for duplicate detection and samples */
function sectionText(section: ISiteSection): string {
  const labels = (links: ISiteLink[]) => links.map((link) => link.label);
  const itemText = (i: ISiteSectionItem) => [i.title, i.subtitle, ...i.text, i.price, ...labels(i.links)].filter(Boolean).join('\n');
  return [
    section.intro.eyebrow,
    section.intro.heading,
    ...section.intro.text,
    // A header of nav links alone is not empty
    ...labels(section.intro.links),
    ...section.items.map(itemText),
    ...section.extra.map((e) => (e.type === 'text' ? e.text.join('\n') : e.items.map(itemText).join('\n'))),
  ]
    .filter(Boolean)
    .join('\n');
}

type Attached = { before: Map<number, string[]>; after: Map<number, string[]>; unplaced: string[] };

/**
 * Text outside every section goes to the nearer section when it sits between sections; text that
 * sits level with a section (beside it, or floating over it) cannot be placed and stays uncaptured.
 */
function attachRuns(ordered: RawSiteBlock[], runs: RawTextRun[]): Attached {
  const attached: Attached = { before: new Map(), after: new Map(), unplaced: [] };
  for (const run of runs) {
    const text = cleanText(run.text);
    if (!text) continue;
    const level = ordered.some((b) => run.top >= b.box.top && run.top < b.box.top + b.box.height);
    if (level || ordered.length === 0) {
      attached.unplaced.push(text);
      continue;
    }
    let nearest = 0;
    let nearestDistance = Infinity;
    ordered.forEach((b, i) => {
      const distance = run.top < b.box.top ? b.box.top - run.top : run.top - (b.box.top + b.box.height);
      if (distance < nearestDistance) {
        nearest = i;
        nearestDistance = distance;
      }
    });
    const side = run.top < ordered[nearest]!.box.top ? attached.before : attached.after;
    side.set(nearest, [...(side.get(nearest) ?? []), text]);
  }
  return attached;
}

function toSection(
  block: RawSiteBlock,
  index: number,
  raw: RawSiteSections,
  layoutBlocks: RawLayoutBlock[],
  attached: Attached,
  bandHeading?: string,
): { section: ISiteSection; noise: string[] } {
  const flag: Cut = { truncated: false };
  const noise: string[] = [];
  const keep = (lines: string[]) =>
    lines.map(cleanText).filter((line) => {
      if (!line) return false;
      if (NOISE_LINE.test(line)) {
        noise.push(line);
        return false;
      }
      return true;
    });

  const extra: ISiteSection['extra'] = [];
  const pushText = (lines: string[]) => {
    const kept = texts(keep(lines), flag);
    if (kept.length) extra.push({ type: 'text', text: kept });
  };
  pushText(attached.before.get(index) ?? []);
  for (const entry of block.extra) {
    if (entry.type === 'text') pushText(entry.text);
    else {
      const items = cutList(entry.group.items.map((i) => toItem(i, flag)), L.items, flag);
      if (items.length) extra.push({ type: 'items', arrangement: groupArrangement(entry.group), items });
    }
  }
  pushText(attached.after.get(index) ?? []);

  const introLinks = toLinks(block.intro.links, flag);
  const role: ISiteSection['role'] =
    block.role !== 'content' ? block.role : block === raw.blocks[0] && block.box.top < raw.viewportHeight ? 'hero' : 'content';
  const layoutBlock = block.block !== undefined ? layoutBlocks[block.block] : undefined;
  let kind: SiteSectionKind;
  if (block.role === 'header') kind = 'other';
  else if (block.role === 'footer') kind = introLinks.some((l) => l.kind !== 'link' && l.kind !== 'cta') ? 'contact' : 'other';
  else {
    // A block without a heading of its own, right after a heading band, is named by that band's heading
    const heading = cleanText(block.intro.heading) ? undefined : bandHeading;
    const named = heading ? { ...block, intro: { ...block.intro, heading } } : block;
    kind = kindFromItems(named) ?? (layoutBlock ? classifyBlock(heading ? { ...layoutBlock, heading } : layoutBlock) : 'other');
  }

  const arrangement = arrangementOf(block);
  const items = block.group ? cutList(block.group.items.map((i) => toItem(i, flag)), L.items, flag) : [];
  const firstImage = block.group?.items.find((i) => i.image)?.image;
  const itemStyle = block.itemStyle
    ? {
        background: toHex(block.itemStyle.background),
        // A pill (9999px) is stored at the schema's limit
        radius: Math.min(1000, Math.max(0, Math.round(block.itemStyle.radius))),
        border: block.itemStyle.borderWidth >= 1,
        shadow: Boolean(block.itemStyle.boxShadow) && block.itemStyle.boxShadow !== 'none',
        imageShape: firstImage ? imageShape(firstImage.box.width, firstImage.box.height, firstImage.radius) : undefined,
        align: alignOf(block.itemStyle.textAlign),
      }
    : undefined;

  const section: ISiteSection = {
    index,
    role,
    kind,
    arrangement: arrangement.arrangement,
    columns: arrangement.columns,
    mediaSide: arrangement.mediaSide,
    intro: {
      eyebrow: cut(block.intro.eyebrow, L.labelChars, flag),
      heading: cut(block.intro.heading, L.labelChars, flag),
      headingLevel: block.intro.headingLevel,
      text: texts(keep(block.intro.text), flag),
      links: introLinks,
    },
    items,
    itemStyle,
    extra: cutList(extra, L.extra, flag),
    images: cutList(block.images.map(toImage).filter((i): i is ISiteImage => i !== undefined), L.images, flag),
    embeds: cutList(block.embeds.map((e) => ({ kind: e.kind, src: storableUrl(e.src) })), L.embeds, flag),
    style: {
      background: toHex(block.style.background),
      backgroundImage: storableUrl(block.backgroundImage),
      textColor: toHex(block.style.color),
      align: alignOf(block.style.textAlign),
      paddingY: Math.min(2000, Math.max(0, Math.round((block.style.paddingTop + block.style.paddingBottom) / 2))),
      fullBleed: block.contentBox ? block.contentBox.width >= raw.viewportWidth * 0.9 : undefined,
      split: arrangement.split,
    },
    truncated: undefined,
  };
  if (flag.truncated) section.truncated = true;
  return { section, noise };
}

export function toTypography(raw: RawTypography | undefined): ISiteTypography | undefined {
  if (!raw?.heading || !raw.body) return undefined;
  const family = (value: string) => cleanText(value.split(',')[0]?.replace(/["']/g, '')).slice(0, 100) || 'sans-serif';
  const clampInt = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
  const { heading, body, button } = raw;
  const ratio =
    body.lineHeight.endsWith('px') && body.size > 0 ? Math.round((parseFloat(body.lineHeight) / body.size) * 100) / 100 : undefined;
  // Outside 0.5..5 it is a centring trick, not a reading line height: left out rather than failing the reading
  const lineHeight = ratio !== undefined && ratio >= 0.5 && ratio <= 5 ? ratio : undefined;
  return {
    heading: { family: family(heading.family), size: clampInt(heading.size, 1, 200), weight: clampInt(heading.weight, 100, 1000), uppercase: heading.transform === 'uppercase', color: toHex(heading.color) },
    body: { family: family(body.family), size: clampInt(body.size, 1, 200), weight: clampInt(body.weight, 100, 1000), lineHeight, color: toHex(body.color) },
    button: button
      ? { radius: clampInt(button.radius, 0, 1000), filled: toHex(button.background) !== undefined, uppercase: button.transform === 'uppercase', background: toHex(button.background), color: toHex(button.color) }
      : undefined,
  };
}

export type SiteSectionsReading = { sections: ISiteSections; error?: undefined } | { sections?: undefined; error: string };

/**
 * Turns the raw DOM facts into the page's sections, or says why they don't describe any. Every block
 * becomes a section or a `skipped` entry with its reason; nothing is dropped silently.
 */
export function readSiteSections(raw: RawSiteSections | undefined, layoutBlocks: RawLayoutBlock[] = []): SiteSectionsReading {
  if (!raw || !Array.isArray(raw.blocks) || !(raw.viewportWidth > 0)) {
    return { error: 'The page sections could not be collected' };
  }
  const ordered = [...(raw.header ? [raw.header] : []), ...raw.blocks, ...(raw.footer ? [raw.footer] : [])];
  const attached = attachRuns(ordered, raw.uncaptured ?? []);
  const sections: ISiteSection[] = [];
  const skipped: ISiteSections['skipped'] = [];
  const seen = new Set<string>();
  let captured = 0;
  let total = 0;

  /** A kept section that is only a heading (a title band), whose heading names the block after it */
  const bandHeadingOf = (section: ISiteSection | undefined, index: number): string | undefined =>
    section &&
    section.role !== 'header' &&
    section.index === index - 1 &&
    section.items.length === 0 &&
    section.extra.length === 0 &&
    section.intro.text.join(' ').length <= 80
      ? section.intro.heading
      : undefined;

  ordered.forEach((block, index) => {
    const { section, noise } = toSection(block, index, raw, layoutBlocks, attached, bandHeadingOf(sections[sections.length - 1], index));
    const heading = section.intro.heading;
    const skip = (reason: ISiteSections['skipped'][number]['reason'], sample: string, chars: number) => {
      if (skipped.length < L.skipped) skipped.push({ index, reason, ...(heading ? { heading } : {}), sample: sample.slice(0, L.sampleChars) });
      captured += chars;
    };
    const text = sectionText(section);
    const chars = sectionChars(section);
    const noiseText = noise.join(' ');
    const hasMedia = section.images.length > 0 || section.embeds.length > 0 || section.style.backgroundImage !== undefined;
    if (!text && !hasMedia) {
      if (noise.length) skip('noise', noiseText, noiseText.length);
      else skip('empty', '', 0);
      return;
    }
    if (noise.length) skip('noise', noiseText, noiseText.length);
    if (text && seen.has(text)) return skip('duplicate', text, chars);
    if (text) seen.add(text);
    if (sections.length >= L.sections || total + chars > L.totalChars) return skip('cap', text, chars);
    sections.push(section);
    total += chars;
    captured += chars;
  });

  if (!sections.some((s) => s.role === 'hero' || s.role === 'content')) {
    return { error: `No content sections on the page (${skipped.length} skipped)` };
  }

  const pageChars = Math.max(0, Math.round(raw.pageChars));
  const result: ISiteSections = {
    sections,
    typography: toTypography(raw.typography),
    skipped,
    coverage: {
      pageChars,
      capturedChars: captured,
      ratio: pageChars > 0 ? Math.min(1, Math.round((captured / pageChars) * 1000) / 1000) : 0,
      uncaptured: attached.unplaced.slice(0, L.uncaptured).map((t) => t.slice(0, L.sampleChars)),
    },
  };
  // JSON drops the unset optional fields, which MongoDB would otherwise store as null
  const parsed = SiteSectionsSchema.safeParse(JSON.parse(JSON.stringify(result)));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `The sections failed validation at ${issue?.path.join('.')}: ${issue?.message}`.slice(0, 300) };
  }
  return { sections: parsed.data };
}
