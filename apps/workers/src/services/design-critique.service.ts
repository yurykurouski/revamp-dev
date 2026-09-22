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

export const DESIGN_CRITIQUE_SYSTEM_PROMPT = `Ты — ведущий UX/UI арт-директор и эксперт по конверсии веб-сайтов локального бизнеса.
Твоя задача — объективно оценить первый экран сайта (above-the-fold) по скриншоту и предоставить конструктивную критику для коммерческого предложения по редизайну.

Входные данные:
1. Скриншот мобильной версии сайта (375px) и десктопной версии (1440px).
2. Ниша бизнеса (например: стоматология, автосервис, юрист).
3. Числовые метрики: оценка a11y (0-100) и LCP (сек).

Правила анализа:
- Оценивай дизайн строго с точки зрения современного мобильного пользователя (эвристики Нильсена, читаемость, заметность CTA).
- Сформулируй ровно 3 критических недостатка (Critical Flaws), которые снижают доверие или мешают посетителю оставить заявку.
- Сформулируй ровно 3 точки быстрого роста (Quick Wins), которые даст современный редизайн.
- Ответ должен быть строго в формате JSON без вводных слов и markdown-разметки вокруг JSON.`;

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
        text: `Ниша бизнеса: ${input.niche || 'не указана'}\nОценка доступности (a11yScore): ${input.a11yScore ?? 'N/A'}/100\nВремя LCP: ${input.lcpSeconds ?? 'N/A'} сек\n\nПроанализируй приложенный скриншот первого экрана и верни чистый JSON объект по спецификации.`,
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
        text: `Ниша бизнеса: ${input.niche || 'не указана'}\nОценка доступности (a11yScore): ${input.a11yScore ?? 'N/A'}/100\nВремя LCP: ${input.lcpSeconds ?? 'N/A'} сек\n\nПроанализируй приложенный скриншот первого экрана и верни чистый JSON объект по спецификации.`,
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
        ? 'Сложная запись на прием к врачу'
        : niche === 'auto'
          ? 'Отсутствует быстрый расчет стоимости ремонта'
          : niche === 'legal'
            ? 'Размытая специализация и юридический профиль'
            : 'Основное целевое действие теряется на первом экране';

    const nicheFlawImpact =
      niche === 'dental'
        ? 'Пациенты со смартфонов не видят кнопку онлайн-записи и уходят в клиники конкурентов.'
        : niche === 'auto'
          ? 'Автовладельцы не находят мгновенный расчет цены и звонят другим автосервисам.'
          : niche === 'legal'
            ? 'Потенциальные доверители не считывают первичную выгоду консультации за первые 3 секунды.'
            : 'Посетители с мобильных устройств испытывают трудности с поиском кнопки связи.';

    const nicheRecommendation =
      niche === 'dental'
        ? 'Закрепить плашку "Записаться на прием" в шапке и первом экране смартфона.'
        : niche === 'auto'
          ? 'Добавить интерактивный 2-шаговый виджет расчета ТО прямо в hero-секцию.'
          : niche === 'legal'
            ? 'Вынести форму экспресс-оценки дела и ключевой результат в главный заголовок.'
            : 'Разместить контрастную кнопку целевого действия над линией сгиба (above-the-fold).';

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
              ? 'Низкий цветовой контраст текста и фона'
              : 'Визуальный шум и перегруженность первого экрана',
          impact:
            a11y < 75
              ? 'Текст сложно читать при ярком дневном свете на смартфонах, нарушается WCAG 2.1 AA.'
              : 'Внимание посетителя рассеивается между несколькими несогласованными графическими блоками.',
          recommendation:
            a11y < 75
              ? 'Увеличить контрастность шрифтов до коэффициента 4.5:1 и обновить типографику.'
              : 'Использовать современную карточную Bento-сетку с четкой иерархией акцентов.',
        },
        {
          title:
            lcp > 2.5
              ? 'Задержка отрисовки главного контента (LCP)'
              : 'Отсутствие мгновенных триггеров доверия (Social Proof)',
          impact:
            lcp > 2.5
              ? `Время загрузки ключевого элемента составляет ${lcp}s, что повышает показатель отказов.`
              : 'Первый экран не сообщает о рейтинге, отзывах или гарантиях, снижая первичное доверие.',
          recommendation:
            lcp > 2.5
              ? 'Сжать графические ассеты в WebP и внедрить адаптивные размеры картинок.'
              : 'Добавить плашку с рейтингом в геосервисах (Яндекс/Google Карты) и числом довольных клиентов.',
        },
      ],
      quickWins: [
        'Закрепить мобильную панель быстрой связи (Call-to-Action) внизу экрана смартфона.',
        'Переработать первый экран в чистый Bento-стиль с контрастным предложением ценности.',
        'Добавить плашку социальных доказательств с рейтингом 4.9+ и отзывами клиентов.',
      ],
    };

    // Strictly validate through Zod to guarantee conformance
    return DesignCritiqueOutputSchema.parse(fallback);
  }
}

export const designCritiqueService = new DesignCritiqueService();
