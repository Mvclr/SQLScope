import { scenarios } from '@sqlscope/scenarios';
import {
  BookOpen,
  Database,
  Globe,
  GraduationCap,
  ListChecks,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import { CatalogCard, CatalogHeader } from '../../components/ui/Catalog';

export const metadata: Metadata = { title: 'Learn' };

const icons: Record<string, LucideIcon> = { 'loja-online': ShoppingCart, biblioteca: BookOpen };

export default function LearnCatalog() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-4 pb-8 pt-2 sm:px-6">
        <CatalogHeader
          icon={GraduationCap}
          title="Cenários"
          where={
            <>
              <Globe aria-hidden className="size-3" />
              PGlite · no seu navegador
            </>
          }
        >
          Cada cenário é um pequeno banco com dados e desafios. Tudo roda no seu navegador — nada é
          enviado a um servidor.
        </CatalogHeader>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {scenarios.map((scenario, i) => (
            <li key={scenario.id}>
              <CatalogCard
                href={`/learn/${scenario.id}`}
                index={i + 1}
                icon={icons[scenario.id] ?? Database}
                level={scenario.level}
                title={scenario.title}
                summary={scenario.summary}
                count={`${scenario.challenges.length} desafios`}
                countIcon={ListChecks}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
