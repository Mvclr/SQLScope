import { randomBytes } from 'node:crypto';

/**
 * Life of a T2 sandbox (ADR 0002). Every status but the last two holds, or is about to
 * hold, a container; DESTROYED and FAILED are terminal.
 */
export const SANDBOX_STATUSES = [
  'PENDING',
  'PROVISIONING',
  'READY',
  'ACTIVE',
  'EXPIRING',
  'DESTROYING',
  'DESTROYED',
  'FAILED',
] as const;

export type SandboxStatus = (typeof SANDBOX_STATUSES)[number];

export const TERMINAL_STATUSES: readonly SandboxStatus[] = ['DESTROYED', 'FAILED'];

/**
 * Statuses that take a slot of MAX_ACTIVE_SANDBOXES. A sandbox being torn down still
 * holds its container, its network and its memory until the teardown finishes.
 */
export const SLOT_STATUSES: readonly SandboxStatus[] = [
  'PROVISIONING',
  'READY',
  'ACTIVE',
  'EXPIRING',
  'DESTROYING',
];

export function isTerminal(status: SandboxStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** `t2_` and 24 hex characters: opaque, unguessable, and safe in names and labels. */
export type SandboxId = string;

const SANDBOX_ID = /^t2_[0-9a-f]{24}$/;

export function newSandboxId(): SandboxId {
  return `t2_${randomBytes(12).toString('hex')}`;
}

export function isSandboxId(value: string): value is SandboxId {
  return SANDBOX_ID.test(value);
}

/** Why a sandbox left PROVISIONING, READY or ACTIVE for teardown. */
export type EndReason = 'released' | 'unclaimed' | 'idle' | 'max-lifetime';

/** Why a sandbox ended in FAILED. */
export type FailureReason = 'provision-failed' | 'container-lost' | 'stuck' | 'destroy-failed';

export interface SandboxRecord {
  readonly id: SandboxId;
  /** Caller-chosen key that makes `POST /sandboxes` idempotent. */
  readonly requestId: string;
  readonly status: SandboxStatus;
  /** SQL run as superuser when the cluster is created. Cleared once the sandbox ends. */
  readonly seed: string | null;
  /** Password of the `lab` role. Cleared once the sandbox ends. */
  readonly labPassword: string | null;
  readonly ttlSeconds: number;
  readonly idleSeconds: number;
  readonly requestedAt: Date;
  readonly provisioningAt: Date | null;
  readonly readyAt: Date | null;
  /** Where a client reaches the sandbox; set once it is READY. */
  readonly host: string | null;
  readonly port: number | null;
  readonly lastHeartbeatAt: Date | null;
  /** Hard deadline, fixed when provisioning starts and written on the container label. */
  readonly expiresAt: Date | null;
  readonly endedAt: Date | null;
  readonly endReason: string | null;
  readonly failure: string | null;
  readonly destroyAttempts: number;
}

/** When an ACTIVE sandbox without further heartbeats is due for teardown. */
export function idleExpiresAt(record: SandboxRecord): Date | null {
  if (record.status !== 'ACTIVE' || record.lastHeartbeatAt === null) return null;
  return new Date(record.lastHeartbeatAt.getTime() + record.idleSeconds * 1000);
}
