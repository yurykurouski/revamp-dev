/**
 * Picks the MVP page layout for a lead from its audit data (REV-54).
 *
 * Deterministic: the same audit always yields the same layout, so a regeneration keeps the look
 * the operator reviewed. Only the arrangement changes between layouts; every layout renders the
 * same grounded copy, contacts and images, so layout choice can never introduce new facts.
 */
import type {
  IAudit,
  ILead,
  IMvpGeneratedContent,
  IMvpLayoutSelection,
  MvpLayoutVariant,
  NicheType,
  SiteComplexityClass,
} from '@revamp/shared-types';
import { MvpLayoutSelectionSchema } from '@revamp/validation';

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
  const pick = (variant: MvpLayoutVariant, rule: string): IMvpLayoutSelection =>
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
