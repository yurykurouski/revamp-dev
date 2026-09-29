/**
 * In-page half of the site section reader (REV-109). `collectSiteSectionsInPage` runs inside the
 * crawled page via page.evaluate(), so it must stay fully self-contained: no imports, no references
 * to module-level values. It reads the header, the blocks REV-104's layout walk tagged with
 * `data-revamp-block`, and the footer, and only reports raw DOM facts; `readSiteSections`
 * (site-sections.service.ts) makes every decision in Node. No LLM is involved at any step.
 */

/** A box in page coordinates, px */
export interface RawBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface RawSiteLink {
  label: string;
  /** Absolute */
  href: string;
  /** Styled as a button: padding plus an opaque background or a border */
  button: boolean;
}

export interface RawSiteImage {
  /** Absolute, never a data: URI */
  src: string;
  alt: string;
  box: RawBox;
  /** Corner radius of the image or its clipping parent, px */
  radius: number;
}

export interface RawSiteItem {
  title?: string;
  subtitle?: string;
  text: string[];
  image?: RawSiteImage;
  price?: string;
  rating?: number;
  links: RawSiteLink[];
  /** Carries an icon (svg, icon font, or a small image) */
  icon: boolean;
  box: RawBox;
}

/** Markup that names a group's arrangement or content outright */
export type RawGroupMarkup = 'accordion' | 'tabs' | 'slider' | 'person' | 'review';

export interface RawItemGroup {
  markup?: RawGroupMarkup;
  items: RawSiteItem[];
}

export interface RawSiteEmbed {
  kind: 'map' | 'video' | 'form' | 'widget';
  src?: string;
  box: RawBox;
}

export interface RawSiteBlock {
  role: 'header' | 'content' | 'footer';
  /** The REV-104 block index (`data-revamp-block`); absent for the header and footer */
  block?: number;
  box: RawBox;
  /** Around the eyebrow, heading and intro text */
  introBox?: RawBox;
  /** Around all visible content */
  contentBox?: RawBox;
  intro: { eyebrow?: string; heading?: string; headingLevel?: number; text: string[]; links: RawSiteLink[] };
  group?: RawItemGroup;
  extra: Array<{ type: 'text'; text: string[] } | { type: 'items'; group: RawItemGroup }>;
  /** Images outside the items */
  images: RawSiteImage[];
  backgroundImage?: string;
  embeds: RawSiteEmbed[];
  style: { background: string; color: string; textAlign: string; paddingTop: number; paddingBottom: number };
  /** Computed style of the first item's card */
  itemStyle?: { background: string; radius: number; borderWidth: number; boxShadow: string; textAlign: string };
}

/** Text outside every section, with its offset from the top of the page */
export interface RawTextRun {
  text: string;
  top: number;
}

export interface RawTypography {
  heading?: { family: string; size: number; weight: number; transform: string; color: string };
  body?: { family: string; size: number; weight: number; lineHeight: string; color: string };
  button?: { radius: number; background: string; borderWidth: number; transform: string; color: string };
}

export interface RawSiteSections {
  viewportWidth: number;
  viewportHeight: number;
  header?: RawSiteBlock;
  blocks: RawSiteBlock[];
  footer?: RawSiteBlock;
  typography: RawTypography;
  /** Characters of page text (visible text, plus hidden text inside sections) */
  pageChars: number;
  uncaptured: RawTextRun[];
}
