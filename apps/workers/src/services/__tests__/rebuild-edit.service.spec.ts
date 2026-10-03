import { describe, it, expect, vi } from 'vitest';
import type { ISiteSection, ISiteSections } from '@revamp/shared-types';
import { MVP_DESIGN_CORNERS, MVP_DESIGN_DENSITIES, MVP_DESIGN_FONTS, REBUILD_EDIT_BACKGROUNDS } from '@revamp/shared-types';
import { UnsafeCssError } from '../../templates/css-sanitizer.js';
import { REBUILD_EDIT_SYSTEM_PROMPT, RebuildEditInput, RebuildEditService, buildRebuildOutline } from '../rebuild-edit.service.js';

const section = (index: number, over: Partial<ISiteSection> = {}): ISiteSection => ({
  index, role: 'content', kind: 'other', arrangement: 'text',
  intro: { heading: `Sekcja ${index}`, text: ['Tekst sekcji.'], links: [] },
  items: [], extra: [], images: [], embeds: [], style: {}, ...over,
});

const siteSections: ISiteSections = {
  sections: [
    section(0, { role: 'header' }),
    section(1, { role: 'hero', intro: { heading: 'Stomatologia estetyczna', text: ['Witamy w gabinecie.'], links: [] } }),
    section(2, { kind: 'services', arrangement: 'card-grid', intro: { heading: 'Usługi', text: [], links: [] },
      items: [{ title: 'Implanty', text: [], links: [] }, { text: ['Wybielanie zębów laserem'], links: [] }],
      extra: [{ type: 'text', text: ['Ceny od 150 zł.'] }] }),
    section(3, { kind: 'reviews', intro: { heading: 'Opinie', text: ['x'.repeat(400)], links: [] } }),
    section(4, { role: 'footer' }),
  ],
  skipped: [],
  coverage: { pageChars: 1000, capturedChars: 990, ratio: 0.99, uncaptured: [] },
};

const input = (over: Partial<RebuildEditInput> = {}): RebuildEditInput => ({
  instruction: 'Opinie wyżej, ciemne tło usług, szeryfowe nagłówki',
  siteSections,
  current: { primaryColor: '#0E7490' },
  colorCandidates: [
    { hex: '#0E7490', source: 'current' },
    { hex: '#D97706', source: 'preset Amber' },
  ],
  ...over,
});

const serviceAnswering = (answer: unknown) => {
  const runner = vi.fn().mockResolvedValue(typeof answer === 'string' ? answer : JSON.stringify(answer));
  return { runner, service: new RebuildEditService({ provider: 'claude-cli', claudeCliRunner: runner }) };
};

const edit = { order: ['s-1', 's-3'], sections: { 's-2': { background: 'dark' } }, theme: { font: 'serif' } };

describe('buildRebuildOutline (REV-111)', () => {
  it('lists the hero and content sections with the ids of their pieces, never the header or footer', () => {
    const outline = buildRebuildOutline(siteSections);
    expect(outline.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3']);
    expect(outline[1]).toEqual({
      id: 's-2', role: 'content', kind: 'services', arrangement: 'card-grid', heading: 'Usługi',
      pieces: [
        { id: 's-2.i0', preview: 'Implanty' },
        { id: 's-2.i1', preview: 'Wybielanie zębów laserem' },
        { id: 's-2.x0', preview: 'Ceny od 150 zł.' },
      ],
    });
    expect(outline[2]!.pieces[0]!.preview).toHaveLength(160);
  });
});

describe('RebuildEditService (REV-111)', () => {
  it('sends the instruction, the page outline, the current edit and the allowed values', async () => {
    const { runner, service } = serviceAnswering({ summary: 'Nothing to change', edit: null });
    await service.interpret(input({ current: { edit: { hidden: ['s-3'] }, primaryColor: '#0E7490' } }));
    const { systemPrompt, userPrompt } = runner.mock.calls[0]![0];
    expect(systemPrompt).toBe(REBUILD_EDIT_SYSTEM_PROMPT);
    const prompt = JSON.parse(userPrompt);
    expect(prompt.instruction).toBe('Opinie wyżej, ciemne tło usług, szeryfowe nagłówki');
    expect(prompt.page.map((s: { id: string }) => s.id)).toEqual(['s-1', 's-2', 's-3']);
    expect(prompt.current).toEqual({ edit: { hidden: ['s-3'] }, primaryColor: '#0E7490', layout: 'original' });
    expect(prompt.allowedLayouts.map((l: { id: string }) => l.id)).toEqual(['original', 'bento', 'split', 'editorial', 'compact']);
    expect(userPrompt).not.toContain('+48');
  });

  it('builds the prompt from the shared vocabulary', () => {
    for (const value of [...REBUILD_EDIT_BACKGROUNDS, ...MVP_DESIGN_FONTS, ...MVP_DESIGN_DENSITIES, ...MVP_DESIGN_CORNERS]) {
      expect(REBUILD_EDIT_SYSTEM_PROMPT).toContain(value);
    }
    expect(REBUILD_EDIT_SYSTEM_PROMPT).toContain('[data-revamp-section="s-<index>"]');
  });

  it('turns a valid answer into the whole new edit, as a design change', async () => {
    const { service } = serviceAnswering({ summary: 'Moved the reviews up', edit, primaryColor: null, layout: null });
    expect(await service.interpret(input())).toEqual({ summary: 'Moved the reviews up', edit, changes: ['design'] });
  });

  it('reports dropped pieces as a content change', async () => {
    const { service } = serviceAnswering({ summary: 'Shorter', edit: { dropped: ['s-2.x0'] } });
    expect((await service.interpret(input())).changes).toEqual(['content']);
  });

  it('accepts an answer in a json fence', async () => {
    const { service } = serviceAnswering('Sure:\n```json\n' + JSON.stringify({ summary: 'Done', edit }) + '\n```');
    expect((await service.interpret(input())).edit).toEqual(edit);
  });

  it('drops the edit for {}, keeps it for null, and changes nothing for the same edit', async () => {
    const current = { current: { edit, primaryColor: '#0E7490' } };
    expect(await serviceAnswering({ summary: 'Reset', edit: {} }).service.interpret(input(current))).toEqual({ summary: 'Reset', edit: {}, changes: ['design'] });
    expect((await serviceAnswering({ summary: 'Kept', edit: null }).service.interpret(input(current))).changes).toEqual([]);
    expect((await serviceAnswering({ summary: 'Same', edit }).service.interpret(input(current))).changes).toEqual([]);
    expect((await serviceAnswering({ summary: 'Nothing', edit: {} }).service.interpret(input())).changes).toEqual([]);
  });

  it('switches to a template layout and picks an allowed color', async () => {
    const { service } = serviceAnswering({ summary: 'Split, amber', edit: null, primaryColor: '#d97706', layout: 'split' });
    expect(await service.interpret(input())).toEqual({ summary: 'Split, amber', primaryColor: '#D97706', layout: 'split', changes: ['palette', 'layout'] });
    const { service: same } = serviceAnswering({ summary: 'Stay', edit: null, layout: 'original', primaryColor: '#0e7490' });
    expect((await same.interpret(input())).changes).toEqual([]);
  });

  it('keeps CSS that passes the sanitizer, normalized', async () => {
    const { service } = serviceAnswering({ summary: 'Accent line', edit: { customCss: '.rb-heading::after{content:"";display:block;height:3px;background:var(--rb-primary)}' } });
    expect((await service.interpret(input())).edit?.customCss).toContain('.rb-heading::after');
  });

  it.each([
    ['prose', 'I will move the reviews up.', 'did not answer with a change'],
    ['a free string in the edit', { summary: 'x', edit: { headline: 'Nowy nagłówek' } }, 'not valid'],
    ['an unknown section', { summary: 'x', edit: { hidden: ['s-9'] } }, 'unknown section s-9'],
    ['the main heading hidden', { summary: 'x', edit: { hidden: ['s-1'] } }, "s-1 holds the page's main heading"],
    ['a piece past the end', { summary: 'x', edit: { dropped: ['s-2.i5'] } }, 'unknown piece s-2.i5'],
    ['a color not offered', { summary: 'x', primaryColor: '#123456' }, 'not one of the MVP'],
  ])('rejects %s', async (_label, answer, message) => {
    await expect(serviceAnswering(answer).service.interpret(input())).rejects.toThrow(message);
  });

  it('rejects unsafe or over-long CSS', async () => {
    await expect(serviceAnswering({ summary: 'x', edit: { customCss: '.rb-section { display: none; }' } }).service.interpret(input())).rejects.toThrow(UnsafeCssError);
    await expect(serviceAnswering({ summary: 'x', edit: { customCss: `.rb-cta{color:red}${' '.repeat(5000)}` } }).service.interpret(input())).rejects.toThrow(UnsafeCssError);
  });

  it('fails without a provider', async () => {
    const service = new RebuildEditService({ provider: 'anthropic', anthropicApiKey: '' });
    await expect(service.interpret(input())).rejects.toThrow();
  });
});
