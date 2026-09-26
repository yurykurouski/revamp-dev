import {
  IBentoTemplateData,
  ILead,
  IAudit,
  IMvpGeneratedContent,
  IBentoServiceCard,
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
    const businessName = lead.businessName || 'Service Center';
    const primaryColor = audit?.extractedBrandTokens?.primaryColor || '#5c5bed';
    const secondaryColor = audit?.extractedBrandTokens?.secondaryColor || '#b8c4fe';
    const accentColor = audit?.extractedBrandTokens?.accentColor || '#5c5bed';

    // Map services or create defaults
    let services: IBentoServiceCard[] = [];
    if (generatedContent?.services && generatedContent.services.length > 0) {
      services = generatedContent.services.map((s, idx) => ({
        title: s.title,
        description: s.description,
        lucideIconName: s.lucideIconName,
        badge: idx === 0 ? 'Top pick' : undefined,
        highlight: idx === 0,
      }));
    } else {
      services = [
        {
          title: 'Full inspection & diagnostics',
          description: 'Detailed expert inspection using professional certified equipment.',
          lucideIconName: 'activity',
          badge: 'Recommended',
          highlight: true,
        },
        {
          title: 'Professional service',
          description: 'All scheduled maintenance, done to quality standards and manufacturer specs.',
          lucideIconName: 'wrench',
        },
        {
          title: 'Warranty protection',
          description: 'Official warranty on all completed work and genuine installed parts.',
          lucideIconName: 'shield-check',
          badge: 'Warranty',
        },
        {
          title: 'Personal consultation',
          description: 'Free estimate and a detailed work plan from a senior specialist in 15 minutes.',
          lucideIconName: 'phone',
        },
      ];
    }

    // Map trust signals
    const trustSignals =
      generatedContent?.trustSignals && generatedContent.trustSignals.length > 0
        ? generatedContent.trustSignals
        : [
            { metric: '4.9 ★', label: 'Rating on Google Maps' },
            { metric: '10+ yrs', label: 'Of successful work and happy clients' },
            { metric: '100%', label: 'Honest fixed quote, no extra charges' },
          ];

    const templateData: IBentoTemplateData = {
      businessName,
      niche: lead.niche,
      logoUrl: audit?.extractedBrandTokens?.logoUrl,
      palette: {
        primary: primaryColor,
        secondary: secondaryColor,
        accent: accentColor,
      },
      contacts: {
        phone: lead.contactPhone || '+7 (812) 000-00-00',
        email: lead.contactEmail,
        city: lead.city,
      },
      hero: {
        badge: generatedContent?.hero?.badge || '✨ Special offer',
        headline:
          generatedContent?.hero?.headline ||
          `Professional services by ${businessName}, with guaranteed results`,
        subheadline:
          generatedContent?.hero?.subheadline ||
          `A personal approach, certified specialists and transparent fixed prices in ${lead.city || 'your city'}.`,
        primaryCtaText: generatedContent?.hero?.primaryCtaText || 'Book online',
        secondaryCtaText: generatedContent?.hero?.secondaryCtaText || 'Call us',
      },
      services,
      trustSignals,
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
