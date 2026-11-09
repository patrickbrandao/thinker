# Recursos do LiteLLM Proxy que o Thinker não tem

Revisão: LiteLLM `aa7917a3d2` (2026-11-05). Escala de **valor** (alto/médio/baixo) para um gateway de uso pessoal/pequeno time, hospedado por conta própria, com harnesses de agentes de código; **esforço** P (até ~1 dia), M (alguns dias), G (semanas ou mudança de arquitetura).

## Critérios usados

- **Já existe no Thinker** (não entra no ranking, só ajuda a calibrar): fallback em cadeia (até 5 rotas por tier ou modelo virtual), modelos virtuais (ADR 0004), roteamento por complexidade (`scoring/`) e por especificidade, rotação de chaves por provedor e cooldown de credencial rejeitada (`routing/proxy/credential-rejection-cooldown.ts`), roteamento ciente de context window (`context-window-fit.ts`), afinidade de sessão e momentum, passthrough de `/v1/embeddings`, `/v1/audio/transcriptions` e `/v1/messages/count_tokens`, regras de limite por harness em tokens ou custo (alerta e bloqueio, `notifications/`), limitador global por IP e por chave (`routing/proxy/proxy-rate-limiter.ts`, só `THINKER_RATE_MAX_REQUESTS`/`THINKER_CONCURRENCY_MAX`), gatilhos de eventos (e-mail, webhook, Telegram, Syslog), proxies de saída com perfis e failover, gravação de corpos com retenção, sessões, análises de custo e tokens, MCP de administração do próprio Thinker (`mcp/`), multi-organização com papéis (ADR 0006), playground.
- **Sem phone-home (ADR 0003 e `CLAUDE.md`):** o Thinker só fala com provedores configurados e com os destinos de gatilhos que o operador cadastrou, mais `openrouter.ai` e `models.dev`. Recurso que fala com um serviço novo escolhido pelo operador (Langfuse, Slack, Vault) segue o mesmo molde dos gatilhos de webhook: configurado explicitamente, passando por `ssrfSafeFetch` e pelos proxies de saída, e **sem destino padrão**. Mesmo assim, cada um é marcado abaixo. Qualquer destino fixo embutido no produto exigiria um ADR novo.
- **Escopo de mantenedor único (ADR 0005):** itens G de baixo valor ficam no fim, não descartados.

## Resumo (ordem de valor/esforço)

| # | Recurso | Valor | Esforço | ADR |
|---|---|---|---|---|
| 1 | Teto de iterações e de gasto por sessão | alto | P | ok |
| 2 | Limites RPM/TPM/concorrência por chave, harness e modelo | alto | M | ok |
| 3 | Fallbacks por classe de erro (contexto, política de conteúdo) | médio | P | ok |
| 4 | Retry na mesma rota com backoff | médio | P | ok |
| 5 | Métricas Prometheus (`/metrics`) | alto | P/M | ok (pull) |
| 6 | Chaves `thk_` com validade, rotação, allowlist de modelos e de IPs | alto | M | ok |
| 7 | Alertas Slack/Teams/Discord e de requisição pendurada | médio | P | ok |
| 8 | Exportação de gastos (CSV, FOCUS) | médio | P | ok |
| 9 | Preço customizado, margem e desconto | médio | P | ok |
| 10 | Tags de requisição (gasto e roteamento por tag) | médio | P/M | ok |
| 11 | Cooldown de rota por falhas e estado de saúde | médio | M | ok |
| 12 | Estratégias de balanceamento entre rotas equivalentes | alto | M | ok |
| 13 | Orçamento por provedor e por modelo | médio | M | ok |
| 14 | Cache exato de resposta | médio | M | ok (atenção a dados) |
| 15 | Exportadores de observabilidade (OTEL, Langfuse, S3) | médio | M | ressalva |
| 16 | Passthrough configurável pelo operador | médio | M | ok |
| 17 | Mais endpoints: rerank, imagens, TTS, moderações | médio | P a M cada | ok |
| 18 | Guardrails locais (regex/PII, injeção de prompt) | médio | M | ok (só locais) |
| 19 | Configuração declarativa (arquivo YAML) | médio | M | ok |
| 20 | Endurecimento de login e IPs confiáveis | médio | P | ok |
| 21 | SSO OIDC/JWT | médio | M | ok |
| 22 | Log de auditoria de ações administrativas | médio | M | ok (licença) |
| 23 | Interceptação de web search | médio | M/G | ressalva |
| 24 | Gateway MCP | alto | G | ressalva |
| 25 | Compactação de contexto | médio | M/G | ok |
| 26 | Roteamento adaptativo (bandit) e por qualidade | médio | G | ok |
| 27 | Roteamento por dados sensíveis | baixo | M | ok |
| 28 | Gestão de prompts versionados | baixo | M | ok |
| 29 | Alerta de modelo descontinuado | baixo | P | ok |
| 30 | Prioridade de requisição e fila | baixo | M | ok |
| 31 | Gasto por usuário final (`user`) | baixo | M | ok |
| 32 | Cache semântico | baixo | G | ressalva |
| 33 | Gerenciadores de segredo externos | baixo | M | ressalva |
| 34 | Batches, Files, Fine-tuning, Realtime, Vector Stores | baixo | G | ok |
| 35 | Gateway A2A (agent-to-agent) | baixo | G | ok |
| 36 | Policy engine, SCIM | baixo | G | ok |

---

## Grupo A: proteção de agentes e limites

### 1. Teto de iterações e de gasto por sessão
- **O que é:** `litellm/proxy/hooks/max_iterations_limiter.py` conta chamadas por `session_id` (cabeçalho `x-litellm-session-id` ou `metadata.session_id`) e responde 429 acima de `max_iterations`; `litellm/proxy/hooks/max_budget_per_session_limiter.py` faz o mesmo com um teto em dólares acumulado por sessão. Configuráveis por agente ou por metadados da chave. Também há exigência de trace-id por agente em `proxy/auth/auth_checks.py`.
- **Valor:** alto. Laço de agente descontrolado é o principal risco de custo para quem usa Claude Code, Codex, OpenClaw. O Thinker já identifica a sessão (`routing/proxy/harness-session.ts`) e soma custo por sessão (`analytics/services/sessions.service.ts`), mas só alerta por período.
- **Esforço:** P. Contador em memória/banco por `(tenant, session_id)`.
- **Encaixe:** sem conflito. Resposta com `ThinkerError` novo (`common/errors/error-codes.ts`, com `docs/erros.md`).
- **Onde ficaria:** checagem antes da primeira tentativa em `routing/proxy/proxy.service.ts`; limites como colunas em `agents`; configuração na aba do harness; evento de gatilho `limit.block` já existente.

### 2. Limites RPM/TPM/concorrência por chave, harness e modelo
- **O que é:** `proxy/hooks/parallel_request_limiter_v3.py` (RPM, TPM, `max_parallel_requests` por chave, usuário, equipe, modelo), `dynamic_rate_limiter_v3.py` (divide TPM entre chaves por prioridade), `proxy/hooks/rate_limiter_utils.py`.
- **Valor:** alto. Hoje o limitador (`routing/proxy/proxy-rate-limiter.ts`) tem valores globais por variável de ambiente. Falta limite por chave `thk_` e por modelo/provedor, útil para respeitar o plano de assinaturas (por exemplo, não estourar a cota de 5 h) sem depender de 429 do provedor.
- **Esforço:** M.
- **Encaixe:** ok. Single-instância usa memória; réplicas pedem contador compartilhado no PostgreSQL (o gancho `FOR UPDATE SKIP LOCKED` dos gatilhos mostra o padrão).
- **Onde ficaria:** estender `ProxyRateLimiter`; limites em `agent_api_keys`; UI na tela de chaves.

### 3. Fallbacks por classe de erro
- **O que é:** `context_window_fallbacks`, `content_policy_fallbacks` e fallbacks gerais separados, em `router_utils/fallback_event_handlers.py`, `proxy/management_endpoints/fallback_management_endpoints.py` e `types/router.py`.
- **Valor:** médio. O Thinker já filtra por janela antes (`context-window-fit.ts`) e cai para a próxima rota em qualquer status >= 400; falta uma cadeia diferente para recusa de política de conteúdo (ir para um modelo menos restritivo) ou para erro de contexto no meio do pedido.
- **Esforço:** P.
- **Encaixe:** ok.
- **Onde ficaria:** classificação de erro em `shared/src/provider-error-semantics.ts` e `routing/proxy/proxy-fallback.service.ts`; opção por modelo virtual (`routing/virtual-models/`).

### 4. Retry na mesma rota com backoff
- **O que é:** `num_retries`, `retry_policy` e `allowed_fails_policy` por tipo de exceção (`router_utils/handle_error.py`, `router_utils/cooldown_handlers.py`); respeita `Retry-After`.
- **Valor:** médio. Erros transitórios (5xx, 429 curto) hoje consomem uma rota de fallback. Não confirmei a fundo se há retry intra-rota no Thinker; o fluxo documentado vai direto à próxima rota (guia, seção Roteamento).
- **Esforço:** P.
- **Encaixe:** ok; cuidado com a latência de primeiro token e com o aquecimento de stream (`stream-warmup.ts`).
- **Onde ficaria:** `routing/proxy/proxy-fallback.service.ts`, parâmetros por conexão em `tenant_providers`.

### 11. Cooldown de rota por falhas e estado de saúde
- **O que é:** `router_utils/cooldown_cache.py`, `cooldown_handlers.py`, `health_state_cache.py`: um deployment que falha acima de `allowed_fails` fica em cooldown por `cooldown_time` e sai do sorteio.
- **Valor:** médio. O Thinker tem cooldown só para credencial rejeitada; uma rota com 5xx repetidos continua sendo tentada primeiro em cada pedido, somando latência.
- **Esforço:** M.
- **Encaixe:** ok; é estado derivado de tráfego real, sem chamadas extras.
- **Onde ficaria:** novo serviço ao lado de `credential-rejection-cooldown.ts`, consultado por `isRouteAvailable` nos resolvedores de `routing/resolve/`.

### 13. Orçamento por provedor e por modelo
- **O que é:** `router_strategy/budget_limiter.py` (teto em dólares por provedor e janela, filtra deployments acima do teto) e `proxy/hooks/model_max_budget_limiter.py` (teto por modelo e por chave).
- **Valor:** médio. Útil para travar gasto em provedores por uso (API key) enquanto assinaturas ficam livres. Hoje o limite é por harness.
- **Esforço:** M.
- **Encaixe:** ok.
- **Onde ficaria:** `notifications/services/limit-check.service.ts` (nova dimensão) e filtro em `isRouteAvailable`.

### 31. Gasto por usuário final
- **O que é:** o campo `user` do OpenAI vira "customer" com orçamento (`management_endpoints/customer_endpoints.py`, `budget_management_endpoints.py`).
- **Valor:** baixo para uso pessoal; só serve se o Thinker for revenda para terceiros.
- **Esforço:** M. **Encaixe:** ok. **Onde:** `entities/` e `analytics/`.

### 30. Prioridade de requisição e fila
- **O que é:** `scheduler.py`, `router_utils/request_priority.py`, `proxy/route_priority.py`: requisições de prioridade alta passam na frente quando há contenção.
- **Valor:** baixo. **Esforço:** M. **Encaixe:** ok. **Onde:** antes do passo de concorrência de `ProxyRateLimiter`.

---

## Grupo B: roteamento e balanceamento

### 12. Estratégias de balanceamento entre rotas equivalentes
- **O que é:** `router_strategy/` com `simple_shuffle.py`, `least_busy.py`, `lowest_latency.py`, `lowest_cost.py`, `lowest_tpm_rpm_v2.py`, `lar1_routing.py`, pesos por deployment (`weight`) e `order`/prioridade. O mesmo `model_name` agrupa vários deployments.
- **Valor:** alto para quem tem várias chaves ou contas do mesmo modelo (por exemplo 3 assinaturas). O Thinker hoje usa principal + fallbacks (ordem fixa) e rotação de chaves só como reação a 429.
- **Esforço:** M.
- **Encaixe:** ok. O modelo virtual (ADR 0004) é o lugar natural: um campo `strategy` por virtual, com `ordered` como padrão para não mudar o comportamento atual.
- **Onde ficaria:** `routing/virtual-models/virtual-model-chain.ts` (`buildVirtualModelChain`) e `routing/resolve/`; latência vinda de `agent_messages`.

### 10. Tags de requisição
- **O que é:** `router_strategy/tag_based_routing.py` e tags de gasto via cabeçalho/`metadata.tags` (`proxy/litellm_pre_call_utils.py`, `daily_activity_routes.py`): o cliente marca a requisição (`x-litellm-tags`) e o gasto é agrupado e/ou o roteamento filtra por tag.
- **Valor:** médio. Dá recorte de custo por projeto/tarefa sem criar harness novo.
- **Esforço:** P (gasto) a M (roteamento).
- **Encaixe:** ok.
- **Onde ficaria:** leitura do cabeçalho junto de `routing/proxy/request-headers.ts`, coluna em `agent_messages`, filtro em `analytics/`.

### 26. Roteamento adaptativo, por qualidade e semântico
- **O que é:** `router_strategy/adaptive_router/` (bandit Thompson por tipo de requisição e modelo, aprende com sinais pós-resposta e grava no Postgres), `quality_router/` (tier de qualidade por complexidade), `auto_router/` (similaridade por embeddings), `complexity_router/` (heurística, com modos opcionais que chamam provedor).
- **Valor:** médio. O Thinker já tem pontuação de complexidade e especificidade; o diferencial é aprender com o resultado. Qualidade do sinal é difícil de acertar.
- **Esforço:** G.
- **Encaixe:** ok se local; classificadores com chamada a provedor precisam de conexão configurada.
- **Onde ficaria:** `scoring/` e `routing/resolve/`.

### 27. Roteamento por dados sensíveis
- **O que é:** `proxy/hooks/sensitive_data_routing.py`: quando um guardrail detecta dado sensível (`on_sensitive_data='route'`), a sessão fica presa a um modelo definido (por exemplo local).
- **Valor:** baixo a médio (casa bem com Ollama/LM Studio). **Esforço:** M, depende do item 18. **Encaixe:** ok. **Onde:** `routing/proxy/proxy.service.ts`, junto do afinidade de sessão.

---

## Grupo C: observabilidade e custo

### 5. Métricas Prometheus
- **O que é:** `integrations/prometheus.py`, `prometheus_helpers/`, `proxy/prometheus_metrics_server.py`: contadores e histogramas de requisições, tokens, gasto, latência, falhas e fallbacks por modelo/chave/equipe em `/metrics`.
- **Valor:** alto para quem já tem Grafana. É pull, então não é phone-home.
- **Esforço:** P/M. Há risco de cardinalidade; limitar rótulos.
- **Encaixe:** ok (nenhuma chamada de saída). Proteger com token próprio.
- **Onde ficaria:** novo módulo `packages/backend/src/metrics/` alimentado pelo gravador do proxy (`routing/proxy/proxy-message-recorder.ts`).

### 8. Exportação de gastos (CSV e FOCUS)
- **O que é:** `integrations/focus/`, `integrations/cloudzero/`, `vantage/`, `pointfive/`, `proxy/spend_tracking/cold_storage_handler.py`, relatórios diários em `management_endpoints/daily_activity_routes.py`.
- **Valor:** médio. Não achei exportação CSV no frontend/backend do Thinker.
- **Esforço:** P (CSV pelo painel e API), M (FOCUS).
- **Encaixe:** ok; o download é feito pelo usuário.
- **Onde ficaria:** `analytics/` (endpoint `GET .../export?format=csv`) e botão no dashboard.

### 9. Preço customizado, margem e desconto
- **O que é:** `input_cost_per_token`/`output_cost_per_token` por deployment em `model_info`, mais margem e desconto por provedor (`proxy/management_endpoints/cost_tracking_settings.py`, `cost_calculator.py`).
- **Valor:** médio. O custo gravado vem de `model-prices/`; quem tem desconto negociado ou custo rateado de assinatura não consegue ajustar. A lista curada `provider-price-seeds.ts` é do projeto, não do operador.
- **Esforço:** P.
- **Encaixe:** ok.
- **Onde ficaria:** override por conexão em `tenant_providers`, aplicado em `computeTokenCost` (`model-prices/`).

### 15. Exportadores de observabilidade
- **O que é:** `integrations/opentelemetry.py`/`otel/`, `langfuse/`, `langsmith.py`, `datadog/`, `helicone.py`, `s3_v2.py`, `gcs_bucket/`, `generic_api/` (callback HTTP genérico em lote).
- **Valor:** médio. O gatilho `request.debug` + webhook cobre o caso genérico, mas sem lote, sem formato OTEL/Langfuse e sem trace de sessão.
- **Esforço:** M (OTEL e Langfuse primeiro).
- **Encaixe:** **ressalva ADR 0003**: envia dados de uso para serviços externos. Aceitável só como destino configurado pelo operador, sem padrão, no molde dos gatilhos (cifra de segredos, `ssrfSafeFetch`, proxy de saída). Não copiar o padrão de ligar por variável global.
- **Onde ficaria:** novo tipo de gatilho em `triggers/trigger-senders.ts` e `shared/src/triggers.ts`; o módulo `otlp/` hoje é só legado.

### 7. Alertas Slack, Teams, Discord e de requisição pendurada
- **O que é:** `integrations/SlackAlerting/` (`slack_alerting.py`, `ms_teams.py`, `hanging_request_check.py`, `budget_alert_types.py`): alerta de requisição lenta/pendurada, de falha de provedor, de orçamento e relatório diário.
- **Valor:** médio. Já existem `provider.failure` e `credential.expired`; faltam tipos de destino de chat e um evento de "requisição pendurada".
- **Esforço:** P (um tipo de gatilho é um sender + variáveis em `shared/src/triggers.ts`).
- **Encaixe:** ok, mesmo molde de webhook.
- **Onde ficaria:** `triggers/trigger-senders.ts`.

### 29. Alerta de modelo descontinuado
- **O que é:** `proxy/alerting_endpoints/model_deprecation_alerts.py`, `integrations/model_deprecation_email.py`: avisa quando um modelo configurado tem data de descontinuação.
- **Valor:** baixo a médio. O Thinker já descobre modelos por provedor (`model-discovery/`): um modelo que some da lista de uma conexão poderia gerar o evento sem nenhuma chamada nova.
- **Esforço:** P. **Encaixe:** ok. **Onde:** `model-discovery/` e novo evento em `shared/src/triggers.ts`.

---

## Grupo D: chaves, acesso e segurança

### 6. Chaves com validade, rotação, allowlist de modelos e de IPs
- **O que é:** `proxy/management_endpoints/key_management_endpoints.py` (`duration`/`expires`, rotação automática com período de graça, `models` permitidos, `allowed_routes`, metadados), `access_group_endpoints.py` e `model_access_group_management_endpoints.py` (grupos de acesso a modelos), `proxy/auth/ip_address_utils.py` (IPs permitidos por chave).
- **Valor:** alto para distribuir chaves a ferramentas e pessoas. As chaves `thk_` do Thinker pertencem ao harness; não confirmei campo de validade nem allowlist por chave.
- **Esforço:** M.
- **Encaixe:** ok.
- **Onde ficaria:** `entities/` (`agent_api_keys`), guard de chave em `common/guards/`, UI de chaves.

### 20. Endurecimento de login e IPs confiáveis
- **O que é:** `proxy/auth/login_throttle.py`, `password_policy.py`, `master_key_boot_check.py`, `trusted_proxy_utils.py`.
- **Valor:** médio quando exposto à internet. O Better Auth já tem limite próprio; vale conferir política de senha e a lista de proxies confiáveis (`X-Forwarded-For`).
- **Esforço:** P. **Encaixe:** ok. **Onde:** `auth/auth.instance.ts`, `main.ts`.

### 21. SSO OIDC e JWT
- **O que é:** `proxy/auth/handle_jwt.py` (valida JWT de IdP, mapeia claims para equipe/papel), `proxy/management_endpoints/sso/`, `jwt_key_mapping_endpoints.py`.
- **Valor:** médio. Só importa com time; o Better Auth tem plugin OIDC genérico.
- **Esforço:** M.
- **Encaixe:** ok, mas o login com provedor externo é tráfego de saída escolhido pelo operador (equivalente a configurar um provedor); sem padrão.
- **Onde ficaria:** `auth/auth.instance.ts` e tela de configuração da organização.

### 22. Log de auditoria de ações administrativas
- **O que é:** `enterprise/litellm_enterprise/proxy/audit_logging_endpoints.py`: quem mudou chave, modelo, equipe, quando.
- **Valor:** médio com mais de uma pessoa. Não achei equivalente no Thinker.
- **Esforço:** M.
- **Encaixe:** ok no produto, **mas o código do LiteLLM está sob licença Enterprise**: só reimplementar a ideia.
- **Onde ficaria:** interceptor Nest global em `common/` e tabela `audit_events`; retenção junto de `database/request-recording-retention.service.ts`.

### 18. Guardrails locais
- **O que é:** `proxy/guardrails/` (registro, `guardrail_endpoints.py`) e `guardrail_hooks/litellm_content_filter` (regex/categorias locais), `presidio.py` (PII, serviço externo), `block_code_execution`, `tool_permission.py`, `tool_policy`, `proxy/hooks/prompt_injection_detection.py`, além de dezenas de integrações de terceiros (Lakera, Aporia, Bedrock Guardrails...). Modos `pre_call`, `during_call`, `post_call`, mascarar ou bloquear.
- **Valor:** médio. Para uso pessoal, o mais útil é mascarar segredos e PII antes de sair para a nuvem, e bloquear ferramentas perigosas.
- **Esforço:** M para um filtro local (regex de segredos, PII, lista de ferramentas bloqueadas); G para a infraestrutura geral.
- **Encaixe:** só guardrails **locais** combinam com o ADR 0003. Os de terceiros enviam o conteúdo da conversa a outro serviço: tratar como conflito, a menos que o operador cadastre o destino como faz com gatilhos.
- **Onde ficaria:** etapa antes de `ProviderClient` em `routing/proxy/` (junto de `inline-image-redaction.ts`), regras por harness.

### 36. Policy engine e SCIM
- **O que é:** `proxy/policy_engine/` (associa guardrails e regras a equipes, chaves, tags, com condições), `proxy/management_endpoints/scim/` (provisionamento de usuários).
- **Valor:** baixo para o escopo atual. **Esforço:** G. **Encaixe:** ok. **Onde:** `organizations/`, depois do item 18.

### 33. Gerenciadores de segredo externos
- **O que é:** `litellm/secret_managers/` (AWS Secrets Manager, Vault, GCP, Azure Key Vault) e referências `os.environ/...` na configuração.
- **Valor:** baixo; o Thinker cifra os segredos no banco. **Esforço:** M. **Encaixe:** ressalva: chamada de saída ao cofre escolhido pelo operador. **Onde:** `common/` (cifragem) e leitura de variáveis `THINKER_*_FILE`.

---

## Grupo E: cache e eficiência

### 14. Cache exato de resposta
- **O que é:** `litellm/caching/` (`caching.py`, `in_memory_cache.py`, `redis_cache.py`, `s3_cache.py`, `gcs_cache.py`, `dual_cache.py`), chave por hash dos parâmetros, TTL, `namespace`, controle por requisição (`cache` no corpo: `no-cache`, `ttl`, `namespace`).
- **Valor:** médio. Ajuda em testes repetidos, evals e ferramentas que reenviam a mesma consulta; para agentes de código quase nunca bate, porque o contexto muda a cada turno. Não confundir com o prompt caching do provedor, que o Thinker já trata (`cache-injection.ts`, afinidade de sessão).
- **Esforço:** M (só não-streaming primeiro; streaming exige reemitir SSE).
- **Encaixe:** ok. Atenção: guarda conteúdo de conversa; cifrar como as gravações e respeitar a retenção.
- **Onde ficaria:** antes da cadeia de fallback em `routing/proxy/proxy.service.ts`; armazenamento reaproveita `common/services/request-recording-storage.service.ts`.

### 32. Cache semântico
- **O que é:** `caching/redis_semantic_cache.py`, `qdrant_semantic_cache.py`, `valkey_semantic_cache.py`, `_embedding_router.py`: reaproveita resposta de pergunta parecida por similaridade de embedding.
- **Valor:** baixo (risco de resposta errada em código). **Esforço:** G (embeddings e vetor, possivelmente pgvector). **Encaixe:** ressalva: exige provedor de embeddings configurado. **Onde:** depois do item 14.

### 25. Compactação de contexto
- **O que é:** `litellm/compression/`, `proxy/native_compaction.py`, `router_strategy/complexity_router/context_compaction.py`, `integrations/compression_interception/`: resume ou poda o histórico quando se aproxima da janela.
- **Valor:** médio para sessões longas em modelos pequenos. Hoje o Thinker só tira da cadeia as rotas que não cabem (`context-window-fit.ts`).
- **Esforço:** M (poda de resultados de ferramentas antigas) a G (resumo por modelo).
- **Encaixe:** ok. A variante com resumo chama um modelo configurado pelo operador.
- **Onde ficaria:** `routing/proxy/context-window-fit.ts` como alternativa a descartar a rota.

---

## Grupo F: endpoints e integrações de protocolo

### 16. Passthrough configurável pelo operador
- **O que é:** `proxy/pass_through_endpoints/` e `proxy/config_management_endpoints/pass_through_endpoints.py`: o operador registra `path -> target`, com cabeçalhos, autenticação e rastreio de custo opcional, para chegar a APIs nativas de um provedor (Vertex, Gemini, Bedrock, Cohere...).
- **Valor:** médio. O Thinker tem passthrough fixo (`routing/proxy/passthrough.ts`).
- **Esforço:** M.
- **Encaixe:** ok; destino cadastrado vai por `validatePublicUrl`/`ssrfSafeFetch`.
- **Onde ficaria:** `routing/proxy/passthrough.ts` com tabela de rotas e UI.

### 17. Mais endpoints de API
- **O que é:** em `litellm/proxy/`: `rerank_endpoints`, `image_endpoints` (`/images/generations`, `/images/edits`), `/audio/speech`, `/moderations`, `ocr_endpoints`, `search_endpoints`, `video_endpoints`, `vertex_ai_endpoints`, `google_endpoints`.
- **Valor:** médio. `/v1/rerank` e `/v1/images/generations` são os mais pedidos por ferramentas de RAG e UIs de chat. O `provider-model-fetcher.service.ts` já conhece modelos de rerank/realtime, então a descoberta é parcial.
- **Esforço:** P a M por endpoint (reaproveitar o molde do passthrough de embeddings).
- **Encaixe:** ok.
- **Onde ficaria:** `routing/proxy/passthrough.ts` e `proxy.controller.ts`.

### 23. Interceptação de web search
- **O que é:** `integrations/websearch_interception/` e `proxy/search_endpoints/`: quando o modelo não tem busca nativa (por exemplo Claude via Bedrock), o proxy executa a ferramenta de busca no servidor com um provedor de busca (Tavily, Brave, etc.) e devolve o resultado ao modelo.
- **Valor:** médio. Dá busca web a qualquer modelo/harness.
- **Esforço:** M/G (loop de ferramenta server-side, streaming).
- **Encaixe:** ressalva: tráfego novo para um provedor de busca, só com conta cadastrada pelo operador (como qualquer provedor).
- **Onde ficaria:** `routing/proxy/` como etapa de ferramenta; provedores em `shared/src/providers.ts`.

### 24. Gateway MCP
- **O que é:** `proxy/mcp_server/` (`server.py`, `mcp_server_manager.py`, `tool_registry.py`, `semantic_tool_filter.py`, `tool_search.py`, `toolset_db.py`, `client_allowlist.py`, OAuth e BYOK em `oauth2_*`/`byok_*`, `openapi_to_mcp_generator.py`, guardrails MCP): registra servidores MCP upstream, expõe um único endpoint `/mcp` com permissões por chave/equipe, conjuntos de ferramentas e filtro semântico de ferramentas.
- **Valor:** alto no ecossistema de agentes (um ponto central de ferramentas e credenciais), mas é grande.
- **Esforço:** G.
- **Encaixe:** ressalva: o Thinker já tem um servidor MCP, mas para administrar o próprio Thinker (`packages/backend/src/mcp/`). Um gateway MCP é produto novo e saída para servidores que o operador cadastra (seguir SSRF e proxy de saída). Provavelmente pede um ADR.
- **Onde ficaria:** novo módulo `mcp-gateway/`, separado de `mcp/`.

### 28. Gestão de prompts versionados
- **O que é:** `proxy/prompts/`, `integrations/dotprompt/`, `integrations/prompt_management_base.py`, `integrations/gitlab/`, `bitbucket/`: referenciar `prompt_id` + variáveis, com versões.
- **Valor:** baixo para harnesses de código (eles trazem o próprio prompt). **Esforço:** M. **Encaixe:** ok. **Onde:** `routing/proxy/` + tabela nova.

### 34. Batches, Files, Fine-tuning, Realtime, Vector Stores, Assistants
- **O que é:** `proxy/batches_endpoints`, `openai_files_endpoints`, `fine_tuning_endpoints`, `realtime_endpoints`, `vector_store_endpoints`, `rag_endpoints`, `container_endpoints`, `openai_evals_endpoints`, `video_endpoints`; o gerenciamento de arquivos e vector stores "gerenciados" está em `enterprise/` (licença).
- **Valor:** baixo para o caso de uso atual. **Esforço:** G cada. **Encaixe:** ok. **Onde:** `routing/proxy/passthrough.ts` seria o primeiro passo (só repassar para a OpenAI).

### 35. Gateway A2A
- **O que é:** `proxy/a2a/`, `proxy/agent_endpoints/` (registro de agentes, agent card, kill switch, identidade): expõe agentes remotos via protocolo A2A.
- **Valor:** baixo hoje. **Esforço:** G. **Encaixe:** ok com as mesmas ressalvas do item 24. **Onde:** módulo novo.

---

## Grupo G: operação e configuração

### 19. Configuração declarativa
- **O que é:** `proxy_server_config.yaml`, `proxy/proxy_config.yaml`, `proxy/example_config_yaml/`, `litellm_cli/`: modelos, rotas, fallbacks, limites em um arquivo versionável (GitOps), com `store_model_in_db` opcional.
- **Valor:** médio para quem recria instâncias. O Thinker tem API, CLI e MCP, mas não um "aplicar arquivo".
- **Esforço:** M (export/import de provedores sem segredo, harnesses, virtuais, regras).
- **Encaixe:** ok; segredos ficam fora do arquivo (referência a variável de ambiente).
- **Onde ficaria:** `packages/cli/` (`thinker config export|apply`) sobre os serviços existentes.

---

## Notas finais

- **Itens que o LiteLLM chama de recurso mas o Thinker já cobre:** aliases de modelo (`model_group_alias`) = modelos virtuais; roteamento por complexidade = `scoring/`; afinidade de cache de prompt (`caching/affinity_cache.py`, `router_utils/prompt_caching_cache.py`) = afinidade de sessão; proxy de saída e failover; recorte de parâmetros por provedor (`drop_params`) = `param-policy.ts`; playground.
- **Não verificado a fundo:** retry na mesma rota (item 4), validade e allowlist por chave `thk_` (item 6), política de senha (item 20) e ausência de exportação CSV (item 8) foram conferidos por busca textual, não por leitura completa do código.
- **O que desaconselho trazer:** integrações de guardrail de terceiros embutidas (item 18), qualquer padrão de destino de telemetria ligado por padrão, e cópia de código de `enterprise/`.
