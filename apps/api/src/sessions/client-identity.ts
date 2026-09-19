import { createHmac } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const CLIENT_HASH = Symbol('CLIENT_HASH');

type WithClientHash = Request & { [CLIENT_HASH]?: string };

/**
 * Identifies a client for quotas without storing its address: an HMAC of the address
 * under the server secret. `req.ip` honours `trust proxy`, so behind the web proxy it is
 * the browser's address, not the proxy's.
 */
export function clientIdentity(secret: string) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const address = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    (request as WithClientHash)[CLIENT_HASH] = createHmac('sha256', secret)
      .update(address)
      .digest('hex')
      .slice(0, 32);
    next();
  };
}

export function clientHashOf(request: Request): string {
  const hash = (request as WithClientHash)[CLIENT_HASH];
  if (!hash) throw new Error('clientIdentity middleware is not installed');
  return hash;
}
