---
id: sub-anthropic
categoria: assinatura
entidade: Claude Max / Pro
agente: sub-anthropic
thinker_ids: [anthropic]
revisado_em: 2026-11-03
versao_observada: claude-code 2.1.318 (npm latest; stable 2.1.311)
---

# Claude Max / Pro (assinatura)

Especificação mantida pelo agente `sub-anthropic` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Thinker usa a assinatura Claude (Pro/Max) por dois caminhos: OAuth PKCE com código colado (`claude.ai/oauth/authorize`) e o token colado de `claude setup-token` (prefixo `sk-ant-oat`). Inferência vai para `POST https://api.anthropic.com/v1/messages` com `Authorization: Bearer`, imitando o Claude Code.
- O Claude Code está em **2.1.318** (npm `latest`; `stable` = 2.1.311). O Thinker fixa `claude-cli/2.1.280`: 38 versões de patch atrás. Não há evidência pública de que o backend bloqueie por versão do user agent (não confirmado), então é desvio de manutenção, não quebra.
- Esta pesquisa foi só de documentação e CHANGELOG (o código do cliente é distribuído minificado; não foi lido). Detalhes de endpoints OAuth e do conjunto exato de `anthropic-beta` atual do Claude Code ficam **não confirmados** e pedem conferência ao vivo.
- Lacuna principal: janelas de 1M tokens de Fable 5, Haiku 5.5 e Opus 4.7 não estão mapeadas e caem em 200K (G1, issue #323).
- Termos de uso: o acesso automatizado só é permitido por API key ou quando a Anthropic permite explicitamente; rotear a assinatura por um gateway é zona de risco (ver "Clientes permitidos e termos").

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Claude Code repository and CHANGELOG | <https://github.com/anthropics/claude-code> | release v2.1.318 (2026-11-04); CHANGELOG lido até v2.1.7 por busca |
| npm @anthropic-ai/claude-code (version for user agent) | <https://www.npmjs.com/package/@anthropic-ai/claude-code> | latest 2.1.318, stable 2.1.311, next 2.1.318 (`npm view`, 2026-11-03) |
| Using Claude Code with Pro or Max | <https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan> | página lida em 2026-11-03 (sem data de edição) |
| Consumer terms | <https://www.anthropic.com/legal/consumer-terms> | vigência 2025-10-08 |

## Contrato

### Planos

Fonte: artigo de suporte acima (2026-11-03) e CHANGELOG.

- Planos de consumo: Pro, Max e Ultra cobrem Claude web/desktop/mobile e o Claude Code. Team e Enterprise têm outro fluxo.
- Janelas: Pro e Max têm limite de **5 horas** e limite **semanal**. Ultra tem só o semanal (contas Ultra verificadas não têm o de 5 horas). Max e Ultra têm ainda um limite semanal separado para **Fable**. Claude (apps) e Claude Code compartilham os limites.
- Após estourar o limite de 5 horas, uma margem pequena ("wrap-up") deixa terminar a resposta em andamento e conta no semanal.
- Quando o limite estoura, o usuário pode ativar usage credits (cobrança a preço de API), comprar créditos ou esperar. Fable 5 pode exigir consentimento de usage credits na primeira vez (CHANGELOG v2.1.208, v2.1.236, v2.1.282); 429 de contexto longo em Fable no Pro tem mensagem própria (v2.1.268).
- Uma variável `ANTHROPIC_API_KEY` sobrepõe o login da assinatura no Claude Code e passa a cobrar por API (irrelevante para o Thinker, que nunca manda `x-api-key` na rota de assinatura).
- Modelos atuais no Claude Code (CHANGELOG): Opus 5.5 (`claude-opus-5-5`, 1M, v2.1.280), Sonnet 5.5 (`claude-sonnet-5-5`, 1M, v2.1.284), Haiku 5.5 (`claude-haiku-5-5`, 1M, v2.1.293), Fable 5 / 5.1 (1M por padrão), Opus 4.8 e 4.7 (1M). Fast mode do Opus 4.8 foi deprecado em 2026-10-30 e será removido em 2026-11-30 (v2.1.316); o fast mode passa a ser do Opus 5.5.
- Preços de API de referência (só informativo, a assinatura não cobra por token): Opus 5.5 $4/$20, Sonnet 5.5 $2/$10 (cache read $0.10 desde v2.1.296), Haiku 5.5 $0.10/$0.50 por Mtok.
- Se 1M tokens está disponível a cada plano de assinatura para Haiku 5.5 e Opus 4.7 `(não confirmado)`. Historicamente o 1M do Opus exigiu plano Max/Team (v2.1.75).

### Autenticação

Fonte: CHANGELOG do Claude Code; valores do Thinker conferem com o que o próprio `claude setup-token` usa.

- Caminhos de login do Claude Code: login claude.ai (OAuth PKCE), `claude setup-token` (token de longa duração, usado como `CLAUDE_CODE_OAUTH_TOKEN`; validade exata `(não confirmado)`) e API key do Console.
- Parâmetros OAuth usados pelo Thinker (`anthropic-oauth.config.ts`): `client_id` `9d1c250a-e61b-44d9-88ed-5944d1962f5e`; authorize `https://claude.ai/oauth/authorize` com `code=true`, PKCE S256, `state` = verifier; token `POST https://api.anthropic.com/v1/oauth/token` em JSON; redirect `https://console.anthropic.com/oauth/code/callback` (a página exibe `<code>#<state>`); scope `org:create_api_key user:profile user:inference`. Refresh: `grant_type=refresh_token` com o mesmo `client_id`; a resposta pode rotacionar o refresh token.
- O CHANGELOG v2.1.7 diz que as URLs de OAuth e do Console do Claude Code mudaram de `console.anthropic.com` para `platform.claude.com`. O Thinker ainda usa `console.anthropic.com` no redirect. Se o host antigo continua aceito `(não confirmado)`; ver G3.
- Erros de login relevantes no cliente: `OAuth token revoked` em 401 de login revogado (v2.1.287); 403 por bloqueio de região/rede deixou de ser mostrado como falha de login (v2.1.317); login claude.ai armazenado tem prazo e agora é informado (`loginExpiresAt`, v2.1.318).
- Refresh concorrente é um problema real do cliente oficial (várias correções de lock em v2.1.282, 285, 301, 318); o Thinker já serializa com `coordinateOAuthRefresh`.

### Endpoints

- Inferência: `POST https://api.anthropic.com/v1/messages` (Anthropic Messages), `Authorization: Bearer <token OAuth>`, `anthropic-version: 2023-06-01`. Sem `x-api-key`.
- O Claude Code reenvia sem um beta header quando o gateway/servidor o recusa (v2.1.290, 2.1.310, 2.1.314), o que indica que `effort-2025-11-24` e `prompt-caching-scope` são flags sujeitas a recusa por alguns destinos. O `prompt-caching-scope` deixou de ser enviado atrás de `ANTHROPIC_BASE_URL` customizado (v2.1.307).
- Contagem de tokens, uso do plano (`/usage`) e demais endpoints do cliente existem, mas as URLs não aparecem no CHANGELOG `(não confirmado)`. O CHANGELOG cita apenas um "plan-usage endpoint" com rate limit próprio (v2.1.284, v2.1.304) e eventos headless `rate_limit_event` (v2.1.295).
- Listagem de modelos: a rota de assinatura do Thinker não descobre modelos ao vivo; usa lista curada (ver abaixo).

### Identificação do cliente

O backend exige que a requisição se pareça com o Claude Code / Agent SDK. O que o Thinker envia (`subscription-clients.ts:31-85`):

| Item | Valor no Thinker | Referência observada |
|---|---|---|
| `user-agent` | `claude-cli/2.1.280 (external, sdk-cli)` | Claude Code 2.1.318 (latest) / 2.1.311 (stable) |
| `x-app` | `cli` | CHANGELOG v2.1.285 cita `User-Agent`, `x-app` e session id nos headers normais |
| `x-stainless-package-version` | `0.80.0` | `(não confirmado)` para 2.1.318 |
| `x-stainless-runtime-version` | `v24.14.0` | `(não confirmado)` |
| `anthropic-beta` | `claude-code-20250219,oauth-2025-04-20,context-management-2025-06-27,effort-2025-11-24` | lista atual exata do cliente `(não confirmado)`; `effort-2025-11-24` ainda é enviada pelo cliente (v2.1.310) |
| `anthropic-dangerous-direct-browser-access` | `true` | `(não confirmado)` |
| bloco de system | `You are a Claude agent, built on Anthropic's Claude Agent SDK.` como primeiro bloco | exigido para Sonnet/Opus segundo comentário do código; `(não confirmado)` nesta revisão |

- Outros cabeçalhos do Claude Code vistos no CHANGELOG: `x-claude-code-prompt-id` (opt-in, `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, v2.1.283) e um bloco de atribuição no system prompt desligável por `CLAUDE_CODE_ATTRIBUTION_HEADER=0` (v2.1.299). O Thinker não envia nenhum dos dois; não se sabe se são exigidos `(não confirmado)`.
- `anthropic-beta` do chamador é mesclado com os flags do Thinker (`anthropic-beta.ts`), então betas como `structured-outputs` passam.
- Cliente a espelhar: `@anthropic-ai/claude-code`; versão para o UA = `latest` do npm quando o objetivo é acompanhar, `stable` para ser conservador.

### Clientes permitidos e termos

- Termos de consumo (vigência 2025-10-08): a seção 3 proíbe acesso por meios automatizados ou não humanos (bots, scripts), exceto via API key ou onde a Anthropic permitir explicitamente. A seção 2 proíbe compartilhar credenciais e colocar a conta à disposição de terceiros. Os termos não citam OAuth, Claude Code nem gateways.
- O artigo de suporte descreve o uso da assinatura no Claude Code e nos apps; não autoriza explicitamente outros clientes. Rotear a assinatura por um gateway que imita o Claude Code é, portanto, **risco de ação na conta** (suspensão ou bloqueio do token) que a documentação pública não descarta. Sem relatos primários verificados nesta revisão.
- Para o produto: manter a assinatura para uso pessoal do dono da conta e não compartilhar o token entre usuários.

### Cotas e uso

- Janelas: 5 horas (Pro/Max), semanal, semanal de Fable (Max/Ultra). Compartilhadas com o app Claude.
- Como ler o uso restante: no cliente, `/usage` e o evento headless `rate_limit_event` (v2.1.295), que diz se há extra usage ativo. Cabeçalhos HTTP de rate limit da assinatura `(não confirmado)`; os cabeçalhos `anthropic-ratelimit-*` do Thinker (`playground-response-headers.ts:10-15`) são os da API por chave.
- O cliente oficial dá backoff nas consultas de uso quando o endpoint limita (v2.1.284).

### Erros

- 429 por limite de assinatura (5 horas/semanal) e 429 de contexto longo (Fable no Pro, exige usage credits): mensagens próprias no cliente.
- 401: token revogado ou expirado; no cliente vira `OAuth token revoked` / `Failed to authenticate`.
- 403: pode ser bloqueio de região ou rede, não necessariamente credencial inválida (v2.1.317).
- 400 `Extra inputs are not permitted` quando um campo de beta vai sem o flag correspondente (tratado pelo merge de betas no Thinker).
- Modelo fora do plano: tratado no cliente como fallback para modelo anterior (v2.1.301, Fable); formato exato do erro `(não confirmado)`.

## Como o Thinker implementa hoje

- Configuração do provedor (`packages/shared/src/subscription/configs.ts:6-46`): rótulo `Claude Max / Pro subscription`, modo `token`, comando `claude setup-token`, prefixo `sk-ant-oat`. Lista curada de modelos (sem descoberta ao vivo): `claude-fable-5`, `claude-fable-5-1`, `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`. Janela máxima 200K, com 1M só para `claude-opus-4-8`, `claude-opus-5` e `claude-sonnet-5` (e derivados por prefixo, `model-fallback.ts:157-190`); cache de prompt suportado, batch não.
- Fluxo OAuth PKCE com código colado (`packages/backend/src/routing/oauth/anthropic/anthropic-oauth.config.ts:13-22`, `anthropic-oauth.service.ts:76-97` para a URL, `:126-138` para a troca, `:174-192` para o refresh). `User-Agent: anthropic` nas chamadas de token (`:41-45`). Token guardado como blob `{t, r, e}`; token colado de `setup-token` (sem refresh) é usado como veio (`anthropic-oauth.service.ts:205-222`). Resolução do bearer em `packages/backend/src/routing/proxy/oauth-credentials.ts:75` e `:152`.
- Inferência: `anthropic` → `https://api.anthropic.com` + `/v1/messages`, formato `anthropic` (`provider-endpoints.ts:233-238`); cabeçalhos de assinatura via `buildClaudeCodeSubscriptionHeaders` (`provider-endpoints.ts:151-154` e `subscription-clients.ts:67-85`).
- Valores fixados: `claude-cli/2.1.280 (external, sdk-cli)`, Stainless `0.80.0`, runtime `v24.14.0`, betas `claude-code-20250219, oauth-2025-04-20, context-management-2025-06-27, effort-2025-11-24` (`subscription-clients.ts:31-38`). `x-stainless-arch`/`os` vêm do processo; `x-stainless-timeout: 600`.
- Bloco de identidade injetado como primeiro bloco de system (`anthropic-adapter.ts:46-49`, `:495-499`, `:633-635`; condição em `provider-client.ts:761-762`).
- Mesclagem de `anthropic-beta` do chamador com os flags do Thinker (`anthropic-beta.ts:70`, aplicada em `provider-client.ts:138-140`). Não há retry sem o beta quando o upstream recusa um flag.
- Não há leitura de uso/limites da assinatura (5 horas, semanal) nem tratamento específico de 429 de limite de assinatura.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/anthropic-adapter.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/oauth/anthropic/` (config, service, controller)
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/playground/playground-response-headers.ts`

Outros arquivos que citam `anthropic` (utilitários de id de modelo, aliases, seed, custom provider, MCP tools, descoberta de modelos, injeção de cache em `cache-injection.ts`) não foram reexaminados nesta revisão.

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-5-5` e `claude-opus-4-7` têm 1M segundo o CHANGELOG (v2.1.173, 285, 287, 293) mas não estão em `modelContextWindows`; caem em 200K (`configs.ts:36-42`, `model-fallback.ts:157-190`). Conferir 1M por plano com conta real. | providers | [#323](https://github.com/patrickbrandao/thinker/issues/323) | aberta |
| G2 | oportunidade | `user-agent` fixo em `claude-cli/2.1.280`; atual 2.1.318 (stable 2.1.311). Atualizar UA, versão Stainless e betas para os do release atual (conferir na bundle ou com captura de uma conta real). Sem evidência de bloqueio por versão. | providers | — | aberta |
| G3 | oportunidade | OAuth ainda usa redirect `console.anthropic.com` e token em `api.anthropic.com`; o Claude Code migrou URLs de OAuth/Console para `platform.claude.com` (CHANGELOG v2.1.7). Verificar se o host antigo segue válido e se o scope atual inclui mais permissões (não confirmado). | providers | — | aberta |
| G4 | oportunidade | O Claude Code reenvia sem o beta quando o upstream recusa (v2.1.290/310/314); o Thinker não faz retry sem o flag, e `effort-2025-11-24` fixo pode falhar para modelo sem suporte. | providers | — | aberta |
| G5 | oportunidade | Mostrar uso restante da assinatura (5 horas, semanal, Fable) e distinguir 429 de limite de assinatura de 429 de contexto longo; endpoints e cabeçalhos exatos não confirmados. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa (só documentação, CHANGELOG e npm). Claude Code 2.1.318. Contrato escrito; lacunas G1 a G5; issue #323 aberta para G1. Pendentes de conferência ao vivo: endpoints OAuth atuais, betas e headers do release atual, leitura de uso, risco de termos.
