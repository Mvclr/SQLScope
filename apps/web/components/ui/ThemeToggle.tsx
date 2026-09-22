'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { ThemePreference } from '../../lib/theme';
import { setThemePreference, useTheme } from '../../lib/theme-client';
import { useSlidingIndicator } from './useSlidingIndicator';

const options: readonly { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Tema claro', icon: Sun },
  { value: 'dark', label: 'Tema escuro', icon: Moon },
  { value: 'system', label: 'Tema do sistema', icon: Monitor },
];

/** Light, dark or the system's choice — remembered per browser (lib/theme.ts). */
export function ThemeToggle() {
  const { preference } = useTheme();
  const { ref, box } = useSlidingIndicator<HTMLDivElement>(preference);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Tema"
      className="relative flex items-center rounded-xl border border-border bg-surface-1 p-0.5 shadow-[var(--elevation-1)]"
    >
      {box && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 rounded-lg bg-surface-3 transition-[left,width] duration-300 ease-[var(--ease-snappy)]"
          style={{ left: box.left, width: box.width }}
        />
      )}
      {options.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            data-indicator={value}
            aria-pressed={active}
            title={label}
            onClick={() => setThemePreference(value)}
            className={`relative grid size-7 place-items-center rounded-lg transition-colors ${active ? 'text-text' : 'text-faint hover:text-text'}`}
          >
            <Icon
              aria-hidden
              className={`size-3.5 transition-transform duration-300 ${active ? 'rotate-0 scale-100' : '-rotate-12 scale-90'}`}
            />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
