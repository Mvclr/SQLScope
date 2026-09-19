import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * Sandbox databases and their roles share one name. DDL cannot take identifiers as bind
 * parameters, so every name is generated here and checked against this pattern before it
 * is interpolated into SQL.
 */
const SANDBOX_NAME = /^sbx_[0-9a-f]{24}$/;

export interface SandboxCredentials {
  readonly databaseName: string;
  readonly password: string;
}

export interface SandboxLimits {
  readonly statementTimeoutMs: number;
}

export function newSandboxCredentials(): SandboxCredentials {
  return {
    databaseName: `sbx_${randomBytes(12).toString('hex')}`,
    password: randomBytes(24).toString('base64url'),
  };
}

export function assertSandboxName(name: string): string {
  if (!SANDBOX_NAME.test(name)) throw new Error(`Refusing unexpected sandbox name: ${name}`);
  return name;
}

/**
 * Creates and destroys T1 sandboxes: one database per session, owned by a role that
 * exists only for that session (ADR 0001).
 *
 * Runs as `sqlscope_provisioner`, which has CREATEDB and CREATEROLE but is not a superuser.
 */
export class SandboxProvisioner {
  constructor(private readonly admin: pg.Pool) {}

  async create(credentials: SandboxCredentials, limits: SandboxLimits): Promise<void> {
    const name = assertSandboxName(credentials.databaseName);
    const password = pg.escapeLiteral(credentials.password);
    const timeout = Math.trunc(limits.statementTimeoutMs);

    // The session role can run any SQL the user types, so it gets nothing beyond
    // ownership of its own database.
    await this.admin.query(
      `create role ${name} login password ${password}
         nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 3`,
    );
    try {
      for (const setting of [
        `statement_timeout = ${timeout}`,
        `lock_timeout = ${timeout}`,
        `idle_in_transaction_session_timeout = '10min'`,
        `timezone = 'UTC'`,
      ]) {
        await this.admin.query(`alter role ${name} set ${setting}`);
      }
      // Since PostgreSQL 16 a CREATEROLE role only administers the roles it creates, and
      // must be granted membership to create a database owned by one.
      await this.admin.query(`grant ${name} to current_user with inherit true, set true`);
      await this.admin.query(`create database ${name} owner ${name} template template0`);
      await this.admin.query(`revoke all on database ${name} from public`);
      await this.admin.query(`grant connect, temporary on database ${name} to ${name}`);
    } catch (error) {
      await this.destroy(name).catch(() => undefined);
      throw error;
    }
  }

  /** Idempotent: destroying what is already gone succeeds. */
  async destroy(databaseName: string): Promise<void> {
    const name = assertSandboxName(databaseName);
    // FORCE terminates the session's open connections first.
    await this.admin.query(`drop database if exists ${name} with (force)`);
    await this.admin.query(`drop role if exists ${name}`);
  }

  async sizeInBytes(databaseName: string): Promise<number | null> {
    const { rows } = await this.admin.query<{ size: string | null }>(
      `select pg_database_size(datname)::text as size from pg_database where datname = $1`,
      [assertSandboxName(databaseName)],
    );
    return rows[0]?.size ? Number(rows[0].size) : null;
  }

  /** Every sandbox database or role on the cluster, whether or not a session knows it. */
  async list(): Promise<string[]> {
    const { rows } = await this.admin.query<{ name: string }>(
      `select datname as name from pg_database where datname ~ '^sbx_[0-9a-f]{24}$'
       union
       select rolname from pg_roles where rolname ~ '^sbx_[0-9a-f]{24}$'`,
    );
    return rows.map((r) => r.name);
  }

  /** Connection string for the session role itself, on the same cluster. */
  static connectionString(adminUrl: string, credentials: SandboxCredentials): string {
    const url = new URL(adminUrl);
    url.username = credentials.databaseName;
    url.password = credentials.password;
    url.pathname = `/${credentials.databaseName}`;
    return url.toString();
  }
}
