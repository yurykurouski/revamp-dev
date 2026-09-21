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
    const businessName = lead.businessName || 'Сервисный Центр';
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
        badge: idx === 0 ? 'Хит' : undefined,
        highlight: idx === 0,
      }));
    } else {
      services = [
        {
          title: 'Комплексный осмотр и диагностика',
          description: 'Детальная экспертная проверка на профессиональном сертифицированном оборудовании.',
          lucideIconName: 'activity',
          badge: 'Рекомендуем',
          highlight: true,
        },
        {
          title: 'Профессиональное обслуживание',
          description: 'Все виды регламентных работ с соблюдением стандартов качества и регламентов производителя.',
          lucideIconName: 'wrench',
        },
        {
          title: 'Гарантийная защита',
          description: 'Официальная гарантия на все выполненные работы и установленные оригинальные детали.',
          lucideIconName: 'shield-check',
          badge: 'Гарантия',
        },
        {
          title: 'Персональная консультация',
          description: 'Бесплатный расчет сметы и подробный план работ от ведущего специалиста за 15 минут.',
          lucideIconName: 'phone',
        },
      ];
    }

    // Map trust signals
    const trustSignals =
      generatedContent?.trustSignals && generatedContent.trustSignals.length > 0
        ? generatedContent.trustSignals
        : [
            { metric: '4.9 ★', label: 'Рейтинг на Яндекс и Google Картах' },
            { metric: '10+ лет', label: 'Успешной работы и довольных клиентов' },
            { metric: '100%', label: 'Честная фиксированная смета без доплат' },
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
        badge: generatedContent?.hero?.badge || '✨ Специальное предложение',
        headline:
          generatedContent?.hero?.headline ||
          `Профессиональные услуги «${businessName}» с гарантией результата`,
        subheadline:
          generatedContent?.hero?.subheadline ||
          `Индивидуальный подход, сертифицированные мастера и прозрачные фиксированные цены в ${lead.city || 'вашем городе'}.`,
        primaryCtaText: generatedContent?.hero?.primaryCtaText || 'Записаться онлайн',
        secondaryCtaText: generatedContent?.hero?.secondaryCtaText || 'Позвонить нам',
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
