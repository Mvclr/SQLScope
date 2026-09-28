import { randomBytes } from 'node:crypto';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newSandboxId } from '../src/domain/sandbox.js';
import { DockerClient } from '../src/provider/docker/docker-client.js';
import type { DockerProvider } from '../src/provider/docker/docker-provider.js';
import type { SandboxHandle } from '../src/provider/provider.js';
import {
  dockerProvider,
  proxyUrl,
  psql,
  randomInstance,
  reap,
  startProbe,
  startSocketProxy,
} from './support/docker.js';

let proxy: StartedTestContainer;
let attached: Awaited<ReturnType<typeof startProbe>>;
let outsider: Awaited<ReturnType<typeof startProbe>>;
let docker: DockerClient;
let provider: DockerProvider;
let handle: SandboxHandle;
const instance = randomInstance();

function url(h: SandboxHandle, user = h.connection.user, password = h.connection.password) {
  const { host, port, database } = h.connection;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

beforeAll(async () => {
  [proxy, attached, outsider] = await Promise.all([startSocketProxy(), startProbe(), startProbe()]);
  docker = new DockerClient(proxyUrl(proxy));
  provider = dockerProvider(proxy, instance, { attach: [attached.name] });
  handle = await provider.provision({
    id: newSandboxId(),
    seed: `create table seeded (id int); insert into seeded values (42); grant select on seeded to lab;`,
    labPassword: randomBytes(16).toString('hex'),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
});

afterAll(async () => {
  if (provider) await reap(provider);
  await Promise.all([proxy?.stop(), attached?.stop(), outsider?.stop()]);
});

describe('DockerProvider', () => {
  it('runs the sandbox with the limits of the spec', async () => {
    const info = await docker.inspectContainer(handle.connection.host);
    expect(info?.State.Health?.Status).toBe('healthy');
    expect(info?.HostConfig).toMatchObject({
      Memory: 256 * 1024 * 1024,
      MemorySwap: 256 * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 128,
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      Privileged: false,
    });
    const network = await docker.inspectNetwork(handle.connection.host);
    expect(network?.Internal).toBe(true);
  });

  it('lets an attached container in as the unprivileged lab role', async () => {
    const result = await psql(
      attached,
      url(handle),
      `select rolsuper::text || ',' || rolcreaterole::text || ',' || rolcreatedb::text
         || ',' || (select id from seeded)
         from pg_roles where rolname = current_user`,
    );
    expect(result).toEqual({ exitCode: 0, output: 'false,false,false,42' });
  });

  it('denies running programs on the server', async () => {
    const result = await psql(attached, url(handle), `copy (select 1) to program 'id'`);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/permission denied|must be superuser|pg_execute_server_program/i);
  });

  it('does not let the superuser in over the network', async () => {
    const result = await psql(attached, url(handle, 'postgres', 'postgres'), 'select 1');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/password authentication failed/);
  });

  it('is unreachable from a container that is not attached', async () => {
    const result = await psql(outsider, url(handle), 'select 1');
    expect(result.exitCode).not.toBe(0);
  });

  it('lists and inspects only its own sandboxes', async () => {
    expect(await provider.list()).toEqual([
      {
        id: handle.id,
        container: 'running',
        network: true,
        expiresAt: expect.any(Date),
      },
    ]);
    expect(await provider.inspect(handle.id)).toMatchObject({ container: 'running' });
    const stranger = dockerProvider(proxy, randomInstance());
    expect(await stranger.list()).toEqual([]);
    expect(await stranger.inspect(handle.id)).toBeNull();
  });

  it('refuses what the proxy does not allow', async () => {
    const response = await fetch(`${proxyUrl(proxy)}/v1.44/images/json`);
    expect(response.status).toBe(403);
  });

  it('reattaches a client that left the sandbox network', async () => {
    // What a deploy does to the API: a new container, on none of the sandbox networks.
    await docker.disconnectNetwork(handle.connection.host, attached.name);
    expect((await psql(attached, url(handle), 'select 1')).exitCode).not.toBe(0);

    await provider.reattach(handle.id);
    expect(await psql(attached, url(handle), 'select 1')).toEqual({ exitCode: 0, output: '1' });
    // Already there: nothing to do, and no error.
    await provider.reattach(handle.id);
  });

  it('skips a client that does not exist right now', async () => {
    const missing = dockerProvider(proxy, instance, { attach: ['sqlscope-no-such-container'] });
    await expect(missing.reattach(handle.id)).resolves.toBeUndefined();
  });

  it('destroys idempotently, detaching attached containers', async () => {
    await provider.destroy(handle.id);
    await provider.destroy(handle.id);
    expect(await provider.inspect(handle.id)).toBeNull();
    expect(await docker.inspectNetwork(handle.connection.host)).toBeNull();
    // The attached container survives the teardown of the network it was joined to.
    expect((await attached.exec(['true'])).exitCode).toBe(0);
  });
});
