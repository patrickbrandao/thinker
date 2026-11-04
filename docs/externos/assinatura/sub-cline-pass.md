---
id: sub-cline-pass
categoria: assinatura
entidade: ClinePass
agente: sub-cline-pass
thinker_ids: [cline-pass]
revisado_em: 2026-11-03
versao_observada: cline v4.1.26 (sdk e docs lidos na tag), feed recommended-models 2026-11-03
---

# ClinePass (assinatura)

Especificação mantida pelo agente `sub-cline-pass` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- ClinePass é uma assinatura de US$ 9,99/mês da Cline que dá de 2 a 5 vezes mais uso de modelos abertos de código (GLM, Kimi, DeepSeek, MiMo, MiniMax, Qwen, Muse Spark) do que o preço de API padrão. É um provedor separado do "Cline (usage-billing)".
- O acesso de terceiros é explícito: a documentação oficial tem a seção "Using ClinePass outside of Cline" e manda criar uma chave de API em Settings > API Keys do app.cline.bot e chamar `POST https://api.cline.bot/api/v1/chat/completions` com `model: "cline-pass/<slug>"`. O modelo de Thinker (chave colada, Bearer) bate com isso.
- O protocolo é Chat Completions compatível com OpenAI; só há um endpoint de inferência para todos os modelos.
- A lista de modelos muda rápido: desde a lista embutida no Thinker, 4 modelos foram aposentados e vários entraram. O feed público `recommended-models` é a fonte viva (e o Thinker já a consulta).
- Lacunas abertas: lista de reserva desatualizada (G1) e custo de mercado gravado em plano fixo (G2).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Cline repository (SDK e docs em `docs/`) | <https://github.com/cline/cline> | v4.1.26 (commit a459f1d, 2026-10-25) |
| Cline docs (ClinePass, API) | <https://docs.cline.bot/> (fonte em `docs/` do repositório) | tag v4.1.26 |
| Feed de modelos recomendados (público, sem chave) | <https://api.cline.bot/api/v1/ai/cline/recommended-models> | 2026-11-03 |
| Catálogo models.dev, provedor `cline-pass` | <https://models.dev/api.json> | 2026-11-03 |

## Contrato

### Planos

- Plano único de consumidor: US$ 9,99/mês, assinado em <https://app.cline.bot/dashboard/subscription?personal=true> (docs `getting-started/clinepass.mdx`, v4.1.26).
- Contas de organização não podem usar ClinePass; o backend responde com uma mensagem contendo "organization accounts cannot use individual model inference subscriptions" e o cliente orienta trocar para a conta pessoal (`sdk/packages/llms/src/providers/errors.ts`, v4.1.26).
- O preço fixo vale para os modelos `cline-pass/*`. O feed também traz um balde `free` (modelos gratuitos da Cline, ids como `cline-free/...`, `reflection/beam-free`, `nvidia/...-free`) que o cliente oficial mostra junto no provedor ClinePass.

### Modelos

Feed `clinePass` em 2026-11-03 (todos com prefixo `cline-pass/`): `mimo-v2.6-pro`, `deepseek-v4.1-flash-1017`, `deepseek-v4.1-flash`, `kimi-k3.1-pro`, `minimax-m3.1-flash`, `mimo-v2.6-flash`, `glm-5.3`, `qwen3.8-max`, `deepseek-v4-pro`, `muse-spark-1.3-contributor`, `kimi-k3`, `glm-5.3-flash`, `qwen3.7-plus`, `qwen3.7-max`, `minimax-m3`.

- Aposentados segundo a documentação: `glm-5.2`, `kimi-k2.6`, `kimi-k2.7-code`, `deepseek-v4-flash`; o changelog do SDK diz que `mimo-v2.5` e `mimo-v2.5-pro` também saíram. O padrão do cliente oficial passou a ser `kimi-k3.1-pro`.
- Formato do feed: objeto com as chaves `recommended`, `free`, `clinePass` e `clineCloud`; cada entrada tem `id`, `name`, `description` e `tags`. Requisição sem chave retorna 200; o cliente oficial envia os cabeçalhos `X-CLIENT-*` (abaixo) mesmo assim.
- O id do modelo na requisição é o slug completo, com o prefixo `cline-pass/`.
- Janela de contexto e saída (models.dev, 2026-11-03): a maioria declara 1.000.000 a 1.048.576 de contexto; `kimi-k2.x` tinha 262.144. Saída máxima entre 64.000 e 512.000 conforme o modelo. Não há campo de contexto no feed.

### Autenticação

- Inferência de terceiros: `Authorization: Bearer <chave>`, chave criada em app.cline.bot, Settings > API Keys (docs `api/authentication.mdx`). A chave é a mesma `CLINE_API_KEY` do provedor Cline normal; o acesso ClinePass vem da assinatura da conta pessoal.
- Clientes oficiais usam um token de conta (WorkOS): fluxo de código de autorização local em `/api/v1/auth/authorize`, `/api/v1/auth/token`, `/api/v1/auth/refresh` e device code do WorkOS (`/user_management/authorize/device`), portas de callback 48801 a 48811, renovação com 5 minutos de folga (`sdk/packages/core/src/auth/cline.ts`, v4.1.26). O provedor `cline-pass` guarda as credenciais sob o provedor `cline`. O Thinker não precisa disso porque usa a chave de API.
- Chaves podem ser listadas e removidas por `GET/DELETE https://api.cline.bot/api/v1/api-keys` (docs `api/authentication.mdx`).

### Endpoints

| Uso | Método e URL | Observação |
|---|---|---|
| Chat Completions | `POST https://api.cline.bot/api/v1/chat/completions` | OpenAI-compatível; `stream` tem padrão `true` na documentação; `usage` no último chunk traz `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens` e `cost` |
| Modelos recomendados | `GET https://api.cline.bot/api/v1/ai/cline/recommended-models` | público |
| Busca web (cliente oficial) | `POST https://api.cline.bot/api/v1/search/websearch` | só no SDK da Cline |

- Base do SDK: `https://api.cline.bot/api/v1` (`sdk/packages/llms/src/providers/vendors/cline.ts`). Existem ambientes de staging e local na mesma configuração; não relevantes ao Thinker.
- Raciocínio chega em `delta.reasoning` e, em alguns provedores, em `delta.reasoning_details` (docs `api/models.mdx`). O SDK envia `max_completion_tokens` para modelos de raciocínio (`withMaxCompletionTokensForReasoningModels`).
- Erros no meio do fluxo vêm como chunk com `finish_reason: "error"` e HTTP 200 (docs `api/errors.mdx`).
- O SDK marca o provedor com `responseEnvelope: "success-data"`, mas só desembrulha `{ success, data }` na geração de imagens; o Thinker desembrulha respostas não-streaming de chat quando o formato é inequívoco (mantido, ver Como o Thinker implementa hoje).

### Identificação do cliente

O SDK oficial envia, para `cline` e `cline-pass` (`sdk/packages/llms/src/providers/request-headers.ts` e `cline-client-headers.ts`, v4.1.26): `User-Agent: Cline/<versão>`, `HTTP-Referer: https://cline.bot`, `X-Title: Cline`, `X-CLIENT-TYPE`, `X-CLIENT-VERSION`, `X-PLATFORM`, `X-PLATFORM-VERSION`, `X-CORE-VERSION`, `X-IS-MULTIROOT` e `X-Task-ID` (id da sessão). A documentação da API diz que só `HTTP-Referer`, `X-Title` e `X-Task-ID` são aceitos como opcionais, para rastreio de uso. Não há indício, nas fontes lidas, de bloqueio por versão de cliente ou por User-Agent (não confirmado em tráfego real). O Thinker envia apenas `Authorization` e `Content-Type`.

### Clientes permitidos e termos

- A documentação oficial convida o uso de ClinePass em scripts, apps e automação via API ("Using ClinePass outside of Cline"). Não achei nas fontes lidas cláusula que proíba rotear a chave por um gateway; os termos de serviço em si não foram lidos (não confirmado).
- Risco principal de conta: contas de organização são recusadas; uso intenso consome as janelas abaixo.

### Cotas e uso

- Três limites: janela móvel de 5 horas, limite semanal (semana de calendário) e limite mensal (mês de calendário). O uso restante só é mostrado no painel https://app.cline.bot/dashboard/subscription?personal=true; não há endpoint ou cabeçalho documentado de uso restante.
- Preço de referência por 1M de tokens usado só para medir a cota (docs `clinepass.mdx`): por exemplo GLM-5.3 US$ 1,40/4,40 (cache de leitura 0,26); Kimi K3 US$ 3,00/15,00; DeepSeek V4 Pro US$ 1,32/3,96 em horário de pico e 0,66/1,98 fora de pico; Qwen3.7 Plus US$ 0,40/1,60 até 256K e 1,20/4,80 acima. Isso não é cobrança por token.
- O backend devolve `usage.cost` com o custo de mercado do upstream mesmo no ClinePass; o cliente oficial zera esse valor (ver G2).

### Erros

Formato OpenAI `{ "error": { "code", "message", "metadata" } }` (docs `api/errors.mdx`). Os códigos HTTP documentados são 400, 401, 402, 403, 404, 429, 500, 502 e 503. As condições específicas do ClinePass são reconhecidas pelo cliente oficial pelo texto do corpo, não por código (`errors.ts`, v4.1.26):

| Condição | Trecho do corpo (em minúsculas) | Ação do cliente |
|---|---|---|
| Sem assinatura | "the user is not subscribed to required model plan" ou "no access to clinepass subscription models yet. subscribe to clinepass" | erro "não assinante" |
| Conta de organização | "organization accounts cannot use individual model inference subscriptions" | erro de conta |
| Limite do plano atingido | "you have reached your ... clinepass limit ... please try again later." | erro de limite com a mensagem |
| Limite de modelo gratuito | "free limit reached on model ... try again in <tempo>" | erro de limite gratuito |
| Modelo inexistente | "model not found" | erro de modelo |

Os códigos HTTP exatos dessas respostas não estão nas fontes (não confirmado; exige conta real). 401 significa chave inválida; mid-stream `context_length_exceeded`, `content_filter`, `rate_limit` e `server_error` chegam em HTTP 200.

## Como o Thinker implementa hoje

- Cadastro: provedor `cline-pass`, nome "ClinePass", alias `cline` (`packages/shared/src/providers.ts:134-136`); assinatura por token colado, rótulo "ClinePass subscription" (`packages/shared/src/subscription/configs.ts:357-361`).
- Inferência: base `https://api.cline.bot`, caminho `/api/v1/chat/completions`, formato OpenAI, uso em stream via `stream_options` (`packages/backend/src/routing/proxy/provider-endpoints.ts:323-329`), cabeçalhos só `Authorization: Bearer` e `Content-Type` (`provider-endpoints.ts:86-89`). Sem User-Agent nem cabeçalhos `X-*` da Cline.
- Id do modelo preservado com o prefixo `cline-pass/` (sem remover o segmento antes da barra) em `packages/backend/src/routing/proxy/provider-client.ts:340-352`.
- Envelope `{ success, data }`: desembrulhado nas respostas não-streaming por `unwrapSuccessEnvelope` em `packages/backend/src/routing/proxy/proxy-response-handler.ts:853-865` (chamado na linha 804).
- Descoberta de modelos: `fetchClinePassModels` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:1457-1480`) pega o feed `GET /api/v1/ai/cline/recommended-models` sem chave (linhas 74-76 e 1486-1512), usa só entradas `clinePass` cujo id começa por `cline-pass/`, e cai na lista embutida quando o feed falha. Cada modelo sai com contexto 200000, preços nulos, raciocínio e código verdadeiros, qualidade 3.
- Lista embutida (`configs.ts:362-374`): `glm-5.2`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k3`, `deepseek-v4-pro`, `deepseek-v4-flash`, `mimo-v2.5`, `mimo-v2.5-pro`, `minimax-m3`, `qwen3.7-max`, `qwen3.7-plus`, com `knownModelsMatch: 'exact'`. Capacidades: contexto máximo 200000, sem cache de prompt, sem batch (`configs.ts:376-380`).
- Capacidades e preços: `cline-pass` é provedor "só capacidades" do models.dev (`packages/backend/src/database/models-dev-sync.service.ts:65`), então o models.dev define modalidades e flags, nunca preço (`packages/backend/src/model-discovery/model-capabilities.ts:148`).
- Custo: plano fixo entra como `isSubscription` e custo 0, mas `usage.cost` reportado vence (`packages/backend/src/common/utils/cost-calculator.ts:161-170`, `packages/backend/src/routing/proxy/proxy-message-recorder.ts:481-487`, `packages/backend/src/routing/proxy/stream-writer.ts:101`); só Copilot e OpenCode Go são exceção (ver G2).
- Frontend: cartão do provedor com rótulo de assinatura, link de login `https://app.cline.bot` e link para criar a chave `https://app.cline.bot/settings/api-keys` (`packages/frontend/src/services/providers.ts:235-249`, `packages/frontend/src/services/provider-api-key-urls.ts:6` e `:42`). A página oficial de chaves hoje é Settings > API Keys em app.cline.bot; o caminho `/settings/api-keys` não foi confirmado.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/common/constants/subscription-clients.ts` (sem entrada para `cline-pass`)
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/proxy-response-handler.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/common/utils/cost-calculator.ts`
- `packages/backend/src/routing/proxy/proxy-message-recorder.ts`
- `packages/frontend/src/services/providers.ts`, `packages/frontend/src/services/provider-api-key-urls.ts`, `packages/frontend/src/components/ProviderIcon.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A lista embutida (`configs.ts:362-374`) tem glm-5.2, kimi-k2.6, kimi-k2.7-code, deepseek-v4-flash, mimo-v2.5 e mimo-v2.5-pro, aposentados, e não tem glm-5.3, glm-5.3-flash, deepseek-v4.1-flash, kimi-k3.1-pro, minimax-m3.1-flash, mimo-v2.6-*, qwen3.8-max, muse-spark-1.3-contributor. Vale quando o feed falha e para reconhecer ids. Mudança: atualizar a lista. | providers | [#330](https://github.com/patrickbrandao/thinker/issues/330) | aberta |
| G2 | degradação | `usage.cost` (custo de mercado) vence o ramo de assinatura e é gravado como custo real em `cline-pass`; o cliente oficial zera. Mudança: ignorar o custo reportado para `cline-pass`. | backend-dev | [#331](https://github.com/patrickbrandao/thinker/issues/331) | aberta |
| G3 | oportunidade | Contexto fixo em 200000 para todos os modelos, enquanto o models.dev declara cerca de 1M para quase todos (kimi-k2.x tinha 262144). Mudança: usar contexto e saída do models.dev (provedor `cline-pass`) na descoberta. | providers | — | aberta |
| G4 | oportunidade | Erros do plano (sem assinatura, conta de organização, limite do plano, modelo inexistente) são reconhecidos pelo texto do corpo no cliente oficial; o Thinker os trata como erro genérico. Mudança: classificar esses textos para fallback e mensagem útil. Pede verificação do código HTTP real. | backend-dev | — | aberta |
| G5 | oportunidade | O balde `free` do feed (modelos gratuitos da Cline, sem custo) aparece no provedor ClinePass do cliente oficial, mas o Thinker ignora tudo que não começa por `cline-pass/`. Mudança: opcionalmente listar esses modelos. | providers | — | aberta |
| G6 | oportunidade | O Thinker não envia `X-Title`, `HTTP-Referer` nem `X-Task-ID`, que a Cline usa para rastrear uso; enviar `X-Task-ID` com a chave de sessão e `X-Title: Thinker` melhora a visibilidade do lado da Cline. Não confirmado se é exigido. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: primeira revisão completa. Fontes: cline/cline na tag v4.1.26 (docs e SDK), feed `recommended-models` e models.dev lidos em 2026-11-03. Abertas G1 (#330) e G2 (#331); registradas G3 a G6 como oportunidades sem issue. Pendente com conta real: códigos HTTP dos erros de plano, presença de `usage.cost` nas respostas, aceitação de requisições sem cabeçalhos `X-*`, e termos de serviço sobre gateways.
