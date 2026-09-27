/**
 * Startup check for the external providers the workers need (REV-45). Nothing is faked when one
 * is missing: the jobs that need it fail with the same message, so the operator sees it early.
 */
import { env } from '../config/env.js';
import { EMAIL_PROVIDER_NOT_CONFIGURED } from './email.service.js';
import { LlmClient } from './llm-client.js';

export interface ProviderConfigInputs {
  emailProvider?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** Why MVP copy cannot be generated, or undefined when it can */
  llmUnavailableReason?: string;
}

export function providerConfigWarnings(
  inputs: ProviderConfigInputs = {
    emailProvider: env.EMAIL_PROVIDER,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    llmUnavailableReason: new LlmClient().unavailableReason(),
  },
): string[] {
  const warnings: string[] = [];
  if (!inputs.anthropicApiKey && !inputs.openaiApiKey) {
    warnings.push('No Vision LLM key (ANTHROPIC_API_KEY or OPENAI_API_KEY): audits will fail at the design critique');
  }
  if (inputs.llmUnavailableReason) {
    warnings.push(`${inputs.llmUnavailableReason}: MVP generation without a provider chosen in the dashboard will fail`);
  }
  if (!inputs.emailProvider) {
    warnings.push(`${EMAIL_PROVIDER_NOT_CONFIGURED}: approved emails will fail at dispatch`);
  }
  return warnings;
}
