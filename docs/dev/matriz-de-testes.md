# Matriz de testes por recurso

Esta página responde, para cada recurso do Thinker, "que teste prova que isto funciona?". Ela acompanha o **modo teste completo**, que só roda quando alguém pede:

```bash
npm run test:full                      # tudo
scripts/test-full.sh --only unit       # só alguns estágios
scripts/test-full.sh --skip e2e        # pula estágios
scripts/test-full.sh --fail-fast       # para no primeiro estágio que falhar
```

## Estágios do teste completo

| Estágio | O que roda | Onde |
| --- | --- | --- |
| `static` | ESLint, catálogos i18n (en e pt-BR), registro do design system, typecheck com TypeScript 6 e 7 | `npm run lint`, `check:i18n`, `design:registry:check`, `typecheck`, `typecheck:ts7` |
| `build` | build de shared, backend, frontend e CLI; falha se o build alterar algum arquivo versionado (arquivos gerados desatualizados) | `npm run build --workspace=...` |
| `unit` | backend (em UTC e em `America/Sao_Paulo`), frontend, shared e CLI | `npm test --workspace=...` |
| `scripts` | testes dos scripts do repositório | `npm run test:scripts` |
| `e2e` | suíte e2e do backend num PostgreSQL descartável, em UTC e em `America/Sao_Paulo` | `npm run test:e2e:docker --workspace=packages/backend` |
| `contracts` | contratos do gateway, só quando `THINKER_BASE_URL` aponta para uma instância de teste (a instância do mantenedor, porta 2099, é recusada) | `contracts/gateway/tests/` |

Fora do script, e **obrigatório antes de uma entrega para ambiente crítico**: a rodada na **imagem Docker construída** (compose somente leitura, fumaça do admin, completions Chat, Messages e Responses contra um provedor simulado, contratos do gateway e gravações que sobrevivem à recriação do contêiner). Ela precisa de portas e volumes isolados; rode com o agente `qa-docker`.

## Recursos e testes

Legenda: **U** = unitário (Jest ou Vitest, ao lado do código ou em `packages/frontend/tests`), **E** = e2e do backend (`packages/backend/test`), **C** = contrato do gateway, **UI** = teste do dashboard.

| Recurso | Cobertura |
| --- | --- |
| Proxy de chat (OpenAI Chat Completions) | U `routing/proxy/__tests__/proxy.controller*.spec.ts`, `proxy.service.spec.ts`, `provider-client*.spec.ts`; E `proxy.e2e-spec.ts`, `roundtrip`, `thinker-identifiers`; C `routes`, `identifiers` |
| Anthropic Messages | U `anthropic-adapter*.spec.ts`, `anthropic-messages-adapter.spec.ts`; E `anthropic-beta-header`, `gateway-x-api-key` |
| Responses API (Codex, n8n) | U `responses-adapter.spec.ts`, `responses-stream-tools.spec.ts`, `responses-call-ids.spec.ts`, `chatgpt-*.spec.ts`; E `codex-responses` |
| Gemini, Bedrock, Vertex, Kiro, Copilot | U `google-adapter.spec.ts`, `bedrock-*.spec.ts`, `vertex-deployment.spec.ts`, `kiro-adapter.spec.ts`, `copilot-token.service.spec.ts` |
| Rotas de passagem (embeddings, transcrição, `count_tokens`, `/v1/models`) | U `passthrough.spec.ts`, `proxy.controller.models.spec.ts` |
| Fallback, cooldown e reset de cota | U `proxy-fallback*.spec.ts`, `quota-reset.spec.ts`, `credential-rejection-cooldown.spec.ts`; E `proxy-fallback-auth` |
| Política de parâmetros e reasoning | U `param-policy.spec.ts`, `reasoning-*.spec.ts`, `sanitize-model-params.spec.ts`; E `tier-model-params` |
| Roteamento por nível, especificidade e modelos virtuais | U `tier.controller`, `specificity.controller`, `virtual-models/*.spec.ts`; E `routing-flow`, `virtual-models*.e2e-spec.ts`, `auto-routing-custom-provider` |
| Classificação de complexidade (scoring) | U `scoring/**` (palavras-chave, overrides, categorias) |
| Provedores: chaves, assinaturas OAuth, servidores locais, provedores custom | U `provider.controller`, `custom-provider*`, `oauth/**`, `local-servers`; E `custom-providers*`, `local-providers`, `multi-key-providers`, `oauth-subscription-lock`, `custom-provider-dns-rebinding` |
| Descoberta de modelos e catálogos | U `model-discovery/*.spec.ts`; E `model-prices` |
| Preços e custo | U `model-prices/*.spec.ts`, `cost-calculator` (faixas de contexto longo, datas, cache 1h); E `costs` |
| Limites de uso e alertas | E `limits`; U `notifications/**`; UI `Limits*.test.tsx` |
| Analytics, mensagens e sessões | U `analytics/**` (incl. `sessions.service.spec.ts`); E `messages*`, `overview`, `provider-analytics*`, `reliability-analytics`, `attempt-analytics`, `errors-breakdown`, `org-account-branding-sessions`; UI `MessageLog`, `Sessions`, `SessionDetail`, `Overview` |
| Gravação de requisições | U `attempt-recording*.spec.ts`; E `request-recordings`, `message-log-completeness` |
| Gatilhos de eventos (webhook, e-mail, syslog) | U `triggers/*.spec.ts` (despacho, fila, tentativas, escuta, controlador, serviço), `shared/__tests__/triggers.spec.ts`; E `triggers.e2e-spec.ts`; UI `TriggerEditor`, `TriggerDeliveries`, `Triggers`, `AgentTriggers` |
| Proxies de saída (servidores, perfis, atribuições, estatísticas) | U `proxy-servers/*.spec.ts`, `proxy-egress.service.spec.ts`; E `proxy-servers.e2e-spec.ts`, `no-phonehome-egress`; UI `tests/components/proxy/**`, `ProxyServer(s).test.tsx` |
| Topologia e console (busca, alertas) | U `console/*.spec.ts`; E `console`, `proxy-servers` (atribuição de saída); UI `tests/topology/**`, `FlowCanvas` |
| Organizações, membros, papéis e contas | U `organizations/*.spec.ts`; E `organizations`, `org-account-branding-sessions`, `cross-tenant-isolation`, `tenant-isolation`; UI `Organization`, `UserMenu`, `MeGate` |
| Autenticação, chaves de API, CLI auth, MCP OAuth | U `auth/*.spec.ts`; E `setup`, `signup-lock`, `tokens`, `cli-auth`, `mcp-cimd-ssrf`; UI `Login`, `Register`, `CliAuth`, `Consent` |
| MCP (servidor e ferramentas) | U `mcp/**` (incl. `virtual-models.tools.spec.ts`); E `virtual-models-mcp` |
| Playground | U `playground/*.spec.ts`; E `playground-*.e2e-spec.ts`; UI `Playground` |
| Segurança de rede (SSRF, DNS rebinding, CORS, CSP, sem phone-home) | U `provider-client.ssrf.spec.ts`; E `custom-provider-dns-rebinding`, `cors`, `csp`, `no-phonehome-egress`, `offline-guard` |
| Cifragem de segredos e chave de criptografia | E `encryption-key-required`; U `common/crypto*` |
| Migrações | E `*-migrations.e2e-spec.ts`, `drop-*-migration` |
| Saúde e configuração | E `health`, `smoke-test`; U `health/*.spec.ts`, `config/*.spec.ts` |
| CLI `thinker` | U `packages/cli/src/**/*.spec.ts` (todos os comandos); `npm run gen` verificado no estágio `build` |
| Pacote compartilhado (provedores, assinaturas, gatilhos, tipos) | U `packages/shared/__tests__/**` |
| Dashboard: configuração de harnesses | UI `tests/components/HarnessSetups.test.tsx`, `setup-ui.test.tsx`, `SetupModal`, `Welcome*.test.tsx` |
| Dashboard: idiomas (en e pt-BR) | UI `tests/i18n/**`; `check:i18n` no estágio `static` |
| Imagem Docker e implantação | rodada `qa-docker` (fora do script) |

## Defeitos achados ao completar a cobertura

Os pendentes ficam registrados como teste `it.skip` com o comentário `// BUG:`. Quando forem resolvidos, troque `it.skip` por `it`.

### Corrigidos nesta rodada

| Defeito | Correção |
| --- | --- |
| Descoberta do LM Studio devolvia lista vazia quando o servidor não tem `/api/v0/models` (regressão da onda 7) | volta a cair em `/v1/models` |
| `GET /proxy-servers/:id/stats?days=2.5` respondia 500 | `days` arredondado para inteiro |
| `PUT /proxy-assignments/...` com `mode` que não é texto apagava a atribuição | responde 400 |
| `PUT /me/active-organization` sem `organizationId` respondia 500 | responde 400 |
| `POST /oauth/opencode/start` com provedor inválido respondia 503 | responde 400 |
| `getSubscriptionProviderConfig('constructor')` devolvia uma função | só ids próprios do registro |
| Mensagem de limite de tokens repetia "tokens tokens" | texto corrigido |
| `JsonBlock` quebrava com `undefined`, função ou símbolo | usa `String(value)` |
| `FlowCanvas` somente leitura dava zoom no clique duplo em vez de abrir o nó | `zoomOnDoubleClick` desligado |

Também ficaram verdes, por estarem desatualizados desde a renomeação das conexões (#454) e das mudanças de retenção das gravações (#277), os e2e `multi-key-providers`, `custom-providers` e `request-recordings`; o e2e `gateway-x-api-key` agora confere que o valor gravado é `[REDACTED]` e que a chave nunca aparece em nenhuma coluna; e o `encryption-key-required` não herda mais a chave de um `.env` local.

### Pendentes de decisão (testes `it.skip` com `// BUG:`)

| Ponto | Onde | Decisão |
| --- | --- | --- |
| `POST /admin/users` cria a conta antes de validar `organizationId` e `role`; se a associação for recusada, a conta fica e a senha temporária se perde | `organizations.controller.spec.ts` | Validar antes de criar? |
| Num gatilho de e-mail já salvo, trocar o provedor (ex.: Mailgun para SendGrid) mantém a chave antiga como válida | `TriggerEditor.test.tsx` | Exigir nova chave ao trocar? |

### Observações de comportamento (sem teste de falha)

- Se o snapshot de proxies de saída não carrega e não existe um anterior, a conexão sai pelo caminho global ou direto (não bloqueia). O código indica que é intencional; para ambiente crítico, avalie falhar fechado.
- Servidores locais em IP de rede local passam pelo proxy global (`THINKER_HTTP_PROXY`) a menos que o host esteja em `THINKER_NO_PROXY`, enquanto o dashboard os desenha como "Rede local".
- Um administrador não consegue editar um gatilho que o dono apontou para endereço privado, porque o PATCH revalida a URL sem permitir endereços privados.

