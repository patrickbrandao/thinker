# Provedores e roteamento

## Conectar provedores

Em **Providers** no dashboard:

| Tipo | Quando usar |
| --- | --- |
| **Usage-based** | Chave de API do provedor (OpenAI, Anthropic, Google, DeepSeek, Mistral, OpenRouter e outros). As chaves ficam cifradas com `THINKER_ENCRYPTION_KEY`. |
| **Subscriptions** | Reaproveita um plano pago (ChatGPT Plus/Pro, Claude Max/Pro, Copilot, planos de código de Kimi, GLM, MiniMax e outros) por OAuth, código de dispositivo ou token. Veja [Provedores por assinatura](../providers/subscription-based-providers.md). |
| **Local** | Ollama, LM Studio e llama.cpp. |
| **Custom** | Qualquer endpoint compatível com `/v1/chat/completions` ou `/v1/messages`. |

Ao salvar a conexão, o Thinker busca a lista de modelos na API do próprio provedor; se ela falhar ou vier vazia, usa o catálogo público do OpenRouter como apoio (desligado com `THINKER_CATALOG_SYNC=false`, quando valem só os dados embutidos). Cada harness habilita os provedores que pode usar.

### Modelos locais

O container alcança servidores no host por `host.docker.internal:<porta>` (Docker Desktop, ou Docker Engine 20.10+ no Linux). Suba o servidor ligado em `0.0.0.0`, não em `127.0.0.1`, senão o container não o enxerga.

- **Ollama:** `ollama pull llama3.1:8b`; em Providers, **Local**, o bloco Ollama usa `http://host.docker.internal:11434`. Para outro host, defina `OLLAMA_HOST` no `.env`.
- **LM Studio:** ligue "Serve on Local Network" (ou `lms server start --bind 0.0.0.0 --port 1234 --cors`). Padrão `http://host.docker.internal:1234`; mude com `THINKER_LMSTUDIO_BASE_URL`.
- **llama.cpp:** `./llama-server -m modelo.gguf --host 0.0.0.0 --port 8080`. Padrão `http://host.docker.internal:8080`; mude com `THINKER_LLAMACPP_BASE_URL`.
- **Outro servidor OpenAI-compatível (vLLM e similares):** **Add custom provider**, informe a URL (por exemplo `http://host.docker.internal:8000/v1`) e use **Fetch models**.

Provedores customizados aceitam URLs `http://`, de LAN e de loopback; só precisam resolver de dentro do container (no Podman, o host é `host.containers.internal`). Endereços de metadata de nuvem (como `169.254.169.254`) são sempre recusados, e uma URL recusada falha a tentativa com HTTP 502 e `error.code: "provider_url_blocked"`, sem impedir os fallbacks.

Cada provedor customizado tem um **alias**, o prefixo que seus modelos mostram em `GET /v1/models` (por exemplo `meu-vllm/qwen-3-14b`). O campo `model` aceita o alias.

## Tiers e o modelo `auto`

O roteamento de cada harness é configurado na página de roteamento do harness, por **tiers**. Cada tier tem um modelo principal e até **5 modelos de fallback**.

| Tier | Papel |
| --- | --- |
| `default` | Atende tudo quando o roteamento por complexidade está desligado e é o último recurso quando está ligado. |
| `simple`, `standard`, `complex`, `reasoning` | Usados só com o roteamento por complexidade ligado. |

### O tier `default` precisa de um modelo

Quando o cliente envia `"model": "auto"`, o Thinker decide o modelo pela configuração do harness. **O tier `default` precisa ter um modelo.** Sem ele, `auto` não tem para onde ir e a requisição falha com `M101`, cuja mensagem diz qual tier foi consultado e o que falta. Configure o `default` primeiro, mesmo que pretenda usar os outros tiers.

### Roteamento por complexidade

O roteamento por complexidade é uma opção **por harness e vem desligada**. Desligada, toda requisição `auto` vai para o tier `default`.

Ligada, cada requisição é pontuada pelo conteúdo (palavras-chave, tamanho, ferramentas e outras dimensões) e cai em um dos tiers `simple`, `standard`, `complex` ou `reasoning`. O Thinker usa o modelo desse tier. Regras:

- Se o tier pontuado **não tem modelo** configurado, a requisição cai no tier `default`. Só se o `default` também não tiver rota, o resultado é `M101`.
- Se o tier tem um modelo configurado mas ele está **indisponível** (por exemplo, o provedor foi desabilitado para o harness), a requisição **não** cai no `default`: o erro (`M302` ou `M101`) aparece, para que uma configuração quebrada não envie o tráfego em silêncio para um modelo possivelmente mais caro.

### Ordem de resolução

1. Modelo virtual ativo cujo nome é igual ao `model` (veja [Modelos virtuais](#modelos-virtuais)).
2. Tier customizado por cabeçalho, se alguma regra casar. Um heartbeat `auto` pula este passo e vai direto ao tier `simple`.
3. `model` explícito no corpo da requisição (`auto` pede o roteamento do Thinker).
4. Pontuação de complexidade (se ligada) e atribuição de tier.
5. Resolução do provedor e do modelo, e encaminhamento.

### `model` explícito

`auto` pede para o Thinker rotear. Qualquer outro valor é uma escolha explícita: o Thinker procura o modelo entre os descobertos do harness (use os IDs de `GET /v1/models`). Um ID qualificado pelo provedor (`openai/gpt-novo`) ainda pode ser roteado por esse provedor se a credencial dele estiver habilitada no harness, mesmo fora do catálogo. Se o modelo não está disponível para o harness, a resposta é `M302`.

## Fallback

Quando uma tentativa ao provedor falha (resposta HTTP 4xx ou 5xx, timeout, resposta em streaming que não começa dentro de `STREAM_WARMUP_MS`, silêncio maior que `STREAM_IDLE_TIMEOUT_MS`), o Thinker tenta o próximo modelo de fallback do tier, na ordem configurada. A primeira tentativa que der certo atende a requisição; o cliente vê um único resultado.

- Cada tentativa fica registrada separadamente (provedor, modelo, status, custo). A requisição conta como "recuperada por fallback" quando termina com sucesso depois de uma tentativa falha.
- Se **todas** as tentativas falham, o cliente recebe o erro do provedor da última tentativa. Isso é um erro do provedor, não um código `M###`.
- Deixe `PROVIDER_TIMEOUT_MS` abaixo do timeout do cliente para o fallback ter tempo de rodar.

## Tiers customizados por cabeçalho

Além dos tiers padrão, você pode criar tiers que se ativam por um cabeçalho da requisição (por exemplo `x-thinker-tier: premium`), cada um com modelo principal e fallbacks. Quando uma regra casa, ela tem prioridade sobre o `model` do corpo e sobre a complexidade, mas perde para um [modelo virtual](#modelos-virtuais) com o mesmo nome do `model`. O dashboard e a CLI (`thinker routing`) criam e editam essas regras.

## Modelos virtuais

Um **modelo virtual** é um nome público que você cria em um harness, com uma cadeia própria de modelos. O harness manda esse nome no campo `model`, e o Thinker roteia pela cadeia, sem cabeçalho. Serve para harnesses que escolhem o modelo pelo nome e não deixam enviar cabeçalhos (Claude Code, seletores de modelo de editores), e para dar fallback a um nome que o cliente não deixa trocar.

Um harness pode ter quantos virtuais quiser. Eles aparecem em `GET /v1/models` logo depois de `auto` e valem em `/v1/chat/completions`, `/v1/responses` e `/v1/messages`.

### Criar pelo dashboard

Na página de roteamento do harness, na seção **Virtual models** (separada dos tiers customizados), crie um virtual:

1. Digite o nome. O dashboard valida enquanto você digita.
2. Escolha o modelo principal e até 5 fallbacks (no modal de criação ou depois, no cartão do virtual). Sem modelos, o virtual responde `M301`, a menos que Continue on Default cubra a falta.
3. Se quiser, ligue **Continue on Default** (veja abaixo) e escolha o modo de resposta (`buffered` ou `stream`).
4. Clique em `model: "<nome>"` no cartão (ou em **Copy example** no menu do cartão) para copiar um exemplo com a URL base do harness e o nome.

Cada rota é validada ao salvar: um modelo que o harness não consegue rotear (provedor não habilitado, modelo desconhecido, rótulo de chave inexistente) é recusado com HTTP 400. Os cartões podem ser reordenados por arraste; essa ordem vale também em `/v1/models`. Pela linha de comando, veja [CLI](cli.md#modelos-virtuais).

### Regras de nome

- De 1 a 64 caracteres entre letras, números, `.`, `_`, `:`, `-` e `/`.
- A `/` separa partes (`deepseek/flash`), mas não pode abrir nem fechar o nome, nem aparecer duas vezes seguidas. Sem espaços nem aspas.
- Único por harness, **sem diferenciar maiúsculas**: `DeepSeek` e `deepseek` são o mesmo nome. Um virtual desativado também ocupa o nome. Repetir um nome responde 409.
- `auto` é reservado, em qualquer grafia.
- O nome é guardado com a grafia que você digitou, e o Thinker o devolve assim em `X-Thinker-Virtual-Model`. O casamento com o `model` da requisição ignora maiúsculas, mas não faz nenhuma outra normalização.

### Sombreamento de IDs reais

Um virtual pode ter o mesmo nome de um modelo real, e isso é permitido. Enquanto o virtual estiver ativo, o pedido com esse `model` usa o virtual, e o modelo real some de `GET /v1/models`. O casamento é pela string enviada:

- Um virtual `openai/gpt-5.5` sombreia o ID público `openai/gpt-5.5`.
- Um virtual `claude-sonnet-4-5` (sem prefixo) sombreia o ID nativo que os clientes Anthropic mandam em `/v1/messages`, mesmo que ele não apareça em `/v1/models`.
- Grafias diferentes do mesmo modelo não se sombreiam: `gpt-5.5` não captura `openai/gpt-5.5`.

O dashboard mostra um aviso (**Shadows** na listagem, **This name matches** ao digitar) com os IDs reais afetados. A lista é calculada a cada leitura, então um virtual criado sem colisão pode passar a sombrear um modelo quando um provedor novo entra. A cadeia do virtual pode conter o próprio modelo sombreado, o que é útil para dar fallback a um nome fixo. Desativar o virtual devolve o ID real.

### Cadeia, fallbacks e Continue on Default

A cadeia é o **principal** seguido de **até 5 fallbacks**. Rotas cujo provedor, modelo ou credencial não está mais disponível saem da cadeia na hora do pedido. Em tempo de execução vale o mesmo [fallback](#fallback) dos tiers: se a primeira tentativa falha, o Thinker tenta a próxima.

A cadeia só tem modelos concretos: um virtual não aponta para outro virtual, para `auto` nem para um tier customizado.

**Continue on Default**, desligado por padrão, acrescenta ao fim da cadeia do virtual a cadeia do tier `default` (principal e fallbacks, sem duplicar rotas que já estão na cadeia). Ele entra nos dois casos:

- na montagem, quando as rotas do virtual estão indisponíveis: a primeira rota que sobra, que pode ser a do `default`, vira o principal;
- em tempo de execução, quando as rotas do virtual falham: a parte do Default é tentada como fallbacks comuns.

O modo de resposta do virtual vale para a cadeia inteira, inclusive a parte do Default. Com as duas partes, a cadeia tem no máximo 12 tentativas. Um pedido para um virtual **não** passa pela pontuação de complexidade: a cadeia é sempre a mesma, e a parte do Default é a do tier `default`, com o roteamento por complexidade ligado ou desligado.

### Precedência e virtual desativado

Para cada requisição, o Thinker aplica nesta ordem a primeira regra que casa:

1. **Modelo virtual ativo** com o nome igual ao `model`.
2. **Tier por cabeçalho**, se algum casar.
3. **`auto`** (roteamento do Thinker) ou **ID explícito** do modelo. Um ID desconhecido responde `M302`.

Logo, quem manda o cabeçalho de um tier e `model: "deepseek"` recebe o virtual `deepseek`. O passo 1 não roda quando `model` falta ou é `auto`.

Um virtual **desativado** é invisível: não aparece em `/v1/models`, não casa com pedidos e não sombreia nada. O pedido segue para os passos 2 e 3, e o ID real volta a resolver ou o pedido recebe `M302`.

### Sem rota: M301

Se nenhuma rota da cadeia está disponível, o Thinker responde [`M301`](../erros.md#m301), com o nome do virtual na mensagem. Não há queda silenciosa para `auto` nem para outra regra, para que uma configuração quebrada não envie o tráfego a um modelo que você não escolheu. Isso vale com Continue on Default ligado, se o `default` também estiver sem rota. Um virtual criado sem principal também responde `M301`, a menos que Continue on Default cubra a falta. Se todas as tentativas chegam ao provedor e falham, vale o comportamento de qualquer fallback esgotado: o cliente recebe o status e o erro do provedor principal, com `X-Thinker-Fallback-Exhausted: true`.

### Parâmetros por modelo

Os parâmetros por modelo (por exemplo `reasoning.effort`, que você edita no dashboard ou com `thinker routing params`) se aplicam aos virtuais, com escopo próprio: o que você salva para o virtual vale para as rotas da cadeia dele, por modelo. As rotas que entram pelo Continue on Default usam os parâmetros do tier `default`. Um pedido para um virtual não é uma rota explícita, então os parâmetros salvos são aplicados. Apagar o virtual apaga os parâmetros dele. Pela CLI, use `thinker routing params get|set --virtual <nome>`.

### Exemplo: `deepseek/flash`

Um virtual `deepseek/flash` que usa o modelo barato e cai no `default` se ele falhar:

```bash
thinker routing virtual create meu-app --name deepseek/flash \
  --model deepseek-chat --fallback deepseek-reasoner --continue-on-default
```

O harness usa o nome no campo `model`:

```bash
curl -i http://localhost:2099/v1/chat/completions \
  -H "Authorization: Bearer thk_SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/flash","messages":[{"role":"user","content":"Olá"}]}'
```

A resposta traz `X-Thinker-Reason: virtual-model` e `X-Thinker-Virtual-Model: deepseek/flash`. O modelo que vai ao provedor é sempre o da rota escolhida: o nome do virtual nunca chega ao upstream.

## Cabeçalhos de resposta X-Thinker

Toda resposta roteada pelo Thinker informa o que foi decidido. Os cabeçalhos valem para respostas normais e em streaming, e `thinker routing test` lê os mesmos.

| Cabeçalho | Valor |
| --- | --- |
| `X-Thinker-Tier` | Tier que atendeu: `simple`, `standard`, `complex`, `reasoning` ou `default`. Um tier customizado e uma regra de especificidade aparecem como `standard`, um modelo virtual como `default` e um ID explícito como `direct`, porque nenhum deles é um slot de complexidade. |
| `X-Thinker-Model` | Modelo escolhido pela rota (`thinker` nas respostas de erro do próprio Thinker). |
| `X-Thinker-Provider` | Provedor da rota (`thinker` nas respostas de erro do próprio Thinker). |
| `X-Thinker-Confidence` | Confiança da decisão, de 0 a 1. É `1` para tiers por cabeçalho, virtuais e IDs explícitos. |
| `X-Thinker-Reason` | Motivo da decisão (tabela abaixo). |
| `X-Thinker-Virtual-Model` | Nome do virtual, com a grafia cadastrada. Só aparece quando um virtual atendeu. |
| `X-Thinker-Output-Modality` | Modalidade de saída da rota (`text` por padrão). |
| `X-Thinker-Response-Mode` | `buffered` ou `stream`. |
| `X-Thinker-Specificity` | Categoria detectada, quando a regra de especificidade decidiu. |
| `X-Thinker-Fallback-From` | Sempre o modelo **principal** (que falhou), quando a resposta veio de um fallback. |
| `X-Thinker-Fallback-Index` | Posição do fallback que respondeu (a partir de 0), junto com `Fallback-From`. |
| `X-Thinker-Fallback-Exhausted` | `true` quando todas as tentativas falharam. O status HTTP e o erro são os do provedor **principal**, e o corpo traz `primary_model`, `primary_provider` e a lista `attempted_fallbacks`, com uma entrada por tentativa. |

Valores de `X-Thinker-Reason`:

| Valor | Quando |
| --- | --- |
| `virtual-model` | O `model` casou com um modelo virtual ativo. |
| `header-match` | Uma regra de tier customizado por cabeçalho casou. |
| `specificity` | Uma atribuição de especificidade decidiu. |
| `scored` | O roteamento por complexidade pontuou o pedido. |
| `tool_detected`, `large_context`, `formal_logic_override`, `short_message` | A pontuação foi ajustada por ferramentas, contexto grande, lógica formal ou mensagem curta. |
| `momentum` | A pontuação seguiu o tier das mensagens anteriores da conversa. |
| `ambiguous` | A pontuação ficou abaixo da confiança mínima. |
| `heartbeat` | Pedido `auto` detectado como heartbeat, enviado ao tier `simple`. |
| `default` | Tier `default` (roteamento por complexidade desligado ou sem tier atribuído). |
| `direct` | O `model` nomeou um modelo real (ID explícito). |

As respostas de erro que o Thinker gera depois de começar a rotear (`M100`, `M101`, `M102`, `M200`, `M301` e `M302`, veja [Erros](../erros.md)) saem com os mesmos cabeçalhos. `X-Thinker-Reason` traz o motivo: `no_provider_key` (`M100`), `no_provider` (`M101`), `subscription_credentials_unusable` (`M102`), `limit_exceeded` (`M200`), `virtual_model_unavailable` (`M301`) ou `model_not_available` (`M302`). `X-Thinker-Tier` vale `simple` (`M100`, `M102`, `M200` e `M302`), o tier resolvido no `M101` e `default` no `M301`, que também traz `X-Thinker-Virtual-Model`. `X-Thinker-Provider` e `X-Thinker-Model` valem `thinker`.

Os demais erros chegam **sem** cabeçalhos `X-Thinker-*`: autenticação (`M001` a `M006`, inclusive chave expirada), limite de taxa (`M201` a `M203`), corpo inválido (`M300`) e erro interno (`M500`). O motivo deles fica no log de mensagens.

## Limites e custos

Os custos vêm dos preços dos catálogos (veja `THINKER_CATALOG_SYNC` em [Configuração](configuracao.md)). Limites de uso e notificações por e-mail são configurados na página de limites do harness; estourar um limite responde `M200`.
