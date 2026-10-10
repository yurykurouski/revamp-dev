import { describe, expect, it } from 'vitest';
import type { IMvpSourceBrief } from '@revamp/shared-types';
import { checkMvpGrounding } from '../mvp-grounding.js';
import { BRIEF } from './fixtures/page-gen/page.js';

const brief = (copy: Partial<IMvpSourceBrief['copy']> = {}): IMvpSourceBrief => ({
  ...BRIEF,
  copy: {
    headings: ['Nasze usługi', 'O gabinecie'],
    paragraphs: ['Leczymy z troską w centrum Krakowa. Nasz zespół prowadzi dr Anna Nowak.', 'Ocena 4,9 od 1 200 pacjentów.'],
    serviceItems: [{ title: 'Implanty', description: 'Trwałe uzupełnienia braków' }],
    testimonials: [],
    ...copy,
  },
});
const page = (body: string) => `<!DOCTYPE html><html lang="pl"><head><title>x</title></head><body>${body}</body></html>`;
const flags = (body: string, b = brief()) => checkMvpGrounding(page(body), b);

describe('checkMvpGrounding (REV-136)', () => {
  it('passes copy reworded from the source', () => {
    expect(
      flags('<h1>Nasze usługi</h1><p>W centrum Krakowa leczymy z troską.</p><p>Zespołem kieruje dr Anna Nowak.</p><h2>Implanty</h2><p>Trwałe uzupełnienia.</p>'),
    ).toEqual([]);
  });

  it('flags a number the source does not have, with its context', () => {
    expect(flags('<p>Ponad 15 lat doświadczenia</p>')).toEqual([{ kind: 'number', text: '15', context: 'Ponad 15 lat doświadczenia' }]);
  });

  it('matches numbers written differently in source and page', () => {
    expect(flags('<p>Ocena 4.9</p><p>1200 pacjentów</p><p>1 200 osób</p><p>1.200 wizyt</p>')).toEqual([]);
  });

  it('flags an unsupported award name and year', () => {
    expect(flags('<p>Laureat nagrody Gold Dental Award 2024.</p>')).toEqual([
      { kind: 'name', text: 'Gold Dental Award', context: 'Laureat nagrody Gold Dental Award 2024.' },
      { kind: 'number', text: '2024', context: 'Laureat nagrody Gold Dental Award 2024.' },
    ]);
  });

  it('does not treat all-caps headings or sentence starts as names', () => {
    expect(flags('<h2>NASZE USŁUGI I CENY</h2><p>Zadzwoń do nas. Chętnie pomożemy.</p>')).toEqual([]);
  });

  it('accepts a name the source has in another case or inflection', () => {
    expect(flags('<p>Pracujemy w zespole z dr Anną. Zapraszamy do Krakowie.</p>')).toEqual([]);
    expect(flags('<p>Leczymy w zespole Kraków Dent.</p>', brief({ paragraphs: ['kraków dent to nasz zespół'] }))).toEqual([]);
  });

  it('does not ground a short name by a longer word that merely starts the same', () => {
    expect(flags('<p>Partner sieci Gold.</p>', brief({ paragraphs: ['Gołębie na dachu.'] }))).toEqual([
      { kind: 'name', text: 'Gold', context: 'Partner sieci Gold.' },
    ]);
  });

  it('ignores placeholders and accepts the brief\'s city, name and services in alt text', () => {
    expect(flags('<p>Tel. {{phone}}</p><img alt="Gabinet Falco-Dent w Kraków" src="x">')).toEqual([]);
  });

  it('ignores single digits standing alone', () => {
    expect(flags('<ol><li>1 krok</li></ol><p>Krok 2: wizyta</p>')).toEqual([]);
  });

  it('reports the same unsupported fact once', () => {
    expect(flags('<p>Od 15 lat.</p><p>Już 15 lat!</p>')).toHaveLength(1);
  });

  it('skips svg and style text', () => {
    expect(flags('<style>.a{width:37px}</style><svg><text>99</text></svg><p>Implanty</p>')).toEqual([]);
  });

  it('cuts the context to 80 characters', () => {
    const [flag] = flags(`<p>Ponad 15 lat ${'doświadczenia '.repeat(10)}</p>`);
    expect(flag?.context.length).toBeLessThanOrEqual(80);
  });

  describe('review regressions', () => {
    it('does not flag the fixture page', async () => {
      const { VALID } = await import('./fixtures/page-gen/page.js');
      expect(checkMvpGrounding(VALID, brief({ headings: ['Usługi'], paragraphs: ['Leczymy z troską, w spokojnej atmosferze.'] }))).toEqual(
        [],
      );
    });

    it('reads each menu link on its own', () => {
      expect(flags('<nav><a href="#a">About Us</a> <a href="#b">Contact</a> <a href="#c">Usługi</a></nav>')).toEqual([]);
    });

    it('does not flag a Title Case heading', () => {
      expect(flags('<h2>Our Dental Services Here</h2>')).toEqual([]);
    });

    it('skips all-caps words inside a mixed sentence', () => {
      expect(flags('<p>Visit OUR NEW CLINIC today.</p>')).toEqual([]);
    });

    it('checks every number in a run, not only the first', () => {
      expect(flags('<p>Top 3 2024</p>')).toEqual([{ kind: 'number', text: '2024', context: 'Top 3 2024' }]);
    });

    it('compares decimals with trailing zeros and comma thousands', () => {
      expect(flags('<p>Cena 12.5 zł, 1,200 osób</p>', brief({ paragraphs: ['Cena 12,50 zł dla 1 200 osób'] }))).toEqual([]);
    });
  });
});
