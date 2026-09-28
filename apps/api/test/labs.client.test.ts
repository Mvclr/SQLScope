import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ManagerAtCapacityError,
  ManagerUnavailableError,
  SandboxManagerClient,
} from '../src/labs/sandbox-manager.client.js';

const TOKEN = 'z'.repeat(40);
const client = new SandboxManagerClient('http://manager:4100', TOKEN);

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sandbox = {
  id: 't2_0123456789abcdef01234567',
  status: 'READY',
  queuePosition: null,
  expiresAt: null,
  idleExpiresAt: null,
  endReason: null,
  failure: null,
  connection: { host: 'sqlscope-t2-x', port: 5432, database: 'lab', user: 'lab', password: 'ab' },
};

describe('SandboxManagerClient', () => {
  it('sends the bearer token and returns the sandbox on create', async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, sandbox));
    const result = await client.create({ requestId: 'run-1', seed: 'select 1;' });
    expect(result.id).toBe(sandbox.id);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://manager:4100/sandboxes');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ requestId: 'run-1', seed: 'select 1;' });
  });

  it('maps a full queue to a typed capacity error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'the sandbox queue is full' }));
    await expect(client.create({ requestId: 'r', seed: '' })).rejects.toBeInstanceOf(
      ManagerAtCapacityError,
    );
  });

  it('turns a transport failure into a typed unavailable error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(client.get('t2_0123456789abcdef01234567')).rejects.toBeInstanceOf(
      ManagerUnavailableError,
    );
  });

  it('turns an unexpected status into an unavailable error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(client.get('t2_0123456789abcdef01234567')).rejects.toBeInstanceOf(
      ManagerUnavailableError,
    );
  });

  it('reads a missing sandbox as null', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await client.get('t2_0123456789abcdef01234567')).toBeNull();
  });

  it('reads an unclaimable heartbeat as null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'sandbox is EXPIRING' }));
    expect(await client.heartbeat('t2_0123456789abcdef01234567')).toBeNull();
  });

  it('tolerates releasing a sandbox already gone', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(client.release('t2_0123456789abcdef01234567')).resolves.toBeUndefined();
  });
});
