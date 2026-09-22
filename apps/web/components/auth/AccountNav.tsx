'use client';

import { FolderOpen, LogIn, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { currentAccount, logout, type Account } from '../../lib/account';
import { buttonClass } from '../ui/button';

/** Who is signed in, if anyone. Re-checked whenever the route changes. */
export function AccountNav() {
  const [account, setAccount] = useState<Account | null>(null);
  const [checked, setChecked] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void currentAccount().then((value) => {
      if (!active) return;
      setAccount(value);
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  if (!checked) return null;

  if (!account) {
    return (
      <Link
        href="/entrar"
        className="inline-flex h-[34px] items-center gap-1.5 rounded-xl border border-border bg-surface-1 px-2.5 text-[13px] sm:px-3 font-medium text-muted shadow-[var(--elevation-1)] transition-colors hover:text-text [&_svg]:size-4"
      >
        <LogIn aria-hidden />
        <span className="sr-only sm:not-sr-only">Entrar</span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link href="/projetos" className={buttonClass('ghost', 'md')}>
        <FolderOpen aria-hidden />
        <span className="sr-only md:not-sr-only">Meus projetos</span>
      </Link>
      <span
        className="hidden max-w-48 items-center gap-1.5 truncate px-2 text-[12px] text-faint lg:flex"
        title={account.email}
      >
        <UserRound aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{account.email}</span>
      </span>
      <button
        type="button"
        onClick={() =>
          void logout().then(() => {
            setAccount(null);
            router.push('/');
            router.refresh();
          })
        }
        className={buttonClass('ghost', 'md')}
      >
        <LogOut aria-hidden />
        <span className="sr-only sm:not-sr-only">Sair</span>
      </button>
    </div>
  );
}
