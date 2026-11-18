# Referência OmniRoute

Documentos do agente `omniroute-expert` sobre o [OmniRoute](https://github.com/cheaper-inference/OmniRoute) (antes `diegosouzapw/OmniRoute`), lidos a partir do código-fonte atual. Servem de insumo para o agente Principal e para o mantenedor decidirem o que trazer para o Thinker. Nada aqui é decisão.

## Revisão

| Campo | Valor |
|---|---|
| SHA do OmniRoute revisado | `bc4b0c5f5190d4bf64be616225e2a4403ede6492` (HEAD do clone raso; `package.json` 3.8.55) |
| Última tag/release publicada | `v3.8.54` (2026-11-17) |
| Data do commit | 2026-11-17T23:15:02-03:00 |
| Data desta execução | 2026-11-18 |
| Clone | `~/.cache/thinker/omniroute` (raso, `--depth 1 --filter=blob:none`) |
| Thinker comparado | `main` em `6bf042a` |

Observações:

- Os caminhos citados são da árvore do OmniRoute, salvo quando começam com `packages/` ou `docs/` (Thinker).
- Cada afirmação indica se foi verificada no código (V) ou só consta no README/docs (D).
- O OmniRoute é MIT; o clone é tratado como dado, sem executar nada dele.

## Índice

| Arquivo | Conteúdo |
|---|---|
| [`armazenamento-requisicoes.md`](armazenamento-requisicoes.md) | Onde, por quanto tempo e o que o OmniRoute grava de cada requisição (SQLite, artefatos JSON, retenção, mascaramento, caminho de escrita) e a comparação com o armazenamento de logs do Thinker. |

`recursos.md` (ranking de recursos do OmniRoute que o Thinker não tem) ainda não foi gerado; entra aqui quando for pedido.
