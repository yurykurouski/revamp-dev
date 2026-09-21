import { describe, it, expect, vi } from 'vitest';
import { DesignCritiqueService, AnalyzeDesignInput } from '../design-critique.service.js';
import { DesignCritiqueOutputSchema } from '@revamp/validation';

describe('DesignCritiqueService', () => {
  const dummyMobileWebp = Buffer.from('fake-mobile-webp');
  const dummyDesktopWebp = Buffer.from('fake-desktop-webp');

  const baseInput: AnalyzeDesignInput = {
    mobileScreenshotWebp: dummyMobileWebp,
    desktopScreenshotWebp: dummyDesktopWebp,
    niche: 'dental',
    a11yScore: 65,
    lcpSeconds: 3.2,
    originalUrl: 'https://dental-example.com',
  };

  const validCritiqueResponse = {
    visualHierarchyRating: 72,
    mobileFriendlinessRating: 68,
    primaryCtaFound: true,
    datedDesignFactors: ['low-contrast', 'unresponsive-table'],
    criticalFlaws: [
      {
        title: 'Неконтрастный номер телефона в шапке',
        impact: 'Пациенты со смартфонов не видят способ быстрой связи.',
        recommendation: 'Сделать телефон фиксированной крупной кнопкой.',
      },
      {
        title: 'Тяжелый баннер блокирует первый экран',
        impact: 'LCP 3.2s приводит к уходу мобильных пользователей.',
        recommendation: 'Оптимизировать hero-изображение и сжать в WebP.',
      },
      {
        title: 'Мелкий шрифт в карточках услуг',
        impact: 'На смартфонах текст не читается без масштабирования.',
        recommendation: 'Увеличить размер шрифта до 16px по WCAG 2.1 AA.',
      },
    ],
    quickWins: [
      'Добавить липкую кнопку быстрой записи на прием.',
      'Переработать первый экран в чистый Bento-стиль.',
      'Разместить блок с рейтингом 4.9 из Яндекс Карт.',
    ],
  };

  describe('generateDeterministicFallback', () => {
    it('should generate a fallback strictly adhering to DesignCritiqueOutputSchema', () => {
      const service = new DesignCritiqueService();
      const fallback = service.generateDeterministicFallback(baseInput);

      const parsed = DesignCritiqueOutputSchema.safeParse(fallback);
      expect(parsed.success).toBe(true);

      expect(fallback.criticalFlaws).toHaveLength(3);
      expect(fallback.quickWins).toHaveLength(3);
      expect(fallback.datedDesignFactors.length).toBeLessThanOrEqual(5);
      expect(fallback.visualHierarchyRating).toBeGreaterThanOrEqual(0);
      expect(fallback.visualHierarchyRating).toBeLessThanOrEqual(100);
      expect(fallback.mobileFriendlinessRating).toBeGreaterThanOrEqual(0);
      expect(fallback.mobileFriendlinessRating).toBeLessThanOrEqual(100);
    });

    it('should customize critical flaws by niche (dental, auto, legal, other)', () => {
      const service = new DesignCritiqueService();

      const dental = service.generateDeterministicFallback({ ...baseInput, niche: 'dental' });
      expect(dental.criticalFlaws[0].title).toContain('запись на прием');

      const auto = service.generateDeterministicFallback({ ...baseInput, niche: 'auto' });
      expect(auto.criticalFlaws[0].title).toContain('расчет стоимости ремонта');

      const legal = service.generateDeterministicFallback({ ...baseInput, niche: 'legal' });
      expect(legal.criticalFlaws[0].title).toContain('юридический профиль');

      const other = service.generateDeterministicFallback({ ...baseInput, niche: 'restaurant' });
      expect(other.criticalFlaws[0].title).toContain('целевое действие');
    });

    it('should tailor flaws based on a11y and lcp thresholds', () => {
      const service = new DesignCritiqueService();

      // Low a11y (< 75) and high LCP (> 2.5)
      const poorMetrics = service.generateDeterministicFallback({
        ...baseInput,
        a11yScore: 50,
        lcpSeconds: 4.5,
      });
      expect(poorMetrics.criticalFlaws[1].title).toContain('цветовой контраст');
      expect(poorMetrics.criticalFlaws[2].title).toContain('LCP');

      // Good a11y (>= 75) and good LCP (<= 2.5)
      const goodMetrics = service.generateDeterministicFallback({
        ...baseInput,
        a11yScore: 90,
        lcpSeconds: 1.2,
      });
      expect(goodMetrics.criticalFlaws[1].title).toContain('Визуальный шум');
      expect(goodMetrics.criticalFlaws[2].title).toContain('триггеров доверия');
    });
  });

  describe('analyzeDesign (Strict Fallback Policy & Multi-Provider)', () => {
    it('should use deterministic fallback with aiFallbackUsed: true when no API keys are present', async () => {
      const service = new DesignCritiqueService({
        anthropicApiKey: undefined,
        openaiApiKey: undefined,
        provider: 'mock',
      });

      const result = await service.analyzeDesign(baseInput);

      expect(result.aiFallbackUsed).toBe(true);
      expect(result.modelUsed).toBe('deterministic-fallback');
      expect(result.critique.criticalFlaws).toHaveLength(3);
      expect(result.critique.quickWins).toHaveLength(3);
    });

    it('should parse valid response from Anthropic with aiFallbackUsed: false', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: JSON.stringify(validCritiqueResponse) }],
        }),
      });

      const service = new DesignCritiqueService({
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test-key',
        customFetcher: mockFetch as any,
      });

      const result = await service.analyzeDesign(baseInput);

      expect(result.aiFallbackUsed).toBe(false);
      expect(result.modelUsed).toBe('claude-3-5-sonnet-20241022');
      expect(result.attempts).toBe(1);
      expect(result.critique.visualHierarchyRating).toBe(72);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify payload structure sent to Anthropic
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('claude-3-5-sonnet-20241022');
      expect(body.temperature).toBe(0.2);
      expect(body.messages[0].content).toHaveLength(3); // text + mobile img + desktop img
    });

    it('should handle markdown wrapped JSON block (```json ... ```)', async () => {
      const wrappedJson = `\`\`\`json\n${JSON.stringify(validCritiqueResponse)}\n\`\`\``;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: wrappedJson }],
        }),
      });

      const service = new DesignCritiqueService({
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test-key',
        customFetcher: mockFetch as any,
      });

      const result = await service.analyzeDesign(baseInput);

      expect(result.aiFallbackUsed).toBe(false);
      expect(result.critique.primaryCtaFound).toBe(true);
    });

    it('should parse valid response from OpenAI with aiFallbackUsed: false', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(validCritiqueResponse) } }],
        }),
      });

      const service = new DesignCritiqueService({
        provider: 'openai',
        openaiApiKey: 'sk-openai-test-key',
        customFetcher: mockFetch as any,
      });

      const result = await service.analyzeDesign(baseInput);

      expect(result.aiFallbackUsed).toBe(false);
      expect(result.modelUsed).toBe('gpt-4o');
      expect(result.attempts).toBe(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('gpt-4o');
      expect(body.temperature).toBe(0.2);
    });

    it('should retry with temperature 0.0 when first attempt fails validation, and succeed on second attempt', async () => {
      const invalidCritique = { ...validCritiqueResponse, criticalFlaws: [] }; // invalid: length must be 3

      const mockFetch = vi
        .fn()
        // Attempt 1: returns invalid schema
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ type: 'text', text: JSON.stringify(invalidCritique) }],
          }),
        })
        // Attempt 2: returns valid schema
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ type: 'text', text: JSON.stringify(validCritiqueResponse) }],
          }),
        });

      const service = new DesignCritiqueService({
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test-key',
        customFetcher: mockFetch as any,
      });

      const result = await service.analyzeDesign(baseInput);

      expect(result.aiFallbackUsed).toBe(false);
      expect(result.attempts).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify attempt 1 had temp 0.2 and attempt 2 had temp 0.0
      const bodyAttempt1 = JSON.parse(mockFetch.mock.calls[0][1].body);
      const bodyAttempt2 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(bodyAttempt1.temperature).toBe(0.2);
      expect(bodyAttempt2.temperature).toBe(0.0);
    });

    it('should activate deterministic fallback after 3 failed attempts (initial + 2 retries)', async () => {
      const invalidCritique = { invalid: true };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: JSON.stringify(invalidCritique) }],
        }),
      });

      const service = new DesignCritiqueService({
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test-key',
        customFetcher: mockFetch as any,
      });

      const result = await service.analyzeDesign(baseInput);

      expect(result.aiFallbackUsed).toBe(true);
      expect(result.attempts).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.critique.criticalFlaws).toHaveLength(3);
    });

    it('should activate deterministic fallback if network / API returns 500 error across all retries', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const service = new DesignCritiqueService({
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test-key',
        customFetcher: mockFetch as any,
      });

      const result = await service.analyzeDesign(baseInput);

      expect(result.aiFallbackUsed).toBe(true);
      expect(result.attempts).toBe(3);
      expect(result.critique.criticalFlaws).toHaveLength(3);
    });
  });
});
