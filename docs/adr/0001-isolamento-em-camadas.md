# ADR 0001 — Isolamento em camadas (T0 / T1 / T2)

**Status:** Aceito
**Data:** 2026-09-18

## Contexto

O conceito original ([concept.md](../concept.md), seções 25–27) previa um container PostgreSQL por sessão para todo uso, introduzido apenas na Fase 3. Isso tem dois problemas:

1. **Custo e latência.** Cada container consome RAM ociosa considerável e leva segundos para subir. O primeiro contato de um visitante seria um spinner de provisionamento.
2. **Janela sem isolamento.** As Fases 1–2 rodariam SQL arbitrário em banco compartilhado.

Nem todo módulo precisa do mesmo nível de privilégio. Aprender `SELECT` não exige um container; testar `CREATE ROLE` e RLS exige.

## Decisão

Três camadas de isolamento, cada módulo usa a mais barata que satisfaz seu modelo de ameaça:

| Tier   | Mecanismo                                                                                      | Onde roda                      | Módulos                                                           |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| **T0** | PGlite (PostgreSQL compilado para WASM)                                                        | Navegador                      | LEARN, import de schema, Security Analyzer sobre schema importado |
| **T1** | Um _database_ por sessão num cluster compartilhado, clonado com `CREATE DATABASE ... TEMPLATE` | Servidor                       | BUILD, schema visualizer, EXPLAIN, comparação de índices          |
| **T2** | Container PostgreSQL dedicado e descartável                                                    | Servidor (via Sandbox Manager) | Labs SECURE: roles, RLS, transações, concorrência, SQL injection  |

Isolamento existe desde o primeiro commit que executa SQL no servidor — não é uma fase.

### Regras obrigatórias de T1 e T2

- Role da sessão nunca é superuser, nem possui `CREATEROLE`, `CREATEDB`, `pg_read_server_files`, `pg_write_server_files`, `pg_execute_server_program`.
- `statement_timeout`, `lock_timeout` e `idle_in_transaction_session_timeout` definidos no role (`ALTER ROLE ... SET`) **apenas como padrão**: o usuário pode alterá-los com `SET` na própria sessão.
- O limite de tempo que vale é externo: a API cancela com `pg_cancel_backend` (como provisionador, membro do role da sessão) qualquer statement que passe do limite. Ver a correção abaixo.
- Parâmetros que o usuário não pode alterar (`temp_file_limit`, `max_connections`) ficam na configuração do cluster; os que ele pode alterar (`work_mem`) são contidos pelos limites de CPU, memória e PIDs do container.
- `CONNECTION LIMIT` por role.
- Allowlist de extensões. Proibidas: `dblink`, `postgres_fdw`, `file_fdw`, linguagens _untrusted_.
- `REVOKE CONNECT ON DATABASE ... FROM PUBLIC` em todos os databases; cada role só conecta no seu.
- Tamanho do database verificado periodicamente por worker; excedeu a cota → sessão encerrada.
- T2: container sem egress de rede (rede interna sem gateway), limites de CPU/memória/PIDs, filesystem com cota, TTL máximo.

### Correção (Fase 1, 2026-09-19)

A versão original desta ADR dizia que o `statement_timeout` do role era imposto "sem depender de SET do cliente". Isso é falso: `statement_timeout` é um parâmetro de sessão que qualquer role altera (`SET statement_timeout = 0`). Configurá-lo no role define só o padrão. O limite real passou a ser o watchdog da API (`apps/api/src/sandbox/session-connections.ts`), coberto por um teste de integração que roda `SET statement_timeout = 0; SELECT pg_sleep(30)` e exige o cancelamento.

Cada sessão usa também **uma conexão fixa** no processo da API, para que `BEGIN` e `COMMIT` em requisições diferentes cheguem ao mesmo backend. Enquanto isso valer, a API roda em uma única instância; escalar horizontalmente exigirá roteamento por sessão.

### Regra de ouro

**Parsing de SQL nunca é controle de segurança.** O parser (ADR 0003) serve para UX e classificação. A defesa mora no PostgreSQL (privilégios) e no kernel (cgroups, rede).

## Consequências

- **+** Onboarding instantâneo e custo zero para o caminho mais comum (T0).
- **+** T1 cria sessões em milissegundos a partir de templates de cenário.
- **+** Container só é pago quando o lab de fato exige privilégios elevados.
- **+** Narrativa de engenharia mais forte: cada camada é justificada por um modelo de ameaça.
- **−** Duas engines para manter compatíveis (PGlite e PostgreSQL servidor). Mitigação: todo código de introspecção e diff fica em `packages/core` e roda contra uma interface `SqlExecutor` comum; testes executam a mesma suíte nas duas engines.
- **−** PGlite não suporta múltiplas conexões concorrentes — por isso concorrência fica em T2.
- **−** T1 compartilha o processo PostgreSQL entre sessões: um usuário pode degradar performance dos outros (CPU). Aceito para T1; mitigado por timeouts e rate limit.
