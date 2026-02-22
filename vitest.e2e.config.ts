import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/e2e/setup.ts'],
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 120000,
    hookTimeout: 30000,
    // No alias for @anthropic-ai/sdk — uses the real SDK
  },
});
