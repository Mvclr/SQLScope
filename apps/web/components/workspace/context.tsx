'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { WorkspaceState, WorkspaceStore } from './store';

const WorkspaceContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider({
  store,
  children,
}: {
  store: WorkspaceStore;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return useStore(store, selector);
}
