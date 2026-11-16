# Conectar harnesses

Todo harness usa a chave `thk_` do seu harness e o endereço do gateway. Os exemplos usam `http://localhost:2099`; troque pelo endereço da sua instância. O modelo `auto` pede ao Thinker que escolha (veja [Provedores e roteamento](provedores-e-roteamento.md)).

O dashboard gera estes mesmos trechos já com a sua chave, no assistente de configuração do harness. As superfícies expostas são:

| Rota | Formato |
| --- | --- |
| `POST /v1/chat/completions` | OpenAI Chat Completions |
| `POST /v1/responses` | OpenAI Responses |
| `POST /v1/messages` | Anthropic Messages |
| `GET /v1/models` | Lista de modelos do harness |

A chave pode ir em `Authorization: Bearer thk_...` ou em `x-api-key: thk_...`. Se os dois cabeçalhos chegam com valores diferentes, o gateway responde `M006`.

O nome de um harness segue a regra de um nome de DNS: só letras minúsculas, números e hífen (`a-z`, `0-9`, `-`), sem hífen no começo nem no fim, com até 63 caracteres. Ao digitar na janela **Conectar harness**, maiúsculas viram minúsculas, espaços e `_` viram hífen, acentos são removidos e os demais caracteres são descartados. A API (`POST /api/v1/agents`, renomear e duplicar) recusa com 400 um nome fora da regra. Harnesses criados antes da regra mantêm o nome.

## Claude Code

O Claude Code usa a API Anthropic Messages. Em `~/.claude/settings.json`:

```json
{
  "model": "auto",
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:2099",
    "ANTHROPIC_AUTH_TOKEN": "thk_SUA_CHAVE"
  }
}
```

A URL base **não** leva `/v1`: o cliente Anthropic acrescenta `/v1/messages`. Defina **só uma** variável de credencial: `ANTHROPIC_AUTH_TOKEN` (vira `Authorization: Bearer`) ou `ANTHROPIC_API_KEY` (vira `x-api-key`). Com as duas definidas e valores diferentes, o gateway responde `M006`.

Por um gateway, o Claude Code assume contexto de 200k e compacta sessões longas cedo. Para trabalho com contexto longo, fixe um modelo de 1M em vez de `auto` (por exemplo `/model claude-opus-5-5[1m]`).

Um modelo fixado (no `/model`, em `ANTHROPIC_MODEL` ou nos subagentes, que pedem `claude-haiku-*`) é uma rota explícita e **não tem fallback**. Para manter a cascata num nome fixo, crie um modelo virtual com esse nome (veja [`model` explícito](provedores-e-roteamento.md#model-explícito)).

## Codex

O Codex usa a API Responses. Em `~/.codex/config.toml`:

```toml
model = "auto"
model_provider = "thinker"
model_context_window = 128000

[model_providers.thinker]
name = "Thinker"
base_url = "http://localhost:2099/v1"
env_key = "THINKER_AGENT_KEY"
wire_api = "responses"
```

No terminal que inicia o Codex:

```bash
export THINKER_AGENT_KEY="thk_SUA_CHAVE"
```

O Codex não lê `GET /v1/models` de um provedor customizado. Para `auto` e para os modelos virtuais ele usa metadados de fallback (janela de 272 mil tokens e o aviso "Model metadata ... not found") e, sem `model_context_window`, compacta tarde demais quando a rota cai num modelo de contexto menor, e o provedor responde `context_length_exceeded`. O trecho fixa 128000, um valor seguro; troque pela menor janela de contexto por trás do modelo, que aparece na aba **Modelos** do harness. A chave fica no topo do arquivo, antes da tabela `[model_providers.thinker]`.

## OpenCode

Em `~/.config/opencode/opencode.json`, no formato do OpenCode 2 (`providers`, `package`, `settings`; o formato antigo, com `provider`, `npm` e `options`, era do OpenCode 1). A configuração proposta no dashboard já traz o `auto` e os modelos virtuais ativos do harness:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "thinker": {
      "package": "aisdk:@ai-sdk/openai-compatible",
      "name": "Thinker",
      "settings": {
        "baseURL": "http://localhost:2099/v1",
        "apiKey": "thk_SUA_CHAVE"
      },
      "models": {
        "auto": { "name": "Thinker Auto" },
        "rapido": { "name": "Thinker rapido" }
      }
    }
  },
  "model": "thinker/auto"
}
```

### OpenCode com o provedor Claude Agent (opcional)

Desde a v2.2.3 o OpenCode tem o provedor embutido **Claude Agent** (`claude-agent`). Ele não chama a API direto: roda o `claude` (Claude Code) instalado na máquina, pelo Claude Agent SDK. Requisitos: `claude` no `PATH` (ou em `OPENCODE_CLAUDE_PATH`), versão 2.1.248 ou mais nova.

A config `providers.claude-agent.settings` vira as variáveis do Claude Code: `baseURL` em `ANTHROPIC_BASE_URL` e `authToken` em `ANTHROPIC_AUTH_TOKEN` (`apiKey` vira `ANTHROPIC_API_KEY`). No mesmo `opencode.json`:

```json
{
  "providers": {
    "claude-agent": {
      "settings": {
        "baseURL": "http://localhost:2099",
        "authToken": "thk_SUA_CHAVE"
      }
    }
  }
}
```

Como no Claude Code, a URL base **não** leva `/v1`, e vale definir **só uma** credencial (`authToken` ou `apiKey`), para não causar `M006`.

O que muda em relação ao provedor `thinker` acima:

- O Thinker vê o harness como **Claude Code**: as requisições chegam em `POST /v1/messages` com a identificação do Claude Code (como `x-claude-code-session-id`), e não com os cabeçalhos `x-opencode-*`.
- Os modelos são os do Claude Code (`opus`, `sonnet`, `haiku`, que viram ids `claude-*` reais). O Thinker recebe uma rota explícita, **sem fallback**, e não `auto` nem modelos virtuais. Para manter a cascata, crie um modelo virtual com o nome do id (veja [`model` explícito](provedores-e-roteamento.md#model-explícito)). Remapear com `ANTHROPIC_DEFAULT_*_MODEL` no ambiente do OpenCode é possível em teoria, mas não foi confirmado neste caminho.
- O OpenCode mostra custo **$0** nesse caminho (URL base customizada). O custo real fica no Thinker.
- O OpenCode não retenta: quem retenta é o Claude Code.

Não confirmado: o uso de `authToken` com uma chave `thk_` segue do proxy aceitar `Authorization: Bearer`, mas este caminho ainda não foi testado ao vivo. Teste antes de depender dele. Para entender a técnica em detalhe, veja o [parecer do provedor Claude Agent](../referencia/opencode/claude-agent-provider-parecer.md).

## OpenClaw e Hermes

**OpenClaw**, como provedor OpenAI-compatible (Chat Completions):

```bash
openclaw config set models.providers.thinker '{"baseUrl":"http://localhost:2099/v1","api":"openai-completions","apiKey":"thk_SUA_CHAVE","models":[{"id":"auto","name":"Thinker Auto","input":["text","image"],"contextWindow":128000,"maxTokens":16384,"compat":{"supportsUsageInStreaming":true}}]}'
openclaw config set agents.defaults.model.primary thinker/auto
openclaw gateway restart
```

O OpenClaw só anexa imagens quando o modelo declara `"image"` em `input`, e, para um endpoint `openai-completions` que não conhece, supõe que o stream não traz `usage` e passa a estimar o contexto; `compat.supportsUsageInStreaming: true` faz ele pedir `stream_options.include_usage`, que o Thinker devolve. `contextWindow` fica em 128000, um valor seguro: troque pela menor janela por trás do modelo (aba **Modelos** do harness). O trecho do dashboard já traz uma entrada igual para cada modelo virtual ativo.

**Hermes**, em `config.yaml` (abra com `hermes config edit`):

```yaml
providers:
  thinker:
    api: http://localhost:2099/v1
    api_key: thk_SUA_CHAVE
    session_affinity_header: x-session-key
model:
  provider: custom:thinker
  default: auto
```

A entrada nomeada em `providers:` é a única que aceita `session_affinity_header`. Com ele o Hermes manda o id da conversa em `x-session-key` e o Thinker agrupa cada conversa (cache de prompt e momentum de roteamento); sem ele tudo cai na sessão `default`.

Nanobot também fala Chat Completions; o assistente do dashboard gera o trecho certo.

## Craft Agent

No Craft, crie uma conexão por chave de API com o preset **Custom**, protocolo OpenAI Completions, URL base `http://localhost:2099/v1`, modelo padrão `auto` e a chave `thk_`. O Craft não consulta `GET /v1/models`.

Todo modelo de endpoint personalizado entra no Craft com contexto de 131072 tokens, saída de 8192 tokens (que também limita o resumo da compactação) e sem imagens, mesmo quando o `auto` roteia para um modelo de 1M ou com visão. Ajuste a saída máxima e o suporte a imagens da conexão e, para um contexto maior, edite a conexão em `~/.craft-agent/config.json` (`llmConnections[]`):

```json
{
  "customEndpoint": { "api": "openai-completions", "maxTokens": 16384, "supportsImages": true },
  "models": [{ "id": "auto", "contextWindow": 200000, "supportsImages": true }]
}
```

## Agent Pi

O Pi lê os provedores de `~/.pi/agent/models.json` e não consulta `GET /v1/models`. Sem metadados, cada modelo fica com contexto de 128000, saída de 16384, só texto e sem raciocínio. O trecho do dashboard já declara `auto` e os modelos virtuais ativos:

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
        { "id": "auto", "name": "Thinker Auto", "contextWindow": 128000, "maxTokens": 16384, "input": ["text", "image"], "reasoning": false }
      ]
    }
  }
}
```

Depois escolha o modelo com `/model` ou rode `pi --model thinker/auto`. `compat.sendSessionAffinityHeaders: true` faz o Pi mandar o id da sessão em `x-session-affinity`, que o Thinker lê como sessão. Ajuste `contextWindow` para a menor janela por trás do modelo (aba **Modelos**), ligue `reasoning` só se todas as rotas fizerem raciocínio (o Pi passa a mandar `reasoning_effort`) e tire `"image"` de `input` se alguma rota não tiver visão.

## Copilot CLI

O Copilot CLI usa BYOK por `~/.copilot/providers.json` (ou o caminho em `COPILOT_PROVIDERS_CONFIG`). A chave fica em texto puro no arquivo: ele não expande `$VAR`.

```json
{
  "providers": [
    { "name": "thinker", "type": "openai", "baseUrl": "http://localhost:2099/v1", "apiKey": "thk_SUA_CHAVE", "wireApi": "completions" }
  ],
  "models": [
    { "id": "auto", "provider": "thinker", "maxPromptTokens": 128000, "maxOutputTokens": 16384 }
  ]
}
```

Reinicie o CLI e rode `copilot --model thinker/auto` (ou `/model`). A URL base leva `/v1`. `wireApi: completions` mantém o Copilot em Chat Completions por HTTP. Para modelo desconhecido o CLI assume 128000 tokens de prompt; troque `maxPromptTokens` pela menor janela por trás do modelo.

## DeepSeek Harness

O DeepSeek Harness (`dsh`) chega ao Thinker por duas rotas. Nas duas, a chave vem da variável `THINKER_AGENT_KEY` no ambiente que inicia o dsh (`export THINKER_AGENT_KEY="thk_SUA_CHAVE"`), e os modelos são declarados à mão, porque com URL base personalizada o dsh não lista modelos.

**Rota nativa** (Anthropic Messages; manda o id da sessão em `x-deepseek-harness-session-id`, que o Thinker lê). Em `$DSH_HOME/profiles/<perfil>/cordis.patch.yml` (o perfil da Web UI é `web`):

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    baseURL: http://localhost:2099
    apiKeyEnv: THINKER_AGENT_KEY
    models:
      - id: "auto"
        contextWindow: 128000
        maxTokens: 16384
```

A URL base vai **sem** `/v1`: o dsh acrescenta `/v1/messages`.

**Rota Custom model API** (Chat Completions), a mesma que a tela Settings > Models > Custom model API grava:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      thinker:
        displayName: Thinker
        api: openai-completions
        baseURL: http://localhost:2099/v1
        apiKeyEnv: THINKER_AGENT_KEY
        models:
          - id: "auto"
            contextWindow: 128000
            maxTokens: 16384
```

Aqui a URL base **leva** `/v1`. Essa rota não manda cabeçalho de sessão.

## Claude Desktop

O Claude Desktop não lê `ANTHROPIC_BASE_URL` nem `settings.json`. Ele aponta para um gateway no modo de inferência de terceiros: Help > Troubleshooting > Enable Developer Mode, depois Developer > Configure Third-Party Inference, com Inference provider **Gateway** e:

| Campo | Valor |
| --- | --- |
| Gateway base URL | `http://localhost:2099` (sem `/v1`: o app acrescenta `/v1/messages`) |
| Gateway API key | a chave `thk_` |
| Gateway auth scheme | `bearer` |

A descoberta de modelos por `GET /v1/models` só mostra ids reconhecidamente Claude, então `auto` e os modelos virtuais não aparecem no seletor. Declare-os em `inferenceModels`; as mesmas chaves valem no JSON de configuração ou num perfil MDM:

```json
{
  "inferenceProvider": "gateway",
  "inferenceGatewayBaseUrl": "http://localhost:2099",
  "inferenceGatewayApiKey": "thk_SUA_CHAVE",
  "inferenceGatewayAuthScheme": "bearer",
  "inferenceModels": [
    { "name": "auto", "labelOverride": "Thinker auto", "behavesAs": "claude-sonnet-5-5" }
  ]
}
```

`behavesAs` empresta a `auto` os controles de Effort e a janela de contexto do modelo Claude citado; sem ele o app assume 200 mil tokens e esconde o Effort. Clique em Apply Changes e feche e reabra o app: a configuração só é lida na abertura.

## Automação

### n8n

Use o node OpenAI Chat Model num AI Agent ou Basic LLM Chain, com uma credencial OpenAI: Base URL `http://localhost:2099/v1`, API Key `thk_` e o modelo `auto` no node.

Na versão 1.3 do node (a que o n8n 2.x cria em workflows novos), a opção **Use Responses API** vem ligada e o node chama `POST /v1/responses`. O Thinker serve essa rota, mas, para um provedor sem a API Responses, traduz a requisição para Chat Completions. Desligue a opção quando os seus provedores não tiverem Responses: o node passa a mandar Chat Completions, repassado sem tradução. As ferramentas nativas `web_search`, `file_search` e `code_interpreter` só funcionam em provedores que servem Responses de forma nativa. Nodes até a versão 1.2 sempre usam Chat Completions.

### Open WebUI

Em Admin Settings > Connections > OpenAI API, adicione uma conexão:

| Campo | Valor |
| --- | --- |
| URL | `http://localhost:2099/v1` (com `/v1`; com o Open WebUI em Docker e o Thinker no host, `http://host.docker.internal:2099/v1`) |
| API Key | a chave `thk_` |
| Headers | `{"x-session-key": "{{CHAT_ID}}"}` |
| Model IDs | vazio: o Open WebUI lista `auto` e os virtuais por `GET /v1/models` |

O cabeçalho dá a cada chat uma sessão própria no Thinker. Com `ENABLE_FORWARD_USER_INFO_HEADERS=true` o Open WebUI também manda `X-OpenWebUI-Chat-Id`, que o Thinker lê sem o cabeçalho customizado (mas essa opção também envia nome, e-mail e papel do usuário). Por ambiente, o equivalente é `OPENAI_API_BASE_URL=http://host.docker.internal:2099/v1` e `OPENAI_API_KEY=thk_SUA_CHAVE`. Dica: defina `TASK_MODEL` com um modelo mais barato, para que títulos, tags e sugestões de continuação não usem o modelo do chat.

### Chatwoot

No Chatwoot (Captain), em Super Admin > Settings > Captain:

| Campo | Valor |
| --- | --- |
| OpenAI API Key | a chave `thk_` |
| OpenAI API Endpoint | `http://localhost:2099` (**sem** `/v1`) |
| OpenAI Model | `auto` ou o nome de um modelo virtual |

O Chatwoot acrescenta `/v1` ao endpoint; um valor terminado em `/v1` vira `/v1/v1/...` e dá 404. Se o Chatwoot roda em contêiner, use um host que o contêiner alcance. Os embeddings (`/v1/embeddings`) e a transcrição de áudio (`/v1/audio/transcriptions`) do Captain usam o mesmo endpoint e passam pelo Thinker; defina o Embedding Model como um modelo que os seus provedores servem. O Chatwoot não manda cabeçalho de sessão nem aceita cabeçalhos customizados, então tudo fica na sessão `default`.

### Langflow

O Langflow chama o Thinker a partir do servidor, e a proteção SSRF dele vem ligada: bloqueia faixas privadas (e, no componente OpenAI legado, `localhost` e HTTP sem TLS) até o host ser liberado. No ambiente do servidor do Langflow:

```bash
LANGFLOW_SSRF_ALLOWED_HOSTS=<host do Thinker>
```

O valor é hostname, IP, CIDR ou `*.dominio`, separados por vírgula, sem esquema e sem porta. Reinicie o Langflow, abra Settings > Model Providers > **OpenAI Compatible** e preencha Base URL `http://<host>:2099/v1` e API Key `thk_`. Ao salvar, o Langflow valida com `GET /v1/models`; habilite os modelos descobertos (`auto` e os virtuais) e escolha um num componente Language Model ou Agent. Com o Langflow em contêiner e o Thinker no host, use `host.docker.internal`.

### Zapier

Os apps de IA do Zapier (ChatGPT, AI by Zapier) não aceitam URL base personalizada. O caminho é a ação **Webhooks by Zapier** com o evento **Custom Request**:

| Campo | Valor |
| --- | --- |
| Method | `POST` |
| URL | `https://<host público>/v1/chat/completions` |
| Headers | `Authorization: Bearer thk_SUA_CHAVE` e `Content-Type: application/json` |
| Data | `{"model": "auto", "messages": [{"role": "user", "content": "..."}]}` |

Os Zaps rodam na nuvem do Zapier, então o Thinker precisa de URL pública (HTTPS); `localhost` não serve. Deixe `stream` desligado (o Zapier não lê SSE) e escolha um modelo rápido: cada ação para depois de 30 s. A resposta fica em `choices[0].message.content`.

## SDKs

**OpenAI SDK (Python):**

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:2099/v1", api_key="thk_SUA_CHAVE")
resp = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Olá"}],
)
```

**Anthropic SDK (Python):** sem `/v1` na URL base.

```python
import anthropic

client = anthropic.Anthropic(base_url="http://localhost:2099", api_key="thk_SUA_CHAVE")
msg = client.messages.create(
    model="auto",
    max_tokens=256,
    messages=[{"role": "user", "content": "Olá"}],
)
```

Para o SDK da Anthropic, defina só `api_key` (vira `x-api-key`) **ou** `auth_token` (vira Bearer), nunca os dois com valores diferentes (`M006`).

**Vercel AI SDK** (só TypeScript): desde o AI SDK 5, `createOpenAI(...)("auto")` chama a API Responses. Para Chat Completions use `@ai-sdk/openai-compatible`, com `includeUsage: true` para receber o `usage` final no stream (ou `createOpenAI(...).chat("auto")`):

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const thinker = createOpenAICompatible({
  name: "thinker",
  baseURL: "http://localhost:2099/v1",
  apiKey: "thk_SUA_CHAVE",
  includeUsage: true,
});

const { text } = await generateText({ model: thinker("auto"), prompt: "Olá" });
```

**LangChain e cURL** usam a superfície Chat Completions: URL base `http://localhost:2099/v1` e a chave `thk_`.

### Sessão

O Thinker agrupa as requisições de uma conversa (cache de prompt, momentum de roteamento e o menu Sessões) pelo cabeçalho de sessão que o harness manda. Claude Code, Codex, OpenCode, DeepSeek Harness (rota nativa), Agent Pi (com `compat.sendSessionAffinityHeaders: true`) e Open WebUI (com `ENABLE_FORWARD_USER_INFO_HEADERS=true`) mandam o próprio cabeçalho, e o Thinker o lê sem configuração. Os demais não mandam nada; para eles, envie `x-session-key` com um valor por conversa:

- **Open WebUI:** nos Headers da conexão, `{"x-session-key": "{{CHAT_ID}}"}` (acima), sem expor dados do usuário.
- **LangChain:** `default_headers={"x-session-key": "<id da conversa>"}` no `ChatOpenAI` (Python) ou `configuration: { defaultHeaders: { "x-session-key": "..." } }` (JS).
- **n8n:** na credencial OpenAI, "Add Custom Header" com nome `x-session-key` e um valor fixo. O n8n só aceita um valor por credencial, então use uma credencial por workflow para separar os workflows; não existe valor por execução.
- **Hermes:** `session_affinity_header: x-session-key` na entrada `providers.thinker` (acima).
- **SDKs OpenAI e Anthropic:** `default_headers` (Python) ou `defaultHeaders` (JS) no cliente; no OpenAI SDK também vale a variável `OPENAI_CUSTOM_HEADERS`.
- **Vercel AI SDK:** `headers: { "x-session-key": "..." }` em `createOpenAICompatible` (ou `createOpenAI`).
- **Zapier:** em Webhooks, um cabeçalho `x-session-key` fixo por Zap.
- **Langflow:** os componentes padrão não aceitam cabeçalhos customizados, então as chamadas ficam na sessão `default`.
- **Cline:** o provedor OpenAI Compatible do Cline não manda id de sessão nem cabeçalhos por conversa. Dá para fixar `x-session-key` nos cabeçalhos do provedor, mas o valor vale para todas as conversas daquele perfil. Sem isso, as requisições do Cline ficam na sessão `default`.

## Embeddings, transcrição e contagem de tokens

- `POST /v1/embeddings` e `POST /v1/audio/transcriptions` (multipart, campo `file`) vão direto ao provedor do modelo, sem roteamento: use o id com o provedor, por exemplo `openai/text-embedding-3-small` ou `groq/whisper-large-v3`, e tenha uma conexão desse provedor habilitada no harness. `auto` e modelos virtuais não valem aqui.
- `POST /v1/messages/count_tokens` (SDK da Anthropic, Claude Code): com um modelo Claude e conexão Anthropic, o Thinker repassa à Anthropic; com `auto`, um virtual ou outro provedor, devolve uma estimativa (cerca de 4 caracteres por token).
- `GET /v1/models` responde no formato da Anthropic quando o cliente manda `anthropic-version`, e `GET /v1/models/{id}` devolve um modelo só.

## Escolher um modelo virtual

Um [modelo virtual](provedores-e-roteamento.md#modelos-virtuais) é um nome que você cria no harness (por exemplo `deepseek/flash`) e que o Thinker roteia pela cadeia dele. Em qualquer harness, ele entra no mesmo lugar do `auto`:

| Harness | Onde colocar o nome |
| --- | --- |
| Claude Code | `"model"` em `~/.claude/settings.json`, ou `/model <nome>` na sessão. |
| Codex | `model` em `~/.codex/config.toml`. |
| OpenCode | A chave `model` (`thinker/<nome>`) e uma entrada em `providers.thinker.models` (a configuração do dashboard já inclui todos). |
| OpenClaw | `agents.defaults.model.primary` (`thinker/<nome>`) e uma entrada em `models` (o trecho do dashboard já inclui todos). |
| Hermes | `default` em `config.yaml`. |
| Nanobot | `agents.defaults.model` em `~/.nanobot/config.json`. |
| Agent Pi | Uma entrada em `providers.thinker.models` de `models.json` (o trecho do dashboard já inclui todos); depois `/model thinker/<nome>`. |
| Copilot CLI | Uma entrada em `models` de `providers.json`; depois `copilot --model thinker/<nome>`. |
| DeepSeek Harness | Uma entrada em `models` do plugin, nas duas rotas. |
| Claude Desktop | Uma entrada em `inferenceModels`. |
| Craft Agent | A lista de modelos da conexão. |
| Open WebUI, Langflow | Aparecem sozinhos, porque vêm de `GET /v1/models`. |
| Chatwoot | O campo OpenAI Model do Captain. |
| SDKs, LangChain, n8n, Zapier, cURL | O parâmetro `model` da chamada. |

Exemplo no Claude Code:

```json
{
  "model": "deepseek/flash",
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:2099",
    "ANTHROPIC_AUTH_TOKEN": "thk_SUA_CHAVE"
  }
}
```

Nos harnesses que listam os modelos pelo seletor (por exemplo o seletor de modelos de um editor), o nome aparece sozinho, porque vem de `GET /v1/models`. Os assistentes do dashboard já mostram os virtuais ativos ao lado de `auto` e explicam isso.

`GET /v1/models` devolve, para a chave do harness, nesta ordem:

1. `auto`;
2. os virtuais **ativos** do harness, na ordem do dashboard;
3. os modelos reais. Um modelo real com o mesmo ID de um virtual ativo (sem diferenciar maiúsculas) fica de fora, porque o virtual o [sombreia](provedores-e-roteamento.md#sombreamento-de-ids-reais).

```json
{ "id": "deepseek/flash", "object": "model", "created": 0, "owned_by": "thinker", "context_length": 128000 }
```

`auto` e os virtuais trazem `context_length`, a **menor** janela de contexto entre as rotas que podem atendê-los agora, para o cliente não estourar o contexto no modelo mais curto da cadeia. O campo é omitido quando a janela de alguma rota é desconhecida. Eles não trazem `capabilities`, `cost` nem metadados de rota, mesmo com `?capabilities=true` ou `?cost=true`, porque o modelo concreto muda conforme a disponibilidade. Os modelos reais não trazem `context_length`. Cada chave só vê os virtuais do próprio harness.

### Listagem de modelos

Em **Configurações** de cada harness, a opção **Listagem de modelos** decide o que `GET /v1/models` mostra:

| Opção | O que aparece |
|---|---|
| **Fechada** | Só `auto` e os virtuais ativos. |
| **Restrita** | `auto`, os virtuais ativos e os modelos reais ligados a eles por roteamento e fallback: os tiers que o `auto` alcança (só o Default com o roteamento por complexidade desligado; senão todos os slots e as atribuições de especificidade) e as rotas de cada virtual, incluindo a cadeia do Default quando ele continua no Default. |
| **Aberta** (padrão) | Todos os modelos disponíveis. |

A aba **Modelos** do harness, ao lado de **Roteamento**, mostra essa mesma lista, na mesma ordem e já com a listagem e o sombreamento aplicados, em uma tabela com tipo (auto, virtual ou modelo), provedor, janela de contexto, preço de entrada e saída por milhão de tokens e detalhes: para um virtual, o modelo principal, os fallbacks, se continua no `auto` e se responde por stream; para um modelo real, as capacidades. Os preços de `auto` e dos virtuais aparecem como "Varia", porque dependem do modelo que atender. Pela API do dashboard, a lista sai em `GET /api/v1/routing/:agente/model-list`.

A opção só muda a lista. Um harness ainda pode pedir pelo nome um modelo que não aparece nela.

## Servidor MCP

O Thinker expõe um servidor MCP remoto em `/api/v1/mcp` (OAuth 2.1), com ferramentas `thinker_*` para gerenciar harnesses, provedores e roteamento. Ele exige `BETTER_AUTH_URL` em HTTPS (ou localhost); veja [Instalação](instalacao-docker.md#porta-e-acesso-pela-rede).
