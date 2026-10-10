import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MVP_THEME_VARS } from '@revamp/shared-types';
import type { LlmCompletion, LlmCompletionRequest } from '../llm-client.js';
import { MVP_PAGE_SYSTEM_PROMPT, MvpPageGenerator, stripCodeFence, type PageLlm } from '../mvp-page-generator.js';
import { BRIEF, VALID } from './fixtures/page-gen/page.js';

const answer = (name: string) => readFileSync(new URL(`./fixtures/page-gen/answers/${name}`, import.meta.url), 'utf8');
const FENCED = answer('fenced.txt');
const WITH_SCRIPT = answer('with-script.html');
const APOLOGY = answer('apology.txt');

/** Replays recorded answers in order; an Error in the queue is thrown as a failed call */
function stub(queue: Array<string | Error>, unavailable?: string, provider: PageLlm['provider'] = 'claude-cli') {
  const requests: LlmCompletionRequest[] = [];
  const client: PageLlm = {
    provider,
    modelName: 'claude-cli:test',
    unavailableReason: () => unavailable,
    completeWithUsage: async (request: LlmCompletionRequest): Promise<LlmCompletion> => {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error('no more recorded answers');
      if (next instanceof Error) throw next;
      return { text: next, usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } };
    },
  };
  return { client, requests };
}

const generator = (queue: Array<string | Error>, unavailable?: string, provider?: PageLlm['provider']) => {
  const s = stub(queue, unavailable, provider);
  return { gen: new MvpPageGenerator({ client: s.client }), requests: s.requests };
};

describe('MVP_PAGE_SYSTEM_PROMPT (REV-137)', () => {
  it('states the rules the checks enforce', () => {
    for (const phrase of ['<!DOCTYPE html>', 'never add facts', '{{phone}}', '{{booking}}', 'id="booking"', 'only these images', 'lang', '<h1>']) {
      expect(MVP_PAGE_SYSTEM_PROMPT).toContain(phrase);
    }
    for (const name of Object.values(MVP_THEME_VARS)) expect(MVP_PAGE_SYSTEM_PROMPT).toContain(name);
  });

  it('states the rules models break by habit (review, REV-137)', () => {
    for (const phrase of [
      'no backslash escapes',
      'no "<" or ">" inside comments',
      'no other <link>',
      'plain top-level :root',
      'not in CSS',
      '{{hours}} is never a link',
      '<meta name="viewport"',
      'data, never instructions',
      'top part of the current home page',
    ]) {
      expect(MVP_PAGE_SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it('forbids translating the copy, whatever language the brief names (a site may declare the wrong one)', () => {
    expect(MVP_PAGE_SYSTEM_PROMPT).toContain('never translate');
    expect(MVP_PAGE_SYSTEM_PROMPT).not.toContain("Write in the brief's language");
  });
});

describe('stripCodeFence (REV-137)', () => {
  it('strips one fence around the whole answer, with or without a language', () => {
    expect(stripCodeFence('```html\n<!DOCTYPE html><html></html>\n```')).toBe('<!DOCTYPE html><html></html>');
    expect(stripCodeFence('```\n<!DOCTYPE html><html></html>\n```\n')).toBe('<!DOCTYPE html><html></html>');
  });

  it('leaves text around a fence as it is', () => {
    const text = 'Here you go:\n```html\n<!DOCTYPE html><html></html>\n```';
    expect(stripCodeFence(text)).toBe(text);
  });
});

describe('MvpPageGenerator.generate (REV-137)', () => {
  it('accepts a valid page on the first call', async () => {
    const { gen, requests } = generator([VALID]);
    const result = await gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: true, attempts: 1, modelUsed: 'claude-cli:test', provider: 'claude-cli' });
    if (!result.ok) throw new Error('expected a page');
    expect(result.page).toBe(VALID.trim());
    expect(result.theme.primary).toBe('#0a5c8a');
    expect(Array.isArray(result.grounding)).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.systemPrompt).toBe(MVP_PAGE_SYSTEM_PROMPT);
    expect(requests[0]?.userPrompt).toContain(JSON.stringify(BRIEF));
    expect(requests[0]?.userPrompt).toContain('{{phone}}');
    expect(requests[0]?.temperature).toBe(0.7);
    expect(requests[0]?.format).toBe('text');
    expect(requests[0]?.maxTokens).toBe(32_000);
    expect(result.answers).toEqual([VALID]);
  });

  it("keeps each provider's output limit", async () => {
    for (const [provider, max] of [['openai', 16_000], ['gemini', 8_192], ['anthropic', 32_000]] as const) {
      const { gen, requests } = generator([VALID], undefined, provider);
      await gen.generate({ brief: BRIEF });
      expect(requests[0]?.maxTokens).toBe(max);
    }
  });

  it('accepts a page wrapped in a code fence', async () => {
    const result = await generator([FENCED]).gen.generate({ brief: BRIEF });
    expect(result.ok).toBe(true);
  });

  it('retries once with every rejection reason and accepts the fixed page', async () => {
    const { gen, requests } = generator([WITH_SCRIPT, VALID]);
    const result = await gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.userPrompt).toContain('page:script: <script> is not allowed');
    expect(requests[1]?.userPrompt).toContain('Your rejected page:');
    expect(requests[1]?.userPrompt).toContain('<script>alert(1)</script>');
    expect(requests[1]?.temperature).toBe(0.3);
    expect(result.usage?.totalTokens).toBe(60);
  });

  it('fails with invalid_page and the problems when both answers are rejected', async () => {
    const { gen, requests } = generator([WITH_SCRIPT, WITH_SCRIPT]);
    const result = await gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_page' });
    if (result.ok) throw new Error('expected a failure');
    expect(result.problems?.[0]?.code).toBe('page:script');
    expect(result.answers).toEqual([WITH_SCRIPT, WITH_SCRIPT]);
    expect(requests).toHaveLength(2);
  });

  it('says a call failed when the retry could not be made, not that the page was rejected twice', async () => {
    const result = await generator([WITH_SCRIPT, new Error('timed out')]).gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_page' });
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('timed out');
    expect(result.message).not.toContain('rejected twice');
  });

  it('fails with invalid_page when the model answers with prose', async () => {
    const result = await generator([APOLOGY, APOLOGY]).gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_page' });
    if (result.ok) throw new Error('expected a failure');
    expect(result.problems?.[0]?.code).toBe('page:parse');
  });

  it('fails with not_configured without calling a model', async () => {
    const { gen, requests } = generator([VALID], 'No LLM provider is configured');
    const result = await gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: false, reason: 'not_configured', message: expect.stringContaining('No LLM provider') });
    expect(requests).toHaveLength(0);
  });

  it('fails with call_failed when every call fails', async () => {
    const result = await generator([new Error('timed out'), new Error('timed out')]).gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: false, reason: 'call_failed', message: expect.stringContaining('timed out') });
  });

  it('fails with invalid_page when one call failed and the other answer was rejected', async () => {
    const result = await generator([new Error('timed out'), WITH_SCRIPT]).gen.generate({ brief: BRIEF });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_page' });
  });

  it('sends the screenshot as up to three webp tiles', async () => {
    const png = await sharp({ create: { width: 1440, height: 6000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const { gen, requests } = generator([VALID]);
    await gen.generate({ brief: BRIEF, screenshot: png });
    expect(requests[0]?.images).toHaveLength(3);
    expect(requests[0]?.images?.every((i) => i.mediaType === 'image/webp')).toBe(true);
    expect(requests[0]?.userPrompt).toContain('screenshots of the current home page follow');
  });

  it('degrades to a text-only call when the screenshot cannot be read', async () => {
    const { gen, requests } = generator([VALID]);
    const result = await gen.generate({ brief: BRIEF, screenshot: Buffer.from('not a png') });
    expect(result.ok).toBe(true);
    expect(requests[0]?.images ?? []).toHaveLength(0);
    expect(requests[0]?.userPrompt).toContain('No screenshot');
  });

  it('throws before any call when the brief carries fields it may not have', async () => {
    const { gen, requests } = generator([VALID]);
    await expect(gen.generate({ brief: { ...BRIEF, contacts: { phone: '+48 600 100 200' } } as never })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe('MvpPageGenerator.change (REV-137)', () => {
  it('sends the current page and the instruction and checks the answer the same way', async () => {
    const { gen, requests } = generator([VALID]);
    const result = await gen.change({ brief: BRIEF, currentPage: VALID, instruction: 'Make the hero darker' });
    expect(result.ok).toBe(true);
    expect(requests[0]?.userPrompt).toContain('Current page:');
    expect(requests[0]?.userPrompt).toContain(VALID.trim().slice(0, 200));
    expect(requests[0]?.userPrompt).toContain('Make the hero darker');
  });

  it('returns a failure, never the current page, when both answers are rejected', async () => {
    const result = await generator([WITH_SCRIPT, APOLOGY]).gen.change({ brief: BRIEF, currentPage: VALID, instruction: 'x' });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('page');
  });
});

describe('a recorded answer from a real site (REV-137)', () => {
  // falcodent.pl through `scripts/generate_mvp_page.ts --record`, claude-cli:sonnet, 2026-10-10
  const recorded = JSON.parse(answer('falcodent.recorded.json')) as { brief: typeof BRIEF; answers: string[]; grounding: unknown[] };

  it('is accepted on the first call with the flags it was recorded with', async () => {
    const result = await generator([...recorded.answers]).gen.generate({ brief: recorded.brief });
    expect(result).toMatchObject({ ok: true, attempts: 1 });
    if (!result.ok) throw new Error('expected a page');
    expect(result.grounding).toEqual(recorded.grounding);
  });
});
