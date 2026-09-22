import { ArrowRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

/** Position in the entrance sequence (`.rise` in globals.css). */
export const riseOrder = (index: number) => ({ '--i': index }) as CSSProperties;

/** The block that opens a catalog page: what this collection is, and where it runs. */
export function CatalogHeader({
  icon: Icon,
  title,
  where,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Where things on this page run, e.g. "PGlite · no seu navegador". */
  where: ReactNode;
  children: ReactNode;
}) {
  return (
    <header className="bento rise flex flex-wrap items-center gap-4 p-5" style={riseOrder(0)}>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 max-w-2xl text-[13px] text-muted">{children}</p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-faint">
        {where}
      </span>
    </header>
  );
}

/** One scenario or lab: a compartment that opens it. */
export function CatalogCard({
  href,
  index,
  icon: Icon,
  level,
  title,
  summary,
  count,
  countIcon: CountIcon,
}: {
  href: string;
  index: number;
  icon: LucideIcon;
  level: string;
  title: string;
  summary: string;
  count: string;
  countIcon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="bento bento-link rise group flex h-full flex-col p-5"
      style={riseOrder(index)}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl border border-border bg-surface-2 text-structure">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="rounded-full bg-structure-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-structure">
          {level}
        </span>
      </div>
      <h2 className="mt-4 text-[16px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-[13px] text-muted">{summary}</p>
      <div className="mt-auto flex items-center gap-1.5 pt-4 text-[12px] text-faint">
        <CountIcon aria-hidden className="size-3.5" />
        {count}
        <span className="ml-auto inline-flex items-center gap-1 font-medium text-accent opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100">
          Abrir
          <ArrowRight aria-hidden className="size-3.5" />
        </span>
      </div>
    </Link>
  );
}
