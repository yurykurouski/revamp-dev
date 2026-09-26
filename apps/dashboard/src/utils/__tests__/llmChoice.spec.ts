import { describe, it, expect } from 'vitest';
import { ILlmProvidersResponse, LLM_PROVIDER_CATALOG } from '@revamp/shared-types';
import { describeLlm, effectiveLlmChoice, summarizeMvpSource } from '../llmChoice.js';

const providers = (available: Record<string, boolean>): ILlmProvidersResponse => ({
  workersOnline: true,
  defaultProvider: 'anthropic',
  defaultModel: 'claude-opus-5',
  providers: LLM_PROVIDER_CATALOG.map((p) =>
    available[p.id] ? { ...p, available: true } : { ...p, available: false, reason: 'missing_api_key' as const },
  ),
});

describe('LLM choice helpers (REV-32)', () => {
  describe('effectiveLlmChoice', () => {
    it('sends nothing for the server default', () => {
      expect(effectiveLlmChoice({ provider: null, model: null }, providers({ anthropic: true }))).toEqual({});
    });

    it('sends the remembered provider and model while the workers can run them', () => {
      expect(effectiveLlmChoice({ provider: 'claude-cli', model: 'opus' }, providers({ 'claude-cli': true }))).toEqual({
        provider: 'claude-cli',
        model: 'opus',
      });
    });

    it('falls back to the server default when the provider is unavailable or unknown', () => {
      expect(effectiveLlmChoice({ provider: 'openai', model: 'gpt-4o' }, providers({ anthropic: true }))).toEqual({});
      expect(effectiveLlmChoice({ provider: 'openai', model: 'gpt-4o' }, undefined)).toEqual({});
    });
  });

  describe('describeLlm', () => {
    it('uses catalog labels, including CLI models reported with their prefix', () => {
      expect(describeLlm('anthropic', 'claude-sonnet-5')).toBe('Anthropic API · Claude Sonnet 5');
      expect(describeLlm('claude-cli', 'claude-cli:opus')).toBe('Local LLM: Claude Code CLI · Opus');
    });

    it('keeps raw ids it does not know', () => {
      expect(describeLlm('openai', 'gpt-9')).toBe('OpenAI API · gpt-9');
      expect(describeLlm('other', 'x')).toBe('other · x');
    });
  });

  describe('summarizeMvpSource', () => {
    it('returns null for MVPs generated before REV-32', () => {
      expect(summarizeMvpSource({})).toBeNull();
      expect(summarizeMvpSource(null)).toBeNull();
    });

    it('names the actual source and hides a matching request', () => {
      expect(
        summarizeMvpSource({
          provider: 'gemini',
          modelUsed: 'gemini-1.5-flash',
          requestedProvider: 'gemini',
          requestedModel: 'gemini-1.5-flash',
        }),
      ).toEqual({ actual: 'Google Gemini API · Gemini 1.5 Flash' });
    });

    it('shows the operator pick next to a fallback', () => {
      expect(
        summarizeMvpSource({
          provider: 'deterministic',
          modelUsed: 'deterministic-fallback',
          requestedProvider: 'claude-cli',
          requestedModel: 'claude-cli:haiku',
        }),
      ).toEqual({ actual: 'deterministic', requested: 'Local LLM: Claude Code CLI · Haiku' });
    });
  });
});
