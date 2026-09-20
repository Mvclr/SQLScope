import { beforeAll, describe, expect, it } from 'vitest';
import { fingerprint, loadParser } from '../src/index.js';

beforeAll(loadParser);

describe('fingerprint', () => {
  it('is the same for queries that differ only in literals or formatting', () => {
    expect(fingerprint('select * from orders where total > 100')).toBe(
      fingerprint('SELECT *\nFROM orders\nWHERE total > 900'),
    );
  });

  it('changes when the shape of the query changes', () => {
    expect(fingerprint('select * from orders where total > 100')).not.toBe(
      fingerprint('select * from orders where user_id > 100'),
    );
  });
});
