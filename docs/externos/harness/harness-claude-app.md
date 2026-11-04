---
id: harness-claude-app
categoria: harness
entidade: Claude (desktop app)
agente: harness-claude-app
thinker_ids: [claude-app]
revisado_em: 2026-11-03
versao_observada: Claude Desktop 4.16336.0 (docs claude.com 2026-11-03)
---

# Claude (desktop app) (harness)

Especificação mantida pelo agente `harness-claude-app` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- A entidade é o **Claude Desktop** (app de Anthropic com abas Chat, Cowork e Code). Identificação com confiança alta: a documentação oficial trata o app como "Claude Desktop on 3P" (terceiros) e descreve gateway Anthropic Messages.
- Só aponta para um gateway no **modo 3P**: `inferenceProvider = gateway`, URL base e chave informadas na janela Developer > Configure Third-Party Inference (ou por MDM, arquivo local ou servidor de bootstrap). **Não lê `ANTHROPIC_BASE_URL` nem `settings.json`** para isso (code.claude.com, llm-gateway-connect, seção Desktop). Com o gateway ativo, ambientes em nuvem da Anthropic e Remote Control ficam indisponíveis.
- Superfície: Anthropic Messages. Obrigatório: `POST /v1/messages` com streaming e tool use. `GET /v1/models` é opcional. Não há menção a `count_tokens` na página do gateway do Desktop.
- **Seleção de modelo:** a descoberta automática só mostra ids "reconhecidamente Claude"; o id `auto` do Thinker não aparece. É preciso listar `inferenceModels` à mão (`name`, `behavesAs`, `supports1m`, `labelOverride`). Aqui está o ponto prático mais importante para o Thinker (lacuna G1).
- Cabeçalhos de sessão: o Desktop não documenta nenhum próprio. As sessões Code/Cowork rodam o Claude Code embutido (a doc diz que "Claude Code" executa Chat e Cowork), então `x-claude-code-session-id` e correlatos são esperados `(não confirmado, requer captura real)`. O Thinker não lê nenhum (G2, mesma causa da issue #320).
- Seed original (`support.claude.com`) foi substituída: a fonte de verdade é `claude.com/docs/third-party/claude-desktop/*` (+ `code.claude.com`).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Deploy Claude Desktop on 3P with an LLM gateway (fonte principal) | <https://claude.com/docs/third-party/claude-desktop/gateway> | 2026-11-03 (lida inteira) |
| Configuration reference (chaves `inference*`) | <https://claude.com/docs/third-party/claude-desktop/configuration> | 2026-11-03 (primeiros 100 mil de 187 mil caracteres) |
| Models and effort levels | <https://claude.com/docs/third-party/claude-desktop/models> | 2026-11-03 |
| In-app configuration | <https://claude.com/docs/third-party/claude-desktop/in-app-configuration> | 2026-11-03 |
| Configuration changelog (chaves por versão do app) | <https://claude.com/docs/cowork/3p/configuration-changelog> | v4.16336.0, 2026-11-03 |
| Connect Claude Code to an LLM gateway, seção Desktop app | <https://code.claude.com/docs/en/llm-gateway-connect.md> | 2026-11-03 |
| Claude Code Desktop (variáveis de ambiente de sessões locais) | <https://code.claude.com/docs/en/desktop> | 2026-11-03 (primeiros 100 mil de 218 mil) |
| Gateway compatibility guide (cabeçalhos do Claude Code embutido) | <https://code.claude.com/docs/en/llm-gateway-protocol.md> | ver dossiê `harness-claude-code` |
| Guias de terceiros (LiteLLM, Zuplo, ZenMux, Merge, TrueFoundry) | pesquisa web 2026-11-03 | só pistas, `(não confirmado)` |
| ~~support.claude.com~~ (semente) | — | descartada: sem página específica; a documentação 3P fica em claude.com/docs |

Não há código-fonte público do app (Electron fechado). A evidência é documentação oficial e changelog de configuração.

## Contrato

### Configuração do gateway

- Caminho na UI: Help > Troubleshooting > Enable Developer Mode, depois Developer > Configure Third-Party Inference. Seção Connection: Inference provider = **Gateway**; campos Gateway base URL, Gateway API key, Credential kind (`static` padrão, `helper-script`, `interactive`, `external-idp`...), Gateway auth scheme. "Apply Changes" grava local e reinicia; "Export" gera `.mobileconfig`, `.reg`, JSON etc. Perfil gerenciado presente deixa a janela somente leitura.
- Chaves (JSON local/bootstrap; MDM usa os mesmos nomes):

| Chave | Significado |
|---|---|
| `inferenceProvider` | `gateway` liga o modo 3P com gateway; outros: `anthropic`, `bedrock`, `mantle`, `vertex`, `foundry` |
| `inferenceGatewayBaseUrl` | "URL completa do endpoint do gateway" (desde 1.2581.0) |
| `inferenceGatewayApiKey` | chave do gateway (placeholder serve se o gateway não tem chave) |
| `inferenceGatewayAuthScheme` | `bearer` (padrão, `Authorization: Bearer`) ou `x-api-key` (desde 1.3036.0) |
| `inferenceCredentialKind` | fonte única da credencial, sem fallback |
| `inferenceCredentialHelper` (+`Args`, `TtlSec` 3600, `TimeoutSec` 60) | executável que imprime o token ou `{"token","headers"}` |
| `inferenceCustomHeaders` | cabeçalhos extras em toda requisição (roteamento, tenant); sem credenciais |
| `inferenceStreamIdleTimeoutSec` | 300-1800; padrão 300, tempo extra sobre ~5 min de pings |
| `inferenceGatewayAutoModeServerChecks` | opt-in; manda `anthropic-beta` extra (`dangerous-tool-use-2026-09-03`) e campo `safeguards`; o gateway deve repassar e devolver `safeguard_results` |
| `inferenceModels`, `modelDiscoveryEnabled` | ver seleção de modelo |

- Base URL: a doc mostra `https://llm-gateway.example.corp` sem caminho. Guias de terceiros divergem sobre sufixos (`/v1`, `/v1/anthropic`), porque cada gateway tem prefixo próprio; um (Zuplo) diz que o app acrescenta `/v1/messages`. **Se a URL base do Thinker leva ou não `/v1` não está confirmado** `(não confirmado: testar com `http://localhost:2099` e `.../v1`)`.
- Provavelmente exige HTTPS fora de localhost `(não confirmado)`; a janela valida e testa a conexão ("Gateway was unreachable" quando falha na partida).
- Configuração é lida uma vez na abertura: fechar e reabrir o app a cada mudança.

### Seleção de modelo

- Com `inferenceModels` vazio, o seletor é preenchido por `GET /v1/models` e **só entram ids reconhecidamente Claude**. O primeiro descoberto vira o padrão. Falha ou erro em `/v1/models` cai em `inferenceModels`; se vazia, o seletor fica vazio. Gateway que aceita a chamada e trava atrasa a lista até 10 s na abertura.
- `inferenceModels`: lista de strings (id exato que o gateway aceita) ou objetos `{name, labelOverride, supports1m, prefer1m, anthropicFamilyTier, isFamilyDefault, behavesAs, maxEffort}`; o primeiro é o padrão. O app envia `name` ao gateway. Se todos os itens são ids completos, o app dispensa `/v1/models` (versões antigas: `modelDiscoveryEnabled=false`); um alias de família (`sonnet`) mantém a descoberta ligada.
- Campos lidos em cada objeto de `/v1/models`: `id`, `display_name` (rótulo), `description` (1.49585.0+), `supports_1m: true` ou `max_input_tokens >= 1000000` (marca 1M), e `anthropic_family_tier` (`sonnet`, `opus`...) com `is_family_default` (resolve alias de família).
- Id desconhecido (alias de roteamento como `auto`): sem controle de Effort e janela assumida de **200K**. `behavesAs: "<id Claude completo>"` (4.29.0+) dá o controle de Effort/Thinking e a janela do modelo citado; `supports1m` exige que o gateway aceite o beta `context-1m-2025-08-07`. `behavesAs` rejeita nome de família (`sonnet`).
- `alwaysStartWithDefaultModel`, `defaultModelEffort`, `maxEffort` controlam o padrão por conversa.
- Modelo de tarefas de fundo (título etc.): não documentado para o Desktop `(não confirmado)`; como Code roda o Claude Code, ver `harness-claude-code`.

### Cabeçalhos e sessão

- Autenticação: `Authorization: Bearer <chave>` (padrão) ou `x-api-key`, conforme `inferenceGatewayAuthScheme`; SSO manda o ID token/access token do IdP como Bearer. Os dois cabeçalhos ao mesmo tempo não são citados.
- `anthropic-version`, `anthropic-beta` e demais: o app repassa o que o Claude Code embutido manda. Betas citados nesta doc: `context-1m-2025-08-07` (quando `supports1m`), `tool-search-tool-2025-10-19` (só com `toolSearchEnabled`), `dangerous-tool-use-2026-09-03` (Auto mode server checks). Em gateways, o Desktop **desliga por padrão** tool search e os betas experimentais do Claude Code, porque gateways estritos rejeitam esses cabeçalhos/campos.
- Id de sessão: sem cabeçalho próprio documentado. Esperado `x-claude-code-session-id`, `x-claude-code-agent-id`, `x-claude-code-parent-agent-id` e dicas (ver `harness-claude-code`) `(não confirmado para o Desktop)`. `inferenceCustomHeaders` permite ao admin acrescentar um cabeçalho fixo, mas o valor é estático (não serve de id de sessão).

### Outros endpoints

- `GET /v1/models` (opcional, ver acima). `POST /v1/messages/count_tokens` não é citado; o Claude Code embutido usa estimativa se der 404 `(não confirmado para o Desktop)`.
- Fora do gateway: login/serviços da Anthropic só no modo 1P; no modo 3P a doc fornece lista de domínios de egress (export "Firewall allowlist"). Não há telemetria para o Thinker.

### Recursos usados

Streaming SSE completo com `ping` (o app aceita ~5 min só de pings, mais `inferenceStreamIdleTimeoutSec`; gateway deve enviar pings e não bufferizar); tool use; `cache_control` em cada turno e leitura de `usage.cache_read_input_tokens`, `cache_creation_input_tokens` e do objeto `cache_creation` (`ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`), usado na telemetria OTel e na contagem de contexto (sem os campos de cache a sessão subconta e não compacta a tempo); compactação por requisição de resumo (precisa do erro "prompt too long" intacto do upstream); thinking e Effort por modelo; imagens e MCP (Cowork/Code).

### Erros e retentativas

- Erro do upstream deve ser repassado com status e corpo sem reembrulhar (recuperação de compactação e de betas rejeitados depende do texto).
- `402` com `{"type":"error","error":{"type":"billing_error","message":"..."}}`: o app mostra o cartão "Billing issue" com a mensagem e **não** tenta de novo (4.4212.0+).
- `429`: retenta por cerca de 3 minutos ou mais, salvo `x-should-retry: false`; `401`/`403`: cartão de credencial; `400`: "Invalid request".
- Erros de TLS (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`): faltou certificado intermediário ou CA privada.

### Snippet de setup do Thinker

Não existe para `claude-app` hoje. Esperado: janela Configure Third-Party Inference com Inference provider = Gateway, Gateway base URL = URL do Thinker (porta 2099; `/v1` a confirmar), Gateway API key = `thk_...`, auth scheme `bearer`, e `inferenceModels` explícito, por exemplo `[{"name":"auto","labelOverride":"Thinker auto","behavesAs":"claude-sonnet-5","supports1m":false}]` `(não confirmado)`. Depois "Apply Changes". Em JSON de arquivo/bootstrap, um objeto com as chaves da tabela.

## Como o Thinker implementa hoje

Branch/commit lido: worktree `onda2` em `0c93e2a`, 2026-11-03.

- Plataforma: `claude-app` na lista de plataformas (`packages/shared/src/agent-type.ts:29`), superfície `messages` (`:79`), rótulo "Claude (APP)" (`:105`), categoria `personal` (`:129`), ícone `/icons/claude-app.svg` (`:140`, arquivo em `packages/frontend/public/icons/claude-app.svg`).
- Setup: `PLATFORM_SETUP_SNIPPETS` cobre openclaw, claude-code, nanobot, codex, n8n (`packages/shared/src/setup-snippets.ts:111-120`); **não há** entrada `claude-app`, nem em `SetupStepAddProvider.tsx` (`AgentId` linha 19) nem seção em `docs/usuario/conectar-harnesses.md` (o `grep -i desktop` só acha Docker Desktop e Codex).
- Rotas: `GET /v1/models` (`packages/backend/src/routing/proxy/proxy.controller.ts:176`), `POST /v1/messages` (`:262`), `chat/completions` (`:246`), `responses` (`:254`). Não há `POST /v1/messages/count_tokens` (grep em `packages/backend/src` sem resultado).
- Autenticação: aceita Bearer e `x-api-key` (docs/usuario/conectar-harnesses.md, ambos com valores diferentes dão `M006`); compatível com os dois esquemas do Desktop.
- Sessão: só `x-session-key` (`proxy.controller.ts:277` e `:899`, via `buildProxySessionScope`); `x-claude-code-*` não é lido em lugar nenhum. Observação: `harness-session.ts` não existe na `main` (está em outra sessão, ainda não commitada).
- Afinidade por sessão dos provedores: `packages/backend/src/routing/proxy/provider-hooks.ts:41-68`.
- `GET /v1/models` devolve o formato OpenAI (`object: 'model'`, `proxy.controller.ts:176-245`) com `auto` e modelos virtuais; sem `display_name`, `description`, `supports_1m` nem `anthropic_family_tier`. Para o Desktop só ids com cara de Claude seriam descobertos, então `auto` some do seletor.
- Atribuição do chamador: `classifyCaller` lê `user-agent` e `x-stainless-*` (`packages/backend/src/routing/proxy/caller-classifier.ts`); o `user-agent` do Desktop não é documentado.
- `anthropic-beta` do chamador é lido e saneado (`packages/backend/src/routing/proxy/anthropic-beta.ts`; `proxy.service.ts` nas linhas citadas em `harness-claude-code`).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Sem guia nem snippet para o Claude Desktop (modo 3P). O Desktop ignora `ANTHROPIC_BASE_URL`; usa `inferenceGatewayBaseUrl`/`inferenceGatewayApiKey`, e a descoberta só mostra ids Claude, então `auto` não aparece sem `inferenceModels` (com `behavesAs`/`supports1m` para Effort e janela). | frontend-dev / docs-ptbr | [#368](https://github.com/patrickbrandao/thinker/issues/368) | aberta |
| G2 | degradação | Id de sessão do Desktop (provável `x-claude-code-session-id`, não confirmado) não é lido; mesma causa de `harness-claude-code` G1. | backend-dev | [#320](https://github.com/patrickbrandao/thinker/issues/320) (comentado) | aberta |
| G3 | oportunidade | `GET /v1/models` com `display_name`, `description`, `supports_1m`/`max_input_tokens` e `anthropic_family_tier` + `is_family_default` para o seletor do Desktop (e, para o Claude Code, ids com `claude`/`anthropic`). | backend-dev | — | aberta |
| G4 | oportunidade | Repassar sem alteração `usage.cache_creation` (`ephemeral_5m/1h_input_tokens`) e o erro "prompt too long" do upstream; devolver `402` com `billing_error` quando houver limite de gasto por chave, para o cartão "Billing issue" do Desktop. Verificar no código o que o caminho Anthropic hoje preserva. | backend-dev | — | aberta |
| G5 | oportunidade | Servir `POST /v1/messages/count_tokens` (compartilhado com `harness-claude-code` G3). | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa (Claude Desktop 4.16336.0, docs 3P). Entidade identificada como Claude Desktop em modo 3P; seed `support.claude.com` descartada. Abertos G1 (#368) e comentário em #320 para G2; G3-G5 como oportunidade. Pendente de teste real: formato da URL base, cabeçalhos efetivamente enviados, ids usados em tarefas de fundo.
