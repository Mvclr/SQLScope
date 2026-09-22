import { labs, type Lab } from '@sqlscope/labs';
import { scenarios } from '@sqlscope/scenarios';
import { rules } from '@sqlscope/security-rules';
import {
  ArrowUpRight,
  Database,
  FileInput,
  GraduationCap,
  KeyRound,
  Rows3,
  Server,
  ShieldAlert,
  ShieldCheck,
  Syringe,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { riseOrder } from '../components/ui/Catalog';

const labIcons: Record<Lab['panel'], LucideIcon> = {
  ast: Syringe,
  privileges: KeyRound,
  policies: Rows3,
};

/**
 * The landing as a bento box: one compartment per thing SQLScope does. The Build block is
 * the only vibrant one — a real PostgreSQL of your own is the headline.
 *
 * From `lg` up the grid is at least as tall as the viewport, and its auto rows stretch into
 * the free height: on a large screen the blocks grow with it instead of floating in empty
 * space. Type and padding grow only on `spacious` screens (globals.css), where they fit.
 */
export default function Home() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-6xl gap-3 px-4 pb-8 pt-2 sm:px-6 md:grid-cols-2 lg:min-h-full lg:auto-rows-[minmax(152px,auto)] lg:grid-cols-4 xl:max-w-7xl 2xl:max-w-[95rem]">
        <section
          className="bento rise flex flex-col overflow-hidden p-6 md:col-span-2 lg:row-span-2 lg:p-7 spacious:p-10"
          style={riseOrder(0)}
        >
          <p className="font-mono text-[12px] text-structure spacious:text-[13px]">
            Build it. Query it. Break it. Secure it.
          </p>
          <h1 className="mt-3 max-w-md text-[30px] font-semibold leading-[1.1] tracking-tight lg:text-[36px] spacious:mt-4 spacious:max-w-xl spacious:text-[48px]">
            Veja o que o seu SQL realmente faz.
          </h1>
          <p className="mt-4 max-w-md text-muted spacious:mt-5 spacious:max-w-xl spacious:text-[16px]">
            Escreva SQL, execute em PostgreSQL real e acompanhe cada efeito no schema — tabelas
            surgindo, chaves estrangeiras sendo desenhadas, colunas mudando.
          </p>
          <MiniSchema />
        </section>

        <Mode
          href="/build"
          index={1}
          icon={Server}
          title="Build"
          tier="PostgreSQL 18 · servidor isolado"
          featured
          className="md:col-span-2"
        >
          Um banco só seu, descartável. Crie tabelas e veja o diagrama se formar a cada comando.
        </Mode>
        <Mode
          href="/learn"
          index={2}
          icon={GraduationCap}
          title="Learn"
          tier="PGlite · no seu navegador"
          meta={`${scenarios.length} cenários com desafios`}
        >
          Uma loja, uma biblioteca — com desafios corrigidos automaticamente.
        </Mode>
        <Mode
          href="/import"
          index={3}
          icon={FileInput}
          title="Importar"
          tier="PGlite · no seu navegador"
          meta="Cole o DDL, veja o diagrama"
        >
          Visualize tabelas, chaves e relacionamentos de um schema que já existe.
        </Mode>

        <Link
          href="/secure"
          className="bento bento-link rise group flex flex-col p-5 md:col-span-2 spacious:p-7"
          style={riseOrder(4)}
        >
          <ModeIcon icon={ShieldCheck} />
          <div className="mt-auto pt-4">
            <ModeTitle title="Secure" tier="Labs · você é superusuário" />
            <p className="mt-2 text-[13px] text-muted spacious:text-[14px]">
              Quebre e conserte: injeção vista pela árvore sintática, privilégios numa matriz viva e
              isolamento por linha.
            </p>
            <ul className="flex flex-wrap gap-1.5 pt-4">
              {labs.map((lab) => {
                const Icon = labIcons[lab.panel];
                return (
                  <li
                    key={lab.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-[12px] text-muted spacious:px-2.5 spacious:py-1.5 spacious:text-[13px]"
                  >
                    <Icon aria-hidden className="size-3.5 text-structure spacious:size-4" />
                    {lab.title}
                  </li>
                );
              })}
            </ul>
          </div>
        </Link>

        <Stat index={5} icon={ShieldAlert} value={String(rules.length)}>
          regras de segurança sobre chaves, índices, privilégios e isolamento
        </Stat>
        <Stat index={6} icon={Database} value="PG 18">
          PostgreSQL de verdade — no servidor ou compilado para WebAssembly
        </Stat>
      </div>
    </div>
  );
}

/** Top of a mode block: what it is at a glance, and that it opens. */
function ModeIcon({ icon: Icon, featured = false }: { icon: LucideIcon; featured?: boolean }) {
  return (
    <div className="flex items-start justify-between">
      <span
        className={`grid size-10 place-items-center rounded-xl spacious:size-12 ${featured ? 'bg-on-accent/12' : 'border border-border bg-surface-2 text-accent'}`}
      >
        <Icon aria-hidden className="size-5 spacious:size-6" />
      </span>
      <ArrowUpRight
        aria-hidden
        className={`size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 spacious:size-5 ${featured ? '' : 'text-faint'}`}
      />
    </div>
  );
}

function ModeTitle({
  title,
  tier,
  featured = false,
}: {
  title: string;
  tier: string;
  featured?: boolean;
}) {
  return (
    <>
      <h2 className="text-[17px] font-semibold tracking-tight spacious:text-[20px]">{title}</h2>
      <p
        className={`font-mono text-[11px] spacious:text-[12px] ${featured ? 'opacity-75' : 'text-faint'}`}
      >
        {tier}
      </p>
    </>
  );
}

function Mode({
  href,
  index,
  icon,
  title,
  tier,
  meta,
  featured = false,
  className = '',
  children,
}: {
  href: string;
  index: number;
  icon: LucideIcon;
  title: string;
  tier: string;
  meta?: string;
  featured?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${featured ? 'bento-accent' : 'bento'} bento-link rise group flex flex-col p-5 spacious:p-7 ${className}`}
      style={riseOrder(index)}
    >
      <ModeIcon icon={icon} featured={featured} />
      {/* Pinned to the bottom: when the row is taller than the text, the gap sits in the
          middle, as in the stat blocks, instead of under the last line. */}
      <div className="mt-auto pt-4">
        <ModeTitle title={title} tier={tier} featured={featured} />
        <p
          className={`mt-2 text-[13px] spacious:text-[14px] ${featured ? 'opacity-90' : 'text-muted'}`}
        >
          {children}
        </p>
        {meta && <p className="pt-3 text-[12px] text-faint spacious:text-[13px]">{meta}</p>}
      </div>
    </Link>
  );
}

function Stat({
  index,
  icon: Icon,
  value,
  children,
}: {
  index: number;
  icon: LucideIcon;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="bento rise flex flex-col p-5 spacious:p-7" style={riseOrder(index)}>
      <Icon aria-hidden className="size-5 text-faint spacious:size-6" />
      <p className="mt-auto pt-4 text-[30px] font-semibold leading-none tracking-tight tabular-nums spacious:text-[40px]">
        {value}
      </p>
      <p className="mt-1.5 text-[12px] text-muted spacious:mt-2 spacious:text-[13px]">{children}</p>
    </div>
  );
}

/**
 * The product in one gesture: a table is born, then its foreign key is drawn — the same
 * motion the real canvas uses (DESIGN.md › Schema canvas).
 */
function MiniSchema() {
  return (
    <div
      aria-hidden
      className="relative mt-8 flex h-40 select-none items-center justify-center overflow-hidden rounded-xl border border-border bg-canvas bg-[radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:16px_16px] lg:h-auto lg:min-h-40 lg:flex-1 spacious:min-h-48"
    >
      <div className="relative h-[128px] w-[384px] shrink-0 origin-center scale-[0.72] sm:scale-100 xl:scale-110 spacious:scale-[1.3]">
        <MiniTable
          name="users"
          rows={[
            ['id', 'PK'],
            ['email', 'UQ'],
            ['name', 'NN'],
          ]}
          style={{ left: 0, top: 0 }}
        />
        <svg
          className="absolute left-[156px] top-0 h-[128px] w-[72px] overflow-visible"
          viewBox="0 0 72 128"
          fill="none"
        >
          <path
            d="M0 41 C 36 41, 36 95, 72 95"
            pathLength={1}
            className="trace"
            stroke="var(--structure)"
            strokeWidth="1.5"
            style={{ animationDelay: '700ms' }}
          />
        </svg>
        <MiniTable
          name="orders"
          rows={[
            ['id', 'PK'],
            ['user_id', 'FK'],
            ['total', 'NN'],
          ]}
          halo="user_id"
          className="table-born"
          style={{ left: 228, top: 32, animationDelay: '350ms' }}
        />
      </div>
    </div>
  );
}

const miniBadge: Record<string, string> = {
  PK: 'bg-accent/12 text-accent',
  FK: 'bg-structure/12 text-structure',
  UQ: 'bg-sev-info/12 text-sev-info',
  NN: 'bg-surface-3 text-muted',
};

function MiniTable({
  name,
  rows,
  halo,
  className = '',
  style,
}: {
  name: string;
  rows: readonly (readonly [string, string])[];
  halo?: string;
  className?: string;
  style: CSSProperties;
}) {
  return (
    <div
      className={`absolute w-[156px] rounded-xl border border-border bg-surface-1 shadow-[var(--elevation-2)] ${className}`}
      style={style}
    >
      <div className="flex h-[30px] items-center gap-1.5 rounded-t-xl border-b border-border bg-structure-soft px-2.5 font-mono text-[11px] font-semibold">
        <Table2 className="size-3 text-structure" />
        {name}
      </div>
      <ul>
        {rows.map(([column, badge]) => (
          <li
            key={column}
            className={`flex h-[22px] items-center px-2.5 font-mono text-[10px] ${column === halo ? 'column-halo' : ''}`}
          >
            {column}
            <span className={`ml-auto rounded px-1 text-[9px] leading-[14px] ${miniBadge[badge]}`}>
              {badge}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
