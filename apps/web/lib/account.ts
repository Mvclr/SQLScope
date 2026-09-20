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

/** `null` when nobody is signed in; the 401 is an answer, not a failure. */
export async function currentAccount(): Promise<Account | null> {
  try {
    return await call<Account>('/auth/me');
  } catch {
    return null;
  }
}

export const register = (email: string, password: string) =>
  call<Account>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });

export const login = (email: string, password: string) =>
  call<Account>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const logout = () => call<void>('/auth/logout', { method: 'POST' });

export const listProjects = () => call<ProjectSummary[]>('/projects');

export const readProject = (id: string) => call<Project>(`/projects/${id}`);

export const saveProject = (name: string, scripts: string[]) =>
  call<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify({ name, scripts }) });

export const deleteProject = (id: string) => call<void>(`/projects/${id}`, { method: 'DELETE' });
