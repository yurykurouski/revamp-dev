/**
 * Recorded modernize answers (REV-114): a real page's reading and the model's ids-only modern design for it,
 * saved by `npx tsx scripts/render_rebuild.ts --llm --record <dir> <out-dir> <url...>`. No test calls a live model.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { RebuildModernizeAnswerSchema, RebuildPlanSchema, checkRebuildEdit } from '@revamp/validation';
import type { IRebuildModernizeAnswer, IRebuildPlan, ISiteSections } from '@revamp/shared-types';
import { planRebuild } from '../rebuild-plan.service.js';

const load = (name: string): { siteSections: ISiteSections; answer: IRebuildModernizeAnswer } =>
  JSON.parse(readFileSync(new URL(`./fixtures/modernize/${name}.json`, import.meta.url), 'utf8'));

const plan = (siteSections: ISiteSections, modernize?: IRebuildModernizeAnswer): IRebuildPlan =>
  RebuildPlanSchema.parse(
    planRebuild({
      siteSections,
      businessName: 'Recorded',
      language: 'pl',
      contacts: {},
      socialLinks: [],
      primary: '#2563eb',
      year: 2026,
      ...(modernize ? { modernize } : {}),
    }),
  ) as IRebuildPlan;

/** Every piece of page text in a plan's sections and footer: headings, eyebrows, titles and paragraphs */
const texts = (p: IRebuildPlan): string[] => {
  const out: string[] = [];
  const walk = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      if (['text', 'heading', 'eyebrow', 'title'].includes(key) && value.trim()) out.push(value);
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, k));
  };
  walk({ sections: p.sections, footer: p.footer.section });
  return out;
};

describe.each(['anident', 'falcodent'])('recorded modernize answer: %s.pl (REV-114)', (name) => {
  const { siteSections, answer } = load(name);

  it('passes the answer schema and the page check', () => {
    expect(RebuildModernizeAnswerSchema.safeParse(answer).success).toBe(true);
    expect(checkRebuildEdit(answer, siteSections)).toEqual({ ok: true });
  });

  it('keeps every section and every piece of text of the faithful plan', () => {
    const faithful = plan(siteSections);
    const modern = plan(siteSections, answer);
    // A section left empty by the hero photo move is omitted as `empty`; no other section may go
    const ids = new Set(modern.sections.map((s) => s.id));
    const empties = (p: IRebuildPlan) => p.summary.omitted.filter((o) => o.what === 'section' && o.reason === 'empty').length;
    const gone = faithful.sections.filter((s) => !ids.has(s.id));
    expect(gone.length).toBeLessThanOrEqual(empties(modern) - empties(faithful));
    expect(gone.length).toBeLessThanOrEqual(answer.hero ? 1 : 0);
    const all = JSON.stringify(modern);
    const missing = texts(faithful).filter((t) => !all.includes(JSON.stringify(t).slice(1, -1)));
    expect(missing).toEqual([]);
  });

  it('applies the modern look', () => {
    const modern = plan(siteSections, answer);
    expect(modern.summary.tuning.some((c) => c.startsWith('modernize:'))).toBe(true);
    expect(modern.theme.h1Size).toBe(56);
  });
});

describe('recorded modernize answer: anident.pl look (REV-114)', () => {
  const { siteSections, answer } = load('anident');
  const modern = plan(siteSections, answer);

  it('opens with a hero photo and fills photos on alternating sides', () => {
    expect(answer.hero?.photo).toMatch(/^s-\d+\.m\d+$/);
    const filled = modern.sections.filter((s) => s.mediaFit === 'fill');
    expect(filled.length).toBeGreaterThanOrEqual(2);
    expect(new Set(filled.map((s) => s.mediaSide)).size).toBe(2);
  });
});
