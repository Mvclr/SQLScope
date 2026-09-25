import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { isSandboxId, type SandboxId } from '../../domain/sandbox.js';
import type {
  ContainerState,
  SandboxHandle,
  SandboxObservedState,
  SandboxProvider,
  SandboxSpec,
} from '../provider.js';
import {
  containerSpec,
  LAB_DATABASE,
  LAB_ROLE,
  LABELS,
  labelsFor,
  resourceName,
  SANDBOX_PORT,
  type ContainerLimits,
} from './container-spec.js';
import type { DockerClient } from './docker-client.js';

const HEALTH_POLL_MS = 250;

const CONTAINER_STATES: readonly ContainerState[] = [
  'created',
  'running',
  'restarting',
  'paused',
  'exited',
  'dead',
];

export interface DockerProviderOptions {
  readonly limits: ContainerLimits;
  /** Containers joined to every sandbox network (SANDBOX_ATTACH_CONTAINERS). */
  readonly attach: readonly string[];
  readonly provisionTimeoutMs: number;
}

/**
 * T2 sandboxes as Docker containers (ADR 0002): one PostgreSQL container per sandbox, on
 * an internal network of its own, so a sandbox reaches neither the internet, nor another
 * sandbox, nor the T1 cluster. Every step is safe to repeat, so a provisioning retried
 * after a crash picks up what the first attempt left.
 */
export class DockerProvider implements SandboxProvider {
  constructor(
    private readonly docker: DockerClient,
    private readonly options: DockerProviderOptions,
  ) {}

  async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    const deadline = Date.now() + this.options.provisionTimeoutMs;
    const name = resourceName(spec.id);

    await this.docker.createNetwork(name, labelsFor(spec.id, spec.expiresAt, this.options.limits));
    // Random and never kept: the manager has no use for the superuser once the init
    // scripts have run, so nothing can leak it later.
    const superuserPassword = randomBytes(24).toString('hex');
    await this.docker.createContainer(
      name,
      containerSpec(spec, this.options.limits, superuserPassword),
    );
    for (const container of this.options.attach) {
      await this.docker.connectNetwork(name, container);
    }
    await this.docker.startContainer(name);
    await this.waitHealthy(name, deadline);

    return {
      id: spec.id,
      connection: {
        host: name,
        port: SANDBOX_PORT,
        database: LAB_DATABASE,
        user: LAB_ROLE,
        password: spec.labPassword,
      },
    };
  }

  async destroy(id: SandboxId): Promise<void> {
    const name = resourceName(id);
    await this.docker.removeContainer(name);
    // A network with endpoints cannot be removed: detach whatever SANDBOX_ATTACH_CONTAINERS
    // joined to it first.
    const network = await this.docker.inspectNetwork(name);
    if (network === null) return;
    for (const endpoint of Object.values(network.Containers ?? {})) {
      await this.docker.disconnectNetwork(name, endpoint.Name);
    }
    await this.docker.removeNetwork(name);
  }

  async inspect(id: SandboxId): Promise<SandboxObservedState | null> {
    const name = resourceName(id);
    const [container, network] = await Promise.all([
      this.docker.inspectContainer(name),
      this.docker.inspectNetwork(name),
    ]);
    const ours = (labels: Readonly<Record<string, string>> | undefined) =>
      labels?.[LABELS.managedBy] === this.options.limits.instance;
    const containerLabels = ours(container?.Config.Labels) ? container!.Config.Labels : null;
    const networkLabels = ours(network?.Labels) ? network!.Labels : null;
    if (containerLabels === null && networkLabels === null) return null;

    return {
      id,
      container: containerLabels ? containerState(container!.State.Status) : null,
      network: networkLabels !== null,
      expiresAt: parseDate((containerLabels ?? networkLabels)?.[LABELS.expiresAt]),
    };
  }

  /** Everything this manager instance owns, grouped by sandbox. */
  async list(): Promise<SandboxObservedState[]> {
    const owner = [`${LABELS.managedBy}=${this.options.limits.instance}`];
    const [containers, networks] = await Promise.all([
      this.docker.listContainers(owner),
      this.docker.listNetworks(owner),
    ]);

    const byId = new Map<SandboxId, SandboxObservedState>();
    const entry = (id: SandboxId) =>
      byId.get(id) ?? { id, container: null, network: false, expiresAt: null };

    for (const container of containers) {
      const id = container.Labels[LABELS.sandboxId];
      if (id === undefined || !isSandboxId(id)) continue;
      byId.set(id, {
        ...entry(id),
        container: containerState(container.State),
        expiresAt: parseDate(container.Labels[LABELS.expiresAt]),
      });
    }
    for (const network of networks) {
      const id = network.Labels[LABELS.sandboxId];
      if (id === undefined || !isSandboxId(id)) continue;
      const current = entry(id);
      byId.set(id, {
        ...current,
        network: true,
        expiresAt: current.expiresAt ?? parseDate(network.Labels[LABELS.expiresAt]),
      });
    }
    return [...byId.values()];
  }

  /** Waits for the healthcheck, which passes only after the seed has run. */
  private async waitHealthy(name: string, deadline: number): Promise<void> {
    for (;;) {
      const info = await this.docker.inspectContainer(name);
      if (info === null) throw new Error(`container ${name} vanished while starting`);
      if (info.State.Health?.Status === 'healthy') return;
      if (info.State.Status === 'exited' || info.State.Status === 'dead') {
        throw new Error(`container ${name} exited with code ${info.State.ExitCode} while starting`);
      }
      if (Date.now() >= deadline) throw new Error(`container ${name} not healthy in time`);
      await sleep(HEALTH_POLL_MS);
    }
  }
}

function containerState(state: string): ContainerState {
  // `removing` is on its way out: as good as exited.
  if (state === 'removing') return 'exited';
  return CONTAINER_STATES.includes(state as ContainerState) ? (state as ContainerState) : 'dead';
}

function parseDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
