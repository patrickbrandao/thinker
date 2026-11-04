---
id: sub-gemini
categoria: assinatura
entidade: Sign in with Google (Gemini Code Assist)
agente: sub-gemini
thinker_ids: [gemini]
revisado_em: 2026-11-03
versao_observada: gemini-cli v0.66.0 (970413207732, 2026-10-27); docs lidas no mesmo commit
---

# Sign in with Google (Gemini Code Assist) (assinatura)

Especificação mantida pelo agente `sub-gemini` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Thinker usa o mesmo caminho do Gemini CLI: OAuth do Google (client público do gemini-cli) e a API interna `cloudcode-pa.googleapis.com/v1internal`, com o envelope `{ model, project, request }`. Os endpoints, o envelope, o client id/secret e os escopos conferem com o gemini-cli v0.66.0.
- **Risco principal:** o Google declara, nos docs do Gemini CLI, que usar software de terceiros (cita OpenClaw, Claude Code, OpenCode) sobre esse OAuth viola os termos e pode suspender a conta. O Thinker não avisa o usuário (G1).
- Lacunas técnicas: lista de modelos desatualizada e sem o mapeamento `gemini-3.5-flash` -> `gemini-3-flash` (G2); onboarding só cobre contas free (G3); 429 de cota diária recebe cooldown curto (G4).
- Oportunidades: ler a cota restante (`retrieveUserQuota`), identificar o cliente (User-Agent, `user_prompt_id`, `session_id`).
- Confiança: alta para endpoints, auth e envelope (lidos no código do cliente oficial); média para modelos aceitos por plano e comportamento de erro (precisa de conta real).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Gemini CLI repository (code_assist) | <https://github.com/google-gemini/gemini-cli> | tag v0.66.0 (2026-10-27, commit 970413207732); `packages/core/src/code_assist/*`, `core/contentGenerator.ts`, `config/models.ts`, `utils/googleQuotaErrors.ts`. Nightly v0.67.0-nightly.20261103 existe, não lido |
| Quotas and pricing | <https://github.com/google-gemini/gemini-cli/blob/main/docs/quota-and-pricing.md> (hoje em `docs/resources/quota-and-pricing.md`) | v0.66.0 |
| Termos e privacidade / FAQ do Gemini CLI | `docs/resources/tos-privacy.md` e `docs/resources/faq.md` no mesmo repositório | v0.66.0 |
| Gemini Code Assist docs | <https://developers.google.com/gemini-code-assist/docs/overview> | não consultado nesta revisão (só os docs do repositório) |

## Contrato

### Planos

Fonte: `docs/resources/quota-and-pricing.md`, v0.66.0.

| Plano (login com Google) | Requisições por usuário por dia |
|---|---|
| Gemini Code Assist for individuals (free) | 1.000 |
| Google AI Pro | 1.500 |
| Google AI Ultra | 2.000 |
| Code Assist Standard (Workspace/Cloud) | 1.500 |
| Code Assist Enterprise / Workspace AI Ultra | 2.000 |

- Há também limite por minuto e a disponibilidade depende da demanda. Planos não listados (Google AI Plus, Workspace AI Standard/Plus) não são suportados.
- Os modelos usados são escolhidos pelo cliente dentro da família Gemini; modelos preview dependem de acesso da conta.
- Ids de tier vistos no código do cliente: `free-tier`, `standard-tier`, `legacy-tier` (`types.ts`, lista parcial; outros ids existem). O tier efetivo é `paidTier.id ?? currentTier.id`.

### Autenticação

Fonte: `packages/core/src/code_assist/oauth2.ts`, v0.66.0.

- Client OAuth "Desktop app" público: id `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`; o secret também é embutido no código (comentário do cliente: não é segredo de fato).
- Escopos: `cloud-platform`, `userinfo.email`, `userinfo.profile`.
- Fluxo loopback: `redirect_uri = http://127.0.0.1:<porta livre>/oauth2callback`, `access_type=offline`, `state` aleatório, **sem** `prompt=consent` e sem PKCE (usa `google-auth-library`). Fluxo por código manual: `redirect_uri = https://codeassist.google.com/authcode` com PKCE S256.
- Endpoints Google padrão: autorização `accounts.google.com/o/oauth2/v2/auth`, token `oauth2.googleapis.com/token` (padrão do `google-auth-library`; não está literal no repositório).
- Refresh: o `google-auth-library` renova o access token com o `refresh_token` guardado; vida útil do access token do Google é de cerca de 1 hora (não confirmado no código, comportamento padrão do Google).
- Variáveis do cliente: `OAUTH_CALLBACK_HOST` (padrão 127.0.0.1), `OAUTH_CALLBACK_PORT`, `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT_ID` (string, nunca o número do projeto).

### Endpoints

Fonte: `code_assist/server.ts`, `setup.ts`, `converter.ts`, v0.66.0. Base: `https://cloudcode-pa.googleapis.com` (`CODE_ASSIST_ENDPOINT`), versão `v1internal`, métodos como `/v1internal:<método>`.

| Método | Uso |
|---|---|
| `POST :loadCodeAssist` | descobre `currentTier`, `paidTier`, `allowedTiers`, `ineligibleTiers`, `cloudaicompanionProject`. Corpo: `{ cloudaicompanionProject?, metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI', duetProject? }, mode? }` (`mode: 'HEALTH_CHECK'` usado para atualizar créditos) |
| `POST :onboardUser` | operação de longa duração. free-tier: sem `cloudaicompanionProject` (enviar projeto dá `Precondition Failed`); demais tiers: com o projeto e `duetProject`. Sondagem a cada 5 s em `GET /v1internal/<operation name>` até `done`; resultado em `response.cloudaicompanionProject.id` |
| `POST :generateContent` / `:streamGenerateContent?alt=sse` | chat. Corpo `{ model, project, user_prompt_id, request: { contents, systemInstruction, tools, toolConfig, generationConfig, safetySettings, session_id, ... }, enabled_credit_types? }`. Resposta `{ response: <Gemini>, traceId?, consumedCredits?, remainingCredits? }` |
| `POST :countTokens` | `{ request: { model: 'models/<id>', contents } }` -> `{ totalTokens }` |
| `POST :retrieveUserQuota` | `{ project, userAgent? }` -> `{ buckets: [{ modelId, remainingAmount, remainingFraction, resetTime, tokenType }] }` |
| `POST :listExperiments`, `:recordCodeAssistMetrics`, `:fetchAdminControls`, `GET :getCodeAssistGlobalUserSetting` | telemetria e flags do cliente; não necessários para um gateway |

- Não há endpoint de listagem de modelos; o cliente tem a lista embutida (`config/models.ts`).
- O cliente repete 3 vezes em 429, 499 e 5xx nas chamadas não streaming.

### Modelos aceitos pelo cliente oficial

Fonte: `packages/core/src/config/models.ts`, v0.66.0.

- Pro: `gemini-2.5-pro` (padrão), `gemini-3-pro-preview`, `gemini-3.1-pro-preview`, `gemini-3.1-pro-preview-customtools`.
- Flash: `gemini-3.5-flash` (base GA), `gemini-3-flash` (legado do CCPA), `gemini-3-flash-preview`, `gemini-3.8-flash` (último, atrás de experimento).
- Flash Lite: `gemini-3.1-flash-lite` (base), `gemini-3.5-flash-lite` (último, atrás de experimento).
- Gemma: `gemma-4-31b-it`, `gemma-4-26b-a4b-it`.
- Mapeamento de saída no backend Code Assist (`getBackendModelMappings`): sem o experimento "latest flash", `gemini-3.5-flash` é enviado como `gemini-3-flash`; com o experimento, `gemini-3.5-flash` e `gemini-3-flash` viram `gemini-3.8-flash` e `gemini-3.1-flash-lite` vira `gemini-3.5-flash-lite`. Os experimentos vêm de `listExperiments`.

### Identificação do cliente

Fonte: `core/contentGenerator.ts` e `code_assist/*`, v0.66.0.

- User-Agent do Gemini CLI: `GeminiCLI/<versão>/<modelo> (<plataforma>; <arch>; <surface>)` (prefixo `GeminiCLI-<cliente>` quando há nome de cliente). Dentro de um IDE VS Code o formato é `CloudCodeVSCode/<versão> (aidev_client; os_type=...; host_path=...; proxy_client=geminicli)`.
- Cabeçalhos extras só por `GEMINI_CLI_CUSTOM_HEADERS` (do usuário). Autorização: `Authorization: Bearer <access token>` (via `google-auth-library`).
- Não há bloqueio por versão de cliente visível no código. O que o backend faz com o User-Agent não é público (não confirmado).
- Cliente oficial que o Thinker espelha: Gemini CLI, versão estável atual v0.66.0.

### Clientes permitidos e termos

Fonte: `docs/resources/tos-privacy.md` e `docs/resources/faq.md`, v0.66.0.

- Acessar o Gemini Code Assist diretamente por software, ferramenta ou serviço de terceiros (exemplo dado: OpenClaw com o OAuth do Gemini CLI) viola os termos e políticas e pode levar à suspensão ou encerramento da conta. O FAQ repete o aviso para Claude Code, OpenClaw e OpenCode e indica chave do Vertex AI ou do Google AI Studio como caminho suportado. Termos aplicáveis: Google Terms of Service, e para planos pagos os termos do Google One ou do Google Cloud.
- Consequência para o Thinker: o roteamento por este OAuth é tráfego de terceiros; ver G1.

### Cotas e uso

- Cotas por dia na tabela de Planos. Leitura do saldo: `POST :retrieveUserQuota` com `{ project }` (buckets por `modelId`). O cliente exibe com `/stats model`.
- Créditos de overage Google One (`G1`): `enabled_credit_types: ['GOOGLE_ONE_AI']` (constante `G1_CREDIT_TYPE`; valor exato não conferido) quando o usuário permite; respostas trazem `consumedCredits` e `remainingCredits`. Não relevante para o Thinker hoje.

### Erros

Fonte: `utils/googleQuotaErrors.ts`, v0.66.0. Corpo no padrão `google.rpc` (`error.details[]`).

| Situação | Sinal | Tratamento do cliente oficial |
|---|---|---|
| Limite por minuto | 429, `ErrorInfo.reason = RATE_LIMIT_EXCEEDED` (domínio `cloudcode-pa.googleapis.com`), `RetryInfo.retryDelay` curto | repetível; se o atraso passar do máximo configurado, terminal |
| Cota diária esgotada | 429, `reason = QUOTA_EXHAUSTED` | terminal (troca de modelo ou desiste) |
| Capacidade do modelo | `MODEL_CAPACITY_EXHAUSTED` / `MODEL_CAPACITY_EXCEEDED` | terminal, dispara fallback de modelo |
| Créditos | `INSUFFICIENT_G1_CREDITS_BALANCE` | terminal |
| Validação de conta | 403, `reason = VALIDATION_REQUIRED`, domínio cloudcode-pa | usuário precisa validar no navegador (`validationUrl`) |
| Projeto exigido | `loadCodeAssist` sem projeto em conta não-free | erro pedindo `GOOGLE_CLOUD_PROJECT` |
| Conta/tier inelegível | `ineligibleTiers[].reasonMessage` | mostra os motivos |
| Modelo fora do plano / não existe | (não confirmado) provavelmente 404 ou 400 | n/d |

## Como o Thinker implementa hoje

Conferido contra o código do worktree `onda2` (commit 0c93e2a) em 2026-11-03.

- **Auth:** OAuth em popup com loopback `http://localhost:1455/auth/callback`, PKCE S256, `access_type=offline` e `prompt=consent` (`gemini-oauth.service.ts:47-55`, `redirect-pkce-oauth.base.ts:132-172`). Client id/secret iguais aos do gemini-cli, montados em runtime para evitar scanners de segredo (`gemini-oauth.service.ts:19-24`), sobrescrevíveis por `GEMINI_OAUTH_CLIENT_ID` / `GEMINI_OAUTH_CLIENT_SECRET`. Escopos iguais ao gemini-cli (`:47-49`). Token em `https://oauth2.googleapis.com/token`, revogação em `/revoke` (`:41-43`).
- **Onboarding:** após a troca de código, `enrichBlob` chama `CodeAssistClientService.onboard` e guarda `cloudaicompanionProject` em `blob.u` (`gemini-oauth.service.ts:63-68`). `loadCodeAssist` com `metadata` fixo `{ideType: IDE_UNSPECIFIED, platform: PLATFORM_UNSPECIFIED, pluginType: GEMINI, pluginVersion: '0.1.0'}` (`codeassist-client.service.ts:31-36`); se faltar projeto ou tier, `onboardUser` com o tier `isDefault` e sondagem a cada 5 s por até 12 vezes (`:26-29`, `:62-92`, `:94-108`). Sem tratamento de `paidTier`, `ineligibleTiers`, `VALIDATION_REQUIRED` nem de `GOOGLE_CLOUD_PROJECT` (G3). O tier retornado é descartado.
- **Refresh:** `unwrapToken` renova com o refresh token e preserva `u` (`redirect-pkce-oauth.base.ts:241-266`, `oauth-credentials.ts:84-91`, `:157-164`).
- **Inferência:** endpoint `gemini-subscription`, base `https://cloudcode-pa.googleapis.com`, cabeçalhos só `Content-Type` e `Authorization: Bearer`, caminhos `/v1internal:generateContent` e `/v1internal:streamGenerateContent` (`?alt=sse` acrescentado pelo cliente), formato `google` com `codeAssistEnvelope` (`provider-endpoints.ts:535-545`). Envelope `{ model, project, request }` em `provider-client.ts:746-751`; desembrulho em `codeassist-envelope.ts` e `proxy-response-handler.ts:532,573,739`. Não envia `user_prompt_id`, `session_id`, `enabled_credit_types` nem User-Agent do gemini-cli (G5).
- **Modelos:** sem listagem upstream (`provider-model-fetcher.service.ts:1113-1118` devolve vazio; cai no cache do OpenRouter). Fallback fixo em `packages/shared/src/subscription/configs.ts:288-305`: `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, janela de 1.000.000 e cache de prompt (G2).
- **Erros e cotas:** 429 cai no cooldown genérico de 15 s quando não há `Retry-After` (`proxy-fallback.service.ts:120-132`); o regex de cota esgotada não cobre `QUOTA_EXHAUSTED` do Google (G4). Não lê `retrieveUserQuota` (G6).
- **Documentação do usuário:** nenhum aviso sobre os termos do Google em `docs/usuario/` nem no dashboard (G1).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts` (sem entrada para gemini)
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/proxy-response-handler.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/oauth/gemini/` (`gemini-oauth.service.ts`, `gemini-oauth.controller.ts`, `codeassist-client.service.ts`, `codeassist-envelope.ts`)
- `packages/backend/src/routing/oauth/core/redirect-pkce-oauth.base.ts`

Arquivos que citam `gemini`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-prices/model-pricing-cache.service.ts`
- `packages/backend/src/playground/playground.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/lib/response-parts.ts`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Termos do Google (`docs/resources/tos-privacy.md`, `faq.md`, v0.66.0) proíbem tráfego de terceiros pelo OAuth do Gemini CLI, com risco de suspensão da conta. Thinker usa o client do gemini-cli e não avisa (`gemini-oauth.service.ts:19-24`, `configs.ts:288`). Sugestão: aviso no fluxo e na doc; decidir manter, proteger por flag ou remover | frontend-dev, docs-ptbr | [#324](https://github.com/patrickbrandao/thinker/issues/324) | aberta |
| G2 | degradação | Lista de modelos desatualizada: faltam `gemini-3-flash`, `gemini-3-pro-preview`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, Gemma 4; `gemini-3.5-flash` não é mapeado para `gemini-3-flash` como faz o cliente oficial (`configs.ts:288-305`, `provider-client.ts:746`) | providers | [#325](https://github.com/patrickbrandao/thinker/issues/325) | aberta |
| G3 | degradação | Onboarding só cobre free-tier: ignora `paidTier`, `ineligibleTiers`, `VALIDATION_REQUIRED`, projeto pelo operador; descarta o tier (`codeassist-client.service.ts:62-92`, `gemini-oauth.service.ts:66`) | providers | [#326](https://github.com/patrickbrandao/thinker/issues/326) | aberta |
| G4 | degradação | 429 `QUOTA_EXHAUSTED` do Google (corpo `google.rpc`, `RetryInfo`) cai no cooldown de 15 s; não reconhece a cota diária (`proxy-fallback.service.ts:120-132`). Não confirmado com conta real | providers | [#327](https://github.com/patrickbrandao/thinker/issues/327) | aberta |
| G5 | oportunidade | Enviar `user_prompt_id`, `session_id` e User-Agent no estilo do gemini-cli; hoje o Thinker manda só Bearer e `Content-Type` e `pluginVersion` fixo `0.1.0`. O efeito no backend não é público; verificar se o Google rejeita ou limita por isso | providers | (sem issue) | aberta |
| G6 | oportunidade | Ler a cota restante por modelo com `:retrieveUserQuota` e mostrar no dashboard/medidor | backend-dev, frontend-dev | (sem issue) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra gemini-cli v0.66.0 (`code_assist/*`, `models.ts`, `googleQuotaErrors.ts`, docs de cota e termos). Endpoints, envelope, client OAuth e escopos conferem com o Thinker. Registradas G1 a G6; issues #324 a #327. Pendente: consultar os docs do Gemini Code Assist em developers.google.com e conferir com conta real quais modelos cada plano aceita.
