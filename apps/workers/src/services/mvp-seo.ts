import type { IMvpSeo, ISiteContent, IStandardsChecks } from '@revamp/shared-types';
import { z } from 'zod';

// The MVP's search and sharing tags (REV-118). Every value is copied from the audit's verified data (the original's
// own description, photos and contacts); nothing is written by a model, and a tag whose source is missing is left out.

export interface MvpSeoInput {
  businessName: string;
  /** The page's language tag, already sanitized */
  language?: string;
  site?: Pick<ISiteContent, 'metaDescription' | 'paragraphs' | 'ogImage'>;
  contacts: { phone?: string; email?: string; address?: string };
  socialLinks: { url: string }[];
  /** The page's first photo (a section background, or an image of at least `SEO_IMAGE_MIN` px a side) */
  photo?: string;
  logoUrl?: string;
  /** The original site, the business's own address */
  originalUrl?: string;
  /** The original's standards checks: a tag it lacked is recorded as added */
  original?: IStandardsChecks;
}

/** A description is at most this long, as search results show it */
export const SEO_DESCRIPTION_MAX = 160;
/** The shortest paragraph that can stand in for a missing meta description */
export const SEO_PARAGRAPH_MIN = 50;
/** The smallest side of an `og:image`, as the sharing previews require; an image of unknown size is not used */
export const SEO_IMAGE_MIN = 200;
/** An image large enough to stand for the page when it is shared */
export const isSharingImage = (image: { width?: number; height?: number }) =>
  (image.width ?? 0) >= SEO_IMAGE_MIN && (image.height ?? 0) >= SEO_IMAGE_MIN;
/** Languages spoken in one country only, so the bare tag names its `og:locale` */
const SINGLE_REGION: Record<string, string> = { pl: 'PL', lt: 'LT', be: 'BY' };

const EmailSchema = z.string().email().max(254);
const isHttp = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url) && url.length <= 2000);
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The text cut at a word boundary to fit `max`, marked with an ellipsis when cut */
export function clipDescription(text: string, max = SEO_DESCRIPTION_MAX): string {
  const clean = squash(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** `og:locale` from a language tag: its own region ("pl-PL"), or the one country of a single-region language */
export function ogLocale(language?: string): string | undefined {
  const match = /^([a-z]{2,3})(?:-([a-z]{2}))?(?:-|$)/i.exec(language ?? '');
  if (!match) return undefined;
  const lang = (match[1] ?? '').toLowerCase();
  const region = match[2]?.toUpperCase() ?? SINGLE_REGION[lang];
  return region ? `${lang}_${region}` : undefined;
}

export function buildMvpSeo(input: MvpSeoInput): { seo: IMvpSeo; codes: string[] } {
  const site = input.site;
  const own = site?.metaDescription && squash(site.metaDescription);
  const paragraph = site?.paragraphs?.map(squash).find((p) => p.length >= SEO_PARAGRAPH_MIN);
  const description = own ? clipDescription(own) : paragraph ? clipDescription(paragraph) : undefined;
  const image = [site?.ogImage, input.photo, input.logoUrl].find(isHttp);
  const locale = ogLocale(input.language);
  const phone = input.contacts.phone?.trim().slice(0, 30);
  const email = input.contacts.email?.trim();
  const address = input.contacts.address?.trim().slice(0, 300);
  const name = squash(input.businessName).slice(0, 300) || undefined;
  const seo: IMvpSeo = {
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(locale ? { locale } : {}),
    ...(name
      ? {
          localBusiness: {
            name,
            ...(isHttp(input.originalUrl) ? { url: input.originalUrl } : {}),
            ...(phone ? { telephone: phone } : {}),
            ...(email && EmailSchema.safeParse(email).success ? { email } : {}),
            ...(address ? { address } : {}),
            ...(image ? { image } : {}),
            sameAs: [...new Set(input.socialLinks.map((l) => l.url).filter(isHttp))].slice(0, 12),
          },
        }
      : {}),
  };
  // A tag is recorded as added only when the audit read the original and found it missing
  const lacked = (check: keyof IStandardsChecks) => input.original?.[check] === false;
  const codes = [
    ...(seo.description && lacked('metaDescription') ? ['seo:description'] : []),
    ...(lacked('openGraph') ? ['seo:og'] : []),
    ...(seo.localBusiness && lacked('structuredData') ? ['seo:jsonld'] : []),
  ];
  return { seo, codes };
}
