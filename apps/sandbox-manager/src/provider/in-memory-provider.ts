import { LAB_DATABASE, LAB_ROLE, type SandboxId } from '../domain/sandbox.js';
import type {
  ContainerState,
  SandboxHandle,
  SandboxObservedState,
  SandboxProvider,
  SandboxSpec,
} from './provider.js';

type Operation = 'provision' | 'destroy' | 'list';

/**
 * A provider with no runtime behind it (ADR 0002), for the lifecycle and reconciliation
 * tests. Faults are injected on purpose: a provisioning that fails or hangs, a container
 * that disappears, an orphan nobody asked for.
 */
export class InMemoryProvider implements SandboxProvider {
  private readonly sandboxes = new Map<SandboxId, SandboxObservedState>();
  private readonly faults: Record<Operation, Error[]> = { provision: [], destroy: [], list: [] };
  private gate: Promise<void> | null = null;
  readonly provisioned: SandboxId[] = [];
  readonly destroyed: SandboxId[] = [];
  readonly reattached: SandboxId[] = [];

  /** Makes the next call to `operation` throw. */
  failNext(operation: Operation, error = new Error(`injected ${operation} failure`)): void {
    this.faults[operation].push(error);
  }

  /**
   * Holds every provisioning after its container exists until the returned function is
   * called — the window in which a release or a crash can land.
   */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise((resolve) => (release = resolve));
    return () => {
      this.gate = null;
      release();
    };
  }

  /** The container vanishes, as after a `docker kill` and `rm`; the network stays. */
  lose(id: SandboxId): void {
    const current = this.sandboxes.get(id);
    if (current) this.sandboxes.set(id, { ...current, container: null });
  }

  /** The container stops but stays, as after an OOM kill. */
  crash(id: SandboxId): void {
    const current = this.sandboxes.get(id);
    if (current) this.sandboxes.set(id, { ...current, container: 'exited' });
  }

  /** Something labelled as ours that no record accounts for. */
  plant(state: SandboxObservedState): void {
    this.sandboxes.set(state.id, state);
  }

  has(id: SandboxId): boolean {
    return this.sandboxes.has(id);
  }

  async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    this.throwIfFaulted('provision');
    this.sandboxes.set(spec.id, {
      id: spec.id,
      container: 'running',
      network: true,
      expiresAt: spec.expiresAt,
    });
    this.provisioned.push(spec.id);
    await this.gate;
    return {
      id: spec.id,
      connection: {
        host: `memory-${spec.id}`,
        port: 5432,
        database: LAB_DATABASE,
        user: LAB_ROLE,
        password: spec.labPassword,
      },
    };
  }

  async destroy(id: SandboxId): Promise<void> {
    this.throwIfFaulted('destroy');
    this.sandboxes.delete(id);
    this.destroyed.push(id);
  }

  async inspect(id: SandboxId): Promise<SandboxObservedState | null> {
    return this.sandboxes.get(id) ?? null;
  }

  async list(): Promise<SandboxObservedState[]> {
    this.throwIfFaulted('list');
    return [...this.sandboxes.values()];
  }

  async reattach(id: SandboxId): Promise<void> {
    if (this.sandboxes.has(id)) this.reattached.push(id);
  }

  /** Current container state, for assertions. */
  containerOf(id: SandboxId): ContainerState | null | undefined {
    return this.sandboxes.get(id)?.container;
  }

  private throwIfFaulted(operation: Operation): void {
    const fault = this.faults[operation].shift();
    if (fault) throw fault;
  }
}
