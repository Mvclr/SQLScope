import { NextResponse, type NextRequest } from 'next/server';

/**
 * The API derives its per-client rate-limit identity from `X-Forwarded-For`, trusting the
 * one proxy hop in front of it (this web server). A browser could set that header itself,
 * and the rewrite would forward it untouched — letting a caller rotate identities and dodge
 * every per-client quota, including login throttling.
 *
 * Strip the client-supplied forwarding headers before the request is proxied to `/api`, so
 * the address the API sees is the one the web server observed, not one the caller claimed.
 * With this, the API's single trusted hop (this server) forwards a trustworthy value again.
 *
 * This assumes the browser reaches this server directly, as the bundled compose serves it.
 * A deployment that puts a reverse proxy in front of the web tier must instead let that
 * proxy set `X-Forwarded-For` and stop stripping it here (and count it in the API's
 * TRUST_PROXY), otherwise every client would collapse into the proxy's own address.
 */
const CLIENT_FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded'];

export function middleware(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  for (const name of CLIENT_FORWARDING_HEADERS) headers.delete(name);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/api/:path*' };
