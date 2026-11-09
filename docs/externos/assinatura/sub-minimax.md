---
id: sub-minimax
categoria: assinatura
entidade: MiniMax M Plan (antigo Coding Plan / Token Plan)
agente: sub-minimax
thinker_ids: [minimax]
revisado_em: 2026-11-03
versao_observada: docs platform.minimax.io 2026-11-03; mmx-cli v1.0.28 (2026-10-12)
---

# MiniMax M Plan (assinatura)

Especificação mantida pelo agente `sub-minimax` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O "Coding Plan" virou **M Plan** (a URL antiga `/docs/coding-plan/intro` serve a página do M Plan; a CLI e os códigos de erro ainda dizem "Token Plan"). Três níveis: **Go** (1x), **Explore** (3x), **Build** (7,5x). Preços não constam na doc (só em minimax.io/m-plan).
- Texto: só **MiniMax-M3.1-Flash** em todos os níveis (1M de contexto, multimodal, thinking sempre ligado). Vídeo H3 só em Explore/Build. A doc do plano não lista mais M3, M2.7, M2.5, M2.1 nem M2.
- Acesso por **chave do M Plan** (`sk-cp-...`, separada da chave pay-as-you-go `sk-api-...`) em `https://api.minimax.io/anthropic` (Messages) ou `/v1` (Chat Completions). O app oficial **MiniMax Code** entra por login; a CLI oficial `mmx` usa device code em `account.minimax.io`.
- Cotas: janela de **5 horas** (modelos não-vídeo) e janela **semanal** (todos), ambas começam no primeiro uso. Consulta: `GET https://www.minimax.io/v1/token_plan/remains`.
- Divergência relevante: o device code do Thinker usa endpoints e client id diferentes dos da `mmx` v1.0.28 (ver G1). Precisa de teste ao vivo.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| M Plan: introdução, FAQ, uso | <https://platform.minimax.io/docs/m-plan/intro.md>, `faq.md`, `usage-rules.md` | docs 2026-11-03 |
| M Plan: guias por ferramenta (Claude Code, Codex, OpenCode, outras) | <https://platform.minimax.io/docs/m-plan/other-tools.md> | docs 2026-11-03 |
| Referência Anthropic Messages | <https://platform.minimax.io/docs/api-reference/text-chat-anthropic.md> | docs 2026-11-03 |
| Códigos de erro | <https://platform.minimax.io/docs/api-reference/errorcode.md> | docs 2026-11-03 |
| Limites de taxa | <https://platform.minimax.io/docs/guides/rate-limits.md> | docs 2026-11-03 |
| Notas de modelos | <https://platform.minimax.io/docs/release-notes/models.md> | última entrada 2026-10-19 (M3.1 Flash) |
| Índice da doc | <https://platform.minimax.io/docs/llms.txt> | 2026-11-03 |
| Código da CLI oficial `mmx` | <https://github.com/MiniMax-AI/cli> (`src/auth/oauth.ts`, `src/auth/refresh.ts`, `src/config/schema.ts`, `src/client/endpoints.ts`) | tag v1.0.28, commit a965e72, 2026-10-12 |
| Termos de uso | <https://platform.minimax.io/docs/guides/terms-of-service.md> | não lido (página renderizada por JS; não confirmado) |

## Contrato

### Planos

Fonte: [intro](https://platform.minimax.io/docs/m-plan/intro.md), [FAQ](https://platform.minimax.io/docs/m-plan/faq.md), 2026-11-03.

| Nível | Cota relativa ao Go | Texto | Vídeo | Imagem/áudio |
|---|---|---|---|---|
| Go | 1x | M3.1 Flash | não incluso | sim |
| Explore | 3x | M3.1 Flash | H3 | sim |
| Build | 7,5x | M3.1 Flash | H3 | sim |

- Cobrança anual: paga 10 meses, ganha 2. Preço em dinheiro não está na doc (não confirmado).
- Pacotes de créditos (1.000 créditos = US$ 1, validade 1 ano) cobrem o excedente depois de esgotada a cota do plano. Podem ser comprados sem assinatura.
- `MiniMax-M3.1-Flash-Preview` foi aposentado; o nome antigo é servido por `MiniMax-M3.1-Flash`.
- Tarifa pay-as-you-go não se mistura: chave do M Plan e chave padrão não são intercambiáveis.
- Uso pensado para "uso individual e interativo"; a doc recomenda pay-as-you-go para produção.

### Autenticação

Três vias:

1. **Chave do M Plan** (colada), pegue em <https://platform.minimax.io/console/plan>. Prefixo `sk-cp-` (a `mmx` v1.0.28 ainda distingue `sk-cp-` de `sk-api-`). Enviada como `Authorization: Bearer <chave>` (a referência Anthropic também aceita `x-api-key`).
2. **Device code da CLI oficial `mmx`** (mmx-cli v1.0.28, `src/auth/oauth.ts`, `refresh.ts`, `config/schema.ts`):
   - hosts: `https://account.minimax.io` (global) e `https://account.minimaxi.com` (CN);
   - `POST {host}/oauth2/device/code` (form): `client_id=659cf4c1-615c-45f6-a5f6-4bf15eb476e5`, `scope=openid profile coding_plan`, PKCE S256, `state`;
   - resposta: `user_code`, `verification_uri`, `expired_in` (instante absoluto em ms), `interval` (ms), `state`;
   - `POST {host}/oauth2/token`: `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id`, `user_code`, `code_verifier`; `status` `pending` ou `success`; sucesso traz `access_token`, `refresh_token`, `expired_in` (ms absolutos), `resource_url` opcional;
   - refresh: mesmo `/oauth2/token` com `grant_type=refresh_token`, `refresh_token`, `client_id`; 4xx significa sessão perdida; renova 5 min antes de expirar;
   - o token OAuth vai como Bearer para `resource_url` ou para a base regional.
3. **Login no MiniMax Code** (app oficial, sem chave). Fluxo interno não documentado (não confirmado).

A doc de ferramentas diz "ou entrar com MiniMax onde houver suporte" (faq.md), sem detalhar o OAuth.

Rotação do refresh token: a `mmx` grava o `refresh_token` devolvido (`refresh.ts`); se vier vazio, mantém o anterior (não confirmado na doc, só no código).

### Endpoints

Fonte: [referência Messages](https://platform.minimax.io/docs/api-reference/text-chat-anthropic.md), [other-tools](https://platform.minimax.io/docs/m-plan/other-tools.md).

| Uso | URL |
|---|---|
| Messages (Anthropic) | `POST https://api.minimax.io/anthropic/v1/messages` (a doc manda `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`) |
| Chat Completions (OpenAI) | base `https://api.minimax.io/v1` |
| Responses (OpenAI) | listado no índice (`responses-create.md`); não detalhado aqui |
| Modelos | `GET https://api.minimax.io/anthropic/v1/models` e `/v1/models` respondem 401 sem chave (existem) |
| Cota | `GET https://www.minimax.io/v1/token_plan/remains` (FAQ); a `mmx` usa `{baseUrl}/v1/token_plan/remains` |
| Busca web / visão do plano | `{baseUrl}/v1/coding_plan/search` e `/v1/coding_plan/vlm` (mmx v1.0.28) |
| Região China | a `mmx` v1.0.28 usa `https://api.minimax.cn` para API e `account.minimaxi.com` para OAuth; o Thinker usa `api.minimaxi.com` (não confirmado qual é o atual) |

Parâmetros do M3.1 Flash na API Anthropic: `thinking: {type: "adaptive"}`, `output_config.effort` em `low|medium|high|xhigh|max` (padrão `max`), thinking sempre ligado e não desativável; entrada de imagem e de vídeo por URL. A doc recomenda configurar o cliente com janela de **512K** (524288) para compactação, embora o modelo ofereça 1M.

### Identificação do cliente

- Nenhum header obrigatório documentado além de `Authorization` (ou `x-api-key`) e `anthropic-version`. Nenhuma exigência de versão mínima de cliente ou beta flag.
- A `mmx` envia `User-Agent: mmx-cli/<versão>` (`src/client/http.ts`) e `x-request-id` não aparece lá; sem indício de checagem de UA (não confirmado, só teste ao vivo).
- Cliente a espelhar: nenhum é exigido. Referência: `mmx-cli` v1.0.28.

### Clientes permitidos e termos

- A doc aceita qualquer ferramenta compatível com os protocolos Anthropic ou OpenAI e cita Claude Code, Codex, Cursor, OpenCode, Pi, Hermes Agent, OpenClaw, Grok CLI, Cherry Studio e outras (other-tools.md). Um gateway se enquadra em "outras ferramentas".
- "Uso individual e interativo"; produção deve usar pay-as-you-go. Compartilhar a chave é proibido ("não compartilhe" na doc). Cláusula de revenda/proxy nos Termos: não confirmado.
- Sem relato de ação sobre conta por tráfego via gateway (não confirmado).

### Cotas e uso

Fonte: [usage-rules](https://platform.minimax.io/docs/m-plan/usage-rules.md), [rate-limits](https://platform.minimax.io/docs/guides/rate-limits.md).

- Janela de 5 h (texto, imagem, áudio) e semanal de 7 dias (todos, inclusive vídeo). Ambas começam no primeiro uso e resetam independentes; modelos não-vídeo precisam de saldo nas duas.
- Texto, imagem e áudio dividem a mesma cota; o consumo por requisição depende de modelo, contexto, complexidade e esforço de raciocínio.
- Limite de taxa separado da cota: LLM `MiniMax-M3.1-Flash` e `MiniMax-M3`: 200 RPM, 10.000.000 TPM; pode apertar em horário de pico.
- Resposta de `GET /v1/token_plan/remains` (tipos da mmx v1.0.28, `src/types/api.ts`): `model_remains[]` com `model_name`, `start_time`, `end_time`, `remains_time`, `current_interval_total_count`, `current_interval_usage_count`, `current_interval_remaining_percent`, `current_weekly_total_count`, `current_weekly_usage_count`, `current_weekly_remaining_percent`, `current_interval_status` e `current_weekly_status` (1 normal, 2 esgotado, 3 ilimitado), `weekly_*_time`, `weekly_boost_permille`. A semântica de "usage" vs "remaining" é ambígua em relatos da comunidade (não confirmado).

### Erros

Fonte: [errorcode](https://platform.minimax.io/docs/api-reference/errorcode.md). Os códigos vêm em `base_resp.status_code`; o status HTTP que os acompanha na rota Anthropic não está documentado (não confirmado).

| Código | Significado | Ação sugerida |
|---|---|---|
| 1002 | rate limit | retry com espera |
| 1004 / 2049 | chave inválida ou não autorizada | reautenticar |
| 2056 | cota esgotada (janela de 5 h) | esperar a próxima janela; cooldown longo |
| 2062 | limite de taxa do M Plan (ou sem assinatura ativa ao consultar cota) | baixar ritmo; retry curto |
| 2067 | cota esgotada e consumo automático de créditos desligado | fim de cota |
| 2053 | créditos insuficientes | |
| 2057 | chave não é do M Plan | usar a chave do plano |
| 2061 / 2068 | plano não suporta o modelo | trocar de modelo/plano |
| 2069 | modelo não está mais disponível | trocar de modelo |
| 2022 | modelo não existe | |
| 2064 / 2066 | carga alta / timeout | retry |

## Como o Thinker implementa hoje

- Provedor `minimax`, rótulo "MiniMax Coding Plan", modo `device_code`: `packages/shared/src/subscription/configs.ts:103-125`.
- `knownModels`: `MiniMax-M3.1-Flash`, `MiniMax-M3`, `MiniMax-M2.7`, `M2.7-highspeed`, `M2.5`, `M2.5-highspeed`, `M2.1`, `M2.1-highspeed`, `M2` (`configs.ts:107-117`); janela de contexto 1.000.000 só para M3.1 Flash (`configs.ts:119-122`). Lista usada sozinha como catálogo de assinatura (`model-discovery.service.ts:291`).
- Endpoint de inferência `minimax-subscription`: base `https://api.minimax.io/anthropic/v1`, rota `/messages`, formato Anthropic, headers `Authorization: Bearer` + `anthropic-version: 2023-06-01` (`provider-endpoints.ts:188`, `412-417`, `164-168`). Para OAuth o `resource_url` salvo no blob substitui a base, validado por lista fixa de 4 URLs (`provider-base-url.ts:5-24`, `forward-endpoint-resolver.ts:159-175`); `sk-cp-` colado em região `cn` cai em `https://api.minimaxi.com/anthropic/v1` (`forward-endpoint-resolver.ts:157-175`).
- Descoberta de modelos da assinatura: `GET https://api.minimax.io/anthropic/v1/models?limit=100` (`provider-model-fetcher.service.ts:58`, `962-963`, `1095-1096`, `1140`).
- Device code próprio: `POST {base}/oauth/code` e `POST {base}/oauth/token` com bases `api.minimax.io` / `api.minimaxi.com` (`minimax-oauth-helpers.ts:7-40`), `client_id` padrão `78257093-7e40-4613-99e0-527b14b39113` (sobrescrevível por `MINIMAX_OAUTH_CLIENT_ID`), escopo `group_id profile model.completion`, grant `urn:ietf:params:oauth:grant-type:user_code`, PKCE S256 (`minimax-oauth.service.ts:41-43`, `118-133`, `46-58`). Reescreve `verification_uri` de `www.minimax.io/oauth-authorize` para `platform.minimax.io` (`minimax-oauth-helpers.ts:42-63`). Refresh: `grant_type=refresh_token` no mesmo `/oauth/token`, renova 60 s antes de expirar, com trava por credencial (`minimax-oauth.service.ts:113-183`).
- Colar token: prefixo `sk-cp-` no frontend (`packages/frontend/src/services/providers.ts:377-396`).
- Não envia `User-Agent` nem headers de identidade ao MiniMax (`minimax-subscription` não tem `skipSubscriptionIdentity`; verificar `subscription-clients.ts` quando houver necessidade).
- Reasoning: `reasoning_effort` é mantido para `minimax` na rota OpenAI (`provider-client-converters.ts:468-475`); na rota Anthropic o `output_config` passa direto (`anthropic-adapter.ts:525-527`).
- Não lê cota (`/v1/token_plan/remains`) nem códigos `base_resp` 2056/2062/2067 (nenhuma ocorrência em `packages/backend/src/routing`).
- Subtítulo do frontend: "MiniMax M3, M2.7, M2.5" (`providers.ts:379`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/provider-base-url.ts`
- `packages/backend/src/routing/subscription-region.ts`
- `packages/backend/src/routing/oauth/minimax/` (helpers, service, controller)
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/known-model-modalities.ts`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O device code do Thinker usa `api.minimax.io/oauth/code` + `/oauth/token`, client `78257093-...`, escopo `group_id profile model.completion`, grant `user_code`. A CLI oficial v1.0.28 usa `account.minimax.io/oauth2/device/code` + `/oauth2/token`, client `659cf4c1-...`, escopo `openid profile coding_plan`, grant `device_code`. Não sei se o fluxo antigo ainda funciona (GET nos dois pares devolve 404, inconclusivo). Se foi desligado, o login falha; o caminho `sk-cp-` colado segue funcionando. Sugestão: testar ao vivo e, se preciso, migrar para o fluxo da `mmx` mantendo o antigo como fallback. | providers | #339 | aberta |
| G2 | degradação | Catálogo da assinatura desatualizado: o M Plan só inclui `MiniMax-M3.1-Flash`; Thinker lista também M3, M2.7, M2.5, M2.1 e M2 (e o subtítulo "M3, M2.7, M2.5"). Se o plano rejeita esses ids (erros 2061/2068/2069), o roteador oferece modelos que falham. Não confirmado se as chaves atuais ainda aceitam os ids antigos. Sugestão: reduzir a lista ao que a chave devolver em `/anthropic/v1/models` ou manter só M3.1 Flash, e renomear o rótulo para "MiniMax M Plan". | providers | #340 | resolvida (lista de modelos atualizada) |
| G3 | degradação | Erros do M Plan não são tratados: 2056 (janela de 5 h esgotada), 2067 (cota esgotada sem créditos), 2062 (taxa) e 2061/2068/2069 (modelo fora do plano) caem na política genérica de erro e cooldown. Sugestão: mapear `base_resp.status_code` para cooldown até o fim da janela (2056/2067), retry curto (2062) e erro de modelo (2061/2068/2069). Status HTTP dessas respostas na rota Anthropic não confirmado. | backend-dev | #341 | resolvida (cooldown até o reset lido do corpo do erro) |
| G4 | oportunidade | Mostrar uso restante do plano lendo `GET https://www.minimax.io/v1/token_plan/remains` (janelas de 5 h e semanal por modelo) e usar para failover antes de bater no limite. | backend-dev | — | aberta |
| G5 | oportunidade | Documentar no dashboard/aviso que o M Plan é "uso individual e interativo" e que a chave é separada da pay-as-you-go; termos sobre proxy/revenda não confirmados. | frontend-dev | — | aberta |

## Histórico

- 2026-11-03: primeira revisão completa. Doc agora fala em M Plan (Go/Explore/Build) e M3.1 Flash único; levantado o device code da `mmx` v1.0.28 e o endpoint de cota; abertas G1-G5.
- 2026-11-03: esqueleto criado, sem pesquisa.
