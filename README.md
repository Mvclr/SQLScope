# SQLScope

**Build it. Query it. Break it. Secure it.**

Ambiente interativo para construir, visualizar, analisar e proteger bancos de dados relacionais — com SQL executado em PostgreSQL real e isolado, e cada efeito mostrado visualmente.

> **Status:** Fases 1 e 2 completas e os labs de segurança da Fase 3 no ar; faltam o sandbox
> T2 e o deploy público. Ver o [roadmap](docs/ROADMAP.md).

## O que dá para fazer

- **Learn**: cenários (loja online, biblioteca) com desafios corrigidos automaticamente. Tudo roda no navegador, com PostgreSQL compilado para WebAssembly (PGlite).
- **Build**: um PostgreSQL 18 só seu no servidor, isolado e descartável. Cada `CREATE`, `ALTER` e FK aparece no diagrama no momento em que é executado.
- **Importar**: cole o DDL de um schema existente e veja tabelas, chaves e relacionamentos.
- **Secure**: três laboratórios guiados no seu navegador, onde você é superusuário — injeção
  de SQL vista pela árvore sintática, roles e privilégios com matriz viva e "executar como",
  e Row-Level Security multi-tenant. Cada passo diz o que vai acontecer, e um teste executa
  os três do início ao fim para garantir que ainda acontece.
- **Medir e comparar**: analise uma consulta, veja o plano de execução com tempo real por nó, crie um índice e compare o antes e o depois.
- **Relatório de segurança**: 11 regras sobre chaves, índices, privilégios e isolamento, cada achado com o que fazer a respeito.
- **Guardar e compartilhar**: histórico com time-travel e replay, link que reconstrói a sessão no navegador de quem abrir, export em SQL, DBML e PNG, e conta para salvar projetos.

## Rodando

Requisitos: Docker e, para desenvolvimento, Node.js ≥ 22.12 com corepack habilitado.

```bash
docker compose up --build
```

- Web: http://localhost:3000 (a única porta pública; o navegador fala com a API por `/api`)
- API: http://localhost:4000/health/ready (só em loopback)

### Desenvolvimento

```bash
corepack enable
pnpm install
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres-control postgres-sandbox redis
cp apps/api/.env.example apps/api/.env
pnpm dev
```

`pnpm dev` aplica as migrations do banco de controle antes de subir a API, então um clone
novo já sobe pronto. Se o `postgres-control` não estiver de pé, o comando falha aí mesmo,
com a mensagem do Prisma, em vez de a API subir e errar a cada varredura do reaper.

| Comando                 | O que faz                                                         |
| ----------------------- | ----------------------------------------------------------------- |
| `pnpm test`             | Testes unitários (inclui o contrato de engine rodando no PGlite)  |
| `pnpm test:integration` | Contrato em PostgreSQL 18 real e API completa, via Testcontainers |
| `pnpm lint`             | ESLint                                                            |
| `pnpm typecheck`        | TypeScript                                                        |
| `pnpm format`           | Prettier                                                          |

## Estrutura

```
apps/
  api/          NestJS — sessões T1, provisionamento, execução, SSE, rate limit, reaper
  web/          Next.js — editor Monaco, resultados, diagrama do schema, Learn/Build/Importar
packages/
  core/         SqlExecutor, introspecção, SchemaSnapshot, diff — idêntico em PGlite e PostgreSQL
  sql-parser/   split e classificação de statements com o parser real do PostgreSQL (libpg_query)
  explain/      plano do EXPLAIN em árvore tipada, com observações sobre onde vai o tempo
  security-rules/ regras determinísticas sobre o schema e seus privilégios
  engine/       runScript: executa scripts e calcula mudanças no schema, igual no navegador e na API
  scenarios/    cenários do Learn como dados, e o validador de respostas por variantes
infra/          bootstrap do cluster de sandbox (role provisionador não-superuser)
patches/        patch do libpg-query para localizar o WASM no navegador
docs/           conceito, arquitetura, roadmap, design e ADRs
```

## Documentação

- [Conceito original](docs/concept.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Design](docs/DESIGN.md)
- [Como contribuir](CONTRIBUTING.md) — convenção de commits (Conventional Commits)
- Decisões de arquitetura:
  - [0001 — Isolamento em camadas (T0/T1/T2)](docs/adr/0001-isolamento-em-camadas.md)
  - [0002 — Sandbox Manager separado, com reconciliação](docs/adr/0002-sandbox-manager-separado.md)
  - [0003 — Introspecção como fonte da verdade; libpg_query](docs/adr/0003-introspeccao-e-parser.md)
  - [0004 — Histórico como log de eventos](docs/adr/0004-historico-como-log-de-eventos.md)
  - [0005 — HTTP, SSE e WebSocket](docs/adr/0005-transporte-http-sse-ws.md)
  - [0006 — Security Analyzer com regras puras](docs/adr/0006-security-analyzer-regras-puras.md)
  - [0007 — Monorepo e stack](docs/adr/0007-monorepo-e-stack.md)
  - [0008 — Contas guardam SQL, não bancos](docs/adr/0008-contas-e-projetos.md)

## Licença

[MIT](LICENSE)
