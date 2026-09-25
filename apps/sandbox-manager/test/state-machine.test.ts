import { describe, expect, it } from 'vitest';
import { SANDBOX_STATUSES, isTerminal, type SandboxStatus } from '../src/domain/sandbox.js';
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
} from '../src/domain/state-machine.js';

const ALLOWED = new Set([
  'PENDING→PROVISIONING',
  'PENDING→DESTROYED',
  'PENDING→FAILED',
  'PROVISIONING→READY',
  'PROVISIONING→EXPIRING',
  'PROVISIONING→FAILED',
  'READY→ACTIVE',
  'READY→EXPIRING',
  'READY→FAILED',
  'ACTIVE→EXPIRING',
  'ACTIVE→FAILED',
  'EXPIRING→DESTROYING',
  'EXPIRING→FAILED',
  'DESTROYING→DESTROYED',
  'DESTROYING→FAILED',
]);

const pairs = SANDBOX_STATUSES.flatMap((from) =>
  SANDBOX_STATUSES.map((to): [SandboxStatus, SandboxStatus] => [from, to]),
);

describe('state machine', () => {
  it.each(pairs)('%s → %s', (from, to) => {
    const allowed = ALLOWED.has(`${from}→${to}`);
    expect(canTransition(from, to)).toBe(allowed);
    if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
    else expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
  });

  it('lets every non-terminal status fail', () => {
    for (const status of SANDBOX_STATUSES.filter((s) => !isTerminal(s))) {
      expect(canTransition(status, 'FAILED')).toBe(true);
    }
  });

  it('never leaves a terminal status', () => {
    for (const [from, to] of pairs.filter(([from]) => isTerminal(from))) {
      expect(canTransition(from, to)).toBe(false);
    }
  });
});
