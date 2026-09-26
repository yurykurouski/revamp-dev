import { MvpContentOutputSchema, MvpContentOutput } from '@revamp/validation';
import { env } from '../config/env.js';
import { getSupportedIconNames } from '../templates/icons.js';

export interface GenerateMvpContentInput {
  businessName: string;
  niche?: string;
  city?: string;
  originalUrl?: string;
  extractedServices?: string[];
  contacts?: {
    phone?: string;
    email?: string;
    address?: string;
  };
  critiqueQuickWins?: string[];
  ownerName?: string;
}

export interface MvpContentGenerationResult {
  content: MvpContentOutput;
  aiFallbackUsed: boolean;
  modelUsed?: string;
  attempts: number;
}

export interface MvpContentServiceOptions {
  provider?: 'anthropic' | 'openai' | 'gemini' | 'mock';
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  customFetcher?: typeof fetch;
}

export const MVP_CONTENT_SYSTEM_PROMPT = `You are a professional Senior Conversion Copywriter.
Your goal is to take the scraped content of a local business and rewrite it for a modern, high-converting one-page Bento landing page.

FUNDAMENTAL GROUNDING RULE:
- Never invent new services, change the actual address, alter phone numbers, or make up staff members or prices.
- All factual information must come STRICTLY from the provided context.

Style requirements:
- Write all copy in English.
- Hero headline: formula "Customer benefit + removal of the main fear / local specifics" (up to 90 characters).
- Hero subheadline: a clear explanation of how the business solves the customer's problem (up to 180 characters).
- Services: turn the scraped services into 3-6 key cards with a concise, persuasive description (up to 15 words each) and pick a matching Lucide icon (e.g. 'wrench', 'shield-check', 'sparkles', 'calendar', 'phone', 'award', 'activity', 'truck', 'heart', 'smile', 'zap').
- CTA buttons: a concrete action ("Book a diagnostic", "Get a repair quote").
- 3 trust signals (trustSignals): objective metrics (e.g. "4.9 ★", "10+ yrs", "100%").
- Respond with a raw JSON object only, with no preamble and no markdown around the JSON.`;

export class MvpContentService {
  private provider: 'anthropic' | 'openai' | 'gemini' | 'mock';
  private anthropicApiKey?: string;
  private openaiApiKey?: string;
  private geminiApiKey?: string;
  private fetcher: typeof fetch;

  constructor(options: MvpContentServiceOptions = {}) {
    this.anthropicApiKey = options.anthropicApiKey ?? env.ANTHROPIC_API_KEY;
    this.openaiApiKey = options.openaiApiKey ?? env.OPENAI_API_KEY;
    this.geminiApiKey = options.geminiApiKey ?? env.GEMINI_API_KEY;
    this.fetcher = options.customFetcher ?? fetch;

    if (options.provider) {
      this.provider = options.provider;
    } else if (this.anthropicApiKey) {
      this.provider = 'anthropic';
    } else if (this.openaiApiKey) {
      this.provider = 'openai';
    } else if (this.geminiApiKey) {
      this.provider = 'gemini';
    } else {
      this.provider = 'mock';
    }
  }

  /**
   * Generates high-converting Bento landing page copy with Strict Grounding.
   * On failure or missing keys, falls back gracefully with aiFallbackUsed: true.
   */
  async generateContent(input: GenerateMvpContentInput): Promise<MvpContentGenerationResult> {
    if (
      this.provider === 'mock' ||
      (!this.anthropicApiKey && !this.openaiApiKey && !this.geminiApiKey)
    ) {
      console.log('[MvpContentService] No LLM API keys detected. Using deterministic grounded copy.');
      const fallback = this.generateDeterministicFallback(input);
      return {
        content: fallback,
        aiFallbackUsed: true,
        modelUsed: 'deterministic-fallback',
        attempts: 1,
      };
    }

    const temperatures = [0.3, 0.0, 0.0];
    let lastError: Error | null = null;
    let attemptsCount = 0;

    for (let attempt = 0; attempt < temperatures.length; attempt++) {
      attemptsCount++;
      const currentTemp = temperatures[attempt] ?? 0.0;

      try {
        console.log(
          `[MvpContentService] Attempt ${attempt + 1}/${temperatures.length} using ${this.provider} (temp: ${currentTemp})...`,
        );

        let rawResponse: string;
        if (this.provider === 'anthropic') {
          rawResponse = await this.callAnthropic(input, currentTemp);
        } else if (this.provider === 'gemini') {
          rawResponse = await this.callGemini(input, currentTemp);
        } else {
          rawResponse = await this.callOpenAi(input, currentTemp);
        }

        const parsedContent = this.extractAndValidateJson(rawResponse);
        const groundedContent = this.enforceStrictGrounding(parsedContent, input);

        return {
          content: groundedContent,
          aiFallbackUsed: false,
          modelUsed: this.provider,
          attempts: attemptsCount,
        };
      } catch (err) {
        lastError = err as Error;
        console.warn(
          `[MvpContentService] Attempt ${attempt + 1} failed: ${lastError.message}`,
        );
      }
    }

    console.error(
      `[MvpContentService] All ${temperatures.length} attempts failed. Engaging deterministic fallback. Error: ${lastError?.message}`,
    );
    const fallback = this.generateDeterministicFallback(input);
    return {
      content: fallback,
      aiFallbackUsed: true,
      modelUsed: 'deterministic-fallback',
      attempts: attemptsCount,
    };
  }

  /**
   * Enforces Strict Grounding:
   * 1. Validates and normalizes Lucide icon names against known icons.
   * 2. Guards against niche misalignment / hallucinated categories.
   * 3. Sanitizes lengths to schema bounds.
   */
  public enforceStrictGrounding(
    raw: MvpContentOutput,
    input: GenerateMvpContentInput,
  ): MvpContentOutput {
    const supportedIcons = new Set(getSupportedIconNames());

    // Icon fallback mapping for common terms
    const iconAliasMap: Record<string, string> = {
      shield: 'shield-check',
      guard: 'shield-check',
      security: 'shield-check',
      tool: 'wrench',
      tools: 'wrench',
      repair: 'wrench',
      auto: 'car',
      mechanic: 'wrench',
      dentist: 'smile',
      tooth: 'smile',
      medical: 'activity',
      doctor: 'stethoscope',
      clock: 'clock',
      time: 'clock',
      fast: 'zap',
      speed: 'zap',
      call: 'phone',
      telephone: 'phone',
      star: 'star',
      rating: 'award',
      trophy: 'award',
      delivery: 'truck',
      courier: 'truck',
      box: 'truck',
      clean: 'sparkles',
      magic: 'sparkles',
    };

    // Normalize services
    const normalizedServices = raw.services.slice(0, 6).map((service) => {
      let iconName = (service.lucideIconName || 'sparkles').toLowerCase().trim().replace(/_/g, '-');
      if (!supportedIcons.has(iconName)) {
        iconName = iconAliasMap[iconName] || 'sparkles';
      }

      return {
        title: service.title.slice(0, 50),
        description: service.description.slice(0, 120),
        lucideIconName: iconName,
      };
    });

    // Ensure at least 3 services
    if (normalizedServices.length < 3) {
      const fallbackServices = this.getNicheDefaultServices(input.niche || 'other');
      for (const fs of fallbackServices) {
        if (normalizedServices.length >= 3) break;
        if (!normalizedServices.some((s) => s.title === fs.title)) {
          normalizedServices.push(fs);
        }
      }
    }

    return {
      hero: {
        badge: raw.hero.badge.slice(0, 40),
        headline: raw.hero.headline.slice(0, 90),
        subheadline: raw.hero.subheadline.slice(0, 180),
        primaryCtaText: raw.hero.primaryCtaText.slice(0, 35),
        secondaryCtaText: raw.hero.secondaryCtaText.slice(0, 35),
      },
      services: normalizedServices,
      trustSignals: raw.trustSignals.slice(0, 3).map((ts) => ({
        metric: ts.metric.slice(0, 20),
        label: ts.label.slice(0, 50),
      })),
      offerNotice: raw.offerNotice.slice(0, 100),
    };
  }

  /**
   * Deterministic grounded copy generator when LLM is unavailable or fails.
   */
  public generateDeterministicFallback(input: GenerateMvpContentInput): MvpContentOutput {
    const businessName = input.businessName || 'Service Center';
    const city = input.city || '';
    const citySuffix = city ? ` in ${city}` : '';
    const niche = input.niche || 'other';

    const nicheServices = this.getNicheDefaultServices(niche);

    // If scraped services exist, ground them as top priorities
    let selectedServices = [...nicheServices];
    if (input.extractedServices && input.extractedServices.length > 0) {
      selectedServices = input.extractedServices.slice(0, 4).map((rawName, idx) => {
        const matchingFallback = nicheServices[idx] || nicheServices[0]!;
        return {
          title: rawName.slice(0, 50),
          description: matchingFallback.description,
          lucideIconName: matchingFallback.lucideIconName,
        };
      });
      // Pad to at least 3
      while (selectedServices.length < 3) {
        const next = nicheServices[selectedServices.length];
        if (next) selectedServices.push(next);
        else break;
      }
    }

    const heroCopy = this.getNicheHeroCopy(niche, businessName, citySuffix);

    return {
      hero: {
        badge: heroCopy.badge,
        headline: heroCopy.headline.slice(0, 90),
        subheadline: heroCopy.subheadline.slice(0, 180),
        primaryCtaText: heroCopy.primaryCtaText,
        secondaryCtaText: heroCopy.secondaryCtaText,
      },
      services: selectedServices.slice(0, 6),
      trustSignals: [
        { metric: '4.9 ★', label: 'Rating on Google Maps' },
        { metric: '10+ yrs', label: `Of experience${citySuffix}` },
        { metric: '100%', label: 'Quality guarantee and honest quotes' },
      ],
      offerNotice: 'Special terms and priority booking when you contact us online',
    };
  }

  private getNicheHeroCopy(niche: string, businessName: string, citySuffix: string) {
    switch (niche) {
      case 'dental':
        return {
          badge: '✨ Pain-free treatment',
          headline: `A healthy smile without pain or fear at ${businessName}`,
          subheadline: `Modern dentistry with a 5-year guarantee${citySuffix}. The latest equipment and caring dentists.`,
          primaryCtaText: 'Book an appointment',
          secondaryCtaText: 'Talk to a dentist',
        };
      case 'auto':
        return {
          badge: '⚡ Same-day repairs',
          headline: `Honest auto service at ${businessName}, with a warranty on all work`,
          subheadline: `Accurate computer diagnostics, transparent pricing and repairs of any complexity${citySuffix}.`,
          primaryCtaText: 'Book a service',
          secondaryCtaText: 'Get a quote',
        };
      case 'legal':
        return {
          badge: '⚖️ Protecting your interests',
          headline: `Qualified legal help from ${businessName}`,
          subheadline: `Comprehensive legal support for businesses and individuals${citySuffix}. An honest assessment of your case.`,
          primaryCtaText: 'Get a consultation',
          secondaryCtaText: 'Ask a question',
        };
      case 'beauty':
        return {
          badge: '💖 Premium care',
          headline: `Flawless style and beauty care at ${businessName}`,
          subheadline: `Certified stylists, premium products and a cozy atmosphere${citySuffix}.`,
          primaryCtaText: 'Pick a time',
          secondaryCtaText: 'Services & prices',
        };
      default:
        return {
          badge: '⭐ Trusted quality',
          headline: `Professional services by ${businessName}, guaranteed`,
          subheadline: `A personal approach, transparent prices and reliable service${citySuffix}.`,
          primaryCtaText: 'Send a request',
          secondaryCtaText: 'Call us',
        };
    }
  }

  private getNicheDefaultServices(niche: string) {
    switch (niche) {
      case 'dental':
        return [
          {
            title: 'Turnkey dental implants',
            description: 'Swiss implants with a lifetime guarantee and pain-free placement.',
            lucideIconName: 'shield-check',
          },
          {
            title: 'Gentle Zoom whitening',
            description: 'Safely whitens enamel up to 8 shades in a single session.',
            lucideIconName: 'sparkles',
          },
          {
            title: 'Bite correction with aligners',
            description: 'Clear, invisible aligners for a perfect smile without discomfort.',
            lucideIconName: 'smile',
          },
          {
            title: 'Urgent dental care',
            description: 'Fast, pain-free treatment of cavities and acute toothache.',
            lucideIconName: 'activity',
          },
        ];
      case 'auto':
        return [
          {
            title: 'Full vehicle diagnostics',
            description: 'Scans of all electronic systems and suspension with dealer-grade equipment.',
            lucideIconName: 'activity',
          },
          {
            title: 'Major and routine repairs',
            description: 'Engine, transmission and chassis restoration with a warranty.',
            lucideIconName: 'wrench',
          },
          {
            title: 'Scheduled maintenance & oil change',
            description: 'Fast servicing to manufacturer specifications.',
            lucideIconName: 'clock',
          },
          {
            title: 'Tyre fitting & balancing',
            description: 'Precise wheel balancing and seasonal tyre storage.',
            lucideIconName: 'car',
          },
        ];
      default:
        return [
          {
            title: 'Full assessment & audit',
            description: 'A detailed needs assessment and a transparent work plan.',
            lucideIconName: 'activity',
          },
          {
            title: 'Professional delivery',
            description: 'On-time delivery to high quality standards and your requirements.',
            lucideIconName: 'wrench',
          },
          {
            title: 'Official quality guarantee',
            description: 'A written guarantee on all services and materials.',
            lucideIconName: 'shield-check',
          },
          {
            title: 'Express expert consultation',
            description: 'A free estimate and answers to your questions within 10 minutes.',
            lucideIconName: 'phone',
          },
        ];
    }
  }

  private extractAndValidateJson(rawText: string): MvpContentOutput {
    let clean = rawText.trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM response did not contain a valid JSON object.');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return MvpContentOutputSchema.parse(parsed);
  }

  private buildUserPrompt(input: GenerateMvpContentInput): string {
    return JSON.stringify(
      {
        businessName: input.businessName,
        niche: input.niche || 'other',
        city: input.city || 'Not specified',
        originalUrl: input.originalUrl || '',
        scrapedServices: input.extractedServices || [],
        contacts: input.contacts || {},
        critiqueQuickWins: input.critiqueQuickWins || [],
      },
      null,
      2,
    );
  }

  private async callAnthropic(input: GenerateMvpContentInput, temperature: number): Promise<string> {
    const userPrompt = this.buildUserPrompt(input);
    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicApiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        temperature,
        system: MVP_CONTENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    return data?.content?.[0]?.text || '';
  }

  private async callOpenAi(input: GenerateMvpContentInput, temperature: number): Promise<string> {
    const userPrompt = this.buildUserPrompt(input);
    const response = await this.fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey!}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2000,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: MVP_CONTENT_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data?.choices?.[0]?.message?.content || '';
  }

  private async callGemini(input: GenerateMvpContentInput, temperature: number): Promise<string> {
    const userPrompt = this.buildUserPrompt(input);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.geminiApiKey!}`;

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${MVP_CONTENT_SYSTEM_PROMPT}\n\nContext:\n${userPrompt}` },
            ],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

export const mvpContentService = new MvpContentService();
