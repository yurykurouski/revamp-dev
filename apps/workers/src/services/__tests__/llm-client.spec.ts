import { describe, it, expect, vi } from 'vitest';
import { LlmClient, extractJsonObject } from '../llm-client.js';

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

const request = { systemPrompt: 'SYSTEM', userPrompt: 'USER', temperature: 0.2, maxTokens: 123 };

describe('LlmClient (REV-37)', () => {
  describe('provider selection', () => {
    it('uses the configured provider', () => {
      expect(new LlmClient({ provider: 'gemini', geminiApiKey: 'g' }).provider).toBe('gemini');
    });

    it('picks the first API key present when no provider is configured', () => {
      expect(new LlmClient({ anthropicApiKey: 'a', openaiApiKey: 'o' }).provider).toBe('anthropic');
      expect(new LlmClient({ openaiApiKey: 'o' }).provider).toBe('openai');
      expect(new LlmClient({ geminiApiKey: 'g' }).provider).toBe('gemini');
      expect(new LlmClient({}).provider).toBe('mock');
    });

    it('is available with an API key or the local CLI, never with mock', () => {
      expect(new LlmClient({ provider: 'mock' }).isAvailable()).toBe(false);
      expect(new LlmClient({ provider: 'claude-cli' }).isAvailable()).toBe(true);
      expect(new LlmClient({ provider: 'openai', openaiApiKey: 'o' }).isAvailable()).toBe(true);
      expect(new LlmClient({ provider: 'anthropic' }).isAvailable()).toBe(false);
    });

    it('names the model behind the provider', () => {
      expect(new LlmClient({ provider: 'openai', openaiApiKey: 'o' }).modelName).toBe('gpt-4o');
      expect(new LlmClient({ provider: 'claude-cli' }).modelName).toMatch(/^claude-cli:/);
    });
  });

  describe('complete', () => {
    it('calls Anthropic with the system prompt, temperature and token limit', async () => {
      const fetcher = okJson({ content: [{ text: 'hello' }] });
      const client = new LlmClient({ provider: 'anthropic', anthropicApiKey: 'key', customFetcher: fetcher as unknown as typeof fetch });

      await expect(client.complete(request)).resolves.toBe('hello');
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers['x-api-key']).toBe('key');
      expect(JSON.parse(init.body)).toMatchObject({
        system: 'SYSTEM',
        temperature: 0.2,
        max_tokens: 123,
        messages: [{ role: 'user', content: 'USER' }],
      });
    });

    it('calls OpenAI in JSON mode', async () => {
      const fetcher = okJson({ choices: [{ message: { content: '{"a":1}' } }] });
      const client = new LlmClient({ provider: 'openai', openaiApiKey: 'key', customFetcher: fetcher as unknown as typeof fetch });

      await expect(client.complete(request)).resolves.toBe('{"a":1}');
      const body = JSON.parse(fetcher.mock.calls[0]![1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages).toEqual([
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: 'USER' },
      ]);
    });

    it('calls Gemini with the system prompt folded into the content', async () => {
      const fetcher = okJson({ candidates: [{ content: { parts: [{ text: 'gem' }] } }] });
      const client = new LlmClient({ provider: 'gemini', geminiApiKey: 'key', customFetcher: fetcher as unknown as typeof fetch });

      await expect(client.complete(request)).resolves.toBe('gem');
      const body = JSON.parse(fetcher.mock.calls[0]![1].body);
      expect(body.contents[0].parts[0].text).toBe('SYSTEM\n\nContext:\nUSER');
      expect(body.generationConfig).toMatchObject({ temperature: 0.2, maxOutputTokens: 123 });
    });

    it('runs the local Claude CLI with both prompts', async () => {
      const runner = vi.fn().mockResolvedValue('cli answer');
      const client = new LlmClient({ provider: 'claude-cli', claudeCliRunner: runner });

      await expect(client.complete(request)).resolves.toBe('cli answer');
      expect(runner).toHaveBeenCalledWith({ systemPrompt: 'SYSTEM', userPrompt: 'USER' });
    });

    it('throws with the provider error body on a failed HTTP call', async () => {
      const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
      const client = new LlmClient({ provider: 'openai', openaiApiKey: 'key', customFetcher: fetcher as unknown as typeof fetch });
      await expect(client.complete(request)).rejects.toThrow('OpenAI API error (429): rate limited');
    });

    it('passes an abort signal only when a timeout is requested', async () => {
      const fetcher = okJson({ content: [{ text: 'x' }] });
      const client = new LlmClient({ provider: 'anthropic', anthropicApiKey: 'key', customFetcher: fetcher as unknown as typeof fetch });

      await client.complete(request);
      await client.complete({ ...request, timeoutMs: 5000 });
      expect(fetcher.mock.calls[0]![1].signal).toBeUndefined();
      expect(fetcher.mock.calls[1]![1].signal).toBeInstanceOf(AbortSignal);
    });

    it('refuses to run without a provider', async () => {
      await expect(new LlmClient({ provider: 'mock' }).complete(request)).rejects.toThrow('No LLM provider configured');
    });
  });

  describe('extractJsonObject', () => {
    it('extracts the JSON object from text around it', () => {
      expect(extractJsonObject('Sure! ```json\n{"a": {"b": 1}}\n```')).toEqual({ a: { b: 1 } });
    });

    it('throws when there is no JSON object', () => {
      expect(() => extractJsonObject('no json here')).toThrow('did not contain a valid JSON object');
      expect(() => extractJsonObject('{not json}')).toThrow();
    });
  });
});
