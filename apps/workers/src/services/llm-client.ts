/**
 * One place for the workers' LLM provider calls (REV-37): Anthropic, OpenAI, Gemini and the local
 * Claude Code CLI. Callers pass a system and a user prompt and get the model's raw text back;
 * parsing and validating it stays with the caller.
 */
import { env } from '../config/env.js';
import { ClaudeCliRunner, createClaudeCliRunner } from './claude-cli.js';

export type LlmProvider = 'anthropic' | 'openai' | 'gemini' | 'claude-cli' | 'mock';

export interface LlmClientOptions {
  provider?: LlmProvider;
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

export class LlmClient {
  readonly provider: LlmProvider;
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

    const configuredProvider = options.provider ?? env.MVP_LLM_PROVIDER;
    if (configuredProvider) {
      this.provider = configuredProvider;
    } else if (this.anthropicApiKey) {
      this.provider = 'anthropic';
    } else if (this.openaiApiKey) {
      this.provider = 'openai';
    } else if (this.geminiApiKey) {
      this.provider = 'gemini';
    } else {
      this.provider = 'mock';
    }
  }

  /** A real model can be called: the CLI authenticates itself, the APIs need a key */
  isAvailable(): boolean {
    if (this.provider === 'mock') return false;
    if (this.provider === 'claude-cli') return true;
    return Boolean(this.anthropicApiKey || this.openaiApiKey || this.geminiApiKey);
  }

  /** Name of the model behind the provider, for reports and logs */
  get modelName(): string {
    switch (this.provider) {
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022';
      case 'openai':
        return 'gpt-4o';
      case 'gemini':
        return 'gemini-1.5-pro';
      case 'claude-cli':
        return `claude-cli:${env.CLAUDE_CLI_MODEL}`;
      default:
        return 'mock';
    }
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    switch (this.provider) {
      case 'claude-cli':
        // The CLI has no temperature setting
        return this.claudeCliRunner({ systemPrompt: request.systemPrompt, userPrompt: request.userPrompt });
      case 'anthropic':
        return this.callAnthropic(request);
      case 'gemini':
        return this.callGemini(request);
      case 'openai':
        return this.callOpenAi(request);
      default:
        throw new Error('No LLM provider configured');
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
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: request.maxTokens ?? 2000,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      }),
      signal: this.signal(request),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    return data?.content?.[0]?.text || '';
  }

  private async callOpenAi(request: LlmCompletionRequest): Promise<string> {
    const response = await this.fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey!}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.geminiApiKey!}`;

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
