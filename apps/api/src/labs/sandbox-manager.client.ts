/** How the sandbox manager (ADR 0002) reports a sandbox. Mirrors its own HTTP view. */
export type ManagerStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'READY'
  | 'ACTIVE'
  | 'EXPIRING'
  | 'DESTROYING'
  | 'DESTROYED'
  | 'FAILED';

export interface ManagerConnection {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

export interface ManagerSandbox {
  readonly id: string;
  readonly status: ManagerStatus;
  readonly queuePosition: number | null;
  readonly expiresAt: string | null;
  readonly idleExpiresAt: string | null;
  readonly endReason: string | null;
  readonly failure: string | null;
  /** Present only in READY and ACTIVE. */
  readonly connection: ManagerConnection | null;
}

export interface CreateSandboxInput {
  /** Idempotency key; the API passes the lab run's id, so a retried POST is a no-op. */
  readonly requestId: string;
  readonly seed: string;
  readonly ttlSeconds?: number;
  readonly idleSeconds?: number;
}

/** The manager has no room: the queue is full. Surfaces to the browser as 503. */
export class ManagerAtCapacityError extends Error {
  constructor() {
    super('the sandbox manager queue is full');
    this.name = 'ManagerAtCapacityError';
  }
}

/** Any other manager failure — down, timing out, a 5xx. Also a 503 to the browser. */
export class ManagerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagerUnavailableError';
  }
}

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * The API's side of the internal contract with the sandbox manager. Small on purpose: four
 * calls, a Bearer token, a short timeout. A queue-full answer and any transport failure
 * become typed errors the controller turns into 503, so the browser never sees the manager.
 */
export class SandboxManagerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /** Requests a sandbox, or returns the one this `requestId` already created. */
  async create(input: CreateSandboxInput): Promise<ManagerSandbox> {
    const response = await this.call('POST', '/sandboxes', input);
    if (response.status === 503) throw new ManagerAtCapacityError();
    return this.parse(response, 'create');
  }

  /** The sandbox, or null once the manager has forgotten it. */
  async get(sandboxId: string): Promise<ManagerSandbox | null> {
    const response = await this.call('GET', `/sandboxes/${sandboxId}`);
    if (response.status === 404) return null;
    return this.parse(response, 'get');
  }

  /**
   * Heartbeat: claims a READY sandbox (→ ACTIVE) and renews its idle deadline. A sandbox
   * that is not claimable (ended, or 404) returns null rather than throwing.
   */
  async heartbeat(sandboxId: string): Promise<ManagerSandbox | null> {
    const response = await this.call('POST', `/sandboxes/${sandboxId}/heartbeat`);
    if (response.status === 404 || response.status === 409) return null;
    return this.parse(response, 'heartbeat');
  }

  /** Releases a sandbox. Idempotent, so releasing one already gone is fine. */
  async release(sandboxId: string): Promise<void> {
    const response = await this.call('DELETE', `/sandboxes/${sandboxId}`);
    if (response.status !== 202 && response.status !== 204 && response.status !== 404) {
      throw new ManagerUnavailableError(`manager release answered ${response.status}`);
    }
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: object,
  ): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : null,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ManagerUnavailableError(
        `manager ${method} ${path} failed: ${(error as Error).message}`,
      );
    }
  }

  private async parse(response: Response, operation: string): Promise<ManagerSandbox> {
    if (!response.ok) {
      throw new ManagerUnavailableError(`manager ${operation} answered ${response.status}`);
    }
    return (await response.json()) as ManagerSandbox;
  }
}
