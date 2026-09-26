import {
  IBentoTemplateData,
  ILead,
  IAudit,
  IMvpGeneratedContent,
  IBentoServiceCard,
  IBentoReviewItem,
} from '@revamp/shared-types';
import { BentoTemplateDataSchema } from '@revamp/validation';
import { generateBentoHtml } from '../templates/bento.template.js';
import { getSupportedIconNames } from '../templates/icons.js';

export class BentoTemplateService {
  /**
   * Maximum allowed bundle size in bytes (300 KB).
   */
  public static readonly MAX_BUNDLE_SIZE_BYTES = 300 * 1024;

  /**
   * Compiles and renders a self-contained Bento landing page HTML document.
   * Validates schema and asserts size constraint (< 300 KB).
   */
  public render(data: IBentoTemplateData): string {
    // Validate input data using Zod schema
    const validatedData = BentoTemplateDataSchema.parse(data);

    // Generate static HTML bundle
    const html = generateBentoHtml(validatedData as IBentoTemplateData);

    // Validate size limit (< 300 KB DoD constraint)
    const byteLength = Buffer.byteLength(html, 'utf8');
    if (byteLength > BentoTemplateService.MAX_BUNDLE_SIZE_BYTES) {
      throw new Error(
        `Generated Bento HTML bundle size (${byteLength} bytes) exceeds the maximum limit of ${BentoTemplateService.MAX_BUNDLE_SIZE_BYTES} bytes.`,
      );
    }

    return html;
  }

  /**
   * Convenience helper to construct and render a Bento landing page directly
   * from MongoDB Lead and Audit documents.
   */
  public renderFromAudit(
    lead: Partial<ILead>,
    audit?: Partial<IAudit>,
    generatedContent?: Partial<IMvpGeneratedContent>,
  ): string {
    const businessName = lead.businessName || lead.domain || 'Our business';
    const tokens = audit?.extractedBrandTokens;
    const contacts = audit?.extractedContacts;
    const site = audit?.extractedContent;

    // Services come from the generated (grounded) copy, else straight from the original site
    let services: IBentoServiceCard[] = (generatedContent?.services || []).map((s, idx) => ({
      title: s.title,
      description: s.description,
      lucideIconName: s.lucideIconName,
      highlight: idx === 0,
    }));
    if (services.length === 0 && site) {
      services = site.serviceItems.slice(0, 6).map((item, idx) => ({
        title: item.title.slice(0, 60),
        description: (item.description || `${item.title} at ${businessName}.`).slice(0, 200),
        highlight: idx === 0,
      }));
    }

    // Only real testimonials from the original site, never invented reviews
    const reviews: IBentoReviewItem[] = (site?.testimonials || [])
      .filter((t) => t.text.length >= 5)
      .slice(0, 6)
      .map((t) => ({
        author: (t.author || 'Customer').slice(0, 60),
        comment: t.text.slice(0, 300),
        source: 'Website' as const,
      }));

    const isHttpUrl = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url));
    const images = (site?.images || []).filter(isHttpUrl);
    const logoUrl = isHttpUrl(tokens?.logoUrl) ? tokens.logoUrl : undefined;
    // og:image is often just the logo; only use it as the hero photo when it is a real image
    const ogIsLogo = !site?.ogImage || site.ogImage === logoUrl || /logo/i.test(site.ogImage);
    const heroImageUrl = !ogIsLogo && isHttpUrl(site?.ogImage) ? site.ogImage : images[0];
    const email = contacts?.email || lead.contactEmail;

    const templateData: IBentoTemplateData = {
      businessName,
      niche: lead.niche,
      logoUrl,
      monogramSvg: !logoUrl && tokens?.logoUrl?.startsWith('<svg') ? tokens.logoUrl : undefined,
      palette: {
        primary: tokens?.primaryColor || '#2563eb',
        secondary: tokens?.secondaryColor || '#1e293b',
        accent: tokens?.accentColor || tokens?.primaryColor || '#2563eb',
      },
      contacts: {
        phone: (contacts?.phone || lead.contactPhone)?.slice(0, 30),
        email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
        address: contacts?.address?.slice(0, 150),
        workingHours: contacts?.workingHours?.slice(0, 100),
        city: lead.city,
      },
      hero: {
        badge: generatedContent?.hero?.badge || undefined,
        headline: generatedContent?.hero?.headline || site?.h1 || businessName,
        subheadline:
          generatedContent?.hero?.subheadline || site?.metaDescription || site?.paragraphs[0] || businessName,
        primaryCtaText: generatedContent?.hero?.primaryCtaText || undefined,
        secondaryCtaText: generatedContent?.hero?.secondaryCtaText || undefined,
      },
      // Mixed Mongo fields round-trip undefined as null
      about: generatedContent?.about || undefined,
      servicesHeading: generatedContent?.servicesHeading || undefined,
      services: services.length > 0 ? services : [{ title: businessName, description: site?.metaDescription || businessName }],
      trustSignals: generatedContent?.trustSignals || [],
      reviews,
      heroImageUrl,
      gallery: images.slice(0, 7),
      socialLinks: (contacts?.socialLinks || []).filter((l) => isHttpUrl(l.url)).slice(0, 8),
      footerTagline: site?.metaDescription?.slice(0, 300),
      originalUrl: isHttpUrl(lead.originalUrl) ? lead.originalUrl : undefined,
    };

    return this.render(templateData);
  }

  /**
   * Returns all available Lucide icon identifiers.
   */
  public getSupportedIcons(): string[] {
    return getSupportedIconNames();
  }
}

export const bentoTemplateService = new BentoTemplateService();
