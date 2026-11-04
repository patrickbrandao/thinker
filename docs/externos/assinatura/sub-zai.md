---
id: sub-zai
categoria: assinatura
entidade: GLM Coding Plan
agente: sub-zai
thinker_ids: [zai]
revisado_em: 2026-11-03
versao_observada: docs.z.ai 2026-11-03 (plano por créditos de 30/07/2026; chaves separadas desde 16/10/2026)
---

# GLM Coding Plan (assinatura)

Especificação mantida pelo agente `sub-zai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Assinatura da Z.ai (Zhipu) para agentes de código. Autenticação por **chave de API** (sem OAuth), criada em API Keys > Personal Coding Plan (ou Team Coding Plan > My Plan).
- Desde 30/07/2026 o plano é por **créditos** (janela de 5 h + semanal). Só `glm-5.3` e `glm-5.3-flash` são chamáveis; ids antigos são redirecionados.
- Três protocolos, três base URLs; o Thinker usa só o OpenAI Chat Completions (`/api/coding/paas/v4`).
- O plano é "estritamente limitado" às ferramentas suportadas; o uso por gateway não é citado nos termos, mas há risco de limitação (erro 1313), congelamento e banimento.
- Desde 16/10/2026 chaves Standard e Coding Plan são separadas: Standard não consome a cota do plano.
- O endpoint de uso (`/api/monitor/usage/quota/limit`) **não é documentado** oficialmente.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| GLM Coding Plan docs (visão geral, créditos) | <https://docs.z.ai/devpack/overview> | 2026-11-03 |
| Quick Start / Tool Integration (endpoints, ferramentas) | <https://docs.z.ai/devpack/quick-start>, <https://docs.z.ai/devpack/tool/others> | 2026-11-03 |
| Usage Policy e FAQ | <https://docs.z.ai/devpack/usage-policy>, <https://docs.z.ai/devpack/faq> | 2026-11-03 |
| Gestão de chaves (16/10/2026) | <https://docs.z.ai/devpack/notice/api-key-management> | 2026-11-03 |
| Aviso de revisão do plano (30/07/2026) | <https://docs.z.ai/devpack/notice/usage-revision> | 2026-11-03 |
| Como trocar de modelo (1M, effort) | <https://docs.z.ai/devpack/latest-model> | 2026-11-03 |
| Códigos de erro | <https://docs.z.ai/api-reference/api-code> | 2026-11-03 |
| Índice da documentação | <https://docs.z.ai/llms.txt> | 2026-11-03 |
| Subscribe page | <https://z.ai/subscribe> | não lida (página dinâmica; preços via docs) |
| Plugin oficial de uso `zai-org/zai-coding-plugins` (só comandos/skills, sem código do endpoint) | <https://github.com/zai-org/zai-coding-plugins> | commit `0446d0b` (2026-02-22) |
| SDK comunitário `zai-rs` (descreve o endpoint de uso) | <https://docs.rs/zai-rs/latest/zai_rs/usage/index.html> | 2026-11-03 (não oficial) |

## Contrato

### Planos

- Individuais: Lite, Pro e Max (créditos abaixo); Lite parte de 18 USD/mês (docs/overview). Preços de Pro e Max não constam na página de docs.
- Planos legados V1/V2 e Team seguem o cálculo antigo até o fim do ciclo (usage-revision, 2026-07-30). Não são mais vendidos a novos usuários (V1/Team) ou só renovam/upgrade (V2).
- Todos os planos incluem GLM-5.3 e GLM-5.3-Flash e os MCPs Vision, Web Search, Web Reader e Zread.

| Plano | Créditos 5 h | Créditos semanais |
|---|---|---|
| Lite | 2.000 | 10.000 |
| Pro | 12.000 | 60.000 |
| Max | 28.000 | 140.000 |

- Fórmula: `(entrada × mult_entrada + entrada em cache × mult_cache + saída × mult_saída) / 10.000`. Multiplicadores: GLM-5.3 = 6,9 / 1,7 / 24; GLM-5.3-Flash = 2,3 / 0,56 / 8. Chamada de MCP de busca/leitura = 1,2 crédito.
- Fora do pico (fora de seg-sex 14:00-18:00 UTC+8) cobra 50 %; fins de semana inteiros contam como fora do pico.
- Janela de 5 h reinicia 5 h após o consumo; a semanal começa na assinatura e reinicia a cada 7 dias. Esgotada a cota, **não** debita saldo da conta (FAQ).

### Autenticação

- Chave de API colada (`Authorization: Bearer <chave>`; a doc não diz o cabeçalho explicitamente, mas é o padrão do ecossistema Z.ai e as ferramentas oficiais usam `ANTHROPIC_AUTH_TOKEN`). Sem OAuth, sem refresh.
- Desde 2026-10-16 há três tipos de chave: Standard (saldo/pacotes), Individual Plan e Team Plan. A cobrança segue o tipo da chave, não o endpoint. Chaves antigas de contas que já tiveram plano viram "Compatible": nos endpoints de código usam a cota do plano enquanto ele existe; no endpoint `/api/paas/v4` usam saldo. Chave Standard no endpoint de código não consome o plano.
- Região: contas CN usam `open.bigmodel.cn` (chaves não intercambiáveis com `z.ai`).

### Endpoints

| Protocolo | Base URL |
|---|---|
| OpenAI Chat Completions | `https://api.z.ai/api/coding/paas/v4` (`/chat/completions`, `/models`) |
| Anthropic Messages | `https://api.z.ai/api/anthropic` (Claude Code, Goose) |
| OpenAI Responses | `https://api.z.ai/api/v1` (Codex) |
| CN (Chat Completions) | `https://open.bigmodel.cn/api/coding/paas/v4` |

- Usar `https://api.z.ai/api/paas/v4` (API padrão) cobra saldo, não a cota do plano.
- Modelos: `glm-5.3` e `glm-5.3-flash`. glm-5.2/glm-5.1 vão para glm-5.3; glm-4.7 vai para glm-5.3-flash. Contexto de 1M habilitado no Claude Code com sufixo `[1m]` e `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000`; o limite exato por protocolo no endpoint OpenAI não está documentado (não confirmado).
- Effort: `reasoning_effort` minimal/light/low vira low; medium/high vira high; xhigh/max/ultra e desconhecidos viram max; `thinking` desligado vira low (não troca de modelo). Padrão `max`.
- O `GET .../coding/paas/v4/models` é usado pelo Thinker; não há contrato documentado (não confirmado).

### Identificação do cliente

- Nenhum cabeçalho, User-Agent ou versão mínima é exigido pelos docs. A restrição é por "ferramenta suportada", aplicada pelo backend (erro 1113 citado no FAQ para ferramenta/URL/modelo não suportado; 1313 para padrão de uso fora da política). O mecanismo de detecção não é documentado (não confirmado).
- Ferramentas suportadas (tool/others, 2026-11-03): ZCode, Claude Code, Claude for IDE, Codex, OpenCode, Pi, Cursor, Cline, TRAE, Qoder, Droid, Kilo Code, Roo Code, Crush, Goose, Eigent; agentes gerais "melhor esforço": AutoClaw, OpenClaw, Hermes Agent, SillyTavern.

### Clientes permitidos e termos

- "Estritamente limitado" às ferramentas oficiais; usar a assinatura em outras ferramentas ou cenários não é permitido (FAQ, tool/others). Gateways/proxies não são mencionados.
- Compartilhamento de conta e multiusuário são proibidos. Concorrência (subagentes) permitida por projeto; projetos simultâneos recomendados: Lite 1, Pro 1-2, Max 2+. Maior concorrência fora do pico.
- Sanções: limitação de taxa, congelamento, outras restrições; mais de 3 violações podem levar a banimento; há aviso na página do plano e apelação (usage-policy).
- Sem reembolso; renovação automática (cancelar 3 dias antes).

### Cotas e uso

- Consulta oficial: só pela página do plano (z.ai/manage-apikey) e pelo plugin do Claude Code `/glm-plan-usage:usage-query` (somente plano pessoal).
- Endpoint não documentado `GET https://api.z.ai/api/monitor/usage/quota/limit` (CN: `https://open.bigmodel.cn/api/monitor/usage/quota/limit`), com irmãos `model-usage` e `tool-usage`. Segundo o SDK comunitário `zai-rs`, devolve a janela de 5 h e a semanal com teto, percentual consumido e próximo reset. Autenticação divergente entre fontes (Bearer vs. chave crua no `Authorization`) (não confirmado). Um monitor comunitário relata que a variante web do CN exige cookie/anti-bot (não confirmado para a chave de API).

### Erros

Formato: `{"error":{"code":"<string>","message":"..."}}`. Em streaming (SSE) a falha no meio da inferência vem em `finish_reason`, não nestes códigos.

| Código | HTTP | Significado |
|---|---|---|
| 1000 / 1001 / 1003 | 401 | Autenticação falhou / sem credencial / token expirado |
| 1113 | 429 | Sem saldo ou recurso; no plano indica ferramenta, URL ou modelo não suportado |
| 1211 | 400 | Modelo desconhecido |
| 1261 | 400 | Prompt longo demais |
| 1302 / 1305 | 429 | Limite de taxa / serviço sobrecarregado (transitório) |
| 1308 | 429 | Limite de N unidades atingido; traz horário de reset |
| 1309 | 429 | Pacote do Coding Plan expirado |
| 1310 | 429 | Limite semanal/mensal esgotado |
| 1311 | 429 | Plano não inclui o modelo |
| 1313 | 429 | Padrão de uso viola a Política de Uso Justo; frequência limitada |
| 1315 | 429 | Chave restrita a pacote enterprise |
| 1316-1321 | 429 | Cota de 5 h ou 7 dias esgotada, sem saldo ou limite de gasto para uso extra; traz reset |

## Como o Thinker implementa hoje

- Token colado (`subscriptionAuthMode: 'token'`), rótulo "GLM Coding Plan", placeholder "Paste your Z.ai API key": `packages/shared/src/subscription/configs.ts:238-262`.
- `knownModels`: glm-5.3, glm-5.3-flash, glm-5.2, glm-5.1, glm-5-turbo, glm-5, glm-4.7, glm-4.6, glm-4.5, glm-4.5-air (`configs.ts:243-254`); `maxContextWindow` 204800, cache de prompt sim, batch não (`configs.ts:256-260`).
- Base URLs: global `https://api.z.ai/api/coding/paas/v4`, cn `https://open.bigmodel.cn/api/coding/paas/v4`: `packages/backend/src/routing/zai-region.ts:1-4`; normalização do override: `zai-region.ts:27-31`.
- Encaminhamento: perfil `zai-subscription` com `baseUrl` do global, `openaiHeaders` (Bearer), caminho `/chat/completions`, formato `openai`: `packages/backend/src/routing/proxy/provider-endpoints.ts:192,480-486`; `zai` (API key padrão) usa `https://api.z.ai/api/paas/v4/chat/completions`: `provider-endpoints.ts:473-479`.
- Mapeamento `zai` -> `zai-subscription`: `packages/backend/src/routing/proxy/provider-hooks.ts:25`. Região cn troca o endpoint: `forward-endpoint-resolver.ts:176-177`. Prefixos `z-ai/` e `zai/` do id são removidos: `forward-endpoint-resolver.ts:113-120`.
- Descoberta de modelos: `zai-subscription` -> `GET {base}/models` com Bearer (global), `packages/backend/src/model-discovery/provider-model-fetcher.service.ts:995-999`, troca para `zai-subscription` em `:1107`, override cn em `:1161-1165` e `model-discovery.service.ts:213-219`. (A chave `zai` de API usa `https://open.bigmodel.cn/api/paas/v4/models`: `provider-model-fetcher.service.ts:990-994`.)
- Inferência de provedor: modelos `glm-*` viram `zai`: `packages/shared/src/provider-inference.ts:20`. Registro do provedor: `packages/shared/src/providers.ts:480`.
- 429: cooldown padrão de 15 s e teto de 5 min; cota esgotada só reconhecida por `QUOTA_EXHAUSTED_RE` (OpenCode/OpenAI): `packages/backend/src/routing/proxy/proxy-fallback.service.ts:120-132,793-801`.
- Sem cabeçalhos de identificação de cliente, sem medidor de uso, sem aviso de termos para o Z.ai. Não usa Anthropic Messages nem Responses.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/zai-region.ts`

Arquivos que citam `zai`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/zai-region.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `knownModels` tem 10 ids, mas o plano só inclui `glm-5.3` e `glm-5.3-flash` (os demais são redirecionados); `maxContextWindow` 204800 não reflete o contexto de 1M documentado. Trocar a lista e confirmar a janela com conta real. | providers | [#345](https://github.com/patrickbrandao/thinker/issues/345) | aberta |
| G2 | degradação | 429 de cota (1308, 1310, 1316-1321, 1309) cai no cooldown de 15 s, pois `QUOTA_EXHAUSTED_RE` não reconhece o formato do Z.ai; tentativas repetidas por horas. 1311 e 1313 também sem tratamento. | backend-dev | [#346](https://github.com/patrickbrandao/thinker/issues/346) | aberta |
| G3 | degradação | Placeholder não distingue chave do Coding Plan de chave Standard (esta não consome o plano e pode cobrar saldo); sem aviso de que o uso fora das ferramentas suportadas pode gerar limitação ou ban. | frontend-dev | [#347](https://github.com/patrickbrandao/thinker/issues/347) | aberta |
| G4 | oportunidade | Medidor de uso do plano (janelas 5 h e semanal) via `GET /api/monitor/usage/quota/limit`, endpoint não documentado e de autenticação incerta; validar com conta real antes de implementar. Sem issue. | backend-dev | — | aberta |
| G5 | oportunidade | Usar `https://api.z.ai/api/anthropic` (Messages) para clientes Anthropic, preservando thinking e cache nativos, em vez de converter para Chat Completions. Sem issue. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Documentos lidos: overview, quick-start, tool/others, usage-policy, faq, notice/api-key-management, notice/usage-revision, latest-model, api-code, llms.txt. Lacunas G1-G3 abertas com issues #345-#347; G4 e G5 como oportunidades. Subscribe page não lida; endpoint de uso só por fontes comunitárias.
