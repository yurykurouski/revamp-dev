import { DesignCritiqueOutputSchema, DesignCritiqueOutput } from '@revamp/validation';
import { env } from '../config/env.js';

export interface AnalyzeDesignInput {
  mobileScreenshotWebp: Buffer;
  desktopScreenshotWebp?: Buffer;
  niche?: string;
  a11yScore?: number;
  lcpSeconds?: number;
  businessName?: string;
  originalUrl?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface DesignCritiqueResult {
  critique: DesignCritiqueOutput;
  aiFallbackUsed: boolean;
  modelUsed?: string;
  attempts: number;
  tokenUsage?: TokenUsage;
}

export interface DesignCritiqueServiceOptions {
  provider?: 'anthropic' | 'openai' | 'mock';
  anthropicApiKey?: string;
  openaiApiKey?: string;
  customFetcher?: typeof fetch;
}

export const DESIGN_CRITIQUE_SYSTEM_PROMPT = `You are a lead UX/UI art director and conversion expert for local-business websites.
Your task is to objectively assess the first screen of a website (above the fold) from screenshots and give constructive critique for a redesign proposal.

Inputs:
1. Screenshots of the mobile (375px) and desktop (1440px) versions of the site.
2. The business niche (e.g. dental clinic, auto repair, law firm).
3. Numeric metrics: accessibility score (0-100) and LCP (seconds).

Analysis rules:
- Judge the design strictly from the point of view of a modern mobile visitor (Nielsen heuristics, readability, CTA visibility).
- List exactly 3 Critical Flaws that reduce trust or stop a visitor from getting in touch.
- List exactly 3 Quick Wins that a modern redesign would deliver.
- Write all text in English.
- Respond with a raw JSON object only, with no preamble and no markdown around the JSON.`;

export class DesignCritiqueService {
  private provider: 'anthropic' | 'openai' | 'mock';
  private anthropicApiKey?: string;
  private openaiApiKey?: string;
  private fetcher: typeof fetch;

  constructor(options: DesignCritiqueServiceOptions = {}) {
    this.anthropicApiKey = options.anthropicApiKey ?? env.ANTHROPIC_API_KEY;
    this.openaiApiKey = options.openaiApiKey ?? env.OPENAI_API_KEY;
    this.fetcher = options.customFetcher ?? fetch;

    if (options.provider) {
      this.provider = options.provider;
    } else if (this.anthropicApiKey) {
      this.provider = 'anthropic';
    } else if (this.openaiApiKey) {
      this.provider = 'openai';
    } else {
      this.provider = 'mock';
    }
  }

  /**
   * Analyzes screenshots and metrics to generate a structured design critique.
   * Complies with the Strict Fallback Policy:
   * - 2 retries on parsing error with temperature dropped to 0.0
   * - Deterministic fallback if repeated failure, setting aiFallbackUsed: true
   */
  async analyzeDesign(input: AnalyzeDesignInput): Promise<DesignCritiqueResult> {
    // If mock provider or no keys provided, immediately invoke deterministic fallback
    if (this.provider === 'mock' || (!this.anthropicApiKey && !this.openaiApiKey)) {
      console.log('[DesignCritiqueService] No Vision LLM API key detected. Using deterministic fallback.');
      const critique = this.generateDeterministicFallback(input);
      return {
        critique,
        aiFallbackUsed: true,
        modelUsed: 'deterministic-fallback',
        attempts: 1,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    const temperatures = [0.2, 0.0, 0.0]; // initial attempt + 2 retries with temp 0.0
    let lastError: Error | null = null;
    let attemptsCount = 0;

    for (let attempt = 0; attempt < temperatures.length; attempt++) {
      attemptsCount++;
      const currentTemperature = temperatures[attempt] ?? 0.0;

      try {
        console.log(
          `[DesignCritiqueService] Attempt ${attempt + 1}/${temperatures.length} using ${this.provider} (temp: ${currentTemperature})...`,
        );

        let rawResponse: string;
        let tokenUsage: TokenUsage | undefined;

        if (this.provider === 'anthropic') {
          const res = await this.callAnthropicVision(input, currentTemperature);
          rawResponse = res.rawResponse;
          tokenUsage = res.tokenUsage;
        } else {
          const res = await this.callOpenAiVision(input, currentTemperature);
          rawResponse = res.rawResponse;
          tokenUsage = res.tokenUsage;
        }

        const parsedJson = this.extractAndParseJson(rawResponse);
        const validation = DesignCritiqueOutputSchema.safeParse(parsedJson);

        if (validation.success) {
          console.log(`[DesignCritiqueService] Successfully parsed Vision critique on attempt ${attempt + 1}.`);
          return {
            critique: validation.data,
            aiFallbackUsed: false,
            modelUsed: this.provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o',
            attempts: attemptsCount,
            tokenUsage,
          };
        } else {
          console.warn(
            `[DesignCritiqueService] Validation failed on attempt ${attempt + 1}:`,
            validation.error.format(),
          );
          lastError = new Error(`Validation error: ${JSON.stringify(validation.error.errors)}`);
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[DesignCritiqueService] Error on attempt ${attempt + 1} (${this.provider}):`,
          lastError.message,
        );
      }
    }

    // Strict Fallback Policy: All retries exhausted -> Activate deterministic fallback
    console.warn(
      `[DesignCritiqueService] All ${temperatures.length} attempts failed (${lastError?.message}). Activating deterministic fallback.`,
    );

    const fallbackCritique = this.generateDeterministicFallback(input);
    return {
      critique: fallbackCritique,
      aiFallbackUsed: true,
      modelUsed: `${this.provider}-fallback`,
      attempts: attemptsCount,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * Calls Anthropic Claude 3.5 Sonnet Vision API
   */
  private async callAnthropicVision(
    input: AnalyzeDesignInput,
    temperature: number,
  ): Promise<{ rawResponse: string; tokenUsage?: TokenUsage }> {
    const mobileBase64 = input.mobileScreenshotWebp.toString('base64');
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `Business niche: ${input.niche || 'not specified'}\nAccessibility score (a11yScore): ${input.a11yScore ?? 'N/A'}/100\nLCP: ${input.lcpSeconds ?? 'N/A'} s\n\nAnalyze the attached above-the-fold screenshot and return a clean JSON object that follows the specification.`,
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/webp',
          data: mobileBase64,
        },
      },
    ];

    if (input.desktopScreenshotWebp) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/webp',
          data: input.desktopScreenshotWebp.toString('base64'),
        },
      });
    }

    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicApiKey!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        temperature,
        system: DESIGN_CRITIQUE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const textBlock = data.content?.find((c) => c.type === 'text');
    if (!textBlock?.text) {
      throw new Error('Anthropic response missing text content block');
    }

    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const tokenUsage: TokenUsage | undefined =
      promptTokens || completionTokens
        ? {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          }
        : undefined;

    return { rawResponse: textBlock.text, tokenUsage };
  }

  /**
   * Calls OpenAI GPT-4o Vision API
   */
  private async callOpenAiVision(
    input: AnalyzeDesignInput,
    temperature: number,
  ): Promise<{ rawResponse: string; tokenUsage?: TokenUsage }> {
    const mobileBase64 = input.mobileScreenshotWebp.toString('base64');
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `Business niche: ${input.niche || 'not specified'}\nAccessibility score (a11yScore): ${input.a11yScore ?? 'N/A'}/100\nLCP: ${input.lcpSeconds ?? 'N/A'} s\n\nAnalyze the attached above-the-fold screenshot and return a clean JSON object that follows the specification.`,
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/webp;base64,${mobileBase64}`,
          detail: 'high',
        },
      },
    ];

    if (input.desktopScreenshotWebp) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/webp;base64,${input.desktopScreenshotWebp.toString('base64')}`,
          detail: 'high',
        },
      });
    }

    const response = await this.fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1500,
        temperature,
        messages: [
          { role: 'system', content: DESIGN_CRITIQUE_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = data.choices?.[0]?.message?.content;
    if (!choice) {
      throw new Error('OpenAI response missing message content');
    }

    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;
    const tokenUsage: TokenUsage | undefined =
      promptTokens || completionTokens || totalTokens
        ? {
            promptTokens,
            completionTokens,
            totalTokens,
          }
        : undefined;

    return { rawResponse: choice, tokenUsage };
  }

  /**
   * Helper to clean markdown blocks and parse raw JSON text
   */
  private extractAndParseJson(raw: string): unknown {
    let clean = raw.trim();

    // Strip markdown JSON wrapping if present
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }

    return JSON.parse(clean);
  }

  /**
   * Deterministic fallback generator complying with Strict Fallback Policy (Section 5 of AGENTS.md).
   * Generates grounded, realistic critiques based on deterministic metrics (a11yScore, lcpSeconds, niche).
   */
  generateDeterministicFallback(input: AnalyzeDesignInput): DesignCritiqueOutput {
    const a11y = input.a11yScore ?? 75;
    const lcp = input.lcpSeconds ?? 2.5;
    const niche = input.niche ?? 'other';

    // Derive realistic ratings from deterministic metrics
    const visualHierarchyRating = Math.max(
      30,
      Math.min(85, Math.round(a11y * 0.6 + (lcp <= 2.5 ? 25 : 10))),
    );
    const mobileFriendlinessRating = Math.max(
      25,
      Math.min(85, Math.round(a11y * 0.5 + (lcp <= 2.5 ? 30 : 5))),
    );

    const datedFactors: string[] = [];
    if (a11y < 80) datedFactors.push('low-contrast-typography');
    if (lcp > 2.5) datedFactors.push('heavy-unoptimized-media');
    datedFactors.push('cluttered-mobile-layout');

    // Niche-specific flaw customization
    const nicheFlawTitle =
      niche === 'dental'
        ? 'Booking an appointment is hard'
        : niche === 'auto'
          ? 'No quick repair cost estimate'
          : niche === 'legal'
            ? 'Unclear specialization and legal focus'
            : 'The main call to action gets lost above the fold';

    const nicheFlawImpact =
      niche === 'dental'
        ? 'Patients on smartphones cannot find the online booking button and go to competing clinics.'
        : niche === 'auto'
          ? 'Car owners cannot get an instant price estimate and call other garages instead.'
          : niche === 'legal'
            ? 'Prospective clients do not grasp the value of a consultation within the first 3 seconds.'
            : 'Mobile visitors struggle to find a way to get in touch.';

    const nicheRecommendation =
      niche === 'dental'
        ? 'Pin a "Book an appointment" bar in the header and on the first mobile screen.'
        : niche === 'auto'
          ? 'Add an interactive 2-step service cost estimator right in the hero section.'
          : niche === 'legal'
            ? 'Bring a quick case-evaluation form and the key outcome into the main headline.'
            : 'Place a high-contrast call-to-action button above the fold.';

    const fallback: DesignCritiqueOutput = {
      visualHierarchyRating,
      mobileFriendlinessRating,
      primaryCtaFound: visualHierarchyRating > 50,
      datedDesignFactors: datedFactors.slice(0, 5),
      criticalFlaws: [
        {
          title: nicheFlawTitle,
          impact: nicheFlawImpact,
          recommendation: nicheRecommendation,
        },
        {
          title:
            a11y < 75
              ? 'Low text-to-background color contrast'
              : 'Visual noise and an overloaded first screen',
          impact:
            a11y < 75
              ? 'Text is hard to read in bright daylight on phones and fails WCAG 2.1 AA.'
              : 'Visitor attention is split across several inconsistent visual blocks.',
          recommendation:
            a11y < 75
              ? 'Raise text contrast to at least 4.5:1 and refresh the typography.'
              : 'Use a modern Bento card grid with a clear visual hierarchy.',
        },
        {
          title:
            lcp > 2.5
              ? 'Slow rendering of the main content (LCP)'
              : 'No immediate trust signals (social proof)',
          impact:
            lcp > 2.5
              ? `The largest element takes ${lcp}s to load, which increases the bounce rate.`
              : 'The first screen shows no ratings, reviews or guarantees, which lowers initial trust.',
          recommendation:
            lcp > 2.5
              ? 'Compress images to WebP and serve responsive image sizes.'
              : 'Surface existing ratings and customer testimonials near the top of the page.',
        },
      ],
      quickWins: [
        'Pin a quick-contact call-to-action bar to the bottom of the mobile screen.',
        'Rebuild the first screen in a clean Bento style with a high-contrast value proposition.',
        'Add a social-proof strip with real ratings and customer reviews.',
      ],
    };

    // Strictly validate through Zod to guarantee conformance
    return DesignCritiqueOutputSchema.parse(fallback);
  }
}

export const designCritiqueService = new DesignCritiqueService();
