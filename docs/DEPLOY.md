# Deploy

Como colocar o SQLScope de pé num servidor. O servidor não compila nada: o
[workflow de release](../.github/workflows/release.yml) publica as imagens no GHCR e o
[`compose.prod.yaml`](../compose.prod.yaml) apenas as baixa.

As imagens são multi-arquitetura (`linux/amd64` e `linux/arm64`), então a mesma tag roda
tanto numa VPS x86 quanto numa instância ARM Ampere. A escolha do provedor não muda nada
aqui além do IP.

## O que o servidor precisa

- Docker Engine com o plugin `compose` (v2.24 ou mais novo — o overlay usa `!reset` e
  `!override`).
- O repositório clonado. Não é para compilar: o `compose.yaml` e os scripts de inicialização
  em `infra/postgres-sandbox/` e `infra/postgres-control/` precisam existir em disco.
- Cerca de 2 GB de RAM para as Fases 1 e 2. O T2 da Fase 3 pede 4 GB: cada sandbox pode usar
  até `T2_MEMORY_MB` (384 MB, com o disco em tmpfs incluído), e até `MAX_ACTIVE_SANDBOXES`
  (4) rodam ao mesmo tempo, então o T2 sozinho chega a 1,5 GB.
- A imagem `postgres:18-alpine` baixada no host. O compose já a baixa para os bancos; o
  sandbox-manager a usa para os sandboxes T2 e não pode baixá-la, porque o socket proxy bloqueia
  a API de imagens.

## Primeiro deploy

### 1. Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. O repositório

```bash
git clone https://github.com/Mvclr/SQLScope.git && cd SQLScope
```

### 3. O `.env`

```bash
cp .env.example .env
```

Depois edite o arquivo. O mínimo a trocar:

- **`SESSION_SECRET`** — obrigatório, e a API se recusa a subir em produção com o valor que
  vem do repositório. Gere com `openssl rand -base64 32`.
- **`SANDBOX_MANAGER_TOKEN`** — obrigatório, gerado do mesmo jeito. Quem tem esse token cria
  containers no host pelo sandbox-manager; a API o apresenta ao manager para os labs T2
  (ADR 0010). O manager e a API recusam em produção o valor do repositório.
- **`CONTROL_DB_PASSWORD`**, **`SANDBOX_SUPERUSER_PASSWORD`**, **`SANDBOX_PROVISIONER_PASSWORD`**,
  **`SANDBOX_MANAGER_DB_PASSWORD`** e **`REDIS_PASSWORD`** — os defaults servem para rodar na sua máquina, não num host público.
- **`SQLSCOPE_VERSION`** — deixe em `edge` para acompanhar a `main`, ou fixe uma tag.

### 4. Acesso às imagens

Pacotes publicados no GHCR nascem privados, mesmo vindo de um repositório público. Escolha um
dos dois:

- **Torná-los públicos** (mais simples): em `github.com/Mvclr?tab=packages`, abra cada um dos
  quatro pacotes — `sqlscope-web`, `sqlscope-api`, `sqlscope-api-migrate` e
  `sqlscope-sandbox-manager` — e mude a visibilidade
  para _public_. Uma vez só; depois o servidor baixa sem autenticar.
- **Autenticar o servidor**: crie um token clássico com escopo `read:packages` e faça
  `echo "$TOKEN" | docker login ghcr.io -u Mvclr --password-stdin`.

### 5. Subir

```bash
docker compose -f compose.yaml -f compose.prod.yaml up --detach --wait
```

O `--wait` só retorna quando os healthchecks passam. O serviço `migrate` aplica as migrações
do Prisma no banco de controle e sai — ele terminar com código 0 é o esperado.

### 6. Conferir

```bash
curl -fsS http://localhost:4000/health/ready
```

A API escuta em `127.0.0.1:4000` de propósito: o único ponto de entrada público é o serviço
web, na porta 80.

## Atualizar

```bash
git pull
docker compose -f compose.yaml -f compose.prod.yaml pull
docker compose -f compose.yaml -f compose.prod.yaml up --detach --wait
```

O `git pull` importa porque o `compose.yaml` e os scripts de inicialização dos clusters moram
no repositório.

### Volumes criados antes do sandbox-manager

Os scripts de `infra/postgres-control/` só rodam quando o volume `control-data` nasce. Num
servidor que já existia antes da Fase 3, o database e o role do sandbox-manager precisam ser
criados uma vez, antes de subir a versão nova:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up --detach postgres-control
```

```bash
docker compose -f compose.yaml -f compose.prod.yaml exec postgres-control sh /docker-entrypoint-initdb.d/01-sandbox-manager.sh
```

O script é idempotente: rodá-lo de novo não muda nada, a não ser a senha do role, que ele
sincroniza com `SANDBOX_MANAGER_DB_PASSWORD`.

## Voltar atrás

Toda build publica uma tag `sha-<7 primeiros caracteres do commit>`. Para voltar, é uma linha
no `.env`:

```bash
SQLSCOPE_VERSION=sha-abc1234
```

E subir de novo. Migração de banco não volta sozinha — se o commit que você está abandonando
tinha migração, confira o que ela fez antes.

## Backup

O único estado que importa é o volume `control-data`: contas, projetos e o log de eventos. O
cluster de sandbox é descartável por design ([ADR 0001](adr/0001-isolamento-em-camadas.md)) e
as imagens se reconstroem do repositório.

```bash
docker compose -f compose.yaml -f compose.prod.yaml exec -T postgres-control \
  pg_dump -U sqlscope sqlscope | gzip > "sqlscope-$(date +%F).sql.gz"
```

## Métricas

O sandbox-manager expõe `/metrics` no formato do Prometheus: sandboxes por status, tamanho
da fila, tempo de provisionamento, falhas, órfãos colhidos e a saúde do loop de
reconciliação. Ele não publica porta, então o scrape precisa vir de um container na rede
`control`. Para olhar à mão:

```bash
docker compose -f compose.yaml -f compose.prod.yaml exec sandbox-manager wget -qO- http://127.0.0.1:4100/metrics
```

## O que ainda falta

- **HTTPS.** Enquanto o site for servido em HTTP puro, `COOKIE_SECURE` fica `false` e o
  cookie de sessão trafega em claro. Colocar um proxy reverso na frente não é só configuração:
  o [`apps/web/middleware.ts`](../apps/web/middleware.ts) apaga o `X-Forwarded-For` do cliente
  porque assume que o navegador chega direto no serviço web. Com um proxy na frente, todos os
  clientes colapsam num único endereço e as cotas por cliente param de funcionar. A mudança
  envolve esse arquivo e o `TRUST_PROXY` da API, e está em aberto.
- **Limites do cluster de sandbox.** `max_connections=300` e `mem_limit: 1g` estão fixos no
  `compose.yaml`. Numa máquina de 2 GB isso é otimista demais.
