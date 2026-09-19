import type { DefElem, Node } from '@pgsql/types';

export type StatementKind = 'read' | 'dml' | 'ddl' | 'dcl' | 'transaction' | 'explain' | 'utility';

export interface Classification {
  /** libpg_query node type, e.g. `SelectStmt`, `AlterTableStmt`. */
  readonly nodeType: string;
  readonly kind: StatementKind;
  /** May change what introspection sees: tables, columns, constraints, indexes, privileges. */
  readonly changesCatalog: boolean;
  /** May insert, update or delete rows. */
  readonly changesData: boolean;
  /** For `EXPLAIN`: the statement being explained. */
  readonly explained?: Classification;
}

/**
 * Classifies a statement by its shape. Used to decide when to re-introspect and how to
 * label history — never as a security control (ADR 0001): a `SELECT` calling a function
 * can still do anything that function does.
 *
 * When in doubt it errs towards "may change": a needless re-introspection costs a few
 * milliseconds, a missed one shows the user a wrong schema.
 */
export function classify(node: Node): Classification {
  const nodeType = Object.keys(node)[0] ?? 'Unknown';
  const is = (kind: StatementKind, changesCatalog: boolean, changesData: boolean) => ({
    nodeType,
    kind,
    changesCatalog,
    changesData,
  });

  if ('SelectStmt' in node) {
    const select = node.SelectStmt;
    if (select.intoClause) return is('ddl', true, true);
    const modifiesInCte = select.withClause?.ctes?.some((cte) => {
      const query = 'CommonTableExpr' in cte ? cte.CommonTableExpr.ctequery : undefined;
      return query !== undefined && classify(query).changesData;
    });
    return modifiesInCte ? is('dml', false, true) : is('read', false, false);
  }

  if ('CopyStmt' in node) {
    return node.CopyStmt.is_from ? is('dml', false, true) : is('read', false, false);
  }

  if ('TransactionStmt' in node) {
    // A rollback can undo uncommitted DDL, so it changes what introspection sees.
    const undoes = rollbackKinds.has(node.TransactionStmt.kind ?? '');
    return is('transaction', undoes, undoes);
  }

  if ('ExplainStmt' in node) {
    const explained = node.ExplainStmt.query ? classify(node.ExplainStmt.query) : undefined;
    // EXPLAIN ANALYZE executes the statement for real.
    const executes = (node.ExplainStmt.options ?? []).some(
      (option) => 'DefElem' in option && isEnabled(option.DefElem, 'analyze'),
    );
    return {
      ...is(
        'explain',
        executes && (explained?.changesCatalog ?? true),
        executes && (explained?.changesData ?? true),
      ),
      ...(explained && { explained }),
    };
  }

  if (dmlNodes.has(nodeType)) return is('dml', false, true);
  if (dclNodes.has(nodeType)) return is('dcl', true, nodeType === 'DropOwnedStmt');
  if (isDdl(nodeType)) return is('ddl', true, true);
  if (inertUtilityNodes.has(nodeType)) return is('utility', false, false);

  // DO blocks, CALL, EXECUTE and anything unrecognised: assume the worst.
  return is('utility', true, true);
}

const rollbackKinds = new Set([
  'TRANS_STMT_ROLLBACK',
  'TRANS_STMT_ROLLBACK_TO',
  'TRANS_STMT_ROLLBACK_PREPARED',
]);

const dmlNodes = new Set([
  'InsertStmt',
  'UpdateStmt',
  'DeleteStmt',
  'MergeStmt',
  'TruncateStmt',
  'RefreshMatViewStmt',
]);

const dclNodes = new Set([
  'GrantStmt',
  'GrantRoleStmt',
  'CreateRoleStmt',
  'AlterRoleStmt',
  'AlterRoleSetStmt',
  'DropRoleStmt',
  'AlterDefaultPrivilegesStmt',
  'CreatePolicyStmt',
  'AlterPolicyStmt',
  'ReassignOwnedStmt',
  'DropOwnedStmt',
]);

const otherDdlNodes = new Set([
  'IndexStmt',
  'ViewStmt',
  'RenameStmt',
  'CommentStmt',
  'DefineStmt',
  'CompositeTypeStmt',
  'RuleStmt',
  'ImportForeignSchemaStmt',
  'SecLabelStmt',
]);

const isDdl = (nodeType: string) =>
  /^(Create|Alter|Drop)/.test(nodeType) || otherDdlNodes.has(nodeType);

/** Utility statements known to leave both catalog and rows untouched. */
const inertUtilityNodes = new Set([
  'VariableSetStmt',
  'VariableShowStmt',
  'ListenStmt',
  'UnlistenStmt',
  'NotifyStmt',
  'PrepareStmt',
  'DeallocateStmt',
  'DiscardStmt',
  'CheckPointStmt',
  'VacuumStmt',
  'LockStmt',
  'DeclareCursorStmt',
  'FetchStmt',
  'ClosePortalStmt',
  'ConstraintsSetStmt',
]);

/** `EXPLAIN (ANALYZE)` and `EXPLAIN ANALYZE` enable it; `(ANALYZE false|off|0)` disables it. */
function isEnabled(option: DefElem, name: string): boolean {
  if (option.defname !== name) return false;
  const arg = option.arg;
  if (!arg) return true;
  if ('String' in arg) return !['false', 'off', 'no', '0'].includes(arg.String.sval ?? '');
  if ('Boolean' in arg) return arg.Boolean.boolval === true;
  if ('Integer' in arg) return (arg.Integer.ival ?? 0) !== 0;
  return true;
}
