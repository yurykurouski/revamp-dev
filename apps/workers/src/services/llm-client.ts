/**
 * One place for the workers' LLM provider calls (REV-37): Anthropic, OpenAI, Gemini and the local
 * Claude Code CLI. Callers pass a system and a user prompt and get the model's raw text back;
 * parsing and validating it stays with the caller.
 */
import { LlmProviderId, findLlmProvider } from '@revamp/shared-types';
import { env } from '../config/env.js';
import { ClaudeCliRunner, createClaudeCliRunner } from './claude-cli.js';

export type LlmProvider = LlmProviderId;

/** Current Anthropic models reject sampling parameters such as temperature (400) */
const ANTHROPIC_NO_SAMPLING = /^claude-(opus-5|sonnet-5|opus-4-[78]|fable|mythos)/;

export interface LlmClientOptions {
  provider?: LlmProvider;
  /** Model for the provider; its catalog default (or CLAUDE_CLI_MODEL for the CLI) otherwise (REV-32) */
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  customFetcher?: typeof fetch;
  /** Replaces the local Claude Code CLI call for the 'claude-cli' provider */
  claudeCliRunner?: ClaudeCliRunner;
}

export interface LlmCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens?: number;
  /** Aborts HTTP provider calls after this long; the CLI has its own timeout */
  timeoutMs?: number;
}

/**
 * The provider a client uses when none is passed: MVP_LLM_PROVIDER, else the first API key set.
 * Undefined when nothing is configured; callers then fail instead of inventing copy (REV-45).
 */
export function resolveDefaultProvider(keys: {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
} = {
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  openaiApiKey: env.OPENAI_API_KEY,
  geminiApiKey: env.GEMINI_API_KEY,
}): LlmProvider | undefined {
  if (env.MVP_LLM_PROVIDER) return env.MVP_LLM_PROVIDER;
  if (keys.anthropicApiKey) return 'anthropic';
  if (keys.openaiApiKey) return 'openai';
  if (keys.geminiApiKey) return 'gemini';
  return undefined;
}

/** A provider's default model; the CLI's comes from CLAUDE_CLI_MODEL */
export function defaultModelFor(provider: LlmProvider): string {
  if (provider === 'claude-cli') return env.CLAUDE_CLI_MODEL;
  return findLlmProvider(provider)?.defaultModel ?? '';
}

/** The environment variable that holds each HTTP provider's API key */
const API_KEY_VARS: Partial<Record<LlmProvider, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export class LlmClient {
  /** Undefined when no provider is configured (REV-45) */
  readonly provider: LlmProvider | undefined;
  readonly model: string;
  private readonly anthropicApiKey?: string;
  private readonly openaiApiKey?: string;
  private readonly geminiApiKey?: string;
  private readonly fetcher: typeof fetch;
  private readonly claudeCliRunner: ClaudeCliRunner;

  constructor(options: LlmClientOptions = {}) {
    this.anthropicApiKey = options.anthropicApiKey ?? env.ANTHROPIC_API_KEY;
    this.openaiApiKey = options.openaiApiKey ?? env.OPENAI_API_KEY;
    this.geminiApiKey = options.geminiApiKey ?? env.GEMINI_API_KEY;
    this.fetcher = options.customFetcher ?? fetch;
    this.claudeCliRunner =
      options.claudeCliRunner ??
      createClaudeCliRunner({
        cliPath: env.CLAUDE_CLI_PATH,
        model: env.CLAUDE_CLI_MODEL,
        timeoutMs: env.CLAUDE_CLI_TIMEOUT_MS,
      });

    this.provider =
      options.provider ??
      resolveDefaultProvider({
        anthropicApiKey: this.anthropicApiKey,
        openaiApiKey: this.openaiApiKey,
        geminiApiKey: this.geminiApiKey,
      });
    this.model = options.model ?? (this.provider ? defaultModelFor(this.provider) : '');
  }

  /** A real model can be called: the CLI authenticates itself, each API needs its own key */
  isAvailable(): boolean {
    switch (this.provider) {
      case 'claude-cli':
        return true;
      case 'anthropic':
        return Boolean(this.anthropicApiKey);
      case 'openai':
        return Boolean(this.openaiApiKey);
      case 'gemini':
        return Boolean(this.geminiApiKey);
      default:
        return false;
    }
  }

  /** Why no model can be called, or undefined when one can (REV-45) */
  unavailableReason(): string | undefined {
    if (!this.provider) {
      return 'No LLM provider is configured: set MVP_LLM_PROVIDER or one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY';
    }
    if (this.isAvailable()) return undefined;
    return `LLM provider "${this.provider}" has no API key: set ${API_KEY_VARS[this.provider] ?? 'its API key'}`;
  }

  /** Name of the model behind the provider, for reports and logs */
  get modelName(): string {
    if (this.provider === 'claude-cli') return `claude-cli:${this.model}`;
    return this.model || 'none';
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    switch (this.provider) {
      case 'claude-cli':
        // The CLI has no temperature setting
        return this.claudeCliRunner({
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          model: this.model,
        });
      case 'anthropic':
        return this.callAnthropic(request);
      case 'gemini':
        return this.callGemini(request);
      case 'openai':
        return this.callOpenAi(request);
      default:
        throw new Error(this.unavailableReason() ?? 'No LLM provider configured');
    }
  }

  private signal(request: LlmCompletionRequest): AbortSignal | undefined {
    return request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined;
  }

  private async callAnthropic(request: LlmCompletionRequest): Promise<string> {
    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicApiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        // Current models think adaptively by default, and thinking counts against max_tokens
        max_tokens: request.maxTokens ?? 16000,
        ...(ANTHROPIC_NO_SAMPLING.test(this.model) ? {} : { temperature: request.temperature }),
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      }),
      signal: this.signal(request),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errBody}`);
    }

    // A thinking block may come before the answer
    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    return data?.content?.find((block) => block.type === 'text' || (!block.type && block.text))?.text || '';
  }

  private async callOpenAi(request: LlmCompletionRequest): Promise<string> {
    const response = await this.fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey!}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 2000,
        temperature: request.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
      }),
      signal: this.signal(request),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data?.choices?.[0]?.message?.content || '';
  }

  private async callGemini(request: LlmCompletionRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${this.geminiApiKey!}`;

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: `${request.systemPrompt}\n\nContext:\n${request.userPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens ?? 2000,
          responseMimeType: 'application/json',
        },
      }),
      signal: this.signal(request),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

/** Extracts the first JSON object from a model's text answer */
export function extractJsonObject(rawText: string): unknown {
  const jsonMatch = rawText.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM response did not contain a valid JSON object.');
  }
  return JSON.parse(jsonMatch[0]);
}
