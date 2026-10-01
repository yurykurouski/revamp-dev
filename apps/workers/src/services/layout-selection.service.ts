/**
 * Picks the MVP page layout for a lead from its audit data (REV-54).
 *
 * Deterministic: the same audit always yields the same layout, so a regeneration keeps the look
 * the operator reviewed. Only the arrangement changes between layouts; every layout renders the
 * same grounded copy, contacts and images, so layout choice can never introduce new facts.
 */
import {
  MVP_LAYOUT_DERIVED_REASON,
  MVP_LAYOUT_UNREAD_REASON,
  type IAudit,
  type ILead,
  type IMvpDesign,
  type IMvpGeneratedContent,
  type IMvpLayoutSelection,
  type ISiteLayout,
  type MvpDesignSection,
  type BentoLayoutVariant,
  type NicheType,
  type SiteComplexityClass,
  type SiteSectionKind,
} from '@revamp/shared-types';
import { MvpDesignSchema, MvpLayoutSelectionSchema } from '@revamp/validation';
import { hasDesign } from '../templates/design.js';

/** The audit facts a layout is chosen from */
export interface LayoutSignals {
  complexity: SiteComplexityClass;
  niche?: NicheType;
  /** http(s) images found on the original site */
  imageCount: number;
  /** A real photo (not the logo) is available for the hero */
  hasHeroImage: boolean;
  serviceCount: number;
  reviewCount: number;
  /** The generated copy has an About block */
  hasAbout: boolean;
  /** Text paragraphs on the original site: a proxy for how much the business has to say */
  paragraphCount: number;
}

/** Niches whose customers choose with their eyes: food, interiors, bodies, cars, buildings */
const VISUAL_NICHES: ReadonlySet<NicheType> = new Set(['restaurant', 'beauty', 'fitness', 'construction', 'auto']);

/** Niches that sell trust and expertise, where a calm text-led page fits */
const PROFESSIONAL_NICHES: ReadonlySet<NicheType> = new Set(['legal', 'medical', 'dental']);

const isHttpUrl = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url));

/**
 * Reads the layout signals from the same lead and audit data the template renders.
 */
export function buildLayoutSignals(
  lead: Partial<ILead>,
  audit?: Partial<IAudit>,
  generatedContent?: Partial<IMvpGeneratedContent>,
): LayoutSignals {
  const site = audit?.extractedContent;
  const images = (site?.images || []).filter(isHttpUrl);
  const logoUrl = audit?.extractedBrandTokens?.logoUrl;
  const ogIsPhoto = isHttpUrl(site?.ogImage) && site.ogImage !== logoUrl && !/logo/i.test(site.ogImage);
  const generatedServices = generatedContent?.services?.length ?? 0;

  return {
    complexity: audit?.siteComplexity?.class ?? lead.siteComplexity ?? 'UNKNOWN',
    niche: lead.niche,
    imageCount: images.length,
    hasHeroImage: ogIsPhoto || images.length > 0,
    serviceCount: generatedServices > 0 ? generatedServices : Math.min(site?.serviceItems?.length ?? 0, 6),
    reviewCount: (site?.testimonials || []).filter((review) => review.text.length >= 5).length,
    hasAbout: Boolean(generatedContent?.about),
    paragraphCount: site?.paragraphs?.length ?? 0,
  };
}

/**
 * Chooses the layout. Rules are checked in order and the first match wins; Bento is the fallback.
 */
export function selectMvpLayout(signals: LayoutSignals): IMvpLayoutSelection {
  const facts = [
    `complexity:${signals.complexity}`,
    ...(signals.niche ? [`niche:${signals.niche}`] : []),
    `images:${signals.imageCount}`,
    `services:${signals.serviceCount}`,
  ];
  const pick = (variant: BentoLayoutVariant, rule: string): IMvpLayoutSelection =>
    MvpLayoutSelectionSchema.parse({ variant, reasons: [`rule:${rule}`, ...facts] });

  const isVisualNiche = signals.niche !== undefined && VISUAL_NICHES.has(signals.niche);
  const isProfessionalNiche = signals.niche !== undefined && PROFESSIONAL_NICHES.has(signals.niche);

  // A small brochure site, or one with almost nothing to list: one short page led by the contacts
  if (signals.serviceCount <= 2 || (signals.complexity === 'ONE_PAGE_BROCHURE' && signals.serviceCount <= 4)) {
    return pick('compact', 'small_brochure');
  }

  // Customers who choose with their eyes, and real photos to show them: an image-led split hero
  if (isVisualNiche && signals.hasHeroImage && signals.imageCount >= 2) {
    return pick('split', 'visual_niche');
  }

  // Expertise businesses with a lot to say: a calm, typographic, text-led page
  if (isProfessionalNiche && signals.paragraphCount >= 6) {
    return pick('editorial', 'professional_niche');
  }

  // Plenty of real photos on any other site: the image-led layout carries it
  if (!isProfessionalNiche && signals.hasHeroImage && signals.imageCount >= 6) {
    return pick('split', 'image_rich');
  }

  // Long copy and few photos: text-led
  if (signals.hasAbout && signals.paragraphCount >= 8 && signals.imageCount < 4) {
    return pick('editorial', 'text_heavy');
  }

  return pick('bento', 'default');
}

// ---------------------------------------------------------------------------------------------
// Layout derived from the original site (REV-104)
// ---------------------------------------------------------------------------------------------

/** The MVP section that carries each kind of original section; the rest have no MVP counterpart */
const MVP_SECTION_OF: Partial<Record<SiteSectionKind, MvpDesignSection>> = {
  services: 'services',
  pricing: 'services',
  gallery: 'gallery',
  about: 'about',
  team: 'about',
  reviews: 'reviews',
};

/** Menus with at least this many links get section links in the MVP header */
const NAV_LINKS_MIN = 3;

/** Whether the rules would make this a short, contacts-first page: too little to list for anything else */
const isSmallBrochure = (signals: LayoutSignals) =>
  signals.serviceCount <= 2 || (signals.complexity === 'ONE_PAGE_BROCHURE' && signals.serviceCount <= 4);

/**
 * The MVP's page order of its content sections, following the order the original site shows them in.
 * Sections the original does not have follow in the layout's own order.
 */
export function derivedSectionOrder(site: ISiteLayout): MvpDesignSection[] {
  const order: MvpDesignSection[] = [];
  for (const section of site.sections) {
    const mvpSection = MVP_SECTION_OF[section.kind];
    if (mvpSection && !order.includes(mvpSection)) order.push(mvpSection);
  }
  return order;
}

/**
 * Derives the MVP layout from the original site's layout: the variant from its first screen, and a
 * design spec that follows its section order, hero arrangement, header and white space. Deterministic,
 * so the same audit always yields the same layout. It only arranges the grounded content; which
 * sections exist and what they say stays as the template renders it.
 *
 * Without a readable layout the rule-based choice is used, marked with `site_layout:unread`.
 */
export function deriveMvpLayout(site: ISiteLayout | undefined, signals: LayoutSignals): IMvpLayoutSelection {
  if (!site) {
    const rules = selectMvpLayout(signals);
    return MvpLayoutSelectionSchema.parse({ ...rules, reasons: [...rules.reasons, MVP_LAYOUT_UNREAD_REASON].slice(0, 12) });
  }

  const photoHero = site.hero.media !== 'none' && signals.hasHeroImage;
  const isProfessionalNiche = signals.niche !== undefined && PROFESSIONAL_NICHES.has(signals.niche);
  let variant: BentoLayoutVariant;
  if (isSmallBrochure(signals)) variant = 'compact';
  else if (photoHero) variant = 'split';
  else if (site.hero.align === 'left' && (isProfessionalNiche || signals.paragraphCount >= 6)) variant = 'editorial';
  else variant = 'bento';

  const design: IMvpDesign = {};
  const sectionOrder = derivedSectionOrder(site);
  if (sectionOrder.length) design.sectionOrder = sectionOrder;

  const hero: NonNullable<IMvpDesign['hero']> = {};
  if (variant === 'split') {
    // A photo filling the first screen, or a slider of them, stays behind the copy
    hero.imageSide = site.hero.media === 'side' ? (site.hero.mediaSide ?? 'right') : 'behind';
    if (hero.imageSide === 'behind') hero.align = site.hero.align;
  } else {
    hero.align = site.hero.align;
  }
  design.hero = hero;

  const theme: NonNullable<IMvpDesign['theme']> = {};
  if (site.density !== 'comfortable') theme.density = site.density;
  // The compact hero is dark already, and a photo backdrop brings its own overlay
  if (variant !== 'compact' && hero.imageSide !== 'behind' && site.hero.tone !== 'light') theme.heroStyle = site.hero.tone;
  if (Object.keys(theme).length) design.theme = theme;

  const header: NonNullable<IMvpDesign['header']> = {};
  if (site.nav.centeredLogo) header.layout = 'centered';
  if (site.nav.itemCount >= NAV_LINKS_MIN) header.links = true;
  if (Object.keys(header).length) design.header = header;

  // `features` has no MVP counterpart yet (REV-109); like `other`, it does not name the order
  const kinds = site.sections.map((section) => section.kind).filter((kind) => kind !== 'other' && kind !== 'features');
  const reasons = [
    MVP_LAYOUT_DERIVED_REASON,
    `hero:${site.hero.media}${site.hero.mediaSide ? `-${site.hero.mediaSide}` : ''}`,
    `hero_align:${site.hero.align}`,
    `hero_tone:${site.hero.tone}`,
    `sections:${site.sections.length}`,
    ...(kinds.length ? [`order:${kinds.join('>')}`.slice(0, 60)] : []),
    `nav:${site.nav.itemCount}${site.nav.centeredLogo ? '-centered' : ''}`,
    `density:${site.density}`,
    `complexity:${signals.complexity}`,
    `images:${signals.imageCount}`,
    `services:${signals.serviceCount}`,
  ];

  return MvpLayoutSelectionSchema.parse({
    variant,
    reasons: reasons.slice(0, 12),
    ...(hasDesign(design) ? { design: MvpDesignSchema.parse(design) } : {}),
  });
}
