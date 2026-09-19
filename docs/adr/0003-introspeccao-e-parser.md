# ADR 0003 — Introspecção como fonte da verdade; libpg_query para classificação e AST

**Status:** Aceito
**Data:** 2026-09-18

## Contexto

O schema visualizer precisa saber como o banco está após cada comando. Há duas abordagens:

1. Interpretar o SQL enviado e deduzir o schema resultante.
2. Perguntar ao banco.

A abordagem 1 quebra em `ALTER` complexos, DDL dentro de funções, `ROLLBACK`, `DROP ... CASCADE`, defaults implícitos, e em qualquer coisa que o PostgreSQL faça e o nosso interpretador não conheça.

Ao mesmo tempo, o parse do SQL é útil: decidir se vale reintrospectar, rotular eventos do histórico, e — principalmente — o lab de SQL Injection baseado em AST.

## Decisão

### Introspecção

- Após qualquer statement que o parser marque com `changesCatalog` (DDL, DCL, `ROLLBACK`, blocos opacos como `DO`), o backend lê `pg_catalog` e produz um `SchemaSnapshot` **imutável**.
- `diffSnapshots(prev, next)` produz uma lista tipada de mudanças (`table-created`, `column-renamed`, `constraint-added`, `index-dropped`, ...). Objetos são pareados por identidade de catálogo (oid, `attnum`), não por nome — por isso um rename aparece como rename, e não como drop + create.
- O frontend recebe o diff e anima somente o que mudou.
- Queries de introspecção, o tipo `SchemaSnapshot` e o diff vivem em `packages/core` e rodam idênticos em PGlite (T0) e PostgreSQL (T1/T2) via interface `SqlExecutor`.

### Parser

- `libpg_query` (o parser real do PostgreSQL, compilado para WASM) em `packages/sql-parser`, via pacote npm `libpg-query` na versão 18 — mesma major do PostgreSQL servidor e do PGlite.
- As posições reportadas pelo parser **não** são índices de string JavaScript: limites de statement vêm em bytes UTF-8 e cursores de erro em code points. `packages/sql-parser` converte ambos para índices UTF-16; os testes cobrem texto acentuado e emoji.
- Usos:
  - **Classificação**: DDL / DML / read-only / transação / utilitário, por statement.
  - **Divisão** de scripts em statements com posições (para destacar erros no Monaco).
  - **Lab de SQL Injection**: renderizar a AST da query legítima e da injetada lado a lado, mostrando que a entrada do usuário alterou a estrutura da árvore; e mostrar que com prepared statement a árvore é fixa.
  - **Query visualizer** educacional (fluxo lógico FROM → JOIN → WHERE → GROUP BY → SELECT).
- **Nunca** como controle de segurança (ver ADR 0001).

## Consequências

- **+** O visualizador nunca diverge do banco real.
- **+** Parser fiel ao PostgreSQL, sem gramática aproximada.
- **+** A mesma AST alimenta três funcionalidades distintas.
- **+** Snapshot imutável é a entrada do Security Analyzer (ADR 0006).
- **−** Introspecção custa uma ou mais queries após DDL. Aceitável: DDL é raro comparado a DML/SELECT, e a query de catálogo é rápida.
- **−** Dependência WASM no servidor e no navegador; tamanho do bundle deve ser monitorado (carregar sob demanda no cliente).
