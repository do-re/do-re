import { defineConfig } from 'vitest/config';

// Coverage targets: docs/project/testing.md (OPEN-12). `npm test` fails below them.
// src/lambda.ts is the composition root (environment variables + AWS clients); it has no
// logic of its own and is exercised by the deployed smoke test instead.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/lambda.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'html'],
      thresholds: { branches: 85, lines: 90, functions: 100 },
    },
  },
});
