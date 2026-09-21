# Contribuindo

## Commits: Conventional Commits

Todo commit segue [Conventional Commits 1.0.0](https://www.conventionalcommits.org/pt-br/v1.0.0/).
O formato é o da especificação; o que este arquivo acrescenta são as escolhas do projeto:
tipos, escopos, idioma e o que conta como quebra de contrato.

```
<tipo>[(escopo)][!]: <descrição>

[corpo]

[rodapés]
```

### Tipos

| Tipo       | Quando                                                            | Versão |
| ---------- | ----------------------------------------------------------------- | ------ |
| `feat`     | Funcionalidade nova para quem usa: um lab, um painel, um endpoint | minor  |
| `fix`      | Corrige um comportamento errado                                   | patch  |
| `docs`     | Só documentação: README, ADRs, ROADMAP, comentários               | —      |
| `refactor` | Muda a estrutura sem mudar o comportamento                        | —      |
| `perf`     | Melhora desempenho sem mudar o comportamento                      | patch  |
| `test`     | Só testes: adiciona, corrige ou reorganiza                        | —      |
| `build`    | Build, dependências, pipeline do Turborepo, Dockerfiles, compose  | —      |
| `ci`       | Configuração de integração contínua                               | —      |
| `style`    | Formatação que não muda código (Prettier, espaços)                | —      |
| `chore`    | Manutenção que não se encaixa acima                               | —      |
| `revert`   | Desfaz um commit anterior; o corpo diz qual e por quê             | —      |

Um commit que corrige um bug **e** traz o teste que o reproduz é `fix`, não `test`: o tipo
descreve a mudança para quem usa, e o teste faz parte dela.

### Escopos

O escopo é o pacote ou app afetado. Se a mudança atravessa vários, **omita o escopo** em vez
de listar todos.

| Escopo           | Onde                                                          |
| ---------------- | ------------------------------------------------------------- |
| `core`           | `packages/core`                                               |
| `sql-parser`     | `packages/sql-parser`                                         |
| `engine`         | `packages/engine`                                             |
| `explain`        | `packages/explain`                                            |
| `security-rules` | `packages/security-rules`                                     |
| `scenarios`      | `packages/scenarios`                                          |
| `labs`           | `packages/labs` e o modo Secure                               |
| `api`            | `apps/api`                                                    |
| `web`            | `apps/web`                                                    |
| `infra`          | Docker, compose, deploy                                       |
| `repo`           | Configuração do monorepo (Turborepo, ESLint, TypeScript base) |

### Descrição

- Em português, no imperativo: _adiciona_, _corrige_, _remove_, _permite_.
- Começa em minúscula (nomes próprios e siglas mantêm a grafia: Prisma, RLS, PGlite).
- Sem ponto final.
- A linha inteira (`tipo(escopo): descrição`) tem **no máximo 72 caracteres**.
- Diz o que muda, não como: `fix(labs): permite executar os passos dos labs de novo`, e não
  `fix(labs): adiciona deallocate all no passo 4`.
- Entregas de fase do [roadmap](docs/ROADMAP.md) terminam com a fase entre parênteses:
  `feat(labs): três laboratórios de segurança no navegador (fase 3)`.

### Corpo

Separado da descrição por uma linha em branco, com linhas de até 72 caracteres. Explica o
**porquê**: o problema, a causa e a escolha feita — o diff já mostra o quê. Quando uma
decisão contradiz uma premissa anterior (de um ADR, da arquitetura), o corpo diz qual e
por quê.

### Rodapés

Depois do corpo, separados por uma linha em branco, no formato `Token: valor`, uma linha
cada.

- `BREAKING CHANGE: <o que quebra>` — obrigatório junto do `!` no cabeçalho.
- `Refs: #123` — issue ou PR relacionado.

Commits não levam trailer de coautoria gerado por ferramenta (`Co-Authored-By` de
assistentes de código).

### O que conta como quebra (`!`)

Os pacotes são privados, mas uns dependem dos outros e o formato de alguns dados sai do
repositório. É quebra mudar de forma incompatível:

- tipos ou funções exportados por um pacote e usados por outro;
- a API HTTP de `apps/api`;
- o formato do `SchemaSnapshot` ou dos eventos da sessão (ADR 0004);
- o formato do link compartilhado (`v: 1` em `apps/web/lib/share.ts`) — links já enviados
  deixariam de abrir;
- uma migration que não se aplica sobre o banco de controle existente.

### Exemplos deste repositório

```
feat(core)!: políticas RLS no snapshot, no diff e no export

Quem pode ver quais linhas é schema, não dado: um snapshot sem as
políticas descreve uma tabela que ele não sabe explicar. [...]

BREAKING CHANGE: políticas saem de readPrivileges para TableSnapshot
```

```
build(api): gera o cliente Prisma antes do dev

A tarefa `dev` dependia só de `^build`, então em um clone novo o
`nest start` subia antes de `src/generated/prisma` existir.
```

```
fix(labs): permite executar os passos dos labs de novo
```

### Antes de commitar

```bash
pnpm format
```

```bash
pnpm turbo run lint typecheck test
```
