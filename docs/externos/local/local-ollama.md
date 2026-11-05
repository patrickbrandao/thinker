---
id: local-ollama
categoria: local
entidade: Ollama
agente: local-ollama
thinker_ids: [ollama]
revisado_em: 2026-11-04
versao_observada: ollama v0.40.14 (estável) / v0.40.15-rc0; docs 2026-11-04
---

# Ollama (runtime local)

Especificação mantida pelo agente `local-ollama` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Ollama v0.40.14 (2026-11-03) é a estável; cadência de 1 a 3 releases por semana, sempre 0.40.x. Nenhuma quebra de API desde o último corte (não havia corte anterior).
- Serve API nativa (`/api/*`), OpenAI-compatível (`/v1/*`, incluindo `/v1/responses`, embeddings e áudio) e Anthropic-compatível (`/v1/messages`).
- O Thinker usa o Ollama por `/v1/chat/completions`, lista modelos por `/api/tags` e sonda `/api/version`, `/api/ps`, `/api/show`. Lacunas principais: `reasoning_effort`/`thinking` descartados (G1) e janela de contexto padrão de 4096 não refletida (G2).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Ollama repository and releases | <https://github.com/ollama/ollama> | v0.40.14 (2026-11-03); v0.40.15-rc0 |
| API docs | <https://docs.ollama.com/api> (fonte: `docs/api.md` em v0.40.14) | 2026-11-04 |
| OpenAI compatibility | <https://docs.ollama.com/api/openai-compatibility> | 2026-11-04 |
| Anthropic compatibility | <https://docs.ollama.com/api/anthropic-compatibility> | 2026-11-04 |
| FAQ (rede, keep_alive, contexto) | <https://docs.ollama.com/faq> | 2026-11-04 |
| Thinking | <https://docs.ollama.com/capabilities/thinking> | 2026-11-04 |

## Contrato

### Versões

- Última estável v0.40.14 (2026-11-03); pré-lançamento v0.40.15-rc0 (2026-11-03). Releases anteriores: 0.40.13 (2026-10-28), 0.40.12 (10-27), 0.40.11 (10-24). Fonte: <https://github.com/ollama/ollama/releases>.
- Mudanças relevantes para gateways: v0.40.14 faz os endpoints OpenAI-compatíveis respeitarem os padrões de amostragem do modelo (cliente sem `temperature`/`top_p` recebe os valores do modelo, não 1.0); v0.40.9 e v0.40.7 corrigiram falhas silenciosas e ordem de itens de raciocínio em streams de Responses/Messages; v0.40.11 adicionou `/v1/audio/speech` (macOS). v0.40.2 passou a "atualizar" modelos baixados em segundo plano (mantém cópia de backup em disco).

### APIs

| API | Caminhos | Observações |
|---|---|---|
| Nativa | `/api/chat`, `/api/generate`, `/api/embed`, `/api/tags`, `/api/ps`, `/api/show`, `/api/version` | `keep_alive` aceito em chat/generate/embed. Raciocínio vem em `message.thinking` (chat) ou `thinking` (generate). |
| OpenAI | `/v1/chat/completions`, `/v1/responses` (só sem estado), `/v1/completions`, `/v1/models`, `/v1/models/{model}`, `/v1/embeddings`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/audio/translations` | Base `http://localhost:11434/v1/`; chave exigida pelo cliente mas ignorada. |
| Anthropic | `/v1/messages` | Header `anthropic-version: 2023-06-01`. Nuvem exige `Authorization: Bearer`. |

Campos suportados em `/v1/chat/completions`: `model`, `messages`, `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `stream`, `frequency_penalty`, `presence_penalty`, `response_format`, `tools`, `stream_options.include_usage`, `reasoning_effort`, visão (só base64). Não suportados: `tool_choice`, `logprobs`, `logit_bias`, `user`, `n`, URL de imagem. Em Responses: sem `previous_response_id`/`conversation`/`truncation`; extensão `think`. Em `/v1/messages`: sem `tool_choice`, `metadata`, `cache_control`, `count_tokens`, batches, citações, PDF; `thinking.type` enabled/disabled liga/desliga e `budget_tokens` é aceito sem efeito; `output_config.effort` suportado. Fonte: páginas de compatibilidade, 2026-11-04. Se o servidor ignora ou rejeita (400) os campos não suportados: (não confirmado).

### Modelos e carregamento

- `GET /api/tags`: modelos baixados (`name`, `model`, `size`, `details.family/parameter_size/quantization_level`). `GET /api/ps`: modelos carregados (`expires_at`, `size_vram`). `POST /api/show {model}`: `capabilities` (lista, ex.: `completion`, `vision`, `tools`, `thinking`; conjunto completo não documentado), `model_info` com `<arch>.context_length`, Modelfile com `PARAMETER num_ctx`, e valores de thinking suportados.
- Id de modelo `nome:tag`; `:latest` é implícito. Alias para nomes que ferramentas esperam: `ollama cp`.
- Carregamento sob demanda no primeiro pedido (pode levar minutos em GGUF grande). Descarga após `keep_alive`, padrão 5 min; `OLLAMA_KEEP_ALIVE` global, `keep_alive` por pedido nativo (duração, segundos, negativo = fixo, `0` = descarrega). Não há como passar `keep_alive` pela rota OpenAI (não confirmado).
- Contexto: padrão 4096 tokens (`OLLAMA_CONTEXT_LENGTH` no servidor, `num_ctx` por pedido nativo; via OpenAI só com Modelfile). Concorrência: `OLLAMA_MAX_LOADED_MODELS` (3 x GPUs, 3 em CPU), `OLLAMA_NUM_PARALLEL` (1), `OLLAMA_MAX_QUEUE` (512, depois 503). Fonte: FAQ.

### Capacidades por família de modelo

- Tools e thinking dependem do modelo; descobrir por `capabilities` de `/api/show` em vez de por nome.
- Thinking: `think` nativo aceita `true`, `false`, `null` (padrão) ou string da lista `thinking.values` do `/api/show`. Na rota OpenAI, `reasoning_effort`: com metadados, nomes aceitos valem e os demais caem no padrão; modelos só booleanos mapeiam efforts para `true` e `none` para `false`; sem metadados, `minimal`→`low`, `xhigh`/`ultra`→`max`; gpt-oss tem conversão própria (`none` desliga a saída de thinking). Nome do campo de raciocínio na resposta OpenAI-compatível: (não confirmado; a doc de thinking só cobre a API nativa).
- Modelos recentes citados nas releases: LFM3 (256K), Flint (262K), Nemotron 3.5 Super (até 1M) e Bolt (128K), MiMo V2.6.

### Rede e Docker

- Bind padrão `127.0.0.1:11434`; `OLLAMA_HOST=0.0.0.0:11434` expõe na rede. CORS: `OLLAMA_ORIGINS` (127.0.0.1/0.0.0.0 permitidos por padrão). Sem autenticação embutida; usar proxy reverso se necessário.
- De dentro de um contêiner, `localhost` não alcança o host: usar `host.docker.internal` (Podman: `host.containers.internal`) e Ollama escutando em `0.0.0.0`. Docker Desktop no macOS não dá GPU ao Ollama em contêiner.

### Novidades aproveitáveis

- `/v1/responses` e `/v1/embeddings` no Ollama (Thinker não tem rota de embeddings, ver #365).
- `reasoning_effort` e `/v1/messages` com `output_config.effort` para controlar thinking (G1).
- `keep_alive` nativo para manter modelos aquecidos (só via `/api/chat`; Thinker usa a rota OpenAI).

## Como o Thinker implementa hoje

- Tile `ollama` built-in: `requiresApiKey: false`, `localOnly: true` (`packages/shared/src/providers.ts:383`); setup `ollama pull llama3.1:8b` (`providers.ts:587`).
- Base URL `process.env.OLLAMA_HOST || 'http://localhost:11434'` (`packages/backend/src/common/constants/ollama.ts:2`); `ollama-cloud` usa `https://ollama.com`.
- Inferência: `/v1/chat/completions`, formato `openai`, só `Content-Type`, `stream_options.include_usage` (`routing/proxy/provider-endpoints.ts:585-598`).
- Conversor: `thinking` removido para `ollama`/`ollama-cloud` (`routing/proxy/provider-client-converters.ts:483`); `reasoning_effort` e `stream_options` em OPENAI_ONLY_FIELDS (`:121-130`, `reasoning_effort` só passa para xai/deepseek/minimax); `tool_choice` e demais seguem intactos. Ids de modelo com `:` tratados em `routing/proxy/provider-client.ts:353`.
- Descoberta do tile: `GET {OLLAMA_HOST}/api/tags`, remove `:latest`, preço 0 (`model-discovery/provider-model-fetcher.service.ts:714-725,1031`); sincronização no boot em `database/ollama-sync.service.ts`.
- Servidores locais personalizados do tipo Ollama: `LOCAL_SERVER_TYPE_DEFAULTS.ollama` porta 11434, health `/api/version`, modelos `/api/tags` (`common/constants/local-servers.ts:~170`); sonda `/api/version`, `/api/tags`, `/api/ps`, `/api/show` (capabilities, `<arch>.context_length`), descarta modelos sem `completion` (`routing/custom-provider/local-server-probe.ts:~150-190`). Timeout de pedido padrão 10 min.
- Inferência de provedor: id com `:` sem `/` vira `ollama` (`packages/shared/src/provider-inference.ts:69`).

Pontos no código:

- `packages/backend/src/common/constants/ollama.ts`
- `packages/backend/src/common/constants/local-servers.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/custom-provider/local-server-probe.ts`
- `packages/backend/src/database/ollama-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/proxy-servers/proxy-egress.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/routing/provider.controller.ts`
- `packages/backend/src/routing/routing-core/provider-key.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/api/routing.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `reasoning_effort` e `thinking` são descartados para `ollama`/`ollama-cloud`, embora o Ollama aceite `reasoning_effort` e `thinking` (Messages); o raciocínio não pode ser controlado. Arquivos: `provider-client-converters.ts:121-130,483`. Sugestão: repassar `reasoning_effort` e traduzir `thinking`. | providers | [#449](https://github.com/patrickbrandao/thinker/issues/449) | resolvida (normalização de reasoning na entrada e na saída) |
| G2 | degradação | Contexto padrão do Ollama é 4096 e trunca em silêncio; o Thinker anuncia `<arch>.context_length` do `/api/show`. Arquivo: `local-server-probe.ts`. Sugestão: avisar e documentar `OLLAMA_CONTEXT_LENGTH`. | backend-dev | [#450](https://github.com/patrickbrandao/thinker/issues/450) | aberta |
| G3 | degradação | `tool_choice`, `n`, `logit_bias`, `logprobs`, `user` não são suportados pelo Ollama e seguem no pedido (mesma causa do Ollama Cloud, ver [#338](https://github.com/patrickbrandao/thinker/issues/338)); local não confirmado. | providers | [#338](https://github.com/patrickbrandao/thinker/issues/338) | resolvida (mesma regra do Ollama Cloud aplicada ao Ollama local) |
| G4 | oportunidade | Pedidos pela rota OpenAI não podem usar `keep_alive`/`num_ctx`; a API nativa `/api/chat` permitiria. Sem issue (avaliar após G2). | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (v0.40.14, docs de compatibilidade OpenAI/Anthropic, FAQ, thinking). Contrato preenchido; lacunas G1-G4; issues #449 e #450; G3 vinculada a #338.
