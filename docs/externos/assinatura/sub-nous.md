---
id: sub-nous
categoria: assinatura
entidade: NousResearch subscription
agente: sub-nous
thinker_ids: [nous]
revisado_em: 2026-11-03
versao_observada: hermes-agent v0.22.7 (commit 9302ba9, 2026-11-03); portal.nousresearch.com 2026-11-03
---

# NousResearch subscription (assinatura)

Especificação mantida pelo agente `sub-nous` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md). Dossiê irmão (acesso por API): [api-nous](../api/api-nous.md). Harness: [harness-hermes](../harness/harness-hermes.md).

## Resumo

- A "assinatura" da Nous é a conta do **Nous Portal** (`portal.nousresearch.com`): planos Free, Plus, Super e Ultra, mais créditos avulsos. O cliente oficial (Hermes Agent) entra por **OAuth device code** e usa um **JWT de curta duração** (`scope inference:invoke`) como Bearer no gateway `https://inference-api.nousresearch.com/v1`. Não há "chave de assinatura" estática no fluxo oficial.
- Existe também um modo **chave de API** (`NOUS_API_KEY`, provider `nous-api` no Hermes), separado do OAuth. Não está confirmado se essa chave consome a franquia do plano ou só créditos (ver G1).
- O Thinker trata `nous` como assinatura por token colado, sem OAuth, sem refresh e sem leitura de uso. Funciona enquanto o usuário colar um Bearer válido; um JWT do OAuth expira em minutos/horas e a renovação (refresh token de uso único) não é feita.
- O gateway devolve o uso do plano nos cabeçalhos `x-nous-credits-*` e responde 402 quando a janela esgota; o Thinker não lê nada disso.
- Confiança: alta no fluxo OAuth e no gateway (código do cliente oficial v0.22.7); média nos planos (página pública do Portal, via resumo); baixa quanto à chave de API consumir a franquia do plano e quanto aos termos para terceiros (nenhum texto público encontrado).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Hermes Agent (código do cliente oficial; `hermes_cli/auth_nous.py`, `auth_device_flow.py`, `auth_constants.py`, `nous_account.py`, `nous_billing.py`, `agent/credits_tracker.py`, `agent/portal_tags.py`, `plugins/model-providers/nous/`) | <https://github.com/NousResearch/hermes-agent> | v0.22.7 (2026-11-03), commit 9302ba9 |
| Nous Portal (página pública: planos, preços) | <https://portal.nousresearch.com> | 2026-11-03 |
| Docs do Hermes: Tool Gateway e quickstart | <https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-gateway> | 2026-11-03 |
| Releases do Hermes | <https://github.com/NousResearch/hermes-agent/releases> | v0.22.7 |

A semente `portal.nousresearch.com` foi confirmada. Não há referência pública de API do gateway nas fontes lidas; o contrato abaixo vem do código do cliente.

## Contrato

### Planos

Fonte: página pública do Portal, 2026-11-03 (lida por resumo, valores a conferir numa conta real).

| Plano | Preço | O que libera |
|---|---|---|
| Free | US$ 0 | Só modelos gratuitos, limites padrão |
| Plus | US$ 20/mês | Uso do Hermes Agent com limites diário, semanal e mensal; 1 agente em nuvem |
| Super | US$ 100/mês | Mesma estrutura, limites maiores; 1 agente em nuvem |
| Ultra | US$ 200/mês | Mesma estrutura; agente em nuvem maior |

- Créditos avulsos (top-up) de US$ 10 a US$ 200 via Stripe; modelos cobrados por token, ferramentas por uso, tudo do mesmo saldo.
- "ChatGPT plan sharing": contas ChatGPT elegíveis podem ser conectadas para inferência suportada sem plano pago (ferramentas e nuvem cobradas à parte).
- Catálogo anunciado: "200+" modelos na página do Portal, "300+" no README do Hermes (v0.22.7).
- Planos com "janela de uso" (usage window): o gateway manda uma lista de medidores (`gauges`, cada um com `id`, `scope` `all` ou `top_tier`, `label`, `used_bp` de 0 a 10000, `resets_at_ms`). Medidor cheio de `scope: all` para todos os modelos pagos; `top_tier` só para os modelos marcados como topo. Modelos gratuitos não consomem janela. Há "Keep going on credits" (continua gastando créditos comprados quando a janela esgota) e auto top-up. Fonte: `agent/usage_gauges.py`, `hermes_cli/nous_account.py` (v0.22.7).
- Camada gratuita anônima ("welcome"): conta sem usuário Nous, host próprio `https://welcome-api.nousresearch.com/v1`, serve o modelo `nous/welcome`. O host pago recusa JWT anônimo com 400, e o host welcome recusa credencial nomeada com 400. Fonte: `hermes_cli/auth_constants.py`, `agent/error_classifier.py` (v0.22.7).

### Autenticação

Fluxo oficial: OAuth 2.0 Device Authorization Grant (RFC 8628) contra o Portal. Fonte: `hermes_cli/auth_nous.py`, `auth_device_flow.py`, `auth_constants.py` (v0.22.7).

| Item | Valor |
|---|---|
| Portal | `https://portal.nousresearch.com` |
| Pedido do código | `POST {portal}/api/oauth/device/code`, form `client_id=hermes-cli` e `scope` |
| Resposta | `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, `interval` |
| Polling | `POST {portal}/api/oauth/token`, `grant_type=urn:ietf:params:oauth:grant-type:device_code`; `authorization_pending` espera, `slow_down` soma 1 s (teto 30 s); 403 com `x-vercel-mitigated`, 408, 429 e 5xx fazem backoff (Retry-After, teto 60 s) |
| `client_id` | `hermes-cli` |
| Escopos | `inference:invoke` (padrão); `billing:manage` só para operações de cobrança (step-up) |
| PKCE | não usado (device code) |
| Token de acesso | JWT; o Hermes o usa direto como Bearer de inferência (`agent_key` = o próprio `access_token`) e renova 120 s antes de expirar. Expiração vem do claim `exp` e de `expires_in`/`expires_at` |
| Refresh | `POST {portal}/api/oauth/token` com cabeçalho `x-nous-refresh-token: <refresh_token>` e form `grant_type=refresh_token&client_id=hermes-cli` |
| Rotação | refresh token de **uso único**; a resposta traz o novo `refresh_token`, que deve ser gravado antes de qualquer outra chamada. Reuso derruba a cadeia inteira de sessão (`refresh_token_reused`) |
| Resposta do token | traz também `inference_base_url`; o Hermes só aceita hosts `inference-api.nousresearch.com` e `welcome-api.nousresearch.com` (sobrescrita só por env do operador) |
| Falha de refresh | códigos OAuth terminais (`invalid_grant` etc.) exigem novo login; 401/403 sem `error` equivalem a `invalid_grant`; 5xx e desafio do edge Vercel (403/429 com `x-vercel-mitigated`) são transitórios e **não** descartam credencial |
| Sem assinatura | o refresh pode falhar com código `subscription_required`; o Hermes manda o usuário para `{portal}/billing` |

Modo chave de API: o Hermes tem `nous-api` com a variável `NOUS_API_KEY` (comentário em `cli-config.yaml.example`, `plugins/model-providers/nous/__init__.py`). O código lido não mostra onde a chave é emitida nem se consome a franquia do plano (não confirmado).

### Endpoints

Inferência: `https://inference-api.nousresearch.com/v1` (host pago) e `https://welcome-api.nousresearch.com/v1` (gratuito anônimo). Fonte: `hermes_cli/auth_constants.py`, `plugins/model-providers/nous/__init__.py` (v0.22.7).

- `GET {inference}/models` com `Authorization: Bearer`; corpo `{ "data": [ { "id": ... } ] }`. O Hermes remove ids com "hermes" (não confiáveis para tool calling) e ordena opus, pro, outros, sonnet.
- Protocolo por modelo: `anthropic/*` tem rota nativa Messages (`/v1/messages`); o resto usa `/chat/completions`. O Hermes usa `chat/completions` também para `anthropic/*` por padrão, porque a rota nativa reescrevia o turno anterior e invalidava o cache em 14 a 20% das chamadas (medição de 2026-09-06 no código, NousResearch/api#227; reavaliar). Ids com barra (`anthropic/claude-fable-5.1`) são o formato nativo.
- Corpo extra do Hermes em toda chamada ao Portal: `tags` = `["product=hermes-agent", "client=hermes-client-v<base_version>", "conversation=<id>"]`; `session_id` de topo como chave de roteamento sticky (mantém o cache de prompt na mesma instância); `reasoning` completo, omitido quando o modelo não permite desligar; `provider: { data_collection: "deny", zdr?: true }` só quando um conector exige. Qualquer outro campo de roteamento do chamador dá 400.
- Catálogo recomendado por plano: `GET {portal}/api/nous/recommended-models` (espelho `https://web-assets.nousresearch.com/dynamic/<host>`).
- Conta: `/api/oauth/account` (plano, créditos, `usage_window`, `tool_access`); cobrança: `/api/billing/state`, `/api/billing/subscription`, `/api/billing/charge`, `/api/billing/auto-top-up`, `/api/billing/keep-going-on-credits` (escopo `billing:manage` para as que movem dinheiro). Fora do escopo do Thinker.

### Identificação do cliente

- Não foi encontrado `User-Agent` fixo nem versão mínima exigida no código do Hermes para o gateway; a identificação é o corpo (`tags`, ver acima). Cliente a espelhar: Hermes Agent, tag `hermes-client-v0.22.7` (não confirmado se o gateway valida a tag).
- O Portal fica atrás do Vercel Security Checkpoint: clientes não navegador podem receber 403/429 com `x-vercel-mitigated` nos endpoints do Portal (`/api/oauth/*`); não é recusa de credencial. O gateway de inferência não mostrou esse comportamento no código.

### Clientes permitidos e termos

- Nenhum texto público encontrado nas fontes lidas sobre uso do JWT/da assinatura por clientes de terceiros ou por gateway (não confirmado). O README do Hermes diz que o Hermes funciona com qualquer provedor e o Portal é o caminho opcional "sem coletar chaves".
- Risco a verificar com conta real: o JWT é amarrado ao `client_id=hermes-cli`; usá-lo de outro cliente pode violar os termos do Portal. Revisar os termos em <https://portal.nousresearch.com> antes de recomendar OAuth no Thinker.

### Cotas e uso

Cabeçalhos de resposta do gateway (fonte: `agent/credits_tracker.py`, `agent/usage_gauges.py`, v0.22.7). Presentes só em contas de janela de uso, e também no 402:

| Cabeçalho | Significado |
|---|---|
| `x-nous-credits-version` | obrigatório; sem ele o bloco é ignorado |
| `x-nous-credits-window-gauges` | JSON com a lista de medidores (obrigatório no bloco de janela) |
| `x-nous-credits-spend-source` | de onde sai o gasto (franquia ou créditos) |
| `x-nous-credits-window-paused-reason` | plano pausado (ex.: `payment_past_due`) |
| `x-nous-credits-keep-going-on-credits` | opção "Keep going" ligada ou não |
| `x-nous-credits-denominator-kind`, `-subscription-limit-micros`, `-subscription-limit-usd`, `-disabled-reason` | limites e motivo de desligamento |
| `x-nous-tool-pool-*` | franquia gratuita de ferramentas (Tool Gateway) |

Fora das respostas, o uso está em `/api/oauth/account` (campo `usage_window`) e `/api/billing/subscription`.

### Erros

Fonte: `agent/error_classifier.py`, `hermes_cli/auth_nous.py` (v0.22.7).

| Situação | Sinal |
|---|---|
| Janela de uso esgotada ou sem créditos | 402; mesmos cabeçalhos `x-nous-credits-*`; a ação depende de "Keep going" e do saldo comprado |
| Limite da camada gratuita | 429 com `reason` no corpo ou cabeçalhos de espera; alguns motivos significam "modelo fora do plano" (tratado como modelo indisponível, com fallback) |
| Credencial nomeada no host welcome | 400 (espelho do gateway) |
| JWT anônimo no host pago | 400 |
| Reauth necessário | refresh com `invalid_grant`/`refresh_token_reused`/ausência de refresh token (`nous_auth_missing_refresh_token`) |
| Sem assinatura ativa | `subscription_required` no refresh |
| Portal fora do ar | 5xx; transitório |
| Campo de roteamento não aceito (ex.: `provider_preferences`) | 400 |

## Como o Thinker implementa hoje

Conferido contra o código em 2026-11-03.

- Registro: id `nous`, nome "NousResearch", aliases `nousresearch`, `nous-research`, `nous research`, exige chave, `minKeyLength: 10`, sem prefixo (`packages/shared/src/providers.ts:333-343`).
- Assinatura: `supportsSubscription`, rótulo "NousResearch subscription", modo `token` (colar a chave), placeholder "Paste your NousResearch API key"; lista de modelos dinâmica; `maxContextWindow: 1000000`, sem cache de prompt, sem batch (`packages/shared/src/subscription/configs.ts:193-204`). Não há `subscriptionTokenPrefix`.
- Inferência: base `https://inference-api.nousresearch.com`, formato `openai`, `Authorization: Bearer`, caminho `/v1/chat/completions`, `include_usage` no stream (`packages/backend/src/routing/proxy/provider-endpoints.ts:198` e `378-384`). Mesma base para API key e para assinatura; sem endpoint ou cabeçalho distinto por modo.
- Id de modelo: não remove o prefixo do vendor (`anthropic/...` segue inteiro) (`packages/backend/src/routing/proxy/provider-client.ts:340-350`).
- Descoberta: `GET https://inference-api.nousresearch.com/v1/models` com Bearer, parser `parseOpenRouter` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:70` e `937-941`). Não filtra ids "hermes" e não consulta `/api/nous/recommended-models`.
- Não existe: OAuth device code, refresh, leitura de `x-nous-credits-*`, envio de `tags`/`session_id`, host welcome, rota Messages, tratamento específico de 402/429 do Nous. `nous` não está em `subscription-clients.ts` (nenhuma referência).
- Frontend: entrada do catálogo e ícone (`packages/frontend/src/services/providers.ts:452-466` e `635`, `packages/frontend/src/components/ProviderIcon.tsx`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/common/constants/subscription-clients.ts` (sem entrada `nous`)
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- referência de implementação de device code no Thinker: `packages/backend/src/routing/oauth/copilot/copilot-device-auth.service.ts`, `packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A assinatura do Portal só é alcançada por OAuth device code (JWT `inference:invoke` de vida curta, refresh de uso único). O Thinker só aceita token colado: se o usuário colar o JWT, ele expira sem renovação; se colar uma chave de API (`NOUS_API_KEY`), o consumo provavelmente sai dos créditos e não da franquia do plano (não confirmado). Sugestão: modo `device_code` para `nous` (`POST /api/oauth/device/code`, `/api/oauth/token`, refresh com `x-nous-refresh-token`, gravar o novo refresh token antes de usar o JWT) ou, no mínimo, avisar na UI que a chave de API pode cobrar créditos. Antes, conferir os termos para clientes de terceiros (ver "Clientes permitidos e termos"). | providers | [#343](https://github.com/patrickbrandao/thinker/issues/343) | aberta |
| G2 | oportunidade | Ler `x-nous-credits-*` (medidores em `x-nous-credits-window-gauges`, motivo de pausa) para mostrar uso restante e tratar 402 de janela esgotada com cooldown até `resets_at_ms`, em vez do tratamento genérico. | providers | — | aberta |
| G3 | oportunidade | Enviar `tags` (`product=`, `client=`, `conversation=`) e `session_id` de topo para roteamento sticky e cache de prompt no Portal. Hoje `supportsPromptCaching: false`. Depende de confirmar que o gateway aceita os campos de clientes que não são o Hermes. | providers | — | aberta |
| G4 | oportunidade | Camada gratuita anônima (`welcome-api.nousresearch.com`, modelo `nous/welcome`) e modelos gratuitos do plano Free: descoberta sem chave, no estilo dos modelos gratuitos do OpenCode (ADR 0009). | providers | — | aberta |
| G5 | oportunidade | Listar modelos por plano via `/api/nous/recommended-models` e filtrar ids "hermes" como o cliente oficial; usar a rota Messages nativa para `anthropic/*` quando o problema de cache (NousResearch/api#227) estiver resolvido. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Fontes: Hermes Agent v0.22.7 (commit 9302ba9) e página pública do Portal. Contrato preenchido (OAuth device code, refresh de uso único, gateway, cabeçalhos de uso, erros, planos). Lacunas G1 a G5; G1 aberta como issue.
