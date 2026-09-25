import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({
  NODE_ENV: 'test',
  SANDBOX_MANAGER_TOKEN: 'x'.repeat(32),
  STATE_DATABASE_URL: 'postgres://u:p@localhost:5432/db',
});

describe('health', () => {
  it('answers liveness without touching dependencies', async () => {
    const app = buildApp({
      config,
      checks: [{ name: 'broken', check: () => Promise.reject(new Error('down')) }],
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('reports 503 while a dependency is down', async () => {
    const app = buildApp({
      config,
      checks: [
        { name: 'ok', check: () => Promise.resolve() },
        { name: 'broken', check: () => Promise.reject(new Error('down')) },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'unavailable',
      checks: { ok: { status: 'up' }, broken: { status: 'down', error: 'down' } },
    });
  });
});
