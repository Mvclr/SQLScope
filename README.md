# SQLScope

**Build it. Query it. Break it. Secure it.**

Ambiente interativo para construir, visualizar, analisar e proteger bancos de dados relacionais — com SQL executado em PostgreSQL real e isolado, e cada efeito mostrado visualmente.

> **Status:** Fase 0 (fundação) concluída. Próximo: [Fase 1 — playground visual](docs/ROADMAP.md).

## Rodando

Requisitos: Docker e, para desenvolvimento, Node.js ≥ 22.12 com corepack habilitado.

```bash
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:4000/health/ready

### Desenvolvimento

```bash
corepack enable
pnpm install
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres-control postgres-sandbox redis
cp apps/api/.env.example apps/api/.env
pnpm dev
```

| Comando                 | O que faz                                                              |
| ----------------------- | ---------------------------------------------------------------------- |
| `pnpm test`             | Testes unitários (inclui o contrato de engine rodando no PGlite)       |
| `pnpm test:integration` | O mesmo contrato contra PostgreSQL 18 real via Testcontainers (Docker) |
| `pnpm lint`             | ESLint                                                                 |
| `pnpm typecheck`        | TypeScript                                                             |
| `pnpm format`           | Prettier                                                               |

## Estrutura

```
apps/
  api/          NestJS — API pública (health checks, logs estruturados, config validada)
  web/          Next.js — interface
packages/
  core/         SqlExecutor, introspecção, SchemaSnapshot, diff — idêntico em PGlite e PostgreSQL
  sql-parser/   split e classificação de statements com o parser real do PostgreSQL (libpg_query)
infra/          bootstrap do cluster de sandbox (role provisionador não-superuser)
docs/           conceito, arquitetura, roadmap, design e ADRs
```

## Documentação

- [Conceito original](docs/concept.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Design](docs/DESIGN.md)
- Decisões de arquitetura:
  - [0001 — Isolamento em camadas (T0/T1/T2)](docs/adr/0001-isolamento-em-camadas.md)
  - [0002 — Sandbox Manager separado, com reconciliação](docs/adr/0002-sandbox-manager-separado.md)
  - [0003 — Introspecção como fonte da verdade; libpg_query](docs/adr/0003-introspeccao-e-parser.md)
  - [0004 — Histórico como log de eventos](docs/adr/0004-historico-como-log-de-eventos.md)
  - [0005 — HTTP, SSE e WebSocket](docs/adr/0005-transporte-http-sse-ws.md)
  - [0006 — Security Analyzer com regras puras](docs/adr/0006-security-analyzer-regras-puras.md)
  - [0007 — Monorepo e stack](docs/adr/0007-monorepo-e-stack.md)

## Licença

[MIT](LICENSE)
