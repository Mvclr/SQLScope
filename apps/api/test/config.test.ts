import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const valid = {
  CONTROL_DATABASE_URL: 'postgres://u:p@localhost:5432/control',
  SANDBOX_DATABASE_URL: 'postgres://u:p@localhost:5433/postgres',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces the port', () => {
    expect(loadConfig({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('refuses to start without the connection strings', () => {
    expect(() => loadConfig({})).toThrow(/CONTROL_DATABASE_URL/);
  });

  it('rejects malformed URLs', () => {
    expect(() => loadConfig({ ...valid, REDIS_URL: 'not a url' })).toThrow(/REDIS_URL/);
  });
});
