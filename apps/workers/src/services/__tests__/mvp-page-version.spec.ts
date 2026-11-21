import { describe, expect, it } from 'vitest';
import { pageVersionEntry } from '../mvp-page-version.js';

const at = new Date('2026-11-21T12:00:00Z');

describe('pageVersionEntry (REV-200)', () => {
  it('returns an entry that passed MvpPageVersionSchema, with every optional field', () => {
    const entry = pageVersionEntry({
      n: 2,
      kind: 'change',
      instruction: 'Serif headings',
      jobId: 'job-1',
      provider: 'anthropic',
      model: 'claude-x',
      storagePath: 'v/s/versions/2.html',
      changes: [{ change: 'Headings use a serif font', reason: 'Matches the original logo' }],
      createdAt: at,
    });
    expect(entry).toMatchObject({ n: 2, kind: 'change', jobId: 'job-1', storagePath: 'v/s/versions/2.html' });
  });

  it('throws on an entry the schema refuses', () => {
    expect(() => pageVersionEntry({ n: 0, kind: 'generate', storagePath: 'x', createdAt: at })).toThrow();
    expect(() => pageVersionEntry({ n: 1, kind: 'generate', storagePath: '', createdAt: at })).toThrow();
  });
});
