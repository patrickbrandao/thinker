# ADR 0011 — Status de rota: ativo, desativado e fora de serviço

- **Status:** aceito
- **Data:** 2026-11-14
- **Altera:** [ADR 0004](0004-modelos-virtuais-por-harness.md), seção 2 (validação estrita das rotas já gravadas) e seção 7 (todo virtual habilitado aparece em `GET /v1/models`)

## Contexto

Provedores tiram modelos da lista com frequência, às vezes por pouco tempo. Até aqui, o Thinker só percebia a remoção quando alguém clicava em atualizar. A rota morta era pulada em silêncio no proxy e ficava sem nenhum sinal no dashboard. Nas cadeias dos modelos virtuais, a validação estrita ainda impedia editar a cadeia enquanto ela tivesse uma rota de modelo removido. O alerta `model.removed` não dizia quais harnesses e cadeias usavam o modelo. Existia um limpador de overrides (`RoutingInvalidationService`), mas ele não era chamado por ninguém e apagaria a rota, o que não serve para uma remoção temporária.

## Decisão

1. **Cada rota guardada tem um status** com quatro valores: `active`, `active_oos`, `disabled` e `disabled_oos` (`oos` = fora de serviço). Vale para as cadeias dos modelos virtuais, dos tiers (Default e complexidade) e das categorias de especificidade.
2. **Só a escolha do administrador é gravada**: `disabled: true` no JSON da rota, sem migração. O "fora de serviço" é calculado a cada leitura a partir do catálogo do agente. O motivo é `model_missing` (a conexão lista modelos, mas não este) ou `provider_unavailable` (sem conexão utilizável). Catálogo frio conta como desconhecido, não como fora de serviço.
3. **Desativado vence.** Uma rota desativada nunca serve. Quando o modelo volta, uma rota `active_oos` volta sozinha para `active`, e uma `disabled_oos` vira `disabled`, nunca ativa. Só o administrador reativa (`PATCH /api/v1/routing/:agentName/route-status`).
4. **As rotas já gravadas são mantidas.** Regravar a cadeia não revalida uma rota que já estava nela e preserva o `disabled` guardado. Rotas novas continuam com validação estrita.
5. **Detecção:** redescoberta periódica de todas as conexões ativas a cada `THINKER_DISCOVERY_INTERVAL_HOURS` (padrão 6; `0` desliga). Quando o provedor responde que o modelo não existe (heurística de `model.error`), só aquela conexão é redescoberta, em segundo plano, no máximo uma vez a cada 5 minutos. O atualizar manual continua. É tráfego para provedores configurados, não phone-home.
6. **Eventos novos:** `route.out_of_service` e `route.restored`, um por modelo e conexão, só quando alguma cadeia usa o modelo. Cada evento lista os harnesses, a cadeia, a posição (principal ou fallback N), se a rota está desativada e se a cadeia ficou sem rota. `model.removed` e `model.added` continuam como antes.
7. **`GET /v1/models`:** um modelo virtual cujas rotas estão todas fora de serviço ou desativadas sai da listagem, a menos que tenha "Continue on Default". O nome continua respondendo `M301` no proxy. No dashboard, o card ganha borda de atenção (`--warn`), e cada rota mostra seu status e um botão para desativar ou ativar.

## Consequências

- A produção não quebra quando um modelo some: a rota fica, é pulada e volta sozinha.
- Um nome de virtual oculto deixa de sombrear o modelo real de mesmo ID na listagem, embora o proxy ainda o capture e responda `M301`.
- `RoutingInvalidationService` continua sem uso. Ele contraria esta decisão e pode ser removido.
