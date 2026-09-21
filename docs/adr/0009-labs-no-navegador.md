# ADR 0009 — Labs SECURE rodam no navegador (T0)

**Status:** Aceito
**Data:** 2026-09-20

## Contexto

Os labs de segurança ensinam três coisas que exigem poder dentro do banco:

- **Roles e privilégios**: criar roles, conceder, revogar e `set role` para sentir o efeito.
- **Row-Level Security**: ligar RLS, escrever políticas, forçar para o dono.
- **SQL Injection**: comparar a árvore sintática do que a aplicação queria com a do que o banco recebeu — isso não precisa de poder nenhum, mas o lab vive ao lado dos outros.

A sessão T1 (ADR 0001) é deliberadamente fraca: o provisionador cria o role do sandbox com
`nosuperuser nocreatedb nocreaterole noreplication nobypassrls`. Ou seja, **um lab de roles
não roda em T1** — e afrouxar isso significaria dar `CREATEROLE` a estranhos em um cluster
compartilhado, que é exatamente o que a ADR 0001 existe para impedir.

## Decisão

Os labs rodam **só no T0**, no PGlite dentro do navegador, onde o usuário é superusuário do
próprio banco.

- `packages/labs` guarda os labs como dados (setup, passos, SQL, o que observar), no mesmo
  espírito de `packages/scenarios`.
- Cada passo declara o que promete: `refused` (o SQLSTATE em que ele termina, quando o passo
  ensina pela recusa) e `rows` (quantas linhas a última instrução devolve). Um teste executa
  todo lab do setup ao último passo e cobra as duas coisas.
- Três painéis ao vivo, um por lab: a árvore sintática lado a lado, a matriz de privilégios
  lida do catálogo, e as políticas RLS lidas do snapshot.

## Consequências

- O blast radius de um lab é a aba de quem o abriu. Nenhum servidor participa.
- O que o lab ensina é limitado ao que o PGlite implementa. Em particular, **superusuário
  ignora RLS sempre**, com ou sem `FORCE` — então o lab de RLS transfere a posse da tabela
  para uma role comum antes de demonstrar o forçamento, e diz isso em voz alta, porque é
  uma armadilha real em produção.
- Um lab que precise de rede, de vários processos ou de um app HTTP vulnerável (o caso do
  mini-app do lab de injection, e dos labs de concorrência) continua esperando o T2.
- Como o conteúdo é dado e os testes o executam de verdade, um lab que deixe de se comportar
  como o texto promete quebra o build em vez de ensinar errado.
