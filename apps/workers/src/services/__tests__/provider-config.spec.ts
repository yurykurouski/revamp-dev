import { describe, it, expect } from 'vitest';
import { providerConfigWarnings } from '../provider-config.js';
import { EMAIL_PROVIDER_NOT_CONFIGURED } from '../email.service.js';

describe('provider configuration warnings (REV-45)', () => {
  it('reports nothing when every provider is configured', () => {
    expect(providerConfigWarnings({ emailProvider: 'resend', anthropicApiKey: 'a', llmUnavailableReason: undefined })).toEqual([]);
  });

  it('accepts an OpenAI key for the Vision critique', () => {
    expect(providerConfigWarnings({ emailProvider: 'smtp', openaiApiKey: 'o' })).toEqual([]);
  });

  it('names each missing provider and what will fail without it', () => {
    const warnings = providerConfigWarnings({ llmUnavailableReason: 'No LLM provider is configured' });

    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/ANTHROPIC_API_KEY or OPENAI_API_KEY.*audits will fail/);
    expect(warnings[1]).toBe('No LLM provider is configured: MVP generation without a provider chosen in the dashboard will fail');
    expect(warnings[2]).toBe(`${EMAIL_PROVIDER_NOT_CONFIGURED}: approved emails will fail at dispatch`);
  });
});
