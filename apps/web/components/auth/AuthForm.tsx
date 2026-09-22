'use client';

import { CircleX, LoaderCircle, LogIn, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AccountError, login, register } from '../../lib/account';
import { buttonClass } from '../ui/button';
import { useSlidingIndicator } from '../ui/useSlidingIndicator';

type Mode = 'login' | 'register';

const modes: readonly { value: Mode; label: string }[] = [
  { value: 'login', label: 'Entrar' },
  { value: 'register', label: 'Criar conta' },
];

const input =
  'mt-1 h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-[14px] outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent/15';

/**
 * Sign in or sign up. Signing in claims the sandbox this browser is already using, so
 * nothing the visitor built is lost when they create an account.
 */
export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ref, box } = useSlidingIndicator<HTMLDivElement>(mode);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? login(email, password) : register(email, password));
      router.push('/projetos');
      router.refresh();
    } catch (problem) {
      setError(
        problem instanceof AccountError ? problem.message : 'Algo deu errado. Tente de novo.',
      );
    } finally {
      setBusy(false);
    }
  };

  const Icon = mode === 'login' ? LogIn : UserPlus;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4 py-10">
        <div className="bento rise p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent/12 text-accent">
              <Icon aria-hidden className="size-5" />
            </span>
            <div>
              <h1 className="text-[18px] font-semibold tracking-tight">
                {mode === 'login' ? 'Entrar' : 'Criar conta'}
              </h1>
              <p className="text-[12px] text-muted">Para guardar seus schemas.</p>
            </div>
          </div>

          <div
            ref={ref}
            role="group"
            aria-label="Tenho ou não conta"
            className="relative mt-5 grid grid-cols-2 rounded-xl bg-surface-2 p-0.5"
          >
            {box && (
              <span
                aria-hidden
                className="absolute inset-y-0.5 rounded-lg bg-surface-raised shadow-sm transition-[left,width] duration-300 ease-[var(--ease-snappy)]"
                style={{ left: box.left, width: box.width }}
              />
            )}
            {modes.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                data-indicator={value}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`relative h-8 rounded-lg text-[13px] font-medium transition-colors ${mode === value ? 'text-text' : 'text-muted hover:text-text'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-3">
            <label className="block">
              <span className="text-[12px] font-medium text-muted">E-mail</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={input}
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-muted">Senha</span>
              <input
                type="password"
                required
                minLength={10}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={input}
              />
              {mode === 'register' && (
                <span className="mt-1 block text-[11px] text-faint">
                  Pelo menos 10 caracteres. Uma frase é melhor que uma palavra complicada.
                </span>
              )}
            </label>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-1.5 rounded-xl border border-sev-critical/30 bg-sev-critical/8 p-2.5 text-[12px] text-sev-critical"
              >
                <CircleX aria-hidden className="mt-px size-3.5 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className={buttonClass('primary', 'lg', 'w-full')}
            >
              {busy && <LoaderCircle aria-hidden className="animate-spin" />}
              {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <p className="mt-5 border-t border-border pt-4 text-[12px] text-faint">
            Uma conta guarda o SQL que constrói seus schemas. O banco continua descartável.
          </p>
        </div>
      </div>
    </div>
  );
}
