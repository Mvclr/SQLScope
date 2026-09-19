# Design

O valor do SQLScope é **ver o que o SQL faz**. O design existe para servir esse momento; tudo o mais é secundário.

## Princípios

1. **O canvas nunca se esconde.** O schema é o diferencial. Ele fica visível ao lado do editor, não numa aba.
2. **Toda mudança é mostrada como mudança.** Nada aparece ou some sem transição. O usuário deve conseguir responder "o que meu comando acabou de fazer?" sem procurar.
3. **Uma linguagem visual para todo o produto.** A mesma severidade, a mesma cor, o mesmo ícone em Analyzer, labs, editor e planos de execução.
4. **Primeiro segundo sem atrito.** Sem login, sem spinner de provisionamento, query já preenchida.
5. **Precisão instrumental.** "Scope" de osciloscópio: interface calma, densa em informação, números alinhados, nada decorativo.

## Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ ◉ SQLScope   Learn · Build · Secure         sessão 14:52 ⏱  [user] │
├──────────────────────────────┬─────────────────────────────────────┤
│ Editor (Monaco)              │                                     │
│                              │         Schema Canvas               │
│                              │                                     │
│               [▶ Run ⌃↵]     │                                     │
├──────────────────────────────┤                                     │
│ Results │ Plan │ History     │                                     │
│                              │                                     │
│  ✓ 14 rows · 8.42 ms         ├─────────────────────────────────────┤
│                              │ Findings (Analyzer) — recolhível    │
└──────────────────────────────┴─────────────────────────────────────┘
```

- Painéis redimensionáveis; proporção persistida por usuário (`localStorage`).
- Modo foco (tela cheia) para editor ou canvas.
- Abaixo de ~900px: canvas vira aba com badge indicando mudanças não vistas.

## Schema canvas

- **Nascimento de tabela:** card surge com escala 0.96→1 e fade, ~200ms.
- **Nova FK:** aresta é _desenhada_ da coluna de origem até a PK de destino (animação de `stroke-dashoffset`), ~350ms, com cardinalidade (`1`, `N`) aparecendo ao final.
- **Coluna adicionada:** entra deslizando dentro do card; o card cresce suavemente.
- **Remoção:** fade + leve contração; arestas dependentes somem antes do card.
- **Halo de delta:** tudo que mudou na última execução recebe contorno na cor de destaque, que decai em ~3s.
- **Posições estáveis:** nó movido pelo usuário nunca é reposicionado automaticamente. elkjs roda apenas para posicionar nós novos no espaço livre. Botão explícito "reorganizar" para layout completo.
- Colunas mostram tipo (mono, apagado) e marcadores `PK`, `FK`, `UQ`, `NN`, `IDX` como badges compactos.
- `prefers-reduced-motion`: transições viram cortes instantâneos, halo permanece (não é movimento).
- Empty state: contorno tracejado de uma tabela fantasma + "Execute um `CREATE TABLE` e ela aparece aqui."

## Resultados

- Virtualizados desde o início.
- Números à direita com `font-variant-numeric: tabular-nums`.
- `NULL` em itálico apagado — visualmente distinto de string vazia (que aparece como `""` apagado).
- Booleanos como `true`/`false` em mono; JSON colapsado e expansível; timestamps com timezone explícito.
- Barra de status: `✓ 14 rows · 8.42 ms` ou `✕ erro na linha 3` com link para a posição no editor.
- Truncamento sempre explícito: "Mostrando 1.000 de ≥1.000 linhas — limite da sessão".

## Cor

Tokens semânticos, nunca cores cruas nos componentes. Tema escuro é o padrão; o claro recebe o mesmo cuidado.

| Token                                    | Papel                                      | Direção                                 |
| ---------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `--structure`                            | Tabelas, arestas, identidade               | Teal / azul-petróleo                    |
| `--accent`                               | Halo de delta, foco, ação primária         | Ciano claro (a "linha do osciloscópio") |
| `--perf-gain`                            | **Exclusivo** para melhoria de performance | Verde                                   |
| `--sev-info`                             | Informação                                 | Azul neutro                             |
| `--sev-warning`                          | Atenção                                    | Âmbar                                   |
| `--sev-high`                             | Problema sério                             | Laranja-avermelhado                     |
| `--sev-critical`                         | Vulnerabilidade / perigo                   | Vermelho                                |
| `--surface-0..3`                         | Fundos em camadas                          | Cinzas frios, quase preto no escuro     |
| `--text`, `--text-muted`, `--text-faint` | Texto                                      |                                         |

Verde não é usado para "sucesso" genérico — sucesso de execução é neutro (✓ em `--text-muted`). Assim, verde carrega significado: _ficou mais rápido_.

## Severidade

Uma escala, usada em todo lugar:

| Nível    | Ícone | Rótulo   |
| -------- | ----- | -------- |
| info     | ○     | INFO     |
| warning  | △     | WARNING  |
| high     | ◆     | HIGH     |
| critical | ⬢     | CRITICAL |

Sempre ícone + rótulo + cor. Cor nunca é o único portador de significado.

## Tipografia

- UI: Inter (fallback `system-ui`).
- Código, tipos de coluna, números em tabelas: JetBrains Mono (fallback `ui-monospace`).
- Escala contida (12 / 13 / 14 / 16 / 20 / 28). Interface densa, sem títulos gigantes fora da landing.

## Labs

Estrutura comum a todos, seguindo o arco do conceito (vulnerável → problema → visualização → explicação → correção):

- Stepper horizontal no topo com os cinco estágios.
- Painel "vulnerável" e "seguro" lado a lado quando aplicável, com o mesmo layout, para o olho comparar diferenças.
- **SQL Injection:** duas ASTs em árvore vertical; nós introduzidos pela injeção destacados em `--sev-critical`. No lado parametrizado, os parâmetros aparecem como slots separados, fora da árvore.
- **Concorrência:** timeline horizontal com uma raia por sessão; passos bloqueados como barra hachurada com seta "esperando por B".
- **Roles:** matriz role × privilégio que atualiza ao vivo após `GRANT`/`REVOKE`, com halo de delta.

## Acessibilidade

- Contraste WCAG AA em ambos os temas.
- Foco visível em tudo; canvas navegável por teclado (setas entre nós, Enter abre detalhes).
- Atalhos: `Ctrl+Enter` executa, `Ctrl+Shift+Enter` executa seleção, `Ctrl+E` EXPLAIN.
- Mudanças no canvas anunciadas em região `aria-live` ("Tabela orders criada; chave estrangeira orders.user_id → users.id").

## Identidade

- Nome: **SQLScope**. Tagline: **Build it. Query it. Break it. Secure it.**
- Marca: um círculo com uma linha de varredura (osciloscópio) — simples, funciona como favicon.
- Landing: o próprio produto rodando, não screenshots. Um replay (ADR 0004) do banco sendo construído em loop.
