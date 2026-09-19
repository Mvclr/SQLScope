# ADR 0002 — Sandbox Manager como processo separado, com reconciliação

**Status:** Aceito
**Data:** 2026-09-18

## Contexto

O Sandbox Manager precisa falar com a API do Docker para criar containers T2. Acesso ao socket do Docker (`/var/run/docker.sock`) equivale a root no host. Se esse acesso estiver no mesmo processo que atende HTTP público, qualquer vulnerabilidade na API vira comprometimento do host.

Além disso, containers efêmeros vazam: a API reinicia no meio de um provisionamento, o Redis perde uma chave, um `destroy` falha. Sem um mecanismo de convergência, containers órfãos se acumulam.

## Decisão

### Separação de processos

- `apps/sandbox-manager` é um serviço próprio, pequeno (Fastify, sem framework pesado), **não exposto publicamente**.
- API mínima e interna: `POST /sandboxes`, `DELETE /sandboxes/:id`, `GET /sandboxes/:id`. Autenticada com token de serviço.
- Acesso ao Docker via _socket proxy_ com allowlist de endpoints (apenas containers e redes), nunca montando o socket diretamente.
- A API pública (`apps/api`) não tem nenhum acesso ao Docker.

### Porta `SandboxProvider`

```ts
interface SandboxProvider {
  provision(spec: SandboxSpec): Promise<SandboxHandle>;
  destroy(id: SandboxId): Promise<void>; // idempotente
  inspect(id: SandboxId): Promise<SandboxObservedState | null>;
  list(): Promise<SandboxObservedState[]>;
}
```

Implementações: `DatabaseTemplateProvider` (T1, vive na API), `DockerProvider` (T2, vive no sandbox-manager), `InMemoryProvider` (testes). T0 não passa por aqui — roda no navegador.

### Máquina de estados

```
PENDING → PROVISIONING → READY → ACTIVE → EXPIRING → DESTROYING → DESTROYED
              │                                          │
              └──────────────► FAILED ◄──────────────────┘
```

Transições persistidas no banco de controle (fonte da verdade). Redis guarda apenas TTL, locks e contadores — se o Redis for perdido, o sistema se recupera a partir do Postgres.

### Loop de reconciliação

Worker periódico (padrão _controller_ do Kubernetes):

1. Lê estado desejado (banco de controle) e estado observado (`provider.list()`).
2. Container existe sem registro ativo → destrói.
3. Registro ativo sem container → marca `FAILED`.
4. Registro expirado → transiciona para `EXPIRING` → `DESTROYING`.

Todas as operações são idempotentes. Containers recebem labels (`sqlscope.sandbox-id`, `sqlscope.expires-at`) para que a reconciliação funcione mesmo com o banco de controle indisponível.

### Limite global

Número máximo de sandboxes T2 simultâneos configurável. Acima do limite, requisições entram numa fila com posição visível ao usuário. Isso torna a demo pública segura contra custo descontrolado.

## Consequências

- **+** Menor privilégio aplicado à própria arquitetura — tema central do projeto.
- **+** Órfãos convergem automaticamente; o sistema tolera crashes.
- **+** Testável sem Docker via `InMemoryProvider`; teste de caos dedicado (matar container à força e verificar convergência).
- **−** Um serviço a mais para deployar e observar.
- **−** Latência de uma chamada interna extra no provisionamento T2 (irrelevante frente ao boot do container).
