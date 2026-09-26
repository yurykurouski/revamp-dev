import { describe, it, expect, vi } from 'vitest';
import {
  MvpContentService,
  GenerateMvpContentInput,
  MVP_CONTENT_SYSTEM_PROMPT,
  clipText,
  clipToSchemaLimits,
} from '../mvp-content.service.js';
import { ISiteContent } from '@revamp/shared-types';
import { MvpContentOutputSchema } from '@revamp/validation';
import { getSupportedIconNames } from '../../templates/icons.js';

describe('MvpContentService (@revamp/workers)', () => {
  const sampleInput: GenerateMvpContentInput = {
    businessName: 'Dent-Prestige Dental',
    niche: 'dental',
    city: 'Saint Petersburg',
    originalUrl: 'https://dent-prestige.spb.ru',
    extractedServices: [
      'Dental implants',
      'Professional hygiene',
      'Zoom enamel whitening',
      'Microscope-assisted cavity treatment',
    ],
    contacts: {
      phone: '+7 (812) 345-67-89',
      email: 'info@dent-prestige.spb.ru',
      address: '45 Ligovsky Ave',
    },
    critiqueQuickWins: [
      'Add a 1-click booking form above the fold',
      'Highlight the 5-year guarantee and pain-free care',
      'Move real patient reviews to the top',
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
    expect(validated.hero.headline).toContain('Dent-Prestige');
    expect(validated.services.length).toBeGreaterThanOrEqual(3);
    expect(validated.services.length).toBeLessThanOrEqual(6);
    // No rating / founding year on the source site -> no invented trust metrics (REV-23)
    expect(validated.trustSignals).toEqual([]);
  });

  it('should ground extracted services in deterministic fallback', async () => {
    const service = new MvpContentService({ provider: 'mock' });
    const result = await service.generateContent(sampleInput);

    const serviceTitles = result.content.services.map((s) => s.title);
    expect(serviceTitles).toContain('Dental implants');
    expect(serviceTitles).toContain('Professional hygiene');
  });

  it('should not fabricate boilerplate services or metrics when the site provides nothing (REV-23)', async () => {
    const service = new MvpContentService({ provider: 'mock' });
    const autoInput: GenerateMvpContentInput = {
      businessName: 'Motor-Pro Auto Service',
      niche: 'auto',
      city: 'Moscow',
    };

    const result = await service.generateContent(autoInput);
    expect(result.content.hero.headline).toBe('Motor-Pro Auto Service');
    expect(result.content.hero.badge).toBe('📍 Moscow');
    expect(result.content.services).toHaveLength(1);
    expect(result.content.services[0]?.title).toBe('Auto service');
    expect(result.content.trustSignals).toEqual([]);
    expect(result.content.about).toBeUndefined();
    expect(JSON.stringify(result.content)).not.toMatch(/diagnostics|warranty|10\+|4\.9/i);
  });

  it('should successfully parse and validate Anthropic API response', async () => {
    const mockApiResponse = {
      content: [
        {
          text: JSON.stringify({
            hero: {
              badge: '✨ Pain-free treatment',
              headline: 'A healthy, beautiful smile in Saint Petersburg in 1 visit',
              subheadline: 'European dental standards and a caring approach to every patient.',
              primaryCtaText: 'Book an appointment',
              secondaryCtaText: 'Talk to a dentist',
            },
            services: [
              {
                title: 'Swiss implants',
                description: 'A lifetime guarantee on implants and pain-free placement.',
                lucideIconName: 'shield-check',
              },
              {
                title: 'Zoom 4 laser whitening',
                description: 'Whitens enamel up to 8 shades in one comfortable session.',
                lucideIconName: 'sparkles',
              },
              {
                title: 'Bite correction with aligners',
                description: 'Clear aligners that straighten teeth without braces.',
                lucideIconName: 'smile',
              },
            ],
            trustSignals: [
              { metric: '4.9 ★', label: 'Rating on Google Maps' },
              { metric: '14 yrs', label: 'Of flawless practice' },
              { metric: '5,000+', label: 'Happy patients' },
            ],
            offerNotice: 'Free 3D diagnostics at your first consultation',
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
    expect(result.content.hero.headline).toBe('A healthy, beautiful smile in Saint Petersburg in 1 visit');
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
                badge: '⚡ Quality guarantee',
                headline: 'Premium, fear-free dentistry at Dent-Prestige',
                subheadline: 'Innovative treatment and prosthetics.',
                primaryCtaText: 'Book a visit',
                secondaryCtaText: 'See prices',
              },
              services: [
                {
                  title: 'Straumann implants',
                  description: 'Reliable placement guided by a 3D surgical template.',
                  lucideIconName: 'shield-check',
                },
                {
                  title: 'Microscope-assisted cavity treatment',
                  description: 'Preserves as much healthy tooth tissue as possible.',
                  lucideIconName: 'activity',
                },
                {
                  title: 'Aesthetic restoration',
                  description: 'Ceramic veneers with a perfect anatomical shape.',
                  lucideIconName: 'sparkles',
                },
              ],
              trustSignals: [
                { metric: '5.0 ★', label: 'Google Maps rating' },
                { metric: '10 yrs', label: 'Warranty on work' },
                { metric: '100%', label: 'Safety and sterility' },
              ],
              offerNotice: '15% off full hygiene for the whole family',
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
    expect(result.content.hero.headline).toContain('Dent-Prestige');
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

  describe('local Claude CLI provider (REV-30)', () => {
    const cliCopy = JSON.stringify({
      hero: {
        badge: '✨ Pain-free treatment',
        headline: 'Dental implants and whitening at Dent-Prestige',
        subheadline: 'Professional hygiene and microscope-assisted treatment in one clinic.',
        primaryCtaText: 'Book an appointment',
        secondaryCtaText: 'Talk to a dentist',
      },
      services: [
        { title: 'Dental implants', description: 'Implants placed with care.', lucideIconName: 'shield-check' },
        { title: 'Professional hygiene', description: 'Thorough, gentle cleaning.', lucideIconName: 'sparkles' },
        { title: 'Zoom enamel whitening', description: 'A brighter smile in one visit.', lucideIconName: 'sparkles' },
      ],
      trustSignals: [],
      offerNotice: 'Book your first consultation online',
    });

    it('should generate copy through the CLI without any API key', async () => {
      const runner = vi.fn().mockResolvedValue(`Here you go:\n${cliCopy}`);
      const service = new MvpContentService({ provider: 'claude-cli', claudeCliRunner: runner });

      const result = await service.generateContent(sampleInput);

      expect(result.aiFallbackUsed).toBe(false);
      expect(result.modelUsed).toBe('claude-cli');
      expect(result.attempts).toBe(1);
      expect(result.content.hero.headline).toBe('Dental implants and whitening at Dent-Prestige');
      expect(runner).toHaveBeenCalledTimes(1);
      const request = runner.mock.calls[0]?.[0];
      expect(request.systemPrompt).toContain('Senior Conversion Copywriter');
      expect(JSON.parse(request.userPrompt).businessName).toBe('Dent-Prestige Dental');
    });

    it('should retry after a CLI failure and use the next successful answer', async () => {
      const runner = vi
        .fn()
        .mockRejectedValueOnce(new Error('Claude CLI timed out after 120000ms'))
        .mockResolvedValueOnce(cliCopy);
      const service = new MvpContentService({ provider: 'claude-cli', claudeCliRunner: runner });

      const result = await service.generateContent(sampleInput);

      expect(result.aiFallbackUsed).toBe(false);
      expect(result.attempts).toBe(2);
    });

    it('should fall back to deterministic copy when every CLI attempt fails', async () => {
      const runner = vi.fn().mockRejectedValue(new Error('Claude CLI exited with code 1: Not logged in'));
      const service = new MvpContentService({ provider: 'claude-cli', claudeCliRunner: runner });

      const result = await service.generateContent(sampleInput);

      expect(runner).toHaveBeenCalledTimes(3);
      expect(result.aiFallbackUsed).toBe(true);
      expect(result.modelUsed).toBe('deterministic-fallback');
      expect(result.content.hero.headline).toContain('Dent-Prestige');
    });

    it('should apply Strict Grounding to CLI output', async () => {
      const ungrounded = JSON.parse(cliCopy);
      ungrounded.trustSignals = [{ metric: '4.9 ★', label: 'Rating on Google Maps' }];
      const runner = vi.fn().mockResolvedValue(JSON.stringify(ungrounded));
      const service = new MvpContentService({ provider: 'claude-cli', claudeCliRunner: runner });

      const result = await service.generateContent(sampleInput);

      expect(result.content.trustSignals).toEqual([]);
    });
  });

  describe('over-long LLM fields (REV-34)', () => {
    const validCopy = () => ({
      hero: {
        badge: 'Dental clinic',
        headline: 'Dental implants and whitening at Dent-Prestige',
        subheadline: 'Professional hygiene and microscope-assisted treatment in one clinic.',
        primaryCtaText: 'Book an appointment',
        secondaryCtaText: 'Talk to a dentist',
      },
      services: [
        { title: 'Dental implants', description: 'Implants placed with care.', lucideIconName: 'shield-check' },
        { title: 'Professional hygiene', description: 'Thorough, gentle cleaning.', lucideIconName: 'sparkles' },
        { title: 'Zoom enamel whitening', description: 'A brighter smile in one visit.', lucideIconName: 'sparkles' },
      ],
      trustSignals: [],
      offerNotice: 'Book your first consultation online',
    });

    it('should keep an answer whose text fields run over their limits, clipped to the schema', async () => {
      const copy = validCopy();
      copy.offerNotice =
        'Call us today to book your first consultation with our friendly team of experienced dentists in the heart of Saint Petersburg';
      copy.hero.badge = 'Trusted family dental clinic in Saint Petersburg';
      copy.hero.primaryCtaText = 'Book your appointment with us online today';
      const runner = vi.fn().mockResolvedValue(JSON.stringify(copy));
      const service = new MvpContentService({ provider: 'claude-cli', claudeCliRunner: runner });

      const result = await service.generateContent(sampleInput);

      expect(result.aiFallbackUsed).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.content.offerNotice.length).toBeLessThanOrEqual(100);
      expect(result.content.offerNotice).toMatch(/^Call us today to book your first consultation/);
      expect(result.content.hero.badge.length).toBeLessThanOrEqual(40);
      expect(result.content.hero.primaryCtaText.length).toBeLessThanOrEqual(35);
      // Clipped at a word boundary, not mid-word
      expect(copy.offerNotice.split(' ')).toContain(result.content.offerNotice.split(' ').pop());
    });

    it('should still fall back when the answer is structurally invalid', async () => {
      const copy: Record<string, unknown> = validCopy();
      delete copy.offerNotice;
      copy.services = [];
      const runner = vi.fn().mockResolvedValue(JSON.stringify(copy));
      const service = new MvpContentService({ provider: 'claude-cli', claudeCliRunner: runner });

      const result = await service.generateContent(sampleInput);

      expect(runner).toHaveBeenCalledTimes(3);
      expect(result.aiFallbackUsed).toBe(true);
    });

    it('clipToSchemaLimits should clip nested strings and leave everything else alone', () => {
      const copy = validCopy();
      const longDescription = 'word '.repeat(40).trim();
      copy.services[0]!.description = longDescription;
      const withExtras = { ...copy, about: undefined, unknownField: 'x'.repeat(500) };

      const clipped = clipToSchemaLimits(withExtras, MvpContentOutputSchema) as typeof withExtras;

      expect(clipped.services[0]!.description.length).toBeLessThanOrEqual(120);
      expect(clipped.services[0]!.description.endsWith('word')).toBe(true);
      expect(clipped.services[1]).toEqual(copy.services[1]);
      expect(clipped.hero).toEqual(copy.hero);
      expect(clipped.about).toBeUndefined();
      expect(clipped.unknownField).toHaveLength(500);
      expect(clipToSchemaLimits('not an object', MvpContentOutputSchema)).toBe('not an object');
    });

    it('should state a length limit for every short text field in the system prompt', () => {
      for (const field of ['hero.badge', 'servicesHeading', 'primaryCtaText', 'secondaryCtaText', 'offerNotice']) {
        expect(MVP_CONTENT_SYSTEM_PROMPT).toMatch(new RegExp(`${field.replace('.', '\\.')}[^\\n]*up to \\d+ characters`));
      }
    });
  });

  describe('grounding in the original site content (REV-23)', () => {
    const emptySite: ISiteContent = {
      headings: [],
      paragraphs: [],
      serviceItems: [],
      navItems: [],
      testimonials: [],
      images: [],
    };

    const dentalSite: GenerateMvpContentInput = {
      businessName: 'Warsaw Dental Center',
      niche: 'dental',
      city: 'Warsaw',
      contacts: { phone: '+48 22 542 18 04' },
      siteContent: {
        ...emptySite,
        title: 'Warsaw Dental Center: Best dental clinic in Warsaw',
        h1: 'Best dental clinic in Warsaw: implants, orthodontics, root canals',
        metaDescription: 'Modern dental center. Full range of services, treatment under sedation.',
        paragraphs: [
          'At Warsaw Dental Center we offer a wide range of professional treatments to take care of your oral health.',
          'Our team of specialists has been treating patients in the heart of Warsaw since 2009.',
        ],
        serviceItems: [
          { title: 'Dental implants', description: 'Titanium implants that restore full function and aesthetics.' },
          { title: 'Veneers', description: 'Thin ceramic shells that change the shape and color of teeth.' },
          { title: 'Tooth extraction' },
        ],
        testimonials: [
          { text: 'Doctors and staff speak English fluently, every experience was positive.', author: 'Abhijit C.' },
          { text: 'Painless implant surgery and very professional follow-up care.', author: 'Anna K.' },
        ],
        rating: { value: 4.9, count: 312 },
        foundingYear: 2009,
      },
    };

    const mallSite: GenerateMvpContentInput = {
      businessName: 'Galeria Bemowo',
      niche: 'other',
      siteContent: {
        ...emptySite,
        title: 'Strona główna - Bemowo',
        headings: ['Godziny otwarcia', 'Wyjątkowe miejsce na zakupy!', 'Galeria Handlowa Bemowo'],
        paragraphs: ['W Galerii Bemowo znajdziesz wszystko, czego potrzebujesz: sklepy, restauracje i usługi w jednym miejscu.'],
        navItems: ['Sklepy', 'RESTAURACJE', 'Usługi', 'Kontakt', 'O nas'],
      },
    };

    it('should produce different MVP copy for two different sites', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const dental = service.generateDeterministicFallback(dentalSite);
      const mall = service.generateDeterministicFallback(mallSite);

      expect(dental.hero.headline).not.toBe(mall.hero.headline);
      expect(dental.hero.subheadline).not.toBe(mall.hero.subheadline);
      expect(dental.about?.body).not.toBe(mall.about?.body);
      expect(dental.services.map((s) => s.title)).not.toEqual(mall.services.map((s) => s.title));
    });

    it('should build hero, about and services from the site own copy', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const content = service.generateDeterministicFallback(dentalSite);

      expect(content.hero.headline).toBe('Best dental clinic in Warsaw: implants, orthodontics, root canals');
      expect(content.hero.subheadline).toBe(dentalSite.siteContent!.metaDescription);
      expect(content.hero.badge).toBe('★ 4.9 rating');
      expect(content.about?.heading).toBe('About Warsaw Dental Center');
      expect(content.about?.body).toContain('since 2009');
      expect(content.services[0]).toMatchObject({
        title: 'Dental implants',
        description: 'Titanium implants that restore full function and aesthetics.',
        lucideIconName: 'shield-check',
      });
      expect(content.services[2]?.description).toBe('Tooth extraction at Warsaw Dental Center.');
      expect(content.offerNotice).toContain('+48 22 542 18 04');
      expect(() => MvpContentOutputSchema.parse(content)).not.toThrow();
    });

    it('should derive trust signals only from verifiable site data', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const content = service.generateDeterministicFallback(dentalSite);

      expect(content.trustSignals).toEqual([
        { metric: '4.9 ★', label: 'Average rating from 312 reviews' },
        { metric: 'Since 2009', label: expect.stringMatching(/^Serving customers for \d+\+ years$/) },
        { metric: '2', label: 'Customer testimonials on our site' },
      ]);
    });

    it('should skip generic page and section titles when picking the headline', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const content = service.generateDeterministicFallback(mallSite);

      expect(content.hero.headline).toBe('Wyjątkowe miejsce na zakupy!');
    });

    it('should use navigation sections as services and drop site chrome links', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const titles = service.generateDeterministicFallback(mallSite).services.map((s) => s.title);

      expect(titles).toEqual(['Sklepy', 'Restauracje', 'Usługi']);
    });

    it('should drop LLM trust signals whose numbers are not on the original site', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const grounded = service.enforceStrictGrounding(
        {
          hero: { badge: 'b', headline: 'h', subheadline: 's', primaryCtaText: 'p', secondaryCtaText: 'c' },
          services: [{ title: 'Dental implants', description: 'd', lucideIconName: 'smile' }],
          trustSignals: [
            { metric: '4.9 ★', label: 'Rating' },
            { metric: '15+ years', label: 'Invented' },
            { metric: '100%', label: 'Invented guarantee' },
          ],
          offerNotice: 'o',
        },
        dentalSite,
      );

      expect(grounded.trustSignals).toEqual([{ metric: '4.9 ★', label: 'Rating' }]);
    });

    it('should pad short LLM service lists only with services extracted from the site', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const grounded = service.enforceStrictGrounding(
        {
          hero: { badge: 'b', headline: 'h', subheadline: 's', primaryCtaText: 'p', secondaryCtaText: 'c' },
          services: [{ title: 'Dental implants', description: 'd', lucideIconName: 'smile' }],
          trustSignals: [],
          offerNotice: 'o',
        },
        dentalSite,
      );

      expect(grounded.services.map((s) => s.title)).toEqual(['Dental implants', 'Veneers', 'Tooth extraction']);
      expect(grounded.about?.body).toContain('Warsaw Dental Center');
    });

    it('should send the original site content to the LLM as grounding context', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
      const service = new MvpContentService({
        provider: 'anthropic',
        anthropicApiKey: 'sk-test',
        customFetcher: mockFetch as unknown as typeof fetch,
      });

      await service.generateContent(dentalSite);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const context = JSON.parse(body.messages[0].content);
      expect(context.originalSite.h1).toBe(dentalSite.siteContent!.h1);
      expect(context.originalSite.services).toHaveLength(3);
      expect(context.originalSite.rating).toEqual({ value: 4.9, count: 312 });
      expect(body.system).toContain('Never invent');
    });

    it('should ask the LLM to keep the original site language instead of translating (REV-25)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
      const service = new MvpContentService({
        provider: 'anthropic',
        anthropicApiKey: 'sk-test',
        customFetcher: mockFetch as unknown as typeof fetch,
      });

      await service.generateContent({ ...mallSite, siteContent: { ...mallSite.siteContent!, language: 'pl-PL' } });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const context = JSON.parse(body.messages[0].content);
      expect(context.outputLanguage).toBe('Polish (Poland) (pl-PL)');
      expect(body.system).toContain('outputLanguage');
      expect(body.system).toContain('Never translate');
      expect(body.system).not.toContain('Write all copy in English');
    });

    it('should let the LLM follow the source text when the site declares no valid language (REV-25)', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const unknown = 'the language the original site text is written in (English if it cannot be determined)';
      expect(service.resolveOutputLanguage(mallSite)).toBe(unknown);
      expect(service.resolveOutputLanguage({ ...mallSite, siteContent: { ...mallSite.siteContent!, language: '??' } })).toBe(unknown);
      expect(service.resolveOutputLanguage({ businessName: 'X' })).toBe(unknown);
    });

    it('should write the deterministic fallback wording in the site language (REV-25)', () => {
      const service = new MvpContentService({ provider: 'mock' });
      const polish = service.generateDeterministicFallback({
        ...dentalSite,
        siteContent: { ...dentalSite.siteContent!, language: 'pl' },
      });
      expect(polish.hero.primaryCtaText).toBe('Umów wizytę');
      expect(polish.hero.secondaryCtaText).toBe('Zadzwoń');
      expect(polish.hero.badge).toBe('★ Ocena 4.9');
      expect(polish.about?.heading).toBe('O firmie Warsaw Dental Center');
      expect(polish.services.find((s) => s.title === 'Tooth extraction')?.description).not.toContain(' at ');
      expect(polish.trustSignals[0]?.label).toBe('Średnia ocena z 312 opinii');
      expect(polish.offerNotice).toContain('Zadzwoń pod numer');

      const english = service.generateDeterministicFallback(dentalSite);
      expect(english.hero.primaryCtaText).toBe('Book an appointment');
      expect(english.about?.heading).toBe('About Warsaw Dental Center');
    });

    it('clipText should cut at sentence or word boundaries', () => {
      expect(clipText('Short text', 50)).toBe('Short text');
      expect(clipText('First sentence here. Second sentence is long', 30)).toBe('First sentence here.');
      expect(clipText('one two three four five', 12)).toBe('one two');
    });
  });
});
