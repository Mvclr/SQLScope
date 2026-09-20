/** Calls to the account and project endpoints, all cookie-authenticated on this origin. */

export interface Account {
  readonly id: string;
  readonly email: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Project extends ProjectSummary {
  readonly scripts: string[];
}

export class AccountError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { message?: string }).message;
    throw new AccountError(message ?? 'Não foi possível completar a ação.');
  }
  return body as T;
}

/**
 * Who is signed in, or `null` for nobody.
 *
 * Shared between callers: several components ask on the same page load, and React mounts
 * them twice in development. They all wait on one request until something changes it.
 */
let pending: Promise<Account | null> | undefined;

export function currentAccount(): Promise<Account | null> {
  pending ??= call<{ user: Account | null }>('/auth/me')
    .then((body) => body.user)
    // A server that cannot answer is not an answer of "signed out", but there is nothing
    // else the page can do with it, and the next action will surface the real error.
    .catch(() => null);
  return pending;
}

/** After signing in or out, the shared answer is stale. */
const forget = <T>(value: T): T => {
  pending = undefined;
  return value;
};

export const register = (email: string, password: string) =>
  call<Account>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }).then(forget);

export const login = (email: string, password: string) =>
  call<Account>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }).then(
    forget,
  );

export const logout = () => call<void>('/auth/logout', { method: 'POST' }).then(forget);

export const listProjects = () => call<ProjectSummary[]>('/projects');

export const readProject = (id: string) => call<Project>(`/projects/${id}`);

export const saveProject = (name: string, scripts: string[]) =>
  call<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify({ name, scripts }) });

export const deleteProject = (id: string) => call<void>(`/projects/${id}`, { method: 'DELETE' });
