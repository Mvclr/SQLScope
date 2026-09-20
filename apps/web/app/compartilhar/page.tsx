import type { Metadata } from 'next';
import { SharedWorkspace } from '../../components/build/SharedWorkspace';

export const metadata: Metadata = { title: 'Sessão compartilhada' };

export default function SharedPage() {
  return <SharedWorkspace />;
}
