/**
 * The vision model's grouping of the page (REV-113), made safe: `checkGrouping` refuses any answer that
 * names an unknown piece, uses one twice or gives a section no heading; `assembleGroupedBlocks` copies
 * every piece from the page by id into the reader's raw blocks. The model never writes text: what it
 * answers is ids, a kind and an arrangement, and `readSiteSections` checks those against the content.
 */
import { OUTLINE_LIMITS, type SiteGroupingAnswer } from '@revamp/validation';
import type {
  RawBox,
  RawLeftOut,
  RawOutlinePiece,
  RawPageOutline,
  RawSiteBlock,
  RawSiteItem,
  RawSiteSections,
} from './site-sections.page.js';
import { readSiteSections, type SiteSectionsReading } from './site-sections.service.js';

/** Longest text piece that may be a section's heading */
const HEADING_MAX_CHARS = 120;
/** Padding read from the gap between sections is capped, px */
const MAX_PADDING = 120;

type Section = SiteGroupingAnswer['sections'][number];

const idsOf = (answer: SiteGroupingAnswer): number[] => [
  ...(answer.header?.logo !== undefined ? [answer.header.logo] : []),
  ...(answer.header?.pieces ?? []),
  ...answer.sections.flatMap((s) => [
    s.heading,
    ...(s.eyebrow !== undefined ? [s.eyebrow] : []),
    ...s.pieces,
    ...(s.items ?? []).flatMap((i) => [...(i.title !== undefined ? [i.title] : []), ...i.pieces]),
  ]),
  ...(answer.footer?.pieces ?? []),
];

const headingLike = (piece: RawOutlinePiece | undefined) =>
  piece !== undefined &&
  (piece.type === 'heading' ||
    (piece.type === 'text' && (piece.text?.length ?? 0) <= HEADING_MAX_CHARS));

/** Why the answer cannot be used; empty when every id exists, is used once, and every section has a heading */
export function checkGrouping(answer: SiteGroupingAnswer, outline: RawPageOutline): string[] {
  const byId = new Map(outline.pieces.map((p) => [p.id, p]));
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const id of idsOf(answer)) {
    if (!byId.has(id)) problems.push(`unknown id ${id}`);
    else if (seen.has(id)) problems.push(`piece ${id} used twice`);
    seen.add(id);
  }
  answer.sections.forEach((s, i) => {
    if (byId.has(s.heading) && !headingLike(byId.get(s.heading)))
      problems.push(`section ${i + 1}: heading ${s.heading} is not a heading`);
  });
  const logo = answer.header?.logo;
  if (logo !== undefined && byId.has(logo) && byId.get(logo)!.type !== 'image')
    problems.push(`logo ${logo} is not an image`);
  return Array.from(new Set(problems));
}

const ZERO: RawBox = { top: 0, left: 0, width: 0, height: 0 };
const drawn = (b: RawBox) => b.width > 0 && b.height > 0;
const union = (boxes: RawBox[]): RawBox | undefined => {
  const list = boxes.filter(drawn);
  if (!list.length) return undefined;
  const top = Math.min(...list.map((b) => b.top));
  const left = Math.min(...list.map((b) => b.left));
  return {
    top,
    left,
    width: Math.max(...list.map((b) => b.left + b.width)) - left,
    height: Math.max(...list.map((b) => b.top + b.height)) - top,
  };
};
const byPage = (a: RawOutlinePiece, b: RawOutlinePiece) => a.id - b.id;
const isCopy = (p: RawOutlinePiece) =>
  p.type === 'text' || p.type === 'list' || p.type === 'heading';
const linesOf = (p: RawOutlinePiece) =>
  p.type === 'list' ? (p.lines ?? []) : p.text ? [p.text] : [];
const area = (b: RawBox) => b.width * b.height;
const imagesOf = (pieces: RawOutlinePiece[]) =>
  pieces.filter((p) => p.type === 'image' && p.image).map((p) => p.image!);
const backgroundImageOf = (pieces: RawOutlinePiece[]) =>
  pieces.find((p) => p.type === 'background' && p.src)?.src;

/** The background behind most of the pieces' text */
function backgroundOf(pieces: RawOutlinePiece[]): string {
  const weight = new Map<string, number>();
  for (const p of pieces.filter(isCopy)) {
    const color = p.background ?? 'rgb(255, 255, 255)';
    weight.set(color, (weight.get(color) ?? 0) + linesOf(p).join(' ').length);
  }
  return Array.from(weight).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'rgb(255, 255, 255)';
}

function toItem(title: RawOutlinePiece | undefined, pieces: RawOutlinePiece[]): RawSiteItem {
  const sorted = [...pieces].sort(byPage);
  const image = imagesOf(sorted).sort((a, b) => area(b.box) - area(a.box))[0];
  const titleText = title ? linesOf(title).join(' ') : undefined;
  const backgroundImage = backgroundImageOf(sorted);
  return {
    ...(titleText ? { title: titleText } : {}),
    text: sorted.filter(isCopy).flatMap(linesOf),
    ...(image ? { image } : {}),
    ...(backgroundImage ? { backgroundImage } : {}),
    links: [...(title?.links ?? []), ...sorted.flatMap((p) => p.links ?? [])],
    icon: false,
    box: union([...(title ? [title.box] : []), ...sorted.map((p) => p.box)]) ?? ZERO,
  };
}

const MARKUP = new Set(['accordion', 'tabs', 'slider']);
const isPhoto = (p: RawOutlinePiece) =>
  (p.type === 'image' && p.image !== undefined) || (p.type === 'background' && p.src !== undefined);
type ItemPieces = { title?: RawOutlinePiece; pieces: RawOutlinePiece[] };

/**
 * Items the page itself names when the model gave none: a slider section gets one per slide number (the
 * outline's `slide` facts, the slide's first heading as its title; a thumbnail strip's slide N joins slide N),
 * a gallery one per photo. Undefined otherwise.
 */
function derivedItems(
  s: Section,
  heading: RawOutlinePiece,
  pieces: RawOutlinePiece[],
): { items: ItemPieces[]; rest: RawOutlinePiece[]; headingUsed: boolean } | undefined {
  if (s.items?.length) return undefined;
  if (s.arrangement === 'slider') {
    const slides = new Map<string, RawOutlinePiece[]>();
    for (const p of [heading, ...pieces].sort(byPage)) {
      if (!p.slide) continue;
      const key = String(p.slide.index);
      slides.set(key, [...(slides.get(key) ?? []), p]);
    }
    if (slides.size < 2) return undefined;
    const items = Array.from(slides)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, group]) => {
        const title = group.find((p) => p.type === 'heading');
        return { ...(title ? { title } : {}), pieces: group.filter((p) => p !== title) };
      });
    return {
      items,
      rest: pieces.filter((p) => !p.slide),
      headingUsed: heading.slide !== undefined,
    };
  }
  if (s.arrangement === 'gallery') {
    const photos = pieces.filter(isPhoto);
    if (photos.length < 2) return undefined;
    return {
      items: photos.map((p) => ({ pieces: [p] })),
      rest: pieces.filter((p) => !isPhoto(p)),
      headingUsed: false,
    };
  }
  return undefined;
}

function sectionBlock(
  s: Section,
  get: (id: number) => RawOutlinePiece,
  viewportWidth: number,
): RawSiteBlock {
  const heading = get(s.heading);
  const eyebrow = s.eyebrow !== undefined ? get(s.eyebrow) : undefined;
  const answered = s.pieces.map(get).sort(byPage);
  const derived = derivedItems(s, heading, answered);
  const pieces = derived?.rest ?? answered;
  const items: ItemPieces[] =
    derived?.items ??
    (s.items ?? []).map((i) => ({
      ...(i.title !== undefined ? { title: get(i.title) } : {}),
      pieces: i.pieces.map(get),
    }));
  const ownHeading = derived?.headingUsed ? undefined : heading;
  // Items the page names (slides, photos) sit beside the intro, not after it
  const firstItem = derived
    ? Infinity
    : Math.min(
        Infinity,
        ...items.flatMap((i) => [...(i.title ? [i.title.id] : []), ...i.pieces.map((p) => p.id)]),
      );
  const intro = pieces.filter((p) => isCopy(p) && p.id < firstItem);
  const after = pieces.filter((p) => isCopy(p) && p.id > firstItem);
  const all = [
    heading,
    ...(eyebrow ? [eyebrow] : []),
    ...pieces,
    ...items.flatMap((i) => [...(i.title ? [i.title] : []), ...i.pieces]),
  ];
  // Slides waiting off the canvas are not part of the section's drawn area
  const onCanvas = (b: RawBox) => b.left + b.width > 0 && b.left < viewportWidth;
  const box = union(all.map((p) => p.box).filter(onCanvas)) ?? ZERO;
  const introBox = union(
    [
      ...(ownHeading ? [ownHeading.box] : []),
      ...(eyebrow ? [eyebrow.box] : []),
      ...intro.map((p) => p.box),
    ].filter(onCanvas),
  );
  const backgroundImage = backgroundImageOf(pieces);
  return {
    role: 'content',
    box,
    ...(introBox ? { introBox } : {}),
    contentBox: box,
    intro: {
      ...(eyebrow ? { eyebrow: linesOf(eyebrow).join(' ') } : {}),
      ...(ownHeading
        ? { heading: linesOf(ownHeading).join(' '), headingLevel: ownHeading.level ?? 2 }
        : {}),
      text: intro.flatMap(linesOf),
      links: [...(ownHeading?.links ?? []), ...pieces.flatMap((p) => p.links ?? [])],
    },
    ...(items.length
      ? {
          group: {
            ...(MARKUP.has(s.arrangement)
              ? { markup: s.arrangement as 'accordion' | 'tabs' | 'slider' }
              : {}),
            items: items.map((i) => toItem(i.title, i.pieces)),
          },
        }
      : {}),
    extra: after.length ? [{ type: 'text', text: after.flatMap(linesOf) }] : [],
    images: imagesOf(pieces),
    ...(backgroundImage ? { backgroundImage } : {}),
    embeds: pieces.filter((p) => p.type === 'embed' && p.embed).map((p) => p.embed!),
    style: {
      background: backgroundOf(all),
      color: heading.font?.color ?? 'rgb(0, 0, 0)',
      textAlign: heading.align ?? 'left',
      paddingTop: 0,
      paddingBottom: 0,
    },
    hint: { kind: s.kind, arrangement: s.arrangement },
  };
}

function chromeBlock(
  role: 'header' | 'footer',
  pieces: RawOutlinePiece[],
  logo?: RawOutlinePiece,
): RawSiteBlock {
  const sorted = [...pieces].sort(byPage);
  const box = union([...(logo ? [logo.box] : []), ...sorted.map((p) => p.box)]) ?? ZERO;
  const text = sorted.filter(isCopy).flatMap(linesOf);
  return {
    role,
    box,
    contentBox: box,
    intro: { text: [], links: sorted.flatMap((p) => p.links ?? []) },
    extra: text.length ? [{ type: 'text', text }] : [],
    images: [...(logo?.image ? [logo.image] : []), ...imagesOf(sorted)],
    embeds: sorted.filter((p) => p.type === 'embed' && p.embed).map((p) => p.embed!),
    style: {
      background: backgroundOf(sorted),
      color: sorted.find(isCopy)?.font?.color ?? 'rgb(0, 0, 0)',
      textAlign: 'left',
      paddingTop: 0,
      paddingBottom: 0,
    },
  };
}

/** The answer as the reader's raw blocks: every word, link and image copied from the page by id */
export function assembleGroupedBlocks(
  raw: RawSiteSections,
  outline: RawPageOutline,
  answer: SiteGroupingAnswer,
): RawSiteSections {
  const byId = new Map(outline.pieces.map((p) => [p.id, p]));
  const get = (id: number) => byId.get(id)!;
  const firstId = (s: Section) =>
    Math.min(s.heading, ...s.pieces, ...(s.eyebrow !== undefined ? [s.eyebrow] : []));
  const sections = [...answer.sections].sort((a, b) => firstId(a) - firstId(b));
  const blocks = sections.map((s) => sectionBlock(s, get, raw.viewportWidth));
  // Padding: half the gap to the neighbouring sections, capped
  const gap = (a: RawBox | undefined, z: RawBox | undefined) =>
    a && z && drawn(a) && drawn(z) ? Math.max(0, z.top - (a.top + a.height)) : 0;
  blocks.forEach((b, i) => {
    b.style.paddingTop = Math.min(MAX_PADDING, Math.round(gap(blocks[i - 1]?.box, b.box) / 2));
    b.style.paddingBottom = Math.min(MAX_PADDING, Math.round(gap(b.box, blocks[i + 1]?.box) / 2));
  });
  const header = answer.header
    ? chromeBlock(
        'header',
        answer.header.pieces.map(get),
        answer.header.logo !== undefined ? get(answer.header.logo) : undefined,
      )
    : undefined;
  const footer = answer.footer ? chromeBlock('footer', answer.footer.pieces.map(get)) : undefined;

  // Left-out runs, placed before the first section that starts after them (positions count the header)
  const used = new Set(idsOf(answer));
  const starts = sections.map(firstId);
  const offset = header ? 1 : 0;
  const leftOut: RawLeftOut[] = [];
  let run: RawOutlinePiece[] = [];
  const close = () => {
    if (!run.length) return;
    // A left-out menu is named by its labels
    const text = run
      .flatMap((p) => (p.type === 'links' ? (p.links ?? []).map((l) => l.label) : linesOf(p)))
      .join(' ');
    const at = starts.findIndex((start) => start > run[0]!.id);
    if (text) leftOut.push({ index: offset + (at < 0 ? blocks.length : at), text });
    run = [];
  };
  for (const piece of outline.pieces) {
    if (used.has(piece.id)) close();
    else run.push(piece);
  }
  close();

  return { ...raw, header, blocks, footer, uncaptured: [], leftOut };
}

/** The model's grouping read like the rules reading, or why it cannot be */
export function readGroupedSections(
  raw: RawSiteSections,
  answer: SiteGroupingAnswer,
): SiteSectionsReading {
  const outline = raw.outline;
  if (!outline) return { error: 'No page outline' };
  const problems = checkGrouping(answer, outline);
  if (problems.length)
    return { error: `Invalid grouping: ${problems.slice(0, 5).join('; ')}`.slice(0, 300) };
  return readSiteSections(assembleGroupedBlocks(raw, outline, answer), [], 'llm');
}

const quote = (s: string) => JSON.stringify(s);
const preview = (s: string) =>
  s.length > OUTLINE_LIMITS.previewChars
    ? `${s.slice(0, OUTLINE_LIMITS.previewChars)}… (${s.length} chars)`
    : s;
const where = (b: RawBox, size = true) =>
  `y=${b.top} x=${b.left}${size ? ` w=${b.width} h=${b.height}` : ''}`;

/** The outline as the model reads it: one line per piece, its facts, and a preview of its text */
export function outlinePrompt(
  outline: RawPageOutline,
  tiles: { top: number; bottom: number }[],
): string {
  const lines = outline.pieces.map((p) => {
    const facts = `${p.hidden ? ' hidden' : ''}${p.slide ? ` slide=${p.slide.slider}.${p.slide.index}` : ''}`;
    switch (p.type) {
      case 'heading':
        return `${p.id} heading ${p.level ? `h${p.level}` : 'styled'} ${p.font?.size ?? 0}px${(p.font?.weight ?? 400) >= 600 ? ' b' : ''} ${quote(preview(p.text ?? ''))} ${where(p.box)}${facts}`;
      case 'text':
        return `${p.id} text ${p.font?.size ?? 0}px ${quote(preview(p.text ?? ''))} ${where(p.box)}${facts}`;
      case 'list':
        return `${p.id} list ${quote(preview((p.lines ?? []).join(' | ')))} ${where(p.box)}${facts}`;
      case 'links':
        return `${p.id} links ${JSON.stringify((p.links ?? []).map((l) => l.label.slice(0, 40)))} ${where(p.box)}${facts}`;
      case 'image':
        return `${p.id} image ${p.image?.box.width ?? 0}x${p.image?.box.height ?? 0} alt=${quote((p.image?.alt ?? '').slice(0, 60))} ${where(p.box, false)}${facts}`;
      case 'background':
        return `${p.id} background ${p.box.width}x${p.box.height} ${where(p.box, false)}${facts}`;
      case 'embed':
        return `${p.id} embed ${p.embed?.kind ?? 'widget'} ${where(p.box)}${facts}`;
    }
  });
  return [
    `Page height: ${outline.pageHeight}px, body text ${outline.bodySize}px${outline.truncated ? ', outline truncated' : ''}.`,
    'Screenshots (desktop, 1440px wide, in page order):',
    ...tiles.map((t, i) => `tile ${i + 1}: y ${t.top}–${t.bottom}`),
    '',
    'Pieces (id type facts "text" position):',
    ...lines,
  ].join('\n');
}
