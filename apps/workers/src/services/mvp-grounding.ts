import { IMvpGroundingFlag, IMvpSourceBrief, MvpGroundingKind } from '@revamp/shared-types';
import { withHtmlDocument } from './html-document.js';
import { PLACEHOLDER_PATTERN } from './mvp-page-check.js';

// Facts on a model-written page that the original site does not support (REV-136). The model may reword the site's
// copy, so words are not compared; checkable facts are: numbers (years, prices, ratings, counts) and names (a run of
// capitalized words that does not start a sentence). Each one the brief's source copy does not hold is a flag for the
// operator to check. Flags never reject the page.

const SKIP = new Set(['SVG', 'STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT']);
const INLINE = new Set(['ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR']);
const CONTEXT_MAX = 80;
/** Digits with thousands or decimal separators inside: "1 200", "1.200", "4,9" */
const NUMBER = /\d+(?:[   .,]\d+)*/g;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’&-]*/gu;
const NAME = /^\p{Lu}[\p{L}\p{N}&'’-]*$/u;
const SENTENCE_END = /[.!?…:]$/;
/** Units a page writes in Title Case: headings, menu links, buttons, list labels */
const LABEL_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'BUTTON', 'LI', 'SUMMARY', 'DT', 'TH', 'FIGCAPTION']);
const TITLE_CASE_MAX_WORDS = 12;

const squash = (text: string) => text.replace(/[\s  ]+/g, ' ').trim();

const canonical = (digits: string) => {
  const [int = '', frac] = digits.split('.');
  const whole = int.replace(/^0+(?=\d)/, '');
  const decimals = frac?.replace(/0+$/, '');
  return decimals ? `${whole}.${decimals}` : whole;
};

/**
 * The numbers a written run stands for, each in a canonical form (thousands joined, decimal point, no trailing
 * zeros). A separator that could be either ("1,200", "1.200") gives both readings; a run that is not one number
 * ("Top 3 2024") gives each of its numbers. Lone digits are left out.
 */
function numberReadings(raw: string): Array<{ raw: string; offset: number; values: string[] }> {
  const parts = raw.split(/([ \u00a0\u202f.,])/);
  const groups = parts.filter((_, i) => i % 2 === 0);
  const seps = parts.filter((_, i) => i % 2 === 1);
  const sameSep = seps.every((sep) => sep === seps[0] || (/\s/.test(sep) && /\s/.test(seps[0] ?? '')));
  const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3) && sameSep;
  const values = new Set<string>();
  if (thousands) values.add(canonical(groups.join('')));
  if (groups.length === 2 && (seps[0] === ',' || seps[0] === '.')) values.add(canonical(`${groups[0]}.${groups[1]}`));
  if (values.size) {
    const kept = [...values].filter((v) => !/^\d$/.test(v));
    return kept.length ? [{ raw, offset: 0, values: kept }] : [];
  }
  // Not one number: each group on its own
  let offset = 0;
  const out: Array<{ raw: string; offset: number; values: string[] }> = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      const value = canonical(part);
      if (!/^\d$/.test(value)) out.push({ raw: part, offset, values: [value] });
    }
    offset += part.length;
  });
  return out;
}

const numbersIn = (text: string) =>
  Array.from(text.matchAll(NUMBER)).flatMap((m) => numberReadings(m[0].trim()).map((n) => ({ ...n, index: (m.index ?? 0) + n.offset })));

/** Lowercase without diacritics, so inflected and accented forms of a name compare */
const fold = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').toLowerCase();

/** Whether the source holds the word: the same word, or for a longer word one sharing its stem (inflection) */
function grounded(word: string, source: string[]): boolean {
  const w = fold(word);
  if (w.length <= 4) return source.includes(w);
  const stem = w.slice(0, Math.max(4, w.length - 2));
  return source.some((s) => s.startsWith(stem) && Math.abs(s.length - w.length) <= 3);
}

/** The page's text in reading units: each block's own text with its inline children, then alt and title attributes */
function pageUnits(doc: Document): Array<{ text: string; tag: string }> {
  const units: Array<{ text: string; tag: string }> = [];
  const visit = (el: Element) => {
    let buffer = '';
    const flush = () => {
      if (squash(buffer)) units.push({ text: squash(buffer), tag: el.tagName.toUpperCase() });
      buffer = '';
    };
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) buffer += child.textContent ?? '';
      else if (child.nodeType === 1) {
        const tag = (child as Element).tagName.toUpperCase();
        if (SKIP.has(tag)) continue;
        if (INLINE.has(tag)) buffer += ` ${child.textContent ?? ''} `.replace(/\s+/g, ' ');
        else {
          flush();
          visit(child as Element);
        }
      }
    }
    flush();
  };
  if (doc.body) visit(doc.body);
  for (const el of Array.from(doc.querySelectorAll('[alt], [title]'))) {
    for (const name of ['alt', 'title']) {
      const value = squash(el.getAttribute(name) ?? '');
      if (value) units.push({ text: value, tag: name.toUpperCase() });
    }
  }
  return units.map((u) => ({ ...u, text: squash(u.text.replace(PLACEHOLDER_PATTERN, ' ')) })).filter((u) => u.text);
}

function sourceText(brief: IMvpSourceBrief): string {
  const { copy } = brief;
  return [
    brief.business.name,
    brief.business.niche,
    brief.business.city,
    ...brief.services,
    copy.title,
    copy.metaDescription,
    copy.h1,
    ...copy.headings,
    ...copy.paragraphs,
    ...copy.serviceItems.flatMap((s) => [s.title, s.description]),
    ...copy.testimonials.flatMap((t) => [t.text, t.author]),
    copy.rating && String(copy.rating.value),
    copy.rating?.count !== undefined && String(copy.rating.count),
    copy.foundingYear && String(copy.foundingYear),
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('\n');
}

export function checkMvpGrounding(html: string, brief: IMvpSourceBrief): IMvpGroundingFlag[] {
  const source = sourceText(brief);
  const sourceNumbers = new Set(numbersIn(source).flatMap((n) => n.values));
  const sourceWords = Array.from(source.matchAll(WORD), (m) => fold(m[0]));

  const flags: IMvpGroundingFlag[] = [];
  const seen = new Set<string>();
  const add = (kind: MvpGroundingKind, text: string, unit: string) => {
    const key = `${kind}:${kind === 'number' ? text : fold(text)}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push({ kind, text, context: unit.slice(0, CONTEXT_MAX) });
  };

  return withHtmlDocument(html, (doc) => {
    for (const { text: unit, tag } of pageUnits(doc)) {
      const found: Array<{ index: number; kind: MvpGroundingKind; text: string }> = [];

      for (const n of numbersIn(unit)) {
        if (!n.values.some((v) => sourceNumbers.has(v))) found.push({ index: n.index, kind: 'number', text: n.raw });
      }

      const words = Array.from(unit.matchAll(WORD), (m) => ({ text: m[0], index: m.index ?? 0 }));
      // A label in Title Case ("Our Dental Services") or all caps has no way to tell names apart
      const titleCase =
        LABEL_TAGS.has(tag) && words.length <= TITLE_CASE_MAX_WORDS && !words.some((w) => w.text.length >= 4 && /^\p{Ll}/u.test(w.text));
      if (/\p{Ll}/u.test(unit) && !titleCase) {
        let run: Array<{ text: string; index: number; ok: boolean }> = [];
        const close = () => {
          if (run.length && run.some((w) => !w.ok)) found.push({ index: run[0]!.index, kind: 'name', text: run.map((w) => w.text).join(' ') });
          run = [];
        };
        words.forEach((word, i) => {
          const before = unit.slice(0, word.index).trimEnd();
          const startsSentence = i === 0 || SENTENCE_END.test(before);
          // An all-caps word in a sentence ("OUR NEW CLINIC") is emphasis, not a name
          const isName = NAME.test(word.text) && /\p{Ll}/u.test(word.text) && !startsSentence;
          if (!isName) return close();
          // Only words written next to each other form one name
          const previous = words[i - 1];
          if (run.length && previous && unit.slice(previous.index + previous.text.length, word.index).trim()) close();
          run.push({ ...word, ok: grounded(word.text, sourceWords) });
        });
        close();
      }

      for (const f of found.sort((a, b) => a.index - b.index)) add(f.kind, f.text, unit);
    }
    return flags;
  });
}
