import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const valid = {
  SANDBOX_MANAGER_TOKEN: 'x'.repeat(32),
  STATE_DATABASE_URL: 'postgres://u:p@localhost:5432/sqlscope_sandboxes',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4100,
      DOCKER_HOST: 'http://docker-socket-proxy:2375',
      MANAGER_INSTANCE: 'sqlscope',
      MAX_ACTIVE_SANDBOXES: 4,
      SANDBOX_ATTACH_CONTAINERS: [],
    });
  });

  it('refuses to start without the token and the state database', () => {
    expect(() => loadConfig({})).toThrow(/SANDBOX_MANAGER_TOKEN[\s\S]*STATE_DATABASE_URL/);
  });

  it('refuses a short token', () => {
    expect(() => loadConfig({ ...valid, SANDBOX_MANAGER_TOKEN: 'short' })).toThrow(
      /SANDBOX_MANAGER_TOKEN/,
    );
  });

  it('refuses a known token in production only', () => {
    const token = 'dev-only-sandbox-manager-token-change-me';
    expect(() =>
      loadConfig({ ...valid, NODE_ENV: 'production', SANDBOX_MANAGER_TOKEN: token }),
    ).toThrow(/SANDBOX_MANAGER_TOKEN/);
    expect(loadConfig({ ...valid, SANDBOX_MANAGER_TOKEN: token }).SANDBOX_MANAGER_TOKEN).toBe(
      token,
    );
  });

  it('caps the global limit at what the Docker address pool holds', () => {
    expect(loadConfig({ ...valid, MAX_ACTIVE_SANDBOXES: '20' }).MAX_ACTIVE_SANDBOXES).toBe(20);
    expect(() => loadConfig({ ...valid, MAX_ACTIVE_SANDBOXES: '21' })).toThrow(
      /MAX_ACTIVE_SANDBOXES/,
    );
  });

  it('keeps the disk quota below the memory limit', () => {
    expect(() => loadConfig({ ...valid, T2_DISK_MB: '384' })).toThrow(/T2_DISK_MB/);
  });

  it('splits the containers to attach', () => {
    expect(
      loadConfig({ ...valid, SANDBOX_ATTACH_CONTAINERS: 'sqlscope-api-1, other ,' })
        .SANDBOX_ATTACH_CONTAINERS,
    ).toEqual(['sqlscope-api-1', 'other']);
    expect(() => loadConfig({ ...valid, SANDBOX_ATTACH_CONTAINERS: 'bad name' })).toThrow(
      /SANDBOX_ATTACH_CONTAINERS/,
    );
  });

  it('only accepts label-safe instance names', () => {
    expect(() => loadConfig({ ...valid, MANAGER_INSTANCE: 'Prod_1' })).toThrow(/MANAGER_INSTANCE/);
  });
});
