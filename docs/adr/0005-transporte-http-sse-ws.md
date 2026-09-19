# ADR 0005 — Transporte: HTTP para comandos, SSE para eventos, WebSocket só na concorrência

**Status:** Aceito
**Data:** 2026-09-18

## Contexto

O conceito coloca WebSocket no caminho de tudo ([concept.md](../concept.md), seção 29). WebSocket exige reconexão manual, não tem semântica de request/response, é mais difícil de depurar e de testar, e é desnecessário para a maior parte do fluxo.

## Decisão

| Fluxo                                                      | Transporte                      | Motivo                                                               |
| ---------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| Executar SQL, EXPLAIN, criar sessão, analisar              | **HTTP** (`POST`)               | Request/response natural, testável com Supertest/curl, retry simples |
| Resultados grandes                                         | **HTTP com streaming** (NDJSON) | Linhas chegam conforme o cursor avança                               |
| Schema mudou, métricas, sandbox expirando, posição na fila | **SSE**                         | Unidirecional, reconexão nativa do navegador, funciona sobre HTTP/2  |
| Lab de concorrência / isolation levels                     | **WebSocket**                   | Controle bidirecional em tempo real de múltiplas sessões             |

### Limites de resultado

- Execução usa cursor server-side; nunca materializa o resultado inteiro em memória.
- Limite de linhas **e** de bytes serializados por execução (configurável; padrão conservador).
- Resposta indica truncamento explicitamente (`truncated: true`, com motivo).

## Consequências

- **+** Menos código de infraestrutura de tempo real; o WS fica restrito ao lugar onde é de fato necessário.
- **+** A API é consumível por clientes simples — inclusive pelo futuro servidor MCP.
- **−** Dois mecanismos de push (SSE e WS). Aceito: têm usos claramente distintos.
