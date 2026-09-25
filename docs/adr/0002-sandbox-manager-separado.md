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
PENDING ─► PROVISIONING ─► READY ─► ACTIVE ─► EXPIRING ─► DESTROYING ─► DESTROYED
   │            │            │         │          ▲                         ▲
   │            └────────────┴─────────┴──────────┘                         │
   │                     liberado ou expirado                               │
   └──────────────────────────── cancelado na fila ─────────────────────────┘

qualquer estado não terminal ─► FAILED
```

O diagrama original só previa FAILED a partir de PROVISIONING e de DESTROYING. As transições
a mais estão explicadas em "Ajustes da implementação", abaixo.

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

## Ajustes da implementação (Fase 3, 2026-09-25)

O `apps/sandbox-manager` implementa a decisão acima. Estes pontos a detalham ou a corrigem:

1. **Estado em database próprio.** `sqlscope_sandboxes`, no mesmo cluster de controle, com o
   role `sqlscope_sandbox_manager`, que só conecta nele. SQL puro com `pg` e um runner de
   migrações de poucas linhas. O único processo com acesso ao Docker não lê contas nem
   sessões.
2. **Fila no Postgres, sem Redis.** A fila são as linhas `PENDING` em ordem de pedido, e a
   posição é um `count(*)`. A admissão conta as vagas e promove a fila numa transação com
   `pg_advisory_xact_lock`, o que continua correto com mais de uma réplica. Esta ADR já dizia
   que o Redis não é fonte da verdade; tirar dele a fila elimina uma dependência sem perder
   nada.
3. **Uma rede interna por sandbox** (`sqlscope-t2-<id>`, `Internal: true`). Um sandbox não
   enxerga outro nem o cluster T1. Os containers de `SANDBOX_ATTACH_CONTAINERS` (a API,
   quando um lab usar T2) são conectados a ela. O pool de endereços padrão do Docker
   comporta cerca de 30 redes bridge, então a config recusa `MAX_ACTIVE_SANDBOXES` acima
   de 20.
4. **Transições além do diagrama original.** Qualquer estado não terminal pode ir para
   `FAILED`: o passo 3 da reconciliação exige isso, porque um registro READY ou ACTIVE sem
   container precisa falhar. `PENDING → DESTROYED` é o pedido cancelado na fila, sem nada a
   destruir. `PROVISIONING → EXPIRING` é o DELETE que chega durante o provisionamento; ele
   vence, e o container é destruído pelo loop.
5. **`POST /sandboxes/:id/heartbeat`**, além das três rotas da decisão. É o que leva
   `READY → ACTIVE` e renova a ociosidade, como no T1. Um sandbox READY que ninguém
   reivindica em `READY_CLAIM_SECONDS` é destruído (`unclaimed`).
6. **Limite honesto do socket proxy.** A allowlist do proxy é por seção da API do Docker.
   Com `CONTAINERS=1` e `POST=1`, um manager comprometido ainda pode criar um container
   `Privileged`. A mitigação é montar a spec do container só a partir de constantes e da
   config, nunca de campos do request, com um teste unitário garantindo que ela não tem
   `Privileged`, `Binds`, `CapAdd` nem rede do host. Os próximos passos, fora do escopo
   desta fase, são Docker rootless ou o runtime gVisor.
7. **Role do lab conforme a ADR 0001.** O role `lab` não é superuser e não tem `CREATEROLE`
   nem `CREATEDB`. O seed roda como superuser durante o init do container, e a senha do
   superuser é aleatória, nunca sai do manager e não é persistida.

Dois detalhes que a decisão deixava abertos:

- **A ordem de leitura do loop** é o Docker primeiro e os registros depois. Como o CAS para
  `PROVISIONING` vem antes da criação do container, todo container listado já tem registro
  vivo quando os registros são lidos; o que não tem é órfão. Um sandbox que ficou READY
  depois de a listagem começar não é julgado por ela.
- **O prazo no label** (`sqlscope.expires-at`) é fixado na admissão: o TTL pedido mais o
  tempo máximo de provisionamento. Com o banco de controle fora, o loop remove só o que
  passou desse prazo.

## Consequências

- **+** Menor privilégio aplicado à própria arquitetura — tema central do projeto.
- **+** Órfãos convergem automaticamente; o sistema tolera crashes.
- **+** Testável sem Docker via `InMemoryProvider`; teste de caos dedicado (matar container à força e verificar convergência).
- **−** Um serviço a mais para deployar e observar.
- **−** Latência de uma chamada interna extra no provisionamento T2 (irrelevante frente ao boot do container).
