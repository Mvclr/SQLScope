import type { Metadata } from 'next';
import { BuildWorkspace } from '../../components/build/BuildWorkspace';

export const metadata: Metadata = { title: 'Build' };

export default function BuildPage() {
  return <BuildWorkspace />;
}
