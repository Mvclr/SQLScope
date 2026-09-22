'use client';

import {
  ArrowUpRight,
  Clock3,
  FolderOpen,
  Hammer,
  LoaderCircle,
  LogIn,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { deleteProject, listProjects, type ProjectSummary } from '../../lib/account';
import { buttonClass } from '../ui/button';
import { riseOrder } from '../ui/Catalog';
import { EmptyState } from '../ui/EmptyState';

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
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="bento rise">
          <EmptyState icon={FolderOpen}>
            <p>{error}</p>
            <Link href="/entrar" className={buttonClass('primary', 'md', 'mt-4')}>
              <LogIn aria-hidden />
              Entrar
            </Link>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 pb-8 pt-2 sm:px-6">
        <header className="bento rise flex flex-wrap items-center gap-4 p-5" style={riseOrder(0)}>
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
            <FolderOpen aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold tracking-tight">Meus projetos</h1>
            <p className="mt-0.5 max-w-xl text-[13px] text-muted">
              Um projeto guarda o SQL que constrói o schema. Abrir um projeto o reexecuta em um
              banco novo — o banco em si é sempre descartável.
            </p>
          </div>
          <Link href="/build" className={buttonClass('secondary', 'md')}>
            <Hammer aria-hidden />
            Abrir o Build
          </Link>
        </header>

        {projects === null && (
          <p className="mt-6 flex items-center justify-center gap-2 text-[13px] text-faint">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Carregando…
          </p>
        )}
        {projects?.length === 0 && (
          <div className="rise mt-3 rounded-2xl border border-dashed border-border-strong">
            <EmptyState icon={FolderOpen}>
              Nada salvo ainda. No{' '}
              <Link href="/build" className="text-accent hover:underline">
                Build
              </Link>
              , use <strong>Salvar projeto</strong>.
            </EmptyState>
          </div>
        )}

        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {projects?.map((project, i) => (
            <li
              key={project.id}
              className="bento bento-link rise group relative flex items-center gap-3 p-4"
              style={riseOrder(i + 1)}
            >
              <div className="min-w-0 flex-1">
                {/* The whole card opens the project; the delete button sits above the link. */}
                <Link
                  href={`/build?projeto=${project.id}`}
                  className="block truncate text-[14px] font-medium after:absolute after:inset-0 after:rounded-2xl"
                >
                  {project.name}
                </Link>
                <p className="mt-0.5 flex items-center gap-1 text-[12px] text-faint">
                  <Clock3 aria-hidden className="size-3" />
                  {when.format(new Date(project.updatedAt))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(project.id)}
                className="relative z-10 grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-sev-critical/10 hover:text-sev-critical"
                aria-label={`Apagar ${project.name}`}
                title="Apagar"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </button>
              <ArrowUpRight
                aria-hidden
                className="size-4 text-faint transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
