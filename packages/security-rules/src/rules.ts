import type { DatabasePrivileges, TableSnapshot } from '@sqlscope/core';
import { qualified, type AnalysisContext, type Finding, type SecurityRule } from './rule.js';

const finding = (
  rule: Pick<SecurityRule, 'id' | 'severity' | 'category'>,
  subject: string,
  detail: string,
): Finding => ({
  ruleId: rule.id,
  severity: rule.severity,
  category: rule.category,
  subject,
  detail,
});

/** Columns whose name says the table belongs to someone. */
const TENANT_COLUMNS = /^(organization|organisation|tenant|account|company|workspace|customer)_id$/;

/** Columns that usually hold a secret. */
const SECRET_COLUMNS =
  /(password|senha|passwd|secret|token|api_?key|private_?key|credit_?card|cartao)/i;

/** Types that store text as given: a secret in one of them was probably not hashed. */
const PLAIN_TEXT = /^(text|character varying|character|citext)/;

const noPrimaryKey: SecurityRule = {
  id: 'DB-SCHEMA-001',
  name: 'Tabela sem chave primária',
  severity: 'warning',
  category: 'schema',
  recommendation:
    'Sem chave primária não há como identificar uma linha: atualizações e exclusões podem atingir mais do que você espera, e ferramentas de replicação recusam a tabela.',
  check: ({ snapshot }) =>
    snapshot.tables
      .filter((table) => !table.constraints.some((c) => c.kind === 'primary key'))
      .map((table) =>
        finding(
          noPrimaryKey,
          qualified(table.schema, table.name),
          'A tabela não tem chave primária.',
        ),
      ),
};

const unindexedForeignKey: SecurityRule = {
  id: 'DB-PERF-001',
  name: 'Chave estrangeira sem índice',
  severity: 'info',
  category: 'performance',
  recommendation:
    'O PostgreSQL cria índice para a chave primária, mas não para a estrangeira. Sem ele, todo DELETE ou UPDATE na tabela referenciada varre esta tabela inteira, e as consultas que navegam pelo relacionamento também.',
  check: ({ snapshot }) =>
    snapshot.tables.flatMap((table) =>
      table.constraints
        .filter((c) => c.kind === 'foreign key' && !hasIndexOn(table, c.columns))
        .map((c) =>
          finding(
            unindexedForeignKey,
            `${qualified(table.schema, table.name)} (${c.columns.join(', ')})`,
            `Nenhum índice começa por ${c.columns.join(', ')}, colunas da chave estrangeira ${c.name}.`,
          ),
        ),
    ),
};

const duplicateIndex: SecurityRule = {
  id: 'DB-PERF-002',
  name: 'Índices redundantes',
  severity: 'info',
  category: 'performance',
  recommendation:
    'Índices com as mesmas colunas iniciais fazem o mesmo trabalho. Cada um custa espaço e torna escritas mais lentas.',
  check: ({ snapshot }) =>
    snapshot.tables.flatMap((table) => {
      const byColumns = new Map<string, string[]>();
      for (const index of table.indexes) {
        const key = index.columns.join(', ');
        byColumns.set(key, [...(byColumns.get(key) ?? []), index.name]);
      }
      return [...byColumns]
        .filter(([, names]) => names.length > 1)
        .map(([columns, names]) =>
          finding(
            duplicateIndex,
            qualified(table.schema, table.name),
            `${names.join(' e ')} indexam as mesmas colunas (${columns}).`,
          ),
        );
    }),
};

const tenantWithoutRls: SecurityRule = {
  id: 'DB-SEC-001',
  name: 'Tabela multi-tenant sem Row-Level Security',
  severity: 'high',
  category: 'isolation',
  recommendation:
    'A coluna de tenant separa os dados apenas se toda consulta lembrar de filtrar por ela. Com RLS, o banco aplica o filtro mesmo quando a aplicação esquece.',
  check: ({ snapshot }) =>
    snapshot.tables
      .filter(
        (table) =>
          table.columns.some((c) => TENANT_COLUMNS.test(c.name)) && !table.rowSecurity.enabled,
      )
      .map((table) =>
        finding(
          tenantWithoutRls,
          qualified(table.schema, table.name),
          `A tabela tem ${table.columns.find((c) => TENANT_COLUMNS.test(c.name))!.name} mas não tem Row-Level Security ativo.`,
        ),
      ),
};

const rlsWithoutPolicy: SecurityRule = {
  id: 'DB-SEC-002',
  name: 'RLS ativo sem nenhuma política',
  severity: 'warning',
  category: 'isolation',
  recommendation:
    'Com RLS ativo e nenhuma política, a tabela fica invisível para todos, menos para o dono — o que costuma aparecer como "a consulta não retorna nada" em produção.',
  // The policies are part of the snapshot, so this answers without reading privileges.
  needsPrivileges: false,
  check: ({ snapshot }) =>
    snapshot.tables
      .filter((table) => table.rowSecurity.enabled && table.policies.length === 0)
      .map((table) =>
        finding(
          rlsWithoutPolicy,
          qualified(table.schema, table.name),
          'Row-Level Security está ativo, mas a tabela não tem nenhuma política.',
        ),
      ),
};

const rlsNotForced: SecurityRule = {
  id: 'DB-SEC-003',
  name: 'RLS não vale para o dono da tabela',
  severity: 'info',
  category: 'isolation',
  recommendation:
    'O dono da tabela ignora as políticas por padrão. Se a aplicação conecta como dono — o caso mais comum —, o RLS não protege nada. FORCE ROW LEVEL SECURITY resolve.',
  check: ({ snapshot }) =>
    snapshot.tables
      .filter((table) => table.rowSecurity.enabled && !table.rowSecurity.forced)
      .map((table) =>
        finding(
          rlsNotForced,
          qualified(table.schema, table.name),
          'RLS está ativo, mas sem FORCE: o dono da tabela continua vendo tudo.',
        ),
      ),
};

const plainTextSecret: SecurityRule = {
  id: 'DB-SEC-004',
  name: 'Coluna sensível em texto',
  severity: 'high',
  category: 'schema',
  recommendation:
    'Senhas devem ser guardadas como hash (argon2, bcrypt), nunca em texto; tokens e chaves devem ser cifrados ou guardados fora do banco.',
  check: ({ snapshot }) =>
    snapshot.tables.flatMap((table) =>
      table.columns
        .filter((c) => SECRET_COLUMNS.test(c.name) && PLAIN_TEXT.test(c.dataType))
        .map((column) =>
          finding(
            plainTextSecret,
            `${qualified(table.schema, table.name)}.${column.name}`,
            `A coluna guarda ${column.dataType}; confirme que o valor não vai em claro.`,
          ),
        ),
    ),
};

const grantedToPublic: SecurityRule = {
  id: 'DB-SEC-005',
  name: 'Tabela liberada para PUBLIC',
  severity: 'critical',
  category: 'privileges',
  recommendation:
    'PUBLIC alcança qualquer role do cluster, inclusive as criadas depois. Conceda a um role específico e siga o menor privilégio.',
  needsPrivileges: true,
  check: ({ privileges }) => {
    const byTable = new Map<string, string[]>();
    for (const grant of privileges!.tableGrants.filter((g) => g.grantee === 'PUBLIC')) {
      const key = qualified(grant.schema, grant.name);
      byTable.set(key, [...(byTable.get(key) ?? []), grant.privilege]);
    }
    return [...byTable].map(([table, privilegesGranted]) =>
      finding(
        grantedToPublic,
        table,
        `PUBLIC tem ${privilegesGranted.sort().join(', ')} na tabela.`,
      ),
    );
  },
};

const writableSchema: SecurityRule = {
  id: 'DB-SEC-006',
  name: 'Schema em que qualquer um pode criar objetos',
  severity: 'high',
  category: 'privileges',
  recommendation:
    'Com CREATE para PUBLIC, qualquer role cria objetos no schema — inclusive funções que substituem as suas no search_path.',
  needsPrivileges: true,
  check: ({ privileges }) =>
    privileges!.schemaGrants
      .filter((g) => g.grantee === 'PUBLIC' && g.privilege === 'CREATE')
      .map((g) => finding(writableSchema, g.schema, 'PUBLIC pode criar objetos neste schema.')),
};

const broadWriteAccess: SecurityRule = {
  id: 'DB-SEC-007',
  name: 'Role com privilégios além do necessário',
  severity: 'warning',
  category: 'privileges',
  recommendation:
    'TRUNCATE e REFERENCES raramente são necessários para uma aplicação. Conceda apenas SELECT, INSERT, UPDATE e DELETE onde forem usados.',
  needsPrivileges: true,
  check: ({ privileges }) => {
    const risky = new Set(['TRUNCATE', 'REFERENCES', 'TRIGGER']);
    const byRole = new Map<string, Set<string>>();
    for (const grant of privileges!.tableGrants) {
      if (grant.grantee === grant.owner || !risky.has(grant.privilege)) continue;
      byRole.set(grant.grantee, (byRole.get(grant.grantee) ?? new Set()).add(grant.privilege));
    }
    return [...byRole].map(([role, privilegesGranted]) =>
      finding(
        broadWriteAccess,
        role,
        `O role tem ${[...privilegesGranted].sort().join(', ')} em tabelas que não são dele.`,
      ),
    );
  },
};

const privilegedLoginRole: SecurityRule = {
  id: 'DB-SEC-008',
  name: 'Role de login com poderes administrativos',
  severity: 'high',
  category: 'privileges',
  recommendation:
    'Um role que a aplicação usa para conectar não deveria criar roles, criar bancos nem ignorar RLS. Separe o role administrativo do role da aplicação.',
  needsPrivileges: true,
  check: ({ privileges }) =>
    privileges!.roles
      .filter((r) => r.canLogin && (r.superuser || r.createRole || r.createDb || r.bypassRls))
      // Roles are cluster-wide: the ones that run the hosting server have nothing to do
      // with this database, and the reader could not change them anyway.
      .filter((r) => involvedInDatabase(r.name, privileges!))
      .map((role) =>
        finding(
          privilegedLoginRole,
          role.name,
          `O role pode conectar e ${[
            role.superuser && 'é superusuário',
            role.createRole && 'cria roles',
            role.createDb && 'cria bancos',
            role.bypassRls && 'ignora RLS',
          ]
            .filter(Boolean)
            .join(', ')}.`,
        ),
      ),
};

/** A role takes part in this database if it owns something here, or was granted something. */
function involvedInDatabase(role: string, privileges: DatabasePrivileges): boolean {
  if (role === privileges.currentRole) return true;
  return [...privileges.tableGrants, ...privileges.schemaGrants].some(
    (grant) => grant.grantee === role || grant.owner === role,
  );
}

/** An index helps a foreign key only when the key columns are its leading columns. */
function hasIndexOn(table: TableSnapshot, columns: readonly string[]): boolean {
  return table.indexes.some((index) => columns.every((column, i) => index.columns[i] === column));
}

export const rules: readonly SecurityRule[] = [
  noPrimaryKey,
  unindexedForeignKey,
  duplicateIndex,
  tenantWithoutRls,
  rlsWithoutPolicy,
  rlsNotForced,
  plainTextSecret,
  grantedToPublic,
  writableSchema,
  broadWriteAccess,
  privilegedLoginRole,
];

export const findRule = (id: string): SecurityRule | undefined => rules.find((r) => r.id === id);

export type { AnalysisContext };
