import { describe, expect, it } from 'vitest';
import { MVP_CHANGES_MARKER, changesInstruction, readDesignChanges, splitChangesBlock } from '../mvp-page-changes.js';
import { VALID } from './fixtures/page-gen/page.js';

const page = VALID.trim();
const entry = { change: 'Moved the services up', reason: 'Visitors see the offer first.' };
const block = JSON.stringify([entry]);

describe('splitChangesBlock (REV-162)', () => {
  it('returns the whole answer as the page without a marker', () => {
    expect(splitChangesBlock(page)).toEqual({ page });
  });

  it('splits on a marker line after </html>', () => {
    expect(splitChangesBlock(`${page}\n${MVP_CHANGES_MARKER}\n${block}`)).toEqual({ page, block });
  });

  it('strips a fence around the page and one around the block', () => {
    const answer = '```html\n' + page + '\n```\n' + MVP_CHANGES_MARKER + '\n```json\n' + block + '\n```';
    expect(splitChangesBlock(answer)).toEqual({ page, block });
  });

  it('strips a fence around the whole answer before splitting', () => {
    const answer = '```\n' + page + '\n' + MVP_CHANGES_MARKER + '\n' + block + '\n```';
    expect(splitChangesBlock(answer)).toEqual({ page, block });
  });

  it('splits on the last marker', () => {
    const answer = `${page}\n${MVP_CHANGES_MARKER}\n[]\n${MVP_CHANGES_MARKER}\n${block}`;
    expect(splitChangesBlock(answer).block).toBe(block);
  });

  // A slip in the marker must not leave text after </html>, which fails the page checks (final review, REV-162)
  it.each([
    ['JSON on the marker line', `${page}\n${MVP_CHANGES_MARKER} ${block}`],
    ['marker on the </html> line', `${page}${MVP_CHANGES_MARKER}\n${block}`],
    ['spaced marker', `${page}\n=== CHANGES ===\n${block}`],
    ['bold marker', `${page}\n**${MVP_CHANGES_MARKER}**\n${block}`],
    ['fenced block without a marker', `${page}\n\`\`\`json\n${block}\n\`\`\``],
    ['bare block without a marker', `${page}\n${block}`],
  ])('cuts the page at </html> with %s', (_name, answer) => {
    expect(splitChangesBlock(answer).page).toBe(page);
    expect(readDesignChanges(splitChangesBlock(answer).block).changes).toEqual([entry]);
  });

  it('cuts the page at </html> when prose follows it, and that prose gives no changes', () => {
    const { page: cut, block: rest } = splitChangesBlock(`${page}\nHope this helps!`);
    expect(cut).toBe(page);
    expect(readDesignChanges(rest).changes).toBeUndefined();
  });

  it('ignores a marker before </html>, leaving the page to the checks', () => {
    const answer = page.replace('</body>', `${MVP_CHANGES_MARKER}\n${block}\n</body>`);
    expect(splitChangesBlock(answer)).toEqual({ page: answer });
  });
});

describe('readDesignChanges (REV-162)', () => {
  it('gives no changes without a block', () => {
    expect(readDesignChanges(undefined)).toEqual({ dropped: 0 });
  });

  it('gives no changes for broken JSON', () => {
    expect(readDesignChanges('[{"change":')).toEqual({ dropped: 0 });
  });

  it('gives no changes when the block is not an array', () => {
    expect(readDesignChanges(JSON.stringify(entry))).toEqual({ dropped: 0 });
  });

  it('keeps valid entries and drops the rest, with only change and reason', () => {
    const list = [entry, { change: '3 columns', reason: 'x' }, null, 'text', { change: 'a', reason: 'b', why: 'c' }];
    expect(readDesignChanges(JSON.stringify(list))).toEqual({ changes: [entry, { change: 'a', reason: 'b' }], dropped: 3 });
  });

  it('keeps the first 8', () => {
    const list = Array.from({ length: 9 }, (_, i) => ({ change: `Change ${'abcdefghi'[i]}`, reason: 'Clearer.' }));
    const { changes, dropped } = readDesignChanges(JSON.stringify(list));
    expect(changes).toEqual(list.slice(0, 8));
    expect(dropped).toBe(1);
  });

  it('gives no changes when every entry is invalid', () => {
    expect(readDesignChanges(JSON.stringify([{ change: '', reason: '' }]))).toEqual({ dropped: 1 });
  });

  it('reads a fenced block', () => {
    expect(readDesignChanges('```json\n' + block + '\n```').changes).toEqual([entry]);
  });
});

describe('changesInstruction (REV-162)', () => {
  it('names the language, the marker and the limit', () => {
    const text = changesInstruction('pl');
    for (const phrase of ['Polish', MVP_CHANGES_MARKER, '</html>', '8']) expect(text).toContain(phrase);
    expect(text).not.toContain('Russian');
    // A count in words gets around the digit rule as easily as one in digits (live probe, REV-162)
    expect(text).toContain('in digits or in words');
    expect(text).not.toContain('numbers in words if');
  });
});
