import type { SandboxStatus } from './sandbox.js';

/**
 * Allowed transitions. The ADR 0002 diagram, plus what the implementation needs
 * (ADR 0002, "Ajustes da implementação"):
 *
 * - any non-terminal status → FAILED, because reconciliation must be able to fail a
 *   READY or ACTIVE sandbox whose container vanished, not only one being provisioned;
 * - PENDING → DESTROYED, a request cancelled while queued, with nothing to tear down;
 * - PROVISIONING → EXPIRING, a release that arrives while the container is being built.
 */
const TRANSITIONS: Readonly<Record<SandboxStatus, readonly SandboxStatus[]>> = {
  PENDING: ['PROVISIONING', 'DESTROYED', 'FAILED'],
  PROVISIONING: ['READY', 'EXPIRING', 'FAILED'],
  READY: ['ACTIVE', 'EXPIRING', 'FAILED'],
  ACTIVE: ['EXPIRING', 'FAILED'],
  EXPIRING: ['DESTROYING', 'FAILED'],
  DESTROYING: ['DESTROYED', 'FAILED'],
  DESTROYED: [],
  FAILED: [],
};

export function canTransition(from: SandboxStatus, to: SandboxStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: SandboxStatus,
    readonly to: SandboxStatus,
  ) {
    super(`illegal sandbox transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: SandboxStatus, to: SandboxStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
