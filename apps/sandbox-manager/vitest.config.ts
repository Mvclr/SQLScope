import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.integration.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // Every suite drives the same Docker daemon; running them one at a time keeps
          // the global sandbox limits and timings predictable.
          fileParallelism: false,
        },
      },
    ],
  },
});
