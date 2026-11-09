---
id: sub-opencode
categoria: assinatura
entidade: OpenCode Console
agente: sub-opencode
thinker_ids: [opencode]
revisado_em: 2026-11-03
versao_observada: opencode v2.2.5 (commit 9bbb8ce); docs opencode.ai/docs/zen 2026-11-03
---

# OpenCode Console (assinatura)

Especificação mantida pelo agente `sub-opencode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- "OpenCode Console" não é um plano: é a **conta e o login do Console** (`opencode.ai/console`). O login (OAuth 2.0 device code, `client_id` `opencode-cli`) entrega um token escopado à organização que autentica como Bearer tanto o OpenCode pay-as-you-go (provedor `opencode`) quanto o OpenCode Go (`opencode-go`, dossiê `sub-opencode-go`). No Thinker, `opencode` com login cobra por crédito, a preço de lista.
- O fluxo de login e de refresh do Thinker confere com o código do OpenCode v2.2.5 (endpoints, corpo, `slow_down` +5 s, refresh rotativo, `org_id`).
- As diferenças que importam são de **recuperação de erro**: o OpenCode distingue `invalid_grant` (sessão encerrada, exige novo login) de falha transitória e avisa "reconecte"; o Thinker trata todo erro de refresh igual, engole o erro e segue tentando com um refresh token que pode já estar morto (G1). O OpenCode também envia `User-Agent` próprio em todas as chamadas ao Console, e o Thinker não envia nenhum nessas chamadas (G2).
- Armazenamento: no OpenCode o token fica em tabela SQLite local (`credential`), com refresh sob trava; no Thinker fica em blob `{t,r,e,u}` por linha de provedor, com trava por credencial. Equivalentes.
- Termos para gateways: nada novo. A página do Zen diz que modelos pagos e do Go podem ser usados de outros clientes; só os modelos gratuitos exigem o cliente OpenCode.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode repository (auth) | <https://github.com/anomalyco/opencode> | tag `v2.2.5` (2026-10-30), commit `9bbb8ce`; `packages/core/src/plugin/provider/opencode.ts`, `console-access.ts`, `integration.ts`, `usage-limits.ts` |
| Docs do Zen (pay-as-you-go) | <https://opencode.ai/docs/zen/> | lida em 2026-11-03 |
| Skill opencode2-console-access (MCP thinker-routing) | <https://skills.langwizard.net/skills/opencode2-console-access> | não relida; o fluxo foi conferido direto no código v2.2.5 |
| ADR 0009 (interno) | [0009-opencode-catalogo-proprio-e-modelos-gratuitos.md](../../adr/0009-opencode-catalogo-proprio-e-modelos-gratuitos.md) | 2026-11-02 |

Observação: a API do GitHub marca como "latest" a `v1.19.5` (linha antiga); a série atual é `v2.x`, com `v2.2.5` a mais nova em 2026-10-30.

## Contrato

### Planos

- Não há plano "Console". O login serve ao **Zen / pay-as-you-go** (créditos comprados no Console; taxa de 4,6% + US$ 0,31 por compra; recarga automática e orçamentos mensais por workspace e por membro) e ao **Go** (ver `sub-opencode-go`). Fonte: <https://opencode.ai/docs/zen/> (2026-11-03).
- Modelos gratuitos por tempo limitado (Big Pickle, GLM-5.3-Flash Free, DeepSeek V4.1 Flash Free e outros); alguns têm restrição regional (Pulse Alpha Free, Beam Free). A página não lista tetos de uso. `OPENCODE_DISABLE_FREE_MODELS=1` os esconde no cliente.
- Privacidade: modelos hospedados nos EUA e na UE, retenção zero como regra; exceções: modelos gratuitos podem treinar, OpenAI e Anthropic retêm 30 dias, Beam Free retém 30 dias.

### Autenticação

Código do OpenCode v2.2.5, `packages/core/src/plugin/provider/opencode.ts`:

- Servidor padrão `https://opencode.ai/console` (`console-access.ts`). O host antigo `console.opencode.ai` é reescrito para ele.
- `POST {server}/auth/device/code`, JSON `{"client_id":"opencode-cli","supports_org_scope":true}` devolve `device_code`, `user_code`, `verification_uri_complete` (pode ser relativo; só http/https), `expires_in`, `interval`.
- `POST {server}/auth/device/token`, JSON `{"grant_type":"urn:ietf:params:oauth:grant-type:device_code","device_code","client_id"}`. A resposta pendente vem no corpo: `authorization_pending` repete no mesmo intervalo, `slow_down` soma 5 s, outro `error` falha. Sucesso: `access_token`, `refresh_token`, `expires_in`, `org_id` opcional (nulo = sem escopo de organização).
- Após o sucesso o cliente chama `GET {server}/api/user` e `GET {server}/api/orgs` (Bearer) para guardar `accountID`, `email`, `orgID` e `orgName`. Sem `org_id` no token, escolhe a primeira organização por nome; com `org_id` ausente da lista, falha.
- Refresh: mesmo endpoint, `{"grant_type":"refresh_token","refresh_token","client_id"}`. O refresh token **rotaciona**; um `org_id` novo substitui o guardado. Disparado quando faltam 5 minutos ou menos, sob trava por credencial (também entre processos), timeout de 30 s (`integration.ts`).
- **Erro de refresh**: HTTP 400 com corpo `{"error":"invalid_grant"}` = sessão revogada ou expirada (`SignedOut`); só novo login recupera. Qualquer outro erro é falha comum.
- Métodos alternativos: chave de API do Console (conta de serviço) ou a variável `OPENCODE_API_KEY`. Sem credencial, o cliente usa a chave `public`, que libera só os modelos gratuitos.
- Armazenamento: tabela `credential` (SQLite) com `value` JSON (`access`, `refresh`, `expires`, `metadata` com `server`, `accountID`, `email`, `orgID`, `orgName`); credenciais antigas de `auth.json` são migradas. Criptografia em repouso não aparece no esquema (não confirmado além do código lido).

### Endpoints

- Inferência: `https://opencode.ai/inference/...` por protocolo; o `opencode-go` usa `/inference/go/...`. Ver `api-opencode` e `sub-opencode-go` para modelos e protocolos. O token OAuth vai como `Authorization: Bearer` (Google usa `x-goog-api-key`).
- API do Console (Bearer mais `x-org-id: <orgID>`, `console-access.ts`): `GET /api/v2/config` (configuração e política da organização; 404 = sem config), `POST /api/websearch`, `GET /api/policies/current-budgets` (403 para conta de serviço), `GET /api/user`, `GET /api/orgs`.
- Medidor do Go: `GET https://opencode.ai/zen/go/v1/usage` com `x-opencode-org-id` (nome diferente do `x-org-id` da API do Console; `usage-limits.ts`).

### Identificação do cliente

- Todas as chamadas ao Console (device code, token, refresh, config) levam `User-Agent: opencode/<canal>/<versão>/<app>`. O comentário do código diz que o Console lê esse UA para saber qual OpenCode o membro usa e se ele avalia as políticas enviadas.
- Inferência: o mesmo `User-Agent`, `x-opencode-client`, `x-opencode-session`, `x-opencode-session-id`, `x-opencode-parent-session-id`, `x-session-affinity`, `X-Session-Id`, `x-parent-session-id`, `x-opencode-project` (`packages/core/src/session/model-request.ts:293-304`).
- Versão espelhada pelo Thinker: `2.2.5`, igual à mais recente.

### Clientes permitidos e termos

- Zen: modelos de chat gratuitos exigem o OpenCode; modelos pagos e do Go servem a outros clientes (docs do Zen, 2026-11-03). Não há texto sobre gateways. Risco de ação na conta ao passar tráfego de vários agentes: não confirmado.
- Organizações com SSO obrigatório: a inferência é recusada com 401/403 genérico; o cliente oficial consulta `/api/v2/config` para descobrir o motivo (`SsoRequired` com `connectionId`; `Unauthorized` = sessão revogada) e mostra "faça login com SSO" ou "reconecte". Política de organização (config e orçamentos) é aplicada pelo cliente; o Thinker não a avalia.

### Cotas e uso

- Pay-as-you-go: saldo de créditos e orçamentos (`current-budgets`: `limitDollars`, `spentDollars`, `scope`, `per`, `resetsAt`). Fora do escopo do Thinker (ADR 0009).
- Modelos gratuitos e Go: erros de cota no corpo do 429 (ver Erros). Medidor do Go em `sub-opencode-go`.

### Erros

- Refresh: 400 `invalid_grant` = login encerrado.
- Config do Console: 401 `{"_tag":"Unauthorized"}` = sessão revogada; 403 `{"_tag":"SsoRequired",orgId,connectionId}` = SSO expirado; URL de retomada `{server}/auth/sso/<connectionId>/start?redirectTo=<base>/`.
- Inferência rejeitada com 401/403: ver acima. Cota: `FreeUsageLimitError`, `GoUsageLimitError`, `BudgetLimitError` em 429 (detalhes em `sub-opencode-go`).

## Como o Thinker implementa hoje

Revisado em 2026-11-03.

- **Provedor.** `opencode` ("OpenCode Console", `device_code`, contexto 1.000.000, cache de prompt sim) em `packages/shared/src/subscription/configs.ts:278-288`. Aceita também chave de API colada (valor que não é blob OAuth é usado como está).
- **Login.** `OPENCODE_CONSOLE_SERVER`, `CLIENT_ID = 'opencode-cli'`, `supports_org_scope: true`, tratamento de `authorization_pending` e `slow_down` (+5 s) pelo corpo, validação de URL http/https (`packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts:21-34,120-226`). Os fluxos pendentes ficam em memória e se perdem num reinício. Não chama `/api/user` nem `/api/orgs`; guarda só o `org_id` do token em `u`.
- **Armazenamento.** Blob `{t, r, e, u}` serializado na linha do provedor (`opencode-oauth.service.ts:195-216`); `u` guarda o `org_id` e é preservado nos refreshes (`:243-257`). Rótulo por login (`nextOAuthLabel`).
- **Refresh.** `refreshAccessToken` (`:228-257`) faz o POST rotativo; qualquer não-2xx lança `Token refresh failed`, com o corpo no log. `unwrapToken` (`:260-291`) usa o token se faltarem mais de 60 s, senão renova sob trava de assinatura (`coordinateOAuthRefresh`, `packages/backend/src/routing/oauth/core/oauth-refresh-coordinator.ts`); em qualquer erro devolve o token atual se ainda não expirou, ou `null` (`:286-288`). Uma 401 de inferência força o refresh marcando `e` como `REJECTED_TOKEN_EXPIRY` (`packages/backend/src/routing/proxy/oauth-credentials.ts:26-123`).
- **Chamadas ao Console.** `postJson` usa `outboundFetch` com `Content-Type` e `Accept` e nenhum `User-Agent` (`opencode-oauth.service.ts:102-108`).
- **Inferência.** Bases `https://opencode.ai/inference` e `/inference/go`, com `User-Agent: opencode/latest/2.2.5/cli` e `x-opencode-client: cli` em todas as requisições (`packages/backend/src/routing/proxy/provider-endpoints.ts:193-196,607-625`; `packages/backend/src/common/constants/subscription-clients.ts:25-29`), mais `x-opencode-session` (`provider-hooks.ts:47-68`). Token OAuth como Bearer; `x-api-key` cobre a chave colada (`provider-endpoints.ts:641-642`).
- **Cota esgotada.** 429 com `freeusagelimiterror|gousagelimiterror|budgetlimiterror|creditlimitexceeded|insufficient_quota` honra o `Retry-After` até 24 h (`packages/backend/src/routing/proxy/proxy-fallback.service.ts:127-133`).
- **Medidor.** `readGoUsage` só existe para o Go (`opencode-oauth.service.ts:297-`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/oauth/opencode/` (`opencode-oauth.service.ts`, `opencode-oauth.controller.ts`)
- `packages/backend/src/routing/oauth/core/oauth-refresh-coordinator.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Refresh sem distinção de `invalid_grant`: o Console devolve 400 `invalid_grant` quando a sessão acabou (só novo login recupera), mas o Thinker trata como falha comum, devolve o access token antigo enquanto ele não expira e repete o refresh a cada requisição com um refresh token morto. Ao expirar, a requisição falha sem dizer que é preciso reconectar. Sugestão: reconhecer `invalid_grant` (e o 401 `Unauthorized`), marcar a conexão como "reconectar" no painel e parar de repetir o refresh. | backend-dev | #349 | resolvida (invalid_grant marca reconexão e para o refresh, desde #454) |
| G2 | oportunidade | As chamadas ao Console (device code, token, refresh, usage) saem sem `User-Agent`; o OpenCode envia `opencode/<canal>/<versão>/<app>` em todas e o Console o usa para identificar a versão. Sem evidência de rejeição hoje. Sugestão: reutilizar `OPENCODE_USER_AGENT` em `postJson` e no medidor. Relacionada à decisão de identidade em #321. | backend-dev | — | aberta |
| G3 | oportunidade | Sem tratamento de SSO obrigatório: 401/403 de inferência de organização com SSO vira erro genérico; o cliente oficial consulta `GET /api/v2/config` (`SsoRequired`/`Unauthorized`) para explicar. Também não chama `/api/user` e `/api/orgs`, então o painel não mostra e-mail nem nome da organização. | backend-dev | — | aberta |
| G4 | oportunidade | Margem de refresh de 60 s contra 5 minutos do OpenCode. Sem impacto observado; o 401 já força refresh. Alinhar só se aparecerem 401 na janela. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra OpenCode v2.2.5 (`9bbb8ce`) e docs do Zen. Login e refresh conferem. G1 (recuperação de `invalid_grant`) aberta; G2 a G4 registradas como oportunidade.
