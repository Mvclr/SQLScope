import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const valid = {
  CONTROL_DATABASE_URL: 'postgres://u:p@localhost:5432/control',
  SANDBOX_DATABASE_URL: 'postgres://u:p@localhost:5433/postgres',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(32),
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

  it('refuses a short session secret', () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('refuses a known default secret in production', () => {
    const secret = 'dev-only-session-secret-change-me-0123456789';
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', SESSION_SECRET: secret })).toThrow(
      /SESSION_SECRET/,
    );
    // The same secret is fine outside production, where the stack is not exposed.
    expect(loadConfig({ ...valid, SESSION_SECRET: secret }).SESSION_SECRET).toBe(secret);
  });

  it('rejects malformed URLs', () => {
    expect(() => loadConfig({ ...valid, REDIS_URL: 'not a url' })).toThrow(/REDIS_URL/);
  });

  it('marks cookies Secure by default in production', () => {
    const secret = 'x'.repeat(40);
    expect(
      loadConfig({ ...valid, SESSION_SECRET: secret, NODE_ENV: 'production' }).COOKIE_SECURE,
    ).toBe(true);
    // Development keeps them off, and an explicit value wins in either environment.
    expect(loadConfig(valid).COOKIE_SECURE).toBe(false);
    expect(
      loadConfig({
        ...valid,
        SESSION_SECRET: secret,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }).COOKIE_SECURE,
    ).toBe(false);
  });
});
