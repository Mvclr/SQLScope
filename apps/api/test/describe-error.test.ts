import { describe as suite, expect, it } from 'vitest';
import { describe } from '../src/health/health-check.js';

const refused = (address: string) =>
  Object.assign(new Error(`connect ECONNREFUSED ${address}`), { code: 'ECONNREFUSED' });

suite('describe(error)', () => {
  it('unwraps the empty AggregateError thrown for multi-address hosts', () => {
    const error = new AggregateError([refused('::1:5432'), refused('127.0.0.1:5432')], '');

    expect(describe(error)).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('falls back to the error code when there is no message', () => {
    expect(describe(Object.assign(new Error(''), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT');
  });

  it('stringifies non-errors', () => {
    expect(describe('boom')).toBe('boom');
  });
});
