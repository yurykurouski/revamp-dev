import { describe, it, expect } from 'vitest';
import { env } from '../env.js';
import { DesignCritiqueService } from '../../services/design-critique.service.js';

describe('test environment isolation (REV-30)', () => {
  it('does not pick up the local MVP_LLM_PROVIDER from .env', () => {
    // Otherwise any test that builds MvpContentService without a provider would call the real CLI
    expect(env.MVP_LLM_PROVIDER).toBeUndefined();
  });

  it('does not let the design critique find the real Claude CLI (REV-51)', () => {
    expect(env.VISION_LLM_PROVIDER).toBeUndefined();
    const service = new DesignCritiqueService({ anthropicApiKey: '', openaiApiKey: '' });
    expect(service.provider).toBeUndefined();
  });
});
