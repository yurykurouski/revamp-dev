import { describe, it, expect } from 'vitest';
import { env } from '../env.js';

describe('test environment isolation (REV-30)', () => {
  it('does not pick up the local MVP_LLM_PROVIDER from .env', () => {
    // Otherwise any test that builds MvpContentService without a provider would call the real CLI
    expect(env.MVP_LLM_PROVIDER).toBeUndefined();
  });
});
