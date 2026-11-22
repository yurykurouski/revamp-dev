import { describe, expect, it } from 'vitest';
import { buildDocsIndex, docSections } from '../lib/docs-index.js';

const doc = [
  '# Title', // 1
  'intro', // 2
  '## A', // 3
  'text', // 4
  '### A.1', // 5
  '```', // 6
  '## not a heading', // 7
  '```', // 8
  'more', // 9
  '## B', // 10
  'end', // 11
].join('\n');

describe('docSections', () => {
  it('lists h2 and h3 headings with their line ranges and skips fenced lines', () => {
    expect(docSections(doc)).toEqual([
      { level: 2, title: 'A', start: 3, end: 9 },
      { level: 3, title: 'A.1', start: 5, end: 9 },
      { level: 2, title: 'B', start: 10, end: 11 },
    ]);
  });

  it('ends a section before the next heading of the same or a higher level', () => {
    const sections = docSections('## A\n### A.1\nx\n### A.2\ny\n## B');
    expect(sections.map((s) => [s.title, s.start, s.end])).toEqual([
      ['A', 1, 5],
      ['A.1', 2, 3],
      ['A.2', 4, 5],
      ['B', 6, 6],
    ]);
  });

  it('ignores trailing blank lines at the end of the file', () => {
    expect(docSections('## A\nx\n\n')).toEqual([{ level: 2, title: 'A', start: 1, end: 2 }]);
  });

  it('handles ~~~ fences and headings with trailing hashes', () => {
    expect(docSections('~~~\n## no\n~~~\n## Yes ##\nz').map((s) => s.title)).toEqual(['Yes']);
  });

  it('keeps a fence open across an inner fence with an info string or a shorter marker', () => {
    const text = ['````', '```json', '## inside', '```', '````', '## After'].join('\n');
    expect(docSections(text).map((s) => s.title)).toEqual(['After']);
    expect(docSections(['```', '```json', '## inside?', '```', '## Out'].join('\n')).map((s) => s.title)).toEqual(['Out']);
  });

  it('keeps a trailing # that is part of the title', () => {
    expect(docSections('## Why F#\nx').map((s) => s.title)).toEqual(['Why F#']);
    expect(docSections('## Closed ##\nx').map((s) => s.title)).toEqual(['Closed']);
  });

  it('returns nothing for a file without h2/h3 headings', () => {
    expect(docSections('# Only a title\ntext')).toEqual([]);
  });
});

describe('buildDocsIndex', () => {
  it('renders one block per file with line ranges, in the given order', () => {
    const index = buildDocsIndex([
      { name: 'b.md', text: '## One\nx' },
      { name: 'a.md', text: '## Two\n### Sub\ny' },
    ]);
    expect(index).toContain('## b.md\n\n- One: 1-2\n');
    expect(index).toContain('## a.md\n\n- Two: 1-3\n  - Sub: 2-3\n');
    expect(index.indexOf('## b.md')).toBeLessThan(index.indexOf('## a.md'));
    expect(index.startsWith('# Revamp-docs Section Index')).toBe(true);
  });

  it('is stable: the same input gives the same output', () => {
    const files = [{ name: 'a.md', text: doc }];
    expect(buildDocsIndex(files)).toBe(buildDocsIndex(files));
  });
});
