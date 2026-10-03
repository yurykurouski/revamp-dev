import { describe, it, expect, vi } from 'vitest';
import { rebuildEligibility } from '@revamp/validation';
import type { LlmClient } from '../llm-client.js';
import { readSiteSections } from '../site-sections.service.js';
import { SiteGroupingService, readPageSections } from '../site-grouping.service.js';
import { answer, passingRules, raw, rulesRaw } from './fixtures/grouping-fixtures.js';

const clientOf = (...replies: Array<string | Error>) => {
  const completeWithUsage = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) completeWithUsage.mockRejectedValueOnce(r);
    else completeWithUsage.mockResolvedValueOnce({ text: r, usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
  }
  return { completeWithUsage, provider: 'anthropic', modelName: 'stub', unavailableReason: () => undefined } as unknown as LlmClient;
};
const tiles = [{ data: Buffer.from('x'), top: 0, bottom: 1400 }];
const input = { outline: raw.outline!, tiles, url: 'https://anident.test/' };

describe('SiteGroupingService (REV-113)', () => {
  it('returns a valid answer with its usage, also when wrapped in prose or a json fence', async () => {
    const svc = new SiteGroupingService({ client: clientOf('Here you go:\n```json\n' + JSON.stringify(answer) + '\n```') });
    const r = await svc.group(input);
    expect('answer' in r && r.answer.sections).toHaveLength(3);
    expect(r.usage?.totalTokens).toBe(110);
  });

  it('retries once at temperature 0 after a failure, then uses the answer', async () => {
    const client = clientOf(new Error('timeout'), JSON.stringify(answer));
    const r = await new SiteGroupingService({ client }).group(input);
    expect('answer' in r).toBe(true);
    const calls = vi.mocked(client.completeWithUsage).mock.calls;
    expect(calls.map((c) => c[0].temperature)).toEqual([0.1, 0]);
    expect(calls[0]![0].images).toHaveLength(1);
    expect(calls[0]![0].userPrompt).toContain('3 heading styled');
  });

  it('gives up after two invalid answers with the reasons, and sums the usage', async () => {
    const bad = JSON.stringify({ ...answer, footer: { pieces: [99] } });
    const r = await new SiteGroupingService({ client: clientOf(bad, bad) }).group(input);
    expect('error' in r && r.error).toMatch(/2 attempts.*unknown id 99/);
    expect(r.usage?.totalTokens).toBe(220);
  });

  it('tells the model why its first answer was rejected when it asks again', async () => {
    const bad = JSON.stringify({ ...answer, footer: { pieces: [11, 4] } });
    const client = clientOf(bad, JSON.stringify(answer));
    const r = await new SiteGroupingService({ client }).group(input);
    expect('answer' in r).toBe(true);
    const prompts = vi.mocked(client.completeWithUsage).mock.calls.map((c) => c[0].userPrompt);
    expect(prompts[0]).not.toContain('rejected');
    expect(prompts[1]).toContain('Your previous answer was rejected: piece 4 used twice');
  });

  it('a heading-less answer is invalid and falls back', async () => {
    const noHeading = JSON.stringify({ sections: [{ pieces: [4], kind: 'other', arrangement: 'text' }] });
    const r = await new SiteGroupingService({ client: clientOf(noHeading, noHeading) }).group(input);
    expect('error' in r && r.error).toMatch(/schema: sections\.0\.heading/);
  });

  it('says why no model can be called', () => {
    const client = { unavailableReason: () => 'No LLM provider is configured' } as unknown as LlmClient;
    expect(new SiteGroupingService({ client }).unavailableReason()).toMatch(/section grouping: No LLM provider/);
  });
});

describe('readPageSections (REV-113)', () => {
  it('stores the model reading when it is valid', async () => {
    const r = await readPageSections({ raw, layoutBlocks: [], tiles, url: 'u', grouping: new SiteGroupingService({ client: clientOf(JSON.stringify(answer)) }) });
    expect(r.reading.sections?.source).toBe('llm');
    expect(r.measurementError).toBeUndefined();
    expect(r.usage?.totalTokens).toBe(110);
    expect(r.modelUsed).toBe('stub');
    // The ids-only answer, for the recorder script
    expect(r.answer).toEqual(answer);
  });

  it('stores the rules reading and a sections error when no model is configured', async () => {
    const grouping = { unavailableReason: () => 'No vision model', group: vi.fn() } as unknown as SiteGroupingService;
    const r = await readPageSections({ raw: rulesRaw, layoutBlocks: [], tiles, url: 'u', grouping });
    expect(r.reading.sections?.source).toBe('rules');
    expect(r.measurementError).toEqual({ measurement: 'sections', message: 'No vision model' });
    expect(grouping.group).not.toHaveBeenCalled();
  });

  it('stores the rules reading when the outline is missing', async () => {
    const r = await readPageSections({ raw: { ...rulesRaw, outline: undefined }, layoutBlocks: [], tiles, url: 'u' });
    expect(r.reading.sections?.source).toBe('rules');
    expect(r.measurementError?.message).toBe('No page outline');
  });

  it('stores the rules reading with the reason when the model gives no valid grouping', async () => {
    const r = await readPageSections({ raw: rulesRaw, layoutBlocks: [], tiles, url: 'u', grouping: new SiteGroupingService({ client: clientOf('nope', 'nope') }) });
    expect(r.reading.sections?.source).toBe('rules');
    expect(r.measurementError?.message).toMatch(/no valid grouping in 2 attempts/);
    expect(r.usage?.totalTokens).toBe(220);
  });

  it('rejects a model reading that fails the rebuild gate where the rules reading passes', async () => {
    expect(rebuildEligibility({ siteSections: readSiteSections(passingRules).sections })).toEqual({ ok: true });
    // One giant section: flat
    const flat = { sections: [{ heading: 3, pieces: [4, 5, 6, 7, 8, 9, 10], kind: 'other', arrangement: 'text' }] };
    const r = await readPageSections({ raw: passingRules, layoutBlocks: [], tiles, url: 'u', grouping: new SiteGroupingService({ client: clientOf(JSON.stringify(flat)) }) });
    expect(r.reading.sections?.source).toBe('rules');
    expect(r.measurementError?.message).toMatch(/fails rebuild:/);
    // The rejected answer is still returned for the recorder
    expect(r.answer?.sections).toHaveLength(1);
  });

  it('stores the rules reading when reading the model answer throws', async () => {
    const grouping = { unavailableReason: () => undefined, group: vi.fn().mockResolvedValue({ answer: { sections: [{ heading: 3, pieces: null, kind: 'other', arrangement: 'text' }] }, modelUsed: 'stub' }) } as unknown as SiteGroupingService;
    const r = await readPageSections({ raw: rulesRaw, layoutBlocks: [], tiles, url: 'u', grouping });
    expect(r.reading.sections?.source).toBe('rules');
    expect(r.measurementError?.message).toMatch(/could not be read/);
  });

  it('keeps the rules error when neither reader has sections', async () => {
    const r = await readPageSections({ rawError: 'Section collection failed: boom', layoutBlocks: [], tiles, url: 'u' });
    expect(r.reading.error).toBe('Section collection failed: boom');
    expect(r.measurementError?.message).toBe('No page outline');
  });
});
