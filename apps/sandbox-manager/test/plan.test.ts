import { describe, expect, it } from 'vitest';
import type { SandboxRecord, SandboxStatus } from '../src/domain/sandbox.js';
import type { SandboxObservedState } from '../src/provider/provider.js';
import { planDegraded, planReconcile } from '../src/reconcile/plan.js';

const T = Date.parse('2026-09-25T12:00:00Z');
const at = (seconds: number) => new Date(T + seconds * 1000);
const settings = { provisionTimeoutMs: 60_000, readyClaimMs: 120_000 };

const ID = 't2_000000000000000000000001';

function record(status: SandboxStatus, overrides: Partial<SandboxRecord> = {}): SandboxRecord {
  return {
    id: ID,
    requestId: 'req',
    status,
    seed: '',
    labPassword: 'ab',
    ttlSeconds: 1800,
    idleSeconds: 600,
    requestedAt: at(0),
    provisioningAt: at(0),
    readyAt: ['READY', 'ACTIVE'].includes(status) ? at(10) : null,
    host: null,
    port: null,
    lastHeartbeatAt: status === 'ACTIVE' ? at(20) : null,
    expiresAt: at(1860),
    endedAt: null,
    endReason: null,
    failure: null,
    destroyAttempts: 0,
    ...overrides,
  };
}

function container(
  state: SandboxObservedState['container'] = 'running',
  id = ID,
): SandboxObservedState {
  return { id, container: state, network: true, expiresAt: at(1860) };
}

function plan(
  records: SandboxRecord[],
  observed: SandboxObservedState[],
  now: number,
  options: { observedAt?: number; provisioning?: string[] } = {},
) {
  return planReconcile({
    now: at(now),
    observed,
    observedAt: at(options.observedAt ?? now),
    records,
    provisioning: new Set(options.provisioning ?? []),
    settings,
  });
}

describe('planReconcile', () => {
  it.each([
    ['a healthy READY sandbox', record('READY'), container(), 30, []],
    ['an ACTIVE one with a recent heartbeat', record('ACTIVE'), container(), 300, []],
    [
      'READY past the claim window',
      record('READY'),
      container(),
      131,
      [{ kind: 'expire', id: ID, from: 'READY', reason: 'unclaimed' }],
    ],
    [
      'ACTIVE past the idle timeout',
      record('ACTIVE'),
      container(),
      621,
      [{ kind: 'expire', id: ID, from: 'ACTIVE', reason: 'idle' }],
    ],
    [
      'past the hard deadline, however active',
      record('ACTIVE', { lastHeartbeatAt: at(1855) }),
      container(),
      1860,
      [{ kind: 'expire', id: ID, from: 'ACTIVE', reason: 'max-lifetime' }],
    ],
    [
      'READY whose container vanished',
      record('READY'),
      null,
      30,
      [{ kind: 'fail', id: ID, from: 'READY', reason: 'container-lost' }],
    ],
    [
      'ACTIVE whose container exited',
      record('ACTIVE'),
      container('exited'),
      30,
      [{ kind: 'fail', id: ID, from: 'ACTIVE', reason: 'container-lost' }],
    ],
    [
      'a network left without its container',
      record('ACTIVE'),
      container(null),
      30,
      [{ kind: 'fail', id: ID, from: 'ACTIVE', reason: 'container-lost' }],
    ],
    [
      'PROVISIONING past the timeout, run by nobody',
      record('PROVISIONING'),
      container(),
      61,
      [{ kind: 'fail', id: ID, from: 'PROVISIONING', reason: 'stuck' }],
    ],
    ['PROVISIONING within the timeout', record('PROVISIONING'), null, 59, []],
    [
      'EXPIRING',
      record('EXPIRING'),
      container(),
      30,
      [{ kind: 'teardown', id: ID, from: 'EXPIRING' }],
    ],
    [
      'DESTROYING left by a crash, container already gone',
      record('DESTROYING'),
      null,
      30,
      [{ kind: 'teardown', id: ID, from: 'DESTROYING' }],
    ],
    ['PENDING, which has nothing to observe', record('PENDING'), null, 5_000, []],
  ] as const)('%s', (_, rec, observed, now, expected) => {
    expect(plan([rec], observed ? [observed] : [], now)).toEqual(expected);
  });

  it('reaps what no live record owns', () => {
    const stray = 't2_000000000000000000000002';
    const netOnly = 't2_000000000000000000000003';
    expect(
      plan(
        [record('READY')],
        [container(), container('running', stray), { ...container(null, netOnly) }],
        30,
      ),
    ).toEqual([
      { kind: 'reap-orphan', id: stray, resource: 'container' },
      { kind: 'reap-orphan', id: netOnly, resource: 'network' },
    ]);
  });

  it('reaps the container of a record that already ended', () => {
    // Records are listed live only; an ended record is as good as none.
    expect(plan([], [container()], 30)).toEqual([
      { kind: 'reap-orphan', id: ID, resource: 'container' },
    ]);
  });

  it('leaves a provisioning in flight alone, however long it takes', () => {
    expect(plan([record('PROVISIONING')], [], 600, { provisioning: [ID] })).toEqual([]);
  });

  it('does not judge a sandbox that became ready after the listing started', () => {
    // Provisioning finished between the listing and the read of the records: the listing
    // could not have seen the container, which is not the same as the container being lost.
    const justReady = record('READY', { readyAt: at(30) });
    expect(plan([justReady], [], 31, { observedAt: 29 })).toEqual([]);
    expect(plan([justReady], [], 31, { observedAt: 31 })).toEqual([
      { kind: 'fail', id: ID, from: 'READY', reason: 'container-lost' },
    ]);
  });
});

describe('planDegraded', () => {
  it('reaps only what is past the deadline on its label', () => {
    const expired = { ...container(), id: 't2_00000000000000000000000a', expiresAt: at(10) };
    const netOnly = {
      ...container(null),
      id: 't2_00000000000000000000000b',
      expiresAt: at(10),
    };
    const current = { ...container(), id: 't2_00000000000000000000000c', expiresAt: at(100) };
    const unlabelled = { ...container(), id: 't2_00000000000000000000000d', expiresAt: null };
    expect(planDegraded([expired, netOnly, current, unlabelled], at(50))).toEqual([
      { kind: 'reap-orphan', id: expired.id, resource: 'container' },
      { kind: 'reap-orphan', id: netOnly.id, resource: 'network' },
    ]);
  });
});
