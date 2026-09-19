# ADR 0004 — Histórico de sessão como log de eventos append-only

**Status:** Aceito
**Data:** 2026-09-18

## Contexto

O conceito prevê histórico de alterações, versões de schema e comparação entre versões ([concept.md](../concept.md), seção 11). Construir isso depois sobre um estado mutável exige reconstruir o passado; modelar desde o início como eventos torna essas funções triviais.

## Decisão

Cada sessão possui um log append-only de eventos:

```ts
type SessionEvent =
  | {
      type: 'StatementExecuted';
      seq: number;
      at: string;
      sql: string;
      kind: StatementKind;
      durationMs: number;
      rowCount?: number;
    }
  | { type: 'StatementFailed'; seq: number; at: string; sql: string; error: SqlError }
  | { type: 'SchemaChanged'; seq: number; at: string; changes: SchemaChange[] }
  | { type: 'SnapshotTaken'; seq: number; at: string; snapshot: SchemaSnapshot };
```

- O estado exibido (schema atual, histórico, versões) é uma **projeção** do log.
- `SnapshotTaken` periódico funciona como checkpoint para não reprocessar o log inteiro.
- Não é event sourcing completo: o banco do sandbox continua sendo o estado real; o log é o registro observável do que aconteceu.

## Funcionalidades habilitadas

- **Time-travel**: ver o schema em qualquer ponto da sessão.
- **Diff entre versões** arbitrárias.
- **Replay animado**: reproduzir a construção do banco — ideal para GIFs do README.
- **Links compartilháveis**: o log serializado _é_ a sessão; reabrir = reexecutar em um sandbox novo (T0 ou T1).

## Consequências

- **+** Funcionalidades de histórico saem quase de graça.
- **+** Formato serializável e versionável (campo `version` no envelope).
- **−** Replay reexecuta SQL; comandos não determinísticos (`now()`, `random()`) geram dados diferentes. Aceito: o que se reproduz é a estrutura, não os valores exatos.
