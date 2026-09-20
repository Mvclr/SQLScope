'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { deleteProject, listProjects, type ProjectSummary } from '../../lib/account';

const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Saved sessions. Opening one replays its SQL into a new sandbox. */
export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listProjects()
      .then(setProjects)
      .catch(() => setError('Entre para ver seus projetos.'));
  }, []);

  const remove = async (id: string) => {
    await deleteProject(id);
    setProjects((current) => current?.filter((project) => project.id !== id) ?? null);
  };

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-muted">{error}</p>
        <Link href="/entrar" className="mt-3 inline-block text-structure hover:underline">
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-[20px] font-semibold">Meus projetos</h1>
      <p className="mt-1 text-[13px] text-muted">
        Um projeto guarda o SQL que constrói o schema. Abrir um projeto o reexecuta em um banco novo
        — o banco em si é sempre descartável.
      </p>

      {projects === null && <p className="mt-6 text-[13px] text-faint">Carregando…</p>}
      {projects?.length === 0 && (
        <p className="mt-6 text-[13px] text-muted">
          Nada salvo ainda. No{' '}
          <Link href="/build" className="text-structure hover:underline">
            Build
          </Link>
          , use <strong>Salvar projeto</strong>.
        </p>
      )}

      <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
        {projects?.map((project) => (
          <li key={project.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link
                href={`/build?projeto=${project.id}`}
                className="block truncate text-[14px] font-medium hover:text-accent"
              >
                {project.name}
              </Link>
              <p className="text-[12px] text-faint">
                Atualizado em {when.format(new Date(project.updatedAt))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void remove(project.id)}
              className="ml-auto shrink-0 text-[12px] text-muted hover:text-sev-critical"
            >
              Apagar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
