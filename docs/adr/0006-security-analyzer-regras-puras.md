# ADR 0006 — Security Analyzer como regras puras sobre um snapshot

**Status:** Aceito
**Data:** 2026-09-18

## Contexto

O Security Analyzer ([concept.md](../concept.md), seções 21–22) avalia um banco contra um conjunto de regras. Se cada regra consultar o banco por conta própria, a análise faz N round-trips, as regras são difíceis de testar e não podem rodar no navegador.

## Decisão

- Um `AnalysisContext` é montado **uma vez** a partir da introspecção: `SchemaSnapshot` (ADR 0003) + privilégios (`pg_roles`, `information_schema.role_table_grants`, `pg_policies`, `relrowsecurity`).
- Cada regra é uma função pura:

```ts
interface SecurityRule {
  id: string; // 'DB-SEC-004'
  name: string;
  severity: Severity; // 'info' | 'warning' | 'high' | 'critical'
  category: RuleCategory; // 'privileges' | 'isolation' | 'schema' | 'performance'
  check(ctx: AnalysisContext): Finding[];
  recommendation: string;
}
```

- Regras são registradas num `RuleRegistry` (Strategy + Registry). Adicionar regra = adicionar arquivo, sem tocar no motor.
- O pacote `packages/security-rules` não depende de nenhum driver de banco.

## Consequências

- **+** Testes unitários sem banco: fixtures de `AnalysisContext` → findings esperados (snapshot tests).
- **+** Roda no navegador (T0) sobre schemas importados — "cole seu schema, receba um relatório" sem backend.
- **+** Pode ser antecipado no roadmap, já que não depende do Sandbox Manager.
- **−** Regras que dependem de comportamento em tempo de execução (ex.: queries lentas reais) não cabem neste modelo; ficam em um analisador separado de performance, se necessário.
