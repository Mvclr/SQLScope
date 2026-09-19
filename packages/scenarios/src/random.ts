/**
 * Small seeded PRNG (mulberry32). Scenario data must be identical on every machine and
 * every run for a given variant, so `Math.random` is off limits.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  /** `count` distinct items, in random order. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, count);
  }
}

/** Renders a value as a SQL literal. Scenario data is ours, but quoting stays correct anyway. */
export function literal(value: string | number | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

export function insert(
  table: string,
  columns: readonly string[],
  rows: readonly (string | number | null)[][],
): string {
  if (rows.length === 0) return '';
  const values = rows.map((row) => `  (${row.map(literal).join(', ')})`).join(',\n');
  return `insert into ${table} (${columns.join(', ')}) values\n${values};`;
}
