# Design

O valor do SQLScope é **ver o que o SQL faz**. O design existe para servir esse momento; tudo o mais é secundário.

## Princípios

1. **O canvas nunca se esconde.** O schema é o diferencial. Ele fica visível ao lado do editor, não numa aba.
2. **Toda mudança é mostrada como mudança.** Nada aparece ou some sem transição. O usuário deve conseguir responder "o que meu comando acabou de fazer?" sem procurar.
3. **Uma linguagem visual para todo o produto.** A mesma severidade, a mesma cor, o mesmo ícone em Analyzer, labs, editor e planos de execução.
4. **Primeiro segundo sem atrito.** Sem login, sem spinner de provisionamento, query já preenchida.
5. **Precisão instrumental.** "Scope" de osciloscópio: interface calma, densa em informação, números alinhados, nada decorativo.
6. **Cada coisa no seu compartimento.** O layout é uma marmita bento: blocos arredondados separados por espaço, não por linhas. Um layout denso fica fácil de ler quando cada parte tem um lugar óbvio.

## Layout

```
 (◉) SQLScope  (Learn|Build|Importar|Secure)            [Entrar]  (☀|☾|▭)
╭──────────────────────────────╮ ╭─────────────────────────────────────╮
│ Desafio / passo do lab       │ │ (Schema · 4 tabelas)  (Reorganizar) │
╰──────────────────────────────╯ │                                     │
╭──────────────────────────────╮ │                                     │
│ Editor (Monaco)              │ │           Schema canvas             │
│ [▶ Executar ⌃↵]      ações   │ │                                     │
╰──────────────────────────────╯ │                                     │
╭──────────────────────────────╮ │                                     │
│ (Resultados|Plano|Análise|…) │ │                                     │
│  ✓ 14 linhas · 8.42 ms       │ │ (+ − ⤢)                             │
╰──────────────────────────────╯ ╰─────────────────────────────────────╯
```

- Cada área é um bloco (ver [Bento](#bento)); o espaço de 8px entre dois blocos é a alça de redimensionar, com um traço que acende no hover.
- Painéis redimensionáveis; proporção persistida por usuário (`localStorage`).
- Modo foco (tela cheia) para editor ou canvas.
- Abaixo de ~900px: canvas vira aba com badge indicando mudanças não vistas.

## Bento

A reformulação da v0.3 troca painéis colados por compartimentos. O objetivo é o mesmo de antes — interface calma e densa —, com a organização visível na forma.

- **Bloco** (`bento` em `globals.css`): raio de 16px, borda de 1px (`--border`), `--elevation-1`. Blocos ficam sobre `--surface-0`, separados por 8px (workspace) ou 12px (páginas). Dentro de um bloco, cartões internos usam raio de 12px e controles, 8px.
- **Bloco clicável** (`bento-link`): sobe 2px e ganha `--elevation-2` no hover; volta no clique.
- **Bloco de destaque** (`bento-accent`): preenchido com `--accent`. **No máximo um por tela** — na home, o Build. Se tudo chama atenção, nada chama.
- **Vidro** (`glass`): só para o que flutua sobre conteúdo — a barra do canvas, os controles de zoom. É o único lugar onde `backdrop-filter` compensa; nos blocos grandes, o efeito de vidro do tema escuro vem de uma borda translúcida e de um brilho no topo (`--sheen`), sem blur.
- **Controles segmentados**: modos no cabeçalho, abas do workspace, tema e entrar/criar conta. O item ativo tem um fundo que _desliza_ até ele (`useSlidingIndicator`), em vez de pular.
- **Ícones com rótulo**: ícones [Lucide](https://lucide.dev), sempre ao lado de um texto (ou com texto para leitor de tela quando a largura esconde o rótulo). Ícone sozinho só em ações universais (fechar, apagar) e sempre com `aria-label`.
- **Estados vazios** (`EmptyState`): ícone num quadrado + uma frase que diz para que o painel serve e como enchê-lo.
- **Microanimações**, todas desligadas por `prefers-reduced-motion`:
  - blocos das páginas entram em sequência (`rise`, 45ms entre um e outro);
  - a troca de tema é um cross-fade (View Transitions), não um corte;
  - botões encolhem 3% ao clicar; setas de "abrir" andam na diagonal no hover;
  - a home mostra o gesto do produto: uma tabela nasce e a FK é desenhada, com as mesmas animações do canvas.

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

Tokens semânticos, nunca cores cruas nos componentes. Dois temas de primeira classe, e quem escolhe é o usuário:

- **Claro — "Clean Light"**: página off-white (`#eef1f5`), blocos brancos, cinzas frios, texto `#0f172a`.
- **Escuro — "Midnight"**: página azul-quase-preto (`#090d16`), blocos um pouco mais claros com bordas translúcidas, e o ciano como neon.

O seletor no cabeçalho oferece Claro, Escuro e Sistema (o padrão). A escolha fica no `localStorage`; o tema em vigor é `data-theme` no `<html>`, aplicado por um script no `<head>` antes da primeira pintura (`lib/theme.ts`), então a página nunca pisca no tema errado. O editor Monaco relê os tokens a cada troca. Outras abas e mudanças do sistema operacional são acompanhadas.

| Token                                    | Papel                                                                             | Direção                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `--structure`                            | Tabelas, arestas, identidade                                                      | Teal / azul-petróleo                                     |
| `--accent`                               | Halo de delta, foco, ação primária, destaque                                      | Ciano: petróleo profundo no claro, neon no escuro        |
| `--on-accent`                            | Texto sobre `--accent`                                                            | Branco no claro, quase preto no escuro                   |
| `--perf-gain`                            | **Exclusivo** para melhoria de performance                                        | Verde                                                    |
| `--sev-info`                             | Informação                                                                        | Azul neutro                                              |
| `--sev-warning`                          | Atenção                                                                           | Âmbar                                                    |
| `--sev-high`                             | Problema sério                                                                    | Laranja-avermelhado                                      |
| `--sev-critical`                         | Vulnerabilidade / perigo                                                          | Vermelho                                                 |
| `--surface-0`                            | A página, sob os blocos                                                           | Off-white / azul-quase-preto                             |
| `--surface-1`                            | O bloco                                                                           | Branco / um degrau acima da página                       |
| `--surface-2..3`, `--surface-raised`     | Dentro do bloco: faixas, chips, hover, trilho e item ativo de controle segmentado |                                                          |
| `--canvas`                               | O fundo do diagrama                                                               | Levemente diferente dos blocos, para as tabelas saltarem |
| `--border`, `--border-strong`            | Contornos finos; translúcidos no escuro                                           |                                                          |
| `--elevation-1..2`                       | Sombra de bloco e de bloco erguido                                                | Suave no claro; profunda + filete de luz no escuro       |
| `--text`, `--text-muted`, `--text-faint` | Texto                                                                             |                                                          |

Todo texto passa WCAG AA (≥ 4,5:1) em todas as superfícies dos dois temas, inclusive `--text-faint` e as cores de severidade.

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
- As duas fontes vêm do próprio servidor (pacotes `@fontsource-variable`), nunca de uma CDN — como o Monaco.
- Escala contida (12 / 13 / 14 / 16 / 20 / 28). Interface densa, sem títulos gigantes fora da landing.

## Labs

Estrutura comum a todos, seguindo o arco do conceito (vulnerável → problema → visualização → explicação → correção):

- Stepper horizontal no topo com os cinco estágios.
- Painel "vulnerável" e "seguro" lado a lado quando aplicável, com o mesmo layout, para o olho comparar diferenças.
- **SQL Injection:** duas ASTs em árvore vertical; nós introduzidos pela injeção destacados em `--sev-critical`. No lado parametrizado, os parâmetros aparecem como slots separados, fora da árvore.
- **Concorrência:** timeline horizontal com uma raia por sessão; passos bloqueados como barra hachurada com seta "esperando por B".
- **Roles:** matriz role × privilégio que atualiza ao vivo após `GRANT`/`REVOKE`, com halo de delta.

## Acessibilidade

- Contraste WCAG AA em ambos os temas (valores conferidos por script ao definir a paleta).
- Foco visível em tudo; canvas navegável por teclado (setas entre nós, Enter abre detalhes).
- Atalhos: `Ctrl+Enter` executa, `Ctrl+Shift+Enter` executa seleção, `Ctrl+E` EXPLAIN.
- Mudanças no canvas anunciadas em região `aria-live` ("Tabela orders criada; chave estrangeira orders.user_id → users.id").

## Identidade

- Nome: **SQLScope**. Tagline: **Build it. Query it. Break it. Secure it.**
- Marca: um círculo com uma linha de varredura (osciloscópio) — simples, funciona como favicon.
- Landing: o próprio produto rodando, não screenshots. Um replay (ADR 0004) do banco sendo construído em loop.
