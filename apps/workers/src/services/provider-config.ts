/**
 * Startup check for the external providers the workers need (REV-45). Nothing is faked when one
 * is missing: the jobs that need it fail with the same message, so the operator sees it early.
 */
import { env } from '../config/env.js';
import { DesignCritiqueService } from './design-critique.service.js';
import { EMAIL_PROVIDER_NOT_CONFIGURED } from './email.service.js';
import { LlmClient } from './llm-client.js';

export interface ProviderConfigInputs {
  emailProvider?: string;
  /** Why the Vision design critique cannot run (no key and no local CLI), or undefined when it can */
  visionUnavailableReason?: string;
  /** Why MVP copy cannot be generated, or undefined when it can */
  llmUnavailableReason?: string;
}

export function providerConfigWarnings(
  inputs: ProviderConfigInputs = {
    emailProvider: env.EMAIL_PROVIDER,
    visionUnavailableReason: new DesignCritiqueService().unavailableReason(),
    llmUnavailableReason: new LlmClient().unavailableReason(),
  },
): string[] {
  const warnings: string[] = [];
  if (inputs.visionUnavailableReason) {
    warnings.push(`${inputs.visionUnavailableReason}: audits will fail at the design critique`);
  }
  if (inputs.llmUnavailableReason) {
    warnings.push(`${inputs.llmUnavailableReason}: MVP generation without a provider chosen in the dashboard will fail`);
  }
  if (!inputs.emailProvider) {
    warnings.push(`${EMAIL_PROVIDER_NOT_CONFIGURED}: approved emails will fail at dispatch`);
  }
  return warnings;
}
