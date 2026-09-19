# Arquitetura

Visão consolidada. As decisões e seus trade-offs estão nos [ADRs](adr/); o conceito original está em [concept.md](concept.md).

## Visão geral

```
                              NAVEGADOR
 ┌─────────────────────────────────────────────────────────────────┐
 │  Next.js                                                        │
 │  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌────────────┐  │
 │  │  Monaco  │  │ Schema Canvas│  │  Results  │  │  Labs UI   │  │
 │  └────┬─────┘  └──────▲───────┘  └─────▲─────┘  └─────┬──────┘  │
 │       │               │ diff           │              │         │
 │  ┌────▼───────────────┴────────────────┴──────┐       │         │
 │  │  packages/core  ·  sql-parser  ·  rules    │       │         │
 │  │  ┌──────────────────────┐                  │       │         │
 │  │  │  T0: PGlite (WASM)   │  LEARN / import  │       │         │
 │  │  └──────────────────────┘                  │       │         │
 │  └────────────────────────────────────────────┘       │         │
 └───────┬───────────────────────▲───────────────────────┼─────────┘
         │ HTTP (comandos)       │ SSE (eventos)         │ WS (concorrência)
 ┌───────▼───────────────────────┴───────────────────────▼─────────┐
 │  apps/api — NestJS (monólito modular, público)                  │
 │  sessions · execution · introspection · scenarios · analysis    │
 │  auth · events                                                  │
 └──┬──────────────┬─────────────────┬───────────────────┬─────────┘
    │ Prisma       │ pg              │ HTTP interno      │
 ┌──▼─────────┐ ┌──▼──────────────┐ ┌▼────────────────┐ ┌▼──────┐
 │ Postgres   │ │ T1: cluster     │ │ sandbox-manager │ │ Redis │
 │ controle   │ │ 1 database por  │ │ Fastify, interno│ └───────┘
 │            │ │ sessão (TEMPLATE)│ │ reconciliação   │
 └────────────┘ └─────────────────┘ └──────┬──────────┘
                                           │ socket proxy (allowlist)
                                    ┌──────▼──────────────────┐
                                    │ T2: containers Postgres │
                                    │ descartáveis, sem egress│
                                    └─────────────────────────┘
```

Três redes Docker separadas: `public` (web ↔ api), `control` (api ↔ postgres-controle, redis, sandbox-manager), `sandbox` (api ↔ T1 e T2; sem gateway para a internet). O banco de controle **não** está na rede `sandbox`.

## Fluxo: executar SQL (T1)

```
POST /sessions/:id/execute { sql }
  │
  ├─ sql-parser.split(sql)         → statements com posição
  ├─ sql-parser.classify(each)     → ddl | dml | read | tx | utility
  ├─ executor.run(stmt)            → cursor, limite de linhas e bytes, timeout
  │     └─ erro de SQL → Result.err (com posição para o Monaco), não exceção
  ├─ se algum DDL:
  │     introspect() → SchemaSnapshot
  │     diffSnapshots(prev, next) → SchemaChange[]
  ├─ append eventos no log da sessão (ADR 0004)
  ├─ publica SchemaChanged via SSE
  └─ responde (streaming NDJSON para resultados grandes)
```

No T0 o fluxo é idêntico, mas `executor` é o PGlite no navegador e não há HTTP. Essa simetria é garantida pela interface `SqlExecutor` em `packages/core`.

## Fluxo: lab T2

```
POST /labs/:labId/start
  → api pede sandbox ao sandbox-manager (ou entra na fila se no limite)
  → sandbox-manager: PENDING → PROVISIONING (container + seed do lab) → READY
  → api recebe connection info (credenciais do role do lab, nunca superuser)
  → SSE notifica READY / posição na fila
  → usuário interage; expiração → EXPIRING → DESTROYING → DESTROYED
  → reconciliador converge qualquer divergência
```

## Módulos da API (NestJS)

| Módulo          | Responsabilidade                                                                |
| --------------- | ------------------------------------------------------------------------------- |
| `sessions`      | Ciclo de vida da sessão, tier, TTL, cookie anônimo                              |
| `execution`     | Executar SQL, EXPLAIN, streaming, limites                                       |
| `introspection` | Snapshot e diff (delegando a `packages/core`)                                   |
| `events`        | Log append-only, projeções, SSE                                                 |
| `scenarios`     | Carregar cenários de `packages/scenarios`, criar templates T1, validar desafios |
| `analysis`      | Montar `AnalysisContext`, rodar `RuleRegistry`                                  |
| `labs`          | Orquestrar labs T2, incluindo o WS de concorrência                              |
| `auth`          | Registro, login, sessão; associação de sessões anônimas                         |

Dependências entre módulos são explícitas via exports do Nest; nenhum módulo acessa o repositório de outro diretamente.

## Validação de desafios (LEARN)

A query do usuário e a solução de referência são executadas contra **várias variantes do dataset** do cenário. Resultados são comparados como multiconjuntos (ordem ignorada, salvo quando o exercício exige `ORDER BY`). Isso impede respostas com valores fixos e aceita qualquer SQL equivalente.

## Lab de concorrência

- Cenário declarado como dados: sessões nomeadas e uma sequência de passos.
- Cada sessão é uma conexão **fixa** (fora do pool), com timeout agressivo obrigatório.
- Orquestrador executa passos com barreiras; um passo bloqueado é detectado via `pg_stat_activity.wait_event` e `pg_locks`, e exibido como "esperando por sessão X".
- Modo comparação: o mesmo cenário em `READ COMMITTED`, `REPEATABLE READ` e `SERIALIZABLE`, lado a lado.

## Performance / EXPLAIN

- Sempre `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.
- DML sob `ANALYZE` roda dentro de `BEGIN … ROLLBACK` — analisar nunca altera dados.
- Comparação antes/depois executa N vezes, descarta a primeira (cache frio) e exibe mediana e buffers lidos (`shared hit` vs `read`). A UI explica que o resultado é indicativo.

## Segurança — resumo

Ver ADR 0001 e 0002. Em uma frase: **o controle de segurança é o PostgreSQL e o kernel; a aplicação nunca tenta filtrar SQL.**

Ameaças consideradas: acesso a arquivos/execução via funções de servidor, pivô de rede via FDW/dblink, exaustão de recursos (CPU, disco, conexões, transações abertas), acesso ao banco de controle, escape de container, abuso da demo pública (TTL curto, quota por IP, limite global T2, fila).
