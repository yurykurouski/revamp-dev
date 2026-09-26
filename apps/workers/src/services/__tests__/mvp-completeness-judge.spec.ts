import { describe, it, expect, vi, afterEach } from 'vitest';
import { LlmClient } from '../llm-client.js';
import {
  COMPLETENESS_JUDGE_SYSTEM_PROMPT,
  CompletenessJudge,
  JUDGE_MVP_TEXT_BUDGET,
  buildJudgeUserPrompt,
  withTimeout,
} from '../mvp-completeness-judge.js';

const mvp = { text: 'Smile Dental +48 22 555 12 34', telLinks: ['tel:+48225551234'], mailtoLinks: [], links: [], imageSources: [] };
const source = [{ field: 'phone' as const, value: '+48 22 555 12 34' }];
const validAnswer = JSON.stringify({
  fields: [{ field: 'phone', status: 'present', mvpQuote: '+48 22 555 12 34' }],
  unsourced: [],
});

const judgeWith = (runner: ReturnType<typeof vi.fn>, timeoutMs = 1000) =>
  new CompletenessJudge({ client: new LlmClient({ provider: 'claude-cli', claudeCliRunner: runner }), timeoutMs });

describe('CompletenessJudge (REV-37)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for quotes and forbids scores in the system prompt', () => {
    expect(COMPLETENESS_JUDGE_SYSTEM_PROMPT).toMatch(/copied EXACTLY/);
    expect(COMPLETENESS_JUDGE_SYSTEM_PROMPT).toMatch(/Never output numbers, scores or percentages/);
    // Same meaning as the code check: reusing any image or testimonial counts
    expect(COMPLETENESS_JUDGE_SYSTEM_PROMPT).toMatch(/images and testimonials: "present" when AT LEAST ONE/);
  });

  it('sends only the source fields and the MVP view, within the size budget', () => {
    const prompt = JSON.parse(
      buildJudgeUserPrompt(
        [
          { field: 'services', items: Array.from({ length: 30 }, (_, i) => `Service ${i}`) },
          { field: 'address', value: 'x'.repeat(1000) },
        ],
        { ...mvp, text: 'y'.repeat(JUDGE_MVP_TEXT_BUDGET + 500), links: Array.from({ length: 100 }, (_, i) => `https://a.pl/${i}`) },
      ),
    );
    expect(prompt.source[0].items).toHaveLength(20);
    expect(prompt.source[1].value.length).toBeLessThanOrEqual(401);
    expect(prompt.mvp.text.length).toBeLessThanOrEqual(JUDGE_MVP_TEXT_BUDGET + 1);
    expect(prompt.mvp.links).toHaveLength(40);
  });

  it('returns the validated verdicts', async () => {
    const runner = vi.fn().mockResolvedValue(`Here you go:\n${validAnswer}`);
    const result = await judgeWith(runner).judge(source, mvp);
    expect(result.fields[0]).toMatchObject({ field: 'phone', status: 'present', mvpQuote: '+48 22 555 12 34' });
    expect(result.unsourced).toEqual([]);
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: COMPLETENESS_JUDGE_SYSTEM_PROMPT }));
  });

  it('retries once on an invalid answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runner = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce(validAnswer);
    await expect(judgeWith(runner).judge(source, mvp)).resolves.toBeDefined();
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('rejects answers with an unknown status, a score-like field or an empty quote', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const bad of [
      { fields: [{ field: 'phone', status: 'maybe' }] },
      { fields: [{ field: 'fax', status: 'present', mvpQuote: 'x' }] },
      { fields: 'none' },
    ]) {
      const runner = vi.fn().mockResolvedValue(JSON.stringify(bad));
      await expect(judgeWith(runner).judge(source, mvp)).rejects.toThrow('LLM answer invalid');
    }
  });

  it('treats empty or null quotes and reasons as absent instead of rejecting the answer', async () => {
    const runner = vi.fn().mockResolvedValue(
      JSON.stringify({
        fields: [
          { field: 'phone', status: 'missing', mvpQuote: '', reason: null },
          { field: 'services', status: 'missing', items: [{ value: 'Implants', found: false, mvpQuote: '  ' }] },
        ],
        unsourced: [
          { field: 'email', mvpQuote: '' },
          { field: 'phone', mvpQuote: '+48 111 222 333' },
        ],
      }),
    );
    const result = await judgeWith(runner).judge(source, mvp);
    expect(result.fields[0]).toEqual({ field: 'phone', status: 'missing' });
    expect(result.fields[1]!.items).toEqual([{ value: 'Implants', found: false }]);
    // An unverifiable made-up entry is dropped
    expect(result.unsourced).toEqual([{ field: 'phone', mvpQuote: '+48 111 222 333' }]);
  });

  it('explains an invalid answer briefly, as path and message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runner = vi.fn().mockResolvedValue(JSON.stringify({ fields: [{ field: 'phone', status: 'maybe' }] }));
    const error = await judgeWith(runner).judge(source, mvp).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/^LLM answer invalid: fields\.0\.status: /);
    expect((error as Error).message).not.toContain('"code"');
  });

  it('gives up after the retries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runner = vi.fn().mockResolvedValue('still not json');
    await expect(judgeWith(runner).judge(source, mvp)).rejects.toThrow('LLM answer invalid');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('does not retry provider errors', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('CLI crashed'));
    await expect(judgeWith(runner).judge(source, mvp)).rejects.toThrow('CLI crashed');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('times out a model that never answers', async () => {
    const runner = vi.fn().mockReturnValue(new Promise(() => undefined));
    await expect(judgeWith(runner, 30).judge(source, mvp)).rejects.toThrow('LLM timed out after 30 ms');
  });

  it('reports availability and the model from its client', () => {
    expect(new CompletenessJudge({ client: new LlmClient({ provider: 'mock' }), timeoutMs: 10 }).isAvailable()).toBe(false);
    expect(judgeWith(vi.fn()).modelName).toMatch(/^claude-cli:/);
  });

  it('withTimeout resolves fast promises and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});
