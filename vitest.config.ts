import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    alias: {
      '@revamp/shared-types': path.resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@revamp/validation': path.resolve(__dirname, 'packages/validation/src/index.ts'),
    },
  },
});
