---
id: sub-xai
categoria: assinatura
entidade: Grok subscription
agente: sub-xai
thinker_ids: [xai]
revisado_em: 2026-11-03
versao_observada: grok-build 1.0.45 (xai-org/grok-build, commit 2bdd1d6a, 2026-09-29); docs.x.ai/models 2026-11-03
---

# Grok subscription (assinatura)

Especificação mantida pelo agente `sub-xai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- A assinatura Grok (SuperGrok, X Premium+) é usada pelo CLI oficial **Grok Build** (`grok`, código aberto em `xai-org/grok-build`). Login OAuth em `auth.x.ai` com client público; a inferência vai para o **proxy do CLI**, `https://cli-chat-proxy.grok.com/v1` (protocolo Responses), não para `api.x.ai`.
- O Thinker já faz o OAuth corretamente (client id, endpoints, PKCE, nonce), mas **envia o token da assinatura para `api.x.ai`** sem os cabeçalhos do cliente. Relatos independentes dizem que `api.x.ai` rejeita bearer de assinatura (402/403). Provável quebra total da inferência por assinatura (G1, não confirmada com conta real).
- Escopos incompletos (G2) e descoberta/lista de modelos presa a `api.x.ai` (G3).
- Termos de uso sobre tráfego de terceiros: sem fonte primária lida (a página de termos devolveu 403). xAI anuncia integração oficial com OpenCode e Kilo Code usando o mesmo login, mas há relatos de allowlist por plano (403) (não confirmado).
- Confiança: alta para auth, endpoints e cabeçalhos (código do cliente oficial); baixa para planos, limites e termos (sem fonte primária acessível).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Grok Build (código do cliente) | <https://github.com/xai-org/grok-build> | 1.0.45 (2026-09-29), commit 2bdd1d6a; sem releases no GitHub, só `CHANGELOG.md` em `crates/codegen/xai-grok-shell/` |
| xAI docs: visão geral e modelos | <https://docs.x.ai/docs/overview>, <https://docs.x.ai/docs/models> | 2026-11-03 |
| Changelog do Grok Build | <https://x.ai/build/changelog> | não lido (403) |
| Termos de uso xAI | <https://x.ai/legal/terms-of-service> | não lido (403) |
| Anúncios de integração | <https://x.ai/news/grok-opencode>, <https://x.ai/news/grok-kilocode> | 2026-11-03 (resumo) |
| Implementações de terceiros (pistas) | pi-grok (stnly), Hermes docs, shunt `docs/m6-xai-provider.md` | 2026-11-03, `(não confirmado)` onde divergem do código oficial |
| Grok plans (semente) | <https://x.ai/grok> | descartada: sem conteúdo útil nesta revisão |

## Contrato

### Planos

- Assinatura exigida: SuperGrok ou X Premium+ (anúncio OpenCode). O changelog do CLI cita também o tier "SuperGrok Plus" (`xai-grok-shell/changelogs/0.2.113.md`). Relatos dizem que o acesso OAuth já foi restrito por plano (Heavy) e que contas sem direito recebem 403 mesmo após login (Hermes docs, shunt) `(não confirmado)`.
- Preços e limites por plano: não encontrados em fonte primária.

### Autenticação

Fonte: `xai-grok-login` em grok-build 1.0.45.

- Emissor `https://auth.x.ai` (descoberta OIDC em `/.well-known/openid-configuration`); endpoints usados pelo Thinker: `/oauth2/authorize`, `/oauth2/token`, `/oauth2/revoke`, e `/oauth2/device/code` no device flow.
- Client público: `b1a00492-073a-47ea-816f-4c329264a828`, sem secret.
- Escopos do cliente atual: `openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write` (`config.rs`, `default_oauth2_scopes`). `grok-cli:access` autoriza o token no proxy.
- Dois fluxos: navegador (PKCE S256, `state`, `nonce`, redirect `http://127.0.0.1:<porta>/callback`; em produção o CLI usa porta aleatória, 56121 só em modo dev local) e device code (RFC 8628, com `referrer=grok-build` e cabeçalhos `x-grok-client-version` e `x-grok-client-surface`).
- Refresh: grant `refresh_token` com `client_id`; o refresh token é **rotativo** (relato shunt, `(não confirmado)` no código); access token curto (cerca de 15 min, relato shunt); o cliente renova 5 minutos antes de expirar.

### Endpoints

- Inferência da assinatura: `POST https://cli-chat-proxy.grok.com/v1/responses` (Responses). Base configurável por `GROK_CLI_CHAT_PROXY_BASE_URL`. O CLI também fala `chat/completions` nesse host (teste em `shell-base/src/util/mod.rs`), mas o fluxo principal é Responses.
- Catálogo de modelos: `GET https://cli-chat-proxy.grok.com/v1/models` (`model_source/oai.rs`).
- Conta e uso no proxy: `GET /v1/user` (`include=subscription` visto em terceiros), `GET /v1/billing?format=credits` (créditos e período), `GET /v1/settings` (plano, flags). Exigem os mesmos cabeçalhos.
- API de desenvolvedor (chave `xai-...`): `https://api.x.ai/v1`, cobrança por token; é o caminho do provedor `xai` por chave, separado da assinatura.

### Identificação do cliente

Para bases do proxy, o cliente oficial envia (`agent/config.rs`, `inject_url_derived_headers`; `login/grok_auth_credentials.rs`; `http/lib.rs`):

| Cabeçalho | Valor |
|---|---|
| `Authorization` | `Bearer <access_token>` |
| `X-XAI-Token-Auth` | `xai-grok-cli` |
| `x-authenticateresponse` | `authenticate-response` |
| `x-grok-client-version` | versão do CLI (1.0.45 neste commit; pi-grok usa 1.0.46 como fallback) |
| `x-grok-client-mode` | `interactive` ou `headless` |
| `x-grok-client-identifier` | `grok-shell` (em parte das chamadas) |
| `User-Agent` | `grok-shell/<versão>` com origem e plataforma |

Terceiros acrescentam `x-grok-conv-id` (sessão) e `x-grok-model-override` (modelo escolhido) `(não confirmado no código lido)`. Não há gate de versão mínima visível no código aberto.

### Clientes permitidos e termos

- xAI anuncia o login por assinatura em OpenCode e Kilo Code (páginas x.ai/news). Isso indica tolerância a clientes de terceiros que usam o mesmo fluxo, mas não há texto de termos lido. Risco de ação sobre a conta ao rotear pelo gateway: desconhecido. Verificar `x.ai/legal/terms-of-service` manualmente.

### Cotas e uso

- Créditos semanais/mensais lidos em `/v1/billing?format=credits` e `/v1/billing` (campos vistos em terceiros: `creditUsagePercent`, `currentPeriod`, `monthlyLimit`, `used`). Preço de busca web hospedada cobrado à parte, mesmo em assinatura (shunt) `(não confirmado)`.

### Erros

- 401: reautenticar (o CLI faz um refresh e repete). 402: saldo de créditos esgotado. 403: sem permissão (plano sem acesso ao endpoint, ou token enviado ao host errado). 404: modelo fora da lista do usuário. 429: limite do plano atingido, tentar depois (`error_display.rs`).
- Modelos (catálogo público, docs.x.ai 2026-11-03): `grok-4.7`, `grok-4.6`, `grok-4.5` (500k), `grok-4.3`, `grok-4.20-0309-*` (1M), `grok-build-0.1` (256k). Na assinatura o proxy mapeia para variantes `-build` (ex.: `grok-4.7-build`, `grok-4.7-build-fast`, relato pi-grok e testes do CLI). Nenhuma aposentadoria anunciada.

## Como o Thinker implementa hoje

- OAuth no navegador via popup, `RedirectPkceOauthBaseService`: client `b1a00492-...` (sobrescrevível por `XAI_OAUTH_CLIENT_ID`), `authorize` `https://auth.x.ai/oauth2/authorize`, token `.../oauth2/token`, revoke `.../oauth2/revoke`, escopo `openid profile email offline_access grok-cli:access api:access`, redirect `http://127.0.0.1:56121/callback`, nonce, `Accept: application/json` (`packages/backend/src/routing/oauth/xai/xai-oauth.service.ts:8-35`). Refresh genérico com `grant_type=refresh_token` e `client_id` (`core/redirect-pkce-oauth.base.ts:241-253`).
- Não há endpoint de assinatura para o xai: a chave `xai` aponta para `https://api.x.ai` com `openaiHeaders` (só Bearer) e `xai-responses` para `/v1/responses` na mesma base (`packages/backend/src/routing/proxy/provider-endpoints.ts:385-397`); `resolveSubscriptionEndpointKey` não tem entrada para xai (`proxy/provider-hooks.ts:32`, chamado em `provider-client.ts:596-598`). Modelos `grok-*multi-agent*` vão para Responses (`common/constants/xai-models.ts`, `provider-client.ts:619-623`).
- Descoberta de modelos: `https://api.x.ai/v1/models` com o token da assinatura (`model-discovery/provider-model-fetcher.service.ts:947`); fallback curado `grok-4.7`, `grok-4.6`, `grok-4.5`, contexto máximo 500000, cache de prompt sim (`packages/shared/src/subscription/configs.ts:311-321`).
- Rótulo "Grok subscription", `popup_oauth` (mesmo arquivo, linhas 311-315). UI: `packages/frontend/src/components/OAuthDetailView.tsx:209,317,376`.
- Sem leitura de uso/créditos, sem identificação do cliente Grok.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/common/constants/xai-models.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/oauth/xai/` (service, controller)
- `packages/backend/src/routing/oauth/core/redirect-pkce-oauth.base.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/frontend/src/components/OAuthDetailView.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | quebra | Token da assinatura vai para `api.x.ai` sem cabeçalhos; o cliente oficial usa `cli-chat-proxy.grok.com` com `X-XAI-Token-Auth`, `x-authenticateresponse`, `x-grok-client-*`. Criar endpoint `xai-subscription`(+`-responses`). Precisa de teste com conta real | providers | [#354](https://github.com/patrickbrandao/thinker/issues/354) | resolvida (endpoint xai-subscription em cli-chat-proxy.grok.com com cabeçalhos do Grok CLI; aviso de risco na doc) |
| G2 | degradação | Faltam escopos `conversations:*`, `workspaces:*` e `referrer=grok-build` | providers | [#355](https://github.com/patrickbrandao/thinker/issues/355) | aberta |
| G3 | degradação | Descoberta de modelos em `api.x.ai/v1/models`; fallback sem `grok-build-0.1` e variantes `-build`; contexto fixo 500k | providers | [#356](https://github.com/patrickbrandao/thinker/issues/356) | aberta |
| G4 | oportunidade | Ler uso/créditos da assinatura em `/v1/billing?format=credits` e plano em `/v1/settings` para o medidor | backend-dev | — | aberta |
| G5 | oportunidade | Device code (`/oauth2/device/code`) funcionaria em Docker/SSH sem callback local | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Fonte principal: código do Grok Build 1.0.45. Descoberto o proxy `cli-chat-proxy.grok.com`; G1 a G5 abertas. Termos de uso e changelog oficial inacessíveis (403).
