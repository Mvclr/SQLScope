import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** What a panel shows before there is anything in it: what it is for, and how to fill it. */
export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl border border-border bg-surface-2 text-faint">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="max-w-sm text-[13px] text-muted">{children}</div>
    </div>
  );
}

/** A key, as the keyboard shows it. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-px font-mono text-[11px] text-text">
      {children}
    </kbd>
  );
}
