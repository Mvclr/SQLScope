import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BuildWorkspace } from '../../components/build/BuildWorkspace';

export const metadata: Metadata = { title: 'Build' };

export default function BuildPage() {
  // BuildWorkspace reads the `projeto` query parameter, which needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-faint">Carregando…</p>}>
      <BuildWorkspace />
    </Suspense>
  );
}
