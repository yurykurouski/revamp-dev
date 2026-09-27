import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import { LLM_CAPABILITIES_REDIS_KEY } from '@revamp/shared-types';
import {
  LLM_CAPABILITIES_TTL_SECONDS,
  detectLlmCapabilities,
  findExecutable,
  publishLlmCapabilities,
  startLlmCapabilitiesReporter,
} from '../llm-capabilities.js';

const binDir = path.join(path.sep, 'usr', 'local', 'bin');
const claudeOnPath = path.join(binDir, 'claude');
const onlyClaude = (filePath: string) => filePath === claudeOnPath;
const nothing = () => false;

const byId = (capabilities: ReturnType<typeof detectLlmCapabilities>) =>
  Object.fromEntries(capabilities.providers.map((p) => [p.id, p]));

describe('LLM capabilities (REV-32)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('findExecutable', () => {
    it('looks a bare command up on PATH', () => {
      const pathEnv = [path.join(path.sep, 'opt'), binDir].join(path.delimiter);
      expect(findExecutable('claude', pathEnv, onlyClaude)).toBe(claudeOnPath);
      expect(findExecutable('claude', path.join(path.sep, 'opt'), onlyClaude)).toBeUndefined();
    });

    it('checks an explicit path as-is', () => {
      expect(findExecutable(claudeOnPath, '', onlyClaude)).toBe(claudeOnPath);
      expect(findExecutable(path.join(path.sep, 'nope', 'claude'), binDir, onlyClaude)).toBeUndefined();
    });

    it('finds nothing for an empty command', () => {
      expect(findExecutable('', binDir, () => true)).toBeUndefined();
    });
  });

  describe('detectLlmCapabilities', () => {
    it('marks API providers by their own key and the CLI by the binary', () => {
      const capabilities = detectLlmCapabilities({
        openaiApiKey: 'o',
        claudeCliPath: 'claude',
        nodeEnv: 'development',
        pathEnv: binDir,
        isExecutable: onlyClaude,
      });

      const providers = byId(capabilities);
      expect(providers['anthropic']).toEqual({ id: 'anthropic', available: false, reason: 'missing_api_key' });
      expect(providers['openai']).toEqual({ id: 'openai', available: true });
      expect(providers['gemini']).toEqual({ id: 'gemini', available: false, reason: 'missing_api_key' });
      expect(providers['claude-cli']).toEqual({ id: 'claude-cli', available: true });
      expect(providers['mock']).toBeUndefined();
      expect(Date.parse(capabilities.checkedAt)).not.toBeNaN();
    });

    it('reports a missing CLI binary', () => {
      const capabilities = detectLlmCapabilities({ claudeCliPath: 'claude', nodeEnv: 'development', pathEnv: binDir, isExecutable: nothing });
      expect(byId(capabilities)['claude-cli']).toEqual({ id: 'claude-cli', available: false, reason: 'cli_not_found' });
    });

    it('reports no default provider when none is configured (REV-45)', () => {
      const capabilities = detectLlmCapabilities({ claudeCliPath: 'claude', nodeEnv: 'test', isExecutable: nothing });
      expect(capabilities.defaultProvider).toBeUndefined();
      expect(capabilities.defaultModel).toBeUndefined();
      expect(capabilities.providers.every((p) => !p.available)).toBe(true);
    });

    it('reports the env-based default provider and its model', () => {
      const capabilities = detectLlmCapabilities({ geminiApiKey: 'g', claudeCliPath: 'claude', nodeEnv: 'test', isExecutable: nothing });
      expect(capabilities.defaultProvider).toBe('gemini');
      expect(capabilities.defaultModel).toBe('gemini-1.5-pro');
    });
  });

  describe('publishing', () => {
    it('stores the report under the shared key with a TTL', async () => {
      const redis = { set: vi.fn().mockResolvedValue('OK') };
      const capabilities = detectLlmCapabilities({ claudeCliPath: 'claude', nodeEnv: 'test', isExecutable: nothing });

      await publishLlmCapabilities(redis, capabilities);

      expect(redis.set).toHaveBeenCalledWith(
        LLM_CAPABILITIES_REDIS_KEY,
        JSON.stringify(capabilities),
        'EX',
        LLM_CAPABILITIES_TTL_SECONDS,
      );
    });

    it('publishes right away and on an interval until stopped, logging failures', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const redis = { set: vi.fn().mockRejectedValueOnce(new Error('Redis down')).mockResolvedValue('OK') };

      const stop = startLlmCapabilitiesReporter(redis);
      await vi.advanceTimersByTimeAsync(0);
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Redis down'));

      await vi.advanceTimersByTimeAsync(60_000);
      expect(redis.set).toHaveBeenCalledTimes(2);

      stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(redis.set).toHaveBeenCalledTimes(2);
    });
  });
});
