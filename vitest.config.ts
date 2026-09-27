import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Keep tests off the operator's local LLM provider (e.g. claude-cli in .env); dotenv won't override it.
    // The design critique picks the CLI whenever the binary is found, so tests point it nowhere (REV-51).
    env: { MVP_LLM_PROVIDER: '', VISION_LLM_PROVIDER: '', CLAUDE_CLI_PATH: '/nonexistent/claude-disabled-in-tests' },
    alias: {
      '@revamp/shared-types': path.resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@revamp/validation': path.resolve(__dirname, 'packages/validation/src/index.ts'),
    },
  },
});
