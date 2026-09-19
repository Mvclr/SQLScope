import Link from 'next/link';

const modes = [
  {
    href: '/learn',
    title: 'Learn',
    tier: 'PGlite · no seu navegador',
    text: 'Cenários prontos — uma loja, uma biblioteca — com desafios corrigidos automaticamente.',
  },
  {
    href: '/build',
    title: 'Build',
    tier: 'PostgreSQL 18 · servidor isolado',
    text: 'Um banco só seu, descartável. Crie tabelas e veja o diagrama se formar a cada comando.',
  },
  {
    href: '/import',
    title: 'Importar',
    tier: 'PGlite · no seu navegador',
    text: 'Cole o DDL de um schema existente e visualize tabelas, chaves e relacionamentos.',
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-10 px-6 py-12">
      <div>
        <p className="font-mono text-[13px] text-structure">
          Build it. Query it. Break it. Secure it.
        </p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">
          Veja o que o seu SQL realmente faz.
        </h1>
        <p className="mt-3 max-w-2xl text-muted">
          Escreva SQL, execute em PostgreSQL real e acompanhe cada efeito no schema — tabelas
          surgindo, chaves estrangeiras sendo desenhadas, colunas mudando.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {modes.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="group rounded-lg border border-border bg-surface-1 p-5 transition-colors hover:border-accent"
          >
            <h2 className="text-[16px] font-semibold group-hover:text-accent">{mode.title}</h2>
            <p className="mt-1 font-mono text-[11px] text-faint">{mode.tier}</p>
            <p className="mt-3 text-[13px] text-muted">{mode.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
