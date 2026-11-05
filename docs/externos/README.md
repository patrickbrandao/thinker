# Sistemas externos

O Thinker depende de regras que ele não controla e que mudam o tempo todo: provedores com acesso por API, provedores por assinatura, runtimes locais e harnesses. Cada um desses sistemas tem aqui um **dossiê**, a especificação que o agente principal usa para escrever código compatível, e um **agente pesquisador** dedicado, que mantém o dossiê alinhado com a fonte da verdade (site e API do provedor, repositório do harness, notas de versão).

## Como funciona

- **Um agente por entidade.** Uma entidade é uma forma de acesso a um provedor (`api-opencode` e `sub-opencode-go` são entidades distintas), um runtime local (`local-lmstudio`) ou um harness (`harness-claude-code`). O agente fica em `.claude/agents/<agente>.md` e guarda as fontes da verdade e o foco daquela entidade.
- **Um procedimento comum.** Todos seguem [`.claude/external-research.md`](../../.claude/external-research.md): limites, ordem de autoridade das fontes, checklist por categoria, análise de lacunas e formato das issues.
- **Entrega.** O pesquisador reescreve o dossiê (contrato atual, estado do Thinker, lacunas) e abre uma issue `externo` por lacuna relevante, com título `[externo:<agente>] G<n>: ...`. Ele não altera código de produto e não faz commit: quem acionou revisa o diff do dossiê e publica.

## Como acionar

- **Uma entidade:** peça na sessão principal, por exemplo "rode o `local-lmstudio`" ou "pesquise o `sub-opencode-go`".
- **Várias:** "rode os pesquisadores de assinatura" ou "revise os dossiês com mais de 30 dias". O Principal dispara os agentes em paralelo, consolida os relatórios e publica os dossiês num único commit `docs(externos): ...`.
- **Antes de uma feature:** ao pedir algo que toca um sistema externo, o Principal lê o dossiê dele primeiro. Se o dossiê é um esqueleto, tem mais de 30 dias ou não responde à dúvida, ele aciona o pesquisador antes de implementar.

## Estrutura do dossiê

Cada arquivo em `api/`, `assinatura/`, `local/` e `harness/` tem as mesmas seções:

1. **Resumo**: o essencial em poucas linhas.
2. **Fontes da verdade**: links e a última versão, commit ou data conferida (o corte da próxima revisão).
3. **Contrato**: o comportamento atual do sistema externo, com fonte para cada fato. As subseções seguem o checklist da categoria.
4. **Como o Thinker implementa hoje**: valores concretos com `arquivo:linha`.
5. **Lacunas**: diferenças entre o contrato e o código, com severidade (`quebra`, `degradação`, `oportunidade`), agente dono, issue e status.
6. **Histórico**: uma linha por revisão.

O frontmatter traz `revisado_em` e `versao_observada`; `revisado_em: null` indica um esqueleto ainda não pesquisado.

## Adicionar uma entidade

1. Copie o agente de uma entidade da mesma categoria para `.claude/agents/<prefixo>-<id>.md` (prefixos `api-`, `sub-`, `local-`, `harness-`) e troque nome, fontes, foco e agentes relacionados.
2. Copie o dossiê correspondente para `docs/externos/<categoria>/<prefixo>-<id>.md`, zere o contrato, as lacunas e o histórico e preencha o estado atual do código.
3. Adicione a linha na tabela abaixo.

## Índice

Cada pesquisador atualiza a própria linha (data da revisão e lacunas abertas).

| Agente | Categoria | Entidade | IDs no Thinker | Dossiê | Revisado em | Lacunas abertas |
|---|---|---|---|---|---|---|
| `api-anthropic` | API | Anthropic | `anthropic` | [dossiê](api/api-anthropic.md) | 2026-11-04 | 0 |
| `api-bedrock` | API | AWS Bedrock | `bedrock` | [dossiê](api/api-bedrock.md) | 2026-11-04 | 5 |
| `api-vertex` | API | Google Vertex AI | `vertex` | [dossiê](api/api-vertex.md) | 2026-11-04 | 2 |
| `api-byteplus` | API | BytePlus ModelArk | `byteplus` | [dossiê](api/api-byteplus.md) | 2026-11-04 | 2 |
| `api-cerebras` | API | Cerebras | `cerebras` | [dossiê](api/api-cerebras.md) | 2026-11-04 | 2 |
| `api-deepseek` | API | DeepSeek | `deepseek` | [dossiê](api/api-deepseek.md) | 2026-11-04 | 2 |
| `api-fireworks` | API | Fireworks AI | `fireworks` | [dossiê](api/api-fireworks.md) | 2026-11-04 | 4 |
| `api-groq` | API | Groq | `groq` | [dossiê](api/api-groq.md) | 2026-11-04 | 0 |
| `api-huggingface` | API | Hugging Face Inference Providers | `huggingface` | [dossiê](api/api-huggingface.md) | 2026-11-04 | 4 |
| `api-kilo` | API | Kilo Gateway | `kilo` | [dossiê](api/api-kilo.md) | 2026-11-04 | 3 |
| `api-gemini` | API | Google Gemini API | `gemini`, `google` | [dossiê](api/api-gemini.md) | 2026-11-04 | 1 |
| `api-minimax` | API | MiniMax | `minimax` | [dossiê](api/api-minimax.md) | 2026-11-04 | 4 |
| `api-meta` | API | Meta (Muse Spark) | `meta` | [dossiê](api/api-meta.md) | 2026-11-04 | 3 |
| `api-xiaomi` | API | Xiaomi MiMo | `xiaomi` | [dossiê](api/api-xiaomi.md) | 2026-11-04 | 5 |
| `api-mistral` | API | Mistral | `mistral` | [dossiê](api/api-mistral.md) | 2026-11-04 | 0 |
| `api-moonshot` | API | Moonshot (Kimi API) | `moonshot` | [dossiê](api/api-moonshot.md) | 2026-11-04 | 2 |
| `api-nous` | API | NousResearch API | `nous` | [dossiê](api/api-nous.md) | 2026-11-04 | 2 |
| `api-nvidia` | API | NVIDIA NIM | `nvidia` | [dossiê](api/api-nvidia.md) | 2026-11-04 | 2 |
| `api-openai` | API | OpenAI | `openai` | [dossiê](api/api-openai.md) | 2026-11-04 | 1 |
| `api-pioneer` | API | Pioneer | `pioneer` | [dossiê](api/api-pioneer.md) | 2026-11-04 | 2 |
| `api-opencode` | API | OpenCode (API: paid and free models) | `opencode` | [dossiê](api/api-opencode.md) | 2026-11-03 | 3 |
| `api-openrouter` | API | OpenRouter | `openrouter` | [dossiê](api/api-openrouter.md) | 2026-11-04 | 5 |
| `api-xai` | API | xAI | `xai` | [dossiê](api/api-xai.md) | 2026-11-04 | 3 |
| `api-zai` | API | Z.ai | `zai` | [dossiê](api/api-zai.md) | 2026-11-04 | 3 |
| `api-qwen` | API | Alibaba Cloud (Qwen / Model Studio) | `qwen` | [dossiê](api/api-qwen.md) | 2026-11-04 | 6 |
| `sub-anthropic` | Assinatura | Claude Max / Pro | `anthropic` | [dossiê](assinatura/sub-anthropic.md) | 2026-11-03 | 4 |
| `sub-byteplus` | Assinatura | BytePlus ModelArk Coding Plan | `byteplus` | [dossiê](assinatura/sub-byteplus.md) | 2026-11-03 | 2 |
| `sub-openai` | Assinatura | ChatGPT Plus / Pro / Team (Codex) | `openai` | [dossiê](assinatura/sub-openai.md) | 2026-11-03 | 3 |
| `sub-minimax` | Assinatura | MiniMax Coding Plan | `minimax` | [dossiê](assinatura/sub-minimax.md) | 2026-11-03 | 3 |
| `sub-mistral` | Assinatura | Mistral Vibe | `mistral` | [dossiê](assinatura/sub-mistral.md) | 2026-11-03 | 3 |
| `sub-xiaomi` | Assinatura | Xiaomi MiMo Token Plan | `xiaomi` | [dossiê](assinatura/sub-xiaomi.md) | 2026-11-03 | 3 |
| `sub-qwen` | Assinatura | Qwen Token Plan | `qwen` | [dossiê](assinatura/sub-qwen.md) | 2026-11-03 | 3 |
| `sub-moonshot` | Assinatura | Kimi Coding Plan | `moonshot` | [dossiê](assinatura/sub-moonshot.md) | 2026-11-03 | 2 |
| `sub-nous` | Assinatura | NousResearch subscription | `nous` | [dossiê](assinatura/sub-nous.md) | 2026-11-03 | 5 |
| `sub-ollama-cloud` | Assinatura | Ollama Cloud | `ollama-cloud` | [dossiê](assinatura/sub-ollama-cloud.md) | 2026-11-03 | 3 |
| `sub-kiro` | Assinatura | Kiro | `kiro` | [dossiê](assinatura/sub-kiro.md) | 2026-11-03 | 3 |
| `sub-zai` | Assinatura | GLM Coding Plan | `zai` | [dossiê](assinatura/sub-zai.md) | 2026-11-03 | 2 |
| `sub-opencode-go` | Assinatura | OpenCode Go | `opencode-go` | [dossiê](assinatura/sub-opencode-go.md) | 2026-11-03 | 4 |
| `sub-opencode` | Assinatura | OpenCode Console | `opencode` | [dossiê](assinatura/sub-opencode.md) | 2026-11-03 | 4 |
| `sub-gemini` | Assinatura | Sign in with Google (Gemini Code Assist) | `gemini` | [dossiê](assinatura/sub-gemini.md) | 2026-11-03 | 3 |
| `sub-xai` | Assinatura | Grok subscription | `xai` | [dossiê](assinatura/sub-xai.md) | 2026-11-03 | 3 |
| `sub-copilot` | Assinatura | GitHub Copilot | `copilot` | [dossiê](assinatura/sub-copilot.md) | 2026-11-03 | 6 |
| `sub-commandcode` | Assinatura | Command Code | `commandcode` | [dossiê](assinatura/sub-commandcode.md) | 2026-11-03 | 4 |
| `sub-cline-pass` | Assinatura | ClinePass | `cline-pass` | [dossiê](assinatura/sub-cline-pass.md) | 2026-11-03 | 4 |
| `local-lmstudio` | Local | LM Studio | `lmstudio` | [dossiê](local/local-lmstudio.md) | 2026-11-03 | 4 |
| `local-ollama` | Local | Ollama | `ollama` | [dossiê](local/local-ollama.md) | 2026-11-04 | 2 |
| `local-llamacpp` | Local | llama.cpp (llama-server) | `llamacpp` | [dossiê](local/local-llamacpp.md) | 2026-11-04 | 5 |
| `harness-claude-code` | Harness | Claude Code | `claude-code` | [dossiê](harness/harness-claude-code.md) | 2026-11-03 | 4 |
| `harness-opencode` | Harness | OpenCode | `opencode` | [dossiê](harness/harness-opencode.md) | 2026-11-03 | 3 |
| `harness-codex` | Harness | Codex CLI | `codex` | [dossiê](harness/harness-codex.md) | 2026-11-03 | 4 |
| `harness-openclaw` | Harness | OpenClaw | `openclaw` | [dossiê](harness/harness-openclaw.md) | 2026-11-03 | 4 |
| `harness-hermes` | Harness | Hermes Agent | `hermes` | [dossiê](harness/harness-hermes.md) | 2026-11-03 | 2 |
| `harness-nanobot` | Harness | Nanobot | `nanobot` | [dossiê](harness/harness-nanobot.md) | 2026-11-03 | 2 |
| `harness-craft` | Harness | Craft Agent | `craft` | [dossiê](harness/harness-craft.md) | 2026-11-03 | 4 |
| `harness-claude-app` | Harness | Claude (desktop app) | `claude-app` | [dossiê](harness/harness-claude-app.md) | 2026-11-03 | 4 |
| `harness-n8n` | Harness | n8n | `n8n` | [dossiê](harness/harness-n8n.md) | 2026-11-03 | 3 |
| `harness-zapier` | Harness | Zapier | `zapier` | [dossiê](harness/harness-zapier.md) | 2026-11-03 | 2 |
| `harness-langflow` | Harness | Langflow | `langflow` | [dossiê](harness/harness-langflow.md) | 2026-11-03 | 4 |
| `harness-chatwoot` | Harness | Chatwoot | `chatwoot` | [dossiê](harness/harness-chatwoot.md) | 2026-11-03 | 5 |
| `harness-open-webui` | Harness | Open WebUI | `open-webui` | [dossiê](harness/harness-open-webui.md) | 2026-11-03 | 3 |
| `harness-deepseek-harness` | Harness | DeepSeek Harness | `deepseek-harness` | [dossiê](harness/harness-deepseek-harness.md) | 2026-11-03 | 4 |
| `harness-pi` | Harness | Agent Pi | `pi` | [dossiê](harness/harness-pi.md) | 2026-11-03 | 3 |
| `harness-cline` | Harness | Cline | `cline` | [dossiê](harness/harness-cline.md) | 2026-11-03 | 2 |
| `harness-copilot-cli` | Harness | Copilot CLI | `copilot-cli` | [dossiê](harness/harness-copilot-cli.md) | 2026-11-03 | 3 |
| `harness-openai-sdk` | Harness | OpenAI SDK | `openai-sdk` | [dossiê](harness/harness-openai-sdk.md) | 2026-11-03 | 6 |
| `harness-anthropic-sdk` | Harness | Anthropic SDK | `anthropic-sdk` | [dossiê](harness/harness-anthropic-sdk.md) | 2026-11-03 | 6 |
| `harness-vercel-ai-sdk` | Harness | Vercel AI SDK | `vercel-ai-sdk` | [dossiê](harness/harness-vercel-ai-sdk.md) | 2026-11-03 | 4 |
| `harness-langchain` | Harness | LangChain | `langchain` | [dossiê](harness/harness-langchain.md) | 2026-11-03 | 3 |
