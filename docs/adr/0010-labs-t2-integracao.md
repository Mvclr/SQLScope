# ADR 0010 — Integração dos labs T2: API ↔ sandbox-manager

**Status:** Aceito
**Data:** 2026-09-28

## Contexto

A ADR 0002 definiu o `apps/sandbox-manager` — o serviço que possui os containers T2 — e a
ADR 0009 deixou os labs SECURE no navegador (T0), notando que um lab que precise de rede, de
vários processos ou de um app HTTP vulnerável continuaria esperando o T2. O manager foi
construído e testado, mas nada o usava: a integração com a API ficou para o primeiro lab T2.

O primeiro lab T2 é o **mini-app de SQL injection**, o item que faltava da Fase 3. No T0 o
aluno escreve a consulta inteira e compara a árvore; o conceito (§16) pede outra coisa — o
aluno digita **só no campo de um app**, e é o app que monta o SQL. Isso mostra o ponto real
do ataque (entrada → aplicação → texto SQL → PostgreSQL) e, com privilégio mínimo, mostra a
defesa que o T0 não consegue: o banco recusar o roubo.

## Decisão

### O mini-app roda dentro da API

O app vulnerável é código da API, não um container próprio. Um módulo monta a consulta dos
dois jeitos — concatenando texto e com parâmetro — e a executa no sandbox T2 do aluno. Não há
imagem nova nem sandbox de dois containers; o dano possível continua restrito ao banco
descartável. A função que monta a consulta (`buildSearch`) vive em `packages/labs`, pura, e é
a mesma que a API executa, o teste do pacote roda no PGlite e o navegador mostra ao aluno.

### Uma execução de lab pertence à sessão do navegador

Um `LabRun` reusa o cookie, o `SessionGuard`, as cotas por cliente, o rate limit e o stream
SSE da sessão. No máximo uma execução viva por sessão, e `LAB_RUNS_PER_CLIENT` (padrão 1) por
cliente. A API guarda só o vínculo, numa tabela `lab_runs`, enquanto ele vive; o manager é a
fonte da verdade do sandbox. Uma execução que termina não deixa linha. A senha do role `lab`
nunca vai para o banco da API: vem do manager e fica só em memória, na conexão aberta. O
`requestId` enviado ao manager é o id da linha, então repetir o POST depois de uma falha de
rede é seguro (o manager é idempotente nele).

### Status por polling, entregue por SSE

O manager não tem push. Um `LabRunWatcher` consulta o manager para as execuções vivas (rápido
enquanto na fila ou provisionando, devagar depois) e publica os avisos novos no stream da
sessão: `lab-queued`, `lab-ready`, `lab-ended`. Ao subir, retoma as execuções vivas do banco,
então um processo novo continua o que estava em voo. Ele também encerra a execução quando a
sessão dona deixa de estar ativa — o que ata os dois ciclos sem o código de sessão conhecer
os labs, evitando uma dependência circular.

### O navegador reivindica o sandbox

Ao receber `lab-ready`, o navegador chama `POST /labs/runs/current/claim`, o primeiro
heartbeat (READY → ACTIVE). Assim uma aba abandonada na fila cai pela regra `unclaimed` do
manager (2 min), não pela ociosidade (10 min). Depois, cada chamada de lab manda heartbeat,
no máximo uma vez a cada 30 s, e renova também a sessão T1.

### Limite de tempo sem superusuário

No T2 a API não tem conexão administrativa — não é superuser no sandbox. Cada execução usa
conexões fixas (uma para o console do aluno, outra para o mini-app, para uma transação aberta
no console não engolir as buscas do app). Ao passar do `STATEMENT_TIMEOUT_MS`, a API abre uma
conexão curta como o **mesmo** role `lab` e chama `pg_cancel_backend`, que o PostgreSQL
permite para backends do próprio role. O `query_timeout` do cliente é a segunda barreira.

### Privilégio mínimo é a lição

O seed roda como superuser no init do container e concede ao role `lab` só o que o app de
busca precisa: `select` em `usuarios`. `cartoes` fica fora do alcance. Um passo mostra a
injeção mudando o formato da consulta e o privilégio barrando o dano (`42501`) — a regra de
ouro da ADR 0001: a defesa mora no PostgreSQL, não na limpeza do texto.

### A API entra nas redes dos sandboxes

Para alcançar os bancos T2, o container da API é conectado a cada rede de sandbox
(`SANDBOX_ATTACH_CONTAINERS`). O manager o conecta ao provisionar e o reconecta a cada
passada, porque recriar o container da API — todo deploy — o tira dessas redes. Isso não
afrouxa o isolamento: a rede do sandbox continua interna (sem egress), o Postgres do sandbox
não abre conexões de saída (o role `lab` não é superuser, sem `dblink`/`postgres_fdw`), e um
sandbox não enxerga outro.

### A readiness da API não depende do manager

Com o T2 fora, o T1 continua de pé: a API não checa o manager na readiness e não tem
`depends_on` dele. A falha aparece só ao iniciar um lab, com uma mensagem própria (503).

## Consequências

- **+** O primeiro lab T2 fecha a Fase 3 e prova a arquitetura da ADR 0002 ponta a ponta.
- **+** A lição ganha o que o T0 não tem: um app no meio e o banco recusando o roubo por
  privilégio, não por parsing.
- **+** O `LabRun` reusa toda a maquinaria de sessão; a API não ganha um segundo modelo de
  identidade.
- **−** A API passa a estar nas redes internas dos sandboxes. Mitigado pelo isolamento acima
  e coberto por um teste que prova que um sandbox só é alcançável por quem está anexado.
- **−** O status é por polling, não push, então há uma latência de alguns segundos entre o
  sandbox mudar e o navegador saber. Aceitável para fila e provisionamento.
- **−** Sob `pnpm dev` a API roda no host e não alcança as redes internas dos sandboxes, então
  iniciar um lab T2 exige a API dentro do compose. Documentado.
