import { labs, type Lab } from '@sqlscope/labs';
import {
  Footprints,
  Globe,
  KeyRound,
  Rows3,
  ShieldCheck,
  Syringe,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import { CatalogCard, CatalogHeader } from '../../components/ui/Catalog';

export const metadata: Metadata = { title: 'Secure' };

const icons: Record<Lab['panel'], LucideIcon> = {
  ast: Syringe,
  privileges: KeyRound,
  policies: Rows3,
};

export default function LabCatalog() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-4 pb-8 pt-2 sm:px-6">
        <CatalogHeader
          icon={ShieldCheck}
          title="Laboratórios"
          where={
            <>
              <Globe aria-hidden className="size-3" />
              PGlite · você é superusuário
            </>
          }
        >
          Cada lab é um banco seu, no seu navegador, onde você é superusuário. Crie roles, quebre a
          própria consulta, ligue RLS e veja o que muda — nada aqui toca um servidor.
        </CatalogHeader>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {labs.map((lab, i) => (
            <li key={lab.id}>
              <CatalogCard
                href={`/secure/${lab.id}`}
                index={i + 1}
                icon={icons[lab.panel]}
                level={lab.level}
                title={lab.title}
                summary={lab.summary}
                count={`${lab.steps.length} passos`}
                countIcon={Footprints}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
