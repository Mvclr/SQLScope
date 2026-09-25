import { describe, expect, it } from 'vitest';
import { newSandboxId } from '../src/domain/sandbox.js';
import {
  containerSpec,
  initSql,
  resourceName,
  type ContainerLimits,
} from '../src/provider/docker/container-spec.js';

const limits: ContainerLimits = {
  instance: 'test',
  image: 'postgres:18-alpine',
  memoryMb: 384,
  diskMb: 128,
  cpus: 0.5,
  pids: 128,
};
const id = newSandboxId();
const expiresAt = new Date('2026-09-25T12:30:00Z');
const spec = containerSpec(
  { id, seed: 'create table t (id int);', labPassword: 'ab'.repeat(12), expiresAt },
  limits,
  'cd'.repeat(12),
);
const host = spec.HostConfig as Record<string, unknown>;

describe('containerSpec', () => {
  it('grants nothing privileged', () => {
    expect(host.Privileged).toBe(false);
    expect(host.CapDrop).toEqual(['ALL']);
    expect(host.CapAdd).toBeUndefined();
    expect(host.SecurityOpt).toEqual(['no-new-privileges:true']);
    expect(host.ReadonlyRootfs).toBe(true);
    expect(spec.User).toBe('70:70');
  });

  it('shares nothing with the host', () => {
    expect(host.Binds).toBeUndefined();
    expect(host.Mounts).toBeUndefined();
    expect(host.Devices).toBeUndefined();
    expect(host.PortBindings).toBeUndefined();
    expect(host.PublishAllPorts).toBeUndefined();
    expect(host.PidMode).toBeUndefined();
    expect(host.IpcMode).toBeUndefined();
    expect(host.UsernsMode).toBeUndefined();
    // Only its own network, never the host's.
    expect(host.NetworkMode).toBe(resourceName(id));
    expect(
      Object.keys((spec.NetworkingConfig as { EndpointsConfig: object }).EndpointsConfig),
    ).toEqual([resourceName(id)]);
  });

  it('applies the limits', () => {
    expect(host.Memory).toBe(384 * 1024 * 1024);
    expect(host.MemorySwap).toBe(host.Memory);
    expect(host.NanoCpus).toBe(500_000_000);
    expect(host.PidsLimit).toBe(128);
    const tmpfs = host.Tmpfs as Record<string, string>;
    expect(tmpfs['/var/lib/postgresql']).toMatch(/size=128m/);
    for (const options of Object.values(tmpfs)) expect(options).toMatch(/nosuid,nodev,noexec/);
    expect(spec.Cmd).toContain('temp_file_limit=64MB');
    expect(spec.Cmd).toContain('max_connections=20');
  });

  it('labels the container for reconciliation', () => {
    expect(spec.Labels).toEqual({
      'sqlscope.managed-by': 'test',
      'sqlscope.sandbox-id': id,
      'sqlscope.expires-at': '2026-09-25T12:30:00.000Z',
    });
  });

  it('names container and network after the sandbox', () => {
    expect(resourceName('t2_0123456789abcdef01234567')).toBe(
      'sqlscope-t2-0123456789abcdef01234567',
    );
  });
});

describe('initSql', () => {
  it('creates an unprivileged lab role', () => {
    expect(initSql('ab'.repeat(12))).toMatch(
      /create role lab login nosuperuser nocreaterole nocreatedb connection limit \d+/,
    );
  });

  it('refuses a password that could break out of the literal', () => {
    expect(() => initSql("x'; alter role lab superuser; --")).toThrow(/hex/);
  });
});
