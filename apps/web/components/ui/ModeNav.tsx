'use client';

import { FileInput, GraduationCap, Hammer, ShieldCheck, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSlidingIndicator } from './useSlidingIndicator';

export interface Mode {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export const modes: readonly Mode[] = [
  { href: '/learn', label: 'Learn', icon: GraduationCap },
  { href: '/build', label: 'Build', icon: Hammer },
  { href: '/import', label: 'Importar', icon: FileInput },
  { href: '/secure', label: 'Secure', icon: ShieldCheck },
];

/** The four modes as one segmented control; the highlight slides to the current one. */
export function ModeNav() {
  const pathname = usePathname();
  const active = modes.find((mode) => pathname.startsWith(mode.href))?.href ?? null;
  const { ref, box } = useSlidingIndicator<HTMLElement>(active);

  return (
    <nav
      ref={ref}
      aria-label="Modos"
      className="relative flex items-center rounded-xl border border-border bg-surface-1 p-0.5 shadow-[var(--elevation-1)]"
    >
      {box && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 rounded-lg bg-surface-3 transition-[left,width] duration-300 ease-[var(--ease-snappy)]"
          style={{ left: box.left, width: box.width }}
        />
      )}
      {modes.map(({ href, label, icon: Icon }) => {
        const current = href === active;
        return (
          <Link
            key={href}
            href={href}
            data-indicator={href}
            aria-current={current ? 'page' : undefined}
            className={`relative flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors ${current ? 'text-text' : 'text-muted hover:text-text'}`}
          >
            <Icon
              aria-hidden
              className={`size-3.5 transition-colors ${current ? 'text-accent' : 'text-faint'}`}
            />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
