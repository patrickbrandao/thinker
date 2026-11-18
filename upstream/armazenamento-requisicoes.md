# Como o Manifest armazena as requisições que passam pelo gateway

Pesquisa pontual (não é a revisão semanal). Nada foi aberto como issue e nenhum corte do `STATE.md` foi alterado.

- **Upstream revisado:** `mnfst/llm-gateway` em `8f6330ee8decf0940e511c17a2378f8bd27c00fa` (`Version Packages (#3123)`, 2026-11-17; `packages/manifest/package.json` = 6.29.2).
- **Snapshot do Thinker:** `manifest@6.28.6` (`45627a2d`). O HEAD está 68 commits à frente (`gh api compare`, 181 arquivos).
- **Fonte:** checkout raso em `~/.cache/thinker/manifest-llm-gateway` (clonado agora, tratado como dado). O checkout raso não tem histórico, então as mudanças desde o baseline vieram do `gh api compare` (somente leitura).
- Caminhos abaixo são relativos a `packages/backend/src/` do upstream, salvo indicação. "Código" = o que o código faz. "Doc" = o que a documentação afirma.

## Resumo

1. O Manifest guarda **só metadados** por padrão no PostgreSQL (`requests` + `agent_messages`). **Prompts e respostas completos não vão para o banco.** Vão para um objeto gzip + AES-256-GCM em S3 ou disco, **por tentativa ao provedor**, e só quando a gravação do harness está ligada (`agents.record_messages`).
2. A gravação é opt-in por harness e **ligada por padrão só em harnesses criados depois** da migração `1801500000000`. Harnesses existentes mantêm o valor que tinham.
3. **Não há retenção das linhas** de `requests`/`agent_messages` (decisão explícita, `docs/db-footprint-evaluation.md:27`). Só os objetos de gravação têm retenção, e apenas no self-hosted, se o operador definir `REQUEST_RECORDING_RETENTION_DAYS`. Sem a variável, ficam para sempre.
4. **Mudou desde o baseline:** no 6.28.6 o self-hosted apagava gravações com mais de 365 dias por padrão e o Cloud tinha 7 dias (Free) / 365 dias (Pro). No HEAD (#3116, `e10162da`) o padrão é nunca apagar, e o Cloud ignora a variável.

---

## 1. ONDE

### PostgreSQL (único motor)

Não há SQLite nem outro motor. O TypeORM usa `type: 'postgres'` (`database/database.module.ts:~44`). `synchronize: false`, só migrações (236 arquivos em `database/migrations/`).

| Tabela | Entidade | O que é |
|---|---|---|
| `requests` | `entities/request.entity.ts:13-28` | Uma linha por chamada do cliente ao gateway (desfecho terminal, latência ponta a ponta). Pode não ter nenhuma tentativa (rejeição antes de escolher provedor). |
| `agent_messages` | `entities/agent-message.entity.ts:5-250` | Uma linha por **tentativa ao provedor** (`request_id` + `attempt_number`). Fisicamente é a tabela "grande e quente". Tem 10 índices. |
| `agent_usage_daily` | `entities/agent-usage-daily.entity.ts:4-38` | Agregado diário por tenant/harness (contagens, tokens, custo). Sobrevive às linhas brutas. |
| `tenant_request_usage` | `entities/tenant-request-usage.entity.ts:4-19` | Contador por janela, para o limite de plano (billing, Cloud). |
| `reasoning_content_cache` | `entities/reasoning-content-cache-entry.entity.ts:8-28` | Texto de raciocínio guardado para reenvio no turno seguinte. **Conteúdo real**, mas TTL de 30 min (`routing/proxy/reasoning-content-cache.ts:13`). |

A migração `1801000000000-AddRequestsAndProviderAttempts` criou `requests` e ligou `agent_messages.request_id` por FK `ON DELETE CASCADE` (linha 78-79). As migrações `1795000000000-RemoveMessageRecording` (removeu o antigo `message_recordings`, `llm_calls` etc.), `1801300000000-AddRequestRecordings` e `1801400000000-MoveRecordingsToProviderAttempts` mostram que a gravação foi refeita: de tabelas no banco para objeto externo apontado por `agent_messages.recording_key` (`agent-message.entity.ts:43-45`).

### Objetos de gravação (corpo completo)

- Chave: `request-recordings/v1/tenants/<tenant>/requests/<request>/attempts/<attempt>.json.gz` (`common/services/request-recording-storage.service.ts:238-244`). O nome é `.json.gz`, mas o conteúdo é cifrado (ver 4).
- Backends (`:13`, `:46-107`): `filesystem` (padrão `/data/request-recordings` em produção, `.data/request-recordings` fora dela, `:53-57`) ou `s3` (qualquer endpoint compatível, `:146-197`). `REQUEST_RECORDING_STORAGE=auto|s3|filesystem|disabled`.
- `auto` (`:99-106`): se há bucket/região/credencial/endpoint, S3; senão, self-hosted ou não-produção usa disco; **Cloud sem credencial S3 fica sem backend** (`backend: null`, "Managed Cloud requires S3 recording storage credentials"). Não cai em disco efêmero.
- Cloud x self-hosted: `isSelfHosted()` (`common/utils/detect-self-hosted.ts:16-26`) = `MANIFEST_MODE` explícito, ou deteção de container (`/.dockerenv`, `/run/.containerenv`, `KUBERNETES_SERVICE_HOST`); caso contrário, Cloud. As receitas de deploy (`deploy/*/TUTORIAL.md`) provisionam bucket (AWS, Fly/Tigris, DO Spaces, Heroku) ou volume (Easypanel, Coolify, GCP com bucket montado).
- Config: `config/app.config.ts:59-74`.

### Sinks externos

- **OTLP:** não há. O módulo `otlp/` hoje só guarda guard de chave de agente e um controller deprecated (`otlp/otlp-deprecated.controller.ts`); o nome é histórico. Não há exportação OTLP de requisições.
- **Phoenix / Autofix** (`routing/autofix/observation-reporter.ts`): envia o **corpo completo da requisição** (com `scrubSecrets` e sem imagens base64) a um serviço externo para 4xx do lado do cliente. É opt-in em duas camadas: `AUTOFIX_REPORT_ALL_4XX=true` (`:63-66, :80`) e Autofix ligado no harness (`autofix.service.ts:144`: padrão desligado no self-hosted, ligado no Cloud). Corpo serializado limitado a 256 KB, acima disso é descartado (`observation-payload.ts:~25`). Fila de 500, lotes de 50, a cada 2 s. Endpoint e chave são do Cloud; o Thinker removeu isso.
- **Peacock** (CMS/analytics do Manifest) lê produção do Cloud com role `peacock_reader` (`docs/db-footprint-evaluation.md`). O código dele não está neste repo (não verificado).
- **Telemetria anônima** (self-hosted, 1x/24h, `telemetry/telemetry.service.ts:41-60`): só agregados (contagens, tokens, custo) de `agent_messages`/`requests` (`payload-builder.service.ts`). Desligada com `MANIFEST_TELEMETRY_DISABLED=1` ou `NODE_ENV != production`. Sem conteúdo.
- **Sentry:** só com `SENTRY_DSN` (`sentry/sentry-options.ts:10-11`). Não verifiquei o que ele captura.

---

## 2. QUANTO TEMPO

| Dado | Retenção no código |
|---|---|
| Linhas de `requests` e `agent_messages` | **Nenhuma.** Não existe `@Cron` que apague essas tabelas. Os `@Cron` do backend são: retenção de gravações, rollup de uso (`agent-usage-daily.service.ts:292`), sync de preços/modelos, telemetria, notificações, TTL de fluxo OAuth. A decisão está registrada em `docs/db-footprint-evaluation.md:27,54` ("Retention (C) is rejected ... full retention is a hard constraint"). |
| Objeto de gravação (corpo) | Só self-hosted e só se `REQUEST_RECORDING_RETENTION_DAYS` (inteiro positivo, `app.config.ts:59-63`) estiver definido. Cron diário às 02:00 (`database/request-recording-retention.service.ts:64-68`), trava advisory `4011986` (`:8-14`, `:75-77`). Sem a variável: para sempre. |
| Cloud | **Nunca apaga**, e ignora a variável com aviso no boot (`:55-62`). `CLAUDE.md:581` do upstream diz "Do not add one back". |
| Limpeza das gravações | `SELECT` por `recording_key IS NOT NULL AND timestamp < now() - N dias` (`:18-24`), apaga o objeto e depois faz `UPDATE agent_messages SET recording_key = NULL` (`:26-31`, `:106-114`). **A linha continua** (tokens, custo, status, headers, params). Sem lote: carrega todos os expirados de uma vez. |
| `reasoning_content_cache` | TTL de 30 min, no máximo 10 000 entradas em memória (`reasoning-content-cache.ts:13,22`), `expires_at` indexado, remoção preguiçosa. |
| Agregados `agent_usage_daily` | Mantidos. Rollup a cada minuto (`@Cron(EVERY_MINUTE)`, `:292`; `AGENT_USAGE_DAILY_WORKER`, `_BATCH_SIZE`, `_RUN_BUDGET_MS`), marcando `agent_usage_rolled_up_at` na linha bruta (`agent-message.entity.ts:86-87`). Não há downsampling que substitua as linhas brutas: elas ficam junto. |
| Exclusão de harness | **Soft delete** (`agents.deleted_at`, chave desativada), sem apagar mensagens nem gravações (`analytics/services/agent-lifecycle.service.ts:39-69`). Só o `ON DELETE SET NULL` de `tenant_provider_id` e o cascade request->attempts existem. |

Ordem de grandeza medida pelo próprio Manifest em produção Cloud (2026-10-09): banco de 45-49 GB, `agent_messages` com 33 GB (13 GB heap + 21 GB índices), `requests` com 15 GB, crescimento de cerca de 6 GB/mês (`docs/db-footprint-evaluation.md:27`, e seção 2). É a consequência prática de "retenção total".

---

## 3. O QUE É GRAVADO

### Sempre (metadados), por requisição (`requests`, `request.entity.ts`)

`id`, `tenant_id`, `agent_id`, `user_id` (deprecated, só atribuição), `agent_name`, `trace_id`, `session_key`, `session_id`, `timestamp`, `duration_ms` (ponta a ponta), `status`, `autofix_status`, `error_message/http_status/code/origin/class`, `requested_model` (modelo pedido, antes do roteamento), `api_mode` (`chat_completions|responses|messages`), `caller_attribution` (sdk, versões, runtime, os, arch, `userAgent`, `appName`, `appUrl`, categorias; `caller-classifier.ts:1-12`), `request_headers` (JSON), `request_params` (JSON), `feedback_rating/tags/details`.

### Sempre (metadados), por tentativa (`agent_messages`, `agent-message.entity.ts`)

- Identidade/ordem: `id`, `request_id`, `attempt_number`, `tenant_id`, `agent_id`, `agent_name`, `trace_id`, `session_key/id`, `timestamp`.
- Roteamento: `model`, `provider`, `routing_tier`, `routing_reason`, `specificity_category`, `specificity_miscategorized`, `header_tier_id/name/color`, `auth_type`, `provider_key_label`, `tenant_provider_id` (a conexão exata que serviu), `skill_name`, `service_type`.
- Fallback: `fallback_from_model`, `fallback_index`, `superseded` (tentativa que falhou e foi recuperada por outra).
- Uso: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`, `duration_ms`. Não há coluna separada para tokens de raciocínio.
- Erro: `status`, `error_message` (passa por `scrubSecrets` e é cortada em 2000 caracteres, `proxy-message-recorder.ts:780,853,929,1039,1141`), `error_http_status`, `error_code`, `error_origin`, `error_class`.
- Autofix: `autofix_applied`, `autofix_group_id`, `autofix_role`, `autofix_operations`, `autofix_phoenix` (decisão do Phoenix).
- `request_headers`, `request_params`, `caller_attribution` (cópias por tentativa).
- `recording_key` (ponteiro para o objeto externo).
- `user_id` (deprecated), `description` (existe na entidade e na API de detalhes, mas **nenhum escritor do proxy a preenche**; legado).

### O que são `request_params`

Não são os parâmetros enviados pelo cliente nem as mensagens. É o snapshot dos **parâmetros de modelo configurados por harness** (defaults aplicados, `RequestParamDefaults` em `packages/shared/src/request-params.ts:14`), usado no Autofix. O comentário do `observation-reporter.ts` confirma: o `agent_messages` "stores the model-parameter snapshot and not the messages".

### Cabeçalhos (`routing/proxy/request-headers.ts`)

- Limites: 50 cabeçalhos, 1024 bytes por valor, 8192 bytes no total (`:3-5`), caracteres de controle removidos.
- **Removidos por inteiro** (não só mascarados): `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key` (`:9-15`).
- **Ruído/PII removido** (`:27-45`): `x-forwarded-for/host/proto/port`, `x-real-ip`, `forwarded`, `via`, `x-cloud-trace-context`, `traceparent`, `host`, `connection`, `accept-encoding`, `content-length`, cabeçalhos do Railway/Envoy. O comentário (`:22-26`) diz que gravar IP do cliente é PII que o produto não quer e pede **não** readicionar sem decisão de retenção/consentimento.
- **IP do cliente: não é gravado** em nenhuma coluna.

### Corpo completo (prompt, resposta, tool calls, raciocínio, chunks do stream)

Só dentro do objeto de gravação, por tentativa (`routing/proxy/attempt-recording.types.ts:1-12`):

```
{ version: 1, wire_format, request_body, response_body: { type:'json', body } | { type:'stream', raw_sse } | null }
```

- `request_body` = o corpo **já traduzido para o formato do provedor** (o que foi enviado), com imagens base64 inline trocadas por um marcador `[inline image: mime, N bytes, M base64 chars]` (`attempt-recording-capture.ts:55-60`; `inline-image-redaction.ts`). O corpo enviado ao provedor não é alterado, só a cópia guardada.
- `response_body` = JSON bruto ou o **SSE bruto inteiro** (`rawSse += text`, `attempt-recording-capture.ts:43-45`; alimentado por `onUpstreamChunk` em `proxy-response-handler.ts:636`). Ou seja, mensagens, tool calls, raciocínio e todos os chunks ficam no texto bruto. Não há coluna estruturada para nada disso.
- Também gravado para respostas de erro do provedor (`proxy.controller.ts:431`).
- **Não há limite de tamanho** no acúmulo do SSE em memória nem no objeto (o limite de entrada é só `PROXY_BODY_LIMIT` do Express, `main.ts:227`). Não verifiquei o valor.
- Quem decide: `agents.record_messages` lido a cada requisição no banco (`common/services/agent-recording-config.service.ts:13-22`) e disponibilidade do backend (`attempt-recording.service.ts:17-19`). Toggle: `GET|PATCH /api/v1/routing/:agent/recording` (`routing/tier.controller.ts:240-260`) e MCP (`mcp/tools/routing.tools.ts:307,605`).
- **Opt-in/opt-out:** a coluna foi criada com default `false` (`1801300000000`), depois o default passou para `true` (`1801500000000`) e a entidade também diz `default: true` (`agent-message.entity`/`agent.entity.ts:42`). O comentário da entidade: "Existing agents keep their persisted choice". Portanto: **ligada em harness novo, desligada em harness antigo** que não a ligou. Doc: `CLAUDE.md:578` ("Default ON for newly created harnesses only").
- O que se grava é o corpo **no formato do provedor** (`startRecording({ requestBody: wireRequestBody, wireFormat })`, `routing/proxy/provider-client.ts:474-477`; no caminho Kiro, o corpo chat, `:411-414`) e a resposta bruta do provedor, não o corpo original do cliente quando há tradução.

---

## 4. PRIVACIDADE E SEGURANÇA

- **Segredos em erros:** `common/utils/secret-scrub.ts:17-46` (cabeçalhos auth/x-api-key/api-key, `refresh_token|client_secret|access_token|device_code`, `Bearer`, `?key=`, prefixos `sk-ant-`, `sk-proj-`, `sk-`, `gsk_`, `xai-`, `mnfst_`, `AIza`). O próprio arquivo diz que é redução de dano, não fronteira de segurança. Aplicado só às mensagens de erro (e ao payload do Phoenix). **Não é aplicado ao corpo gravado** (só às imagens base64): prompts com segredos digitados pelo usuário ficam como vieram, cifrados.
- **PII:** não há mascaramento de PII em prompts. IP do cliente fica de fora (acima).
- **Cifragem em repouso:** só para as gravações, provedores e tokens OAuth, **não para o resto do banco** (`CLAUDE.md:580`, doc; confirmado pelo código). Gravações: `gzip` e depois AES-256-GCM (`common/utils/request-recording-codec.ts:24-27`; `encryptBuffer`, `crypto.util.ts:211`; chave via scrypt a partir de `MANIFEST_ENCRYPTION_KEY`, com fallback a `BETTER_AUTH_SECRET`, `crypto.util.ts:61-90`). Blobs antigos só com gzip ainda são lidos (`:29-37`). Detalhe importante: a re-cifragem de `MANIFEST_ENCRYPTION_KEY_PREVIOUS` **não toca nas gravações**, e uma troca de chave deixa as antigas ilegíveis (`CLAUDE.md:470,580`, doc; no código o decode usa só `getEncryptionSecret()`, `codec:30-32`).
- **Controle de acesso:** tudo filtra por `tenant_id` (a chave de escopo; `user_id` é só atribuição). `GET /api/v1/messages/:id/details` usa `TenantCtx` e busca por `{id, tenant_id}` (`analytics/services/message-details.service.ts:115-136`), e as tentativas também por tenant (`:122-127`). O objeto só é lido com a chave `recording_key` guardada na linha do próprio tenant (`:279-301`). Não há papéis por harness para ver corpo: quem vê o tenant vê as gravações.
- **Exportar/apagar:** não há API de exportação nem de exclusão de requisições ou gravações. Os `DELETE` em `messages.controller.ts:96-111` só limpam feedback/flag. A exclusão de harness é soft delete (acima). Dependência de leitura: só o detalhe individual e a listagem paginada (limite 200, `messages.controller.ts:39-50`). Para apagar gravações no self-hosted só resta `REQUEST_RECORDING_RETENTION_DAYS` ou apagar os objetos à mão.

---

## 5. CAMINHO DE ESCRITA

Tudo em `routing/proxy/proxy.controller.ts` e `proxy-message-recorder.ts`.

1. **Entrada (síncrona, antes de rotear):** gera `requestId`, classifica o chamador, sanitiza cabeçalhos (`:253-255`), insere `requests` como `pending` com `await` (`:271-282`), `INSERT ... ON CONFLICT DO NOTHING` (`persistRequest`, `proxy-message-recorder.ts:582-627`). Erro é capturado (`.catch(... warn)`), **não derruba a requisição**. O próprio Manifest mediu esse INSERT como o mais lento do caminho quente: média de 38 ms, máx 12 s sob I/O de disco (`docs/db-footprint-evaluation.md`, seção 1a e tabela HOT).
2. **Tentativa:** `startProviderAttempt` insere uma linha `pending` em `agent_messages` (`recordPendingProviderAttempt`, `:687-716`; `pendingWrite` é uma Promise guardada na tentativa, falha vira `false` e só dá `warn`, `controller:337-342`).
3. **Fim da requisição:** `recordSuccess`/`recordProviderError`/... fazem **upsert do `requests` terminal** (`orUpdate`, `:608-613`) e `UPDATE` da tentativa (`persistAttempt`, `:629-647`; se a linha pending não existe, faz `INSERT`). Cada tentativa é reescrita ao menos 2 vezes (pending -> terminal -> `agent_usage_rolled_up_at`, e `recording_key` nas gravadas) e cada update toca todos os índices, o que o Manifest mediu como amplificação de escrita (13,1 M updates para 0,95 M inserts na janela de estatísticas, 0,5% HOT; `docs/db-footprint-evaluation.md`).
4. **Gravação do corpo:** capturada durante o stream (`appendRaw`), e só salva **depois** de relayar a resposta: `await forward.attempt?.finishRecording?.()` (`controller:538`). `AttemptRecordingService.save` (`attempt-recording.service.ts:21-44`) gzip+cifra, faz `PUT` no storage e então grava `recording_key`; se o `UPDATE` não afetar linha, apaga o objeto subido. Falha só gera `warn` (`controller:333-335`). Espera a escrita pendente da tentativa antes (`:332`).
5. **Falha de log nunca quebra a requisição:** todas as chamadas do recorder têm `.catch`; `recordSuccess` usa `recordSafely` (`proxy-response-handler.ts:~992`). A leitura da flag de gravação também (`controller:284-293`).
6. **Salvaguardas:** a deduplicação de erros 429 por tenant+agente em janela de 60 s (`proxy-message-recorder.ts:649-664`; só algumas linhas de erro por tenant/agente por minuto); eventos de rollup em lote a cada minuto com `statement_timeout` de 5 s e `lock_timeout` de 250 ms (`agent-usage-daily.service.ts`); índices parciais e `CONCURRENTLY` nas migrações; `TuneFactTableAutovacuum`. **Não há fila nem batching** para o INSERT de `requests`/`agent_messages`: é um INSERT por linha, no processo da requisição.
7. **Concorrência/replicas:** a flag de gravação é relida a cada requisição "so a choice changed on one replica applies to all" (`agent-recording-config.service.ts:15-16`).

---

## 6. Comparação curta com o Thinker (`packages/backend`, `docs/dev/guia.md`)

Mesma base (o Thinker herdou o design): `requests` + `agent_messages` + objeto externo por tentativa com `recording_key`, mesmo formato `StoredAttemptRecording` (`routing/proxy/attempt-recording.types.ts`), mesmo codec gzip+AES-GCM, mesmos backends (`THINKER_RECORDING_*`), mesma chave `tenant/request/attempt`. O Thinker evoluiu além do upstream em quase tudo que importa para armazenamento.

| Tema | Manifest (HEAD) | Thinker (código/guia) |
|---|---|---|
| Retenção | Linhas: nunca. Gravações: nunca no Cloud; self-hosted só com variável. Sem limpeza em lote. | **Padrão 30 dias**, três níveis: harness `agents.log_retention_days` > organização `tenants.log_retention_days` > `THINKER_RECORDING_RETENTION_DAYS` (`config/recording-retention.ts`; `database/request-recording-retention.service.ts:19-22`). Limpeza diária às 02:00 em lotes (5000 linhas, 1000 objetos). |
| O que a limpeza apaga | Só o objeto e o `recording_key`. | Objeto + `request_headers`, `request_params` e `timeline` de `requests` e `agent_messages` (`:46-66`); mantém status/tokens/custo; apaga `trigger_events` e `proxy_logs` expirados (`guia.md:330`). |
| Cabeçalhos | Descarta `authorization`/`cookie`/... e ruído, 50 cab./8 KB. | Registra **todos**, com valor mascarado `[REDACTED]` nos sensíveis (`request-headers.ts:14-20`), até 200 cab./8 KB por valor/64 KB total, mais pseudo-cabeçalhos `:method/:path/:version` com query sensível mascarada (`:60-97`). |
| IP do cliente | Deliberadamente **não gravado** (PII). | Gravado e exibido ("Origem: IP oficial, fonte, IP:porta", `guia.md:244`; `common/utils/client-ip.ts`, `x-thinker-client-ip*`). Decisão diferente e consciente; o local exato da persistência não foi verificado. |
| Linha do tempo | Só `duration_ms`. | `requests.timeline` (jsonb) com marcos por tentativa (`guia.md:244`). |
| Gravação parcial | Só no fim. | Metade da requisição gravada assim que montada e a final no fim (`guia.md:244`). |
| Organizações / papéis | Escopo por `tenant_id` sem papéis. | Organizações (ADR 0006) com retenção e acesso por organização. |
| Fora do escopo do Thinker | Phoenix/Autofix (envia corpo de 4xx a um serviço externo), telemetria 24 h, Peacock, Sentry. | Removidos pelo princípio "no phone-home" (CLAUDE.md). |

### O que o Thinker não tem e pode ser útil (observação, sem abrir issue)

- **Mesma lacuna nos dois:** `scrubSecrets` não é aplicado ao corpo gravado, só a mensagens de erro (no Thinker só o Playground o usa, `playground.service.ts:587,661,713`; o upstream o usa no recorder de erros). Se um prompt tem uma chave colada, ela fica cifrada mas íntegra. Não é regressão.
- **Mesma lacuna:** não há API de exportar nem de apagar requisições/gravações sob demanda. No Thinker a retenção por harness e por organização cobre boa parte; exclusão pontual de uma requisição não existe (não verifiquei se o Thinker tem).
- **Amplificação de escrita:** o upstream mediu 25 índices em `agent_messages` e reescritas não-HOT por tentativa (ver 5.3). O Thinker herdou o mesmo padrão pending->terminal e adicionou mais um UPDATE (gravação parcial) e `timeline`. Vale olhar `fillfactor`/`TuneFactTableAutovacuum` e quais índices o Thinker realmente usa (a migração upstream `1802400000000-TuneFactTableAutovacuum` e `1800300000000-DropUnusedAgentMessageIndexes` são o ponto de partida). Não medido no Thinker.
- **Sem limite de tamanho no `raw_sse`:** vale conferir se o Thinker limita o buffer de gravação do stream (não verifiquei).
- **Mudança upstream #3086 (`1c75318d`)** acrescenta `forwarded`, `via`, `x-cloud-trace-context`, `traceparent` à lista de ruído de cabeçalhos: **não se aplica** ao Thinker, que registra tudo de propósito.
- **Mudança #3116 (`e10162da`)** (nunca apagar gravações no Cloud, padrão "para sempre" no self-hosted): **não se aplica**; o Thinker segue com 30 dias por padrão.

---

## O que não consegui verificar

- Em que bucket/região o Manifest Cloud grava de fato e se o banco do Cloud tem cifragem de disco (infra, fora do repo; só há as receitas em `deploy/`).
- O código do Peacock e do Phoenix (serviços externos, fora do repo).
- O que o Sentry captura em runtime (só vi a ativação por `SENTRY_DSN`).
- Valor de `PROXY_BODY_LIMIT`/`API_BODY_LIMIT` (`main.ts:227,229`) e se existe teto de tamanho para o objeto de gravação além disso.
- A UI da página Requests (`SettingsRecordingSection.tsx`) e o site de docs `manifest.build`: não lidos. As afirmações "Doc" vêm de `CLAUDE.md` e `docs/` do repo.
- No Thinker: onde exatamente o IP do cliente e a `timeline` são persistidos e se há exclusão pontual de requisição.
- Mudanças de armazenamento entre 6.28.6 e o HEAD foram identificadas pelo diff de arquivos do `gh api compare` filtrado por nome (gravação, retenção, entidades, migrações, cabeçalhos, cripto). Só dois arquivos relevantes mudaram: `database/request-recording-retention.service.ts` e `routing/proxy/request-headers.ts`. Mudanças em outros arquivos que tocam o armazenamento indiretamente (por exemplo, `proxy-message-recorder.ts`) não apareceram no filtro.
