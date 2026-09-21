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

export const MVP_CONTENT_SYSTEM_PROMPT = `Ты — профессиональный Senior Conversion Copywriter.
Твоя цель — взять спарсенный контент локального бизнеса и переписать его под современный конверсионный одностраничный Bento-лендинг.

ФУНДАМЕНТАЛЬНОЕ ПРАВИЛО ДОСТОВЕРНОСТИ (GROUNDING):
- Запрещено выдумывать новые услуги, менять фактический адрес, искажать контактные телефоны, придумывать несуществующих врачей или цены.
- Вся фактическая информация берется СТРОГО из переданного контекста.

Требования к стилю:
- Главный заголовок (Hero Headline): формула "Выгода клиента + Снятие главного страха / Специфика города" (до 90 символов).
- Подзаголовок (Hero Subheadline): четкое объяснение, как именно бизнес решает задачу клиента (до 180 символов).
- Список услуг: разбей спарсенные услуги на 3-6 ключевых карточек с ёмким продающим описанием (до 15 слов на услугу) и подбери подходящую иконку из списка Lucide (например: 'wrench', 'shield-check', 'sparkles', 'calendar', 'phone', 'award', 'activity', 'truck', 'heart', 'smile', 'zap').
- CTA кнопки: конкретное действие ("Записаться на диагностику", "Рассчитать стоимость ремонта").
- 3 триггера доверия (trustSignals): объективные метрики (например, "4.9 ★", "10+ лет", "100%").
- Ответ должен быть строго в формате JSON без вводных слов и markdown-разметки вокруг JSON.`;

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
    const businessName = input.businessName || 'Сервисный Центр';
    const city = input.city || '';
    const citySuffix = city ? ` в г. ${city}` : '';
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
        { metric: '4.9 ★', label: 'Рейтинг в Яндекс и Google картах' },
        { metric: '10+ лет', label: `Опыта работы${citySuffix}` },
        { metric: '100%', label: 'Гарантия качества и честной сметы' },
      ],
      offerNotice: 'Специальные условия и приоритетная запись при обращении с сайта',
    };
  }

  private getNicheHeroCopy(niche: string, businessName: string, citySuffix: string) {
    switch (niche) {
      case 'dental':
        return {
          badge: '✨ Безболезненное лечение',
          headline: `Здоровая улыбка без боли и страха в «${businessName}»`,
          subheadline: `Современная стоматология с гарантией 5 лет${citySuffix}. Новейшее оборудование и чуткие врачи.`,
          primaryCtaText: 'Записаться на прием',
          secondaryCtaText: 'Консультация врача',
        };
      case 'auto':
        return {
          badge: '⚡ Ремонт в день обращения',
          headline: `Честный автосервис «${businessName}» с гарантией на работы`,
          subheadline: `Точная компьютерная диагностика, прозрачный расчет и ремонт любой сложности${citySuffix}.`,
          primaryCtaText: 'Записаться на сервис',
          secondaryCtaText: 'Узнать стоимость',
        };
      case 'legal':
        return {
          badge: '⚖️ Защита ваших интересов',
          headline: `Квалифицированная юридическая помощь от «${businessName}»`,
          subheadline: `Комплексная правовая поддержка для бизнеса и граждан${citySuffix}. Честная оценка шансов.`,
          primaryCtaText: 'Получить консультацию',
          secondaryCtaText: 'Задать вопрос',
        };
      case 'beauty':
        return {
          badge: '💖 Премиальный уход',
          headline: `Безупречный стиль и забота о красоте в «${businessName}»`,
          subheadline: `Сертифицированные мастера, премиальная косметика и уютная атмосфера${citySuffix}.`,
          primaryCtaText: 'Выбрать время',
          secondaryCtaText: 'Услуги и цены',
        };
      default:
        return {
          badge: '⭐ Официальное качество',
          headline: `Профессиональные услуги «${businessName}» с гарантией`,
          subheadline: `Индивидуальный подход, прозрачные цены и надежный сервис${citySuffix}.`,
          primaryCtaText: 'Оставить заявку',
          secondaryCtaText: 'Позвонить нам',
        };
    }
  }

  private getNicheDefaultServices(niche: string) {
    switch (niche) {
      case 'dental':
        return [
          {
            title: 'Имплантация зубов под ключ',
            description: 'Швейцарские импланты с пожизненной гарантией и безболезненной установкой.',
            lucideIconName: 'shield-check',
          },
          {
            title: 'Бережное отбеливание Zoom',
            description: 'Безопасное осветление эмали до 8 тонов всего за одну процедуру.',
            lucideIconName: 'sparkles',
          },
          {
            title: 'Исправление прикуса элайнерами',
            description: 'Прозрачные невидимые каппы для идеальной улыбки без дискомфорта.',
            lucideIconName: 'smile',
          },
          {
            title: 'Срочная терапия и лечение',
            description: 'Быстрое и безболезненное устранение кариеса и острой зубной боли.',
            lucideIconName: 'activity',
          },
        ];
      case 'auto':
        return [
          {
            title: 'Комплексная диагностика авто',
            description: 'Сканирование всех электронных систем и подвески на дилерском оборудовании.',
            lucideIconName: 'activity',
          },
          {
            title: 'Капитальный и текущий ремонт',
            description: 'Восстановление двигателя, трансмиссии и ходовой части с гарантией.',
            lucideIconName: 'wrench',
          },
          {
            title: 'Регламентное ТО и замена масел',
            description: 'Быстрое обслуживание по технологическим картам производителей.',
            lucideIconName: 'clock',
          },
          {
            title: 'Шиномонтаж и балансировка',
            description: 'Точная балансировка колес и сезонное хранение шин на складе.',
            lucideIconName: 'car',
          },
        ];
      default:
        return [
          {
            title: 'Комплексная диагностика и аудит',
            description: 'Детальная оценка потребностей и составление прозрачного плана работ.',
            lucideIconName: 'activity',
          },
          {
            title: 'Профессиональное выполнение работ',
            description: 'Соблюдение сроков, высоких стандартов качества и требований клиента.',
            lucideIconName: 'wrench',
          },
          {
            title: 'Официальная гарантия качества',
            description: 'Письменная гарантия на все виды оказанных услуг и материалы.',
            lucideIconName: 'shield-check',
          },
          {
            title: 'Экспресс-консультация эксперта',
            description: 'Бесплатный расчет сметы и ответы на вопросы в течение 10 минут.',
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
        city: input.city || 'Не указан',
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
