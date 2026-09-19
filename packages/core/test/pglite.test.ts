import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll } from 'vitest';
import { pgliteSession } from '../src/adapters/pglite.js';
import { describeEngineContract } from './contract.js';

// Booting PGlite compiles its WebAssembly module, which takes seconds on a busy machine.
// Pay that once and clone an empty template per test — the in-browser counterpart of
// T1's `CREATE DATABASE ... TEMPLATE`.
let template: PGlite;

beforeAll(async () => {
  template = await PGlite.create();
}, 60_000);

afterAll(async () => {
  await template?.close();
});

describeEngineContract('PGlite', async () => {
  const pglite = await template.clone();
  return { db: pgliteSession(pglite), dispose: () => pglite.close() };
});
