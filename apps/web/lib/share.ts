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

/**
 * Limits on what a link may claim to contain.
 *
 * Deflate turns a few kilobytes of link into as much as the reader is willing to hold, and
 * the link comes from whoever sent it — so the reader decides how much it will hold. These
 * are generous next to a real session and cheap next to a tab that stops responding.
 */
const MAX_DECODED_BYTES = 1_000_000;
const MAX_SCRIPTS = 500;
const MAX_SCRIPT_LENGTH = 100_000;
const MAX_TITLE_LENGTH = 200;

export async function encodeShare(session: SharedSession): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(session));
  return toBase64Url(await compress(bytes, 'deflate-raw'));
}

export async function decodeShare(payload: string): Promise<SharedSession | null> {
  try {
    const bytes = await decompress(fromBase64Url(payload), 'deflate-raw', MAX_DECODED_BYTES);
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

async function compress(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const buffer = await new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream(format)),
  ).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Reads the stream chunk by chunk and stops at `limit` instead of buffering whatever comes
 * out. Reading it whole first would mean the link decides how much memory this tab uses.
 */
async function decompress(
  bytes: Uint8Array,
  format: CompressionFormat,
  limit: number,
): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream(format))
    .getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('shared link is larger than we are willing to read');
    }
    chunks.push(value);
  }

  const decoded = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoded;
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

/** Everything here came from a stranger's link, so nothing is taken on trust. */
function isSession(value: unknown): value is SharedSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SharedSession>;
  if (candidate.title !== undefined) {
    if (typeof candidate.title !== 'string' || candidate.title.length > MAX_TITLE_LENGTH) {
      return false;
    }
  }
  return (
    candidate.v === 1 &&
    Array.isArray(candidate.scripts) &&
    candidate.scripts.length <= MAX_SCRIPTS &&
    candidate.scripts.every(
      (script) => typeof script === 'string' && script.length <= MAX_SCRIPT_LENGTH,
    )
  );
}
