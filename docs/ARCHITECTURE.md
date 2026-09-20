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
POST /sessions/current/execute { sql }          (cookie de sessão assinado)
  │
  ├─ SessionGuard → RateLimitGuard (Redis, por cliente e por sessão)
  ├─ conexão fixa da sessão, serializada entre abas
  └─ engine.runScript(session, sql)
        ├─ sql-parser: divide e classifica (changesCatalog / changesData)
        ├─ session.execute(stmt) → cursor; limite de linhas e bytes; watchdog de tempo
        │     └─ erro de SQL → resultado com posição no script, não exceção HTTP
        ├─ se algo executado pode ter mudado o catálogo:
        │     introspect() → SchemaSnapshot; diffSnapshots(prev, next) → SchemaChange[]
        ├─ log de eventos da sessão (ADR 0004)
        └─ SSE `schema-changed` para as outras abas da sessão
```

No T0 o mesmo `runScript` roda no navegador sobre o PGlite, sem HTTP. A simetria vem das interfaces `SqlExecutor`/`SqlSession` de `packages/core`, e uma suíte de contrato roda os mesmos testes nas duas engines.

## Pacotes

| Pacote                     | Onde roda         | Papel                                                                        |
| -------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `@sqlscope/core`           | navegador e Node  | `SqlSession`, introspecção, `SchemaSnapshot`, diff, adapters `pg` e `pglite` |
| `@sqlscope/sql-parser`     | navegador e Node  | libpg_query: divisão, classificação, conversão de posições                   |
| `@sqlscope/engine`         | navegador e Node  | `runScript`, `analyzeQuery`; `engine/display` para a UI                      |
| `@sqlscope/explain`        | navegador e Node  | plano do `EXPLAIN` em árvore tipada e observações sobre ele                  |
| `@sqlscope/security-rules` | navegador e Node  | regras puras sobre snapshot e privilégios (ADR 0006)                         |
| `@sqlscope/scenarios`      | navegador (e SSR) | cenários como dados; `scenarios/check` valida respostas por variantes        |
| `apps/api`                 | Node              | sessões T1, provisionador, execução, SSE, rate limit, reaper                 |
| `apps/web`                 | navegador e Node  | Next.js: Learn (T0), Build (T1), Importar (T0)                               |

O web só carrega engine, parser e validador **sob demanda**: eles trazem WebAssembly, que não pode ser instanciado durante o SSR e não é necessário para desenhar a página.

## Sessões T1

- Database e role `sbx_<24 hex>` por sessão, criados pelo provisionador não-superuser (ADR 0001).
- Uma conexão fixa por sessão no processo da API. Limite de tempo imposto por watchdog com `pg_cancel_backend`, porque `statement_timeout` pode ser alterado pelo usuário.
- Reaper a cada 30 s: expira sessões ociosas, antigas ou acima da cota de tamanho; refaz destruições que falharam; remove databases e roles `sbx_` sem sessão viva.
- Cookie `httpOnly`, assinado, `SameSite=Lax`. O endereço do cliente nunca é guardado, só um HMAC dele.
- A API é publicada só em loopback. O web é a única entrada pública e o único proxy em que o `X-Forwarded-For` é confiável.

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

## Contas e projetos

Ver ADR 0008. Um projeto guarda **o SQL**, não o banco: reabrir é reexecutar em um sandbox
novo. Links compartilhados levam os mesmos scripts comprimidos no fragmento da URL, que o
navegador não envia ao servidor.

## Módulos da API (NestJS)

| Módulo          | Responsabilidade                                                                |
| --------------- | ------------------------------------------------------------------------------- |
| `sessions`      | Ciclo de vida da sessão, tier, TTL, cookie anônimo                              |
| `execution`     | Executar SQL, analisar consultas (EXPLAIN), relatório de segurança              |
| `introspection` | Snapshot e diff (delegando a `packages/core`)                                   |
| `events`        | Log append-only, projeções, SSE                                                 |
| `scenarios`     | Carregar cenários de `packages/scenarios`, criar templates T1, validar desafios |
| `analysis`      | Montar o contexto de análise e rodar as regras (dentro de `execution`)          |
| `labs`          | Orquestrar labs T2, incluindo o WS de concorrência                              |
| `auth`          | Contas (argon2id), projetos salvos, sessão anônima assumida no login (ADR 0008) |

Dependências entre módulos são explícitas via exports do Nest; nenhum módulo acessa o repositório de outro diretamente.

## Validação de desafios (LEARN)

A query do usuário e a solução de referência são executadas contra **várias variantes do dataset** do cenário. Resultados são comparados como multiconjuntos (ordem ignorada, salvo quando o exercício exige `ORDER BY`). Isso impede respostas com valores fixos e aceita qualquer SQL equivalente.

## Lab de concorrência

- Cenário declarado como dados: sessões nomeadas e uma sequência de passos.
- Cada sessão é uma conexão **fixa** (fora do pool), com timeout agressivo obrigatório.
- Orquestrador executa passos com barreiras; um passo bloqueado é detectado via `pg_stat_activity.wait_event` e `pg_locks`, e exibido como "esperando por sessão X".
- Modo comparação: o mesmo cenário em `READ COMMITTED`, `REPEATABLE READ` e `SERIALIZABLE`, lado a lado.

## Performance / EXPLAIN

- Consultas de leitura: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, executadas de verdade.
- **Qualquer outra instrução recebe só o plano estimado, sem executar.** A ideia original
  era envolver DML em `BEGIN … ROLLBACK`, mas a sessão T1 é uma conexão fixa onde o
  usuário pode já ter uma transação aberta: o `ROLLBACK` desfaria o trabalho dele. Não há
  como detectar isso de forma confiável pelos drivers, então a medição é recusada e a
  interface diz o motivo.
- Comparação antes/depois executa N vezes, descarta a primeira (cache frio) e exibe a
  mediana com os buffers lidos (`shared hit` vs `read`).
- Uma diferença só é apresentada como ganho quando os tempos saem do piso de ruído (1 ms)
  ou quando o **caminho de acesso** muda. Em tabelas pequenas, a razão entre dois tempos de
  microssegundos não significa nada, e afirmar o contrário ensinaria errado.

## Segurança — resumo

Ver ADR 0001 e 0002. Em uma frase: **o controle de segurança é o PostgreSQL e o kernel; a aplicação nunca tenta filtrar SQL.**

Ameaças consideradas: acesso a arquivos/execução via funções de servidor, pivô de rede via FDW/dblink, exaustão de recursos (CPU, disco, conexões, transações abertas), acesso ao banco de controle, escape de container, abuso da demo pública (TTL curto, quota por IP, limite global T2, fila).
