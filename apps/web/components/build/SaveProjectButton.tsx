'use client';

import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { AccountError, currentAccount, saveProject } from '../../lib/account';
import { buttonClass } from '../ui/button';
import type { WorkspaceStore } from '../workspace/store';

/**
 * Saves what was run in this session as a project. Only the SQL is stored: reopening it
 * replays the statements into a fresh sandbox.
 */
export function SaveProjectButton({ store }: { store: WorkspaceStore }) {
  const runs = useStore(store, (s) => s.runs);
  const [signedIn, setSignedIn] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void currentAccount().then((account) => setSignedIn(account !== null));
  }, []);

  if (!signedIn || runs.length === 0) return null;

  const save = async () => {
    setMessage(null);
    try {
      // Only what succeeded: replaying a statement that failed would fail again.
      const scripts = runs
        .filter(
          (run) => !run.result.syntaxError && run.result.statements.every((s) => s.status === 'ok'),
        )
        .map((run) => run.sql);
      if (scripts.length === 0) {
        setMessage('Nada para salvar: nenhum script foi executado por inteiro.');
        return;
      }
      await saveProject(name.trim() || 'Sem nome', scripts);
      setMessage('Projeto salvo.');
      setNaming(false);
      setName('');
    } catch (error) {
      setMessage(error instanceof AccountError ? error.message : 'Não foi possível salvar.');
    }
  };

  if (!naming) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setNaming(true)} className={buttonClass('secondary')}>
          <Save aria-hidden />
          Salvar projeto
        </button>
        {message && <span className="text-[12px] text-muted">{message}</span>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex items-center gap-2"
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Nome do projeto"
        aria-label="Nome do projeto"
        maxLength={120}
        className="h-7 w-44 rounded-lg border border-border bg-surface-2 px-2.5 text-[12px] outline-none transition-colors focus:border-accent"
      />
      <button type="submit" className={buttonClass('outline')}>
        <Save aria-hidden />
        Salvar
      </button>
      <button type="button" onClick={() => setNaming(false)} className={buttonClass('ghost')}>
        Cancelar
      </button>
    </form>
  );
}
