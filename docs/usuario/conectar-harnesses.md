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

## Codex

O Codex usa a API Responses. Em `~/.codex/config.toml`:

```toml
model = "auto"
model_provider = "thinker"

[model_providers.thinker]
name = "Thinker"
base_url = "http://localhost:2099/v1"
env_key = "THINKER_API_KEY"
wire_api = "responses"
```

No terminal que inicia o Codex:

```bash
export THINKER_API_KEY="thk_SUA_CHAVE"
```

## OpenCode

Em `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "thinker": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Thinker",
      "options": {
        "baseURL": "http://localhost:2099/v1",
        "apiKey": "thk_SUA_CHAVE"
      },
      "models": {
        "auto": { "name": "Thinker Auto" }
      }
    }
  },
  "model": "thinker/auto"
}
```

## OpenClaw e Hermes

**OpenClaw**, como provedor OpenAI-compatible (Chat Completions):

```bash
openclaw config set models.providers.thinker '{"baseUrl":"http://localhost:2099/v1","api":"openai-completions","apiKey":"thk_SUA_CHAVE","models":[{"id":"auto","name":"Thinker Auto"}]}'
openclaw config set agents.defaults.model.primary thinker/auto
openclaw gateway restart
```

**Hermes**, em `config.yaml` (abra com `hermes config edit`):

```yaml
model:
  provider: custom
  base_url: http://localhost:2099/v1
  api_key: thk_SUA_CHAVE
  default: auto
```

Nanobot e Craft Agent também falam Chat Completions; o assistente do dashboard gera o trecho certo para cada um.

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

**Vercel AI SDK, LangChain, n8n e cURL** usam a superfície Chat Completions: URL base `http://localhost:2099/v1` e a chave `thk_`. No n8n, use o node OpenAI Chat Model com uma credencial OpenAI cuja Base URL aponta para o Thinker.

## Escolher um modelo virtual

Um [modelo virtual](provedores-e-roteamento.md#modelos-virtuais) é um nome que você cria no harness (por exemplo `deepseek/flash`) e que o Thinker roteia pela cadeia dele. Em qualquer harness, ele entra no mesmo lugar do `auto`:

| Harness | Onde colocar o nome |
| --- | --- |
| Claude Code | `"model"` em `~/.claude/settings.json`, ou `/model <nome>` na sessão. |
| Codex | `model` em `~/.codex/config.toml`. |
| OpenCode | A chave `model` (`thinker/<nome>`) e uma entrada em `models` do provedor. |
| OpenClaw | `agents.defaults.model.primary` (`thinker/<nome>`) e uma entrada em `models`. |
| Hermes | `default` em `config.yaml`. |
| Nanobot | `agents.defaults.model` em `~/.nanobot/config.json`. |
| SDKs, LangChain, n8n, cURL | O parâmetro `model` da chamada. |

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

A opção só muda a lista. Um harness ainda pode pedir pelo nome um modelo que não aparece nela.

## Roteamento por cabeçalho

Um harness pode ter **tiers customizados** ativados por um cabeçalho de requisição (por exemplo `x-thinker-tier: premium`), cada um com seu modelo e fallbacks. Veja [Provedores e roteamento](provedores-e-roteamento.md#tiers-customizados-por-cabeçalho). Se o harness não deixa enviar cabeçalhos, use um modelo virtual. Um modelo virtual com o mesmo nome do `model` vence o tier por cabeçalho.

## Servidor MCP

O Thinker expõe um servidor MCP remoto em `/api/v1/mcp` (OAuth 2.1), com ferramentas `thinker_*` para gerenciar harnesses, provedores e roteamento. Ele exige `BETTER_AUTH_URL` em HTTPS (ou localhost); veja [Instalação](instalacao-docker.md#porta-e-acesso-pela-rede).
