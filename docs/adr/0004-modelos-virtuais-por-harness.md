# ADR 0004 — Modelos virtuais por harness

- **Status:** aceito
- **Data:** 2026-10-25
- **Issue:** #176

## Contexto

Hoje um harness (agente) escolhe o roteamento de duas formas:

- **`model: "auto"`** passa pelo roteamento do agente: o tier Default, ou o roteamento por complexidade e por especificidade quando ele está ligado.
- **Um ID concreto** (`provedor/modelo`, `<alias>/<modelo>` de custom provider, ou um ID nativo sem prefixo que identifique uma só conexão) vira uma rota explícita, sem fallback.

Os **header tiers** (tiers custom, `routing/header-tiers/`) dão a um harness cadeias nomeadas com principal e até 5 fallbacks, mas só casam por um par cabeçalho/valor. Muitos clientes não deixam configurar cabeçalhos por modelo, entre eles Claude Code e a extensão Copilot do VS Code. Eles escolhem o modelo pelo campo `model` do corpo ou por um seletor alimentado por `GET /v1/models`. No upstream, o pedido equivalente é a issue aberta [mnfst/llm-gateway#2091](https://github.com/mnfst/llm-gateway/issues/2091). Ela não tem decisão nem PR, e os usuários contornam o problema com um shim que copia o `model` para um cabeçalho. Não há solução upstream para portar.

Estado verificado no código (`main` em `ee0770b`):

- `ProxyService.resolveRouting` (`routing/proxy/proxy.service.ts`) manda qualquer `model` diferente de `auto` para `resolveExplicitModel`. Nesse caminho um header tier que case **vence** o `model` explícito. Um nome que não resolve vira **M302**: no Thinker não há fallthrough de nome desconhecido para o roteamento (ao contrário do Manifest a partir da 6.15.0).
- `ResolveService.resolveHeaderTier` (`routing/resolve/resolve.service.ts`) ignora o tier quando ele não tem principal. Quando o principal está indisponível, promove o primeiro fallback disponível. Quando nada está disponível, devolve `null` e o pedido segue para o roteamento normal.
- `ResolveService.resolveLazy` aplica header tier e depois, se `agents.complexity_routing_enabled` estiver desligado, o slot `default`. Se estiver ligado, aplica especificidade e depois complexidade. A complexidade cai no slot `default` quando o tier pontuado não tem atribuição, ou quando não tem rota **e** não tem override. Um override configurado e inutilizável **não** cai no `default`: vira M302 ou M101.
- Heartbeats (`detectHeartbeatBody`, só no caminho `auto`) não passam por `resolveLazy`: vão direto para `resolveForTier(..., 'simple')` e nunca consultam header tiers.
- A cadeia de um slot de tier vem de `buildResolvedRouteChain`. Ela usa `override_route` ou, sem ele, o `auto_assigned_route` legado (`route-helpers.ts`). O override passa por `isRouteAvailable`; o `auto_assigned_route` e os fallbacks passam por `hasRouteCredentials` só até um deles virar o principal, e os fallbacks restantes seguem sem filtro. Só o principal escolhido é enriquecido com `enrichRouteKeyLabel`.
- Na escrita, um header tier guarda a rota como veio quando `resolveModelRoute` falha (`header-tier.service.ts`), e `resolveModelRoute` não preenche nem confere o `keyLabel`.
- `header_tiers` (`entities/header-tier.entity.ts`) guarda `override_route` e `fallback_routes` como `jsonb` de `ModelRoute` (`provider`, `authType`, `model`, `keyLabel`), além de `response_mode` e `output_modality`. O índice único `(agent_id, LOWER(name))` é declarado na migração `1776710000000-AddHeaderTiers`. Os DTOs limitam os fallbacks a 5 (`@ArrayMaxSize(5)` em `routing/dto/routing.dto.ts`).
- `ProxyController.models()` (`routing/proxy/proxy.controller.ts`) publica `auto` (sem metadados) e depois os IDs públicos de `openAiModelId` (`routing/routing-core/public-model-id.ts`): `provedor/modelo`, `provedor/modelo-subscription`, `<alias>/<modelo>` para custom providers com alias e `custom:<uuid>/<modelo>` para custom providers sem alias (nesse caso o ID interno é também o público). Nenhuma entrada tem `context_length` hoje. O catálogo descoberto (`DiscoveredModel.contextWindow`) tem o dado.
- `buildMetaHeaders` (`routing/proxy/proxy-response-handler.ts`) emite `X-Thinker-Tier`, `-Model`, `-Provider`, `-Confidence`, `-Reason`, `-Output-Modality`, `-Response-Mode`, `-Specificity`, `-Fallback-From`, `-Fallback-Index` e, ao esgotar a cadeia, `X-Thinker-Fallback-Exhausted`.
- Os parâmetros por modelo (`entities/agent-model-params.entity.ts`, `routing/routing-core/agent-model-params.service.ts`) são escopados por `scope_key` (`tier:<slot>`, `specificity:<cat>`, `header:<id>`, de `thinker-shared/model-params-scope.ts`). O proxy calcula **um** `scopeKey` por requisição e o repassa a todas as tentativas da cadeia (`ParamMergeContext` em `proxy-fallback.service.ts`). Rotas explícitas não aplicam parâmetros (`explicit_model_override`).
- O catálogo de erros (`common/errors/error-codes.ts`, `docs/erros.md`) usa M300 e M302 na faixa M3xx. M303 já existiu (rejeição cloud-only, removida) e não deve ser reaproveitado. **M301 está livre.**
- As ferramentas MCP de tiers custom são `thinker_routing_custom_list`, `_create` e `_delete` (`mcp/tools/routing.tools.ts`). A CLI tem `thinker routing custom ...` (`packages/cli/src/commands/routing.ts`).

As decisões de produto deste ADR foram tomadas com o mantenedor em 25/10/2026. Os itens que eram recomendação foram confirmados pelo mantenedor na revisão do PR #185 e estão listados em "Pontos confirmados na revisão".

## Decisão

### 1. Conceito

Um **modelo virtual** é um nome público que o operador cria em um harness. Cada modelo virtual tem uma cadeia própria de modelos. Ele:

- aparece em `GET /v1/models` para as chaves daquele harness, logo depois de `auto`;
- é aceito no campo `model` de `/v1/chat/completions`, `/v1/responses` e `/v1/messages`;
- roteia pela sua cadeia (principal e fallbacks) e, se configurado, continua na cadeia do Default.

Um harness pode ter quantos modelos virtuais quiser. Eles ficam em uma **tabela própria**, `virtual_models`. Os header tiers continuam como estão: não ganham campo de alias e não mudam de comportamento.

A cadeia de um virtual é feita só de rotas concretas (`ModelRoute`). Um virtual não aponta para outro virtual, para `auto` nem para um header tier, então não existe recursão.

### 2. Esquema da tabela `virtual_models`

Migração nova, só PostgreSQL (o único banco suportado):

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `varchar` PK | UUID gerado no serviço, como em `header_tiers` |
| `tenant_id` | `varchar NOT NULL` | tenant dono; toda consulta da API filtra por ele |
| `agent_id` | `varchar NOT NULL` | FK `agents(id) ON DELETE CASCADE` |
| `name` | `varchar(64) NOT NULL` | nome público, guardado com a grafia que o operador digitou |
| `sort_order` | `integer NOT NULL DEFAULT 0` | ordem em `/v1/models` e no dashboard |
| `enabled` | `boolean NOT NULL DEFAULT true` | desativado = invisível e sem efeito (seção 5) |
| `override_route` | `jsonb NULL` | principal (`ModelRoute`) |
| `fallback_routes` | `jsonb NULL` | até 5 `ModelRoute`, em ordem |
| `continue_on_default` | `boolean NOT NULL DEFAULT false` | "continuar no Default" (seção 4) |
| `response_mode` | `varchar NOT NULL DEFAULT 'buffered'` | mesmo domínio dos tiers |
| `output_modality` | `varchar NOT NULL DEFAULT 'text'` | mesmo domínio dos tiers |
| `created_at`, `updated_at` | `timestamp NOT NULL DEFAULT NOW()` | |

Índices:

- `UNIQUE (agent_id, LOWER(name))`, declarado **na migração**, como em `header_tiers`, e não redeclarado na entidade;
- `(agent_id, sort_order)`.

A mesma migração acrescenta a `agent_messages` as colunas `virtual_model_id varchar NULL` e `virtual_model_name varchar NULL`, desnormalizadas como `header_tier_*`, para que linhas antigas guardem o nome usado na época.

Nenhum dado existente migra: a tabela nasce vazia, e as colunas novas de `agent_messages` ficam `NULL` nas linhas antigas. O `down` remove as colunas e a tabela.

**Validação estrita na escrita, diferente dos header tiers.** Cada rota (principal e fallbacks) passa por `resolveModelRoute` / `resolveFallbackRoutes`. Uma rota que não resolve para um provedor habilitado no agente devolve **400**, com o modelo na mensagem; ela não é guardada como veio, ao contrário do que `header-tier.service.ts` faz. O `keyLabel` **não** é enriquecido na escrita: um `keyLabel` enviado é validado (se não existir para o provedor, 400) e guardado; sem ele, a rota guarda `null` e segue a chave padrão do provedor, resolvida na hora do pedido (seção 4, passo 3), como nos tiers. Gravar a chave padrão na escrita congelaria o virtual nela quando o operador trocasse a padrão.

### 3. Validação do nome

- 1 a 64 caracteres, de `[A-Za-z0-9._:/-]`, ou seja, a expressão `^[A-Za-z0-9._:-]+(/[A-Za-z0-9._:-]+)*$`: sem `/` no início ou no fim e sem `//`. Exemplos válidos: `deepseek`, `deepseek/flash`, `deepseek/free`, `xxx/yyy`.
- Único por agente, **sem diferenciar maiúsculas** (o índice garante, e o serviço devolve 409 legível antes de bater no índice). Virtuais desativados também ocupam o nome.
- Reservado: `auto`, em qualquer grafia.
- Colisão com um ID real **é permitida**. A API devolve, em cada virtual, a lista `shadows` com os IDs reais que ele sombreia agora (seção 6), e o dashboard mostra um aviso na criação e na edição.

O nome não pode ter espaço, aspas nem caracteres de controle, então ele cabe direto em um cabeçalho HTTP (`X-Thinker-Virtual-Model`) e em URLs sem escape especial.

### 4. Montagem da cadeia e "continuar no Default"

Quando um virtual ativo casa com o pedido, o resolvedor monta a cadeia nesta ordem:

1. **Cadeia do virtual:** `override_route` seguido de `fallback_routes`. Saem as rotas cujo provedor, modelo ou credencial não está disponível (`isRouteAvailable`, a mesma checagem do header tier).
2. **Se `continue_on_default` estiver ligado, a cadeia do Default** é acrescentada ao fim. "Cadeia do Default" é a cadeia que `buildResolvedRouteChain` produz para o slot `default`, a mesma que `resolveForTier(agentId, tenantId, 'default')` usa hoje, **antes** do filtro de transporte (`effectiveRoutesForResponseMode`) que `resolveForTier` aplica:
   - `override_route` do slot `default` ou, sem ele, o `auto_assigned_route` legado, para que instalações atualizadas cujo Default só tem rota auto-atribuída continuem roteáveis;
   - os fallbacks do slot, com o filtro de credenciais (`hasRouteCredentials`) que esse resolvedor já aplica até escolher o principal. Os fallbacks restantes passam pelo filtro de disponibilidade do passo 1 antes de entrar na cadeia do virtual.

   O `response_mode` do próprio Default não é aplicado aqui; vale o do virtual (passo 4).
3. **Normalização e deduplicação:** as rotas das duas partes são normalizadas com `enrichRouteKeyLabel` **na hora do pedido**, inclusive os fallbacks do Default, que hoje o resolvedor não enriquece. Depois disso, uma rota que já está na cadeia não se repete. A chave é `(provider, authType, model, keyLabel)`: duas chaves diferentes do mesmo modelo são rotas diferentes, mas `(openai, api_key, gpt-x, sem rótulo)` e `(openai, api_key, gpt-x, "Main")`, quando o rótulo vazio resolve para `"Main"`, viram a mesma rota. A primeira rota que sobra vira o principal efetivo, e pode vir do Default.
4. **Filtro de transporte:** `effectiveRoutesForResponseMode` com o `response_mode` **do virtual**, aplicado à cadeia inteira, inclusive à parte que veio do Default. A requisição tem um só transporte e uma só modalidade de saída, e as duas são as do virtual.

Resultado:

- **Sobra rota:** o proxy tenta na ordem, com o mecanismo de fallback em tempo de execução que já existe (mesmos status de gatilho, aquecimento de stream, `X-Thinker-Fallback-*`). Com a opção ligada, a parte do Default vale tanto para indisponibilidade (passo 1) quanto para falha em tempo de execução: a cadeia acrescentada é tentada como fallbacks comuns.
- **Não sobra rota:** o proxy responde com o novo erro **M301**, "Modelo virtual sem rota disponível", e o nome do virtual na mensagem. Isso vale com a opção desligada e também com ela ligada e o Default vazio. Não há queda silenciosa para `auto` nem para outra regra.
- **Falha em tempo de execução que esgota a cadeia:** o comportamento atual de cadeia esgotada (`X-Thinker-Fallback-Exhausted`, com o status e o erro do provedor principal).

**Interação com o roteamento por complexidade.** A cadeia acrescentada é sempre a do slot `default`, com o roteamento por complexidade ligado ou desligado. O pedido para um virtual **não** passa pelo scorer, pela especificidade nem pelo momentum. Os motivos:

- a cadeia é determinística e o custo é previsível para quem escolheu um nome fixo;
- o hot path não ganha o custo do scoring;
- o `context_length` publicado (seção 7) pode ser calculado sem conhecer o corpo do pedido;
- o slot `default` já é o "pega-tudo" do roteamento por complexidade (é para ele que um tier pontuado sem atribuição, ou sem rota e sem override, cai), então "continuar no Default" quer dizer a mesma coisa nos dois modos.

Com 1 principal e 5 fallbacks de cada lado, a cadeia tem no máximo 12 tentativas.

### 5. Precedência no proxy

Para cada requisição em `/v1/chat/completions`, `/v1/responses` e `/v1/messages`:

1. **Modelo virtual ativo** cujo `name` case com `model`: igualdade de string sem diferenciar maiúsculas, sem prefixo nem outra normalização.
2. **Header tier** que case com os cabeçalhos.
3. **`auto`** → roteamento atual (`resolveLazy`); **ID real** → rota explícita (`resolveExplicitModel`); **desconhecido** → M302.

Consequências da regra:

- O virtual vence o header tier. Quem manda um cabeçalho de tier e `model: "deepseek"` recebe o virtual. Nenhuma instalação tem virtuais hoje, então nada que funciona agora muda de comportamento.
- Um virtual desativado não entra no passo 1, e o pedido segue para os passos 2 e 3: o ID real volta a resolver, ou o pedido recebe M302.
- O passo 1 não roda quando `model` está ausente ou é `auto`, porque `auto` é reservado.
- A implementação extrai o passo 1 para antes do desvio entre `auto` e explícito em `resolveRouting`. A busca do header tier sai de `resolveExplicitModel` **e também de `resolveLazy`**, para não rodar duas vezes, e vira um passo comum aos dois caminhos, o que mantém a ordem 2 → 3 que existe hoje. `ResolveService.resolve()`, usado só por `resolve.controller.ts`, hoje não recebe cabeçalhos e portanto não aplica header tiers; retirar a chamada de `resolveLazy` preserva esse comportamento, e o endpoint `POST /api/v1/routing/resolve` continua sem aplicar header tiers.
- **Heartbeats continuam como hoje.** Um pedido `auto` detectado como heartbeat vai direto para `resolveForTier(..., 'simple')` e **pula o passo 2**, mesmo com o cabeçalho de um tier. Um `model` virtual explícito nunca é heartbeat, porque a detecção só roda no caminho `auto`.

### 6. Interação com a resolução de modelos explícitos (sombreamento)

O casamento é pela **string** que o cliente mandou em `model`, não pelo modelo que ela representaria:

- Um virtual chamado `openai/gpt-5.5` sombreia o ID público `openai/gpt-5.5`. Enquanto ele estiver ativo, `model: "openai/gpt-5.5"` usa o virtual.
- Um virtual chamado `claude-sonnet-4-5`, sem prefixo, sombreia o **ID nativo** `claude-sonnet-4-5`. Esse ID não aparece em `/v1/models`, mas `resolveExplicitModel` o aceita (catálogo, preferência de assinatura em `subscriptionPreferredRoute`, ou conexão única em `resolveConnectedExplicitModel`). É o que clientes Anthropic mandam em `/v1/messages`. O virtual captura esses pedidos, e este é o caso que mais pede aviso.
- Grafias diferentes do mesmo modelo não são sombreadas. O virtual `gpt-5.5` não captura `openai/gpt-5.5`, e o inverso também vale.
- `custom:<uuid>/<modelo>` de um custom provider **sem** alias é o ID público desse modelo: ele entra em `shadows` e na ocultação da seção 7 como qualquer outro. Para um custom provider **com** alias, o `custom:<uuid>/<modelo>` continua aceito pelo resolvedor mas não é publicado; ele pode ser sombreado como qualquer string, e o aviso não o lista.

A lista `shadows` que a API devolve tem os IDs que casam, sem diferenciar maiúsculas, com o nome do virtual: os públicos (`openAiModelId`) e os nativos (`DiscoveredModel.id`) do catálogo atual do agente. Ela é calculada na leitura, porque o catálogo muda quando provedores entram e saem. Um virtual criado sem colisão pode passar a sombrear um modelo mais tarde, e o dashboard mostra isso na listagem, não só na criação.

A cadeia de um virtual pode conter o próprio modelo que ele sombreia (por exemplo, `claude-sonnet-4-5` com principal `anthropic/claude-sonnet-4-5` e fallbacks). Esse é um uso legítimo: dar fallback a um nome que o cliente não deixa trocar.

O modelo enviado ao provedor é sempre o da rota escolhida. O nome do virtual nunca vaza para o upstream.

### 7. `GET /v1/models`

Ordem da resposta:

1. `auto`;
2. os virtuais **ativos** do agente da chave, por `sort_order` e depois `name`;
3. os modelos reais, **menos** os que têm ID público igual, sem diferenciar maiúsculas, ao nome de um virtual ativo.

Entrada de um virtual:

```json
{ "id": "deepseek/flash", "object": "model", "created": 0, "owned_by": "thinker", "context_length": 128000 }
```

- `owned_by: "thinker"`, como em `auto`.
- Virtuais e `auto` **não** trazem `capabilities` nem `cost`, mesmo com `?capabilities=true` / `?cost=true`, porque o modelo concreto muda conforme a disponibilidade e as falhas. Com `?route_metadata=true` eles também não trazem `provider_model_id` nem `auth_type`.
- **`context_length`** é a menor `contextWindow` entre as rotas **disponíveis** da cadeia efetiva (seção 4, passos 1 a 4, sem tentativa em tempo de execução). O campo é omitido se a janela de alguma rota for desconhecida (ausente ou ≤ 0 no catálogo descoberto) ou se a cadeia estiver vazia.
- O cálculo usa **um único snapshot** de `getModelsForAgent` por requisição de `/v1/models`, o mesmo que a listagem já carrega, para a janela e para a disponibilidade de cada rota. Ele não chama `isRouteAvailable` rota a rota: com virtuais sem limite, de até 12 rotas cada, o custo cresceria com a configuração, e com cache frio cada chamada pode cair no fallback de descoberta. Uma rota cuja conexão não tem modelos no snapshot conta como janela desconhecida, e o `context_length` é omitido, para não sair superestimado.
  - **Virtual:** a cadeia do virtual mais a do Default, quando `continue_on_default` estiver ligado.
  - **`auto`, roteamento por complexidade desligado:** a cadeia do Default, no mesmo sentido da seção 4, passo 2 (inclui o `auto_assigned_route` legado).
  - **`auto`, roteamento por complexidade ligado:** o mínimo entre as cadeias de todos os destinos que `auto` pode alcançar sem cabeçalho: os slots `simple`, `standard`, `complex`, `reasoning` e `default` (cada um montado como em `buildResolvedRouteChain`), mais as atribuições de especificidade ativas. Header tiers ficam de fora porque exigem cabeçalho.
- Os modelos reais continuam sem `context_length`. Publicar o campo para eles fica fora deste ADR.
- Cada chave só vê os virtuais do próprio agente. A lista sai do mesmo `agentId` que o `AgentKeyAuthGuard` já resolve.

### 8. Observabilidade

- **Cabeçalhos de resposta:** `X-Thinker-Reason: virtual-model` e o novo `X-Thinker-Virtual-Model: <nome>`, com a grafia cadastrada. `X-Thinker-Fallback-From`, `X-Thinker-Fallback-Index` e `X-Thinker-Fallback-Exhausted` seguem valendo dentro da cadeia, inclusive na parte que veio do Default. `X-Thinker-Tier` recebe `default`, porque um virtual não é um slot de complexidade e o slot de cada rota não é exposto.
- **Log de mensagens:** `agent_messages.virtual_model_id` e `virtual_model_name` são gravados em toda linha do pedido, nas tentativas, no sucesso e nos erros, inclusive M301. O `routing_reason` é `virtual-model`. Os campos `header_tier_*` ficam `NULL` quando o virtual casou.
- **Erro M301:** entra em `error-codes.ts`, em `THINKER_ERRORS`, no mapeamento de `routing_reason` de `thinker-error.ts` (novo valor `virtual_model_unavailable`, classificado em `thinker-shared` como os demais bloqueios do Thinker) e em `docs/erros.md`. O link aponta para a tela Routing do harness.
- **Logs do servidor:** uma linha `debug` por casamento, com agente, virtual, tamanho da cadeia e quantas rotas vieram do Default. Rotas descartadas por indisponibilidade geram `warn`, como no header tier.

### 9. Parâmetros por modelo

Os parâmetros por modelo **se aplicam** aos virtuais, com um escopo próprio:

- novo escopo `virtual:<id>`, com `modelParamsScopeForVirtualModel(id)` em `thinker-shared/model-params-scope.ts`;
- as rotas da cadeia do virtual usam `virtual:<id>`. As rotas acrescentadas pelo Default usam `tier:default`, o escopo onde o operador as configurou;
- para isso, o escopo passa a ser **por rota**: cada entrada da cadeia resolvida carrega o seu `paramsScope`, e `ParamMergeContext` deixa de ter um `scopeKey` único por requisição. As outras origens (tier, especificidade e header tier) continuam com um escopo só, igual para todas as rotas;
- o escopo por rota vale também **fora** do `ParamMergeContext`: no lookup de `modelParamsService.get` e no `snapshotRequestParams` do principal efetivo (`proxy.service.ts`), e na re-derivação do `request_params` gravado quando um fallback tem sucesso. Um principal efetivo que vem do Default (todas as rotas do virtual indisponíveis) usa `tier:default` nos três pontos;
- apagar um virtual apaga as linhas `agent_model_params` com `scope_key = 'virtual:<id>'`;
- os seletores de parâmetros ganham um seletor `virtual` próprio, separado do nome de tier: campo `virtual: <nome>` em `thinker_routing_params_get`/`_set`, `--virtual <nome>` em `thinker routing params get|set`, exclusivos com `tier`. Virtuais e header tiers ficam em tabelas diferentes, sem unicidade cruzada, e podem ter o mesmo nome no mesmo agente: sobrecarregar `tier` gravaria no escopo errado. O endpoint REST de parâmetros aceita o escopo `virtual:<id>`.

Um pedido para um virtual **não** é uma rota explícita: `explicit_model_override` fica falso e os parâmetros são aplicados.

### 10. Efeito no hot path

- A lista de virtuais do agente fica no `RoutingCacheService`, como `getHeaderTiers`/`setHeaderTiers`, e é invalidada por qualquer escrita em virtuais, pela invalidação por agente/tenant que já existe e por mudanças no slot `default` (por causa de `continue_on_default`). Com cache quente, o passo 1 é uma busca em memória sem consulta ao banco.
- A montagem da cadeia faz as mesmas checagens de disponibilidade do header tier para a parte do virtual e as de `buildResolvedRouteChain` para a do Default, mais um `enrichRouteKeyLabel` por rota, até 12 rotas no pior caso, e não roda o scorer.
- `GET /v1/models` passa a ler as atribuições de tier para calcular `context_length`. Essa leitura já é cacheada por `TierService`, e a disponibilidade sai do snapshot da descoberta que a listagem já carrega (seção 7).
- Modos de falha: cache frio = uma consulta extra por agente; virtual com cadeia toda indisponível = M301 imediato, sem chamada a provedor.

### 11. Segurança e isolamento

- A API administrativa fica sob `/api/v1/routing/:agentName/...`, com a mesma autenticação de sessão e o mesmo escopo de tenant dos header tiers. `id` de outro agente ou tenant devolve 404.
- O proxy só considera virtuais do `agentId` da chave. Um harness não vê nem usa virtuais de outro.
- As rotas são validadas de forma estrita contra os provedores habilitados para o agente no momento da escrita (400 se não resolverem, seção 2) e conferidas de novo em cada pedido (seção 4, passos 1 e 2). Uma credencial removida depois da escrita não fica alcançável por um virtual.
- As rotas de escrita de virtuais seguem a mesma regra de papel das rotas de header tiers. Quando a v0.3 trouxer os papéis owner/admin/member/viewer, as duas famílias de rotas recebem a mesma restrição.
- Nenhum destino de saída novo: as regras de "sem phone-home" e do [ADR 0003](0003-excecao-catalogos-publicos.md) não mudam.

### 12. Superfícies

**API** (`/api/v1/routing/:agentName/virtual-models`), em paridade com `header-tiers`:

| Método e caminho | Efeito |
|---|---|
| `GET /` | lista em `sort_order`, com `shadows` e `context_length` calculados |
| `POST /` | cria: `name`, e opcionais `override_route`, `fallback_routes`, `continue_on_default`, `response_mode`, `output_modality` |
| `PUT /:id` | edita `name`, `continue_on_default` e `output_modality` |
| `PATCH /:id/toggle` | ativa ou desativa |
| `PATCH /:id/response-mode` | troca o modo de resposta, com a guarda de stream dos tiers |
| `PUT /:id/override` e `DELETE /:id/override` | define ou limpa o principal |
| `PUT /:id/fallbacks` e `DELETE /:id/fallbacks` | define (até 5) ou limpa os fallbacks |
| `POST /reorder` | nova ordem por lista de `id` |
| `DELETE /:id` | apaga o virtual e os seus parâmetros por modelo |

Erros: 400 para nome inválido ou reservado, 409 para nome duplicado, 404 para `id` de outro agente. Os tipos de request e response vão para `thinker-shared`.

**Dashboard.** Uma seção própria, "Virtual models", na tela Routing do harness, separada dos tiers custom, com UI em inglês como o resto da v0.1:

- cartões com nome, principal, fallbacks, o interruptor "Continue on Default", o modo de resposta e o estado ativo/inativo;
- modal de criação e edição com validação ao vivo do nome e aviso de sombreamento a partir de `shadows`;
- ordenação por arraste;
- exemplo copiável com a base URL do agente e `model: "<nome>"`;
- o log de mensagens e o detalhe da mensagem mostram o virtual usado.

**MCP**, em paridade com os tiers custom:

- `thinker_routing_virtual_list`, `thinker_routing_virtual_create` (nome, modelo, fallbacks, `continue_on_default`), `thinker_routing_virtual_update` e `thinker_routing_virtual_delete`;
- `thinker_routing_status` lista os virtuais;
- `thinker_routing_test` aceita um nome de virtual em `model`;
- `thinker_routing_params_get`/`_set` ganham o campo `virtual: <nome>`, exclusivo com `tier` (seção 9);
- as ferramentas que alteram dados seguem a mesma regra de escrita das existentes.

**CLI:**

- `thinker routing virtual list|create|update|delete|enable|disable`, com `--model`, `--fallback` (repetível) e `--continue-on-default`;
- `thinker routing status` inclui os virtuais;
- `thinker routing test --model <virtual>` funciona;
- `thinker routing params get|set --virtual <nome>`, exclusivo com o nome de tier (seção 9);
- `delete` exige `--yes`, como `routing custom delete`.

**Snippets de setup.** As telas de setup dos harnesses (`ClaudeCodeSetup`, `CodexSetup`, `OpenCodeSetup`, `HermesSetup`, `OpenClawSetup`, `NanobotSetup`, `FrameworkSnippets` etc.) mostram os nomes dos virtuais ativos como valores possíveis de `model`, ao lado de `auto`. Quando o harness lê o seletor de `/v1/models`, elas explicam que os virtuais aparecem nele.

**Documentação (PT-BR):**

- `docs/usuario/provedores-e-roteamento.md` ganha uma seção sobre modelos virtuais;
- `docs/usuario/conectar-harnesses.md` mostra como escolher um virtual;
- `docs/usuario/cli.md` documenta os comandos novos;
- `docs/erros.md` ganha o M301;
- a seção de roteamento documenta os cabeçalhos de resposta `X-Thinker-*`, incluindo `X-Thinker-Virtual-Model` e o motivo `virtual-model` (hoje nenhuma página de `docs/` lista esses cabeçalhos);
- a skill (`packages/cli/skill/SKILL.md` e o gerado `packages/cli/src/skill-content.gen.ts`) é atualizada;
- `docs/dev/guia.md` é atualizado na seção de roteamento.

### 13. Plano de testes (resumo)

- **Unitários:**
  - validação do nome (charset, `/`, tamanho, `auto` em qualquer grafia, duplicado sem diferenciar maiúsculas);
  - montagem da cadeia (deduplicação depois de `enrichRouteKeyLabel`, inclusive rota sem rótulo × mesma rota com rótulo, disponibilidade, filtro de stream, Default acrescentado ou não, complexidade ligada ou desligada);
  - Default só com `auto_assigned_route` legado: `continue_on_default` usa essa rota em vez de dar M301, e o `context_length` de `auto` continua presente;
  - validação estrita na escrita: rota de provedor não habilitado e `keyLabel` inexistente devolvem 400;
  - precedência virtual > header tier > auto/explícito;
  - cálculo de `shadows` e de `context_length`;
  - escopo de parâmetros por rota, incluindo o caso "virtual todo indisponível e principal vindo do Default": o principal usa `tier:default` no merge e no `request_params` gravado;
  - seletor `virtual` dos parâmetros no MCP e na CLI, com um virtual e um header tier de mesmo nome no agente.
- **e2e do backend:**
  - CRUD com isolamento entre agentes e tenants;
  - `/v1/models` (ordem, ocultação do real sombreado, `context_length` presente ou omitido, sem `capabilities`/`cost`);
  - proxy nos três endpoints com o virtual;
  - M301;
  - virtual desativado volta ao ID real ou M302;
  - heartbeat `auto` com o cabeçalho de um header tier continua indo para o slot `simple`, sem casar o tier;
  - `POST /api/v1/routing/resolve` (via `ResolveService.resolve()`) continua sem aplicar header tiers;
  - linhas de `agent_messages` com as colunas novas.
- **`qa-docker`, contra a imagem local:**
  - criar o virtual `deepseek/flash` sem cabeçalho e vê-lo em `/v1/models` com a chave do harness, mas não com a chave de outro harness;
  - chamar os três endpoints com `model: "deepseek/flash"` e conferir `X-Thinker-Reason: virtual-model` e `X-Thinker-Virtual-Model`;
  - derrubar o principal (credencial inválida num provedor custom local) e conferir o fallback e `X-Thinker-Fallback-*`;
  - com a cadeia toda quebrada, ver M301 com "continuar no Default" desligado e o Default respondendo com a opção ligada;
  - um virtual com nome de um ID nativo é usado em `/v1/messages`, e o ID real some de `/v1/models`;
  - desativar o virtual e ver o ID real voltar;
  - conferir que `auto`, um header tier existente e um heartbeat com cabeçalho de tier se comportam como antes;
  - conferir que o upstream nunca recebe o nome do virtual (log do provedor custom de teste);
  - migração `up` sobre um banco com dados da 0.1.1, seguida de `down` e `up`.

## Alternativas consideradas

- **Alias dentro do header tier** (`model_alias` opcional em `header_tiers`, com o cabeçalho opcional), como sugeria a análise feita sobre o Manifest. Descartada: mistura dois gatilhos numa entidade só, obriga a tornar `header_key`/`header_value` anuláveis, complica a precedência dentro do mesmo registro e deixa a UI dos tiers ambígua. Uma tabela própria deixa cada conceito com a sua regra e não toca nos tiers existentes.
- **Prefixo fixo `thinker/<tier>`** casando com o nome de um header tier, como sugeria a classificação inicial da #176. Descartada: amarra o nome público ao prefixo do produto, impede nomes como `deepseek` ou `deepseek/free` e continua dependendo da entidade dos tiers.
- **Header tier vence o virtual** (manter a regra atual de que o cabeçalho sobrepõe o `model`). Descartada: o virtual é escolhido nominalmente pelo cliente, que pediu aquele nome; e o cabeçalho continua valendo para `auto` e para IDs reais.
- **Proibir colisão com IDs reais.** Descartada: o catálogo muda depois da criação, então a proibição não se sustenta, e sombrear um ID nativo é justamente o que dá fallback a clientes que não deixam trocar o nome do modelo.
- **"Continuar no Default" rodando o pipeline completo de `auto`** (scorer, especificidade, momentum) em vez do slot `default`. Descartada: custo imprevisível, scoring no hot path e um `context_length` impossível de publicar com honestidade.
- **Nome desconhecido caindo no roteamento** (como no Manifest 6.15.0). Fora de escopo e contrário ao comportamento atual do Thinker (M302). Um virtual é a forma explícita de dar um nome que roteia.
- **Shim externo** que traduz `model` para cabeçalho e injeta entradas em `/v1/models`. Descartada: mais um componente para o operador manter, sem log nem dashboard.

## Consequências

- Clientes que só escolhem o modelo pelo `model` ou por `/v1/models` (Claude Code, Copilot, Hermes e outros) passam a ter cadeias nomeadas com fallback, sem cabeçalho.
- `auto` ganha `context_length` em `/v1/models`, o que resolve, de quebra, a queixa de clientes como o Hermes (mnfst/llm-gateway#3078).
- A precedência muda num ponto: um `model` que casa com um virtual ativo passa à frente do header tier. Isso não afeta instalações existentes, que não têm virtuais.
- Um virtual pode capturar um ID real, inclusive um nativo que não aparece em `/v1/models`. O risco é mitigado pelo aviso no dashboard e por `shadows` na API, e o operador desfaz desativando o virtual.
- O escopo de parâmetros por modelo passa a ser por rota. É uma mudança interna no `ProxyFallbackService`, com testes próprios.
- A configuração continua por harness. Quem quiser o mesmo virtual em vários harnesses repete a configuração; templates no nível do tenant (mnfst/llm-gateway#2965) ficam para outro momento.
- Os header tiers ficam como estão. Unificar as duas entidades no futuro exige um novo ADR.
- A entrega sai em release própria na linha v0.1.x, sem esperar a v0.2. A release em si depende de aprovação do mantenedor ([ADR 0002](0002-politica-de-merge.md)).

## Plano de entrega

PRs em sequência, cada um com o seu changeset. O mesmo plano vai para a #176.

1. **`feat(backend)`: entidade, migração e API de modelos virtuais.** Agente: `backend-dev`.
   - Escopo:
     - tabela `virtual_models` e colunas `agent_messages.virtual_model_*`, com `up` e `down`;
     - entidade, `VirtualModelService` (validação do nome, validação estrita das rotas com 400, `keyLabel` validado quando enviado e `null` quando ausente, cache no `RoutingCacheService`, invalidação), controller CRUD/toggle/reorder/override/fallbacks/response-mode;
     - `shadows` e `context_length` na listagem (snapshot único de `getModelsForAgent`);
     - tipos em `thinker-shared`;
     - limpeza de `agent_model_params` ao apagar;
     - testes unitários e e2e da API.
   - Sem mudança no proxy.
   - Dependências: este ADR aceito.
2. **`feat(backend)`: resolução de modelos virtuais no proxy.** Agente: `backend-dev`.
   - Escopo:
     - passo 1 da precedência em `resolveRouting`, com o header tier extraído como passo comum (fora de `resolveExplicitModel` e de `resolveLazy`; `resolve()` continua sem header tiers; heartbeats continuam pulando o passo);
     - montagem da cadeia com `continue_on_default`, usando a cadeia de `buildResolvedRouteChain` do slot `default` e `enrichRouteKeyLabel` antes da deduplicação;
     - M301 (catálogo, `routing_reason`, classificação em `thinker-shared`, `docs/erros.md`);
     - `X-Thinker-Reason: virtual-model` e `X-Thinker-Virtual-Model`;
     - gravação de `virtual_model_*` em todas as linhas;
     - escopo de parâmetros por rota (`virtual:<id>` / `tier:default`), também no principal efetivo e no `request_params` gravado;
     - testes nos três endpoints e no caso do heartbeat com cabeçalho de tier.
   - Exige `qa-docker`.
   - Dependências: PR 1.
3. **`feat(backend)`: `/v1/models` com virtuais e `context_length`.** Agente: `backend-dev`.
   - Escopo:
     - ordem `auto` → virtuais → reais;
     - ocultação dos reais sombreados;
     - `context_length` para `auto` e para os virtuais, com snapshot único de `getModelsForAgent` por requisição;
     - testes de isolamento entre chaves e do Default só auto-atribuído.
   - Exige `qa-docker`.
   - Dependências: PR 1. Pode correr em paralelo com o PR 2.
4. **`feat(frontend)`: seção "Virtual models" na tela Routing.** Agente: `frontend-dev`.
   - Escopo:
     - cartões, modal com validação e aviso de sombreamento, ordenação, interruptores, exemplo copiável;
     - o virtual no log de mensagens e no detalhe;
     - testes de componente.
   - Dependências: PR 1. Para a exibição no log, PR 2.
5. **`feat(mcp,cli)`: modelos virtuais no MCP e na CLI.** Agente: `backend-dev`.
   - Escopo:
     - ferramentas `thinker_routing_virtual_*`;
     - virtuais em `thinker_routing_status`;
     - `thinker_routing_test` com virtual;
     - seletor `virtual` em `thinker_routing_params_get`/`_set`;
     - `thinker routing virtual ...`, `routing status`, `routing test` e `routing params get|set --virtual`;
     - testes.
   - Dependências: PRs 1 e 2.
6. **`feat(frontend)`: virtuais nos snippets de setup dos harnesses.** Agente: `frontend-dev`.
   - Dependências: PR 1. Pode entrar junto com o PR 4, se ficar pequeno.
7. **`docs`: modelos virtuais (PT-BR).** Agente: `docs-ptbr`.
   - Escopo:
     - roteamento (com os cabeçalhos `X-Thinker-*`), conexão de harnesses, CLI e erros;
     - skill;
     - guia de desenvolvimento;
     - notas da release.
   - Dependências: PRs 2, 3 e 5.
8. **Validação final e release v0.1.x.**
   - `qa-docker` roda o roteiro completo da seção 13 contra a imagem local de `main`.
   - `devops` prepara o PR de versão do Changesets: v0.1.2, se nenhuma outra release sair antes.
   - O mantenedor aprova o merge do PR de versão e a publicação.
   - Dependências: PRs 1 a 7.

## Pontos confirmados na revisão

Itens que este ADR propôs como recomendação e que o mantenedor confirmou em 25/10/2026:

1. **Regra do nome:** 1 a 64 caracteres de `[A-Za-z0-9._:/-]`, sem `/` no início ou no fim nem `//`, único por agente sem diferenciar maiúsculas (desativados incluídos), só `auto` reservado.
2. **Campos da cadeia iguais aos dos tiers:** `response_mode`, `output_modality` e `keyLabel` por rota. O `response_mode` e o `output_modality` do virtual também valem para a parte da cadeia que vem do Default.
3. **Virtual desativado:** some de `/v1/models` e deixa de sombrear o ID real (resolução normal ou M302).
4. **Observabilidade:**
   - `X-Thinker-Reason: virtual-model` e o cabeçalho novo `X-Thinker-Virtual-Model`;
   - `X-Thinker-Tier: default` para virtuais;
   - colunas `virtual_model_id`/`virtual_model_name` em `agent_messages`;
   - `X-Thinker-Fallback-*` valendo dentro da cadeia.
5. **"Continuar no Default" com o roteamento por complexidade ligado:** acrescenta sempre a cadeia do slot `default`, sem rodar o scorer nem a especificidade (seção 4).
6. **`context_length` de `auto` com o roteamento por complexidade ligado:** o mínimo entre os slots de complexidade, o `default` e as especificidades ativas, sem header tiers. Para os virtuais e para `auto`, só entram rotas disponíveis (seção 7).
7. **Parâmetros por modelo nos virtuais:** escopo `virtual:<id>`, com as rotas vindas do Default usando `tier:default`, inclusive quando o principal efetivo vem do Default. Isso exige escopo por rota no proxy, também no snapshot `request_params` (seção 9).
8. **Código de erro M301** para "modelo virtual sem rota disponível", também quando "continuar no Default" está ligado e o Default está vazio.
9. **Deduplicação da cadeia acrescentada** por `(provider, authType, model, keyLabel)`: a mesma rota com outra chave conta como rota diferente.
10. **Nenhum limite** de quantidade de virtuais por harness, conforme a entrevista. O ADR não impõe teto técnico.
