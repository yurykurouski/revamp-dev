import { describe, it, expect } from 'vitest';
import { en } from '../locales/en.js';
import { ru } from '../locales/ru.js';
import { be } from '../locales/be.js';
import { pl } from '../locales/pl.js';
import { lt } from '../locales/lt.js';
import { SUPPORTED_LANGUAGES } from '../languages.js';
import { NICHES } from '../niches.js';

type Tree = { [key: string]: string | Tree };

/** Every leaf as [dotted key, text] */
function leaves(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );
}

const placeholders = (text: string) => (text.match(/{{\s*\w+\s*}}/g) ?? []).sort();

const dictionaries = { en, ru, be, pl, lt } as const;

describe('Dashboard translations (REV-24)', () => {
  it('ships a dictionary for every supported language', () => {
    expect(Object.keys(dictionaries).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  const english = new Map(leaves(en));

  for (const [language, dictionary] of Object.entries(dictionaries)) {
    describe(language, () => {
      const entries = leaves(dictionary as Tree);

      it('has exactly the English keys', () => {
        expect(entries.map(([key]) => key).sort()).toEqual([...english.keys()].sort());
      });

      it('has no empty texts', () => {
        for (const [key, text] of entries) {
          expect(text.trim(), key).not.toBe('');
        }
      });

      it('keeps the same interpolation placeholders as English', () => {
        for (const [key, text] of entries) {
          expect(placeholders(text), key).toEqual(placeholders(english.get(key)!));
        }
      });
    });
  }

  it('labels every selectable niche in each niche list', () => {
    for (const niche of NICHES) {
      expect(en.niches[niche]).toBeTruthy();
      expect(en.nichesPlural[niche]).toBeTruthy();
      expect(en.nichesDetailed[niche]).toBeTruthy();
    }
  });
});
