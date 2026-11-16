# Especificação: janela de sessão ao vivo

> Status: **implementada** (as três entregas). Decisões tomadas na implementação: [backend](#implementação-do-backend) e [frontend](#implementação-do-frontend). Referência viva para evoluir a janela: o laboratório em `/lab/live-session` (só em desenvolvimento, ver [Laboratório](#laboratório)).

## Objetivo

Uma janela flutuante que reconstrói uma sessão de harness como o chat original entre o agente e o provedor, atualizada em tempo real: o stream do provedor aparece token a token, com o raciocínio (thinking), as chamadas de ferramenta, os resultados, as tentativas com falha e o fallback. A mesma janela serve para acompanhar uma sessão em andamento e para rever (replay) uma sessão já terminada.

Hoje o Thinker já mostra a sessão depois que cada requisição termina (`/sessions/:id` e `/messages?session=<id>`, com as gravações das tentativas). O que falta é o "durante": ver o que o modelo está escrevendo e pensando enquanto o harness espera.

## Escopo

**Dentro:**

- Endpoint SSE por sessão, com snapshot ao entrar, retomada por `Last-Event-ID` e heartbeat.
- Captura no proxy, sem custo para o hot path, das tentativas em andamento, normalizadas num modelo de blocos neutro (`thinking`, `text`, `tool_use`).
- Reconstrução da conversa a partir das requisições do harness (mensagens novas de cada requisição em relação à anterior).
- Janela flutuante no dashboard com as abas **Chat**, **Details** e **Inspector**, modo curto, várias janelas abertas e barra de replay.
- Replay de sessões terminadas a partir do que já é gravado (`requests`, `requests.timeline`, gravações das tentativas).

**Fora (por enquanto):**

- Interagir com a sessão (mandar mensagem, cancelar a requisição do harness). A janela só observa.
- Várias instâncias do backend: o hub é em memória, como o `IngestEventBusService` (o Thinker roda em uma instância). Ver [Questões em aberto](#questões-em-aberto).
- Notificações fora do dashboard (gatilhos já cobrem isso).

## Laboratório

O laboratório é uma tela de desenvolvimento, **não faz parte do produto**:

- Código em `packages/frontend/src/pages/lab/`. A rota `/lab/live-session` só existe com `import.meta.env.DEV` (servidor do Vite); o `vite build` não inclui a rota nem o chunk. O `check-i18n` ignora a pasta.
- Roda sem backend e sem login: `npx vite` em `packages/frontend` (ou a configuração `lab-frontend`, porta 3020, no `.claude/launch.json` local) e abrir `http://localhost:3020/lab/live-session`.
- `live-session-sim.ts`: cenários (Claude Code com thinking, ciclo de ferramentas e 429 com fallback; Codex com resumo de raciocínio e chamadas paralelas; Hermes com vários prompts, thinking longo e cancelamento; OpenClaw com stream cortado e sem rota restante), o servidor simulado (buffer de replay, snapshot) e o **redutor** do cliente (`applyEvent`).
- `live-session-feed.ts`: o cliente do feed (Last-Event-ID, reconexão, um render por frame).
- `LiveSessionViews.tsx` e `LiveSessionWindow.tsx`: as views e a janela. `LiveSessionLab.tsx`: a página com os controles e o log do fio.

Ao implementar, o protocolo e o redutor do laboratório são o ponto de partida; mudanças de comportamento da janela devem ser provadas primeiro no laboratório. Quando o produto divergir do laboratório, atualize o laboratório ou registre a diferença em [Diferenças entre o laboratório e esta especificação](#diferenças-entre-o-laboratório-e-esta-especificação).

### Laboratório de Agentes ao vivo

Segundo laboratório, também só em desenvolvimento: `/lab/live-agents` (por exemplo `http://localhost:3020/lab/live-agents`, sem backend e sem login). Serve para **customizar a página Agentes ao vivo** (`/sessions/live`) com dados simulados e só depois portar as decisões para a página oficial.

- `live-agents-sim.ts`: o backend falso no navegador. Uma frota de agentes simulados (nomes e modelos sorteados) abre sessões sem parar, cada uma tocando um cenário de `live-session-sim.ts` pelo `SimServer`, e reemite os eventos no formato oficial (`LiveEvent` de `thinker-shared`, com `upstream` convertido para `anthropic_messages`, `openai_responses`, `openai_chat_completions`). Expõe um `fetch` falso (`GET /api/v1/sessions?running=true`, `/api/v1/agents`, `/api/v1/sessions/:id/events` e a sonda da URL ao vivo, que responde 404 ou 429) e uma classe `EventSource` falsa para `/api/v1/sessions/:id/live` (snapshot primeiro, depois os eventos; com `lastEventId` reenvia só o que faltou; acima de 20 conexões recusa, como o limite por organização). Os dois são injetados no `LiveSessionFeed` oficial, então a janela e as views rodam sem modificação.
- `LiveAgentsWall.tsx`: **cópia editável** da página oficial (`src/pages/LiveAgents.tsx`), com o mesmo `reconcileWall` e os tempos e o layout como parâmetros. Recebe os dados por injeção: nunca chama a API real, nem usa `thinker.liveWindows` ou o gerenciador de janelas do shell. É aqui que layout e comportamento mudam.
- `LiveAgentsLab.tsx`: a página com o painel de controle (lateral; gaveta no celular):
  - **Simulação:** número de agentes (1 a 40), intervalo entre sessões de cada agente, turnos (requisições) por sessão (0 toca o cenário como está), velocidade, janela "em execução" depois do fim da sessão (a API usa 5 min), pausar, retomar, reiniciar e abrir uma sessão na hora.
  - **Falhas:** % de requisições com 429 seguido de fallback e % com stream cortado no meio (502) seguido de fallback.
  - **Limite de conexões:** HTTP/1.1 (3), HTTP/2 (16), personalizado (N) ou sem limite.
  - **Contadores ao vivo:** em execução, quadros ao vivo, aguardando, quadros encerrados, sessões encerradas e conexões SSE abertas.
  - **Layout:** largura mínima do quadro ou número fixo de colunas, altura do quadro, aba padrão (Chat, Detalhes, Inspetor), quadros compactos, barra de replay visível ou não.
  - **Tempos do mural:** intervalo de polling, carência dos quadros encerrados, estabilização (settle) e proteção de interação.
  - **Decisões:** notas livres e o botão "Copy current settings as JSON".
  - Os controles ficam no `localStorage` em `thinker.lab.liveAgents.settings` e as notas em `thinker.lab.liveAgents.notes`; "Restore defaults" volta aos valores da página oficial.

**Regra de portabilidade:** o laboratório não muda o produto. Uma decisão tomada nele (anotada em Decisões, com o JSON das configurações) é portada **à mão** para `src/pages/LiveAgents.tsx`, com os testes em `tests/pages/LiveAgents.test.tsx` atualizados. Altura do quadro e barra de replay são sobrepostas por CSS no laboratório; no produto viram propriedades do `LiveSessionWindow`.

## Experiência

### Onde abre

- **Sessões** (`/sessions`): botão "Watch live" na linha das sessões ativas (atividade nos últimos 5 minutos, a regra que já existe) e um ponto vermelho pulsando enquanto há requisição em andamento.
- **Detalhe da sessão** (`/sessions/:id`): botão "Watch live" (ativa) ou "Replay" (terminada), que abre a mesma janela.
- **Requisições**: no detalhe de uma requisição com sessão, "Open session" abre a janela já posicionada naquela requisição.

### Janela

- Flutuante, sobre qualquer página do dashboard; continua aberta ao navegar (o gerenciador de janelas fica no shell, não na página).
- Arrastar pelo título, redimensionar pelo canto, duplo clique no título maximiza.
- Botões no título, da esquerda para a direita: **modo curto**, **minimizar**, **maximizar**, **fechar**.
- **Modo curto**: janela estreita que mostra só os 3 últimos itens (prompt, thinking, texto, ferramenta, falha), atualizando ao vivo, com o status e o custo. Serve para deixar várias sessões à vista num canto da tela.
- **Várias janelas**: até 4 abertas ao mesmo tempo (uma por sessão; abrir de novo a mesma sessão traz a janela para a frente). Abrem em cascata; clicar numa janela a traz para a frente. Posição, tamanho, modo e aba de cada sessão ficam no `localStorage` (`thinker.liveWindows`), e as janelas abertas voltam depois de recarregar a página.
- Indicador no título: vermelho pulsando enquanto o provedor está respondendo, verde quando parado, amarelo quando a conexão caiu, roxo durante o replay.
- Status da sessão (chip): `Waiting for provider`, `Streaming`, `Retrying`, `Harness running tools`, `Turn finished`, `Cancelled`, `Failed`, `Waiting for request`.
- Rolagem: acompanha o fim enquanto o usuário está no fim; se ele rolar para cima, para de seguir e mostra "Follow live" / "Jump to latest".
- Conexão caída: faixa "Connection lost. Reconnecting…" no topo; ao voltar, os eventos perdidos chegam e a faixa some.

### Aba Chat

O que a pessoa que usa o harness viu, como numa tela de chat:

- Prompts do usuário em bolhas à direita; respostas do assistente em markdown à esquerda, renderizadas enquanto chegam (um bloco de código aberto já aparece como código).
- System prompt e resultados de ferramenta não aparecem como mensagens.
- Thinking: uma linha discreta, "Thinking…" enquanto chega (com as últimas linhas visíveis) e "Thought for 3.2s" depois; abre com um clique.
- Ferramentas: etiqueta "Using Grep listModels" / "Used Grep …"; o clique mostra o resultado.
- Tentativas que falharam ficam invisíveis: se o stream de uma tentativa foi cortado e o fallback respondeu, a resposta parcial some e entra a do fallback; durante o retry aparecem os três pontos de "digitando".
- Cancelamento pelo harness: "Interrupted." abaixo do texto parcial.
- Falha sem rota restante: mensagem de erro amigável com o status.
- Todas as tentativas entre dois prompts do usuário formam um único turno do assistente (o ciclo de ferramentas inteiro).

### Aba Details

A visão do operador do gateway:

- System prompt recolhido; cada tentativa como um bloco com modelo, provedor, rota (tier, modelo virtual, fallback) e o número da tentativa.
- Thinking em bloco próprio, com cronômetro; recolhe ao terminar (opção do usuário).
- Chamadas de ferramenta com os argumentos em JSON chegando ao vivo e o resultado dentro do mesmo cartão (ligado pelo id da chamada); "running in harness…" enquanto o resultado não vem.
- Falha antes do stream: cartão vermelho com status, mensagem e "trying the next route" ou "no route left".
- Stream cortado: o texto parcial fica, com o aviso "Stream interrupted".
- Cancelamento: "Cancelled by the harness (client closed the connection) after 2.2s".
- Linha do tempo por tentativa: espera até o primeiro token, thinking, texto e argumentos de ferramenta em cores próprias, com as durações; abaixo, `stop_reason`, tokens (entrada, cache, saída, raciocínio) e custo.
- Totais da sessão na barra: requisições, tokens, custo, modelo atual. Opções "Thinking" e "Metrics" ligam e desligam o que aparece.

### Aba Inspector

O que passou no fio com o provedor, por tentativa:

- **Request to provider**: método, endpoint, cabeçalhos (credenciais mascaradas) e o corpo **depois** do roteamento e da tradução (o protocolo pode ser diferente do que o harness falou: um Claude Code roteado para o OpenRouter aparece em `chat/completions`).
- **Response from provider**: status, cabeçalhos e o stream nativo do provedor, chegando ao vivo; erro HTTP como JSON; stream cortado ou cancelado com a marca do motivo.
- Depende da gravação do harness estar ligada (a mesma de hoje). Com a gravação desligada, a aba mostra "Recording is off for this harness" e as outras abas continuam funcionando com os eventos normalizados.

### Barra de replay

No rodapé da janela, em todas as abas:

- Um controle deslizante sobre os eventos da sessão, com marcas para prompts (azul), requisições (verde) e falhas (vermelho).
- Arrastar mostra a sessão naquele instante (cronômetros congelados no tempo do evento); ▶ reproduz a partir dali, no ritmo original (pausas longas limitadas a 0,8 s); "LIVE" / "4.7s → live" volta ao vivo.
- Numa sessão terminada a barra é o único modo, começando do início.

## Transporte: SSE

**Server-Sent Events**, não WebSocket. O fluxo é de mão única (servidor → janela); o NestJS já tem `@Sse` e o dashboard já usa `EventSource` em `/api/v1/events`; a reconexão com `Last-Event-ID` vem pronta no navegador; atravessa proxies HTTP sem configuração especial.

### Endpoint

`GET /api/v1/sessions/:id/live`

- Autenticação e escopo como `GET /api/v1/sessions/:id`: sessão de cookie do dashboard, organização ativa, a sessão tem que pertencer a um harness da organização. Quem não pode ver as requisições da sessão recebe 404.
- `@SkipThrottle()`, como `/api/v1/events`.
- Cabeçalhos da resposta: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. O `compression-filter` não comprime esta rota.
- Primeira linha `retry: 3000`. Heartbeat: comentário `: hb` a cada 15 s.
- Sem `Last-Event-ID`: o primeiro evento é `snapshot`. Com `Last-Event-ID` ainda no buffer: só os eventos depois dele. Com um id que saiu do buffer: `snapshot`.
- Limite de 20 conexões ao vivo por organização (a 21ª recebe 429 com mensagem clara). Cliente lento: se o buffer de saída de uma conexão passar de 1 MB, o servidor fecha a conexão e o navegador reconecta com `Last-Event-ID`.

### Histórico (replay)

`GET /api/v1/sessions/:id/events?after=<id>&until=<id>&limit=<n>`

- JSON `{ events: WireEvent[], next_after: number | null }`, mesmo escopo do endpoint ao vivo.
- Do buffer em memória quando a sessão está nele; senão, sintetizado a partir de `requests` (mais `requests.timeline`) e das gravações das tentativas, com o mesmo normalizador do ao vivo (ver [Replay de sessões terminadas](#replay-de-sessões-terminadas)).

### Formato do evento

```
id: 42
event: block.delta
data: {"ts":1794754201259,"requestId":"…","attemptId":"…","index":1,"delta":"I'll find"}
```

- `id`: inteiro crescente **por sessão**, sem buracos. É o `Last-Event-ID`.
- `event`: o tipo (tabela abaixo).
- `data`: JSON com `ts` (relógio do servidor, epoch ms, UTC) mais os campos do tipo.

## Protocolo de eventos

| Evento | Quando | Campos |
| --- | --- | --- |
| `snapshot` | Ao entrar sem `Last-Event-ID` (ou com um id expirado) | `session` (id, título, harness, agente, modelo pedido, protocolo), `state` (o estado do redutor até o `id` do evento) |
| `message.appended` | Mensagem nova na conversa, descoberta no corpo de uma requisição do harness | `seq`, `role` (`system`, `user`, `tool`), `text`, e para `tool`: `toolCallId`, `name`, `isError` |
| `conversation.reset` | O harness reescreveu o histórico (compactação, edição, rewind) | `messages`: a conversa inteira normalizada |
| `request.started` | Uma tentativa vai ao provedor | `requestId`, `attemptId`, `attempt` (1, 2…), `model`, `provider`, `route`, `upstream` (protocolo falado com o provedor), `endpoint`; `headers` e `body` só para quem tem acesso às gravações e com a gravação ligada |
| `block.started` | Começa um bloco da resposta | `attemptId`, `index`, `type` (`thinking`, `text`, `tool_use`), e para `tool_use`: `name`, `toolCallId` |
| `block.delta` | Pedaço de um bloco | `attemptId`, `index`, `delta` (texto; em `tool_use`, um pedaço do JSON dos argumentos) |
| `block.stopped` | Fim de um bloco | `attemptId`, `index` |
| `request.completed` | A tentativa terminou bem | `attemptId`, `stopReason`, `usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`), `costUsd`, `ttftMs`, `latencyMs` |
| `request.failed` | A tentativa falhou | `attemptId`, `status`, `message`, `errorClass`, `interrupted` (o stream já tinha começado), `next` (`fallback` ou `give_up`) |
| `request.cancelled` | O harness fechou a conexão | `attemptId`, `reason` (`client_closed`), `latencyMs`, `usage` parcial quando houver |

Regras:

- A ordem dos eventos de uma tentativa é sempre `request.started` → (`block.started` → `block.delta`* → `block.stopped`?)* → um entre `request.completed`, `request.failed` e `request.cancelled`. Num stream cortado ou cancelado o último bloco fica sem `block.stopped`.
- Requisições concorrentes na mesma sessão (subagentes, ferramentas em paralelo) intercalam eventos; cada evento carrega o seu `attemptId`.
- `block.delta` é agregado no servidor em janelas de 50 ms por bloco (um delta por janela), para não mandar centenas de eventos por segundo. O texto final é idêntico.
- Assinaturas de thinking (`signature`), `encrypted_content` e `redacted_thinking` não vão para a janela. Thinking só criptografado vira um bloco `thinking` com `text` vazio e `redacted: true` ("Reasoning is encrypted by the provider").
- Imagens base64 nas mensagens viram um marcador, como já fazem as gravações.
- O redutor do cliente (`applyEvent` no laboratório) é a definição do estado. Ele vai para `packages/shared`, porque o backend usa o mesmo redutor para montar o `snapshot`.

## Backend

### Hub de sessões ao vivo

`LiveSessionHubService` (novo módulo `live-session/`), em memória:

- Uma entrada por sessão com atividade: o buffer de eventos (no máximo 5000 eventos ou 4 MB, descartando os mais antigos), o próximo `id`, o estado do redutor (para o `snapshot`) e os assinantes.
- A entrada é criada na primeira requisição da sessão e descartada 10 minutos depois da última atividade se não houver assinante.
- O hub só guarda eventos de sessões detectadas (`detectHarnessSession`); requisições sem sessão não geram nada.
- Custo de memória limitado: com o hub cheio, as sessões sem assinante são as primeiras a sair.

### Captura no proxy

O ponto de captura é onde o stream do provedor já é lido e interpretado: `pipeStream` / `pipePassthrough` em `routing/proxy/stream-writer.ts`, ao lado do `StreamProtocolObserver` e da captura de gravação (`attempt-recording-capture.ts`).

- Um `LiveAttemptTap` por tentativa recebe cada evento SSE já parseado do provedor e o normaliza para eventos de bloco. O tap **nunca** lança exceção para o proxy, não aguarda nada (sem `await` no caminho do chunk) e não atrasa o repasse ao harness; em erro, ele se desliga e registra um aviso.
- Respostas sem stream (JSON) geram os mesmos eventos de uma vez quando a resposta chega.
- Início e fim da tentativa vêm dos pontos que já alimentam `requests.timeline` (`provider_request`, `first_chunk`, `provider_error`, `response_completed`) e da lógica de uso parcial em cancelamentos (`attachPartialUsage`).
- Normalização por formato de fio (confirmar cada linha no `### Formato na rede` do dossiê da entidade em `docs/externos/` antes de implementar):

| Formato | thinking | text | tool_use |
| --- | --- | --- | --- |
| Anthropic Messages | `content_block_start` `thinking` + `thinking_delta` | `text` + `text_delta` | `tool_use` + `input_json_delta` |
| OpenAI Responses | `response.reasoning_summary_text.delta` (só o resumo) | `response.output_text.delta` | `function_call` + `response.function_call_arguments.delta` |
| OpenAI Chat Completions | `delta.reasoning_content` / `delta.reasoning` | `delta.content` | `delta.tool_calls[i]` (um bloco por `index`) |
| Gemini | `parts[].thought: true` | `parts[].text` | `parts[].functionCall` (argumentos inteiros num delta só) |

### Reconstrução da conversa

Cada requisição do harness traz o histórico inteiro. No `request.started` da tentativa 1, o hub normaliza as mensagens do corpo **de entrada** (o que o harness mandou, antes da tradução) e compara com a conversa que já conhece:

- Se a conversa conhecida é prefixo da nova (comparação por hash de cada mensagem normalizada), emite `message.appended` só para o que veio depois: tipicamente os resultados de ferramenta e o novo prompt do usuário.
- Se não é prefixo (compactação, `/clear`, edição de mensagem, rewind), emite `conversation.reset` com a conversa inteira.
- A resposta do assistente não é tirada do histórico: ela já veio pelos blocos da tentativa. A mensagem `assistant` do histórico apenas confirma o prefixo.
- O system prompt entra como `message.appended` com `role: system` na primeira vez e em `conversation.reset` quando muda.

### Replay de sessões terminadas

Sem buffer em memória, `GET /sessions/:id/events` sintetiza os eventos a partir do banco:

- Uma tentativa por linha de tentativa de `requests`, na ordem de `timeline.received`.
- Os blocos vêm de passar a gravação da resposta (`raw_sse` ou JSON) pelo mesmo normalizador do ao vivo; as mensagens, do corpo gravado da requisição (com a mesma comparação de prefixo).
- Tempos: início, primeiro chunk, último chunk e fim vêm de `requests.timeline`; os deltas de um bloco são distribuídos por igual entre o primeiro e o último chunk (a gravação não guarda o tempo de cada chunk).
- Sem gravação (desligada ou expirada pela retenção), o replay mostra só a estrutura: prompts ausentes, tentativas com modelo, status, tokens, custo e tempos, e o aviso "Content not recorded".

### Segurança e privacidade

- Mesmas regras de acesso das gravações: quem não vê o conteúdo das requisições de um harness não abre a janela dele.
- Cabeçalhos com credencial (`authorization`, `x-api-key`, cookies, tokens de assinatura) sempre mascarados; nunca vão para o evento.
- Nada sai do servidor além do que já é gravado; nenhuma chamada externa nova (regra de sem phone-home).
- Conteúdo ao vivo não é persistido pelo hub: o que fica no banco é o que a gravação de hoje já guarda.

## Frontend

O código do laboratório vira o produto assim:

| Laboratório | Produto |
| --- | --- |
| `applyEvent`, tipos `Live*` (`live-session-sim.ts`) | `packages/shared/src/live-session/` (redutor e tipos, usados também pelo backend) |
| `SimServer` | removido; o servidor real |
| `FeedClient` (`live-session-feed.ts`) | `src/services/live-session-feed.ts`, sobre `EventSource` e `GET /sessions/:id/events` |
| `LiveSessionViews.tsx` | `src/components/live-session/` (Chat, Details, Inspector, Compact, RequestTimeline) |
| `LiveSessionWindow.tsx` | `src/components/live-session/LiveSessionWindow.tsx` |
| controle de janelas da página do lab | `LiveSessionWindowsProvider` no shell (`App.tsx`), com `openLiveSession(id)` |

- Um `EventSource` por janela aberta; janela minimizada continua conectada; janela fechada fecha a conexão.
- Os eventos atualizam um estado mutável e o React renderiza uma vez por frame (`requestAnimationFrame`), como no laboratório.
- Markdown ao vivo pelo `MarkdownContent` que o dashboard já usa.
- Textos da interface em inglês, pelas chaves de tradução (`check-i18n`), como o resto do dashboard.

## Entregas

1. **Ao vivo básico**: hub, captura no proxy (Anthropic, Responses, Chat Completions), reconstrução da conversa, `GET /sessions/:id/live`, janela com Chat e Details, um "Watch live" em Sessões e no detalhe da sessão.
2. **Inspector e replay**: `headers`/`body` no `request.started`, aba Inspector, `GET /sessions/:id/events` (buffer e síntese a partir do banco), barra de replay, Gemini.
3. **Várias janelas e modo curto**: gerenciador no shell, persistência no `localStorage`, modo curto, "Open session" a partir de uma requisição.

Cada entrega sai com `scripts/ship.sh`. A 1 mexe no hot path do proxy: roda a suíte e2e e o `qa-docker` (ADR 0005).

## Testes

- **Normalizador** por formato de fio, com fixtures de streams capturados de verdade (os mesmos das specs dos adapters): thinking, texto, ferramentas em paralelo, stream cortado, erro no meio do stream.
- **Redutor** (`packages/shared`): sequência de eventos → estado, snapshot no meio de um bloco, replay com `Last-Event-ID`, `conversation.reset`.
- **Reconstrução da conversa**: prefixo, resultados de ferramenta, compactação, subagente na mesma sessão.
- **Endpoint**: escopo de organização, 404 de sessão de outra organização, snapshot, retomada, limite de conexões, que o tap não altera os bytes repassados ao harness.
- **Frontend**: Chat esconde tentativas com falha, timeline por tentativa, modo curto mostra os 3 últimos itens.

## Questões em aberto

1. **Resumo de raciocínio no Responses/Codex**: o resumo só vem quando o harness pede `reasoning.summary`. O Thinker não deve mudar o pedido do harness só para a janela; sem resumo, o bloco fica "Reasoning is encrypted by the provider".
2. **Subagentes**: na primeira entrega, a janela da sessão principal mostra só as requisições dela, com uma linha "Subagent <nome>" que abre a janela do subagente. Intercalar as conversas na mesma janela fica para depois.
3. **Várias instâncias**: se o Thinker passar a rodar com réplicas, o hub precisa de um canal entre elas (PostgreSQL `LISTEN/NOTIFY` ou Redis). Até lá, uma instância só.
4. **Tempo de cada chunk na gravação**: guardar o tempo relativo de cada chunk deixaria o replay de sessões antigas fiel ao ritmo real. Custa espaço na gravação; decidir na entrega 2.

## Diferenças entre o laboratório e esta especificação

O laboratório ainda não simula: `conversation.reset`, subagentes, blocos `redacted`, `cacheWrite` e `errorClass`, agregação de deltas em 50 ms, limites de conexão, sessão sem gravação e persistência das janelas no `localStorage`. Simule ali o que for mudar a janela antes de implementar.

## Implementação do backend

O backend desta especificação está em `packages/backend/src/live-session/` (resumo no [guia](guia.md#sessões)). Decisões tomadas onde a especificação deixava em aberto:

- **Ids**: os ids ao vivo começam no instante (ms) em que a entrada do hub nasce, sem buracos dali em diante; um `Last-Event-ID` de antes de um reinício nunca cai dentro do buffer e recebe `snapshot`. O `/events` sintetizado do banco numera 1, 2, 3… (estável para os mesmos dados).
- **Snapshot**: quando a entrada do hub nasceu no meio da sessão (reinício, sessão parada), o estado inclui na frente o que o banco tem das requisições anteriores (mesma síntese do `/events`). Só as 10 tentativas mais recentes guardam `headers`/`body` no estado; o estado tem no máximo 3000 itens.
- **Conversa**: uma requisição com outro system prompt e histórico menor que o conhecido é tratada como requisição lateral do harness (título, resumo) e não gera `conversation.reset`. Responses com `previous_response_id` acrescenta os itens recebidos. A linha `x-anthropic-billing-header` do system prompt do Claude Code é ignorada no hash. Texto de mensagem limitado a 64 KB.
- **`request.started`**: `route` vem do tier/especificidade (`tier: complex · specificity: coding`) ou do modelo virtual, mais `fallback #n` nas tentativas seguintes; `endpoint` tem credenciais de query mascaradas; `body` acima de 1 MB vira um marcador. `attempt` conta só chamadas reais ao provedor (pulos locais por cooldown não contam).
- **`stopReason`**: o nativo do provedor; em Responses e Gemini, `tool_calls` quando a resposta tem chamada de ferramenta.
- **Custo**: `request.completed` sai quando o custo da tentativa é calculado (mesmo cálculo da linha gravada), em até 2 s; depois disso vai com `costUsd: null`.
- **`session` (meta)**: além de `sessionId`, `agentName` e `harness`, leva `title` (primeira linha do primeiro prompt do usuário, até 80 caracteres) quando há.
- **Heartbeat**: comentário `: hb` a cada 15 s.

## Implementação do frontend

A janela está em `packages/frontend/src/components/live-session/` e o cliente do feed em `src/services/live-session-feed.ts` (resumo no [guia](guia.md#dashboard-console)). Diferenças em relação ao laboratório e ao texto acima:

- **Organização**: o `EventSource` não manda cabeçalhos, então a URL ao vivo leva `?organization=<id>` (aceito só nessa rota, com a mesma checagem de membro do cabeçalho); o histórico usa o cabeçalho normal.
- **Título**: o `title` da sessão (primeiro prompt); sem ele, o nome do harness ou o id curto da sessão.
- **Conexão**: quando o `EventSource` desiste, o cliente consulta o status: 404 mostra "não encontrada", 429 mostra "janelas demais" com botão de tentar de novo, o resto tenta outra vez em 3 s com `?lastEventId=`. Ids repetidos depois de uma reconexão são descartados.
- **Replay**: o histórico só carrega no primeiro uso da barra (os ids ao vivo não começam em 1, então o clique antes da carga guarda a posição relativa e a aplica quando o histórico chega). Sessão terminada abre no começo, tocando. "Open session" de uma requisição abre a janela parada no fim daquela requisição (ao vivo se a requisição está pendente ou tem menos de 5 minutos).
- **Thinking** recolhe sempre ao terminar (a opção do laboratório não foi exposta).
- **Camada**: as janelas ficam logo abaixo dos modais (z-index 66–69), para um modal cobrir a janela.
- **Tamanho salvo**: só o redimensionamento pelo canto grava o tamanho, para uma tela estreita não virar o tamanho salvo.
- **Entradas**: "Watch live" nas linhas ativas de Sessões (ponto vermelho quando há requisição em andamento), "Watch live"/"Replay" no detalhe da sessão (também por `?watch=live|replay&request=<id>`), "Open session" no drawer e na página da requisição (lê `session_id` de `GET /messages/:id/details`).
