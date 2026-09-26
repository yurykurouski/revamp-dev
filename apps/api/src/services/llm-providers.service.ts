import {
  ILlmCapabilities,
  ILlmProvidersResponse,
  LLM_CAPABILITIES_REDIS_KEY,
  LLM_PROVIDER_CATALOG,
} from '@revamp/shared-types';

interface RedisGetter {
  get(key: string): Promise<string | null>;
}

/**
 * The provider/model options for MVP generation (REV-32), with availability taken from the AI
 * worker's last report. Without a fresh report every option is marked unavailable.
 */
export async function getLlmProviders(redis: RedisGetter, nodeEnv: string): Promise<ILlmProvidersResponse> {
  let capabilities: ILlmCapabilities | null = null;
  try {
    const raw = await redis.get(LLM_CAPABILITIES_REDIS_KEY);
    capabilities = raw ? (JSON.parse(raw) as ILlmCapabilities) : null;
  } catch (err) {
    console.warn(`[LlmProviders] Could not read worker LLM capabilities: ${(err as Error).message}`);
  }

  const providers = LLM_PROVIDER_CATALOG.filter((option) => !(option.devOnly && nodeEnv === 'production')).map(
    (option) => {
      const reported = capabilities?.providers.find((p) => p.id === option.id);
      if (!reported) return { ...option, available: false, reason: 'workers_offline' as const };
      return reported.available
        ? { ...option, available: true }
        : { ...option, available: false, ...(reported.reason ? { reason: reported.reason } : {}) };
    },
  );

  return {
    workersOnline: Boolean(capabilities),
    ...(capabilities ? { defaultProvider: capabilities.defaultProvider, defaultModel: capabilities.defaultModel } : {}),
    providers,
  };
}
