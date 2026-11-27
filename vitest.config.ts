import { defineConfig } from 'vitest/config';
import path from 'path';
import { BROWSER_SPECS } from './vitest.browser-specs';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // Keep tests off the operator's local LLM provider (e.g. claude-cli in .env); dotenv won't override it.
    // The design critique picks the CLI whenever the binary is found, so tests point it nowhere (REV-51).
    env: { JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef', MVP_LLM_PROVIDER: '', VISION_LLM_PROVIDER: '', CLAUDE_CLI_PATH: '/nonexistent/claude-disabled-in-tests' },
    alias: {
      '@revamp/shared-types': path.resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@revamp/validation': path.resolve(__dirname, 'packages/validation/src/index.ts'),
      '@revamp/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
    },
    projects: [
      // Unit tests: Vitest's default timeouts and file parallelism
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.spec.ts', '**/*.test.ts'],
          // Nested git worktrees (.claude/worktrees) hold whole copies of the repo: their tests are not this tree's tests
          exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', ...BROWSER_SPECS],
          sequence: { groupOrder: 0 },
        },
      },
      // Real-Chromium specs (REV-230): run after the unit group, one file at a time, with timeouts sized for a browser launch
      {
        extends: true,
        test: {
          name: 'browser',
          include: [...BROWSER_SPECS],
          exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
