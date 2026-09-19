import { scenarios } from '@sqlscope/scenarios';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Learn' };

export default function LearnCatalog() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-[20px] font-semibold">Cenários</h1>
      <p className="mt-1 text-muted">
        Cada cenário é um pequeno banco com dados e desafios. Tudo roda no seu navegador — nada é
        enviado a um servidor.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {scenarios.map((scenario) => (
          <li key={scenario.id}>
            <Link
              href={`/learn/${scenario.id}`}
              className="block rounded-lg border border-border bg-surface-1 p-5 hover:border-accent"
            >
              <span className="font-mono text-[11px] uppercase tracking-wide text-structure">
                {scenario.level}
              </span>
              <h2 className="mt-1 text-[16px] font-semibold">{scenario.title}</h2>
              <p className="mt-2 text-[13px] text-muted">{scenario.summary}</p>
              <p className="mt-3 text-[12px] text-faint">{scenario.challenges.length} desafios</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
