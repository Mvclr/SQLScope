import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { HEALTH_CHECKS, type HealthCheck } from '../src/health/health-check.js';
import { HealthController } from '../src/health/health.controller.js';

const up = (name: string): HealthCheck => ({ name, check: async () => {} });
const down = (name: string): HealthCheck => ({
  name,
  check: async () => {
    throw new Error('connection refused');
  },
});
const hanging = (name: string): HealthCheck => ({ name, check: () => new Promise(() => {}) });

describe('HealthController', () => {
  let app: INestApplication | undefined;

  const start = async (checks: HealthCheck[]) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HEALTH_CHECKS, useValue: checks }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    return request(app.getHttpServer());
  };

  afterEach(async () => {
    await app?.close();
  });

  it('reports liveness without touching dependencies', async () => {
    const api = await start([down('controlDatabase')]);

    await api.get('/health').expect(200, { status: 'ok' });
  });

  it('is ready when every dependency answers', async () => {
    const api = await start([up('controlDatabase'), up('redis')]);

    const res = await api.get('/health/ready').expect(200);

    expect(res.body).toMatchObject({
      status: 'ready',
      checks: { controlDatabase: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('answers 503 and names the failing dependency', async () => {
    const api = await start([up('controlDatabase'), down('redis')]);

    const res = await api.get('/health/ready').expect(503);

    expect(res.body).toMatchObject({
      status: 'unavailable',
      checks: {
        controlDatabase: { status: 'up' },
        redis: { status: 'down', error: 'connection refused' },
      },
    });
  });

  it('does not hang on a dependency that never answers', async () => {
    const api = await start([hanging('sandboxCluster')]);

    const res = await api.get('/health/ready').expect(503);

    expect(res.body.checks.sandboxCluster).toMatchObject({
      status: 'down',
      error: 'timed out after 2000 ms',
    });
  }, 10_000);
});
