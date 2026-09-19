import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavLink } from '../components/ui/NavLink';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SQLScope', template: '%s · SQLScope' },
  description: 'Build it. Query it. Break it. Secure it.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="flex h-dvh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-6 border-b border-border bg-surface-1 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-text">
            <Mark />
            SQLScope
          </Link>
          <nav aria-label="Modos" className="flex items-center gap-1 text-[13px]">
            <NavLink href="/learn">Learn</NavLink>
            <NavLink href="/build">Build</NavLink>
            <NavLink href="/import">Importar</NavLink>
            <span
              className="cursor-not-allowed px-3 py-1.5 text-faint"
              title="Laboratórios de segurança chegam em uma próxima versão"
            >
              Secure <span className="text-[11px]">· em breve</span>
            </span>
          </nav>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5 text-accent" aria-hidden>
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" />
      <path
        d="M5 24h9l4-10 6 20 5-14 3 4h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
