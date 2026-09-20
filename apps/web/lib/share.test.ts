import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, shareLink, type SharedSession } from './share';

const ORIGIN = 'https://sqlscope.dev';

/** Packs any value the way a link does, including values `encodeShare` would never make. */
async function packed(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const buffer = await new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')),
  ).arrayBuffer();
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('link round trip', () => {
  it('reads back what it wrote', async () => {
    const session: SharedSession = {
      v: 1,
      title: 'Pedidos e clientes',
      scripts: ['create table users (id int);', "select * from users where name = 'ção';"],
    };

    expect(await decodeShare(await encodeShare(session))).toEqual(session);
  });

  it('works without a title', async () => {
    const session: SharedSession = { v: 1, scripts: ['select 1'] };

    expect(await decodeShare(await encodeShare(session))).toEqual(session);
  });

  it('puts the payload in the fragment, where the server never sees it', async () => {
    const link = await shareLink({ v: 1, scripts: ['select 1'] }, ORIGIN);

    expect(link).toMatch(/^https:\/\/sqlscope\.dev\/compartilhar#[\w-]+$/);
  });

  it('refuses to make a link too long to survive being copied', async () => {
    // Deflate would swallow repeated text, and a session of repeated text would fit; this
    // is the session that genuinely does not, so the caller is told instead of handed a
    // link that breaks when it is pasted.
    // xorshift32, so the text is the same on every run and deflate finds nothing to fold.
    let seed = 0x9e3779b9;
    const noise = (length: number) =>
      Array.from({ length }, () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) % 16).toString(16);
      }).join('');
    const long: SharedSession = { v: 1, scripts: Array.from({ length: 200 }, () => noise(400)) };

    expect(await shareLink(long, ORIGIN)).toBeNull();
  });
});

describe('links from strangers', () => {
  it('stops decompressing a payload that expands past the limit', async () => {
    // Valid in every other way: 20 scripts, each under the per-script cap. The only thing
    // wrong with it is its size once expanded — a few kB of link, almost 2 MB in the tab.
    const scripts = Array.from({ length: 20 }, () => 'select 1;'.repeat(10_000));
    const payload = await packed({ v: 1, scripts });
    expect(payload.length).toBeLessThan(30_000);

    expect(await decodeShare(payload)).toBeNull();
  });

  // Typed explicitly: otherwise the entries widen to a union of tuples and the callback
  // cannot destructure them.
  it.each<[unknown, string]>([
    [{ v: 2, scripts: ['select 1'] }, 'another format version'],
    [{ v: 1, scripts: 'select 1' }, 'scripts that are not a list'],
    [{ v: 1, scripts: [42] }, 'a script that is not text'],
    [{ v: 1, scripts: ['ok'], title: { toString: 'nope' } }, 'a title that is not text'],
    [{ v: 1, scripts: Array.from({ length: 501 }, () => 'select 1') }, 'too many scripts'],
    [{ v: 1, scripts: ['x'.repeat(100_001)] }, 'a script past the size cap'],
    [{ scripts: ['select 1'] }, 'no version marker'],
  ])('refuses %#: %s', async (value) => {
    expect(await decodeShare(await packed(value))).toBeNull();
  });

  it('refuses a fragment that is not a packed session', async () => {
    expect(await decodeShare('not-base64-at-all!!')).toBeNull();
    expect(await decodeShare('')).toBeNull();
  });
});
