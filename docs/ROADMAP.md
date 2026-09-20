# Roadmap

Substitui a seção 36 do [conceito](concept.md). Princípios: isolamento desde o início, algo público cedo, backend presente desde a primeira versão, e cada fase demonstrável por si só.

## Fase 0 — Fundação ✅

- Monorepo (pnpm + Turborepo), tsconfig, lint, formatação.
- `docker compose up` sobe web, api, postgres-controle, postgres-sandbox (T1), redis.
- CI no GitHub Actions: lint, typecheck, testes.
- pino em todos os serviços.
- `packages/core`: `SqlExecutor`, queries de introspecção, `SchemaSnapshot`, `diffSnapshots` — com a mesma suíte de testes rodando contra PGlite e PostgreSQL (Testcontainers).
- `packages/sql-parser`: split e classificação com libpg_query.

**Pronto quando:** CI verde executando a suíte de `core` nas duas engines.

## Fase 1 — v0.1: Playground visual — implementada, falta publicar

- Editor Monaco, `Ctrl+Enter`, erros com posição.
- Tabela de resultados virtualizada com afinidade de tipo.
- Schema canvas (React Flow + elkjs) com animação de diff e posições estáveis.
- **LEARN em T0 (PGlite)**: 2–3 cenários iniciantes com desafios e validação por variantes.
- **BUILD em T1**: sessão anônima via cookie, database por sessão, limites, TTL, execução por HTTP, eventos por SSE.
- Import de schema (DDL colado) em T0.
- Histórico da sessão (log de eventos).
- Rate limit e quota por IP.
- Deploy público em VPS. **Pendente**: depende de um servidor.
- README com GIF do canvas animado. **Pendente**: gravar a partir do deploy.

**Pronto quando:** um visitante anônimo abre o site, aperta Run, e vê a tabela nascer — em T0 e em T1.

## Fase 2 — v0.2: Performance e análise — implementada

- `packages/explain`: plano JSON → árvore tipada, com observações sobre o que pesa nele.
- Painel de plano: tempo real por nó, estimado × real, buffers e o caminho de acesso.
- Comparação antes/depois de índice (mediana de execuções, primeira descartada).
- `packages/security-rules` + Security Analyzer — roda em T0 e T1, com 11 regras.
- Time-travel e replay do histórico; links compartilháveis (SQL no fragmento da URL).
- Autenticação (cookie + argon2id), projetos salvos, sessão anônima assumida no login (ADR 0008).
- Export: DDL, DBML e PNG do diagrama.

**Pronto quando:** dá para medir uma consulta, criar um índice, ver a diferença no plano, e
receber um relatório de segurança do próprio banco.

## Fase 3 — v0.3: Sandbox T2 e primeiros labs SECURE

- `apps/sandbox-manager`: `DockerProvider`, máquina de estados, reconciliação, socket proxy, limite global e fila.
- `/metrics` Prometheus (sandboxes ativos, tempo de provisionamento, falhas, órfãos coletados).
- Teste de caos da reconciliação.
- **Lab SQL Injection** com AST lado a lado (vulnerável × parametrizada) e mini-app HTTP vulnerável.
- **Lab Roles & Permissions** com matriz de privilégios viva e "executar como".
- **Lab Row-Level Security** multi-tenant.
- **Export completo do schema**: políticas RLS, views, sequences, tipos, funções e triggers.
  Hoje o export cobre tabelas, constraints e índices, e reporta o RLS em comentário em vez
  de ligá-lo sem as políticas (que vivem fora do `SchemaSnapshot`). Entra junto do lab de
  RLS, quando as políticas ganharem lugar no snapshot e no diff.
- **Link compartilhado com prévia**: hoje ele reexecuta o SQL assim que a página abre. O
  banco é o PGlite de quem abriu, mas é SQL de estranho rodando sem pergunta; mostrar o
  script e pedir confirmação é a decisão pendente.

## Fase 4 — v1.0: Transações e concorrência

- **Lab Transactions** (atomicidade, falha simulada, rollback).
- **Lab Concorrência** via WS: timeline de sessões, `pg_locks` ao vivo.
- **Isolation levels lado a lado**.
- **Lab Deadlock** com grafo de espera.
- Cenários intermediários e avançados.
- Playwright cobrindo os fluxos principais.

**v1.0** = tudo acima estável, documentado e deployado.

## Depois da v1.0

- Servidor MCP expondo `get_schema`, `get_execution_plan`, `get_security_report`, `execute_safe_query` (sessão T1 read-only).
- OpenTelemetry + Grafana.
- Labs extras: exaustão de connection pool, dados sensíveis (pgcrypto, masking, LGPD), N+1.
- OAuth.
