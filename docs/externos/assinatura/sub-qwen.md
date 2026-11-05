---
id: sub-qwen
categoria: assinatura
entidade: Qwen Token Plan
agente: sub-qwen
thinker_ids: [qwen]
revisado_em: 2026-11-03
versao_observada: qwen-code v0.26.6 (042c023b7beb, 2026-11-02); docs QwenCloud e Alibaba Model Studio lidas em 2026-11-03
---

# Qwen Token Plan (assinatura)

Especificação mantida pelo agente `sub-qwen` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- "Token Plan" são **dois produtos paralelos** com a mesma mecânica (assinatura com cota mensal de Credits, endpoint dedicado, chave por assento): o **QwenCloud Token Plan** (`token-plan.maas.qwencloudapi.com`, chaves `sk-sp-`) e o **Alibaba Cloud Model Studio Token Plan** (`token-plan.<região>.maas.aliyuncs.com`). Existe ainda uma variante China do QwenCloud (`token-plan.maas.qianwenaiapi.com`). Chaves e URLs não são intercambiáveis entre eles nem com pay-as-you-go ou Coding Plan.
- O Thinker só fala com o Model Studio Singapura (`token-plan.ap-southeast-1.maas.aliyuncs.com`). A fonte da verdade citada para este agente (`home.qwencloud.com/api-keys`) emite chaves do **QwenCloud**, que o Thinker não alcança (G1).
- Protocolos: OpenAI Chat Completions (`/compatible-mode/v1`) e Anthropic Messages (`/apps/anthropic`, só confirmado no QwenCloud). Responses existe para modelos que suportam as ferramentas Harness; o endpoint exato não está documentado.
- Termos: uso interativo dentro de ferramentas de código/agente compatíveis; scripts automatizados e backends de aplicação não são permitidos; gateways não são citados. Risco de suspensão ou revogação de chave.
- Não há API pública para consultar uso restante; só console.
- Confiança: média. Nenhuma chamada real foi feita (sem conta).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Token Plan keys (console QwenCloud, exige login) | <https://home.qwencloud.com/api-keys> | não legível sem login |
| Token Plan QwenCloud: visão geral | <https://docs.qwencloud.com/token-plan/overview> | lido 2026-11-03 |
| Token Plan QwenCloud: FAQ | <https://docs.qwencloud.com/token-plan/faq> | lido 2026-11-03 |
| Token Plan Model Studio: Team overview | <https://www.alibabacloud.com/help/en/model-studio/token-plan-team-overview> | lido 2026-11-03 |
| Token Plan Model Studio: FAQ | <https://www.alibabacloud.com/help/en/model-studio/token-plan-faq> | lido 2026-11-03 |
| Qwen Code repository | <https://github.com/QwenLM/qwen-code> | v0.26.6 (`042c023b7beb`, 2026-11-02) |
| Qwen Code auth docs | `docs/users/configuration/auth.md` no mesmo tag | v0.26.6 |
| Presets de provedor do Qwen Code | `packages/core/src/providers/presets/{alibaba,qwencloud}-token-plan.ts` | v0.26.6 |

## Contrato

### Planos

QwenCloud (compra só em Singapura; fonte: docs.qwencloud.com/token-plan/overview, 2026-11-03). Preços em USD/mês, entre parênteses a promoção temporária:

| Edição | Plano | Preço | Cota mensal (Credits) |
|---|---|---|---|
| Personal | Lite | 8 (6) | 11.500 |
| Personal | Essential | 16 (10) | 25.500 |
| Personal | Standard | 25 (18) | 45.000 |
| Personal | Pro | 80 (68) | 180.000 |
| Personal | Credit Pack | 15/pack | 20.000/pack, até 5 |
| Team | Standard | 30 (20)/assento | 25.000 |
| Team | Pro | 100 (75)/assento | 100.000 |
| Team | Max | 200/assento | 250.000 |
| Team | Credit Pack | 700/pack | 625.000 (compartilhado) |

Model Studio Team (alibabacloud.com, 2026-11-03): mesmos números de cota e preço, com assentos chamados Standard, Advanced (100.000) e Premium (250.000). Só Singapura. Também há edição Individual (sem gestão de equipe, pode haver fila em pico).

Semântica de cobrança (ambos): um único pool de Credits para todos os modelos e ferramentas Harness; cota não acumula; esgotada a cota (e o pack), o serviço é suspenso até o próximo ciclo, sem fallback para pay-as-you-go. Dedução: assento, depois pack. Consumo varia com modelo, tokens (cache conta), modo thinking e chamadas de ferramenta (exemplo da doc: um pedido do `qwen3.6-plus` com 8.349 entrada, 40.794 em cache e 573 saída custa cerca de 3,18 Credits). Desconto noturno de 50% (22:00-08:00 UTC+8) nos modelos `deepseek-v4-pro-0813`, `deepseek-v4-flash-0731`, `deepseek-v4.1-flash`, `deepseek-v4.1-flash-1017`. Uma assinatura Token Plan por conta; Personal e Team podem coexistir com chaves distintas. Limite de taxa é por conta (todos os usuários e chaves somados), com limites de TPS e TPM.

### Modelos (Model Studio Team overview, 2026-11-03)

- Texto/raciocínio: `auto`, `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4.1-flash`, `deepseek-v4.1-flash-1017`, `deepseek-v4-pro`, `deepseek-v4-pro-0813`, `deepseek-v4-flash-0731`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `glm-5`, `MiniMax-M2.5`.
- Não são chat (endpoints próprios, o base URL de texto devolve 400): `qwen-image-2.0`, `qwen-image-2.0-pro`, `qwen-image-3.0-pro`, `wan2.7-image`, `wan2.7-image-pro`, `wan3.0-video`, `happyhorse-1.1-{i2v,t2v,r2v}`, `qwen-audio-3.0-{tts-plus,realtime-plus,asr-flash}`.
- Ids são sensíveis a maiúsculas (`MiniMax-M2.5`).
- Janelas de contexto (presets do Qwen Code v0.26.6): 1.000.000 para Qwen 3.6/3.7/3.8, DeepSeek V4.x, `glm-5.3`, `glm-5.2`; 262.144 para `kimi-k2.5/2.6/2.7-code`; 202.752 para `glm-5.1` e `glm-5`; 196.608 para `MiniMax-M2.5`.
- Visão: `qwen3.8-*`, `qwen3.7-plus`, `qwen3.6-plus`, `deepseek-v4.1-flash*`, `kimi-*`.
- Raciocínio (presets): `qwen3.8-max/flash` usam `reasoning_effort` (low a max); a maioria dos demais usa `enable_thinking` booleano; `kimi-k2.7-code`, `glm-5.3` e `MiniMax-M2.5` têm thinking obrigatório.
- O QwenCloud não lista ids na doc; o Qwen Code descobre por `GET <base>/models` e usa o catálogo pay-as-you-go menos `kimi-k3` (devolve `model_not_found` no Token Plan).

### Autenticação

- Chave colada, enviada como `Authorization: Bearer <chave>` (a FAQ do QwenCloud desaconselha `x-api-key`). Sem OAuth.
- QwenCloud: chaves `sk-sp-`; mostradas só uma vez; reset invalida a antiga na hora; renovar não troca a chave.
- Model Studio: a doc do Qwen Code (auth.md, Option 4) diz que não há exigência de prefixo para chaves do Model Studio Token Plan; as de Coding Plan e QwenCloud começam com `sk-sp-`. As docs do Model Studio não declaram o prefixo `(não confirmado)`.
- Chave de pay-as-you-go (`sk-`, `sk-ws-`) ou de Coding Plan no host Token Plan resulta em 401 `InvalidApiKey`.

### Endpoints

| Plataforma | Base OpenAI-compatível | Anthropic-compatível |
|---|---|---|
| QwenCloud internacional | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` | `https://token-plan.maas.qwencloudapi.com/apps/anthropic` |
| QwenCloud China (千问AI平台) | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1` | (não confirmado) |
| Model Studio Singapura | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | existe, caminho só no console (não confirmado `/apps/anthropic`) |
| Model Studio Pequim | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | (não confirmado) |

- Fontes: FAQ do QwenCloud; `auth.md` e presets do Qwen Code v0.26.6. A doc do Model Studio manda copiar as URLs do console (My Subscriptions, seção API Key).
- Responses: as ferramentas Harness (web search, text/image-to-image search, web scraping, code interpreter, cobradas em Credits) só funcionam em modelos com Responses API. O caminho `/v1/responses` e quais modelos o aceitam não estão na doc; o Thinker usa `/compatible-mode/v1/responses` só para `qwen3.7-max` `(não confirmado)`.
- `GET <base>/models` devolve a lista em formato OpenAI; é o método do Qwen Code para filtrar o que o plano serve.
- Parâmetros de erro comuns: `max_tokens` fora do intervalo e `thinking_budget` inválido dão 400 (limites por modelo aparecem na mensagem).

### Identificação do cliente

- Nenhum portão por versão de cliente ou user agent documentado. Qualquer ferramenta com base URL e chave customizáveis é aceita ("a compatibilidade é definida pelo protocolo, não pela aparência da ferramenta").
- O Qwen Code v0.26.6 envia `User-Agent: QwenCode/<versão> (<plataforma>; <arch>)` (`packages/core/src/core/openaiContentGenerator/provider/default.ts:107`) e, para hosts QwenCloud/千问AI (incluindo o prefixo `token-plan.`), o cabeçalho de atribuição `X-DashScope-Source-Config` com JSON `{"channel":"qwencloud-inner-agents"|"qianwenai-inner-agents","source":"model","tags":{"t1":"qwen-code-cli"}}` (`dashscope-source-config.ts`). É telemetria de origem; a doc não diz que seja exigido.
- Cache: o Qwen Code aplica `cache_control` por mensagem no estilo DashScope (a doc cita cache explícito); o Thinker faz equivalente.

### Clientes permitidos e termos

- Permitido: uso interativo em ferramentas de código/agente compatíveis (Claude Code, Cursor, Qwen Code, Codex, Qoder, Cline, OpenClaw, Cherry Studio, Chatbox, OpenCode).
- Proibido: scripts automatizados e backends de aplicação; compartilhar ou expor a chave (suspensão automática possível); violações podem suspender a assinatura ou revogar a chave. Ferramentas próprias que não chamam as APIs padrão devem usar chave pay-as-you-go.
- Gateways e proxies não são mencionados (FAQs de ambas as plataformas, 2026-11-03). Tráfego de um gateway que repassa chamadas de agentes é arriscado se parecer automação `(não confirmado)`.
- Dados: Team não treina modelos com a conversa; Personal pode usar para melhoria do serviço.

### Cotas e uso

- Cota mensal de Credits, ver Planos. Consulta de saldo: páginas "My Subscriptions" (porcentagem, reset, assentos) e "Usage Analytics" (1/7/30 dias, por modelo e membro) no console. Nenhum endpoint ou cabeçalho de uso restante foi encontrado nas docs ou no Qwen Code.
- O Thinker não consegue medir o saldo; só reage a 429.

### Erros

| Resposta | Significado |
|---|---|
| 401 `InvalidApiKey: No API-key provided` | sem chave |
| 401 `InvalidApiKey: Invalid API-key provided` | tipo de chave errado, assinatura expirada ou espaços na chave |
| 401 `invalid access token or token expired` | base URL de outro plano (ex.: Coding Plan) |
| 401 `Incorrect API key provided` | chave Token Plan no endpoint geral/pay-as-you-go |
| 403 `invalid api-key` | chave Token Plan em URL que não é Token Plan |
| 403 `AccessDenied.Unpurchased` | modelo exige edição Team |
| 404/400 `model ... not found or not supported` | id errado, com caixa errada ou fora do plano |
| 400 `Range of input length should be [1, N]` | contexto maior que o do modelo |
| 400 `InvalidParameter: url error` | caminho não casa com o protocolo |
| 429 `Requests rate limit exceeded` / `API-Key rate limit` | rajada; aguardar cerca de um minuto; agentes paralelos contam juntos |
| 429 `Throttling.AllocationQuota` | cota esgotada ou limite TPS/TPM (ambíguo) |
| 429 `insufficient_quota: Your token-plan quota has been exhausted.` | cota do assento esgotada até o reset ou compra de pack |
| `data_inspection_failed` | filtro de conteúdo |

## Como o Thinker implementa hoje

Conferido no worktree `onda2` em 2026-11-03.

- Registro: provedor `qwen` (nome "Alibaba Cloud") com modo assinatura "Qwen Token Plan", `subscriptionAuthMode: 'token'`, placeholder "Paste your Qwen Token Plan API key", `subscriptionTokenPrefix: 'sk-sp-'` e `maxContextWindow: 991000` (`packages/shared/src/subscription/configs.ts:160-171`). O campo `subscriptionTokenPrefix` está declarado mas nenhum código fora do tipo o lê (`packages/shared/src/subscription/types.ts:14`), portanto não valida a chave. Sem `knownModels` para o Qwen.
- Roteamento: `qwen` + assinatura vira `qwen-subscription` (`packages/backend/src/routing/proxy/provider-hooks.ts:24`). Base fixa `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode` (`packages/backend/src/routing/proxy/provider-endpoints.ts:191`); a região escolhida no cadastro (singapore/us/beijing/URL do Model Studio) só vale para a chave pay-as-you-go `qwen` (`provider-endpoints.ts:453-459`, `packages/backend/src/routing/qwen-region.ts`), não para a assinatura.
- Protocolo: `qwen-subscription` usa Chat Completions com `Authorization: Bearer` e `stream_options` (`provider-endpoints.ts:460-466`); caminho `/v1/chat/completions`. `qwen-subscription-responses` usa `/v1/responses` formato `chatgpt` (`provider-endpoints.ts:467-472`) e é escolhido quando `apiMode === 'responses'` ou o modelo é exatamente `qwen3.7-max` (`packages/backend/src/routing/proxy/provider-client.ts:148` e `:603-608`). O endpoint Anthropic (`/apps/anthropic`) não é usado.
- Cache: `injectOpenAiMessageCacheControl` para `qwen` e `qwen-subscription` (`provider-client.ts:949-951`).
- Cabeçalhos: só `Authorization` e `Content-Type`; sem `User-Agent` próprio e sem `X-DashScope-Source-Config` (`provider-endpoints.ts:86-89`). Não há entrada para Qwen em `subscription-clients.ts`.
- Descoberta: `GET .../compatible-mode/v1/models` com Bearer (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:62-64`, `:985-989`, `:1105-1106`). O parser aceita todo `id`, fixa contexto em 991000 e preço 0 (`:347-354`). Filtro de não-chat só cobre `^qwen-image-` e `^wan.*image` (`:462`).
- 429: texto com `insufficient_quota` entra em `QUOTA_EXHAUSTED_RE` (cooldown longo respeitando Retry-After até 24 h); `Throttling.AllocationQuota` e "rate limit exceeded" recebem o cooldown padrão de 15 s (`packages/backend/src/routing/proxy/proxy-fallback.service.ts:120-132`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/shared/src/subscription/types.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/qwen-region.ts`

Arquivos que citam `qwen`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/provider.controller.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/routing-core/provider-key.service.ts`
- `packages/backend/src/routing/routing-core/provider.service.ts`
- `packages/backend/src/routing/virtual-models/virtual-model-chain.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | quebra | O Thinker só usa o Token Plan do Model Studio Singapura (`aliyuncs.com`); chaves `sk-sp-` do QwenCloud (a fonte `home.qwencloud.com`) e os endpoints de Pequim e 千问AI não são alcançáveis. Uma chave QwenCloud no host aliyuncs deve dar 401/403 (não confirmado, exige conta). Sugestão: aceitar base do Token Plan por cadastro (QwenCloud intl, QwenCloud China, Model Studio Singapura, Model Studio Pequim) em `qwen-subscription`, reaproveitando o seletor de região, e usá-la também na descoberta. | providers | #357 | fechada: documentado que só o Model Studio Singapura funciona (decisão do mantenedor) |
| G2 | degradação | Contexto fixo em 991000 para todo modelo descoberto; kimi-* tem 262.144, glm-5.1/glm-5 202.752 e MiniMax-M2.5 196.608, e Qwen/DeepSeek têm 1.000.000. Pedidos grandes para esses modelos dão 400 de tamanho e o roteamento/compactação erra. Sugestão: `modelContextWindows` por id em `subscriptionCapabilities` do Qwen. | providers | #358 | resolvida (janela de contexto por modelo) |
| G3 | degradação | Filtro de não-chat do `qwen-subscription` só cobre `qwen-image-*` e `wan*image`; `wan3.0-video`, `happyhorse-*` e `qwen-audio-*` aparecem como modelos de chat se `/models` os listar (não confirmado, exige chave). Sugestão: ampliar a regex em `provider-model-fetcher.service.ts:462`. | providers | #359 | resolvida (filtro de não-chat/aposentados na descoberta) |
| G4 | degradação | Termos do Token Plan proíbem scripts automatizados e backends; um gateway pode ser lido como automação e levar a suspensão/revogação de chave. O Thinker não avisa ao cadastrar (contraparte do #324 no Gemini). Sugestão: aviso no cadastro da assinatura Qwen. | frontend-dev | #360 | resolvida (aviso de termos fixo no modal de conexão e na doc) |
| G5 | oportunidade | Roteamento Responses restrito a `qwen3.7-max` (regex) e endpoint Anthropic (`/apps/anthropic`) não usado: a lista de modelos que aceitam Responses (e as ferramentas Harness) não está documentada; verificar com conta real se `qwen3.8-*` aceitam. Usar `/apps/anthropic` evitaria conversões de Messages para Chat. | providers | — | aberta |
| G6 | oportunidade | 429 `Throttling.AllocationQuota` (cota ou TPS/TPM, ambíguo) e "rate limit exceeded" caem no cooldown de 15 s, a doc manda esperar cerca de um minuto. Cota esgotada só é reconhecida pelo texto `insufficient_quota`. | backend-dev | — | aberta |
| G7 | oportunidade | Modelo virtual `auto` do plano e cabeçalho `X-DashScope-Source-Config` (atribuição que o Qwen Code envia) não usados; sem `User-Agent` próprio. Nada indica que sejam exigidos. | providers | — | aberta |

## Histórico

- 2026-11-03: primeira revisão completa. Descoberto que "Qwen Token Plan" são dois produtos (QwenCloud e Model Studio); Thinker cobre só o Model Studio Singapura. Contrato escrito a partir das FAQs/overviews de ambos e do Qwen Code v0.26.6. Lacunas G1 a G7 abertas.
