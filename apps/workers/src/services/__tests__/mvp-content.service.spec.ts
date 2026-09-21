import { describe, it, expect, vi } from 'vitest';
import { MvpContentService, GenerateMvpContentInput } from '../mvp-content.service.js';
import { MvpContentOutputSchema } from '@revamp/validation';
import { getSupportedIconNames } from '../../templates/icons.js';

describe('MvpContentService (@revamp/workers)', () => {
  const sampleInput: GenerateMvpContentInput = {
    businessName: 'Стоматология Дент-Престиж',
    niche: 'dental',
    city: 'Санкт-Петербург',
    originalUrl: 'https://dent-prestige.spb.ru',
    extractedServices: [
      'Имплантация зубов',
      'Профессиональная гигиена',
      'Отбеливание эмали Zoom',
      'Лечение кариеса под микроскопом',
    ],
    contacts: {
      phone: '+7 (812) 345-67-89',
      email: 'info@dent-prestige.spb.ru',
      address: 'Лиговский пр., 45',
    },
    critiqueQuickWins: [
      'Добавить 1-click форму записи на первом экране',
      'Подчеркнуть гарантию 5 лет и безболезненность',
      'Вынести отзывы реальных пациентов наверх',
    ],
  };

  it('should use deterministic fallback when no API keys are provided', async () => {
    const service = new MvpContentService({ provider: 'mock' });
    const result = await service.generateContent(sampleInput);

    expect(result.aiFallbackUsed).toBe(true);
    expect(result.modelUsed).toBe('deterministic-fallback');
    expect(result.attempts).toBe(1);

    // Validate with Zod schema
    const validated = MvpContentOutputSchema.parse(result.content);
    expect(validated.hero.headline).toContain('Дент-Престиж');
    expect(validated.services.length).toBeGreaterThanOrEqual(3);
    expect(validated.services.length).toBeLessThanOrEqual(6);
    expect(validated.trustSignals).toHaveLength(3);
  });

  it('should ground extracted services in deterministic fallback', async () => {
    const service = new MvpContentService({ provider: 'mock' });
    const result = await service.generateContent(sampleInput);

    const serviceTitles = result.content.services.map((s) => s.title);
    expect(serviceTitles).toContain('Имплантация зубов');
    expect(serviceTitles).toContain('Профессиональная гигиена');
  });

  it('should generate niche-specific copy for auto repair when services are empty', async () => {
    const service = new MvpContentService({ provider: 'mock' });
    const autoInput: GenerateMvpContentInput = {
      businessName: 'Автосервис Мотор-Про',
      niche: 'auto',
      city: 'Москва',
    };

    const result = await service.generateContent(autoInput);
    expect(result.content.hero.headline).toContain('Мотор-Про');
    expect(result.content.hero.badge).toContain('Ремонт');
    expect(result.content.services[0]?.title).toContain('диагностика');
  });

  it('should successfully parse and validate Anthropic API response', async () => {
    const mockApiResponse = {
      content: [
        {
          text: JSON.stringify({
            hero: {
              badge: '✨ Лечение без боли',
              headline: 'Здоровая и красивая улыбка в Санкт-Петербурге за 1 визит',
              subheadline: 'Европейские стандарты стоматологии и чуткий подход к каждому пациенту.',
              primaryCtaText: 'Записаться на прием',
              secondaryCtaText: 'Консультация врача',
            },
            services: [
              {
                title: 'Швейцарская имплантация',
                description: 'Пожизненная гарантия на импланты и безболезненная установка.',
                lucideIconName: 'shield-check',
              },
              {
                title: 'Лазерное отбеливание Zoom 4',
                description: 'Осветление эмали до 8 тонов всего за одну комфортную процедуру.',
                lucideIconName: 'sparkles',
              },
              {
                title: 'Исправление прикуса элайнерами',
                description: 'Прозрачные каппы для идеального выравнивания зубов без брекетов.',
                lucideIconName: 'smile',
              },
            ],
            trustSignals: [
              { metric: '4.9 ★', label: 'Рейтинг в Яндекс Картах' },
              { metric: '14 лет', label: 'Безупречной практики' },
              { metric: '5,000+', label: 'Довольных пациентов' },
            ],
            offerNotice: 'Бесплатная 3D-диагностика при первой консультации',
          }),
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    const service = new MvpContentService({
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-test-key',
      customFetcher: mockFetch as unknown as typeof fetch,
    });

    const result = await service.generateContent(sampleInput);

    expect(result.aiFallbackUsed).toBe(false);
    expect(result.modelUsed).toBe('anthropic');
    expect(result.content.hero.headline).toBe('Здоровая и красивая улыбка в Санкт-Петербурге за 1 визит');
    expect(result.content.services).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should successfully parse and validate OpenAI API response', async () => {
    const mockApiResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              hero: {
                badge: '⚡ Гарантия качества',
                headline: 'Премиальная стоматология Дент-Престиж без страха',
                subheadline: 'Инновационные методы лечения и протезирования.',
                primaryCtaText: 'Забронировать визит',
                secondaryCtaText: 'Узнать цены',
              },
              services: [
                {
                  title: 'Имплантация Straumann',
                  description: 'Надежная установка под контролем 3D-хирургического шаблона.',
                  lucideIconName: 'shield-check',
                },
                {
                  title: 'Лечение кариеса под микроскопом',
                  description: 'Максимальное сохранение здоровых тканей зуба.',
                  lucideIconName: 'activity',
                },
                {
                  title: 'Эстетическая реставрация',
                  description: 'Керамические виниры с идеальной анатомической формой.',
                  lucideIconName: 'sparkles',
                },
              ],
              trustSignals: [
                { metric: '5.0 ★', label: 'Оценка на Google Maps' },
                { metric: '10 лет', label: 'Гарантии на работы' },
                { metric: '100%', label: 'Безопасность и стерильность' },
              ],
              offerNotice: 'Скидка 15% на комплексную гигиену для всей семьи',
            }),
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    const service = new MvpContentService({
      provider: 'openai',
      openaiApiKey: 'sk-openai-test-key',
      customFetcher: mockFetch as unknown as typeof fetch,
    });

    const result = await service.generateContent(sampleInput);

    expect(result.aiFallbackUsed).toBe(false);
    expect(result.modelUsed).toBe('openai');
    expect(result.content.services).toHaveLength(3);
  });

  it('should normalize invalid or aliased Lucide icons to valid supported icons', () => {
    const service = new MvpContentService({ provider: 'mock' });
    const supported = new Set(getSupportedIconNames());

    const rawOutput = {
      hero: {
        badge: 'Badge',
        headline: 'Headline',
        subheadline: 'Subheadline',
        primaryCtaText: 'CTA 1',
        secondaryCtaText: 'CTA 2',
      },
      services: [
        { title: 'Service 1', description: 'Desc', lucideIconName: 'tool' }, // alias to 'wrench'
        { title: 'Service 2', description: 'Desc', lucideIconName: 'guard' }, // alias to 'shield-check'
        { title: 'Service 3', description: 'Desc', lucideIconName: 'unsupported-xyz-random' }, // fallback to 'sparkles'
      ],
      trustSignals: [
        { metric: '1', label: 'One' },
        { metric: '2', label: 'Two' },
        { metric: '3', label: 'Three' },
      ],
      offerNotice: 'Notice',
    };

    const grounded = service.enforceStrictGrounding(rawOutput, sampleInput);

    expect(grounded.services[0]?.lucideIconName).toBe('wrench');
    expect(grounded.services[1]?.lucideIconName).toBe('shield-check');
    expect(grounded.services[2]?.lucideIconName).toBe('sparkles');

    grounded.services.forEach((s) => {
      expect(supported.has(s.lucideIconName)).toBe(true);
    });
  });

  it('should fallback gracefully when LLM returns invalid JSON on all retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: 'I am an AI and here is the response without json: hello!' }],
      }),
    });

    const service = new MvpContentService({
      provider: 'anthropic',
      anthropicApiKey: 'sk-test',
      customFetcher: mockFetch as unknown as typeof fetch,
    });

    const result = await service.generateContent(sampleInput);

    // Initial attempt + 2 retries = 3 attempts total
    expect(result.attempts).toBe(3);
    expect(result.aiFallbackUsed).toBe(true);
    expect(result.modelUsed).toBe('deterministic-fallback');
    expect(result.content.hero.headline).toContain('Дент-Престиж');
  });

  it('should fallback gracefully when network throws an error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new MvpContentService({
      provider: 'openai',
      openaiApiKey: 'sk-test',
      customFetcher: mockFetch as unknown as typeof fetch,
    });

    const result = await service.generateContent(sampleInput);

    expect(result.aiFallbackUsed).toBe(true);
    expect(result.modelUsed).toBe('deterministic-fallback');
  });
});
