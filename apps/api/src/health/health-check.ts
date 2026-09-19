/** A dependency the API needs in order to serve traffic. */
export interface HealthCheck {
  readonly name: string;
  /** Resolves when the dependency is usable; rejects otherwise. */
  check(): Promise<void>;
}

export const HEALTH_CHECKS = Symbol('HEALTH_CHECKS');

export interface CheckOutcome {
  readonly status: 'up' | 'down';
  readonly latencyMs: number;
  readonly error?: string;
}

export interface Readiness {
  readonly status: 'ready' | 'unavailable';
  readonly checks: Readonly<Record<string, CheckOutcome>>;
}

/** Runs all checks concurrently, each bounded by `timeoutMs`. */
export async function evaluate(
  checks: readonly HealthCheck[],
  timeoutMs: number,
): Promise<Readiness> {
  const outcomes = await Promise.all(
    checks.map(async (check): Promise<[string, CheckOutcome]> => {
      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);
      try {
        await withTimeout(check.check(), timeoutMs);
        return [check.name, { status: 'up', latencyMs: elapsed() }];
      } catch (error) {
        return [check.name, { status: 'down', latencyMs: elapsed(), error: describe(error) }];
      }
    }),
  );

  return {
    status: outcomes.every(([, o]) => o.status === 'up') ? 'ready' : 'unavailable',
    checks: Object.fromEntries(outcomes),
  };
}

/**
 * Connection failures to a host that resolves to several addresses (`localhost` → `::1`
 * and `127.0.0.1`) surface as an `AggregateError` with an empty message; the useful
 * detail lives in the nested errors or the system error code.
 */
export function describe(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return [...new Set(error.errors.map(describe))].join('; ');
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return error.message || code || error.name;
  }
  return String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
