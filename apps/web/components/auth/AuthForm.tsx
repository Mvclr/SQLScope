'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AccountError, login, register } from '../../lib/account';

type Mode = 'login' | 'register';

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

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-[20px] font-semibold">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
      <p className="mt-1 text-[13px] text-muted">
        Uma conta serve para guardar seus schemas. O banco continua descartável.
      </p>

      <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-3">
        <label className="block">
          <span className="text-[12px] text-muted">E-mail</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-[14px]"
          />
        </label>
        <label className="block">
          <span className="text-[12px] text-muted">Senha</span>
          <input
            type="password"
            required
            minLength={10}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-[14px]"
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
            className="rounded-md border border-sev-critical/40 bg-sev-critical/10 p-2 text-[12px] text-sev-critical"
          >
            ✕ {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-3 py-2 text-[14px] font-medium text-surface-0 hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
        className="mt-4 text-[13px] text-structure hover:underline"
      >
        {mode === 'login' ? 'Não tenho conta' : 'Já tenho conta'}
      </button>
    </div>
  );
}
