import { describe, it, expect, vi } from 'vitest';
import { LlmClient, extractJsonObject } from '../llm-client.js';
import { env } from '../../config/env.js';

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
      expect(new LlmClient({}).provider).toBeUndefined();
    });

    it('is available with an API key or the local CLI, never without a provider', () => {
      expect(new LlmClient({}).isAvailable()).toBe(false);
      expect(new LlmClient({ provider: 'claude-cli' }).isAvailable()).toBe(true);
      expect(new LlmClient({ provider: 'openai', openaiApiKey: 'o' }).isAvailable()).toBe(true);
      expect(new LlmClient({ provider: 'anthropic' }).isAvailable()).toBe(false);
    });

    it("needs the chosen provider's own key, not any key (REV-32)", () => {
      expect(new LlmClient({ provider: 'openai', anthropicApiKey: 'a' }).isAvailable()).toBe(false);
      expect(new LlmClient({ provider: 'gemini', openaiApiKey: 'o' }).isAvailable()).toBe(false);
      expect(new LlmClient({ provider: 'anthropic', anthropicApiKey: 'a' }).isAvailable()).toBe(true);
    });

    it('names the model behind the provider', () => {
      expect(new LlmClient({ provider: 'openai', openaiApiKey: 'o' }).modelName).toBe('gpt-4o');
      expect(new LlmClient({ provider: 'claude-cli' }).modelName).toMatch(/^claude-cli:/);
    });

    it("defaults to the catalog's first model, and to CLAUDE_CLI_MODEL for the CLI (REV-32)", () => {
      expect(new LlmClient({ provider: 'anthropic', anthropicApiKey: 'a' }).model).toBe('claude-opus-5');
      expect(new LlmClient({ provider: 'gemini', geminiApiKey: 'g' }).model).toBe('gemini-1.5-pro');
      expect(new LlmClient({ provider: 'claude-cli' }).model).toBe(env.CLAUDE_CLI_MODEL);
      expect(new LlmClient({}).model).toBe('');
    });

    it('uses the model it is given (REV-32)', () => {
      expect(new LlmClient({ provider: 'openai', openaiApiKey: 'o', model: 'gpt-4o-mini' }).modelName).toBe('gpt-4o-mini');
      expect(new LlmClient({ provider: 'claude-cli', model: 'haiku' }).modelName).toBe('claude-cli:haiku');
    });
  });

  describe('complete', () => {
    it('calls Anthropic with the system prompt, temperature and token limit', async () => {
      const fetcher = okJson({ content: [{ type: 'text', text: 'hello' }] });
      const client = new LlmClient({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        anthropicApiKey: 'key',
        customFetcher: fetcher as unknown as typeof fetch,
      });

      await expect(client.complete(request)).resolves.toBe('hello');
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers['x-api-key']).toBe('key');
      expect(JSON.parse(init.body)).toMatchObject({
        model: 'claude-haiku-4-5',
        system: 'SYSTEM',
        temperature: 0.2,
        max_tokens: 123,
        messages: [{ role: 'user', content: 'USER' }],
      });
    });

    it('leaves out temperature for Anthropic models that reject it, and skips thinking blocks (REV-32)', async () => {
      const fetcher = okJson({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'answer' }] });
      const client = new LlmClient({ provider: 'anthropic', anthropicApiKey: 'key', customFetcher: fetcher as unknown as typeof fetch });

      await expect(client.complete({ systemPrompt: 'S', userPrompt: 'U', temperature: 0.3 })).resolves.toBe('answer');
      const body = JSON.parse(fetcher.mock.calls[0]![1].body);
      expect(body.model).toBe('claude-opus-5');
      expect(body).not.toHaveProperty('temperature');
      expect(body.max_tokens).toBe(16000);
    });

    it('sends the chosen OpenAI and Gemini models (REV-32)', async () => {
      const openai = okJson({ choices: [{ message: { content: '{}' } }] });
      await new LlmClient({ provider: 'openai', openaiApiKey: 'k', model: 'gpt-4o-mini', customFetcher: openai as unknown as typeof fetch }).complete(request);
      expect(JSON.parse(openai.mock.calls[0]![1].body).model).toBe('gpt-4o-mini');

      const gemini = okJson({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
      await new LlmClient({ provider: 'gemini', geminiApiKey: 'k', model: 'gemini-1.5-flash', customFetcher: gemini as unknown as typeof fetch }).complete(request);
      expect(gemini.mock.calls[0]![0]).toContain('/models/gemini-1.5-flash:generateContent');
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
      expect(runner).toHaveBeenCalledWith({ systemPrompt: 'SYSTEM', userPrompt: 'USER', model: env.CLAUDE_CLI_MODEL });
    });

    it('passes the chosen model to the local Claude CLI (REV-32)', async () => {
      const runner = vi.fn().mockResolvedValue('cli answer');
      await new LlmClient({ provider: 'claude-cli', model: 'opus', claudeCliRunner: runner }).complete(request);
      expect(runner).toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
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

    it('refuses to run without a provider (REV-45)', async () => {
      await expect(new LlmClient({}).complete(request)).rejects.toThrow('No LLM provider is configured');
    });

    it('explains why no model can be called (REV-45)', () => {
      expect(new LlmClient({}).unavailableReason()).toBe(
        'No LLM provider is configured: set MVP_LLM_PROVIDER or one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY',
      );
      expect(new LlmClient({ provider: 'openai', openaiApiKey: '' }).unavailableReason()).toBe(
        'LLM provider "openai" has no API key: set OPENAI_API_KEY',
      );
      expect(new LlmClient({ provider: 'gemini', geminiApiKey: '' }).unavailableReason()).toContain('GEMINI_API_KEY');
      expect(new LlmClient({ provider: 'anthropic', anthropicApiKey: 'a' }).unavailableReason()).toBeUndefined();
      expect(new LlmClient({ provider: 'claude-cli' }).unavailableReason()).toBeUndefined();
      expect(new LlmClient({}).modelName).toBe('none');
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
