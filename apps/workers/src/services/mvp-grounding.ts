import { IMvpGroundingFlag, IMvpSourceBrief, MvpGroundingKind } from '@revamp/shared-types';
import { withHtmlDocument } from './html-document.js';
import { PLACEHOLDER_PATTERN } from './mvp-page-check.js';

// Facts on a model-written page that the original site does not support (REV-136). The model may reword the site's
// copy, so words are not compared; checkable facts are: numbers (years, prices, ratings, counts) and names (a run of
// capitalized words that does not start a sentence). Each one the brief's source copy does not hold is a flag for the
// operator to check. Flags never reject the page.

const SKIP = new Set(['SVG', 'STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT']);
const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR']);
const CONTEXT_MAX = 80;
/** Digits with thousands or decimal separators inside: "1 200", "1.200", "4,9" */
const NUMBER = /\d+(?:[   .,]\d+)*/g;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’&-]*/gu;
const NAME = /^\p{Lu}[\p{L}\p{N}&'’-]*$/u;
const SENTENCE_END = /[.!?…:]$/;

const squash = (text: string) => text.replace(/[\s  ]+/g, ' ').trim();

/** A number in one canonical form: thousands groups joined, decimal comma as a dot; undefined for a lone digit */
function normalizeNumber(raw: string): string | undefined {
  const parts = raw.split(/([   .,])/);
  const groups = parts.filter((_, i) => i % 2 === 0);
  const seps = parts.filter((_, i) => i % 2 === 1);
  let value: string;
  if (groups.length > 1 && groups.slice(1).every((g) => g.length === 3) && !(seps.length === 1 && seps[0] === ',')) {
    value = groups.join('');
  } else if (groups.length === 2 && (seps[0] === ',' || seps[0] === '.')) {
    value = `${groups[0]}.${groups[1]}`;
  } else {
    // Unrelated numbers that happen to sit side by side ("9 18"): the first one stands for the run
    value = groups[0] ?? raw;
  }
  value = value.replace(/^0+(?=\d)/, '');
  return /^\d$/.test(value) ? undefined : value;
}

const numbersIn = (text: string) =>
  Array.from(text.matchAll(NUMBER), (m) => ({ raw: m[0].trim(), index: m.index ?? 0, value: normalizeNumber(m[0].trim()) }));

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
function pageUnits(doc: Document): string[] {
  const units: string[] = [];
  const visit = (el: Element) => {
    let buffer = '';
    const flush = () => {
      if (squash(buffer)) units.push(squash(buffer));
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
      if (value) units.push(value);
    }
  }
  return units.map((u) => squash(u.replace(PLACEHOLDER_PATTERN, ' '))).filter(Boolean);
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
  const sourceNumbers = new Set(numbersIn(source).flatMap((n) => (n.value ? [n.value] : [])));
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
    for (const unit of pageUnits(doc)) {
      const found: Array<{ index: number; kind: MvpGroundingKind; text: string }> = [];

      for (const n of numbersIn(unit)) {
        if (n.value && !sourceNumbers.has(n.value)) found.push({ index: n.index, kind: 'number', text: n.raw });
      }

      // An all-caps unit (a styled heading) has no way to tell names apart
      if (/\p{Ll}/u.test(unit)) {
        const words = Array.from(unit.matchAll(WORD), (m) => ({ text: m[0], index: m.index ?? 0 }));
        let run: Array<{ text: string; index: number; ok: boolean }> = [];
        const close = () => {
          if (run.length && run.some((w) => !w.ok)) found.push({ index: run[0]!.index, kind: 'name', text: run.map((w) => w.text).join(' ') });
          run = [];
        };
        words.forEach((word, i) => {
          const before = unit.slice(0, word.index).trimEnd();
          const startsSentence = i === 0 || SENTENCE_END.test(before);
          const isName = NAME.test(word.text) && !/^\d/.test(word.text) && !startsSentence;
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
