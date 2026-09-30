import type { IRebuildBlock, IRebuildImage, IRebuildItem, IRebuildLink, IRebuildSection } from '@revamp/shared-types';
import type { MvpStrings } from '../mvp-locale.js';
import { escapeHtml } from '../html.js';

// One renderer per arrangement (REV-110). Every value comes from the validated plan and is escaped.

export interface RenderCtx {
  t: MvpStrings;
  /** The booking form section, rendered once where the plan places it */
  bookingHtml: string;
  /** Set once the form is on the page, so `id="booking"` is never emitted twice */
  booking: { placed: boolean };
}

export const img = (image: IRebuildImage | undefined, className = ''): string =>
  image
    ? `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"${className ? ` class="${className}"` : ''}` +
      `${image.width ? ` width="${image.width}"` : ''}${image.height ? ` height="${image.height}"` : ''}` +
      `${image.eager ? '' : ' loading="lazy"'} decoding="async">`
    : '';

export const link = (l: IRebuildLink): string =>
  `<a class="${l.kind === 'booking' ? 'rb-cta' : 'rb-link'}" href="${escapeHtml(l.href)}"${l.kind === 'map' ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(l.label)}</a>`;

const links = (list: IRebuildLink[]) => (list.length ? `<div class="rb-links">${list.map(link).join('')}</div>` : '');
const paragraphs = (text: string[]) => text.map((p) => `<p>${escapeHtml(p)}</p>`).join('');

/**
 * A URL inside CSS `url('…')` in a style attribute: characters that could end the string, the function or the
 * attribute are percent-encoded; `&` stays and is written as `&amp;` by the caller
 */
export const cssUrl = (url: string): string =>
  url.replace(/['"()<>\\\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

const stars = (rating: number) => {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return `<div class="rb-rating" role="img" aria-label="${rating}/5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</div>`;
};

export function renderItem(item: IRebuildItem, level: 3 | 4 = 3): string {
  const subtitle = item.subtitle ? `<p class="rb-item-subtitle">${escapeHtml(item.subtitle)}</p>` : '';
  return `<article class="rb-item">${img(item.image, 'rb-item-image')}<div class="rb-item-body">${item.title ? '' : subtitle}${
    item.title ? `<h${level} class="rb-item-title">${escapeHtml(item.title)}</h${level}>${subtitle}` : ''
  }${item.price ? `<p class="rb-price">${escapeHtml(item.price)}</p>` : ''}${item.rating !== undefined ? stars(item.rating) : ''}${paragraphs(item.text)}${links(item.links)}</div></article>`;
}

/** A photo slide: the caption in the page's container, over the slide's own photo and the overlay */
const photoSlide = (i: IRebuildItem) => {
  const { backgroundImage, ...caption } = i;
  const style = backgroundImage ? ` style="--rb-slide-image: url('${cssUrl(backgroundImage).replace(/&/g, '&amp;')}')"` : '';
  return `<div class="rb-slide rb-photo-slide"${style}><div class="rb-container">${renderItem(caption)}</div></div>`;
};

function renderSlider(items: IRebuildItem[], ctx: RenderCtx, label: string, photo = false): string {
  // The buttons only work with the page script, which un-hides them; without it the track is a plain scroller
  const controls =
    items.length > 1
      ? `<div class="rb-slider-controls" hidden><button type="button" data-slide-step="-1" aria-label="${escapeHtml(ctx.t.previousSlide)}">‹</button><button type="button" data-slide-step="1" aria-label="${escapeHtml(ctx.t.nextSlide)}">›</button></div>`
      : '';
  const slides = items.map((i) => (photo ? photoSlide(i) : `<div class="rb-slide">${renderItem(i)}</div>`)).join('');
  return `<div class="rb-slider"><div class="rb-track" tabindex="0" role="region" aria-label="${escapeHtml(label)}">${slides}</div>${controls}</div>`;
}

/** A gallery keeps each item's caption; an item without a picture is rendered whole so no copy is lost */
const galleryItem = (i: IRebuildItem) =>
  i.image
    ? `<figure class="rb-figure">${img(i.image)}${i.title ? `<figcaption>${escapeHtml(i.title)}</figcaption>` : ''}${
        i.subtitle || i.text.length || i.links.length || i.price || i.rating !== undefined ? renderItem({ ...i, image: undefined, title: undefined }) : ''
      }</figure>`
    : renderItem(i);

interface ItemGroup {
  /** Prefix for the ids a group needs (tabs) */
  id: string;
  /** Accessible name of a group that needs one (the slider track): the section heading, else a generic label */
  label: string;
  columns?: number;
  /** Photo slides (a hero slider of photos) */
  photo?: boolean;
}

function renderItems(arrangement: IRebuildSection['arrangement'], items: IRebuildItem[], ctx: RenderCtx, group: ItemGroup): string {
  if (!items.length) return '';
  switch (arrangement) {
    case 'accordion':
      return `<div class="rb-accordion">${items
        .map((i) => {
          // The summary is the title, else the first paragraph, subtitle or image alt; with none, a plain item
          const summary = i.title ?? i.text[0] ?? i.subtitle ?? (i.image?.alt || undefined);
          if (!summary) return renderItem(i);
          const rest = {
            ...i,
            title: undefined,
            text: i.title ? i.text : i.text.slice(1),
            subtitle: i.title || i.text.length ? i.subtitle : undefined,
          };
          return `<details class="rb-item"><summary class="rb-item-title">${escapeHtml(summary)}</summary>${renderItem(rest)}</details>`;
        })
        .join('')}</div>`;
    case 'tabs':
      return `<div class="rb-tabs">${items
        .map(
          (i, n) =>
            `<input type="radio" name="${group.id}-tab" id="${group.id}-tab-${n}"${n === 0 ? ' checked' : ''}><label for="${group.id}-tab-${n}">${escapeHtml(i.title ?? String(n + 1))}</label><div class="rb-tab-panel">${renderItem({ ...i, title: undefined })}</div>`,
        )
        .join('')}</div>`;
    case 'slider':
      return renderSlider(items, ctx, group.label, group.photo);
    case 'gallery':
      return `<div class="rb-gallery">${items.map(galleryItem).join('')}</div>`;
    case 'card-grid':
      return `<div class="rb-grid" style="--rb-columns: ${group.columns ?? 3}">${items.map((i) => renderItem(i)).join('')}</div>`;
    default:
      return `<div class="rb-list">${items.map((i) => renderItem(i)).join('')}</div>`;
  }
}

const renderExtra = (block: IRebuildBlock, ctx: RenderCtx, group: ItemGroup) =>
  block.type === 'text' ? `<div class="rb-text">${paragraphs(block.text)}</div>` : renderItems(block.arrangement, block.items, ctx, group);

function renderCopy(section: IRebuildSection, ctx: RenderCtx, extraImages: string): string {
  const { eyebrow, heading, text } = section.intro;
  const eyebrowHtml = eyebrow ? `<p class="rb-eyebrow">${escapeHtml(eyebrow)}</p>` : '';
  const label = heading ?? ctx.t.sliderLabel;
  const content =
    renderItems(section.arrangement, section.items, ctx, { id: section.id, label, columns: section.columns, photo: section.photoSlides }) +
    section.extra.map((block, n) => renderExtra(block, ctx, { id: `${section.id}-x${n}`, label })).join('') +
    extraImages;
  const tag = `h${section.headingLevel}`;
  const headingHtml = heading ? `<${tag} class="rb-heading">${escapeHtml(heading)}</${tag}>` : '';
  if (section.collapsed) {
    // A long text section keeps its heading in the outline; its body sits in the closed <details>
    return `<div class="rb-copy">${eyebrowHtml}${headingHtml}<details class="rb-collapsed"><summary>${escapeHtml(ctx.t.readMore)}</summary>${paragraphs(text)}${links(section.intro.links)}${content}</details></div>`;
  }
  return `<div class="rb-copy">${eyebrowHtml}${headingHtml}${paragraphs(text)}${links(section.intro.links)}${content}</div>`;
}

const embedHtml = (e: IRebuildSection['embeds'][number]) =>
  `<div class="rb-embed"><iframe src="${escapeHtml(e.src)}" title="${escapeHtml(e.title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>`;

export function renderSection(section: IRebuildSection, ctx: RenderCtx, tag: 'section' | 'div' = 'section'): string {
  const { style: s, itemStyle } = section;
  const style = [
    `--rb-section-text: ${s.text}`,
    `--rb-section-pad: ${s.paddingY}px`,
    s.background ? `--rb-section-bg: ${s.background}` : '',
    s.backgroundImage ? `--rb-bg-image: url('${cssUrl(s.backgroundImage)}')` : '',
    s.overlay !== undefined ? `--rb-overlay: ${s.overlay}` : '',
    section.split !== undefined ? `--rb-split: ${Math.round(section.split * 100)}%` : '',
    itemStyle?.radius !== undefined ? `--rb-item-radius: ${itemStyle.radius}px` : '',
    itemStyle?.background ? `--rb-item-bg: ${itemStyle.background}` : '',
    itemStyle?.text ? `--rb-item-text: ${itemStyle.text}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  // Images outside the items: a gallery section shows them all as a grid; otherwise the first takes the media
  // slot and the rest follow the copy as a small gallery
  const gallery = section.arrangement === 'gallery';
  const [first, ...rest] = section.images;
  const restHtml = !gallery && rest.length ? `<div class="rb-gallery">${rest.map((i) => img(i)).join('')}</div>` : '';
  const galleryHtml = gallery && section.images.length ? `<div class="rb-gallery">${section.images.map((i) => img(i)).join('')}</div>` : '';
  // Beside the text, a map or video takes the media slot when there is no picture
  const embedsInMedia = !first && section.arrangement === 'media-beside-text';
  const embeds = section.embeds.map(embedHtml).join('');
  const media = !gallery && first ? `<div class="rb-media">${img(first)}</div>` : embedsInMedia && embeds ? `<div class="rb-media">${embeds}</div>` : '';
  const after = embedsInMedia ? '' : embeds;
  const attrs = [
    `id="${escapeHtml(section.id)}"`,
    'class="rb-section"',
    `data-arrangement="${section.arrangement}"`,
    `data-kind="${section.kind}"`,
    section.mediaSide ? `data-media-side="${section.mediaSide}"` : '',
    `data-align="${s.align}"`,
    s.fullBleed ? 'data-full-bleed' : '',
    section.photoSlides ? 'data-photo-slides' : '',
    s.backgroundImage ? 'data-bg-image' : '',
    itemStyle?.imageShape ? `data-image-shape="${itemStyle.imageShape}"` : '',
    itemStyle?.border ? 'data-item-border' : '',
    itemStyle?.shadow ? 'data-item-shadow' : '',
    itemStyle?.align ? `data-item-align="${itemStyle.align}"` : '',
    // Only a section with something in its media slot is laid out as two columns
    media ? 'data-has-media' : '',
    `style="${style.replace(/&/g, '&amp;')}"`,
  ]
    .filter(Boolean)
    .join(' ');
  let bookingHtml = '';
  if (section.booking && !ctx.booking.placed) {
    ctx.booking.placed = true;
    bookingHtml = ctx.bookingHtml;
  }

  return `<${tag} ${attrs}>
  <div class="rb-container">${renderCopy(section, ctx, restHtml + galleryHtml)}${media}${after}</div>
</${tag}>${bookingHtml}`;
}
