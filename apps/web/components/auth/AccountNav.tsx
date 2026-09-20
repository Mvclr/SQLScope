'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { currentAccount, logout, type Account } from '../../lib/account';

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

  if (!checked) return <span className="ml-auto" />;

  if (!account) {
    return (
      <Link href="/entrar" className="ml-auto text-[13px] text-muted hover:text-text">
        Entrar
      </Link>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-3 text-[13px]">
      <Link href="/projetos" className="text-muted hover:text-text">
        Meus projetos
      </Link>
      <span className="text-faint" title={account.email}>
        {account.email}
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
        className="text-muted hover:text-text"
      >
        Sair
      </button>
    </div>
  );
}
