---
id: sub-opencode-go
categoria: assinatura
entidade: OpenCode Go
agente: sub-opencode-go
thinker_ids: [opencode-go]
revisado_em: 2026-11-03
versao_observada: docs opencode.ai/docs/go 2026-11-03; opencode v2.2.5
---

# OpenCode Go (assinatura)

Especificação mantida pelo agente `sub-opencode-go` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O OpenCode Go é um plano mensal de modelos abertos e de laboratórios parceiros para agentes de código, cobrado no OpenCode Console. Há três planos (Go US$ 10, Go Plus US$ 40, Go Teams US$ 20 por membro), com a mesma lista de modelos e limites em dólar por modelo.
- A inferência fica em `https://opencode.ai/inference/go`, com um endpoint por protocolo (Chat Completions, Responses, Messages, Google). O catálogo público `GET /inference/go/v1/models` (sem autenticação) traz protocolo, preço, contexto e multiplicadores de cada modelo (28 modelos em 2026-11-03).
- A credencial é o token OAuth do Console (device code, `client_id` `opencode-cli`, refresh rotativo) ou uma chave de API do Console.
- As regras de uso mudaram em relação ao que o ADR 0009 assume: a página do plano pede que o cliente se identifique com **user agent próprio** e envie `x-opencode-session` estável por conversa, e lista Claude Code, Codex, Hermes, Pi e outros como clientes validados. O Thinker, por outro lado, se passa pelo cliente OpenCode (G1).
- O medidor de uso (`/zen/go/v1/usage`) e o fluxo de login do Thinker batem com o código do OpenCode v2.2.5. O que falta é custo exato: preço por contexto longo e multiplicador por data são ignorados (G2, G3).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Página do plano OpenCode Go | <https://opencode.ai/docs/go/> | lida em 2026-11-03 (confirmada; substitui a semente não confirmada) |
| Catálogo público do Go | <https://opencode.ai/inference/go/v1/models> | 2026-11-03, 28 modelos |
| OpenCode repository | <https://github.com/anomalyco/opencode> | tag `v2.2.5` (2026-10-30), commit `9bbb8ce` |
| Skill opencode2-console-access (MCP thinker-routing) | <https://skills.langwizard.net/skills/opencode2-console-access> | derivada de `86ce19d` (2026-10-27); conferida contra v2.2.5 nos pontos citados |
| ADR 0009 (interno) | [0009-opencode-catalogo-proprio-e-modelos-gratuitos.md](../../adr/0009-opencode-catalogo-proprio-e-modelos-gratuitos.md) | 2026-11-02 |

## Contrato

### Planos

Fonte: <https://opencode.ai/docs/go/> (2026-11-03).

| Plano | Preço | Notas |
|---|---|---|
| Go | US$ 10/mês | Workspace de um membro (o Personal criado no cadastro) |
| Go Plus | US$ 40/mês | Mesmos modelos, limites maiores; também só para workspace de um membro |
| Go Teams | US$ 20 por membro/mês | Workspace com vários membros; membro que entra no meio do período paga US$ 20 e recebe a cota cheia; service accounts não são cobertas |

- Go e Go Plus podem virar Go Teams a qualquer momento, com o saldo do mês creditado.
- Os preços por token são iguais em todos os planos; só o limite mensal em dólar por modelo muda.
- Cada modelo tem três janelas: 5 horas = 20% do limite mensal do modelo, semana = 50%, mês = 100%. Cada resposta informa quanto a requisição contou, em `opencode.allowance` (formato exato do campo: não confirmado).
- Ao bater um limite as requisições são bloqueadas, os modelos gratuitos continuam, e o **Extra Usage** (precisa de saldo no Console) faz o Go cair para o pay-as-you-go em vez de bloquear. O Go Teams começa com o Extra Usage ligado.
- Exemplos de limite mensal no Go (a página lista todos): GLM-5.3 US$ 15; Kimi K3 US$ 15; DeepSeek V4.1 Flash US$ 100; GLM-5.3-Flash US$ 60; GPT 6 Luna US$ 15. Os limites variam muito por modelo, então a cota não é um saldo único em dólar.
- Modelos (2026-11-03, a lista muda): grok-4.7, gpt-6-luna, gpt-5.6-luna, claude-haiku-5-5, gemini-4-argon, glm-5.3-flash, glm-5.3, glm-5.2, kimi-k3.1-pro, kimi-k3, kimi-k2.7-code, longcat-2.0, step-5-preview, beam-free, iceman-contributor-free, mimo-v2.6-flash, mimo-v2.6-pro, mimo-v2.5, mimo-v2.5-pro, minimax-m3.1-flash, minimax-m3, muse-spark-1.3-contributor, muse-spark-1.2-contributor, qwen3.8-max, qwen3.8-flash, qwen3.7-plus, deepseek-v4.1-flash, deepseek-v4-pro, hy4-preview, hy3.
- Preços especiais: preço por contexto longo (GPT 6/5.6 Luna acima de 272K, Grok 4.7 acima de 200K, Claude Haiku 5.5 acima de 100K, MiniMax M3 acima de 512K, Qwen3.7 Plus acima de 256K); DeepSeek V4.1 Flash e V4 Pro dobram no horário de pico (01:00-04:00 e 06:00-10:00 UTC, segunda a sexta); Gemini 4 Argon tem 50% de desconto até 2026-11-30 (o catálogo traz um multiplicador `date` fator 2 a partir de 2026-12-01).
- Privacidade: por padrão o workspace bloqueia endpoints pagos que treinam com os dados e só permite as regiões Europa e EUA. Muse Spark 1.x Contributor treina modelos da Meta (regiões limitadas), Iceman Contributor Free pode melhorar o modelo, e DeepSeek Global exige habilitar em Settings > Privacy. Beam Free não funciona em vários países (China, Rússia, Irã e outros).

### Autenticação

Duas credenciais servem ao Go:

1. **Chave de API do Console** (assina o plano, adiciona cobrança e copia a chave; no OpenCode, `/connect` e escolher OpenCode Go). A página não diz o formato do cabeçalho da chamada direta; o código do OpenCode usa `Authorization: Bearer` (OpenAI e Anthropic OAuth) e `x-goog-api-key` (Google).
2. **Login do Console (OAuth device code)**, o mesmo de `opencode auth login opencode` (código do OpenCode v2.2.5, resumido na skill `opencode2-console-access`):
   - `POST https://opencode.ai/console/auth/device/code` com corpo JSON `{"client_id":"opencode-cli","supports_org_scope":true}` devolve `device_code`, `user_code`, `verification_uri_complete` (pode ser relativo), `expires_in`, `interval`.
   - `POST .../auth/device/token` com corpo JSON `{"grant_type":"urn:ietf:params:oauth:grant-type:device_code","device_code":...,"client_id":"opencode-cli"}`. O status HTTP não vale: decide o corpo (`authorization_pending`, `slow_down` soma 5 s, `access_token`, outro `error` é falha).
   - Resposta de sucesso: `access_token`, `refresh_token`, `expires_in`, `org_id` opcional. O token é escopado à organização.
   - Refresh: mesmo endpoint, `{"grant_type":"refresh_token","refresh_token":...,"client_id":"opencode-cli"}`. O refresh token **rotaciona** a cada uso. 400 `invalid_grant` significa sessão encerrada: só novo login recupera, e a credencial não deve ser apagada.
   - O OpenCode renova sob demanda quando faltam 5 minutos ou menos para expirar.
3. Servidor padrão do Console: `https://opencode.ai/console` (o host antigo `console.opencode.ai` é reescrito para ele).

### Endpoints

Base `https://opencode.ai/inference/go`. Cada modelo é servido por um protocolo; o catálogo (`api.<protocolo>.base_url`) é a fonte, e a página diz que todo modelo de texto também funciona pelos outros formatos, com tradução feita pelo Console.

| Protocolo | URL | Modelos (2026-11-03) |
|---|---|---|
| Responses | `/openai/v1/responses` | grok-4.7, gpt-6-luna, gpt-5.6-luna, muse-spark-1.3/1.2-contributor |
| Messages | `/anthropic/v1/messages` | claude-haiku-5-5, minimax-m3, qwen3.8-max, qwen3.8-flash, qwen3.7-plus |
| Google | `/google/v1beta/models/<modelo>` (Gemini 4 Argon) | gemini-4-argon |
| Chat Completions | `/openai/v1/chat/completions` | demais (glm, kimi, deepseek, mimo, minimax-m3.1-flash, longcat, step, hy3/hy4, beam-free, iceman-contributor-free) |
| Catálogo | `GET /v1/models` (público) | todos |

- Autenticação por protocolo no OpenCode v2.2.5 com token OAuth: OpenAI e Responses `Authorization: Bearer`; Anthropic `Authorization: Bearer` mais `anthropic-version: 2023-06-01` (não `x-api-key`); Google `x-goog-api-key` (skill `opencode2-console-access`, citando `packages/ai/src/providers/*`).
- O catálogo traz por modelo: `limit.context`, `limit.output`, `cost.text.input.price` (US$ por milhão), `cache.read`/`cache.write`, `overrides` por contexto (`when.context.gt`), `multipliers` por dia e hora UTC ou por data, `capabilities.reasoning`, `compatibility.reasoning_field` (por exemplo `reasoning_content`), `modalities`.
- Janelas de contexto no catálogo: a maioria 1.000.000 (hy3 256.000, kimi-k2.7-code 262.144, iceman 262.144, grok-4.7 500.000).

### Identificação do cliente

Regras da página do plano (2026-11-03): o cliente deve enviar tráfego típico de agente de código, identificar-se com **user agent próprio** (exemplo `my-coding-agent/1.0`), não com nome genérico de SDK, e enviar um id de sessão estável em `x-opencode-session` por conversa, para otimizar roteamento e cache de prompt.

O que o OpenCode v2.2.5 envia em cada requisição de modelo (`packages/core/src/session/model-request.ts:293-304`, commit `9bbb8ce`):

| Cabeçalho | Valor |
|---|---|
| `User-Agent` | `opencode/<canal>/<versão>/<app>` (`packages/core/src/app.ts`) |
| `x-opencode-client` | nome do app (por exemplo `cli`) |
| `x-opencode-session` | id de afinidade (raiz do grupo de sessões) |
| `x-opencode-session-id`, `x-opencode-parent-session-id` | id da sessão e da mãe (subagente) |
| `x-session-affinity`, `X-Session-Id`, `x-parent-session-id` | afinidade e mãe |
| `x-opencode-project` | id do projeto |

O cabeçalho exigido pela chamada do medidor de uso é `x-opencode-org-id` (não `x-org-id`).

Clientes validados pela página (sem garantia de longo prazo): OpenCode; Hermes v0.21.6 ou posterior (cabeçalho de sessão); Claude Code (cabeçalho nativo); Codex (cabeçalho nativo, mas algumas versões e proxies o descartam, então é preciso preservá-lo ao encaminhar); ZCode; Pi; jcode v0.81.6 ou posterior; Kilo Code CLI (só a CLI, com PR #13752). Problemáticos: DeepSeek Harness, GitHub Copilot Chat, Kimi Code, MiMo Code.

Versão do cliente oficial que o Thinker espelha: OpenCode `v2.2.5` (2026-10-30), a mais recente na data da revisão.

### Clientes permitidos e termos

- O Go é desenhado para o OpenCode e agentes de código semelhantes; o tráfego é monitorado e abuso que degrade o serviço para outros usuários é tratado. Não há texto sobre gateways. Não confirmado: o que ocorre com contas que passam tráfego de vários agentes por um único IP (risco de bloqueio, ver ADR 0009).
- Os limites, a lista de modelos e os preços podem mudar. O Go é voltado a usuários internacionais.

### Cotas e uso

- Medidor: `GET https://opencode.ai/zen/go/v1/usage` com `Authorization: Bearer <access>` e `x-opencode-org-id: <org_id>`. Resposta `{"usage":{"rolling","weekly","monthly"}}`, cada janela com `status` (`ok` ou `rate-limited`), `percent` e `resetsAt` (`packages/core/src/usage-limits.ts`, v2.2.5). 403 significa workspace sem Go. `rolling` corresponde à janela de 5 horas. Sem token a rota responde 401 (testado em 2026-11-03).
- O medidor devolve três janelas agregadas, enquanto a página descreve limites por modelo; como o servidor agrega (ou escolhe o modelo mais restrito) é não confirmado.
- A página traz tabelas de requisições estimadas por janela e plano, com perfis de tokens por requisição.
- Orçamentos do membro: `GET {console}/api/policies/current-budgets` (403 sem orçamentos). Fora do escopo do Thinker (ADR 0009).

### Erros

- A página não documenta códigos. Do código do OpenCode (`packages/core/src/session/to-session-error.ts`): 429 com corpo `GoUsageLimitError` traz `limitName` (janela que recusou: 5 horas, semanal ou mensal) no envelope; `FreeUsageLimitError` e `BudgetLimitError` são os outros dois erros de cota; a mensagem sugere trocar para um modelo gratuito ou ligar o Extra Usage.
- Modelo bloqueado pelas configurações de privacidade do workspace: formato do erro não confirmado.
- Login encerrado: refresh 400 `invalid_grant`; inferência 401/403 pode significar sessão revogada ou política da organização (SSO exigido: 403 `SsoRequired` no `/api/v2/config`).

## Como o Thinker implementa hoje

Revisado em 2026-11-03.

- **Provedor e rótulo.** `opencode-go`, "OpenCode Go (beta)", `subscriptionAuthMode: 'device_code'`, aceita colar uma chave de API (`packages/shared/src/subscription/configs.ts:262-275`). `maxContextWindow` 200000, sem cache de prompt declarado.
- **Login.** `OPENCODE_CONSOLE_SERVER = https://opencode.ai/console`, `CLIENT_ID = 'opencode-cli'`, JSON em `/auth/device/code` e `/auth/device/token`, trata `authorization_pending` e `slow_down` (+5 s) pelo corpo, guarda `{t, r, e, u: org_id}` (`packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts:21-34,106-190`). Refresh rotativo com `refresh_token` no mesmo endpoint e coordenação anti-corrida (`opencode-oauth.service.ts:192-` e `packages/backend/src/routing/oauth/core/`). Confere com v2.2.5.
- **Endpoints.** `OPENCODE_GO_INFERENCE_BASE = https://opencode.ai/inference/go` (`provider-endpoints.ts:195-196`). Quatro entradas por provedor: `opencode-go` (`/openai/v1/chat/completions`), `-responses` (`/openai/v1/responses`), `-anthropic` (`/anthropic/v1/messages`, com `x-api-key` e `Authorization: Bearer`) e `-google` (`/google/v1beta/models/<m>:generateContent` e `:streamGenerateContent`) (`provider-endpoints.ts:607-660`). O protocolo de cada modelo vem do catálogo (`provider-client.ts:649-670`); sem catálogo, a família decide (`provider-client.ts:1069-1077`: `claude-`, `minimax-`/`qwen3.` para Messages, `gpt-`/`grok-`/`muse-` para Responses, `gemini-` para Google, o resto Chat Completions).
- **Catálogo.** `OpencodeCatalogService` lê `https://opencode.ai/inference/go/v1/models` com cache de 1 hora (`opencode-catalog.service.ts:40-43,250-`). Interpreta preço por token, cache, multiplicadores por dia e hora UTC (`parseMultipliers`, `:376-412`) e `free` (preço zero). Não lê `cost.text.*.overrides` (preço por contexto) nem multiplicadores com `when.date` (descartados em `hoursWindow`, `:414-425`).
- **Descoberta.** Os modelos entram como `opencode-go/<id>` com preço 0 por token (a assinatura não mostra preço) e `capabilityCode: true` (`provider-model-fetcher.service.ts:1516-1545`).
- **Custo.** Para `opencode-go` o Thinker grava o equivalente em dólar a preço de lista do catálogo e ignora o custo informado (`opencode-catalog.service.ts:217-229`, `ignoreReportedCost`). Não lê `opencode.allowance`.
- **Identificação.** Todas as requisições do Go e do OpenCode levam `User-Agent: opencode/latest/2.2.5/cli` e `x-opencode-client: cli` (`provider-endpoints.ts:614-625`; `packages/backend/src/common/constants/subscription-clients.ts:25-29`, `OPENCODE_CLIENT_VERSION = '2.2.5'`). Decisão do ADR 0009 (item 5), motivada pelos modelos gratuitos.
- **Sessão.** `x-opencode-session` vai em toda requisição, com o `x-session-key` do chamador ou, sem ele, a chave do agente (`provider-hooks.ts:47-68`). Os cabeçalhos de sessão que o OpenCode envia não são lidos como sessão (issue #318, do agente `harness-opencode`).
- **Cota esgotada.** Um 429 cujo corpo casa `freeusagelimiterror|gousagelimiterror|budgetlimiterror|creditlimitexceeded|insufficient_quota` aciona o fallback e honra o `Retry-After` por até 24 h (`proxy-fallback.service.ts:128-133,790-800`). Sem `Retry-After` vale o padrão de 15 s.
- **Medidor.** `readGoUsage` chama `OPENCODE_GO_USAGE_URL = https://opencode.ai/zen/go/v1/usage` com Bearer e `x-opencode-org-id`, 403 vira `null`, e o painel mostra as janelas `rolling`, `weekly` e `monthly` só ao abrir a página (`opencode-oauth.service.ts:24-25,293-340`; `opencode-oauth.controller.ts:32`). Só existe para login OAuth, que é quem guarda o `org_id`; chave de API colada não tem medidor.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/oauth/opencode/` (`opencode-oauth.service.ts`, `opencode-oauth.controller.ts`)

Arquivos que citam `opencode-go`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/published-gateway-models.ts`
- `packages/backend/src/routing/model.controller.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/frontend/src/components/ProviderDetailView.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/components/OpenCodeSetup.tsx`
- `packages/frontend/src/services/api/oauth.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A página do plano manda o cliente se identificar com user agent próprio e valida Claude Code, Codex, Hermes e outros com a identidade deles; o Thinker envia `opencode/latest/2.2.5/cli` e `x-opencode-client: cli` também no Go pago, onde não há modelo gratuito que exija isso. Risco de ação na conta (tráfego monitorado, UA que não bate com o cliente real, IP agregando agentes). Arquivos: `provider-endpoints.ts:614-625`, `subscription-clients.ts:25-29`, ADR 0009 item 5. Sugestão: UA próprio (`thinker/<versão>`) no `opencode-go`, identidade OpenCode só no provedor `opencode`. | providers | [#321](https://github.com/patrickbrandao/thinker/issues/321) | fechada: decisão mantida em #454 e ADR 0009 (cabeçalhos alinhados ao cliente OpenCode) |
| G2 | degradação | O custo do Go (equivalente em dólar a preço de lista) ignora `cost.text.*.overrides`: Grok 4.7 (acima de 200K), GPT 6 e 5.6 Luna (272K), Claude Haiku 5.5 (100K), MiniMax M3 (512K) e Qwen3.7 Plus (256K) custam o dobro ou mais em contexto longo. Mesmo problema já aberto para o provedor `opencode` pelo agente `api-opencode`. Arquivo: `opencode-catalog.service.ts:337-370`. | providers | [#317](https://github.com/patrickbrandao/thinker/issues/317) (aberta por `api-opencode`) | resolvida (faixa por contexto e multiplicador por data lidos do catálogo) |
| G3 | degradação | O catálogo do Go usa um multiplicador por data (`when.date.gte`), fator 2 do gemini-4-argon a partir de 2026-12-01, que o parser descarta; o custo fica pela metade a partir dessa data. Arquivo: `opencode-catalog.service.ts:376-425`. | providers | [#319](https://github.com/patrickbrandao/thinker/issues/319) (aberta por `api-opencode`) | resolvida (faixa por contexto e multiplicador por data lidos do catálogo) |
| G4 | degradação | O Go pede um `x-opencode-session` estável por conversa para roteamento e cache; sem `x-session-key` o Thinker usa a chave do agente, juntando todas as conversas numa sessão, e os cabeçalhos de sessão dos harnesses (`x-session-affinity`, `X-Session-Id`, `x-opencode-session-id`) não são lidos. Arquivos: `provider-hooks.ts:47-55`, `proxy.controller.ts:277`. | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) (aberta por `harness-opencode`) | resolvida (sessão de prompt cache e momentum lida dos cabeçalhos do harness) |
| G5 | oportunidade | Cada resposta informa o consumo da cota em `opencode.allowance`, que depende do limite mensal de cada modelo e difere do preço de lista; o Thinker estima pelo preço de lista. Ler o campo daria o consumo real da cota (formato do campo não confirmado: precisa de resposta real). Com Extra Usage ligado, o excesso é cobrado como pay-as-you-go e hoje não há como distinguir. | providers | — | aberta |
| G6 | oportunidade | O 429 `GoUsageLimitError` traz `limitName` (5 horas, semanal, mensal); o Thinker só faz cooldown pelo `Retry-After` (padrão de 15 s quando ausente). Usar `limitName` e o medidor para travar a rota até `resetsAt` evita repetir chamadas. Presença do `Retry-After` nesse erro: não confirmado. | backend-dev | — | aberta |
| G7 | oportunidade | Modelos do catálogo podem estar bloqueados pelas configurações de privacidade do workspace (Muse Spark e Iceman Contributor treinam com dados, DeepSeek Global exige habilitar) ou por região (Beam Free); a descoberta lista todos e o erro desses bloqueios não é conhecido. Precisa de conta real para ver o erro e então reconhecê-lo no fallback. | providers | — | aberta |
| G8 | oportunidade | Chave de API colada não tem medidor de uso (o `org_id` só vem do login OAuth). Não confirmado se `/zen/go/v1/usage` aceita a chave de API sem `x-opencode-org-id`. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Fontes: página do plano (lida na íntegra), catálogo público do Go (28 modelos), código do OpenCode v2.2.5 (commit `9bbb8ce`), skill `opencode2-console-access`. Descobertas: lista de planos (Go, Go Plus, Go Teams), regras de identificação do cliente, clientes validados, Extra Usage, limites por modelo, multiplicador por data e preço por contexto no catálogo. Abertos G1-G8 (issue nova só para G1; G2 a G4 reaproveitam as issues #317, #319 e #318 de outros agentes).
