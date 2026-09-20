import type { Metadata } from 'next';
import { ProjectList } from '../../components/auth/ProjectList';

export const metadata: Metadata = { title: 'Meus projetos' };

export default function ProjectsPage() {
  return <ProjectList />;
}
