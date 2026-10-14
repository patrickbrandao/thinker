# Terminologia e métricas de análise

Contrato canônico da terminologia e das métricas de análise do Thinker. Esquema, API, análises e interface devem usar estas definições de forma consistente. Este documento define conceitos e regras de contagem; não define layout de página nem comportamento do frontend. Os nomes de código e de banco ficam em inglês, como no código.

## Termos de domínio

A terminologia do Thinker tem direção:

- **Thinker Request** (Requisição): uma requisição lógica de um agente ao Thinker. Fica em `requests`.
- **Provider Attempt** (Tentativa): uma requisição do Thinker a um provedor de IA. Fica em `agent_messages`.
- **Tenant**: a fronteira de dados de um usuário. É criado a partir de `user.id` na primeira criação de agente.
- **Agent** (agente): um agente de IA pertencente a um tenant. O dashboard o chama de **Harness** (navegação em `/harnesses`; as URLs antigas `/agents/*` redirecionam). É só texto de interface: código, tabelas e rotas de API continuam dizendo *agent*.

## Os dois mundos

**O mundo das Requisições (lado do agente).** Um agente faz uma Requisição lógica ao Thinker. O Thinker pode tentar vários provedores para atendê-la, mas o agente vê um único resultado. Requisições pertencem a agentes e à Visão geral global. A recuperação é um conceito de Requisição.

**O mundo das Tentativas (lado do provedor).** Toda chamada a um provedor é uma Provider Attempt. Uma Requisição tem zero ou mais Tentativas. Tentativas pertencem a provedores, Conexões de provedor e modelos. Uma Tentativa pode ser disparada por fallback, mas esse contexto não muda o seu status.

## Glossário

### Thinker Request

- Direção: agente → Thinker
- Tabela: `requests`; chave primária `requests.id`; status em `requests.status`.
- Tem um resultado final visível ao chamador e pode ter uma ou várias Tentativas.

### Provider Attempt

Uma avaliação de rota durante o atendimento de uma Requisição. A maioria chama um provedor de IA; falhas locais do Thinker também ficam como Tentativas com falha, para que a cadeia de roteamento completa fique visível.

- Direção: Thinker → provedor de IA, ou interna quando o Thinker rejeita a rota localmente.
- Tabela: `agent_messages` (o nome físico antigo foi mantido para implantações progressivas seguras).
- Requisição pai: `agent_messages.request_id → requests.id`.
- Ordem na Requisição: `agent_messages.attempt_number`.
- Status: `agent_messages.status`.

Toda chamada a um provedor conta como Tentativa, inclusive as que falham e as de fallback. Falhas locais do Thinker, como uma rota ignorada durante o resfriamento do provedor, também contam como Tentativas com falha, mas a origem de erro "Thinker" as mantém fora das métricas de confiabilidade de provedores.

### Status

Requisições e Tentativas novas usam os mesmos valores canônicos:

| Valor | Significado | Rótulo na interface |
| --- | --- | --- |
| `pending` | A operação ainda não tem resultado final. | Pending |
| `cancelled` | O chamador desconectou antes de haver resultado do provedor. | Cancelled |
| `success` | A operação terminou com sucesso. | Success |
| `failed` | A operação terminou sem sucesso. | Failed |

`cancelled`, `success` e `failed` são finais. As métricas de resultado usam só `success` e `failed`; cancelamentos do chamador não contam como erro de provedor nem do Thinker. Aqui, **concluída** significa um resultado final incluído nas métricas (`success` ou `failed`); não é um valor de status.

Linhas históricas de `agent_messages` podem manter os valores físicos antigos `ok`, `error`, `fallback_error` ou `rate_limited`. Os leitores de análise normalizam `ok` para `success` e os valores antigos de falha para `failed`. Quem escreve deve usar os valores canônicos.

O Thinker cria a Requisição com status `pending` ao aceitá-la e a Tentativa com `pending` ao iniciar a chamada ao provedor; cada uma vai para um status final. Se o chamador desconectar antes, as linhas ativas passam a `cancelled`, sem campos de erro.

Toda Requisição ou Tentativa nova com `failed` tem um `error_message` não vazio. A classificação para máquinas fica em `error_origin`, `error_class` e `error_http_status`; a mensagem é a explicação para pessoas.

`requests.status` é a fonte de verdade do resultado visível ao chamador. Quando uma Requisição com ao menos uma Tentativa tem sucesso, a Última Tentativa também precisa ter tido sucesso. Uma Requisição com falha pode não ter nenhuma Tentativa.

### Última Tentativa (Last Attempt)

A Tentativa final de uma Requisição: a de maior `attempt_number`. Numa Requisição concluída, é também a que a encerrou: a bem-sucedida, ou a falha terminal não substituída. Uma Requisição sem Tentativas não tem Última Tentativa.

Os números de tentativa são positivos, únicos na Requisição e crescem na ordem em que o Thinker avalia as rotas. Não derive a ordem dos timestamps: `agent_messages.timestamp` registra o início real e `agent_messages.duration_ms` o tempo medido, e nenhum dos dois pode ser inventado para criar uma ordem. Tentativas substituídas nunca são a Última Tentativa de uma Requisição concluída.

Tentativas históricas podem ter `attempt_number` nulo quando a ordem não pôde ser reconstruída com segurança. Os leitores podem usar o ranking de compatibilidade (resultado bem-sucedido, depois falha não substituída, depois timestamp e id) para escolher uma Tentativa terminal representativa, mas não devem apresentar essa posição inferida como número de tentativa.

### Tentativa substituída (Superseded Attempt)

Uma Tentativa com falha depois da qual o Thinker continuou a mesma Requisição com outra Tentativa. As novas mantêm `agent_messages.status = 'failed'` e `agent_messages.superseded = true` (as históricas podem ter `fallback_error`). Elas contam nas métricas de Tentativa, mas não determinam o resultado da Requisição.

### Requisição recuperada (Recovered Request)

Uma Requisição bem-sucedida depois de o Thinker continuar além de uma Tentativa com falha usando **fallback**. A recuperação pertence só às Requisições: provedores, Conexões, modelos e Tentativas nunca são "recuperados". Aplicar o fallback não basta: a Requisição precisa terminar com sucesso.

Cada Requisição pertence a exatamente uma categoria, avaliada nesta ordem:

1. **Pending:** `requests.status = 'pending'`.
2. **Cancelled:** `requests.status = 'cancelled'`.
3. **Failed:** `requests.status = 'failed'`.
4. **Recovered by fallback:** `requests.status = 'success'` e a Última Tentativa tem `agent_messages.fallback_from_model` não nulo.
5. **Success:** qualquer outra com `requests.status = 'success'`.

### Provedor de IA e Conexão de provedor

Um **Provedor de IA** é uma plataforma de origem, como OpenAI ou Anthropic. Cada Tentativa registra o seu em `agent_messages.provider`.

Uma **Conexão de provedor** é a conexão configurada de um tenant com um Provedor. Fica em `tenant_providers`; `tenant_providers.provider` identifica o Provedor e `tenant_providers.auth_type` o método de autenticação. Um Provedor pode ter várias Conexões; cada Conexão pertence a um só Provedor.

Uma Tentativa identifica a Conexão usada por `agent_messages.tenant_provider_id → tenant_providers.id`. `agent_messages.auth_type` e `agent_messages.provider_key_label` são instantâneos históricos para exibição, não a identidade da Conexão. Credenciais (chaves, tokens) continuam cifradas no nível da Conexão e nunca devem ser copiadas para Tentativas.

"Tentativas da Conexão" são Tentativas filtradas por `tenant_provider_id`, não um tipo de evento nem uma tabela. A referência pode ser nula em dados antigos, provedores locais ou caminhos em que o Thinker não identificou a Conexão; por isso o total de um Provedor pode superar a soma dos totais de suas Conexões.

## Dados de Requisição e de Tentativa

| Dado | Fonte canônica |
| --- | --- |
| Identidade e escopo da Requisição | `requests.id`, `requests.tenant_id`, `requests.agent_id` |
| Status visível ao chamador | `requests.status` e as colunas `requests.error_*` |
| Duração ponta a ponta | `requests.duration_ms` |
| Modelo pedido pelo agente | `requests.requested_model` |
| Identidade e pai da Tentativa | `agent_messages.id`, `agent_messages.request_id` |
| Ordem da Tentativa | `agent_messages.attempt_number` |
| Status da Tentativa | `agent_messages.status` e as colunas `agent_messages.error_*` |
| Provedor, modelo e Conexão | `agent_messages.provider`, `agent_messages.model`, `agent_messages.tenant_provider_id` |
| Uso da Tentativa | Colunas de tokens e custo em `agent_messages` |
| Contexto de roteamento e fallback | `agent_messages.routing_*`, `fallback_*` e `superseded` |

## Definição e perímetro das métricas

As métricas do dashboard usam Requisições e Tentativas concluídas dentro dos filtros de tenant, agente e período:

- Requisições e Tentativas pendentes e canceladas ficam fora dos totais e das taxas de sucesso.
- O tráfego do Playground é excluído.
- Requisições concluídas sem Tentativas entram nas métricas de Requisição.
- Na transição histórica, cada Tentativa antiga sem vínculo pode ser representada por uma Requisição sintética, que conta uma vez nas métricas de Requisição e normalmente nas de Tentativa.

| Métrica | Definição |
| --- | --- |
| Total de Requisições | Cada Requisição armazenada concluída uma vez, mais cada Requisição sintética elegível uma vez durante a transição. |
| Taxa de sucesso de Requisições | Requisições com `status = 'success'` divididas pelas concluídas. Sem tráfego, não há taxa (não é 100%). |
| Total de Tentativas | Cada `agent_messages.id` concluído; não deduplique por Requisição. |
| Taxa de sucesso de Tentativas | Tentativas com `status = 'success'` divididas pelas concluídas. |

Superfícies no nível de Requisição contam Requisições; superfícies por Provedor, Conexão e modelo contam Tentativas. Os dois totais respondem a perguntas diferentes e não precisam coincidir.

## Exemplos

| Cenário | Requisições contadas | Tentativas contadas | Status da Requisição | Status das Tentativas | Recuperação |
| --- | ---: | ---: | --- | --- | --- |
| Em andamento | 0 | 0 | `pending` | `pending`, quando houver | Excluída |
| O chamador desconecta antes do resultado | 0 | 0 | `cancelled` | `cancelled`, quando houver | Excluída |
| O provedor principal funciona | 1 | 1 | `success` | `success` | Nenhuma |
| O Thinker rejeita antes de contatar um provedor | 1 | 0 | `failed` | Nenhuma | Nenhuma |
| A tentativa principal falha, o fallback funciona | 1 | 2 | `success` | `failed`, `success` | Fallback |
| Todas as Tentativas falham | 1 | N | `failed` | `failed` × N | Nenhuma |

## Regras de leitura

1. Agrupar é uma lente, não um filtro: trocar o agrupamento de um gráfico nunca muda o seu total.
2. Uma Requisição conta uma vez nas superfícies do mundo das Requisições; uma Tentativa conta uma vez nas do mundo das Tentativas.
3. "Recuperada" qualifica só Requisições.
4. Os campos de fallback de uma Tentativa descrevem seu gatilho ou contexto, nunca o resultado; o resultado está no status.
5. Uma lente de Provedor no nível de Requisição atribui cada Requisição uma vez ao Provedor da sua Última Tentativa; Requisições sem Tentativas usam o grupo Thinker. Nunca conte cada Tentativa como uma Requisição.
6. Superfícies de Conexão e de modelo continuam no nível de Tentativa, pois uma Requisição pode usar várias Conexões ou modelos.

## Nomes e status herdados

- `agent_messages` continua sendo a tabela física das Provider Attempts.
- `AgentMessage`, `/api/v1/messages` e os nomes `Message*` do frontend são nomes legados de código e API; não definem a unidade de análise.
- `ok` mapeia para `success`. `error`, `rate_limited`, `fallback_error` e `auto_fixed` mapeiam para `failed`; os campos de erro, fallback e substituição preservam o contexto adicional. Uma migração remapeou as linhas antigas com status `auto_fixed` para `fallback_error`.
