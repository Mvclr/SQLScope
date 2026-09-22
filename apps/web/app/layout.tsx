import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountNav } from '../components/auth/AccountNav';
import { ModeNav } from '../components/ui/ModeNav';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { themeScript } from '../lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SQLScope', template: '%s · SQLScope' },
  description: 'Build it. Query it. Break it. Secure it.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme before React hydrates, so the attribute differs
    // from the server's HTML on purpose.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:gap-3">
          <Link
            href="/"
            className="group flex items-center gap-2.5 rounded-xl pr-2 font-semibold tracking-tight text-text"
          >
            <span className="grid size-8 place-items-center rounded-xl border border-border bg-surface-1 shadow-[var(--elevation-1)] transition-transform duration-300 group-hover:rotate-[-8deg]">
              <Mark />
            </span>
            <span className="hidden sm:inline">SQLScope</span>
          </Link>
          <ModeNav />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <AccountNav />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px] text-accent" aria-hidden>
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path
        d="M5 24h9l4-10 6 20 5-14 3 4h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
