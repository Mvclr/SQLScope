/**
 * Shareable sessions: the SQL that was run, packed into a link.
 *
 * The payload lives in the URL fragment, which browsers never send to a server, and is
 * compressed so that a session of a few dozen statements still fits in a link.
 */
export interface SharedSession {
  /** Format marker, so an old link can be recognised instead of misread. */
  readonly v: 1;
  readonly title?: string;
  readonly scripts: readonly string[];
}

const MAX_LINK_LENGTH = 30_000;

export async function encodeShare(session: SharedSession): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(session));
  return toBase64Url(await compress(bytes, 'deflate-raw'));
}

export async function decodeShare(payload: string): Promise<SharedSession | null> {
  try {
    const bytes = await compress(fromBase64Url(payload), 'deflate-raw', true);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A link the user can copy, or `null` when the session is too big to fit in one. */
export async function shareLink(session: SharedSession, origin: string): Promise<string | null> {
  const url = `${origin}/compartilhar#${await encodeShare(session)}`;
  return url.length <= MAX_LINK_LENGTH ? url : null;
}

async function compress(
  bytes: Uint8Array,
  format: CompressionFormat,
  decompress = false,
): Promise<Uint8Array> {
  const stream = decompress ? new DecompressionStream(format) : new CompressionStream(format);
  const buffer = await new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(stream),
  ).arrayBuffer();
  return new Uint8Array(buffer);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isSession(value: unknown): value is SharedSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SharedSession>;
  return (
    candidate.v === 1 &&
    Array.isArray(candidate.scripts) &&
    candidate.scripts.every((script) => typeof script === 'string')
  );
}
