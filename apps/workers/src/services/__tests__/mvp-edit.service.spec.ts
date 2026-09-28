import { describe, it, expect, vi } from 'vitest';
import type { MvpContentOutput } from '@revamp/validation';
import { MVP_EDIT_SYSTEM_PROMPT, MvpEditInput, MvpEditService } from '../mvp-edit.service.js';

const currentContent: MvpContentOutput = {
  hero: {
    badge: 'Warsaw',
    headline: 'Best dental clinic in Warsaw',
    subheadline: 'Implants, orthodontics and root canals under one roof.',
    primaryCtaText: 'Book a visit',
    secondaryCtaText: 'Call us',
  },
  about: { heading: 'About us', body: 'Our team has been treating patients in Warsaw since 2009.' },
  servicesHeading: 'Our services',
  services: [
    { title: 'Dental implants', description: 'Titanium implants that restore function.', lucideIconName: 'shield-check' },
    { title: 'Veneers', description: 'Thin ceramic shells.', lucideIconName: 'sparkles' },
    { title: 'Tooth extraction', description: 'Gentle extractions.', lucideIconName: 'activity' },
  ],
  trustSignals: [{ metric: '4.9', label: 'Google rating' }],
  offerNotice: 'Book your visit today.',
};

const input = (overrides: Partial<MvpEditInput> = {}): MvpEditInput => ({
  instruction: 'Make the headline punchier and use a warmer color',
  grounding: {
    businessName: 'Warsaw Dental Center',
    niche: 'dental',
    city: 'Warsaw',
    contacts: { phone: '+48 22 542 18 04', email: 'hello@wdc.pl' },
    siteContent: {
      language: 'en',
      title: 'Warsaw Dental Center',
      h1: 'Best dental clinic in Warsaw',
      headings: [],
      paragraphs: ['Our team has been treating patients in the heart of Warsaw since 2009.'],
      serviceItems: [{ title: 'Dental implants' }, { title: 'Veneers' }, { title: 'Tooth extraction' }],
      navItems: [],
      testimonials: [],
      images: [],
      rating: { value: 4.9, count: 312 },
      foundingYear: 2009,
    },
  },
  current: { content: currentContent, primaryColor: '#4F46E5', layout: 'bento' },
  colorCandidates: [
    { hex: '#4F46E5', source: 'current' },
    { hex: '#D97706', source: 'preset Amber' },
  ],
  ...overrides,
});

/** An edit service whose model (the local CLI provider) answers with `answer` */
const serviceAnswering = (answer: unknown) => {
  const runner = vi.fn().mockResolvedValue(typeof answer === 'string' ? answer : JSON.stringify(answer));
  return { runner, service: new MvpEditService({ provider: 'claude-cli', claudeCliRunner: runner }) };
};

const withHeadline = (headline: string): MvpContentOutput => ({
  ...currentContent,
  hero: { ...currentContent.hero, headline },
});

describe('MvpEditService (REV-85)', () => {
  it('sends the instruction with the grounding context, current MVP and allowed values', async () => {
    const { runner, service } = serviceAnswering({ summary: 'Nothing to change', content: null });

    await service.interpret(input());

    const { systemPrompt, userPrompt } = runner.mock.calls[0]![0];
    expect(systemPrompt).toBe(MVP_EDIT_SYSTEM_PROMPT);
    const prompt = JSON.parse(userPrompt);
    expect(prompt.instruction).toBe('Make the headline punchier and use a warmer color');
    expect(prompt.businessName).toBe('Warsaw Dental Center');
    expect(prompt.originalSite.h1).toBe('Best dental clinic in Warsaw');
    expect(prompt.current).toEqual({ content: currentContent, primaryColor: '#4F46E5', layout: 'bento' });
    expect(prompt.allowedColors).toEqual(input().colorCandidates);
    expect(prompt.allowedLayouts.map((layout: { id: string }) => layout.id)).toEqual(['bento', 'split', 'editorial', 'compact']);
    // Contacts are never handed to the model, only whether they exist
    expect(userPrompt).not.toContain('542 18 04');
    expect(userPrompt).not.toContain('hello@wdc.pl');
  });

  it('returns new copy, a picked color and a layout as changes', async () => {
    const { service } = serviceAnswering({
      summary: 'Punchier headline, amber palette, split layout',
      content: withHeadline('Warsaw smiles since 2009'),
      primaryColor: '#d97706',
      layout: 'split',
    });

    const plan = await service.interpret(input());

    expect(plan.changes).toEqual(['content', 'palette', 'layout']);
    expect(plan.content?.hero.headline).toBe('Warsaw smiles since 2009');
    expect(plan.primaryColor).toBe('#D97706');
    expect(plan.layout).toBe('split');
    expect(plan.summary).toBe('Punchier headline, amber palette, split layout');
  });

  it('reads the JSON out of an answer wrapped in prose', async () => {
    const { service } = serviceAnswering(
      `Here you go:\n${JSON.stringify({ summary: 'Split layout', layout: 'split' })}\nDone.`,
    );
    await expect(service.interpret(input())).resolves.toMatchObject({ layout: 'split', changes: ['layout'] });
  });

  it('reports no changes when the model keeps everything, with its reason', async () => {
    const { service } = serviceAnswering({
      summary: 'The site lists no prices, so none were added.',
      content: currentContent,
      primaryColor: '#4f46e5',
      layout: 'bento',
    });

    const plan = await service.interpret(input({ instruction: 'Add prices to the services' }));

    expect(plan).toEqual({ summary: 'The site lists no prices, so none were added.', changes: [] });
  });

  it('compares copy read back from the database regardless of key order', async () => {
    const { hero, ...rest } = currentContent;
    const reordered = { ...rest, hero: Object.fromEntries(Object.entries(hero).reverse()) } as MvpContentOutput;
    const { service } = serviceAnswering({ summary: 'Same copy', content: currentContent });
    const plan = await service.interpret(input({ current: { content: reordered, layout: 'bento' } }));
    expect(plan.changes).toEqual([]);
  });

  it('clips an over-long headline instead of rejecting the whole change', async () => {
    const { service } = serviceAnswering({ summary: 'Longer headline', content: withHeadline(`Warsaw ${'smile '.repeat(30)}`) });
    const plan = await service.interpret(input());
    expect(plan.content!.hero.headline.length).toBeLessThanOrEqual(90);
  });

  it.each([
    ['a number the site never states', withHeadline('Over 5000 happy patients in Warsaw')],
    ['a phone number', withHeadline('Call 555 123 456 today')],
    ['an email address', { ...currentContent, offerNotice: 'Write to promo@example.com' }],
    ['a link', { ...currentContent, offerNotice: 'See www.example.com for more' }],
  ])('rejects copy that adds %s', async (_label, content) => {
    const { service } = serviceAnswering({ summary: 'Edited', content });
    await expect(service.interpret(input())).rejects.toThrow(/not on the original site/);
  });

  it('accepts numbers the site or the current copy already states', async () => {
    const { service } = serviceAnswering({ summary: 'Edited', content: withHeadline('Rated 4.9 by 312 patients since 2009') });
    await expect(service.interpret(input())).resolves.toMatchObject({ changes: ['content'] });
  });

  it('rejects a color that is not one of the allowed ones', async () => {
    const { service } = serviceAnswering({ summary: 'Hot pink', primaryColor: '#FF00AA' });
    await expect(service.interpret(input())).rejects.toThrow(/not one of the MVP's brand or preset colors/);
  });

  it.each([
    ['no JSON at all', 'Sorry, I cannot help with that.'],
    ['broken JSON', '{"summary": "x", '],
  ])('fails on an answer with %s', async (_label, answer) => {
    const { service } = serviceAnswering(answer);
    await expect(service.interpret(input())).rejects.toThrow('The model did not answer with a change the MVP can apply.');
  });

  it.each([
    ['no summary', { layout: 'split' }],
    ['an unknown layout', { summary: 'Masonry', layout: 'masonry' }],
    ['copy without services', { summary: 'Edited', content: { ...currentContent, services: [] } }],
  ])('fails, applying nothing, on an answer with %s', async (_label, answer) => {
    const { service } = serviceAnswering(answer);
    await expect(service.interpret(input())).rejects.toThrow(/The model's change is not valid/);
  });

  it('fails without calling any model when no provider is configured (REV-45)', async () => {
    const fetcher = vi.fn();
    const service = new MvpEditService({
      provider: 'anthropic',
      anthropicApiKey: '',
      customFetcher: fetcher as unknown as typeof fetch,
    });
    await expect(service.interpret(input())).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes a provider error on', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('Claude CLI timed out'));
    const service = new MvpEditService({ provider: 'claude-cli', claudeCliRunner: runner });
    await expect(service.interpret(input())).rejects.toThrow('Claude CLI timed out');
  });
});
