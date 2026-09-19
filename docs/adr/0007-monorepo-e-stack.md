# ADR 0007 — Monorepo e escolhas de stack

**Status:** Aceito
**Data:** 2026-09-18

## Contexto

Projeto pessoal de portfólio, público no GitHub. Prioridades: código legível por quem avalia, setup em um comando, fronteiras de módulo visíveis, e demonstração de backend sólido.

## Decisão

### Estrutura

```
sqlscope/
├── apps/
│   ├── web/               Next.js (App Router)
│   ├── api/               NestJS — API pública, T1, sessões, auth
│   └── sandbox-manager/   Fastify — interno, T2, reconciliação (ADR 0002)
├── packages/
│   ├── core/              SchemaSnapshot, diff, eventos, SqlExecutor, queries de introspecção
│   ├── sql-parser/        wrapper de libpg_query: classificação, split, AST
│   ├── security-rules/    regras puras + RuleRegistry (ADR 0006)
│   ├── explain/           parser de EXPLAIN (FORMAT JSON) → árvore tipada
│   ├── scenarios/         cenários e labs como dados (schema, seed, exercícios, soluções)
│   └── ui/                design tokens e componentes compartilhados
├── infra/                 docker-compose, Dockerfiles, configs do Postgres sandbox
└── docs/
```

### Escolhas

| Área                | Escolha                                                                 | Nota                                                                                         |
| ------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Gerenciador / build | pnpm workspaces + Turborepo                                             |                                                                                              |
| API                 | NestJS como **monólito modular**                                        | Módulos: `sessions`, `execution`, `introspection`, `scenarios`, `analysis`, `auth`, `events` |
| Sandbox Manager     | Fastify                                                                 | Superfície mínima; não precisa de DI                                                         |
| Banco de controle   | PostgreSQL + Prisma                                                     | Prisma **somente** aqui                                                                      |
| Sandboxes           | driver `pg` puro + `pg-cursor`                                          | Nunca ORM                                                                                    |
| Cache / coordenação | Redis                                                                   | TTL, locks, rate limit, fila T2. Não é fonte da verdade                                      |
| Validação           | Zod, schemas compartilhados entre web e api                             |                                                                                              |
| Erros esperados     | `Result<T, E>`                                                          | Erro de SQL do usuário é resultado, não exceção                                              |
| Auth                | Implementação própria: sessão em cookie `httpOnly`, argon2id            | Sessões anônimas antes do login; OAuth depois                                                |
| Testes              | Vitest, Testcontainers, Playwright                                      | Mesma suíte de `core` roda contra PGlite e PostgreSQL                                        |
| Logs                | pino (JSON estruturado) desde o dia 1                                   |                                                                                              |
| Métricas            | `/metrics` Prometheus a partir do sandbox-manager                       | OTel + Grafana depois                                                                        |
| CI                  | GitHub Actions: lint, typecheck, unit, integração (Testcontainers), e2e |                                                                                              |
| Licença             | MIT                                                                     |                                                                                              |

### Frontend

- Server Components para conteúdo estático (catálogo de cenários, explicações); Client Components para editor e canvas.
- Monaco Editor (carregado sob demanda), React Flow + elkjs para layout.
- TanStack Query para estado de servidor; Zustand para estado do canvas; reducer/máquina de estados para o painel de execução.
- Tailwind CSS com tokens definidos em `packages/ui` (ver [DESIGN.md](../DESIGN.md)).

### Versões fixadas na Fase 0 (2026-09)

- **TypeScript 6.0**, não 7: o typescript-eslint ainda exige `<6.1`, e o compilador nativo do TS 7 não expõe a API JS que ele usa.
- **pnpm 11**, não 12: o pnpm 12 é distribuído como binário nativo que o corepack atual não consegue iniciar.
- **PostgreSQL 18** em todo lugar: imagem `postgres:18-alpine`, PGlite 0.5 (PG 18.3) e `libpg-query` 18.
- Dependências de produção fixadas em versões exatas; `minimumReleaseAge` do pnpm ativo contra pacotes publicados há poucas horas.

### Ajustes da Fase 1 (2026-09)

- **`libpg-query` com patch** (`patches/`): o módulo instancia o WASM no import e o localiza relativo à _página_, o que quebra em rotas aninhadas. O patch passa um `locateFile` com `new URL(..., import.meta.url)`, padrão que bundlers entendem. Aplicado só no navegador.
- **Engine carregado sob demanda no web**: componentes client também renderizam no servidor, e importar o engine estaticamente instanciava o WASM do parser durante o SSR. `typeName`/`typeCategory` ficam em `@sqlscope/engine/display`, e o validador de desafios em `@sqlscope/scenarios/check`.
- **`turbopackScopeHoisting: false`**: com scope hoisting (ativo só em build de produção), o Turbopack remove membros do namespace exportado pelo PGlite (padrão `__export` do esbuild), que falha com `instantiateWasm is not a function`. O dev não reproduz.
- **Monaco servido do próprio domínio**: `scripts/copy-monaco.mjs` copia o build AMD para `public/monaco`, sem CDN e sem configurar workers no bundler.
- **Prisma 7** com `@prisma/adapter-pg` sobre o pool criado por `createPool` (que trata o evento `error`), e migrations aplicadas por um serviço `migrate` de execução única.

## Consequências

- **+** `docker compose up` sobe tudo; um avaliador roda o projeto em minutos.
- **+** Fronteiras de pacote tornam a arquitetura legível na árvore de diretórios.
- **+** `core`, `security-rules`, `explain` e `sql-parser` são puros e altamente testáveis.
- **−** Monorepo tem custo inicial de configuração (tsconfig, build de pacotes internos).
