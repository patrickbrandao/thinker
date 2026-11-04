---
id: sub-copilot
categoria: assinatura
entidade: GitHub Copilot
agente: sub-copilot
thinker_ids: [copilot]
revisado_em: 2026-11-03
versao_observada: vscode 1.144.0 (extensions/copilot 0.72.0, commit 2c33b50); copilot-cli v1.0.105; docs 2026-11-03
---

# GitHub Copilot (assinatura)

Especificação mantida pelo agente `sub-copilot` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Copilot cobra por **créditos de IA** (1 crédito = US$ 0,01) desde 2026-06-01, calculados por tokens (entrada, saída, cache) às tarifas de API de cada modelo. Os "premium requests" e seus multiplicadores só valem para planos anuais Pro/Pro+ legados. O Thinker já converte `billing.token_prices` do `/models` em USD por token, o que bate com o modelo atual.
- O cliente de referência agora é a extensão Copilot Chat dentro do repositório `microsoft/vscode` (`extensions/copilot`); o repositório `microsoft/vscode-copilot-chat` foi arquivado (último release v0.43.0, 2026-04-07). Versão observada: VS Code 1.144.0 e plugin `copilot-chat` 0.72.0. O Thinker ainda se identifica como `vscode/1.100.0` e `copilot/1.300.0` (G1).
- A lista de modelos mudou muito: vários IDs do `knownModels` do Thinker foram aposentados (Opus 4.6, Gemini 3.1 Pro, GPT-5.4, GPT-5 mini, Grok 4.5) e há famílias novas (GPT-6.x, Claude 5.x, Gemini 4) (G2). A listagem dinâmica via `/models` cobre isso quando funciona.
- O cliente oficial envia cabeçalhos que o Thinker não envia, entre eles `Copilot-Vision-Request` para imagens e `X-Initiator` (G3). O token do Copilot traz `endpoints.api` por SKU, ignorado pelo Thinker (G4).
- Termos: não há política oficial publicada sobre gateways; há relatos de suspensão por "clientes não suportados" (não confirmado). Risco de conta existe e precisa ser comunicado ao usuário.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Copilot plans | <https://github.com/features/copilot/plans> | 2026-11-03 |
| Supported models | <https://docs.github.com/en/copilot/reference/ai-models/supported-models> | 2026-11-03 (página truncada na leitura; 100 mil caracteres iniciais + trecho seguinte) |
| Anúncio de cobrança por uso | <https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/> | 2026-04-27 |
| Cobrança legada (premium requests) | <https://docs.github.com/en/copilot/concepts/billing/copilot-requests> | 2026-11-03 |
| Depreciações (changelog) | <https://github.blog/changelog/2026-10-19-github-copilot-models-deprecated-on-october-19-2026>, <https://github.blog/changelog/2026-09-16-upcoming-deprecation-of-selected-github-copilot-models> | 2026-10-19 |
| Copilot Chat (código atual, dentro do VS Code) | <https://github.com/microsoft/vscode/tree/1.144.0/extensions/copilot> | tag 1.144.0 (2026-10-28), commit `2c33b50b16c4` |
| VS Code Copilot Chat (arquivado) | <https://github.com/microsoft/vscode-copilot-chat> | v0.43.0 (2026-04-07), arquivado em 2026-05-20 |
| Copilot CLI | <https://github.com/github/copilot-cli> | v1.0.105 (2026-10-28); pré-release v1.0.106-7 (2026-11-03) |

## Contrato

### Planos

Fonte: página de planos, 2026-11-03.

| Plano | Preço | Créditos base | Créditos "flex" | Total |
|---|---|---|---|---|
| Free | US$ 0 | uso limitado de chat e agente | n/a | n/a |
| Pro | US$ 10/mês | US$ 10 | US$ 5 | US$ 15 |
| Pro+ | US$ 39/mês | US$ 39 | US$ 31 | US$ 70 |
| Max | US$ 100/mês | US$ 100 | US$ 100 | US$ 200 |
| Business / Enterprise | US$ 19 / 39 por usuário | US$ 19 / 39 (anúncio de abril) | n/a | créditos podem ser agrupados na organização |

- Cobrança: 1 crédito de IA = US$ 0,01, calculado sobre tokens de entrada, saída e cache às tarifas de API publicadas por modelo. Sugestões inline e Next Edit Suggestions não gastam crédito.
- Vigência: 2026-06-01. Planos anuais Pro/Pro+ ficam no modelo de premium requests (300 e 1.500 por mês, US$ 0,04 cada excedente) até expirarem, com multiplicadores maiores.
- Ao acabar o crédito, não há mais queda para modelo mais barato: o uso para, a menos que haja orçamento adicional. Alertas a 75%, 90% e 100% do orçamento configurado.
- Contexto de 1M tokens e níveis altos de raciocínio consomem mais créditos (preço de "extended capability").
- A página lista o mesmo conjunto de modelos para todos os planos; a disponibilidade real depende do plano e do cliente (alguns modelos são "Included" só em CLI, nuvem ou app). A resposta de `/models` é a fonte autoritativa por conta.

### Modelos (docs, 2026-11-03)

- Anthropic: Claude Haiku 4.5, Haiku 5.5, Sonnet 4.6, Sonnet 5, Sonnet 5.5, Opus 4.8 (e "fast mode"), Opus 5, Opus 5.5, Fable 5, Fable 5.1.
- OpenAI: GPT-5.3-Codex (modelo de fallback de longo prazo), GPT-5.4 nano, GPT-5.6 Luna/Sol/Terra, GPT-6 Astra/Luna/Sol, GPT-6.1 Sol/Terra.
- Outros: Gemini 3.8 Flash, Gemini 4 Argon, Grok 4.6, Grok 4.7, Kimi K3, MAI-Code-1.1-Flash (Microsoft).
- Aposentados (changelog): Opus 4.6 e Gemini 3.1 Pro (2026-09-01); Gemini 3.5/3.6 Flash, Kimi K2.7 Code, Opus 4.7 (2026-10-02); GPT-5.5, GPT-5.4, GPT-5.4 mini, GPT-5 mini, Gemini 3.7 Flash, Grok 4.5 (2026-10-19). Sonnet 4.6 segue para assinantes anuais individuais. Status de gpt-4.1, gpt-4o, gpt-4o-mini, grok-code-fast-1 e gpt-5.2-codex: (não confirmado); a página de planos lista GPT-5.2-Codex e não lista os demais.

### Autenticação

- Fluxo em duas etapas, confirmado no código do Copilot Chat 0.72.0 (`src/platform/authentication/common/copilotToken.ts`):
  1. token OAuth do GitHub de longa duração (no Thinker: device code em `https://github.com/login/device/code` e `https://github.com/login/oauth/access_token`, escopo `read:user`);
  2. troca em `GET https://api.github.com/copilot_internal/v2/token` com `Authorization: token <oauth>`, devolvendo o token do Copilot.
- Resposta da troca (`TokenEnvelope`): `token`, `expires_at` (unix, s), `refresh_in` (s até renovar), `sku`, `individual`, `endpoints.api` (host da API por SKU), `limited_user_quotas` e `limited_user_reset_date` (Free), `organization_list`, `enterprise_list`. Erro 403 traz `error_details.notification_id`, `can_signup_for_limited`; erro padrão de rate limit tem `message`, `documentation_url`, `status`.
- O `client_id` OAuth do Thinker (`Iv1.b507a08c87ecfe98`) não é o do VS Code; a conferência do `client_id` do cliente oficial não foi feita aqui (não confirmado). O Copilot CLI usa fluxo web por padrão em terminal local e device code em ambientes remotos/headless (changelog do CLI v1.0.x); o CLI também aceita login por navegador.
- Cota (Chat): `GET copilot_internal/user` com `Authorization: token <oauth>` e `X-GitHub-Api-Version: 2025-04-01` devolve `quota_reset_date` e `quota_snapshots.{chat,completions,premium_interactions}` (`entitlement`, `remaining`, `unlimited`, `overage_count`, `overage_permitted`, `percent_remaining`). As respostas de chat também trazem um cabeçalho de cota em formato query-string (`ent`, `ov`, `ovPerm`, `rem`, `rst`); nome exato do cabeçalho não verificado.

### Endpoints

Base `https://api.githubcopilot.com` (o cliente oficial usa `endpoints.api` do token, que pode ser específico do SKU).

| Uso | Caminho | Observação |
|---|---|---|
| Chat Completions | `/chat/completions` | maioria dos modelos |
| Responses | `/responses` e `ws:/responses` (WebSocket) | modelos Codex e GPT recentes |
| Messages (Anthropic) | `/v1/messages` | novo em `supported_endpoints`; o Copilot Chat o usa quando o modelo anuncia e a flag `enableMessagesApi` está ativa |
| Modelos | `/models` | cada modelo traz `supported_endpoints`, `capabilities` (limites, tools, vision, `reasoning_effort`, `context_editing`), `billing` |

`billing` no `/models` (tipos em `src/platform/endpoint/common/endpointProvider.ts`): `is_premium`, `multiplier` (legado), `restricted_to`, `promo` (`discount_percent`, `ends_at`), `auto_discount` e `token_prices` com `batch_size`, `default` e `long_context` (`input_price`, `output_price`, `cache_read_price` ou `cache_price`, `cache_write_price`, `max_prompt_tokens` ou `context_max`). Preços em créditos de IA por `batch_size` tokens.

### Identificação do cliente

Cabeçalhos do Copilot Chat 0.72.0 (VS Code 1.144.0):

| Cabeçalho | Valor |
|---|---|
| `Editor-Version` | `vscode/<versão do VS Code>` (ex.: `vscode/1.144.0`) |
| `Editor-Plugin-Version` | `copilot-chat/<versão da extensão>` (ex.: `copilot-chat/0.72.0`) |
| `Copilot-Integration-Id` | `vscode-chat` na build da Microsoft; o código aberto mostra `code-oss`, substituído na build de produção |
| `User-Agent` | `GitHubCopilotChat/<versão>` |
| `X-GitHub-Api-Version` | `2025-05-01` em chat |
| `OpenAI-Intent` | intenção do local (ex.: `conversation-panel`) |
| `X-Request-Id`, `X-Interaction-Id`, `X-Agent-Task-Id` | UUIDs por requisição e por interação |
| `X-Interaction-Type` | `conversation-agent`, `conversation-subagent`, `conversation-background`, `conversation-panel`, `conversation-inline`, `conversation-edits`, `conversation-other`, `conversation-notebook` ou `conversation-terminal` |
| `X-Initiator` | `user` para o prompt do usuário, `agent` para chamadas automáticas |
| `Copilot-Vision-Request` | `true` quando a mensagem tem `image_url` e o modelo suporta visão |

- Não há regra publicada de versão mínima para `Editor-Version`; a rejeição de pares antigos não foi confirmada em fonte primária (não confirmado). O comentário do código do Thinker afirma que o GitHub valida e deprecia pares antigos.
- O Copilot CLI (v1.0.105) é código fechado; só o changelog e o README são públicos, então seus cabeçalhos exatos não puderam ser lidos. Ver `harness-copilot-cli`.

### Clientes permitidos e termos

- Clientes oficiais: VS Code, JetBrains, Visual Studio, Xcode, CLI, app e agente de nuvem. Não achei página oficial que autorize ou proíba gateways de terceiros (não confirmado).
- Relatos de usuários (não confirmado): e-mails de suspensão citam "clientes não suportados", contas múltiplas e "atividade automatizada excessiva em massa" (Política de Uso Aceitável). Projetos de proxy reversos para o Copilot se declaram não suportados.
- Risco prático: tráfego de gateway imita o cliente do VS Code; o Thinker deve avisar o usuário e evitar paralelismo agressivo.

### Cotas e uso

- Créditos mensais por plano (tabela acima), reset mensal; orçamento adicional configurável; sem fallback para modelo barato.
- Leitura: `copilot_internal/user` (acima); o CLI exibe `/usage` com créditos por modelo e `/limits`. Em planos organizacionais os administradores definem limites e overage.

### Erros

- Troca de token: 403 com `error_details` (sem Copilot, org desabilitou, termos não aceitos) e 403/429 com mensagem de rate limit da API do GitHub (padrão REST).
- Modelo sem suporte no endpoint: `/chat/completions` devolve "Unsupported API for model" para modelos só Responses (comentário em `provider-endpoints.ts`).
- Modelo aposentado ou fora do plano: erro de modelo não suportado (formato exato não verificado).
- Cota esgotada: o uso para (sem fallback) (docs de cobrança).

## Como o Thinker implementa hoje

- Autenticação: device code com `client_id` `Iv1.b507a08c87ecfe98` e escopo `read:user` (`packages/backend/src/routing/oauth/copilot/copilot-device-auth.service.ts:4`, `:23-27`). O token OAuth do GitHub é guardado como credencial do provedor (`packages/backend/src/routing/oauth/copilot/copilot.controller.ts:51-60`).
- Troca por token do Copilot: `GET https://api.github.com/copilot_internal/v2/token` com `Authorization: token <oauth>`, cache em memória até 2 minutos antes de `expires_at`; `refresh_in`, `sku` e `endpoints` são ignorados (`packages/backend/src/routing/proxy/copilot-token.service.ts:5-8`, `:56-85`). Usada no proxy (`packages/backend/src/routing/proxy/proxy-fallback.service.ts:985-989`) e na descoberta (`packages/backend/src/model-discovery/model-discovery.service.ts:189-191`).
- Base URL fixa `https://api.githubcopilot.com`; cabeçalhos enviados: `Authorization: Bearer`, `Content-Type`, `Editor-Version`, `Editor-Plugin-Version`, `Copilot-Integration-Id: vscode-chat` (`packages/backend/src/routing/proxy/provider-endpoints.ts:546-571`). Sem `User-Agent`, `Copilot-Vision-Request`, `X-Initiator`, `OpenAI-Intent`, `X-GitHub-Api-Version`.
- Versões fixas: `COPILOT_EDITOR_VERSION = 'vscode/1.100.0'` e `COPILOT_PLUGIN_VERSION = 'copilot/1.300.0'` (`packages/backend/src/common/constants/subscription-clients.ts:86-87`).
- Seleção de endpoint por modelo: `supported_endpoints` do `/models` decide entre `copilot` (`/chat/completions`) e `copilot-responses` (`/responses`, forçado em stream); `/v1/messages` não é reconhecido; fallback por regex de modelos só-Responses (`packages/backend/src/routing/proxy/provider-client.ts:149-150`, `:624-635`, `:672-705`, `:895-899`).
- Descoberta de modelos: `GET https://api.githubcopilot.com/models` com os mesmos cabeçalhos; converte `billing.token_prices` em USD por token (`× 0,01 / batch_size`), inclui camada `long_context`, janela de contexto por `context_max`/`max_prompt_tokens`, `supported_endpoints`; capacidades de raciocínio e código ficam `false` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:77`, `:752-848`, `:1052-1062`). Ignora `capabilities`, `billing.multiplier`, `promo` e `auto_discount`.
- Custo: assinatura Copilot usa a tabela de `token_prices` do modelo em cache e descarta `usage.cost` reportado, tratado como multiplicador de premium requests (`packages/backend/src/routing/proxy/proxy-message-recorder.ts:389-490`). Com a cobrança por créditos, o significado atual de `usage.cost` não foi verificado (não confirmado).
- Modelos conhecidos (fallback sem descoberta): 11 IDs, entre eles `claude-opus-4.6`, `gpt-5.4`, `gpt-5-mini`, `gemini-3.1-pro-preview`, `gpt-5.2-codex`, `grok-code-fast-1`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`; janela máxima 200000, sem cache de prompt (`packages/shared/src/subscription/configs.ts:322-346`).
- Outros: `max_completion_tokens` para Copilot (`packages/backend/src/routing/proxy/provider-client-converters.ts:161`), formato de raciocínio `reasoning_content` ou `reasoning_text` (`packages/backend/src/routing/proxy/reasoning-format.ts:24-27`, `:119`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/copilot-token.service.ts`
- `packages/backend/src/routing/oauth/copilot/`

Arquivos que citam `copilot`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/oauth/copilot/copilot.controller.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/proxy/proxy-message-recorder.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/frontend/src/components/CopilotDeviceLogin.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Identificação do cliente desatualizada: `vscode/1.100.0` e `copilot/1.300.0` contra VS Code 1.144.0 e `copilot-chat/0.72.0`; o formato do plugin também mudou (`copilot-chat/<versão>`) e falta `User-Agent: GitHubCopilotChat/<versão>`. Arquivos: `subscription-clients.ts:86-87`, `provider-endpoints.ts:546-571`, `provider-model-fetcher.service.ts:1052-1062`. Mudança: atualizar o par, usar o formato do plugin e enviar o UA. Rejeição de pares antigos não confirmada. | providers | [#332](https://github.com/patrickbrandao/thinker/issues/332) | aberta |
| G2 | degradação | `knownModels` do Copilot (fallback sem descoberta) lista modelos aposentados (Opus 4.6, Gemini 3.1 Pro, GPT-5.4, GPT-5 mini) e não tem as famílias atuais (Claude 5.x, GPT-6.x, Gemini 4, Grok 4.7). Arquivo: `packages/shared/src/subscription/configs.ts:322-346`. Mudança: reescrever a lista a partir do `/models` e das docs. | providers | [#333](https://github.com/patrickbrandao/thinker/issues/333) | aberta |
| G3 | degradação | Faltam cabeçalhos que o cliente oficial envia: `Copilot-Vision-Request: true` para mensagens com imagem, `X-Initiator` (`user`/`agent`), `OpenAI-Intent`, `X-GitHub-Api-Version`, `X-Request-Id`. Sem o de visão, pedidos com imagem podem falhar (não confirmado); sem `X-Initiator`, o faturamento pode tratar chamadas de agente como do usuário (não confirmado). Arquivos: `provider-endpoints.ts:546-571`, `provider-client.ts`. | providers | [#334](https://github.com/patrickbrandao/thinker/issues/334) | aberta |
| G4 | oportunidade | O token do Copilot traz `endpoints.api` (host por SKU) e `refresh_in`; o Thinker usa host fixo e só `expires_at`. Business/Enterprise podem precisar do host próprio (não confirmado). Arquivos: `copilot-token.service.ts`, `provider-endpoints.ts:547`. | backend-dev | — | aberta |
| G5 | oportunidade | `/v1/messages` (Anthropic Messages) aparece em `supported_endpoints`; permitiria raciocínio e cache nativos dos modelos Claude. O resolvedor só reconhece Chat e Responses. Arquivos: `provider-client.ts:149-150`, `:672-705`. | providers | — | aberta |
| G6 | oportunidade | Uso restante via `GET copilot_internal/user` (`quota_snapshots`) e crédito por requisição não são lidos; um medidor de uso como o do OpenCode Go seria possível. | backend-dev | — | aberta |
| G7 | oportunidade | `/models` entrega `capabilities` (visão, tools, `reasoning_effort`, limites), `billing.promo` e `auto_discount`; o parser fixa raciocínio e código como `false`. Arquivo: `provider-model-fetcher.service.ts:813-848`. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Fontes: código do Copilot Chat 0.72.0 em `microsoft/vscode` 1.144.0, changelog do Copilot CLI até v1.0.105, páginas de planos e modelos, changelogs de cobrança e depreciação. Encontrados: cobrança por créditos de IA (2026-06-01), `vscode-copilot-chat` arquivado, lista de modelos renovada, cabeçalhos novos. Abertas as lacunas G1 a G7.
