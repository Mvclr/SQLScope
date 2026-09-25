/**
 * Docker Engine API version the manager speaks. Pinned so a daemon upgrade cannot change
 * a response shape underneath it; 1.44 is the oldest a current daemon still accepts.
 */
const API_VERSION = 'v1.44';
const REQUEST_TIMEOUT_MS = 30_000;

export class DockerError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    message: string,
  ) {
    super(`docker ${operation} failed (${status}): ${message}`);
    this.name = 'DockerError';
  }
}

export interface ContainerSummary {
  readonly Id: string;
  readonly Names: readonly string[];
  readonly State: string;
  readonly Labels: Readonly<Record<string, string>>;
}

export interface ContainerInfo {
  readonly Id: string;
  readonly Name: string;
  readonly State: {
    readonly Status: string;
    readonly ExitCode: number;
    readonly Health?: { readonly Status: string };
  };
  readonly Config: { readonly Labels: Readonly<Record<string, string>> };
  readonly HostConfig: Readonly<Record<string, unknown>>;
}

export interface NetworkInfo {
  readonly Id: string;
  readonly Name: string;
  readonly Internal: boolean;
  readonly Labels: Readonly<Record<string, string>>;
  readonly Containers?: Readonly<Record<string, { readonly Name: string }>>;
}

/**
 * A thin client over the Docker Engine HTTP API, reached through the socket proxy
 * (ADR 0002). No SDK on purpose: the methods below are the complete list of calls the
 * manager makes, which is the allowlist a reviewer needs to read. Creating what already
 * exists and removing what is already gone are outcomes, not errors, because every caller
 * has to be idempotent.
 */
export class DockerClient {
  private readonly base: string;

  constructor(host: string) {
    this.base = `${host.replace(/\/$/, '')}/${API_VERSION}`;
  }

  async ping(): Promise<void> {
    await this.call('ping', 'GET', '/_ping', { ok: [200] });
  }

  async createNetwork(name: string, labels: Record<string, string>): Promise<'created' | 'exists'> {
    const response = await this.call('network create', 'POST', '/networks/create', {
      // Internal: no gateway, so nothing on the network reaches outside it (ADR 0001).
      body: { Name: name, Driver: 'bridge', Internal: true, Labels: labels },
      ok: [201, 409],
    });
    return response.status === 201 ? 'created' : 'exists';
  }

  async inspectNetwork(name: string): Promise<NetworkInfo | null> {
    const response = await this.call('network inspect', 'GET', `/networks/${enc(name)}`, {
      ok: [200, 404],
    });
    return response.status === 200 ? ((await response.json()) as NetworkInfo) : null;
  }

  async listNetworks(labels: readonly string[]): Promise<NetworkInfo[]> {
    const response = await this.call('network list', 'GET', `/networks?${filters(labels)}`, {
      ok: [200],
    });
    return (await response.json()) as NetworkInfo[];
  }

  /** Joins `container` to `network`; already being on it is fine. */
  async connectNetwork(network: string, container: string): Promise<void> {
    await this.call('network connect', 'POST', `/networks/${enc(network)}/connect`, {
      body: { Container: container },
      ok: [200],
      tolerate: /already exists/i,
    });
  }

  async disconnectNetwork(network: string, container: string): Promise<void> {
    await this.call('network disconnect', 'POST', `/networks/${enc(network)}/disconnect`, {
      body: { Container: container, Force: true },
      ok: [200, 404],
      tolerate: /is not connected/i,
    });
  }

  async removeNetwork(name: string): Promise<void> {
    await this.call('network remove', 'DELETE', `/networks/${enc(name)}`, { ok: [204, 404] });
  }

  async createContainer(name: string, spec: object): Promise<'created' | 'exists'> {
    const response = await this.call(
      'container create',
      'POST',
      `/containers/create?name=${enc(name)}`,
      { body: spec, ok: [201, 409] },
    );
    return response.status === 201 ? 'created' : 'exists';
  }

  /** Starts `name`; 304 means it already runs. */
  async startContainer(name: string): Promise<void> {
    await this.call('container start', 'POST', `/containers/${enc(name)}/start`, {
      ok: [204, 304],
    });
  }

  async inspectContainer(name: string): Promise<ContainerInfo | null> {
    const response = await this.call('container inspect', 'GET', `/containers/${enc(name)}/json`, {
      ok: [200, 404],
    });
    return response.status === 200 ? ((await response.json()) as ContainerInfo) : null;
  }

  async listContainers(labels: readonly string[]): Promise<ContainerSummary[]> {
    const response = await this.call(
      'container list',
      'GET',
      `/containers/json?all=true&${filters(labels)}`,
      { ok: [200] },
    );
    return (await response.json()) as ContainerSummary[];
  }

  /** Kills and removes `name` with its anonymous volumes; already gone is fine. */
  async removeContainer(name: string): Promise<void> {
    await this.call('container remove', 'DELETE', `/containers/${enc(name)}?force=true&v=true`, {
      ok: [204, 404],
      tolerate: /removal of container .* is already in progress/i,
    });
  }

  private async call(
    operation: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { body?: object; ok: readonly number[]; tolerate?: RegExp },
  ): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: options.body ? { 'content-type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : null,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (options.ok.includes(response.status)) return response;

    const message = await errorMessage(response);
    if (options.tolerate?.test(message)) return response;
    throw new DockerError(response.status, operation, message);
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function filters(labels: readonly string[]): string {
  return `filters=${enc(JSON.stringify({ label: labels }))}`;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    return (JSON.parse(text) as { message?: string }).message ?? text;
  } catch {
    // The socket proxy answers a denied call with an HTML page, not Docker's JSON.
    return (
      text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || response.statusText
    );
  }
}
