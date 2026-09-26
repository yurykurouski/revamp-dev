import { describe, it, expect, vi } from 'vitest';
import { MvpContentService, GenerateMvpContentInput } from '../mvp-content.service.js';
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
    expect(validated.trustSignals).toHaveLength(3);
  });

  it('should ground extracted services in deterministic fallback', async () => {
    const service = new MvpContentService({ provider: 'mock' });
    const result = await service.generateContent(sampleInput);

    const serviceTitles = result.content.services.map((s) => s.title);
    expect(serviceTitles).toContain('Dental implants');
    expect(serviceTitles).toContain('Professional hygiene');
  });

  it('should generate niche-specific copy for auto repair when services are empty', async () => {
    const service = new MvpContentService({ provider: 'mock' });
    const autoInput: GenerateMvpContentInput = {
      businessName: 'Motor-Pro Auto Service',
      niche: 'auto',
      city: 'Moscow',
    };

    const result = await service.generateContent(autoInput);
    expect(result.content.hero.headline).toContain('Motor-Pro');
    expect(result.content.hero.badge).toContain('repairs');
    expect(result.content.services[0]?.title).toContain('diagnostics');
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
});
