# OmniRoute: como armazena as requisições

Pergunta: onde, por quanto tempo e o que o OmniRoute grava de cada requisição que passa por ele, e como isso se compara ao Thinker. Fonte: código do OmniRoute em `~/.cache/thinker/omniroute` (SHA e tag no [README](README.md)). Caminhos sem prefixo são da árvore do OmniRoute; os que começam com `packages/` ou `docs/` são do Thinker. Cada afirmação diz se foi **verificada no código** (V) ou **só consta no README/docs** (D).

## Resumo

- Banco único: **SQLite** (`storage.sqlite`, modo WAL). Não há Postgres, nem driver para outro engine. (V)
- Além do SQLite há **arquivos JSON em disco**, um por requisição, com os corpos de request/response: `<DATA_DIR>/call_logs/AAAA-MM-DD/<timestamp>_<id>.json`. (V)
- **Por padrão, prompts e respostas são gravados** (truncados e com segredos mascarados), a menos que a chave de API tenha `noLog`. Não é opt-in. O que é opt-in é o "pipeline" detalhado (os 4 estágios do request, cabeçalhos mascarados, chunks de stream). (V)
- Retenção padrão de logs de chamada: **7 dias** (env `CALL_LOG_RETENTION_DAYS`), com limites extras de 100 mil linhas e 10 mil arquivos. `usage_history` fica **30 dias** e é agregado em `daily_usage_summary`, que nunca expira sozinho. (V)
- Os arquivos de payload ficam em **texto puro** (permissão 0600), **sem criptografia**; só as credenciais de provedor têm criptografia de campo (AES-256-GCM), e apenas se `STORAGE_ENCRYPTION_KEY` estiver definida. (V)
- Escrita: a linha SQLite é síncrona (better-sqlite3) mas fora do caminho de resposta; o arquivo é escrito em um `worker_thread` com fila limitada. Falha de log nunca derruba a requisição. (V)

## 1. ONDE

### Motor e arquivo

| Item | Valor | Evidência |
|---|---|---|
| Engine | SQLite via better-sqlite3; fallback `node:sqlite`, `bun:sqlite` ou `sql.js` (WASM) | `src/lib/db/adapters/driverFactory.ts`; `src/lib/db/core.ts:181-205` (V) |
| Outro banco | Nenhum. `package.json` não tem `pg`, Prisma, Drizzle, libSQL; `DATABASE_URL` não é lida | `package.json`; grep em `src/` (V) |
| Arquivo | `<DATA_DIR>/storage.sqlite` (+ `-wal`, `-shm`) | `src/lib/db/core.ts:121-123` (V) |
| Pragmas | `busy_timeout=2000`, `auto_vacuum=INCREMENTAL` (só em arquivo vazio), `journal_mode=WAL`, `synchronous=NORMAL` | `src/lib/db/core.ts:1303-1312` (V) |
| Modo "cloud"/Worker | `isCloud` desliga toda a persistência em disco (`shouldPersistToDisk = !isCloud && !isBuildPhase`) | `src/lib/db/core.ts:104`; `src/lib/usage/migrations.ts:27` (V) |
| Migrações | `src/lib/db/migrations/*.sql` (mais de 240 numeradas, as recentes com prefixo de timestamp), tabela `_omniroute_migrations` | `src/lib/db/core.ts:1316-1330` (V) |

### Diretório de dados

Resolução em `src/lib/dataPaths.ts:35-71`:

1. `DATA_DIR` (se definido e gravável; se não for gravável cai no padrão com aviso, `:130-191`).
2. `~/.omniroute` se já existir (legado preservado, `:35-48`).
3. Windows: `%APPDATA%/omniroute`; Linux/macOS com `XDG_CONFIG_HOME`: `$XDG_CONFIG_HOME/omniroute`; senão `~/.omniroute`.

Docker/servidor: a imagem fixa `ENV DATA_DIR=/app/data` (`Dockerfile:274`) e os composes montam um volume nesse caminho (`docker-compose.yml:41`, `docker-compose.prod.yml:71`). Desktop/npm global: o padrão `~/.omniroute`. Em contexto de teste sem `DATA_DIR`, redireciona para um diretório temporário para não tocar o banco real (`dataPaths.ts:130-172`).

Layout relevante dentro de `DATA_DIR`:

| Caminho | Conteúdo | Evidência |
|---|---|---|
| `storage.sqlite` | tabelas de metadados, uso, custo, config, credenciais | `core.ts:123` |
| `call_logs/AAAA-MM-DD/<ts>_<id>.json` | artefato por requisição com corpos | `src/lib/usage/callLogArtifacts.ts:27-30,145-152` |
| `logs/application/app.log` (+ rotação) | log de aplicação (stdout estruturado), `APP_LOG_TO_FILE` padrão ligado | `src/lib/logEnv.ts:23-25,68-78`; `.env.example:2461-2477` |
| `media/` | vídeos/mídia gerada, teto 2 GiB | `.env.example:2497-2502` |
| backups | `.sqlite` e sidecars | `src/lib/db/backup.ts` |

### Tabelas relacionadas a requisições

| Tabela | Papel | Origem |
|---|---|---|
| `call_logs` | **"Request Logs" do dashboard**: uma linha de metadados por tentativa, aponta o artefato JSON | `001_initial_schema.sql:113`; recriada em `025_call_logs_summary_storage.sql` (só resumo, corpos saíram do SQLite); colunas extras nas migrações 109, 116, 133, 154, 158, 188-195, 210, 214, 223, 230, 239 |
| `usage_history` | **Uso/analytics**: tokens, status, latência, custo, conta; uma linha por chamada concluída | `001:88`; colunas extras nas migrações 054, 062, 105, 127, 212, 235, 237 |
| `request_cost_ledger` | razão de custo por chamada (preço unitário x tokens = USD) | `182_request_cost_ledger_and_key_quota.sql` |
| `proxy_logs` | **log do proxy de saída (egress)**, não o log de requisições: host/porta do proxy, IP, latência | `001:156`; `src/lib/proxyLogger.ts:315-323` |
| `request_detail_logs` | legado (ring buffer de 500, opt-in); ainda é podada se existir | `006_detailed_request_logs.sql`; `014_unified_log_artifacts.sql` migra a flag |
| `agentic_conversations`, `conversation_turn_nodes` | identidade de conversas multi-turno por hash (sem texto) | `155_...sql`, `156_...sql` |
| `compression_analytics` e afins | estatística de compressão de contexto | `038_compression_analytics.sql`; `041`, `045` |
| `daily_usage_summary`, `hourly_usage_summary`, `daily_team_usage_summary` | agregados que sobrevivem às linhas brutas | `047_aggregation_tables.sql`; `215_team_cost_centers.sql:50` |
| `audit_log`, `mcp_tool_audit` | auditoria administrativa e de MCP (não é log de requisição) | `src/lib/compliance/index.ts`; `docs/security/COMPLIANCE.md` |
| `semantic_cache` | **resposta completa** em cache, com `expires_at` (TTL padrão 30 min) | `001:214`; `DEFAULT_DATABASE_SETTINGS.cache.semanticCacheTTL = 1800000` |
| `memories` | memória persistente extraída das conversas (desligada por padrão, `enabled: false`) | `015_create_memories.sql`; `src/lib/memory/settings.ts:33` |

### Sinks externos

- **Exportação de logs** (opt-in): BigQuery e OTLP/HTTP, processo filho isolado lendo o SQLite em modo somente leitura, cursor por `rowid`, cron horário (`OMNIROUTE_LOG_EXPORT_CRON`). `include_bodies` padrão **0**; `max_body_bytes` 262144. Tabela `log_export_destinations` (`170_log_export_destinations.sql`); código em `src/lib/logExport/`; doc `docs/frameworks/LOG-EXPORT.md` (V para schema e padrões; o fluxo do filho está descrito no doc e confere com `src/lib/logExport/childRunner.ts`, sem leitura linha a linha).
- Cache semântico opcional em Redis (`semanticCacheBackend: "redis"`) e vetores em Qdrant (config em `src/app/api/settings/qdrant`). Nada disso é o log de requisições. (V para as chaves de config.)
- Nenhum objeto S3/GCS para logs de chamada. O único "object storage" é o destino BigQuery da exportação.

## 2. POR QUANTO TEMPO

### Variáveis e configurações

| Controle | Padrão | Efeito | Evidência |
|---|---|---|---|
| `CALL_LOG_RETENTION_DAYS` | **7** | idade máxima de `call_logs`, artefatos, `proxy_logs`, `request_detail_logs` | `src/lib/logEnv.ts:6,84-86` |
| Dashboard "Data Retention" (`retention.callLogs`) | segue o env/7 até o operador salvar | vale se o env não estiver definido | `src/lib/usage/callLogRetention.ts:12-20`; `src/lib/db/databaseSettings.ts:401-430` |
| `retention.usageHistory` | **30** dias | idade de `usage_history` (agregada antes de apagar) | `src/types/databaseSettings.ts:153-172`; `src/lib/db/cleanup.ts:125-170` |
| Demais `retention.*` | 7 a 30 dias | `quotaSnapshots` 7; `compressionAnalytics`, `mcpAudit`, `configAudit`, `a2aEvents`, `conversationTurnNodes`, `memoryEntries`, `domainCostHistory`, `xpAuditLog`... 30 | `databaseSettings.ts:153-172` |
| `retention.autoCleanupEnabled` | `true` | liga o agendador de limpeza | `cleanup.ts:726-733` |
| `CALL_LOGS_TABLE_MAX_ROWS` | 100000 | teto de linhas de `call_logs` | `logEnv.ts:116-118`; `callLogRotation.ts:340-352` |
| `CALL_LOG_MAX_ENTRIES` | 10000 | teto de **arquivos de artefato** (o `.env.example` diz "in-memory buffer", o que não confere com o código) | `logEnv.ts:112-114`; `callLogRotation.ts:235-266` |
| `PROXY_LOGS_TABLE_MAX_ROWS` | 100000 | teto de `proxy_logs` | `logEnv.ts:160-162` |
| `APP_LOG_RETENTION_DAYS` / `_MAX_FILES` / `_MAX_FILE_SIZE` | 7 dias / 20 arquivos / 50 MB | rotação de `app.log`; também idade de `audit_log` e `mcp_tool_audit` | `logEnv.ts:76-82,108-110` |
| `MEDIA_STORE_MAX_MB` | 2048 | teto da pasta `media/` | `.env.example:2497-2502` |
| `CALL_LOG_MIN_FREE_DISK_MB` | 512 | abaixo disso, **pula a escrita do artefato** (a linha SQLite fica com `detail_state=missing`) | `logEnv.ts:152-158`; `callLogArtifacts.ts:342-363` |

### Jobs de purga

1. **Rotação oportunista**: a cada escrita de call log, `scheduleCallLogRotation()` agenda `rotateCallLogs()`, com throttle de 60 s e lotes de 100. Apaga linhas mais velhas que a retenção, apara o teto de linhas, apara o teto de arquivos e remove arquivos órfãos com mais de 5 min. Também marca como `missing` os detalhes `pending` expirados (prazo de 5 min). (`src/lib/usage/callLogRotation.ts:23-26,340-395`; `callLogs.ts:824,922-937`) (V)
2. **Limpeza de boot** `cleanupExpiredLogs()`: roda na inicialização; apaga `usage_history` (depois de agregar), `call_logs`, `proxy_logs`, `request_detail_logs`, `audit_log`, `mcp_tool_audit` e aplica os tetos de linhas em lotes de 5000. (`src/lib/compliance/index.ts:710-880`; chamada em `src/instrumentation-node.ts:855-859`) (V)
3. **Agendador de retenção** `startCleanupScheduler()`: 30 s após o boot e depois a cada 6 h, roda `runAutoCleanup()` sobre ~20 tabelas (call logs, usage, compressão, auditorias, memórias, proxy logs, conversas, batches, arquivos expirados). Lotes de 10 mil com `setImmediate` entre eles. (`cleanup.ts:722-768,1113,1162-1195`; iniciado em `instrumentation-node.ts:890`) (V)
4. **Manual**: `POST /api/settings/purge-request-history`, `purge-call-logs`, `purge-detailed-logs`, `purge-usage-history`, `purge-logs`. Apagam linhas e a pasta `call_logs/`. (`src/app/api/settings/purge-*`; `cleanup.ts:790-840`) (V)

### O que sobrevive às linhas brutas

- `usage_history` é agregada em `daily_usage_summary` (e `daily_team_usage_summary`) **antes** de apagar, em dia inteiro; se a agregação falha, as linhas ficam (`cleanup.ts:136-166`; `compliance/index.ts:771-805`). Nenhuma rotina automática apaga os agregados diários (só o reset manual, `cleanup.ts:900-935`). (V)
- `request_cost_ledger`: **não encontrei** nenhum `DELETE` com retenção. Pelo grep, cresce sem purga automática. (V, ausência)
- `agentic_conversations`/`conversation_turn_nodes`: 30 dias (`cleanup.ts:643-700`). (V)

### Inconsistência a registrar

Há dois caminhos com padrões diferentes para o mesmo dado. Na limpeza de boot, `usage_history` e `call_logs` usam `env > configuração do dashboard (mesclada com o padrão 30) > env/7` (`compliance/index.ts:746-765`); a rotação periódica usa só `env > valor realmente salvo no dashboard > env/7` (`callLogRetention.ts`). O próprio código comenta a divergência (#16302, `compliance/index.ts:738-745`). Além disso `.env.example:2487` e `docs/security/COMPLIANCE.md:120` dizem 7 dias para `usage_history`, enquanto o padrão do dashboard é 30. Na prática: call logs 7 dias, uso 30 dias, a menos que o operador mexa.

### Se nada for configurado

7 dias de call logs (com corpos), 30 dias de `usage_history`, agregados diários para sempre, `request_cost_ledger` sem purga, `app.log` 7 dias, `audit_log` 7 dias.

## 3. O QUE É GRAVADO

### 3.1 `call_logs` (linha SQLite, sempre, mesmo com `noLog`)

Campos (V): `src/lib/usage/callLogs.ts:731-806` (montagem), `:860-905` (INSERT).

- Identidade: `id`, `timestamp`, `method`, `path`, `correlation_id`, `session_tag` (header `X-OmniRoute-Session-Id`), `client_session_id` (máx. 128 chars), `response_id` (Responses API).
- Roteamento: `model`, `requested_model`, `provider`, `account` (nome resolvido), `connection_id`, `combo_name`, `combo_step_id`, `combo_execution_key`, `model_pinned`, `source_format`, `target_format`, `request_type`, `cache_source` (`upstream`/`semantic`).
- Resultado: `status`, `error_type` (classificado), `error_summary` (até 4000 chars, saneado), `has_content`.
- Tempo: `duration`, `ttft_ms`, `added_wait_ms`, `added_wait_cause`, `queue_wait_ms`.
- Tokens: `tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_creation` (+ `_5m`, `_1h`, status do tier), `tokens_reasoning`, `tokens_compressed`, mais `usage_evidence` e `usage_provenance` (real x estimado).
- Raciocínio: `reasoning_source`, `reasoning_chars`, `reasoning_duration_ms`, `reasoning_effort_requested/upstream`, `reasoning_encrypted` (só indicadores, não o texto).
- Custo de escrita de cache: `cache_write_cost_usd`, `cache_write_priced_tokens`.
- Chave de API: `api_key_id`, `api_key_name`.
- Ações de resiliência (fallback/retry): `resilience_actions` (migração 191); tentativas HTTP upstream viram **linhas extras** com `request_type = UPSTREAM_HTTP_ATTEMPT`, só metadados (`saveUpstreamHttpAttempt`, `callLogs.ts:965-983`; `open-sse/handlers/chatCore/attemptLogging.ts:~330`).
- Ponteiro do detalhe: `detail_state` (`none|pending|ready|missing|corrupt|legacy-inline`), `artifact_relpath`, `artifact_size_bytes`, `artifact_sha256` (na prática um FNV-1a de 32 bits, não SHA-256, `callLogArtifacts.ts:154-161`), `has_request_body`, `has_response_body`, `has_pipeline_details`, `request_summary` (para `search`: query e filtros).
- **Não há** coluna de IP do cliente em `call_logs`. O IP de entrada aparece em `proxy_logs.public_ip` (campo `clientIp`, `proxyLogger.ts:315-322`) e, só com a flag `API_KEY_AUDIT_CLIENT_DETAILS_ENABLED`, em `audit_log` para leituras GET/HEAD (`docs/security/COMPLIANCE.md:52-58`; D). (V para `proxy_logs`)

### 3.2 Artefato JSON (`call_logs/.../*.json`)

Estrutura `CallLogArtifact` (`callLogArtifacts.ts:97-132`, montada em `callLogs.ts:231-302`): `schemaVersion: 5`, `summary` (cópia dos campos acima), `requestBody`, `responseBody`, `error`, e `pipeline` opcional.

**Corpos de request/response: gravados por padrão.** O fluxo (V):

1. `persistAttemptLogs` (`open-sse/handlers/chatCore/attemptLogging.ts:481-`) passa `requestBody` e `responseBody` ao `saveCallLog` em toda tentativa, `null` apenas se `noLogEnabled`.
2. `buildCallLogRow` calcula `detailExpected = !metadataOnly && !noLog && (algum corpo/erro/pipeline não nulo)` (`callLogs.ts:809-814`). Não há checagem da flag do pipeline nesse ponto.
3. Só então o artefato é escrito (`publishCallLogDetail`, `:922-937`).

Ou seja, **prompt (mensagens, system, tools) e resposta ficam em disco por padrão**. O `docs/ops/DATABASE_GUIDE.md:74` ("call_logs/ — request payload artifacts (if enabled)") sugere opt-in, mas o código não o impõe. (D diverge de V)

Truncamento antes de gravar (V): `truncateForLog` troca um corpo maior que `CHAT_LOG_MAX_BODY_KB` (1 MB) por um resumo `{_truncated, _originalBytes, model, provider, messageCount, tools}` (`handlers/chatCore/logTruncation.ts:98-125`); `cloneBoundedChatLogPayload` limita texto (`CHAT_LOG_TEXT_LIMIT` 64 KB, cabeça+cauda), profundidade 20, 80 chaves por objeto, cauda de 1000 itens por array e colapsa `data:image/...;base64` grandes em referência com sha256 curto (`logTruncation.ts:30-95`; `logEnv.ts:174-231`). O arquivo todo tem teto de 512 KB (`MAX_CALL_LOG_ARTIFACT_BYTES`; 512 KB também para o pipeline por `CALL_LOG_PIPELINE_MAX_SIZE_KB`) com uma escada de degradação que descarta primeiro o request, depois os dois corpos, depois o pipeline, sempre preservando o erro (`callLogArtifacts.ts:200-326`). Com `CHAT_DEBUG_FILE=true` (ou `APP_LOG_LEVEL=debug`) grava o payload completo sem teto e indentado (`:289-297`).

**Pipeline detalhado: opt-in** (`call_log_pipeline_enabled`, padrão `false`; `ENABLE_REQUEST_LOGS` sobrepõe; `logEnv.ts:133-141`; `open-sse/handlers/chatCore.ts:991`). Ligado, o artefato ganha (`open-sse/utils/requestLogger.ts:20-34`): `clientRawRequest` (endpoint, **cabeçalhos mascarados**, corpo), `openaiRequest` (após tradução), `providerRequest` (URL com segredos mascarados, cabeçalhos mascarados, corpo), `providerResponse` (status, cabeçalhos mascarados, corpo), `clientResponse`, `error`, `toolLoop`, e `streamChunks` (provider/openai/client) **apenas** com `CALL_LOG_PIPELINE_CAPTURE_STREAM_CHUNKS=true` (padrão `false`). Desligado, só `routeDecision` é mantido (`attemptLogging.ts:597-604`).

Tool calls e raciocínio: ficam dentro dos corpos (mensagens com `tool_calls`, saída). O raciocínio cifrado (`encrypted_content`) é substituído por marcador (`logPayloads.ts:61-87,406-424`). Transcrições de vídeo viram marcador (`attemptLogging.ts:44,121-232`).

### 3.3 `usage_history` (SQLite, sempre)

`src/lib/usage/usageWriteRetry.ts:175-245`: provider, model, `connection_id`, `account_key`/`account_label`, `api_key_id`/`api_key_name`, `billing_team_id`, tokens (in, out, cache read/creation, reasoning), `service_tier`, `status`, `success`, `latency_ms`, `ttft_ms`, `error_code`, `combo_strategy`, `endpoint`, `cpa_auth_index`, `agent_session_id`, `timestamp`, custo reportado pelo provedor (`provider_credits`, `provider_cost_usd`), `calculated_cost_usd`, `billing_unit/quantity/unit_price_usd`, `usage_evidence`, `usage_provenance`. Sem corpos. Há deduplicação: se já existe linha idêntica no mesmo segundo, não insere (`insertUnlessDuplicate`, `:157-173`).

### 3.4 Outras tabelas

- `request_cost_ledger`: `api_key_id`, provider, model, tokens, preços unitários, `amount_usd`, `service_tier`, `success`, `timestamp`, `request_id`. Só para chamadas com chave de API.
- `proxy_logs`: proxy usado, IP de entrada (`public_ip`), IP de saída (v4/v6), `target_url`, latência, erro, `upstream_status`, tentativa (`attempt_number`, `attempt_issue`), tempos (`headers_ms`, `first_chunk_ms`).
- Estatística de compressão: `compression_analytics` (tokens originais x comprimidos, modo, `request_id`) e `tokens_compressed` em `call_logs`.
- Fallback: `combo_*` e `resilience_actions` em `call_logs`; tentativas HTTP upstream como linhas extras; `proxy_logs.attempt_*`.
- `semantic_cache.response`: **resposta completa** (por assinatura do prompt, com hash do prompt, não o prompt) enquanto durar o TTL.

### 3.5 Separação dos nomes

| Termo | O que é no OmniRoute |
|---|---|
| Call logs / Request logs | `call_logs` + artefatos JSON (a mesma coisa; é a tela "Logs") |
| Proxy logs | log do **proxy de saída** (egress), não de requisições |
| Usage history | `usage_history`, métrica por chamada, sem corpo |
| Analytics | consultas sobre `usage_history` + `daily_usage_summary` (`src/app/api/usage/analytics`) |
| Detailed logs | `request_detail_logs` legado, substituído pelo pipeline do artefato |
| App log | `logs/application/app.log`, log de processo |

## 4. PRIVACIDADE E SEGURANÇA

- **Mascaramento por chave**: `protectPayloadForLog` percorre o corpo e troca por `[REDACTED]` valores de chaves como `api_key`, `authorization`, `x-api-key`, `access_token`, `refresh_token`, `password`, `secret`, `token`, `cookie`, `storageState`, tokens de captcha, e qualquer string que comece com `Bearer ` (`src/lib/logPayloads.ts:8-59,487-505,538-546`). É por **nome de chave**, não detecta segredo dentro de texto livre. (V)
- **Cabeçalhos** (só no pipeline): `maskSensitiveHeaders` mascara `authorization`, `x-api-key`, `cookie`, `token`, `secret`, `password` etc. e URLs com segredos (`open-sse/utils/requestLogger.ts:92-120,531`). (V)
- **Erros**: `sanitizeErrorMessage`/`sanitizeUpstreamDetails` e projeção de sub-árvores de erro (`logPayloads.ts:89-221`; `callLogs.ts:563-571`). (V)
- **PII**: sanitização de PII (e-mail, cartão, etc. com validação por checksum) é **opt-in** e **desligada por padrão**: `PII_RESPONSE_SANITIZATION=false`, modos `redact|warn|block` (`src/lib/piiSanitizer.ts:8-36`; `logPayloads.ts:528-536`; `.env.example:758`). Com o padrão, prompts e respostas gravados contêm PII como vieram. (V)
- **`noLog` por chave de API**: coluna `api_keys.no_log`, ou env `NO_LOG_API_KEY_IDS`; zera request/response/pipeline/resumo, mantendo só metadados e contadores (`callLogs.ts:586-598,809-814`; `src/lib/compliance/noLog.ts:22-50`; `attemptLogging.ts:481-560`). (V)
- **Imagens inline** viram referência; **transcrições de vídeo** viram marcador (`attemptLogging.ts`, `logPayloads.ts:426-480`). (V)
- **Criptografia em repouso**: `src/lib/db/encryption.ts` (AES-256-GCM, formato `enc:v1:iv:cipher:tag`) cifra chaves/tokens de provedor em `provider_connections` e segredos de cache/exportação. **Sem `STORAGE_ENCRYPTION_KEY` vira passthrough em texto puro** (`encryption.ts:3-8`; `.env.example:96`). Corpos de requisição, artefatos JSON e `call_logs` **não são cifrados**. (V)
- **Permissões de arquivo**: artefatos `0600` e subpasta `call_logs/` `0700` (`callLogArtifacts.ts:33-52,383-385`). Escrita atômica (arquivo temporário + `rename`). (V)
- **Chaves de API do gateway**: armazenadas com `key_hash` e secreto cifrado; linhas legadas em texto são migradas no uso (`src/lib/db/apiKeys.ts:470-516`). (V)
- **Controle de acesso**: rotas de logs/exportação/detalhe exigem `requireManagementAuth` ou `isAuthenticated` (`src/app/api/logs/export/route.ts`, `usage/call-logs/[id]/route.ts`, `settings/purge-request-history/route.ts`). (V)
- **Exportar**: `GET /api/logs/export` (JSON em stream, 24 h por padrão, até 50 mil linhas), exportação contínua para BigQuery/OTLP (corpos opt-in, já passam pelo mascaramento do `getCallLogById`) e backup/import de banco. **Apagar**: purga manual por tela/API (acima) e por retenção. Não há exclusão por usuário/titular de dados. (V)
- O README alega "telemetria desativada por padrão" e "trilha de auditoria SQLite local" (`README.md:870`, imagem `privacy-local.svg`); não verifiquei ausência de chamadas externas, fora do escopo da pergunta. (D)

## 5. CAMINHO DE ESCRITA

1. `persistAttemptLogs` chama `saveCallLog` **sem aguardar**; os erros são engolidos (`attemptLogging.ts:~680`; `callLogs.ts:941-963`). (V)
2. `buildCallLogRow` (preparação, mascaramento, resolução de conta) e `insertCallLogRow` (INSERT síncrono do better-sqlite3 na thread principal) com `detail_state='pending'` e prazo de 5 min (`callLogs.ts:573-905`). A linha é inserida **antes** do arquivo para fixar o id; colisão de id regenera o id (até um limite). (V)
3. O artefato é serializado e escrito por um **`worker_thread`** com fila de no máximo 128 jobs; estourou a fila, o detalhe é descartado com aviso limitado a 1 por 30 s; falha do worker resolve `null` e o detalhe vira `missing` (`callLogArtifactWriter.ts:10-17,89-120,207-236`). Worker ocioso é encerrado após 30 s. (V)
4. Disco quase cheio: com menos de 512 MB livres, pula o artefato (`hasRoomForCallLogArtifact`). Falha na sonda de disco abre o fluxo (nunca descarta log). (V)
5. Trava de escrita no SQLite: `isWriteLockError` agenda **uma** nova tentativa fora do caminho da requisição, sem encadear (`usageWriteRetry.ts:258-300`; `callLogs.ts:518-535`). `busy_timeout` de 2 s para não congelar o event loop (`core.ts:1293-1303`). (V)
6. Em encerramento, `closeCallLogSaves` espera até 2 s as gravações pendentes e depois força o fechamento do worker (`callLogs.ts:985-1017`). (V)
7. Rotação pós-escrita, throttle de 60 s, lote de 100 (acima). `usage_history`: deduplicação por (timestamp, provider, model, conexão, chave, tokens) (`usageWriteRetry.ts:157-173`). (V)
8. Dashboard ao vivo: `pendingRequests` em memória (`MAX_PENDING_DETAILS` 5000, teto de 256 MiB; `.env.example:2514-2520`) e anel de 200 entradas para `proxy_logs` (`proxyLogger.ts:23`). (D e V parcial)

Não verifiquei linha a linha o ponto de chamada do caminho de **streaming** (`responseBody` montado pelo coletor de stream em `open-sse/utils/streamPayloadCollector.ts`); o comentário em `attemptLogging.ts:240-258` indica que o corpo de resposta de stream é o resumo agregado em `.summary`, e os chunks brutos só entram com o pipeline e `CAPTURE_STREAM_CHUNKS`.

## 6. COMPARAÇÃO COM O THINKER (estado em `6bf042a`)

### Como o Thinker grava hoje

- Banco: **PostgreSQL** (TypeORM, migrações em `packages/backend/src/database/migrations/`), não SQLite.
- **Linha por requisição e por tentativa**: `requests` (`packages/backend/src/entities/request.entity.ts`) e `agent_messages` (uma por tentativa ao provedor, `entities/agent-message.entity.ts`), com tenant, harness (`agent_id`), `trace_id`, `session_key/session_id`, modelo pedido e servido, provedor, `routing_tier/reason`, tokens (in, out, cache read/creation), `cost_usd`, `duration_ms`, status, erro (`error_code/origin/class/http_status`), `fallback_from_model/fallback_index`, `egress`/`egress_hops`, `caller_attribution`, `virtual_model_*`, `feedback_*`, `user_id`.
- **Corpos** (prompt e resposta exatos da tentativa, **incluindo o stream SSE bruto**): objeto externo **gzip + AES** (a mesma chave dos segredos), um por tentativa, apontado por `agent_messages.recording_key`. Backend S3 ou sistema de arquivos (`THINKER_RECORDING_STORAGE=auto|s3|filesystem|disabled`; padrão `/data/request-recordings` em produção) (`common/services/request-recording-storage.service.ts`; `common/utils/request-recording-codec.ts`; `routing/proxy/attempt-recording.service.ts`). Imagens base64 viram marcador (`routing/proxy/attempt-recording-capture.ts`, `inline-image-redaction.ts`).
- **Gravação por harness**: `agents.record_messages`, **ligada em harnesses novos** (padrão `true`), relida do banco a cada requisição para valer em todas as réplicas (`entities/agent.entity.ts:41-44`; `common/services/agent-recording-config.service.ts`).
- **Cabeçalhos** da requisição em `requests.request_headers` e `agent_messages.request_headers` (jsonb), com `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key` e parâmetros de query sensíveis trocados por `[REDACTED]`, teto de 200 cabeçalhos, 8 KB por valor e 64 KB no total (`routing/proxy/request-headers.ts:3-25,56-95`). Mais `request_params` (parâmetros do request) e `timeline` (eventos com tempo, `routing/proxy/request-timeline.ts`).
- **Retenção em três níveis**: harness (`agents.log_retention_days`) > organização (`tenants.log_retention_days`) > `THINKER_RECORDING_RETENTION_DAYS`, padrão **30**; valor inválido derruba o boot (`config/recording-retention.ts`; migração `1804300000000-AddLogRetentionDays.ts`). Limpeza **diária às 02:00** com trava advisory do Postgres (`database/request-recording-retention.service.ts`).
- **A limpeza não apaga a linha**: apaga o objeto do corpo e zera `request_headers`, `request_params`, `timeline`; status, tokens e custo ficam para sempre, então totais e gráficos não mudam. Entregas de gatilho finalizadas e `proxy_logs` expirados são apagados; `proxy_usage_daily` e `agent_usage_daily` ficam.
- **Segredos**: `scrubSecrets` em mensagens de erro persistidas (`common/utils/secret-scrub.ts`, Bearer, `sk-*`, `thk_*`, etc.).

### Diferenças

| Aspecto | OmniRoute | Thinker |
|---|---|---|
| Engine | SQLite local (WAL) | PostgreSQL |
| Corpos por padrão | **Sim** (todo mundo, exceto `noLog` por chave de API) | **Sim** (por harness; ligado nos novos, dá para desligar) |
| Granularidade do opt-out | por **chave de API** (`noLog`) | por **harness** (`record_messages`) |
| Onde ficam os corpos | JSON puro em `DATA_DIR/call_logs/`, 0600 | objeto **gzip + AES** em S3 ou disco |
| Criptografia dos corpos | **Não** | **Sim**, mesma chave dos segredos |
| Stream bruto | só com pipeline + flag extra | gravado como `raw_sse` na gravação da tentativa |
| Limite de tamanho | 1 MB por corpo, 512 KB por artefato, degradação gradual | sem teto de corpo no código lido (só marcadores de imagem) |
| Retenção padrão | **7 dias** (call logs), 30 (uso) | **30 dias** (corpos/cabeçalhos), linhas de métrica para sempre |
| Retenção configurável | env + dashboard global | **3 níveis** (harness, organização, env) |
| Teto por quantidade | 100 mil linhas, 10 mil arquivos, proxy 100 mil | nenhum |
| Teto por disco livre | pula artefato com < 512 MB livres | não há |
| Purga de linha | **apaga** a linha e o arquivo | **só zera** corpos/cabeçalhos; mantém a linha |
| Agregação que sobrevive | `daily_usage_summary` (rollup antes de apagar) | linhas ficam; `agent_usage_daily` |
| Mascaramento de segredos em corpos | por nome de chave + `Bearer ` | não encontrei mascaramento por chave no corpo gravado (só imagens base64 viram marcador); segredos são tratados em cabeçalhos e mensagens de erro |
| Mascaramento de PII | opt-in (`PII_RESPONSE_SANITIZATION`), desligado | não há |
| Exportação para sink externo | BigQuery e OTLP (opt-in, cron) | não há; OTLP de entrada responde 410 |
| Cache de respostas | `semantic_cache` (memória/Redis) | não há |
| Rastreio multi-turno | `agentic_conversations`/`conversation_turn_nodes` (hash) | `session_key`/`session_id` |
| Estatística de compressão | `tokens_compressed`, `compression_analytics` | não se aplica (sem compressão) |
| Custo por requisição | `request_cost_ledger` + `usage_history.calculated_cost_usd` | `cost_usd` na tentativa |

### O que o Thinker não tem (candidatos)

Não são decisão; o ranking completo ficará em `recursos.md`.

1. **Limites por tamanho de corpo e escada de degradação** (OmniRoute: `callLogArtifacts.ts:200-326`). O Thinker grava o corpo inteiro do provedor; uma requisição enorme gera objeto grande. Esforço P a M. Cabe em `common/utils/request-recording-codec.ts` ou na captura (`attempt-recording-capture.ts`).
2. **Piso de disco livre** para pular a gravação quando o volume enche (OmniRoute `hasRoomForCallLogArtifact`). Só importa com backend `filesystem`. Esforço P.
3. **Opt-out por chave** (`noLog`), além do opt-out por harness. Hoje a granularidade do Thinker é o harness (e a chave `thk_` é de harness), então o equivalente já existe; falta apenas a opção por instância/organização. Esforço P.
4. **Mascaramento de PII opcional** nos corpos gravados. Esforço M, risco de falso positivo; seria opt-in. Conflita com nada em ADR, mas é fora do escopo atual.
5. **Exportação para sink externo (OTLP/BigQuery)**: **conflita com o espírito do ADR 0003** (sem tráfego de saída além de provedores e catálogos), a menos que seja explicitamente configurada pelo mantenedor como destino do próprio usuário. Marcar como conflito de decisão, não descartar.
6. **Teto de linhas por tabela**: o Thinker mantém as linhas de métrica para sempre; sem teto, `requests`/`agent_messages` crescem sem limite. Se o volume virar problema, o OmniRoute resolve com purga por idade + teto; o Thinker preferiu preservar totais (decisão documentada no guia). Esforço M; só vale com particionamento ou arquivamento, não com `DELETE`.

### Onde o Thinker já faz melhor

- Corpos **cifrados e comprimidos** em armazenamento de objetos, em vez de JSON puro.
- Retenção em **três níveis** e limpeza que **preserva métricas**.
- Cabeçalhos completos (com mascaramento) e linha do tempo por requisição.
- Gravação do stream SSE bruto por padrão, útil para depuração fiel.

## 7. O que não consegui verificar

- Se a UI do OmniRoute **liga** o pipeline por padrão em instalações novas: o código diz `false` (`databaseSettings.ts:117-122`), mas não abri o frontend.
- O fluxo de stream em `chatCore` (qual `responseBody` chega ao `saveCallLog` quando `stream=true`), só inferi pelos comentários.
- Se `request_cost_ledger` é apagada em algum caminho por `api_key_id` ao excluir a chave (só busquei `DELETE FROM request_cost_ledger`).
- Comportamento do `app.log` (o que o logger escreve por requisição): apenas lidas as variáveis e padrões, não o conteúdo.
- Quaisquer chamadas externas/telemetria do OmniRoute (fora do escopo; o README afirma que está desligada por padrão).
