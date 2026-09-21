import { findLab, labs } from '@sqlscope/labs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LabWorkspace } from '../../../components/secure/LabWorkspace';

interface Props {
  params: Promise<{ lab: string }>;
}

export function generateStaticParams() {
  return labs.map((lab) => ({ lab: lab.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: findLab((await params).lab)?.title ?? 'Lab' };
}

export default async function LabPage({ params }: Props) {
  const { lab } = await params;
  if (!findLab(lab)) notFound();
  return <LabWorkspace labId={lab} />;
}
