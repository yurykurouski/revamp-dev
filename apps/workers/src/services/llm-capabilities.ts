/**
 * What the AI worker can run on this host (REV-32): which providers have an API key, and whether
 * the local `claude` binary exists. Published to Redis so the API can tell the dashboard which
 * provider/model options to offer, since the keys and the CLI live on the worker, not the API.
 */
import fs from 'fs';
import path from 'path';
import {
  ILlmCapabilities,
  LLM_CAPABILITIES_REDIS_KEY,
  LLM_PROVIDER_CATALOG,
  LlmProviderId,
  LlmUnavailableReason,
} from '@revamp/shared-types';
import { env } from '../config/env.js';
import { defaultModelFor, resolveDefaultProvider } from './llm-client.js';

/** How often the worker refreshes its report, and how long the API trusts one */
export const LLM_CAPABILITIES_REFRESH_MS = 60_000;
export const LLM_CAPABILITIES_TTL_SECONDS = 180;

export interface LlmCapabilityInputs {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  claudeCliPath: string;
  nodeEnv: string;
  /** Replaces the executable check, for tests */
  isExecutable?: (filePath: string) => boolean;
  pathEnv?: string;
}

const defaultIsExecutable = (filePath: string): boolean => {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

/**
 * Finds the CLI the way a shell would: a path is checked as-is, a bare name is looked up on PATH
 */
export function findExecutable(
  command: string,
  pathEnv: string = process.env.PATH ?? '',
  isExecutable: (filePath: string) => boolean = defaultIsExecutable,
): string | undefined {
  if (!command) return undefined;
  if (command.includes('/') || command.includes(path.sep)) {
    return isExecutable(command) ? command : undefined;
  }
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export function detectLlmCapabilities(
  inputs: LlmCapabilityInputs = {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    claudeCliPath: env.CLAUDE_CLI_PATH,
    nodeEnv: env.NODE_ENV,
  },
): ILlmCapabilities {
  const keys: Partial<Record<LlmProviderId, string | undefined>> = {
    anthropic: inputs.anthropicApiKey,
    openai: inputs.openaiApiKey,
    gemini: inputs.geminiApiKey,
  };

  const providers = LLM_PROVIDER_CATALOG.map((option) => {
    let reason: LlmUnavailableReason | undefined;
    if (option.devOnly && inputs.nodeEnv === 'production') {
      reason = 'dev_only';
    } else if (option.id === 'claude-cli') {
      if (!findExecutable(inputs.claudeCliPath, inputs.pathEnv, inputs.isExecutable)) reason = 'cli_not_found';
    } else if (!keys[option.id]) {
      reason = 'missing_api_key';
    }
    return reason ? { id: option.id, available: false, reason } : { id: option.id, available: true };
  });

  const defaultProvider = resolveDefaultProvider({
    anthropicApiKey: inputs.anthropicApiKey,
    openaiApiKey: inputs.openaiApiKey,
    geminiApiKey: inputs.geminiApiKey,
  });

  return {
    checkedAt: new Date().toISOString(),
    ...(defaultProvider ? { defaultProvider, defaultModel: defaultModelFor(defaultProvider) } : {}),
    providers,
  };
}

interface RedisSetter {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export async function publishLlmCapabilities(
  redis: RedisSetter,
  capabilities: ILlmCapabilities = detectLlmCapabilities(),
): Promise<void> {
  await redis.set(LLM_CAPABILITIES_REDIS_KEY, JSON.stringify(capabilities), 'EX', LLM_CAPABILITIES_TTL_SECONDS);
}

/**
 * Publishes now and then on an interval, so the report expires if the workers stop.
 * Failures are logged, never thrown: the dashboard only loses the availability hints.
 */
export function startLlmCapabilitiesReporter(redis: RedisSetter): () => void {
  const publish = () =>
    publishLlmCapabilities(redis).catch((err: Error) =>
      console.warn(`[LlmCapabilities] Could not publish LLM capabilities: ${err.message}`),
    );
  void publish();
  const timer = setInterval(publish, LLM_CAPABILITIES_REFRESH_MS);
  timer.unref();
  return () => clearInterval(timer);
}
