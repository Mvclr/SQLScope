'use client';

import { CircleX, Equal, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../workspace/context';

/**
 * The parse tree of what the database was asked, next to the tree of what the application
 * meant to ask.
 *
 * This is the whole argument of the injection lab: an injected string does not change a
 * value, it adds nodes. Seeing the two trees side by side makes that a fact on the screen
 * instead of a claim in a paragraph.
 */
interface TreeNode {
  readonly label: string;
  readonly detail: string | null;
  readonly children: readonly TreeNode[];
}

/** libpg_query nodes are one-key objects: `{ SelectStmt: { … } }`. */
function toTree(value: unknown, skip?: string, key?: string): TreeNode[] {
  if (Array.isArray(value)) return value.flatMap((item) => toTree(item));
  if (value === null || typeof value !== 'object') {
    return value === undefined || key === undefined
      ? []
      : [{ label: key, detail: String(value), children: [] }];
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1 && /^[A-Z]/.test(entries[0]![0])) {
    const [name, body] = entries[0]!;
    const summary = summarize(body);
    // Whatever the summary already says is not repeated as a child of its own.
    return [{ label: name, detail: summary?.text ?? null, children: toTree(body, summary?.key) }];
  }

  return entries.flatMap(([name, child]) =>
    isInteresting(name, child) && name !== skip ? toTree(child, undefined, name) : [],
  );
}

/** Keys that carry the shape or the meaning; the rest is parser bookkeeping. */
const INTERESTING = new Set([
  'op',
  'boolop',
  'name',
  'sval',
  'ival',
  'relname',
  'colname',
  'fields',
  'args',
  'lexpr',
  'rexpr',
  'arg',
  'larg',
  'rarg',
  'targetList',
  'fromClause',
  'whereClause',
  'val',
  'number',
  'query',
  'argtypes',
]);

const isInteresting = (name: string, value: unknown) =>
  INTERESTING.has(name) && value !== null && value !== undefined && value !== false;

function summarize(body: unknown): { key: string; text: string } | null {
  if (body === null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['sval', 'ival', 'relname', 'colname', 'boolop', 'op', 'number']) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return { key, text: `${key}: ${value}` };
    }
  }
  return null;
}

async function parse(sql: string): Promise<{ tree: TreeNode[] } | { error: string }> {
  if (sql.trim() === '') return { tree: [] };
  const { loadParser, parseScript } = await import('@sqlscope/sql-parser');
  await loadParser();
  const parsed = parseScript(sql);
  if (!parsed.ok) return { error: parsed.error.message };
  return { tree: parsed.value.flatMap((statement) => toTree(statement.ast)) };
}

/** The shape label of one node — see `shapeOf`. */
function shapeLabel(node: TreeNode): string {
  const operator = node.detail?.startsWith('op:') || node.detail?.startsWith('boolop:');
  return operator ? `${node.label} (${node.detail})` : node.label;
}

function Tree({
  nodes,
  depth = 0,
  injected,
}: {
  nodes: readonly TreeNode[];
  depth?: number;
  /** Shapes the application never wrote: drawn in the critical colour (DESIGN.md › Labs). */
  injected?: ReadonlySet<string> | undefined;
}) {
  return (
    <ul className={depth === 0 ? 'font-mono text-[12px]' : 'border-l border-border pl-3'}>
      {nodes.map((node, index) => {
        const foreign = injected?.has(shapeLabel(node));
        return (
          <li key={`${node.label}-${index}`} className="py-0.5">
            <span
              className={
                foreign
                  ? 'rounded bg-sev-critical/12 px-1 font-semibold text-sev-critical'
                  : depth === 0
                    ? 'text-structure'
                    : 'text-text'
              }
            >
              {node.label}
            </span>
            {node.detail && <span className="ml-2 text-muted">{node.detail}</span>}
            {node.children.length > 0 && (
              <Tree nodes={node.children} depth={depth + 1} injected={injected} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The shape of a tree: node names, plus the operator of the nodes whose operator *is*
 * their shape. `SelectStmt` alone cannot tell a plain query from a UNION.
 */
function shapeOf(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => [shapeLabel(node), ...shapeOf(node.children)]);
}

export function AstPanel({ baseline }: { baseline: string }) {
  const sql = useWorkspace((s) => s.sql);
  const [current, setCurrent] = useState<{ tree: TreeNode[] } | { error: string }>({ tree: [] });
  const [reference, setReference] = useState<TreeNode[]>([]);

  useEffect(() => {
    let active = true;
    void parse(sql).then((result) => active && setCurrent(result));
    return () => {
      active = false;
    };
  }, [sql]);

  useEffect(() => {
    let active = true;
    void parse(baseline).then((result) => {
      if (active && 'tree' in result) setReference(result.tree);
    });
    return () => {
      active = false;
    };
  }, [baseline]);

  const currentShape = 'tree' in current ? shapeOf(current.tree) : [];
  // Only nodes, not the leaf keys under them: `ival` changing is a value, not a shape.
  const added = [
    ...new Set(
      currentShape.filter((label) => /^[A-Z]/.test(label) && !shapeOf(reference).includes(label)),
    ),
  ];
  const parameterized = currentShape.some((label) => label === 'ParamRef');

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-1.5 border-b border-border px-3 py-2 text-[12px]">
        {parameterized ? (
          <>
            <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0 text-perf-gain" />
            <span className="text-perf-gain">
              O valor chega como parâmetro (ParamRef). O que o usuário digitar entra dentro do nó:
              não há texto dele no formato da consulta.
            </span>
          </>
        ) : added.length === 0 ? (
          <>
            <Equal aria-hidden className="mt-px size-3.5 shrink-0 text-faint" />
            <span className="text-muted">
              Mesmo formato da consulta de referência: o que mudou foram os valores.
            </span>
          </>
        ) : (
          <>
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-sev-critical" />
            <span className="text-sev-critical">
              Nós que a aplicação nunca escreveu: {added.join(', ')}
            </span>
          </>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-auto p-2">
        <section className="rounded-xl border border-border bg-surface-2/50 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            O que a aplicação queria
          </h3>
          <Tree nodes={reference} />
        </section>
        <section
          className={`rounded-xl border p-3 transition-colors ${added.length > 0 && !parameterized ? 'border-sev-critical/35 bg-sev-critical/5' : 'border-border bg-surface-2/50'}`}
        >
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            O que o banco recebeu
          </h3>
          {'error' in current ? (
            <p className="flex items-start gap-1.5 text-[12px] text-sev-critical">
              <CircleX aria-hidden className="mt-px size-3.5 shrink-0" />
              {current.error}
            </p>
          ) : (
            <Tree nodes={current.tree} injected={new Set(added)} />
          )}
        </section>
      </div>
    </div>
  );
}
