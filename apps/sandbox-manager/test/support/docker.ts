import { randomBytes } from 'node:crypto';
import {
  GenericContainer,
  getContainerRuntimeClient,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { DockerClient } from '../../src/provider/docker/docker-client.js';
import { DockerProvider } from '../../src/provider/docker/docker-provider.js';
import type { ContainerLimits } from '../../src/provider/docker/container-spec.js';

/** Same image and allowlist as the `docker-socket-proxy` service in compose.yaml. */
export const SOCKET_PROXY_IMAGE = 'tecnativa/docker-socket-proxy:v0.5.0';
export const SOCKET_PROXY_ENV = {
  CONTAINERS: '1',
  NETWORKS: '1',
  POST: '1',
  ALLOW_START: '1',
  EVENTS: '0',
};

export const T2_IMAGE = 'postgres:18-alpine';

export async function startSocketProxy(): Promise<StartedTestContainer> {
  return new GenericContainer(SOCKET_PROXY_IMAGE)
    .withEnvironment(SOCKET_PROXY_ENV)
    .withBindMounts([
      { source: '/var/run/docker.sock', target: '/var/run/docker.sock', mode: 'ro' },
    ])
    .withExposedPorts(2375)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}

export function proxyUrl(proxy: StartedTestContainer): string {
  return `http://${proxy.getHost()}:${proxy.getMappedPort(2375)}`;
}

/**
 * A label value no other suite uses. Ryuk does not know the containers the manager
 * creates through the proxy, so each suite reaps its own by this label when it ends.
 */
export function randomInstance(): string {
  return `test-${randomBytes(4).toString('hex')}`;
}

export function testLimits(instance: string): ContainerLimits {
  return { instance, image: T2_IMAGE, memoryMb: 256, diskMb: 64, cpus: 0.5, pids: 128 };
}

export function dockerProvider(
  proxy: StartedTestContainer,
  instance: string,
  options: { attach?: string[]; provisionTimeoutMs?: number } = {},
): DockerProvider {
  return new DockerProvider(new DockerClient(proxyUrl(proxy)), {
    limits: testLimits(instance),
    attach: options.attach ?? [],
    provisionTimeoutMs: options.provisionTimeoutMs ?? 60_000,
  });
}

/** Destroys everything labelled with `instance`. */
export async function reap(provider: DockerProvider): Promise<void> {
  for (const sandbox of await provider.list()) await provider.destroy(sandbox.id);
}

/**
 * A container on no sandbox network by default, with `psql` in it, to connect to
 * sandboxes the way the API will.
 */
export async function startProbe(): Promise<StartedTestContainer & { readonly name: string }> {
  const probe = await new GenericContainer(T2_IMAGE).withCommand(['sleep', 'infinity']).start();
  return Object.assign(probe, { name: probe.getName().replace(/^\//, '') });
}

export async function psql(
  probe: StartedTestContainer,
  url: string,
  sql: string,
): Promise<{ exitCode: number; output: string }> {
  const result = await probe.exec(['psql', url, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    env: { PGCONNECT_TIMEOUT: '3' },
  });
  return { exitCode: result.exitCode, output: result.output.trim() };
}

/** Straight to the daemon, around the proxy: what an operator — or chaos — would do. */
export async function killContainer(name: string): Promise<void> {
  const client = await getContainerRuntimeClient();
  await client.container.getById(name).kill();
}
