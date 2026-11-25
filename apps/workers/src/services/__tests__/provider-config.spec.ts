import { describe, it, expect } from 'vitest';
import { providerConfigWarnings } from '../provider-config.js';
import { DesignCritiqueService } from '../design-critique.service.js';

describe('provider configuration warnings (REV-45)', () => {
  it('reports nothing when every provider is configured', () => {
    expect(providerConfigWarnings({ llmUnavailableReason: undefined })).toEqual([]);
  });

  it('does not warn about a Vision key when the local CLI can run the critique (REV-51)', () => {
    const visionUnavailableReason = new DesignCritiqueService({
      anthropicApiKey: '',
      openaiApiKey: '',
      claudeCliAvailable: true,
    }).unavailableReason();
    expect(providerConfigWarnings({ visionUnavailableReason })).toEqual([]);
  });

  it('names each missing provider and what will fail without it', () => {
    const visionUnavailableReason = new DesignCritiqueService({
      anthropicApiKey: '',
      openaiApiKey: '',
      claudeCliAvailable: false,
    }).unavailableReason();
    const warnings = providerConfigWarnings({ visionUnavailableReason, llmUnavailableReason: 'No LLM provider is configured' });

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/ANTHROPIC_API_KEY or OPENAI_API_KEY, or install the Claude Code CLI.*audits will fail/);
    expect(warnings[1]).toBe('No LLM provider is configured: MVP generation without a provider chosen in the dashboard will fail');
    // Email delivery is simulated (REV-221): there is no provider to warn about
    expect(warnings.some((w) => /email/i.test(w))).toBe(false);
  });

  it('has no email warning with no inputs at all (REV-221)', () => {
    expect(providerConfigWarnings({}).some((w) => /email/i.test(w))).toBe(false);
  });
});
