import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { HealthCheck } from '../src/http/health.js';

const config = loadConfig({
  NODE_ENV: 'test',
  SANDBOX_MANAGER_TOKEN: 'x'.repeat(32),
  STATE_DATABASE_URL: 'postgres://u:p@localhost:5432/db',
});

/** The routes under test never reach the store or the scheduler. */
function app(checks: HealthCheck[] = []) {
  return buildApp({ config, checks, store: {} as never, scheduler: {} as never });
}

describe('health', () => {
  it('answers liveness without touching dependencies', async () => {
    const response = await app([
      { name: 'broken', check: () => Promise.reject(new Error('down')) },
    ]).inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('reports 503 while a dependency is down', async () => {
    const response = await app([
      { name: 'ok', check: () => Promise.resolve() },
      { name: 'broken', check: () => Promise.reject(new Error('down')) },
    ]).inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'unavailable',
      checks: { ok: { status: 'up' }, broken: { status: 'down', error: 'down' } },
    });
  });
});

describe('service token', () => {
  it.each([
    ['no header', {}],
    ['a wrong token', { authorization: `Bearer ${'y'.repeat(32)}` }],
    ['a token prefix', { authorization: `Bearer ${'x'.repeat(31)}` }],
    ['another scheme', { authorization: `Basic ${'x'.repeat(32)}` }],
  ])('rejects %s', async (_, headers) => {
    for (const [method, url] of [
      ['POST', '/sandboxes'],
      ['GET', '/sandboxes/t2_0123456789abcdef01234567'],
      ['DELETE', '/sandboxes/t2_0123456789abcdef01234567'],
    ] as const) {
      const response = await app().inject({ method, url, headers });
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    }
  });
});
