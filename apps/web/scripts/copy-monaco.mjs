// Self-hosts Monaco's prebuilt AMD bundle under /monaco, so the editor loads from our own
// origin instead of a CDN and without teaching the bundler about Monaco's workers.
import { cp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
// monaco-editor's `exports` map hides package.json; the package directory itself is the
// dependency link pnpm creates in this app's node_modules.
const source = path.join(
  await realpath(path.join(root, 'node_modules', 'monaco-editor')),
  'min',
  'vs',
);
const target = path.join(root, 'public', 'monaco', 'vs');

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log(`monaco: copied ${source} -> ${target}`);
