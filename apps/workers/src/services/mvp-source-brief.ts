import { IAudit, ILead, IMvpSourceBrief, MVP_BRIEF_LIMITS, MvpPlaceholder } from '@revamp/shared-types';
import { MvpSourceBriefSchema } from '@revamp/validation';

// What the model may read about the business (REV-136). Built by code from the audit's verified data: the original's
// own copy, services, brand and images. Contact values never enter it; the model gets placeholder names instead and
// code fills them (`finishMvpPage`).

export interface VerifiedContacts {
  phone?: string;
  email?: string;
  address?: string;
  hours?: string;
}

type BriefAudit = Pick<IAudit, 'extractedContacts' | 'extractedContent' | 'extractedServices' | 'extractedBrandTokens'>;
type BriefLead = Pick<ILead, 'businessName' | 'niche' | 'city' | 'originalUrl' | 'contactPhone' | 'contactEmail'>;

const filled = (value?: string) => (value?.trim() ? value.trim() : undefined);
/** The longest single text the brief takes (`MvpSourceBriefSchema`); a longer one is left out, never cut */
const MAX_TEXT = 4000;
/** The longest service name or testimonial author, and font name, the brief takes */
const MAX_NAME = 200;
const MAX_FONT = 100;
/** A brand color as read, or empty when it is too long to be one */
const color = (value: string) => (value.trim().length <= 50 ? value.trim() : '');
const short = (value?: string) => {
  const v = filled(value);
  return v && v.length <= MAX_TEXT ? v : undefined;
};
const isHttp = (url: string) => /^https?:\/\//i.test(url);

/** The contacts the page may show: extracted from the original site first, then the operator-entered lead data */
export function verifiedContacts(audit: Pick<IAudit, 'extractedContacts'>, lead: Pick<ILead, 'contactPhone' | 'contactEmail'>): VerifiedContacts {
  const site = audit.extractedContacts;
  const contacts: VerifiedContacts = {
    phone: filled(site?.phone) ?? filled(lead.contactPhone),
    email: filled(site?.email) ?? filled(lead.contactEmail),
    address: filled(site?.address),
    hours: filled(site?.workingHours),
  };
  return Object.fromEntries(Object.entries(contacts).filter(([, v]) => v !== undefined)) as VerifiedContacts;
}

/** Trimmed, non-empty, first occurrence of each (case-insensitive), at most `max` */
function unique<T>(items: T[] | undefined, key: (item: T) => string, max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items ?? []) {
    const k = key(item).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export function buildMvpSourceBrief(audit: BriefAudit, lead: BriefLead): IMvpSourceBrief {
  const content = audit.extractedContent;
  const brand = audit.extractedBrandTokens;
  const contacts = verifiedContacts(audit, lead);
  const placeholders: MvpPlaceholder[] = [
    ...(['phone', 'email', 'address', 'hours'] as const).filter((name) => contacts[name]),
    'booking',
  ];

  // One budget for all the copy, spent in reading order; a text that does not fit is dropped whole, never cut
  let budget: number = MVP_BRIEF_LIMITS.copyChars;
  const fits = (length: number) => {
    if (length > MAX_TEXT) return false;
    if (budget < 0 || length > budget) {
      budget = -1;
      return false;
    }
    budget -= length;
    return true;
  };
  const text = (s: string) => s.trim();
  const headings = unique(content?.headings, text, MVP_BRIEF_LIMITS.headings).map(text).filter((h) => fits(h.length));
  const paragraphs = unique(content?.paragraphs, text, MVP_BRIEF_LIMITS.paragraphs).map(text).filter((p) => fits(p.length));
  const serviceItems = unique(content?.serviceItems, (s) => s.title, MVP_BRIEF_LIMITS.serviceItems)
    .map((s) => ({ title: s.title.trim(), ...(short(s.description) ? { description: short(s.description) } : {}) }))
    .filter((s) => fits(s.title.length + (s.description?.length ?? 0)));
  const testimonials = unique(content?.testimonials, (t) => t.text, MVP_BRIEF_LIMITS.testimonials)
    .map((t) => ({ text: t.text.trim(), ...(filled(t.author) && (t.author ?? '').trim().length <= MAX_NAME ? { author: filled(t.author) } : {}) }))
    .filter((t) => fits(t.text.length));

  const logoUrl = filled(brand.logoUrl);
  const logo = logoUrl && isHttp(logoUrl) ? logoUrl : undefined;
  const brief: IMvpSourceBrief = {
    business: {
      name: lead.businessName,
      niche: lead.niche,
      ...(filled(lead.city) ? { city: filled(lead.city) } : {}),
      originalUrl: lead.originalUrl,
    },
    ...(content?.language ? { language: content.language } : {}),
    services: unique((audit.extractedServices ?? []).filter((s) => s.trim().length <= MAX_NAME), (s) => s, MVP_BRIEF_LIMITS.services).map(text),
    copy: {
      ...(short(content?.title) ? { title: short(content?.title) } : {}),
      ...(short(content?.metaDescription) ? { metaDescription: short(content?.metaDescription) } : {}),
      ...(short(content?.h1) ? { h1: short(content?.h1) } : {}),
      headings,
      paragraphs,
      serviceItems,
      testimonials,
      ...(content?.rating ? { rating: content.rating } : {}),
      ...(content?.foundingYear ? { foundingYear: content.foundingYear } : {}),
    },
    brand: {
      primary: color(brand.primaryColor),
      secondary: color(brand.secondaryColor),
      accent: color(brand.accentColor),
      fonts: brand.fontFamilies.map(text).filter((f) => f && f.length <= MAX_FONT).slice(0, 10),
      ...(logo ? { logoUrl: logo } : {}),
    },
    images: unique((content?.images ?? []).filter((src) => isHttp(src) && src !== logoUrl), (s) => s, MVP_BRIEF_LIMITS.images),
    placeholders,
  };
  return MvpSourceBriefSchema.parse(brief) as IMvpSourceBrief;
}
