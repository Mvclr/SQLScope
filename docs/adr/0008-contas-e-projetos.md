# ADR 0008 — Contas guardam SQL, não bancos

**Status:** Aceito
**Data:** 2026-09-19

## Contexto

A Fase 2 acrescenta contas para que o trabalho sobreviva ao sandbox. O sandbox, por
definição, é descartável (ADR 0001): o banco morre em minutos. Era preciso decidir o que
exatamente uma conta guarda.

Guardar o banco — um dump por projeto — significaria armazenamento por usuário, dumps
grandes, restauração lenta e um caminho para acumular dados de terceiros num projeto de
portfólio.

## Decisão

- **Um projeto é a lista de scripts SQL que constroem o schema**, na ordem em que foram
  executados. Abrir um projeto cria um sandbox novo e reexecuta os scripts.
- Só entram scripts que rodaram **por inteiro**: reexecutar um que falhou falharia de novo.
- O mesmo formato serve aos **links compartilháveis**, que carregam os scripts comprimidos
  no fragmento da URL. O fragmento nunca é enviado a um servidor, então uma sessão
  compartilhada não passa por lugar nenhum além do navegador de quem abre.
- **Autenticação própria**: e-mail e senha, hash argon2id (19 MiB, 2 passes — linha de base
  da OWASP), cookie `httpOnly` assinado, 30 dias.
- Senha mínima de 10 caracteres, sem regras de composição: comprimento protege mais que
  exigir símbolos, e frases são mais fáceis de lembrar.
- Login e cadastro **assumem o sandbox anônimo** que o navegador já estava usando, para
  que criar conta não descarte o que a pessoa acabou de construir.
- E-mail inexistente e senha errada recebem a mesma resposta, e o servidor gasta o mesmo
  tempo nos dois casos (verificação contra um hash gerado na inicialização).

## Consequências

- **+** O banco continua descartável; a conta não muda isso.
- **+** O que se guarda é pequeno, legível e versionável — e o usuário pode levar embora
  como `.sql` pelo export.
- **+** Abrir um projeto é reproduzir a construção, o que é justamente a tese do produto.
- **−** Dados inseridos manualmente só voltam se tiverem vindo de `INSERT` executado no
  próprio SQLScope.
- **−** Reabrir custa o tempo de reexecutar tudo; projetos muito longos demoram.
- **−** Cookie assinado sem lista de revogação: encerrar a sessão de outro dispositivo
  exigiria uma tabela de sessões, que fica para quando houver necessidade.
