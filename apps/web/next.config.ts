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
  // Baseline hardening on every response. A full script-src CSP is deliberately left out:
  // it would need a nonce for the inline theme script (app/layout.tsx), and is a follow-up.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
        ],
      },
    ];
  },
};

export default config;
