import { MvpContentOutputSchema, MvpContentOutput } from '@revamp/validation';
import { ISiteContent } from '@revamp/shared-types';
import { env } from '../config/env.js';
import { getSupportedIconNames } from '../templates/icons.js';
import { getMvpStrings, languageDisplayName, sanitizeLanguageTag } from '../templates/mvp-locale.js';
import { ClaudeCliRunner, createClaudeCliRunner } from './claude-cli.js';

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
    workingHours?: string;
  };
  /** The original site's own copy and structure (REV-23) - the single source of facts */
  siteContent?: ISiteContent;
  critiqueQuickWins?: string[];
  ownerName?: string;
}

export interface MvpContentGenerationResult {
  content: MvpContentOutput;
  aiFallbackUsed: boolean;
  modelUsed?: string;
  attempts: number;
}

export type MvpContentProvider = 'anthropic' | 'openai' | 'gemini' | 'claude-cli' | 'mock';

export interface MvpContentServiceOptions {
  provider?: MvpContentProvider;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  customFetcher?: typeof fetch;
  /** Replaces the local Claude Code CLI call for the 'claude-cli' provider (REV-30) */
  claudeCliRunner?: ClaudeCliRunner;
}

export const MVP_CONTENT_SYSTEM_PROMPT = `You are a professional Senior Conversion Copywriter.
You receive the content scraped from a local business's current website. Rewrite it into the copy for a modern, high-converting one-page Bento landing page for THAT specific business: keep everything the original site says, but make it clearer, more persuasive and better structured.

FUNDAMENTAL GROUNDING RULES:
- Every fact (services, products, locations, numbers, years, ratings, prices, staff, awards) must come from the provided context. Never invent any of them.
- Never output phone numbers, email addresses or street addresses; they are rendered separately from verified data.
- Use the business's own specifics (its name, what it actually offers, its wording and its selling points) so the copy could not belong to any other business.
- trustSignals: include at most 3, and only metrics whose numbers literally appear in the context (e.g. a rating or a founding year). Return an empty array when there are none.

Language:
- Write all copy in the language named in "outputLanguage" - the original site's own language. Never translate the copy into English or any other language.
- Keep the business's own terms, service names and proper nouns exactly as the original site spells them.

Style requirements:
- hero.headline: customer benefit + what makes this business specific (up to 90 characters).
- hero.subheadline: how the business solves the customer's problem, based on its own description (up to 180 characters).
- about: a heading (up to 80 characters) and 2-4 sentences (up to 700 characters) retelling the business's own story and strengths.
- services: 1-6 cards built from the services the site lists, each with a concise, persuasive description (up to 15 words) and a matching Lucide icon (e.g. 'wrench', 'shield-check', 'sparkles', 'calendar', 'phone', 'award', 'activity', 'truck', 'heart', 'smile', 'zap', 'car', 'clock', 'star', 'stethoscope').
- CTA buttons: a concrete action that fits this business.

Respond with a raw JSON object only, with no preamble and no markdown, in exactly this shape:
{"hero":{"badge":string,"headline":string,"subheadline":string,"primaryCtaText":string,"secondaryCtaText":string},"about":{"heading":string,"body":string},"servicesHeading":string,"services":[{"title":string,"description":string,"lucideIconName":string}],"trustSignals":[{"metric":string,"label":string}],"offerNotice":string}`;

/** Navigation labels that are site chrome rather than an offering */
const NON_SERVICE_NAV =
  /^(home|start|main|about|about us|contact|contacts|kontakt|o nas|o centrum|blog|news|aktualno|faq|login|log in|sign in|register|cart|koszyk|search|szukaj|privacy|polityka|regulamin|terms|cookies?|career|careers|praca|jobs|menu|pl|en|de|ru|ua|главная|о нас|контакты|новости)$/i;

/** Page titles that name the page type rather than the business ("Home page") */
const GENERIC_PAGE_TITLES =
  /^(home|home ?page|homepage|main page|welcome|start|strona g[łl][óo]wna|startseite|accueil|inicio|главная( страница)?|головна)$/i;

/** Headings that label a page section rather than state anything about the business */
const GENERIC_SECTION_TITLES =
  /^(opening hours|contact( us)?|our services|services|about( us)?|newsletter|subscribe|follow us|godziny otwarcia|kontakt|nasze usługi|usługi|o nas|zapisz się|bądź na bieżąco|часы работы|контакты|услуги|о нас)!?$/i;

/** Keyword → Lucide icon, used to pick grounded icons for extracted services */
const ICON_KEYWORDS: Array<[RegExp, string]> = [
  // Specific treatments first, so dental services do not all collapse into one generic icon
  [/implant|имплант/i, 'shield-check'],
  [/veneer|licówk|crown|koron|bonding|whiten|wybiel|виниры|корон/i, 'sparkles'],
  [/extract|usuwan|surgery|chirurg|удален/i, 'activity'],
  [/filling|wypełn|plomb|root canal|kanałow|endodon|пломб/i, 'shield-check'],
  [/orthodon|ortodon|aligner|invisalign|brace|aparat|брекет/i, 'smile'],
  [/implant|tooth|teeth|dent|smile|zęb|стомат|зуб/i, 'smile'],
  [/whiten|clean|shine|beauty|cosmet|spa|hair|nail|kosmet|fryzj/i, 'sparkles'],
  [/repair|fix|mechanic|tyre|tire|engine|napraw|serwis|ремонт/i, 'wrench'],
  [/car|auto|vehicle|samoch|авто/i, 'car'],
  [/deliver|courier|shipping|transport|dostaw|kurier|достав/i, 'truck'],
  [/legal|law|court|lawyer|prawn|adwokat|юрист|прав/i, 'shield-check'],
  [/doctor|medical|clinic|health|therapy|lekar|zdrow|врач|мед/i, 'stethoscope'],
  [/food|restaurant|cafe|kitchen|eat|restaur|kuchn|jedzen|рестор|кафе/i, 'heart'],
  [/shop|store|sklep|zakup|buy|магазин/i, 'award'],
  [/event|calendar|book|appointment|wydarz|termin|запис/i, 'calendar'],
  [/fast|express|quick|24|szybk|срочн/i, 'zap'],
  [/hour|time|schedule|godzin|время/i, 'clock'],
  [/fitness|gym|sport|training|trening|спорт/i, 'activity'],
  [/phone|call|consult|advice|porad|консульт/i, 'phone'],
];

/**
 * Clips text to maxLength at a word boundary, preferring a sentence end.
 */
export function clipText(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const slice = clean.slice(0, maxLength);
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (sentenceEnd >= maxLength * 0.5) return slice.slice(0, sentenceEnd + 1);
  const wordEnd = slice.lastIndexOf(' ');
  return (wordEnd > 0 ? slice.slice(0, wordEnd) : slice).replace(/[\s,;:–—-]+$/, '');
}

export class MvpContentService {
  private provider: MvpContentProvider;
  private anthropicApiKey?: string;
  private openaiApiKey?: string;
  private geminiApiKey?: string;
  private fetcher: typeof fetch;
  private claudeCliRunner: ClaudeCliRunner;

  constructor(options: MvpContentServiceOptions = {}) {
    this.anthropicApiKey = options.anthropicApiKey ?? env.ANTHROPIC_API_KEY;
    this.openaiApiKey = options.openaiApiKey ?? env.OPENAI_API_KEY;
    this.geminiApiKey = options.geminiApiKey ?? env.GEMINI_API_KEY;
    this.fetcher = options.customFetcher ?? fetch;
    this.claudeCliRunner =
      options.claudeCliRunner ??
      createClaudeCliRunner({
        cliPath: env.CLAUDE_CLI_PATH,
        model: env.CLAUDE_CLI_MODEL,
        timeoutMs: env.CLAUDE_CLI_TIMEOUT_MS,
      });

    const configuredProvider = options.provider ?? env.MVP_LLM_PROVIDER;
    if (configuredProvider) {
      this.provider = configuredProvider;
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
    // The local Claude CLI authenticates itself, so it needs no API key
    if (
      this.provider === 'mock' ||
      (this.provider !== 'claude-cli' && !this.anthropicApiKey && !this.openaiApiKey && !this.geminiApiKey)
    ) {
      console.log('[MvpContentService] No LLM provider configured. Using deterministic grounded copy.');
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
        if (this.provider === 'claude-cli') {
          // The CLI has no temperature setting; retries simply re-run it
          rawResponse = await this.claudeCliRunner({
            systemPrompt: MVP_CONTENT_SYSTEM_PROMPT,
            userPrompt: this.buildUserPrompt(input),
          });
        } else if (this.provider === 'anthropic') {
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
   * Enforces Strict Grounding on LLM output:
   * 1. Validates and normalizes Lucide icon names against known icons.
   * 2. Drops trust-signal metrics whose numbers do not appear in the original site content.
   * 3. Pads missing services only with services extracted from the site, never with boilerplate.
   * 4. Sanitizes lengths to schema bounds.
   */
  public enforceStrictGrounding(
    raw: MvpContentOutput,
    input: GenerateMvpContentInput,
  ): MvpContentOutput {
    const normalizedServices = raw.services.slice(0, 6).map((service) => ({
      title: clipText(service.title, 50),
      description: clipText(service.description, 120),
      lucideIconName: this.normalizeIcon(service.lucideIconName, service.title),
    }));

    if (normalizedServices.length < 3) {
      for (const extracted of this.buildGroundedServices(input)) {
        if (normalizedServices.length >= 3) break;
        if (!normalizedServices.some((s) => s.title.toLowerCase() === extracted.title.toLowerCase())) {
          normalizedServices.push(extracted);
        }
      }
    }

    const corpus = this.buildGroundingCorpus(input);
    const trustSignals = raw.trustSignals
      .filter((ts) => this.isMetricGrounded(ts.metric, corpus))
      .slice(0, 3)
      .map((ts) => ({ metric: clipText(ts.metric, 20), label: clipText(ts.label, 50) }));

    return {
      hero: {
        badge: clipText(raw.hero.badge, 40),
        headline: clipText(raw.hero.headline, 90),
        subheadline: clipText(raw.hero.subheadline, 180),
        primaryCtaText: clipText(raw.hero.primaryCtaText, 35),
        secondaryCtaText: clipText(raw.hero.secondaryCtaText, 35),
      },
      about:
        raw.about && raw.about.body.trim()
          ? { heading: clipText(raw.about.heading, 80), body: clipText(raw.about.body, 700) }
          : this.buildAbout(input),
      servicesHeading: raw.servicesHeading ? clipText(raw.servicesHeading, 80) : undefined,
      services: normalizedServices,
      trustSignals,
      offerNotice: clipText(raw.offerNotice, 100),
    };
  }

  /**
   * Deterministic copy built from the original site's own content when no LLM is available.
   * Every field is derived from that business's extracted data, so two different sites never
   * produce the same MVP, and no facts are invented.
   */
  public generateDeterministicFallback(input: GenerateMvpContentInput): MvpContentOutput {
    const t = this.strings(input);
    const businessName = input.businessName || t.ourBusiness;
    const niche = this.nicheKey(input);
    const site = input.siteContent;

    return {
      hero: {
        badge: clipText(this.buildBadge(input), 40),
        headline: clipText(this.buildHeadline(input), 90),
        subheadline: clipText(this.buildSubheadline(input), 180),
        primaryCtaText: t.nicheCta[niche],
        secondaryCtaText: input.contacts?.phone ? t.callUs : input.contacts?.email ? t.emailUs : t.contactUs,
      },
      about: this.buildAbout(input),
      servicesHeading: clipText(t.servicesHeading(businessName), 80),
      services: this.buildGroundedServices(input).slice(0, 6).length
        ? this.buildGroundedServices(input).slice(0, 6)
        : [
            {
              title: clipText(t.nicheLabels[niche], 50),
              description: clipText(site?.metaDescription || site?.paragraphs[0] || businessName, 120),
              lucideIconName: this.normalizeIcon(undefined, `${niche} ${businessName}`),
            },
          ],
      trustSignals: this.buildGroundedTrustSignals(input),
      offerNotice: clipText(
        input.contacts?.phone
          ? t.offerCall(input.contacts.phone)
          : t.offerOnline,
        100,
      ),
    };
  }

  /** Headline: the site's own H1 or page title, otherwise the business name */
  private buildHeadline(input: GenerateMvpContentInput): string {
    const site = input.siteContent;
    const titleParts = (site?.title || '').split(/\s+[|–—:-]\s+/).map((p) => p.trim());
    // Section titles ("Opening hours", "Contact") are two words or less; real value statements are longer
    const headingCandidates = (site?.headings || [])
      .slice(0, 6)
      .filter((h) => h.split(/\s+/).length >= 3 && !GENERIC_SECTION_TITLES.test(h.trim()));
    const candidates = [site?.h1, ...titleParts, ...headingCandidates]
      .filter((c): c is string => Boolean(c))
      .filter((c) => c.length >= 12 && c.length <= 120 && !GENERIC_PAGE_TITLES.test(c.trim()));
    return candidates[0] || input.businessName;
  }

  /** Subheadline: meta description or the site's first descriptive paragraph */
  private buildSubheadline(input: GenerateMvpContentInput): string {
    const site = input.siteContent;
    const t = this.strings(input);
    return (
      site?.metaDescription ||
      site?.paragraphs[0] ||
      t.nicheBy(t.nicheLabels[this.nicheKey(input)], input.businessName, input.city)
    );
  }

  /** Badge: the strongest real fact available (rating, founding year, city) */
  private buildBadge(input: GenerateMvpContentInput): string {
    const site = input.siteContent;
    const t = this.strings(input);
    if (site?.rating) return t.ratingBadge(site.rating.value);
    if (site?.foundingYear) return t.since(site.foundingYear);
    if (input.city) return `📍 ${input.city}`;
    return t.nicheLabels[this.nicheKey(input)];
  }

  /** About section from the site's own paragraphs */
  private buildAbout(input: GenerateMvpContentInput): { heading: string; body: string } | undefined {
    const paragraphs = input.siteContent?.paragraphs || [];
    if (paragraphs.length === 0) return undefined;
    let body = '';
    for (const p of paragraphs) {
      if ((body + ' ' + p).trim().length > 700) break;
      body = `${body} ${p}`.trim();
    }
    return {
      heading: clipText(this.strings(input).aboutHeading(input.businessName), 80),
      body: body || clipText(paragraphs[0]!, 700),
    };
  }

  /**
   * Services from the original site, in priority order: service blocks, extracted service
   * titles, then navigation sections. Descriptions come from the site whenever it has one.
   */
  public buildGroundedServices(input: GenerateMvpContentInput) {
    const site = input.siteContent;
    const items: Array<{ title: string; description?: string }> = [...(site?.serviceItems || [])];
    for (const title of input.extractedServices || []) {
      if (!items.some((i) => i.title.toLowerCase() === title.toLowerCase())) items.push({ title });
    }
    if (items.length < 3) {
      for (const nav of site?.navItems || []) {
        if (items.length >= 6) break;
        if (NON_SERVICE_NAV.test(nav.trim()) || nav.toLowerCase() === input.businessName.toLowerCase()) continue;
        if (!items.some((i) => i.title.toLowerCase() === nav.toLowerCase())) items.push({ title: nav });
      }
    }

    return items.slice(0, 6).map((item) => {
      const title = clipText(this.toTitleCase(item.title), 50);
      const description =
        item.description || this.findParagraphMentioning(item.title, site?.paragraphs || []) || this.strings(input).serviceAt(title, input.businessName);
      return {
        title,
        description: clipText(description, 120),
        // The service's own words pick the icon; the niche is only a tie-breaker
        lucideIconName: this.normalizeIcon(undefined, `${item.title} ${item.description || ''}`, input.niche),
      };
    });
  }

  /** Trust signals only from verifiable data: structured rating and founding year */
  private buildGroundedTrustSignals(input: GenerateMvpContentInput) {
    const site = input.siteContent;
    const t = this.strings(input);
    const signals: Array<{ metric: string; label: string }> = [];
    if (site?.rating) {
      signals.push({
        metric: `${site.rating.value} ★`,
        label: site.rating.count ? t.averageRatingFrom(site.rating.count) : t.averageRating,
      });
    }
    if (site?.foundingYear) {
      signals.push({ metric: t.since(site.foundingYear), label: t.servingFor(new Date().getFullYear() - site.foundingYear) });
    }
    if ((site?.testimonials.length || 0) >= 2) {
      signals.push({ metric: `${site!.testimonials.length}`, label: t.testimonialsOnSite });
    }
    return signals.slice(0, 3);
  }

  /** Fixed wording of the deterministic copy, in the original site's language (REV-25) */
  private strings(input: GenerateMvpContentInput) {
    return getMvpStrings(input.siteContent?.language);
  }

  private nicheKey(input: GenerateMvpContentInput): keyof ReturnType<typeof getMvpStrings>['nicheLabels'] {
    const niche = input.niche || 'other';
    return niche in this.strings(input).nicheLabels ? (niche as 'other') : 'other';
  }

  /**
   * Language instruction for the LLM: the original site's declared language, or - when the
   * site declares none - whatever language its text is written in.
   */
  public resolveOutputLanguage(input: GenerateMvpContentInput): string {
    const tag = sanitizeLanguageTag(input.siteContent?.language);
    if (!tag) return 'the language the original site text is written in (English if it cannot be determined)';
    return `${languageDisplayName(tag)} (${tag})`;
  }

  /** All source text a grounded metric may cite */
  private buildGroundingCorpus(input: GenerateMvpContentInput): string {
    const site = input.siteContent;
    return [
      site?.title,
      site?.metaDescription,
      site?.h1,
      ...(site?.headings || []),
      ...(site?.paragraphs || []),
      ...(site?.serviceItems || []).map((s) => `${s.title} ${s.description || ''}`),
      ...(site?.testimonials || []).map((t) => t.text),
      site?.rating ? `${site.rating.value} ${site.rating.count ?? ''}` : '',
      site?.foundingYear ? String(site.foundingYear) : '',
      String(site?.testimonials.length ?? ''),
    ]
      .filter(Boolean)
      .join(' \n ')
      .toLowerCase();
  }

  /** A metric is grounded when every number in it appears in the source text */
  private isMetricGrounded(metric: string, corpus: string): boolean {
    const numbers = metric.match(/\d+(?:[.,]\d+)?/g);
    if (!numbers) return corpus.includes(metric.toLowerCase().trim());
    return numbers.every((n) => corpus.includes(n) || corpus.includes(n.replace(',', '.')) || corpus.includes(n.replace('.', ',')));
  }

  private findParagraphMentioning(title: string, paragraphs: string[]): string | undefined {
    const keyword = title
      .toLowerCase()
      .split(/\s+/)
      .find((w) => w.length >= 5);
    if (!keyword) return undefined;
    return paragraphs.find((p) => p.toLowerCase().includes(keyword));
  }

  private toTitleCase(text: string): string {
    const clean = text.trim();
    // Menu labels are often upper-cased by CSS/markup; restore sentence case
    if (clean === clean.toUpperCase() && /\p{L}/u.test(clean)) {
      const lower = clean.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    return clean;
  }

  private normalizeIcon(iconName: string | undefined, context: string, fallbackContext?: string): string {
    const supportedIcons = new Set(getSupportedIconNames());
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
      time: 'clock',
      fast: 'zap',
      speed: 'zap',
      call: 'phone',
      telephone: 'phone',
      rating: 'award',
      trophy: 'award',
      delivery: 'truck',
      courier: 'truck',
      box: 'truck',
      clean: 'sparkles',
      magic: 'sparkles',
    };

    if (iconName) {
      const normalized = iconName.toLowerCase().trim().replace(/_/g, '-');
      if (supportedIcons.has(normalized)) return normalized;
      const alias = iconAliasMap[normalized];
      if (alias && supportedIcons.has(alias)) return alias;
    }

    const byKeyword =
      ICON_KEYWORDS.find(([pattern]) => pattern.test(context)) ||
      (fallbackContext ? ICON_KEYWORDS.find(([pattern]) => pattern.test(fallbackContext)) : undefined);
    const candidate = byKeyword ? byKeyword[1] : 'sparkles';
    return supportedIcons.has(candidate) ? candidate : 'sparkles';
  }

  private extractAndValidateJson(rawText: string): MvpContentOutput {
    const clean = rawText.trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM response did not contain a valid JSON object.');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return MvpContentOutputSchema.parse(parsed);
  }

  /**
   * Grounding context for the LLM: the original site's own content plus verified contacts.
   */
  private buildUserPrompt(input: GenerateMvpContentInput): string {
    const site = input.siteContent;
    return JSON.stringify(
      {
        businessName: input.businessName,
        outputLanguage: this.resolveOutputLanguage(input),
        niche: input.niche || 'other',
        city: input.city || 'Not specified',
        originalUrl: input.originalUrl || '',
        originalSite: site
          ? {
              language: site.language,
              title: site.title,
              metaDescription: site.metaDescription,
              h1: site.h1,
              headings: site.headings.slice(0, 12),
              paragraphs: site.paragraphs.slice(0, 8).map((p) => clipText(p, 400)),
              services: site.serviceItems.slice(0, 10),
              navigation: site.navItems.slice(0, 12),
              testimonialsCount: site.testimonials.length,
              rating: site.rating,
              foundingYear: site.foundingYear,
            }
          : undefined,
        scrapedServices: input.extractedServices || [],
        hasPhone: Boolean(input.contacts?.phone),
        hasAddress: Boolean(input.contacts?.address),
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
