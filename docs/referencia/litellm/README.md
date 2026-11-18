# Referência LiteLLM

Documentos do agente `litellm-expert` sobre o [LiteLLM Proxy](https://github.com/BerriAI/litellm) (BerriAI), lidos a partir do código-fonte atual. Servem de insumo para o agente Principal e para o mantenedor decidirem o que trazer para o Thinker. Nada aqui é decisão: quem decide é o Principal/mantenedor.

## Revisão

| Campo | Valor |
|---|---|
| SHA do LiteLLM revisado | `aa7917a3d2634c420faed46d4b2aaf87054b8728` (branch `main`) |
| Data do commit | 2026-11-05T05:25:08-08:00 |
| Data desta execução | 2026-11-05 |
| Clone | `~/.cache/thinker/litellm` (raso, `--depth 1`) |
| Thinker comparado | `main` em `8d96846` |

Observações:

- A pasta `docs/my-website/` não existe no clone raso; a análise se apoia no código e nos READMEs internos (`litellm/**/README.md`, `litellm/proxy/**/architecture.md`).
- **Licença:** tudo fora de `enterprise/` é MIT. O diretório `enterprise/` (logs de auditoria, hooks de moderação, vector stores gerenciados, `liteadmin`) tem licença própria (BerriAI Enterprise License). Para esses itens, só vale reimplementar do zero a partir da ideia; não copiar código.
- Os caminhos citados são da árvore do LiteLLM, salvo quando começam com `packages/` ou `docs/` (Thinker).

A tabela acima vale para `recursos.md`. Cada documento por tema traz no topo o próprio SHA, a data e o commit do Thinker comparado, porque são revisados em momentos diferentes.

## Índice

| Arquivo | Conteúdo | SHA do LiteLLM | Revisado em |
|---|---|---|---|
| [`recursos.md`](recursos.md) | Ranking dos recursos do LiteLLM Proxy que o Thinker não tem, ordenados por valor/esforço, com encaixe nos ADRs e onde ficariam no código do Thinker. | `aa7917a3` | 2026-11-05 |
| [`armazenamento-requisicoes.md`](armazenamento-requisicoes.md) | Como o LiteLLM Proxy armazena as requisições: onde (Postgres, Redis, callbacks), retenção e limpeza, campos gravados (spend logs, tabelas diárias, auditoria), privacidade e redação, caminho de escrita em lote com livro-razão, divergências entre código e docs, e comparação com as gravações do Thinker. | `c030ffb6` | 2026-11-18 |

Novos documentos por tema (por exemplo `roteamento-fallbacks.md`, `cache.md`, `guardrails.md`) entram aqui conforme as perguntas aparecerem.
