import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Service-to-service Bearer token (ADR 0002). Both sides are hashed first so the
 * comparison is constant-time whatever the length of what the client sent.
 */
export function bearerAuth(token: string) {
  const expected = createHash('sha256').update(token).digest();
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
    const given = createHash('sha256')
      .update(match?.[1] ?? '')
      .digest();
    if (match && timingSafeEqual(given, expected)) return;
    await reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'unauthorized' });
  };
}
