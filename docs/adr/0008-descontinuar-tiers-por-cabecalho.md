# ADR 0008 — Descontinuar os tiers por cabeçalho

- **Status:** aceito
- **Data:** 2026-10-28
- **Altera:** [ADR 0004](0004-modelos-virtuais-por-harness.md), que mantinha os header tiers ao lado dos modelos virtuais

## Contexto

Os tiers customizados por cabeçalho ("Criar nível personalizado" na página Roteamento, tabela `header_tiers`, API `/api/v1/routing/:agente/header-tiers`) ativavam uma cadeia de modelos quando um par cabeçalho/valor casava. O ADR 0004 criou os modelos virtuais para os clientes que não deixam enviar cabeçalhos e manteve os header tiers como estavam.

Na prática os modelos virtuais cobrem o mesmo caso: uma cadeia nomeada com principal e fallbacks, escolhida pelo campo `model`, que todo harness sabe mandar. Ter dois mecanismos com precedência entre si complicava a página Roteamento, o resolvedor do proxy, o log de mensagens, a CLI e as ferramentas MCP.

## Decisão

Os tiers por cabeçalho saem do produto, por inteiro:

- **Banco:** a migração `DropHeaderTiers` apaga os parâmetros por rota com escopo `header:*`, remove a tabela `header_tiers` e as colunas `header_tier_id`, `header_tier_name` e `header_tier_color` de `agent_messages`.
- **Proxy:** a ordem de resolução fica modelo virtual → `auto`/ID explícito. O `X-Thinker-Reason: header-match` deixa de existir, e o warm-up do streaming passa a ser só por conexão.
- **API, CLI e MCP:** somem as rotas `/header-tiers`, o filtro `header_tier_id` do log de mensagens e os comandos e ferramentas de tiers customizados.
- **Dashboard:** a página Roteamento mostra a cadeia `auto` como "Modelo virtual: `auto`", na mesma grade dos modelos virtuais. O botão **Criar modelo virtual** fica na barra de ações, e o rodapé ("Voltar tudo para automático", "Como o roteamento funciona", "Instruções de configuração") sai.

## Consequências

- Quem roteava por cabeçalho precisa criar um modelo virtual e mandar o nome dele no `model`.
- As linhas antigas do log perdem o nome do tier por cabeçalho que as atendeu.
- As migrações antigas que criaram `header_tiers` continuam no histórico.
