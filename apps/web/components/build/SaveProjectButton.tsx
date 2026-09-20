'use client';

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { AccountError, currentAccount, saveProject } from '../../lib/account';
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
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
        >
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
        className="w-44 rounded border border-border bg-surface-2 px-2 py-1 text-[12px]"
      />
      <button
        type="submit"
        className="rounded-md border border-accent px-2.5 py-1 text-[12px] text-accent hover:bg-accent hover:text-surface-0"
      >
        Salvar
      </button>
      <button
        type="button"
        onClick={() => setNaming(false)}
        className="text-[12px] text-muted hover:text-text"
      >
        Cancelar
      </button>
    </form>
  );
}
