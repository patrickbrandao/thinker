<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/thinker-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/thinker-logo.svg" />
    <img src=".github/assets/thinker-logo.svg" alt="Thinker LLM Gateway" height="53" title="Thinker LLM Gateway"/>
  </picture>
</p>
<p align="center">
Gateway de LLM open source e auto-hospedado para agentes de IA
</p>

<p align="center">
  <a href="https://hub.docker.com/r/tmsoftbrasil/thinker"><img src="https://img.shields.io/docker/pulls/tmsoftbrasil/thinker?color=2496ED&label=docker%20pulls" alt="Docker pulls" /></a>
  &nbsp;
  <a href="https://hub.docker.com/r/tmsoftbrasil/thinker/tags"><img src="https://img.shields.io/docker/image-size/tmsoftbrasil/thinker/latest?color=2496ED&label=image%20size" alt="Tamanho da imagem Docker" /></a>
  &nbsp;
  <a href="https://github.com/patrickbrandao/thinker/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/patrickbrandao/thinker/ci.yml?branch=main&label=CI" alt="Status da CI" /></a>
  &nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/github/license/patrickbrandao/thinker?color=blue" alt="Licença" /></a>
</p>

## O que é o Thinker

O Thinker fica entre os seus agentes de IA (os "harnesses": Claude Code, Codex, OpenCode, OpenClaw, Hermes, aplicações com SDK) e os provedores de inferência (chaves de API, assinaturas, modelos locais, endpoints customizados). Ele expõe um endpoint compatível com OpenAI e Anthropic, escolhe o modelo certo para cada requisição e registra custo, tokens e o corpo completo de cada chamada.

- **Roteamento:** chaves de API, assinaturas, modelos locais e provedores customizados, com tiers por complexidade da requisição.
- **Fallback:** quando uma tentativa falha, o Thinker tenta os modelos de reserva configurados.
- **Registro completo:** corpo de requisições e respostas, de sucesso e de erro, com retenção de 30 dias por padrão.
- **Custos:** tokens e custo por requisição, por harness, provedor e modelo, com limites e notificações.
- **Sem phone-home:** o produto não envia telemetria nem verifica atualizações. Veja [Privacidade](docs/usuario/privacidade.md).

## Início rápido

O Thinker é distribuído como [imagem Docker](https://hub.docker.com/r/tmsoftbrasil/thinker) (`linux/amd64` e `linux/arm64`). O caminho oficial de instalação é Docker/Compose.

```bash
bash <(curl -sSL https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/install.sh)
```

O instalador baixa o `docker-compose.yml`, gera `BETTER_AUTH_SECRET` e `THINKER_ENCRYPTION_KEY` e sobe a stack em `~/thinker`. Depois:

1. Abra [http://localhost:2099/setup](http://localhost:2099/setup).
2. O cadastro público é fechado. O primeiro administrador exige o **token de setup** impresso no log:

   ```bash
   cd ~/thinker && docker compose logs thinker | grep 'setup token'
   ```

3. Conecte um provedor, crie um harness (agente) e copie a chave `thk_`. Veja [Primeiros passos](docs/usuario/primeiros-passos.md).

Instalação manual com Compose, porta, proxy reverso e backup: [Instalação com Docker](docs/usuario/instalacao-docker.md).

## Harnesses suportados

| Harness | Superfície | Guia |
| --- | --- | --- |
| Claude Code | Anthropic Messages (`/v1/messages`) | [Conectar harnesses](docs/usuario/conectar-harnesses.md#claude-code) |
| Codex | OpenAI Responses (`/v1/responses`) | [Conectar harnesses](docs/usuario/conectar-harnesses.md#codex) |
| OpenCode | Chat Completions (`/v1/chat/completions`) | [Conectar harnesses](docs/usuario/conectar-harnesses.md#opencode) |
| OpenClaw, Hermes, Nanobot, Craft | Chat Completions | [Conectar harnesses](docs/usuario/conectar-harnesses.md#openclaw-e-hermes) |
| SDKs (OpenAI, Anthropic, Vercel AI SDK, LangChain), n8n, cURL | Chat Completions, Messages ou Responses | [Conectar harnesses](docs/usuario/conectar-harnesses.md#sdks) |

## Provedores

O Thinker conecta dezenas de provedores embutidos e qualquer endpoint customizado compatível com OpenAI ou Anthropic. Use sua chave de API, reaproveite uma assinatura paga ou rode modelos localmente. Envie `"model": "auto"` e o Thinker escolhe o modelo. Os catálogos são descobertos quando as credenciais são conectadas; a tabela abaixo é representativa, não exaustiva.

| Provedor | API key / local | Assinatura | Catálogo de modelos |
| --- | :---: | :--- | --- |
| [**OpenAI**](https://platform.openai.com/)                                               |       ✅        | ✅ ChatGPT Plus / Pro / Team | GPT-5.6 (Sol / Terra / Luna), GPT-5.5, GPT-5.4, Codex, o-series |
| [**Anthropic**](https://www.anthropic.com/)                                              |       ✅        | ✅ Claude Max / Pro          | Claude Opus 5, Sonnet 5, Fable 5, Haiku 4.5                     |
| [**Google**](https://ai.google.dev/)                                                     |       ✅        | ✅ Sign in with Google       | Gemini 3.5 Flash, 3.1 Flash-Lite, Gemini 2.5                    |
| [**Google Vertex AI**](https://cloud.google.com/vertex-ai)                               |       ✅        | —                            | Gemini models via Vertex AI                                     |
| [**Meta**](https://www.meta.ai/)                                                         |       ✅        | —                            | Muse Spark 1.2 / 1.1 + Contributor route (Meta Model API)       |
| [**xAI**](https://x.ai/)                                                                 |       ✅        | ✅ Grok subscription         | Grok 4.5, Grok 4.3, Grok Build, Grok 4.20                       |
| [**AWS Bedrock**](https://aws.amazon.com/bedrock/)                                       |       ✅        | —                            | Claude, GPT, Kimi, MiniMax, Nemotron, Nova via Bedrock          |
| [**Alibaba Cloud / Qwen**](https://www.alibabacloud.com/en/solutions/generative-ai/qwen) |       ✅        | ✅ Qwen Token Plan           | Qwen 3.7 Max / Plus / Flash, DeepSeek, Kimi, GLM                |
| [**DeepSeek**](https://www.deepseek.com/)                                                |       ✅        | —                            | DeepSeek V4 Pro, V4 Flash, V3.2, R1                             |
| [**Mistral**](https://mistral.ai/)                                                       |       ✅        | ✅ Mistral Vibe              | Mistral Large, Medium 3.5, Devstral, Codestral                  |
| [**Moonshot** (Kimi)](https://kimi.ai/)                                                  |       ✅        | ✅ Kimi Coding Plan          | Kimi K3, K2.7 Code, Kimi for Coding                             |
| [**MiniMax**](https://www.minimax.io/)                                                   |       ✅        | ✅ MiniMax Coding Plan       | MiniMax M3, M2.7, M2.5                                          |
| [**Xiaomi MiMo**](https://platform.xiaomimimo.com/)                                      |       ✅        | ✅ MiMo Token Plan           | MiMo V2.5 Pro, V2.5, Flash                                      |
| [**Z.ai**](https://z.ai/)                                                                |       ✅        | ✅ GLM Coding Plan           | GLM 5.2, GLM 5.1, GLM 5 Turbo                                   |
| [**BytePlus**](https://www.byteplus.com/en/activity/codingplan)                          |        —        | ✅ ModelArk Coding Plan      | Ark Code, Seed Code, GLM, Kimi, DeepSeek, GPT-OSS               |
| [**GitHub Copilot**](https://github.com/features/copilot)                                |        —        | ✅ Copilot subscription      | Claude, GPT, Gemini, Grok via Copilot                           |
| [**Kiro**](https://kiro.dev/)                                                            |        —        | ✅ Kiro subscription         | `kiro/auto`, Claude, DeepSeek, MiniMax, GLM, Qwen               |
| [**Command Code**](https://commandcode.ai/studio)                                        |        —        | ✅ Command Code subscription | Claude, DeepSeek V4, Qwen 3.7, Gemini, Kimi                     |
| [**ClinePass**](https://app.cline.bot/)                                                  |        —        | ✅ ClinePass subscription    | `cline-pass/glm-5.2`, Kimi, DeepSeek, MiMo, MiniMax, Qwen       |
| [**NousResearch**](https://portal.nousresearch.com/)                                     |        —        | ✅ NousResearch subscription | NousResearch Portal model catalog                               |
| [**OpenCode Go**](https://opencode.ai/)                                                  |        —        | ✅ OpenCode Go               | DeepSeek V4, Qwen 3.7, GLM, Kimi, MiMo                          |
| [**Ollama / Ollama Cloud**](https://ollama.com/)                                         |    🖥️ Local     | ✅ Ollama Cloud              | Local tags: Llama, Qwen, Gemma. Cloud: DeepSeek V4, GLM, Kimi   |
| [**LM Studio**](https://lmstudio.ai/)                                                    |    🖥️ Local     | —                            | Modelos GGUF locais, porta `1234`                                  |
| [**llama.cpp**](https://github.com/ggml-org/llama.cpp)                                   |    🖥️ Local     | —                            | Modelos GGUF locais, porta `8080`                                  |
| [**OpenRouter**](https://openrouter.ai/)                                                 |       ✅        | —                            | 300+ models across labs                                         |
| [**OpenCode Zen**](https://opencode.ai/)                                                 |       ✅        | —                            | Curated Claude, GPT, DeepSeek, MiMo, Nemotron                   |
| [**Kilo**](https://kilo.ai/)                                                             |       ✅        | —                            | Kilo Gateway catalog                                            |
| [**Cerebras**](https://www.cerebras.ai/)                                                 |       ✅        | —                            | GPT-OSS, GLM, Gemma on Cerebras inference                       |
| [**Fireworks AI**](https://fireworks.ai/)                                                |       ✅        | —                            | DeepSeek V4, Kimi K2.7, Qwen 3.7, Nemotron                      |
| [**Groq**](https://groq.com/)                                                            |       ✅        | —                            | Llama 4, Qwen 3.6, GPT-OSS, Gemma                               |
| [**Hugging Face**](https://huggingface.co/docs/inference-providers/)                     |       ✅        | —                            | Open models through Hugging Face Inference Providers            |
| [**NVIDIA NIM**](https://build.nvidia.com/)                                              |       ✅        | —                            | Nemotron 3, GLM, Kimi, MiniMax, Qwen                            |
| [**Pioneer**](https://pioneer.ai/)                                                       |       ✅        | —                            | OpenAI-compatible and fine-tuned Pioneer models                 |
| **Custom**                                                                               |       ✅        | —                            | Qualquer endpoint `/v1/chat/completions` ou `/v1/messages`           |

Detalhes de configuração: [Provedores e roteamento](docs/usuario/provedores-e-roteamento.md) e [Provedores por assinatura](docs/providers/subscription-based-providers.md).

## Documentação

- [Instalação com Docker](docs/usuario/instalacao-docker.md)
- [Configuração (variáveis de ambiente)](docs/usuario/configuracao.md)
- [Primeiros passos](docs/usuario/primeiros-passos.md)
- [Conectar harnesses](docs/usuario/conectar-harnesses.md)
- [Provedores e roteamento](docs/usuario/provedores-e-roteamento.md)
- [Organizações, papéis e contas](docs/usuario/organizacoes.md)
- [CLI `thinker`](docs/usuario/cli.md)
- [Solução de problemas](docs/usuario/solucao-de-problemas.md) e [códigos de erro](docs/erros.md)
- [Privacidade e saída de rede](docs/usuario/privacidade.md)
- [Templates de deploy da comunidade](docs/usuario/deploy-comunidade.md) (não testados oficialmente)
- [Guia do desenvolvedor](docs/dev/guia.md), [decisões iniciais](docs/decisoes-iniciais.md) e [ADRs](docs/adr/)
- [Notas de release](docs/releases/)
- [Contribuindo](CONTRIBUTING.md) e [Discussions](https://github.com/patrickbrandao/thinker/discussions)

## Licença e atribuição

O Thinker é distribuído sob a licença [MIT](LICENSE).

O projeto nasceu de um snapshot de [mnfst/llm-gateway](https://github.com/mnfst/llm-gateway) (`manifest@6.28.6`, licença MIT, copyright MNFST, Inc.) e evolui de forma independente, sem obrigação de compatibilidade com o original.

O logo do Thinker é um desenho original, inspirado em um ícone de cérebro de terceiros: geometria, proporções e trilhas são próprias, e nenhum traço do ícone de referência foi reaproveitado. Detalhes em [Marca do Thinker](docs/marca.md).
