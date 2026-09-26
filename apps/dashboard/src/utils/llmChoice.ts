import { ILlmProvidersResponse, LlmProviderId, findLlmProvider } from '@revamp/shared-types';
import { LlmChoice } from '../store/useLlmChoiceStore.js';

/**
 * The choice a generation request actually sends (REV-32): the remembered one while the workers
 * can still run it, otherwise nothing, so the server default applies.
 */
export function effectiveLlmChoice(
  choice: LlmChoice,
  providers: ILlmProvidersResponse | undefined,
): { provider?: LlmProviderId; model?: string } {
  if (!choice.provider) return {};
  const status = providers?.providers.find((p) => p.id === choice.provider);
  if (!status?.available) return {};
  return { provider: choice.provider, ...(choice.model ? { model: choice.model } : {}) };
}

/** "Provider · Model" for a provider id and model id, falling back to the raw ids */
export function describeLlm(provider: string | undefined, model: string | undefined): string {
  const option = findLlmProvider(provider);
  if (!option) return [provider, model].filter(Boolean).join(' · ');
  // The CLI's modelUsed carries a "claude-cli:" prefix
  const modelId = model?.replace(/^claude-cli:/, '');
  const modelLabel = option.models.find((m) => m.id === modelId)?.label ?? modelId;
  return [option.label, modelLabel].filter(Boolean).join(' · ');
}

export interface MvpSourceSummary {
  /** Who wrote the copy; `deterministic` when the fallback did */
  actual: string | 'deterministic';
  /** The operator's pick, only when it differs from what actually ran */
  requested?: string;
}

/** What the inspector says about who wrote an MVP's copy, or null for MVPs made before REV-32 */
export function summarizeMvpSource(mvp: {
  provider?: string;
  modelUsed?: string;
  requestedProvider?: string;
  requestedModel?: string;
} | null | undefined): MvpSourceSummary | null {
  if (!mvp?.provider) return null;
  const actual = mvp.provider === 'deterministic' ? 'deterministic' : describeLlm(mvp.provider, mvp.modelUsed);
  const requested = mvp.requestedProvider ? describeLlm(mvp.requestedProvider, mvp.requestedModel) : undefined;
  return requested && requested !== actual ? { actual, requested } : { actual };
}
