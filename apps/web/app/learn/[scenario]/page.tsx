import { findScenario, scenarios } from '@sqlscope/scenarios';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LearnWorkspace } from '../../../components/learn/LearnWorkspace';

interface Props {
  params: Promise<{ scenario: string }>;
}

export function generateStaticParams() {
  return scenarios.map((scenario) => ({ scenario: scenario.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: findScenario((await params).scenario)?.title ?? 'Cenário' };
}

export default async function ScenarioPage({ params }: Props) {
  const { scenario } = await params;
  if (!findScenario(scenario)) notFound();
  return <LearnWorkspace scenarioId={scenario} />;
}
