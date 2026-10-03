import { describe, it, expect, vi } from 'vitest';
import type { ISiteSection, ISiteSections } from '@revamp/shared-types';
import { REBUILD_EDIT_ARRANGEMENTS, REBUILD_EDIT_BACKGROUNDS, REBUILD_HERO_STYLES, REBUILD_MEDIA_FITS, REBUILD_TYPE_SCALES } from '@revamp/shared-types';
import { defaultModernDesign } from '../rebuild-modernize.js';
import { REBUILD_MODERNIZE_SYSTEM_PROMPT, RebuildModernizeService, fittingArrangements, modernizeOutline } from '../rebuild-modernize.service.js';
import { checkRebuildEdit } from '@revamp/validation';

const section = (index: number, over: Partial<ISiteSection> = {}): ISiteSection => ({
  index, role: 'content', kind: 'other', arrangement: 'text',
  intro: { heading: `Sekcja ${index}`, text: ['Tekst sekcji.'], links: [] },
  items: [], extra: [], images: [], embeds: [], style: {}, ...over,
});
const read: ISiteSections = {
  sections: [
    section(0, { role: 'header' }),
    section(1, { role: 'hero' }),
    section(2, { arrangement: 'media-beside-text', images: [{ src: 'https://x.test/a.jpg', width: 800 }] }),
    section(3),
    section(4, { role: 'footer' }),
  ],
  skipped: [],
  coverage: { pageChars: 1000, capturedChars: 990, ratio: 0.99, uncaptured: [] },
};
const input = { siteSections: read, brandColors: ['#0E7490'] };
const design = { theme: { typeScale: 'modern', corners: 'soft' }, sections: { 's-3': { align: 'left' } } };

const serviceWith = (runner: ReturnType<typeof vi.fn>) => new RebuildModernizeService({ provider: 'claude-cli', claudeCliRunner: runner });

describe('RebuildModernizeService (REV-114)', () => {
  it('uses a valid answer', async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ design }));
    expect(await serviceWith(runner).choose(input)).toEqual({ source: 'llm', design });
    const { systemPrompt, userPrompt } = runner.mock.calls[0]![0];
    expect(systemPrompt).toBe(REBUILD_MODERNIZE_SYSTEM_PROMPT);
    const prompt = JSON.parse(userPrompt);
    expect(prompt.page.map((s: { id: string }) => s.id)).toEqual(['s-1', 's-2', 's-3']);
    expect(prompt.brandColors).toEqual(['#0E7490']);
    expect(prompt.start).toEqual(defaultModernDesign(read));
  });

  it('retries once with the rejection reason', async () => {
    const runner = vi.fn().mockResolvedValueOnce(JSON.stringify({ design: { sections: { 's-99': { align: 'left' } } } })).mockResolvedValueOnce(JSON.stringify({ design }));
    expect(await serviceWith(runner).choose(input)).toEqual({ source: 'llm', design });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(JSON.parse(runner.mock.calls[1]![0].userPrompt).previousAnswerRejected).toBe('unknown section s-99');
  });

  it('falls back to the default after two invalid answers', async () => {
    const runner = vi.fn().mockResolvedValueOnce('not json at all').mockResolvedValueOnce(JSON.stringify({ design: { sections: { 's-99': { align: 'left' } } } }));
    expect(await serviceWith(runner).choose(input)).toEqual({ source: 'default', design: defaultModernDesign(read), error: 'invalid: unknown section s-99' });
  });

  it('rejects a string field (strict schema)', async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ design: { summary: 'Nowoczesny wygląd' } }));
    const result = await serviceWith(runner).choose(input);
    expect(result.source).toBe('default');
    expect(result.error).toMatch(/^invalid: /);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('falls back when the call throws', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await serviceWith(runner).choose(input);
    expect(result).toEqual({ source: 'default', design: defaultModernDesign(read), error: 'call_failed: boom' });
  });

  it('falls back without calling when no provider is configured', async () => {
    const runner = vi.fn();
    const service = new RebuildModernizeService({ provider: 'anthropic', anthropicApiKey: '', claudeCliRunner: runner });
    expect(await service.choose(input)).toEqual({ source: 'default', design: defaultModernDesign(read), error: 'not_configured' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('names every vocabulary value and the rules in the system prompt', () => {
    for (const value of [...REBUILD_EDIT_ARRANGEMENTS, ...REBUILD_MEDIA_FITS, ...REBUILD_HERO_STYLES, ...REBUILD_TYPE_SCALES, ...REBUILD_EDIT_BACKGROUNDS]) {
      expect(REBUILD_MODERNIZE_SYSTEM_PROMPT).toContain(value);
    }
    expect(REBUILD_MODERNIZE_SYSTEM_PROMPT).toContain('{"design"');
    expect(REBUILD_MODERNIZE_SYSTEM_PROMPT).toContain('1000');
  });

  it('tells the model which sections fit another arrangement and which show a photo beside their text', async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ design }));
    await serviceWith(runner).choose(input);
    const page = JSON.parse(runner.mock.calls[0]![0].userPrompt).page;
    expect(page.find((s: { id: string }) => s.id === 's-2')).toMatchObject({ arrangeAs: [], photoBeside: true });
    expect(page.find((s: { id: string }) => s.id === 's-3')).toMatchObject({ arrangeAs: [], photoBeside: false });
    expect(REBUILD_MODERNIZE_SYSTEM_PROMPT).toContain('"arrangeAs"');
    expect(REBUILD_MODERNIZE_SYSTEM_PROMPT).toContain('"photoBeside"');
  });
});

describe('fittingArrangements (REV-114)', () => {
  const short = ['Jeden.', 'Dwa.', 'Trzy.'];
  const item = { text: ['Punkt.'], links: [] };
  const cases: [string, ISiteSection][] = [
    ['a text run of 3 short paragraphs', section(1, { intro: { text: short, links: [] } })],
    ['a text section of 2 paragraphs', section(1, { intro: { text: short.slice(0, 2), links: [] } })],
    ['a list of 3 items', section(1, { arrangement: 'list', items: [item, item, item] })],
    ['a list of 2 items', section(1, { arrangement: 'list', items: [item, item] })],
    ['media beside 3 short paragraphs', section(1, { arrangement: 'media-beside-text', intro: { text: short, links: [] }, images: [{ src: 'https://x.test/a.jpg', width: 300 }] })],
  ];

  it.each(cases)('agrees with checkRebuildEdit: %s', (_, s) => {
    const page = { sections: [section(0, { role: 'hero' }), s] };
    const fits = fittingArrangements(s);
    for (const arrangement of ['card-grid', 'list'] as const) {
      if (arrangement === s.arrangement) continue;
      const ok = checkRebuildEdit({ sections: { 's-1': { arrangement } } }, page).ok;
      expect(fits.includes(arrangement)).toBe(ok);
    }
  });

  it('lists the outline of the hero and content sections only', () => {
    expect(modernizeOutline(read).map((s) => s.id)).toEqual(['s-1', 's-2', 's-3']);
  });
});
