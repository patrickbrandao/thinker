# Parecer: o provedor "Claude Agent" do OpenCode como tipo de provedor no Thinker

- **Data:** 2026-11-06
- **Autor:** agente `harness-opencode` (pesquisa só em fontes públicas; nada foi executado com conta real)
- **Código analisado:** `anomalyco/opencode`, branch `dev`, commit [`4db59339e3fd1e959cd990da4205779a78b14c33`](https://github.com/anomalyco/opencode/tree/4db59339e3fd1e959cd990da4205779a78b14c33) (2026-11-06). O provedor saiu na v2.2.3 (#58782); a v2.2.5 é a última tag.
- **Spec:** [`specs/v2/claude-agent-provider.md`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/specs/v2/claude-agent-provider.md)
- **Dossiês relacionados:** [harness-opencode](../../externos/harness/harness-opencode.md) (G6), [sub-anthropic](../../externos/assinatura/sub-anthropic.md), [harness-claude-code](../../externos/harness/harness-claude-code.md)

Abreviação usada nos links: `CA/` = `packages/core/src/plugin/provider/claude-agent/` no commit acima.

## 1. Resumo executivo

**Veredito: viável com ressalvas.** Só vale como provedor opcional, desligado por padrão, para uso pessoal do dono da assinatura. Não serve para compartilhar uma assinatura entre usuários de uma organização.

- **A técnica.** O OpenCode não fala com a API da Anthropic. Ele inicia o `claude` (Claude Code) instalado na máquina pelo `@anthropic-ai/claude-agent-sdk`, com o login que o próprio Claude Code guarda. Desliga todas as ferramentas e configurações próprias do Claude Code, entrega as ferramentas do harness como um servidor MCP dentro do processo e **segura cada chamada de ferramenta**: o passo do OpenCode termina, o OpenCode executa a ferramenta e, na requisição seguinte, o resultado volta ao mesmo processo `claude`, que continua o mesmo turno. O loop de API é do Claude Code; quem executa as ferramentas é o OpenCode.
- **O que isso traria ao Thinker** em relação ao caminho atual (OAuth PKCE ou `setup-token` guardado no banco, mais imitação do Claude Code com user agent, betas e bloco de identidade):
  1. **Postura nos termos de uso.** A página de termos da Anthropic proíbe terceiros de coletar, guardar ou intermediar credenciais do Claude.ai. Ela ressalva o caso de um usuário que entra com a própria assinatura num binário oficial e não modificado do Claude Code, inclusive hospedado por uma plataforma. O caminho atual cai na proibição. O caminho com o Agent SDK pode caber na ressalva, desde que o Thinker nunca toque no token e cada usuário use a própria assinatura.
  2. **Fim da imitação.** Não há mais user agent, Stainless, betas e bloco de identidade a manter em dia: quem fala com a Anthropic é o binário oficial, que também renova o próprio token.
  3. **Uso do plano.** O SDK entrega `rate_limit_event` (janela, `resetsAt`, status de overage), o que fecha a lacuna G5 do `sub-anthropic`.
  4. **Não muda o limite.** O consumo sai do mesmo limite do plano que o Claude Code usa. Não há limite novo, e há relatos não confirmados de rendimento menor via SDK.
- **O custo é alto para um proxy sem estado.** São um processo `claude` por sessão de harness ativa (a Anthropic sugere 1 GiB de RAM por agente como ponto de partida), um binário de ~268 MB por arquitetura, estado em memória para as ferramentas seguradas e sincronização de histórico. Perdem-se `temperature`/`top_p`/`top_k`/`stop_sequences`, o controle de `cache_control` pelo cliente, o system prompt exato do harness e a gravação do corpo real enviado ao provedor.
- **Esforço total: L.** O MVP útil, com sessões fixas e ferramentas seguradas, já é L; um protótipo sem estado é M, mas degrada a qualidade.

## 2. Como a técnica funciona no OpenCode

### 2.1 Processo e ciclo de vida

- **Sim, inicia o Claude Code como subprocesso.** O SDK roda `query({ prompt, options })` com entrada em streaming (`ReadableStream<SDKUserMessage>`) e conversa com o CLI por stdio ([`CA/claude/session.ts:18-27`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/session.ts#L18-L27)). O executável é o `claude` do `PATH` ou de `OPENCODE_CLAUDE_PATH` ([`CA/claude/io.ts:21`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/io.ts#L21)), passado em `pathToClaudeCodeExecutable` ([`CA/claude/query-options.ts:58-60`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts#L58-L60)). O OpenCode nunca roda o binário que o SDK baixa.
- **Um processo longo por sessão do OpenCode.** Ele fecha após 5 min ocioso e espera 10 s de "handover" num reload ([`CA/claude/sessions.ts:24-25`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sessions.ts#L24-L25)). Enquanto há ferramenta esperando resultado, o processo não conta como ocioso ([`sessions.ts:336-339`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sessions.ts#L336-L339)).
- **Reinício** quando muda o que só vale na partida: saída máxima, conexão, system prompt e lista de ferramentas (chave `launch`, [`sessions.ts:72-73`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sessions.ts#L72-L73), e [`:376-381`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sessions.ts#L376-L381)). Modelo e esforço mudam com o processo vivo (`setModel`, `applyFlagSettings`, [`session.ts:159-160`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/session.ts#L159-L160)).
- **Chamadas avulsas** (título, por exemplo) usam um processo descartável, sem transcrição salva, e apagam a sessão ao fim ([`sessions.ts:326-335`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sessions.ts#L326-L335)).
- **Onde não há como iniciar processos** (OpenCode hospedado, workspace remoto), o plugin se desliga ([`CA/index.ts:24-28`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/index.ts#L24-L28)). No runtime workerd entra um stub que lança erro ([`CA/claude/agent-sdk.workerd.ts`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/agent-sdk.workerd.ts)).

### 2.2 Autenticação

- **O OpenCode não lê nem guarda credencial.** O método de login é do tipo `external` ("Claude Code login (claude auth login)") e só registra a escolha ([`CA/integration.ts:11-27`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/integration.ts#L11-L27)). O usuário entra com `claude auth login` no terminal.
- **Verificação sem gastar token.** Um processo é aberto sem enviar mensagem, e o OpenCode lê `initializationResult()`: versão, `account` e `models`. Para cada modelo, faz `setModel` + `getContextUsage` para obter a janela de contexto ([`CA/claude/probe.ts:44-109`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/probe.ts#L44-L109)). Conta logada: `tokenSource !== "none"` ou `apiKeySource` definido ([`probe.ts:111-113`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/probe.ts#L111-L113)). Exige Claude Code 2.1.248+ por causa de `verbatimPrompts`; a descoberta de contexto pede 2.1.257+ ([`probe.ts:22-24`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/probe.ts#L22-L24)).
- **Qualquer login do Claude Code serve:** assinatura, chave de API, Bedrock, Vertex ou Foundry. A config do provedor também pode passar `settings.apiKey`/`authToken`/`baseURL`, que viram `ANTHROPIC_*` ([`query-options.ts:30-51`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts#L30-L51)).
- **Variáveis limpas:** `CLAUDE_CODE_SIMPLE` (pularia o OAuth), `CLAUDE_CODE_EFFORT_LEVEL` e `MCP_TOOL_TIMEOUT` ([`query-options.ts:22-27`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts#L22-L27)).

### 2.3 Isolamento do Claude Code

Tudo é passado na partida; nada vem das configurações do usuário ([`query-options.ts:11-28`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts#L11-L28) e [`:53-73`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts#L53-L73)):

| Opção ou variável | Efeito |
|---|---|
| `settingSources: []`, `settings.disableAllHooks`, `strictMcpConfig`, `skills: []` | ignora `~/.claude`, `.claude` do projeto, hooks, MCP e skills do usuário |
| `tools: []` | **nenhuma ferramenta embutida** (Bash, Read, Edit...) |
| `allowedTools: ["mcp__opencode__*"]`, `permissionMode: "dontAsk"` | só as ferramentas do OpenCode; o resto é recusado sem perguntar |
| `verbatimPrompts: true` | sem expansão de `@arquivo`, sem `/comandos`, sem anexos automáticos no turno |
| `thinking: { type: "adaptive", display: "summarized" }` | raciocínio resumido, para ter texto a mostrar |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `DISABLE_AUTO_COMPACT`, `CLAUDE_CODE_ENABLE_AWAY_SUMMARY=0`, `ENABLE_TOOL_SEARCH=false`, `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` | sem CLAUDE.md, memória, compactação própria, resumos, tool search e advisor |
| `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`, `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` | sem retry sem streaming e sem troca de modelo após recusa (adicionados no `dev` em 2026-11-01) |
| `MAX_MCP_OUTPUT_TOKENS=200000` | a truncagem de saída de ferramenta fica com o OpenCode |

O OpenCode **não** define as variáveis de telemetria do Claude Code. Repassa todo o `process.env` ao subprocesso (`env: { ...io.env(), ...connection, ...ISOLATION_ENV }`).

### 2.4 System prompt e mensagens

- **Chats e ramos** (compactação, geração) usam o preset `claude_code` com `append`: uma nota de runtime ("running in OpenCode"), o papel do agente e as instruções do OpenCode (AGENTS.md, skills, MCP), sem a data e o ambiente do OpenCode, que o Claude Code já escreve ([`CA/language-model/system-prompt.ts:9-23`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/system-prompt.ts#L9-L23), [`CA/instructions.ts:39-54`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/instructions.ts#L39-L54)). **Títulos** usam o system do próprio OpenCode como string ([`system-prompt.ts:25-28`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/system-prompt.ts#L25-L28)).
- **O Claude Code não aceita histórico pronto.** Cada turno envia só o que o processo ainda não viu, como uma mensagem `user`. Se há histórico que o Claude não escreveu (troca de modelo, edição), ele vai como texto com tags `<user>`, `<assistant>`, `<tool-call>`, `<tool-result>` dentro de `<conversation-checkpoint>`, sem raciocínio. Imagens e PDFs continuam como blocos reais ([`CA/language-model/convert-to-claude-message.ts:8-37`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/convert-to-claude-message.ts#L8-L37), [`CA/sync/catch-up.ts:7-21`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/sync/catch-up.ts#L7-L21)).
- **Sincronização por impressão digital.** Cada grupo de mensagens vira um hash, guardado com o id da mensagem correspondente na transcrição do Claude. Na requisição seguinte, o plugin decide entre `fresh`, `continue`, `catch-up` ou `changed` ([`CA/sync/decide.ts:7-32`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/sync/decide.ts#L7-L32)). Em `changed` (edição, undo), faz `forkSession` até o último ponto comum e confere a cópia ([`CA/claude/fork.ts:11-34`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/fork.ts#L11-L34)). O registro fica no storage do plugin ([`CA/sync/record.ts`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/sync/record.ts)).
- **Sessões nativas.** `persistSession: true` para chats, com `sessionId` novo ou `resume` do id salvo ([`query-options.ts:96-110`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts#L96-L110)). As transcrições ficam em `~/.claude/projects/`.

### 2.5 Ferramentas: quem executa

**O OpenCode executa. O loop do SDK só pede.**

1. **As ferramentas do harness viram um servidor MCP em processo** (`type: "sdk"`), com nomes `mcp__opencode__<nome>` (até 64 caracteres, com hash se preciso), `readOnlyHint: false` e `_meta` `anthropic/alwaysLoad` ([`CA/tools/server.ts:9-34`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/tools/server.ts#L9-L34), [`CA/tools/names.ts:6-13`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/tools/names.ts#L6-L13)). Descrições são cortadas em 2048 caracteres.
2. **O hook `PreToolUse` informa o `tool_use_id`**, que o handler MCP não vê. Como só um id fica guardado por vez, as ferramentas rodam uma de cada vez, e é por isso que `readOnlyHint` é `false` ([`CA/tools/hooks.ts:6-23`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/tools/hooks.ts#L6-L23)).
3. **O handler `tools/call` fica numa promise pendente** ([`CA/tools/pending.ts:20-72`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/tools/pending.ts#L20-L72)).
4. **O stream do OpenCode termina no `message_stop`** da resposta que pediu ferramenta oferecida, com `finishReason: tool-calls` ([`session.ts:104-132`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/session.ts#L104-L132), [`convert-claude-stream.ts:74-84`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/convert-claude-stream.ts#L74-L84)). O turno do Claude **continua vivo** no processo, preso na promise.
5. **O OpenCode executa a ferramenta** com o próprio sistema de permissões e manda o próximo passo com os `tool-result`. O plugin acha o processo pela sessão, coleta os resultados de cada id esperado e resolve as promises ([`sessions.ts:407-425`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sessions.ts#L407-L425), [`:277-290`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sessions.ts#L277-L290)). Se faltar resultado de algum id, o processo é parado e a sessão recomeça do zero. Um usuário que interrompe gera um turno novo.
6. **PDFs e imagens de URL** num resultado não cabem num resultado MCP. O `PostToolUse` troca o conteúdo por blocos Anthropic (`updatedMCPToolOutput`) ([`CA/tools/result.ts:19-76`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/tools/result.ts#L19-L76)).
7. **Ferramenta não oferecida:** o próprio Claude Code responde `No such tool available` e segue; o OpenCode nem fica sabendo.
8. **A lista de ferramentas muda:** o processo reinicia, porque o SDK não troca ferramentas em execução.

### 2.6 Streaming

Com `includePartialMessages: true`, o SDK repassa os eventos SSE brutos da API Anthropic em `stream_event`: `message_start`, `content_block_*`, `message_delta`, `message_stop`. O OpenCode os converte para o formato do AI SDK: texto, raciocínio, `tool-call` vindo da mensagem `assistant` completa, e `finish` no limite de ferramenta ou no `result` ([`CA/language-model/convert-claude-stream.ts:22-138`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/convert-claude-stream.ts#L22-L138)). Só streaming: `doGenerate` lança erro ([`CA/language-model/claude-agent-language-model.ts:31-33`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/claude-agent-language-model.ts#L31-L33)). `stop_reason` vira `length` (`max_tokens`), `tool-calls` ou `stop`.

### 2.7 Uso, custo, erros e limites

- **Tokens.** O OpenCode guarda, por id de resposta, o maior valor visto de `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` e `thinking_tokens`, porque o SDK reporta a mesma resposta várias vezes. O tamanho do contexto vem do input da última chamada. O `usage` do `result` (total do turno) só é usado quando houve uma única chamada ([`CA/language-model/usage.ts:13-57`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/usage.ts#L13-L57)).
- **Custo.** Assinatura = $0. Chave, Bedrock, Vertex ou Foundry usam a tabela de preço do provedor correspondente no models.dev. URL base customizada = $0 ([`CA/provider.ts:34-42`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/provider.ts#L34-L42), [`:116-122`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/provider.ts#L116-L122)). O `total_cost_usd` do SDK não é usado, porque é o acumulado do turno.
- **Erros.** O OpenCode lê `result` (`api_error_status`, `errors`), `assistant.error` (`rate_limit`, `billing_error`) e `rate_limit_event` (`rejected`, `rateLimitType`, `resetsAt`), e monta mensagens como "Claude Code subscription limit reached (five hour). Resets at ..." ([`CA/language-model/claude-agent-error.ts:7-40`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/claude-agent-error.ts#L7-L40)). Retry do OpenCode desligado, porque o Claude Code já retenta ([`CA/session.ts:52-60`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/session.ts#L52-L60)).
- **Uso do plano.** O último `rate_limit_event` sai nos metadados do passo para plugins (#60879, `dev`) ([`convert-claude-stream.ts:18-20`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/language-model/convert-claude-stream.ts#L18-L20)).
- **Modelos.** Vêm de `init.models` (aliases `opus`, `sonnet`, `haiku`, sem `default`), com `resolvedModel`, níveis de esforço como variantes e janela de contexto. Ficam em cache para listar sem iniciar o `claude` ([`CA/provider.ts:98-140`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/provider.ts#L98-L140)).

### 2.8 Empacotamento

O SDK é dependência **opcional**, carregada só no primeiro uso ([`CA/claude/sdk.ts:5-17`](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent/claude/sdk.ts#L5-L17)), fixada em `0.3.301` (`packages/core/package.json:77`). A instalação traz um `claude` nativo por plataforma: `@anthropic-ai/claude-agent-sdk-linux-x64@0.3.301` tem 267.955.973 bytes descompactado (`npm view`). O binário do OpenCode leva só o JS do SDK. O SDK está em `0.3.319`, em paridade com Claude Code `2.1.319` (npm, 2026-11-06).

### 2.9 O que o próprio OpenCode deixa em aberto

A seção "Open Questions" da spec pergunta se precisam de aprovação da Anthropic e registra relatos, não verificados, de que usuários de `claude -p`/SDK recebem menos uso da assinatura.

## 3. O caminho atual do Thinker para o Claude

| Aspecto | Hoje no Thinker |
|---|---|
| Credencial | OAuth PKCE com código colado, usando o `client_id` do Claude Code (`routing/oauth/anthropic/anthropic-oauth.config.ts:14-15`), ou token colado de `claude setup-token` (`packages/shared/src/subscription/configs.ts:10-11`). Token e refresh ficam **cifrados no banco** do Thinker. |
| Requisição | `POST https://api.anthropic.com/v1/messages` com `Authorization: Bearer`, imitando o Claude Code: `user-agent: claude-cli/2.1.318 (external, sdk-cli)`, `x-app: cli`, Stainless, betas (`subscription-clients.ts:52`, `:88-100`). |
| Identidade | Primeiro bloco de system "You are a Claude agent, built on Anthropic's Claude Agent SDK." (`routing/proxy/anthropic-adapter.ts:48`, `:495`). |
| Modelo de execução | Proxy sem estado: o harness manda tudo a cada requisição, o Thinker traduz (Chat/Responses/Messages ↔ Anthropic), encaminha e grava. Ferramentas e loop são do harness. |
| Uso do plano | Não lido (G5 do `sub-anthropic`). |

## 4. Comparação

| Critério | Caminho atual (OAuth + imitação) | Agent SDK (técnica do OpenCode) |
|---|---|---|
| Termos de uso | Coleta e guarda token do Claude.ai e se passa pelo cliente oficial: proibido pelo texto atual (seção 7) | Pode caber na ressalva do "binário não modificado com a assinatura do próprio usuário", se o Thinker não tocar no token e não compartilhar a conta |
| Detecção pelo backend | Depende de imitar bem o cliente (UA, betas, identidade); houve bloqueio técnico contra clientes imitadores em jan/2026 (relatos de comunidade, não confirmado) | É o cliente oficial; nada a imitar |
| Manutenção | Atualizar UA, betas e Stainless a cada release | Atualizar o binário (ou o SDK); acompanhar opções e eventos do SDK |
| Renovação de token | Thinker (`coordinateOAuthRefresh`) | O próprio `claude` |
| Pool de limite | Plano do usuário | O mesmo plano; relatos não confirmados de rendimento menor |
| Uso do plano | Não disponível | `rate_limit_event` com `resetsAt` e overage |
| Latência | Uma chamada HTTP | Processo vivo: parecida. Processo novo: segundos de partida (não medido; o SDK diz que `startup()` deixa a primeira consulta ~20x mais rápida) |
| Memória | Desprezível | Um processo por sessão ativa (a Anthropic sugere 1 GiB por agente como ponto de partida para agentes completos; sem ferramentas embutidas deve ser menos, não medido) |
| Estado | Nenhum | Processo, ferramentas seguradas, transcrição em disco, registro de sincronização |
| Fidelidade do pedido | Corpo do harness quase intacto (system, `cache_control`, parâmetros) | System do Claude Code + `append`; sem amostragem; cache decidido pelo Claude Code; histórico estranho vira texto |
| Gravação | Corpo real enviado | Só o que o Thinker recebeu e o stream sintetizado; o corpo real fica oculto no CLI |
| Imagem Docker | Sem impacto | +~268 MB por arquitetura se embutido, ou binário montado pelo usuário |

## 5. Viabilidade dentro da imagem do Thinker

- **Runtime.** A imagem final é `gcr.io/distroless/nodejs24-debian13:nonroot`: glibc, sem shell, UID 65532 (`docker/Dockerfile:73`). O `claude` nativo é um executável próprio; os pacotes `linux-x64` e `linux-arm64` (glibc) do SDK servem. O SDK pede Node 18.14+; o Thinker usa Node 24. Sem shell, o login é feito com `docker exec -it <container> <caminho-do-claude> auth login`, sem `sh`.
- **Binário: embutir ou trazer.**
  - Embutir na imagem pública coloca software proprietário da Anthropic numa imagem de projeto MIT. Os termos dizem que pré-instalar ou rodar o Claude Code num produto exige aceitar os Commercial Terms e cumprir as condições (seção 7). O `Dockerfile` também apaga `LICENSE*` de `node_modules` (`:60-70`), o que teria de mudar.
  - Mais limpo: o usuário monta o binário (`THINKER_CLAUDE_PATH`), como o `OPENCODE_CLAUDE_PATH`. O JS do SDK pode entrar como dependência opcional carregada sob demanda, como no OpenCode, ou ser instalado junto com o binário.
- **Credenciais por conta.** Um `CLAUDE_CONFIG_DIR` por conexão (por exemplo `/data/claude-agent/<connection-id>`) num volume persistente. O `claude` guarda ali o login (no Linux, arquivo em texto puro) e as transcrições. O Thinker **não lê** esse arquivo; só verifica o status pelo probe sem prompt (seção 2.2).
- **Isolamento entre contas.** Use `CLAUDE_CONFIG_DIR` próprio, `cwd` vazio por conexão, `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` e `tools: []`. É a receita da Anthropic para multi-tenant num contêiner compartilhado (página de hosting). Sem ferramentas embutidas, um prompt injetado não tem Bash nem acesso a arquivos.
- **Ambiente do subprocesso.** No TypeScript, `env` **substitui** o ambiente do subprocesso. O OpenCode repassa o `process.env` inteiro; o Thinker **não pode**, porque o ambiente dele tem `DATABASE_URL`, segredos do Better Auth e chaves de cifragem. Passe só `PATH`, `HOME`, `CLAUDE_CONFIG_DIR`, as variáveis de isolamento e as de telemetria (seção 8).
- **Concorrência.** Um processo por sessão de harness ativa por conexão. Subagentes paralelos do harness e sessões simultâneas viram processos simultâneos. Precisa de um teto configurável e de uma política para quando ele for atingido: fila curta ou 429 com fallback para a próxima rota.
- **Proxy de saída.** O `outboundFetch` do Thinker não cobre o subprocesso. O perfil de proxy da conexão só pode virar `HTTPS_PROXY` no ambiente dele: um proxy, sem a cadeia de failover nem o registro `egress_hops`.
- **Fallback.** O CLI retenta sozinho, então uma falha pode demorar a aparecer. Para o fallback do Thinker funcionar, é preciso reduzir as retentativas do CLI (variável `CLAUDE_CODE_MAX_RETRIES`, não confirmada) ou impor um timeout por tentativa no runner.
- **Reinício do Thinker.** Ferramentas seguradas se perdem. O registro de sincronização e as transcrições em disco permitem retomar com `resume`; o turno que estava preso numa ferramenta é refeito com catch-up (perde a continuidade daquele turno).

## 6. O descasamento: proxy sem estado contra loop de agente

### 6.1 Como mapear `tool_use` do harness

O Thinker já identifica a sessão do harness (`detectHarnessSession`, `routing/proxy/harness-session.ts:68-80`). É o equivalente ao `sessionID` do OpenCode. O mapeamento possível:

1. **Requisição com ferramentas `T` e histórico `H`.** Procure o processo vivo de `(conexão, sessão do harness)`.
2. **Se as últimas mensagens de `H` trazem `tool_result` para os ids que o processo espera:** resolva as promises. O Claude Code continua o turno e o Thinker transmite a próxima resposta.
3. **Senão, se o prefixo de `H` bate com o registro de impressões digitais:** envie só a parte nova como `user` (`continue`).
4. **Senão:** pare o processo e recomece com `<conversation-checkpoint>` (`catch-up`/`fresh`). Se houver ponto comum, use `forkSession`.
5. **Ferramentas `T` viram `mcp__thinker__<nome>`.** Na saída, o prefixo é removido dos blocos `tool_use` (`content_block_start`) antes de chegarem ao harness. O `tool_use_id` é o da própria API, então o harness devolve o mesmo id.
6. **A resposta HTTP termina no `message_stop`** de uma mensagem com ferramenta oferecida (`stop_reason: tool_use`), ou no `result`.

Isso reproduz a técnica do OpenCode, mas o Thinker deixa de ser sem estado para essas rotas. A requisição de continuação **precisa** cair na mesma instância. Hoje o Thinker é uma instância só, então funciona; com várias réplicas, seria preciso afinidade por sessão.

### 6.2 Dá para usar o SDK em modo "um passo, sem ferramentas, só repasse"?

Em parte:

- **"Sem ferramentas embutidas"** existe (`tools: []`).
- **"Repasse de ferramentas do cliente"** só existe via MCP mais a espera segurada. O SDK não tem modo "devolva o `tool_use` e pare", e o `tool_choice` não é exposto (o OpenCode só trata `none`, tirando as ferramentas).
- **"Um passo"** pode ser forçado: abra um processo por requisição, mande o histórico achatado, corte no `message_stop` com `tool_use` e mate o processo. Isso é sem estado, mas cada requisição: (a) paga a partida do processo (dá para mitigar com `startup()`/`prewarm()`); (b) manda todo o histórico como texto com tags, e o modelo passa a ver as próprias chamadas de ferramenta como texto, com risco de imitar `<tool-call>` em texto em vez de chamar ferramentas; (c) perde boa parte do cache entre turnos (não medido). Serve como protótipo, não como produto.
- **Pesquisa em aberto:** um `SessionStore` (alpha) que devolve uma transcrição **sintetizada** a partir de `H` permitiria `resume` sem estado e com estrutura nativa. O formato JSONL não é documentado como contrato, e blocos de raciocínio exigem assinatura; não confirmado que funcione.

### 6.3 O que se perde

| Recurso | Situação |
|---|---|
| `temperature`, `top_p`, `top_k`, `stop_sequences`, `seed` | não suportados (spec, "Limitations") |
| `tool_choice` `any`/`tool` | não suportado (não confirmado no SDK; o OpenCode só trata `none`) |
| `cache_control` do cliente | ignorado; o Claude Code põe os próprios marcadores. Dentro de um processo vivo o cache é bom; após reinício ou catch-up, há miss |
| System prompt exato | vira `append` do preset `claude_code`. Pode virar string própria (`systemPrompt: string`), mas se a assinatura aceita isso sem o bloco de identidade não foi confirmado |
| Raciocínio | só `adaptive` com `display: "summarized"`; `budget_tokens` não se aplica; o esforço vai por `effort` (`low`...`max`) |
| Imagens | entrada `user` funciona; em resultado de ferramenta, PDFs e imagens de URL só pelo `PostToolUse` |
| Ferramentas paralelas | as chamadas saem juntas para o harness, mas o Claude Code as trata em série |
| `max_tokens` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, só na partida (mudar reinicia o processo) |
| Tokens | **exatos** por chamada de API (`message_start`/`message_delta`), inclusive cache read/write e raciocínio. Isso não se perde |
| `stop_reason` | preservado no stream (`end_turn`, `tool_use`, `max_tokens`...) |
| Não streaming | precisa montar a resposta a partir do stream |
| `count_tokens` | não há; usar estimativa |
| Gravação do corpo real | o corpo real enviado à Anthropic não é visível |

## 7. Termos de uso e risco legal

Fontes primárias, lidas em 2026-11-06:

- **[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), "Authentication and credential use".**
  - O OAuth é para quem compra os planos e serve ao uso comum do Claude Code e dos apps nativos.
  - Quem constrói produtos, **inclusive com o Agent SDK**, deve usar chave de API.
  - Terceiros não podem oferecer login do Claude.ai nos próprios apps, nem rotear requisições pelas credenciais de planos Free/Pro/Max/Ultra em nome dos seus usuários, nem "collect, store, or intermediate" credenciais ou tokens de sessão do Claude.ai. O login tem de acontecer no fluxo da própria Anthropic.
  - **Ressalva:** isso não impede que um usuário entre com a própria assinatura no **binário não modificado** do Claude Code, inclusive quando uma plataforma hospeda o Claude Code.
  - A Anthropic pode aplicar essas regras sem aviso.
- **Mesma página, "Can customers offer Claude Code in their products?"**
  - Pré-instalar ou rodar o Claude Code num produto exige os Commercial Terms.
  - O binário não pode ser modificado, e nenhum método de autenticação pode ser removido.
  - Ninguém pode pagar, revender ou intermediar o uso em nome do usuário final; cada um autentica com a própria credencial.
  - O nome "Claude Code" pode ser citado em texto ("roda o Claude Code"), mas não usado como nome de produto ou recurso.
- **Mesma página, "Acceptable use".** Os limites anunciados dos planos pressupõem uso comum e individual do Claude Code e do Agent SDK.
- **[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).**
  - Salvo aprovação prévia, terceiros não podem oferecer login do Claude.ai nem os limites do plano nos seus produtos, inclusive agentes feitos com o SDK.
  - A marca permitida é "Claude Agent"; "Claude Code" é vetado como nome.
  - O SDK é regido pelos Commercial Terms.
- **Histórico (fontes secundárias, não confirmado).** Em 2026-01-09 houve bloqueio no servidor contra clientes que imitavam o Claude Code com OAuth da assinatura. Em 2026-02-19 o OpenCode removeu o OAuth do Claude por pedido jurídico da Anthropic ([HN](https://news.ycombinator.com/item?id=46549823), [paddo.dev](https://paddo.dev/blog/anthropic-walled-garden-crackdown/), [The New Stack](https://thenewstack.io/anthropic-claudecode-opencode-split/)). O provedor Claude Agent, de outubro, é a resposta do OpenCode: binário oficial e login do próprio usuário.

**Leitura para o Thinker** (não é parecer jurídico):

1. **O caminho atual** (PKCE com o `client_id` do Claude Code, token guardado, imitação) é o que o texto proíbe com mais clareza. O risco de ação na conta é real, mesmo em uso pessoal.
2. **O caminho com o Agent SDK reduz o risco, mas não o zera.**
   - A seu favor: binário oficial, login no fluxo da Anthropic e o Thinker sem acesso ao token. Isso cabe na ressalva de "plataforma que hospeda o Claude Code".
   - Contra: a nota do SDK veta, salvo aprovação, oferecer o login do Claude.ai num produto, e o Thinker é um produto distribuído.
   - Para uso pessoal do mantenedor, que é ao mesmo tempo operador e usuário final da própria assinatura, a leitura é favorável.
   - Para uma organização no Thinker em que outros membros usam a conexão de um admin, é proibido ("em nome dos seus usuários").
3. **O token de `claude setup-token`** passado em `CLAUDE_CODE_OAUTH_TOKEN` exigiria que o Thinker guardasse o token. Isso volta à proibição de "store". Só fica aceitável se o operador definir a variável no próprio `docker-compose` e o Thinker apenas repassá-la ao subprocesso, e mesmo assim é zona cinzenta.
4. **Repassar o bearer OAuth** de um Claude Code que aponta para o Thinker sem credencial própria é intermediar token de sessão em trânsito. Também é proibido; descartado.

## 8. Regras do Thinker

- **Sem phone-home** (guia, "Sem phone-home").
  - O tráfego de inferência e de renovação OAuth para a Anthropic é tráfego do provedor e só existe com uma conexão `claude-agent` ativa.
  - O CLI, porém, faz chamadas próprias: métricas, relatório de erro (ligado por padrão para logins Pro/Max/Ultra desde 2.1.198), feature flags, auto-update, pesquisas, `/feedback`, autoinstalação do marketplace oficial e o preflight de domínio do WebFetch ([Data usage](https://code.claude.com/docs/en/data-usage)).
  - O runner deve definir sempre: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`, `DISABLE_FEEDBACK_COMMAND=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` e `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`, mais `skipWebFetchPreflight: true` em `settings`. O WebFetch fica fora de qualquer jeito com `tools: []`.
  - Antes de lançar, valide com captura de saída num contêiner descartável (`qa-docker`) que só aparecem hosts da Anthropic de inferência e OAuth.
- **Variáveis de ambiente.** Todas com prefixo `THINKER_*` (proposta 4). As variáveis do Claude Code ficam internas ao runner e não são expostas como configuração do Thinker.
- **Segredos.** O Thinker nunca lê `.credentials.json`. O probe usa só `account` (tipo de login, e-mail ou organização se vier) para mostrar o status.
- **ADR.** Rodar binário proprietário de terceiros e adotar uma postura sobre os termos da Anthropic é decisão de produto. Pede um ADR novo (proposta 1). Não é preciso exceção ao ADR 0003, porque não há destino novo além do provedor.

## 9. Riscos

1. **Termos de uso.** A Anthropic pode entender que um gateway que oferece "login do Claude" viola a nota do SDK, mesmo com binário oficial. A consequência possível é ação na conta, sem aviso.
2. **Compartilhamento acidental.** Se a conexão for usável por qualquer membro da organização, cai na proibição explícita.
3. **Mudança de API do SDK.** `prewarm()` e `SessionStore` estão em alpha. Hooks, `updatedMCPToolOutput` e `verbatimPrompts` são recentes. O OpenCode exige versão mínima por isso.
4. **Fragilidade do estado.** Continuação de ferramenta depende de afinidade, de processo vivo e do id correto. Erros de sincronização degradam para catch-up, com perda de qualidade e de cache.
5. **Recursos.** Processos acumulados com subagentes paralelos podem derrubar uma instância pequena. A memória cresce com o tamanho da sessão.
6. **Qualidade com harness que não é de código.** O system prompt `claude_code` fica na frente da persona do harness (OpenClaw, Hermes...). O efeito no comportamento não foi medido.
7. **Rendimento do plano.** Os relatos de menos uso via SDK não estão confirmados, e os limites pressupõem uso individual.
8. **Observabilidade.** O corpo real enviado à Anthropic deixa de ser gravado.
9. **Licença e distribuição.** O binário embutido na imagem pública traz obrigações dos Commercial Terms e muda o `THIRD_PARTY_NOTICES`.

## 10. Propostas para o Thinker

1. **ADR 0010 "Provedor Claude Agent (Agent SDK)"** (S). Decide: provedor opcional, desligado por padrão, só para uso pessoal; o Thinker nunca toca na credencial; binário trazido pelo usuário; conexão de dono único. Registra a leitura dos termos da seção 7.
2. **Tipo de provedor `claude-agent`, rótulo "Claude Agent"** (S). Respeita a regra de marca; o texto de ajuda pode dizer "roda o Claude Code instalado". Usa `auth_type` `subscription`, no grupo Assinaturas e com a mesma semântica de cota, com um modo de login novo `external`, sem campo de token. No backend entra como `endpoint.format: 'claude_agent'`.
3. **Ponto de encaixe: `ProviderClient.forwardInScope`** (M). Segue o precedente do Kiro (`routing/proxy/provider-client.ts:490-516`): `forwardClaudeAgent()` devolve um `Response` com SSE ou JSON **no formato Anthropic** e `isAnthropic: true`. Assim a conversão para Chat/Responses, a extração de uso, a gravação e o fallback continuam como estão. O corpo de entrada é o Anthropic que o caminho `anthropic` já monta.
4. **Configuração** (S):

   | Variável | Padrão | Função |
   |---|---|---|
   | `THINKER_CLAUDE_AGENT_ENABLED` | `false` | liga o provedor |
   | `THINKER_CLAUDE_PATH` | (nenhum) | caminho do binário `claude` montado |
   | `THINKER_CLAUDE_AGENT_HOME` | `/data/claude-agent` | raiz dos `CLAUDE_CONFIG_DIR` por conexão |
   | `THINKER_CLAUDE_AGENT_MAX_PROCESSES` | `4` | teto de processos simultâneos |
   | `THINKER_CLAUDE_AGENT_IDLE_MS` | `300000` | ociosidade antes de encerrar o processo |

5. **Login** (S). O dashboard mostra o comando exato, `docker exec -it thinker $THINKER_CLAUDE_PATH auth login`, com o `CLAUDE_CONFIG_DIR` da conexão, e um botão "Verificar". O botão roda o probe sem prompt (versão, `account`, `models`, janela de contexto), sem gastar tokens. O Thinker não retransmite URL nem código de login (pergunta aberta 2).
6. **`ClaudeAgentRunner`** (M), em `routing/claude-agent/`. Mantém um registro `(conexão, sessão do harness)` → processo. Aplica o isolamento do OpenCode mais as variáveis de telemetria da seção 8, com ambiente mínimo (nunca `process.env`) e `cwd` vazio. Encerra por ociosidade, respeita o teto e devolve 429 próprio quando o teto é atingido, para o fallback seguir. Requisições sem sessão de harness usam processo descartável; heartbeats do `auto` não devem ir para essa rota.
7. **Tradução e continuação de ferramentas** (L). Ferramentas viram um servidor MCP `thinker` (`mcp__thinker__<nome>`), com a espera segurada via `PreToolUse`/`tools/call`. Na saída, o Thinker repassa os `stream_event` como SSE Anthropic, tirando o prefixo e cortando no limite de ferramenta. Entram também a sincronização por impressão digital (continue/catch-up/fork) e o `PostToolUse` para PDF e imagem. É o núcleo do trabalho; vale portar a lógica do OpenCode (`CA/claude/sessions.ts`, `CA/sync/`, `CA/tools/`), com os testes de gravação dele como referência (`packages/core/test/plugin/provider/claude-agent/lib/fake-claude.ts`).
8. **Catálogo** (S). `init.models` vira os `cached_models` da conexão: ids e `resolvedModel`, janela de `getContextUsage`, níveis de esforço como parâmetro por rota. O probe roda ao criar a conexão e quando um processo novo reporta mudança.
9. **Uso e cota** (M). O `rate_limit_event` alimenta o medidor de 5 horas e semanal (G5 do `sub-anthropic`) e põe a rota em espera até `resetsAt` quando chega `rejected`, como o ADR 0009 faz para as cotas do OpenCode. Custo gravado: $0, com o equivalente a preço de lista para relatório (mesma regra do OpenCode Go no ADR 0009, item 6). Tokens exatos por chamada.
10. **Guardas** (S):
    - A conexão `claude-agent` só é usável pelo usuário que a criou e não entra no compartilhamento da organização.
    - Aviso no wizard sobre os termos.
    - Parâmetros não suportados são descartados pela `param-policy.ts` com uma regra que cita este parecer.
    - Gravação marcada como "corpo sintetizado".
11. **Testes** (M). Um `claude` falso que reproduz gravações (o padrão do OpenCode), mais um `qa-docker` com captura de saída para provar a regra de no-phone-home.
12. **Protótipo antes do MVP** (M, opcional). O modo "um passo, sem estado" da seção 6.2, só para medir partida, memória, cache e comportamento com OpenClaw/Hermes numa conta real do mantenedor, antes de investir no item 7.

**Escopo do MVP:** itens 1 a 8 e 10, só streaming, só assinatura (sem chave nem nuvem, que já têm caminho direto melhor), uma instância. **Esforço total estimado: L.** Itens 9, 11 e 12 completam o produto.

## 11. Perguntas abertas para o mantenedor

1. Aceita a leitura dos termos da seção 7, uso pessoal com binário oficial, como base para seguir? Quer consultar a Anthropic antes, como a própria spec do OpenCode sugere?
2. Login: só por `docker exec` (mais seguro nos termos), ou também um fluxo no dashboard que retransmite a URL e o código do `claude auth login` (mais cômodo, zona cinzenta de "intermediar")? E aceita `CLAUDE_CODE_OAUTH_TOKEN` definido pelo operador no `docker-compose`?
3. Binário: só montado pelo usuário (`THINKER_CLAUDE_PATH`), ou também uma variante de imagem com o binário embutido, construída localmente, que exige aceitar os Commercial Terms?
4. O provedor `claude-agent` substitui o caminho atual de assinatura Anthropic com o tempo (depreciação do OAuth capturado), ou os dois convivem?
5. System prompt: aceita o preset `claude_code` com o system do harness em `append` (como o OpenCode), ou prefere testar a substituição completa, com risco de rejeição pela assinatura?
6. Vale investir no protótipo da proposta 12 com sua conta antes de decidir o MVP?

## 12. Fontes

- OpenCode, commit `4db5933`: [spec](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/specs/v2/claude-agent-provider.md), [código](https://github.com/anomalyco/opencode/tree/4db59339e3fd1e959cd990da4205779a78b14c33/packages/core/src/plugin/provider/claude-agent), [docs do usuário](https://github.com/anomalyco/opencode/blob/4db59339e3fd1e959cd990da4205779a78b14c33/services/site/src/docs/content/claude-agent.mdx), `CHANGELOG.md` (v2.2.3 e v2.2.5).
- Anthropic: [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting), [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Data usage](https://code.claude.com/docs/en/data-usage) (lidos em 2026-11-06); [CHANGELOG do SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) (até 0.3.319); npm `@anthropic-ai/claude-agent-sdk` 0.3.319 e `@anthropic-ai/claude-code` latest 2.1.319 / stable 2.1.311.
- Comunidade (não confirmado): [HN 46549823](https://news.ycombinator.com/item?id=46549823), [paddo.dev](https://paddo.dev/blog/anthropic-walled-garden-crackdown/), [The New Stack](https://thenewstack.io/anthropic-claudecode-opencode-split/).
- Thinker: `docs/dev/guia.md` (Roteamento e proxy, Sem phone-home), `docs/externos/assinatura/sub-anthropic.md`, `docs/externos/harness/harness-claude-code.md`, `packages/backend/src/routing/proxy/{provider-client,harness-session,anthropic-adapter}.ts`, `packages/backend/src/common/constants/subscription-clients.ts`, `docker/Dockerfile`, ADR 0003 e ADR 0009.
