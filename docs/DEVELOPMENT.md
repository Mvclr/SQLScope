# Desenvolvimento local

Como rodar o SQLScope na sua máquina. Para colocá-lo num servidor, veja o [deploy](DEPLOY.md).

Requisitos: Docker e, para desenvolvimento, Node.js ≥ 22.12 com corepack habilitado.

## Tudo no Docker

Copie `.env.example` para `.env` e defina um `SESSION_SECRET` e um `SANDBOX_MANAGER_TOKEN`
únicos — a API e o sandbox-manager sobem como produção e recusam iniciar com um segredo que
vem no repositório:

```bash
cp .env.example .env
# edite .env e gere os dois, p.ex. openssl rand -base64 32
docker compose up --build
```

- Web: http://localhost:3000 (a única porta pública; o navegador fala com a API por `/api`)
- API: http://localhost:4000/health/ready (só em loopback)

## Com pnpm dev

```bash
corepack enable
pnpm install
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres-control postgres-sandbox redis docker-socket-proxy
cp apps/api/.env.example apps/api/.env
cp apps/sandbox-manager/.env.example apps/sandbox-manager/.env
pnpm dev
```

O volume do `postgres-control` criado antes do sandbox-manager não tem o database dele; crie-o
uma vez com o script de `infra/postgres-control/`, que é idempotente:

```bash
docker compose exec postgres-control sh /docker-entrypoint-initdb.d/01-sandbox-manager.sh
```

Sob `pnpm dev` a API roda no host e não alcança as redes internas dos sandboxes, então
**iniciar um lab T2** (o de injection no servidor) só funciona com a API dentro do compose:
`docker compose up --build`. O resto do app roda normalmente com `pnpm dev`.

`pnpm dev` aplica as migrations do banco de controle antes de subir a API, então um clone
novo já sobe pronto. Se o `postgres-control` não estiver de pé, o comando falha aí mesmo,
com a mensagem do Prisma, em vez de a API subir e errar a cada varredura do reaper.

| Comando                 | O que faz                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`             | Testes unitários (inclui o contrato de engine rodando no PGlite)                                                       |
| `pnpm test:integration` | Contrato em PostgreSQL 18 real, API completa e sandbox-manager contra o Docker (com teste de caos), via Testcontainers |
| `pnpm lint`             | ESLint                                                                                                                 |
| `pnpm typecheck`        | TypeScript                                                                                                             |
| `pnpm format`           | Prettier                                                                                                               |

## Estrutura
