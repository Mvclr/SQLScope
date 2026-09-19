# SQLScope

## Plataforma Interativa de Bancos de Dados, SQL e Segurança

**Status:** Conceito / Planejamento inicial  
**Tipo:** Aplicação Web Full Stack  
**Foco:** Bancos de dados relacionais, SQL, segurança, visualização, performance e infraestrutura  
**Stack principal:** TypeScript, React, Next.js, Node.js, PostgreSQL, Redis e Docker

---

# 1. Visão Geral

O **SQLScope** é uma plataforma web interativa para criação, execução, visualização e análise de bancos de dados relacionais.

A proposta é permitir que o usuário não apenas escreva comandos SQL, mas consiga visualizar em tempo real os efeitos de cada operação sobre a estrutura e os dados do banco.

Ao executar comandos como:

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(255)
);
```

o usuário não receberia apenas uma mensagem informando que o comando foi executado com sucesso.

A interface passaria automaticamente a representar visualmente a tabela criada, suas colunas, tipos e relacionamentos.

O projeto combina quatro áreas principais:

1. execução interativa de SQL;
2. visualização de bancos de dados;
3. estudo de performance e funcionamento interno do PostgreSQL;
4. laboratórios interativos de segurança de bancos de dados.

A longo prazo, a aplicação também poderá oferecer integração com agentes de IA através do **Model Context Protocol (MCP)**.

O objetivo não é construir apenas um editor SQL online, mas um ambiente em que seja possível **construir, visualizar, quebrar, analisar, proteger e compreender um banco de dados**.

---

# 2. Problema

Ferramentas tradicionais de banco de dados, como clientes SQL e interfaces administrativas, são excelentes para profissionais experientes, porém normalmente apresentam o banco de maneira predominantemente textual.

Um usuário que executa:

```sql
ALTER TABLE orders
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id)
REFERENCES users(id);
```

precisa entender mentalmente o impacto desse comando.

No SQLScope, essa alteração passaria a ser representada imediatamente:

```text
┌─────────────────┐                ┌─────────────────┐
│ users           │                │ orders          │
├─────────────────┤                ├─────────────────┤
│ id          PK  │◄───────────────│ user_id     FK  │
│ name            │                │ id          PK  │
│ email           │                │ total           │
└─────────────────┘                └─────────────────┘
```

A plataforma procura reduzir a distância entre:

```text
SQL escrito
     ↓
execução do banco
     ↓
estrutura resultante
     ↓
comportamento
     ↓
segurança
     ↓
performance
```

---

# 3. Objetivo Principal

Criar uma plataforma web que permita ao usuário aprender e experimentar SQL e conceitos de banco de dados através de ambientes PostgreSQL temporários e isolados, acompanhando visualmente os efeitos de cada operação.

O projeto também deverá demonstrar conceitos avançados de engenharia de software, incluindo:

- execução segura de código fornecido por usuários;
- isolamento de ambientes;
- gerenciamento de containers;
- comunicação em tempo real;
- autenticação e autorização;
- análise de SQL;
- performance de bancos relacionais;
- concorrência;
- transações;
- segurança;
- observabilidade;
- arquitetura distribuída.

---

# 4. Princípios do Projeto

O desenvolvimento deverá seguir alguns princípios fundamentais.

## 4.1 Execução real

Sempre que possível, o SQL apresentado pelo usuário deverá ser executado em uma instância real de PostgreSQL.

A plataforma não deve simplesmente simular um banco de dados através do frontend.

---

## 4.2 Isolamento

Nenhum comando SQL escrito pelo usuário poderá ser executado contra o banco utilizado internamente pela própria aplicação.

Cada sessão deverá utilizar um ambiente separado.

---

## 4.3 Visualização

A aplicação deverá transformar informações tradicionalmente textuais em representações visuais.

Isso inclui:

- tabelas;
- relacionamentos;
- queries;
- planos de execução;
- permissões;
- transações;
- locks;
- vulnerabilidades.

---

## 4.4 Aprendizado através de experimentação

Em vez de apresentar apenas documentação, a plataforma deverá permitir que o usuário execute ações e observe suas consequências.

---

## 4.5 Progressão técnica

O sistema poderá começar relativamente simples e evoluir progressivamente para conceitos mais complexos.

Isso permitirá que o próprio desenvolvimento do SQLScope acompanhe o aprendizado técnico do desenvolvedor.

---

# 5. Estrutura Principal da Plataforma

A aplicação poderá ser organizada em três grandes modos.

```text
SQLScope
│
├── LEARN
│
├── BUILD
│
└── SECURE
```

Cada modo possui um propósito diferente.

---

# 6. Modo LEARN

O modo **Learn** será responsável pela parte educacional da plataforma.

O usuário poderá estudar SQL através de pequenos ambientes previamente configurados.

Exemplo:

## Cenário: Online Store

Banco inicial:

```text
users
products
orders
order_items
```

O usuário receberá desafios como:

```text
1. Liste todos os clientes.

2. Encontre pedidos acima de R$ 500.

3. Calcule a receita total da loja.

4. Determine o produto mais vendido.

5. Liste os clientes que nunca realizaram pedidos.
```

O usuário poderá executar SQL diretamente sobre aquele banco.

---

# 7. Biblioteca de Cenários

Os exemplos não deverão ser apenas comandos isolados.

Cada cenário deverá representar um pequeno domínio.

### Iniciante

- biblioteca;
- loja;
- escola;
- catálogo de filmes.

### Intermediário

- streaming;
- e-commerce;
- sistema de reservas;
- rede social.

### Avançado

- sistema financeiro;
- plataforma multi-tenant;
- sistema de estoque;
- processamento de pedidos.

Cada ambiente deverá possuir:

- schema;
- dados iniciais;
- exercícios;
- queries de exemplo;
- explicações.

---

# 8. Modo BUILD

O modo **Build** será o principal playground do sistema.

O usuário receberá um banco PostgreSQL temporário e poderá desenvolver livremente sua estrutura.

---

# 9. SQL Editor

A interface deverá possuir um editor semelhante a uma IDE.

Tecnologia sugerida:

**Monaco Editor**.

Exemplo:

```text
┌─────────────────────────────────────────────┐
│ SQL Editor                                  │
├─────────────────────────────────────────────┤
│ SELECT u.name, SUM(o.total)                 │
│ FROM users u                                │
│ JOIN orders o ON o.user_id = u.id          │
│ GROUP BY u.id;                              │
│                                             │
└─────────────────────────────────────────────┘

                   RUN
```

Após a execução:

```text
Status: Success

Execution time: 8.42 ms
Rows returned: 14
```

Abaixo seriam apresentados os resultados.

---

# 10. Schema Visualizer

O SQLScope deverá manter uma representação visual do banco.

Depois de:

```sql
CREATE TABLE users (...);
```

surge:

```text
┌─────────────────┐
│ users           │
├─────────────────┤
│ id          PK  │
│ name            │
│ email           │
└─────────────────┘
```

Depois:

```sql
CREATE TABLE orders (...);
```

surge uma segunda entidade.

Após criar a foreign key:

```text
users 1 ─────────── N orders
```

Tecnologia sugerida:

**React Flow**.

O visualizador deverá compreender:

- tabelas;
- colunas;
- tipos;
- primary keys;
- foreign keys;
- unique constraints;
- indexes;
- relacionamentos.

---

# 11. Histórico de Alterações

Cada comando que modifica o schema poderá gerar um evento.

Exemplo:

```text
10:31:04  CREATE TABLE users
10:32:17  CREATE TABLE orders
10:32:55  ADD FK orders.user_id
10:35:02  CREATE INDEX idx_orders_user
```

Isso permitiria visualizar a evolução do banco.

Uma evolução futura poderia permitir:

```text
Schema Version 1
      ↓
Schema Version 2
      ↓
Schema Version 3
```

e comparar versões.

---

# 12. Query Visualizer

Uma funcionalidade mais avançada será representar visualmente uma consulta.

Considere:

```sql
SELECT u.name, COUNT(o.id)
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.name;
```

O SQLScope poderia transformar isso em:

```text
users
  │
  ├── JOIN
  │
  ▼
orders
  │
  ▼
GROUP BY user.name
  │
  ▼
COUNT(order.id)
  │
  ▼
RESULT
```

O objetivo não é reproduzir perfeitamente o funcionamento interno do PostgreSQL, mas oferecer uma visualização educacional do fluxo lógico da query.

---

# 13. Execution Plan Visualizer

Posteriormente, a aplicação poderá trabalhar diretamente com:

```sql
EXPLAIN
```

e:

```sql
EXPLAIN ANALYZE
```

O resultado poderá ser transformado em um grafo.

Exemplo:

```text
Seq Scan
    │
    ▼
Hash
    │
    ▼
Hash Join
    │
    ▼
Aggregate
```

O usuário poderá visualizar informações como:

```text
Execution Time
3.21 ms

Rows Scanned
10,000

Rows Returned
37

Estimated Cost
24.38
```

---

# 14. Comparação de Performance

Essa funcionalidade permitirá experimentar otimizações reais.

Primeiro:

```sql
SELECT *
FROM orders
WHERE user_id = 42;
```

Resultado:

```text
Sequential Scan

Rows scanned: 100,000
Execution: 15.7 ms
```

Depois:

```sql
CREATE INDEX idx_orders_user_id
ON orders(user_id);
```

Nova execução:

```text
Index Scan

Rows scanned: 318
Execution: 1.9 ms
```

A aplicação poderia apresentar:

```text
BEFORE                    AFTER

Sequential Scan           Index Scan

100,000 rows              318 rows

15.7 ms                   1.9 ms
```

Esse módulo permitirá estudar:

- indexes;
- query optimization;
- sequential scans;
- index scans;
- joins;
- cardinalidade;
- custo estimado.

---

# 15. Modo SECURE

O terceiro grande módulo será o **Security Lab**.

Sua função será demonstrar falhas e mecanismos de proteção relacionados a bancos de dados e aplicações que utilizam bancos relacionais.

Cada laboratório seguirá aproximadamente:

```text
Vulnerable system
       ↓
Problem
       ↓
Visualization
       ↓
Explanation
       ↓
Secure implementation
```

Os ambientes utilizados serão deliberadamente isolados e descartáveis.

---

# 16. Laboratório: SQL Injection

O sistema apresentará inicialmente uma implementação vulnerável.

Exemplo conceitual:

```typescript
const query =
    `SELECT * FROM users WHERE email = '${email}'`;
```

Visualmente:

```text
User Input
    │
    ▼
Application
    │
    ▼
SQL String
    │
    ▼
PostgreSQL
```

A plataforma deverá explicar que dados fornecidos pelo usuário foram incorporados diretamente ao comando SQL.

Depois será apresentada uma implementação segura baseada em parâmetros.

```text
SQL command ─────────┐
                     ├── PostgreSQL
User parameters ─────┘
```

O laboratório deverá enfatizar:

- input não confiável;
- prepared statements;
- parameterized queries;
- separação entre comando e dados.

---

# 17. Laboratório: Roles e Permissions

Será possível criar diferentes usuários de banco.

Por exemplo:

```text
admin
developer
analyst
application
```

Visualização:

| Role | SELECT | INSERT | UPDATE | DELETE | DROP |
|---|---|---|---|---|---|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| developer | ✓ | ✓ | ✓ | ✓ | ✗ |
| analyst | ✓ | ✗ | ✗ | ✗ | ✗ |
| application | ✓ | ✓ | ✓ | ✗ | ✗ |

O usuário poderá executar comandos assumindo diferentes roles.

Isso permitirá estudar:

- GRANT;
- REVOKE;
- database roles;
- least privilege;
- separação de responsabilidades.

---

# 18. Laboratório: Row-Level Security

Esse módulo será especialmente importante por sua relação com sistemas multi-tenant.

Exemplo:

```text
documents

id
organization_id
content
```

Banco:

```text
organization A → document 1
organization A → document 2
organization B → document 3
organization B → document 4
```

Sem RLS:

```sql
SELECT * FROM documents;
```

pode expor dados das duas organizações.

Com políticas adequadas:

```text
Tenant A
   │
   ▼
Row-Level Security
   │
   ├── A ✓
   ├── A ✓
   ├── B ✗
   └── B ✗
```

Esse laboratório permitirá estudar:

- multi-tenancy;
- RLS;
- políticas;
- isolamento de dados;
- autorização no nível do banco.

---

# 19. Laboratório: Transactions

O usuário poderá visualizar uma transferência financeira.

Estado inicial:

```text
Account A = 1000
Account B = 500
```

Operação:

```text
A - 100

SYSTEM FAILURE

B + 100
```

Sem transação adequada:

```text
Account A = 900
Account B = 500
```

Com transação:

```sql
BEGIN;

...

COMMIT;
```

ou:

```sql
ROLLBACK;
```

O sistema poderá representar visualmente:

```text
BEGIN
  │
  ├── operation A
  │
  ├── operation B
  │
  ▼
COMMIT
```

Esse laboratório introduzirá:

- atomicidade;
- commit;
- rollback;
- consistência.

---

# 20. Laboratório: Concorrência

Dois usuários tentam comprar o último item.

```text
User A                 User B

READ stock = 1         READ stock = 1

BUY                     BUY

stock = 0              stock = 0
```

O sistema poderá demonstrar situações envolvendo:

- race conditions;
- locks;
- transaction isolation;
- lost updates;
- concorrência.

Uma visualização temporal poderá mostrar exatamente quando cada operação ocorreu.

---

# 21. Security Analyzer

Além dos laboratórios educacionais, o sistema poderá possuir uma ferramenta automática:

**Analyze Database**

Exemplo de resultado:

```text
DATABASE SECURITY REPORT

PASS
Primary keys configured

PASS
Foreign keys configured

WARNING
Application role has excessive privileges

WARNING
No Row-Level Security found for multi-tenant table

HIGH
Sensitive table accessible by public role

INFO
Possible missing index on foreign key
```

Cada regra poderá possuir uma estrutura como:

```text
Rule ID
DB-SEC-004

Name
Overprivileged Application Role

Severity
HIGH

Description
Application role has permissions not required
for normal operation.

Recommendation
Apply the principle of least privilege.
```

---

# 22. Sistema de Regras

Inicialmente, o Security Analyzer não precisa utilizar IA.

Pode existir um mecanismo determinístico.

Exemplo conceitual:

```text
SecurityRule

id
name
severity
description
check()
recommendation
```

Isso tornará o sistema:

- previsível;
- testável;
- extensível.

Posteriormente, IA poderá complementar as explicações.

---

# 23. Arquitetura Geral

Uma possível arquitetura inicial:

```text
                           CLIENT

                    Next.js / React
                           │
              ┌────────────┼────────────┐
              │            │            │
          SQL Editor    Schema View   Security UI
              │            │            │
              └────────────┼────────────┘
                           │
                       WebSocket
                           │
                           ▼
                    APPLICATION API

                       Node.js
                       NestJS
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    Query Engine     Security Engine   Session Manager
          │                                 │
          └────────────────┬────────────────┘
                           │
                           ▼
                    Sandbox Manager
                           │
                ┌──────────┴──────────┐
                │                     │
                ▼                     ▼
        PostgreSQL Sandbox     PostgreSQL Sandbox
              User A                 User B
```

---

# 24. Banco Principal da Aplicação

A aplicação terá seu próprio PostgreSQL.

Esse banco deverá armazenar apenas informações do SQLScope, por exemplo:

```text
users
sessions
lessons
challenges
saved_projects
security_rules
execution_history
```

Ele nunca deverá ser utilizado para executar SQL arbitrário enviado pelo usuário.

---

# 25. Sandbox de Banco de Dados

Esse é um dos componentes tecnicamente mais importantes do projeto.

Cada usuário deverá executar seus comandos dentro de um ambiente controlado.

Modelo conceitual:

```text
User
  │
  ▼
SQLScope API
  │
  ▼
Sandbox Manager
  │
  ▼
Disposable PostgreSQL
```

Quando a sessão terminar:

```text
PostgreSQL Container
        │
        ▼
     Destroy
```

---

# 26. Restrições do Sandbox

Os ambientes deverão possuir restrições.

Por exemplo:

```text
CPU limit

Memory limit

Storage limit

Execution timeout

Network isolation

Non-superuser database role

Maximum session duration
```

O usuário não deverá conseguir acessar:

- banco principal;
- serviços internos;
- containers de outros usuários;
- filesystem do host;
- rede interna desnecessária.

---

# 27. Docker

Docker será uma das tecnologias centrais do projeto.

O desenvolvimento poderá começar com:

```text
Docker Compose

sqlscope-api
sqlscope-web
postgres-main
redis
```

Posteriormente:

```text
Sandbox Manager
     │
     ├── postgres-session-A
     ├── postgres-session-B
     └── postgres-session-C
```

Isso transforma Docker em parte da arquitetura do produto, e não apenas em uma ferramenta usada para rodar o projeto.

---

# 28. Redis

Redis poderá ser utilizado para:

- gerenciamento de sessões temporárias;
- controle de sandbox;
- rate limiting;
- cache;
- jobs;
- locks distribuídos;
- comunicação com workers.

Exemplo:

```text
sandbox:user:128
    status = ACTIVE
    container = sqlscope-db-8812
    expires = 19:32
```

---

# 29. Comunicação em Tempo Real

WebSockets poderão manter a interface sincronizada com o ambiente.

Exemplo:

```text
SQL executed
      │
      ▼
Backend
      │
      ├── execution result
      ├── schema changed
      └── metrics
              │
              ▼
          WebSocket
              │
              ▼
           Browser
```

Assim, alterações no banco poderão ser refletidas imediatamente no:

- schema visualizer;
- histórico;
- métricas;
- security analyzer.

---

# 30. Autenticação

Inicialmente:

```text
Email + Password
```

Posteriormente:

```text
OAuth
```

A autorização poderá possuir níveis como:

```text
Anonymous
Registered User
Administrator
```

O sandbox deve continuar separado da identidade utilizada internamente pela aplicação.

---

# 31. Stack Tecnológica

## Frontend

- TypeScript
- React
- Next.js
- Tailwind CSS
- Monaco Editor
- React Flow

## Backend

- TypeScript
- Node.js
- NestJS

## Dados

- PostgreSQL
- Prisma ORM
- Redis

## Real-time

- WebSockets

## Infraestrutura

- Docker
- Docker Compose
- Nginx
- GitHub Actions

## Cloud

Posteriormente:

- AWS ou outro provedor compatível com containers.

---

# 32. Testes

O projeto deverá possuir diferentes níveis de testes.

## Unit

Para:

- parser;
- security rules;
- validações;
- serviços.

## Integration

Para:

- PostgreSQL;
- Redis;
- Query Engine;
- Sandbox Manager.

## End-to-End

Exemplo:

```text
Create session
      ↓
Create table
      ↓
Execute INSERT
      ↓
Execute SELECT
      ↓
Verify response
      ↓
Destroy sandbox
```

Ferramentas possíveis:

- Jest;
- Supertest;
- Playwright.

---

# 33. Observabilidade

Em uma fase posterior, o sistema poderá adicionar:

- structured logging;
- metrics;
- tracing.

Tecnologias:

```text
OpenTelemetry
Prometheus
Grafana
```

Exemplos de métricas:

```text
active_sandboxes

queries_executed

query_execution_time

sandbox_creation_time

failed_queries

security_scans

sandbox_memory_usage
```

---

# 34. MCP

MCP deverá ser tratado como uma evolução do projeto, e não como o objetivo principal.

O SQLScope poderá expor tools como:

```text
get_schema()

get_table_info()

explain_query()

get_execution_plan()

get_security_report()

execute_safe_query()
```

Um agente poderia perguntar:

```text
Why is this query slow?
```

Fluxo:

```text
AI Client
    │
    ▼
SQLScope MCP
    │
    ├── get_schema()
    ├── get_execution_plan()
    └── get_table_info()
             │
             ▼
            LLM
```

---

# 35. Limitações do MCP

Por segurança, nem toda operação deverá ser permitida.

Exemplo:

```text
READ OPERATIONS

get_schema            ✓
get_execution_plan    ✓
get_security_report   ✓

WRITE OPERATIONS

execute_safe_query    controlled

ADMIN OPERATIONS

drop_database         ✗
access_host            ✗
access_main_database   ✗
```

O sistema deverá adotar explicitamente:

**least privilege**.

---

# 36. Roadmap

O projeto não deverá começar com todas as funcionalidades.

---

## Fase 1 — SQL Playground

Objetivo:

Construir o núcleo.

Entregas:

- Next.js;
- backend Node/Nest;
- PostgreSQL;
- Monaco Editor;
- execução de SQL;
- resultados tabulares;
- histórico básico.

---

## Fase 2 — Schema Visualizer

Adicionar:

- introspecção do PostgreSQL;
- tabelas;
- colunas;
- PK;
- FK;
- relacionamentos;
- React Flow.

Ao final dessa fase já deverá existir um produto demonstrável.

---

## Fase 3 — Sandbox

Substituir banco compartilhado por ambientes isolados.

Adicionar:

- Docker;
- Sandbox Manager;
- limite de recursos;
- timeout;
- cleanup automático;
- Redis.

Essa fase é um dos maiores saltos arquiteturais.

---

## Fase 4 — SQL Learning

Adicionar:

- exemplos;
- desafios;
- datasets;
- níveis;
- feedback.

---

## Fase 5 — Query Performance

Adicionar:

- EXPLAIN;
- EXPLAIN ANALYZE;
- execution plan;
- visualização;
- comparação antes/depois;
- indexes.

---

## Fase 6 — Security Labs

Começar com:

1. SQL Injection;
2. roles e permissions;
3. Row-Level Security;
4. transactions;
5. concurrency.

---

## Fase 7 — Security Analyzer

Criar:

- SecurityRule Engine;
- severidade;
- relatórios;
- recomendações;
- testes.

---

## Fase 8 — Observabilidade

Adicionar:

- OpenTelemetry;
- Prometheus;
- Grafana;
- structured logs.

---

## Fase 9 — MCP

Criar interface para agentes externos.

Adicionar:

- MCP Server;
- tools;
- autorização;
- restrições;
- integração com clientes compatíveis.

---

# 37. MVP

O MVP não deverá tentar implementar todo o documento.

Para considerar o primeiro produto válido, bastaria:

```text
SQL Editor
        +
PostgreSQL real
        +
CREATE / INSERT / UPDATE / DELETE / SELECT
        +
Results Viewer
        +
Schema Visualizer
        +
Disposable Sandbox
```

Isso já representa o conceito fundamental:

> escrever SQL e visualizar imediatamente seus efeitos em um banco real e isolado.

---

# 38. Versão 1.0

Uma possível definição para `v1.0` seria:

```text
✓ Authentication

✓ SQL Playground

✓ Disposable PostgreSQL sandboxes

✓ Schema Visualizer

✓ Query History

✓ SQL learning scenarios

✓ EXPLAIN visualization

✓ Index comparison

✓ SQL Injection Lab

✓ Permissions Lab

✓ RLS Lab

✓ Transactions Lab

✓ Security Analyzer

✓ Tests

✓ CI/CD

✓ Public deployment
```

MCP e recursos avançados poderiam permanecer para versões posteriores.

---

# 39. Conhecimentos Desenvolvidos

O projeto deverá servir como laboratório de aprendizado para:

## Bancos de dados

- SQL;
- PostgreSQL;
- indexes;
- query plans;
- constraints;
- transactions;
- locks;
- isolation levels;
- RLS;
- database permissions.

## Backend

- Node.js;
- NestJS;
- APIs;
- WebSockets;
- workers;
- parsing;
- gerenciamento de recursos.

## Frontend

- React;
- Next.js;
- Monaco;
- React Flow;
- interfaces em tempo real;
- visualização de dados.

## Segurança

- SQL Injection;
- parameterized queries;
- least privilege;
- RLS;
- isolamento;
- sandboxing;
- controle de recursos.

## Infraestrutura

- Docker;
- containers efêmeros;
- Redis;
- CI/CD;
- Linux;
- cloud.

## Arquitetura

- isolamento de componentes;
- lifecycle management;
- event-driven communication;
- observabilidade;
- gerenciamento de sessões;
- system design.

---

# 40. Valor para Portfólio

O SQLScope deverá ser apresentado como um projeto de engenharia, e não apenas como uma aplicação web.

Um recrutador deverá conseguir identificar que o projeto demonstra conhecimentos em:

```text
TypeScript
React
Next.js
Node.js
NestJS
PostgreSQL
Redis
Docker
SQL
Database Design
Database Security
Query Optimization
Transactions
Concurrency
WebSockets
Sandboxing
CI/CD
System Design
```

Posteriormente:

```text
OpenTelemetry
Prometheus
Grafana
MCP
AI Integration
```

---

# 41. Possíveis Bullets para Currículo

Quando as funcionalidades correspondentes estiverem efetivamente implementadas, o projeto poderá ser descrito aproximadamente como:

**SQLScope — Interactive Database & Security Platform**

- Developed an interactive PostgreSQL environment using TypeScript, React, Node.js and Docker, allowing users to execute SQL and visualize schemas, relationships and database changes in real time.

- Designed isolated and disposable PostgreSQL sandboxes with resource limits, session lifecycle management and automated cleanup for safely executing user-provided SQL.

- Built interactive database security laboratories covering parameterized queries, database permissions, Row-Level Security, transactions and concurrency.

- Implemented query performance analysis using PostgreSQL execution plans, enabling visual comparison of sequential scans, indexes and query execution metrics.

- Developed an extensible database security analysis engine for identifying permission, isolation and schema configuration issues.

Futuramente:

- Implemented an MCP server exposing controlled schema, execution-plan and security-analysis tools for AI-assisted database exploration.

---

# 42. Diferencial do Projeto

O principal diferencial do SQLScope não deverá ser apenas:

> "É possível executar SQL no navegador."

Já existem diversas ferramentas capazes disso.

O diferencial será a combinação:

```text
REAL SQL EXECUTION
        +
VISUAL DATABASE
        +
QUERY PERFORMANCE
        +
DATABASE SECURITY
        +
ISOLATED SANDBOXES
        +
INTERACTIVE LEARNING
```

Cada parte reforça as demais.

O usuário escreve uma query, observa o banco, analisa o comportamento, identifica um problema, aplica uma melhoria e visualiza o resultado.

---

# 43. Identidade do Produto

Uma possível frase de apresentação:

> **SQLScope is an interactive environment for building, visualizing, analyzing and securing relational databases.**

Versão mais educacional:

> **Learn databases by seeing what your SQL actually does.**

Versão mais técnica:

> **Build it. Query it. Break it. Secure it.**

---

# 44. Visão de Longo Prazo

A evolução ideal do SQLScope é deixar de ser apenas um playground e se tornar um verdadeiro **laboratório de engenharia de bancos de dados**.

A progressão seria:

```text
SQL playground
      ↓
Visual database
      ↓
Query analysis
      ↓
Performance laboratory
      ↓
Security laboratory
      ↓
Database analyzer
      ↓
AI/MCP integration
```

Essa evolução permite que cada nova fase introduza conceitos tecnicamente mais complexos sem exigir uma reescrita completa do produto.

O resultado final seria uma aplicação que combina desenvolvimento web, bancos de dados, infraestrutura, segurança e arquitetura de software em um único projeto, mantendo um propósito claro e demonstrável.