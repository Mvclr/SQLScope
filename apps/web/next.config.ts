import path from 'node:path';
import type { NextConfig } from 'next';

/** Where the web server reaches the API. Baked in at build time (rewrites are compiled). */
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  experimental: {
    // Scope hoisting (production only) drops members of PGlite's esbuild-style namespace
    // exports, breaking it with "instantiateWasm is not a function" only in built bundles.
    turbopackScopeHoisting: false,
  },
  // The browser talks to /api on the web origin: no CORS, and the session cookie stays
  // first-party. The API trusts this one proxy hop for the client address.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default config;
