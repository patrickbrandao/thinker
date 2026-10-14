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

1. Tier customizado por cabeçalho, se alguma regra casar.
2. `model` explícito no corpo da requisição.
3. Pontuação de complexidade (se ligada) e atribuição de tier.
4. Resolução do provedor e do modelo, e encaminhamento.

### `model` explícito

`auto` pede para o Thinker rotear. Qualquer outro valor é uma escolha explícita: o Thinker procura o modelo entre os descobertos do harness (use os IDs de `GET /v1/models`). Um ID qualificado pelo provedor (`openai/gpt-novo`) ainda pode ser roteado por esse provedor se a credencial dele estiver habilitada no harness, mesmo fora do catálogo. Se o modelo não está disponível para o harness, a resposta é `M302`.

## Fallback

Quando uma tentativa ao provedor falha (resposta HTTP 4xx ou 5xx, timeout, resposta em streaming que não começa dentro de `STREAM_WARMUP_MS`, silêncio maior que `STREAM_IDLE_TIMEOUT_MS`), o Thinker tenta o próximo modelo de fallback do tier, na ordem configurada. A primeira tentativa que der certo atende a requisição; o cliente vê um único resultado.

- Cada tentativa fica registrada separadamente (provedor, modelo, status, custo). A requisição conta como "recuperada por fallback" quando termina com sucesso depois de uma tentativa falha.
- Se **todas** as tentativas falham, o cliente recebe o erro do provedor da última tentativa. Isso é um erro do provedor, não um código `M###`.
- Deixe `PROVIDER_TIMEOUT_MS` abaixo do timeout do cliente para o fallback ter tempo de rodar.

## Tiers customizados por cabeçalho

Além dos tiers padrão, você pode criar tiers que se ativam por um cabeçalho da requisição (por exemplo `x-thinker-tier: premium`), cada um com modelo principal e fallbacks. Quando uma regra casa, ela tem prioridade sobre o `model` do corpo e sobre a complexidade. O dashboard e a CLI (`thinker routing`) criam e editam essas regras.

## Limites e custos

Os custos vêm dos preços dos catálogos (veja `THINKER_CATALOG_SYNC` em [Configuração](configuracao.md)). Limites de uso e notificações por e-mail são configurados na página de limites do harness; estourar um limite responde `M200`.
