import type { SandboxId } from '../domain/sandbox.js';

/** What a sandbox is built from. Everything else comes from the manager's config. */
export interface SandboxSpec {
  readonly id: SandboxId;
  /** SQL run as superuser in the `lab` database while the cluster initializes. */
  readonly seed: string;
  /** Password of the `lab` role. Hex only, so it is safe inside a SQL literal. */
  readonly labPassword: string;
  /** Hard deadline, written on the container so it can be enforced without the database. */
  readonly expiresAt: Date;
}

/** How a client reaches a ready sandbox, from a container attached to its network. */
export interface SandboxConnection {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

export interface SandboxHandle {
  readonly id: SandboxId;
  readonly connection: SandboxConnection;
}

/**
 * State of a container as the runtime reports it. `running` covers a container whose
 * healthcheck has not passed yet; `exited` and `dead` mean the database is gone.
 */
export type ContainerState = 'created' | 'running' | 'restarting' | 'paused' | 'exited' | 'dead';

/** What exists on the runtime for one sandbox, found through the ownership labels. */
export interface SandboxObservedState {
  readonly id: SandboxId;
  /** `null` when only the network is left. */
  readonly container: ContainerState | null;
  readonly network: boolean;
  /** From the `sqlscope.expires-at` label; `null` if missing or unreadable. */
  readonly expiresAt: Date | null;
}

/** The port of ADR 0002, plus one optional capability (ADR 0010). */
export interface SandboxProvider {
  provision(spec: SandboxSpec): Promise<SandboxHandle>;
  /** Idempotent: destroying what is already gone succeeds. */
  destroy(id: SandboxId): Promise<void>;
  inspect(id: SandboxId): Promise<SandboxObservedState | null>;
  list(): Promise<SandboxObservedState[]>;
  /**
   * Gives a live sandbox back the clients that should reach it but no longer do — the API
   * container, after a deploy recreated it. Idempotent; a provider without the notion of
   * attached clients leaves it out.
   */
  reattach?(id: SandboxId): Promise<void>;
}
