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
3. **Contrato**: o comportamento atual do sistema externo, com fonte para cada fato. As subseções seguem o checklist da categoria e a última é sempre `### Formato na rede` (abaixo).
4. **Como o Thinker implementa hoje**: valores concretos com `arquivo:linha`.
5. **Lacunas**: diferenças entre o contrato e o código, com severidade (`quebra`, `degradação`, `oportunidade`), agente dono, issue e status.
6. **Histórico**: uma linha por revisão.

O frontmatter traz `revisado_em` e `versao_observada`; `revisado_em: null` indica um esqueleto ainda não pesquisado.

## Formato na rede

A estrutura de pedido e resposta de cada API fica num lugar fixo: a subseção `### Formato na rede`, no fim do "Contrato" de cada dossiê. Para responder "como vem um `function_call` da Responses", "como a Anthropic devolve `tool_use` paralelos" ou "quais são os eventos do SSE", basta abrir o dossiê da entidade e ir a essa subseção.

**Protocolos base.** Quatro protocolos têm uma seção canônica, completa, mantida por um dossiê só. Os demais dossiês registram apenas as **diferenças** e apontam para ela:

| Protocolo | Seção canônica | Estado |
|---|---|---|
| OpenAI Chat Completions (`/v1/chat/completions`) | [api-openai](api/api-openai.md#formato-na-rede) | doc+sonda (2026-11-15) |
| OpenAI Responses (`/v1/responses`) | [api-openai](api/api-openai.md#formato-na-rede) | doc+sonda (2026-11-15) |
| Anthropic Messages (`/v1/messages`) | [api-anthropic](api/api-anthropic.md#formato-na-rede) | doc+sonda (2026-11-15) |
| Gemini `generateContent` / `streamGenerateContent` | [api-gemini](api/api-gemini.md#formato-na-rede) | doc+sonda (2026-11-15) |

Superfícies que não seguem nenhum protocolo base (event stream do Kiro, envelope do Gemini Code Assist, NDJSON nativo do Ollama) têm a estrutura completa no próprio dossiê.

**Conteúdo.** Um bloco `#### <MÉTODO> <caminho> (<protocolo>)` por superfície, em tabela `Item | Formato | Fonte | Ao vivo`, com as linhas Pedido, Resposta, Uso, Stream, Ferramentas (definição, escolha, chamada e formato do id, chamadas paralelas, resultado e como se liga ao id, regras de ordem), Raciocínio e Erro. Nos harnesses o bloco diz o que o harness envia além do protocolo base e o que ele exige na resposta.

**Proveniência.** Cada linha diz de onde vem e se foi vista na rede:

| Coluna | Valor | Significado |
|---|---|---|
| Fonte | `doc <URL> (<data>)` | Documentação ou manual oficial, com a data da leitura |
| Fonte | `sdk <repo>@<tag> <arquivo>` ou `openapi <repo>@<commit>` | Código do SDK oficial ou especificação OpenAPI numa versão exata |
| Fonte | `(não confirmado)` | Só relato da comunidade |
| Ao vivo | `sonda <data>` | Chamada sem credencial feita pelo pesquisador (formato do 401, catálogo público) |
| Ao vivo | `captura <arquivo> (<data>)` | Tráfego real gravado pelo Thinker e versionado em `capturas/` |
| Ao vivo | `não verificado em produção` | Só fontes escritas; é o padrão |

Quando a captura contradiz a documentação, vale o observado para o tráfego atual; os testes e mocks do próprio Thinker não contam como prova do comportamento do provedor.

**O que "teste no provedor" pode ser.** Os pesquisadores não têm chaves nem contas, então o único teste ao vivo que fazem é a `sonda`: um `GET` em endpoint público ou uma única chamada **sem credencial** a um endpoint de inferência, para registrar o formato do erro de autenticação e os cabeçalhos. Tudo o que exige resposta real do modelo (stream, ferramentas, raciocínio, erro de cota) é uma `captura`, e só o mantenedor pode fazê-la. Cada pesquisador lista no relatório as capturas que faltam, como cenários concretos.

**Capturas.** Ficam em `capturas/<agente>/<AAAA-MM-DD>-<cenário>.json`, um cenário por arquivo. A origem é a gravação de tentativa que o Thinker já guarda (`StoredAttemptRecording`: `wire_format`, `request_body`, `response_body` com `body` ou `raw_sse`), copiada da visão Bruto do painel da requisição, mais um objeto `_captura` com entidade, superfície, modelo e data. Antes de versionar: nenhum cabeçalho nem credencial; textos de prompt, de ferramenta e do modelo trocados por marcadores curtos, mantendo tipos, ordem dos campos e o enquadramento do SSE; ids com o prefixo e o tamanho mantidos e o resto embaralhado; sem imagens ou arquivos. O procedimento completo está em [`.claude/external-research.md`](../../.claude/external-research.md#wire-format).

**Leitura rápida.** Abra o dossiê da entidade em `### Formato na rede`. Se o bloco diz "diferenças em relação a X", leia também a seção canônica de X. Se diz `Pendente`, o dossiê não responde: acione o pesquisador antes de mudar o adaptador. A coluna "Formato na rede" do índice mostra o estado de cada dossiê sem abri-lo.

## Adicionar uma entidade

1. Copie o agente de uma entidade da mesma categoria para `.claude/agents/<prefixo>-<id>.md` (prefixos `api-`, `sub-`, `local-`, `harness-`) e troque nome, fontes, foco e agentes relacionados.
2. Copie o dossiê correspondente para `docs/externos/<categoria>/<prefixo>-<id>.md`, zere o contrato (deixando `### Formato na rede` com a linha `Pendente`), as lacunas e o histórico e preencha o estado atual do código.
3. Adicione a linha na tabela abaixo.

## Índice

Cada pesquisador atualiza a própria linha (data da revisão, lacunas abertas e o nível de `### Formato na rede`: `pendente`, `doc`, `doc+sonda` ou `doc+captura`).

| Agente | Categoria | Entidade | IDs no Thinker | Dossiê | Revisado em | Lacunas abertas | Formato na rede |
|---|---|---|---|---|---|---|---|
| `api-anthropic` | API | Anthropic | `anthropic` | [dossiê](api/api-anthropic.md) | 2026-11-04 | 0 | doc+sonda |
| `api-atlascloud` | API | Atlas Cloud | `atlascloud` | [dossiê](api/api-atlascloud.md) | 2026-11-12 | 4 | pendente |
| `api-bedrock` | API | AWS Bedrock | `bedrock` | [dossiê](api/api-bedrock.md) | 2026-11-04 | 3 | pendente |
| `api-vertex` | API | Google Vertex AI | `vertex` | [dossiê](api/api-vertex.md) | 2026-11-04 | 2 | pendente |
| `api-byteplus` | API | BytePlus ModelArk | `byteplus` | [dossiê](api/api-byteplus.md) | 2026-11-04 | 1 | pendente |
| `api-cerebras` | API | Cerebras | `cerebras` | [dossiê](api/api-cerebras.md) | 2026-11-04 | 2 | pendente |
| `api-deepseek` | API | DeepSeek | `deepseek` | [dossiê](api/api-deepseek.md) | 2026-11-04 | 2 | pendente |
| `api-edenai` | API | Eden AI | `edenai` | [dossiê](api/api-edenai.md) | 2026-11-12 | 4 | pendente |
| `api-fireworks` | API | Fireworks AI | `fireworks` | [dossiê](api/api-fireworks.md) | 2026-11-04 | 4 | pendente |
| `api-groq` | API | Groq | `groq` | [dossiê](api/api-groq.md) | 2026-11-04 | 0 | pendente |
| `api-huggingface` | API | Hugging Face Inference Providers | `huggingface` | [dossiê](api/api-huggingface.md) | 2026-11-04 | 4 | pendente |
| `api-kilo` | API | Kilo Gateway | `kilo` | [dossiê](api/api-kilo.md) | 2026-11-04 | 3 | pendente |
| `api-gemini` | API | Google Gemini API | `gemini`, `google` | [dossiê](api/api-gemini.md) | 2026-11-04 (formato na rede 2026-11-15) | 7 | doc+sonda |
| `api-minimax` | API | MiniMax | `minimax` | [dossiê](api/api-minimax.md) | 2026-11-04 | 4 | pendente |
| `api-meta` | API | Meta (Muse Spark) | `meta` | [dossiê](api/api-meta.md) | 2026-11-04 | 3 | pendente |
| `api-xiaomi` | API | Xiaomi MiMo | `xiaomi` | [dossiê](api/api-xiaomi.md) | 2026-11-04 | 5 | pendente |
| `api-mistral` | API | Mistral | `mistral` | [dossiê](api/api-mistral.md) | 2026-11-04 | 0 | pendente |
| `api-moonshot` | API | Moonshot (Kimi API) | `moonshot` | [dossiê](api/api-moonshot.md) | 2026-11-04 | 2 | pendente |
| `api-nous` | API | NousResearch API | `nous` | [dossiê](api/api-nous.md) | 2026-11-04 | 2 | pendente |
| `api-nvidia` | API | NVIDIA NIM | `nvidia` | [dossiê](api/api-nvidia.md) | 2026-11-04 | 2 | pendente |
| `api-openai` | API | OpenAI | `openai` | [dossiê](api/api-openai.md) | 2026-11-15 | 3 | doc+sonda |
| `api-pioneer` | API | Pioneer | `pioneer` | [dossiê](api/api-pioneer.md) | 2026-11-04 | 2 | pendente |
| `api-opencode` | API | OpenCode (API: paid and free models) | `opencode` | [dossiê](api/api-opencode.md) | 2026-11-18 | 4 | pendente |
| `api-openrouter` | API | OpenRouter | `openrouter` | [dossiê](api/api-openrouter.md) | 2026-11-18 | 6 | pendente |
| `api-requesty` | API | Requesty | `requesty` | [dossiê](api/api-requesty.md) | 2026-11-12 | 4 | pendente |
| `api-xai` | API | xAI | `xai` | [dossiê](api/api-xai.md) | 2026-11-04 | 3 | pendente |
| `api-zai` | API | Z.ai | `zai` | [dossiê](api/api-zai.md) | 2026-11-04 | 2 | pendente |
| `api-qwen` | API | Alibaba Cloud (Qwen / Model Studio) | `qwen` | [dossiê](api/api-qwen.md) | 2026-11-04 | 5 | pendente |
| `sub-anthropic` | Assinatura | Claude Max / Pro | `anthropic` | [dossiê](assinatura/sub-anthropic.md) | 2026-11-03 | 4 | pendente |
| `sub-byteplus` | Assinatura | BytePlus ModelArk Coding Plan | `byteplus` | [dossiê](assinatura/sub-byteplus.md) | 2026-11-03 | 2 | pendente |
| `sub-openai` | Assinatura | ChatGPT Plus / Pro / Team (Codex) | `openai` | [dossiê](assinatura/sub-openai.md) | 2026-11-03 | 1 | pendente |
| `sub-minimax` | Assinatura | MiniMax Coding Plan | `minimax` | [dossiê](assinatura/sub-minimax.md) | 2026-11-03 | 3 | pendente |
| `sub-mistral` | Assinatura | Mistral Vibe | `mistral` | [dossiê](assinatura/sub-mistral.md) | 2026-11-03 | 2 | pendente |
| `sub-xiaomi` | Assinatura | Xiaomi MiMo Token Plan | `xiaomi` | [dossiê](assinatura/sub-xiaomi.md) | 2026-11-03 | 2 | pendente |
| `sub-qwen` | Assinatura | Qwen Token Plan | `qwen` | [dossiê](assinatura/sub-qwen.md) | 2026-11-03 | 3 | pendente |
| `sub-moonshot` | Assinatura | Kimi Coding Plan | `moonshot` | [dossiê](assinatura/sub-moonshot.md) | 2026-11-03 | 2 | pendente |
| `sub-nous` | Assinatura | NousResearch subscription | `nous` | [dossiê](assinatura/sub-nous.md) | 2026-11-03 | 4 | pendente |
| `sub-ollama-cloud` | Assinatura | Ollama Cloud | `ollama-cloud` | [dossiê](assinatura/sub-ollama-cloud.md) | 2026-11-03 | 3 | pendente |
| `sub-kiro` | Assinatura | Kiro | `kiro` | [dossiê](assinatura/sub-kiro.md) | 2026-11-03 | 3 | pendente |
| `sub-zai` | Assinatura | GLM Coding Plan | `zai` | [dossiê](assinatura/sub-zai.md) | 2026-11-03 | 2 | pendente |
| `sub-opencode-go` | Assinatura | OpenCode Go | `opencode-go` | [dossiê](assinatura/sub-opencode-go.md) | 2026-11-03 | 4 | pendente |
| `sub-opencode` | Assinatura | OpenCode Console | `opencode` | [dossiê](assinatura/sub-opencode.md) | 2026-11-03 | 3 | pendente |
| `sub-gemini` | Assinatura | Sign in with Google (Gemini Code Assist) | `gemini` | [dossiê](assinatura/sub-gemini.md) | 2026-11-03 | 2 | pendente |
| `sub-xai` | Assinatura | Grok subscription | `xai` | [dossiê](assinatura/sub-xai.md) | 2026-11-03 | 2 | pendente |
| `sub-copilot` | Assinatura | GitHub Copilot | `copilot` | [dossiê](assinatura/sub-copilot.md) | 2026-11-03 | 4 | pendente |
| `sub-commandcode` | Assinatura | Command Code | `commandcode` | [dossiê](assinatura/sub-commandcode.md) | 2026-11-03 | 4 | pendente |
| `sub-cline-pass` | Assinatura | ClinePass | `cline-pass` | [dossiê](assinatura/sub-cline-pass.md) | 2026-11-03 | 4 | pendente |
| `local-lmstudio` | Local | LM Studio | `lmstudio` | [dossiê](local/local-lmstudio.md) | 2026-11-03 | 3 | pendente |
| `local-ollama` | Local | Ollama | `ollama` | [dossiê](local/local-ollama.md) | 2026-11-04 | 1 | pendente |
| `local-llamacpp` | Local | llama.cpp (llama-server) | `llamacpp` | [dossiê](local/local-llamacpp.md) | 2026-11-04 | 3 | pendente |
| `harness-claude-code` | Harness | Claude Code | `claude-code` | [dossiê](harness/harness-claude-code.md) | 2026-11-03 | 4 | pendente |
| `harness-opencode` | Harness | OpenCode | `opencode` | [dossiê](harness/harness-opencode.md) | 2026-11-06 | 5 | pendente |
| `harness-codex` | Harness | Codex CLI | `codex` | [dossiê](harness/harness-codex.md) | 2026-11-03 | 3 | pendente |
| `harness-openclaw` | Harness | OpenClaw | `openclaw` | [dossiê](harness/harness-openclaw.md) | 2026-11-03 | 3 | pendente |
| `harness-hermes` | Harness | Hermes Agent | `hermes` | [dossiê](harness/harness-hermes.md) | 2026-11-06 | 1 | pendente |
| `harness-nanobot` | Harness | Nanobot | `nanobot` | [dossiê](harness/harness-nanobot.md) | 2026-11-03 | 2 | pendente |
| `harness-craft` | Harness | Craft Agent | `craft` | [dossiê](harness/harness-craft.md) | 2026-11-03 | 3 | pendente |
| `harness-claude-app` | Harness | Claude (desktop app) | `claude-app` | [dossiê](harness/harness-claude-app.md) | 2026-11-03 | 3 | pendente |
| `harness-n8n` | Harness | n8n | `n8n` | [dossiê](harness/harness-n8n.md) | 2026-11-03 | 2 | pendente |
| `harness-zapier` | Harness | Zapier | `zapier` | [dossiê](harness/harness-zapier.md) | 2026-11-03 | 1 | pendente |
| `harness-langflow` | Harness | Langflow | `langflow` | [dossiê](harness/harness-langflow.md) | 2026-11-03 | 3 | pendente |
| `harness-chatwoot` | Harness | Chatwoot | `chatwoot` | [dossiê](harness/harness-chatwoot.md) | 2026-11-03 | 2 | pendente |
| `harness-open-webui` | Harness | Open WebUI | `open-webui` | [dossiê](harness/harness-open-webui.md) | 2026-11-03 | 2 | pendente |
| `harness-deepseek-harness` | Harness | DeepSeek Harness | `deepseek-harness` | [dossiê](harness/harness-deepseek-harness.md) | 2026-11-17 | 6 | doc |
| `harness-pi` | Harness | Agent Pi | `pi` | [dossiê](harness/harness-pi.md) | 2026-11-03 | 2 | pendente |
| `harness-cline` | Harness | Cline | `cline` | [dossiê](harness/harness-cline.md) | 2026-11-03 | 2 | pendente |
| `harness-copilot-cli` | Harness | Copilot CLI | `copilot-cli` | [dossiê](harness/harness-copilot-cli.md) | 2026-11-03 | 2 | pendente |
| `harness-openai-sdk` | Harness | OpenAI SDK | `openai-sdk` | [dossiê](harness/harness-openai-sdk.md) | 2026-11-03 | 4 | pendente |
| `harness-anthropic-sdk` | Harness | Anthropic SDK | `anthropic-sdk` | [dossiê](harness/harness-anthropic-sdk.md) | 2026-11-03 | 3 | pendente |
| `harness-vercel-ai-sdk` | Harness | Vercel AI SDK | `vercel-ai-sdk` | [dossiê](harness/harness-vercel-ai-sdk.md) | 2026-11-03 | 2 | pendente |
| `harness-langchain` | Harness | LangChain | `langchain` | [dossiê](harness/harness-langchain.md) | 2026-11-03 | 3 | pendente |
