import { describe, it, expect } from 'vitest';
import { EnvSchema } from '../env.js';

describe('worker env schema: MVP LLM provider (REV-30)', () => {
  it('defaults the Claude CLI settings and leaves the provider unset', () => {
    const env = EnvSchema.parse({});
    expect(env.MVP_LLM_PROVIDER).toBeUndefined();
    expect(env.CLAUDE_CLI_PATH).toBe('claude');
    expect(env.CLAUDE_CLI_MODEL).toBe('sonnet');
    expect(env.CLAUDE_CLI_TIMEOUT_MS).toBe(120000);
  });

  it('accepts claude-cli as the provider and coerces the timeout', () => {
    const env = EnvSchema.parse({
      MVP_LLM_PROVIDER: 'claude-cli',
      CLAUDE_CLI_PATH: '/opt/bin/claude',
      CLAUDE_CLI_MODEL: 'opus',
      CLAUDE_CLI_TIMEOUT_MS: '90000',
    });
    expect(env.MVP_LLM_PROVIDER).toBe('claude-cli');
    expect(env.CLAUDE_CLI_PATH).toBe('/opt/bin/claude');
    expect(env.CLAUDE_CLI_MODEL).toBe('opus');
    expect(env.CLAUDE_CLI_TIMEOUT_MS).toBe(90000);
  });

  it('treats an empty provider (as in .env.example) as unset', () => {
    expect(EnvSchema.parse({ MVP_LLM_PROVIDER: '' }).MVP_LLM_PROVIDER).toBeUndefined();
  });

  it('rejects an unknown provider', () => {
    expect(() => EnvSchema.parse({ MVP_LLM_PROVIDER: 'llama' })).toThrow();
  });

  it('rejects a non-positive or non-numeric timeout', () => {
    expect(() => EnvSchema.parse({ CLAUDE_CLI_TIMEOUT_MS: '0' })).toThrow();
    expect(() => EnvSchema.parse({ CLAUDE_CLI_TIMEOUT_MS: 'soon' })).toThrow();
  });
});
