import type pg from 'pg';
import {
  SANDBOX_STATUSES,
  SLOT_STATUSES,
  TERMINAL_STATUSES,
  type SandboxId,
  type SandboxRecord,
  type SandboxStatus,
} from '../domain/sandbox.js';
import { assertTransition } from '../domain/state-machine.js';

/** Arbitrary and fixed: one admission at a time, across every replica. */
const ADMISSION_LOCK = 7_302_210_002;

export interface CreateInput {
  readonly id: SandboxId;
  readonly requestId: string;
  readonly seed: string;
  readonly labPassword: string;
  readonly ttlSeconds: number;
  readonly idleSeconds: number;
  readonly now: Date;
}

/** Columns a transition may set besides the status. */
export interface TransitionPatch {
  readonly readyAt?: Date;
  readonly host?: string;
  readonly port?: number;
  readonly lastHeartbeatAt?: Date;
}

export interface TransitionOptions {
  readonly at: Date;
  /** Kept in the transition log; also the end reason or failure, depending on `to`. */
  readonly reason?: string;
  readonly patch?: TransitionPatch;
}

const PATCH_COLUMNS: Record<keyof TransitionPatch, string> = {
  readyAt: 'ready_at',
  host: 'host',
  port: 'port',
  lastHeartbeatAt: 'last_heartbeat_at',
};

interface Row {
  id: string;
  request_id: string;
  status: SandboxStatus;
  seed: string | null;
  lab_password: string | null;
  ttl_seconds: number;
  idle_seconds: number;
  requested_at: Date;
  provisioning_at: Date | null;
  ready_at: Date | null;
  host: string | null;
  port: number | null;
  last_heartbeat_at: Date | null;
  expires_at: Date | null;
  ended_at: Date | null;
  end_reason: string | null;
  failure: string | null;
  destroy_attempts: number;
}

function toRecord(row: Row): SandboxRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    status: row.status,
    seed: row.seed,
    labPassword: row.lab_password,
    ttlSeconds: row.ttl_seconds,
    idleSeconds: row.idle_seconds,
    requestedAt: row.requested_at,
    provisioningAt: row.provisioning_at,
    readyAt: row.ready_at,
    host: row.host,
    port: row.port,
    lastHeartbeatAt: row.last_heartbeat_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    failure: row.failure,
    destroyAttempts: row.destroy_attempts,
  };
}

/**
 * The control database is the source of truth for every sandbox (ADR 0002). Each status
 * change is a compare-and-set on the current status: whoever loses a race — the loop and a
 * DELETE, two replicas — gets `null` and does nothing, which is what makes the concurrent
 * paths idempotent.
 */
export class PgStore {
  constructor(private readonly pool: pg.Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  /** Inserts a PENDING sandbox, or returns the one already created for `requestId`. */
  async create(input: CreateInput): Promise<{ record: SandboxRecord; created: boolean }> {
    const inserted = await this.pool.query<Row>(
      `with updated as (
         insert into sandboxes
           (id, request_id, status, seed, lab_password, ttl_seconds, idle_seconds, requested_at)
         values ($1, $2, 'PENDING', $3, $4, $5, $6, $7)
         on conflict (request_id) do nothing
         returning *
       ), logged as (
         insert into sandbox_transitions (sandbox_id, seq, from_status, to_status, reason, at)
         select id, 1, null, status, 'requested', requested_at from updated
       )
       select * from updated`,
      [
        input.id,
        input.requestId,
        input.seed,
        input.labPassword,
        input.ttlSeconds,
        input.idleSeconds,
        input.now,
      ],
    );
    if (inserted.rows[0]) return { record: toRecord(inserted.rows[0]), created: true };

    const existing = await this.pool.query<Row>('select * from sandboxes where request_id = $1', [
      input.requestId,
    ]);
    // Only a concurrent delete of the row could get here; the caller retries.
    if (!existing.rows[0]) throw new Error(`sandbox for request ${input.requestId} vanished`);
    return { record: toRecord(existing.rows[0]), created: false };
  }

  async get(id: SandboxId): Promise<SandboxRecord | null> {
    const result = await this.pool.query<Row>('select * from sandboxes where id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /**
   * Moves `id` from `from` to `to` if it is still in `from`; `null` when it is not. Entering
   * a terminal status stamps `ended_at` and erases the seed and the password; entering
   * FAILED records the reason as the failure, and entering EXPIRING — or DESTROYED straight
   * from the queue — records it as the end reason.
   */
  async transition(
    id: SandboxId,
    from: SandboxStatus,
    to: SandboxStatus,
    options: TransitionOptions,
  ): Promise<SandboxRecord | null> {
    assertTransition(from, to);
    const reason = options.reason ?? null;
    const params: unknown[] = [id, from, to, reason, options.at];
    const sets = ['status = $3'];

    for (const [key, value] of Object.entries(options.patch ?? {})) {
      params.push(value);
      sets.push(`${PATCH_COLUMNS[key as keyof TransitionPatch]} = $${params.length}`);
    }
    if (TERMINAL_STATUSES.includes(to)) {
      sets.push('ended_at = $5::timestamptz', 'seed = null', 'lab_password = null');
    }
    if (to === 'FAILED') sets.push('failure = $4::text');
    if (to === 'EXPIRING' || (from === 'PENDING' && to === 'DESTROYED')) {
      sets.push('end_reason = $4::text');
    }

    const result = await this.pool.query<Row>(
      `with updated as (
         update sandboxes set ${sets.join(', ')}
          where id = $1 and status = $2
         returning *
       ), logged as (
         insert into sandbox_transitions (sandbox_id, seq, from_status, to_status, reason, at)
         select u.id,
                coalesce((select max(t.seq) from sandbox_transitions t where t.sandbox_id = u.id), 0) + 1,
                $2::text, u.status, $4::text, $5::timestamptz
           from updated u
       )
       select * from updated`,
      params,
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** Renews the idle deadline of an ACTIVE sandbox; `null` if it is not ACTIVE. */
  async touch(id: SandboxId, now: Date): Promise<SandboxRecord | null> {
    const result = await this.pool.query<Row>(
      `update sandboxes set last_heartbeat_at = $2
        where id = $1 and status = 'ACTIVE'
       returning *`,
      [id, now],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** Counts a failed teardown of a DESTROYING sandbox and returns the new total. */
  async recordDestroyFailure(id: SandboxId): Promise<number> {
    const result = await this.pool.query<{ destroy_attempts: number }>(
      `update sandboxes set destroy_attempts = destroy_attempts + 1
        where id = $1 and status = 'DESTROYING'
       returning destroy_attempts`,
      [id],
    );
    return result.rows[0]?.destroy_attempts ?? 0;
  }

  /**
   * Promotes the oldest PENDING sandboxes to PROVISIONING while slots are free, and fixes
   * their hard deadline: the lifetime they asked for plus the time provisioning may take.
   * The advisory lock makes the count and the promotion one step, even across replicas.
   */
  async admit(
    maxActive: number,
    now: Date,
    provisionTimeoutSeconds: number,
  ): Promise<SandboxRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock($1)', [ADMISSION_LOCK]);
      const held = await client.query<{ count: number }>(
        'select count(*)::int as count from sandboxes where status = any($1)',
        [SLOT_STATUSES],
      );
      const free = maxActive - (held.rows[0]?.count ?? 0);
      if (free <= 0) {
        await client.query('commit');
        return [];
      }
      const result = await client.query<Row>(
        `with next as (
           select id from sandboxes
            where status = 'PENDING'
            order by requested_at, id
            limit $1
         ), updated as (
           update sandboxes s
              set status = 'PROVISIONING',
                  provisioning_at = $2::timestamptz,
                  expires_at = $2::timestamptz + make_interval(secs => s.ttl_seconds + $3::int)
             from next
            where s.id = next.id
           returning s.*
         ), logged as (
           insert into sandbox_transitions (sandbox_id, seq, from_status, to_status, reason, at)
           select u.id,
                  coalesce((select max(t.seq) from sandbox_transitions t where t.sandbox_id = u.id), 0) + 1,
                  'PENDING', 'PROVISIONING', 'admitted', $2::timestamptz
             from updated u
         )
         select * from updated order by requested_at, id`,
        [free, now, provisionTimeoutSeconds],
      );
      await client.query('commit');
      return result.rows.map(toRecord);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Every sandbox not yet in a terminal status, oldest first. */
  async listLive(): Promise<SandboxRecord[]> {
    const result = await this.pool.query<Row>(
      `select * from sandboxes where status <> all($1) order by requested_at, id`,
      [TERMINAL_STATUSES],
    );
    return result.rows.map(toRecord);
  }

  /** 1-based place of a PENDING sandbox in the queue; `null` for any other status. */
  async queuePosition(id: SandboxId): Promise<number | null> {
    const result = await this.pool.query<{ position: number }>(
      `select count(*)::int as position
         from sandboxes me
         join sandboxes ahead
           on ahead.status = 'PENDING'
          and (ahead.requested_at, ahead.id) <= (me.requested_at, me.id)
        where me.id = $1 and me.status = 'PENDING'`,
      [id],
    );
    const position = result.rows[0]?.position ?? 0;
    return position > 0 ? position : null;
  }

  async countByStatus(): Promise<Record<SandboxStatus, number>> {
    const counts = Object.fromEntries(SANDBOX_STATUSES.map((s) => [s, 0])) as Record<
      SandboxStatus,
      number
    >;
    const result = await this.pool.query<{ status: SandboxStatus; count: number }>(
      'select status, count(*)::int as count from sandboxes group by status',
    );
    for (const row of result.rows) counts[row.status] = row.count;
    return counts;
  }
}
