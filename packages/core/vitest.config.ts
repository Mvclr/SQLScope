import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.integration.test.ts'],
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.integration.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
