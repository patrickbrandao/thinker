---
id: api-huggingface
categoria: api
entidade: Hugging Face Inference Providers
agente: api-huggingface
thinker_ids: [huggingface]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04 (router.huggingface.co/v1/models com 125 modelos)
---

# Hugging Face Inference Providers (acesso por API)

Especificação mantida pelo agente `api-huggingface` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Hugging Face (HF) opera um roteador OpenAI-compatível (`https://router.huggingface.co/v1`) que escolhe, para cada modelo, um entre vários provedores de inferência parceiros (Cerebras, Groq, Together, Novita, DeepInfra, Fireworks etc.). Autenticação com um token de usuário HF (`hf_...`) com permissão "Make calls to Inference Providers".
- O endpoint de chat é o único compatível com OpenAI; outras tarefas (imagem, embeddings, fala) exigem os SDKs do HF e não são relevantes ao Thinker.
- O sufixo no id do modelo define a política de provedor: padrão `:fastest`, além de `:cheapest`, `:preferred` e `:<provedor>`.
- Cobrança: repasse sem markup. Plano gratuito sem créditos; PRO inclui US$ 2/mês; pay-as-you-go com compra de créditos.
- O Thinker já cobre o essencial (chat completions, descoberta por `/v1/models`, preço do provedor mais rápido). Lacunas abertas: `reasoning_effort` descartado e preços ausentes (ver Lacunas).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Inference Providers docs | <https://huggingface.co/docs/inference-providers/index> | 2026-11-04 |
| Chat completion task | <https://huggingface.co/docs/inference-providers/tasks/chat-completion> | 2026-11-04 |
| Pricing and billing | <https://huggingface.co/docs/inference-providers/pricing> | 2026-11-04 |
| Hub API (listagem `/v1/models`) | <https://huggingface.co/docs/inference-providers/hub-api> | 2026-11-04 |
| `GET /v1/models` ao vivo (sem chave) | <https://router.huggingface.co/v1/models> | 2026-11-04 (125 modelos) |

## Contrato

### Endpoints e protocolos

- Base URL: `https://router.huggingface.co/v1`. Sem regiões. Fonte: docs index, 2026-11-04.
- Chat: `POST /v1/chat/completions`, Chat Completions OpenAI-compatível (inclui streaming SSE). Esse endpoint é só para chat; Anthropic Messages e Responses não são documentados (não confirmado se existem).
- Autenticação: `Authorization: Bearer hf_...`. Token fine-grained com permissão `inference.serverless.write` ("Make calls to Inference Providers"). Um token sem a permissão é rejeitado (código exato não confirmado).
- Cabeçalho opcional `X-HF-Bill-To: <org ou resource-group-id>` cobra a requisição de uma organização Team/Enterprise (pricing, 2026-11-04).
- Sem chave, `POST /v1/chat/completions` responde 401 (testado em 2026-11-04, resposta HTML do CloudFront).
- "Custom Provider Key": o usuário pode registrar chaves de provedores nas configurações HF; a requisição continua usando o token HF e o HF troca a autenticação. Nesse modo o provedor cobra e os créditos HF não se aplicam.
- Failover automático: com seleção `auto`/`:fastest`, a requisição pode ir para outro provedor se o primário estiver marcado como indisponível.

### Modelos

- Listagem: `GET /v1/models` (público, funciona sem token) e `GET /v1/models/{id}`. Formato OpenAI com extensões: `data[]` com `id`, `object`, `created`, `owned_by`, `architecture.input_modalities` e `output_modalities`, e `providers[]`.
- Cada entrada de `providers[]` pode ter: `provider`, `status` (`live` ou `error`), `context_length`, `pricing.{input,output}` (US$ por milhão de tokens), `is_free` (promoção temporária), `supports_tools`, `supports_structured_output`, `first_token_latency_ms`, `throughput` (tokens/s), `is_model_author`. Todos opcionais salvo `provider`, `status`, `is_model_author`.
- Observado ao vivo em 2026-11-04: 125 modelos, 245 entradas de provedor, todas `live`; provedores presentes: deepinfra (70), featherless-ai (56), novita (50), zai-org (21), baseten (12), cohere (11), publicai (9), ovhcloud (8), nscale (3), groq (3), cerebras (2). Nenhum `is_free` verdadeiro. 89 de 245 entradas sem `pricing`; 46 modelos aceitam imagem como entrada.
- Ids dos modelos seguem o formato do Hub (`org/nome`, ex.: `openai/gpt-oss-120b`).
- Sufixos de política no id do modelo (docs index, 2026-11-04):
  - sem sufixo ou `:fastest`: maior `throughput`;
  - `:cheapest`: menor preço por token de saída;
  - `:preferred`: primeiro disponível na ordem configurada em <https://hf.co/settings/inference-providers>;
  - `:<provedor>` (ex.: `openai/gpt-oss-120b:groq`): força o provedor.
- Os ids da listagem não trazem sufixo. Aposentadorias de modelos não são anunciadas num ponto único; um modelo some da listagem quando nenhum provedor o serve.
- Há também `GET https://huggingface.co/api/models?inference_provider=all` e `?expand[]=inferenceProviderMapping` (Hub API) para ver o id interno de cada provedor; irrelevante para o Thinker hoje.

### Capacidades

| Capacidade | O que a fonte diz |
|---|---|
| Tools | `tools` (só `function`), `tool_choice` (`auto`, `none`, `required` ou função), `tool_prompt`; suporte por provedor via `supports_tools` |
| Visão | `content` em partes `text` e `image_url`; sinalizada em `architecture.input_modalities` |
| Raciocínio | parâmetro `reasoning_effort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`; depende de provedor e modelo). Saída de raciocínio não documentada (não confirmado) |
| Saída estruturada | `response_format`: `text`, `json_object`, `json_schema` (com `strict`); suporte por provedor via `supports_structured_output` |
| Outros parâmetros | `max_tokens`, `temperature`, `top_p`, `seed`, `stop` (até 4), `frequency_penalty`, `presence_penalty`, `logprobs`, `top_logprobs` (0-5), `stream`, `stream_options.include_usage` |
| Contexto | por provedor, em `context_length` (ex.: 1.048.576 em DeepSeek V4.1 Flash); pode faltar. Máximo de saída não é publicado |
| Cache de prompt | não documentado (não confirmado) |

Como o roteador repassa para provedores distintos, a doc avisa que a requisição HTTP exata pode variar entre provedores; o contrato é o do chat OpenAI.

### Streaming e uso

- SSE no formato OpenAI. Com `stream_options.include_usage` o roteador emite um chunk final com `choices: []` e `usage` antes de `data: [DONE]`; os demais chunks levam `usage: null`.
- Campos de uso documentados na resposta: `prompt_tokens`, `completion_tokens`, `total_tokens`. Tokens em cache e de raciocínio não aparecem na especificação do chat; a API de uso de organizações (Enterprise) reporta tokens de entrada em cache (não confirmado para a resposta de chat).
- A resposta documenta `system_fingerprint`, `created`, `id` e `model`.

### Preços

- Sem markup: o HF cobra a taxa do provedor (pricing, 2026-11-04). Preço por modelo/provedor vem de `pricing.input` e `pricing.output` em `/v1/models`, em US$ por milhão de tokens; pode estar ausente.
- Créditos incluídos: Free = nenhum (precisa comprar créditos); PRO = US$ 2,00/mês; Team/Enterprise = US$ 2,00 por assento. Créditos são gerais (também valem para Endpoints, Spaces, Jobs) e são aplicados antes do pay-as-you-go.
- Não há tier de contexto longo, desconto de cache ou taxa por requisição documentados para provedores de terceiros. O provedor `hf-inference` cobra tempo de computação multiplicado pelo preço do hardware.
- Uso e gasto: página <https://huggingface.co/settings/billing> e `GET https://huggingface.co/api/organizations/{org}/billing/usage/inference` (Enterprise).

### Limites e erros

- Limites de taxa e cotas por plano: não publicados nas páginas lidas (não confirmado). Falta de créditos em conta gratuita é a causa esperada de erro de pagamento (código exato não confirmado).
- Códigos observados: 401 sem token (testado). Nenhuma tabela oficial de erros foi encontrada na doc de chat-completion.
- `stop` aceita até 4 sequências; `logprobs` exige `top_logprobs` entre 0 e 5.
- Parâmetros ignorados ou específicos: `tool_prompt` é específico do TGI; `reasoning_effort` pode ser ignorado por provedor (dependente de modelo).

## Como o Thinker implementa hoje

Estado conferido no código em 2026-11-04:

- Registro: id `huggingface`, nome "Hugging Face", aliases `hugging-face`, `hugging face`, `hf`, prefixo de chave `hf_`, comprimento mínimo 20 (`packages/shared/src/providers.ts:201-211`). Chave obtida em <https://huggingface.co/settings/tokens> (`packages/frontend/src/services/provider-api-key-urls.ts:12`).
- Inferência: base `https://router.huggingface.co`, caminho `/v1/chat/completions`, cabeçalhos `Authorization: Bearer` e `Content-Type`, formato `openai`, uso em streaming via `stream_options` (`packages/backend/src/routing/proxy/provider-endpoints.ts:201,357-363`; helpers em `:84-96`).
- Nome do modelo: não remove o prefixo `org/` (`packages/backend/src/routing/proxy/provider-client.ts:340-360`), então ids como `Qwen/Qwen3-Coder` seguem inalterados; um sufixo `:cheapest` digitado pelo usuário também seguiria inalterado (não testado).
- Parâmetros: `reasoning_effort`, `stream_options` e outros campos de `OPENAI_ONLY_FIELDS` são removidos para provedores fora da lista; `huggingface` não está na exceção de `reasoning_effort` (`packages/backend/src/routing/proxy/provider-client-converters.ts:121-130,468-476`). Ver G1.
- Descoberta: `GET https://router.huggingface.co/v1/models` com `Authorization: Bearer` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:67,902-906`). O parser escolhe o provedor `live` de maior `throughput` (sem `throughput` conta como -1) e ignora modelos sem provedor `live` (`:244-292`). Dele tira `context_length` (padrão `DEFAULT_CONTEXT_WINDOW`), `pricing` convertido de milhão para token (`null` se faltar), `supports_tools` (vira capacidade `tools` e `capabilityCode`), modalidades de entrada e saída e `stream`. `capabilityReasoning` fixo em `false`, `qualityScore` 3.
- Testes: `provider-model-fetcher.service.spec.ts:68-190` e `provider-endpoints.spec.ts:106-109,369-371`.
- Não lidos: `is_free`, `supports_structured_output`, `first_token_latency_ms`, `X-HF-Bill-To`.
- Sem snippet de configuração específico; a descrição do provedor está em `packages/frontend/src/i18n/locales/en/providerSetup.ts:257`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-prices/model-pricing-cache.provider-scope.spec.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/cli/src/provider-catalog.gen.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `reasoning_effort` é documentado pelo roteador mas o Thinker o remove para `huggingface` (`provider-client-converters.ts:129,468`). Habilitar `forwardReasoningEffort` e validar o erro quando o provedor não suporta. | providers | [#409](https://github.com/patrickbrandao/thinker/issues/409) | aberta |
| G2 | degradação | Em 24 de 125 modelos o provedor mais rápido não publica `pricing` (e 89 de 245 entradas em geral); o Thinker grava preço `null` (aparece como gratuito) e usa contexto padrão. Estimar com outro provedor `live` ou marcar preço desconhecido. | providers | [#410](https://github.com/patrickbrandao/thinker/issues/410) | aberta |
| G3 | oportunidade | Suporte a `X-HF-Bill-To` para contas Team/Enterprise que centralizam cobrança numa organização (cabeçalho opcional por provedor configurado). | providers | — | aberta |
| G4 | oportunidade | Descoberta ignora `is_free` e `supports_structured_output`; `is_free` indicaria promoções gratuitas, e preço `null` hoje é indistinguível de gratuito. | providers | — | aberta |
| G5 | oportunidade | Políticas `:cheapest`, `:preferred` e `:<provedor>` passam sem tratamento; o preço usado no cálculo de custo é sempre o do provedor mais rápido, então com `:cheapest` ou provedor forçado o custo estimado diverge do real. Considerar expor a política como opção do provedor ou de tier. | providers | — | aberta |
| G6 | informativa | Limites de taxa, código de erro por falta de créditos e formato de uso com tokens em cache não estão documentados; confirmar com chave real antes de mapear erros. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Docs lidas (index, chat-completion, pricing, hub-api) e `/v1/models` consultado ao vivo (125 modelos). Contrato preenchido, código conferido com `path:line`, 6 lacunas registradas, issues #409 e #410 abertas. Um 401 sem chave confirmado; nenhuma chamada autenticada feita.
