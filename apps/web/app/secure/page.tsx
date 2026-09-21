import { labs } from '@sqlscope/labs';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Secure' };

export default function LabCatalog() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-[20px] font-semibold">Laboratórios</h1>
      <p className="mt-1 text-muted">
        Cada lab é um banco seu, no seu navegador, onde você é superusuário. Crie roles, quebre a
        própria consulta, ligue RLS e veja o que muda — nada aqui toca um servidor.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {labs.map((lab) => (
          <li key={lab.id}>
            <Link
              href={`/secure/${lab.id}`}
              className="block rounded-lg border border-border bg-surface-1 p-5 hover:border-accent"
            >
              <span className="font-mono text-[11px] uppercase tracking-wide text-structure">
                {lab.level}
              </span>
              <h2 className="mt-1 text-[16px] font-semibold">{lab.title}</h2>
              <p className="mt-2 text-[13px] text-muted">{lab.summary}</p>
              <p className="mt-3 text-[12px] text-faint">{lab.steps.length} passos</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
