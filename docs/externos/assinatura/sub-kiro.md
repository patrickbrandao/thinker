---
id: sub-kiro
categoria: assinatura
entidade: Kiro
agente: sub-kiro
thinker_ids: [kiro]
revisado_em: 2026-11-03
versao_observada: docs kiro.dev 2026-11-03 (Kiro CLI 3.0.0); código de referência aws/amazon-q-developer-cli v1.19.7 (cf39ab6)
---

# Kiro (assinatura)

Especificação mantida pelo agente `sub-kiro` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Thinker usa o fluxo de código de dispositivo do AWS SSO OIDC (o mesmo do `kiro-cli login --use-device-flow`) e chama a API CodeWhisperer em `q.us-east-1.amazonaws.com` com `Authorization: Bearer` e `x-amz-target`. O formato (endpoint, targets, escopos, start URL) confere com o único código de cliente público disponível, o `amazon-q-developer-cli` v1.19.7 (antecessor do Kiro CLI).
- **O Kiro CLI atual (3.0.0, 2026-11-03) é código fechado**: não há fonte do cliente oficial para conferir headers, versão de cliente ou `profileArn` atuais. Tudo o que depende disso está `(não confirmado)` e precisa de checagem ao vivo.
- Cobrança é por **créditos** (não tokens): Free 50, Pro 1.000 ($20), Pro+ 2.000 ($40), Pro Max 5.000 ($100), Power 10.000 ($200). Cada modelo tem multiplicador de crédito. O Thinker grava preço 0 e ignora o `meteringEvent`.
- Lacuna aberta com issue: lista de modelos conhecidos desatualizada, com Sonnet 4.0 (EOL em 2026-10-14) (G1, #335).
- Oportunidades: autenticar com `KIRO_API_KEY` (planos pagos), contabilizar créditos pelo `meteringEvent`, avisar sobre risco de suspensão.
- Confiança: alta para planos, modelos e o fluxo OIDC; média/baixa para headers, `profileArn`, erros e termos (sem fonte primária pública).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Kiro docs | <https://kiro.dev/docs/> | 2026-11-03 |
| Pricing | <https://kiro.dev/pricing/> | 2026-11-03 |
| Modelos (multiplicadores) | <https://kiro.dev/docs/models/> | 2026-11-03 |
| Modelos (ciclo de vida) | <https://kiro.dev/docs/models/available-models/> | 2026-11-03 |
| Autenticação | <https://kiro.dev/docs/getting-started/authentication/> | 2026-11-03 |
| Modo headless / API key | <https://kiro.dev/docs/cli/headless/> | 2026-11-03 |
| Changelog do CLI | <https://kiro.dev/changelog/cli/> | 3.0.0 (2026-11-03) |
| Código do cliente (antecessor, só leitura) | <https://github.com/aws/amazon-q-developer-cli> | v1.19.7 (cf39ab6, 2025-11-17) |
| Issues do Kiro (suspensões, pistas) | <https://github.com/kirodotdev/Kiro/issues> | 2026-11-03 (não confirmado) |

## Contrato

### Planos

Fonte: <https://kiro.dev/pricing/> (2026-11-03).

| Plano | Preço/mês | Créditos/mês | Modelos |
|---|---|---|---|
| Free | $0 | 50 | pesos abertos e Auto, Sonnet 4.5 |
| Pro | $20 | 1.000 | todos os pagos |
| Pro+ | $40 | 2.000 | idem |
| Pro Max | $100 | 5.000 | idem |
| Power | $200 | 10.000 | idem |
| Enterprise | sob consulta | — | idem; excedente de $0,04/crédito, desligado por padrão |

- Crédito adicional: $0,04 (pacotes de $5 = 125 créditos a $100), expira em 12 meses. Créditos do plano não acumulam; reset no início do ciclo de cobrança.
- Primeiro upgrade para Pro: restante do mês grátis + 500 créditos de teste (12 meses), consumidos só depois dos créditos do plano.
- Uso é medido com 2 casas decimais, mínimo 0,01 crédito, atualizado a cada 5 minutos no mínimo.
- Multiplicadores (<https://kiro.dev/docs/models/>): Auto 1,0x (base); Sonnet 4.x/5.x 1,3x; Opus 4.6-4.8 e 5 2,2x, Opus 5.5 2,0x; Haiku 4.5 0,4x; Haiku 5.5 0,06x (0,3x acima de 100K); GPT-5.6 Sol 4,4x, Terra 2,2x, Luna 0,6x (dobra acima de 272K); Kimi K3 2,4x; DeepSeek 3.2 0,25x; MiniMax M2.5 0,25x, M2.1 0,15x; GLM-5 0,5x; Qwen3 Coder Next 0,05x; Fable 5.1 6x (só Enterprise com governança, só us-east-1).
- Disponível no Free: Auto, Sonnet 4.5, Sonnet 4.0 (EOL), DeepSeek 3.2, MiniMax M2.5/M2.1, GLM-5, Qwen3 Coder Next. Demais: planos pagos.

### Modelos e contexto

- Contexto de 1M: GPT-5.6, Fable 5.1, Opus 5.5/5/4.8/4.7/4.6, Sonnet 5.5/5/4.6, Haiku 5.5, Kimi K3. 200K: Opus 4.5, Sonnet 4.5, Haiku 4.5, MiniMax M2.x, GLM-5. DeepSeek 3.2 128K; Qwen3 Coder Next 256K; Auto sem valor publicado.
- Regiões: "US" (N. Virginia, Oregon, Ohio) e "EU" (6 regiões); Kimi K3, DeepSeek 3.2 e GLM-5 só US.
- Ciclo de vida (<https://kiro.dev/docs/models/available-models/>): Sonnet 4.0 EOL em **2026-10-14**; modelo removido passa a falhar e o Kiro não troca o modelo sozinho. Haiku 5.5, Kimi K3, DeepSeek 3.2, MiniMax M2.1 e Qwen3 Coder Next estão "Experimental". Os ids de API não são publicados nos docs (só nomes de exibição); vêm de `ListAvailableModels`.

### Autenticação

- Métodos de login (<https://kiro.dev/docs/getting-started/authentication/>): GitHub, Google, AWS Builder ID, AWS IAM Identity Center e IdP externo. Social e Builder ID são contas "individuais". Fluxo de dispositivo funciona com Builder ID, IAM Identity Center, Google e GitHub (IdP externo não). Organizações podem desativar o device flow.
- Fluxo AWS SSO OIDC (código do cliente v1.19.7, `crates/chat-cli/src/auth/builder_id.rs` e `consts.rs`): `POST https://oidc.<região>.amazonaws.com/client/register` (cliente público), `/device_authorization` com `startUrl` (padrão `https://view.awsapps.com/start`), `/token` com grant `urn:ietf:params:oauth:grant-type:device_code` e refresh com `refresh_token`. Escopos do cliente v1.19.7: `codewhisperer:completions`, `codewhisperer:analysis`, `codewhisperer:conversations` (os escopos `taskassist` e `transformations` estão comentados). Região padrão `us-east-1`.
- O login social (Google/GitHub) do Kiro usa um serviço de autenticação próprio da Kiro em vez do OIDC da AWS `(não confirmado)`; o comentário do Thinker de que a página `view.awsapps.com/start` cobre todos os métodos de login não foi confirmado.
- Tempo de vida do access token e rotação do refresh token: não documentados (o Thinker lê `expiresIn` e aceita refresh token novo, ver abaixo).
- **API key** (`KIRO_API_KEY`): CLI 2.0 (2026-04-13) em diante, para modo headless/CI. Só Pro, Pro+, Pro Max e Power; em contas gerenciadas por admin precisa ser habilitada (desligada por padrão). Chave gerada no portal Kiro, ligada ao usuário. Formato, endpoint, headers e validade não são documentados (<https://kiro.dev/docs/cli/headless/>).

### Endpoints

- Inferência: `POST https://q.us-east-1.amazonaws.com/` com `Content-Type: application/x-amz-json-1.0` e `x-amz-target` escolhendo a operação (v1.19.7: `crates/chat-cli/src/api_client/endpoints.rs`). Operações em uso: `AmazonCodeWhispererStreamingService.GenerateAssistantResponse` (chat, resposta em event stream AWS) e `AmazonCodeWhispererService.ListAvailableModels`. Protocolo único (conversationState), não há OpenAI/Anthropic nativos.
- A entrada do cliente v1.19.7 também envia `profileArn` quando há perfil selecionado (`api_client/mod.rs`); se o Kiro atual exige `profileArn` para contas social/IAM Identity Center não está documentado `(não confirmado)`.
- Região de inferência: documentos listam geografias US/EU e "Global" (GPT-5.6); o endpoint por região usado pelo Kiro atual não é público `(não confirmado)`.

### Identificação do cliente

- O cliente v1.19.7 usa o SDK AWS com `app_name` e um interceptor de User-Agent próprio, e envia `x-amzn-codewhisperer-optout`. O Kiro CLI 3.0.0 é fechado: User-Agent, `x-amzn-kiro-agent-mode` (que o Thinker envia) e eventuais gates de versão não puderam ser verificados `(não confirmado)`.
- Campo `origin` no corpo: o Thinker usa `KIRO_CLI`; valor aceito pelo servidor atual não documentado.

### Clientes permitidos e termos

- Nenhuma fonte primária encontrada que trate de uso por gateway/terceiros com token OAuth do Kiro. O modo headless com `KIRO_API_KEY` é o caminho oficial para automação (planos pagos).
- Issues públicas relatam contas "temporarily suspended" por "atividade incomum" (kirodotdev/Kiro #4963, #6685, #9244, #11397, #12203), sem causa atribuída e sem relação provada com proxy `(não confirmado)`. Tratar como risco de suspensão não quantificado. Quem usa o Thinker registra um cliente OIDC próprio ("Thinker") e não se identifica como o Kiro.

### Cotas e uso

- Cota é em créditos por ciclo (ver Planos). O CodeWhisperer expõe operação de uso (`GetUsageLimits`) usada pelo IDE/CLI `(não confirmado, sem fonte neste review)`.
- O event stream traz `meteringEvent` (gasto em créditos), que o Thinker ignora. Não há contagem de tokens, então o Thinker estima tokens por caracteres (~4 chars/token).

### Erros

- Fim de cota mensal: HTTP 429 com `__type: ThrottlingException`, `reason: MONTHLY_REQUEST_COUNT` e mensagem "Maximum Request reached for this month." (v1.19.7: `api_client/retry_classifier.rs`, `mod.rs`). Esse formato vem do cliente antigo; o Kiro com créditos pode ter mudado `(não confirmado)`.
- Token inválido/expirado, cliente rejeitado e modelo fora do plano: formatos não documentados `(não confirmado)`. Modelo removido (EOL) falha sem fallback.

## Como o Thinker implementa hoje

- Provedor `kiro`, assinatura por código de dispositivo, sem chave (`packages/shared/src/providers.ts:261-272`, `requiresApiKey: false`) e `subscriptionAuthMode: 'device_code'` (`packages/shared/src/subscription/configs.ts:217-239`).
- Lista conhecida de modelos (fallback): `kiro/auto`, `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`, `deepseek-3.2`, `minimax-m2.5`, `minimax-m2.1`, `glm-5`, `qwen3-coder-next`; `maxContextWindow` 1000000 e `supportsPromptCaching: true` (`configs.ts:222-237`). Inferência de provedor por prefixo `kiro/` em `packages/shared/src/provider-inference.ts:29`.
- OIDC (`packages/backend/src/routing/oauth/kiro/kiro-oidc.ts:23-48`): região `us-east-1`, start URL `https://view.awsapps.com/start`, `clientName` "Thinker", `clientType` public, 5 escopos (`completions`, `analysis`, `conversations`, `taskassist`, `transformations`); configurável por `KIRO_OIDC_REGION`, `KIRO_START_URL`, `KIRO_OAUTH_SCOPES` (`kiro-oauth.service.ts:91-102`).
- Login: `registerClient` -> `device_authorization` -> poll em `/token` com `slow_down` (+5 s) e `authorization_pending` (`kiro-oauth.service.ts:107-215`). O blob guardado tem `source: 'kiro-oidc'`, token, refresh token, expiração, `cid`/`cs` e região.
- Refresh: renova quando faltam menos de 60 s, com `grantType: refresh_token` e `clientId`/`clientSecret` guardados; mantém o refresh token antigo se o novo não vier; coordenação por lock (`kiro-oauth.service.ts:218-247`, `321-346`).
- Inferência: `KIRO_BASE_URL = https://q.us-east-1.amazonaws.com`, target `GenerateAssistantResponse`, headers `Authorization: Bearer`, `Content-Type: application/x-amz-json-1.0`, `x-amz-target` e `x-amzn-kiro-agent-mode: SUPERVISED` (`kiro-adapter.ts:8-10`, `51-57`, `1176-1183`). Sem User-Agent próprio e sem `profileArn`.
- Corpo: `conversationState` (`conversationId` aleatório, `history`, `currentMessage`, `chatTriggerType: 'MANUAL'`) e `agentMode: SUPERVISED`, `origin: KIRO_CLI` em cada mensagem de usuário (`kiro-adapter.ts:212-225`, `655-676`). Converte OpenAI Chat para o formato Kiro, sanitiza ferramentas (nome <= 64, descrição <= 10237) e lê o event stream de volta para OpenAI (stream e não-stream).
- Uso: sem contagem de tokens do Kiro; estimativa por caracteres; `meteringEvent` ignorado (`kiro-adapter.ts:22`, `30-37`, `880`). Preço dos modelos gravado como 0 (`parseKiroModels`, `kiro-adapter.ts:86-110`).
- Descoberta de modelos: `ListAvailableModels` com `origin: KIRO_CLI`, `maxResults: 100`, paginação por `nextToken` até 10 páginas; contexto lido de `tokenLimits`, padrão 200000 e 1000000 para `auto` (`provider-model-fetcher.service.ts:1407-1455`, `kiro-adapter.ts:70-84`).
- Endpoint do provedor: `format: 'kiro'`, despachado para `forwardKiroChat` (`provider-endpoints.ts:601-606`, `provider-client.ts:453-475`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/common/constants/subscription-clients.ts` (sem entrada para o Kiro)
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/kiro-adapter.ts`
- `packages/backend/src/routing/oauth/kiro/` (`kiro-oauth.service.ts`, `kiro-oauth.controller.ts`, `kiro-oidc.ts`)
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/DeviceCodeDetailView.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `knownModels` do Kiro (`configs.ts:222-231`) tem `kiro/claude-sonnet-4` (EOL 2026-10-14) e não tem os modelos lançados desde fev/2026 (Sonnet 5/5.5, Opus 4.7/4.8/5/5.5, Haiku 5.5, GPT-5.6, Kimi K3). A descoberta ao vivo cobre contas conectadas; o fallback fica velho. Sugestão: remover Sonnet 4.0, incluir os ativos (ids exatos via `ListAvailableModels`), revisar contexto por modelo | providers | [#335](https://github.com/patrickbrandao/thinker/issues/335) | resolvida (lista de modelos atualizada) |
| G2 | oportunidade | Aceitar `KIRO_API_KEY` (Pro/Pro+/Pro Max/Power) como credencial além do device flow, a via oficial para automação. Falta confirmar endpoint e header que a chave usa | providers | — | aberta |
| G3 | oportunidade | Contabilizar créditos: `meteringEvent` é ignorado e o preço é 0; multiplicadores por modelo estão publicados. Permitiria custo e cota restante reais por assinatura | backend-dev | — | aberta |
| G4 | oportunidade | Avisar o usuário no cadastro do Kiro sobre o risco de suspensão relatado por usuários e a ausência de termos que cubram tráfego via gateway (comparar com #324 do Gemini) | frontend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Docs de preços, modelos, autenticação e headless lidos; Kiro CLI 3.0.0 (fechado) sem fonte; contratos de rede conferidos contra `amazon-q-developer-cli` v1.19.7. Aberta a issue #335 (G1). G2-G4 registradas como oportunidade, sem issue.
