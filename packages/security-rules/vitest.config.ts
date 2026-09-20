import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests run a real PostgreSQL (PGlite in WebAssembly). Booting and querying it
    // takes well over the default 5 s when the machine is also building something else.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
