---
id: api-kilo
categoria: api
entidade: Kilo Gateway
agente: api-kilo
thinker_ids: [kilo]
revisado_em: 2026-11-04
versao_observada: kilocode v7.8.25 (b3b2f3d) + catálogo ao vivo ai-gateway.kilo.ai 2026-11-04
---

# Kilo Gateway (acesso por API)

Especificação mantida pelo agente `api-kilo` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

O Kilo Gateway é um agregador compatível com OpenRouter (Chat Completions) que revende centenas de modelos com uma chave `Authorization: Bearer`. A base canônica atual é `https://ai-gateway.kilo.ai/api/v1`; o Thinker usa a base legada `https://api.kilo.ai/api/gateway`, que o cliente oficial documenta como equivalente (reescrita para `/api/v1`). O catálogo `GET /models` é público (HTTP 200 sem chave, 380 modelos em 2026-11-04) e traz preços por token, inclusive `input_cache_read`/`input_cache_write` (251 modelos têm cache de leitura), que o Thinker ignora (G1). Os modelos `kilo-auto/*` têm preço `-1` (dinâmico) e há aliases `~vendor/...-latest` e modelos com `expiration_date` (G2).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Código do cliente (pacote `kilo-gateway`) | <https://github.com/Kilo-Org/kilocode/tree/v7.8.25/packages/kilo-gateway/src> | v7.8.25 (2026-10-28), commit b3b2f3d |
| Docs do gateway (no mesmo repositório) | <https://github.com/Kilo-Org/kilocode/tree/v7.8.25/packages/kilo-docs/pages/gateway> | v7.8.25 |
| Docs publicadas | <https://kilo.ai/docs> | não aberta diretamente (não confirmado) |
| Catálogo ao vivo | <https://ai-gateway.kilo.ai/api/v1/models> | 2026-11-04 |
| Releases | <https://github.com/Kilo-Org/kilocode/releases> | v7.8.25 |

## Contrato

### Endpoints e protocolos

- Base canônica: `https://ai-gateway.kilo.ai/api/v1` (`DEFAULT_KILO_AI_GATEWAY_URL` em `api/constants.ts`). Sobrescrita por `KILO_AI_GATEWAY_URL`; se só `KILO_API_URL` estiver definida, o cliente usa `${KILO_API_URL}/api/gateway/v1`, que o código descreve como reescrito para as rotas `/api/v1` do gateway. Portanto `https://api.kilo.ai/api/gateway/v1` segue equivalente (vem do comentário do código; não testado ao vivo).
- Autenticação: `Authorization: Bearer <chave>`. Modelos gratuitos aceitam acesso anônimo (limite documentado de 200 req/h por IP); o cliente usa a chave literal `anonymous`.
- Rotas documentadas: `POST /chat/completions` (OpenAI/OpenRouter-compatível), `POST /fim/completions`, `GET /models`, `GET /providers`, `POST /systemone` (modelo fixo `typesafe/jev-1.13`). O cliente também trata `/responses` (remove `id` e `item_reference` dos itens de entrada). `/messages` (Anthropic) é citado em comentário do código (não confirmado em docs).
- Streaming por SSE; o gateway injeta `stream_options.include_usage = true` em toda requisição com `stream: true`, então o usage chega no chunk final.
- Limite de corpo: 20 MB (HTTP 413).
- Cabeçalhos opcionais (docs `authentication.md` e `api/constants.ts`):

| Cabeçalho | Uso |
|---|---|
| `X-KiloCode-OrganizationId` | contexto de organização |
| `X-KiloCode-TaskId` | id da tarefa; usado como chave de prompt cache |
| `X-KiloCode-ParentTaskId`, `X-KiloCode-ProjectId`, `X-KiloCode-EditorName`, `X-KiloCode-MachineId`, `X-KiloCode-Feature` | atribuição e telemetria; só o cliente oficial envia |
| `X-KiloCode-Version` | versão do cliente |
| `x-kilocode-mode` | dica de modo (`plan`, `build`, `code`, ...) para o roteamento de `kilo-auto/frontier` |
| `User-Agent` | o cliente oficial envia `opencode-kilo-provider/<versão>` |

- A resposta do auto-router pode trazer `x-kilo-auto-decision` (`AUTO_DECISION_HEADER`).

### Modelos

- `GET /models` retorna `{data:[...]}` no formato OpenRouter: `id`, `name`, `context_length`, `top_provider.max_completion_tokens`, `architecture.input_modalities/output_modalities`, `pricing`, `supported_parameters`, mais extensões do Kilo: `isFree`, `preferredIndex`, `mayTrainOnYourPrompts`, `autoRouting.models`, `opencode.*`, `inference_provider_ids` e `expiration_date` (YYYY-MM-DD, em modelos com saída programada).
- Ids são `vendor/modelo` (ex.: `anthropic/claude-sonnet-4.6`, `openai/gpt-5.4`), com sufixo `:free` em variantes gratuitas. O id deve ser enviado inteiro, com a barra.
- Virtuais `kilo-auto/*` vistos ao vivo: `frontier`, `balanced`, `efficient`, `free`, `small`. A doc lista `frontier`, `efficient`, `free` e `small`; `balanced` só aparece no catálogo ao vivo. O modelo real por trás muda no servidor; os ids da camada são estáveis. `kilo-auto/frontier` resolve por `x-kilocode-mode` (modos de planejamento vão para o modelo maior; `build`, `explore`, `code` e o padrão vão para o intermediário).
- Aliases móveis `~vendor/...-latest` (ex.: `~anthropic/claude-sonnet-latest`, `~openai/gpt-sol-latest`, `~google/gemini-pro-latest`) apontam para o modelo mais novo da família.
- Saídas anunciadas via `expiration_date` no catálogo de 2026-11-04: `minimax/minimax-*` em 2026-11-05; `inception/mercury-*` em 2026-11-08; `bytedance-seed/seed-*` em 2026-11-11; `z-ai/glm-4.5*`, `z-ai/glm-4.7` e `dots-studio/dots-3-note-preview:free` em 2026-12-31.

### Capacidades

- Vêm de `supported_parameters` por modelo (`tools`, `reasoning`, `include_reasoning`, `max_tokens`, `temperature`, ...). O cliente oficial descarta modelos sem `tools`.
- Visão: `architecture.input_modalities` contém `image`. Saída não textual aparece em `output_modalities`.
- Chamada de ferramentas no formato OpenAI; o gateway tem "reparo" de chamadas de ferramenta (docs `api-reference.md`).
- Raciocínio: parâmetro `reasoning` no estilo OpenRouter; `kilo-auto/frontier` é enviado com esforço e verbosidade médios.
- Cache de prompt: preços `input_cache_read`/`input_cache_write` no catálogo; `X-KiloCode-TaskId` é a chave de cache da sessão.
- Contexto de 65k a 1,05M conforme o modelo (`context_length`); `max_completion_tokens` em `top_provider`.

### Streaming e uso

- Usage no chunk final do SSE. As docs de billing falam em `cache_write_tokens` e `cache_hit_tokens` na API de uso do Kilo; os nomes exatos no chunk de streaming não foram confirmados (provável formato OpenAI `prompt_tokens_details.cached_tokens`) (não confirmado).
- Para `kilo-auto/*` o custo real depende do modelo resolvido; o preço do catálogo é `-1`.

### Preços

- USD por token, como strings, em `pricing.prompt`, `completion`, `input_cache_read`, `input_cache_write`, `web_search` (por busca), `image`, `internal_reasoning`, `request`.
- Sem margem sobre o upstream; taxa de 5% só na compra de créditos (docs `usage-and-billing.md`).
- `-1` em `prompt` e `completion` significa preço dinâmico (`kilo-auto/efficient`, `frontier`, `balanced`). `kilo-auto/free` custa 0; `kilo-auto/small` tem preço fixo.
- BYOK: com chave própria cadastrada no Kilo, o custo reportado é 0 e a requisição não cai para as chaves do Kilo se a sua falhar.

### Limites e erros

| HTTP | Significado | Classe |
|---|---|---|
| 400 | parâmetro ou modelo inválido | não retentar |
| 401 | chave inválida ou ausente | chave ruim |
| 402 | saldo insuficiente (se vier do upstream, o gateway devolve 503) | cota |
| 403 | modelo bloqueado por política da organização | não retentar |
| 413 | corpo acima de 20 MB | reduzir |
| 429 | limite de taxa (anônimo: 200 req/h por IP) | retentar com espera |
| 500, 502 | erro interno ou do provedor upstream | retentar |

- Corpo de erro: `{"error":{"message":...}}`. Erro de contexto excedido é descritivo.
- Parâmetros proibidos: nenhum encontrado além da limpeza de `id`/`item_reference` em `/responses` feita pelo cliente oficial.

## Como o Thinker implementa hoje

- Base `https://api.kilo.ai/api/gateway` (legada), constante duplicada em `packages/backend/src/routing/proxy/provider-endpoints.ts:197` e `packages/backend/src/model-discovery/provider-model-fetcher.service.ts:65`.
- Proxy: formato `openai`, caminho fixo `/chat/completions`, cabeçalhos `openaiHeaders` (só Bearer), usage em streaming via `openaiStreamUsage`: `provider-endpoints.ts:364-370`. Nenhum cabeçalho `X-KiloCode-*` é enviado nem repassado.
- Id do modelo preservado com barras (sem strip de prefixo): `packages/backend/src/routing/proxy/provider-client.ts:349`.
- Descoberta: `GET {base}/models` com Bearer em `provider-model-fetcher.service.ts:912-916`. `parseKilo` (`:678-712`) filtra saída não textual, lê `context_length`, preços `prompt`/`completion` (só aceita >= 0, então `-1` vira `null`), `reasoning` e `tools` de `supported_parameters`; ignora `input_cache_*`, `expiration_date` e `isFree`.
- Cadastro: `packages/shared/src/providers.ts:213-224` (aliases `kilocode`, `kilo-code`; sem prefixo de chave; mínimo 10 caracteres).
- Overlay do models.dev mapeia `kilo: 'kilo'` em `packages/backend/src/database/models-dev-sync.service.ts:63`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `kilo`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `parseKilo` ignora `pricing.input_cache_read` e `input_cache_write` do catálogo (251 de 380 modelos têm cache de leitura); custo de cache fica impreciso. Arquivo: `provider-model-fetcher.service.ts:678`. Mudança: ler os dois campos como o cliente oficial. | `providers` | [#408](https://github.com/patrickbrandao/thinker/issues/408) | aberta |
| G2 | degradação | Modelos `kilo-auto/*` (preço `-1` vira `null`), aliases `~vendor/...-latest` e modelos com `expiration_date` não são tratados: sem custo reportado e sem aviso de saída. Mudança: tratar `-1` como dinâmico, expor `expiration_date`, marcar aliases. | `providers` | [#411](https://github.com/patrickbrandao/thinker/issues/411) | aberta |
| G3 | oportunidade | Migrar a base para `https://ai-gateway.kilo.ai/api/v1` (canônica) e unificar as duas constantes duplicadas; a legada segue equivalente. | `providers` | sem issue (baixo valor imediato) | aberta |
| G4 | oportunidade | Repassar `X-KiloCode-TaskId` (chave de prompt cache) e `x-kilocode-mode` (roteamento de `kilo-auto/frontier`) recebidos do harness; hoje nenhum é encaminhado. | `backend-dev` | sem issue | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (kilocode v7.8.25 e catálogo ao vivo). Registradas G1 a G4; issues #408 e #411 já existiam. Pendente de teste ao vivo com chave: formato exato do usage em streaming, `/messages` e equivalência da base legada.
