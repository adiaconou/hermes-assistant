import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    // Mock external modules
    alias: {
      '@anthropic-ai/sdk': './tests/mocks/anthropic.ts',
    },
  },
});
