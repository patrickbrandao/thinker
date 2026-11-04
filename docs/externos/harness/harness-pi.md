---
id: harness-pi
categoria: harness
entidade: Agent Pi
agente: harness-pi
thinker_ids: [pi]
revisado_em: 2026-11-03
versao_observada: pi v1.5.0 (commit f9a2636)
---

# Agent Pi (harness)

Especificação mantida pelo agente `harness-pi` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **Identificação (alta confiança):** "Pi" é o agente de código em terminal do projeto `pi`, site <https://pi.dev>, pacote npm `@earendil-works/pi-coding-agent` (binário `pi`), mais a biblioteca de LLM `@earendil-works/pi-ai` e o núcleo de agente `pi-agent-core`. A semente `badlogic/pi-mono` está **desatualizada**: o repositório foi movido para `earendil-works/pi` (a API do GitHub resolve `badlogic/pi-mono` para ele). Última versão: **v1.5.0** (2026-11-02, commit `f9a2636`).
- Para um gateway, o Pi usa uma entrada em `~/.pi/agent/models.json` (formato `providers.<id>` com `baseUrl`, `api`, `apiKey`, `models[]`). Fala **Chat Completions** (`api: "openai-completions"`), mas também aceita `openai-responses`, `anthropic-messages` e `google-generative-ai` para o mesmo endpoint. A superfície declarada no Thinker (`chat_completions`) é a escolha natural, não a única.
- **Modelos são escritos à mão** em `models.json`; o Pi não chama `GET /v1/models` de endpoint customizado (só do roteador llama.cpp). O catálogo embutido vem do próprio Pi/models.dev, não do gateway.
- **Sessão:** por padrão, num endpoint que não é OpenRouter, o Pi **não envia nenhum cabeçalho de sessão**. Só envia quando `compat.sendSessionAffinityHeaders: true` está no `models.json`; aí manda `x-session-affinity` e `x-client-request-id` (e `session_id` no formato `openai`). **Nunca envia `x-session-key`**, o único que o Thinker lê (lacuna G1).
- O Thinker não tem snippet de setup nem seção de guia para o Pi (lacuna G2).
- O mesmo código `pi-ai` é embutido por outros harnesses (OpenClaw, DeepSeek Harness): o comportamento de cabeçalhos abaixo vale para eles quando usam esse caminho (não confirmado para cada um).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Repositório do Pi (substitui a semente `badlogic/pi-mono`, movida) | <https://github.com/earendil-works/pi> | tag `v1.5.0` (2026-11-02, commit `f9a2636`) |
| Código dos provedores (`packages/ai/src/api/openai-completions.ts`, `utils/identity.ts`, `utils/provider-retry.ts`) | repositório, tag `v1.5.0` | v1.5.0 |
| Docs no fonte (`packages/coding-agent/docs/models.md`, `models-configuration.md`, `settings.md`, `environment-variables.md`) | repositório, tag `v1.5.0` | v1.5.0 |
| Releases | <https://github.com/earendil-works/pi/releases> | v1.5.0 (anteriores: v1.4.0 em 2026-10-21, v1.3.0 em 2026-10-15) |
| Site e catálogo de modelos | <https://pi.dev>, <https://pi.dev/models> | não lido (dados vistos só pelo fonte) |

## Contrato

### Configuração do gateway

- Arquivo `models.json` no diretório do agente (`~/.pi/agent/`; o doc remete a `configuration.md#agent-directory`, não conferi o caminho exato no código) (não confirmado). `$schema`: `https://pi.dev/schemas/models.schema.json`. Recarrega ao abrir `/model`. (models.md, v1.5.0)
- Provedor customizado = qualquer `providers.<id>` que não seja built-in; exige `baseUrl` e `api` (no provedor ou no modelo). Campos do provedor: `name`, `baseUrl`, `apiKey`, `api`, `headers`, `compat`, `authHeader`, `models`, `modelOverrides`. (models-configuration.md)
- `baseUrl` é a raiz com `/v1` (exemplo oficial `http://localhost:11434/v1`); o SDK `openai` acrescenta `/chat/completions`. Para Thinker: `http://<host>:2099/v1`.
- `apiKey`: literal, `$NAME`/`${NAME}` ou `!comando`. No caminho `openai-completions` a chave vai ao SDK `openai` 7.19.0 e sai como `Authorization: Bearer`. `authHeader` (padrão `false`) controla o envio de `Authorization: Bearer` para as demais APIs; a semântica exata por API não foi conferida (não confirmado).
- `headers` (provedor ou modelo): cabeçalhos **estáticos** (valores resolvem como `apiKey`); não há interpolação de id de sessão. Logo, `x-session-key` fixo por `headers` agruparia tudo numa sessão só.
- Roteamento de built-in por proxy: só `baseUrl` no provedor mantém modelos e auth. (models.md)
- Chave em ordem de precedência: `--api-key` de runtime, `auth.json`, `apiKey` do `models.json`, variáveis de ambiente. (models.md)

### Seleção de modelo

- Modelos de provedor customizado vêm de `models[]` (`id` obrigatório, enviado como `model` no corpo). Sem chamada a `/v1/models`. Descoberta dinâmica só para o roteador llama.cpp (`/models`). (`packages/coding-agent/src/extensions/llama/client.ts:188`)
- Padrões quando omitidos: `contextWindow` **128000**, `maxTokens` **16384**, `input: ["text"]`, `reasoning: false`. (models-configuration.md) Para `auto` e virtuais do Thinker isso limita contexto e saída e desliga imagens; declarar `contextWindow`, `maxTokens`, `input` e `reasoning` no snippet.
- Seleção: `/model`, `--model`, `Ctrl+P` (escopo). O seletor só lista modelos com autenticação resolvida.
- Pi tem "virtual models" próprios (extensões; `virtual-models.md`), conceito local sem relação com os virtuais do Thinker.

### Cabeçalhos e sessão

Montados em `createClient` (`packages/ai/src/api/openai-completions.ts:739-780`, v1.5.0):

| Cabeçalho | Valor | Quando |
|---|---|---|
| `User-Agent` | `pi/<versão> (<plataforma>; node/<v> ou bun/<v>; <arch>)` (modo `detailed`, padrão), `pi` (`short`) ou valor custom | sempre (`utils/identity.ts:75-85`) |
| `x-stainless-*` | cabeçalhos do SDK `openai` JS 7.19.0 | sempre (comportamento do SDK; não conferi a lista exata) (não confirmado) |
| `x-session-affinity` | id da sessão do Pi | só com `compat.sendSessionAffinityHeaders: true` e `sessionAffinityFormat` `openai` ou `openai-nosession` |
| `x-client-request-id` | id da sessão do Pi | idem |
| `session_id` | id da sessão do Pi | idem, só no formato `openai` (o padrão quando o URL não é OpenRouter) |
| `x-session-id` | id da sessão | só com formato `openrouter` (padrão para URLs `openrouter.ai`) |
| `HTTP-Referer`, `X-OpenRouter-Title`, `X-OpenRouter-Categories` | `https://pi.dev`, `pi`, `cli-agent` | só alvo OpenRouter e atribuição ligada (`PI_TELEMETRY` desliga) |
| `x-opencode-client`, `x-opencode-session` | nome do app; id da sessão | só alvo OpenCode (`opencode.ai`), ver `identity.ts:112-135` |

- `sendSessionAffinityHeaders` é **falso** para qualquer endpoint que não seja OpenRouter (`openai-completions.ts:1674`); o `models.json` pode ligar (`compat`). No `anthropic-messages` o único cabeçalho é `x-session-affinity` (ou `x-session-id` no formato openrouter) (`anthropic-messages.ts:1066-1069`); no `openai-responses` há `session_id`/`x-client-request-id`/`x-session-id` conforme o formato (`openai-responses.ts:316-321`).
- O id é o `sessionId` da sessão do Pi (`agent-session.ts:1693`), estável durante a conversa. Subagentes por extensão (`examples/extensions/subagent`) rodam como processos/sessões próprios; **não há cabeçalho de sessão-mãe**.
- `prompt_cache_key` no corpo: só quando o `baseUrl` contém `api.openai.com`, ou quando a retenção é `long` (`PI_CACHE_RETENTION=long`) e o provedor suporta cache longo (padrão `true` para URLs desconhecidos); o valor é o id da sessão cortado. Junto vai `prompt_cache_retention: "24h"` em `long`. (`openai-completions.ts:811-817`)
- Corpo para URL desconhecido (como o Thinker): `stream: true`, `stream_options: {include_usage: true}`, `role: "developer"` no lugar de `system` (`supportsDeveloperRole` = true), `store: false`, `max_completion_tokens` (não `max_tokens`) e `reasoning_effort` quando o modelo declara `reasoning`. Cada um pode ser desligado pelo `compat` do modelo. (`openai-completions.ts:1595-1650`, `:818-830`)

### Outros endpoints

- Contra o gateway, só a rota de inferência (`POST {baseUrl}/chat/completions`, ou `/responses`, `/messages` conforme `api`). Sem token counting, health ou listagem de modelos.
- Fora do gateway: o Pi consulta `pi.dev` (catálogo de modelos e versão para `pi update`) e pode enviar telemetria de instalação/atualização; `PI_OFFLINE` e `PI_TELEMETRY` controlam. (environment-variables.md)

### Recursos usados

- Chat Completions com streaming, tool calls (ferramentas `read`, `bash`, `edit`, `write`; MCP por `pi-mcp`), reasoning com mapeamento por modelo (`thinkingLevelMap`, `thinkingFormat`), imagens (redimensiona antes de gravar), compactação automática, `reasoning_content` em respostas, mensagens de sistema no meio da conversa (apenas se `supportsMidConvoSystemMessages`; padrão dobra no prompt inicial).
- Espera o chunk final de `usage` (`include_usage`). Sem ele os custos da sessão ficam zerados.
- `finish_reason` ausente é tolerado (`supportsFinishReason: false`); valor desconhecido vira erro do Pi (`content_filter`, `network_error` e outros).

### Erros e retentativas

- Retry de provedor: política copiada do SDK (408, 409, 429, 5xx e erros de rede; respeita `x-should-retry`, `retry-after-ms` e `retry-after`), mas `retry.provider.maxRetries` **padrão 0**; o retry real é no nível do agente: `retry.maxRetries` 3, base 2000 ms, teto 60000 ms. Atraso pedido pelo servidor acima de `retry.provider.maxRetryDelayMs` (60 s) falha direto. (`provider-retry.ts:20-70`, settings.md)
- Recomendação para o Thinker: 429/5xx transitórios com `retry-after` em segundos curtos; 4xx claro e rápido para modelo inexistente; nunca devolver `retry-after` acima de 60 s sem querer que o Pi desista.

### Snippet de setup do Thinker

Não existe snippet nem seção de guia (G2). Proposta validada pelo schema do `models.json`:

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "thinker": {
      "name": "Thinker",
      "baseUrl": "http://localhost:2099/v1",
      "api": "openai-completions",
      "apiKey": "thk_SUA_CHAVE",
      "compat": { "sendSessionAffinityHeaders": true },
      "models": [
        { "id": "auto", "name": "Thinker Auto", "contextWindow": 200000, "maxTokens": 32000, "input": ["text", "image"], "reasoning": true }
      ]
    }
  }
}
```

Depois `pi --model thinker/auto` (ou `/model`). O ajuste de `compat` só ajuda depois que o Thinker ler `x-session-affinity` (G1). Não executado contra um Pi real (conferir ao vivo).

## Como o Thinker implementa hoje

Superfície: Chat Completions (`packages/shared/src/agent-type.ts:89`). Plataforma `pi` em `AGENT_PLATFORMS` (`agent-type.ts:39`), nome `Agent Pi` (`:115`), categoria `coding` (`:132`), ícone `/icons/pi.svg` (`:150`, arquivo existe em `packages/frontend/public/icons/pi.svg`).

Sessão do chamador:
- Só `x-session-key` é lido: `packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`; `proxy-session-scope.ts:19-37` (sem o cabeçalho, chave `default`, sem `providerCacheKey` nem `momentumKey`). Nenhum código lê `x-session-affinity`, `x-client-request-id`, `session_id` ou `x-session-id` (grep em `packages/backend/src` e `packages/shared/src`). Nesta `main` não existe `harness-session.ts`.
- Classificação do chamador em `caller-classifier.ts:35-66`: reconhece `OpenAI/...`, `anthropic-...`, curl, python-requests etc. (`:97-116`) e `x-stainless-*`; não reconhece `pi/<versão> (...)`. O Pi cai na detecção por Stainless (`openai-js` sem nome do app).
- O corpo do Pi (`developer`, `store`, `max_completion_tokens`, `reasoning_effort`) segue o formato Chat Completions padrão. O tratamento de `developer` existe nos adaptadores Anthropic e Responses (`anthropic-adapter.ts:191`, `responses-adapter.ts:105`); para provedores OpenAI-compatíveis não conferi se `developer`/`store` são repassados como vieram (não confirmado, ver conferência ao vivo).
- `prompt_cache_key` do chamador só é repassado no adaptador ChatGPT (`chatgpt-adapter.ts:45,122`).

Setup: nenhum. `docs/usuario/conectar-harnesses.md` não cita o Pi e não há componente `PiSetup` em `packages/frontend/src/components/`.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Com `compat.sendSessionAffinityHeaders: true` o Pi envia o id da sessão em `x-session-affinity` e `x-client-request-id` (e `session_id`); sem isso não envia nada. O Thinker só lê `x-session-key` (`proxy.controller.ts:277,899`), então toda requisição cai em `default`: sem agrupamento, sem momentum de roteamento e sem chave de cache por conversa. Sugestão: ler `x-session-affinity` como fallback de `x-session-key` e documentar o `compat` no snippet. Mesma causa de [#318](https://github.com/patrickbrandao/thinker/issues/318). | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) (comentário) | aberta |
| G2 | degradação | Sem snippet nem seção de guia para o Pi (`models.json` com `baseUrl`, `api`, `apiKey`, `compat.sendSessionAffinityHeaders` e modelos com `contextWindow`/`maxTokens`/`input`/`reasoning`); sem isso o Pi assume contexto 128000, saída 16384, sem imagens e sem reasoning para `auto`/virtuais, e não manda sessão. | frontend-dev | [#390](https://github.com/patrickbrandao/thinker/issues/390) | aberta |
| G3 | oportunidade | `caller-classifier.ts` não reconhece o `User-Agent` `pi/<versão> (...)`; reconhecer registraria `pi` e a versão como cliente. | backend-dev | — | aberta |
| G4 | oportunidade | O Pi aceita também `openai-responses` e `anthropic-messages` para o mesmo endpoint (sessão com `session_id`/`x-session-affinity`); avaliar documentar a opção Responses, que hoje o Thinker serve para o Codex. | frontend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra a tag `v1.5.0` de `earendil-works/pi` (clone raso): cabeçalhos em `openai-completions.ts`, `identity.ts`, retry, docs de `models.json`. Semente `badlogic/pi-mono` substituída (repositório movido). G1 registrada em comentário no #318 (mesma causa); G2 aberta como [#390](https://github.com/patrickbrandao/thinker/issues/390); G3 e G4 como oportunidade, sem issue.
