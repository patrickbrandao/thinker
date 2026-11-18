# Como o LiteLLM Proxy armazena as requisições

Pergunta respondida: onde, por quanto tempo, o quê, com que proteção e por qual caminho de escrita o LiteLLM Proxy guarda o que passa por ele, comparado ao que o Thinker faz hoje.

| Campo | Valor |
|---|---|
| SHA do LiteLLM revisado | `c030ffb6b9c7a1b49072dceca1c2224cdfc21bcc` (`main`) |
| Data do commit | 2026-11-18T13:19:05Z |
| Data desta execução | 2026-11-18 |
| Thinker comparado | `main` em `6bf042a6` |

Convenções: caminhos sem prefixo são da árvore do LiteLLM (`litellm/...` na raiz do clone `~/.cache/thinker/litellm`); `packages/...` e `docs/...` são do Thinker. "Código" = o que li no clone. "Docs" = o que as páginas de `docs.litellm.ai` dizem (o clone raso não traz `docs/my-website/`, então li as páginas pela web, em 2026-11-18). Onde as duas fontes divergem, está na seção [Código x docs](#código-x-docs).

## Resumo

1. **Nada é gravado sem banco.** O gravador de custo (`ProxyDBLogger`) só é registrado quando existe `prisma_client`, isto é, com Postgres configurado (`litellm/proxy/proxy_server.py:3458-3466`, função `cost_tracking`). Postgres é o armazenamento padrão e único obrigatório; Redis é opcional; S3/GCS/Datadog/Langfuse/OTEL etc. são callbacks opt-in sem nenhum ligado por padrão.
2. **Por requisição, uma linha em `LiteLLM_SpendLogs`** (metadados, tokens, custo, latência, identidade, tags, IP, status, erro) **mais incrementos em tabelas diárias** (`LiteLLM_Daily*Spend`) e nos contadores de chave/usuário/time. **O corpo (prompt, resposta, tool calls) não é gravado por padrão**: só com `store_prompts_in_spend_logs: true` (ou env `STORE_PROMPTS_IN_SPEND_LOGS`).
3. **Retenção: nenhuma por padrão.** Sem `maximum_spend_logs_retention_period` (ou `maximum_spend_logs_size`) nada é apagado. As tabelas diárias e a de auditoria nunca expiram, salvo `LiteLLM_DailyTagSpend` (opt-in).
4. **Escrita em lote, fora do caminho da requisição.** A linha vai para uma fila em memória (teto de 64 MB), um monitor a descarrega a cada 2 s a 30 s (limiar de 100 linhas), em `INSERT` de até 100 linhas/2 MB por comando. Os contadores de gasto passam por um **livro-razão** (`LiteLLM_SpendLogDelivery`), padrão desde que `use_spend_logs_ledger` virou `true`.
5. **Privacidade:** chave de API gravada como SHA-256 (sem sal); corpo, quando gravado, passa por truncamento por string (2048 caracteres), mascaramento de campos com cara de credencial e, opcionalmente, de tokens no texto. Tudo em texto claro no Postgres; não achei criptografia por coluna nas linhas de log.

## 1. Onde

| Destino | O que guarda | Padrão | Como ligar | Evidência |
|---|---|---|---|---|
| Postgres `LiteLLM_SpendLogs` | uma linha por requisição (inclusive falhas, `status='failure'`) | **ligado** se há banco | desligar: `general_settings.disable_spend_logs: true` | `litellm/proxy/schema.prisma:816-859`; `litellm/proxy/proxy_server.py:3347` (`disable_spend_logs = False`); `litellm/proxy/db/db_spend_update_writer.py:905-909` |
| Postgres `LiteLLM_SpendLogToolIndex`, `LiteLLM_SpendLogGuardrailIndex` | índices "últimas N linhas por tool/guardrail" (nome da tool, não argumentos) | ligado junto com as linhas | n/a | `schema.prisma:1473-1494`; `db_spend_update_writer.py:926-932`; `litellm/proxy/db/spend_log_tool_index.py:49-73` |
| Postgres `LiteLLM_Daily{User,Global,Team,Organization,EndUser,Agent,CustomerMember,Tag}Spend` | agregados por dia, por entidade, chave, modelo, provedor, endpoint | **ligado**, mesmo com `disable_spend_logs` | n/a | `schema.prisma:961-1269`; `db_spend_update_writer.py:918-924` (comentário: agregados escritos com ou sem linhas) |
| Postgres `LiteLLM_DailyModelUsage`, `LiteLLM_DailyToolSpend`, `LiteLLM_DailyGatewayRequests`, `LiteLLM_DailyGatewayFailedRequests`, `LiteLLM_DailyRequestErrors`, `LiteLLM_DailyGuardrailMetrics` | agregados de uso por modelo/tarefa, tool, rota do gateway, falhas por status e por chave/time/usuário | ligado | n/a | `schema.prisma:1420-1470`, `1496-1577`; `litellm/proxy/db/request_error_tracking.py:1-80` |
| Postgres `LiteLLM_VerificationToken`/`UserTable`/`TeamTable`/`EndUserTable`/`BudgetWindowSpend` | contadores `spend` acumulados | ligado | n/a | `schema.prisma:597`, `393`, `275`, `764`, `861` |
| Postgres `LiteLLM_SpendLogDelivery` (livro-razão) | `accounting_payload` JSON por requisição até ser aplicado aos contadores | **ligado** (`use_spend_logs_ledger` padrão `true`) | desligar volta às filas em memória/Redis | `schema.prisma:2315-2336`; `litellm/proxy/_types.py:2593-2596`; `litellm/repositories/table_repositories.py:170-246` |
| Postgres `LiteLLM_ErrorLogs` | tabela legada de erros | **nada grava nela**; só é lida | n/a | `grep` por `LiteLLM_ErrorLogs`: só leituras em `spend_management_endpoints.py:1144,1270` e `proxy_server.py:18909`; modelo em `litellm/models/spend_logs.py:40-52`. Falhas hoje são linhas de `SpendLogs` com `status='failure'` e `metadata.error_information` (`litellm/proxy/hooks/proxy_track_cost_callback.py:471-560`) |
| Postgres `LiteLLM_AuditLog` | mudanças administrativas (chave, time, usuário, modelo), `before_value`/`updated_values` | **só com licença enterprise** (`premium_user`) ou `store_audit_logs`/`LITELLM_STORE_AUDIT_LOGS`; o gravador ainda exige `premium_user` | `litellm_settings.store_audit_logs: true` | `schema.prisma:948-958`; `litellm/proxy/management_helpers/audit_logs.py:59-72,123-135` |
| Postgres `LiteLLM_ScheduledJobRun`, `LiteLLM_CronJob`, `LiteLLM_ProxyWorkerHeartbeat`, `LiteLLM_Config` | coordenação entre pods e estado dos jobs | ligado | n/a | `schema.prisma:808-814,1271-1316` |
| Redis (lista `litellm_spend_logs_buffer`) | linhas de spend log "estacionadas" quando a escrita no banco falha ou no desligamento; **sem TTL** (`RPUSH`+`LTRIM`, teto de 100 000 linhas) | **desligado** | `general_settings.use_redis_transaction_buffer: true` + Redis | `litellm/constants.py:507-509`; `litellm/proxy/db/db_transaction_queue/redis_update_buffer.py:671-713`; `litellm/caching/redis_cache.py:2123-2153` |
| Redis (listas `litellm_*_update_buffer`) | incrementos de contadores/diários (caminho **legado**, com `use_spend_logs_ledger: false`), contagens do gateway e de erros | desligado | `use_redis_transaction_buffer` | `constants.py:490-506`; `db_spend_update_writer.py:938-958`, `1929-2141` |
| Redis (cache de resposta e caches internos) | respostas de LLM (cache opt-in) e caches do proxy; TTL padrão 60 s no `RedisCache` | cache de resposta desligado | `cache: true` | `litellm/caching/redis_cache.py:618-621`, `litellm/caching/base_cache.py:15-16` |
| Arquivos | só `api_log.json` declarado e logs de stdout; nenhum arquivo de requisição por padrão | n/a | n/a | `proxy_server.py:3268` |
| S3 / GCS / Azure Blob / DynamoDB / SQS / Pub/Sub / Datadog / Langfuse / OTEL / ClickHouse etc. | `StandardLoggingPayload` completo (com mensagens e resposta, salvo redação) | **nenhum ligado** | `litellm_settings.success_callback`/`callbacks`; por chave/time via `TeamCallbackMetadata` | `litellm/integrations/` (`s3_v2.py`, `gcs_bucket/`, `azure_storage/`, `dynamodb.py`, `sqs.py`, `gcs_pubsub/`, `datadog/`, `langfuse/`, `otel/`, `clickhouse/`); `litellm/proxy/_types.py:2217-2240` |
| "Cold storage" (S3/GCS) | corpo da requisição fora do banco; a linha guarda só `metadata.cold_storage_object_key` | desligado | `litellm.cold_storage_custom_logger` | `litellm/litellm_core_utils/litellm_logging.py:8231-8283`; `litellm/litellm_core_utils/cold_storage_handler.py:11-62` |
| Memória do processo | fila de linhas (`spend_log_transactions`), filas diárias, fila de tool usage, filas de callbacks em lote | sempre | n/a | `litellm/proxy/utils.py:5993-5998`; `litellm/integrations/custom_batch_logger.py:23-52` |
| Sidecar "collector" | processo local que roda o pipeline de custo recebendo eventos por socket (`unix`/TCP loopback) | desligado | `LITELLM_COLLECTOR_ENABLED=true` | `litellm/proxy/spend_tracking/spend_event_producer.py:1-60`; `spend_event.py:1-30` |
| Serviço remoto de escrita | o proxy faz `POST {SPEND_LOGS_URL}/spend/update` em vez de inserir no banco | desligado | env `SPEND_LOGS_URL` | `litellm/proxy/utils.py:8903-8924`; `db_spend_update_writer.py:1866` |

Observação sobre telemetria: existe `litellm/telemetry/` + `litellm/proxy/telemetry/` (tabela `LiteLLM_TelemetryReport`, destino `local_table` ou `http`, consentimento por grupos). Não li o suficiente para dizer o que sai da máquina por padrão (`litellm/proxy/telemetry/settings.py:12-46`, `litellm/telemetry/consent.py`); relevante para o ADR 0003 se algum dia se olhar para isso.

## 2. Por quanto tempo

### O que o código faz

- **Sem configuração, nada expira.** `SpendLogCleanup._run_passes` devolve `skipped_disabled` quando nenhuma regra está configurada (`litellm/proxy/db/db_transaction_queue/spend_log_cleanup.py:1467-1475`). No registro dos jobs, o cleanup só é agendado se alguma chave de retenção existir (`litellm/proxy/proxy_server.py:6085-6130`).
- **Regras (todas em `general_settings`)**, lidas a cada execução (portanto valem sem reiniciar, `spend_log_cleanup.py:452-475`):

| Chave | Efeito | Padrão | Evidência |
|---|---|---|---|
| `maximum_spend_logs_retention_period` (`"7d"`, `"24h"`, inteiro = dias) | apaga `LiteLLM_SpendLogs` e `LiteLLM_SpendLogToolIndex` mais antigos | nulo (nunca apaga) | `spend_log_cleanup.py:517-547`; `_types.py:3045-3048` |
| `maximum_spend_logs_size` (`"180GB"`) + `maximum_spend_logs_cleanup_target_size` | regra por tamanho: apaga as linhas mais antigas até o alvo; mede `pg_total_relation_size` das duas tabelas; independente da regra por idade | nulo | `spend_log_cleanup.py:566-588,1101-1215`; `_types.py:3069-3092` |
| `maximum_daily_tag_spend_retention_period` | apaga `LiteLLM_DailyTagSpend` por dia | nulo | `spend_log_cleanup.py:1049-1059,1357-1368`; `_types.py:3059-3068` |
| `maximum_health_check_retention_period`, `maximum_autorouter_session_retention_period` | idem para health checks e sessões do auto-router | nulo | `spend_log_cleanup.py:1001-1047`; `_types.py:3049-3058` |
| `maximum_spend_logs_retention_interval` | intervalo do job | `"1d"` | `spend_log_cleanup.py:1577-1583` |
| `maximum_spend_logs_cleanup_cron` | cron (UTC) no lugar do intervalo; passa a conduzir também a regra de tamanho | nulo | `spend_log_cleanup.py:1578-1580`; `proxy_server.py:6102-6120` |
| `maximum_spend_logs_size_check_interval` / env `SPEND_LOG_SIZE_CHECK_INTERVAL` | frequência da regra de tamanho | `"1d"` | `spend_log_cleanup.py:1586-1590`; `constants.py:1950` |
| `maximum_spend_logs_cleanup_batch_size` / `SPEND_LOG_CLEANUP_BATCH_SIZE` | linhas por `DELETE` | 1000 | `constants.py:1941` |
| `maximum_spend_logs_cleanup_max_batches` / `SPEND_LOG_RUN_LOOPS` | `DELETE`s por tabela por execução | 500 | `constants.py:1940` |
| `maximum_spend_logs_cleanup_run_budget` / `SPEND_LOG_CLEANUP_RUN_BUDGET_SECONDS` | orçamento de relógio por execução, dividido entre as tabelas | 300 s | `constants.py:1946`; `spend_log_cleanup.py:1482-1496` |
| `maximum_spend_logs_cleanup_batch_timeout` / `SPEND_LOG_CLEANUP_BATCH_TIMEOUT_SECONDS` | `statement_timeout` e `lock_timeout` de cada lote (`SET LOCAL`) | 30 s | `constants.py:1947`; `spend_log_cleanup.py:763-788` |
| `use_spend_logs_partitioning` | se a tabela já foi convertida em tabela particionada, **derruba partições inteiras** em vez de `DELETE` e pré-cria as próximas | falso | `_types.py:3093-3096`; `spend_log_cleanup.py:1083-1090`; `litellm/proxy/db/db_transaction_queue/spend_logs_partition_manager.py:1-60`; `litellm/scripts/db/partition_spend_logs.sql:1-40` |

- **Mecânica do `DELETE`:** `DELETE ... WHERE (request_id, startTime) IN (SELECT ... WHERE startTime < $1 LIMIT $2)`, em transação com `statement_timeout`/`lock_timeout`, pausa de 0,1 s entre lotes, aborta após 3 falhas consecutivas (`SPEND_LOG_CLEANUP_MAX_CONSECUTIVE_BATCH_FAILURES`), retoma na execução seguinte porque o corte é recalculado (`spend_log_cleanup.py:820-945`, `constants.py:1942-1945`). Cada execução expõe métricas (`spend_log_cleanup_metrics.py`).
- **Agendador e trava entre pods (sem Redis):** cada pod faz *polling* (padrão 30 s, `SCHEDULED_JOB_POLL_INTERVAL_SECONDS`) da tabela `LiteLLM_ScheduledJobRun`; em uma transação sob `pg_try_advisory_xact_lock(hashtext(lock_group))` ele recolhe execuções vencidas (lease expirada vira `FAILED`), planeja a próxima e **reivindica** a execução com `UPDATE ... WHERE status='PENDING'`. A execução roda fora da transação sob *lease* = orçamento + 300 s de folga; os jobs de idade e de tamanho dividem o mesmo `lock_group` e nunca se sobrepõem. Histórico limitado a 1000 execuções por job (`litellm/proxy/db/scheduled_job_runs.py:205-262,273-360,413`; `constants.py:1951-1955`; `spend_log_cleanup.py:1616-1629`).
- **O que a limpeza NÃO apaga** (nenhuma referência de `DELETE` no código lido): `LiteLLM_Daily*Spend` (exceto `DailyTagSpend`), `LiteLLM_DailyModelUsage`, `LiteLLM_DailyRequestErrors`, `LiteLLM_AuditLog`, `LiteLLM_SpendLogGuardrailIndex`, `LiteLLM_ErrorLogs`. `LiteLLM_SpendLogDelivery` tem limpeza própria: linhas `applied` e não-`is_batch` são apagadas após `LITELLM_ACCOUNTING_DELIVERY_RETENTION_DAYS` (padrão **1 dia**) por quem pegar o lock Redis `accounting_delivery` (`litellm/accounting/worker.py:91-105`, `litellm/repositories/accounting_delivery_repository.py:150-162`).
- **Efeito de agregados que sobrevivem às linhas brutas:** os `LiteLLM_Daily*Spend` guardam por dia e por (entidade, chave hasheada, modelo, grupo de modelo, provedor, endpoint) tokens de prompt/completion, tokens de cache, gasto, contagem de requisições/sucessos/falhas, soma de tempo de resposta e economias (`schema.prisma:961-998`). A UI de uso lê esses agregados, não a `SpendLogs`; a documentação de `db_info` diz isso e `spend_log_api_key_scope.py:1-5` confirma que `SpendLogs` não tem índice em `user` nem `team_id` (a leitura filtra pelas chaves do dono via tabelas diárias).
- **Disco não volta sozinho:** `DELETE` não encolhe arquivos; o LiteLLM nunca roda `VACUUM FULL`/`pg_repack`. Por isso existe o roteiro de particionamento (`partition_spend_logs.sql`, chave primária passa a `(request_id, startTime)` e `prisma db push` deixa de funcionar).
- **Redis:** as listas de buffer não têm TTL (só `RPUSH`/`LTRIM` com teto de linhas, `redis_cache.py:2070-2104,2123-2153`); as travas de pod têm TTL de 60 s (`DEFAULT_CRON_JOB_LOCK_TTL_SECONDS`, `pod_lock_manager.py:68-96`, `constants.py:1983`). O cache de resposta usa `ttl`/`default_in_redis_ttl`; o padrão do `RedisCache` é 60 s quando `litellm.default_redis_ttl` não está definido (`redis_cache.py:618-621`).
- **Callbacks externos:** a retenção é do destino (bucket, Langfuse etc.); o LiteLLM só limita a fila local (`DEFAULT_MAX_QUEUE_SIZE = 50 000` em `custom_batch_logger.py:20-23`, lote `DEFAULT_BATCH_SIZE = 512` e intervalo 5 s em `constants.py:99,103`).
- **`max_spend_logs_row_size`:** **não existe** no código (nenhum resultado em `grep`). O limite por linha é indireto: truncamento por string (seção 3) e orçamento de bytes da fila/instrução (seção 5).

### O que acontece sem configurar

Tudo cresce sem limite: `SpendLogs`, `ToolIndex`, `GuardrailIndex`, as tabelas diárias, `AuditLog`. A página de dimensionamento do LiteLLM estima **1-2 KB por requisição sem prompts** e cerca de 10x com `store_prompts_in_spend_logs` (docs `db_sizing`, não verificado no código).

## 3. O que é gravado

### 3.1 Colunas de `LiteLLM_SpendLogs` (`schema.prisma:816-859`)

`request_id` (PK; id do provedor ou UUID, com sufixo `_cache_hit<timestamp>` em acertos de cache, `spend_tracking_utils.py:1004-1007`), `call_type`, `api_key` (hash), `spend`, `total_tokens`/`prompt_tokens`/`completion_tokens`, `startTime`, `endTime`, `request_duration_ms`, `completionStartTime` (TTFT), `model`, `model_id`, `model_group`, `custom_llm_provider`, `api_base`, `user`, `metadata` (JSON), `cache_hit`, `cache_key`, `request_tags` (JSON), `team_id`, `organization_id`, `end_user`, `requester_ip_address`, `messages` (JSON), `response` (JSON), `session_id`, `status` (`success`/`failure`), `mcp_namespaced_tool_name`, `billing_agent_id`, `agent_id`, `proxy_server_request` (JSON), `litellm_call_id`, `created_at`, `updated_at`. Índices: `startTime`, `(startTime, request_id)`, `end_user`, `session_id`, `litellm_call_id`, `(api_key, startTime)`. A montagem está em `litellm/proxy/spend_tracking/spend_tracking_utils.py:1018-1074`.

`metadata` (JSON, `SpendLogsMetadata`, `litellm/proxy/_types.py:3921-3986`): `user_api_key` (hash), `user_api_key_alias`, `user_api_key_team_id`/`_team_alias`, `user_api_key_org_id`, `user_api_key_project_id`/`_alias`, `user_api_key_user_id`, `user_api_key_user_email`, ids/aliases de cliente (`customer_org/team/member`), `requester_ip_address`, `user_agent`, `spend_logs_metadata` (pares livres que o chamador manda), `usage_object` e `additional_usage_values` (tokens de cache, raciocínio, etc.), `cost_breakdown`, `model_map_information`, `applied_guardrails`, `guardrail_information`, `mcp_tool_call_metadata`, `vector_store_request_metadata`, `routing_decision`/`router_metadata`, `attempted_retries`, `max_retries`, `attempted_fallbacks`, `original_model_group`, `litellm_overhead_time_ms`, `error_information` (código, classe, mensagem, traceback), `cold_storage_object_key`, economias (`compression_savings`, `autorouter_savings`...), `status`.

Quais chaves de `metadata` vão para o banco é configurável: `general_settings.spend_logs_metadata_fields: {include: [...]}` ou `{exclude: [...]}`; `status` e `cold_storage_object_key` sempre ficam (`_types.py:2555-2577,2991-2994`; aplicado em `proxy/utils.py:8892-8898` e `spend_tracking_utils.py:2356-2364`). Os agregados diários, orçamentos e callbacks continuam vendo todas as chaves.

### 3.2 Mensagens, respostas, tool calls e streaming

| Conteúdo | Padrão | Com `store_prompts_in_spend_logs: true` | Evidência |
|---|---|---|---|
| Corpo da requisição (`messages`/`input`/`tools`/`tool_choice`...) | **não gravado** (`proxy_server_request = "{}"`) | gravado em `proxy_server_request`, **por string** truncado a `MAX_STRING_LENGTH_PROMPT_IN_DB` (padrão **2048** caracteres; env `MAX_STRING_LENGTH_PROMPT_IN_DB`, relido a cada uso) mantendo 35% do início e 65% do fim com marcador `litellm_truncated` | `spend_tracking_utils.py:2143-2190`, `127-138`, `1544-1554`, `1574-1620`; `constants.py:642` |
| Resposta (texto, tool calls, `arguments`, `logprobs`) | **não gravada** (`response = "{}"`) | gravada em `response`, mesmo truncamento por string; no streaming é a resposta **montada ao final** (um registro por requisição, não por chunk) | `spend_tracking_utils.py:2228-2283`; `litellm/litellm_core_utils/litellm_logging.py:4287-4316,4495-4505` |
| Coluna `messages` | `"{}"` | só preenchida em chamadas realtime (`_arealtime`); chat/responses usam `proxy_server_request` | `spend_tracking_utils.py:1352-1366` |
| Modo `spend_logs_prompt_storage: latest_turn` | n/a | guarda só o modelo e a última mensagem do usuário (sem system prompt, tools nem turnos anteriores) em requisições sem estado; continuação de `/v1/responses` e a resposta ficam como são | `_types.py:2979-2983`; `spend_tracking_utils.py:1393-1500` |
| Imagens/arquivos/áudio | trocados por `[image omitted]`, `[file omitted]`, `[audio omitted]` só no modo `latest_turn`; fora dele são strings truncadas | idem | `spend_tracking_utils.py:1380-1390` |
| Nomes das tools chamadas | gravados no índice `LiteLLM_SpendLogToolIndex`, independentes do corpo | idem | `spend_log_tool_index.py:49-73` |
| Erros | `error_information` sempre; mensagem e traceback truncados e, sem `store_prompts`, com `'input'`/`'messages'`/`'prompt'`/`input_value=` redigidos (provedores ecoam o corpo no erro) | sem a redação de prompt | `spend_tracking_utils.py:1814-1858,1710-1763` |
| Guardrails | campos que carregam prompt (`guardrail_request`, `guardrail_response`, `match_details`, `classification`) viram `REDACTED_BY_LITELM` | completos | `spend_tracking_utils.py:1765-1811` |
| Vector store | `text` dos resultados redigido | completo | `spend_tracking_utils.py:2193-2225` |

Corpos grandes não têm teto por linha, só o teto por string; resumos de compactação têm teto próprio de 64 KB (`constants.py:643`).

### 3.3 Tabelas diárias (campos)

`LiteLLM_DailyUserSpend` (e irmãs por time/org/end-user/agente/membro-cliente/tag): `date` (texto), dono (`user_id`/`team_id`/...), `api_key` (hash), `model`, `model_group`, `custom_llm_provider`, `mcp_namespaced_tool_name`, `endpoint`, `prompt_tokens`, `completion_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, economias por categoria, `guardrail_spend`, `spend`, `api_requests`, `successful_requests`, `failed_requests`, `total_response_time_ms`, `timed_requests`. Chave única `(dono, date, api_key, model, provedor, tool, endpoint)` (`schema.prisma:961-998`). Montagem em `db_spend_update_writer.py:3365-3481`.

### 3.4 Quem/quê no registro

Chave (hash), alias da chave, usuário, e-mail, time, organização, projeto, cliente final (`end_user`), tags (`request_tags`), IP do requisitante, `User-Agent`, `session_id`, `litellm_call_id`, modelo pedido/servido, `model_id` do deployment, provedor, `api_base`, cache hit/key, retries/fallbacks, latência total, TTFT, overhead do LiteLLM, custo e sua composição, guardrails aplicados.

## 4. Privacidade e segurança

| Controle | O que faz | Padrão | Evidência |
|---|---|---|---|
| Hash da chave | `api_key` e `metadata.user_api_key` guardam SHA-256 **sem sal** (`hashlib.sha256(token)`); qualquer valor que não pareça hash é re-hasheado; master key, JWT hasheado e aliases de serviço são passados como são | sempre | `litellm/proxy/utils.py:8631-8637`; `spend_tracking_utils.py:154-185,365-375` |
| `store_prompts_in_spend_logs` | liga/desliga o corpo | **desligado** | `_types.py:2971-2974`; `spend_tracking_utils.py:2298-2319` |
| Opt-out por chave/time | `metadata.store_prompts_in_spend_logs: false` na chave ou no time **desliga** o corpo mesmo com o global ligado; não dá para ligar por chave com o global desligado | n/a | `spend_tracking_utils.py:121,2286-2305` |
| `turn_off_message_logging` | global (`litellm_settings`), por requisição (parâmetro dinâmico), ou por cabeçalho `litellm-enable-message-redaction`; troca mensagens por `REDACTED_BY_LITELLM` também no que vai para `SpendLogs`; quando o global está ligado, o cliente não consegue desligar (a opção de recusa é descartada) | falso | `litellm/__init__.py:189`; `litellm_core_utils/redact_messages.py:770-814`; `spend_tracking_utils.py:1500-1516,2247-2263`; `litellm/proxy/litellm_pre_call_utils.py:884-908,3149-3150` |
| Callback que não quer mensagens | atributo `message_logging` do callback redige só para aquele callback | n/a | `redact_messages.py:53-77` |
| `no-log` (parâmetro da requisição) | pula os callbacks externos, **mas o rastreio de custo do proxy roda mesmo assim** (a linha de `SpendLogs` continua sendo gravada) | n/a | `litellm_core_utils/litellm_logging.py:3465-3477` |
| Credenciais no corpo | `secret_fields` (cabeçalhos HTTP com `Authorization`) é removido em qualquer nível; strings sob chaves "sensíveis" (`SensitiveDataMasker` + `apikey`) viram `REDACTED_BY_LITELM`, exceto em `arguments`, `logprobs` e conteúdo de tools | sempre (com corpo ligado) | `spend_tracking_utils.py:1369-1370,1519-1533,1620` |
| `redact_tokens_in_spend_logs` | mascara substrings com formato de token (ex.: token do GitHub num resultado de tool) no corpo, na resposta, nas compactações | **desligado** no código | `_types.py:2975-2978`; `spend_tracking_utils.py:1536-1541` |
| `disable_requester_ip_address_logging` | grava IP nulo na coluna, na metadata e no corpo guardado, remove cabeçalhos de IP (`x-forwarded-for`) e mascara IPs em valores de cabeçalho e mensagens de erro; guardrails e callbacks ainda recebem o IP | desligado | `_types.py:2987-2990`; `spend_tracking_utils.py:2016-2112,2343-2353` |
| `disable_spend_logs` | não grava a linha (contadores e agregados continuam); numa linha de job cobrada uma vez (batch/vídeo) só ficam os campos mínimos | falso | `db_spend_update_writer.py:226-243,905-936` |
| `disable_error_logs` | não grava linhas de falha | falso | `db_spend_update_writer.py:905-909`; `proxy_track_cost_callback.py:1118-1127` |
| `disable_pre_routing_error_logs` | não grava rejeições anteriores ao roteamento (chave inválida, orçamento esgotado, modelo desconhecido), para um cliente em *retry* não inundar a tabela | falso | `proxy_track_cost_callback.py:1131-1136,512-514` |
| Modelo desconhecido | nome do modelo que parece prompt vira `unknown-model` e é raspado da mensagem de erro | sempre | `spend_tracking_utils.py:838-862`; `constants.py:2341` |
| Acesso de leitura | `/spend/logs/v2`, `/spend/logs/ui`, `/spend/logs/ui/{request_id}`: admin vê tudo; não-admin só as chaves/times que possui (`_spend_log_read_scope`, `spend_log_api_key_scope.py`, checagem de dono no `request_id`, 403 em time alheio); janela de datas obrigatória (exceto por `request_id`) | n/a | `litellm/proxy/spend_tracking/spend_management_endpoints.py:2569-2590,2740-2877,3387`; `spend_log_api_key_scope.py:1-60` |
| Criptografia | **não achei** criptografia por coluna na escrita de `SpendLogs`; o texto vai em `Json` do Postgres | n/a | `spend_tracking_utils.py` e `proxy/utils.py:8873-8978` (nenhuma etapa de cifra) |
| Audit log | quem mudou o quê (`changed_by`, hash da chave, valores antes/depois), com despacho opcional a callbacks (S3 etc.); exige licença enterprise | desligado | `audit_logs.py:59-72,123-135,215-300` |

Não verifiquei a cifragem de segredos de modelo/credencial no banco (`LITELLM_SALT_KEY`), que é um assunto à parte.

## 5. Caminho de escrita

```
requisição ──> callback ProxyDBLogger (sucesso/falha, hooks do router)
                  └─ get_logging_payload_async  (monta SpendLogsPayload; fora do laço de eventos
                  │                              se redact_tokens_in_spend_logs, via asyncio.to_thread)
                  └─ DBSpendUpdateWriter.update_database
                        ├─ monta accounting_payload (livro-razão) e entidades afetadas
                        ├─ enqueue_spend_logs  -> fila em memória (teto 64 MB, descarta as mais antigas,
                        │                          preserva a parte contábil de linhas descartadas)
                        ├─ filas diárias/tool/modelo em memória (agregação por chave)
                        └─ (legado, ledger off) filas de contadores -> Redis ou direto
monitor_spend_logs_queue (2 s a 30 s, backoff x1,5; acorda por limiar de 100 linhas ou por pedido de flush)
   └─ update_spend_logs_job -> trava local spend_log_write_lock
         └─ lotes de até 1000 linhas, divididos em INSERTs de ≤100 linhas e ≤2 MB
            ON CONFLICT DO NOTHING; linha + entrega do livro-razão na mesma transação (timeout 60 s)
job update_spend (a cada proxy_batch_write_at=10 s + 0-5 s de jitter)
   └─ flush_accounting_deliveries (lotes de 500, SELECT ... FOR UPDATE SKIP LOCKED, aplica nos contadores)
   └─ recover_parked_spend_logs (Redis -> fila)
```

- **Em memória primeiro, banco depois.** A linha entra numa lista em memória sob `_spend_log_transactions_lock`; limite `SPEND_LOG_QUEUE_MAX_BYTES` (64 000 000); estouro descarta as linhas mais antigas e loga erro, mas "resgata" a parte contábil de cada linha descartada como linha só-de-contabilidade (`litellm/proxy/utils.py:8749-8781`; `constants.py:1973`).
- **Monitor da fila:** consulta a cada `SPEND_LOG_QUEUE_POLL_INTERVAL` (2 s) e aumenta o intervalo até 30 s quando está abaixo do limiar `SPEND_LOG_QUEUE_SIZE_THRESHOLD` (100); `request_spend_log_flush` o acorda quando uma resposta `/v1/responses` precisa ser lida do banco logo em seguida (`utils.py:9440-9514,8784-8805`; `db_spend_update_writer.py:1877-1879`; `constants.py:1972-1975`).
- **Lotes e proteção de memória:** o motor de consultas do Prisma (processo Rust) retém memória pelo maior comando já visto, por isso cada `INSERT` é limitado por **bytes** (`SPEND_LOG_WRITE_BATCH_MAX_BYTES` 2 MB) e por **linhas** (`SPEND_LOG_WRITE_BATCH_MAX_ROWS` 100) (`litellm/proxy/db/spend_log_batching.py:1-30`; `constants.py:1969-1970`; `utils.py:8926-8941`).
- **Linha envenenada:** se o Postgres rejeita uma linha (ex.: byte NUL), o lote é bisseccionado para salvar as boas; teto de 256 falhas por lote para um chamador malicioso não amplificar trabalho (`utils.py:9520,9566-9615`).
- **Retry e falha:** 3 tentativas com `sleep(1 << i)` s em erro transitório; depois a linha volta ao **topo** da fila ou, com `use_redis_transaction_buffer`, é estacionada no Redis; erro de Prisma não transitório também reenfileira; no desligamento o proxy drena (até 20 passes) e estaciona o resto no Redis; se nem isso der, loga que as linhas "serão perdidas na saída" (`utils.py:8952-8978,9082-9114,9388-9437`). Em cancelamento da tarefa, reenfileira (`utils.py:9246-9252`).
- **Contadores (padrão com livro-razão):** `LiteLLM_SpendLogDelivery` recebe o `accounting_payload` na **mesma transação** que a linha de `SpendLogs` (`ON CONFLICT (delivery_id) DO NOTHING`, idempotente); um *worker* reivindica entregas pendentes com `FOR UPDATE SKIP LOCKED` (vários pods convivem), aplica nos contadores e diários numa transação, e em falha usa recuo exponencial (máx. 300 s), 5 tentativas e estado `parked` com alerta (`litellm/repositories/table_repositories.py:170-246`; `litellm/repositories/accounting_delivery_repository.py:92-118,163-216`; `litellm/accounting/worker.py:38-105`).
- **Caminho legado** (`use_spend_logs_ledger: false`): incrementos acumulados em filas em memória por entidade (`SpendUpdateQueue`, `DailySpendUpdateQueue`), com `use_redis_transaction_buffer` empurrados para listas Redis (`RPUSH` em pipeline); **um único pod** com a trava `cronjob_lock:db_spend_update_job` (`SET NX EX 60`, soltura por script Lua compare-and-delete) faz `LPOP` e grava no banco; em falha repõe no Redis; os `UPSERT`s vão ordenados por id para manter a ordem de travas igual entre pods e evitar *deadlock* (`db_spend_update_writer.py:1929-2141`; `pod_lock_manager.py:18-130`; `redis_update_buffer.py:171-250,440-619`; comentário em `utils.py:8845`).
- **Falhas de escrita não derrubam a requisição.** O registro acontece no callback de sucesso/falha do LiteLLM (`ProxyDBLogger.async_log_success_event`, `async_post_call_failure_hook`, `proxy_track_cost_callback.py:443-560`), depois de a resposta existir; `update_database` captura qualquer exceção e só loga (`db_spend_update_writer.py:968-980`). Com o *collector* ligado, o evento vai por socket para o sidecar (política `fallback` ou `drop` se ele cair, `spend_event_producer.py:1-20`).
- **Rollups separados com cadência própria:** tags a 2,3x o intervalo (`constants.py:2049`), contagens do gateway e erros por chave a cada intervalo, descobertas de tools, janelas de orçamento; cada um tem trava e política própria de requeue/descarte (`proxy_server.py:11960-12020`; `utils.py:9143-9185,9270-9340`).
- **Limites de custo de leitura:** consultas de logs com `statement_timeout` de 30 s (`SPEND_LOG_READ_STATEMENT_TIMEOUT_SECONDS`, `constants.py:2111`), dimensionamento da pesquisa de chaves em até 5000 chaves (`spend_log_api_key_scope.py:20`).

## 6. Código x docs

| Tema | Docs dizem | Código mostra | Estado |
|---|---|---|---|
| Retenção | página `db_info`: "sem configurações de retenção"; página `proxy/prod`: só `cleanup_cron` como exemplo; página `spend_logs_deletion`: completa (intervalo, cron, lotes, orçamento, tamanho, partições, `ScheduledJobRun`, trava advisory) | subsistema completo, exatamente como a página `spend_logs_deletion` descreve | docs fragmentadas; a página dedicada confere com o código |
| `redact_tokens_in_spend_logs` | `config_settings` (lido por `WebFetch`, resumo do modelo): padrão `true` | padrão `False` (`_types.py:2975-2978`) e só mascara quando `is True` (`spend_tracking_utils.py:1539`) | **divergente** (docs, na leitura que fiz, afirmam o contrário do código) |
| `MAX_STRING_LENGTH_PROMPT_IN_DB` | um resultado de busca resumiu "padrão 1000" | `get_env_int(..., 2048)` (`constants.py:642`) | **não confirmado na página primária**; o código diz 2048 |
| Erros no banco | `prod`: "exceções de LLM são gravadas no banco por padrão; sob erros contínuos incha a tabela de spend logs" | verdade para `SpendLogs` com `status='failure'`; `LiteLLM_ErrorLogs` não tem escritor | consistente quanto ao efeito; o nome da tabela legada engana |
| Redis na limpeza | `spend_logs_deletion`: "Redis não participa", embora a seção de requisitos o liste como opcional | agendador usa `LiteLLM_ScheduledJobRun` + `pg_try_advisory_xact_lock` (`scheduled_job_runs.py:273,413`); Redis só em outros jobs (spend update, entrega do livro-razão) | docs internamente inconsistentes; código confirma "sem Redis" para o cleanup |
| Caminho do SQL de partição | docs: `db_scripts/partition_spend_logs.sql` | código e `_types.py:3093-3096`: `litellm/scripts/db/partition_spend_logs.sql` | caminho da doc desatualizado |
| Escrita via Redis | `prod`: "acima de ~1000 req/s, roteie as escritas pelo Redis" | com o livro-razão padrão, contadores não passam pelas filas Redis; Redis segue para estacionar linhas e para contagens do gateway/erros | **não verifiquei** se alguma página explica o livro-razão (a flag `use_spend_logs_ledger` só aparece em `_types.py:2593`) |
| `disable_spend_logs` | `config_settings`: "desliga a gravação de cada transação no banco" | só as linhas; contadores e diários continuam (`db_spend_update_writer.py:918-936`) | doc simplifica |

## 7. Comparação com o Thinker

Lido em `packages/backend/src/` (entidades `request.entity.ts`, `agent-message.entity.ts`, `agent-usage-daily.entity.ts`; gravador `routing/proxy/proxy-message-recorder.ts`; gravações `routing/proxy/attempt-recording*.ts`, `common/services/request-recording-storage.service.ts`, `common/utils/request-recording-codec.ts`; limpeza `database/request-recording-retention.service.ts`; `docs/dev/guia.md` seção "Gravações").

| Aspecto | LiteLLM Proxy | Thinker hoje | Diferença |
|---|---|---|---|
| Modelo de dados | 1 linha por requisição (`SpendLogs`) + agregados diários por ~10 dimensões | 2 níveis: `requests` (o que o chamador viu) e `agent_messages` (uma linha por tentativa ao provedor, com tokens, custo, modelo, provedor, conta, fallback, egress) + `agent_usage_daily` (tenant, harness, dia) | Thinker separa requisição e tentativa e registra a cadeia de fallback; LiteLLM junta no `SpendLogs` com `attempted_fallbacks` na metadata |
| Corpo (prompt/resposta) | **desligado** por padrão; quando ligado, no próprio Postgres, por string truncada a 2048 caracteres | **ligado** por padrão em harness novo (`agents.record_messages`); corpo da tentativa ao provedor e resposta (JSON ou SSE bruto) gravados em objeto separado (S3 ou filesystem), `gzip` + cifra com a chave de segredos; a linha guarda só `recording_key` | Thinker guarda mais por padrão, fora do banco e cifrado; sem truncamento por string, sem teto de tamanho que eu tenha encontrado |
| Retenção | nenhuma por padrão; quando ligada, **apaga** linhas (ou derruba partições) e mantém agregados; também por tamanho | 30 dias por padrão (`THINKER_RECORDING_RETENTION_DAYS`), em 3 níveis (harness > organização > ambiente), limpeza diária às 02:00 com trava advisory: **apaga o objeto do corpo** e zera `request_headers`, `request_params`, `timeline`; **as linhas de `requests`/`agent_messages` nunca são apagadas** | Thinker limita o dado sensível, não o crescimento da tabela; sem retenção de linhas, sem regra por tamanho, sem particionamento |
| Agregados que sobrevivem | tabelas diárias por usuário/time/org/end-user/tag/modelo/chave | `agent_usage_daily` (por harness e dia); as quebras por modelo/provedor leem `agent_messages` | Se um dia se apagarem linhas, falta rollup por modelo/provedor/dia |
| Escrita | em lote: fila em memória, monitor, `INSERT` multi-linha, livro-razão idempotente, estacionamento em Redis, fila limitada em bytes | direta por requisição, sem fila (o `await` de cada escrita no caminho da requisição não foi auditado): `INSERT ... ON CONFLICT` da linha pendente no ingresso, `UPDATE` ao terminar, linha por tentativa; corpo gravado em segundo plano com `catch` que só loga; rollup de `agent_usage_daily` em job de 1 min | Thinker faz várias escritas por requisição (linha pendente de `requests`, linha pendente da tentativa, atualização terminal de ambas); mais simples e sem janela de perda por fila, mas mais caro sob carga |
| Perda em falha | possível: fila em memória descarta as mais antigas acima de 64 MB; "serão perdidas na saída" se nem Redis estiver disponível | uma falha de escrita é logada; o pedido já foi servido; sem fila para perder | Thinker não tem janela de perda por fila |
| Chave de API | SHA-256 sem sal no log (`api_key`) | `agent_api_keys.key_hash` + `key_prefix`; o log guarda `agent_id`, não o hash | equivalente em intenção |
| Redação | token no texto (opcional), campos tipo credencial, `secret_fields`, erro sem prompt, IP opcional | cabeçalhos sensíveis (`authorization`, `cookie`, `x-api-key`...) viram `[REDACTED]` e query `?key=` idem (`request-headers.ts`); imagens base64 viram marcador (`inline-image-redaction`); `secret-scrub.ts` em erros de provedor; corpo da gravação sem redação de tokens no texto | Thinker não mascara tokens dentro do conteúdo; não tem opção de não gravar IP (`caller_attribution.clientIp`/`peerIp` ficam, e **não** são zerados pela limpeza) |
| Controle por chave/time | opt-out de corpo na metadata da chave/time; `no-log`; callbacks por time | liga/desliga e retenção **por harness** (`record_messages`, `log_retention_days`) e por organização | controle por harness do Thinker é equivalente ou melhor para o caso de uso; não há `no-log` por requisição |
| Acesso de leitura | admin vê tudo, demais só as próprias chaves/times | por tenant (`tenant_id` nas entidades) e por papel; o detalhe da requisição decodifica a gravação (`analytics/services/message-details.service.ts`); não revisei os papéis exigidos em `messages.controller.ts` | similar, não comparado em detalhe |
| Auditoria de configuração | `LiteLLM_AuditLog` (enterprise), sem retenção | alertas/auditoria em `system_events` (inclui `actor_ip`, `actor_user_agent`), retenção `THINKER_ALERTS_RETENTION_DAYS` (90) | Thinker tem retenção e não exige licença |
| Saída para observabilidade | dezenas de callbacks (S3, Datadog, Langfuse, OTEL...) | gatilhos (webhook, Telegram, Syslog, GELF, RELP, e-mail) e OTLP (`packages/backend/src/otlp/`) | escopos diferentes; ADR 0003 limita saída a provedores configurados |
| Redis | opcional (fila, travas, cache) | não usa | n/a |

### O que o Thinker não tem e valeria considerar

(Informativo; quem decide é o Principal/mantenedor. Detalhes de valor/esforço dos itens ficam em [`recursos.md`](recursos.md) quando forem promovidos.)

1. **Retenção de linhas brutas por idade ou por tamanho**, mantendo os agregados. Hoje `requests` e `agent_messages` crescem sem fim. Pré-requisito: rollup diário por modelo/provedor/conta (`agent_usage_daily` só tem harness e dia). Onde: `database/request-recording-retention.service.ts` (mesmo padrão de lotes + trava) e `analytics/services/agent-usage-daily.service.ts`. Esforço M a G. Padrão do LiteLLM aproveitável: `DELETE ... LIMIT` em lotes com `statement_timeout`/`lock_timeout`, orçamento de relógio e retomada no próximo ciclo (`spend_log_cleanup.py:820-945`).
2. **Opção de não gravar o IP do cliente** (`disable_requester_ip_address_logging`) e de mascarar IPs em erros: o Thinker guarda `clientIp`/`peerIp` em `caller_attribution` e não os limpa na retenção. Onde: `routing/proxy/caller-classifier.ts` e `request-recording-retention.service.ts`. Esforço P.
3. **Mascaramento de tokens no texto da gravação** (opt-in, estilo `redact_tokens_in_spend_logs`): evita que um segredo colado num prompt fique nos 30 dias de gravação. Onde: `routing/proxy/attempt-recording-capture.ts` (já copia e redige imagens). Esforço P a M.
4. **Modo "só o último turno"** (`spend_logs_prompt_storage: latest_turn`): reduz muito o volume gravado de harnesses que reenviam o histórico inteiro a cada chamada (Claude Code, Codex). Onde: `attempt-recording-capture.ts`. Esforço M; trade-off: perde o contexto no detalhe da requisição.
5. **Teto de tamanho por gravação ou truncamento por string** (o LiteLLM trunca em 2048 por string e limita instruções a 2 MB). O Thinker acumula `raw_sse` inteiro em memória e grava sem teto que eu tenha achado (`attempt-recording-capture.ts`, `rawSse += text`). Esforço P.
6. **`disable_pre_routing_error_logs`**: evitar que um cliente em *retry* inunde a tabela com linhas de custo zero. O Thinker já tem um amortecedor parecido só para 429 de provedor (`proxy-message-recorder.ts:866`, `shouldSkipRateLimitRecord`, cooldown de 60 s por harness) e não grava os erros `M001`-`M006` que a guarda de chave levanta antes de haver tenant (`docs/dev/guia.md`, seção Erros do Thinker); não avaliei as demais rejeições (limite, orçamento). Valor provavelmente baixo.
7. **Escrita em lote com fila limitada** só se a carga justificar; hoje é um custo aceito de simplicidade (modo pessoal). Não recomendo agora.

Conflitos com ADR: nenhum dos itens acima exige tráfego de saída novo (ADR 0003 preservado). Cuidado com as páginas de telemetria do LiteLLM (`litellm/proxy/telemetry/`): se alguma vez se considerar copiar, é o oposto do ADR 0003.

## 8. Não verificado

- Páginas de docs: li `spend_logs_deletion`, `db_info`, `prod`, `db_sizing` e `config_settings` (as duas últimas pelo resumo de `WebFetch`; `config_settings` tem 282 mil caracteres e só li os primeiros 100 mil). `proxy/spend_logs` deu 404. A afirmação de `MAX_STRING_LENGTH_PROMPT_IN_DB = 1000` vem só de um trecho de busca.
- Não rodei o LiteLLM; tudo é leitura estática. Não executei nenhuma migração nem o script de particionamento.
- Padrão efetivo de telemetria (`litellm/proxy/telemetry/`) e o conteúdo exato do que sai quando habilitada.
- Cifragem de segredos/credenciais no banco (`LITELLM_SALT_KEY`) e o formato do payload enviado a cada callback externo (S3 v2 usa um módulo Rust, `NativeS3Log`; só li os parâmetros em `s3_v2.py`).
- Como a UI Admin decide o que mostrar do corpo (configurações da UI de logs, `ui_spend_log_settings`).
- No Thinker, não apurei todos os 47 pontos de leitura de `agent_messages` em `analytics/services/`; a afirmação de que as quebras por modelo/provedor dependem das linhas brutas é por inspeção parcial. Tampouco confirmei se existe teto para o tamanho de uma gravação no caminho de streaming.
