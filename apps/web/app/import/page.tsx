import type { Metadata } from 'next';
import { ImportWorkspace } from '../../components/build/ImportWorkspace';

export const metadata: Metadata = { title: 'Importar schema' };

export default function ImportPage() {
  return <ImportWorkspace />;
}
